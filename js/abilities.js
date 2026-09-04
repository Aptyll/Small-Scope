'use strict';
// The class abilities: keys 1-4, four unique actives per class, each with a
// cooldown, a cast the body visibly performs, and world entities of its own
// (a piercing shot, nets, a grapple line, a shield, a rush, a crater, a fury).
// Everything here runs per slot off p.input.ability, so a bot casts through
// exactly the key a human presses. Loaded after tools.js (it shares the
// world's fx helpers at runtime and nothing at load time - and it must draw
// no load-time rng(), or every seed reshuffles).
// ------------------------------------------------------------ class abilities

// ---- tuning --------------------------------------------------------------
const AB_KEYS = 4;          // keys 1-4
// ability levels: the hero's own growth, never the purse's. A key starts
// LOCKED at level 0 - the kit hands you the four actives, not the use of
// them - and every level costs ONE SKILL POINT, the only thing a point buys,
// one per hero level. The FIRST point on a key UNLOCKS it (that is the whole
// gate: level 1 casts, level 0 refuses); each one after shaves AB_LV_CD off
// that ability's cooldown - one lever, universally meaningful (more nets in
// the air, the wall up more often), read back through abCdOf so every
// cooldown-setting site scales alike. Four keys x AB_LV_MAX is 16 points
// against the 12 a capped hero earns, so no build has all of it: four keys
// open and shallow, or one capped and three dark, is the choice.
const AB_LV_MAX = 4;
const AB_LV_CD = 0.12;
// hunter
const PIERCE_WIND = 0.7;    // s the draw is LOCKED before the shot looses itself
const PIERCE_MUL = 1.5;     // over a fully drawn plain arrow's damage
const PIERCE_SPD = 380;     // px/s (a plain arrow flies 320)
const PIERCE_RANGE = 260;   // px of flight - the telegraph line draws this far
const PIERCE_SLOW = 0.15;   // walk multiplier while the draw is locked: commitment
const NET_SPD = 300;
const NET_RANGE = 130;
const NET_DMG = 4;
const NET_SLOW = 0.4;       // speed multiplier under the net...
const NET_SLOW_T = 2;       // ...for this long
const NET_KICK = 150;       // px/s of recoil the hunter takes backward
const GRAP_RANGE = 170;     // px a thrown hook can reach
const GRAP_ASSIST = 12;     // px either side of the aim ray a trunk still catches
const GRAP_REEL = 260;      // px/s of reel - over SLIDE_MIN, so a release carves
const GRAP_ARRIVE = 12;     // px from the anchor the line lets itself go
const GRAP_MAX_T = 1.5;     // s of reel before the hook slips (safety rail)
const GRAP_MISS_CD = 1;     // s a hook that caught nothing costs
// (snow cover has no numbers of its own: the burrow it opens is PRONE_*, js/actions.js)
// warrior
const SHIELD_T = 2.2;       // s the shield can be held up
const SHIELD_ARC = 0.35;    // cos-margin of the front arc that blocks
const RUSH_SPD = 300;
const RUSH_T = 0.42;        // s of charge (~4 tiles)
const RUSH_DMG = 10;
const RUSH_STUN = 0.6;
const RUSH_WALL_MUL = 1.6;  // driven into a tree/rock/wall: the slam is worse
const STOMP_R = 34;
const STOMP_DMG = 12;
const STOMP_KB = 170;       // px/s radial shove
const STOMP_STUN = 0.25;
const CRATER_R = 30;        // the deep-snow crater the stomp leaves...
const CRATER_T = 4;         // ...and how long it slows rivals crossing it
const CRATER_SLOW = 0.55;
const JUG_T = 5;            // s of juggernaut
const JUG_SPD = 0.5;        // extra speed ramped in over the duration
const JUG_MIN_SP = 90;      // px/s of body speed before contact hurts anyone
const JUG_STUN = 0.5;

// ---- the two kits --------------------------------------------------------
// One row per key. `use(p)` is the whole effect, fired when the cast lands -
// what an ability IS lives here, never in an `if` somewhere else. `cast` is
// the seconds the body spends performing it (the pose is abilityPose below).
const CLASS_AB = [
  [ // HUNTER - bow, distance control, the ground between
    {
      id: 'pierce', name: 'PIERCING SHOT', cd: 12, cast: PIERCE_WIND,
      blurb: 'LOCK A FULL DRAW, THEN LOOSE. THE SHOT GOES THROUGH EVERYONE ON THE LINE.',
      use: (p) => abPierce(p),
    },
    {
      id: 'net', name: 'NET SHOT', cd: 15, cast: 0.18,
      blurb: 'A WEIGHTED NET THAT TANGLES. THE RECOIL KICKS YOU BACKWARD.',
      use: (p) => abNetShot(p),
    },
    {
      id: 'grap', name: 'GRAPPLE', cd: 8, cast: 0.12,
      blurb: 'HOOK A TREE OR A ROCK. HOLD TO REEL IN, LET GO TO KEEP THE SPEED.',
      use: (p) => abGrapple(p),
    },
    {
      id: 'snow', name: 'SNOW COVER', cd: 60, cast: 0.22,
      blurb: 'LIE DOWN AND PULL THE SNOW OVER YOU. THE KEY AGAIN STANDS YOU UP.',
      use: (p) => abSnowCover(p),
      // the strip's active tell: how deep under the snow the body is
      acol: '#f4f7ff', activeF: (p) => (p.prone ? Math.max(0.15, p.hide) : 0),
    },
  ],
  [ // WARRIOR - close pressure, blocking, momentum
    {
      id: 'shield', name: 'SHIELD WALL', cd: 9, cast: 0.12,
      blurb: 'RAISE THE TOWER SHIELD. ARROWS FROM THE FRONT BREAK ON IT.',
      use: (p) => abShieldUp(p),
      // the strip's active tell: how much of the wall is left, and its colour
      acol: '#f2cc6a', activeF: (p) => (p.shieldT > 0 ? p.shieldT / SHIELD_T : 0),
    },
    {
      id: 'rush', name: 'BULL RUSH', cd: 12, cast: 0.2,
      blurb: 'CHARGE A LINE. THE FIRST RIVAL HIT IS CARRIED AND SLAMMED.',
      use: (p) => abRush(p),
    },
    {
      id: 'stomp', name: 'AVALANCHE STOMP', cd: 14, cast: 0.28,
      blurb: 'LEAP AND SLAM THE SNOW. THE CRATER SLOWS WHOEVER CROSSES IT.',
      use: (p) => abStomp(p),
    },
    {
      id: 'jug', name: 'JUGGERNAUT', cd: 20, cast: 0.3,
      blurb: 'NOTHING STOPS YOU. YOUR BODY BOWLS RIVALS OVER AS YOU RUN.',
      use: (p) => abJuggernaut(p),
      acol: '#e05a4a', activeF: (p) => (p.jugT > 0 ? p.jugT / JUG_T : 0),
    },
  ],
];

// the world the abilities put things into
const craters = [];  // {x, y, team, t}
const nets = [];     // {x, y, nx, ny, d, owner, team, spin}

// ---- levelling -----------------------------------------------------------
// Whether the key is bought at all (level 0 = locked: no cast, a dim well and
// a dim icon on the strip), can-buy or not (a point in hand, room on the
// key), the one entry point a buyer reaches through runCmd (HUD plate click
// and bots alike), and the effective cooldown the sim reads instead of the
// table's base. abUnlocked is the ONE gate - tryAbility and every bot that
// reaches for a key ask it, so a locked ability is dark for a slot whoever
// is driving it.
function abUnlocked(p, i) { return p.abLv[i] > 0; }
function abReady(p, i) { return p.abLv[i] > 0 && p.abCd[i] <= 0; } // bought AND off cooldown: what a bot reaches for
function abLvCanBuy(p, i) { return p.skillPts > 0 && p.abLv[i] < AB_LV_MAX; }
function abCdOf(p, i) { return CLASS_AB[p.cls][i].cd * (1 - AB_LV_CD * (Math.max(1, p.abLv[i]) - 1)); }
function buyAbilityLv(p, i) {
  if (!abLvCanBuy(p, i)) { if (p === player) SFX.deny(); return; }
  p.skillPts--;
  p.abLv[i]++;
  // the first point is the one that changes what you CAN do, so it says so;
  // every one after is a number going up
  const nm = CLASS_AB[p.cls][i].name;
  addFloater(p.x, p.y - 18, p.abLv[i] === 1 ? nm + ' UNLOCKED' : nm + ' ' + p.abLv[i], GEAR_MATS[p.abLv[i] - 1]);
  burst(p.x, p.y - 8, GEAR_MATS[p.abLv[i] - 1], p.abLv[i] === 1 ? 14 : 8, p.abLv[i] === 1 ? 55 : 40, 0.45);
  if (p === player) SFX.levelUp();
  else if (nearPlayer(p.x, p.y)) SFX.pickup();
}

// ---- casting -------------------------------------------------------------
// The press. Refused flat while the body is otherwise occupied; the shield's
// own key is the one toggle - pressing it again lowers the shield early - and
// snow cover's is the other: pressing it again stands the body up, free.
function tryAbility(p, i) {
  if (i < 0 || i >= AB_KEYS || p.dead || p.stunT > 0 || p.fallT > 0 ||
    p.dodgeT > 0 || p.rushT > 0 || p.grapT > 0 || p.castT > 0 || p.eatT > 0 || inAir(p)) return; // a meal occupies the hands the same way a cast does
  const ab = CLASS_AB[p.cls][i];
  if (!ab) return;
  // a key nobody has spent a point on is not yours yet: the dim well already
  // says so, and the press reddens it the way a bit that will not fit reddens
  // the tool well (abDenied, js/ui.js)
  if (!abUnlocked(p, i)) { if (p === player) abDenied(i); return; }
  if (ab.id === 'shield' && p.shieldT > 0) { abShieldDown(p, true); return; }
  if (ab.id === 'snow' && p.prone) { risePlayer(p); return; } // rising is free; only going under pays
  if (p.abCd[i] > 0) { if (p === player) SFX.deny(); return; }
  if (ab.id === 'rush' && p.rootT > 0) { if (p === player) SFX.deny(); return; } // pinned: nothing that moves you
  if (ab.id === 'snow') {
    // no snow underfoot is a flat no before the kneel even starts - the speed
    // check waits for the cast to land (tryProne, called by abSnowCover)
    const tx = Math.floor(p.x / TILE), ty = Math.floor((p.y + 4) / TILE);
    if (!inWorld(tx, ty) || ground[idx(tx, ty)] !== 0) { if (p === player) SFX.deny(); return; }
  }
  risePlayer(p); // a cast breaks cover the way the shot does
  if (p.charging) { p.charging = false; p.chargeT = 0; }
  p.fireArmed = false;
  p.castAb = i;
  p.castT = ab.cast;
  const dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else p.dir = dy > 0 ? 'down' : 'up';
  if (nearPlayer(p.x, p.y)) SFX.swing();
}

// per-slot tick: cooldowns, the cast landing, and every timed state an
// ability leaves on a body. Called from updatePlayer once the slot is alive.
function updateAbilities(p, dt) {
  for (let i = 0; i < AB_KEYS; i++) if (p.abCd[i] > 0) p.abCd[i] = Math.max(0, p.abCd[i] - dt);
  if (p.hopT > 0) p.hopT = Math.max(0, p.hopT - dt);
  // root / slow / net / mark / fire: the shared clock every kind of unit runs
  // (updateUnitStatus, js/actions.js) - an animal and a worker bot age the
  // identical states off the identical timers
  updateUnitStatus(p, dt);
  if (p.dead) return; // a burn can finish a slot mid-tick
  if (p.rootT > 0) p.sliding = false;
  // juggernaut: the body is the weapon while it moves. One bowl-over per
  // rival per activation, scaled by the speed actually carried into them.
  if (p.jugT > 0) {
    p.jugT = Math.max(0, p.jugT - dt);
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 40) {
      p.jugFxT -= dt;
      if (p.jugFxT <= 0) {
        p.jugFxT = 0.05;
        particles.push({
          x: p.x - p.vx / sp * 6 + rand(-2, 2), y: p.y - 2 + rand(-3, 3),
          vx: rand(-6, 6), vy: rand(-14, -6),
          life: rand(0.3, 0.5), maxLife: 0.4, color: Math.random() < 0.5 ? '#e05a4a' : '#f2937f',
          size: 1, grav: -6, alpha: 0.7,
        });
      }
    }
    if (sp > JUG_MIN_SP) {
      const nx = p.vx / sp, ny = p.vy / sp;
      // anything alive in the way, not only the rival slots: a body running
      // this hard bowls a deer or a worker over exactly as it does a player
      for (const q of unitsHit(p, p.x, p.y, PLAYER_R * 2 + 2)) {
        if (p.jugHit.includes(q)) continue;
        p.jugHit.push(q);
        const dmg = Math.max(3, Math.round(4 + sp * 0.04));
        hurtUnit(q, dmg, nx, ny, p, { kb: 140 });
        if (!q.dead) { stunUnit(q, JUG_STUN); q.kbx += nx * 140; q.kby += ny * 140; }
        burst(q.x, unitMidY(q), '#e05a4a', 8, 55, 0.5, true);
        if (p === player || q === player) state.shake = Math.max(state.shake, 3);
      }
    }
  }
  // the shield tracks the aim while it is up, and lowers itself on the timer
  if (p.shieldT > 0) {
    p.shieldT -= dt;
    p.shieldA = Math.atan2(p.input.aimY - (p.y - BOW_Y), p.input.aimX - p.x);
    const adx = Math.cos(p.shieldA), ady = Math.sin(p.shieldA);
    if (Math.abs(adx) > Math.abs(ady)) p.dir = adx > 0 ? 'right' : 'left';
    else p.dir = ady > 0 ? 'down' : 'up';
    if (p.charging) { p.charging = false; p.chargeT = 0; }
    p.fireArmed = false;
    if (p.shieldT <= 0) abShieldDown(p, false);
  }
  // the cast: a short performance, then the effect fires at the aim the
  // caster is holding NOW - a bot tracking its target casts like a hand does
  if (p.castT > 0) {
    p.castT -= dt;
    const ab = CLASS_AB[p.cls][p.castAb];
    // the locked draw keeps facing the aim the whole windup, so the telegraph
    // line and the body agree about where this is going
    if (ab && ab.id === 'pierce') {
      const dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
      if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
      else p.dir = dy > 0 ? 'down' : 'up';
    }
    if (p.castT <= 0) {
      const i = p.castAb;
      p.castAb = -1;
      p.castT = 0;
      p.abCd[i] = abCdOf(p, i);
      CLASS_AB[p.cls][i].use(p);
    }
  }
}

// every movement cap an ability is allowed to touch, in one multiplier: the
// root pins, a cast and a raised shield slow, a net drags, the juggernaut
// ramps. updatePlayer applies it to the walk cap and the ice cap alike.
function abilityMoveMul(p) {
  if (p.rootT > 0) return 0;
  let m = 1;
  // a cast halves the walk - except the locked draw, which all but plants the
  // feet: the pierce's cost is standing still where everyone can see the line
  if (p.castT > 0) {
    const ab = CLASS_AB[p.cls][p.castAb];
    m *= ab && ab.id === 'pierce' ? PIERCE_SLOW : 0.5;
  }
  if (p.shieldT > 0) m *= 0.4;
  if (p.slowT > 0) m *= p.slowMul;
  if (p.jugT > 0) m *= 1 + JUG_SPD * (1 - p.jugT / JUG_T);
  return m;
}

// ---- hunter: the four effects --------------------------------------------
// The windup was the telegraph; the loose is the payoff. One enhanced arrow,
// already at full draw, that goes THROUGH every body on the line instead of
// dying on the first - the pierce flag is read by the arrow loop (js/sim.js),
// which keeps the shot alive past a hit and remembers who it has already cut.
// The cue that the lock released is hard and unmissable: the nock snap, a
// white flash on the arrowhead, and the shot itself already gone.
function abPierce(p) {
  const kit = kitOf(p);
  const b = BITS.arrow;
  const dx = p.input.aimX - p.x, dy = p.input.aimY - (p.y - BOW_Y);
  const a = Math.atan2(dy, dx);
  // a fully drawn plain arrow's own damage math (emitBit at pw = 1, no
  // modifiers), then the pierce multiplier over the top
  const dmg = Math.round(((b.dmg + kit.dmgPow * 0.5) + kit.dmgBase + LVL_DMG * (p.level - 1)) * PIERCE_MUL);
  arrows.push({
    x: p.x, y: p.y - BOW_Y,
    vx: Math.cos(a) * PIERCE_SPD, vy: Math.sin(a) * PIERCE_SPD,
    t: 0, life: PIERCE_RANGE / PIERCE_SPD, dmg, pow: 1,
    owner: p.id, team: p.team, ambush: false, trailD: 0,
    bit: 'arrow', path: 'line', solid: true, ff: false,
    lit: 0, col: '#f4f7ff',
    pierce: true, pierceHit: [],
    ang: a, spd: PIERCE_SPD, ox: p.x, oy: p.y - BOW_Y,
  });
  // the snap: arrowhead flash at the bow, and the sound of the lock letting go
  burst(p.x + Math.cos(a) * 7, p.y - BOW_Y + Math.sin(a) * 7, '#f4f7ff', 8, 55, 0.3, true);
  burst(p.x + Math.cos(a) * 9, p.y - BOW_Y + Math.sin(a) * 9, '#ffd95c', 5, 45, 0.25, true);
  if (p === player) state.shake = Math.max(state.shake, 2);
  if (nearPlayer(p.x, p.y)) { SFX.nock(); SFX.arrow(); }
}

function abNetShot(p) {
  const dx = p.input.aimX - p.x, dy = p.input.aimY - (p.y - BOW_Y);
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  nets.push({ x: p.x, y: p.y - BOW_Y, nx, ny, d: 0, owner: p.id, team: p.team, spin: 0 });
  // the recoil: a real backward hop, animated on the body (p.hopT)
  p.vx -= nx * NET_KICK;
  p.vy -= ny * NET_KICK;
  p.hopT = 0.3;
  burst(p.x, p.y + 4, '#eef4fb', 4, 30, 0.3, true);
  if (nearPlayer(p.x, p.y)) SFX.arrow();
}

// The hook: thrown down the aim ray, it catches the first tree or rock near
// the line (GRAP_ASSIST px either side - the assist, so a trunk half a tile
// off the cursor still takes it) and starts the reel. The reel itself is a
// movement branch in updatePlayer, held as long as the key is held; grapEnd
// is every way it lets go, and where the cooldown starts - so a long ride and
// an instant release cost the same. A hook that catches nothing costs
// GRAP_MISS_CD instead of the full clock.
function abGrapple(p) {
  const dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  let ax = 0, ay = 0, found = false;
  for (let s = 12; s < GRAP_RANGE && !found; s += 6) {
    const sx = p.x + nx * s, sy = p.y + ny * s;
    const ctx2 = Math.floor(sx / TILE), cty = Math.floor(sy / TILE);
    for (let oy = -1; oy <= 1 && !found; oy++) for (let ox = -1; ox <= 1 && !found; ox++) {
      const tx = ctx2 + ox, ty = cty + oy;
      if (!inWorld(tx, ty)) continue;
      const o = objects[idx(tx, ty)];
      if (!o || (o.type !== 'tree' && o.type !== 'deadTree' && o.type !== 'rock')) continue;
      const cx2 = tx * TILE + 8, cy2 = ty * TILE + 8;
      // the assist: perpendicular distance of the trunk to the aim ray
      const along = (cx2 - p.x) * nx + (cy2 - p.y) * ny;
      if (along < 10 || along > GRAP_RANGE) continue;
      const perp = Math.abs((cx2 - p.x) * ny - (cy2 - p.y) * nx);
      if (perp > GRAP_ASSIST + 8) continue;
      ax = cx2; ay = cy2; found = true;
    }
  }
  if (!found) {
    // nothing to bite: the throw whiffs, and only a beat is paid for it
    const i = CLASS_AB[p.cls].findIndex((a) => a.id === 'grap');
    if (i >= 0) p.abCd[i] = GRAP_MISS_CD;
    burst(p.x + nx * 14, p.y + ny * 14, '#8b93a8', 3, 25, 0.25, true);
    if (p === player) SFX.deny();
    return;
  }
  p.grapX = ax; p.grapY = ay;
  p.grapT = GRAP_MAX_T;
  p.sliding = false;
  burst(ax, ay - 4, '#c8d2e4', 6, 40, 0.35, true);
  if (nearPlayer(p.x, p.y)) SFX.place();
}
// every way the line lets go: the key released, the anchor reached, a wall, a
// stun, the water, or the hook slipping on the safety timer. The momentum is
// KEPT - the reel speed rides out over SLIDE_MIN, so releasing into shift
// carves straight into a slide.
function grapEnd(p) {
  if (p.grapT <= 0) return;
  p.grapT = 0;
  const i = CLASS_AB[p.cls].findIndex((a) => a.id === 'grap');
  if (i >= 0) p.abCd[i] = abCdOf(p, i);
  burst(p.x, p.y - 2, '#c8d2e4', 4, 30, 0.3, true);
  if (nearPlayer(p.x, p.y)) SFX.pickup();
}

// Snow cover: the burrow, moved onto the kit. The whole state is still prone
// (tryProne/risePlayer and PRONE_*, js/actions.js) - this is just the one door
// in, and the 60 s clock is paid HERE, on the way under; every way back up is
// free. A kneel that lands somewhere the snow refuses (still moving, sliding)
// gives the clock back.
function abSnowCover(p) {
  tryProne(p);
  if (!p.prone) {
    const i = CLASS_AB[p.cls].findIndex((a) => a.id === 'snow');
    if (i >= 0) p.abCd[i] = 0; // the snow refused: nothing is paid
  }
}

// ---- warrior: the four effects -------------------------------------------
function abShieldUp(p) {
  p.shieldT = SHIELD_T;
  p.shieldA = Math.atan2(p.input.aimY - (p.y - BOW_Y), p.input.aimX - p.x);
  burst(p.x, p.y - 4, '#9aa3ad', 6, 35, 0.35, true);
  if (nearPlayer(p.x, p.y)) SFX.place();
}
// down early (the key again) or on the timer: the cooldown starts HERE, so
// holding the wall the full stretch and dropping it at once cost the same
function abShieldDown(p, early) {
  if (p.shieldT <= 0 && !early) return;
  p.shieldT = 0;
  const i = CLASS_AB[p.cls].findIndex((a) => a.id === 'shield');
  if (i >= 0) p.abCd[i] = abCdOf(p, i);
  if (nearPlayer(p.x, p.y)) SFX.pickup();
}
// an incoming shot dies on a raised shield when it flies INTO the front arc
function abShieldBlocks(t, nx, ny) {
  if (t.shieldT <= 0) return false;
  return nx * Math.cos(t.shieldA) + ny * Math.sin(t.shieldA) < -SHIELD_ARC;
}

function abRush(p) {
  const dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  p.rushNX = dx / d; p.rushNY = dy / d;
  p.rushT = RUSH_T;
  p.rushVictim = null;
  p.sliding = false;
  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else p.dir = dy > 0 ? 'down' : 'up';
  burst(p.x, p.y + 4, '#dfe8f4', 8, 45, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.dodge();
}
// one step of the charge, called from updatePlayer's movement branch with the
// wall verdict for this frame. The first rival in the path is grabbed and
// carried; the end of the line (or a wall) is where the slam happens.
function rushStep(p, mv, dt) {
  // plowed snow off the front
  p.rushFxT = (p.rushFxT || 0) - dt;
  if (p.rushFxT <= 0) {
    p.rushFxT = 0.04;
    burst(p.x + p.rushNX * 5, p.y + 4, '#eef4fb', 2, 30, 0.35, true);
  }
  // p.rushVictim is the BODY, whatever kind it is: the charge picks up a deer
  // or a worker bot the same way it picks up a rival, and slams it just as hard
  const v = p.rushVictim;
  if (!v) {
    for (const q of unitsHit(p, p.x, p.y, ROLL_HIT_R + PLAYER_R)) {
      p.rushVictim = q;
      if (q instanceof Player) risePlayer(q);
      stunUnit(q, 0.3); // manhandled: nothing they hold survives the grab
      burst(q.x, unitMidY(q), '#eef4fb', 6, 40, 0.4, true);
      if (nearPlayer(q.x, q.y)) SFX.hit();
      break;
    }
  } else if (unitAlive(v)) {
    // carried on the shoulder: held one body ahead, stun refreshed so their
    // own step stays limp until the slam
    stunUnit(v, 0.2);
    const wx = p.x + p.rushNX * 9, wy = p.y + p.rushNY * 9;
    moveEntity(v, wx - v.x, wy - v.y, unitRadius(v));
  } else {
    p.rushVictim = null; // it died on the way: the charge runs on empty
  }
  const wall = mv.blockedX || mv.blockedY;
  if (wall || p.rushT <= 0) rushEnd(p, wall);
}
function rushEnd(p, wall) {
  p.rushT = 0;
  const v = p.rushVictim;
  p.rushVictim = null;
  p.vx = p.rushNX * 60; p.vy = p.rushNY * 60;
  if (v && unitAlive(v)) {
    const mul = wall ? RUSH_WALL_MUL : 1;
    hurtUnit(v, Math.round(RUSH_DMG * mul), p.rushNX, p.rushNY, p, { kb: 110 * mul });
    if (!v.dead) stunUnit(v, RUSH_STUN * mul);
    burst(v.x, v.y - 5, '#e04a54', 8, 50, 0.5);
    burst(v.x, v.y - 4, '#eef4fb', 10, 55, 0.5, true);
    if (p === player || v === player) state.shake = Math.max(state.shake, wall ? 6 : 4);
    if (nearPlayer(v.x, v.y)) SFX.hit();
  } else if (wall) {
    p.vx = -p.rushNX * 40; p.vy = -p.rushNY * 40; // the thud, without a body to spend it on
    burst(p.x + p.rushNX * 6, p.y - 2, '#eef4fb', 8, 45, 0.45, true);
    if (p === player) state.shake = Math.max(state.shake, 3);
    if (nearPlayer(p.x, p.y)) SFX.hit();
  }
}

function abStomp(p) {
  const px = p.x, py = p.y;
  // one list, every living thing in the ring: slots, wildlife and worker bots
  // take the same damage, the same shove and the same beat of stun
  for (const q of unitsHit(p, px, py, STOMP_R)) {
    const d = Math.hypot(q.x - px, q.y - py) || 1;
    const nx = (q.x - px) / d, ny = (q.y - py) / d;
    hurtUnit(q, STOMP_DMG, nx, ny, p, { kb: STOMP_KB });
    if (!q.dead) { stunUnit(q, STOMP_STUN); q.kbx += nx * STOMP_KB; q.kby += ny * STOMP_KB; }
  }
  if (PRACTICE) abHitDummies(px, py, STOMP_R, STOMP_DMG);
  craters.push({ x: px, y: py + 3, team: p.team, t: 0 });
  // the shockwave: one ring of snow thrown outward
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    particles.push({
      x: px + Math.cos(a) * 6, y: py + 2 + Math.sin(a) * 4,
      vx: Math.cos(a) * 90, vy: Math.sin(a) * 55 - 15,
      life: 0.4, maxLife: 0.35, color: i % 3 ? '#eef4fb' : '#cfd8e8', size: i % 2 ? 2 : 1, grav: 60,
    });
  }
  if (p === player) state.shake = Math.max(state.shake, 5);
  if (nearPlayer(px, py)) SFX.break_();
}

function abJuggernaut(p) {
  p.jugT = JUG_T;
  p.jugHit.length = 0;
  p.jugFxT = 0;
  burst(p.x, p.y - 6, '#e05a4a', 10, 50, 0.5, true);
  burst(p.x, p.y - 8, '#f2937f', 6, 40, 0.45, true);
  if (p === player) state.shake = Math.max(state.shake, 3);
  if (nearPlayer(p.x, p.y)) SFX.hit();
}

// the practice dummy takes area hits like everything else: any dummy tile
// whose base is inside the circle rings the meter
function abHitDummies(x, y, r, dmg) {
  const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (!inWorld(tx, ty)) continue;
    const o = objects[idx(tx, ty)];
    if (o && o.type === 'dummy' && Math.hypot(tx * TILE + 8 - x, ty * TILE + 8 - y) <= r + 8) {
      hitDummy(o, dmg, tx * TILE + 8, ty * TILE - 4);
    }
  }
}

// ---- the world tick ------------------------------------------------------
// Everything the abilities left lying in the world, stepped once per sim
// step from updatePlay: craters drag, and nets fly their lines. (The piercing
// shot rides the arrows array, js/sim.js, and the grapple lives on its
// caster's body - neither leaves a thing behind to tick here.)

// Each of them is asked about through `sideOf` (js/actions.js), which hands
// unitsNear/unitsHit the side a thing in the world is on rather than a living
// caster. Everything those two return is fair game: slots, wildlife AND worker
// bots, none of them a special case.
// This is the other half: who to credit a kill to - the caster, if they are
// still standing. A trap that outlives its hunter kills for nobody.
function abCredit(w) { const o = players[w.owner]; return o && !o.dead ? o : null; }

function updateAbilityWorld(dt) {
  for (let i = craters.length - 1; i >= 0; i--) {
    const z = craters[i];
    z.t += dt;
    if (z.t > CRATER_T) { craters.splice(i, 1); continue; }
    // deep snow is deep snow for everything that has to cross it, refreshed
    // every step spent inside
    for (const q of unitsNear(sideOf(z), z.x, z.y - 4, CRATER_R)) slowUnit(q, 0.15, CRATER_SLOW);
  }
  for (let i = nets.length - 1; i >= 0; i--) {
    const n = nets[i];
    n.x += n.nx * NET_SPD * dt;
    n.y += n.ny * NET_SPD * dt;
    n.d += NET_SPD * dt;
    n.spin += dt * 14;
    let dead = n.d >= NET_RANGE;
    if (!dead && isSolidTile(Math.floor(n.x / TILE), Math.floor(n.y / TILE))) {
      burst(n.x, n.y, '#cfd8e8', 4, 30, 0.3, true);
      dead = true;
    }
    // the first body in the way tangles in it, whatever kind of body it is
    if (!dead) for (const q of unitsHit(sideOf(n), n.x, n.y + 6, 8)) {
      if (q instanceof Player && abShieldBlocks(q, n.nx, n.ny)) {
        burst(n.x, n.y, '#cfd8e8', 6, 40, 0.35, true); dead = true; break;
      }
      hurtUnit(q, NET_DMG, n.nx, n.ny, abCredit(n), { kb: 40 });
      if (!q.dead) netUnit(q, NET_SLOW_T, NET_SLOW); // the drape the slow is read off
      burst(q.x, unitMidY(q), '#cfd8e8', 8, 45, 0.4, true);
      dead = true;
      break;
    }
    if (dead) nets.splice(i, 1);
  }
}

// ---- drawing: the world layer --------------------------------------------
// Flat things on the snow, drawn before the drops and the entities: the
// pierce telegraph is as plainly visible as the shot will be, to BOTH sides -
// the game is readable first, sneaky second.
function drawAbilityGround(ex, ey, now) {
  // the piercing shot's ground telegraph: a thin line from every locked draw
  // out along its live aim, brightening as the loose gets near - it teaches
  // the caster what "through everyone on the line" means, and it gives
  // whoever is standing on it the whole windup to not be
  for (const p of players) {
    if (!p.active || p.dead || inAir(p) || p.castT <= 0) continue;
    const ab = CLASS_AB[p.cls][p.castAb];
    if (!ab || ab.id !== 'pierce') continue;
    const dx = p.input.aimX - p.x, dy = p.input.aimY - (p.y - BOW_Y);
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    const closing = 1 - p.castT / PIERCE_WIND; // 0 -> 1 over the windup
    let len = PIERCE_RANGE;
    for (let s = 10; s < PIERCE_RANGE; s += 4) {
      if (isSolidTile(Math.floor((p.x + nx * s) / TILE), Math.floor((p.y - BOW_Y + ny * s) / TILE))) { len = s; break; }
    }
    const march = (now * 60) % 4; // dashes crawl toward the loose
    for (let s = 10 + march; s < len; s += 4) {
      const px = Math.round(p.x + nx * s - ex), py = Math.round(p.y - BOW_Y + ny * s - ey);
      if (px < -2 || py < -2 || px > WV_W + 2 || py > WV_H + 2) continue;
      ctx.globalAlpha = 0.5 + 0.45 * closing;
      ctx.fillStyle = '#0a0e23';
      ctx.fillRect(px, py + 1, 1, 1);
      ctx.fillStyle = closing > 0.75 ? '#ffd95c' : '#e0637a';
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  for (const z of craters) {
    const px = Math.round(z.x - ex), py = Math.round(z.y - ey);
    if (px < -40 || py < -40 || px > WV_W + 40 || py > WV_H + 40) continue;
    const a = Math.max(0, 1 - z.t / CRATER_T);
    // dithered pressed-snow bowl: pixels thin out toward the rim
    for (let dy = -CRATER_R; dy <= CRATER_R; dy += 2) {
      for (let dx = -CRATER_R; dx <= CRATER_R; dx += 2) {
        const d = Math.hypot(dx, dy * 1.6);
        if (d > CRATER_R) continue;
        const h = hash2(z.x + dx, z.y + dy);
        if (h > 0.28 + 0.55 * (1 - d / CRATER_R)) continue;
        ctx.fillStyle = h < 0.18 ? 'rgba(118,144,186,' + (a * 0.5).toFixed(2) + ')'
          : 'rgba(160,182,214,' + (a * 0.4).toFixed(2) + ')';
        ctx.fillRect(px + dx, py + Math.round(dy * 0.62), 1, 1);
      }
    }
    // the rim: shoved-up snow, lit pale
    for (let i = 0; i < 14; i++) {
      const an = (i / 14) * Math.PI * 2 + 0.2;
      ctx.fillStyle = 'rgba(238,244,251,' + (a * 0.6).toFixed(2) + ')';
      ctx.fillRect(px + Math.round(Math.cos(an) * CRATER_R * 0.9), py + Math.round(Math.sin(an) * CRATER_R * 0.55), 2, 1);
    }
  }
}

// airborne ability bodies, drawn with the arrows: the net spinning open, and
// the grapple's taut rope between a reeling body and its anchor
function drawAbilityAir(ex, ey, now) {
  for (const p of players) {
    if (!p.active || p.dead || inAir(p) || p.grapT <= 0) continue;
    // the rope: dark-seated tan dots every couple of px from chest to anchor,
    // and the steel hook biting where it caught
    const x0 = p.x, y0 = p.y - 4;
    const dx = p.grapX - x0, dy = p.grapY - 4 - y0;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    for (let s = 3; s < d - 2; s += 2) {
      const px = Math.round(x0 + nx * s - ex), py = Math.round(y0 + ny * s - ey);
      if (px < -2 || py < -2 || px > WV_W + 2 || py > WV_H + 2) continue;
      ctx.fillStyle = '#0d1226';
      ctx.fillRect(px, py + 1, 1, 1);
      ctx.fillStyle = '#a89263';
      ctx.fillRect(px, py, 1, 1);
    }
    const hx = Math.round(p.grapX - ex), hy = Math.round(p.grapY - 4 - ey);
    ctx.fillStyle = '#0d1226';
    ctx.fillRect(hx - 2, hy - 1, 5, 3);
    ctx.fillStyle = '#c8d2e4';
    ctx.fillRect(hx - 1, hy - 1, 3, 1);
    ctx.fillRect(hx - 2, hy, 1, 2);
    ctx.fillRect(hx + 2, hy, 1, 2);
  }
  for (const n of nets) {
    const px = Math.round(n.x - ex), py = Math.round(n.y - ey);
    if (px < -12 || py < -12 || px > WV_W + 12 || py > WV_H + 12) continue;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(n.spin);
    ctx.fillStyle = '#0d1226';
    for (let k = -3; k <= 3; k += 3) { ctx.fillRect(k - 1, -4, 1, 8); ctx.fillRect(-4, k - 1, 8, 1); }
    ctx.fillStyle = '#cfd8e8';
    for (let k = -3; k <= 3; k += 3) { ctx.fillRect(k, -4, 1, 8); ctx.fillRect(-4, k, 8, 1); }
    ctx.fillStyle = '#8b93a8'; // the weights on the corners
    ctx.fillRect(-4, -4, 2, 2); ctx.fillRect(3, -4, 2, 2);
    ctx.fillRect(-4, 3, 2, 2); ctx.fillRect(3, 3, 2, 2);
    ctx.restore();
  }
}

// ---- drawing: on the body ------------------------------------------------
// The pose a cast (or the net shot's recoil hop, or the rush's lean) puts on
// the sprite itself: drawPlayer applies dx/dy/rot to the body draw, so every
// ability visibly happens TO the model, not just around it.
function abilityPose(p) {
  if (p.rushT > 0) {
    return { dx: 0, dy: -1, rot: 0.26 * (p.rushNX >= 0 ? 1 : -1) };
  }
  if (p.hopT > 0) {
    return { dx: 0, dy: -Math.round(4 * Math.sin(Math.PI * (1 - p.hopT / 0.3))), rot: 0 };
  }
  if (p.castT <= 0 || p.castAb < 0) return null;
  const ab = CLASS_AB[p.cls][p.castAb];
  const prog = 1 - p.castT / ab.cast;
  switch (ab.id) {
    // the locked draw: leant back off the aim, planted, and it does not move
    // again until the loose - the body itself is part of the telegraph
    case 'pierce': return { dx: p.dir === 'left' ? 1 : p.dir === 'right' ? -1 : 0, dy: 1, rot: 0 };
    case 'net': return { dx: p.dir === 'left' ? 1 : p.dir === 'right' ? -1 : 0, dy: 0, rot: 0 }; // braced back
    case 'grap': return { dx: 0, dy: -1, rot: 0.1 * (p.dir === 'left' ? -1 : 1) };  // arm slung forward
    case 'snow': return { dx: 0, dy: 2, rot: 0 };                                   // the kneel down
    case 'shield': return { dx: 0, dy: 1, rot: 0 };                                 // planted
    case 'rush': return { dx: 0, dy: 0, rot: 0.14 * (p.dir === 'left' ? -1 : 1) };  // head down
    case 'stomp': return { dx: 0, dy: -Math.round(6 * Math.sin(Math.PI * prog)), rot: 0 }; // the leap
    case 'jug': return { dx: 0, dy: prog < 0.5 ? 1 : -1, rot: 0 };                  // the chest-beat
  }
  return null;
}

// Everything a STATUS leaves on a body, drawn over whatever sprite is
// wearing it: the net drape, the sprung jaws at rooted feet, the flames, and
// the gold mark chevrons (root and mark currently have no caster in the
// game, but the tells stay with the universal status set - see Known drift,
// docs/dev/checklists.md). Takes the sprite's
// own box, so a rabbit, a worker bot
// and a player slot wear the same four tells at their own size - a state you
// cannot see is a rule you cannot play around, and that is as true of a deer
// as of a rival. Called by drawAbilityOnPlayer below and by drawAnimal /
// drawBird / drawRobot (js/draw-world.js).
function drawUnitStates(e, px, py, w, h, now) {
  if (e.netT > 0) {
    ctx.globalAlpha = Math.min(1, e.netT / 0.4);
    ctx.fillStyle = '#cfd8e8';
    // a 3px mesh inside the sprite's own box, however big that box is
    for (let x = 3; x < w - 2; x += 3) ctx.fillRect(px + x, py + 3, 1, h - 5);
    for (let y = 4; y < h - 2; y += 3) ctx.fillRect(px + 3, py + y, w - 6, 1);
    ctx.fillStyle = '#8b93a8';
    ctx.fillRect(px + 3, py + h - 3, w - 6, 1); // the sag at the hem
    ctx.globalAlpha = 1;
  }
  if (e.rootT > 0) {
    // the sprung jaws, closed on the feet
    ctx.fillStyle = '#3c4356';
    ctx.fillRect(px + 4, py + h - 2, w - 8, 2);
    ctx.fillStyle = '#c8d2e4';
    for (let k = 0; k * 2 + 5 < w - 4; k++) ctx.fillRect(px + 5 + k * 2, py + h - 3, 1, 1);
  }
  if (e.burnT > 0) {
    // Alight: tongues licking UP off the crown, and the snow under the feet
    // lit by them - never a wash over the body, because a burning rival still
    // has to read as the rival it is. Phased off the body's own burn clock, so
    // two burning things are never in lockstep and no global clock is involved.
    const ph = e.burnT * 9;
    const n = Math.max(2, Math.min(4, w >> 2));
    for (let k = 0; k < n; k++) {
      const fx = px + 1 + Math.round((w - 3) * ((k + 0.5) / n));
      const lift = 2 + Math.round(2.2 * (1 + Math.sin(ph + k * 2.1)));
      ctx.fillStyle = '#e0533a';
      ctx.fillRect(fx, py - lift, 2, lift + 1);
      ctx.fillStyle = '#ff9440';
      ctx.fillRect(fx, py - lift + 1, 1, lift);
      ctx.fillStyle = '#ffd95c';
      ctx.fillRect(fx, py - lift, 1, 1);
    }
    ctx.globalAlpha = 0.45 + 0.2 * Math.sin(ph * 1.7);
    ctx.fillStyle = '#ff9440';
    ctx.fillRect(px + 2, py + h - 1, w - 4, 1);
    ctx.globalAlpha = 1;
  }
  if (e.markT > 0) {
    // the mark: gold chevrons falling toward the head, for everyone
    const ph = (now * 2.2) % 1;
    ctx.globalAlpha = e.markT < 0.6 ? e.markT / 0.6 : 1;
    const mx = px + (w >> 1) - 3;
    for (let k = 0; k < 2; k++) {
      const y = py - 8 - 5 * k + Math.round(ph * 4);
      ctx.fillStyle = '#0f1632';
      ctx.fillRect(mx, y + 1, 6, 2);
      ctx.fillStyle = '#f2cc6a';
      ctx.fillRect(mx, y, 2, 2); ctx.fillRect(mx + 4, y, 2, 2); ctx.fillRect(mx + 2, y + 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
}

// The player's own layer: the two states only a slot can be in - a raised
// shield and the juggernaut's fury - over the four every unit shares.
function drawAbilityOnPlayer(p, px, py, now) {
  if (p.shieldT > 0) {
    const a = p.shieldA;
    ctx.save();
    ctx.translate(px + 8 + Math.round(Math.cos(a) * 7), py + 8 + Math.round(Math.sin(a) * 5));
    ctx.rotate(a);
    ctx.fillStyle = '#242a3a';
    ctx.fillRect(-1, -7, 4, 14);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(-1, -6, 3, 12);
    ctx.fillStyle = '#c8d2e4';
    ctx.fillRect(-1, -6, 1, 12);
    ctx.fillStyle = TEAMS[skin(p.team)].mark; // the trim carries the side
    ctx.fillRect(0, -2, 1, 4);
    ctx.restore();
  }
  if (p.jugT > 0) {
    // fury: a red rim pulsing off the sprite's own silhouette
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(now * 10);
    ctx.fillStyle = '#e05a4a';
    ctx.fillRect(px + 3, py + 1, 10, 1);
    ctx.fillRect(px + 2, py + 4, 1, 8);
    ctx.fillRect(px + 13, py + 4, 1, 8);
    ctx.globalAlpha = 1;
  }
  drawUnitStates(p, px, py, 16, 16, now);
}

// ---- the strip icons -----------------------------------------------------
// The eight ability icons: detailed 32x32 char grids in the sprite system's
// grammar (sprites.md - new sprites bake beside the code that draws them),
// AB32[cls][key] in CLASS_AB's own order, baked lazily onto their own
// canvases. Drawn by the strip's ability wells and the ability tooltip
// (drawClassAbCell / tipClassAb, js/ui.js). Each icon repeats the ability's
// in-world look - the pierce's gold line, the net's corner weights, the
// grapple's sagging rope - so the well and the snow speak the same picture.
const AB32_PAL = {
  o: '#141a2c', k: '#0f1632',
  W: '#f4f7ff', b: '#cfe0f2', B: '#9fb6d8',
  C: '#c8d2e4', s: '#8b93a8', S: '#5f6f96', D: '#3c4356',
  t: '#e8dcb4', d: '#a89263', w: '#a8794a', u: '#6e4a28',
  g: '#f2cc6a', G: '#b98a2e',
  r: '#e05a4a', R: '#a03428', p: '#f2937f',
  H: '#d9ad72', h: '#8a6d50', n: '#5c4a38',
  E: '#cfd8e8', e: '#8b93a8',
};
const AB32 = [
  [ // HUNTER
    [ // PIERCING SHOT: the shaft already loosed down the thin gold telegraph
      // line, the flash still on the arrowhead
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '..b.............................',
      '......rr....................g...',
      '......rrrr....................W.',
      '.bbb...rrrr....................g',
      '.....ooooooooooooooooooooooooo..',
      '.....ottttttttttttttttsssSSWWo.W',
      'g.g.goddddddddddddddddsssSSWWg.g',
      '.....ooooooooooooooooooooooooo.W',
      '.bbb...rrrr....................g',
      '......rrrr....................W.',
      '......rr....................g...',
      '..b.............................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // NET SHOT: the weighted net mid-flight - the rope weave bright on the
      // throw lines, and the four steel corner weights the air sprite wears
      '................................',
      '................................',
      '................................',
      '.....ooo.................ooo....',
      '....osCso...............osCso...',
      '....osCsoEWEEEWEEEWEEEWEosCso...',
      '....osSso...............osSso...',
      '.....ooo..e...e...e...e..ooo....',
      '......e...e...e...e...e...e.....',
      '......WeeeWeeeWeeeWeeeWeeeW.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......WeeeWeeeWeeeWeeeWeeeW.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......WeeeWeeeWeeeWeeeWeeeW.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......WeeeWeeeWeeeWeeeWeeeW.....',
      '......e...e...e...e...e...e.....',
      '.....ooo..e...e...e...e..ooo....',
      '....osCso.e...e...e...e.osCso...',
      '....osCsoEWEEEWEEEWEEEWEosCso...',
      '....osSso...............osSso...',
      '.....ooo.................ooo....',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // GRAPPLE: the steel hook bitten into a trunk top-right, the rope
      // sagging home toward the reeling hand
      '......................oooooooooo',
      '......................ouwwwwwwww',
      '......................ouwwwwwwuw',
      '......................ouwwuwwwww',
      '......................ouwwwwwwww',
      '......................ouwwwwwuww',
      '......................ouwwwwwwww',
      '......................ouwwwwwwww',
      '......................Cuwuwwwwww',
      '......................oCswwwwwww',
      '.....................oCuwwwwuwww',
      '....................oCsuwwwwwwww',
      '...................oCsCCswwuwwww',
      '...................d..oooooooooo',
      '..................dk............',
      '..................d.............',
      '.................dk.............',
      '................dk..............',
      '................d...............',
      '...............dk...............',
      '..............dk................',
      '..............d.................',
      '.............dk.................',
      '............dk..................',
      '...........dk...................',
      '.........ddk....................',
      '........ddk.....................',
      '..b..dddkk......................',
      '....ddkk........................',
      '....kk..........................',
      '.b...b..........................',
      '................................',
    ],
    [ // SNOW COVER: the mound holding perfectly still, and the breath in the
      // cold air that is the one tell it still gives
      '................................',
      '................................',
      '................................',
      '................................',
      '........W.................W.....',
      '.........................bb.....',
      '................................',
      '................................',
      '....b...........................',
      '......................bWb.......',
      '......................bbB.......',
      '................................',
      '................................',
      '......W.............bW..........',
      '....................bb..........',
      '............................b...',
      '................................',
      '...........oWWWWWWWo............',
      '........oWWWWWWWWWWWWWo.........',
      '......oWWWWWWWWWWWWWWWWWo.......',
      '.....obbbbbbbbBBbbbbbbbbbo......',
      '.....obbbbbbbbbbbbbbbbbbbo......',
      '....obbbbbbbbbbbbbbbbbbbbbo.....',
      '.....obbbbbbbbbbbbbbbbbbbo......',
      '.....oBBBBBBBBBBBBBBBBBBBo......',
      '......oBBBBBBBBBBBBBBBBBo.......',
      '........oBBBBBBBBBBBBBo.........',
      '...........ooooooooo............',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
  ],
  [ // WARRIOR
    [ // SHIELD WALL: the tower shield face-on - bright left edge, gold band
      // and boss, riveted corners
      '................................',
      '................................',
      '................................',
      '.........oooooooooooooo.........',
      '.........oCssssggssssSo.........',
      '.........oCksssggssskSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssogggGossSo.........',
      '.........oCssogWgGossSo.........',
      '.........oCssoggGGossSo.........',
      '.........oCssoooooossSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCksssggssskSo.........',
      '.........oCssssggssssSo.........',
      '..........oCsssggsssSo..........',
      '...........oCssggssSo...........',
      '.............oCggSo.............',
      '...............oo...............',
      '................................',
      '................................',
    ],
    [ // BULL RUSH: the warrior mid-charge - head tucked, the big pauldron
      // leading, gauntlet up, legs driving, speed lines and plowed snow
      '................................',
      '................................',
      '................................',
      '................................',
      '.....................oooooo.....',
      '....................oCssssso....',
      '...................oCsssssso....',
      '...................oCskkkkso....',
      '...................oCsssssso....',
      '..............oooooossssoo......',
      '.............oCCCCCCssssso......',
      '..bbb........oCCCCssssssso......',
      '..bbb.......oCCssssssssSSo......',
      '............oCsssssssssSSo......',
      '............ossssssssssSSo......',
      '...........orrssssssssSSo.......',
      '.bbb......orrrsssssssoCWCo......',
      '..........orrrsssssssoCCCo......',
      '..........orrrrssssssooooo......',
      '..........orrrrrsssssoo.........',
      '.........orrrrrrrrroo...........',
      '........oDDDo.oDDDo.............',
      '.bb....oDDDo...oDDDo............',
      '......oDDDo.....oDDo............',
      '.....oDDDo......oDDDoo..........',
      '....oDDDDo......oDDDDDo.........',
      '....oooooo......ooooooo.........',
      '...bb............bWb..bb........',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // AVALANCHE STOMP: the boot coming down, the shock chevrons and thrown
      // snow already leaving the point of impact
      '................................',
      '................................',
      '.........oooooooo...............',
      '........oWWWWWWWWo..............',
      '........obbWWWWbbo..............',
      '........oooooooooo..............',
      '.........owwwwwwuo..............',
      '.........owwwwwwuo..............',
      '.........owwgwwwuo..............',
      '.........owwwwwwuo..............',
      '.........owwwwwwuo..............',
      '.........owwwwwwuo..............',
      '.........owwwwwwuoo.............',
      '.........owwwwwwwuooo...........',
      '.........owwwwwwwwwuooo.........',
      '.........owwwwwwwwwwwuoo........',
      '.........owwwwwwwwwwwwwuo.......',
      '........oDDDDDDDDDDDDDDDDo......',
      '........oDkDDkDDkDDkDDkDDo......',
      '........oooooooooooooooooo......',
      '..........WW...WW...WW..........',
      '........WW.....WW.....WW........',
      '......bb.......bb.......bb......',
      '....bb.........BB.........bb....',
      '.........WW.........WW..........',
      '.....W.......b....b.......W.....',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // JUGGERNAUT: the great helm wreathed in fury - the eye slit burning,
      // embers off the crown
      '................................',
      '.............r....r.............',
      '..........r...rr...r............',
      '...........oooooooooo...........',
      '..........oSSSSSSSSSSo..........',
      '.........oSssssssssssSo.........',
      '........oSsssCCCCsssssSo........',
      '........oSssssCCssssssSo........',
      '....r...oSssssCCssssssSo...r....',
      '........oSssssCCssssssSo........',
      '........oSssssCCssssssSo........',
      '........oSssssCCssssssSo........',
      '........oSokrrrpprrrkoSo........',
      '........oSokrrrrrrrrkoSo........',
      '........oSooooooooooooSo........',
      '...r....oSssssssssssssSo....r...',
      '........oSssssssssssssSo........',
      '........oSssssssssssssSo........',
      '........oSssksskssksssSo........',
      '........oSssksskssksssSo........',
      '........oSssssssssssssSo........',
      '.........oSssssssssssSo.........',
      '..........oSssssssssSo..........',
      '...........oSSSSSSSSo...........',
      '............oooooooo............',
      '......r.................r.......',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
  ],
];
const ab32Cache = new Map();
// the baked 32x32 icon for class ability (cls, i)
function classAbIcon(cls, i) {
  const key = cls + ':' + i;
  let cv = ab32Cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const g = cv.getContext('2d');
    const rows = AB32[cls][i];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const col = AB32_PAL[row[c]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(c, r, 1, 1);
      }
    }
    ab32Cache.set(key, cv);
  }
  return cv;
}
