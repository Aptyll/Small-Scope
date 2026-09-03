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
  const b = {
    x: sx, y: sy, hp: t.botHp, maxHp: t.botHp,
    home: sp, team: sp.team === undefined ? 0 : sp.team, owner: sp.owner === undefined ? 0 : sp.owner,
    tgt: null, workT: 0, atkCd: 0, avoid: null, avoidT: 0, nav: null,
    // the fight, all of it: what it is swinging at right now (drawRobot reads
    // it), and who hit it last - a struck worker fights back for ROBOT_MAD s
    atkAim: null, mad: null, madT: 0, madX: 0, madY: 0,
    carry: 0, // gold held, deposited at home
    moveT: 0, idleT: rand(0.3, 1), mvx: 0, mvy: 0, moving: false,
    animT: rng() * 2, flash: 0, kbx: 0, kby: 0, dead: false,
  };
  // a worker takes every state a player slot can be put under - snared,
  // netted, marked, alight - written by the same setters (`status effects`,
  // js/actions.js). A bot rolling out of the bay is not a different rulebook.
  clearUnitStatus(b);
  return b;
}

// A worker is a 12x10 body standing on its treads at b.y + 4, so its middle
// sits a pixel above the anchor. Same radius as a player: a bot in the open
// is as shootable as the rival who built it.
// `pad` is a shot's own `reach` - extra px for a bit with a BODY rather than
// a shaft's tip (the fist, the axe; js/tools.js). Absent for everything else.
function robotHit(b, x, y, pad) { return Math.hypot(b.x - x, b.y - 1 - y) < 7 + (pad || 0); }

// px/s a chassis is shoved by an ordinary blow. hurtUnit writes over it for
// anything carrying a shove of its own or a KNOCKBACK multiplier.
const ROBOT_KB = 40;
// an arrow landing on a worker - and a turret bolt too, since bolts ride the
// same pipeline. src is the shooter, for the feed line on the kill. Reached
// only through hurtUnit, which asks unitAlive first, so a merchant never
// arrives here - the guard below is the same question asked twice on purpose,
// since this is a named function and nothing stops a later caller finding it.
function hurtRobot(b, dmg, nx, ny, src) {
  if (!unitAlive(b)) return;
  // a worker under a flag remembers who hit it and swings back; with no flag
  // it is the same defenceless hauler it always was
  // madX/madY is where it was standing when it was hit: the leash it fights
  // back inside, so a raider cannot walk a worker off its post
  if (src && src.team !== b.team && flagOf(b)) { b.mad = src; b.madT = ROBOT_MAD; b.madX = b.x; b.madY = b.y; }
  b.hp -= dmg;
  b.flash = 0.12;
  b.kbx = nx * ROBOT_KB; b.kby = ny * ROBOT_KB;
  addDmgFloater(b.x, b.y - 12, dmg);
  burst(b.x, b.y - 2, '#c3c9d3', 6, 45, 0.35, true);
  burst(b.x, b.y - 2, '#ffb347', 3, 40, 0.3, true); // sparks off the plating
  if (nearPlayer(b.x, b.y)) SFX.hit();
  if (b.hp <= 0) robotDies(b, src);
}

// The wreck. Whatever gold it was hauling goes to whoever downed it - the
// final blow takes the cargo, which is what keeps shooting a loaded worker
// on its way home worth the arrows. A wreck nobody caused eats its load.
function robotDies(b, src) {
  b.dead = true;
  if (nearPlayer(b.x, b.y)) SFX.break_();
  burst(b.x, b.y - 4, '#98a1b0', 10, 50, 0.5, true);
  burst(b.x, b.y - 4, '#3b4150', 4, 35, 0.4);
  if (b.carry > 0) {
    if (src && src.inv) awardGold(src, b.carry, b.x, b.y);
    b.carry = 0;
  }
  // a downed worker is not a downed slot: it makes the feed, never the kill
  // count. There is no merchant line any more: a merchant cannot be downed
  // (unitAlive, js/actions.js), so nothing reaches here carrying one.
  if (src && src.team !== b.team) logEvent(src.name + ' SCRAPPED A WORKER', src);
}

function updateRobot(b, dt) {
  b.flash = Math.max(0, b.flash - dt);
  b.atkCd = Math.max(0, b.atkCd - dt);
  b.kbx *= Math.pow(0.02, dt);
  b.kby *= Math.pow(0.02, dt);
  // every timed state on the chassis first - a burn can scrap it, and a wreck
  // must not then drive on (js/actions.js, `status effects`)
  updateUnitStatus(b, dt);
  if (b.dead) return;
  if (b.stunT > 0) {
    // rattled: the brain is off, but a shove still slides the chassis
    b.stunT = Math.max(0, b.stunT - dt);
    b.moving = false;
    if (Math.abs(b.kbx) + Math.abs(b.kby) > 1) moveEntity(b, b.kbx * dt, b.kby * dt, 3);
    b.x = Math.max(8, Math.min(WORLD * TILE - 8, b.x));
    b.y = Math.max(8, Math.min(WORLD * TILE - 8, b.y));
    return;
  }
  if (b.merchant) { updateMerchant(b, dt); return; } // the eagle's driver: its own brain, the shared body above
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

  // loiter around an anchor - home with no orders, the flag's post with them.
  // Steered by hand rather than routed, so the net/crater drag is folded in
  // here the way navStep does it for every walk with a goal (js/actions.js)
  const wander = (ax, ay) => {
    if (ax === undefined) { ax = hx; ay = hy; }
    const drag = unitMoveMul(b);
    if (b.moveT > 0) {
      b.moveT -= dt;
      moving = true;
      const mv = moveEntity(b, (b.mvx * 24 * drag + b.kbx) * dt, (b.mvy * 24 * drag + b.kby) * dt, 3);
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

// ------------------------------------------------------------ merchant
// Each eagle is DRIVEN by its team's merchant - the figure on the bird's neck
// in flight (drawEagle, js/boot.js) - who climbs down the moment it roosts
// and works the roost for its side: first a GATE at the mouth of the lane the
// crash cut (a turret on the stump flanking the lane each side, walls on the
// ring stumps behind them), then the ring of pines beyond the crash's stump
// ring felled to stumps so the base has room and build sites, then it keeps
// to the roost - where it becomes the SHOP (the `shop` banner, js/shop.js):
// walk up to either team's merchant and E opens its counter.
//
// It is a unit in `robots` with `merchant: true`: the same separation and
// draw pipelines a worker rides, dispatched to updateMerchant/drawMerchant by
// that flag (updateRobot's status/stun handling is shared). owner -1: it
// obeys no flag and pays nobody - its work is the eagle's, free like the
// crater, the same for both sides.
//
// It CANNOT BE KILLED, and it has no hp at all rather than a large number:
// unitAlive (js/actions.js) answers false for a merchant, which takes it out
// of every arrow, blow, sweep, turret mark and worker's quarry in one place.
// Both sides trade at both counters, so neither side may shoot one, and
// nothing may stand between a player and the shop they walked to.
const MERCH_SPD = 46;        // px/s
const MERCH_SWING_T = 0.7;   // s per axe swing (a pine is 4 hp: ~3 s a tree)
const MERCH_BUILD_T = 0.9;   // s of hammering to set a site
const MERCH_CLEAR_R = 5.6;   // tiles from the roost the felling reaches: one ring past BOOM_STUMP_R (boot.js)
const MERCH_GATE_GAP = 1.3;  // tiles either side of the lane's centreline the gate leaves open
const MERCH_GATE_W = 4.2;    // ...and how far out from the centreline its walls reach
const MERCH_HOP_T = 0.55;    // s of the hop off the bird
const MERCH_THINK = 0.35;    // s between job picks

// the nearest tile to (tx, ty) nothing stands on, spiralling out
function freeTileNear(tx, ty, rMax) {
  for (let r = 0; r <= rMax; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = tx + dx, y = ty + dy;
      if (inWorld(x, y) && !objAt(x, y) && ground[idx(x, y)] !== 2) return { tx: x, ty: y };
    }
  }
  return null;
}

// the crash: the driver climbs down on the lane side of the roost and plans
// its gate off the stumps the impact left (eagleCrash, js/boot.js)
function spawnMerchant(e) {
  const lx = e.laneDir.x, ly = e.laneDir.y; // the lane's own direction: from the crater to the middle of the corner's treeline (eagleCrash)
  const wx = e.x + lx * (EAGLE_TILE_R + 1.4) * TILE, wy = e.y + ly * (EAGLE_TILE_R + 1.4) * TILE;
  const at = freeTileNear(Math.floor(wx / TILE), Math.floor(wy / TILE), 6) || { tx: Math.floor(e.x / TILE), ty: Math.floor(e.y / TILE) };
  const b = {
    merchant: true, kind: 'merchant', team: e.team, owner: -1, home: null,
    x: (at.tx + 0.5) * TILE, y: (at.ty + 0.5) * TILE, // no hp: nothing can hurt it (unitAlive)
    roost: e, plan: [], tgt: null, workT: 0, thinkT: 0, avoids: [], avoid: null, avoidT: 0, nav: null,
    hopT: MERCH_HOP_T, dir: 'down', moving: false, animT: 0, mvx: 0, mvy: 0, moveT: 0, idleT: 1,
    atkAim: null, atkCd: 0, mad: null, madT: 0, carry: 0, flash: 0, kbx: 0, kby: 0, dead: false,
  };
  clearUnitStatus(b);
  // the gate plan: the crash's stump ring, sorted by how far each stump sits
  // off the lane's centreline on the field side - the nearest one each side
  // (outside the gap) takes a turret, the rest out to MERCH_GATE_W a wall
  const ring = [];
  const R = Math.ceil(BOOM_STUMP_R) + 1, ctx0 = Math.floor(e.x / TILE), cty0 = Math.floor(e.y / TILE);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const tx = ctx0 + dx, ty = cty0 + dy, o = objAt(tx, ty);
    if (!o || o.type !== 'stump') continue;
    const d = Math.hypot(dx, dy);
    if (d <= BOOM_R - 0.3 || d > BOOM_STUMP_R + 0.3) continue;
    const px = dx + 0.5 - (e.x / TILE - ctx0), py = dy + 0.5 - (e.y / TILE - cty0); // tiles, roost-relative
    const along = px * lx + py * ly, lat = px * -ly + py * lx;
    if (along <= 0 || Math.abs(lat) < MERCH_GATE_GAP || Math.abs(lat) > MERCH_GATE_W) continue;
    ring.push({ tx, ty, lat });
  }
  ring.sort((a, c) => Math.abs(a.lat) - Math.abs(c.lat));
  const tur = [ring.find((s) => s.lat < 0), ring.find((s) => s.lat > 0)].filter(Boolean);
  for (const s of tur) b.plan.push({ tx: s.tx, ty: s.ty, type: 'turret' });
  for (const s of ring) if (!tur.includes(s)) b.plan.push({ tx: s.tx, ty: s.ty, type: 'wall' });
  e.merchant = b;
  robots.push(b);
  burst(b.x, b.y - 4, '#f4f7ff', 10, 50, 0.5, true);
  burst(b.x, b.y - 2, TEAMS[skin(e.team)].mark, 5, 40, 0.45);
  return b;
}

// the merchant's frame: hop, then gate, then the rim, then keep to the roost.
// Every walk routes (navStep) and drops its goal when the route fails.
function updateMerchant(b, dt) {
  const e = b.roost;
  if (b.hopT > 0) { b.hopT -= dt; if (b.hopT <= 0) { burst(b.x, b.y + 2, '#eef4fb', 8, 45, 0.45, true); if (nearPlayer(b.x, b.y)) SFX.land(); } b.moving = false; return; }
  let moving = false, mvx = 0, mvy = 0;
  const from = { x: b.x, y: b.y };
  const walkToward = (px, py, reach) => {
    const n = navStep(b, px, py, PLAYER_R, MERCH_SPD, dt, reach);
    if (!n.ok) return -1;
    moving = true;
    return n.d;
  };
  const owner = players.find((p) => p.team === b.team) || player;
  // ---- serving: a counter is OPEN on this body, so everything else waits --
  // The shop IS this body and its reach is measured off it (the `shop`
  // banner, js/shop.js), so a merchant that walked off mid-sale would shut
  // its own counter in the customer's face. It drops the axe, stands where it
  // is and turns to them; the gate and the felling are still there afterwards.
  const cust = shopServing(b);
  if (cust) {
    b.moveT = 0;
    b.workT = 0;
    b.tgt = null; // the axe comes down: nothing is half-swung while it serves
    const cdx = cust.x - b.x, cdy = cust.y - b.y;
    b.dir = Math.abs(cdx) > Math.abs(cdy) ? (cdx > 0 ? 'right' : 'left') : (cdy > 0 ? 'down' : 'up');
    b.moving = false;
    b.animT = 0;
    return;
  }
  const unitOn = (tx, ty) => { // a body on or beside the tile: setting a solid site there would entomb it
    const cx = tx * TILE + 8, cy = ty * TILE + 8;
    for (const q of players) if (q.active && !q.dead && !inAir(q) && Math.abs(q.x - cx) < 8 + PLAYER_R && Math.abs(q.y - cy) < 8 + PLAYER_R) return true;
    for (const r of robots) if (!r.dead && r !== b && Math.abs(r.x - cx) < 8 + PLAYER_R && Math.abs(r.y - cy) < 8 + PLAYER_R) return true;
    return false;
  };
  // ---- the gate: walk to each planned stump and set the site ----------
  while (b.plan.length) {
    const s = b.plan[0], o = objAt(s.tx, s.ty);
    if (!o || o.type !== 'stump') { b.plan.shift(); continue; } // built on, or gone: next
    const px = s.tx * TILE + 8, py = s.ty * TILE + 8;
    if (Math.hypot(px - b.x, py - b.y) > 20) {
      if (walkToward(px, py, 1) < 0) { b.plan.push(b.plan.shift()); b.workT = 0; } // no route right now: try it last
      else b.workT = 0;
    } else if (unitOn(s.tx, s.ty)) {
      b.plan.push(b.plan.shift()); b.workT = 0;
    } else {
      b.tgt = o;
      b.workT += dt;
      if (b.workT >= MERCH_BUILD_T) {
        b.workT = 0; b.tgt = null;
        b.plan.shift();
        createStruct(s.tx, s.ty, s.type, 0, owner, true); // the eagle's own gate: nobody pays
        burst(px, py, '#eef4fb', 8, 40, 0.4, true);
        if (nearPlayer(px, py)) SFX.hammer();
      }
    }
    return finish();
  }
  // ---- the rim: fell the ring past the crash's stumps, no gold ----------
  // The nearest pine to the MERCHANT inside the ring that still has an open
  // side to stand on - the ones its own gate walled in are the forest's now.
  // A pine the route failed on goes on the avoid list for a while, a LIST
  // because one slot flips forever between two blocked trunks.
  if (b.tgt && objects[idx(b.tgt.tx, b.tgt.ty)] !== b.tgt) b.tgt = null;
  for (let i = b.avoids.length - 1; i >= 0; i--) if ((b.avoids[i].t -= dt) <= 0) b.avoids.splice(i, 1);
  if (!b.tgt) {
    b.thinkT -= dt;
    if (b.thinkT <= 0) {
      b.thinkT = MERCH_THINK;
      const openSide = (o) => !isSolidTile(o.tx + 1, o.ty) || !isSolidTile(o.tx - 1, o.ty) || !isSolidTile(o.tx, o.ty + 1) || !isSolidTile(o.tx, o.ty - 1);
      b.tgt = nearestObj(b.x, b.y, Math.ceil(MERCH_CLEAR_R) + 2, (o) => (o.type === 'tree' || o.type === 'deadTree') &&
        Math.hypot(o.tx * TILE + 8 - e.x, o.ty * TILE + 8 - e.y) <= MERCH_CLEAR_R * TILE &&
        !b.avoids.some((a) => a.o === o) && openSide(o));
    }
  }
  if (b.tgt) {
    const t = b.tgt, px = t.tx * TILE + 8, py = t.ty * TILE + 8;
    if (Math.hypot(px - b.x, py - b.y) > 20) {
      if (walkToward(px, py, 1) < 0) { b.avoids.push({ o: t, t: 12 }); b.tgt = null; }
      b.workT = 0;
    } else {
      b.workT += dt;
      if (b.workT >= MERCH_SWING_T) {
        b.workT = 0;
        t.hp--; t.flash = 0.1; t.shake = 0.22;
        if (nearPlayer(px, py)) SFX.chop();
        burst(px, py - 10, '#eef4fb', 3, 35, 0.4, true);
        if (t.hp <= 0) {
          objects[idx(t.tx, t.ty)] = { type: 'stump', tx: t.tx, ty: t.ty, flash: 0, shake: 0 };
          burst(px, py - 8, '#eef4fb', 8, 45, 0.5, true);
          burst(px, py - 8, t.type === 'tree' ? '#2f5c4b' : '#6b5a48', 5, 45, 0.5, true);
          if (nearPlayer(px, py)) SFX.treeFall();
          if (t.type === 'deadTree') flushBirds(landmarkAt(px, py), { x: px, y: py });
          b.tgt = null;
        }
      }
    }
    return finish();
  }
  // ---- done: keep to the mouth of the lane, a step or two either way ----
  const postX = e.x + e.laneDir.x * (EAGLE_TILE_R + 1.6) * TILE, postY = e.y + e.laneDir.y * (EAGLE_TILE_R + 1.6) * TILE;
  if (b.moveT > 0) {
    b.moveT -= dt;
    moving = true;
    const drag = unitMoveMul(b);
    const mv = moveEntity(b, (b.mvx * 24 * drag + b.kbx) * dt, (b.mvy * 24 * drag + b.kby) * dt, PLAYER_R);
    if (mv.blockedX || mv.blockedY) b.moveT = 0;
  } else {
    b.idleT -= dt;
    if (Math.abs(b.kbx) + Math.abs(b.kby) > 1) moveEntity(b, b.kbx * dt, b.kby * dt, PLAYER_R);
    if (b.idleT <= 0) {
      let ang = rng() * Math.PI * 2;
      if (Math.hypot(postX - b.x, postY - b.y) > 2 * TILE) ang = Math.atan2(postY - b.y, postX - b.x) + rand(-0.5, 0.5);
      b.mvx = Math.cos(ang); b.mvy = Math.sin(ang);
      b.moveT = rand(0.4, 1); b.idleT = rand(1.5, 3.5);
    }
  }
  return finish();

  function finish() {
    mvx = b.x - from.x; mvy = b.y - from.y;
    if (moving && (Math.abs(mvx) > 0.01 || Math.abs(mvy) > 0.01)) {
      b.dir = Math.abs(mvx) > Math.abs(mvy) ? (mvx > 0 ? 'right' : 'left') : (mvy > 0 ? 'down' : 'up');
    } else if (b.tgt) { // face the work
      const dx = b.tgt.tx * TILE + 8 - b.x, dy = b.tgt.ty * TILE + 8 - b.y;
      b.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }
    b.animT += dt * (moving ? 8 : 0);
    b.moving = moving;
    b.x = Math.max(8, Math.min(WORLD * TILE - 8, b.x));
    b.y = Math.max(8, Math.min(WORLD * TILE - 8, b.y));
  }
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
    if (!unitAlive(b) || b.team === team) continue;
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
    if (r === b || !unitAlive(r) || r.team === b.team) continue;
    const d = Math.hypot(r.x - b.x, r.y - 1 - b.y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
// the blow itself: a building goes through hurtStruct (the same path an E
// swing takes), any BODY through the one blow every unit takes (hurtUnit,
// js/actions.js), all credited to the bay's owner so a worker kill still pays
// and still levels
function robotStrike(b, e, pt) {
  const src = players[b.owner] || null;
  const d = Math.hypot(pt.x - b.x, pt.y - (b.y - 1)) || 1;
  const nx = (pt.x - b.x) / d, ny = (pt.y - (b.y - 1)) / d;
  if (nearPlayer(b.x, b.y)) SFX.swing();
  if (e.tx !== undefined) hurtStruct(e, ROBOT_DMG, src);
  else hurtUnit(e, ROBOT_DMG, nx, ny, src, { cause: 'worker' });
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
