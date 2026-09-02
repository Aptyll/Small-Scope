'use strict';
// How things move: tile collision (moveEntity), unit-vs-unit solidity
// (separateUnits), and the A* routing every self-mover walks by (navTo/navStep).
// ------------------------------------------------------------ movement & collision
// strict = treat open water as a wall for players too (a shove must never
// dunk someone; only their own movement can)
function moveEntity(e, dx, dy, r, strict) {
  // only players can enter open water holes (they fall in - see updatePlayer);
  // animals and robots treat those tiles as walls
  const solid = e instanceof Player && !strict ? isSolidTile :
    (tx, ty) => isSolidTile(tx, ty) || (inWorld(tx, ty) && ground[idx(tx, ty)] === 2);
  let blockedX = false, blockedY = false;
  // X axis
  if (dx !== 0) {
    const nx = e.x + dx;
    const x0 = Math.floor((nx - r) / TILE), x1 = Math.floor((nx + r) / TILE);
    const y0 = Math.floor((e.y - r) / TILE), y1 = Math.floor((e.y + r) / TILE);
    let hit = false;
    for (let ty = y0; ty <= y1; ty++) {
      const tx = dx > 0 ? x1 : x0;
      if (solid(tx, ty)) hit = true;
    }
    if (!hit) e.x = nx; else blockedX = true;
  }
  // Y axis
  if (dy !== 0) {
    const ny = e.y + dy;
    const y0 = Math.floor((ny - r) / TILE), y1 = Math.floor((ny + r) / TILE);
    const x0 = Math.floor((e.x - r) / TILE), x1 = Math.floor((e.x + r) / TILE);
    let hit = false;
    for (let tx = x0; tx <= x1; tx++) {
      const ty = dy > 0 ? y1 : y0;
      if (solid(tx, ty)) hit = true;
    }
    if (!hit) e.y = ny; else blockedY = true;
  }
  return { blockedX, blockedY };
}

// ---- unit collisions ---------------------------------------------------
// Players, animals and robots are solid circles to each other. After every
// mover has taken its step, separateUnits() pushes overlapping pairs apart,
// splitting the overlap by inverse mass (a player shoves a rabbit aside and
// barely notices; two players split it evenly). Each push goes through
// moveEntity (strict), so nobody is shoved into a wall or a hole - and any
// push the wall refused is handed to the other unit instead, which is what
// keeps a small unit from ever pinning a player in a corner: the player's
// share is tried first, and whatever it cannot take, the pinner takes.
// Momentum: a player moving into the contact loses only its *share* of the
// normal velocity component per tick (tangential speed is untouched, so a
// slide into a deer deflects along it rather than sticking), the rest of
// that component is handed to the other unit as knockback, and a lighter
// unit gets a small bounce off a heavier one. Two relaxation passes settle
// piles. Deterministic: fixed iteration order, no rng.
const UNIT_MASS = { player: 3, deer: 2.2, wolf: 2, rabbit: 0.5, robot: 0.7, merchant: 3 };
const UNIT_BOUNCE = 0.3; // restitution for the lighter side of a contact
// the merchant (robots.js) is a player-sized body in the robots list, so it takes a player's radius
function unitRadius(e) { return e instanceof Player ? PLAYER_R : e.kind === 'rabbit' ? 2.5 : e.kind === 'deer' ? 5 : e.kind === 'wolf' ? 4.5 : e.kind === 'merchant' ? PLAYER_R : 3; }
function separateUnits() {
  const us = [];
  for (const p of players) if (p.active && !p.dead && !inAir(p)) us.push({ e: p, r: PLAYER_R, m: UNIT_MASS.player, vel: true, small: true, roll: p.dodgeT > 0 });
  // birds fly: they are the one unit nothing collides with
  for (const a of animals) if (!a.dead && a.kind !== 'bird') us.push({ e: a, r: unitRadius(a), m: UNIT_MASS[a.kind], vel: false, small: a.kind !== 'deer' });
  for (const b of robots) if (!b.dead) us.push({ e: b, r: unitRadius(b), m: UNIT_MASS[b.kind] || UNIT_MASS.robot, vel: false, small: true });
  // velocity a unit carries into a contact: players their momentum, the
  // rest their knockback (their walk is direction-only and re-chosen each tick)
  const vx = (u) => u.vel ? u.e.vx + u.e.kbx : u.e.kbx;
  const vy = (u) => u.vel ? u.e.vy + u.e.kby : u.e.kby;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      const a = us[i], b = us[j];
      // a live roll is not there for anything small: it passes straight
      // through and rollSweep turns that contact into a hit instead. A deer
      // is the one unit heavy enough to still stop it, and that stop is a tackle.
      if ((a.roll && b.small) || (b.roll && a.small)) continue;
      let dx = b.e.x - a.e.x, dy = b.e.y - a.e.y;
      let d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d >= min) continue;
      if (d < 0.01) { dx = 1; dy = 0; d = 1; } // dead-centre stack: part along +x
      const nx = dx / d, ny = dy / d, overlap = min - d;
      const sa = b.m / (a.m + b.m), sb = 1 - sa; // a's share of the push (lighter moves more)
      // positions: a's share first, then b takes its own share plus what a's wall refused
      const ax = a.e.x, ay = a.e.y;
      moveEntity(a.e, -nx * overlap * sa, -ny * overlap * sa, a.r, true);
      const left = overlap - Math.hypot(a.e.x - ax, a.e.y - ay);
      const bx = b.e.x, by = b.e.y;
      moveEntity(b.e, nx * left, ny * left, b.r, true);
      // and if b's wall refused some, a tries once more with the remainder
      const left2 = left - Math.hypot(b.e.x - bx, b.e.y - by);
      if (left2 > 0.01) moveEntity(a.e, -nx * left2, -ny * left2, a.r, true);
      if (pass) continue; // velocities settle on the first pass only
      // velocities along the contact normal (positive = closing)
      const va = vx(a) * nx + vy(a) * ny, vb = -(vx(b) * nx + vy(b) * ny);
      if (va > 0) bump(a, b, va, nx, ny, sa);
      if (vb > 0) bump(b, a, vb, -nx, -ny, sb);
    }
  }
  // u is closing on o at speed vn along (nx, ny); it keeps (1 - share) of that
  // component, o is knocked along it, and a lighter u bounces a little
  function bump(u, o, vn, nx, ny, share) {
    const lose = vn * share * (1 + (u.m < o.m ? UNIT_BOUNCE : 0));
    if (u.vel) { u.e.vx -= lose * nx; u.e.vy -= lose * ny; }
    else { u.e.kbx -= lose * nx; u.e.kby -= lose * ny; }
    const give = vn * share * 0.8;
    o.e.kbx += give * nx; o.e.kby += give * ny;
  }
}

// ------------------------------------------------------------ pathfinding
// Grid A* over the tile map for everything that walks on its own: robots,
// animals, bot slots and any future enemy. A tile is walkable when it is
// in-world, not solid and not open water (players can enter a hole, but
// nothing steers into one on purpose). Eight-connected with no corner
// cutting - a diagonal step needs both orthogonal neighbours open, so a unit
// of radius <= 5 walking tile centre to tile centre never clips a tree.
// Deterministic: fixed neighbour order, stable heap, no rng.
//
//   findPath(sx, sy, gx, gy, reach, budget) -> [[x, y], ...] | null
//     world-space waypoints (tile centres, start excluded), done when a tile
//     within `reach` (Chebyshev) of the goal tile is reached - reach 1 lets a
//     robot path to a tree it cannot stand on. A search that runs out of
//     budget returns the route to the closest tile it saw (path.partial), so
//     a far goal still gets a first leg; only an enclosed goal returns null.
//   navTo(e, gx, gy, r, reach, dt)  -> { dx, dy, d, ok }
//     the direction to move this frame along e.nav's route, replanning when
//     the goal moves a tile, every NAV_REPLAN s, or when moveEntity reports a
//     block. d is the straight-line distance to the goal (callers keep their
//     own arrive radius). ok = false means the goal is unreachable or the
//     unit has made no progress for NAV_STALL s (pinned by other units) -
//     that is the signal to drop the target; there is no give-up timer.
//   navStep(e, gx, gy, r, spd, dt, reach) -> navTo + moveEntity + mvx/mvy
//     for the animal/robot movers (players move through their momentum).
//   navClear(e) forgets the route; call it when a unit changes its mind.
const NAV_BUDGET = 700;      // A* expansions per search (~a 25-tile detour)
const NAV_REPLAN = 0.6;      // s between replans toward a goal that sits still
const NAV_STALL = 1.6;       // s of no progress on a route before it counts as pinned
const NAV_N = WORLD * WORLD;
const navG = new Float32Array(NAV_N);
const navParent = new Int32Array(NAV_N);
const navSeen = new Uint32Array(NAV_N);   // generation stamp: node has a g
const navDone = new Uint32Array(NAV_N);   // generation stamp: node is closed
let navGen = 0;
// binary heap keyed by f, parallel arrays, lazy deletion of stale entries
const heapN = [], heapF = [];
function heapPush(n, f) {
  let i = heapN.length; heapN.push(n); heapF.push(f);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= f) break;
    heapN[i] = heapN[p]; heapF[i] = heapF[p]; i = p;
  }
  heapN[i] = n; heapF[i] = f;
}
function heapPop() {
  const n = heapN[0], ln = heapN.pop(), lf = heapF.pop();
  if (heapN.length) {
    let i = 0;
    const len = heapN.length;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= len) break;
      if (c + 1 < len && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heapN[i] = heapN[c]; heapF[i] = heapF[c]; i = c;
    }
    heapN[i] = ln; heapF[i] = lf;
  }
  return n;
}
const NAV_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const NAV_DY = [0, 0, 1, -1, 1, -1, 1, -1];
const NAV_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
function walkable(tx, ty) {
  return inWorld(tx, ty) && !isSolidTile(tx, ty) && ground[idx(tx, ty)] !== 2;
}
function navH(tx, ty, gx, gy) {
  const dx = Math.abs(tx - gx), dy = Math.abs(ty - gy);
  return dx > dy ? dx + dy * (Math.SQRT2 - 1) : dy + dx * (Math.SQRT2 - 1);
}
function findPath(sx, sy, gx, gy, reach, budget) {
  reach = reach || 0;
  budget = budget || NAV_BUDGET;
  let stx = Math.floor(sx / TILE), sty = Math.floor(sy / TILE);
  const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
  if (!inWorld(gtx, gty)) return null;
  if (!reach && !walkable(gtx, gty)) return null;
  // a unit shoved half into a wall starts from the nearest open tile instead
  if (!walkable(stx, sty)) {
    let found = false;
    for (let k = 0; k < 8 && !found; k++) {
      if (walkable(stx + NAV_DX[k], sty + NAV_DY[k])) { stx += NAV_DX[k]; sty += NAV_DY[k]; found = true; }
    }
    if (!found) return null;
  }
  navGen++;
  if (navGen === 0xffffffff) { navSeen.fill(0); navDone.fill(0); navGen = 1; }
  heapN.length = 0; heapF.length = 0;
  const s = idx(stx, sty);
  navG[s] = 0; navParent[s] = -1; navSeen[s] = navGen;
  heapPush(s, navH(stx, sty, gtx, gty));
  let best = s, bestH = navH(stx, sty, gtx, gty), expanded = 0, goal = -1;
  while (heapN.length) {
    const n = heapPop();
    if (navDone[n] === navGen) continue;
    navDone[n] = navGen;
    const tx = n % WORLD, ty = (n / WORLD) | 0;
    if (Math.max(Math.abs(tx - gtx), Math.abs(ty - gty)) <= reach) { goal = n; break; }
    const h = navH(tx, ty, gtx, gty);
    if (h < bestH) { bestH = h; best = n; }
    if (++expanded > budget) break;
    const g = navG[n];
    for (let k = 0; k < 8; k++) {
      const nx = tx + NAV_DX[k], ny = ty + NAV_DY[k];
      if (!walkable(nx, ny)) continue;
      if (k >= 4 && !(walkable(tx + NAV_DX[k], ty) && walkable(tx, ty + NAV_DY[k]))) continue;
      const m = idx(nx, ny);
      if (navDone[m] === navGen) continue;
      const ng = g + NAV_COST[k];
      if (navSeen[m] === navGen && navG[m] <= ng) continue;
      navG[m] = ng; navParent[m] = n; navSeen[m] = navGen;
      heapPush(m, ng + navH(nx, ny, gtx, gty));
    }
  }
  const end = goal >= 0 ? goal : best;
  if (end === s) return goal >= 0 ? [] : null;
  const path = [];
  for (let n = end; n !== s && n >= 0; n = navParent[n]) path.push([(n % WORLD) * TILE + 8, ((n / WORLD) | 0) * TILE + 8]);
  path.reverse();
  path.partial = goal < 0;
  return path;
}

// can a circle of radius r slide from (x0,y0) to (x1,y1) without touching a
// wall or a hole? the same four-corner test moveEntity makes, every 4 px
function navLineClear(x0, y0, x1, y1, r) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
  const steps = Math.ceil(d / 4) || 1;
  for (let i = 1; i <= steps; i++) {
    const x = x0 + dx * i / steps, y = y0 + dy * i / steps;
    const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
    const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!walkable(tx, ty)) return false;
  }
  return true;
}
// string-pull: keep only the waypoints the unit cannot see past (bounded
// look-ahead so a long route stays cheap)
function navSmooth(path, x, y, r) {
  const out = [];
  let i = 0, fx = x, fy = y;
  while (i < path.length) {
    let j = i;
    for (let k = i + 1; k < path.length && k <= i + 10; k++) {
      if (navLineClear(fx, fy, path[k][0], path[k][1], r)) j = k;
    }
    out.push(path[j]);
    fx = path[j][0]; fy = path[j][1];
    i = j + 1;
  }
  out.partial = path.partial;
  return out;
}

function navClear(e) { if (e.nav) { e.nav.path = null; e.nav.fail = false; e.nav.stallT = 0; } }
// budget (optional) is findPath's expansion budget for THIS goal - a walk
// into a corner's forest asks for more than NAV_BUDGET, which is sized for
// a detour in the open
function navTo(e, gx, gy, r, reach, dt, budget) {
  reach = reach || 0;
  const nav = e.nav || (e.nav = { path: null, i: 0, gtx: -1, gty: -1, replanT: 0, fail: false, stallT: 0, lx: 0, ly: 0, reach: 0 });
  const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
  nav.replanT -= dt;
  const moved = Math.abs(gtx - nav.gtx) + Math.abs(gty - nav.gty);
  const far = Math.hypot(gx - e.x, gy - e.y);
  // a goal that just proved unreachable is not searched again every frame
  if (!nav.path && nav.fail && nav.replanT > 0 && moved <= 1 && nav.reach === reach) return { dx: 0, dy: 0, d: far, ok: false };
  if (!nav.path || moved > 1 || nav.replanT <= 0 || nav.reach !== reach) {
    nav.gtx = gtx; nav.gty = gty; nav.reach = reach; nav.replanT = NAV_REPLAN; nav.i = 0;
    if (navLineClear(e.x, e.y, gx, gy, r)) {
      nav.path = [[gx, gy]];
    } else {
      const p = findPath(e.x, e.y, gx, gy, reach, budget);
      nav.path = p ? navSmooth(p, e.x, e.y, r) : null;
      if (nav.path && !nav.path.length) nav.path = [[gx, gy]]; // already within reach
    }
    if (!nav.path) { nav.fail = true; return { dx: 0, dy: 0, d: far, ok: false }; }
    nav.fail = false;
    if (moved > 1) nav.stallT = 0;
  }
  // progress watch: a unit pinned by other units drifts nowhere; a route
  // that stalls this long is handed back as unreachable
  const prog = Math.hypot(e.x - nav.lx, e.y - nav.ly);
  nav.lx = e.x; nav.ly = e.y;
  nav.stallT = prog > 6 * dt ? 0 : nav.stallT + dt;
  if (nav.stallT > NAV_STALL) { nav.stallT = 0; nav.path = null; nav.fail = true; nav.replanT = 0; return { dx: 0, dy: 0, d: far, ok: false }; }
  const path = nav.path;
  while (nav.i < path.length - 1 && Math.hypot(path[nav.i][0] - e.x, path[nav.i][1] - e.y) < 5) nav.i++;
  const wp = path[nav.i];
  const dx = wp[0] - e.x, dy = wp[1] - e.y;
  const wd = Math.hypot(dx, dy) || 1;
  return { dx: dx / wd, dy: dy / wd, d: far, ok: true };
}
// walk an animal/robot one step along its route; a wall hit on a route
// older than a moment replans at once (a fresh one is left to the stall watch)
function navStep(e, gx, gy, r, spd, dt, reach) {
  const n = navTo(e, gx, gy, r, reach, dt);
  if (!n.ok) return n;
  e.mvx = n.dx; e.mvy = n.dy;
  // The one place a self-mover's speed is spent, so it is the one place the
  // net, the crater and the snare's jaws have to be folded in: unitMoveMul
  // (js/actions.js) is abilityMoveMul's twin for everything that is not a
  // slot, and a rooted animal or bot comes out of it at zero.
  spd *= unitMoveMul(e);
  const mv = moveEntity(e, (n.dx * spd + e.kbx) * dt, (n.dy * spd + e.kby) * dt, r);
  if ((mv.blockedX || mv.blockedY) && e.nav.replanT < NAV_REPLAN - 0.2) e.nav.replanT = 0;
  return n;
}

