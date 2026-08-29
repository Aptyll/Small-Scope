'use strict';
// The class abilities: keys 1-4, four unique actives per class, each with a
// cooldown, a cast the body visibly performs, and world entities of its own
// (traps, nets, a falcon, a volley, a shield, a rush, a crater, a fury).
// Everything here runs per slot off p.input.ability, so a bot casts through
// exactly the key a human presses. Loaded after tools.js (it shares the
// world's fx helpers at runtime and nothing at load time - and it must draw
// no load-time rng(), or every seed reshuffles).
// ------------------------------------------------------------ class abilities

// ---- tuning --------------------------------------------------------------
const AB_KEYS = 4;          // keys 1-4
// hunter
const TRAP_RANGE = 44;      // px from the feet a trap can be set
const TRAP_ARM = 1.0;       // s before a fresh trap bites
const TRAP_LIFE = 25;       // s a set trap waits before rusting away
const TRAP_R = 9;           // px: step this close and it goes
const TRAP_DMG = 8;
const TRAP_ROOT = 1.2;      // s the victim is pinned
const TRAP_MAX = 2;         // per owner; a third replaces the oldest
const NET_SPD = 300;
const NET_RANGE = 130;
const NET_DMG = 4;
const NET_SLOW = 0.4;       // speed multiplier under the net...
const NET_SLOW_T = 2;       // ...for this long
const NET_KICK = 150;       // px/s of recoil the hunter takes backward
const FALCON_SPD = 240;
const FALCON_RANGE = 340;
const MARK_T = 4;           // s a swept rival stays revealed
const VOLLEY_RANGE = 150;   // px from the feet the circle can be called
const VOLLEY_R = 26;        // px radius of the strike
const VOLLEY_T = 0.8;       // s of telegraph before the arrows land
const VOLLEY_DMG = 14;
const VOLLEY_SHAFTS = 3;    // plain shafts the rain leaves for anyone
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
  [ // HUNTER - bow, traps, distance control
    {
      id: 'trap', name: 'SNARE TRAP', cd: 10, cast: 0.32,
      blurb: 'SET AN IRON JAW IN THE SNOW. IT BITES THE FIRST RIVAL ON IT.',
      use: (p) => abSetTrap(p),
    },
    {
      id: 'net', name: 'NET SHOT', cd: 11, cast: 0.18,
      blurb: 'A WEIGHTED NET THAT TANGLES. THE RECOIL KICKS YOU BACKWARD.',
      use: (p) => abNetShot(p),
    },
    {
      id: 'falcon', name: 'FALCON SWEEP', cd: 18, cast: 0.28,
      blurb: 'SEND THE BIRD DOWN A LINE. RIVALS UNDER IT ARE REVEALED.',
      use: (p) => abFalcon(p),
    },
    {
      id: 'volley', name: 'VOLLEY', cd: 16, cast: 0.35,
      blurb: 'CALL A RAIN OF ARROWS ON A CIRCLE. SOME STICK FOR ANYONE.',
      use: (p) => abVolley(p),
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
const traps = [];    // {x, y, owner, team, t}
const craters = [];  // {x, y, team, t}
const falcons = [];  // {x, y, nx, ny, d, owner, team, seen:[]}
const nets = [];     // {x, y, nx, ny, d, owner, team, spin}
const volleys = [];  // {x, y, owner, team, t}
const volleyFx = []; // falling shafts, visual only: {x, y, delay, t}

// ---- casting -------------------------------------------------------------
// The press. Refused flat while the body is otherwise occupied; the shield's
// own key is the one toggle - pressing it again lowers the shield early.
function tryAbility(p, i) {
  if (i < 0 || i >= AB_KEYS || p.dead || p.stunT > 0 || p.fallT > 0 ||
    p.dodgeT > 0 || p.rushT > 0 || p.castT > 0 || p.eatT > 0 || inAir(p)) return; // a meal occupies the hands the same way a cast does
  const ab = CLASS_AB[p.cls][i];
  if (!ab) return;
  if (ab.id === 'shield' && p.shieldT > 0) { abShieldDown(p, true); return; }
  if (p.abCd[i] > 0) { if (p === player) SFX.deny(); return; }
  if (ab.id === 'rush' && p.rootT > 0) { if (p === player) SFX.deny(); return; } // pinned: nothing that moves you
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
  if (p.markT > 0) p.markT = Math.max(0, p.markT - dt);
  if (p.netT > 0) p.netT = Math.max(0, p.netT - dt);
  if (p.hopT > 0) p.hopT = Math.max(0, p.hopT - dt);
  if (p.slowT > 0) p.slowT = Math.max(0, p.slowT - dt);
  else p.slowMul = 1;
  if (p.rootT > 0) {
    p.rootT = Math.max(0, p.rootT - dt);
    p.sliding = false;
  }
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
      for (const q of players) {
        if (!enemyOf(p, q) || q.invuln > 0 || p.jugHit.includes(q.id)) continue;
        if (Math.hypot(q.x - p.x, q.y - p.y) > PLAYER_R * 2 + 2) continue;
        p.jugHit.push(q.id);
        const dmg = Math.max(3, Math.round(4 + sp * 0.04));
        damagePlayer(q, dmg, nx, ny, p);
        if (!q.dead) { stunUnit(q, JUG_STUN); q.kbx += nx * 140; q.kby += ny * 140; }
        burst(q.x, q.y - 6, '#e05a4a', 8, 55, 0.5, true);
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
    if (ab && ab.id === 'trap' && Math.random() < dt * 30) {
      burst(p.x + rand(-4, 4), p.y + 5, '#eef4fb', 1, 18, 0.3, true); // kneeling, digging the set in
    }
    if (p.castT <= 0) {
      const i = p.castAb;
      p.castAb = -1;
      p.castT = 0;
      p.abCd[i] = CLASS_AB[p.cls][i].cd;
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
  if (p.castT > 0) m *= 0.5;
  if (p.shieldT > 0) m *= 0.4;
  if (p.slowT > 0) m *= p.slowMul;
  if (p.jugT > 0) m *= 1 + JUG_SPD * (1 - p.jugT / JUG_T);
  return m;
}

// ---- hunter: the four effects --------------------------------------------
function abSetTrap(p) {
  // at the aim, clamped to arm's reach, snapped to the tile - a trap is a
  // TILE fact, plainly visible to both sides: the play is around it, not
  // under it. Somewhere a trap cannot sit (a wall, open water) sets at the
  // feet instead.
  let dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const r = Math.min(TRAP_RANGE, d);
  let tx = Math.floor((p.x + dx / d * r) / TILE), ty = Math.floor((p.y + dy / d * r) / TILE);
  if (!inWorld(tx, ty) || isSolidTile(tx, ty) || ground[idx(tx, ty)] === 2) {
    tx = Math.floor(p.x / TILE); ty = Math.floor((p.y + 4) / TILE);
    if (!inWorld(tx, ty) || isSolidTile(tx, ty) || ground[idx(tx, ty)] === 2) { if (p === player) SFX.deny(); return; }
  }
  // the cap: a third trap springs the oldest still out
  const mine = traps.filter((t) => t.owner === p.id);
  if (mine.length >= TRAP_MAX) {
    const old = mine[0];
    burst(old.x, old.y, '#8b93a8', 5, 30, 0.3, true);
    traps.splice(traps.indexOf(old), 1);
  }
  traps.push({ x: tx * TILE + 8, y: ty * TILE + 8, owner: p.id, team: p.team, t: 0 });
  if (nearPlayer(p.x, p.y)) SFX.place();
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

function abFalcon(p) {
  const dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  falcons.push({ x: p.x, y: p.y - 10, nx: dx / d, ny: dy / d, d: 0, owner: p.id, team: p.team, seen: [], t: 0 });
  burst(p.x, p.y - 12, '#d9ad72', 5, 35, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.rise();
}

function abVolley(p) {
  let dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const r = Math.min(VOLLEY_RANGE, d);
  const x = p.x + dx / d * r, y = p.y + dy / d * r;
  volleys.push({ x, y, owner: p.id, team: p.team, t: VOLLEY_T });
  // the rain, staged now so the fall is already stacked when the ring closes
  for (let i = 0; i < 8; i++) {
    volleyFx.push({
      x: x + rand(-VOLLEY_R + 4, VOLLEY_R - 4), y: y + rand(-VOLLEY_R + 6, VOLLEY_R - 6),
      delay: VOLLEY_T + i * 0.03, t: 0,
    });
  }
  if (nearPlayer(p.x, p.y)) SFX.arrow();
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
  if (i >= 0) p.abCd[i] = CLASS_AB[p.cls][i].cd;
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
  p.rushVictim = -1;
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
  const v = p.rushVictim >= 0 ? players[p.rushVictim] : null;
  if (!v) {
    for (const q of players) {
      if (!enemyOf(p, q) || q.invuln > 0) continue;
      if (Math.hypot(q.x - p.x, q.y - p.y) > ROLL_HIT_R + PLAYER_R) continue;
      p.rushVictim = q.id;
      risePlayer(q);
      stunUnit(q, 0.3); // manhandled: nothing they hold survives the grab
      burst(q.x, q.y - 6, '#eef4fb', 6, 40, 0.4, true);
      if (nearPlayer(q.x, q.y)) SFX.hit();
      break;
    }
  } else if (!v.dead) {
    // carried on the shoulder: held one body ahead, stun refreshed so their
    // own step stays limp until the slam
    stunUnit(v, 0.2);
    const wx = p.x + p.rushNX * 9, wy = p.y + p.rushNY * 9;
    moveEntity(v, wx - v.x, wy - v.y, PLAYER_R);
  }
  const wall = mv.blockedX || mv.blockedY;
  if (wall || p.rushT <= 0) rushEnd(p, wall);
}
function rushEnd(p, wall) {
  p.rushT = 0;
  const v = p.rushVictim >= 0 ? players[p.rushVictim] : null;
  p.rushVictim = -1;
  p.vx = p.rushNX * 60; p.vy = p.rushNY * 60;
  if (v && !v.dead) {
    const mul = wall ? RUSH_WALL_MUL : 1;
    damagePlayer(v, Math.round(RUSH_DMG * mul), p.rushNX, p.rushNY, p);
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
  for (const q of players) {
    if (!enemyOf(p, q) || q.invuln > 0) continue;
    const d = Math.hypot(q.x - px, q.y - py);
    if (d > STOMP_R) continue;
    const nx = (q.x - px) / (d || 1), ny = (q.y - py) / (d || 1);
    damagePlayer(q, STOMP_DMG, nx, ny, p);
    if (!q.dead) { stunUnit(q, STOMP_STUN); q.kbx += nx * STOMP_KB; q.kby += ny * STOMP_KB; }
  }
  for (const a of animals) {
    if (a.dead || a.kind === 'bird') continue;
    const d = Math.hypot(a.x - px, a.y - py);
    if (d > STOMP_R) continue;
    hurtAnimal(a, STOMP_DMG, (a.x - px) / (d || 1), (a.y - py) / (d || 1), STOMP_KB, p.id);
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
// step from updatePlay: traps wait and bite, craters drag, the falcon flies
// its line, nets fly theirs, and a called volley lands when its ring closes.
function updateAbilityWorld(dt) {
  for (let i = traps.length - 1; i >= 0; i--) {
    const t = traps[i];
    t.t += dt;
    if (t.t > TRAP_LIFE) { burst(t.x, t.y, '#8b93a8', 4, 25, 0.3, true); traps.splice(i, 1); continue; }
    if (t.t < TRAP_ARM) continue;
    for (const q of players) {
      if (!q.active || q.dead || inAir(q) || q.team === t.team || q.invuln > 0) continue;
      if (Math.hypot(q.x - t.x, q.y + 4 - t.y) > TRAP_R) continue;
      // the bite: pinned on the spot, and the jaws show on the body (rootT)
      const src = players[t.owner];
      damagePlayer(q, TRAP_DMG, 0, -0.2, src && !src.dead ? src : null, null);
      if (!q.dead) { q.rootT = TRAP_ROOT; q.vx = q.vy = 0; q.sliding = false; }
      burst(t.x, t.y - 2, '#f2cc6a', 10, 55, 0.5, true);
      burst(t.x, t.y - 4, '#8b93a8', 8, 45, 0.45, true);
      if (nearPlayer(t.x, t.y)) SFX.hit();
      traps.splice(i, 1);
      break;
    }
  }
  for (let i = craters.length - 1; i >= 0; i--) {
    const z = craters[i];
    z.t += dt;
    if (z.t > CRATER_T) { craters.splice(i, 1); continue; }
    for (const q of players) {
      if (!q.active || q.dead || inAir(q) || q.team === z.team) continue;
      if (Math.hypot(q.x - z.x, q.y + 4 - z.y) > CRATER_R) continue;
      q.slowT = Math.max(q.slowT, 0.15); // refreshed every step spent inside
      q.slowMul = Math.min(q.slowMul, CRATER_SLOW);
    }
  }
  for (let i = falcons.length - 1; i >= 0; i--) {
    const f = falcons[i];
    f.t += dt;
    f.x += f.nx * FALCON_SPD * dt;
    f.y += f.ny * FALCON_SPD * dt;
    f.d += FALCON_SPD * dt;
    for (const q of players) {
      if (!q.active || q.dead || inAir(q) || q.team === f.team) continue;
      if (Math.hypot(q.x - f.x, q.y - f.y) > 18) continue;
      q.markT = MARK_T;
      if (!f.seen.includes(q.id)) {
        f.seen.push(q.id);
        burst(q.x, q.y - 10, '#f2cc6a', 8, 45, 0.5, true);
        if (nearPlayer(q.x, q.y)) SFX.ambush();
      }
    }
    if (f.d >= FALCON_RANGE) { burst(f.x, f.y, '#d9ad72', 4, 30, 0.35, true); falcons.splice(i, 1); }
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
    if (!dead) for (const q of players) {
      if (!q.active || q.dead || inAir(q) || q.team === n.team || q.invuln > 0) continue;
      if (Math.hypot(q.x - n.x, q.y - 6 - n.y) > 8) continue;
      if (abShieldBlocks(q, n.nx, n.ny)) { burst(n.x, n.y, '#cfd8e8', 6, 40, 0.35, true); dead = true; break; }
      const src = players[n.owner];
      damagePlayer(q, NET_DMG, n.nx, n.ny, src && !src.dead ? src : null, null);
      if (!q.dead) {
        q.slowT = Math.max(q.slowT, NET_SLOW_T);
        q.slowMul = Math.min(q.slowMul, NET_SLOW);
        q.netT = NET_SLOW_T; // the drape the slow is read off
      }
      burst(q.x, q.y - 6, '#cfd8e8', 8, 45, 0.4, true);
      dead = true;
      break;
    }
    if (dead) nets.splice(i, 1);
  }
  for (let i = volleys.length - 1; i >= 0; i--) {
    const v = volleys[i];
    v.t -= dt;
    if (v.t > 0) continue;
    const src = players[v.owner];
    for (const q of players) {
      if (!q.active || q.dead || inAir(q) || q.team === v.team || q.invuln > 0) continue;
      const d = Math.hypot(q.x - v.x, q.y - v.y);
      if (d > VOLLEY_R + 4) continue;
      damagePlayer(q, VOLLEY_DMG, (q.x - v.x) / (d || 1) * 0.3, 0.4, src && !src.dead ? src : null, null);
    }
    for (const a of animals) {
      if (a.dead || a.kind === 'bird') continue;
      const d = Math.hypot(a.x - v.x, a.y - v.y);
      if (d > VOLLEY_R) continue;
      hurtAnimal(a, VOLLEY_DMG, 0, 0.3, 30, v.owner);
    }
    if (PRACTICE) abHitDummies(v.x, v.y, VOLLEY_R, VOLLEY_DMG);
    // the pillar holds even for a called strike: some of the rain sticks in
    // the snow as plain shafts, free for anyone who walks in after it
    for (let k = 0; k < VOLLEY_SHAFTS; k++) {
      const a = rng() * Math.PI * 2, r = rand(4, VOLLEY_R - 6);
      stickArrow({ x: v.x + Math.cos(a) * r, y: v.y + Math.sin(a) * r, team: v.team }, 0, 0.9);
    }
    burst(v.x, v.y, '#eef4fb', 12, 55, 0.5, true);
    if (nearPlayer(v.x, v.y)) SFX.hit();
    volleys.splice(i, 1);
  }
  for (let i = volleyFx.length - 1; i >= 0; i--) {
    const f = volleyFx[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    f.t += dt;
    if (f.t > 0.16) {
      burst(f.x, f.y, '#eef4fb', 3, 30, 0.3, true);
      volleyFx.splice(i, 1);
    }
  }
}

// ---- drawing: the world layer --------------------------------------------
// Flat things on the snow, drawn after the shafts and before the entities:
// a trap is as plainly visible as a shaft is, to BOTH sides - the game is
// readable first, sneaky second.
function drawAbilityGround(ex, ey, now) {
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
  for (const t of traps) {
    const px = Math.round(t.x - ex), py = Math.round(t.y - ey);
    if (px < -16 || py < -16 || px > WV_W + 16 || py > WV_H + 16) continue;
    const armed = t.t >= TRAP_ARM;
    // opening: the jaws spread over the arm time, so "not yet live" is visible
    const open = Math.min(1, t.t / TRAP_ARM);
    const spread = 2 + Math.round(open * 2);
    // base plate + pin chain
    ctx.fillStyle = '#3c4356';
    ctx.fillRect(px - 4, py - 1, 8, 3);
    ctx.fillStyle = '#242a3a';
    ctx.fillRect(px - 4, py + 1, 8, 1);
    ctx.fillRect(px + 4, py, 2, 1);
    // the two toothed jaws
    ctx.fillStyle = armed && Math.sin(now * 6 + t.x) > 0.6 ? '#c8d2e4' : '#8b93a8';
    for (let k = -3; k <= 3; k += 2) {
      ctx.fillRect(px + k, py - spread, 1, 1);
      ctx.fillRect(px + k, py + spread - 1, 1, 1);
    }
    ctx.fillRect(px - 4, py - spread + 1, 1, spread * 2 - 2);
    ctx.fillRect(px + 3, py - spread + 1, 1, spread * 2 - 2);
  }
  for (const v of volleys) {
    const px = Math.round(v.x - ex), py = Math.round(v.y - ey);
    if (px < -40 || py < -40 || px > WV_W + 40 || py > WV_H + 40) continue;
    // the warning: a dashed danger ring, and an inner ring closing on the
    // centre as the rain gets near - the time left IS the picture
    const closing = Math.max(0, v.t / VOLLEY_T);
    for (let i = 0; i < 26; i++) {
      if ((i + ((now * 10) | 0)) % 2) continue;
      const a = (i / 26) * Math.PI * 2;
      ctx.fillStyle = 'rgba(224,99,122,0.85)';
      ctx.fillRect(px + Math.round(Math.cos(a) * VOLLEY_R), py + Math.round(Math.sin(a) * VOLLEY_R * 0.72), 1, 1);
    }
    const ir = VOLLEY_R * closing;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.fillStyle = 'rgba(255,217,92,0.8)';
      ctx.fillRect(px + Math.round(Math.cos(a) * ir), py + Math.round(Math.sin(a) * ir * 0.72), 1, 1);
    }
  }
}

// airborne ability bodies, drawn with the arrows: the net spinning open, the
// falcon and its shadow racing the snow, the volley's shafts coming down
function drawAbilityAir(ex, ey, now) {
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
  for (const f of falcons) {
    const px = Math.round(f.x - ex), py = Math.round(f.y - ey);
    if (px < -16 || py < -16 || px > WV_W + 16 || py > WV_H + 16) continue;
    // the shadow on the snow says where the sweep IS; the bird rides above it
    ctx.fillStyle = 'rgba(60,72,100,0.4)';
    ctx.fillRect(px - 3, py + 10, 6, 2);
    const flap = Math.sin(f.t * 18) > 0;
    ctx.fillStyle = '#0d1226';
    ctx.fillRect(px - 4, py - 1, 9, 3);
    ctx.fillStyle = '#6b5a48';
    ctx.fillRect(px - 3, py, 7, 1);
    ctx.fillStyle = '#d9ad72';
    ctx.fillRect(px - 1, py, 3, 1);
    ctx.fillStyle = '#6b5a48'; // wings beat above and below the body line
    if (flap) { ctx.fillRect(px - 4, py - 2, 3, 1); ctx.fillRect(px + 2, py - 2, 3, 1); }
    else { ctx.fillRect(px - 4, py + 1, 3, 1); ctx.fillRect(px + 2, py + 1, 3, 1); }
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(px + 4, py, 1, 1); // the head
  }
  for (const f of volleyFx) {
    if (f.delay > 0) continue;
    const drop = Math.min(1, f.t / 0.14);
    const px = Math.round(f.x - ex), py = Math.round(f.y - ey - 34 * (1 - drop));
    if (px < -8 || py < -40 || px > WV_W + 8 || py > WV_H + 8) continue;
    ctx.fillStyle = '#0d1226';
    ctx.fillRect(px - 1, py - 6, 1, 7); ctx.fillRect(px + 1, py - 6, 1, 7);
    ctx.fillStyle = '#e8dcb4';
    ctx.fillRect(px, py - 6, 1, 7);
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(px, py + 1, 1, 1);
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
    case 'trap': return { dx: 0, dy: 2, rot: 0 };                                   // kneel to set it
    case 'net': return { dx: p.dir === 'left' ? 1 : p.dir === 'right' ? -1 : 0, dy: 0, rot: 0 }; // braced back
    case 'falcon': return { dx: 0, dy: -1, rot: 0 };                                // arm up
    case 'volley': return { dx: 0, dy: -1, rot: p.dir === 'left' ? -0.12 : 0.12 };  // loosed skyward
    case 'shield': return { dx: 0, dy: 1, rot: 0 };                                 // planted
    case 'rush': return { dx: 0, dy: 0, rot: 0.14 * (p.dir === 'left' ? -1 : 1) };  // head down
    case 'stomp': return { dx: 0, dy: -Math.round(6 * Math.sin(Math.PI * prog)), rot: 0 }; // the leap
    case 'jug': return { dx: 0, dy: prog < 0.5 ? 1 : -1, rot: 0 };                  // the chest-beat
  }
  return null;
}

// everything an ability leaves ON a body, drawn over the sprite: the raised
// shield, the net drape, the sprung jaws at rooted feet, the fury's glow,
// and the falcon's mark - all visible to every side, because a state you
// cannot see is a rule you cannot play around.
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
    ctx.fillStyle = TEAMS[p.team].mark; // the trim carries the side
    ctx.fillRect(0, -2, 1, 4);
    ctx.restore();
  }
  if (p.netT > 0) {
    ctx.globalAlpha = Math.min(1, p.netT / 0.4);
    ctx.fillStyle = '#cfd8e8';
    for (let k = 0; k < 4; k++) {
      ctx.fillRect(px + 3 + k * 3, py + 3, 1, 11);
      ctx.fillRect(px + 3, py + 4 + k * 3, 10, 1);
    }
    ctx.fillStyle = '#8b93a8';
    ctx.fillRect(px + 3, py + 13, 10, 1); // the sag at the hem
    ctx.globalAlpha = 1;
  }
  if (p.rootT > 0) {
    // the sprung jaws, closed on the boots
    ctx.fillStyle = '#3c4356';
    ctx.fillRect(px + 4, py + 14, 8, 2);
    ctx.fillStyle = '#c8d2e4';
    for (let k = 0; k < 4; k++) ctx.fillRect(px + 5 + k * 2, py + 13, 1, 1);
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
  if (p.markT > 0) {
    // the falcon's mark: gold chevrons falling toward the head, for everyone
    const ph = (now * 2.2) % 1;
    ctx.globalAlpha = p.markT < 0.6 ? p.markT / 0.6 : 1;
    for (let k = 0; k < 2; k++) {
      const y = py - 8 - 5 * k + Math.round(ph * 4);
      ctx.fillStyle = '#0f1632';
      ctx.fillRect(px + 5, y + 1, 6, 2);
      ctx.fillStyle = '#f2cc6a';
      ctx.fillRect(px + 5, y, 2, 2); ctx.fillRect(px + 9, y, 2, 2); ctx.fillRect(px + 7, y + 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
}

// ---- the strip icons -----------------------------------------------------
// The eight ability icons: detailed 32x32 char grids in the sprite system's
// grammar (sprites.md - new sprites bake beside the code that draws them),
// AB32[cls][key] in CLASS_AB's own order, baked lazily onto their own
// canvases. Drawn by the strip's ability wells and the ability tooltip
// (drawClassAbCell / tipClassAb, js/ui.js). Each icon repeats the ability's
// in-world look - the trap's jaws, the net's corner weights, the volley's
// danger ring - so the well and the snow speak the same picture.
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
    [ // SNARE TRAP: the iron jaw head-on - two toothed arcs open around the
      // gold trigger pan, the base bar and its rivets below
      '................................',
      '................................',
      '.....oooooo..........oooooo.....',
      '....oCCCCCo..........oCCCCCo....',
      '...oCCssoo............oossCCo...',
      '...oCsSo................oSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSCCCo..........oCCCSsCo...',
      '...oCsSCCo............oCCSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSCCCo..........oCCCSsCo...',
      '...oCsSCCo............oCCSsCo...',
      '...oCsSo.....oooooo.....oSsCo...',
      '...oCsSo....ogggggGo....oSsCo...',
      '...oCsSCCCo.oggggGGo.oCCCSsCo...',
      '...oCsSCCo..ogggGGGo..oCCSsCo...',
      '...oCsSo.....oooooo.....oSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSCCCo..........oCCCSsCo...',
      '...oCsSCCo............oCCSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsso................ossCo...',
      '....oCsso..............ossCo....',
      '.....ooSso............osSoo.....',
      '......oooooooooooooooooooo......',
      '......oDDkDDDDkDDDDkDDDDDo......',
      '......oSSSSSSSSSSSSSSSSSSo......',
      '.......oooooooooooooooooo.......',
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
    [ // FALCON SWEEP: the bird in its stoop, head-first down the line, the
      // gold mark chevron already falling where it swept
      '................................',
      '................................',
      '................................',
      '...bb...........................',
      '....bb..........................',
      '.....oo.........................',
      '.....onoo....oo.................',
      '.....onnoo...onno...............',
      '......onnnoo..onnho.............',
      '.......onnnnoo.onnhho...........',
      '........onnnnnooonnhhho.........',
      '.........onnnnnnnnhhHhho........',
      '..........onnnnhhhhHHhho........',
      '...........onnhhhhHHHHho........',
      '............onhhhHHHHHHoo.......',
      '.............onhhHHHHHHHo.......',
      '..............onhHHHHHHHHo......',
      '...............onhHHHHWWHo......',
      '................onnHHWWWWno.....',
      '.................onnHWWnnnno....',
      '..................onnnnngnno....',
      '...................onnnnnnnoo...',
      '....gg....gg........onnnnnoGGo..',
      '.....gg..gg..........onnnnoGo...',
      '......gggg............oonnoo....',
      '........................oo......',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // VOLLEY: three shafts raining onto the dashed danger ring, the gold
      // inner ring already closing
      '................................',
      '......orro..........orro........',
      '......orto..........orto........',
      '......otro..........otro........',
      '.......oto...orro....oto........',
      '.......odo...orto....odo........',
      '.......oto...otro....oto........',
      '.......odo....oto....odo........',
      '.......oto....odo....oto........',
      '.......odo....oto....odo........',
      '.......oto....odo....oto........',
      '......oWWo....oto....oWWo.......',
      '......oWWo...oWWo....oWWo.......',
      '.......oo....oWWo.....oo........',
      '..............oo................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '............rr....rr............',
      '........rr..........rr..........',
      '......r....gggggggg....r........',
      '.....r....g........g....r.......',
      '....r....g..........g....r......',
      '....r....g..........g....r......',
      '.....r....g........g....r.......',
      '......r....gggggggg....r........',
      '........rr..........rr..........',
      '............rr....rr............',
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
