// Softfall - a cozy winter survival game.
'use strict';
// The last file to load: the eagle drop that opens every match, the boot
// order, window.DBG and the requestAnimationFrame loop.

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
  PROFILE.addGame(); // one match played, counted as the eagle takes off
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
  SFX.music.play('eagle');
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
  if (p === player) {
    SFX.dodge();
    // a hard cut, not a crossfade: the ride's song is INTERRUPTED by the jump,
    // which then runs to its end and hands over to FOXGLOVE DROP (TRACKS.next)
    SFX.music.play('jump', { out: 0.1, in: 0.05 });
  }
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
    SFX.land();
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

PROFILE.load();   // the profile carries the settings, so it is read first
loadSettings();
relayout(); // fitCanvas already ran at load; this places the UI for the fitted view
SFX.setVolume(settings.volume);
SFX.setMusicVolume(settings.musicVol);
SFX.setSfxVolume(settings.sfxVol);
SFX.setMuted(settings.muted);
// the title track. Browsers refuse audio before a gesture, so SFX.music holds
// this as pending and the first click or keypress starts it (see js/audio.js).
SFX.music.play('intro', { in: 1.5 });
genWorld();
placeLandmarks();  // worldgen's last pass, before the ground is baked
spawnAnimals();
spawnFish();
stockLandmarks();  // wolves and birds go in once the world is standing
initPlayers();
renderGround();
buildMapPanel();
buildSettingsPanel();
buildNamePanel();
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
  fish, iceCracks, holes, crackIce, addFish, spawnEmerger, netAt, buildSiteAt,
  // named places: the live registry, the table behind it, and what is where
  landmarks, LANDMARKS, landmarkAt, stockLandmarks, flushBirds,
  // drop a slot (default the local one) on a tile - how to stage a landmark
  warp: (tx, ty, p) => { const q = p || player; q.x = (tx + 0.5) * TILE; q.y = (ty + 0.5) * TILE; q.vx = q.vy = 0; return q; },
  settings, perf, treeRare, cursorInfo,
  // the local profile: the store itself, the PLAYER panel and the two hit
  // rects, so a driver can open the name editor and read back what it accepts
  PROFILE, openNamePanel, nameKey, nameCommit, nameDismiss, nameOk,
  namePlankRects, namePanelHit, nameTagRect, overNameTag, applyProfileName,
  // the radial wheel: open one by hand (state.wheel) and read back the
  // geometry the hover test and the pixels both use
  wheelLayout, wheelSpan, wheelAng, WHEEL_HUB, WHEEL_R, WHEEL_RING,
  structures, robots, tracers, arrows, STRUCTS, TOOLS,
  // the worker flag: plant one without a mouse, read back what a tile would
  // order, and reach the corridor a PATH flag asks its crew to clear
  FLAG_JOBS, flagCorridor, mapTileAt,
  // the two coordinate bridges, so a driver can put the pointer on a tile
  wToSX, wToSY, mouseWX, mouseWY,
  plantFlag: (tx, ty, p) => plantFlag(p || player, tx, ty),
  clearFlag: (p) => clearFlag(p || player),
  flagResolve: (tx, ty, p) => flagResolve(p || player, tx, ty),
  flagTarget, // what the held press is aiming at right now (null = nothing drawn)
  get flag() { return player.flag; },
  // the quiver: the shafts lying in the world, the ceiling, and a way to set
  // a slot's ammo / renock without playing to it. hudStripRect is the xp bar
  // + ability row that reads all of it back, bottom-centre.
  shafts, QUIVER_MAX, QUIVER_REGEN, SHAFT_LIFE, hudStripRect, stickArrow, abHit, buySkill,
  AB_RANK_MAX,
  setQuiver: (n, p) => { const q = p || player; q.quiver = Math.max(0, Math.min(QUIVER_MAX, n)); q.fletchT = 0; return q.quiver; },
  setNock: (t, p) => { (p || player).nockT = t; },
  // multiplayer slots: every slot, the local one, and the teams table
  players, MAX_PLAYER_SLOTS, TEAMS, Player, ringPts, contestRank,
  // the eagle drop: the live flight record, force a jump, or fly the route from scratch
  get drop() { return state.drop; }, beginDrop, dropJump: (p) => dropJump(p || player), landPlayer, makeEagleRoute, inAir,
  get player() { return player; },
  get inv() { return player.inv; },
  // the backpack: the item table, the slot array, and add/take/count without
  // walking onto a drop. bagHit is what the pointer tests against.
  ITEMS, BAG_CAP, bagFrameRect, bagRowRect, bagBtnRect, bagCellRect, bagStripRect, bagHit,
  get bag() { return player.bag; },
  bagAdd: (type, n, p) => bagAdd(p || player, type, n || 1),
  bagTake: (type, n, p) => bagTake(p || player, type, n || 1),
  bagCount: (type, p) => bagCount(p || player, type),
  bagRoom: (type, p) => bagRoom(p || player, type),
  bagUsed: (p) => bagUsed(p || player),
  // hand a slot to an AI, a human, or nobody (a ghost at its camp)
  setControl: (slot, mode) => { const p = players[slot]; if (p) p.control = mode; return p; },
  placeObj, rebuildLights, idx, objAt, hoverFish, damagePlayer, die, endMatch, specNext, aliveCount, updateAI, contest,
  // the two end screens: their timelines, the frozen numbers they print, and
  // a way to open the loss summary without pressing its plank. Set
  // state.defeatT / state.deadTimer to scrub either ceremony to a beat.
  WIN_T, DEF_T, openDefeat, endSnapshot, endScreen, deadLayout, deadHit, deadActivate,
  // routes: the search itself, and showPaths = true draws every unit's live route
  findPath, walkable, navTo, showPaths: false,
  // hero levels: pay a slot gold (and XP) the way a pickup would
  gainGold: (n, p) => gainGold(p || player, n), LEVEL_XP, LEVEL_MAX,
  buySkill: (i, p) => buySkill(p || player, i),
  // gear: the table, a slot's effective kit, and buy/pick without the HUD
  GEAR, GEAR_SLOTS, GEAR_COSTS, kitOf, refreshKit, gearRects, gearHit, BAG_CELL,
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
  // the roll as a hit: stun anything by hand, and read back what a roll at a
  // given speed would deal (`.` draws the sweep circle over a live dash)
  stunUnit: (t, e) => stunUnit(e || player, t),
  rollDmg: (sp, p) => rollDmg(p || player, sp),
  rollSweep: (p) => rollSweep(p || player),
  ROLL_HIT_R, ROLL_FAST, ROLL_DMG, ROLL_STUN, TACKLE_STUN, TACKLE_SELF, TACKLE_MIN,
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
  startGame, beginIntro, beginSelect, lockIn, setChamp, CHAMPS, menu: state.menu, menuHit, menuClick, menuKey, selectHit,
  // the ESC panel: what the pointer is over, the speaker's plate, and every
  // row anchor - so a driver can click a dial without guessing at the pitch
  settingsHit, muteBtnRect,
  get settingsRows() {
    return { vol: ROW_SOUND, music: ROW_MUSIC, sfx: ROW_SFX, map: ROW_MAP,
      shake: ROW_SHAKE, info: ROW_INFO, cursor: ROW_CURSOR, x: SL_X, w: SL_W, panel: { x: SET_X, y: SET_Y, w: SET_W, h: SET_H } };
  },
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
