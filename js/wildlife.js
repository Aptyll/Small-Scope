'use strict';
// Everything wild: prey and the shared animal lifecycle, the fish under the
// ice and the holes cut down to them, the wolf pack and the rookery's flock -
// each with its own tuning above it.
// ------------------------------------------------------------ animals
// Rabbits and deer are the passive half (updatePrey); wolves and birds are
// the inhabitants of the two landmarks (updateWolf / updateBird), and go in
// this same array so arrows, the draw list, the kill payouts and the cursor
// all treat them as what they are: things you shoot.
const ANIMAL_HP = { rabbit: 8, deer: 24, wolf: 30, bird: 3 };
const HIT_PUFF = { rabbit: '#eef2fa', deer: '#a5825a', wolf: '#6f778c', bird: '#cfd6e4' };
// Prey: how close a player gets before it bolts, how long it runs, and the two
// speeds. A deer keeps the wider watch and the longer run; a rabbit sits tight
// and then goes off like a spring. Both resolve the ring through seenAt, so
// crawling in under the snow is what gets a hunter inside it.
const FLEE_SIGHT = { rabbit: 26, deer: 46 };
const FLEE_TIME = { rabbit: [0.6, 1.1], deer: [1.1, 1.9] };
const PREY_SPD = { rabbit: 42, deer: 26 };   // px/s grazing
const PREY_RUN = { rabbit: 80, deer: 92 };   // px/s bolting

function makeAnimal(kind, x, y) {
  const hp = ANIMAL_HP[kind] || 8;
  const a = {
    kind, x, y, hp, maxHp: hp,
    dir: rng() < 0.5 ? 'left' : 'right',
    goal: null, idleT: rand(0.5, 2.5), mvx: 0, mvy: 0, moving: false,
    animT: rng() * 2, flash: 0, kbx: 0, kby: 0,
    fleeT: 0, fleeGoal: null, nav: null,  // prey: its flight; any walker: its route (see pathfinding)
    home: null,                          // the landmark it belongs to, if any
    target: null, biteCd: 0, threat: 0, // wolf: its quarry, its bite rhythm, and how close it is to charging (0..1)
    perch: null, flyT: 0, fa: 0, alt: 0, // bird: its tree, its flight, its height
    dead: false,
  };
  // stun, root, slow, the net drape, the falcon's mark, fire: an animal wears
  // the identical set a player slot does, written by the same setters
  // (`status effects`, js/actions.js) - a rabbit is not a different rulebook
  clearUnitStatus(a);
  return a;
}

// the body an arrow (and the aim line) tests against. Birds ride their alt
// and are a smaller mark - that is most of what makes them a hard shot.
// `pad` is a shot's own `reach`: extra px for a bit with a BODY rather than a
// shaft's tip (the fist, the axe; js/tools.js). Absent for everything else.
function animalHit(a, x, y, pad) {
  const r = (a.kind === 'bird' ? 5 : 8) + (pad || 0);
  return Math.hypot(a.x - x, a.y - (a.alt || 0) - 3 - y) < r;
}

// One animal taking a hit, from an arrow or from a body rolled into it. Both
// come through here so a swipe reacts exactly like a shot does - the den
// wakes, prey bolts, the flock scatters - and `lastHit` (the slot whose
// HUNTSMAN bonus the kill pays, see animalDies) is stamped in one place.
function hurtAnimal(a, dmg, nx, ny, kb, owner, ambush) {
  a.hp -= dmg;
  a.flash = 0.12;
  a.lastHit = owner;
  // a wolf does not run from a hit - the whole den comes for you
  if (a.kind === 'wolf') wakePack(a, players[owner]);
  else if (a.kind === 'bird') flushBirds(a.home, a);
  else a.fleeT = a.kind === 'rabbit' ? 1.4 : 2.2;
  addDmgFloater(a.x, a.y - (a.alt || 0) - 12, dmg, false, ambush);
  a.kbx = nx * kb; a.kby = ny * kb;
  burst(a.x, a.y - (a.alt || 0) - 4, HIT_PUFF[a.kind] || '#a5825a', 6, 40, 0.4);
  if (ambush) ambushFx(a.x, a.y - (a.alt || 0) - 4);
  if (nearPlayer(a.x, a.y)) { SFX.hit(); if (a.hp > 0 && a.kind !== 'bird') SFX.yelp(); }
}

function spawnAnimals() {
  const bushes = [];
  for (const o of objects) if (o && o.type === 'bush') bushes.push(o);
  const freeSpot = (tx, ty) =>
    inWorld(tx, ty) && !objects[idx(tx, ty)] &&
    Math.hypot(tx - cx, ty - cy) > 14;
  const place = (kind, nearBushes) => {
    for (let tries = 0; tries < 40; tries++) {
      let tx, ty;
      if (nearBushes && bushes.length && rng() < 0.7) {
        const b = bushes[randi(0, bushes.length - 1)];
        tx = b.tx + randi(-4, 4); ty = b.ty + randi(-4, 4);
      } else {
        tx = randi(BORDER_MIN + 2, WORLD - 3 - BORDER_MIN);
        ty = randi(BORDER_MIN + 2, WORLD - 3 - BORDER_MIN);
      }
      if (!freeSpot(tx, ty)) continue;
      animals.push(makeAnimal(kind, (tx + 0.5) * TILE, (ty + 0.5) * TILE));
      return;
    }
  };
  for (let i = 0; i < 16; i++) place('rabbit', true);
  for (let i = 0; i < 10; i++) place('deer', false);
}

// ------------------------------------------------------------ fish
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
const FISH_SPAWN_FAST = 4; // ...and while it is under FISH_MIN
const FISH_EMERGE_SPD = 7; // px/s an unborn fish creeps out from under the shore
const FISH_EMERGE_MAX = 14; // seconds before an emerger that never found water is dropped

// passive swimmers that live under the frozen water, visible as silhouettes
// through the ice; the bow spears one when it's right under the player
// `born` is the whole two-state life of a fish. A born fish is the one the
// game has always had: hard-clamped inside the water, drawn, spearable,
// catchable. An emerger is none of those yet - it is still under the snow
// (the deep water the map does not draw), swimming for the shallows at
// FISH_EMERGE_SPD with the clamp lifted, and `vis` - how much of its body is
// over water - is both its alpha and the test that promotes it. So a fish is
// literally never drawn on snow: what is visible IS what is under the ice.
function addFish(x, y, a, born) {
  fish.push({
    x, y, a: a === undefined ? rand(0, Math.PI * 2) : a, spd: rand(9, 18), t: rand(0, 9), turnT: rand(1, 3),
    spook: 0, ts: rng() < 0.5 ? -1 : 1, // preferred turn direction at a dead end
    born: born !== false, vis: born === false ? 0 : 1, emT: 0,
  });
}

function fishWater(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  // ice or open water only - named outright rather than "not snow", so any
  // future land ground type is automatically land a fish must not count as
  // swimmable
  const g = inWorld(tx, ty) ? ground[idx(tx, ty)] : 0;
  return g === 1 || g === 2;
}
// the whole body fits in water with margin px to spare on every side, so a
// fish never reads as poking into the snow
function fishClear(x, y, margin) {
  const m = margin || FISH_MARGIN;
  return fishWater(x - m, y) && fishWater(x + m, y) &&
    fishWater(x, y - m) && fishWater(x, y + m);
}

// the seed shoal: dropped straight into interior water, already born
function spawnFish() {
  const spots = [];
  for (let i = 0; i < WORLD * WORLD; i++) {
    if (ground[i] !== 1) continue;
    const x = (i % WORLD + 0.5) * TILE, y = ((i / WORLD | 0) + 0.5) * TILE;
    if (fishClear(x, y, 14)) spots.push(i); // interior ice only, ~a tile off the shore
  }
  let guard = 0;
  while (fish.length < FISH_MAX && spots.length && guard++ < 400) {
    const i = spots[randi(0, spots.length - 1)];
    addFish((i % WORLD + 0.5) * TILE, ((i / WORLD | 0) + 0.5) * TILE);
  }
}

// Where a replacement fish comes from: a roomy shore tile of ice, entered
// from the snow two tiles back - which is what "deep lake" means here, since
// the map has no deep water to draw.
//
// These are found ONCE and cached. Rejection-sampling random tiles for one
// (ice with swimming room, snow exactly two tiles off) hits so rarely on a
// 232x232 world that thirty tries routinely found nothing at all, which
// silently throttled the whole respawn trickle to near zero. The shoreline
// never moves - a hole only flips ice to water and back, and `fishClear`
// counts both as swimmable - so one scan at first use stays correct for the
// match, and `genWorld()` runs only at boot.
let emergeSites = null;
function buildEmergeSites() {
  const out = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let ty = 2; ty < WORLD - 2; ty++) {
    for (let tx = 2; tx < WORLD - 2; tx++) {
      if (ground[idx(tx, ty)] !== 1) continue;
      const x = tx * TILE + 8, y = ty * TILE + 8;
      if (!fishClear(x, y, 10)) continue; // real swimming room, not a rim tile
      for (const d of dirs) {
        const sx = tx + d[0] * 2, sy = ty + d[1] * 2;
        if (!inWorld(sx, sy) || ground[idx(sx, sy)] !== 0) continue;
        const px = sx * TILE + 8, py = sy * TILE + 8;
        out.push({ x: px, y: py, a: Math.atan2(y - py, x - px) });
      }
    }
  }
  return out;
}
function spawnEmerger() {
  if (!emergeSites) emergeSites = buildEmergeSites();
  if (!emergeSites.length) return false; // a world with no reachable shoreline
  const s = emergeSites[randi(0, emergeSites.length - 1)];
  addFish(s.x, s.y, s.a, false);
  return true;
}

// How much of a fish's body is over water, sampled nose to tail: 1 = fully
// under the ice, 0 = fully under the snow. It is the draw alpha, so nothing
// half-beached can ever be seen half-beached, and it is what says an emerger
// has arrived.
function fishVis(f) {
  let n = 0;
  for (const o of [5, 2, 0, -2, -5]) if (fishWater(f.x + Math.cos(f.a) * o, f.y + Math.sin(f.a) * o)) n++;
  return n / 5;
}

// shortest signed turn from a to b - the one steering helper the lure needs
function angDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// the standing, room-to-spare net nearest a point, within its lure radius
function nearestNet(x, y) {
  let best = null, bd = NET_LURE;
  for (const o of structures) {
    if (o.type !== 'net' || o.building || o.fish >= NET_CAP) continue;
    const cx = o.tx * TILE + 8, cy = o.ty * TILE + 8;
    const d = Math.hypot(cx - x, cy - y);
    if (d < bd) { bd = d; best = { cx, cy, o, d }; }
  }
  return best;
}

function updateFish(dt) {
  for (let i = fish.length - 1; i >= 0; i--) {
    const f = fish[i];
    f.t += dt;
    f.spook = Math.max(0, f.spook - dt);
    if (!f.born) {
      // an emerger holds its heading and creeps in; no wander, no edge cap,
      // no clamp - the shore is the thing it is crossing. It is born the
      // moment its whole body is in water with the usual margin to spare.
      f.emT += dt;
      f.x += Math.cos(f.a) * FISH_EMERGE_SPD * dt;
      f.y += Math.sin(f.a) * FISH_EMERGE_SPD * dt;
      f.vis = fishVis(f);
      if (f.vis >= 1 && fishClear(f.x, f.y)) { f.born = true; f.vis = 1; f.emT = 0; }
      else if (f.emT > FISH_EMERGE_MAX) fish.splice(i, 1); // walled in: never surfaced, never seen
      continue;
    }
    f.turnT -= dt;
    if (f.turnT <= 0) { f.turnT = rand(1, 3); f.a += rand(-1.1, 1.1); }
    const spd = f.spd * (f.spook > 0 ? 3 : 1);
    // a net baits the water around it: nothing forced, just a lean toward the
    // rope, which is what makes a net visibly work instead of waiting on luck
    if (f.spook <= 0) {
      const nt = nearestNet(f.x, f.y);
      if (nt) f.a += angDelta(f.a, Math.atan2(nt.cy - f.y, nt.cx - f.x)) * 1.2 * dt;
    }
    // soft edge cap: veer away well before the shore, turning toward
    // whichever side opens into water (falling back to the fish's own bias)
    if (!fishClear(f.x + Math.cos(f.a) * 10, f.y + Math.sin(f.a) * 10)) {
      const L = fishClear(f.x + Math.cos(f.a + 0.9) * 10, f.y + Math.sin(f.a + 0.9) * 10);
      const R = fishClear(f.x + Math.cos(f.a - 0.9) * 10, f.y + Math.sin(f.a - 0.9) * 10);
      f.a += (L === R ? f.ts : L ? 1 : -1) * 5 * dt;
    }
    // hard clamp: never commit a position whose body margin touches snow
    const nx = f.x + Math.cos(f.a) * spd * dt, ny = f.y + Math.sin(f.a) * spd * dt;
    if (fishClear(nx, ny)) { f.x = nx; f.y = ny; }
    else f.a += f.ts * 5 * dt; // pinned: keep rotating until a way out opens
  }
  // the trickle that keeps the shoal alive: one fish at a time, twice as fast
  // once the water is fished down past FISH_MIN, nothing at all at the cap.
  // The practice arena has NO fishable water - its only ice is the parkour
  // track, and a fish emerging into a race line would be absurd - so under
  // PRACTICE the trickle is off entirely.
  if (PRACTICE) return;
  state.fishT -= dt;
  if (state.fishT <= 0) {
    state.fishT = fish.length < FISH_MIN ? FISH_SPAWN_FAST : FISH_SPAWN_T;
    if (fish.length < FISH_MAX) spawnEmerger();
  }
}

function nearestObj(x, y, rTiles, pred) {
  const ctx0 = Math.floor(x / TILE), cty = Math.floor(y / TILE);
  let best = null, bd = 1e9;
  for (let ty = cty - rTiles; ty <= cty + rTiles; ty++) {
    for (let tx = ctx0 - rTiles; tx <= ctx0 + rTiles; tx++) {
      const o = objAt(tx, ty);
      if (o && pred(o)) {
        const d = Math.hypot(tx * TILE + 8 - x, ty * TILE + 8 - y);
        if (d < bd) { bd = d; best = o; }
      }
    }
  }
  return best;
}

function nearestBerryBush(x, y, rTiles) {
  return nearestObj(x, y, rTiles, (o) => o.type === 'bush' && o.berries > 0);
}

function updateAnimal(a, dt) {
  a.flash = Math.max(0, a.flash - dt);
  a.kbx *= Math.pow(0.02, dt);
  a.kby *= Math.pow(0.02, dt);
  // every timed state on the body first - the burn can kill, and a corpse
  // must not then take a step (js/actions.js, `status effects`)
  updateUnitStatus(a, dt);
  if (a.hp <= 0 && !a.dead) { animalDies(a); return; }
  if (a.stunT > 0) {
    // seeing stars: no brain for the window, and the route it was walking is
    // dropped rather than resumed - a tackle can slide a body a long way from
    // the leg it was on. A shove still moves it, same as any idle animal.
    a.stunT = Math.max(0, a.stunT - dt);
    a.moving = false;
    if (Math.abs(a.kbx) + Math.abs(a.kby) > 1) moveEntity(a, a.kbx * dt, a.kby * dt, unitRadius(a));
    if (a.stunT <= 0) { a.goal = null; a.fleeGoal = null; navClear(a); a.idleT = 0.3; }
  } else if (a.kind === 'wolf') updateWolf(a, dt);
  else if (a.kind === 'bird') updateBird(a, dt);
  else updatePrey(a, dt);
  a.x = Math.max(8, Math.min(WORLD * TILE - 8, a.x));
  a.y = Math.max(8, Math.min(WORLD * TILE - 8, a.y));
  if (a.hp <= 0 && !a.dead) animalDies(a);
}

// where a frightened animal runs next: ~6 tiles off, as straight away from
// the threat as the ground allows (fanning out, then sideways, then past it),
// the first open tile it can actually route to
function fleeGoal(a, from) {
  const base = Math.atan2(a.y - from.y, a.x - from.x) + rand(-0.4, 0.4);
  const dist = 6 * TILE;
  for (const k of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6, Math.PI]) {
    const gx = a.x + Math.cos(base + k) * dist, gy = a.y + Math.sin(base + k) * dist;
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
    if (!walkable(tx, ty)) continue;
    const x = tx * TILE + 8, y = ty * TILE + 8;
    if (navLineClear(a.x, a.y, x, y, 5) || findPath(a.x, a.y, x, y, 0, 250)) return { x, y };
  }
  return null;
}

// Where an animal drifts next while nothing is chasing it: an open tile
// `near`-`far` tiles off, inside `spread` of `base`, that it can route to.
// Idling used to be a random heading held on a timer, which walked animals
// into trees and stopped them mid-stride wherever the clock ran out. A
// wander is a goal like any other now, so it goes around what is in the way,
// it ends where the animal actually stops, and the debug overlay has a real
// route to draw instead of a stub pointing off into nothing.
// null means boxed in - the caller waits a beat and picks again.
function wanderGoal(a, base, spread, near, far) {
  for (let k = 0; k < 8; k++) {
    const ang = base + rand(-spread, spread);
    const d = rand(near, far) * TILE;
    const tx = Math.floor((a.x + Math.cos(ang) * d) / TILE), ty = Math.floor((a.y + Math.sin(ang) * d) / TILE);
    if (!walkable(tx, ty)) continue;
    const x = tx * TILE + 8, y = ty * TILE + 8;
    if (navLineClear(a.x, a.y, x, y, 5) || findPath(a.x, a.y, x, y, 0, 250)) return { x, y };
  }
  return null;
}

// a rabbit with berries in range grazes toward them - that is what makes a
// patch of bushes read as a warren; everyone else just picks an open way out
function preyWander(a) {
  if (a.kind === 'rabbit') {
    const b = nearestBerryBush(a.x, a.y, 7);
    if (b) {
      const bx = b.tx * TILE + 8, by = b.ty * TILE + 8;
      if (Math.hypot(bx - a.x, by - a.y) < 22) return null; // already nibbling it
      return wanderGoal(a, Math.atan2(by - a.y, bx - a.x), 0.5, 2, 5);
    }
  }
  return wanderGoal(a, rng() * Math.PI * 2, Math.PI, 3, 6);
}

// rabbits and deer: wander, nibble, and bolt from anyone who gets close
function updatePrey(a, dt) {
  const rabbit = a.kind === 'rabbit';
  const r = rabbit ? 2.5 : 5;

  // both prey bolt from a player who gets close - the deer from further out
  // than the rabbit. The ring is what the player is SEEN at, so GHOSTSTEP
  // and lying buried in the snow are how a hunter closes on a deer at all.
  let scare = null, sd = 1e9;
  for (const p of players) {
    if (!p.active || p.dead || inAir(p)) continue;
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < sd) { sd = d; scare = p; }
  }
  if (a.fleeT <= 0 && scare && sd < seenAt(scare, FLEE_SIGHT[a.kind] || 0)) {
    const t = FLEE_TIME[a.kind];
    a.fleeT = rand(t[0], t[1]);
    a.goal = null; navClear(a); // the graze is off
  }

  let moving = false;
  if (a.fleeT > 0) {
    a.fleeT -= dt;
    const from = scare || player;
    // the flight is a chain of routed legs a few tiles long, each picked
    // away from the threat; a leg that fails or arrives hands over to the next
    if (!a.fleeGoal) a.fleeGoal = fleeGoal(a, from);
    if (a.fleeGoal) {
      const n = navStep(a, a.fleeGoal.x, a.fleeGoal.y, r, PREY_RUN[a.kind], dt);
      if (!n.ok || n.d < 6) a.fleeGoal = null;
      moving = true;
    } else {
      a.fleeT = 0; // cornered: nowhere to run
    }
    if (a.fleeT <= 0) { a.fleeGoal = null; navClear(a); a.idleT = rand(0.4, 1); }
  } else if (a.goal) {
    // grazing is a routed walk to a real tile: it rounds the trees instead of
    // bumping them, and it ends on the spot the animal was heading for
    const n = navStep(a, a.goal.x, a.goal.y, r, PREY_SPD[a.kind], dt);
    if (!n.ok || n.d < 6) { a.goal = null; navClear(a); a.idleT = rabbit ? rand(0.8, 2.2) : rand(1.6, 4); }
    else moving = true;
  } else {
    a.idleT -= dt;
    // a shove (arrow or unit collision) still moves an idle animal
    if (Math.abs(a.kbx) + Math.abs(a.kby) > 1) moveEntity(a, a.kbx * dt, a.kby * dt, r);
    if (a.idleT <= 0) {
      a.goal = preyWander(a);
      if (!a.goal) a.idleT = rand(1.5, 3); // nibbling where it stands, or boxed in
    }
  }

  if (moving && Math.abs(a.mvx) > 0.05) a.dir = a.mvx > 0 ? 'right' : 'left';
  a.animT += dt * (moving ? (rabbit ? 10 : 7) : 0);
  a.moving = moving;
}

// what a kill pays: one profile per kind, all of it out of the YIELD table,
// straight into the wallet of whoever landed the final blow (a.lastHit,
// stamped by hurtAnimal) - gold is never a physical drop. A HUNTSMAN's kill
// pays its bonus on top of the same award; a kill nobody is left alive to
// credit pays nobody.
function animalDies(a) {
  a.dead = true;
  if (nearPlayer(a.x, a.y)) SFX.monsterDie(a.kind);
  const hunter = a.lastHit !== undefined ? players[a.lastHit] : null;
  const y = YIELD[a.kind];
  if (hunter && !hunter.dead && y && y.coins) {
    const bonus = Math.max(0, Math.ceil(y.coins * y.each * (kitOf(hunter).huntMul - 1)));
    awardGold(hunter, y.coins * y.each + bonus, a.x, a.y - (a.alt || 0));
  }
  if (a.kind === 'rabbit') {
    burst(a.x, a.y - 3, '#eef2fa', 10, 45, 0.5);
    burst(a.x, a.y - 3, '#c9d0e2', 6, 35, 0.4);
    spawnDrop(a.x, a.y, 'berry');
  } else if (a.kind === 'deer') {
    burst(a.x, a.y - 5, '#8a6847', 12, 50, 0.55);
    burst(a.x, a.y - 5, '#f2cc6a', 8, 45, 0.5);
  } else if (a.kind === 'wolf') {
    burst(a.x, a.y - 5, '#6f778c', 12, 50, 0.55);
    burst(a.x, a.y - 5, '#e04a54', 8, 45, 0.5);
    addFloater(a.x, a.y - 26, 'WOLF DOWN', '#f2cc6a');
  } else if (a.kind === 'bird') {
    burst(a.x, a.y - a.alt, '#cfd6e4', 9, 40, 0.5, true);
    flushBirds(a.home, a); // the rest of the flock does not stay to watch
  }
}

// landmark inhabitants (the places themselves are the LANDMARKS table in
// the landmarks banner). Wolves are the only thing in the world that hunts
// a player; birds are the only thing that flies.
const WOLF_SIGHT = 96;     // px: the one circle a wolf's threat turns on - fills inside, drains outside (x1.75 at full dark)
const WOLF_SPD = 96;       // px/s hunting: faster than a walk, slower than a slide
const WOLF_BITE_R = 13;    // px reach of a bite
const WOLF_BITE_DMG = 9;
const WOLF_BITE_CD = 1;    // s between one wolf's bites (damagePlayer's i-frames cap the pack)
const WOLF_THREAT_T = 2.5;   // s lingering at the edge of its sight before a wolf charges; three times as fast at its nose
const WOLF_THREAT_DECAY = 3; // s for a full threat bar to drain outside its sight - then the wolf goes home
const BIRD_FLUSH = 34;     // px: a player this close puts the whole rookery up
const BIRD_SPD = 112;      // px/s in flight
const BIRD_ALT = 15;       // px a perched bird sits above its tile; flight climbs past it

// ------------------------------------------------------------ wolves
// A wolf holds station at its den and watches anyone who comes inside its
// sight (much further after dark). One circle rules the whole thing: inside
// it the threat bar fills while they linger - faster the closer they stand -
// and outside it the bar drains. Full, the wolf charges and runs them down at
// WOLF_SPD - faster than a walk, slower than a slide, so the answer is
// momentum, not distance - biting on its own cooldown, and it keeps coming
// while the bar drains; the hunt ends when the bar is empty, and then it goes
// home. There is no leash: the only way off a wolf is out of its circle for
// long enough.
// A hit skips the bar: the den comes for a shooter at once. damagePlayer's
// i-frames are what stops four wolves shredding anyone instantly: the pack is
// pressure, not burst. Waking one wakes the den, which is what makes it a
// place instead of four animals.
function wakePack(w, t) {
  if (!t) return;
  if (!w.home) { w.target = t; w.threat = 1; return; }
  let howl = false;
  for (const o of animals) {
    if (o.dead || o.kind !== 'wolf' || o.home !== w.home) continue;
    if (!o.target) howl = true;
    o.target = t; o.threat = 1;
  }
  if (howl && nearPlayer(w.x, w.y, 260)) SFX.howl();
}

function updateWolf(a, dt) {
  const L = a.home;
  const hx = L ? (L.tx + 0.5) * TILE : a.x, hy = L ? (L.ty + 0.5) * TILE : a.y;
  a.biteCd = Math.max(0, a.biteCd - dt);

  const sight = WOLF_SIGHT * (1 + state.darkness * 0.75); // night gives the pack its teeth
  // the nearest slot inside the circle. GHOSTSTEP - and lying buried in the
  // snow - shrink it for that one slot
  let near = null, nd = sight;
  for (const p of players) {
    if (!p.active || p.dead || inAir(p)) continue;
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < nd && d < seenAt(p, sight)) { nd = d; near = p; }
  }

  let t = a.target;
  if (t && (!t.active || t.dead || inAir(t))) { t = null; a.threat = 0; navClear(a); }
  if (t) {
    // hunting: the bar holds while the quarry is inside the circle and drains
    // while it is out; the chase goes on either way until the bar is empty
    if (Math.hypot(t.x - a.x, t.y - a.y) < seenAt(t, sight)) a.threat = 1;
    else {
      a.threat = Math.max(0, a.threat - dt / WOLF_THREAT_DECAY);
      if (a.threat <= 0) { t = null; navClear(a); } // the quarry got away; home
    }
  } else if (near) {
    // lingering in the circle fills the bar, three times as fast at the
    // wolf's nose as at the edge; full, the whole den charges
    a.threat = Math.min(1, a.threat + dt / WOLF_THREAT_T * (1 + 2 * (1 - nd / sight)));
    if (a.threat >= 1) { wakePack(a, near); t = near; }
  } else a.threat = Math.max(0, a.threat - dt / WOLF_THREAT_DECAY);
  a.target = t;

  let moving = false;
  if (t) {
    if (a.goal) { a.goal = null; navClear(a); } // the patrol is off; the quarry is the route now
    // run the route to the quarry; with no route (it is out over water, or
    // the pack has it pinned) hold and face it
    const n = navStep(a, t.x, t.y, 4.5, WOLF_SPD, dt);
    const d = n.d || 1;
    if (!n.ok) { a.mvx = (t.x - a.x) / d; a.mvy = (t.y - a.y) / d; }
    moving = n.ok;
    if (d < WOLF_BITE_R && a.biteCd <= 0) {
      a.biteCd = WOLF_BITE_CD;
      damagePlayer(t, WOLF_BITE_DMG, a.mvx, a.mvy, null, 'wolf');
      burst(a.x + a.mvx * 6, a.y - 4, '#e04a54', 5, 40, 0.35);
      if (nearPlayer(a.x, a.y)) SFX.bite();
    }
  } else if (near && a.threat > 0) {
    // squared up: a wolf whose bar is filling stands and faces them - the
    // warning before the charge
    if (a.goal) { a.goal = null; navClear(a); }
    a.mvx = (near.x - a.x) / (nd || 1); a.mvy = (near.y - a.y) / (nd || 1);
    if (Math.abs(a.mvx) > 0.05) a.dir = a.mvx > 0 ? 'right' : 'left';
  } else if (a.goal) {
    // patrolling its den, on a route like any other walk
    const n = navStep(a, a.goal.x, a.goal.y, 4.5, 34, dt);
    if (!n.ok || n.d < 6) { a.goal = null; navClear(a); a.idleT = rand(0.8, 2.6); }
    else moving = true;
  } else {
    a.idleT -= dt;
    if (Math.abs(a.kbx) + Math.abs(a.kby) > 1) moveEntity(a, a.kbx * dt, a.kby * dt, 4.5);
    if (a.idleT <= 0) {
      // pick the next patrol leg, but never far from the den it belongs to:
      // out past the ring and the only way it will walk is back toward home
      const ring = (L ? L.r : 4) * TILE * 0.8;
      const out = Math.hypot(a.x - hx, a.y - hy) > ring;
      a.goal = wanderGoal(a, out ? Math.atan2(hy - a.y, hx - a.x) : rng() * Math.PI * 2,
        out ? 0.5 : Math.PI, 2, 5);
      if (!a.goal) a.idleT = rand(0.8, 2.6);
    }
  }

  if (moving && Math.abs(a.mvx) > 0.05) a.dir = a.mvx > 0 ? 'right' : 'left';
  a.animT += dt * (moving ? (t ? 12 : 6) : 0);
  a.moving = moving;
}

// ------------------------------------------------------------ birds
// Perched in the rookery's snags until a player gets inside BIRD_FLUSH, and
// then the whole stand goes up at once - the flock is the point, one bird
// leaving alone would read as a bug. In the air they are the hardest shot in
// the game: small body, no straight line, and they come down again on their
// own perch when they have settled.
function flushBirds(L, from) {
  if (!L) return;
  let woke = false;
  for (const b of animals) {
    if (b.dead || b.kind !== 'bird' || b.home !== L) continue;
    if (b.flyT <= 0) { woke = true; burst(b.x, b.y - b.alt, '#cfd6e4', 4, 30, 0.35); }
    b.flyT = Math.max(b.flyT, rand(2.4, 4.2));
    b.fa = Math.atan2(b.y - from.y, b.x - from.x) + rand(-0.7, 0.7);
    b.perch = rookeryPerch(L) || b.perch;
  }
  if (woke && nearPlayer(from.x, from.y, 220)) SFX.wings();
}

function updateBird(a, dt) {
  const L = a.home;
  // anyone this close puts the whole rookery up (only a bird still on its
  // perch tests for it - once the flock is up there is nothing left to flush)
  if (a.flyT <= 0) for (const p of players) {
    if (!p.active || p.dead || inAir(p)) continue;
    if (Math.hypot(p.x - a.x, p.y - (a.y - a.alt)) < BIRD_FLUSH) { flushBirds(L, p); break; }
  }

  if (a.flyT > 0) {
    a.flyT -= dt;
    a.alt += (26 - a.alt) * Math.min(1, dt * 2.5);
    // the last beat of the flight is the run back to the perch; before that
    // it is a wandering circuit that never leaves the stand
    const home = a.perch ? { x: (a.perch.tx + 0.5) * TILE, y: (a.perch.ty + 0.5) * TILE }
      : { x: (L ? L.tx + 0.5 : a.x / TILE) * TILE, y: (L ? L.ty + 0.5 : a.y / TILE) * TILE };
    const out = Math.hypot(a.x - home.x, a.y - home.y);
    if (a.flyT < 1.1 || out > (L ? L.r + 2 : 6) * TILE) {
      const want = Math.atan2(home.y - a.y, home.x - a.x);
      let da = want - a.fa;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      a.fa += Math.max(-4 * dt, Math.min(4 * dt, da));
    } else {
      a.fa += Math.sin(a.animT * 1.7) * 2.2 * dt;
    }
    // a bird steers itself rather than routing, so the net/crater drag has to
    // be folded in by hand here - navStep does it for everything that walks
    const bs = BIRD_SPD * unitMoveMul(a);
    a.x += Math.cos(a.fa) * bs * dt;
    a.y += Math.sin(a.fa) * bs * dt;
    a.mvx = Math.cos(a.fa);
    // never pop across the stand: stay up until it is actually over the perch
    if (a.flyT <= 0) {
      if (out > 8) a.flyT = 0.25;
      else if (a.perch) { a.x = home.x + rand(-3, 3); a.y = home.y; }
    }
  } else {
    // perched: settle into the branches and shuffle about
    a.alt += (BIRD_ALT - a.alt) * Math.min(1, dt * 4);
    a.idleT -= dt;
    if (a.idleT <= 0) { a.idleT = rand(0.9, 3); a.dir = rng() < 0.5 ? 'left' : 'right'; }
  }

  if (a.flyT > 0 && Math.abs(a.mvx) > 0.05) a.dir = a.mvx > 0 ? 'right' : 'left';
  a.animT += dt * (a.flyT > 0 ? 14 : 0);
  a.moving = a.flyT > 0;
  a.x = Math.max(8, Math.min(WORLD * TILE - 8, a.x));
  a.y = Math.max(8, Math.min(WORLD * TILE - 8, a.y));
}


