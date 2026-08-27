'use strict';
// The worker bots and the one flag per player that commands them: a bot's life
// from the bay's mouth to its wreck, the frame it spends deciding what to do,
// and the order marker it reads to decide it. Everything here is sim - a flag's
// pixels are the `what a flag looks like` group in js/draw-world.js.
// ------------------------------------------------------------ workers
function makeRobot(sp) {
  const t = STRUCTS.spawner.tiers[sp.tier];
  const m = structMouth(sp);
  let sx = m.x, sy = m.y;
  if (isSolidTile(Math.floor(sx / TILE), Math.floor(sy / TILE))) {
    // mouth blocked: the first free tile in the rings around the footprint
    const w = structW(sp.type), h = structH(sp.type);
    outer: for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy < h + r; dy++) for (let dx = -r; dx < w + r; dx++) {
        if (dx > -r && dx < w + r - 1 && dy > -r && dy < h + r - 1) continue;
        if (!isSolidTile(sp.tx + dx, sp.ty + dy)) { sx = (sp.tx + dx) * TILE + 8; sy = (sp.ty + dy) * TILE + 8; break outer; }
      }
    }
  }
  return {
    x: sx, y: sy, hp: t.botHp, maxHp: t.botHp,
    home: sp, team: sp.team === undefined ? 0 : sp.team, owner: sp.owner === undefined ? 0 : sp.owner,
    tgt: null, workT: 0, atkCd: 0, avoid: null, avoidT: 0, nav: null,
    // the fight, all of it: what it is swinging at right now (drawRobot reads
    // it), and who hit it last - a struck worker fights back for ROBOT_MAD s
    atkAim: null, mad: null, madT: 0, madX: 0, madY: 0,
    carry: 0, // gold held, deposited at home
    moveT: 0, idleT: rand(0.3, 1), mvx: 0, mvy: 0, moving: false,
    animT: rng() * 2, flash: 0, kbx: 0, kby: 0, stunT: 0, stunMax: 0, dead: false,
  };
}

// A worker is a 12x10 body standing on its treads at b.y + 4, so its middle
// sits a pixel above the anchor. Same radius as a player: a bot in the open
// is as shootable as the rival who built it.
function robotHit(b, x, y) { return Math.hypot(b.x - x, b.y - 1 - y) < 7; }

// an arrow landing on a worker - and a turret bolt too, since bolts ride the
// same pipeline. src is the shooter, for the feed line on the kill.
function hurtRobot(b, dmg, nx, ny, src) {
  if (b.dead) return;
  // a worker under a flag remembers who hit it and swings back; with no flag
  // it is the same defenceless hauler it always was
  // madX/madY is where it was standing when it was hit: the leash it fights
  // back inside, so a raider cannot walk a worker off its post
  if (src && src.team !== b.team && flagOf(b)) { b.mad = src; b.madT = ROBOT_MAD; b.madX = b.x; b.madY = b.y; }
  b.hp -= dmg;
  b.flash = 0.12;
  b.kbx = nx * 40; b.kby = ny * 40;
  addDmgFloater(b.x, b.y - 12, dmg);
  burst(b.x, b.y - 2, '#c3c9d3', 6, 45, 0.35, true);
  burst(b.x, b.y - 2, '#ffb347', 3, 40, 0.3, true); // sparks off the plating
  if (nearPlayer(b.x, b.y)) SFX.hit();
  if (b.hp <= 0) robotDies(b, src);
}

// The wreck. Whatever gold it was hauling spills where it fell (up to three
// coins, so a full load reads as a pile), which is what makes shooting a
// loaded worker on its way home worth the arrows.
function robotDies(b, src) {
  b.dead = true;
  if (nearPlayer(b.x, b.y)) SFX.break_();
  burst(b.x, b.y - 4, '#98a1b0', 10, 50, 0.5, true);
  burst(b.x, b.y - 4, '#3b4150', 4, 35, 0.4);
  if (b.carry > 0) {
    const coins = Math.min(3, b.carry);
    for (let i = 0; i < coins; i++) {
      spawnDrop(b.x, b.y, 'gold', Math.floor(b.carry / coins) + (i < b.carry % coins ? 1 : 0));
    }
    b.carry = 0;
  }
  // a downed worker is not a downed slot: it makes the feed, never the kill count
  if (src && src.team !== b.team) logEvent(src.name + ' SCRAPPED A WORKER', src);
}

function updateRobot(b, dt) {
  b.flash = Math.max(0, b.flash - dt);
  b.atkCd = Math.max(0, b.atkCd - dt);
  b.kbx *= Math.pow(0.02, dt);
  b.kby *= Math.pow(0.02, dt);
  if (b.stunT > 0) {
    // rattled: the brain is off, but a shove still slides the chassis
    b.stunT = Math.max(0, b.stunT - dt);
    b.moving = false;
    if (Math.abs(b.kbx) + Math.abs(b.kby) > 1) moveEntity(b, b.kbx * dt, b.kby * dt, 3);
    b.x = Math.max(8, Math.min(WORLD * TILE - 8, b.x));
    b.y = Math.max(8, Math.min(WORLD * TILE - 8, b.y));
    return;
  }
  const home = b.home;
  const hm = structMouth(home), hx = hm.x, hy = hm.y;
  let moving = false;
  const SPD = 40;

  // route there (reach 1 = stop beside a tile it cannot stand on); an
  // unreachable goal comes back as -1 and the caller drops it
  const walkToward = (px, py, reach) => {
    const n = navStep(b, px, py, 3, SPD, dt, reach);
    if (!n.ok) return -1;
    moving = true;
    return n.d;
  };

  // loiter around an anchor - home with no orders, the flag's post with them
  const wander = (ax, ay) => {
    if (ax === undefined) { ax = hx; ay = hy; }
    if (b.moveT > 0) {
      b.moveT -= dt;
      moving = true;
      const mv = moveEntity(b, (b.mvx * 24 + b.kbx) * dt, (b.mvy * 24 + b.kby) * dt, 3);
      if (mv.blockedX || mv.blockedY) b.moveT = 0;
    } else {
      b.idleT -= dt;
      if (Math.abs(b.kbx) + Math.abs(b.kby) > 1) moveEntity(b, b.kbx * dt, b.kby * dt, 3); // shoved while idle
      if (b.idleT <= 0) {
        let ang = rng() * Math.PI * 2;
        if (Math.hypot(ax - b.x, ay - b.y) > 2.5 * TILE) ang = Math.atan2(ay - b.y, ax - b.x) + rand(-0.5, 0.5);
        b.mvx = Math.cos(ang); b.mvy = Math.sin(ang);
        b.moveT = rand(0.5, 1.2);
        b.idleT = rand(0.8, 2);
      }
    }
  };

  // walk to a post and stand on it: the flag's own hold, and a guard's ring
  const holdAt = (px, py) => {
    if (Math.hypot(px - b.x, py - b.y) > 22) { if (walkToward(px, py) >= 0) return; }
    wander(px, py);
  };

  const deposit = () => {
    if (b.carry <= 0) return;
    gainGold(players[b.owner] || player, b.carry);
    addFloater(hx, hy - 14, '+' + b.carry, RES_COLORS.gold);
    b.carry = 0;
    if (nearPlayer(hx, hy)) SFX.coin();
  };

  const harvest = () => {
    const t = b.tgt, ox = t.tx * TILE + 8, oy = t.ty * TILE + 8;
    t.flash = 0.1;
    t.shake = 0.22;
    if (t.type === 'tree' || t.type === 'deadTree') {
      const dry = t.type === 'deadTree';   // a rookery perch: quicker, same gold
      t.hp--;
      b.carry += dry ? YIELD.deadTreeHit : YIELD.treeHit;
      if (nearPlayer(ox, oy)) SFX.chop();
      burst(ox, oy - 10, '#eef4fb', 3, 35, 0.4, true);
      if (t.hp <= 0) {
        objects[idx(t.tx, t.ty)] = { type: 'stump', tx: t.tx, ty: t.ty, flash: 0, shake: 0 };
        b.carry += dry ? YIELD.deadTreeFall : YIELD.treeFall;
        if (t.rare) b.carry += YIELD.treeRare;
        burst(ox, oy - 8, '#eef4fb', 8, 45, 0.5, true);
        if (nearPlayer(ox, oy)) SFX.treeFall();
        if (dry) flushBirds(landmarkAt(ox, oy), { x: ox, y: oy }); // the flock loses its perch
        b.tgt = null;
      }
    } else {
      t.hp--;
      b.carry += YIELD.rockHit;
      if (nearPlayer(ox, oy)) SFX.mine();
      burst(ox, oy - 4, '#a8b0c4', 3, 35, 0.35, true);
      if (t.hp <= 0) {
        objects[idx(t.tx, t.ty)] = null;
        b.carry += YIELD.rockBreak;
        b.tgt = null;
      }
    }
  };

  // walk to the current target and swing at it; false = it gave the tile up
  const workTgt = () => {
    const txp = b.tgt.tx * TILE + 8, typ = b.tgt.ty * TILE + 8;
    if (Math.hypot(txp - b.x, typ - b.y) > 20) {
      // no route to it (walled in, or pinned on the way): leave it alone a while
      if (walkToward(txp, typ, 1) < 0) { b.avoid = b.tgt; b.avoidT = 12; b.tgt = null; return false; }
    } else {
      b.workT += dt;
      if (b.workT >= 0.9) { b.workT = 0; harvest(); }
    }
    return true;
  };
  // hold the current target if it still stands, otherwise take what `pick`
  // offers; false = there was nothing left to work
  const gather = (pick) => {
    if (b.tgt && objects[idx(b.tgt.tx, b.tgt.ty)] !== b.tgt) b.tgt = null;
    if (!b.tgt) b.tgt = pick();
    if (!b.tgt) return false;
    workTgt();
    return true;
  };
  const homeRun = () => { const d = walkToward(hx, hy); if (d >= 0 && d < 14) deposit(); };
  // anything a worker will cut, anywhere near a point, that no sibling has
  const cutNear = (cx, cy, r) => nearestObj(cx, cy, r, (o) =>
    (o.type === 'tree' || o.type === 'deadTree' || o.type === 'rock') && o !== b.avoid && !objTaken(b, o));

  // close on a foe and swing at it. `leash` (px, measured from lx/ly) is what
  // keeps a worker on a defensive job from being kited off it.
  const engage = (foe, lx, ly, leash) => {
    const pt = foePoint(foe, b.x, b.y - 1);
    if (leash !== undefined && Math.hypot(pt.x - lx, pt.y - ly) > leash) return false;
    if (Math.hypot(pt.x - b.x, pt.y - (b.y - 1)) > ROBOT_REACH) {
      // a building is a solid tile: stop beside it, not on it
      return walkToward(pt.x, pt.y, foe.tx !== undefined ? 1 : 0) >= 0;
    }
    b.atkAim = pt;
    if (b.atkCd <= 0) { b.atkCd = ROBOT_ATK_CD; robotStrike(b, foe, pt); }
    return true;
  };

  // ---- the flag is the order -------------------------------------------
  // No flag and this is the bay-centred gather it has always been. With one,
  // the job the flag resolved to says where the crew works, stands or swings,
  // and only an attack flag lets a worker leave its post to chase.
  const fl = flagOf(b);
  const job = fl ? fl.job : null;
  const chase = !!(job && FLAG_ATTACK[job]);
  const fx = fl ? fl.tx * TILE + 8 : hx, fy = fl ? fl.ty * TILE + 8 : hy;
  if (b.avoidT > 0) b.avoidT -= dt; else b.avoid = null;
  // anger only lives under a flag - an unflagged worker is the same
  // defenceless hauler it always was
  if (b.madT > 0 && fl && foeAlive(b, b.mad)) b.madT -= dt;
  else { b.mad = null; b.madT = 0; }
  b.atkAim = null;

  if (!fl) {
    if (b.carry >= 8) homeRun();
    else if (!gather(() => nearestObj(hx, hy, 8, (o) =>
      (o.type === 'tree' || o.type === 'rock') && o !== b.avoid))) {
      if (b.carry > 0) homeRun(); else wander();
    }
  } else if (chase) {
    b.tgt = null;
    // the mark: the flag's own - a hunted unit, or the flagged building and
    // then the nearest one still standing around it - with anything hostile
    // met on the way taking priority over all of it
    let foe = null;
    if (job === 'hunt') foe = foeAlive(b, fl.unit) ? fl.unit : null;
    else if (job === 'siege') foe = enemyStructNear(b.team, fx, fy, FLAG_SIEGE_R * TILE);
    const met = robotFoeUnit(b, ROBOT_AGGRO);
    if (met) foe = met;
    if (!foe || !engage(foe)) holdAt(fx, fy); // nothing left to break: hold the ground
  } else if (b.carry >= 8) {
    homeRun();
  } else if (b.mad && engage(b.mad, b.madX, b.madY, ROBOT_LEASH)) {
    // struck at its post: swings back from where it was standing, and never
    // follows past the leash - chasing is what an attack flag is for
  } else if (job === 'guard') {
    b.tgt = null;
    const o = structOf(objAt(fl.tx, fl.ty));
    const post = o ? structMouth(o) : { x: fx, y: fy };
    const met = robotFoeUnit(b, ROBOT_AGGRO);
    if (!met || !engage(met, post.x, post.y, ROBOT_LEASH)) {
      if (b.carry > 0 && Math.hypot(hx - b.x, hy - b.y) < 40) homeRun();
      else {
        // one post each, spaced around the building it is watching
        const a = (Math.max(0, home.bots.indexOf(b))) * 2.4;
        holdAt(post.x + Math.cos(a) * 18, post.y + Math.sin(a) * 11);
      }
    }
  } else if (job === 'path') {
    // the lane first; once it is open, work the ground around the far end
    if (!gather(() => flagPathTarget(b, fl) || cutNear(fx, fy, FLAG_HARVEST_R))) {
      if (b.carry > 0) homeRun(); else holdAt(fx, fy);
    }
  } else {
    // harvest: the flagged tile itself, then outward around it
    if (!gather(() => cutNear(fx, fy, FLAG_HARVEST_R))) {
      if (b.carry > 0) homeRun(); else holdAt(fx, fy);
    }
  }

  b.animT += dt * (moving ? 8 : 0);
  b.moving = moving;
  b.x = Math.max(8, Math.min(WORLD * TILE - 8, b.x));
  b.y = Math.max(8, Math.min(WORLD * TILE - 8, b.y));

  if (b.hp <= 0 && !b.dead) robotDies(b, null);
}

// ------------------------------------------------------------ worker flags
// The worker flag: one order marker per player, and everything the workers
// reading it are allowed to do. See the `worker flags` banner.
const FLAG_BASE_R = 9;     // tiles: ground this close to an ENEMY building is a march order, not a path
const FLAG_HARVEST_R = 7;  // tiles a harvest flag spreads outward over once its own tile is cut
const FLAG_SIEGE_R = 14;   // tiles a siege flag rolls on to the next enemy building inside
const FLAG_PATH_W = 1;     // corridor half-width in tiles: 1 = a three-tile lane
const ROBOT_DMG = 5;       // one worker swing, against a unit or a building
const ROBOT_ATK_CD = 1.1;  // seconds between those swings
const ROBOT_REACH = 15;    // px from a worker's body to what its axe can reach
const ROBOT_AGGRO = 70;    // px a worker on any flag notices a foe inside
const ROBOT_LEASH = 90;    // px a worker on a *defensive* flag will leave its post to swing
const ROBOT_MAD = 6;       // seconds a struck worker stays angry at whoever hit it

// ONE marker per player, planted with the middle mouse button, that every
// worker bot that player owns reads as its standing order. What the flag is
// STANDING ON is the order - there is no menu and no mode: a tree or a rock
// means cut here, open ground means clear a road out to here, your own
// building means guard it, and anything another team owns means go break it.
// Moving the flag re-gives the order, moving it home is the retreat, and
// middle-clicking the flag itself picks it up and hands the crew back to the
// bay - which is exactly the behaviour that existed before flags did.
//
//   p.flag = { tx, ty, job, unit }   // `unit` is only ever set for a hunt
//
// Only `job` (and a hunt's mark) is remembered. Everything else is re-read
// off the tile as it is needed, so felling the tree a HARVEST flag stands on
// spreads the crew outward instead of stranding it, and wrecking the building
// a SIEGE flag stands on rolls them on to the next one nearby.
// TWO colours only, and they carry the STAKES, not the job - the icon is what
// says which job it is. Anything pointed at your own side is the game's plain
// pale ink; the three that point at another team are the danger red every
// other hostile thing in the game already uses. Amber and green are spoken
// for (affordable / interactable, and good), and a work order is neither.
// The pale one is the game's standard bright ink, NOT a soft slate: this
// world is snow, and anything near it disappears into the ground. It reads
// for the same reason drawSelection's brackets do - a dark rim under white.
const FLAG_MINE = '#f4f7ff', FLAG_FOE = '#ff8a7a';
const FLAG_JOBS = {
  // icon: rects on a 7x7 grid, stamped by drawFlagIcon (the landmark idiom)
  harvest: { col: FLAG_MINE, icon: [[0, 0, 5, 1], [0, 1, 6, 1], [1, 2, 5, 1], [3, 3, 1, 4]] }, // an axe
  path:    { col: FLAG_MINE, icon: [[1, 1, 5, 1], [2, 3, 3, 1], [3, 5, 1, 1]] },               // a lane running away
  guard:   { col: FLAG_MINE, icon: [[0, 0, 7, 2], [1, 2, 5, 2], [2, 4, 3, 1], [3, 5, 1, 1]] }, // a shield
  siege:   { col: FLAG_FOE,  icon: [[2, 0, 3, 3], [1, 3, 5, 1], [3, 4, 1, 3]] },               // a sword
  hunt:    { col: FLAG_FOE,  icon: [[2, 0, 3, 3], [1, 3, 5, 1], [3, 4, 1, 3]] },
  march:   { col: FLAG_FOE,  icon: [[2, 0, 3, 3], [1, 3, 5, 1], [3, 4, 1, 3]] },
};
// the three that let a worker leave its post and chase; every other job only
// ever swings back at whoever hit it
const FLAG_ATTACK = { siege: 1, hunt: 1, march: 1 };

// a unit on another team standing on this point: a hunt order's mark. A rival
// buried deep enough to be off both maps cannot be flagged either - concealOf
// is the one place "can this be noticed" is decided.
function flagUnitAt(team, x, y) {
  for (const q of players) {
    if (!q.active || q.dead || inAir(q) || q.team === team) continue;
    if (concealOf(q) >= PRONE_MAP) continue;
    if (Math.hypot(q.x - x, q.y - 6 - y) < 10) return q;
  }
  for (const b of robots) {
    if (b.dead || b.team === team) continue;
    if (Math.hypot(b.x - x, b.y - 1 - y) < 10) return b;
  }
  return null;
}

// nearest building belonging to any other team, within r px of (x, y)
function enemyStructNear(team, x, y, r) {
  let best = null, bd = r;
  for (const o of structures) {
    if (o.team === undefined || o.team === team) continue;
    const c = structCenter(o);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// What planting here would order. The cursor preview and plantFlag() both
// read this one function, so what the pointer promises is what the crew does.
function flagResolve(p, tx, ty) {
  const x = tx * TILE + 8, y = ty * TILE + 8;
  const u = flagUnitAt(p.team, x, y);
  if (u) return { job: 'hunt', unit: u };
  const o = structOf(objAt(tx, ty));
  if (o && STRUCTS[o.type]) return { job: ownsStruct(o, p) ? 'guard' : 'siege', unit: null };
  if (o && (o.type === 'tree' || o.type === 'deadTree' || o.type === 'rock')) return { job: 'harvest', unit: null };
  // open ground this close to somebody else's building is a march on it,
  // not a road-building job - the same tile says two different things
  // depending on whose doorstep it is
  if (enemyStructNear(p.team, x, y, FLAG_BASE_R * TILE)) return { job: 'march', unit: null };
  return { job: 'path', unit: null };
}

// plant / move / pick up: one button does all three, and the flag itself is
// the pick-up target, so there is no separate cancel
function plantFlag(p, tx, ty) {
  if (!inWorld(tx, ty)) return;
  if (p.flag && p.flag.tx === tx && p.flag.ty === ty) { clearFlag(p); return; }
  const r = flagResolve(p, tx, ty);
  p.flag = { tx, ty, job: r.job, unit: r.unit };
  flagRecall(p);
  burst(tx * TILE + 8, ty * TILE + 8, FLAG_JOBS[r.job].col, 8, 45, 0.4, true);
  if (p === player) SFX.place();
}
function clearFlag(p) {
  if (!p.flag) return;
  const x = p.flag.tx * TILE + 8, y = p.flag.ty * TILE + 8;
  p.flag = null;
  flagRecall(p);
  burst(x, y, '#c9d0e2', 6, 40, 0.35, true);
  if (p === player) SFX.pickup();
}
// every worker on this flag drops what it was doing and turns for the new
// order the same frame it lands - an order has to be visibly obeyed at once
function flagRecall(p) {
  for (const b of robots) if (b.owner === p.id && !b.dead) { b.tgt = null; b.atkAim = null; navClear(b); }
}
// the order a given worker is under: its bay owner's flag, or none
function flagOf(b) { const p = players[b.owner]; return p && p.active ? p.flag : null; }

// Every tile of the lane a PATH flag asks for: a straight corridor
// FLAG_PATH_W tiles either side of the line from the bay's mouth out to the
// flag, walked OUTWARD, so a crew clears it from the door forward instead of
// from the far end back.
function flagCorridor(from, tx, ty) {
  const sx = Math.floor(from.x / TILE), sy = Math.floor(from.y / TILE);
  const dx = tx - sx, dy = ty - sy;
  const n = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  const across = Math.abs(dx) >= Math.abs(dy); // widen square to the lane
  const out = [], seen = new Set();
  for (let i = 0; i <= n; i++) {
    const cx = Math.round(sx + dx * i / n), cy = Math.round(sy + dy * i / n);
    for (let k = -FLAG_PATH_W; k <= FLAG_PATH_W; k++) {
      const px = across ? cx : cx + k, py = across ? cy + k : cy;
      if (!inWorld(px, py)) continue;
      const id = idx(px, py);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push([px, py]);
    }
  }
  return out;
}
// is another live worker out of the same bay already swinging at this?
function objTaken(b, o) {
  for (const s of b.home.bots) if (s !== b && !s.dead && s.tgt === o) return true;
  return false;
}
// the first thing still standing in that lane no sibling has already claimed
function flagPathTarget(b, fl) {
  for (const [tx, ty] of flagCorridor(structMouth(b.home), fl.tx, fl.ty)) {
    const o = objAt(tx, ty);
    if (!o || (o.type !== 'tree' && o.type !== 'deadTree' && o.type !== 'rock')) continue;
    if (o === b.avoid || objTaken(b, o)) continue;
    return o;
  }
  return null;
}

// ---- a worker's simple attack -------------------------------------------
// Workers were never fighters; a flag that points at another team has to hand
// them something to point back with. One axe swing on a flat cooldown - the
// same swing the harvest animation already draws, aimed at a body instead of
// a trunk. Nothing here scales with anything yet; that is the balance pass.
function foeAlive(b, e) {
  if (!e) return false;
  if (e.tx !== undefined) return structOf(objAt(e.tx, e.ty)) === e && e.team !== b.team;
  if (e.input) return e.active && !e.dead && !inAir(e) && e.team !== b.team;
  return !e.dead && e.team !== b.team;
}
// Where a worker aims. A body is a point a little above its feet; a building
// is the nearest point on its FOOTPRINT, not its centre - the bay is 3x2, and
// a worker measuring to the middle of it could never reach its own axe past
// the wall it is standing against.
function foePoint(e, fx, fy) {
  if (e.tx === undefined) return { x: e.x, y: e.y - 4 };
  if (fx === undefined) return structCenter(e);
  const x0 = e.tx * TILE, y0 = e.ty * TILE;
  return {
    x: Math.max(x0, Math.min(x0 + structW(e.type) * TILE, fx)),
    y: Math.max(y0, Math.min(y0 + structH(e.type) * TILE, fy)),
  };
}
// nearest enemy UNIT (slot or worker) inside range. Slots are noticed through
// seenAt, so a body under the snow is as invisible to a worker as to a wolf.
function robotFoeUnit(b, range) {
  let best = null, bd = range;
  for (const q of players) {
    if (!q.active || q.dead || inAir(q) || q.team === b.team) continue;
    const d = Math.hypot(q.x - b.x, q.y - 6 - b.y);
    if (d < bd && d <= seenAt(q, range)) { bd = d; best = q; }
  }
  for (const r of robots) {
    if (r === b || r.dead || r.team === b.team) continue;
    const d = Math.hypot(r.x - b.x, r.y - 1 - b.y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
// the blow itself: a building goes through hurtStruct (the same path an E
// swing takes), a body through damagePlayer / hurtRobot, all credited to the
// bay's owner so a worker kill still pays and still levels
function robotStrike(b, e, pt) {
  const src = players[b.owner] || null;
  const d = Math.hypot(pt.x - b.x, pt.y - (b.y - 1)) || 1;
  const nx = (pt.x - b.x) / d, ny = (pt.y - (b.y - 1)) / d;
  if (nearPlayer(b.x, b.y)) SFX.swing();
  if (e.tx !== undefined) hurtStruct(e, ROBOT_DMG, src);
  else if (e.input) damagePlayer(e, ROBOT_DMG, nx, ny, src, 'worker');
  else hurtRobot(e, ROBOT_DMG, nx, ny, src);
}

// ---- who can be ordered, and what the held press is aiming at -----------
// Does this slot have anyone to command? A live worker, or a bay that is
// about to roll one out - the affordance has to be there the moment the bay
// is up, not only once the first bot is in the yard. No crew, no preview.
function hasWorkers(p) {
  for (const b of robots) if (!b.dead && b.owner === p.id) return true;
  for (const o of structures) if (o.type === 'spawner' && o.owner === p.id) return true;
  return false;
}
// THE PREVIEW, and it is only up while the middle button is HELD
// (state.flagAim). Everything else in this game that previews, previews
// something you are already doing - the aim line needs a drawn bow, the build
// wheel a held right-click - and an order you have not started is no
// different. It comes in two halves because they live in two spaces:
// drawFlagAim() marks the target TILE in the world pass (so its brackets
// scale with the tile, like drawSelection's), and drawFlagCursor() rides the
// pointer in the UI pass at a fixed size. Both are drawn in js/draw-world.js
// (the `what a flag looks like` group) and both read this.
function flagTarget() {
  if (!state.flagAim || window.DBG.hideUI || !mouse.inside || !player || player.dead) return null;
  if (state.paused || state.settingsOpen || state.wheel || state.draft) return null;
  const tx = Math.floor(mouseWX() / TILE), ty = Math.floor(mouseWY() / TILE);
  if (!inWorld(tx, ty) || overHud(mouse.x, mouse.y)) return null;
  const f = player.flag;
  // over your own flag the release lifts it instead, so the preview says so
  if (f && f.tx === tx && f.ty === ty) return { tx, ty, lift: true, col: '#c9d0e2' };
  const job = flagResolve(player, tx, ty).job;
  return { tx, ty, job, col: FLAG_JOBS[job].col };
}
