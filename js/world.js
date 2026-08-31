'use strict';
// The frozen world: the tile grid and its objects, worldgen (rivers, ponds,
// rocks), and the named landmarks with their own seeded stream (lmRng).
// ------------------------------------------------------------ world
const ground = new Uint8Array(WORLD * WORLD); // 0 snow, 1 ice, 2 hole (open water)
const objects = new Array(WORLD * WORLD).fill(null);

function idx(tx, ty) { return ty * WORLD + tx; }
function inWorld(tx, ty) { return tx >= 0 && ty >= 0 && tx < WORLD && ty < WORLD; }
function objAt(tx, ty) { return inWorld(tx, ty) ? objects[idx(tx, ty)] : null; }

// Every scenery object that can stand on a tile, and everything generic code
// needs to know about one without naming its type: whether it blocks a walker,
// which tool E reaches for (`tool`) and which one a swing must already be
// holding (`needs`, null = any), the verb the key prompt prints and how far
// above the tile it sits, and the colour each of the two maps paints it.
// Buildings are NOT in here - they are STRUCTS entries carrying the same
// mm/map fields, and every site below asks that table first. Adding a scenery
// type is one entry here, plus its draw branch in render() and what a swing
// does to it in hitObject(): checklists.md#common-changes.
const OBJECTS = {
  // lift 33: the pine's canopy reaches 21 px above its own tile (drawn at
  // py - 21), and the prompt clears it by the same 12 px everything else gets
  tree:     { solid: true,  tool: 'axe',  needs: 'axe',  verb: 'CHOP', lift: 33,
              mm: [52, 100, 82],   map: treeMapPx },
  deadTree: { solid: true,  tool: 'axe',  needs: 'axe',  verb: 'CHOP', lift: 20,
              mm: [138, 128, 116], map: [150, 132, 108] },
  rock:     { solid: true,  tool: 'pick', needs: 'pick', verb: 'MINE', lift: 10,
              mm: [122, 131, 153], map: [104, 108, 118] },
  // a picked bush is still a bush: `ready` is what decides whether E offers it
  bush:     { solid: false, tool: 'axe',  needs: null,   verb: 'PICK', lift: 10,
              ready: (o) => o.berries > 0,
              mm: [88, 148, 108],  map: (o) => o.berries > 0 ? MAP_BUSH_RIPE : MAP_BUSH_BARE },
  // a buried cache swapped in for an inner-edge border tree (placeChests):
  // one free E press springs it - hitObject's chest branch pays the gold and
  // rolls the card. Any tool opens it, so `needs` stays null.
  chest:    { solid: true,  tool: 'axe',  needs: null,   verb: 'OPEN', lift: 12,
              mm: [242, 204, 100], map: [206, 160, 70] },
  den:      { solid: true,  mm: [92, 86, 100],   map: [86, 80, 92] },
  // the practice arena's target (the `practice arena` banner below): any tool
  // hits it, it never falls, and it mends itself between combos. E swings,
  // every bit and the roll's tackle all land through hitDummy (js/actions.js).
  dummy:    { solid: true,  tool: 'axe',  needs: null,   verb: 'HIT', lift: 28,
              mm: [216, 178, 122], map: [188, 148, 96] },
  // The training field's dressing (practice arena only): inert scenery like
  // the den - no `tool`, so E never offers them - drawn in the y-sorted pass.
  // The banner is the parkour gate's flag; the rack spans TWO tiles - the
  // left one carries `lead` and draws the whole sprite, the right tile is a
  // plain solid follower the draw pass skips.
  banner:   { solid: true,  mm: [214, 88, 76],   map: [186, 74, 62] },
  rack:     { solid: true,  mm: [168, 132, 92],  map: [150, 116, 80] },
  // the parkour roll station (practice arena only): the die that rerolls the
  // track. Inert to E's work verbs like the rack - holding E beside it opens
  // the roll wheel (pkDieNear, the practice arena banner below).
  pkdie:    { solid: true,  mm: [242, 204, 100], map: [206, 160, 70] },
  // the archery range's bell (practice arena only): E beside it rings the
  // timed round on and off. Inert to E's work verbs like the die - the press
  // resolves through agBellNear (the practice arena banner below).
  agbell:   { solid: true,  mm: [216, 158, 74],  map: [186, 132, 60] },
  stump:    { solid: false, mm: [188, 200, 218], map: [172, 138, 92] },
  // a roosting team eagle's hitbox tiles (placed by eagleCrash, js/boot.js):
  // solid to walkers and a work target for RIVAL E swings only - workTarget
  // reads the `team` an object carries. Drawn by drawEagle, never the object
  // pass; the swing itself lands in hitObject's eagle branch (hurtEagle).
  eagle:    { solid: true,  tool: 'axe',  needs: null,   verb: 'STRIKE', lift: 16,
              mm: (o) => o.team ? MM_EAGLE_BLUE : MM_EAGLE_RED,
              map: (o) => o.team ? MAP_EAGLE_BLUE : MAP_EAGLE_RED },
  // a multi-tile building's filler tiles: solid, and structOf() has resolved
  // them to their anchor long before either map sees one
  part:     { solid: true },
};
// The two entries whose map colour is not a constant. Both return one of a
// handful of shared arrays rather than a fresh one: buildWorldMapImg walks
// every tile in the world on every frame the map is open.
const MAP_BUSH_RIPE = [170, 72, 80], MAP_BUSH_BARE = [118, 128, 98];
const MM_EAGLE_RED = [224, 85, 72], MM_EAGLE_BLUE = [106, 168, 232];
const MAP_EAGLE_RED = [196, 74, 64], MAP_EAGLE_BLUE = [92, 140, 200];
const MAP_TREE_RIM = [116, 144, 104], MAP_TREE_DEEP = [44, 66, 50],
      MAP_TREE_MID = [60, 88, 64], MAP_TREE_LIT = [74, 102, 74];
// a canopy on the parchment: a lit rim wherever the tile above is not another
// tree, and one of three hash-picked shades of shade under one that is
function treeMapPx(o, i, h) {
  const up = i >= WORLD ? objects[i - WORLD] : o;
  if (!up || up.type !== 'tree') return MAP_TREE_RIM;
  if (h > 0.86) return MAP_TREE_DEEP;
  if (h > 0.45) return MAP_TREE_MID;
  return MAP_TREE_LIT;
}

// The colour whatever stands on a tile paints on a map: `mm` for the minimap
// disc, `map` for the parchment world map. One lookup across both tables, so
// neither map carries a list of type names and a new type is coloured by its
// own entry alone. null = nothing here has that colour, and the caller paints
// the ground underneath instead.
function objMapColor(o, field, i, h) {
  const d = OBJECTS[o.type] || STRUCTS[o.type];
  const c = d && d[field];
  return typeof c === 'function' ? c(o, i, h) : (c || null);
}
// what the minimap paints an object whose entry has no `mm` at all
const MM_UNKNOWN = [188, 200, 218];

function isSolidTile(tx, ty) {
  if (!inWorld(tx, ty)) return true;
  const o = objects[idx(tx, ty)];
  if (!o) return false;
  // Two tables, no list: any STRUCTS entry (wall/turret/generator/spawner/
  // keep/...) is solid for free, and everything else answers from its OBJECTS
  // entry - so neither a new building nor a new kind of scenery ever needs
  // this function touched. A `water` building (the fish net) is the one
  // exception: it lies flat on the surface and is walked over, not into.
  if (STRUCTS[o.type]) return !STRUCTS[o.type].water;
  const d = OBJECTS[o.type];
  return !!(d && d.solid);
}

// the fish net on a tile, if one stands there - the single read that says
// "this open water is planked over": the dawn refreeze skips it, the plunge
// check skips it, and drawing it is a flat pass
function netAt(tx, ty) {
  const o = objAt(tx, ty);
  return o && o.type === 'net' ? o : null;
}

// What right-clicking a tile opens - one question, asked by the input
// handler, the cursor, the selection brackets and the wheel alike, so none of
// them can offer a site the others refuse. A stump is a land site (the five
// buildings that stand on snow); a bare open hole is a water site (the net);
// anything else is not a site.
function buildSiteAt(tx, ty) {
  const o = objAt(tx, ty);
  if (o) return o.type === 'stump' ? 'land' : null;
  return inWorld(tx, ty) && ground[idx(tx, ty)] === 2 ? 'water' : null;
}
function buildOptionsAt(tx, ty) {
  return buildSiteAt(tx, ty) === 'water' ? WATER_STRUCT_ORDER : STRUCT_ORDER;
}

// Multi-tile buildings. STRUCTS[type].w/h > 1 means the anchor tile (top-left)
// holds the building object and every other footprint tile holds a 'part'
// filler { type: 'part', of } pointing back at it, so objAt() on any covered
// tile is solid and structOf() resolves to the building. One object per tile
// still holds - the fillers are the object on their tile.
function structW(type) { return (STRUCTS[type] && STRUCTS[type].w) || 1; }
function structH(type) { return (STRUCTS[type] && STRUCTS[type].h) || 1; }
function structOf(o) { return o && o.type === 'part' ? o.of : o; }
function footprint(type, tx, ty) {
  const r = [];
  for (let dy = 0; dy < structH(type); dy++) for (let dx = 0; dx < structW(type); dx++) r.push([tx + dx, ty + dy]);
  return r;
}
function structCenter(o) {
  return { x: (o.tx + structW(o.type) / 2) * TILE, y: (o.ty + structH(o.type) / 2) * TILE };
}
// where a building meets the ground in front: bots roll out of, and return to, this point
function structMouth(o) {
  return { x: (o.tx + structW(o.type) / 2) * TILE, y: (o.ty + structH(o.type)) * TILE + 6 };
}
// The anchor for a w x h building that covers the stump at (tx, ty): every
// candidate placement containing it is tried, and the one covering the most
// stumps wins. A tile qualifies if it is in-world snow holding nothing or a
// stump, and no player is standing inside the footprint (buildings are solid).
function findSite(type, tx, ty) {
  const w = structW(type), h = structH(type);
  let best = null, bs = -1;
  for (let ay = ty - h + 1; ay <= ty; ay++) for (let ax = tx - w + 1; ax <= tx; ax++) {
    let ok = true, stumps = 0;
    for (const [x, y] of footprint(type, ax, ay)) {
      if (!inWorld(x, y) || ground[idx(x, y)] !== 0) { ok = false; break; }
      const o = objects[idx(x, y)];
      if (o) { if (o.type === 'stump') stumps++; else { ok = false; break; } }
    }
    if (!ok) continue;
    for (const q of players) {
      if (!q.active || q.dead || inAir(q)) continue;
      if (q.x > ax * TILE - PLAYER_R && q.x < (ax + w) * TILE + PLAYER_R &&
          q.y > ay * TILE - PLAYER_R && q.y < (ay + h) * TILE + PLAYER_R) { ok = false; break; }
    }
    if (ok && stumps > bs) { bs = stumps; best = { tx: ax, ty: ay }; }
  }
  return best;
}

function placeObj(tx, ty, type, extra) {
  const o = Object.assign({ type, tx, ty, hp: 1, flash: 0, shake: 0 }, extra || {});
  objects[idx(tx, ty)] = o;
  return o;
}

const cx = WORLD / 2, cy = WORLD / 2;

// six evenly spaced points on a ring 55 tiles in from the world edge (at the
// treeline). These were the spawn camps before the eagle drop; they still
// anchor the river spokes and the keep-clear rules so existing seeds keep
// their terrain. Nobody starts here any more - every slot lands from the eagle.
// RING_N is frozen at six ON PURPOSE: it stopped tracking the slot count when
// the roster grew to ten, because player count must never reshape the terrain.
const SPAWN_D = WORLD / 2 - 55;
const RING_N = 6;
const ringPts = [];
for (let i = 0; i < RING_N; i++) {
  const a = -Math.PI / 2 + (i / RING_N) * Math.PI * 2;
  ringPts.push({
    tx: Math.round(cx + Math.cos(a) * SPAWN_D),
    ty: Math.round(cy + Math.sin(a) * SPAWN_D),
  });
}

const BORDER_MIN = 30, BORDER_MAX = 70; // forest boundary depth range (avg ~50)

// depth of the forest boundary at a given tile: smooth irregular inner edge,
// always solid from the world edge inward (variation eats into the interior)
function borderDepth(tx, ty) {
  let n = vnoise(tx / 22, ty / 22) * 0.65 + vnoise(tx / 9 + 40, ty / 9 + 40) * 0.35;
  n = Math.max(0, Math.min(1, (n - 0.5) * 1.6 + 0.5)); // stretch toward full range
  return BORDER_MIN + (BORDER_MAX - BORDER_MIN) * n;
}

// per-tile jackpot roll for trees: hash-based, so it stays stable for a tile
// regardless of generation order, and reshuffles with the run seed
const TREE_RARE_CHANCE = 0.08;
function treeRare(tx, ty) {
  return hash2(tx * 5 + 11, ty * 7 + 23) < TREE_RARE_CHANCE;
}

function genWorld() {
  // solid irregular forest boundary - players carve their base out of this
  for (let ty = 0; ty < WORLD; ty++) {
    for (let tx = 0; tx < WORLD; tx++) {
      const d = Math.min(tx, ty, WORLD - 1 - tx, WORLD - 1 - ty);
      // `variant` picks no art any more - there is one pine in sixteen wind
      // frames and treeFrame() reads the tile's own hash for the one it rests
      // on - but the ROLL stays: dropping an rng() call here reshuffles every
      // existing seed (the hard rule in CLAUDE.md).
      if (d < borderDepth(tx, ty)) placeObj(tx, ty, 'tree', { hp: 4, variant: randi(0, 1), rare: treeRare(tx, ty) });
    }
  }

  // central clearing (the old ore field); CENTER_R keeps other worldgen out of it
  // so the river spokes still meet in open ground. Its rng() draws are kept so
  // existing seeds still produce the same world.
  const CENTER_R = 8;
  for (let i = 0; i < 8; i++) { rand(-0.25, 0.25); rand(3.6, 6.2); }

  // frozen ponds - carved only into the open snow interior, away from the ring points
  const nearAnySpawn = (tx, ty, r) => ringPts.some((p) => Math.hypot(tx - p.tx, ty - p.ty) < r);
  for (let l = 0; l < 14; l++) {
    let px = 0, py = 0, ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      px = randi(BORDER_MIN + 6, WORLD - 1 - BORDER_MIN - 6);
      py = randi(BORDER_MIN + 6, WORLD - 1 - BORDER_MIN - 6);
      ok = !objects[idx(px, py)] && ground[idx(px, py)] === 0 &&
        Math.hypot(px - cx, py - cy) > 16 && !nearAnySpawn(px, py, 16);
    }
    if (!ok) continue;
    let n = randi(70, 160);
    let wx = px, wy = py;
    while (n-- > 0) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = wx + dx, ty = wy + dy;
        if (inWorld(tx, ty) && !objects[idx(tx, ty)] && ground[idx(tx, ty)] === 0 &&
          Math.hypot(tx - cx, ty - cy) > CENTER_R + 3 && !nearAnySpawn(tx, ty, 10)) ground[idx(tx, ty)] = 1;
      }
      wx += randi(-1, 1); wy += randi(-1, 1);
      wx = Math.max(4, Math.min(WORLD - 5, wx));
      wy = Math.max(4, Math.min(WORLD - 5, wy));
    }
  }

  // frozen rivers: winding ~5-tile-wide ribbons that link each ring point to
  // the central clearing plus a ring around it — ice is the map's travel network.
  // Same carve rules as the ponds, so rivers gap politely around the ring points,
  // the clearing, and anything already standing (border trees leave natural gaps).
  const carveIce = (tx, ty) => {
    if (inWorld(tx, ty) && !objects[idx(tx, ty)] && ground[idx(tx, ty)] === 0 &&
      Math.hypot(tx - cx, ty - cy) > CENTER_R + 3 && !nearAnySpawn(tx, ty, 9)) ground[idx(tx, ty)] = 1;
  };
  const carveRiver = (x0, y0, x1, y1) => {
    let wx = x0, wy = y0;
    let a = Math.atan2(y1 - wy, x1 - wx) + rand(-0.4, 0.4);
    const phase = rand(0, Math.PI * 2), wig = rand(0.06, 0.12);
    for (let s = 0; s < 320; s++) {
      // home in on the target while serpentining around the straight line
      const home = Math.atan2(y1 - wy, x1 - wx);
      let da = home - a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      a += Math.max(-0.15, Math.min(0.15, da * 0.08)) + Math.sin(s * 0.09 + phase) * wig;
      wx += Math.cos(a); wy += Math.sin(a);
      const rx = Math.round(wx), ry = Math.round(wy);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy <= 4.5) carveIce(rx + dx, ry + dy);
      }
      if (Math.hypot(wx - x1, wy - y1) < 3) break;
    }
  };
  for (const p of ringPts) carveRiver(p.tx, p.ty, cx, cy); // spokes
  for (let i = 0; i < ringPts.length; i++) { // ring, point to neighbouring point
    const a = ringPts[i], b = ringPts[(i + 1) % ringPts.length];
    carveRiver(a.tx, a.ty, b.tx, b.ty);
  }

  function free(tx, ty) {
    return inWorld(tx, ty) && !objects[idx(tx, ty)] && ground[idx(tx, ty)] === 0;
  }
  function nearSpawn(tx, ty) {
    return ringPts.some((p) => Math.hypot(tx - p.tx, ty - p.ty) < 8);
  }

  // no interior trees: wood only grows at the forest boundary.
  // rocks
  for (let c = 0; c < 110; c++) {
    const ox = randi(BORDER_MIN, WORLD - 1 - BORDER_MIN), oy = randi(BORDER_MIN, WORLD - 1 - BORDER_MIN);
    const n = randi(1, 4);
    for (let i = 0; i < n; i++) {
      const tx = ox + Math.round(rand(-1.6, 1.6));
      const ty = oy + Math.round(rand(-1.6, 1.6));
      if (free(tx, ty) && !nearSpawn(tx, ty) && Math.hypot(tx - cx, ty - cy) > CENTER_R + 3) {
        placeObj(tx, ty, 'rock', { hp: 5, variant: randi(0, 1) });
      }
    }
  }
  // berry bushes
  for (let c = 0; c < 96; c++) {
    const tx = randi(BORDER_MIN, WORLD - 1 - BORDER_MIN), ty = randi(BORDER_MIN, WORLD - 1 - BORDER_MIN);
    if (free(tx, ty) && !nearSpawn(tx, ty) && Math.hypot(tx - cx, ty - cy) > CENTER_R + 3) {
      placeObj(tx, ty, 'bush', { berries: 2, regrow: 0 });
    }
  }
}

// Treasure chests: a handful of border trees swapped for buried caches,
// always on the forest's inner edge so E can reach one from open ground.
// Opening is hitObject's chest branch (js/actions.js); what one pays is the
// three constants here. Placement rolls on its own seeded stream (the lmRng
// pattern) AFTER genWorld and placeLandmarks have finished, so it can never
// reshuffle the terrain or the landmarks a seed already produces.
const CHEST_COUNT = 14;
const CHEST_SPACING = 22;                       // min tiles between two chests
const CHEST_GOLD_MIN = 8, CHEST_GOLD_MAX = 20;  // the free gold inside
const CHEST_ODDS = { white: 0.55, green: 0.28, blue: 0.12, purple: 0.04, gold: 0.01 };
function placeChests() {
  const chRng = mulberry32((SEED ^ 0x43484553) >>> 0);
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cands = [];
  for (let ty = 1; ty < WORLD - 1; ty++) for (let tx = 1; tx < WORLD - 1; tx++) {
    const o = objects[idx(tx, ty)];
    if (!o || o.type !== 'tree') continue;
    // the forest's inner edge: at least one cardinal neighbour is open snow
    if (SIDES.some(([dx, dy]) => !objects[idx(tx + dx, ty + dy)] &&
      ground[idx(tx + dx, ty + dy)] === 0)) cands.push({ tx, ty });
  }
  const placed = [];
  for (let tries = 0; tries < 400 && placed.length < CHEST_COUNT; tries++) {
    const c = cands[Math.floor(chRng() * cands.length)];
    if (!c || placed.some((q) => Math.hypot(q.tx - c.tx, q.ty - c.ty) < CHEST_SPACING)) continue;
    placed.push(c);
    placeObj(c.tx, c.ty, 'chest', { hp: 1 });
  }
}

// ------------------------------------------------------------ landmarks
// Named points of interest: the places worth deciding between while the eagle
// is still in the air. One entry in LANDMARKS is one kind of place - its name,
// its footprint, what stands there, what lives there and the glyph the maps
// mark it with - and adding a new kind is that entry plus its generator.
//
//   name/tag    what the maps and the arrival toast print
//   count       how many of them worldgen scatters
//   r           footprint radius in tiles: the keep-clear ring, the canvas gen
//               draws in, and how close you must be to be "here"
//   surface     the ground its site must sit on ('snow' | 'ice')
//   mark/icon   map ink, and a glyph as rects in a 7x7 box (drawLandmarkIcon)
//   pop/repop   how many inhabitants it keeps, and seconds between top-ups
//   gen(L)      stamp the objects (runs inside worldgen, before renderGround)
//   spawnOne(L) put one inhabitant in it (runs after the world is stamped)
//
// Placement and everything it rolls run on their own seeded stream (lmRng),
// never the shared rng, so landmarks can never reshuffle the terrain a seed
// already produces.
const lmRng = mulberry32((SEED ^ 0x4c414e44) >>> 0);
function lmRand(a, b) { return a + lmRng() * (b - a); }
function lmRandi(a, b) { return Math.floor(lmRand(a, b + 1)); }

const LANDMARKS = {
  // The first thing in the frostlands that hunts back. Rich - a wolf is the
  // biggest single payout in the game - and lethal in a pack (see updateWolf).
  wolfDen: {
    name: 'WOLF DEN', tag: 'THE PACK HUNTS HERE',
    count: 3, r: 5, surface: 'snow',
    mark: '#d8c0c4',
    icon: [[2, 3, 3, 3], [1, 4, 5, 2], [0, 1, 1, 2], [2, 0, 1, 2], [4, 0, 1, 2], [6, 1, 1, 2]], // paw print
    pop: 4, repop: 40,
    gen(L) {
      placeObj(L.tx, L.ty, 'den');
      const n = lmRandi(5, 8); // a broken ring of boulders around the mouth
      for (let i = 0; i < n; i++) {
        const s = lmSpot(L, 2, L.r);
        if (s) placeObj(s.tx, s.ty, 'rock', { hp: 5, variant: lmRandi(0, 1) });
      }
    },
    spawnOne(L) {
      const s = lmSpot(L, 1, 3);
      if (!s) return null;
      const a = makeAnimal('wolf', (s.tx + 0.5) * TILE, (s.ty + 0.5) * TILE);
      a.home = L;
      animals.push(a);
      return a;
    },
  },
  // A stand of dead trees full of birds: no danger at all, just the hardest
  // shooting in the game. Walk in and the whole flock goes up (see updateBird).
  rookery: {
    name: 'ROOKERY', tag: 'THE FLOCK IS SKITTISH',
    count: 3, r: 6, surface: 'snow',
    mark: '#b8c6dc',
    icon: [[0, 2, 2, 2], [2, 3, 1, 1], [3, 4, 1, 1], [4, 3, 1, 1], [5, 2, 2, 2]], // bird in flight
    pop: 9, repop: 30,
    gen(L) {
      const n = lmRandi(6, 9);
      for (let i = 0; i < n; i++) {
        const s = lmSpot(L, 0, L.r - 1);
        if (s) placeObj(s.tx, s.ty, 'deadTree', { hp: 3, variant: lmRandi(0, 1) });
      }
      for (let i = 0; i < 3; i++) {
        const s = lmSpot(L, 2, L.r);
        if (s) placeObj(s.tx, s.ty, 'rock', { hp: 5, variant: lmRandi(0, 1) });
      }
    },
    spawnOne(L) {
      const t = rookeryPerch(L);
      if (!t) return null;
      const a = makeAnimal('bird', (t.tx + 0.5) * TILE + lmRand(-3, 3), (t.ty + 0.5) * TILE);
      a.home = L; a.perch = t; a.alt = BIRD_ALT;
      animals.push(a);
      return a;
    },
  },
};
// placement order. NOT the pickiest site first - the rookery (r 6, ~113 tiles) is pickier than
// the den (r 5) and is placed second. Do NOT reorder to "fix" that: placeLandmarks draws from
// lmRng in this sequence, so the order is a seed-stability contract - changing it relocates
// every landmark in every existing seed.
const LANDMARK_ORDER = ['wolfDen', 'rookery'];

// a free tile in a landmark's footprint, rMin..rMax tiles out from its centre
function lmSpot(L, rMin, rMax) {
  for (let i = 0; i < 40; i++) {
    const a = lmRng() * Math.PI * 2, d = lmRand(rMin, rMax);
    const tx = Math.round(L.tx + Math.cos(a) * d), ty = Math.round(L.ty + Math.sin(a) * d);
    if (inWorld(tx, ty) && !objects[idx(tx, ty)] && ground[idx(tx, ty)] === 0) return { tx, ty };
  }
  return null;
}

// one of the rookery's snags, for a bird to sit in
function rookeryPerch(L) {
  const trees = [];
  for (let dy = -L.r; dy <= L.r; dy++) for (let dx = -L.r; dx <= L.r; dx++) {
    const o = objAt(L.tx + dx, L.ty + dy);
    if (o && o.type === 'deadTree') trees.push(o);
  }
  if (!trees.length) return null;
  const t = trees[lmRandi(0, trees.length - 1)];
  return { tx: t.tx, ty: t.ty };
}

// a site for one landmark: open interior, clear of the middle, the ring
// points, the treeline and every landmark already placed
function landmarkSite(spec) {
  const m = BORDER_MIN + spec.r + 3;
  const want = spec.surface === 'ice' ? 1 : 0;
  for (let tries = 0; tries < 400; tries++) {
    const tx = lmRandi(m, WORLD - 1 - m), ty = lmRandi(m, WORLD - 1 - m);
    if (objects[idx(tx, ty)] || ground[idx(tx, ty)] !== want) continue;
    // the treeline wanders, so measure it here rather than assuming the worst
    // case - otherwise every landmark bunches into one narrow ring
    const edge = Math.min(tx, ty, WORLD - 1 - tx, WORLD - 1 - ty);
    if (edge < borderDepth(tx, ty) + spec.r + 4) continue;
    if (Math.hypot(tx - cx, ty - cy) < 20) continue;                    // the middle stays open
    if (ringPts.some((p) => Math.hypot(tx - p.tx, ty - p.ty) < 12)) continue;
    if (landmarks.some((L) => Math.hypot(tx - L.tx, ty - L.ty) < spec.r + L.r + 8)) continue;
    // most of the footprint has to be the right surface and standing empty
    let good = 0, total = 0;
    for (let dy = -spec.r; dy <= spec.r; dy++) for (let dx = -spec.r; dx <= spec.r; dx++) {
      if (dx * dx + dy * dy > spec.r * spec.r) continue;
      total++;
      const x = tx + dx, y = ty + dy;
      if (inWorld(x, y) && !objects[idx(x, y)] && ground[idx(x, y)] === want) good++;
    }
    if (good < total * 0.72) continue;
    return { tx, ty };
  }
  return null;
}

// worldgen's last pass: scatter the named places and stamp their footprints
function placeLandmarks() {
  for (const key of LANDMARK_ORDER) {
    const spec = LANDMARKS[key];
    for (let n = 0; n < spec.count; n++) {
      const s = landmarkSite(spec);
      if (!s) continue;
      const L = { key, spec, name: spec.name, tag: spec.tag, tx: s.tx, ty: s.ty, r: spec.r, repopT: spec.repop };
      landmarks.push(L);
      spec.gen(L);
    }
  }
}

// stock every site, once the world (and the ordinary wildlife) is down
function stockLandmarks() {
  for (const L of landmarks) {
    for (let i = 0; i < L.spec.pop && landmarkPop(L) < L.spec.pop; i++) L.spec.spawnOne(L);
  }
}

function landmarkPop(L) {
  let n = 0;
  for (const a of animals) if (!a.dead && a.home === L) n++;
  return n;
}

// the named place a world position is standing in, if any
function landmarkAt(x, y) {
  const tx = x / TILE - 0.5, ty = y / TILE - 0.5;
  for (const L of landmarks) if (Math.hypot(tx - L.tx, ty - L.ty) <= L.r) return L;
  return null;
}

// ------------------------------------------------------------ practice arena
// The TRAINING FIELD behind the PRACTICE TOOL plank: one open snowfield, cut
// to pure combat. The practice world itself is SMALL - WORLD is 76 under
// PRACTICE (js/core.js) - so the forest is a collar, not a wilderness. In the
// middle of the field: one dummy standing in the open snow, spawn just
// south of it, and the range BELL and bow rack flanking the dummy on its own
// row - bell west, rack east, mirrored about its axis.
// The archery targets all ride one TWO-RAIL TRACK around the
// field's perimeter - stills, movers and pop-ups on trolleys, movers hopping
// lanes around anything in their way - shoot them from anywhere, roll
// straight past them; ringing the bell runs the timed, scored round over the
// same track. No wildlife, no chests, no pond, no harvest: the world drops
// nothing and asks nothing.
//
// Around the field, through the forest collar, runs the ICE PARKOUR: a
// narrow carved-ice loop (PK_PATH) entered through a flag gate on the west
// side. Ice is mechanically slippery, so the track is the movement pillar as
// a minigame: stepping onto the start line starts the lap clock, a
// checkpoint on the far side keeps a lap honest, and recrossing the line
// records it - the clock rides over the runner's head, and BEST / LAST hang
// on a frost plate at the gate (the dummy meter's own language). Leaving the
// ice for more than PK_OFF_T abandons the run.
//
// Boots only under PRACTICE (js/core.js pins the seed to PRACTICE_SEED, so
// ?seed can never reshape it) and replaces genWorld outright: no landmarks,
// no eagles, no other slots (js/boot.js), and the clock is pinned to early
// morning forever (sim.js). One player, nothing at stake - die() revives on
// the spot and the profile is never written (js/player.js), with ONE
// exception: a record parkour lap goes through PROFILE.setBestLap, so the
// gate plate's BEST stands across visits.
const PR_W = 40, PR_H = 23;                      // the open field, in tiles
const PR_X0 = (WORLD - PR_W) >> 1, PR_Y0 = (WORLD - PR_H) >> 1;
const PR_SPAWN = { tx: PR_X0 + 20, ty: PR_Y0 + 17 }; // south of the rack, facing it and the dummy behind
const DUMMY_HP = 60;
const DUMMY_WORK_DMG = 10;   // what one E swing chips off it (the eagle's own number)
const DUMMY_RESET_T = 2.5;   // s unhit before a dummy mends itself back to full
// the damage meter over the dummy's head (drawDummyMeter, js/draw-world.js):
// LAST HIT / DPS / TOTAL for the combo in progress - the string of hits since
// the dummy last went quiet (hitDummy starts the ledger over, js/actions.js).
// It hangs on this long after the mend so the final numbers can be read,
// then fades. DPS is total over first-to-last hit, floored at one second, so
// a single hit reads as itself instead of infinity.
const DUMMY_METER_LINGER = 2.5;
const practiceDummies = [];  // every dummy standing, for updatePractice's mend clock

// ---- the archery track ---------------------------------------------------
// Link's-Crossbow-Training-style targets, all riding ONE piece of furniture:
// a two-rail TRACK ringing the field (AG_RECT, AG_INSET tiles in from the
// rim, so the ring sits in open snow with the treeline well clear of every
// face; drawAgTrack, js/draw-world.js). Every target is a trolley on a rail - ENTITIES in
// `ptargets`, never tile objects (a mover crosses tiles every frame and a
// raised face should not block a walker) - so only arrows meet them: the
// PRACTICE branch of the arrow loop (js/sim.js) tests every live face disc
// (ptFace/ptLive/ptHitR). The track has TWO LANES (outer 0, inner 1,
// AG_LANE_GAP px apart): a mover about to run into anything parked - or
// rolling slower - on its rail hops to the free lane and keeps going (the
// hop eases over laneU, a visible little lane change, never a teleport).
//   kind   'still' | 'move' | 'pop'
//   s      distance along the track's perimeter, in px (agPos -> world x/y)
//   lane   the rail it rides (laneU eases toward it); dir/spd a mover's roll
//   size   0 small | 1 large - scales the face and its hit disc (ptHitR)
//   up     0..1 a pop-up's rise out of its trolley (still/move sit at 1)
//   pop    a pop-up's own cycle {hide,rise,hold,sink}; t the behaviour clock
//   stock  the free-practice roster: broken faces respawn where they stood
//          (a round's targets are one-shot - hit means gone and scored)
const PT_HIT_R = 11;         // px around a LARGE face's centre an arrow scores on
const PT_RESPAWN = 2.6;      // s a broken stock face stays gone
const PT_POP = { hide: 1.4, rise: 0.22, hold: 2.4, sink: 0.22 }; // the stock pop cycle
const AG_SPD = [26, 46, 70]; // the stock roster's mover speeds (a round rolls its difficulty's own table, AG_DIFF)
const AG_SIZE = [0.625, 1];  // small / large, as a scale on the 32px face
const AG_LANE_GAP = 7;       // px between the outer and inner rail
const AG_POST = 8;           // px of post between trolley and face bottom
const AG_INSET = 3;          // tiles the ring sits in from the field's rim
const AG_RECT = {            // the outer rail, ringing the open snow well inside the treeline
  x0: (PR_X0 + AG_INSET) * TILE, y0: (PR_Y0 + AG_INSET) * TILE,
  x1: (PR_X0 + PR_W - AG_INSET) * TILE, y1: (PR_Y0 + PR_H - AG_INSET) * TILE,
};
const AG_LEN = 2 * ((AG_RECT.x1 - AG_RECT.x0) + (AG_RECT.y1 - AG_RECT.y0));
const ptargets = [];

// where a trolley at track distance s stands, laneU easing it in toward the
// inner rail - clockwise from the NW corner, the one parametrisation the
// update, the arrow test and the rails' pixels all hang off
function agPos(s, laneU) {
  const w = AG_RECT.x1 - AG_RECT.x0, h = AG_RECT.y1 - AG_RECT.y0;
  const inset = laneU * AG_LANE_GAP;
  s = ((s % AG_LEN) + AG_LEN) % AG_LEN;
  if (s < w) return { x: AG_RECT.x0 + s, y: AG_RECT.y0 + inset };
  if (s < w + h) return { x: AG_RECT.x1 - inset, y: AG_RECT.y0 + (s - w) };
  if (s < w * 2 + h) return { x: AG_RECT.x1 - (s - w - h), y: AG_RECT.y1 - inset };
  return { x: AG_RECT.x0 + inset, y: AG_RECT.y1 - (s - w * 2 - h) };
}
// which run of the ring s is on (0 top, 1 right, 2 bottom, 3 left) - odd
// means the rail runs vertically, which is how drawPTarget knows to seat a
// carriage's wheels along the rail's own axis
function agEdge(s) {
  const w = AG_RECT.x1 - AG_RECT.x0, h = AG_RECT.y1 - AG_RECT.y0;
  s = ((s % AG_LEN) + AG_LEN) % AG_LEN;
  return s < w ? 0 : s < w + h ? 1 : s < w * 2 + h ? 2 : 3;
}

function addPTarget(kind, s, opts) {
  const t = Object.assign({
    kind, s: ((s % AG_LEN) + AG_LEN) % AG_LEN,
    lane: 0, laneU: 0, dir: 1, spd: 0, spdClass: 0, size: 1,
    up: 1, t: 0, pop: null, broken: 0, wob: 0, swapT: 0,
    stock: false, gone: false, x: 0, y: 0,
    // the little tells: dustD paces a mover's snow trail by distance rolled,
    // hopping arms the lane-swap landing puff, warned/prevUp edge a pop-up's
    // pre-rise rattle fleck and its lock-up bounce once per cycle
    dustD: 0, hopping: false, warned: -1, prevUp: 0,
  }, opts || {});
  if (t.kind === 'pop') { t.up = 0; if (!t.pop) t.pop = PT_POP; }
  t.laneU = t.lane;
  const p0 = agPos(t.s, t.laneU);
  t.x = p0.x; t.y = p0.y;
  ptargets.push(t);
  return t;
}

// where a face's centre is right now, in world px - the one geometry the
// update, the arrow test and the draw all share, so they can never disagree
function ptFace(t) {
  const fh = 32 * AG_SIZE[t.size];
  // a pop-up's face flips up out of its trolley: bottom edge pinned at the
  // mouth, so the centre rides the rise (exactly how drawPTarget anchors it)
  if (t.kind === 'pop') return { x: t.x, y: t.y - 4 - fh * t.up / 2 };
  return { x: t.x, y: t.y - AG_POST - fh / 2 };
}
// the face's hit disc, scaled with its size
function ptHitR(t) { return PT_HIT_R * AG_SIZE[t.size]; }
// can an arrow score on it this frame
function ptLive(t) { return !t.gone && t.broken <= 0 && (t.kind !== 'pop' || t.up > 0.6); }

// one arrow into the face and it EXPLODES, that frame - points, popup, the
// run and the shatter all land on impact, so the feedback is instant and the
// round clock can never eat a landed shot. Then a STOCK target's mast stands
// bare until the respawn springs a fresh face, while a ROUND target is spent
// for good. Points: small, fast and pop-up all pay extra, so the shot that
// was harder to make is worth more.
function hitPTarget(t) {
  const f = ptFace(t);
  agStreak++;
  // a milestone run flares at the face: gold at every fifth in a row, hot
  // orange from ten - the popup says the number, this says the moment
  if (agStreak >= 5 && agStreak % 5 === 0) {
    burst(f.x, f.y, agStreak >= 10 ? '#ff9440' : '#ffd95c', 10, 70, 0.5, true);
  }
  if (!t.stock && agame.phase === 'play') {
    // speed pays by CLASS (slow/medium/fast), not raw px/s - the classes
    // mean the same thing on every difficulty's speed table
    const pts = 10 + (t.size === 0 ? 10 : 0) + (t.kind === 'pop' ? 10 : 0) +
      (t.spd > 0 ? [0, 5, 10][t.spdClass] || 0 : 0);
    agame.score += pts;
    agame.hits++;
    // the popup: the points, wearing the run from the second hit on
    addFloater(f.x, f.y - 6, '+' + pts + (agStreak > 1 ? ' X' + agStreak : ''), '#ffd95c');
  } else if (agStreak > 1) {
    // free practice pays nothing, so the popup IS the run - white, gold from
    // five in a row, hot orange from ten
    addFloater(f.x, f.y - 6, 'X' + agStreak,
      agStreak >= 10 ? '#ff9440' : agStreak >= 5 ? '#ffd95c' : '#f4f7ff');
  }
  agShatter(t); // the break IS the hit feedback - no beat between them
}

// the shatter: chips, straw, splinters and the shock ring, and the face is
// gone - back on a respawn clock if it was stock, for good if it was a
// round target
function agShatter(t) {
  const f = ptFace(t);
  const sc = AG_SIZE[t.size];
  burst(f.x, f.y, '#d0453a', Math.round(10 * sc), 60, 0.5, true);   // painted chips
  burst(f.x, f.y, '#efe6d0', Math.round(8 * sc), 55, 0.5, true);    // straw backing
  burst(f.x, f.y, '#a3794f', 5, 45, 0.45, true);                    // splinters
  agRings.push({ x: f.x, y: f.y, t: 0, max: ptHitR(t) + 5 });       // the shock ring
  if (t.stock) { t.broken = PT_RESPAWN; t.wob = 0; }
  else t.gone = true;  // updatePractice sweeps it out of the array
  if (nearPlayer(f.x, f.y)) SFX.break_();
}

// ---- the archery round: one bell -----------------------------------------
// The BELL west of the dummy starts the round on the die's own grammar:
// HOLDING E beside it (agBellNear - shared by the E RING cap, drawBellHint
// in js/ui.js, and the press in js/input.js) opens a three-wedge radial
// wheel (kind 'agbell', the ordinary wheel pipeline) - one wedge per
// difficulty, each drawn as the TARGET FACE the round pours out, smaller as
// the pick gets harder, the armed one wearing a gold frame. Releasing on a
// wedge IS the ring (agRing, through the same input.cmd -> runCmd path every
// order takes): the stock roster bursts away, the dummy, the rack AND THE
// BELL ITSELF sink under the snow (their objects leave the grid at full
// depth, so nothing blocks a shot or a runner - which is also why a running
// round cannot be rung off: the timer alone ends it), a 3-2-1 countdown
// lands, and for AG_T seconds random targets pour onto the track from the
// picked difficulty's spawn table (AG_DIFF: mover speeds, small/pop odds,
// crowd cap and refill pace) - each worth points on hitPTarget's
// harder-shot-pays-more rule. Time out and the round ends: the score stands
// as LAST, a strictly higher one writes BEST through PROFILE.setBestRange -
// the range's own all-time record beside the parkour's lap - the furniture
// rises back out of the snow and the stock roster springs back on. The bell
// never wears the difficulty (no recolour - the wheel's gold frame is the
// readout); the readouts (the countdown, the top-centre TIME/SCORE/HITS
// plate, the bell's BEST/LAST frost plate) live in drawAgameUI / drawAgame,
// js/draw-world.js.
const AG_T = 30;         // s a round runs
const AG_COUNT_T = 3;    // the countdown, one tick per second
const AG_SINK_T = 0.9;   // s the dummy, rack and bell take to sink / rise
const AG_END_T = 2.4;    // s the final score stands before the field resets
const AG_BELL = { tx: PR_X0 + 15, ty: PR_Y0 + 12 }; // the bell, west of the dummy on its own row
// one spawn table per difficulty, picked off the bell's wheel: spd = the
// three mover speeds (scored by class, not raw px/s), small/still/pop the
// mix odds (move takes the rest), max/spawnT the crowd and its refill pace
const AG_DIFF = {
  easy:   { spd: [20, 34, 50], small: 0.22, still: 0.42, pop: 0.22, max: 6, spawnT: 1.8 },
  medium: { spd: [26, 46, 70], small: 0.40, still: 0.30, pop: 0.25, max: 7, spawnT: 1.5 },
  hard:   { spd: [34, 60, 90], small: 0.58, still: 0.16, pop: 0.32, max: 9, spawnT: 1.1 },
};
// phase: off | sink | count | play | end. `diff` is the armed difficulty
// (the wheel's gold frame; the bell itself never wears it). `best` is the
// profile's record, seeded at gen and written on a strictly higher score;
// last/lastHits are this visit's. `tick` edges the countdown SFX, dustT
// paces the sink dust.
const agame = { phase: 'off', t: 0, score: 0, hits: 0, last: 0, lastHits: 0,
  best: 0, record: false, diff: 'medium', spawnT: 0, tick: 0, dustT: 0 };
let agBellObj = null;    // the bell object, for its ring animation
let agFurniture = [];    // the dummy + rack + bell objects the round sinks away
// the consecutive-hit run: every arrow into a face extends it, minigame or
// not, and any practice arrow that ends without striking a face breaks it
// (the arrow loop, js/sim.js). The hit popup carries it from the second hit
// on - hotter-coloured as the run grows - and a fresh round starts it over.
let agStreak = 0;
// the hit-ring flash: every face break snaps one quick shock ring out from
// the hit, sized to the face it came off (agShatter pushes, updatePractice
// ages, drawAgRings in js/draw-world.js draws)
const AG_RING_T = 0.22;  // s a ring lives
const agRings = [];      // { x, y, t, max }

// how far apart two track distances are, the short way round the ring
function agDist(a, b) {
  const d = Math.abs(a - b) % AG_LEN;
  return Math.min(d, AG_LEN - d);
}
// anything parked or rolling on this lane within r of s - what a spawn
// point and a lane hop's landing zone both check
function agBlocked(lane, s, r, skip) {
  for (const t of ptargets) {
    if (t === skip || t.gone || t.lane !== lane) continue;
    if (agDist(t.s, s) < r) return true;
  }
  return false;
}

// how deep the furniture is right now: 0 standing, 1 under the snow - the
// dummy and rack draw branches (js/render.js) crop and drop their sprites by
// it, so the whole sink is one number and no second animation state
function agSinkU() {
  if (agame.phase === 'sink') return Math.min(1, agame.t / AG_SINK_T);
  if (agame.phase === 'end') return Math.max(0, 1 - agame.t / AG_SINK_T);
  return agame.phase === 'off' ? 0 : 1;
}

// the bell the player is standing at - Chebyshev 1, E's own reach - shared
// by the E RING prompt (drawBellHint, js/ui.js) and the press (js/input.js)
function agBellNear(p) {
  const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = objAt(ptx + dx, pty + dy);
    if (o && o.type === 'agbell') return o;
  }
  return null;
}

// a difficulty released off the bell's wheel, through runCmd: the wedge IS
// the ring (the roll die's own grammar) - it arms that difficulty and winds
// the round up, the stock roster leaving with the furniture. Only an idle
// range answers: mid-round the bell is under the snow, and the sink and
// rise phases are mid-ceremony. PRACTICE-gated like pkWheelPick.
function agRing(p, c) {
  if (!PRACTICE || agame.phase !== 'off' || !AG_DIFF[c.id]) return;
  if (Math.hypot(c.tx * TILE + 8 - p.x, c.ty * TILE + 8 - p.y) > 60) return;
  agame.diff = c.id;
  if (agBellObj) agBellObj.ring = 0.9;
  SFX.dawnChime();
  agame.phase = 'sink'; agame.t = 0; agame.dustT = 0;
  agame.score = 0; agame.hits = 0;
  agStreak = 0; // the round's run is its own
  for (const t of ptargets) { const f = ptFace(t); burst(f.x, f.y, '#f4f7ff', 5, 40, 0.4, true); }
  ptargets.length = 0;
}

// the round closes: bank LAST (and BEST through the profile on a strictly
// higher score), sweep the unshot targets away, put the furniture back on
// the grid and let the rise play out - agUpdate flips to 'off' and restocks
// the free-practice roster once the final score has stood AG_END_T
function agEndRound() {
  agame.last = agame.score; agame.lastHits = agame.hits;
  agame.record = agame.score > 0 && agame.score > agame.best;
  if (agame.record) { agame.best = agame.score; PROFILE.setBestRange(agame.score); }
  agame.phase = 'end'; agame.t = 0; agame.dustT = 0;
  for (const t of ptargets) { const f = ptFace(t); burst(f.x, f.y, '#f4f7ff', 5, 40, 0.4, true); }
  ptargets.length = 0;
  for (const o of agFurniture) objects[idx(o.tx, o.ty)] = o;
  if (agame.record) SFX.levelUp(); else SFX.place();
}

// one random target onto the track, from the armed difficulty's spawn table
// (AG_DIFF): habit, lane, size, speed and clock all rolled fresh (runtime
// rng() reshuffles nothing - world.md), the spawn point retried away from
// anything already parked there, and a wobble-in with a poof so a face
// never just blinks into being
function agSpawn() {
  const S = AG_DIFF[agame.diff] || AG_DIFF.medium;
  const r = rng();
  const kind = r < S.still ? 'still' : r < 1 - S.pop ? 'move' : 'pop';
  const lane = rng() < 0.5 ? 0 : 1;
  let s = rng() * AG_LEN;
  for (let i = 0; i < 8 && agBlocked(lane, s, 26); i++) s = rng() * AG_LEN;
  const sc = (rng() * 3) | 0; // the mover speed class - what the score reads
  const t = addPTarget(kind, s, {
    lane, size: rng() < S.small ? 0 : 1,
    dir: rng() < 0.5 ? 1 : -1,
    spd: kind === 'move' ? S.spd[sc] : 0,
    spdClass: kind === 'move' ? sc : 0,
    pop: kind === 'pop' ? { hide: rand(0.7, 1.8), rise: 0.22, hold: rand(1.1, 2.2), sink: 0.22 } : null,
  });
  t.wob = 0.45;
  burst(t.x, t.y - 8, '#f4f7ff', 6, 40, 0.45, true);
}

// the free-practice roster: the fixed mix that stands between rounds -
// stills of both sizes, one slow and one fast mover, pop-ups on offset
// clocks - every one respawning where it stood when shot (stock: true)
function agStock(quiet) {
  ptargets.length = 0;
  const w = AG_RECT.x1 - AG_RECT.x0, h = AG_RECT.y1 - AG_RECT.y0;
  addPTarget('still', w * 0.5, { stock: true });                                   // top centre
  addPTarget('still', w + h * 0.5, { stock: true, size: 0, lane: 1 });             // east, small, inner rail
  addPTarget('still', w * 2 + h + h * 0.75, { stock: true });                      // west, above the gate walk
  addPTarget('move', w * 0.2, { stock: true, spd: AG_SPD[0], dir: 1 });            // the slow patroller
  addPTarget('move', w + h + w * 0.5, { stock: true, spd: AG_SPD[2], spdClass: 2, dir: -1, size: 0, lane: 1 }); // the fast small one
  addPTarget('pop', w * 0.15, { stock: true, t: 0 });
  addPTarget('pop', w + h * 0.8, { stock: true, t: 1.4, size: 0 });
  addPTarget('pop', w + h + w * 0.7, { stock: true, t: 2.7 });
  if (!quiet) for (const t of ptargets) burst(t.x, t.y - 8, '#f4f7ff', 5, 38, 0.4, true);
}

// the round's clock, from updatePractice: the sink hands the furniture off
// the grid, the countdown ticks, the play window spawns and times out, and
// the end phase lets the score stand while the furniture rises back
function agUpdate(dt) {
  if (agBellObj && agBellObj.ring > 0) agBellObj.ring = Math.max(0, agBellObj.ring - dt);
  const G = agame;
  if (G.phase === 'off') return;
  G.t += dt;
  // snow dusting off the sinking / rising furniture, only while it moves
  if ((G.phase === 'sink' || (G.phase === 'end' && G.t < AG_SINK_T)) && (G.dustT -= dt) <= 0) {
    G.dustT = 0.07;
    for (const o of agFurniture) {
      burst(o.tx * TILE + 8 + rand(-5, 5), (o.ty + 1) * TILE - 1, rng() < 0.7 ? '#f4f7ff' : '#c4d4ea', 2, 30, 0.4, true);
    }
  }
  if (G.phase === 'sink') {
    if (G.t >= AG_SINK_T) {
      // under the snow the furniture leaves the grid entirely: nothing left
      // to block a shot, a runner, or raise a prompt - agEndRound puts the
      // exact objects back (a tool is an instance; so is a dummy's ledger)
      for (const o of agFurniture) objects[idx(o.tx, o.ty)] = null;
      G.phase = 'count'; G.t = 0; G.tick = AG_COUNT_T + 1;
    }
  } else if (G.phase === 'count') {
    const left = Math.ceil(AG_COUNT_T - G.t);
    if (left !== G.tick) { G.tick = left; SFX.nock(); }
    if (G.t >= AG_COUNT_T) {
      G.phase = 'play'; G.t = 0; G.spawnT = (AG_DIFF[G.diff] || AG_DIFF.medium).spawnT;
      for (let i = 0; i < 4; i++) agSpawn();
      SFX.place();
    }
  } else if (G.phase === 'play') {
    const S = AG_DIFF[G.diff] || AG_DIFF.medium;
    G.spawnT -= dt;
    if (G.spawnT <= 0 && ptargets.length < S.max) { agSpawn(); G.spawnT = S.spawnT; }
    if (G.t >= AG_T) agEndRound();
  } else if (G.phase === 'end') {
    if (G.t >= AG_END_T) { G.phase = 'off'; agStock(false); }
  }
}

// ---- the ice parkour -----------------------------------------------------
// PK_PATH is the STOCK loop's centreline in world tiles (the practice WORLD
// is a fixed 76, so these are absolute), carved 2-3 tiles wide through the
// forest collar by genPracticeWorld - trees hug both sides, and ice being
// mechanically slippery IS the whole game of it. The lap: step onto the
// start-line ice under the west flag gate (the clock starts), round the far
// checkpoint, recross the line (the clock records). Both line and checkpoint
// are plain coordinate tests against the carved ice, not objects.
//
// The stock loop is only the FIRST track: the roll station just inside the
// gate (pkRoll below) recarves the collar into a fresh random loop, so
// everything that must survive a reroll is anchored - the gate, its walk and
// the start line never move (every generated loop is pinned to them), the
// checkpoint is wherever parkour.cpTx/cpTy says this track's far side is,
// and pkTiles remembers the carve so the old track can grow back into forest.
// The loop rides an ellipse around the field's centre (PK_CX/PK_CY), with a
// deep tree belt between track and field: PK_APRON tiles of forest that no
// waypoint, chord or carve may enter, so the run reads as a lane cut through
// woods rather than the hem of the clearing. The practice WORLD is 76 to give
// the collar that depth on every side (js/core.js).
const PK_CX = PR_X0 + (PR_W >> 1), PK_CY = PR_Y0 + 11; // (38, 37): the field's centre tile
const PK_RX = 30, PK_RY = 26;  // the loop's base radii, in tiles
const PK_APRON = 6;            // tree belt between field and anything the track does
const PK_PATH = [
  [8, 37], [8, 29], [6, 22], [9, 16],                            // west leg, up
  [16, 11], [26, 15], [36, 10], [45, 15], [55, 11], [63, 16],    // the top slalom
  [68, 22], [66, 30], [69, 37], [66, 45], [68, 54],              // east leg, down
  [62, 59], [52, 64], [43, 59], [33, 64], [24, 59],              // the bottom slalom
  [15, 63], [9, 57], [7, 49], [8, 42], [8, 37],                  // and home
];
// The start/finish line is a FIXED five-tile checker band: pkPlanCarve
// force-ices exactly this strip on every carve, whatever width the roll cut
// the lane, so the line never stretches, never gaps, and the coordinate test
// that times laps is the same box that is painted. A flag stands at each end.
const PK_LINE = { x0: 6, x1: 10, y: 37 };
const PK_OFF_T = 2.5;  // s off the ice before a live run is abandoned
const PK_GATE = { x: 5.5 * TILE, y: 34.5 * TILE }; // where the BEST/LAST plate hangs, over the west line flag
// the walk out of the field: cleared snow the reroll must never ice or tree
const PK_WALK = { x0: 10, x1: 18, y0: 36, y1: 37 };
// one runner, one clock: the live lap (on/t/cp), the abandon timer, and the
// last and best laps. `best` is the profile's all-time record - seeded from
// PROFILE.bestLap() by genPracticeWorld and written back through
// PROFILE.setBestLap() on a record, the one thing practice ever writes -
// while `last` is this session's only. A ROLLED track flips `custom`: its
// laps are its own (best/last restart at 0 and never touch the profile -
// random loops are not comparable, so a persistent record over them would be
// a lie), and the profile's record stays what it says it is: the stock lap.
// `diff` is the current track's difficulty - the die wears it as its body
// colour - and cpTx/cpTy is THIS track's checkpoint.
const parkour = { on: false, t: 0, cp: false, wasLine: false, offT: 0, last: 0, best: 0,
  diff: 'easy', custom: false, cpTx: 69, cpTy: 37 };

// ---- the roll station: one die, one held wheel ---------------------------
// A die on a pedestal in a felled nook off the walk rerolls the loop: HOLD E
// beside it (pkDieNear - the armory rack's own proximity gesture, wired in
// js/input.js and hinted by drawPkHint, js/ui.js) and a three-wedge radial
// wheel opens - one wedge per difficulty, each drawn as that difficulty's
// coloured die. Releasing on a wedge IS the roll: it carves a fresh track at
// that difficulty (pkWheelPick, the same input.cmd -> runCmd path every
// wheel uses), and the station's die recolours to match (PK_DIE_COL,
// draw-world.js), so the standing die always says what the current track is.
const PK_DIFFS = ['easy', 'medium', 'hard'];
// pts = waypoints (more = twistier), jit = radial jitter in tiles (alt flips
// it in and out on alternating points - a forced slalom), rad = carve
// half-width in tiles (easy is a boulevard, hard a ribbon)
const PK_DIFF = {
  easy:   { pts: 10, jit: 1.6, rad: 1.75, alt: false },
  medium: { pts: 16, jit: 3.2, rad: 1.25, alt: false },
  hard:   { pts: 22, jit: 4.5, rad: 1.0,  alt: true },
};
// The die stands in a small felled nook off the walk's south side, adjacent
// to the walk so its prompt rises as you pass on the way to the track.
const PK_DIE = { tx: 15, ty: 38 };
let pkTiles = new Set();   // every tile index the current track's carve iced
let pkDieObj = null;       // the die object, for the roll animation
// A roll is WATCHED, not blinked: one carving front sweeps once around the
// collar in the lap's own direction, starting and finishing at the gate. As
// it passes, the forest closes over the old track (trees spring back with a
// snow poof) and the new lane is cut (trees fall, ice lays down) - the same
// wave doing both is what makes the new loop legible as it appears. pkRoll
// builds the tile events sorted by ring angle and pkAnimStep (updatePractice)
// spends them as the front advances - a handful of tiles and one repaint
// each per frame, so the whole show costs less than a particle burst. The
// die tumbles for the full sweep and the station refuses a new roll until
// the front comes home.
const PK_ANIM_T = 6.0;         // s for the front to lap the collar - a slow, watchable carve
const PK_WARN = 0.45;          // rad the shudder runs ahead of the front: pines shake, THEN fall
const PK_ANIM_CAP = 48;        // max tile events spent per frame (dt-spike guard)
// { t, ev: [{k:0 grow|1 ice|2 shudder, i, a}], next, sfxT,
//   trail: [{x,y,a}] dense samples along the new lane, ti, plumeT } - the
// trail is what the front's sparkle plume rides, so the sweep stays visible
// even where the old and new track share tiles and no event fires
let pkAnim = null;

// The rack is the practice armory: right-clicking either of its tiles opens
// a radial wheel of every tool in the game (kind 'rack' - input.js opens it,
// wheelOptions/renderWheel list and draw it, and the pick lands here through
// the same input.cmd -> runCmd path a build order takes). The selected slot
// becomes a fresh instance of the picked tool with a plain arrow seated, so
// it fires the moment it is taken. PRACTICE-gated: a rack in a match world
// must never be a free-weapons kiosk.
function rackEquip(p, c) {
  if (!PRACTICE) return;
  const o = objAt(c.tx, c.ty);
  if (!o || o.type !== 'rack' || !TOOLS[c.id]) return;
  if (Math.hypot(c.tx * TILE + 8 - p.x, c.ty * TILE + 8 - p.y) > 60) return;
  const cell = makeTool(c.id);
  cell.bits[0] = 'arrow';
  p.tools[p.toolSel] = cell;
  burst(p.x, p.y - 8, '#e8dcb4', 6, 40, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.place();
}

// the rack the player is standing at - Chebyshev 1 of any of its tiles, E's
// own WORK_REACH - resolved to its lead. What the E ARM prompt, the E-opens
// gesture and the hover brackets all agree on.
function rackNear(p) {
  const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = objAt(ptx + dx, pty + dy);
    if (o && o.type === 'rack') return o.lead ? o : objAt(o.tx - 1, o.ty);
  }
  return null;
}

function genPracticeWorld() {
  const ax = PR_X0, ay = PR_Y0;
  // solid forest everywhere, then the field carved out of it - the whole
  // field stays open (rim included): the target track runs the perimeter,
  // one tile in, and a face must never stand behind a pine
  for (let ty = 0; ty < WORLD; ty++) {
    for (let tx = 0; tx < WORLD; tx++) {
      const inX = tx >= ax && tx < ax + PR_W, inY = ty >= ay && ty < ay + PR_H;
      if (inX && inY) continue;
      placeObj(tx, ty, 'tree', { hp: 4, variant: randi(0, 1), rare: treeRare(tx, ty) });
    }
  }
  // ---- the dummy in the open snow, the armory rack squared under it ------
  const put = (tx, ty, type, extra) => { if (!objects[idx(ax + tx, ay + ty)]) return placeObj(ax + tx, ay + ty, type, extra); return null; };
  const d = put(20, 12, 'dummy', { hp: DUMMY_HP, maxHp: DUMMY_HP, hitT: 99,
    mLast: 0, mTotal: 0, mT0: 0, mT1: 0 }); // the meter's combo ledger
  if (d) practiceDummies.push(d);
  // the bell and the rack FLANK the dummy on its own row, mirrored about its
  // axis in the open snow, five tiles out each way. A two-tile pair can only
  // centre on a tile boundary,
  // so the rack sits at (25,12)-(26,12) and `dx` nudges the drawn sprite
  // (and its brackets and prompt) 8px left, landing its visual centre
  // exactly opposite the bell's - the tiles stay honest, the picture mirrors
  const rk1 = put(25, 12, 'rack', { lead: true, dx: -8 }), rk2 = put(26, 12, 'rack', {});
  // ---- the range bell, the rack's western mirror -------------------------
  agBellObj = put(15, 12, 'agbell', { ring: 0 });
  // the archery round sinks exactly these under the snow - the bell
  // included, which is why a running round cannot be rung off - and
  // agEndRound raises the same instances back
  agFurniture = [d, rk1, rk2, agBellObj].filter(Boolean);
  // ---- the targets: the free-practice roster, out on the perimeter track -
  agStock(true);
  // ---- the ice parkour: the gate walk, the carved loop, the flags --------
  // the walk out of the field is cleared snow (the approach should not
  // slide); the loop is carved AFTER it so their overlap ends up ice, which
  // is what puts the start line - the forced PK_LINE strip - under the gate
  const fell = (tx, ty) => { objects[idx(tx, ty)] = null; };
  for (let ty = PK_WALK.y0; ty <= PK_WALK.y1; ty++) for (let tx = PK_WALK.x0; tx <= PK_WALK.x1; tx++) { fell(tx, ty); ground[idx(tx, ty)] = 0; }
  // the die's nook: a small felled pocket off the walk's south side, deep
  // enough that no pine canopy from the row behind hangs over the die
  for (let ty = 38; ty <= 40; ty++) for (let tx = 14; tx <= 16; tx++) fell(tx, ty);
  pkCarve(PK_PATH, 1.15);
  // the gate: a flag capping each END of the checker line, west and east
  fell(PK_LINE.x0 - 1, PK_LINE.y); placeObj(PK_LINE.x0 - 1, PK_LINE.y, 'banner');
  fell(PK_LINE.x1 + 1, PK_LINE.y); placeObj(PK_LINE.x1 + 1, PK_LINE.y, 'banner');
  pkDieObj = placeObj(PK_DIE.tx, PK_DIE.ty, 'pkdie', { rollT: 0 });
  // the records stand across visits: the gate plate opens showing the
  // profile's best lap, the bell plate its best round score
  parkour.best = PROFILE.bestLap();
  agame.best = PROFILE.bestRange();
}

// Plan one loop's carve: walk the centreline and collect every tile within
// `rad` of it that MAY become ice. Only tree tiles (or bare ground) qualify -
// the gate flags, the station, the walk's cleared snow past the line and the
// whole training field all refuse it, which is what keeps the fixed
// west-gate furniture and the range safe under every random track. Nothing
// is touched here: the boot carve applies the plan at once (pkCarve), a roll
// spends it tile by tile as the front sweeps past (pkAnimStep).
function pkPlanCarve(path, rad) {
  const plan = new Set();
  const reach = Math.ceil(rad);
  for (let s = 0; s < path.length - 1; s++) {
    const [x0, y0] = path[s], [x1, y1] = path[s + 1];
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 3;
    for (let i = 0; i <= steps; i++) {
      const fx = x0 + (x1 - x0) * i / steps, fy = y0 + (y1 - y0) * i / steps;
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const tx = Math.round(fx) + dx, ty = Math.round(fy) + dy;
        if (!inWorld(tx, ty) || Math.hypot(tx - fx, ty - fy) > rad) continue;
        const wx = tx >= PK_WALK.x0 && tx <= PK_WALK.x1 && ty >= PK_WALK.y0 && ty <= PK_WALK.y1;
        if (wx && tx > PK_LINE.x1) continue; // the walk stays snow past the line
        if (tx >= PR_X0 && tx < PR_X0 + PR_W && ty >= PR_Y0 && ty < PR_Y0 + PR_H) continue;
        const o = objects[idx(tx, ty)];
        if (o && o.type !== 'tree' && o.type !== 'deadTree') continue;
        plan.add(idx(tx, ty));
      }
    }
  }
  // the line strip is ALWAYS part of the carve, whatever width the roll cut
  // the lane: exactly PK_LINE.x0..x1 on the line row, so the checker band,
  // the lap test and the flags capping its ends never move and never gap
  for (let tx = PK_LINE.x0; tx <= PK_LINE.x1; tx++) {
    const o = objects[idx(tx, PK_LINE.y)];
    if (!o || o.type === 'tree' || o.type === 'deadTree') plan.add(idx(tx, PK_LINE.y));
  }
  return plan;
}

// lay one planned ice tile down NOW: fell whatever tree still stands there,
// ice the ground, repaint. The one writer both the boot carve and the
// animation go through.
function pkIceTile(i) {
  const o = objects[i];
  if (o && (o.type === 'tree' || o.type === 'deadTree')) objects[i] = null;
  ground[i] = 1;
}

// the boot carve: plan and apply in the same breath (repaint is renderGround's
// job at boot, so none here)
function pkCarve(path, rad) {
  pkTiles = pkPlanCarve(path, rad);
  for (const i of pkTiles) pkIceTile(i);
}

// A fresh random loop for one difficulty: waypoints on a jittered ellipse
// around the field, walked gate-to-gate so the first and last legs are always
// the west line. Points that would stray into the field (or its two-tile
// apron) are pushed back out into the collar, so a track can never cut across
// the training ground. Runtime entropy is fine here - rng() calls after boot
// reshuffle nothing (world.md#determinism-and-noise).
function pkGenPath(spec) {
  const ecx = PK_CX, ecy = PK_CY, rx = PK_RX, ry = PK_RY;
  // only the line point itself is pinned - the two approach legs wander a
  // little (x 6-9, y a few tiles either way), so even two rolls of the same
  // difficulty visibly redraw the ice in front of the gate where the roller
  // is standing to watch
  const path = [[8, 37], [6 + ((rng() * 4) | 0), 28 + ((rng() * 4) | 0)]];
  let cp = [69, 37];
  const n = spec.pts;
  for (let i = 2; i <= n - 2; i++) {
    const th = Math.PI - 2 * Math.PI * i / n;
    let r1 = rx, r2 = ry;
    if (spec.alt) { // the forced slalom: alternate points swing out and in
      const s = (i % 2 ? 1 : -1) * (0.5 + rng() * 0.5);
      r1 += s * spec.jit; r2 += s * spec.jit;
    } else {
      r1 += (rng() * 2 - 1) * spec.jit;
      r2 += (rng() * 2 - 1) * spec.jit;
    }
    let x = Math.round(ecx + Math.cos(th) * r1);
    let y = Math.round(ecy - Math.sin(th) * r2);
    x = Math.max(5, Math.min(WORLD - 6, x));
    y = Math.max(5, Math.min(WORLD - 6, y));
    // out of the field's tree belt, along whichever axis it strayed least
    if (x > PR_X0 - PK_APRON - 1 && x < PR_X0 + PR_W + PK_APRON && y > PR_Y0 - PK_APRON - 1 && y < PR_Y0 + PR_H + PK_APRON) {
      const dx = (x - ecx) / (PR_W / 2 + PK_APRON), dy = (y - ecy) / (PR_H / 2 + PK_APRON);
      if (Math.abs(dx) > Math.abs(dy)) x = dx > 0 ? PR_X0 + PR_W + PK_APRON : PR_X0 - PK_APRON - 1;
      else y = dy > 0 ? PR_Y0 + PR_H + PK_APRON : PR_Y0 - PK_APRON - 1;
    }
    path.push([x, y]);
  }
  path.push([6 + ((rng() * 4) | 0), 43 + ((rng() * 4) | 0)], [8, 37]);
  // a straight leg between two collar points can still CHORD across the tree
  // belt's corner - walk every segment and, where one would cross the belt,
  // route it through the belt corner nearest its midpoint instead
  const fx0 = PR_X0 - PK_APRON - 1, fx1 = PR_X0 + PR_W + PK_APRON, fy0 = PR_Y0 - PK_APRON - 1, fy1 = PR_Y0 + PR_H + PK_APRON;
  const inApron = (x, y) => x > fx0 && x < fx1 && y > fy0 && y < fy1;
  const routed = [path[0]];
  for (let s = 1; s < path.length; s++) {
    const [ax, ay] = routed[routed.length - 1], [bx, by] = path[s];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay)) * 2;
    let cut = false;
    for (let i = 1; i < steps && !cut; i++) {
      if (inApron(ax + (bx - ax) * i / steps, ay + (by - ay) * i / steps)) cut = true;
    }
    if (cut) {
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const corners = [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]];
      corners.sort((c1, c2) => Math.hypot(c1[0] - mx, c1[1] - my) - Math.hypot(c2[0] - mx, c2[1] - my));
      routed.push(corners[0]);
    }
    routed.push([bx, by]);
  }
  // the checkpoint is this track's farthest-east waypoint - the honest "you
  // went round the far side" test, wherever the roll put the far side
  cp = routed.reduce((a, b) => (b[0] > a[0] ? b : a));
  return { path: routed, cp };
}

// where a tile sits on the ring, as the sweep's clock: 0 at the west gate,
// growing in the lap's own direction (north first, east over the top), 2pi
// back home - the same parametrisation pkGenPath walks
function pkAngKey(i) {
  const th = Math.atan2(PK_CY - ((i / WORLD) | 0), (i % WORLD) - PK_CX);
  const k = Math.PI - th;
  return k >= Math.PI * 2 ? k - Math.PI * 2 : k;
}

// The roll itself: pick the new loop, unregister the old track's scars, aim
// the checkpoint at the new far side, reset the clock - and hand the actual
// terrain change to the sweep (pkAnimStep): every affected tile becomes one
// event keyed by its ring angle, so the front regrows the forest and cuts
// the new lane in a single lap-shaped pass. Rolled tracks are their own
// event - best/last restart and the profile's stock record is never written.
function pkRoll(diff) {
  if (pkAnim) return; // one front out at a time - the die is still tumbling
  if (PK_DIFF[diff]) parkour.diff = diff;
  const spec = PK_DIFF[parkour.diff];
  const old = pkTiles;
  const gen = pkGenPath(spec);
  pkTiles = pkPlanCarve(gen.path, spec.rad);
  // the old track takes its scars with it: any crack or hole the player put
  // in it is unregistered before the forest grows back over the tile
  for (const i of old) {
    iceCracks.delete(i);
    const hi = holes.indexOf(i);
    if (hi >= 0) holes.splice(hi, 1);
  }
  const ev = [];
  for (const i of old) if (!pkTiles.has(i)) ev.push({ k: 0, i, a: pkAngKey(i) });
  // a tile in BOTH tracks normally needs no event - unless the player broke
  // a hole through it: its registration was just wiped, so the sweep must
  // re-ice it or the hole would linger unregistered forever
  for (const i of pkTiles) if (old.has(i) && ground[i] !== 1) ev.push({ k: 1, i, a: pkAngKey(i) });
  for (const i of pkTiles) if (!old.has(i)) {
    const a = pkAngKey(i);
    ev.push({ k: 1, i, a });
    // a pine in the new lane shudders a beat before the front reaches it -
    // the anticipation is half the show
    const o = objects[i];
    if (o && o.type === 'tree') ev.push({ k: 2, i, a: Math.max(0, a - PK_WARN) });
  }
  ev.sort((a, b) => a.a - b.a);
  // the plume's rail: dense samples along the new lane in sweep order (the
  // path is angle-ordered by construction; the running max irons out the
  // slalom's tiny local wobbles so the index only ever advances)
  const trail = [];
  let ka = 0;
  for (let s = 0; s < gen.path.length - 1; s++) {
    const [x0, y0] = gen.path[s], [x1, y1] = gen.path[s + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2);
    for (let i = 0; i < steps; i++) {
      const fx = x0 + (x1 - x0) * i / steps, fy = y0 + (y1 - y0) * i / steps;
      let a = Math.PI - Math.atan2(PK_CY - fy, fx - PK_CX);
      if (a >= Math.PI * 2) a -= Math.PI * 2;
      ka = Math.max(ka, a);
      trail.push({ x: fx * TILE + 8, y: fy * TILE + 8, a: ka });
    }
  }
  pkAnim = { t: 0, ev, next: 0, sfxT: 0, trail, ti: 0, plumeT: 0 };
  parkour.cpTx = gen.cp[0]; parkour.cpTy = gen.cp[1];
  parkour.custom = true;
  parkour.on = false; parkour.t = 0; parkour.cp = false; parkour.offT = 0;
  parkour.best = 0; parkour.last = 0;
  if (pkDieObj) pkDieObj.rollT = PK_ANIM_T + 0.3; // the die tumbles for the whole sweep
  const dx2 = PK_DIE.tx * TILE + 8, dy2 = PK_DIE.ty * TILE + 8;
  burst(dx2, dy2 - 10, '#f4f7ff', 10, 55, 0.5, true);
  burst(dx2, dy2 - 10, '#8fd8ff', 8, 45, 0.45, true);
  if (nearPlayer(dx2, dy2)) SFX.unlock();
}

// The sweep, one frame's worth: advance the front around the ring and spend
// every event it has passed - a grow event closes the forest over an old
// tile (snow back, a tree with a flash and a poof, never onto the player), an
// ice event cuts the new lane (the tree falls in needles and snow, the ice
// lays down with a sparkle). Each event is one ground write and one
// repaintGround - a handful per frame at 60fps - and PK_ANIM_CAP bounds a
// dt spike so a background tab can never dump the whole track into one
// frame's budget. When the front comes home the line flashes: track open.
function pkAnimStep(dt) {
  if (!pkAnim) return;
  pkAnim.t += dt; pkAnim.sfxT += dt;
  // eased, not linear: the watcher stands at the gate, so the front pulls
  // away slowly (the first trees fall where you can see them), hurries round
  // the far side, and slows again to close the loop in front of you
  const u = Math.min(1, pkAnim.t / PK_ANIM_T);
  const front = (u * u * (3 - 2 * u)) * Math.PI * 2;
  let spent = 0;
  while (pkAnim.next < pkAnim.ev.length && pkAnim.ev[pkAnim.next].a <= front && spent < PK_ANIM_CAP) {
    const e = pkAnim.ev[pkAnim.next++]; spent++;
    const tx = e.i % WORLD, ty = (e.i / WORLD) | 0;
    const px = tx * TILE + 8, py = ty * TILE + 8;
    if (e.k === 2) {
      // the shudder: the pine shakes on its feet a beat before it falls
      // (o.shake decays in sim.js's object-timer loop) - no ground change,
      // so no repaint either
      const o = objects[e.i];
      if (o && o.type === 'tree') o.shake = 0.55;
      continue;
    }
    if (e.k === 1) {
      const hadTree = !!objects[e.i];
      pkIceTile(e.i);
      if (hadTree) {
        burst(px, py - 8, '#88b090', 4, 45, 0.45, true);  // needles off the falling pine
        if (rng() < 0.6) burst(px, py - 4, '#f4f7ff', 3, 40, 0.4, true);
        if (pkAnim.sfxT > 0.28 && nearPlayer(px, py)) { pkAnim.sfxT = 0; SFX.break_(); }
      } else if (rng() < 0.5) {
        burst(px, py, '#ddf1f8', 2, 35, 0.4, true);        // frost settling on fresh ice
      }
    } else {
      ground[e.i] = 0;
      const inField = tx >= PR_X0 && tx < PR_X0 + PR_W && ty >= PR_Y0 && ty < PR_Y0 + PR_H;
      const inWalk = tx >= PK_WALK.x0 && tx <= PK_WALK.x1 && ty >= PK_WALK.y0 && ty <= PK_WALK.y1;
      const onMe = Math.abs(player.x / TILE - (tx + 0.5)) < 1.5 && Math.abs(player.y / TILE - (ty + 0.5)) < 1.5;
      if (!inField && !inWalk && !onMe && !objects[e.i]) {
        const t = placeObj(tx, ty, 'tree', { hp: 4, variant: hash2(tx * 3 + 1, ty * 3 + 2) > 0.5 ? 1 : 0, rare: treeRare(tx, ty) });
        t.flash = 0.2;
        if (rng() < 0.5) burst(px, py - 10, '#f4f7ff', 3, 40, 0.45, true);
      }
    }
    repaintGround(tx, ty);
  }
  // the plume: a steady sparkle riding the front along the new lane (rate is
  // time-based, so a 240Hz screen gets the same shower as a 60Hz one), with
  // a faint comet tail dropped on the samples the front passed this frame
  while (pkAnim.ti < pkAnim.trail.length - 1 && pkAnim.trail[pkAnim.ti + 1].a <= front) {
    pkAnim.ti++;
    if (rng() < 0.3) { const s = pkAnim.trail[pkAnim.ti]; burst(s.x, s.y - 4, '#6fc4f2', 1, 22, 0.5, true); }
  }
  if (pkAnim.t < PK_ANIM_T) {
    pkAnim.plumeT += dt;
    const s = pkAnim.trail[Math.min(pkAnim.ti, pkAnim.trail.length - 1)];
    while (pkAnim.plumeT > 0.03) {
      pkAnim.plumeT -= 0.03;
      // deep blue against snow and ice, white against the dark pines - the
      // pair keeps the head visible over everything it crosses
      burst(s.x + rand(-4, 4), s.y - 6 + rand(-4, 3), rng() < 0.6 ? '#3a86c8' : '#f4f7ff', 2, 30, 0.5, true);
    }
  }
  if (pkAnim.next >= pkAnim.ev.length && pkAnim.t >= PK_ANIM_T) {
    pkAnim = null;
    const lx = (PK_LINE.x0 + PK_LINE.x1 + 1) * TILE / 2, ly = (PK_LINE.y + 0.5) * TILE;
    burst(lx, ly, '#8fd8ff', 10, 55, 0.5, true);
    burst(lx, ly, '#f4f7ff', 8, 50, 0.45, true);
    if (nearPlayer(lx, ly)) SFX.place();
  }
}

// the die the player is standing at - Chebyshev 1 of its tile, E's own
// reach - shared by the E prompt (drawPkHint, js/ui.js) and the wheel-open
// press (js/input.js), so they can never disagree
function pkDieNear(p) {
  const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = objAt(ptx + dx, pty + dy);
    if (o && o.type === 'pkdie') return o;
  }
  return null;
}

// a pick released off the die's wheel, through the same input.cmd -> runCmd
// path every wheel uses: the wedge IS the roll - picking a difficulty carves
// a fresh track at it, and the die recolours to match. PRACTICE-gated like
// rackEquip, and pkRoll itself refuses a roll while a sweep is out.
function pkWheelPick(p, c) {
  if (!PRACTICE || !PK_DIFF[c.id]) return;
  if (Math.hypot(c.tx * TILE + 8 - p.x, c.ty * TILE + 8 - p.y) > 60) return;
  pkRoll(c.id);
}

// The grounds' clock, from updatePlay under PRACTICE only: the dummy mends
// between combos, broken targets spring back, pop-ups run their cycle,
// sliders patrol their rails, and the parkour lap is timed. The shimmer, the
// wobble and the bar refilling are the whole announcement - no words.
function updatePractice(dt) {
  pkAnimStep(dt); // the roll's carving front, while one is out
  agUpdate(dt);   // the archery round's clock, sink, countdown and spawner
  if (pkDieObj && pkDieObj.rollT > 0) pkDieObj.rollT = Math.max(0, pkDieObj.rollT - dt); // the die's tumble
  for (const o of practiceDummies) {
    o.hitT += dt;
    if (o.hp < o.maxHp && o.hitT > DUMMY_RESET_T) {
      o.hp = o.maxHp;
      o.flash = 0.18;
      const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
      burst(ox, oy - 14, '#f4f7ff', 8, 40, 0.5, true);
      burst(ox, oy - 14, '#e0c890', 5, 35, 0.45, true);
      if (nearPlayer(ox, oy)) SFX.place();
    }
  }
  for (const t of ptargets) {
    t.t += dt;
    if (t.wob > 0) t.wob = Math.max(0, t.wob - dt);
    if (t.swapT > 0) t.swapT -= dt;
    if (t.broken > 0) {
      t.broken -= dt;
      if (t.broken <= 0) { // a fresh face springs onto the bare post
        t.broken = 0;
        t.wob = 0.45;
        const f = ptFace(t);
        burst(f.x, f.y, '#f4f7ff', 6, 35, 0.4, true);
        if (nearPlayer(f.x, f.y)) SFX.place();
      }
    }
    if (t.kind === 'pop') {
      // the cycle: hidden - rise - hold - sink, on the target's own clock
      const C = t.pop || PT_POP, total = C.hide + C.rise + C.hold + C.sink;
      const u = t.t % total;
      if (u < C.hide) t.up = 0;
      else if (u < C.hide + C.rise) t.up = (u - C.hide) / C.rise;
      else if (u < C.hide + C.rise + C.hold) t.up = 1;
      else t.up = 1 - (u - C.hide - C.rise - C.hold) / C.sink;
      // the telegraph: one snow fleck as the pre-rise rattle starts (the
      // rattle itself is drawPTarget's jitter over the same window), and a
      // little bounce as the face locks fully up - each once per cycle
      const cyc = (t.t / total) | 0;
      if (t.warned !== cyc && u > C.hide - 0.35 && u < C.hide) {
        t.warned = cyc;
        burst(t.x, t.y - 4, '#f4f7ff', 3, 22, 0.3, true);
      }
      if (t.up === 1 && t.prevUp < 1) t.wob = Math.max(t.wob, 0.22);
      t.prevUp = t.up;
    }
    if (t.spd > 0) {
      t.s = (t.s + t.spd * t.dir * dt + AG_LEN) % AG_LEN;
      // a rolling carriage kicks up a thin snow trail, paced by distance
      t.dustD += t.spd * dt;
      if (t.dustD > 26) { t.dustD = 0; burst(t.x, t.y + 1, '#f4f7ff', 1, 14, 0.3, true); }
      // a mover about to run into anything parked - or rolling slower - on
      // its rail hops to the other lane and keeps going. Never mid-hop
      // (swapT), and one at a time in array order, which is what lets two
      // head-on movers resolve: the first hops, the second finds its rail clear.
      if (t.swapT <= 0) {
        const ahead = 10 + t.spd * 0.4;
        let block = false;
        for (const o of ptargets) {
          if (o === t || o.gone || o.lane !== t.lane) continue;
          const dd = ((((o.s - t.s) * t.dir) % AG_LEN) + AG_LEN) % AG_LEN;
          if (dd <= 0 || dd >= ahead) continue;
          if (o.spd > 0 && o.dir === t.dir && o.spd >= t.spd) continue; // pulling away
          block = true; break;
        }
        if (block && !agBlocked(1 - t.lane, t.s, 20, t)) { t.lane = 1 - t.lane; t.swapT = 0.9; t.hopping = true; }
      }
    }
    // ease onto the lane it wants, then stand where the track says - the
    // draw lifts the carriage through the swap (the hop), and the landing
    // puffs the moment it settles back onto its rail
    t.laneU += Math.max(-dt / 0.22, Math.min(dt / 0.22, t.lane - t.laneU));
    if (t.hopping && Math.abs(t.lane - t.laneU) < 0.02) {
      t.hopping = false;
      burst(t.x, t.y + 1, '#f4f7ff', 3, 25, 0.3, true);
    }
    const tp = agPos(t.s, t.laneU);
    t.x = tp.x; t.y = tp.y;
  }
  // a round target that has been shot is spent for good
  for (let i = ptargets.length - 1; i >= 0; i--) if (ptargets[i].gone) ptargets.splice(i, 1);
  // the hit rings age out fast - a flash, not a decoration
  for (let i = agRings.length - 1; i >= 0; i--) {
    agRings[i].t += dt;
    if (agRings[i].t >= AG_RING_T) agRings.splice(i, 1);
  }
  // ---- the parkour clock -------------------------------------------------
  // plain coordinate tests against the carved ice: stepping onto the line
  // starts a lap, the far checkpoint keeps it honest, recrossing the line
  // records it and rolls straight into the next - continuous laps. Leaving
  // the ice for PK_OFF_T (or dying) abandons the run without a time.
  const ptx = Math.floor(player.x / TILE), pty = Math.floor(player.y / TILE);
  const onIce = inWorld(ptx, pty) && ground[idx(ptx, pty)] === 1;
  const onLine = onIce && pty === PK_LINE.y && ptx >= PK_LINE.x0 && ptx <= PK_LINE.x1;
  if (player.dead) {
    parkour.on = false;
  } else if (!parkour.on) {
    if (onLine && !parkour.wasLine) { parkour.on = true; parkour.t = 0; parkour.cp = false; parkour.offT = 0; }
  } else {
    parkour.t += dt;
    // this track's checkpoint: near its farthest-east waypoint, on the ice -
    // pkRoll re-aims it at wherever each random loop's far side landed
    if (onIce && Math.hypot(ptx - parkour.cpTx, pty - parkour.cpTy) <= 2.5) parkour.cp = true;
    if (onLine && !parkour.wasLine && parkour.cp) {
      parkour.last = parkour.t;
      const record = !parkour.best || parkour.t < parkour.best;
      // only the STOCK track writes the profile - a rolled track's laps are
      // its own session event, not comparable across rolls
      if (record) { parkour.best = parkour.t; if (!parkour.custom) PROFILE.setBestLap(parkour.t); }
      burst(player.x, player.y - 10, '#ffd95c', 12, 60, 0.55, true);
      burst(player.x, player.y - 10, '#f4f7ff', 8, 45, 0.45, true);
      if (record) SFX.dawnChime(); else SFX.place();
      parkour.t = 0; parkour.cp = false;
    }
    if (!onIce) { parkour.offT += dt; if (parkour.offT > PK_OFF_T) parkour.on = false; }
    else parkour.offT = 0;
  }
  parkour.wasLine = onLine;
}

// slow top-up, never while someone is standing in the site: clearing a
// landmark is a real reward for a while, but it always grows back into one
function updateLandmarks(dt) {
  for (const L of landmarks) {
    if (!L.spec.repop) continue;
    L.repopT -= dt;
    if (L.repopT > 0) continue;
    L.repopT = L.spec.repop;
    if (landmarkPop(L) >= L.spec.pop) continue;
    const px = (L.tx + 0.5) * TILE, py = (L.ty + 0.5) * TILE;
    if (players.some((p) => p.active && !p.dead && !inAir(p) && Math.hypot(p.x - px, p.y - py) < 96)) continue;
    L.spec.spawnOne(L);
  }
}

