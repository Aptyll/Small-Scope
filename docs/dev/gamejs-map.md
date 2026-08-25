# Where things live in game.js

`game.js` is one ~9800-line IIFE with no internal module boundaries, organized only by banner
comments of the form `// ------ name`. **Keep every banner honest** — one that has drifted from
what sits under it is worse than no banner, because it sends future sessions to the wrong 600
lines. If a section grows past ~250 lines or picks up a second responsibility, split it and add
the new banner to the table below.

Grep the banner (`// ------ actions`) to jump; the function names are the durable anchors —
don't cite line numbers here, they go stale within a session.

| Looking for | Start at | Banner |
| --- | --- | --- |
| tuning numbers (yields, reach, momentum caps, draw time) | `YIELD`, `WORK_REACH`, `ICE_MAX`, `BOW_CHARGE` | `constants` |
| the prone tuning block (crawl speed, bury time, sight cut, sniff floor, crit) | `PRONE_SPEED`, `PRONE_BURY`, `PRONE_CUT`, `PRONE_SNIFF`, `AMBUSH_MUL` | `constants` |
| resolution, pillarbox frame | `fitCanvas`, `relayout`, `renderBars` | `canvas` |
| world zoom: the pixel-exact rung, the eased scale, the world view, the two coordinate bridges | `ZOOM_*`, `kWant`/`kMin`/`kMax`/`zoomWantOf`, `zoomCur`, `WV_W`/`WV_H`, `sizeWorldView`, `wToSX`/`wToSY`, `mouseWX`/`mouseWY` | `canvas` |
| the zoom ease itself (runs first thing in `update`) | `applyZoom` | `update` |
| panel + minimap layout anchors (`PANEL_*`, `SET_*`, `ROW_*`, `MM_*`) | declared next to `relayout()` | `canvas` |
| determinism, per-tile stable rolls | `mulberry32`, `hash2`, `vnoise`, `treeRare` | `rng` |
| the singletons and entity arrays | `state`, `settings`, `players`, `player` | `state` |
| slots, teams, champions + kits, hero levels, the input struct, contested orders | `Player`, `CHAMPS`, `kitOf`, `gainGold`, `levelUp`, `makeInput`, `initPlayers`, `contest` | `players` |
| the gear table, the effective kit, buying a piece level | `GEAR`, `GEAR_SLOTS`, `GEAR_COSTS`, `refreshKit`, `gearCost`, `buyGear` | `players` › `gear` |
| how hidden a slot is, and how far anything notices it from | `concealOf`, `seenAt`, `ambushReady` | `players` › `being seen` |
| the gear HUD plates (bottom-right) and their hit test | `gearRects`, `gearHit`, `drawGearRow` | `UI` › `gear row` |
| picking variants pre-match: the full-page picker | `gearLayout`, `gearScreenHit`, `pickGear`, `renderGear`, `drawGearCard` | `main menu` › `the gear screen` |
| worn gear on the 16×16 sprite | `GEAR_MARKS`, `drawGearMarks` | `entity draw` |
| the F3 readout: fps, coords, seed | `drawTags` | `render` |
| the `.` hitbox overlay and its 1px ring/box rasterisers | `drawHitboxes`, `hbRing`, `hbBox`, `hbDot`, `HB_*` | `hitbox overlay` |
| key/mouse handlers, the zoom wheel | the `addEventListener` block, `sampleHumanInput` | `input` |
| worldgen, rivers, forest border | `genWorld`, `carveRiver`, `borderDepth` | `world` |
| ground painting and runtime repaints | `paintGroundTile`, `renderGround`, `repaintGround` | `ground prerender` |
| floaters, particles, drops, cost math | `addFloater`, `burst`, `spawnDrop`, `canAfford` | `helpers` |
| the gold flare and crack an ambush arrow lands with | `ambushFx`, the `crit` flag on `addDmgFloater` | `helpers` |
| tile collision, entity movement, unit-vs-unit solidity | `moveEntity`, `isSolidTile`, `separateUnits` | `movement & collision` |
| routes around obstacles: A*, the per-unit route follower, the stall/give-up signal | `findPath`, `walkable`, `navTo`, `navStep`, `navLineClear` | `pathfinding` |
| what a click / E / space actually does | `clickAction`, `tryWork`, `workTarget`, `tryDodge`, `fireArrow`, `hitObject`, `crackIce` | `actions` |
| going to ground and getting back up | `tryProne`, `risePlayer` | `actions` › `prone` |
| the quiver: spending, fletching, sticking a spent arrow, the empty-press tell | `QUIVER_MAX`, `BOW_NOCK`, `SHAFT_LIFE`, `gainArrow`, `stickArrow`, `dryFire` | `actions` › `the quiver` |
| spent arrows lying in the snow and their pick-me-up marker | `shafts`, `drawShafts`, `SHAFT_PX` | `entity draw` |
| the snow over a buried body, its row spans, and the bury meter | `drawSnowCover`, `poseBounds`, `poseSpans`, `drawBuryRing` | `entity draw` |
| the quiver strip (bottom-centre) and its pip glyph | `QUIVER_PIP`, `quiverRect`, `drawQuiverPip`, `drawQuiver` | `UI` › `quiver strip` |
| build, upgrade, demolish, refunds | `placeStruct`, `startUpgrade`, `demolishStruct`, `cumulativeCost` | `stump structures` |
| wildlife behaviour: prey, the wolf pack, the flock | `updateAnimal`, `updatePrey`, `updateWolf`, `updateBird`, `animalDies` | `animals` |
| fish shoal and ice holes | `updateFish`, `fishClear`, `spawnFish` | `fish` |
| a named place: its data, where it goes, what lives in it | `LANDMARKS`, `placeLandmarks`, `landmarkAt`, `updateLandmarks` | `landmarks` |
| construction ticks, generators, robot jobs | `updateStructures`, `updateRobot` | `structures & robots` |
| shooting a worker bot: its hitbox, its damage, its wreck | `robotHit`, `hurtRobot`, `robotDies` | `structures & robots` |
| radial menu geometry and hit math | `wheelSpan`, `wheelAng`, `wheelOptions`, `wheelLayout`, `resolveWheel` | `radial wheel` |
| what a bot slot decides to do this frame | `updateAI`, `aiLineClear`, `aiOpenSides` | `ai` |
| the frame sim: momentum, day/night, timers | `update`, `updatePlay`, `updatePlayer` | `update` |
| particles, floaters, footprints, drops, world-space snow flakes | `updateFx`, `makeFlake`, `fitFlakes` | `fx updates` |
| the belly-crawl drag furrow: emitted in `updatePlayer`, drawn as the `f.k === 3` branch | `footprints`, `p.trailD` | `update` / `render` |
| render pass order | `render` | `render` |
| pointer state and the bow aim line | `cursorInfo`, `drawCursor`, `drawAimLine` | `cursor & aim line` |
| drawing players / animals / robots / held tool | `drawPlayer`, `drawGhost`, `drawHeldTool`, `drawAnimal`, `drawRobot` | `entity draw` |
| the turret's rotating gun, its bolts, its aim line and muzzle flash | `drawTurretHead`, `drawBolt`, `drawTurretFx`, `paintRimmed` | `entity draw` |
| turret targeting, traverse and firing | `turretPivot`, `turretMark`, `turretSees`, `turretMuzzle`, `fireBolt` | `structures & robots` |
| brackets, the E prompt, the fish prompt, wheel pixels | `drawSelection`, `drawWorkHint`, `drawFishHint`, `renderWheel`, `drawWheelHub`, `drawWheelStick` | `selection, hints & wheel` |
| darkness, warm glows, snow (world-space flakes, see `fx updates`), vignette | `renderLighting`, `drawWarmGlows`, `renderWeather` | `lighting & weather` |
| the rolling four-second replay: the capture ring, its resolution, the `#replay` overlay | `replayTick`, `rpTarget`, `rpEnsure`, `replayShowing`, `layoutReplay`, `renderReplay`, `RP_*` | `replay` |
| HUD and minimap | `renderUI`, `renderMinimap`, `updateMinimap` | `UI` |
| the TAB standings, the event feed | `logEvent`, `renderEventLog`, `scoreGroups`, `renderScoreboard` | `scoreboard & log` |
| the M map | `buildMapPanel`, `buildWorldMapImg`, `renderWorldMap` | `world map (M)` |
| the ESC menu | `buildSettingsPanel`, `settingsHit`, `renderSettings` | `settings menu (ESC)` |
| the title screen: buttons, die, panels, champion select, play intro | `menuLayout`, `drawMenuButton`, `drawPillar`, `rerollWorld`, `renderSelect`, `lockIn`, `beginIntro`, `renderTitle` | `main menu` |
| the death overlay, spectating, back to the lobby, who the camera frames, the planks both endings share | `endMatch`, `viewPlayer`, `specNext`, `toLobby`, `renderDead`, `deadLayout`, `deadReady`, `drawEndPlanks` | `death & spectate` |
| the victory screen: its timeline, its frozen numbers, its sound cues, its art | `WIN_T`, `winLayout`, `winSnapshot`, `winCues`, `winSkip`, `renderVictory`, `stampGrid`, `drawWinAurora`, `drawWinRays`, `drawWinMotes`, `drawWinBanner`, `drawWinBrazier`, `drawWinDais`, `drawWinStatPlate` | `victory` |
| the eagle ride, jumping, free fall, landing, the drop chart, the zoomed-out view | `makeEagleRoute`, `beginDrop`, `dropJump`, `landPlayer`, `updateDrop`, `drawDropAir`, `renderDropUI` | `eagle drop` |
| boot order, `DBG`, the rAF loop | `startGame`, `loop`, `window.DBG` | `boot` |

