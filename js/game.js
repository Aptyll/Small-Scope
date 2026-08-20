// Emberfrost - a cozy winter survival game.
(function () {
  'use strict';

  // ------------------------------------------------------------ constants
  const TILE = 16;
  const WORLD = 192;                // tiles per side
  const BORDER_MIN = 30, BORDER_MAX = 70; // forest boundary depth range (avg ~50)
  const VIEW_W = 480, VIEW_H = 270; // internal resolution
  const DAY_LEN = 110, NIGHT_LEN = 55;
  const CYCLE = DAY_LEN + NIGHT_LEN;
  const PLAYER_SPEED = 72;
  const PLAYER_R = 4.5;

  const BUILDS = [
    null, // slot 0 = axe
    { key: 'wall',  name: 'WALL',  cost: { wood: 4, stone: 0, berry: 0 }, hp: 60 },
    { key: 'spike', name: 'SPIKES', cost: { wood: 2, stone: 2, berry: 0 }, hp: 14 },
    { key: 'torch', name: 'TORCH', cost: { wood: 2, stone: 0, berry: 0 }, hp: 20 },
    { key: 'fire',  name: 'CAMPFIRE', cost: { wood: 8, stone: 4, berry: 0 }, hp: 90 },
  ];

  // ------------------------------------------------------------ canvas
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let scale = 2;
  function fitCanvas() {
    scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H)));
    canvas.style.width = (VIEW_W * scale) + 'px';
    canvas.style.height = (VIEW_H * scale) + 'px';
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // offscreen light canvas
  const lightCv = document.createElement('canvas');
  lightCv.width = VIEW_W; lightCv.height = VIEW_H;
  const lctx = lightCv.getContext('2d');

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
  const rng = mulberry32(20260819);
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
    hints: { build: false, dusk: false, raiders: false },
    paused: false,
    mapOpen: false,
    settingsOpen: false,
  };

  const settings = { volume: 0.5, mmR: 24, shake: true, muted: false };

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

  const player = {
    x: (WORLD / 2 + 0.5) * TILE, y: (WORLD / 2 + 0.5) * TILE,
    vx: 0, vy: 0,
    dir: 'down', moving: false, animT: 0,
    hp: 100, maxHp: 100,
    cold: 0,
    swingT: 0, swingCd: 0, swingDir: 0, swingHitDone: false,
    hurtT: 0, invuln: 0,
    footT: 0, footSide: 0,
  };

  const inv = { wood: 0, stone: 0, berry: 0, gold: 0 };
  let hotbar = 0;

  const raiders = [];
  const drops = [];
  const particles = [];
  const floaters = [];
  const footprints = [];
  const lights = []; // rebuilt from placed objects
  let toSpawn = 0, spawnTimer = 0, nightActive = false;

  // ------------------------------------------------------------ input
  const keys = {};
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false };

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (state.mode !== 'play') return;
    if (e.key >= '1' && e.key <= '5') hotbar = +e.key - 1;
    if (e.key.toLowerCase() === 'q') eatBerry();
    if (e.key.toLowerCase() === 'm' && !state.settingsOpen) state.mapOpen = !state.mapOpen;
    if (e.key.toLowerCase() === 'escape') {
      if (state.mapOpen) state.mapOpen = false;
      else { state.settingsOpen = !state.settingsOpen; dragSlider = null; }
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
    if (e.button !== 0) return;
    if (state.mode === 'title') { startGame(); return; }
    if (state.mode !== 'play') return;
    if (state.settingsOpen) { mouse.down = true; settingsMouseDown(); return; }
    if (state.mapOpen) return;
    mouse.down = true;
    clickAction();
  });
  window.addEventListener('mouseup', () => {
    if (dragSlider) { saveSettings(); SFX.pickup(); }
    mouse.down = false;
    dragSlider = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    if (state.mode !== 'play') return;
    e.preventDefault();
    if (state.mapOpen) return;
    hotbar = (hotbar + (e.deltaY > 0 ? 1 : 4)) % 5;
  }, { passive: false });

  // ------------------------------------------------------------ world
  const ground = new Uint8Array(WORLD * WORLD); // 0 snow, 1 ice
  const objects = new Array(WORLD * WORLD).fill(null);

  function idx(tx, ty) { return ty * WORLD + tx; }
  function inWorld(tx, ty) { return tx >= 0 && ty >= 0 && tx < WORLD && ty < WORLD; }
  function objAt(tx, ty) { return inWorld(tx, ty) ? objects[idx(tx, ty)] : null; }

  function isSolidTile(tx, ty) {
    if (!inWorld(tx, ty)) return true;
    const o = objects[idx(tx, ty)];
    if (!o) return false;
    return o.type === 'tree' || o.type === 'rock' || o.type === 'wall' || o.type === 'fire' ||
      o.type === 'mine' || o.type === 'goldore';
  }

  function placeObj(tx, ty, type, extra) {
    const o = Object.assign({ type, tx, ty, hp: 1, flash: 0, shake: 0 }, extra || {});
    objects[idx(tx, ty)] = o;
    return o;
  }

  const cx = WORLD / 2, cy = WORLD / 2;

  // four quadrant spawn pockets (FFA start positions); player takes slot 0
  const SPAWN_D = 41;
  const spawnPts = [
    { tx: cx - SPAWN_D, ty: cy - SPAWN_D }, { tx: cx + SPAWN_D, ty: cy - SPAWN_D },
    { tx: cx - SPAWN_D, ty: cy + SPAWN_D }, { tx: cx + SPAWN_D, ty: cy + SPAWN_D },
  ];
  const playerSpawn = spawnPts[0];
  const oreSpots = []; // gold ore positions around the mine, respawned each dawn

  // depth of the forest boundary at a given tile: smooth irregular inner edge,
  // always solid from the world edge inward (variation eats into the interior)
  function borderDepth(tx, ty) {
    let n = vnoise(tx / 22, ty / 22) * 0.65 + vnoise(tx / 9 + 40, ty / 9 + 40) * 0.35;
    n = Math.max(0, Math.min(1, (n - 0.5) * 1.6 + 0.5)); // stretch toward full range
    return BORDER_MIN + (BORDER_MAX - BORDER_MIN) * n;
  }

  function genWorld() {
    // solid irregular forest boundary - players carve their base out of this
    for (let ty = 0; ty < WORLD; ty++) {
      for (let tx = 0; tx < WORLD; tx++) {
        const d = Math.min(tx, ty, WORLD - 1 - tx, WORLD - 1 - ty);
        if (d < borderDepth(tx, ty)) placeObj(tx, ty, 'tree', { hp: 4, variant: randi(0, 1) });
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

    // central gold mine on a rocky plaza
    const PLAZA_R = 8;
    for (let ty = cy - PLAZA_R - 2; ty <= cy + PLAZA_R + 2; ty++) {
      for (let tx = cx - PLAZA_R - 2; tx <= cx + PLAZA_R + 2; tx++) {
        if (!inWorld(tx, ty)) continue;
        if (Math.hypot(tx - cx, ty - cy) <= PLAZA_R + (hash2(tx, ty) - 0.5) * 2.5) {
          ground[idx(tx, ty)] = 2;
          objects[idx(tx, ty)] = null;
        }
      }
    }
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      placeObj(cx - 1 + dx, cy - 1 + dy, 'mine', { part: dy * 2 + dx, hp: 9999 });
    }
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
    for (let l = 0; l < 7; l++) {
      let px = 0, py = 0, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        px = randi(BORDER_MIN + 6, WORLD - 1 - BORDER_MIN - 6);
        py = randi(BORDER_MIN + 6, WORLD - 1 - BORDER_MIN - 6);
        ok = !objects[idx(px, py)] && ground[idx(px, py)] === 0 &&
          Math.hypot(px - cx, py - cy) > 16 && !nearAnySpawn(px, py, 16);
      }
      if (!ok) continue;
      let n = randi(50, 110);
      let wx = px, wy = py;
      while (n-- > 0) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const tx = wx + dx, ty = wy + dy;
          if (inWorld(tx, ty) && !objects[idx(tx, ty)] && ground[idx(tx, ty)] === 0 &&
            Math.hypot(tx - cx, ty - cy) > PLAZA_R + 3 && !nearAnySpawn(tx, ty, 10)) ground[idx(tx, ty)] = 1;
        }
        wx += randi(-1, 1); wy += randi(-1, 1);
        wx = Math.max(4, Math.min(WORLD - 5, wx));
        wy = Math.max(4, Math.min(WORLD - 5, wy));
      }
    }

    function free(tx, ty) {
      return inWorld(tx, ty) && !objects[idx(tx, ty)] && ground[idx(tx, ty)] === 0;
    }
    function nearSpawn(tx, ty) {
      return spawnPts.some((p) => Math.hypot(tx - p.tx, ty - p.ty) < 8);
    }

    // no interior trees: wood only grows at the forest boundary.
    // rocks
    for (let c = 0; c < 55; c++) {
      const ox = randi(BORDER_MIN, WORLD - 1 - BORDER_MIN), oy = randi(BORDER_MIN, WORLD - 1 - BORDER_MIN);
      const n = randi(1, 4);
      for (let i = 0; i < n; i++) {
        const tx = ox + Math.round(rand(-1.6, 1.6));
        const ty = oy + Math.round(rand(-1.6, 1.6));
        if (free(tx, ty) && !nearSpawn(tx, ty) && Math.hypot(tx - cx, ty - cy) > PLAZA_R + 3) {
          placeObj(tx, ty, 'rock', { hp: 5, variant: randi(0, 1) });
        }
      }
    }
    // berry bushes
    for (let c = 0; c < 48; c++) {
      const tx = randi(BORDER_MIN, WORLD - 1 - BORDER_MIN), ty = randi(BORDER_MIN, WORLD - 1 - BORDER_MIN);
      if (free(tx, ty) && !nearSpawn(tx, ty) && Math.hypot(tx - cx, ty - cy) > PLAZA_R + 3) {
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
    let h = (x * 374761393 + y * 668265263) | 0;
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

  function renderGround() {
    const g = groundCv.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let ty = 0; ty < WORLD; ty++) {
      for (let tx = 0; tx < WORLD; tx++) {
        const px = tx * TILE, py = ty * TILE;
        const gv = ground[idx(tx, ty)];
        const ice = gv === 1;
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
          // rocky mine plaza: frost-dusted gravel
          quad(g, '#a4a4b2', '#9c9caa');
          if (h > 0.55) {
            g.fillStyle = '#8a8a98';
            g.fillRect(px + ((h * 90) | 0) % 11 + 2, py + ((h * 57) | 0) % 11 + 2, 3, 2);
          }
          if (h > 0.8) {
            g.fillStyle = '#74747f';
            g.fillRect(px + ((h * 130) | 0) % 12 + 1, py + ((h * 210) | 0) % 12 + 1, 2, 1);
          }
          if (h < 0.14) {
            g.fillStyle = '#b8b8c6';
            g.fillRect(px + ((h * 500) | 0) % 12 + 2, py + ((h * 800) | 0) % 12 + 2, 2, 2);
          }
          // snow dust rim where plaza meets snow
          g.fillStyle = '#c8ccd8';
          if (!inWorld(tx, ty - 1) || ground[idx(tx, ty - 1)] === 0) g.fillRect(px, py, TILE, 1);
          if (!inWorld(tx, ty + 1) || ground[idx(tx, ty + 1)] === 0) g.fillRect(px, py + TILE - 1, TILE, 1);
          if (!inWorld(tx - 1, ty) || ground[idx(tx - 1, ty)] === 0) g.fillRect(px, py, 1, TILE);
          if (!inWorld(tx + 1, ty) || ground[idx(tx + 1, ty)] === 0) g.fillRect(px + TILE - 1, py, 1, TILE);
        } else if (ice) {
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
    }
  }

  // ------------------------------------------------------------ helpers
  function showMsg(t, dur) { state.msg = t; state.msgT = dur || 5; }

  function addFloater(x, y, txt, color) {
    floaters.push({ x, y, txt, color: color || '#ffffff', t: 0 });
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

  function canAfford(cost) { return inv.wood >= cost.wood && inv.stone >= cost.stone; }
  function pay(cost) { inv.wood -= cost.wood; inv.stone -= cost.stone; }

  function eatBerry() {
    if (inv.berry <= 0 || player.hp >= player.maxHp) return;
    inv.berry--;
    player.hp = Math.min(player.maxHp, player.hp + 20);
    SFX.eat(); setTimeout(() => SFX.heal(), 90);
    addFloater(player.x, player.y - 14, '+20', '#8fe08a');
    burst(player.x, player.y - 8, '#f2707a', 6, 30, 0.4);
  }

  // ------------------------------------------------------------ movement & collision
  function moveEntity(e, dx, dy, r) {
    let blockedX = false, blockedY = false;
    // X axis
    if (dx !== 0) {
      const nx = e.x + dx;
      const x0 = Math.floor((nx - r) / TILE), x1 = Math.floor((nx + r) / TILE);
      const y0 = Math.floor((e.y - r) / TILE), y1 = Math.floor((e.y + r) / TILE);
      let hit = false;
      for (let ty = y0; ty <= y1; ty++) {
        const tx = dx > 0 ? x1 : x0;
        if (isSolidTile(tx, ty)) hit = true;
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
        if (isSolidTile(tx, ty)) hit = true;
      }
      if (!hit) e.y = ny; else blockedY = true;
    }
    return { blockedX, blockedY };
  }

  // ------------------------------------------------------------ actions
  function clickAction() {
    SFX.unlock();
    if (hotbar === 0) {
      trySwing();
    } else {
      tryPlace();
    }
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

    // 1) monsters first
    let hitSomething = false;
    for (const m of raiders) {
      if (Math.hypot(m.x - reachX, m.y - reachY) < 13) {
        m.hp -= 10;
        m.flash = 0.12;
        m.squash = 0.2;
        const kb = 90;
        m.kbx = Math.cos(player.swingDir) * kb;
        m.kby = Math.sin(player.swingDir) * kb;
        burst(m.x, m.y - 4, '#c6ecf4', 7, 45, 0.4);
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
    if (!best) return;
    hitObject(best);
  }

  function hitObject(o) {
    const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
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
        spawnDrop(ox, oy, 'wood'); spawnDrop(ox, oy, 'wood');
        burst(ox, oy - 8, '#eef4fb', 14, 55, 0.7, true);
        burst(ox, oy - 8, '#2f5c4b', 8, 45, 0.6, true);
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
    } else if (o.type === 'mine') {
      SFX.deny();
      o.shake = 0;
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
    } else if (o.type === 'wall' || o.type === 'torch' || o.type === 'fire' || o.type === 'spike') {
      o.hp -= 10;
      SFX.hit();
      burst(ox, oy - 4, '#a3794f', 5, 40, 0.4, true);
      if (o.hp <= 0) destroyStructure(o, true);
    }
  }

  function destroyStructure(o, refund) {
    objects[idx(o.tx, o.ty)] = null;
    const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
    SFX.break_();
    burst(ox, oy, '#8a6142', 10, 50, 0.5, true);
    burst(ox, oy, '#eef4fb', 6, 40, 0.5, true);
    if (refund) {
      const b = BUILDS.find(b => b && b.key === o.type);
      if (b) {
        for (let i = 0; i < Math.floor(b.cost.wood / 2); i++) spawnDrop(ox, oy, 'wood');
        for (let i = 0; i < Math.floor(b.cost.stone / 2); i++) spawnDrop(ox, oy, 'stone');
      }
    }
    rebuildLights();
  }

  function tryPlace() {
    const b = BUILDS[hotbar];
    const tx = Math.floor((mouse.x + camX) / TILE), ty = Math.floor((mouse.y + camY) / TILE);
    if (!placementValid(tx, ty)) { SFX.deny(); return; }
    if (!canAfford(b.cost)) {
      SFX.deny();
      showMsg('NOT ENOUGH RESOURCES', 1.6);
      return;
    }
    pay(b.cost);
    const o = placeObj(tx, ty, b.key, { hp: b.hp, maxHp: b.hp });
    if (b.key === 'fire') { o.anim = rng() * 3; state.lastFire = o; }
    if (b.key === 'torch') o.anim = rng() * 2;
    SFX.place();
    burst(tx * TILE + 8, ty * TILE + 8, '#eef4fb', 8, 40, 0.4, true);
    rebuildLights();
  }

  function placementValid(tx, ty) {
    if (!inWorld(tx, ty)) return false;
    if (objects[idx(tx, ty)]) return false;
    const cxp = tx * TILE + 8, cyp = ty * TILE + 8;
    if (Math.hypot(cxp - player.x, cyp - player.y) > 60) return false;
    // don't trap yourself: block placing solid on player's tile
    const b = BUILDS[hotbar];
    if (b && (b.key === 'wall' || b.key === 'fire')) {
      if (Math.abs(cxp - player.x) < 8 + PLAYER_R && Math.abs(cyp - player.y) < 8 + PLAYER_R) return false;
    }
    return true;
  }

  function rebuildLights() {
    lights.length = 0;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (!o) continue;
      if (o.type === 'fire') lights.push({ x: o.tx * TILE + 8, y: o.ty * TILE + 6, r: 92, warm: 88, o });
      if (o.type === 'torch') lights.push({ x: o.tx * TILE + 8, y: o.ty * TILE + 2, r: 54, warm: 46, o });
    }
  }

  // ------------------------------------------------------------ raiders
  function spawnRaider() {
    // raiders climb out of the gold mine at night
    for (let tries = 0; tries < 40; tries++) {
      const a = rng() * Math.PI * 2;
      const d = rand(2.5, 6.5) * TILE;
      const x = cx * TILE + Math.cos(a) * d;
      const y = cy * TILE + Math.sin(a) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!inWorld(tx, ty) || isSolidTile(tx, ty)) continue;
      const n = state.day;
      raiders.push({
        x, y, hp: 24 + (n - 1) * 7, maxHp: 24 + (n - 1) * 7,
        speed: rand(27, 34) + Math.min(16, n * 1.5),
        t: rng() * 10, attackCd: 0, flash: 0, squash: 0,
        kbx: 0, kby: 0, jitterT: 0, jitterA: 0, spikeCd: 0, spawnT: 0.6,
        dir: 'down', animT: rng() * 2,
      });
      burst(x, y, '#55506e', 10, 40, 0.5);
      return;
    }
  }

  function updateRaider(m, dt) {
    m.t += dt;
    m.flash = Math.max(0, m.flash - dt);
    m.squash = Math.max(0, m.squash - dt);
    m.attackCd = Math.max(0, m.attackCd - dt);
    m.spikeCd = Math.max(0, m.spikeCd - dt);
    if (m.spawnT > 0) { m.spawnT -= dt; return; }

    // knockback decay
    m.kbx *= Math.pow(0.02, dt); m.kby *= Math.pow(0.02, dt);

    let dx = player.x - m.x, dy = player.y - m.y;
    const dist = Math.hypot(dx, dy) || 1;
    dx /= dist; dy /= dist;

    if (m.jitterT > 0) {
      m.jitterT -= dt;
      const ca = Math.cos(m.jitterA), sa = Math.sin(m.jitterA);
      const ndx = dx * ca - dy * sa, ndy = dx * sa + dy * ca;
      dx = ndx; dy = ndy;
    }

    // walking facing + animation for the player-like sprite
    if (Math.abs(dx) > Math.abs(dy)) m.dir = dx > 0 ? 'right' : 'left';
    else m.dir = dy > 0 ? 'down' : 'up';
    m.animT += dt * 8;

    const mv = moveEntity(m,
      (dx * m.speed + m.kbx) * dt,
      (dy * m.speed + m.kby) * dt, 4);

    if ((mv.blockedX || mv.blockedY) && m.attackCd <= 0) {
      // what blocked us? check the tile we're pushing toward
      const ftx = Math.floor((m.x + dx * 7) / TILE);
      const fty = Math.floor((m.y + dy * 7) / TILE);
      const o = objAt(ftx, fty);
      if (o && (o.type === 'wall' || o.type === 'fire' || o.type === 'torch')) {
        o.hp -= 7;
        o.flash = 0.12; o.shake = 0.2;
        m.attackCd = 0.95;
        m.squash = 0.25;
        SFX.hit();
        burst(ftx * TILE + 8, fty * TILE + 8, '#a3794f', 4, 35, 0.35, true);
        if (o.hp <= 0) destroyStructure(o, false);
      } else if (mv.blockedX && mv.blockedY) {
        m.jitterT = rand(0.5, 1.1);
        m.jitterA = (rng() < 0.5 ? 1 : -1) * rand(0.6, 1.3);
      } else if (rng() < 0.02) {
        m.jitterT = rand(0.4, 0.9);
        m.jitterA = (rng() < 0.5 ? 1 : -1) * rand(0.6, 1.3);
      }
    }

    // spikes
    const stx = Math.floor(m.x / TILE), sty = Math.floor(m.y / TILE);
    const so = objAt(stx, sty);
    if (so && so.type === 'spike' && m.spikeCd <= 0) {
      m.hp -= 7;
      m.flash = 0.12;
      m.spikeCd = 0.55;
      so.hp -= 1;
      m.kbx = -dx * 70; m.kby = -dy * 70;
      burst(m.x, m.y - 4, '#c6ecf4', 5, 40, 0.35);
      SFX.hit();
      if (so.hp <= 0) destroyStructure(so, false);
    }

    // touch player
    if (dist < 10 && m.attackCd <= 0 && player.invuln <= 0) {
      m.attackCd = 0.9;
      damagePlayer(8 + state.day, dx, dy);
      m.kbx = -dx * 60; m.kby = -dy * 60;
    }

    if (m.hp <= 0) {
      m.dead = true;
      SFX.monsterDie();
      burst(m.x, m.y - 5, '#8f8ba0', 14, 60, 0.6);
      burst(m.x, m.y - 5, '#ff6a5a', 6, 40, 0.5);
      if (rng() < 0.25) spawnDrop(m.x, m.y, 'berry');
    }
  }

  function damagePlayer(dmg, dx, dy) {
    player.hp -= dmg;
    player.hurtT = 0.25;
    player.invuln = 0.7;
    player.kbx = dx * 110; player.kby = dy * 110;
    state.shake = Math.max(state.shake, 3);
    SFX.hurt();
    burst(player.x, player.y - 6, '#e04a54', 8, 50, 0.45);
    if (player.hp <= 0) die();
  }

  function die() {
    state.mode = 'dead';
    state.mapOpen = false;
    state.settingsOpen = false;
    state.deadTimer = 0;
    inv.wood = Math.ceil(inv.wood * 0.6);
    inv.stone = Math.ceil(inv.stone * 0.6);
    inv.berry = Math.ceil(inv.berry * 0.6);
    inv.gold = Math.ceil(inv.gold * 0.6);
  }

  function respawn() {
    // nearest surviving campfire, else world center
    let best = null, bd = 1e9;
    for (const o of objects) {
      if (o && o.type === 'fire') {
        const d = Math.hypot(o.tx * TILE - player.x, o.ty * TILE - player.y);
        if (d < bd) { bd = d; best = o; }
      }
    }
    if (best) {
      player.x = best.tx * TILE + 8 + 18;
      player.y = best.ty * TILE + 8 + 10;
    } else {
      player.x = (playerSpawn.tx + 0.5) * TILE;
      player.y = (playerSpawn.ty + 0.5) * TILE;
    }
    player.hp = player.maxHp;
    player.cold = 0;
    player.invuln = 3;
    player.kbx = player.kby = 0;
    state.mode = 'play';
    showMsg('YOU WOKE BY THE FIRE  -  SOME SUPPLIES LOST', 4);
  }

  // ------------------------------------------------------------ update
  let camX = 0, camY = 0;

  function warmthAt(x, y) {
    let w = 0;
    for (const L of lights) {
      const d = Math.hypot(L.x - x, L.y - y);
      if (d < L.warm) w = Math.max(w, 1 - d / L.warm);
    }
    return w;
  }

  function update(dt) {
    // time
    if (state.mode === 'play') {
      state.time += dt;
      state.elapsed += dt;
      if (state.time >= CYCLE) {
        state.time -= CYCLE;
        state.day++;
        SFX.dawnChime();
        showMsg('DAY ' + state.day, 3);
        // fresh gold veins each dawn keeps the mine worth contesting
        for (const s of oreSpots) {
          if (!objects[idx(s.tx, s.ty)]) placeObj(s.tx, s.ty, 'goldore', { hp: 6, maxHp: 6 });
        }
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

    // night waves
    if (dark > 0.65 && !nightActive && state.mode === 'play') {
      nightActive = true;
      toSpawn = Math.min(22, 3 + (state.day - 1) * 2);
      spawnTimer = 1.5;
      SFX.nightSting();
      if (!state.hints.raiders) {
        showMsg('RAIDERS POUR FROM THE GOLD MINE - GET BEHIND YOUR DEFENSES', 5);
        state.hints.raiders = true;
      }
    }
    if (dark < 0.3 && nightActive) {
      nightActive = false;
      toSpawn = 0;
      for (const m of raiders) {
        burst(m.x, m.y - 4, '#c6ecf4', 10, 45, 0.5);
      }
      raiders.length = 0;
    }
    if (nightActive && toSpawn > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnRaider();
        toSpawn--;
        spawnTimer = (NIGHT_LEN * 0.55) / Math.max(1, 3 + (state.day - 1) * 2);
      }
    }

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

    moveEntity(player,
      (mx * PLAYER_SPEED + player.kbx) * dt,
      (my * PLAYER_SPEED + player.kby) * dt, PLAYER_R);

    player.x = Math.max(8, Math.min(WORLD * TILE - 8, player.x));
    player.y = Math.max(8, Math.min(WORLD * TILE - 8, player.y));

    if (player.moving) {
      player.animT += dt * 9;
      player.footT -= dt;
      if (player.footT <= 0) {
        player.footT = 0.16;
        player.footSide = 1 - player.footSide;
        const side = player.footSide ? 2 : -2;
        const px = player.dir === 'left' || player.dir === 'right' ? player.x : player.x + side;
        const py = player.dir === 'left' || player.dir === 'right' ? player.y + 6 + (player.footSide ? 1 : -1) : player.y + 6;
        footprints.push({ x: px, y: py, t: 0 });
        if (footprints.length > 90) footprints.shift();
      }
    } else {
      player.animT = 0;
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
    if (mouse.down && hotbar === 0 && player.swingCd <= 0) trySwing();

    player.hurtT = Math.max(0, player.hurtT - dt);
    player.invuln = Math.max(0, player.invuln - dt);

    // warmth & cold
    const warm = warmthAt(player.x, player.y);
    if (state.darkness > 0.5 && warm < 0.15) {
      player.cold = Math.min(100, player.cold + dt * 7);
    } else {
      const rate = warm > 0.15 ? 40 : 14;
      player.cold = Math.max(0, player.cold - dt * rate);
    }
    if (player.cold >= 100) {
      player.hp -= dt * 3.5;
      if (player.hp <= 0) { die(); return; }
    }
    // gentle regen near fire / in daylight
    if (player.hp < player.maxHp) {
      if (warm > 0.3) player.hp = Math.min(player.maxHp, player.hp + dt * 2.2);
      else if (state.darkness < 0.3) player.hp = Math.min(player.maxHp, player.hp + dt * 0.6);
    }

    // raiders
    for (const m of raiders) updateRaider(m, dt);
    for (let i = raiders.length - 1; i >= 0; i--) if (raiders[i].dead) raiders.splice(i, 1);

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
        if (!state.hints.build && inv.wood >= 8) {
          state.hints.build = true;
          showMsg('PRESS 2-5 TO BUILD  -  A CAMPFIRE KEEPS YOU WARM AT NIGHT', 6);
        }
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

    // dusk warning
    if (!state.hints.dusk && state.darkness > 0.15 && state.darkness < 0.5) {
      state.hints.dusk = true;
      showMsg('NIGHT IS COMING - BUILD A CAMPFIRE AND STAY WARM', 5);
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
      footprints[i].t += dt;
      if (footprints[i].t > 9) footprints.splice(i, 1);
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
      sctx.fillStyle = 'rgba(255,255,255,0.55)';
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

    // ground
    ctx.drawImage(groundCv, ox, oy, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

    // footprints
    for (const f of footprints) {
      const a = Math.max(0, 1 - f.t / 9) * 0.6;
      ctx.fillStyle = 'rgba(122,150,192,' + a.toFixed(3) + ')';
      ctx.fillRect(Math.round(f.x - ox) - 1, Math.round(f.y - oy), 2, 2);
    }

    // visible tile range
    const tx0 = Math.max(0, Math.floor(ox / TILE) - 1);
    const ty0 = Math.max(0, Math.floor(oy / TILE) - 1);
    const tx1 = Math.min(WORLD - 1, Math.ceil((ox + VIEW_W) / TILE) + 1);
    const ty1 = Math.min(WORLD - 1, Math.ceil((oy + VIEW_H) / TILE) + 2);

    // flat objects first (spikes, stumps)
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const o = objects[idx(tx, ty)];
        if (!o) continue;
        const px = tx * TILE - ox, py = ty * TILE - oy;
        if (o.type === 'spike') drawSpriteFlash(SPRITES.spikes, px, py, o.flash);
        else if (o.type === 'stump') ctx.drawImage(SPRITES.stump, px, py + 10);
      }
    }

    // ghost placement
    if (state.mode === 'play' && hotbar > 0) {
      const gtx = Math.floor((mouse.x + camX) / TILE);
      const gty = Math.floor((mouse.y + camY) / TILE);
      const ok = placementValid(gtx, gty) && canAfford(BUILDS[hotbar].cost);
      const px = gtx * TILE - ox, py = gty * TILE - oy;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = ok ? '#7ce88a' : '#e85a5a';
      ctx.fillRect(px, py, TILE, TILE);
      ctx.globalAlpha = 0.55;
      const key = BUILDS[hotbar].key;
      const spr = key === 'wall' ? SPRITES.wall : key === 'spike' ? SPRITES.spikes :
        key === 'torch' ? SPRITES.torch[0] : SPRITES.fire[0];
      if (key === 'torch') ctx.drawImage(spr, px + 4, py + 1);
      else ctx.drawImage(spr, px, py);
      ctx.globalAlpha = 1;
    }

    // drops (under entities)
    for (const d of drops) {
      const spr = d.type === 'wood' ? SPRITES.itemWood : d.type === 'stone' ? SPRITES.itemStone :
        d.type === 'gold' ? SPRITES.itemGold : SPRITES.itemBerry;
      // shadow
      ctx.fillStyle = 'rgba(120,140,175,0.35)';
      ctx.fillRect(Math.round(d.x - ox) - 2, Math.round(d.y - oy) + 2, 4, 2);
      ctx.drawImage(spr, Math.round(d.x - ox) - 4, Math.round(d.y - d.z - oy) - 4);
    }

    // y-sorted entities
    const draws = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const o = objects[idx(tx, ty)];
        if (!o || o.type === 'spike' || o.type === 'stump') continue;
        if (o.type === 'mine') {
          if (o.part !== 0) continue;
          draws.push({ y: ty * TILE + 32, o, tx, ty }); // sorts by its 2-tile base
          continue;
        }
        draws.push({ y: ty * TILE + 16, o, tx, ty });
      }
    }
    draws.push({ y: player.y + 8, player: true });
    for (const m of raiders) draws.push({ y: m.y + 6, m });
    draws.sort((a, b) => a.y - b.y);

    for (const d of draws) {
      if (d.player) { drawPlayer(ox, oy, now); continue; }
      if (d.m) { drawRaider(d.m, ox, oy, now); continue; }
      const o = d.o;
      const px = d.tx * TILE - ox, py = d.ty * TILE - oy;
      const sh = o.shake > 0 ? Math.round(Math.sin(o.shake * 55) * 1.4) : 0;
      if (o.type === 'tree') {
        drawSpriteFlash(SPRITES.tree[o.variant], px + sh, py - 8, o.flash);
      } else if (o.type === 'rock') {
        drawSpriteFlash(SPRITES.rock[o.variant], px + sh, py + 4, o.flash);
      } else if (o.type === 'goldore') {
        drawSpriteFlash(SPRITES.goldOre, px + sh, py + 4, o.flash);
      } else if (o.type === 'mine') {
        ctx.drawImage(SPRITES.mine, px, py);
      } else if (o.type === 'bush') {
        drawSpriteFlash(o.berries > 0 ? SPRITES.bush : SPRITES.bushEmpty, px + sh, py + 4, o.flash);
      } else if (o.type === 'wall') {
        drawSpriteFlash(SPRITES.wall, px + sh, py, o.flash);
        if (o.hp < o.maxHp * 0.6) {
          ctx.fillStyle = 'rgba(40,25,15,0.5)';
          ctx.fillRect(px + 4, py + 5, 1, 3); ctx.fillRect(px + 5, py + 8, 1, 2);
          ctx.fillRect(px + 10, py + 3, 1, 4); ctx.fillRect(px + 11, py + 7, 1, 2);
        }
      } else if (o.type === 'fire') {
        const f = ((now * 8 + (o.anim || 0)) | 0) % 3;
        drawSpriteFlash(SPRITES.fire[f], px, py, o.flash);
      } else if (o.type === 'torch') {
        const f = ((now * 7 + (o.anim || 0)) | 0) % 2;
        drawSpriteFlash(SPRITES.torch[f], px + 4, py + 1, o.flash);
      }
    }

    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - ox), Math.round(p.y - oy), p.size, p.size);
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
          Math.round(player.x + Math.cos(a) * rr - ox),
          Math.round(player.y - 2 + Math.sin(a) * rr - oy), 2, 2);
      }
    }

    // floaters
    for (const f of floaters) {
      const a = 1 - f.t / 0.9;
      ctx.globalAlpha = a;
      drawPixelTextShadow(ctx, f.txt, Math.round(f.x - ox - pixelTextWidth(f.txt) / 2), Math.round(f.y - oy - f.t * 14), f.color, 'rgba(20,20,40,0.8)');
      ctx.globalAlpha = 1;
    }

    renderLighting(ox, oy, now);
    renderWeather(now);
    renderVignettes();
    renderUI(now);

    if (state.mode === 'play' && state.mapOpen) renderWorldMap(now);
    if (state.mode === 'play' && state.settingsOpen) renderSettings(now);
    if (state.mode === 'title') renderTitle(now);
    if (state.mode === 'dead') renderDead();
  }

  function drawPlayer(ox, oy, now) {
    const set = SPRITES.player[player.dir];
    let frame = 0;
    if (player.moving) frame = 1 + (Math.floor(player.animT) % 2);
    const spr = set[frame];
    const px = Math.round(player.x - 8 - ox);
    const py = Math.round(player.y - 12 - oy);
    // shadow
    ctx.fillStyle = 'rgba(110,130,170,0.4)';
    ctx.fillRect(px + 5, py + 15, 6, 2);
    if (player.invuln > 0 && state.mode === 'play' && ((now * 12) | 0) % 2 === 0) ctx.globalAlpha = 0.45;
    drawSpriteFlash(spr, px, py, player.hurtT > 0.12 ? 1 : 0);
    ctx.globalAlpha = 1;
  }

  function drawRaider(m, ox, oy, now) {
    const set = SPRITES.raider[m.dir || 'down'];
    const spr = set[1 + (Math.floor(m.animT) % 2)];
    const px = Math.round(m.x - 8 - ox);
    const py = Math.round(m.y - 12 - oy);
    ctx.fillStyle = 'rgba(40,50,90,0.4)';
    ctx.fillRect(px + 5, py + 15, 6, 2);
    if (m.spawnT > 0) ctx.globalAlpha = Math.max(0.15, 1 - m.spawnT / 0.6);
    drawSpriteFlash(spr, px, py, m.flash);
    ctx.globalAlpha = 1;
    // hp sliver
    if (m.hp < m.maxHp) {
      ctx.fillStyle = 'rgba(20,25,50,0.7)';
      ctx.fillRect(px + 3, py - 2, 10, 2);
      ctx.fillStyle = '#ff7a6a';
      ctx.fillRect(px + 3, py - 2, Math.max(1, Math.round(10 * m.hp / m.maxHp)), 2);
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
    // small personal glow so it's never pitch black around you
    {
      const lx = player.x - ox, ly = player.y - 4 - oy;
      const grd = lctx.createRadialGradient(lx, ly, 1, lx, ly, 30);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      lctx.fillStyle = grd;
      lctx.fillRect(lx - 30, ly - 30, 60, 60);
    }

    ctx.drawImage(lightCv, 0, 0);

    drawWarmGlows(ox, oy, now, 0.10 + dark * 0.16);

    // raider eye glow + the mine smolders at night
    if (dark > 0.4) {
      ctx.globalCompositeOperation = 'lighter';
      for (const m of raiders) {
        const lx = m.x - ox, ly = m.y - 5 - oy;
        const grd = ctx.createRadialGradient(lx, ly, 0, lx, ly, 8);
        grd.addColorStop(0, 'rgba(255,90,80,0.25)');
        grd.addColorStop(1, 'rgba(255,90,80,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(lx - 8, ly - 8, 16, 16);
      }
      {
        const lx = cx * TILE - ox, ly = cy * TILE - oy;
        const r = 46 + Math.sin(now * 2.2) * 5;
        if (lx > -r && ly > -r && lx < VIEW_W + r && ly < VIEW_H + r) {
          const grd = ctx.createRadialGradient(lx, ly, 2, lx, ly, r);
          grd.addColorStop(0, 'rgba(255,110,60,' + (0.16 * dark).toFixed(3) + ')');
          grd.addColorStop(1, 'rgba(255,110,60,0)');
          ctx.fillStyle = grd;
          ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
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
    // cold vignette
    if (player.cold > 1) {
      const c = player.cold / 100;
      ctx.globalAlpha = c * 0.45;
      const grd = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.32, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.75);
      grd.addColorStop(0, 'rgba(80,140,220,0)');
      grd.addColorStop(1, 'rgba(80,140,220,1)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }
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
        else if (o.type === 'fire') { r = 255; g = 160; b = 70; }
        else if (o.type === 'torch') { r = 255; g = 217; b = 92; }
        else if (o.type === 'spike') { r = 168; g = 178; b = 200; }
        else if (o.type === 'goldore') { r = 226; g = 178; b = 82; }
        else if (o.type === 'mine') { r = 74; g = 70; b = 92; }
        else { r = 188; g = 200; b = 218; } // stump
      } else if (ground[i] === 1) { r = 145; g = 188; b = 212; } // ice
      else if (ground[i] === 2) { r = 158; g = 158; b = 172; } // plaza
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
    // raiders prowling in the dark
    if (state.darkness > 0.4) {
      ctx.fillStyle = '#ff6a5a';
      for (const m of raiders) {
        const mx = MM_CX + m.x / TILE - ptx, my = MM_CY + m.y / TILE - pty;
        if (Math.hypot(mx - MM_CX, my - MM_CY) < MM_R - 1) ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 2, 2);
      }
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

    // elapsed play-time, centered above the minimap
    const mins = Math.floor(state.elapsed / 60);
    const secs = Math.floor(state.elapsed % 60);
    const clock = mins + ':' + (secs < 10 ? '0' : '') + secs;
    drawPixelTextShadow(ctx, clock, Math.round(MM_CX - pixelTextWidth(clock) / 2), MM_CY - MM_R - 14,
      '#f4f7ff', 'rgba(15,22,50,0.8)');

    // raiders remaining at night, centered under the minimap
    if (nightActive && (raiders.length > 0 || toSpawn > 0)) {
      const t = 'RAIDERS ' + (raiders.length + toSpawn);
      drawPixelTextShadow(ctx, t, Math.round(MM_CX - pixelTextWidth(t) / 2), MM_CY + MM_R + 8, '#ff9a8a', 'rgba(15,22,50,0.8)');
    }
  }

  // ------------------------------------------------------------ world map (M)
  const PANEL_W = 308, PANEL_H = 226;
  const PANEL_X = Math.round((VIEW_W - PANEL_W) / 2);
  const PANEL_Y = Math.round((VIEW_H - PANEL_H) / 2);
  const MAP_X = PANEL_X + 10, MAP_Y = PANEL_Y + 24;   // 192x192 map area
  const COL_CX = PANEL_X + 254;                        // right column center

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
        else if (o && o.type === 'spike') { r = 140; g = 142; b = 152; }
        else if (o && o.type === 'fire') { r = 236; g = 146; b = 64; }
        else if (o && o.type === 'torch') { r = 230; g = 192; b = 88; }
        else if (o && o.type === 'goldore') { r = 214; g = 168; b = 74; }
        else if (o && o.type === 'mine') { r = 52; g = 48; b = 62; }
        else if (ground[i] === 2) {
          // rocky plaza inked in graphite
          if (h > 0.8) { r = 148; g = 140; b = 128; }
          else { r = 158; g = 150; b = 136; }
        }
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
    ctx.drawImage(mapCv, MAP_X, MAP_Y);

    // faint surveyor's grid
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#3a2c1c';
    for (let gx = 24; gx < WORLD; gx += 24) ctx.fillRect(MAP_X + gx, MAP_Y, 1, WORLD);
    for (let gy = 24; gy < WORLD; gy += 24) ctx.fillRect(MAP_X, MAP_Y + gy, WORLD, 1);
    ctx.globalAlpha = 1;

    // night falls over the chart too
    if (state.darkness > 0.01) {
      ctx.globalAlpha = state.darkness * 0.22;
      ctx.fillStyle = '#2c3c6e';
      ctx.fillRect(MAP_X, MAP_Y, WORLD, WORLD);
      ctx.globalAlpha = 1;
    }

    // fire & torch glows
    ctx.globalCompositeOperation = 'lighter';
    for (const L of lights) {
      const mx = MAP_X + L.x / TILE, my = MAP_Y + L.y / TILE;
      const rr = (L.warm > 60 ? 5 : 3) * (1 + Math.sin(now * 7 + L.x) * 0.15);
      const grd = ctx.createRadialGradient(mx, my, 0, mx, my, rr);
      grd.addColorStop(0, 'rgba(255,170,70,0.55)');
      grd.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(mx - rr, my - rr, rr * 2, rr * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    // current camera view
    ctx.strokeStyle = 'rgba(58,44,28,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(MAP_X + camX / TILE + 0.5, MAP_Y + camY / TILE + 0.5,
      VIEW_W / TILE - 1, VIEW_H / TILE - 1);

    // raiders prowl the chart at night
    if (state.darkness > 0.4 && ((now * 3) | 0) % 2 === 0) {
      ctx.fillStyle = '#ff6a5a';
      for (const m of raiders) ctx.fillRect(MAP_X + Math.round(m.x / TILE), MAP_Y + Math.round(m.y / TILE), 1, 1);
    }

    // player marker: inked diamond + pulsing ring
    const pmx = MAP_X + Math.round(player.x / TILE);
    const pmy = MAP_Y + Math.round(player.y / TILE);
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
  const SET_W = 240, SET_H = 170;
  const SET_X = Math.round((VIEW_W - SET_W) / 2);
  const SET_Y = Math.round((VIEW_H - SET_H) / 2);
  const SL_X = SET_X + 112, SL_W = 66;  // slider track
  const ROW_SOUND = SET_Y + 28, ROW_MUTE = SET_Y + 44, ROW_MAP = SET_Y + 60, ROW_SHAKE = SET_Y + 76;
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
    // controls divider
    const ct = 'CONTROLS';
    const cw = pixelTextWidth(ct);
    const cx0 = Math.round((SET_W - cw) / 2);
    drawPixelText(g, ct, cx0, 94, '#7a8bb8');
    g.fillStyle = '#2c3a68';
    g.fillRect(14, 97, cx0 - 22, 1); g.fillRect(cx0 + cw + 8, 97, SET_W - cx0 - cw - 22, 1);
    // hotkey listing, two columns
    const cols = [
      [['WASD', 'MOVE'], ['CLICK', 'CHOP/FIGHT'], ['1-5', 'TOOLS'], ['Q', 'EAT BERRY']],
      [['M', 'WORLD MAP'], ['N', 'MUTE'], ['P', 'PAUSE'], ['ESC', 'SETTINGS']],
    ];
    for (let c = 0; c < 2; c++) {
      let y = 108;
      const x0 = c === 0 ? 16 : 128;
      for (const [k, desc] of cols[c]) {
        drawPixelText(g, k, x0, y, '#ffd95c');
        drawPixelText(g, desc, x0 + (c === 0 ? 36 : 26), y, '#7a8bb8');
        y += 10;
      }
    }
    // close hint
    const hint = 'ESC CLOSE';
    drawPixelText(g, hint, Math.round((SET_W - pixelTextWidth(hint)) / 2), 156, '#5a6690');
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
  }

  function renderUI(now) {
    if (state.mode === 'title') return;

    // hearts
    for (let i = 0; i < 10; i++) {
      const hx = 5 + i * 9, hy = 5;
      const th = (i + 1) * 10;
      let spr = SPRITES.heartEmpty;
      if (player.hp >= th) spr = SPRITES.heartFull;
      else if (player.hp >= th - 5) spr = SPRITES.heartHalf;
      ctx.drawImage(spr, hx, hy);
    }

    // cold meter
    if (player.cold > 1) {
      const w = 60;
      ctx.fillStyle = 'rgba(15,22,50,0.75)';
      ctx.fillRect(5, 14, w + 2, 5);
      const pulse = player.cold >= 100 ? (Math.sin(now * 10) * 0.3 + 0.7) : 1;
      ctx.fillStyle = 'rgba(' + Math.round(120 * pulse + 60) + ',' + Math.round(190 * pulse + 30) + ',255,0.95)';
      ctx.fillRect(6, 15, Math.round(w * player.cold / 100), 3);
      drawPixelTextShadow(ctx, player.cold >= 100 ? 'FREEZING!' : 'COLD', 70, 14, '#a8dcff', 'rgba(15,22,50,0.8)');
    }

    // berries: consumable indicator by the hearts, not a core resource
    if (inv.berry > 0) {
      ctx.drawImage(SPRITES.itemBerry, 5, 22);
      drawPixelTextShadow(ctx, String(inv.berry), 15, 24, '#f4f7ff', 'rgba(15,22,50,0.8)');
      drawPixelTextShadow(ctx, '(Q)', 17 + pixelTextWidth(String(inv.berry)), 24, '#9fb6d8', 'rgba(15,22,50,0.8)');
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

    // hotbar
    const slotW = 20, gap = 3;
    const totalW = 5 * slotW + 4 * gap;
    const hx0 = (VIEW_W - totalW) / 2;
    const hy0 = VIEW_H - 26;
    for (let i = 0; i < 5; i++) {
      const x = hx0 + i * (slotW + gap);
      const sel = hotbar === i;
      ctx.fillStyle = sel ? 'rgba(38,48,90,0.9)' : 'rgba(18,24,52,0.8)';
      ctx.fillRect(x, hy0, slotW, slotW);
      ctx.strokeStyle = sel ? '#ffd95c' : '#4a5480';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, hy0 + 0.5, slotW - 1, slotW - 1);
      // icon
      let icon = null, iy2 = hy0 + 2, ix2 = x + 6;
      if (i === 0) icon = SPRITES.itemAxe;
      if (i === 1) icon = SPRITES.wall;
      if (i === 2) icon = SPRITES.spikes;
      if (i === 3) icon = SPRITES.torch[0];
      if (i === 4) icon = SPRITES.fire[0];
      if (i === 0) ctx.drawImage(icon, x + 6, hy0 + 6);
      else if (i === 3) ctx.drawImage(icon, x + 6, hy0 + 3);
      else ctx.drawImage(icon, 0, 0, 16, 16, x + 2, hy0 + 2, 16, 16);
      drawPixelText(ctx, String(i + 1), x + 2, hy0 + 2, sel ? '#ffd95c' : '#8f9cc4');
      // affordability dot
      if (i > 0 && !canAfford(BUILDS[i].cost)) {
        ctx.fillStyle = 'rgba(18,24,52,0.55)';
        ctx.fillRect(x + 1, hy0 + 1, slotW - 2, slotW - 2);
      }
    }
    // selected build cost
    if (hotbar > 0) {
      const b = BUILDS[hotbar];
      let costTxt = b.name + ': ';
      if (b.cost.wood) costTxt += b.cost.wood + ' WOOD ';
      if (b.cost.stone) costTxt += b.cost.stone + ' STONE';
      const cw = pixelTextWidth(costTxt.trim());
      drawPixelTextShadow(ctx, costTxt.trim(), (VIEW_W - cw) / 2, hy0 - 8,
        canAfford(b.cost) ? '#cfe0ff' : '#e87a7a', 'rgba(15,22,50,0.8)');
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
    const t1 = 'EMBERFROST';
    const bob = Math.sin(now * 1.5) * 2;
    drawPixelTextShadow(ctx, t1, (VIEW_W - pixelTextWidth(t1, 4)) / 2, 62 + bob, '#ffd95c', '#3c2a1e', 4);
    const t2 = 'A COZY WINTER SURVIVAL';
    drawPixelTextShadow(ctx, t2, (VIEW_W - pixelTextWidth(t2)) / 2, 96 + bob, '#cfe0ff', 'rgba(15,22,50,0.9)');

    const lines = [
      'WASD  MOVE',
      'CLICK CHOP / FIGHT / PLACE',
      '1-5   TOOLS AND BUILDING',
      'Q BERRY  M MAP  N MUTE  P PAUSE',
    ];
    let ly = 130;
    for (const l of lines) {
      drawPixelTextShadow(ctx, l, (VIEW_W - pixelTextWidth(l)) / 2, ly, '#9fb6d8', 'rgba(15,22,50,0.9)');
      ly += 12;
    }
    if (((now * 1.6) | 0) % 2 === 0) {
      const t3 = 'CLICK TO BEGIN';
      drawPixelTextShadow(ctx, t3, (VIEW_W - pixelTextWidth(t3, 2)) / 2, 196, '#ffffff', 'rgba(15,22,50,0.9)', 2);
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
    showMsg('GATHER WOOD - CLICK ON TREES TO CHOP', 6);
  }

  loadSettings();
  applyMinimapSize();
  SFX.setVolume(settings.volume);
  SFX.setMuted(settings.muted);
  genWorld();
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
    state, player, inv, raiders, objects, lights, mouse, keys, drops, footprints,
    placeObj, rebuildLights, spawnRaider, idx, objAt, clickAction, trySwing, tryPlace,
    setHotbar: (i) => { hotbar = i; },
    getHotbar: () => hotbar,
    cam: () => ({ x: camX, y: camY }),
    startGame,
    step: (dt, n) => { for (let i = 0; i < (n || 1); i++) { update(dt || 1 / 60); } render(); },
  };

  let last = performance.now();
  function loop(nowMs) {
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    if (!window.DBG.freeze) {
      update(dt);
      render();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
