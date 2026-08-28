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
// Spent arrows in the snow, drawn flat under everything that walks: a stub of
// shaft on the bearing it came in on (the head is buried, so it starts at the
// entry point and runs backwards), fletching in the shooter's team colour, a
// smear of shadow along it. The head is missing on purpose - the same body the
// flying arrow draws, minus the part that is in the ground.
// Inside SHAFT_NEAR of a local player who has room for it, the whole thing
// goes gold and grows a bobbing arrowhead: that, and nothing written down, is
// how "walk over it to take it back" gets taught. It blinks over its last
// second and a half so nobody plans a route to one that is about to go.
const SHAFT_PX = [];
function drawShafts(ex, ey, now) {
  const want = state.mode === 'play' && !player.dead && !inAir(player) && player.quiver < QUIVER_MAX;
  for (const s of shafts) {
    const sx = Math.round(s.x - ex), sy = Math.round(s.y - ey);
    if (sx < -12 || sy < -12 || sx > WV_W + 12 || sy > WV_H + 12) continue;
    const left = SHAFT_LIFE - s.t;
    if (left < 1.6 && ((now * 7) | 0) % 2) continue;
    const fade = Math.min(1, left / 4);
    const near = want && Math.hypot(s.x - player.x, s.y - player.y) < SHAFT_NEAR;
    ctx.globalAlpha = fade;
    // the shadow sits under the middle of the body, not under the buried head
    ctx.fillStyle = 'rgba(120,140,175,0.32)';
    ctx.fillRect(Math.round(sx - s.nx * 3) - 2, Math.round(sy - s.ny * 3) + 2, 5, 1);
    const qx = -s.ny, qy = s.nx;
    SHAFT_PX.length = 0;
    const at = (i, j) => SHAFT_PX.push(
      Math.round(sx - s.nx * i + qx * j), Math.round(sy - s.ny * i + qy * j));
    for (let i = 0; i < 6; i++) at(i, 0);
    const shaftEnd = SHAFT_PX.length;
    at(4, -1); at(4, 1); at(5, -1); at(5, 1);
    ctx.fillStyle = ARROW_RIM; // the same plus-shaped dilation the flying arrow uses
    for (let k = 0; k < SHAFT_PX.length; k += 2) {
      const px = SHAFT_PX[k], py = SHAFT_PX[k + 1];
      ctx.fillRect(px - 1, py, 1, 1); ctx.fillRect(px + 1, py, 1, 1);
      ctx.fillRect(px, py - 1, 1, 1); ctx.fillRect(px, py + 1, 1, 1);
    }
    // in range the whole thing goes gold - the colour this HUD already uses for
    // "you can take this" (the gear row's buy chevron, every hover). White was
    // tried and vanished into the snow.
    ctx.fillStyle = near ? '#ffd95c' : '#cbbf99';
    for (let k = 0; k < shaftEnd; k += 2) ctx.fillRect(SHAFT_PX[k], SHAFT_PX[k + 1], 1, 1);
    ctx.fillStyle = near ? '#fff3c4' : TEAMS[s.team].mark;
    for (let k = shaftEnd; k < SHAFT_PX.length; k += 2) ctx.fillRect(SHAFT_PX[k], SHAFT_PX[k + 1], 1, 1);
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
  if (a.kind === 'bird') { drawBird(a, ex, ey); return; }
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
  drawHealthBar(a.x - ex, py - (rabbit ? 4 : 5), a.hp, a.maxHp, rabbit ? 8 : wolf ? 12 : 16);
  if (a.stunT > 0) drawStunStars(Math.round(a.x - ex), py - (rabbit ? 9 : 10), a, 4);
}

// The only thing in the world that leaves the ground: the sprite lifts off
// its own shadow by a.alt, which is the whole read on how high a bird is.
// No health bar - three hp means every hit is a kill, and a bar over
// something this small is all bar.
function drawBird(a, ex, ey) {
  const flying = a.flyT > 0;
  const spr = SPRITES.bird[a.dir][flying ? 1 + (Math.floor(a.animT) % 2) : 0];
  const px = Math.round(a.x - spr.width / 2 - ex);
  const py = Math.round(a.y - a.alt - spr.height - ey);
  ctx.fillStyle = flying ? 'rgba(110,130,170,0.22)' : 'rgba(110,130,170,0.3)';
  ctx.fillRect(Math.round(a.x - ex) - 2, Math.round(a.y + 1 - ey), 4, 1);
  drawSpriteFlash(spr, px, py, a.flash);
}

// Worker bot: one sprite, two tread frames. The whole thing bobs 1px while
// driving so body and tread never part. No face - the states are the tread
// rolling, the tool swinging at a target, and the gold held up front.
function drawRobot(b, ex, ey) {
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
  const set = lying ? champSet(p).prone[p.dir] : champSet(p)[p.dir];
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
    const rollSpr = champSet(p)[p.dir][0];
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
    // held tool: behind the body when facing away, in the hand otherwise. A
    // lying player shows one only while the bow is actually drawn - a carried
    // axe bobbing over a body on its belly reads as a floating axe.
    const held = state.mode !== 'title' && (!lying || p.charging);
    const toolBehind = held && p.dir === 'up' && !p.charging && p.swingT <= 0;
    if (toolBehind) drawHeldTool(p, px, py);
    if (p.invuln > 0 && state.mode !== 'title' && ((now * 12) | 0) % 2 === 0) ctx.globalAlpha = 0.45;
    drawSpriteFlash(spr, px, py, p.hurtT > 0.12 ? 1 : 0);
    // gear marks sit at fixed points on the standing body plan, so the prone
    // poses skip them rather than stripe a shoulder across someone's hip
    if (state.mode !== 'title' && !lying) drawGearMarks(p, px, py);
    ctx.globalAlpha = 1;
    if (held && !toolBehind) drawHeldTool(p, px, py);
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
  // level badge: a 7x7 square sharing its right frame column with the bar
  // backing's left edge (one 1px frame everywhere, never a doubled wall), and
  // spanning the health bar and the stamina bar stacked (hy-8 .. hy-2). Same
  // backing / track colours as the bars.
  {
    const bx = fx - 14, by = hy - 8;
    ctx.fillStyle = 'rgba(12,18,42,0.78)';
    ctx.fillRect(bx, by, 6, 7); // 6 wide: the 7th column is the bar backing, already painted
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(bx + 1, by + 1, 5, 5);
    drawPixelText(ctx, String(p.level), bx + 2, by + 1, '#f2cc6a');
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
  // The same slot carries the renock cooldown when the bow is not drawn, so
  // one strip above a head answers the only question a fight asks about it:
  // gold filling = drawing (a shot is coming), slate filling = reloading (it
  // is not), white = the instant it came back. Both use the identical
  // geometry, so the bar never jumps when one hands over to the other.
  const nockKit = kitOf(p);
  if (p.charging || p.nockT > 0 || p.readyFlash > 0) {
    const drawing = p.charging;
    const frac = drawing ? Math.min(1, p.chargeT / nockKit.bowCharge)
      : p.readyFlash > 0 ? 1 : 1 - p.nockT / Math.max(0.01, nockKit.nock);
    const x = fx - 7, y = hy - 10;
    ctx.fillStyle = 'rgba(12,18,42,0.78)';
    ctx.fillRect(x - 1, y - 1, 16, 3); // rows above the hp backing only (translucent - never overlap)
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(x, y, 14, 3);         // fill rows + the gap row
    ctx.fillStyle = !drawing ? (p.readyFlash > 0 ? '#f4f7ff' : '#6f7ca8')
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
  const spr = champSet(p)[p.dir][0];
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

// ------------------------------------------------------------ lighting & weather
function renderLighting(ox, oy, ex, ey, now) {
  const dark = state.darkness;
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

  if (dark <= 0.01) {
    // day-time warm glows only
    drawWarmGlows(ox, oy, now, 0.06);
    return;
  }

  lctx.clearRect(0, 0, WV_W, WV_H);
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = 'rgba(10,16,42,' + (dark * 0.84).toFixed(3) + ')';
  lctx.fillRect(0, 0, WV_W, WV_H);

  lctx.globalCompositeOperation = 'destination-out';
  for (const L of lights) {
    const flick = 1 + Math.sin(now * 9 + L.x) * 0.05 + Math.sin(now * 23 + L.y) * 0.03;
    const r = L.r * flick;
    const lx = L.x - ox, ly = L.y - oy;
    if (lx < -r || ly < -r || lx > WV_W + r || ly > WV_H + r) continue;
    const grd = lctx.createRadialGradient(lx, ly, 2, lx, ly, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    lctx.fillStyle = grd;
    lctx.fillRect(lx - r, ly - r, r * 2, r * 2);
  }
  // personal glow so it's never pitch black around you - with no placeable
  // fires it is the only night light, so it reaches a bit further. The player
  // is a MOVER: round(world - exact camera), once, so the glow lands on the
  // same pixel as the sprite. The `lights` loop above is static, hence ox/oy.
  {
    const lx = Math.round(player.x - ex), ly = Math.round(player.y - 4 - ey);
    const grd = lctx.createRadialGradient(lx, ly, 1, lx, ly, 44);
    grd.addColorStop(0, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    lctx.fillStyle = grd;
    lctx.fillRect(lx - 44, ly - 44, 88, 88);
  }

  ctx.drawImage(lightCv, 0, 0);

  drawWarmGlows(ox, oy, now, 0.10 + dark * 0.16);
}

function drawWarmGlows(ox, oy, now, strength) {
  // warm color grading inside light radius (multiply keeps snow readable)
  ctx.globalCompositeOperation = 'multiply';
  for (const L of lights) {
    const flick = 1 + Math.sin(now * 9 + L.x) * 0.06;
    const r = L.r * 0.95 * flick;
    const lx = L.x - ox, ly = L.y - oy;
    if (lx < -r || ly < -r || lx > WV_W + r || ly > WV_H + r) continue;
    const a = Math.min(1, strength * 3.2);
    const grd = ctx.createRadialGradient(lx, ly, 1, lx, ly, r);
    grd.addColorStop(0, 'rgba(255,205,150,' + a.toFixed(3) + ')');
    grd.addColorStop(0.6, 'rgba(255,222,180,' + (a * 0.6).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
  }
  // A shot in flight can carry its own light: the CARE ARROW and the WISP do,
  // and anything a FLAME modifier is riding. They are not in `lights` (which
  // is rebuilt from placed objects and would have to be rebuilt every frame) -
  // they are read straight off the live shots, on the same multiply pass, so
  // a lit arrow genuinely opens the dark ahead of it.
  for (const a of arrows) {
    if (!a.lit) continue;
    const r = a.lit * 0.95;
    const lx = a.x - ox, ly = a.y - oy;
    if (lx < -r || ly < -r || lx > WV_W + r || ly > WV_H + r) continue;
    const al = Math.min(1, strength * 3.2);
    const grd = ctx.createRadialGradient(lx, ly, 1, lx, ly, r);
    grd.addColorStop(0, 'rgba(255,215,165,' + al.toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
  }
  // small additive core right at the flame
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    const flick = 1 + Math.sin(now * 11 + L.x) * 0.1;
    const r = L.warm * 0.35 * flick;
    const lx = L.x - ox, ly = L.y - oy;
    if (lx < -r || ly < -r || lx > WV_W + r || ly > WV_H + r) continue;
    const grd = ctx.createRadialGradient(lx, ly, 1, lx, ly, r);
    grd.addColorStop(0, 'rgba(255,170,80,' + (strength * 0.9).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = grd;
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
  ctx.fillStyle = '#ffffff';
  for (const f of flakes) {
    const sx = (((f.x - ex) * zoomCur) % VIEW_W + VIEW_W) % VIEW_W;
    const sy = (((f.y - ey) * zoomCur) % VIEW_H + VIEW_H) % VIEW_H;
    ctx.globalAlpha = f.rest > 0 ? f.a * (f.rest / FLAKE_REST) : f.a;
    ctx.fillRect(Math.round(sx), Math.round(sy), f.size, f.size);
  }
  ctx.globalAlpha = 1;
}

function renderVignettes() {
  // hurt flash
  if (player.hurtT > 0) {
    ctx.globalAlpha = player.hurtT * 0.9;
    ctx.fillStyle = 'rgba(200,40,50,0.35)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
  // soft frame vignette
  const grd = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.5, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.95);
  grd.addColorStop(0, 'rgba(10,14,35,0)');
  grd.addColorStop(1, 'rgba(10,14,35,0.35)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

