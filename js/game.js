// Softfall - a cozy winter survival game.
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
  // The quiver: arrows are a resource, not an infinite stream. A shot spends one
  // and starts the nock cooldown (the kit's `nock`, so a champion's draw speed
  // sets its own rhythm); an empty quiver fletches one back every QUIVER_REGEN,
  // and every arrow that ends its flight sticks in the snow to be pulled out
  // again. Fletching alone is the floor - retrieval is how a good shot stays armed.
  const QUIVER_MAX = 6;     // arrows carried
  const QUIVER_REGEN = 2.4; // seconds to fletch one arrow back (only ticks below max)
  const BOW_NOCK = 0.45;    // WREN's seconds between loosing and the next draw
  const SHAFT_LIFE = 30;    // seconds a spent arrow stays stuck in the snow
  const SHAFT_R = 10;       // px: walk this close to pull one out
  const SHAFT_ARM = 0.3;    // s before a fresh shaft can be picked up (never your own muzzle)
  const SHAFT_NEAR = 34;    // px: inside this the shaft brightens and grows its chevron
  const SHAFT_MAX = 90;     // oldest shafts drop off past this many in the world
  const ARROW_TRAIL_STEP = 4;    // px of flight between trail motes (distance, not time, so a
  const ARROW_TRAIL_LIFE = 0.22; // slow arrow streaks as evenly as a fast one); motes fade over
  const ARROW_TRAIL_A = 0.7;     // their whole life from this alpha, so the tail thins out behind
  const ARROW_RIM = '#0d1226';  // 1px dark rim under the shaft, so it reads over snow
  const WORK_REACH = 1;     // E works tiles within this many tiles (Chebyshev) of the player's tile
  const STRUCT_HIT_DMG = 10; // axe damage per E swing against an ENEMY building (own ones are demolished from the wheel)
  // turret gunnery. The head is NOT baked into the sprite (see js/sprites.js) - it
  // is rasterised at the live angle, pivoting on sprite-local (16, 14).
  const TUR_PIVOT_Y = -4;   // px: the pivot, relative to the anchor tile's top edge
  const TUR_BARREL = 16;    // px from pivot to muzzle
  const TUR_LOCK = 0.14;    // rad: inside this of the mark, the shot starts charging
  const TUR_MZ = 0.09;      // muzzle flash duration
  const BOLT_SPD = 250;     // px/s
  const BOLT_LIFE = 1.1;
  const DODGE_T = 0.28;     // roll duration (s)
  const DODGE_SPEED = 215;  // roll velocity -> ~60px travelled
  const DODGE_CHARGES = 2;
  const DODGE_CD = 3.5;     // seconds to refill one charge

  // Prone: lie down in the snow, pull it over yourself, and be almost - not
  // quite - invisible. Free, and paid for entirely in speed: the burrow only
  // builds while you are lying perfectly still, and the crawl that carries you
  // anywhere is under a third of a walk. `p.hide` (0..1) is the whole state,
  // and every watcher in the game reads it through seenAt().
  const PRONE_SPEED = 20;   // px/s belly crawl (a walk is PLAYER_SPEED, 72)
  const PRONE_BURY = 1.5;   // s of lying still to go from flat on the snow to under it
  const PRONE_RISE = 0.34;  // s of getting back up: 45% walk speed, and no cover left
  const PRONE_ENTER = 14;   // px/s: above this you are still moving, and cannot drop
  const PRONE_CUT = 0.86;   // fraction full cover takes off every sight range
  const PRONE_MOVE = 0.5;   // ...of which a crawling mound keeps. Hold still to vanish
  const PRONE_SNIFF = 22;   // px: nothing hides at arm's length, whatever it is under
  const PRONE_MAP = 0.55;   // cover past this drops a rival off both maps (a crawler never reaches it)
  const AMBUSH_MUL = 2.5;   // damage on the shot loosed out of full cover

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
    // traverse = rad/s the head swings; aim = seconds held on target before it fires
    turret: { name: 'TURRET', tiers: [
      { cost: { gold: 10 }, hp: 50,  buildT: 8,   range: 60, dmg: 6,  rate: 1.0,  traverse: 2.2, aim: 0.55 },
      { cost: { gold: 25 }, hp: 90,  buildT: 4.8, range: 76, dmg: 9,  rate: 0.8,  traverse: 3.0, aim: 0.45 },
      { cost: { gold: 50 }, hp: 140, buildT: 4.8, range: 92, dmg: 14, rate: 0.65, traverse: 3.8, aim: 0.35 },
    ]},
    generator: { name: 'GENERATOR', tiers: [
      { cost: { gold: 12 }, hp: 40,  buildT: 8,   pay: 1, period: 10 },
      { cost: { gold: 25 }, hp: 70,  buildT: 4.8, pay: 2, period: 10 },
      { cost: { gold: 45 }, hp: 100, buildT: 4.8, pay: 4, period: 10 },
    ]},
    // the bot bay is the one big build: a single tier on a 3x2 tile footprint
    // (w/h - see footprint()/findSite()), its three bots rolling out one by one
    spawner: { name: 'BOT BAY', w: 3, h: 2, tiers: [
      { cost: { gold: 45 }, hp: 220, buildT: 16, bots: 3, botHp: 24 },
    ]},
  };
  const STRUCT_ORDER = ['wall', 'turret', 'generator', 'spawner']; // wheel: up, right, down, left

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
  let ROW_SOUND = SET_Y + 28, ROW_MUTE = SET_Y + 44, ROW_MAP = SET_Y + 60, ROW_SHAKE = SET_Y + 76,
    ROW_INFO = SET_Y + 92, ROW_CURSOR = SET_Y + 108;

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
    mode: 'title', // title | drop | play | dead  (drop = riding / falling from the eagle; dead = the local slot is out of the match, or it is over)
    time: DAY_LEN * 0.25, // start mid-morning
    elapsed: 0,
    day: 1,
    tick: 0,       // sim steps taken; with SEED + player id it decides contested orders
    darkness: 0,
    shake: 0,
    deadTimer: 0,
    // out of the match: the overlay's state. over: 'lost' | 'won' | null; view:
    // 'menu' (the planks) | 'spec' (following a living slot); spec: that slot's
    // id; sel + hover: the planks' keyboard pick and per-plank hover eases
    over: null, deadView: 'menu', spec: -1, deadSel: 0, deadHover: [0, 0],
    win: null,     // a win freezes the numbers the victory screen prints: winSnapshot(), the victory banner
    msg: null, msgT: 0,
    hints: { stump: false },
    loc: null,     // the named place the local player is standing in: { L, t }
    paused: false,
    mapOpen: false,
    settingsOpen: false,
    wheel: null, // radial menu: { kind: 'build'|'manage', tx, ty, seg, ax, ay } - ax/ay is the press point
    // main menu (mode === 'title'): keyboard selection, per-item hover eases,
    // the open sub-panel ('settings' | 'help' | null) and its slide progress
    menu: { sel: 0, hover: [0, 0, 0, 0, 0], t: 0, // one hover ease per MENU_ITEMS entry + the seed row
      panel: null, panelT: 0, closing: false, patchScroll: 0, // patchScroll: px the notes are scrolled
      moved: false, dieT: 0, rolling: 0, camT: 0, pressT: 0,
      // the frozen plank: refusal shudder timer, per-knock crack seed, the
      // struck point (plank-local) and the ice chips it sprays (screen-space)
      iceT: 0, iceSeed: 0, iceX: 0, iceY: 0, shards: [],
      // champion select: which screen the menu shows, its cross-fade, the
      // highlighted champion, per-card hover eases, swap pop, lock-in hold
      screen: 'menu', screenT: 0, csel: 0, chover: [0, 0], cswapT: 1, lockT: 0,
      gearT: 0, grow: 0 },
    intro: 0,            // seconds left of the title -> drop / landing -> play transition (0 = none)
    introLen: 1,         // that transition's full length (the camera ease divides by it)
    introFrom: null,     // camera position the transition started from
    drop: null,          // the eagle while it is in the air: see makeEagleRoute() / beginDrop()
    fade: null,          // screen fade: { a, to, spd, color, then }
  };

  const settings = { v: 2, volume: 0.5, mmR: 24, mmZoom: 5, shake: true, muted: false, info: false, pixelCursor: true, hitbox: 0 };
  // Minimap zoom ladder, px per world tile: index settings.mmZoom (5 = the 1:1
  // baseline). Twice the rungs and twice the reach of the old six, and like the
  // camera it eases between them rather than snapping - mmCur is what anything
  // drawing the disc reads.
  const MM_ZOOMS = [0.25, 0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.6, 2, 2.5, 3.2, 4];
  // saves written before settings.v existed hold an index into the old
  // [0.5, 0.75, 1, 1.5, 2, 3]; land each one on its nearest new rung
  const MM_MIGRATE = [2, 3, 5, 7, 8, 10];
  let mmCur = -1; // eased px per tile; negative = not yet snapped to the setting
  function mmStep() { return Math.max(0, Math.min(MM_ZOOMS.length - 1, settings.mmZoom | 0)); }
  function mmWant() { return MM_ZOOMS[mmStep()]; }
  function mmScale() { return mmCur < 0 ? mmWant() : mmCur; }
  // pointer over the minimap disc (its ring included)
  function overMinimap() { return mouse.inside && Math.hypot(mouse.x - MM_CX, mouse.y - MM_CY) <= MM_R + 7; }

  // performance monitor: fps averaged over half-second windows from raw
  // (unclamped) frame deltas, so sim clamping can't mask slow frames
  const perf = { fps: 0, frames: 0, acc: 0 };

  function saveSettings() {
    try { localStorage.setItem('softfall.settings', JSON.stringify(settings)); } catch (e) { }
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('softfall.settings'));
      if (s) Object.assign(settings, s);
      // a save from before the minimap ladder grew: its mmZoom indexes the old
      // six-rung array, so carry it across instead of silently rescaling the
      // disc under someone who had already set it where they wanted it
      if (s && s.v !== 2) {
        settings.mmZoom = MM_MIGRATE[Math.max(0, Math.min(MM_MIGRATE.length - 1, s.mmZoom | 0))];
        settings.v = 2;
      }
    } catch (e) { }
    mmCur = mmWant();
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
    ROW_SHAKE = SET_Y + 76; ROW_INFO = SET_Y + 92; ROW_CURSOR = SET_Y + 108;
    fitFlakes();
    renderBars();
    layoutReplay();
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
        bowCharge: BOW_CHARGE, nock: BOW_NOCK, dmgBase: 4, dmgPow: 9, spdDmg: 0, dodgeSpeed: DODGE_SPEED, maxHp: 100 },
    },
    {
      name: 'SKADI', role: 'THE SKATER',
      blurb: ['BLADES ON THE ICE: FASTER CAP, SHARPER CARVES.', 'QUICK DRAW THAT BARELY SLOWS HER DOWN.', 'ARROWS HIT HARDER THE FASTER SHE FLIES.'],
      stats: { ice: 5, draw: 5, power: 2, tough: 2 },
      kit: { iceMax: 1.35, iceSteer: 3.8, slideMin: 60, fatigue: 0.5, chargeMul: 0.85,
        bowCharge: 0.6, nock: 0.3, dmgBase: 3, dmgPow: 6, spdDmg: 7, dodgeSpeed: 245, maxHp: 85 },
    },
  ];
  // the kit every sim site reads: the champion's numbers with the slot's gear
  // folded in. refreshKit() rebuilds the cache whenever champion or gear
  // changes; kitOf() itself is called many times a frame and must stay a read.
  function kitOf(p) { return p.kit || CHAMPS[p.champ].kit; }
  // swap a slot's champion: kit hp applies on the spot (full heal, it's a pre-match choice)
  function setChamp(p, c) { p.champ = c; refreshKit(p); p.hp = p.maxHp; }
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

  // ---- gear ----------------------------------------------------------------
  // Four pieces - helmet, chest, legs, boots - each picked from three variants
  // at champ select (that free pick is level 1) and bought to level GEAR_LV_MAX
  // in-match, from anywhere, per piece. A variant's mod() writes its bonus into
  // the effective kit at the piece's level, so the whole system is one table
  // plus refreshKit(); the sim never reads gear directly. Levels reset with the
  // match because every boot builds fresh Players. The HUD row (UI banner) and
  // the bots both buy through input.cmd {kind:'gear', piece}, never directly.
  const GEAR_SLOTS = ['HELMET', 'CHEST', 'LEGS', 'BOOTS'];
  const GEAR_COSTS = [10, 20, 35]; // gold to reach piece level 2 / 3 / 4
  const GEAR_LV_MAX = 4;
  const GEAR_MATS = ['#8a6a4a', '#9aa3ad', '#9fc4dd', '#f2cc6a']; // leather/iron/steel/gold, by piece level
  const GEAR = [
    [ // helmet: how you kill
      { name: 'LONGSIGHT', blurb: 'ARROWS HIT HARDER', mod: (k, L) => { k.dmgBase += L; } },
      { name: 'QUICKDRAW', blurb: 'FASTER DRAW AND RENOCK', mod: (k, L) => { k.bowCharge *= 1 - 0.08 * L; k.nock *= 1 - 0.08 * L; } },
      { name: 'HUNTSMAN', blurb: 'ANIMALS PAY MORE', mod: (k, L) => { k.huntMul += 0.15 * L; } },
    ],
    [ // chest: how you last
      { name: 'BULWARK', blurb: 'MORE HEALTH', mod: (k, L) => { k.maxHp += 8 * L; } },
      { name: 'IRONHIDE', blurb: 'EVERY HIT HURTS LESS', mod: (k, L) => { k.dr += L; } },
      { name: 'HEARTHWEAVE', blurb: 'FOOD AND NIGHTS ARE KINDER', mod: (k, L) => { k.foodMul += 0.25 * L; k.nightHeal = true; } },
    ],
    [ // legs: how you cross snow
      { name: 'STRIDER', blurb: 'WALK FASTER', mod: (k, L) => { k.walkMul += 0.04 * L; } },
      { name: 'SLIDEWORN', blurb: 'LONGER, EARLIER SLIDES', mod: (k, L) => { k.fatigue *= 1 - 0.12 * L; k.slideMin -= 5 * L; } },
      { name: 'PACKMULE', blurb: 'FELLS AND BREAKS PAY MORE', mod: (k, L) => { k.harvest += L; } },
    ],
    [ // boots: how you skate and dodge
      { name: 'SKATES', blurb: 'FASTER, SHARPER ON ICE', mod: (k, L) => { k.iceMax *= 1 + 0.08 * L; k.iceSteer += 0.15 * L; } },
      { name: 'DANCER', blurb: 'DODGES COME BACK SOONER', mod: (k, L) => { k.dodgeCd -= 0.4 * L; } },
      { name: 'GHOSTSTEP', blurb: 'FOES SPOT YOU FROM CLOSER', mod: (k, L) => { k.stealth -= 0.10 * L; } },
    ],
  ];
  // rebuild p.kit from champion + gear. The gear-free defaults added here are
  // the fields no champion kit carries; a variant's mod() edits them in place.
  function refreshKit(p) {
    const k = Object.assign({}, CHAMPS[p.champ].kit, {
      huntMul: 1, dr: 0, foodMul: 1, nightHeal: false, walkMul: 1,
      harvest: 0, dodgeCd: DODGE_CD, stealth: 1,
    });
    for (let i = 0; i < GEAR.length; i++) GEAR[i][p.gear[i]].mod(k, p.gearLv[i]);
    p.kit = k;
    p.maxHp = levelMaxHp(p);
    if (p.hp === undefined || p.hp > p.maxHp) p.hp = p.maxHp;
  }
  function gearCost(p, i) { return p.gearLv[i] >= GEAR_LV_MAX ? null : { gold: GEAR_COSTS[p.gearLv[i] - 1] }; }
  // the one entry point for an upgrade, reached through runCmd so every buyer -
  // HUD click, number key, bot - goes the same way. A BULWARK bump heals the
  // new hp on the spot, the way a hero level does.
  function buyGear(p, i) {
    const cost = gearCost(p, i);
    if (!cost || !canAfford(cost, p)) { if (p === player) SFX.deny(); return; }
    pay(cost, p);
    p.gearLv[i]++;
    const oldMax = p.maxHp;
    refreshKit(p);
    if (p.maxHp > oldMax) p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - oldMax));
    addFloater(p.x, p.y - 18, GEAR[i][p.gear[i]].name + ' ' + p.gearLv[i], GEAR_MATS[p.gearLv[i] - 1]);
    burst(p.x, p.y - 8, GEAR_MATS[p.gearLv[i] - 1], 8, 40, 0.45);
    if (p === player) SFX.levelUp();
    else if (nearPlayer(p.x, p.y)) SFX.pickup();
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
      prone: false,        // edge-triggered: toggles the burrow (Ctrl). NOT a held
                           // level - holding a modifier while tapping W closes the
                           // browser tab, and preventDefault cannot stop it
      eatBerry: false, eatFish: false, // edge-triggered
      cmd: null,           // one-shot order: {kind:'build'|'upgrade'|'demolish'|'mode', tx, ty, id} or {kind:'gear', piece}
    };
  }

  class Player {
    constructor(slot, control) {
      this.id = slot;
      this.team = slot % TEAM_COUNT;
      this.control = control;             // 'human' | 'ai' | 'none' (empty slot -> ghost)
      this.name = control === 'human' ? 'YOU' : TEAMS[this.team].name + '-' + (slot + 1);
      this.spawn = { tx: WORLD >> 1, ty: WORLD >> 1 }; // landing tile once the eagle drops this slot (the bot brain's "home")
      this.inv = { gold: 0, berry: 0, fish: 0 };
      this.champ = 0;                     // CHAMPS index; the select screen sets the local one
      this.gear = [0, 0, 0, 0];           // chosen GEAR variant per slot (helmet/chest/legs/boots)
      this.gearLv = [1, 1, 1, 1];         // piece levels, 1..GEAR_LV_MAX - fresh every match
      this.level = 1; this.xp = 0;        // hero level and lifetime gold earned; survive death
      this.kills = 0;                     // rivals downed; scoreboard only, survives death
      refreshKit(this);                   // builds this.kit and this.maxHp from champ + gear
      this.aboard = false;                // riding the eagle (beginDrop sets it, dropJump clears it)
      this.dropT = 0;                     // seconds of free fall left after jumping (0 = on the ground)
      this.dropU = 1;                     // route fraction at which an AI slot jumps
      // bot brain (unused by a human slot): current job, give-up timers and the
      // short blacklists that keep a bot from re-picking work it cannot reach
      this.ai = {
        tgt: null, avoid: null, avoidT: 0, thinkT: 0,
        huntTgt: null, huntT: 0, huntAvoid: null, huntAvoidT: 0,
        lootT: 0, spendT: 0, buildT: 0,
        hideT: 0, hideCd: 0,
        wx: 0, wy: 0, roam: 0,
      };
      this.reset(true);
    }
    get active() { return this.control !== 'none'; }
    // camp placement + every transient cleared; used at boot (death is final, so nothing else calls it)
    reset(first) {
      this.x = (this.spawn.tx + 0.5) * TILE;
      this.y = (this.spawn.ty + 0.5) * TILE;
      this.vx = 0; this.vy = 0;
      this.dir = 'down'; this.moving = false; this.animT = 0;
      this.hp = this.maxHp;
      this.dead = false;
      this.charging = false; this.chargeT = 0;      // bow draw state
      // the quiver: what is left, the renock cooldown, and the fletching timer
      this.quiver = QUIVER_MAX; this.nockT = 0; this.fletchT = 0;
      this.fireArmed = false;                        // the bow button has been pressed since the last loose
      this.quiverFlash = 0; this.readyFlash = 0; this.dryT = 0; // HUD tells: gained / renocked / pressed empty
      this.dodgeT = 0; this.dodgeVX = 0; this.dodgeVY = 0; this.dodgeDustT = 0;
      this.dodgeCharges = DODGE_CHARGES; this.dodgeRegenT = 0;
      this.stamGhost = 0; this.stamGhostT = 0;      // spent-stamina ghost
      this.sliding = false; this.slideT = 0; this.trailD = 0; this.slideDustT = 0;
      // prone: lying down, how much snow is over you (0..1), the get-up window,
      // the crawl's animation phase, and the two tells a buried body still gives
      this.prone = false; this.hide = 0; this.riseT = 0;
      this.crawlT = 0; this.puffT = 0; this.hideFlash = 0;
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
    // AI slots draw their champion AND their four gear variants from the seed,
    // so a replayed world fields the same roster in the same loadouts
    for (const p of players) if (p.control === 'ai') {
      for (let i = 0; i < GEAR_SLOTS.length; i++) p.gear[i] = Math.floor(hash2(p.id * 29 + i * 13 + 5, 191) * 3) % 3;
      setChamp(p, hash2(p.id * 17 + 3, 77) < 0.5 ? 0 : 1); // refreshes the kit too
    }
    player = players[0];
    inv = player.inv;
  }

  // who p is allowed to shoot: another live slot on another team (this is the
  // one place the FFA/friendly-fire rule lives)
  function enemyOf(p, q) { return q !== p && q.active && !q.dead && !inAir(q) && (!PVP || q.team !== p.team); }
  // riding the eagle or falling from it: not in the world yet, nothing can touch it
  function inAir(p) { return p.aboard || p.dropT > 0; }

  // ---- being seen ---------------------------------------------------------
  // How buried a slot reads to anything hunting for it. `p.hide` is the cover
  // itself; a mound that is crawling is worth much less than one holding still,
  // which is the whole reason to stop moving before you shoot.
  function concealOf(p) { return p.hide > 0 ? p.hide * (p.moving ? PRONE_MOVE : 1) : 0; }
  // How far p is noticed from by a watcher whose plain sight range is `range`.
  // GHOSTSTEP always shortens it; lying under the snow shortens it hard - but
  // never past PRONE_SNIFF, because at arm's length you are found whatever you
  // are lying under. Every watcher in the game (the pack, the turrets, the bot
  // brain) resolves through this one function so they cannot disagree about who
  // is hidden.
  function seenAt(p, range) {
    const c = concealOf(p);
    const r = range * kitOf(p).stealth * (1 - PRONE_CUT * c);
    return c > 0 ? Math.max(r, Math.min(range, PRONE_SNIFF)) : r;
  }
  // the shot that was worth the wait: full cover, and dead still while it goes
  function ambushReady(p) { return p.prone && p.hide >= 1 && !p.moving; }

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
  const robots = []; // spawner-owned worker bots
  const tracers = []; // turret shot lines: {x0,y0,x1,y1,t}
  const arrows = []; // live bow shots: {x,y,vx,vy,t,life,dmg,pow}
  const shafts = []; // spent arrows stuck in the snow, free for anyone: {x,y,nx,ny,team,t}
  const ARROW_PX = []; // scratch x,y pairs for one arrow's rasterised body (render only)
  const drops = [];
  const particles = []; // {x,y,vx,vy,life,color,size,grav} + optional `alpha` fade ceiling
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
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab', 'F3'].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    // F3 flips the info stack in any mode, minecraft-style (the browser's own
    // F3 find bar is suppressed above)
    if (e.key === 'F3') { settings.info = !settings.info; saveSettings(); return; }
    // '.' cycles the hitbox overlay (off / bodies / bodies + ranges) in any mode,
    // beside F3 and for the same reason: what it draws is as true of the title
    // screen's living world and of a spectated match as it is of your own feet
    if (e.key === '.') { settings.hitbox = (settings.hitbox + 1) % 3; saveSettings(); return; }
    if (state.mode === 'title') { menuKey(e); return; }
    if (state.mode === 'drop') { if (e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'e') dropJump(player); return; }
    if (state.mode === 'dead') { deadKey(e.key.toLowerCase()); return; }
    if (state.mode !== 'play') return;
    // edge-triggered intents go into the local player's input struct; the sim
    // reads and clears them, exactly as it does for an AI slot
    if (e.key === ' ') player.input.dodge = true;
    // Ctrl TAPS the burrow on and off rather than being held: a held modifier
    // plus W is Ctrl+W, which closes the tab and which no page can preventDefault
    // its way out of. Modifiers auto-repeat while down, so the repeat is dropped.
    if (e.key === 'Control' && !e.repeat) player.input.prone = true;
    if (e.key.toLowerCase() === 'q') player.input.eatBerry = true;
    if (e.key.toLowerCase() === 'f') player.input.eatFish = true;
    // 1-4 buy the next level of that gear piece, left to right like the HUD row
    // (sampleHumanInput zeroes cmd while an overlay is up, so no guard needed)
    if (e.key >= '1' && e.key <= '4') player.input.cmd = { kind: 'gear', piece: e.key.charCodeAt(0) - 49 };
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
      const tx = Math.floor(mouseWX() / TILE), ty = Math.floor(mouseWY() / TILE);
      const o = structOf(objAt(tx, ty));
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
    if (state.mode === 'dead') { SFX.unlock(); deadClick(); return; }
    if (state.mode !== 'play') return;
    if (state.wheel) { state.wheel = null; return; } // left-click while it is open: cancel
    if (state.settingsOpen) { mouse.down = true; settingsMouseDown(); return; }
    if (state.mapOpen) return;
    // the gear row swallows its clicks before the bow ever sees them - the one
    // left-clickable HUD widget in play; a plate that can't sell just denies
    const gi = gearHit(mouse.x, mouse.y);
    if (gi >= 0) { SFX.unlock(); player.input.cmd = { kind: 'gear', piece: gi }; return; }
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
    if (state.mode === 'title') {
      if (state.menu.panel === 'patch') { e.preventDefault(); patchScrollBy(e.deltaY > 0 ? 16 : -16); }
      return;
    }
    if (state.mode !== 'play') return;
    e.preventDefault();
    if (state.mapOpen || state.settingsOpen || state.wheel) return;
    // over the minimap the wheel zooms the minimap instead of the camera
    if (overMinimap()) {
      settings.mmZoom = Math.max(0, Math.min(MM_ZOOMS.length - 1, (settings.mmZoom | 0) + (e.deltaY > 0 ? -1 : 1)));
      saveSettings();
      return;
    }
    // scroll up = closer. One notch = one device pixel per world pixel, which
    // is the finest step that still lands on a pixel-exact zoom.
    kWant = Math.max(kMin(), Math.min(kMax(), kWant + (e.deltaY > 0 ? -1 : 1)));
  }, { passive: false });

  // The local human's controller: keyboard + mouse folded into the same input
  // struct an AI writes, once per sim step. Pause and the settings panel zero it
  // (and drop any draw) so nothing leaks through a stopped sim; the map, which
  // does not stop the sim, keeps the feet and drops everything else.
  function sampleHumanInput(p) {
    const inp = p.input;
    inp.aimX = mouseWX();
    inp.aimY = mouseWY();
    // read the walk keys once - each branch below decides who gets them
    let mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    // The chart does not stop the world, so it does not stop the player: you
    // keep walking, sliding, rolling and burrowing with it up, and watch your
    // own marker move across it. Everything that acts on the world is dropped -
    // the pointer is over the parchment, so there is nothing to aim or work at,
    // and a gear plate bought blind under the dim would be bought by accident.
    if (state.mode === 'play' && state.mapOpen && !state.paused && !state.settingsOpen) {
      inp.mx = mx; inp.my = my;
      inp.slide = !!keys['shift'];
      inp.fire = inp.work = false;
      inp.eatBerry = inp.eatFish = false;
      inp.cmd = null;
      if (p.charging) { p.charging = false; p.chargeT = 0; }
      p.firePrev = false;
      p.fireArmed = false;
      return;
    }
    if (state.mode !== 'play' || state.paused || state.settingsOpen) {
      inp.mx = inp.my = 0;
      inp.fire = inp.work = inp.slide = false;
      inp.dodge = inp.prone = inp.eatBerry = inp.eatFish = false;
      inp.cmd = null;
      if (p.charging) { p.charging = false; p.chargeT = 0; }
      p.firePrev = false;
      p.fireArmed = false;
      // the one thing that works mid-air: WASD drifts the fall (updateDrop reads it)
      if (state.mode === 'drop' && !state.paused) { inp.mx = mx; inp.my = my; }
      return;
    }
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
      o.type === 'turret' || o.type === 'generator' || o.type === 'spawner' || o.type === 'part';
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

  // seconds as M:SS - the HUD's match clock and the victory tally's, one source
  function clockTxt(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function addFloater(x, y, txt, color) {
    floaters.push({ x, y, txt, color: color || '#ffffff', t: 0 });
  }

  // combat damage numbers: gold for damage the player's side deals, red '-N'
  // for damage taken. Heavy hits (10+) render at 2x; a little random drift
  // keeps rapid repeat hits from stacking into one unreadable pile.
  function addDmgFloater(x, y, amount, taken, crit) {
    const n = Math.max(1, Math.round(amount));
    floaters.push({
      x: x + rand(-3, 3), y,
      txt: taken ? '-' + n : String(n),
      // a crit keeps the red-taken / gold-dealt language and runs hotter inside it
      color: taken ? (crit ? '#ff9a6a' : '#ff6a5a') : (crit ? '#fff0b0' : '#ffd95c'),
      t: 0, vx: rand(-9, 9), scale: crit || n >= 10 ? 2 : 1, rise: crit ? 27 : 20,
    });
  }

  // an ambush arrow landing, on whatever it lands on: a gold flare over the
  // ordinary hit puff and a crack that never sounds like a normal shot
  function ambushFx(x, y) {
    burst(x, y, '#fff4d0', 10, 90, 0.4);
    burst(x, y, '#ffd95c', 7, 55, 0.5);
    if (nearPlayer(x, y)) SFX.ambush();
  }

  function burst(x, y, color, n, spd, life, grav) {
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, s = rand(0.3, 1) * (spd || 40);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7 - (grav ? 20 : 0),
        life: rand(0.5, 1) * (life || 0.5), maxLife: 0.4, color, size: rng() < 0.3 ? 2 : 1, grav: grav ? 90 : 0,
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
    const heal = Math.round(20 * kitOf(p).foodMul); // HEARTHWEAVE makes meals bigger
    p.hp = Math.min(p.maxHp, p.hp + heal);
    if (nearPlayer(p.x, p.y)) { SFX.eat(); setTimeout(() => SFX.heal(), 90); }
    addFloater(p.x, p.y - 14, '+' + heal, '#8fe08a');
    burst(p.x, p.y - 8, '#f2707a', 6, 30, 0.4);
  }

  function eatFish(p) {
    if (p.inv.fish <= 0 || p.hp >= p.maxHp) return;
    p.inv.fish--;
    const heal = Math.round(50 * kitOf(p).foodMul);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    if (nearPlayer(p.x, p.y)) { SFX.eat(); setTimeout(() => SFX.heal(), 90); }
    addFloater(p.x, p.y - 14, '+' + heal, '#8fe08a');
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

  // ------------------------------------------------------------ pathfinding
  // Grid A* over the tile map for everything that walks on its own: robots,
  // animals, bot slots and any future enemy. A tile is walkable when it is
  // in-world, not solid and not open water (players can enter a hole, but
  // nothing steers into one on purpose). Eight-connected with no corner
  // cutting - a diagonal step needs both orthogonal neighbours open, so a unit
  // of radius <= 5 walking tile centre to tile centre never clips a tree.
  // Deterministic: fixed neighbour order, stable heap, no rng.
  //
  //   findPath(sx, sy, gx, gy, reach, budget) -> [[x, y], ...] | null
  //     world-space waypoints (tile centres, start excluded), done when a tile
  //     within `reach` (Chebyshev) of the goal tile is reached - reach 1 lets a
  //     robot path to a tree it cannot stand on. A search that runs out of
  //     budget returns the route to the closest tile it saw (path.partial), so
  //     a far goal still gets a first leg; only an enclosed goal returns null.
  //   navTo(e, gx, gy, r, reach, dt)  -> { dx, dy, d, ok }
  //     the direction to move this frame along e.nav's route, replanning when
  //     the goal moves a tile, every NAV_REPLAN s, or when moveEntity reports a
  //     block. d is the straight-line distance to the goal (callers keep their
  //     own arrive radius). ok = false means the goal is unreachable or the
  //     unit has made no progress for NAV_STALL s (pinned by other units) -
  //     that is the signal to drop the target; there is no give-up timer.
  //   navStep(e, gx, gy, r, spd, dt, reach) -> navTo + moveEntity + mvx/mvy
  //     for the animal/robot movers (players move through their momentum).
  //   navClear(e) forgets the route; call it when a unit changes its mind.
  const NAV_BUDGET = 700;      // A* expansions per search (~a 25-tile detour)
  const NAV_REPLAN = 0.6;      // s between replans toward a goal that sits still
  const NAV_STALL = 1.6;       // s of no progress on a route before it counts as pinned
  const NAV_N = WORLD * WORLD;
  const navG = new Float32Array(NAV_N);
  const navParent = new Int32Array(NAV_N);
  const navSeen = new Uint32Array(NAV_N);   // generation stamp: node has a g
  const navDone = new Uint32Array(NAV_N);   // generation stamp: node is closed
  let navGen = 0;
  // binary heap keyed by f, parallel arrays, lazy deletion of stale entries
  const heapN = [], heapF = [];
  function heapPush(n, f) {
    let i = heapN.length; heapN.push(n); heapF.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapN[i] = heapN[p]; heapF[i] = heapF[p]; i = p;
    }
    heapN[i] = n; heapF[i] = f;
  }
  function heapPop() {
    const n = heapN[0], ln = heapN.pop(), lf = heapF.pop();
    if (heapN.length) {
      let i = 0;
      const len = heapN.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= len) break;
        if (c + 1 < len && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= lf) break;
        heapN[i] = heapN[c]; heapF[i] = heapF[c]; i = c;
      }
      heapN[i] = ln; heapF[i] = lf;
    }
    return n;
  }
  const NAV_DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const NAV_DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const NAV_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  function walkable(tx, ty) {
    return inWorld(tx, ty) && !isSolidTile(tx, ty) && ground[idx(tx, ty)] !== 2;
  }
  function navH(tx, ty, gx, gy) {
    const dx = Math.abs(tx - gx), dy = Math.abs(ty - gy);
    return dx > dy ? dx + dy * (Math.SQRT2 - 1) : dy + dx * (Math.SQRT2 - 1);
  }
  function findPath(sx, sy, gx, gy, reach, budget) {
    reach = reach || 0;
    budget = budget || NAV_BUDGET;
    let stx = Math.floor(sx / TILE), sty = Math.floor(sy / TILE);
    const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
    if (!inWorld(gtx, gty)) return null;
    if (!reach && !walkable(gtx, gty)) return null;
    // a unit shoved half into a wall starts from the nearest open tile instead
    if (!walkable(stx, sty)) {
      let found = false;
      for (let k = 0; k < 8 && !found; k++) {
        if (walkable(stx + NAV_DX[k], sty + NAV_DY[k])) { stx += NAV_DX[k]; sty += NAV_DY[k]; found = true; }
      }
      if (!found) return null;
    }
    navGen++;
    if (navGen === 0xffffffff) { navSeen.fill(0); navDone.fill(0); navGen = 1; }
    heapN.length = 0; heapF.length = 0;
    const s = idx(stx, sty);
    navG[s] = 0; navParent[s] = -1; navSeen[s] = navGen;
    heapPush(s, navH(stx, sty, gtx, gty));
    let best = s, bestH = navH(stx, sty, gtx, gty), expanded = 0, goal = -1;
    while (heapN.length) {
      const n = heapPop();
      if (navDone[n] === navGen) continue;
      navDone[n] = navGen;
      const tx = n % WORLD, ty = (n / WORLD) | 0;
      if (Math.max(Math.abs(tx - gtx), Math.abs(ty - gty)) <= reach) { goal = n; break; }
      const h = navH(tx, ty, gtx, gty);
      if (h < bestH) { bestH = h; best = n; }
      if (++expanded > budget) break;
      const g = navG[n];
      for (let k = 0; k < 8; k++) {
        const nx = tx + NAV_DX[k], ny = ty + NAV_DY[k];
        if (!walkable(nx, ny)) continue;
        if (k >= 4 && !(walkable(tx + NAV_DX[k], ty) && walkable(tx, ty + NAV_DY[k]))) continue;
        const m = idx(nx, ny);
        if (navDone[m] === navGen) continue;
        const ng = g + NAV_COST[k];
        if (navSeen[m] === navGen && navG[m] <= ng) continue;
        navG[m] = ng; navParent[m] = n; navSeen[m] = navGen;
        heapPush(m, ng + navH(nx, ny, gtx, gty));
      }
    }
    const end = goal >= 0 ? goal : best;
    if (end === s) return goal >= 0 ? [] : null;
    const path = [];
    for (let n = end; n !== s && n >= 0; n = navParent[n]) path.push([(n % WORLD) * TILE + 8, ((n / WORLD) | 0) * TILE + 8]);
    path.reverse();
    path.partial = goal < 0;
    return path;
  }

  // can a circle of radius r slide from (x0,y0) to (x1,y1) without touching a
  // wall or a hole? the same four-corner test moveEntity makes, every 4 px
  function navLineClear(x0, y0, x1, y1, r) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    const steps = Math.ceil(d / 4) || 1;
    for (let i = 1; i <= steps; i++) {
      const x = x0 + dx * i / steps, y = y0 + dy * i / steps;
      const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
      const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!walkable(tx, ty)) return false;
    }
    return true;
  }
  // string-pull: keep only the waypoints the unit cannot see past (bounded
  // look-ahead so a long route stays cheap)
  function navSmooth(path, x, y, r) {
    const out = [];
    let i = 0, fx = x, fy = y;
    while (i < path.length) {
      let j = i;
      for (let k = i + 1; k < path.length && k <= i + 10; k++) {
        if (navLineClear(fx, fy, path[k][0], path[k][1], r)) j = k;
      }
      out.push(path[j]);
      fx = path[j][0]; fy = path[j][1];
      i = j + 1;
    }
    out.partial = path.partial;
    return out;
  }

  function navClear(e) { if (e.nav) { e.nav.path = null; e.nav.fail = false; e.nav.stallT = 0; } }
  function navTo(e, gx, gy, r, reach, dt) {
    reach = reach || 0;
    const nav = e.nav || (e.nav = { path: null, i: 0, gtx: -1, gty: -1, replanT: 0, fail: false, stallT: 0, lx: 0, ly: 0, reach: 0 });
    const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
    nav.replanT -= dt;
    const moved = Math.abs(gtx - nav.gtx) + Math.abs(gty - nav.gty);
    const far = Math.hypot(gx - e.x, gy - e.y);
    // a goal that just proved unreachable is not searched again every frame
    if (!nav.path && nav.fail && nav.replanT > 0 && moved <= 1 && nav.reach === reach) return { dx: 0, dy: 0, d: far, ok: false };
    if (!nav.path || moved > 1 || nav.replanT <= 0 || nav.reach !== reach) {
      nav.gtx = gtx; nav.gty = gty; nav.reach = reach; nav.replanT = NAV_REPLAN; nav.i = 0;
      if (navLineClear(e.x, e.y, gx, gy, r)) {
        nav.path = [[gx, gy]];
      } else {
        const p = findPath(e.x, e.y, gx, gy, reach);
        nav.path = p ? navSmooth(p, e.x, e.y, r) : null;
        if (nav.path && !nav.path.length) nav.path = [[gx, gy]]; // already within reach
      }
      if (!nav.path) { nav.fail = true; return { dx: 0, dy: 0, d: far, ok: false }; }
      nav.fail = false;
      if (moved > 1) nav.stallT = 0;
    }
    // progress watch: a unit pinned by other units drifts nowhere; a route
    // that stalls this long is handed back as unreachable
    const prog = Math.hypot(e.x - nav.lx, e.y - nav.ly);
    nav.lx = e.x; nav.ly = e.y;
    nav.stallT = prog > 6 * dt ? 0 : nav.stallT + dt;
    if (nav.stallT > NAV_STALL) { nav.stallT = 0; nav.path = null; nav.fail = true; nav.replanT = 0; return { dx: 0, dy: 0, d: far, ok: false }; }
    const path = nav.path;
    while (nav.i < path.length - 1 && Math.hypot(path[nav.i][0] - e.x, path[nav.i][1] - e.y) < 5) nav.i++;
    const wp = path[nav.i];
    const dx = wp[0] - e.x, dy = wp[1] - e.y;
    const wd = Math.hypot(dx, dy) || 1;
    return { dx: dx / wd, dy: dy / wd, d: far, ok: true };
  }
  // walk an animal/robot one step along its route; a wall hit on a route
  // older than a moment replans at once (a fresh one is left to the stall watch)
  function navStep(e, gx, gy, r, spd, dt, reach) {
    const n = navTo(e, gx, gy, r, reach, dt);
    if (!n.ok) return n;
    e.mvx = n.dx; e.mvy = n.dy;
    const mv = moveEntity(e, (n.dx * spd + e.kbx) * dt, (n.dy * spd + e.kby) * dt, r);
    if ((mv.blockedX || mv.blockedY) && e.nav.replanT < NAV_REPLAN - 0.2) e.nav.replanT = 0;
    return n;
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
      // a building (any tile of its footprint - `part` resolves to the anchor) is a
      // target only for the other team; you take your own down from the wheel instead
      const st = structOf(o);
      if (STRUCTS[st.type]) { if (!ownsStruct(st, p)) t = TOOL_AXE; }
      else if (o.type === 'tree' || o.type === 'deadTree') t = TOOL_AXE;
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
    const wx = mouseWX(), wy = mouseWY();
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
    if (p.prone) { risePlayer(p); return; } // no swinging an axe on your belly: E stands you up
    const t = workTarget(p);
    if (!t || !t.near) return;
    if (p.charging) { p.charging = false; p.chargeT = 0; } // work drops the draw
    p.fireArmed = false;                                     // ...and the held button has to be pressed again
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
    risePlayer(p); // a roll is the fast way out of the snow, and it costs a charge
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
    const regenP = p.dodgeCharges < DODGE_CHARGES ? 1 - p.dodgeRegenT / kitOf(p).dodgeCd : 0;
    p.stamGhost = Math.max(p.stamGhost, (p.dodgeCharges + regenP) / DODGE_CHARGES);
    p.stamGhostT = 0.3;
    p.dodgeCharges--;
    if (p.dodgeRegenT <= 0) p.dodgeRegenT = kitOf(p).dodgeCd; // DANCER shortens the refill
    p.invuln = Math.max(p.invuln, DODGE_T + 0.05);
    p.kbx = p.kby = 0;
    if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
    else if (dy !== 0) p.dir = dy > 0 ? 'down' : 'up';
    burst(p.x, p.y + 4, '#dfe8f4', 6, 40, 0.35, true);
    if (nearPlayer(p.x, p.y)) SFX.dodge();
  }

  // ---- prone ---------------------------------------------------------------
  // Ctrl: go to ground, or get back up. Dropping needs both feet still and snow
  // underfoot - you cannot dive at speed, and a river has nothing to dig into.
  // Everything else about the state is one number, `p.hide`, which updatePlayer
  // ramps and every watcher reads back through seenAt().
  function tryProne(p) {
    if (p.dead || p.fallT > 0 || inAir(p)) return;
    if (p.prone) { risePlayer(p); return; }
    const tx = Math.floor(p.x / TILE), ty = Math.floor((p.y + 4) / TILE);
    if (p.dodgeT > 0 || p.sliding || Math.hypot(p.vx, p.vy) > PRONE_ENTER ||
      !inWorld(tx, ty) || ground[idx(tx, ty)] !== 0) {
      if (p === player) SFX.deny();
      return;
    }
    p.prone = true;
    p.hide = 0; p.riseT = 0; p.crawlT = 0; p.puffT = rand(0.7, 1.5);
    p.vx = p.vy = 0;
    p.sliding = false; p.slideT = 0;
    burst(p.x, p.y + 4, '#eef4fb', 7, 34, 0.4, true);
    if (nearPlayer(p.x, p.y)) SFX.bury();
  }

  // Back on your feet, whatever put you there - the ambush shot, a hit, an E
  // swing, a roll, or Ctrl again. The cover goes with the body and is not
  // allowed to linger: a slot that is visibly standing must be visibly findable,
  // so `hide` is zeroed here and the snow it stood for is spent as particles.
  function risePlayer(p) {
    if (!p.prone) return;
    const h = p.hide;
    p.prone = false;
    p.hide = 0;
    p.riseT = PRONE_RISE;
    if (h > 0.2) {
      burst(p.x, p.y + 2, '#eef4fb', 4 + Math.round(h * 7), 44, 0.45, true);
      if (nearPlayer(p.x, p.y)) SFX.rise();
    }
  }

  // ---- the quiver ---------------------------------------------------------
  // Three ways an arrow moves: out of the quiver when a shot is loosed, into
  // the snow where that shot ended (stickArrow), and back into a quiver when
  // anyone walks over it. Fletching is the slow floor under all of it, so a
  // player who never retrieves anything is throttled rather than disarmed.
  function gainArrow(p, n) {
    if (p.quiver >= QUIVER_MAX) return false;
    p.quiver = Math.min(QUIVER_MAX, p.quiver + (n || 1));
    p.quiverFlash = 0.35;
    return true;
  }
  // a spent arrow, left where its flight ended. Open water swallows it; a
  // solid tile keeps it on the near side so it never sits inside a wall.
  function stickArrow(a, nx, ny) {
    const x = a.x - nx * 3, y = a.y - ny * 3;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!inWorld(tx, ty)) return;
    if (ground[idx(tx, ty)] === 2) { // straight into the water: gone
      burst(x, y, '#9fc4dd', 4, 30, 0.35, true);
      if (nearPlayer(x, y)) SFX.splash();
      return;
    }
    shafts.push({ x, y, nx, ny, team: a.team, t: 0 });
    while (shafts.length > SHAFT_MAX) shafts.shift();
  }
  // pressing the bow on an empty quiver: the tell, rate-limited to the press
  function dryFire(p) {
    p.dryT = 0.45;
    burst(p.x, p.y - BOW_Y, '#8a97bd', 3, 22, 0.3, true);
    if (p === player) SFX.dryFire();
  }

  function fireArrow(p) {
    // read the cover before anything below can break it: this is the one shot
    // that pays for the walk in at a crawl
    const amb = ambushReady(p);
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
        // the shaft is speared through the ice, not loosed: it costs no arrow,
        // but it is the same hand motion, so the bow still has to be renocked
        p.nockT = kitOf(p).nock;
        return;
      }
    }
    const kit = kitOf(p);
    // the arrow leaves the quiver here, and the bow cannot be drawn again until
    // the next one is nocked - the one gate every shot goes through
    p.quiver = Math.max(0, p.quiver - 1);
    p.nockT = kit.nock;
    const pw = Math.min(1, Math.max(0.18, p.chargeT / kit.bowCharge));
    // momentum shot: a kit with spdDmg pays extra for speed at the moment of release
    const spdBonus = kit.spdDmg * Math.min(1, Math.hypot(p.vx, p.vy) / 200);
    // aim from the spawn point (BOW_Y above the feet), not the feet: otherwise the
    // flight runs parallel to the aim line, a few px above it, and never meets it
    const dx = p.input.aimX - p.x;
    const dy = p.input.aimY - (p.y - BOW_Y);
    const d = Math.hypot(dx, dy) || 1;
    const spd = 170 + 190 * pw;
    let dmg = Math.round(kit.dmgBase + kit.dmgPow * pw + spdBonus) + LVL_DMG * (p.level - 1);
    if (amb) dmg = Math.round(dmg * AMBUSH_MUL);
    arrows.push({
      x: p.x, y: p.y - BOW_Y,
      vx: dx / d * spd, vy: dy / d * spd,
      t: 0, life: 0.85, dmg, pow: pw,
      owner: p.id, team: p.team, // whose shot it is - it never hits its own side
      ambush: amb,               // loosed out of full cover: hits for AMBUSH_MUL and lands loud
      trailD: 0,                 // px of flight banked toward the next trail mote (see updatePlay)
    });
    if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
    else p.dir = dy > 0 ? 'down' : 'up';
    if (nearPlayer(p.x, p.y)) SFX.arrow();
    // the loose is what breaks cover - one ambush per burrow, then you are a
    // player lying in the open with a bow that still has to be renocked
    risePlayer(p);
  }

  // the swing lands on the tile tryWork() locked, whatever is there by now
  // (a robot may have felled the tree mid-swing: then it's just air). Two
  // players can land on the same tile in one step - only one swing counts.
  function swingHit(p) {
    const tx = p.workTx, ty = p.workTy;
    if (!inWorld(tx, ty)) return;
    contest('work:' + idx(tx, ty), p, () => {
      const o = objects[idx(tx, ty)];
      if (o) {
        const st = structOf(o); // a `part` tile hits the building it belongs to
        if (STRUCTS[st.type]) { if (!ownsStruct(st, p)) hitObject(st, p); }
        else if (o.type !== 'stump') hitObject(o, p);
      } else if (ground[idx(tx, ty)] === 1) crackIce(tx, ty, p);
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
        spawnDrop(ox, oy, 'gold', YIELD.treeFall + kitOf(p).harvest); // PACKMULE fattens the fell
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
        spawnDrop(ox, oy, 'gold', YIELD.deadTreeFall + kitOf(p).harvest);
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
        spawnDrop(ox, oy, 'gold', YIELD.rockBreak / 2); spawnDrop(ox, oy, 'gold', YIELD.rockBreak / 2 + kitOf(p).harvest);
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
      // reached from swingHit only for a building on ANOTHER team
      const c = structCenter(o);
      o.hp -= STRUCT_HIT_DMG;
      if (near) SFX.hit();
      burst(c.x, c.y - 4, '#a3794f', 5, 40, 0.4, true);
      addDmgFloater(c.x, c.y - 12, STRUCT_HIT_DMG);
      if (p === player) state.shake = Math.max(state.shake, 1);
      if (o.hp <= 0) {
        // the wreck pays out like a demolition: whoever is nearest picks the rubble up
        destroyStructure(o, true);
        logEvent(p.name + ' WRECKED A ' + STRUCTS[o.type].name, p);
      }
    }
  }

  function destroyStructure(o, refund) {
    if (STRUCTS[o.type]) removeStruct(o);
    else objects[idx(o.tx, o.ty)] = null;
    const c = structCenter(o), ox = c.x, oy = c.y;
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
    const big = structW(type) > 1 || structH(type) > 1;
    // all four buildings are solid - never let a player entomb themselves
    // (findSite does the same check over a big footprint)
    if (!big && Math.abs(cxp - p.x) < 8 + PLAYER_R && Math.abs(cyp - p.y) < 8 + PLAYER_R) {
      deny('STEP OFF THE STUMP FIRST', 1.6);
      return;
    }
    const t0 = STRUCTS[type].tiers[0];
    if (!canAfford(t0.cost, p)) { deny('NOT ENOUGH RESOURCES', 1.6); return; }
    let anchor = { tx, ty };
    if (big) {
      anchor = findSite(type, tx, ty);
      if (!anchor) { deny('NO ROOM - NEEDS 3X2 CLEAR SNOW', 1.8); return; }
    }
    contest('site:' + idx(tx, ty), p, () => {
      const s = objAt(tx, ty);
      if (!s || s.type !== 'stump' || !canAfford(t0.cost, p)) return;
      if (big) { anchor = findSite(type, tx, ty); if (!anchor) return; }
      pay(t0.cost, p);
      createStruct(anchor.tx, anchor.ty, type, 0, p, true);
      if (nearPlayer(cxp, cyp)) SFX.place();
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
    if (type === 'spawner') { o.mode = 'gather'; o.bots = []; o.respawnT = o.respawnTotal = 1; o.door = 1; }
    o.sparkT = 0;
    structures.push(o);
    return o;
  }

  // only the owning side may upgrade or demolish
  function ownsStruct(o, p) { return o.team === undefined || o.team === p.team; }

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
    if (nearPlayer(o.tx * TILE + 8, o.ty * TILE + 8)) SFX.place();
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
      animT: rng() * 2, flash: 0, kbx: 0, kby: 0,
      fleeT: 0, fleeGoal: null, nav: null,  // prey: its flight; any walker: its route (see pathfinding)
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

  // where a frightened animal runs next: ~6 tiles off, as straight away from
  // the threat as the ground allows (fanning out, then sideways, then past it),
  // the first open tile it can actually route to
  function fleeGoal(a, from) {
    const base = Math.atan2(a.y - from.y, a.x - from.x) + rand(-0.4, 0.4);
    const dist = 6 * TILE;
    for (const k of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6, Math.PI]) {
      const gx = a.x + Math.cos(base + k) * dist, gy = a.y + Math.sin(base + k) * dist;
      const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
      if (!walkable(tx, ty)) continue;
      const x = tx * TILE + 8, y = ty * TILE + 8;
      if (navLineClear(a.x, a.y, x, y, 5) || findPath(a.x, a.y, x, y, 0, 250)) return { x, y };
    }
    return null;
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
      // the flight is a chain of routed legs a few tiles long, each picked
      // away from the threat; a leg that fails or arrives hands over to the next
      if (!a.fleeGoal) a.fleeGoal = fleeGoal(a, from);
      if (a.fleeGoal) {
        const n = navStep(a, a.fleeGoal.x, a.fleeGoal.y, r, rabbit ? 80 : 92, dt);
        if (!n.ok || n.d < 6) a.fleeGoal = null;
        moving = true;
      } else {
        a.fleeT = 0; // cornered: nowhere to run
      }
      if (a.fleeT <= 0) { a.fleeGoal = null; navClear(a); a.idleT = rand(0.4, 1); a.moveT = 0; }
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

  // what a kill pays: one profile per kind, all of it out of the YIELD table.
  // A HUNTSMAN's kill (a.lastHit, stamped by the arrow loop) drops one extra
  // coin worth the bonus - the drop is neutral like the rest, but the hunter
  // is the one standing over it.
  function animalDies(a) {
    a.dead = true;
    if (nearPlayer(a.x, a.y)) SFX.monsterDie();
    const hunter = a.lastHit !== undefined ? players[a.lastHit] : null;
    const y = YIELD[a.kind];
    if (hunter && !hunter.dead && y && y.coins) {
      const bonus = Math.ceil(y.coins * y.each * (kitOf(hunter).huntMul - 1));
      if (bonus > 0) spawnDrop(a.x, a.y, 'gold', bonus);
    }
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
    if (t && (!t.active || t.dead || inAir(t) || !leashed(t))) { t = null; navClear(a); }
    if (!t) {
      const sight = WOLF_SIGHT * (1 + state.darkness * 0.75); // night gives the pack its teeth
      let bd = sight;
      for (const p of players) {
        if (!p.active || p.dead || inAir(p) || !leashed(p)) continue;
        const d = Math.hypot(p.x - a.x, p.y - a.y);
        // GHOSTSTEP - and lying buried in the snow - shorten how far this
        // particular quarry is noticed from
        if (d < bd && d < seenAt(p, sight)) { bd = d; t = p; }
      }
      if (t) wakePack(a, t);
    }
    a.target = t;

    let moving = false;
    if (t) {
      // run the route to the quarry; with no route (it is out over water, or
      // the pack has it pinned) hold and face it
      const n = navStep(a, t.x, t.y, 4.5, WOLF_SPD, dt);
      const d = n.d || 1;
      if (!n.ok) { a.mvx = (t.x - a.x) / d; a.mvy = (t.y - a.y) / d; }
      moving = n.ok;
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
          if (nearPlayer(ox, oy)) { SFX.place(); state.shake = Math.max(state.shake, big ? 2.5 : 1.5); }
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
          }
        }
        // the shutter: open to gather, shut on guard, and always open for a roll-out
        const want = (o.mode === 'gather' || (due && o.respawnT < 1.4)) ? 1 : 0;
        o.door += Math.sign(want - o.door) * Math.min(Math.abs(want - o.door), dt * 2.2);
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
      carry: 0, // gold held, deposited at home
      moveT: 0, idleT: rand(0.3, 1), mvx: 0, mvy: 0, moving: false,
      animT: rng() * 2, flash: 0, kbx: 0, kby: 0, dead: false,
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

    if (home.mode === 'guard') {
      // no raiders to fight: guard mode just loiters near home
      b.tgt = null;
      if (carryTotal > 0) {
        const d = walkToward(hx, hy);
        if (d >= 0 && d < 14) deposit();
      } else {
        wander();
      }
    } else if (carryTotal >= 8) {
      const d = walkToward(hx, hy);
      if (d >= 0 && d < 14) deposit();
    } else {
      if (b.tgt && objects[idx(b.tgt.tx, b.tgt.ty)] !== b.tgt) b.tgt = null;
      if (b.avoidT > 0) b.avoidT -= dt; else b.avoid = null;
      if (!b.tgt) {
        b.tgt = nearestObj(hx, hy, 8, (o) =>
          (o.type === 'tree' || o.type === 'rock') && o !== b.avoid);
      }
      if (b.tgt) {
        const txp = b.tgt.tx * TILE + 8, typ = b.tgt.ty * TILE + 8;
        const d = Math.hypot(txp - b.x, typ - b.y);
        if (d > 20) {
          // no route to it (walled in, or pinned on the way): leave it alone a while
          if (walkToward(txp, typ, 1) < 0) { b.avoid = b.tgt; b.avoidT = 12; b.tgt = null; }
        } else {
          b.workT += dt;
          if (b.workT >= 0.9) { b.workT = 0; harvest(); }
        }
      } else if (carryTotal > 0) {
        const d = walkToward(hx, hy);
        if (d >= 0 && d < 14) deposit();
      } else {
        wander();
      }
    }

    b.animT += dt * (moving ? 8 : 0);
    b.moving = moving;
    b.x = Math.max(8, Math.min(WORLD * TILE - 8, b.x));
    b.y = Math.max(8, Math.min(WORLD * TILE - 8, b.y));

    if (b.hp <= 0 && !b.dead) robotDies(b, null);
  }

  // ------------------------------------------------------------ radial wheel
  // One geometry, any number of options: n wedges of exactly 2*PI/n, the first
  // centred straight up and the rest clockwise. Nothing is special-cased per
  // count - 4 options land on up/right/down/left and 2 on up/down because that
  // is what the formula gives. WHEEL_HUB is the hole in the middle and the
  // cancel target both: the pointer starts inside it, and nothing is chosen
  // until it leaves.
  const WHEEL_HUB = 13;   // inner radius = the deadzone that cancels
  const WHEEL_R = 40;     // outer radius of the wedges
  const WHEEL_PAD = 4;    // backing disc beyond the wedges
  const WHEEL_RING = (WHEEL_HUB + WHEEL_R) >> 1; // icons and labels: the same distance every direction
  const WHEEL_GAP = 2;    // px of daylight between neighbouring wedges, measured at the rim
  // The pointer is measured from the press point (w.ax/ay), not from the wheel's
  // drawn hub: that press is what the hand remembers, and the hub drifts as the
  // camera follows the player. drawWheelStick() draws that travel 1:1 from the
  // hub, so the knob is visibly inside the wedge it has picked.

  function wheelOptions() {
    const w = state.wheel;
    if (w.kind === 'build') return STRUCT_ORDER.map((type) => ({ id: type }));
    const o = structOf(objAt(w.tx, w.ty));
    // upgrade is always the wedge straight up and demolish always the last one,
    // so the bay's extra option lands between them instead of displacing either
    const opts = [{ id: 'upgrade' }];
    if (o && o.type === 'spawner') opts.push({ id: 'mode' });
    opts.push({ id: 'demolish' });
    return opts;
  }

  // The whole geometry, in two lines: every wedge is span wide, and wedge i is
  // centred on wheelAng(i). The hover test, the wedge pixels and the icon ring
  // all read them, so a wedge is exactly its own hitbox at any count.
  function wheelSpan(n) { return Math.PI * 2 / n; }
  function wheelAng(i, n) { return -Math.PI / 2 + i * wheelSpan(n); }

  // shared by resolveWheel and renderWheel so hover math and pixels agree
  function wheelLayout() {
    const w = state.wheel;
    const edge = WHEEL_R + WHEEL_PAD;
    // the wheel is UI, not world: it sits over its tile but keeps its own pixel
    // size at every zoom, so the anchor comes through wToS and the radii don't
    let cx = Math.round(wToSX(w.tx * TILE + 8));
    let cy = Math.round(wToSY(w.ty * TILE + 8));
    cx = Math.max(edge + 2, Math.min(VIEW_W - edge - 2, cx));
    cy = Math.max(edge + 2, Math.min(VIEW_H - edge - 14, cy)); // bottom margin fits the label
    const opts = wheelOptions();
    const n = opts.length, span = wheelSpan(n);
    for (let i = 0; i < n; i++) opts[i].ang = wheelAng(i, n);
    // travel since the press, not distance from the hub
    const dx = mouse.x - w.ax, dy = mouse.y - w.ay;
    const dist = Math.hypot(dx, dy);
    let seg = -1;
    if (dist >= WHEEL_HUB) { // still in the hub = nothing chosen, releasing cancels
      // which wedge the travel points into - the same floor the wedges are drawn
      // from, so the hit region and the pixels cannot disagree
      let a = Math.atan2(dy, dx) - wheelAng(0, n) + span / 2;
      a -= Math.floor(a / (Math.PI * 2)) * Math.PI * 2;
      seg = Math.floor(a / span) % n;
    }
    return { cx, cy, opts, n, span, seg, dx, dy, dist };
  }

  // the wheel writes a one-shot order into the local player's input; the sim
  // performs it next step, so a build races other players' orders fairly
  function resolveWheel() {
    const w = state.wheel;
    const L = wheelLayout();
    if (L.seg < 0) return; // released in the hub = cancel
    player.input.cmd = { kind: w.kind === 'build' ? 'build' : L.opts[L.seg].id, tx: w.tx, ty: w.ty, id: L.opts[L.seg].id };
  }

  // run a queued build/manage/gear order for any player
  function runCmd(p, c) {
    if (c.kind === 'gear') { buyGear(p, c.piece); return; } // no tile, no reach - gear is bought from anywhere
    if (c.kind === 'build') { placeStruct(c.tx, c.ty, c.id, p); return; }
    const o = structOf(objAt(c.tx, c.ty));
    if (!o || !STRUCTS[o.type] || o.building || !ownsStruct(o, p)) return;
    if (Math.hypot(c.tx * TILE + 8 - p.x, c.ty * TILE + 8 - p.y) > 60) return;
    if (c.kind === 'upgrade') startUpgrade(o, p);
    else if (c.kind === 'demolish') demolishStruct(o, p);
    else if (c.kind === 'mode') {
      o.mode = o.mode === 'gather' ? 'guard' : 'gather';
      const c0 = structCenter(o);
      addFloater(c0.x, o.ty * TILE - 4, o.mode.toUpperCase(), '#ffd95c');
      if (nearPlayer(c0.x, c0.y)) SFX.pickup();
    }
  }

  // src: the player who dealt it (kill credit + the log line), null for the
  // world; cause: a DEATH_CAUSE key naming what the world did, when src is null
  function damagePlayer(p, dmg, dx, dy, src, cause, crit) {
    if (p.dead || p.invuln > 0) return;
    dmg = Math.max(1, dmg - kitOf(p).dr); // IRONHIDE flattens every hit, but never to zero
    p.hp -= dmg;
    p.hurtT = 0.25;
    p.invuln = 0.7;
    p.kbx = dx * 110; p.kby = dy * 110;
    risePlayer(p); // nobody stays buried through a hit: the cover is blown with the body
    if (p === player) state.shake = Math.max(state.shake, crit ? 6 : 3);
    addDmgFloater(p.x, p.y - 18, dmg, p === player, crit);
    if (nearPlayer(p.x, p.y)) SFX.hurt();
    burst(p.x, p.y - 6, '#e04a54', 8, 50, 0.45);
    if (p.hp <= 0) die(p, src, cause);
  }

  // what the log says when nobody gets the credit
  const DEATH_CAUSE = { ice: 'FELL THROUGH THE ICE', wolf: 'WENT TO THE WOLVES' };

  // Death empties the wallet. Gold goes to the credited killer outright
  // (through gainGold, so a kill also levels the killer - the bounty is the
  // point of taking the fight); with no killer to pay, it spills as coins at
  // the corpse instead. Everything else in the wallet - food today, any
  // future resource key - always spills as pickups, split like a downed
  // worker's carry. Lifetime xp is untouched, and the standings rank on xp
  // (scoreOf), so a looted slot keeps the place it earned.
  function spillInventory(p, killer) {
    for (const k in p.inv) {
      const n = p.inv[k];
      p.inv[k] = 0;
      if (n <= 0) continue;
      if (k === 'gold' && killer && !killer.dead) {
        gainGold(killer, n);
        addFloater(killer.x, killer.y - 14, '+' + n, RES_COLORS.gold);
        if (killer === player) SFX.pickup();
        continue;
      }
      const parts = Math.min(k === 'gold' ? 5 : 3, n);
      const base = Math.floor(n / parts), rem = n % parts;
      for (let i = 0; i < parts; i++) spawnDrop(p.x, p.y - 4, k, base + (i < rem ? 1 : 0));
    }
  }

  // any slot can go down, and going down is final - the slot is out of the
  // match. Only the local one takes the screen with it (the death overlay).
  function die(p, src, cause) {
    p.dead = true;
    p.charging = false;
    p.chargeT = 0;
    p.fireArmed = false;
    p.dodgeT = 0;
    p.vx = p.vy = 0;
    p.sliding = false;
    p.prone = false; p.hide = 0; p.riseT = 0;
    p.fallT = 0;
    p.swingT = p.swingCd = 0;
    burst(p.x, p.y - 6, TEAMS[p.team].mark, 12, 55, 0.6);
    // kill credit and the feed line: the killer's colours if there is one,
    // otherwise the victim's, since the victim is who the line is about
    const killer = src && src !== p ? src : null;
    spillInventory(p, killer);
    // the quiver spills where the body fell, same as the wallet: whatever was
    // still in it sticks in the snow for whoever cleans up the fight
    const left = p.quiver; p.quiver = 0;
    for (let i = 0; i < left; i++) {
      const a = rng() * Math.PI * 2, r = rand(4, 14);
      stickArrow({ x: p.x + Math.cos(a) * r, y: p.y - 2 + Math.sin(a) * r, team: p.team },
        Math.cos(a), Math.sin(a));
    }
    if (killer) killer.kills++;
    logEvent(killer ? killer.name + ' SHOT ' + p.name
      : p.name + ' ' + (DEATH_CAUSE[cause] || 'WENT DOWN'), killer || p);
    if (p === player) endMatch('lost');
    else {
      addFloater(p.x, p.y - 20, p.name + ' OUT', TEAMS[p.team].mark);
      if (state.spec === p.id) specNext(1); // the slot being watched went down: follow another
    }
    checkLastStanding();
  }

  // slots still in the match (riding the eagle counts: it is about to land)
  function aliveCount() { let n = 0; for (const p of players) if (p.active && !p.dead) n++; return n; }

  // slots on the other side of p, by the same rule enemyOf() states, minus its
  // inAir() skip - a rival still on the eagle has not lost, it is about to land.
  // all = every rival the match ever fielded, the dead ones included.
  function rivalCount(p, all) {
    let n = 0;
    for (const q of players) if (q !== p && q.active && (all || !q.dead) && (!PVP || q.team !== p.team)) n++;
    return n;
  }

  // the local slot alive and every RIVAL gone: the match is won (only once, and
  // only when there was another side to beat). Teams win together - a living
  // teammate is not something left to beat - so this is the last TEAM standing,
  // not the last player.
  function checkLastStanding() {
    if (state.over || player.dead || rivalCount(player, false) > 0) return;
    if (!rivalCount(player, true)) return;
    endMatch('won');
  }

  // the local slot leaves the match, one way or the other: the overlay takes
  // the screen (mode 'dead'), the sim runs on underneath it
  function endMatch(how) {
    state.over = how;
    state.mode = 'dead';
    state.deadView = 'menu';
    state.deadSel = 0;
    state.deadHover = [0, 0];
    state.mapOpen = false;
    state.settingsOpen = false;
    state.wheel = null;
    state.deadTimer = 0;
    // a win freezes its numbers here, not in the render pass: the match runs on
    // underneath (a generator can still pay out) and a total that climbs behind
    // a tally which already counted it reads as a bug
    state.win = how === 'won' ? winSnapshot() : null;
    if (state.win) { SFX.victory(); state.shake = Math.max(state.shake, 4); }
    player.input = makeInput(); // whatever was held dies with the slot
  }

  // ------------------------------------------------------------ ai
  // Bot slots. A bot only ever writes the same input struct a human fills in -
  // movement axis, aim point, fire / work / slide / dodge and the odd build
  // order - so it can never do anything a player couldn't. The brain is a small
  // priority ladder, re-picked a few times a second: eat, fight, wolves, hunt,
  // loot, spend, harvest, roam. Every walk goes through steerTo(), which routes
  // around obstacles (see pathfinding) and reports an unreachable goal as -1 -
  // that, not a timer, is what makes a bot drop a target.
  const AI_SIGHT = 150;   // px: how far a bot notices a rival
  const AI_HUNT = 120;    // px: how far it will go after an animal
  const AI_FORAGE = 12;   // tiles: how far from itself it looks for work

  function aiNearestEnemy(p) {
    let best = null, bd = AI_SIGHT;
    for (const q of players) {
      if (!enemyOf(p, q)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      // seenAt is per-quarry, not per-bot: a rival buried in the snow (or wearing
      // GHOSTSTEP, which until now did nothing at all against a player) is picked
      // up from much closer, and one lying still is not picked up until it is
      // practically underfoot
      if (d < bd && d < seenAt(q, AI_SIGHT)) { bd = d; best = q; }
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
      // birds fly: no route on the ground catches a flushed flock
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

  // open tiles around a target: work needs at least one to stand on (the
  // route finds the way to it), and a build site wants room around it
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

    // walk the route to (x, y) - reach 1 stops beside a tile it cannot stand
    // on, which is exactly WORK_REACH - and return the straight-line distance,
    // or -1 when there is no route (drop the goal, do not wait on it)
    const steerTo = (x, y, reach) => {
      const n = navTo(p, x, y, PLAYER_R, reach || 0, dt);
      if (!n.ok) return -1;
      inp.mx = n.dx; inp.my = n.dy;
      return n.d;
    };
    const aimAt = (x, y) => { inp.aimX = x; inp.aimY = y; };

    ai.thinkT -= dt;
    if (ai.buildT > 0) ai.buildT -= dt;
    if (ai.hideCd > 0) ai.hideCd -= dt;

    // 1. food, exactly as a human eats it (Q / F)
    if (p.hp < p.maxHp * 0.5 && p.inv.fish > 0) inp.eatFish = true;
    else if (p.hp < p.maxHp * 0.8 && p.inv.berry > 0) inp.eatBerry = true;

    // 2. the burrow. Decided before the ladder because two rungs below read the
    //    answer: a bot that has come off worse and has nobody looking at it goes
    //    to ground and waits the fight out, and one that is already down shoots
    //    from where it lies - which earns it the same ambush multiplier a human
    //    gets, off the same ambushReady() check. It gets straight back up for a
    //    wolf, for a rival close enough to find it anyway, or when the spell
    //    runs out. It only ever tries where a player could: on snow, on its own
    //    feet, which is also what keeps it from planting itself on a river and
    //    standing there. `hideT` doubles as the give-up: a plant that will not
    //    take burns it four times as fast and ends in the lockout.
    const foe = aiNearestEnemy(p);
    const wolf = foe ? null : aiNearestWolf(p);
    if (p.prone) ai.hideT -= dt;
    const btx = Math.floor(p.x / TILE), bty = Math.floor((p.y + 4) / TILE);
    const canBury = !p.sliding && p.dodgeT <= 0 && inWorld(btx, bty) && ground[idx(btx, bty)] === 0;
    let down = p.prone;
    if (wolf) down = false;
    else if (foe) down = p.prone && Math.hypot(foe.x - p.x, foe.y - p.y) > 48;
    else if (p.prone) down = ai.hideT > 0 && p.hp < p.maxHp * 0.9;
    else if (p.hp < p.maxHp * 0.4 && ai.hideCd <= 0 && canBury) down = true;
    if (down !== p.prone) {
      inp.prone = true;                                 // the edge-triggered flag Ctrl sets
      if (p.prone) ai.hideCd = 18;                      // back up: no re-burrowing for a while
      else if (ai.hideT <= 0) ai.hideT = rand(7, 12);   // going down: how long it means to stay
    }
    if (down && !p.prone) {
      // stop dead and let the momentum bleed off; tryProne refuses a body that
      // is still moving. Somewhere that never takes gives up and locks out.
      ai.hideT -= dt * 4;
      if (ai.hideT > 0) { inp.fire = false; return; }
      ai.hideCd = 12;
    }

    // 3. a rival in sight: circle at bow range and shoot
    if (foe) {
      const d = Math.hypot(foe.x - p.x, foe.y - p.y);
      aimAt(foe.x, foe.y - 6);
      // hold ~70px: close in when far, back off when crowded, strafe in between
      const clear = aiLineClear(p, foe.x, foe.y - 6);
      if (p.prone) {
        // no strafing on your belly: concealOf discounts a mound that is moving,
        // and ambushReady refuses a moving shot outright. Hold still, let them
        // walk in, and spend the arrow at full draw.
        inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.95;
        ai.tgt = null;
        return;
      }
      const side = p.id % 2 ? 1 : -1;
      const a = Math.atan2(foe.y - p.y, foe.x - p.x);
      const turn = !clear || d > 85 ? 0.3 * side : d < 50 ? Math.PI * 0.85 * side : Math.PI / 2 * side;
      inp.mx = Math.cos(a + turn); inp.my = Math.sin(a + turn);
      inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.95; // draw, then loose near full
      if (p.hp < p.maxHp * 0.45 && p.dodgeCharges > 0 && rng() < dt * 2) inp.dodge = true;
      ai.tgt = null;
      return;
    }

    // 4. wolves hunt back: a bot that wanders into a den has to fight its way
    //    out, so it shoots the nearest one and gives ground while it does
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

    // 5. lying low with nothing in sight: hold still and let the snow finish.
    //    Everything below this rung walks somewhere, and a bot crawling to a
    //    berry bush at PRONE_SPEED is a bot that has stopped playing.
    if (p.prone) { inp.fire = false; return; }

    // 6. meat is gold: chase and shoot the nearest animal, but give up on one
    //    it cannot catch in 6 s (prey outruns a walk) or cannot route to at all
    if (ai.huntAvoidT > 0) { ai.huntAvoidT -= dt; if (ai.huntAvoidT <= 0) ai.huntAvoid = null; }
    const prey = aiNearestAnimal(p);
    if (prey) {
      if (prey !== ai.huntTgt) { ai.huntTgt = prey; ai.huntT = 0; }
      ai.huntT += dt;
      const clear = aiLineClear(p, prey.x, prey.y - 3);
      const d = Math.hypot(prey.x - p.x, prey.y - p.y);
      const lost = ai.huntT > 6 || ((d > 55 || !clear) && steerTo(prey.x, prey.y) < 0);
      if (lost) {
        ai.huntAvoid = prey; ai.huntAvoidT = 15;
        ai.huntTgt = null; ai.huntT = 0;
      } else {
        aimAt(prey.x, prey.y - 3);
        inp.fire = clear && p.chargeT < kitOf(p).bowCharge * 0.8;
        ai.tgt = null;
        return;
      }
    }
    inp.fire = false;

    // 7. loot on the ground is neutral and first-come: pick up what is close.
    //    A bot short of arrows counts spent shafts as loot too, so the fields a
    //    firefight leaves behind get picked clean instead of lying there.
    let loot = null, ld = 72;
    for (const d of drops) {
      if (d.t < 0.35) continue;
      const dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd < ld) { ld = dd; loot = d; }
    }
    if (p.quiver <= QUIVER_MAX / 2) for (const s of shafts) {
      if (s.t < SHAFT_ARM) continue;
      const dd = Math.hypot(s.x - p.x, s.y - p.y);
      if (dd < ld) { ld = dd; loot = s; }
    }
    if (loot && ai.lootT < 4) {
      ai.lootT += dt; aimAt(loot.x, loot.y);
      if (steerTo(loot.x, loot.y) < 0) ai.lootT = 4; // no way to it: let it lie
      return;
    }
    if (!loot) ai.lootT = 0;

    // 8. spend the purse: gear first when the purse is fat enough to keep a
    //    building float (buyGear re-validates, so a stale order is harmless),
    //    then a stump to build on, then its own work to upgrade
    if (!inp.cmd) {
      let gi = -1, gc = 1e9;
      for (let i = 0; i < GEAR_SLOTS.length; i++) {
        const c = gearCost(p, i);
        if (c && c.gold < gc) { gc = c.gold; gi = i; }
      }
      if (gi >= 0 && p.inv.gold >= gc + 15) inp.cmd = { kind: 'gear', piece: gi };
    }
    if (ai.buildT <= 0 && p.inv.gold >= STRUCTS.generator.tiers[0].cost.gold) {
      const st = nearestObj(p.x, p.y, 5, (o) => o.type === 'stump' && aiOpenSides(o.tx, o.ty) >= 3);
      if (st) {
        const sx = st.tx * TILE + 8, sy = st.ty * TILE + 8;
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d > 40) {
          // a site it cannot route to must not pin it there
          if (steerTo(sx, sy) < 0) { ai.buildT = 15; ai.spendT = 0; }
          return;
        }
        if (d > 16) { // clear of the site: order it
          ai.spendT = 0;
          const bay = rng() < 0.3 && !!findSite('spawner', st.tx, st.ty); // same rng draw as before
          inp.cmd = { kind: 'build', tx: st.tx, ty: st.ty, id: bay ? 'spawner' : 'generator' };
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
        o.team === p.team && o.tier < STRUCTS[o.type].tiers.length - 1 && canAfford(STRUCTS[o.type].tiers[o.tier + 1].cost, p));
      if (up) {
        inp.cmd = { kind: 'upgrade', tx: up.tx, ty: up.ty, id: 'upgrade' };
        ai.buildT = 10;
        return;
      }
      ai.buildT = 4; // nothing worth spending on nearby; look again shortly
    }

    // 9. harvest: walk to a tree/rock/berry bush and hold E on it
    // (a stripped bush stops being work, so drop it the moment it empties)
    if (ai.tgt && (objects[idx(ai.tgt.tx, ai.tgt.ty)] !== ai.tgt ||
      (ai.tgt.type === 'bush' && ai.tgt.berries <= 0))) ai.tgt = null;
    ai.avoidT -= dt;
    if (ai.avoidT <= 0) ai.avoid = null;
    if (!ai.tgt && ai.thinkT <= 0) {
      ai.thinkT = 0.6;
      ai.tgt = nearestObj(p.x, p.y, AI_FORAGE, (o) => o !== ai.avoid &&
        (o.type === 'tree' || o.type === 'rock' || (o.type === 'bush' && o.berries > 0)) &&
        aiOpenSides(o.tx, o.ty) >= 1);
    }
    if (ai.tgt) {
      const t = ai.tgt;
      aimAt(t.tx * TILE + 8, t.ty * TILE + 8);
      const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
      if (Math.max(Math.abs(t.tx - ptx), Math.abs(t.ty - pty)) <= WORK_REACH) {
        inp.work = true;
        return;
      }
      // route to any tile within WORK_REACH of it, whichever side is open;
      // one with no route (walled in, or pinned on the way) is left alone a while
      if (steerTo(t.tx * TILE + 8, t.ty * TILE + 8, WORK_REACH) < 0) {
        ai.avoid = t; ai.avoidT = 12;
        ai.tgt = null;
      }
      return;
    }

    // 10. nothing to do: roam between its camp and the middle of the map
    ai.roam -= dt;
    if (ai.roam <= 0) {
      ai.roam = rand(3, 7);
      const toward = rng() < 0.5 ? { x: cx * TILE, y: cy * TILE } :
        { x: (p.spawn.tx + 0.5) * TILE, y: (p.spawn.ty + 0.5) * TILE };
      ai.wx = toward.x + rand(-14, 14) * TILE;
      ai.wy = toward.y + rand(-14, 14) * TILE;
    }
    const rd = steerTo(ai.wx, ai.wy);
    if (rd < 20) ai.roam = 0; // arrived, or no route (a point in the treeline): pick another
    aimAt(p.x + inp.mx * 24, p.y + inp.my * 24);
  }

  // ------------------------------------------------------------ update
  let camX = 0, camY = 0;

  // Ease the world scale toward what is wanted and resize the world view to
  // match. Nothing here touches the canvas, so unlike the old applyView() it
  // never calls fitCanvas()/relayout() and the overlays no longer have to force
  // the zoom back to base to make their fixed-size panels fit. `snap` lands on
  // the target immediately, for the two mode changes that must not be seen
  // easing (boot, and the eagle's fixed framing).
  function applyZoom(dt, snap) {
    const want = state.mode === 'drop' ? DROP_ZOOM : zoomWantOf();
    const k = 1 - Math.exp(-ZOOM_EASE * dt);
    if (snap) zoomCur = want;
    else {
      zoomCur += (want - zoomCur) * k;
      if (Math.abs(want - zoomCur) < 0.0008) zoomCur = want; // park it, or WV jitters by a px forever
    }
    sizeWorldView();
    // the minimap rides the same ease off the same constant, so both zooms
    // under one hand feel like one control
    const mw = mmWant();
    if (snap || mmCur < 0) mmCur = mw;
    else {
      mmCur += (mw - mmCur) * k;
      if (Math.abs(mw - mmCur) < 0.0008) mmCur = mw;
    }
  }

  function update(dt) {
    applyZoom(dt);

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

    if (state.mode === 'dead') {
      const was = state.deadTimer;
      state.deadTimer += dt; // the overlay's fade-in, and the victory screen's clock
      if (state.over === 'won') winCues(was, state.deadTimer);
    }

    // the match runs on while the local player is down - other slots are still
    // playing. Only pause and the settings panel stop the sim: the map is read
    // with the world still moving, the same deal the build wheel takes.
    if ((state.mode === 'play' || state.mode === 'dead' || state.mode === 'drop') &&
      !state.paused && !state.settingsOpen) {
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
      const tx = player.x - WV_W / 2, ty = player.y - WV_H / 2;
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
      const vp = viewPlayer();
      const look = vp === player ? 0.12 : 0; // the aim lean is the local slot's; a watched one is framed dead centre
      // the lean is a FRACTION of the view, so it divides by the zoom: the same
      // pointer offset leans the same share of the screen however close you are
      const lookX = (mouse.x - VIEW_W / 2) / zoomCur * look;
      const lookY = (mouse.y - VIEW_H / 2) / zoomCur * look;
      const tx = vp.x - WV_W / 2 + lookX;
      const ty = vp.y - WV_H / 2 + lookY;
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
    camX = Math.max(0, Math.min(WORLD * TILE - WV_W, camX));
    camY = Math.max(0, Math.min(WORLD * TILE - WV_H, camY));

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
      const vd = Math.hypot(a.vx, a.vy) || 1;
      const nx = a.vx / vd, ny = a.vy / vd;
      a.t += dt;
      a.x += a.vx * dt; a.y += a.vy * dt;
      // a faint mote in the shooter's colour every few px of flight: the shot
      // reads as a streak, and whose shot it is reads from across the map. The
      // step just walked is subdivided (rather than one mote per tick) so the
      // spacing survives both a slow arrow and a long frame; the motes are laid
      // behind the head at the distance they are owed and left to fade in place.
      a.trailD += vd * dt;
      while (a.trailD >= ARROW_TRAIL_STEP) {
        a.trailD -= ARROW_TRAIL_STEP;
        particles.push({
          x: a.x - nx * a.trailD, y: a.y - ny * a.trailD,
          vx: -nx * 8, vy: -ny * 8,
          life: ARROW_TRAIL_LIFE, maxLife: ARROW_TRAIL_LIFE, color: TEAMS[a.team].mark,
          size: 1, grav: 0, alpha: ARROW_TRAIL_A,
        });
      }
      let dead = a.t > a.life;
      if (!dead && isSolidTile(Math.floor(a.x / TILE), Math.floor(a.y / TILE))) {
        dead = true;
        burst(a.x, a.y, '#cfd8e8', 3, 25, 0.25, true);
      }
      if (!dead) {
        // players first: the same shot that drops a deer drops a rival
        for (const t of players) {
          if (a.team === t.team || !t.active || t.dead || inAir(t) || t.invuln > 0) continue;
          if (Math.hypot(t.x - a.x, t.y - 6 - a.y) < 7) {
            damagePlayer(t, a.dmg, nx, ny, players[a.owner], null, a.ambush);
            burst(a.x, a.y, '#e04a54', 6, 45, 0.4);
            if (a.ambush) ambushFx(a.x, a.y);
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        // worker bots take the same shot: they are units in the open, on a
        // team, and the only thing that ever stood outside the arrow pipeline
        for (const b of robots) {
          if (a.team === b.team || b.dead) continue;
          if (robotHit(b, a.x, a.y)) {
            hurtRobot(b, a.dmg, nx, ny, players[a.owner]);
            if (a.ambush) ambushFx(a.x, a.y);
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        for (const an of animals) {
          if (animalHit(an, a.x, a.y)) {
            an.hp -= a.dmg;
            an.flash = 0.12;
            an.lastHit = a.owner; // whose HUNTSMAN bonus the kill pays (animalDies)
            // a wolf does not run from an arrow - the whole den comes for you
            if (an.kind === 'wolf') wakePack(an, players[a.owner]);
            else if (an.kind === 'bird') flushBirds(an.home, a);
            else an.fleeT = an.kind === 'rabbit' ? 1.4 : 2.2;
            addDmgFloater(an.x, an.y - (an.alt || 0) - 12, a.dmg, false, a.ambush);
            const kb = 25 + 45 * a.pow;
            an.kbx = nx * kb; an.kby = ny * kb;
            burst(an.x, an.y - (an.alt || 0) - 4, HIT_PUFF[an.kind] || '#a5825a', 6, 40, 0.4);
            if (a.ambush) ambushFx(an.x, an.y - (an.alt || 0) - 4);
            if (nearPlayer(an.x, an.y)) SFX.hit();
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        // every bow shot that ends - a miss, a wall, a body, or the end of its
        // life - leaves the shaft where it stopped. One rule, no exceptions, so
        // "arrows come back" is learnable from the first miss. Turret bolts ride
        // this same array and are not arrows: they leave nothing.
        if (!a.kind) stickArrow(a, nx, ny);
        arrows.splice(i, 1);
      }
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

    // spent arrows in the snow. Neutral like drops - the fletching says whose
    // shot it was, but anyone short of a full quiver can pull it out, so losing
    // a firefight on someone else's ground also means shooting them their ammo.
    for (let i = shafts.length - 1; i >= 0; i--) {
      const s = shafts[i];
      s.t += dt;
      if (s.t > SHAFT_LIFE) { shafts.splice(i, 1); continue; }
      if (s.t < SHAFT_ARM) continue;
      for (const p of players) {
        if (!p.active || p.dead || inAir(p) || p.quiver >= QUIVER_MAX) continue;
        if (Math.hypot(s.x - p.x, s.y - p.y + 2) >= SHAFT_R) continue;
        contest('shaft:' + i, p, () => {
          const j = shafts.indexOf(s);
          if (j < 0 || !gainArrow(p, 1)) return; // someone else got there, or the quiver filled
          shafts.splice(j, 1);
          burst(s.x, s.y, TEAMS[s.team].mark, 4, 30, 0.3, true);
          if (p === player) SFX.shaftPull();
        });
      }
    }

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

    if (p.dead) { // out of the match: nothing it wants gets through
      inp.dodge = inp.prone = inp.eatBerry = inp.eatFish = false;
      inp.cmd = null;
      return;
    }

    // edge-triggered intents, consumed here so a controller only has to set them
    if (inp.dodge) { inp.dodge = false; tryDodge(p); }
    if (inp.prone) { inp.prone = false; tryProne(p); }
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
    const wantSlide = inp.slide && p.dodgeT <= 0 && !p.prone; // nothing glides on its belly
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
      // a belly crawl is a flat crawl on any surface - no ice cap, no draw
      // penalty, nothing to stack. Getting back up costs a moment of it too.
      const walkMax = p.prone ? PRONE_SPEED
        : p.riseT > 0 ? PLAYER_SPEED * kit.walkMul * 0.45
          : PLAYER_SPEED * kit.walkMul * chargeMul; // STRIDER lengthens the stride

      if (p.prone || (!onIce && !p.sliding && sp <= walkMax + 6)) {
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
        p.prone = false; p.hide = 0; p.riseT = 0; // crawled off the edge: no cover in the water
        if (p.charging) { p.charging = false; p.chargeT = 0; }
        p.fireArmed = false;
        if (nearPlayer(p.x, p.y)) SFX.splash();
        burst(p.x, p.y + 4, '#3a6080', 10, 55, 0.5, true);
        burst(p.x, p.y + 2, '#ddf1f8', 8, 60, 0.5, true);
        damagePlayer(p, HOLE_FALL_DMG, 0, 0, null, 'ice');
      }
    }

    // ---- the cover -------------------------------------------------------
    // `hide` is the whole stealth state. Lying still on snow pulls it over you
    // over PRONE_BURY; crawling holds what you already have (concealOf discounts
    // a moving mound rather than unpacking it); bare ice hides nothing at all,
    // so the river strips a crawler without forcing them upright; and anything
    // that puts you back on your feet sheds it over the rise window.
    if (p.prone) {
      const snow = inWorld(ftx, fty) && ground[idx(ftx, fty)] === 0;
      if (!snow) p.hide = Math.max(0, p.hide - dt * 2.2);
      else if (!p.moving && p.hide < 1) {
        p.hide = Math.min(1, p.hide + dt / PRONE_BURY);
        if (p.hide >= 1) { p.hideFlash = 0.4; if (p === player) SFX.hidden(); }
      }
      p.crawlT = p.moving ? p.crawlT + dt * 3.6 : 0;
      // One timer, two jobs, and which one it is doing says what state the body
      // is in. While the cover is still building it throws up the snow being
      // pulled over; once it is finished it becomes breath in cold air - the
      // fair tell that makes "almost invisible" true rather than a promise, and
      // the one thing a mound holding perfectly still still does.
      p.puffT -= dt;
      if (p.puffT <= 0) {
        if (p.hide < 1) {
          p.puffT = rand(0.14, 0.26);
          if (!p.moving) burst(p.x + rand(-6, 6), p.y + rand(0, 5), '#eef4fb', 1, 15, 0.34, true);
        } else {
          p.puffT = rand(1.8, 3.2);
          const bx2 = p.dir === 'left' ? -5 : p.dir === 'right' ? 5 : 0;
          const by2 = p.dir === 'up' ? -3 : 2;
          for (let i = 0; i < 3; i++) {
            particles.push({
              x: p.x + bx2 + rand(-1, 1), y: p.y + by2, vx: rand(-4, 4), vy: rand(-12, -6),
              life: rand(0.5, 0.9), maxLife: 0.7, color: '#dbe8f6', size: 1, grav: -8, alpha: 0.5,
            });
          }
        }
      }
    } else if (p.hide > 0) {
      p.hide = 0; // nothing but tryProne can put cover back on; never let it stick
    }
    if (p.riseT > 0) p.riseT = Math.max(0, p.riseT - dt);
    p.hideFlash = Math.max(0, p.hideFlash - dt);

    // dodge charges refill one at a time
    if (p.dodgeCharges < DODGE_CHARGES) {
      p.dodgeRegenT -= dt;
      if (p.dodgeRegenT <= 0) {
        p.dodgeCharges++;
        p.dodgeRegenT = p.dodgeCharges < DODGE_CHARGES ? kit.dodgeCd : 0;
      }
    }
    // spent-stamina ghost: hold briefly, then drain toward the live fill
    {
      const regenP = p.dodgeCharges < DODGE_CHARGES ? 1 - p.dodgeRegenT / kit.dodgeCd : 0;
      const frac = (p.dodgeCharges + regenP) / DODGE_CHARGES;
      if (p.stamGhostT > 0) p.stamGhostT -= dt;
      else p.stamGhost -= dt * 1.6;
      if (p.stamGhost < frac) p.stamGhost = frac;
    }

    const spNow = Math.hypot(p.vx, p.vy);
    // the crawl leaves a drag furrow instead of footprints: a broad flattened
    // trough with an elbow dimple alternating either side of it. It is a real
    // tell - a line like that leads anyone who reads it straight to the mound at
    // the end - and that is the point. The cover is beatable by someone looking.
    if (p.prone && spNow > 2) {
      p.trailD -= spNow * dt;
      const bx = p.vx / spNow, by = p.vy / spNow;
      let emit = 0;
      while (p.trailD <= 0 && emit++ < 4) {
        const back = -p.trailD;
        p.footSide = 1 - p.footSide;
        footprints.push({
          x: p.x - bx * back, y: p.y + 5 - by * back,
          nx: -by, ny: bx, t: 0, k: 3,
          // an elbow scuff off to one side of the trough on every other mark,
          // swapping sides every few of them, the way a crawl actually alternates
          s: p.footSide ? (Math.floor(p.crawlT) % 2 ? 1 : -1) : 0,
        });
        p.trailD += 2; // marks are two deep, so at this spacing they tile into one trough
      }
      while (footprints.length > 800) footprints.shift();
    }
    if (spNow > 8 && p.dodgeT <= 0 && !p.sliding && !p.prone) {
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

    // the quiver: the renock cooldown counts down, and a short quiver fletches
    // one arrow back at a time. Both run for every slot, dead or alive is
    // already filtered above, so a bot recovers on exactly the human's clock.
    if (p.nockT > 0) {
      p.nockT = Math.max(0, p.nockT - dt);
      if (p.nockT === 0) { p.readyFlash = 0.16; if (p === player) SFX.nock(); }
    }
    if (p.quiver < QUIVER_MAX) {
      p.fletchT += dt;
      if (p.fletchT >= QUIVER_REGEN) { p.fletchT = 0; gainArrow(p, 1); }
    } else p.fletchT = 0;
    p.quiverFlash = Math.max(0, p.quiverFlash - dt);
    p.readyFlash = Math.max(0, p.readyFlash - dt);
    p.dryT = Math.max(0, p.dryT - dt);

    // bow: pressing arms the shot, releasing looses. The press does not have to
    // land on a ready bow - it stays armed, so holding through the renock (or
    // through an empty quiver) draws the moment the next arrow is there. Without
    // that, a controller that holds fire down - every AI slot does - would fire
    // once and then wait forever for an edge it already spent.
    if (inp.fire && !p.firePrev) {
      p.fireArmed = true;
      if (p.quiver <= 0 && p.dryT <= 0) dryFire(p);
    }
    if (!inp.fire) p.fireArmed = false;
    if (p.fireArmed && !p.charging && p.nockT <= 0 && p.quiver > 0 && p.fallT <= 0 && p.swingT <= 0) {
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

    // gentle regen in daylight (HEARTHWEAVE keeps the hearth lit after dark)
    if (p.hp < p.maxHp && (state.darkness < 0.3 || kit.nightHeal)) {
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
      sctx.clearRect(0, 0, 64, 64);
      sctx.globalCompositeOperation = 'source-over';
      sctx.drawImage(spr, 0, 0);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = 'rgba(255,255,255,0.8)';
      sctx.fillRect(0, 0, 64, 64);
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

    // Into the world buffer: from here to renderLighting() every pass draws at
    // 1:1 world pixels into a WV_W x WV_H frame, and the screen never sees any
    // of it until the blit below. Everything in this stretch bounds itself
    // against WV_W/WV_H, never VIEW_W/VIEW_H - at zoom < 1 the world view is
    // WIDER than the canvas, and culling to the canvas would eat the edges.
    ctx = wctx;

    // ground
    ctx.drawImage(groundCv, ox, oy, WV_W, WV_H, 0, 0, WV_W, WV_H);

    // fish: silhouettes drifting under the thin ice, crisp in open holes
    for (const f of fish) {
      const sx = f.x - ex, sy = f.y - ey;
      if (sx < -12 || sy < -12 || sx > WV_W + 12 || sy > WV_H + 12) continue;
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
      if (px < -TILE || py < -TILE || px > WV_W || py > WV_H) continue;
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
      } else if (f.k === 3) {
        // belly-crawl furrow: a 5px trough laid ACROSS the path (f.nx/ny is the
        // perpendicular the mark was pushed with, so it stays square to the
        // crawl whichever way it went), pressed dark in the middle with the snow
        // it shoved up pale at both lips, plus one elbow dimple to the side.
        // Lives the full 9 s of a footprint - a trail worth following needs to
        // outlast the crawl that made it.
        const a = Math.max(0, 1 - f.t / 9);
        const px = Math.round(f.x - ox), py = Math.round(f.y - oy);
        const dark = 'rgba(118,144,186,' + (a * 0.45).toFixed(3) + ')';
        const lip = 'rgba(200,216,238,' + (a * 0.4).toFixed(3) + ')';
        // two deep along the direction of travel (f.ny, -f.nx), so consecutive
        // marks butt up against each other into one trough instead of a ladder
        for (let k = 0; k < 2; k++) {
          const ox2 = Math.round(f.ny * k), oy2 = Math.round(-f.nx * k);
          for (let t = -2; t <= 2; t++) {
            ctx.fillStyle = t === -2 || t === 2 ? lip : dark;
            ctx.fillRect(px + ox2 + Math.round(f.nx * t), py + oy2 + Math.round(f.ny * t), 1, 1);
          }
        }
        if (f.s) {
          ctx.fillStyle = dark;
          ctx.fillRect(px + Math.round(f.nx * 3 * f.s), py + Math.round(f.ny * 3 * f.s), 1, 1);
        }
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
    const tx1 = Math.min(WORLD - 1, Math.ceil((ox + WV_W) / TILE) + 1);
    const ty1 = Math.min(WORLD - 1, Math.ceil((oy + WV_H) / TILE) + 2);

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

    // spent arrows, then drops (both under entities)
    drawShafts(ex, ey, now);
    for (const d of drops) {
      const spr = d.type === 'gold' ? SPRITES.itemGold : d.type === 'fish' ? SPRITES.itemFish : SPRITES.itemBerry;
      // shadow
      ctx.fillStyle = 'rgba(120,140,175,0.35)';
      ctx.fillRect(Math.round(d.x - ex) - 2, Math.round(d.y - ey) + 2, 4, 2);
      ctx.drawImage(spr, Math.round(d.x - ex) - 4, Math.round(d.y - d.z - ey) - 4);
    }

    // y-sorted entities. A building sorts by the bottom of its footprint; a
    // filler whose anchor is outside the scanned tiles stands in for it so a
    // big building still draws when only its lower tiles are on screen.
    const draws = [];
    const seen = new Set();
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        let o = objects[idx(tx, ty)];
        if (!o || o.type === 'stump') continue;
        if (o.type === 'part') {
          o = o.of;
          if ((o.tx >= tx0 && o.tx <= tx1 && o.ty >= ty0 && o.ty <= ty1) || seen.has(o)) continue;
          seen.add(o);
        }
        draws.push({ y: (o.ty + structH(o.type)) * TILE, o, tx: o.tx, ty: o.ty });
      }
    }
    for (const p of players) {
      if (p.dead || inAir(p)) continue; // airborne slots draw in drawDropAir
      draws.push({ y: p.y + 8, p, ghost: !p.active }); // empty slots stand as silhouettes
    }
    for (const a of animals) draws.push({ y: a.y + 4, a });
    for (const b of robots) draws.push({ y: b.y + 4, r: b });
    draws.sort((a, b) => a.y - b.y);

    if (window.DBG.showPaths) drawNavPaths(ex, ey);
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
        const sy = py + structH(o.type) * TILE - spr.height; // skirt on the footprint's bottom edge
        // a sprite wider than its footprint (the 32x32 turret on one tile) centres over it
        const sx = px + ((structW(o.type) * TILE - spr.width) >> 1);
        if (o.building) {
          const p = o.buildT / o.buildTotal;
          if (spr.width > 16) {
            // a big build: the foundation is staked out first, then the walls
            // rise out of it behind a weld line (bigBuildReveal for the split)
            const fw = structW(o.type) * TILE, fh = structH(o.type) * TILE;
            ctx.fillStyle = 'rgba(58,66,82,0.5)';
            ctx.fillRect(px + 1, py + 1, fw - 2, fh - 2);
            ctx.fillStyle = '#1c2130';
            ctx.fillRect(px, py, fw, 1); ctx.fillRect(px, py + fh - 1, fw, 1);
            ctx.fillRect(px, py, 1, fh); ctx.fillRect(px + fw - 1, py, 1, fh);
            for (const [cx, cy] of [[px + 1, py - 2], [px + fw - 3, py - 2], [px + 1, py + fh - 5], [px + fw - 3, py + fh - 5]]) {
              ctx.fillStyle = '#1c2130'; ctx.fillRect(cx, cy, 2, 4);
              ctx.fillStyle = '#e0b83f'; ctx.fillRect(cx, cy, 2, 1);
            }
            const r = bigBuildReveal(o);
            if (r.rows > 0) {
              ctx.save();
              ctx.beginPath(); ctx.rect(sx - 2, sy + spr.height - r.rows, spr.width + 4, r.rows); ctx.clip();
              drawSpriteFlash(spr, sx + sh, sy, o.flash);
              ctx.restore();
              if (r.rows < spr.height) {
                const ey = sy + spr.height - r.rows;
                ctx.fillStyle = '#fff1b0'; ctx.fillRect(sx + 2, ey, spr.width - 4, 1);
                ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now * 40);
                ctx.fillStyle = '#ffd95c'; ctx.fillRect(sx + 4, ey - 1, spr.width - 8, 1);
                ctx.globalAlpha = 1;
              }
            }
          } else if (p < 1 / 3) ctx.drawImage(SPRITES.scaffold[0], px, py);
          else if (p < 2 / 3) ctx.drawImage(SPRITES.scaffold[1], px, py);
          else {
            drawSpriteFlash(spr, px + sh, py, o.flash);
            ctx.drawImage(SPRITES.scaffold[2], px, py);
          }
        } else {
          drawSpriteFlash(spr, sx + sh, sy, o.flash);
          if (o.type === 'spawner') drawBayOverlay(o, sx + sh, sy, now);
          // the gun is not in the grid: rasterise it at the live bearing, on the collar
          if (o.type === 'turret') drawTurretHead(o, sx + sh + 16, sy + 12);
          if (o.hp < o.maxHp * 0.6) {
            // four crack marks, placed as fractions of the sprite so they fit any size
            const w = spr.width, h = spr.height;
            ctx.fillStyle = 'rgba(40,25,15,0.5)';
            ctx.fillRect(sx + (w >> 2), sy + (h * 5 >> 4), 1, 3); ctx.fillRect(sx + (w >> 2) + 1, sy + (h >> 1), 1, 2);
            ctx.fillRect(sx + (w * 5 >> 3), sy + (h * 3 >> 4), 1, 4); ctx.fillRect(sx + (w * 5 >> 3) + 1, sy + (h * 7 >> 4), 1, 2);
          }
          // damage readout: only once hurt, so an untouched base stays clean.
          // the bay has its own bar inside drawBayOverlay - don't draw two.
          if (o.type !== 'spawner' && o.hp < o.maxHp) {
            drawHealthBar(sx + (spr.width >> 1), sy - 5, o.hp, o.maxHp, Math.max(12, Math.min(24, spr.width - 4)));
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
      if (px < -20 || px > WV_W + 4 || py < -20 || py > WV_H + 4) continue;
      const p = Math.min(1, o.buildT / o.buildTotal);
      const big = structW(o.type) > 1;
      const bw = big ? 24 : 12, bx = big ? px + structW(o.type) * 8 - 12 : px + 2;
      const by = big ? (o.ty + structH(o.type)) * TILE - oy - structSprite(o).height - 12 : py - 7;
      ctx.fillStyle = 'rgba(15,22,50,0.8)';
      ctx.fillRect(bx, by, bw, 4);
      ctx.fillStyle = '#ffd95c';
      ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * p), 2);
    }

    // particles
    for (const p of particles) {
      // `maxLife` is the seconds a particle spends fading out (bursts hold full
      // opacity until their last 0.4 s); `alpha` caps how opaque it ever gets,
      // which is what keeps arrow trail motes a hint of colour rather than sparks
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife)) * (p.alpha || 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - ex), Math.round(p.y - ey), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    drawAimLine(ex, ey, now);

    // arrows: a barbed head, a shaft and team-coloured fletching, rasterised
    // pixel by pixel and rimmed in dark so the shot stays readable over snow.
    // Points are addressed as (back along the shaft, sideways): i px behind the
    // head, j px along the perpendicular.
    for (const a of arrows) {
      if (a.kind === 'bolt') { drawBolt(a, ex, ey); continue; }
      const vd = Math.hypot(a.vx, a.vy) || 1;
      const nx = a.vx / vd, ny = a.vy / vd;
      const hx = Math.round(a.x - ex), hy = Math.round(a.y - ey);
      if (hx < -16 || hx > WV_W + 16 || hy < -16 || hy > WV_H + 16) continue;
      const qx = -ny, qy = nx;
      ARROW_PX.length = 0;
      const at = (i, j) => ARROW_PX.push(
        Math.round(hx - nx * i + qx * j), Math.round(hy - ny * i + qy * j));
      at(0, 0); at(1, 0); at(2, 0); at(3, 0); at(4, 0); at(5, 0); at(6, 0); at(7, 0);
      at(2, -1); at(2, 1);        // barbs: the head still points at any angle
      const shaftEnd = ARROW_PX.length;
      at(6, -1); at(6, 1); at(7, -1); at(7, 1); // fletching, in the team colour
      // rim first: a plus-shaped dilation of every pixel, so the whole arrow
      // carries a 1px dark edge whatever direction it flies
      ctx.fillStyle = ARROW_RIM;
      for (let k = 0; k < ARROW_PX.length; k += 2) {
        const px = ARROW_PX[k], py = ARROW_PX[k + 1];
        ctx.fillRect(px - 1, py, 1, 1); ctx.fillRect(px + 1, py, 1, 1);
        ctx.fillRect(px, py - 1, 1, 1); ctx.fillRect(px, py + 1, 1, 1);
      }
      ctx.fillStyle = '#e8dcb4';
      for (let k = 0; k < shaftEnd; k += 2) ctx.fillRect(ARROW_PX[k], ARROW_PX[k + 1], 1, 1);
      ctx.fillStyle = TEAMS[a.team].mark;
      for (let k = shaftEnd; k < ARROW_PX.length; k += 2) ctx.fillRect(ARROW_PX[k], ARROW_PX[k + 1], 1, 1);
      ctx.fillStyle = '#ffffff'; // the tip stays the brightest pixel on screen
      ctx.fillRect(hx, hy, 1, 1);
    }

    drawTurretFx(ex, ey, now);

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
      if (!p.active || p.dead || inAir(p) || p.swingT <= 0) continue;
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
    renderLighting(ox, oy, ex, ey, now);
    drawHitboxes(ox, oy, ex, ey); // the '.' overlay - above the lighting on purpose, see its banner

    // Back to the screen, and the only place the two pixel spaces meet. The
    // blit is done in DEVICE pixels (identity transform) at k = zoom * devScale
    // px per world px: whole at rest, so every world pixel gets exactly the
    // same k x k block and the grid is uniform; briefly fractional while the
    // ease runs, which is the one moment nobody is reading pixel edges. It is
    // one nearest-neighbour resample of an ALREADY COMPOSED frame, so ground,
    // sprites and particles share one grid instead of each rounding its own.
    // The destination overhangs the canvas by less than k px (sizeWorldView
    // ceils) and the edge clips it.
    ctx = uictx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const kPx = zoomCur * devScale;
    ctx.drawImage(worldCv, 0, 0, WV_W, WV_H, 0, 0, WV_W * kPx, WV_H * kPx);
    // everything from here draws in VIEW space, blown up by the whole-number
    // devScale - so 1px HUD rects and the 3x5 font stay exact at any zoom
    ctx.setTransform(devScale, 0, 0, devScale, 0, 0);

    renderWeather(ex, ey);
    renderVignettes();
    replayTick(now); // banks the finished world frame - must stay above renderUI
    renderUI(now);
    if (state.mode === 'drop') renderDropUI(now);
    if (state.mode === 'play' && state.wheel) renderWheel(now);

    if (state.mode === 'play' && state.mapOpen) renderWorldMap(now);
    if (state.mode === 'play' && state.settingsOpen) renderSettings(now);
    if (state.mode === 'title' || state.intro > 0) renderTitle(now);
    if (state.mode === 'dead') renderDead(now);
    renderReplay(); // the last four seconds, looping in the bottom-left corner
    // both sit above the death dim: the feed and the standings are exactly what
    // you read while you are down. They duck under the map/settings panels.
    if (!state.mapOpen && !state.settingsOpen && !window.DBG.hideUI &&
      !(state.mode === 'dead' && state.over === 'won') && // the victory screen owns the frame
      (state.mode === 'play' || state.mode === 'dead')) renderEventLog();
    if (scoreboardOpen()) renderScoreboard();
    if (!window.DBG.hideUI) drawTags();
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

  // debug: every walker's live route (DBG.showPaths), waypoints joined from the unit
  function drawNavPaths(ex, ey) {
    ctx.save();
    ctx.lineWidth = 1;
    const one = (e, col) => {
      const nav = e.nav;
      if (!nav || !nav.path) return;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(Math.round(e.x - ex) + 0.5, Math.round(e.y - ey) + 0.5);
      for (let i = nav.i; i < nav.path.length; i++) ctx.lineTo(Math.round(nav.path[i][0] - ex) + 0.5, Math.round(nav.path[i][1] - ey) + 0.5);
      ctx.stroke();
    };
    for (const p of players) if (p.active && !p.dead && !inAir(p)) one(p, '#ffe27a');
    for (const a of animals) if (!a.dead) one(a, a.kind === 'wolf' ? '#ff6a6a' : '#8ef0a0');
    for (const b of robots) if (!b.dead) one(b, '#7fc8ff');
    ctx.restore();
  }

  // the info stack (settings.info - the INFO row in the ESC menu, or F3, the
  // minecraft reflex): fps, the framed slot's tile coordinates, and the run
  // seed as one vertical list on the left edge at the top quarter of the view,
  // clear of the berry/fish counters above it, above every overlay. In title
  // only the fps line shows - nobody stands anywhere yet, and the menu prints
  // the seed itself with the reroll die.
  function drawTags() {
    if (!settings.info) return;
    // two columns: a dim label, then the value on one shared x so the numbers
    // line up down the stack - the same dim-label / bright-value pairing the
    // berry and fish counters use. Red is the only colour that means anything
    // here (a bad frame rate); nothing else is tinted for decoration.
    const lx = 5, vx = lx + pixelTextWidth('SEED') + 5;
    let y = Math.round(VIEW_H * 0.25);
    const line = (label, value, col) => {
      drawPixelTextOutline(ctx, label, lx, y, '#7a8bb8', '#0f1632');
      drawPixelTextOutline(ctx, value, vx, y, col || '#f4f7ff', '#0f1632');
      y += 10;
    };
    line('FPS', String(perf.fps), perf.fps < 45 ? '#ff9a8a' : '#f4f7ff');
    if (state.mode !== 'title') {
      const vp = viewPlayer(); // spectators read the slot the camera frames
      line('POS', Math.floor(vp.x / TILE) + ', ' + Math.floor(vp.y / TILE));
      line('SEED', String(SEED));
    }
  }

  // ------------------------------------------------------------ hitbox overlay
  // What the sim actually tests, drawn on top of what the art shows. The '.'
  // key cycles `settings.hitbox`: 0 off, 1 bodies, 2 bodies + ranges - one key,
  // and the extra rings are their own step because a wolf's sight ring is 96px
  // wide and would bury the 7px circle that decides whether an arrow lands.
  // Every shape here is read from the same expression the sim uses, never a
  // repeat of the number: an overlay that disagrees with the sim is worse than
  // none, because it is believed. Colour carries the kind, so there is nothing
  // to label:
  //   cyan   a wall to everyone (isSolidTile)
  //   blue   open water: a wall to animals and robots, a hole a player falls in
  //   green  the body circle separateUnits/moveEntity push apart
  //   red    the circle an arrow is tested against - offset UP from the feet
  //   violet a walk-over pickup, or a click target
  //   gold   a projectile, which is a point and not a circle
  //   orange (mode 2) a reach or a sight range, stippled so it stays behind
  // This is the one world pass that draws ABOVE renderLighting: a hitbox has to
  // be as readable at midnight as at noon, and the lighting would eat it.
  const HB_SOLID = '#5ad0ff', HB_WATER = '#3f76ff', HB_BODY = '#4dff7d';
  const HB_HURT = '#ff4d5e', HB_PICK = '#c07dff', HB_SHOT = '#ffd95c', HB_RANGE = '#ff9a3a';
  const HB_STIP = 3; // a range plots one ring pixel in three

  // One ring, plotted as 1px world pixels. Not an arc() stroke: that is
  // anti-aliased, and the world blit magnifies a soft edge into mush. Rows give
  // the left/right extremes and columns the top/bottom ones, so the ring closes
  // at every radius and a fractional one (PLAYER_R is 4.5) is not rounded away.
  function hbRing(cx, cy, r, col, step) {
    if (r < 0.5) return;
    cx = Math.round(cx); cy = Math.round(cy);
    if (cx + r < 0 || cy + r < 0 || cx - r > WV_W || cy - r > WV_H) return;
    ctx.fillStyle = col;
    let n = 0;
    const put = (px, py) => { if (!step || n++ % step === 0) ctx.fillRect(px, py, 1, 1); };
    const R = Math.floor(r);
    for (let d = -R; d <= R; d++) {
      const o = Math.round(Math.sqrt(r * r - d * d));
      put(cx - o, cy + d); put(cx + o, cy + d);
      put(cx + d, cy - o); put(cx + d, cy + o);
    }
  }
  function hbBox(x, y, w, h, col) {
    if (x + w < 0 || y + h < 0 || x > WV_W || y > WV_H) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y + 1, 1, h - 2); ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
  }
  // the anchor point itself: a circle drawn around the wrong origin looks right
  // until you see where its centre is
  function hbDot(cx, cy, col) {
    const x = Math.round(cx), y = Math.round(cy);
    ctx.fillStyle = col;
    ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
  }

  function drawHitboxes(ox, oy, ex, ey) {
    if (!settings.hitbox) return;
    const ranges = settings.hitbox > 1;
    const vp = viewPlayer(); // sight ranges are per-target: they answer "how far
                             // can this thing see the slot the camera frames"

    // tiles - the AABB moveEntity() sweeps, straight off isSolidTile. Statics
    // subtract the rounded camera, movers below subtract the exact one.
    const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE);
    const tx1 = Math.floor((ox + WV_W) / TILE), ty1 = Math.floor((oy + WV_H) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const px = tx * TILE - ox, py = ty * TILE - oy;
      if (isSolidTile(tx, ty)) hbBox(px, py, TILE, TILE, HB_SOLID);
      else if (inWorld(tx, ty) && ground[idx(tx, ty)] === 2) hbBox(px, py, TILE, TILE, HB_WATER);
    }

    // players: the body circle everything is pushed out of, and the hurt circle
    // an arrow is tested against - which sits 6px UP, at the chest, so a shot
    // that looks like it went over the head is a hit and this is where you see it
    for (const p of players) {
      if (!p.active || p.dead || inAir(p)) continue;
      hbRing(p.x - ex, p.y - ey, PLAYER_R, HB_BODY);
      hbRing(p.x - ex, p.y - 6 - ey, 7, HB_HURT);
      hbDot(p.x - ex, p.y - ey, HB_BODY);
      if (!ranges) continue;
      // E works a ring of TILES, not a radius - so it is drawn as one
      const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE), span = 2 * WORK_REACH + 1;
      hbBox((ptx - WORK_REACH) * TILE - ox, (pty - WORK_REACH) * TILE - oy, span * TILE, span * TILE, HB_RANGE);
      hbRing(p.x - ex, p.y - ey, FISH_CATCH_R, HB_RANGE, HB_STIP);
    }

    // animals: birds are the one unit nothing collides with, so they get no
    // body circle - only the (smaller) circle an arrow tests
    for (const a of animals) {
      if (a.dead) continue;
      const hy = a.y - (a.alt || 0) - 3;
      if (a.kind !== 'bird') hbRing(a.x - ex, a.y - ey, unitRadius(a), HB_BODY);
      hbRing(a.x - ex, hy - ey, a.kind === 'bird' ? 5 : 8, HB_HURT);
      hbDot(a.x - ex, a.y - ey, HB_BODY);
      if (!ranges) continue;
      if (a.kind === 'wolf') {
        hbRing(a.x - ex, a.y - ey, WOLF_BITE_R, HB_RANGE, HB_STIP);
        hbRing(a.x - ex, a.y - ey, seenAt(vp, WOLF_SIGHT * (1 + state.darkness * 0.75)), HB_RANGE, HB_STIP);
        if (a.home) hbRing((a.home.tx + 0.5) * TILE - ox, (a.home.ty + 0.5) * TILE - oy, WOLF_LEASH, HB_RANGE, HB_STIP * 3);
      } else if (a.kind === 'bird' && a.flyT <= 0) {
        hbRing(a.x - ex, a.y - (a.alt || 0) - ey, BIRD_FLUSH, HB_RANGE, HB_STIP);
      }
    }

    for (const b of robots) {
      if (b.dead) continue;
      hbRing(b.x - ex, b.y - ey, unitRadius(b), HB_BODY);
      hbRing(b.x - ex, b.y - 1 - ey, 7, HB_HURT); // robotHit
      hbDot(b.x - ex, b.y - ey, HB_BODY);
    }

    // a turret acquires inside its tier's range, measured from the PIVOT (which
    // is above the tile, not in it) and shrunk by whatever cover the mark has
    if (ranges) for (const o of structures) {
      if (o.type !== 'turret' || o.building) continue;
      const pv = turretPivot(o);
      hbRing(pv.x - ox, pv.y - oy, seenAt(vp, STRUCTS.turret.tiers[o.tier].range), HB_RANGE, HB_STIP);
      hbDot(pv.x - ox, pv.y - oy, HB_RANGE);
    }

    // an arrow is a point: it is the tile under that point that stops it, and
    // that point that is tested against every circle above
    for (const a of arrows) hbDot(a.x - ex, a.y - ey, HB_SHOT);

    // walk-over and click targets. A drop is claimed from its own centre, a
    // shaft from 2px below its own - both are what the sim measures to.
    for (const d of drops) {
      hbRing(d.x - ex, d.y - ey, 7, HB_PICK);
      if (ranges) hbRing(d.x - ex, d.y - ey, 28, HB_RANGE, HB_STIP); // the drift-toward-you magnet
    }
    for (const s of shafts) hbRing(s.x - ex, s.y + 2 - ey, SHAFT_R, HB_PICK);
    for (const f of fish) hbRing(f.x - ex, f.y - ey, 7, HB_PICK); // hoverFish
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
      if (m.screen === 'gear') return { kind: m.gearT >= 1 && gearScreenHit() ? 'hand' : 'arrow' };
      if (m.screen === 'select') return { kind: m.screenT >= 1 && m.gearT <= 0 && selectHit() >= 0 ? 'hand' : 'arrow' };
      if (!m.panel) { const h = menuHit(); if (h >= 0 && h !== MENU_FROZEN) return { kind: 'hand' }; } // the frozen plank isn't clickable, so no hand
      return { kind: 'arrow' };
    }
    if (state.mode === 'dead') return { kind: deadHit() >= 0 || specHit() ? 'hand' : 'arrow' };
    if (state.mode !== 'play') return { kind: 'arrow' };
    if (state.settingsOpen) {
      if (dragSlider) return { kind: 'grab' };
      return { kind: settingsHit() ? 'hand' : 'arrow' };
    }
    if (state.mapOpen || state.paused) return { kind: 'arrow' };
    if (state.wheel) return { kind: wheelLayout().seg >= 0 ? 'hand' : 'arrow' };
    if (gearHit(mouse.x, mouse.y) >= 0) return { kind: 'hand' }; // the gear row is clickable HUD

    // Every reticle in play carries the bow's state, whatever it is hovering:
    // `nock` is how much of the renock has elapsed (1 = ready) and `dry` says
    // the quiver is empty. drawCursor turns them into the ring's own behaviour,
    // so the crosshair the eye is already on is where the cooldown is read.
    const nockK = kitOf(player);
    const nockF = player.nockT > 0 ? 1 - player.nockT / Math.max(0.01, nockK.nock) : 1;
    const dry = player.quiver <= 0;
    // `amb` rides along the same way: buried, settled, and the next arrow off
    // this string is the one worth AMBUSH_MUL
    const ret = (mode, dim, extra) =>
      Object.assign({ kind: 'reticle', mode, dim, nock: nockF, dry, amb: ambushReady(player) }, extra);

    const wx = mouseWX(), wy = mouseWY();
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    const o = structOf(objAt(tx, ty));
    const busy = player.fallT > 0 || player.dodgeT > 0; // tools locked out
    // build sites (right-click) outrank tool hints; beyond the 60px reach they dim
    if (o && (o.type === 'stump' || (STRUCTS[o.type] && !o.building && o.team === player.team))) {
      const far = Math.hypot(tx * TILE + 8 - player.x, ty * TILE + 8 - player.y) > 60;
      return { kind: 'hammer', dim: far };
    }
    if (player.charging) {
      return ret('bow', false, { frac: Math.min(1, player.chargeT / nockK.bowCharge) });
    }
    // a living thing under the pointer: hunting reticle
    for (const q of players) {
      if (!enemyOf(player, q)) continue;
      if (Math.abs(wx - q.x) <= 8 && wy >= q.y - 14 && wy <= q.y + 4) {
        return ret('hunt', busy);
      }
    }
    for (const b of robots) {
      if (b.dead || b.team === player.team) continue;
      if (Math.abs(wx - b.x) <= 7 && wy >= b.y - 7 && wy <= b.y + 4) {
        return ret('hunt', busy);
      }
    }
    for (const a of animals) {
      const hw = a.kind === 'rabbit' ? 7 : a.kind === 'bird' ? 5 : a.kind === 'wolf' ? 9 : 13;
      const h = a.kind === 'rabbit' ? 11 : a.kind === 'bird' ? 7 : a.kind === 'wolf' ? 14 : 22;
      const by = a.y + 4 - (a.alt || 0); // birds ride their alt
      if (Math.abs(wx - a.x) <= hw && wy >= by - h && wy <= by) {
        return ret('hunt', busy);
      }
    }
    // a fish under the ice: water-blue ring (the bow spears it from point-blank)
    if (hoverFish()) return ret('fish', busy);
    // something E can work: lock ring (ice-blue over bare ice), dim out of reach
    const wt = workTarget(player);
    if (wt) return ret(wt.o ? 'lock' : 'ice', busy || !wt.near);
    return ret('idle', busy);
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
    // The bow's own state, on top of whatever the pointer is over. An empty
    // quiver hollows the reticle out - the centre pixel, the one thing that says
    // "this shot happens here", is simply gone, and the ticks go slate. While the
    // renock runs, four corner marks fall inward from far out and land on the
    // ring at the moment the bow is ready; there is nothing left of them at rest,
    // so a ready bow is still the clean crosshair it has always been.
    const nock = info.nock === undefined ? 1 : info.nock;
    if (info.dry) col = '#8a97bd'; else rects.push([mx, my, 1, 1]);
    drawOutlinedRects(rects, col, base);
    if (nock < 1) {
      const g = gap + 2 + Math.round((1 - nock) * 6);
      drawOutlinedRects([
        [mx - g, my - g, 2, 1], [mx - g, my - g, 1, 2],
        [mx + g - 1, my - g, 2, 1], [mx + g, my - g, 1, 2],
        [mx - g, my + g, 2, 1], [mx - g, my + g - 1, 1, 2],
        [mx + g - 1, my + g, 2, 1], [mx + g, my + g - 1, 1, 2],
      ], info.dry ? '#8a97bd' : '#ffd95c', base * (0.35 + 0.55 * nock));
    }
    // Loosing from full cover: the crosshair grows a second segment out along
    // each of its own axes and the centre pixel warms to gold. Deliberately on
    // the cross, where the renock's marks are on the diagonals, so a bow that is
    // both reloading and buried says two separate things at once.
    if (info.amb && !info.dry) {
      const g2 = gap + L + 2;
      drawOutlinedRects([
        [mx - g2 - 1, my, 2, 1], [mx + g2, my, 2, 1],
        [mx, my - g2 - 1, 1, 2], [mx, my + g2, 1, 2],
      ], '#ffd95c', base);
      ctx.globalAlpha = base;
      ctx.fillStyle = '#ffd95c';
      ctx.fillRect(mx, my, 1, 1);
      ctx.globalAlpha = 1;
    }
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
    const dx = mouseWX() - x0, dy = mouseWY() - y0;
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
        // a small arrowhead bobbing over it - the same wedge the quiver pip wears
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

    let tdx = 0, tdy = 0, working = false;
    if (b.tgt && !b.moving) {
      tdx = b.tgt.tx * TILE + 8 - b.x; tdy = b.tgt.ty * TILE + 8 - b.y;
      working = Math.hypot(tdx, tdy) <= 20;
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
      const icon = SPRITES[b.tgt.type === 'tree' ? 'itemAxe' : 'itemPick'];
      const prog = Math.min(1, b.workT / 0.9);
      const e = prog < 0.7 ? prog / 0.7 * 0.3 : 0.3 + (prog - 0.7) / 0.3 * 0.7;
      const a = Math.atan2(tdy, tdx) - 1.6 * (1 - e);
      ctx.save();
      ctx.translate(Math.round(bx + 6 + Math.cos(a) * 7), Math.round(by + 3 + Math.sin(a) * 7));
      ctx.rotate(a + Math.PI / 2);
      ctx.drawImage(icon, -4, -4);
      ctx.restore();
    }

    drawHealthBar(b.x - ex, by - 4, b.hp, b.maxHp, 8);
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
    drawHealthBar(p.x - ex, hy - 7, p.hp, p.maxHp, 14);
    // level badge: a 7x7 square sharing its right frame column with the bar
    // backing's left edge (one 1px frame everywhere, never a doubled wall), and
    // spanning the health bar and the stamina bar stacked (hy-8 .. hy-2). Same
    // backing / track colours as the bars.
    {
      const bx = Math.round(p.x - ex) - 14, by = hy - 8;
      ctx.fillStyle = 'rgba(12,18,42,0.78)';
      ctx.fillRect(bx, by, 6, 7); // 6 wide: the 7th column is the bar backing, already painted
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(bx + 1, by + 1, 5, 5);
      drawPixelText(ctx, String(p.level), bx + 2, by + 1, '#f2cc6a');
    }
    // rivals carry a name tag in their team colour so a fight stays legible
    if (!local) {
      drawPixelTextOutline(ctx, p.name,
        Math.round(p.x - ex - pixelTextWidth(p.name) / 2), hy - 18, // clear of the draw meter's frame (top row hy-11) with a gap row
        TEAMS[p.team].mark, '#0f1632');
    }
    // dodge stamina: one clean unsegmented bar under the health bar - charges
    // stay discrete in the sim, the bar just shows the pooled total. Drawn for
    // every slot (a rival out of rolls is a tell, and the level badge spans
    // both bars, so a lone hp bar would look broken).
    // The track is painted one row taller than the fill so the gap between the two
    // bars is track grey, not frame colour - one clean outline around both.
    {
      const bx = Math.round(p.x - ex) - 7, by = hy - 4;
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
      const x = Math.round(p.x - ex) - 7, y = hy - 10;
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
      tx = Math.floor(mouseWX() / TILE);
      ty = Math.floor(mouseWY() / TILE);
      const o = structOf(objAt(tx, ty));
      if (!o) return;
      if (o.type !== 'stump' && !(STRUCTS[o.type] && !o.building && o.team === player.team)) return;
      if (Math.hypot(tx * TILE + 8 - player.x, ty * TILE + 8 - player.y) > 60) return;
    }
    // a big building brackets its whole footprint, from its anchor
    const o2 = structOf(objAt(tx, ty));
    const big = o2 && STRUCTS[o2.type] && (structW(o2.type) > 1 || structH(o2.type) > 1);
    const bx = (big ? o2.tx : tx) * TILE - ox, by = (big ? o2.ty : ty) * TILE - oy;
    const bw = (big ? structW(o2.type) : 1) * TILE, bh = (big ? structH(o2.type) : 1) * TILE;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now * 6);
    // four 3px corner brackets, dark shadow first so white reads on snow
    const corners = (c, px, py) => {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, 3, 1); ctx.fillRect(px, py, 1, 3);
      ctx.fillRect(px + bw - 3, py, 3, 1); ctx.fillRect(px + bw - 1, py, 1, 3);
      ctx.fillRect(px, py + bh - 1, 3, 1); ctx.fillRect(px, py + bh - 3, 1, 3);
      ctx.fillRect(px + bw - 3, py + bh - 1, 3, 1); ctx.fillRect(px + bw - 1, py + bh - 3, 1, 3);
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
    const st = t.o && structOf(t.o);
    const isStruct = !!(st && STRUCTS[st.type]);
    const tall = t.o && (t.o.type === 'tree' || t.o.type === 'deadTree');
    const verb = !t.o ? 'CRACK ICE' : isStruct ? 'BREAK' : tall ? 'CHOP' :
      t.o.type === 'bush' ? 'PICK' : 'MINE';
    // sit above the sprite: trees reach 8px above their tile, short objects start 6px
    // below. A building is drawn up from its footprint's bottom edge and can be taller
    // than its tiles, so clear its own sprite instead of its tile row.
    const lift = isStruct ? structSprite(st).height - structH(st.type) * TILE + 12 :
      t.o ? (tall ? 20 : 10) : 8;
    // a multi-tile building takes the prompt on its centre, not the tile you aimed at
    const hx = isStruct ? (st.tx + structW(st.type) / 2) * TILE : t.tx * TILE + 8;
    const hty = isStruct ? st.ty * TILE : t.ty * TILE;
    const hby = isStruct ? (st.ty + structH(st.type)) * TILE : t.ty * TILE + TILE;
    const pressed = !!player.input.work;
    const capW = 9, gapW = 3;
    const totalW = capW + gapW + pixelTextWidth(verb);
    const x = Math.round(hx - ox - totalW / 2);
    let y = Math.round(hty - oy - lift);
    // an adjacent target puts the prompt over the player's head: flip it under the tile instead
    const px0 = Math.round(player.x - ox), py0 = Math.round(player.y - oy);
    if (x < px0 + 9 && x + totalW > px0 - 9 && y < py0 + 5 && y + 10 > py0 - 14) {
      y = Math.round(hby - oy + 3);
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
  // drawn from the hub as a knob. The cursor itself can be anywhere on screen,
  // so this is the only readout of the input the choice is actually made with:
  // it moves 1:1 with the pointer, so the knob is visibly inside the wedge that
  // is lit, and it clamps to the lane between the hub rim and the icon ring so
  // it never lands on an icon. Sitting in the hub is "nothing chosen": the knob
  // stays grey on the cancel cross, which is where it starts.
  function drawWheelStick(L) {
    const live = L.seg >= 0;
    const reach = (WHEEL_HUB + WHEEL_RING) >> 1;      // clear of the hub, short of the icons
    const k = L.dist > reach ? reach / L.dist : 1;    // 1:1 until it would reach an icon
    const kx = Math.round(L.cx + L.dx * k), ky = Math.round(L.cy + L.dy * k);
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(kx - 2, ky - 2, 5, 5);
    ctx.fillStyle = live ? '#ffd95c' : '#8fa4c8'; ctx.fillRect(kx - 1, ky - 1, 3, 3);
  }

  // the hub: the hole the wedges leave, and the cancel target. It carries a
  // cross rather than the word CANCEL, and goes hot while the pointer is in it
  // - which is where the pointer starts, so the way out is the way you came in.
  function drawWheelHub(L) {
    const cancel = L.seg < 0;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, WHEEL_HUB - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = cancel ? '#3a1f2c' : '#0e142c';
    ctx.fill();
    ctx.strokeStyle = cancel ? '#ff8a7a' : '#2a3358';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = cancel ? '#ff8a7a' : '#46527a';
    for (let d = -3; d <= 3; d++) { // rasterised, so the cross stays crisp
      ctx.fillRect(L.cx + d, L.cy + d, 1, 1);
      ctx.fillRect(L.cx + d, L.cy - d, 1, 1);
    }
  }

  function renderWheel(now) {
    const L = wheelLayout();
    const w = state.wheel;
    // backing disc
    ctx.fillStyle = 'rgba(6,10,24,0.6)';
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, WHEEL_R + WHEEL_PAD, 0, Math.PI * 2);
    ctx.fill();

    const n = L.n, span = L.span;
    const gap = WHEEL_GAP / WHEEL_R / 2; // half a rim-width gap, as an angle
    for (let i = 0; i < n; i++) {
      const opt = L.opts[i];
      const hovered = i === L.seg;
      // an annulus sector: exactly span wide, from the hub out to the rim, so
      // every wedge is the same size and shape however many there are
      const a0 = opt.ang - span / 2 + gap, a1 = opt.ang + span / 2 - gap;
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, WHEEL_R, a0, a1);
      ctx.arc(L.cx, L.cy, WHEEL_HUB, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = hovered ? '#35426e' : '#141c3c';
      ctx.fill();
      if (hovered) {
        ctx.strokeStyle = '#ffd95c';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const ix = L.cx + Math.cos(opt.ang) * WHEEL_RING;
      const iy = L.cy + Math.sin(opt.ang) * WHEEL_RING;
      if (w.kind === 'build') {
        const affordable = canAfford(STRUCTS[opt.id].tiers[0].cost);
        const tb = SPRITES.teamBuild[player.team];
        const spr = (tb.icon && tb.icon[opt.id]) || tb[opt.id][0];
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

    drawWheelHub(L);
    drawWheelStick(L);

    // hovered label + cost under the wheel (or CANCEL, from inside the hub)
    let label = 'CANCEL', color = '#9fb6d8';
    if (L.seg >= 0) {
      const opt = L.opts[L.seg];
      const o = structOf(objAt(w.tx, w.ty));
      if (w.kind === 'build') {
        const t0 = STRUCTS[opt.id].tiers[0];
        label = STRUCTS[opt.id].name + ' : ' + costText(t0.cost);
        color = canAfford(t0.cost) ? '#ffd95c' : '#ff8a7a';
      } else if (opt.id === 'upgrade') {
        if (!o || o.tier >= STRUCTS[o.type].tiers.length - 1) { label = 'MAX TIER'; color = '#9fb6d8'; }
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
    // centred under the wheel, but never off the edge: the wheel sits where the
    // stump is, and a wide cost line is wider than the margin that leaves
    const lw = pixelTextWidth(label);
    drawPixelTextOutline(ctx, label,
      Math.round(Math.max(2, Math.min(VIEW_W - lw - 2, L.cx - lw / 2))),
      Math.round(L.cy + WHEEL_R + WHEEL_PAD + 6), color, '#0f1632');
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

  // ------------------------------------------------------------ replay
  // A rolling four seconds of what was on screen, kept as pixels rather than as
  // state, played back in the bottom-left corner while you are dead or paused.
  //
  // The window is RP_W x RP_H GAME px, but the frame inside it is NOT drawn into
  // the game canvas: those 160x90 canvas pixels can only hold a ninth of a
  // 480x270 view, and no amount of storage fixes that - the detail is gone
  // before it is drawn. The same corner of the SCREEN is RP_W*devScale wide
  // (640 device px at a 1080p fullscreen's 4x), which is more pixels than the
  // view itself has, so the frame goes to its own device-resolution canvas
  // (#replay) laid over that rect, and the game canvas draws only the plate,
  // the rim, the playhead and a low-res copy underneath (which keeps the
  // feature legible in a plain canvas.toDataURL() capture). At a fullscreen
  // zoom the capture is 1:1 with the view and nothing is resampled at all.
  //
  // Capture is one drawImage every 1/RP_FPS s while you are alive, straight off
  // the finished world pass - never a getImageData / toDataURL readback, and
  // nothing allocated per frame.
  const RP_W = 160, RP_H = 90;    // the window, in GAME px: 16:9, a third of the view
  const RP_SECS = 4;              // seconds held
  const RP_FPS = 30;              // frames captured per second -> 15fps on screen at RP_RATE
  const RP_RATE = 0.5;            // playback speed
  const RP_N = RP_SECS * RP_FPS;  // slots in the ring
  const RP_COLS = 12;             // atlas grid; RP_N / RP_COLS rows
  const RP_PAD = 4;               // inset from the bottom-left corner
  // the biggest slot the ring will ever allocate, and so the memory ceiling:
  // RP_CAP_W * RP_CAP_H * 4 * RP_N bytes (480x270 -> 62 MB). It is exactly the
  // view a 1080p or 4K fullscreen renders, so those capture 1:1; a window wide
  // enough to render more than this loses the excess, which the corner could
  // not have shown anyway.
  const RP_CAP_W = 480, RP_CAP_H = 270;

  // the device-resolution layer: sized and placed over the window's rect by
  // layoutReplay(), which relayout() calls on every canvas-size change
  const rpOv = document.getElementById('replay');
  const rpOvx = rpOv.getContext('2d');

  // The ring is one atlas canvas of RP_N slots. Slots are square-off cells of
  // rpSW x rpSH; each frame records the size it was actually captured at, so a
  // resize changes what the NEXT frames look like without invalidating - or
  // rescaling - the ones already banked. The atlas only ever grows.
  let rpAt = null, rpAtx = null;
  let rpSW = 0, rpSH = 0;                  // current slot size
  const rpFW = new Int16Array(RP_N);       // per-frame captured size (0 = empty slot)
  const rpFH = new Int16Array(RP_N);

  let rpHead = 0;     // slot the next capture goes in
  let rpCount = 0;    // slots filled, <= RP_N
  let rpAcc = 0;      // seconds banked toward the next capture
  let rpPlay = 0;     // playhead, in frames
  let rpLast = 0;     // previous render's clock; the delta for both timers
  let rpOpen = false; // was the window up last frame (a fresh open restarts the loop)
  let rpVis = false, rpAlpha = -1, rpOvW = 0, rpOvH = 0; // last state pushed to the overlay

  // What to capture at, this frame: the view itself, clipped by what the corner
  // can actually show (its device-pixel size) and by the memory ceiling. Never
  // an upscale - blowing the view up would cost memory and add no detail.
  function rpTarget() {
    const s = Math.min(1, (RP_W * devScale) / VIEW_W, (RP_H * devScale) / VIEW_H,
      RP_CAP_W / VIEW_W, RP_CAP_H / VIEW_H);
    return [Math.max(1, Math.round(VIEW_W * s)), Math.max(1, Math.round(VIEW_H * s))];
  }

  function rpSlotAt(i, sw, sh) { return [(i % RP_COLS) * sw, ((i / RP_COLS) | 0) * sh]; }

  // Grow the atlas so a w x h frame fits a slot, carrying every banked frame
  // over at its own resolution. Only a resize or a zoom that raises devScale
  // gets here, and only ever upward, so a window being dragged about does not
  // reallocate on every step - and no frame is ever dropped for it.
  function rpEnsure(w, h) {
    if (rpAt && w <= rpSW && h <= rpSH) return;
    const nw = Math.max(w, rpSW), nh = Math.max(h, rpSH);
    const cv = document.createElement('canvas');
    cv.width = nw * RP_COLS;
    cv.height = nh * Math.ceil(RP_N / RP_COLS);
    const cx = cv.getContext('2d');
    // the capture is a reduction whenever the view outruns the corner, and
    // nearest would sample 1px in 9 there - an arrow in flight would strobe
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'medium';
    cx.fillStyle = '#06091a';
    cx.fillRect(0, 0, cv.width, cv.height); // slots are opaque before they are filled
    if (rpAt) {
      for (let i = 0; i < RP_N; i++) {
        if (!rpFW[i]) continue;
        const o = rpSlotAt(i, rpSW, rpSH), n = rpSlotAt(i, nw, nh);
        cx.drawImage(rpAt, o[0], o[1], rpFW[i], rpFH[i], n[0], n[1], rpFW[i], rpFH[i]);
      }
    }
    rpAt = cv; rpAtx = cx; rpSW = nw; rpSH = nh;
  }

  // Recording runs exactly while the local slot is alive and the sim is
  // stepping - the same condition update() plays on. The overlays that freeze
  // the sim would otherwise pack the ring with copies of one still frame, and
  // death freezes the strip on the four seconds that led to it. The map does
  // not freeze anything, and the capture point is above its dim, so the ring
  // keeps banking clean world frames while the chart is up.
  function replayLive() {
    return state.mode === 'play' && !state.paused && !state.settingsOpen &&
      player.active && !player.dead;
  }

  // up on the death planks and on pause, never under a full-screen panel
  function replayShowing() {
    if (!rpCount || window.DBG.hideUI || state.mapOpen || state.settingsOpen) return false;
    if (state.paused) return true;
    // not over a win: the victory screen is a composition, and the window sits
    // exactly where its tally does
    return state.mode === 'dead' && state.over !== 'won' && state.deadView === 'menu' && deadReady();
  }

  // px the event feed lifts to clear the window
  function replayLift() { return replayShowing() ? RP_H + 4 : 0; }

  // the overlay tracks the game canvas: same corner, same scale, device pixels
  function layoutReplay() {
    const r = canvas.getBoundingClientRect();
    rpOv.style.left = (r.left + RP_PAD * scale) + 'px';
    rpOv.style.top = (r.top + (VIEW_H - RP_H - RP_PAD) * scale) + 'px';
    rpOv.style.width = (RP_W * scale) + 'px';
    rpOv.style.height = (RP_H * scale) + 'px';
  }

  // one call per frame from render(), at the capture point: it owns the clock,
  // and either banks a frame or advances the playhead - never both
  function replayTick(now) {
    const dt = rpLast ? Math.min(0.05, now - rpLast) : 0;
    rpLast = now;
    if (replayLive()) {
      rpOpen = false;
      rpAcc += dt;
      if (rpAcc < 1 / RP_FPS) return;
      // carry the remainder so the cadence averages out, but never bank more
      // than one period of debt: below RP_FPS that would spiral
      rpAcc = Math.min(rpAcc - 1 / RP_FPS, 1 / RP_FPS);
      const [cw, ch] = rpTarget();
      rpEnsure(cw, ch);
      const [sx, sy] = rpSlotAt(rpHead, rpSW, rpSH);
      // the slot may be wider than this frame (a shrunk view after a resize):
      // clear it so the last tenant does not fringe the new one
      rpAtx.fillStyle = '#06091a';
      rpAtx.fillRect(sx, sy, rpSW, rpSH);
      rpAtx.drawImage(canvas, sx, sy, cw, ch);
      rpFW[rpHead] = cw; rpFH[rpHead] = ch;
      rpHead = (rpHead + 1) % RP_N;
      if (rpCount < RP_N) rpCount++;
      return;
    }
    if (!replayShowing()) { rpOpen = false; return; }
    if (!rpOpen) { rpOpen = true; rpPlay = 0; } // every open starts four seconds back
    rpPlay += dt * RP_FPS * RP_RATE;
    if (rpPlay >= rpCount) rpPlay -= Math.floor(rpPlay / rpCount) * rpCount;
  }

  // the overlay's whole public surface: shown/hidden and faded with the screen,
  // and touched only when something actually changed
  function rpOverlay(on, a) {
    if (on !== rpVis) {
      rpVis = on;
      rpOv.style.display = on ? 'block' : 'none';
      if (on) layoutReplay();
    }
    if (on && a !== rpAlpha) { rpAlpha = a; rpOv.style.opacity = a; }
  }

  // Bottom-left: the strip on a frost plate, a playhead sweeping the bottom rim.
  // No label - a looping window under a sweeping playhead is what a recording
  // looks like, and the half speed reads itself.
  function renderReplay() {
    if (!replayShowing()) { rpOverlay(false, 1); return; }
    const x = RP_PAD, y = VIEW_H - RP_H - RP_PAD;
    const i = Math.min(rpCount - 1, Math.max(0, Math.floor(rpPlay)));
    const slot = (rpHead - rpCount + i + RP_N) % RP_N;
    const [sx, sy] = rpSlotAt(slot, rpSW, rpSH);
    const fw = rpFW[slot], fh = rpFH[slot];
    ctx.fillStyle = '#0a0e23';
    ctx.fillRect(x - 2, y - 2, RP_W + 4, RP_H + 4);
    // the low-res copy in the game canvas: the overlay covers it exactly, so
    // this is only ever seen in a raw canvas capture or if the layer is off
    if (fw) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(rpAt, sx, sy, fw, fh, x, y, RP_W, RP_H);
      ctx.imageSmoothingEnabled = false;
    }
    // the pale frost rim every other plate in the UI wears
    ctx.fillStyle = '#35426e';
    ctx.fillRect(x - 1, y - 1, RP_W + 2, 1);
    ctx.fillRect(x - 1, y + RP_H, RP_W + 2, 1);
    ctx.fillRect(x - 1, y - 1, 1, RP_H + 2);
    ctx.fillRect(x + RP_W, y - 1, 1, RP_H + 2);
    // playhead along the bottom rim: where the loop is, and the only thing that
    // says this corner is a recording rather than a second camera
    ctx.fillStyle = '#c89a3c';
    ctx.fillRect(x - 1, y + RP_H, Math.round((RP_W + 2) * Math.min(1, rpPlay / rpCount)), 1);

    // and the real thing, at device resolution, over the top
    if (!fw) { rpOverlay(false, 1); return; }
    if (rpOvW !== fw || rpOvH !== fh) {
      rpOvW = rpOv.width = fw; rpOvH = rpOv.height = fh;
      rpOvx.imageSmoothingEnabled = false; // resizing a canvas resets ctx state
    }
    rpOvx.drawImage(rpAt, sx, sy, fw, fh, 0, 0, fw, fh); // 1:1, never resampled
    rpOverlay(true, state.fade ? Math.max(0, 1 - state.fade.a) : 1);
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
        else if (o.type === 'spawner' || o.type === 'part') { r = 170; g = 140; b = 220; }
        else { r = 188; g = 200; b = 218; } // stump
      } else if (ground[i] === 2) { r = 58; g = 92; b = 128; } // open water hole
      else if (ground[i] === 1) { r = 145; g = 188; b = 212; } // ice
      else { r = 205; g = 216; b = 232; } // snow
      const j = i * 4;
      d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
    }
    mmCtx.putImageData(mmImg, 0, 0);
  }

  // Every curve of the minimap is rasterised a pixel at a time: canvas arc()
  // anti-aliases, and at game resolution a 1 px rim smeared over two pixels
  // reads as blur. mmRing paints every pixel whose centre lies in [r0, r1)
  // from the disc centre, optionally only between angles a0..a1 (clockwise
  // from a0, in canvas terms), and mmMask(r) is a cached pixel disc used to
  // clip the map view with destination-in instead of an anti-aliased clip().
  function mmRing(g, cx, cy, r0, r1, col, a0, a1) {
    const span = a1 === undefined ? 7 : ((a1 - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const R = Math.ceil(r1);
    g.fillStyle = col;
    for (let py = -R; py <= R; py++) for (let px = -R; px <= R; px++) {
      const dx = px + 0.5, dy = py + 0.5, d = Math.hypot(dx, dy);
      if (d < r0 || d >= r1) continue;
      if (a1 !== undefined) {
        const a = ((Math.atan2(dy, dx) - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (a > span) continue;
      }
      g.fillRect(cx + px, cy + py, 1, 1);
    }
  }
  const mmMasks = new Map();
  function mmMask(r) {
    let m = mmMasks.get(r);
    if (!m) {
      m = document.createElement('canvas'); m.width = m.height = r * 2;
      mmRing(m.getContext('2d'), r, r, 0, r, '#000');
      mmMasks.set(r, m);
    }
    return m;
  }
  const mmView = document.createElement('canvas'); // the clipped map view, rebuilt each frame
  const mmViewCtx = mmView.getContext('2d');

  function renderMinimap(now) {
    updateMinimap();
    const vp = viewPlayer();
    const ptx = vp.x / TILE, pty = vp.y / TILE;
    const s = mmScale(); // px per tile: the wheel over the disc changes it
    const hov = overMinimap() && state.mode === 'play' && !state.mapOpen && !state.settingsOpen && !state.wheel;

    // silhouette: an opaque dark disc under everything, rimmed by a pale line
    // so the whole control reads as one solid shape on the snow
    mmRing(ctx, MM_CX, MM_CY, MM_R + 7, MM_R + 8, hov ? '#9aa8d0' : '#6f7ca8');
    mmRing(ctx, MM_CX, MM_CY, 0, MM_R + 7, '#0f1632');

    // pixel-clipped map view centered on the player
    const half = MM_R / s; // tiles from the centre to the edge
    if (mmView.width !== MM_R * 2) { mmView.width = mmView.height = MM_R * 2; }
    mmViewCtx.imageSmoothingEnabled = false;
    mmViewCtx.globalCompositeOperation = 'source-over';
    mmViewCtx.clearRect(0, 0, MM_R * 2, MM_R * 2);
    mmViewCtx.drawImage(mmCv, ptx - half, pty - half, half * 2, half * 2, 0, 0, MM_R * 2, MM_R * 2);
    mmViewCtx.globalCompositeOperation = 'destination-in';
    mmViewCtx.drawImage(mmMask(MM_R), 0, 0);
    ctx.drawImage(mmView, MM_CX - MM_R, MM_CY - MM_R);
    // the other slots, in team colour, wherever they fall inside the view. A
    // rival buried past PRONE_MAP drops off it entirely - a dot that survived
    // the cover would make the whole thing pointless. Your own side never does.
    for (const p of players) {
      if (p === vp || !p.active || p.dead || inAir(p)) continue;
      if (p.team !== vp.team && concealOf(p) >= PRONE_MAP) continue;
      const dx = (p.x / TILE - ptx) * s, dy = (p.y / TILE - pty) * s;
      if (Math.hypot(dx, dy) > MM_R - 1) continue;
      ctx.fillStyle = '#0f1632';
      ctx.fillRect(Math.round(MM_CX + dx) - 2, Math.round(MM_CY + dy) - 2, 4, 4);
      ctx.fillStyle = TEAMS[p.team].mark;
      ctx.fillRect(Math.round(MM_CX + dx) - 1, Math.round(MM_CY + dy) - 1, 2, 2);
    }
    // named places, glyph only - a name would not fit inside the disc (the
    // world map and the arrival toast are where they are read by name)
    for (const L of landmarks) {
      const dx = (L.tx + 0.5 - ptx) * s, dy = (L.ty + 0.5 - pty) * s;
      if (Math.hypot(dx, dy) > MM_R - 2) continue;
      drawLandmarkIcon(ctx, L, MM_CX + dx, MM_CY + dy, L.spec.mark, '#0f1632');
    }
    // the centre dot: white for you, the team colour for a slot you are watching
    ctx.fillStyle = '#0f1632';
    ctx.fillRect(MM_CX - 2, MM_CY - 2, 4, 4);
    ctx.fillStyle = vp === player ? '#ffffff' : TEAMS[vp.team].mark;
    ctx.fillRect(MM_CX - 1, MM_CY - 1, 2, 2);

    // day/night cycle ring: a 3 px band of pixels, the elapsed part painted
    // clockwise from 12 o'clock in the day colour, then the night colour
    const prog = state.time / CYCLE;
    const dayFrac = DAY_LEN / CYCLE;
    const a0 = -Math.PI / 2; // start at 12 o'clock
    const r0 = MM_R + 2, r1 = MM_R + 5;
    mmRing(ctx, MM_CX, MM_CY, r0, r1, '#2a3358'); // track
    if (prog > 0) mmRing(ctx, MM_CX, MM_CY, r0, r1, '#ffd95c', a0, a0 + Math.min(prog, dayFrac) * Math.PI * 2);
    if (prog > dayFrac) mmRing(ctx, MM_CX, MM_CY, r0, r1, '#7a90d8', a0 + dayFrac * Math.PI * 2, a0 + prog * Math.PI * 2);
    // dusk boundary tick: one pixel column across the band, a little past it
    const ba = a0 + dayFrac * Math.PI * 2;
    mmRing(ctx, MM_CX, MM_CY, r0 - 1, r1 + 1, '#8f9cc4', ba - 0.03, ba + 0.03);
    // progress tip: a 3x3 pixel block on the band
    const ta = a0 + prog * Math.PI * 2;
    const pulse = state.darkness > 0.5 ? (Math.sin(now * 6) * 0.15 + 0.85) : 1;
    ctx.fillStyle = state.darkness > 0.5 ? '#cfd8f2' : '#fff2b0';
    ctx.globalAlpha = pulse;
    ctx.fillRect(Math.round(MM_CX + Math.cos(ta) * (r0 + 1)) - 1, Math.round(MM_CY + Math.sin(ta) * (r0 + 1)) - 1, 3, 3);
    ctx.globalAlpha = 1;

    // beneath the minimap, one centred row: slots still in the match (a pixel
    // figure + the count, no label) then the elapsed play-time. Clear of the
    // fps readout, which owns the extreme top-right corner.
    const clock = clockTxt(state.elapsed);
    const alive = String(aliveCount());
    const rowW = ALIVE_ICON_W + 2 + pixelTextWidth(alive) + 7 + pixelTextWidth(clock);
    let rx = Math.round(MM_CX - rowW / 2);
    const ry = MM_CY + MM_R + 9;
    drawAliveIcon(rx, ry - 1, '#f4f7ff', '#0f1632');
    rx += ALIVE_ICON_W + 2;
    drawPixelTextOutline(ctx, alive, rx, ry, '#f4f7ff', '#0f1632');
    rx += pixelTextWidth(alive) + 7;
    drawPixelTextOutline(ctx, clock, rx, ry, '#f4f7ff', '#0f1632');
  }

  // the "players left" glyph: a hooded figure, 5x7, stamped with the same 1px
  // rim the outline font uses so it reads on snow beside the count
  const ALIVE_ICON = [
    '.###.',
    '#####',
    '#.#.#',
    '.###.',
    '#####',
    '#####',
    '#...#',
  ];
  const ALIVE_ICON_W = 5;
  function drawAliveIcon(x, y, color, outline) {
    const stamp = (ox, oy, c) => {
      ctx.fillStyle = c;
      for (let r = 0; r < ALIVE_ICON.length; r++)
        for (let q = 0; q < ALIVE_ICON_W; q++)
          if (ALIVE_ICON[r][q] === '#') ctx.fillRect(x + q + ox, y + r + oy, 1, 1);
    };
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox || oy) stamp(ox, oy, outline);
    stamp(0, 0, color);
  }

  // ---- gear row: four plates bottom-right, head to toe, keys 1-4 -----------
  // Each plate is a piece: its icon wears the material of its level (the
  // sprites' leather -> iron -> steel -> gold), pips under the icon count the
  // buys, a 1px meter under the plate fills as the purse approaches the next
  // cost, and an affordable piece grows a bobbing gold chevron - the ask to
  // spend, League-style. Hover lifts the plate and shows the cost; a click or
  // the piece's number key buys through input.cmd (see the input banner).
  const GEAR_PLATE = 18, GEAR_GAP = 3;
  function gearRects() {
    const w = GEAR_SLOTS.length * GEAR_PLATE + (GEAR_SLOTS.length - 1) * GEAR_GAP;
    const x0 = VIEW_W - 8 - w, y0 = VIEW_H - 9 - GEAR_PLATE; // the saving meter rides 1px below the plates
    const rs = [];
    for (let i = 0; i < GEAR_SLOTS.length; i++) rs.push({ x: x0 + i * (GEAR_PLATE + GEAR_GAP), y: y0, w: GEAR_PLATE, h: GEAR_PLATE });
    return rs;
  }
  // which plate the pointer is on, or -1; shared by the click handler, the
  // cursor and the row's own hover so they can never disagree
  function gearHit(mx, my) {
    if (state.mode !== 'play' || player.dead || state.paused ||
        state.mapOpen || state.settingsOpen || state.wheel || window.DBG.hideUI) return -1;
    const rs = gearRects();
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (mx >= r.x && mx < r.x + r.w && my >= r.y - 1 && my < r.y + r.h + 3) return i;
    }
    return -1;
  }
  function drawGearRow(now) {
    if (player.dead) return;
    const rs = gearRects();
    const hov = mouse.inside ? gearHit(mouse.x, mouse.y) : -1;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i], lv = player.gearLv[i], cost = gearCost(player, i);
      const afford = cost && player.inv.gold >= cost.gold;
      const y = r.y - (hov === i ? 1 : 0); // the plank lift
      // a maxed piece goes quiet behind a gold rim; a hovered one brightens
      ctx.fillStyle = !cost ? '#8a7a3a' : hov === i ? '#8fa0c8' : '#35426e';
      ctx.fillRect(r.x, y, r.w, r.h);
      ctx.fillStyle = '#0f1632';
      ctx.fillRect(r.x + 1, y + 1, r.w - 2, r.h - 2);
      ctx.drawImage(SPRITES.gearIcons[i][player.gear[i]][lv - 1], r.x + 3, y + 2);
      for (let k = 0; k < GEAR_LV_MAX - 1; k++) { // buy pips under the icon
        ctx.fillStyle = k < lv - 1 ? '#f2cc6a' : '#2c3560';
        ctx.fillRect(r.x + 3 + k * 4, y + r.h - 3, 3, 1);
      }
      if (cost) { // the saving meter: how close the purse is to the next level
        const frac = Math.min(1, player.inv.gold / cost.gold);
        ctx.fillStyle = '#26305a';
        ctx.fillRect(r.x, r.y + r.h + 1, r.w, 1);
        ctx.fillStyle = afford ? '#f5c542' : '#8a7a3a';
        ctx.fillRect(r.x, r.y + r.h + 1, Math.round(r.w * frac), 1);
      }
      if (afford) { // the ask: two gold carets bobbing over the plate
        const bob = Math.round(Math.sin(now * 6));
        const cx = r.x + (r.w >> 1);
        const px = [[0, 0], [-1, 1], [1, 1], [-2, 2], [2, 2]];
        for (const [off, col] of [[1, '#0f1632'], [0, '#f5c542']]) {
          ctx.fillStyle = col;
          for (const [dx, dy] of px) {
            ctx.fillRect(cx + dx + off, y - 10 + bob + dy + off, 1, 1);
            ctx.fillRect(cx + dx + off, y - 6 + bob + dy + off, 1, 1);
          }
        }
      }
      if (hov === i && cost) { // hover: the price, coin + number, nothing else
        const txt = String(cost.gold);
        const tw = 10 + pixelTextWidth(txt);
        const tx0 = Math.min(r.x + (r.w >> 1) - (tw >> 1), VIEW_W - 4 - tw);
        ctx.drawImage(SPRITES.itemGold, tx0, y - 22);
        drawPixelTextOutline(ctx, txt, tx0 + 10, y - 20, afford ? '#f5c542' : '#9fb6d8', '#0f1632');
      }
    }
  }

  // ---- quiver strip: the ammo readout, bottom-centre ----------------------
  // The bow's whole economy in one control, built out of the same arrow the
  // world is full of: a lit pip is an arrow you have, a dark one is an arrow you
  // spent, and the pip on the boundary re-forms from the nock upward as it is
  // fletched - so the fact that arrows come back is something you watch happen,
  // not something you are told. Under it, one gold rule sweeps the strip while
  // the renock runs and lands white the instant the bow is ready: the cooldown,
  // drawn where the count already is. Pressing an empty bow shakes it red.
  // The fletching is the local team's colour, the same colour that is on every
  // shaft in the snow, which is what ties the two halves of the system together.
  // The pip is drawn on the DIAGONAL, and that is the whole reason it reads. An
  // upright arrow this small is a vertical stroke with a bar across it - i.e. a
  // dagger - however the head and feathers are shaped; every upright variant
  // tried came out as a cross or an anchor. On the slant the shaft is a solid
  // staircase with a wedge head and a fletched tail, which is what an arrow
  // looks like in this game anyway: the ones in the snow are never upright
  // either. `#` is shaft, `=` is fletching (the local team's colour).
  const QUIVER_PIP = [
    '##.....',
    '###....',
    '.###...',
    '..###..',
    '...###.',
    '....##.',
    '...=.##',
    '..==.==',
    '...=...',
  ];
  const QP_W = 7, QP_H = 9, QP_GAP = 3;
  function quiverRect() {
    const w = QUIVER_MAX * (QP_W + QP_GAP) - QP_GAP;
    return { x: Math.round((VIEW_W - w) / 2), y: VIEW_H - 25, w, h: QP_H };
  }
  // one pip. `fill` (0..1) draws it from the nock up, so a fletching arrow grows
  // into its slot instead of blinking into existence.
  function drawQuiverPip(x, y, fill, shaft, fletch, dim) {
    const cut = Math.ceil((1 - fill) * QP_H);
    for (let r = 0; r < QP_H; r++) {
      const row = QUIVER_PIP[r];
      for (let q = 0; q < QP_W; q++) {
        const ch = row[q];
        if (ch === '.') continue;
        ctx.fillStyle = r < cut ? dim : ch === '=' ? fletch : shaft;
        ctx.fillRect(x + q, y + r, 1, 1);
      }
    }
  }
  function drawQuiver(now) {
    const R = quiverRect();
    const x0 = R.x + (player.dryT > 0 ? (((now * 30) | 0) % 2 ? 1 : -1) : 0); // the empty-press shake
    const hot = player.quiverFlash > 0 || player.readyFlash > 0;
    const shaft = hot ? '#ffffff' : '#e8dcb4';
    const fletch = hot ? '#ffffff' : TEAMS[player.team].mark;
    // an empty press reddens the SLOTS, not the arrows: painting the glyphs red
    // reads as six red arrows, which is the opposite of what happened
    const dim = player.dryT > 0 ? '#5d2a34' : '#2a3358';
    const plate = player.dryT > 0 ? 'rgba(74,18,28,0.85)' : 'rgba(12,18,42,0.78)';
    for (let i = 0; i < QUIVER_MAX; i++) {
      const x = x0 + i * (QP_W + QP_GAP);
      ctx.fillStyle = plate;
      ctx.fillRect(x - 1, R.y - 1, QP_W + 2, QP_H + 2);
      const fill = i < player.quiver ? 1
        : i === player.quiver ? player.fletchT / QUIVER_REGEN : 0;
      drawQuiverPip(x, R.y, fill, shaft, fletch, dim);
    }
    if (player.nockT > 0 || player.readyFlash > 0) {
      const frac = player.readyFlash > 0 ? 1 : 1 - player.nockT / Math.max(0.01, kitOf(player).nock);
      const by = R.y + QP_H + 3;
      ctx.fillStyle = 'rgba(12,18,42,0.78)';
      ctx.fillRect(x0 - 1, by - 1, R.w + 2, 4);
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(x0, by, R.w, 2);
      ctx.fillStyle = player.readyFlash > 0 ? '#f4f7ff' : '#ffd95c';
      ctx.fillRect(x0, by, Math.max(1, Math.round(R.w * frac)), 2);
    }
  }

  function renderUI(now) {
    if (state.mode === 'title' || state.mode === 'drop' || window.DBG.hideUI) return;
    if (state.mode === 'dead' && state.over === 'won') return; // the victory screen owns the frame

    // title -> play: the HUD slides in over the last part of the intro - the
    // left stack from the left, the minimap stack from the top, messages from below
    const hudIn = state.intro > 0 ? easeOut(Math.max(0, 1 - state.intro / HUD_IN_T)) : 1;
    const slide = 1 - hudIn;
    ctx.save();
    ctx.translate(Math.round(-slide * 60), 0);

    const out = state.mode === 'dead'; // the local wallet is moot once you are out
    // berries: consumable indicator, top-left (health lives on the in-world bar)
    if (inv.berry > 0 && !out) {
      ctx.drawImage(SPRITES.itemBerry, 5, 5);
      drawPixelTextOutline(ctx, String(inv.berry), 15, 7, '#f4f7ff', '#0f1632');
      drawPixelTextOutline(ctx, '(Q)', 17 + pixelTextWidth(String(inv.berry)), 7, '#9fb6d8', '#0f1632');
    }
    // fish: the bigger meal, right below the berries
    if (inv.fish > 0 && !out) {
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
    if (out) res.length = 0;
    for (const [spr, n] of res) {
      ctx.drawImage(SPRITES[spr], rx, ryTop);
      drawPixelTextOutline(ctx, String(n), rx + 10, ryTop + 2, '#f4f7ff', '#0f1632');
      rx += 10 + pixelTextWidth(String(n)) + resGap;
    }

    // minimap with day/night ring
    renderMinimap(now);
    ctx.restore();

    // gear plates, bottom-right; they ride the intro slide in from the right
    ctx.save();
    ctx.translate(Math.round(slide * 60), 0);
    drawGearRow(now);
    ctx.restore();

    // quiver strip, bottom-centre; it rides the intro slide up from below
    if (!out) {
      ctx.save();
      ctx.translate(0, Math.round(slide * 40));
      drawQuiver(now);
      ctx.restore();
    }

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
    let y = VIEW_H - 8 - replayLift() - pitch * n; // oldest at the top, newest along the bottom
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
          drawPixelTextShadow(ctx, 'OUT', x + 18 + pixelTextWidth(p.name), ry + 1, '#8f9cc4', shadow);
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
        else if (o && (o.type === 'spawner' || o.type === 'part')) { r = 128; g = 104; b = 160; }
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
      (WV_W / TILE) * MAP_S - 1, (WV_H / TILE) * MAP_S - 1);

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
      if (p.team !== player.team && concealOf(p) >= PRONE_MAP) continue; // buried: off the map, same as the minimap
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
  // settings panel and the main menu's TUTORIAL panel so they read as a set.
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
    drawPixelText(g, 'INFO DISPLAY', 14, ROW_INFO - SET_Y, L);
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
      [['WASD', 'MOVE'], ['SPACE', 'DODGE'], ['CTRL', 'SNEAK'], ['CLICK', 'BOW'], ['E', 'HARVEST'], ['Q', 'EAT BERRY'], ['F', 'EAT FISH']],
      [['M', 'WORLD MAP'], ['N', 'MUTE'], ['P', 'PAUSE'], ['ESC', 'SETTINGS'], ['SCROLL', 'ZOOM'], ['F3', 'INFO'], ['.', 'HITBOX']],
    ];
    for (let c = 0; c < 2; c++) {
      let y = 137; // seven rows a column now that CTRL is one: start a little higher so the last one still clears ESC CLOSE
      const x0 = c === 0 ? 16 : 128;
      for (const [k, desc] of cols[c]) {
        drawPixelText(g, k, x0, y, '#ffd95c');
        drawPixelText(g, desc, x0 + (c === 0 ? 36 : 26), y, '#7a8bb8');
        y += 10;
      }
    }
    // close hint
    const hint = 'ESC CLOSE';
    drawPixelText(g, hint, Math.round((SET_W - pixelTextWidth(hint)) / 2), 208, '#5a6690');
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
    if (inRow(ROW_INFO)) return 'info';
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
    else if (hit === 'info') settings.info = !settings.info;
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
    drawToggleRow(ROW_INFO, settings.info);
    drawToggleRow(ROW_CURSOR, settings.pixelCursor, 'PIXEL', 'BROWSER');
    if (slide) ctx.restore();
  }

  // ------------------------------------------------------------ main menu
  // The title screen is a real menu over the living world: the camera drifts
  // around the interior while animals, fish and snow keep running, the items
  // (SINGLEPLAYER / MULTIPLAYER / TUTORIAL / SETTINGS / the reroll die) take
  // mouse or arrows+enter, and every mode change is a transition rather than a cut.
  const INTRO_T = 1.6;    // title -> play: tint dissolves, camera settles, HUD slides in
  const HUD_IN_T = 0.7;   // the HUD slide occupies the last part of the intro
  const PANEL_SLIDE_T = 0.32;
  const MENU_ITEMS = ['SINGLEPLAYER', 'MULTIPLAYER', 'TUTORIAL', 'SETTINGS'];
  const MENU_FROZEN = 1; // multiplayer is sealed under ice until it exists: inert to hover, keys and clicks
  const MENU_BW = 112, MENU_BH = 20, MENU_PITCH = 26;
  const MENU_Y0 = 100;    // first plank, in the 270-tall authored frame; the seed row follows the last plank
  const PATCH_TXT = 'PATCH 1.38'; // printed bottom-right of the title screen; click it for the notes
  // one sentence per patch, newest first - the biggest change only, in plain english
  const PATCH_NOTES = [
    ['1.38', 'THE . KEY DRAWS EVERY HITBOX IN THE WORLD - THE CIRCLES AND BOXES THE GAME ACTUALLY TESTS - AND A SECOND PRESS ADDS EVERY REACH AND SIGHT RANGE ON TOP.'],
    ['1.37', 'THE CAMERA ZOOMS FURTHER IN AND OUT IN FINER STEPS AND GLIDES BETWEEN THEM, ALWAYS SETTLING WHERE THE PIXELS LAND EXACTLY, AND ZOOMING NO LONGER RESIZES THE HUD - ONLY THE WORLD.'],
    ['1.36', 'OPENING THE MAP NO LONGER STOPS THE WORLD - THE MATCH RUNS ON WHILE YOU READ IT, AND YOU CAN KEEP WALKING WITH IT UP.'],
    ['1.35', 'CTRL LIES YOU DOWN IN THE SNOW AND PULLS IT OVER YOU: ALMOST NOBODY CAN SEE YOU, YOU CAN ONLY BELLY-CRAWL, AND THE ARROW YOU LOOSE OUT OF COVER HITS FOR TWO AND A HALF TIMES.'],
    ['1.34', 'ARROWS ARE A QUIVER NOW: EVERY SHOT SPENDS ONE AND TAKES A MOMENT TO RENOCK, AND EVERY ARROW THAT LANDS STICKS IN THE SNOW TO BE PICKED BACK UP.'],
    ['1.33', 'WINNING NOW GETS A REAL VICTORY SCREEN - CROWN, BANNERS, AURORA AND THE NUMBERS FROM YOUR RUN - AND THE LAST TEAM STANDING WINS, NOT THE LAST PLAYER.'],
    ['1.32', 'HOUSEKEEPING: THE DEV NOTES LEARN THE GEAR SYSTEM AND FOUR STALE POINTERS NOW MATCH THE GAME; NOTHING IN THE GAME CHANGED.'],
    ['1.31', 'THE F3 READOUT IS NOW A TIDY LABELLED COLUMN IN THE HUD\'S OWN COLOURS, WITH RED SAVED FOR A BAD FRAME RATE.'],
    ['1.30', 'F3 NOW FLIPS ONE INFO READOUT - FPS, YOUR X AND Y, AND THE SEED - IN PLACE OF THE OLD SEPARATE TOGGLES.'],
    ['1.29', 'THE SEED READOUT CAN BE TOGGLED OFF IN SETTINGS, AND FPS AND SEED NOW SHARE ONE SMALL STACK ON THE LEFT EDGE.'],
    ['1.28', 'GEAR GETS ITS OWN FULL PICK SCREEN AFTER CHAMPION SELECT, AND ALL TWELVE PIECES NOW WEAR THEIR OWN ICON.'],
    ['1.27', 'PICK YOUR FOUR GEAR PIECES ON THE CHAMPION SCREEN, AND WORN GEAR NOW SHOWS ON YOUR CHARACTER AS IT LEVELS.'],
    ['1.26', 'GEAR ARRIVES: FOUR PIECES THAT LEVEL UP FOR GOLD FROM ANYWHERE - CLICK THE NEW PLATES BOTTOM-RIGHT OR PRESS 1-4.'],
    ['1.25', 'DYING NOW COSTS THE PURSE: YOUR KILLER POCKETS YOUR GOLD, AN ACCIDENT SPILLS IT ON THE SNOW, AND YOUR FOOD ALWAYS DROPS.'],
    ['1.24', 'THE BUILD WHEEL IS AN EVEN RING WHATEVER IT HOLDS, AND ITS MIDDLE IS NOW A CANCEL BUTTON YOU CAN FIND.'],
    ['1.23', 'ENEMY WORKER BOTS CAN BE SHOT DOWN WITH THE BOW, AND A DOWNED ONE SPILLS THE GOLD IT WAS CARRYING.'],
    ['1.22', 'TURRETS WORK: A BIGGER GUN SWINGS ONTO THE NEAREST ENEMY, LINES UP THE SHOT ALONG A DASHED LINE, AND FIRES A GLOWING BOLT.'],
    ['1.21', 'YOU CAN NOW BREAK AN ENEMY TEAM BUILDING BY HOLDING E BESIDE IT, AND ANY DAMAGED BUILDING SHOWS A HEALTH BAR.'],
    ['1.20', 'THE NIGHT GLOW NOW SITS EXACTLY ON YOU INSTEAD OF DRIFTING A FRACTION OF A PIXEL AS YOU MOVE.'],
    ['1.19', 'HOUSEKEEPING: EIGHT STALE LINES IN THE DEV NOTES NOW MATCH THE GAME; NOTHING IN THE GAME CHANGED.'],
    ['1.18', 'HOUSEKEEPING: THE DEV NOTES GAIN A STANDING FIX LIST FOR STALE DOCUMENTATION; NOTHING IN THE GAME CHANGED.'],
    ['1.17', 'THE FROZEN MULTIPLAYER PLANK SHIMMERS COLD WHEN HOVERED, AND KNOCKING ON IT CRACKS THE ICE - IT ALWAYS REFREEZES.'],
    ['1.16', 'THE MENU IS NOW SINGLEPLAYER, MULTIPLAYER, TUTORIAL, SETTINGS - MULTIPLAYER IS FROZEN IN ICE UNTIL IT ARRIVES.'],
    ['1.15', 'DYING OR PAUSING REPLAYS YOUR LAST FOUR SECONDS ON A LOOP, AT HALF SPEED, IN THE BOTTOM-LEFT CORNER.'],
    ['1.14', 'ARROWS ARE DRAWN PIXEL BY PIXEL, CARRY YOUR TEAM COLOUR ON THE FLETCHING, AND LEAVE A FADING TRAIL.'],
    ['1.13', 'THE MINIMAP IS DRAWN PIXEL BY PIXEL: ITS RIM, MAP EDGE AND DAY RING ARE CRISP.'],
    ['1.12', 'THE SCROLL WHEEL OVER THE MINIMAP ZOOMS IT, AND THE MINIMAP HAS A SOLID RIM.'],
    ['1.11', 'ROBOTS, FLEEING ANIMALS, WOLVES AND BOTS NOW ROUTE AROUND TREES, ROCKS, BUILDINGS AND WATER INSTEAD OF BUMPING INTO THEM.'],
    ['1.10', 'THE GAME IS CALLED SOFTFALL EVERYWHERE NOW; SAVED SETTINGS RESET ONCE.'],
    ['1.09', 'HOUSEKEEPING: THE DEV NOTES OPEN WITH A SHORT PITCH; NOTHING IN THE GAME CHANGED.'],
    ['1.08', 'HOUSEKEEPING: THE DEV NOTES WERE TRIMMED; NOTHING IN THE GAME CHANGED.'],
    ['1.07', 'SPECTATING IS A PAIR OF ARROWS AROUND THE NAME AT THE TOP OF THE SCREEN - NO HINT TEXT.'],
    ['1.06', 'DEATH IS FINAL: YOU SPECTATE OR GO BACK TO THE LOBBY, AND THE HUD COUNTS WHO IS LEFT.'],
    ['1.05', 'THE PATCH NOTES SCROLL, AND THE TITLE HIDES WHILE A PANEL IS OPEN.'],
    ['1.04', 'THE PATCH TAG NOW OPENS THESE NOTES.'],
    ['1.03', 'A FOURTH PLACEHOLDER BUTTON JOINS THE MENU AND THE WHOLE COLUMN SITS HIGHER.'],
    ['1.02', 'THE SEED ROW NO LONGER SHOWS A CAPTION WHEN HOVERED.'],
    ['1.01', 'THE SELECTION ARROWS ARE GONE - A LIT PLANK IS THE CUE.'],
    ['1.00', 'THE GAME IS NOW SOFTFALL, WITH A CINEMATIC TITLE SCREEN OF PILLARS AND BRAZIERS.'],
  ];

  // the patch tag's hit rect (bottom-right); the notes panel opens from it
  function patchTagRect() {
    const w = pixelTextWidth(PATCH_TXT);
    return { x: VIEW_W - w - 5, y: VIEW_H - 9, w, h: 5 };
  }
  function overPatchTag() {
    const r = patchTagRect();
    return mouse.x >= r.x - 3 && mouse.x < r.x + r.w + 3 && mouse.y >= r.y - 3 && mouse.y < r.y + r.h + 3;
  }

  function easeOut(t) { t = Math.max(0, Math.min(1, t)); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function easeInOut(t) { t = Math.max(0, Math.min(1, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // layout was authored for a 270px-tall view; recenter it vertically
  function menuLayout() {
    const toy = Math.round((VIEW_H - 270) / 2);
    const bx = Math.round((VIEW_W - MENU_BW) / 2);
    const rects = MENU_ITEMS.map((_, i) => ({ x: bx, y: toy + MENU_Y0 + i * MENU_PITCH, w: MENU_BW, h: MENU_BH }));
    // the seed row: text + die, one selectable item
    const sw = pixelTextWidth(SEED_TXT) + 6 + 11;
    const sx = Math.round((VIEW_W - sw) / 2);
    rects.push({ x: sx - 3, y: toy + MENU_Y0 + MENU_ITEMS.length * MENU_PITCH + 6, w: sw + 6, h: 13, seed: true });
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
    const N = MENU_ITEMS.length + 1;
    const dir = i >= m.sel ? 1 : -1;
    let n = ((i % N) + N) % N;
    if (n === MENU_FROZEN) n = (((n + dir) % N) + N) % N; // the frozen plank refuses the selection
    if (n === m.sel) return;
    m.sel = n;
    SFX.pickup();
  }

  // knocking on the frozen plank: it shudders, cracks flash from the struck
  // point and heal as it refreezes, and a spray of ice chips falls away
  function iceRefuse() {
    const m = state.menu;
    if (m.iceT > 0.3) return; // still mid-shudder
    const { rects } = menuLayout();
    const r = rects[MENU_FROZEN];
    m.iceT = 0.45;
    m.iceSeed = (m.iceSeed + 1) | 0;
    m.iceX = Math.max(4, Math.min(r.w - 4, mouse.x - r.x));
    m.iceY = Math.max(3, Math.min(r.h - 3, mouse.y - r.y));
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6; // upward fan off the impact
      const sp = 30 + Math.random() * 70;
      m.shards.push({
        x: r.x + m.iceX, y: r.y + m.iceY,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
        life: 0.4 + Math.random() * 0.4, w: Math.random() < 0.3 ? 2 : 1,
        c: ['#e8f4ff', '#a8c8e8', '#f4f7ff'][i % 3],
      });
    }
    SFX.iceKnock();
  }

  function menuActivate(i) {
    if (i === MENU_FROZEN) return; // solid ice - iceRefuse() is the only answer
    SFX.unlock();
    if (i === 0) beginSelect();
    else if (i === 2) openMenuPanel('help');
    else if (i === 3) openMenuPanel('settings');
    else if (i === MENU_ITEMS.length) rerollWorld();
  }

  function openMenuPanel(kind) {
    const m = state.menu;
    m.panel = kind; m.panelT = 0; m.closing = false;
    m.patchScroll = 0;
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
    if (m.screen === 'gear') { if (m.gearT >= 1) gearKey(k); return; }
    if (m.screen === 'select') { if (m.screenT >= 1 && m.gearT <= 0) selectKey(k); return; }
    if (m.panel) {
      if (k === 'escape' || k === 'backspace' || (m.panel !== 'settings' && (k === 'enter' || k === ' '))) closeMenuPanel();
      else if (m.panel === 'patch' && (k === 'arrowup' || k === 'w')) patchScrollBy(-8);
      else if (m.panel === 'patch' && (k === 'arrowdown' || k === 's')) patchScrollBy(8);
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
    if (m.screen === 'gear') { gearClick(); return; }
    if (m.screen === 'select') { selectClick(); return; }
    if (m.panel) {
      if (!menuPanelReady()) return;
      if (m.panel === 'settings' && overMenuPanel()) { mouse.down = true; settingsMouseDown(); return; }
      if (m.panel === 'patch' && overMenuPanel()) { patchPanelClick(mouse.x - SET_X, mouse.y - SET_Y); return; }
      if (!overMenuPanel()) closeMenuPanel();
      return;
    }
    if (overPatchTag()) { openMenuPanel('patch'); return; }
    const h = menuHit();
    if (h < 0) return;
    if (h === MENU_FROZEN) { iceRefuse(); return; }
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
    state.menu.gearT = 0;
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
        try { sessionStorage.setItem('softfall.reroll', '1'); } catch (e) { }
        location.href = location.pathname + '?seed=' + next;
      },
    };
  }

  // slow lissajous drift around the open interior, never into the border forest
  function titleCamTarget() {
    const c = WORLD * TILE / 2;
    const t = state.menu.camT;
    const rx = Math.max(0, (WORLD / 2 - BORDER_MAX - 6) * TILE - WV_W / 2);
    const ry = Math.max(0, Math.min(rx * 0.8, (WORLD / 2 - BORDER_MAX - 6) * TILE - WV_H / 2));
    return {
      x: c + Math.cos(t * 0.045 + 0.7) * rx - WV_W / 2,
      y: c + Math.sin(t * 0.031 + 0.7) * ry - WV_H / 2,
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
      if (h >= 0 && h !== MENU_FROZEN && h !== m.sel) m.sel = h;
    }
    // the frozen plank can't be selected, so its hover ease tracks the pointer instead
    const iceHover = !m.panel && m.screen === 'menu' && menuHit() === MENU_FROZEN ? 1 : 0;
    for (let i = 0; i <= MENU_ITEMS.length; i++) {
      const target = i === MENU_FROZEN ? iceHover : m.sel === i ? 1 : 0;
      m.hover[i] += (target - m.hover[i]) * Math.min(1, dt * 14);
    }
    // the refusal shudder heals and the ice chips fall
    if (m.iceT > 0) m.iceT = Math.max(0, m.iceT - dt);
    for (let i = m.shards.length - 1; i >= 0; i--) {
      const s = m.shards[i];
      s.vy += 260 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) m.shards.splice(i, 1);
    }
    // champion select cross-fade and its own hovers; the gear page rides a
    // second ease (gearT) so select <-> gear cross-fade inside the surface
    const st = m.screen === 'select' || m.screen === 'gear' ? 1 : 0;
    m.screenT = Math.max(0, Math.min(1, m.screenT + (st ? 1 : -1) * dt / 0.35));
    const gt = m.screen === 'gear' ? 1 : 0;
    m.gearT = Math.max(0, Math.min(1, m.gearT + (gt ? 1 : -1) * dt / 0.3));
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
  // hover ease - it lifts and warms; pressed sinks it a px. frozen seals the
  // plank under an ice glaze - heavier icicles, muted label, nothing animates
  function drawMenuButton(r, label, hv, now, pressed, frozen) {
    const a0 = ctx.globalAlpha; // respect the caller's fade (the menu and select screens animate alpha)
    const cold = frozen ? hv : 0; // the frozen plank hovers cold: it chills instead of lifting and warming
    if (frozen) hv = 0;
    const lift = Math.round(hv * 2) - (pressed ? 2 : 0);
    const x = r.x, y = r.y - lift, w = r.w, h = r.h;
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
    // corner rivets (iron, gilt when hot)
    ctx.fillStyle = hv > 0.5 ? '#ffd95c' : '#5a7fb8';
    ctx.fillRect(x + 3, y + 3, 1, 1); ctx.fillRect(x + w - 4, y + 3, 1, 1);
    ctx.fillRect(x + 3, y + h - 4, 1, 1); ctx.fillRect(x + w - 4, y + h - 4, 1, 1);
    // snow cap along the top edge: ragged drift, shaded underside
    for (let px = 2; px < w - 2; px++) {
      const hb = hash2(px * 3 + 5, r.y * 13);
      const sh = 1 + (hb > 0.5 ? 1 : 0) + (hb > 0.85 ? 1 : 0);
      ctx.fillStyle = '#f4f7ff';
      ctx.fillRect(x + px, y + 1 - sh, 1, sh);
      if (hb > 0.3 && hb < 0.5) { ctx.fillStyle = '#b8cce6'; ctx.fillRect(x + px, y + 1, 1, 1); }
    }
    // icicles off the bottom edge, tips glinting when hot; a frozen plank grows them thick
    const ith = frozen ? 0.62 : 0.84;
    for (let px = 4; px < w - 4; px++) {
      const hb = hash2(px * 7 + 1, r.y * 17 + 3);
      if (hb < ith) continue;
      const len = 2 + Math.floor((hb - ith) * (frozen ? 16 : 25)); // 2..5, frozen 2..8
      ctx.fillStyle = '#a8c8e8';
      ctx.fillRect(x + px, y + h, 1, len);
      ctx.fillStyle = '#e8f4ff';
      ctx.fillRect(x + px, y + h, 1, 1);
      if (hv > 0.5 && ((now * 6 + px) | 0) % 5 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + px, y + h + len - 1, 1, 1); }
    }
    // label
    const tw = pixelTextWidth(label, 2);
    const lx = Math.round(x + (w - tw) / 2), ly = y + Math.round((h - 10) / 2) + (pressed ? 1 : 0);
    drawPixelTextShadow(ctx, label, lx, ly, frozen ? '#8fa6c8' : hv > 0.5 ? '#ffd95c' : '#cfe0ff', '#0a0e23', 2);
    if (frozen) {
      const m = state.menu;
      // sealed under a sheet of ice: a pale glaze over everything, rime creeping
      // in from the sides, and static glints - the plank itself never animates.
      // hover wakes the surface: a pale rim, a sheen sweeping the glaze, frost
      // breath rising off the cap. A knock (iceT) flashes cracks that heal shut
      ctx.fillStyle = 'rgba(150,190,230,0.33)'; chamRect(x, y, w, h);
      ctx.fillStyle = 'rgba(232,244,255,0.75)';
      ctx.fillRect(x + 2, y + 1, w - 4, 1);
      ctx.fillStyle = 'rgba(200,224,248,0.45)';
      for (let yy = 2; yy < h - 2; yy++) {
        const rl = 1 + ((hash2(yy * 5 + 3, r.y * 3) * 4) | 0), rr2 = 1 + ((hash2(yy * 9 + 1, r.y * 7) * 4) | 0);
        ctx.fillRect(x + 1, y + yy, rl, 1); ctx.fillRect(x + w - 1 - rr2, y + yy, rr2, 1);
      }
      for (let gx = 4; gx < w - 4; gx += 2) {
        const hb = hash2(gx * 13 + 7, r.y * 5 + 1);
        if (hb > 0.9) { ctx.fillStyle = '#e8f4ff'; ctx.fillRect(x + gx, y + 3 + ((hb * 97) | 0) % (h - 6), 1, 1); }
      }
      if (cold > 0.02) {
        ctx.globalAlpha = a0 * cold * 0.7;
        ctx.fillStyle = '#a8c8e8';
        ctx.fillRect(x + 2, y, w - 4, 1); ctx.fillRect(x + 2, y + h - 1, w - 4, 1);
        ctx.fillRect(x, y + 2, 1, h - 4); ctx.fillRect(x + w - 1, y + 2, 1, h - 4);
        const sw = ((now * 26) % (w + h + 24)) - h - 12;
        ctx.globalAlpha = a0 * cold * 0.3;
        ctx.fillStyle = '#ffffff';
        for (let yy = 2; yy < h - 2; yy++) {
          const gx = Math.round(sw + yy);
          if (gx >= 2 && gx < w - 4) ctx.fillRect(x + gx, y + yy, 2, 1);
        }
        ctx.fillStyle = '#e8f4ff';
        for (let k = 0; k < 6; k++) {
          const ph = (now * (0.35 + hash2(k * 3, r.y) * 0.3) + hash2(k * 7 + 2, r.y)) % 1;
          const bx = x + 6 + ((hash2(k * 13 + 5, r.y * 11) * (w - 12)) | 0);
          ctx.globalAlpha = a0 * cold * (1 - ph) * 0.8;
          ctx.fillRect(bx, y - 3 - Math.round(ph * 9), 1, 1);
        }
        ctx.globalAlpha = a0;
      }
      if (m.iceT > 0) {
        // dark fissures with the odd white glint, so they read against the pale glaze
        ctx.globalAlpha = a0 * Math.min(1, m.iceT / 0.45);
        for (let c = 0; c < 5; c++) {
          let px = m.iceX, py = m.iceY;
          let ang = (c / 5) * Math.PI * 2 + hash2(c * 7 + m.iceSeed, m.iceSeed) * 1.3;
          for (let s = 0; s < 12; s++) {
            ang += (hash2(c * 11 + s, m.iceSeed * 5 + 1) - 0.5) * 0.9;
            px += Math.cos(ang) * 1.5; py += Math.sin(ang) * 1.5;
            if (px < 2 || px >= w - 2 || py < 1 || py >= h - 1) break;
            ctx.fillStyle = hash2(c * 3 + s * 7, m.iceSeed) > 0.85 ? '#ffffff' : s % 2 ? '#1a2040' : '#0a0e23';
            ctx.fillRect(x + Math.round(px), y + Math.round(py), 1, 1);
          }
        }
        // the impact point itself: a bright chip out of the glaze
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + Math.round(m.iceX), y + Math.round(m.iceY), 1, 1);
        ctx.globalAlpha = a0;
      }
    }
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

  // ---- title dressing -------------------------------------------------------
  // The cinematic frame around the menu: a tint that weighs on the edges and
  // leaves the centre clear, two stone pillars with burning braziers flanking
  // the menu column (their light is additive, like the world's lanterns), a
  // frosted slab that gathers the items into one column, gold rules with
  // diamond finials, and embers drifting up off the logo and the flames. All of
  // it is procedural - hash2() for the static grain, now for the flicker - and
  // every piece takes its alpha from the caller so it fades with the chrome.
  const TITLE_PILLAR_DX = 106; // pillar centres either side of the menu column

  function drawTitleBackdrop(tintA) {
    ctx.fillStyle = 'rgba(10,16,42,' + tintA.toFixed(3) + ')';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const dark = (k) => 'rgba(3,5,16,' + Math.min(1, tintA * k).toFixed(3) + ')';
    // the cinematic band: heavier along the top and bottom edges
    const v = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    v.addColorStop(0, dark(1.1)); v.addColorStop(0.2, dark(0)); v.addColorStop(0.8, dark(0)); v.addColorStop(1, dark(1.25));
    ctx.fillStyle = v; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // corner vignette
    const r = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.6);
    r.addColorStop(0, dark(0)); r.addColorStop(1, dark(1.3));
    ctx.fillStyle = r; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // a gold rule with diamond finials at both ends and an ember-set one in the middle
  function drawGoldRule(cx, y, half, a) {
    ctx.globalAlpha = a;
    const dia = (x, r, c) => {
      ctx.fillStyle = c;
      for (let d = -r; d <= r; d++) { const w = r - Math.abs(d); ctx.fillRect(x - w, y + d, w * 2 + 1, 1); }
    };
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(cx - half, y + 1, half * 2 + 1, 1);
    ctx.fillStyle = '#c89a3c'; ctx.fillRect(cx - half, y, half * 2 + 1, 1);
    ctx.fillStyle = '#ffd95c'; ctx.fillRect(cx - 16, y, 33, 1);
    for (const ex of [cx - half, cx + half]) { dia(ex, 2, '#0a0e23'); dia(ex, 1, '#ffd95c'); }
    dia(cx, 3, '#0a0e23'); dia(cx, 2, '#c89a3c');
    ctx.fillStyle = '#ff8a3c'; ctx.fillRect(cx, y, 1, 1);
  }

  // a stone pillar: plinth, coursed shaft with a lit left edge and frost creeping
  // up from the base, a snow-capped capital and an iron brazier whose flame
  // flickers and throws warm light on whatever is near
  function drawPillar(cx, top, bot, now, a) {
    const w = 14, x = cx - 7, shaftTop = top + 7, shaftH = bot - shaftTop - 4;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(4,6,18,0.45)'; ctx.fillRect(x + 3, shaftTop + 2, w + 2, shaftH + 2);
    // shaft
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x - 1, shaftTop - 1, w + 2, shaftH + 2);
    ctx.fillStyle = '#222c52'; ctx.fillRect(x, shaftTop, w, shaftH);
    ctx.fillStyle = '#3a4878'; ctx.fillRect(x, shaftTop, 2, shaftH);
    ctx.fillStyle = '#161d3c'; ctx.fillRect(x + w - 2, shaftTop, 2, shaftH);
    for (let y = shaftTop + 8; y < bot - 6; y += 9) {
      ctx.fillStyle = '#121834'; ctx.fillRect(x, y, w, 1);
      const hb = hash2(y, cx);
      ctx.fillRect(x + 3 + ((hb * 8) | 0), y - 8, 1, 8); // a vertical joint in the course above
    }
    for (let y = shaftTop + 1; y < bot - 5; y++) {
      for (let xx = 1; xx < w - 1; xx++) {
        const hb = hash2(xx * 5 + y * 3, cx + 11);
        const frost = (bot - y) < 20 && hb > 0.86 - (20 - (bot - y)) * 0.014;
        if (frost) { ctx.fillStyle = hb > 0.9 ? '#f4f7ff' : '#b8cce6'; ctx.fillRect(x + xx, y, 1, 1); }
        else if (hb < 0.035) { ctx.fillStyle = '#2e3a6a'; ctx.fillRect(x + xx, y, 1, 1); }
      }
    }
    // plinth
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x - 3, bot - 5, w + 6, 5);
    ctx.fillStyle = '#2a3560'; ctx.fillRect(x - 2, bot - 4, w + 4, 3);
    ctx.fillStyle = '#4a5a90'; ctx.fillRect(x - 2, bot - 4, w + 4, 1);
    ctx.fillStyle = '#f4f7ff'; ctx.fillRect(x - 2, bot - 5, 4, 1); ctx.fillRect(x + w - 4, bot - 5, 6, 1);
    // capital: a snow-capped ledge under the bowl
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x - 3, top + 3, w + 6, 4);
    ctx.fillStyle = '#2a3560'; ctx.fillRect(x - 2, top + 5, w + 4, 1);
    ctx.fillStyle = '#f4f7ff'; ctx.fillRect(x - 2, top + 3, w + 4, 2);
    ctx.fillStyle = '#b8cce6'; ctx.fillRect(x - 2, top + 4, w + 4, 1);
    // iron brazier
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x + 1, top - 2, w - 2, 6); ctx.fillRect(x + 3, top - 3, w - 6, 1);
    ctx.fillStyle = '#3a2a22'; ctx.fillRect(x + 2, top - 1, w - 4, 3);
    ctx.fillStyle = '#5a4434'; ctx.fillRect(x + 2, top - 1, w - 4, 1);
    ctx.fillStyle = '#ff8a3c'; ctx.fillRect(x + 4, top - 2, w - 8, 1); // coals showing over the rim
    // the flame: a wobbling stack of ember rows
    const fl = now * 11 + cx;
    const hgt = 5 + Math.round(Math.sin(fl) + Math.sin(fl * 0.37) * 0.8);
    const rows = [[6, '#ffe37a'], [6, '#ffd95c'], [4, '#ffb347'], [4, '#ff8a3c'], [2, '#ff6a30'], [2, '#ff4a28'], [1, '#ff4a28']];
    for (let i = 0; i < Math.min(rows.length, hgt); i++) {
      const [ww, c] = rows[i];
      const dx = i > 2 ? Math.round(Math.sin(fl * 1.3 + i * 1.7)) : 0;
      ctx.fillStyle = c; ctx.fillRect(cx - (ww >> 1) + dx, top - 3 - i, ww, 1);
    }
    // warm light, additive like the lanterns in play
    ctx.globalCompositeOperation = 'lighter';
    const flick = 1 + Math.sin(now * 9 + cx) * 0.08;
    const gr = 60 * flick, gy = top - 4;
    const grd = ctx.createRadialGradient(cx, gy, 1, cx, gy, gr);
    grd.addColorStop(0, 'rgba(255,170,80,' + (0.42 * a).toFixed(3) + ')');
    grd.addColorStop(0.45, 'rgba(255,140,60,' + (0.14 * a).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grd; ctx.fillRect(cx - gr, gy - gr, gr * 2, gr * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  // n embers rising from (ox, oy) across spread px, each on its own loop
  function drawEmbers(now, a, ox, oy, spread, n, k) {
    for (let i = 0; i < n; i++) {
      const h1 = hash2(i * 13 + k, 71), h2 = hash2(i * 7 + k, 93), h3 = hash2(i * 3 + k, 29);
      const ph = ((now / (2 + h1 * 1.8)) + h2) % 1;
      const al = a * (1 - ph) * Math.min(1, ph * 10);
      if (al <= 0.01) continue;
      const x = Math.round(ox + (h3 - 0.5) * spread + Math.sin(now * 2.1 + i) * 2.5);
      const y = Math.round(oy - ph * (26 + h1 * 22));
      ctx.globalAlpha = al;
      ctx.fillStyle = (i & 1) ? '#ffd95c' : '#ff8a3c';
      const sz = ph < 0.45 ? 2 : 1;
      ctx.fillRect(x, y, sz, sz);
    }
  }

  // the frosted slab behind the menu column: translucent so the world still
  // shows, iron rim and gilt corner brackets
  function drawMenuSlab(x, y, w, h, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(5,8,22,0.58)'; chamRect(x, y, w, h);
    ctx.fillStyle = '#2c3a68';
    ctx.fillRect(x + 2, y, w - 4, 1); ctx.fillRect(x + 2, y + h - 1, w - 4, 1);
    ctx.fillRect(x, y + 2, 1, h - 4); ctx.fillRect(x + w - 1, y + 2, 1, h - 4);
    ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + w - 2, y + 1, 1, 1);
    ctx.fillRect(x + 1, y + h - 2, 1, 1); ctx.fillRect(x + w - 2, y + h - 2, 1, 1);
    ctx.fillStyle = '#c89a3c';
    for (const [bx, sx] of [[x + 3, 1], [x + w - 4, -1]]) {
      for (const [by, sy] of [[y + 3, 1], [y + h - 4, -1]]) {
        ctx.fillRect(sx > 0 ? bx : bx - 5, by, 6, 1);
        ctx.fillRect(bx, sy > 0 ? by : by - 5, 1, 6);
      }
    }
  }

  const helpPanelCv = document.createElement('canvas');
  helpPanelCv.width = SET_W; helpPanelCv.height = SET_H;
  function buildHelpPanel() {
    const g = helpPanelCv.getContext('2d');
    bakeFrostSlab(g, SET_W, SET_H, 'TUTORIAL');
    const cols = [
      [['WASD', 'MOVE'], ['SPACE', 'DODGE ROLL'], ['SHIFT', 'SLIDE'], ['CTRL', 'HIDE IN SNOW'], ['CLICK', 'DRAW THE BOW'], ['E', 'CHOP MINE PICK'], ['RCLICK', 'BUILD ON STUMP']],
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

  // the patch notes: the slab frame is baked once (patchPanelCv), the entries -
  // version in gold, sentence word-wrapped beside it, newest first - into a
  // canvas as tall as they need (patchNotesCv), and render blits the PN_H-px
  // window at menu.patchScroll through the frame. When the entries outgrow the
  // window a scrollbar appears on the right: wheel, up/down keys, clicking the
  // nubs or the track all move it.
  const PN_Y = 24, PN_H = SET_H - 24 - 18; // the window: below the title, above the hint
  const PN_BAR_X = SET_W - 13, PN_BAR_W = 6;
  const patchPanelCv = document.createElement('canvas');
  patchPanelCv.width = SET_W; patchPanelCv.height = SET_H;
  const patchNotesCv = document.createElement('canvas');
  function buildPatchPanel() {
    const g = patchPanelCv.getContext('2d');
    bakeFrostSlab(g, SET_W, SET_H, 'PATCH NOTES');
    const hint = 'ESC BACK';
    drawPixelText(g, hint, Math.round((SET_W - pixelTextWidth(hint)) / 2), 190, '#5a6690');
    // lay the entries out once to learn the height, then paint them
    const x0 = 14, x1 = 40, maxW = PN_BAR_X - 6 - x1;
    const rows = [];
    let y = 0;
    for (const [v, text] of PATCH_NOTES) {
      const lines = [];
      let line = '';
      for (const word of text.split(' ')) {
        const next = line ? line + ' ' + word : word;
        if (pixelTextWidth(next) > maxW && line) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      rows.push({ v, lines, y });
      y += lines.length * 8 + 4;
    }
    patchNotesCv.width = SET_W; patchNotesCv.height = Math.max(PN_H, y);
    const n = patchNotesCv.getContext('2d');
    for (const r of rows) {
      drawPixelText(n, r.v, x0, r.y, '#ffd95c');
      r.lines.forEach((l, i) => drawPixelText(n, l, x1, r.y + i * 8, '#9fb6d8'));
    }
  }
  function patchScrollMax() { return Math.max(0, patchNotesCv.height - PN_H); }
  function patchScrollBy(d) {
    const m = state.menu;
    m.patchScroll = Math.max(0, Math.min(patchScrollMax(), m.patchScroll + d));
  }
  // the scrollbar's pieces in panel space: nubs at both ends, the track between
  function patchBarLayout() {
    const track = { x: PN_BAR_X, y: PN_Y + 6, w: PN_BAR_W, h: PN_H - 12 };
    const max = patchScrollMax();
    const th = Math.max(8, Math.round(track.h * PN_H / patchNotesCv.height));
    const ty = track.y + Math.round((track.h - th) * (max ? state.menu.patchScroll / max : 0));
    return {
      track, thumb: { x: PN_BAR_X, y: ty, w: PN_BAR_W, h: th },
      up: { x: PN_BAR_X, y: PN_Y, w: PN_BAR_W, h: 5 }, down: { x: PN_BAR_X, y: PN_Y + PN_H - 5, w: PN_BAR_W, h: 5 },
    };
  }
  // a click inside the slab (panel-space px): nubs step, the track pages
  function patchPanelClick(px, py) {
    if (!patchScrollMax()) return;
    const { track, thumb, up, down } = patchBarLayout();
    const inR = (r) => px >= r.x - 2 && px < r.x + r.w + 2 && py >= r.y && py < r.y + r.h;
    if (inR(up)) patchScrollBy(-8);
    else if (inR(down)) patchScrollBy(8);
    else if (inR(track)) patchScrollBy(py < thumb.y ? -PN_H : py >= thumb.y + thumb.h ? PN_H : 0);
  }
  // iron rail, gilt thumb with grip notches, ice nubs - on the main ctx at the slab's origin
  function drawPatchBar(ox, oy) {
    if (!patchScrollMax()) return;
    const { track, thumb, up, down } = patchBarLayout();
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(ox + track.x - 1, oy + track.y - 1, track.w + 2, track.h + 2);
    ctx.fillStyle = '#1c2750'; ctx.fillRect(ox + track.x, oy + track.y, track.w, track.h);
    ctx.fillStyle = '#0f1632'; ctx.fillRect(ox + track.x + 2, oy + track.y, 2, track.h); // a groove down the rail
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(ox + thumb.x - 1, oy + thumb.y - 1, thumb.w + 2, thumb.h + 2);
    ctx.fillStyle = '#c89a3c'; ctx.fillRect(ox + thumb.x, oy + thumb.y, thumb.w, thumb.h);
    ctx.fillStyle = '#ffd95c'; ctx.fillRect(ox + thumb.x, oy + thumb.y, thumb.w, 1); ctx.fillRect(ox + thumb.x, oy + thumb.y, 1, thumb.h);
    ctx.fillStyle = '#8a6a2a'; ctx.fillRect(ox + thumb.x, oy + thumb.y + thumb.h - 1, thumb.w, 1); ctx.fillRect(ox + thumb.x + thumb.w - 1, oy + thumb.y, 1, thumb.h);
    ctx.fillStyle = '#0a0e23';
    for (let i = 3; i < thumb.h - 2; i += 3) ctx.fillRect(ox + thumb.x + 2, oy + thumb.y + i, 2, 1);
    // nubs: ice triangles pointing out of the rail, rows widen away from the tip
    const tri = (r, dir) => {
      const cx = ox + r.x + (r.w >> 1), tip = oy + (dir < 0 ? r.y + 1 : r.y + r.h - 2);
      for (let i = 0; i < 3; i++) {
        const yy = tip + (dir < 0 ? i : -i);
        ctx.fillStyle = '#0a0e23'; ctx.fillRect(cx - i - 1, yy, 2 * i + 3, 1);
      }
      ctx.fillStyle = '#0a0e23'; ctx.fillRect(cx, tip + (dir < 0 ? -1 : 1), 1, 1);
      for (let i = 0; i < 3; i++) {
        const yy = tip + (dir < 0 ? i : -i);
        ctx.fillStyle = i === 0 ? '#f4f7ff' : '#b8cce6'; ctx.fillRect(cx - i, yy, 2 * i + 1, 1);
      }
    };
    tri(up, -1); tri(down, 1);
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
    // the current loadout, shown as its four variant icons under the stat pips;
    // the strip is a button into the gear screen
    const loadout = { x: cx + 120, y: toy + 168, w: 4 * 17 - 3, h: 16 };
    return { toy, cx, cards, lock, loadout };
  }

  // ---- the gear screen: the full-page loadout picker (League runes-style) ---
  // Entered from champ select's LOCK IN (or its loadout strip). All 12
  // variants are on screen at once as cards - four rows, one per piece, three
  // options each - so the choice is a read, not a cycle. Clicking a card picks
  // it (writes straight to player.gear); FLY launches the match via lockIn().
  function gearLayout() {
    const toy = Math.round((VIEW_H - 270) / 2);
    const cx = Math.round(VIEW_W / 2);
    const w = 132, h = 34, gapx = 6, gapy = 4;
    const x0 = cx - Math.round((3 * w + 2 * gapx) / 2);
    const rows = GEAR.map((slot, i) => slot.map((_, v) => ({ x: x0 + v * (w + gapx), y: toy + 56 + i * (h + gapy), w, h })));
    const fly = { x: cx - 56, y: toy + 224, w: 112, h: 20 };
    return { toy, cx, rows, fly };
  }

  // what the pointer is over on the gear screen: {row, v}, 'fly', or null
  function gearScreenHit() {
    const { rows, fly } = gearLayout();
    for (let i = 0; i < rows.length; i++) {
      for (let v = 0; v < rows[i].length; v++) {
        const r = rows[i][v];
        if (mouse.x >= r.x && mouse.x < r.x + r.w && mouse.y >= r.y - 1 && mouse.y < r.y + r.h + 1) return { row: i, v };
      }
    }
    if (mouse.x >= fly.x - 2 && mouse.x < fly.x + fly.w + 2 && mouse.y >= fly.y - 3 && mouse.y < fly.y + fly.h + 3) return 'fly';
    return null;
  }

  function beginGear() {
    const m = state.menu;
    m.screen = 'gear';
    m.grow = 0;
    SFX.place();
  }
  function leaveGear() {
    state.menu.screen = 'select';
    SFX.pickup();
  }
  // pre-match variant pick for the local slot, full heal like setChamp since
  // nothing has been risked yet
  function pickGear(i, v) {
    if (player.gear[i] === v) return;
    player.gear[i] = v;
    refreshKit(player);
    player.hp = player.maxHp;
    SFX.pickup();
  }

  function gearKey(k) {
    const m = state.menu;
    if (m.lockT > 0) return;
    if (k === 'escape' || k === 'backspace') leaveGear();
    else if (k === 'arrowup' || k === 'w') { m.grow = (m.grow + 3) % 4; SFX.pickup(); }
    else if (k === 'arrowdown' || k === 's') { m.grow = (m.grow + 1) % 4; SFX.pickup(); }
    else if (k === 'arrowleft' || k === 'a') pickGear(m.grow, (player.gear[m.grow] + 2) % 3);
    else if (k === 'arrowright' || k === 'd') pickGear(m.grow, (player.gear[m.grow] + 1) % 3);
    else if (k === 'enter' || k === ' ') { m.pressT = 0.12; lockIn(); }
  }

  function gearClick() {
    const m = state.menu;
    if (m.lockT > 0 || m.gearT < 1) return;
    const h = gearScreenHit();
    if (!h) return;
    if (h === 'fly') { m.pressT = 0.12; lockIn(); return; }
    m.grow = h.row;
    pickGear(h.row, h.v);
  }

  // what the pointer is over: card index, CHAMPS.length for LOCK IN,
  // CHAMPS.length + 1 for the loadout strip, -1 for nothing
  function selectHit() {
    const { cards, lock, loadout } = selectLayout();
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i];
      if (mouse.x >= r.x - 2 && mouse.x < r.x + r.w + 2 && mouse.y >= r.y - 3 && mouse.y < r.y + r.h + 3) return i;
    }
    if (mouse.x >= lock.x - 2 && mouse.x < lock.x + lock.w + 2 && mouse.y >= lock.y - 3 && mouse.y < lock.y + lock.h + 3) return cards.length;
    if (mouse.x >= loadout.x - 2 && mouse.x < loadout.x + loadout.w + 2 && mouse.y >= loadout.y - 2 && mouse.y < loadout.y + loadout.h + 2) return cards.length + 1;
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
    else if (k === 'enter' || k === ' ') { m.pressT = 0.12; beginGear(); } // champion locked: on to the gear page
  }

  function selectClick() {
    const m = state.menu;
    if (m.lockT > 0 || m.screenT < 1 || m.gearT > 0) return;
    const h = selectHit();
    if (h < 0) return;
    if (h >= CHAMPS.length) { m.pressT = 0.12; beginGear(); } // LOCK IN or the loadout strip
    else { selectChamp(h); if (h === m.csel) m.csel = h; }
  }

  // a champion card: small plank with the portrait sprite and name; hot = gold
  function drawChampCard(r, ci, hv, now, chosen) {
    const lift = Math.round(hv * 2);
    const x = r.x, y = r.y - lift, w = r.w, h = r.h;
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
    const { toy, cx, cards, lock, loadout } = selectLayout();
    const c = CHAMPS[m.csel];
    const slideIn = 1 - a;

    // header
    ctx.globalAlpha = a;
    const t0 = 'CHOOSE YOUR CHAMPION';
    drawPixelTextShadow(ctx, t0, Math.round((VIEW_W - pixelTextWidth(t0, 2)) / 2), toy + 30 - Math.round(slideIn * 20), '#ffd95c', '#3c2a1e', 2);
    drawGoldRule(cx, toy + 45 - Math.round(slideIn * 20), Math.round(pixelTextWidth(t0, 2) / 2) + 8, a);

    // cards, from the left
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i];
      const rr = { x: r.x - Math.round(slideIn * 80), y: r.y, w: r.w, h: r.h };
      ctx.globalAlpha = a;
      drawChampCard(rr, i, m.chover[i], now, m.csel === i);
    }
    ctx.globalAlpha = a;


    // the champion, big: 6x sprite over a soft plinth, swapping with a quick rise
    const sw = easeOut(m.cswapT);
    const bx = cx - 48, by = toy + 52 + Math.round((1 - sw) * 10);
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = '#0a0e23';
    ctx.beginPath(); ctx.ellipse(cx, toy + 150, 46, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = a * sw;
    // the big sprite walks in place - a living pick, not a poster
    const spr = SPRITES.champ[m.csel][0].down[1 + (Math.floor(now * 4) % 2)];
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

    // the loadout strip: your four picked variants as icons, right where the
    // pips end. It is a button - clicking it (or LOCK IN) opens the gear page.
    const hover = m.screenT >= 1 && !m.gearT ? selectHit() : -1;
    const lox = loadout.x + Math.round(slideIn * 80);
    const lolift = hover === CHAMPS.length + 1 ? 1 : 0;
    for (let i = 0; i < GEAR_SLOTS.length; i++) {
      const x = lox + i * 17, y = loadout.y - lolift;
      ctx.fillStyle = lolift ? '#8fa0c8' : '#35426e';
      ctx.fillRect(x, y, 14, 16);
      ctx.fillStyle = '#0f1632';
      ctx.fillRect(x + 1, y + 1, 12, 14);
      ctx.drawImage(SPRITES.gearIcons[i][player.gear[i]][0], x + 1, y + 2);
    }

    // lock in
    const over = hover === CHAMPS.length;
    const pressed = m.pressT > 0 || m.lockT > 0;
    drawMenuButton({ x: lock.x, y: lock.y + Math.round(slideIn * 20), w: lock.w, h: lock.h }, 'LOCK IN', over ? 1 : 0.7, now, pressed);
    const t3 = 'ENTER LOCK IN - ESC BACK';
    drawPixelTextShadow(ctx, t3, Math.round((VIEW_W - pixelTextWidth(t3)) / 2), toy + 258, '#5a6690', 'rgba(15,22,50,0.9)');
    ctx.globalAlpha = 1;
  }

  // the gear page: four rows of three cards, every variant visible at once.
  // A card is icon + name + blurb; the picked one is gold-trimmed, the
  // keyboard-focused row's pick wears pulsing corner ticks. FLY launches.
  function drawGearCard(r, slot, v, hot, picked, focused, now) {
    const lift = hot ? 2 : 0;
    const x = r.x, y = r.y - lift, w = r.w, h = r.h;
    ctx.fillStyle = 'rgba(4,6,18,0.55)'; ctx.fillRect(x + 2, r.y + 2, w, h);
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = picked ? '#1f2b5c' : '#141c3c'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = picked ? '#5a7fb8' : '#35426e';
    ctx.fillRect(x + 2, y + 1, w - 4, 1); ctx.fillRect(x + 1, y + 2, 1, h - 4);
    ctx.fillStyle = '#080c1c';
    ctx.fillRect(x + 2, y + h - 2, w - 4, 1); ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
    if (picked) {
      ctx.fillStyle = '#c89a3c';
      ctx.fillRect(x + 3, y + 2, w - 6, 1); ctx.fillRect(x + 3, y + h - 3, w - 6, 1);
    }
    // icon well, the variant's own glyph (leather: everyone leaves at level 1)
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x + 4, y + 9, 16, 16);
    ctx.fillStyle = picked ? '#2a3a6e' : '#1c2750'; ctx.fillRect(x + 5, y + 10, 14, 14);
    ctx.drawImage(SPRITES.gearIcons[slot][v][0], x + 6, y + 11);
    const g = GEAR[slot][v];
    drawPixelTextShadow(ctx, g.name, x + 24, y + 8, picked ? '#ffd95c' : hot ? '#f4f7ff' : '#cfe0ff', '#0a0e23');
    drawPixelTextShadow(ctx, g.blurb, x + 24, y + 19, picked || hot ? '#9fb6d8' : '#5a6690', '#0a0e23');
    if (focused) { // keyboard cursor: four corner ticks, breathing
      ctx.globalAlpha *= 0.7 + 0.3 * Math.sin(now * 6);
      ctx.fillStyle = '#f4f7ff';
      ctx.fillRect(x - 1, y - 1, 4, 1); ctx.fillRect(x - 1, y - 1, 1, 4);
      ctx.fillRect(x + w - 3, y - 1, 4, 1); ctx.fillRect(x + w, y - 1, 1, 4);
      ctx.fillRect(x - 1, y + h, 4, 1); ctx.fillRect(x - 1, y + h - 3, 1, 4);
      ctx.fillRect(x + w - 3, y + h, 4, 1); ctx.fillRect(x + w, y + h - 3, 1, 4);
      ctx.globalAlpha /= 0.7 + 0.3 * Math.sin(now * 6);
    }
  }

  function renderGear(now, a) {
    const m = state.menu;
    const { toy, cx, rows, fly } = gearLayout();
    const slideIn = 1 - a;

    ctx.globalAlpha = a;
    const t0 = 'CHOOSE YOUR GEAR';
    drawPixelTextShadow(ctx, t0, Math.round((VIEW_W - pixelTextWidth(t0, 2)) / 2), toy + 26 - Math.round(slideIn * 20), '#ffd95c', '#3c2a1e', 2);
    drawGoldRule(cx, toy + 41 - Math.round(slideIn * 20), Math.round(pixelTextWidth(t0, 2) / 2) + 8, a);

    const gh = m.gearT >= 1 && mouse.inside ? gearScreenHit() : null;
    for (let i = 0; i < rows.length; i++) {
      for (let v = 0; v < rows[i].length; v++) {
        const r = rows[i][v];
        const rr = { x: r.x + Math.round(slideIn * (v - 1) * 40), y: r.y, w: r.w, h: r.h };
        drawGearCard(rr, i, v, gh && gh !== 'fly' && gh.row === i && gh.v === v,
          player.gear[i] === v, m.grow === i && player.gear[i] === v, now);
        ctx.globalAlpha = a;
      }
    }

    // fly: the champion, locked and loaded, takes the eagle
    const over = gh === 'fly';
    const pressed = m.pressT > 0 || m.lockT > 0;
    drawMenuButton({ x: fly.x, y: fly.y + Math.round(slideIn * 20), w: fly.w, h: fly.h }, 'FLY', over ? 1 : 0.7, now, pressed);
    ctx.drawImage(SPRITES.champ[m.csel][0].down[1 + (Math.floor(now * 4) % 2)], fly.x - 24, fly.y + 2);
    const t3 = 'ENTER FLY - ESC BACK';
    drawPixelTextShadow(ctx, t3, Math.round((VIEW_W - pixelTextWidth(t3)) / 2), toy + 258, '#5a6690', 'rgba(15,22,50,0.9)');
    ctx.globalAlpha = 1;
  }

  function renderTitle(now) {
    const m = state.menu;
    // leaving: 0 while the menu is up, 0->1 over the intro
    const outQ = state.intro > 0 ? 1 - state.intro / INTRO_T : 0;
    const tintA = 0.55 * (1 - easeOut(outQ / 0.45));
    if (tintA > 0.005) drawTitleBackdrop(tintA);
    const out = easeOut(outQ / 0.22);           // menu chrome drops away first
    const sc = easeInOut(m.screenT);             // champion select cross-fade
    const pan = Math.max(m.panel ? easeOut(m.panelT) : 0, sc); // chrome ducks under a panel or the select screen
    const { toy, rects } = menuLayout();
    const cx = Math.round(VIEW_W / 2);
    const chromeA = (1 - out) * (1 - pan);

    // the frame: pillars rise from below at boot and sink away on play; the
    // slab behind the column fades with the items
    const frameIn = easeOut((m.t - 0.1) / 0.6);
    const frameA = frameIn * chromeA;
    const sink = Math.round((1 - frameIn) * 30 + out * 25);
    if (frameA > 0.005) {
      const last = rects[rects.length - 1];
      const ptop = rects[0].y - 22 + sink, pbot = last.y + last.h + 14 + sink;
      drawPillar(cx - TITLE_PILLAR_DX, ptop, pbot, now, frameA);
      drawPillar(cx + TITLE_PILLAR_DX, ptop, pbot, now, frameA);
      drawEmbers(now, frameA * 0.9, cx - TITLE_PILLAR_DX, ptop - 6, 8, 6, 17);
      drawEmbers(now, frameA * 0.9, cx + TITLE_PILLAR_DX, ptop - 6, 8, 6, 43);
      const slabIn = easeOut((m.t - 0.2) / 0.45);
      drawMenuSlab(cx - 78, rects[0].y - 14 + Math.round(out * 25), 156, last.y + last.h + 8 - rects[0].y + 14, slabIn * chromeA);
      ctx.globalAlpha = 1;
    }

    // logo: drops in at boot, lifts away on play
    const logoIn = easeOut(m.t / 0.6);
    const t1 = 'SOFTFALL';
    const bob = Math.sin(now * 1.5) * 2;
    const ly = Math.round(toy + 34 + bob - (1 - logoIn) * 30 - out * 40);
    const logoA = logoIn * (1 - out) * (1 - pan) * (1 - sc);
    const lw = pixelTextWidth(t1, 4);
    const lx = Math.round((VIEW_W - lw) / 2);
    // a pulsing ember glow behind the letters
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.8 + 0.2 * Math.sin(now * 2.2);
    const gr = 84;
    const grd = ctx.createRadialGradient(cx, ly + 10, 2, cx, ly + 10, gr);
    grd.addColorStop(0, 'rgba(255,150,60,' + (0.26 * logoA * pulse).toFixed(3) + ')');
    grd.addColorStop(0.5, 'rgba(255,120,50,' + (0.08 * logoA * pulse).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(255,100,40,0)');
    ctx.fillStyle = grd; ctx.fillRect(cx - gr, ly + 10 - gr, gr * 2, gr * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = logoA;
    drawPixelText(ctx, t1, lx + 1, ly + 1, '#ff7a2a', 4); // ember under-glow
    drawPixelText(ctx, t1, lx, ly - 1, '#fff1c2', 4);     // ice rim along every top edge
    drawPixelTextShadow(ctx, t1, lx, ly, '#ffd95c', '#3c2a1e', 4);
    drawGoldRule(cx, ly + 32, Math.round(lw / 2) + 6, logoA);
    drawEmbers(now, logoA * 0.85, cx, ly + 26, lw, 22, 5);
    ctx.globalAlpha = 1;

    // items: stagger in from the left, sink away on play, fade under a panel
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const inT = easeOut((m.t - 0.25 - i * 0.12) / 0.45);
      const a = inT * (1 - out) * (1 - pan);
      if (a <= 0.005) continue;
      ctx.globalAlpha = a;
      const rr = { x: r.x - Math.round((1 - inT) * 60), y: r.y + Math.round(out * 25), w: r.w, h: r.h };
      // the refusal shudder rattles the frozen plank in place (x only, so its hashed rime holds still)
      if (i === MENU_FROZEN && m.iceT > 0) rr.x += Math.round(Math.sin(now * 85) * 2.2 * (m.iceT / 0.45));
      const hv = m.hover[i];
      const pressed = m.sel === i && (m.pressT > 0 || (mouse.down && menuHit() === i));
      if (r.seed) {
        const lift = Math.round(hv * 2);
        const tx = rr.x + 3, ty = rr.y + 3 - lift;
        drawPixelTextShadow(ctx, SEED_TXT, tx, ty, hv > 0.5 ? '#ffd95c' : '#9fb6d8', 'rgba(15,22,50,0.9)');
        drawDie(tx + pixelTextWidth(SEED_TXT) + 6, rr.y - lift, hv, now);
      } else {
        drawMenuButton(rr, MENU_ITEMS[i], hv, now, pressed, i === MENU_FROZEN);
      }
      ctx.globalAlpha = 1;
    }

    // ice chips knocked off the frozen plank, falling and fading
    for (const s of m.shards) {
      ctx.globalAlpha = Math.min(1, s.life * 3) * (1 - out) * (1 - pan);
      ctx.fillStyle = s.c;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.w, s.w);
    }
    ctx.globalAlpha = 1;

    // footer hint
    const fin = easeOut((m.t - 0.9) / 0.5) * (1 - out) * (1 - pan);
    if (fin > 0.005) {
      ctx.globalAlpha = fin;
      drawGoldRule(cx, toy + 256, 52, fin);
      const pr = patchTagRect();
      const phot = !m.panel && overPatchTag();
      drawPixelTextShadow(ctx, PATCH_TXT, pr.x, pr.y, phot ? '#ffd95c' : '#5a6690', 'rgba(15,22,50,0.9)');
      if (phot) { ctx.fillStyle = '#c89a3c'; ctx.fillRect(pr.x, pr.y + 7, pr.w, 1); }
      ctx.globalAlpha = 1;
    }

    // the two pick screens cross-fade into each other on gearT
    const gc = easeInOut(state.menu.gearT);
    if (sc > 0.005 && gc < 0.995) renderSelect(now, sc * (1 - out) * (1 - gc));
    if (sc > 0.005 && gc > 0.005) renderGear(now, sc * (1 - out) * gc);

    // sub-panels slide up from the bottom edge over the still-visible world
    if (m.panel) {
      const slide = Math.round((1 - easeOut(m.panelT)) * (VIEW_H - SET_Y + 6));
      if (m.panel === 'settings') renderSettings(now, { bare: true, slide });
      else if (m.panel === 'patch') {
        ctx.drawImage(patchPanelCv, SET_X, SET_Y + slide);
        ctx.drawImage(patchNotesCv, 0, m.patchScroll, SET_W, PN_H, SET_X, SET_Y + slide + PN_Y, SET_W, PN_H);
        drawPatchBar(SET_X, SET_Y + slide);
      } else ctx.drawImage(helpPanelCv, SET_X, SET_Y + slide);
    }
  }

  // ------------------------------------------------------------ death & spectate
  // Death is final: the local slot's death - or its win, once every RIVAL is
  // gone (teams win together, see checkLastStanding) - puts the game in mode
  // 'dead' with the match running on underneath. A loss dims the screen and
  // offers two planks; a win hands the whole frame to the victory banner below
  // and offers two of its own. SPECTATE follows a living slot through a
  // top-centre control: two pixel arrows around the name, clickable, the arrow
  // keys do the same, ESC comes back (no hint text: the arrows are the
  // explanation). LOBBY fades out and reloads into the title screen on the same seed. viewPlayer() is who the camera and minimap
  // frame, and the only thing the rest of the file needs to know about any of it.
  const DEAD_BW = 112, DEAD_BH = 20, DEAD_GAP = 12; // the title menu plank, side by side
  const DEAD_ITEMS = { lost: ['SPECTATE', 'LOBBY'], won: ['KEEP PLAYING', 'LOBBY'] };

  function viewPlayer() {
    const q = state.spec >= 0 ? players[state.spec] : null;
    return q && q.active && !q.dead ? q : player;
  }

  function deadLayout() {
    const items = DEAD_ITEMS[state.over] || DEAD_ITEMS.lost;
    const w = items.length * DEAD_BW + (items.length - 1) * DEAD_GAP;
    const x0 = Math.round((VIEW_W - w) / 2);
    // a win seats them at the foot of the victory screen, under the tally;
    // a loss keeps the middle of the screen it always had
    const y = state.over === 'won' ? winLayout().plankY : Math.round(VIEW_H / 2) + 10;
    return items.map((label, i) => ({ x: x0 + i * (DEAD_BW + DEAD_GAP), y, w: DEAD_BW, h: DEAD_BH, label }));
  }

  // the overlay has finished arriving and the planks are live: half a second
  // for a death, the whole victory ceremony for a win (which can be skipped)
  function deadReady() { return state.deadTimer >= (state.over === 'won' ? WIN_T.menu : 0.5); }

  // the spectate control, top centre: [<] NAME [>]. Arrow boxes are SPEC_AW
  // wide; the name plate between them is sized to the widest slot name so the
  // arrows never jump as the target changes.
  const SPEC_Y = 6, SPEC_H = 13, SPEC_AW = 11;
  function specLayout() {
    let nw = 0;
    for (const p of players) if (p.active) nw = Math.max(nw, pixelTextWidth(p.name));
    const w = SPEC_AW + 6 + nw + 6 + SPEC_AW;
    const x = Math.round((VIEW_W - w) / 2);
    return { x, y: SPEC_Y, w, h: SPEC_H,
      left: { x, y: SPEC_Y, w: SPEC_AW, h: SPEC_H },
      right: { x: x + w - SPEC_AW, y: SPEC_Y, w: SPEC_AW, h: SPEC_H } };
  }
  // which spectate arrow the pointer is on: -1 left, 1 right, 0 neither
  function specHit() {
    if (state.deadView !== 'spec') return 0;
    const L = specLayout();
    const inR = (r) => mouse.x >= r.x - 2 && mouse.x < r.x + r.w + 2 && mouse.y >= r.y - 2 && mouse.y < r.y + r.h + 2;
    return inR(L.left) ? -1 : inR(L.right) ? 1 : 0;
  }

  // which plank is under the pointer (-1 for none); the overlay must have faded in
  function deadHit() {
    if (state.deadView !== 'menu' || !deadReady()) return -1;
    const rs = deadLayout();
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (mouse.x >= r.x - 2 && mouse.x < r.x + r.w + 2 && mouse.y >= r.y - 3 && mouse.y < r.y + r.h + 3) return i;
    }
    return -1;
  }

  function deadActivate(i) {
    const label = deadLayout()[i].label;
    SFX.place();
    if (label === 'LOBBY') toLobby();
    else if (label === 'SPECTATE') { state.deadView = 'spec'; state.spec = -1; specNext(1); }
    else if (label === 'KEEP PLAYING') { state.mode = 'play'; }
  }

  // follow the next living rival in slot order (dir -1 for the previous one)
  function specNext(dir) {
    const n = players.length;
    let i = state.spec;
    for (let k = 0; k < n; k++) {
      i = ((i + dir) % n + n) % n;
      const q = players[i];
      if (q !== player && q.active && !q.dead) { state.spec = i; return; }
    }
    state.spec = -1; // nobody left to watch
  }

  // back to the title screen: fade to dark and reload this seed
  function toLobby() {
    if (state.fade) return;
    state.fade = {
      a: 0, to: 1, spd: 1 / 0.5, color: '#06081a',
      then: () => { location.href = location.pathname + location.search; },
    };
  }

  function deadKey(k) {
    if (state.fade) return;
    if (state.deadView === 'spec') {
      if (k === 'escape' || k === 'backspace' || k === 'enter' || k === ' ') { state.deadView = 'menu'; SFX.pickup(); }
      else if (k === 'arrowright' || k === 'd') { specNext(1); SFX.pickup(); }
      else if (k === 'arrowleft' || k === 'a') { specNext(-1); SFX.pickup(); }
      return;
    }
    if (winSkip()) return;
    if (state.deadTimer < 0.5) return;
    const n = deadLayout().length;
    if (k === 'arrowleft' || k === 'a') { state.deadSel = (state.deadSel + n - 1) % n; SFX.pickup(); }
    else if (k === 'arrowright' || k === 'd') { state.deadSel = (state.deadSel + 1) % n; SFX.pickup(); }
    else if (k === 'enter' || k === ' ') deadActivate(state.deadSel);
  }

  function deadClick() {
    if (state.fade) return;
    if (state.deadView === 'spec') { const d = specHit(); if (d) { specNext(d); SFX.pickup(); } return; }
    if (winSkip()) return;
    const h = deadHit();
    if (h >= 0) { state.deadSel = h; deadActivate(h); }
  }

  function renderDead(now) {
    if (state.deadView === 'spec') {
      // top centre: [<] NAME [>]. The name sits on a plate in the target's
      // team colour; each arrow is its own box that lights gold under the
      // pointer, so the control explains itself without a word of hint.
      const vp = viewPlayer();
      const L = specLayout();
      const hit = specHit();
      ctx.fillStyle = 'rgba(12,18,42,0.82)';
      ctx.fillRect(L.x, L.y, L.w, L.h);
      const mark = vp === player ? '#8f9cc4' : TEAMS[vp.team].mark;
      ctx.fillStyle = mark;
      ctx.fillRect(L.x + SPEC_AW, L.y, L.w - SPEC_AW * 2, 1);
      ctx.fillRect(L.x + SPEC_AW, L.y + L.h - 1, L.w - SPEC_AW * 2, 1);
      for (const dir of [-1, 1]) {
        const r = dir < 0 ? L.left : L.right;
        const hot = hit === dir;
        ctx.fillStyle = hot ? '#1f2b5c' : '#141c3c';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = hot ? '#c89a3c' : '#35426e';
        ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
        ctx.fillRect(dir < 0 ? r.x : r.x + r.w - 1, r.y, 1, r.h);
        // a 4-wide chevron, pointing out of the plate
        const cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1);
        ctx.fillStyle = hot ? '#ffd95c' : '#cfe0ff';
        for (let i = 0; i < 4; i++) {
          const px = dir < 0 ? cx - 2 + i : cx + 1 - i;
          ctx.fillRect(px, cy - i, 1, 1); ctx.fillRect(px, cy + i, 1, 1);
        }
      }
      if (vp !== player) {
        drawPixelTextShadow(ctx, vp.name, Math.round(L.x + (L.w - pixelTextWidth(vp.name)) / 2), L.y + 4, playerTint(vp), '#0a0e23');
      } else {
        // nobody left to watch: an empty plate with a dim dash where a name would be
        ctx.fillStyle = '#5a6690';
        ctx.fillRect(Math.round(L.x + L.w / 2) - 3, L.y + 6, 6, 1);
      }
      return;
    }
    if (state.over === 'won') { renderVictory(now); return; } // a win gets a ceremony, not a dim
    const a = Math.min(0.75, state.deadTimer * 0.6);
    ctx.fillStyle = 'rgba(8,10,28,' + a + ')';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (state.deadTimer < 0.5) return;
    const t = 'YOU COLLAPSED IN THE SNOW';
    drawPixelTextShadow(ctx, t, (VIEW_W - pixelTextWidth(t, 2)) / 2, VIEW_H / 2 - 24, '#a8c4ff', '#0a0e23', 2);
    const t2 = 'YOU ARE OUT OF THE MATCH';
    drawPixelTextShadow(ctx, t2, (VIEW_W - pixelTextWidth(t2)) / 2, VIEW_H / 2 - 6, '#8f9cc4', '#0a0e23');
    drawEndPlanks(now, 0);
  }

  // the planks both endings share: hovered or keyboard-picked is hot, and the
  // ease runs on the frame delta (it only steps while the overlay is up). dy
  // slides them on screen without moving the rects deadHit() tests, so a plank
  // is only clickable once it has arrived.
  function drawEndPlanks(now, dy) {
    const rs = deadLayout();
    const hot = deadHit();
    const dt = Math.min(0.05, now - (drawEndPlanks.last || now)); drawEndPlanks.last = now;
    for (let i = 0; i < rs.length; i++) {
      const want = (hot >= 0 ? hot === i : state.deadSel === i) ? 1 : 0;
      state.deadHover[i] += (want - state.deadHover[i]) * Math.min(1, dt * 14);
      drawMenuButton({ x: rs[i].x, y: rs[i].y + dy, w: rs[i].w, h: rs[i].h },
        rs[i].label, state.deadHover[i], now, false); // prints its own 2x label
    }
  }

  // ------------------------------------------------------------ victory
  // Winning is the one thing in a match that earns a ceremony, so the screen is
  // staged rather than drawn. state.deadTimer - already ticking for the death
  // overlay - is the clock, and WIN_T names every beat, so the render pass and
  // the sound cues read one timeline and cannot drift apart. Any press before
  // the last beat skips to it (winSkip): the reward is worth watching, never
  // twice. Everything here is procedural in the title screen's idiom (hash2 for
  // static grain, the frame clock for flicker); the only sprites are the
  // champion, the gear icons and the coin.
  const WIN_T = {
    flash: 0.30,   // the white bloom off the winning frame
    dim: 0.50,     // the backdrop has finished settling
    title: 0.45, letter: 0.07, land: 0.26, // VICTORY drops in a letter at a time
    rule: 1.10,    // the gold rule sweeps out of the middle
    stage: 1.00,   // banners, dais and the champion rise
    crown: 1.70, crownLand: 2.02,
    stats: 2.25, statStep: 0.16, roll: 0.5, // the tally, one plate at a time
    menu: 3.30,    // the planks are up and the screen is live
  };
  const WIN_SLIDE = 0.32; // the planks' slide, finishing exactly on WIN_T.menu

  // the composition, in the 270-tall frame everything else is authored in
  function winLayout() {
    const toy = Math.round((VIEW_H - 270) / 2);
    const cx = Math.round(VIEW_W / 2);
    return {
      toy, cx,
      spread: Math.min(112, cx - 22), // the braziers; the banners sit inside them
      titleY: toy + 20,   // VICTORY, 4x - 20px tall
      ruleY: toy + 44,
      subY: toy + 56,
      champY: toy + 68,   // top of the 5x champion (80px tall, feet at +75)
      daisY: toy + 146,   // top face of the dais: the champion stands on it
      statY: toy + 170,
      gearY: toy + 198,
      plankY: toy + 226,
    };
  }

  // the numbers the screen prints, frozen at the win. Icon plus number, no
  // labels - the icon is the label. roll climbs from zero during the tally.
  const WIN_STATS = [
    { icon: 'gold', roll: true, val: (w) => String(w.gold) },
    { icon: 'kills', roll: true, val: (w) => String(w.kills) },
    { icon: 'level', roll: true, val: (w) => String(w.level) },
    { icon: 'time', roll: false, val: (w) => clockTxt(w.time) },
  ];

  function winSnapshot() {
    return {
      gold: player.xp, kills: player.kills, level: player.level, time: state.elapsed,
      team: player.team, champ: player.champ,
      gear: player.gear.slice(), gearLv: player.gearLv.slice(),
      // a teammate still standing means the TEAM won, and the headline says so
      mates: players.filter((q) => q !== player && q.active && !q.dead && q.team === player.team).length,
    };
  }

  // the ceremony's sound track: every cue inside this tick's slice of the
  // timeline fires once. A skip jumps state.deadTimer before update() reads it,
  // so nothing in the skipped span plays.
  function winCues(t0, t1) {
    if (!state.win) return;
    const at = (t) => t0 < t && t1 >= t;
    if (at(WIN_T.crownLand)) { SFX.levelUp(); state.shake = Math.max(state.shake, 2.5); }
    const TICK = 0.055;
    for (let i = 0; i < WIN_STATS.length; i++) {
      const s0 = WIN_T.stats + i * WIN_T.statStep;
      if (at(s0)) SFX.place();
      if (!WIN_STATS[i].roll) continue;
      const a = Math.max(s0, Math.min(s0 + WIN_T.roll, t0));
      const b = Math.max(s0, Math.min(s0 + WIN_T.roll, t1));
      if (b > a && Math.floor((b - s0) / TICK) > Math.floor((a - s0) / TICK)) SFX.tally();
    }
  }

  // a press during the ceremony jumps to its end instead of being swallowed;
  // true means it was consumed and the caller should do nothing else
  function winSkip() {
    if (state.over !== 'won' || deadReady()) return false;
    state.deadTimer = WIN_T.menu;
    SFX.pickup();
    return true;
  }

  // ---- the art -------------------------------------------------------------
  // A char grid painted at (x, y) with s-px cells - the shape sprites.js
  // authors in, for art only this screen needs and so never earns a baked
  // sprite. rim, when given, stamps a one-cell dark border under the whole
  // silhouette first, so the piece reads against the aurora behind it.
  function stampGrid(rows, pal, x, y, s, rim) {
    for (let pass = rim ? 0 : 1; pass < 2; pass++) {
      if (pass === 0) ctx.fillStyle = rim;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          if (!pal[row[c]]) continue;
          if (pass === 0) {
            ctx.fillRect(x + (c - 1) * s, y + r * s, s * 3, s);
            ctx.fillRect(x + c * s, y + (r - 1) * s, s, s * 3);
          } else {
            ctx.fillStyle = pal[row[c]];
            ctx.fillRect(x + c * s, y + r * s, s, s);
          }
        }
      }
    }
  }

  // the winner's crown: three gem-tipped spikes on a jewelled gold band
  const WIN_CROWN = [
    '.w....w....w.',
    '.g....g....g.',
    'ggg..ggg..ggg',
    'hhhhhhhhhhhhh',
    'gggjggjggjggg',
    'ddddddddddddd',
  ];
  const WIN_CROWN_PAL = { '.': null, w: '#ffffff', g: '#f2cc6a', h: '#ffedb0', j: '#7ad4ff', d: '#b8912f' };
  // the two stat glyphs with no sprite of their own: stacked chevrons for the
  // hero level, a clock face for the match time (gold and the bow are sprites)
  const WIN_LVL_ICON = [
    '........', '...gg...', '..g..g..', '.g....g.',
    '........', '...gg...', '..g..g..', '.g....g.',
  ];
  const WIN_TIME_ICON = [
    '..oooo..', '.o....o.', 'o..h...o', 'o..h...o',
    'o..hhh.o', 'o......o', '.o....o.', '..oooo..',
  ];
  const WIN_ICON_PAL = { '.': null, g: '#f2cc6a', o: '#cfe0ff', h: '#ffd95c' };

  // the sky answers: three curtains across the top band, each a row of 2px
  // strands riding its own sine, length breathing along it. Additive, like
  // every other light in the game.
  const WIN_AURORA = [
    { y: 26, amp: 10, k: 0.030, spd: 0.10, len: 30, hi: '#3ce8a0', lo: '#1f8f6a' },
    { y: 44, amp: 14, k: 0.019, spd: -0.07, len: 24, hi: '#5aa8f0', lo: '#2a5aa0' },
    { y: 16, amp: 7, k: 0.046, spd: 0.16, len: 16, hi: '#a86ce8', lo: '#5a3a90' },
  ];
  function drawWinAurora(now, a, toy) {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of WIN_AURORA) {
      for (let x = 0; x < VIEW_W; x += 2) {
        const ph = x * b.k + now * b.spd;
        const top = toy + b.y + Math.sin(ph) * b.amp + Math.sin(ph * 2.3 + 1.7) * b.amp * 0.3;
        const len = b.len * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ph * 1.7 + 2.1)));
        const seg = Math.max(2, Math.round(len / 5));
        const shimmer = 0.6 + 0.4 * Math.sin(now * 1.7 + x * 0.05);
        for (let i = 0; i < 5; i++) {
          ctx.globalAlpha = a * 0.23 * (1 - i / 5) * shimmer;
          ctx.fillStyle = i < 2 ? b.hi : b.lo;
          ctx.fillRect(x, Math.round(top + (i * len) / 5), 2, seg);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // light behind the winner: wedges stepped outward from a point a block at a
  // time, so they stay on the pixel grid instead of being a smooth triangle
  function drawWinRays(cx, cy, now, a) {
    ctx.globalCompositeOperation = 'lighter';
    const N = 10, far = Math.max(VIEW_W, VIEW_H) * 0.55;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + now * 0.09 + hash2(i, 7) * 0.5;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let d = 10; d < far; d += 2) {
        const f = d / far;
        const sz = 2 + Math.round(d * 0.06);
        ctx.globalAlpha = a * 0.075 * (1 - f) * (1 - f);
        ctx.fillStyle = i & 1 ? '#ffd95c' : '#ffb347';
        ctx.fillRect(Math.round(cx + ca * d - sz / 2), Math.round(cy + sa * d - sz / 2), sz, sz);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // gold and snow drifting down over everything: no state and no array, the
  // same procedural loop the title's embers use, so a resize costs it nothing
  function drawWinMotes(now, a, n) {
    const span = VIEW_H + 40;
    for (let i = 0; i < n; i++) {
      const h1 = hash2(i * 13 + 1, 57), h2 = hash2(i * 7 + 5, 113), h3 = hash2(i * 5 + 9, 191);
      const y = ((now * (10 + h1 * 26) + h2 * span) % span) - 20;
      const x = Math.round(h3 * (VIEW_W - 2) + Math.sin(now * (0.7 + h1) + i) * 5);
      ctx.globalAlpha = a * (0.45 + 0.5 * (0.5 + 0.5 * Math.sin(now * 3.1 + i * 2.3)));
      ctx.fillStyle = h1 > 0.55 ? '#ffd95c' : h1 > 0.28 ? '#ff8a3c' : '#e8f2ff';
      ctx.fillRect(x, Math.round(y), h2 > 0.78 ? 2 : 1, h2 > 0.78 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
  }

  // a hanging team banner: iron rail, cloth with a lit left fold and a dark
  // right edge, a swallowtail bitten out of the bottom, the team's mark as a
  // diamond over a gold band. The whole length ripples on one slow sine.
  function drawWinBanner(x, top, w, h, tm, a, now) {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x - 4, top - 4, w + 8, 4);
    ctx.fillStyle = '#4a5a90'; ctx.fillRect(x - 4, top - 4, w + 8, 1);
    ctx.fillStyle = '#2a3560'; ctx.fillRect(x - 4, top - 1, w + 8, 1);
    const wobAt = (yy) => Math.round(Math.sin(now * 1.1 + yy * 0.17) * 1.2);
    for (let yy = 0; yy < h; yy++) {
      const wob = wobAt(yy);
      const tail = h - yy;
      const cut = tail <= 8 ? 9 - tail : 0; // the swallowtail bitten up the middle
      const half = w >> 1;
      const segs = cut === 0 ? [[0, w]]
        : cut < half ? [[0, half - cut], [half + cut, w - half - cut]] : [];
      for (const seg of segs) {
        const o = seg[0], sw = seg[1];
        if (sw <= 0) continue;
        const px = x + o + wob;
        ctx.fillStyle = tm.coat; ctx.fillRect(px, top + yy, sw, 1);
        ctx.fillStyle = tm.coatD; ctx.fillRect(px + sw - 1, top + yy, 1, 1);
        if (o === 0) { ctx.fillStyle = tm.coatL; ctx.fillRect(px, top + yy, 2, 1); }
        if (yy % 9 === 4) { ctx.fillStyle = tm.coatD; ctx.fillRect(px + 2, top + yy, Math.max(1, sw - 4), 1); }
      }
    }
    // gold band and the team diamond, riding the same ripple as the cloth
    const my = top + 16, mx = x + (w >> 1) + wobAt(16);
    ctx.fillStyle = '#c89a3c';
    ctx.fillRect(mx - (w >> 1), my - 6, w, 1); ctx.fillRect(mx - (w >> 1), my + 6, w, 1);
    for (let d = -4; d <= 4; d++) {
      const dw = 4 - Math.abs(d);
      ctx.fillStyle = '#0a0e23'; ctx.fillRect(mx - dw - 1, my + d, dw * 2 + 3, 1);
    }
    for (let d = -3; d <= 3; d++) {
      const dw = 3 - Math.abs(d);
      ctx.fillStyle = d < 0 ? tm.trim : tm.mark; ctx.fillRect(mx - dw, my + d, dw * 2 + 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // a standing brazier: iron bowl on a stem, coals over the rim, a flickering
  // ember stack and warm additive light - the title pillar's fire, freed from
  // the pillar so it can flank the dais
  function drawWinBrazier(cx, baseY, now, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(cx - 2, baseY - 16, 4, 16); ctx.fillRect(cx - 7, baseY - 4, 14, 4);
    ctx.fillStyle = '#3a2a22'; ctx.fillRect(cx - 1, baseY - 15, 2, 13);
    ctx.fillStyle = '#5a4434'; ctx.fillRect(cx - 1, baseY - 15, 1, 13);
    ctx.fillStyle = '#2a3560'; ctx.fillRect(cx - 6, baseY - 3, 12, 3);
    ctx.fillStyle = '#4a5a90'; ctx.fillRect(cx - 6, baseY - 3, 12, 1);
    ctx.fillStyle = '#f4f7ff'; ctx.fillRect(cx - 6, baseY - 4, 5, 1); ctx.fillRect(cx + 2, baseY - 4, 4, 1);
    const by = baseY - 22;
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(cx - 8, by, 16, 7); ctx.fillRect(cx - 5, by + 7, 10, 1);
    ctx.fillStyle = '#3a2a22'; ctx.fillRect(cx - 7, by + 1, 14, 5);
    ctx.fillStyle = '#5a4434'; ctx.fillRect(cx - 7, by + 1, 14, 1);
    ctx.fillStyle = '#ff8a3c'; ctx.fillRect(cx - 5, by, 10, 1);
    const fl = now * 11 + cx;
    const hgt = 5 + Math.round(Math.sin(fl) + Math.sin(fl * 0.37) * 0.8);
    const rows = [[8, '#ffe37a'], [8, '#ffd95c'], [6, '#ffb347'], [4, '#ff8a3c'], [4, '#ff6a30'], [2, '#ff4a28'], [2, '#ff4a28']];
    for (let i = 0; i < Math.min(rows.length, hgt); i++) {
      const dx = i > 2 ? Math.round(Math.sin(fl * 1.3 + i * 1.7)) : 0;
      ctx.fillStyle = rows[i][1];
      ctx.fillRect(cx - (rows[i][0] >> 1) + dx, by - 1 - i, rows[i][0], 1);
    }
    drawEmbers(now, a * 0.9, cx, by - 5, 11, 7, (cx | 0) + 3);
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'lighter';
    const gr = 66 * (1 + Math.sin(now * 9 + cx) * 0.08), gy = by - 3;
    const grd = ctx.createRadialGradient(cx, gy, 1, cx, gy, gr);
    grd.addColorStop(0, 'rgba(255,170,80,' + (0.40 * a).toFixed(3) + ')');
    grd.addColorStop(0.45, 'rgba(255,140,60,' + (0.13 * a).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grd; ctx.fillRect(cx - gr, gy - gr, gr * 2, gr * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // the dais: a snow-capped slab the winner stands on, set on a wider base
  // step that carries a gold inlay with the team's diamond, icicles under the
  // lower lip. Two tiers rather than one - a single slab reads as a plank.
  function drawWinDais(cx, top, hw, tm, a) {
    ctx.globalAlpha = a;
    // one tier: dark rim, speckled snow cap, lit-left coursed stone face
    const step = (y, half, h, ice) => {
      const x = cx - half, w = half * 2;
      ctx.fillStyle = '#0a0e23'; ctx.fillRect(x - 2, y - 1, w + 4, h + 2);
      ctx.fillStyle = '#f4f7ff'; ctx.fillRect(x - 1, y, w + 2, 3);
      for (let px = 0; px < w + 2; px++) {
        const hb = hash2(px * 7 + 3, y * 5);
        if (hb > 0.82) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1 + px, y - 1, 1, 1); }
        else if (hb < 0.16) { ctx.fillStyle = '#dfe8f8'; ctx.fillRect(x - 1 + px, y + 2, 1, 1); }
      }
      ctx.fillStyle = '#b8cce6'; ctx.fillRect(x - 1, y + 3, w + 2, 1);
      ctx.fillStyle = '#2a3560'; ctx.fillRect(x, y + 4, w, h - 4);
      ctx.fillStyle = '#3a4878'; ctx.fillRect(x, y + 4, 2, h - 4);
      ctx.fillStyle = '#161d3c'; ctx.fillRect(x + w - 2, y + 4, 2, h - 4);
      for (let px = 2; px < w - 2; px++) for (let py = 5; py < h; py++) {
        if (hash2(px * 5 + py * 3, cx + 11) < 0.05) { ctx.fillStyle = '#1c2750'; ctx.fillRect(x + px, y + py, 1, 1); }
      }
      if (ice) {
        for (let px = 3; px < w - 3; px += 3) {
          const hb = hash2(px * 11 + 7, cx + y);
          if (hb < 0.5) continue;
          ctx.fillStyle = '#cfe4f2'; ctx.fillRect(x + px, y + h, 1, 2 + Math.round(hb * 3));
          ctx.fillStyle = '#f4f7ff'; ctx.fillRect(x + px, y + h, 1, 1);
        }
      }
      return { x, w };
    };
    step(top, hw, 10, false);
    const b = step(top + 10, hw + 14, 13, true);
    // gold inlay across the base, the team's diamond set in the middle of it
    const iy = top + 17;
    ctx.fillStyle = '#c89a3c'; ctx.fillRect(b.x + 5, iy, b.w - 10, 1);
    ctx.fillStyle = '#ffd95c'; ctx.fillRect(cx - 20, iy, 40, 1);
    for (let d = -3; d <= 3; d++) {
      const dw = 3 - Math.abs(d);
      ctx.fillStyle = '#0a0e23'; ctx.fillRect(cx - dw - 1, iy + d, dw * 2 + 3, 1);
    }
    for (let d = -2; d <= 2; d++) {
      const dw = 2 - Math.abs(d);
      ctx.fillStyle = d < 0 ? tm.mark : tm.coatD; ctx.fillRect(cx - dw, iy + d, dw * 2 + 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // one number: a chamfered plate, its icon on the left, the value at 2x. The
  // plate pops up as it arrives and the value climbs from zero behind it, the
  // rule going gold on the frame it lands.
  function drawWinStatPlate(r, st, ws, t, i) {
    const s0 = WIN_T.stats + i * WIN_T.statStep;
    if (t < s0) return;
    const pop = easeOut(Math.min(1, (t - s0) / 0.24));
    const y = r.y + Math.round((1 - pop) * 8);
    const roll = Math.min(1, Math.max(0, (t - s0) / WIN_T.roll));
    const txt = st.roll ? String(Math.round(Number(st.val(ws)) * roll)) : st.val(ws);
    const done = !st.roll || roll >= 1;
    ctx.globalAlpha = pop;
    ctx.fillStyle = 'rgba(4,6,18,0.55)'; chamRect(r.x + 2, r.y + 2, r.w, r.h);
    ctx.fillStyle = '#0a0e23'; chamRect(r.x, y, r.w, r.h);
    ctx.fillStyle = '#141c3c'; chamRect(r.x + 1, y + 1, r.w - 2, r.h - 2);
    ctx.fillStyle = done ? '#c89a3c' : '#35426e';
    ctx.fillRect(r.x + 2, y + 1, r.w - 4, 1); ctx.fillRect(r.x + 2, y + r.h - 2, r.w - 4, 1);
    const iy = y + ((r.h - 8) >> 1);
    if (st.icon === 'gold') ctx.drawImage(SPRITES.itemGold, r.x + 4, iy);
    else if (st.icon === 'kills') ctx.drawImage(SPRITES.itemBow, r.x + 4, iy);
    else stampGrid(st.icon === 'level' ? WIN_LVL_ICON : WIN_TIME_ICON, WIN_ICON_PAL, r.x + 4, iy, 1);
    drawPixelTextShadow(ctx, txt, r.x + 15, y + ((r.h - 10) >> 1), done ? '#ffd95c' : '#f4f7ff', '#0a0e23', 2);
    ctx.globalAlpha = 1;
  }

  function renderVictory(now) {
    const ws = state.win || (state.win = winSnapshot());
    const t = state.deadTimer;
    const L = winLayout();
    const tm = TEAMS[ws.team];
    const dim = Math.min(1, t / WIN_T.dim);

    // --- backdrop: wash, aurora, rays, vignette, flurry ---------------------
    ctx.fillStyle = 'rgba(7,10,26,' + (0.88 * dim).toFixed(3) + ')';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawWinAurora(now, dim, L.toy);
    drawWinRays(L.cx, L.toy + 110, now, dim);
    const vg = ctx.createRadialGradient(L.cx, L.toy + 120, VIEW_H * 0.22, L.cx, L.toy + 120, VIEW_W * 0.62);
    vg.addColorStop(0, 'rgba(3,5,16,0)');
    vg.addColorStop(1, 'rgba(3,5,16,' + (0.85 * dim).toFixed(3) + ')');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawWinMotes(now, dim, 52);

    // the white bloom off the last frame of the match, over the wash
    if (t < WIN_T.flash) {
      ctx.globalAlpha = Math.min(1, 1 - t / WIN_T.flash);
      ctx.fillStyle = '#f4f7ff'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }

    // --- the stage: braziers, banners, dais, the champion -------------------
    const rise = easeOut(Math.max(0, Math.min(1, (t - WIN_T.stage) / 0.55)));
    if (rise > 0) {
      const lift = Math.round((1 - rise) * 26);
      drawWinBrazier(L.cx - L.spread, L.daisY + 14, now, rise);
      drawWinBrazier(L.cx + L.spread, L.daisY + 14, now, rise);
      const bw = 22, bh = 78;
      for (const sx of [-1, 1]) {
        drawWinBanner(L.cx + sx * Math.round(L.spread * 0.62) - (bw >> 1),
          L.toy + 64 - lift, bw, bh, tm, rise, now);
      }
      drawWinDais(L.cx, L.daisY + lift, 40, tm, rise);
      // the champion: 5x, breathing in place, wearing the gear it finished in
      const bob = Math.round(Math.sin(now * 2.2) * 1.5);
      const bx = L.cx - 40, by = L.champY + lift + bob;
      ctx.globalAlpha = rise;
      ctx.drawImage(SPRITES.champ[ws.champ][ws.team].down[Math.sin(now * 2.2) > 0.6 ? 1 : 0], bx, by, 80, 80);
      drawGearMarks(ws, bx, by, 5);
      ctx.globalAlpha = 1;
      // the crown, dropped onto the head
      const ct = (t - WIN_T.crown) / (WIN_T.crownLand - WIN_T.crown);
      if (ct > 0) {
        const e = Math.min(1, ct);
        const cy = Math.round(by + 3 - (1 - e * e) * 70);
        stampGrid(WIN_CROWN, WIN_CROWN_PAL, L.cx - 19, cy + (ct > 1 && ct < 1.25 ? 1 : 0), 3, '#3c2a1e');
        if (ct >= 1 && ct < 1.6) { // a ring of sparks off the landing
          const f = (ct - 1) / 0.6;
          ctx.globalAlpha = 1 - f;
          for (let i = 0; i < 14; i++) {
            const ang = (i / 14) * Math.PI * 2, rr = 6 + f * 30;
            ctx.fillStyle = i & 1 ? '#ffd95c' : '#ffffff';
            ctx.fillRect(Math.round(L.cx + Math.cos(ang) * rr), Math.round(cy + 8 + Math.sin(ang) * rr * 0.6), 2, 2);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // --- the headline: VICTORY, one letter at a time ------------------------
    const TXT = 'VICTORY', S = 4;
    const tw = pixelTextWidth(TXT, S);
    const tx0 = Math.round((VIEW_W - tw) / 2);
    for (let i = 0; i < TXT.length; i++) {
      const lt = (t - WIN_T.title - i * WIN_T.letter) / WIN_T.land;
      if (lt <= 0) continue;
      const e = easeOut(Math.min(1, lt));
      const lx = tx0 + i * 4 * S;
      const ly = L.titleY - Math.round((1 - e) * 40);
      ctx.globalAlpha = Math.min(1, lt * 2.5);
      // a hot white frame on the beat it lands, gold from then on
      drawPixelTextOutline(ctx, TXT[i], lx, ly, lt < 1.12 ? '#ffffff' : '#ffd95c', '#2a1c10', S);
      ctx.globalAlpha = 1;
      if (lt >= 1 && lt < 1.5) { // snow kicked up where it hit
        const f = (lt - 1) / 0.5;
        ctx.globalAlpha = 1 - f;
        ctx.fillStyle = '#dfe8f8';
        for (let k = 0; k < 5; k++) {
          const h = hash2(i * 7 + k, 23);
          ctx.fillRect(Math.round(lx + h * 4 * S + (h - 0.5) * f * 22), Math.round(L.titleY + 5 * S - f * 9), 1, 1);
        }
        ctx.globalAlpha = 1;
      }
    }

    // the rule sweeps out of the middle, then the line that says who won
    if (t > WIN_T.rule) {
      drawGoldRule(L.cx, L.ruleY, Math.round((tw / 2 + 10) * easeOut(Math.min(1, (t - WIN_T.rule) / 0.4))), 1);
      const sub = ws.mates > 0 ? tm.name + ' HOLDS THE FROSTLANDS' : 'LAST ONE STANDING';
      ctx.globalAlpha = Math.min(1, (t - WIN_T.rule) / 0.5);
      drawPixelTextOutline(ctx, sub, Math.round((VIEW_W - pixelTextWidth(sub)) / 2), L.subY,
        ws.mates > 0 ? tm.mark : '#9fb6d8', '#0a0e23');
      ctx.globalAlpha = 1;
    }

    // --- the tally ----------------------------------------------------------
    const vals = WIN_STATS.map((st) => st.val(ws));
    const pw = 15 + Math.max.apply(null, vals.map((v) => pixelTextWidth(v, 2))) + 5;
    let sx = Math.round((VIEW_W - (WIN_STATS.length * pw + (WIN_STATS.length - 1) * 6)) / 2);
    for (let i = 0; i < WIN_STATS.length; i++) {
      drawWinStatPlate({ x: sx, y: L.statY, w: pw, h: 18 }, WIN_STATS[i], ws, t, i);
      sx += pw + 6;
    }

    // the kit it was won in: the four pieces at the material they reached,
    // carrying the same buy pips the in-match HUD row draws
    const gt = (t - (WIN_T.stats + WIN_STATS.length * WIN_T.statStep)) / 0.3;
    if (gt > 0) {
      ctx.globalAlpha = Math.min(1, gt);
      const gwAll = GEAR_SLOTS.length * GEAR_PLATE + (GEAR_SLOTS.length - 1) * GEAR_GAP;
      let gx = Math.round((VIEW_W - gwAll) / 2);
      ctx.fillStyle = '#0a0e23'; chamRect(gx - 4, L.gearY - 3, gwAll + 8, GEAR_PLATE + 6);
      ctx.fillStyle = '#141c3c'; chamRect(gx - 3, L.gearY - 2, gwAll + 6, GEAR_PLATE + 4);
      for (let i = 0; i < GEAR_SLOTS.length; i++) {
        const lv = ws.gearLv[i];
        ctx.fillStyle = lv >= GEAR_LV_MAX ? '#c89a3c' : '#35426e';
        ctx.fillRect(gx, L.gearY, GEAR_PLATE, GEAR_PLATE);
        ctx.fillStyle = '#0f1632';
        ctx.fillRect(gx + 1, L.gearY + 1, GEAR_PLATE - 2, GEAR_PLATE - 2);
        ctx.drawImage(SPRITES.gearIcons[i][ws.gear[i]][lv - 1], gx + 3, L.gearY + 2);
        for (let k = 0; k < GEAR_LV_MAX - 1; k++) {
          ctx.fillStyle = k < lv - 1 ? '#f2cc6a' : '#2c3560';
          ctx.fillRect(gx + 3 + k * 4, L.gearY + GEAR_PLATE - 3, 3, 1);
        }
        gx += GEAR_PLATE + GEAR_GAP;
      }
      ctx.globalAlpha = 1;
    }

    // --- the planks, sliding up to land exactly on WIN_T.menu ---------------
    if (t > WIN_T.menu - WIN_SLIDE) {
      const e = easeOut(Math.min(1, (t - (WIN_T.menu - WIN_SLIDE)) / WIN_SLIDE));
      ctx.globalAlpha = e;
      drawEndPlanks(now, Math.round((1 - e) * 16));
      ctx.globalAlpha = 1;
    }
  }
  // ------------------------------------------------------------ eagle drop
  // Nobody spawns in a camp: after LOCK IN every slot rides a great white eagle
  // along a seed-fixed line across the world (mode 'drop'). The view zooms out
  // to DROP_ZOOM, a chart in the corner shows the line and the bird, and the
  // rider jumps with Space/Enter/E/click (AI slots jump at their own hashed
  // fraction of the route). A jumper free-falls for FALL_T onto the nearest
  // open tile, which becomes its spawn tile (the bot brain's home); the human's landing snaps the
  // view back to the player's own zoom and runs the HUD slide-in. If the rider never jumps,
  // the end of the line jumps for them. state.drop outlives mode 'drop' - the
  // eagle keeps flying (and dropping bots) until it is off the map.
                              // the ride's framing is DROP_ZOOM (canvas banner): half scale, twice the view
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
    // the view grows around its centre; ease in from the drift's framing.
    // The eagle's framing is snapped rather than eased: the ride opens on a
    // cross-fade from the menu, and a zoom sliding under that reads as a stumble.
    const ow = WV_W, oh = WV_H;
    applyZoom(0, true);
    state.introFrom = { x: camX - (WV_W - ow) / 2, y: camY - (WV_H - oh) / 2 };
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
  // position and its spawn tile. Only the local landing changes the mode.
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
      applyZoom(0, true);               // back to the player's own zoom, centred on the landing
      camX = Math.max(0, Math.min(WORLD * TILE - WV_W, p.x - WV_W / 2));
      camY = Math.max(0, Math.min(WORLD * TILE - WV_H, p.y - WV_H / 2));
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
    if (sx > -w && sy > -h - DROP_ALT && sx < WV_W + w && sy < WV_H + h) {
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
  buildPatchPanel();
  rebuildLights();
  camX = player.x - WV_W / 2;
  camY = player.y - WV_H / 2;
  // landing from a reroll: the whiteout the die left behind clears to the new world
  try {
    if (sessionStorage.getItem('softfall.reroll')) {
      sessionStorage.removeItem('softfall.reroll');
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
    // the radial wheel: open one by hand (state.wheel) and read back the
    // geometry the hover test and the pixels both use
    wheelLayout, wheelSpan, wheelAng, WHEEL_HUB, WHEEL_R, WHEEL_RING,
    structures, robots, tracers, arrows, STRUCTS, TOOLS,
    // the quiver: the shafts lying in the world, the ceiling, and a way to set
    // a slot's ammo / renock without playing to it
    shafts, QUIVER_MAX, QUIVER_REGEN, SHAFT_LIFE, quiverRect, stickArrow,
    setQuiver: (n, p) => { const q = p || player; q.quiver = Math.max(0, Math.min(QUIVER_MAX, n)); q.fletchT = 0; return q.quiver; },
    setNock: (t, p) => { (p || player).nockT = t; },
    // multiplayer slots: every slot, the local one, and the teams table
    players, MAX_PLAYER_SLOTS, TEAMS, Player, ringPts, contestRank,
    // the eagle drop: the live flight record, force a jump, or fly the route from scratch
    get drop() { return state.drop; }, beginDrop, dropJump: (p) => dropJump(p || player), landPlayer, makeEagleRoute, inAir,
    get player() { return player; },
    get inv() { return player.inv; },
    // hand a slot to an AI, a human, or nobody (a ghost at its camp)
    setControl: (slot, mode) => { const p = players[slot]; if (p) p.control = mode; return p; },
    placeObj, rebuildLights, idx, objAt, hoverFish, damagePlayer, die, endMatch, specNext, aliveCount, updateAI, contest,
    // routes: the search itself, and showPaths = true draws every unit's live route
    findPath, walkable, navTo, showPaths: false,
    // hero levels: pay a slot gold (and XP) the way a pickup would
    gainGold: (n, p) => gainGold(p || player, n), LEVEL_XP, LEVEL_MAX,
    // gear: the table, a slot's effective kit, and buy/pick without the HUD
    GEAR, GEAR_SLOTS, GEAR_COSTS, kitOf, refreshKit, gearRects, gearHit,
    gearCost: (i, p) => gearCost(p || player, i),
    buyGear: (i, p) => buyGear(p || player, i),
    pickGear: (i, v) => pickGear(i, v), gearLayout, gearScreenHit, beginGear,
    setGear: (i, v, p) => { const q = p || player; q.gear[i] = v; refreshKit(q); return q.kit; },
    // the match readouts: stage feed lines without staging the kills behind
    // them, and check the standings (hold TAB in game, or set keys.tab here)
    events, logEvent, scoreGroups, scoreboardOpen,
    // the four-second replay: the filmstrip itself, how much is banked, and whether it is up
    replay: {
      get cv() { return rpAt; }, get frames() { return rpCount; }, showing: replayShowing,
      get shot() { return [rpFW[(rpHead - 1 + RP_N) % RP_N], rpFH[(rpHead - 1 + RP_N) % RP_N]]; },
      get slot() { return [rpSW, rpSH]; }, get bytes() { return rpAt ? rpAt.width * rpAt.height * 4 : 0; },
      W: RP_W, H: RP_H, fps: RP_FPS, rate: RP_RATE, ov: rpOv,
    },
    // action entry points default to the local slot, or take any player
    clickAction: (p) => clickAction(p || player),
    tryWork: (p) => tryWork(p || player),
    workTarget: (p) => workTarget(p || player),
    fireArrow: (p) => fireArrow(p || player),
    tryDodge: (p) => tryDodge(p || player),
    // prone: the burrow toggle, how buried a slot reads to anything hunting it,
    // and a way to stage a fully covered body without lying in the snow for 1.5s
    tryProne: (p) => tryProne(p || player),
    risePlayer: (p) => risePlayer(p || player),
    concealOf: (p) => concealOf(p || player),
    seenAt: (range, p) => seenAt(p || player, range),
    ambushReady: (p) => ambushReady(p || player),
    setHide: (h, p) => {
      const q = p || player;
      q.hide = Math.max(0, Math.min(1, h));
      q.prone = q.hide > 0 || q.prone;
      return q.hide;
    },
    PRONE_BURY, PRONE_SPEED, PRONE_SNIFF, PRONE_CUT, PRONE_MOVE, PRONE_MAP, AMBUSH_MUL,
    spawnAnimal: (kind, x, y) => { const a = makeAnimal(kind, x, y); animals.push(a); return a; },
    // debug staging: place a construction site directly, no cost or validation
    buildStruct: (tx, ty, type, tier) => {
      const t = Math.min(STRUCTS[type].tiers.length - 1, tier || 0);
      return createStruct(tx, ty, type, t, player, true); // anchor = top-left for a big footprint
    },
    findSite, structOf, footprint,
    finishBuild: (o) => { if (o && o.building) o.buildT = o.buildTotal; },
    // z is a world scale; it lands on the nearest pixel-exact rung, as the
    // wheel does. snap skips the ease. setK sets the rung itself.
    setZoom: (z, snap) => { kWant = Math.max(kMin(), Math.min(kMax(), Math.round((+z || 1) * devScale))); if (snap) applyZoom(0, true); },
    setK: (k, snap) => { kWant = Math.max(kMin(), Math.min(kMax(), k | 0)); if (snap) applyZoom(0, true); },
    getZoom: () => ({ want: zoomWantOf(), applied: zoomCur, k: kWant, devScale, exact: Math.abs(zoomCur * devScale - Math.round(zoomCur * devScale)) < 1e-6,
      rungs: (() => { const r = []; for (let k = kMin(); k <= kMax(); k++) r.push(+(k / devScale).toFixed(4)); return r; })(),
      wv: [WV_W, WV_H], mm: mmScale() }),
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
