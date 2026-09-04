'use strict';
// The bot brain: a priority ladder re-picked a few times a second, writing
// the same input struct a human fills - it can never do what a player cannot.
// ------------------------------------------------------------ ai
// Bot slots. A bot only ever writes the same input struct a human fills in -
// movement axis, aim point, fire / work / slide / dodge and the odd build
// order - so it can never do anything a player couldn't. The brain is a small
// priority ladder, re-picked a few times a second: eat, fight, wolves, defend
// the bird, push the rival bird, escort, hunt, loot, spend, harvest, roam -
// and a PROFILE (the difficulty banner below) says how well each rung is
// played. Every walk goes through steerTo(), which routes
// around obstacles (see pathfinding) and reports an unreachable goal as -1 -
// that, not a timer, is what makes a bot drop a target.
const AI_SIGHT = 150;   // px: how far a wolf on a bot is still tracked (a rival's reach is the profile's sight)
const AI_EAT_R = 110;   // px: a rival closer than this will knock the meal out of its hands, so it waits
const AI_HUNT = 120;    // px: how far it will go after an animal
const AI_FORAGE = 12;   // tiles: how far from itself it looks for work
// ---- difficulty ----------------------------------------------------------
// Every bot plays the same ladder; a PROFILE says how well. The RIVALS run
// AI_LEVELS[settings.aiLevel] (class select's notches, remembered with the
// profile); your ALLIES run one notch above the rivals (capped at the top)
// plus the support fields, so your side is always the more competent one
// and the difficulty is how good the other side is. Nothing in a profile
// lets a bot do what a hand cannot - every field is a worse or better use
// of the same input struct:
//   sight   px it notices a rival from (through seenAt, so cover still works)
//   react   s a rival stays noticed before the bot turns on it
//   aim     px of scatter on the aim point, re-rolled every AI_AIM_T
//   lead    0..1 of the target's motion it aims ahead by (flight time)
//   draw    fraction of bowCharge it looses at (a short draw is a weak shot)
//   dodge   x the chance per second it rolls when hurt
//   abil    chance each AI_ABIL_T tick that a ready ability is spent
//   flee    hp fraction under which it hides (hunter) / gives ground
//   work    duty cycle of the E key while harvesting (its level pace)
//   strafe  fraction of each 2 s it keeps moving in a fight; the rest it
//           PLANTS - stands, draws and shoots, the only time a slow side
//           fires - so the moment it stops is the moment it is about to
//           shoot, and the moment a new player hits it. Under 1 it also
//           circles that much less: it walks in straighter
//   pick    'near' the closest rival, 'weak' the one with the least hp
//   push    { t, n } - after t s, the side's first n bots go for the rival
//           eagle (the objective rung), one more every AI_ESCALATE s after
//           that, so a stalemate always breaks
//   guard   how many of the next bots stand by their own bird from 0.6 t on
//   support allies only: escort the human and join their fights and pushes
// What is NOT in a profile: answering a hit on its own bird. At every level
// a struck roost, or a rival seen standing off it, is answered from anywhere
// on the map by as many bots as the threat calls for (the two birds, below)
// - the difficulty is how well they fight when they get there, never
// whether they come.
const AI_LEVELS = [
  { name: 'NORMAL', sight: 110, react: 0.7, aim: 30, lead: 0, draw: 0.7, dodge: 0.5, abil: 0.35, flee: 0.5, work: 0.5, strafe: 0.45, pick: 'near', push: { t: 360, n: 2 }, guard: 1 },
  { name: 'HARD', sight: 150, react: 0.3, aim: 8, lead: 0.5, draw: 0.9, dodge: 1, abil: 0.8, flee: 0.35, work: 0.8, strafe: 0.8, pick: 'near', push: { t: 360, n: 3 }, guard: 2 },
  { name: 'IMPOSSIBLE', sight: 200, react: 0, aim: 0, lead: 1, draw: 0.95, dodge: 2, abil: 1, flee: 0.2, work: 1, strafe: 1, pick: 'weak', push: { t: 300, n: 3 }, guard: 2 },
];
// your allies at each rival level: the next notch up, supportive, one of
// them on guard, and on the objective on their own clock - late on NORMAL,
// so that a player who goes for the bird decides the match and one who
// never does is still carried to it; earlier as the rivals push earlier.
// The clocks are set for a match that ends round fifteen minutes when the
// human sits it out (the harness, multiplayer.md): an ally push takes two
// to three minutes to drive a bird off, so NORMAL's leaves at twelve
const AI_ALLY_PUSH = [{ t: 720, n: 2 }, { t: 480, n: 3 }, { t: 420, n: 3 }];
const AI_ALLIES = AI_LEVELS.map((_, i) => Object.assign({}, AI_LEVELS[Math.min(AI_LEVELS.length - 1, i + 1)],
  { name: 'ALLY', support: true, push: AI_ALLY_PUSH[i], guard: 1 }));
const AI_GUARD_R = 160;   // px a guard lets itself drift from its bird before walking back
const AI_ESCALATE = 120;  // s after push.t per extra pusher a side commits
// how many of a side push right now: push.n, growing past push.t
function aiPushers(prof) { return state.elapsed < prof.push.t ? 0 : prof.push.n + Math.floor((state.elapsed - prof.push.t) / AI_ESCALATE); }
const AI_AIM_T = 0.4;     // s between aim scatter re-rolls
const AI_ABIL_T = 0.5;    // s between ability rolls
const AI_ANCHOR_R = 260;  // px round an anchor (its bird, the human) a rival is noticed from
const AI_ANCHOR_D = 420;  // ...but never from farther than this
const AI_HOLD = 96;       // px a hunter holds off the rival bird at (outside its gust)
const AI_GATE = 128;      // px out from a lane's mouth, on the open snow, where a walk to a roost stages
const AI_ROOST_BUDGET = NAV_BUDGET * 4; // A* expansions a walk into a roost's forest may spend
const AI_ESCORT = 120;    // px an escort lets the human get away before it follows
const AI_ESCORT_R = 400;  // px past which the human is too far to escort
// which profile p plays by: a staged override (DBG, the harness), else by side
function aiProfile(p) {
  if (p.ai.prof) return p.ai.prof;
  const lv = Math.max(0, Math.min(AI_LEVELS.length - 1, settings.aiLevel | 0));
  return player && p.team === player.team ? AI_ALLIES[lv] : AI_LEVELS[lv];
}
// the two objectives as a bot sees them: a roosting bird, or null
function aiRivalEagle(p) { const e = state.drop && state.drop.eagles[1 - p.team]; return e && e.state === 'down' ? e : null; }
function aiOwnEagle(p) { const e = state.drop && state.drop.eagles[p.team]; return e && e.state === 'down' ? e : null; }
// ---- the two birds --------------------------------------------------------
// What every bot knows about the objective - both birds, all match: where
// each roosts, how its nerve stands, when it was last hit, and who is AT it:
// the rivals standing off it (each through seenAt, so a buried archer is
// buried for the whole side) and the friends already there. Read once per
// sim step and shared by all ten slots, so a hit on a roost is news on the
// far side of the map the same tick - a bird under attack is answered from
// anywhere, and a bird that is winning the race is not abandoned for one
// that is losing it. `threat` is the one word the ladder asks.
const AI_ROOST_R = 240;   // px round a bird inside which a body counts as at it
const AI_DEFEND_T = 8;    // s after a hit on its bird a side still counts it as under attack
const AI_JOIN_HP = 0.6;   // a rival bird under this much nerve, with friends on it, is a siege to join
const AI_ALARM_HP = 0.5;  // its own bird under this much nerve: EVERYONE comes home, pushers included
const AI_SIEGE_R = 48;    // px: a rival closer than this pulls a besieging pusher off the bird
// how many of a side a threat on its bird calls home: one more than the
// attackers seen there, and never fewer than two (a hit with nobody in sight
// is an archer standing off it). The rest go on with the match - a side
// that empties the whole map for one arrow is a side that never pushes -
// until the nerve is under AI_ALARM_HP, when the number is everyone.
function aiDefendersWanted(s) { return s.hp < AI_ALARM_HP ? 99 : Math.max(2, s.attackers + 1); }
let aiSitTick = -1, aiSit = null;
function aiSituation() {
  if (aiSit && aiSitTick === state.tick) return aiSit;
  aiSitTick = state.tick;
  aiSit = [0, 1].map((team) => {
    const e = state.drop && state.drop.eagles[team];
    if (!e || e.state !== 'down') return null;
    const s = { e, team, hp: e.hp / e.maxHp, hitT: e.hitT, attackers: 0, defenders: 0, human: false, threat: false };
    for (const q of players) {
      if (!q.active || q.dead || inAir(q)) continue;
      const d = Math.hypot(q.x - e.x, q.y - e.y);
      if (d >= AI_ROOST_R) continue;
      if (q.team === team) s.defenders++;
      else if (d < seenAt(q, AI_ROOST_R)) { s.attackers++; if (q === player) s.human = true; }
    }
    s.threat = s.hitT < AI_DEFEND_T || s.attackers > 0;
    return s;
  });
  return aiSit;
}
// p's place among its side's living AI slots (the human is never counted):
// the profile's push.n lowest go for the rival bird, the guard next stand by
// their own, and the rest farm, build and (allies) escort
function aiRank(p) {
  let n = 0;
  for (const q of players) {
    if (!q.active || q.dead || inAir(q) || q.team !== p.team || q.control !== 'ai' || q === player) continue;
    if (q === p) return n;
    n++;
  }
  return 99;
}
// the objective rung's gate: after push.t the side's push.n lowest bots go
// for the rival bird; an ally also goes whenever the human is already on
// it, so a push you start is a push your side joins; and ANY bot joins a
// siege its side already has going once the rival bird is under AI_JOIN_HP
// - unless its own bird is under attack, which is where it is wanted
// (`theirs`/`mine` are the aiSituation reads for the two birds)
function aiWantsPush(p, prof, theirs, mine) {
  if (!theirs) return null;
  const e = theirs.e;
  if (prof.support && theirs.human && player !== p) return e;
  if (theirs.attackers > 0 && theirs.hp < AI_JOIN_HP && !(mine && mine.threat)) return e;
  return aiRank(p) < aiPushers(prof) ? e : null;
}
// the guard's gate: from 0.6 push.t on, the prof.guard bots after the
// pushers stand by their own bird
function aiOnGuard(p, prof) {
  const e = aiOwnEagle(p);
  if (!e || !prof.guard || state.elapsed < prof.push.t * 0.6) return null;
  const r = aiRank(p), n = aiPushers(prof);
  return r >= n && r < n + prof.guard ? e : null;
}
// the staging point of a roost: AI_GATE px past the lane's mouth on the open
// snow, so the way in is always field -> gate -> mouth -> lane -> bird
function aiLaneGate(e) {
  const dx = e.mouth.x - e.x, dy = e.mouth.y - e.y, d = Math.hypot(dx, dy) || 1;
  return { x: e.mouth.x + dx / d * AI_GATE, y: e.mouth.y + dy / d * AI_GATE };
}
// Walk toward a roost the way its lane allows: from the field to the gate,
// in through the mouth, then down the lane to the bird (reach tiles off it).
// Returns steerTo's distance, or -1 for no route this frame. A route straight
// at a bird from the field runs the pathfinder out in the border's trees and
// leaves the bot wedged in a pocket - which is what this exists to prevent.
function aiToRoost(p, e, steerTo, reach) {
  if (aiInLane(p, e)) return steerTo(e.x, e.y, reach, AI_ROOST_BUDGET);
  const dm = Math.hypot(e.mouth.x - p.x, e.mouth.y - p.y);
  if (dm <= 24) return steerTo(e.x, e.y, reach, AI_ROOST_BUDGET);
  const g = aiLaneGate(e);
  const dg = Math.hypot(g.x - p.x, g.y - p.y);
  if (dg > 40 && dm > AI_GATE * 0.75) return steerTo(g.x, g.y, 2, AI_ROOST_BUDGET);
  return steerTo(e.mouth.x, e.mouth.y, 1, AI_ROOST_BUDGET);
}
// is p inside a roost's lane - the band from the bird out to the lane's
// mouth on the treeline - or at the bird itself? Off it, the way to the
// roost is the mouth (aiInLane is asked before every walk to a bird).
function aiInLane(p, e) {
  const vx = e.mouth.x - e.x, vy = e.mouth.y - e.y, L2 = vx * vx + vy * vy || 1;
  const px = p.x - e.x, py = p.y - e.y;
  const t = (px * vx + py * vy) / L2;
  const perp = Math.abs(px * vy - py * vx) / Math.sqrt(L2);
  return (t >= -0.1 && t <= 1.08 && perp < 40) || Math.hypot(px, py) < 90;
}
// the eagle hitbox tile nearest p (a warrior's E target on a push)
function aiEagleTile(e, p) {
  let best = null, bd = 1e9;
  const cx0 = Math.floor(e.x / TILE), cy0 = Math.floor(e.y / TILE);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const o = inWorld(cx0 + dx, cy0 + dy) ? objects[idx(cx0 + dx, cy0 + dy)] : null;
    if (!o || o.type !== 'eagle' || o.team !== e.team) continue;
    const d = Math.hypot(o.tx * TILE + 8 - p.x, o.ty * TILE + 8 - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// the side's escorts: the two lowest AI slots on the human's team
function aiEscorts(p) {
  let n = 0;
  for (const q of players) {
    if (!q.active || q.control !== 'ai' || q.team !== player.team || q === player) continue;
    if (q === p) return n < 2;
    n++;
  }
  return false;
}

// The rival p goes for: within its profile's sight, plus anyone near an
// ANCHOR it is minding - its own bird under attack, the human it escorts,
// the rival bird it is pushing - so a defender finds the archer standing off
// its roost and an ally joins the fight the human is in. Every candidate
// still resolves through seenAt: a buried rival is buried for everyone.
function aiNearestEnemy(p, prof, anchors) {
  let best = null, bs = Infinity;
  for (const q of players) {
    if (!enemyOf(p, q)) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    let range = prof.sight;
    for (const an of anchors) {
      if (an && Math.hypot(q.x - an.x, q.y - an.y) < AI_ANCHOR_R) range = AI_ANCHOR_D;
    }
    if (d >= range || d >= seenAt(q, range)) continue;
    const s = prof.pick === 'weak' ? q.hp + d * 0.05 : d;
    if (s < bs) { bs = s; best = q; }
  }
  return best;
}

// wolves that are already on this bot, or close enough to be about to be
function aiNearestWolf(p) {
  let best = null, bd = 92;
  for (const a of animals) {
    if (a.dead || a.kind !== 'wolf') continue;
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < bd || (a.target === p && d < AI_SIGHT)) { bd = Math.min(bd, d); best = a; }
  }
  return best;
}

function aiNearestAnimal(p) {
  let best = null, bd = AI_HUNT;
  for (const a of animals) {
    // birds fly: no route on the ground catches a flushed flock
    if (a.dead || a.kind === 'bird' || a === p.ai.huntAvoid) continue;
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// arrows die on solids, so a bot only shoots when the flight path is open
function aiLineClear(p, x, y) {
  const dx = x - p.x, dy = y - (p.y - BOW_Y), d = Math.hypot(dx, dy) || 1;
  for (let s = 10; s < d; s += 8) {
    if (isSolidTile(Math.floor((p.x + dx / d * s) / TILE), Math.floor((p.y - BOW_Y + dy / d * s) / TILE))) return false;
  }
  return true;
}

// open tiles around a target: work needs at least one to stand on (the
// route finds the way to it), and a build site wants room around it
function aiOpenSides(tx, ty) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = tx + dx, ny = ty + dy;
    if (inWorld(nx, ny) && !isSolidTile(nx, ny) && ground[idx(nx, ny)] !== 2) n++;
  }
  return n;
}

// bots skip the pick-1-of-3 draft UI entirely (bagClick is a mouse-only
// entry point) - the instant one is carried, resolve it server-side with a
// single random pick, since "choosing among 3" is specifically the human
// decision point and inventing an AI heuristic for it isn't worth it
function resolveCardForBot(p) {
  for (const rarity of CARD_RARITIES) {
    if (bagCount(p, cardKey(rarity)) <= 0) continue;
    bagTake(p, cardKey(rarity), 1);
    p.cards.push({ rarity, id: Math.floor(rng() * CARDS[rarity].length) });
    refreshKit(p);
    return;
  }
}

function updateAI(p, dt) {
  const inp = p.input, ai = p.ai;
  inp.mx = 0; inp.my = 0; inp.work = false; inp.slide = false;
  if (p.dead || p.fallT > 0) { inp.fire = false; return; }
  resolveCardForBot(p);
  const prof = aiProfile(p);

  // walk the route to (x, y) - reach 1 stops beside a tile it cannot stand
  // on, which is exactly WORK_REACH - and return the straight-line distance,
  // or -1 when there is no route (drop the goal, do not wait on it)
  const steerTo = (x, y, reach, budget) => {
    const n = navTo(p, x, y, PLAYER_R, reach || 0, dt, budget);
    if (!n.ok) return -1;
    inp.mx = n.dx; inp.my = n.dy;
    return n.d;
  };
  const aimAt = (x, y) => { inp.aimX = x; inp.aimY = y; };

  ai.thinkT -= dt;
  if (ai.buildT > 0) ai.buildT -= dt;
  if (ai.hideCd > 0) ai.hideCd -= dt;
  if (ai.pushCd > 0) ai.pushCd -= dt;
  // the profile's clocks: the aim scatter re-rolls, the ability roll
  ai.aimT -= dt;
  if (ai.aimT <= 0) { ai.aimT = AI_AIM_T; ai.aox = rand(-1, 1) * prof.aim; ai.aoy = rand(-1, 1) * prof.aim; }
  ai.abilT -= dt;
  if (ai.abilT <= 0) { ai.abilT = AI_ABIL_T; ai.abilOk = rng() < prof.abil; }
  // what it is minding, off the shared read of both birds: its own bird
  // under attack - answered from anywhere on the map by as many as the
  // threat calls for (aiDefendersWanted), a bot already at the roost holding
  // its station, and once the nerve is under AI_ALARM_HP by everyone, the
  // one exception a pusher whose side is WINNING the race (the rival bird
  // lower still), who presses on - the rival bird it is due to push, and
  // (an ally) the human it escorts
  const sit = aiSituation();
  const mine = sit[p.team], theirs = sit[1 - p.team];
  const own = mine ? mine.e : null;
  const pushE = ai.pushCd > 0 ? null : aiWantsPush(p, prof, theirs, mine);
  let defend = null;
  if (mine && mine.threat) {
    const alarm = mine.hp < AI_ALARM_HP;
    if (pushE) defend = alarm && !(theirs.hp < mine.hp) ? own : null;
    else if (alarm || Math.hypot(own.x - p.x, own.y - p.y) < AI_ROOST_R) defend = own;
    else defend = mine.defenders < aiDefendersWanted(mine) ? own : null;
  }
  const guardE = aiOnGuard(p, prof);
  const ward = prof.support && !player.dead && !inAir(player) && player !== p ? player : null;

  // 0. spend a free skill point before the ladder - waiting on it is leaving
  //    growth on the table. Lowest ability level first, so the kit rises
  //    evenly - which spends the first four points UNLOCKING all four keys
  //    (level 0 casts nothing) before any of them gets a cooldown cut.
  if (p.skillPts > 0 && !inp.cmd) {
    let ba = -1, bl = AB_LV_MAX - 1;
    for (let i = 0; i < AB_KEYS; i++) if (p.abLv[i] - 1 < bl) { bl = p.abLv[i] - 1; ba = i; }
    if (ba >= 0) inp.cmd = { kind: 'ability', i: ba };
  }

  // 1. food, exactly as a human eats it (Q / F) - but a meal is a 1.5 s
  //    channel now and a hit knocks it out of the hands (js/core.js), so a bot
  //    only starts one with nobody close enough to do that. Standing there
  //    chewing under fire is not patience, it is a free kill. `foe` is read
  //    here rather than at rung 2 because this rung is the first to need it.
  const foe = aiNearestEnemy(p, prof, [defend || guardE, pushE, ward]);
  const foeD = foe ? Math.hypot(foe.x - p.x, foe.y - p.y) : Infinity;
  // the reaction: a rival stays noticed prof.react seconds before the bot
  // turns on it (a slow side keeps chopping while you line up the shot)
  ai.seeT = foe ? ai.seeT + dt : Math.max(0, ai.seeT - dt * 2);
  // the siege: a pusher AT the rival roost whose side outnumbers the
  // defenders there keeps hitting the bird and leaves the fight to its
  // friends - defenders come back from sixty pixels away every few seconds,
  // and a push that turns to meet each one never lands a swing - unless a
  // rival is at arm's length (AI_SIEGE_R), which is a rival it cannot ignore
  const siege = pushE && theirs && theirs.attackers > theirs.defenders &&
    Math.hypot(theirs.e.x - p.x, theirs.e.y - p.y) < AI_ROOST_R;
  const engage = foe && ai.seeT >= prof.react && !(siege && foeD > AI_SIEGE_R) ? foe : null;
  if (p.eatT <= 0 && p.foodCd <= 0 && foeD > AI_EAT_R) {
    if (p.hp < p.maxHp * 0.5 && bagCount(p, 'fish') > 0) inp.eatFish = true;
    else if (p.hp < p.maxHp * 0.8 && bagCount(p, 'berry') > 0) inp.eatBerry = true;
  }

  // 2. the burrow - a hunter's alone now, cast as SNOW COVER (key 4) with its
  //    own 60 s clock on the way under. Decided before the ladder because two
  //    rungs below read the answer: a bot that has come off worse and has
  //    nobody looking at it goes to ground and waits the fight out, and one
  //    that is already down shoots from where it lies - which earns it the
  //    same ambush multiplier a human gets, off the same ambushReady() check.
  //    It gets straight back up for a wolf, for a rival close enough to find
  //    it anyway, or when the spell runs out - rising is free, the cast key
  //    again. It only ever tries where a player could: on snow, on its own
  //    feet, with the cooldown in hand. `hideT` doubles as the give-up: a
  //    plant that will not take burns it four times as fast and ends in the
  //    lockout.
  const wolf = foe ? null : aiNearestWolf(p);
  if (p.prone) ai.hideT -= dt;
  const btx = Math.floor(p.x / TILE), bty = Math.floor((p.y + 4) / TILE);
  const canBury = p.cls === 0 && abReady(p, 3) && !p.sliding && p.dodgeT <= 0 &&
    inWorld(btx, bty) && ground[idx(btx, bty)] === 0;
  let down = p.prone;
  if (wolf) down = false;
  else if (foe) down = p.prone && Math.hypot(foe.x - p.x, foe.y - p.y) > 48;
  else if (p.prone) down = ai.hideT > 0 && p.hp < p.maxHp * 0.9;
  else if (p.hp < p.maxHp * prof.flee && ai.hideCd <= 0 && canBury) down = true;
  if (down !== p.prone) {
    inp.ability = 3;                                  // snow cover: the burrow's one door, in and out
    if (p.prone) ai.hideCd = 18;                      // back up: no re-burrowing for a while
    else if (ai.hideT <= 0) ai.hideT = rand(7, 12);   // going down: how long it means to stay
  }
  if (down && !p.prone) {
    // stop dead and let the momentum bleed off; tryProne refuses a body that
    // is still moving. Somewhere that never takes gives up and locks out.
    ai.hideT -= dt * 4;
    if (ai.hideT > 0) { inp.fire = false; return; }
    ai.hideCd = 12;
  }

  // 3. a rival in sight (and reacted to): circle at bow range and shoot.
  //    The profile says how well: the aim point carries its scatter and its
  //    lead, abilities go on the ability roll, the draw is loosed at the
  //    profile's fraction, the dodge at its rate - and a slow side stands
  //    still for part of every strafe, which is when it gets hit.
  if (engage) {
    const foe = engage;
    const d = foeD;
    const tf = prof.lead > 0 ? d / 300 * prof.lead : 0; // s of flight it leads by
    aimAt(foe.x + foe.vx * tf + ai.aox, foe.y - 6 + foe.vy * tf + ai.aoy);
    // hold ~70px: close in when far, back off when crowded, strafe in between
    const clear = aiLineClear(p, foe.x, foe.y - 6);
    if (p.prone) {
      // no strafing on your belly: concealOf discounts a mound that is moving,
      // and ambushReady refuses a moving shot outright. Hold still, let them
      // walk in, and spend the arrow at full draw.
      inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.95;
      ai.tgt = null;
      return;
    }
    // the class abilities, spent off cooldown at the foe - through the same
    // edge key a human presses, so a bot can never cast what a hand couldn't
    if (ai.abilOk && p.castT <= 0 && p.rushT <= 0 && p.shieldT <= 0 && p.grapT <= 0 && inp.ability < 0) {
      if (p.cls === 0) { // hunter: skewer the open lane, tangle the gap
        // (the grapple is a held key and a terrain read - a hand skill the
        // ladder does not try to fake; snow cover is spent at rung 2)
        if (abReady(p, 0) && d > 55 && d < 230 && clear) inp.ability = 0; // lock the piercing draw on them
        else if (abReady(p, 1) && d < 110 && clear) inp.ability = 1;      // net the gap
      } else { // warrior: get there, and be unstoppable arriving
        if (abReady(p, 3) && d < 110) inp.ability = 3;               // juggernaut into the fight
        else if (abReady(p, 1) && d > 36 && d < 120 && clear) inp.ability = 1; // rush the line
        else if (abReady(p, 2) && d < 42) inp.ability = 2;           // stomp at arm's length
        else if (abReady(p, 0) && d < 150 && p.hp < p.maxHp * 0.75) inp.ability = 0; // shield the arrows
      }
    }
    const side = p.id % 2 ? 1 : -1;
    const a = Math.atan2(foe.y - p.y, foe.x - p.x);
    if (!clear) {
      // no line to them: never walk into the corner that is blocking it
      // (ten bodies doing exactly that at a lane's bend was a fight nobody
      // fired a shot in for a quarter of an hour). Far off, ROUTE in through
      // the open - along a lane's axis rather than into its tree wall;
      // close in, give ground straight back and let them come round the
      // corner into the line. Re-read every think, so a cleared line goes
      // straight back to the strafe below.
      if (d > 60) { if (steerTo(foe.x, foe.y, 3) < 0) { inp.mx = 0; inp.my = 0; } }
      else { inp.mx = -Math.cos(a); inp.my = -Math.sin(a); }
      inp.fire = false;
      ai.tgt = null;
      return;
    }
    const turn = d > 85 ? 0.3 * side : d < 50 ? Math.PI * 0.85 * side : Math.PI / 2 * side * prof.strafe;
    inp.mx = Math.cos(a + turn); inp.my = Math.sin(a + turn);
    // a slow side plants its feet to shoot: the standing part of each 2 s is
    // the only part it draws and looses in (a draw cut off by the walk goes
    // as the weak tap it is), so stopping IS the tell
    const planted = prof.strafe >= 1 || (state.tick % 120) >= 120 * prof.strafe;
    if (planted && prof.strafe < 1) { inp.mx = 0; inp.my = 0; }
    inp.fire = planted && clear && p.chargeT < kitOf(p).bowCharge * prof.draw; // draw, then loose at the profile's draw
    if (p.hp < p.maxHp * 0.45 && p.dodgeCharges > 0 && rng() < dt * 2 * prof.dodge) inp.dodge = true;
    ai.tgt = null;
    return;
  }

  // 4. wolves hunt back: a bot that wanders into a den has to fight its way
  //    out, so it shoots the nearest one and gives ground while it does
  if (wolf) {
    const d = Math.hypot(wolf.x - p.x, wolf.y - p.y);
    const clear = aiLineClear(p, wolf.x, wolf.y - 4);
    aimAt(wolf.x, wolf.y - 4);
    const away = Math.atan2(p.y - wolf.y, p.x - wolf.x);
    if (d < 64) { inp.mx = Math.cos(away); inp.my = Math.sin(away); }
    inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.7;
    if (d < 30 && p.dodgeCharges > 0 && rng() < dt * 3) inp.dodge = true;
    ai.tgt = null;
    return;
  }

  // 5. lying low with nothing in sight: hold still and let the snow finish.
  //    Everything below this rung walks somewhere, and a bot crawling to a
  //    berry bush at PRONE_SPEED is a bot that has stopped playing.
  if (p.prone) { inp.fire = false; return; }

  // 5b. its bird is under attack: get to it. Rung 3 takes over on arrival -
  //     the bird is an anchor, so the archer standing off it is in sight.
  if (defend) {
    const d = Math.hypot(defend.x - p.x, defend.y - p.y);
    if (d > 80) { // home through its own lane, like a push
      if (aiToRoost(p, defend, steerTo, 3) >= 0) { aimAt(defend.x, defend.y); inp.fire = false; ai.tgt = null; return; }
    } else { inp.fire = false; ai.tgt = null; return; } // on station: wait for them to show
  }

  // 5b'. on guard: stand by its own bird, and go on down the ladder (working
  //      what is near) while it is within AI_GUARD_R of it. The bird is its
  //      anchor, so a rival standing off the roost is rung 3's the moment
  //      they show.
  if (guardE && Math.hypot(guardE.x - p.x, guardE.y - p.y) > AI_GUARD_R) {
    if (aiToRoost(p, guardE, steerTo, 4) >= 0) { aimAt(guardE.x, guardE.y); inp.fire = false; ai.tgt = null; return; }
  }

  // 5c. the objective: drive off the rival bird. A hunter holds AI_HOLD off
  //     it - outside the gust - and looses at the roost; a warrior walks up
  //     to a roost tile and swings E on it, gust and all, exactly as a hand
  //     does. Defenders in sight are rung 3's business (the bird anchors
  //     them). A roost it cannot route to is left for a while (pushCd).
  if (pushE) {
    const e = pushE;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    // the roost sits in the corner's forest at the end of its lane, and the
    // lane is the only way in: off it, the walk is aiToRoost's (gate, mouth,
    // lane); on it, the class decides the approach
    // the roost's gate carries turrets: any bot in the lane takes those down
    // first with E (STRUCT_HIT_DMG a swing), exactly as a hand would, since
    // a bot standing off the bird under bolt fire never gets a draw finished
    const tur = aiInLane(p, e) ? nearestObj(p.x, p.y, 4, (o) => { const st = structOf(o); return st.type === 'turret' && st.team === e.team && !st.building; }) : null;
    if (!aiInLane(p, e)) {
      if (aiToRoost(p, e, steerTo, 5) >= 0) { aimAt(e.x, e.y); inp.fire = false; ai.tgt = null; return; }
      ai.pushCd = 10;
    } else if (tur) {
      const st = structOf(tur), tx = st.tx * TILE + 8, ty = st.ty * TILE + 8;
      aimAt(tx, ty);
      const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
      if (Math.max(Math.abs(st.tx - ptx), Math.abs(st.ty - pty)) <= WORK_REACH) { inp.work = true; inp.fire = false; ai.tgt = null; return; }
      if (steerTo(tx, ty, WORK_REACH, AI_ROOST_BUDGET) >= 0) { inp.fire = false; ai.tgt = null; return; }
      ai.pushCd = 10;
    } else if (p.cls === 1) {
      const t = aiEagleTile(e, p);
      if (t) {
        const tx = t.tx * TILE + 8, ty = t.ty * TILE + 8;
        aimAt(tx, ty);
        const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
        if (Math.max(Math.abs(t.tx - ptx), Math.abs(t.ty - pty)) <= WORK_REACH) { inp.work = true; ai.tgt = null; return; }
        if (steerTo(tx, ty, WORK_REACH, AI_ROOST_BUDGET) >= 0) { ai.tgt = null; return; }
      }
      ai.pushCd = 10;
    } else {
      // the archer's station: AI_HOLD out from the bird ON THE LANE'S AXIS,
      // where the gate's gap leaves the line to the roost open (off the axis
      // its walls eat the shot), outside the gust
      const sx = e.x + e.laneDir.x * AI_HOLD, sy = e.y + e.laneDir.y * AI_HOLD;
      const ux = (e.x - p.x) / (d || 1), uy = (e.y - p.y) / (d || 1);
      aimAt(e.x, e.y - 8);
      // the roost tiles are solid, so the line is read to just short of them
      const clear = aiLineClear(p, e.x - ux * 40, e.y - uy * 40);
      const ds = Math.hypot(sx - p.x, sy - p.y);
      if (ds > 14) {
        if (steerTo(sx, sy, 0, AI_ROOST_BUDGET) < 0) { ai.pushCd = 10; }
        else { inp.fire = d < 170 && clear && p.chargeT < kitOf(p).bowCharge * prof.draw; ai.tgt = null; return; }
      } else {
        if (d < GUST_BLAST_R + 16) { inp.mx = -ux; inp.my = -uy; } // out of the gust's reach
        inp.fire = clear && p.chargeT < kitOf(p).bowCharge * prof.draw;
        ai.tgt = null;
        return;
      }
    }
  }

  // 5d. an ally's escort: with the human on the ground and within reach, it
  //     keeps AI_ESCORT of them - the two lowest allied slots, so the rest
  //     of the side still farms and builds. Inside that it goes on down the
  //     ladder, working what is near, and comes back when they walk off.
  if (ward && aiEscorts(p)) {
    const d = Math.hypot(ward.x - p.x, ward.y - p.y);
    if (d > AI_ESCORT && d < AI_ESCORT_R) {
      if (steerTo(ward.x, ward.y, 4) >= 0) { aimAt(ward.x, ward.y); inp.fire = false; ai.tgt = null; return; }
    }
  }

  // 6. meat is gold: chase and shoot the nearest animal, but give up on one
  //    it cannot catch in 6 s (prey outruns a walk) or cannot route to at all
  if (ai.huntAvoidT > 0) { ai.huntAvoidT -= dt; if (ai.huntAvoidT <= 0) ai.huntAvoid = null; }
  const prey = aiNearestAnimal(p);
  if (prey) {
    if (prey !== ai.huntTgt) { ai.huntTgt = prey; ai.huntT = 0; }
    ai.huntT += dt;
    const clear = aiLineClear(p, prey.x, prey.y - 3);
    const d = Math.hypot(prey.x - p.x, prey.y - p.y);
    const lost = ai.huntT > 6 || ((d > 55 || !clear) && steerTo(prey.x, prey.y) < 0);
    if (lost) {
      ai.huntAvoid = prey; ai.huntAvoidT = 15;
      ai.huntTgt = null; ai.huntT = 0;
    } else {
      aimAt(prey.x, prey.y - 3);
      inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.8;
      ai.tgt = null;
      return;
    }
  }
  inp.fire = false;

  // 7. loot on the ground is neutral and first-come: pick up what is close.
  let loot = null, ld = 72;
  for (const d of drops) {
    if (d.t < 0.35) continue;
    const dd = Math.hypot(d.x - p.x, d.y - p.y);
    if (dd < ld) { ld = dd; loot = d; }
  }
  if (loot && ai.lootT < 4) {
    ai.lootT += dt; aimAt(loot.x, loot.y);
    if (steerTo(loot.x, loot.y) < 0) ai.lootT = 4; // no way to it: let it lie
    return;
  }
  if (!loot) ai.lootT = 0;

  // 8. put the loot to work: bits into the tool being fired, a spare tool onto
  //    a free key (botFitLoadout, js/tools.js). On a slow timer because it is
  //    housekeeping, not a decision - nothing about the fight waits on it.
  ai.fitT -= dt;
  if (ai.fitT <= 0) { ai.fitT = 2.5; botFitLoadout(p); }

  // 9. spend the purse: gear first when the purse is fat enough to keep a
  //    building float (buyGear re-validates, so a stale order is harmless),
  //    then a stump to build on, then its own work to upgrade
  if (!inp.cmd) {
    let gi = -1, gc = 1e9;
    for (let i = 0; i < GEAR_SLOTS.length; i++) {
      const c = gearCost(p, i);
      if (c && c.gold < gc) { gc = c.gold; gi = i; }
    }
    if (gi >= 0 && p.inv.gold >= gc + 15) inp.cmd = { kind: 'gear', piece: gi };
  }
  const wantType = p.inv.gold >= STRUCTS.generator.tiers[0].cost.gold ? (rng() < 0.3 ? 'spawner' : 'generator') : null;
  if (ai.buildT <= 0 && wantType) {
    const st = nearestObj(p.x, p.y, 5, (o) => o.type === 'stump' && aiOpenSides(o.tx, o.ty) >= 3);
    if (st) {
      const sx = st.tx * TILE + 8, sy = st.ty * TILE + 8;
      const d = Math.hypot(sx - p.x, sy - p.y);
      if (d > 40) {
        // a site it cannot route to must not pin it there
        if (steerTo(sx, sy) < 0) { ai.buildT = 15; ai.spendT = 0; }
        return;
      }
      if (d > 16) { // clear of the site: order it
        ai.spendT = 0;
        inp.cmd = { kind: 'build', tx: st.tx, ty: st.ty, id: wantType };
        ai.buildT = 12;
        return;
      }
      // standing on the site: step off toward the openest neighbouring tile
      // (straight back can be a tree, and then the bot never gets to build)
      let bx = st.tx, by = st.ty, bs = -1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = st.tx + dx, ny = st.ty + dy;
        if (!inWorld(nx, ny) || isSolidTile(nx, ny) || ground[idx(nx, ny)] === 2) continue;
        const o2 = aiOpenSides(nx, ny);
        if (o2 > bs) { bs = o2; bx = nx; by = ny; }
      }
      steerTo((bx + 0.5) * TILE, (by + 0.5) * TILE);
      ai.spendT += dt;
      if (ai.spendT > 3) { ai.buildT = 15; ai.spendT = 0; } // wedged: go do something else
      return;
    }
  }
  if (ai.buildT <= 0) {
    const up = nearestObj(p.x, p.y, 3, (o) => STRUCTS[o.type] && !o.building &&
      o.team === p.team && o.tier < STRUCTS[o.type].tiers.length - 1 && canAfford(STRUCTS[o.type].tiers[o.tier + 1].cost, p));
    if (up) {
      inp.cmd = { kind: 'upgrade', tx: up.tx, ty: up.ty, id: 'upgrade' };
      ai.buildT = 10;
      return;
    }
    ai.buildT = 4; // nothing worth spending on nearby; look again shortly
  }

  // 10. harvest: walk to a tree/rock/berry bush/chest and hold E on it
  // (a stripped bush stops being work, so drop it the moment it empties)
  if (ai.tgt && (objects[idx(ai.tgt.tx, ai.tgt.ty)] !== ai.tgt ||
    (ai.tgt.type === 'bush' && ai.tgt.berries <= 0))) ai.tgt = null;
  ai.avoidT -= dt;
  if (ai.avoidT <= 0) ai.avoid = null;
  if (!ai.tgt && ai.thinkT <= 0) {
    ai.thinkT = 0.6;
    ai.tgt = nearestObj(p.x, p.y, AI_FORAGE, (o) => o !== ai.avoid &&
      (o.type === 'tree' || o.type === 'rock' || o.type === 'chest' ||
        (o.type === 'bush' && o.berries > 0)) &&
      aiOpenSides(o.tx, o.ty) >= 1);
  }
  if (ai.tgt) {
    const t = ai.tgt;
    aimAt(t.tx * TILE + 8, t.ty * TILE + 8);
    const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
    if (Math.max(Math.abs(t.tx - ptx), Math.abs(t.ty - pty)) <= WORK_REACH) {
      // the E key at the profile's duty cycle - a slow side rests between
      // swings, which is what sets how fast it levels
      inp.work = prof.work >= 1 || (state.tick % 120) < 120 * prof.work;
      return;
    }
    // route to any tile within WORK_REACH of it, whichever side is open;
    // one with no route (walled in, or pinned on the way) is left alone a while
    if (steerTo(t.tx * TILE + 8, t.ty * TILE + 8, WORK_REACH) < 0) {
      ai.avoid = t; ai.avoidT = 12;
      ai.tgt = null;
    }
    return;
  }

  // 11. nothing to do: roam between its camp and the middle of the map
  ai.roam -= dt;
  if (ai.roam <= 0) {
    ai.roam = rand(3, 7);
    const toward = rng() < 0.5 ? { x: cx * TILE, y: cy * TILE } :
      { x: (p.spawn.tx + 0.5) * TILE, y: (p.spawn.ty + 0.5) * TILE };
    ai.wx = toward.x + rand(-14, 14) * TILE;
    ai.wy = toward.y + rand(-14, 14) * TILE;
  }
  const rd = steerTo(ai.wx, ai.wy);
  if (rd < 20) ai.roam = 0; // arrived, or no route (a point in the treeline): pick another
  aimAt(p.x + inp.mx * 24, p.y + inp.my * 24);
}

