// Softfall - a cozy winter survival game.
'use strict';
// The last file to load: the eagle drop that opens every match, the boot
// order, window.DBG and the requestAnimationFrame loop.

// ------------------------------------------------------------ eagle drop
// Nobody spawns in a camp: after PLAY's count each TEAM rides its own armoured
// eagle down the map's one DIAGONAL - RED flies it from the top-right corner
// to roost in the BOTTOM-LEFT woods, BLUE the other way to the TOP-RIGHT,
// every match and every seed - each keeping EAGLE_LANE to its own right so
// the pass mid-route is a clean fly-by (mode 'drop'). The view zooms out to
// DROP_ZOOM, the flight path is dotted across the snow itself (M raises the
// world map for the wider read), and a rider jumps with Space/Enter/E/click -
// but only inside the JUMP WINDOW: the line's last DROP_LOCK_T seconds, gold
// on the flight bar and on the dotted line both (AI slots jump at their own
// hashed fraction of the window). A jumper free-falls for FALL_T onto the
// nearest open tile, which becomes its spawn tile (the bot brain's home); the
// human's landing snaps the view back to the player's own zoom and runs the
// HUD slide-in. A rider who never jumps RIDES THE LANDING: the bird dives
// with them on its back, the crash hands the mode over (landAboard), the drop
// brief tours both roosts with them still seated, and then E hops them off
// (hopOff, under the E - HOP OFF indicator drawHopPrompt raises). A profile's
// very first flight is exactly that ride - its manual jump is refused - so a
// new player's first ground is the roost, beside the merchant and the gate.
// state.drop outlives mode 'drop' - and the whole match: past the
// line's end each bird dives into the corner's treeline, blows a crater in
// the trees, its MERCHANT (the driver on its neck - the `merchant` banner,
// js/robots.js) hops off to fell the rim and raise a gate, a LANE of pines
// falls one by one from the crater out to the open snow (the parkour roll's
// felling front), and the bird sits there as its team's OBJECTIVE - guarding
// itself with a wing gust and calming back down (preen regen) between scares.
// Keep its nerve up: at zero the bird is DRIVEN OFF (hurtEagle / eagleFlee),
// and its whole side falls with it.
                            // the ride's framing is DROP_ZOOM (canvas banner): half scale, twice the view
const EAGLE_FLIGHT_T = 10;  // s: every seed's line takes exactly this long (speed derives from length)
const DROP_LOCK_T = 4;      // s: the jump only unlocks over the line's last stretch
const DROP_EDGE_MARGIN = 3; // tiles of open ground a forced drop keeps clear of the treeline
const EAGLE_END = 2;        // tiles inside the corner's treeline each end of the line sits (diagEnd)
const HOP_FALL_T = 0.7;     // s the hop off a GROUNDED bird takes (a step down, not a free fall)...
const HOP_ALT = 16;         // ...from this many px up
// the DROP BRIEF: a local slot that rides the landing (the first flight
// always - its manual jump is refused, the ride is fully scripted - or a
// veteran who never jumped) sits through a camera tour before the hop: a
// beat on the crash you are sitting in, then across the map to the RIVAL
// roost with the win condition, then home to finish on YOUR OWN roost with
// the lose condition - the last thing said is where you are - and the
// E - HOP OFF indicator takes over. A real jump is the opt-out, so a
// veteran never sees it twice.
const BRIEF_WAIT = 1;       // s the camera stays on the crash before it leaves
const BRIEF_HOLD = 3;       // s it holds on the rival roost
const BRIEF_HOLD_OURS = 4;  // s it holds on your own to finish
const BRIEF_GO_MIN = 1;     // s a glide leg lasts at least, however close the target
const BRIEF_MAX_T = 24;     // s the whole tour may run before it force-ends (safety)
const BRIEF_PLATE_A = 0.82; // the dark plate under the headline (drawDropBrief): the roost is pines edge to edge
// the LANE the crash cuts back to the open snow, pine by pine - aimed from
// the crater at the MIDDLE of the corner's treeline (e.mouth: the diagonal's
// own edge tile, diagEnd), and run until the woods are provably behind it
const LANE_R = 0.8;         // tiles either side of the centreline a fell reaches: a diagonal band two tiles across
const LANE_SPD = 3.5;       // tiles/s the felling front walks out from the crater
const LANE_WARN = 0.5;      // s a pine shudders on its feet before it goes down
const LANE_DELAY = 0.8;     // s after the impact before the first pine shudders
const LANE_MAX = 90;        // tiles the lane may run at most (the border is 30-70 deep, the roost ~8 inside it)
const LANE_CLEAR = 6;       // tiles of pine-free snow past the last fell that prove the lane is OUT - a bay inside the border is not the field
// the WIND TRAIL: the air the bird tears in level flight - ONE continuous
// ribbon off each wingtip, laid along the flown line where the tip actually
// was and fading out toward its tail (drawEagleTrail - pure reads of the
// flight clock, no particles)
const TRAIL_T = 1.1;        // s of flight a ribbon reaches back
const TRAIL_STEP = 6;       // px between the ribbon's samples along the line
const TRAIL_RIM = 'rgba(40,60,100,0.6)'; // the dark line under the ribbon: white air over white snow needs a rim, like the text does
const MERCH_SEAT = [8, 0];  // where the merchant sits in flight: on the neck, ahead of the back seat (EAGLE_SEATS' frame)
const FALL_T = 1.3;         // seconds of free fall
const DRIFT_SPD = 130;      // px/s a faller steers sideways with WASD (~10 tiles over the fall)
const DROP_ALT = 56;        // screen px between the bird / a faller and its shadow
const EAGLE_SCALE = 3;      // the bird is huge and high above the ground: drawn at 3x in flight
const EAGLE_REST_SCALE = 2; // ...settling to 2x once it roosts (the dive walks 3 down to 2)
// the riders are WORLD-SIZED: 1x on the roosting bird, and in flight exactly
// as much bigger as the bird itself is for being nearer the camera (3/2), so
// a body never changes size against the feathers under it - riderScale(e)
const EAGLE_LANE = 2.5 * TILE; // each bird keeps this far to its own right of the shared line
const EAGLE_DIVE_T = 1.4;   // seconds from the end of the line to the treeline impact
const EAGLE_SETTLE_T = 0.6; // seconds of wing-fold after the impact, into the resting pose
// The grounded objective's NERVE: hits spook it, at zero it flees. Sized as a
// siege now that bots go for it (the ai's objective rung): a lone warrior's
// E swings (three a second, so EAGLE_WORK_DMG is a hundred of them) take a
// minute or more under the gust, a pair half that, and an arrow only ever
// spooks it EAGLE_ARROW_DMG whatever the draw, so archers standing off it
// outside the gust take minutes - long enough either way for the side to
// answer the hit (the two birds, ai.js). At 60 a swing two warriors emptied the
// nerve in the fifty seconds between two harness marks, before anyone came
const EAGLE_HP = 2000;
const EAGLE_WORK_DMG = 20;  // what one rival E swing chips off the roosting bird
const EAGLE_ARROW_DMG = 12; // what one rival arrow chips, whatever it would do to a body
const EAGLE_TILE_R = 1.6;   // tiles around the roost marked solid - the hitbox arrows AND walkers test
const CRASH_DEPTH = 14;     // tiles inside the treeline (forestDepth) the roost sits at least - never on the edge, and a proper lane of pines past the stump ring
const MIN_CRASH_TREES = 40; // of the 49 tiles in the crash site's 7x7 that must still hold a pine (the border is solid, so fewer means an edge or a bay)
// the wing gust: the bird's own defense. A rival inside GUST_R makes it rear
// up - wings spread for GUST_WIND_T, the whole telegraph - then the buffet
// throws every rival in GUST_BLAST_R into a tumble. No damage on purpose: the
// objective punishes face-tanking, it never earns kills.
// GUST_R has to cover the E reach: the roost's hitbox is the 3x3 round the
// bird (EAGLE_TILE_R) and WORK_REACH lets an axe land from the next tile out,
// whose far corner is ~57 px from the bird - at 44 a rival stood there and
// drove the bird off unbuffeted (2.62's playtest, 24 s of E and not one gust)
const GUST_R = 64;          // px: how close a rival can stand before the bird rears
const GUST_BLAST_R = 76;    // px: the buffet itself reaches a little further
const GUST_WIND_T = 0.5;    // s of wings-spread windup before the blast
const GUST_CD = 4;          // s between gusts
const GUST_KB = 300;        // knockback impulse (px/s)
const GUST_STUN = 0.7;      // s of tumble
const PREEN_DELAY = 6;      // s unhit before the bird starts calming down...
const PREEN_RATE = 8;       // ...recovering this much nerve per second
const FLEE_LIFT_T = 1.1;    // s of takeoff: turn away, climb, downdraft
const FLEE_T = 5.5;         // s total from liftoff to gone (fading over the last stretch)
const FLEE_SPD = 220;       // px/s once airborne - faster than it arrived, it wants out
const EAGLE_CINE_T = 3.2;   // s the camera holds the takeoff before the end screens queue
const RUFFLE_T = 0.45;      // s of the resting idle's wing shuffle (frame 1 only - a full
                            // spread is the gust telegraph, and the idle must never wear it)
const BOOM_R = 3.6;         // tiles of trees the impact clears outright...
const BOOM_STUMP_R = 4.6;   // ...and the ring beyond snapped to stumps - the gate's build sites (robots.js)
const BOOM_LIFE = 0.9;      // seconds the impact shockwave rings run
// where the five riders sit, in the bird's own frame (x along the heading,
// y across the wings, unscaled sprite px): one on its back, two on the inner
// wings, two out on the primaries. Seat 0 is the roster's first slot per team
// - the human, on their own bird.
const EAGLE_SEATS = [[-2, 0], [2, -11], [2, 11], [-7, -19], [-7, 19]];

// The line is FIXED: the map's one diagonal, corner to corner - there is no
// randomness in where a team roosts. Each end sits EAGLE_END tiles inside the
// corner's treeline as the seed grew it on that diagonal - the LAST wooded
// tile out from the corner, so a bay in the border short of it is still
// forest on the corner side - so the dive past it always has forest to land
// in and the window's end (lastOpenU) is always open snow. `mouth` is the
// treeline itself on the diagonal - the first open tile past that last pine,
// the MIDDLE of the corner's tree edge - which the lane the crash cuts aims
// at (planLane). Pure reads of borderDepth (world.js) - no rng(), no hash2 -
// so a seed always flies the same line. fromLeft: the bottom-left corner,
// else top-right.
function diagEnd(fromLeft) {
  const at = (k) => fromLeft ? [k, WORLD - 1 - k] : [WORLD - 1 - k, k];
  const wooded = (k) => { const [x, y] = at(k); return k < borderDepth(x, y); }; // genWorld's own tree rule
  let last = 0;
  for (let k = 0; k < WORLD / 2 - 3; k++) if (wooded(k)) last = k;
  const [tx, ty] = at(Math.max(6, last + 1 - EAGLE_END));
  const [mx, my] = at(last + 1);
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, mouth: { x: (mx + 0.5) * TILE, y: (my + 0.5) * TILE } };
}
// team 0 (RED) flies x0 -> x1: from the top-right end down to the bottom-left
function makeEagleRoute() {
  const a = diagEnd(false), b = diagEnd(true);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, mouth0: a.mouth, mouth1: b.mouth, len, dur: EAGLE_FLIGHT_T, heading: Math.atan2(b.y - a.y, b.x - a.x) };
}
// how far inside the treeline a tile sits, in tiles: positive is woods
// (genWorld's own rule, `edge < borderDepth`), negative the open field
function forestDepth(tx, ty) {
  return borderDepth(tx, ty) - Math.min(tx, ty, WORLD - 1 - tx, WORLD - 1 - ty);
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
      mouth: team === 0 ? r.mouth1 : r.mouth0, // the middle of its roost corner's treeline: where the lane aims (diagEnd)
      laneDir: null,                          // the lane's unit direction, set at the crash (eagleCrash) - the gate and the merchant's post read it
      lane: null, merchant: null,             // the road falling open (planLane) and the driver once it is down (robots.js)
    };
    e.jumpEnd = lastOpenU(e);
    e.jumpOpen = Math.min((e.dur - DROP_LOCK_T) / e.dur, e.jumpEnd - 0.05);
    return e;
  });
}

// the bird's drawn scale right now: 3x in flight, walking down to the roost's
// 2x through the dive (drawEagle's own curve), 2x on the ground
function eagleScale(e) {
  if (e.state === 'fly') return EAGLE_SCALE;
  if (e.state === 'dive') { const u = Math.min(1, e.diveT / EAGLE_DIVE_T); return EAGLE_SCALE - (EAGLE_SCALE - EAGLE_REST_SCALE) * u * u; }
  return EAGLE_REST_SCALE;
}
// how big a body on the bird draws: the bird's own perspective, 1x at rest
function riderScale(e) { return eagleScale(e) / EAGLE_REST_SCALE; }
// which way a rider on the bird faces: the heading's dominant axis, so a
// crew flying down-left shows its profiles and one flying up its backs -
// bodies ride a bird the way it points, they are not stuck on facing you
function riderDir(e) {
  const c = Math.cos(e.heading), s = Math.sin(e.heading);
  return Math.abs(c) >= Math.abs(s) ? (c > 0 ? 'right' : 'left') : (s > 0 ? 'down' : 'up');
}
// A body SEATED on the bird, drawn at (x, y) = the seat point on the feathers:
// the bottom three rows (the boots) are tucked into the plumage - a rider
// sits, it does not stand on a wing - and the body rises from that point, so
// the hem meets the bird's back and nothing floats. `set` is a pose set
// (classSet(p) or SPRITES.merchant[...]), any height.
function drawSeated(set, dir, x, y, sc, frame) {
  const spr = set[dir][frame || 0];
  const w = spr.width, keep = spr.height - 3;
  ctx.drawImage(spr, 0, 0, w, keep, Math.round(x - w * sc / 2), Math.round(y - (keep - 2) * sc), Math.round(w * sc), Math.round(keep * sc));
}
// a seat's world position on a bird right now: the seat offset rotated by the
// heading, off the bird's centre, at the bird's current scale
function seatPos(e, si) {
  const s = EAGLE_SEATS[si % EAGLE_SEATS.length];
  const S = eagleScale(e);
  const dx = s[0] * S, dy = s[1] * S;
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
    // bots spread across the jump window; a human is never force-dropped -
    // unless they jump they ride the landing and hop off at the roost (above)
    p.dropU = p.control === 'ai'
      ? e.jumpOpen + (e.jumpEnd - e.jumpOpen) * (0.08 + 0.84 * hash2(p.id * 31 + 5, 9))
      : 2;
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
  // the first flight is fully scripted: the door stays shut to a manual leap
  // and the ride lands with you on it - the brief that follows is the lesson
  if (!force && p === player && state.drop.firstFlight) { SFX.deny(); return; }
  p.aboard = false;
  p.dropT = FALL_T; p.dropAlt = DROP_ALT; p.dropSc = riderScale(d); // the fall shrinks from the seat's size to 1x
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
    if (state.mode !== 'play') handOver(p); // a jump's landing is where play begins; a hop's already is
    state.shake = 5;
    SFX.land();
  } else {
    addFloater(p.x, p.y - 20, p.name + ' LANDED', TEAMS[skin(p.team)].mark);
  }
}

// mode 'drop' -> 'play' for the local slot, wherever it is: on its boots
// after a jump, or still on the bird's back at the crash (landAboard)
function handOver(p) {
  state.mode = 'play';
  state.mapOpen = false;            // a chart left up mid-flight comes down for the landing
  applyZoom(0, true);               // back to the player's own zoom, centred on the landing
  camX = Math.max(0, Math.min(WORLD * TILE - WV_W, p.x - WV_W / 2));
  camY = Math.max(0, Math.min(WORLD * TILE - WV_H, p.y - WV_H / 2));
  state.introFrom = { x: camX, y: camY };
  state.intro = HUD_IN_T; state.introLen = HUD_IN_T; // the HUD slides in, the camera settles
  state.menu.screenT = 0;
}

// the crash with the local slot still aboard: the ride's song is interrupted
// by the impact the way a jump interrupts it, play begins with you seated on
// the roost, and the brief opens - the E hop comes after it (updateDrop)
function landAboard(p) {
  handOver(p);
  state.shake = 9;
  state.rayT = RAY_AFTER;
  SFX.music.play('jump', { out: 0.1, in: 0.05 });
  state.dropBrief = { ph: 'wait', t: 0, total: 0 };
}

// E on the grounded bird: a step down off the wing - short, low, steerable
// like any fall - and the first flight's countdown never comes back after it
function hopOff(p) {
  if (!p.aboard || !state.drop || state.dropBrief) return;
  const e = state.drop.eagles[p.team];
  if (e.state !== 'down') return;
  p.aboard = false;
  p.dropT = HOP_FALL_T; p.dropAlt = HOP_ALT; p.dropSc = 1;
  if (p === player) { PROFILE.markDropped(); SFX.dodge(); }
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
  // the drop brief: the roost tour a forced landing opened on. The match runs
  // on underneath - only the local camera and controls are spoken for
  // (sampleHumanInput zeroes them, the camera branch in js/sim.js follows
  // dropBriefTarget) - and the landing grace holds until the hand-back, so
  // nobody dies watching the lesson. Each glide leg ends when the camera has
  // arrived AND the bird it is looking at is down (a first flight catches the
  // dive mid-air; a veteran dropped at the window's end finds it landed).
  const brief = state.dropBrief;
  if (brief) {
    if (state.mode !== 'play' || state.eagleCine) endBrief(); // the ceremony (or a death) outranks the lesson
    else {
      brief.t += dt; brief.total += dt;
      player.invuln = Math.max(player.invuln, 0.4);
      const tgt = dropBriefTarget();
      const near = Math.hypot(tgt.x - WV_W / 2 - camX, tgt.y - WV_H / 2 - camY) < 24;
      const birdDown = (t) => { const e = state.drop.eagles[t]; return e.state !== 'fly' && e.state !== 'dive'; };
      const step = (ph) => { brief.ph = ph; brief.t = 0; };
      if (brief.total > BRIEF_MAX_T) endBrief();
      else if (brief.ph === 'wait') { if (brief.t > BRIEF_WAIT) step('theirs-go'); }
      else if (brief.ph === 'theirs-go') { if (near && brief.t > BRIEF_GO_MIN && birdDown(1 - player.team)) step('theirs'); }
      else if (brief.ph === 'theirs') { if (brief.t > BRIEF_HOLD) step('ours-go'); }
      else if (brief.ph === 'ours-go') { if (near && brief.t > BRIEF_GO_MIN && birdDown(player.team)) step('ours'); }
      else if (brief.t > BRIEF_HOLD_OURS) endBrief(); // 'ours': the finish, on the roost you are sitting on
    }
  }
  for (const p of players) {
    if (!p.active) continue;
    if (p.aboard) {
      const e = state.drop.eagles[p.team];
      const sp = seatPos(e, p.seat);
      p.x = sp.x; p.y = sp.y;
      if (e.prog >= p.dropU) dropJump(p, true); // the window's end drops a bot still riding
      else if (e.state === 'down' && state.mode === 'play' && !state.dropBrief && p.input.work) hopOff(p); // E off the roost
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
    if (e.lane) laneStep(e, dt); // the road out, still falling open
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

// the end of the line: a bot still aboard is thrown, a human rides the dive
// down (landAboard at the crash), and the bird tips over toward the nearest
// standing forest past the line's end
function beginDive(e) {
  for (const p of players) if (p.active && p.aboard && p.team === e.team && p.control !== 'human') dropJump(p, true);
  e.state = 'dive';
  e.from = { x: e.x, y: e.y };
  e.crash = findCrashPoint(e);
  e.diveT = 0;
}

// walk out past the line's end looking for DEEP forest: the first tile that
// sits CRASH_DEPTH inside the treeline by the border's own measure
// (forestDepth - inside the roost disc, world.js, that is tiles in from the
// arc) AND whose 7x7 still holds MIN_CRASH_TREES takes the impact, so the
// roost always sits a proper way into the woods with trees all round it, never
// kissing the tree edge or a bay in it. Pure reads - no rng(), no hash2 - so
// the same seed buries the same bird in the same trees; the deepest, densest
// spot seen stands in if no tile ever qualifies.
function findCrashPoint(e) {
  const hx = Math.cos(e.heading), hy = Math.sin(e.heading);
  let best = null, bestScore = -Infinity;
  for (let step = 4; step <= 60; step++) {
    const tx = Math.floor((e.x + hx * step * TILE) / TILE);
    const ty = Math.floor((e.y + hy * step * TILE) / TILE);
    if (tx < 4 || ty < 4 || tx >= WORLD - 4 || ty >= WORLD - 4) break;
    const depth = forestDepth(tx, ty);
    let trees = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const o = inWorld(tx + dx, ty + dy) && objAt(tx + dx, ty + dy);
      if (o && (o.type === 'tree' || o.type === 'deadTree')) trees++;
    }
    if (depth >= CRASH_DEPTH && trees >= MIN_CRASH_TREES) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    const score = Math.min(depth, CRASH_DEPTH) * 4 + trees;
    if (score > bestScore) { bestScore = score; best = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }; }
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
  logEvent('THE ' + TEAMS[skin(e.team)].name + ' EAGLE HAS LANDED', players.find((p) => p.team === e.team));
  // the crater is not the whole landing: the lane back to the snow starts
  // falling (laneStep) - aimed from the crater at the middle of the corner's
  // treeline (e.mouth), back the way the bird came if the mouth is somehow
  // under it - and the driver climbs down to work the roost
  const mx = e.mouth.x - e.x, my = e.mouth.y - e.y, ml = Math.hypot(mx, my);
  e.laneDir = ml > TILE ? { x: mx / ml, y: my / ml } : { x: -Math.cos(e.heading), y: -Math.sin(e.heading) };
  e.lane = planLane(e);
  spawnMerchant(e);
  for (const p of players) if (p.active && p.aboard && p.team === e.team && p === player) landAboard(p);
}

// The LANE: the crash's one road out. From the crater along e.laneDir - at
// the MIDDLE of the corner's treeline (e.mouth), so every roost's road comes
// out where the field is widest - to the open snow, every pine within LANE_R
// of the centreline becomes a felling event timed by its distance along the
// lane, so a FRONT walks out from the roost at LANE_SPD - the parkour roll's
// grammar (pkAnimStep, world.js): each pine shudders LANE_WARN ahead of the
// front (o.shake, decayed by sim.js's object-timer loop), then goes down in
// needles and snow. A rock in the band shatters the same way, so the road is
// a road for a walker and not just for the eye. The lane is OUT only when the
// last LANE_CLEAR tiles held nothing to fell AND the border itself says open
// (forestDepth) - a clearing inside the woods used to end it early and leave
// the roost walled in behind a bay. Pays no gold, like the crater; leaves no
// stumps, because a road is a road. Pure reads - the lane a seed gets is the
// lane it always gets.
function laneFells(o) { return !!o && (o.type === 'tree' || o.type === 'deadTree' || o.type === 'rock'); }
function planLane(e) {
  const hx = e.laneDir.x, hy = e.laneDir.y;
  const ev = [], seen = new Set();
  const reach = Math.ceil(LANE_R);
  let lastFell = 0;
  for (let s = 0; s < LANE_MAX; s += 1 / 3) {
    const fx = (e.x - 8) / TILE + hx * s, fy = (e.y - 8) / TILE + hy * s; // tile-index space, like pkPlanCarve
    const cx = Math.round(fx), cy = Math.round(fy);
    if (!inWorld(cx, cy)) break;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (!inWorld(tx, ty) || Math.hypot(tx - fx, ty - fy) > LANE_R) continue;
      const i = idx(tx, ty);
      if (seen.has(i)) continue;
      seen.add(i);
      if (!laneFells(objects[i])) continue;
      lastFell = s;
      const t = LANE_DELAY + s / LANE_SPD;
      ev.push({ t: Math.max(LANE_DELAY * 0.4, t - LANE_WARN), i, k: 2 }); // the shudder
      ev.push({ t, i, k: 1 });                                            // the fall
    }
    if (s - lastFell >= LANE_CLEAR && forestDepth(cx, cy) < 0) break; // out of the woods for real
  }
  ev.sort((a, b) => a.t - b.t);
  return ev.length ? { t: 0, ev, next: 0, sfxT: 0 } : null;
}

// one frame of the front: spend every event it has reached. A shudder is a
// shake on a standing pine, a fall takes it off the tile outright - no ground
// write, so no repaint (the minimap's half-second sweep picks it up).
function laneStep(e, dt) {
  const L = e.lane;
  L.t += dt; L.sfxT += dt;
  let spent = 0;
  while (L.next < L.ev.length && L.ev[L.next].t <= L.t && spent < 24) {
    const ev = L.ev[L.next++]; spent++;
    const o = objects[ev.i];
    if (!laneFells(o)) continue; // already felled by hand, or grown into something else
    if (ev.k === 2) { o.shake = 0.55; continue; }
    const tx = ev.i % WORLD, ty = (ev.i / WORLD) | 0, px = tx * TILE + 8, py = ty * TILE + 8;
    objects[ev.i] = null;
    if (o.type === 'rock') {
      burst(px, py - 6, '#9aa4b4', 6, 50, 0.45, true); // the rock shatters
      burst(px, py - 4, '#f4f7ff', 4, 40, 0.4, true);
      if (L.sfxT > 0.3 && nearPlayer(px, py, 320)) { L.sfxT = 0; SFX.break_(); }
      continue;
    }
    burst(px, py - 8, o.type === 'tree' ? '#88b090' : '#6b5a48', 5, 45, 0.45, true); // needles off the falling pine
    burst(px, py - 4, '#f4f7ff', 4, 40, 0.4, true);
    if (o.type === 'deadTree') flushBirds(landmarkAt(px, py), { x: px, y: py });
    if (L.sfxT > 0.3 && nearPlayer(px, py, 320)) { L.sfxT = 0; SFX.treeFall(); }
  }
  if (L.next >= L.ev.length) e.lane = null;
}

// the impact language, shared by the landing and the loss (k scales it up):
// snow thrown high, the team's colours in it, feathers left hanging, and a
// low dust ring rolling out along the ground under the shockwave rings.
function eagleBoomFx(e, k) {
  e.boomT = BOOM_LIFE;
  burst(e.x, e.y - 6, '#f4f7ff', Math.round(26 * k), 110 * k, 0.7, true);
  burst(e.x, e.y - 6, TEAMS[skin(e.team)].mark, Math.round(14 * k), 90 * k, 0.6);
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
  burst(px, py, TEAMS[skin(e.team)].mark, 3, 40, 0.4);
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
  logEvent('THE ' + TEAMS[skin(e.team)].name + ' EAGLE WAS DRIVEN OFF', src || players.find((p) => p.team === e.team));
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
// eagle takes its team out of the match - the one thing that does
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
    ctx.strokeStyle = TEAMS[skin(e.team)].mark;
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
    const fallT = p.dropAlt === HOP_ALT ? HOP_FALL_T : FALL_T;
    const q = 1 - p.dropT / fallT;           // 0 just jumped .. 1 touching down
    const hop = Math.sin(Math.min(1, q * 4) * Math.PI) * 7; // the leap: up and off the wing first
    const alt = p.dropAlt * (1 - q * q) + hop; // then gravity: slow start, fast finish (a roost hop starts low)
    const sc = p.dropSc - (p.dropSc - 1) * q;  // from the seat's perspective size down to the ground's 1x
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

// The WIND TRAIL: level flight tears the air. ONE continuous ribbon streams
// off each wingtip: sampled every TRAIL_STEP px back along the flown line
// for TRAIL_T seconds of flight, each sample where the tip actually WAS on
// that beat (the wing's reach and set follow the flap continuously -
// TRAIL_TIP/TRAIL_TIP_AMP, TRAIL_BACK/TRAIL_BACK_AMP - and the body's bob),
// so the ribbon waves with the wingbeat and hangs where it was torn while
// the bird flies on. It is solid at the tip and fades to nothing at its tail
// (one gradient along it, over a TRAIL_RIM dark line so white air reads over
// white snow). Pure reads of the flight clock - no particle, no sim step, the
// same trail at any dt - and the stoop fades the whole ribbon out as the bird
// tips over. Drawn at the bird's altitude, under the sprite.
const TRAIL_TIP = 19, TRAIL_TIP_AMP = 2;   // sprite px across to the wingtip, and the gentle swing the flap puts on it (the tip itself moves 4, the air behind it half that)
const TRAIL_BACK = -8, TRAIL_BACK_AMP = 3; // ...and how far back along the body it sits, and its swing
function drawEagleTrail(e, ex, ey, S, now) {
  const hc = Math.cos(e.heading), hs = Math.sin(e.heading);
  const dive = e.state === 'dive' ? Math.min(1, e.diveT / EAGLE_DIVE_T) : 0;
  if (dive >= 1) return;
  const T = e.t + (e.state === 'dive' ? e.diveT : 0);   // the flight clock: e.t stops at the line's end
  const head = Math.min(T, e.dur);                       // the ribbon's tip never leaves the line
  const n = Math.ceil(Math.min(TRAIL_T, head) * e.spd / TRAIL_STEP);
  if (n < 2) return;
  // a sample's point on the ribbon: the tip's world position `age` seconds ago
  const at = (side, age, out) => {
    const t = head - age, d = Math.min(e.spd * t, e.len);
    const ph = Math.cos((e.flap - (T - t)) * 7 * Math.PI / 2); // the flap cycle: spread -> mid -> back -> mid over four beats of 1/7 s
    const lat = side * (TRAIL_TIP + TRAIL_TIP_AMP * ph) * S, back = (TRAIL_BACK + TRAIL_BACK_AMP * ph) * S;
    out.x = e.x0 + hc * (d + back) - hs * lat - ex;
    out.y = e.y0 + hs * (d + back) + hc * lat - ey + Math.round(Math.sin((now - age) * 2.4 + e.team * 2.1) * 3);
  };
  const a = { x: 0, y: 0 }, b = { x: 0, y: 0 };
  ctx.save();
  ctx.lineJoin = 'round';
  for (const side of [-1, 1]) {
    at(side, 0, a); at(side, Math.min(TRAIL_T, head), b);
    if (Math.max(a.x, b.x) < -40 || Math.max(a.y, b.y) < -40 || Math.min(a.x, b.x) > WV_W + 40 || Math.min(a.y, b.y) > WV_H + 40) continue;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      at(side, (i / n) * Math.min(TRAIL_T, head), b);
      if (i === 0) ctx.moveTo(b.x, b.y); else ctx.lineTo(b.x, b.y);
    }
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); // solid at the tip, gone at the tail
    ctx.globalAlpha = 1 - dive;
    g.addColorStop(0, TRAIL_RIM); g.addColorStop(0.55, 'rgba(40,60,100,0.32)'); g.addColorStop(1, 'rgba(40,60,100,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 5; ctx.stroke();
    const w = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    w.addColorStop(0, 'rgba(255,255,255,0.95)'); w.addColorStop(0.55, 'rgba(255,255,255,0.55)'); w.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = w; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// one bird in its team's armour, whatever its state. In the air the sprite
// sits at (x, y) with the shadow `alt` px below it; the dive walks that gap
// to zero so shadow and bird meet exactly at the crash point.
function drawEagle(e, ex, ey, now) {
  const frames = SPRITES.eagleTeam[skin(e.team)];
  const sx = Math.round(e.x - ex), sy = Math.round(e.y - ey);
  if (e.state === 'fly' || e.state === 'dive') {
    const u = e.state === 'dive' ? Math.min(1, e.diveT / EAGLE_DIVE_T) : 0;
    const fall = u * u; // gravity: slow tip-over, hard finish
    const alt = DROP_ALT * (1 - fall);
    const S = EAGLE_SCALE - (EAGLE_SCALE - EAGLE_REST_SCALE) * fall; // 3x down to the roost's 2x
    const spr = frames[[0, 1, 2, 1][Math.floor(e.flap * (7 + 6 * u)) % 4]]; // wingbeats quicken into the stoop
    const w = spr.width * S, h = spr.height * S;
    drawEagleTrail(e, ex, ey, S, now); // before the cull: the trail hangs behind a bird already off the frame
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
    // every rider seated on its wing, facing the way the bird flies, at the
    // bird's own perspective size (riderScale); the local slot draws last so
    // it is never under a teammate. A wingbeat lifts the whole crew a pixel.
    const hc = Math.cos(e.heading), hs = Math.sin(e.heading);
    const RS = riderScale(e), rd = riderDir(e);
    const beat = frames.indexOf(spr) === 0 ? -1 : 0; // the downstroke (spread frame) rides high
    { // the driver first, on the neck: the team's merchant, who climbs down at the crash
      const dx = MERCH_SEAT[0] * S, dy = MERCH_SEAT[1] * S;
      const rx = sx + dx * hc - dy * hs, ry = sy + bob + beat + dx * hs + dy * hc;
      drawSeated(SPRITES.merchant[skin(e.team)], rd, rx, ry, RS);
    }
    for (let pass = 0; pass < 2; pass++) for (const p of players) {
      if (!p.active || !p.aboard || p.team !== e.team || (p === player) !== (pass === 1)) continue;
      const st = EAGLE_SEATS[p.seat % EAGLE_SEATS.length];
      const dx = st[0] * S, dy = st[1] * S;
      const rx = sx + dx * hc - dy * hs, ry = sy + bob + beat + dx * hs + dy * hc;
      drawSeated(classSet(p), rd, rx, ry, RS);
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
      // whoever rode the landing, still seated - world-sized now, the bird at
      // rest is just a big bird - breathing with it, facing where it points
      // (the local slot: their first ground is this bird's back), with the
      // gold landing ring pulsing under the bird once the brief has handed
      // back - the flight's own "a jump lands here" mark, now for the hop
      const hc = Math.cos(e.heading), hs = Math.sin(e.heading);
      const rd = riderDir(e);
      for (const p of players) {
        if (!p.active || !p.aboard || p.team !== e.team) continue;
        const st = EAGLE_SEATS[p.seat % EAGLE_SEATS.length];
        const dx = st[0] * S, dy = st[1] * S;
        drawSeated(classSet(p), rd, sx + dx * hc - dy * hs, sy + breath + dx * hs + dy * hc, 1);
      }
      if (player.aboard && player.team === e.team && state.mode === 'play' && !state.dropBrief) {
        const ph = (now * 1.2) % 1;
        ctx.globalAlpha = 0.8 - ph * 0.6;
        ctx.strokeStyle = '#ffd95c';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, 10 + ph * 14, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // the pool, in team colour, up from the moment it roosts - the bar IS
      // the objective's introduction, so it never waits for a first hit -
      // under its PERCH nameplate in the same paint (the driver wears MERCH,
      // drawMerchant): the side's two named bodies, named the same way.
      // Anchored to the bird's rotated extent, not the unrotated box, so it
      // hugs the sprite whatever way the dive left it pointing.
      const vh = Math.abs(w / 2 * Math.sin(e.heading)) + Math.abs(h / 2 * Math.cos(e.heading));
      const bw = 40, bx = sx - bw / 2, by = sy - Math.round(vh) - 7;
      ctx.fillStyle = '#0f1632'; ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = '#3a3448'; ctx.fillRect(bx, by, bw, 3);
      ctx.fillStyle = TEAMS[skin(e.team)].mark;
      ctx.fillRect(bx, by, Math.round(bw * Math.max(0, e.hp) / e.maxHp), 3);
      drawPixelTextOutline(ctx, 'PERCH', centreTextX(sx, 'PERCH'), by - 8, TEAMS[skin(e.team)].mark, '#0f1632'); // two clear rows over the frame, as a slot's tag sits
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
    ctx.strokeStyle = TEAMS[skin(e.team)].mark; ctx.lineWidth = 1; ctx.globalAlpha = 0.5 * (1 - q);
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
    ctx.fillStyle = TEAMS[skin(player.team)].mark;
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

// The way off the roost, for a rider still seated after the brief: a keybind
// indicator - an E key cap with the one word beside it, bobbing at the seated
// player's shoulder (beside, not above: above is the bird's own bar and
// whoever is standing on the far side of it) - and the gold landing ring
// pulsing under the bird (drawEagle), the same ring that marked the open jump
// window in flight. Play mode's UI pass, over the world (wToSX/wToSY), gone
// the moment the hop starts.
function drawHopPrompt(now) {
  if (!state.drop || !player.aboard || state.dropBrief || window.DBG.hideUI) return;
  const e = state.drop.eagles[player.team];
  if (e.state !== 'down') return;
  const ts = VIEW_H >= 500 ? 2 : 1;
  const bob = Math.round(Math.sin(now * 4) * 2);
  const w = 11 * ts, h = 11 * ts;
  const cx = Math.round(wToSX(player.x)) + 20 * ts, cy = Math.round(wToSY(player.y)) - 14 * ts + bob;
  ctx.fillStyle = '#0f1632'; ctx.fillRect(cx - ts, cy - ts, w + 2 * ts, h + 2 * ts);
  ctx.fillStyle = '#f4f7ff'; ctx.fillRect(cx, cy, w, h);
  ctx.fillStyle = '#c9d0e2'; ctx.fillRect(cx, cy + h - 2 * ts, w, 2 * ts); // the cap's lower face
  drawPixelText(ctx, 'E', cx + 3 * ts, cy + 2 * ts, '#0f1632', ts);
  drawPixelTextOutline(ctx, 'HOP OFF', cx + w + 4 * ts, cy + 2 * ts, '#ffd95c', '#0f1632', ts);
}

// the brief is over, however it ended: the controls come back, and the DAY 1
// headline the landing owes (the camera banner, js/sim.js, holds it while the
// tour has the top of the screen) pops now
function endBrief() {
  if (!state.dropBrief) return;
  state.dropBrief = null;
  if (!PRACTICE && state.mode === 'play') state.dayPop = { day: state.day, t: 0 };
}

// where the drop brief's camera is looking right now: the sim camera
// (js/sim.js) glides toward this every frame, so a bird still finishing its
// dive is TRACKED rather than met - the crash lands on screen
function dropBriefTarget() {
  const b = state.dropBrief, d = state.drop;
  if (!b || !d) return { x: player.x, y: player.y };
  if (b.ph === 'ours-go' || b.ph === 'ours') return d.eagles[player.team];
  if (b.ph === 'theirs-go' || b.ph === 'theirs') return d.eagles[1 - player.team];
  return { x: player.x, y: player.y }; // 'wait': the seat you are in
}

// the brief's two headlines, one per roost: the bird on screen is the
// picture, this says what it MEANS (the headline carve-out - a match has
// exactly one win condition, and this is the once it is ever written down).
// Big, high and short: the headline in the roost's team colour at three times
// the HUD's text scale across the top of the view, one plain line under it,
// nothing else. Baked opaque and faded as a canvas, the dayPop grammar: an
// outline stamped under globalAlpha goes blotchy (the CLAUDE.md text rule).
let briefCv = null, briefCvKey = '';
function drawDropBrief() {
  const b = state.dropBrief;
  if (!b || window.DBG.hideUI) return;
  if (b.ph !== 'ours' && b.ph !== 'theirs') return;
  const hold = b.ph === 'ours' ? BRIEF_HOLD_OURS : BRIEF_HOLD;
  const a = Math.min(1, b.t / 0.25, Math.max(0, (hold - b.t) / 0.3));
  if (a <= 0) return;
  const ts = VIEW_H >= 500 ? 2 : 1; // the drop HUD's own text scale (renderDropUI)
  const key = b.ph + ts;
  if (!briefCv || briefCvKey !== key) {
    const team = b.ph === 'ours' ? player.team : 1 - player.team;
    const t1 = b.ph === 'ours' ? 'YOUR EAGLE' : 'THEIR EAGLE';
    const t2 = b.ph === 'ours' ? 'LOSE IT, LOSE THE MATCH' : 'DRIVE IT OFF TO WIN';
    const hs = 3 * ts, ss = ts, pad = 6 * ts; // the plate's margin round the words
    briefCv = document.createElement('canvas');
    briefCv.width = Math.max(pixelTextWidth(t1, hs), pixelTextWidth(t2, ss)) + 4 + pad * 2;
    briefCv.height = 8 * hs + 8 * ss + 8 + pad * 2;
    const c2 = briefCv.getContext('2d');
    // a dark PLATE under the words, the panels' own ink at BRIEF_PLATE_A with
    // a 1px rim: the roost is a wall of pines, and an outline alone on green
    // needles at this size was a smear
    c2.fillStyle = BAG_BG;
    c2.globalAlpha = BRIEF_PLATE_A;
    c2.fillRect(0, 0, briefCv.width, briefCv.height);
    c2.globalAlpha = 1;
    c2.fillStyle = TEAMS[skin(team)].mark;
    c2.fillRect(0, 0, briefCv.width, 1); c2.fillRect(0, briefCv.height - 1, briefCv.width, 1); // the team's colour as the plate's rule, top and bottom
    drawPixelTextOutline(c2, t1, Math.round((briefCv.width - pixelTextWidth(t1, hs)) / 2), pad + 2,
      TEAMS[skin(team)].mark, '#0f1632', hs);
    drawPixelTextOutline(c2, t2, Math.round((briefCv.width - pixelTextWidth(t2, ss)) / 2), pad + 8 * hs + 6,
      '#f4f7ff', '#0f1632', ss);
    briefCvKey = key;
  }
  ctx.globalAlpha = a;
  ctx.drawImage(briefCv, Math.round((VIEW_W - briefCv.width) / 2), Math.round(VIEW_H * 0.08));
  ctx.globalAlpha = 1;
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
// ...and the merchants' market, which primes three days of prices behind it
// so the counter's graphs are graphs on day one (js/shop.js).
initMarket();
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
  ptargets, ptFace, ptLive, ptHitR, hitPTarget, parkour,
  // the archery round: the live state, the difficulty tables, the bell's
  // resolver, ring a round in by hand at a difficulty (warp beside AG_BELL
  // first - the reach check is real), spawn one random target, and the
  // track parametrisation for staging shots
  agame, AG_DIFF, agBellNear, agSpawn, agStock, agPos, AG_LEN, AG_BELL,
  agRing: (diff, p) => agRing(p || player, { tx: AG_BELL.tx, ty: AG_BELL.ty, id: diff || agame.diff }),
  get agStreak() { return agStreak; }, // the consecutive-hit run (rebinds, so a getter)
  // the parkour roll station: roll a track by hand, resolve the die E would
  // open the wheel on, and watch the sweep (pkAnim rebinds, so a getter;
  // pkAnimStep lets a driver fast-forward the front)
  pkRoll, pkDieNear, pkWheelPick, PK_DIFFS, pkAnimState: () => pkAnim, pkAnimStep,
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
  // the hud strip - the xp bar + weapon/ability strip, bottom-centre.
  hudStripRect, stripHit,
  // Tools and bits: the two tables, the tier palette, an instance maker, the
  // firing pipeline and the loot roll - so a driver can stage a build without
  // mining for it. `toolCellRect` / `bitColRect` / `bitColHit` are the wells
  // the pointer tests against. bitEditSlot is whether the hover-raised column is up (-1 = down).
  TOOL_TIERS, TOOL_SLOTS, makeTool, toolType, bitType, toolMods,
  toolRof, toolCycle, peekBit, nextBit, toolReady, bitFires, dropLoot, giveLoadout, CLASS_LOADOUT,
  // the draw curve: 0..1 off a slot's chargeT, and the flight and damage it buys a bit
  drawPow, shotFlight, drawDmgMul, DRAW_RANGE_MIN, DRAW_SPEED_MIN, DRAW_DMG_MIN,
  toolCellRect, bitColRect, bitColHit, bitEditSlot, tierPlate,
  // the closing line's three bits: what a shot does where it LANDS, the
  // teleport with no shot to fire it, the flashes it strings across the jump,
  // and the chop a thrown axe lands - so a driver can prove an arrival or a
  // fell without waiting for one to connect
  BIT_IMPACT, warps, WARP_FLASH_T, AXE_CHOP_R, chopTree,
  warpPlayer: (x, y, p) => warpPlayer(p || player, x, y),
  // the class abilities: the table, a keypress by hand, and the entity lists
  // an ability leaves in the world - so a driver can stage a crater or a net
  // without walking a bot into one
  CLASS_AB, abCraters: craters, abNets: nets,
  tryAbility: (i, p) => tryAbility(p || player, i),
  setAbilityCd: (i, t, p) => { (p || player).abCd[i] = t; },
  // ability levels: gear's ladder on the four keys (js/abilities.js)
  AB_LV_MAX, abLvCanBuy: (i, p) => abLvCanBuy(p || player, i),
  abCdOf: (i, p) => abCdOf(p || player, i),
  buyAbilityLv: (i, p) => buyAbilityLv(p || player, i), abBuyRect, abBuyHit,
  // the arsenal tree: the graph, the page's own geometry, and the pool a
  // match drops from - which is the whole arsenal, the same for every profile.
  // `wipeTech` forgets what this profile has HELD (the blue pips), which is
  // all a profile still remembers about the tree.
  TECH, rebuildLootPool, LOOT_POOL,
  // the wiki: its pages, the live layout (tabs, rows, window, rail), what is
  // under a point, the open page's scroll, and the way in from the plank
  WIKI_PAGES, wikiLayout, wikiHit, wikiScrollBy, wikiSetTab, beginWiki, leaveWiki,
  wipeTech: () => PROFILE.clearTech(),
  // The merchant's counter (js/shop.js): the live market and its two goods,
  // the rolled stock, the panel's geometry, and every trade without the
  // pointer. `marketStep(n)` walks the prices n moves on so a driver can watch
  // a spike without waiting three days for one, and `shopRestock()` turns the
  // counter over on the spot - quietly, or `shopRestock(true)` with the plate
  // and the two-beat cue a real turnover raises.
  market, GOODS, MKT_STEP, MKT_HIST, MKT_DAYS, SHOP_RESTOCK, marketPrice, marketHist,
  marketStep: (n) => { for (let i = 0; i < (n || 1); i++) updateMarket(MKT_STEP); return MKT_ORDER.map(marketPrice); },
  shopRestock: (loud) => shopRestock(!loud), shopOffer, itemValue, cellValue, sellValue,
  // the market's plates under the minimap: the live stack, where a slot lands,
  // and a way to raise one without waiting for the walk to do it
  notices, noteRect, NOTE_KIND, marketNotice,
  merchNear: (p) => merchNear(p || player),
  openShop: (p) => openShop(merchNear(p || player)), closeShop, shopOpen,
  shopLayout, shopHit: (x, y) => shopHit(x == null ? mouse.x : x, y == null ? mouse.y : y),
  shopBuy: (sec, i, p) => shopBuy(p || player, sec, i),
  shopSellCell: (i, p) => shopSellCell(p || player, i),
  shopTrade: (id, dir, p) => shopTrade(p || player, id, dir),
  CARD_PRICE,
  // what the pointer is on, as the panel would describe it (null = nothing)
  tipAt: (x, y) => tipAt(x == null ? mouse.x : x, y == null ? mouse.y : y),
  tipLift,
  fireTool: (p) => fireTool(p || player),
  // the fish catch's three beats: start one by hand, read which frame a body is on
  startCatch: (p) => startCatch(p || player), cancelCatch: (p) => cancelCatch(p || player), catchFrame,
  get tools() { return player.tools; },
  // stage a loaded tool straight onto a slot: DBG.equip(0, 'longbow', ['arrow','flame'])
  equip: (slot, id, bits, p) => {
    const q = p || player, cell = makeTool(id);
    (bits || []).forEach((b, i) => { if (i < cell.bits.length) cell.bits[i] = b; });
    q.tools[slot] = cell;
    return cell;
  },
  setNock: (t, p) => { (p || player).nockT = t; }, // a huge t parks a slot's bow for a capture
  // multiplayer slots: every slot, the local one, and the teams table
  players, MAX_PLAYER_SLOTS, TEAMS, Player, ringPts, contestRank,
  // the eagle drop: the live flight records, force a jump, or fly the route from scratch
  get drop() { return state.drop; }, beginDrop, dropJump: (p) => dropJump(p || player, true), landPlayer, makeEagleRoute, makeEagles, inAir,
  hopOff: (p) => hopOff(p || player), // E off the roost for a rider who rode the landing (refused while the brief runs)
  // the two objectives: read them, chip one, or fell one outright without a siege
  get eagles() { return state.drop && state.drop.eagles; },
  // the paint: which preset a team wears on this screen (settings.teamBlue), and the two merchants
  skin, get merchants() { return robots.filter((b) => b.merchant); },
  // the roost's road out: the felling front, or fire the whole lane at once
  planLane, laneStep: (team, dt) => { const e = state.drop.eagles[team]; if (e.lane) laneStep(e, dt == null ? 99 : dt); return e.lane; },
  hurtEagle: (team, dmg, src) => { const e = state.drop.eagles[team]; hurtEagle(e, dmg == null ? 25 : dmg, src); return e; },
  eagleFlee: (team, src) => eagleFlee(state.drop.eagles[team], src),
  teamEagleDown,
  get player() { return player; },
  get inv() { return player.inv; },
  // the backpack: the item table, the slot array, and add/take/count without
  // walking onto a drop. bagHit is what the pointer tests against.
  ITEMS, BAG_CAP, bagFrameRect, bagBtnRect, bagCellRect, bagStripRect, bagHit,
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
  WIN_T, DEF_T, openDefeat, endSnapshot, endScreen, deadLayout, deadHit, deadActivate, respawnTime,
  // the replay window's rect this frame, its close box, and whether the pointer is on it
  rpRect, rpCloseRect, rpCloseHit,
  // routes: the search itself, and showPaths = true draws every unit's live route
  findPath, walkable, navTo, showPaths: false,
  // hero levels: pay a slot gold (and XP) the way a pickup would
  gainGold: (n, p) => gainGold(p || player, n), LEVEL_XP, LEVEL_MAX,
  // gear: the table, a slot's effective kit, and buy/pick without the HUD
  GEAR, GEAR_SLOTS, GEAR_COSTS, kitOf, refreshKit, gearHit, charLayout, charHit, BAG_CELL,
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
  // the level a spawn is dealt (the table's average), the meadow's strength
  // and its top-up (which a driver can call by hand to force one now)
  animalLevel, PREY_POP, updatePreyStock,
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
  startGame, beginIntro, beginSelect, lockIn, pressPlay, cancelCount, setAiLevel, selectLayout, AI_LEVELS, AI_ALLIES, aiProfile, setClass, CLASSES, menu: state.menu, menuHit, menuClick, menuKey, selectHit,
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
