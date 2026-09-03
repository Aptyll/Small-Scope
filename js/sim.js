'use strict';
// The frame sim: update()/updatePlay() step every slot, arrow, drop and
// timer; updatePlayer is the one body every controller drives; updateFx ages
// the cosmetics. Owns the camera (camX/camY) and the world-space snow.
// ------------------------------------------------------------ update
let camX = 0, camY = 0;

// Ease the world scale toward what is wanted and resize the world view to
// match. Nothing here touches the canvas, so unlike the old applyView() it
// never calls fitCanvas()/relayout() and the overlays no longer have to force
// the zoom back to base to make their fixed-size panels fit. `snap` lands on
// the target immediately, for the two mode changes that must not be seen
// easing (boot, and the eagle's fixed framing).
function applyZoom(dt, snap) {
  const want = state.mode === 'drop' ? DROP_ZOOM : zoomWantOf();
  const k = 1 - Math.exp(-ZOOM_EASE * dt);
  if (snap) zoomCur = want;
  else {
    zoomCur += (want - zoomCur) * k;
    if (Math.abs(want - zoomCur) < 0.0008) zoomCur = want; // park it, or WV jitters by a px forever
  }
  sizeWorldView();
  // the minimap rides the same ease off the same constant, so both zooms
  // under one hand feel like one control
  const mw = mmWant();
  if (snap || mmCur < 0) mmCur = mw;
  else {
    mmCur += (mw - mmCur) * k;
    if (Math.abs(mw - mmCur) < 0.0008) mmCur = mw;
  }
}

function update(dt) {
  applyZoom(dt);
  // the wind gusts and the night owl audio.js schedules over its synth bed:
  // on wherever the world is live, off under the death and victory screens,
  // where a song already owns the mix
  SFX.setAmbience(!state.paused && (state.mode !== 'dead' || state.over === 'respawning'),
    state.darkness > 0.55);

  // time (the clock starts with the eagle - the match is live while you ride).
  // The practice arena has no clock at all: state.time stays pinned at the
  // boot's early morning, so it is always crisp daylight, no dusk, no dawn
  // refreeze - a training room, not a day
  if ((state.mode === 'play' || state.mode === 'drop') && !PRACTICE) {
    state.time += dt;
    state.elapsed += dt;
    if (state.time >= CYCLE) {
      state.time -= CYCLE;
      state.day++;
      // the profile's days played: each dawn the player is still in the match
      // counts the day it opens (day 1 counted itself at takeoff), so quitting
      // to the lobby mid-match still keeps the days begun. Practice is not a
      // match: its dawns count nothing, like the rest of its stats.
      if (!player.eliminated && !PRACTICE) PROFILE.addDay();
      SFX.dawnChime();
      state.dayPop = { day: state.day, t: 0 }; // the dawn headline, top centre (renderUI)
      // carved ice holes freeze back over during the night; cracks heal too.
      // A hole with a net on it is the exception - the net is what holds that
      // water open - so it stays in the list and refreezes the dawn after
      // whoever wrecks the net.
      const kept = [];
      for (const i of holes) {
        if (netAt(i % WORLD, (i / WORLD) | 0)) { kept.push(i); continue; }
        ground[i] = 1;
        repaintGround(i % WORLD, (i / WORLD) | 0);
      }
      holes.length = 0;
      for (const i of kept) holes.push(i);
      iceCracks.clear();
      // the shoal is not reset here any more: it is a live population now,
      // fished down and refilled a fish at a time by updateFish's trickle
    }
  }
  // darkness curve
  const t = state.time;
  let dark = 0;
  if (t < DAY_LEN - 12) dark = 0;
  else if (t < DAY_LEN) dark = (t - (DAY_LEN - 12)) / 12;
  else if (t < CYCLE - 10) dark = 1;
  else dark = 1 - (t - (CYCLE - 10)) / 10;
  state.darkness = dark;

  if (state.mode === 'dead') {
    const was = state.deadTimer;
    state.deadTimer += dt; // the overlay's fade-in, and the victory screen's clock
    if (state.over === 'won') winCues(was, state.deadTimer);
    // the defeat summary runs on a clock of its own - it opens off a plank,
    // long after the death this overlay has been timing
    if (state.deadView === 'defeat') {
      const d0 = state.defeatT;
      state.defeatT += dt;
      defCues(d0, state.defeatT);
    }
  }

  // the match runs on while the local player is down - other slots are still
  // playing. Only pause and the settings panel stop the sim: the map is read
  // with the world still moving, the same deal the build wheel takes.
  if ((state.mode === 'play' || state.mode === 'dead' || state.mode === 'drop') &&
    !state.paused && !state.settingsOpen) {
    sampleHumanInput(player);
    updatePlay(dt);
  } else if (state.mode === 'play' || state.mode === 'dead' || state.mode === 'drop') {
    sampleHumanInput(player); // still drops a held draw when an overlay opens
  } else if (state.mode === 'title') {
    updateTitle(dt); // menu timers, camera drift, and the ambient world behind it
  }

  // camera
  if (state.mode === 'title') {
    const c = titleCamTarget();
    camX = c.x; camY = c.y;
  } else if (state.mode === 'drop') {
    // riding: track the eagle (the rider sits on it); falling: hold over the
    // landing point. The first INTRO_T eases in from where the drift left off.
    const tx = player.x - WV_W / 2, ty = player.y - WV_H / 2;
    if (state.intro > 0) {
      state.intro = Math.max(0, state.intro - dt);
      const q = easeInOut(1 - state.intro / state.introLen);
      camX = state.introFrom.x + (tx - state.introFrom.x) * q;
      camY = state.introFrom.y + (ty - state.introFrom.y) * q;
    } else {
      camX += (tx - camX) * Math.min(1, dt * 9);
      camY += (ty - camY) * Math.min(1, dt * 9);
    }
  } else if (state.drop && (state.eagleCine ||
      (state.mode === 'dead' && state.drop.eagles.some((q) => q.state === 'flee')))) {
    // the match is decided: every eye goes to the bird that broke. The camera
    // glides over and holds it centred while the takeoff plays out - the end
    // screens wait for it (eagleFleeResolve, js/boot.js), then rise over the
    // escape still flying underneath. League-style. Only KEEP PLAYING (mode
    // back to 'play' with no ceremony) hands the camera back early.
    const ec = state.eagleCine ? state.drop.eagles[state.eagleCine.team]
      : state.drop.eagles.find((q) => q.state === 'flee');
    camX += (ec.x - WV_W / 2 - camX) * Math.min(1, dt * 3.5);
    camY += (ec.y - WV_H / 2 - camY) * Math.min(1, dt * 3.5);
  } else if (state.drop && state.dropBrief) {
    // the drop brief (updateDrop, js/boot.js): a forced landing's roost tour.
    // The same glide the driven-off ceremony uses, aimed by the brief's phase
    // - out to your own bird (tracking its dive if it is still falling), the
    // rival's, then home to your boots, where the play camera takes over.
    const bt = dropBriefTarget();
    camX += (bt.x - WV_W / 2 - camX) * Math.min(1, dt * 3.5);
    camY += (bt.y - WV_H / 2 - camY) * Math.min(1, dt * 3.5);
  } else {
    const vp = viewPlayer();
    const look = vp === player ? 0.12 : 0; // the aim lean is the local slot's; a watched one is framed dead centre
    // the lean is a FRACTION of the view, so it divides by the zoom: the same
    // pointer offset leans the same share of the screen however close you are
    const lookX = (mouse.x - VIEW_W / 2) / zoomCur * look;
    const lookY = (mouse.y - VIEW_H / 2) / zoomCur * look;
    const tx = vp.x - WV_W / 2 + lookX;
    const ty = vp.y - WV_H / 2 + lookY;
    if (state.intro > 0) {
      // landing -> play: glide from the touchdown framing onto the play
      // camera with an ease, instead of the play lerp's snap
      state.intro = Math.max(0, state.intro - dt);
      const q = easeInOut(1 - state.intro / state.introLen);
      camX = state.introFrom.x + (tx - state.introFrom.x) * q;
      camY = state.introFrom.y + (ty - state.introFrom.y) * q;
      // the landing anchors the calendar: DAY 1, the same headline every
      // dawn after it re-raises (practice is a training room, not a day). A
      // drop brief owns the top of the screen until it hands back, so it
      // pops the day itself (endBrief, js/boot.js)
      if (state.intro === 0 && !PRACTICE && !state.dropBrief) state.dayPop = { day: state.day, t: 0 };
    } else {
      camX += (tx - camX) * Math.min(1, dt * 7);
      camY += (ty - camY) * Math.min(1, dt * 7);
    }
  }
  camX = Math.max(0, Math.min(WORLD * TILE - WV_W, camX));
  camY = Math.max(0, Math.min(WORLD * TILE - WV_H, camY));

  // screen fades (the reroll whiteout)
  if (state.fade) {
    const f = state.fade;
    const up = f.to > f.a;
    f.a += (up ? 1 : -1) * f.spd * dt;
    if (up ? f.a >= f.to : f.a <= f.to) {
      f.a = f.to;
      const then = f.then; f.then = null;
      if (f.a === 0) state.fade = null;
      if (then) then();
    }
  }

  state.shake = Math.max(0, state.shake - dt * 12);
  state.msgT = Math.max(0, state.msgT - dt);
  if (state.dayPop && (state.dayPop.t += dt) >= 3.5) state.dayPop = null;

  updateFx(dt);
}

// A shot's reach into a body: the disc round a slot's centre an arrow lands
// in, wider than the 4.5 px body a walker collides with. A walking target
// crosses its own width twice in the quarter second a full-draw arrow takes
// to fly 80 px, so at the body's own radius almost nothing lands on a moving
// rival (2.47's playtest: 24 shots at a circling bot, none hit) - and the
// same disc on every side keeps it a fact of arrows, not a hidden handicap.
const ARROW_HIT_R = 10;
// ------------------------------------------------------------ passive income
// The clock pays: every slot on the ground draws TRICKLE_GOLD into its
// wallet every TRICKLE_T s, through gainGold so it levels too - the League
// trickle. A floor under everyone's purse, so a player who never swings an
// axe still buys gear and still reaches the mid levels, and a farmer pulls
// ahead only by the fells, never by the clock. Silent on purpose: no floater,
// no blip - the bag strip's number and the xp bar are the tell. The practice
// arena has no clock and gets none; the dead and the airborne earn nothing.
const TRICKLE_GOLD = 1;
const TRICKLE_T = 4;      // s per coin: 15 gold a minute, ~225 over a fifteen-minute match
function updatePlay(dt) {
  state.tick++; // with SEED and the player id, this decides contested orders

  // every slot steps through the same code, each off its own input struct
  // (slots still on or under the eagle are moved by updateDrop instead)
  for (const p of players) {
    if (!p.active || inAir(p)) continue;
    if (p.control === 'ai') updateAI(p, dt);
    updatePlayer(p, dt);
    if (!p.dead && !PRACTICE) {
      p.trickleT += dt;
      if (p.trickleT >= TRICKLE_T) { p.trickleT -= TRICKLE_T; gainGold(p, TRICKLE_GOLD); }
    }
  }
  resolveContests(); // this step's work swings, build orders and fish claims
  if (!PRACTICE) updateMarket(dt); // fish/berry prices and the merchants' stock (js/shop.js)
  updateAbilityWorld(dt); // craters and nets in flight
  if (state.drop) updateDrop(dt);

  // Shots in flight. Everything a tool fires rides this one array, whatever
  // bit it came out of - steerBit() is where the bit's flight path gets to
  // rewrite the velocity before the step is taken, so the trail, the hit
  // tests and the drawn body all just follow wherever it went. A turret bolt
  // carries no path and falls straight through it.
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.t += dt;
    steerBit(a, dt);
    const vd = Math.hypot(a.vx, a.vy) || 1;
    const nx = a.vx / vd, ny = a.vy / vd;
    a.x += a.vx * dt; a.y += a.vy * dt;
    // a faint mote in the shooter's colour every few px of flight: the shot
    // reads as a streak, and whose shot it is reads from across the map. The
    // step just walked is subdivided (rather than one mote per tick) so the
    // spacing survives both a slow arrow and a long frame; the motes are laid
    // off the TAIL (the body runs ARROW_LEN px behind the tip a shaft flies
    // by, so the trail flows off the fletching, never through the body) at
    // the distance they are owed and left to fade in place - and not before
    // the tail has cleared the bow, or every launch flicks a mote across the
    // archer's back.
    a.trailD += vd * dt;
    a.flown = (a.flown || 0) + vd * dt;
    const tailB = (a.kind === 'bolt' || a.path === 'lob' || a.path === 'orbit') ? 0 : ARROW_LEN;
    while (a.trailD >= ARROW_TRAIL_STEP) {
      a.trailD -= ARROW_TRAIL_STEP;
      if (a.flown < tailB + a.trailD) continue;
      particles.push({
        x: a.x - nx * (tailB + a.trailD), y: a.y - ny * (tailB + a.trailD),
        vx: -nx * 8, vy: -ny * 8,
        life: ARROW_TRAIL_LIFE, maxLife: ARROW_TRAIL_LIFE,
        // the trail says WHOSE shot it is, which is what it is for - except a
        // burning one, where the fire is the more urgent fact about it
        color: a.burn > 0 ? (((a.trailD * 3) | 0) % 2 ? '#ff9440' : '#ffd95c') : TEAMS[skin(a.team)].mark,
        size: 1, grav: 0, alpha: ARROW_TRAIL_A,
      });
    }
    let dead = a.t > a.life;
    if (!dead && state.drop) {
      // the grounded eagles are the objectives: the roost's own hitbox tiles
      // ARE the hit test, so anywhere a walker collides, an arrow damages -
      // a radius around the bird's centre missed the block's corners. Tested
      // BEFORE tile solidity, which would eat the shot; a friendly arrow
      // falls through to it and dies on the tile like any other miss.
      const atx = Math.floor(a.x / TILE), aty = Math.floor(a.y / TILE);
      if (inWorld(atx, aty)) {
        const o = objects[idx(atx, aty)];
        if (o && o.type === 'eagle' && o.team !== a.team) {
          hurtEagle(state.drop.eagles[o.team], EAGLE_ARROW_DMG, players[a.owner], a.x, a.y); // a flat spook, not the body damage
          if (a.ambush) ambushFx(a.x, a.y);
          dead = true; a.struck = true;
        }
      }
    }
    if (!dead && PRACTICE) {
      // the practice dummy: nearly three tiles tall on one solid tile, so a
      // shot through the torso or head tiles (one and two above the base)
      // lands too - tested before tile solidity, which would eat the base hit
      const atx = Math.floor(a.x / TILE), aty = Math.floor(a.y / TILE);
      let dm = null;
      for (let dd = 0; dd <= 2 && !dm; dd++) {
        const o = objAt(atx, aty + dd);
        if (o && o.type === 'dummy') dm = o;
      }
      if (dm && !(a.pierce && a.pierceHit.includes(dm))) {
        hitDummy(dm, a.dmg, a.x, a.y);
        if (a.ambush) ambushFx(a.x, a.y);
        a.struck = true;
        if (a.pierce) a.pierceHit.push(dm); // the pierce keeps flying
        else dead = true;
      }
      // ...and the archery targets: the shot meets the FACE, wherever its
      // habit has carried it - ptFace is the same geometry the draw uses,
      // and the hit disc scales with the target's size (ptHitR)
      if (!dead) for (const t of ptargets) {
        if (!ptLive(t)) continue;
        const f = ptFace(t);
        if (Math.hypot(f.x - a.x, f.y - a.y) < ptHitR(t)) {
          hitPTarget(t); // the face explodes on contact
          a.ptHit = true; // this shot keeps the consecutive-hit run alive
          if (a.ambush) ambushFx(a.x, a.y);
          dead = true; a.struck = true;
          break;
        }
      }
    }
    // a bit whose `solid` is false passes through the world - that is the
    // whole of "never hits ground", and the only reason a wisp can circle you
    // through a treeline
    if (!dead && a.solid !== false && isSolidTile(Math.floor(a.x / TILE), Math.floor(a.y / TILE))) {
      dead = true; a.struck = true;
      burst(a.x, a.y, '#cfd8e8', 3, 25, 0.25, true);
      if (a.burn > 0) burst(a.x, a.y, '#ff9440', 7, 50, 0.5);
    }
    // What the shot does to a BODY, said once for all three kinds: the damage
    // type, the fire it lights and the shove it lands are the bit's, and
    // hurtUnit (js/actions.js) hands them to a slot, a deer or a worker bot
    // alike. Only the hit test below differs per kind - a raised shield, a
    // chassis, a small animal high on its own altitude.
    // `base` is the px/s shove this KIND of body takes from a shot; the bit's
    // own KNOCKBACK (a.kb) scales it - and scales a slot's HIT_KB too, which
    // is the whole reason it travels as a multiplier (js/tools.js).
    const blow = (t, base) => {
      hurtUnit(t, a.dmg, nx, ny, players[a.owner], {
        type: a.type, burn: a.burn, burnDps: a.burnDps, ambush: a.ambush,
        kb: base, kbMul: a.kb,
      });
      if (a.ambush) ambushFx(a.x, a.y);
      a.struck = true;
    };
    if (!dead) {
      // players first: the same shot that drops a deer drops a rival. A bit
      // with friendly fire on skips the team check - but never the shooter,
      // who is not a target of their own tool at any weight. A PIERCING shot
      // (`a.pierce`, js/abilities.js) takes the body and keeps flying -
      // a.pierceHit is everyone it has already cut, so a slow overlap never
      // pays twice - and only a raised shield or the world itself stops it.
      for (const t of players) {
        if ((a.team === t.team && !a.ff) || t.id === a.owner ||
            !t.active || t.dead || inAir(t) || t.invuln > 0) continue;
        if (a.pierce && a.pierceHit.includes(t)) continue;
        if (Math.hypot(t.x - a.x, t.y - 6 - a.y) < ARROW_HIT_R + (a.reach || 0)) {
          // a raised tower shield eats any shot flying into its front arc -
          // bolts included - before the body behind it is ever asked
          if (abShieldBlocks(t, nx, ny)) {
            burst(a.x, a.y, '#c8d2e4', 6, 45, 0.35, true);
            burst(a.x, a.y, '#f4f7ff', 3, 30, 0.3, true);
            if (nearPlayer(a.x, a.y)) SFX.hit();
            dead = true; a.struck = true;
            break;
          }
          blow(t);
          burst(a.x, a.y, '#e04a54', 6, 45, 0.4);
          if (a.pierce) { a.pierceHit.push(t); continue; }
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      // worker bots take the same shot: they are units in the open, on a
      // team, and the only thing that ever stood outside the arrow pipeline
      for (const b of robots) {
        if ((a.team === b.team && !a.ff) || !unitAlive(b)) continue;
        if (a.pierce && a.pierceHit.includes(b)) continue;
        if (robotHit(b, a.x, a.y, a.reach)) {
          blow(b, ROBOT_KB);
          if (a.pierce) { a.pierceHit.push(b); continue; }
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      for (const an of animals) {
        if (an.dead) continue;
        if (a.pierce && a.pierceHit.includes(an)) continue;
        if (animalHit(an, a.x, a.y, a.reach)) {
          blow(an, 25 + 45 * a.pow);
          if (a.pierce) { a.pierceHit.push(an); continue; }
          dead = true;
          break;
        }
      }
    }
    if (dead) {
      // CINDER BURST: the shot ends and its embers go everywhere. Everything
      // alive in the ring catches - the ring is the bit, so it does not care
      // what kind of body is standing in it (unitsNear, js/actions.js).
      if (a.cinder > 0) {
        const src = players[a.owner];
        for (const t of unitsNear(sideOf(a), a.x, a.y, a.cinder)) igniteUnit(t, a.burn, a.burnDps, src);
        burst(a.x, a.y, '#ff9440', 14, 90, 0.5);
        burst(a.x, a.y, '#ffd95c', 10, 70, 0.45);
        if (nearPlayer(a.x, a.y)) SFX.break_();
      } else if (a.burn > 0) {
        burst(a.x, a.y, '#ff9440', 8, 55, 0.55);
      }
      // ...and what the BIT does where it ends, but only if it ended ON
      // something rather than simply running out over open snow: that
      // distinction is the teleport request's whole rule (js/tools.js).
      if (a.impact && a.struck) bitImpact(a);
      // a practice shot that ends any way but in a target face breaks the
      // range's consecutive-hit run (agStreak, js/world.js) - minigame or not
      if (PRACTICE && !a.ptHit) agStreak = 0;
      // A shot that ends - a miss, a wall, a body, or the end of its life -
      // just vanishes: nothing is ever lying in the snow to walk back over.
      arrows.splice(i, 1);
    }
  }

  // wildlife
  for (const a of animals) updateAnimal(a, dt);
  for (let i = animals.length - 1; i >= 0; i--) if (animals[i].dead) animals.splice(i, 1);
  updateFish(dt);
  updateLandmarks(dt); // named sites restock their inhabitants
  if (!PRACTICE) updatePreyStock(dt); // and the meadow keeps its rabbits and deer
  if (PRACTICE) updatePractice(dt); // the dummy mends itself between combos

  // the named place the local player is standing in drives the arrival toast
  if (player.dead || inAir(player)) state.loc = null;
  else {
    const here = landmarkAt(player.x, player.y);
    if (!here) state.loc = null;
    else if (!state.loc || state.loc.L !== here) state.loc = { L: here, t: 0 };
    else state.loc.t += dt;
  }

  // stump-built structures + their robots
  updateStructures(dt);
  updateRespawns(dt);
  for (const b of robots) updateRobot(b, dt);
  for (let i = robots.length - 1; i >= 0; i--) if (robots[i].dead) robots.splice(i, 1);

  // everyone has stepped: push overlapping units apart (players, animals, robots)
  separateUnits();

  // drops
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.t += dt;
    d.vz -= 220 * dt;
    d.z += d.vz * dt;
    if (d.z < 0) { d.z = 0; d.vz = -d.vz * 0.4; if (Math.abs(d.vz) < 15) d.vz = 0; }
    d.x += d.vx * dt; d.y += d.vy * dt;
    d.vx *= Math.pow(0.05, dt); d.vy *= Math.pow(0.05, dt);
    // drops are neutral: they drift toward whoever is closest, and everyone
    // standing on one claims it - the contest decides who actually gets it.
    // A player with no room for it is neither magnetised nor a claimant, so a
    // full bag hands the pickup to whoever else is standing there instead of
    // sitting on it. (Gold never lies here - awardGold pays it on the spot.)
    const roomFor = (p) => bagRoom(p, d.type) > 0;
    let near = null, pd = 1e9;
    for (const p of players) {
      if (!p.active || p.dead || inAir(p) || !roomFor(p)) continue;
      const dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd < pd) { pd = dd; near = p; }
    }
    if (near && d.t > 0.35 && pd < 28) {
      d.x += (near.x - d.x) * dt * 10;
      d.y += (near.y - d.y) * dt * 10;
    }
    if (d.t > 0.35) for (const p of players) {
      if (!p.active || p.dead || inAir(p) || Math.hypot(d.x - p.x, d.y - p.y) >= 7) continue;
      // standing on a pickup you cannot carry says so on the HUD and leaves
      // it lying there - the drop is not consumed and not destroyed
      if (!roomFor(p)) { if (p === player) bagDenied(); continue; }
      contest('drop:' + i, p, () => {
        const j = drops.indexOf(d);
        if (j < 0) return;
        // a pickup takes only what fits, and what was taken comes OFF the
        // drop, so a stack that only partly fits leaves its remainder lying
        // there instead of being picked up forever. An instanced drop (a
        // loaded tool) goes in whole or not at all - it cannot be split.
        const got = d.it ? (bagPut(p, d.it) ? 1 : 0) : bagAdd(p, d.type, d.n);
        if (got > 0) {
          d.n -= got;
          addFloater(p.x, p.y - 14, '+' + got, RES_COLORS[d.type]);
          noteSeen(p, d.type); // the local player has now held one: mark the tech node
          if (p === player) SFX.stash();
        }
        if (d.n <= 0) drops.splice(j, 1); else d.t = 0;
      });
    }
  }

  // object timers
  for (const o of objects) {
    if (!o) continue;
    if (o.flash > 0) o.flash -= dt;
    if (o.shake > 0) o.shake -= dt;
    if (o.type === 'bush' && o.berries === 0) {
      o.regrow -= dt;
      if (o.regrow <= 0) o.berries = 2;
    }
  }

  resolveContests(); // the drop pickups queued above
}

// One player's step - movement, tools, timers. A human, an AI fill and (later)
// a network peer all run exactly this; only who wrote p.input differs.
function updatePlayer(p, dt) {
  const inp = p.input;

  if (p.dead) { // out of the match: nothing it wants gets through
    inp.dodge = inp.eatBerry = inp.eatFish = false;
    inp.ability = -1;
    inp.cmd = null;
    return;
  }

  // stunned: rolled through, or the wrong end of a tackle. Every intent is
  // dropped where it arrives rather than blocked at each action, so a human
  // and an AI fill are pinned by the identical window through the one input
  // struct they share. Velocity is left alone - whatever hit you still slides
  // you, and the surface spends it like any other momentum.
  if (p.stunT > 0) {
    p.stunT = Math.max(0, p.stunT - dt);
    inp.dodge = inp.eatBerry = inp.eatFish = false;
    inp.work = inp.fire = inp.slide = false;
    inp.ability = -1;
    inp.cmd = null;
    inp.mx = inp.my = 0;
  }

  // the fish hoist (startCatch, js/tools.js) holds the body still for its
  // first CATCH_WALK second - WASD is dropped here, the way a stun drops it -
  // and a step ends it after that; any other intent (a fresh press, a roll, a
  // cast, a swing, a meal) ends it at once. It never holds up the intent that
  // ends it.
  if (p.catchT > 0) {
    p.catchT = Math.max(0, p.catchT - dt);
    if (inp.dodge || inp.ability >= 0 || inp.work || inp.slide ||
        inp.eatBerry || inp.eatFish || inp.cmd || (inp.fire && !p.firePrev)) cancelCatch(p);
    else if (inp.mx || inp.my) {
      if (CATCH_T - p.catchT >= CATCH_WALK) cancelCatch(p);
      else inp.mx = inp.my = 0;
    }
  }

  // edge-triggered intents, consumed here so a controller only has to set them
  // (the burrow lost its own key: SNOW COVER, hunter key 4, is the door in now)
  if (inp.dodge) { inp.dodge = false; tryDodge(p); }
  if (inp.eatBerry) { inp.eatBerry = false; eatBerry(p); }
  if (inp.eatFish) { inp.eatFish = false; eatFish(p); }
  if (inp.ability >= 0) { const i = inp.ability; inp.ability = -1; tryAbility(p, i); }
  if (inp.cmd) { const c = inp.cmd; inp.cmd = null; runCmd(p, c); }

  // the class abilities' own clock: cooldowns, the cast landing, and every
  // timed state one leaves on this body (js/abilities.js)
  updateAbilities(p, dt);
  if (p.dead) return; // a burn can finish the slot in there; a body takes no more steps
  // ...and the meal's clock beside it: the channel landing its heal, and the
  // one cooldown a berry and a fish share (js/core.js)
  updateEat(p, dt);

  // input
  let mx = inp.mx, my = inp.my;
  const len = Math.hypot(mx, my);
  p.moving = len > 0;
  if (len > 0) {
    mx /= len; my /= len;
    if (p.swingT <= 0) {
      if (Math.abs(mx) > Math.abs(my)) p.dir = mx > 0 ? 'right' : 'left';
      else p.dir = my > 0 ? 'down' : 'up';
    }
  }

  p.kbx = (p.kbx || 0) * Math.pow(0.01, dt);
  p.kby = (p.kby || 0) * Math.pow(0.01, dt);

  // ---- unified momentum: input accelerates vx/vy, the surface sets friction/caps
  const ftx = Math.floor(p.x / TILE), fty = Math.floor((p.y + 4) / TILE);
  const onIce = inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1;
  let sp = Math.hypot(p.vx, p.vy);

  // shift-slide: only engages above walking speed; keeps momentum, drops the tools
  const wantSlide = inp.slide && p.dodgeT <= 0 && !p.prone; // nothing glides on its belly
  const kit = kitOf(p);
  if (!p.sliding && wantSlide && sp > kit.slideMin) {
    p.sliding = true;
  }
  if (p.sliding && (!wantSlide || sp < SLIDE_EXIT)) p.sliding = false;
  // slide fatigue: builds on snow so long slides run out of glide, recovers on
  // ice so a snow->ice->snow chain starts the snow leg fresh-ish
  if (p.sliding) {
    p.slideT = onIce ? Math.max(0, p.slideT - dt * 1.5) : p.slideT + dt * kit.fatigue;
  } else {
    p.slideT = 0;
  }

  if (p.fallT > 0) {
    // floundering in an ice hole: no control until the climb-out
    p.fallT -= dt;
    p.vx = p.vy = 0;
    p.sliding = false;
    p.fallRipT -= dt;
    if (p.fallRipT <= 0) {
      p.fallRipT = 0.16;
      burst(p.x + rand(-3, 3), p.y + 4, '#9fc4dd', 2, 16, 0.3, true);
    }
    if (p.fallT <= 0) {
      // scramble out onto the nearest walkable tile
      const out = nearestDryTile(p.x, p.y, p);
      p.x = (out.tx + 0.5) * TILE;
      p.y = (out.ty + 0.5) * TILE;
      p.invuln = Math.max(p.invuln, 0.8);
      burst(p.x, p.y + 4, '#cfe4f2', 8, 40, 0.45, true);
      if (nearPlayer(p.x, p.y)) SFX.dodge();
    }
  } else if (p.dodgeT > 0) {
    // rolling: the dash owns the velocity; friction waits until the roll ends,
    // so whatever speed the dash reached is carried out for the surface to spend
    p.dodgeT -= dt;
    const vx0 = p.vx, vy0 = p.vy;
    const mv = moveEntity(p, p.vx * dt, p.vy * dt, PLAYER_R);
    if (mv.blockedX) p.vx = 0; // a wall still kills that axis - see below for when it costs more
    if (mv.blockedY) p.vy = 0;
    // A wall taken head-on is a tackle, not a graze: only the speed actually
    // driven into the blocked axis counts, so brushing past a tree at a run
    // is free while dashing straight into one is not.
    const into = Math.max(mv.blockedX ? Math.abs(vx0) : 0, mv.blockedY ? Math.abs(vy0) : 0);
    if (into > TACKLE_MIN) {
      const d = Math.hypot(vx0, vy0) || 1, tnx = vx0 / d, tny = vy0 / d;
      tackleObject(tackleObjAhead(p, tnx, tny), rollDmg(p, d), p);
      rollTackle(p, d, tnx, tny);
    } else {
      rollSweep(p); // everything small in the way takes a swipe and is rolled through
    }
    p.dodgeDustT -= dt;
    if (p.dodgeDustT <= 0) {
      p.dodgeDustT = 0.05;
      burst(p.x, p.y + 5, '#dfe8f4', 2, 22, 0.3, true);
    }
    if (p.dodgeT <= 0) { p.rollHit.length = 0; burst(p.x, p.y + 4, '#cfd8e8', 4, 30, 0.3, true); }
  } else if (p.rushT > 0) {
    // BULL RUSH: the charge owns the velocity the way a roll does - straight
    // down its line, walls and the first body met resolved by rushStep
    p.rushT -= dt;
    p.vx = p.rushNX * RUSH_SPD;
    p.vy = p.rushNY * RUSH_SPD;
    const mv = moveEntity(p, p.vx * dt, p.vy * dt, PLAYER_R);
    rushStep(p, mv, dt);
  } else if (p.grapT > 0) {
    // GRAPPLE: the rope owns the velocity while the key is held - hauled
    // straight at the anchor at GRAP_REEL. Letting go of the key, arriving,
    // a wall, or the safety timer all end in grapEnd (js/abilities.js), which
    // KEEPS the velocity - so the reel's speed rides out into the surface
    // model, and shift turns it into a slide.
    p.grapT -= dt;
    const gdx = p.grapX - p.x, gdy = p.grapY - p.y;
    const gd = Math.hypot(gdx, gdy) || 1;
    p.vx = gdx / gd * GRAP_REEL;
    p.vy = gdy / gd * GRAP_REEL;
    const mv = moveEntity(p, p.vx * dt, p.vy * dt, PLAYER_R);
    p.grapDustT = (p.grapDustT || 0) - dt;
    if (p.grapDustT <= 0) {
      p.grapDustT = 0.06;
      burst(p.x, p.y + 5, '#dfe8f4', 1, 20, 0.3, true);
    }
    if (!inp.grapple || gd <= GRAP_ARRIVE || mv.blockedX || mv.blockedY || p.grapT <= 0) grapEnd(p);
  } else {
    const chargeMul = p.charging ? kit.chargeMul : 1; // drawn bow slows you
    // every cap an ability may drag on (root, net, crater, cast, shield) or
    // ramp up (juggernaut), folded once - js/abilities.js - with the meal's
    // own drag beside them (js/core.js): a body chewing walks, exactly the way
    // a body mid-cast does
    const abMul = abilityMoveMul(p) * (p.eatT > 0 ? FOOD_SLOW : 1);
    // a belly crawl is a flat crawl on any surface - no ice cap, no draw
    // penalty, nothing to stack. Getting back up costs a moment of it too.
    const walkMax = (p.prone ? PRONE_SPEED
      : p.riseT > 0 ? PLAYER_SPEED * kit.walkMul * 0.45
        : PLAYER_SPEED * kit.walkMul * chargeMul) * abMul; // STRIDER lengthens the stride

    if (p.prone || p.rootT > 0 || (!onIce && !p.sliding && sp <= walkMax + 6)) {
      // plain snow walking: near-instant vector approach, tuned so it feels
      // exactly like the old fixed-speed movement (settles in ~3 frames)
      const f = 1 - Math.exp(-25 * dt);
      p.vx += (mx * walkMax - p.vx) * f;
      p.vy += (my * walkMax - p.vy) * f;
    } else {
      // carrying momentum (ice, slide, or overspeed on snow):
      // steer the heading toward the input, ease the speed toward the target
      let dirx = mx, diry = my;
      if (sp > 1) { dirx = p.vx / sp; diry = p.vy / sp; }
      let steer, decay, target;
      if (p.sliding) {
        // snow friction ramps with slide fatigue: early glide is cheap, the
        // tail drops off hard so slides end decisively
        steer = 1.7; target = 0;
        decay = onIce ? 0.15 : Math.min(2.6, 0.35 + 0.45 * p.slideT);
      } else if (onIce) {
        const cap = ICE_MAX * kit.iceMax * chargeMul * abMul;
        if (len > 0) { steer = kit.iceSteer; target = cap; decay = sp < cap ? 1.1 : 0.35; }
        else { steer = 0; target = 0; decay = 0.18; } // idle glide
      } else {
        steer = 4.5; target = len > 0 ? walkMax : 0; decay = 3.5; // snow kills overspeed fast unless you slide
      }
      if (len > 0 && steer > 0 && (dirx !== 0 || diry !== 0)) {
        // carve: rotate the travel direction toward the input, never snap it
        const cur = Math.atan2(diry, dirx), want = Math.atan2(my, mx);
        let da = want - cur;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        const na = cur + Math.max(-steer * dt, Math.min(steer * dt, da));
        dirx = Math.cos(na); diry = Math.sin(na);
      }
      sp = target + (sp - target) * Math.exp(-decay * dt);
      p.vx = dirx * sp;
      p.vy = diry * sp;
    }

    const mv = moveEntity(p,
      (p.vx + p.kbx) * dt,
      (p.vy + p.kby) * dt, PLAYER_R);
    if (mv.blockedX) p.vx = 0; // a wall kills that axis instead of grinding
    if (mv.blockedY) p.vy = 0;
  }

  p.x = Math.max(8, Math.min(WORLD * TILE - 8, p.x));
  p.y = Math.max(8, Math.min(WORLD * TILE - 8, p.y));

  // carved ice holes: standing over open water plunges you in (an active
  // dodge roll carries across the gap)
  if (p.fallT <= 0 && p.dodgeT <= 0) {
    const htx = Math.floor(p.x / TILE), hty = Math.floor((p.y + 4) / TILE);
    // a net is planked over its hole: you stand on it, and that is how the
    // catch comes out of it (see updateStructures' net branch)
    if (inWorld(htx, hty) && ground[idx(htx, hty)] === 2 && !netAt(htx, hty)) {
      p.fallT = HOLE_FALL_T;
      p.fallRipT = 0;
      p.vx = p.vy = 0;
      p.sliding = false;
      p.slideT = 0;
      if (p.rushT > 0) { p.rushT = 0; p.rushVictim = null; } // the charge ends in the water
      if (p.grapT > 0) grapEnd(p);                          // the rope goes slack with you
      p.castT = 0; p.castAb = -1; p.shieldT = 0;           // and so does whatever was being cast
      breakEat(p);                                         // the meal goes in the water with you
      p.prone = false; p.hide = 0; p.riseT = 0; // crawled off the edge: no cover in the water
      if (p.charging) { p.charging = false; p.chargeT = 0; }
      p.fireArmed = false;
      if (nearPlayer(p.x, p.y)) SFX.splash();
      burst(p.x, p.y + 4, '#3a6080', 10, 55, 0.5, true);
      burst(p.x, p.y + 2, '#ddf1f8', 8, 60, 0.5, true);
      damagePlayer(p, HOLE_FALL_DMG, 0, 0, null, 'ice');
    }
  }

  // ---- the cover -------------------------------------------------------
  // `hide` is the whole stealth state. Lying still on snow pulls it over you
  // over PRONE_BURY; crawling holds what you already have (concealOf discounts
  // a moving mound rather than unpacking it); bare ice hides nothing at all,
  // so the river strips a crawler without forcing them upright; and anything
  // that puts you back on your feet sheds it over the rise window.
  if (p.prone) {
    const snow = inWorld(ftx, fty) && ground[idx(ftx, fty)] === 0;
    if (!snow) p.hide = Math.max(0, p.hide - dt * 2.2);
    else if (!p.moving && p.hide < 1) {
      p.hide = Math.min(1, p.hide + dt / kit.bury);
      if (p.hide >= 1) { p.hideFlash = 0.4; if (p === player) SFX.hidden(); }
    }
    p.crawlT = p.moving ? p.crawlT + dt * 3.6 : 0;
    // One timer, two jobs, and which one it is doing says what state the body
    // is in. While the cover is still building it throws up the snow being
    // pulled over; once it is finished it becomes breath in cold air - the
    // fair tell that makes "almost invisible" true rather than a promise, and
    // the one thing a mound holding perfectly still still does.
    p.puffT -= dt;
    if (p.puffT <= 0) {
      if (p.hide < 1) {
        p.puffT = rand(0.14, 0.26);
        if (!p.moving) burst(p.x + rand(-6, 6), p.y + rand(0, 5), '#eef4fb', 1, 15, 0.34, true);
      } else {
        p.puffT = rand(1.8, 3.2);
        const bx2 = p.dir === 'left' ? -5 : p.dir === 'right' ? 5 : 0;
        const by2 = p.dir === 'up' ? -3 : 2;
        for (let i = 0; i < 3; i++) {
          particles.push({
            x: p.x + bx2 + rand(-1, 1), y: p.y + by2, vx: rand(-4, 4), vy: rand(-12, -6),
            life: rand(0.5, 0.9), maxLife: 0.7, color: '#dbe8f6', size: 1, grav: -8, alpha: 0.5,
          });
        }
      }
    }
  } else if (p.hide > 0) {
    p.hide = 0; // nothing but tryProne can put cover back on; never let it stick
  }
  if (p.riseT > 0) p.riseT = Math.max(0, p.riseT - dt);
  p.hideFlash = Math.max(0, p.hideFlash - dt);

  // dodge charges refill one at a time
  if (p.dodgeCharges < DODGE_CHARGES) {
    p.dodgeRegenT -= dt;
    if (p.dodgeRegenT <= 0) {
      p.dodgeCharges++;
      p.dodgeRegenT = p.dodgeCharges < DODGE_CHARGES ? kit.dodgeCd : 0;
    }
  }
  // spent-stamina ghost: hold briefly, then drain toward the live fill
  {
    const regenP = p.dodgeCharges < DODGE_CHARGES ? 1 - p.dodgeRegenT / kit.dodgeCd : 0;
    const frac = (p.dodgeCharges + regenP) / DODGE_CHARGES;
    if (p.stamGhostT > 0) p.stamGhostT -= dt;
    else p.stamGhost -= dt * 1.6;
    if (p.stamGhost < frac) p.stamGhost = frac;
  }

  const spNow = Math.hypot(p.vx, p.vy);
  // the crawl leaves a drag furrow instead of footprints: a broad flattened
  // trough with an elbow dimple alternating either side of it. It is a real
  // tell - a line like that leads anyone who reads it straight to the mound at
  // the end - and that is the point. The cover is beatable by someone looking.
  if (p.prone && spNow > 2) {
    p.trailD -= spNow * dt;
    const bx = p.vx / spNow, by = p.vy / spNow;
    let emit = 0;
    while (p.trailD <= 0 && emit++ < 4) {
      const back = -p.trailD;
      p.footSide = 1 - p.footSide;
      footprints.push({
        x: p.x - bx * back, y: p.y + 5 - by * back,
        nx: -by, ny: bx, t: 0, k: 3,
        // an elbow scuff off to one side of the trough on every other mark,
        // swapping sides every few of them, the way a crawl actually alternates
        s: p.footSide ? (Math.floor(p.crawlT) % 2 ? 1 : -1) : 0,
      });
      p.trailD += 2; // marks are two deep, so at this spacing they tile into one trough
    }
    while (footprints.length > 800) footprints.shift();
  }
  if (spNow > 8 && p.dodgeT <= 0 && !p.sliding && !p.prone) {
    p.animT += dt * 9;
    p.footT -= dt;
    if (p.footT <= 0) {
      p.footT = 0.16;
      p.footSide = 1 - p.footSide;
      const side = p.footSide ? 2 : -2;
      const px = p.dir === 'left' || p.dir === 'right' ? p.x : p.x + side;
      const py = p.dir === 'left' || p.dir === 'right' ? p.y + 6 + (p.footSide ? 1 : -1) : p.y + 6;
      footprints.push({ x: px, y: py, t: 0 });
      if (p === player) SFX.step();
      if (footprints.length > 400) footprints.shift();
    }
  } else {
    p.animT = 0; // sliding/gliding uses the standing pose
  }

  // fast slide: carve a double trail (footprint decals, spaced ~2.5px so the
  // marks overlap into continuous lines) and kick up snow spray. Snow gets
  // two-tone carved grooves (k:1, lip offset toward the outer side); ice gets
  // thin frosted skate scratches (k:2).
  if (p.sliding && spNow > TRAIL_MIN) {
    p.trailD -= spNow * dt;
    const nx = -p.vy / spNow, ny = p.vx / spNow;
    const k = onIce ? 2 : 1;
    let emit = 0;
    while (p.trailD <= 0 && emit++ < 6) {
      // interpolate the mark back along the path so the spacing stays even
      // no matter how far a single frame travelled
      const back = -p.trailD;
      const bx = p.x - ny * back, by = p.y + 6 + nx * back;
      footprints.push({ x: bx + nx * 2, y: by + ny * 2, t: 0, k });
      footprints.push({ x: bx - nx * 2, y: by - ny * 2, t: 0, k });
      p.trailD += 2.5;
    }
    while (footprints.length > 800) footprints.shift();
    p.slideDustT -= dt;
    if (p.slideDustT <= 0) {
      p.slideDustT = 0.1;
      burst(p.x, p.y + 5, '#eef4fb', 1, 18, 0.3, true);
    }
  }

  // swing
  p.swingCd = Math.max(0, p.swingCd - dt);
  if (p.swingT > 0) {
    p.swingT -= dt;
    if (!p.swingHitDone && p.swingT < 0.12) {
      p.swingHitDone = true;
      swingHit(p);
    }
  }
  // the work tool goes away with the swing cooldown; held E brings it right back
  if (p.swingT <= 0 && p.swingCd <= 0) p.swing = SWING_BOW;
  if (inp.work) tryWork(p);

  // the cycle: the cooldown a shot starts (toolCycle, js/tools.js) counts
  // down, and its end is the ONE gate between presses. It runs for every
  // slot - dead or alive is already filtered above - so a bot recovers on
  // exactly the human's clock.
  if (p.nockT > 0) {
    p.nockT = Math.max(0, p.nockT - dt);
    if (p.nockT === 0) { p.readyFlash = 0.16; if (p === player) SFX.nock(); }
  }
  p.readyFlash = Math.max(0, p.readyFlash - dt);
  p.dryT = Math.max(0, p.dryT - dt);

  // The tool: pressing arms the shot, releasing fires it. The press does not
  // have to land on a ready tool - it stays armed, so holding through the
  // cycle draws the moment the wipe clears. Without that, a controller that
  // holds fire down - every AI slot does - would fire once and then wait
  // forever for an edge it already spent. `toolReady` is the only other
  // refusal: a slot with no tool in it, or a tool with no bit light enough to
  // throw, is dry.
  const armed = toolReady(p);
  if (inp.fire && !p.firePrev) {
    // THE BUTTON IS THE CANCEL. A meal must never trap the hands: deciding
    // mid-chew that the fight matters more drops it on the spot and the draw
    // below arms in the same frame. It costs the 1.5 s and nothing else - the
    // food is only spent when the channel lands (js/core.js) - so a cancelled
    // meal can be started again the moment the shot is away. The roll is the
    // other escape; E and the ability keys stay refused instead, because those
    // spend a cooldown a stray press should not.
    breakEat(p);
    p.fireArmed = true;
    if (!armed && p.dryT <= 0) dryFire(p);
  }
  if (!inp.fire) p.fireArmed = false;
  if (p.fireArmed && !p.charging && p.nockT <= 0 && armed && p.fallT <= 0 && p.swingT <= 0 &&
    p.castT <= 0 && p.shieldT <= 0 && p.rushT <= 0 && p.eatT <= 0) { // a body mid-ability has no hand free for the draw (a meal is already cancelled by the press above)
    p.charging = true;
    p.chargeT = 0;
    if (nearPlayer(p.x, p.y)) SFX.bowDraw();
  }
  if (!inp.fire && p.charging) {
    p.charging = false;
    fireTool(p);
    p.chargeT = 0;
  }
  p.firePrev = inp.fire;

  // bow draw: charge up and keep facing the aim point. chargeT is the raw
  // seconds held, never clamped - every reader takes drawPow() (0..1) off it,
  // and the meter's white blink at the peak (DRAW_FULL_FLASH) needs to see
  // the hold run PAST the full draw
  if (p.charging) {
    p.chargeT += dt;
    const adx = inp.aimX - p.x, ady = inp.aimY - p.y;
    if (Math.abs(adx) > Math.abs(ady)) p.dir = adx > 0 ? 'right' : 'left';
    else p.dir = ady > 0 ? 'down' : 'up';
  }

  p.hurtT = Math.max(0, p.hurtT - dt);
  p.invuln = Math.max(0, p.invuln - dt);

  // gentle regen in daylight (HEARTHWEAVE keeps the hearth lit after dark)
  if (p.hp < p.maxHp && (state.darkness < 0.3 || kit.nightHeal)) {
    p.hp = Math.min(p.maxHp, p.hp + dt * 0.6);
  }
}

// ------------------------------------------------------------ wind
// One wind field, and everything the weather moves reads it: the snow's
// drift, and which of its 16 sway frames every pine on the field is wearing
// (treeFrame, js/draw-world.js). It is not one number, and it is not one wave
// either: a single travelling sine over the tile grid is a marching stripe,
// and a forest does not do that. What crosses the field is a SUM OF WAVES on
// different bearings, the way an ocean surface is - three fast ripples
// carrying the rustle, under a long two-wave gust envelope deciding where the
// air is actually moving at all. No period here is a multiple of another, so
// no two crests ever meet twice in the same place and the pattern over the
// treeline never repeats. It dies with the light: windAmp() squares the
// daylight, so the air goes still over dusk and by full dark every tree is
// holding its own rest frame.
//
// A wave is (kx, ky) rad per TILE - the bearing is the vector and its length
// is the wavelength - plus rad/s of travel and a share of the amplitude. The
// three ripple bearings are deliberately spread: two run with the prevailing
// down-right air, the third cuts across it, and that crossing is what breaks a
// front into patches instead of bands.
// The amplitudes deliberately sum past 1: three waves at random phase mostly
// cancel, so a set that summed to exactly 1 would leave the forest permanently
// half-hearted. At 1.44 the ordinary rustle matches the old single wave's and
// a gust that lands all three crests together maxes the sway out.
const WIND_R1X = 0.29, WIND_R1Y = 0.19, WIND_R1S = 2.40, WIND_R1A = 0.72;
const WIND_R2X = 0.16, WIND_R2Y = -0.33, WIND_R2S = 1.61, WIND_R2A = 0.42;
const WIND_R3X = 0.47, WIND_R3Y = 0.41, WIND_R3S = 3.07, WIND_R3A = 0.30;
// The crests are BENT before they travel. Plain sines added together give
// straight parallel fronts crossing each other - a plaid, which is exactly
// what air does not look like - so one long slow wave is folded into the
// spatial phase of all three ripples at once (phase modulation, the same
// trick FM synthesis is). It meanders the whole rustle together, so the
// fronts wander over the field instead of ruling lines across it.
const WIND_WX = 0.021, WIND_WY = 0.034, WIND_WS = 0.27, WIND_WARP = 2.6;
// The gust envelope: two waves an order of magnitude longer than the ripples
// (~85 and ~100 tiles against ~18), one running with the air and one across
// it. Summing them is what makes a gust a PATCH of field rather than a stripe
// of it, and the smoothstep on the sum is what makes it arrive - it widens the
// calm between gusts and squares up their shoulders, so the eye reads a front
// crossing the treeline rather than the whole forest breathing in and out.
// Their wavelength is set against the VIEW, not the world: much longer and a
// gust stops being something you watch arrive and becomes the weather.
const WIND_G1X = 0.062, WIND_G1Y = 0.041, WIND_G1S = 0.62, WIND_G1A = 0.60;
const WIND_G2X = -0.034, WIND_G2Y = 0.053, WIND_G2S = 0.37, WIND_G2A = 0.40;
// The envelope's floor and its peak. The floor is set against the VIEW: a
// screen is barely wider than one gust, so a floor near zero would leave a
// player parked in a lull staring at a dead forest for seconds at a time. The
// peak deliberately overshoots 1, so the heart of a gust runs into the clamp
// and throws those trees fully over - a gust that only ever reached the same
// lean as ordinary air would not read as a gust at all.
const WIND_LULL = 0.26, WIND_GUST_PEAK = 1.30;
const WIND_SWELL = 31, WIND_SWELL2 = 19; // s: the field's two breathing periods, coprime
const WIND_STILL = 0.02;              // under this the trees simply hold their rest frame

// A 256-entry sine table, and it is what lets the field afford to be six
// waves: windSway() is read once per visible pine per frame and does six
// lookups rather than six Math.sin calls. Its answer is quantised to one of
// sixteen frames, so a table is exact enough, and the cost stays flat when a
// zoomed-out view is holding a thousand trees. Negative phases are fine - the
// `| 0` then `& 255` wraps them, at the price of a truncation a 256th of a
// cycle wide, which no tree can show.
const WSIN = new Float32Array(256);
for (let i = 0; i < 256; i++) WSIN[i] = Math.sin(i / 256 * Math.PI * 2);
function wsin(a) { return WSIN[((a * (256 / (Math.PI * 2))) | 0) & 255]; }

// The field's strength right now, 0..1; updateFx parks it in state.wind. Two
// swells on coprime periods rather than one, so the day's weather rises and
// falls without ever settling into a rhythm you could count.
function windAmp() {
  const day = 1 - state.darkness, t = state.windT;
  return day * day * (0.52 + 0.30 * wsin(t * (Math.PI * 2 / WIND_SWELL))
    + 0.18 * wsin(t * (Math.PI * 2 / WIND_SWELL2) + 1.7));
}

// The signed sway at a tile, -1..1: the three ripples summed, times the gust
// envelope, times the field's strength. The ripples carry the rustle and the
// envelope says how much of it this corner of the field is getting, so a gust
// reads as a body of moving air crossing the treeline - trees ahead of it
// still, trees inside it working, trees behind it settling - instead of the
// whole forest rustling on one clock. The sum can reach 1.44 where all three
// crests land together, so it is clamped: at sixteen quantised frames a flat
// top is invisible, and a wrap past +1 would jerk a tree the wrong way.
function windSway(tx, ty) {
  const w = state.wind;
  if (w <= WIND_STILL) return 0;
  const t = state.windT;
  const bend = WIND_WARP * wsin(tx * WIND_WX + ty * WIND_WY + t * WIND_WS);
  const r = WIND_R1A * wsin(tx * WIND_R1X + ty * WIND_R1Y + t * WIND_R1S + bend)
    + WIND_R2A * wsin(tx * WIND_R2X + ty * WIND_R2Y + t * WIND_R2S + bend)
    + WIND_R3A * wsin(tx * WIND_R3X + ty * WIND_R3Y + t * WIND_R3S + bend);
  const e = 0.5 + 0.5 * (WIND_G1A * wsin(tx * WIND_G1X + ty * WIND_G1Y + t * WIND_G1S)
    + WIND_G2A * wsin(tx * WIND_G2X + ty * WIND_G2Y + t * WIND_G2S));
  const gust = WIND_LULL + (WIND_GUST_PEAK - WIND_LULL) * (e * e * (3 - 2 * e));
  const s = r * gust * w;
  return s < -1 ? -1 : s > 1 ? 1 : s;
}

// ------------------------------------------------------------ fx updates
// Snow lives in the world, not on the glass: a flake has a world position,
// drifts in world px, and scrolls with the camera like everything else. The
// field is kept exactly one view in size and drawn wrapped modulo VIEW_W/H
// around the camera, so the screen is always covered at constant density
// whatever the zoom or view size (fitFlakes sizes the array) while a pan
// still slides every flake the right way. A flake falls for h world px,
// lands (rests on the ground fading out for FLAKE_REST s) and is reborn
// somewhere in the field - the fall is not screen-top to screen-bottom.
const FLAKE_REST = 0.7;
// The field is ONE WORLD VIEW in size, not one screen: a flake is a real thing
// of a real size falling through the world, so the zoom has to reach it like it
// reaches everything else. Count follows the world AREA on screen (zoom out and
// you are looking at more sky, so more snow is in it) and size follows the zoom
// (up close a flake is a fat crumb, not a pixel) - between them the amount of
// white in frame stays about constant while the grain of it changes, which is
// what "further away" looks like. Both are clamped: physics alone would leave
// six flakes on screen at the closest rung and a blizzard of specks at the
// widest, and neither reads as snow.
const FLAKE_BASE = 70;       // flakes per 480x270 world px
const FLAKE_MIN = 26, FLAKE_MAX = 240;
const flakes = [];
// a fresh flake somewhere in the field, from the given random stream
function makeFlake(r) {
  return {
    x: r() * WV_W, y: r() * WV_H,      // offset inside the field; the camera adds the rest
    h: 30 + r() * 90,                  // world px left to fall before it lands
    rest: 0,                           // >0: landed, seconds of rest left
    spd: 9 + r() * 17, sway: 0.4 + r(), ph: r() * 9,
    size: r() < 0.75 ? 1 : 2, a: 0.35 + r() * 0.45,
  };
}
// EXACTLY seventy, off the main stream, and that count is load-bearing: this
// runs before genWorld(), so adding or dropping one here shifts the rng prefix
// and every existing seed with it. fitFlakes() does all the resizing, off fxRng.
for (let i = 0; i < 70; i++) flakes.push(makeFlake(rng));

// Keep snow density constant per world area, not per screen. Top-ups draw from
// a separate seeded stream so they never perturb the main rng's worldgen prefix.
// Called every frame from updateFx as well as from relayout(), because the ZOOM
// moves the target as surely as a resize does; both loops are no-ops when the
// count already matches, which is every frame but the ones a zoom is easing
// through.
const fxRng = mulberry32((SEED ^ 0x9e3779b9) >>> 0);
function fitFlakes() {
  const target = Math.max(FLAKE_MIN, Math.min(FLAKE_MAX,
    Math.round(FLAKE_BASE * (WV_W * WV_H) / (480 * 270))));
  while (flakes.length > target) flakes.pop();
  while (flakes.length < target) flakes.push(makeFlake(fxRng));
}

function updateFx(dt) {
  const now = performance.now() / 1000;
  // the wind steps here, above everything that reads it: it is fx, so it runs
  // in every mode, and it runs on the SIM clock so DBG.step reproduces a gust
  state.windT += dt;
  state.wind = windAmp();
  // the sun's shafts are an EVENT, not a constant: this is what is left of the
  // one the eagle drop lit (rayLight, js/draw-world.js, owns the shape of it)
  if (state.rayT > 0) state.rayT = Math.max(0, state.rayT - dt);
  fitFlakes(); // the zoom moves the flake count, so this cannot wait for a resize
  for (const f of flakes) {
    if (f.rest > 0) {
      f.rest -= dt;
      if (f.rest <= 0) { // reborn: same slot, new spot in the field
        const n = makeFlake(fxRng);
        n.x += camX; n.y += camY;
        Object.assign(f, n);
      }
      continue;
    }
    const dy = f.spd * dt;
    f.y += dy; f.h -= dy;
    // the same field the pines read: the sway is the flake's own, the drift
    // is the wind's, so snow falls almost straight down once the air stills
    f.x += Math.sin(now * f.sway + f.ph) * (3 + 7 * state.wind) * dt + (1 + 13 * state.wind) * dt;
    if (f.h <= 0) f.rest = FLAKE_REST;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += (p.grav || 0) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(0.1, dt);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    if (f.t > 0.9) floaters.splice(i, 1);
  }
  updateWarps(dt); // the silhouettes a teleport request left behind (js/tools.js)
  if (bagFlash > 0) bagFlash -= dt; // the backpack's refusal red is chrome: wall time
  if (toolFlash > 0) toolFlash -= dt; // ... and the weapon well's, beside it
  if (foodFlash > 0) foodFlash -= dt; // ... and the meal button's
  for (let i = footprints.length - 1; i >= 0; i--) {
    const f = footprints[i];
    f.t += dt;
    if (f.t > (f.k === 1 ? SNOW_TRAIL_LIFE : 9)) footprints.splice(i, 1);
  }
  // the event feed ages here too: it is chrome, so it fades on wall time in
  // every mode, not only while the sim is stepping
  for (let i = events.length - 1; i >= 0; i--) {
    events[i].t += dt;
    if (events[i].t > EVENT_LIFE) events.splice(i, 1);
  }
}

