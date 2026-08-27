'use strict';
// The local human's controller: keyboard + mouse listeners writing the same
// input struct an AI fills, sampled once per sim step by sampleHumanInput().
// ------------------------------------------------------------ input
const keys = {};
const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false, inside: false }; // inside: pointer over the canvas

window.addEventListener('keydown', (e) => {
  // Tab is held to read the scoreboard (scoreboardOpen()), so it must never
  // reach the browser's focus traversal
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab', 'F3'].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  // the name editor owns the keyboard while it is up: its letters are text,
  // not shortcuts, and F3 / '.' below would fire on keys the field ignores
  if (state.mode === 'title' && state.menu.panel === 'name') { nameKey(e); return; }
  // F3 flips the info stack in any mode, minecraft-style (the browser's own
  // F3 find bar is suppressed above)
  if (e.key === 'F3') { settings.info = !settings.info; saveSettings(); return; }
  // '.' toggles the debug overlay (off / bodies + routes) in any mode, beside
  // F3 and for the same reason: what it draws is as true of the title
  // screen's living world and of a spectated match as it is of your own feet
  if (e.key === '.') { settings.hitbox = settings.hitbox ? 0 : 2; saveSettings(); return; }
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
  // B opens the backpack grid. It is HUD and not an overlay, so unlike M and
  // ESC it neither stops the sim nor swallows anything but its own clicks.
  if (e.key.toLowerCase() === 'b') state.bagOpen = !state.bagOpen;
  // 1-4 buy the next level of that gear piece, left to right like the HUD row
  // (sampleHumanInput zeroes cmd while an overlay is up, so no guard needed)
  if (e.key >= '1' && e.key <= '4') player.input.cmd = { kind: 'gear', piece: e.key.charCodeAt(0) - 49 };
  if (e.key.toLowerCase() === 'm' && !state.settingsOpen && !state.draft) { state.wheel = null; state.mapOpen = !state.mapOpen; }
  if (e.key.toLowerCase() === 'escape') {
    // the flag aim goes first: it is the most transient thing on screen, and
    // dropping it here is what lets a held middle button be thought better of
    if (state.flagAim) state.flagAim = false;
    else if (state.wheel) state.wheel = null;
    else if (state.draft) state.draft = null; // closes without picking
    else if (state.mapOpen) state.mapOpen = false;
    else { state.settingsOpen = !state.settingsOpen; dragSlider = null; state.wheel = null; }
  }
  if (e.key.toLowerCase() === 'n') { settings.muted = SFX.toggleMute(); saveSettings(); }
  if (e.key.toLowerCase() === 'p') state.paused = !state.paused;
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
// a key - or the middle button - held while the window loses focus never sends
// its keyup/mouseup: alt-tabbing out would otherwise leave the scoreboard (or
// a walk direction, or the flag preview) stuck on
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; state.flagAim = false; });

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
    if (state.mode !== 'play' || state.mapOpen || state.settingsOpen || state.wheel || state.draft) return;
    if (bagHit(mouse.x, mouse.y) || gearHit(mouse.x, mouse.y) >= 0 || abHit(mouse.x, mouse.y)) return; // no build wheel through the HUD
    SFX.unlock();
    const tx = Math.floor(mouseWX() / TILE), ty = Math.floor(mouseWY() / TILE);
    const o = structOf(objAt(tx, ty));
    const site = buildSiteAt(tx, ty); // a stump, or an open hole to net over
    if (!o && !site) return;
    if (Math.hypot(tx * TILE + 8 - player.x, ty * TILE + 8 - player.y) > 60) { SFX.deny(); return; }
    // ax/ay: the press point every later pointer move is measured against
    if (site) state.wheel = { kind: 'build', tx, ty, seg: -1, ax: mouse.x, ay: mouse.y };
    else if (STRUCTS[o.type] && !o.building && o.team === player.team) state.wheel = { kind: 'manage', tx, ty, seg: -1, ax: mouse.x, ay: mouse.y };
    else if (STRUCTS[o.type]) SFX.deny(); // someone else's building
    return;
  }
  if (e.button === 1) {
    // The worker flag is press-and-HOLD, the build wheel's grammar one button
    // over: the press raises the preview, the release plants where it landed.
    // Nothing about the flag is drawn until this press, which is the whole
    // point - a preview for an order you have not started is clutter.
    // Middle click is also the browser's autoscroll, which only a
    // preventDefault on the PRESS suppresses.
    e.preventDefault();
    if (state.mode !== 'play' || state.settingsOpen || state.wheel || state.draft) return;
    if (!hasWorkers(player)) return;                       // nobody to order: the button is dead
    if (!state.mapOpen && overHud(mouse.x, mouse.y)) return; // the HUD swallows its own presses
    SFX.unlock();
    state.flagAim = true;
    return;
  }
  if (e.button !== 0) return;
  if (state.mode === 'title') { menuClick(); return; }
  if (state.mode === 'drop') { SFX.unlock(); dropJump(player); return; }
  if (state.mode === 'dead') { SFX.unlock(); deadClick(); return; }
  if (state.mode !== 'play') return;
  if (state.wheel) { state.wheel = null; return; } // left-click while it is open: cancel
  if (state.draft) { SFX.unlock(); draftClick(); return; } // a card, or anywhere else: closes either way
  if (state.settingsOpen) { mouse.down = true; settingsMouseDown(); return; }
  if (state.mapOpen) return;
  // the backpack widget and the hud strip swallow every click over themselves
  // before the bow ever sees them. Gear is asked first because gearHit owns
  // those four cells and bagHit does not report them; a piece that can't sell
  // just denies. The strip's upgrade squares (and their wells, while a point
  // is free) spend a skill point the same way.
  const gi = gearHit(mouse.x, mouse.y);
  if (gi >= 0) { SFX.unlock(); player.input.cmd = { kind: 'gear', piece: gi }; return; }
  const bh = bagHit(mouse.x, mouse.y);
  if (bh) { SFX.unlock(); bagClick(bh); return; }
  const ah = abHit(mouse.x, mouse.y);
  if (ah) {
    SFX.unlock();
    if ((ah.kind === 'up' || ah.kind === 'slot') && abCanBuy(player, ah.i))
      player.input.cmd = { kind: 'skill', i: ah.i };
    return;
  }
  mouse.down = true;
  clickAction(player);
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2 && state.wheel) { resolveWheel(); state.wheel = null; return; }
  if (e.button === 1) {
    // the release is the order. Escape (or losing focus) drops flagAim first,
    // which is what makes this cancellable without a hub to release into
    if (!state.flagAim) return;
    state.flagAim = false;
    if (state.mode !== 'play' || state.settingsOpen || state.wheel || state.draft) return;
    if (state.mapOpen) {
      // the chart commands too: it is the only way to flag a tile off-screen
      const mt = mapTileAt(mouse.x, mouse.y);
      if (mt) plantFlag(player, mt.tx, mt.ty); else SFX.deny();
      return;
    }
    if (overHud(mouse.x, mouse.y)) return; // dragged onto the HUD to think better of it
    plantFlag(player, Math.floor(mouseWX() / TILE), Math.floor(mouseWY() / TILE));
    return;
  }
  // releasing the button just drops the held intent; updatePlayer looses the
  // arrow on that falling edge, the same way an AI's shot is timed
  if (e.button === 0) player.input.fire = false;
  // letting go of a dial: the two sound tracks answer with a real sampled cue
  // at the level just set, so the slider demonstrates itself instead of
  // labelling itself - and a dead sample layer is audible the moment you drag
  if (dragSlider) { saveSettings(); if (dragSlider === 'sfx' || dragSlider === 'vol') SFX.coin(); else SFX.pickup(); }
  mouse.down = false;
  dragSlider = null;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// middle click plants the flag; nothing about it should reach the page
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
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

