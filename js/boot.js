// Softfall - a cozy winter survival game.
'use strict';
// The last file to load: the eagle drop that opens every match, the boot
// order, window.DBG and the requestAnimationFrame loop.

// ------------------------------------------------------------ eagle drop
// Nobody spawns in a camp: after LOCK IN each TEAM rides its own armoured
// eagle - RED and BLUE fly the one seed-fixed line in opposite directions,
// each keeping EAGLE_LANE to its own right so the pass mid-route is a clean
// fly-by (mode 'drop'). The view zooms out to DROP_ZOOM, the flight path is
// dotted across the snow itself (M raises the world map for the wider read),
// and a rider jumps with Space/Enter/E/click - but only inside the JUMP
// WINDOW: the line's last DROP_LOCK_T seconds, gold on the flight bar and on
// the dotted line both (AI slots jump at their own hashed fraction of the
// window). A jumper free-falls for FALL_T onto the nearest open tile, which
// becomes its spawn tile (the bot brain's home); the human's landing snaps
// the view back to the player's own zoom and runs the HUD slide-in. A rider
// who never jumps is dropped at the window's end - the last open ground
// before the treeline, never in the trees - and a profile's very first
// flight counts down and jumps itself at TUT_DROP_T. state.drop outlives
// mode 'drop' - and now the whole match: past the line's end each bird dives
// into the treeline, blows a crater in the trees, and sits there as its
// team's OBJECTIVE - guarding itself with a wing gust and calming back down
// (preen regen) between scares. Keep its nerve up: at zero the bird is
// DRIVEN OFF (hurtEagle / eagleFlee), and its whole side falls with it.
                            // the ride's framing is DROP_ZOOM (canvas banner): half scale, twice the view
const EAGLE_FLIGHT_T = 10;  // s: every seed's line takes exactly this long (speed derives from length)
const DROP_LOCK_T = 4;      // s: the jump only unlocks over the line's last stretch
const DROP_EDGE_MARGIN = 3; // tiles of open ground a forced drop keeps clear of the treeline
const TUT_DROP_T = 8;       // s: a profile's first flight ever jumps itself here (near the tree edge, clear of the mid-route pass)...
const TUT_COUNT = 5;        // ...counted down over this many seconds ahead of it
const EAGLE_R = WORLD / 2 - 40; // route endpoints sit this many tiles from the centre (over the treeline)
const FALL_T = 1.3;         // seconds of free fall
const DRIFT_SPD = 130;      // px/s a faller steers sideways with WASD (~10 tiles over the fall)
const DROP_ALT = 56;        // screen px between the bird / a faller and its shadow
const EAGLE_SCALE = 3;      // the bird is huge and high above the ground: drawn at 3x in flight
const EAGLE_REST_SCALE = 2; // ...settling to 2x once it roosts (the dive walks 3 down to 2)
const RIDER_SCALE = 2;      // the riders on its wings, and where a faller's shrink starts
const EAGLE_LANE = 2.5 * TILE; // each bird keeps this far to its own right of the shared line
const EAGLE_DIVE_T = 1.4;   // seconds from the end of the line to the treeline impact
const EAGLE_SETTLE_T = 0.6; // seconds of wing-fold after the impact, into the resting pose
const EAGLE_HP = 320;       // the grounded objective's nerve: hits spook it, at zero it flees
const EAGLE_WORK_DMG = 10;  // what one rival E swing chips off the roosting bird
const EAGLE_TILE_R = 1.6;   // tiles around the roost marked solid - the hitbox arrows AND walkers test
const MIN_CRASH_TREES = 20; // trees the crash site's 7x7 must hold - the roost sits properly INSIDE the woods
// the wing gust: the bird's own defense. A rival inside GUST_R makes it rear
// up - wings spread for GUST_WIND_T, the whole telegraph - then the buffet
// throws every rival in GUST_BLAST_R into a tumble. No damage on purpose: the
// objective punishes face-tanking, it never earns kills.
const GUST_R = 44;          // px: how close a rival can stand before the bird rears
const GUST_BLAST_R = 56;    // px: the buffet itself reaches a little further
const GUST_WIND_T = 0.5;    // s of wings-spread windup before the blast
const GUST_CD = 4;          // s between gusts
const GUST_KB = 300;        // knockback impulse (px/s)
const GUST_STUN = 0.7;      // s of tumble
const PREEN_DELAY = 6;      // s unhit before the bird starts calming down...
const PREEN_RATE = 2;       // ...recovering this much nerve per second
const FLEE_LIFT_T = 1.1;    // s of takeoff: turn away, climb, downdraft
const FLEE_T = 5.5;         // s total from liftoff to gone (fading over the last stretch)
const FLEE_SPD = 220;       // px/s once airborne - faster than it arrived, it wants out
const EAGLE_CINE_T = 3.2;   // s the camera holds the takeoff before the end screens queue
const RUFFLE_T = 0.45;      // s of the resting idle's wing shuffle (frame 1 only - a full
                            // spread is the gust telegraph, and the idle must never wear it)
const BOOM_R = 2.6;         // tiles of trees the impact clears outright...
const BOOM_STUMP_R = 3.6;   // ...and the ring beyond snapped to stumps
const BOOM_LIFE = 0.9;      // seconds the impact shockwave rings run
// where the five riders sit, in the bird's own frame (x along the heading,
// y across the wings, unscaled sprite px): one on its back, two on the inner
// wings, two out on the primaries. Seat 0 is the roster's first slot per team
// - the human, on their own bird.
const EAGLE_SEATS = [[-2, 0], [2, -11], [2, 11], [-7, -19], [-7, 19]];

// the seed's line: two points on a ring just inside the forest, roughly
// opposite each other. hash2 only - never rng(), which would reshuffle seeds.
function makeEagleRoute() {
  const c = WORLD * TILE / 2;
  const a0 = hash2(3, 141) * Math.PI * 2;
  const a1 = a0 + Math.PI + (hash2(5, 77) - 0.5) * 1.4;
  const x0 = c + Math.cos(a0) * EAGLE_R * TILE, y0 = c + Math.sin(a0) * EAGLE_R * TILE;
  const x1 = c + Math.cos(a1) * EAGLE_R * TILE, y1 = c + Math.sin(a1) * EAGLE_R * TILE;
  const len = Math.hypot(x1 - x0, y1 - y0);
  return { x0, y0, x1, y1, len, dur: EAGLE_FLIGHT_T, heading: Math.atan2(y1 - y0, x1 - x0) };
}

// the last point on a bird's line still over open ground: forced drops land
// here, never in the trees. borderDepth (world.js) is the forest boundary
// itself, so the answer moves with the seed's actual treeline, pure reads only.
function lastOpenU(e) {
  const n = Math.ceil(e.len / TILE);
  for (let i = n; i >= 0; i--) {
    const u = i / n;
    const tx = Math.floor((e.x0 + (e.x1 - e.x0) * u) / TILE);
    const ty = Math.floor((e.y0 + (e.y1 - e.y0) * u) / TILE);
    if (!inWorld(tx, ty)) continue;
    const edge = Math.min(tx, ty, WORLD - 1 - tx, WORLD - 1 - ty);
    if (edge > borderDepth(tx, ty) + DROP_EDGE_MARGIN) return u;
  }
  return 0.5;
}

// two birds on the one line, flying it opposite ways: team 0 start-to-end,
// team 1 end-to-start, each shifted EAGLE_LANE along its own right-hand
// perpendicular so they pass beside each other instead of head-on.
function makeEagles() {
  const r = makeEagleRoute();
  return [0, 1].map((team) => {
    const h = team === 0 ? r.heading : r.heading + Math.PI;
    const rx = -Math.sin(h) * EAGLE_LANE, ry = Math.cos(h) * EAGLE_LANE; // the bird's own right
    const sx = (team === 0 ? r.x0 : r.x1) + rx, sy = (team === 0 ? r.y0 : r.y1) + ry;
    const ex = (team === 0 ? r.x1 : r.x0) + rx, ey = (team === 0 ? r.y1 : r.y0) + ry;
    const e = {
      team, heading: h, len: r.len, dur: r.dur, spd: r.len / r.dur,
      x0: sx, y0: sy, x1: ex, y1: ey, x: sx, y: sy,
      jumpOpen: 0, jumpEnd: 1,      // the jump window, as fractions of the line
      t: 0, prog: 0, flap: team * 0.4,
      state: 'fly',                 // fly -> dive -> down (the objective) -> flee -> gone
      diveT: 0, from: null, crash: null, restT: 0,
      hp: EAGLE_HP, maxHp: EAGLE_HP, flash: 0, boomT: 0,
      gustCd: 0, windT: 0, hitT: 99,          // the wing gust and the calm-down clock
      idleT: 3 + team * 2, ruffleT: 0,        // the resting idle: seconds to the next wing shuffle (offset so the birds never sync)
      fleeT: 0, fleeFrom: 0, fleeTo: 0,       // the driven-off takeoff
    };
    e.jumpEnd = lastOpenU(e);
    e.jumpOpen = Math.min((e.dur - DROP_LOCK_T) / e.dur, e.jumpEnd - 0.05);
    return e;
  });
}

// a seat's world position on a bird right now: the seat offset rotated by the
// heading, off the bird's centre
function seatPos(e, si) {
  const s = EAGLE_SEATS[si % EAGLE_SEATS.length];
  const dx = s[0] * EAGLE_SCALE, dy = s[1] * EAGLE_SCALE;
  const c = Math.cos(e.heading), sn = Math.sin(e.heading);
  return { x: e.x + dx * c - dy * sn, y: e.y + dx * sn + dy * c };
}

function beginDrop() {
  PROFILE.addDay(); // day 1 of the days-played stat: the clock starts with the eagle
  // a profile's first flight ever counts itself down and jumps for you -
  // reading the ride is a lot to ask of someone who has never seen it
  state.drop = { eagles: makeEagles(), firstFlight: !PROFILE.hasDropped() };
  const seats = [0, 0]; // next free wing seat per team; slot 0 takes seat 0 on the red bird
  for (const p of players) {
    if (!p.active) continue;
    const e = state.drop.eagles[p.team];
    p.aboard = true; p.dropT = 0;
    p.seat = seats[p.team]++;
    const sp = seatPos(e, p.seat);
    p.x = sp.x; p.y = sp.y;
    // bots spread across the jump window; the human rides to the window's end
    // (the last open ground before the trees) unless they jump - except the
    // first flight, which jumps itself at TUT_DROP_T
    p.dropU = p.control === 'ai'
      ? e.jumpOpen + (e.jumpEnd - e.jumpOpen) * (0.08 + 0.84 * hash2(p.id * 31 + 5, 9))
      : (state.drop.firstFlight ? Math.min(TUT_DROP_T / e.dur, e.jumpEnd) : e.jumpEnd);
  }
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

// off the bird: fall straight down from where it is right now. The door only
// opens over the line's last DROP_LOCK_T seconds - a manual jump before that
// is refused (force is the sim's own drops: the window's end, the dive).
function dropJump(p, force) {
  if (!p.aboard || !state.drop) return;
  const d = state.drop.eagles[p.team];
  if (!force && d.state === 'fly' && d.t < d.dur - DROP_LOCK_T) {
    if (p === player) SFX.deny();
    return;
  }
  p.aboard = false;
  p.dropT = FALL_T;
  // the leap starts from the wing seat the rider was sitting on (p.x/p.y are
  // already there - updateDrop keeps every rider glued to its seat), so the
  // fall visibly begins at the wing; drawDropAir adds the hop off it
  if (p.control === 'ai') { // scatter bots off the line so they don't stack
    const off = (hash2(p.id * 7 + 1, 33) - 0.5) * 8 * TILE;
    p.x += -Math.sin(d.heading) * off;
    p.y += Math.cos(d.heading) * off;
  }
  if (p === player) {
    PROFILE.markDropped(); // the first-flight countdown never comes back after a real jump
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
  // the shafts that lit the ride hang on a few seconds past the boots landing,
  // then go: the light of the drop belongs to the drop (RAY_AFTER, draw-world.js)
  if (p === player) state.rayT = RAY_AFTER;
  burst(p.x, p.y - 2, '#f4f7ff', 16, 70, 0.5, true);
  if (p === player) {
    state.mode = 'play';
    state.mapOpen = false;            // a chart left up mid-flight comes down for the landing
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
  // the driven-off ceremony: hold on the takeoff, then let the screens come
  const cine = state.eagleCine;
  if (cine) {
    cine.t += dt;
    if (cine.t >= EAGLE_CINE_T) {
      state.eagleCine = null; // cleared first, so the resolve's endMatch path runs clean
      eagleFleeResolve(state.drop.eagles[cine.team], cine.srcId >= 0 ? players[cine.srcId] : null);
    }
  }
  for (const e of state.drop.eagles) updateEagle(e, dt);
  for (const p of players) {
    if (!p.active) continue;
    if (p.aboard) {
      const e = state.drop.eagles[p.team];
      const sp = seatPos(e, p.seat);
      p.x = sp.x; p.y = sp.y;
      if (e.prog >= p.dropU) dropJump(p, true); // the window's end drops whoever is still riding
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
}

// one bird's whole life: the flight, the dive past the line's end, and the
// grounded objective it becomes. state.drop never goes null - the wrecks ARE
// the match now.
function updateEagle(e, dt) {
  e.flap += dt;
  if (e.flash > 0) e.flash -= dt;
  if (e.boomT > 0) e.boomT -= dt;
  if (e.state === 'fly') {
    e.t += dt;
    const dist = Math.min(e.spd * e.t, e.len);
    e.prog = Math.min(1, dist / e.len);
    e.x = e.x0 + Math.cos(e.heading) * dist;
    e.y = e.y0 + Math.sin(e.heading) * dist;
    if (e.prog >= 1) beginDive(e);
  } else if (e.state === 'dive') {
    e.diveT += dt;
    const u = Math.min(1, e.diveT / EAGLE_DIVE_T);
    e.x = e.from.x + (e.crash.x - e.from.x) * u;
    e.y = e.from.y + (e.crash.y - e.from.y) * u;
    // speed motes stream off the stoop
    particles.push({
      x: e.x - Math.cos(e.heading) * rand(14, 26), y: e.y - Math.sin(e.heading) * rand(14, 26),
      vx: -Math.cos(e.heading) * 30, vy: -Math.sin(e.heading) * 30,
      life: 0.3, maxLife: 0.3, color: '#f4f7ff', size: 1, grav: 0, alpha: 0.5,
    });
    if (u >= 1) eagleCrash(e);
  } else if (e.state === 'down') {
    e.restT += dt; // drives the wing-fold settle, then the breathing at rest
    // preen: unbothered for PREEN_DELAY, the bird calms back down - the bar
    // visibly refilling is the whole announcement, so chip damage must be
    // pressed home or it evaporates
    e.hitT += dt;
    if (e.hitT > PREEN_DELAY && e.hp < e.maxHp) {
      e.hp = Math.min(e.maxHp, e.hp + PREEN_RATE * dt);
      if (rng() < dt * 2) particles.push({
        x: e.x + rand(-10, 10), y: e.y + rand(-8, 2),
        vx: rand(-3, 3), vy: -rand(6, 12),
        life: 0.7, maxLife: 0.7, color: '#f6f8ff', size: 1, grav: -4, alpha: 0.6,
      });
    }
    // the resting idle: every few seconds the bird shuffles its wings and a
    // little snow settles off them - alive between scares, never mistakable
    // for the gust telegraph (drawEagle keeps the shuffle off the spread frame)
    if (e.ruffleT > 0) e.ruffleT -= dt;
    else if (e.restT > EAGLE_SETTLE_T && e.windT <= 0) {
      e.idleT -= dt;
      if (e.idleT <= 0) {
        e.idleT = rand(3.5, 7);
        e.ruffleT = RUFFLE_T;
        for (let i = 0; i < 3; i++) particles.push({
          x: e.x + rand(-14, 14), y: e.y + rand(-9, 3),
          vx: rand(-8, 8), vy: rand(4, 14),
          life: 0.5, maxLife: 0.5, color: '#eef4fb', size: 1, grav: 40, alpha: 0.7,
        });
      }
    }
    // the wing gust, once it has finished settling in
    if (e.windT > 0) {
      e.windT -= dt;
      if (e.windT <= 0) eagleGust(e);
    } else if (e.gustCd > 0) e.gustCd -= dt;
    else if (e.restT > EAGLE_SETTLE_T) {
      for (const q of players) {
        if (!q.active || q.dead || inAir(q) || q.team === e.team) continue;
        if (Math.hypot(q.x - e.x, q.y - e.y) < seenAt(q, GUST_R)) { e.windT = GUST_WIND_T; break; }
      }
    }
  } else if (e.state === 'flee') {
    e.fleeT += dt;
    const u = Math.min(1, e.fleeT / FLEE_LIFT_T);
    // the takeoff turn: from however the dive left it pointing, around to the
    // nearest treeline (away from the world's centre), shortest way round
    let turn = e.fleeTo - e.fleeFrom;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    e.heading = e.fleeFrom + turn * u;
    // downdraft while the wings are winning: snow blown out under the climb
    if (u < 1 && rng() < dt * 20) {
      const a = rng() * Math.PI * 2;
      particles.push({
        x: e.x + Math.cos(a) * 8, y: e.y + Math.sin(a) * 5,
        vx: Math.cos(a) * rand(60, 110), vy: Math.sin(a) * rand(40, 70),
        life: 0.4, maxLife: 0.4, color: '#eef4fb', size: 2, grav: 60,
      });
    }
    if (u >= 1) {
      e.x += Math.cos(e.heading) * FLEE_SPD * dt;
      e.y += Math.sin(e.heading) * FLEE_SPD * dt;
    }
    if (e.fleeT >= FLEE_T) e.state = 'gone';
  }
}

// the buffet lands: every rival in the ring is thrown into a tumble and blown
// out of the snow if they were under it. No damage - the tumble IS the price.
function eagleGust(e) {
  e.gustCd = GUST_CD;
  eagleGustFx(e, 1);
  if (nearPlayer(e.x, e.y)) SFX.gust();
  for (const q of players) {
    if (!q.active || q.dead || inAir(q) || q.team === e.team) continue;
    const dx = q.x - e.x, dy = q.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > GUST_BLAST_R) continue;
    const nx = d > 0 ? dx / d : 1, ny = d > 0 ? dy / d : 0;
    q.kbx = nx * GUST_KB; q.kby = ny * GUST_KB;
    stunUnit(q, GUST_STUN);
    risePlayer(q); // wind strips the snow off a buried body
    burst(q.x, q.y - 6, '#eef4fb', 6, 50, 0.4, true);
  }
}

// the gust's language, shared with the takeoff (k scales it): a low ring of
// blown snow and a flattened shockwave, feathers drifting up after
function eagleGustFx(e, k) {
  e.boomT = Math.min(BOOM_LIFE, BOOM_LIFE * 0.6 * k);
  const n = Math.round(16 * k);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    particles.push({
      x: e.x + Math.cos(a) * 8, y: e.y - 2 + Math.sin(a) * 5,
      vx: Math.cos(a) * (80 + rng() * 40) * k, vy: Math.sin(a) * (50 + rng() * 25) * k,
      life: 0.45, maxLife: 0.45, color: '#e8eef8', size: 2, grav: 55,
    });
  }
  burst(e.x, e.y - 10, '#f6f8ff', Math.round(5 * k), 40, 0.9, true);
}

// the end of the line: whoever is still aboard is thrown, and the bird tips
// over into its dive toward the nearest standing forest past the line's end
function beginDive(e) {
  for (const p of players) if (p.active && p.aboard && p.team === e.team) dropJump(p, true);
  e.state = 'dive';
  e.from = { x: e.x, y: e.y };
  e.crash = findCrashPoint(e);
  e.diveT = 0;
}

// walk out past the line's end looking for DEEP forest: the first spot whose
// 7x7 holds MIN_CRASH_TREES takes the impact, so the roost always sits a
// proper way into the woods rather than kissing the tree edge. Pure reads -
// no rng(), no hash2 - so the same seed buries the same bird in the same
// trees; the densest spot seen stands in if no window ever fills.
function findCrashPoint(e) {
  const hx = Math.cos(e.heading), hy = Math.sin(e.heading);
  let best = null, bestTrees = -1;
  for (let step = 8; step <= 44; step++) {
    const tx = Math.floor((e.x + hx * step * TILE) / TILE);
    const ty = Math.floor((e.y + hy * step * TILE) / TILE);
    if (tx < 4 || ty < 4 || tx >= WORLD - 4 || ty >= WORLD - 4) break;
    let trees = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const o = inWorld(tx + dx, ty + dy) && objAt(tx + dx, ty + dy);
      if (o && (o.type === 'tree' || o.type === 'deadTree')) trees++;
    }
    if (trees >= MIN_CRASH_TREES) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    if (trees > bestTrees) { bestTrees = trees; best = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }; }
  }
  if (best) return best;
  const tx = Math.max(4, Math.min(WORLD - 5, Math.floor((e.x + hx * 8 * TILE) / TILE)));
  const ty = Math.max(4, Math.min(WORLD - 5, Math.floor((e.y + hy * 8 * TILE) / TILE)));
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}

// impact: the near trees are blown apart outright, the ring beyond snapped to
// stumps, and the bird is DOWN - a grounded objective with an hp pool its
// team keeps alive from here on. The blast pays no gold: a crater full of
// free fells would warp the economy at minute one.
function eagleCrash(e) {
  e.state = 'down';
  e.restT = 0;
  e.x = e.crash.x; e.y = e.crash.y;
  const ctx0 = Math.floor(e.x / TILE), cty0 = Math.floor(e.y / TILE);
  const R = Math.ceil(BOOM_STUMP_R);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const tx = ctx0 + dx, ty = cty0 + dy;
    if (!inWorld(tx, ty) || Math.hypot(dx, dy) > BOOM_STUMP_R) continue;
    const o = objAt(tx, ty);
    if (!o || (o.type !== 'tree' && o.type !== 'deadTree')) continue;
    const ox = tx * TILE + 8, oy = ty * TILE + 8;
    objects[idx(tx, ty)] = Math.hypot(dx, dy) <= BOOM_R ? null : { type: 'stump', tx, ty, flash: 0, shake: 0 };
    burst(ox, oy - 8, '#eef4fb', 8, 70, 0.6, true);
    burst(ox, oy - 8, o.type === 'tree' ? '#2f5c4b' : '#6b5a48', 5, 60, 0.55, true);
    burst(ox, oy - 6, '#6b5a48', 4, 55, 0.5, true);
  }
  // the roost's hitbox: `eagle` objects on the tiles under the bird - solid
  // to walkers, a work target for rival E swings (their OBJECTS entry), and
  // drawn by drawEagle, never the object pass. Anything the blast didn't
  // clear (a rock) keeps its tile.
  const TR = Math.ceil(EAGLE_TILE_R);
  for (let dy = -TR; dy <= TR; dy++) for (let dx = -TR; dx <= TR; dx++) {
    const tx = ctx0 + dx, ty = cty0 + dy;
    if (!inWorld(tx, ty) || Math.hypot(dx, dy) > EAGLE_TILE_R) continue;
    if (!objAt(tx, ty) && ground[idx(tx, ty)] !== 2) placeObj(tx, ty, 'eagle', { team: e.team });
  }
  eagleBoomFx(e, 1);
  const near = Math.hypot(player.x - e.x, player.y - e.y);
  state.shake = Math.max(state.shake, near < 400 ? 9 : near < 1000 ? 5 : 3);
  SFX.boom();
  logEvent('THE ' + TEAMS[e.team].name + ' EAGLE HAS LANDED', players.find((p) => p.team === e.team));
}

// the impact language, shared by the landing and the loss (k scales it up):
// snow thrown high, the team's colours in it, feathers left hanging, and a
// low dust ring rolling out along the ground under the shockwave rings.
function eagleBoomFx(e, k) {
  e.boomT = BOOM_LIFE;
  burst(e.x, e.y - 6, '#f4f7ff', Math.round(26 * k), 110 * k, 0.7, true);
  burst(e.x, e.y - 6, TEAMS[e.team].mark, Math.round(14 * k), 90 * k, 0.6);
  burst(e.x, e.y - 12, '#f6f8ff', Math.round(10 * k), 40, 1.1, true);
  const n = Math.round(26 * k);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    particles.push({
      x: e.x + Math.cos(a) * 6, y: e.y - 2 + Math.sin(a) * 4,
      vx: Math.cos(a) * (70 + rng() * 50) * k, vy: Math.sin(a) * (44 + rng() * 30) * k,
      life: 0.55, maxLife: 0.55, color: '#dfe7f4', size: 2, grav: 60,
    });
  }
}

// a rival's arrow or E swing into the grounded bird. hx/hy is where the hit
// landed (an arrow into a wingtip puffs at the wingtip, not the body's centre);
// callers with no better point omit them.
function hurtEagle(e, dmg, src, hx, hy) {
  if (e.state !== 'down' || state.eagleCine) return; // the ceremony has the match: no second flee under it
  e.hp -= dmg;
  e.hitT = 0; // frightened again: the calm-down clock starts over
  e.flash = 0.12;
  const px = hx === undefined ? e.x : hx, py = (hy === undefined ? e.y : hy) - 8;
  burst(px, py, '#f6f8ff', 5, 45, 0.5, true);
  burst(px, py, TEAMS[e.team].mark, 3, 40, 0.4);
  if (nearPlayer(e.x, e.y)) SFX.hurt();
  if (e.hp <= 0) eagleFlee(e, src);
}

// the objective's nerve breaks: the bird is DRIVEN OFF, not killed. It blasts
// a takeoff downdraft, turns for the treeline and flies - and liftoff starts
// the DRIVEN-OFF CEREMONY (state.eagleCine): every camera glides to this bird
// (the camera banner in js/sim.js), the local controls go dead (input.js),
// and the takeoff plays for EAGLE_CINE_T before eagleFleeResolve puts the
// side down and queues the victory or defeat screen. League-style: watch the
// nexus fall, then read the word.
function eagleFlee(e, src) {
  e.state = 'flee';
  e.fleeT = 0;
  e.hp = 0;
  e.windT = 0;
  e.fleeFrom = e.heading;
  const c = WORLD * TILE / 2;
  e.fleeTo = Math.atan2(e.y - c, e.x - c); // away from the centre, out over the nearest treeline
  // the talons leave the ground: its roost tiles open back up
  const ctx0 = Math.floor(e.x / TILE), cty0 = Math.floor(e.y / TILE);
  const TR = Math.ceil(EAGLE_TILE_R);
  for (let dy = -TR; dy <= TR; dy++) for (let dx = -TR; dx <= TR; dx++) {
    const tx = ctx0 + dx, ty = cty0 + dy;
    if (!inWorld(tx, ty)) continue;
    const o = objAt(tx, ty);
    if (o && o.type === 'eagle' && o.team === e.team) objects[idx(tx, ty)] = null;
  }
  eagleGustFx(e, 2); // the takeoff downdraft: the gust's language writ large
  const near = Math.hypot(player.x - e.x, player.y - e.y);
  state.shake = Math.max(state.shake, near < 500 ? 7 : 4);
  SFX.gust();
  logEvent('THE ' + TEAMS[e.team].name + ' EAGLE WAS DRIVEN OFF', src || players.find((p) => p.team === e.team));
  state.eagleCine = { team: e.team, t: 0, srcId: src ? src.id : -1 };
}

// the ceremony's last beat, EAGLE_CINE_T after liftoff (updateDrop ticks it):
// the whole side falls with its bird - die() and teamInMatch() both read
// teamEagleDown - and checkLastStanding queues the victory or defeat screen
// while the escape keeps flying underneath it (the sim runs on in mode 'dead').
function eagleFleeResolve(e, src) {
  for (const p of players) {
    if (!p.active || p.team !== e.team) continue;
    if (!p.dead) die(p, null, 'eagle');
    else if (!p.eliminated) {
      p.eliminated = true;
      if (p === player) endMatch('lost');
    }
  }
  checkLastStanding();
}

// the objective test the death/respawn path asks (player.js): a driven-off
// eagle takes its team out of the match, Keep or no Keep
function teamEagleDown(team) {
  const e = state.drop && state.drop.eagles[team];
  return !!e && (e.state === 'flee' || e.state === 'gone');
}

// both birds, the rider and every faller, above the world and below the
// lighting. Shadows sit `alt` below (and a little right of) each body,
// converging as a dive comes down.
function drawDropAir(ex, ey, now) {
  const d = state.drop;
  if (!d) return;
  // the flight path itself, dotted over the snow in each team's colour - the
  // world-space chart. The dots crawl toward the line's end so it reads as a
  // direction, and your own bird's jump window rides it in gold, brightening
  // the moment the lock opens.
  if (state.mode === 'drop') for (const e of d.eagles) {
    if (e.state !== 'fly') continue;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 9]);
    ctx.lineDashOffset = -((now * 30) % 14);
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = TEAMS[e.team].mark;
    ctx.beginPath();
    ctx.moveTo(e.x0 - ex, e.y0 - ey);
    ctx.lineTo(e.x1 - ex, e.y1 - ey);
    ctx.stroke();
    if (e.team === player.team && player.aboard) {
      const open = e.t >= e.dur - DROP_LOCK_T;
      ctx.globalAlpha = open ? 0.65 + 0.25 * Math.sin(now * 6) : 0.3;
      ctx.strokeStyle = '#ffd95c';
      ctx.beginPath();
      ctx.moveTo(e.x0 + (e.x1 - e.x0) * e.jumpOpen - ex, e.y0 + (e.y1 - e.y0) * e.jumpOpen - ey);
      ctx.lineTo(e.x0 + (e.x1 - e.x0) * e.jumpEnd - ex, e.y0 + (e.y1 - e.y0) * e.jumpEnd - ey);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  for (const e of d.eagles) drawEagle(e, ex, ey, now);
  // fallers: a hop off the wing, then the shrink from rider scale to the
  // ground's, shadow growing under them. This is a WORLD pass, so the cull is
  // against WV_*, not VIEW_* - the old VIEW_* bounds were half the zoomed-out
  // frame, which is what made fallers on the far side of it vanish mid-air.
  for (const p of players) {
    if (!p.active || p.dropT <= 0) continue;
    const q = 1 - p.dropT / FALL_T;          // 0 just jumped .. 1 touching down
    const hop = Math.sin(Math.min(1, q * 4) * Math.PI) * 7; // the leap: up and off the wing first
    const alt = DROP_ALT * (1 - q * q) + hop; // then gravity: slow start, fast finish
    const sc = RIDER_SCALE - (RIDER_SCALE - 1) * q;
    const px = Math.round(p.x - ex), py = Math.round(p.y - ey);
    if (px < -40 || py < -DROP_ALT - 60 || px > WV_W + 40 || py > WV_H + 40) continue;
    const sw = Math.round(3 + 5 * q);
    ctx.fillStyle = 'rgba(40,60,100,' + (0.12 + 0.28 * q).toFixed(2) + ')';
    ctx.fillRect(px - sw, py - 1, sw * 2, 2);
    const ps = classSet(p).down[1 + (Math.floor(p.dropT * 10) % 2)];
    const dw = Math.round(16 * sc);
    ctx.drawImage(ps, Math.round(px - dw / 2), Math.round(py - alt - 12 * sc), dw, dw);
  }
}

// one bird in its team's armour, whatever its state. In the air the sprite
// sits at (x, y) with the shadow `alt` px below it; the dive walks that gap
// to zero so shadow and bird meet exactly at the crash point.
function drawEagle(e, ex, ey, now) {
  const frames = SPRITES.eagleTeam[e.team];
  const sx = Math.round(e.x - ex), sy = Math.round(e.y - ey);
  if (e.state === 'fly' || e.state === 'dive') {
    const u = e.state === 'dive' ? Math.min(1, e.diveT / EAGLE_DIVE_T) : 0;
    const fall = u * u; // gravity: slow tip-over, hard finish
    const alt = DROP_ALT * (1 - fall);
    const S = EAGLE_SCALE - (EAGLE_SCALE - EAGLE_REST_SCALE) * fall; // 3x down to the roost's 2x
    const spr = frames[[0, 1, 2, 1][Math.floor(e.flap * (7 + 6 * u)) % 4]]; // wingbeats quicken into the stoop
    const w = spr.width * S, h = spr.height * S;
    if (sx < -w - 40 || sy < -h - DROP_ALT - 40 || sx > WV_W + w + 40 || sy > WV_H + h + 40) return;
    const bob = e.state === 'fly' ? Math.round(Math.sin(now * 2.4 + e.team * 2.1) * 3) : 0;
    ctx.save();
    ctx.translate(sx + Math.round(10 * (1 - fall)), sy + alt);
    ctx.rotate(e.heading);
    ctx.drawImage(SPRITES.eagleShadow, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.save();
    ctx.translate(sx, sy + bob);
    ctx.rotate(e.heading);
    ctx.drawImage(spr, -w / 2, -h / 2, w, h);
    ctx.restore();
    // every rider on its wing seat, unrotated so the faces read; the local
    // slot draws last so it is never under a teammate
    const hc = Math.cos(e.heading), hs = Math.sin(e.heading);
    for (let pass = 0; pass < 2; pass++) for (const p of players) {
      if (!p.active || !p.aboard || p.team !== e.team || (p === player) !== (pass === 1)) continue;
      const st = EAGLE_SEATS[p.seat % EAGLE_SEATS.length];
      const dx = st[0] * S, dy = st[1] * S;
      const rx = sx + Math.round(dx * hc - dy * hs), ry = sy + bob + Math.round(dx * hs + dy * hc);
      const rs = 16 * RIDER_SCALE;
      ctx.drawImage(classSet(p).down[0], rx - rs / 2, ry - rs / 2 - 1, rs, rs);
    }
    // where a jump right now would land: a pulsing ring under the bird -
    // only while the jump window is open, or it promises a jump the lock refuses
    if (player.aboard && player.team === e.team && state.mode === 'drop' &&
      e.state === 'fly' && e.t >= e.dur - DROP_LOCK_T) {
      const ph = (now * 1.2) % 1;
      ctx.globalAlpha = 0.8 - ph * 0.6;
      ctx.strokeStyle = '#ffd95c';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy + alt, 6 + ph * 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else if (e.state === 'flee') {
    // driven off: the climb out. Scale and altitude walk back up from the
    // roost's to the flight's, the wings beat hard, and the bird fades out
    // over the last stretch of its escape.
    const u = Math.min(1, e.fleeT / FLEE_LIFT_T);
    const alt = DROP_ALT * u;
    const S = EAGLE_REST_SCALE + (EAGLE_SCALE - EAGLE_REST_SCALE) * u;
    const spr = frames[[0, 1, 2, 1][Math.floor(e.flap * 13) % 4]]; // beating for its life
    const w = spr.width * S, h = spr.height * S;
    if (sx < -w - DROP_ALT - 40 || sy < -h - DROP_ALT - 40 || sx > WV_W + w + 40 || sy > WV_H + h + 40) return;
    const fade = Math.min(1, Math.max(0, (FLEE_T - e.fleeT) / 1.4));
    ctx.save();
    ctx.translate(sx + Math.round(10 * u), sy + alt);
    ctx.rotate(e.heading);
    ctx.globalAlpha = 0.8 * u * fade; // the shadow returns as the ground falls away
    ctx.drawImage(SPRITES.eagleShadow, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(e.heading);
    ctx.globalAlpha = fade;
    ctx.drawImage(spr, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.globalAlpha = 1;
  } else if (e.state === 'down') {
    // the roosting objective. The landing is a landing, not a wound - the
    // bird folds its wings over EAGLE_SETTLE_T and sits there breathing;
    // wings thrown back open (frame 0) are the gust's telegraph.
    const S = EAGLE_REST_SCALE;
    const winding = e.windT > 0;
    // the idle's wing shuffle rides the MID frame only, in the middle beats
    // of RUFFLE_T (fold - shuffle - fold): the full spread stays the gust's
    const ruffling = !winding && e.ruffleT > RUFFLE_T * 0.25 && e.ruffleT < RUFFLE_T * 0.75;
    const fi = e.restT < EAGLE_SETTLE_T
      ? Math.min(2, Math.floor(e.restT / EAGLE_SETTLE_T * 3)) : (winding ? 0 : (ruffling ? 1 : 2));
    const spr = frames[fi];
    const w = spr.width * S, h = spr.height * S;
    if (sx > -w - 70 && sy > -h - 70 && sx < WV_W + w + 70 && sy < WV_H + h + 70) {
      // no cast shadow at rest: the bird is ON the ground, and a dark copy
      // under it read as a second bird
      const breath = winding ? -2 : (ruffling ? -1 : (e.restT >= EAGLE_SETTLE_T ? Math.round(Math.sin(now * 1.5 + e.team * 2.1)) : 0));
      ctx.save();
      ctx.translate(sx, sy + breath);
      ctx.rotate(e.heading);
      ctx.drawImage(spr, -w / 2, -h / 2, w, h);
      if (e.flash > 0) {
        ctx.globalAlpha = Math.min(1, e.flash * 7);
        ctx.drawImage(SPRITES.eagleFlash, -w / 2, -h / 2, w, h);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      // the pool, in team colour, up from the moment it roosts - the bar IS
      // the objective's introduction, so it never waits for a first hit.
      // Anchored to the bird's rotated extent, not the unrotated box, so it
      // hugs the sprite whatever way the dive left it pointing.
      const vh = Math.abs(w / 2 * Math.sin(e.heading)) + Math.abs(h / 2 * Math.cos(e.heading));
      const bw = 40, bx = sx - bw / 2, by = sy - Math.round(vh) - 7;
      ctx.fillStyle = '#0f1632'; ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = '#3a3448'; ctx.fillRect(bx, by, bw, 3);
      ctx.fillStyle = TEAMS[e.team].mark;
      ctx.fillRect(bx, by, Math.round(bw * Math.max(0, e.hp) / e.maxHp), 3);
    }
  }
  // the impact shockwave: two rings racing out over the crater, then gone -
  // squashed flat so they read as a blast wave along the ground, never as a
  // halo circling the bird's head
  if (e.boomT > 0) {
    const q = 1 - e.boomT / BOOM_LIFE;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, 0.55);
    ctx.strokeStyle = '#f4f7ff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.7 * (1 - q);
    ctx.beginPath(); ctx.arc(0, 0, 10 + q * 78, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = TEAMS[e.team].mark; ctx.lineWidth = 1; ctx.globalAlpha = 0.5 * (1 - q);
    ctx.beginPath(); ctx.arc(0, 0, 5 + q * 52, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// the ride's HUD: the flight bar (the line as a shape - flown part filled,
// jump window gold, a bird diamond riding the head), the first-flight
// countdown, and the keybind indicators. The wider read is the M map now.
function renderDropUI(now) {
  const d = state.drop;
  if (!d || window.DBG.hideUI) return;
  const big = VIEW_H >= 500;
  const ts = big ? 2 : 1;                   // text scale follows the zoomed-out view
  const cxm = Math.round(VIEW_W / 2);
  if (player.aboard) {
    const me = d.eagles[player.team];
    const left = Math.max(0, me.dur - me.t);
    const open = me.t >= me.dur - DROP_LOCK_T;
    // the flight bar, top centre: the whole line as a track. The gold stretch
    // is the jump window - the lock is taught by the shape, not a sentence -
    // and it pulses bright the moment the door opens.
    const bw = 120 * ts, bh = 6 * ts, bxx = cxm - Math.round(bw / 2), byy = 14 * ts;
    ctx.fillStyle = 'rgba(12,18,42,0.85)';
    ctx.fillRect(bxx - 2 * ts, byy - 2 * ts, bw + 4 * ts, bh + 4 * ts);
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(bxx, byy, bw, bh);
    const wx0 = bxx + Math.round(bw * me.jumpOpen), wx1 = bxx + Math.round(bw * me.jumpEnd);
    ctx.fillStyle = open ? '#ffd95c' : '#8a742e';
    if (open) ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now * 6);
    ctx.fillRect(wx0, byy, Math.max(2, wx1 - wx0), bh);
    ctx.globalAlpha = 1;
    // flown so far, in team colour, with the chart's bird diamond on the head
    const fx = Math.round(bw * me.prog);
    ctx.fillStyle = TEAMS[player.team].mark;
    ctx.fillRect(bxx, byy, fx, bh);
    const mxx = bxx + fx, myy = byy + Math.round(bh / 2);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(mxx - 3 * ts, myy - ts, 7 * ts, 3 * ts); ctx.fillRect(mxx - ts, myy - 3 * ts, 3 * ts, 7 * ts);
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(mxx - 2 * ts, myy, 5 * ts, ts); ctx.fillRect(mxx, myy - 2 * ts, ts, 5 * ts);
    // seconds left beside the track: a number, gold once the window is open
    const t2 = Math.ceil(left) + 'S';
    drawPixelTextOutline(ctx, t2, bxx + bw + 6 * ts, byy + Math.round(bh / 2) - 3 * ts,
      open ? '#ffd95c' : '#cfe0ff', '#0f1632', ts);
    // a profile's very first flight counts itself down and jumps (first-run
    // onboarding): PREPARE TO DROP, then the seconds, then the drop itself
    if (d.firstFlight) {
      const tGo = Math.min(TUT_DROP_T, me.jumpEnd * me.dur) - me.t;
      if (tGo > 0 && tGo <= TUT_COUNT) {
        const t1 = 'PREPARE TO DROP';
        drawPixelTextOutline(ctx, t1, Math.round(cxm - pixelTextWidth(t1, ts) / 2),
          Math.round(VIEW_H * 0.3), '#f4f7ff', '#0f1632', ts);
        const ns = ts * 3;
        const s2 = String(Math.ceil(tGo));
        const frac = tGo - Math.floor(tGo); // each second lands with a fade
        ctx.globalAlpha = 0.55 + 0.45 * frac;
        drawPixelTextOutline(ctx, s2, Math.round(cxm - pixelTextWidth(s2, ns) / 2),
          Math.round(VIEW_H * 0.3) + 9 * ts, '#ffd95c', '#0f1632', ns);
        ctx.globalAlpha = 1;
      }
    }
  } else {
    const t1 = 'WASD - DRIFT';
    drawPixelTextOutline(ctx, t1, Math.round(cxm - pixelTextWidth(t1, ts) / 2), 10 * ts, '#f4f7ff', '#0f1632', ts);
  }
  // keybind indicator, bottom right: the map itself is the affordance
  if (!state.mapOpen) {
    const tm = 'M - MAP';
    drawPixelTextOutline(ctx, tm, VIEW_W - pixelTextWidth(tm, ts) - 6 * ts, VIEW_H - 12 * ts,
      '#9fb6d8', '#0f1632', ts);
  }
}

// ------------------------------------------------------------ boot
function startGame() {
  SFX.unlock();
  beginDrop();
}

PROFILE.load();   // the profile carries the settings, so it is read first
loadSettings();
// ...and the tech tree, which decides what this profile's world may drop.
// Must run after PROFILE.load() and before initPlayers()/any swing.
rebuildLootPool();
relayout(); // fitCanvas already ran at load; this places the UI for the fitted view
SFX.setVolume(settings.volume);
SFX.setMusicVolume(settings.musicVol);
SFX.setSfxVolume(settings.sfxVol);
SFX.setMuted(settings.muted);
// the title track. Browsers refuse audio before a gesture, so SFX.music holds
// this as pending and the first click or keypress starts it (see js/audio.js).
SFX.music.play('intro', { in: 1.5 });
if (PRACTICE) {
  // the training field (the `practice arena` banner, js/world.js): a fixed
  // room instead of a match world - one dummy, open targets, the ice parkour,
  // and nothing that spawns or restocks: no landmarks, chests, wildlife or
  // eagles at all
  genPracticeWorld();
} else {
  genWorld();
  placeLandmarks();  // worldgen's last pass, before the ground is baked
  placeChests();     // ...then the caches take their trees (objects only, no ground)
  spawnAnimals();
  spawnFish();
  stockLandmarks();  // wolves and birds go in once the world is standing
}
initPlayers();
renderGround();
buildMapPanel();
buildSettingsPanel();
buildNamePanel();
buildHelpPanel();
buildPatchPanel();
camX = player.x - WV_W / 2;
camY = player.y - WV_H / 2;
// practice boots straight onto the snow: no title, no eagle. The other nine
// slots empty out (control 'none' - `active` is derived from it) and stand
// parked in the corner forest, far outside the arena, so their ghost
// silhouettes never wander into a capture; the local slot takes the arena's
// spawn tile and the HUD slides in the way a landing's does.
if (PRACTICE) {
  for (const p of players) {
    if (p === player) continue;
    p.control = 'none';
    p.spawn = { tx: 4, ty: 4 };
    p.x = (4.5) * TILE; p.y = (4.5) * TILE;
  }
  player.spawn = { tx: PR_SPAWN.tx, ty: PR_SPAWN.ty };
  player.x = (PR_SPAWN.tx + 0.5) * TILE;
  player.y = (PR_SPAWN.ty + 0.5) * TILE;
  // early morning, forever: sim.js never advances state.time under PRACTICE,
  // so this is the arena's one fixed hour - crisp daylight, shadowless dawn
  state.time = 0;
  state.mode = 'play';
  camX = Math.max(0, Math.min(WORLD * TILE - WV_W, player.x - WV_W / 2));
  camY = Math.max(0, Math.min(WORLD * TILE - WV_H, player.y - WV_H / 2));
  state.introFrom = { x: camX, y: camY };
  state.intro = HUD_IN_T; state.introLen = HUD_IN_T;
}
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
  SEED, state, animals, objects, ground, mouse, keys, drops, footprints, flakes,
  fish, iceCracks, holes, crackIce, addFish, spawnEmerger, netAt, buildSiteAt,
  // named places: the live registry, the table behind it, and what is where
  landmarks, LANDMARKS, landmarkAt, stockLandmarks, flushBirds,
  // the practice arena: whether this boot is one, the dummy's live record,
  // the spawn tile, the shared hit paths, the archery targets, the parkour
  // clock and the ESC slab's exit plank
  PRACTICE, practiceDummies, PR_SPAWN, hitDummy, leavePlankRect,
  ptargets, ptFace, ptLive, hitPTarget, parkour,
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
  structures, robots, tracers, arrows, STRUCTS, SWING_TOOLS, TOOLS, BITS,
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
  // a slot's ammo / cycle without playing to it. hudStripRect is the weapon
  // strip + xp bar that reads it back, bottom-centre.
  shafts, QUIVER_MAX, QUIVER_REGEN, SHAFT_LIFE, hudStripRect, stickArrow, stripHit, buySkill,
  AB_RANK_MAX,
  // Tools and bits: the two tables, the tier palette, an instance maker, the
  // firing pipeline and the loot roll - so a driver can stage a build without
  // mining for it. `toolCellRect` / `bitColRect` / `bitColHit` are the wells
  // the pointer tests against, and `bagAbRect` is the ability row that moved
  // into the pack. bitEditSlot is whether the hover-raised column is up (-1 = down).
  TOOL_TIERS, TOOL_SLOTS, makeTool, toolType, bitType, toolMods,
  toolRof, peekBit, nextBit, toolReady, bitFires, dropLoot, giveLoadout, CLASS_LOADOUT,
  toolCellRect, bitColRect, bitColHit, bagAbRect, bitEditSlot, tierPlate,
  // the class abilities: the table, a keypress by hand, and the entity lists
  // an ability leaves in the world - so a driver can stage a trap or a mark
  // without walking a bot into one
  CLASS_AB, abTraps: traps, abCraters: craters, abFalcons: falcons, abNets: nets, abVolleys: volleys,
  tryAbility: (i, p) => tryAbility(p || player, i),
  setAbilityCd: (i, t, p) => { (p || player).abCd[i] = t; },
  // the arsenal tree: the graph, the page's own geometry, and the pool a
  // match drops from - which is the whole arsenal, the same for every profile.
  // `wipeTech` forgets what this profile has HELD (the blue pips), which is
  // all a profile still remembers about the tree.
  TECH, TECH_ROWS, techNodeRect, techHit, rebuildLootPool, LOOT_POOL,
  wipeTech: () => PROFILE.clearTech(),
  // what the pointer is on, as the panel would describe it (null = nothing)
  tipAt: (x, y) => tipAt(x == null ? mouse.x : x, y == null ? mouse.y : y),
  tipLift,
  fireTool: (p) => fireTool(p || player),
  get tools() { return player.tools; },
  // stage a loaded tool straight onto a slot: DBG.equip(0, 'longbow', ['arrow','flame'])
  equip: (slot, id, bits, p) => {
    const q = p || player, cell = makeTool(id);
    (bits || []).forEach((b, i) => { if (i < cell.bits.length) cell.bits[i] = b; });
    q.tools[slot] = cell;
    return cell;
  },
  setQuiver: (n, p) => { const q = p || player; q.quiver = Math.max(0, Math.min(QUIVER_MAX, n)); q.fletchT = 0; return q.quiver; },
  setNock: (t, p) => { (p || player).nockT = t; },
  // multiplayer slots: every slot, the local one, and the teams table
  players, MAX_PLAYER_SLOTS, TEAMS, Player, ringPts, contestRank,
  // the eagle drop: the live flight records, force a jump, or fly the route from scratch
  get drop() { return state.drop; }, beginDrop, dropJump: (p) => dropJump(p || player, true), landPlayer, makeEagleRoute, makeEagles, inAir,
  // the two objectives: read them, chip one, or fell one outright without a siege
  get eagles() { return state.drop && state.drop.eagles; },
  hurtEagle: (team, dmg, src) => { const e = state.drop.eagles[team]; hurtEagle(e, dmg == null ? 25 : dmg, src); return e; },
  eagleFlee: (team, src) => eagleFlee(state.drop.eagles[team], src),
  teamEagleDown,
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
  placeObj, idx, objAt, hoverFish, damagePlayer, die, endMatch, specNext, aliveCount, updateAI, contest,
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
  tryDodge: (p) => tryDodge(p || player),
  // status effects (js/actions.js): the one blow every kind of unit takes,
  // every state one can be put under, and the two lists an area effect
  // sweeps. `e` defaults to the local slot wherever it is the last argument.
  hurtUnit, unitsNear, unitsHit, unitMoveMul, unitFoe, unitAlive, sideOf, clearUnitStatus,
  rootUnit: (t, e) => rootUnit(e || player, t),
  slowUnit: (t, mul, e) => slowUnit(e || player, t, mul),
  netUnit: (t, mul, e) => netUnit(e || player, t, mul),
  markUnit: (t, e) => markUnit(e || player, t),
  // fire: light a body, put it out, and the numbers a burn runs on
  igniteUnit: (t, dps, e, src) => igniteUnit(e || player, t, dps, src === undefined ? player : src),
  douseUnit: (e) => douseUnit(e || player),
  DMG_TYPES, BURN_T, BURN_DPS, BURN_TICK, BURN_MAX, PYRE_T, PYRE_DPS, CINDER_R,
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
  setSwing: (i, p) => { (p || player).swing = i; },
  getSwing: (p) => (p || player).swing,
  cam: () => ({ x: camX, y: camY }),
  startGame, beginIntro, beginSelect, lockIn, setClass, CLASSES, menu: state.menu, menuHit, menuClick, menuKey, selectHit,
  // the ESC panel: what the pointer is over, the speaker's plate, the open
  // page's row anchors (already scrolled - a row's y is where it is on
  // screen) and the navbar cells - so a driver can click a dial without
  // guessing at the pitch. setSettingsTab flips the page directly.
  settingsHit, muteBtnRect, settingsScrollBy,
  setSettingsTab: (id) => { setTab = id; },
  get settingsRows() {
    const L = settingsLayout();
    const rows = {};
    for (const r of L.rows) rows[r.id] = r.y - L.scroll;
    return { tab: setTab, tabs: L.tabs, rows, scroll: L.scroll, maxScroll: L.maxScroll,
      x: SL_X, w: SL_W, panel: { x: SET_X, y: SET_Y, w: SET_W, h: SET_H } };
  },
  layout: () => ({ VIEW_W, VIEW_H, SET_X, SET_Y, SL_X, PANEL_X, PANEL_Y, MM_CX, MM_CY }),
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
