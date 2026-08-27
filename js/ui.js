'use strict';
// The in-match HUD: the radial wheel, tile brackets and key prompts, the
// minimap, the backpack + gear widget, the hud strip and the card draft -
// everything renderUI() puts over the world while you play.
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
  const d = t.o && OBJECTS[t.o.type];
  const verb = !t.o ? 'CRACK ICE' : isStruct ? 'BREAK' : (d && d.verb) || 'MINE';
  // sit above the sprite: the entry's `lift` is 20 for the two that reach 8px above
  // their tile and 10 for the short ones. A building is drawn up from its footprint's
  // bottom edge and can be taller than its tiles, so clear its own sprite instead.
  const lift = isStruct ? structSprite(st).height - structH(st.type) * TILE + 12 :
    t.o ? ((d && d.lift) || 10) : 8;
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

// ------------------------------------------------------------ UI
function updateMinimap() {
  const d = mmImg.data;
  for (let i = 0; i < WORLD * WORLD; i++) {
    let r, g, b;
    const o = structOf(objects[i]); // resolves a multi-tile building's 'part' fillers to the anchor
    if (o) {
      const c = objMapColor(o, 'mm') || MM_UNKNOWN;
      r = c[0]; g = c[1]; b = c[2];
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
  // the downed eagles: both objectives, always on the disc - keeping yours
  // alive (and finding theirs) is the match
  if (state.drop) for (const e of state.drop.eagles) {
    if (e.state !== 'down') continue;
    const dx = (e.x / TILE - ptx) * s, dy = (e.y / TILE - pty) * s;
    if (Math.hypot(dx, dy) > MM_R - 2) continue;
    const gx = Math.round(MM_CX + dx), gy = Math.round(MM_CY + dy);
    ctx.fillStyle = '#0f1632';
    ctx.fillRect(gx - 3, gy - 1, 7, 3); ctx.fillRect(gx - 1, gy - 3, 3, 7);
    ctx.fillStyle = TEAMS[e.team].mark;
    ctx.fillRect(gx - 2, gy, 5, 1); ctx.fillRect(gx, gy - 2, 1, 5);
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
// the pointer is over HUD that owns its own clicks, not over the world
function overHud(x, y) {
  return !!bagHit(x, y) || gearHit(x, y) >= 0 || !!abHit(x, y) || overMinimap();
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

