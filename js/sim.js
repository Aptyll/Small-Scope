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

  // time (the clock starts with the eagle - the match is live while you ride)
  if (state.mode === 'play' || state.mode === 'drop') {
    state.time += dt;
    state.elapsed += dt;
    if (state.time >= CYCLE) {
      state.time -= CYCLE;
      state.day++;
      // the profile's best day: recorded as each dawn is reached, not at the
      // end, so quitting to the lobby mid-match still keeps the day you made
      if (!player.eliminated) PROFILE.recordDay(state.day);
      SFX.dawnChime();
      showMsg('DAY ' + state.day, 3);
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
      if (state.intro === 0) showMsg('EARN GOLD - HOLD E AT A TREE OR ROCK', 6);
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

  updateFx(dt);
}

function updatePlay(dt) {
  state.tick++; // with SEED and the player id, this decides contested orders

  // every slot steps through the same code, each off its own input struct
  // (slots still on or under the eagle are moved by updateDrop instead)
  for (const p of players) {
    if (!p.active || inAir(p)) continue;
    if (p.control === 'ai') updateAI(p, dt);
    updatePlayer(p, dt);
  }
  resolveContests(); // this step's work swings, build orders and fish claims
  if (state.drop) updateDrop(dt);

  // arrows in flight
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    const vd = Math.hypot(a.vx, a.vy) || 1;
    const nx = a.vx / vd, ny = a.vy / vd;
    a.t += dt;
    a.x += a.vx * dt; a.y += a.vy * dt;
    // a faint mote in the shooter's colour every few px of flight: the shot
    // reads as a streak, and whose shot it is reads from across the map. The
    // step just walked is subdivided (rather than one mote per tick) so the
    // spacing survives both a slow arrow and a long frame; the motes are laid
    // behind the head at the distance they are owed and left to fade in place.
    a.trailD += vd * dt;
    while (a.trailD >= ARROW_TRAIL_STEP) {
      a.trailD -= ARROW_TRAIL_STEP;
      particles.push({
        x: a.x - nx * a.trailD, y: a.y - ny * a.trailD,
        vx: -nx * 8, vy: -ny * 8,
        life: ARROW_TRAIL_LIFE, maxLife: ARROW_TRAIL_LIFE, color: TEAMS[a.team].mark,
        size: 1, grav: 0, alpha: ARROW_TRAIL_A,
      });
    }
    let dead = a.t > a.life;
    if (!dead && isSolidTile(Math.floor(a.x / TILE), Math.floor(a.y / TILE))) {
      dead = true;
      burst(a.x, a.y, '#cfd8e8', 3, 25, 0.25, true);
    }
    if (!dead) {
      // players first: the same shot that drops a deer drops a rival
      for (const t of players) {
        if (a.team === t.team || !t.active || t.dead || inAir(t) || t.invuln > 0) continue;
        if (Math.hypot(t.x - a.x, t.y - 6 - a.y) < 7) {
          damagePlayer(t, a.dmg, nx, ny, players[a.owner], null, a.ambush);
          burst(a.x, a.y, '#e04a54', 6, 45, 0.4);
          if (a.ambush) ambushFx(a.x, a.y);
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      // worker bots take the same shot: they are units in the open, on a
      // team, and the only thing that ever stood outside the arrow pipeline
      for (const b of robots) {
        if (a.team === b.team || b.dead) continue;
        if (robotHit(b, a.x, a.y)) {
          hurtRobot(b, a.dmg, nx, ny, players[a.owner]);
          if (a.ambush) ambushFx(a.x, a.y);
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      for (const an of animals) {
        if (animalHit(an, a.x, a.y)) {
          hurtAnimal(an, a.dmg, nx, ny, 25 + 45 * a.pow, a.owner, a.ambush);
          dead = true;
          break;
        }
      }
    }
    if (dead) {
      // every bow shot that ends - a miss, a wall, a body, or the end of its
      // life - leaves the shaft where it stopped. One rule, no exceptions, so
      // "arrows come back" is learnable from the first miss. Turret bolts ride
      // this same array and are not arrows: they leave nothing.
      if (!a.kind) stickArrow(a, nx, ny);
      arrows.splice(i, 1);
    }
  }

  // wildlife
  for (const a of animals) updateAnimal(a, dt);
  for (let i = animals.length - 1; i >= 0; i--) if (animals[i].dead) animals.splice(i, 1);
  updateFish(dt);
  updateLandmarks(dt); // named sites restock their inhabitants

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

  // spent arrows in the snow. Neutral like drops - the fletching says whose
  // shot it was, but anyone short of a full quiver can pull it out, so losing
  // a firefight on someone else's ground also means shooting them their ammo.
  for (let i = shafts.length - 1; i >= 0; i--) {
    const s = shafts[i];
    s.t += dt;
    if (s.t > SHAFT_LIFE) { shafts.splice(i, 1); continue; }
    if (s.t < SHAFT_ARM) continue;
    for (const p of players) {
      if (!p.active || p.dead || inAir(p) || p.quiver >= QUIVER_MAX) continue;
      if (Math.hypot(s.x - p.x, s.y - p.y + 2) >= SHAFT_R) continue;
      contest('shaft:' + i, p, () => {
        const j = shafts.indexOf(s);
        if (j < 0 || !gainArrow(p, 1)) return; // someone else got there, or the quiver filled
        shafts.splice(j, 1);
        burst(s.x, s.y, TEAMS[s.team].mark, 4, 30, 0.3, true);
        if (p === player) SFX.shaftPull();
      });
    }
  }

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
    // sitting on it; gold is a wallet number and never runs out of room.
    const roomFor = (p) => d.type === 'gold' || bagRoom(p, d.type) > 0;
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
        // gold always takes the whole coin; a carried thing takes only what
        // fits. Either way what was taken comes OFF the drop, so a stack that
        // only partly fits leaves its remainder lying there instead of being
        // picked up forever.
        const got = d.type === 'gold' ? d.n : bagAdd(p, d.type, d.n);
        if (got > 0) {
          if (d.type === 'gold') gainGold(p, got);
          d.n -= got;
          addFloater(p.x, p.y - 14, '+' + got, RES_COLORS[d.type]);
          if (p === player) { if (d.type === 'gold') SFX.coin(); else SFX.stash(); }
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
    inp.dodge = inp.prone = inp.eatBerry = inp.eatFish = false;
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
    inp.dodge = inp.prone = inp.eatBerry = inp.eatFish = false;
    inp.work = inp.fire = inp.slide = false;
    inp.cmd = null;
    inp.mx = inp.my = 0;
  }

  // edge-triggered intents, consumed here so a controller only has to set them
  if (inp.dodge) { inp.dodge = false; tryDodge(p); }
  if (inp.prone) { inp.prone = false; tryProne(p); }
  if (inp.eatBerry) { inp.eatBerry = false; eatBerry(p); }
  if (inp.eatFish) { inp.eatFish = false; eatFish(p); }
  if (inp.cmd) { const c = inp.cmd; inp.cmd = null; runCmd(p, c); }

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
  } else {
    const chargeMul = p.charging ? kit.chargeMul : 1; // drawn bow slows you
    // a belly crawl is a flat crawl on any surface - no ice cap, no draw
    // penalty, nothing to stack. Getting back up costs a moment of it too.
    const walkMax = p.prone ? PRONE_SPEED
      : p.riseT > 0 ? PLAYER_SPEED * kit.walkMul * 0.45
        : PLAYER_SPEED * kit.walkMul * chargeMul; // STRIDER lengthens the stride

    if (p.prone || (!onIce && !p.sliding && sp <= walkMax + 6)) {
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
        const cap = ICE_MAX * kit.iceMax * chargeMul;
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
  if (p.swingT <= 0 && p.swingCd <= 0) p.tool = TOOL_BOW;
  if (inp.work) tryWork(p);

  // the quiver: the renock cooldown counts down, and a short quiver fletches
  // one arrow back at a time. Both run for every slot, dead or alive is
  // already filtered above, so a bot recovers on exactly the human's clock.
  if (p.nockT > 0) {
    p.nockT = Math.max(0, p.nockT - dt);
    if (p.nockT === 0) { p.readyFlash = 0.16; if (p === player) SFX.nock(); }
  }
  if (p.quiver < QUIVER_MAX) {
    p.fletchT += dt;
    if (p.fletchT >= kit.fletch) { p.fletchT = 0; gainArrow(p, 1); }
  } else p.fletchT = 0;
  p.quiverFlash = Math.max(0, p.quiverFlash - dt);
  p.readyFlash = Math.max(0, p.readyFlash - dt);
  p.dryT = Math.max(0, p.dryT - dt);

  // bow: pressing arms the shot, releasing looses. The press does not have to
  // land on a ready bow - it stays armed, so holding through the renock (or
  // through an empty quiver) draws the moment the next arrow is there. Without
  // that, a controller that holds fire down - every AI slot does - would fire
  // once and then wait forever for an edge it already spent.
  if (inp.fire && !p.firePrev) {
    p.fireArmed = true;
    if (p.quiver <= 0 && p.dryT <= 0) dryFire(p);
  }
  if (!inp.fire) p.fireArmed = false;
  if (p.fireArmed && !p.charging && p.nockT <= 0 && p.quiver > 0 && p.fallT <= 0 && p.swingT <= 0) {
    p.charging = true;
    p.chargeT = 0;
    if (nearPlayer(p.x, p.y)) SFX.bowDraw();
  }
  if (!inp.fire && p.charging) {
    p.charging = false;
    fireArrow(p);
    p.chargeT = 0;
  }
  p.firePrev = inp.fire;

  // bow draw: charge up and keep facing the aim point
  if (p.charging) {
    p.chargeT = Math.min(kitOf(p).bowCharge, p.chargeT + dt);
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
const flakes = [];
// a fresh flake somewhere in the field, from the given random stream
function makeFlake(r) {
  return {
    x: r() * VIEW_W, y: r() * VIEW_H, // offset inside the field; the camera adds the rest
    h: 30 + r() * 90,                  // world px left to fall before it lands
    rest: 0,                           // >0: landed, seconds of rest left
    spd: 9 + r() * 17, sway: 0.4 + r(), ph: r() * 9,
    size: r() < 0.75 ? 1 : 2, a: 0.35 + r() * 0.45,
  };
}
for (let i = 0; i < 70; i++) flakes.push(makeFlake(rng));

// keep snow density constant across view sizes; resize top-ups draw from a
// separate seeded stream so they never perturb the main rng's worldgen prefix
const fxRng = mulberry32((SEED ^ 0x9e3779b9) >>> 0);
function fitFlakes() {
  const target = Math.round(70 * (VIEW_W * VIEW_H) / (480 * 270));
  while (flakes.length > target) flakes.pop();
  while (flakes.length < target) flakes.push(makeFlake(fxRng));
}

function updateFx(dt) {
  const now = performance.now() / 1000;
  for (const f of flakes) {
    if (f.rest > 0) {
      f.rest -= dt;
      if (f.rest <= 0) { // reborn: same slot, new spot in the field
        const n = makeFlake(rng);
        n.x += camX; n.y += camY;
        Object.assign(f, n);
      }
      continue;
    }
    const dy = f.spd * dt;
    f.y += dy; f.h -= dy;
    f.x += Math.sin(now * f.sway + f.ph) * 8 * dt + 4 * dt;
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
  if (bagFlash > 0) bagFlash -= dt; // the backpack's refusal red is chrome: wall time
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

