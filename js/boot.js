// Softfall - a cozy winter survival game.
'use strict';
// The last file to load: the eagle drop that opens every match, the boot
// order, window.DBG and the requestAnimationFrame loop.

// ------------------------------------------------------------ eagle drop
// Nobody spawns in a camp: after LOCK IN each TEAM rides its own armoured
// eagle - RED and BLUE fly the one seed-fixed line in opposite directions,
// each keeping EAGLE_LANE to its own right so the pass mid-route is a clean
// fly-by (mode 'drop'). The view zooms out to DROP_ZOOM, a chart in the
// corner shows the line and both birds, and a rider jumps with
// Space/Enter/E/click (AI slots jump at their own hashed fraction of the
// route). A jumper free-falls for FALL_T onto the nearest open tile, which
// becomes its spawn tile (the bot brain's home); the human's landing snaps
// the view back to the player's own zoom and runs the HUD slide-in. If the
// rider never jumps, the end of the line jumps for them. state.drop outlives
// mode 'drop' - and now the whole match: past the line's end each bird dives
// into the treeline, blows a crater in the trees, and sits there as its
// team's OBJECTIVE. Keep your eagle alive: when one falls (hurtEagle /
// eagleFall) its whole side falls with it.
                            // the ride's framing is DROP_ZOOM (canvas banner): half scale, twice the view
const EAGLE_SPD = 170;      // px/s along the route
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
const EAGLE_HP = 320;       // the grounded objective's pool (~arrow damage x25)
const EAGLE_BODY_R = 26;    // what a rival arrow tests against once the bird is down
const EAGLE_WORK_DMG = 10;  // what one rival E swing chips off the roosting bird
const EAGLE_TILE_R = 1.6;   // tiles around the roost marked solid (its hitbox on the grid)
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
  return { x0, y0, x1, y1, len, dur: len / EAGLE_SPD, heading: Math.atan2(y1 - y0, x1 - x0) };
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
    return {
      team, heading: h, len: r.len, dur: r.dur,
      x0: sx, y0: sy, x1: ex, y1: ey, x: sx, y: sy,
      t: 0, prog: 0, flap: team * 0.4,
      state: 'fly',                 // fly -> dive -> down (the objective) -> dead
      diveT: 0, from: null, crash: null, restT: 0,
      hp: EAGLE_HP, maxHp: EAGLE_HP, flash: 0, boomT: 0, smokeT: 0,
    };
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
  PROFILE.addGame(); // one match played, counted as the eagles take off
  state.drop = { eagles: makeEagles() };
  const seats = [0, 0]; // next free wing seat per team; slot 0 takes seat 0 on the red bird
  for (const p of players) {
    if (!p.active) continue;
    const e = state.drop.eagles[p.team];
    p.aboard = true; p.dropT = 0;
    p.seat = seats[p.team]++;
    const sp = seatPos(e, p.seat);
    p.x = sp.x; p.y = sp.y;
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
  const d = state.drop.eagles[p.team];
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
  for (const e of state.drop.eagles) updateEagle(e, dt);
  for (const p of players) {
    if (!p.active) continue;
    if (p.aboard) {
      const e = state.drop.eagles[p.team];
      const sp = seatPos(e, p.seat);
      p.x = sp.x; p.y = sp.y;
      if (e.prog >= p.dropU) dropJump(p); // the end of the line drops the human too
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
    const dist = Math.min(EAGLE_SPD * e.t, e.len);
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
  } else if (e.state === 'dead') {
    // the wreck smoulders where the objective was lost
    e.smokeT -= dt;
    if (e.smokeT <= 0) {
      e.smokeT = 0.3;
      particles.push({
        x: e.x + rand(-8, 8), y: e.y + rand(-5, 3),
        vx: rand(-4, 4), vy: -rand(8, 16),
        life: rand(0.8, 1.4), maxLife: 1.2, color: '#5a627a', size: 2, grav: -8, alpha: 0.4,
      });
    }
  }
}

// the end of the line: whoever is still aboard is thrown, and the bird tips
// over into its dive toward the nearest standing forest past the line's end
function beginDive(e) {
  for (const p of players) if (p.active && p.aboard && p.team === e.team) dropJump(p);
  e.state = 'dive';
  e.from = { x: e.x, y: e.y };
  e.crash = findCrashPoint(e);
  e.diveT = 0;
}

// walk out past the line's end looking for a patch of trees: the first spot
// whose 5x5 holds a handful of them takes the impact. Pure reads - no rng(),
// no hash2 - so the same seed buries the same bird in the same trees.
function findCrashPoint(e) {
  const hx = Math.cos(e.heading), hy = Math.sin(e.heading);
  for (let step = 4; step <= 18; step++) {
    const tx = Math.floor((e.x + hx * step * TILE) / TILE);
    const ty = Math.floor((e.y + hy * step * TILE) / TILE);
    if (tx < 4 || ty < 4 || tx >= WORLD - 4 || ty >= WORLD - 4) break;
    let trees = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const o = inWorld(tx + dx, ty + dy) && objAt(tx + dx, ty + dy);
      if (o && (o.type === 'tree' || o.type === 'deadTree')) trees++;
    }
    if (trees >= 6) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
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

// a rival's arrow into the grounded bird (the sim.js arrow loop calls this)
function hurtEagle(e, dmg, src) {
  if (e.state !== 'down') return;
  e.hp -= dmg;
  e.flash = 0.12;
  burst(e.x, e.y - 8, '#f6f8ff', 5, 45, 0.5, true);
  burst(e.x, e.y - 8, TEAMS[e.team].mark, 3, 40, 0.4);
  if (nearPlayer(e.x, e.y)) SFX.hurt();
  if (e.hp <= 0) eagleFall(e, src);
}

// the objective is lost: a blast bigger than the landing, and the whole side
// falls with its bird - die() and teamInMatch() both read teamEagleDown, so
// every slot goes down permanent and checkLastStanding ends the match for
// whoever kept theirs.
function eagleFall(e, src) {
  e.state = 'dead';
  e.smokeT = 0;
  // the wreck is flat and burned: its roost tiles open back up
  const ctx0 = Math.floor(e.x / TILE), cty0 = Math.floor(e.y / TILE);
  const TR = Math.ceil(EAGLE_TILE_R);
  for (let dy = -TR; dy <= TR; dy++) for (let dx = -TR; dx <= TR; dx++) {
    const tx = ctx0 + dx, ty = cty0 + dy;
    if (!inWorld(tx, ty)) continue;
    const o = objAt(tx, ty);
    if (o && o.type === 'eagle' && o.team === e.team) objects[idx(tx, ty)] = null;
  }
  eagleBoomFx(e, 1.7);
  const near = Math.hypot(player.x - e.x, player.y - e.y);
  state.shake = Math.max(state.shake, near < 500 ? 10 : 6);
  SFX.boom();
  logEvent('THE ' + TEAMS[e.team].name + ' EAGLE HAS FALLEN', src || players.find((p) => p.team === e.team));
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

// the objective test the death/respawn path asks (player.js): a fallen eagle
// takes its team out of the match, Keep or no Keep
function teamEagleDown(team) {
  const e = state.drop && state.drop.eagles[team];
  return !!e && e.state === 'dead';
}

// both birds, the rider and every faller, above the world and below the
// lighting. Shadows sit `alt` below (and a little right of) each body,
// converging as a dive comes down.
function drawDropAir(ex, ey, now) {
  const d = state.drop;
  if (!d) return;
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
    const ps = champSet(p).down[1 + (Math.floor(p.dropT * 10) % 2)];
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
      ctx.drawImage(champSet(p).down[0], rx - rs / 2, ry - rs / 2 - 1, rs, rs);
    }
    // where a jump right now would land: a pulsing ring under the bird
    if (player.aboard && player.team === e.team && state.mode === 'drop') {
      const ph = (now * 1.2) % 1;
      ctx.globalAlpha = 0.8 - ph * 0.6;
      ctx.strokeStyle = '#ffd95c';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy + alt, 6 + ph * 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else {
    // grounded: the roosting objective (down) or the scorched silhouette it
    // leaves (dead). The landing is a landing, not a wound - the bird folds
    // its wings over EAGLE_SETTLE_T and then sits there breathing.
    const S = EAGLE_REST_SCALE;
    const fi = e.state === 'down' && e.restT < EAGLE_SETTLE_T
      ? Math.min(2, Math.floor(e.restT / EAGLE_SETTLE_T * 3)) : 2;
    const spr = frames[fi];
    const w = spr.width * S, h = spr.height * S;
    if (sx > -w - 70 && sy > -h - 70 && sx < WV_W + w + 70 && sy < WV_H + h + 70) {
      if (e.state === 'down') {
        // no cast shadow at rest: the bird is ON the ground, and a dark copy
        // under it read as a second bird (the 'dead' scorch still uses one)
        const breath = e.restT >= EAGLE_SETTLE_T ? Math.round(Math.sin(now * 1.5 + e.team * 2.1)) : 0;
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
      } else {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(e.heading);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(SPRITES.eagleShadow, -w / 2, -h / 2, w, h);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
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

// the ride's HUD: chart with the line and both birds, the jump prompt and timer
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
  const title = "THE EAGLES' LINE";
  drawPixelTextOutline(ctx, title, Math.round(cx0 + (cs - pixelTextWidth(title, ts)) / 2), cy0 - 3 - 7 * ts,
    '#ffd95c', '#0f1632', ts);
  // each bird's lane, dashed in its team colour, the flown part solid
  const mx = (x) => cx0 + (x / TILE) * k, my = (y) => cy0 + (y / TILE) * k;
  ctx.save();
  ctx.lineWidth = 3;                      // dark ink under the lines so they read on parchment and forest alike
  ctx.strokeStyle = 'rgba(36,26,16,0.7)';
  for (const e of d.eagles) {
    ctx.beginPath(); ctx.moveTo(mx(e.x0), my(e.y0)); ctx.lineTo(mx(e.x1), my(e.y1)); ctx.stroke();
  }
  ctx.lineWidth = 1;
  for (const e of d.eagles) {
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = TEAMS[e.team].mark;
    ctx.beginPath(); ctx.moveTo(mx(e.x0), my(e.y0)); ctx.lineTo(mx(e.x1), my(e.y1)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#fff3c0';
    ctx.beginPath(); ctx.moveTo(mx(e.x0), my(e.y0)); ctx.lineTo(mx(e.x), my(e.y)); ctx.stroke();
  }
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

  // the ends of the line: where each bird drops whoever is still aboard
  for (const e of d.eagles) {
    ctx.fillStyle = '#241a10'; ctx.fillRect(Math.round(mx(e.x1)) - 2, Math.round(my(e.y1)) - 2, 5, 5);
    ctx.fillStyle = TEAMS[e.team].mark; ctx.fillRect(Math.round(mx(e.x1)) - 1, Math.round(my(e.y1)) - 1, 3, 3);
  }
  // landed rivals, in team colour
  for (const p of players) {
    if (p === player || !p.active || inAir(p)) continue;
    const px = Math.round(mx(p.x)), py = Math.round(my(p.y));
    ctx.fillStyle = '#241a10'; ctx.fillRect(px - 2, py - 2, 5, 5);
    ctx.fillStyle = TEAMS[p.team].mark; ctx.fillRect(px - 1, py - 1, 3, 3);
  }
  // the birds: team diamonds, yours with a pulsing ring; your landing once you have jumped
  for (const e of d.eagles) {
    const bx = Math.round(mx(e.x)), by = Math.round(my(e.y));
    if (e.team === player.team) {
      const ph = (now * 0.9) % 1;
      ctx.globalAlpha = (1 - ph) * 0.6;
      ctx.strokeStyle = '#f4f7ff';
      ctx.beginPath(); ctx.arc(bx, by, 2 + ph * 6, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#241a10';
    ctx.fillRect(bx - 3, by - 1, 7, 3); ctx.fillRect(bx - 1, by - 3, 3, 7);
    ctx.fillStyle = TEAMS[e.team].mark;
    ctx.fillRect(bx - 2, by, 5, 1); ctx.fillRect(bx, by - 2, 1, 5);
  }
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
    // time left on your own bird's line
    const me = d.eagles[player.team];
    const left = Math.max(0, me.dur - me.t);
    const bw = 60 * ts, bh = 3 * ts, bxx = cxm - bw / 2, byy = 19 * ts;
    ctx.fillStyle = 'rgba(12,18,42,0.78)';
    ctx.fillRect(bxx - 1, byy - 1, bw + 2, bh + 2);
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(bxx, byy, bw, bh);
    ctx.fillStyle = left < 3 ? '#ff6a5a' : '#f4f7ff';
    ctx.fillRect(bxx, byy, Math.round(bw * (1 - me.prog)), bh);
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
  // the eagle drop: the live flight records, force a jump, or fly the route from scratch
  get drop() { return state.drop; }, beginDrop, dropJump: (p) => dropJump(p || player), landPlayer, makeEagleRoute, makeEagles, inAir,
  // the two objectives: read them, chip one, or fell one outright without a siege
  get eagles() { return state.drop && state.drop.eagles; },
  hurtEagle: (team, dmg, src) => { const e = state.drop.eagles[team]; hurtEagle(e, dmg == null ? 25 : dmg, src); return e; },
  eagleFall: (team, src) => eagleFall(state.drop.eagles[team], src),
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
