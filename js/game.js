// Softfall - a cozy winter survival game.
'use strict';

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
  // the site decides the menu: a stump offers the five buildings that stand
  // on land, an open hole offers the one that floats. A single option is not
  // special-cased either - wheelSpan(1) is the whole circle, so any direction
  // out of the hub picks it and the hub still cancels.
  if (w.kind === 'build') return buildOptionsAt(w.tx, w.ty).map((type) => ({ id: type }));
  const o = structOf(objAt(w.tx, w.ty));
  // upgrade is always the wedge straight up and demolish always the last one,
  // so a type's extra option lands between them instead of displacing either
  const opts = [{ id: 'upgrade' }];
  if (o && o.type === 'keep' && !o.building) opts.push({ id: 'craft' });
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
  if (c.kind === 'skill') { buySkill(p, c.i); return; }
  if (c.kind === 'build') { placeStruct(c.tx, c.ty, c.id, p); return; }
  const o = structOf(objAt(c.tx, c.ty));
  if (!o || !STRUCTS[o.type] || o.building || !ownsStruct(o, p)) return;
  if (Math.hypot(c.tx * TILE + 8 - p.x, c.ty * TILE + 8 - p.y) > 60) return;
  if (c.kind === 'upgrade') startUpgrade(o, p);
  else if (c.kind === 'demolish') demolishStruct(o, p);
  else if (c.kind === 'craft') startCraft(o, p);
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
    // a bare open hole brackets too: it is a build site with nothing on it,
    // and the brackets are the only thing that says so
    if (!o) { if (!buildSiteAt(tx, ty)) return; }
    else if (o.type !== 'stump' && !(STRUCTS[o.type] && !o.building && o.team === player.team)) return;
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
      const label = opt.id === 'upgrade' ? 'UP' : opt.id === 'demolish' ? 'DEL' : 'CARD';
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
    } else if (opt.id === 'craft') {
      if (o && o.craftT > 0) { label = 'CRAFTING...'; color = '#9fb6d8'; }
      else {
        const t = STRUCTS.keep.tiers[o ? o.tier : 0];
        label = 'QUEUE CARD : ' + costText({ gold: t.craftCost });
        color = canAfford({ gold: t.craftCost }) ? '#ffd95c' : '#ff8a7a';
      }
    }
  }
  // centred under the wheel, but never off the edge: the wheel sits where the
  // stump is, and a wide cost line is wider than the margin that leaves
  const lw = pixelTextWidth(label);
  drawPixelTextOutline(ctx, label,
    Math.round(Math.max(2, Math.min(VIEW_W - lw - 2, L.cx - lw / 2))),
    Math.round(L.cy + WHEEL_R + WHEEL_PAD + 6), color, '#0f1632');
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

// ------------------------------------------------------------ UI
function updateMinimap() {
  const d = mmImg.data;
  for (let i = 0; i < WORLD * WORLD; i++) {
    let r, g, b;
    const o = structOf(objects[i]); // resolves a multi-tile building's 'part' fillers to the anchor
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
      else if (o.type === 'net') { r = 150; g = 186; b = 200; }
      else if (o.type === 'keep') { r = 224; g = 96; b = 96; }
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
  // worker flags on your side, as the same pennant the chart draws: where the
  // crew was sent is exactly the kind of thing you check without opening a map
  for (const q of players) {
    if (!q.active || q.team !== vp.team || !q.flag) continue;
    const dx = (q.flag.tx + 0.5 - ptx) * s, dy = (q.flag.ty + 0.5 - pty) * s;
    if (Math.hypot(dx, dy) > MM_R - 2) continue;
    drawFlagPennant(ctx, MM_CX + dx, MM_CY + dy + 3, TEAMS[q.team].mark);
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

// ---- backpack and gear: one widget, bottom-right ------------------------
// Everything you own in one frame. Top to bottom: a ROW of five identical
// cells - the pack, then the four gear pieces head to toe - then the
// inventory GRID when the pack is open, then a STRIP flush along the bottom
// carrying every NUMBER the widget has - berries and fish from the left, gold
// hard against the right edge, League-style. Nothing here is a
// different size from anything else: BAG_CELL is a grid cell, a gear plate
// and the pack button alike, and BAG_PAD / BAG_GAP are the only two gaps in
// the whole widget, so the five columns line up from the row straight down
// through the grid.
//
// ONE BACKGROUND, ONE BORDER, ONE INTERNAL LINE. Every part of the frame -
// behind the cells, behind the grid, behind the gold - is the same opaque
// BAG_BG, so nothing inside reads as a separate panel stacked on another. The
// border is a single 1px rim: no lit inner edge and no rule under the icon
// row, which put four stacked lines in a widget only 37px tall shut. The one
// line that stays is the rule over the gold strip, because money is a
// different KIND of thing from the slots above it, and that is the only break
// the widget makes. The row and the grid are one continuous ladder on BAG_GAP
// - no wider seam between them - since they are both cells of the same size
// holding the same kind of thing.
//
// THE ROW IS ON TOP AND THE GRID HANGS BELOW IT, which is the one piece of
// this layout that is load-bearing rather than taste: an affordable gear
// piece bobs a gold chevron ABOVE its cell, and the hover price sits higher
// still, so whatever is over the row has to be empty screen. Put the grid up
// there and every chevron draws into it. The frame is pinned by its BOTTOM
// RIGHT to the view edge and grows upward, so opening the bag lifts the row
// rather than pushing the gold off the bottom of the screen.
//
// Clicking the pack (or B) toggles the grid; clicking a food cell eats from
// that stack through the same input flags Q/F use, so the sim path is
// identical; clicking a gear cell (or its number key) buys the next level.
// The frame swallows every other click over itself so nothing is fired at
// the world through it. The grid does NOT stop the sim - it is HUD, not an
// overlay. Two things are said in colour rather than in words: the pack's
// rim goes amber when no cell is left free, and the whole frame reddens and
// shakes when something could not be carried (bagDenied, below).
const BAG_CELL = 18;   // every cell: grid slot, gear plate and pack button alike
const BAG_GAP = 2;     // between neighbouring cells
const BAG_PAD = 3;     // frame edge to the first cell
const BAG_COLS = 5;    // and therefore the row is 5 icons: pack + four pieces
const BAG_STRIP = 12;  // the gold row, flush to the bottom rim under its rule
const BAG_W = BAG_PAD * 2 + BAG_COLS * BAG_CELL + (BAG_COLS - 1) * BAG_GAP;
const BAG_BG = '#0d1229';     // the whole frame, gold row included
const BAG_BG_RED = '#4a121c'; // ... and while a refusal is up
// a filled cell recesses BELOW that ground, an empty one sits above it, so
// the three tones say occupied / free / frame without any line doing it
const BAG_WELL = '#080b1c';
let bagFlash = 0;      // seconds left of the "it does not fit" red; updateFx ages it
// The refusal tell, fired by every path that cannot store something. Re-firing
// while it is already up does not restart it, so standing on a drop you
// cannot carry is one flash and one sound, not sixty a second.
function bagDenied() {
  if (bagFlash > 0) return;
  bagFlash = 0.6;
  SFX.deny();
}
function bagGridH() {
  const rows = Math.ceil(player.bagCap / BAG_COLS);
  return rows * BAG_CELL + (rows - 1) * BAG_GAP;
}
// the whole widget; its bottom-right is the view's last pixel, so the grid
// opens by growing upward rather than off the screen
function bagFrameRect() {
  const h = BAG_PAD + BAG_CELL + (state.bagOpen ? BAG_GAP + bagGridH() : 0) +
    BAG_GAP + 1 + BAG_STRIP + 1; // gap, the gold rule, the gold row, the rim
  return { x: VIEW_W - BAG_W, y: VIEW_H - h, w: BAG_W, h };
}
// cell i of the top row: 0 is the pack, 1-4 are the gear pieces
function bagRowRect(i) {
  const f = bagFrameRect();
  return { x: f.x + BAG_PAD + i * (BAG_CELL + BAG_GAP), y: f.y + BAG_PAD, w: BAG_CELL, h: BAG_CELL };
}
function bagBtnRect() { return bagRowRect(0); }
// cell i of the inventory grid, on the row's columns
function bagCellRect(i) {
  const f = bagFrameRect();
  return {
    x: f.x + BAG_PAD + (i % BAG_COLS) * (BAG_CELL + BAG_GAP),
    y: f.y + BAG_PAD + BAG_CELL + BAG_GAP + ((i / BAG_COLS) | 0) * (BAG_CELL + BAG_GAP),
    w: BAG_CELL, h: BAG_CELL,
  };
}
// the gold row: full inner width, hard against the frame's bottom rim. Its
// rule sits on the row directly above it - see drawBag.
function bagStripRect() {
  const f = bagFrameRect();
  return { x: f.x + 1, y: f.y + f.h - 1 - BAG_STRIP, w: f.w - 2, h: BAG_STRIP };
}
// What the pointer is on: { kind: 'btn' } (the pack) | { kind: 'cell', i }
// (a grid slot) | { kind: 'frame' } (anywhere else inside, swallowed and
// otherwise inert) | null. GEAR cells are NOT reported here - gearHit owns
// those and every caller asks it first. Shared by the click handler, the
// cursor and the widget's own hover, so the three can never disagree.
function bagHit(mx, my) {
  if (state.mode !== 'play' || player.dead || state.paused ||
      state.mapOpen || state.settingsOpen || state.wheel || window.DBG.hideUI) return null;
  const f = bagFrameRect();
  if (mx < f.x || mx >= f.x + f.w || my < f.y || my >= f.y + f.h) return null;
  const b = bagBtnRect();
  if (mx >= b.x && mx < b.x + b.w && my >= b.y && my < b.y + b.h) return { kind: 'btn' };
  if (state.bagOpen) for (let i = 0; i < player.bagCap; i++) {
    const r = bagCellRect(i);
    if (mx >= r.x && mx < r.x + r.w && my >= r.y - 1 && my < r.y + r.h) return { kind: 'cell', i };
  }
  return { kind: 'frame' };
}
// one left click on the widget; returns true if it was swallowed
function bagClick(h) {
  if (!h) return false;
  if (h.kind === 'frame') return true; // the panel eats it; the world never sees it
  if (h.kind === 'btn') { state.bagOpen = !state.bagOpen; SFX.pickup(); return true; }
  const s = player.bag[h.i];
  if (!s) { SFX.deny(); return true; }
  if (s.type === 'berry') player.input.eatBerry = true;
  else if (s.type === 'fish') player.input.eatFish = true;
  else if (CARD_TYPE_RARITY[s.type]) openDraft(CARD_TYPE_RARITY[s.type]);
  else SFX.deny();
  return true;
}
// opens the pick-1-of-3 draft for a rarity - a pure local UI state change,
// like the pack toggle above, not a contest (only the local human ever
// touches their own bag). Does NOT pause the sim: bag/map/wheel don't either.
function openDraft(rarity) {
  state.draft = { rarity, options: pick3Distinct(rarity) };
  SFX.pickup();
}
const DRAFT_CW = 130, DRAFT_CH = 96, DRAFT_GAP = 10;
function draftLayout() {
  const w = DRAFT_CW * 3 + DRAFT_GAP * 2;
  const x0 = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - DRAFT_CH) / 2);
  const cards = [];
  for (let i = 0; i < 3; i++) cards.push({ x: x0 + i * (DRAFT_CW + DRAFT_GAP), y, w: DRAFT_CW, h: DRAFT_CH });
  return cards;
}
function draftHit(mx, my) {
  if (!state.draft) return -1;
  const cards = draftLayout();
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i];
    if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return i;
  }
  return -1;
}
// a card picks it - bagTake, push onto p.cards, refreshKit, exactly the
// storage/kit halves the plan calls for; anywhere else just closes the
// draft. Either way the click never reaches the world (see mousedown).
function draftClick() {
  const d = state.draft;
  const i = draftHit(mouse.x, mouse.y);
  if (i >= 0) {
    const id = d.options[i];
    bagTake(player, cardKey(d.rarity), 1);
    player.cards.push({ rarity: d.rarity, id });
    refreshKit(player);
    addFloater(player.x, player.y - 18, CARDS[d.rarity][id].name, RES_COLORS[cardKey(d.rarity)]);
    SFX.levelUp();
  }
  state.draft = null;
}
// bots skip this UI entirely - see resolveCardForBot in the ai banner
function renderDraft() {
  const d = state.draft;
  ctx.fillStyle = 'rgba(6,10,24,0.72)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const cards = draftLayout();
  const col = RES_COLORS[cardKey(d.rarity)];
  const hit = draftHit(mouse.x, mouse.y);
  const title = d.rarity.toUpperCase() + ' CARD - CHOOSE ONE';
  drawPixelTextShadow(ctx, title, Math.round((VIEW_W - pixelTextWidth(title, 2)) / 2), cards[0].y - 16, col, '#0a0e23', 2);
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i], hot = hit === i;
    const lift = hot ? 2 : 0;
    const x = r.x, y = r.y - lift, w = r.w, h = r.h;
    ctx.fillStyle = 'rgba(4,6,18,0.55)'; ctx.fillRect(x + 2, r.y + 2, w, h);
    ctx.fillStyle = '#0a0e23'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = hot ? '#1f2b5c' : '#141c3c'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = col;
    ctx.fillRect(x + 2, y + 1, w - 4, 1); ctx.fillRect(x + 1, y + 2, 1, h - 4);
    ctx.fillRect(x + 2, y + h - 2, w - 4, 1); ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
    const card = CARDS[d.rarity][d.options[i]];
    ctx.drawImage(SPRITES[ITEMS[cardKey(d.rarity)].icon], x + Math.round(w / 2) - 4, y + 10);
    drawPixelTextShadow(ctx, card.name, x + Math.round((w - pixelTextWidth(card.name)) / 2), y + 26, hot ? '#ffd95c' : '#f4f7ff', '#0a0e23');
    drawPixelTextShadow(ctx, card.blurb, x + Math.round((w - pixelTextWidth(card.blurb)) / 2), y + 40, '#9fb6d8', '#0a0e23');
  }
}
// One cell, and the reason nothing in here is bigger than anything else:
// grid slots, gear plates and the pack button all come out of this. Returns
// the y it actually drew at, since a hover lift shifts it.
function bagCellPlate(r, rim, inner, lift) {
  const y = r.y - (lift ? 1 : 0);
  ctx.fillStyle = rim;
  ctx.fillRect(r.x, y, r.w, r.h);
  ctx.fillStyle = inner;
  ctx.fillRect(r.x + 1, y + 1, r.w - 2, r.h - 2);
  return y;
}

// ---- the four gear cells of that row, head to toe, keys 1-4 -------------
// Each cell is a piece: its icon wears the material of its level (the
// sprites' leather -> iron -> steel -> gold), pips ABOVE the icon count the
// buys, and an affordable piece grows a bobbing gold chevron over the cell -
// the ask to spend, League-style. Hover lifts the cell and shows the cost; a
// click or the piece's number key buys through input.cmd (see the input
// banner). The pips sit on top because that is the edge the chevron points
// at, so the ask and the progress it is asking about read as one column.
function gearRects() {
  const rs = [];
  for (let i = 0; i < GEAR_SLOTS.length; i++) rs.push(bagRowRect(i + 1));
  return rs;
}
// which gear cell the pointer is on, or -1; shared by the click handler, the
// cursor and the row's own hover so they can never disagree
function gearHit(mx, my) {
  if (state.mode !== 'play' || player.dead || state.paused ||
      state.mapOpen || state.settingsOpen || state.wheel || window.DBG.hideUI) return -1;
  const rs = gearRects();
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (mx >= r.x && mx < r.x + r.w && my >= r.y - 1 && my < r.y + r.h) return i;
  }
  return -1;
}
function drawGearCells(now, hov) {
  const rs = gearRects();
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i], lv = player.gearLv[i], cost = gearCost(player, i);
    const afford = cost && player.inv.gold >= cost.gold;
    // a maxed piece goes quiet behind a gold rim; a hovered one brightens
    const y = bagCellPlate(r, !cost ? '#8a7a3a' : hov === i ? '#8fa0c8' : '#35426e',
      BAG_WELL, hov === i);
    for (let k = 0; k < GEAR_LV_MAX - 1; k++) { // buy pips ABOVE the icon
      ctx.fillStyle = k < lv - 1 ? '#f2cc6a' : '#2c3560';
      ctx.fillRect(r.x + 3 + k * 4, y + 2, 3, 2);
    }
    ctx.drawImage(SPRITES.gearIcons[i][player.gear[i]][lv - 1], r.x + 3, y + 5);
    if (afford) { // the ask: two gold carets bobbing over the cell
      // clear of the frame: the row is only BAG_PAD below the top rim, so the
      // lower caret has to start high enough that the bottom of its bob still
      // lands outside the box rather than on its own lit edge
      const bob = Math.round(Math.sin(now * 6));
      const cx = r.x + (r.w >> 1);
      const px = [[0, 0], [-1, 1], [1, 1], [-2, 2], [2, 2]];
      for (const [off, col] of [[1, '#0f1632'], [0, '#f5c542']]) {
        ctx.fillStyle = col;
        for (const [dx, dy] of px) {
          ctx.fillRect(cx + dx + off, y - 14 + bob + dy + off, 1, 1);
          ctx.fillRect(cx + dx + off, y - 10 + bob + dy + off, 1, 1);
        }
      }
    }
    if (hov === i && cost) { // hover: the price, coin + number, nothing else
      const txt = String(cost.gold);
      const tw = 10 + pixelTextWidth(txt);
      const tx0 = Math.max(2, Math.min(r.x + (r.w >> 1) - (tw >> 1), VIEW_W - 2 - tw));
      ctx.drawImage(SPRITES.itemGold, tx0, y - 26);
      drawPixelTextOutline(ctx, txt, tx0 + 10, y - 24, afford ? '#f5c542' : '#9fb6d8', '#0f1632');
    }
  }
}

function drawBag(now) {
  if (player.dead) return;
  const hov = mouse.inside ? bagHit(mouse.x, mouse.y) : null;
  const ghov = mouse.inside ? gearHit(mouse.x, mouse.y) : -1;
  const red = bagFlash > 0;
  ctx.save();
  // inward only: a ±1 shake on a flush right edge would clip a column of rim
  ctx.translate(red ? (((now * 40) | 0) % 2 ? -1 : 0) : 0, 0);
  // The frame. No cast shadow: it is hard against two edges of the screen,
  // where a shadow has nothing to fall on, and the cells already carry the
  // depth - a drop shadow only smeared the outline that reads it as one box.
  const f = bagFrameRect();
  ctx.fillStyle = red ? BAG_BG_RED : BAG_BG; // one opaque ground for the whole widget
  ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.fillStyle = red ? '#c2465a' : '#2c3a68';
  ctx.fillRect(f.x, f.y, f.w, 1); ctx.fillRect(f.x, f.y + f.h - 1, f.w, 1);
  ctx.fillRect(f.x, f.y, 1, f.h); ctx.fillRect(f.x + f.w - 1, f.y, 1, f.h);
  // the pack, first cell of the row: hover lights the rim, open keeps it lit,
  // and a bag with no free cell wears amber whatever the pointer is doing
  const btn = bagBtnRect();
  const onBtn = hov && hov.kind === 'btn';
  const full = bagUsed(player) >= player.bagCap;
  bagCellPlate(btn, onBtn || state.bagOpen ? '#8fa0c8' : full ? '#c9922f' : '#35426e',
    state.bagOpen ? '#182350' : BAG_WELL, false);
  ctx.drawImage(SPRITES.itemBag, btn.x + 3, btn.y + 3);
  drawGearCells(now, ghov);
  if (state.bagOpen) {
    for (let i = 0; i < player.bagCap; i++) {
      const r = bagCellRect(i), s = player.bag[i];
      const on = hov && hov.kind === 'cell' && hov.i === i;
      // an EMPTY cell is the lighter one. It has no icon to show off, so the
      // well itself has to be the thing you see - free space is what the grid
      // is being read for - while a full cell goes dark behind its item.
      const y = bagCellPlate(r, on ? '#8fa0c8' : s ? '#35426e' : '#2c3560',
        s ? BAG_WELL : '#171f45', on && s);
      if (!s) continue;
      // the icon sits high in the cell so the count can have the bottom
      // right corner without its outline eating the cell's own rim
      ctx.drawImage(SPRITES[ITEMS[s.type].icon], r.x + 5, y + 3);
      if (s.n > 1) { // a lone item needs no '1' on it - an empty corner says it
        const t = String(s.n);
        drawPixelTextOutline(ctx, t, r.x + r.w - 3 - pixelTextWidth(t), y + 10, '#f4f7ff', '#0f1632');
      }
    }
  }
  // The bottom strip: everything that is a NUMBER rather than a slot. It
  // shares the frame's ground rather than wearing a plate of its own - the
  // one line in the widget is what marks it off, because a running total is a
  // different kind of thing from the cells above, and that break is the only
  // one worth drawing.
  const st = bagStripRect();
  ctx.fillStyle = red ? '#c2465a' : '#2c3a68';
  ctx.fillRect(st.x, st.y - 1, st.w, 1);
  // The meals, left to right: an icon and how many, and nothing else. They
  // total the whole bag, so the strip answers "can I heal" without opening the
  // grid, and a meal you have none of takes no room at all. The key that eats
  // each one is NOT printed here - the ESC panel's CONTROLS block is where a
  // binding is looked up, and a letter beside every count is a caption the
  // strip has to carry forever for the two minutes it is useful.
  let fx = st.x + 3;
  for (const type of ['berry', 'fish']) {
    const n = bagCount(player, type);
    if (n <= 0) continue;
    ctx.drawImage(SPRITES[ITEMS[type].icon], fx, st.y + 2);
    fx += 9;
    const t = String(n);
    drawPixelTextOutline(ctx, t, fx, st.y + 4, '#f4f7ff', '#0f1632');
    fx += pixelTextWidth(t) + 8;
  }
  // the gold, hard against the right edge with its coin ahead of it, inked
  // gold so the one number here that is money does not read as a count of
  // something you are carrying
  const gt = String(inv.gold);
  const gx = st.x + st.w - 4 - pixelTextWidth(gt);
  ctx.drawImage(SPRITES.itemGold, gx - 11, st.y + 2);
  drawPixelTextOutline(ctx, gt, gx, st.y + 4, '#f5c542', '#0f1632');
  ctx.restore();
}

// ---- hud strip: four ability slots over the xp bar, bottom-centre --------
// One opaque plate. Four ability wells on top - LOOSE, DODGE, AMBUSH, FLETCH
// - and a gold xp bar flush along the bottom (xp IS lifetime gold). While a
// skill point can land on an ability, a plus-square perches on the plate's
// top rim (drawn after the frame, so the border does not wrap it) and is
// gone the moment a point cannot land there. Rank is three pips on the well.
// A cooldown wipes top-down in whole pixels under a 1px sweep line; a
// finished one flashes its well white for a beat. Icons are 16x16 char
// grids with the outline IN the art - an extra rim pass blobs the leather
// and the fletching into a smear. Team fletching is injected at bake.
const AB_CELL = 20, AB_GAP = 3, AB_N = 4;
const AB_W = AB_N * AB_CELL + (AB_N - 1) * AB_GAP; // 89: odd, so the centre is a real column
const AB_PAD = 2, AB_UP = 8, AB_XP = 5;
const AB_H = AB_PAD + AB_CELL + AB_PAD + AB_XP + AB_PAD;
const AB_BG = '#0d1229';
const AB_COVER = 'rgba(8,12,30,0.82)';
function hudStripRect() {
  return { x: Math.round((VIEW_W - AB_W) / 2), y: VIEW_H - AB_H, w: AB_W, h: AB_H };
}
function abSlotRect(i) {
  const R = hudStripRect();
  return {
    x: R.x + i * (AB_CELL + AB_GAP),
    y: R.y + AB_PAD,
    w: AB_CELL, h: AB_CELL,
  };
}
function abUpRect(i) {
  const s = abSlotRect(i);
  // bottom of the square sits on the cell's top, covering the plate's rim
  return { x: s.x + ((AB_CELL - AB_UP) >> 1), y: s.y - AB_UP, w: AB_UP, h: AB_UP };
}
// { kind:'up'|'slot', i } | { kind:'frame' } | null. Shared by the click
// handler, the cursor and the strip's own hover so they cannot disagree.
function abHit(mx, my) {
  if (state.mode !== 'play' || player.dead || state.paused ||
      state.mapOpen || state.settingsOpen || state.wheel || window.DBG.hideUI) return null;
  for (let i = 0; i < AB_N; i++) {
    if (!abCanBuy(player, i)) continue;
    const u = abUpRect(i);
    if (mx >= u.x && mx < u.x + u.w && my >= u.y - 1 && my < u.y + u.h) return { kind: 'up', i };
  }
  const R = hudStripRect();
  if (mx < R.x - 3 || mx >= R.x + R.w + 3 || my < R.y || my >= R.y + R.h) return null;
  for (let i = 0; i < AB_N; i++) {
    const s = abSlotRect(i);
    if (mx >= s.x && mx < s.x + s.w && my >= s.y && my < s.y + s.h) return { kind: 'slot', i };
  }
  return { kind: 'frame' };
}
// o outline, then materials. f/F (team fletch) and E (ambush eyes) per bake
const AB_PAL = {
  o: '#141a2c',
  W: '#f4f7ff', b: '#cfe0f2', s: '#9fb6d8', S: '#5f6f96',
  t: '#e8dcb4', d: '#a89263', w: '#a8794a', u: '#6e4a28',
  h: '#c49a6a', g: '#f2cc6a', G: '#b98a2e', n: '#1a2142',
};
const AB_ICONS = [
  [ // LOOSE: D-bow facing right, string taut, arrow through the grip
    '....oooooooo....',
    '...oWWWWWWWWo...',
    '..oWbo.....oWo..',
    '.oWbo.......oWo.',
    'oWbo.........oWo',
    'oWbo.........oWo',
    'oWooooooooooooWo',
    'oWfFtdttttttWWoo',
    'oWooooooooooooWo',
    'oWdo.........oWo',
    'oWdo.........oWo',
    '.oWdo.......oWo.',
    '..oWdo.....oWo..',
    '...oWdddddddo...',
    '....oooooooo....',
    '................',
  ],
  [ // DODGE: side-view winter boot, fur cuff, buckle, heel and toe
    '......oooo......',
    '......oWWWo.....',
    '......owwuo.....',
    '......owhwo.....',
    '......owgwo.....',
    '......owwuo.....',
    '......owwwuo....',
    '.....owwwwuo....',
    '....owwwwwuo....',
    '...owwwwwwuo....',
    '..ouuuuussuo....',
    '..ou.o...o.o....',
    '..oooooooooo....',
    '................',
    '................',
    '................',
  ],
  [ // AMBUSH: hooded face under a snow cap, two eyes in the slit
    '................',
    '....oooooooo....',
    '...oWWWWWWWWo...',
    '..oWbWWWWWWbo...',
    '.oWboooooooWbo..',
    '.oWo.nnnnnn.oWo.',
    '.oWo.nEnnEn.oWo.',
    '.oWo.nnnnnn.oWo.',
    '.oWooooooooWWo..',
    '..oWbbbbbbWWo...',
    '...oWWWWWWWo....',
    '....oooooooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  [ // FLETCH: a fat quill, one-sided barbs, calamus at the bottom
    '.........oW.....',
    '........oWbW....',
    '.......oWbWb....',
    '......oWbbbW....',
    '.....oWbWbWb....',
    '....oWbbbWbW....',
    '...oWbWbWbf.....',
    '..oWbbbWbf......',
    '.oWbWbWo........',
    '.oWbbbWo........',
    '..oWddo.........',
    '..otso..........',
    '..otso..........',
    '..oddo..........',
    '...oo...........',
    '................',
  ],
];
const abIconCache = new Map();
function abIcon(i, gold) {
  const team = TEAMS[player.team];
  const key = i + ':' + team.mark + (gold ? ':g' : '');
  let cv = abIconCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    const pal = Object.assign({}, AB_PAL, {
      f: team.mark, F: team.coatL, E: gold ? '#f2cc6a' : '#f4f7ff',
    });
    const rows = AB_ICONS[i];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const col = pal[row[c]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(c, r, 1, 1);
      }
    }
    abIconCache.set(key, cv);
  }
  return cv;
}
// level-ups and a dodge charge coming back are edges the sim never announces
// to the HUD, so the strip watches for them itself and pops white
let abLvSeen = 0, abLvFlash = 0, abChSeen = -1, abChFlash = 0;
function drawXpBar(now, x, y) {
  const p = player;
  if (p.level > abLvSeen && abLvSeen > 0) abLvFlash = now + 0.5;
  abLvSeen = p.level;
  const hot = now < abLvFlash;
  const max = p.level >= LEVEL_MAX;
  const frac = max ? 1
    : (p.xp - LEVEL_XP[p.level - 1]) / (LEVEL_XP[p.level] - LEVEL_XP[p.level - 1]);
  const inner = AB_W - 2;
  const fw = Math.round(Math.max(0, Math.min(1, frac)) * inner);
  // dark silhouette + frost rim: the plate is nearly the old track colour,
  // so without this the bar is a gold smudge with no readable shape
  ctx.fillStyle = '#05070f';
  ctx.fillRect(x - 1, y - 1, AB_W + 2, AB_XP + 2);
  ctx.fillStyle = '#5a6a9a';
  ctx.fillRect(x, y, AB_W, 1);
  ctx.fillStyle = '#1c2448';
  ctx.fillRect(x, y + AB_XP - 1, AB_W, 1);
  ctx.fillStyle = '#35426e';
  ctx.fillRect(x, y, 1, AB_XP);
  ctx.fillRect(x + AB_W - 1, y, 1, AB_XP);
  ctx.fillStyle = '#05070f';
  ctx.fillRect(x + 1, y + 1, inner, AB_XP - 2);
  if (fw <= 0) return;
  const gx = x + 1, gy = y + 1, gh = AB_XP - 2;
  // 1px dark leading edge so the fill's end reads as a silhouette
  const cap = fw < inner ? 1 : 0;
  ctx.fillStyle = '#0a0e1c';
  ctx.fillRect(gx, gy, fw, gh);
  ctx.fillStyle = hot ? '#f4f7ff' : '#f5c542';
  ctx.fillRect(gx, gy, Math.max(1, fw - cap), gh);
  ctx.fillStyle = hot ? '#ffffff' : '#ffe08a';
  ctx.fillRect(gx, gy, Math.max(1, fw - cap), 1);
  ctx.fillStyle = hot ? '#cfd8e8' : '#b07a1c';
  ctx.fillRect(gx, gy + gh - 1, Math.max(1, fw - cap), 1);
}
function drawAbUp(i, now, hov) {
  const r = abUpRect(i);
  const y = r.y - (hov ? 1 : 0);
  const rim = hov ? '#f4f7ff'
    : (Math.sin(now * 8) > 0 ? '#f2cc6a' : '#c9a227');
  // dark box so the square silhouettes against snow above the plate
  ctx.fillStyle = '#0f1632';
  ctx.fillRect(r.x - 1, y - 1, r.w + 2, r.h + 2);
  ctx.fillStyle = rim;
  ctx.fillRect(r.x, y, r.w, r.h);
  ctx.fillStyle = BAG_WELL;
  ctx.fillRect(r.x + 1, y + 1, r.w - 2, r.h - 2);
  // 2px-thick 4x4 plus, equal arms, centred in the 6x6 well
  ctx.fillStyle = '#0f1632';
  ctx.fillRect(r.x + 2, y + 1, 4, 6);
  ctx.fillRect(r.x + 1, y + 2, 6, 4);
  ctx.fillStyle = '#f2cc6a';
  ctx.fillRect(r.x + 3, y + 2, 2, 4);
  ctx.fillRect(r.x + 2, y + 3, 4, 2);
}
function drawHudStrip(now) {
  const p = player, kit = kitOf(p);
  const R = hudStripRect();
  const hov = mouse.inside ? abHit(mouse.x, mouse.y) : null;
  // one chamfered plate behind bar and slots - the bag's ground, so the two
  // HUD pieces sit in the same family
  ctx.fillStyle = AB_BG;
  ctx.fillRect(R.x - 3, R.y, R.w + 6, R.h);
  ctx.fillStyle = '#35426e';
  ctx.fillRect(R.x - 2, R.y, R.w + 4, 1);
  ctx.fillRect(R.x - 2, R.y + R.h - 1, R.w + 4, 1);
  ctx.fillRect(R.x - 3, R.y + 1, 1, R.h - 2);
  ctx.fillRect(R.x + R.w + 2, R.y + 1, 1, R.h - 2);
  if (abChSeen >= 0 && p.dodgeCharges > abChSeen) abChFlash = now + 0.22;
  abChSeen = p.dodgeCharges;
  const dry = p.quiver <= 0;
  const amb = ambushReady(p);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const nockF = p.nockT > 0 ? clamp01(1 - p.nockT / Math.max(0.01, kit.nock)) : 1;
  const chF = p.dodgeCharges >= DODGE_CHARGES ? 1
    : clamp01(1 - p.dodgeRegenT / Math.max(0.01, kit.dodgeCd));
  const flF = p.quiver >= QUIVER_MAX ? 1 : clamp01(p.fletchT / Math.max(0.01, kit.fletch));
  const slots = [
    { frac: nockF, wipe: p.nockT > 0, flash: p.readyFlash > 0 },
    { frac: chF, wipe: p.dodgeCharges <= 0, flash: now < abChFlash },
    { frac: 1, wipe: false, flash: false },
    { frac: flF, wipe: p.quiver < QUIVER_MAX, flash: p.quiverFlash > 0 },
  ];
  for (let i = 0; i < AB_N; i++) {
    const s = slots[i];
    const cell = abSlotRect(i);
    const x = cell.x + (i === 0 && p.dryT > 0 ? (((now * 30) | 0) % 2 ? 1 : -1) : 0);
    const y = cell.y;
    const rim = s.flash ? '#f4f7ff'
      : i === 2 && amb ? '#f2cc6a'
      : i === 0 && dry ? '#7e3346' : '#35426e';
    ctx.fillStyle = rim;
    ctx.fillRect(x, y, AB_CELL, AB_CELL);
    if (rim === '#35426e') {
      ctx.fillStyle = '#46548a';
      ctx.fillRect(x, y, AB_CELL, 1);
      ctx.fillStyle = '#283258';
      ctx.fillRect(x, y + AB_CELL - 1, AB_CELL, 1);
    }
    ctx.fillStyle = i === 0 && dry ? '#241028' : BAG_WELL;
    ctx.fillRect(x + 1, y + 1, AB_CELL - 2, AB_CELL - 2);
    if (i === 0 && dry) ctx.globalAlpha = 0.55;
    ctx.drawImage(abIcon(i, i === 2 && amb), x + 2, y + 2);
    ctx.globalAlpha = 1;
    // AMBUSH charge-up: four gold ticks along the top of the well, then the
    // rim itself goes gold at full cover - no translucent snow over the art
    if (i === 2 && p.hide > 0) {
      const ticks = Math.round(p.hide * 4);
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k < ticks ? (amb ? '#f2cc6a' : '#cfe0f2') : '#2c3560';
        ctx.fillRect(x + 3 + k * 4, y + 2, 3, 2);
      }
    }
    if (s.wipe) {
      const cov = 16 - Math.round(s.frac * 16);
      if (cov > 0) {
        ctx.fillStyle = AB_COVER;
        ctx.fillRect(x + 2, y + 2, 16, cov);
        if (cov < 16) {
          ctx.fillStyle = '#9fb6d8';
          ctx.fillRect(x + 2, y + 1 + cov, 16, 1);
        }
      }
    }
    if (s.flash) {
      ctx.fillStyle = '#f4f7ff';
      ctx.fillRect(x + 2, y + 2, 16, 1);
      ctx.fillRect(x + 2, y + 2, 1, 16);
    }
    if (i === 0) {
      const col = dry ? '#e0637a' : p.quiverFlash > 0 ? '#f2cc6a' : '#f4f7ff';
      drawPixelTextOutline(ctx, String(p.quiver), x + 2, y + 12, col, '#0f1632');
    }
    if (i === 1) {
      for (let k = 0; k < DODGE_CHARGES; k++) {
        ctx.fillStyle = '#0f1632';
        ctx.fillRect(x + 2 + k * 5, y + 13, 4, 4);
        const on = k < p.dodgeCharges;
        const regen = !on && k === p.dodgeCharges;
        ctx.fillStyle = on ? '#f2cc6a' : '#2c3560';
        ctx.fillRect(x + 3 + k * 5, y + 14, 2, 2);
        if (regen) {
          const h = Math.max(1, Math.round(s.frac * 2));
          ctx.fillStyle = '#9fb6d8';
          ctx.fillRect(x + 3 + k * 5, y + 16 - h, 2, h);
        }
      }
    }
    drawPixelTextOutline(ctx, String(i + 1), x + AB_CELL - 6, y + AB_CELL - 8, '#8fa0c8', '#0f1632');
    // rank lives on the well, not on the plus-square (that one vanishes)
    for (let k = 0; k < AB_RANK_MAX; k++) {
      ctx.fillStyle = k < p.skill[i] ? '#f2cc6a' : '#2c3560';
      ctx.fillRect(x + 4 + k * 4, y + 1, 3, 1);
    }
  }
  drawXpBar(now, R.x, R.y + AB_PAD + AB_CELL + AB_PAD);
  // plus-squares on TOP of the frame, only while a point can land there
  for (let i = 0; i < AB_N; i++) {
    if (!abCanBuy(p, i)) continue;
    drawAbUp(i, now, hov && (hov.kind === 'up' || hov.kind === 'slot') && hov.i === i);
  }
}

function renderUI(now) {
  if (state.mode === 'title' || state.mode === 'drop' || window.DBG.hideUI) return;
  if (endScreen()) return; // a victory or defeat screen owns the whole frame

  // title -> play: the HUD slides in over the last part of the intro - the
  // minimap from the top, the backpack from the right, the hud strip from
  // below.
  // The TOP LEFT is deliberately empty: the berry and fish counts that used
  // to stack there (and the gold that sat left of the minimap) are all on the
  // backpack's bottom strip now, which is why nothing slides in from the left
  // any more. Health lives on the in-world bar.
  const hudIn = state.intro > 0 ? easeOut(Math.max(0, 1 - state.intro / HUD_IN_T)) : 1;
  const slide = 1 - hudIn;
  const out = state.mode === 'dead'; // the local wallet is moot once you are out

  ctx.save();
  ctx.translate(0, Math.round(-slide * (MM_R * 2 + 40)));
  // minimap with day/night ring
  renderMinimap(now);
  ctx.restore();

  // the backpack and the gear row are one widget, bottom-right; it rides the
  // intro slide in from the right
  if (!out) {
    ctx.save();
    ctx.translate(Math.round(slide * 60), 0);
    drawBag(now);
    ctx.restore();
  }

  // hud strip (xp bar + ability slots), bottom-centre; it rides the intro
  // slide up from below
  if (!out) {
    ctx.save();
    ctx.translate(0, Math.round(slide * 40));
    drawHudStrip(now);
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
    drawPixelTextOutline(ctx, state.msg, (VIEW_W - w) / 2, VIEW_H - 54, '#fff4d8', '#0f1632');
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
  // oldest at the top, newest along the bottom; it has the bottom-left corner
  // to itself again now the gear row lives in the backpack, and steps up by
  // replayLift() px for as long as the replay window is open
  let y = VIEW_H - 8 - replayLift() - pitch * n;
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
        // eliminated reads OUT; a respawn-pending slot shows the countdown
        // instead, since "OUT" on someone back in 3s is actively wrong
        const tag = p.eliminated ? 'OUT' : Math.ceil(p.respawnT) + 's';
        drawPixelTextShadow(ctx, tag, x + 18 + pixelTextWidth(p.name), ry + 1, '#8f9cc4', shadow);
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

// a screen point over the chart -> the world tile under it (null off the map).
// The chart is the only way to flag a tile that is off-screen, so the middle
// click needs the inverse of the MAP_S projection everything else draws with.
function mapTileAt(sx, sy) {
  if (sx < MAP_X || sy < MAP_Y || sx >= MAP_X + MAP_W || sy >= MAP_Y + MAP_W) return null;
  const tx = Math.floor((sx - MAP_X) / MAP_S), ty = Math.floor((sy - MAP_Y) / MAP_S);
  return inWorld(tx, ty) ? { tx, ty } : null;
}

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
      const o = structOf(objects[i]); // resolves a multi-tile building's 'part' fillers to the anchor
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
      else if (o && o.type === 'net') { r = 118; g = 156; b = 176; }
      else if (o && o.type === 'keep') { r = 196; g = 70; b = 70; }
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

  // worker flags, your side's only: the same pennant the minimap draws, with
  // the job's icon over it - the chart is where an order across the world is
  // given and read, so it has room to say which order it was
  for (const q of players) {
    if (!q.active || q.team !== player.team || !q.flag) continue;
    const lx = MAP_X + Math.round((q.flag.tx + 0.5) * MAP_S);
    const ly = MAP_Y + Math.round((q.flag.ty + 0.5) * MAP_S);
    drawFlagIcon(ctx, q.flag.job, lx + 3, ly - 10, TEAMS[q.team].mark, '#241a10');
    drawFlagPennant(ctx, lx, ly, TEAMS[q.team].mark, '#241a10');
  }
  // the tile the pointer would plant on - only while the middle button is
  // held, exactly as in the world (state.flagAim)
  if (state.flagAim && mouse.inside) {
    const mt = mapTileAt(mouse.x, mouse.y);
    if (mt) {
      const f = player.flag;
      const lift = !!f && f.tx === mt.tx && f.ty === mt.ty;
      const gx = MAP_X + Math.round((mt.tx + 0.5) * MAP_S), gy = MAP_Y + Math.round((mt.ty + 0.5) * MAP_S);
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(now * 4);
      if (lift) drawFlagPennant(ctx, gx, gy, '#f4f7ff', '#241a10');
      else drawFlagIcon(ctx, flagResolve(player, mt.tx, mt.ty).job, gx, gy - 6, '#f4f7ff', '#241a10');
      ctx.globalAlpha = 1;
    }
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
  drawPixelText(g, 'MASTER', 14, ROW_SOUND - SET_Y, L);
  drawPixelText(g, 'MUSIC', 14, ROW_MUSIC - SET_Y, L);
  drawPixelText(g, 'SOUNDS', 14, ROW_SFX - SET_Y, L);
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
    [['WASD', 'MOVE'], ['SPACE', 'DODGE'], ['CTRL', 'SNEAK'], ['CLICK', 'BOW'], ['E', 'HARVEST'], ['Q', 'EAT BERRY'], ['F', 'EAT FISH'], ['B', 'BACKPACK']],
    [['M', 'WORLD MAP'], ['N', 'MUTE'], ['P', 'PAUSE'], ['ESC', 'SETTINGS'], ['SCROLL', 'ZOOM'], ['F3', 'INFO'], ['.', 'HITBOX']],
  ];
  for (let c = 0; c < 2; c++) {
    let y = 137; // eight rows in the left column: pitch 9 so the last still clears ESC CLOSE
    const x0 = c === 0 ? 16 : 128;
    for (const [k, desc] of cols[c]) {
      drawPixelText(g, k, x0, y, '#ffd95c');
      drawPixelText(g, desc, x0 + (c === 0 ? 36 : 26), y, '#7a8bb8');
      y += 9;
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
  } else if (dragSlider === 'music') {
    settings.musicVol = Math.round(t * 20) / 20;
    SFX.setMusicVolume(settings.musicVol);
  } else if (dragSlider === 'sfx') {
    settings.sfxVol = Math.round(t * 20) / 20;
    SFX.setSfxVolume(settings.sfxVol);
  } else if (dragSlider === 'map') {
    settings.mmR = Math.round(16 + t * 18);
    applyMinimapSize();
  }
}

// the speaker beside the MASTER track: 9x9, the same plate the toggle rows use
function muteBtnRect() { return { x: SET_MUTE_X, y: ROW_SOUND - 1, w: 9, h: 9 }; }

// which settings widget is under the pointer (null for none); shared by the
// click handler and the cursor so the hand cursor can never disagree with a click
function settingsHit() {
  const mx = mouse.x, my = mouse.y;
  const b = muteBtnRect();
  if (mx >= b.x - 2 && mx < b.x + b.w + 2 && my >= b.y - 2 && my < b.y + b.h + 2) return 'mute';
  if (mx < SL_X - 4 || mx > SL_X + SL_W + 6) return null;
  // 14px pitch, so the bands must not overlap or a click lands on two rows
  const inRow = (y) => my >= y - 3 && my <= y + 10;
  if (inRow(ROW_SOUND)) return 'vol';
  if (inRow(ROW_MUSIC)) return 'music';
  if (inRow(ROW_SFX)) return 'sfx';
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
  if (hit === 'vol' || hit === 'music' || hit === 'sfx' || hit === 'map') { dragSlider = hit; applySliderDrag(); return; }
  if (hit === 'mute') settings.muted = SFX.toggleMute();
  else if (hit === 'shake') settings.shake = !settings.shake;
  else if (hit === 'info') settings.info = !settings.info;
  else if (hit === 'cursor') settings.pixelCursor = !settings.pixelCursor;
  SFX.pickup();
  saveSettings();
}

// dim: the fill and the readout go grey. The three sound dials pass it while
// muted, so the speaker's state reads off every track it silences at a glance
function drawSliderRow(y, t, txt, dim) {
  ctx.fillStyle = '#0a0e23'; ctx.fillRect(SL_X - 1, y + 1, SL_W + 2, 5);
  ctx.fillStyle = '#2c3a68'; ctx.fillRect(SL_X, y + 2, SL_W, 3);
  ctx.fillStyle = dim ? '#4a5480' : '#ffd95c'; ctx.fillRect(SL_X, y + 2, Math.round(t * SL_W), 3);
  const kx = SL_X + Math.round(t * SL_W);
  ctx.fillStyle = '#0a0e23'; ctx.fillRect(kx - 2, y - 1, 5, 9);
  ctx.fillStyle = dim ? '#7a8bb8' : '#f4f7ff'; ctx.fillRect(kx - 1, y, 3, 7);
  drawPixelTextShadow(ctx, txt, SL_X + SL_W + 9, y, dim ? '#5a6690' : '#9fb6d8', 'rgba(8,12,28,0.9)');
}

// The mute control is a speaker, not a labelled toggle: a cone with two waves
// coming off it, the waves swapped for a cross when it is off.
function drawMuteBtn(hot) {
  const b = muteBtnRect();
  const on = !SFX.isMuted();
  ctx.fillStyle = '#0a0e23'; ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = hot ? '#1f2b5c' : '#121a3a'; ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
  const x = b.x + 1, y = b.y + 1; // the 7x7 glyph field
  ctx.fillStyle = on ? '#ffd95c' : '#7a8bb8';
  ctx.fillRect(x, y + 2, 1, 3); ctx.fillRect(x + 1, y + 1, 1, 5); ctx.fillRect(x + 2, y, 1, 7);
  if (on) {
    ctx.fillRect(x + 4, y + 2, 1, 3);
    ctx.fillRect(x + 6, y + 1, 1, 5);
  } else {
    ctx.fillStyle = '#ff6a5a';
    ctx.fillRect(x + 4, y + 2, 1, 1); ctx.fillRect(x + 5, y + 3, 1, 1); ctx.fillRect(x + 6, y + 4, 1, 1);
    ctx.fillRect(x + 6, y + 2, 1, 1); ctx.fillRect(x + 4, y + 4, 1, 1);
  }
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
  const off = SFX.isMuted();
  const hit = slide ? null : settingsHit(); // the menu's slide-in is not hoverable mid-flight
  drawSliderRow(ROW_SOUND, settings.volume, String(Math.round(settings.volume * 100)), off);
  drawMuteBtn(hit === 'mute');
  drawSliderRow(ROW_MUSIC, settings.musicVol, String(Math.round(settings.musicVol * 100)), off);
  drawSliderRow(ROW_SFX, settings.sfxVol, String(Math.round(settings.sfxVol * 100)), off);
  drawSliderRow(ROW_MAP, (settings.mmR - 16) / 18, 'R' + settings.mmR);
  drawToggleRow(ROW_SHAKE, settings.shake);
  drawToggleRow(ROW_INFO, settings.info);
  drawToggleRow(ROW_CURSOR, settings.pixelCursor, 'PIXEL', 'BROWSER');
  if (slide) ctx.restore();
}

// ------------------------------------------------------------ player profile
// Who you are between matches: the display name every other slot reads over
// your head, and the three lifetime numbers under it. The STORE is
// js/profile.js and nothing here touches localStorage - this banner is only
// the panel, the field and the title-screen tag that opens them.
//
// The panel is the menu's fourth sub-panel ('name'), so it inherits the slide,
// the frost slab and overMenuPanel() from the settings/tutorial/patch set. It
// opens itself once, on a first launch (updateTitle), and after that only from
// the tag bottom-left. There is no separate "click to edit" state: the panel
// being open IS the editor, and the keyboard belongs to it while it is up.
const NAME_FIELD = { x: 22, y: 30, w: 196, h: 22 }; // panel-local, like every other panel offset
const NAME_TICK_Y = 58;   // the capacity ticks under the field: one per allowed character
const NAME_STAT_Y = 100;  // first stat row
const NAME_STAT_P = 24;   // and the pitch of the three
const NAME_PLANK_Y = 176;
const NAME_BW = 88, NAME_BH = 20, NAME_GAP = 12;
const NAME_SHAKE_T = 0.3; // the field's refusal: it rattles and flushes red

// The three stats wear icons and no labels, the way the victory tally does:
// the eagle that starts every match, the coin, and the sun for the day you
// reached. The quill is the edit affordance on the title-screen tag.
const NAME_BIRD_ICON = [
  '........', '........', '...oo...', 'oo.oo.oo',
  '.oooooo.', '...oo...', '........', '........',
];
const NAME_SUN_ICON = [
  '...yy...', '.y....y.', '..yyyy..', 'y.yyyy.y',
  'y.yyyy.y', '..yyyy..', '.y....y.', '...yy...',
];
const NAME_ICON_PAL = { '.': null, o: '#cfe0ff', y: '#f2cc6a' };
const NAME_QUILL = ['....hh', '...hh.', '..hh..', '.hh...', 'th....', 't.....'];
const NAME_QUILL_PAL = { '.': null, h: '#9fb6d8', t: '#f2cc6a' };
const NAME_QUILL_HOT = { '.': null, h: '#ffd95c', t: '#fff1c2' };

const namePanelCv = document.createElement('canvas');
namePanelCv.width = SET_W; namePanelCv.height = SET_H;
function buildNamePanel() {
  const g = namePanelCv.getContext('2d');
  bakeFrostSlab(g, SET_W, SET_H, 'PLAYER');
  // the field: a well sunk into the slab (dark floor, lit lower lip), with
  // the frame's ice-blue picked up in its top corners
  const f = NAME_FIELD;
  g.fillStyle = '#080c1c'; g.fillRect(f.x - 1, f.y - 1, f.w + 2, f.h + 2);
  g.fillStyle = '#0a0e23'; g.fillRect(f.x, f.y, f.w, f.h);
  g.fillStyle = '#2c3a68'; g.fillRect(f.x + 1, f.y + f.h - 1, f.w - 2, 1);
  g.fillStyle = '#35426e';
  g.fillRect(f.x, f.y, 3, 1); g.fillRect(f.x, f.y, 1, 3);
  g.fillRect(f.x + f.w - 3, f.y, 3, 1); g.fillRect(f.x + f.w - 1, f.y, 1, 3);
  // the rule between the name and the numbers it has earned
  g.fillStyle = '#2c3a68'; g.fillRect(14, 74, SET_W - 28, 1);
}

// the local slot wears the profile name; it is set in the Player constructor
// and this is the only other place it changes
function applyProfileName() { player.name = PROFILE.name(); }

function openNamePanel(first) {
  const m = state.menu;
  m.nameFirst = !!first;      // a first launch offers SKIP; an edit offers CANCEL
  m.nameBuf = PROFILE.get().name || '';
  m.nameShake = 0;
  m.nameHover = [0, 0];
  openMenuPanel('name');
}
// the buffer as it stands would be accepted: what lights the DONE plank
function nameOk() { return PROFILE.validate(state.menu.nameBuf).ok; }

function nameCommit() {
  const m = state.menu;
  const r = PROFILE.setName(m.nameBuf);
  if (!r.ok) { m.nameShake = NAME_SHAKE_T; SFX.iceKnock(); return; } // rejected: the field says so, and stays open
  applyProfileName();
  SFX.unlock();
  closeMenuPanel();
}
// ESC, or the right-hand plank. On a first launch this is the SKIP the prompt
// promises - the default name stands until it is edited - and afterwards it is
// a plain cancel that leaves the stored name alone.
function nameDismiss() {
  if (state.menu.nameFirst) { PROFILE.skipName(); applyProfileName(); }
  SFX.pickup();
  closeMenuPanel();
}

// The editor owns the keyboard while it is up (see the keydown handler). A
// character the name may not hold is simply never drawn - that refusal IS the
// validation message, so the only rejections with a sound are a full field and
// a name the filter turns down.
function nameKey(e) {
  const m = state.menu;
  if (m.panelT < 1 || m.closing) return; // still sliding
  if (e.key === 'Enter') { nameCommit(); return; }
  if (e.key === 'Escape') { nameDismiss(); return; }
  if (e.key === 'Backspace') {
    if (m.nameBuf) { m.nameBuf = m.nameBuf.slice(0, -1); SFX.tally(); }
    return;
  }
  if (e.key.length !== 1) return;
  const ch = e.key.toUpperCase();
  if (!/^[A-Z0-9]$/.test(ch)) return;
  if (m.nameBuf.length >= PROFILE.NAME_MAX) { m.nameShake = NAME_SHAKE_T; SFX.iceKnock(); return; }
  m.nameBuf += ch;
  SFX.tally();
}

function namePlankRects() {
  const y = SET_Y + NAME_PLANK_Y;
  const x0 = SET_X + Math.round((SET_W - (NAME_BW * 2 + NAME_GAP)) / 2);
  return [{ x: x0, y, w: NAME_BW, h: NAME_BH }, { x: x0 + NAME_BW + NAME_GAP, y, w: NAME_BW, h: NAME_BH }];
}
// which plank is under the pointer, or -1; DONE refuses the hover while the
// buffer would be rejected, so the hand cursor never promises a dead click
function namePanelHit() {
  const r = namePlankRects();
  for (let i = 0; i < 2; i++) {
    if (mouse.x >= r[i].x - 2 && mouse.x < r[i].x + r[i].w + 2 &&
      mouse.y >= r[i].y - 3 && mouse.y < r[i].y + r[i].h + 3) return i === 0 && !nameOk() ? -1 : i;
  }
  return -1;
}
function namePanelClick() {
  const h = namePanelHit();
  if (h === 0) { state.menu.pressT = 0.12; nameCommit(); }
  else if (h === 1) { state.menu.pressT = 0.12; nameDismiss(); }
}

function renderNamePanel(now, slide) {
  const m = state.menu;
  const px = SET_X, py = SET_Y + slide;
  ctx.drawImage(namePanelCv, px, py);

  // ---- the field -------------------------------------------------------
  const f = NAME_FIELD;
  const bad = m.nameShake / NAME_SHAKE_T;
  const shake = bad > 0 ? Math.round(Math.sin(now * 90) * 2.5 * bad) : 0;
  if (bad > 0) { // the refusal floods the well red rather than printing a reason
    ctx.globalAlpha = 0.5 * bad;
    ctx.fillStyle = '#a83a3a'; ctx.fillRect(px + f.x, py + f.y, f.w, f.h);
    ctx.globalAlpha = 1;
  }
  // an empty buffer shows the default, greyed: what SKIP would give you
  const empty = !m.nameBuf;
  const txt = empty ? PROFILE.DEFAULT_NAME : m.nameBuf;
  const tw = pixelTextWidth(txt, 2);
  const tx = px + f.x + Math.round((f.w - tw - 5) / 2) + shake;
  const ty = py + f.y + 6;
  drawPixelTextShadow(ctx, txt, tx, ty, empty ? '#4a5480' : bad > 0 ? '#ffb0a0' : '#f4f7ff', '#0a0e23', 2);
  if (Math.floor(now * 2) % 2 === 0) { // caret: after the buffer, or before the ghost default
    ctx.fillStyle = '#ffd95c';
    ctx.fillRect(empty ? tx - 5 : tx + tw + 2, ty, 2, 10);
  }
  // capacity: one tick per allowed character, lit as far as the buffer reaches
  const tks = PROFILE.NAME_MAX;
  const kw = tks * 4 - 1;
  let kx = px + Math.round((SET_W - kw) / 2);
  for (let i = 0; i < tks; i++) {
    ctx.fillStyle = i < m.nameBuf.length ? '#f2cc6a' : '#2c3a68';
    ctx.fillRect(kx, py + NAME_TICK_Y, 3, 2);
    kx += 4;
  }

  // ---- the lifetime numbers --------------------------------------------
  const st = PROFILE.stats();
  const rows = [[NAME_BIRD_ICON, String(st.games), '#cfe0ff'],
    [null, String(st.gold), '#f2cc6a'], [NAME_SUN_ICON, String(st.bestDay), '#cfe0ff']];
  for (let i = 0; i < rows.length; i++) {
    const ry = py + NAME_STAT_Y + i * NAME_STAT_P;
    const ix = px + 84;
    if (rows[i][0]) stampGrid(rows[i][0], NAME_ICON_PAL, ix, ry + 1, 1);
    else ctx.drawImage(SPRITES.itemGold, ix, ry + 1);
    drawPixelTextShadow(ctx, rows[i][1], ix + 16, ry, rows[i][2], '#0a0e23', 2);
  }

  // ---- the two planks ---------------------------------------------------
  const r = namePlankRects();
  const ok = nameOk();
  const pressed = m.pressT > 0;
  ctx.globalAlpha = ok ? 1 : 0.4; // a name that would be refused dims its own way out
  drawMenuButton({ x: r[0].x, y: r[0].y + slide, w: r[0].w, h: r[0].h }, 'DONE',
    ok ? m.nameHover[0] : 0, now, ok && pressed && m.nameHover[0] > 0.5);
  ctx.globalAlpha = 1;
  drawMenuButton({ x: r[1].x, y: r[1].y + slide, w: r[1].w, h: r[1].h },
    m.nameFirst ? 'SKIP' : 'CANCEL', m.nameHover[1], now, pressed && m.nameHover[1] > 0.5);
}

// The name bottom-left of the title screen, mirroring the patch tag on the
// right: the name plus a quill that gilds on hover. Clicking either opens the
// panel - the quill IS the edit affordance, so there is nothing to caption.
function nameTagRect() {
  return { x: 5, y: VIEW_H - 9, w: pixelTextWidth(PROFILE.name()) + 4 + 6, h: 6 };
}
function overNameTag() {
  const r = nameTagRect();
  return mouse.x >= r.x - 3 && mouse.x < r.x + r.w + 3 && mouse.y >= r.y - 3 && mouse.y < r.y + r.h + 3;
}
function drawNameTag() {
  const hot = !state.menu.panel && overNameTag();
  const r = nameTagRect();
  const nm = PROFILE.name();
  drawPixelTextShadow(ctx, nm, r.x, r.y, hot ? '#ffd95c' : '#9fb6d8', 'rgba(15,22,50,0.9)');
  stampGrid(NAME_QUILL, hot ? NAME_QUILL_HOT : NAME_QUILL_PAL, r.x + pixelTextWidth(nm) + 4, r.y, 1);
  if (hot) { ctx.fillStyle = '#c89a3c'; ctx.fillRect(r.x, r.y + 7, r.w, 1); }
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
const PATCH_TXT = 'PATCH 1.67'; // printed bottom-right of the title screen; click it for the notes
// one sentence per patch, newest first - the biggest change only, in plain english
const PATCH_NOTES = [
  ['1.67', 'HOUSEKEEPING ONLY - EVERYTHING THE GAME DRAWS, FROM THE GROUND TO THE CURSOR, MOVED INTO FILES OF THEIR OWN, EVERY LINE UNCHANGED, AND NOTHING IN THE GAME CHANGED.'],
  ['1.66', 'HOUSEKEEPING ONLY - EVERYTHING A PLAYER DOES, EVERYTHING A BOT THINKS AND THE WHOLE FRAME SIM MOVED INTO FILES OF THEIR OWN, AND NOTHING IN THE GAME CHANGED.'],
  ['1.65', 'HOUSEKEEPING ONLY - THE WILDLIFE AND THE BUILDINGS MOVED INTO FILES OF THEIR OWN, EVERY LINE UNCHANGED, AND NOTHING IN THE GAME CHANGED.'],
  ['1.64', 'HOUSEKEEPING ONLY - THE WORLD AND THE WAYS THROUGH IT MOVED INTO FILES OF THEIR OWN, EVERY SEED STILL LANDS THE SAME, AND NOTHING IN THE GAME CHANGED.'],
  ['1.63', 'HOUSEKEEPING ONLY - THE PLAYERS AND THE CONTROLS MOVED INTO FILES OF THEIR OWN, EVERY LINE UNCHANGED, AND NOTHING IN THE GAME CHANGED.'],
  ['1.62', 'HOUSEKEEPING ONLY - THE TUNING TABLES, THE DICE AND THE CANVAS MOVED INTO FILES OF THEIR OWN, EVERY LINE UNCHANGED, AND NOTHING IN THE GAME CHANGED.'],
  ['1.61', 'HOUSEKEEPING ONLY - THE CODE LOST ITS WRAPPER SO THE COMING FILE SPLIT CAN SHARE ONE SCOPE, EVERY LINE IS WHERE IT WAS AND NOTHING IN THE GAME CHANGED.'],
  ['1.60', 'HOUSEKEEPING ONLY - THE PLAYBOOK FOR SPLITTING GAME.JS INTO EIGHTEEN FILES IS WRITTEN DOWN IN DOCS/DEV/SPLIT-PLAN.MD, TEN COMMITS EACH LEAVING THE GAME PLAYABLE, AND NOTHING IN THE GAME CHANGED.'],
  ['1.59', 'LOSING ENDS ON A DEFEAT SCREEN NOW - LOBBY TAKES YOU TO YOUR PLACING, GOLD, KILLS, LEVEL, MATCH TIME AND THE KIT YOU WENT DOWN IN, AND THE LINE THAT SAYS YOU COLLAPSED IS TWICE THE SIZE AND UP WHERE YOU CAN READ IT AT A GLANCE.'],
  ['1.58', 'THE HEALTH PLATE AND THE NAME OVER YOUR HEAD BOTH SIT SQUARE WITH YOUR BODY NOW, AND THE STUN SLOT BESIDE THE BARS IS BACK TO APPEARING ONLY WHEN SOMETHING ACTUALLY STUNS YOU INSTEAD OF SITTING THERE EMPTY.'],
  ['1.57', 'THE NAME OVER A HEAD IS CENTRED ON THE BODY NOW AND STAYS THERE - IT USED TO HOP A PIXEL LEFT AND RIGHT AS YOU WALKED, BECAUSE THE HALF PIXEL AN ODD-WIDTH WORD CARRIES WAS BEING ROUNDED TOGETHER WITH THE CAMERA.'],
  ['1.56', 'THE HEALTH FRAME OVER YOUR HEAD SITS SQUARE WITH YOU NOW INSTEAD OF HANGING THREE PIXELS TO THE LEFT - THE STUN SLOT ON ITS RIGHT IS ALWAYS THERE, EMPTY UNTIL SOMETHING STUNS YOU - AND THE HITBOX KEY DRAWS A PINK LINE DOWN THE MIDDLE OF EVERY PLAYER ANIMAL ROBOT AND BUILDING SO YOU CAN SEE IT.'],
  ['1.55', 'YOU HAVE A NAME NOW - THE GAME ASKS FOR ONE THE FIRST TIME IT OPENS, IT SITS BOTTOM-LEFT OF THE TITLE SCREEN WITH A QUILL TO CHANGE IT, IT RIDES OVER YOUR HEAD IN THE MATCH THE WAY EVERY RIVAL NAME ALREADY DID, AND THE MATCHES GOLD AND DAYS BEHIND IT ARE KEPT.'],
  ['1.54', 'HOUSEKEEPING ONLY - THE PROJECT DOCS SPLIT THE DESIGN AND THE FILE LAYOUT OUT INTO PAGES OF THEIR OWN, AND THE README FINALLY DESCRIBES THE FREE-FOR-ALL INSTEAD OF A SOLO SURVIVAL GAME, WITH NOTHING IN THE GAME CHANGED.'],
  ['1.53', 'HOUSEKEEPING ONLY - 34 MB OF UNUSED ALTERNATE MUSIC TAKES AND ALBUM ART LEFT THE FOLDER AND THE PROJECT DOCS GOT A TRIM, WITH NOTHING IN THE GAME CHANGED.'],
  ['1.52', 'HOUSEKEEPING ONLY - THE DEV SERVER AND THE SOUND BAKER MOVED INTO A TOOLS FOLDER, AND NOTHING IN THE GAME CHANGED.'],
  ['1.51', 'THE ICE OPENS IN TWO HITS AND THE HOLE IS A BUILD SITE - SET A FISH NET ON IT AND IT FISHES FOR YOU, HOLDING THREE AT A TIME FOR WHOEVER WALKS OUT ONTO IT, YOURS OR NOT - WHILE THE SHOAL IS A LIVING POPULATION NOW, FISHED DOWN AND REFILLED BY NEW FISH SWIMMING UP OUT OF THE DEEP.'],
  ['1.50', 'THE WORKER FLAG IS A HELD GESTURE NOW - HOLD MIDDLE MOUSE TO SEE THE ORDER AND THE TILE IT WOULD LAND ON, RELEASE TO PLANT - SO NOTHING SITS ON YOUR CURSOR WHEN YOU ARE NOT GIVING ONE.'],
  ['1.49', 'MIDDLE CLICK PLANTS ONE FLAG AND EVERY WORKER YOU OWN OBEYS IT - ON A TREE OR ROCK THEY CUT THERE AND SPREAD OUT, ON OPEN GROUND THEY CLEAR A LANE OUT TO IT FROM THE BAY, ON YOUR OWN BUILDING THEY GUARD IT, AND ON ANYTHING ANOTHER TEAM OWNS THEY GO AND BREAK IT.'],
  ['1.48', 'THE DODGE ROLL IS A WEAPON NOW - IT GOES STRAIGHT THROUGH RABBITS WOLVES ROBOTS AND RIVALS, HITTING AND STUNNING EACH ONE ONCE, WHILE A DEER TREE ROCK OR BUILDING IS A TACKLE THAT HURTS AND STUNS BOTH OF YOU - AND EVERY BIT OF IT HITS HARDER THE FASTER YOU WERE GOING, SO DASH OUT OF AN ICE SLIDE.'],
  ['1.47', 'EVERY ANIMAL WALKS A REAL ROUTE NOW INSTEAD OF DRIFTING - THEY ROUND THE TREES AND STOP WHERE THEY MEANT TO - AND DEER BOLT FROM YOU THE WAY RABBITS DO, SO CRAWLING IN UNDER THE SNOW IS HOW YOU GET CLOSE TO ONE.'],
  ['1.46', 'THE FROSTLANDS HAVE A SCORE AND A VOICE NOW - A SONG FOR THE MENU, THE CLASS PAGE, THE EAGLE AND THE END SCREEN, RECORDED SOUND FOR EVERY AXE BOW AND BOOT, AND MASTER MUSIC AND SOUNDS DIALS IN THE ESC MENU.'],
  ['1.45', 'BUILD YOUR TEAM A KEEP AND DEATH IS A RESPAWN TIMER INSTEAD OF THE END - LOSE IT AND IT IS PERMANENT AGAIN - AND A FINISHED KEEP CRAFTS RARITY-ROLLED CARDS FOR A PERMANENT PICK-ONE-OF-THREE UPGRADE.'],
  ['1.44', 'THE XP BAR HAS A DARK SILHOUETTE NOW, AND LEVEL-UP SQUARES SIT ON THE FRAME RATHER THAN INSIDE IT.'],
  ['1.43', 'EACH LEVEL GIVES A SKILL POINT YOU SPEND BY CLICKING THE SQUARE ABOVE AN ABILITY.'],
  ['1.42', 'THE QUIVER STRIP IS NOW A SEGMENTED XP BAR OVER FOUR ABILITY SLOTS, BOTTOM CENTRE.'],
  ['1.41', 'YOU CARRY A BACKPACK NOW - TEN SLOTS OPENED WITH B, WITH YOUR GEAR AND YOUR GOLD IN THE SAME FRAME BOTTOM RIGHT.'],
  ['1.40', 'ONE KEY FOR BOTH DEBUG VIEWS NOW: . DRAWS THE HITBOXES, AND A SECOND PRESS ADDS THE ROUTE EVERY WALKER IS FOLLOWING.'],
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
    if (m.panel === 'name') { if (overMenuPanel()) namePanelClick(); else if (!m.nameFirst) nameDismiss(); return; } // the first-launch prompt is modal: it wants an answer, not a stray click
    if (!overMenuPanel()) closeMenuPanel();
    return;
  }
  if (overNameTag()) { openNamePanel(false); return; }
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
  SFX.music.stop(0.6);
}

// the die: whiteout, then reload on a fresh seed (SEED is a const every
// deterministic value closes over, so a new world is a new page)
function rerollWorld() {
  const m = state.menu;
  if (state.fade) return;
  m.rolling = 0.6;
  SFX.dodge();
  SFX.music.stop(0.45);
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
  // the first launch asks for a name once the title has finished arriving;
  // PROFILE.named() is what stops it coming back, and SKIP sets it too
  if (!PROFILE.named() && !m.panel && m.screen === 'menu' && m.t > 1.4 && !state.intro && !state.fade) openNamePanel(true);
  // the name field's refusal rattle, and the PLAYER planks' hover eases
  if (m.nameShake > 0) m.nameShake = Math.max(0, m.nameShake - dt);
  if (m.panel === 'name') {
    const nh = menuPanelReady() ? namePanelHit() : -1;
    for (let i = 0; i < 2; i++) m.nameHover[i] += ((nh === i ? 1 : 0) - m.nameHover[i]) * Math.min(1, dt * 14);
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
// pal is the four colours the rule is struck in - the bar, its lit middle,
// the end diamonds and the spark in the centre. It defaults to gold; the
// defeat screen passes RULE_FROST, so one rule serves both endings.
const RULE_GOLD = { bar: '#c89a3c', hi: '#ffd95c', gem: '#ffd95c', spark: '#ff8a3c' };
const RULE_FROST = { bar: '#4a5f96', hi: '#9fbde0', gem: '#cfe4f2', spark: '#e8f2ff' };
function drawGoldRule(cx, y, half, a, pal) {
  const P = pal || RULE_GOLD;
  ctx.globalAlpha = a;
  const dia = (x, r, c) => {
    ctx.fillStyle = c;
    for (let d = -r; d <= r; d++) { const w = r - Math.abs(d); ctx.fillRect(x - w, y + d, w * 2 + 1, 1); }
  };
  ctx.fillStyle = '#0a0e23'; ctx.fillRect(cx - half, y + 1, half * 2 + 1, 1);
  ctx.fillStyle = P.bar; ctx.fillRect(cx - half, y, half * 2 + 1, 1);
  ctx.fillStyle = P.hi; ctx.fillRect(cx - 16, y, 33, 1);
  for (const ex of [cx - half, cx + half]) { dia(ex, 2, '#0a0e23'); dia(ex, 1, P.gem); }
  dia(cx, 3, '#0a0e23'); dia(cx, 2, P.bar);
  ctx.fillStyle = P.spark; ctx.fillRect(cx, y, 1, 1);
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
  SFX.music.play('select');
}
function leaveSelect() {
  state.menu.screen = 'menu';
  SFX.pickup();
  SFX.music.play('intro');
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
    drawNameTag(); // the profile name and its quill, opposite corner
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
    else if (m.panel === 'name') renderNamePanel(now, slide);
    else if (m.panel === 'patch') {
      ctx.drawImage(patchPanelCv, SET_X, SET_Y + slide);
      ctx.drawImage(patchNotesCv, 0, m.patchScroll, SET_W, PN_H, SET_X, SET_Y + slide + PN_Y, SET_W, PN_H);
      drawPatchBar(SET_X, SET_Y + slide);
    } else ctx.drawImage(helpPanelCv, SET_X, SET_Y + slide);
  }
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
    ctx.drawImage(SPRITES.champ[ws.champ][ws.team].prone.right[0], bx, by, 80, 80);
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
