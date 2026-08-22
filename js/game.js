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

  // the three infinite tools. Not player-selectable: the bow is always in hand
  // and E auto-swaps to the axe / pick for whatever is under the cursor
  const TOOLS = [
    { key: 'bow',  name: 'BOW',     icon: 'itemBow' },
    { key: 'axe',  name: 'AXE',     icon: 'itemAxe' },
    { key: 'pick', name: 'PICKAXE', icon: 'itemPick' },
  ];
  const TOOL_BOW = 0, TOOL_AXE = 1, TOOL_PICK = 2;
  const BOW_CHARGE = 0.9;   // seconds to a full draw
  const BOW_Y = 6;          // arrows spawn (and are aimed from) this far above the player's feet
  const WORK_REACH = 1;     // E works tiles within this many tiles (Chebyshev) of the player's tile
  const DODGE_T = 0.28;     // roll duration (s)
  const DODGE_SPEED = 215;  // roll velocity -> ~60px travelled
  const DODGE_CHARGES = 2;
  const DODGE_CD = 3.5;     // seconds to refill one charge

  // Hero levels (League-style, max 9). XP is lifetime gold earned (gainGold), never spent
  // or lost on death; LEVEL_XP[n-1] is the total needed to reach level n. Each level past
  // the first is the same flat growth: +LVL_HP max hp (healed on the spot) and +LVL_DMG on
  // every arrow, applied on top of the champion kit.
  const LEVEL_MAX = 9;
  const LEVEL_XP = [0, 10, 25, 45, 70, 100, 135, 175, 220];
  const LVL_HP = 6;
  const LVL_DMG = 1;

  // Player slots. Every combatant in the match - the local human, the AI fills,
  // and (later) network peers - is a Player in `players`, so anything written
  // for "the player" is automatically something every slot can do. Only the
  // camera, HUD and cursor address one specific slot (`player`, the local one).
  const MAX_PLAYER_SLOTS = 6;
  const TEAM_COUNT = 4;      // colour presets; slots past the 4th double up (slot % TEAM_COUNT)
  const PVP = true;          // arrows hit players on another team (friendly fire is off)

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

  // landmark inhabitants (the places themselves are the LANDMARKS table in
  // the landmarks banner). Wolves are the only thing in the world that hunts
  // a player; birds are the only thing that flies.
  const WOLF_SIGHT = 96;     // px a wolf notices a player at (x1.75 at full dark)
  const WOLF_LEASH = 190;    // px from its den a wolf will chase, and no further
  const WOLF_SPD = 96;       // px/s hunting: faster than a walk, slower than a slide
  const WOLF_BITE_R = 13;    // px reach of a bite
  const WOLF_BITE_DMG = 9;
  const WOLF_BITE_CD = 1;    // s between one wolf's bites (damagePlayer's i-frames cap the pack)
  const BIRD_FLUSH = 34;     // px: a player this close puts the whole rookery up
  const BIRD_SPD = 112;      // px/s in flight
  const BIRD_ALT = 15;       // px a perched bird sits above its tile; flight climbs past it

  // One currency, many sources. Every source pays gold with a different yield profile
  // (per-hit trickle vs. burst on completion); this table is the whole economy.
  const YIELD = {
    treeHit: 1,   treeFall: 1,            // 4 hp tree  -> 5 gold, slow and safe
    treeRare: 6,                          // rare-tree jackpot on top of the fall payout
    rockHit: 1,   rockBreak: 4,           // 5 hp rock  -> 9 gold, a bit more than a tree
    deadTreeHit: 1, deadTreeFall: 2,      // 3 hp snag  -> 5 gold, the rookery's cover; leaves a stump
    rabbit: { coins: 2, each: 5 },        // 10 gold + a berry, but it bolts
    deer:   { coins: 3, each: 6 },        // 18 gold, the big mobile target
    wolf:   { coins: 3, each: 8 },        // 24 gold, the biggest kill in the game - and it bites back
    bird:   { coins: 2, each: 4 },        // 8 gold, and the hardest shot in the game
  };

  // Stump-built structures: right-click a stump, pick from the radial wheel.
  // tiers[0] is what the wheel builds; tiers[1]/[2] cost/buildT are the upgrade
  // price and (already shortened) upgrade construction time.
  const STRUCTS = {
    wall: { name: 'WALL', tiers: [
      { cost: { gold: 5 },  hp: 60,  buildT: 4   },
      { cost: { gold: 12 }, hp: 140, buildT: 2.4 },
      { cost: { gold: 30 }, hp: 300, buildT: 2.4 },
    ]},
    turret: { name: 'TURRET', tiers: [
      { cost: { gold: 10 }, hp: 50,  buildT: 8,   range: 60, dmg: 6,  rate: 1.0  },
      { cost: { gold: 25 }, hp: 90,  buildT: 4.8, range: 76, dmg: 9,  rate: 0.8  },
      { cost: { gold: 50 }, hp: 140, buildT: 4.8, range: 92, dmg: 14, rate: 0.65 },
    ]},
    generator: { name: 'GENERATOR', tiers: [
      { cost: { gold: 12 }, hp: 40,  buildT: 8,   pay: 1, period: 10 },
      { cost: { gold: 25 }, hp: 70,  buildT: 4.8, pay: 2, period: 10 },
      { cost: { gold: 45 }, hp: 100, buildT: 4.8, pay: 4, period: 10 },
    ]},
    spawner: { name: 'SPAWNER', tiers: [
      { cost: { gold: 15 }, hp: 60,  buildT: 10, bots: 1, botHp: 18 },
      { cost: { gold: 30 }, hp: 100, buildT: 6,  bots: 2, botHp: 24 },
      { cost: { gold: 60 }, hp: 150, buildT: 6,  bots: 3, botHp: 30 },
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
  // the eagle drop renders at DROP_ROWS (see the eagle drop banner) so the
  // rider sees enough of the world to pick a landing; applyView() swaps it
  let viewRows = TARGET_ROWS;

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
    let dev = Math.max(1, Math.round(devH / viewRows));
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

  const SET_W = 240, SET_H = 202;
  let SET_X = Math.round((VIEW_W - SET_W) / 2);       // relayout() recenters these
  let SET_Y = Math.round((VIEW_H - SET_H) / 2);
  let SL_X = SET_X + 112;
  const SL_W = 66;  // slider track
  let ROW_SOUND = SET_Y + 28, ROW_MUTE = SET_Y + 44, ROW_MAP = SET_Y + 60, ROW_SHAKE = SET_Y + 76,
    ROW_FPS = SET_Y + 92, ROW_CURSOR = SET_Y + 108;

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
    mode: 'title', // title | drop | play | dead  (drop = riding / falling from the eagle)
    time: DAY_LEN * 0.25, // start mid-morning
    elapsed: 0,
    day: 1,
    tick: 0,       // sim steps taken; with SEED + player id it decides contested orders
    darkness: 0,
    shake: 0,
    deadTimer: 0,
    msg: null, msgT: 0,
    hints: { stump: false },
    loc: null,     // the named place the local player is standing in: { L, t }
    paused: false,
    mapOpen: false,
    settingsOpen: false,
    wheel: null, // radial menu: { kind: 'build'|'manage', tx, ty, seg, ax, ay } - ax/ay is the press point
    // main menu (mode === 'title'): keyboard selection, per-item hover eases,
    // the open sub-panel ('settings' | 'help' | null) and its slide progress
    menu: { sel: 0, hover: [0, 0, 0, 0], t: 0, panel: null, panelT: 0, closing: false,
      moved: false, dieT: 0, rolling: 0, camT: 0, pressT: 0,
      // champion select: which screen the menu shows, its cross-fade, the
      // highlighted champion, per-card hover eases, swap pop, lock-in hold
      screen: 'menu', screenT: 0, csel: 0, chover: [0, 0], cswapT: 1, lockT: 0 },
    intro: 0,            // seconds left of the title -> drop / landing -> play transition (0 = none)
    introLen: 1,         // that transition's full length (the camera ease divides by it)
    introFrom: null,     // camera position the transition started from
    drop: null,          // the eagle while it is in the air: see makeEagleRoute() / beginDrop()
    fade: null,          // screen fade: { a, to, spd, color, then }
  };

  const settings = { volume: 0.5, mmR: 24, shake: true, muted: false, fps: false, pixelCursor: true };

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
    ROW_SHAKE = SET_Y + 76; ROW_FPS = SET_Y + 92; ROW_CURSOR = SET_Y + 108;
    fitFlakes();
    renderBars();
  }

  // ------------------------------------------------------------ players
  // Every slot in the match is a Player. They all carry identical state and are
  // all driven from the same `input` struct, so a feature written for "the
  // player" is a feature every slot has: the local human (slot 0), the AI fills,
  // and eventually a network peer are only different in who fills that struct.
  // Sim code takes a `p` argument; `player` (the local slot) is for the camera,
  // HUD, cursor and audio only.
  const TEAMS = SPRITES.teams; // 4 colour presets, baked into the sprites

  // ---- champions ----------------------------------------------------------
  // Every slot plays one of these. A champion is a look (SPRITES.champ[c]) plus
  // a kit: the handful of numbers updatePlayer / fireArrow / tryDodge read
  // through kitOf(p) instead of the bare constants. Champion 0 is the original
  // kit unchanged; the skater trades draw power for ice speed and shoots
  // harder the faster she is moving. Picked on the select screen (local) or
  // hashed from the seed (AI slots) in initPlayers().
  const CHAMPS = [
    {
      name: 'WREN', role: 'THE RANGER',
      blurb: ['STEADY DRAW, HARD HITS. THE ALL-ROUNDER.', 'AXE AND PICK COME OUT ON THEIR OWN.', 'ROLLS CHAIN INTO SPEED ON THE RIVERS.'],
      stats: { ice: 2, draw: 3, power: 4, tough: 3 },
      kit: { iceMax: 1, iceSteer: 2.6, slideMin: SLIDE_MIN, fatigue: 1, chargeMul: 0.55,
        bowCharge: BOW_CHARGE, dmgBase: 4, dmgPow: 9, spdDmg: 0, dodgeSpeed: DODGE_SPEED, maxHp: 100 },
    },
    {
      name: 'SKADI', role: 'THE SKATER',
      blurb: ['BLADES ON THE ICE: FASTER CAP, SHARPER CARVES.', 'QUICK DRAW THAT BARELY SLOWS HER DOWN.', 'ARROWS HIT HARDER THE FASTER SHE FLIES.'],
      stats: { ice: 5, draw: 5, power: 2, tough: 2 },
      kit: { iceMax: 1.35, iceSteer: 3.8, slideMin: 60, fatigue: 0.5, chargeMul: 0.85,
        bowCharge: 0.6, dmgBase: 3, dmgPow: 6, spdDmg: 7, dodgeSpeed: 245, maxHp: 85 },
    },
  ];
  function kitOf(p) { return CHAMPS[p.champ].kit; }
  // swap a slot's champion: kit hp applies on the spot (full heal, it's a pre-match choice)
  function setChamp(p, c) { p.champ = c; p.maxHp = levelMaxHp(p); p.hp = p.maxHp; }
  // kit hp plus the flat per-level growth
  function levelMaxHp(p) { return kitOf(p).maxHp + LVL_HP * (p.level - 1); }
  // the one way gold enters a wallet: pays the purse and the same amount of XP
  function gainGold(p, n) {
    p.inv.gold += n;
    p.xp += n;
    while (p.level < LEVEL_MAX && p.xp >= LEVEL_XP[p.level]) levelUp(p);
  }
  function levelUp(p) {
    p.level++;
    p.maxHp = levelMaxHp(p);
    p.hp = Math.min(p.maxHp, p.hp + LVL_HP);
    // the early levels come too fast to be news; the late ones say who is ahead
    if (p.level >= LOG_LEVEL) logEvent(p.name + ' REACHED LEVEL ' + p.level, p);
    if (!inAir(p)) floaters.push({ x: p.x, y: p.y - 22, txt: 'LEVEL ' + p.level, color: '#f2cc6a', t: 0, vx: 0, scale: 2, rise: 20 });
    if (p === player) SFX.levelUp();
  }
  function champSet(p) { return SPRITES.champ[p.champ][p.team]; }
  // Slots past the fourth double up on a team colour, so text that names one
  // player (the scoreboard, the event log) also needs a per-slot shade of that
  // team's palette - the team colour stays the background, this is the ink.
  function playerTint(p) {
    const t = TEAMS[p.team];
    return [t.trim, t.hatL, t.trimD, t.hat][Math.floor(p.id / TEAM_COUNT) % 4];
  }

  // one frame of intent - the whole interface between a controller and the sim
  function makeInput() {
    return {
      mx: 0, my: 0,        // movement axis (the sim normalises)
      aimX: 0, aimY: 0,    // world-space aim point (cursor, for the human)
      fire: false,         // bow held: press draws, release looses
      work: false,         // E held
      slide: false,        // shift held
      dodge: false,        // edge-triggered, cleared once the sim reads it
      eatBerry: false, eatFish: false, // edge-triggered
      cmd: null,           // one-shot order: {kind:'build'|'upgrade'|'demolish'|'mode', tx, ty, id}
    };
  }

  class Player {
    constructor(slot, control) {
      this.id = slot;
      this.team = slot % TEAM_COUNT;
      this.control = control;             // 'human' | 'ai' | 'none' (empty slot -> ghost)
      this.name = control === 'human' ? 'YOU' : TEAMS[this.team].name + '-' + (slot + 1);
      this.spawn = { tx: WORLD >> 1, ty: WORLD >> 1 }; // landing tile once the eagle drops this slot; respawn returns here
      this.inv = { gold: 0, berry: 0, fish: 0 };
      this.champ = 0;                     // CHAMPS index; the select screen sets the local one
      this.level = 1; this.xp = 0;        // hero level and lifetime gold earned; survive death
      this.kills = 0;                     // rivals downed; scoreboard only, survives death
      this.maxHp = 100;
      this.aboard = false;                // riding the eagle (beginDrop sets it, dropJump clears it)
      this.dropT = 0;                     // seconds of free fall left after jumping (0 = on the ground)
      this.dropU = 1;                     // route fraction at which an AI slot jumps
      // bot brain (unused by a human slot): current job, give-up timers and the
      // short blacklists that keep a bot from re-picking work it cannot reach
      this.ai = {
        tgt: null, tgtT: 0, stuckT: 0, avoid: null, avoidT: 0, thinkT: 0,
        huntTgt: null, huntT: 0, huntAvoid: null, huntAvoidT: 0,
        lootT: 0, spendT: 0, buildT: 0, escapeT: 0,
        wx: 0, wy: 0, roam: 0,
      };
      this.reset(true);
    }
    get active() { return this.control !== 'none'; }
    // camp placement + every transient cleared; used at boot and on respawn
    reset(first) {
      this.x = (this.spawn.tx + 0.5) * TILE;
      this.y = (this.spawn.ty + 0.5) * TILE;
      this.vx = 0; this.vy = 0;
      this.dir = 'down'; this.moving = false; this.animT = 0;
      this.hp = this.maxHp;
      this.dead = false; this.respawnT = 0;
      this.charging = false; this.chargeT = 0;      // bow draw state
      this.dodgeT = 0; this.dodgeVX = 0; this.dodgeVY = 0; this.dodgeDustT = 0;
      this.dodgeCharges = DODGE_CHARGES; this.dodgeRegenT = 0;
      this.stamGhost = 0; this.stamGhostT = 0;      // spent-stamina ghost
      this.sliding = false; this.slideT = 0; this.trailD = 0; this.slideDustT = 0;
      this.swingT = 0; this.swingCd = 0; this.swingDir = 0; this.swingHitDone = false;
      this.tool = TOOL_BOW;                          // held TOOLS index (bow at rest)
      this.workTx = -1; this.workTy = -1;            // tile the current E swing is aimed at
      this.hurtT = 0; this.invuln = first ? 0 : 3;
      this.kbx = 0; this.kby = 0;
      this.fallT = 0; this.fallRipT = 0;             // floundering in an ice hole
      this.footT = 0; this.footSide = 0;
      this.firePrev = false;
      this.input = makeInput();
    }
  }

  const players = [];  // every slot; filled by initPlayers() at boot
  let player = null;   // the local slot - camera, HUD, cursor and audio follow this one
  let inv = null;      // === player.inv, the counters the HUD draws

  // one human (this session) and an AI in every other slot
  function initPlayers() {
    players.length = 0;
    for (let i = 0; i < MAX_PLAYER_SLOTS; i++) players.push(new Player(i, i === 0 ? 'human' : 'ai'));
    // AI slots draw their champion from the seed so a replayed world fields the same roster
    for (const p of players) if (p.control === 'ai') setChamp(p, hash2(p.id * 17 + 3, 77) < 0.5 ? 0 : 1);
    player = players[0];
    inv = player.inv;
  }

  // who p is allowed to shoot: another live slot on another team (this is the
  // one place the FFA/friendly-fire rule lives)
  function enemyOf(p, q) { return q !== p && q.active && !q.dead && !inAir(q) && (!PVP || q.team !== p.team); }
  // riding the eagle or falling from it: not in the world yet, nothing can touch it
  function inAir(p) { return p.aboard || p.dropT > 0; }

  // ---- contested orders --------------------------------------------------
  // Several players can order the same tile, drop or fish inside one sim step,
  // and only one of those can happen. Each such action queues a claim here;
  // resolveContests() runs exactly one per key, picked from (SEED, player id,
  // sim tick) - so the same step resolves the same way on every machine.
  const contests = new Map();
  function contest(key, p, fn) {
    let list = contests.get(key);
    if (!list) { list = []; contests.set(key, list); }
    list.push({ p, fn });
  }
  function contestRank(p) { return hash2(p.id * 131 + 7, state.tick); }
  function resolveContests() {
    for (const list of contests.values()) {
      let win = list[0], wr = contestRank(win.p);
      for (let i = 1; i < list.length; i++) {
        const r = contestRank(list[i].p);
        if (r < wr) { win = list[i]; wr = r; }
      }
      win.fn();
    }
    contests.clear();
  }

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
  const landmarks = []; // named points of interest, placed by worldgen (see the landmarks banner)

  // ------------------------------------------------------------ input
  const keys = {};
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false, inside: false }; // inside: pointer over the canvas

  window.addEventListener('keydown', (e) => {
    // Tab is held to read the scoreboard (scoreboardOpen()), so it must never
    // reach the browser's focus traversal
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (state.mode === 'title') { menuKey(e); return; }
    if (state.mode === 'drop') { if (e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'e') dropJump(player); return; }
    if (state.mode !== 'play') return;
    // edge-triggered intents go into the local player's input struct; the sim
    // reads and clears them, exactly as it does for an AI slot
    if (e.key === ' ') player.input.dodge = true;
    if (e.key.toLowerCase() === 'q') player.input.eatBerry = true;
    if (e.key.toLowerCase() === 'f') player.input.eatFish = true;
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
  // a key held while the window loses focus never sends its keyup: alt-tabbing
  // out would otherwise leave the scoreboard (or a walk direction) stuck on
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / scale;
    mouse.y = (e.clientY - r.top) / scale;
    mouse.inside = true;
    state.menu.moved = true; // the menu only lets the mouse steal the selection when it actually moves
  });
  // the in-canvas cursor must vanish when the pointer leaves the page
  canvas.addEventListener('mouseleave', () => { mouse.inside = false; });
  document.addEventListener('mouseleave', () => { mouse.inside = false; });
  canvas.addEventListener('mousedown', (e) => {
    // a press carries its own position - don't trust the last mousemove (touch,
    // synthetic clicks and pointer-lock all press without moving first)
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / scale;
    mouse.y = (e.clientY - r.top) / scale;
    mouse.inside = true;
    if (e.button === 2) {
      if (state.mode !== 'play' || state.mapOpen || state.settingsOpen || state.wheel) return;
      SFX.unlock();
      const tx = Math.floor((mouse.x + camX) / TILE), ty = Math.floor((mouse.y + camY) / TILE);
      const o = objAt(tx, ty);
      if (!o) return;
      if (Math.hypot(tx * TILE + 8 - player.x, ty * TILE + 8 - player.y) > 60) { SFX.deny(); return; }
      // ax/ay: the press point every later pointer move is measured against
      if (o.type === 'stump') state.wheel = { kind: 'build', tx, ty, seg: -1, ax: mouse.x, ay: mouse.y };
      else if (STRUCTS[o.type] && !o.building && o.team === player.team) state.wheel = { kind: 'manage', tx, ty, seg: -1, ax: mouse.x, ay: mouse.y };
      else if (STRUCTS[o.type]) SFX.deny(); // someone else's building
      return;
    }
    if (e.button !== 0) return;
    if (state.mode === 'title') { menuClick(); return; }
    if (state.mode === 'drop') { SFX.unlock(); dropJump(player); return; }
    if (state.mode !== 'play') return;
    if (state.wheel) return;
    if (state.settingsOpen) { mouse.down = true; settingsMouseDown(); return; }
    if (state.mapOpen) return;
    mouse.down = true;
    clickAction(player);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2 && state.wheel) { resolveWheel(); state.wheel = null; return; }
    // releasing the button just drops the held intent; updatePlayer looses the
    // arrow on that falling edge, the same way an AI's shot is timed
    if (e.button === 0) player.input.fire = false;
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

  // The local human's controller: keyboard + mouse folded into the same input
  // struct an AI writes, once per sim step. Overlays, the wheel and pause zero
  // it (and drop any draw) so nothing leaks through a stopped sim.
  function sampleHumanInput(p) {
    const inp = p.input;
    inp.aimX = mouse.x + camX;
    inp.aimY = mouse.y + camY;
    if (state.mode !== 'play' || state.paused || state.mapOpen || state.settingsOpen) {
      inp.mx = inp.my = 0;
      inp.fire = inp.work = inp.slide = false;
      inp.dodge = inp.eatBerry = inp.eatFish = false;
      inp.cmd = null;
      if (p.charging) { p.charging = false; p.chargeT = 0; }
      p.firePrev = false;
      // the one thing that works mid-air: WASD drifts the fall (updateDrop reads it)
      if (state.mode === 'drop' && !state.paused) {
        if (keys['w'] || keys['arrowup']) inp.my -= 1;
        if (keys['s'] || keys['arrowdown']) inp.my += 1;
        if (keys['a'] || keys['arrowleft']) inp.mx -= 1;
        if (keys['d'] || keys['arrowright']) inp.mx += 1;
      }
      return;
    }
    let mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    inp.mx = mx; inp.my = my;
    inp.slide = !!keys['shift'];
    inp.work = !!keys['e'] && !state.wheel;
    if (state.wheel) { inp.fire = false; inp.dodge = false; } // the wheel swallows the bow
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
    return o.type === 'tree' || o.type === 'deadTree' || o.type === 'rock' ||
      o.type === 'den' || o.type === 'wall' ||
      o.type === 'turret' || o.type === 'generator' || o.type === 'spawner';
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
  const SPAWN_D = WORLD / 2 - 55;
  const ringPts = [];
  for (let i = 0; i < MAX_PLAYER_SLOTS; i++) {
    const a = -Math.PI / 2 + (i / MAX_PLAYER_SLOTS) * Math.PI * 2;
    ringPts.push({
      tx: Math.round(cx + Math.cos(a) * SPAWN_D),
      ty: Math.round(cy + Math.sin(a) * SPAWN_D),
    });
  }

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

  // n = how much the pickup is worth (gold coins can carry several; food is always 1)
  function spawnDrop(x, y, type, n) {
    const a = rng() * Math.PI * 2;
    drops.push({ x, y, vx: Math.cos(a) * rand(20, 45), vy: Math.sin(a) * rand(20, 45) - 30, z: 0, vz: rand(30, 60), type, n: n || 1, t: 0 });
  }

  // wallets are per player: every cost check and payment names whose it is
  function canAfford(cost, p) { const w = (p || player).inv; for (const k in cost) if ((w[k] || 0) < cost[k]) return false; return true; }
  function pay(cost, p) { const w = (p || player).inv; for (const k in cost) w[k] -= cost[k]; }
  function costText(cost) {
    const parts = [];
    for (const k in cost) if (cost[k] > 0) parts.push(cost[k] + ' ' + k.toUpperCase());
    return parts.join('  ');
  }

  function eatBerry(p) {
    if (p.inv.berry <= 0 || p.hp >= p.maxHp) return;
    p.inv.berry--;
    p.hp = Math.min(p.maxHp, p.hp + 20);
    if (nearPlayer(p.x, p.y)) { SFX.eat(); setTimeout(() => SFX.heal(), 90); }
    addFloater(p.x, p.y - 14, '+20', '#8fe08a');
    burst(p.x, p.y - 8, '#f2707a', 6, 30, 0.4);
  }

  function eatFish(p) {
    if (p.inv.fish <= 0 || p.hp >= p.maxHp) return;
    p.inv.fish--;
    p.hp = Math.min(p.maxHp, p.hp + 50);
    if (nearPlayer(p.x, p.y)) { SFX.eat(); setTimeout(() => SFX.heal(), 90); }
    addFloater(p.x, p.y - 14, '+50', '#8fe08a');
    burst(p.x, p.y - 8, '#7ac0e8', 6, 30, 0.4);
  }

  // ------------------------------------------------------------ movement & collision
  // strict = treat open water as a wall for players too (a shove must never
  // dunk someone; only their own movement can)
  function moveEntity(e, dx, dy, r, strict) {
    // only players can enter open water holes (they fall in - see updatePlayer);
    // animals and robots treat those tiles as walls
    const solid = e instanceof Player && !strict ? isSolidTile :
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

  // ---- unit collisions ---------------------------------------------------
  // Players, animals and robots are solid circles to each other. After every
  // mover has taken its step, separateUnits() pushes overlapping pairs apart,
  // splitting the overlap by inverse mass (a player shoves a rabbit aside and
  // barely notices; two players split it evenly). Each push goes through
  // moveEntity (strict), so nobody is shoved into a wall or a hole - and any
  // push the wall refused is handed to the other unit instead, which is what
  // keeps a small unit from ever pinning a player in a corner: the player's
  // share is tried first, and whatever it cannot take, the pinner takes.
  // Momentum: a player moving into the contact loses only its *share* of the
  // normal velocity component per tick (tangential speed is untouched, so a
  // slide into a deer deflects along it rather than sticking), the rest of
  // that component is handed to the other unit as knockback, and a lighter
  // unit gets a small bounce off a heavier one. Two relaxation passes settle
  // piles. Deterministic: fixed iteration order, no rng.
  const UNIT_MASS = { player: 3, deer: 2.2, wolf: 2, rabbit: 0.5, robot: 0.7 };
  const UNIT_BOUNCE = 0.3; // restitution for the lighter side of a contact
  function unitRadius(e) { return e instanceof Player ? PLAYER_R : e.kind === 'rabbit' ? 2.5 : e.kind === 'deer' ? 5 : e.kind === 'wolf' ? 4.5 : 3; }
  function separateUnits() {
    const us = [];
    for (const p of players) if (p.active && !p.dead && !inAir(p)) us.push({ e: p, r: PLAYER_R, m: UNIT_MASS.player, vel: true });
    // birds fly: they are the one unit nothing collides with
    for (const a of animals) if (!a.dead && a.kind !== 'bird') us.push({ e: a, r: unitRadius(a), m: UNIT_MASS[a.kind], vel: false });
    for (const b of robots) if (!b.dead) us.push({ e: b, r: unitRadius(b), m: UNIT_MASS.robot, vel: false });
    // velocity a unit carries into a contact: players their momentum, the
    // rest their knockback (their walk is direction-only and re-chosen each tick)
    const vx = (u) => u.vel ? u.e.vx + u.e.kbx : u.e.kbx;
    const vy = (u) => u.vel ? u.e.vy + u.e.kby : u.e.kby;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
        const a = us[i], b = us[j];
        let dx = b.e.x - a.e.x, dy = b.e.y - a.e.y;
        let d = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (d >= min) continue;
        if (d < 0.01) { dx = 1; dy = 0; d = 1; } // dead-centre stack: part along +x
        const nx = dx / d, ny = dy / d, overlap = min - d;
        const sa = b.m / (a.m + b.m), sb = 1 - sa; // a's share of the push (lighter moves more)
        // positions: a's share first, then b takes its own share plus what a's wall refused
        const ax = a.e.x, ay = a.e.y;
        moveEntity(a.e, -nx * overlap * sa, -ny * overlap * sa, a.r, true);
        const left = overlap - Math.hypot(a.e.x - ax, a.e.y - ay);
        const bx = b.e.x, by = b.e.y;
        moveEntity(b.e, nx * left, ny * left, b.r, true);
        // and if b's wall refused some, a tries once more with the remainder
        const left2 = left - Math.hypot(b.e.x - bx, b.e.y - by);
        if (left2 > 0.01) moveEntity(a.e, -nx * left2, -ny * left2, a.r, true);
        if (pass) continue; // velocities settle on the first pass only
        // velocities along the contact normal (positive = closing)
        const va = vx(a) * nx + vy(a) * ny, vb = -(vx(b) * nx + vy(b) * ny);
        if (va > 0) bump(a, b, va, nx, ny, sa);
        if (vb > 0) bump(b, a, vb, -nx, -ny, sb);
      }
    }
    // u is closing on o at speed vn along (nx, ny); it keeps (1 - share) of that
    // component, o is knocked along it, and a lighter u bounces a little
    function bump(u, o, vn, nx, ny, share) {
      const lose = vn * share * (1 + (u.m < o.m ? UNIT_BOUNCE : 0));
      if (u.vel) { u.e.vx -= lose * nx; u.e.vy -= lose * ny; }
      else { u.e.kbx -= lose * nx; u.e.kby -= lose * ny; }
      const give = vn * share * 0.8;
      o.e.kbx += give * nx; o.e.kby += give * ny;
    }
  }

  // ------------------------------------------------------------ actions
  // Every action takes the player performing it, so the local human, an AI fill
  // and a future network peer all reach the world through the same calls.

  // left click is the bow, always: the press only records the intent
  function clickAction(p) {
    SFX.unlock();
    p.input.fire = true;
  }

  // what E would work right now for p: the tile p is aiming at, if it holds
  // something a tool can harvest (bare ice counts, for the pick). Shared by
  // tryWork(), the AI and the cursor, so the lock ring can never lie about E.
  function workTarget(p) {
    const tx = Math.floor(p.input.aimX / TILE), ty = Math.floor(p.input.aimY / TILE);
    if (!inWorld(tx, ty)) return null;
    const o = objects[idx(tx, ty)];
    let t = -1;
    if (o) {
      if (o.type === 'tree' || o.type === 'deadTree') t = TOOL_AXE;
      else if (o.type === 'rock') t = TOOL_PICK;
      else if (o.type === 'bush' && o.berries > 0) t = TOOL_AXE;
    } else if (ground[idx(tx, ty)] === 1) t = TOOL_PICK;
    if (t < 0) return null;
    // tile-based, not a radius: only the ring of tiles around the one you stand on
    const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
    const near = Math.max(Math.abs(tx - ptx), Math.abs(ty - pty)) <= WORK_REACH;
    return { o, tx, ty, tool: t, near };
  }

  // the fish under the cursor, if any (their bodies are ~10x5, so a 7px disc)
  function hoverFish() {
    const wx = mouse.x + camX, wy = mouse.y + camY;
    for (const f of fish) if (Math.hypot(f.x - wx, f.y - wy) < 7) return f;
    return null;
  }
  // bow-fishing works when the player stands on ice with the fish in FISH_CATCH_R
  function fishInRange(f, p) {
    p = p || player;
    const ftx = Math.floor(p.x / TILE), fty = Math.floor((p.y + 4) / TILE);
    return inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1 &&
      Math.hypot(f.x - p.x, f.y - p.y) < FISH_CATCH_R;
  }

  // E: swing the right tool at the cursor's tile. Held E repeats every swing
  // cooldown; the bow comes back on its own once the cooldown runs out.
  function tryWork(p) {
    if (p.swingCd > 0 || p.fallT > 0 || p.dodgeT > 0) return;
    const t = workTarget(p);
    if (!t || !t.near) return;
    if (p.charging) { p.charging = false; p.chargeT = 0; } // work drops the draw
    p.tool = t.tool;
    p.workTx = t.tx; p.workTy = t.ty;
    const dx = t.tx * TILE + 8 - p.x, dy = t.ty * TILE + 8 - p.y;
    p.swingDir = Math.atan2(dy, dx);
    if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
    else p.dir = dy > 0 ? 'down' : 'up';
    p.swingT = 0.18;
    p.swingCd = 0.34;
    p.swingHitDone = false;
    if (nearPlayer(p.x, p.y)) SFX.swing();
  }

  // dodge roll: dash with i-frames in the held movement direction (8-way),
  // falling back to the facing direction when no key is down
  function tryDodge(p) {
    if (p.dodgeT > 0 || p.dodgeCharges <= 0 || p.fallT > 0 || p.dead) return;
    let dx = p.input.mx, dy = p.input.my;
    if (!dx && !dy) {
      dx = p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0;
      dy = p.dir === 'up' ? -1 : p.dir === 'down' ? 1 : 0;
    }
    const d = Math.hypot(dx, dy) || 1;
    // impulse into the shared velocity: a dash never slows you below the speed
    // you already carry, so on ice dashes chain into real speed
    const v = Math.max(kitOf(p).dodgeSpeed, Math.hypot(p.vx, p.vy));
    p.dodgeVX = dx / d * v; // kept for the roll spin/ghost render
    p.dodgeVY = dy / d * v;
    p.vx = p.dodgeVX;
    p.vy = p.dodgeVY;
    p.dodgeT = DODGE_T;
    p.dodgeDustT = 0;
    // remember the fill level before the spend so the bar can ghost the lost chunk
    const regenP = p.dodgeCharges < DODGE_CHARGES ? 1 - p.dodgeRegenT / DODGE_CD : 0;
    p.stamGhost = Math.max(p.stamGhost, (p.dodgeCharges + regenP) / DODGE_CHARGES);
    p.stamGhostT = 0.3;
    p.dodgeCharges--;
    if (p.dodgeRegenT <= 0) p.dodgeRegenT = DODGE_CD;
    p.invuln = Math.max(p.invuln, DODGE_T + 0.05);
    p.kbx = p.kby = 0;
    if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
    else if (dy !== 0) p.dir = dy > 0 ? 'down' : 'up';
    burst(p.x, p.y + 4, '#dfe8f4', 6, 40, 0.35, true);
    if (nearPlayer(p.x, p.y)) SFX.dodge();
  }

  function fireArrow(p) {
    // bow-fishing: standing on ice with a fish right underfoot spears it
    // through the sheet instead of loosing the arrow. Two players can reach the
    // same fish in one step, so the catch is contested, not first-come.
    const ftx = Math.floor(p.x / TILE), fty = Math.floor((p.y + 4) / TILE);
    if (inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1) {
      let bi = -1, bd = FISH_CATCH_R;
      for (let i = 0; i < fish.length; i++) {
        const d = Math.hypot(fish[i].x - p.x, fish[i].y - p.y);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi >= 0) {
        const f = fish[bi];
        contest('fish:' + bi, p, () => {
          const j = fish.indexOf(f);
          if (j < 0) return;
          fish.splice(j, 1);
          p.inv.fish++;
          addFloater(f.x, f.y - 10, 'FISH!', '#7ac0e8');
          burst(f.x, f.y, '#9fc4dd', 8, 45, 0.45, true);
          burst(f.x, f.y, '#ddf1f8', 5, 35, 0.4, true);
          if (nearPlayer(f.x, f.y)) { SFX.splash(); SFX.pickup(); }
        });
        return;
      }
    }
    const kit = kitOf(p);
    const pw = Math.min(1, Math.max(0.18, p.chargeT / kit.bowCharge));
    // momentum shot: a kit with spdDmg pays extra for speed at the moment of release
    const spdBonus = kit.spdDmg * Math.min(1, Math.hypot(p.vx, p.vy) / 200);
    // aim from the spawn point (BOW_Y above the feet), not the feet: otherwise the
    // flight runs parallel to the aim line, a few px above it, and never meets it
    const dx = p.input.aimX - p.x;
    const dy = p.input.aimY - (p.y - BOW_Y);
    const d = Math.hypot(dx, dy) || 1;
    const spd = 170 + 190 * pw;
    arrows.push({
      x: p.x, y: p.y - BOW_Y,
      vx: dx / d * spd, vy: dy / d * spd,
      t: 0, life: 0.85, dmg: Math.round(kit.dmgBase + kit.dmgPow * pw + spdBonus) + LVL_DMG * (p.level - 1), pow: pw,
      owner: p.id, team: p.team, // whose shot it is - it never hits its own side
    });
    if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
    else p.dir = dy > 0 ? 'down' : 'up';
    if (nearPlayer(p.x, p.y)) SFX.arrow();
  }

  // the swing lands on the tile tryWork() locked, whatever is there by now
  // (a robot may have felled the tree mid-swing: then it's just air). Two
  // players can land on the same tile in one step - only one swing counts.
  function swingHit(p) {
    const tx = p.workTx, ty = p.workTy;
    if (!inWorld(tx, ty)) return;
    contest('work:' + idx(tx, ty), p, () => {
      const o = objects[idx(tx, ty)];
      if (o) { if (o.type !== 'stump' && !STRUCTS[o.type]) hitObject(o, p); }
      else if (ground[idx(tx, ty)] === 1) crackIce(tx, ty, p);
    });
  }

  function crackIce(tx, ty, p) {
    p = p || player;
    const i = idx(tx, ty);
    const px = tx * TILE + 8, py = ty * TILE + 8;
    const hits = (iceCracks.get(i) || 0) + 1;
    if (nearPlayer(px, py)) SFX.mine();
    burst(px, py, '#ddf1f8', 6, 45, 0.4, true);
    if (hits >= ICE_HOLE_HITS) {
      // broken through: the tile becomes open water
      iceCracks.delete(i);
      ground[i] = 2;
      holes.push(i);
      repaintGround(tx, ty);
      if (nearPlayer(px, py)) SFX.splash();
      if (p === player) state.shake = Math.max(state.shake, 2);
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

  // nearest tile a player can stand on - used to climb out of a hole
  function nearestDryTile(x, y, p) {
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
    return (p || player).spawn;
  }

  function hitObject(o, p) {
    p = p || player;
    const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
    const near = nearPlayer(ox, oy); // remote players' work must not spam the mix
    // hard tool gating: the wrong tool bounces off instead of harvesting
    const k = TOOLS[p.tool].key;
    if (((o.type === 'tree' || o.type === 'deadTree') && k !== 'axe') ||
        (o.type === 'rock' && k !== 'pick')) {
      if (near) SFX.deny();
      addFloater(ox, oy - 14, o.type === 'rock' ? 'NEEDS PICKAXE' : 'NEEDS AXE', '#9fb6d8');
      return;
    }
    o.flash = 0.1;
    o.shake = 0.22;
    if (o.type === 'tree') {
      o.hp--;
      if (near) SFX.chop();
      spawnDrop(ox, oy, 'gold', YIELD.treeHit);
      burst(ox, oy - 10, '#eef4fb', 6, 40, 0.5, true);
      burst(ox, oy - 12, '#3f7a5c', 3, 30, 0.4, true);
      if (o.hp <= 0) {
        objects[idx(o.tx, o.ty)] = { type: 'stump', tx: o.tx, ty: o.ty, flash: 0, shake: 0 };
        if (near) SFX.treeFall();
        if (p === player) state.shake = Math.max(state.shake, 2.5);
        if (p === player && !state.hints.stump) {
          state.hints.stump = true;
          showMsg('RIGHT CLICK THE STUMP TO BUILD ON IT', 5);
        }
        spawnDrop(ox, oy, 'gold', YIELD.treeFall);
        burst(ox, oy - 8, '#eef4fb', 14, 55, 0.7, true);
        burst(ox, oy - 8, '#2f5c4b', 8, 45, 0.6, true);
        if (o.rare) {
          spawnDrop(ox, oy, 'gold', YIELD.treeRare / 2); spawnDrop(ox, oy, 'gold', YIELD.treeRare / 2);
          burst(ox, oy - 8, '#f2cc6a', 10, 50, 0.6, true);
          addFloater(ox, oy - 18, 'JACKPOT!', '#f2cc6a');
          if (near) SFX.pickup();
        }
      }
    } else if (o.type === 'deadTree') {
      // the rookery's cover: quicker than a live pine, same gold, and felling
      // a perch scatters the flock that was sitting in it
      o.hp--;
      if (near) SFX.chop();
      spawnDrop(ox, oy, 'gold', YIELD.deadTreeHit);
      burst(ox, oy - 10, '#eef4fb', 5, 40, 0.5, true);
      burst(ox, oy - 12, '#6b5a48', 3, 30, 0.4, true);
      if (o.hp <= 0) {
        objects[idx(o.tx, o.ty)] = { type: 'stump', tx: o.tx, ty: o.ty, flash: 0, shake: 0 };
        if (near) SFX.treeFall();
        if (p === player) state.shake = Math.max(state.shake, 2);
        spawnDrop(ox, oy, 'gold', YIELD.deadTreeFall);
        burst(ox, oy - 8, '#eef4fb', 12, 55, 0.7, true);
        burst(ox, oy - 8, '#6b5a48', 6, 45, 0.6, true);
        flushBirds(landmarkAt(ox, oy), { x: ox, y: oy });
      }
    } else if (o.type === 'rock') {
      o.hp--;
      if (near) SFX.mine();
      spawnDrop(ox, oy, 'gold', YIELD.rockHit);
      burst(ox, oy - 4, '#a8b0c4', 6, 45, 0.4, true);
      if (o.hp <= 0) {
        objects[idx(o.tx, o.ty)] = null;
        if (near) SFX.break_();
        if (p === player) state.shake = Math.max(state.shake, 2);
        spawnDrop(ox, oy, 'gold', YIELD.rockBreak / 2); spawnDrop(ox, oy, 'gold', YIELD.rockBreak / 2);
        burst(ox, oy - 4, '#8b93a8', 12, 55, 0.6, true);
      }
    } else if (o.type === 'bush') {
      if (o.berries > 0) {
        o.berries = 0;
        o.regrow = 70;
        if (near) SFX.pickup();
        spawnDrop(ox, oy, 'berry'); spawnDrop(ox, oy, 'berry');
        burst(ox, oy - 4, '#4c8560', 5, 35, 0.4, true);
      } else if (near) {
        SFX.swing();
      }
    } else if (STRUCTS[o.type]) {
      o.hp -= 10;
      if (near) SFX.hit();
      burst(ox, oy - 4, '#a3794f', 5, 40, 0.4, true);
      if (o.hp <= 0) destroyStructure(o, true);
    }
  }

  function destroyStructure(o, refund) {
    if (STRUCTS[o.type]) removeStruct(o);
    else objects[idx(o.tx, o.ty)] = null;
    const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
    if (nearPlayer(ox, oy)) SFX.break_();
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

  // Building is a contested order: two players can claim the same stump in one
  // step. The claim is checked and paid for when it wins, so a loser keeps its
  // gold. p defaults to the local player (DBG staging).
  function placeStruct(tx, ty, type, p) {
    p = p || player;
    const deny = (msg, t) => { if (p === player) { SFX.deny(); if (msg) showMsg(msg, t); } };
    const site = objAt(tx, ty);
    if (!site || site.type !== 'stump') { deny(); return; }
    const cxp = tx * TILE + 8, cyp = ty * TILE + 8;
    if (Math.hypot(cxp - p.x, cyp - p.y) > 60) { deny(); return; }
    // all four buildings are solid - never let a player entomb themselves
    if (Math.abs(cxp - p.x) < 8 + PLAYER_R && Math.abs(cyp - p.y) < 8 + PLAYER_R) {
      deny('STEP OFF THE STUMP FIRST', 1.6);
      return;
    }
    const t0 = STRUCTS[type].tiers[0];
    if (!canAfford(t0.cost, p)) { deny('NOT ENOUGH RESOURCES', 1.6); return; }
    contest('site:' + idx(tx, ty), p, () => {
      const s = objAt(tx, ty);
      if (!s || s.type !== 'stump' || !canAfford(t0.cost, p)) return;
      pay(t0.cost, p);
      const o = placeObj(tx, ty, type, {
        tier: 0, hp: Math.ceil(t0.hp * 0.3), maxHp: t0.hp,
        building: true, buildT: 0, buildTotal: t0.buildT, dustT: 0,
        owner: p.id, team: p.team, // paints the sprite and gates the manage wheel
      });
      if (type === 'turret') o.cd = 0;
      if (type === 'generator') o.payT = 0;
      if (type === 'spawner') { o.mode = 'gather'; o.bots = []; o.respawnT = 0; }
      structures.push(o);
      if (nearPlayer(cxp, cyp)) SFX.place();
      burst(cxp, cyp, '#eef4fb', 8, 40, 0.4, true);
    });
  }

  // only the owning side may upgrade or demolish
  function ownsStruct(o, p) { return o.team === undefined || o.team === p.team; }

  function startUpgrade(o, p) {
    p = p || player;
    const deny = (msg, t) => { if (p === player) { SFX.deny(); if (msg) showMsg(msg, t); } };
    if (o.building || !ownsStruct(o, p)) { deny(); return; }
    if (o.tier >= 2) { deny('MAX TIER', 1.4); return; }
    const t = STRUCTS[o.type].tiers[o.tier + 1];
    if (!canAfford(t.cost, p)) { deny('NOT ENOUGH RESOURCES', 1.6); return; }
    pay(t.cost, p);
    o.tier++;
    o.maxHp = t.hp;
    o.building = true;
    o.buildT = 0;
    o.buildTotal = t.buildT;
    o.dustT = 0;
    if (nearPlayer(o.tx * TILE + 8, o.ty * TILE + 8)) SFX.place();
    burst(o.tx * TILE + 8, o.ty * TILE + 8, '#eef4fb', 8, 40, 0.4, true);
  }

  function demolishStruct(o, p) {
    if (!ownsStruct(o, p || player)) { if ((p || player) === player) SFX.deny(); return; }
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
  // Rabbits and deer are the passive half (updatePrey); wolves and birds are
  // the inhabitants of the two landmarks (updateWolf / updateBird), and go in
  // this same array so arrows, the draw list, the kill payouts and the cursor
  // all treat them as what they are: things you shoot.
  const ANIMAL_HP = { rabbit: 8, deer: 24, wolf: 30, bird: 3 };
  const HIT_PUFF = { rabbit: '#eef2fa', deer: '#a5825a', wolf: '#6f778c', bird: '#cfd6e4' };

  function makeAnimal(kind, x, y) {
    const hp = ANIMAL_HP[kind] || 8;
    return {
      kind, x, y, hp, maxHp: hp,
      dir: rng() < 0.5 ? 'left' : 'right',
      moveT: 0, idleT: rand(0.5, 2.5), mvx: 0, mvy: 0, moving: false,
      animT: rng() * 2, flash: 0, kbx: 0, kby: 0, fleeT: 0, jinkA: 0,
      home: null,                          // the landmark it belongs to, if any
      target: null, biteCd: 0,           // wolf: its quarry and its bite rhythm
      perch: null, flyT: 0, fa: 0, alt: 0, // bird: its tree, its flight, its height
      dead: false,
    };
  }

  // the body an arrow (and the aim line) tests against. Birds ride their alt
  // and are a smaller mark - that is most of what makes them a hard shot.
  function animalHit(a, x, y) {
    const r = a.kind === 'bird' ? 5 : 8;
    return Math.hypot(a.x - x, a.y - (a.alt || 0) - 3 - y) < r;
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
      if (minPlayerDist && players.some((p) => p.active && Math.hypot(x - p.x, y - p.y) < minPlayerDist)) continue;
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
    if (a.kind === 'wolf') updateWolf(a, dt);
    else if (a.kind === 'bird') updateBird(a, dt);
    else updatePrey(a, dt);
    a.x = Math.max(8, Math.min(WORLD * TILE - 8, a.x));
    a.y = Math.max(8, Math.min(WORLD * TILE - 8, a.y));
    if (a.hp <= 0 && !a.dead) animalDies(a);
  }

  // rabbits and deer: wander, nibble, and bolt from anyone who gets close
  function updatePrey(a, dt) {
    const rabbit = a.kind === 'rabbit';
    const r = rabbit ? 2.5 : 5;

    // rabbits are skittish: ANY player closing in sends them bolting
    let scare = null, sd = 1e9;
    for (const p of players) {
      if (!p.active || p.dead || inAir(p)) continue;
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d < sd) { sd = d; scare = p; }
    }
    if (rabbit && a.fleeT <= 0 && sd < 26) a.fleeT = rand(0.6, 1.1);

    let moving = false;
    if (a.fleeT > 0) {
      a.fleeT -= dt;
      const from = scare || player;
      let dx = a.x - from.x, dy = a.y - from.y;
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
      // a shove (arrow or unit collision) still moves an idle animal
      if (Math.abs(a.kbx) + Math.abs(a.kby) > 1) moveEntity(a, a.kbx * dt, a.kby * dt, r);
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
  }

  // what a kill pays: one profile per kind, all of it out of the YIELD table
  function animalDies(a) {
    a.dead = true;
    if (nearPlayer(a.x, a.y)) SFX.monsterDie();
    if (a.kind === 'rabbit') {
      burst(a.x, a.y - 3, '#eef2fa', 10, 45, 0.5);
      burst(a.x, a.y - 3, '#c9d0e2', 6, 35, 0.4);
      spawnDrop(a.x, a.y, 'berry');
      for (let i = 0; i < YIELD.rabbit.coins; i++) spawnDrop(a.x, a.y, 'gold', YIELD.rabbit.each);
    } else if (a.kind === 'deer') {
      burst(a.x, a.y - 5, '#8a6847', 12, 50, 0.55);
      burst(a.x, a.y - 5, '#f2cc6a', 8, 45, 0.5);
      for (let i = 0; i < YIELD.deer.coins; i++) spawnDrop(a.x, a.y, 'gold', YIELD.deer.each);
      addFloater(a.x, a.y - 14, 'GOLD!', '#f2cc6a');
    } else if (a.kind === 'wolf') {
      burst(a.x, a.y - 5, '#6f778c', 12, 50, 0.55);
      burst(a.x, a.y - 5, '#e04a54', 8, 45, 0.5);
      for (let i = 0; i < YIELD.wolf.coins; i++) spawnDrop(a.x, a.y, 'gold', YIELD.wolf.each);
      addFloater(a.x, a.y - 16, 'WOLF DOWN', '#f2cc6a');
    } else if (a.kind === 'bird') {
      burst(a.x, a.y - a.alt, '#cfd6e4', 9, 40, 0.5, true);
      for (let i = 0; i < YIELD.bird.coins; i++) spawnDrop(a.x, a.y, 'gold', YIELD.bird.each);
      flushBirds(a.home, a); // the rest of the flock does not stay to watch
    }
  }

  // ---- wolves: the landmark that hunts back --------------------------------
  // A wolf holds station at its den and wakes when a player comes inside its
  // sight (much further after dark), runs them down at WOLF_SPD - faster than a
  // walk, slower than a slide, so the answer is momentum, not distance - and
  // bites on its own cooldown. damagePlayer's i-frames are what stops four
  // wolves shredding anyone instantly: the pack is pressure, not burst. Waking
  // one wakes the den, which is what makes it a place instead of four animals.
  function wakePack(w, t) {
    if (!t) return;
    if (!w.home) { w.target = t; return; }
    let howl = false;
    for (const o of animals) {
      if (o.dead || o.kind !== 'wolf' || o.home !== w.home) continue;
      if (!o.target) howl = true;
      o.target = t;
    }
    if (howl && nearPlayer(w.x, w.y, 260)) SFX.howl();
  }

  function updateWolf(a, dt) {
    const L = a.home;
    const hx = L ? (L.tx + 0.5) * TILE : a.x, hy = L ? (L.ty + 0.5) * TILE : a.y;
    a.biteCd = Math.max(0, a.biteCd - dt);

    // keep the current quarry while it is still worth keeping, else look around
    let t = a.target;
    const leashed = (p) => Math.hypot(p.x - hx, p.y - hy) < WOLF_LEASH;
    if (t && (!t.active || t.dead || inAir(t) || !leashed(t))) t = null;
    if (!t) {
      let bd = WOLF_SIGHT * (1 + state.darkness * 0.75); // night gives the pack its teeth
      for (const p of players) {
        if (!p.active || p.dead || inAir(p) || !leashed(p)) continue;
        const d = Math.hypot(p.x - a.x, p.y - a.y);
        if (d < bd) { bd = d; t = p; }
      }
      if (t) wakePack(a, t);
    }
    a.target = t;

    let moving = false;
    if (t) {
      const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy) || 1;
      a.mvx = dx / d; a.mvy = dy / d;
      moveEntity(a, (a.mvx * WOLF_SPD + a.kbx) * dt, (a.mvy * WOLF_SPD + a.kby) * dt, 4.5);
      moving = true;
      if (d < WOLF_BITE_R && a.biteCd <= 0) {
        a.biteCd = WOLF_BITE_CD;
        damagePlayer(t, WOLF_BITE_DMG, a.mvx, a.mvy, null, 'wolf');
        burst(a.x + a.mvx * 6, a.y - 4, '#e04a54', 5, 40, 0.35);
        if (nearPlayer(a.x, a.y)) SFX.bite();
      }
    } else if (a.moveT > 0) {
      // patrolling its den
      a.moveT -= dt;
      moving = true;
      const mv = moveEntity(a, (a.mvx * 34 + a.kbx) * dt, (a.mvy * 34 + a.kby) * dt, 4.5);
      if (mv.blockedX || mv.blockedY) a.moveT = 0;
      if (a.moveT <= 0) a.idleT = rand(0.8, 2.6);
    } else {
      a.idleT -= dt;
      if (Math.abs(a.kbx) + Math.abs(a.kby) > 1) moveEntity(a, a.kbx * dt, a.kby * dt, 4.5);
      if (a.idleT <= 0) {
        // wander, but never far from the den it belongs to
        const away = Math.hypot(a.x - hx, a.y - hy);
        const ang = away > (L ? L.r : 4) * TILE * 0.8
          ? Math.atan2(hy - a.y, hx - a.x) + rand(-0.5, 0.5)
          : rng() * Math.PI * 2;
        a.mvx = Math.cos(ang); a.mvy = Math.sin(ang);
        a.moveT = rand(0.8, 2);
      }
    }

    if (moving && Math.abs(a.mvx) > 0.05) a.dir = a.mvx > 0 ? 'right' : 'left';
    a.animT += dt * (moving ? (t ? 12 : 6) : 0);
    a.moving = moving;
  }

  // ---- birds: the landmark that will not stand still ----------------------
  // Perched in the rookery's snags until a player gets inside BIRD_FLUSH, and
  // then the whole stand goes up at once - the flock is the point, one bird
  // leaving alone would read as a bug. In the air they are the hardest shot in
  // the game: small body, no straight line, and they come down again on their
  // own perch when they have settled.
  function flushBirds(L, from) {
    if (!L) return;
    let woke = false;
    for (const b of animals) {
      if (b.dead || b.kind !== 'bird' || b.home !== L) continue;
      if (b.flyT <= 0) { woke = true; burst(b.x, b.y - b.alt, '#cfd6e4', 4, 30, 0.35); }
      b.flyT = Math.max(b.flyT, rand(2.4, 4.2));
      b.fa = Math.atan2(b.y - from.y, b.x - from.x) + rand(-0.7, 0.7);
      b.perch = rookeryPerch(L) || b.perch;
    }
    if (woke && nearPlayer(from.x, from.y, 220)) SFX.wings();
  }

  function updateBird(a, dt) {
    const L = a.home;
    // anyone this close puts the whole rookery up (only a bird still on its
    // perch tests for it - once the flock is up there is nothing left to flush)
    if (a.flyT <= 0) for (const p of players) {
      if (!p.active || p.dead || inAir(p)) continue;
      if (Math.hypot(p.x - a.x, p.y - (a.y - a.alt)) < BIRD_FLUSH) { flushBirds(L, p); break; }
    }

    if (a.flyT > 0) {
      a.flyT -= dt;
      a.alt += (26 - a.alt) * Math.min(1, dt * 2.5);
      // the last beat of the flight is the run back to the perch; before that
      // it is a wandering circuit that never leaves the stand
      const home = a.perch ? { x: (a.perch.tx + 0.5) * TILE, y: (a.perch.ty + 0.5) * TILE }
        : { x: (L ? L.tx + 0.5 : a.x / TILE) * TILE, y: (L ? L.ty + 0.5 : a.y / TILE) * TILE };
      const out = Math.hypot(a.x - home.x, a.y - home.y);
      if (a.flyT < 1.1 || out > (L ? L.r + 2 : 6) * TILE) {
        const want = Math.atan2(home.y - a.y, home.x - a.x);
        let da = want - a.fa;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        a.fa += Math.max(-4 * dt, Math.min(4 * dt, da));
      } else {
        a.fa += Math.sin(a.animT * 1.7) * 2.2 * dt;
      }
      a.x += Math.cos(a.fa) * BIRD_SPD * dt;
      a.y += Math.sin(a.fa) * BIRD_SPD * dt;
      a.mvx = Math.cos(a.fa);
      // never pop across the stand: stay up until it is actually over the perch
      if (a.flyT <= 0) {
        if (out > 8) a.flyT = 0.25;
        else if (a.perch) { a.x = home.x + rand(-3, 3); a.y = home.y; }
      }
    } else {
      // perched: settle into the branches and shuffle about
      a.alt += (BIRD_ALT - a.alt) * Math.min(1, dt * 4);
      a.idleT -= dt;
      if (a.idleT <= 0) { a.idleT = rand(0.9, 3); a.dir = rng() < 0.5 ? 'left' : 'right'; }
    }

    if (a.flyT > 0 && Math.abs(a.mvx) > 0.05) a.dir = a.mvx > 0 ? 'right' : 'left';
    a.animT += dt * (a.flyT > 0 ? 14 : 0);
    a.moving = a.flyT > 0;
    a.x = Math.max(8, Math.min(WORLD * TILE - 8, a.x));
    a.y = Math.max(8, Math.min(WORLD * TILE - 8, a.y));
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
  const LANDMARK_ORDER = ['wolfDen', 'rookery']; // placement order: the pickiest site first

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

  // a landmark's glyph, centred on x,y: a rim pass so it reads on parchment,
  // snow and forest alike, then the ink
  function drawLandmarkIcon(g, L, x, y, col, rim) {
    const x0 = Math.round(x) - 3, y0 = Math.round(y) - 3;
    g.fillStyle = rim || '#241a10';
    for (const [rx, ry, rw, rh] of L.spec.icon) g.fillRect(x0 + rx - 1, y0 + ry - 1, rw + 2, rh + 2);
    g.fillStyle = col || L.spec.mark;
    for (const [rx, ry, rw, rh] of L.spec.icon) g.fillRect(x0 + rx, y0 + ry, rw, rh);
  }

  // ------------------------------------------------------------ structures & robots
  const RES_COLORS = { gold: '#f2cc6a', berry: '#f2707a', fish: '#7ac0e8' };
  // audio/screen gating: is this happening near the local listener?
  function nearPlayer(x, y, r) { return !!player && Math.hypot(player.x - x, player.y - y) < (r || 180); }

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
          if (nearPlayer(ox, oy)) { SFX.place(); state.shake = Math.max(state.shake, 1.5); }
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
            spawnDrop(ox, oy - 2, 'gold', t.pay);
            addFloater(ox, oy - 12, '+' + t.pay, RES_COLORS.gold);
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
      home: sp, team: sp.team === undefined ? 0 : sp.team, owner: sp.owner === undefined ? 0 : sp.owner,
      tgt: null, workT: 0, stuckT: 0, atkCd: 0,
      jitterT: 0, jitterA: 0,
      carry: 0, // gold held, deposited at home
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
        if (Math.abs(b.kbx) + Math.abs(b.kby) > 1) moveEntity(b, b.kbx * dt, b.kby * dt, 3); // shoved while idle
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
      if (b.carry <= 0) return;
      gainGold(players[b.owner] || player, b.carry);
      addFloater(hx, hy - 14, '+' + b.carry, RES_COLORS.gold);
      b.carry = 0;
      if (nearPlayer(hx, hy)) SFX.pickup();
    };

    const harvest = () => {
      const t = b.tgt, ox = t.tx * TILE + 8, oy = t.ty * TILE + 8;
      t.flash = 0.1;
      t.shake = 0.22;
      if (t.type === 'tree') {
        t.hp--;
        b.carry += YIELD.treeHit;
        if (nearPlayer(ox, oy)) SFX.chop();
        burst(ox, oy - 10, '#eef4fb', 3, 35, 0.4, true);
        if (t.hp <= 0) {
          objects[idx(t.tx, t.ty)] = { type: 'stump', tx: t.tx, ty: t.ty, flash: 0, shake: 0 };
          b.carry += YIELD.treeFall;
          if (t.rare) b.carry += YIELD.treeRare;
          burst(ox, oy - 8, '#eef4fb', 8, 45, 0.5, true);
          if (nearPlayer(ox, oy)) SFX.treeFall();
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

    const carryTotal = b.carry;

    if (b.stuckT > 5) { b.tgt = null; b.stuckT = 0; }

    if (home.mode === 'guard') {
      // no raiders to fight: guard mode just loiters near home
      b.tgt = null;
      if (carryTotal > 0) {
        if (walkToward(hx, hy) < 14) deposit();
      } else {
        wander();
      }
    } else if (carryTotal >= 8) {
      if (walkToward(hx, hy) < 14) deposit();
    } else {
      if (b.tgt && objects[idx(b.tgt.tx, b.tgt.ty)] !== b.tgt) b.tgt = null;
      if (!b.tgt) {
        b.tgt = nearestObj(hx, hy, 8, (o) =>
          o.type === 'tree' || o.type === 'rock');
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
  // The pointer is measured from the press point (w.ax/ay), not from the wheel's
  // drawn hub: that press is what the hand remembers, and the hub drifts as the
  // camera follows the player. Only this much travel is "I haven't chosen yet" -
  // a flick in any direction commits, and drawWheelStick() shows the travel.
  const WHEEL_DEAD = 2;

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
    // travel since the press, not distance from the hub
    const dx = mouse.x - w.ax, dy = mouse.y - w.ay;
    const dist = Math.hypot(dx, dy);
    let seg = -1;
    if (dist >= WHEEL_DEAD) { // anything past the deadzone picks a segment; sitting still cancels
      const ang = Math.atan2(dy, dx);
      let bd = 1e9;
      for (let i = 0; i < opts.length; i++) {
        let d = Math.abs(ang - opts[i].ang);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < bd) { bd = d; seg = i; }
      }
    }
    return { cx, cy, opts, seg, dx, dy, dist };
  }

  // the wheel writes a one-shot order into the local player's input; the sim
  // performs it next step, so a build races other players' orders fairly
  function resolveWheel() {
    const w = state.wheel;
    const L = wheelLayout();
    if (L.seg < 0) return; // released in the deadzone = cancel
    player.input.cmd = { kind: w.kind === 'build' ? 'build' : L.opts[L.seg].id, tx: w.tx, ty: w.ty, id: L.opts[L.seg].id };
  }

  // run a queued build/manage order for any player
  function runCmd(p, c) {
    if (c.kind === 'build') { placeStruct(c.tx, c.ty, c.id, p); return; }
    const o = objAt(c.tx, c.ty);
    if (!o || !STRUCTS[o.type] || o.building || !ownsStruct(o, p)) return;
    if (Math.hypot(c.tx * TILE + 8 - p.x, c.ty * TILE + 8 - p.y) > 60) return;
    if (c.kind === 'upgrade') startUpgrade(o, p);
    else if (c.kind === 'demolish') demolishStruct(o, p);
    else if (c.kind === 'mode') {
      o.mode = o.mode === 'gather' ? 'guard' : 'gather';
      addFloater(o.tx * TILE + 8, o.ty * TILE - 4, o.mode.toUpperCase(), '#ffd95c');
      if (nearPlayer(o.tx * TILE + 8, o.ty * TILE + 8)) SFX.pickup();
    }
  }

  // src: the player who dealt it (kill credit + the log line), null for the
  // world; cause: a DEATH_CAUSE key naming what the world did, when src is null
  function damagePlayer(p, dmg, dx, dy, src, cause) {
    if (p.dead || p.invuln > 0) return;
    p.hp -= dmg;
    p.hurtT = 0.25;
    p.invuln = 0.7;
    p.kbx = dx * 110; p.kby = dy * 110;
    if (p === player) state.shake = Math.max(state.shake, 3);
    addDmgFloater(p.x, p.y - 18, dmg, p === player);
    if (nearPlayer(p.x, p.y)) SFX.hurt();
    burst(p.x, p.y - 6, '#e04a54', 8, 50, 0.45);
    if (p.hp <= 0) die(p, src, cause);
  }

  // what the log says when nobody gets the credit
  const DEATH_CAUSE = { ice: 'FELL THROUGH THE ICE', wolf: 'WENT TO THE WOLVES' };

  // any slot can go down; only the local one takes the screen with it
  function die(p, src, cause) {
    p.dead = true;
    p.respawnT = 2.6;
    p.charging = false;
    p.chargeT = 0;
    p.dodgeT = 0;
    p.vx = p.vy = 0;
    p.sliding = false;
    p.fallT = 0;
    p.swingT = p.swingCd = 0;
    p.inv.gold = Math.ceil(p.inv.gold * 0.6);
    p.inv.berry = Math.ceil(p.inv.berry * 0.6);
    p.inv.fish = Math.ceil(p.inv.fish * 0.6);
    burst(p.x, p.y - 6, TEAMS[p.team].mark, 12, 55, 0.6);
    // kill credit and the feed line: the killer's colours if there is one,
    // otherwise the victim's, since the victim is who the line is about
    const killer = src && src !== p ? src : null;
    if (killer) killer.kills++;
    logEvent(killer ? killer.name + ' SHOT ' + p.name
      : p.name + ' ' + (DEATH_CAUSE[cause] || 'WENT DOWN'), killer || p);
    if (p === player) {
      state.mode = 'dead';
      state.mapOpen = false;
      state.settingsOpen = false;
      state.wheel = null;
      state.deadTimer = 0;
    } else {
      addFloater(p.x, p.y - 20, p.name + ' DOWN', TEAMS[p.team].mark);
    }
  }

  function respawn(p) {
    p.reset(false); // back where it landed from the eagle, with i-frames
    if (p === player) {
      state.mode = 'play';
      showMsg('YOU WOKE WHERE YOU LANDED  -  SOME SUPPLIES LOST', 4);
    }
  }

  // ------------------------------------------------------------ ai
  // Bot slots. A bot only ever writes the same input struct a human fills in -
  // movement axis, aim point, fire / work / slide / dodge and the odd build
  // order - so it can never do anything a player couldn't. The brain is a small
  // priority ladder, re-picked a few times a second: eat, fight, wolves, hunt,
  // unwedge, loot, spend, harvest, roam. Every pursuit carries a give-up timer, because
  // nothing here paths around an obstacle.
  const AI_SIGHT = 150;   // px: how far a bot notices a rival
  const AI_HUNT = 120;    // px: how far it will go after an animal
  const AI_FORAGE = 12;   // tiles: how far from itself it looks for work

  function aiNearestEnemy(p) {
    let best = null, bd = AI_SIGHT;
    for (const q of players) {
      if (!enemyOf(p, q)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  // wolves that are already on this bot, or close enough to be about to be
  function aiNearestWolf(p) {
    let best = null, bd = 92;
    for (const a of animals) {
      if (a.dead || a.kind !== 'wolf') continue;
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bd || (a.target === p && d < AI_SIGHT)) { bd = Math.min(bd, d); best = a; }
    }
    return best;
  }

  function aiNearestAnimal(p) {
    let best = null, bd = AI_HUNT;
    for (const a of animals) {
      // a flushed bird is a wild goose chase for something with no pathfinding
      if (a.dead || a.kind === 'bird' || a === p.ai.huntAvoid) continue;
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // arrows die on solids, so a bot only shoots when the flight path is open
  function aiLineClear(p, x, y) {
    const dx = x - p.x, dy = y - (p.y - BOW_Y), d = Math.hypot(dx, dy) || 1;
    for (let s = 10; s < d; s += 8) {
      if (isSolidTile(Math.floor((p.x + dx / d * s) / TILE), Math.floor((p.y - BOW_Y + dy / d * s) / TILE))) return false;
    }
    return true;
  }

  // Bots have no pathfinding, so they only take work they can stand beside in
  // the open: a target ringed by solids is a dead end inside the treeline, and
  // chasing one walks the bot in and wedges it there.
  function aiOpenSides(tx, ty) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tx + dx, ny = ty + dy;
      if (inWorld(nx, ny) && !isSolidTile(nx, ny) && ground[idx(nx, ny)] !== 2) n++;
    }
    return n;
  }

  function updateAI(p, dt) {
    const inp = p.input, ai = p.ai;
    inp.mx = 0; inp.my = 0; inp.work = false; inp.slide = false;
    if (p.dead || p.fallT > 0) { inp.fire = false; return; }

    const steerTo = (x, y) => {
      const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy) || 1;
      inp.mx = dx / d; inp.my = dy / d;
      return d;
    };
    const aimAt = (x, y) => { inp.aimX = x; inp.aimY = y; };

    ai.thinkT -= dt;
    if (ai.buildT > 0) ai.buildT -= dt;

    // 1. food, exactly as a human eats it (Q / F)
    if (p.hp < p.maxHp * 0.5 && p.inv.fish > 0) inp.eatFish = true;
    else if (p.hp < p.maxHp * 0.8 && p.inv.berry > 0) inp.eatBerry = true;

    // 2. a rival in sight: circle at bow range and shoot
    const foe = aiNearestEnemy(p);
    if (foe) {
      const d = Math.hypot(foe.x - p.x, foe.y - p.y);
      aimAt(foe.x, foe.y - 6);
      const side = p.id % 2 ? 1 : -1;
      const a = Math.atan2(foe.y - p.y, foe.x - p.x);
      // hold ~70px: close in when far, back off when crowded, strafe in between
      const clear = aiLineClear(p, foe.x, foe.y - 6);
      const turn = !clear || d > 85 ? 0.3 * side : d < 50 ? Math.PI * 0.85 * side : Math.PI / 2 * side;
      inp.mx = Math.cos(a + turn); inp.my = Math.sin(a + turn);
      inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.95; // draw, then loose near full
      if (p.hp < p.maxHp * 0.45 && p.dodgeCharges > 0 && rng() < dt * 2) inp.dodge = true;
      ai.tgt = null;
      return;
    }

    // 3. wolves hunt back: a bot that wanders into a den has to fight its way
    //    out, so it shoots the nearest one and gives ground while it does
    const wolf = aiNearestWolf(p);
    if (wolf) {
      const d = Math.hypot(wolf.x - p.x, wolf.y - p.y);
      const clear = aiLineClear(p, wolf.x, wolf.y - 4);
      aimAt(wolf.x, wolf.y - 4);
      const away = Math.atan2(p.y - wolf.y, p.x - wolf.x);
      if (d < 64) { inp.mx = Math.cos(away); inp.my = Math.sin(away); }
      inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.7;
      if (d < 30 && p.dodgeCharges > 0 && rng() < dt * 3) inp.dodge = true;
      ai.tgt = null;
      return;
    }

    // 4. meat is gold: chase and shoot the nearest animal, but give up on one
    //    it cannot corner - a bot pinned against a treeline would chase forever
    if (ai.huntAvoidT > 0) { ai.huntAvoidT -= dt; if (ai.huntAvoidT <= 0) ai.huntAvoid = null; }
    const prey = aiNearestAnimal(p);
    if (prey) {
      if (prey !== ai.huntTgt) { ai.huntTgt = prey; ai.huntT = 0; }
      ai.huntT += dt;
      if (ai.huntT > 6) {
        ai.huntAvoid = prey; ai.huntAvoidT = 15;
        ai.huntTgt = null; ai.huntT = 0;
      } else {
        const clear = aiLineClear(p, prey.x, prey.y - 3);
        const d = Math.hypot(prey.x - p.x, prey.y - p.y);
        aimAt(prey.x, prey.y - 3);
        if (d > 55 || !clear) steerTo(prey.x, prey.y);
        inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.8;
        ai.tgt = null;
        return;
      }
    }
    inp.fire = false;

    // 5. wedged a moment ago: head back to open ground before doing anything else
    if (ai.escapeT > 0) {
      ai.escapeT -= dt;
      steerTo(ai.wx, ai.wy);
      aimAt(p.x + inp.mx * 24, p.y + inp.my * 24);
      return;
    }

    // 6. loot on the ground is neutral and first-come: pick up what is close
    let loot = null, ld = 72;
    for (const d of drops) {
      if (d.t < 0.35) continue;
      const dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd < ld) { ld = dd; loot = d; }
    }
    if (loot && ai.lootT < 4) { ai.lootT += dt; aimAt(loot.x, loot.y); steerTo(loot.x, loot.y); return; }
    if (!loot) ai.lootT = 0;

    // 7. spend the purse: building is the only gold sink, so a bot with money
    //    looks for a stump to build on, then for its own work to upgrade
    if (ai.buildT <= 0 && p.inv.gold >= STRUCTS.generator.tiers[0].cost.gold) {
      const st = nearestObj(p.x, p.y, 5, (o) => o.type === 'stump' && aiOpenSides(o.tx, o.ty) >= 3);
      if (st) {
        const sx = st.tx * TILE + 8, sy = st.ty * TILE + 8;
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d > 40) {
          steerTo(sx, sy);
          // a site it cannot actually walk to must not pin it there
          ai.spendT += dt;
          if (ai.spendT > 6) { ai.buildT = 15; ai.spendT = 0; }
          return;
        }
        if (d > 16) { // clear of the site: order it
          ai.spendT = 0;
          inp.cmd = { kind: 'build', tx: st.tx, ty: st.ty, id: rng() < 0.3 ? 'spawner' : 'generator' };
          ai.buildT = 12;
          return;
        }
        // standing on the site: step off toward the openest neighbouring tile
        // (straight back can be a tree, and then the bot never gets to build)
        let bx = st.tx, by = st.ty, bs = -1;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = st.tx + dx, ny = st.ty + dy;
          if (!inWorld(nx, ny) || isSolidTile(nx, ny) || ground[idx(nx, ny)] === 2) continue;
          const o2 = aiOpenSides(nx, ny);
          if (o2 > bs) { bs = o2; bx = nx; by = ny; }
        }
        steerTo((bx + 0.5) * TILE, (by + 0.5) * TILE);
        ai.spendT += dt;
        if (ai.spendT > 3) { ai.buildT = 15; ai.spendT = 0; } // wedged: go do something else
        return;
      }
      const up = nearestObj(p.x, p.y, 3, (o) => STRUCTS[o.type] && !o.building &&
        o.team === p.team && o.tier < 2 && canAfford(STRUCTS[o.type].tiers[o.tier + 1].cost, p));
      if (up) {
        inp.cmd = { kind: 'upgrade', tx: up.tx, ty: up.ty, id: 'upgrade' };
        ai.buildT = 10;
        return;
      }
      ai.buildT = 4; // nothing worth spending on nearby; look again shortly
    }

    // 8. harvest: walk to a tree/rock/berry bush and hold E on it
    // (a stripped bush stops being work, so drop it the moment it empties)
    if (ai.tgt && (objects[idx(ai.tgt.tx, ai.tgt.ty)] !== ai.tgt ||
      (ai.tgt.type === 'bush' && ai.tgt.berries <= 0))) ai.tgt = null;
    ai.avoidT -= dt;
    if (ai.avoidT <= 0) ai.avoid = null;
    if (!ai.tgt && ai.thinkT <= 0) {
      ai.thinkT = 0.6;
      ai.tgt = nearestObj(p.x, p.y, AI_FORAGE, (o) => o !== ai.avoid &&
        (o.type === 'tree' || o.type === 'rock' || (o.type === 'bush' && o.berries > 0)) &&
        aiOpenSides(o.tx, o.ty) >= 3);
      ai.tgtT = 0;
    }
    if (ai.tgt) {
      const t = ai.tgt;
      aimAt(t.tx * TILE + 8, t.ty * TILE + 8);
      const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
      if (Math.max(Math.abs(t.tx - ptx), Math.abs(t.ty - pty)) <= WORK_REACH) {
        inp.work = true;
        ai.stuckT = 0;
        ai.tgtT = 0; // swinging counts as progress
        return;
      }
      // head for the nearest OPEN tile beside it - always approaching from one
      // fixed side walks bots into the treeline and pins them there
      let bx = t.tx, by = t.ty, bd = 1e9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = t.tx + dx, ny = t.ty + dy;
        if (!inWorld(nx, ny) || isSolidTile(nx, ny) || ground[idx(nx, ny)] === 2) continue;
        const d = Math.hypot((nx + 0.5) * TILE - p.x, (ny + 0.5) * TILE - p.y);
        if (d < bd) { bd = d; bx = nx; by = ny; }
      }
      steerTo((bx + 0.5) * TILE, (by + 0.5) * TILE);
      // there is no pathfinding, so anything it grinds against or simply cannot
      // reach in time gets dropped and left alone for a while
      ai.stuckT = Math.hypot(p.vx, p.vy) < 25 ? ai.stuckT + dt : 0;
      ai.tgtT += dt;
      if (ai.stuckT > 2 || ai.tgtT > 8) {
        ai.avoid = t; ai.avoidT = 12;
        ai.tgt = null; ai.stuckT = 0; ai.tgtT = 0;
        // back out to open ground before trying anything else: with no
        // pathfinding, the only way out of a dead end is to leave it
        ai.escapeT = 3;
        ai.wx = (p.spawn.tx + 0.5) * TILE + rand(-5, 5) * TILE;
        ai.wy = (p.spawn.ty + 0.5) * TILE + rand(-5, 5) * TILE;
        ai.roam = 3;
      }
      return;
    }

    // 9. nothing to do: roam between its camp and the middle of the map
    ai.roam -= dt;
    if (ai.roam <= 0) {
      ai.roam = rand(3, 7);
      const toward = rng() < 0.5 ? { x: cx * TILE, y: cy * TILE } :
        { x: (p.spawn.tx + 0.5) * TILE, y: (p.spawn.ty + 0.5) * TILE };
      ai.wx = toward.x + rand(-14, 14) * TILE;
      ai.wy = toward.y + rand(-14, 14) * TILE;
    }
    if (steerTo(ai.wx, ai.wy) < 20) ai.roam = 0;
    aimAt(p.x + inp.mx * 24, p.y + inp.my * 24);
  }

  // ------------------------------------------------------------ update
  let camX = 0, camY = 0;

  // apply pending camera zoom (overlays and non-play modes drop to base zoom so
  // the fixed-size panels fit; zoomMax can shrink on a window resize) and the
  // eagle drop's zoomed-out row target. Refits only when something changed.
  function applyView() {
    const ze = (state.mode !== 'play' || state.mapOpen || state.settingsOpen)
      ? 0 : Math.min(zoomStep, zoomMax);
    const rows = state.mode === 'drop' ? DROP_ROWS : TARGET_ROWS;
    if (ze !== zoomEff || rows !== viewRows) { zoomEff = ze; viewRows = rows; fitCanvas(); relayout(); }
  }

  function update(dt) {
    applyView();

    // time (the clock starts with the eagle - the match is live while you ride)
    if (state.mode === 'play' || state.mode === 'drop') {
      state.time += dt;
      state.elapsed += dt;
      if (state.time >= CYCLE) {
        state.time -= CYCLE;
        state.day++;
        SFX.dawnChime();
        showMsg('DAY ' + state.day, 3);
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

    if (state.mode === 'dead') state.deadTimer += dt; // the overlay's fade; respawn is per player

    // the match runs on while the local player is down - other slots are still
    // playing. Only the local overlays (pause, map, settings) stop the sim.
    if ((state.mode === 'play' || state.mode === 'dead' || state.mode === 'drop') &&
      !state.paused && !state.mapOpen && !state.settingsOpen) {
      sampleHumanInput(player);
      updatePlay(dt);
    } else if (state.mode === 'play' || state.mode === 'dead' || state.mode === 'drop') {
      sampleHumanInput(player); // still drops a held draw when an overlay opens
    } else if (state.mode === 'title') {
      updateTitle(dt); // menu timers, camera drift, and the ambient world behind it
    }

    // camera
    if (state.mode === 'title') {
      const c = titleCamTarget();
      camX = c.x; camY = c.y;
    } else if (state.mode === 'drop') {
      // riding: track the eagle (the rider sits on it); falling: hold over the
      // landing point. The first INTRO_T eases in from where the drift left off.
      const tx = player.x - VIEW_W / 2, ty = player.y - VIEW_H / 2;
      if (state.intro > 0) {
        state.intro = Math.max(0, state.intro - dt);
        const q = easeInOut(1 - state.intro / state.introLen);
        camX = state.introFrom.x + (tx - state.introFrom.x) * q;
        camY = state.introFrom.y + (ty - state.introFrom.y) * q;
      } else {
        camX += (tx - camX) * Math.min(1, dt * 9);
        camY += (ty - camY) * Math.min(1, dt * 9);
      }
    } else {
      const lookX = (mouse.x - VIEW_W / 2) * 0.12;
      const lookY = (mouse.y - VIEW_H / 2) * 0.12;
      const tx = player.x - VIEW_W / 2 + lookX;
      const ty = player.y - VIEW_H / 2 + lookY;
      if (state.intro > 0) {
        // landing -> play: glide from the touchdown framing onto the play
        // camera with an ease, instead of the play lerp's snap
        state.intro = Math.max(0, state.intro - dt);
        const q = easeInOut(1 - state.intro / state.introLen);
        camX = state.introFrom.x + (tx - state.introFrom.x) * q;
        camY = state.introFrom.y + (ty - state.introFrom.y) * q;
        if (state.intro === 0) showMsg('EARN GOLD - HOLD E AT A TREE OR ROCK', 6);
      } else {
        camX += (tx - camX) * Math.min(1, dt * 7);
        camY += (ty - camY) * Math.min(1, dt * 7);
      }
    }
    camX = Math.max(0, Math.min(WORLD * TILE - VIEW_W, camX));
    camY = Math.max(0, Math.min(WORLD * TILE - VIEW_H, camY));

    // screen fades (the reroll whiteout)
    if (state.fade) {
      const f = state.fade;
      const up = f.to > f.a;
      f.a += (up ? 1 : -1) * f.spd * dt;
      if (up ? f.a >= f.to : f.a <= f.to) {
        f.a = f.to;
        const then = f.then; f.then = null;
        if (f.a === 0) state.fade = null;
        if (then) then();
      }
    }

    state.shake = Math.max(0, state.shake - dt * 12);
    state.msgT = Math.max(0, state.msgT - dt);

    updateFx(dt);
  }

  function updatePlay(dt) {
    state.tick++; // with SEED and the player id, this decides contested orders

    // every slot steps through the same code, each off its own input struct
    // (slots still on or under the eagle are moved by updateDrop instead)
    for (const p of players) {
      if (!p.active || inAir(p)) continue;
      if (p.control === 'ai') updateAI(p, dt);
      updatePlayer(p, dt);
    }
    resolveContests(); // this step's work swings, build orders and fish claims
    if (state.drop) updateDrop(dt);

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
        // players first: the same shot that drops a deer drops a rival
        for (const t of players) {
          if (a.team === t.team || !t.active || t.dead || inAir(t) || t.invuln > 0) continue;
          if (Math.hypot(t.x - a.x, t.y - 6 - a.y) < 7) {
            damagePlayer(t, a.dmg, a.vx / vd, a.vy / vd, players[a.owner]);
            burst(a.x, a.y, '#e04a54', 6, 45, 0.4);
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        const vd = Math.hypot(a.vx, a.vy) || 1;
        for (const an of animals) {
          if (animalHit(an, a.x, a.y)) {
            an.hp -= a.dmg;
            an.flash = 0.12;
            // a wolf does not run from an arrow - the whole den comes for you
            if (an.kind === 'wolf') wakePack(an, players[a.owner]);
            else if (an.kind === 'bird') flushBirds(an.home, a);
            else an.fleeT = an.kind === 'rabbit' ? 1.4 : 2.2;
            addDmgFloater(an.x, an.y - (an.alt || 0) - 12, a.dmg);
            const kb = 25 + 45 * a.pow;
            an.kbx = a.vx / vd * kb; an.kby = a.vy / vd * kb;
            burst(an.x, an.y - (an.alt || 0) - 4, HIT_PUFF[an.kind] || '#a5825a', 6, 40, 0.4);
            if (nearPlayer(an.x, an.y)) SFX.hit();
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
    updateLandmarks(dt); // named sites restock their inhabitants

    // the named place the local player is standing in drives the arrival toast
    if (player.dead || inAir(player)) state.loc = null;
    else {
      const here = landmarkAt(player.x, player.y);
      if (!here) state.loc = null;
      else if (!state.loc || state.loc.L !== here) state.loc = { L: here, t: 0 };
      else state.loc.t += dt;
    }

    // stump-built structures + their robots
    updateStructures(dt);
    for (const b of robots) updateRobot(b, dt);
    for (let i = robots.length - 1; i >= 0; i--) if (robots[i].dead) robots.splice(i, 1);

    // everyone has stepped: push overlapping units apart (players, animals, robots)
    separateUnits();

    // drops
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      d.vz -= 220 * dt;
      d.z += d.vz * dt;
      if (d.z < 0) { d.z = 0; d.vz = -d.vz * 0.4; if (Math.abs(d.vz) < 15) d.vz = 0; }
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= Math.pow(0.05, dt); d.vy *= Math.pow(0.05, dt);
      // drops are neutral: they drift toward whoever is closest, and everyone
      // standing on one claims it - the contest decides who actually gets it
      let near = null, pd = 1e9;
      for (const p of players) {
        if (!p.active || p.dead || inAir(p)) continue;
        const dd = Math.hypot(d.x - p.x, d.y - p.y);
        if (dd < pd) { pd = dd; near = p; }
      }
      if (near && d.t > 0.35 && pd < 28) {
        d.x += (near.x - d.x) * dt * 10;
        d.y += (near.y - d.y) * dt * 10;
      }
      if (d.t > 0.35) for (const p of players) {
        if (!p.active || p.dead || inAir(p) || Math.hypot(d.x - p.x, d.y - p.y) >= 7) continue;
        contest('drop:' + i, p, () => {
          const j = drops.indexOf(d);
          if (j < 0) return;
          drops.splice(j, 1);
          if (d.type === 'gold') gainGold(p, d.n); else p.inv[d.type] += d.n;
          addFloater(p.x, p.y - 14, '+' + d.n, RES_COLORS[d.type]);
          if (p === player) SFX.pickup();
        });
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

    resolveContests(); // the drop pickups queued above
  }

  // One player's step - movement, tools, timers. A human, an AI fill and (later)
  // a network peer all run exactly this; only who wrote p.input differs.
  function updatePlayer(p, dt) {
    const inp = p.input;

    if (p.dead) {
      p.respawnT -= dt;
      inp.dodge = inp.eatBerry = inp.eatFish = false;
      inp.cmd = null;
      if (p.respawnT <= 0) respawn(p);
      return;
    }

    // edge-triggered intents, consumed here so a controller only has to set them
    if (inp.dodge) { inp.dodge = false; tryDodge(p); }
    if (inp.eatBerry) { inp.eatBerry = false; eatBerry(p); }
    if (inp.eatFish) { inp.eatFish = false; eatFish(p); }
    if (inp.cmd) { const c = inp.cmd; inp.cmd = null; runCmd(p, c); }

    // input
    let mx = inp.mx, my = inp.my;
    const len = Math.hypot(mx, my);
    p.moving = len > 0;
    if (len > 0) {
      mx /= len; my /= len;
      if (p.swingT <= 0) {
        if (Math.abs(mx) > Math.abs(my)) p.dir = mx > 0 ? 'right' : 'left';
        else p.dir = my > 0 ? 'down' : 'up';
      }
    }

    p.kbx = (p.kbx || 0) * Math.pow(0.01, dt);
    p.kby = (p.kby || 0) * Math.pow(0.01, dt);

    // ---- unified momentum: input accelerates vx/vy, the surface sets friction/caps
    const ftx = Math.floor(p.x / TILE), fty = Math.floor((p.y + 4) / TILE);
    const onIce = inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1;
    let sp = Math.hypot(p.vx, p.vy);

    // shift-slide: only engages above walking speed; keeps momentum, drops the tools
    const wantSlide = inp.slide && p.dodgeT <= 0;
    const kit = kitOf(p);
    if (!p.sliding && wantSlide && sp > kit.slideMin) {
      p.sliding = true;
    }
    if (p.sliding && (!wantSlide || sp < SLIDE_EXIT)) p.sliding = false;
    // slide fatigue: builds on snow so long slides run out of glide, recovers on
    // ice so a snow->ice->snow chain starts the snow leg fresh-ish
    if (p.sliding) {
      p.slideT = onIce ? Math.max(0, p.slideT - dt * 1.5) : p.slideT + dt * kit.fatigue;
    } else {
      p.slideT = 0;
    }

    if (p.fallT > 0) {
      // floundering in an ice hole: no control until the climb-out
      p.fallT -= dt;
      p.vx = p.vy = 0;
      p.sliding = false;
      p.fallRipT -= dt;
      if (p.fallRipT <= 0) {
        p.fallRipT = 0.16;
        burst(p.x + rand(-3, 3), p.y + 4, '#9fc4dd', 2, 16, 0.3, true);
      }
      if (p.fallT <= 0) {
        // scramble out onto the nearest walkable tile
        const out = nearestDryTile(p.x, p.y, p);
        p.x = (out.tx + 0.5) * TILE;
        p.y = (out.ty + 0.5) * TILE;
        p.invuln = Math.max(p.invuln, 0.8);
        burst(p.x, p.y + 4, '#cfe4f2', 8, 40, 0.45, true);
        if (nearPlayer(p.x, p.y)) SFX.dodge();
      }
    } else if (p.dodgeT > 0) {
      // rolling: the dash owns the velocity; friction waits until the roll ends,
      // so whatever speed the dash reached is carried out for the surface to spend
      p.dodgeT -= dt;
      const mv = moveEntity(p, p.vx * dt, p.vy * dt, PLAYER_R);
      if (mv.blockedX) p.vx = 0;
      if (mv.blockedY) p.vy = 0;
      p.dodgeDustT -= dt;
      if (p.dodgeDustT <= 0) {
        p.dodgeDustT = 0.05;
        burst(p.x, p.y + 5, '#dfe8f4', 2, 22, 0.3, true);
      }
      if (p.dodgeT <= 0) burst(p.x, p.y + 4, '#cfd8e8', 4, 30, 0.3, true);
    } else {
      const chargeMul = p.charging ? kit.chargeMul : 1; // drawn bow slows you
      const walkMax = PLAYER_SPEED * chargeMul;

      if (!onIce && !p.sliding && sp <= walkMax + 6) {
        // plain snow walking: near-instant vector approach, tuned so it feels
        // exactly like the old fixed-speed movement (settles in ~3 frames)
        const f = 1 - Math.exp(-25 * dt);
        p.vx += (mx * walkMax - p.vx) * f;
        p.vy += (my * walkMax - p.vy) * f;
      } else {
        // carrying momentum (ice, slide, or overspeed on snow):
        // steer the heading toward the input, ease the speed toward the target
        let dirx = mx, diry = my;
        if (sp > 1) { dirx = p.vx / sp; diry = p.vy / sp; }
        let steer, decay, target;
        if (p.sliding) {
          // snow friction ramps with slide fatigue: early glide is cheap, the
          // tail drops off hard so slides end decisively
          steer = 1.7; target = 0;
          decay = onIce ? 0.15 : Math.min(2.6, 0.35 + 0.45 * p.slideT);
        } else if (onIce) {
          const cap = ICE_MAX * kit.iceMax * chargeMul;
          if (len > 0) { steer = kit.iceSteer; target = cap; decay = sp < cap ? 1.1 : 0.35; }
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
        p.vx = dirx * sp;
        p.vy = diry * sp;
      }

      const mv = moveEntity(p,
        (p.vx + p.kbx) * dt,
        (p.vy + p.kby) * dt, PLAYER_R);
      if (mv.blockedX) p.vx = 0; // a wall kills that axis instead of grinding
      if (mv.blockedY) p.vy = 0;
    }

    p.x = Math.max(8, Math.min(WORLD * TILE - 8, p.x));
    p.y = Math.max(8, Math.min(WORLD * TILE - 8, p.y));

    // carved ice holes: standing over open water plunges you in (an active
    // dodge roll carries across the gap)
    if (p.fallT <= 0 && p.dodgeT <= 0) {
      const htx = Math.floor(p.x / TILE), hty = Math.floor((p.y + 4) / TILE);
      if (inWorld(htx, hty) && ground[idx(htx, hty)] === 2) {
        p.fallT = HOLE_FALL_T;
        p.fallRipT = 0;
        p.vx = p.vy = 0;
        p.sliding = false;
        p.slideT = 0;
        if (p.charging) { p.charging = false; p.chargeT = 0; }
        if (nearPlayer(p.x, p.y)) SFX.splash();
        burst(p.x, p.y + 4, '#3a6080', 10, 55, 0.5, true);
        burst(p.x, p.y + 2, '#ddf1f8', 8, 60, 0.5, true);
        damagePlayer(p, HOLE_FALL_DMG, 0, 0, null, 'ice');
      }
    }

    // dodge charges refill one at a time
    if (p.dodgeCharges < DODGE_CHARGES) {
      p.dodgeRegenT -= dt;
      if (p.dodgeRegenT <= 0) {
        p.dodgeCharges++;
        p.dodgeRegenT = p.dodgeCharges < DODGE_CHARGES ? DODGE_CD : 0;
      }
    }
    // spent-stamina ghost: hold briefly, then drain toward the live fill
    {
      const regenP = p.dodgeCharges < DODGE_CHARGES ? 1 - p.dodgeRegenT / DODGE_CD : 0;
      const frac = (p.dodgeCharges + regenP) / DODGE_CHARGES;
      if (p.stamGhostT > 0) p.stamGhostT -= dt;
      else p.stamGhost -= dt * 1.6;
      if (p.stamGhost < frac) p.stamGhost = frac;
    }

    const spNow = Math.hypot(p.vx, p.vy);
    if (spNow > 8 && p.dodgeT <= 0 && !p.sliding) {
      p.animT += dt * 9;
      p.footT -= dt;
      if (p.footT <= 0) {
        p.footT = 0.16;
        p.footSide = 1 - p.footSide;
        const side = p.footSide ? 2 : -2;
        const px = p.dir === 'left' || p.dir === 'right' ? p.x : p.x + side;
        const py = p.dir === 'left' || p.dir === 'right' ? p.y + 6 + (p.footSide ? 1 : -1) : p.y + 6;
        footprints.push({ x: px, y: py, t: 0 });
        if (footprints.length > 400) footprints.shift();
      }
    } else {
      p.animT = 0; // sliding/gliding uses the standing pose
    }

    // fast slide: carve a double trail (footprint decals, spaced ~2.5px so the
    // marks overlap into continuous lines) and kick up snow spray. Snow gets
    // two-tone carved grooves (k:1, lip offset toward the outer side); ice gets
    // thin frosted skate scratches (k:2).
    if (p.sliding && spNow > TRAIL_MIN) {
      p.trailD -= spNow * dt;
      const nx = -p.vy / spNow, ny = p.vx / spNow;
      const k = onIce ? 2 : 1;
      let emit = 0;
      while (p.trailD <= 0 && emit++ < 6) {
        // interpolate the mark back along the path so the spacing stays even
        // no matter how far a single frame travelled
        const back = -p.trailD;
        const bx = p.x - ny * back, by = p.y + 6 + nx * back;
        footprints.push({ x: bx + nx * 2, y: by + ny * 2, t: 0, k });
        footprints.push({ x: bx - nx * 2, y: by - ny * 2, t: 0, k });
        p.trailD += 2.5;
      }
      while (footprints.length > 800) footprints.shift();
      p.slideDustT -= dt;
      if (p.slideDustT <= 0) {
        p.slideDustT = 0.1;
        burst(p.x, p.y + 5, '#eef4fb', 1, 18, 0.3, true);
      }
    }

    // swing
    p.swingCd = Math.max(0, p.swingCd - dt);
    if (p.swingT > 0) {
      p.swingT -= dt;
      if (!p.swingHitDone && p.swingT < 0.12) {
        p.swingHitDone = true;
        swingHit(p);
      }
    }
    // the work tool goes away with the swing cooldown; held E brings it right back
    if (p.swingT <= 0 && p.swingCd <= 0) p.tool = TOOL_BOW;
    if (inp.work) tryWork(p);

    // bow: pressing draws, releasing looses - one edge, whoever is holding it
    if (inp.fire && !p.firePrev && !p.charging && p.fallT <= 0 && p.swingT <= 0) {
      p.charging = true;
      p.chargeT = 0;
      if (nearPlayer(p.x, p.y)) SFX.bowDraw();
    }
    if (!inp.fire && p.charging) {
      p.charging = false;
      fireArrow(p);
      p.chargeT = 0;
    }
    p.firePrev = inp.fire;

    // bow draw: charge up and keep facing the aim point
    if (p.charging) {
      p.chargeT = Math.min(kitOf(p).bowCharge, p.chargeT + dt);
      const adx = inp.aimX - p.x, ady = inp.aimY - p.y;
      if (Math.abs(adx) > Math.abs(ady)) p.dir = adx > 0 ? 'right' : 'left';
      else p.dir = ady > 0 ? 'down' : 'up';
    }

    p.hurtT = Math.max(0, p.hurtT - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    // gentle regen in daylight
    if (p.hp < p.maxHp && state.darkness < 0.3) {
      p.hp = Math.min(p.maxHp, p.hp + dt * 0.6);
    }
  }

  // ------------------------------------------------------------ fx updates
  // Snow lives in the world, not on the glass: a flake has a world position,
  // drifts in world px, and scrolls with the camera like everything else. The
  // field is kept exactly one view in size and drawn wrapped modulo VIEW_W/H
  // around the camera, so the screen is always covered at constant density
  // whatever the zoom or view size (fitFlakes sizes the array) while a pan
  // still slides every flake the right way. A flake falls for h world px,
  // lands (rests on the ground fading out for FLAKE_REST s) and is reborn
  // somewhere in the field - the fall is not screen-top to screen-bottom.
  const FLAKE_REST = 0.7;
  const flakes = [];
  // a fresh flake somewhere in the field, from the given random stream
  function makeFlake(r) {
    return {
      x: r() * VIEW_W, y: r() * VIEW_H, // offset inside the field; the camera adds the rest
      h: 30 + r() * 90,                  // world px left to fall before it lands
      rest: 0,                           // >0: landed, seconds of rest left
      spd: 9 + r() * 17, sway: 0.4 + r(), ph: r() * 9,
      size: r() < 0.75 ? 1 : 2, a: 0.35 + r() * 0.45,
    };
  }
  for (let i = 0; i < 70; i++) flakes.push(makeFlake(rng));

  // keep snow density constant across view sizes; resize top-ups draw from a
  // separate seeded stream so they never perturb the main rng's worldgen prefix
  const fxRng = mulberry32((SEED ^ 0x9e3779b9) >>> 0);
  function fitFlakes() {
    const target = Math.round(70 * (VIEW_W * VIEW_H) / (480 * 270));
    while (flakes.length > target) flakes.pop();
    while (flakes.length < target) flakes.push(makeFlake(fxRng));
  }

  function updateFx(dt) {
    const now = performance.now() / 1000;
    for (const f of flakes) {
      if (f.rest > 0) {
        f.rest -= dt;
        if (f.rest <= 0) { // reborn: same slot, new spot in the field
          const n = makeFlake(rng);
          n.x += camX; n.y += camY;
          Object.assign(f, n);
        }
        continue;
      }
      const dy = f.spd * dt;
      f.y += dy; f.h -= dy;
      f.x += Math.sin(now * f.sway + f.ph) * 8 * dt + 4 * dt;
      if (f.h <= 0) f.rest = FLAKE_REST;
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
    // the event feed ages here too: it is chrome, so it fades on wall time in
    // every mode, not only while the sim is stepping
    for (let i = events.length - 1; i >= 0; i--) {
      events[i].t += dt;
      if (events[i].t > EVENT_LIFE) events.splice(i, 1);
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
      const wig = Math.round(Math.sin(f.t * 7) * 1.2);
      ctx.save();
      ctx.translate(Math.round(sx), Math.round(sy));
      ctx.rotate(f.a);
      ctx.globalAlpha = surfaced ? 0.95 : 0.4;
      ctx.fillStyle = surfaced ? '#7fa9c6' : '#4a708c';
      // tapered oval body with a pointed nose (drawn along +x)
      ctx.fillRect(-3, -1, 7, 3);            // core
      ctx.fillRect(-1, -2, 3, 5);            // dorsal/belly bulge amidships
      ctx.fillRect(4, 0, 1, 1);              // nose tip
      // forked tail on a narrow peduncle, waving side to side
      ctx.fillRect(-4, -1 + wig, 1, 3);
      ctx.fillRect(-5, -2 + wig, 1, 2);
      ctx.fillRect(-5, 1 + wig, 1, 2);
      if (surfaced) {
        ctx.fillStyle = '#c9dded';
        ctx.fillRect(-1, 1, 3, 1);           // pale belly
        ctx.fillStyle = '#101d2c';
        ctx.fillRect(2, -1, 1, 1);           // eye
      }
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
      const spr = d.type === 'gold' ? SPRITES.itemGold : SPRITES.itemBerry;
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
    for (const p of players) {
      if (p.dead || inAir(p)) continue; // airborne slots draw in drawDropAir
      draws.push({ y: p.y + 8, p, ghost: !p.active }); // empty slots stand as silhouettes
    }
    for (const a of animals) draws.push({ y: a.y + 4, a });
    for (const b of robots) draws.push({ y: b.y + 4, r: b });
    draws.sort((a, b) => a.y - b.y);

    for (const d of draws) {
      if (d.p) { if (d.ghost) drawGhost(d.p, ex, ey); else drawPlayer(d.p, ex, ey, now); continue; }
      if (d.a) { drawAnimal(d.a, ex, ey, now); continue; }
      if (d.r) { drawRobot(d.r, ex, ey); continue; }
      const o = d.o;
      const px = d.tx * TILE - ox, py = d.ty * TILE - oy;
      const sh = o.shake > 0 ? Math.round(Math.sin(o.shake * 55) * 1.4) : 0;
      if (o.type === 'tree') {
        drawSpriteFlash(SPRITES.tree[o.variant], px + sh, py - 8, o.flash);
      } else if (o.type === 'deadTree') {
        drawSpriteFlash(SPRITES.deadTree[o.variant], px + sh, py - 8, o.flash);
      } else if (o.type === 'den') {
        drawSpriteFlash(SPRITES.den, px + sh, py + 4, o.flash);
      } else if (o.type === 'rock') {
        drawSpriteFlash(SPRITES.rock[o.variant], px + sh, py + 4, o.flash);
      } else if (o.type === 'bush') {
        drawSpriteFlash(o.berries > 0 ? SPRITES.bush : SPRITES.bushEmpty, px + sh, py + 4, o.flash);
      } else if (STRUCTS[o.type]) {
        const spr = structSprite(o);
        if (o.building) {
          const p = o.buildT / o.buildTotal;
          if (p < 1 / 3) ctx.drawImage(SPRITES.scaffold[0], px, py);
          else if (p < 2 / 3) ctx.drawImage(SPRITES.scaffold[1], px, py);
          else {
            drawSpriteFlash(spr, px + sh, py, o.flash);
            ctx.drawImage(SPRITES.scaffold[2], px, py);
          }
        } else {
          drawSpriteFlash(spr, px + sh, py, o.flash);
          if (o.hp < o.maxHp * 0.6) {
            ctx.fillStyle = 'rgba(40,25,15,0.5)';
            ctx.fillRect(px + 4, py + 5, 1, 3); ctx.fillRect(px + 5, py + 8, 1, 2);
            ctx.fillRect(px + 10, py + 3, 1, 4); ctx.fillRect(px + 11, py + 7, 1, 2);
          }
        }
      }
    }

    drawSelection(ox, oy, now);
    drawWorkHint(ox, oy);
    drawFishHint(ex, ey, now);

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

    drawAimLine(ex, ey, now);

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

    // swing arcs (every player who is mid-swing)
    for (const p of players) {
      if (!p.active || p.dead || p.swingT <= 0) continue;
      const prog = 1 - p.swingT / 0.18;
      const a0 = p.swingDir - 1.1 + prog * 2.2;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.8 - prog * 0.6).toFixed(2) + ')';
      for (let i = 0; i < 3; i++) {
        const a = a0 - i * 0.22;
        const rr = 13 - i;
        ctx.fillRect(
          Math.round(p.x + Math.cos(a) * rr - ex),
          Math.round(p.y - 2 + Math.sin(a) * rr - ey), 2, 2);
      }
    }

    // floaters (damage numbers drift sideways, rise faster, and can be 2x)
    for (const f of floaters) {
      const a = 1 - f.t / 0.9;
      ctx.globalAlpha = a;
      const s = f.scale || 1;
      drawPixelTextOutline(ctx, f.txt,
        Math.round(f.x + (f.vx || 0) * f.t - ex - pixelTextWidth(f.txt, s) / 2),
        Math.round(f.y - ey - f.t * (f.rise || 14)), f.color, '#0f1632', s);
      ctx.globalAlpha = 1;
    }

    drawDropAir(ex, ey, now); // the eagle, its rider and anyone falling from it
    renderLighting(ox, oy, now);
    renderWeather(ex, ey);
    renderVignettes();
    renderUI(now);
    if (state.mode === 'drop') renderDropUI(now);
    if (state.mode === 'play' && state.wheel) renderWheel(now);

    if (state.mode === 'play' && state.mapOpen) renderWorldMap(now);
    if (state.mode === 'play' && state.settingsOpen) renderSettings(now);
    if (state.mode === 'title' || state.intro > 0) renderTitle(now);
    if (state.mode === 'dead') renderDead();
    // both sit above the death dim: the feed and the standings are exactly what
    // you read while you are down. They duck under the map/settings panels.
    if (!state.mapOpen && !state.settingsOpen && !window.DBG.hideUI &&
      (state.mode === 'play' || state.mode === 'dead')) renderEventLog();
    if (scoreboardOpen()) renderScoreboard();
    if (settings.fps) drawFps();
    // the menu prints the seed itself (with the reroll die) - don't double it up
    if (!window.DBG.hideUI && state.mode !== 'title') drawSeedTag();
    if (state.fade && state.fade.a > 0) {
      ctx.globalAlpha = Math.min(1, state.fade.a);
      ctx.fillStyle = state.fade.color;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }
    // pointer, last of all so it sits above every overlay
    const cur = cursorInfo();
    applyCursorStyle(cur);
    if (settings.pixelCursor && mouse.inside && !window.DBG.hideUI) drawCursor(cur, now);
  }

  // fps readout, very top-right corner, above every overlay
  function drawFps() {
    const t = 'FPS ' + perf.fps;
    drawPixelTextOutline(ctx, t, VIEW_W - pixelTextWidth(t) - 3, 2,
      perf.fps < 45 ? '#ff9a8a' : '#9fe0a8', '#0f1632');
  }

  // run seed, bottom-right corner - identifies the world and can be replayed via ?seed=N
  function drawSeedTag() {
    drawPixelTextOutline(ctx, SEED_TXT, VIEW_W - pixelTextWidth(SEED_TXT) - 4, VIEW_H - 8,
      '#9fb6d8', '#0f1632');
  }

  // ------------------------------------------------------------ cursor & aim line
  // The pointer is drawn in-canvas (settings.pixelCursor) so it stays on the
  // game's pixel grid at every zoom. cursorInfo() resolves what it should look
  // like this frame, once, and both the pixel cursor and the browser-cursor
  // fallback read from it:
  //   kind  arrow | hand | grab | hammer | reticle
  //   mode  (reticle only) idle | lock | hunt | fish | ice | bow
  //   dim   the action under the pointer is currently blocked / out of reach
  function cursorInfo() {
    if (state.mode === 'title') {
      const m = state.menu;
      if (m.panel === 'settings' && m.panelT >= 1 && !m.closing) {
        if (dragSlider) return { kind: 'grab' };
        return { kind: settingsHit() ? 'hand' : 'arrow' };
      }
      if (m.screen === 'select') return { kind: m.screenT >= 1 && selectHit() >= 0 ? 'hand' : 'arrow' };
      if (!m.panel && menuHit() >= 0) return { kind: 'hand' };
      return { kind: 'arrow' };
    }
    if (state.mode !== 'play') return { kind: 'arrow' };
    if (state.settingsOpen) {
      if (dragSlider) return { kind: 'grab' };
      return { kind: settingsHit() ? 'hand' : 'arrow' };
    }
    if (state.mapOpen || state.paused) return { kind: 'arrow' };
    if (state.wheel) return { kind: wheelLayout().seg >= 0 ? 'hand' : 'arrow' };

    const wx = mouse.x + camX, wy = mouse.y + camY;
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    const o = objAt(tx, ty);
    const busy = player.fallT > 0 || player.dodgeT > 0; // tools locked out
    // build sites (right-click) outrank tool hints; beyond the 60px reach they dim
    if (o && (o.type === 'stump' || (STRUCTS[o.type] && !o.building && o.team === player.team))) {
      const far = Math.hypot(tx * TILE + 8 - player.x, ty * TILE + 8 - player.y) > 60;
      return { kind: 'hammer', dim: far };
    }
    if (player.charging) {
      return { kind: 'reticle', mode: 'bow', frac: Math.min(1, player.chargeT / kitOf(player).bowCharge) };
    }
    // a living thing under the pointer: hunting reticle
    for (const q of players) {
      if (!enemyOf(player, q)) continue;
      if (Math.abs(wx - q.x) <= 8 && wy >= q.y - 14 && wy <= q.y + 4) {
        return { kind: 'reticle', mode: 'hunt', dim: busy };
      }
    }
    for (const a of animals) {
      const hw = a.kind === 'rabbit' ? 7 : a.kind === 'bird' ? 5 : a.kind === 'wolf' ? 9 : 13;
      const h = a.kind === 'rabbit' ? 11 : a.kind === 'bird' ? 7 : a.kind === 'wolf' ? 14 : 22;
      const by = a.y + 4 - (a.alt || 0); // birds ride their alt
      if (Math.abs(wx - a.x) <= hw && wy >= by - h && wy <= by) {
        return { kind: 'reticle', mode: 'hunt', dim: busy };
      }
    }
    // a fish under the ice: water-blue ring (the bow spears it from point-blank)
    if (hoverFish()) return { kind: 'reticle', mode: 'fish', dim: busy };
    // something E can work: lock ring (ice-blue over bare ice), dim out of reach
    const wt = workTarget(player);
    if (wt) return { kind: 'reticle', mode: wt.o ? 'lock' : 'ice', dim: busy || !wt.near };
    return { kind: 'reticle', mode: 'idle', dim: busy };
  }

  // sprite hotspots (the pixel that sits under the true mouse position)
  const CUR_HOT = { arrow: [0, 0], hand: [4, 0], grab: [5, 4], hammer: [6, 5] };
  // reticle looks: colour, tick gap from centre, corner dots
  const RETICLE = {
    idle: { col: '#f4f7ff', gap: 3 },
    lock: { col: '#ffd95c', gap: 3, diag: true },
    hunt: { col: '#f2cc6a', gap: 4, diag: true },
    fish: { col: '#7ac0e8', gap: 4, diag: true },
    ice:  { col: '#a8e0f8', gap: 3, diag: true },
    bow:  { col: '#ffd95c', gap: 6, diag: true },
  };
  let lastCssCursor = null;

  // browser-cursor fallback: hide the native pointer under the pixel cursor,
  // otherwise mirror the resolved state with the nearest CSS cursor
  function applyCursorStyle(info) {
    let css = 'none';
    if (!settings.pixelCursor) {
      css = info.kind === 'reticle' ? 'crosshair' : info.kind === 'grab' ? 'grabbing' :
        info.kind === 'arrow' ? 'default' : 'pointer';
    }
    if (css !== lastCssCursor) { canvas.style.cursor = css; lastCssCursor = css; }
  }

  // outlined pixel rects: every rect gets a dark rim first, then the fill, so
  // touching ticks never eat each other's outline
  function drawOutlinedRects(rects, col, alpha) {
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillStyle = '#0a0e23';
    for (const r of rects) ctx.fillRect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    for (const r of rects) ctx.fillRect(r[0], r[1], r[2], r[3]);
    ctx.globalAlpha = 1;
  }

  function drawCursor(info, now) {
    const mx = Math.round(mouse.x), my = Math.round(mouse.y);
    const base = info.dim ? 0.5 : 1;
    if (info.kind !== 'reticle') {
      const [hx, hy] = CUR_HOT[info.kind];
      ctx.globalAlpha = base * 0.45;
      ctx.drawImage(SPRITES.cursorShadow[info.kind], mx - hx + 1, my - hy + 1);
      ctx.globalAlpha = base;
      ctx.drawImage(SPRITES.cursor[info.kind], mx - hx, my - hy);
      ctx.globalAlpha = 1;
      return;
    }
    const R = RETICLE[info.mode];
    let gap = R.gap, col = R.col;
    if (info.mode === 'bow') {
      // the ring closes as the draw fills and goes hot at full, like the meter
      gap = Math.round(6 - 3 * info.frac);
      if (info.frac >= 1) col = '#ff9440';
    } else if (info.mode === 'hunt') {
      gap = 4 + (((now * 3) | 0) % 2); // slow breathing
    }
    const L = 3; // tick length
    const rects = [
      [mx - gap - L + 1, my, L, 1], [mx + gap, my, L, 1],
      [mx, my - gap - L + 1, 1, L], [mx, my + gap, 1, L],
    ];
    if (R.diag) { // corner dots one step outside the ring so they never fuse with the ticks
      const g = gap + 1;
      rects.push([mx - g, my - g, 1, 1], [mx + g, my - g, 1, 1], [mx - g, my + g, 1, 1], [mx + g, my + g, 1, 1]);
    }
    rects.push([mx, my, 1, 1]);
    drawOutlinedRects(rects, col, base);
  }

  // dotted flight line while the bow is drawn: a static dotted line from the
  // arrow's spawn point through the cursor, exactly as far as the arrow would fly (range grows with the draw),
  // and stop at the first solid tile, since arrows die on those. A fish in
  // bow-fishing reach gets a catch marker instead - that shot never flies.
  function drawAimLine(ex, ey, now) {
    if (!player.charging || state.mode !== 'play') return;
    const full = player.chargeT >= kitOf(player).bowCharge;
    const col = full ? '#ff9440' : '#ffd95c';
    const ftx = Math.floor(player.x / TILE), fty = Math.floor((player.y + 4) / TILE);
    if (inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1) {
      let best = null, bd = FISH_CATCH_R;
      for (const f of fish) {
        const d = Math.hypot(f.x - player.x, f.y - player.y);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) {
        // four ticks closing in over the fish
        const fx = Math.round(best.x - ex), fy = Math.round(best.y - ey);
        const g = 4 + Math.round(Math.abs(Math.sin(now * 4)) * 2);
        drawOutlinedRects([
          [fx - g - 2, fy, 3, 1], [fx + g, fy, 3, 1], [fx, fy - g - 2, 1, 3], [fx, fy + g, 1, 3],
        ], col, 0.95);
        return;
      }
    }
    const p = Math.min(1, Math.max(0.18, player.chargeT / kitOf(player).bowCharge));
    const range = (170 + 190 * p) * 0.85; // speed x lifetime, as fireArrow() sets them
    const x0 = player.x, y0 = player.y - BOW_Y; // exactly fireArrow()'s origin and direction
    const dx = mouse.x + camX - x0, dy = mouse.y + camY - y0;
    const d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
    // walk the flight: stop at the first solid tile or the first animal the
    // arrow would hit (same 8px body test as the arrow update)
    let len = range, blocked = null; // 'solid' | 'animal'
    for (let s = 10; s < range; s += 3) {
      const x = x0 + nx * s, y = y0 + ny * s;
      if (isSolidTile(Math.floor(x / TILE), Math.floor(y / TILE))) { len = s; blocked = 'solid'; break; }
      let hit = false;
      for (const an of animals) if (animalHit(an, x, y)) { hit = true; break; }
      if (!hit) for (const q of players) {
        if (enemyOf(player, q) && Math.hypot(q.x - x, q.y - 6 - y) < 7) { hit = true; break; }
      }
      if (hit) { len = s; blocked = 'animal'; break; }
    }
    // static dots (no animation - it read as clutter), fading toward the end of the flight
    const sp = 6;
    for (let s = 13; s < len - 3; s += sp) {
      const a = 0.95 * (1 - (s / range) * 0.6);
      const sx = Math.round(x0 + nx * s - ex), sy = Math.round(y0 + ny * s - ey);
      ctx.globalAlpha = a * 0.6; ctx.fillStyle = '#0a0e23'; ctx.fillRect(sx + 1, sy + 1, 2, 2);
      ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
    const tx1 = Math.round(x0 + nx * len - ex), ty1 = Math.round(y0 + ny * len - ey);
    if (blocked) {
      // impact cross where the shot lands: line colour on a solid, hunt amber on a body
      const r = [];
      for (let i = -2; i <= 2; i++) r.push([tx1 + i, ty1 + i, 1, 1], [tx1 + i, ty1 - i, 1, 1]);
      drawOutlinedRects(r, blocked === 'animal' ? RETICLE.hunt.col : col, 0.9);
    } else {
      // range cap: a short bar square to the flight line
      const r = [];
      for (let i = -2; i <= 2; i++) r.push([Math.round(tx1 - ny * i), Math.round(ty1 + nx * i), 1, 1]);
      drawOutlinedRects(r, col, 0.55);
    }
  }

  // ------------------------------------------------------------ entity draw
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

  // a building wears its owner's team palette over its tier material
  function structSprite(o) {
    const set = SPRITES.teamBuild[o.team === undefined ? 0 : o.team];
    return set ? set[o.type][o.tier] : SPRITES[o.type][o.tier];
  }

  function drawAnimal(a, ox, oy, now) {
    if (a.kind === 'bird') { drawBird(a, ox, oy); return; }
    const rabbit = a.kind === 'rabbit';
    const wolf = a.kind === 'wolf';
    const set = SPRITES[a.kind][a.dir];
    const frame = a.moving ? 1 + (Math.floor(a.animT) % 2) : 0;
    const spr = set[frame];
    const px = Math.round(a.x - spr.width / 2 - ox);
    const py = Math.round(a.y + 4 - spr.height - oy);
    const sw = rabbit ? 4 : wolf ? 6 : 7;
    ctx.fillStyle = 'rgba(110,130,170,0.35)';
    ctx.fillRect(Math.round(a.x - ox) - sw, Math.round(a.y + 2 - oy), sw * 2, 2);
    drawSpriteFlash(spr, px, py, a.flash);
    drawHealthBar(a.x - ox, py - (rabbit ? 4 : 5), a.hp, a.maxHp, rabbit ? 8 : wolf ? 12 : 16);
  }

  // The only thing in the world that leaves the ground: the sprite lifts off
  // its own shadow by a.alt, which is the whole read on how high a bird is.
  // No health bar - three hp means every hit is a kill, and a bar over
  // something this small is all bar.
  function drawBird(a, ox, oy) {
    const flying = a.flyT > 0;
    const spr = SPRITES.bird[a.dir][flying ? 1 + (Math.floor(a.animT) % 2) : 0];
    const px = Math.round(a.x - spr.width / 2 - ox);
    const py = Math.round(a.y - a.alt - spr.height - oy);
    ctx.fillStyle = flying ? 'rgba(110,130,170,0.22)' : 'rgba(110,130,170,0.3)';
    ctx.fillRect(Math.round(a.x - ox) - 2, Math.round(a.y + 1 - oy), 4, 1);
    drawSpriteFlash(spr, px, py, a.flash);
  }

  function drawRobot(b, ox, oy) {
    const set = SPRITES.robotTeam[b.team === undefined ? 0 : b.team] || SPRITES.robot;
    const spr = set[b.moving ? Math.floor(b.animT) % 2 : 0];
    const px = Math.round(b.x - spr.width / 2 - ox);
    const py = Math.round(b.y + 4 - spr.height - oy);
    ctx.fillStyle = 'rgba(110,130,170,0.35)';
    ctx.fillRect(Math.round(b.x - ox) - 5, Math.round(b.y + 2 - oy), 10, 2);
    drawSpriteFlash(spr, px, py, b.flash);
    drawHealthBar(b.x - ox, py - 4, b.hp, b.maxHp, 10);
  }

  // every player draws through here - the local one, the AI fills, network
  // peers later. Team palette on the sprite, name tag on everybody else.
  function drawPlayer(p, ox, oy, now) {
    const local = p === player;
    const set = champSet(p)[p.dir];
    let frame = 0;
    if (p.moving) frame = 1 + (Math.floor(p.animT) % 2);
    const spr = set[frame];
    const px = Math.round(p.x - 8 - ox);
    const py = Math.round(p.y - 12 - oy);
    // shadow (not while swimming in a hole)
    if (p.fallT <= 0) {
      ctx.fillStyle = 'rgba(110,130,170,0.4)';
      ctx.fillRect(px + 5, py + 15, 6, 2);
    }

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
      // held tool: behind the body when facing away, in the hand otherwise
      const held = state.mode !== 'title';
      const toolBehind = held && p.dir === 'up' && !p.charging && p.swingT <= 0;
      if (toolBehind) drawHeldTool(p, px, py);
      if (p.invuln > 0 && state.mode !== 'title' && ((now * 12) | 0) % 2 === 0) ctx.globalAlpha = 0.45;
      drawSpriteFlash(spr, px, py, p.hurtT > 0.12 ? 1 : 0);
      ctx.globalAlpha = 1;
      if (held && !toolBehind) drawHeldTool(p, px, py);
    }

    if (state.mode === 'title') return;

    drawHealthBar(p.x - ox, py - 7, p.hp, p.maxHp, 14);
    // level badge: a 7x7 square sharing its right frame column with the bar
    // backing's left edge (one 1px frame everywhere, never a doubled wall), and
    // spanning the health bar and the stamina bar stacked (py-8 .. py-2). Same
    // backing / track colours as the bars.
    {
      const bx = Math.round(p.x - ox) - 14, by = py - 8;
      ctx.fillStyle = 'rgba(12,18,42,0.78)';
      ctx.fillRect(bx, by, 6, 7); // 6 wide: the 7th column is the bar backing, already painted
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(bx + 1, by + 1, 5, 5);
      drawPixelText(ctx, String(p.level), bx + 2, by + 1, '#f2cc6a');
    }
    // rivals carry a name tag in their team colour so a fight stays legible
    if (!local) {
      drawPixelTextOutline(ctx, p.name,
        Math.round(p.x - ox - pixelTextWidth(p.name) / 2), py - 18, // clear of the draw meter's frame (top row py-11) with a gap row
        TEAMS[p.team].mark, '#0f1632');
    }
    // dodge stamina: one clean unsegmented bar under the health bar - charges
    // stay discrete in the sim, the bar just shows the pooled total. Drawn for
    // every slot (a rival out of rolls is a tell, and the level badge spans
    // both bars, so a lone hp bar would look broken).
    // The track is painted one row taller than the fill so the gap between the two
    // bars is track grey, not frame colour - one clean outline around both.
    {
      const bx = Math.round(p.x - ox) - 7, by = py - 4;
      ctx.fillStyle = 'rgba(12,18,42,0.78)';
      ctx.fillRect(bx - 1, by, 16, 3); // rows under the hp backing only - the backing is translucent, so overlapping it would paint a darker row
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(bx, by - 1, 14, 3);
      const regenP = p.dodgeCharges < DODGE_CHARGES ? 1 - p.dodgeRegenT / DODGE_CD : 0;
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
    // bow draw meter: yellow while charging, turning hot orange the moment the
    // draw is full. Drawn for everyone - it is the tell that says a shot is
    // coming. It sits inside the shared frame directly above the hp bar, the
    // mirror of the stamina bar below it: its backing adds the rows above the
    // hp backing (frame top at py-11, fill py-10..-9) and the hp backing's top
    // row py-8 becomes the track-grey gap row, so the frame stays one outline.
    if (p.charging) {
      const frac = Math.min(1, p.chargeT / kitOf(p).bowCharge);
      const x = Math.round(p.x - ox) - 7, y = py - 10;
      ctx.fillStyle = 'rgba(12,18,42,0.78)';
      ctx.fillRect(x - 1, y - 1, 16, 3); // rows above the hp backing only (translucent - never overlap)
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(x, y, 14, 3);         // fill rows + the gap row
      ctx.fillStyle = frac >= 1 ? '#ff9440' : '#ffd95c';
      ctx.fillRect(x, y, Math.max(1, Math.round(14 * frac)), 2);
    }
  }

  // an unfilled slot: a flat team-tinted silhouette standing at its camp, so
  // the world shows who is missing rather than pretending the slot isn't there
  function drawGhost(p, ox, oy) {
    const spr = champSet(p)[p.dir][0];
    const px = Math.round(p.x - 8 - ox), py = Math.round(p.y - 12 - oy);
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
    const t = TOOLS[p.tool];
    const icon = SPRITES[t.icon];
    const cxp = px + 8, cyp = py + 10; // roughly the hands

    // drawn bow tracks the aim; base sprite fires -x (arc on the left), so
    // rotating by a + PI points the arc at the target
    if (t.key === 'bow' && p.charging) {
      const a = Math.atan2(p.input.aimY - (p.y - BOW_Y), p.input.aimX - p.x);
      ctx.save();
      ctx.translate(Math.round(cxp + Math.cos(a) * 8), Math.round(cyp - 2 + Math.sin(a) * 8));
      ctx.rotate(a + Math.PI);
      ctx.drawImage(icon, -4, -4);
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
      ctx.drawImage(icon, -4, -4);
      ctx.restore();
      return;
    }

    // carried: sits in the leading hand, with a 1px walk bob
    const bob = p.moving ? Math.floor(p.animT) % 2 : 0;
    if (p.dir === 'left') {
      ctx.save();
      ctx.translate(px + 2, cyp - 2 + bob);
      ctx.scale(-1, 1);
      ctx.drawImage(icon, -4, -4);
      ctx.restore();
    } else if (p.dir === 'right') {
      ctx.drawImage(icon, px + 10, cyp - 6 + bob);
    } else if (p.dir === 'down') {
      ctx.drawImage(icon, px + 10, cyp - 5 + bob);
    } else { // up: far hand, occluded by the body (caller draws us first)
      ctx.drawImage(icon, px - 2, cyp - 5 + bob);
    }
  }

  // ------------------------------------------------------------ selection, hints & wheel
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
      if (o.type !== 'stump' && !(STRUCTS[o.type] && !o.building && o.team === player.team)) return;
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

  // "E  CHOP" key prompt over whatever E would work right now (Fortnite-style):
  // a pixel key-cap that visibly presses while E is held, plus the verb. Only
  // when the target is in reach and tools aren't blocked, so it doubles as
  // the "you're close enough" signal.
  function drawWorkHint(ox, oy) {
    if (state.mode !== 'play' || state.mapOpen || state.settingsOpen || state.wheel) return;
    if (player.charging || player.fallT > 0 || player.dodgeT > 0) return;
    if (hoverFish()) return; // the fish prompt wins over CRACK ICE on the same tile
    const t = workTarget(player);
    if (!t || !t.near) return;
    const tall = t.o && (t.o.type === 'tree' || t.o.type === 'deadTree');
    const verb = !t.o ? 'CRACK ICE' : tall ? 'CHOP' :
      t.o.type === 'bush' ? 'PICK' : 'MINE';
    // sit above the sprite: trees reach 8px above their tile, short objects start 6px below
    const lift = t.o ? (tall ? 20 : 10) : 8;
    const pressed = !!player.input.work;
    const capW = 9, gapW = 3;
    const totalW = capW + gapW + pixelTextWidth(verb);
    const x = Math.round(t.tx * TILE + 8 - ox - totalW / 2);
    let y = Math.round(t.ty * TILE - oy - lift);
    // an adjacent target puts the prompt over the player's head: flip it under the tile instead
    const px0 = Math.round(player.x - ox), py0 = Math.round(player.y - oy);
    if (x < px0 + 9 && x + totalW > px0 - 9 && y < py0 + 5 && y + 10 > py0 - 14) {
      y = Math.round(t.ty * TILE - oy + TILE + 3);
    }
    // key-cap: navy rim, icy face, top highlight; pressed = face drops a pixel, no highlight
    const cy = y + (pressed ? 1 : 0);
    ctx.fillStyle = '#0a0e23';
    ctx.fillRect(x, y, capW, 10);
    ctx.fillStyle = pressed ? '#8fb3d6' : '#c2d8ee';
    ctx.fillRect(x + 1, cy + 1, capW - 2, 8 - (pressed ? 1 : 0));
    if (!pressed) {
      ctx.fillStyle = '#f4f7ff'; ctx.fillRect(x + 1, y + 1, capW - 2, 1);
      ctx.fillStyle = '#8fb3d6'; ctx.fillRect(x + 1, y + 8, capW - 2, 1); // bottom shade = depth
    }
    drawPixelText(ctx, 'E', x + 3, cy + 3, '#0a0e23');
    drawPixelTextOutline(ctx, verb, x + capW + gapW, y + 3, pressed ? '#ffd95c' : '#f4f7ff', '#0f1632');
  }

  // 9x11 pixel mouse, the "click" key-cap. Only the LEFT button carries colour
  // (gold = the game's "active" accent, hot orange while pressed); the right
  // button is plain body so nothing suggests right-click.
  function drawMouseIcon(x, y, pressed) {
    ctx.fillStyle = '#0a0e23';
    ctx.fillRect(x + 1, y, 7, 1); ctx.fillRect(x, y + 1, 9, 8); ctx.fillRect(x + 1, y + 9, 7, 1); ctx.fillRect(x + 2, y + 10, 5, 1);
    ctx.fillStyle = '#c2d8ee';
    ctx.fillRect(x + 1, y + 5, 7, 4); ctx.fillRect(x + 2, y + 9, 5, 1); // body
    ctx.fillRect(x + 5, y + 1, 3, 3); // right button: body colour, nothing to notice
    ctx.fillStyle = '#dce9f5'; ctx.fillRect(x + 1, y + 5, 7, 1); // body highlight under the seam
    ctx.fillStyle = pressed ? '#ff9440' : '#ffd95c'; ctx.fillRect(x + 1, y + 1, 3, 3); // left button
    ctx.fillStyle = '#fff3b0'; ctx.fillRect(x + 1, y + 1, 1, 1); // button glint
  }

  // hovering a fish: white brackets on the fish (the same "this reacts" cue as
  // stumps) and a click prompt - SPEAR in catch range, GET CLOSE otherwise,
  // since the mechanic is standing on the ice beside it, not aiming at it
  function drawFishHint(ex, ey, now) {
    if (state.mode !== 'play' || state.mapOpen || state.settingsOpen || state.wheel) return;
    if (player.fallT > 0 || player.dodgeT > 0) return;
    const f = hoverFish();
    if (!f) return;
    const fx = Math.round(f.x - ex), fy = Math.round(f.y - ey);
    const near = fishInRange(f);
    // brackets: 16x12 box, pulsing like the stump selection
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now * 6);
    const corners = (c, px, py) => {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, 3, 1); ctx.fillRect(px, py, 1, 3);
      ctx.fillRect(px + 13, py, 3, 1); ctx.fillRect(px + 15, py, 1, 3);
      ctx.fillRect(px, py + 11, 3, 1); ctx.fillRect(px, py + 9, 1, 3);
      ctx.fillRect(px + 13, py + 11, 3, 1); ctx.fillRect(px + 15, py + 9, 1, 3);
    };
    corners('rgba(15,22,50,0.9)', fx - 7, fy - 5);
    corners('#ffffff', fx - 8, fy - 6);
    ctx.globalAlpha = near ? 1 : 0.6;
    const verb = near ? 'SPEAR' : 'GET CLOSE';
    const totalW = 9 + 3 + pixelTextWidth(verb);
    const x = Math.round(fx - totalW / 2), y = fy - 26; // clear of an adjacent player's bars
    drawMouseIcon(x, y, near && (mouse.down || player.charging));
    drawPixelTextOutline(ctx, verb, x + 12, y + 3, near ? '#f4f7ff' : '#9fb6d8', '#0f1632');
    ctx.globalAlpha = 1;
  }

  // How far the pointer has travelled since the press that opened the wheel,
  // drawn at the hub as a tiny stick: an origin pip (the press), a dot of trail
  // and a knob that goes gold the instant the deadzone is cleared. The cursor
  // itself can be anywhere on screen, so this is the only readout of the input
  // the choice is actually made with.
  function drawWheelStick(L) {
    const live = L.seg >= 0;
    // A compact stick, not a 1:1 echo of the pointer: the knob snaps STICK_MIN
    // clear of the pip the moment a segment is live (so "I have chosen" is
    // visible at 2 px of travel) and slides out to STICK_R, which stops short
    // of the option icons. A 1:1 mapping would just sit under the cursor.
    const STICK_MIN = 4, STICK_R = 12, STICK_FULL = 26;
    const off = live ? STICK_MIN + (STICK_R - STICK_MIN) * Math.min(1, L.dist / STICK_FULL) : L.dist;
    const k = off / Math.max(0.001, L.dist);
    const kx = Math.round(L.cx + L.dx * k), ky = Math.round(L.cy + L.dy * k);
    if (off > 6) { // a dot of travel between pip and knob
      ctx.fillStyle = live ? 'rgba(255,217,92,0.5)' : 'rgba(159,182,216,0.4)';
      ctx.fillRect(Math.round(L.cx + L.dx * k * 0.5), Math.round(L.cy + L.dy * k * 0.5), 1, 1);
    }
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(L.cx - 2, L.cy - 2, 5, 5);
    ctx.fillStyle = '#8fa4c8'; ctx.fillRect(L.cx - 1, L.cy - 1, 3, 3);
    ctx.fillStyle = '#141c3c'; ctx.fillRect(L.cx, L.cy, 1, 1); // hollow: this is the origin, not the knob
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(kx - 2, ky - 2, 5, 5);
    ctx.fillStyle = live ? '#ffd95c' : '#6d7ea6'; ctx.fillRect(kx - 1, ky - 1, 3, 3);
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
        const spr = SPRITES.teamBuild[player.team][opt.id][0];
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
        drawPixelTextOutline(ctx, label,
          Math.round(ix - pixelTextWidth(label) / 2), Math.round(iy - 2),
          hovered ? '#ffd95c' : '#9fb6d8', '#0f1632');
      }
    }

    drawWheelStick(L);

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
    drawPixelTextOutline(ctx, label,
      Math.round(L.cx - pixelTextWidth(label) / 2),
      Math.round(L.cy + WHEEL_R + 20), color, '#0f1632');
  }

  // ------------------------------------------------------------ lighting & weather
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

  // world-space flakes wrapped into the view (see the flakes block in fx
  // updates); a landed flake fades out where it came to rest
  function renderWeather(ex, ey) {
    ctx.fillStyle = '#ffffff';
    for (const f of flakes) {
      const sx = ((f.x - ex) % VIEW_W + VIEW_W) % VIEW_W;
      const sy = ((f.y - ey) % VIEW_H + VIEW_H) % VIEW_H;
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

  // ------------------------------------------------------------ UI
  function updateMinimap() {
    const d = mmImg.data;
    for (let i = 0; i < WORLD * WORLD; i++) {
      let r, g, b;
      const o = objects[i];
      if (o) {
        if (o.type === 'tree') { r = 52; g = 100; b = 82; }
        else if (o.type === 'deadTree') { r = 138; g = 128; b = 116; }
        else if (o.type === 'den') { r = 92; g = 86; b = 100; }
        else if (o.type === 'rock') { r = 122; g = 131; b = 153; }
        else if (o.type === 'bush') { r = 88; g = 148; b = 108; }
        else if (o.type === 'wall') { r = 163; g = 121; b = 79; }
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
    // the other slots, in team colour, wherever they fall inside the view
    for (const p of players) {
      if (p === player || !p.active || p.dead || inAir(p)) continue;
      const dx = p.x / TILE - ptx, dy = p.y / TILE - pty;
      if (Math.hypot(dx, dy) > MM_R - 1) continue;
      ctx.fillStyle = 'rgba(15,22,50,0.9)';
      ctx.fillRect(Math.round(MM_CX + dx) - 2, Math.round(MM_CY + dy) - 2, 4, 4);
      ctx.fillStyle = TEAMS[p.team].mark;
      ctx.fillRect(Math.round(MM_CX + dx) - 1, Math.round(MM_CY + dy) - 1, 2, 2);
    }
    // named places, glyph only - a name would not fit inside the disc (the
    // world map and the arrival toast are where they are read by name)
    for (const L of landmarks) {
      const dx = L.tx + 0.5 - ptx, dy = L.ty + 0.5 - pty;
      if (Math.hypot(dx, dy) > MM_R - 2) continue;
      drawLandmarkIcon(ctx, L, MM_CX + dx, MM_CY + dy, L.spec.mark, 'rgba(15,22,50,0.9)');
    }
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
    drawPixelTextOutline(ctx, clock, ccx, MM_CY + MM_R + 9, '#f4f7ff', '#0f1632');
  }

  function renderUI(now) {
    if (state.mode === 'title' || state.mode === 'drop' || window.DBG.hideUI) return;

    // title -> play: the HUD slides in over the last part of the intro - the
    // left stack from the left, the minimap stack from the top, messages from below
    const hudIn = state.intro > 0 ? easeOut(Math.max(0, 1 - state.intro / HUD_IN_T)) : 1;
    const slide = 1 - hudIn;
    ctx.save();
    ctx.translate(Math.round(-slide * 60), 0);

    // berries: consumable indicator, top-left (health lives on the in-world bar)
    if (inv.berry > 0) {
      ctx.drawImage(SPRITES.itemBerry, 5, 5);
      drawPixelTextOutline(ctx, String(inv.berry), 15, 7, '#f4f7ff', '#0f1632');
      drawPixelTextOutline(ctx, '(Q)', 17 + pixelTextWidth(String(inv.berry)), 7, '#9fb6d8', '#0f1632');
    }
    // fish: the bigger meal, right below the berries
    if (inv.fish > 0) {
      ctx.drawImage(SPRITES.itemFish, 5, 15);
      drawPixelTextOutline(ctx, String(inv.fish), 15, 17, '#f4f7ff', '#0f1632');
      drawPixelTextOutline(ctx, '(F)', 17 + pixelTextWidth(String(inv.fish)), 17, '#9fb6d8', '#0f1632');
    }

    ctx.restore();
    ctx.save();
    ctx.translate(0, Math.round(-slide * (MM_R * 2 + 40)));

    // the one currency - left of the minimap
    const res = [
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
      drawPixelTextOutline(ctx, String(n), rx + 10, ryTop + 2, '#f4f7ff', '#0f1632');
      rx += 10 + pixelTextWidth(String(n)) + resGap;
    }

    // minimap with day/night ring
    renderMinimap(now);
    ctx.restore();

    // (the bottom strip is deliberately empty: reserved for combat abilities)

    // arriving at a named place announces it, top centre: the name big, its
    // personality under it. Fades on the plate, so it uses the shadow font.
    if (state.loc) {
      const L = state.loc.L, t = state.loc.t;
      const a = t < 0.25 ? t / 0.25 : t > 2.8 ? Math.max(0, 1 - (t - 2.8) / 0.7) : 1;
      if (a > 0) {
        const nw = pixelTextWidth(L.name, 2), tw = pixelTextWidth(L.tag);
        const w = Math.max(nw, tw) + 26;
        const bx = Math.round((VIEW_W - w) / 2), by = 14;
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(12,18,42,0.72)';
        ctx.fillRect(bx, by, w, 24);
        ctx.fillStyle = L.spec.mark;
        ctx.fillRect(bx, by, w, 1); ctx.fillRect(bx, by + 23, w, 1);
        drawLandmarkIcon(ctx, L, bx + 10, by + 12, L.spec.mark, '#0a0e23');
        drawPixelTextShadow(ctx, L.name, Math.round((VIEW_W - nw) / 2) + 7, by + 4, '#f4f7ff', '#0a0e23', 2);
        drawPixelTextShadow(ctx, L.tag, Math.round((VIEW_W - tw) / 2) + 7, by + 15, L.spec.mark, '#0a0e23');
        ctx.globalAlpha = 1;
      }
    }

    // message
    if (state.msgT > 0 && state.msg) {
      const a = Math.min(1, state.msgT * 2);
      ctx.globalAlpha = a;
      const w = pixelTextWidth(state.msg);
      drawPixelTextOutline(ctx, state.msg, (VIEW_W - w) / 2, VIEW_H - 44, '#fff4d8', '#0f1632');
      ctx.globalAlpha = 1;
    }

    if (state.paused) {
      ctx.fillStyle = 'rgba(10,14,35,0.6)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const t = 'PAUSED';
      drawPixelTextShadow(ctx, t, (VIEW_W - pixelTextWidth(t, 2)) / 2, VIEW_H / 2 - 5, '#f4f7ff', '#0a0e23', 2);
    }
  }

  // ------------------------------------------------------------ scoreboard & log
  // Two readouts of the match rather than of the world. TAB, held, opens the
  // standings from any mode but the title - being dead is exactly when you want
  // them - and everything significant that happens to a slot leaves a line in
  // the feed at the bottom left. Both draw after the death overlay so neither is
  // dimmed by it. Colours everywhere: the team is the plate, playerTint(p) is
  // the ink, so teammates read as one side and still as two people.

  // ---- event feed ----
  const EVENT_MAX = 4;      // lines on screen; the oldest scroll off the top
  const EVENT_LIFE = 8;     // seconds from arrival to gone, faded linearly across it
  const EVENT_FLASH = 0.35; // arrival: slides in from the edge under a white pop
  const LOG_LEVEL = 5;      // level-ups below this come too fast to be news
  const events = [];        // {txt, bg, fg, t}; updateFx ages and expires them

  // p tints the line and is who it is about; null = a line nobody owns. The
  // plate takes the team's dark coat, not its bright mark: the ink is a pale
  // per-slot tint, and a bright plate over snow leaves it nothing to sit on.
  function logEvent(txt, p) {
    events.push({
      txt: String(txt).toUpperCase(), t: 0,
      bg: p ? TEAMS[p.team].coatD : '#2a3358',
      edge: p ? TEAMS[p.team].mark : '#6d7ea6',
      fg: p ? playerTint(p) : '#e6ecfa',
    });
    while (events.length > EVENT_MAX * 3) events.shift();
  }

  function renderEventLog() {
    const n = Math.min(EVENT_MAX, events.length);
    if (!n) return;
    const pitch = 10;
    let y = VIEW_H - 8 - pitch * n; // oldest at the top, newest along the bottom
    for (let i = events.length - n; i < events.length; i++) {
      const e = events[i];
      const a = Math.max(0, 1 - e.t / EVENT_LIFE); // age alone sets the alpha
      const f = Math.max(0, 1 - e.t / EVENT_FLASH);
      const w = pixelTextWidth(e.txt) + 8;
      const x = 4 - Math.round(7 * f * f); // slides in off the left edge
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(6,9,22,0.75)'; // base: the world must not read through the plate
      ctx.fillRect(x, y, w, 9);
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = e.bg;
      ctx.fillRect(x, y, w, 9);
      ctx.globalAlpha = a;
      ctx.fillStyle = e.edge;
      ctx.fillRect(x, y, 1, 9); // the bright team mark, hard against the plate
      if (f > 0) { // the arrival pop
        ctx.globalAlpha = 0.6 * f * f;
        ctx.fillStyle = '#f4f7ff';
        ctx.fillRect(x, y, w, 9);
        ctx.globalAlpha = a;
      }
      drawPixelTextShadow(ctx, e.txt, x + 4, y + 2, e.fg, 'rgba(6,9,22,0.9)');
      ctx.globalAlpha = 1;
      y += pitch;
    }
  }

  // ---- scoreboard (hold TAB) ----
  const SB_W = 168;
  const SB_ROW = 9;
  const SB_COL = [96, 128, 160]; // right edges of LVL / GOLD / KILLS, panel-relative

  function scoreboardOpen() { return !!keys['tab'] && state.mode !== 'title' && !window.DBG.hideUI; }

  // "winning" is lifetime gold earned, not the purse: gold spent on a building
  // is progress, and it is the same number the hero levels run on
  function scoreOf(p) { return p.xp; }

  // slots grouped by team, teams ordered by their total, players by their own
  function scoreGroups() {
    const byTeam = new Map();
    for (const p of players) {
      if (!p.active) continue;
      if (!byTeam.has(p.team)) byTeam.set(p.team, []);
      byTeam.get(p.team).push(p);
    }
    const groups = [...byTeam.values()];
    for (const g of groups) g.sort((a, b) => scoreOf(b) - scoreOf(a) || a.id - b.id);
    const total = (g) => g.reduce((n, p) => n + scoreOf(p), 0);
    groups.sort((a, b) => total(b) - total(a) || a[0].team - b[0].team);
    return groups;
  }

  function renderScoreboard() {
    const groups = scoreGroups();
    if (!groups.length) return;
    const rows = groups.reduce((n, g) => n + g.length, 0);
    const h = 30 + rows * SB_ROW + (groups.length - 1) * 3;
    const x = Math.round((VIEW_W - SB_W) / 2), y = Math.round((VIEW_H - h) / 2);
    const shadow = 'rgba(8,12,28,0.9)';

    ctx.fillStyle = 'rgba(4,7,20,0.45)'; ctx.fillRect(x + 2, y + 2, SB_W, h);
    ctx.fillStyle = 'rgba(10,15,34,0.96)'; ctx.fillRect(x, y, SB_W, h);
    ctx.fillStyle = '#2c3a68';
    ctx.fillRect(x, y, SB_W, 1); ctx.fillRect(x, y + h - 1, SB_W, 1);
    ctx.fillRect(x, y, 1, h); ctx.fillRect(x + SB_W - 1, y, 1, h);
    ctx.fillStyle = '#3d4f85'; ctx.fillRect(x + 1, y + 1, SB_W - 2, 1); // lit top edge

    drawPixelTextShadow(ctx, 'SCOREBOARD', x + 6, y + 6, '#cfe0ff', shadow);
    const day = 'DAY ' + state.day;
    drawPixelTextShadow(ctx, day, x + SB_W - 6 - pixelTextWidth(day), y + 6, '#7a8bb8', shadow);
    ctx.fillStyle = '#222c55'; ctx.fillRect(x + 4, y + 15, SB_W - 8, 1);

    const head = ['LVL', 'GOLD', 'KILLS'];
    drawPixelTextShadow(ctx, 'PLAYER', x + 14, y + 19, '#7a8bb8', shadow);
    for (let i = 0; i < 3; i++) {
      drawPixelTextShadow(ctx, head[i], x + SB_COL[i] - pixelTextWidth(head[i]), y + 19, '#7a8bb8', shadow);
    }

    let ry = y + 28;
    for (const g of groups) {
      const tm = TEAMS[g[0].team];
      ctx.fillStyle = tm.mark;
      ctx.fillRect(x + 4, ry, 2, g.length * SB_ROW - 2); // one stripe down the whole team
      for (const p of g) {
        const dim = p.dead ? 0.55 : 1;
        ctx.globalAlpha = dim * (p === player ? 0.26 : 0.13);
        ctx.fillStyle = tm.mark;
        ctx.fillRect(x + 8, ry, SB_W - 12, SB_ROW - 2);
        ctx.globalAlpha = dim;
        if (p === player) drawPixelTextShadow(ctx, '>', x + 9, ry + 1, '#ffd95c', shadow);
        drawPixelTextShadow(ctx, p.name, x + 14, ry + 1, playerTint(p), shadow);
        if (p.dead) {
          drawPixelTextShadow(ctx, 'DOWN', x + 18 + pixelTextWidth(p.name), ry + 1, '#8f9cc4', shadow);
        }
        const vals = [String(p.level), String(p.inv.gold), String(p.kills)];
        const cols = ['#cfe0ff', '#f2cc6a', '#ff9a8a'];
        for (let i = 0; i < 3; i++) {
          drawPixelTextShadow(ctx, vals[i], x + SB_COL[i] - pixelTextWidth(vals[i]), ry + 1, cols[i], shadow);
        }
        ctx.globalAlpha = 1;
        ry += SB_ROW;
      }
      ry += 3; // teams read as blocks
    }
  }

  // ------------------------------------------------------------ world map (M)
  // PANEL_*/MAP_* anchors are declared in the canvas banner (relayout() writes them).

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
      ['FOREST', '#3c5840'], ['ROCKS', '#686c76'], ['ICE', '#7a9cb0'],
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
        else if (o && o.type === 'deadTree') { r = 150; g = 132; b = 108; }
        else if (o && o.type === 'den') { r = 86; g = 80; b = 92; }
        else if (o && o.type === 'rock') { r = 104; g = 108; b = 118; }
        else if (o && o.type === 'bush') {
          if (o.berries > 0) { r = 170; g = 72; b = 80; } else { r = 118; g = 128; b = 98; }
        }
        else if (o && o.type === 'stump') { r = 172; g = 138; b = 92; }
        else if (o && o.type === 'wall') { r = 112; g = 78; b = 46; }
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

    // named places: glyph plus the name, inked like the rest of the chart
    for (const L of landmarks) {
      const lx = MAP_X + Math.round((L.tx + 0.5) * MAP_S);
      const ly = MAP_Y + Math.round((L.ty + 0.5) * MAP_S);
      drawLandmarkIcon(ctx, L, lx, ly - 3, '#3a2c1c', 'rgba(228,216,186,0.85)');
      const w = pixelTextWidth(L.name);
      const nx = Math.max(MAP_X + 1, Math.min(MAP_X + MAP_W - w - 1, Math.round(lx - w / 2)));
      drawPixelTextShadow(ctx, L.name, nx, ly + 3, '#3a2c1c', 'rgba(228,216,186,0.85)');
    }

    // the other slots, inked in their team colour
    for (const p of players) {
      if (p === player || !p.active || p.dead || inAir(p)) continue;
      const ox2 = MAP_X + Math.round((p.x / TILE) * MAP_S);
      const oy2 = MAP_Y + Math.round((p.y / TILE) * MAP_S);
      ctx.fillStyle = '#241a10';
      ctx.fillRect(ox2 - 2, oy2 - 2, 5, 5);
      ctx.fillStyle = TEAMS[p.team].mark;
      ctx.fillRect(ox2 - 1, oy2 - 1, 3, 3);
    }

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
  // SET_*/SL_X/ROW_* anchors are declared in the canvas banner (relayout() writes them).

  let dragSlider = null;

  const setPanelCv = document.createElement('canvas');
  setPanelCv.width = SET_W; setPanelCv.height = SET_H;

  // the dark frost slab every baked panel sits on: chamfered, mottled, bevelled,
  // crystal corners, and a gold title between ornament dashes. Shared by the
  // settings panel and the main menu's HOW TO PLAY panel so they read as a set.
  function bakeFrostSlab(g, w, h, title) {
    const cham = (x, y, ww, hh) => {
      g.fillRect(x + 2, y, ww - 4, hh);
      g.fillRect(x, y + 2, ww, hh - 4);
      g.fillRect(x + 1, y + 1, ww - 2, hh - 2);
    };
    g.fillStyle = '#0a0e23'; cham(0, 0, w, h);
    g.fillStyle = '#141c3c'; cham(1, 1, w - 2, h - 2);
    // subtle mottling
    for (let y = 3; y < h - 3; y += 3) {
      for (let x = 3; x < w - 3; x += 3) {
        const hv = hash2(x * 11 + 3, y * 7 + 19);
        if (hv > 0.86) { g.fillStyle = '#182148'; g.fillRect(x, y, 3, 3); }
        else if (hv < 0.10) { g.fillStyle = '#111834'; g.fillRect(x, y, 3, 3); }
      }
    }
    // bevel: icy top light, deep bottom shade
    g.fillStyle = '#35426e';
    g.fillRect(2, 1, w - 4, 1); g.fillRect(1, 2, 1, h - 4);
    g.fillStyle = '#080c1c';
    g.fillRect(2, h - 2, w - 4, 1); g.fillRect(w - 2, 2, 1, h - 4);
    // ice-crystal corner accents
    g.fillStyle = '#5a7fb8';
    for (const [cx2, cy2] of [[7, 7], [w - 8, 7], [7, h - 8], [w - 8, h - 8]]) {
      g.fillRect(cx2 - 2, cy2, 5, 1); g.fillRect(cx2, cy2 - 2, 1, 5);
      g.fillRect(cx2 - 1, cy2 - 1, 3, 3);
    }
    g.fillStyle = '#a8c8e8';
    for (const [cx2, cy2] of [[7, 7], [w - 8, 7], [7, h - 8], [w - 8, h - 8]]) {
      g.fillRect(cx2, cy2, 1, 1);
    }
    // title with dashes
    const tw = pixelTextWidth(title);
    const tx0 = Math.round((w - tw) / 2);
    drawPixelTextShadow(g, title, tx0, 8, '#ffd95c', 'rgba(8,12,28,0.9)');
    g.fillStyle = '#4a5480';
    g.fillRect(tx0 - 26, 11, 18, 1); g.fillRect(tx0 + tw + 8, 11, 18, 1);
    g.fillRect(tx0 - 30, 10, 2, 3); g.fillRect(tx0 + tw + 28, 10, 2, 3);
  }

  function buildSettingsPanel() {
    const g = setPanelCv.getContext('2d');
    bakeFrostSlab(g, SET_W, SET_H, 'SETTINGS');
    // row labels
    const L = '#cfe0ff';
    drawPixelText(g, 'VOLUME', 14, ROW_SOUND - SET_Y, L);
    drawPixelText(g, 'MUTE SOUND', 14, ROW_MUTE - SET_Y, L);
    drawPixelText(g, 'MINIMAP SIZE', 14, ROW_MAP - SET_Y, L);
    drawPixelText(g, 'SCREEN SHAKE', 14, ROW_SHAKE - SET_Y, L);
    drawPixelText(g, 'FPS DISPLAY', 14, ROW_FPS - SET_Y, L);
    drawPixelText(g, 'CURSOR', 14, ROW_CURSOR - SET_Y, L);
    // controls divider
    const ct = 'CONTROLS';
    const cw = pixelTextWidth(ct);
    const cx0 = Math.round((SET_W - cw) / 2);
    drawPixelText(g, ct, cx0, 126, '#7a8bb8');
    g.fillStyle = '#2c3a68';
    g.fillRect(14, 129, cx0 - 22, 1); g.fillRect(cx0 + cw + 8, 129, SET_W - cx0 - cw - 22, 1);
    // hotkey listing, two columns
    const cols = [
      [['WASD', 'MOVE'], ['SPACE', 'DODGE'], ['CLICK', 'BOW'], ['E', 'HARVEST'], ['Q', 'EAT BERRY']],
      [['M', 'WORLD MAP'], ['N', 'MUTE'], ['P', 'PAUSE'], ['ESC', 'SETTINGS'], ['SCROLL', 'ZOOM']],
    ];
    for (let c = 0; c < 2; c++) {
      let y = 140;
      const x0 = c === 0 ? 16 : 128;
      for (const [k, desc] of cols[c]) {
        drawPixelText(g, k, x0, y, '#ffd95c');
        drawPixelText(g, desc, x0 + (c === 0 ? 36 : 26), y, '#7a8bb8');
        y += 10;
      }
    }
    // close hint
    const hint = 'ESC CLOSE';
    drawPixelText(g, hint, Math.round((SET_W - pixelTextWidth(hint)) / 2), 192, '#5a6690');
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

  // which settings widget is under the pointer (null for none); shared by the
  // click handler and the cursor so the hand cursor can never disagree with a click
  function settingsHit() {
    const mx = mouse.x, my = mouse.y;
    if (mx < SL_X - 4 || mx > SL_X + SL_W + 6) return null;
    const inRow = (y) => my >= y - 4 && my <= y + 11;
    if (inRow(ROW_SOUND)) return 'vol';
    if (inRow(ROW_MUTE)) return 'mute';
    if (inRow(ROW_MAP)) return 'map';
    if (inRow(ROW_SHAKE)) return 'shake';
    if (inRow(ROW_FPS)) return 'fps';
    if (inRow(ROW_CURSOR)) return 'cursor';
    return null;
  }

  function settingsMouseDown() {
    SFX.unlock();
    const hit = settingsHit();
    if (!hit) return;
    if (hit === 'vol' || hit === 'map') { dragSlider = hit; applySliderDrag(); return; }
    if (hit === 'mute') settings.muted = SFX.toggleMute();
    else if (hit === 'shake') settings.shake = !settings.shake;
    else if (hit === 'fps') settings.fps = !settings.fps;
    else if (hit === 'cursor') settings.pixelCursor = !settings.pixelCursor;
    SFX.pickup();
    saveSettings();
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

  function drawToggleRow(y, on, onTxt, offTxt) {
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(SL_X, y - 1, 9, 9);
    ctx.fillStyle = '#121a3a'; ctx.fillRect(SL_X + 1, y, 7, 7);
    if (on) { ctx.fillStyle = '#ffd95c'; ctx.fillRect(SL_X + 2, y + 1, 5, 5); }
    drawPixelTextShadow(ctx, on ? (onTxt || 'ON') : (offTxt || 'OFF'), SL_X + 14, y,
      on ? '#cfe0ff' : '#7a8bb8', 'rgba(8,12,28,0.9)');
  }

  // opts.slide (px): draw the panel shifted down by that much - the main menu
  // slides it in over the living world and skips the dim + minimap preview
  function renderSettings(now, opts) {
    if (dragSlider && mouse.down) applySliderDrag();
    const slide = opts && opts.slide ? Math.round(opts.slide) : 0;
    if (!opts || !opts.bare) {
      ctx.fillStyle = 'rgba(6,10,24,0.6)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      // live minimap preview while resizing
      renderMinimap(now);
    }
    if (slide) { ctx.save(); ctx.translate(0, slide); }
    ctx.drawImage(setPanelCv, SET_X, SET_Y);
    drawSliderRow(ROW_SOUND, settings.volume, String(Math.round(settings.volume * 100)));
    drawToggleRow(ROW_MUTE, SFX.isMuted());
    drawSliderRow(ROW_MAP, (settings.mmR - 16) / 18, 'R' + settings.mmR);
    drawToggleRow(ROW_SHAKE, settings.shake);
    drawToggleRow(ROW_FPS, settings.fps);
    drawToggleRow(ROW_CURSOR, settings.pixelCursor, 'PIXEL', 'BROWSER');
    if (slide) ctx.restore();
  }

  // ------------------------------------------------------------ main menu
  // The title screen is a real menu over the living world: the camera drifts
  // around the interior while animals, fish and snow keep running, four items
  // (PLAY / SETTINGS / HOW TO PLAY / the reroll die) take mouse or arrows+enter,
  // and every mode change is a transition rather than a cut.
  const INTRO_T = 1.6;    // title -> play: tint dissolves, camera settles, HUD slides in
  const HUD_IN_T = 0.7;   // the HUD slide occupies the last part of the intro
  const PANEL_SLIDE_T = 0.32;
  const MENU_ITEMS = ['PLAY', 'SETTINGS', 'HOW TO PLAY'];
  const MENU_BW = 112, MENU_BH = 20;

  function easeOut(t) { t = Math.max(0, Math.min(1, t)); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function easeInOut(t) { t = Math.max(0, Math.min(1, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // layout was authored for a 270px-tall view; recenter it vertically
  function menuLayout() {
    const toy = Math.round((VIEW_H - 270) / 2);
    const bx = Math.round((VIEW_W - MENU_BW) / 2);
    const rects = MENU_ITEMS.map((_, i) => ({ x: bx, y: toy + 112 + i * 26, w: MENU_BW, h: MENU_BH }));
    // the seed row: text + die, one selectable item
    const sw = pixelTextWidth(SEED_TXT) + 6 + 11;
    const sx = Math.round((VIEW_W - sw) / 2);
    rects.push({ x: sx - 3, y: toy + 196, w: sw + 6, h: 13, seed: true });
    return { toy, rects };
  }

  function menuHit() {
    if (state.menu.panel) return -1;
    const { rects } = menuLayout();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (mouse.x >= r.x - 2 && mouse.x < r.x + r.w + 2 && mouse.y >= r.y - 3 && mouse.y < r.y + r.h + 3) return i;
    }
    return -1;
  }

  function menuSelect(i) {
    const m = state.menu;
    const n = ((i % 4) + 4) % 4;
    if (n === m.sel) return;
    m.sel = n;
    SFX.pickup();
  }

  function menuActivate(i) {
    SFX.unlock();
    if (i === 0) beginSelect();
    else if (i === 1) openMenuPanel('settings');
    else if (i === 2) openMenuPanel('help');
    else if (i === 3) rerollWorld();
  }

  function openMenuPanel(kind) {
    const m = state.menu;
    m.panel = kind; m.panelT = 0; m.closing = false;
    SFX.place();
  }
  function closeMenuPanel() {
    const m = state.menu;
    if (!m.panel || m.closing) return;
    m.closing = true;
    dragSlider = null;
    saveSettings();
    SFX.pickup();
  }
  function menuPanelReady() {
    const m = state.menu;
    return !!m.panel && m.panelT >= 1 && !m.closing;
  }
  function overMenuPanel() {
    return mouse.x >= SET_X && mouse.x < SET_X + SET_W && mouse.y >= SET_Y && mouse.y < SET_Y + SET_H;
  }

  function menuKey(e) {
    const m = state.menu;
    const k = e.key.toLowerCase();
    if (state.fade) return; // a reroll is already leaving
    if (m.screen === 'select') { if (m.screenT >= 1) selectKey(k); return; }
    if (m.panel) {
      if (k === 'escape' || k === 'backspace' || (m.panel === 'help' && (k === 'enter' || k === ' '))) closeMenuPanel();
      return;
    }
    if (k === 'arrowup' || k === 'w') menuSelect(m.sel - 1);
    else if (k === 'arrowdown' || k === 's') menuSelect(m.sel + 1);
    else if (k === 'enter' || k === ' ') { m.pressT = 0.12; menuActivate(m.sel); }
  }

  function menuClick() {
    const m = state.menu;
    SFX.unlock();
    if (state.fade) return;
    if (m.screen === 'select') { selectClick(); return; }
    if (m.panel) {
      if (!menuPanelReady()) return;
      if (m.panel === 'settings' && overMenuPanel()) { mouse.down = true; settingsMouseDown(); return; }
      if (!overMenuPanel()) closeMenuPanel();
      return;
    }
    const h = menuHit();
    if (h < 0) return;
    m.sel = h;
    m.pressT = 0.12;
    menuActivate(h);
  }

  // straight into play, skipping the eagle (debug: DBG.beginIntro): the menu
  // tint dissolves while the camera eases from the drift onto the player, then
  // the HUD slides in (renderUI)
  function beginIntro() {
    state.introFrom = { x: camX, y: camY };
    state.intro = INTRO_T; state.introLen = INTRO_T;
    state.mode = 'play';
    state.menu.panel = null;
    state.menu.screen = 'menu';
    SFX.dawnChime();
  }

  // the die: whiteout, then reload on a fresh seed (SEED is a const every
  // deterministic value closes over, so a new world is a new page)
  function rerollWorld() {
    const m = state.menu;
    if (state.fade) return;
    m.rolling = 0.6;
    SFX.dodge();
    const next = ((Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0) || 1;
    state.fade = {
      a: 0, to: 1, spd: 1 / 0.55, color: '#f4f7ff',
      then: () => {
        try { sessionStorage.setItem('emberfrost.reroll', '1'); } catch (e) { }
        location.href = location.pathname + '?seed=' + next;
      },
    };
  }

  // slow lissajous drift around the open interior, never into the border forest
  function titleCamTarget() {
    const c = WORLD * TILE / 2;
    const t = state.menu.camT;
    const rx = Math.max(0, (WORLD / 2 - BORDER_MAX - 6) * TILE - VIEW_W / 2);
    const ry = Math.max(0, Math.min(rx * 0.8, (WORLD / 2 - BORDER_MAX - 6) * TILE - VIEW_H / 2));
    return {
      x: c + Math.cos(t * 0.045 + 0.7) * rx - VIEW_W / 2,
      y: c + Math.sin(t * 0.031 + 0.7) * ry - VIEW_H / 2,
    };
  }

  function updateTitle(dt) {
    const m = state.menu;
    m.t += dt;
    m.camT += dt;
    m.dieT += dt;
    if (m.rolling > 0) m.rolling -= dt;
    if (m.pressT > 0) m.pressT -= dt;
    // the mouse only takes the selection when it moves (so arrows aren't fought)
    if (m.moved) {
      m.moved = false;
      const h = menuHit();
      if (h >= 0 && h !== m.sel) m.sel = h;
    }
    for (let i = 0; i < 4; i++) {
      const target = m.sel === i ? 1 : 0;
      m.hover[i] += (target - m.hover[i]) * Math.min(1, dt * 14);
    }
    // champion select cross-fade and its own hovers
    const st = m.screen === 'select' ? 1 : 0;
    m.screenT = Math.max(0, Math.min(1, m.screenT + (st ? 1 : -1) * dt / 0.35));
    m.cswapT = Math.min(1, m.cswapT + dt / 0.22);
    const sh = m.screen === 'select' && m.screenT >= 1 ? selectHit() : -1;
    for (let i = 0; i < CHAMPS.length; i++) {
      const target = (m.csel === i || sh === i) ? 1 : 0;
      m.chover[i] += (target - m.chover[i]) * Math.min(1, dt * 14);
    }
    if (m.lockT > 0) {
      m.lockT -= dt;
      if (m.lockT <= 0) { m.lockT = 0; beginDrop(); }
    }
    if (m.panel) {
      if (m.closing) {
        m.panelT -= dt / PANEL_SLIDE_T;
        if (m.panelT <= 0) { m.panelT = 0; m.panel = null; m.closing = false; }
      } else m.panelT = Math.min(1, m.panelT + dt / PANEL_SLIDE_T);
    }
    // the ambient world: wildlife and the shoal keep living behind the menu
    for (const a of animals) updateAnimal(a, dt);
    for (let i = animals.length - 1; i >= 0; i--) if (animals[i].dead) animals.splice(i, 1);
    updateFish(dt);
  }

  // chamfered rect on the main ctx (2px corner cut)
  function chamRect(x, y, w, h) {
    ctx.fillRect(x + 2, y, w - 4, h);
    ctx.fillRect(x, y + 2, w, h - 4);
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  }

  // a frost plank: snow-capped slab with icicles hanging off it. hv (0..1) is the
  // hover ease - it lifts, warms, and grows an ember glow; pressed sinks it a px
  function drawMenuButton(r, label, hv, now, pressed) {
    const a0 = ctx.globalAlpha; // respect the caller's fade (the menu and select screens animate alpha)
    const lift = Math.round(hv * 2) - (pressed ? 2 : 0);
    const x = r.x, y = r.y - lift, w = r.w, h = r.h;
    // ember glow behind the hovered plank
    if (hv > 0.02) {
      ctx.globalAlpha = a0 * 0.16 * hv * (0.8 + 0.2 * Math.sin(now * 5));
      ctx.fillStyle = '#ffb347';
      chamRect(x - 4, y - 4, w + 8, h + 8);
      ctx.globalAlpha = a0;
    }
    // shadow stays on the ground while the plank lifts
    ctx.fillStyle = 'rgba(4,6,18,0.55)';
    chamRect(x + 2, r.y + 2, w, h);
    // slab
    ctx.fillStyle = '#0a0e23'; chamRect(x, y, w, h);
    ctx.fillStyle = hv > 0.5 ? '#1f2b5c' : '#141c3c'; chamRect(x + 1, y + 1, w - 2, h - 2);
    // wood-grain mottling
    for (let yy = 3; yy < h - 3; yy += 3) {
      for (let xx = 3; xx < w - 3; xx += 3) {
        const hb = hash2(xx * 11 + r.y, yy * 7 + 19);
        if (hb > 0.86) { ctx.fillStyle = hv > 0.5 ? '#263470' : '#182148'; ctx.fillRect(x + xx, y + yy, 3, 3); }
        else if (hb < 0.10) { ctx.fillStyle = '#111834'; ctx.fillRect(x + xx, y + yy, 3, 3); }
      }
    }
    // bevel
    ctx.fillStyle = hv > 0.5 ? '#5a7fb8' : '#35426e';
    ctx.fillRect(x + 2, y + 1, w - 4, 1); ctx.fillRect(x + 1, y + 2, 1, h - 4);
    ctx.fillStyle = '#080c1c';
    ctx.fillRect(x + 2, y + h - 2, w - 4, 1); ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
    // gold inner rule when hot
    if (hv > 0.5) {
      ctx.globalAlpha = a0 * (hv - 0.5) * 2;
      ctx.fillStyle = '#c89a3c';
      ctx.fillRect(x + 3, y + 2, w - 6, 1); ctx.fillRect(x + 3, y + h - 3, w - 6, 1);
      ctx.globalAlpha = a0;
    }
    // snow cap along the top edge: ragged drift, shaded underside
    for (let px = 2; px < w - 2; px++) {
      const hb = hash2(px * 3 + 5, r.y * 13);
      const sh = 1 + (hb > 0.5 ? 1 : 0) + (hb > 0.85 ? 1 : 0);
      ctx.fillStyle = '#f4f7ff';
      ctx.fillRect(x + px, y + 1 - sh, 1, sh);
      if (hb > 0.3 && hb < 0.5) { ctx.fillStyle = '#b8cce6'; ctx.fillRect(x + px, y + 1, 1, 1); }
    }
    // icicles off the bottom edge, tips glinting when hot
    for (let px = 4; px < w - 4; px++) {
      const hb = hash2(px * 7 + 1, r.y * 17 + 3);
      if (hb < 0.84) continue;
      const len = 2 + Math.floor((hb - 0.84) * 25); // 2..5
      ctx.fillStyle = '#a8c8e8';
      ctx.fillRect(x + px, y + h, 1, len);
      ctx.fillStyle = '#e8f4ff';
      ctx.fillRect(x + px, y + h, 1, 1);
      if (hv > 0.5 && ((now * 6 + px) | 0) % 5 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + px, y + h + len - 1, 1, 1); }
    }
    // ember gems at both ends when hot
    if (hv > 0.5) {
      ctx.globalAlpha = a0 * (hv - 0.5) * 2;
      for (const gx of [x + 6, x + w - 7]) {
        const gy = y + Math.floor(h / 2);
        ctx.fillStyle = '#0a0e23';
        ctx.fillRect(gx - 2, gy, 5, 1); ctx.fillRect(gx, gy - 2, 1, 5); ctx.fillRect(gx - 1, gy - 1, 3, 3);
        ctx.fillStyle = '#ff8a3c';
        ctx.fillRect(gx - 1, gy, 3, 1); ctx.fillRect(gx, gy - 1, 1, 3);
        ctx.fillStyle = '#ffd95c';
        ctx.fillRect(gx, gy, 1, 1);
      }
      ctx.globalAlpha = a0;
    }
    // label
    const tw = pixelTextWidth(label, 2);
    const lx = Math.round(x + (w - tw) / 2), ly = y + Math.round((h - 10) / 2) + (pressed ? 1 : 0);
    drawPixelTextShadow(ctx, label, lx, ly, hv > 0.5 ? '#ffd95c' : '#cfe0ff', '#0a0e23', 2);
  }

  // the selector: a pair of pixel arrows (shaft, gold head, fletching) bobbing
  // toward the selected item from both sides. dir = 1 points right, -1 left.
  function drawSelector(r, lift, now, single) {
    const bob = Math.round(Math.sin(now * 7) * 1.5);
    const cy = r.y - lift + Math.floor(r.h / 2);
    const draw = (tipX, dir) => {
      // rows run from the tip (dx = 0) back along the shaft (dx < 0)
      const px = (dx, dy, c, ww) => {
        ctx.fillStyle = c;
        const x0 = dir > 0 ? tipX + dx - (ww - 1) : tipX - dx;
        ctx.fillRect(x0, cy + dy, ww, 1);
      };
      // outline
      for (const [dx, dy, ww] of [[1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -2, 1], [-1, 2, 1], [-2, -3, 1], [-2, 3, 1],
        [-3, -2, 1], [-3, 2, 1], [-3, -1, 1], [-3, 1, 1], [-13, -2, 4], [-13, 2, 4], [-14, -1, 1], [-14, 1, 1], [-15, 0, 1]]) px(dx, dy, '#0a0e23', ww);
      px(-4, 0, '#d8c8a0', 11);  // shaft
      px(-12, -1, '#b48a5a', 3); px(-12, 1, '#b48a5a', 3); // fletching
      px(0, 0, '#ffd95c', 1); px(-1, -1, '#ffd95c', 1); px(-1, 1, '#ffd95c', 1);
      px(-2, -2, '#ffd95c', 1); px(-2, 2, '#ffd95c', 1); px(-2, 0, '#ffd95c', 3);
      px(0, 0, '#ffffff', 1);
    };
    draw(r.x - 6 + bob, 1);
    if (!single) draw(r.x + r.w + 5 - bob, -1);
  }

  // the reroll die (11x11): face cycles while hovered, tumbles while rolling
  function drawDie(x, y, hv, now) {
    const m = state.menu;
    const rolling = m.rolling > 0;
    let face = 1 + (SEED % 6);
    if (rolling) face = 1 + ((m.dieT * 16) | 0) % 6;
    else if (hv > 0.5) face = 1 + ((m.dieT * 7) | 0) % 6;
    let jx = 0, jy = 0;
    if (rolling) { jy = -Math.round(Math.abs(Math.sin(m.dieT * 18)) * 4); jx = ((m.dieT * 30) | 0) % 3 - 1; }
    else if (hv > 0.5) { jx = ((now * 14) | 0) % 3 - 1; }
    x += jx; y += jy;
    ctx.fillStyle = 'rgba(4,6,18,0.55)'; chamRect(x + 1, y + 2 - jy, 11, 11);
    ctx.fillStyle = '#0a0e23'; chamRect(x, y, 11, 11);
    ctx.fillStyle = hv > 0.5 ? '#fff8dc' : '#f4f7ff'; chamRect(x + 1, y + 1, 9, 9);
    ctx.fillStyle = hv > 0.5 ? '#e0c890' : '#b8cce6';
    ctx.fillRect(x + 2, y + 9, 7, 1); ctx.fillRect(x + 9, y + 2, 1, 7);
    const pips = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
      5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] }[face];
    ctx.fillStyle = hv > 0.5 ? '#8a3a1a' : '#1a2040';
    for (const [c, r] of pips) ctx.fillRect(x + 2 + c * 3, y + 2 + r * 3, 2, 2);
  }

  const helpPanelCv = document.createElement('canvas');
  helpPanelCv.width = SET_W; helpPanelCv.height = SET_H;
  function buildHelpPanel() {
    const g = helpPanelCv.getContext('2d');
    bakeFrostSlab(g, SET_W, SET_H, 'HOW TO PLAY');
    const cols = [
      [['WASD', 'MOVE'], ['SPACE', 'DODGE ROLL'], ['SHIFT', 'SLIDE'], ['CLICK', 'DRAW THE BOW'], ['E', 'CHOP MINE PICK'], ['RCLICK', 'BUILD ON STUMP']],
      [['Q', 'EAT BERRY'], ['F', 'EAT FISH'], ['M', 'WORLD MAP'], ['TAB', 'SCOREBOARD'], ['SCROLL', 'ZOOM'], ['N', 'MUTE'], ['P', 'PAUSE']],
    ];
    for (let c = 0; c < 2; c++) {
      let y = 24;
      const x0 = c === 0 ? 14 : 134;
      for (const [k, desc] of cols[c]) {
        drawPixelText(g, k, x0, y, '#ffd95c');
        drawPixelText(g, desc, x0 + 32, y, '#9fb6d8');
        y += 10;
      }
    }
    // divider + the rules of the frostlands
    const ct = 'THE FROSTLANDS';
    const cw = pixelTextWidth(ct);
    const cx0 = Math.round((SET_W - cw) / 2);
    drawPixelText(g, ct, cx0, 92, '#7a8bb8');
    g.fillStyle = '#2c3a68';
    g.fillRect(14, 95, cx0 - 22, 1); g.fillRect(cx0 + cw + 8, 95, SET_W - cx0 - cw - 22, 1);
    const lines = [
      ['GOLD IS THE ONLY CURRENCY', '#cfe0ff'],
      ['TREES ROCKS AND GAME ALL PAY IT', '#9fb6d8'],
      ['RIGHT CLICK A STUMP TO RAISE A BASE', '#9fb6d8'],
      ['CRACK THE ICE TO SPEAR FISH BELOW', '#9fb6d8'],
      ['RIVERS ARE FAST - CHAIN DODGES TO FLY', '#9fb6d8'],
      ['NAMED PLACES ARE ON THE MAP - WOLVES DEN UP', '#ff9a8a'],
      ['RIVALS SHARE THE MAP - ARROWS HURT THEM', '#ff9a8a'],
    ];
    let y = 106;
    for (const [l, col] of lines) {
      drawPixelText(g, l, Math.round((SET_W - pixelTextWidth(l)) / 2), y, col);
      y += 11;
    }
    const hint = 'ESC BACK';
    drawPixelText(g, hint, Math.round((SET_W - pixelTextWidth(hint)) / 2), 190, '#5a6690');
  }

  // ---- champion select ----------------------------------------------------
  // PLAY goes here first (menu.screen = 'select'): champion cards on the left,
  // the chosen one big in the middle with name, role, blurb and stat pips, and
  // a LOCK IN plank. Up/Down browse, Enter/Space lock, Esc returns to the menu;
  // the mouse does the same through selectHit(). Lock-in stamps player.champ
  // and hands off to beginDrop() (the eagle ride; see the eagle drop banner).
  const SEL_CARD_W = 78, SEL_CARD_H = 28;

  function selectLayout() {
    const toy = Math.round((VIEW_H - 270) / 2);
    const cx = Math.round(VIEW_W / 2);
    const cards = CHAMPS.map((_, i) => ({ x: Math.max(8, cx - 206), y: toy + 66 + i * 34, w: SEL_CARD_W, h: SEL_CARD_H }));
    const lock = { x: cx - 56, y: toy + 228, w: 112, h: 20 };
    return { toy, cx, cards, lock };
  }

  // what the pointer is over: card index, CHAMPS.length for LOCK IN, -1 for nothing
  function selectHit() {
    const { cards, lock } = selectLayout();
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i];
      if (mouse.x >= r.x - 2 && mouse.x < r.x + r.w + 2 && mouse.y >= r.y - 3 && mouse.y < r.y + r.h + 3) return i;
    }
    if (mouse.x >= lock.x - 2 && mouse.x < lock.x + lock.w + 2 && mouse.y >= lock.y - 3 && mouse.y < lock.y + lock.h + 3) return cards.length;
    return -1;
  }

  function beginSelect() {
    const m = state.menu;
    m.screen = 'select';
    m.cswapT = 1;
    SFX.place();
  }
  function leaveSelect() {
    state.menu.screen = 'menu';
    SFX.pickup();
  }
  function selectChamp(i) {
    const m = state.menu;
    const n = ((i % CHAMPS.length) + CHAMPS.length) % CHAMPS.length;
    if (n === m.csel) return;
    m.csel = n;
    m.cswapT = 0;
    SFX.pickup();
  }
  function lockIn() {
    const m = state.menu;
    if (m.lockT > 0) return;
    m.lockT = 0.12;
    setChamp(player, m.csel);
    SFX.place();
  }

  function selectKey(k) {
    const m = state.menu;
    if (m.lockT > 0) return;
    if (k === 'escape' || k === 'backspace') leaveSelect();
    else if (k === 'arrowup' || k === 'w') selectChamp(m.csel - 1);
    else if (k === 'arrowdown' || k === 's') selectChamp(m.csel + 1);
    else if (k === 'enter' || k === ' ') { m.pressT = 0.12; lockIn(); }
  }

  function selectClick() {
    const m = state.menu;
    if (m.lockT > 0 || m.screenT < 1) return;
    const h = selectHit();
    if (h < 0) return;
    if (h === CHAMPS.length) { m.pressT = 0.12; lockIn(); }
    else { selectChamp(h); if (h === m.csel) m.csel = h; }
  }

  // a champion card: small plank with the portrait sprite and name; hot = gold
  function drawChampCard(r, ci, hv, now, chosen) {
    const lift = Math.round(hv * 2);
    const x = r.x, y = r.y - lift, w = r.w, h = r.h;
    if (hv > 0.02) {
      ctx.globalAlpha *= 1; // keep caller alpha
      const a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * 0.16 * hv * (0.8 + 0.2 * Math.sin(now * 5));
      ctx.fillStyle = '#ffb347';
      chamRect(x - 3, y - 3, w + 6, h + 6);
      ctx.globalAlpha = a0;
    }
    ctx.fillStyle = 'rgba(4,6,18,0.55)'; chamRect(x + 2, r.y + 2, w, h);
    ctx.fillStyle = '#0a0e23'; chamRect(x, y, w, h);
    ctx.fillStyle = chosen ? '#1f2b5c' : '#141c3c'; chamRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = chosen ? '#5a7fb8' : '#35426e';
    ctx.fillRect(x + 2, y + 1, w - 4, 1); ctx.fillRect(x + 1, y + 2, 1, h - 4);
    ctx.fillStyle = '#080c1c';
    ctx.fillRect(x + 2, y + h - 2, w - 4, 1); ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
    if (chosen) {
      ctx.fillStyle = '#c89a3c';
      ctx.fillRect(x + 3, y + 2, w - 6, 1); ctx.fillRect(x + 3, y + h - 3, w - 6, 1);
    }
    // portrait well
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x + 4, y + 5, 20, 19);
    ctx.fillStyle = chosen ? '#2a3a6e' : '#1c2750'; ctx.fillRect(x + 5, y + 6, 18, 17);
    ctx.drawImage(SPRITES.champ[ci][0].down[0], x + 6, y + 6);
    drawPixelTextShadow(ctx, CHAMPS[ci].name, x + 28, y + 8, chosen ? '#ffd95c' : '#cfe0ff', '#0a0e23');
    drawPixelTextShadow(ctx, CHAMPS[ci].role, x + 28, y + 16, chosen ? '#9fb6d8' : '#5a6690', '#0a0e23');
  }

  function drawStatPips(x, y, label, n, col) {
    drawPixelTextShadow(ctx, label, x, y, '#9fb6d8', 'rgba(15,22,50,0.9)');
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = '#0a0e23'; ctx.fillRect(x + i * 8, y + 8, 6, 4);
      ctx.fillStyle = i < n ? col : '#1c2750'; ctx.fillRect(x + i * 8 + 1, y + 9, 4, 2);
    }
  }

  // a (0..1) is the screen's own visibility; out is the play-intro exit
  function renderSelect(now, a) {
    const m = state.menu;
    const { toy, cx, cards, lock } = selectLayout();
    const c = CHAMPS[m.csel];
    const slideIn = 1 - a;

    // header
    ctx.globalAlpha = a;
    const t0 = 'CHOOSE YOUR CHAMPION';
    drawPixelTextShadow(ctx, t0, Math.round((VIEW_W - pixelTextWidth(t0, 2)) / 2), toy + 30 - Math.round(slideIn * 20), '#ffd95c', '#3c2a1e', 2);

    // cards, from the left
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i];
      const rr = { x: r.x - Math.round(slideIn * 80), y: r.y, w: r.w, h: r.h };
      ctx.globalAlpha = a;
      drawChampCard(rr, i, m.chover[i], now, m.csel === i);
      if (m.csel === i) drawSelector({ x: rr.x + 4, y: rr.y, w: 0, h: rr.h }, Math.round(m.chover[i] * 2), now, true);
    }
    ctx.globalAlpha = a;

    // the champion, big: 6x sprite over a soft plinth, swapping with a quick rise
    const sw = easeOut(m.cswapT);
    const bx = cx - 48, by = toy + 52 + Math.round((1 - sw) * 10);
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = '#0a0e23';
    ctx.beginPath(); ctx.ellipse(cx, toy + 150, 46, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = a * sw;
    const spr = SPRITES.champ[m.csel][0].down[0];
    ctx.drawImage(spr, bx, by, 96, 96);
    // name + role
    const nm = c.name;
    drawPixelTextShadow(ctx, nm, Math.round((VIEW_W - pixelTextWidth(nm, 3)) / 2), toy + 160, '#ffd95c', '#3c2a1e', 3);
    drawPixelTextShadow(ctx, c.role, Math.round((VIEW_W - pixelTextWidth(c.role)) / 2), toy + 180, '#cfe0ff', 'rgba(15,22,50,0.9)');
    let ly = toy + 194;
    for (const l of c.blurb) {
      drawPixelTextShadow(ctx, l, Math.round((VIEW_W - pixelTextWidth(l)) / 2), ly, '#9fb6d8', 'rgba(15,22,50,0.9)');
      ly += 10;
    }
    // stat pips, right column
    const sx = cx + 120 + Math.round(slideIn * 80);
    drawStatPips(sx, toy + 80, 'ICE', c.stats.ice, '#8fd8ff');
    drawStatPips(sx, toy + 100, 'DRAW', c.stats.draw, '#ffd95c');
    drawStatPips(sx, toy + 120, 'POWER', c.stats.power, '#ff8a3c');
    drawStatPips(sx, toy + 140, 'TOUGH', c.stats.tough, '#9fe0a8');
    ctx.globalAlpha = a;

    // lock in
    const over = m.screenT >= 1 && selectHit() === CHAMPS.length;
    const pressed = m.pressT > 0 || m.lockT > 0;
    drawMenuButton({ x: lock.x, y: lock.y + Math.round(slideIn * 20), w: lock.w, h: lock.h }, 'LOCK IN', over ? 1 : 0.7, now, pressed);
    const t3 = 'ENTER LOCK IN - ESC BACK';
    drawPixelTextShadow(ctx, t3, Math.round((VIEW_W - pixelTextWidth(t3)) / 2), toy + 258, '#5a6690', 'rgba(15,22,50,0.9)');
    ctx.globalAlpha = 1;
  }

  function renderTitle(now) {
    const m = state.menu;
    // leaving: 0 while the menu is up, 0->1 over the intro
    const outQ = state.intro > 0 ? 1 - state.intro / INTRO_T : 0;
    const tintA = 0.55 * (1 - easeOut(outQ / 0.45));
    if (tintA > 0.005) {
      ctx.fillStyle = 'rgba(10,16,42,' + tintA.toFixed(3) + ')';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    const out = easeOut(outQ / 0.22);           // menu chrome drops away first
    const sc = easeInOut(m.screenT);             // champion select cross-fade
    const pan = Math.max(m.panel ? easeOut(m.panelT) : 0, sc); // chrome ducks under a panel or the select screen
    const { toy, rects } = menuLayout();

    // logo: drops in at boot, lifts away on play
    const logoIn = easeOut(m.t / 0.6);
    const t1 = 'EMBERFROST';
    const bob = Math.sin(now * 1.5) * 2;
    const ly = Math.round(toy + 46 + bob - (1 - logoIn) * 30 - out * 40);
    ctx.globalAlpha = logoIn * (1 - out) * (1 - pan * 0.85) * (1 - sc);
    const lx = Math.round((VIEW_W - pixelTextWidth(t1, 4)) / 2);
    drawPixelText(ctx, t1, lx + 1, ly + 1, '#ff7a2a', 4); // ember under-glow
    drawPixelTextShadow(ctx, t1, lx, ly, '#ffd95c', '#3c2a1e', 4);
    const t2 = 'A COZY WINTER FREE-FOR-ALL';
    drawPixelTextShadow(ctx, t2, Math.round((VIEW_W - pixelTextWidth(t2)) / 2), ly + 34, '#cfe0ff', 'rgba(15,22,50,0.9)');
    ctx.globalAlpha = 1;

    // items: stagger in from the left, sink away on play, fade under a panel
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const inT = easeOut((m.t - 0.25 - i * 0.12) / 0.45);
      const a = inT * (1 - out) * (1 - pan);
      if (a <= 0.005) continue;
      ctx.globalAlpha = a;
      const rr = { x: r.x - Math.round((1 - inT) * 60), y: r.y + Math.round(out * 25), w: r.w, h: r.h };
      const hv = m.hover[i];
      const pressed = m.sel === i && (m.pressT > 0 || (mouse.down && menuHit() === i));
      if (r.seed) {
        const lift = Math.round(hv * 2);
        const tx = rr.x + 3, ty = rr.y + 3 - lift;
        drawPixelTextShadow(ctx, SEED_TXT, tx, ty, hv > 0.5 ? '#ffd95c' : '#9fb6d8', 'rgba(15,22,50,0.9)');
        drawDie(tx + pixelTextWidth(SEED_TXT) + 6, rr.y - lift, hv, now);
        if (hv > 0.5) {
          ctx.globalAlpha = a * (hv - 0.5) * 2;
          const ht = 'ROLL A NEW WORLD';
          drawPixelTextShadow(ctx, ht, Math.round((VIEW_W - pixelTextWidth(ht)) / 2), rr.y + 16, '#ffd95c', 'rgba(15,22,50,0.9)');
          ctx.globalAlpha = a;
        }
      } else {
        drawMenuButton(rr, MENU_ITEMS[i], hv, now, pressed);
      }
      if (m.sel === i && hv > 0.3 && !m.panel) drawSelector(rr, Math.round(hv * 2), now);
      ctx.globalAlpha = 1;
    }

    // footer hint
    const fin = easeOut((m.t - 0.9) / 0.5) * (1 - out) * (1 - pan);
    if (fin > 0.005) {
      ctx.globalAlpha = fin;
      const t3 = 'ARROWS SELECT - ENTER CONFIRM';
      drawPixelTextShadow(ctx, t3, Math.round((VIEW_W - pixelTextWidth(t3)) / 2), toy + 250, '#5a6690', 'rgba(15,22,50,0.9)');
      ctx.globalAlpha = 1;
    }

    if (sc > 0.005) renderSelect(now, sc * (1 - out));

    // sub-panels slide up from the bottom edge over the still-visible world
    if (m.panel) {
      const slide = Math.round((1 - easeOut(m.panelT)) * (VIEW_H - SET_Y + 6));
      if (m.panel === 'settings') renderSettings(now, { bare: true, slide });
      else ctx.drawImage(helpPanelCv, SET_X, SET_Y + slide);
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

  // ------------------------------------------------------------ eagle drop
  // Nobody spawns in a camp: after LOCK IN every slot rides a great white eagle
  // along a seed-fixed line across the world (mode 'drop'). The view zooms out
  // to DROP_ROWS, a chart in the corner shows the line and the bird, and the
  // rider jumps with Space/Enter/E/click (AI slots jump at their own hashed
  // fraction of the route). A jumper free-falls for FALL_T onto the nearest
  // open tile, which becomes its respawn point; the human's landing snaps the
  // view back to base zoom and runs the HUD slide-in. If the rider never jumps,
  // the end of the line jumps for them. state.drop outlives mode 'drop' - the
  // eagle keeps flying (and dropping bots) until it is off the map.
  const DROP_ROWS = 540;      // view rows while riding (2x the play view)
  const EAGLE_SPD = 170;      // px/s along the route
  const EAGLE_R = WORLD / 2 - 40; // route endpoints sit this many tiles from the centre (over the treeline)
  const FALL_T = 1.3;         // seconds of free fall
  const DRIFT_SPD = 130;      // px/s a faller steers sideways with WASD (~10 tiles over the fall)
  const DROP_ALT = 56;        // screen px between the bird / a faller and its shadow
  const EAGLE_SCALE = 2;      // the bird is high above the ground: drawn at 2x

  // the seed's line: two points on a ring just inside the forest, roughly
  // opposite each other. hash2 only - never rng(), which would reshuffle seeds.
  function makeEagleRoute() {
    const c = WORLD * TILE / 2;
    const a0 = hash2(3, 141) * Math.PI * 2;
    const a1 = a0 + Math.PI + (hash2(5, 77) - 0.5) * 1.4;
    const x0 = c + Math.cos(a0) * EAGLE_R * TILE, y0 = c + Math.sin(a0) * EAGLE_R * TILE;
    const x1 = c + Math.cos(a1) * EAGLE_R * TILE, y1 = c + Math.sin(a1) * EAGLE_R * TILE;
    const len = Math.hypot(x1 - x0, y1 - y0);
    return { x0, y0, x1, y1, len, dur: len / EAGLE_SPD, heading: Math.atan2(y1 - y0, x1 - x0) };
  }

  function beginDrop() {
    const r = makeEagleRoute();
    state.drop = Object.assign({ t: 0, x: r.x0, y: r.y0, prog: 0, flap: 0 }, r);
    for (const p of players) {
      if (!p.active) continue;
      p.aboard = true; p.dropT = 0;
      p.x = r.x0; p.y = r.y0;
      // bots spread along the middle of the line; the human rides to the end unless they jump
      p.dropU = p.control === 'ai' ? 0.12 + 0.76 * hash2(p.id * 31 + 5, 9) : 1;
    }
    buildWorldMapImg();                 // the chart: baked once, the ride is too short to matter
    mapCtx.putImageData(mapImg, 0, 0);
    state.mode = 'drop';
    state.menu.panel = null;
    state.menu.screen = 'menu';
    // the view grows around its centre; ease in from the drift's framing
    const ow = VIEW_W, oh = VIEW_H;
    applyView();
    state.introFrom = { x: camX - (VIEW_W - ow) / 2, y: camY - (VIEW_H - oh) / 2 };
    state.intro = INTRO_T; state.introLen = INTRO_T;
    SFX.dawnChime();
  }

  // off the bird: fall straight down from where it is right now
  function dropJump(p) {
    if (!p.aboard || !state.drop) return;
    const d = state.drop;
    p.aboard = false;
    p.dropT = FALL_T;
    p.x = d.x; p.y = d.y;
    if (p.control === 'ai') { // scatter bots off the line so they don't stack
      const off = (hash2(p.id * 7 + 1, 33) - 0.5) * 8 * TILE;
      p.x += -Math.sin(d.heading) * off;
      p.y += Math.cos(d.heading) * off;
    }
    if (p === player) SFX.dodge();
  }

  // touchdown: the nearest open tile to the fall point becomes the slot's
  // position and its respawn tile. Only the local landing changes the mode.
  function landPlayer(p) {
    const ftx = Math.floor(p.x / TILE), fty = Math.floor(p.y / TILE);
    let best = null;
    for (let r = 0; r <= 80 && !best; r++) {
      let bd = 1e9;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = ftx + dx, ty = fty + dy;
        if (!inWorld(tx, ty) || objAt(tx, ty) || ground[idx(tx, ty)] === 2) continue;
        const dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = { tx, ty }; }
      }
    }
    if (!best) best = { tx: WORLD >> 1, ty: WORLD >> 1 };
    p.spawn = best;
    p.x = (best.tx + 0.5) * TILE; p.y = (best.ty + 0.5) * TILE;
    p.dropT = 0; p.vx = p.vy = 0;
    p.invuln = 2; // a beat of grace while the snow settles
    burst(p.x, p.y - 2, '#f4f7ff', 16, 70, 0.5, true);
    if (p === player) {
      state.mode = 'play';
      applyView();                      // back to the play zoom, centred on the landing
      camX = Math.max(0, Math.min(WORLD * TILE - VIEW_W, p.x - VIEW_W / 2));
      camY = Math.max(0, Math.min(WORLD * TILE - VIEW_H, p.y - VIEW_H / 2));
      state.introFrom = { x: camX, y: camY };
      state.intro = HUD_IN_T; state.introLen = HUD_IN_T; // the HUD slides in, the camera settles
      state.menu.screenT = 0;
      state.shake = 5;
      SFX.hit();
    } else {
      addFloater(p.x, p.y - 20, p.name + ' LANDED', TEAMS[p.team].mark);
    }
  }

  function updateDrop(dt) {
    const d = state.drop;
    d.t += dt; d.flap += dt;
    const dist = EAGLE_SPD * d.t;
    d.prog = Math.min(1, dist / d.len);
    d.x = d.x0 + Math.cos(d.heading) * dist;
    d.y = d.y0 + Math.sin(d.heading) * dist;
    for (const p of players) {
      if (!p.active) continue;
      if (p.aboard) {
        p.x = d.x; p.y = d.y;
        if (d.prog >= p.dropU) dropJump(p); // the end of the line drops the human too
      } else if (p.dropT > 0) {
        p.dropT -= dt;
        // steer the fall: the input axis drifts the landing point
        const dm = Math.hypot(p.input.mx, p.input.my);
        if (dm > 0) {
          p.x = Math.max(TILE, Math.min(WORLD * TILE - TILE, p.x + p.input.mx / dm * DRIFT_SPD * dt));
          p.y = Math.max(TILE, Math.min(WORLD * TILE - TILE, p.y + p.input.my / dm * DRIFT_SPD * dt));
        }
        if (p.dropT <= 0) landPlayer(p);
      }
    }
    // everyone is off and the bird has cleared the map: done
    if (d.prog >= 1 && dist > d.len + 60 * TILE && !players.some((p) => p.active && inAir(p))) state.drop = null;
  }

  // the bird, its rider and every faller, above the world and below the
  // lighting. Shadows sit DROP_ALT below (and a little right of) each body.
  function drawDropAir(ex, ey, now) {
    const d = state.drop;
    if (!d) return;
    const S = EAGLE_SCALE;
    const frames = SPRITES.eagle;
    const spr = frames[[0, 1, 2, 1][Math.floor(d.flap * 7) % 4]];
    const w = spr.width * S, h = spr.height * S;
    const sx = Math.round(d.x - ex), sy = Math.round(d.y - ey);
    if (sx > -w && sy > -h - DROP_ALT && sx < VIEW_W + w && sy < VIEW_H + h) {
      const bob = Math.round(Math.sin(now * 2.4) * 3);
      ctx.save();
      ctx.translate(sx + 10, sy + DROP_ALT);
      ctx.rotate(d.heading);
      ctx.drawImage(SPRITES.eagleShadow, -w / 2, -h / 2, w, h);
      ctx.restore();
      ctx.save();
      ctx.translate(sx, sy + bob);
      ctx.rotate(d.heading);
      ctx.drawImage(spr, -w / 2, -h / 2, w, h);
      ctx.restore();
      // the local rider sits on its back (unrotated, so the face reads)
      if (player.aboard) {
        const ps = champSet(player).down[0];
        ctx.drawImage(ps, sx - 16, sy + bob - 17, 32, 32);
      }
      // where a jump right now would land: a pulsing ring under the bird
      if (player.aboard && state.mode === 'drop') {
        const ph = (now * 1.2) % 1;
        ctx.globalAlpha = 0.8 - ph * 0.6;
        ctx.strokeStyle = '#ffd95c';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy + DROP_ALT, 6 + ph * 12, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // fallers: shrink from the bird's scale to the ground's, shadow growing under them
    for (const p of players) {
      if (!p.active || p.dropT <= 0) continue;
      const q = 1 - p.dropT / FALL_T;          // 0 just jumped .. 1 touching down
      const alt = DROP_ALT * (1 - q * q);      // gravity: slow start, fast finish
      const sc = S - (S - 1) * q;
      const px = Math.round(p.x - ex), py = Math.round(p.y - ey);
      if (px < -40 || py < -120 || px > VIEW_W + 40 || py > VIEW_H + 40) continue;
      const sw = Math.round(3 + 5 * q);
      ctx.fillStyle = 'rgba(40,60,100,' + (0.12 + 0.28 * q).toFixed(2) + ')';
      ctx.fillRect(px - sw, py - 1, sw * 2, 2);
      const ps = champSet(p).down[1 + (Math.floor(p.dropT * 10) % 2)];
      const dw = Math.round(16 * sc);
      ctx.drawImage(ps, Math.round(px - dw / 2), Math.round(py - alt - 12 * sc), dw, dw);
    }
  }

  // the ride's HUD: chart with the line and the bird, the jump prompt and timer
  function renderDropUI(now) {
    const d = state.drop;
    if (!d || window.DBG.hideUI) return;
    const big = VIEW_H >= 500;
    const ts = big ? 2 : 1;                   // text scale follows the zoomed-out view
    // chart (right edge, integer scale so the pixels stay even)
    const cs = big ? WORLD : WORLD >> 1;
    const k = cs / WORLD;
    const cx0 = VIEW_W - cs - 12 * ts, cy0 = Math.round((VIEW_H - cs) / 2);
    ctx.fillStyle = 'rgba(12,18,42,0.85)';
    ctx.fillRect(cx0 - 3, cy0 - 3, cs + 6, cs + 6);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(cx0 - 1, cy0 - 1, cs + 2, cs + 2);
    ctx.drawImage(mapCv, cx0, cy0, cs, cs);
    const title = "THE EAGLE'S LINE";
    drawPixelTextOutline(ctx, title, Math.round(cx0 + (cs - pixelTextWidth(title, ts)) / 2), cy0 - 3 - 7 * ts,
      '#ffd95c', '#0f1632', ts);
    // the line, dashed, the flown part solid
    const mx = (x) => cx0 + (x / TILE) * k, my = (y) => cy0 + (y / TILE) * k;
    ctx.save();
    ctx.lineWidth = 3;                      // dark ink under the line so it reads on parchment and forest alike
    ctx.strokeStyle = 'rgba(36,26,16,0.7)';
    ctx.beginPath(); ctx.moveTo(mx(d.x0), my(d.y0)); ctx.lineTo(mx(d.x1), my(d.y1)); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = '#ffd95c';
    ctx.beginPath(); ctx.moveTo(mx(d.x0), my(d.y0)); ctx.lineTo(mx(d.x1), my(d.y1)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#fff3c0';
    ctx.beginPath(); ctx.moveTo(mx(d.x0), my(d.y0)); ctx.lineTo(mx(d.x), my(d.y)); ctx.stroke();
    ctx.restore();
    // the named places - the whole point of reading the chart on the way in.
    // Names only at full scale; at half scale they would sit on top of each other.
    for (const L of landmarks) {
      const lx = cx0 + (L.tx + 0.5) * k, ly = cy0 + (L.ty + 0.5) * k;
      drawLandmarkIcon(ctx, L, lx, ly - (big ? 4 : 0), L.spec.mark, '#0f1632');
      if (!big) continue;
      const w = pixelTextWidth(L.name);
      const nx = Math.max(cx0, Math.min(cx0 + cs - w, Math.round(lx - w / 2)));
      drawPixelTextOutline(ctx, L.name, nx, Math.round(ly + 2), '#f4f7ff', '#0f1632');
    }

    // the end of the line: where the bird drops whoever is still aboard
    ctx.fillStyle = '#241a10'; ctx.fillRect(Math.round(mx(d.x1)) - 2, Math.round(my(d.y1)) - 2, 5, 5);
    ctx.fillStyle = '#ffd95c'; ctx.fillRect(Math.round(mx(d.x1)) - 1, Math.round(my(d.y1)) - 1, 3, 3);
    // landed rivals, in team colour
    for (const p of players) {
      if (p === player || !p.active || inAir(p)) continue;
      const px = Math.round(mx(p.x)), py = Math.round(my(p.y));
      ctx.fillStyle = '#241a10'; ctx.fillRect(px - 2, py - 2, 5, 5);
      ctx.fillStyle = TEAMS[p.team].mark; ctx.fillRect(px - 1, py - 1, 3, 3);
    }
    // the bird: white diamond with a pulsing ring; your landing once you have jumped
    const bx = Math.round(mx(d.x)), by = Math.round(my(d.y));
    const ph = (now * 0.9) % 1;
    ctx.globalAlpha = (1 - ph) * 0.6;
    ctx.strokeStyle = '#f4f7ff';
    ctx.beginPath(); ctx.arc(bx, by, 2 + ph * 6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#241a10';
    ctx.fillRect(bx - 3, by - 1, 7, 3); ctx.fillRect(bx - 1, by - 3, 3, 7);
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(bx - 2, by, 5, 1); ctx.fillRect(bx, by - 2, 1, 5);
    if (!player.aboard) {
      const px = Math.round(mx(player.x)), py = Math.round(my(player.y));
      ctx.fillStyle = '#241a10';
      ctx.fillRect(px - 2, py - 1, 5, 3); ctx.fillRect(px - 1, py - 2, 3, 5);
      ctx.fillStyle = '#e05548';
      ctx.fillRect(px - 1, py, 3, 1); ctx.fillRect(px, py - 1, 1, 3);
    }

    // prompt + timer, top centre
    const cxm = Math.round(VIEW_W / 2);
    if (player.aboard) {
      const pulse = 0.75 + Math.sin(now * 5) * 0.25;
      const t1 = 'SPACE - JUMP';
      ctx.globalAlpha = pulse;
      drawPixelTextOutline(ctx, t1, Math.round(cxm - pixelTextWidth(t1, ts) / 2), 10 * ts, '#ffd95c', '#0f1632', ts);
      ctx.globalAlpha = 1;
      // time left on the line
      const left = Math.max(0, d.dur - d.t);
      const bw = 60 * ts, bh = 3 * ts, bxx = cxm - bw / 2, byy = 19 * ts;
      ctx.fillStyle = 'rgba(12,18,42,0.78)';
      ctx.fillRect(bxx - 1, byy - 1, bw + 2, bh + 2);
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(bxx, byy, bw, bh);
      ctx.fillStyle = left < 3 ? '#ff6a5a' : '#f4f7ff';
      ctx.fillRect(bxx, byy, Math.round(bw * (1 - d.prog)), bh);
      const t2 = Math.ceil(left) + 'S';
      drawPixelTextOutline(ctx, t2, bxx + bw + 4 * ts, byy - ts, '#cfe0ff', '#0f1632', ts);
      const t3 = 'THE EAGLE DROPS YOU AT THE END OF ITS LINE';
      drawPixelTextOutline(ctx, t3, Math.round(cxm - pixelTextWidth(t3, ts) / 2), VIEW_H - 14 * ts, '#9fb6d8', '#0f1632', ts);
    } else {
      const t1 = 'WASD - DRIFT';
      drawPixelTextOutline(ctx, t1, Math.round(cxm - pixelTextWidth(t1, ts) / 2), 10 * ts, '#f4f7ff', '#0f1632', ts);
    }
  }

  // ------------------------------------------------------------ boot
  function startGame() {
    SFX.unlock();
    beginDrop();
  }

  loadSettings();
  relayout(); // fitCanvas already ran at load; this places the UI for the fitted view
  SFX.setVolume(settings.volume);
  SFX.setMuted(settings.muted);
  genWorld();
  placeLandmarks();  // worldgen's last pass, before the ground is baked
  spawnAnimals();
  spawnFish();
  stockLandmarks();  // wolves and birds go in once the world is standing
  initPlayers();
  renderGround();
  buildMapPanel();
  buildSettingsPanel();
  buildHelpPanel();
  rebuildLights();
  camX = player.x - VIEW_W / 2;
  camY = player.y - VIEW_H / 2;
  // landing from a reroll: the whiteout the die left behind clears to the new world
  try {
    if (sessionStorage.getItem('emberfrost.reroll')) {
      sessionStorage.removeItem('emberfrost.reroll');
      state.fade = { a: 1, to: 0, spd: 1 / 0.8, color: '#f4f7ff', then: null };
      state.menu.rolling = 0.5;
    }
  } catch (e) { }

  // debug/dev harness: lets external tooling step frames & stage scenes
  window.DBG = {
    SEED, state, animals, objects, ground, lights, mouse, keys, drops, footprints, flakes,
    fish, iceCracks, holes, crackIce, addFish,
    // named places: the live registry, the table behind it, and what is where
    landmarks, LANDMARKS, landmarkAt, stockLandmarks, flushBirds,
    // drop a slot (default the local one) on a tile - how to stage a landmark
    warp: (tx, ty, p) => { const q = p || player; q.x = (tx + 0.5) * TILE; q.y = (ty + 0.5) * TILE; q.vx = q.vy = 0; return q; },
    settings, perf, treeRare, cursorInfo,
    structures, robots, tracers, arrows, STRUCTS, TOOLS,
    // multiplayer slots: every slot, the local one, and the teams table
    players, MAX_PLAYER_SLOTS, TEAMS, Player, ringPts, contestRank,
    // the eagle drop: the live flight record, force a jump, or fly the route from scratch
    get drop() { return state.drop; }, beginDrop, dropJump: (p) => dropJump(p || player), landPlayer, makeEagleRoute, inAir,
    get player() { return player; },
    get inv() { return player.inv; },
    // hand a slot to an AI, a human, or nobody (a ghost at its camp)
    setControl: (slot, mode) => { const p = players[slot]; if (p) p.control = mode; return p; },
    placeObj, rebuildLights, idx, objAt, hoverFish, damagePlayer, die, respawn, updateAI, contest,
    // hero levels: pay a slot gold (and XP) the way a pickup would
    gainGold: (n, p) => gainGold(p || player, n), LEVEL_XP, LEVEL_MAX,
    // the match readouts: stage feed lines without staging the kills behind
    // them, and check the standings (hold TAB in game, or set keys.tab here)
    events, logEvent, scoreGroups, scoreboardOpen,
    // action entry points default to the local slot, or take any player
    clickAction: (p) => clickAction(p || player),
    tryWork: (p) => tryWork(p || player),
    workTarget: (p) => workTarget(p || player),
    fireArrow: (p) => fireArrow(p || player),
    tryDodge: (p) => tryDodge(p || player),
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
      o.owner = player.id; o.team = player.team;
      structures.push(o);
      return o;
    },
    finishBuild: (o) => { if (o && o.building) o.buildT = o.buildTotal; },
    setZoom: (n) => { zoomStep = Math.max(0, n | 0); },
    getZoom: () => ({ step: zoomStep, applied: zoomEff, max: zoomMax }),
    setTool: (i, p) => { (p || player).tool = i; },
    getTool: (p) => (p || player).tool,
    cam: () => ({ x: camX, y: camY }),
    startGame, beginIntro, beginSelect, lockIn, setChamp, CHAMPS, menu: state.menu, menuHit, menuClick, menuKey, settingsHit, selectHit,
    layout: () => ({ VIEW_W, VIEW_H, SET_X, SET_Y, SL_X, ROW_SHAKE, PANEL_X, PANEL_Y, MM_CX, MM_CY }),
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
