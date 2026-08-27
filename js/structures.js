'use strict';
// Everything built: the STRUCTS table every buildable is an entry in,
// placing/upgrading/wrecking stump structures, and the per-type building sim
// (turrets, generators, bays, nets, keeps). The bots a bay rolls out are
// js/robots.js, which loads next.
// ------------------------------------------------------------ stump structures
// Stump-built structures: right-click a stump, pick from the radial wheel.
// tiers[0] is what the wheel builds; tiers[1]/[2] cost/buildT are the upgrade
// price and (already shortened) upgrade construction time. `mm` and `map` are
// the two map colours, the same pair OBJECTS carries for scenery - both maps
// read whichever of the two tables holds the tile's type, so a new building
// is coloured by its entry here and nothing else.
const STRUCTS = {
  wall: { name: 'WALL', mm: [163, 121, 79], map: [112, 78, 46], tiers: [
    { cost: { gold: 5 },  hp: 60,  buildT: 4   },
    { cost: { gold: 12 }, hp: 140, buildT: 2.4 },
    { cost: { gold: 30 }, hp: 300, buildT: 2.4 },
  ]},
  // traverse = rad/s the head swings; aim = seconds held on target before it fires
  turret: { name: 'TURRET', mm: [196, 120, 86], map: [150, 96, 70], tiers: [
    { cost: { gold: 10 }, hp: 50,  buildT: 8,   range: 60, dmg: 6,  rate: 1.0,  traverse: 2.2, aim: 0.55 },
    { cost: { gold: 25 }, hp: 90,  buildT: 4.8, range: 76, dmg: 9,  rate: 0.8,  traverse: 3.0, aim: 0.45 },
    { cost: { gold: 50 }, hp: 140, buildT: 4.8, range: 92, dmg: 14, rate: 0.65, traverse: 3.8, aim: 0.35 },
  ]},
  generator: { name: 'GENERATOR', mm: [120, 180, 196], map: [96, 130, 150], tiers: [
    { cost: { gold: 12 }, hp: 40,  buildT: 8,   pay: 1, period: 10 },
    { cost: { gold: 25 }, hp: 70,  buildT: 4.8, pay: 2, period: 10 },
    { cost: { gold: 45 }, hp: 100, buildT: 4.8, pay: 4, period: 10 },
  ]},
  // the bot bay is the one big build: a single tier on a 3x2 tile footprint
  // (w/h - see footprint()/findSite()), its three bots rolling out one by one
  spawner: { name: 'BOT BAY', w: 3, h: 2, mm: [170, 140, 220], map: [128, 104, 160], tiers: [
    { cost: { gold: 45 }, hp: 220, buildT: 16, bots: 3, botHp: 24 },
  ]},
  // The fish net: the one building that goes on water instead of a stump.
  // `water: true` is the whole difference, and every site reads that flag
  // rather than the type name - it builds on an open hole (placeStruct),
  // never freezes over while it stands (the dawn refreeze), and is not solid
  // (isSolidTile), because walking onto it is how anyone - owner or not -
  // takes the catch out of it.
  net: { name: 'FISH NET', water: true, mm: [150, 186, 200], map: [118, 156, 176], tiers: [
    { cost: { gold: 8 }, hp: 45, buildT: 5 },
  ]},
  // the team's Keep: a 2x2 singleton (see teamHasLivingKeep) that a downed
  // teammate respawns at (see updateRespawns) and that crafts roguelike
  // cards (see startCraft/updateStructures' keep branch) - "queue card" pays
  // craftCost and runs craftT, independent of the buildT/upgrade timer.
  // odds is the rarity table a completed craft rolls against (see CARDS).
  keep: { name: 'KEEP', w: 2, h: 2, mm: [224, 96, 96], map: [196, 70, 70], tiers: [
    { cost: { gold: 60 },  hp: 260, buildT: 22, craftCost: 40, craftT: 20,
      odds: { white: .55, green: .28, blue: .13, purple: .035, gold: .005 } },
    { cost: { gold: 130 }, hp: 400, buildT: 13, craftCost: 40, craftT: 20,
      odds: { white: .35, green: .32, blue: .22, purple: .09,  gold: .02  } },
    { cost: { gold: 220 }, hp: 560, buildT: 13, craftCost: 40, craftT: 20,
      odds: { white: .18, green: .27, blue: .30, purple: .18,  gold: .07  } },
  ]},
};
const STRUCT_ORDER = ['wall', 'turret', 'generator', 'spawner', 'keep']; // stump wheel: 5 even wedges
const WATER_STRUCT_ORDER = ['net']; // open-hole wheel: one wedge, the whole circle

// fish nets: a building laid over an open hole that fishes it on its own
const NET_CAP = 3;         // fish a net holds before it stops catching
const NET_R = 9;           // px from the net's centre a fish is caught at
const NET_LURE = 44;       // ...and px it draws fish gently toward
const NET_CATCH_T = 2.2;   // seconds between catches, so a net fills visibly
const NET_TAKE_T = 0.3;    // seconds between fish handed to whoever stands on it

function cumulativeCost(type, tier) {
  const total = {};
  for (let t = 0; t <= tier; t++) {
    const c = STRUCTS[type].tiers[t].cost;
    for (const k in c) total[k] = (total[k] || 0) + c[k];
  }
  return total;
}

// Building is a contested order: two players can claim the same stump in one
// step. The claim is checked and paid for when it wins, so a loser keeps its
// gold. p defaults to the local player (DBG staging).
function placeStruct(tx, ty, type, p) {
  p = p || player;
  const deny = (msg, t) => { if (p === player) { SFX.deny(); if (msg) showMsg(msg, t); } };
  // Two kinds of site, and the type picks which: a `water` building wants a
  // bare open hole (nothing on it, ground 2), everything else wants a stump.
  const water = !!STRUCTS[type].water;
  const site = objAt(tx, ty);
  if (water ? (site || !inWorld(tx, ty) || ground[idx(tx, ty)] !== 2)
            : (!site || site.type !== 'stump')) { deny(); return; }
  const cxp = tx * TILE + 8, cyp = ty * TILE + 8;
  if (Math.hypot(cxp - p.x, cyp - p.y) > 60) { deny(); return; }
  const big = structW(type) > 1 || structH(type) > 1;
  // the solid buildings must never entomb the player who ordered one
  // (findSite does the same check over a big footprint); a net is walked on,
  // so standing over the hole is exactly where you set one from
  if (!big && !water && Math.abs(cxp - p.x) < 8 + PLAYER_R && Math.abs(cyp - p.y) < 8 + PLAYER_R) {
    deny('STEP OFF THE STUMP FIRST', 1.6);
    return;
  }
  if (type === 'keep' && teamHasLivingKeep(p.team)) { deny('ALREADY HAVE A KEEP', 1.6); return; }
  const t0 = STRUCTS[type].tiers[0];
  if (!canAfford(t0.cost, p)) { deny('NOT ENOUGH RESOURCES', 1.6); return; }
  let anchor = { tx, ty };
  if (big) {
    anchor = findSite(type, tx, ty);
    if (!anchor) { deny('NO ROOM - NEEDS 3X2 CLEAR SNOW', 1.8); return; }
  }
  contest('site:' + idx(tx, ty), p, () => {
    const s = objAt(tx, ty);
    if (water ? (s || ground[idx(tx, ty)] !== 2) : (!s || s.type !== 'stump')) return;
    if (!canAfford(t0.cost, p)) return;
    // re-checked inside the contest callback (not just at the pre-contest
    // deny above): two teammates ordering a keep on two different stumps in
    // the same tick each pass the early check, but resolveContests() runs
    // every winning callback synchronously, so whichever key resolves first
    // creates the keep and the second sees it here and backs off
    if (type === 'keep' && teamHasLivingKeep(p.team)) return;
    if (big) { anchor = findSite(type, tx, ty); if (!anchor) return; }
    pay(t0.cost, p);
    createStruct(anchor.tx, anchor.ty, type, 0, p, true);
    if (nearPlayer(cxp, cyp)) SFX.hammer();
    burst(cxp, cyp, '#eef4fb', 8, 40, 0.4, true);
  });
}

// The one place a building object is made (placeStruct and DBG.buildStruct):
// the anchor object, its footprint fillers, the registry and per-type state.
function createStruct(tx, ty, type, tier, p, building) {
  const t = STRUCTS[type].tiers[tier];
  const o = placeObj(tx, ty, type, {
    tier, hp: building ? Math.ceil(t.hp * 0.3) : t.hp, maxHp: t.hp,
    building: !!building, buildT: 0, buildTotal: t.buildT, dustT: 0,
    owner: p.id, team: p.team, // paints the sprite and gates the manage wheel
  });
  for (const [x, y] of footprint(type, tx, ty)) {
    if (x !== tx || y !== ty) objects[idx(x, y)] = { type: 'part', tx: x, ty: y, of: o, flash: 0, shake: 0 };
  }
  // ang: where the barrel points. tgt/chg: the mark and how locked on it is.
  // rec/mz: recoil slide and muzzle flash. scan: the idle sweep's phase.
  if (type === 'turret') { o.cd = 0; o.ang = -Math.PI / 2; o.tgt = null; o.chg = 0; o.rec = 0; o.mz = 0; o.scan = 0; }
  if (type === 'generator') o.payT = 0;
  if (type === 'spawner') { o.bots = []; o.respawnT = o.respawnTotal = 1; o.door = 1; }
  if (type === 'keep') { o.craftT = 0; o.craftTotal = 0; }
  // fish: what the net is holding. catchT/takeT are the two clocks that let
  // it fill and empty a fish at a time instead of all at once
  if (type === 'net') { o.fish = 0; o.catchT = NET_CATCH_T; o.takeT = 0; }
  o.sparkT = 0;
  structures.push(o);
  return o;
}

// only the owning side may upgrade or demolish
function ownsStruct(o, p) { return o.team === undefined || o.team === p.team; }

// a team may have at most one Keep at a time - a Keep still under
// construction doesn't count (same reason updateStructures refuses to run a
// generator's payout or a spawner's roll-out on an unfinished building: a
// team shouldn't dodge permadeath the instant the stump is claimed). Used to
// gate a second build order, and as the "does this team still have a way
// back" read for respawns and the win condition.
function teamHasLivingKeep(team) {
  return structures.some((o) => o.type === 'keep' && o.team === team && !o.building);
}

// one gold-paid card craft at a time per Keep. o.craftT/craftTotal live on
// the structure object; ticked in updateStructures' keep branch, exactly
// like a generator's payT countdown. Starting an upgrade freezes it for
// free (the whole per-type branch is skipped while o.building), and
// destroying the Keep mid-craft forfeits the gold and the card in progress -
// no refund path, same as a turret's charge or a spawner's mid-roll bot.
function startCraft(o, p) {
  p = p || player;
  const deny = (msg, t) => { if (p === player) { SFX.deny(); if (msg) showMsg(msg, t); } };
  if (o.building || !ownsStruct(o, p)) { deny(); return; }
  if (o.craftT > 0) { deny('ALREADY CRAFTING', 1.4); return; }
  const t = STRUCTS.keep.tiers[o.tier];
  const cost = { gold: t.craftCost };
  if (!canAfford(cost, p)) { deny('NOT ENOUGH RESOURCES', 1.6); return; }
  pay(cost, p);
  o.craftT = o.craftTotal = t.craftT;
  if (nearPlayer(o.tx * TILE + 16, o.ty * TILE + 16)) SFX.hammer();
}

// rolls a rarity against tier.odds using the shared runtime rng() - never
// called from genWorld, so this never perturbs a seed's terrain
function rollCardRarity(odds) {
  let r = rng(), acc = 0;
  for (const rarity of CARD_RARITIES) {
    acc += odds[rarity] || 0;
    if (r < acc) return rarity;
  }
  return CARD_RARITIES[0];
}

function startUpgrade(o, p) {
  p = p || player;
  const deny = (msg, t) => { if (p === player) { SFX.deny(); if (msg) showMsg(msg, t); } };
  if (o.building || !ownsStruct(o, p)) { deny(); return; }
  if (o.tier >= STRUCTS[o.type].tiers.length - 1) { deny('MAX TIER', 1.4); return; }
  const t = STRUCTS[o.type].tiers[o.tier + 1];
  if (!canAfford(t.cost, p)) { deny('NOT ENOUGH RESOURCES', 1.6); return; }
  pay(t.cost, p);
  o.tier++;
  o.maxHp = t.hp;
  o.building = true;
  o.buildT = 0;
  o.buildTotal = t.buildT;
  o.dustT = 0;
  if (nearPlayer(o.tx * TILE + 8, o.ty * TILE + 8)) SFX.hammer();
  burst(o.tx * TILE + 8, o.ty * TILE + 8, '#eef4fb', 8, 40, 0.4, true);
}

function demolishStruct(o, p) {
  if (!ownsStruct(o, p || player)) { if ((p || player) === player) SFX.deny(); return; }
  destroyStructure(o, true);
}

function removeStruct(o) {
  for (const [x, y] of footprint(o.type, o.tx, o.ty)) objects[idx(x, y)] = null;
  const i = structures.indexOf(o);
  if (i >= 0) structures.splice(i, 1);
  if (o.bots) for (const b of o.bots) {
    if (!b.dead) {
      b.dead = true;
      burst(b.x, b.y - 4, '#98a1b0', 8, 45, 0.5, true);
    }
  }
}

function rebuildLights() {
  // nothing currently emits light (campfires/torches went with the old hotbar);
  // kept as the single rebuild point for any future glowing object type
  lights.length = 0;
}

// ------------------------------------------------------------ the building sim
const RES_COLORS = {
  gold: '#f2cc6a', berry: '#f2707a', fish: '#7ac0e8',
  // card rarities - kept out of the amber family so a "gold" card drop never
  // reads as a currency floater; must match CARD_PALS in sprites.js
  cardWhite: '#d9dfe8', cardGreen: '#5fd18a', cardBlue: '#4a90e2', cardPurple: '#a259e6', cardGold: '#e8a33d',
};
// audio/screen gating: is this happening near the local listener?
function nearPlayer(x, y, r) { return !!player && Math.hypot(player.x - x, player.y - y) < (r || 180); }

// ---- turret gunnery ------------------------------------------------------
// turret gunnery. The head is NOT baked into the sprite (see js/sprites.js) - it
// is rasterised at the live angle, pivoting on sprite-local (16, 14).
const TUR_PIVOT_Y = -4;   // px: the pivot, relative to the anchor tile's top edge
const TUR_BARREL = 16;    // px from pivot to muzzle
const TUR_LOCK = 0.14;    // rad: inside this of the mark, the shot starts charging
const TUR_MZ = 0.09;      // muzzle flash duration
const BOLT_SPD = 250;     // px/s
const BOLT_LIFE = 1.1;

// The head pivots above the tile, so every bearing, range and sight line is
// measured from there rather than from the footprint's centre.
function turretPivot(o) { return { x: (o.tx + 0.5) * TILE, y: o.ty * TILE + TUR_PIVOT_Y }; }
// players carry an `input` struct, worker bots do not - aim at the body of each
function turretAimY(tg) { return tg.input ? tg.y - BOW_Y : tg.y - 4; }
function turretMuzzle(o) {
  const pv = turretPivot(o), c = Math.cos(o.ang || 0), sn = Math.sin(o.ang || 0);
  const r = TUR_BARREL - (o.rec || 0) * 3;
  return { x: pv.x + c * r, y: pv.y + sn * r, nx: c, ny: sn };
}
// bolts die on solid tiles, so a turret that cannot see its mark holds fire
// rather than shooting the wall in front of it. Its own footprint is skipped:
// the pivot sits above the tile, so the first samples fall back inside the mount.
function turretSees(o, pv, tx, ty) {
  const dx = tx - pv.x, dy = ty - pv.y, d = Math.hypot(dx, dy) || 1;
  for (let s2 = 6; s2 < d; s2 += 6) {
    const gx = Math.floor((pv.x + dx / d * s2) / TILE), gy = Math.floor((pv.y + dy / d * s2) / TILE);
    if (structOf(objAt(gx, gy)) === o) continue;
    if (isSolidTile(gx, gy)) return false;
  }
  return true;
}
// a valid mark is an enemy player (never one still on the eagle) or worker bot
function turretFoe(o, tg) {
  if (!tg || tg.dead || tg.team === o.team) return false;
  return tg.input ? (tg.active && !inAir(tg)) : true;
}
function turretHolds(o, tg, range, pv) {
  return turretFoe(o, tg) &&
    Math.hypot(tg.x - pv.x, turretAimY(tg) - pv.y) <= (tg instanceof Player ? seenAt(tg, range) : range) &&
    turretSees(o, pv, tg.x, turretAimY(tg));
}
function turretMark(o, range, pv) {
  let best = null, bd = range;
  const test = (tg) => {
    if (!turretFoe(o, tg)) return;
    const d = Math.hypot(tg.x - pv.x, turretAimY(tg) - pv.y);
    // GHOSTSTEP - and a body buried in the snow - shrink the ring this target
    // is acquired (and held) inside
    if (d > (tg instanceof Player ? seenAt(tg, range) : range)) return;
    if (d < bd && turretSees(o, pv, tg.x, turretAimY(tg))) { bd = d; best = tg; }
  };
  for (const p of players) test(p);
  for (const b of robots) test(b);
  return best;
}
// the shot leaves the barrel tip and rides the normal arrow pipeline, so it
// hits players and animals, respects friendly fire, and credits the owner
function fireBolt(o, t, pv) {
  const m = turretMuzzle(o), team = o.team === undefined ? 0 : o.team;
  // A turret is a solid tile and bolts die on solid tiles, so a depressed barrel
  // would otherwise shoot itself: walk the spawn point out of our own footprint.
  let bx = m.x, by = m.y;
  for (let g = 0; g < 8 && structOf(objAt(Math.floor(bx / TILE), Math.floor(by / TILE))) === o; g++) {
    bx += m.nx * 4; by += m.ny * 4;
  }
  arrows.push({
    kind: 'bolt', x: bx, y: by,
    vx: m.nx * BOLT_SPD, vy: m.ny * BOLT_SPD,
    t: 0, life: BOLT_LIFE, dmg: t.dmg, pow: 1,
    owner: o.owner === undefined ? 0 : o.owner, team: team, trailD: 0,
  });
  burst(m.x, m.y, TEAMS[team].mark, 4, 60, 0.22, true);
  if (nearPlayer(pv.x, pv.y)) SFX.turretFire();
}

function updateStructures(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].t -= dt;
    if (tracers[i].t <= 0) tracers.splice(i, 1);
  }
  for (const o of structures) {
    const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
    if (o.building) {
      o.buildT += dt;
      // SC2-style: hp grows from the 30% floor toward max as the site rises
      o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.7 * dt / o.buildTotal);
      o.dustT -= dt;
      const big = structW(o.type) > 1 || structH(o.type) > 1;
      if (o.dustT <= 0) {
        o.dustT = 0.8;
        if (nearPlayer(ox, oy)) SFX.building();
        if (big) {
          // dust off the whole footprint's front edge
          const c = structCenter(o);
          burst(c.x + rand(-18, 18), (o.ty + structH(o.type)) * TILE - 2, '#c9d0e2', 3, 25, 0.35, true);
        } else burst(ox, oy + 4, '#c9d0e2', 3, 25, 0.35, true);
      }
      if (big) {
        // sparks off the weld line while the walls rise (see bigBuildReveal)
        const r = bigBuildReveal(o);
        o.sparkT -= dt;
        if (r.rows > 0 && r.rows < r.h && o.sparkT <= 0) {
          o.sparkT = 0.11;
          const x = o.tx * TILE + 3 + rng() * (structW(o.type) * TILE - 6);
          burst(x, r.edgeY, rng() < 0.5 ? '#fff1b0' : '#ffb347', 2, 45, 0.28, true);
        }
      }
      if (o.buildT >= o.buildTotal) {
        o.building = false;
        o.hp = o.maxHp;
        o.flash = 0.3; // the completion flash
        if (big) {
          // snow settles along the whole roofline
          const top = (o.ty + structH(o.type)) * TILE - structSprite(o).height + 4;
          for (let i = 0; i < 6; i++) burst(o.tx * TILE + 4 + i * 8, top, '#f4f7fc', 3, 35, 0.6, true);
          burst(structCenter(o).x, top + 12, '#aeb6c4', 8, 50, 0.5, true);
        } else {
          burst(ox, oy - 4, '#8a6142', 12, 55, 0.6, true);
          burst(ox, oy - 4, '#eef4fb', 10, 50, 0.6, true);
          burst(ox, oy - 4, o.tier === 2 ? '#f2cc6a' : o.tier === 1 ? '#a8b0c4' : '#c9a06a', 6, 45, 0.5, true);
        }
        if (nearPlayer(ox, oy)) { SFX.hammer(); state.shake = Math.max(state.shake, big ? 2.5 : 1.5); }
        if (o.type === 'turret') o.cd = 0;
        if (o.type === 'generator') o.payT = STRUCTS.generator.tiers[o.tier].period;
        if (o.type === 'spawner') { o.respawnT = o.respawnTotal = 1; }
      }
      continue;
    }
    const t = STRUCTS[o.type].tiers[o.tier];
    if (o.type === 'turret') {
      o.cd -= dt;
      o.rec = Math.max(0, o.rec - dt * 7);
      o.mz = Math.max(0, o.mz - dt);
      const pv = turretPivot(o);
      if (o.tgt && !turretHolds(o, o.tgt, t.range, pv)) o.tgt = null;
      if (!o.tgt) o.tgt = turretMark(o, t.range, pv);
      let want, rate = t.traverse;
      if (o.tgt) {
        want = Math.atan2(turretAimY(o.tgt) - pv.y, o.tgt.x - pv.x);
      } else {
        // idle sweep, at a third of the traverse: a live turret should never
        // read as a dead prop, and the sweep telegraphs its arc to a raider
        o.scan += dt * 0.55;
        want = -Math.PI / 2 + Math.sin(o.scan) * 1.15;
        rate = t.traverse * 0.35;
      }
      let da = want - o.ang;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const step = rate * dt;
      o.ang += Math.max(-step, Math.min(step, da));  // swing, never snap
      if (o.tgt && Math.abs(da) < TUR_LOCK) {
        o.chg = Math.min(1, o.chg + dt / t.aim);
        if (o.chg >= 1 && o.cd <= 0) {
          fireBolt(o, t, pv);
          o.cd = t.rate; o.chg = 0; o.rec = 1; o.mz = TUR_MZ;
        }
      } else {
        o.chg = Math.max(0, o.chg - dt * 2.5); // lost the lock: bleed the charge
      }
    } else if (o.type === 'generator') {
      o.payT -= dt;
      if (o.payT <= 0) {
        o.payT = t.period;
        let near = 0;
        for (const d of drops) if (Math.hypot(d.x - ox, d.y - oy) < 24) near++;
        if (near < 6) { // cap the AFK pile
          spawnDrop(ox, oy - 2, 'gold', t.pay);
          addFloater(ox, oy - 12, '+' + t.pay, RES_COLORS.gold);
          burst(ox, oy - 6, '#c9d0e2', 2, 20, 0.3);
          if (nearPlayer(ox, oy)) SFX.coin();
        }
      }
    } else if (o.type === 'spawner') {
      // bots roll out one after another (4 s apart); a lost bot takes 12 s to replace
      const alive = o.bots.filter((b) => !b.dead);
      if (alive.length < o.bots.length && o.respawnT < 12) { o.respawnT = o.respawnTotal = 12; }
      o.bots = alive;
      const due = o.bots.length < t.bots;
      if (due) {
        o.respawnT -= dt;
        if (o.respawnT <= 0) {
          o.respawnT = o.respawnTotal = 4;
          const b = makeRobot(o);
          o.bots.push(b);
          robots.push(b);
          burst(b.x, b.y - 4, '#c3c9d3', 6, 35, 0.4, true);
          burst(b.x, b.y + 2, '#e4e8ee', 5, 30, 0.45, true); // exhaust off the mouth
          // Your first worker: the one time the flag says it exists. It has
          // no resting affordance by design (`worker flags`, js/robots.js),
          // so it needs the same one-shot nudge the first stump gets.
          if (b.owner === player.id && !state.hints.flag) {
            state.hints.flag = true;
            showMsg('HOLD MIDDLE MOUSE TO ORDER YOUR WORKERS', 5);
          }
        }
      }
      // the shutter: open while a worker is out in the yard or one is rolling
      // out, shut when the whole crew is home - so the door reports the bay's
      // state rather than a mode nobody sets any more
      const mo = structMouth(o);
      const out = o.bots.some((b) => !b.dead && Math.hypot(b.x - mo.x, b.y - mo.y) > 20);
      const want = (out || (due && o.respawnT < 1.4)) ? 1 : 0;
      o.door += Math.sign(want - o.door) * Math.min(Math.abs(want - o.door), dt * 2.2);
    } else if (o.type === 'net') {
      // The net fishes on its own: any born fish that swims over the rope is
      // caught and comes out of the shoal (which is what the trickle in
      // updateFish refills), one every NET_CATCH_T so a net visibly fills
      // rather than snapping shut on the whole pond at once.
      o.catchT -= dt;
      if (o.fish < NET_CAP && o.catchT <= 0) {
        for (let k = fish.length - 1; k >= 0; k--) {
          const f = fish[k];
          if (!f.born || Math.hypot(f.x - ox, f.y - oy) > NET_R) continue;
          fish.splice(k, 1);
          o.fish++;
          o.catchT = NET_CATCH_T;
          if (nearPlayer(ox, oy)) SFX.splash();
          burst(ox, oy, '#7fa9c6', 6, 40, 0.4, true);
          burst(ox, oy, '#ddf1f8', 5, 45, 0.4, true);
          break;
        }
      }
      // ...and it hands the catch to whoever is standing on it, theirs or
      // not: a net is a thing lying on the ice, not a locked chest. Contested,
      // so two players over one rope cannot take the same fish.
      o.takeT -= dt;
      if (o.fish > 0 && o.takeT <= 0) {
        for (const p of players) {
          if (!p.active || p.dead || inAir(p)) continue;
          if (Math.floor(p.x / TILE) !== o.tx || Math.floor((p.y + 4) / TILE) !== o.ty) continue;
          if (bagRoom(p, 'fish') <= 0) { if (p === player) bagDenied(); continue; }
          contest('net:' + idx(o.tx, o.ty), p, () => {
            if (o.fish <= 0 || bagAdd(p, 'fish', 1) < 1) return;
            o.fish--;
            o.takeT = NET_TAKE_T;
            addFloater(p.x, p.y - 14, '+1', RES_COLORS.fish);
            if (p === player) SFX.stash();
          });
        }
      }
    } else if (o.type === 'keep' && o.craftT > 0) {
      // mirrors the generator's payT countdown; freezes for free while
      // o.building (an upgrade), since this whole branch is skipped above
      o.craftT -= dt;
      if (o.craftT <= 0) {
        o.craftT = 0;
        const rarity = rollCardRarity(t.odds);
        const key = cardKey(rarity);
        const m = structMouth(o);
        spawnDrop(m.x, m.y, key, 1);
        addFloater(m.x, m.y - 12, rarity.toUpperCase() + ' CARD', RES_COLORS[key]);
        burst(m.x, m.y - 4, RES_COLORS[key], 10, 50, 0.5, true);
        if (nearPlayer(m.x, m.y)) SFX.stash();
      }
    }
  }
}
