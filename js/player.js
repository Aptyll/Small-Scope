'use strict';
// Every combatant in the match: the numbers a slot is made of, the Player
// class and its slots, the two playable classes and their kits, gear, cards,
// the input struct, contested orders, the entity arrays - and the damage &
// death lifecycle those slots live and die by.
// ------------------------------------------------------------ players
// Every slot in the match is a Player. They all carry identical state and are
// all driven from the same `input` struct, so a feature written for "the
// player" is a feature every slot has: the local human (slot 0), the AI fills,
// and eventually a network peer are only different in who fills that struct.
// Sim code takes a `p` argument; `player` (the local slot) is for the camera,
// HUD, cursor and audio only.
const TEAMS = SPRITES.teams; // the 2 colour presets (RED, BLUE), baked into the sprites
// Which PRESET a team wears on this screen. With settings.teamBlue (the
// default) the local slot's side is always the BLUE one and the rival side
// always RED, whatever team index the roster dealt - so allies read blue and
// enemies red from the first match to the last, and a future second human
// sees the mirror. The match itself never asks this: team indices, enemyOf,
// PVP and every rule read p.team; only the PAINT goes through here - every
// TEAMS[...] lookup, the per-team sprite sets (champ, eagleTeam, teamBuild,
// robotTeam, merchant) and the two maps' eagle colours. Bot names are
// computed from it live (Player.name), so RED-3 turns BLUE-3 with the toggle.
function skin(team) { return settings.teamBlue && player && player.team === 0 ? 1 - team : team; }

// Player slots. Every combatant in the match - the local human, the AI fills,
// and (later) network peers - is a Player in `players`, so anything written
// for "the player" is automatically something every slot can do. Only the
// camera, HUD and cursor address one specific slot (`player`, the local one).
const MAX_PLAYER_SLOTS = 10; // five a side
const TEAM_COUNT = 2;      // RED vs BLUE; slots alternate (slot % TEAM_COUNT)
const PVP = true;          // arrows hit players on another team (friendly fire is off)
const PLAYER_SPEED = 72;
const PLAYER_R = 4.5;

// momentum (player-only): input accelerates vx/vy, the surface underfoot sets
// friction and speed caps. Walking on snow is tuned to feel like the old fixed
// PLAYER_SPEED; everything faster than that is earned via ice, dodges, or sliding.
const ICE_MAX = 150;      // ice speed cap (~2x walk); holding a direction pumps toward it
const SLIDE_MIN = 85;     // shift-slide only engages above this speed...
const SLIDE_EXIT = 55;    // ...and drops out below this one (hysteresis)
const TRAIL_MIN = 110;    // sliding faster than this carves the snow trail
const SNOW_TRAIL_LIFE = 3.5; // snow groove lifetime (ice scratches keep the 9s footprint life)
const SNOW_TRAIL_FADE = 1.4; // fade window at the end of that life: hold crisp, then wipe tail-first

// Hero levels (League-style, max 12). XP is lifetime gold earned (gainGold), never spent
// or lost on death; LEVEL_XP[n-1] is the total needed to reach level n, the gap growing
// by 20 a level. Sized against what a bot chaining pines all match earns (about a gold
// a second on the fells, plus the clock's 15 a minute - TRICKLE_*, js/sim.js): that
// bot is level 9 or 10 at fifteen minutes and capped past twenty, a player who fights
// and farms by halves is two or three levels behind it, and the trickle alone is level
// 3 by seven minutes - a level is news all match, not a sprint over by 2:00. Each
// level past the first is the same flat growth: +LVL_HP max hp (healed on the spot)
// and +LVL_DMG on every arrow, applied on top of the class kit - a level-8 hero of
// this table is about the capped hero of the old one.
const LEVEL_MAX = 12;
const LEVEL_XP = [0, 40, 100, 180, 280, 400, 540, 700, 880, 1080, 1300, 1540];
const LVL_HP = 9;
const LVL_DMG = 2;

// The dodge roll as an ability: how long it lasts, how hard it throws you,
// and how many charges refill how fast. What a roll HITS on the way through
// is the ROLL_/TACKLE_ block in js/actions.js.
const DODGE_T = 0.28;     // roll duration (s)
const DODGE_SPEED = 215;  // roll velocity -> ~60px travelled
const DODGE_CHARGES = 2;
const DODGE_CD = 3.5;     // seconds to refill one charge

// The two bow numbers a class kit is expressed against - CLASSES below
// reads both at load time, which is why they sit here and the rest of the
// bow (the draw curve and the cycle: js/tools.js; the trail: js/actions.js).
const BOW_CHARGE = 0.9;   // seconds to a full draw
const BOW_NOCK = 0.45;    // WREN's seconds between loosing and the next draw

// ---- classes ------------------------------------------------------------
// Every slot plays one of these. A class is a look (SPRITES.champ[c] - the
// sprite key keeps its legacy name; js/sprites.js is never rewritten) plus a
// kit - the numbers updatePlayer / emitBit / tryDodge read through kitOf(p)
// instead of the bare constants - plus its four ACTIVE ABILITIES on keys 1-4
// (CLASS_AB, js/abilities.js). Picked on the class select screen (local) or
// hashed from the seed (AI slots) in initPlayers().
const CLASSES = [
  {
    name: 'HUNTER', role: 'BOW, TRAPS, DISTANCE',
    blurb: ['THE BOW IS THE ARGUMENT: KEEP THE GAP.', 'TRAPS, NETS AND A FALCON CONTROL THE GROUND.', 'CALL A VOLLEY ON ANYONE WHO STANDS STILL.'],
    stats: { ice: 3, draw: 4, power: 4, tough: 2 },
    kit: { iceMax: 1, iceSteer: 2.8, slideMin: SLIDE_MIN, fatigue: 1, chargeMul: 0.55,
      bowCharge: BOW_CHARGE, nock: 0.4, dmgBase: 4, dmgPow: 9, spdDmg: 0, dodgeSpeed: DODGE_SPEED, maxHp: 92 },
  },
  {
    name: 'WARRIOR', role: 'PRESSURE, BLOCKING, MOMENTUM',
    blurb: ['THE FIGHT IS AT ARM\'S LENGTH: GET THERE.', 'THE SHIELD EATS ARROWS; THE RUSH CARRIES BODIES.', 'SPEED IS DAMAGE - NOTHING STOPS A JUGGERNAUT.'],
    stats: { ice: 4, draw: 2, power: 3, tough: 5 },
    kit: { iceMax: 1.15, iceSteer: 3.2, slideMin: 70, fatigue: 0.7, chargeMul: 0.7,
      bowCharge: 0.75, nock: 0.5, dmgBase: 3, dmgPow: 6, spdDmg: 5, dodgeSpeed: 230, maxHp: 120 },
  },
];
// the kit every sim site reads: the class's numbers with the slot's gear
// folded in. refreshKit() rebuilds the cache whenever class or gear
// changes; kitOf() itself is called many times a frame and must stay a read.
function kitOf(p) { return p.kit || CLASSES[p.cls].kit; }
// swap a slot's class: kit hp applies on the spot (full heal, it's a
// pre-match choice), and the new class brings its own tool and bits - the
// loadout is part of who you picked, not a thing carried across (js/tools.js)
function setClass(p, c) { p.cls = c; refreshKit(p); p.hp = p.maxHp; giveLoadout(p); }
// kit hp plus the flat per-level growth
function levelMaxHp(p) { return kitOf(p).maxHp + LVL_HP * (p.level - 1); }
// the one way gold enters a wallet: pays the purse and the same amount of XP
function gainGold(p, n) {
  p.inv.gold += n;
  p.xp += n;
  // lifetime total, coalesced - see profile.js. Practice gold is play money:
  // a free room with chests in it must never farm the tech tree's points.
  if (p === player && !PRACTICE) PROFILE.addGold(n);
  while (p.level < LEVEL_MAX && p.xp >= LEVEL_XP[p.level]) levelUp(p);
}
// The merchant's till, and the ONE way gold reaches a wallet without XP
// behind it (CLAUDE.md names it as the exception to the gainGold rule). A
// SALE is an exchange, not a source: the counter buys fish and berries at the
// same price it sells them, so paying levels for one would turn two clicks
// into a level farm rather than into a trade. Everything that EARNS gold -
// a fell, a kill, a chest, the clock - still goes through gainGold.
function tradeGold(p, n) { if (p && n > 0) p.inv.gold += n; }
// Gold is never a physical drop: every source pays the earner on the spot
// through this one wrapper - the wallet (via gainGold, so it levels too), the
// '+N' popup at the place the action happened, and the coin blip for the
// local earner. (x, y) is the tree, the kill, the wreck - not the player.
function awardGold(p, n, x, y) {
  if (!p || n <= 0) return;
  gainGold(p, n);
  addFloater(x, y - 14, '+' + n, RES_COLORS.gold);
  if (p === player) SFX.coin();
}
function levelUp(p) {
  p.level++;
  p.skillPts++;
  p.maxHp = levelMaxHp(p);
  p.hp = Math.min(p.maxHp, p.hp + LVL_HP);
  // the early levels come too fast to be news; the late ones say who is ahead
  if (p.level >= LOG_LEVEL) logEvent(p.name + ' REACHED LEVEL ' + p.level, p);
  if (!inAir(p)) floaters.push({ x: p.x, y: p.y - 22, txt: 'LEVEL ' + p.level, color: '#f2cc6a', t: 0, vx: 0, scale: 2, rise: 20 });
  if (p === player) SFX.levelUp();
}
function classSet(p) { return SPRITES.champ[p.cls][skin(p.team)]; }
// Five slots share each team colour, so text that names one player (the
// scoreboard, the event log) also needs a per-slot shade of that team's
// palette - the team colour stays the background, this is the ink.
function playerTint(p) {
  const t = TEAMS[skin(p.team)];
  return [t.trim, t.hatL, t.trimD, t.hat][Math.floor(p.id / TEAM_COUNT) % 4];
}

// ---- inventory: the backpack ---------------------------------------------
// Gold is a wallet number and never a bag item - it is currency, and a purse
// that could run out of room would make a kill refuse its own bounty. What
// you CARRY lives in slots instead: `p.bag` is a fixed array of `p.bagCap`
// cells, each one null or a { type, n } stack of at most ITEMS[type].stack.
// The slot is the unit of capacity, so two half stacks cost two cells the way
// they do in any RPG bag, and the pickup path can genuinely refuse a berry
// when there is nowhere to put it - which is the whole reason the system is
// slots and not a pair of counters.
//
// A cell may also be INSTANCED: a tool's cell carries the bits loaded into it
// (`bits`, `idx` - see js/tools.js), which is why a tool stacks to 1 and is
// moved with bagPut() rather than rebuilt from a type name. Nothing else in
// the bag has state of its own.
// `heal` is what a meal is worth before HEARTHWEAVE - the ONE place the number
// lives, so the tooltip and the meal that lands can never disagree (js/core.js).
const ITEMS = {
  berry: { icon: 'itemBerry', stack: 3, heal: 20 },
  fish: { icon: 'itemFish', stack: 2, heal: 50 },
  // unopened roguelike cards - one ITEMS entry per rarity, so bag storage,
  // the drop pickup, the refusal flash and death-spill are all free (see
  // checklists.md "adding a carried item"). Opening one (bagClick) starts
  // the pick-1-of-3 draft instead of eating; see CARDS below and state.draft.
  cardWhite:  { icon: 'itemCardWhite',  stack: 5 },
  cardGreen:  { icon: 'itemCardGreen',  stack: 5 },
  cardBlue:   { icon: 'itemCardBlue',   stack: 5 },
  cardPurple: { icon: 'itemCardPurple', stack: 5 },
  cardGold:   { icon: 'itemCardGold',   stack: 5 },
};
const CARD_RARITIES = ['white', 'green', 'blue', 'purple', 'gold'];
// What one unopened card of each rarity costs at the merchant's counter
// (the `shop` banner, js/shop.js), and half of it what one fetches sold back.
// A card is priced by its RARITY and not per entry, because the rarity is
// what is ever bought or carried: the pick of three inside it is drawn after
// the money changes hands, so the buyer is paying for the odds, not the buff.
const CARD_PRICE = { white: 25, green: 45, blue: 80, purple: 130, gold: 210 };
// 'white' <-> the 'cardWhite' ITEMS/RES_COLORS key every rarity is stored under
function cardKey(rarity) { return 'card' + rarity[0].toUpperCase() + rarity.slice(1); }
const CARD_TYPE_RARITY = {}; // 'cardWhite' -> 'white', the inverse of cardKey
for (const r of CARD_RARITIES) CARD_TYPE_RARITY[cardKey(r)] = r;
// The one bag everyone starts with; a second one raises p.bagCap. Two rows of
// BAG_COLS - a simple inventory: room for the meals, a card or two, and the
// spare tool or bits a fight turns up, with every cell earned by choosing
// what to keep.
const BAG_CAP = 10;
function bagCount(p, type) {
  let n = 0;
  for (const s of p.bag) if (s && s.type === type) n += s.n;
  return n;
}
function bagUsed(p) { let n = 0; for (const s of p.bag) if (s) n++; return n; }
// how many more of `type` fit: the room left in its partial stacks plus a
// whole stack for every empty cell
function bagRoom(p, type) {
  const max = ITEMS[type] ? ITEMS[type].stack : 0;
  let n = 0;
  for (const s of p.bag) n += !s ? max : s.type === type ? max - s.n : 0;
  return n;
}
// adds what fits - topping up partial stacks before opening a cell - and
// returns how many went in; the caller decides what happens to the remainder
function bagAdd(p, type, n) {
  if (!ITEMS[type]) return 0;
  const max = ITEMS[type].stack;
  let left = n;
  for (const s of p.bag) {
    if (left <= 0) break;
    if (!s || s.type !== type || s.n >= max) continue;
    const take = Math.min(left, max - s.n);
    s.n += take; left -= take;
  }
  for (let i = 0; i < p.bag.length && left > 0; i++) {
    if (p.bag[i]) continue;
    const take = Math.min(left, max);
    p.bag[i] = { type, n: take }; left -= take;
  }
  return n - left;
}
// An instanced cell (a tool, which carries its own bits) cannot be rebuilt
// from a type name, so it is placed whole into the first free slot rather than
// merged into a stack. Returns false when there was nowhere to put it, and the
// caller decides - the drop path leaves it lying in the snow.
function bagPut(p, cell) {
  for (let i = 0; i < p.bag.length; i++) if (!p.bag[i]) { p.bag[i] = cell; return true; }
  return false;
}
// spends from the LAST stack backwards, so partial stacks empty and free
// their cell instead of leaving a trail of ones across the bag
function bagTake(p, type, n) {
  let left = n;
  for (let i = p.bag.length - 1; i >= 0 && left > 0; i--) {
    const s = p.bag[i];
    if (!s || s.type !== type) continue;
    const take = Math.min(left, s.n);
    s.n -= take; left -= take;
    if (s.n <= 0) p.bag[i] = null;
  }
  return n - left;
}

// ---- gear ----------------------------------------------------------------
// Four pieces - helmet, chest, legs, boots - each picked from three variants
// at class select (that free pick is level 1) and bought to level GEAR_LV_MAX
// in-match, from anywhere, per piece. A variant's mod() writes its bonus into
// the effective kit at the piece's level, so the whole system is one table
// plus refreshKit(); the sim never reads gear directly. Levels reset with the
// match because every boot builds fresh Players. The HUD row (UI banner) and
// the bots both buy through input.cmd {kind:'gear', piece}, never directly.
const GEAR_SLOTS = ['HELMET', 'CHEST', 'LEGS', 'BOOTS'];
const GEAR_COSTS = [10, 20, 35]; // gold to reach piece level 2 / 3 / 4
const GEAR_LV_MAX = 4;
const GEAR_MATS = ['#8a6a4a', '#9aa3ad', '#9fc4dd', '#f2cc6a']; // leather/iron/steel/gold, by piece level
const GEAR = [
  [ // helmet: how you kill
    { name: 'LONGSIGHT', blurb: 'ARROWS HIT HARDER', mod: (k, L) => { k.dmgBase += L; } },
    { name: 'QUICKDRAW', blurb: 'FASTER DRAW AND RENOCK', mod: (k, L) => { k.bowCharge *= 1 - 0.08 * L; k.nock *= 1 - 0.08 * L; } },
    { name: 'HUNTSMAN', blurb: 'ANIMALS PAY MORE', mod: (k, L) => { k.huntMul += 0.15 * L; } },
  ],
  [ // chest: how you last
    { name: 'BULWARK', blurb: 'MORE HEALTH', mod: (k, L) => { k.maxHp += 8 * L; } },
    { name: 'IRONHIDE', blurb: 'EVERY HIT HURTS LESS', mod: (k, L) => { k.dr += L; } },
    { name: 'HEARTHWEAVE', blurb: 'FOOD AND NIGHTS ARE KINDER', mod: (k, L) => { k.foodMul += 0.25 * L; k.nightHeal = true; } },
  ],
  [ // legs: how you cross snow
    { name: 'STRIDER', blurb: 'WALK FASTER', mod: (k, L) => { k.walkMul += 0.04 * L; } },
    { name: 'SLIDEWORN', blurb: 'LONGER, EARLIER SLIDES', mod: (k, L) => { k.fatigue *= 1 - 0.12 * L; k.slideMin -= 5 * L; } },
    { name: 'PACKMULE', blurb: 'FELLS AND BREAKS PAY MORE', mod: (k, L) => { k.harvestMul += 0.25 * L; } },
  ],
  [ // boots: how you skate and dodge
    { name: 'SKATES', blurb: 'FASTER, SHARPER ON ICE', mod: (k, L) => { k.iceMax *= 1 + 0.08 * L; k.iceSteer += 0.15 * L; } },
    { name: 'DANCER', blurb: 'DODGES COME BACK SOONER', mod: (k, L) => { k.dodgeCd -= 0.4 * L; } },
    { name: 'GHOSTSTEP', blurb: 'FOES SPOT YOU FROM CLOSER', mod: (k, L) => { k.stealth -= 0.10 * L; } },
  ],
];
// ---- roguelike cards ------------------------------------------------------
// Dropped by a sprung chest in the treeline (hitObject's chest branch,
// js/actions.js, rolled against CHEST_ODDS) and picked via a pick-1-of-3
// draft (state.draft, opened from bagClick).
// Same shape as a GEAR variant's mod(k, L) minus the level - a card is a
// one-shot pick, not a leveled buy - folded into the kit cumulatively by
// refreshKit below, so every kit-reading site in the sim picks them up for
// free the same way it already does for gear. killHeal is the one field no
// champion/gear kit carries; die()'s kill-credit line reads it.
const CARDS = {
  white: [
    { name: 'QUICK HANDS', blurb: 'FASTER RENOCK', mod: (k) => { k.nock *= 0.92; } },
    { name: 'THICK SOLES', blurb: 'WALK FASTER', mod: (k) => { k.walkMul += 0.03; } },
    { name: 'SOFT LANDING', blurb: 'DODGES COME BACK SOONER', mod: (k) => { k.dodgeCd -= 0.25; } },
    { name: 'FORAGER', blurb: 'FELLS AND BREAKS PAY MORE', mod: (k) => { k.harvestMul += 0.5; } },
    { name: 'STEADY HAND', blurb: 'FASTER FULL DRAW', mod: (k) => { k.bowCharge *= 0.96; } },
  ],
  green: [
    { name: 'SHARP POINT', blurb: 'ARROWS HIT HARDER', mod: (k) => { k.dmgBase += 1; } },
    { name: 'PADDED VEST', blurb: 'MORE HEALTH', mod: (k) => { k.maxHp += 12; } },
    { name: 'LIGHT FEET', blurb: 'WALK FASTER', mod: (k) => { k.walkMul += 0.06; } },
    { name: 'CAMOUFLAGE', blurb: 'FOES SPOT YOU FROM CLOSER', mod: (k) => { k.stealth -= 0.08; } },
    { name: "FLETCHER'S TOUCH", blurb: 'FASTER RENOCK', mod: (k) => { k.nock *= 0.85; } },
  ],
  blue: [
    { name: 'HEAVY DRAW', blurb: 'HITS HARDER, SLOWER DRAW', mod: (k) => { k.dmgBase += 2; k.bowCharge *= 1.05; } },
    { name: 'IRON WILL', blurb: 'LESS DAMAGE, MORE HEALTH', mod: (k) => { k.dr += 1.5; k.maxHp += 10; } },
    { name: 'SPRINTER', blurb: 'WALK FASTER, DODGES SOONER', mod: (k) => { k.walkMul += 0.09; k.dodgeCd -= 0.3; } },
    { name: "AMBUSHER'S EDGE", blurb: 'AMBUSH SHOTS HIT HARDER', mod: (k) => { k.ambushMul += 0.4; } },
    { name: 'ICE RUNNER', blurb: 'FASTER, SHARPER ON ICE', mod: (k) => { k.iceMax *= 1.15; k.iceSteer += 0.2; } },
  ],
  purple: [
    { name: 'EXECUTIONER', blurb: 'ARROWS HIT MUCH HARDER', mod: (k) => { k.dmgBase += 3; k.dmgPow += 1.5; } },
    { name: 'STONE SKIN', blurb: 'MUCH LESS DAMAGE TAKEN', mod: (k) => { k.dr += 3; } },
    { name: 'GHOST', blurb: 'SEEN FROM MUCH CLOSER', mod: (k) => { k.stealth -= 0.18; } },
    { name: 'BLOODLUST', blurb: 'HEAL ON A KILL', mod: (k) => { k.killHeal = (k.killHeal || 0) + 12; } },
    { name: 'RELENTLESS', blurb: 'FASTER DODGES AND ARROWS', mod: (k) => { k.dodgeCd -= 0.7; k.nock *= 0.8; } },
  ],
  gold: [
    { name: "BERSERKER'S HEART", blurb: 'HITS HARDER, LESS HEALTH', mod: (k) => { k.dmgBase += 5; k.maxHp -= 15; } },
    { name: 'FORTRESS', blurb: 'MUCH LESS DAMAGE, MORE HP', mod: (k) => { k.dr += 5; k.maxHp += 25; } },
    { name: 'PHANTOM', blurb: 'SEEN CLOSER, HARDER AMBUSH', mod: (k) => { k.stealth -= 0.3; k.ambushMul += 0.5; } },
    { name: 'VAMPIRE', blurb: 'HEAL ON KILL, HITS HARDER', mod: (k) => { k.killHeal = (k.killHeal || 0) + 25; k.dmgBase += 1; } },
    { name: "WINTER'S CHILD", blurb: 'MUCH FASTER, SHARPER ON ICE', mod: (k) => { k.iceMax *= 1.3; k.iceSteer += 0.35; k.walkMul += 0.05; } },
  ],
};
// 3 distinct entries from CARDS[rarity], the draft's pick-1-of-3 options
function pick3Distinct(rarity) {
  const pool = CARDS[rarity].map((c, id) => id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return pool.slice(0, Math.min(3, pool.length));
}

// the class kit plus the gear-free defaults - the fields no class kit
// carries; a variant's mod() edits them in place. Shared by refreshKit and
// the gear pop-up's preview ledger (gearPreviewKit, js/menu.js), so the
// numbers that page shows can never drift from the ones the sim reads.
function baseKit(cls) {
  return Object.assign({}, CLASSES[cls].kit, {
    huntMul: 1, dr: 0, foodMul: 1, nightHeal: false, walkMul: 1,
    harvestMul: 1, dodgeCd: DODGE_CD, stealth: 1,
    ambushMul: AMBUSH_MUL, bury: PRONE_BURY,
    killHeal: 0,
  });
}
// rebuild p.kit from class + gear + skills + cards
function refreshKit(p) {
  const k = baseKit(p.cls);
  for (let i = 0; i < GEAR.length; i++) GEAR[i][p.gear[i]].mod(k, p.gearLv[i]);
  for (const c of p.cards) CARDS[c.rarity][c.id].mod(k);
  p.kit = k;
  p.maxHp = levelMaxHp(p);
  if (p.hp === undefined || p.hp > p.maxHp) p.hp = p.maxHp;
}
function gearCost(p, i) { return p.gearLv[i] >= GEAR_LV_MAX ? null : { gold: GEAR_COSTS[p.gearLv[i] - 1] }; }
// the one entry point for an upgrade, reached through runCmd so every buyer -
// HUD click, number key, bot - goes the same way. A BULWARK bump heals the
// new hp on the spot, the way a hero level does.
function buyGear(p, i) {
  const cost = gearCost(p, i);
  if (!cost || !canAfford(cost, p)) { if (p === player) SFX.deny(); return; }
  pay(cost, p);
  p.gearLv[i]++;
  const oldMax = p.maxHp;
  refreshKit(p);
  if (p.maxHp > oldMax) p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - oldMax));
  addFloater(p.x, p.y - 18, GEAR[i][p.gear[i]].name + ' ' + p.gearLv[i], GEAR_MATS[p.gearLv[i] - 1]);
  burst(p.x, p.y - 8, GEAR_MATS[p.gearLv[i] - 1], 8, 40, 0.45);
  if (p === player) SFX.levelUp();
  else if (nearPlayer(p.x, p.y)) SFX.pickup();
}
// one frame of intent - the whole interface between a controller and the sim
function makeInput() {
  return {
    mx: 0, my: 0,        // movement axis (the sim normalises)
    aimX: 0, aimY: 0,    // world-space aim point (cursor, for the human)
    fire: false,         // bow held: press draws, release looses
    work: false,         // E held
    slide: false,        // shift held
    dodge: false,        // edge-triggered, cleared once the sim reads it
    grapple: false,      // held: the grapple reels only while this is down
                         // (key 3 for the human; the burrow itself is now the
                         // hunter's SNOW COVER cast, key 4, not an input)
    eatBerry: false, eatFish: false, // edge-triggered
    ability: -1,         // edge-triggered: cast the class ability on this key (1-4), js/abilities.js
    cmd: null,           // one-shot: {kind:'build'|'upgrade'|'demolish'|'craft', tx, ty, id} or {kind:'gear', piece} or {kind:'ability', i}
  };
}

class Player {
  constructor(slot, control) {
    this.id = slot;
    this.team = slot % TEAM_COUNT;
    this.control = control;             // 'human' | 'ai' | 'none' (empty slot -> ghost)
    // the local slot wears the profile's display name; every other slot is
    // named off its team - live, through the `name` getter below, so the name
    // follows the paint (skin) when the team-colour setting flips. Editing the
    // name at the menu calls applyProfileName().
    this._name = control === 'human' ? PROFILE.name() : null;
    this.spawn = { tx: WORLD >> 1, ty: WORLD >> 1 }; // landing tile once the eagle drops this slot (the bot brain's "home")
    this.inv = { gold: 0 };             // the wallet is currency only - carried goods are in the bag
    this.bagCap = BAG_CAP;              // slots; one starting backpack
    this.bag = new Array(this.bagCap).fill(null); // each cell null or { type, n }
    this.cls = 0;                       // CLASSES index; the select screen sets the local one
    this.gear = [0, 0, 0, 0];           // chosen GEAR variant per slot (helmet/chest/legs/boots)
    this.gearLv = [1, 1, 1, 1];         // piece levels, 1..GEAR_LV_MAX - fresh every match
    this.skillPts = 1;                  // unspent; level 1 starts with one, each levelUp adds one - spent on ability levels (buyAbilityLv, js/abilities.js)
    this.cards = [];                    // picked roguelike cards, {rarity,id} - like gear, survives a respawn
    // the one order marker this slot commands its workers with (middle click,
    // see the `worker flags` banner in js/robots.js): null, or { tx, ty, job, unit }. NOT
    // cleared by reset() - an order outlives the hand that gave it.
    this.flag = null;
    this.eliminated = false;            // its bird was driven off: no coming back - see die()/eagleFleeResolve
    this.respawnT = 0;                  // seconds left on an active respawn countdown
    this.level = 1; this.xp = 0;        // hero level and lifetime gold earned; survive death
    this.trickleT = 0;                  // s toward the next passive coin (TRICKLE_T, js/sim.js)
    this.kills = 0;                     // rivals downed; scoreboard only, survives death
    refreshKit(this);                   // builds this.kit and this.maxHp from class + gear + skill
    this.aboard = false;                // riding the eagle (beginDrop sets it, dropJump clears it)
    this.dropT = 0;                     // seconds of free fall left after jumping (0 = on the ground)
    this.dropAlt = 0;                   // px the fall started from: the flight's DROP_ALT, or a hop's HOP_ALT off the roost
    this.dropSc = 1;                    // the body's drawn scale as it left the seat (riderScale), shrinking to 1 as it falls
    this.dropU = 1;                     // route fraction at which an AI slot jumps
    // bot brain (unused by a human slot): current job, give-up timers and the
    // short blacklists that keep a bot from re-picking work it cannot reach
    this.ai = {
      tgt: null, avoid: null, avoidT: 0, thinkT: 0,
      huntTgt: null, huntT: 0, huntAvoid: null, huntAvoidT: 0,
      lootT: 0, spendT: 0, buildT: 0, fitT: 0,
      hideT: 0, hideCd: 0,
      wx: 0, wy: 0, roam: 0,
      // the difficulty profile's clocks (ai.js): prof overrides the side's
      // profile (DBG / the harness), seeT is how long a rival has been
      // noticed, aox/aoy the current aim scatter, abilOk this tick's ability
      // roll, pushCd a roost it could not reach
      prof: null, seeT: 0, aimT: 0, aox: 0, aoy: 0, abilT: 0, abilOk: true, pushCd: 0,
    };
    this.reset(true);
  }
  get active() { return this.control !== 'none'; }
  // a named slot (the human, via applyProfileName) keeps its name; every other
  // slot is called after the colour it is WEARING right now
  get name() { return this._name !== null ? this._name : TEAMS[skin(this.team)].name + '-' + (this.id + 1); }
  set name(v) { this._name = v; }
  // spawn placement + every transient cleared; boot calls it with first=true,
  // respawnPlayer() (the team's bird setting a slot back down) with first=false
  reset(first) {
    this.x = (this.spawn.tx + 0.5) * TILE;
    this.y = (this.spawn.ty + 0.5) * TILE;
    this.vx = 0; this.vy = 0;
    this.dir = 'down'; this.moving = false; this.animT = 0;
    this.hp = this.maxHp;
    this.dead = false;
    this.charging = false; this.chargeT = 0;      // bow draw state
    // the meal being chewed and the clock BOTH meals share (js/core.js)
    this.eatT = 0; this.eatType = null; this.eatFxT = 0; this.foodCd = 0;
    this.nockT = 0;                                // the cycle: seconds until the next press (toolCycle, js/tools.js)
    this.catchT = 0;                               // the fish hoist's clock (startCatch/catchFrame, js/tools.js)
    this.fireArmed = false;                        // the bow button has been pressed since the last loose
    this.readyFlash = 0; this.dryT = 0;            // HUD tells: renocked / pressed empty
    this.dodgeT = 0; this.dodgeVX = 0; this.dodgeVY = 0; this.dodgeDustT = 0;
    this.dodgeCharges = DODGE_CHARGES; this.dodgeRegenT = 0;
    this.rollHit = [];                             // what this roll has already swiped (once each)
    this.stamGhost = 0; this.stamGhostT = 0;      // spent-stamina ghost
    this.sliding = false; this.slideT = 0; this.trailD = 0; this.slideDustT = 0;
    // prone: lying down, how much snow is over you (0..1), the get-up window,
    // the crawl's animation phase, and the two tells a buried body still gives
    this.prone = false; this.hide = 0; this.riseT = 0;
    this.crawlT = 0; this.puffT = 0; this.hideFlash = 0;
    this.swingT = 0; this.swingCd = 0; this.swingDir = 0; this.swingHitDone = false;
    this.swing = SWING_BOW;                        // held SWING_TOOLS index (bow at rest)
    // the class abilities (keys 1-4, js/abilities.js): per-key cooldowns, the
    // cast in progress, and every timed state one can leave on a body -
    // slowed under a net or a crater, mid-reel on the grapple, shielded,
    // mid-rush, or five seconds of juggernaut
    this.abCd = [0, 0, 0, 0];
    this.abLv = [0, 0, 0, 0];                      // ability levels, 0 (LOCKED) ..AB_LV_MAX - a skill point each, fresh every match (js/abilities.js)
    this.castAb = -1; this.castT = 0;
    // Every state ANY unit can be under - stun, root, slow and its net
    // drape, the mark, and fire - is written and cleared in one place for
    // all three kinds of unit (`status effects`, js/actions.js), so a slot,
    // a deer and a worker bot wear the identical set.
    clearUnitStatus(this);
    this.shieldT = 0; this.shieldA = 0;            // the tower shield, and where it faces
    this.rushT = 0; this.rushNX = 0; this.rushNY = 0; this.rushVictim = null;
    this.jugT = 0; this.jugHit = []; this.jugFxT = 0;
    this.hopT = 0;                                 // the net shot's recoil hop, on the body
    this.grapT = 0; this.grapX = 0; this.grapY = 0; // the grapple: reel time left, and the anchor it hauls toward
    // The one weapon slot the button fires. It holds a tool CELL - the same
    // object a bag cell is, bits and all - so moving one between the bag and
    // the slot is a reference move and a tool never loses what is loaded
    // into it. Regranted here rather than kept, because death spills the
    // build where you fell (spillInventory) and the bird hands your class's
    // own loadout back. js/tools.js owns all of it.
    giveLoadout(this);
    this.workTx = -1; this.workTy = -1;            // tile the current E swing is aimed at
    this.hurtT = 0; this.invuln = first ? 0 : 3;
    this.kbx = 0; this.kby = 0;
    this.fallT = 0; this.fallRipT = 0;             // floundering in an ice hole
    this.footT = 0; this.footSide = 0;
    this.firePrev = false;
    this.input = makeInput();
  }
}

const players = [];  // every slot; filled by initPlayers() at boot
let player = null;   // the local slot - camera, HUD, cursor and audio follow this one
let inv = null;      // === player.inv, the counters the HUD draws

// one human (this session) and an AI in every other slot
function initPlayers() {
  players.length = 0;
  for (let i = 0; i < MAX_PLAYER_SLOTS; i++) players.push(new Player(i, i === 0 ? 'human' : 'ai'));
  // AI slots draw their class AND their four gear variants from the seed,
  // so a replayed world fields the same roster in the same loadouts
  for (const p of players) if (p.control === 'ai') {
    for (let i = 0; i < GEAR_SLOTS.length; i++) p.gear[i] = Math.floor(hash2(p.id * 29 + i * 13 + 5, 191) * 3) % 3;
    // floor(hash * N): even over however many classes exist (for two it maps
    // exactly as the old `< 0.5` coin, so old seeds keep their rosters)
    setClass(p, Math.floor(hash2(p.id * 17 + 3, 77) * CLASSES.length)); // refreshes the kit too
  }
  player = players[0];
  inv = player.inv;
}

// who p is allowed to shoot: another live slot on another team (this is the
// one place the FFA/friendly-fire rule lives)
function enemyOf(p, q) { return q !== p && q.active && !q.dead && !inAir(q) && (!PVP || q.team !== p.team); }
// riding the eagle or falling from it: not in the world yet, nothing can touch it
function inAir(p) { return p.aboard || p.dropT > 0; }

// ---- being seen ---------------------------------------------------------
// How buried a slot reads to anything hunting for it. `p.hide` is the cover
// itself; a mound that is crawling is worth much less than one holding still,
// which is the whole reason to stop moving before you shoot.
function concealOf(p) { return p.hide > 0 ? p.hide * (p.moving ? PRONE_MOVE : 1) : 0; }
// How far p is noticed from by a watcher whose plain sight range is `range`.
// GHOSTSTEP always shortens it; lying under the snow shortens it hard - but
// never past PRONE_SNIFF, because at arm's length you are found whatever you
// are lying under. Every watcher in the game (the pack, the turrets, the bot
// brain) resolves through this one function so they cannot disagree about who
// is hidden.
function seenAt(p, range) {
  // the falcon's mark is the ONE legal bypass: a swept rival is simply seen,
  // whatever they are lying under, until the mark runs out (js/abilities.js)
  if (p.markT > 0) return range;
  const c = concealOf(p);
  const r = range * kitOf(p).stealth * (1 - PRONE_CUT * c);
  return c > 0 ? Math.max(r, Math.min(range, PRONE_SNIFF)) : r;
}
// the shot that was worth the wait: full cover, and dead still while it goes
function ambushReady(p) { return p.prone && p.hide >= 1 && !p.moving; }

// ---- contested orders --------------------------------------------------
// Several players can order the same tile, drop or fish inside one sim step,
// and only one of those can happen. Each such action queues a claim here;
// resolveContests() runs exactly one per key, picked from (SEED, player id,
// sim tick) - so the same step resolves the same way on every machine.
const contests = new Map();
function contest(key, p, fn) {
  let list = contests.get(key);
  if (!list) { list = []; contests.set(key, list); }
  list.push({ p, fn });
}
function contestRank(p) { return hash2(p.id * 131 + 7, state.tick); }
function resolveContests() {
  for (const list of contests.values()) {
    let win = list[0], wr = contestRank(win.p);
    for (let i = 1; i < list.length; i++) {
      const r = contestRank(list[i].p);
      if (r < wr) { win = list[i]; wr = r; }
    }
    win.fn();
  }
  contests.clear();
}

const animals = []; // passive wildlife: rabbits and deer, spawned once at boot
const structures = []; // every stump-built tiered building (walls included)
const robots = []; // spawner-owned worker bots
const tracers = []; // turret shot lines: {x0,y0,x1,y1,t}
const arrows = []; // live bow shots: {x,y,vx,vy,t,life,dmg,pow}
const ARROW_PX = []; // scratch x,y,colour triples for one rasterised arrow body (render only)
const drops = [];
const particles = []; // {x,y,vx,vy,life,color,size,grav} + optional `alpha` fade ceiling
const floaters = [];
const footprints = [];
const fish = []; // swimmers under the ice: {x,y,a,spd,t,turnT,spook}
const iceCracks = new Map(); // tile idx -> pickaxe hits taken (cracked, not yet open)
const holes = []; // tile idx of open water holes; they refreeze each dawn
const landmarks = []; // named points of interest, placed by worldgen (see the landmarks banner)

// ------------------------------------------------------------ damage & death
// Nothing to do with the wheel above: a hit, what a hit spills, the split
// between a respawn timer and permanent elimination, and the overlay the
// local slot's ending puts up.

// Causes that are a BURN rather than a blow (see updateBurn, js/actions.js).
// A bite of one is not a hit: it goes through the i-frames a body DOES have
// (a roll does not put a fire out, and neither does a respawn) and never
// shoves - a burn is a condition on the body, not a blow landing on it.
const DOT_CAUSE = { fire: true };

// The shove a blow lands on a body, in px/s. It is the BASELINE, not the
// whole story: `kb` is a multiplier on it, so a projectile bit's KNOCKBACK
// (js/tools.js) scales a slot's shove exactly as it scales an animal's or a
// worker's, and the ordinary blow is 1.
const HIT_KB = 110;

// A hit grants NO i-frames. `invuln` is only ever set by something DELIBERATE -
// the dodge roll, a respawn, the drop's landing, scrambling out of a hole - so
// two arrows arriving in the same step both land, both shove and both light
// their fire, rather than the second being eaten by the first's grace.
//
// src: the player who dealt it (kill credit + the log line), null for the
// world; cause: a DEATH_CAUSE key naming what the world did, when src is null;
// kb: the multiplier on HIT_KB (hurtUnit's `kbMul`, undefined = an ordinary shove)
function damagePlayer(p, dmg, dx, dy, src, cause, crit, kb) {
  const dot = !!DOT_CAUSE[cause];
  if (p.dead || (p.invuln > 0 && !dot)) return;
  dmg = Math.max(1, dmg - kitOf(p).dr); // IRONHIDE flattens every hit, but never to zero
  p.hp -= dmg;
  p.hurtT = 0.25;
  if (!dot) {
    // a juggernaut takes the damage and none of the shove (js/abilities.js)
    if (p.jugT > 0) { p.kbx = 0; p.kby = 0; }
    else {
      const k = HIT_KB * (kb === undefined ? 1 : kb);
      p.kbx = dx * k; p.kby = dy * k;
    }
  }
  risePlayer(p); // nobody stays buried through a hit: the cover is blown with the body
  breakEat(p);   // ...and the meal goes with it - that is what makes the channel a channel
  cancelCatch(p); // ...and the hoist: a fish over your head is a hit you did not see coming
  // a burn shakes and shouts once, when it lights (igniteUnit) - not four
  // times a second for as long as it runs
  if (p === player && !dot) state.shake = Math.max(state.shake, crit ? 6 : 3);
  addDmgFloater(p.x, p.y - 18, dmg, p === player, crit);
  if (nearPlayer(p.x, p.y) && !dot) SFX.hurt();
  burst(p.x, p.y - 6, dot ? '#ff9440' : '#e04a54', 8, 50, 0.45);
  if (p.hp <= 0) die(p, src, cause);
}

// what the log says when nobody gets the credit
const DEATH_CAUSE = { ice: 'FELL THROUGH THE ICE', wolf: 'WENT TO THE WOLVES', tackle: 'RAN INTO SOMETHING SOLID', eagle: 'LOST THEIR EAGLE', fire: 'BURNED IN THE SNOW' };
// ...and what the line says when there IS credit but no arrow: `cause` is
// read for the verb too, so a worker's axe doesn't get written up as a shot
const KILL_VERB = { worker: 'CUT DOWN', fire: 'BURNED' };

// Death empties the wallet AND the backpack. Gold goes to the credited
// killer outright (through awardGold, so a kill also levels the killer - the
// bounty is the point of taking the fight); with no killer to pay it goes
// down with the body, because gold is never a physical drop. Everything
// carried still spills as pickups, one per bag stack, because a stack is
// already the unit the bag counts in - a killer with a full bag of their own
// simply leaves them lying. Lifetime xp is untouched, and the standings rank
// on xp (scoreOf), so a looted slot keeps the place it earned.
function spillInventory(p, killer) {
  for (const k in p.inv) {
    const n = p.inv[k];
    p.inv[k] = 0;
    if (n <= 0) continue;
    if (k === 'gold') {
      if (killer && !killer.dead) awardGold(killer, n, killer.x, killer.y);
      continue;
    }
    const parts = Math.min(3, n);
    const base = Math.floor(n / parts), rem = n % parts;
    for (let i = 0; i < parts; i++) spawnDrop(p.x, p.y - 4, k, base + (i < rem ? 1 : 0));
  }
  // the bag, and then the weapon slot: a build goes down with the body and
  // lies where it fell, loaded, for whoever walks over it. reset() hands
  // the slot its class's starting loadout back, so a respawn is armed but
  // not the same player it was.
  for (let i = 0; i < p.bag.length; i++) {
    const s = p.bag[i];
    p.bag[i] = null;
    if (s && s.n > 0) spawnDrop(p.x, p.y - 4, s.type, s.n, s.bits ? s : null);
  }
  for (let i = 0; i < p.tools.length; i++) {
    const s = p.tools[i];
    p.tools[i] = null;
    if (s) spawnDrop(p.x, p.y - 4, s.type, 1, s);
  }
}

// The wait for the bird to set a downed slot back down: gold-free, and a
// read of the hero's level alone - 3 s at level 1, 5 s at level 2, 25 s at
// LEVEL_MAX - so an early death costs almost nothing and a late one costs
// real match, which is what makes a wiped side late (everyone high) a real
// window on a roost its defenders otherwise come back to sixty pixels from
// the bird every few seconds. Nothing off the match clock: the level IS the
// clock, since gold is XP and the table only climbs.
const RESPAWN_BASE = 1;   // s
const RESPAWN_LV = 2;     // s more per hero level
function respawnTime(p) { return RESPAWN_BASE + RESPAWN_LV * p.level; }

// A slot goes down two ways. While its team's bird still roosts (or is
// still flying in) it is temporary: p.dead is set (out of the world right
// now) but p.eliminated stays false and respawnT counts down to a return AT
// THE BIRD (see updateRespawns/respawnPlayer). Once the bird has been driven
// off it is permanent: p.eliminated = true, no way back - the eagle is the
// only thing that takes a slot out of a match for good. Only the local
// slot's ELIMINATION takes the screen with it (the death overlay); a
// respawn-pending local death gets the lighter 'respawning' overlay instead
// (see endMatch/DEAD_ITEMS/renderDead).
function die(p, src, cause) {
  // practice: nothing is at stake and nobody is ever out - a death is undone
  // on the spot, back at the spawn tile with the build and the bag untouched
  if (PRACTICE && p === player) { practiceRevive(p); return; }
  p.dead = true;
  p.charging = false;
  p.chargeT = 0;
  p.fireArmed = false;
  p.dodgeT = 0;
  p.vx = p.vy = 0;
  p.sliding = false;
  p.prone = false; p.hide = 0; p.riseT = 0;
  p.fallT = 0;
  p.swingT = p.swingCd = 0;
  // whatever ability the body was mid-way through dies with it, and the meal
  p.eatT = 0; p.eatType = null;
  p.castT = 0; p.castAb = -1;
  p.shieldT = 0; p.rushT = 0; p.rushVictim = null;
  p.jugT = 0; p.hopT = 0; p.grapT = 0;
  clearUnitStatus(p); // root, slow, net, mark and the fire go out with the body
  burst(p.x, p.y - 6, TEAMS[skin(p.team)].mark, 12, 55, 0.6);
  // kill credit and the feed line: the killer's colours if there is one,
  // otherwise the victim's, since the victim is who the line is about
  const killer = src && src !== p ? src : null;
  // an item on the cursor goes back in the bag first, so it spills with the
  // rest of the build instead of vanishing with the hand that was holding it
  if (p === player && state.drag) { dragReturn(); state.dragPend = null; }
  spillInventory(p, killer);
  if (killer) {
    killer.kills++;
    // BLOODLUST/VAMPIRE: a flat heal on a confirmed kill, the one card
    // effect that isn't a plain kitOf() field - mirrors eatBerry's heal
    if (killer.kit.killHeal > 0 && killer.hp < killer.maxHp) {
      const heal = Math.min(killer.kit.killHeal, killer.maxHp - killer.hp);
      killer.hp += heal;
      addFloater(killer.x, killer.y - 14, '+' + heal, '#8fe08a');
      if (nearPlayer(killer.x, killer.y)) SFX.heal();
    }
  }
  logEvent(killer ? killer.name + ' ' + (KILL_VERB[cause] || 'SHOT') + ' ' + p.name
    : p.name + ' ' + (DEATH_CAUSE[cause] || 'WENT DOWN'), killer || p);
  // the bird is the way back - a side whose objective has fallen is out,
  // however its slots go down after that
  if (!teamEagleDown(p.team)) p.respawnT = respawnTime(p);
  else p.eliminated = true;
  if (p === player) endMatch(p.eliminated ? 'lost' : 'respawning');
  else {
    addFloater(p.x, p.y - 20, p.name + (p.eliminated ? ' OUT' : ' DOWN'), TEAMS[skin(p.team)].mark);
    if (state.spec === p.id) specNext(1); // the slot being watched went down: follow another
  }
  checkLastStanding();
}

// ticks every dead-but-not-eliminated slot's respawn timer; called from
// updatePlay alongside updateStructures, so it keeps running under the
// 'respawning' overlay exactly like the rest of the sim does under 'dead'
function updateRespawns(dt) {
  for (const p of players) {
    if (!p.active || !p.dead || p.eliminated) continue;
    // the bird left mid-timer: eagleFleeResolve puts the whole side out at
    // the end of the ceremony, so the timer simply stops meaning anything
    if (teamEagleDown(p.team)) continue;
    p.respawnT -= dt;
    if (p.respawnT > 0) continue;
    // a bird still in the air has nowhere to set anyone down: hold at zero
    // until it roosts (a slot shot in the seconds between its own landing
    // and the bird's)
    const e = state.drop && state.drop.eagles[p.team];
    if (!e || e.state !== 'down') { p.respawnT = 0; continue; }
    respawnPlayer(p);
  }
}

// brings a downed slot back at its team's bird: p.reset(false) is the exact
// full-clear a fresh eagle landing gets (same 3 s i-frames), anchored
// RESPAWN_OUT px down the lane from the roost - the nearest tile a body can
// stand on there - so the way back into the match is the road everyone
// else walked out on.
const RESPAWN_OUT = 40;
function respawnPlayer(p) {
  const e = state.drop && state.drop.eagles[p.team];
  if (e && e.state === 'down') {
    const d = e.laneDir || { x: 0, y: 1 };
    p.spawn = nearestDryTile(e.x + d.x * RESPAWN_OUT, e.y + d.y * RESPAWN_OUT, p);
  }
  p.eliminated = false;
  p.respawnT = 0;
  p.reset(false);
  burst(p.x, p.y - 2, '#f4f7ff', 16, 70, 0.5, true);
  if (nearPlayer(p.x, p.y)) SFX.place();
  if (p === player) {
    state.over = null;
    state.mode = 'play';
    state.spec = -1; // the camera returns to the local slot, not whoever it was watching
    camX = Math.max(0, Math.min(WORLD * TILE - WV_W, p.x - WV_W / 2));
    camY = Math.max(0, Math.min(WORLD * TILE - WV_H, p.y - WV_H / 2));
    state.introFrom = { x: camX, y: camY };
    state.intro = HUD_IN_T; state.introLen = HUD_IN_T; // the HUD slides in, like a fresh landing
  }
}

// slots still in the match (riding the eagle counts: it is about to land)
function aliveCount() { let n = 0; for (const p of players) if (p.active && !p.dead) n++; return n; }

// a team is still "in the match" while its bird has not been driven off and
// anyone is in one of its slots - note !eliminated, not !dead: a wiped team
// is waiting on its bird, not out, so the objective is the only way to win
function teamInMatch(team) {
  if (teamEagleDown(team)) return false; // the objective: a fallen eagle takes its whole side out
  return players.some((q) => q.active && q.team === team && !q.eliminated);
}

// rival TEAMS still in the match, by the same rule enemyOf()/PVP state -
// p's own team is never counted, and each rival team counts once however
// many slots it has.
function rivalTeamsInMatch(p) {
  const seen = new Set();
  let n = 0;
  for (const q of players) {
    if (!q.active || seen.has(q.team) || !(!PVP || q.team !== p.team)) continue;
    seen.add(q.team);
    if (teamInMatch(q.team)) n++;
  }
  return n;
}

// the local slot not eliminated and every RIVAL team gone: the match is won
// (only once, and only when there was another side to beat). Teams win
// together - a side is in the match while its bird roosts, whoever is
// standing - so this is the last BIRD standing, never the last player.
function checkLastStanding() {
  // practice has no rivals and no ending - an empty roster must not read as a win
  if (PRACTICE) return;
  // state.eagleCine: the driven-off ceremony is playing - the screens wait
  // for it (eagleFleeResolve re-runs this once the camera has had its moment)
  if (state.over || state.eagleCine || player.eliminated || rivalTeamsInMatch(player) > 0) return;
  endMatch('won');
}

// the practice room's answer to a fall: full pool, spawn tile, a beat of
// grace - the fall through the ice or the tackle still HAPPENED (the damage
// numbers taught what they taught), it just costs nothing that lasts
function practiceRevive(p) {
  p.hp = p.maxHp;
  p.vx = p.vy = 0;
  p.dodgeT = 0;
  clearUnitStatus(p); // the fire goes out with the fall, same as the stun
  p.fallT = 0; p.sliding = false; p.catchT = 0;
  p.prone = false; p.hide = 0; p.riseT = 0;
  p.charging = false; p.chargeT = 0; p.fireArmed = false;
  p.eatT = 0; p.eatType = null;                  // the meal dies with the body here too
  const s = p.spawn || { tx: WORLD >> 1, ty: WORLD >> 1 };
  p.x = (s.tx + 0.5) * TILE; p.y = (s.ty + 0.5) * TILE;
  p.invuln = 2;
  burst(p.x, p.y - 4, '#f4f7ff', 14, 60, 0.5, true);
  SFX.place();
}

// Both end screens print the same object, so there is one of these rather
// than one per ending: the four tally numbers, the class it was played in,
// the whole side both stages stand, and the one fact only the loss prints
// (its placing).
function endSnapshot() {
  // where the local slot finished: every slot still in the match outlasted
  // it, so place is one past that count. A win is 1st by definition (the
  // screen that prints place never sees a win, but the object shouldn't lie).
  const left = players.filter((q) => q !== player && q.active && !q.eliminated).length;
  return {
    gold: player.xp, kills: player.kills, level: player.level, time: state.elapsed,
    team: player.team, cls: player.cls,
    // the whole side, the local slot first: every body either ending stands
    // on its stage, with the name, class and kit it finished in (a mate who
    // is down at the whistle still shares the result)
    roster: players.filter((q) => q.active && q.team === player.team)
      .sort((a, b) => (a === player ? -1 : b === player ? 1 : a.id - b.id))
      .map((q) => ({ name: q.name, cls: q.cls, gear: q.gear.slice(), gearLv: q.gearLv.slice() })),
    place: player.eliminated ? left + 1 : 1, of: players.filter((q) => q.active).length,
  };
}

// the local slot leaves the match, one way or the other: the overlay takes
// the screen (mode 'dead'), the sim runs on underneath it
function endMatch(how) {
  // count a win only the first time this match resolves as won - a second
  // endMatch('won') (or a driver poking it) must not increment twice
  const awardWin = how === 'won' && state.over !== 'won';
  state.over = how;
  if (awardWin) PROFILE.addWin();
  state.mode = 'dead';
  state.deadView = 'menu';
  state.deadSel = 0;
  state.deadHover = [0, 0];
  state.mapOpen = false;
  state.bagOpen = false;
  state.settingsOpen = false;
  state.wheel = null;
  state.draft = null;
  state.flagAim = false;
  state.deadTimer = 0;
  state.defeatT = 0;
  state.rpClosed = false; // every death opens the replay again
  // an ENDING freezes its numbers here, not in the render pass: the match
  // runs on underneath (a generator can still pay out, a rival can still
  // fall) and a total that climbs behind a tally which already counted it
  // reads as a bug. A loss's summary is opened minutes later, off the LOBBY
  // plank, so this is the only moment its numbers are still true.
  state.end = how === 'won' || how === 'lost' ? endSnapshot() : null;
  if (how === 'won') { SFX.victory(); state.shake = Math.max(state.shake, 4); }
  // the end screen has a song of its own; a respawn timer is not the end of anything
  if (how === 'won' || how === 'lost') SFX.music.play(how === 'won' ? 'victory' : 'defeat', { in: 1.2 });
  player.input = makeInput(); // whatever was held dies with the slot
  // a respawn wait has no planks: it opens straight onto an ally, with the
  // replay window over the view until it is closed (the `death & spectate`
  // banner, js/screens.js); specNext keeps to the side while the wait runs
  if (how === 'respawning') { state.deadView = 'spec'; state.spec = -1; specNext(1); }
}

