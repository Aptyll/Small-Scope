// Softfall - a cozy winter survival game.
'use strict';

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
const PATCH_TXT = 'PATCH 1.68'; // printed bottom-right of the title screen; click it for the notes
// one sentence per patch, newest first - the biggest change only, in plain english
const PATCH_NOTES = [
  ['1.68', 'HOUSEKEEPING ONLY - THE HUD AND THE FOUR PANELS MOVED INTO FILES OF THEIR OWN, EVERY LINE UNCHANGED, AND NOTHING IN THE GAME CHANGED.'],
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
