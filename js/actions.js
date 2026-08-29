'use strict';
// What a player does: click/E/space resolved - the swing tools and what they
// harvest, the quiver and its spent shafts, the roll as a hit, prone, and one
// blow against anything built, each with its own tuning above it. What the
// LEFT button fires is a tool on one of the four slots: js/tools.js.
// ------------------------------------------------------------ actions
// Every action takes the player performing it, so the local human, an AI fill
// and a future network peer all reach the world through the same calls.

// The three infinite SWING tools - what E has in hand, never what the button
// fires. Not player-selectable: E auto-swaps to the axe / pick for whatever is
// under the cursor, and the slot's weapon comes back the moment the swing ends.
// The player-selectable weapons are the four slots in TOOLS (js/tools.js).
const SWING_TOOLS = [
  // the 'bow' row is the AT REST state, not a thing that draws: drawHeldTool
  // puts the weapon on the selected slot in the hands instead, so this entry's
  // `icon` is unread (SPRITES.itemBow is still live on the end screen's kills
  // plate). Kept so the table stays one row per p.swing value.
  { key: 'bow',  name: 'BOW',     icon: 'itemBow' },
  { key: 'axe',  name: 'AXE',     icon: 'itemAxe' },
  { key: 'pick', name: 'PICKAXE', icon: 'itemPick' },
];
const SWING_BOW = 0, SWING_AXE = 1, SWING_PICK = 2;
const BOW_Y = 6;          // arrows spawn (and are aimed from) this far above the player's feet
// The quiver: arrows are a resource, not an infinite stream. A shot spends one
// and starts the nock cooldown (the kit's `nock`, so a champion's draw speed
// sets its own rhythm); an empty quiver fletches one back every QUIVER_REGEN,
// and every arrow that ends its flight sticks in the snow to be pulled out
// again. Fletching alone is the floor - retrieval is how a good shot stays armed.
const QUIVER_MAX = 6;     // arrows carried
const QUIVER_REGEN = 2.4; // seconds to fletch one arrow back (only ticks below max)
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

// left click fires the selected tool slot: the press only records the intent
function clickAction(p) {
  SFX.unlock();
  p.input.fire = true;
}

// what E would work right now for p: the tile p is aiming at, if it holds
// something a tool can harvest (bare ice counts, for the pick). Shared by
// tryWork(), the AI and the cursor, so the lock ring can never lie about E.
function workTarget(p) {
  const tx = Math.floor(p.input.aimX / TILE), ty = Math.floor(p.input.aimY / TILE);
  if (!inWorld(tx, ty)) return null;
  const o = objects[idx(tx, ty)];
  let t = -1;
  if (o) {
    // a building (any tile of its footprint - `part` resolves to the anchor) is a
    // target only for the other team; you take your own down from the wheel instead
    const st = structOf(o);
    if (STRUCTS[st.type]) { if (!ownsStruct(st, p)) t = SWING_AXE; }
    else {
      // scenery answers from its OBJECTS entry: `tool` is what E reaches for,
      // and `ready` (the bush's berries) is what decides it is worth reaching.
      // An object carrying a `team` (a roosting eagle's hitbox tiles) is a
      // rival-only target, the same rule a building answers above.
      const d = OBJECTS[o.type];
      if (d && d.tool && (!d.ready || d.ready(o)) &&
        (o.team === undefined || o.team !== p.team)) t = d.tool === 'pick' ? SWING_PICK : SWING_AXE;
    }
  } else if (ground[idx(tx, ty)] === 1) t = SWING_PICK;
  if (t < 0) return null;
  // tile-based, not a radius: only the ring of tiles around the one you stand on
  const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
  const near = Math.max(Math.abs(tx - ptx), Math.abs(ty - pty)) <= WORK_REACH;
  return { o, tx, ty, tool: t, near };
}

// the fish under the cursor, if any (their bodies are ~10x5, so a 7px disc)
function hoverFish() {
  const wx = mouseWX(), wy = mouseWY();
  for (const f of fish) if (f.born && Math.hypot(f.x - wx, f.y - wy) < 7) return f;
  return null;
}
// bow-fishing works when the player stands on ice with the fish in FISH_CATCH_R
function fishInRange(f, p) {
  p = p || player;
  const ftx = Math.floor(p.x / TILE), fty = Math.floor((p.y + 4) / TILE);
  return f.born && inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1 &&
    Math.hypot(f.x - p.x, f.y - p.y) < FISH_CATCH_R;
}

// E: swing the right tool at the cursor's tile. Held E repeats every swing
// cooldown; the bow comes back on its own once the cooldown runs out.
function tryWork(p) {
  if (p.swingCd > 0 || p.fallT > 0 || p.dodgeT > 0 || p.stunT > 0 ||
    p.castT > 0 || p.rushT > 0 || p.shieldT > 0 || p.eatT > 0) return; // both hands are on the ability, or on the meal
  if (p.prone) { risePlayer(p); return; } // no swinging an axe on your belly: E stands you up
  const t = workTarget(p);
  if (!t || !t.near) return;
  if (p.charging) { p.charging = false; p.chargeT = 0; } // work drops the draw
  p.fireArmed = false;                                     // ...and the held button has to be pressed again
  p.swing = t.tool;
  p.workTx = t.tx; p.workTy = t.ty;
  const dx = t.tx * TILE + 8 - p.x, dy = t.ty * TILE + 8 - p.y;
  p.swingDir = Math.atan2(dy, dx);
  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else p.dir = dy > 0 ? 'down' : 'up';
  p.swingT = 0.18;
  p.swingCd = 0.34;
  p.swingHitDone = false;
  if (nearPlayer(p.x, p.y)) SFX.swing();
}

// dodge roll: dash with i-frames in the held movement direction (8-way),
// falling back to the facing direction when no key is down
function tryDodge(p) {
  if (p.dodgeT > 0 || p.dodgeCharges <= 0 || p.fallT > 0 || p.dead || p.stunT > 0 ||
    p.rootT > 0 || p.rushT > 0) return; // a trap pins the roll too, and a charge is already a dash
  risePlayer(p); // a roll is the fast way out of the snow, and it costs a charge
  breakEat(p);   // ...and out of a meal: the roll is the one way YOU end your own channel
  let dx = p.input.mx, dy = p.input.my;
  if (!dx && !dy) {
    dx = p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0;
    dy = p.dir === 'up' ? -1 : p.dir === 'down' ? 1 : 0;
  }
  const d = Math.hypot(dx, dy) || 1;
  // impulse into the shared velocity: a dash never slows you below the speed
  // you already carry, so on ice dashes chain into real speed
  const v = Math.max(kitOf(p).dodgeSpeed, Math.hypot(p.vx, p.vy));
  p.dodgeVX = dx / d * v; // kept for the roll spin/ghost render
  p.dodgeVY = dy / d * v;
  p.vx = p.dodgeVX;
  p.vy = p.dodgeVY;
  p.dodgeT = DODGE_T;
  p.dodgeDustT = 0;
  p.rollHit.length = 0; // a new roll may swipe everything again, once each
  // remember the fill level before the spend so the bar can ghost the lost chunk
  const regenP = p.dodgeCharges < DODGE_CHARGES ? 1 - p.dodgeRegenT / kitOf(p).dodgeCd : 0;
  p.stamGhost = Math.max(p.stamGhost, (p.dodgeCharges + regenP) / DODGE_CHARGES);
  p.stamGhostT = 0.3;
  p.dodgeCharges--;
  if (p.dodgeRegenT <= 0) p.dodgeRegenT = kitOf(p).dodgeCd; // DANCER shortens the refill
  p.invuln = Math.max(p.invuln, DODGE_T + 0.05);
  p.kbx = p.kby = 0;
  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else if (dy !== 0) p.dir = dy > 0 ? 'down' : 'up';
  burst(p.x, p.y + 4, '#dfe8f4', 6, 40, 0.35, true);
  if (nearPlayer(p.x, p.y)) SFX.dodge();
}

// ---- the roll as a hit ---------------------------------------------------
// A dash is a body thrown at whatever is in front of it. updatePlayer's roll
// branch calls rollSweep() every step: anything small inside the roll's body
// takes one swipe per roll and is rolled through (separateUnits skips the
// pair, so there is nothing to bump against), and anything too big to go
// through ends the roll in a tackle that hurts both sides. Fish are under the
// ice and are not in any of it.

// How hard the roll in progress hits: the scale runs from the champion's own
// dodgeSpeed (the floor a standing dash starts at) up to ROLL_FAST, so speed
// stolen off ice or out of a slide is what makes a roll dangerous.
function rollPow(p, sp) {
  const base = kitOf(p).dodgeSpeed;
  return Math.max(0, Math.min(1, (sp - base) / Math.max(1, ROLL_FAST - base)));
}
function rollLerp(r, t) { return r[0] + (r[1] - r[0]) * t; }
function rollDmg(p, sp) { return Math.max(1, Math.round(rollLerp(ROLL_DMG, rollPow(p, sp)))); }

// One state, three kinds of unit. A stunned player has every intent dropped
// out of its input struct (so a human and a bot are pinned by exactly the
// same window), a stunned animal or robot skips its brain for it. Nobody
// loses their velocity: whatever knocked you still slides you, and the
// surface spends it the way it spends any other momentum.
function stunUnit(e, t) {
  if (t <= 0) return;
  // a juggernaut cannot be stunned - that is most of what the ability IS
  if (e instanceof Player && e.jugT > 0) return;
  const cur = e.stunT || 0;
  e.stunT = Math.max(cur, t);
  e.stunMax = cur > 0 ? Math.max(e.stunMax || 0, e.stunT) : e.stunT;
  if (e instanceof Player) {
    e.dodgeT = 0;                                  // no roll survives being stunned out of it
    if (e.charging) { e.charging = false; e.chargeT = 0; }
    e.fireArmed = false;
    e.swingT = 0; e.swingHitDone = true;           // the swing in flight never lands
    e.sliding = false;
    e.castT = 0; e.castAb = -1;                    // the cast is knocked out of the hands
    breakEat(e);                                   // ...and so is the meal (js/core.js)
    if (e.shieldT > 0) abShieldDown(e, false);     // ...and the shield, at its full cooldown
    if (e.rushT > 0) { e.rushT = 0; e.rushVictim = -1; }
  }
  burst(e.x, e.y - 9, '#ffe9a8', 4, 26, 0.4, true);
}

// A tackle: the roll met something it cannot go through. Both sides take it,
// both are stunned, and the roll ends on the spot - scaled by `sp`, the speed
// it was carrying into the hit. The roller's i-frames are dropped first,
// because the tackle is the one hit a roll cannot dodge.
function rollTackle(p, sp, nx, ny) {
  const t = rollPow(p, sp);
  p.dodgeT = 0;
  p.invuln = 0;
  p.sliding = false;
  p.vx = -nx * 30; p.vy = -ny * 30; // bounced back off it
  damagePlayer(p, Math.max(1, Math.round(rollLerp(ROLL_DMG, t) * TACKLE_SELF)), -nx, -ny, null, 'tackle');
  if (!p.dead) stunUnit(p, rollLerp(TACKLE_STUN, t));
  if (p === player) state.shake = Math.max(state.shake, 4);
  if (nearPlayer(p.x, p.y)) SFX.hit();
  burst(p.x + nx * 5, p.y - 3, '#eef4fb', 8, 45, 0.45, true);
}

// The other half of a tackle into scenery. A building on another team takes
// the hit for real - it has an hp pool and a body to break. A tree or a rock
// has neither: its `hp` is a chop count sitting behind a tool gate, so being
// run into shakes it and dumps its snow and nothing more.
function tackleObject(o, dmg, p) {
  if (!o) return;
  o.flash = 0.1;
  o.shake = 0.26;
  const c = structCenter(o);
  burst(c.x, c.y - 6, '#eef4fb', 8, 45, 0.5, true);
  if (o.type === 'dummy') { hitDummy(o, dmg, c.x, c.y - 8); return; } // the dummy takes the shoulder for real
  if (!STRUCTS[o.type] || ownsStruct(o, p)) return;
  o.hp -= dmg;
  addDmgFloater(c.x, c.y - 12, dmg);
  if (o.hp <= 0) {
    destroyStructure(o, true, p);
    logEvent(p.name + ' WRECKED A ' + STRUCTS[o.type].name, p);
  }
}

// what the roll just slammed into, if anything: the tile straight ahead on
// the axis the wall refused. Null for the world border, which is a wall with
// nothing standing in it - the roller still eats the tackle either way.
function tackleObjAhead(p, nx, ny) {
  const tx = Math.floor((p.x + nx * (PLAYER_R + 3)) / TILE);
  const ty = Math.floor((p.y + ny * (PLAYER_R + 3)) / TILE);
  return inWorld(tx, ty) ? structOf(objAt(tx, ty)) : null;
}

// Everything the roll is touching this step. Small units are swiped and
// passed through, once each per roll (p.rollHit); a deer is swiped and then
// stops the roll dead. Friendly units and teammates are passed through
// untouched - you roll under them, you do not run them down.
function rollSweep(p) {
  const sp = Math.hypot(p.vx, p.vy);
  const nx = sp > 1 ? p.vx / sp : 0, ny = sp > 1 ? p.vy / sp : 0;
  const dmg = rollDmg(p, sp), stun = rollLerp(ROLL_STUN, rollPow(p, sp));

  for (const a of animals) {
    if (a.dead || a.kind === 'bird' || p.rollHit.includes(a)) continue;
    if (Math.hypot(a.x - p.x, a.y - p.y) > ROLL_HIT_R + unitRadius(a)) continue;
    p.rollHit.push(a);
    hurtAnimal(a, dmg, nx, ny, ROLL_KB, p.id);
    if (a.hp > 0) stunUnit(a, stun);
    if (a.kind === 'deer') { rollTackle(p, sp, nx, ny); return; } // too much animal to go through
  }
  for (const b of robots) {
    if (b.dead || b.team === p.team || p.rollHit.includes(b)) continue;
    if (Math.hypot(b.x - p.x, b.y - p.y) > ROLL_HIT_R + unitRadius(b)) continue;
    p.rollHit.push(b);
    hurtRobot(b, dmg, nx, ny, p);
    if (!b.dead) stunUnit(b, stun);
  }
  for (const q of players) {
    if (!enemyOf(p, q) || p.rollHit.includes(q)) continue;
    if (Math.hypot(q.x - p.x, q.y - p.y) > ROLL_HIT_R + PLAYER_R) continue;
    p.rollHit.push(q);
    if (q.invuln > 0) continue; // a rival mid-roll of their own is untouchable: rolls cancel rolls
    damagePlayer(q, dmg, nx, ny, p);
    if (!q.dead) stunUnit(q, stun);
  }
}

// ---- prone ---------------------------------------------------------------
// Ctrl: go to ground, or get back up. Dropping needs both feet still and snow
// underfoot - you cannot dive at speed, and a river has nothing to dig into.
// Everything else about the state is one number, `p.hide`, which updatePlayer
// ramps and every watcher reads back through seenAt().
function tryProne(p) {
  if (p.dead || p.fallT > 0 || inAir(p)) return;
  if (p.prone) { risePlayer(p); return; }
  const tx = Math.floor(p.x / TILE), ty = Math.floor((p.y + 4) / TILE);
  if (p.dodgeT > 0 || p.sliding || Math.hypot(p.vx, p.vy) > PRONE_ENTER ||
    !inWorld(tx, ty) || ground[idx(tx, ty)] !== 0) {
    if (p === player) SFX.deny();
    return;
  }
  p.prone = true;
  p.hide = 0; p.riseT = 0; p.crawlT = 0; p.puffT = rand(0.7, 1.5);
  p.vx = p.vy = 0;
  p.sliding = false; p.slideT = 0;
  burst(p.x, p.y + 4, '#eef4fb', 7, 34, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.bury();
}

// Back on your feet, whatever put you there - the ambush shot, a hit, an E
// swing, a roll, or Ctrl again. The cover goes with the body and is not
// allowed to linger: a slot that is visibly standing must be visibly findable,
// so `hide` is zeroed here and the snow it stood for is spent as particles.
function risePlayer(p) {
  if (!p.prone) return;
  const h = p.hide;
  p.prone = false;
  p.hide = 0;
  p.riseT = PRONE_RISE;
  if (h > 0.2) {
    burst(p.x, p.y + 2, '#eef4fb', 4 + Math.round(h * 7), 44, 0.45, true);
    if (nearPlayer(p.x, p.y)) SFX.rise();
  }
}

// ---- the quiver ---------------------------------------------------------
// Three ways an arrow moves: out of the quiver when a shot is loosed, into
// the snow where that shot ended (stickArrow), and back into a quiver when
// anyone walks over it. Fletching is the slow floor under all of it, so a
// player who never retrieves anything is throttled rather than disarmed.
function gainArrow(p, n) {
  if (p.quiver >= QUIVER_MAX) return false;
  p.quiver = Math.min(QUIVER_MAX, p.quiver + (n || 1));
  p.quiverFlash = 0.35;
  return true;
}
// a spent arrow, left where its flight ended. Open water swallows it; a
// solid tile keeps it on the near side so it never sits inside a wall.
function stickArrow(a, nx, ny) {
  const x = a.x - nx * 3, y = a.y - ny * 3;
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (!inWorld(tx, ty)) return;
  if (ground[idx(tx, ty)] === 2) { // straight into the water: gone
    burst(x, y, '#9fc4dd', 4, 30, 0.35, true);
    if (nearPlayer(x, y)) SFX.splash();
    return;
  }
  shafts.push({ x, y, nx, ny, team: a.team, t: 0 });
  while (shafts.length > SHAFT_MAX) shafts.shift();
}
// pressing a tool that cannot answer - an empty quiver, an empty slot, or a
// tool with no bit light enough to throw: the tell, rate-limited to the press.
// What the press WOULD have fired lives in fireTool (js/tools.js).
function dryFire(p) {
  p.dryT = 0.45;
  burst(p.x, p.y - BOW_Y, '#8a97bd', 3, 22, 0.3, true);
  if (p === player) SFX.dryFire();
}

// the swing lands on the tile tryWork() locked, whatever is there by now
// (a robot may have felled the tree mid-swing: then it's just air). Two
// players can land on the same tile in one step - only one swing counts.
function swingHit(p) {
  const tx = p.workTx, ty = p.workTy;
  if (!inWorld(tx, ty)) return;
  contest('work:' + idx(tx, ty), p, () => {
    const o = objects[idx(tx, ty)];
    if (o) {
      const st = structOf(o); // a `part` tile hits the building it belongs to
      if (STRUCTS[st.type]) { if (!ownsStruct(st, p)) hitObject(st, p); }
      else if (o.type !== 'stump') hitObject(o, p);
    } else if (ground[idx(tx, ty)] === 1) crackIce(tx, ty, p);
  });
}

function crackIce(tx, ty, p) {
  p = p || player;
  const i = idx(tx, ty);
  const px = tx * TILE + 8, py = ty * TILE + 8;
  const hits = (iceCracks.get(i) || 0) + 1;
  if (nearPlayer(px, py)) SFX.mine();
  burst(px, py, '#ddf1f8', 6, 45, 0.4, true);
  if (hits >= ICE_HOLE_HITS) {
    // broken through: the tile becomes open water
    iceCracks.delete(i);
    ground[i] = 2;
    holes.push(i);
    repaintGround(tx, ty);
    if (nearPlayer(px, py)) SFX.splash();
    if (p === player) state.shake = Math.max(state.shake, 2);
    // the one time a hole says it is also a build site - the same one-shot
    // nudge the first stump gets, for the same reason
    if (p === player && !state.hints.hole) {
      state.hints.hole = true;
      showMsg('RIGHT CLICK THE HOLE TO SET A FISH NET', 5);
    }
    burst(px, py, '#3a6080', 10, 50, 0.5, true);
    burst(px, py, '#ddf1f8', 8, 55, 0.5, true);
    // the noise sends nearby fish darting away
    for (const f of fish) {
      if (f.born && Math.hypot(f.x - px, f.y - py) < 40) {
        f.a = Math.atan2(f.y - py, f.x - px);
        f.spook = 1.2;
      }
    }
  } else {
    iceCracks.set(i, hits);
  }
}

// nearest tile a player can stand on - used to climb out of a hole
function nearestDryTile(x, y, p) {
  const ctx0 = Math.floor(x / TILE), cty0 = Math.floor(y / TILE);
  for (let r = 1; r <= 8; r++) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = ctx0 + dx, ty = cty0 + dy;
      if (!inWorld(tx, ty) || ground[idx(tx, ty)] === 2 || isSolidTile(tx, ty)) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = { tx, ty }; }
    }
    if (best) return best;
  }
  return (p || player).spawn;
}

function hitObject(o, p) {
  p = p || player;
  const ox = o.tx * TILE + 8, oy = o.ty * TILE + 8;
  const near = nearPlayer(ox, oy); // remote players' work must not spam the mix
  // hard tool gating: an object with a `needs` bounces off anything else
  const k = SWING_TOOLS[p.swing].key;
  const d = OBJECTS[o.type];
  if (d && d.needs && k !== d.needs) {
    if (near) SFX.deny();
    addFloater(ox, oy - 14, d.needs === 'pick' ? 'NEEDS PICKAXE' : 'NEEDS AXE', '#9fb6d8');
    return;
  }
  o.flash = 0.1;
  o.shake = 0.22;
  if (o.type === 'tree') {
    o.hp--;
    if (near) SFX.chop();
    awardGold(p, YIELD.treeHit, ox, oy);
    burst(ox, oy - 10, '#eef4fb', 6, 40, 0.5, true);
    burst(ox, oy - 12, '#3f7a5c', 3, 30, 0.4, true);
    if (o.hp <= 0) {
      objects[idx(o.tx, o.ty)] = { type: 'stump', tx: o.tx, ty: o.ty, flash: 0, shake: 0 };
      if (near) SFX.treeFall();
      if (p === player) state.shake = Math.max(state.shake, 2.5);
      if (p === player && !state.hints.stump) {
        state.hints.stump = true;
        showMsg('RIGHT CLICK THE STUMP TO BUILD ON IT', 5);
      }
      awardGold(p, YIELD.treeFall + kitOf(p).harvest, ox, oy - 6); // PACKMULE fattens the fell
      burst(ox, oy - 8, '#eef4fb', 14, 55, 0.7, true);
      burst(ox, oy - 8, '#2f5c4b', 8, 45, 0.6, true);
      dropLoot(ox, oy - 6, 0, TREE_DROP); // the rare one: something was living in it
      if (o.rare) {
        awardGold(p, YIELD.treeRare, ox, oy - 12);
        burst(ox, oy - 8, '#f2cc6a', 10, 50, 0.6, true);
        addFloater(ox, oy - 32, 'JACKPOT!', '#f2cc6a');
        if (near) SFX.coin();
      }
    }
  } else if (o.type === 'deadTree') {
    // the rookery's cover: quicker than a live pine, same gold, and felling
    // a perch scatters the flock that was sitting in it
    o.hp--;
    if (near) SFX.chop();
    awardGold(p, YIELD.deadTreeHit, ox, oy);
    burst(ox, oy - 10, '#eef4fb', 5, 40, 0.5, true);
    burst(ox, oy - 12, '#6b5a48', 3, 30, 0.4, true);
    if (o.hp <= 0) {
      objects[idx(o.tx, o.ty)] = { type: 'stump', tx: o.tx, ty: o.ty, flash: 0, shake: 0 };
      if (near) SFX.treeFall();
      if (p === player) state.shake = Math.max(state.shake, 2);
      awardGold(p, YIELD.deadTreeFall + kitOf(p).harvest, ox, oy - 6);
      burst(ox, oy - 8, '#eef4fb', 12, 55, 0.7, true);
      burst(ox, oy - 8, '#6b5a48', 6, 45, 0.6, true);
      flushBirds(landmarkAt(ox, oy), { x: ox, y: oy });
    }
  } else if (o.type === 'rock') {
    o.hp--;
    if (near) SFX.mine();
    awardGold(p, YIELD.rockHit, ox, oy);
    burst(ox, oy - 4, '#a8b0c4', 6, 45, 0.4, true);
    if (o.hp <= 0) {
      objects[idx(o.tx, o.ty)] = null;
      if (near) SFX.break_();
      if (p === player) state.shake = Math.max(state.shake, 2);
      awardGold(p, YIELD.rockBreak + kitOf(p).harvest, ox, oy - 6);
      burst(ox, oy - 4, '#8b93a8', 12, 55, 0.6, true);
      // the common source: a rock is where a bottom-tier tool or bit was
      // buried, and it is what makes mining worth doing after the gold stops
      // being the point (js/tools.js)
      dropLoot(ox, oy - 4, 0, ROCK_DROP);
    }
  } else if (o.type === 'eagle') {
    // the roost: a rival's E swing is the melee siege on the objective. The
    // own-team case can still land here through a stale swing lock, so the
    // gate workTarget applies is re-checked before any damage.
    const e = state.drop && state.drop.eagles[o.team];
    if (!e || e.state !== 'down' || p.team === o.team) { if (near) SFX.deny(); return; }
    hurtEagle(e, EAGLE_WORK_DMG, p, ox, oy); // the puff lands on the struck tile
    if (near) SFX.chop();
  } else if (o.type === 'dummy') {
    hitDummy(o, DUMMY_WORK_DMG, ox, oy - 10);
  } else if (o.type === 'bush') {
    if (o.berries > 0) {
      o.berries = 0;
      o.regrow = 70;
      if (near) SFX.stash();
      spawnDrop(ox, oy, 'berry'); spawnDrop(ox, oy, 'berry');
      burst(ox, oy - 4, '#4c8560', 5, 35, 0.4, true);
    } else if (near) {
      SFX.swing();
    }
  } else if (o.type === 'chest') {
    // a buried cache in the treeline (placeChests, js/world.js): one free E
    // press springs it - gold straight into the purse, a card drop rolled
    // from CHEST_ODDS, and the one place a TOP-tier tool or bit is found (a
    // rock and a felled tree only ever pay out the bottom tier). The tile
    // opens with it, so a sprung chest leaves a gap in the forest wall.
    objects[idx(o.tx, o.ty)] = null;
    if (near) SFX.stash();
    if (p === player) state.shake = Math.max(state.shake, 1.5);
    awardGold(p, randi(CHEST_GOLD_MIN, CHEST_GOLD_MAX), ox, oy);
    const rarity = rollCardRarity(CHEST_ODDS);
    const key = cardKey(rarity);
    spawnDrop(ox, oy, key, 1);
    addFloater(ox, oy - 24, rarity.toUpperCase() + ' CARD', RES_COLORS[key]);
    dropLoot(ox, oy, TOOL_TIERS.length - 1, CHEST_TOOL);
    burst(ox, oy - 6, '#f2cc6a', 12, 55, 0.6, true);
    burst(ox, oy - 6, '#8a6142', 8, 45, 0.5, true);
  } else if (STRUCTS[o.type]) {
    // reached from swingHit only for a building on ANOTHER team
    hurtStruct(o, STRUCT_HIT_DMG, p);
  }
}

// Every way of hurting the practice dummy lands here - the E swing, every
// bit an arrow pipeline shot can be (js/sim.js), and the roll's tackle - so
// the numbers read the same whatever is thrown at it. The dummy never
// breaks: the pool floors at zero and updatePractice (js/world.js) mends it
// after DUMMY_RESET_T of quiet, which is what makes it a combo readout.
function hitDummy(o, dmg, hx, hy) {
  // the meter's ledger: a hit after the quiet (the mend window) is a new
  // combo, so the totals start over from this blow
  if (o.hitT > DUMMY_RESET_T) { o.mTotal = 0; o.mT0 = state.elapsed; }
  o.mLast = dmg;
  o.mTotal = (o.mTotal || 0) + dmg;
  o.mT1 = state.elapsed;
  o.hp = Math.max(0, o.hp - dmg);
  o.hitT = 0;
  o.flash = 0.1;
  o.shake = 0.24;
  addDmgFloater(hx, hy - 6, dmg);
  burst(hx, hy - 4, '#e0c890', 5, 40, 0.4, true); // straw off the sack
  if (nearPlayer(hx, hy)) SFX.hit();
}

// One blow against a building on another team. Both things that can land one
// - a player's E swing and a worker bot's axe on a siege flag - come through
// here, so the flash, the floater, the wreck's payout and the feed line are
// one path and cannot drift apart. `p` is who swung (null = nobody to credit).
function hurtStruct(o, dmg, p) {
  const c = structCenter(o);
  o.hp -= dmg;
  o.flash = 0.1;
  o.shake = 0.22;
  if (nearPlayer(c.x, c.y)) SFX.hit();
  burst(c.x, c.y - 4, '#a3794f', 5, 40, 0.4, true);
  addDmgFloater(c.x, c.y - 12, dmg);
  if (p === player) state.shake = Math.max(state.shake, 1);
  if (o.hp <= 0) {
    const name = STRUCTS[o.type].name;
    // the wreck pays out like a demolition, straight to whoever broke it
    destroyStructure(o, true, p);
    if (p) logEvent(p.name + ' WRECKED A ' + name, p);
  }
}

// `p` is who gets the refund gold - the demolishing owner or the wrecker.
// With nobody to pay (refund true, p null) the rubble is just rubble.
function destroyStructure(o, refund, p) {
  // a net going down tips its catch back out onto the ice - the fish in it
  // were never the owner's, and wrecking one should not delete them
  const spill = o.type === 'net' ? o.fish || 0 : 0;
  if (STRUCTS[o.type]) removeStruct(o);
  else objects[idx(o.tx, o.ty)] = null;
  const c = structCenter(o), ox = c.x, oy = c.y;
  for (let i = 0; i < spill; i++) spawnDrop(ox, oy, 'fish');
  if (nearPlayer(ox, oy)) SFX.break_();
  burst(ox, oy, '#8a6142', 10, 50, 0.5, true);
  burst(ox, oy, '#eef4fb', 6, 40, 0.5, true);
  if (refund && STRUCTS[o.type] && p) {
    // 50% of everything paid across tiers, paid out on the spot
    const c = cumulativeCost(o.type, o.tier);
    awardGold(p, Math.floor((c.gold || 0) / 2), ox, oy);
  }
  rebuildLights();
  // a Keep falling can itself be the elimination blow for a team that
  // already has zero living players waiting on its respawn timer - only
  // die() calls checkLastStanding() otherwise, and nothing else would notice
  if (o.type === 'keep') checkLastStanding();
}

