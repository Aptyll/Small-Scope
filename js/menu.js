'use strict';
// The title screen: the frost-plank menu over the living world, the reroll
// die, the tutorial and patch-notes panels, champion select and the gear
// screen, and the intro that hands the locked-in champion to the eagle.
// ------------------------------------------------------------ main menu
// The title screen is a real menu over the living world: the camera drifts
// around the interior while animals, fish and snow keep running, the items
// (SINGLEPLAYER / MULTIPLAYER / PRACTICE TOOL / SETTINGS / the reroll die) take
// mouse or arrows+enter, and every mode change is a transition rather than a cut.
const INTRO_T = 1.6;    // title -> play: tint dissolves, camera settles, HUD slides in
const HUD_IN_T = 0.7;   // the HUD slide occupies the last part of the intro
const PANEL_SLIDE_T = 0.32;
const MENU_ITEMS = ['SINGLEPLAYER', 'MULTIPLAYER', 'PRACTICE TOOL', 'SETTINGS'];
// sealed under ice until they exist: inert to hover, keys and clicks. 1 and 2
// are MULTIPLAYER and PRACTICE TOOL - SINGLEPLAYER leads, the sealed pair sits
// as a quiet coming-soon block, SETTINGS is the live utility at the foot.
function menuFrozen(i) { return i === 1 || i === 2; }
const MENU_BW = 132, MENU_BH = 24, MENU_PITCH = 32;
const MENU_Y0 = 92;    // first plank, in the 270-tall authored frame; the seed row follows the last plank
const MENU_SLAB_PAD = 22; // slab hangs this many px past each side of the planks
const PATCH_TXT = 'PATCH 1.84'; // printed bottom-right of the title screen; click it for the notes
// one sentence per patch, newest first - the biggest change only, in plain english
const PATCH_NOTES = [
  ['1.84', 'A LOSS PLAYS ITS OWN SONG NOW - SLEEPY GAME SAVE, NOT THE VICTORY TRACK.'],
  ['1.83', 'THE PLAYER PANEL COUNTS WINS AND DAYS PLAYED NOW - A MATCH YOU WERE STANDING FOR AT THE END IS A WIN, AND EACH DAY YOU SET FOOT IN IS KEPT, NOT MATCHES STARTED AND A BEST DAY.'],
  ['1.82', 'THE PLAYER PANEL SAYS WHAT ITS NUMBERS MEAN - MATCHES, GOLD EARNED AND BEST DAY EACH GET A LABEL, A DOTTED LEADER AND A COMMA IN THE BIG TOTALS.'],
  ['1.81', 'GOLD PAYS ITSELF NOW - CHOPS, KILLS AND GENERATORS GO STRAIGHT INTO THE PURSE WITH THE +N POPUP AT THE SPOT, AND TREASURE CHESTS HIDE ALONG THE TREELINE WITH FREE GOLD AND A CARD INSIDE.'],
  ['1.80', 'THE EAGLE RIDE IS A TIGHT TEN SECONDS WITH A GOLD JUMP WINDOW OVER ITS LAST STRETCH - THE PATH IS DOTTED ACROSS THE SNOW, M RAISES THE MAP MID-FLIGHT, NOBODY IS DROPPED IN THE TREES, AND A FIRST FLIGHT COUNTS YOU DOWN AND JUMPS FOR YOU.'],
  ['1.79', 'A ROOSTING EAGLE IDLES NOW - EVERY FEW SECONDS IT SHUFFLES ITS WINGS AND SHAKES A LITTLE SNOW LOOSE BETWEEN BREATHS.'],
  ['1.78', 'THE DRIVEN-OFF CEREMONY - WHEN AN EAGLE BREAKS, EVERY CAMERA PANS OVER TO WATCH IT FLY AWAY, AND ONLY THEN DO THE VICTORY AND DEFEAT SCREENS RISE.'],
  ['1.77', 'THE EAGLE FIGHTS BACK AND IS DRIVEN OFF, NOT KILLED - A WING GUST THROWS ANYONE CROWDING IT, IT CALMS BACK DOWN BETWEEN SCARES, AND AT ZERO NERVE IT FLIES AWAY AND TAKES ITS TEAM WITH IT.'],
  ['1.76', 'ARROWS NOW DAMAGE A ROOSTING EAGLE ANYWHERE ON ITS HITBOX - THE CORNERS OF THE ROOST USED TO SWALLOW THE SHOT WITHOUT A SCRATCH.'],
  ['1.75', 'A ROOSTING EAGLE NO LONGER CASTS A SHADOW - THE BIRD IS ON THE GROUND, AND THE DARK COPY UNDER IT READ AS A SECOND BIRD.'],
  ['1.74', 'THE EAGLES ARE BIGGER, CARRY THEIR WHOLE TEAM ON THEIR WINGS, AND ROOST SOLID AFTER THE DIVE - HEALTH BAR UP, STRIKEABLE WITH ARROWS OR E.'],
  ['1.73', 'RED VERSUS BLUE, FIVE A SIDE - EACH TEAM RIDES ITS OWN ARMOURED EAGLE, WHICH DIVES INTO THE TREELINE AT THE END OF ITS LINE AND MUST BE KEPT ALIVE.'],
  ['1.72', 'HOUSEKEEPING ONLY - THE WORKER BOTS AND THEIR FLAG MOVED INTO A FILE OF THEIR OWN, AND NO FILE THAT DECIDES ANYTHING DRAWS ANYTHING ANY MORE.'],
  ['1.71', 'HOUSEKEEPING ONLY - THE TUNING NUMBERS FOR EACH FEATURE NOW SIT BESIDE THE CODE THAT READS THEM, AND ONE TABLE SAYS WHAT EVERY TREE, ROCK AND BUSH IS.'],
  ['1.70', 'HOUSEKEEPING ONLY - THE SPLIT IS FINISHED: EIGHTEEN FILES, THE LAST ONE RENAMED TO BOOT.JS, THE PLAYBOOK RETIRED, AND NOTHING IN THE GAME CHANGED.'],
  ['1.69', 'HOUSEKEEPING ONLY - THE TITLE SCREEN AND EVERY ENDING MOVED INTO FILES OF THEIR OWN, EVERY LINE UNCHANGED, AND NOTHING IN THE GAME CHANGED.'],
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
  const start = n;
  while (menuFrozen(n)) { // sealed planks refuse the selection; skip the whole iced block
    n = (((n + dir) % N) + N) % N;
    if (n === start) return;
  }
  if (n === m.sel) return;
  m.sel = n;
  SFX.pickup();
}

// knocking on a frozen plank: it shudders, cracks flash from the struck
// point and heal as it refreezes, and a spray of ice chips falls away
function iceRefuse(i) {
  const m = state.menu;
  if (m.iceT > 0.3) return; // still mid-shudder
  const { rects } = menuLayout();
  const r = rects[i];
  m.iceT = 0.45;
  m.iceI = i;
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
  if (menuFrozen(i)) return; // solid ice - iceRefuse() is the only answer
  SFX.unlock();
  if (i === 0) beginSelect();
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
  if (menuFrozen(h)) { iceRefuse(h); return; }
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
    if (h >= 0 && !menuFrozen(h) && h !== m.sel) m.sel = h;
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
  // a frozen plank can't be selected, so its hover ease tracks the pointer instead
  const hit = !m.panel && m.screen === 'menu' ? menuHit() : -1;
  for (let i = 0; i <= MENU_ITEMS.length; i++) {
    const target = menuFrozen(i) ? (hit === i ? 1 : 0) : (m.sel === i ? 1 : 0);
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
    if (m.iceT > 0 && m.iceI === r.i) {
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
// the menu column, a frosted slab that gathers the items into one column, a
// gold rule with diamond finials under the logo, and embers drifting up off
// the logo and the flames. All of it is procedural - hash2() for the static
// grain, now for the flicker - and every piece takes its alpha from the
// caller so it fades with the chrome.
const TITLE_PILLAR_DX = 118; // pillar centres either side of the (wider) menu column
const TITLE_PILLAR_W = 16;   // shaft width; sits just outside the slab so the frame scales with the planks

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
// flickers in place - the bowl and the embers are the whole tell, no halo
function drawPillar(cx, top, bot, now, a) {
  const w = TITLE_PILLAR_W, x = cx - (w >> 1), shaftTop = top + 7, shaftH = bot - shaftTop - 4;
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
    const slabW = MENU_BW + MENU_SLAB_PAD * 2;
    drawMenuSlab(cx - (slabW >> 1), rects[0].y - 14 + Math.round(out * 25), slabW, last.y + last.h + 8 - rects[0].y + 14, slabIn * chromeA);
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
    const rr = { x: r.x - Math.round((1 - inT) * 60), y: r.y + Math.round(out * 25), w: r.w, h: r.h, i };
    // the refusal shudder rattles the struck frozen plank in place (x only, so its hashed rime holds still)
    if (menuFrozen(i) && m.iceI === i && m.iceT > 0) rr.x += Math.round(Math.sin(now * 85) * 2.2 * (m.iceT / 0.45));
    const hv = m.hover[i];
    const pressed = m.sel === i && (m.pressT > 0 || (mouse.down && menuHit() === i));
    if (r.seed) {
      const lift = Math.round(hv * 2);
      const tx = rr.x + 3, ty = rr.y + 3 - lift;
      drawPixelTextShadow(ctx, SEED_TXT, tx, ty, hv > 0.5 ? '#ffd95c' : '#9fb6d8', 'rgba(15,22,50,0.9)');
      drawDie(tx + pixelTextWidth(SEED_TXT) + 6, rr.y - lift, hv, now);
    } else {
      drawMenuButton(rr, MENU_ITEMS[i], hv, now, pressed, menuFrozen(i));
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

  // footer: the two corner tags ride the same fade; no gold rule under them
  const fin = easeOut((m.t - 0.9) / 0.5) * (1 - out) * (1 - pan);
  if (fin > 0.005) {
    ctx.globalAlpha = fin;
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

