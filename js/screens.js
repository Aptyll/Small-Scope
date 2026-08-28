'use strict';
// The screens around a match's end: the rolling replay window, the death
// overlay and spectating, and the victory and defeat ceremonies that share
// one composition.
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
  // not over an end screen: both are compositions, and the window sits
  // exactly where their tally does
  return state.mode === 'dead' && !endScreen() && state.deadView === 'menu' && deadReady();
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

// ------------------------------------------------------------ death & spectate
// The local slot's ELIMINATION ('lost') - or a respawn-pending death
// ('respawning', see die()/updateRespawns) - or its win, once every RIVAL
// TEAM is gone (teams win together, see checkLastStanding) - puts the game
// in mode 'dead' with the match running on underneath. 'lost'/'respawning'
// dim the screen and offer two planks each (a respawning wait reads a live
// countdown instead of "OUT OF THE MATCH", see renderDead, and snaps back to
// 'play' on its own once the timer clears - no plank needed for that); a win
// hands the whole frame to the victory banner below and offers two of its
// own. LOBBY off an ELIMINATION does not leave: it hands the frame to the
// defeat banner - the loss's own summary, the mirror of the victory screen -
// and that screen's single plank is what leaves. A match you lost still ends
// on its numbers, and it ends when you are done watching rather than the
// instant you went down. SPECTATE follows a living slot through a
// top-centre control: two pixel arrows around the name, clickable, the arrow
// keys do the same, ESC comes back (no hint text: the arrows are the
// explanation). LOBBY fades out and reloads into the title screen on the same seed. viewPlayer() is who the camera and minimap
// frame, and the only thing the rest of the file needs to know about any of it.
const DEAD_BW = 112, DEAD_BH = 20, DEAD_GAP = 12; // the title menu plank, side by side
const DEAD_ITEMS = { lost: ['SPECTATE', 'LOBBY'], won: ['KEEP PLAYING', 'LOBBY'], respawning: ['SPECTATE', 'LOBBY'] };

// the planks on offer: the defeat summary has nothing left to offer but the
// door, so it is the one view whose items are its own rather than the ending's
function deadItems() {
  return state.deadView === 'defeat' ? ['LOBBY'] : (DEAD_ITEMS[state.over] || DEAD_ITEMS.lost);
}

// a full-frame end screen is up: the HUD, the event feed and the replay
// window all bow out under one, because both are compositions and both put
// something exactly where those sit
function endScreen() {
  return state.mode === 'dead' && (state.over === 'won' || state.deadView === 'defeat');
}

function viewPlayer() {
  const q = state.spec >= 0 ? players[state.spec] : null;
  return q && q.active && !q.dead ? q : player;
}

function deadLayout() {
  const items = deadItems();
  const w = items.length * DEAD_BW + (items.length - 1) * DEAD_GAP;
  const x0 = Math.round((VIEW_W - w) / 2);
  // both end screens seat them at the foot of the same composition, under
  // the tally; the death dim keeps the middle of the screen it always had
  const y = endScreen() ? winLayout().plankY : Math.round(VIEW_H / 2) + 10;
  return items.map((label, i) => ({ x: x0 + i * (DEAD_BW + DEAD_GAP), y, w: DEAD_BW, h: DEAD_BH, label }));
}

// the overlay has finished arriving and the planks are live: half a second
// for a death, the whole ceremony for either end screen (both skippable)
function deadReady() {
  if (state.deadView === 'defeat') return state.defeatT >= DEF_T.menu;
  return state.deadTimer >= (state.over === 'won' ? WIN_T.menu : 0.5);
}

// a press during either ceremony jumps to its end instead of being swallowed;
// true means it was consumed and the caller should do nothing else. The plain
// death dim has nothing to skip - it is half a second of fade, not a reward.
function endSkip() {
  if (deadReady()) return false;
  if (state.deadView === 'defeat') { state.defeatT = DEF_T.menu; SFX.pickup(); return true; }
  if (state.over !== 'won') return false;
  state.deadTimer = WIN_T.menu;
  SFX.pickup();
  return true;
}

// LOBBY on an elimination lands here first: the loss's summary, on its own
// clock (the death overlay's has been running since the body dropped)
function openDefeat() {
  state.deadView = 'defeat';
  state.defeatT = 0;
  state.deadSel = 0;
  state.deadHover = [0, 0];
  state.shake = Math.max(state.shake, 2);
}

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

// which plank is under the pointer (-1 for none); the overlay must have faded
// in, and spectating has planks of its own (the two arrows) rather than these
function deadHit() {
  if (state.deadView === 'spec' || !deadReady()) return -1;
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
  // the door out of an elimination goes through the summary once; the
  // summary's own LOBBY (and every other ending's) actually leaves
  if (label === 'LOBBY' && state.over === 'lost' && state.deadView !== 'defeat') openDefeat();
  else if (label === 'LOBBY') toLobby();
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
  SFX.music.stop(0.4);
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
  if (endSkip()) return;
  if (!deadReady()) return;
  const n = deadLayout().length;
  if (k === 'arrowleft' || k === 'a') { state.deadSel = (state.deadSel + n - 1) % n; SFX.pickup(); }
  else if (k === 'arrowright' || k === 'd') { state.deadSel = (state.deadSel + 1) % n; SFX.pickup(); }
  else if (k === 'enter' || k === ' ') deadActivate(state.deadSel);
}

function deadClick() {
  if (state.fade) return;
  if (state.deadView === 'spec') { const d = specHit(); if (d) { specNext(d); SFX.pickup(); } return; }
  if (endSkip()) return;
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
  if (state.deadView === 'defeat') { renderDefeat(now); return; } // the loss's own summary
  if (state.over === 'won') { renderVictory(now); return; } // a win gets a ceremony, not a dim
  const a = Math.min(0.75, state.deadTimer * 0.6);
  ctx.fillStyle = 'rgba(8,10,28,' + a + ')';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (state.deadTimer < 0.5) return;
  // The headline sits in the upper band, not over the middle of the screen:
  // it is the first thing to read and the match is still playing underneath,
  // so it goes where an eye lands rather than where the body fell. 3x, or 2x
  // on a view too narrow to hold it (the run is 25 glyphs - 297px at 3x).
  const t = 'YOU COLLAPSED IN THE SNOW';
  const ts = pixelTextWidth(t, 3) <= VIEW_W - 20 ? 3 : 2;
  const toy = Math.round((VIEW_H - 270) / 2);
  drawPixelTextOutline(ctx, t, Math.round((VIEW_W - pixelTextWidth(t, ts)) / 2), toy + 34, '#cfe4f2', '#0a0e23', ts);
  // a respawn-pending death is not permanent - the second line says so,
  // with a live countdown, instead of claiming the match is over
  const t2 = state.over === 'respawning'
    ? 'RESPAWNING IN ' + Math.max(0, Math.ceil(player.respawnT)) + 's'
    : 'YOU ARE OUT OF THE MATCH';
  drawPixelTextOutline(ctx, t2, Math.round((VIEW_W - pixelTextWidth(t2, 2)) / 2), toy + 34 + ts * 5 + 8, '#8f9cc4', '#0a0e23', 2);
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
// the last beat skips to it (endSkip): the reward is worth watching, never
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

// A tally's sound track: every cue inside this tick's slice of the timeline
// fires once - a plate lands with a knock, and every climbing number blips as
// it goes. Shared, because the two tallies differ only in their timeline and
// their columns. A skip jumps the clock before update() reads it, so nothing
// in the skipped span plays.
function tallyCues(t0, t1, T, stats) {
  const TICK = 0.055;
  for (let i = 0; i < stats.length; i++) {
    const s0 = T.stats + i * T.statStep;
    if (t0 < s0 && t1 >= s0) SFX.place();
    if (!stats[i].roll) continue;
    const a = Math.max(s0, Math.min(s0 + T.roll, t0));
    const b = Math.max(s0, Math.min(s0 + T.roll, t1));
    if (b > a && Math.floor((b - s0) / TICK) > Math.floor((a - s0) / TICK)) SFX.tally();
  }
}

// ...plus the one cue the tally does not own: the crown landing
function winCues(t0, t1) {
  if (!state.end) return;
  if (t0 < WIN_T.crownLand && t1 >= WIN_T.crownLand) {
    SFX.levelUp(); state.shake = Math.max(state.shake, 2.5);
  }
  tallyCues(t0, t1, WIN_T, WIN_STATS);
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
// the stat glyphs with no sprite of their own: stacked chevrons for the hero
// level, a clock face for the match time, a podium for where a loss placed
// (gold and the bow are sprites). 'g' is the accent, 'o' the cold outline.
const WIN_ICONS = {
  level: [
    '........', '...gg...', '..g..g..', '.g....g.',
    '........', '...gg...', '..g..g..', '.g....g.',
  ],
  time: [
    '..oooo..', '.o....o.', 'o..h...o', 'o..h...o',
    'o..hhh.o', 'o......o', '.o....o.', '..oooo..',
  ],
  place: [
    '........', '...gg...', '...oo...', '.oo.oo..',
    '.oo.oo.o', '.oo.oo.o', '.oo.oo.o', 'oooooooo',
  ],
};
const WIN_ICON_PAL = { '.': null, g: '#f2cc6a', o: '#cfe0ff', h: '#ffd95c' };
const DEF_ICON_PAL = { '.': null, g: '#9fbde0', o: '#8fa8d8', h: '#cfe4f2' };
// the accent each tally is struck in: the plate rule, its landed number, and
// the palette its stamped glyphs use
const WIN_ACCENT = { rule: '#c89a3c', txt: '#ffd95c', icon: WIN_ICON_PAL };
const DEF_ACCENT = { rule: '#4a5f96', txt: '#cfe4f2', icon: DEF_ICON_PAL };

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
// same procedural loop the title's embers use, so a resize costs it nothing.
// cold drops the sparks out of the mix - a loss has nothing burning.
function drawWinMotes(now, a, n, cold) {
  const span = VIEW_H + 40;
  for (let i = 0; i < n; i++) {
    const h1 = hash2(i * 13 + 1, 57), h2 = hash2(i * 7 + 5, 113), h3 = hash2(i * 5 + 9, 191);
    const y = ((now * (10 + h1 * 26) + h2 * span) % span) - 20;
    const x = Math.round(h3 * (VIEW_W - 2) + Math.sin(now * (0.7 + h1) + i) * 5);
    ctx.globalAlpha = a * (0.45 + 0.5 * (0.5 + 0.5 * Math.sin(now * 3.1 + i * 2.3)));
    ctx.fillStyle = cold ? (h1 > 0.55 ? '#e8f2ff' : h1 > 0.28 ? '#b8cce6' : '#8fa8d8')
      : h1 > 0.55 ? '#ffd95c' : h1 > 0.28 ? '#ff8a3c' : '#e8f2ff';
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

// The stand and the empty bowl - iron pan on a stem, the title pillar's
// brazier freed from the pillar so it can flank the dais. rim is the coals
// over its lip, the only thing a lit brazier and a dead one disagree on.
// Returns the bowl's top, which is what anything above it is measured from.
function drawBrazierIron(cx, baseY, rim) {
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
  ctx.fillStyle = rim; ctx.fillRect(cx - 5, by, 10, 1);
  return by;
}

// lit: a flickering ember stack over the coals, and warm additive light
function drawWinBrazier(cx, baseY, now, a) {
  ctx.globalAlpha = a;
  const by = drawBrazierIron(cx, baseY, '#ff8a3c');
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
// rule warming on the frame it lands. T is the ending's timeline and ac its
// accent pair, so the same plate tallies a win in gold and a loss in frost.
function drawEndStatPlate(r, st, ws, t, i, T, ac) {
  const s0 = T.stats + i * T.statStep;
  if (t < s0) return;
  const pop = easeOut(Math.min(1, (t - s0) / 0.24));
  const y = r.y + Math.round((1 - pop) * 8);
  const roll = Math.min(1, Math.max(0, (t - s0) / T.roll));
  const txt = st.roll ? String(Math.round(Number(st.val(ws)) * roll)) : st.val(ws);
  const done = !st.roll || roll >= 1;
  ctx.globalAlpha = pop;
  ctx.fillStyle = 'rgba(4,6,18,0.55)'; chamRect(r.x + 2, r.y + 2, r.w, r.h);
  ctx.fillStyle = '#0a0e23'; chamRect(r.x, y, r.w, r.h);
  ctx.fillStyle = '#141c3c'; chamRect(r.x + 1, y + 1, r.w - 2, r.h - 2);
  ctx.fillStyle = done ? ac.rule : '#35426e';
  ctx.fillRect(r.x + 2, y + 1, r.w - 4, 1); ctx.fillRect(r.x + 2, y + r.h - 2, r.w - 4, 1);
  const iy = y + ((r.h - 8) >> 1);
  if (st.icon === 'gold') ctx.drawImage(SPRITES.itemGold, r.x + 4, iy);
  else if (st.icon === 'kills') ctx.drawImage(SPRITES.itemBow, r.x + 4, iy);
  else stampGrid(WIN_ICONS[st.icon], ac.icon, r.x + 4, iy, 1);
  drawPixelTextShadow(ctx, txt, r.x + 15, y + ((r.h - 10) >> 1), done ? ac.txt : '#f4f7ff', '#0a0e23', 2);
  ctx.globalAlpha = 1;
}

// the kit a match finished in, centred under the tally: one HUD cell per
// slot, at the material it reached, with the same buy pips the in-match row
// draws. A maxed slot rims in the ending's accent.
function drawEndGear(ws, y, a, ac) {
  if (a <= 0) return;
  ctx.globalAlpha = Math.min(1, a);
  const gwAll = GEAR_SLOTS.length * BAG_CELL + (GEAR_SLOTS.length - 1) * BAG_GAP;
  let gx = Math.round((VIEW_W - gwAll) / 2);
  ctx.fillStyle = '#0a0e23'; chamRect(gx - 4, y - 3, gwAll + 8, BAG_CELL + 6);
  ctx.fillStyle = '#141c3c'; chamRect(gx - 3, y - 2, gwAll + 6, BAG_CELL + 4);
  for (let i = 0; i < GEAR_SLOTS.length; i++) {
    const lv = ws.gearLv[i];
    ctx.fillStyle = lv >= GEAR_LV_MAX ? ac.rule : '#35426e';
    ctx.fillRect(gx, y, BAG_CELL, BAG_CELL);
    ctx.fillStyle = '#0f1632';
    ctx.fillRect(gx + 1, y + 1, BAG_CELL - 2, BAG_CELL - 2);
    for (let k = 0; k < GEAR_LV_MAX - 1; k++) { // pips above the icon, as the HUD cell draws them
      ctx.fillStyle = k < lv - 1 ? '#f2cc6a' : '#2c3560';
      ctx.fillRect(gx + 3 + k * 4, y + 2, 3, 2);
    }
    ctx.drawImage(SPRITES.gearIcons[i][ws.gear[i]][lv - 1], gx + 3, y + 5);
    gx += BAG_CELL + BAG_GAP;
  }
  ctx.globalAlpha = 1;
}

// the tally row: n plates of one width, centred, each on its own beat
function drawEndTally(stats, ws, t, y, T, ac) {
  const pw = 15 + Math.max.apply(null, stats.map((st) => pixelTextWidth(st.val(ws), 2))) + 5;
  let sx = Math.round((VIEW_W - (stats.length * pw + (stats.length - 1) * 6)) / 2);
  for (let i = 0; i < stats.length; i++) {
    drawEndStatPlate({ x: sx, y, w: pw, h: 18 }, stats[i], ws, t, i, T, ac);
    sx += pw + 6;
  }
}

function renderVictory(now) {
  const ws = state.end || (state.end = endSnapshot());
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
    ctx.drawImage(SPRITES.champ[ws.cls][ws.team].down[Math.sin(now * 2.2) > 0.6 ? 1 : 0], bx, by, 80, 80);
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
    drawGoldRule(L.cx, L.ruleY, Math.round((tw / 2 + 10) * easeOut(Math.min(1, (t - WIN_T.rule) / 0.4))), 1, RULE_GOLD);
    const sub = ws.mates > 0 ? tm.name + ' HOLDS THE FROSTLANDS' : 'LAST ONE STANDING';
    ctx.globalAlpha = Math.min(1, (t - WIN_T.rule) / 0.5);
    drawPixelTextOutline(ctx, sub, Math.round((VIEW_W - pixelTextWidth(sub)) / 2), L.subY,
      ws.mates > 0 ? tm.mark : '#9fb6d8', '#0a0e23');
    ctx.globalAlpha = 1;
  }

  // --- the tally ----------------------------------------------------------
  drawEndTally(WIN_STATS, ws, t, L.statY, WIN_T, WIN_ACCENT);

  // the kit it was won in: the four pieces at the material they reached,
  // carrying the same buy pips the in-match HUD row draws
  drawEndGear(ws, L.gearY,
    Math.min(1, (t - (WIN_T.stats + WIN_STATS.length * WIN_T.statStep)) / 0.3), WIN_ACCENT);

  // --- the planks, sliding up to land exactly on WIN_T.menu ---------------
  if (t > WIN_T.menu - WIN_SLIDE) {
    const e = easeOut(Math.min(1, (t - (WIN_T.menu - WIN_SLIDE)) / WIN_SLIDE));
    ctx.globalAlpha = e;
    drawEndPlanks(now, Math.round((1 - e) * 16));
    ctx.globalAlpha = 1;
  }
}
// ------------------------------------------------------------ defeat
// The other end of the same ceremony. A death only DIMS the screen - the
// match plays on underneath and you can sit and watch it - so a lost match
// does not actually end until you stop watching, which is why LOBBY on an
// elimination lands here (deadActivate) and this screen's own plank is the
// door out. It is drawn on winLayout()'s anchors deliberately: DEFEAT sits
// exactly where VICTORY sat, the rule, the tally and the kit strip land in
// the same bands, and the two read as one pair rather than two designs.
// Everything else is the win inverted - the letters fall instead of
// dropping in, the rule is frost instead of gold, the braziers are out, no
// crown, and the champion is face down in the drift the dais stood on.
// state.defeatT is the clock: state.deadTimer has been running since the
// body fell, which may have been minutes ago.
const DEF_T = {
  dim: 0.45,      // the cold wash has finished settling
  title: 0.18, letter: 0.06, land: 0.34, // DEFEAT falls in a letter at a time
  stage: 0.55,    // the drift, the dead braziers and the body settle in
  rule: 0.95,     // the frost rule sweeps out of the middle
  stats: 1.55, statStep: 0.16, roll: 0.5, // the tally, one plate at a time
  menu: 2.70,     // the plank is up and the screen is live
};
const DEF_SLIDE = 0.32; // the plank's slide, finishing exactly on DEF_T.menu

// Where the local slot finished, and what it earned getting there: the four
// columns the win prints, with the placing in front of them. That number is
// the one thing a loss has to say that a win does not - "4/6" and not a word
// of it, because the podium glyph beside it is the label.
const DEF_STATS = [
  { icon: 'place', roll: false, val: (w) => w.place + '/' + w.of },
  { icon: 'gold', roll: true, val: (w) => String(w.gold) },
  { icon: 'kills', roll: true, val: (w) => String(w.kills) },
  { icon: 'level', roll: true, val: (w) => String(w.level) },
  { icon: 'time', roll: false, val: (w) => clockTxt(w.time) },
];

function defCues(t0, t1) {
  if (!state.end) return;
  tallyCues(t0, t1, DEF_T, DEF_STATS);
}

// ---- the art -------------------------------------------------------------
// Wind driving across the frame: streaks on their own lane at their own
// speed, wrapped by the modulo rather than tracked - the same no-array idiom
// as the motes. The motes fall through this, and two speeds is what makes it
// read as weather instead of as static.
function drawBlizzard(now, a) {
  const span = VIEW_W + 80;
  for (let i = 0; i < 52; i++) {
    const h1 = hash2(i * 17 + 3, 41), h2 = hash2(i * 11 + 7, 89);
    const y = Math.round(h1 * (VIEW_H + 16)) - 8;
    const x = Math.round(((now * (60 + h2 * 150) + h1 * span) % span) - 50);
    const len = 4 + Math.round(h2 * 12);
    ctx.globalAlpha = a * (0.12 + h2 * 0.16);
    ctx.fillStyle = '#cfe4f2';
    ctx.fillRect(x, y, len, 1);
    if (len > 8) ctx.fillRect(x + 3, y + 1, len - 5, 1); // a shallow slant, in two steps
  }
  ctx.globalAlpha = 1;
}

// A snow bank where the dais stood: near level across its middle and curving
// away at the two ends - a plain cosine domes, and a dome leaves the ends of
// a body lying on it up in the air, which is what the flattening root on the
// profile is for. Lit along its top three rows and speckled
// with the same hash the dais's cap uses. Drawn twice, once behind the body
// and once in front, so the body lies IN the snow instead of on a hill.
function drawDefeatDrift(cx, bot, hw, peak, a) {
  ctx.globalAlpha = a;
  for (let dx = -hw; dx <= hw; dx++) {
    const h = Math.round(Math.pow(Math.cos((dx / hw) * Math.PI / 2), 0.45) * peak) +
      (hash2(dx * 7 + 3, 19) > 0.72 ? 1 : 0);
    const x = cx + dx, y = bot - h;
    ctx.fillStyle = '#f4f7ff'; ctx.fillRect(x, y, 1, 3);
    ctx.fillStyle = '#dfe8f8'; ctx.fillRect(x, y + 3, 1, 2);
    ctx.fillStyle = '#b8cce6'; ctx.fillRect(x, y + 5, 1, Math.max(0, h - 5));
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, bot, 1, 2);
    if (hash2(dx * 5 + 11, 37) > 0.87) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y - 1, 1, 1); }
  }
  ctx.globalAlpha = 1;
}

// a brazier that has gone out: the win's ironwork with ash on the rim and a
// thread of smoke instead of a flame, and no light on anything near it
function drawDeadBrazier(cx, baseY, now, a) {
  ctx.globalAlpha = a;
  const by = drawBrazierIron(cx, baseY, '#3c4468');
  ctx.fillStyle = '#5a6690'; ctx.fillRect(cx - 3, by - 1, 6, 1);
  ctx.fillStyle = '#2a3560'; ctx.fillRect(cx - 1, by - 2, 3, 1);
  for (let i = 0; i < 9; i++) { // the smoke, thinning as it climbs
    const f = i / 9;
    ctx.globalAlpha = a * 0.30 * (1 - f);
    ctx.fillStyle = '#8fa8d8';
    ctx.fillRect(Math.round(cx + Math.sin(now * 0.9 + i * 0.7) * (1 + f * 4)), by - 3 - i * 3, 1, 2);
  }
  ctx.globalAlpha = 1;
}

// an arrow planted where the body fell - what the crown is on the other
// screen, and the only thing on this one still standing up
const DEF_ARROW = [
  '...s...', '..fsf..', '..fsf..', '..fsf..', '...s...',
  '...s...', '...s...', '...s...', '...s...', '...s...',
];
const DEF_ARROW_PAL = { '.': null, f: '#c8d4ee', s: '#8a6a44' };

function renderDefeat(now) {
  const ws = state.end || (state.end = endSnapshot());
  const t = state.defeatT;
  const L = winLayout();
  const dim = Math.min(1, t / DEF_T.dim);

  // --- backdrop: a colder, heavier wash than the win's --------------------
  ctx.fillStyle = 'rgba(5,8,20,' + (0.94 * dim).toFixed(3) + ')';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawBlizzard(now, dim);
  const vg = ctx.createRadialGradient(L.cx, L.toy + 120, VIEW_H * 0.16, L.cx, L.toy + 120, VIEW_W * 0.58);
  vg.addColorStop(0, 'rgba(3,5,16,0)');
  vg.addColorStop(1, 'rgba(3,5,16,' + (0.92 * dim).toFixed(3) + ')');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawWinMotes(now, dim, 44, true);

  // --- the stage: dead braziers, the drift, the body ----------------------
  const rise = easeOut(Math.max(0, Math.min(1, (t - DEF_T.stage) / 0.6)));
  if (rise > 0) {
    const settle = Math.round((1 - rise) * 8); // it comes down into place, not up
    drawDeadBrazier(L.cx - L.spread, L.daisY + 14, now, rise);
    drawDeadBrazier(L.cx + L.spread, L.daisY + 14, now, rise);
    drawDefeatDrift(L.cx - 6, L.daisY - 2 - settle, 70, 30, rise); // the bank behind
    // The champion, face down and SIDE-ON: a body lying across the frame is
    // the one pose that cannot be misread as standing. Same 5x and the same
    // 80px box the winner rises in. No gear marks - those sit on the standing
    // body plan (see drawPlayer), which is why the kit strip below is where
    // the kit is read on this screen.
    const bx = L.cx - 40, by = L.champY - 8 - settle;
    ctx.globalAlpha = rise;
    ctx.drawImage(SPRITES.champ[ws.cls][ws.team].prone.right[0], bx, by, 80, 80);
    ctx.globalAlpha = 1;
    // ...and the snow in FRONT of it, over the body's last few rows: the
    // drift has already started taking it back
    drawDefeatDrift(L.cx, L.daisY + 14 - settle, 92, 26, rise);
    stampGrid(DEF_ARROW, DEF_ARROW_PAL, L.cx + 46, L.daisY - 42 - settle, 3, '#0a0e23');
  }

  // --- the headline: DEFEAT, one letter at a time, falling ----------------
  const TXT = 'DEFEAT', S = 4;
  const tw = pixelTextWidth(TXT, S);
  const tx0 = Math.round((VIEW_W - tw) / 2);
  for (let i = 0; i < TXT.length; i++) {
    const lt = (t - DEF_T.title - i * DEF_T.letter) / DEF_T.land;
    if (lt <= 0) continue;
    const e = Math.min(1, lt) * Math.min(1, lt); // ease IN: it drops, it does not spring
    const lx = tx0 + i * 4 * S;
    const ly = L.titleY - Math.round((1 - e) * 12);
    ctx.globalAlpha = Math.min(1, lt * 2);
    // a cold flash on the beat it lands, steel from then on
    drawPixelTextOutline(ctx, TXT[i], lx, ly, lt < 1.12 ? '#e8f2ff' : '#9fbde0', '#0a0e23', S);
    ctx.globalAlpha = 1;
    if (lt >= 1 && lt < 1.5) { // frost shaken loose, falling away
      const fr = (lt - 1) / 0.5;
      ctx.globalAlpha = 1 - fr;
      ctx.fillStyle = '#cfe4f2';
      for (let k = 0; k < 5; k++) {
        const h = hash2(i * 7 + k, 23);
        ctx.fillRect(Math.round(lx + h * 4 * S), Math.round(L.titleY + 5 * S + fr * 12), 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  // the rule sweeps out, then the one line that says who did it
  if (t > DEF_T.rule) {
    const sweep = easeOut(Math.min(1, (t - DEF_T.rule) / 0.4));
    drawGoldRule(L.cx, L.ruleY, Math.round((tw / 2 + 10) * sweep), 1, RULE_FROST);
    const sub = ws.by ? 'FELLED BY ' + ws.by : (DEATH_CAUSE[ws.cause] || 'WENT DOWN');
    ctx.globalAlpha = Math.min(1, (t - DEF_T.rule) / 0.5);
    drawPixelTextOutline(ctx, sub, Math.round((VIEW_W - pixelTextWidth(sub)) / 2), L.subY,
      ws.by ? TEAMS[ws.byTeam].mark : '#8f9cc4', '#0a0e23');
    ctx.globalAlpha = 1;
  }

  // --- the tally and the kit it was lost in -------------------------------
  drawEndTally(DEF_STATS, ws, t, L.statY, DEF_T, DEF_ACCENT);
  drawEndGear(ws, L.gearY,
    Math.min(1, (t - (DEF_T.stats + DEF_STATS.length * DEF_T.statStep)) / 0.3), DEF_ACCENT);

  // --- the plank, sliding up to land exactly on DEF_T.menu ----------------
  if (t > DEF_T.menu - DEF_SLIDE) {
    const e = easeOut(Math.min(1, (t - (DEF_T.menu - DEF_SLIDE)) / DEF_SLIDE));
    ctx.globalAlpha = e;
    drawEndPlanks(now, Math.round((1 - e) * 16));
    ctx.globalAlpha = 1;
  }
}

