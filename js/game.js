// Emberfrost - a cozy winter survival game.
(function () {
  'use strict';

  // ------------------------------------------------------------ constants
  const TILE = 16;
  const WORLD = 232;                // tiles per side (~132-tile open interior, 2x the old 92's area; treeline depth unchanged)
  const BORDER_MIN = 30, BORDER_MAX = 70; // forest boundary depth range (avg ~50)
  let VIEW_W = 480, VIEW_H = 270; // internal resolution; fitCanvas() sizes it to the window
  let FULL_W = 480; // window width in game px BEFORE the 16:9 cap (bars canvas span)
  const DAY_LEN = 110, NIGHT_LEN = 55;
  const CYCLE = DAY_LEN + NIGHT_LEN;
  const PLAYER_SPEED = 72;
  const PLAYER_R = 4.5;

  // the three infinite tools; the bar is keys 1-3 or scroll wheel
  const TOOLS = [
    { key: 'bow',  name: 'BOW',     icon: 'itemBow' },
    { key: 'axe',  name: 'AXE',     icon: 'itemAxe' },
    { key: 'pick', name: 'PICKAXE', icon: 'itemPick' },
  ];
  const BOW_CHARGE = 0.9;   // seconds to a full draw
  const MELEE_DMG = 6;      // axe/pick vs animals (bow is the real weapon)
  const DODGE_T = 0.28;     // roll duration (s)
  const DODGE_SPEED = 215;  // roll velocity -> ~60px travelled
  const DODGE_CHARGES = 2;
  const DODGE_CD = 3.5;     // seconds to refill one charge

  // momentum (player-only): input accelerates vx/vy, the surface underfoot sets
  // friction and speed caps. Walking on snow is tuned to feel like the old fixed
  // PLAYER_SPEED; everything faster than that is earned via ice, dodges, or sliding.
  const ICE_MAX = 150;      // ice speed cap (~2x walk); holding a direction pumps toward it
  const SLIDE_MIN = 85;     // shift-slide only engages above this speed...
  const SLIDE_EXIT = 55;    // ...and drops out below this one (hysteresis)
  const TRAIL_MIN = 110;    // sliding faster than this carves the snow trail
  const SNOW_TRAIL_LIFE = 3.5; // snow groove lifetime (ice scratches keep the 9s footprint life)
  const SNOW_TRAIL_FADE = 1.4; // fade window at the end of that life: hold crisp, then wipe tail-first

  // ice fishing: the pickaxe opens holes in bare ice, fish swim underneath
  const ICE_HOLE_HITS = 3;   // pickaxe hits to break through
  const HOLE_FALL_DMG = 15;  // falling into open water hurts
  const HOLE_FALL_T = 1.1;   // seconds floundering before climbing back out
  const FISH_COUNT = 30;     // shoal size, topped back up each dawn
  const FISH_CATCH_R = 16;   // bow-fishing: fish must be this close under the player
  const FISH_MARGIN = 6;     // body clearance from snow: soft-steered away, hard-clamped

  // Stump-built structures: right-click a stump, pick from the radial wheel.
  // tiers[0] is what the wheel builds; tiers[1]/[2] cost/buildT are the upgrade
  // price and (already shortened) upgrade construction time.
  const STRUCTS = {
    wall: { name: 'WALL', tiers: [
      { cost: { wood: 4 },  hp: 60,  buildT: 4   },
      { cost: { stone: 6 }, hp: 140, buildT: 2.4 },
      { cost: { gold: 4 },  hp: 300, buildT: 2.4 },
    ]},
    turret: { name: 'TURRET', tiers: [
      { cost: { wood: 8 },   hp: 50,  buildT: 8,   range: 60, dmg: 6,  rate: 1.0  },
      { cost: { stone: 10 }, hp: 90,  buildT: 4.8, range: 76, dmg: 9,  rate: 0.8  },
      { cost: { gold: 6 },   hp: 140, buildT: 4.8, range: 92, dmg: 14, rate: 0.65 },
    ]},
    generator: { name: 'GENERATOR', tiers: [
      { cost: { wood: 10 }, hp: 40,  buildT: 8,   res: 'wood',  period: 10 },
      { cost: { stone: 8 }, hp: 70,  buildT: 4.8, res: 'stone', period: 12 },
      { cost: { gold: 5 },  hp: 100, buildT: 4.8, res: 'gold',  period: 18 },
    ]},
    spawner: { name: 'SPAWNER', tiers: [
      { cost: { wood: 12 },  hp: 60,  buildT: 10, bots: 1, botHp: 18 },
      { cost: { stone: 10 }, hp: 100, buildT: 6,  bots: 2, botHp: 24 },
      { cost: { gold: 8 },   hp: 150, buildT: 6,  bots: 3, botHp: 30 },
    ]},
  };
  const STRUCT_ORDER = ['wall', 'turret', 'generator', 'spawner']; // wheel: up, right, down, left

  // ------------------------------------------------------------ canvas
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // offscreen light canvas (sized by fitCanvas alongside the main canvas)
  const lightCv = document.createElement('canvas');
  const lctx = lightCv.getContext('2d');

  // full-window canvas behind the game: the pillarbox bars' frost frame
  const barsCv = document.getElementById('bars');
  const bctx = barsCv.getContext('2d');

  // One camera for every player (the SC2/LoL model): the view always shows
  // ~TARGET_ROWS rows of world — monitor resolution buys sharpness, never zoom.
  // Heights that don't divide cleanly "breathe" a few percent rather than
  // letterbox or blur (the Terraria/Stardew trade), and width is capped at
  // 16:9 so ultrawides get slim pillarbox bars instead of extra vision.
  const TARGET_ROWS = 270;

  // Scroll-wheel camera zoom: each step raises the integer device-pixel scale
  // by one, so every zoom level stays pixel-perfect. Zoom OUT is capped at the
  // TARGET_ROWS baseline (the fairness ceiling — nobody buys vision), zoom IN
  // at ~MIN_ROWS rows. Overlays and non-play modes render at base zoom so the
  // fixed-size UI panels always fit; update() applies changes via zoomEff.
  const MIN_ROWS = 150;
  let zoomStep = 0;  // player-requested steps above base scale
  let zoomEff = 0;   // currently applied steps
  let zoomMax = 0;   // available steps on this window (set by fitCanvas)

  let scale = 2;
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
    zoomMax = Math.max(0, Math.floor(devH / MIN_ROWS) - dev);
    dev += Math.min(zoomEff, zoomMax);
    scale = dev / dpr; // CSS px per game px; mouse mapping divides by this
    // cover the window exactly: ceil leaves at most one game px of overflow,
    // which the body's flex centering splits and overflow:hidden clips
    VIEW_H = Math.ceil(devH / dev);
    FULL_W = Math.ceil(devW / dev);
    VIEW_W = Math.min(FULL_W, Math.ceil(VIEW_H * 16 / 9));
    canvas.width = VIEW_W; canvas.height = VIEW_H;
    ctx.imageSmoothingEnabled = false; // resizing the canvas resets ctx state
    lightCv.width = VIEW_W; lightCv.height = VIEW_H;
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
  scratch.width = 32; scratch.height = 32;
  const sctx = scratch.getContext('2d');

  // offscreen minimap canvas (1px per world tile)
  let MM_R = 24;                   // minimap radius in px (1px = 1 tile)
  let MM_CX = VIEW_W - 32;         // minimap center
  let MM_CY = 40;
  const mmCv = document.createElement('canvas');
  mmCv.width = WORLD; mmCv.height = WORLD;
  const mmCtx = mmCv.getContext('2d');
  const mmImg = mmCtx.createImageData(WORLD, WORLD);

  // ------------------------------------------------------------ rng
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // one run seed drives every deterministic value: worldgen, per-tile hashes, fx.
  // ?seed=N in the URL replays a world exactly.
  const SEED = (function () {
    const q = /[?&]seed=([0-9]+)/.exec(location.search);
    if (q) return (parseInt(q[1], 10) >>> 0) || 1;
    return ((Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0) || 1;
  })();
  const SEED_TXT = 'SEED ' + SEED;
  const rng = mulberry32(SEED);
  function rand(a, b) { return a + rng() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b + 1)); }

  // ------------------------------------------------------------ state
  const state = {
    mode: 'title', // title | play | dead
    time: DAY_LEN * 0.25, // start mid-morning
    elapsed: 0,
    day: 1,
    darkness: 0,
    shake: 0,
    deadTimer: 0,
    msg: null, msgT: 0,
    toolMsgT: 0, // tool name flash above the bar after switching
    hints: { stump: false },
    paused: false,
    mapOpen: false,
    settingsOpen: false,
    wheel: null, // radial menu: { kind: 'build'|'manage', tx, ty, seg }
  };

  const settings = { volume: 0.5, mmR: 24, shake: true, muted: false, fps: false };

  // performance monitor: fps averaged over half-second windows from raw
  // (unclamped) frame deltas, so sim clamping can't mask slow frames
  const perf = { fps: 0, frames: 0, acc: 0 };

  function saveSettings() {
    try { localStorage.setItem('emberfrost.settings', JSON.stringify(settings)); } catch (e) { }
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('emberfrost.settings'));
      if (s) Object.assign(settings, s);
    } catch (e) { }
  }
  function applyMinimapSize() {
    MM_R = settings.mmR;
    MM_CX = VIEW_W - MM_R - 8;
    MM_CY = MM_R + 16;
  }
  // recompute everything positioned off VIEW_W/VIEW_H; must run after any
  // change to the canvas size (window resize, fullscreen)
  function relayout() {
    applyMinimapSize();
    PANEL_X = Math.round((VIEW_W - PANEL_W) / 2);
    PANEL_Y = Math.round((VIEW_H - PANEL_H) / 2);
    MAP_X = PANEL_X + 10; MAP_Y = PANEL_Y + 24;
    COL_CX = PANEL_X + 254;
    SET_X = Math.round((VIEW_W - SET_W) / 2);
    SET_Y = Math.round((VIEW_H - SET_H) / 2);
    SL_X = SET_X + 112;
    ROW_SOUND = SET_Y + 28; ROW_MUTE = SET_Y + 44; ROW_MAP = SET_Y + 60;
    ROW_SHAKE = SET_Y + 76; ROW_FPS = SET_Y + 92;
    fitFlakes();
    renderBars();
  }

  const player = {
    x: (WORLD / 2 + 0.5) * TILE, y: (WORLD / 2 + 0.5) * TILE,
    vx: 0, vy: 0,
    dir: 'down', moving: false, animT: 0,
    hp: 100, maxHp: 100,
    charging: false, chargeT: 0, // bow draw state
    dodgeT: 0, dodgeVX: 0, dodgeVY: 0, dodgeDustT: 0, // active roll
    dodgeCharges: 2, dodgeRegenT: 0,
    stamGhost: 0, stamGhostT: 0, // spent-stamina ghost: lingers, then drains
    sliding: false, slideT: 0, trailD: 0, slideDustT: 0, // shift-slide state
    swingT: 0, swingCd: 0, swingDir: 0, swingHitDone: false,
    hurtT: 0, invuln: 0,
    fallT: 0, fallRipT: 0, // floundering in an ice hole
    footT: 0, footSide: 0,
  };

  const inv = { wood: 0, stone: 0, berry: 0, gold: 0, fish: 0 };
  let tool = 1; // selected TOOLS index, axe by default

  const animals = []; // passive wildlife: rabbits and deer, spawned once at boot
  const structures = []; // every stump-built tiered building (walls included)
  const robots = []; // spawner-owned wooden units
  const tracers = []; // turret shot lines: {x0,y0,x1,y1,t}
  const arrows = []; // live bow shots: {x,y,vx,vy,t,life,dmg,pow}
  const drops = [];
  const particles = [];
  const floaters = [];
  const footprints = [];
  const lights = []; // rebuilt from placed objects
  const fish = []; // swimmers under the ice: {x,y,a,spd,t,turnT,spook}
  const iceCracks = new Map(); // tile idx -> pickaxe hits taken (cracked, not yet open)
  const holes = []; // tile idx of open water holes; they refreeze each dawn

  // ------------------------------------------------------------ input
  const keys = {};
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false };

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (state.mode !== 'play') return;
    if (e.key >= '1' && e.key <= '3') selectTool(+e.key - 1);
    if (e.key === ' ') tryDodge();
    if (e.key.toLowerCase() === 'q') eatBerry();
    if (e.key.toLowerCase() === 'f') eatFish();
    if (e.key.toLowerCase() === 'm' && !state.settingsOpen) { state.wheel = null; state.mapOpen = !state.mapOpen; }
    if (e.key.toLowerCase() === 'escape') {
      if (state.wheel) state.wheel = null;
      else if (state.mapOpen) state.mapOpen = false;
      else { state.settingsOpen = !state.settingsOpen; dragSlider = null; state.wheel = null; }
    }
    if (e.key.toLowerCase() === 'n') { settings.muted = SFX.toggleMute(); saveSettings(); }
    if (e.key.toLowerCase() === 'p') state.paused = !state.paused;
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / scale;
    mouse.y = (e.clientY - r.top) / scale;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      if (state.mode !== 'play' || state.mapOpen || state.settingsOpen || state.wheel) return;
      SFX.unlock();
      const tx = Math.floor((mouse.x + camX) / TILE), ty = Math.floor((mouse.y + camY) / TILE);
      const o = objAt(tx, ty);
      if (!o) return;
      if (Math.hypot(tx * TILE + 8 - player.x, ty * TILE + 8 - player.y) > 60) { SFX.deny(); return; }
      if (o.type === 'stump') state.wheel = { kind: 'build', tx, ty, seg: -1 };
      else if (STRUCTS[o.type] && !o.building) state.wheel = { kind: 'manage', tx, ty, seg: -1 };
      return;
    }
    if (e.button !== 0) return;
    if (state.mode === 'title') { startGame(); return; }
    if (state.mode !== 'play') return;
    if (state.wheel) return;
    if (state.settingsOpen) { mouse.down = true; settingsMouseDown(); return; }
    if (state.mapOpen) return;
    mouse.down = true;
    clickAction();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2 && state.wheel) { resolveWheel(); state.wheel = null; return; }
    if (e.button === 0 && player.charging) {
      player.charging = false;
      if (state.mode === 'play' && !state.paused && !state.mapOpen && !state.settingsOpen && !state.wheel) fireArrow();
      player.chargeT = 0;
    }
    if (dragSlider) { saveSettings(); SFX.pickup(); }
    mouse.down = false;
    dragSlider = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    if (state.mode !== 'play') return;
    e.preventDefault();
    if (state.mapOpen || state.settingsOpen || state.wheel) return;
    // scroll up = zoom in, scroll down = back out toward the 270-row baseline
    zoomStep = Math.max(0, Math.min(zoomMax, zoomStep + (e.deltaY > 0 ? -1 : 1)));
  }, { passive: false });

  function selectTool(i) {
    if (i === tool) return;
    if (player.charging) { player.charging = false; player.chargeT = 0; } // swapping drops the draw
    tool = i;
    state.toolMsgT = 1.4;
  }

  // ------------------------------------------------------------ world
  const ground = new Uint8Array(WORLD * WORLD); // 0 snow, 1 ice, 2 hole (open water)
  const objects = new Array(WORLD * WORLD).fill(null);

  function idx(tx, ty) { return ty * WORLD + tx; }
  function inWorld(tx, ty) { return tx >= 0 && ty >= 0 && tx < WORLD && ty < WORLD; }
  function objAt(tx, ty) { return inWorld(tx, ty) ? objects[idx(tx, ty)] : null; }

  function isSolidTile(tx, ty) {
    if (!inWorld(tx, ty)) return true;
    const o = objects[idx(tx, ty)];
    if (!o) return false;
    return o.type === 'tree' || o.type === 'rock' || o.type === 'wall' ||
      o.type === 'goldore' ||
      o.type === 'turret' || o.type === 'generator' || o.type === 'spawner';
  }

  function placeObj(tx, ty, type, extra) {
    const o = Object.assign({ type, tx, ty, hp: 1, flash: 0, shake: 0 }, extra || {});
    objects[idx(tx, ty)] = o;
    return o;
  }

  const cx = WORLD / 2, cy = WORLD / 2;

  // four quadrant spawn pockets (FFA start positions); player takes slot 0
  const SPAWN_D = WORLD / 2 - 55;  // camps keep their 55-tile distance from the world edge (nestled at the treeline)
  const spawnPts = [
    { tx: cx - SPAWN_D, ty: cy - SPAWN_D }, { tx: cx + SPAWN_D, ty: cy - SPAWN_D },
    { tx: cx - SPAWN_D, ty: cy + SPAWN_D }, { tx: cx + SPAWN_D, ty: cy + SPAWN_D },
  ];
  const playerSpawn = spawnPts[0];
  const oreSpots = []; // gold ore positions at the world center, respawned each dawn

  // depth of the forest boundary at a given tile: smooth irregular inner edge,
  // always solid from the world edge inward (variation eats into the interior)
  function borderDepth(tx, ty) {
    let n = vnoise(tx / 22, ty / 22) * 0.65 + vnoise(tx / 9 + 40, ty / 9 + 40) * 0.35;
    n = Math.max(0, Math.min(1, (n - 0.5) * 1.6 + 0.5)); // stretch toward full range
    return BORDER_MIN + (BORDER_MAX - BORDER_MIN) * n;
  }

  // per-tile rare-drop roll for trees: hash-based, so it stays stable for a tile
  // regardless of generation order, and reshuffles with the run seed
  const TREE_RARE_CHANCE = 0.08;
  function treeRare(tx, ty) {
    const h = hash2(tx * 5 + 11, ty * 7 + 23);
    if (h >= TREE_RARE_CHANCE) return null;
    return h / TREE_RARE_CHANCE < 0.3 ? 'gold' : 'stone'; // gold is the scarcer slice
  }

  function genWorld() {
    // solid irregular forest boundary - players carve their base out of this
    for (let ty = 0; ty < WORLD; ty++) {
      for (let tx = 0; tx < WORLD; tx++) {
        const d = Math.min(tx, ty, WORLD - 1 - tx, WORLD - 1 - ty);
        if (d < borderDepth(tx, ty)) placeObj(tx, ty, 'tree', { hp: 4, variant: randi(0, 1), rare: treeRare(tx, ty) });
      }
    }

    // spawn pockets: clearings carved into the forest for each start position
    for (const p of spawnPts) {
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
        const tx = p.tx + dx, ty = p.ty + dy;
        if (!inWorld(tx, ty)) continue;
        if (Math.hypot(dx, dy) <= 6.5 + (hash2(tx, ty) - 0.5) * 2) objects[idx(tx, ty)] = null;
      }
    }

    // central gold-ore field; CENTER_R keeps other worldgen from crowding it
    const CENTER_R = 8;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + rand(-0.25, 0.25);
      const d2 = rand(3.6, 6.2);
      const tx = Math.round(cx + Math.cos(a) * d2);
      const ty = Math.round(cy + Math.sin(a) * d2);
      if (inWorld(tx, ty) && !objects[idx(tx, ty)]) {
        placeObj(tx, ty, 'goldore', { hp: 6, maxHp: 6 });
        oreSpots.push({ tx, ty });
      }
    }

    // frozen ponds - carved only into the open snow interior, away from spawns
    const nearAnySpawn = (tx, ty, r) => spawnPts.some((p) => Math.hypot(tx - p.tx, ty - p.ty) < r);
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

    // frozen rivers: winding ~5-tile-wide ribbons that link each camp to the
    // central ore field plus a ring around it — ice is the map's travel network.
    // Same carve rules as the ponds, so rivers gap politely around camps, the
    // ore field, and anything already standing (border trees leave natural gaps).
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
    for (const p of spawnPts) carveRiver(p.tx, p.ty, cx, cy); // spokes
    carveRiver(spawnPts[0].tx, spawnPts[0].ty, spawnPts[1].tx, spawnPts[1].ty); // ring
    carveRiver(spawnPts[1].tx, spawnPts[1].ty, spawnPts[3].tx, spawnPts[3].ty);
    carveRiver(spawnPts[3].tx, spawnPts[3].ty, spawnPts[2].tx, spawnPts[2].ty);
    carveRiver(spawnPts[2].tx, spawnPts[2].ty, spawnPts[0].tx, spawnPts[0].ty);

    function free(tx, ty) {
      return inWorld(tx, ty) && !objects[idx(tx, ty)] && ground[idx(tx, ty)] === 0;
    }
    function nearSpawn(tx, ty) {
      return spawnPts.some((p) => Math.hypot(tx - p.tx, ty - p.ty) < 8);
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

    // guaranteed starter ring at the player's spawn pocket
    const ring = [
      ['rock', 4, 4], ['rock', -4, 5],
      ['bush', 3, -5], ['bush', -3, -5],
    ];
    for (const [type, dx, dy] of ring) {
      const tx = playerSpawn.tx + dx, ty = playerSpawn.ty + dy;
      if (free(tx, ty)) {
        if (type === 'rock') placeObj(tx, ty, 'rock', { hp: 5, variant: randi(0, 1) });
        if (type === 'bush') placeObj(tx, ty, 'bush', { berries: 2, regrow: 0 });
      }
    }
  }

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

  // ------------------------------------------------------------ helpers
  function showMsg(t, dur) { state.msg = t; state.msgT = dur || 5; }

  function addFloater(x, y, txt, color) {
    floaters.push({ x, y, txt, color: color || '#ffffff', t: 0 });
  }

  // combat damage numbers: gold for damage the player's side deals, red '-N'
  // for damage taken. Heavy hits (10+) render at 2x; a little random drift
  // keeps rapid repeat hits from stacking into one unreadable pile.
  function addDmgFloater(x, y, amount, taken) {
    const n = Math.max(1, Math.round(amount));
    floaters.push({
      x: x + rand(-3, 3), y,
      txt: taken ? '-' + n : String(n),
      color: taken ? '#ff6a5a' : '#ffd95c',
      t: 0, vx: rand(-9, 9), scale: n >= 10 ? 2 : 1, rise: 20,
    });
  }

  function burst(x, y, color, n, spd, life, grav) {
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, s = rand(0.3, 1) * (spd || 40);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7 - (grav ? 20 : 0),
        life: rand(0.5, 1) * (life || 0.5), maxLife: 1, color, size: rng() < 0.3 ? 2 : 1, grav: grav ? 90 : 0,
      });
    }
  }

  function spawnDrop(x, y, type) {
    const a = rng() * Math.PI * 2;
    drops.push({ x, y, vx: Math.cos(a) * rand(20, 45), vy: Math.sin(a) * rand(20, 45) - 30, z: 0, vz: rand(30, 60), type, t: 0 });
  }

  function canAfford(cost) { for (const k in cost) if ((inv[k] || 0) < cost[k]) return false; return true; }
  function pay(cost) { for (const k in cost) inv[k] -= cost[k]; }
  function costText(cost) {
    const parts = [];
    for (const k in cost) if (cost[k] > 0) parts.push(cost[k] + ' ' + k.toUpperCase());
    return parts.join('  ');
  }

  function eatBerry() {
    if (inv.berry <= 0 || player.hp >= player.maxHp) return;
    inv.berry--;
    player.hp = Math.min(player.maxHp, player.hp + 20);
    SFX.eat(); setTimeout(() => SFX.heal(), 90);
    addFloater(player.x, player.y - 14, '+20', '#8fe08a');
    burst(player.x, player.y - 8, '#f2707a', 6, 30, 0.4);
  }

  function eatFish() {
    if (inv.fish <= 0 || player.hp >= player.maxHp) return;
    inv.fish--;
    player.hp = Math.min(player.maxHp, player.hp + 50);
    SFX.eat(); setTimeout(() => SFX.heal(), 90);
    addFloater(player.x, player.y - 14, '+50', '#8fe08a');
    burst(player.x, player.y - 8, '#7ac0e8', 6, 30, 0.4);
  }

  // ------------------------------------------------------------ movement & collision
  function moveEntity(e, dx, dy, r) {
    // everyone but the player treats open water holes as walls - animals and
    // robots never wade in; the player falls in instead (handled in updatePlay)
    const solid = e === player ? isSolidTile :
      (tx, ty) => isSolidTile(tx, ty) || (inWorld(tx, ty) && ground[idx(tx, ty)] === 2);
    let blockedX = false, blockedY = false;
    // X axis
    if (dx !== 0) {
      const nx = e.x + dx;
      const x0 = Math.floor((nx - r) / TILE), x1 = Math.floor((nx + r) / TILE);
      const y0 = Math.floor((e.y - r) / TILE), y1 = Math.floor((e.y + r) / TILE);
      let hit = false;
      for (let ty = y0; ty <= y1; ty++) {
        const tx = dx > 0 ? x1 : x0;
        if (solid(tx, ty)) hit = true;
      }
      if (!hit) e.x = nx; else blockedX = true;
    }
    // Y axis
    if (dy !== 0) {
      const ny = e.y + dy;
      const y0 = Math.floor((ny - r) / TILE), y1 = Math.floor((ny + r) / TILE);
      const x0 = Math.floor((e.x - r) / TILE), x1 = Math.floor((e.x + r) / TILE);
      let hit = false;
      for (let tx = x0; tx <= x1; tx++) {
        const ty = dy > 0 ? y1 : y0;
        if (solid(tx, ty)) hit = true;
      }
      if (!hit) e.y = ny; else blockedY = true;
    }
    return { blockedX, blockedY };
  }

  // ------------------------------------------------------------ actions
  function clickAction() {
    SFX.unlock();
    if (player.sliding || player.fallT > 0) return; // no tool use mid-slide or in the water
    if (TOOLS[tool].key === 'bow') {
      if (!player.charging) { player.charging = true; player.chargeT = 0; SFX.bowDraw(); }
    } else {
      trySwing();
    }
  }

  // dodge roll: dash with i-frames in the held movement direction (8-way),
  // falling back to the facing direction when no key is down
  function tryDodge() {
    if (state.paused || state.mapOpen || state.settingsOpen || state.wheel) return;
    if (player.dodgeT > 0 || player.dodgeCharges <= 0 || player.fallT > 0) return;
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy -= 1;
    if (keys['s'] || keys['arrowdown']) dy += 1;
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
    if (!dx && !dy) {
      dx = player.dir === 'left' ? -1 : player.dir === 'right' ? 1 : 0;
      dy = player.dir === 'up' ? -1 : player.dir === 'down' ? 1 : 0;
    }
    const d = Math.hypot(dx, dy) || 1;
    // impulse into the shared velocity: a dash never slows you below the speed
    // you already carry, so on ice dashes chain into real speed
    const v = Math.max(DODGE_SPEED, Math.hypot(player.vx, player.vy));
    player.dodgeVX = dx / d * v; // kept for the roll spin/ghost render
    player.dodgeVY = dy / d * v;
    player.vx = player.dodgeVX;
    player.vy = player.dodgeVY;
    player.dodgeT = DODGE_T;
    player.dodgeDustT = 0;
    // remember the fill level before the spend so the bar can ghost the lost chunk
    const regenP = player.dodgeCharges < DODGE_CHARGES ? 1 - player.dodgeRegenT / DODGE_CD : 0;
    player.stamGhost = Math.max(player.stamGhost, (player.dodgeCharges + regenP) / DODGE_CHARGES);
    player.stamGhostT = 0.3;
    player.dodgeCharges--;
    if (player.dodgeRegenT <= 0) player.dodgeRegenT = DODGE_CD;
    player.invuln = Math.max(player.invuln, DODGE_T + 0.05);
    player.kbx = player.kby = 0;
    if (Math.abs(dx) > Math.abs(dy)) player.dir = dx > 0 ? 'right' : 'left';
    else if (dy !== 0) player.dir = dy > 0 ? 'down' : 'up';
    burst(player.x, player.y + 4, '#dfe8f4', 6, 40, 0.35, true);
    SFX.dodge();
  }

  function fireArrow() {
    // bow-fishing: standing on ice with a fish right underfoot spears it
    // through the sheet instead of loosing the arrow
    const ftx = Math.floor(player.x / TILE), fty = Math.floor((player.y + 4) / TILE);
    if (inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1) {
      let bi = -1, bd = FISH_CATCH_R;
      for (let i = 0; i < fish.length; i++) {
        const d = Math.hypot(fish[i].x - player.x, fish[i].y - player.y);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi >= 0) {
        const f = fish[bi];
        fish.splice(bi, 1);
        inv.fish++;
        addFloater(f.x, f.y - 10, 'FISH!', '#7ac0e8');
        burst(f.x, f.y, '#9fc4dd', 8, 45, 0.45, true);
        burst(f.x, f.y, '#ddf1f8', 5, 35, 0.4, true);
        SFX.splash();
        SFX.pickup();
        return;
      }
    }
    const p = Math.min(1, Math.max(0.18, player.chargeT / BOW_CHARGE));
    const dx = mouse.x + camX - player.x;
    const dy = mouse.y + camY - player.y;
    const d = Math.hypot(dx, dy) || 1;
    const spd = 170 + 190 * p;
    arrows.push({
      x: player.x, y: player.y - 6,
      vx: dx / d * spd, vy: dy / d * spd,
      t: 0, life: 0.85, dmg: Math.round(4 + 9 * p), pow: p,
    });
    if (Math.abs(dx) > Math.abs(dy)) player.dir = dx > 0 ? 'right' : 'left';
    else player.dir = dy > 0 ? 'down' : 'up';
    SFX.arrow();
  }

  function trySwing() {
    if (player.swingCd > 0) return;
    const dx = mouse.x + camX - player.x;
    const dy = mouse.y + camY - player.y;
    player.swingDir = Math.atan2(dy, dx);
    if (Math.abs(dx) > Math.abs(dy)) player.dir = dx > 0 ? 'right' : 'left';
    else player.dir = dy > 0 ? 'down' : 'up';
    player.swingT = 0.18;
    player.swingCd = 0.34;
    player.swingHitDone = false;
    SFX.swing();
  }

  function swingHit() {
    const reachX = player.x + Math.cos(player.swingDir) * 12;
    const reachY = player.y + Math.sin(player.swingDir) * 12;

    // 1) animals first
    let hitSomething = false;
    for (const a of animals) {
      if (Math.hypot(a.x - reachX, a.y - reachY) < 13) {
        a.hp -= MELEE_DMG;
        a.flash = 0.12;
        addDmgFloater(a.x, a.y - 12, MELEE_DMG);
        a.fleeT = a.kind === 'rabbit' ? 1.4 : 2.2;
        const kb = 70;
        a.kbx = Math.cos(player.swingDir) * kb;
        a.kby = Math.sin(player.swingDir) * kb;
        burst(a.x, a.y - 4, a.kind === 'rabbit' ? '#eef2fa' : '#a5825a', 6, 40, 0.4);
        SFX.hit();
        hitSomething = true;
      }
    }
    if (hitSomething) return;

    // 2) resources / structures: check tiles near reach point
    let best = null, bestD = 14;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = Math.floor(reachX / TILE) + dx, ty = Math.floor(reachY / TILE) + dy;
      const o = objAt(tx, ty);
      if (!o || o.type === 'stump') continue;
      const ox = tx * TILE + 8, oy = ty * TILE + 8;
      const d = Math.hypot(ox - reachX, oy - reachY);
      if (d < bestD) { best = o; bestD = d; }
    }
    if (!best) {
      // 3) pickaxe on bare ice: crack it toward a fishing hole
      if (TOOLS[tool].key === 'pick') {
        const tx = Math.floor(reachX / TILE), ty = Math.floor(reachY / TILE);
        if (inWorld(tx, ty) && ground[idx(tx, ty)] === 1) crackIce(tx, ty);
      }
      return;
    }
    hitObject(best);
  }

  function crackIce(tx, ty) {
    const i = idx(tx, ty);
    const px = tx * TILE + 8, py = ty * TILE + 8;
    const hits = (iceCracks.get(i) || 0) + 1;
    SFX.mine();
    burst(px, py, '#ddf1f8', 6, 45, 0.4, true);
    if (hits >= ICE_HOLE_HITS) {
      // broken through: the tile becomes open water
      iceCracks.delete(i);
      ground[i] = 2;
      holes.push(i);
      repaintGround(tx, ty);
      SFX.splash();
      state.shake = Math.max(state.shake, 2);
      burst(px, py, '#3a6080', 10, 50, 0.5, true);
      burst(px, py, '#ddf1f8', 8, 55, 0.5, true);
      // the noise sends nearby fish darting away
      for (const f of fish) {
        if (Math.hypot(f.x - px, f.y - py) < 40) {
          f.a = Math.atan2(f.y - py, f.x - px);
          f.spook = 1.2;
        }
      }
    } else {
      iceCracks.set(i, hits);
    }
  }

  // nearest tile the player can stand on - used to climb out of a hole
  function nearestDryTile(x, y) {
    const ctx0 = Math.floor(x / TILE), cty0 = Math.floor(y / TILE);
    for (let r = 1; r <= 8; r++) {
      let best = null, bd = 1e9;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = ctx0 + dx, ty = cty0 + dy;
        if (!inWorld(tx, ty) || ground[idx(tx, ty)] === 2 || isSolidTile(tx, ty)) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = { tx, ty }; }
      }
      if (best) return best;
    }
    return playerSpawn;
  }

  function hitObject(o) {
    const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
    // hard tool gating: the wrong tool bounces off instead of harvesting
    const k = TOOLS[tool].key;
    if ((o.type === 'tree' && k !== 'axe') ||
        ((o.type === 'rock' || o.type === 'goldore') && k !== 'pick')) {
      SFX.deny();
      addFloater(ox, oy - 14, o.type === 'tree' ? 'NEEDS AXE' : 'NEEDS PICKAXE', '#9fb6d8');
      return;
    }
    o.flash = 0.1;
    o.shake = 0.22;
    if (o.type === 'tree') {
      o.hp--;
      SFX.chop();
      spawnDrop(ox, oy, 'wood');
      burst(ox, oy - 10, '#eef4fb', 6, 40, 0.5, true);
      burst(ox, oy - 12, '#3f7a5c', 3, 30, 0.4, true);
      if (o.hp <= 0) {
        objects[idx(o.tx, o.ty)] = { type: 'stump', tx: o.tx, ty: o.ty, flash: 0, shake: 0 };
        SFX.treeFall();
        state.shake = Math.max(state.shake, 2.5);
        if (!state.hints.stump) {
          state.hints.stump = true;
          showMsg('RIGHT CLICK THE STUMP TO BUILD ON IT', 5);
        }
        spawnDrop(ox, oy, 'wood'); spawnDrop(ox, oy, 'wood');
        burst(ox, oy - 8, '#eef4fb', 14, 55, 0.7, true);
        burst(ox, oy - 8, '#2f5c4b', 8, 45, 0.6, true);
        if (o.rare) {
          const rc = o.rare === 'gold' ? '#f2cc6a' : '#a8b0c4';
          spawnDrop(ox, oy, o.rare); spawnDrop(ox, oy, o.rare);
          burst(ox, oy - 8, rc, 10, 50, 0.6, true);
          addFloater(ox, oy - 18, o.rare === 'gold' ? 'GOLD!' : 'STONE!', rc);
          SFX.pickup();
        }
      }
    } else if (o.type === 'rock') {
      o.hp--;
      SFX.mine();
      spawnDrop(ox, oy, 'stone');
      burst(ox, oy - 4, '#a8b0c4', 6, 45, 0.4, true);
      if (o.hp <= 0) {
        objects[idx(o.tx, o.ty)] = null;
        SFX.break_();
        state.shake = Math.max(state.shake, 2);
        spawnDrop(ox, oy, 'stone'); spawnDrop(ox, oy, 'stone');
        burst(ox, oy - 4, '#8b93a8', 12, 55, 0.6, true);
      }
    } else if (o.type === 'goldore') {
      o.hp--;
      SFX.mine();
      spawnDrop(ox, oy, 'gold');
      burst(ox, oy - 4, '#f2cc6a', 6, 45, 0.4, true);
      if (o.hp <= 0) {
        objects[idx(o.tx, o.ty)] = null;
        SFX.break_();
        state.shake = Math.max(state.shake, 2);
        spawnDrop(ox, oy, 'gold'); spawnDrop(ox, oy, 'gold');
        burst(ox, oy - 4, '#d8a850', 12, 55, 0.6, true);
      }
    } else if (o.type === 'bush') {
      if (o.berries > 0) {
        o.berries = 0;
        o.regrow = 70;
        SFX.pickup();
        spawnDrop(ox, oy, 'berry'); spawnDrop(ox, oy, 'berry');
        burst(ox, oy - 4, '#4c8560', 5, 35, 0.4, true);
      } else {
        SFX.swing();
      }
    } else if (STRUCTS[o.type]) {
      o.hp -= 10;
      SFX.hit();
      burst(ox, oy - 4, '#a3794f', 5, 40, 0.4, true);
      if (o.hp <= 0) destroyStructure(o, true);
    }
  }

  function destroyStructure(o, refund) {
    if (STRUCTS[o.type]) removeStruct(o);
    else objects[idx(o.tx, o.ty)] = null;
    const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
    SFX.break_();
    burst(ox, oy, '#8a6142', 10, 50, 0.5, true);
    burst(ox, oy, '#eef4fb', 6, 40, 0.5, true);
    if (refund && STRUCTS[o.type]) {
      // 50% of everything paid across tiers
      const c = cumulativeCost(o.type, o.tier);
      for (const k in c) for (let i = 0; i < Math.floor(c[k] / 2); i++) spawnDrop(ox, oy, k);
    }
    rebuildLights();
  }

  // ------------------------------------------------------------ stump structures
  function cumulativeCost(type, tier) {
    const total = {};
    for (let t = 0; t <= tier; t++) {
      const c = STRUCTS[type].tiers[t].cost;
      for (const k in c) total[k] = (total[k] || 0) + c[k];
    }
    return total;
  }

  function placeStruct(tx, ty, type) {
    const site = objAt(tx, ty);
    if (!site || site.type !== 'stump') { SFX.deny(); return; }
    const cxp = tx * TILE + 8, cyp = ty * TILE + 8;
    if (Math.hypot(cxp - player.x, cyp - player.y) > 60) { SFX.deny(); return; }
    // all four buildings are solid - never let the player entomb themselves
    if (Math.abs(cxp - player.x) < 8 + PLAYER_R && Math.abs(cyp - player.y) < 8 + PLAYER_R) {
      SFX.deny();
      showMsg('STEP OFF THE STUMP FIRST', 1.6);
      return;
    }
    const t0 = STRUCTS[type].tiers[0];
    if (!canAfford(t0.cost)) {
      SFX.deny();
      showMsg('NOT ENOUGH RESOURCES', 1.6);
      return;
    }
    pay(t0.cost);
    const o = placeObj(tx, ty, type, {
      tier: 0, hp: Math.ceil(t0.hp * 0.3), maxHp: t0.hp,
      building: true, buildT: 0, buildTotal: t0.buildT, dustT: 0,
    });
    if (type === 'turret') o.cd = 0;
    if (type === 'generator') o.payT = 0;
    if (type === 'spawner') { o.mode = 'gather'; o.bots = []; o.respawnT = 0; }
    structures.push(o);
    SFX.place();
    burst(cxp, cyp, '#eef4fb', 8, 40, 0.4, true);
  }

  function startUpgrade(o) {
    if (o.building) return;
    if (o.tier >= 2) { SFX.deny(); showMsg('MAX TIER', 1.4); return; }
    const t = STRUCTS[o.type].tiers[o.tier + 1];
    if (!canAfford(t.cost)) {
      SFX.deny();
      showMsg('NOT ENOUGH RESOURCES', 1.6);
      return;
    }
    pay(t.cost);
    o.tier++;
    o.maxHp = t.hp;
    o.building = true;
    o.buildT = 0;
    o.buildTotal = t.buildT;
    o.dustT = 0;
    SFX.place();
    burst(o.tx * TILE + 8, o.ty * TILE + 8, '#eef4fb', 8, 40, 0.4, true);
  }

  function demolishStruct(o) {
    destroyStructure(o, true);
  }

  function removeStruct(o) {
    objects[idx(o.tx, o.ty)] = null;
    const i = structures.indexOf(o);
    if (i >= 0) structures.splice(i, 1);
    if (o.bots) for (const b of o.bots) {
      if (!b.dead) {
        b.dead = true;
        burst(b.x, b.y - 4, '#8a6142', 8, 45, 0.5, true);
      }
    }
  }

  function rebuildLights() {
    // nothing currently emits light (campfires/torches went with the old hotbar);
    // kept as the single rebuild point for any future glowing object type
    lights.length = 0;
  }

  // ------------------------------------------------------------ animals
  function makeAnimal(kind, x, y) {
    const hp = kind === 'rabbit' ? 8 : 24;
    return {
      kind, x, y, hp, maxHp: hp,
      dir: rng() < 0.5 ? 'left' : 'right',
      moveT: 0, idleT: rand(0.5, 2.5), mvx: 0, mvy: 0, moving: false,
      animT: rng() * 2, flash: 0, kbx: 0, kby: 0, fleeT: 0, jinkA: 0,
      dead: false,
    };
  }

  function spawnAnimals() {
    const bushes = [];
    for (const o of objects) if (o && o.type === 'bush') bushes.push(o);
    const freeSpot = (tx, ty) =>
      inWorld(tx, ty) && !objects[idx(tx, ty)] &&
      Math.hypot(tx - cx, ty - cy) > 14;
    const place = (kind, nearBushes) => {
      for (let tries = 0; tries < 40; tries++) {
        let tx, ty;
        if (nearBushes && bushes.length && rng() < 0.7) {
          const b = bushes[randi(0, bushes.length - 1)];
          tx = b.tx + randi(-4, 4); ty = b.ty + randi(-4, 4);
        } else {
          tx = randi(BORDER_MIN + 2, WORLD - 3 - BORDER_MIN);
          ty = randi(BORDER_MIN + 2, WORLD - 3 - BORDER_MIN);
        }
        if (!freeSpot(tx, ty)) continue;
        animals.push(makeAnimal(kind, (tx + 0.5) * TILE, (ty + 0.5) * TILE));
        return;
      }
    };
    for (let i = 0; i < 16; i++) place('rabbit', true);
    for (let i = 0; i < 10; i++) place('deer', false);
  }

  // ------------------------------------------------------------ fish
  // passive swimmers that live under the frozen water, visible as silhouettes
  // through the ice; the bow spears one when it's right under the player
  function addFish(x, y) {
    fish.push({
      x, y, a: rand(0, Math.PI * 2), spd: rand(9, 18), t: rand(0, 9), turnT: rand(1, 3),
      spook: 0, ts: rng() < 0.5 ? -1 : 1, // preferred turn direction at a dead end
    });
  }

  function fishWater(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return inWorld(tx, ty) && ground[idx(tx, ty)] !== 0;
  }
  // the whole body fits in water with margin px to spare on every side, so a
  // fish never reads as poking into the snow
  function fishClear(x, y, margin) {
    const m = margin || FISH_MARGIN;
    return fishWater(x - m, y) && fishWater(x + m, y) &&
      fishWater(x, y - m) && fishWater(x, y + m);
  }

  function spawnFish(minPlayerDist) {
    const spots = [];
    for (let i = 0; i < WORLD * WORLD; i++) {
      if (ground[i] !== 1) continue;
      const x = (i % WORLD + 0.5) * TILE, y = ((i / WORLD | 0) + 0.5) * TILE;
      if (fishClear(x, y, 14)) spots.push(i); // interior ice only, ~a tile off the shore
    }
    let guard = 0;
    while (fish.length < FISH_COUNT && spots.length && guard++ < 400) {
      const i = spots[randi(0, spots.length - 1)];
      const x = (i % WORLD + 0.5) * TILE, y = ((i / WORLD | 0) + 0.5) * TILE;
      if (minPlayerDist && Math.hypot(x - player.x, y - player.y) < minPlayerDist) continue;
      addFish(x, y);
    }
  }

  function updateFish(dt) {
    for (const f of fish) {
      f.t += dt;
      f.spook = Math.max(0, f.spook - dt);
      f.turnT -= dt;
      if (f.turnT <= 0) { f.turnT = rand(1, 3); f.a += rand(-1.1, 1.1); }
      const spd = f.spd * (f.spook > 0 ? 3 : 1);
      // soft edge cap: veer away well before the shore, turning toward
      // whichever side opens into water (falling back to the fish's own bias)
      if (!fishClear(f.x + Math.cos(f.a) * 10, f.y + Math.sin(f.a) * 10)) {
        const L = fishClear(f.x + Math.cos(f.a + 0.9) * 10, f.y + Math.sin(f.a + 0.9) * 10);
        const R = fishClear(f.x + Math.cos(f.a - 0.9) * 10, f.y + Math.sin(f.a - 0.9) * 10);
        f.a += (L === R ? f.ts : L ? 1 : -1) * 5 * dt;
      }
      // hard clamp: never commit a position whose body margin touches snow
      const nx = f.x + Math.cos(f.a) * spd * dt, ny = f.y + Math.sin(f.a) * spd * dt;
      if (fishClear(nx, ny)) { f.x = nx; f.y = ny; }
      else f.a += f.ts * 5 * dt; // pinned: keep rotating until a way out opens
    }
  }

  function nearestObj(x, y, rTiles, pred) {
    const ctx0 = Math.floor(x / TILE), cty = Math.floor(y / TILE);
    let best = null, bd = 1e9;
    for (let ty = cty - rTiles; ty <= cty + rTiles; ty++) {
      for (let tx = ctx0 - rTiles; tx <= ctx0 + rTiles; tx++) {
        const o = objAt(tx, ty);
        if (o && pred(o)) {
          const d = Math.hypot(tx * TILE + 8 - x, ty * TILE + 8 - y);
          if (d < bd) { bd = d; best = o; }
        }
      }
    }
    return best;
  }

  function nearestBerryBush(x, y, rTiles) {
    return nearestObj(x, y, rTiles, (o) => o.type === 'bush' && o.berries > 0);
  }

  function updateAnimal(a, dt) {
    a.flash = Math.max(0, a.flash - dt);
    a.kbx *= Math.pow(0.02, dt);
    a.kby *= Math.pow(0.02, dt);
    const rabbit = a.kind === 'rabbit';
    const r = rabbit ? 2.5 : 5;

    // rabbits are skittish: a player closing in sends them bolting
    if (rabbit && a.fleeT <= 0 && Math.hypot(player.x - a.x, player.y - a.y) < 26) {
      a.fleeT = rand(0.6, 1.1);
    }

    let moving = false;
    if (a.fleeT > 0) {
      a.fleeT -= dt;
      let dx = a.x - player.x, dy = a.y - player.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      if (a.jinkA) { // slight zig-zag so the flight path reads alive
        const ca = Math.cos(a.jinkA), sa = Math.sin(a.jinkA);
        const nx = dx * ca - dy * sa; dy = dx * sa + dy * ca; dx = nx;
      }
      a.mvx = dx; a.mvy = dy;
      moving = true;
      const spd = rabbit ? 80 : 92;
      const mv = moveEntity(a, (dx * spd + a.kbx) * dt, (dy * spd + a.kby) * dt, r);
      if (mv.blockedX || mv.blockedY) a.jinkA = rand(-1.2, 1.2);
      if (a.fleeT <= 0) { a.jinkA = 0; a.idleT = rand(0.4, 1); a.moveT = 0; }
    } else if (a.moveT > 0) {
      a.moveT -= dt;
      moving = true;
      const spd = rabbit ? 42 : 26;
      const mv = moveEntity(a, (a.mvx * spd + a.kbx) * dt, (a.mvy * spd + a.kby) * dt, r);
      if (mv.blockedX || mv.blockedY) a.moveT = 0;
      if (a.moveT <= 0) a.idleT = rabbit ? rand(0.8, 2.2) : rand(1.6, 4);
    } else {
      a.idleT -= dt;
      if (a.idleT <= 0) {
        // pick a new wander; rabbits drift toward the nearest berry bush
        let ang = rng() * Math.PI * 2;
        if (rabbit) {
          const b = nearestBerryBush(a.x, a.y, 7);
          if (b) {
            const bx = b.tx * TILE + 8, by = b.ty * TILE + 8;
            const bd = Math.hypot(bx - a.x, by - a.y);
            if (bd > 22) ang = Math.atan2(by - a.y, bx - a.x) + rand(-0.5, 0.5);
            else { a.idleT = rand(1.5, 3); return; } // nibbling by the bush
          }
        }
        a.mvx = Math.cos(ang); a.mvy = Math.sin(ang);
        a.moveT = rabbit ? rand(0.5, 1.1) : rand(1.0, 2.4);
      }
    }

    if (moving && Math.abs(a.mvx) > 0.05) a.dir = a.mvx > 0 ? 'right' : 'left';
    a.animT += dt * (moving ? (rabbit ? 10 : 7) : 0);
    a.moving = moving;

    a.x = Math.max(8, Math.min(WORLD * TILE - 8, a.x));
    a.y = Math.max(8, Math.min(WORLD * TILE - 8, a.y));

    if (a.hp <= 0 && !a.dead) {
      a.dead = true;
      SFX.monsterDie();
      if (rabbit) {
        burst(a.x, a.y - 3, '#eef2fa', 10, 45, 0.5);
        burst(a.x, a.y - 3, '#c9d0e2', 6, 35, 0.4);
        spawnDrop(a.x, a.y, 'berry');
      } else {
        burst(a.x, a.y - 5, '#8a6847', 12, 50, 0.55);
        burst(a.x, a.y - 5, '#f2cc6a', 8, 45, 0.5);
        const n = randi(2, 3);
        for (let i = 0; i < n; i++) spawnDrop(a.x, a.y, 'gold');
        addFloater(a.x, a.y - 14, 'GOLD!', '#f2cc6a');
      }
    }
  }

  // ------------------------------------------------------------ structures & robots
  const RES_COLORS = { wood: '#c9a06a', stone: '#b8c0d4', gold: '#f2cc6a', berry: '#f2707a', fish: '#7ac0e8' };
  function nearPlayer(x, y, r) { return Math.hypot(player.x - x, player.y - y) < (r || 180); }

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
        if (o.dustT <= 0) {
          o.dustT = 0.8;
          burst(ox, oy + 4, '#c9d0e2', 3, 25, 0.35, true);
        }
        if (o.buildT >= o.buildTotal) {
          o.building = false;
          o.hp = o.maxHp;
          burst(ox, oy - 4, '#8a6142', 12, 55, 0.6, true);
          burst(ox, oy - 4, '#eef4fb', 10, 50, 0.6, true);
          burst(ox, oy - 4, o.tier === 2 ? '#f2cc6a' : o.tier === 1 ? '#a8b0c4' : '#c9a06a', 6, 45, 0.5, true);
          SFX.place();
          state.shake = Math.max(state.shake, 1.5);
          if (o.type === 'turret') o.cd = 0;
          if (o.type === 'generator') o.payT = STRUCTS.generator.tiers[o.tier].period;
          if (o.type === 'spawner') o.respawnT = 0;
        }
        continue;
      }
      const t = STRUCTS[o.type].tiers[o.tier];
      if (o.type === 'turret') {
        // idle: nothing hostile exists since raiders were removed
      } else if (o.type === 'generator') {
        o.payT -= dt;
        if (o.payT <= 0) {
          o.payT = t.period;
          let near = 0;
          for (const d of drops) if (Math.hypot(d.x - ox, d.y - oy) < 24) near++;
          if (near < 6) { // cap the AFK pile
            spawnDrop(ox, oy - 2, t.res);
            addFloater(ox, oy - 12, '+1', RES_COLORS[t.res]);
            burst(ox, oy - 6, '#c9d0e2', 2, 20, 0.3);
          }
        }
      } else if (o.type === 'spawner') {
        o.bots = o.bots.filter((b) => !b.dead);
        if (o.bots.length < t.bots) {
          o.respawnT -= dt;
          if (o.respawnT <= 0) {
            o.respawnT = 12;
            const b = makeRobot(o);
            o.bots.push(b);
            robots.push(b);
            burst(b.x, b.y - 4, '#a3794f', 6, 35, 0.4, true);
          }
        }
      }
    }
  }

  function makeRobot(sp) {
    const t = STRUCTS.spawner.tiers[sp.tier];
    let sx = sp.tx * TILE + 8, sy = (sp.ty + 1) * TILE + 8;
    const dirs = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [dx, dy] of dirs) {
      if (!isSolidTile(sp.tx + dx, sp.ty + dy)) {
        sx = (sp.tx + dx) * TILE + 8;
        sy = (sp.ty + dy) * TILE + 8;
        break;
      }
    }
    return {
      x: sx, y: sy, hp: t.botHp, maxHp: t.botHp,
      home: sp, tgt: null, workT: 0, stuckT: 0, atkCd: 0,
      jitterT: 0, jitterA: 0,
      carry: { wood: 0, stone: 0, gold: 0 },
      moveT: 0, idleT: rand(0.3, 1), mvx: 0, mvy: 0, moving: false,
      animT: rng() * 2, flash: 0, kbx: 0, kby: 0, dead: false,
    };
  }

  function updateRobot(b, dt) {
    b.flash = Math.max(0, b.flash - dt);
    b.atkCd = Math.max(0, b.atkCd - dt);
    b.kbx *= Math.pow(0.02, dt);
    b.kby *= Math.pow(0.02, dt);
    const home = b.home;
    const hx = home.tx * TILE + 8, hy = home.ty * TILE + 8;
    let moving = false;
    const SPD = 40;

    const walkToward = (px, py) => {
      let dx = px - b.x, dy = py - b.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      if (b.jitterT > 0) {
        b.jitterT -= dt;
        const ca = Math.cos(b.jitterA), sa = Math.sin(b.jitterA);
        const nx = dx * ca - dy * sa; dy = dx * sa + dy * ca; dx = nx;
      }
      b.mvx = dx; b.mvy = dy;
      const mv = moveEntity(b, (dx * SPD + b.kbx) * dt, (dy * SPD + b.kby) * dt, 3);
      if (mv.blockedX || mv.blockedY) {
        b.stuckT += dt;
        if (b.jitterT <= 0) {
          b.jitterT = rand(0.4, 0.9);
          b.jitterA = (rng() < 0.5 ? 1 : -1) * rand(0.6, 1.3);
        }
      } else {
        b.stuckT = Math.max(0, b.stuckT - dt * 0.5);
      }
      moving = true;
      return d;
    };

    const wander = () => {
      if (b.moveT > 0) {
        b.moveT -= dt;
        moving = true;
        const mv = moveEntity(b, (b.mvx * 24 + b.kbx) * dt, (b.mvy * 24 + b.kby) * dt, 3);
        if (mv.blockedX || mv.blockedY) b.moveT = 0;
      } else {
        b.idleT -= dt;
        if (b.idleT <= 0) {
          let ang = rng() * Math.PI * 2;
          if (Math.hypot(hx - b.x, hy - b.y) > 2.5 * TILE) ang = Math.atan2(hy - b.y, hx - b.x) + rand(-0.5, 0.5);
          b.mvx = Math.cos(ang); b.mvy = Math.sin(ang);
          b.moveT = rand(0.5, 1.2);
          b.idleT = rand(0.8, 2);
        }
      }
    };

    const deposit = () => {
      let any = false, line = 0;
      for (const k in b.carry) {
        if (b.carry[k] > 0) {
          inv[k] += b.carry[k];
          addFloater(hx, hy - 14 - line * 8, '+' + b.carry[k], RES_COLORS[k]);
          b.carry[k] = 0;
          any = true;
          line++;
        }
      }
      if (any && nearPlayer(hx, hy)) SFX.pickup();
    };

    const harvest = () => {
      const t = b.tgt, ox = t.tx * TILE + 8, oy = t.ty * TILE + 8;
      t.flash = 0.1;
      t.shake = 0.22;
      if (t.type === 'tree') {
        t.hp--;
        b.carry.wood++;
        if (nearPlayer(ox, oy)) SFX.chop();
        burst(ox, oy - 10, '#eef4fb', 3, 35, 0.4, true);
        if (t.hp <= 0) {
          objects[idx(t.tx, t.ty)] = { type: 'stump', tx: t.tx, ty: t.ty, flash: 0, shake: 0 };
          b.carry.wood += 2;
          if (t.rare) b.carry[t.rare] += 2;
          burst(ox, oy - 8, '#eef4fb', 8, 45, 0.5, true);
          if (nearPlayer(ox, oy)) SFX.treeFall();
          b.tgt = null;
        }
      } else {
        const res = t.type === 'rock' ? 'stone' : 'gold';
        t.hp--;
        b.carry[res]++;
        if (nearPlayer(ox, oy)) SFX.mine();
        burst(ox, oy - 4, res === 'stone' ? '#a8b0c4' : '#f2cc6a', 3, 35, 0.35, true);
        if (t.hp <= 0) {
          objects[idx(t.tx, t.ty)] = null;
          b.carry[res] += 2;
          b.tgt = null;
        }
      }
    };

    const carryTotal = b.carry.wood + b.carry.stone + b.carry.gold;

    if (b.stuckT > 5) { b.tgt = null; b.stuckT = 0; }

    if (home.mode === 'guard') {
      // no raiders to fight: guard mode just loiters near home
      b.tgt = null;
      if (carryTotal > 0) {
        if (walkToward(hx, hy) < 14) deposit();
      } else {
        wander();
      }
    } else if (carryTotal >= 3) {
      if (walkToward(hx, hy) < 14) deposit();
    } else {
      if (b.tgt && objects[idx(b.tgt.tx, b.tgt.ty)] !== b.tgt) b.tgt = null;
      if (!b.tgt) {
        b.tgt = nearestObj(hx, hy, 8, (o) =>
          o.type === 'tree' || o.type === 'rock' || o.type === 'goldore');
      }
      if (b.tgt) {
        const txp = b.tgt.tx * TILE + 8, typ = b.tgt.ty * TILE + 8;
        const d = Math.hypot(txp - b.x, typ - b.y);
        if (d > 20) {
          walkToward(txp, typ);
        } else {
          b.workT += dt;
          if (b.workT >= 0.9) { b.workT = 0; harvest(); }
        }
      } else if (carryTotal > 0) {
        if (walkToward(hx, hy) < 14) deposit();
      } else {
        wander();
      }
    }

    b.animT += dt * (moving ? 8 : 0);
    b.moving = moving;
    b.x = Math.max(8, Math.min(WORLD * TILE - 8, b.x));
    b.y = Math.max(8, Math.min(WORLD * TILE - 8, b.y));

    if (b.hp <= 0 && !b.dead) {
      b.dead = true;
      if (nearPlayer(b.x, b.y)) SFX.break_();
      burst(b.x, b.y - 4, '#8a6142', 10, 50, 0.5, true);
      burst(b.x, b.y - 4, '#ffd95c', 4, 35, 0.4);
    }
  }

  // ------------------------------------------------------------ radial wheel
  const WHEEL_R = 30;

  function wheelOptions() {
    const w = state.wheel;
    if (w.kind === 'build') {
      return STRUCT_ORDER.map((type, i) => ({
        id: type, ang: [-Math.PI / 2, 0, Math.PI / 2, Math.PI][i],
      }));
    }
    const o = objAt(w.tx, w.ty);
    const opts = [
      { id: 'upgrade', ang: -Math.PI / 2 },
      { id: 'demolish', ang: Math.PI / 2 },
    ];
    if (o && o.type === 'spawner') opts.push({ id: 'mode', ang: 0 });
    return opts;
  }

  // shared by resolveWheel and renderWheel so hover math and pixels agree
  function wheelLayout() {
    const w = state.wheel;
    let cx = w.tx * TILE + 8 - Math.round(camX);
    let cy = w.ty * TILE + 8 - Math.round(camY);
    cx = Math.max(WHEEL_R + 36, Math.min(VIEW_W - WHEEL_R - 36, cx));
    cy = Math.max(WHEEL_R + 20, Math.min(VIEW_H - WHEEL_R - 30, cy)); // bottom margin fits the label
    const opts = wheelOptions();
    const dx = mouse.x - cx, dy = mouse.y - cy;
    let seg = -1;
    if (Math.hypot(dx, dy) >= 10) { // 10px deadzone = cancel
      const ang = Math.atan2(dy, dx);
      let bd = 1e9;
      for (let i = 0; i < opts.length; i++) {
        let d = Math.abs(ang - opts[i].ang);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < bd) { bd = d; seg = i; }
      }
    }
    return { cx, cy, opts, seg };
  }

  function resolveWheel() {
    const w = state.wheel;
    const L = wheelLayout();
    if (L.seg < 0) return; // released in the deadzone = cancel
    const opt = L.opts[L.seg];
    if (w.kind === 'build') {
      placeStruct(w.tx, w.ty, opt.id);
      return;
    }
    const o = objAt(w.tx, w.ty);
    if (!o || !STRUCTS[o.type] || o.building) return;
    if (opt.id === 'upgrade') startUpgrade(o);
    else if (opt.id === 'demolish') demolishStruct(o);
    else if (opt.id === 'mode') {
      o.mode = o.mode === 'gather' ? 'guard' : 'gather';
      addFloater(o.tx * TILE + 8, o.ty * TILE - 4, o.mode.toUpperCase(), '#ffd95c');
      SFX.pickup();
    }
  }

  function damagePlayer(dmg, dx, dy) {
    player.hp -= dmg;
    player.hurtT = 0.25;
    player.invuln = 0.7;
    player.kbx = dx * 110; player.kby = dy * 110;
    state.shake = Math.max(state.shake, 3);
    addDmgFloater(player.x, player.y - 18, dmg, true);
    SFX.hurt();
    burst(player.x, player.y - 6, '#e04a54', 8, 50, 0.45);
    if (player.hp <= 0) die();
  }

  function die() {
    state.mode = 'dead';
    player.charging = false;
    player.chargeT = 0;
    player.dodgeT = 0;
    player.vx = player.vy = 0;
    player.sliding = false;
    player.fallT = 0;
    state.mapOpen = false;
    state.settingsOpen = false;
    state.wheel = null;
    state.deadTimer = 0;
    inv.wood = Math.ceil(inv.wood * 0.6);
    inv.stone = Math.ceil(inv.stone * 0.6);
    inv.berry = Math.ceil(inv.berry * 0.6);
    inv.gold = Math.ceil(inv.gold * 0.6);
    inv.fish = Math.ceil(inv.fish * 0.6);
  }

  function respawn() {
    // back at the original camp pocket
    player.x = (playerSpawn.tx + 0.5) * TILE;
    player.y = (playerSpawn.ty + 0.5) * TILE;
    player.hp = player.maxHp;
    player.invuln = 3;
    player.kbx = player.kby = 0;
    player.vx = player.vy = 0;
    player.sliding = false;
    player.fallT = 0;
    player.dodgeT = 0;
    player.dodgeCharges = DODGE_CHARGES;
    player.dodgeRegenT = 0;
    state.mode = 'play';
    showMsg('YOU WOKE AT CAMP  -  SOME SUPPLIES LOST', 4);
  }

  // ------------------------------------------------------------ update
  let camX = 0, camY = 0;

  function update(dt) {
    // apply pending camera zoom (overlays and non-play modes drop to base zoom
    // so the fixed-size panels fit; zoomMax can shrink on a window resize)
    const ze = (state.mode !== 'play' || state.mapOpen || state.settingsOpen)
      ? 0 : Math.min(zoomStep, zoomMax);
    if (ze !== zoomEff) { zoomEff = ze; fitCanvas(); relayout(); }

    // time
    if (state.mode === 'play') {
      state.time += dt;
      state.elapsed += dt;
      if (state.time >= CYCLE) {
        state.time -= CYCLE;
        state.day++;
        SFX.dawnChime();
        showMsg('DAY ' + state.day, 3);
        // fresh gold veins each dawn keeps the center worth visiting
        for (const s of oreSpots) {
          if (!objects[idx(s.tx, s.ty)]) placeObj(s.tx, s.ty, 'goldore', { hp: 6, maxHp: 6 });
        }
        // carved ice holes freeze back over during the night; cracks heal too
        for (const i of holes) {
          ground[i] = 1;
          repaintGround(i % WORLD, (i / WORLD) | 0);
        }
        holes.length = 0;
        iceCracks.clear();
        // and the shoal recovers (never right under the player)
        spawnFish(120);
      }
    }
    // darkness curve
    const t = state.time;
    let dark = 0;
    if (t < DAY_LEN - 12) dark = 0;
    else if (t < DAY_LEN) dark = (t - (DAY_LEN - 12)) / 12;
    else if (t < CYCLE - 10) dark = 1;
    else dark = 1 - (t - (CYCLE - 10)) / 10;
    state.darkness = dark;

    if (state.mode === 'dead') {
      state.deadTimer += dt;
      if (state.deadTimer > 2.6) respawn();
    }

    if (state.mode === 'play' && !state.paused && !state.mapOpen && !state.settingsOpen) updatePlay(dt);

    // camera
    const lookX = (mouse.x - VIEW_W / 2) * 0.12;
    const lookY = (mouse.y - VIEW_H / 2) * 0.12;
    const tx = player.x - VIEW_W / 2 + lookX;
    const ty = player.y - VIEW_H / 2 + lookY;
    camX += (tx - camX) * Math.min(1, dt * 7);
    camY += (ty - camY) * Math.min(1, dt * 7);
    camX = Math.max(0, Math.min(WORLD * TILE - VIEW_W, camX));
    camY = Math.max(0, Math.min(WORLD * TILE - VIEW_H, camY));

    state.shake = Math.max(0, state.shake - dt * 12);
    state.msgT = Math.max(0, state.msgT - dt);
    state.toolMsgT = Math.max(0, state.toolMsgT - dt);

    updateFx(dt);
  }

  function updatePlay(dt) {
    // input
    let mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    const len = Math.hypot(mx, my);
    player.moving = len > 0;
    if (len > 0) {
      mx /= len; my /= len;
      if (player.swingT <= 0) {
        if (Math.abs(mx) > Math.abs(my)) player.dir = mx > 0 ? 'right' : 'left';
        else player.dir = my > 0 ? 'down' : 'up';
      }
    }

    player.kbx = (player.kbx || 0) * Math.pow(0.01, dt);
    player.kby = (player.kby || 0) * Math.pow(0.01, dt);

    // ---- unified momentum: input accelerates vx/vy, the surface sets friction/caps
    const ftx = Math.floor(player.x / TILE), fty = Math.floor((player.y + 4) / TILE);
    const onIce = inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1;
    let sp = Math.hypot(player.vx, player.vy);

    // shift-slide: only engages above walking speed; keeps momentum, drops the tools
    const wantSlide = keys['shift'] && player.dodgeT <= 0;
    if (!player.sliding && wantSlide && sp > SLIDE_MIN) {
      player.sliding = true;
      if (player.charging) { player.charging = false; player.chargeT = 0; } // slide drops the draw
    }
    if (player.sliding && (!wantSlide || sp < SLIDE_EXIT)) player.sliding = false;
    // slide fatigue: builds on snow so long slides run out of glide, recovers on
    // ice so a snow->ice->snow chain starts the snow leg fresh-ish
    if (player.sliding) {
      player.slideT = onIce ? Math.max(0, player.slideT - dt * 1.5) : player.slideT + dt;
    } else {
      player.slideT = 0;
    }

    if (player.fallT > 0) {
      // floundering in an ice hole: no control until the climb-out
      player.fallT -= dt;
      player.vx = player.vy = 0;
      player.sliding = false;
      player.fallRipT -= dt;
      if (player.fallRipT <= 0) {
        player.fallRipT = 0.16;
        burst(player.x + rand(-3, 3), player.y + 4, '#9fc4dd', 2, 16, 0.3, true);
      }
      if (player.fallT <= 0) {
        // scramble out onto the nearest walkable tile
        const out = nearestDryTile(player.x, player.y);
        player.x = (out.tx + 0.5) * TILE;
        player.y = (out.ty + 0.5) * TILE;
        player.invuln = Math.max(player.invuln, 0.8);
        burst(player.x, player.y + 4, '#cfe4f2', 8, 40, 0.45, true);
        SFX.dodge();
      }
    } else if (player.dodgeT > 0) {
      // rolling: the dash owns the velocity; friction waits until the roll ends,
      // so whatever speed the dash reached is carried out for the surface to spend
      player.dodgeT -= dt;
      const mv = moveEntity(player, player.vx * dt, player.vy * dt, PLAYER_R);
      if (mv.blockedX) player.vx = 0;
      if (mv.blockedY) player.vy = 0;
      player.dodgeDustT -= dt;
      if (player.dodgeDustT <= 0) {
        player.dodgeDustT = 0.05;
        burst(player.x, player.y + 5, '#dfe8f4', 2, 22, 0.3, true);
      }
      if (player.dodgeT <= 0) burst(player.x, player.y + 4, '#cfd8e8', 4, 30, 0.3, true);
    } else {
      const chargeMul = player.charging ? 0.55 : 1; // drawn bow slows you
      const walkMax = PLAYER_SPEED * chargeMul;

      if (!onIce && !player.sliding && sp <= walkMax + 6) {
        // plain snow walking: near-instant vector approach, tuned so it feels
        // exactly like the old fixed-speed movement (settles in ~3 frames)
        const f = 1 - Math.exp(-25 * dt);
        player.vx += (mx * walkMax - player.vx) * f;
        player.vy += (my * walkMax - player.vy) * f;
      } else {
        // carrying momentum (ice, slide, or overspeed on snow):
        // steer the heading toward the input, ease the speed toward the target
        let dirx = mx, diry = my;
        if (sp > 1) { dirx = player.vx / sp; diry = player.vy / sp; }
        let steer, decay, target;
        if (player.sliding) {
          // snow friction ramps with slide fatigue: early glide is cheap, the
          // tail drops off hard so slides end decisively
          steer = 1.7; target = 0;
          decay = onIce ? 0.15 : Math.min(2.6, 0.35 + 0.45 * player.slideT);
        } else if (onIce) {
          const cap = ICE_MAX * chargeMul;
          if (len > 0) { steer = 2.6; target = cap; decay = sp < cap ? 1.1 : 0.35; }
          else { steer = 0; target = 0; decay = 0.18; } // idle glide
        } else {
          steer = 4.5; target = len > 0 ? walkMax : 0; decay = 3.5; // snow kills overspeed fast unless you slide
        }
        if (len > 0 && steer > 0 && (dirx !== 0 || diry !== 0)) {
          // carve: rotate the travel direction toward the input, never snap it
          const cur = Math.atan2(diry, dirx), want = Math.atan2(my, mx);
          let da = want - cur;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          const na = cur + Math.max(-steer * dt, Math.min(steer * dt, da));
          dirx = Math.cos(na); diry = Math.sin(na);
        }
        sp = target + (sp - target) * Math.exp(-decay * dt);
        player.vx = dirx * sp;
        player.vy = diry * sp;
      }

      const mv = moveEntity(player,
        (player.vx + player.kbx) * dt,
        (player.vy + player.kby) * dt, PLAYER_R);
      if (mv.blockedX) player.vx = 0; // a wall kills that axis instead of grinding
      if (mv.blockedY) player.vy = 0;
    }

    player.x = Math.max(8, Math.min(WORLD * TILE - 8, player.x));
    player.y = Math.max(8, Math.min(WORLD * TILE - 8, player.y));

    // carved ice holes: standing over open water plunges you in (an active
    // dodge roll carries across the gap)
    if (player.fallT <= 0 && player.dodgeT <= 0) {
      const htx = Math.floor(player.x / TILE), hty = Math.floor((player.y + 4) / TILE);
      if (inWorld(htx, hty) && ground[idx(htx, hty)] === 2) {
        player.fallT = HOLE_FALL_T;
        player.fallRipT = 0;
        player.vx = player.vy = 0;
        player.sliding = false;
        player.slideT = 0;
        if (player.charging) { player.charging = false; player.chargeT = 0; }
        SFX.splash();
        burst(player.x, player.y + 4, '#3a6080', 10, 55, 0.5, true);
        burst(player.x, player.y + 2, '#ddf1f8', 8, 60, 0.5, true);
        damagePlayer(HOLE_FALL_DMG, 0, 0);
      }
    }

    // dodge charges refill one at a time
    if (player.dodgeCharges < DODGE_CHARGES) {
      player.dodgeRegenT -= dt;
      if (player.dodgeRegenT <= 0) {
        player.dodgeCharges++;
        player.dodgeRegenT = player.dodgeCharges < DODGE_CHARGES ? DODGE_CD : 0;
      }
    }
    // spent-stamina ghost: hold briefly, then drain toward the live fill
    {
      const regenP = player.dodgeCharges < DODGE_CHARGES ? 1 - player.dodgeRegenT / DODGE_CD : 0;
      const frac = (player.dodgeCharges + regenP) / DODGE_CHARGES;
      if (player.stamGhostT > 0) player.stamGhostT -= dt;
      else player.stamGhost -= dt * 1.6;
      if (player.stamGhost < frac) player.stamGhost = frac;
    }

    const spNow = Math.hypot(player.vx, player.vy);
    if (spNow > 8 && player.dodgeT <= 0 && !player.sliding) {
      player.animT += dt * 9;
      player.footT -= dt;
      if (player.footT <= 0) {
        player.footT = 0.16;
        player.footSide = 1 - player.footSide;
        const side = player.footSide ? 2 : -2;
        const px = player.dir === 'left' || player.dir === 'right' ? player.x : player.x + side;
        const py = player.dir === 'left' || player.dir === 'right' ? player.y + 6 + (player.footSide ? 1 : -1) : player.y + 6;
        footprints.push({ x: px, y: py, t: 0 });
        if (footprints.length > 400) footprints.shift();
      }
    } else {
      player.animT = 0; // sliding/gliding uses the standing pose
    }

    // fast slide: carve a double trail (footprint decals, spaced ~2.5px so the
    // marks overlap into continuous lines) and kick up snow spray. Snow gets
    // two-tone carved grooves (k:1, lip offset toward the outer side); ice gets
    // thin frosted skate scratches (k:2).
    if (player.sliding && spNow > TRAIL_MIN) {
      player.trailD -= spNow * dt;
      const nx = -player.vy / spNow, ny = player.vx / spNow;
      const k = onIce ? 2 : 1;
      let emit = 0;
      while (player.trailD <= 0 && emit++ < 6) {
        // interpolate the mark back along the path so the spacing stays even
        // no matter how far a single frame travelled
        const back = -player.trailD;
        const bx = player.x - ny * back, by = player.y + 6 + nx * back;
        footprints.push({ x: bx + nx * 2, y: by + ny * 2, t: 0, k });
        footprints.push({ x: bx - nx * 2, y: by - ny * 2, t: 0, k });
        player.trailD += 2.5;
      }
      while (footprints.length > 800) footprints.shift();
      player.slideDustT -= dt;
      if (player.slideDustT <= 0) {
        player.slideDustT = 0.1;
        burst(player.x, player.y + 5, '#eef4fb', 1, 18, 0.3, true);
      }
    }

    // swing
    player.swingCd = Math.max(0, player.swingCd - dt);
    if (player.swingT > 0) {
      player.swingT -= dt;
      if (!player.swingHitDone && player.swingT < 0.12) {
        player.swingHitDone = true;
        swingHit();
      }
    }
    if (mouse.down && !player.sliding && player.fallT <= 0 && TOOLS[tool].key !== 'bow' && player.swingCd <= 0) trySwing();

    // bow draw: charge up and keep facing the mouse
    if (player.charging) {
      player.chargeT = Math.min(BOW_CHARGE, player.chargeT + dt);
      const adx = mouse.x + camX - player.x, ady = mouse.y + camY - player.y;
      if (Math.abs(adx) > Math.abs(ady)) player.dir = adx > 0 ? 'right' : 'left';
      else player.dir = ady > 0 ? 'down' : 'up';
    }

    player.hurtT = Math.max(0, player.hurtT - dt);
    player.invuln = Math.max(0, player.invuln - dt);

    // gentle regen in daylight
    if (player.hp < player.maxHp && state.darkness < 0.3) {
      player.hp = Math.min(player.maxHp, player.hp + dt * 0.6);
    }

    // arrows in flight
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      a.t += dt;
      a.x += a.vx * dt; a.y += a.vy * dt;
      let dead = a.t > a.life;
      if (!dead && isSolidTile(Math.floor(a.x / TILE), Math.floor(a.y / TILE))) {
        dead = true;
        burst(a.x, a.y, '#cfd8e8', 3, 25, 0.25, true);
      }
      if (!dead) {
        const vd = Math.hypot(a.vx, a.vy) || 1;
        for (const an of animals) {
          if (Math.hypot(an.x - a.x, an.y - 3 - a.y) < 8) {
            an.hp -= a.dmg;
            an.flash = 0.12;
            an.fleeT = an.kind === 'rabbit' ? 1.4 : 2.2;
            addDmgFloater(an.x, an.y - 12, a.dmg);
            const kb = 25 + 45 * a.pow;
            an.kbx = a.vx / vd * kb; an.kby = a.vy / vd * kb;
            burst(an.x, an.y - 4, an.kind === 'rabbit' ? '#eef2fa' : '#a5825a', 6, 40, 0.4);
            SFX.hit();
            dead = true;
            break;
          }
        }
      }
      if (dead) arrows.splice(i, 1);
    }

    // wildlife
    for (const a of animals) updateAnimal(a, dt);
    for (let i = animals.length - 1; i >= 0; i--) if (animals[i].dead) animals.splice(i, 1);
    updateFish(dt);

    // stump-built structures + their robots
    updateStructures(dt);
    for (const b of robots) updateRobot(b, dt);
    for (let i = robots.length - 1; i >= 0; i--) if (robots[i].dead) robots.splice(i, 1);

    // drops
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      d.vz -= 220 * dt;
      d.z += d.vz * dt;
      if (d.z < 0) { d.z = 0; d.vz = -d.vz * 0.4; if (Math.abs(d.vz) < 15) d.vz = 0; }
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= Math.pow(0.05, dt); d.vy *= Math.pow(0.05, dt);
      const pd = Math.hypot(d.x - player.x, d.y - player.y);
      if (d.t > 0.35 && pd < 28) {
        d.x += (player.x - d.x) * dt * 10;
        d.y += (player.y - d.y) * dt * 10;
      }
      if (d.t > 0.35 && pd < 7) {
        inv[d.type]++;
        addFloater(player.x, player.y - 14, '+1',
          d.type === 'wood' ? '#c9a06a' : d.type === 'stone' ? '#b8c0d4' : d.type === 'gold' ? '#f2cc6a' : '#f2707a');
        SFX.pickup();
        drops.splice(i, 1);
      }
    }

    // object timers
    for (const o of objects) {
      if (!o) continue;
      if (o.flash > 0) o.flash -= dt;
      if (o.shake > 0) o.shake -= dt;
      if (o.type === 'bush' && o.berries === 0) {
        o.regrow -= dt;
        if (o.regrow <= 0) o.berries = 2;
      }
    }

  }

  // ------------------------------------------------------------ fx updates
  const flakes = [];
  for (let i = 0; i < 70; i++) {
    flakes.push({
      x: rng() * VIEW_W, y: rng() * VIEW_H,
      spd: rand(9, 26), sway: rand(0.4, 1.4), ph: rng() * 9, size: rng() < 0.75 ? 1 : 2,
      a: rand(0.35, 0.8),
    });
  }

  // keep snow density constant across view sizes; resize top-ups draw from a
  // separate seeded stream so they never perturb the main rng's worldgen prefix
  const fxRng = mulberry32((SEED ^ 0x9e3779b9) >>> 0);
  function fitFlakes() {
    const target = Math.round(70 * (VIEW_W * VIEW_H) / (480 * 270));
    while (flakes.length > target) flakes.pop();
    while (flakes.length < target) {
      flakes.push({
        x: fxRng() * VIEW_W, y: fxRng() * VIEW_H,
        spd: 9 + fxRng() * 17, sway: 0.4 + fxRng(), ph: fxRng() * 9,
        size: fxRng() < 0.75 ? 1 : 2, a: 0.35 + fxRng() * 0.45,
      });
    }
  }

  function updateFx(dt) {
    const now = performance.now() / 1000;
    for (const f of flakes) {
      f.y += f.spd * dt;
      f.x += Math.sin(now * f.sway + f.ph) * 8 * dt + 4 * dt;
      if (f.y > VIEW_H + 2) { f.y = -2; f.x = rng() * VIEW_W; }
      if (f.x > VIEW_W + 2) f.x = -2;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += (p.grav || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(0.1, dt);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.t > 0.9) floaters.splice(i, 1);
    }
    for (let i = footprints.length - 1; i >= 0; i--) {
      const f = footprints[i];
      f.t += dt;
      if (f.t > (f.k === 1 ? SNOW_TRAIL_LIFE : 9)) footprints.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ render
  function drawSpriteFlash(spr, x, y, flash) {
    ctx.drawImage(spr, x, y);
    if (flash > 0) {
      sctx.clearRect(0, 0, 32, 32);
      sctx.globalCompositeOperation = 'source-over';
      sctx.drawImage(spr, 0, 0);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = 'rgba(255,255,255,0.8)';
      sctx.fillRect(0, 0, 32, 32);
      ctx.drawImage(scratch, 0, 0, spr.width, spr.height, x, y, spr.width, spr.height);
    }
  }

  function render() {
    const now = performance.now() / 1000;
    const shx = settings.shake && state.shake > 0.2 ? Math.round(rand(-state.shake, state.shake)) : 0;
    const shy = settings.shake && state.shake > 0.2 ? Math.round(rand(-state.shake, state.shake)) : 0;
    const ox = Math.round(camX) + shx;
    const oy = Math.round(camY) + shy;
    // exact (unrounded) camera for MOVING entities. Screen pos must be
    // round(world - camera) with a single rounding: rounding the camera and the
    // entity separately makes their boundary crossings disagree, and the sprite
    // vibrates +/-1px against the background while walking - reads as motion
    // blur / ghosting at high refresh rates. Tiles keep the rounded ox/oy.
    const ex = camX + shx;
    const ey = camY + shy;

    // ground
    ctx.drawImage(groundCv, ox, oy, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

    // fish: silhouettes drifting under the thin ice, crisp in open holes
    for (const f of fish) {
      const sx = f.x - ex, sy = f.y - ey;
      if (sx < -12 || sy < -12 || sx > VIEW_W + 12 || sy > VIEW_H + 12) continue;
      const surfaced = ground[idx(Math.floor(f.x / TILE), Math.floor(f.y / TILE))] === 2;
      const wig = Math.round(Math.sin(f.t * 7) * 1.5);
      ctx.save();
      ctx.translate(Math.round(sx), Math.round(sy));
      ctx.rotate(f.a);
      ctx.globalAlpha = surfaced ? 0.95 : 0.4;
      ctx.fillStyle = surfaced ? '#7fa9c6' : '#4a708c';
      ctx.fillRect(-3, -1, 6, 2);            // body
      ctx.fillRect(-5, -1 + wig, 2, 2);      // waving tail
      if (surfaced) { ctx.fillStyle = '#c9dded'; ctx.fillRect(1, -1, 2, 1); }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // pick-cracked ice: bright fractures radiating from the struck tile
    for (const [ci, hits] of iceCracks) {
      const ctx2 = ci % WORLD, cty2 = (ci / WORLD) | 0;
      const px = ctx2 * TILE - ox, py = cty2 * TILE - oy;
      if (px < -TILE || py < -TILE || px > VIEW_W || py > VIEW_H) continue;
      const n = 3 + hits * 3;
      for (let j = 0; j < n; j++) {
        const h = hash2(ci * 7 + j * 13, j * 31 + hits);
        const a = (j / n) * Math.PI * 2 + h;
        let x0 = px + 8, y0 = py + 8;
        const steps = 2 + hits;
        ctx.fillStyle = j % 2 ? 'rgba(238,248,253,0.9)' : 'rgba(163,203,224,0.9)';
        for (let s = 0; s < steps; s++) {
          x0 += Math.cos(a) * 2 + (hash2(ci + s, j) - 0.5);
          y0 += Math.sin(a) * 2 + (hash2(j + 7, ci + s) - 0.5);
          ctx.fillRect(Math.round(x0), Math.round(y0), 1, 1);
        }
      }
    }

    // footprints + slide trails
    for (const f of footprints) {
      if (f.k === 1) {
        // carved snow groove, lit from the top-left like the rest of the art:
        // shadowed trench wall on top, lit pressed floor below. Holds crisp for
        // most of its (short) life, then fades out fast — so a slide's trail
        // wipes away tail-first behind the player instead of ghosting out as one
        const a = Math.max(0, Math.min(1, (SNOW_TRAIL_LIFE - f.t) / SNOW_TRAIL_FADE));
        const px = Math.round(f.x - ox) - 1, py = Math.round(f.y - oy) - 1;
        ctx.fillStyle = 'rgba(128,152,190,' + (a * 0.6).toFixed(3) + ')';
        ctx.fillRect(px, py, 2, 1);
        ctx.fillStyle = 'rgba(182,199,222,' + (a * 0.55).toFixed(3) + ')';
        ctx.fillRect(px, py + 1, 2, 1);
      } else if (f.k === 2) {
        // ice skate scratch: thin frosted nick, brighter than the ice sheet
        const a = Math.max(0, 1 - f.t / 9);
        ctx.fillStyle = 'rgba(238,250,255,' + (a * 0.75).toFixed(3) + ')';
        ctx.fillRect(Math.round(f.x - ox), Math.round(f.y - oy), 1, 1);
      } else {
        // walking footprints
        const a = Math.max(0, 1 - f.t / 9);
        ctx.fillStyle = 'rgba(122,150,192,' + (a * 0.6).toFixed(3) + ')';
        ctx.fillRect(Math.round(f.x - ox) - 1, Math.round(f.y - oy), 2, 2);
      }
    }

    // visible tile range
    const tx0 = Math.max(0, Math.floor(ox / TILE) - 1);
    const ty0 = Math.max(0, Math.floor(oy / TILE) - 1);
    const tx1 = Math.min(WORLD - 1, Math.ceil((ox + VIEW_W) / TILE) + 1);
    const ty1 = Math.min(WORLD - 1, Math.ceil((oy + VIEW_H) / TILE) + 2);

    // flat objects first (stumps)
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const o = objects[idx(tx, ty)];
        if (!o) continue;
        const px = tx * TILE - ox, py = ty * TILE - oy;
        // +4 like rocks and bushes - any lower and the canopy of a tree on the tile below buries it
        if (o.type === 'stump') ctx.drawImage(SPRITES.stump, px, py + 4);
      }
    }

    // drops (under entities)
    for (const d of drops) {
      const spr = d.type === 'wood' ? SPRITES.itemWood : d.type === 'stone' ? SPRITES.itemStone :
        d.type === 'gold' ? SPRITES.itemGold : SPRITES.itemBerry;
      // shadow
      ctx.fillStyle = 'rgba(120,140,175,0.35)';
      ctx.fillRect(Math.round(d.x - ex) - 2, Math.round(d.y - ey) + 2, 4, 2);
      ctx.drawImage(spr, Math.round(d.x - ex) - 4, Math.round(d.y - d.z - ey) - 4);
    }

    // y-sorted entities
    const draws = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const o = objects[idx(tx, ty)];
        if (!o || o.type === 'stump') continue;
        draws.push({ y: ty * TILE + 16, o, tx, ty });
      }
    }
    draws.push({ y: player.y + 8, player: true });
    for (const a of animals) draws.push({ y: a.y + 4, a });
    for (const b of robots) draws.push({ y: b.y + 4, r: b });
    draws.sort((a, b) => a.y - b.y);

    for (const d of draws) {
      if (d.player) { drawPlayer(ex, ey, now); continue; }
      if (d.a) { drawAnimal(d.a, ex, ey, now); continue; }
      if (d.r) { drawRobot(d.r, ex, ey); continue; }
      const o = d.o;
      const px = d.tx * TILE - ox, py = d.ty * TILE - oy;
      const sh = o.shake > 0 ? Math.round(Math.sin(o.shake * 55) * 1.4) : 0;
      if (o.type === 'tree') {
        drawSpriteFlash(SPRITES.tree[o.variant], px + sh, py - 8, o.flash);
      } else if (o.type === 'rock') {
        drawSpriteFlash(SPRITES.rock[o.variant], px + sh, py + 4, o.flash);
      } else if (o.type === 'goldore') {
        drawSpriteFlash(SPRITES.goldOre, px + sh, py + 4, o.flash);
      } else if (o.type === 'bush') {
        drawSpriteFlash(o.berries > 0 ? SPRITES.bush : SPRITES.bushEmpty, px + sh, py + 4, o.flash);
      } else if (STRUCTS[o.type]) {
        if (o.building) {
          const p = o.buildT / o.buildTotal;
          if (p < 1 / 3) ctx.drawImage(SPRITES.scaffold[0], px, py);
          else if (p < 2 / 3) ctx.drawImage(SPRITES.scaffold[1], px, py);
          else {
            drawSpriteFlash(SPRITES[o.type][o.tier], px + sh, py, o.flash);
            ctx.drawImage(SPRITES.scaffold[2], px, py);
          }
        } else {
          drawSpriteFlash(SPRITES[o.type][o.tier], px + sh, py, o.flash);
          if (o.hp < o.maxHp * 0.6) {
            ctx.fillStyle = 'rgba(40,25,15,0.5)';
            ctx.fillRect(px + 4, py + 5, 1, 3); ctx.fillRect(px + 5, py + 8, 1, 2);
            ctx.fillRect(px + 10, py + 3, 1, 4); ctx.fillRect(px + 11, py + 7, 1, 2);
          }
        }
      }
    }

    drawSelection(ox, oy, now);

    // construction progress bars
    for (const o of structures) {
      if (!o.building) continue;
      const px = o.tx * TILE - ox, py = o.ty * TILE - oy;
      if (px < -20 || px > VIEW_W + 4 || py < -20 || py > VIEW_H + 4) continue;
      const p = Math.min(1, o.buildT / o.buildTotal);
      ctx.fillStyle = 'rgba(15,22,50,0.8)';
      ctx.fillRect(px + 2, py - 7, 12, 4);
      ctx.fillStyle = '#ffd95c';
      ctx.fillRect(px + 3, py - 6, Math.round(10 * p), 2);
    }

    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - ex), Math.round(p.y - ey), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // arrows: short shaft trailing the velocity, bright tip
    for (const a of arrows) {
      const vd = Math.hypot(a.vx, a.vy) || 1;
      const nx = a.vx / vd, ny = a.vy / vd;
      const hx = Math.round(a.x - ex), hy = Math.round(a.y - ey);
      ctx.strokeStyle = '#d8c8a0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx - nx * 5 + 0.5, hy - ny * 5 + 0.5);
      ctx.lineTo(hx + 0.5, hy + 0.5);
      ctx.stroke();
      ctx.fillStyle = '#f4f7ff';
      ctx.fillRect(hx, hy, 1, 1);
    }

    // turret tracers
    for (const t of tracers) {
      ctx.globalAlpha = Math.max(0, Math.min(1, t.t / 0.08));
      ctx.strokeStyle = '#f6d35c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(t.x0 - ex) + 0.5, Math.round(t.y0 - ey) + 0.5);
      ctx.lineTo(Math.round(t.x1 - ex) + 0.5, Math.round(t.y1 - ey) + 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // swing arc
    if (player.swingT > 0) {
      const prog = 1 - player.swingT / 0.18;
      const a0 = player.swingDir - 1.1 + prog * 2.2;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.8 - prog * 0.6).toFixed(2) + ')';
      for (let i = 0; i < 3; i++) {
        const a = a0 - i * 0.22;
        const rr = 13 - i;
        ctx.fillRect(
          Math.round(player.x + Math.cos(a) * rr - ex),
          Math.round(player.y - 2 + Math.sin(a) * rr - ey), 2, 2);
      }
    }

    // floaters (damage numbers drift sideways, rise faster, and can be 2x)
    for (const f of floaters) {
      const a = 1 - f.t / 0.9;
      ctx.globalAlpha = a;
      const s = f.scale || 1;
      drawPixelTextShadow(ctx, f.txt,
        Math.round(f.x + (f.vx || 0) * f.t - ex - pixelTextWidth(f.txt, s) / 2),
        Math.round(f.y - ey - f.t * (f.rise || 14)), f.color, 'rgba(20,20,40,0.8)', s);
      ctx.globalAlpha = 1;
    }

    renderLighting(ox, oy, now);
    renderWeather(now);
    renderVignettes();
    renderUI(now);
    if (state.mode === 'play' && state.wheel) renderWheel(now);

    if (state.mode === 'play' && state.mapOpen) renderWorldMap(now);
    if (state.mode === 'play' && state.settingsOpen) renderSettings(now);
    if (state.mode === 'title') renderTitle(now);
    if (state.mode === 'dead') renderDead();
    if (settings.fps) drawFps();
    if (!window.DBG.hideUI) drawSeedTag();
  }

  // fps readout, very top-right corner, above every overlay
  function drawFps() {
    const t = 'FPS ' + perf.fps;
    drawPixelTextShadow(ctx, t, VIEW_W - pixelTextWidth(t) - 3, 2,
      perf.fps < 45 ? '#ff9a8a' : '#9fe0a8', 'rgba(15,22,50,0.85)');
  }

  // run seed, bottom-right corner - identifies the world and can be replayed via ?seed=N
  function drawSeedTag() {
    drawPixelTextShadow(ctx, SEED_TXT, VIEW_W - pixelTextWidth(SEED_TXT) - 4, VIEW_H - 8,
      '#9fb6d8', 'rgba(15,22,50,0.85)');
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

  function drawAnimal(a, ox, oy, now) {
    const rabbit = a.kind === 'rabbit';
    const set = SPRITES[a.kind][a.dir];
    const frame = a.moving ? 1 + (Math.floor(a.animT) % 2) : 0;
    const spr = set[frame];
    const px = Math.round(a.x - spr.width / 2 - ox);
    const py = Math.round(a.y + 4 - spr.height - oy);
    ctx.fillStyle = 'rgba(110,130,170,0.35)';
    if (rabbit) ctx.fillRect(Math.round(a.x - ox) - 4, Math.round(a.y + 2 - oy), 8, 2);
    else ctx.fillRect(Math.round(a.x - ox) - 7, Math.round(a.y + 2 - oy), 14, 2);
    drawSpriteFlash(spr, px, py, a.flash);
    drawHealthBar(a.x - ox, py - (rabbit ? 4 : 5), a.hp, a.maxHp, rabbit ? 8 : 16);
  }

  function drawRobot(b, ox, oy) {
    const spr = SPRITES.robot[b.moving ? Math.floor(b.animT) % 2 : 0];
    const px = Math.round(b.x - spr.width / 2 - ox);
    const py = Math.round(b.y + 4 - spr.height - oy);
    ctx.fillStyle = 'rgba(110,130,170,0.35)';
    ctx.fillRect(Math.round(b.x - ox) - 5, Math.round(b.y + 2 - oy), 10, 2);
    drawSpriteFlash(spr, px, py, b.flash);
    drawHealthBar(b.x - ox, py - 4, b.hp, b.maxHp, 10);
  }

  // white corner brackets over the hovered / wheel-targeted tile
  function drawSelection(ox, oy, now) {
    if (state.mode !== 'play' || state.mapOpen || state.settingsOpen) return;
    let tx, ty;
    if (state.wheel) {
      tx = state.wheel.tx; ty = state.wheel.ty;
    } else {
      tx = Math.floor((mouse.x + camX) / TILE);
      ty = Math.floor((mouse.y + camY) / TILE);
      const o = objAt(tx, ty);
      if (!o) return;
      if (o.type !== 'stump' && !(STRUCTS[o.type] && !o.building)) return;
      if (Math.hypot(tx * TILE + 8 - player.x, ty * TILE + 8 - player.y) > 60) return;
    }
    const bx = tx * TILE - ox, by = ty * TILE - oy;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now * 6);
    // four 3px corner brackets, dark shadow first so white reads on snow
    const corners = (c, px, py) => {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, 3, 1); ctx.fillRect(px, py, 1, 3);
      ctx.fillRect(px + 13, py, 3, 1); ctx.fillRect(px + 15, py, 1, 3);
      ctx.fillRect(px, py + 15, 3, 1); ctx.fillRect(px, py + 13, 1, 3);
      ctx.fillRect(px + 13, py + 15, 3, 1); ctx.fillRect(px + 15, py + 13, 1, 3);
    };
    corners('rgba(15,22,50,0.9)', bx + 1, by + 1);
    corners('#ffffff', bx, by);
    ctx.globalAlpha = 1;
  }

  function renderWheel(now) {
    const L = wheelLayout();
    const w = state.wheel;
    // backing disc
    ctx.fillStyle = 'rgba(6,10,24,0.6)';
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, WHEEL_R + 14, 0, Math.PI * 2);
    ctx.fill();

    const n = L.opts.length;
    const span = Math.PI * 2 / n;
    for (let i = 0; i < n; i++) {
      const opt = L.opts[i];
      const hovered = i === L.seg;
      ctx.fillStyle = hovered ? '#35426e' : '#141c3c';
      ctx.beginPath();
      ctx.moveTo(L.cx, L.cy);
      ctx.arc(L.cx, L.cy, WHEEL_R + 11, opt.ang - span / 2 + 0.04, opt.ang + span / 2 - 0.04);
      ctx.closePath();
      ctx.fill();
      if (hovered) {
        ctx.strokeStyle = '#ffd95c';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const ix = L.cx + Math.cos(opt.ang) * (WHEEL_R - 9);
      const iy = L.cy + Math.sin(opt.ang) * (WHEEL_R - 9);
      if (w.kind === 'build') {
        const affordable = canAfford(STRUCTS[opt.id].tiers[0].cost);
        const spr = SPRITES[opt.id][0];
        ctx.globalAlpha = affordable ? 1 : 0.55;
        ctx.drawImage(spr, Math.round(ix - 8), Math.round(iy - 8));
        if (!affordable) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#e85a5a';
          ctx.fillRect(Math.round(ix - 8), Math.round(iy - 8), 16, 16);
        }
        ctx.globalAlpha = 1;
      } else {
        const label = opt.id === 'upgrade' ? 'UP' : opt.id === 'demolish' ? 'DEL' : 'MODE';
        drawPixelTextShadow(ctx, label,
          Math.round(ix - pixelTextWidth(label) / 2), Math.round(iy - 2),
          hovered ? '#ffd95c' : '#9fb6d8', 'rgba(15,22,50,0.9)');
      }
    }

    // hovered label + cost under the wheel (or CANCEL in the deadzone)
    let label = 'CANCEL', color = '#9fb6d8';
    if (L.seg >= 0) {
      const opt = L.opts[L.seg];
      const o = objAt(w.tx, w.ty);
      if (w.kind === 'build') {
        const t0 = STRUCTS[opt.id].tiers[0];
        label = STRUCTS[opt.id].name + ' : ' + costText(t0.cost);
        color = canAfford(t0.cost) ? '#ffd95c' : '#ff8a7a';
      } else if (opt.id === 'upgrade') {
        if (!o || o.tier >= 2) { label = 'MAX TIER'; color = '#9fb6d8'; }
        else {
          const t = STRUCTS[o.type].tiers[o.tier + 1];
          label = 'UPGRADE : ' + costText(t.cost);
          color = canAfford(t.cost) ? '#ffd95c' : '#ff8a7a';
        }
      } else if (opt.id === 'demolish') {
        label = 'DEMOLISH'; color = '#ff8a7a';
      } else {
        label = 'MODE: ' + (o && o.mode === 'gather' ? 'GUARD' : 'GATHER');
        color = '#ffd95c';
      }
    }
    drawPixelTextShadow(ctx, label,
      Math.round(L.cx - pixelTextWidth(label) / 2),
      Math.round(L.cy + WHEEL_R + 20), color, 'rgba(15,22,50,0.9)');
  }

  function drawPlayer(ox, oy, now) {
    const set = SPRITES.player[player.dir];
    let frame = 0;
    if (player.moving) frame = 1 + (Math.floor(player.animT) % 2);
    const spr = set[frame];
    const px = Math.round(player.x - 8 - ox);
    const py = Math.round(player.y - 12 - oy);
    // shadow (not while swimming in a hole)
    if (player.fallT <= 0) {
      ctx.fillStyle = 'rgba(110,130,170,0.4)';
      ctx.fillRect(px + 5, py + 15, 6, 2);
    }

    if (player.fallT > 0) {
      // plunged through the ice: quick sink, only the head above the waterline
      const sink = Math.round(Math.min(7, (HOLE_FALL_T - player.fallT) * 40));
      ctx.save();
      ctx.beginPath(); ctx.rect(px - 2, py - 8, 20, 20); ctx.clip();
      drawSpriteFlash(spr, px, py + sink, player.hurtT > 0.12 ? 1 : 0);
      ctx.restore();
      // ripple rings at the waterline
      ctx.fillStyle = 'rgba(207,228,242,0.75)';
      ctx.fillRect(px + 2, py + 11, 12, 1);
      ctx.fillRect(px + 4, py + 13, 8, 1);
    } else if (player.dodgeT > 0) {
      // dodge roll: full spin over the roll, trailing two afterimage ghosts.
      // Spin sign follows horizontal intent so side rolls tumble forward.
      const prog = 1 - player.dodgeT / DODGE_T;
      const sgn = player.dodgeVX < 0 ? -1 : player.dodgeVX > 0 ? 1 :
        player.dodgeVY < 0 ? -1 : 1;
      const vd = Math.hypot(player.dodgeVX, player.dodgeVY) || 1;
      const nx = player.dodgeVX / vd, ny = player.dodgeVY / vd;
      const rollSpr = SPRITES.player[player.dir][0];
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
      // held tool: behind the body when facing away, in the hand otherwise
      const held = state.mode === 'play';
      const toolBehind = held && player.dir === 'up' && !player.charging && player.swingT <= 0;
      if (toolBehind) drawHeldTool(px, py);
      if (player.invuln > 0 && state.mode === 'play' && ((now * 12) | 0) % 2 === 0) ctx.globalAlpha = 0.45;
      drawSpriteFlash(spr, px, py, player.hurtT > 0.12 ? 1 : 0);
      ctx.globalAlpha = 1;
      if (held && !toolBehind) drawHeldTool(px, py);
    }

    if (state.mode === 'play') drawHealthBar(player.x - ox, py - 7, player.hp, player.maxHp, 14);
    // dodge stamina: one clean unsegmented bar under the health bar — charges
    // stay discrete in the sim, the bar just shows the pooled total
    if (state.mode === 'play') {
      const bx = Math.round(player.x - ox) - 7, by = py - 4;
      ctx.fillStyle = 'rgba(12,18,42,0.78)';
      ctx.fillRect(bx - 1, by - 1, 16, 4);
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(bx, by, 14, 2);
      const regenP = player.dodgeCharges < DODGE_CHARGES ? 1 - player.dodgeRegenT / DODGE_CD : 0;
      const frac = (player.dodgeCharges + regenP) / DODGE_CHARGES;
      // ghost of the chunk just spent: pale segment that drains into place
      const gw = Math.round(14 * Math.max(frac, player.stamGhost)) - Math.round(14 * frac);
      if (gw > 0) {
        ctx.fillStyle = '#e6f4ff';
        ctx.fillRect(bx + Math.round(14 * frac), by, gw, 2);
      }
      ctx.fillStyle = '#8ad8ff';
      ctx.fillRect(bx, by, Math.round(14 * frac), 2);
    }
    // bow draw meter, just above the health bar: yellow while charging,
    // turning hot orange the moment the draw is full
    if (player.charging && state.mode === 'play') {
      const frac = Math.min(1, player.chargeT / BOW_CHARGE);
      const x = Math.round(player.x - ox) - 7, y = Math.round(py - 12);
      ctx.fillStyle = 'rgba(12,18,42,0.78)';
      ctx.fillRect(x - 1, y - 1, 16, 4);
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(x, y, 14, 2);
      ctx.fillStyle = frac >= 1 ? '#ff9440' : '#ffd95c';
      ctx.fillRect(x, y, Math.max(1, Math.round(14 * frac)), 2);
    }
  }

  // the selected tool, drawn on the player: carried at the hand while idle or
  // walking, swept along the arc during a melee swing, aimed at the mouse while
  // the bow is drawn. px/py are the player sprite's top-left in screen space.
  function drawHeldTool(px, py) {
    const t = TOOLS[tool];
    const icon = SPRITES[t.icon];
    const cxp = px + 8, cyp = py + 10; // roughly the hands

    // drawn bow tracks the aim; base sprite fires -x (arc on the left), so
    // rotating by a + PI points the arc at the target
    if (t.key === 'bow' && player.charging) {
      const a = Math.atan2(mouse.y + camY - player.y, mouse.x + camX - player.x);
      ctx.save();
      ctx.translate(Math.round(cxp + Math.cos(a) * 8), Math.round(cyp - 2 + Math.sin(a) * 8));
      ctx.rotate(a + Math.PI);
      ctx.drawImage(icon, -4, -4);
      ctx.restore();
      return;
    }

    // melee swing: sweep with the same arc the swing effect uses; the icons
    // point up, so + PI/2 aligns the head with the sweep direction
    if (t.key !== 'bow' && player.swingT > 0) {
      const prog = 1 - player.swingT / 0.18;
      const a = player.swingDir - 1.1 + prog * 2.2;
      ctx.save();
      ctx.translate(Math.round(cxp + Math.cos(a) * 9), Math.round(cyp - 2 + Math.sin(a) * 9));
      ctx.rotate(a + Math.PI / 2);
      ctx.drawImage(icon, -4, -4);
      ctx.restore();
      return;
    }

    // carried: sits in the leading hand, with a 1px walk bob
    const bob = player.moving ? Math.floor(player.animT) % 2 : 0;
    if (player.dir === 'left') {
      ctx.save();
      ctx.translate(px + 2, cyp - 2 + bob);
      ctx.scale(-1, 1);
      ctx.drawImage(icon, -4, -4);
      ctx.restore();
    } else if (player.dir === 'right') {
      ctx.drawImage(icon, px + 10, cyp - 6 + bob);
    } else if (player.dir === 'down') {
      ctx.drawImage(icon, px + 10, cyp - 5 + bob);
    } else { // up: far hand, occluded by the body (caller draws us first)
      ctx.drawImage(icon, px - 2, cyp - 5 + bob);
    }
  }

  function renderLighting(ox, oy, now) {
    const dark = state.darkness;
    // dusk warm tint
    const duskT = state.time > DAY_LEN - 12 && state.time < DAY_LEN + 6 ?
      1 - Math.abs(state.time - (DAY_LEN - 4)) / 9 : 0;
    if (duskT > 0) {
      ctx.globalAlpha = Math.max(0, duskT) * 0.16;
      ctx.fillStyle = '#ff9a5c';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }
    // dawn pink
    const dawnT = state.time > CYCLE - 10 ? (state.time - (CYCLE - 10)) / 10 :
      state.time < 8 ? 1 - state.time / 8 : 0;
    if (dawnT > 0 && dark < 0.8) {
      ctx.globalAlpha = dawnT * 0.1;
      ctx.fillStyle = '#ff88aa';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }

    if (dark <= 0.01) {
      // day-time warm glows only
      drawWarmGlows(ox, oy, now, 0.06);
      return;
    }

    lctx.clearRect(0, 0, VIEW_W, VIEW_H);
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = 'rgba(10,16,42,' + (dark * 0.84).toFixed(3) + ')';
    lctx.fillRect(0, 0, VIEW_W, VIEW_H);

    lctx.globalCompositeOperation = 'destination-out';
    for (const L of lights) {
      const flick = 1 + Math.sin(now * 9 + L.x) * 0.05 + Math.sin(now * 23 + L.y) * 0.03;
      const r = L.r * flick;
      const lx = L.x - ox, ly = L.y - oy;
      if (lx < -r || ly < -r || lx > VIEW_W + r || ly > VIEW_H + r) continue;
      const grd = lctx.createRadialGradient(lx, ly, 2, lx, ly, r);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.75)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      lctx.fillStyle = grd;
      lctx.fillRect(lx - r, ly - r, r * 2, r * 2);
    }
    // personal glow so it's never pitch black around you - with no placeable
    // fires it is the only night light, so it reaches a bit further
    {
      const lx = player.x - ox, ly = player.y - 4 - oy;
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
      if (lx < -r || ly < -r || lx > VIEW_W + r || ly > VIEW_H + r) continue;
      const a = Math.min(1, strength * 3.2);
      const grd = ctx.createRadialGradient(lx, ly, 1, lx, ly, r);
      grd.addColorStop(0, 'rgba(255,205,150,' + a.toFixed(3) + ')');
      grd.addColorStop(0.6, 'rgba(255,222,180,' + (a * 0.6).toFixed(3) + ')');
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
      if (lx < -r || ly < -r || lx > VIEW_W + r || ly > VIEW_H + r) continue;
      const grd = ctx.createRadialGradient(lx, ly, 1, lx, ly, r);
      grd.addColorStop(0, 'rgba(255,170,80,' + (strength * 0.9).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function renderWeather(now) {
    for (const f of flakes) {
      ctx.globalAlpha = f.a;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(f.x), Math.round(f.y), f.size, f.size);
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

  // ------------------------------------------------------------ UI
  function updateMinimap() {
    const d = mmImg.data;
    for (let i = 0; i < WORLD * WORLD; i++) {
      let r, g, b;
      const o = objects[i];
      if (o) {
        if (o.type === 'tree') { r = 52; g = 100; b = 82; }
        else if (o.type === 'rock') { r = 122; g = 131; b = 153; }
        else if (o.type === 'bush') { r = 88; g = 148; b = 108; }
        else if (o.type === 'wall') { r = 163; g = 121; b = 79; }
        else if (o.type === 'goldore') { r = 226; g = 178; b = 82; }
        else if (o.type === 'turret') { r = 196; g = 120; b = 86; }
        else if (o.type === 'generator') { r = 120; g = 180; b = 196; }
        else if (o.type === 'spawner') { r = 170; g = 140; b = 220; }
        else { r = 188; g = 200; b = 218; } // stump
      } else if (ground[i] === 2) { r = 58; g = 92; b = 128; } // open water hole
      else if (ground[i] === 1) { r = 145; g = 188; b = 212; } // ice
      else { r = 205; g = 216; b = 232; } // snow
      const j = i * 4;
      d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
    }
    mmCtx.putImageData(mmImg, 0, 0);
  }

  function renderMinimap(now) {
    updateMinimap();
    const ptx = player.x / TILE, pty = player.y / TILE;

    // backing disc (covers ring + map)
    ctx.fillStyle = 'rgba(12,18,42,0.85)';
    ctx.beginPath(); ctx.arc(MM_CX, MM_CY, MM_R + 6, 0, Math.PI * 2); ctx.fill();

    // circular-clipped map view centered on the player
    ctx.save();
    ctx.beginPath(); ctx.arc(MM_CX, MM_CY, MM_R, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(mmCv, ptx - MM_R, pty - MM_R, MM_R * 2, MM_R * 2,
      MM_CX - MM_R, MM_CY - MM_R, MM_R * 2, MM_R * 2);
    // player dot
    ctx.fillStyle = 'rgba(15,22,50,0.9)';
    ctx.fillRect(MM_CX - 2, MM_CY - 2, 4, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(MM_CX - 1, MM_CY - 1, 2, 2);
    ctx.restore();

    // map edge
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15,22,50,0.9)';
    ctx.beginPath(); ctx.arc(MM_CX, MM_CY, MM_R + 0.5, 0, Math.PI * 2); ctx.stroke();

    // day/night cycle ring
    const prog = state.time / CYCLE;
    const dayFrac = DAY_LEN / CYCLE;
    const a0 = -Math.PI / 2; // start at 12 o'clock
    const ringR = MM_R + 3.5;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2a3358'; // track
    ctx.beginPath(); ctx.arc(MM_CX, MM_CY, ringR, 0, Math.PI * 2); ctx.stroke();
    // day portion of elapsed time
    ctx.strokeStyle = '#ffd95c';
    ctx.beginPath(); ctx.arc(MM_CX, MM_CY, ringR, a0, a0 + Math.min(prog, dayFrac) * Math.PI * 2); ctx.stroke();
    // night portion of elapsed time
    if (prog > dayFrac) {
      ctx.strokeStyle = '#7a90d8';
      ctx.beginPath(); ctx.arc(MM_CX, MM_CY, ringR, a0 + dayFrac * Math.PI * 2, a0 + prog * Math.PI * 2); ctx.stroke();
    }
    // dusk boundary tick
    const ba = a0 + dayFrac * Math.PI * 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#8f9cc4';
    ctx.beginPath();
    ctx.moveTo(MM_CX + Math.cos(ba) * (ringR - 2.5), MM_CY + Math.sin(ba) * (ringR - 2.5));
    ctx.lineTo(MM_CX + Math.cos(ba) * (ringR + 2.5), MM_CY + Math.sin(ba) * (ringR + 2.5));
    ctx.stroke();
    // progress tip
    const ta = a0 + prog * Math.PI * 2;
    const pulse = state.darkness > 0.5 ? (Math.sin(now * 6) * 0.15 + 0.85) : 1;
    ctx.fillStyle = state.darkness > 0.5 ? '#cfd8f2' : '#fff2b0';
    ctx.globalAlpha = pulse;
    ctx.beginPath(); ctx.arc(MM_CX + Math.cos(ta) * ringR, MM_CY + Math.sin(ta) * ringR, 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // elapsed play-time, centered beneath the minimap (clear of the fps
    // readout, which owns the extreme top-right corner)
    const mins = Math.floor(state.elapsed / 60);
    const secs = Math.floor(state.elapsed % 60);
    const clock = mins + ':' + (secs < 10 ? '0' : '') + secs;
    const ccx = Math.round(MM_CX - pixelTextWidth(clock) / 2);
    drawPixelTextShadow(ctx, clock, ccx, MM_CY + MM_R + 9, '#f4f7ff', 'rgba(15,22,50,0.8)');
  }

  // ------------------------------------------------------------ world map (M)
  const PANEL_W = 308, PANEL_H = 226;
  let PANEL_X = Math.round((VIEW_W - PANEL_W) / 2);   // relayout() recenters these
  let PANEL_Y = Math.round((VIEW_H - PANEL_H) / 2);
  let MAP_X = PANEL_X + 10, MAP_Y = PANEL_Y + 24;     // 192x192 map area
  let COL_CX = PANEL_X + 254;                          // right column center
  const MAP_W = 192;             // the baked panel's map slot — the world scales into it
  const MAP_S = MAP_W / WORLD;   // tiles -> map px

  const mapCv = document.createElement('canvas');
  mapCv.width = WORLD; mapCv.height = WORLD;
  const mapCtx = mapCv.getContext('2d');
  const mapImg = mapCtx.createImageData(WORLD, WORLD);

  const panelCv = document.createElement('canvas');
  panelCv.width = PANEL_W; panelCv.height = PANEL_H;

  function buildMapPanel() {
    const g = panelCv.getContext('2d');
    const cham = (x, y, w, h) => { // rect with 2px chamfered corners
      g.fillRect(x + 2, y, w - 4, h);
      g.fillRect(x, y + 2, w, h - 4);
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
    };
    // dark leather outline, then parchment
    g.fillStyle = '#241a10'; cham(0, 0, PANEL_W, PANEL_H);
    g.fillStyle = '#d3c39b'; cham(1, 1, PANEL_W - 2, PANEL_H - 2);
    // parchment mottling
    for (let y = 3; y < PANEL_H - 3; y += 3) {
      for (let x = 3; x < PANEL_W - 3; x += 3) {
        const h = hash2(x * 13 + 1, y * 17 + 9);
        if (h > 0.82) { g.fillStyle = '#dccfae'; g.fillRect(x, y, 3, 3); }
        else if (h < 0.18) { g.fillStyle = '#c9b78d'; g.fillRect(x, y, 3, 3); }
      }
    }
    // worn darker rim
    g.fillStyle = 'rgba(120,90,50,0.16)';
    g.fillRect(2, 2, PANEL_W - 4, 3); g.fillRect(2, PANEL_H - 5, PANEL_W - 4, 3);
    g.fillRect(2, 2, 3, PANEL_H - 4); g.fillRect(PANEL_W - 5, 2, 3, PANEL_H - 4);
    // stitched trim
    g.fillStyle = '#8a6a45';
    for (let x = 8; x < PANEL_W - 10; x += 6) { g.fillRect(x, 5, 3, 1); g.fillRect(x, PANEL_H - 6, 3, 1); }
    for (let y = 8; y < PANEL_H - 10; y += 6) { g.fillRect(5, y, 1, 3); g.fillRect(PANEL_W - 6, y, 1, 3); }
    // corner studs
    g.fillStyle = '#5a4028';
    for (const [sx, sy] of [[4, 4], [PANEL_W - 7, 4], [4, PANEL_H - 7], [PANEL_W - 7, PANEL_H - 7]]) {
      g.fillRect(sx, sy + 1, 3, 1); g.fillRect(sx + 1, sy, 1, 3);
    }
    // title with ornament dashes
    const title = 'THE FROSTLANDS';
    const tw = pixelTextWidth(title, 2);
    const tx0 = Math.round((PANEL_W - tw) / 2);
    drawPixelTextShadow(g, title, tx0, 8, '#4a3322', 'rgba(120,92,58,0.45)', 2);
    g.fillStyle = '#8a6a45';
    g.fillRect(tx0 - 26, 13, 18, 1); g.fillRect(tx0 + tw + 8, 13, 18, 1);
    g.fillRect(tx0 - 30, 12, 2, 3); g.fillRect(tx0 + tw + 28, 12, 2, 3);
    // map mat: highlight line, dark frame (map itself drawn dynamically inside)
    g.fillStyle = '#b5a37e';
    g.fillRect(7, 21, 198, 1); g.fillRect(7, 218, 198, 1);
    g.fillRect(7, 21, 1, 198); g.fillRect(204, 21, 1, 198);
    g.fillStyle = '#241a10';
    g.fillRect(8, 22, 196, 196);
    // column divider
    g.fillStyle = '#b5a37e'; g.fillRect(209, 24, 1, 192);
    // compass rose, center (254,49)
    g.fillStyle = '#4a3322';
    g.fillRect(253, 39, 2, 10);            // N arm (lower half)
    g.fillRect(253, 49, 2, 12);            // S arm
    g.fillRect(242, 48, 12, 2);            // W arm
    g.fillRect(254, 48, 12, 2);            // E arm
    g.fillRect(248, 43, 2, 2); g.fillRect(258, 43, 2, 2); // NW/NE ticks
    g.fillRect(248, 54, 2, 2); g.fillRect(258, 54, 2, 2); // SW/SE ticks
    g.fillStyle = '#a84438';               // red north tip
    g.fillRect(252, 37, 4, 2); g.fillRect(253, 35, 2, 2);
    g.fillStyle = '#d3c39b'; g.fillRect(253, 48, 2, 2);   // center pip
    drawPixelText(g, 'N', Math.round(254 - pixelTextWidth('N') / 2), 26, '#4a3322');
    // legend
    const legend = [
      ['FOREST', '#3c5840'], ['ROCKS', '#686c76'], ['GOLD', '#d8a850'],
      ['FIRES', '#ec9240'],
    ];
    let ly = 72;
    for (const [name, col] of legend) {
      g.fillStyle = '#241a10'; g.fillRect(218, ly, 5, 5);
      g.fillStyle = col; g.fillRect(219, ly + 1, 3, 3);
      drawPixelText(g, name, 228, ly - 1, '#4a3322');
      ly += 12;
    }
    // YOU entry uses the actual diamond marker glyph
    g.fillStyle = '#241a10';
    g.fillRect(218, ly + 1, 5, 3); g.fillRect(219, ly, 3, 5);
    g.fillStyle = '#e05548';
    g.fillRect(219, ly + 2, 3, 1); g.fillRect(220, ly + 1, 1, 3);
    drawPixelText(g, 'YOU', 228, ly - 1, '#4a3322');
    // close hint
    const hint = 'M CLOSE';
    drawPixelText(g, hint, Math.round(254 - pixelTextWidth(hint) / 2), 206, '#7a6647');
  }

  function buildWorldMapImg() {
    const d = mapImg.data;
    for (let ty = 0; ty < WORLD; ty++) {
      for (let tx = 0; tx < WORLD; tx++) {
        const i = ty * WORLD + tx;
        const o = objects[i];
        const h = hash2(tx * 7 + 13, ty * 11 + 5);
        let r, g, b;
        if (o && o.type === 'tree') {
          const up = ty > 0 ? objects[i - WORLD] : o;
          if (!up || up.type !== 'tree') { r = 116; g = 144; b = 104; } // lit canopy rim
          else if (h > 0.86) { r = 44; g = 66; b = 50; }                // deep shade
          else if (h > 0.45) { r = 60; g = 88; b = 64; }
          else { r = 74; g = 102; b = 74; }
        }
        else if (o && o.type === 'rock') { r = 104; g = 108; b = 118; }
        else if (o && o.type === 'bush') {
          if (o.berries > 0) { r = 170; g = 72; b = 80; } else { r = 118; g = 128; b = 98; }
        }
        else if (o && o.type === 'stump') { r = 172; g = 138; b = 92; }
        else if (o && o.type === 'wall') { r = 112; g = 78; b = 46; }
        else if (o && o.type === 'goldore') { r = 214; g = 168; b = 74; }
        else if (o && o.type === 'turret') { r = 150; g = 96; b = 70; }
        else if (o && o.type === 'generator') { r = 96; g = 130; b = 150; }
        else if (o && o.type === 'spawner') { r = 128; g = 104; b = 160; }
        else if (ground[i] === 2) { r = 44; g = 74; b = 104; } // carved water hole
        else if (ground[i] === 1) {
          // inked pond with darker shoreline
          const edge =
            (tx > 0 && ground[i - 1] === 0) || (tx < WORLD - 1 && ground[i + 1] === 0) ||
            (ty > 0 && ground[i - WORLD] === 0) || (ty < WORLD - 1 && ground[i + WORLD] === 0);
          if (edge) { r = 88; g = 120; b = 142; }
          else if (h > 0.7) { r = 158; g = 190; b = 206; }
          else { r = 122; g = 156; b = 176; }
        }
        else {
          // open ground on parchment; tree to the north casts a soft shadow
          const up = ty > 0 ? objects[i - WORLD] : null;
          if (up && up.type === 'tree') { r = 192; g = 176; b = 138; }
          else if (h > 0.9) { r = 205; g = 188; b = 148; }
          else if (h < 0.05) { r = 198; g = 180; b = 140; }
          else { r = 216; g = 201; b = 163; }
        }
        const j = i * 4;
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
      }
    }
  }

  function renderWorldMap(now) {
    // dim the world behind the map
    ctx.fillStyle = 'rgba(6,10,24,0.72)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.drawImage(panelCv, PANEL_X, PANEL_Y);

    // terrain
    buildWorldMapImg();
    mapCtx.putImageData(mapImg, 0, 0);
    ctx.drawImage(mapCv, MAP_X, MAP_Y, MAP_W, MAP_W);

    // faint surveyor's grid
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#3a2c1c';
    for (let gx = 24; gx < WORLD; gx += 24) ctx.fillRect(MAP_X + Math.round(gx * MAP_S), MAP_Y, 1, MAP_W);
    for (let gy = 24; gy < WORLD; gy += 24) ctx.fillRect(MAP_X, MAP_Y + Math.round(gy * MAP_S), MAP_W, 1);
    ctx.globalAlpha = 1;

    // night falls over the chart too
    if (state.darkness > 0.01) {
      ctx.globalAlpha = state.darkness * 0.22;
      ctx.fillStyle = '#2c3c6e';
      ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_W);
      ctx.globalAlpha = 1;
    }

    // current camera view
    ctx.strokeStyle = 'rgba(58,44,28,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(MAP_X + (camX / TILE) * MAP_S + 0.5, MAP_Y + (camY / TILE) * MAP_S + 0.5,
      (VIEW_W / TILE) * MAP_S - 1, (VIEW_H / TILE) * MAP_S - 1);

    // player marker: inked diamond + pulsing ring
    const pmx = MAP_X + Math.round((player.x / TILE) * MAP_S);
    const pmy = MAP_Y + Math.round((player.y / TILE) * MAP_S);
    const ph = (now * 0.9) % 1;
    ctx.globalAlpha = (1 - ph) * 0.5;
    ctx.strokeStyle = '#d84040';
    ctx.beginPath(); ctx.arc(pmx, pmy, 2 + ph * 6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#241a10';
    ctx.fillRect(pmx - 2, pmy - 1, 5, 3); ctx.fillRect(pmx - 1, pmy - 2, 3, 5);
    ctx.fillStyle = '#e05548';
    ctx.fillRect(pmx - 1, pmy, 3, 1); ctx.fillRect(pmx, pmy - 1, 1, 3);

    // day & elapsed time, inked into the right column
    const dayT = 'DAY ' + state.day;
    drawPixelTextShadow(ctx, dayT, Math.round(COL_CX - pixelTextWidth(dayT) / 2), PANEL_Y + 168,
      '#4a3322', 'rgba(120,92,58,0.45)');
    const mins = Math.floor(state.elapsed / 60);
    const secs = Math.floor(state.elapsed % 60);
    const clk = mins + ':' + (secs < 10 ? '0' : '') + secs;
    drawPixelTextShadow(ctx, clk, Math.round(COL_CX - pixelTextWidth(clk) / 2), PANEL_Y + 179,
      '#6a5436', 'rgba(120,92,58,0.35)');
  }

  // ------------------------------------------------------------ settings menu (ESC)
  const SET_W = 240, SET_H = 186;
  let SET_X = Math.round((VIEW_W - SET_W) / 2);       // relayout() recenters these
  let SET_Y = Math.round((VIEW_H - SET_H) / 2);
  let SL_X = SET_X + 112;
  const SL_W = 66;  // slider track
  let ROW_SOUND = SET_Y + 28, ROW_MUTE = SET_Y + 44, ROW_MAP = SET_Y + 60, ROW_SHAKE = SET_Y + 76,
    ROW_FPS = SET_Y + 92;
  let dragSlider = null;

  const setPanelCv = document.createElement('canvas');
  setPanelCv.width = SET_W; setPanelCv.height = SET_H;

  function buildSettingsPanel() {
    const g = setPanelCv.getContext('2d');
    const cham = (x, y, w, h) => {
      g.fillRect(x + 2, y, w - 4, h);
      g.fillRect(x, y + 2, w, h - 4);
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
    };
    // dark frost slab
    g.fillStyle = '#0a0e23'; cham(0, 0, SET_W, SET_H);
    g.fillStyle = '#141c3c'; cham(1, 1, SET_W - 2, SET_H - 2);
    // subtle mottling
    for (let y = 3; y < SET_H - 3; y += 3) {
      for (let x = 3; x < SET_W - 3; x += 3) {
        const h = hash2(x * 11 + 3, y * 7 + 19);
        if (h > 0.86) { g.fillStyle = '#182148'; g.fillRect(x, y, 3, 3); }
        else if (h < 0.10) { g.fillStyle = '#111834'; g.fillRect(x, y, 3, 3); }
      }
    }
    // bevel: icy top light, deep bottom shade
    g.fillStyle = '#35426e';
    g.fillRect(2, 1, SET_W - 4, 1); g.fillRect(1, 2, 1, SET_H - 4);
    g.fillStyle = '#080c1c';
    g.fillRect(2, SET_H - 2, SET_W - 4, 1); g.fillRect(SET_W - 2, 2, 1, SET_H - 4);
    // ice-crystal corner accents
    g.fillStyle = '#5a7fb8';
    for (const [cx2, cy2] of [[7, 7], [SET_W - 8, 7], [7, SET_H - 8], [SET_W - 8, SET_H - 8]]) {
      g.fillRect(cx2 - 2, cy2, 5, 1); g.fillRect(cx2, cy2 - 2, 1, 5);
      g.fillRect(cx2 - 1, cy2 - 1, 3, 3);
    }
    g.fillStyle = '#a8c8e8';
    for (const [cx2, cy2] of [[7, 7], [SET_W - 8, 7], [7, SET_H - 8], [SET_W - 8, SET_H - 8]]) {
      g.fillRect(cx2, cy2, 1, 1);
    }
    // title with dashes
    const title = 'SETTINGS';
    const tw = pixelTextWidth(title);
    const tx0 = Math.round((SET_W - tw) / 2);
    drawPixelTextShadow(g, title, tx0, 8, '#ffd95c', 'rgba(8,12,28,0.9)');
    g.fillStyle = '#4a5480';
    g.fillRect(tx0 - 26, 11, 18, 1); g.fillRect(tx0 + tw + 8, 11, 18, 1);
    g.fillRect(tx0 - 30, 10, 2, 3); g.fillRect(tx0 + tw + 28, 10, 2, 3);
    // row labels
    const L = '#cfe0ff';
    drawPixelText(g, 'VOLUME', 14, ROW_SOUND - SET_Y, L);
    drawPixelText(g, 'MUTE SOUND', 14, ROW_MUTE - SET_Y, L);
    drawPixelText(g, 'MINIMAP SIZE', 14, ROW_MAP - SET_Y, L);
    drawPixelText(g, 'SCREEN SHAKE', 14, ROW_SHAKE - SET_Y, L);
    drawPixelText(g, 'FPS DISPLAY', 14, ROW_FPS - SET_Y, L);
    // controls divider
    const ct = 'CONTROLS';
    const cw = pixelTextWidth(ct);
    const cx0 = Math.round((SET_W - cw) / 2);
    drawPixelText(g, ct, cx0, 110, '#7a8bb8');
    g.fillStyle = '#2c3a68';
    g.fillRect(14, 113, cx0 - 22, 1); g.fillRect(cx0 + cw + 8, 113, SET_W - cx0 - cw - 22, 1);
    // hotkey listing, two columns
    const cols = [
      [['WASD', 'MOVE'], ['SPACE', 'DODGE'], ['CLICK', 'USE TOOL'], ['1-3', 'TOOLS'], ['Q', 'EAT BERRY']],
      [['M', 'WORLD MAP'], ['N', 'MUTE'], ['P', 'PAUSE'], ['ESC', 'SETTINGS'], ['SCROLL', 'ZOOM']],
    ];
    for (let c = 0; c < 2; c++) {
      let y = 124;
      const x0 = c === 0 ? 16 : 128;
      for (const [k, desc] of cols[c]) {
        drawPixelText(g, k, x0, y, '#ffd95c');
        drawPixelText(g, desc, x0 + (c === 0 ? 36 : 26), y, '#7a8bb8');
        y += 10;
      }
    }
    // close hint
    const hint = 'ESC CLOSE';
    drawPixelText(g, hint, Math.round((SET_W - pixelTextWidth(hint)) / 2), 176, '#5a6690');
  }

  function applySliderDrag() {
    const t = Math.max(0, Math.min(1, (mouse.x - SL_X) / SL_W));
    if (dragSlider === 'vol') {
      settings.volume = Math.round(t * 20) / 20;
      SFX.setVolume(settings.volume);
    } else if (dragSlider === 'map') {
      settings.mmR = Math.round(16 + t * 18);
      applyMinimapSize();
    }
  }

  function settingsMouseDown() {
    SFX.unlock();
    const mx = mouse.x, my = mouse.y;
    const inRow = (y) => my >= y - 4 && my <= y + 11;
    const onWidget = mx >= SL_X - 4 && mx <= SL_X + SL_W + 6;
    if (inRow(ROW_SOUND) && onWidget) { dragSlider = 'vol'; applySliderDrag(); return; }
    if (inRow(ROW_MAP) && onWidget) { dragSlider = 'map'; applySliderDrag(); return; }
    if (inRow(ROW_MUTE) && onWidget) {
      settings.muted = SFX.toggleMute();
      SFX.pickup();
      saveSettings();
      return;
    }
    if (inRow(ROW_SHAKE) && onWidget) {
      settings.shake = !settings.shake;
      SFX.pickup();
      saveSettings();
      return;
    }
    if (inRow(ROW_FPS) && onWidget) {
      settings.fps = !settings.fps;
      SFX.pickup();
      saveSettings();
      return;
    }
  }

  function drawSliderRow(y, t, txt) {
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(SL_X - 1, y + 1, SL_W + 2, 5);
    ctx.fillStyle = '#2c3a68'; ctx.fillRect(SL_X, y + 2, SL_W, 3);
    ctx.fillStyle = '#ffd95c'; ctx.fillRect(SL_X, y + 2, Math.round(t * SL_W), 3);
    const kx = SL_X + Math.round(t * SL_W);
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(kx - 2, y - 1, 5, 9);
    ctx.fillStyle = '#f4f7ff'; ctx.fillRect(kx - 1, y, 3, 7);
    drawPixelTextShadow(ctx, txt, SL_X + SL_W + 9, y, '#9fb6d8', 'rgba(8,12,28,0.9)');
  }

  function drawToggleRow(y, on) {
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(SL_X, y - 1, 9, 9);
    ctx.fillStyle = '#121a3a'; ctx.fillRect(SL_X + 1, y, 7, 7);
    if (on) { ctx.fillStyle = '#ffd95c'; ctx.fillRect(SL_X + 2, y + 1, 5, 5); }
    drawPixelTextShadow(ctx, on ? 'ON' : 'OFF', SL_X + 14, y, on ? '#cfe0ff' : '#7a8bb8', 'rgba(8,12,28,0.9)');
  }

  function renderSettings(now) {
    if (dragSlider && mouse.down) applySliderDrag();
    ctx.fillStyle = 'rgba(6,10,24,0.6)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // live minimap preview while resizing
    renderMinimap(now);
    ctx.drawImage(setPanelCv, SET_X, SET_Y);
    drawSliderRow(ROW_SOUND, settings.volume, String(Math.round(settings.volume * 100)));
    drawToggleRow(ROW_MUTE, SFX.isMuted());
    drawSliderRow(ROW_MAP, (settings.mmR - 16) / 18, 'R' + settings.mmR);
    drawToggleRow(ROW_SHAKE, settings.shake);
    drawToggleRow(ROW_FPS, settings.fps);
  }

  function renderUI(now) {
    if (state.mode === 'title' || window.DBG.hideUI) return;

    // berries: consumable indicator, top-left (health lives on the in-world bar)
    if (inv.berry > 0) {
      ctx.drawImage(SPRITES.itemBerry, 5, 5);
      drawPixelTextShadow(ctx, String(inv.berry), 15, 7, '#f4f7ff', 'rgba(15,22,50,0.8)');
      drawPixelTextShadow(ctx, '(Q)', 17 + pixelTextWidth(String(inv.berry)), 7, '#9fb6d8', 'rgba(15,22,50,0.8)');
    }
    // fish: the bigger meal, right below the berries
    if (inv.fish > 0) {
      ctx.drawImage(SPRITES.itemFish, 5, 15);
      drawPixelTextShadow(ctx, String(inv.fish), 15, 17, '#f4f7ff', 'rgba(15,22,50,0.8)');
      drawPixelTextShadow(ctx, '(F)', 17 + pixelTextWidth(String(inv.fish)), 17, '#9fb6d8', 'rgba(15,22,50,0.8)');
    }

    // core resources - horizontal row, left of the minimap
    const res = [
      ['itemWood', inv.wood],
      ['itemStone', inv.stone],
      ['itemGold', inv.gold],
    ];
    const resGap = 7;
    let resW = 0;
    for (const [spr, n] of res) {
      resW += 10 + pixelTextWidth(String(n));
    }
    resW += resGap * (res.length - 1);
    let rx = MM_CX - MM_R - 10 - resW;
    const ryTop = 5;
    for (const [spr, n] of res) {
      ctx.drawImage(SPRITES[spr], rx, ryTop);
      drawPixelTextShadow(ctx, String(n), rx + 10, ryTop + 2, '#f4f7ff', 'rgba(15,22,50,0.8)');
      rx += 10 + pixelTextWidth(String(n)) + resGap;
    }

    // minimap with day/night ring
    renderMinimap(now);

    // tool bar: three infinite tools, keys 1-3 / scroll wheel
    const slotW = 20, gap = 3;
    const totalW = TOOLS.length * slotW + (TOOLS.length - 1) * gap;
    const hx0 = (VIEW_W - totalW) / 2;
    const hy0 = VIEW_H - 26;
    for (let i = 0; i < TOOLS.length; i++) {
      const x = hx0 + i * (slotW + gap);
      const sel = tool === i;
      ctx.fillStyle = sel ? 'rgba(38,48,90,0.9)' : 'rgba(18,24,52,0.8)';
      ctx.fillRect(x, hy0, slotW, slotW);
      ctx.strokeStyle = sel ? '#ffd95c' : '#4a5480';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, hy0 + 0.5, slotW - 1, slotW - 1);
      // 8x8 icons drawn at a crisp 2x so they fill the slot
      ctx.drawImage(SPRITES[TOOLS[i].icon], x + 2, hy0 + 2, 16, 16);
      drawPixelTextShadow(ctx, String(i + 1), x + 2, hy0 + 2, sel ? '#ffd95c' : '#8f9cc4', 'rgba(15,22,50,0.8)');
    }
    // tool name flashes briefly above the bar after switching
    if (state.toolMsgT > 0) {
      const name = TOOLS[tool].name;
      ctx.globalAlpha = Math.min(1, state.toolMsgT * 2);
      drawPixelTextShadow(ctx, name, (VIEW_W - pixelTextWidth(name)) / 2, hy0 - 8,
        '#cfe0ff', 'rgba(15,22,50,0.8)');
      ctx.globalAlpha = 1;
    }

    // message
    if (state.msgT > 0 && state.msg) {
      const a = Math.min(1, state.msgT * 2);
      ctx.globalAlpha = a;
      const w = pixelTextWidth(state.msg);
      drawPixelTextShadow(ctx, state.msg, (VIEW_W - w) / 2, VIEW_H - 44, '#fff4d8', 'rgba(15,22,50,0.9)');
      ctx.globalAlpha = 1;
    }

    if (state.paused) {
      ctx.fillStyle = 'rgba(10,14,35,0.6)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const t = 'PAUSED';
      drawPixelTextShadow(ctx, t, (VIEW_W - pixelTextWidth(t, 2)) / 2, VIEW_H / 2 - 5, '#f4f7ff', '#0a0e23', 2);
    }
  }

  function renderTitle(now) {
    ctx.fillStyle = 'rgba(10,16,42,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // layout was authored for a 270px-tall view; recenter it vertically
    const toy = Math.round((VIEW_H - 270) / 2);
    const t1 = 'EMBERFROST';
    const bob = Math.sin(now * 1.5) * 2;
    drawPixelTextShadow(ctx, t1, (VIEW_W - pixelTextWidth(t1, 4)) / 2, toy + 62 + bob, '#ffd95c', '#3c2a1e', 4);
    const t2 = 'A COZY WINTER SURVIVAL';
    drawPixelTextShadow(ctx, t2, (VIEW_W - pixelTextWidth(t2)) / 2, toy + 96 + bob, '#cfe0ff', 'rgba(15,22,50,0.9)');

    const lines = [
      'WASD MOVE - SPACE DODGE - SHIFT SLIDE',
      'AXE TREES - PICKAXE STONE AND GOLD',
      'HOLD CLICK TO DRAW THE BOW',
      '1-3 SWAP TOOLS - SCROLL TO ZOOM',
      'RIGHT CLICK A STUMP TO BUILD',
      'Q BERRY  M MAP  N MUTE  P PAUSE',
    ];
    let ly = toy + 130;
    for (const l of lines) {
      drawPixelTextShadow(ctx, l, (VIEW_W - pixelTextWidth(l)) / 2, ly, '#9fb6d8', 'rgba(15,22,50,0.9)');
      ly += 12;
    }
    if (((now * 1.6) | 0) % 2 === 0) {
      const t3 = 'CLICK TO BEGIN';
      drawPixelTextShadow(ctx, t3, (VIEW_W - pixelTextWidth(t3, 2)) / 2, toy + 196, '#ffffff', 'rgba(15,22,50,0.9)', 2);
    }
  }

  function renderDead() {
    const a = Math.min(0.75, state.deadTimer * 0.6);
    ctx.fillStyle = 'rgba(8,10,28,' + a + ')';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (state.deadTimer > 0.5) {
      const t = 'YOU COLLAPSED IN THE SNOW';
      drawPixelTextShadow(ctx, t, (VIEW_W - pixelTextWidth(t, 2)) / 2, VIEW_H / 2 - 14, '#a8c4ff', '#0a0e23', 2);
      const t2 = 'SOME SUPPLIES WERE LOST...';
      drawPixelTextShadow(ctx, t2, (VIEW_W - pixelTextWidth(t2)) / 2, VIEW_H / 2 + 8, '#8f9cc4', '#0a0e23');
    }
  }

  // ------------------------------------------------------------ boot
  function startGame() {
    SFX.unlock();
    state.mode = 'play';
    showMsg('GATHER WOOD - CHOP TREES WITH THE AXE', 6);
  }

  loadSettings();
  relayout(); // fitCanvas already ran at load; this places the UI for the fitted view
  SFX.setVolume(settings.volume);
  SFX.setMuted(settings.muted);
  genWorld();
  spawnAnimals();
  spawnFish();
  player.x = (playerSpawn.tx + 0.5) * TILE;
  player.y = (playerSpawn.ty + 0.5) * TILE;
  renderGround();
  buildMapPanel();
  buildSettingsPanel();
  rebuildLights();
  camX = player.x - VIEW_W / 2;
  camY = player.y - VIEW_H / 2;

  // debug/dev harness: lets external tooling step frames & stage scenes
  window.DBG = {
    SEED, state, player, inv, animals, objects, ground, lights, mouse, keys, drops, footprints,
    fish, iceCracks, holes, crackIce, addFish,
    settings, perf, treeRare,
    structures, robots, tracers, arrows, STRUCTS, TOOLS,
    placeObj, rebuildLights, idx, objAt, clickAction, trySwing, fireArrow, tryDodge,
    spawnAnimal: (kind, x, y) => { const a = makeAnimal(kind, x, y); animals.push(a); return a; },
    // debug staging: place a construction site directly, no cost or validation
    buildStruct: (tx, ty, type, tier) => {
      const t = Math.min(2, tier || 0);
      const spec = STRUCTS[type].tiers[t];
      const o = placeObj(tx, ty, type, {
        tier: t, hp: Math.ceil(spec.hp * 0.3), maxHp: spec.hp,
        building: true, buildT: 0, buildTotal: spec.buildT, dustT: 0,
      });
      if (type === 'turret') o.cd = 0;
      if (type === 'generator') o.payT = 0;
      if (type === 'spawner') { o.mode = 'gather'; o.bots = []; o.respawnT = 0; }
      structures.push(o);
      return o;
    },
    finishBuild: (o) => { if (o && o.building) o.buildT = o.buildTotal; },
    setZoom: (n) => { zoomStep = Math.max(0, n | 0); },
    getZoom: () => ({ step: zoomStep, applied: zoomEff, max: zoomMax }),
    setTool: (i) => { tool = i; },
    getTool: () => tool,
    cam: () => ({ x: camX, y: camY }),
    startGame,
    hideUI: false,
    step: (dt, n) => { for (let i = 0; i < (n || 1); i++) { update(dt || 1 / 60); } render(); },
  };

  let last = performance.now();
  function loop(nowMs) {
    const rawDt = (nowMs - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = nowMs;
    perf.frames++;
    perf.acc += rawDt;
    if (perf.acc >= 0.5) {
      perf.fps = Math.round(perf.frames / perf.acc);
      perf.frames = 0;
      perf.acc = 0;
    }
    if (!window.DBG.freeze) {
      update(dt);
      render();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
