'use strict';
// Every combatant in the match: the numbers a slot is made of, the Player
// class and its slots, champions and kits, gear, cards, the input struct,
// contested orders, the entity arrays - and the damage & death lifecycle
// those slots live and die by.
// ------------------------------------------------------------ players
// Every slot in the match is a Player. They all carry identical state and are
// all driven from the same `input` struct, so a feature written for "the
// player" is a feature every slot has: the local human (slot 0), the AI fills,
// and eventually a network peer are only different in who fills that struct.
// Sim code takes a `p` argument; `player` (the local slot) is for the camera,
// HUD, cursor and audio only.
const TEAMS = SPRITES.teams; // the 2 colour presets (RED, BLUE), baked into the sprites

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

// Hero levels (League-style, max 9). XP is lifetime gold earned (gainGold), never spent
// or lost on death; LEVEL_XP[n-1] is the total needed to reach level n. Each level past
// the first is the same flat growth: +LVL_HP max hp (healed on the spot) and +LVL_DMG on
// every arrow, applied on top of the champion kit.
const LEVEL_MAX = 9;
const LEVEL_XP = [0, 10, 25, 45, 70, 100, 135, 175, 220];
const LVL_HP = 6;
const LVL_DMG = 1;

// The dodge roll as an ability: how long it lasts, how hard it throws you,
// and how many charges refill how fast. What a roll HITS on the way through
// is the ROLL_/TACKLE_ block in js/actions.js.
const DODGE_T = 0.28;     // roll duration (s)
const DODGE_SPEED = 215;  // roll velocity -> ~60px travelled
const DODGE_CHARGES = 2;
const DODGE_CD = 3.5;     // seconds to refill one charge

// The two bow numbers a champion kit is expressed against - CHAMPS below
// reads both at load time, which is why they sit here and the rest of the
// bow (the quiver, the shafts, the trail) is in js/actions.js.
const BOW_CHARGE = 0.9;   // seconds to a full draw
const BOW_NOCK = 0.45;    // WREN's seconds between loosing and the next draw

// ---- champions ----------------------------------------------------------
// Every slot plays one of these. A champion is a look (SPRITES.champ[c]) plus
// a kit: the handful of numbers updatePlayer / fireArrow / tryDodge read
// through kitOf(p) instead of the bare constants. Champion 0 is the original
// kit unchanged; the skater trades draw power for ice speed and shoots
// harder the faster she is moving. Picked on the select screen (local) or
// hashed from the seed (AI slots) in initPlayers().
const CHAMPS = [
  {
    name: 'WREN', role: 'THE RANGER',
    blurb: ['STEADY DRAW, HARD HITS. THE ALL-ROUNDER.', 'AXE AND PICK COME OUT ON THEIR OWN.', 'ROLLS CHAIN INTO SPEED ON THE RIVERS.'],
    stats: { ice: 2, draw: 3, power: 4, tough: 3 },
    kit: { iceMax: 1, iceSteer: 2.6, slideMin: SLIDE_MIN, fatigue: 1, chargeMul: 0.55,
      bowCharge: BOW_CHARGE, nock: BOW_NOCK, dmgBase: 4, dmgPow: 9, spdDmg: 0, dodgeSpeed: DODGE_SPEED, maxHp: 100 },
  },
  {
    name: 'SKADI', role: 'THE SKATER',
    blurb: ['BLADES ON THE ICE: FASTER CAP, SHARPER CARVES.', 'QUICK DRAW THAT BARELY SLOWS HER DOWN.', 'ARROWS HIT HARDER THE FASTER SHE FLIES.'],
    stats: { ice: 5, draw: 5, power: 2, tough: 2 },
    kit: { iceMax: 1.35, iceSteer: 3.8, slideMin: 60, fatigue: 0.5, chargeMul: 0.85,
      bowCharge: 0.6, nock: 0.3, dmgBase: 3, dmgPow: 6, spdDmg: 7, dodgeSpeed: 245, maxHp: 85 },
  },
];
// the kit every sim site reads: the champion's numbers with the slot's gear
// folded in. refreshKit() rebuilds the cache whenever champion or gear
// changes; kitOf() itself is called many times a frame and must stay a read.
function kitOf(p) { return p.kit || CHAMPS[p.champ].kit; }
// swap a slot's champion: kit hp applies on the spot (full heal, it's a pre-match choice)
function setChamp(p, c) { p.champ = c; refreshKit(p); p.hp = p.maxHp; }
// kit hp plus the flat per-level growth
function levelMaxHp(p) { return kitOf(p).maxHp + LVL_HP * (p.level - 1); }
// the one way gold enters a wallet: pays the purse and the same amount of XP
function gainGold(p, n) {
  p.inv.gold += n;
  p.xp += n;
  if (p === player) PROFILE.addGold(n); // lifetime total, coalesced - see profile.js
  while (p.level < LEVEL_MAX && p.xp >= LEVEL_XP[p.level]) levelUp(p);
}
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
function champSet(p) { return SPRITES.champ[p.champ][p.team]; }
// Five slots share each team colour, so text that names one player (the
// scoreboard, the event log) also needs a per-slot shade of that team's
// palette - the team colour stays the background, this is the ink.
function playerTint(p) {
  const t = TEAMS[p.team];
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
const ITEMS = {
  berry: { icon: 'itemBerry', stack: 3 },
  fish: { icon: 'itemFish', stack: 2 },
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
// 'white' <-> the 'cardWhite' ITEMS/RES_COLORS key every rarity is stored under
function cardKey(rarity) { return 'card' + rarity[0].toUpperCase() + rarity.slice(1); }
const CARD_TYPE_RARITY = {}; // 'cardWhite' -> 'white', the inverse of cardKey
for (const r of CARD_RARITIES) CARD_TYPE_RARITY[cardKey(r)] = r;
const BAG_CAP = 10; // the one bag everyone starts with; a second one raises p.bagCap
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
// at champ select (that free pick is level 1) and bought to level GEAR_LV_MAX
// in-match, from anywhere, per piece. A variant's mod() writes its bonus into
// the effective kit at the piece's level, so the whole system is one table
// plus refreshKit(); the sim never reads gear directly. Levels reset with the
// match because every boot builds fresh Players. The HUD row (UI banner) and
// the bots both buy through input.cmd {kind:'gear', piece}, never directly.
const GEAR_SLOTS = ['HELMET', 'CHEST', 'LEGS', 'BOOTS'];
const GEAR_COSTS = [10, 20, 35]; // gold to reach piece level 2 / 3 / 4
const GEAR_LV_MAX = 4;
// four hud abilities (loose, dodge, ambush, fletch), ranks 0..AB_RANK_MAX.
// Rank 0 is the baseline every slot starts with; a skill point from each
// hero level buys the next rank. The sim reads the result through kitOf.
const AB_RANK_MAX = 3;
const AB_SKILL = [
  { mod: (k, L) => { k.nock *= 1 - 0.12 * L; } },
  { mod: (k, L) => { k.dodgeCd *= 1 - 0.12 * L; } },
  { mod: (k, L) => { k.ambushMul += 0.25 * L; k.bury *= 1 - 0.12 * L; } },
  { mod: (k, L) => { k.fletch *= 1 - 0.15 * L; } },
];
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
    { name: 'PACKMULE', blurb: 'FELLS AND BREAKS PAY MORE', mod: (k, L) => { k.harvest += L; } },
  ],
  [ // boots: how you skate and dodge
    { name: 'SKATES', blurb: 'FASTER, SHARPER ON ICE', mod: (k, L) => { k.iceMax *= 1 + 0.08 * L; k.iceSteer += 0.15 * L; } },
    { name: 'DANCER', blurb: 'DODGES COME BACK SOONER', mod: (k, L) => { k.dodgeCd -= 0.4 * L; } },
    { name: 'GHOSTSTEP', blurb: 'FOES SPOT YOU FROM CLOSER', mod: (k, L) => { k.stealth -= 0.10 * L; } },
  ],
];
// ---- roguelike cards ------------------------------------------------------
// Picked from the Keep's craft drops (see STRUCTS.keep, updateStructures'
// keep branch) via a pick-1-of-3 draft (state.draft, opened from bagClick).
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
    { name: 'FORAGER', blurb: 'FELLS AND BREAKS PAY MORE', mod: (k) => { k.harvest += 1; } },
    { name: 'STEADY HAND', blurb: 'FASTER FULL DRAW', mod: (k) => { k.bowCharge *= 0.96; } },
  ],
  green: [
    { name: 'SHARP POINT', blurb: 'ARROWS HIT HARDER', mod: (k) => { k.dmgBase += 1; } },
    { name: 'PADDED VEST', blurb: 'MORE HEALTH', mod: (k) => { k.maxHp += 12; } },
    { name: 'LIGHT FEET', blurb: 'WALK FASTER', mod: (k) => { k.walkMul += 0.06; } },
    { name: 'CAMOUFLAGE', blurb: 'FOES SPOT YOU FROM CLOSER', mod: (k) => { k.stealth -= 0.08; } },
    { name: "FLETCHER'S TOUCH", blurb: 'ARROWS REGROW FASTER', mod: (k) => { k.fletch *= 0.85; } },
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
    { name: 'RELENTLESS', blurb: 'FASTER DODGES AND ARROWS', mod: (k) => { k.dodgeCd -= 0.7; k.fletch *= 0.75; } },
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

// rebuild p.kit from champion + gear. The gear-free defaults added here are
// the fields no champion kit carries; a variant's mod() edits them in place.
function refreshKit(p) {
  const k = Object.assign({}, CHAMPS[p.champ].kit, {
    huntMul: 1, dr: 0, foodMul: 1, nightHeal: false, walkMul: 1,
    harvest: 0, dodgeCd: DODGE_CD, stealth: 1,
    ambushMul: AMBUSH_MUL, bury: PRONE_BURY, fletch: QUIVER_REGEN,
    killHeal: 0,
  });
  for (let i = 0; i < GEAR.length; i++) GEAR[i][p.gear[i]].mod(k, p.gearLv[i]);
  for (let i = 0; i < AB_SKILL.length; i++) AB_SKILL[i].mod(k, p.skill[i]);
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
function abCanBuy(p, i) { return p.skillPts > 0 && p.skill[i] < AB_RANK_MAX; }
// one rank on ability i, reached through runCmd so HUD click and bots share it
function buySkill(p, i) {
  if (!abCanBuy(p, i)) { if (p === player) SFX.deny(); return; }
  p.skillPts--;
  p.skill[i]++;
  refreshKit(p);
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
    prone: false,        // edge-triggered: toggles the burrow (Ctrl). NOT a held
                         // level - holding a modifier while tapping W closes the
                         // browser tab, and preventDefault cannot stop it
    eatBerry: false, eatFish: false, // edge-triggered
    cmd: null,           // one-shot: {kind:'build'|'upgrade'|'demolish'|'craft', tx, ty, id} or {kind:'gear', piece} or {kind:'skill', i}
  };
}

class Player {
  constructor(slot, control) {
    this.id = slot;
    this.team = slot % TEAM_COUNT;
    this.control = control;             // 'human' | 'ai' | 'none' (empty slot -> ghost)
    // the local slot wears the profile's display name; every other slot is
    // named off its team. Editing the name at the menu calls applyProfileName().
    this.name = control === 'human' ? PROFILE.name() : TEAMS[this.team].name + '-' + (slot + 1);
    this.spawn = { tx: WORLD >> 1, ty: WORLD >> 1 }; // landing tile once the eagle drops this slot (the bot brain's "home")
    this.inv = { gold: 0 };             // the wallet is currency only - carried goods are in the bag
    this.bagCap = BAG_CAP;              // slots; one starting backpack
    this.bag = new Array(this.bagCap).fill(null); // each cell null or { type, n }
    this.champ = 0;                     // CHAMPS index; the select screen sets the local one
    this.gear = [0, 0, 0, 0];           // chosen GEAR variant per slot (helmet/chest/legs/boots)
    this.gearLv = [1, 1, 1, 1];         // piece levels, 1..GEAR_LV_MAX - fresh every match
    this.skill = [0, 0, 0, 0];          // ranks on the four hud abilities, 0..AB_RANK_MAX
    this.skillPts = 1;                  // unspent; level 1 starts with one, each levelUp adds one
    this.cards = [];                    // picked roguelike cards, {rarity,id} - like gear, survives a respawn
    // the one order marker this slot commands its workers with (middle click,
    // see the `worker flags` banner in js/robots.js): null, or { tx, ty, job, unit }. NOT
    // cleared by reset() - an order outlives the hand that gave it.
    this.flag = null;
    this.eliminated = false;            // no keep, no coming back - see die()/updateRespawns
    // who put this slot down last, for the defeat screen's one line: a
    // killer's name and team, or null with a DEATH_CAUSE key when the world
    // did it. die() writes them, endSnapshot() freezes them, nothing else looks.
    this.downedBy = null; this.downedTeam = 0; this.downedCause = null;
    this.respawnT = 0;                  // seconds left on an active respawn countdown
    this.level = 1; this.xp = 0;        // hero level and lifetime gold earned; survive death
    this.kills = 0;                     // rivals downed; scoreboard only, survives death
    refreshKit(this);                   // builds this.kit and this.maxHp from champ + gear + skill
    this.aboard = false;                // riding the eagle (beginDrop sets it, dropJump clears it)
    this.dropT = 0;                     // seconds of free fall left after jumping (0 = on the ground)
    this.dropU = 1;                     // route fraction at which an AI slot jumps
    // bot brain (unused by a human slot): current job, give-up timers and the
    // short blacklists that keep a bot from re-picking work it cannot reach
    this.ai = {
      tgt: null, avoid: null, avoidT: 0, thinkT: 0,
      huntTgt: null, huntT: 0, huntAvoid: null, huntAvoidT: 0,
      lootT: 0, spendT: 0, buildT: 0,
      hideT: 0, hideCd: 0,
      wx: 0, wy: 0, roam: 0,
    };
    this.reset(true);
  }
  get active() { return this.control !== 'none'; }
  // spawn placement + every transient cleared; boot calls it with first=true,
  // respawnPlayer() (a team's Keep bringing a slot back) with first=false
  reset(first) {
    this.x = (this.spawn.tx + 0.5) * TILE;
    this.y = (this.spawn.ty + 0.5) * TILE;
    this.vx = 0; this.vy = 0;
    this.dir = 'down'; this.moving = false; this.animT = 0;
    this.hp = this.maxHp;
    this.dead = false;
    this.charging = false; this.chargeT = 0;      // bow draw state
    // the quiver: what is left, the renock cooldown, and the fletching timer
    this.quiver = QUIVER_MAX; this.nockT = 0; this.fletchT = 0;
    this.fireArmed = false;                        // the bow button has been pressed since the last loose
    this.quiverFlash = 0; this.readyFlash = 0; this.dryT = 0; // HUD tells: gained / renocked / pressed empty
    this.dodgeT = 0; this.dodgeVX = 0; this.dodgeVY = 0; this.dodgeDustT = 0;
    this.dodgeCharges = DODGE_CHARGES; this.dodgeRegenT = 0;
    this.rollHit = [];                             // what this roll has already swiped (once each)
    this.stunT = 0; this.stunMax = 0;              // seeing stars: no intent gets through
    this.stamGhost = 0; this.stamGhostT = 0;      // spent-stamina ghost
    this.sliding = false; this.slideT = 0; this.trailD = 0; this.slideDustT = 0;
    // prone: lying down, how much snow is over you (0..1), the get-up window,
    // the crawl's animation phase, and the two tells a buried body still gives
    this.prone = false; this.hide = 0; this.riseT = 0;
    this.crawlT = 0; this.puffT = 0; this.hideFlash = 0;
    this.swingT = 0; this.swingCd = 0; this.swingDir = 0; this.swingHitDone = false;
    this.tool = TOOL_BOW;                          // held TOOLS index (bow at rest)
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
  // AI slots draw their champion AND their four gear variants from the seed,
  // so a replayed world fields the same roster in the same loadouts
  for (const p of players) if (p.control === 'ai') {
    for (let i = 0; i < GEAR_SLOTS.length; i++) p.gear[i] = Math.floor(hash2(p.id * 29 + i * 13 + 5, 191) * 3) % 3;
    setChamp(p, hash2(p.id * 17 + 3, 77) < 0.5 ? 0 : 1); // refreshes the kit too
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
const shafts = []; // spent arrows stuck in the snow, free for anyone: {x,y,nx,ny,team,t}
const ARROW_PX = []; // scratch x,y pairs for one arrow's rasterised body (render only)
const drops = [];
const particles = []; // {x,y,vx,vy,life,color,size,grav} + optional `alpha` fade ceiling
const floaters = [];
const footprints = [];
const lights = []; // rebuilt from placed objects
const fish = []; // swimmers under the ice: {x,y,a,spd,t,turnT,spook}
const iceCracks = new Map(); // tile idx -> pickaxe hits taken (cracked, not yet open)
const holes = []; // tile idx of open water holes; they refreeze each dawn
const landmarks = []; // named points of interest, placed by worldgen (see the landmarks banner)

// ------------------------------------------------------------ damage & death
// Nothing to do with the wheel above: a hit, what a hit spills, the split
// between a respawn timer and permanent elimination, and the overlay the
// local slot's ending puts up.

// src: the player who dealt it (kill credit + the log line), null for the
// world; cause: a DEATH_CAUSE key naming what the world did, when src is null
function damagePlayer(p, dmg, dx, dy, src, cause, crit) {
  if (p.dead || p.invuln > 0) return;
  dmg = Math.max(1, dmg - kitOf(p).dr); // IRONHIDE flattens every hit, but never to zero
  p.hp -= dmg;
  p.hurtT = 0.25;
  p.invuln = 0.7;
  p.kbx = dx * 110; p.kby = dy * 110;
  risePlayer(p); // nobody stays buried through a hit: the cover is blown with the body
  if (p === player) state.shake = Math.max(state.shake, crit ? 6 : 3);
  addDmgFloater(p.x, p.y - 18, dmg, p === player, crit);
  if (nearPlayer(p.x, p.y)) SFX.hurt();
  burst(p.x, p.y - 6, '#e04a54', 8, 50, 0.45);
  if (p.hp <= 0) die(p, src, cause);
}

// what the log says when nobody gets the credit
const DEATH_CAUSE = { ice: 'FELL THROUGH THE ICE', wolf: 'WENT TO THE WOLVES', tackle: 'RAN INTO SOMETHING SOLID', eagle: 'LOST THEIR EAGLE' };
// ...and what the line says when there IS credit but no arrow: `cause` is
// read for the verb too, so a worker's axe doesn't get written up as a shot
const KILL_VERB = { worker: 'CUT DOWN' };

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
  for (let i = 0; i < p.bag.length; i++) {
    const s = p.bag[i];
    p.bag[i] = null;
    if (s && s.n > 0) spawnDrop(p.x, p.y - 4, s.type, s.n);
  }
}

const RESPAWN_TIME = 8; // flat, gold-free - "the respawn from a keep is timer-only"

// A slot can go down two ways now. With a living team Keep it is temporary:
// p.dead is set (out of the world right now, same as always) but
// p.eliminated stays false and a flat respawnT counts down to a return at
// the Keep (see updateRespawns/respawnPlayer). With no Keep it is exactly
// today's permanent death: p.eliminated = true, no way back. Only the local
// slot's ELIMINATION takes the screen with it (the death overlay); a
// respawn-pending local death gets the lighter 'respawning' overlay instead
// (see endMatch/DEAD_ITEMS/renderDead).
function die(p, src, cause) {
  p.dead = true;
  p.charging = false;
  p.chargeT = 0;
  p.fireArmed = false;
  p.dodgeT = 0;
  p.stunT = 0; p.stunMax = 0;
  p.vx = p.vy = 0;
  p.sliding = false;
  p.prone = false; p.hide = 0; p.riseT = 0;
  p.fallT = 0;
  p.swingT = p.swingCd = 0;
  burst(p.x, p.y - 6, TEAMS[p.team].mark, 12, 55, 0.6);
  // kill credit and the feed line: the killer's colours if there is one,
  // otherwise the victim's, since the victim is who the line is about
  const killer = src && src !== p ? src : null;
  p.downedBy = killer ? killer.name : null;
  p.downedTeam = killer ? killer.team : p.team;
  p.downedCause = cause;
  spillInventory(p, killer);
  // the quiver spills where the body fell, same as the wallet: whatever was
  // still in it sticks in the snow for whoever cleans up the fight
  const left = p.quiver; p.quiver = 0;
  for (let i = 0; i < left; i++) {
    const a = rng() * Math.PI * 2, r = rand(4, 14);
    stickArrow({ x: p.x + Math.cos(a) * r, y: p.y - 2 + Math.sin(a) * r, team: p.team },
      Math.cos(a), Math.sin(a));
  }
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
  // a Keep is only a way back while the team's eagle still breathes - a side
  // whose objective has fallen is out, however its slots go down after that
  if (teamHasLivingKeep(p.team) && !teamEagleDown(p.team)) p.respawnT = RESPAWN_TIME;
  else p.eliminated = true;
  if (p === player) endMatch(p.eliminated ? 'lost' : 'respawning');
  else {
    addFloater(p.x, p.y - 20, p.name + (p.eliminated ? ' OUT' : ' DOWN'), TEAMS[p.team].mark);
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
    p.respawnT -= dt;
    if (p.respawnT > 0) continue;
    // the Keep may have fallen mid-timer - re-check rather than cutting the
    // wait short the instant it dies, so a rival can't get credit for
    // eliminating a team faster than the timer promises
    if (teamHasLivingKeep(p.team) && !teamEagleDown(p.team)) respawnPlayer(p);
    else {
      p.eliminated = true;
      if (p === player) endMatch('lost');
      checkLastStanding(); // this fallback can itself be the match-ending blow
    }
  }
}

// brings a downed slot back at its team's Keep: p.reset(false) is the exact
// full-clear a fresh eagle landing gets (same 3s i-frames), just anchored on
// the Keep's mouth instead of a landing tile.
function respawnPlayer(p) {
  const kp = structures.find((o) => o.type === 'keep' && o.team === p.team && !o.building);
  if (kp) { const m = structMouth(kp); p.spawn = nearestDryTile(m.x, m.y, p); }
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

// a team is still "in the match" if it has any active, non-eliminated slot -
// note !eliminated, not !dead: a teammate mid-respawn-timer hasn't left -
// OR a living Keep (see teamHasLivingKeep): a wiped team a Keep is still
// waiting to respawn into hasn't lost either.
function teamInMatch(team) {
  if (teamEagleDown(team)) return false; // the objective: a fallen eagle takes its whole side out
  if (teamHasLivingKeep(team)) return true;
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
// together - a Keep still standing, or a teammate mid-respawn-timer, keeps
// a team in it - so this is the last TEAM standing, not the last player.
function checkLastStanding() {
  // state.eagleCine: the driven-off ceremony is playing - the screens wait
  // for it (eagleFleeResolve re-runs this once the camera has had its moment)
  if (state.over || state.eagleCine || player.eliminated || rivalTeamsInMatch(player) > 0) return;
  endMatch('won');
}

// Both end screens print the same object, so there is one of these rather
// than one per ending: the four tally numbers, the champion it was played in,
// the kit it finished in, and the two facts only one of the screens uses
// (mates for the win's headline, place/by for the loss's).
function endSnapshot() {
  // where the local slot finished: every slot still in the match outlasted
  // it, so place is one past that count. A win is 1st by definition (the
  // screen that prints place never sees a win, but the object shouldn't lie).
  const left = players.filter((q) => q !== player && q.active && !q.eliminated).length;
  return {
    gold: player.xp, kills: player.kills, level: player.level, time: state.elapsed,
    team: player.team, champ: player.champ,
    gear: player.gear.slice(), gearLv: player.gearLv.slice(),
    // a teammate still standing means the TEAM won, and the headline says so
    mates: players.filter((q) => q !== player && q.active && !q.dead && q.team === player.team).length,
    place: player.eliminated ? left + 1 : 1, of: players.filter((q) => q.active).length,
    by: player.downedBy, byTeam: player.downedTeam, cause: player.downedCause,
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
  // an ENDING freezes its numbers here, not in the render pass: the match
  // runs on underneath (a generator can still pay out, a rival can still
  // fall) and a total that climbs behind a tally which already counted it
  // reads as a bug. A loss's summary is opened minutes later, off the LOBBY
  // plank, so this is the only moment its numbers are still true.
  state.end = how === 'won' || how === 'lost' ? endSnapshot() : null;
  if (how === 'won') { SFX.victory(); state.shake = Math.max(state.shake, 4); }
  // the end screen has a song of its own; a respawn timer is not the end of anything
  if (how === 'won' || how === 'lost') SFX.music.play('victory', { in: 1.2 });
  player.input = makeInput(); // whatever was held dies with the slot
}

