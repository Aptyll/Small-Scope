'use strict';
// Softfall's base layer: tuning constants, the seeded rng, the state and
// settings singletons, and the small helpers with the most inbound edges.
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
// The worker flag: one order marker per player, and everything the workers
// reading it are allowed to do. See the `worker flags` banner.
const FLAG_BASE_R = 9;     // tiles: ground this close to an ENEMY building is a march order, not a path
const FLAG_HARVEST_R = 7;  // tiles a harvest flag spreads outward over once its own tile is cut
const FLAG_SIEGE_R = 14;   // tiles a siege flag rolls on to the next enemy building inside
const FLAG_PATH_W = 1;     // corridor half-width in tiles: 1 = a three-tile lane
const ROBOT_DMG = 5;       // one worker swing, against a unit or a building
const ROBOT_ATK_CD = 1.1;  // seconds between those swings
const ROBOT_REACH = 15;    // px from a worker's body to what its axe can reach
const ROBOT_AGGRO = 70;    // px a worker on any flag notices a foe inside
const ROBOT_LEASH = 90;    // px a worker on a *defensive* flag will leave its post to swing
const ROBOT_MAD = 6;       // seconds a struck worker stays angry at whoever hit it
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

// The roll as a weapon. A dash goes *through* anything small - rabbits,
// wolves, robots, other slots - swiping each of them once per roll and
// leaving them seeing stars; anything too big to go through (a deer, a tree,
// a rock, a building) is a tackle instead, which hurts and stuns both sides
// and ends the roll where it hit. Everything scales off the speed the roll is
// actually carrying, so a dash launched out of an ice slide lands far harder
// than one off a standing start - which is the whole reason to chain them.
const ROLL_HIT_R = 7;      // px of roll body, added to the target's own radius
const ROLL_FAST = 340;     // px/s the scaling tops out at (a dash off ice)
const ROLL_DMG = [5, 16];  // damage at the champion's own dodgeSpeed .. ROLL_FAST
const ROLL_STUN = [0.5, 1.1];    // s the victim is out for, over the same range
const TACKLE_STUN = [0.35, 0.8]; // ...and what a tackler gives themselves
const TACKLE_SELF = 0.55;  // share of a tackle's damage the roller eats
const TACKLE_MIN = 120;    // px/s driven into the blocked axis before a wall is a tackle, not a graze
const ROLL_KB = 90;        // px/s shove out of a roll hit

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
const ICE_HOLE_HITS = 2;   // pickaxe hits to break through
const HOLE_FALL_DMG = 15;  // falling into open water hurts
const HOLE_FALL_T = 1.1;   // seconds floundering before climbing back out
const FISH_CATCH_R = 16;   // bow-fishing: fish must be this close under the player
const FISH_MARGIN = 6;     // body clearance from snow: soft-steered away, hard-clamped
// The shoal is a live population, not a nightly reset: it is fished down by
// spears and nets and refilled by a trickle of new fish swimming in from
// under the snow - the deep water no hole ever reaches (see spawnEmerger).
const FISH_MAX = 30;       // cap: the boot shoal, and the ceiling the trickle fills to
const FISH_MIN = 10;       // floor: below it the trickle runs at FISH_SPAWN_FAST instead
const FISH_SPAWN_T = 11;   // seconds between new fish while the shoal is healthy
const FISH_SPAWN_FAST = 4; // ...and while it is under FISH_MIN
const FISH_EMERGE_SPD = 7; // px/s an unborn fish creeps out from under the shore
const FISH_EMERGE_MAX = 14; // seconds before an emerger that never found water is dropped
// fish nets: a building laid over an open hole that fishes it on its own
const NET_CAP = 3;         // fish a net holds before it stops catching
const NET_R = 9;           // px from the net's centre a fish is caught at
const NET_LURE = 44;       // ...and px it draws fish gently toward
const NET_CATCH_T = 2.2;   // seconds between catches, so a net fills visibly
const NET_TAKE_T = 0.3;    // seconds between fish handed to whoever stands on it

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
  // The fish net: the one building that goes on water instead of a stump.
  // `water: true` is the whole difference, and every site reads that flag
  // rather than the type name - it builds on an open hole (placeStruct),
  // never freezes over while it stands (the dawn refreeze), and is not solid
  // (isSolidTile), because walking onto it is how anyone - owner or not -
  // takes the catch out of it.
  net: { name: 'FISH NET', water: true, tiers: [
    { cost: { gold: 8 }, hp: 45, buildT: 5 },
  ]},
  // the team's Keep: a 2x2 singleton (see teamHasLivingKeep) that a downed
  // teammate respawns at (see updateRespawns) and that crafts roguelike
  // cards (see startCraft/updateStructures' keep branch) - "queue card" pays
  // craftCost and runs craftT, independent of the buildT/upgrade timer.
  // odds is the rarity table a completed craft rolls against (see CARDS).
  keep: { name: 'KEEP', w: 2, h: 2, tiers: [
    { cost: { gold: 60 },  hp: 260, buildT: 22, craftCost: 40, craftT: 20,
      odds: { white: .55, green: .28, blue: .13, purple: .035, gold: .005 } },
    { cost: { gold: 130 }, hp: 400, buildT: 13, craftCost: 40, craftT: 20,
      odds: { white: .35, green: .32, blue: .22, purple: .09,  gold: .02  } },
    { cost: { gold: 220 }, hp: 560, buildT: 13, craftCost: 40, craftT: 20,
      odds: { white: .18, green: .27, blue: .30, purple: .18,  gold: .07  } },
  ]},
};
const STRUCT_ORDER = ['wall', 'turret', 'generator', 'spawner', 'keep']; // stump wheel: 5 even wedges
const WATER_STRUCT_ORDER = ['net']; // open-hole wheel: one wedge, the whole circle

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
  // a win or an elimination freezes the numbers its end screen prints
  // (endSnapshot(), the victory banner); defeatT is the loss summary's own
  // clock, started when that view opens rather than when the slot went down
  end: null, defeatT: 0,
  msg: null, msgT: 0,
  hints: { stump: false, flag: false, hole: false },
  fishT: FISH_SPAWN_T, // countdown to the next fish swimming in (see updateFish)
  loc: null,     // the named place the local player is standing in: { L, t }
  paused: false,
  mapOpen: false,
  bagOpen: false,      // the backpack grid (B, or the bag bar): HUD, it does NOT stop the sim
  draft: null,         // the pick-1-of-3 card draft: { rarity, options: [id,id,id] } - HUD, does NOT stop the sim
  settingsOpen: false,
  wheel: null, // radial menu: { kind: 'build'|'manage', tx, ty, seg, ax, ay } - ax/ay is the press point
  // middle button HELD: the worker-flag preview is up and the release plants
  // it. Nothing about the flag is on screen unless this is true - see the
  // `worker flags` banner for why the preview is a gesture and not a mode.
  flagAim: false,
  // main menu (mode === 'title'): keyboard selection, per-item hover eases,
  // the open sub-panel ('settings' | 'help' | 'patch' | 'name' | null) and its slide progress
  menu: { sel: 0, hover: [0, 0, 0, 0, 0], t: 0, // one hover ease per MENU_ITEMS entry + the seed row
    panel: null, panelT: 0, closing: false, patchScroll: 0, // patchScroll: px the notes are scrolled
    // the PLAYER panel (the `player profile` banner): the name being typed,
    // whether this is the first-launch prompt (SKIP) or an edit (CANCEL),
    // the refusal rattle and the two planks' hover eases
    nameBuf: '', nameFirst: false, nameShake: 0, nameHover: [0, 0],
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

// volume is the master dial; musicVol and sfxVol sit under it (SFX.setVolume /
// setMusicVolume / setSfxVolume). A save written before the split simply has
// neither key and keeps the defaults - no version bump needed.
const settings = { v: 2, volume: 0.5, musicVol: 0.7, sfxVol: 1, mmR: 24, mmZoom: 5, shake: true, muted: false, info: false, pixelCursor: true, hitbox: 0 };
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

// Settings live UNDER the profile - PROFILE.putSettings / PROFILE.settings,
// js/profile.js, the one file in the game that touches storage. A pre-profile
// save under the old 'softfall.settings' key is folded in by PROFILE.load()
// before this ever runs, so the mmZoom migration below still sees it.
function saveSettings() { PROFILE.putSettings(settings); }
function loadSettings() {
  try {
    const s = PROFILE.settings(); // null when this profile has never saved any
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
  SET_MUTE_X = SL_X - 14;
  ROW_SOUND = SET_Y + 28; ROW_MUSIC = SET_Y + 42; ROW_SFX = SET_Y + 56; ROW_MAP = SET_Y + 70;
  ROW_SHAKE = SET_Y + 84; ROW_INFO = SET_Y + 98; ROW_CURSOR = SET_Y + 112;
  fitFlakes();
  renderBars();
  layoutReplay();
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
  if (bagCount(p, 'berry') <= 0 || p.hp >= p.maxHp) return;
  bagTake(p, 'berry', 1);
  const heal = Math.round(20 * kitOf(p).foodMul); // HEARTHWEAVE makes meals bigger
  p.hp = Math.min(p.maxHp, p.hp + heal);
  if (nearPlayer(p.x, p.y)) { SFX.eat(); setTimeout(() => SFX.heal(), 90); }
  addFloater(p.x, p.y - 14, '+' + heal, '#8fe08a');
  burst(p.x, p.y - 8, '#f2707a', 6, 30, 0.4);
}

function eatFish(p) {
  if (bagCount(p, 'fish') <= 0 || p.hp >= p.maxHp) return;
  bagTake(p, 'fish', 1);
  const heal = Math.round(50 * kitOf(p).foodMul);
  p.hp = Math.min(p.maxHp, p.hp + heal);
  if (nearPlayer(p.x, p.y)) { SFX.eat(); setTimeout(() => SFX.heal(), 90); }
  addFloater(p.x, p.y - 14, '+' + heal, '#8fe08a');
  burst(p.x, p.y - 8, '#7ac0e8', 6, 30, 0.4);
}

