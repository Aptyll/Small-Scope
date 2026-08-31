'use strict';
// The weapon: a TOOL on the ONE weapon slot, loaded with BITS that say what
// it fires. A tool is a body - how often it can shoot, how many bits it holds,
// and how heavy a bit it can throw; a bit is a shot, or a modifier that
// rewrites every shot on the tool it sits in. Both are carried items, both
// scatter out of the world, and a tool keeps its bits wherever it goes.
// Keys 1-4 are the class abilities now (js/abilities.js), not slot picks.
// ------------------------------------------------------------ tools & bits
// Ordering: this file needs ITEMS (js/player.js) and RES_COLORS
// (js/structures.js) at LOAD time - it registers one ITEMS entry per tool and
// per bit so the bag, the drop pickup, the death spill and the refusal flash
// are all generic over the new items exactly as they are over a berry. It
// loads after js/actions.js because the shot it spawns is the arrow pipeline's
// and it reads that file's tuning (BOW_Y, QUIVER_MAX, AMBUSH_MUL) at runtime.

// ---- tiers ---------------------------------------------------------------
// A tier is a colour and nothing else in the sim: what a tier BUYS you is
// written into each tool's numbers. The plate is the colour behind the icon -
// the one place tier is stated, in every well the item ever sits in (bag cell,
// tool slot, bit cell, loadout card), which is why nothing has to say "TIER 2".
// The top tier is the only one that moves: a shine sweeps its plate.
const TOOL_TIERS = [
  { name: 'WORN',   plate: '#33241a', rim: '#a3794f', ink: '#d9ad72' },
  { name: 'KEEN',   plate: '#14303f', rim: '#7ac0e8', ink: '#bfe6ff' },
  { name: 'GILDED', plate: '#3a2c0e', rim: '#f2cc6a', ink: '#fff2c0' },
];
const TIER_SHINE = 2; // the tier whose plate animates

// ---- bits ----------------------------------------------------------------
// Two kinds under one table, told apart by `proj`.
//
// A PROJECTILE bit is one shot: `weight` is what the tool has to be strong
// enough to throw (a bit heavier than the tool's tensile is dead weight and is
// skipped), `path` is how it flies, `solid` whether a wall stops it, `ff`
// whether it will hurt your own side, and life/speed/dmg are the baselines the
// tool, the champion kit, the hero level and any modifier bits scale.
// `stick` is whether the spent shot lands as a shaft anyone can pull back out
// - the quiver economy, which every projectile bit spends one of.
// UNITS: `life` is seconds and `speed` px/s, because that is what the sim runs
// in and what every hit test downstream reads. A tool's `rof` is the one
// number counted in game STEPS, since it is a cadence rather than a physical
// quantity - toolRof() is the single place that converts it.
//
// A MODIFIER bit (`proj: false`) has no weight and never flies. Its `mod(m)`
// edits the shot envelope every projectile bit on the SAME tool is fired
// through, so one FLAME in the list sets the whole tool alight. Cells fold in
// whatever order they sit in, so a mod must write values that do not depend on
// the order (a max or a set, never a multiply of what fire is already there) -
// two fire mods in one tool must give the same tool whichever cell holds which.
//
// FIRE is the one damage TYPE a bit can put on a shot (`m.type`, DMG_TYPES in
// js/actions.js): the hit ignites what it lands on, which then burns for
// `m.burn` seconds at `m.burnDps` a second - on a rival, a deer or a worker
// bot alike, because a burn is a unit state like any other.
//
// `path` is one of: 'line' straight | 'zig' weaving | 'orbit' circling the
// shooter | 'boomer' out and back | 'lob' a heavy throw that arcs down.
const BITS = {
  // -- projectiles ---------------------------------------------------------
  arrow: {
    name: 'ARROW', blurb: 'THE PLAIN SHAFT. COMES BACK.', tier: 0, proj: true,
    weight: 2, path: 'line', solid: true, ff: false,
    life: 0.85, speed: 320, dmg: 8, stick: true, col: '#e8dcb4',
  },
  barb: {
    name: 'BARBED SHOT', blurb: 'WEAVES. HITS HARDER.', tier: 0, proj: true,
    weight: 5, path: 'zig', solid: true, ff: false,
    life: 1, speed: 250, dmg: 12, stick: true, col: '#cfd8e8',
  },
  hook: {
    name: 'HOOKSHOT', blurb: 'FLIES OUT AND COMES BACK.', tier: 0, proj: true,
    weight: 3, path: 'boomer', solid: false, ff: false,
    life: 1.5, speed: 260, dmg: 7, stick: false, col: '#9fc4dd',
  },
  care: {
    name: 'CARE ARROW', blurb: 'FAST, PASSES WALLS, LIGHTS THE SNOW.', tier: 1, proj: true,
    weight: 4, path: 'line', solid: false, ff: false,
    life: 0.7, speed: 430, dmg: 13, stick: false, col: '#ffe6a8', lit: 34,
  },
  wisp: {
    name: 'WISP', blurb: 'CIRCLES YOU, LIGHTING THE DARK.', tier: 1, proj: true,
    weight: 3, path: 'orbit', solid: false, ff: false,
    life: 3, speed: 250, dmg: 6, stick: false, col: '#8fd8ff', lit: 40,
  },
  log: {
    name: 'THROWING LOG', blurb: 'SLOW, ARCS DOWN, FLATTENS ANYONE.', tier: 1, proj: true,
    weight: 8, path: 'lob', solid: true, ff: true,
    life: 2.2, speed: 155, dmg: 34, stick: false, col: '#a3794f',
  },
  lance: {
    name: 'ICE LANCE', blurb: 'HEAVY, FLAT AND VERY FAST.', tier: 2, proj: true,
    weight: 7, path: 'line', solid: true, ff: false,
    life: 1.1, speed: 380, dmg: 26, stick: false, col: '#bfe6ff',
  },
  // -- modifiers -----------------------------------------------------------
  speedup: {
    name: 'SPEEDUP', blurb: 'EVERY SHOT FLIES TWICE AS FAST.', tier: 0, proj: false,
    col: '#8fe08a', mod: (m) => { m.spdMul *= 2; },
  },
  fan: {
    name: 'SPLITTER', blurb: 'EVERY SHOT BECOMES THREE, EACH WEAKER.', tier: 0, proj: false,
    col: '#cfe0f2', mod: (m) => { m.fan = 3; m.dmgMul *= 0.6; },
  },
  flame: {
    name: 'FLAME', blurb: 'EVERY SHOT SETS WHAT IT HITS ALIGHT, AND LIGHTS ITS WAY.', tier: 1, proj: false,
    col: '#ff9440',
    mod: (m) => {
      m.type = 'fire';
      m.burn = Math.max(m.burn, BURN_T);
      m.burnDps = Math.max(m.burnDps, BURN_DPS);
      m.dmgAdd += 2;                    // the flat bonus is small now: the burn is the damage
      m.lit = Math.max(m.lit, 30);
    },
  },
  twin: {
    name: 'DUPLICATE', blurb: 'FIRES THE NEXT TWO BITS AT ONCE.', tier: 1, proj: false,
    col: '#a259e6', mod: (m) => { m.twin = true; },
  },
  heft: {
    name: 'HEFT', blurb: 'MUCH HARDER, RATHER SLOWER.', tier: 2, proj: false,
    col: '#f2cc6a', mod: (m) => { m.dmgMul *= 1.6; m.spdMul *= 0.75; },
  },
  longshot: {
    name: 'LONGSHOT', blurb: 'EVERY SHOT FLIES MUCH FURTHER.', tier: 2, proj: false,
    col: '#7ac0e8', mod: (m) => { m.lifeMul *= 1.8; m.spdMul *= 1.15; },
  },
  pyre: {
    name: 'PYRE', blurb: 'THE FIRE TAKES HOLD. IT BURNS TWICE AS LONG, AND TWICE AS HOT.', tier: 2, proj: false,
    col: '#ff5a2a',
    mod: (m) => {
      m.type = 'fire';
      m.burn = Math.max(m.burn, PYRE_T);
      m.burnDps = Math.max(m.burnDps, PYRE_DPS);
      m.lit = Math.max(m.lit, 34);
    },
  },
  cinder: {
    name: 'CINDER BURST', blurb: 'EVERY IMPACT THROWS EMBERS. EVERYTHING AROUND IT CATCHES.', tier: 2, proj: false,
    col: '#ffb347',
    mod: (m) => {
      m.type = 'fire';
      m.burn = Math.max(m.burn, BURN_T);
      m.burnDps = Math.max(m.burnDps, BURN_DPS);
      m.cinder = CINDER_R;              // ...and the ring the shot lights where it ends
      m.lit = Math.max(m.lit, 30);
    },
  },
};
// PYRE's own fire, and how wide a CINDER BURST scatters. The plain fire these
// two escalate is BURN_T / BURN_DPS, in the `status effects` banner of
// js/actions.js beside the burn itself.
const PYRE_T = BURN_T * 2;
const PYRE_DPS = BURN_DPS * 2;
const CINDER_R = 26;   // px of ring an ending shot sets alight

// ---- tools ---------------------------------------------------------------
// `rof` is in game steps between shots (the number the HUD's cooldown wipe
// runs on); `cap` is how many bit cells the tool has; `tensile` is the
// heaviest bit it can throw. `art` picks the 12x12 silhouette, which is baked
// once per tier - so a tool's shape says which family it is and its colour
// says how good it is, the way GEAR_MATS tints one gear icon across levels.
const TOOLS = {
  shortbow: { name: 'SHORTBOW',    tier: 0, rof: 55, cap: 2, tensile: 4, art: 'bow' },
  sling:    { name: 'SLING',       tier: 0, rof: 26, cap: 2, tensile: 3, art: 'sling' },
  recurve:  { name: 'RECURVE BOW', tier: 1, rof: 40, cap: 3, tensile: 6, art: 'recurve' },
  hornbow:  { name: 'HORN BOW',    tier: 1, rof: 34, cap: 4, tensile: 5, art: 'bow' },
  longbow:  { name: 'LONGBOW',     tier: 2, rof: 28, cap: 5, tensile: 9, art: 'recurve' },
};
const TOOL_SLOTS = 1;        // ONE weapon slot: the class weapon, left end of the strip
const TOOL_ROF_STEP = 1 / 60; // a tool's `rof` is counted in game steps of this length

// ---- items: one bag entry per kind ---------------------------------------
// Namespaced keys ('tool:longbow', 'bit:flame') so a kind can never collide
// with a berry or a card. Registering here is what makes the bag, the drop
// pickup, the death spill and the "it does not fit" flash work on tools and
// bits with no code of their own - see checklists.md, "adding a carried item".
// A tool's stack is 1 because it is INSTANCED: its cell carries the bits
// loaded into it, so two of them are never the same object.
function toolType(id) { return 'tool:' + id; }
function bitType(id) { return 'bit:' + id; }
function toolIdOf(type) { return type.startsWith('tool:') ? type.slice(5) : null; }
function bitIdOf(type) { return type.startsWith('bit:') ? type.slice(4) : null; }
function isToolCell(s) { return !!s && !!toolIdOf(s.type); }
function isBitCell(s) { return !!s && !!bitIdOf(s.type); }
// the def behind a cell, whichever kind it is
function toolDefOf(s) { const id = s && toolIdOf(s.type); return id ? TOOLS[id] : null; }
function bitDefOf(s) { const id = s && bitIdOf(s.type); return id ? BITS[id] : null; }
// what tier an item wears, for the plate behind its icon; -1 = not a tool item
function itemTier(type) {
  const t = toolIdOf(type); if (t) return TOOLS[t].tier;
  const b = bitIdOf(type); if (b) return BITS[b].tier;
  return -1;
}

// ---- a tool instance -----------------------------------------------------
// A tool in the bag, in a slot, or lying in the snow is the same object: a bag
// cell with a `bits` array of its own. Nothing ever copies it, which is why
// throwing a loaded tool away throws the bits with it.
function makeTool(id) {
  return { type: toolType(id), n: 1, bits: new Array(TOOLS[id].cap).fill(null), idx: 0 };
}
// the tool on the slot p is pointing at right now, or null
function heldTool(p) { return p.tools ? p.tools[p.toolSel] || null : null; }
// how many bit cells are filled - the pips the HUD counts
function bitsIn(cell) { let n = 0; for (const b of cell.bits) if (b) n++; return n; }
// a bit too heavy for the tool it sits in is dead weight: it stays in the
// cell (you can see it, and see that it is wrong) but is skipped when firing
function bitFires(cell, i) {
  const id = cell.bits[i];
  if (!id) return false;
  const b = BITS[id];
  return b.proj && b.weight <= TOOLS[toolIdOf(cell.type)].tensile;
}
// The shot envelope: every modifier bit in the tool, folded once. Projectile
// bits are fired THROUGH this, which is the whole "a modifier affects every
// projectile on this tool" rule in one function.
function toolMods(cell) {
  const m = {
    spdMul: 1, dmgMul: 1, dmgAdd: 0, lifeMul: 1, fan: 1, twin: false, lit: 0,
    // the shot's damage TYPE and the fire it carries: 'blunt' until a fire
    // modifier says otherwise (DMG_TYPES, js/actions.js)
    type: 'blunt', burn: 0, burnDps: 0, cinder: 0,
  };
  for (const id of cell.bits) {
    const b = id && BITS[id];
    if (b && !b.proj && b.mod) b.mod(m);
  }
  return m;
}
// The firing order, and the index tracker the user sees on the bit column:
// walk forward from cell.idx, wrapping once, and take the first bit that can
// actually be thrown. The tracker lands one past what it found, so the next
// press picks up where this one left off and the list cycles.
function nextBit(cell) {
  const n = cell.bits.length;
  for (let k = 0; k < n; k++) {
    const i = (cell.idx + k) % n;
    if (bitFires(cell, i)) { cell.idx = (i + 1) % n; return { id: cell.bits[i], i }; }
  }
  return null;
}
// what the bit column marks as up next, without advancing anything
function peekBit(cell) {
  const n = cell.bits.length;
  for (let k = 0; k < n; k++) {
    const i = (cell.idx + k) % n;
    if (bitFires(cell, i)) return i;
  }
  return -1;
}
// seconds between shots: the tool's own rate, quickened by everything that
// already quickens a renock (QUICKDRAW, the LOOSE ability, QUICK HANDS)
function toolRof(p, cell) {
  return TOOLS[toolIdOf(cell.type)].rof * TOOL_ROF_STEP * (kitOf(p).nock / BOW_NOCK);
}

// Can the button do anything at all right now? A slot with no tool in it and a
// tool with no bit light enough to throw are both as dry as an empty quiver,
// and updatePlayer gates the draw on all three the same way.
function toolReady(p) {
  const cell = heldTool(p);
  return !!cell && peekBit(cell) >= 0;
}
// Whether the weapon's bit column is up: HOVER over the weapon well raises
// it, and it stays up while the pointer is on the risen column itself (or
// while a bit is being carried anywhere - the column is where a bit goes).
// Derived every read, never stored, so it can never disagree with where the
// pointer actually is; `bitColHover` only remembers that it was open, which
// is what lets the pointer climb the column without it snapping shut.
let bitColHover = false;
function bitEditSlot() {
  if (!player || state.mode !== 'play' || player.dead) { bitColHover = false; return -1; }
  const cell = player.tools[0];
  if (!cell) { bitColHover = false; return -1; }
  if (state.drag && bitIdOf(state.drag.cell.type)) return 0;
  if (!mouse.inside) { bitColHover = false; return -1; }
  const r = toolCellRect(0);
  let over = mouse.x >= r.x - 2 && mouse.x < r.x + r.w + 2 &&
    mouse.y >= r.y - 3 && mouse.y < r.y + r.h + 3;
  if (!over && bitColHover) {
    const top = bitColRect(0, cell.bits.length - 1);
    over = mouse.x >= top.x - 8 && mouse.x < top.x + top.w + 8 &&
      mouse.y >= top.y - 6 && mouse.y < r.y + r.h;
  }
  bitColHover = over;
  return over ? 0 : -1;
}

// ---- equipping -----------------------------------------------------------
// Every move of a tool or a bit goes through these two, so a cell is never in
// two places at once. Both return the thing displaced, for the caller to put
// somewhere (the drag drops it back where it came from).
function slotPut(p, i, cell) {
  const was = p.tools[i];
  p.tools[i] = cell || null;
  return was;
}
function bitPut(cell, i, id) {
  const was = cell.bits[i];
  cell.bits[i] = id || null;
  if (cell.idx >= cell.bits.length) cell.idx = 0;
  return was;
}

// ---- what a tool fires ---------------------------------------------------
// One press = one activation of the selected tool. A projectile bit spends an
// arrow from the quiver (the pillar holds: shots are finite, and a bit that
// leaves a shaft is one you can walk over and get back), the tool's rate of
// fire sets the gap to the next press, and DUPLICATE is the one modifier that
// changes how many bits an activation consumes rather than what they do.
function fireTool(p) {
  // the cover is read before anything below can break it - the ambush shot is
  // what the crawl in was for, whatever bit is loaded
  const amb = ambushReady(p);
  // bow-fishing survives the new weapon: any tool, standing on ice with a
  // fish underfoot, spears it through the sheet instead of loosing
  if (spearFish(p)) return;
  const cell = heldTool(p);
  if (!cell) { dryFire(p); return; }          // an empty slot has nothing to press
  const T = TOOLS[toolIdOf(cell.type)];
  const m = toolMods(cell);
  const shots = m.twin ? 2 : 1;
  let fired = 0;
  for (let s = 0; s < shots; s++) {
    if (p.quiver <= 0) break;
    const nb = nextBit(cell);
    if (!nb) break;                            // no bit this tool can throw
    p.quiver = Math.max(0, p.quiver - 1);
    emitBit(p, BITS[nb.id], nb.id, m, amb, s);
    fired++;
  }
  if (!fired) { dryFire(p); return; }          // pressed a tool that cannot answer
  p.nockT = toolRof(p, cell);
  if (nearPlayer(p.x, p.y)) SFX.arrow();
  // the loose is what breaks cover - one ambush per burrow, then you are a
  // player lying in the open with a tool that still has to cycle
  risePlayer(p);
}

// One projectile bit, put into the air. `seq` is which shot of a DUPLICATE
// pair this is, so the second leaves at a hair of an angle instead of exactly
// inside the first.
function emitBit(p, b, id, m, amb, seq) {
  const kit = kitOf(p);
  const pw = Math.min(1, Math.max(0.18, p.chargeT / kit.bowCharge));
  const spdBonus = kit.spdDmg * Math.min(1, Math.hypot(p.vx, p.vy) / 200);
  // aim from the spawn point (BOW_Y above the feet), not the feet: otherwise
  // the flight runs parallel to the aim line and never meets it
  const dx = p.input.aimX - p.x, dy = p.input.aimY - (p.y - BOW_Y);
  const base = Math.atan2(dy, dx);
  // the draw still matters, but the bit is what is being thrown: its own
  // numbers lead, and the champion kit, the hero level and the modifiers are
  // what the player brought to it
  const pwScale = 0.55 + 0.45 * pw;
  let dmg = (b.dmg + kit.dmgPow * pw * 0.5) * pwScale + kit.dmgBase + spdBonus + LVL_DMG * (p.level - 1);
  dmg = Math.round(dmg * m.dmgMul + m.dmgAdd);
  if (amb) dmg = Math.round(dmg * kit.ambushMul);
  const spd = b.speed * m.spdMul;
  const life = b.life * m.lifeMul;
  const lit = Math.max(b.lit || 0, m.lit);
  // SPLITTER turns one bit into a fan; every other shot is a single arm of it
  const arms = m.fan;
  const spread = 0.16;
  for (let k = 0; k < arms; k++) {
    const a = base + (arms > 1 ? (k - (arms - 1) / 2) * spread : 0) + (seq ? 0.07 : 0);
    arrows.push({
      x: p.x, y: p.y - BOW_Y,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      t: 0, life, dmg, pow: pw,
      owner: p.id, team: p.team,
      ambush: amb,
      trailD: 0,
      // what makes this a bit rather than the old arrow: how it flies, what
      // stops it, who it is allowed to hurt, and what it leaves behind
      bit: id, path: b.path, solid: b.solid !== false, ff: !!b.ff,
      stick: !!b.stick, lit, col: b.col,
      // what it does when it lands: the damage type, the fire it leaves in
      // the body, and the ring it sets alight where it ends
      type: m.type, burn: m.burn, burnDps: m.burnDps, cinder: m.cinder,
      ang: a, spd, ox: p.x, oy: p.y - BOW_Y,
    });
  }
  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else p.dir = dy > 0 ? 'down' : 'up';
}

// Bow-fishing, lifted out of the old fireArrow so every tool keeps it: on ice
// with a fish in reach, the press spears through the sheet instead. Returns
// true when it took the press. Two players can reach one fish in a step, so
// the catch is contested rather than first-come.
function spearFish(p) {
  const ftx = Math.floor(p.x / TILE), fty = Math.floor((p.y + 4) / TILE);
  if (!inWorld(ftx, fty) || ground[idx(ftx, fty)] !== 1) return false;
  let bi = -1, bd = FISH_CATCH_R;
  for (let i = 0; i < fish.length; i++) {
    if (!fish[i].born) continue; // still swimming in from under the shore
    const d = Math.hypot(fish[i].x - p.x, fish[i].y - p.y);
    if (d < bd) { bd = d; bi = i; }
  }
  if (bi < 0) return false;
  // a full bag refuses the catch rather than spearing a fish into nowhere:
  // the motion is spent, and the fish stays under the ice
  if (bagRoom(p, 'fish') <= 0) {
    if (p === player) bagDenied();
    p.nockT = kitOf(p).nock;
    return true;
  }
  const f = fish[bi];
  contest('fish:' + bi, p, () => {
    const j = fish.indexOf(f);
    if (j < 0) return;
    fish.splice(j, 1);
    bagAdd(p, 'fish', 1);
    addFloater(f.x, f.y - 10, 'FISH!', '#7ac0e8');
    burst(f.x, f.y, '#9fc4dd', 8, 45, 0.45, true);
    burst(f.x, f.y, '#ddf1f8', 5, 35, 0.4, true);
    if (nearPlayer(f.x, f.y)) { SFX.splash(); SFX.stash(); }
  });
  p.nockT = kitOf(p).nock;
  return true;
}

// ---- how a bit flies -----------------------------------------------------
// Called once per shot per sim step, BEFORE the step is integrated, so the
// path owns the velocity and everything downstream (the trail, the hit tests,
// the drawn body) just follows it. 'line' is the old arrow and costs nothing.
const ZIG_HZ = 9;      // weaves per second
const ZIG_SWING = 0.5; // rad either side of the bearing
const ORBIT_R = 46;    // px the wisp circles its shooter at
const LOB_DRAG = 0.55; // per second: how fast a thrown log gives up its speed
const LOB_FALL = 210;  // px/s^2 the same log is pulled down at
function steerBit(a, dt) {
  if (!a.path || a.path === 'line') return;
  if (a.path === 'zig') {
    const w = a.ang + Math.sin(a.t * ZIG_HZ * Math.PI * 2) * ZIG_SWING;
    a.vx = Math.cos(w) * a.spd; a.vy = Math.sin(w) * a.spd;
    return;
  }
  if (a.path === 'lob') {
    a.vx *= Math.pow(LOB_DRAG, dt);
    a.vy = a.vy * Math.pow(LOB_DRAG, dt) + LOB_FALL * dt;
    return;
  }
  if (a.path === 'boomer') {
    // out on the bearing, slowing, then hauled back to whoever threw it
    const o = players[a.owner];
    const half = a.life * 0.45;
    if (a.t < half) {
      const e = 1 - a.t / half;
      a.vx = Math.cos(a.ang) * a.spd * e; a.vy = Math.sin(a.ang) * a.spd * e;
    } else if (o) {
      const dx = o.x - a.x, dy = (o.y - BOW_Y) - a.y, d = Math.hypot(dx, dy) || 1;
      a.vx = dx / d * a.spd; a.vy = dy / d * a.spd;
      if (d < 8) a.t = a.life; // home: the flight is over
    }
    return;
  }
  if (a.path === 'orbit') {
    // a ring around the shooter, kept at ORBIT_R and swept at its own speed
    const o = players[a.owner];
    if (!o) return;
    const cx = o.x, cy = o.y - BOW_Y;
    const ang = Math.atan2(a.y - cy, a.x - cx) + (a.spd / ORBIT_R) * dt;
    const r = a.t < 0.25 ? ORBIT_R * (a.t / 0.25) : ORBIT_R;
    const nx2 = cx + Math.cos(ang) * r, ny2 = cy + Math.sin(ang) * r;
    a.vx = (nx2 - a.x) / Math.max(dt, 1e-4);
    a.vy = (ny2 - a.y) / Math.max(dt, 1e-4);
  }
}

// ---- the tech tree -------------------------------------------------------
// Every tool and every bit is a node, and every node is UNLOCKED. The world
// is allowed to drop the whole arsenal for anybody, so a profile on its first
// flight rolls exactly what one a hundred matches old rolls: nothing here is
// earned, priced or spent, and a match reads nothing back out of a profile.
// The tree is the PICTURE of the arsenal - lineages of at most three, each
// kind beside the kinds it is a step from - and `seen`, "this profile has
// held one of these", is the one mark on it that is about you rather than
// about the arsenal. It gates nothing; it is a record of what you have
// actually met in the snow.
//
// Storage is js/profile.js and nothing here writes a key.
// The tree, in draw order down each tier column. `req` is the node beneath
// this one - null on the tier-0 row - and is the only edge in the graph, so
// the picture and the lineage are the same thing.
const TECH = [
  // tier 0: the roots every branch grows out of
  { id: 'tool:shortbow', req: null },
  { id: 'tool:sling',    req: null },
  { id: 'bit:arrow',     req: null },
  { id: 'bit:barb',      req: null },
  { id: 'bit:hook',      req: null },
  { id: 'bit:speedup',   req: null },
  { id: 'bit:fan',       req: null },
  // tier 1: one step off a root
  { id: 'tool:recurve',  req: 'tool:shortbow' },
  { id: 'tool:hornbow',  req: 'tool:sling' },
  { id: 'bit:care',      req: 'bit:arrow' },
  { id: 'bit:wisp',      req: 'bit:hook' },
  { id: 'bit:log',       req: 'bit:barb' },
  { id: 'bit:flame',     req: 'bit:speedup' },
  { id: 'bit:twin',      req: 'bit:fan' },
  // tier 2: the end of each branch
  { id: 'tool:longbow',  req: 'tool:recurve' },
  { id: 'bit:lance',     req: 'bit:care' },
  { id: 'bit:heft',      req: 'bit:log' },
  { id: 'bit:longshot',  req: 'bit:wisp' },
  { id: 'bit:pyre',      req: 'bit:flame' },  // the fire line, escalated
  { id: 'bit:cinder',    req: 'bit:twin' },   // ...and the multiplying line, ending in one
];
const TECH_BY_ID = {};
for (const n of TECH) TECH_BY_ID[n.id] = n;
// "this profile has held one of these" - fired from the local player's pickup
// and from the loadout they fly in with, and nothing reads it but the tree
function noteSeen(p, type) {
  if (p === player && TECH_BY_ID[type]) PROFILE.markSeen(type);
}

// ---- loot: what the world pays out --------------------------------------
// Tools and bits are found, not bought. A broken rock is the common source and
// a felled tree the rare one, both rolling on the shared rng at the moment the
// swing lands (never inside genWorld - see the seed rule in CLAUDE.md). Only
// the bottom tier lies around loose; the good stuff is in the chests.
const ROCK_DROP = 0.2;   // 1 in 5 broken rocks
const TREE_DROP = 0.04;  // 1 in 25 felled trees
const CHEST_TOOL = 0.75; // ...and three in four sprung chests, at the TOP tier
const LOOT_TOOL = 0.3;   // this share of any of those is a tool, the rest bits
// Every kind at or under `tier`, split into the two pools. The whole arsenal
// is unlocked, so this is one list per tier built at boot rather than a filter
// run per roll - a drop happens in the middle of a swing. The array itself is
// never replaced - dropLoot holds it.
const LOOT_POOL = [];
function rebuildLootPool() {
  LOOT_POOL.length = 0;
  for (let t = 0; t < TOOL_TIERS.length; t++) {
    LOOT_POOL.push({
      tools: Object.keys(TOOLS).filter((k) => TOOLS[k].tier <= t),
      bits: Object.keys(BITS).filter((k) => BITS[k].tier <= t),
    });
  }
}
// Rolls one find at `tier` or below and drops it at (x, y); returns what it
// dropped, or null. A tool comes out empty - its bits are the next thing to
// find - and a bit drops as a single, so a pack of them is a run of finds.
function dropLoot(x, y, tier, chance) {
  if (rng() >= chance) return null;
  const pool = LOOT_POOL[Math.max(0, Math.min(LOOT_POOL.length - 1, tier))];
  if (!pool || !pool.tools.length || !pool.bits.length) return null;
  if (rng() < LOOT_TOOL) {
    const id = pool.tools[Math.floor(rng() * pool.tools.length)];
    spawnDrop(x, y, toolType(id), 1, makeTool(id));
    addFloater(x, y - 26, TOOLS[id].name, TOOL_TIERS[TOOLS[id].tier].ink);
    burst(x, y - 6, TOOL_TIERS[TOOLS[id].tier].rim, 10, 50, 0.6, true);
    return id;
  }
  const id = pool.bits[Math.floor(rng() * pool.bits.length)];
  spawnDrop(x, y, bitType(id), 1);
  addFloater(x, y - 26, BITS[id].name, TOOL_TIERS[BITS[id].tier].ink);
  burst(x, y - 6, BITS[id].col, 8, 45, 0.5, true);
  return id;
}

// ---- starting loadouts ---------------------------------------------------
// Every slot flies in with its class's tool in the one weapon slot, its
// class's own bits in it, which is what makes the pick a choice rather than
// a preview: the two classes do not shoot the same thing. Called from
// initPlayers() and again whenever the local slot changes class at select.
const CLASS_LOADOUT = [
  { tool: 'shortbow', bits: ['arrow', 'barb'] }, // HUNTER: the plain shaft, and a heavier one
  { tool: 'sling',    bits: ['arrow', 'heft'] }, // WARRIOR: close-in, and hitting like a fist
];
function giveLoadout(p) {
  p.tools = new Array(TOOL_SLOTS).fill(null);
  p.toolSel = 0;
  const L = CLASS_LOADOUT[p.cls] || CLASS_LOADOUT[0];
  const cell = makeTool(L.tool);
  for (let i = 0; i < L.bits.length && i < cell.bits.length; i++) cell.bits[i] = L.bits[i];
  p.tools[0] = cell;
  // what you fly in with counts as met, so the tree opens on the kinds you
  // have actually held rather than only on what you have picked off the snow
  noteSeen(p, cell.type);
  for (const b of L.bits) noteSeen(p, bitType(b));
}

// ---- a bot fitting what it has found -------------------------------------
// A bot has no bit column and no pointer, so it does by hand the two things a
// person does with a drag: push loose bits into the tool it is actually
// firing, and put a spare tool on a free key (or over a worse one, which then
// takes the bag cell the new one came out of). Without this a bot walks the
// rest of the match carrying a longbow in its backpack.
//
// It only takes bits that fly TOWARD what they were aimed at - a bot cannot
// read a boomerang or an orbit, so it leaves those for someone who can.
function botFitLoadout(p) {
  const cur = heldTool(p);
  if (cur) {
    const tens = TOOLS[toolIdOf(cur.type)].tensile;
    for (let i = 0; i < p.bag.length; i++) {
      const s = p.bag[i];
      const id = s && bitIdOf(s.type);
      if (!id) continue;
      const b = BITS[id];
      if (b.proj && (b.weight > tens || (b.path !== 'line' && b.path !== 'zig' && b.path !== 'lob'))) continue;
      let free;
      while (s.n > 0 && (free = cur.bits.indexOf(null)) >= 0) {
        cur.bits[free] = id;
        if (--s.n <= 0) p.bag[i] = null;
      }
      if (cur.bits.indexOf(null) < 0) break;
    }
  }
  for (let i = 0; i < p.bag.length; i++) {
    const s = p.bag[i];
    if (!isToolCell(s)) continue;
    let slot = p.tools.indexOf(null);
    if (slot < 0) { // no free key: trade up over the weakest body, or leave it
      let worst = -1, wt = 99;
      for (let k = 0; k < p.tools.length; k++) {
        const t = TOOLS[toolIdOf(p.tools[k].type)].tier;
        if (t < wt) { wt = t; worst = k; }
      }
      if (worst < 0 || TOOLS[toolIdOf(s.type)].tier <= wt) continue;
      slot = worst;
    }
    p.bag[i] = p.tools[slot] || null;
    p.tools[slot] = s;
  }
  // and always be pointing at a key that can answer the button
  if (!toolReady(p)) {
    for (let k = 0; k < p.tools.length; k++) {
      if (p.tools[k] && peekBit(p.tools[k]) >= 0) { p.toolSel = k; break; }
    }
  }
}

// ---- icons ---------------------------------------------------------------
// The art bakes HERE and not in js/sprites.js, which is byte-fragile (BOM,
// mangled-byte repair) and is never rewritten - the same reason the treasure
// chest bakes beside its draw pass. Tools are 12x12 (they sit in a HUD well
// and in a hand); bits are 8x8 like every other carried item.
//
// A tool's SHAPE says which family it is and its PALETTE says its tier, so
// three silhouettes cover five tools across three tiers - the way one gear
// icon covers four materials. Tier colour lands on 'm' (the metal/limb) and
// 'M' (its highlight); the grip and string stay the same on every tier.
// 'm' is the shaded side of the limb and 'M' its lit side, so the two together
// are both the silhouette and its own rim; 's' is the string and the shaft it
// looses, 'W' the head. Only m and M change per tier.
const TOOL_ART_PAL = [
  { m: '#6b4a30', M: '#a3794f' }, // WORN: wood
  { m: '#3f7aa0', M: '#bfe6ff' }, // KEEN: frost steel
  { m: '#b98a2e', M: '#ffe08a' }, // GILDED: gold
];
const TOOL_ART = {
  bow: [ // a plain D-bow: limbs bowing left, string taut, arrow nocked right
    '........mM..',
    '......mM.s..',
    '....mM...s..',
    '..mM.....s..',
    '.mM......s..',
    '.mM.sssssssW',
    '.mM......s..',
    '..mM.....s..',
    '....mM...s..',
    '......mM.s..',
    '........mM..',
    '............',
  ],
  recurve: [ // the same bow with the limb tips flicked back the other way
    '.........Mm.',
    '........mM..',
    '......mM.s..',
    '....mM...s..',
    '...mM....s..',
    '..mM.ssssssW',
    '...mM....s..',
    '....mM...s..',
    '......mM.s..',
    '........mM..',
    '.........Mm.',
    '............',
  ],
  sling: [ // a forked stick, two cords and a stone in the cradle
    '.mM......Mm.',
    '.mMs....sMm.',
    '.mM.s..s.Mm.',
    '.mM..oo..Mm.',
    '..mM.oo.Mm..',
    '...mM..Mm...',
    '....mMMm....',
    '.....mM.....',
    '.....mM.....',
    '.....mM.....',
    '....omMo....',
    '............',
  ],
};
// 8x8 bit glyphs. Each says what the bit DOES by shape - a head and fletching
// for the plain arrow, a spiral for the wisp, a chevron stack for SPEEDUP -
// because the plate behind it is already spending the colour on tier.
const BIT_ART = {
  arrow: [
    '.......s', '......ss', '.....sSs', '....sSs.',
    '..fsSs..', '.ffSs...', 'ff.s....', 'f.......',
  ],
  barb: [
    '......ss', '.....sSs', '..s.sSs.', '.sSssS..',
    '..sSSs..', '.ssSs...', 'fs.s....', 'f.......',
  ],
  hook: [
    '..sss...', '.so.os..', 'so...os.', 'so......',
    'so...ss.', '.so.sSs.', '..sssSs.', '.....ss.',
  ],
  care: [
    '...gg...', '..gGGg..', '.gG..Gg.', 'gG.gg.Gg',
    'gG.gg.Gg', '.gG..Gg.', '..gGGg..', '...gg...',
  ],
  wisp: [
    '...ii...', '..i..i..', '.i.ii.i.', 'i.iIi.i.',
    'i.iii.i.', '.i....i.', '..i..i..', '...ii...',
  ],
  log: [
    '..wwww..', '.wWWWWw.', 'wWvvvvWw', 'wWvWWvWw',
    'wWvWWvWw', 'wWvvvvWw', '.wWWWWw.', '..wwww..',
  ],
  lance: [
    '.......i', '......iI', '.....iI.', '....iI..',
    '...iI...', '..iI....', '.iI.....', 'iI......',
  ],
  speedup: [
    '..n...n.', '.nGn.nGn', 'nGn.nGn.', 'Gn...Gn.',
    'nGn.nGn.', '.nGn.nGn', '..n...n.', '........',
  ],
  fan: [
    '......sS', '.....s..', '....s...', 'sssssssS',
    '....s...', '.....s..', '......sS', '........',
  ],
  flame: [
    '...f....', '..fFf...', '.fFFFf..', 'fFFhFFf.',
    'fFhhhFf.', 'fFFhFFf.', '.fFFFf..', '..fff...',
  ],
  twin: [
    '..pp.pp.', '.pPp.pPp', '.pPp.pPp', '.pPp.pPp',
    '.pPp.pPp', '.pPp.pPp', '.pPp.pPp', '..pp.pp.',
  ],
  heft: [
    '..oooo..', '.oggggo.', 'ogGGGGgo', 'ogGhhGgo',
    'ogGhhGgo', 'ogGGGGgo', '.oggggo.', '..oooo..',
  ],
  longshot: [
    '........', '......iI', '.....iII', 'iiiiiiII',
    '.....iII', '......iI', '........', '........',
  ],
  // PYRE: FLAME's one tongue grown into a banked fire - a deep red body with
  // a white heart, standing on two logs, so the escalation reads at a glance
  pyre: [
    '...F....', '..FhF...', '.RFhFR..', 'RFhhhFR.',
    'RFhhhFR.', '.RFhFR..', '.wWWWw..', '..wWw...',
  ],
  // CINDER BURST: a hot centre throwing sparks to every corner - the
  // multiplying line's ending, said in fire
  cinder: [
    'f...f...', '.f.f..f.', '..FfF...', '.FfhfF.f',
    '..FfF...', '.f.f....', 'f..f..f.', '....f...',
  ],
};
const BIT_PAL = {
  '.': null, o: '#241a12', s: '#cfd8e8', S: '#8b93a8',
  f: '#ff9440', F: '#ffd95c', h: '#fff2c0', R: '#ff5a2a',
  w: '#6b4a30', W: '#a3794f', v: '#d9ad72',
  i: '#8fd8ff', I: '#4a90e2', g: '#f2cc6a', G: '#ffe08a',
  n: '#5fd18a', p: '#a259e6', P: '#d6b6ff',
};
// paint a char grid onto its own canvas, the one-off bake this file shares
function bakeGrid(rows, pal, w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => {
    for (let x = 0; x < w; x++) {
      const col = pal[r[x]];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
  });
  return c;
}
// tool art, one canvas per (shape, tier), onto SPRITES so the generic
// `SPRITES[ITEMS[type].icon]` draw in the bag and the drop pass needs no
// special case for the new items
for (const art in TOOL_ART) {
  for (let t = 0; t < TOOL_TIERS.length; t++) {
    const pal = Object.assign({ '.': null, o: '#241a12', s: '#e8dcb4', W: '#ffffff', g: '#6b4a30', G: '#a3794f' },
      TOOL_ART_PAL[t]);
    SPRITES['toolArt_' + art + '_' + t] = bakeGrid(TOOL_ART[art], pal, 12);
  }
}
for (const id in BIT_ART) SPRITES['bitArt_' + id] = bakeGrid(BIT_ART[id], BIT_PAL, 8);
// and the ITEMS/RES_COLORS rows that make them carryable
for (const id in TOOLS) {
  const T = TOOLS[id];
  ITEMS[toolType(id)] = { icon: 'toolArt_' + T.art + '_' + T.tier, stack: 1, iw: 12 };
  RES_COLORS[toolType(id)] = TOOL_TIERS[T.tier].ink;
}
for (const id in BITS) {
  ITEMS[bitType(id)] = { icon: 'bitArt_' + id, stack: 4, iw: 8 };
  RES_COLORS[bitType(id)] = BITS[id].col;
}
