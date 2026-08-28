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
  tree:     { solid: true,  tool: 'axe',  needs: 'axe',  verb: 'CHOP', lift: 20,
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
// to pure combat. The practice world itself is SMALL - WORLD is 64 under
// PRACTICE (js/core.js) - so the forest is a collar, not a wilderness. In the
// middle of the field: one dummy on a small packed-earth pad, spawn just
// south of it, the bow rack beside the spawn. The archery targets stand in
// the OPEN, spread along the field's edges near the trees - statics at three
// heights, pop-ups, and two sliders on rails - nothing fenced, shoot them
// from anywhere, roll straight past them. No wildlife, no chests, no pond,
// no harvest: the world drops nothing and asks nothing.
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
//
// Ground 3 is PACKED EARTH, the pad's floor: painted by paintGroundTile's
// earth branch, coloured on both maps, walks exactly like snow
// (updatePlayer's surface block only special-cases ice and holes) but
// refuses prone (tryProne wants ground 0 - there is no snow to dig into) and
// leaves no footprints. It exists only inside this arena; genWorld never
// writes it.
const PR_W = 40, PR_H = 23;                      // the open field, in tiles
const PR_X0 = (WORLD - PR_W) >> 1, PR_Y0 = (WORLD - PR_H) >> 1;
const PR_SPAWN = { tx: PR_X0 + 20, ty: PR_Y0 + 15 }; // just south of the pad, facing the dummy
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

// ---- the archery targets -------------------------------------------------
// Link's-Crossbow-Training-style red ring targets, at different heights and
// with different habits. They are ENTITIES in `ptargets`, not tile objects -
// a slider crosses tiles every frame and nothing about a raised face should
// block a walker - so only arrows meet them: the PRACTICE branch of the
// arrow loop (js/sim.js) tests every live face against PT_HIT_R. A hit
// SHATTERS the face off its post (hitPTarget below - flat feedback, no
// score) and PT_RESPAWN seconds later a fresh one springs back with a
// wobble. drawPTarget (js/draw-world.js) owns every pixel: the face sprite,
// the three post heights, the pop-up hatch and the slide rails.
//   kind  'static' | 'pop' | 'slide'
//   x, y  the base point on the ground (post foot / hatch / track position)
//   alt   px from the base to the face's centre - the "height" arrows aim at
//   up    0..1, how far a pop-up has risen (static kinds sit at 1)
//   t     the behaviour clock; phase offsets stop the pop-ups syncing
//   x0/x1/spd/dir   a slider's track and speed
//   broken          >0: seconds until the face respawns (post stands bare)
//   wob             respawn wobble timer, a scale bounce in the draw
const PT_HIT_R = 11;         // px around the face centre an arrow scores on
const PT_RESPAWN = 2.6;      // s a broken face stays gone
const PT_POP = { hide: 1.4, rise: 0.22, hold: 2.4, sink: 0.22 }; // the pop cycle
const PT_ALTS = [18, 24, 30]; // the three post heights: stake, post, mast
const ptargets = [];

function addPTarget(kind, tx, ty, opts) {
  const t = Object.assign({
    kind, x: (tx + 0.5) * TILE, y: (ty + 1) * TILE - 3,
    alt: PT_ALTS[0], up: 1, t: 0,
    x0: 0, x1: 0, spd: 0, dir: 1,
    broken: 0, wob: 0,
  }, opts || {});
  ptargets.push(t);
  return t;
}

// where a face's centre is right now, in world px - the one geometry the
// update, the arrow test and the draw all share, so they can never disagree
function ptFace(t) {
  // a pop-up's face flips up out of its hatch: the centre rides the rise,
  // bottom edge pinned at the hatch mouth (exactly how drawPTarget anchors it)
  if (t.kind === 'pop') return { x: t.x, y: t.y - 4 - 16 * t.up };
  return { x: t.x, y: t.y - t.alt };
}
// can an arrow score on it this frame
function ptLive(t) { return t.broken <= 0 && (t.kind !== 'pop' || t.up > 0.6); }

// one arrow into the face: the whole flat-feedback payoff - the face bursts
// into painted chips, straw and splinters, and the post stands bare until
// the respawn springs a new one on
function hitPTarget(t, hx, hy) {
  t.broken = PT_RESPAWN;
  t.wob = 0;
  const f = ptFace(t);
  burst(f.x, f.y, '#d0453a', 10, 60, 0.5, true);   // painted chips
  burst(f.x, f.y, '#efe6d0', 8, 55, 0.5, true);    // straw backing
  burst(f.x, f.y, '#a3794f', 5, 45, 0.45, true);   // splinters
  if (nearPlayer(f.x, f.y)) { SFX.hit(); SFX.break_(); }
}

// ---- the ice parkour -----------------------------------------------------
// PK_PATH is the loop's centreline in world tiles (the practice WORLD is a
// fixed 64, so these are absolute), carved 2-3 tiles wide through the forest
// collar by genPracticeWorld - trees hug both sides, and ice being
// mechanically slippery IS the whole game of it. The lap: step onto the
// start-line ice under the west flag gate (the clock starts), round the far
// checkpoint, recross the line (the clock records). Both line and checkpoint
// are plain coordinate tests against the carved ice, not objects.
const PK_PATH = [
  [7, 31], [7, 24], [5, 18], [8, 13],                       // west leg, up
  [14, 9], [22, 12], [30, 8], [38, 12], [46, 9], [53, 13],  // the top slalom
  [57, 18], [55, 25], [58, 31], [55, 38], [57, 45],         // east leg, down
  [52, 50], [44, 54], [36, 50], [28, 54], [20, 50],         // the bottom slalom
  [13, 53], [8, 48], [6, 41], [7, 35], [7, 31],             // and home
];
const PK_LINE_Y = 31;  // start/finish: the track ice on this row...
const PK_LINE_X1 = 9;  // ...at tx <= this (the west gate)
const PK_CP_X0 = 54;   // checkpoint: track ice on the same row, far (east) leg
const PK_OFF_T = 2.5;  // s off the ice before a live run is abandoned
const PK_GATE = { x: 9.5 * TILE, y: 27.5 * TILE }; // where the BEST/LAST plate hangs, clear above the north flag
// one runner, one clock: the live lap (on/t/cp), the abandon timer, and the
// last and best laps. `best` is the profile's all-time record - seeded from
// PROFILE.bestLap() by genPracticeWorld and written back through
// PROFILE.setBestLap() on a record, the one thing practice ever writes -
// while `last` is this session's only
const parkour = { on: false, t: 0, cp: false, wasLine: false, offT: 0, last: 0, best: 0 };

function genPracticeWorld() {
  const ax = PR_X0, ay = PR_Y0;
  // solid forest everywhere, then the field carved out of it - the rim
  // tiles keep a scatter of trees so the treeline reads ragged, not stamped
  for (let ty = 0; ty < WORLD; ty++) {
    for (let tx = 0; tx < WORLD; tx++) {
      const inX = tx >= ax && tx < ax + PR_W, inY = ty >= ay && ty < ay + PR_H;
      if (inX && inY) {
        const rim = tx === ax || tx === ax + PR_W - 1 || ty === ay || ty === ay + PR_H - 1;
        if (!rim || hash2(tx * 3 + 7, ty * 5 + 1) > 0.4) continue;
      }
      placeObj(tx, ty, 'tree', { hp: 4, variant: randi(0, 1), rare: treeRare(tx, ty) });
    }
  }
  // ---- the pad: packed earth under the dummy, corners rounded off --------
  for (let ty = ay + 10; ty <= ay + 14; ty++) for (let tx = ax + 17; tx <= ax + 23; tx++) {
    if (!objects[idx(tx, ty)]) ground[idx(tx, ty)] = 3;
  }
  for (const [cx2, cy2] of [[17, 10], [23, 10], [17, 14], [23, 14]]) {
    ground[idx(ax + cx2, ay + cy2)] = 0;
  }
  // ---- the dummy on its pad, the rack by the spawn -----------------------
  const put = (tx, ty, type, extra) => { if (!objects[idx(ax + tx, ay + ty)]) return placeObj(ax + tx, ay + ty, type, extra); return null; };
  const d = put(20, 12, 'dummy', { hp: DUMMY_HP, maxHp: DUMMY_HP, hitT: 99,
    mLast: 0, mTotal: 0, mT0: 0, mT1: 0 }); // the meter's combo ledger
  if (d) practiceDummies.push(d);
  put(14, 14, 'rack', { lead: true }); put(15, 14, 'rack', {});
  // ---- the targets: in the open, spread along the treeline ---------------
  // two sliders patrol the north edge, statics of all three heights hold
  // the middles, pop-ups work the corners - shoot any of them from anywhere
  addPTarget('slide', ax + 3, ay + 2, { alt: PT_ALTS[0], x0: (ax + 3) * TILE, x1: (ax + 13) * TILE, spd: 26 });
  addPTarget('slide', ax + 26, ay + 2, { alt: PT_ALTS[2], x0: (ax + 26) * TILE, x1: (ax + 36) * TILE, spd: 44 });
  addPTarget('static', ax + 19, ay + 2, { alt: PT_ALTS[1] });
  addPTarget('static', ax + 2, ay + 13, { alt: PT_ALTS[0] });
  addPTarget('static', ax + 37, ay + 9, { alt: PT_ALTS[2] });
  addPTarget('pop', ax + 2, ay + 7, { alt: PT_ALTS[0], up: 0, t: 0.0 });
  addPTarget('pop', ax + 37, ay + 16, { alt: PT_ALTS[0], up: 0, t: 1.1 });
  addPTarget('pop', ax + 14, ay + 20, { alt: PT_ALTS[1], up: 0, t: 2.2 });
  addPTarget('pop', ax + 25, ay + 20, { alt: PT_ALTS[0], up: 0, t: 3.3 });
  // ---- the ice parkour: the gate walk, the carved loop, the flags --------
  // the walk out of the field is cleared snow (the approach should not
  // slide); the loop is carved AFTER it so their overlap ends up ice, which
  // is what puts the start line - the loop ice at PK_LINE_Y - under the gate
  const fell = (tx, ty) => { objects[idx(tx, ty)] = null; };
  for (let ty = 30; ty <= 31; ty++) for (let tx = 8; tx <= 12; tx++) { fell(tx, ty); ground[idx(tx, ty)] = 0; }
  for (let s = 0; s < PK_PATH.length - 1; s++) {
    const [x0, y0] = PK_PATH[s], [x1, y1] = PK_PATH[s + 1];
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 3;
    for (let i = 0; i <= steps; i++) {
      const fx = x0 + (x1 - x0) * i / steps, fy = y0 + (y1 - y0) * i / steps;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = Math.round(fx) + dx, ty = Math.round(fy) + dy;
        if (!inWorld(tx, ty) || Math.hypot(tx - fx, ty - fy) > 1.15) continue;
        fell(tx, ty);
        ground[idx(tx, ty)] = 1;
      }
    }
  }
  // the gate: a flag either side of the walk where it meets the line
  fell(9, 29); placeObj(9, 29, 'banner');
  fell(9, 32); placeObj(9, 32, 'banner');
  // the record stands across visits: the gate plate opens showing the
  // profile's best lap before this session has run one
  parkour.best = PROFILE.bestLap();
}

// The grounds' clock, from updatePlay under PRACTICE only: the dummy mends
// between combos, broken targets spring back, pop-ups run their cycle,
// sliders patrol their rails, and the parkour lap is timed. The shimmer, the
// wobble and the bar refilling are the whole announcement - no words.
function updatePractice(dt) {
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
      const C = PT_POP, total = C.hide + C.rise + C.hold + C.sink;
      const u = t.t % total;
      if (u < C.hide) t.up = 0;
      else if (u < C.hide + C.rise) t.up = (u - C.hide) / C.rise;
      else if (u < C.hide + C.rise + C.hold) t.up = 1;
      else t.up = 1 - (u - C.hide - C.rise - C.hold) / C.sink;
    } else if (t.kind === 'slide') {
      t.x += t.spd * t.dir * dt;
      if (t.x > t.x1) { t.x = t.x1; t.dir = -1; }
      if (t.x < t.x0) { t.x = t.x0; t.dir = 1; }
    }
  }
  // ---- the parkour clock -------------------------------------------------
  // plain coordinate tests against the carved ice: stepping onto the line
  // starts a lap, the far checkpoint keeps it honest, recrossing the line
  // records it and rolls straight into the next - continuous laps. Leaving
  // the ice for PK_OFF_T (or dying) abandons the run without a time.
  const ptx = Math.floor(player.x / TILE), pty = Math.floor(player.y / TILE);
  const onIce = inWorld(ptx, pty) && ground[idx(ptx, pty)] === 1;
  const onLine = onIce && pty === PK_LINE_Y && ptx <= PK_LINE_X1;
  if (player.dead) {
    parkour.on = false;
  } else if (!parkour.on) {
    if (onLine && !parkour.wasLine) { parkour.on = true; parkour.t = 0; parkour.cp = false; parkour.offT = 0; }
  } else {
    parkour.t += dt;
    if (onIce && pty === PK_LINE_Y && ptx >= PK_CP_X0) parkour.cp = true;
    if (onLine && !parkour.wasLine && parkour.cp) {
      parkour.last = parkour.t;
      const record = !parkour.best || parkour.t < parkour.best;
      if (record) { parkour.best = parkour.t; PROFILE.setBestLap(parkour.t); }
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

