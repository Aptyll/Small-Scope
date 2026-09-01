'use strict';
// The frame: render() composes ground, entities and lighting into the world
// buffer and blits it under the UI, plus the '.' debug overlays and the
// cursor, reticle and bow aim line.
// ------------------------------------------------------------ render
function drawSpriteFlash(spr, x, y, flash) {
  ctx.drawImage(spr, x, y);
  if (flash > 0) {
    sctx.clearRect(0, 0, 64, 64);
    sctx.globalCompositeOperation = 'source-over';
    sctx.drawImage(spr, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = 'rgba(255,255,255,0.8)';
    sctx.fillRect(0, 0, 64, 64);
    ctx.drawImage(scratch, 0, 0, spr.width, spr.height, x, y, spr.width, spr.height);
  }
}

// The same thing for one frame of a sprite ATLAS. A drawImage whose source
// canvas differs from the last one cannot be batched, so anything the world
// holds a thousand of draws from a single texture and picks its frame with a
// source rect instead of by swapping canvases - measured on a GTX 1060, the
// pines cost 97 fps as sixteen canvases and 199 as one.
function drawFrameFlash(atlas, fi, x, y, flash) {
  const w = atlas.fw, h = atlas.fh, sx = fi * w;
  ctx.drawImage(atlas, sx, 0, w, h, x, y, w, h);
  if (flash > 0) {
    sctx.clearRect(0, 0, 64, 64);
    sctx.globalCompositeOperation = 'source-over';
    sctx.drawImage(atlas, sx, 0, w, h, 0, 0, w, h);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = 'rgba(255,255,255,0.8)';
    sctx.fillRect(0, 0, 64, 64);
    ctx.drawImage(scratch, 0, 0, w, h, x, y, w, h);
  }
}

// The work-target rim: the hero's hovered workable object (tree, dead tree,
// rock, berried bush, chest) draws under a 1px pulsing gold outline - the
// buy plates' two golds on the same beat, so "you can act on this" reads in
// its standing ink, and the target never blends into the occluder fade's
// pocket below. The sprite (or atlas frame) tints through the scratch canvas
// and stamps the eight neighbours, the same rim grammar as the hero
// silhouette and drawPixelTextOutline. Call it right before drawing the
// object itself so the rim sits under the body.
function drawTargetRim(src, sx, sy, w, h, x, y, now) {
  sctx.clearRect(0, 0, 64, 64);
  sctx.globalCompositeOperation = 'source-over';
  sctx.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = Math.sin(now * 6) > 0 ? '#f2cc6a' : '#c9a227';
  sctx.fillRect(0, 0, 64, 64);
  for (let ry = -1; ry <= 1; ry++) for (let rx = -1; rx <= 1; rx++) {
    if (rx || ry) ctx.drawImage(scratch, 0, 0, w, h, x + rx, y + ry, w, h);
  }
}

// Occluder fade: the pines around the viewed hero soften into a visibility
// pocket, so the hero stays readable while digging into the treeline. Alpha
// is a pure function of trunk-to-hero distance - nothing is stored per tree,
// so the fade eases in and out with every step by construction - in two
// layers: the adjacent ring sits hard on the TREE_FADE_A floor (the hero
// reads clearly through it), and the two-tile ring climbs back to opaque so
// the pocket has a soft edge instead of a wall. The tree under the hero's
// own cursor holds full ink so the one being worked stays crisp; a mid-shake
// chop lifts a faded neighbour back to opaque and o.shake's decay eases it
// down again. While any pine is inside the ramp the hero also wears a black
// 1px silhouette rim (treeFadeSil, stamped by drawPlayer, draw-world.js)
// whose strength runs on the same distances, so the body pops off the
// canopy over it and the rim dissolves as the hero steps into the open.
const TREE_FADE_A = 0.35; // alpha floor on the adjacent ring
const TREE_FADE_R0 = 24; // fully faded inside this trunk distance (world px)
const TREE_FADE_R1 = 52; // back to opaque beyond this
let treeFadeSil = 0; // this frame's silhouette-rim strength, set beside the y-sort

function render() {
  const now = performance.now() / 1000;
  const shx = settings.shake && state.shake > 0.2 ? Math.round(rand(-state.shake, state.shake)) : 0;
  const shy = settings.shake && state.shake > 0.2 ? Math.round(rand(-state.shake, state.shake)) : 0;
  const ox = Math.round(camX) + shx;
  const oy = Math.round(camY) + shy;
  // exact (unrounded) camera for MOVING entities. Screen pos must be
  // round(world - camera) with a single rounding: rounding the camera and the
  // entity separately makes their boundary crossings disagree, and the sprite
  // vibrates +/-1px against the background while walking - reads as motion
  // blur / ghosting at high refresh rates. Tiles keep the rounded ox/oy.
  const ex = camX + shx;
  const ey = camY + shy;

  // Into the world buffer: from here to renderLighting() every pass draws at
  // 1:1 world pixels into a WV_W x WV_H frame, and the screen never sees any
  // of it until the blit below. Everything in this stretch bounds itself
  // against WV_W/WV_H, never VIEW_W/VIEW_H - at zoom < 1 the world view is
  // WIDER than the canvas, and culling to the canvas would eat the edges.
  ctx = wctx;

  // ground
  ctx.drawImage(groundCv, ox, oy, WV_W, WV_H, 0, 0, WV_W, WV_H);

  // fish: silhouettes drifting under the thin ice, crisp in open holes
  for (const f of fish) {
    // `vis` is how much of the body is over water (1 for every born fish).
    // The alpha ramps off the BACK half of it, so an emerger stays completely
    // invisible until most of it is under the ice and only its tail is still
    // outside - by which point that tail is a couple of pixels at a fraction
    // of 0.4. Nothing readable is ever drawn over snow.
    const em = f.born ? 1 : Math.max(0, (f.vis - 0.5) * 2);
    if (em <= 0) continue;
    const sx = f.x - ex, sy = f.y - ey;
    if (sx < -12 || sy < -12 || sx > WV_W + 12 || sy > WV_H + 12) continue;
    const surfaced = ground[idx(Math.floor(f.x / TILE), Math.floor(f.y / TILE))] === 2;
    const wig = Math.round(Math.sin(f.t * 7) * 1.2);
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy));
    ctx.rotate(f.a);
    ctx.globalAlpha = (surfaced ? 0.95 : 0.4) * em;
    ctx.fillStyle = surfaced ? '#7fa9c6' : '#4a708c';
    // tapered oval body with a pointed nose (drawn along +x)
    ctx.fillRect(-3, -1, 7, 3);            // core
    ctx.fillRect(-1, -2, 3, 5);            // dorsal/belly bulge amidships
    ctx.fillRect(4, 0, 1, 1);              // nose tip
    // forked tail on a narrow peduncle, waving side to side
    ctx.fillRect(-4, -1 + wig, 1, 3);
    ctx.fillRect(-5, -2 + wig, 1, 2);
    ctx.fillRect(-5, 1 + wig, 1, 2);
    if (surfaced) {
      ctx.fillStyle = '#c9dded';
      ctx.fillRect(-1, 1, 3, 1);           // pale belly
      ctx.fillStyle = '#101d2c';
      ctx.fillRect(2, -1, 1, 1);           // eye
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // pick-cracked ice: bright fractures radiating from the struck tile
  for (const [ci, hits] of iceCracks) {
    const ctx2 = ci % WORLD, cty2 = (ci / WORLD) | 0;
    const px = ctx2 * TILE - ox, py = cty2 * TILE - oy;
    if (px < -TILE || py < -TILE || px > WV_W || py > WV_H) continue;
    const n = 3 + hits * 3;
    for (let j = 0; j < n; j++) {
      const h = hash2(ci * 7 + j * 13, j * 31 + hits);
      const a = (j / n) * Math.PI * 2 + h;
      let x0 = px + 8, y0 = py + 8;
      const steps = 2 + hits;
      ctx.fillStyle = j % 2 ? 'rgba(238,248,253,0.9)' : 'rgba(163,203,224,0.9)';
      for (let s = 0; s < steps; s++) {
        x0 += Math.cos(a) * 2 + (hash2(ci + s, j) - 0.5);
        y0 += Math.sin(a) * 2 + (hash2(j + 7, ci + s) - 0.5);
        ctx.fillRect(Math.round(x0), Math.round(y0), 1, 1);
      }
    }
  }

  // the archery track's rails, flat under everything that walks, then the
  // parkour's start/finish line, painted flat on the carved ice
  if (PRACTICE) { drawAgTrack(ox, oy); drawParkourLine(ox, oy); }

  // footprints + slide trails
  for (const f of footprints) {
    if (f.k === 1) {
      // carved snow groove, lit from the top-left like the rest of the art:
      // shadowed trench wall on top, lit pressed floor below. Holds crisp for
      // most of its (short) life, then fades out fast — so a slide's trail
      // wipes away tail-first behind the player instead of ghosting out as one
      const a = Math.max(0, Math.min(1, (SNOW_TRAIL_LIFE - f.t) / SNOW_TRAIL_FADE));
      const px = Math.round(f.x - ox) - 1, py = Math.round(f.y - oy) - 1;
      ctx.fillStyle = 'rgba(128,152,190,' + (a * 0.6).toFixed(3) + ')';
      ctx.fillRect(px, py, 2, 1);
      ctx.fillStyle = 'rgba(182,199,222,' + (a * 0.55).toFixed(3) + ')';
      ctx.fillRect(px, py + 1, 2, 1);
    } else if (f.k === 2) {
      // ice skate scratch: thin frosted nick, brighter than the ice sheet
      const a = Math.max(0, 1 - f.t / 9);
      ctx.fillStyle = 'rgba(238,250,255,' + (a * 0.75).toFixed(3) + ')';
      ctx.fillRect(Math.round(f.x - ox), Math.round(f.y - oy), 1, 1);
    } else if (f.k === 3) {
      // belly-crawl furrow: a 5px trough laid ACROSS the path (f.nx/ny is the
      // perpendicular the mark was pushed with, so it stays square to the
      // crawl whichever way it went), pressed dark in the middle with the snow
      // it shoved up pale at both lips, plus one elbow dimple to the side.
      // Lives the full 9 s of a footprint - a trail worth following needs to
      // outlast the crawl that made it.
      const a = Math.max(0, 1 - f.t / 9);
      const px = Math.round(f.x - ox), py = Math.round(f.y - oy);
      const dark = 'rgba(118,144,186,' + (a * 0.45).toFixed(3) + ')';
      const lip = 'rgba(200,216,238,' + (a * 0.4).toFixed(3) + ')';
      // two deep along the direction of travel (f.ny, -f.nx), so consecutive
      // marks butt up against each other into one trough instead of a ladder
      for (let k = 0; k < 2; k++) {
        const ox2 = Math.round(f.ny * k), oy2 = Math.round(-f.nx * k);
        for (let t = -2; t <= 2; t++) {
          ctx.fillStyle = t === -2 || t === 2 ? lip : dark;
          ctx.fillRect(px + ox2 + Math.round(f.nx * t), py + oy2 + Math.round(f.ny * t), 1, 1);
        }
      }
      if (f.s) {
        ctx.fillStyle = dark;
        ctx.fillRect(px + Math.round(f.nx * 3 * f.s), py + Math.round(f.ny * 3 * f.s), 1, 1);
      }
    } else {
      // walking footprints
      const a = Math.max(0, 1 - f.t / 9);
      ctx.fillStyle = 'rgba(122,150,192,' + (a * 0.6).toFixed(3) + ')';
      ctx.fillRect(Math.round(f.x - ox) - 1, Math.round(f.y - oy), 2, 2);
    }
  }

  // visible tile range
  const tx0 = Math.max(0, Math.floor(ox / TILE) - 1);
  const ty0 = Math.max(0, Math.floor(oy / TILE) - 1);
  const tx1 = Math.min(WORLD - 1, Math.ceil((ox + WV_W) / TILE) + 1);
  const ty1 = Math.min(WORLD - 1, Math.ceil((oy + WV_H) / TILE) + 2);

  // the night sky, reflected in every frozen tile: on the ice surface, so it
  // covers the fish under it and the cracks in it, and under everything that
  // walks - a body standing on the ice covers its own reflection
  if (settings.vidStars) drawIceStars(ox, oy, tx0, ty0, tx1, ty1);

  // flat objects first (stumps)
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const o = objects[idx(tx, ty)];
      if (!o) continue;
      const px = tx * TILE - ox, py = ty * TILE - oy;
      // +4 like rocks and bushes - any lower and the canopy of a tree on the tile below buries it
      if (o.type === 'stump') ctx.drawImage(SPRITES.stump, px, py + 4);
      // nets lie flat on the water, under everything that walks on them
      else if (o.type === 'net') drawNet(o, px, py, now);
    }
  }

  // what the abilities left flat on the snow - craters, and the piercing
  // shot's telegraph line - then drops (all under entities)
  drawAbilityGround(ex, ey, now);
  for (const d of drops) {
    const spr = SPRITES[ITEMS[d.type] ? ITEMS[d.type].icon : 'itemGold'];
    const h = spr.width >> 1; // a tool's icon is 12x12, everything else 8x8
    // shadow
    ctx.fillStyle = 'rgba(120,140,175,0.35)';
    ctx.fillRect(Math.round(d.x - ex) - 2, Math.round(d.y - ey) + 2, 4, 2);
    // a find glints in the colour of its own tier, so something worth walking
    // to is told from a berry at a distance
    const tier = itemTier(d.type);
    if (tier >= 0) {
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now * 5 + d.x);
      ctx.fillStyle = TOOL_TIERS[tier].rim;
      ctx.fillRect(Math.round(d.x - ex) - h - 1, Math.round(d.y - d.z - ey) - h - 1, h * 2 + 2, h * 2 + 2);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(spr, Math.round(d.x - ex) - h, Math.round(d.y - d.z - ey) - h);
  }

  // y-sorted entities. A building sorts by the bottom of its footprint; a
  // filler whose anchor is outside the scanned tiles stands in for it so a
  // big building still draws when only its lower tiles are on screen.
  const draws = [];
  const seen = new Set();
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      let o = objects[idx(tx, ty)];
      // stumps and nets are both drawn flat, above, and never y-sorted; an
      // eagle's hitbox tiles have no pixels of their own (drawEagle draws the bird)
      if (!o || o.type === 'stump' || o.type === 'net' || o.type === 'eagle') continue;
      if (o.type === 'part') {
        o = o.of;
        if ((o.tx >= tx0 && o.tx <= tx1 && o.ty >= ty0 && o.ty <= ty1) || seen.has(o)) continue;
        seen.add(o);
      }
      draws.push({ y: (o.ty + structH(o.type)) * TILE, o, tx: o.tx, ty: o.ty });
    }
  }
  for (const p of players) {
    if (p.dead || inAir(p)) continue; // airborne slots draw in drawDropAir
    draws.push({ y: p.y + 8, p, ghost: !p.active }); // empty slots stand as silhouettes
  }
  for (const a of animals) draws.push({ y: a.y + 4, a });
  for (const b of robots) draws.push({ y: b.y + (b.merchant ? 8 : 4), r: b }); // a merchant stands on player feet (robots.js)
  // the training grounds' archery targets: entities, never tile objects (a
  // slider crosses tiles every frame), sorted by their base like everything
  if (PRACTICE) for (const t of ptargets) draws.push({ y: t.y + 1, pt: t });
  // your side's worker flags, half a pixel behind their own tile so a flag
  // planted on a tree is never swallowed by that tree's canopy
  for (const q of players) {
    if (!q.active || !q.flag || q.team !== viewPlayer().team) continue;
    draws.push({ y: (q.flag.ty + 1) * TILE + 0.5, f: q });
  }
  draws.sort((a, b) => a.y - b.y);

  // whose view the canopies must not hide (null while dead or airborne - no
  // sprite on the ground to hide), the tree its cursor is resting on, and the
  // silhouette-rim strength: the nearest pine's position on the fade ramp, so
  // the rim is full where the pocket is hard and gone where the forest ends
  let fadeP = viewPlayer();
  if (!fadeP.active || fadeP.dead || inAir(fadeP)) fadeP = null;
  let fadeWkO = null;
  treeFadeSil = 0;
  if (fadeP) {
    const wk = workTarget(fadeP);
    if (wk) fadeWkO = wk.o;
    const ptx = Math.floor(fadeP.x / TILE), pty = Math.floor(fadeP.y / TILE);
    for (let sy = pty - 2; sy <= pty + 2; sy++) for (let sx = ptx - 2; sx <= ptx + 2; sx++) {
      const so = inWorld(sx, sy) ? objects[idx(sx, sy)] : null;
      if (!so || so.type !== 'tree') continue;
      const sd = Math.hypot(sx * TILE + 8 - fadeP.x, sy * TILE + 8 - fadeP.y);
      treeFadeSil = Math.max(treeFadeSil,
        1 - Math.max(0, sd - TREE_FADE_R0) / (TREE_FADE_R1 - TREE_FADE_R0));
    }
  }

  for (const d of draws) {
    if (d.p) { if (d.ghost) drawGhost(d.p, ex, ey); else drawPlayer(d.p, ex, ey, now); continue; }
    if (d.a) { drawAnimal(d.a, ex, ey, now); continue; }
    if (d.r) { drawRobot(d.r, ex, ey, now); continue; }
    if (d.f) { drawFlag(d.f, ex, ey, now); continue; }
    if (d.pt) { drawPTarget(d.pt, ex, ey, now); continue; }
    const o = d.o;
    const px = d.tx * TILE - ox, py = d.ty * TILE - oy;
    const sh = o.shake > 0 ? Math.round(Math.sin(o.shake * 55) * 1.4) : 0;
    if (o.type === 'tree') {
      // 27x37, bottom-aligned on its own tile: (px - 5, py - 21) puts the
      // trunk on the tile's centre line and hangs the canopy over the tile
      // above. Which of the sixteen frames it wears is the WIND's business,
      // not the tree's - see treeFrame() in js/draw-world.js - and it comes
      // off the one atlas texture, never a per-frame canvas. The handful
      // surrounding the viewed hero take the occluder fade (consts above
      // render()); the globalAlpha flip only ever touches those few, so the
      // thousand-pine atlas batch stays whole.
      const fi = treeFrame(d.tx, d.ty);
      // the hero's own work target: full ink under the gold rim, so the tree
      // the cursor is on is its OWN state - not a faded pine quietly
      // borrowing the normal look, which read as the tree blending away the
      // moment the cursor left it
      if (fadeP && o === fadeWkO) {
        const fw = SPRITES.treeAtlas.fw, fh = SPRITES.treeAtlas.fh;
        drawTargetRim(SPRITES.treeAtlas, fi * fw, 0, fw, fh, px - 5 + sh, py - 21, now);
      }
      let fa = 1;
      if (fadeP && o !== fadeWkO) {
        const dist = Math.hypot(d.tx * TILE + 8 - fadeP.x, d.ty * TILE + 8 - fadeP.y);
        if (dist < TREE_FADE_R1) {
          fa = TREE_FADE_A + (1 - TREE_FADE_A) *
            Math.max(0, dist - TREE_FADE_R0) / (TREE_FADE_R1 - TREE_FADE_R0);
          if (o.shake > 0) fa = Math.max(fa, Math.min(1, o.shake * 4));
        }
      }
      if (fa < 1) ctx.globalAlpha = fa;
      drawFrameFlash(SPRITES.treeAtlas, fi, px - 5 + sh, py - 21, o.flash);
      if (fa < 1) ctx.globalAlpha = 1;
    } else if (o.type === 'deadTree') {
      const spr = SPRITES.deadTree[o.variant];
      if (fadeP && o === fadeWkO) drawTargetRim(spr, 0, 0, spr.width, spr.height, px + sh, py - 8, now);
      drawSpriteFlash(spr, px + sh, py - 8, o.flash);
    } else if (o.type === 'den') {
      drawSpriteFlash(SPRITES.den, px + sh, py + 4, o.flash);
    } else if (o.type === 'rock') {
      const spr = SPRITES.rock[o.variant];
      if (fadeP && o === fadeWkO) drawTargetRim(spr, 0, 0, spr.width, spr.height, px + sh, py + 4, now);
      drawSpriteFlash(spr, px + sh, py + 4, o.flash);
    } else if (o.type === 'chest') {
      if (fadeP && o === fadeWkO) drawTargetRim(CHEST_SPR, 0, 0, CHEST_SPR.width, CHEST_SPR.height, px + sh, py + TILE - CHEST_SPR.height, now);
      drawSpriteFlash(CHEST_SPR, px + sh, py + TILE - CHEST_SPR.height, o.flash);
    } else if (o.type === 'dummy') {
      // the practice target: skids on its tile, everything else drawn up off
      // it like a tree. The readout bar only appears once it is hurt, and
      // updatePractice mending it is what takes the bar away again. While
      // the archery round's sink runs (agSinkU, js/world.js) the sprite
      // drops and the snow line crops it - the bottom is already under the
      // field - and at full depth the object leaves the grid entirely.
      const su = PRACTICE ? agSinkU() : 0;
      if (su > 0) {
        const vis = Math.round(DUMMY_SPR.height * (1 - su));
        if (vis > 0) ctx.drawImage(DUMMY_SPR, 0, 0, DUMMY_SPR.width, vis,
          px + sh + ((TILE - DUMMY_SPR.width) >> 1), py + TILE - vis, DUMMY_SPR.width, vis);
        continue;
      }
      const dx = px + sh + ((TILE - DUMMY_SPR.width) >> 1);
      const dy = py + TILE - DUMMY_SPR.height;
      drawSpriteFlash(DUMMY_SPR, dx, dy, o.flash);
      if (o.hp < o.maxHp) drawHealthBar(px + 8 + sh, dy - 6, o.hp, o.maxHp, 20);
      // the combo readout, above the bar's slot so neither ever covers the other
      drawDummyMeter(o, px + 8, dy - 10);
    } else if (o.type === 'banner') {
      drawBanner(o, px + sh, py, now);
    } else if (o.type === 'rack') {
      // two tiles per rack: the lead (left) tile draws the whole sprite
      // centred over the pair; the follower tile is solid and silent
      if (o.lead) {
        // `dx` nudges the picture off the tile grid (the practice rack sits
        // half a tile left of its pair, square under the dummy's axis)
        const rx = px + sh + (o.dx || 0);
        // mid-sink for the archery round: dropped and cropped like the dummy
        const su = PRACTICE ? agSinkU() : 0;
        if (su > 0) {
          const vis = Math.round(RACK_SPR.height * (1 - su));
          if (vis > 0) ctx.drawImage(RACK_SPR, 0, 0, RACK_SPR.width, vis,
            rx + ((TILE * 2 - RACK_SPR.width) >> 1), py + TILE + 1 - vis, RACK_SPR.width, vis);
          continue;
        }
        ctx.fillStyle = 'rgba(40,60,100,0.25)';
        ctx.fillRect(rx + 2, py + TILE - 2, TILE * 2 - 4, 2);
        drawSpriteFlash(RACK_SPR, rx + ((TILE * 2 - RACK_SPR.width) >> 1), py + TILE - RACK_SPR.height + 1, o.flash);
      }
    } else if (o.type === 'pkdie') {
      drawPkDie(o, px, py, now);
    } else if (o.type === 'agbell') {
      // mid-sink for the archery round, like the dummy and rack: the bell is
      // drawn procedurally, so it slides down and a clip at its ground line
      // crops what is already under the field
      const su = PRACTICE ? agSinkU() : 0;
      if (su > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(px - 2, py + TILE - 29, 21, 29);
        ctx.clip();
        drawAgBell(o, px + sh, py + Math.round(su * 29), now);
        ctx.restore();
      } else drawAgBell(o, px + sh, py, now);
    } else if (o.type === 'bush') {
      const spr = o.berries > 0 ? SPRITES.bush : SPRITES.bushEmpty;
      // a bare bush never rims: workTarget's `ready` gate already refuses it,
      // so the rim only ever lands on berries worth picking
      if (fadeP && o === fadeWkO) drawTargetRim(spr, 0, 0, spr.width, spr.height, px + sh, py + 4, now);
      drawSpriteFlash(spr, px + sh, py + 4, o.flash);
    } else if (STRUCTS[o.type]) {
      const spr = structSprite(o);
      const sy = py + structH(o.type) * TILE - spr.height; // skirt on the footprint's bottom edge
      // a sprite wider than its footprint (the 32x32 turret on one tile) centres over it
      const sx = px + ((structW(o.type) * TILE - spr.width) >> 1);
      if (o.building) {
        const p = o.buildT / o.buildTotal;
        if (spr.width > 16) {
          // a big build: the foundation is staked out first, then the walls
          // rise out of it behind a weld line (bigBuildReveal for the split)
          const fw = structW(o.type) * TILE, fh = structH(o.type) * TILE;
          ctx.fillStyle = 'rgba(58,66,82,0.5)';
          ctx.fillRect(px + 1, py + 1, fw - 2, fh - 2);
          ctx.fillStyle = '#1c2130';
          ctx.fillRect(px, py, fw, 1); ctx.fillRect(px, py + fh - 1, fw, 1);
          ctx.fillRect(px, py, 1, fh); ctx.fillRect(px + fw - 1, py, 1, fh);
          for (const [cx, cy] of [[px + 1, py - 2], [px + fw - 3, py - 2], [px + 1, py + fh - 5], [px + fw - 3, py + fh - 5]]) {
            ctx.fillStyle = '#1c2130'; ctx.fillRect(cx, cy, 2, 4);
            ctx.fillStyle = '#e0b83f'; ctx.fillRect(cx, cy, 2, 1);
          }
          const r = bigBuildReveal(o);
          if (r.rows > 0) {
            ctx.save();
            ctx.beginPath(); ctx.rect(sx - 2, sy + spr.height - r.rows, spr.width + 4, r.rows); ctx.clip();
            drawSpriteFlash(spr, sx + sh, sy, o.flash);
            ctx.restore();
            if (r.rows < spr.height) {
              const ey = sy + spr.height - r.rows;
              ctx.fillStyle = '#fff1b0'; ctx.fillRect(sx + 2, ey, spr.width - 4, 1);
              ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now * 40);
              ctx.fillStyle = '#ffd95c'; ctx.fillRect(sx + 4, ey - 1, spr.width - 8, 1);
              ctx.globalAlpha = 1;
            }
          }
        } else if (p < 1 / 3) ctx.drawImage(SPRITES.scaffold[0], px, py);
        else if (p < 2 / 3) ctx.drawImage(SPRITES.scaffold[1], px, py);
        else {
          drawSpriteFlash(spr, px + sh, py, o.flash);
          ctx.drawImage(SPRITES.scaffold[2], px, py);
        }
      } else {
        drawSpriteFlash(spr, sx + sh, sy, o.flash);
        if (o.type === 'spawner') drawBayOverlay(o, sx + sh, sy, now);
        // the gun is not in the grid: rasterise it at the live bearing, on the collar
        if (o.type === 'turret') drawTurretHead(o, sx + sh + 16, sy + 12);
        if (o.hp < o.maxHp * 0.6) {
          // four crack marks, placed as fractions of the sprite so they fit any size
          const w = spr.width, h = spr.height;
          ctx.fillStyle = 'rgba(40,25,15,0.5)';
          ctx.fillRect(sx + (w >> 2), sy + (h * 5 >> 4), 1, 3); ctx.fillRect(sx + (w >> 2) + 1, sy + (h >> 1), 1, 2);
          ctx.fillRect(sx + (w * 5 >> 3), sy + (h * 3 >> 4), 1, 4); ctx.fillRect(sx + (w * 5 >> 3) + 1, sy + (h * 7 >> 4), 1, 2);
        }
        // damage readout: only once hurt, so an untouched base stays clean.
        // the bay has its own bar inside drawBayOverlay - don't draw two.
        // `+ sh` so the readout rides the hit shudder with the building it
        // belongs to: it only ever appears while the thing is being hit, and a
        // bar holding still over a wall that is rocking is a bar centred on
        // nothing. drawBayOverlay is handed `sx + sh` and has always done this.
        if (o.type !== 'spawner' && o.hp < o.maxHp) {
          drawHealthBar(sx + sh + (spr.width >> 1), sy - 5, o.hp, o.maxHp, Math.max(12, Math.min(24, spr.width - 4)));
        }
      }
    }
  }

  drawSelection(ox, oy, now);
  drawFlagAim(ox, oy);
  drawWorkHint(ox, oy);
  drawFishHint(ex, ey, now);
  // the parkour's two readouts: the lap clock over the runner, BEST / LAST
  // on the frost plate at the gate (drawParkour, js/draw-world.js) - and the
  // archery range's own BEST / LAST plate over the bell (drawAgame), with
  // the hit-ring flash snapping over whatever face just broke (drawAgRings)
  if (PRACTICE) { drawParkour(ex, ey, now); drawAgame(ex, ey, now); drawAgRings(ex, ey); }

  // construction AND card-crafting progress bars - same bar, same "over the
  // roof" placement for a big building; a craft in flight (a finished Keep,
  // o.craftT > 0) draws in an icy blue instead of construction's gold so
  // the two read as different things at a glance
  for (const o of structures) {
    const crafting = !o.building && o.type === 'keep' && o.craftT > 0;
    if (!o.building && !crafting) continue;
    const px = o.tx * TILE - ox, py = o.ty * TILE - oy;
    if (px < -20 || px > WV_W + 4 || py < -20 || py > WV_H + 4) continue;
    const p = crafting ? Math.min(1, 1 - o.craftT / o.craftTotal) : Math.min(1, o.buildT / o.buildTotal);
    const big = structW(o.type) > 1;
    const bw = big ? 24 : 12, bx = big ? px + structW(o.type) * 8 - 12 : px + 2;
    const by = big ? (o.ty + structH(o.type)) * TILE - oy - structSprite(o).height - 12 : py - 7;
    ctx.fillStyle = 'rgba(15,22,50,0.8)';
    ctx.fillRect(bx, by, bw, 4);
    ctx.fillStyle = crafting ? '#8fd8ff' : '#ffd95c';
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * p), 2);
  }

  // particles
  for (const p of particles) {
    // `maxLife` is the seconds a particle spends fading out (bursts hold full
    // opacity until their last 0.4 s); `alpha` caps how opaque it ever gets,
    // which is what keeps arrow trail motes a hint of colour rather than sparks
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife)) * (p.alpha || 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x - ex), Math.round(p.y - ey), p.size, p.size);
  }
  ctx.globalAlpha = 1;

  drawAimLine(ex, ey, now);

  // arrows: the one shared body (ARROW_MAP, js/actions.js - white tip, flint
  // head, the loaded bit's collar, one-gold shaft, team feathers) rasterised
  // at the live bearing by arrowBodyPx and rimmed in dark so the shot stays
  // readable over snow. a.x/a.y is the TIP - the point the sim tests - and
  // the body trails ARROW_LEN px behind it.
  for (const a of arrows) {
    if (a.kind === 'bolt') { drawBolt(a, ex, ey); continue; }
    const vd = Math.hypot(a.vx, a.vy) || 1;
    const nx = a.vx / vd, ny = a.vy / vd;
    const hx = Math.round(a.x - ex), hy = Math.round(a.y - ey);
    if (hx < -22 || hx > WV_W + 22 || hy < -22 || hy > WV_H + 22) continue;
    // Not everything a tool fires is a shaft. A thrown log tumbles as a block
    // and a conjured mote is a glow with no bearing at all, so those two get
    // bodies of their own; every other bit is the arrow silhouette, wearing
    // the bit's own colour on the collar behind the head.
    if (a.path === 'lob') { drawTumbler(a, hx, hy); continue; }
    if (a.path === 'orbit') { drawMote(a, hx, hy, now); continue; }
    ARROW_PX.length = 0;
    arrowBodyPx(ARROW_PX, a.x - ex, a.y - ey, nx, ny, 0, ARROW_LEN,
      TEAMS[skin(a.team)].mark, TEAMS[skin(a.team)].coatD, a.col || ARROW_INK.G, 0);
    paintArrowPx(ARROW_PX);
  }

  // airborne ability bodies: the spinning net, and the grapple's rope
  // between a reeling body and its anchor - with the arrows, over the entities
  drawAbilityAir(ex, ey, now);

  drawTurretFx(ex, ey, now);

  // turret tracers
  for (const t of tracers) {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.t / 0.08));
    ctx.strokeStyle = '#f6d35c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(t.x0 - ex) + 0.5, Math.round(t.y0 - ey) + 0.5);
    ctx.lineTo(Math.round(t.x1 - ex) + 0.5, Math.round(t.y1 - ey) + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // swing arcs (every player who is mid-swing)
  for (const p of players) {
    if (!p.active || p.dead || inAir(p) || p.swingT <= 0) continue;
    const prog = 1 - p.swingT / 0.18;
    const a0 = p.swingDir - 1.1 + prog * 2.2;
    ctx.fillStyle = 'rgba(255,255,255,' + (0.8 - prog * 0.6).toFixed(2) + ')';
    for (let i = 0; i < 3; i++) {
      const a = a0 - i * 0.22;
      const rr = 13 - i;
      ctx.fillRect(
        Math.round(p.x + Math.cos(a) * rr - ex),
        Math.round(p.y - 2 + Math.sin(a) * rr - ey), 2, 2);
    }
  }

  // floaters (damage numbers drift sideways, rise faster, and can be 2x)
  for (const f of floaters) {
    const a = 1 - f.t / 0.9;
    ctx.globalAlpha = a;
    const s = f.scale || 1;
    drawPixelTextOutline(ctx, f.txt,
      Math.round(f.x + (f.vx || 0) * f.t - ex - pixelTextWidth(f.txt, s) / 2),
      Math.round(f.y - ey - f.t * (f.rise || 14)), f.color, '#0f1632', s);
    ctx.globalAlpha = 1;
  }

  drawDropAir(ex, ey, now); // the eagle, its rider and anyone falling from it
  renderLighting(ox, oy, now);
  // the two debug views, above the lighting on purpose - see the banner
  if (settings.hitbox > 1 || window.DBG.showPaths) drawNavPaths(ox, oy, ex, ey);
  drawHitboxes(ox, oy, ex, ey);

  // Back to the screen, and the only place the two pixel spaces meet. The
  // blit is done in DEVICE pixels (identity transform) at k = zoom * devScale
  // px per world px: whole at rest, so every world pixel gets exactly the
  // same k x k block and the grid is uniform; briefly fractional while the
  // ease runs, which is the one moment nobody is reading pixel edges. It is
  // one nearest-neighbour resample of an ALREADY COMPOSED frame, so ground,
  // sprites and particles share one grid instead of each rounding its own.
  // The destination overhangs the canvas by less than k px (sizeWorldView
  // ceils) and the edge clips it.
  ctx = uictx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const kPx = zoomCur * devScale;
  ctx.drawImage(worldCv, 0, 0, WV_W, WV_H, 0, 0, WV_W * kPx, WV_H * kPx);
  // everything from here draws in VIEW space, blown up by the whole-number
  // devScale - so 1px HUD rects and the 3x5 font stay exact at any zoom
  ctx.setTransform(devScale, 0, 0, devScale, 0, 0);

  renderWeather(ex, ey);
  renderVignettes();
  replayTick(now); // banks the finished world frame - must stay above renderUI
  // what the pointer is on, resolved ONCE and before anything lays out around
  // it: the event feed steps up by tipLift() the way it does for the replay
  // window, so this cannot come after the feed (see the tooltips banner, ui.js)
  tipResolve();
  renderUI(now);
  // the archery round's live layer: countdown, GO, the TIME/SCORE/HITS
  // plate, the final score (drawAgameUI, js/draw-world.js)
  if (PRACTICE && state.mode === 'play') drawAgameUI(now);
  if (state.mode === 'drop') renderDropUI(now);
  // the drop brief's roost headlines (updateDrop's tour, js/boot.js)
  if (state.mode === 'play' && state.dropBrief) drawDropBrief();
  // the flag order riding the pointer (its target tile is bracketed back in
  // the world pass); only up while the middle button is held
  if (state.mode === 'play') drawFlagCursor();
  if (state.mode === 'play' && state.wheel) renderWheel(now);

  // the M map works mid-flight too: the ride's wider read lives here now
  if ((state.mode === 'play' || state.mode === 'drop') && state.mapOpen) renderWorldMap(now);
  if (state.mode === 'play' && state.settingsOpen) renderSettings(now);
  if (state.mode === 'play' && state.draft) renderDraft(now);
  if (state.mode === 'title' || state.intro > 0) renderTitle(now);
  if (state.mode === 'dead') renderDead(now);
  renderReplay(); // the last four seconds, looping in the bottom-left corner
  // both sit above the death dim: the feed and the standings are exactly what
  // you read while you are down. They duck under the map/settings panels.
  if (!state.mapOpen && !state.settingsOpen && !window.DBG.hideUI &&
    !endScreen() && // a victory or defeat screen owns the whole frame
    (state.mode === 'play' || state.mode === 'dead')) renderEventLog();
  // the tooltip owns the bottom-left corner while it is up (the feed lifted
  // out of its way above); it draws in every mode, since the tech tree on the
  // title screen is read through it too
  if (!window.DBG.hideUI && !endScreen()) drawTooltip();
  if (scoreboardOpen()) renderScoreboard();
  if (!window.DBG.hideUI) drawTags();
  if (state.fade && state.fade.a > 0) {
    ctx.globalAlpha = Math.min(1, state.fade.a);
    ctx.fillStyle = state.fade.color;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
  // pointer, last of all so it sits above every overlay
  const cur = cursorInfo();
  applyCursorStyle(cur);
  if (settings.pixelCursor && mouse.inside && !window.DBG.hideUI) drawCursor(cur, now);
}

// the info stack (settings.info - the INFO row in the ESC menu, or F3, the
// minecraft reflex): fps, the framed slot's tile coordinates, and the run
// seed as one vertical list on the left edge at the top quarter of the view,
// clear of the berry/fish counters above it, above every overlay. In title
// only the fps line shows - nobody stands anywhere yet, and the menu prints
// the seed itself with the reroll die.
// A thrown log: a 5x5 block spinning about its own centre as it arcs. Drawn
// as four rotated corner runs rather than a sprite, so it reads at any angle
// the way the arrow body does, and rimmed for the same reason.
function drawTumbler(a, hx, hy) {
  const s = a.t * 9;
  const c = Math.cos(s), n = Math.sin(s);
  const put = (col, r) => {
    ctx.fillStyle = col;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      ctx.fillRect(Math.round(hx + dx * c - dy * n), Math.round(hy + dx * n + dy * c), 1, 1);
    }
  };
  put(ARROW_RIM, 3);
  put(a.col || '#a3794f', 2);
  ctx.fillStyle = '#d9ad72';
  ctx.fillRect(Math.round(hx - c - n), Math.round(hy - n + c), 1, 1);
}
// A conjured mote: no bearing, so no shaft - a rimmed core that breathes, and
// the one shot whose light in the dark is the point of it
function drawMote(a, hx, hy, now) {
  const r = 2 + Math.round(Math.abs(Math.sin(now * 7 + a.ox)) );
  ctx.fillStyle = ARROW_RIM;
  ctx.fillRect(hx - r, hy - r + 1, r * 2 + 1, r * 2 - 1);
  ctx.fillRect(hx - r + 1, hy - r, r * 2 - 1, r * 2 + 1);
  ctx.fillStyle = a.col || '#8fd8ff';
  ctx.fillRect(hx - r + 1, hy - r + 1, r * 2 - 1, r * 2 - 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(hx, hy, 1, 1);
}

function drawTags() {
  if (!settings.info) return;
  // two columns: a dim label, then the value on one shared x so the numbers
  // line up down the stack - the same dim-label / bright-value pairing the
  // berry and fish counters use. Red means one thing and one thing only:
  // something is wrong (a bad frame rate, a sample bank that did not load).
  // Nothing else is tinted for decoration.
  const lx = 5, vx = lx + pixelTextWidth('SEED') + 5;
  let y = Math.round(VIEW_H * 0.25);
  const line = (label, value, col) => {
    drawPixelTextOutline(ctx, label, lx, y, '#7a8bb8', '#0f1632');
    drawPixelTextOutline(ctx, value, vx, y, col || '#f4f7ff', '#0f1632');
    y += 10;
  };
  line('FPS', String(perf.fps), perf.fps < 45 ? '#ff9a8a' : '#f4f7ff');
  // the sampled sound bank: decoded / asked for. Red on anything missing,
  // because an empty bank is silent in exactly the way a mis-wired cue is -
  // every sampled sound falls back to the old synth line and the game sounds
  // untouched. See js/audio.js loadBank().
  const bs = SFX.banked();
  line('SFX', bs.got + '/' + bs.want, bs.got < bs.want ? '#ff9a8a' : '#f4f7ff');
  if (state.mode !== 'title') {
    const vp = viewPlayer(); // spectators read the slot the camera frames
    line('POS', Math.floor(vp.x / TILE) + ', ' + Math.floor(vp.y / TILE));
    line('SEED', String(SEED));
  }
}

// ------------------------------------------------------------ debug overlays
// What the sim actually tests, drawn on top of what the art shows. One key:
// '.' toggles `settings.hitbox` between 0 (off) and 2 (bodies + the route
// every walker is following). Every shape here is read from the same
// expression the sim uses, never a repeat of the number: an overlay that
// disagrees with the sim is worse than none, because it is believed. Colour
// carries the kind, so there is nothing to label:
//   cyan   a wall to everyone (isSolidTile)
//   blue   open water: a wall to animals and robots, a hole a player falls in
//   green  the body circle separateUnits/moveEntity push apart
//   red    the circle an arrow is tested against - offset UP from the feet
//   violet a walk-over pickup, or a click target
//   gold   a projectile, which is a point and not a circle
//   pink   the model's own centre column, for lining an overhead frame up on
// Reaches and sight ranges are deliberately NOT here: they are wide enough to
// bury the 7px circle that decides whether an arrow lands, and they come back
// on their own terms later.
// These two are the only world passes that draw ABOVE renderLighting: a debug
// view has to be as readable at midnight as at noon, and the lighting would
// eat it.
const HB_SOLID = '#5ad0ff', HB_WATER = '#3f76ff', HB_BODY = '#4dff7d';
const HB_HURT = '#ff4d5e', HB_PICK = '#c07dff', HB_SHOT = '#ffd95c';
const HB_MID = '#ff2ee6';

// One ring, plotted as 1px world pixels. Not an arc() stroke: that is
// anti-aliased, and the world blit magnifies a soft edge into mush. Rows give
// the left/right extremes and columns the top/bottom ones, so the ring closes
// at every radius and a fractional one (PLAYER_R is 4.5) is not rounded away.
function hbRing(cx, cy, r, col) {
  if (r < 0.5) return;
  cx = Math.round(cx); cy = Math.round(cy);
  if (cx + r < 0 || cy + r < 0 || cx - r > WV_W || cy - r > WV_H) return;
  ctx.fillStyle = col;
  const put = (px, py) => ctx.fillRect(px, py, 1, 1);
  const R = Math.floor(r);
  for (let d = -R; d <= R; d++) {
    const o = Math.round(Math.sqrt(r * r - d * d));
    put(cx - o, cy + d); put(cx + o, cy + d);
    put(cx + d, cy - o); put(cx + d, cy + o);
  }
}
function hbBox(x, y, w, h, col) {
  if (x + w < 0 || y + h < 0 || x > WV_W || y > WV_H) return;
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y + 1, 1, h - 2); ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
}
// one line, same idiom: Bresenham in 1px world pixels, `step` plotting one
// pixel in N (the dotted look a planned-but-not-yet-walked leg uses)
function hbLine(x0, y0, x1, y1, col, step) {
  if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) ||
    (x0 > WV_W && x1 > WV_W) || (y0 > WV_H && y1 > WV_H)) return;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  ctx.fillStyle = col;
  for (;;) {
    if ((!step || n % step === 0) && x0 >= 0 && y0 >= 0 && x0 < WV_W && y0 < WV_H) ctx.fillRect(x0, y0, 1, 1);
    n++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// the anchor point itself: a circle drawn around the wrong origin looks right
// until you see where its centre is
function hbDot(cx, cy, col) {
  const x = Math.round(cx), y = Math.round(cy);
  ctx.fillStyle = col;
  ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
}
// a short heading arrow - the shape for a thing that STEERS rather than
// routes, and so has no goal tile to put a box on. The arrowhead is what
// tells the two apart at a glance: a barbed stub is a heading, a line ending
// in a box is a walk to a decided place.
function hbArrow(cx, cy, ang, len, col) {
  const x0 = Math.round(cx), y0 = Math.round(cy);
  const x1 = Math.round(cx + Math.cos(ang) * len), y1 = Math.round(cy + Math.sin(ang) * len);
  hbLine(x0, y0, x1, y1, col, 0);
  const back = ang + Math.PI;
  for (const s of [0.7, -0.7]) {
    hbLine(x1, y1, Math.round(x1 + Math.cos(back + s) * 4), Math.round(y1 + Math.sin(back + s) * 4), col, 0);
  }
}

// The model's own centre column, and the one overlay here that is about the
// ART rather than the sim: the overhead frame (health bar, stamina bar, level
// badge) is the only thing in the game that has to line up with a sprite
// instead of with a number, and nothing else on screen shows you where a
// sprite's middle actually is.
//
// Every sprite in the game is an even number of pixels wide and centred on
// the seam between its two halves, so the true middle is a pixel BOUNDARY and
// no 1px line can sit on it. This draws at `round(centre)` — the column just
// right of that seam — which makes the test a count: a frame that is genuinely
// centred has as many columns strictly left of the line as it has from the
// line rightwards. It is dotted so the frame it is measuring still reads
// through it.
function hbMid(cx, y0, y1) {
  const x = Math.round(cx);
  if (x < 0 || x > WV_W) return;
  ctx.fillStyle = HB_MID;
  const a = Math.max(0, Math.round(y0)), b = Math.min(WV_H, Math.round(y1));
  for (let y = a; y < b; y += 2) ctx.fillRect(x, y, 1, 1);
}

function drawHitboxes(ox, oy, ex, ey) {
  if (!settings.hitbox) return;

  // tiles - the AABB moveEntity() sweeps, straight off isSolidTile. Statics
  // subtract the rounded camera, movers below subtract the exact one.
  const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE);
  const tx1 = Math.floor((ox + WV_W) / TILE), ty1 = Math.floor((oy + WV_H) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const px = tx * TILE - ox, py = ty * TILE - oy;
    if (isSolidTile(tx, ty)) hbBox(px, py, TILE, TILE, HB_SOLID);
    else if (inWorld(tx, ty) && ground[idx(tx, ty)] === 2) hbBox(px, py, TILE, TILE, HB_WATER);
  }

  // players: the body circle everything is pushed out of, and the hurt circle
  // an arrow is tested against - which sits 6px UP, at the chest, so a shot
  // that looks like it went over the head is a hit and this is where you see it.
  // A live roll adds the sweep it swipes units with, which is the body circle
  // grown by ROLL_HIT_R and centred on the feet, not the chest.
  for (const p of players) {
    if (!p.active || p.dead || inAir(p)) continue;
    hbRing(p.x - ex, p.y - ey, PLAYER_R, HB_BODY);
    hbRing(p.x - ex, p.y - 6 - ey, 7, HB_HURT);
    if (p.dodgeT > 0) hbRing(p.x - ex, p.y - ey, PLAYER_R + ROLL_HIT_R, HB_HURT);
    hbDot(p.x - ex, p.y - ey, HB_BODY);
    hbMid(p.x - ex, p.y - 32 - ey, p.y + 4 - ey); // up past the name tag, down past the feet
  }

  // animals: birds are the one unit nothing collides with, so they get no
  // body circle - only the (smaller) circle an arrow tests
  for (const a of animals) {
    if (a.dead) continue;
    if (a.kind !== 'bird') hbRing(a.x - ex, a.y - ey, unitRadius(a), HB_BODY);
    hbRing(a.x - ex, a.y - (a.alt || 0) - 3 - ey, a.kind === 'bird' ? 5 : 8, HB_HURT);
    hbDot(a.x - ex, a.y - ey, HB_BODY);
    hbMid(a.x - ex, a.y - (a.alt || 0) - 26 - ey, a.y + 4 - ey);
  }

  for (const b of robots) {
    if (b.dead) continue;
    hbRing(b.x - ex, b.y - ey, unitRadius(b), HB_BODY);
    hbRing(b.x - ex, b.y - 1 - ey, 7, HB_HURT); // robotHit
    hbDot(b.x - ex, b.y - ey, HB_BODY);
    hbMid(b.x - ex, b.y - 24 - ey, b.y + 4 - ey);
  }

  // buildings: the centre of the FOOTPRINT, which is what the sprite centres
  // itself over (`sx` in the structure draw) whether it is wider than its
  // tiles or not - so it is the line the damage bar has to sit on too
  for (const o of structures) {
    const w = structW(o.type) * TILE, h = structH(o.type) * TILE;
    hbMid(o.tx * TILE + w / 2 - ox, o.ty * TILE - 24 - oy, o.ty * TILE + h - oy);
  }

  // an arrow is a point: it is the tile under that point that stops it, and
  // that point that is tested against every circle above
  for (const a of arrows) hbDot(a.x - ex, a.y - ey, HB_SHOT);

  // walk-over and click targets, claimed from their own centres - what the
  // sim measures to
  for (const d of drops) hbRing(d.x - ex, d.y - ey, 7, HB_PICK);
  for (const f of fish) hbRing(f.x - ex, f.y - ey, 7, HB_PICK); // hoverFish
}

// debug: every walker's live route - '.' (settings.hitbox 2), or
// DBG.showPaths on its own.
// The line is the PLAN, not the walk: it leaves the unit, runs through the
// waypoints it has left, and ends in a box on `nav.gtx/gty`, the tile it
// decided to go to - which is the answer to "why is it walking over there".
// The leg it is on now is solid and the legs behind that are dotted, so a
// route being followed reads differently from a route being replanned.
// Everything that walks has one of these, grazing and patrolling included,
// so a line always shrinks into its box and ends where the walker stops.
// The two exceptions are the two things that do not walk: a flying bird gets
// a straight dotted line to its perch, and a fish - which genuinely has
// nowhere it is going - gets an arrow, no box, no claim of a destination.
function drawNavPaths(ox, oy, ex, ey) {
  const one = (e, col) => {
    const nav = e.nav;
    if (!nav || !nav.path) return false;
    let px = Math.round(e.x - ex), py = Math.round(e.y - ey);
    for (let i = nav.i; i < nav.path.length; i++) {
      const qx = Math.round(nav.path[i][0] - ex), qy = Math.round(nav.path[i][1] - ey);
      hbLine(px, py, qx, qy, col, i === nav.i ? 0 : 2);
      hbDot(qx, qy, col);
      px = qx; py = qy;
    }
    hbBox(nav.gtx * TILE - ox, nav.gty * TILE - oy, TILE, TILE, col);
    return true;
  };
  // A bird in the air is not on the ground route grid - it flies over
  // everything - but it does have a decided place to be: the perch it is
  // coming down on. Straight line and the same goal box, dotted the whole
  // way because the circuit it flies to get there is not surveyed.
  const perchLine = (a, col) => {
    if (a.flyT <= 0 || !a.perch) return;
    const gx = Math.round(a.perch.tx * TILE + 8 - ex), gy = Math.round(a.perch.ty * TILE + 8 - ey);
    hbLine(Math.round(a.x - ex), Math.round(a.y - a.alt - ey), gx, gy, col, 2);
    hbBox(a.perch.tx * TILE - ox, a.perch.ty * TILE - oy, TILE, TILE, col);
  };
  // one colour per kind of walker, as they read on the minimap: the slots
  // gold, a wolf red, the rest of the wildlife green, a worker bot blue
  for (const p of players) if (p.active && !p.dead && !inAir(p)) one(p, '#ffe27a');
  for (const a of animals) {
    if (a.dead) continue;
    if (a.kind === 'bird') perchLine(a, '#8ef0a0');
    else one(a, a.kind === 'wolf' ? '#ff6a6a' : '#8ef0a0');
  }
  for (const b of robots) if (!b.dead) one(b, '#7fc8ff');
  // fish steer and never route - there is no goal tile under a fish to box -
  // so they get the arrow instead, teal to sit apart from the walkers above
  for (const f of fish) hbArrow(f.x - ex, f.y - ey, f.a, 12, '#5fe0c8');
}

// ------------------------------------------------------------ cursor & aim line
// The pointer is drawn in-canvas (settings.pixelCursor) so it stays on the
// game's pixel grid at every zoom. cursorInfo() resolves what it should look
// like this frame, once, and both the pixel cursor and the browser-cursor
// fallback read from it:
//   kind  arrow | hand | grab | hammer | reticle
//   mode  (reticle only) idle | lock | hunt | fish | ice | bow
//   dim   the action under the pointer is currently blocked / out of reach
function cursorInfo() {
  if (state.mode === 'title') {
    const m = state.menu;
    if (m.panel === 'settings' && m.panelT >= 1 && !m.closing) {
      if (dragSlider) return { kind: 'grab' };
      return { kind: settingsHit() ? 'hand' : 'arrow' };
    }
    if (m.panel === 'name') return { kind: menuPanelReady() && namePanelHit() >= 0 ? 'hand' : 'arrow' };
    if (m.screen === 'gear') { const gh = m.gearT >= 1 ? gearScreenHit() : null; return { kind: gh && gh !== 'panel' ? 'hand' : 'arrow' }; }
    if (m.screen === 'select') return { kind: m.screenT >= 1 && m.gearT <= 0 && selectHit() >= 0 ? 'hand' : 'arrow' };
    if (!m.panel && (overNameTag() || overPatchTag())) return { kind: 'hand' }; // the two corner tags
    if (!m.panel) { const h = menuHit(); if (h >= 0 && !menuFrozen(h)) return { kind: 'hand' }; } // a frozen plank isn't a way in, so no hand
    return { kind: 'arrow' };
  }
  if (state.mode === 'dead') return { kind: deadHit() >= 0 || specHit() ? 'hand' : 'arrow' };
  if (state.mode !== 'play') return { kind: 'arrow' };
  if (state.settingsOpen) {
    if (dragSlider) return { kind: 'grab' };
    return { kind: settingsHit() ? 'hand' : 'arrow' };
  }
  if (state.mapOpen || state.paused) return { kind: 'arrow' };
  if (state.wheel) return { kind: wheelLayout().seg >= 0 ? 'hand' : 'arrow' };
  // an item riding the pointer hides the reticle entirely: the drag ghost IS
  // the cursor until it is put down somewhere
  if (state.drag) return { kind: 'grab' };
  // the backpack widget: a hand over anything in it that does something, a
  // plain arrow over the rest of its frame (which still swallows the click).
  // The weapon slots and an open bit column are the other left-draggable HUD.
  const bh = bagHit(mouse.x, mouse.y);
  if (gearHit(mouse.x, mouse.y) >= 0 || (bh && bh.kind !== 'frame')) return { kind: 'hand' };
  if (bh) return { kind: 'arrow' };
  if (bitColHit(mouse.x, mouse.y) >= 0) return { kind: 'hand' };
  if (abBuyHit(mouse.x, mouse.y) >= 0) return { kind: 'hand' };
  const sh = stripHit(mouse.x, mouse.y);
  if (sh && (sh.kind === 'slot' || sh.kind === 'ab' || sh.kind === 'food')) return { kind: 'hand' };
  if (sh) return { kind: 'arrow' };

  // Every reticle in play carries the tool's state, whatever it is hovering:
  // `nock` is how much of the cycle between shots has elapsed (1 = ready) and
  // `dry` says the button has nothing to answer with - an empty quiver, an
  // empty slot, or a tool with no bit light enough to throw. drawCursor turns
  // them into the ring's own behaviour, so the crosshair the eye is already on
  // is where the cooldown is read.
  const nockK = kitOf(player);
  const held = heldTool(player);
  const nockSpan = held ? toolRof(player, held) : nockK.nock;
  const nockF = player.nockT > 0 ? 1 - player.nockT / Math.max(0.01, nockSpan) : 1;
  const dry = player.quiver <= 0 || !toolReady(player);
  // `amb` rides along the same way: buried, settled, and the next arrow off
  // this string is the one worth AMBUSH_MUL
  const ret = (mode, dim, extra) =>
    Object.assign({ kind: 'reticle', mode, dim, nock: nockF, dry, amb: ambushReady(player) }, extra);

  const wx = mouseWX(), wy = mouseWY();
  const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
  const o = structOf(objAt(tx, ty));
  const busy = player.fallT > 0 || player.dodgeT > 0; // tools locked out
  // build sites (right-click) outrank tool hints; beyond the 60px reach they dim
  if (buildSiteAt(tx, ty) || (o && STRUCTS[o.type] && !o.building && o.team === player.team)) {
    const far = Math.hypot(tx * TILE + 8 - player.x, ty * TILE + 8 - player.y) > 60;
    return { kind: 'hammer', dim: far };
  }
  if (player.charging) {
    return ret('bow', false, { frac: Math.min(1, player.chargeT / nockK.bowCharge) });
  }
  // a living thing under the pointer: hunting reticle
  for (const q of players) {
    if (!enemyOf(player, q)) continue;
    if (Math.abs(wx - q.x) <= 8 && wy >= q.y - 14 && wy <= q.y + 4) {
      return ret('hunt', busy);
    }
  }
  for (const b of robots) {
    if (b.dead || b.team === player.team) continue;
    if (Math.abs(wx - b.x) <= 7 && wy >= b.y - 7 && wy <= b.y + 4) {
      return ret('hunt', busy);
    }
  }
  for (const a of animals) {
    const hw = a.kind === 'rabbit' ? 7 : a.kind === 'bird' ? 5 : a.kind === 'wolf' ? 9 : 13;
    const h = a.kind === 'rabbit' ? 11 : a.kind === 'bird' ? 7 : a.kind === 'wolf' ? 14 : 22;
    const by = a.y + 4 - (a.alt || 0); // birds ride their alt
    if (Math.abs(wx - a.x) <= hw && wy >= by - h && wy <= by) {
      return ret('hunt', busy);
    }
  }
  // a fish under the ice: water-blue ring (the bow spears it from point-blank)
  if (hoverFish()) return ret('fish', busy);
  // something E can work: lock ring (ice-blue over bare ice), dim out of reach
  const wt = workTarget(player);
  if (wt) return ret(wt.o ? 'lock' : 'ice', busy || !wt.near);
  return ret('idle', busy);
}

// sprite hotspots (the pixel that sits under the true mouse position)
const CUR_HOT = { arrow: [0, 0], hand: [4, 0], grab: [5, 4], hammer: [6, 5] };
// reticle looks: colour, tick gap from centre, corner dots
const RETICLE = {
  idle: { col: '#f4f7ff', gap: 3 },
  lock: { col: '#ffd95c', gap: 3, diag: true },
  hunt: { col: '#f2cc6a', gap: 4, diag: true },
  fish: { col: '#7ac0e8', gap: 4, diag: true },
  ice:  { col: '#a8e0f8', gap: 3, diag: true },
  bow:  { col: '#ffd95c', gap: 6, diag: true },
};
let lastCssCursor = null;

// browser-cursor fallback: hide the native pointer under the pixel cursor,
// otherwise mirror the resolved state with the nearest CSS cursor
function applyCursorStyle(info) {
  let css = 'none';
  if (!settings.pixelCursor) {
    css = info.kind === 'reticle' ? 'crosshair' : info.kind === 'grab' ? 'grabbing' :
      info.kind === 'arrow' ? 'default' : 'pointer';
  }
  if (css !== lastCssCursor) { canvas.style.cursor = css; lastCssCursor = css; }
}

// outlined pixel rects: every rect gets a dark rim first, then the fill, so
// touching ticks never eat each other's outline
function drawOutlinedRects(rects, col, alpha) {
  ctx.globalAlpha = alpha * 0.7;
  ctx.fillStyle = '#0a0e23';
  for (const r of rects) ctx.fillRect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col;
  for (const r of rects) ctx.fillRect(r[0], r[1], r[2], r[3]);
  ctx.globalAlpha = 1;
}

function drawCursor(info, now) {
  const mx = Math.round(mouse.x), my = Math.round(mouse.y);
  const base = info.dim ? 0.5 : 1;
  if (info.kind !== 'reticle') {
    const [hx, hy] = CUR_HOT[info.kind];
    ctx.globalAlpha = base * 0.45;
    ctx.drawImage(SPRITES.cursorShadow[info.kind], mx - hx + 1, my - hy + 1);
    ctx.globalAlpha = base;
    ctx.drawImage(SPRITES.cursor[info.kind], mx - hx, my - hy);
    ctx.globalAlpha = 1;
    return;
  }
  const R = RETICLE[info.mode];
  let gap = R.gap, col = R.col;
  if (info.mode === 'bow') {
    // the ring closes as the draw fills and goes hot at full, like the meter
    gap = Math.round(6 - 3 * info.frac);
    if (info.frac >= 1) col = '#ff9440';
  } else if (info.mode === 'hunt') {
    gap = 4 + (((now * 3) | 0) % 2); // slow breathing
  }
  const L = 3; // tick length
  const rects = [
    [mx - gap - L + 1, my, L, 1], [mx + gap, my, L, 1],
    [mx, my - gap - L + 1, 1, L], [mx, my + gap, 1, L],
  ];
  if (R.diag) { // corner dots one step outside the ring so they never fuse with the ticks
    const g = gap + 1;
    rects.push([mx - g, my - g, 1, 1], [mx + g, my - g, 1, 1], [mx - g, my + g, 1, 1], [mx + g, my + g, 1, 1]);
  }
  // The bow's own state, on top of whatever the pointer is over. An empty
  // quiver hollows the reticle out - the centre pixel, the one thing that says
  // "this shot happens here", is simply gone, and the ticks go slate. While the
  // renock runs, four corner marks fall inward from far out and land on the
  // ring at the moment the bow is ready; there is nothing left of them at rest,
  // so a ready bow is still the clean crosshair it has always been.
  const nock = info.nock === undefined ? 1 : info.nock;
  if (info.dry) col = '#8a97bd'; else rects.push([mx, my, 1, 1]);
  drawOutlinedRects(rects, col, base);
  if (nock < 1) {
    const g = gap + 2 + Math.round((1 - nock) * 6);
    drawOutlinedRects([
      [mx - g, my - g, 2, 1], [mx - g, my - g, 1, 2],
      [mx + g - 1, my - g, 2, 1], [mx + g, my - g, 1, 2],
      [mx - g, my + g, 2, 1], [mx - g, my + g - 1, 1, 2],
      [mx + g - 1, my + g, 2, 1], [mx + g, my + g - 1, 1, 2],
    ], info.dry ? '#8a97bd' : '#ffd95c', base * (0.35 + 0.55 * nock));
  }
  // Loosing from full cover: the crosshair grows a second segment out along
  // each of its own axes and the centre pixel warms to gold. Deliberately on
  // the cross, where the renock's marks are on the diagonals, so a bow that is
  // both reloading and buried says two separate things at once.
  if (info.amb && !info.dry) {
    const g2 = gap + L + 2;
    drawOutlinedRects([
      [mx - g2 - 1, my, 2, 1], [mx + g2, my, 2, 1],
      [mx, my - g2 - 1, 1, 2], [mx, my + g2, 1, 2],
    ], '#ffd95c', base);
    ctx.globalAlpha = base;
    ctx.fillStyle = '#ffd95c';
    ctx.fillRect(mx, my, 1, 1);
    ctx.globalAlpha = 1;
  }
}

// Dotted flight line while the tool is drawn: a static dotted line from the
// shot's spawn point through the cursor, exactly as far as the BIT that is up
// next would fly, stopping at the first solid tile if that bit is one a wall
// stops. A fish in bow-fishing reach gets a catch marker instead - that shot
// never flies.
//
// A bit that does not fly in a straight line gets NO line, because the only
// honest straight line for a boomerang or an orbit is none: what those do is
// shown by the shot itself the moment it leaves. A lob gets the first part of
// its flight, up to where it starts falling away from the bearing.
function drawAimLine(ex, ey, now) {
  if (!player.charging || state.mode !== 'play') return;
  const full = player.chargeT >= kitOf(player).bowCharge;
  const col = full ? '#ff9440' : '#ffd95c';
  const ftx = Math.floor(player.x / TILE), fty = Math.floor((player.y + 4) / TILE);
  if (inWorld(ftx, fty) && ground[idx(ftx, fty)] === 1) {
    let best = null, bd = FISH_CATCH_R;
    for (const f of fish) {
      if (!f.born) continue;
      const d = Math.hypot(f.x - player.x, f.y - player.y);
      if (d < bd) { bd = d; best = f; }
    }
    if (best) {
      // four ticks closing in over the fish
      const fx = Math.round(best.x - ex), fy = Math.round(best.y - ey);
      const g = 4 + Math.round(Math.abs(Math.sin(now * 4)) * 2);
      drawOutlinedRects([
        [fx - g - 2, fy, 3, 1], [fx + g, fy, 3, 1], [fx, fy - g - 2, 1, 3], [fx, fy + g, 1, 3],
      ], col, 0.95);
      return;
    }
  }
  // the bit that is up next, and the envelope its tool would fire it through
  const cell = heldTool(player);
  if (!cell) return;
  const bi = peekBit(cell);
  if (bi < 0) return;
  const bit = BITS[cell.bits[bi]];
  if (bit.path === 'boomer' || bit.path === 'orbit') return;
  const m = toolMods(cell);
  const range = bit.speed * m.spdMul * bit.life * m.lifeMul * (bit.path === 'lob' ? 0.35 : 0.85);
  const x0 = player.x, y0 = player.y - BOW_Y; // exactly emitBit()'s origin and direction
  const dx = mouseWX() - x0, dy = mouseWY() - y0;
  const d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
  // walk the flight: stop at the first solid tile (only for a bit a wall
  // stops) or the first animal the shot would hit (the arrow update's own
  // 8px body test)
  let len = range, blocked = null; // 'solid' | 'animal'
  for (let s = 10; s < range; s += 3) {
    const x = x0 + nx * s, y = y0 + ny * s;
    if (bit.solid !== false && isSolidTile(Math.floor(x / TILE), Math.floor(y / TILE))) { len = s; blocked = 'solid'; break; }
    let hit = false;
    for (const an of animals) if (animalHit(an, x, y)) { hit = true; break; }
    if (!hit) for (const q of players) {
      if (enemyOf(player, q) && Math.hypot(q.x - x, q.y - 6 - y) < 7) { hit = true; break; }
    }
    if (hit) { len = s; blocked = 'animal'; break; }
  }
  // static dots (no animation - it read as clutter), fading toward the end of the flight
  const sp = 6;
  for (let s = 13; s < len - 3; s += sp) {
    const a = 0.95 * (1 - (s / range) * 0.6);
    const sx = Math.round(x0 + nx * s - ex), sy = Math.round(y0 + ny * s - ey);
    ctx.globalAlpha = a * 0.6; ctx.fillStyle = '#0a0e23'; ctx.fillRect(sx + 1, sy + 1, 2, 2);
    ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;
  const tx1 = Math.round(x0 + nx * len - ex), ty1 = Math.round(y0 + ny * len - ey);
  if (blocked) {
    // impact cross where the shot lands: line colour on a solid, hunt amber on a body
    const r = [];
    for (let i = -2; i <= 2; i++) r.push([tx1 + i, ty1 + i, 1, 1], [tx1 + i, ty1 - i, 1, 1]);
    drawOutlinedRects(r, blocked === 'animal' ? RETICLE.hunt.col : col, 0.9);
  } else {
    // range cap: a short bar square to the flight line
    const r = [];
    for (let i = -2; i <= 2; i++) r.push([Math.round(tx1 - ny * i), Math.round(ty1 + nx * i), 1, 1]);
    drawOutlinedRects(r, col, 0.55);
  }
}

