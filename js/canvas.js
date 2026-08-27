'use strict';
// The canvas stack: screen + world + light buffers, pixel-exact world zoom,
// fitCanvas(), the pillarbox frost bars, and the panel layout anchors that
// relayout() (core.js) assigns on every resize.
// ------------------------------------------------------------ canvas
const canvas = document.getElementById('game');
// `ctx` is NOT a fixed binding: render() points it at the world buffer for
// the world layer and back at the screen for the UI layer (see the world
// buffer note below). Every draw call in the file writes through it, which is
// what lets one pass order span two different pixel spaces untouched.
const uictx = canvas.getContext('2d');
let ctx = uictx;
ctx.imageSmoothingEnabled = false;

// The world buffer. Everything up to and including lighting draws into this
// at 1:1 world pixels, and render() then blits the WV_W x WV_H corner of it
// over the whole canvas in one nearest-neighbour step. Two things fall out of
// that, and both are the point:
//   - the canvas never resizes when you zoom, so the HUD, the panels and the
//     cursor are the same size on screen at every zoom level;
//   - the world is composed at one scale and resampled ONCE as a single
//     image, so the pixel grid stays coherent across ground, sprites and
//     particles instead of each sprite rounding its own way.
// It is allocated at the most zoomed-OUT size once per canvas size, never
// per frame - resizing a canvas reallocates it and resets its context state.
const worldCv = document.createElement('canvas');
const wctx = worldCv.getContext('2d');

// offscreen light canvas (sized by fitCanvas alongside the world buffer)
const lightCv = document.createElement('canvas');
const lctx = lightCv.getContext('2d');

// full-window canvas behind the game: the pillarbox bars' frost frame
const barsCv = document.getElementById('bars');
const bctx = barsCv.getContext('2d');

// One camera for every player (the SC2/LoL model): the CANVAS always shows
// ~TARGET_ROWS rows — monitor resolution buys sharpness, never zoom.
// Heights that don't divide cleanly "breathe" a few percent rather than
// letterbox or blur (the Terraria/Stardew trade), and width is capped at
// 16:9 so ultrawides get slim pillarbox bars instead of extra vision.
const TARGET_ROWS = 270;

// ---- world zoom ----
// Zoom scales the WORLD LAYER ONLY. The canvas keeps its VIEW_W x VIEW_H
// layout at every zoom, so the HUD, the baked panels and the cursor are the
// same size on screen whatever the camera is doing: zooming in moves the
// camera closer, it does not magnify the interface.
//
// THE RESTING ZOOM IS ALWAYS PIXEL-EXACT, and that is an arithmetic fact, not
// a preference. A world pixel ends up covering `zoom * devScale` DEVICE
// pixels; unless that is a whole number some world pixels get an extra row of
// device pixels and their neighbours do not, which is what "stretched" looks
// like on a 16x16 sprite. So the zoom the player actually plays at is stored
// as that whole number - kWant, device px per world px - and the float scale
// is derived from it. The canvas backing store is therefore sized in DEVICE
// pixels (VIEW * devScale) and the UI draws through a devScale transform:
// that is what buys the fine steps, because k only has to be whole in device
// pixels, not in canvas pixels. At devScale 4 the rungs are quarter-scale
// (0.75, 1, 1.25, 1.5 ...); a smaller devScale has fewer, coarser rungs,
// which is the honest answer on a display that has fewer pixels to spend.
//
// zoomCur eases toward kWant/devScale, so a notch is a glide rather than a
// jump. In motion the blit is briefly fractional (nobody reads pixel edges
// mid-zoom); it lands exact. ZOOM_EASE is deliberately steep - with steps
// this fine a slow ease reads as lag, and a spun wheel must keep up.
const ZOOM_MIN = 0.5;     // ~540 rows: the whole clearing and then some
const ZOOM_MAX = 3.6;     // ~75 rows: close enough to read a face
const ZOOM_EASE = 16;     // per second, frame-rate independent
const DROP_ZOOM = 0.5;    // the eagle ride's fixed framing (see the eagle drop banner)
const ZOOM_FLOOR = Math.min(ZOOM_MIN, DROP_ZOOM); // widest world buffer we ever need
let kWant = 4;            // device px per world px - a WHOLE number, the wheel steps it by 1
let zoomCur = 1;          // applied scale, eased toward kWant / devScale every update
let WV_W = 480, WV_H = 270; // the world view in world px

// the rungs kWant may sit on, clamped so the ends of the range are reachable
// on any display (a devScale of 1 or 2 has very few whole numbers to offer)
function kMin() { return Math.max(1, Math.round(ZOOM_MIN * devScale)); }
function kMax() { return Math.max(kMin() + 1, Math.round(ZOOM_MAX * devScale)); }
function zoomWantOf() { return kWant / devScale; }

// WV from the current scale, in world px. CEIL, never round: WV * k must
// COVER the canvas or a sliver of stale pixels survives down the right edge.
// Width and height ceil independently, so the effective scale can differ
// between the axes by a fraction of a device pixel while the ease is running;
// at rest both land on exactly k device px per world px.
function sizeWorldView() {
  const k = Math.max(0.05, zoomCur * devScale);
  WV_W = Math.max(16, Math.ceil(VIEW_W * devScale / k));
  WV_H = Math.max(16, Math.ceil(VIEW_H * devScale / k));
}
// world point -> canvas point, for the few UI-layer things anchored to a tile
function wToSX(wx) { return (wx - camX) * zoomCur; }
function wToSY(wy) { return (wy - camY) * zoomCur; }
// ...and back: the ONLY way a pointer position becomes a world position.
// Every aim, hover and right-click target goes through these two, so the
// zoom can never be applied in one place and forgotten in another.
function mouseWX() { return mouse.x / zoomCur + camX; }
function mouseWY() { return mouse.y / zoomCur + camY; }

let scale = 2;    // CSS px per game px
let devScale = 2; // DEVICE px per game px (the integer fitCanvas picks)
function fitCanvas() {
  // pick an integer scale in DEVICE pixels, not CSS pixels: on fractional
  // display scaling (125%/150% Windows) a CSS-integer scale lands game pixels
  // on fractional device pixels, which smears and shimmers during scrolling.
  const dpr = window.devicePixelRatio || 1;
  const devW = Math.max(1, Math.round(window.innerWidth * dpr));
  const devH = Math.max(1, Math.round(window.innerHeight * dpr));
  let dev = Math.max(1, Math.round(devH / TARGET_ROWS));
  // never shrink the view below the UI panels' footprint
  while (dev > 1 && (devW / dev < 320 || devH / dev < 240)) dev--;
  scale = dev / dpr; // CSS px per game px; mouse mapping divides by this
  devScale = dev;    // the replay window captures at this resolution
  // cover the window exactly: ceil leaves at most one game px of overflow,
  // which the body's flex centering splits and overflow:hidden clips
  VIEW_H = Math.ceil(devH / dev);
  FULL_W = Math.ceil(devW / dev);
  VIEW_W = Math.min(FULL_W, Math.ceil(VIEW_H * 16 / 9));
  // The backing store is in DEVICE pixels, not game pixels: the world blit
  // needs that resolution to land a whole number of device pixels on every
  // world pixel at the in-between zoom rungs (see the world zoom block). The
  // UI still draws in VIEW space - render() puts a devScale transform under
  // it - so no layout code changes, and text and 1px rects scale by a whole
  // number too and stay crisp.
  canvas.width = VIEW_W * dev; canvas.height = VIEW_H * dev;
  uictx.imageSmoothingEnabled = false; // resizing the canvas resets ctx state
  // devScale may have just changed (resize, fullscreen, a different monitor):
  // re-rung the zoom onto the new ladder at the nearest scale to what it was
  kWant = Math.max(kMin(), Math.min(kMax(), Math.round(zoomCur * dev)));
  // world buffer + light canvas at the most zoomed-out size we can ever ask
  // for, so neither is ever reallocated mid-play; each frame uses the
  // WV_W x WV_H corner. imageSmoothing off on both: the scale-up must be
  // nearest-neighbour or the pixel art turns to soup.
  const wMax = Math.ceil(VIEW_W / ZOOM_FLOOR), hMax = Math.ceil(VIEW_H / ZOOM_FLOOR);
  worldCv.width = wMax; worldCv.height = hMax;
  wctx.imageSmoothingEnabled = false;
  lightCv.width = wMax; lightCv.height = hMax;
  lctx.imageSmoothingEnabled = false;
  sizeWorldView();
  canvas.style.width = (VIEW_W * scale) + 'px';
  canvas.style.height = (VIEW_H * scale) + 'px';
  // bars canvas spans the whole window at the same pixel scale; painted by
  // renderBars() via relayout() (it needs hash2, so never before boot)
  barsCv.width = FULL_W; barsCv.height = VIEW_H;
  barsCv.style.width = (FULL_W * scale) + 'px';
  barsCv.style.height = (VIEW_H * scale) + 'px';
}
window.addEventListener('resize', () => { fitCanvas(); relayout(); });
document.addEventListener('fullscreenchange', () => { fitCanvas(); relayout(); });
fitCanvas();

// Frost-panel art for the pillarbox bars (wider-than-16:9 screens), in the
// game's palette instead of dead black. Purely decorative and deliberately
// darker than the world so the eye stays on the game; the game canvas sits
// on top and covers everything between the bars. Static — baked once per
// canvas size by relayout(), never per frame.
function renderBars() {
  const g = bctx, W = barsCv.width, H = barsCv.height;
  const barW = (W - VIEW_W) / 2;
  if (barW < 2) { g.clearRect(0, 0, W, H); return; }
  const inBar = (x) => x < barW - 1 || x > W - barW - 2;
  // deep night slab
  g.fillStyle = '#050814'; g.fillRect(0, 0, W, H);
  // frost mottling
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      if (!inBar(x)) continue;
      const h = hash2(x * 5 + 7, y * 13 + 3);
      if (h > 0.86) g.fillStyle = '#0b1226';
      else if (h < 0.10) g.fillStyle = '#03050d';
      else continue;
      g.fillRect(x, y, 3, 3);
    }
  }
  // sparse ice crystals, dimmer toward the outer edge
  for (let y = 12; y < H - 20; y += 14) {
    for (let x = 6; x < W - 6; x += 14) {
      if (!inBar(x) || !inBar(x + 5)) continue;
      const h = hash2(x * 3 + 11, y * 7 + 29);
      if (h < 0.86) continue;
      const cx = x + ((hash2(x + 1, y + 1) * 7) | 0) - 3;
      const cy = y + ((hash2(x + 2, y + 5) * 9) | 0) - 4;
      g.fillStyle = h > 0.95 ? '#35426e' : '#1c2646';
      g.fillRect(cx - 2, cy, 5, 1); g.fillRect(cx, cy - 2, 1, 5);
      if (h > 0.95) { g.fillStyle = '#5a7fb8'; g.fillRect(cx, cy, 1, 1); }
    }
  }
  // icicle fringe hanging from the top edge
  for (let x = 0; x < W; x += 4) {
    if (!inBar(x)) continue;
    const h = hash2(x * 9 + 5, 71);
    const len = 2 + ((h * 7) | 0);
    g.fillStyle = '#141c3c'; g.fillRect(x, 0, 2, len);
    g.fillStyle = '#232f52'; g.fillRect(x, 0, 1, len - 1);
    if (h > 0.75) { g.fillStyle = '#35426e'; g.fillRect(x, len - 1, 1, 1); }
  }
  // matching icicle fringe rising from the bottom edge (different hash row
  // so it isn't a literal mirror)
  for (let x = 0; x < W; x += 4) {
    if (!inBar(x)) continue;
    const h = hash2(x * 9 + 5, 113);
    const len = 2 + ((h * 7) | 0);
    g.fillStyle = '#141c3c'; g.fillRect(x, H - len, 2, len);
    g.fillStyle = '#232f52'; g.fillRect(x, H - len + 1, 1, len - 1);
    if (h > 0.75) { g.fillStyle = '#35426e'; g.fillRect(x, H - len, 1, 1); }
  }
  // icy bevel hugging the game view on both sides
  const xL = Math.floor(barW), xR = Math.ceil(W - barW);
  g.fillStyle = '#0a0e23'; g.fillRect(xL - 3, 0, 3, H); g.fillRect(xR, 0, 3, H);
  g.fillStyle = '#141c3c'; g.fillRect(xL - 2, 0, 1, H); g.fillRect(xR + 1, 0, 1, H);
  g.fillStyle = '#35426e'; g.fillRect(xL - 1, 0, 1, H); g.fillRect(xR, 0, 1, H);
}

// scratch canvas for white hit-flash sprites
const scratch = document.createElement('canvas');
scratch.width = 64; scratch.height = 64; // the biggest thing that flashes is the 48x38 bay
const sctx = scratch.getContext('2d');

// offscreen minimap canvas (1px per world tile)
let MM_R = 24;                   // minimap radius in px (1px = 1 tile)
let MM_CX = VIEW_W - 32;         // minimap center
let MM_CY = 40;

// Panel layout anchors. These live here rather than in the map/settings
// sections because relayout() assigns them on every canvas resize —
// declaring them 2800 lines further down left relayout() reaching forward
// into a TDZ, safe only while nothing called it before boot finished. The
// offsets *within* each baked panel stay in their own sections.
const PANEL_W = 308, PANEL_H = 226;
let PANEL_X = Math.round((VIEW_W - PANEL_W) / 2);   // relayout() recenters these
let PANEL_Y = Math.round((VIEW_H - PANEL_H) / 2);
let MAP_X = PANEL_X + 10, MAP_Y = PANEL_Y + 24;     // 192x192 map area
let COL_CX = PANEL_X + 254;                          // right column center
const MAP_W = 192;             // the baked panel's map slot — the world scales into it
const MAP_S = MAP_W / WORLD;   // tiles -> map px

const SET_W = 240, SET_H = 218;
let SET_X = Math.round((VIEW_W - SET_W) / 2);       // relayout() recenters these
let SET_Y = Math.round((VIEW_H - SET_H) / 2);
let SL_X = SET_X + 112;
const SL_W = 66;  // slider track
// Seven rows at a 14px pitch, so the three sound dials fit above the CONTROLS
// divider (still at panel-local 126) without the panel growing: SET_H is
// already close to the 240-row floor fitCanvas() guarantees. Mute is not a
// row of its own - it is the speaker beside the MASTER track (SET_MUTE_X).
let ROW_SOUND = SET_Y + 28, ROW_MUSIC = SET_Y + 42, ROW_SFX = SET_Y + 56, ROW_MAP = SET_Y + 70,
  ROW_SHAKE = SET_Y + 84, ROW_INFO = SET_Y + 98, ROW_CURSOR = SET_Y + 112;
let SET_MUTE_X = SL_X - 14; // the speaker button: 9x9, hard against the master track

const mmCv = document.createElement('canvas');
mmCv.width = WORLD; mmCv.height = WORLD;
const mmCtx = mmCv.getContext('2d');
const mmImg = mmCtx.createImageData(WORLD, WORLD);

