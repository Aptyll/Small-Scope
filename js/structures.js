'use strict';
// Everything built: placing/upgrading/wrecking stump structures, the per-type
// building sim (turrets, generators, bays, nets, keeps), worker bots and the
// one flag per player that orders them.
// ------------------------------------------------------------ stump structures
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

// ------------------------------------------------------------ structures & robots
const RES_COLORS = {
  gold: '#f2cc6a', berry: '#f2707a', fish: '#7ac0e8',
  // card rarities - kept out of the amber family so a "gold" card drop never
  // reads as a currency floater; must match CARD_PALS in sprites.js
  cardWhite: '#d9dfe8', cardGreen: '#5fd18a', cardBlue: '#4a90e2', cardPurple: '#a259e6', cardGold: '#e8a33d',
};
// audio/screen gating: is this happening near the local listener?
function nearPlayer(x, y, r) { return !!player && Math.hypot(player.x - x, player.y - y) < (r || 180); }

// ---- turret gunnery ------------------------------------------------------
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
          // no resting affordance by design (see the `worker flags` banner),
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

// ---- what a flag looks like ---------------------------------------------
// the job glyph, 7x7 about (x, y), stamped with the 1px dark rim a landmark's
// icon uses so it reads on snow, on parchment and on team cloth alike
function drawFlagIcon(g, job, x, y, col, rim) {
  const spec = FLAG_JOBS[job];
  if (!spec) return;
  const x0 = Math.round(x) - 3, y0 = Math.round(y) - 3;
  g.fillStyle = rim || '#0f1632';
  for (const [rx, ry, rw, rh] of spec.icon) g.fillRect(x0 + rx - 1, y0 + ry - 1, rw + 2, rh + 2);
  g.fillStyle = col || spec.col;
  for (const [rx, ry, rw, rh] of spec.icon) g.fillRect(x0 + rx, y0 + ry, rw, rh);
}
// the small marker - a pole and a pennant, (x, y) is its FOOT. Both maps and
// the pick-up cursor draw the same one, so a flag is the same shape whatever
// it is standing on.
function drawFlagPennant(g, x, y, col, rim) {
  const px = Math.round(x), py = Math.round(y);
  const rects = [[px, py - 7, 1, 8], [px + 1, py - 7, 4, 3]];
  g.fillStyle = rim || '#0f1632';
  for (const [rx, ry, rw, rh] of rects) g.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
  g.fillStyle = col;
  for (const [rx, ry, rw, rh] of rects) g.fillRect(rx, ry, rw, rh);
}
// The planted flag itself, in the world pass (y-sorted with the entities): a
// pole at the tile's centre and a dark banner on it carrying the SAME job
// icon the cursor previewed, inked in the team's colour - so what the crew
// was told, and who told them, both read from across the field. Dark cloth
// and a bright glyph, not the other way round: at nine pixels square a solid
// colour with a hole punched in it is a blob, and the glyph is the message.
function drawFlag(q, ex, ey, now) {
  const f = q.flag;
  const bx = Math.round(f.tx * TILE + 8 - ex), by = Math.round((f.ty + 1) * TILE - 2 - ey);
  const col = TEAMS[q.team].mark;
  ctx.fillStyle = 'rgba(110,130,170,0.35)';
  ctx.fillRect(bx - 3, by - 1, 7, 2);
  ctx.fillStyle = '#0f1632'; ctx.fillRect(bx - 1, by - 21, 3, 21);
  ctx.fillStyle = '#c9d0e2'; ctx.fillRect(bx, by - 20, 1, 19);
  ctx.fillStyle = col; ctx.fillRect(bx - 1, by - 4, 3, 3); // a team-coloured collar at the foot
  const w = Math.round(Math.sin(now * 2.4 + f.tx)); // 1px of flutter
  ctx.fillStyle = '#0f1632';
  ctx.fillRect(bx + w, by - 21, 13, 11);
  ctx.fillStyle = '#141c3c';
  ctx.fillRect(bx + 1 + w, by - 20, 11, 9);
  drawFlagIcon(ctx, f.job, bx + 6 + w, by - 16, col, '#141c3c');
}
// Does this slot have anyone to command? A live worker, or a bay that is
// about to roll one out - the affordance has to be there the moment the bay
// is up, not only once the first bot is in the yard. No crew, no preview.
function hasWorkers(p) {
  for (const b of robots) if (!b.dead && b.owner === p.id) return true;
  for (const o of structures) if (o.type === 'spawner' && o.owner === p.id) return true;
  return false;
}
// the pointer is over HUD that owns its own clicks, not over the world
function overHud(x, y) {
  return !!bagHit(x, y) || gearHit(x, y) >= 0 || !!abHit(x, y) || overMinimap();
}
// THE PREVIEW, and it is only up while the middle button is HELD
// (state.flagAim). Everything else in this game that previews, previews
// something you are already doing - the aim line needs a drawn bow, the build
// wheel a held right-click - and an order you have not started is no
// different. It comes in two halves because they live in two spaces:
// drawFlagAim() marks the target TILE in the world pass (so its brackets
// scale with the tile, like drawSelection's), and drawFlagCursor() rides the
// pointer in the UI pass at a fixed size. Both read flagTarget().
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
// the target tile, in the world pass: drawSelection's four corner brackets,
// dark rim first so they read on snow. Steady, not pulsing - the E bracket
// breathes to catch an eye that is not looking, and this one is only on
// screen because a hand is already holding it there.
function drawFlagAim(ox, oy) {
  if (state.mapOpen) return;
  const t = flagTarget();
  if (!t) return;
  const bx = t.tx * TILE - ox, by = t.ty * TILE - oy;
  const corners = (c, px, py) => {
    ctx.fillStyle = c;
    ctx.fillRect(px, py, 3, 1); ctx.fillRect(px, py, 1, 3);
    ctx.fillRect(px + TILE - 3, py, 3, 1); ctx.fillRect(px + TILE - 1, py, 1, 3);
    ctx.fillRect(px, py + TILE - 1, 3, 1); ctx.fillRect(px, py + TILE - 3, 1, 3);
    ctx.fillRect(px + TILE - 3, py + TILE - 1, 3, 1); ctx.fillRect(px + TILE - 1, py + TILE - 3, 1, 3);
  };
  corners('rgba(15,22,50,0.9)', bx + 1, by + 1);
  corners(t.col, bx, by);
}
// ...and the order itself riding the pointer, clear of the reticle's ticks
function drawFlagCursor() {
  const t = flagTarget();
  if (!t) return;
  if (t.lift) drawFlagPennant(ctx, mouse.x + 9, mouse.y + 12, TEAMS[player.team].mark);
  else drawFlagIcon(ctx, t.job, mouse.x + 12, mouse.y + 9, t.col);
}

