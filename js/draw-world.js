'use strict';
// The world's pixels: the prerendered ground and its runtime repaints, every
// entity's sprite pass - players, wildlife, robots, buildings, spent arrows,
// worker flags - and the lighting, warm glows, weather and vignettes over it
// all. Nothing here decides anything; it only draws what the sim settled.
// ------------------------------------------------------------ ground prerender
const groundCv = document.createElement('canvas');
groundCv.width = WORLD * TILE; groundCv.height = WORLD * TILE;

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263 + SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// paints one tile into the pre-rendered ground canvas; used by the boot-time
// full render and by repaintGround() when a tile changes at runtime (ice holes)
function paintGroundTile(g, tx, ty) {
      const px = tx * TILE, py = ty * TILE;
      const gv = ground[idx(tx, ty)];
      const h = hash2(tx, ty);
      // soft tone variation sampled per 8px quad so no tile grid shows
      const quad = (g2, colA, colB) => {
        for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
          const gx = tx * 2 + qx, gy = ty * 2 + qy;
          const nz = vnoise(gx / 13, gy / 13);
          g2.fillStyle = nz > 0.5 ? colA : colB;
          g2.fillRect(px + qx * 8, py + qy * 8, 8, 8);
        }
      };
      if (gv === 2) {
        // pick-carved hole: dark open water, drifting glints, chipped ice rim
        quad(g, '#1e3a54', '#234159');
        g.fillStyle = '#2e5573';
        const n = 2 + ((h * 5) | 0) % 2;
        for (let i = 0; i < n; i++) {
          g.fillRect(px + ((h * (37 + i * 53)) | 0) % 12 + 1, py + ((h * (71 + i * 31)) | 0) % 12 + 2, 3, 1);
        }
        // broken-ice chips on every edge that still borders frozen ground
        g.fillStyle = '#d6ecf4';
        const chip = (x0, y0, sx, sy) => {
          for (let i = 0; i < TILE; i += 2) {
            if (hash2(tx * 31 + x0 + sx * i, ty * 37 + y0 + sy * i) > 0.4) {
              g.fillRect(px + x0 + sx * i, py + y0 + sy * i, sx ? 2 : 1, sy ? 2 : 1);
            }
          }
        };
        if (!inWorld(tx, ty - 1) || ground[idx(tx, ty - 1)] !== 2) chip(0, 0, 1, 0);
        if (!inWorld(tx, ty + 1) || ground[idx(tx, ty + 1)] !== 2) chip(0, TILE - 1, 1, 0);
        if (!inWorld(tx - 1, ty) || ground[idx(tx - 1, ty)] !== 2) chip(0, 0, 0, 1);
        if (!inWorld(tx + 1, ty) || ground[idx(tx + 1, ty)] !== 2) chip(TILE - 1, 0, 0, 1);
      } else if (gv === 1) {
        quad(g, '#b9dcec', '#c4e3f0');
        // cracks
        if (h > 0.55) {
          g.fillStyle = '#a3cbe0';
          const n = 2 + ((h * 7) | 0) % 3;
          let lx = px + 3 + ((h * 100) | 0) % 9, ly = py + 3 + ((h * 53) | 0) % 9;
          for (let i = 0; i < n; i++) {
            g.fillRect(lx, ly, 2, 1);
            lx += (((h * (13 + i * 7)) | 0) % 3) - 1 + 2;
            ly += (((h * (29 + i * 5)) | 0) % 3) - 1;
          }
        }
        if (h < 0.12) { g.fillStyle = '#ddf1f8'; g.fillRect(px + ((h * 210) | 0) % 12, py + ((h * 87) | 0) % 12, 2, 2); }
        // rim where ice meets snow
        g.fillStyle = '#d6ecf4';
        if (!inWorld(tx, ty - 1) || ground[idx(tx, ty - 1)] === 0) g.fillRect(px, py, TILE, 1);
        if (!inWorld(tx, ty + 1) || ground[idx(tx, ty + 1)] === 0) g.fillRect(px, py + TILE - 1, TILE, 1);
        if (!inWorld(tx - 1, ty) || ground[idx(tx - 1, ty)] === 0) g.fillRect(px, py, 1, TILE);
        if (!inWorld(tx + 1, ty) || ground[idx(tx + 1, ty)] === 0) g.fillRect(px + TILE - 1, py, 1, TILE);
      } else {
        quad(g, '#ebf2fa', '#e7eff8');
        // dither speckles
        const n = (h * 4) | 0;
        g.fillStyle = '#d5e2f0';
        for (let i = 0; i < n; i++) {
          g.fillRect(px + ((h * (31 + i * 47)) | 0) % 15, py + ((h * (17 + i * 73)) | 0) % 15, 1, 1);
        }
        // sparkles
        if (h > 0.93) {
          g.fillStyle = '#ffffff';
          g.fillRect(px + ((h * 211) | 0) % 14, py + ((h * 131) | 0) % 14, 1, 1);
        }
        // buried grass tufts
        if (h > 0.80 && h < 0.84) {
          g.fillStyle = '#9db8a6';
          const gx = px + ((h * 500) | 0) % 12 + 2, gy = py + ((h * 300) | 0) % 12 + 2;
          g.fillRect(gx, gy, 1, 2); g.fillRect(gx + 2, gy + 1, 1, 1); g.fillRect(gx - 1, gy + 1, 1, 1);
        }
        // tiny pebble
        if (h > 0.60 && h < 0.615) {
          g.fillStyle = '#b6c2d4';
          g.fillRect(px + ((h * 700) | 0) % 12 + 2, py + ((h * 900) | 0) % 12 + 2, 2, 1);
        }
      }
}

function renderGround() {
  const g = groundCv.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (let ty = 0; ty < WORLD; ty++) {
    for (let tx = 0; tx < WORLD; tx++) paintGroundTile(g, tx, ty);
  }
}

// runtime ground change (hole opened / refrozen): repaint the tile plus its
// four neighbors so edge rims recompute
function repaintGround(tx, ty) {
  const g = groundCv.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (inWorld(tx + dx, ty + dy)) paintGroundTile(g, tx + dx, ty + dy);
  }
}

// ------------------------------------------------------------ entity draw
// Which of a pine's sixteen sway frames it is wearing this frame. A tree does
// not animate on a clock of its own: the wind wave (the `wind` banner,
// js/sim.js) is sampled at the tree's own tile, so a gust crossing the field
// walks one band of trees through their cycle at a time and the treeline
// rustles in order. The tile's hash picks the frame it RESTS on, which is
// what keeps a dead-calm forest from reading as one stamp repeated - and at
// full dark windSway() returns 0 and every tree simply holds that frame.
const TREE_FRAMES = 16;
function treeFrame(tx, ty) {
  const rest = (hash2(tx * 3 + 1, ty * 3 + 2) * TREE_FRAMES) | 0;
  return (rest + Math.round(windSway(tx, ty) * (TREE_FRAMES / 2)) + TREE_FRAMES) % TREE_FRAMES;
}

// The treasure chest's sprite bakes HERE, from its own grid - js/sprites.js
// is byte-fragile (BOM, mangled-byte repair) and is never rewritten, so a
// new scenery sprite bakes beside its draw pass instead. Snow-capped lid,
// gold banding and lock: the same gold the payout floater speaks in.
const CHEST_SPR = (() => {
  const pal = { o: '#241a12', w: '#8a6142', W: '#a3794f', d: '#6b4a34', g: '#f2cc6a', G: '#c9a23f', s: '#eef4fb' };
  const rows = [
    '..oooooooooooo..',
    '.osssssssssssso.',
    '.oWwwwwwwwwwwWo.',
    '.oWwwwddwwwwwWo.',
    '.oggggggggggggo.',
    '.owwwwwGGwwwwwo.',
    '.owwwwwggwwwwwo.',
    '.owwdwwwwwwdwwo.',
    '.oddddddddddddo.',
    '..oooooooooooo..',
  ];
  const c = document.createElement('canvas');
  c.width = 16; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => {
    for (let x = 0; x < 16; x++) if (pal[r[x]]) { g.fillStyle = pal[r[x]]; g.fillRect(x, y, 1, 1); }
  });
  return c;
})();
// The practice dummy (the `practice arena` banner, js/world.js), baked here
// for the same reason the chest is. A big target you read across the arena:
// a burlap sack head with stitched eyes under a snow cap, arms lashed to a
// crossbar with rope, a sack torso wearing a painted red ring, straw leaking
// out of the cinch, and a post into crossed skids in the drift. 26x42 - a
// head taller than a player, drawn up off its one solid tile like a tree.
const DUMMY_SPR = (() => {
  const pal = {
    o: '#1c1208',                                        // outline
    w: '#5c4226', W: '#8a6142', v: '#b98a58',            // post + crossbar wood
    b: '#a8875a', B: '#c9a874', d: '#7a5f3d', D: '#5e4930', // burlap, lit to shaded
    r: '#5c4526', R: '#93744a',                          // rope windings
    t: '#a83232', T: '#d05548',                          // the painted ring
    s: '#f4f7ff', S: '#c4d4ea',                          // snow cap and drift
    y: '#e0c890', Y: '#f2e0a8',                          // straw
    x: '#4a3826',                                        // stitching
  };
  const rows = [
    '..........oooooo..........',
    '.........osssssso.........',
    '........obsssssSbdo.......',
    '.......oBBbbbbbbbddo......',
    '.......oBbbbbbbbbddo......',
    '.......oBbbxbbxbbddo......',
    '.......oBbbbxxbbbddo......',
    '.......odbbbbbbbbdDo......',
    '........odbbbbbbdDo.......',
    '..........orrrro..........',
    '.osWWWWWWWrrrrrrWWWWWWWso.',
    '.ovWWWWWWWrbbbbrWWWWWWWvo.',
    '.owwWWWWWWrbbbbrWWWWWWwwo.',
    '..oowwwwwWrbbbbrWwwwwwoo..',
    '.....oBBbbbbbbbbbbddo.....',
    '....oBBbbbbbbbbbbbbddo....',
    '....oBbbbbbbbbbbbbbddo....',
    '....oRrrRrrRrrRrrRrro.....',
    '....oBbbbbbttttbbbbddo....',
    '....oBbbbttbbbbttbbddo....',
    '....oBbbttbbbbbbttbddo....',
    '....oBbbtbbbTTbbbtbddo....',
    '....oBbbtbbTTTTbbtbddo....',
    '....oBbbtbbbTTbbbtbddo....',
    '....oBbbttbbbbbbttbddo....',
    '....oBbbbttbbbbttbbddo....',
    '....oBbbbbbttttbbbbddo....',
    '....oRrrRrrRrrRrrRrro.....',
    '....oBbbbxbbbbbbxbbddo....',
    '.....odbbbbbbbbbbdDo......',
    '......yodbbbbbbdoy........',
    '.......Yorrrrrroy.........',
    '..........oWwwwo..........',
    '..........oWwwwo..........',
    '..........oWwwwo..........',
    '..........oWwvwo..........',
    '..........oWwwwo..........',
    '..........oWwwwo..........',
    '........ooWWwwWWoo........',
    '......oWWwwwwwwwwWWo......',
    '....osWWwwwwwwwwwwWWso....',
    '...ssSsssssssssssssSss....',
  ];
  const c = document.createElement('canvas');
  c.width = 26; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => {
    for (let x = 0; x < 26; x++) if (pal[r[x]]) { g.fillStyle = pal[r[x]]; g.fillRect(x, y, 1, 1); }
  });
  return c;
})();
// ---- the training grounds' pixels (practice arena only) -------------------
// The archery target face, baked per-pixel rather than from a grid:
// concentric rings want true circles, and the hand-made feel comes back in
// through hash dithering on every band edge, a top-left light direction on
// every band, straw ticks around the batt, four iron pins and a dusting of
// snow on the wooden rim. Same bake-beside-the-draw rule as the chest. One
// bake, two sizes: every ring threshold scales with the face, so the small
// face is its own crisp sprite instead of a runtime downscale of the big one.
function bakeTargetFace(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const put = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  const k = size / 32, cc = size / 2 - 0.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - cc, dy = y - cc;
    let d = Math.hypot(dx, dy);
    d += (hash2(x * 7 + 3, y * 11 + 5) - 0.5) * 0.9 * k; // hand-jitter every band edge
    if (d > 15.4 * k) continue;
    const lit = (-dx * 0.55 - dy * 0.83) > 0.5 * k;      // light from the upper left
    const h = hash2(x * 13 + 1, y * 17 + 9);
    if (d > 14.4 * k) { put(x, y, '#241a12'); continue; }              // outline
    if (d > 13.1 * k) {                                                 // wooden frame ring
      put(x, y, lit ? (h > 0.75 ? '#a3794f' : '#8a6142') : (h > 0.8 ? '#5c4226' : '#4a3421'));
      continue;
    }
    if (d > 12.5 * k) { put(x, y, '#3a2c1c'); continue; }               // the batt's shadow ring
    if (d > 9.4 * k) {                                                  // outer straw ring
      const a = Math.atan2(dy, dx);
      const tick = hash2(((a * 9) | 0) * 5 + 2, 7) > 0.6 && h > 0.45;   // radial straw grain
      put(x, y, tick ? '#c9b078' : lit ? '#ece0c2' : '#d9c9a8');
      continue;
    }
    if (d > 6.2 * k) { put(x, y, lit ? '#d0453a' : '#a83232'); continue; } // red ring
    if (d > 3.2 * k) { put(x, y, lit ? '#f0e6cc' : '#ddd0b0'); continue; } // inner cream
    put(x, y, d > 1.4 * k ? (lit ? '#d0453a' : '#b03428') : '#e05548');    // the bullseye
  }
  // four iron pins holding the batt to its frame
  const m = cc | 0, e = size - 3;
  for (const [px2, py2] of [[m, 1], [m, e], [1, m], [e, m]]) {
    g.fillStyle = '#241a12'; g.fillRect(px2, py2, 2, 2);
    g.fillStyle = '#8b93a8'; g.fillRect(px2, py2, 1, 1);
  }
  // snow settled along the top of the rim
  for (let x = (size >> 2); x < size - (size >> 2); x++) {
    if (hash2(x * 3 + 1, 51) > 0.35) {
      const y = 1 + Math.round(Math.abs(x - cc) * Math.abs(x - cc) / (60 * k));
      g.fillStyle = '#f4f7ff'; g.fillRect(x, y, 1, 1);
      if (hash2(x * 5, 53) > 0.6) { g.fillStyle = '#c4d4ea'; g.fillRect(x, y + 1, 1, 1); }
    }
  }
  return c;
}
const TARGET_SPR = bakeTargetFace(32);   // the large face
const TARGET_SPR_S = bakeTargetFace(20); // the small one (32 * AG_SIZE[0])

// The weapon rack, TWO TILES wide (the `rack` entry in js/world.js carries
// the lead/follower pair). Baked per-pixel like the target face rather than
// from a grid, because a strung bow stave wants a true curve: an A-frame of
// posts and rails with three strung longbows leaned against the top rail and
// a hung quiver of fletched shafts. Snow rides the rail and the post caps.
const RACK_SPR = (() => {
  const c = document.createElement('canvas');
  c.width = 34; c.height = 28;
  const g = c.getContext('2d');
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const O = '#241a12', wd = '#5c4226', wl = '#8a6142', wp = '#a3794f';
  // the two posts, into flared feet
  for (const x0 of [1, 29]) {
    rect(x0, 2, 4, 23, O);
    rect(x0 + 1, 3, 1, 21, wl);
    rect(x0 + 2, 3, 1, 21, wd);
    rect(x0 - 1, 24, 6, 3, O);       // the foot block
    rect(x0, 25, 4, 1, wd);
    px(x0, 25, wl);
  }
  // rails: the heavy top rail the bows lean on, a thin keeper rail below
  rect(0, 5, 34, 4, O);
  rect(1, 6, 32, 1, wl); rect(1, 7, 32, 1, wd);
  px(0, 6, wp); px(33, 6, wp);       // end-grain glints on the overhang
  rect(1, 18, 32, 3, O);
  rect(2, 19, 30, 1, wd);
  // three strung longbows, tips hooked over the top rail. The stave bends
  // left off the straight string, each with its own height and draw
  const bows = [[9, 2, 3], [16, 4, 2], [23, 2, 3]]; // centre, top y, belly
  for (const [cx2, ty0, bend] of bows) {
    rect(cx2, ty0 + 1, 1, 23 - ty0 - 1, '#f0e6cc');            // the string
    for (let y = ty0; y <= 23; y++) {                           // the stave
      const u = (y - ty0) / (23 - ty0);
      const b = Math.round(Math.sin(u * Math.PI) * bend);
      px(cx2 - b, y, '#6b4a30');
      px(cx2 - b - 1, y, '#c9a874');
    }
    rect(cx2 - bend - 1, 11, 2, 3, '#5c4226');                  // the grip wrap
  }
  // the quiver, leaned inside the right post, shafts fletched red and straw
  rect(25, 10, 4, 13, O);
  rect(26, 11, 1, 11, '#93744a'); rect(27, 11, 1, 11, '#6e4f2f');
  rect(26, 13, 2, 1, '#8b93a8');                                // iron band
  rect(26, 20, 2, 1, '#8b93a8');
  for (const [sx2, sy0, f] of [[26, 6, '#d0453a'], [28, 7, '#e0c890'], [27, 5, '#d0453a']]) {
    rect(sx2, sy0 + 2, 1, 10 - sy0, wp);                        // shaft into the mouth
    px(sx2, sy0, f); px(sx2, sy0 + 1, f);                       // the fletching
  }
  // snow: a broken run along the top rail and caps on both posts
  for (let x = 0; x < 34; x++) {
    if (hash2(x * 7, 91) > 0.45) px(x, 4, '#f4f7ff');
    if (hash2(x * 5, 93) > 0.75) px(x, 5, '#c4d4ea');
  }
  for (const x0 of [1, 29]) { rect(x0, 1, 4, 1, '#f4f7ff'); px(x0 + 3, 2, '#c4d4ea'); }
  return c;
})();

// The damage meter over a dummy's head: LAST HIT / DPS / TOTAL for the combo
// in progress, on a small frost plate in the overhead frame's language. A
// deliberate labelled-row carve-out from show-don't-label (recorded in
// CLAUDE.md beside the settings and PLAYER panels): a training instrument's
// whole job is comparing numbers, and no shape does that. Visible only while
// a combo is live, hanging on DUMMY_METER_LINGER past the mend so the final
// read stands, then fading - Shadow text throughout, since the plate rides a
// globalAlpha fade. `botY` is where the plate's bottom edge sits.
function drawDummyMeter(o, cxp, botY) {
  if (!o.mTotal) return;
  const over = o.hitT - DUMMY_RESET_T;
  const a = over <= DUMMY_METER_LINGER - 0.8 ? 1 : (DUMMY_METER_LINGER - over) / 0.8;
  if (a <= 0) return;
  const dps = Math.round(o.mTotal / Math.max(1, o.mT1 - o.mT0));
  const rows = [
    ['LAST HIT', String(Math.round(o.mLast)), '#ffd95c'],
    ['DPS',      String(dps),                 '#f4f7ff'],
    ['TOTAL',    String(Math.round(o.mTotal)), '#e0c890'],
  ];
  const W = 60, H = 25;
  const x = Math.round(cxp - W / 2), y = Math.round(botY - H);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(12,18,42,0.85)';
  ctx.fillRect(x - 1, y - 1, W + 2, H + 2);
  ctx.fillStyle = '#3a4470';
  ctx.fillRect(x, y, W, 1); ctx.fillRect(x, y + H - 1, W, 1);
  ctx.fillRect(x, y, 1, H); ctx.fillRect(x + W - 1, y, 1, H);
  for (let i = 0; i < 3; i++) {
    const ry = y + 3 + i * 7;
    drawPixelTextShadow(ctx, rows[i][0], x + 3, ry, '#9fb6d8', 'rgba(8,12,28,0.9)');
    const v = rows[i][1];
    drawPixelTextShadow(ctx, v, x + W - 3 - pixelTextWidth(v), ry, rows[i][2], 'rgba(8,12,28,0.9)');
  }
  ctx.globalAlpha = 1;
}

// ---- the ice parkour's pixels (practice arena only) -----------------------
// the start/finish line: ONE fixed-width checker band laid flat across the
// force-iced PK_LINE strip (the practice arena banner, js/world.js - the
// same box updatePractice times laps with), in the flat pass before anything
// that walks. The strip is always exactly x0..x1 whatever the roll carved,
// so the band never stretches, never gaps, and always ends at its two flags.
function drawParkourLine(ox, oy) {
  const px = PK_LINE.x0 * TILE - ox, py = PK_LINE.y * TILE - oy;
  const w = (PK_LINE.x1 - PK_LINE.x0 + 1) * TILE;
  if (px > WV_W || py > WV_H || px + w < 0 || py + TILE < 0) return;
  ctx.fillStyle = '#1c2130';
  ctx.fillRect(px, py + 3, w, 1); ctx.fillRect(px, py + 12, w, 1); // edge rails
  for (let cx2 = 0; cx2 < w; cx2 += 4) {
    for (let r = 0; r < 2; r++) {
      ctx.fillStyle = ((cx2 >> 2) + r) % 2 ? '#1c2130' : '#f4f7ff';
      ctx.fillRect(px + cx2, py + 4 + r * 4, 4, 4);
    }
  }
}

// The parkour's two readouts. The live lap clock rides over the runner's
// head while a run is on - the clock appearing at all is what says the line
// worked. Once any lap exists, BEST / LAST hang on a frost plate over the
// gate flags: the dummy meter's instrument language, and the same recorded
// labelled-row carve-out from show-don't-label (CLAUDE.md) - a stopwatch's
// whole job is comparing numbers.
function drawParkour(ex, ey, now) {
  if (parkour.on && !player.dead) {
    // above the overhead name frame, not on it - the clock and the name are
    // both centred on the player and would collide at the same row
    const t = parkour.t.toFixed(1);
    drawPixelTextOutline(ctx, t, Math.round(player.x - ex - pixelTextWidth(t) / 2),
      Math.round(player.y - ey - 42), parkour.cp ? '#8fd8ff' : '#ffd95c');
  }
  if (!parkour.best) return;
  const x0 = Math.round(PK_GATE.x - ex), y0 = Math.round(PK_GATE.y - ey);
  if (x0 < -40 || y0 < -30 || x0 > WV_W + 40 || y0 > WV_H + 30) return;
  // BEST can arrive from the profile with no lap run yet this session, so an
  // unrun LAST shows a dash rather than a meaningless 0.0
  const rows = [
    ['BEST', parkour.best.toFixed(1), '#ffd95c'],
    ['LAST', parkour.last ? parkour.last.toFixed(1) : '-', '#f4f7ff'],
  ];
  const W = 46, H = 18;
  const x = x0 - (W >> 1), y = y0 - H;
  ctx.fillStyle = 'rgba(12,18,42,0.85)';
  ctx.fillRect(x - 1, y - 1, W + 2, H + 2);
  ctx.fillStyle = '#3a4470';
  ctx.fillRect(x, y, W, 1); ctx.fillRect(x, y + H - 1, W, 1);
  ctx.fillRect(x, y, 1, H); ctx.fillRect(x + W - 1, y, 1, H);
  for (let i = 0; i < 2; i++) {
    const ry = y + 3 + i * 7;
    drawPixelTextShadow(ctx, rows[i][0], x + 3, ry, '#9fb6d8', 'rgba(8,12,28,0.9)');
    const v = rows[i][1];
    drawPixelTextShadow(ctx, v, x + W - 3 - pixelTextWidth(v), ry, rows[i][2], 'rgba(8,12,28,0.9)');
  }
}

// ---- the roll station's pixels -------------------------------------------
// One colour per difficulty, hotter with the count: green, amber, red, no
// words. PK_DIE_COL is the DIE's body in that colour (lite/body/dark for the
// cube's lighting) - the standing die wears the current track's set, and the
// roll wheel's wedges (renderWheel, js/ui.js) are the same three cubes, so
// picking a wedge visibly becomes the die. PK_PIP_COL colours the wheel's
// hovered labels.
const PK_PIP_COL = ['#7ddb7a', '#ffd95c', '#d0453a'];
const PK_DIE_COL = [
  { lite: '#aeeea9', body: '#7ddb7a', dark: '#4f9c55' },  // easy: green die
  { lite: '#ffe9a0', body: '#ffd95c', dark: '#c89a3c' },  // medium: amber die
  { lite: '#e8776a', body: '#d0453a', dark: '#8f2a24' },  // hard: red die
];
const PK_PIP_AT = [[[3, 3]], [[1, 1], [5, 5]], [[1, 5], [3, 3], [5, 1]]]; // die-face pip layouts, on an 8x8 face

// The die on its pedestal: a cube on a slate plinth with a gilt trim (the
// chest's gold - "this is worth walking to"), its whole BODY dyed the
// current track's difficulty colour with the matching pip count on its face
// - the die is the readout of what the track is. While rollT runs it
// tumbles - jitters on its plinth scrambling the face - which is the whole
// "the world just rerolled" announcement at the spot the press happened.
function drawPkDie(o, px, py, now) {
  ctx.fillStyle = 'rgba(40,60,100,0.25)'; ctx.fillRect(px + 2, py + 14, 12, 2);
  // the plinth
  ctx.fillStyle = '#242a38'; ctx.fillRect(px + 1, py + 9, 14, 6);
  ctx.fillStyle = '#454e60'; ctx.fillRect(px + 2, py + 10, 12, 4);
  ctx.fillStyle = '#5c6880'; ctx.fillRect(px + 2, py + 10, 12, 1);
  ctx.fillStyle = '#ffd95c'; ctx.fillRect(px + 2, py + 9, 2, 1); ctx.fillRect(px + 12, py + 9, 2, 1); // gilt corners
  // the die, tumbling while a roll runs
  const rolling = o.rollT > 0;
  const jx = rolling ? Math.round(Math.sin(now * 41) * 1.5) : 0;
  const jy = rolling ? Math.round(Math.cos(now * 33)) : 0;
  const dx = px + 3 + jx, dy = py - 1 + jy;
  const di = Math.max(0, PK_DIFFS.indexOf(parkour.diff));
  const C = PK_DIE_COL[di];
  ctx.fillStyle = '#241a12'; ctx.fillRect(dx - 1, dy - 1, 12, 12);
  ctx.fillStyle = C.body; ctx.fillRect(dx, dy, 10, 10);
  ctx.fillStyle = C.lite; ctx.fillRect(dx, dy, 10, 1); ctx.fillRect(dx, dy, 1, 10);
  ctx.fillStyle = C.dark; ctx.fillRect(dx + 9, dy + 1, 1, 9); ctx.fillRect(dx + 1, dy + 9, 9, 1);
  // the face: the difficulty's pip count in dark, scrambled while tumbling
  const n = rolling ? ((now * 15) | 0) % 3 : di;
  ctx.fillStyle = '#1c2130';
  for (const [ax2, ay2] of PK_PIP_AT[n]) ctx.fillRect(dx + 1 + ax2, dy + 1 + ay2, 2, 2);
}

// ---- the archery track's pixels ------------------------------------------
// The two-rail target track around the field's perimeter (AG_RECT,
// js/world.js), drawn flat in the ground pass (render.js) under everything
// that walks: ties spanning both rails like a narrow-gauge railway, then the
// outer and inner rail, snow dusted along the wood by position hash. The
// trolleys riding it are the targets themselves (drawPTarget below).
function drawAgTrack(ox, oy) {
  const R = AG_RECT, g = AG_LANE_GAP;
  const x0 = Math.round(R.x0 - ox), x1 = Math.round(R.x1 - ox);
  const y0 = Math.round(R.y0 - oy), y1 = Math.round(R.y1 - oy);
  if (x0 > WV_W || y0 > WV_H || x1 < 0 || y1 < 0) return;
  // a hollow rectangular band of thickness t whose four bars share EXACT
  // corner extents - each rail below is two of these (dark rim over the
  // ground, light wood core on top), so no bar can overhang or gap another
  const band = (bx0, by0, bx1, by1, t, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(bx0, by0, bx1 - bx0 + t, t);
    ctx.fillRect(bx0, by1, bx1 - bx0 + t, t);
    ctx.fillRect(bx0, by0, t, by1 - by0 + t);
    ctx.fillRect(bx1, by0, t, by1 - by0 + t);
  };
  // the ties first, under both rails and kept clear of the corner joins so
  // no tie ever pokes through a rail's turn
  ctx.fillStyle = '#6e4f2f';
  for (let wx = Math.round(R.x0) + g + 6; wx <= R.x1 - g - 6; wx += 14) {
    const x = wx - ox;
    if (x < -3 || x > WV_W + 3) continue;
    if (y0 > -12 && y0 < WV_H + 12) ctx.fillRect(x, y0 - 1, 2, g + 3);
    if (y1 > -12 && y1 < WV_H + 12) ctx.fillRect(x, y1 - g - 1, 2, g + 3);
  }
  for (let wy = Math.round(R.y0) + g + 6; wy <= R.y1 - g - 6; wy += 14) {
    const y = wy - oy;
    if (y < -3 || y > WV_H + 3) continue;
    if (x0 > -12 && x0 < WV_W + 12) ctx.fillRect(x0 - 1, y, g + 3, 2);
    if (x1 > -12 && x1 < WV_W + 12) ctx.fillRect(x1 - g - 1, y, g + 3, 2);
  }
  // the two rails: outer on AG_RECT, inner AG_LANE_GAP inside it - each a
  // dark rim band with a light wood core, corners joining exactly
  for (const n of [0, g]) {
    band(x0 + n - 1, y0 + n - 1, x1 - n - 1, y1 - n - 1, 3, '#241a12');
    band(x0 + n, y0 + n, x1 - n, y1 - n, 1, '#8a6142');
  }
  // snow settled on the wood, keyed to world position so it never crawls
  ctx.fillStyle = '#f4f7ff';
  for (let wx = Math.round(R.x0); wx <= R.x1; wx += 5) {
    if (hash2(wx, 71) > 0.7) ctx.fillRect(wx - ox, y0, 1, 1);
    if (hash2(wx, 73) > 0.7) ctx.fillRect(wx - ox, y1, 1, 1);
  }
  for (let wy = Math.round(R.y0); wy <= R.y1; wy += 5) {
    if (hash2(75, wy) > 0.7) ctx.fillRect(x0, wy - oy, 1, 1);
    if (hash2(77, wy) > 0.7) ctx.fillRect(x1, wy - oy, 1, 1);
  }
}

// One target, whatever its habit: a rail CARRIAGE - plank body, two steel
// wheels gripping the rail along the rail's own axis (agEdge, js/world.js),
// wheels visibly turning while it rolls - then a mast sized to its face and
// planted in the body (or the hatch mouth a pop-up flips out of), then the
// face from its own baked sprite. The whole carriage lifts through a lane
// swap (the hop) and a hidden pop-up rattles on its rail for a beat before
// the face flips up. ptFace() (js/world.js) is the same geometry the arrow
// test reads, so what you see is exactly what a shot can hit.
function drawPTarget(t, ex, ey, now) {
  if (t.gone) return; // shot this very frame; the sweep collects it next tick
  const vert = agEdge(t.s) % 2 === 1; // side rails run vertically
  // the lane hop: the carriage lifts off its rail through a swap
  const hd = Math.abs(t.lane - t.laneU);
  const hop = hd > 0.01 ? Math.round(Math.sin(Math.PI * (1 - hd)) * 3) : 0;
  const gy = Math.round(t.y - ey);       // the rail line
  const bx = Math.round(t.x - ex), by = gy - hop;
  // the pre-rise rattle: a hidden pop-up shudders side to side on its rail
  let rx = 0;
  if (t.kind === 'pop' && t.up <= 0) {
    const C = t.pop || PT_POP;
    const u = t.t % (C.hide + C.rise + C.hold + C.sink);
    if (C.hide - u < 0.35) rx = Math.round(Math.sin(t.t * 42));
  }
  // shadow on the ground (never lifted - the hop reads against it)
  ctx.fillStyle = 'rgba(40,60,100,0.28)';
  ctx.fillRect(bx - 5, gy + 2, 11, 2);
  // the wheels, seated on the rail along its axis; spoke glints alternate
  // with track distance, so a rolling carriage's wheels visibly turn
  const wf = t.spd > 0 ? ((t.s / 5) | 0) % 2 : 0;
  const wheel = (wx, wy) => {
    ctx.fillStyle = '#241a12'; ctx.fillRect(wx, wy, 3, 3);
    ctx.fillStyle = '#3c4250'; ctx.fillRect(wx + 1, wy + 1, 1, 1);
    ctx.fillStyle = '#8b93a8';
    if (wf) { ctx.fillRect(wx + 1, wy, 1, 1); ctx.fillRect(wx + 1, wy + 2, 1, 1); }
    else { ctx.fillRect(wx, wy + 1, 1, 1); ctx.fillRect(wx + 2, wy + 1, 1, 1); }
  };
  if (vert) { wheel(bx - 1 + rx, by - 8); wheel(bx - 1 + rx, by - 1); }
  else { wheel(bx - 5 + rx, by - 1); wheel(bx + 2 + rx, by - 1); }
  // the plank body, over the wheels
  ctx.fillStyle = '#241a12'; ctx.fillRect(bx - 6 + rx, by - 6, 13, 5);
  ctx.fillStyle = '#6b4a30'; ctx.fillRect(bx - 5 + rx, by - 5, 11, 3);
  ctx.fillStyle = '#8a6142'; ctx.fillRect(bx - 5 + rx, by - 5, 11, 1);
  if (t.kind === 'pop') {
    // the mouth the face flips up out of
    ctx.fillStyle = '#1c1208'; ctx.fillRect(bx - 4 + rx, by - 5, 9, 2);
  } else {
    // the mast: sized to its face, planted in the body, overlapped by the
    // face bottom - face, mast, carriage and rail read as one built thing
    const pw = t.size ? 7 : 5;
    const px0 = bx - (pw >> 1) + rx;
    ctx.fillStyle = '#241a12'; ctx.fillRect(px0, by - 15, pw, 12);
    ctx.fillStyle = '#5c4226'; ctx.fillRect(px0 + 1, by - 14, pw - 2, 10);
    ctx.fillStyle = '#8a6142'; ctx.fillRect(px0 + 1, by - 14, 1, 10);
    if (t.broken > 0) { // the bare mast, splintered where the face was shot off
      ctx.fillStyle = '#a3794f';
      ctx.fillRect(px0, by - 17, 1, 2); ctx.fillRect(px0 + pw - 2, by - 18, 1, 3); ctx.fillRect(px0 + (pw >> 1), by - 16, 1, 1);
    }
  }
  if (t.broken > 0) return;
  // the face itself, from its own size's baked sprite (wob is the only
  // runtime scaling left - spawn/respawn bounce and the pop-up's lock-up)
  const spr = t.size ? TARGET_SPR : TARGET_SPR_S;
  const rise = t.kind === 'pop' ? Math.max(0, Math.min(1, t.up)) : 1;
  if (rise <= 0.02) return;
  const wobS = t.wob > 0 ? 1 + Math.sin(t.wob * 22) * 0.14 * (t.wob / 0.45) : 1;
  const w = Math.round(spr.width * wobS);
  const h = Math.max(1, Math.round(spr.height * rise * wobS));
  if (t.kind === 'pop') ctx.drawImage(spr, bx - (w >> 1) + rx, by - 5 - h, w, h);
  else ctx.drawImage(spr, bx - (w >> 1), Math.round(ptFace(t).y - ey) - hop - (h >> 1), w, h);
  // the stuck arrow, standing in the face for the beat before the shatter:
  // the shared body out of the impact point on the bearing it flew in on -
  // driven in past half its length, so only a stub of shaft and the team
  // feathers stand proud of the face
  if (t.stuck > 0 && rise > 0.5) {
    const f = ptFace(t);
    const ix = Math.round(f.x - ex) + Math.round(t.stickX);
    const iy = Math.round(f.y - ey) - hop + Math.round(t.stickY);
    const tm = TEAMS[t.stickTeam || 0];
    ARROW_PX.length = 0;
    arrowBodyPx(ARROW_PX, ix, iy, Math.cos(t.stickA), Math.sin(t.stickA),
      8, ARROW_LEN, tm.mark, tm.coatD, ARROW_INK.G, 0);
    paintArrowPx(ARROW_PX);
  }
}

// The hit-ring flash: one quick shock ring snapping out from every face
// break (agRings, js/world.js), sized to the face it came off. Rasterised
// 1px dots rather than an arc stroke, so the ring stays as crisp as the
// pixel grid; white-hot young, cooling to gold as it spreads and fades.
function drawAgRings(ex, ey) {
  for (const g of agRings) {
    const u = g.t / AG_RING_T;
    const r = 3 + (g.max - 3) * (1 - (1 - u) * (1 - u)); // eased out fast
    const cx = g.x - ex, cy = g.y - ey;
    if (cx < -20 || cy < -20 || cx > WV_W + 20 || cy > WV_H + 20) continue;
    // a dark rim pass under the lit pass - the outline-text rule: light
    // pixels on white snow are invisible without a dark edge to stand on
    ctx.globalAlpha = 1 - u;
    const n = Math.max(10, (r * 6) | 0);
    ctx.fillStyle = '#1c2130';
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r) + 1, 1, 1);
    }
    ctx.fillStyle = u < 0.45 ? '#f4f7ff' : '#ffd95c';
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

// ---- the range bell's pixels ---------------------------------------------
// The bell that runs the archery round: a bronze bell hung in a two-post
// frame west of the dummy, rope off the clapper. While o.ring runs (the press
// just landed, js/world.js) the bell swings on its yoke - the whole "the
// round heard you" announcement at the spot the press happened.
function drawAgBell(o, px, py, now) {
  ctx.fillStyle = 'rgba(40,60,100,0.25)'; ctx.fillRect(px + 2, py + 14, 12, 2);
  // the frame: two posts into a crossbar, snow on top
  ctx.fillStyle = '#241a12';
  ctx.fillRect(px, py - 8, 3, 24); ctx.fillRect(px + 13, py - 8, 3, 24);
  ctx.fillRect(px - 1, py - 11, 18, 4);
  ctx.fillStyle = '#5c4226';
  ctx.fillRect(px + 1, py - 7, 1, 22); ctx.fillRect(px + 14, py - 7, 1, 22);
  ctx.fillRect(px, py - 10, 16, 2);
  ctx.fillStyle = '#8a6142'; ctx.fillRect(px, py - 10, 16, 1);
  ctx.fillStyle = '#f4f7ff';
  ctx.fillRect(px - 1, py - 12, 6, 1); ctx.fillRect(px + 9, py - 12, 7, 1);
  // the bell on its yoke, swinging while the ring runs down
  const sw = o.ring > 0 ? Math.round(Math.sin(now * 21) * 2.5 * o.ring) : 0;
  const bxx = px + 5 + sw;
  ctx.fillStyle = '#241a12'; ctx.fillRect(px + 7, py - 8, 2, 2); // the hanger
  ctx.fillStyle = '#1c1208'; ctx.fillRect(bxx - 1, py - 7, 8, 8);
  ctx.fillStyle = '#c89a3c'; ctx.fillRect(bxx, py - 6, 6, 6);
  ctx.fillStyle = '#ffe9a0'; ctx.fillRect(bxx + 1, py - 6, 1, 5);
  ctx.fillStyle = '#8a6a28'; ctx.fillRect(bxx + 4, py - 5, 1, 5);
  ctx.fillStyle = '#1c1208'; ctx.fillRect(bxx - 2, py - 1, 10, 2);   // the lip
  ctx.fillStyle = '#c89a3c'; ctx.fillRect(bxx - 1, py - 1, 8, 1);
  ctx.fillStyle = '#241a12'; ctx.fillRect(bxx + 2 + (sw >> 1), py + 1, 2, 2); // the clapper
}

// The range's standing readout: BEST / LAST round score on a frost plate
// over the bell - the parkour gate plate's instrument language, the same
// recorded labelled-row carve-out (CLAUDE.md). Hidden mid-round, when the
// live top-centre plate (drawAgameUI) carries the numbers instead.
function drawAgame(ex, ey, now) {
  if (!agame.best && !agame.last) return;
  if (agame.phase !== 'off' && agame.phase !== 'end') return;
  // high enough that the E RING cap (drawBellHint, -30) never rides into it
  const x0 = Math.round((AG_BELL.tx + 0.5) * TILE - ex), y0 = Math.round(AG_BELL.ty * TILE - ey - 38);
  if (x0 < -40 || y0 < -30 || x0 > WV_W + 40 || y0 > WV_H + 30) return;
  const rows = [
    ['BEST', agame.best ? String(agame.best) : '-', '#ffd95c'],
    ['LAST', agame.last ? String(agame.last) : '-', '#f4f7ff'],
  ];
  const W = 46, H = 18;
  const x = x0 - (W >> 1), y = y0 - H;
  ctx.fillStyle = 'rgba(12,18,42,0.85)';
  ctx.fillRect(x - 1, y - 1, W + 2, H + 2);
  ctx.fillStyle = '#3a4470';
  ctx.fillRect(x, y, W, 1); ctx.fillRect(x, y + H - 1, W, 1);
  ctx.fillRect(x, y, 1, H); ctx.fillRect(x + W - 1, y, 1, H);
  for (let i = 0; i < 2; i++) {
    const ry = y + 3 + i * 7;
    drawPixelTextShadow(ctx, rows[i][0], x + 3, ry, '#9fb6d8', 'rgba(8,12,28,0.9)');
    const v = rows[i][1];
    drawPixelTextShadow(ctx, v, x + W - 3 - pixelTextWidth(v), ry, rows[i][2], 'rgba(8,12,28,0.9)');
  }
}

// The round's live layer, drawn in UI space (render.js, after renderUI): the
// 3-2-1 countdown in the eagle drop's own big-number language, GO as the
// window opens, the TIME / SCORE / HITS plate top-centre while the clock
// runs (a practice instrument's whole job is comparing numbers - the same
// carve-out the dummy meter claims), and the final score standing large
// while the field resets - gold when it is a new record.
function drawAgameUI(now) {
  if (window.DBG.hideUI) return;
  const G = agame;
  if (G.phase === 'off' || G.phase === 'sink') return;
  const cxm = Math.round(VIEW_W / 2);
  if (G.phase === 'count') {
    const left = AG_COUNT_T - G.t;
    const s = String(Math.max(1, Math.ceil(left)));
    const frac = left - Math.floor(left); // each second lands with a fade
    ctx.globalAlpha = 0.45 + 0.55 * frac;
    drawPixelTextOutline(ctx, s, Math.round(cxm - pixelTextWidth(s, 4) / 2),
      Math.round(VIEW_H * 0.3), '#ffd95c', '#0f1632', 4);
    ctx.globalAlpha = 1;
    return;
  }
  if (G.phase === 'play') {
    if (G.t < 0.6) { // GO flashes as the window opens
      ctx.globalAlpha = Math.min(1, (0.6 - G.t) / 0.25);
      drawPixelTextOutline(ctx, 'GO', Math.round(cxm - pixelTextWidth('GO', 4) / 2),
        Math.round(VIEW_H * 0.3), '#7ddb7a', '#0f1632', 4);
      ctx.globalAlpha = 1;
    }
    const left = Math.max(0, AG_T - G.t);
    const rows = [
      ['TIME',  left.toFixed(1),  left < 5.05 ? '#ff6a5a' : '#ffd95c'],
      ['SCORE', String(G.score),  '#f4f7ff'],
      ['HITS',  String(G.hits),   '#e0c890'],
    ];
    const W = 62, H = 25;
    const x = cxm - (W >> 1), y = 8;
    ctx.fillStyle = 'rgba(12,18,42,0.85)';
    ctx.fillRect(x - 1, y - 1, W + 2, H + 2);
    ctx.fillStyle = '#3a4470';
    ctx.fillRect(x, y, W, 1); ctx.fillRect(x, y + H - 1, W, 1);
    ctx.fillRect(x, y, 1, H); ctx.fillRect(x + W - 1, y, 1, H);
    for (let i = 0; i < 3; i++) {
      const ry = y + 3 + i * 7;
      drawPixelTextShadow(ctx, rows[i][0], x + 3, ry, '#9fb6d8', 'rgba(8,12,28,0.9)');
      const v = rows[i][1];
      drawPixelTextShadow(ctx, v, x + W - 3 - pixelTextWidth(v), ry, rows[i][2], 'rgba(8,12,28,0.9)');
    }
    return;
  }
  // 'end': the final score stands while the furniture rises back
  const col = G.record ? '#ffd95c' : '#f4f7ff';
  const s = String(G.last);
  drawPixelTextOutline(ctx, 'SCORE', Math.round(cxm - pixelTextWidth('SCORE') / 2),
    Math.round(VIEW_H * 0.28), '#9fb6d8', '#0f1632');
  if (G.record) ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now * 7);
  drawPixelTextOutline(ctx, s, Math.round(cxm - pixelTextWidth(s, 3) / 2),
    Math.round(VIEW_H * 0.28) + 9, col, '#0f1632', 3);
  ctx.globalAlpha = 1;
  const hs = G.lastHits + ' HITS';
  drawPixelTextOutline(ctx, hs, Math.round(cxm - pixelTextWidth(hs) / 2),
    Math.round(VIEW_H * 0.28) + 28, '#e0c890', '#0f1632');
}

// A flag: dark pole with a gilt finial, and a big red cloth streaming off it
// on the frame clock - the parkour gate's marker, in the target rings' own
// red. The cloth is a full rectangle (18 wide, 11 deep) with a swallowtail
// cut at the fly end, waving column by column with folds shaded where the
// wave crests, so it reads as heavy cloth rather than a pennant.
function drawBanner(o, px, py, now) {
  const bx = px + 4, top = py - 18;
  ctx.fillStyle = 'rgba(40,60,100,0.25)'; ctx.fillRect(bx - 1, py + 14, 6, 2);
  // the pole, snow at its foot
  ctx.fillStyle = '#241a12'; ctx.fillRect(bx - 1, top - 2, 4, 36);
  ctx.fillStyle = '#5c4226'; ctx.fillRect(bx, top - 1, 2, 34);
  ctx.fillStyle = '#8a6142'; ctx.fillRect(bx, top - 1, 1, 34);
  ctx.fillStyle = '#f4f7ff'; ctx.fillRect(bx - 1, py + 12, 4, 2);
  // the finial: a gilt ball on a collar
  ctx.fillStyle = '#241a12'; ctx.fillRect(bx - 1, top - 5, 4, 3);
  ctx.fillStyle = '#ffd95c'; ctx.fillRect(bx, top - 5, 2, 2);
  ctx.fillStyle = '#fff3c4'; ctx.fillRect(bx, top - 5, 1, 1);
  // the cloth, hung from the pole top, waving toward the fly
  const W = 18, H = 11;
  for (let i = 0; i < W; i++) {
    const u = i / (W - 1);
    const wave = Math.sin(now * 4.5 + i * 0.55 + o.ty) * u * 2.6;
    const y0 = top + Math.round(wave);
    // the swallowtail: the last few columns lose their middle rows
    const notch = Math.max(0, i - (W - 5));
    const gap = notch > 0 ? Math.min(H - 4, notch * 2) : 0;
    const x = bx + 3 + i;
    // fold shading rides the wave's slope: leaning columns catch the dark
    const slope = Math.cos(now * 4.5 + i * 0.55 + o.ty) * u;
    const cloth = slope < -0.35 ? '#a83232' : slope > 0.45 ? '#d0453a' : '#c0392b';
    if (gap === 0) {
      ctx.fillStyle = '#241a12'; ctx.fillRect(x, y0 - 1, 1, H + 2);
      ctx.fillStyle = cloth; ctx.fillRect(x, y0, 1, H);
      ctx.fillStyle = '#e05548'; ctx.fillRect(x, y0, 1, 1); // the lit top hem
      if (i === 0 || i === 7) { ctx.fillStyle = '#8f2a24'; ctx.fillRect(x, y0 + 1, 1, H - 1); } // seam shadows
    } else {
      const arm = ((H - gap) >> 1) + 1;
      ctx.fillStyle = '#241a12'; ctx.fillRect(x, y0 - 1, 1, arm + 1); ctx.fillRect(x, y0 + H - arm, 1, arm + 1);
      ctx.fillStyle = cloth; ctx.fillRect(x, y0, 1, arm); ctx.fillRect(x, y0 + H - arm, 1, arm);
      ctx.fillStyle = '#e05548'; ctx.fillRect(x, y0, 1, 1);
    }
  }
  ctx.fillStyle = '#ffd95c'; ctx.fillRect(bx + 2, top, 1, H); // the gilt hoist stripe
  ctx.fillStyle = '#c89a3c'; ctx.fillRect(bx + 2, top + H - 2, 1, 2);
}

// ---- the arrow body, shared -----------------------------------------------
// One silhouette for every shaft in the game: the flying arrow (render.js),
// the spent shaft below, the arrow standing in a target face (drawPTarget)
// and the volley's rain (abilities.js) all rasterise ARROW_BODY (js/actions.js)
// through this pair. hx/hy is the tip's exact (unrounded) screen position,
// i0..i1 the stretch of the body to draw (a buried head is skipped by raising
// i0), cT/cD the team feather and its dark edge, cB the bit collar, cG an
// optional shaft override (0 = the master's gold).
// DDA RASTERISATION, not per-pixel rounding: the spine advances exactly one
// pixel along the flight's dominant axis per step, so a diagonal shaft is a
// clean 8-connected staircase - no doubled cells, no gaps (rounding each
// column independently crammed 16 columns into ~11 cells at 45 deg and
// doubled four of them) - and each body column is sampled onto that chain
// (on a collision the structural pixel wins, because ARROW_BODY is
// priority-sorted at parse). The vane rows get the same treatment along the
// perpendicular, one exact pixel per row on ITS dominant axis, so no two
// rows ever collapse onto each other (plain rounding folded rows 1 and 2
// onto the same diagonal offset) and the two vanes stay mirrored at every
// bearing. At the four cardinals all of this degenerates to plain rounding,
// so straight shots are pixel-identical to the old spine-offset draw.
function arrowBodyPx(out, hx, hy, nx, ny, i0, i1, cT, cD, cB, cG) {
  const ax = nx < 0 ? -nx : nx, ay = ny < 0 ? -ny : ny, domX = ax >= ay;
  const maxA = domX ? ax : ay;
  const sx = nx < 0 ? -1 : 1, sy = ny < 0 ? -1 : 1;
  const X0 = Math.round(hx), Y0 = Math.round(hy);
  const qxs = -ny < 0 ? -1 : 1, qys = nx < 0 ? -1 : 1; // signs of the perpendicular (-ny, nx)
  for (let k = 0; k < ARROW_BODY.length; k += 3) {
    const i = ARROW_BODY[k];
    if (i < i0 || i > i1) continue;
    const j = ARROW_BODY[k + 1], key = ARROW_BODY[k + 2];
    const s = Math.round(i * maxA);
    let px, py, ox, oy;
    if (domX) { px = X0 - sx * s; py = Math.round(hy - ny * (s / ax)); }
    else      { py = Y0 - sy * s; px = Math.round(hx - nx * (s / ay)); }
    const aj = j < 0 ? -j : j, js = j < 0 ? -1 : 1;
    if (domX) { oy = js * qys * aj; ox = js * qxs * Math.round(aj * ay / ax); }
    else      { ox = js * qxs * aj; oy = js * qys * Math.round(aj * ax / ay); }
    out.push(px + ox, py + oy,
      key === 'T' ? cT : key === 'D' ? cD : key === 'B' ? cB :
      key === 'G' ? (cG || ARROW_INK.G) : ARROW_INK[key]);
  }
}
// rim first - a plus-shaped dilation of every pixel, so the whole body wears
// a 1px dark edge whatever direction it lies - then the colours over it
function paintArrowPx(px) {
  ctx.fillStyle = ARROW_RIM;
  for (let k = 0; k < px.length; k += 3) {
    const x = px[k], y = px[k + 1];
    ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1);
    ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1);
  }
  for (let k = 0; k < px.length; k += 3) {
    ctx.fillStyle = px[k + 2];
    ctx.fillRect(px[k], px[k + 1], 1, 1);
  }
}

// Spent arrows in the snow, drawn flat under everything that walks: the shared
// body from SHAFT_BURY back - head and bit collar under the snow - lying on
// the bearing it came in on, centred on s.x/s.y (stickArrow pulls the stored
// point back to the visible middle, so the pickup circle and the drawing agree).
// Inside SHAFT_NEAR of a local player who has room for it, the whole thing
// goes gold and grows a bobbing arrowhead: that, and nothing written down, is
// how "walk over it to take it back" gets taught. It blinks over its last
// second and a half so nobody plans a route to one that is about to go.
function drawShafts(ex, ey, now) {
  const want = state.mode === 'play' && !player.dead && !inAir(player) && player.quiver < QUIVER_MAX;
  for (const s of shafts) {
    const sx = Math.round(s.x - ex), sy = Math.round(s.y - ey);
    if (sx < -18 || sy < -18 || sx > WV_W + 18 || sy > WV_H + 18) continue;
    const left = SHAFT_LIFE - s.t;
    if (left < 1.6 && ((now * 7) | 0) % 2) continue;
    const fade = Math.min(1, left / 4);
    const near = want && Math.hypot(s.x - player.x, s.y - player.y) < SHAFT_NEAR;
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(120,140,175,0.32)';
    ctx.fillRect(sx - 4, sy + 2, 9, 1);
    // in range the whole thing goes gold - the colour this HUD already uses for
    // "you can take this" (the gear row's buy chevron, every hover). White was
    // tried and vanished into the snow.
    ARROW_PX.length = 0;
    arrowBodyPx(ARROW_PX, s.x - ex + s.nx * SHAFT_MID, s.y - ey + s.ny * SHAFT_MID,
      s.nx, s.ny, SHAFT_BURY, ARROW_LEN,
      near ? '#fff3c4' : TEAMS[s.team].mark,
      near ? '#ffd95c' : TEAMS[s.team].coatD,
      ARROW_INK.G, near ? '#ffd95c' : 0);
    paintArrowPx(ARROW_PX);
    if (near) {
      // a small arrowhead bobbing over it - the same wedge a flying arrow wears
      const by = sy - 11 - Math.round(Math.abs(Math.sin(now * 4)) * 2);
      for (let r = 0; r < 3; r++) {
        const w = r * 2 + 1;
        ctx.fillStyle = '#0a0e23';
        ctx.fillRect(sx - r + 1, by + r + 1, w, 1);
        ctx.fillStyle = '#ffd95c';
        ctx.fillRect(sx - r, by + r, w, 1);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 1;
}

// small overhead bar shared by every living unit; color shifts as hp drains
function drawHealthBar(cxp, topY, hp, maxHp, w) {
  const x = Math.round(cxp - w / 2), y = Math.round(topY);
  const frac = Math.max(0, Math.min(1, hp / maxHp));
  ctx.fillStyle = 'rgba(12,18,42,0.78)';
  ctx.fillRect(x - 1, y - 1, w + 2, 4);
  ctx.fillStyle = '#3a3448';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = frac > 0.55 ? '#7ce87a' : frac > 0.25 ? '#f2cc6a' : '#ff6a5a';
  ctx.fillRect(x, y, Math.max(1, Math.round(w * frac)), 2);
}

// Seeing stars. Three sparks on an orbit, phased off the unit's own stun
// timer so the ring keeps turning without a global clock and two stunned
// units are never in lockstep; the far half of the orbit dims, which is what
// sells it as a ring rather than three blinking dots. This is the whole
// vocabulary for the state - squashed and wide over an animal's head, round
// and tight inside the badge on a player's frame - so it reads the same
// wherever it turns up.
function drawStunStars(cx, cy, e, r, squash) {
  const a0 = -(e.stunT || 0) * 9, sq = squash === undefined ? 0.5 : squash;
  for (let i = 0; i < 3; i++) {
    const a = a0 + i * Math.PI * 2 / 3;
    ctx.fillStyle = Math.sin(a) > 0 ? '#ffb641' : '#fff3c4'; // the near half is the bright one
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * sq), 1, 1);
  }
}

// A big build's reveal: the first 12% of the timer is the staked foundation
// alone, then the sprite rises bottom-up. Shared by the draw pass (the clip)
// and updateStructures (sparks along the edge), so the two can't disagree.
function bigBuildReveal(o) {
  const spr = structSprite(o), h = spr.height;
  const p = o.buildT / o.buildTotal;
  const rows = p < 0.12 ? 0 : Math.min(h, Math.max(1, Math.round(h * (p - 0.12) / 0.86)));
  return { rows, h, edgeY: (o.ty + structH(o.type)) * TILE - rows };
}

// Everything the bay animates or reports, drawn over the baked sprite. Bay
// geometry is the sprite's: doorway cols 14-33, rows 13-35, floor row 36;
// the right flank's plain plate rows 23-29 carry the readouts.
//   roll-out - the next bot slides down the doorway over the last 0.8 s of its
//              timer, so the real one appears at the mouth mid-motion
//   shutter  - rolls down over the doorway as o.door -> 0 (guard mode)
//   pips     - one per bot slot: lit = alive, blinking = being built, dark = empty
//   bar      - the roll-out timer, under the pips
//   vents    - a slat flickers across each grille
//   beacon   - roof corner, amber blink while a bot is due, grey otherwise
//   hp       - a bar over the roof, only once damaged
// ---- the turret's rotating half -------------------------------------------
// The grid stops at the collar; the housing and barrel are rasterised pixel by
// pixel at the live angle and dilated into a 1px dark rim - the same trick the
// arrows use - so the gun stays crisp and readable at any bearing over snow.
const TUR_METAL = [
  { d: '#6b4a30', m: '#8a6142', l: '#a3794f' }, // tier 1: iron-banded timber
  { d: '#666d84', m: '#8b93a8', l: '#a8b0c4' }, // tier 2: stone grey
  { d: '#b9884f', m: '#d8a850', l: '#f2cc6a' }, // tier 3: gilt
];
const TUR_RIM = '#0d1226';
// shared by the head and its bolts: plus-dilate the pixel map into a dark rim,
// paint the rim, then the body over it
function paintRimmed(body) {
  const rim = new Set();
  for (const k of body.keys()) {
    const i = k.indexOf(','), x = +k.slice(0, i), y = +k.slice(i + 1);
    const n = [(x - 1) + ',' + y, (x + 1) + ',' + y, x + ',' + (y - 1), x + ',' + (y + 1)];
    for (const q of n) if (!body.has(q)) rim.add(q);
  }
  ctx.fillStyle = TUR_RIM;
  for (const k of rim) { const i = k.indexOf(','); ctx.fillRect(+k.slice(0, i), +k.slice(i + 1), 1, 1); }
  for (const [k, col] of body) { const i = k.indexOf(','); ctx.fillStyle = col; ctx.fillRect(+k.slice(0, i), +k.slice(i + 1), 1, 1); }
}
function drawTurretHead(o, cx, cy) {
  const ang = o.ang || 0, ca = Math.cos(ang), sa = Math.sin(ang);
  const tm = TEAMS[o.team === undefined ? 0 : o.team];
  const M = TUR_METAL[Math.min(TUR_METAL.length - 1, o.tier)];
  const rec = -(o.rec || 0) * 3;   // recoil slides the barrel back through the mantlet
  const chg = o.chg || 0;
  const body = new Map();
  // f runs along the barrel, sd across it; every point rotates about the pivot.
  // Later writes win, so this paints back-to-front: casemate, then the plate the
  // barrel comes through, then the barrel itself.
  const put = (f, sd, c) => {
    body.set(Math.round(cx + f * ca - sd * sa) + ',' + Math.round(cy + f * sa + sd * ca), c);
  };
  // casemate: a rounded armour shell, lit from the top like the rest of the art
  for (let f = -5; f <= 4; f++) for (let sd = -4; sd <= 4; sd++) {
    if (((f + 0.5) * (f + 0.5)) / 26 + (sd * sd) / 18 > 1) continue;
    put(f, sd, sd <= -3 ? tm.coatL : sd >= 3 ? tm.coatD : tm.coat);
  }
  for (let f = -4; f <= 1; f++) put(f, -3, tm.trim);                    // hull highlight
  for (const rv of [[-3, -1], [-3, 1], [0, -2], [0, 2]]) put(rv[0], rv[1], tm.coatD); // rivets
  // vision slit: team colour at rest, hot white the instant the shot is ready
  const eye = chg > 0.99 ? '#ffffff' : chg > 0.45 ? tm.glow : tm.mark;
  for (let f = -3; f <= 0; f++) put(f, -2, eye);
  for (let f = -6; f <= -5; f++) for (let sd = -2; sd <= 2; sd++) put(f, sd, M.d); // breech block
  for (let f = 2; f <= 5; f++) for (let sd = -3; sd <= 3; sd++) {       // mantlet plate
    put(f, sd, sd <= -2 ? M.l : sd >= 2 ? M.d : M.m);
  }
  // barrel: light top edge, dark underside, so it reads as round at any bearing
  for (let f = 5; f <= 16; f++) for (let sd = -2; sd <= 2; sd++) {
    put(f + rec, sd, sd === -2 ? M.l : sd === 2 ? M.d : M.m);
  }
  for (let f = 13; f <= 16; f++) for (let sd = -3; sd <= 3; sd++) {     // muzzle brake
    put(f + rec, sd, sd <= -2 ? M.l : sd >= 2 ? M.d : M.m);
  }
  put(14 + rec, -3, M.d); put(14 + rec, 3, M.d);                        // brake slots
  for (let sd = -1; sd <= 1; sd++) put(16 + rec, sd, '#131a2e');        // the bore, looking down it
  paintRimmed(body);
}
// a turret bolt: a stubby bright slug with a halo, deliberately nothing like an arrow
function drawBolt(a, ex, ey) {
  const vd = Math.hypot(a.vx, a.vy) || 1;
  const nx = a.vx / vd, ny = a.vy / vd, qx = -ny, qy = nx;
  const hx = Math.round(a.x - ex), hy = Math.round(a.y - ey);
  if (hx < -16 || hx > WV_W + 16 || hy < -16 || hy > WV_H + 16) return;
  const tm = TEAMS[a.team];
  ctx.globalAlpha = 0.28;                       // soft halo under the rim
  ctx.fillStyle = tm.mark;
  ctx.fillRect(hx - 3, hy, 7, 1); ctx.fillRect(hx, hy - 3, 1, 7);
  ctx.globalAlpha = 1;
  const body = new Map();
  const put = (i, j, c) => {
    body.set(Math.round(hx - nx * i + qx * j) + ',' + Math.round(hy - ny * i + qy * j), c);
  };
  put(4, 0, tm.coatD); put(3, 0, tm.mark); put(2, 0, tm.mark);
  put(1, -1, tm.mark); put(1, 1, tm.mark);
  put(1, 0, '#ffffff'); put(0, 0, '#ffffff');   // hot core at the nose
  paintRimmed(body);
}
// aim line and muzzle flash, over the world so they read against the mount
function drawTurretFx(ex, ey, now) {
  for (const o of structures) {
    if (o.type !== 'turret' || o.building) continue;
    const tm = TEAMS[o.team === undefined ? 0 : o.team];
    const m = turretMuzzle(o);
    const mx = Math.round(m.x - ex), my = Math.round(m.y - ey);
    if (mx < -90 || my < -90 || mx > WV_W + 90 || my > WV_H + 90) continue;
    if (o.tgt && o.chg > 0.02) {
      // a dashed line crawling out to the mark, brightening and tightening as it locks
      const tx = o.tgt.x - ex, ty = turretAimY(o.tgt) - ey;
      const dx = tx - mx, dy = ty - my, d = Math.hypot(dx, dy) || 1;
      const nx = dx / d, ny = dy / d;
      const hot = o.chg > 0.99;
      ctx.globalAlpha = 0.25 + 0.6 * o.chg;
      for (let q = (now * 30) % 6; q < d - 2; q += 6) {
        for (let k = 0; k < 3 && q + k < d - 2; k++) {
          const x = Math.round(mx + nx * (q + k)), y = Math.round(my + ny * (q + k));
          ctx.fillStyle = TUR_RIM; ctx.fillRect(x, y + 1, 1, 1);   // shadow, so it reads on snow
          ctx.fillStyle = hot ? '#ffffff' : tm.mark; ctx.fillRect(x, y, 1, 1);
        }
      }
      const r = Math.round(8 - 4 * o.chg), rx = Math.round(tx), ry = Math.round(ty);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? (hot ? '#ffffff' : tm.mark) : TUR_RIM;
        const oy2 = pass ? 0 : 1;
        for (const c2 of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          ctx.fillRect(rx + c2[0] * r, ry + c2[1] * r + oy2, c2[0] * 2, 1);
          ctx.fillRect(rx + c2[0] * r, ry + c2[1] * r + oy2, 1, c2[1] * 2);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (o.mz > 0) {
      // the shot: a four-point star at the barrel tip for a couple of frames
      const a2 = o.mz / TUR_MZ, L = Math.round(3 + 5 * a2), h = Math.max(1, L >> 1);
      ctx.globalAlpha = Math.min(1, a2);
      ctx.fillStyle = tm.mark;
      ctx.fillRect(mx - L, my, L * 2 + 1, 1);
      ctx.fillRect(mx, my - L, 1, L * 2 + 1);
      for (let k = 1; k <= h; k++) {
        ctx.fillRect(mx - k, my - k, 1, 1); ctx.fillRect(mx + k, my - k, 1, 1);
        ctx.fillRect(mx - k, my + k, 1, 1); ctx.fillRect(mx + k, my + k, 1, 1);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mx - 1, my - 1, 3, 3);
      ctx.globalAlpha = 1;
    }
  }
}

function drawBayOverlay(o, px, sy, now) {
  const t = STRUCTS.spawner.tiers[o.tier];
  const due = o.bots.length < t.bots;
  if (due && o.respawnT <= 0.8) {
    const set = SPRITES.robotTeam[o.team === undefined ? 0 : o.team] || SPRITES.robot;
    const spr = set[Math.floor(now * 8) % 2];
    const k = 1 - o.respawnT / 0.8;
    ctx.save();
    ctx.beginPath(); ctx.rect(px + 14, sy + 13, 20, 24); ctx.clip();
    ctx.drawImage(spr, px + 18, sy + 26 - Math.round(12 * (1 - k)));
    ctx.restore();
  }
  const shut = Math.round(23 * (1 - o.door));
  for (let i = 0; i < shut; i++) {
    ctx.fillStyle = i === shut - 1 ? '#1c2130' : (i % 3 === 2 ? '#5b6473' : '#98a1b0');
    ctx.fillRect(px + 14, sy + 13 + i, 20, 1);
  }
  // readouts on the right flank
  ctx.fillStyle = '#1c2130'; ctx.fillRect(px + 35, sy + 23, 10, 9);
  for (let i = 0; i < t.bots; i++) {
    let c = '#3b4150';
    if (i < o.bots.length) c = '#9ce87a';
    else if (i === o.bots.length && due) c = Math.floor(now * 3) % 2 ? '#ffd95c' : '#6b5a1c';
    ctx.fillStyle = c; ctx.fillRect(px + 36 + i * 3, sy + 24, 2, 2);
  }
  ctx.fillStyle = '#3b4150'; ctx.fillRect(px + 36, sy + 28, 8, 2);
  if (due) {
    ctx.fillStyle = '#ffd95c';
    ctx.fillRect(px + 36, sy + 28, Math.max(1, Math.round(8 * (1 - o.respawnT / (o.respawnTotal || 1)))), 2);
  }
  // vent slat flicker
  const slat = sy + 17 + (Math.floor(now * 5) % 3) * 2;
  ctx.fillStyle = '#6c7486';
  ctx.fillRect(px + 5, slat, 6, 1); ctx.fillRect(px + 37, slat, 6, 1);
  // beacon on the roof corner
  ctx.fillStyle = '#1c2130'; ctx.fillRect(px + 44, sy - 4, 2, 5); ctx.fillRect(px + 42, sy - 7, 6, 4);
  ctx.fillStyle = due ? (Math.floor(now * 4) % 2 ? '#ff9a3c' : '#7a3a1c') : '#6c7486';
  ctx.fillRect(px + 43, sy - 6, 4, 2);
  if (o.hp < o.maxHp) drawHealthBar(px + 24, sy - 11, o.hp, o.maxHp, 24);
}

// The fish net, drawn flat on its hole in the pass right after the ground
// instead of y-sorted with the buildings that stand up out of it - a player
// walks OVER this one, so it must never sort in front of them. An unfinished
// net is rope still being paid out into the water (no scaffold: there is
// nothing out there to stand a frame on), and the catch shows through the
// mesh, which is the only thing that says a net is worth walking to.
function drawNet(o, px, py, now) {
  const spr = structSprite(o);
  const sh = o.shake > 0 ? Math.round(Math.sin(o.shake * 55) * 1.4) : 0;
  if (o.building) {
    ctx.globalAlpha = 0.3 + 0.55 * Math.min(1, o.buildT / o.buildTotal);
    ctx.drawImage(spr, px + sh, py);
    ctx.globalAlpha = 1;
    return;
  }
  drawSpriteFlash(spr, px + sh, py, o.flash);
  // the catch: up to NET_CAP fish lying in the mesh, each on its own bob
  for (let i = 0; i < o.fish; i++) {
    const fx = px + sh + NET_FISH_AT[i][0], fy = py + NET_FISH_AT[i][1] + (Math.floor(now * 3 + i) % 2);
    ctx.fillStyle = '#7fa9c6';
    ctx.fillRect(fx, fy, 5, 2);
    ctx.fillRect(fx + 5, fy - 1, 1, 1); ctx.fillRect(fx + 5, fy + 2, 1, 1); // tail fork
    ctx.fillStyle = '#c9dded'; ctx.fillRect(fx + 1, fy + 1, 2, 1);
    ctx.fillStyle = '#101d2c'; ctx.fillRect(fx + 1, fy, 1, 1);
  }
  if (o.hp < o.maxHp) drawHealthBar(px + sh + 8, py - 5, o.hp, o.maxHp, 12); // + sh: rides the shudder, like every other building bar
}
const NET_FISH_AT = [[3, 4], [8, 8], [4, 11]]; // where a held fish lies in the mesh

// a building wears its owner's team palette over its tier material
function structSprite(o) {
  const set = SPRITES.teamBuild[o.team === undefined ? 0 : o.team];
  return set ? set[o.type][o.tier] : SPRITES[o.type][o.tier];
}

function drawAnimal(a, ex, ey, now) {
  if (a.kind === 'bird') { drawBird(a, ex, ey, now); return; }
  const rabbit = a.kind === 'rabbit';
  const wolf = a.kind === 'wolf';
  const set = SPRITES[a.kind][a.dir];
  const frame = a.moving ? 1 + (Math.floor(a.animT) % 2) : 0;
  const spr = set[frame];
  const px = Math.round(a.x - spr.width / 2 - ex);
  const py = Math.round(a.y + 4 - spr.height - ey);
  const sw = rabbit ? 4 : wolf ? 6 : 7;
  ctx.fillStyle = 'rgba(110,130,170,0.35)';
  ctx.fillRect(Math.round(a.x - ex) - sw, Math.round(a.y + 2 - ey), sw * 2, 2);
  drawSpriteFlash(spr, px, py, a.flash);
  // netted, snared, alight, marked: the same four tells a player wears, at
  // this body's size (drawUnitStates, js/abilities.js)
  drawUnitStates(a, px, py, spr.width, spr.height, now);
  drawHealthBar(a.x - ex, py - (rabbit ? 4 : 5), a.hp, a.maxHp, rabbit ? 8 : wolf ? 12 : 16);
  if (a.stunT > 0) drawStunStars(Math.round(a.x - ex), py - (rabbit ? 9 : 10), a, 4);
}

// The only thing in the world that leaves the ground: the sprite lifts off
// its own shadow by a.alt, which is the whole read on how high a bird is.
// No health bar - three hp means every hit is a kill, and a bar over
// something this small is all bar.
function drawBird(a, ex, ey, now) {
  const flying = a.flyT > 0;
  const spr = SPRITES.bird[a.dir][flying ? 1 + (Math.floor(a.animT) % 2) : 0];
  const px = Math.round(a.x - spr.width / 2 - ex);
  const py = Math.round(a.y - a.alt - spr.height - ey);
  ctx.fillStyle = flying ? 'rgba(110,130,170,0.22)' : 'rgba(110,130,170,0.3)';
  ctx.fillRect(Math.round(a.x - ex) - 2, Math.round(a.y + 1 - ey), 4, 1);
  drawSpriteFlash(spr, px, py, a.flash);
  drawUnitStates(a, px, py, spr.width, spr.height, now); // a burning bird still reads as one
}

// Worker bot: one sprite, two tread frames. The whole thing bobs 1px while
// driving so body and tread never part. No face - the states are the tread
// rolling, the tool swinging at a target, and the gold held up front.
function drawRobot(b, ex, ey, now) {
  const set = SPRITES.robotTeam[b.team === undefined ? 0 : b.team] || SPRITES.robot;
  const spr = set[b.moving ? Math.floor(b.animT) % 2 : 0];
  const bob = b.moving ? Math.floor(b.animT / 2) % 2 : 0;
  const bx = Math.round(b.x - 6 - ex);
  const by = Math.round(b.y + 4 - ey) - spr.height - bob; // tread bottom sits at b.y + 4

  ctx.fillStyle = 'rgba(110,130,170,0.35)';
  ctx.fillRect(bx + 1, Math.round(b.y + 3 - ey), 10, 2);

  // one swing animation, two jobs: the harvest tick, or - on an attack flag -
  // the same axe aimed at whatever b.atkAim points to (`worker flags`, robots.js)
  let tdx = 0, tdy = 0, working = false, icon = null, prog = 0;
  if (b.atkAim) {
    tdx = b.atkAim.x - b.x; tdy = b.atkAim.y - b.y;
    working = true;
    icon = SPRITES.itemAxe;
    prog = 1 - b.atkCd / ROBOT_ATK_CD;
  } else if (b.tgt && !b.moving) {
    tdx = b.tgt.tx * TILE + 8 - b.x; tdy = b.tgt.ty * TILE + 8 - b.y;
    working = Math.hypot(tdx, tdy) <= 20;
    icon = SPRITES[b.tgt.type === 'rock' ? 'itemPick' : 'itemAxe'];
    prog = Math.min(1, b.workT / 0.9);
  }

  drawSpriteFlash(spr, bx, by, b.flash);

  // carried gold: a nugget held up in front of the body
  if (b.carry > 0 && !working) {
    const gx = bx + 3, gy = by + 2;
    ctx.fillStyle = '#1c2130'; ctx.fillRect(gx, gy, 6, 4);
    ctx.fillStyle = '#f2cc6a'; ctx.fillRect(gx + 1, gy + 1, 4, 2);
    ctx.fillStyle = '#fff1b0'; ctx.fillRect(gx + 1, gy + 1, 2, 1);
    ctx.fillStyle = '#b8902e'; ctx.fillRect(gx + 3, gy + 2, 2, 1);
  }

  // working: raised away from the target through a slow wind-up, then a
  // fast chop that lands pointing at it (workT resets on the hit)
  if (working) {
    const e = prog < 0.7 ? prog / 0.7 * 0.3 : 0.3 + (prog - 0.7) / 0.3 * 0.7;
    const a = Math.atan2(tdy, tdx) - 1.6 * (1 - e);
    ctx.save();
    ctx.translate(Math.round(bx + 6 + Math.cos(a) * 7), Math.round(by + 3 + Math.sin(a) * 7));
    ctx.rotate(a + Math.PI / 2);
    ctx.drawImage(icon, -4, -4);
    ctx.restore();
  }

  // the four shared tells, same as any other body (js/abilities.js)
  drawUnitStates(b, bx, by, spr.width, spr.height, now);
  drawHealthBar(b.x - ex, by - 4, b.hp, b.maxHp, 8);
  if (b.stunT > 0) drawStunStars(Math.round(b.x - ex), by - 9, b, 4);
}

// ---- the landmark glyph both maps and the drop chart stamp ----------------
// a landmark's glyph, centred on x,y: a rim pass so it reads on parchment,
// snow and forest alike, then the ink
function drawLandmarkIcon(g, L, x, y, col, rim) {
  const x0 = Math.round(x) - 3, y0 = Math.round(y) - 3;
  g.fillStyle = rim || '#241a10';
  for (const [rx, ry, rw, rh] of L.spec.icon) g.fillRect(x0 + rx - 1, y0 + ry - 1, rw + 2, rh + 2);
  g.fillStyle = col || L.spec.mark;
  for (const [rx, ry, rw, rh] of L.spec.icon) g.fillRect(x0 + rx, y0 + ry, rw, rh);
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

// every player draws through here - the local one, the AI fills, network
// peers later. Team palette on the sprite, name tag on everybody else.
// gear on the body: bought depth is visible depth. Each piece at level 2+
// lays a band of its material across the sprite - hat, coat, hips, one mark
// per foot - so a fed player reads iron -> steel -> gold at a glance without
// a number. Level 1 (the free pick) draws nothing: the baseline look is the
// champion's. Rows are sprite-relative to the shared 16x16 body plan.
const GEAR_MARKS = [
  { y: 3, x: 5, w: 6 },          // helmet: across the hat/hood
  { y: 8, x: 5, w: 6 },          // chest: across the coat
  { y: 11, x: 5, w: 6 },         // legs: across the hips
  { y: 13, x: 5, w: 2, x2: 9 },  // boots: one mark per foot
];
// s scales the whole 16x16 grid the marks are authored on: 1 in the world,
// 5 on the victory screen's big champion
function drawGearMarks(p, px, py, s) {
  s = s || 1;
  for (let i = 0; i < GEAR_MARKS.length; i++) {
    const lv = p.gearLv[i];
    if (lv < 2) continue;
    const m = GEAR_MARKS[i];
    ctx.fillStyle = GEAR_MATS[lv - 1];
    ctx.fillRect(px + m.x * s, py + m.y * s, m.w * s, s);
    if (m.x2 !== undefined) ctx.fillRect(px + m.x2 * s, py + m.y * s, m.w * s, s);
  }
}

// Centre a run of pixel text over a model. A glyph run is an ODD number of
// pixels wide at scale 1 (`pixelTextWidth` is `4n - 1`), so it can never sit
// exactly on the seam an even-width sprite is centred on - but it must at
// least sit on the same side of that seam every frame, and rounding
// `x - ex - w / 2` in one go does not. The half pixel the odd width carries
// lands on top of the camera's own fraction, so which way it rounds flips as
// the model walks and the tag hops a pixel left and right against a body that
// is holding still. Round the position first - the once-and-only-once rule in
// CLAUDE.md - then step back a whole number of pixels. `w >> 1` puts the run's
// MIDDLE COLUMN on `round(sx)`, which is the column the debug centre line
// (hbMid) draws, so the overlay runs straight down the middle glyph.
function centreTextX(sx, txt, scale) { return Math.round(sx) - (pixelTextWidth(txt, scale) >> 1); }

// How far right of the sprite's own centre the overhead stack is drawn. The
// frame is the 6 px level badge hard against the 16 px bar backing - 22 px in
// all - and it is the FRAME that has to be centred on the body, so the bars
// inside it sit three pixels right of the seam to leave the badge its room on
// the left. Centring the bars instead and letting the badge overhang put the
// whole plate three pixels off; the pink centre column under '.' (`hbMid`) is
// what both were measured against. The stun plate is deliberately NOT counted:
// it is a transient annex on the right, and sizing the resting frame around
// something that is usually absent is what made the plate lopsided before.
const FRAME_DX = 3;

function drawPlayer(p, ex, ey, now) {
  const local = p === player;
  const lying = p.prone;
  const set = lying ? classSet(p).prone[p.dir] : classSet(p)[p.dir];
  let frame = 0;
  if (lying) frame = p.moving ? 1 + (Math.floor(p.crawlT) % 2) : 0;
  else if (p.moving) frame = 1 + (Math.floor(p.animT) % 2);
  const spr = set[frame];
  // the crawl inches: the second frame sits one pixel further along the facing
  // than the first, so the body hauls itself forward instead of flapping in
  // place. Baking two shifted copies of every grid would have said the same
  // thing at eight times the art.
  const ix = lying && frame === 2 ? (p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0) : 0;
  const iy = lying && frame === 2 ? (p.dir === 'up' ? -1 : p.dir === 'down' ? 1 : 0) : 0;
  const px = Math.round(p.x - 8 - ex) + ix;
  const py = Math.round(p.y - 12 - ey) + iy;
  // shadow (not while swimming in a hole, and not while lying down - a body
  // flat on the snow has nothing to cast one over, and the cover's own dark
  // lower rim is what grounds it instead)
  if (p.fallT <= 0 && !lying) {
    ctx.fillStyle = 'rgba(110,130,170,0.4)';
    ctx.fillRect(px + 5, py + 15, 6, 2);
  }
  if (lying && local) drawBuryRing(p, Math.round(p.x - ex), Math.round(p.y - ey) + 3);

  if (p.fallT > 0) {
    // plunged through the ice: quick sink, only the head above the waterline
    const sink = Math.round(Math.min(7, (HOLE_FALL_T - p.fallT) * 40));
    ctx.save();
    ctx.beginPath(); ctx.rect(px - 2, py - 8, 20, 20); ctx.clip();
    drawSpriteFlash(spr, px, py + sink, p.hurtT > 0.12 ? 1 : 0);
    ctx.restore();
    // ripple rings at the waterline
    ctx.fillStyle = 'rgba(207,228,242,0.75)';
    ctx.fillRect(px + 2, py + 11, 12, 1);
    ctx.fillRect(px + 4, py + 13, 8, 1);
  } else if (p.dodgeT > 0) {
    // dodge roll: full spin over the roll, trailing two afterimage ghosts.
    // Spin sign follows horizontal intent so side rolls tumble forward.
    const prog = 1 - p.dodgeT / DODGE_T;
    const sgn = p.dodgeVX < 0 ? -1 : p.dodgeVX > 0 ? 1 :
      p.dodgeVY < 0 ? -1 : 1;
    const vd = Math.hypot(p.dodgeVX, p.dodgeVY) || 1;
    const nx = p.dodgeVX / vd, ny = p.dodgeVY / vd;
    const rollSpr = classSet(p)[p.dir][0];
    const spin = (a, gx, gy) => {
      ctx.save();
      ctx.translate(Math.round(px + 8 + gx), Math.round(py + 8 + gy));
      ctx.rotate(a);
      ctx.drawImage(rollSpr, -8, -8);
      ctx.restore();
    };
    ctx.globalAlpha = 0.12; spin(sgn * (prog - 0.14) * Math.PI * 2, -nx * 11, -ny * 11);
    ctx.globalAlpha = 0.28; spin(sgn * (prog - 0.07) * Math.PI * 2, -nx * 6, -ny * 6);
    ctx.globalAlpha = 1; spin(sgn * prog * Math.PI * 2, 0, 0);
  } else {
    // a cast, the net shot's recoil hop or the rush lean is performed BY the
    // body: the pose shifts / tilts the sprite itself (abilityPose,
    // js/abilities.js), so an ability visibly happens to the model
    const pose = state.mode !== 'title' ? abilityPose(p) : null;
    const ax = px + (pose ? pose.dx : 0), ay = py + (pose ? pose.dy : 0);
    // held tool: behind the body when facing away, in the hand otherwise. A
    // lying player shows one only while the bow is actually drawn - a carried
    // axe bobbing over a body on its belly reads as a floating axe. A body
    // mid-cast (or holding the shield, or charging) has no hand free for it.
    const held = state.mode !== 'title' && (!lying || p.charging) &&
      p.castT <= 0 && p.shieldT <= 0 && p.rushT <= 0;
    const toolBehind = held && p.dir === 'up' && !p.charging && p.swingT <= 0;
    if (toolBehind) drawHeldTool(p, px, py);
    if (p.invuln > 0 && state.mode !== 'title' && ((now * 12) | 0) % 2 === 0) ctx.globalAlpha = 0.45;
    if (pose && pose.rot) {
      ctx.save();
      ctx.translate(ax + 8, ay + 8);
      ctx.rotate(pose.rot);
      drawSpriteFlash(spr, -8, -8, p.hurtT > 0.12 ? 1 : 0);
      ctx.restore();
    } else {
      drawSpriteFlash(spr, ax, ay, p.hurtT > 0.12 ? 1 : 0);
    }
    // gear marks sit at fixed points on the standing body plan, so the prone
    // poses skip them rather than stripe a shoulder across someone's hip
    if (state.mode !== 'title' && !lying && !(pose && pose.rot)) drawGearMarks(p, ax, ay);
    ctx.globalAlpha = 1;
    if (held && !toolBehind) drawHeldTool(p, px, py);
    // what an ability left ON this body - shield, net, jaws, fury, mark -
    // drawn over the sprite for every side alike (js/abilities.js)
    if (state.mode !== 'title') drawAbilityOnPlayer(p, ax, ay, now);
    // and the snow goes on last, over body and bow alike
    if (lying && p.hide > 0) {
      drawSnowCover(p, spr, px, py, local ? 0.66 : p.team === player.team ? 0.85 : 1);
    }
  }

  if (state.mode === 'title') return;

  // Everything above the head is a tell, and a buried player gives none of
  // them away: name tag, both bars, the level badge and - the one that
  // matters - the draw meter that says a shot is coming all fade with the
  // cover. You keep a readable copy of your own, your side keeps most of
  // theirs, and a rival keeps nothing, which is the whole point of the thing.
  const cf = 1 - concealOf(p) * (local ? 0.55 : p.team === player.team ? 0.7 : 1);
  if (cf < 0.03) { ctx.globalAlpha = 1; return; }
  ctx.globalAlpha = cf;

  // the whole stack hangs off one y so it can drop with the body: a prone
  // pose starts ~6 rows lower in the same 16x16 cell, and bars floating where
  // a head no longer is look broken
  const hy = py + (lying ? 6 : 0);
  // fx is the stack's own centre column - the body's, shifted by FRAME_DX so
  // the frame straddles the sprite. Everything in the frame hangs off it.
  const fx = Math.round(p.x - ex) + FRAME_DX;
  drawHealthBar(p.x - ex + FRAME_DX, hy - 7, p.hp, p.maxHp, 14);
  // level badge: a 7-tall plate sharing its right frame column with the bar
  // backing's left edge (one 1px frame everywhere, never a doubled wall), and
  // spanning the health bar and the stamina bar stacked (hy-8 .. hy-2). Same
  // backing / track colours as the bars. It sizes itself to the number and
  // grows LEFT, so a two-digit level (the cap is 12) overhangs the way the
  // stun plate does on the other side rather than squashing the digits.
  {
    const lt = String(p.level), lw = pixelTextWidth(lt);
    const bw = lw + 3, bx = fx - 8 - bw, by = hy - 8;
    ctx.fillStyle = 'rgba(12,18,42,0.78)';
    ctx.fillRect(bx, by, bw, 7); // the column past it is the bar backing, already painted
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(bx + 1, by + 1, bw - 1, 5);
    drawPixelText(ctx, lt, bx + 2, by + 1, '#f2cc6a');
  }
  // Every slot carries a name tag in its team colour so a fight stays
  // legible - your own included: the profile name is what the rest of the
  // table sees over your head, and hiding it from you alone would make it
  // the one label in the game you cannot check.
  drawPixelTextOutline(ctx, p.name,
    centreTextX(p.x - ex, p.name), hy - 18, // clear of the draw meter's frame (top row hy-11) with a gap row
    TEAMS[p.team].mark, '#0f1632');
  // dodge stamina: one clean unsegmented bar under the health bar - charges
  // stay discrete in the sim, the bar just shows the pooled total. Drawn for
  // every slot (a rival out of rolls is a tell, and the level badge spans
  // both bars, so a lone hp bar would look broken).
  // The track is painted one row taller than the fill so the gap between the two
  // bars is track grey, not frame colour - one clean outline around both.
  {
    const bx = fx - 7, by = hy - 4;
    ctx.fillStyle = 'rgba(12,18,42,0.78)';
    ctx.fillRect(bx - 1, by, 16, 3); // rows under the hp backing only - the backing is translucent, so overlapping it would paint a darker row
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(bx, by - 1, 14, 3);
    const regenP = p.dodgeCharges < DODGE_CHARGES ? 1 - p.dodgeRegenT / kitOf(p).dodgeCd : 0;
    const frac = (p.dodgeCharges + regenP) / DODGE_CHARGES;
    // ghost of the chunk just spent: pale segment that drains into place
    const gw = Math.round(14 * Math.max(frac, p.stamGhost)) - Math.round(14 * frac);
    if (gw > 0) {
      ctx.fillStyle = '#e6f4ff';
      ctx.fillRect(bx + Math.round(14 * frac), by, gw, 2);
    }
    ctx.fillStyle = '#8ad8ff';
    ctx.fillRect(bx, by, Math.round(14 * frac), 2);
  }
  // stunned: the mirror of the level badge on the other side of the frame -
  // same backing, same track, sharing its left frame column with the health
  // bar backing's right edge, so the stack still reads as one outline. The
  // sparks say what the state is and the track drains from the bottom as the
  // window runs out, which answers the only question a stun asks.
  //
  // Nothing is drawn here while nothing is stunning - an empty plate parked
  // over every head is a bar that is never a bar. That does mean the resting
  // frame is only the level badge plus the bars, 22 px spanning cx-14..cx+7,
  // sitting three pixels left of the sprite's own seam; turn the pink centre
  // column on under '.' (drawHitboxes) and you can see it. Fixing that by
  // shifting the badge and both bars 3 px right would take the BARS off the
  // body to square up a badge, and the frame would still grow rightwards the
  // moment a stun landed, so it is left as it is.
  if (p.stunT > 0) {
    const bx = fx + 8, by = hy - 8;
    ctx.fillStyle = 'rgba(12,18,42,0.78)';
    ctx.fillRect(bx, by, 6, 7); // 6 wide: the column to its left is the bar backing, already painted
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(bx, by + 1, 5, 5);
    const h = Math.max(1, Math.round(5 * Math.min(1, p.stunT / Math.max(0.01, p.stunMax))));
    ctx.fillStyle = '#b06a14'; // bright enough to read as a fill against the track, dim enough to sit under the sparks
    ctx.fillRect(bx, by + 6 - h, 5, h);
    drawStunStars(bx + 2, by + 3, p, 1.5, 1);
  }
  // bow draw meter: yellow while charging, turning hot orange the moment the
  // draw is full. Drawn for everyone - it is the tell that says a shot is
  // coming. It sits inside the shared frame directly above the hp bar, the
  // mirror of the stamina bar below it: its backing adds the rows above the
  // hp backing (frame top at hy-11, fill hy-10..-9) and the hp backing's top
  // row hy-8 becomes the track-grey gap row, so the frame stays one outline.
  // The same slot carries the renock cooldown when the bow is not drawn, AND
  // the meal being chewed (js/core.js) - the three states of one pair of
  // hands, and never two at once, since a meal puts the bow down and blocks
  // the draw for its whole length. So one strip above a head answers the only
  // question a fight asks about it: gold filling = drawing (a shot is coming),
  // slate filling = reloading (it is not), white = the instant it came back,
  // GREEN filling = eating (a heal is coming, and hitting them takes it away).
  // All three use the identical geometry, so the bar never jumps when one
  // hands over to the next.
  const nockKit = kitOf(p);
  if (p.eatT > 0 || p.charging || p.nockT > 0 || p.readyFlash > 0) {
    const eating = p.eatT > 0, drawing = p.charging;
    const frac = eating ? 1 - p.eatT / FOOD_EAT
      : drawing ? Math.min(1, p.chargeT / nockKit.bowCharge)
      : p.readyFlash > 0 ? 1 : 1 - p.nockT / Math.max(0.01, nockKit.nock);
    const x = fx - 7, y = hy - 10;
    ctx.fillStyle = 'rgba(12,18,42,0.78)';
    ctx.fillRect(x - 1, y - 1, 16, 3); // rows above the hp backing only (translucent - never overlap)
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(x, y, 14, 3);         // fill rows + the gap row
    ctx.fillStyle = eating ? '#8fe08a' // the heal colour the floater lands in
      : !drawing ? (p.readyFlash > 0 ? '#f4f7ff' : '#6f7ca8')
      : frac >= 1 ? '#ff9440' : '#ffd95c';
    ctx.fillRect(x, y, Math.max(1, Math.round(14 * frac)), 2);
  }
  ctx.globalAlpha = 1;
}

// The cover has to fit the pose it is covering, and the six prone poses are
// six different silhouettes - long and low side-on, wide-armed head-on - so
// the mound's row extents come from the sprite rather than from an ellipse
// that would leave a mitten sticking out of the snow. `spr.spans` is the
// per-row [firstX, lastX] that sprites.js takes off the char grid at bake time
// (see `bakeSpan`), so there is no canvas readback anywhere in this, and the
// cover stays correct on its own if the art is ever redrawn.
const poseSpans = new Map();
function poseBounds(spr) {
  let b = poseSpans.get(spr);
  if (b) return b;
  const raw = spr.spans || [];
  // dilate a row into its neighbours before storing: snow banked over a body
  // is a drift, not a traced outline, and taking the union of three rows both
  // rounds the jagged bits out and adds the row of piled snow above and below
  // the sprite that makes it sit IN the ground rather than on it
  b = [];
  for (let y = 0; y < 16; y++) {
    let lo = 99, hi = -1;
    for (let k = -1; k <= 1; k++) {
      const s = raw[y + k];
      if (s) { if (s[0] < lo) lo = s[0]; if (s[1] > hi) hi = s[1]; }
    }
    b.push(hi < 0 ? null : [lo, hi]);
  }
  b.raw = raw; // the body itself: the cover is never allowed to be narrower than this
  poseSpans.set(spr, b);
  return b;
}

// The snow pulled over a body, one row per row of the pose it sits on, each
// row a pixel wider than the body underneath so nothing peeks out at the
// edges. Coverage closes from the OUTSIDE IN - boots and elbows go first, the
// middle of the back last - so most of the way through there is still a seam
// of coat showing down the spine, and only at the very end does the shape
// become a lump in the snow. Row widths are roughened by hash2 against the
// tile, so it is a drift rather than a traced outline and it holds still
// instead of shimmering. Lit like every other drift here: pale crest along the
// top, shade along the bottom, and a dark rim under it doing the grounding
// that a prone body's missing cast shadow would have done.
function drawSnowCover(p, spr, px, py, alpha) {
  const h = Math.max(0, Math.min(1, p.hide));
  if (h <= 0) return;
  const rows = poseBounds(spr);
  const seed = ((p.x / TILE) | 0) * 31 + ((p.y / TILE) | 0) * 17;
  let first = -1, last = -1;
  for (let r = 0; r < 16; r++) if (rows[r]) { if (first < 0) first = r; last = r; }
  if (first < 0) return;
  ctx.globalAlpha = alpha;
  let botY = 0, botL = 0, botR = 0;
  for (let r = first; r <= last; r++) {
    const s = rows[r];
    if (!s) continue;
    // 1-2 px of piled snow past the body, pulled back in at the two ends so
    // the drift rounds off instead of ending in a square corner
    const edge = Math.min(r - first, last - r);
    const grow = 1 + Math.round(hash2(seed + r * 5, 91)) - (edge === 0 ? 3 : edge === 1 ? 1 : 0);
    // the taper must never pull the cover inside the body it is covering - a
    // pose that runs to the bottom of the cell (both head-on ones do) has no
    // spare row below it to round off into, and two boot pixels sticking out
    // of an otherwise finished mound is exactly the tell that ruins it
    const body = rows.raw[r];
    const lo = Math.min(px + s[0] - grow, body ? px + body[0] : Infinity);
    const hi = Math.max(px + s[1] + grow, body ? px + body[1] : -Infinity);
    if (hi < lo) continue;
    const hw = (hi - lo + 1) / 2, mid = (lo + hi + 1) / 2;
    const gap = Math.round(hw * (1 - h));                        // the open seam, closing as it fills
    if (gap >= hw) continue;
    const bw = Math.round(hw - gap), y = py + r;
    // a ramp down the mound, not three flat bands: the crest catches the light
    // the same way every drift in this world does and the far side falls into
    // shade, which is the only thing that makes a finished mound read as a
    // lump rather than as a patch of ground the same colour as the ground
    const u = (r - first) / Math.max(1, last - first);
    ctx.fillStyle = u < 0.14 ? '#ffffff' : u < 0.32 ? '#f8fbff' : u < 0.56 ? '#edf3fc'
      : u < 0.78 ? '#d8e4f2' : '#bfcee4';
    ctx.fillRect(Math.round(mid - hw), y, bw, 1);
    ctx.fillRect(Math.round(mid + gap), y, bw, 1);
    botY = y; botL = Math.round(mid - hw); botR = Math.round(mid + hw);
  }
  if (botR > botL) {
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = '#6e86ab';
    ctx.fillRect(botL + 1, botY + 1, botR - botL - 2, 1);
  }
  // two frost glints on the crest, fixed to the tile so they do not crawl
  if (h > 0.75) {
    ctx.globalAlpha = alpha * (0.5 + 0.5 * h);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 2; i++) {
      const gr = first + 1 + Math.floor(hash2(seed + i * 13, 67) * Math.max(1, last - first - 2));
      const s = rows[gr];
      if (!s) continue;
      ctx.fillRect(px + s[0] + 1 + Math.floor(hash2(seed + i * 13, 41) * Math.max(1, s[1] - s[0] - 1)), py + gr, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

// The bury meter, local slot only: twelve marks on a ring in the snow that
// light one at a time as the cover builds, then flash white and go. A rival's
// bury needs no meter - they can literally watch you disappear - and this one
// exists only because you cannot see your own back.
function drawBuryRing(p, cxp, cyp) {
  const done = p.hideFlash > 0;
  if (p.hide >= 1 && !done) return;
  const h = Math.min(1, p.hide);
  ctx.globalAlpha = done ? Math.min(1, p.hideFlash / 0.4) : 1;
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
    const x = Math.round(cxp + Math.cos(a) * 14), y = Math.round(cyp + Math.sin(a) * 9);
    // a dark pixel under each mark, the same trick drawPixelTextOutline uses:
    // white on snow is white on white without something behind it
    ctx.fillStyle = 'rgba(14,22,50,0.55)';
    ctx.fillRect(x, y + 1, 1, 1);
    ctx.fillStyle = done || i / 12 < h ? '#ffffff' : '#68799f';
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
}

// an unfilled slot: a flat team-tinted silhouette standing at its camp, so
// the world shows who is missing rather than pretending the slot isn't there
function drawGhost(p, ex, ey) {
  const spr = classSet(p)[p.dir][0];
  const px = Math.round(p.x - 8 - ex), py = Math.round(p.y - 12 - ey);
  sctx.clearRect(0, 0, 32, 32);
  sctx.globalCompositeOperation = 'source-over';
  sctx.drawImage(spr, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = TEAMS[p.team].mark;
  sctx.fillRect(0, 0, 32, 32);
  ctx.globalAlpha = 0.22;
  ctx.drawImage(scratch, 0, 0, spr.width, spr.height, px, py, spr.width, spr.height);
  ctx.globalAlpha = 1;
}

// the held tool, drawn on a player: carried at the hand while idle or
// walking, swept along the arc during a melee swing, aimed at that player's
// aim point while the bow is drawn. px/py are the sprite's top-left on screen.
function drawHeldTool(p, px, py) {
  const t = SWING_TOOLS[p.swing];
  // At rest the hands hold the WEAPON on the selected slot, whose art carries
  // its own tier colour - so what somebody is carrying reads off their sprite
  // from across the snow, and an empty slot reads as empty hands. Mid-swing
  // (axe, pick) the swing tool's own 8x8 icon takes over.
  const weapon = t.key === 'bow' ? heldTool(p) : null;
  const icon = t.key === 'bow'
    ? (weapon ? SPRITES[ITEMS[weapon.type].icon] : null)
    : SPRITES[t.icon];
  if (!icon) return;
  const half = icon.width >> 1;
  const cxp = px + 8, cyp = py + 10; // roughly the hands

  // drawn bow tracks the aim; base sprite fires -x (arc on the left), so
  // rotating by a + PI points the arc at the target
  if (t.key === 'bow' && p.charging) {
    const a = Math.atan2(p.input.aimY - (p.y - BOW_Y), p.input.aimX - p.x);
    ctx.save();
    ctx.translate(Math.round(cxp + Math.cos(a) * 8), Math.round(cyp - 2 + Math.sin(a) * 8));
    ctx.rotate(a + Math.PI);
    ctx.drawImage(icon, -half, -half);
    ctx.restore();
    return;
  }

  // melee swing: sweep with the same arc the swing effect uses; the icons
  // point up, so + PI/2 aligns the head with the sweep direction
  if (t.key !== 'bow' && p.swingT > 0) {
    const prog = 1 - p.swingT / 0.18;
    const a = p.swingDir - 1.1 + prog * 2.2;
    ctx.save();
    ctx.translate(Math.round(cxp + Math.cos(a) * 9), Math.round(cyp - 2 + Math.sin(a) * 9));
    ctx.rotate(a + Math.PI / 2);
    ctx.drawImage(icon, -half, -half);
    ctx.restore();
    return;
  }

  // carried: sits in the leading hand, with a 1px walk bob
  const bob = p.moving ? Math.floor(p.animT) % 2 : 0;
  if (p.dir === 'left') {
    ctx.save();
    ctx.translate(px + 2, cyp - 2 + bob);
    ctx.scale(-1, 1);
    ctx.drawImage(icon, -half, -half);
    ctx.restore();
  } else if (p.dir === 'right') {
    ctx.drawImage(icon, px + 14 - half, cyp - 2 - half + bob);
  } else if (p.dir === 'down') {
    ctx.drawImage(icon, px + 14 - half, cyp - 1 - half + bob);
  } else { // up: far hand, occluded by the body (caller draws us first)
    ctx.drawImage(icon, px + 2 - half, cyp - 1 - half + bob);
  }
}

// ------------------------------------------------------------ light & weather
// Daylight, night, and the two things that make a flat white field read as a
// place with weather over it: SUN SHAFTS and the shadows of drifting CLOUD.
// Both are world-anchored and world-sized, so zooming in walks you under a
// cloud and between two shafts rather than magnifying the sky.
//
// There is no darkness-and-lamps model any more. Nothing on the map emits
// light, nothing punches a hole in a dark overlay, and the player carries no
// personal glow: NIGHT IS A COLOUR. A blue multiply cools and darkens the
// whole frame, the field stays readable at midnight, and the one thing that
// still glows - a shot with a `lit` bit in it - reads as warm against the
// blue instead of being the only thing on screen.
//
// Everything here runs on the SIM clock (state.windT), not on wall time, so
// DBG.step reproduces a gust, a shaft and a twinkle exactly.

// ---- specks ----
// The sun's dust motes and the ice's reflected stars are hundreds of 1-2 px
// dots a frame. Neither changes anything the sim can see, so they are free to
// be drawn however is cheapest - and the cheapest is the lesson the pines
// taught: what costs is STATE CHANGES, not pixels. A fillRect per speck with
// its own fillStyle and globalAlpha is a draw call per speck.
//
// Collecting them into a Path2D per bucket was tried and is worse, not better:
// building and tessellating a path of 1 px rects every frame cost 1.0 ms for
// 240 motes on a GTX 1060, against 0.05 ms through this. So instead every
// speck is BAKED - one texture, one cell per (kind, brightness level), so the
// whole field draws from a single source with globalAlpha pinned at 1 and
// nothing to change between calls, and the driver batches the lot.
const SPECK_CELL = 8;   // px per cell: room for a 2 px core and a +/-3 px catch
const SPECK_LV = 10;    // brightness levels baked per kind

// paint(g, kind, alpha) draws one cell centred on (SPECK_CELL/2, SPECK_CELL/2)
function bakeSpecks(kinds, paint) {
  const c = document.createElement('canvas');
  c.width = SPECK_CELL * SPECK_LV; c.height = SPECK_CELL * kinds;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (let k = 0; k < kinds; k++) {
    for (let l = 0; l < SPECK_LV; l++) {
      g.save();
      g.translate(l * SPECK_CELL, k * SPECK_CELL);
      paint(g, k, (l + 1) / SPECK_LV);
      g.restore();
    }
  }
  return c;
}

// one speck, at the level nearest its alpha. Caller keeps globalAlpha at 1.
function drawSpeck(atlas, kind, a, x, y) {
  if (a <= 0.04) return;
  const l = Math.min(SPECK_LV - 1, Math.max(0, Math.round(a * SPECK_LV) - 1));
  ctx.drawImage(atlas, l * SPECK_CELL, kind * SPECK_CELL, SPECK_CELL, SPECK_CELL,
    x - (SPECK_CELL >> 1), y - (SPECK_CELL >> 1), SPECK_CELL, SPECK_CELL);
}

// Snow, baked the same way. A flake is a square of 1..SPECK_CELL px - the
// zoom decides which (renderWeather) - so the kind IS the size, and the whole
// field draws from one texture with nothing to change between flakes. At the
// widest rung that is 240 of them a frame, which as fillRects with their own
// globalAlpha would be 240 draw calls.
const FLAKE_CV = bakeSpecks(SPECK_CELL, (g, kind, a) => {
  const s = kind + 1, o = (SPECK_CELL - s) >> 1;
  g.globalAlpha = a;
  g.fillStyle = '#ffffff';
  g.fillRect(o, o, s, s);
});

// ---- cloud shadows ----
// Two tileable noise fields baked once at their FINAL world size, drawn 1:1
// through repeat patterns: no scaling, so no smoothing question and no seam,
// and their two periods never come round together, so the pattern that
// crosses the field never visibly repeats.
const CLOUD_A = 768, CLOUD_B = 448;       // world px: the two layers' periods
const CLOUD_A_VX = 11, CLOUD_A_VY = 4.5;  // world px/s of drift, layer A
const CLOUD_B_VX = 17, CLOUD_B_VY = 7.5;  // ... and layer B, faster and smaller
const CLOUD_DEEP = 1;                     // ceiling on a layer's baked alpha
const CLOUD_A_STR = 0.60, CLOUD_B_STR = 0.30; // and how much of each layer reaches the ground
// Contrast, not dimming. CLOUD_CURVE bends the thin half of the ramp thinner
// before CLOUD_GAIN pushes the whole thing, so open snow stays open and the
// deep part of a cloud is what actually darkens: the light-to-dark swing over
// the ground roughly doubles while the field's average brightness barely moves.
const CLOUD_CURVE = 1.35, CLOUD_GAIN = 1.9;
const CLOUD_TINT = [126, 143, 186];       // a cool shadow, never a grey one

// Value noise on a WRAPPED lattice: hashing (x mod per) is the whole trick -
// it makes the field seamless at the texture edge, which is what lets one
// small canvas tile the entire 3712px world through a repeat pattern.
function pnoise(x, y, perX, perY) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const xa = ((x0 % perX) + perX) % perX, ya = ((y0 % perY) + perY) % perY;
  const xb = (xa + 1) % perX, yb = (ya + 1) % perY;
  const a = hash2(xa, ya), b = hash2(xb, ya), c = hash2(xa, yb), d = hash2(xb, yb);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// One cloud layer: four octaves on a lattice that wraps on both axes (so the
// sum tiles). Fewer features across than down STRETCHES the shade along the
// drift, which is what keeps it from reading as circles.
//
// **The mapping is the whole look.** A threshold with a narrow ramp gives a
// plateau of full shade inside a visible rim, and a screen of those reads as
// clip-art blobs sliding over the snow. So there is no threshold: `lo`..`hi`
// spans nearly three standard deviations of the field, so almost every pixel
// lands somewhere on the ramp and hardly any reaches either end - what crosses
// the ground is one continuous swell of dimming with no edge anywhere in it.
// CLOUD_CURVE / CLOUD_GAIN then set the CONTRAST of that swell without giving
// it an edge: the curve bends the thin half down so the bright half stays
// bright, and the gain pushes what is left, so the deep part of a cloud is the
// only part that really darkens.
function bakeCloud(size, octX, octY, lo, hi) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const oc = (x, y, m) => pnoise(x / (size / (octX * m)), y / (size / (octY * m)), octX * m, octY * m);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = oc(x, y, 1) * 0.50 + oc(x, y, 2) * 0.27 + oc(x, y, 4) * 0.15 + oc(x, y, 8) * 0.08;
      const r = Math.max(0, Math.min(1, (n - lo) / (hi - lo)));
      const a = Math.min(1, Math.pow(r, CLOUD_CURVE) * CLOUD_GAIN);
      const i = (y * size + x) * 4;
      d[i] = CLOUD_TINT[0]; d[i + 1] = CLOUD_TINT[1]; d[i + 2] = CLOUD_TINT[2];
      d[i + 3] = Math.round(a * (255 * CLOUD_DEEP));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
// the field sits around 0.45 with a spread of ~0.11, so 0.16..0.78 is roughly
// mean +/- 3 sigma: everything is on the ramp, nothing is on a plateau
const cloudCvA = bakeCloud(CLOUD_A, 4, 7, 0.47, 0.86);
const cloudCvB = bakeCloud(CLOUD_B, 5, 8, 0.50, 0.88);
// the patterns are made against the WORLD buffer's context, which is the only
// one they are ever filled through
let cloudPatA = null, cloudPatB = null;

// One layer, tiled across the view and anchored in world space: a world point
// samples the same texel whatever the camera is doing, and the drift is what
// moves the cloud over the ground.
function cloudLayer(pat, per, vx, vy, ox, oy, alpha) {
  if (alpha <= 0.004) return;
  const t = state.windT;
  const sx = (((ox + t * vx) % per) + per) % per;
  const sy = (((oy + t * vy) % per) + per) % per;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = alpha;
  ctx.translate(-sx, -sy);
  ctx.fillStyle = pat;
  ctx.fillRect(sx, sy, WV_W, WV_H);
  ctx.restore();
}

function cloudShade(ox, oy, day) {
  if (!cloudPatA) {
    cloudPatA = ctx.createPattern(cloudCvA, 'repeat');
    cloudPatB = ctx.createPattern(cloudCvB, 'repeat');
  }
  cloudLayer(cloudPatA, CLOUD_A, CLOUD_A_VX, CLOUD_A_VY, ox, oy, day * CLOUD_A_STR);
  cloudLayer(cloudPatB, CLOUD_B, CLOUD_B_VX, CLOUD_B_VY, ox, oy, day * CLOUD_B_STR);
}

// ---- god rays ----
// PARALLEL shafts of low sun: the light source is the sun, which is far enough
// away that its rays arrive on one heading, so nothing here converges. What
// makes them read as beams rather than as striping laid over the picture is
// the LENGTH fade - each shaft swells out of nothing, peaks about a third of
// the way along and trails off before it leaves the view, so it arrives from
// somewhere and dies in the air instead of running edge to edge. They are
// slim, and deliberately faint: on snow already sitting at 0.95 a shaft that
// states itself is a shaft that has blown the ground out.
//
// The set is anchored to the VIEW, not to the world, and every dimension is a
// fraction of WV_W/WV_H. Two reasons: crepuscular rays are air, not ground, so
// nothing about them should slide when you pan; and it means the shafts are
// composed the same at every zoom, which is what an earlier world-anchored
// version needed a whole subdivision ladder to fake. It is not static - the
// heading drifts on a long sine, the set slides gently across its own normal,
// and each shaft wanders and breathes on its own phase.
const RAY_N = 8;            // shafts across the view
const RAY_ANG = 0.72;       // rad: the heading they all run on, down-right
const RAY_SWING = 0.055;    // rad: how far that heading drifts, on a slow sine
const RAY_WOBBLE = 0.012;   // rad: how far a single shaft wanders off it
const RAY_W = 0.030;        // a shaft's half-width at its far end, as a fraction of WV_H
const RAY_SLIDE = 0.55;     // how far the set slides sideways, in gaps
const RAY_A = 0.092;        // peak alpha of a shaft's core
const RAY_MOTES = 30;       // dust motes riding each shaft
const RAY_MOTE_SPD = 0.05;  // fraction of the shaft's length a mote drifts per second
const RAY_MOTE_LIT = 26;    // how much brighter a mote is than the shaft carrying it
const RAY_AFTER = 4;        // s of shafts still owed once the drop's boots land
const RAY_NOON = DAY_LEN * 0.5; // the middle of the daylight half of the cycle
const RAY_NOON_HALF = 7.5;  // s either side of it the shafts are up: a ~15 s window
const RAY_WINDOW_FADE = 2;  // s of ease at every edge of both windows

// Dust, baked: a warm grain, and the bigger one with a white core and a
// four-armed catch. Ten brightness levels each - a twinkle stepping in tenths
// is invisible on a 2 px speck, and it is what lets the whole field draw with
// no state change between motes.
const MOTE_CV = bakeSpecks(2, (g, kind, a) => {
  const c = SPECK_CELL >> 1;
  g.globalAlpha = a;
  g.fillStyle = '#ffd177';
  if (!kind) { g.fillRect(c, c, 1, 1); return; }
  g.fillRect(c, c, 2, 2);
  g.fillStyle = '#fff6d8'; g.fillRect(c, c, 1, 1);
  g.globalAlpha = a * 0.45;
  g.fillStyle = '#ffdf9b';
  g.fillRect(c - 2, c, 1, 1); g.fillRect(c + 3, c, 1, 1);
  g.fillRect(c, c - 2, 1, 1); g.fillRect(c, c + 3, 1, 1);
});

// One shaft, baked once: length across, width down, alpha carrying BOTH fades -
// a soft cross-section, and the swell-and-trail along the length. Baking it is
// what makes the length fade smooth; drawn as gradient strips it bands, and
// two gradients cannot multiply in one fill. Drawn scaled and rotated per
// shaft, so eight drawImages carry the whole pass.
const RAY_CV = (() => {
  const W = 256, H = 64, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    // swell in fast, hold, then trail off over most of the length
    const lead = Math.min(1, u / 0.22);
    const tail = 1 - Math.max(0, (u - 0.34) / 0.66);
    const along = lead * lead * (3 - 2 * lead) * tail * tail;
    // a parallel shaft barely spreads - just enough taper that the near end is
    // not a blunt stripe. The widening lives in the texture as a half-height.
    const half = (H / 2) * (0.62 + 0.38 * u);
    for (let y = 0; y < H; y++) {
      const v = Math.abs(y - (H - 1) / 2) / half;
      const across = v >= 1 ? 0 : Math.pow(1 - v * v, 1.9); // soft-shouldered, no hard rim
      const i = (y * W + x) * 4;
      d[i] = 255; d[i + 1] = 240; d[i + 2] = 202;          // warm, never white
      d[i + 3] = Math.round(Math.max(0, Math.min(1, along * across)) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
})();

// The shafts are not weather, they are a MOMENT. Low sun is the light of an
// arrival and of the top of the day, and a beam that is always there stops
// being a beam - so they are up for exactly two windows and dark the rest of
// the time: the whole eagle ride and RAY_AFTER seconds past the landing, and a
// ~15 s window around noon. Both ease in and out over RAY_WINDOW_FADE, and the
// practice arena's clock never moves, so its training light never gets them.
function rayLight() {
  const drop = state.mode === 'drop' || inAir(player)
    ? 1 : Math.min(1, state.rayT / RAY_WINDOW_FADE);
  const noon = (RAY_NOON_HALF - Math.abs(state.time - RAY_NOON)) / RAY_WINDOW_FADE;
  return Math.max(0, Math.min(1, Math.max(drop, noon)));
}

function godRays(ox, oy, day) {
  // rayLight() first: outside its two windows this pass - the eight blits and
  // the two hundred motes behind them - never runs at all
  const s = day * day * rayLight();
  if (s <= 0.02) return;
  const t = state.windT;
  const ang = RAY_ANG + Math.sin(t * 0.09) * RAY_SWING;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  // The view's four corners in the ROTATED frame - local x runs along a shaft,
  // local y across them - so the set is laid out over exactly what is on
  // screen: no shaft is placed where it could never be seen.
  const xs = [0, WV_W * cs, WV_H * sn, WV_W * cs + WV_H * sn];
  const ys = [0, -WV_W * sn, WV_H * cs, -WV_W * sn + WV_H * cs];
  const aMin = Math.min.apply(null, xs), aMax = Math.max.apply(null, xs);
  const nMin = Math.min.apply(null, ys), nMax = Math.max.apply(null, ys);
  const span = aMax - aMin, gap = (nMax - nMin) / RAY_N;
  // the whole set breathes sideways on a slow sine rather than drifting and
  // wrapping: a wrap would pop a shaft into existence mid-screen
  const slide = Math.sin(t * 0.07) * gap * RAY_SLIDE;
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true; // the shaft is a soft gradient, not pixel art
  const beams = [];
  for (let i = 0; i < RAY_N; i++) {
    // spread across the view, jittered off the even spacing so the set never
    // reads as a comb, each shaft wandering a little on its own heading
    const across = nMin + (i + 0.5) * gap + (hash2(i, 23) - 0.5) * gap * 0.8 + slide;
    const beamAng = ang + Math.sin(t * (0.19 + hash2(i, 5) * 0.14) + i * 2.1) * RAY_WOBBLE;
    // two rates of shimmer: a slow swell, and a faster flicker over it
    const a = RAY_A * s
      * (0.30 + 0.70 * (0.5 + 0.5 * Math.sin(t * 0.47 + i * 2.3)))
      * (0.74 + 0.26 * Math.sin(t * 1.7 + i * 1.1));
    // staggered along their own length, so they do not all begin and end together
    const start = aMin - span * 0.1 + hash2(i, 41) * span * 0.30;
    const len = span * (0.62 + hash2(i, 67) * 0.42);
    const halfEnd = WV_H * RAY_W * (0.7 + hash2(i, 89) * 0.6);
    // back out of the rotated frame: where this shaft begins, in view pixels
    const x0 = cs * start - sn * across, y0 = sn * start + cs * across;
    beams.push({ i, ang: beamAng, a, x0, y0, len, halfEnd });
    if (a <= 0.004) continue;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(x0, y0);
    ctx.rotate(beamAng);
    ctx.globalAlpha = a;
    // the texture already holds the taper, so this is one plain scaled blit
    ctx.drawImage(RAY_CV, 0, -halfEnd, len, halfEnd * 2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = prevSmooth;

  // Dust in the light. The motes live in SHAFT coordinates - u along, v across -
  // so they can only ever exist where a shaft does, and they drift DOWN the
  // shaft rather than falling with the snow. The hash keys off the shaft's
  // index, not its angle: the angle wobbles every frame, and a mote whose seed
  // moves teleports instead of drifting.
  //
  // Drawn source-over in warm GOLD, not additively in white. Snow already sits
  // at 0.95, so there is no headroom to brighten it with - a lighter-mode mote
  // over a sunlit drift is invisible - but a warm speck reads on white the way
  // a cold one never could, and the biggest ones get a white core and a
  // four-armed catch so the field is not one repeated dot. They carry most of
  // what the eye reads as "a beam", which is why the shafts can stay this faint.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1; // the last shaft's blit left its own alpha behind
  for (const b of beams) {
    if (b.a <= 0.006) continue;
    const bc = Math.cos(b.ang), bs = Math.sin(b.ang);
    for (let j = 0; j < RAY_MOTES; j++) {
      const h = hash2(j * 13 + 3, b.i * 977 + 5);
      const h2 = hash2(j * 31 + 7, b.i * 131 + 19);
      const u = (h + t * RAY_MOTE_SPD * (0.5 + h)) % 1;
      const v = Math.sin(t * (0.6 + h2 * 1.3) + h2 * 31) * (0.2 + 0.62 * h2);
      // the same swell-and-trail the shaft has, so a mote fades with its light
      const lead = Math.min(1, u / 0.22);
      const along = lead * lead * (3 - 2 * lead) * Math.pow(Math.max(0, 1 - (u - 0.34) / 0.66), 2);
      const twk = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin(t * (2.1 + h * 3.4) + h * 51));
      const a = Math.min(1, b.a * RAY_MOTE_LIT) * along * Math.pow(1 - v * v, 1.9) * twk;
      if (a <= 0.02) continue;
      const r = u * b.len;
      const off = v * b.halfEnd * (0.62 + 0.38 * u);
      const px = Math.round(b.x0 + bc * r - bs * off);
      const py = Math.round(b.y0 + bs * r + bc * off);
      if (px < -2 || py < -2 || px > WV_W + 2 || py > WV_H + 2) continue;
      drawSpeck(MOTE_CV, h2 > 0.88 ? 1 : 0, a, px, py);
    }
  }
  ctx.restore();
}

// ---- the reflected sky ----
// Night's one bright thing, and the only place the stars are visible in a game
// with no sky in frame: they are IN THE ICE. Two halves, and the first is what
// makes the second work at all.
//
// **The mirror.** Sheet ice is painted at 0.72-0.93 brightness, which is most
// of the way to white - so a white dot on it has almost no contrast, and a
// multiply grades star and ice down together and keeps it that way. There is
// no headroom to fix it with. So the ice itself goes DARK first: intact tiles
// take a deep-blue wash that scales with the darkness curve, which is what a
// frozen lake at night actually looks like from above - a black mirror, darker
// than the snow around it - and it is what gives the stars something to be
// bright against. Filled in horizontal RUNS of adjacent ice, one rect per run
// instead of one per tile.
//
// **The sky.** The stars do not sit on the ice, they sit in a sky reflected in
// it, so they are anchored neither to the world nor to the screen: the field is
// sampled at STAR_PAR of the camera's offset, so it slides against the ground
// as you walk - a long way off, moving slowly, which is the whole read of a
// reflection. The loop therefore runs over SKY CELLS and asks what tile each
// one landed on, not over tiles; a star only draws where it fell on unbroken
// ice, so the field is cut to the shape of the lake and an ice hole is a gap in
// it. Each twinkles on its own rate, and the whole reflection ripples a pixel
// sideways on a slow wave, because ice is not a perfect mirror.
//
// Drawn early - above the fish and the cracks, under everything that walks, so
// a body standing on the ice covers its own reflection - and therefore under
// the night colour too, which cools the stars along with the snow.
const STAR_MIRROR = 0.46;  // how far the darkness sinks intact ice toward black
const STAR_CELL = 13;      // px between sky cells
const STAR_DENS = 0.55;    // share of cells holding a star
const STAR_PAR = 0.22;     // how much of the camera's motion the sky takes: the parallax
const STAR_BRIGHT = 0.90;  // above this a star is big enough to throw a cross
const STAR_RIPPLE = 1.4;   // px the reflection wanders sideways in the ice

// The reflected stars, baked the same way: three tints (a warm one, a cold
// one, and plain white) each as a plain point and as a bright one throwing a
// cross with a soft halo. Six kinds, ten levels - one texture for the whole
// field, which at night is five hundred specks a frame.
const STAR_TINT = ['#ffe9c6', '#cfe0ff', '#f2f7ff'];
const STAR_CV = bakeSpecks(6, (g, kind, a) => {
  const c = SPECK_CELL >> 1, col = STAR_TINT[kind % 3];
  g.fillStyle = col;
  g.globalAlpha = a;
  g.fillRect(c, c, 1, 1);
  if (kind < 3) return;
  g.fillRect(c, c - 1, 1, 1); g.fillRect(c, c + 1, 1, 1);
  g.fillRect(c - 1, c, 1, 1); g.fillRect(c + 1, c, 1, 1);
  g.globalAlpha = a * 0.4;
  g.fillRect(c, c - 2, 1, 1); g.fillRect(c, c + 2, 1, 1);
  g.fillRect(c - 2, c, 1, 1); g.fillRect(c + 2, c, 1, 1);
});

// is this screen pixel over unbroken ice? the mask every reflected pixel
// passes, arms of a cross included - without it a bright star's points spill
// off the lake onto the snow beside it
function overIce(px, py, ox, oy) {
  const tx = ((px + ox) / TILE) | 0, ty = ((py + oy) / TILE) | 0;
  return inWorld(tx, ty) && ground[idx(tx, ty)] === 1;
}

function drawIceStars(ox, oy, tx0, ty0, tx1, ty1) {
  const night = state.darkness;
  if (night <= 0.03) return;
  const t = state.windT;

  // the mirror: every run of unbroken ice on screen, darkened as one rect
  ctx.fillStyle = 'rgba(7,13,40,' + (night * STAR_MIRROR).toFixed(3) + ')';
  for (let ty = ty0; ty <= ty1; ty++) {
    let run = -1;
    for (let tx = tx0; tx <= tx1 + 1; tx++) {
      const ice = tx <= tx1 && ground[idx(tx, ty)] === 1;
      if (ice && run < 0) run = tx;
      else if (!ice && run >= 0) {
        ctx.fillRect(run * TILE - ox, ty * TILE - oy, (tx - run) * TILE, TILE);
        run = -1;
      }
    }
  }

  // the sky over it. The camera only moves the field by STAR_PAR of what it
  // moves the ground, which is the parallax; everything else is per-star.
  const skx = ox * STAR_PAR, sky = oy * STAR_PAR;
  const c0 = Math.floor(skx / STAR_CELL) - 1, c1 = Math.ceil((skx + WV_W) / STAR_CELL) + 1;
  const d0 = Math.floor(sky / STAR_CELL) - 1, d1 = Math.ceil((sky + WV_H) / STAR_CELL) + 1;
  for (let cy = d0; cy <= d1; cy++) {
    // the ice's own shimmer: one slow wave down the field, so the whole
    // reflection breathes sideways rather than every star wobbling alone
    const rip = Math.round(Math.sin(cy * 0.21 + t * 0.9) * STAR_RIPPLE);
    for (let cx = c0; cx <= c1; cx++) {
      const h = hash2(cx * 3 + 11, cy * 5 + 7);
      if (h > STAR_DENS) continue;
      const q = h / STAR_DENS; // 0..1 across the stars, so every dial gets a spread
      const px = Math.round(cx * STAR_CELL - skx + q * (STAR_CELL - 2)) + rip;
      const py = Math.round(cy * STAR_CELL - sky + hash2(cx + 61, cy + 29) * (STAR_CELL - 2));
      if (px < 0 || py < 0 || px >= WV_W || py >= WV_H) continue;
      // what is under it: only unbroken ice reflects, open water does not
      if (!overIce(px, py, ox, oy)) continue;
      const twk = 0.28 + 0.72 * (0.5 + 0.5 * Math.sin(t * (0.9 + q * 2.8) + q * 61));
      const a = night * (0.40 + q * 0.60) * twk;
      if (a <= 0.03) continue;
      const tint = q < 0.18 ? 0 : q < 0.34 ? 1 : 2;
      // a bright star's cross reaches 2 px, so it only earns one well inside
      // the sheet - which also keeps every lit pixel over unbroken ice
      const big = q > STAR_BRIGHT && overIce(px - 2, py, ox, oy) && overIce(px + 2, py, ox, oy)
        && overIce(px, py - 2, ox, oy) && overIce(px, py + 2, ox, oy);
      drawSpeck(STAR_CV, big ? tint + 3 : tint, a, px, py);
    }
  }
}

// ---- the pass ----
// Day: shafts first, then the cloud that shades them - a shadow falls across
// a sunbeam, not the other way round. Then the hour's tint, then the night.
const NIGHT_TINT = '#45599c';  // multiply: what full dark does to the snow
const NIGHT_DEEP = '#0b1338';  // and a little of this on top, for depth

function renderLighting(ox, oy, now) {
  const dark = state.darkness;
  const day = 1 - dark;

  if (day > 0.02) {
    // both halves of the day's dressing answer to the ESC panel's VIDEO page
    if (settings.vidRays) godRays(ox, oy, day);
    // The training grounds keep the one fixed hour the rest of that room
    // keeps (sim.js never advances its clock): the shafts stay, because they
    // are a quality of the light, but a cloud shadow drifting over the
    // dummy's meter or the parkour's ice would change what the instruments
    // are measuring between one lap and the next.
    if (!PRACTICE && settings.vidClouds) cloudShade(ox, oy, day);
  }

  // dusk warm tint
  const duskT = state.time > DAY_LEN - 12 && state.time < DAY_LEN + 6 ?
    1 - Math.abs(state.time - (DAY_LEN - 4)) / 9 : 0;
  if (duskT > 0) {
    ctx.globalAlpha = Math.max(0, duskT) * 0.16;
    ctx.fillStyle = '#ff9a5c';
    ctx.fillRect(0, 0, WV_W, WV_H);
    ctx.globalAlpha = 1;
  }
  // dawn pink
  const dawnT = state.time > CYCLE - 10 ? (state.time - (CYCLE - 10)) / 10 :
    state.time < 8 ? 1 - state.time / 8 : 0;
  if (dawnT > 0 && dark < 0.8) {
    ctx.globalAlpha = dawnT * 0.1;
    ctx.fillStyle = '#ff88aa';
    ctx.fillRect(0, 0, WV_W, WV_H);
    ctx.globalAlpha = 1;
  }

  // Night. A multiply carries the whole shift: it cools and darkens what is
  // there instead of laying an opaque slab over it, so snow stays snow, team
  // colours stay legible and the ice keeps its stars. globalAlpha rides the
  // darkness curve, so dusk eases into it with nothing to schedule.
  if (dark > 0.005) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = dark;
    ctx.fillStyle = NIGHT_TINT;
    ctx.fillRect(0, 0, WV_W, WV_H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = dark * 0.17;
    ctx.fillStyle = NIGHT_DEEP;
    ctx.fillRect(0, 0, WV_W, WV_H);
    ctx.globalAlpha = 1;
  }

  litShots(ox, oy, now, dark);
}

// A shot can still carry its own light: the CARE ARROW and the WISP do, and
// anything a FLAME modifier is riding (`lit` in the BITS table, js/tools.js).
// They are read straight off the live shots rather than registered anywhere,
// and they are the only light left in the game - additive, so they warm the
// night blue rather than cutting a clean hole in it.
function litShots(ox, oy, now, dark) {
  let any = false;
  for (const a of arrows) if (a.lit) { any = true; break; }
  if (!any) return;
  const s = 0.20 + dark * 0.55; // barely there at noon, a real lantern at night
  ctx.globalCompositeOperation = 'lighter';
  for (const a of arrows) {
    if (!a.lit) continue;
    const r = a.lit * (1 + Math.sin(now * 11 + a.x) * 0.06);
    const lx = a.x - ox, ly = a.y - oy;
    if (lx < -r || ly < -r || lx > WV_W + r || ly > WV_H + r) continue;
    const g = ctx.createRadialGradient(lx, ly, 1, lx, ly, r);
    g.addColorStop(0, 'rgba(255,214,150,' + (s * 0.5).toFixed(3) + ')');
    g.addColorStop(0.45, 'rgba(255,192,116,' + (s * 0.2).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,176,86,0)');
    ctx.fillStyle = g;
    ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// World-space flakes wrapped into the view (see the flakes block in fx
// updates); a landed flake fades out where it came to rest. This runs on the
// SCREEN, above the world blit, so a flake stays its own crisp size however
// far in the camera is - the drift multiplies by the zoom so the field still
// scrolls with the ground under it.
function renderWeather(ex, ey) {
  if (!settings.vidSnow) return; // the VIDEO page can still the air
  // the wrap is in WORLD px around the exact camera and the scale-up comes
  // after it, so the field is one world view wide however far the camera is
  // in - WV * zoomCur always covers the canvas, since sizeWorldView ceils
  const z = zoomCur;
  for (const f of flakes) {
    const sx = ((((f.x - ex) % WV_W) + WV_W) % WV_W) * z;
    const sy = ((((f.y - ey) % WV_H) + WV_H) % WV_H) * z;
    const s = Math.max(1, Math.min(SPECK_CELL, Math.round(f.size * z)));
    drawSpeck(FLAKE_CV, s - 1, f.rest > 0 ? f.a * (f.rest / FLAKE_REST) : f.a,
      Math.round(sx), Math.round(sy));
  }
}

let vigGrd = null, vigKey = 0; // the frame vignette, rebuilt only on resize
function renderVignettes() {
  // hurt flash
  if (player.hurtT > 0) {
    ctx.globalAlpha = player.hurtT * 0.9;
    ctx.fillStyle = 'rgba(200,40,50,0.35)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
  // soft frame vignette (a VIDEO toggle - the hurt flash above is feedback
  // and never goes); the gradient is rebuilt only when the view resizes
  if (!settings.vidVig) return;
  if (vigKey !== VIEW_W * 4096 + VIEW_H) {
    vigKey = VIEW_W * 4096 + VIEW_H;
    vigGrd = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.5, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.95);
    vigGrd.addColorStop(0, 'rgba(10,14,35,0)');
    vigGrd.addColorStop(1, 'rgba(10,14,35,0.35)');
  }
  ctx.fillStyle = vigGrd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

