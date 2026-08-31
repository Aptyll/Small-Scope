'use strict';
// The bot brain: a priority ladder re-picked a few times a second, writing
// the same input struct a human fills - it can never do what a player cannot.
// ------------------------------------------------------------ ai
// Bot slots. A bot only ever writes the same input struct a human fills in -
// movement axis, aim point, fire / work / slide / dodge and the odd build
// order - so it can never do anything a player couldn't. The brain is a small
// priority ladder, re-picked a few times a second: eat, fight, wolves, hunt,
// loot, spend, harvest, roam. Every walk goes through steerTo(), which routes
// around obstacles (see pathfinding) and reports an unreachable goal as -1 -
// that, not a timer, is what makes a bot drop a target.
const AI_SIGHT = 150;   // px: how far a bot notices a rival
const AI_EAT_R = 110;   // px: a rival closer than this will knock the meal out of its hands, so it waits
const AI_HUNT = 120;    // px: how far it will go after an animal
const AI_FORAGE = 12;   // tiles: how far from itself it looks for work

function aiNearestEnemy(p) {
  let best = null, bd = AI_SIGHT;
  for (const q of players) {
    if (!enemyOf(p, q)) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    // seenAt is per-quarry, not per-bot: a rival buried in the snow (or wearing
    // GHOSTSTEP, which until now did nothing at all against a player) is picked
    // up from much closer, and one lying still is not picked up until it is
    // practically underfoot
    if (d < bd && d < seenAt(q, AI_SIGHT)) { bd = d; best = q; }
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

  // walk the route to (x, y) - reach 1 stops beside a tile it cannot stand
  // on, which is exactly WORK_REACH - and return the straight-line distance,
  // or -1 when there is no route (drop the goal, do not wait on it)
  const steerTo = (x, y, reach) => {
    const n = navTo(p, x, y, PLAYER_R, reach || 0, dt);
    if (!n.ok) return -1;
    inp.mx = n.dx; inp.my = n.dy;
    return n.d;
  };
  const aimAt = (x, y) => { inp.aimX = x; inp.aimY = y; };

  ai.thinkT -= dt;
  if (ai.buildT > 0) ai.buildT -= dt;
  if (ai.hideCd > 0) ai.hideCd -= dt;

  // 0. spend a free skill point before the ladder - waiting on it is leaving
  //    growth on the table. The point faces two pools now (the kit skills and
  //    the class-ability levels, both lowest-first); it feeds whichever pool
  //    is further behind, and a tie goes to the ability - the flashier half.
  if (p.skillPts > 0 && !inp.cmd) {
    let bs = -1, br = AB_RANK_MAX;
    for (let i = 0; i < AB_SKILL.length; i++) if (p.skill[i] < br) { br = p.skill[i]; bs = i; }
    let ba = -1, bl = AB_LV_MAX - 1;
    for (let i = 0; i < AB_KEYS; i++) if (p.abLv[i] - 1 < bl) { bl = p.abLv[i] - 1; ba = i; }
    if (ba >= 0 && (bs < 0 || bl <= br)) inp.cmd = { kind: 'ability', i: ba };
    else if (bs >= 0) inp.cmd = { kind: 'skill', i: bs };
  }

  // 1. food, exactly as a human eats it (Q / F) - but a meal is a 1.5 s
  //    channel now and a hit knocks it out of the hands (js/core.js), so a bot
  //    only starts one with nobody close enough to do that. Standing there
  //    chewing under fire is not patience, it is a free kill. `foe` is read
  //    here rather than at rung 2 because this rung is the first to need it.
  const foe = aiNearestEnemy(p);
  const foeD = foe ? Math.hypot(foe.x - p.x, foe.y - p.y) : Infinity;
  if (p.eatT <= 0 && p.foodCd <= 0 && foeD > AI_EAT_R) {
    if (p.hp < p.maxHp * 0.5 && bagCount(p, 'fish') > 0) inp.eatFish = true;
    else if (p.hp < p.maxHp * 0.8 && bagCount(p, 'berry') > 0) inp.eatBerry = true;
  }

  // 2. the burrow. Decided before the ladder because two rungs below read the
  //    answer: a bot that has come off worse and has nobody looking at it goes
  //    to ground and waits the fight out, and one that is already down shoots
  //    from where it lies - which earns it the same ambush multiplier a human
  //    gets, off the same ambushReady() check. It gets straight back up for a
  //    wolf, for a rival close enough to find it anyway, or when the spell
  //    runs out. It only ever tries where a player could: on snow, on its own
  //    feet, which is also what keeps it from planting itself on a river and
  //    standing there. `hideT` doubles as the give-up: a plant that will not
  //    take burns it four times as fast and ends in the lockout.
  const wolf = foe ? null : aiNearestWolf(p);
  if (p.prone) ai.hideT -= dt;
  const btx = Math.floor(p.x / TILE), bty = Math.floor((p.y + 4) / TILE);
  const canBury = !p.sliding && p.dodgeT <= 0 && inWorld(btx, bty) && ground[idx(btx, bty)] === 0;
  let down = p.prone;
  if (wolf) down = false;
  else if (foe) down = p.prone && Math.hypot(foe.x - p.x, foe.y - p.y) > 48;
  else if (p.prone) down = ai.hideT > 0 && p.hp < p.maxHp * 0.9;
  else if (p.hp < p.maxHp * 0.4 && ai.hideCd <= 0 && canBury) down = true;
  if (down !== p.prone) {
    inp.prone = true;                                 // the edge-triggered flag Ctrl sets
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

  // 3. a rival in sight: circle at bow range and shoot
  if (foe) {
    const d = foeD;
    aimAt(foe.x, foe.y - 6);
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
    if (p.castT <= 0 && p.rushT <= 0 && p.shieldT <= 0 && inp.ability < 0) {
      if (p.cls === 0) { // hunter: pin, tangle, reveal, rain
        if (p.abCd[3] <= 0 && d < 150 && clear) inp.ability = 3;      // volley on their feet
        else if (p.abCd[1] <= 0 && d < 110 && clear) inp.ability = 1; // net the gap
        else if (p.abCd[0] <= 0 && d < 90) inp.ability = 0;           // trap the ground between
        else if (p.abCd[2] <= 0) inp.ability = 2;                     // falcon down the line
      } else { // warrior: get there, and be unstoppable arriving
        if (p.abCd[3] <= 0 && d < 110) inp.ability = 3;               // juggernaut into the fight
        else if (p.abCd[1] <= 0 && d > 36 && d < 120 && clear) inp.ability = 1; // rush the line
        else if (p.abCd[2] <= 0 && d < 42) inp.ability = 2;           // stomp at arm's length
        else if (p.abCd[0] <= 0 && d < 150 && p.hp < p.maxHp * 0.75) inp.ability = 0; // shield the arrows
      }
    }
    const side = p.id % 2 ? 1 : -1;
    const a = Math.atan2(foe.y - p.y, foe.x - p.x);
    const turn = !clear || d > 85 ? 0.3 * side : d < 50 ? Math.PI * 0.85 * side : Math.PI / 2 * side;
    inp.mx = Math.cos(a + turn); inp.my = Math.sin(a + turn);
    inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.95; // draw, then loose near full
    if (p.hp < p.maxHp * 0.45 && p.dodgeCharges > 0 && rng() < dt * 2) inp.dodge = true;
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
  //    A bot short of arrows counts spent shafts as loot too, so the fields a
  //    firefight leaves behind get picked clean instead of lying there.
  let loot = null, ld = 72;
  for (const d of drops) {
    if (d.t < 0.35) continue;
    const dd = Math.hypot(d.x - p.x, d.y - p.y);
    if (dd < ld) { ld = dd; loot = d; }
  }
  if (p.quiver <= QUIVER_MAX / 2) for (const s of shafts) {
    if (s.t < SHAFT_ARM) continue;
    const dd = Math.hypot(s.x - p.x, s.y - p.y);
    if (dd < ld) { ld = dd; loot = s; }
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
  // a team with no living or rising Keep is one bad fight from permanent
  // elimination with no way back - a bot saves for and builds one before
  // anything else it would otherwise spend on
  const needKeep = !teamHasLivingKeep(p.team) &&
    !structures.some((o) => o.type === 'keep' && o.team === p.team && o.building);
  const wantType = needKeep ? (p.inv.gold >= STRUCTS.keep.tiers[0].cost.gold ? 'keep' : null)
    : p.inv.gold >= STRUCTS.generator.tiers[0].cost.gold ? (rng() < 0.3 ? 'spawner' : 'generator') : null;
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
    if (needKeep) ai.buildT = 4; // no stump nearby yet; keep saving, look again shortly
  }
  if (ai.buildT <= 0 && !needKeep) {
    const up = nearestObj(p.x, p.y, 3, (o) => STRUCTS[o.type] && !o.building &&
      o.team === p.team && o.tier < STRUCTS[o.type].tiers.length - 1 && canAfford(STRUCTS[o.type].tiers[o.tier + 1].cost, p));
    if (up) {
      inp.cmd = { kind: 'upgrade', tx: up.tx, ty: up.ty, id: 'upgrade' };
      ai.buildT = 10;
      return;
    }
    const kp = nearestObj(p.x, p.y, 3, (o) => o.type === 'keep' && !o.building && o.team === p.team &&
      o.craftT <= 0 && canAfford({ gold: STRUCTS.keep.tiers[o.tier].craftCost }, p));
    if (kp) {
      inp.cmd = { kind: 'craft', tx: kp.tx, ty: kp.ty, id: 'craft' };
      ai.buildT = 14;
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
      inp.work = true;
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

