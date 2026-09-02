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
  if (state.mode === 'drop') {
    // M raises the world map mid-flight, Esc puts it away; the map does not
    // stop the sim, so the jump keys stay live under it. The lock inside
    // dropJump refuses (and denies) a jump before the window - the repeat
    // guard keeps a held Space from machine-gunning that deny.
    if (e.key.toLowerCase() === 'm') { state.mapOpen = !state.mapOpen; return; }
    if (e.key.toLowerCase() === 'escape') { state.mapOpen = false; return; }
    if ((e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'e') && !e.repeat) dropJump(player);
    return;
  }
  if (state.mode === 'dead') { deadKey(e.key.toLowerCase()); return; }
  if (state.mode !== 'play') return;
  // edge-triggered intents go into the local player's input struct; the sim
  // reads and clears them, exactly as it does for an AI slot
  if (e.key === ' ') player.input.dodge = true;
  if (e.key.toLowerCase() === 'q') player.input.eatBerry = true;
  if (e.key.toLowerCase() === 'f') player.input.eatFish = true;
  // E at the practice rack: the press opens the armory wheel over it, the
  // pointer picks, and RELEASING E takes - the right-click wheel's own
  // hold-and-release grammar, moved onto the key. A real work target in reach
  // keeps E's day job (the same rule that decides which prompt is showing),
  // and ordinary work is suppressed while any wheel is up (sampleHumanInput).
  if (e.key.toLowerCase() === 'e' && !e.repeat && !state.wheel && !state.mapOpen &&
      !state.settingsOpen && !state.draft && !state.drag && !player.dead) {
    const t = workTarget(player);
    if (!t || !t.near) {
      const rk = rackNear(player);
      if (rk) { SFX.unlock(); state.wheel = { kind: 'rack', tx: rk.tx, ty: rk.ty, seg: -1, ax: mouse.x, ay: mouse.y }; }
      else {
        // the parkour die: holding E beside it opens the roll wheel - ROLL
        // plus the three difficulties - on the rack wheel's own grammar
        const pk = pkDieNear(player);
        if (pk) { SFX.unlock(); state.wheel = { kind: 'pkdie', tx: pk.tx, ty: pk.ty, seg: -1, ax: mouse.x, ay: mouse.y }; }
        else {
          // the range bell: holding E beside it opens the difficulty wheel -
          // easy, medium, hard - and releasing on a wedge rings the round in
          // at that difficulty (the roll die's own grammar). Only while the
          // range is idle: mid-round the bell is under the snow with the
          // rest of the furniture, and the sink and rise are mid-ceremony.
          const bl = agBellNear(player);
          if (bl && agame.phase === 'off') { SFX.unlock(); state.wheel = { kind: 'agbell', tx: bl.tx, ty: bl.ty, seg: -1, ax: mouse.x, ay: mouse.y }; }
        }
      }
    }
  }
  // B opens the backpack grid. It is HUD and not an overlay, so unlike M and
  // ESC it neither stops the sim nor swallows anything but its own clicks.
  if (e.key.toLowerCase() === 'b') state.bagOpen = !state.bagOpen;
  // G raises the character panel - the body, the live stat ledger and the
  // four gear pieces. HUD like the bag: the sim runs on underneath.
  if (e.key.toLowerCase() === 'g' && !state.settingsOpen && !state.draft) state.charOpen = !state.charOpen;
  // 1-4 cast the class abilities, left to right exactly as the strip shows
  // them (a click on the well sets the same field - hudPress, js/ui.js).
  // Edge-triggered like the dodge; the sim consumes it (tryAbility,
  // js/abilities.js). The bit column rises on HOVER over the weapon well.
  if (e.key >= '1' && e.key <= '4' && !e.repeat) { SFX.unlock(); player.input.ability = e.key.charCodeAt(0) - 49; }
  if (e.key.toLowerCase() === 'm' && !state.settingsOpen && !state.draft && !state.dropBrief) { state.wheel = null; state.mapOpen = !state.mapOpen; }
  if (e.key.toLowerCase() === 'escape') {
    // a carried item goes back first, then the flag aim: both are gestures
    // half-finished, and Escape is how either is thought better of
    if (state.drag) { dragReturn(); state.dragPend = null; }
    else if (state.flagAim) state.flagAim = false;
    else if (state.wheel) state.wheel = null;
    else if (state.draft) state.draft = null; // closes without picking
    else if (state.mapOpen) state.mapOpen = false;
    else if (state.charOpen) state.charOpen = false;
    else { state.settingsOpen = !state.settingsOpen; dragSlider = null; state.wheel = null; }
  }
  if (e.key.toLowerCase() === 'n') { settings.muted = SFX.toggleMute(); saveSettings(); }
  if (e.key.toLowerCase() === 'p') state.paused = !state.paused;
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
  // letting go of E with an E-held wheel up (armory, roll die or range
  // bell) takes what the pointer is on (or cancels from the hub), exactly
  // as releasing the right button does
  if (e.key.toLowerCase() === 'e' && state.wheel &&
      (state.wheel.kind === 'rack' || state.wheel.kind === 'pkdie' || state.wheel.kind === 'agbell')) {
    resolveWheel();
    state.wheel = null;
  }
});
// a key - or the middle button - held while the window loses focus never sends
// its keyup/mouseup: alt-tabbing out would otherwise leave the scoreboard (or
// a walk direction, or the flag preview) stuck on
// - and an item on the cursor goes back where it came from rather than
// hanging there over a game that has stopped listening
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  state.flagAim = false;
  state.dragPend = null;
  if (state.drag) dragReturn();
  // an E-held wheel (armory, roll die or range bell) is a held gesture too:
  // its keyup is lost with the focus, so it closes (choosing nothing)
  // instead of sticking open
  if (state.wheel && (state.wheel.kind === 'rack' || state.wheel.kind === 'pkdie' || state.wheel.kind === 'agbell')) state.wheel = null;
});

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) / scale;
  mouse.y = (e.clientY - r.top) / scale;
  mouse.inside = true;
  state.menu.moved = true; // the menu only lets the mouse steal the selection when it actually moves
  // a press on a bag/slot/bit cell only becomes a DRAG once it travels: that
  // is what lets one gesture both use an item and move it (see hudMove, ui.js)
  if (state.dragPend) hudMove(mouse.x, mouse.y);
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
    if (bagHit(mouse.x, mouse.y) || gearHit(mouse.x, mouse.y) >= 0 || stripHit(mouse.x, mouse.y) ||
        bitColHit(mouse.x, mouse.y) >= 0) return; // no build wheel through the HUD
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
  if (state.mode === 'drop') { SFX.unlock(); if (!state.mapOpen) dropJump(player); return; }
  if (state.mode === 'dead') { SFX.unlock(); deadClick(); return; }
  if (state.mode !== 'play') return;
  if (state.wheel) { state.wheel = null; return; } // left-click while it is open: cancel
  if (state.draft) { SFX.unlock(); draftClick(); return; } // a card, or anywhere else: closes either way
  if (state.settingsOpen) { mouse.down = true; settingsMouseDown(); return; }
  if (state.mapOpen) return;
  // The backpack widget, the weapon slots and an open bit column swallow every
  // press over themselves before the tool ever sees them. The character panel
  // is asked first while it is up - a press on a gear well buys, the X
  // closes, and the slab eats the rest. Everything else goes through
  // hudPress, which arms a drag the mouseup below either completes or reads
  // as a click.
  if (state.charOpen && charClick(charHit(mouse.x, mouse.y))) return;
  if (hudPress(mouse.x, mouse.y)) { SFX.unlock(); return; }
  // pressing on the world while carrying something: the release throws it,
  // and nothing is fired
  if (state.drag) return;
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
  // a carried item is put down (or thrown), and an armed press that never
  // travelled resolves as the plain click it was - both before the tool's own
  // release, so a drag never also looses a shot
  if (e.button === 0 && state.mode === 'play' && (state.drag || state.dragPend)) {
    hudRelease(mouse.x, mouse.y);
    player.input.fire = false;
    mouse.down = false;
    dragSlider = null;
    return;
  }
  // releasing the button just drops the held intent; updatePlayer fires the
  // tool on that falling edge, the same way an AI's shot is timed
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
    else if (state.menu.panel === 'settings') { e.preventDefault(); settingsScrollBy(e.deltaY > 0 ? 14 : -14); }
    return;
  }
  if (state.mode !== 'play') return;
  e.preventDefault();
  // over the open ESC panel the wheel walks the open settings page
  if (state.settingsOpen) { settingsScrollBy(e.deltaY > 0 ? 14 : -14); return; }
  if (state.mapOpen || state.wheel) return;
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
    inp.grapple = !!keys['3']; // a reel in progress keeps answering the held key
    inp.fire = inp.work = false;
    inp.eatBerry = inp.eatFish = false;
    inp.ability = -1;
    inp.cmd = null;
    if (p.charging) { p.charging = false; p.chargeT = 0; }
    p.firePrev = false;
    p.fireArmed = false;
    return;
  }
  // state.eagleCine / state.dropBrief: a ceremony has the camera - hands off
  // the controls until it hands back, exactly as pause zeroes them
  if (state.mode !== 'play' || state.paused || state.settingsOpen || state.eagleCine || state.dropBrief) {
    inp.mx = inp.my = 0;
    inp.fire = inp.work = inp.slide = inp.grapple = false;
    inp.dodge = inp.eatBerry = inp.eatFish = false;
    inp.ability = -1;
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
  // the grapple reels only while its own key is held - the one HELD ability
  // input, read by updatePlayer's grapple branch; releasing it lets go early
  inp.grapple = !!keys['3'];
  inp.work = !!keys['e'] && !state.wheel;
  if (state.wheel) { inp.fire = false; inp.dodge = false; inp.ability = -1; } // the wheel swallows the shot
}

