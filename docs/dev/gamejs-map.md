# Where things live in game.js

> **Split in progress** ([split-plan.md](split-plan.md)) — game.js is being cut into eighteen
> files, one or two per commit. **The File column says where each banner lives NOW**; a row
> with no note in that cell lives entirely in the named file.

The game code is ~12600 lines of flat top-level code — eleven files so far (core, canvas,
player, input, world, nav, wildlife, structures, actions, ai, sim), the rest still [js/game.js](../../js/game.js) (~7000 lines) — with no internal module boundaries, organized
only by banner comments of the form `// ------ name`. **Keep every banner honest** — one that has drifted from
what sits under it is worse than no banner, because it sends future sessions to the wrong 600
lines. If a section grows past ~250 lines or picks up a second responsibility, split it and add
the new banner to the table below.

Grep the banner (`// ------ actions`) to jump; the function names are the durable anchors —
don't cite line numbers here, they go stale within a session.

| Looking for | Start at | Banner | File |
| --- | --- | --- | --- |
| tuning numbers (yields, reach, momentum caps, draw time) | `YIELD`, `WORK_REACH`, `ICE_MAX`, `BOW_CHARGE` | `constants` | core.js |
| the prone tuning block (crawl speed, bury time, sight cut, sniff floor, crit) | `PRONE_SPEED`, `PRONE_BURY`, `PRONE_CUT`, `PRONE_SNIFF`, `AMBUSH_MUL` | `constants` | core.js |
| what a roll hits for, how long it stuns, and when a wall becomes a tackle | `ROLL_HIT_R`, `ROLL_FAST`, `ROLL_DMG`, `ROLL_STUN`, `TACKLE_STUN`, `TACKLE_SELF`, `TACKLE_MIN` | `constants` | core.js |
| resolution, pillarbox frame | `fitCanvas`, `relayout`, `renderBars` | `canvas` (`relayout`: `state` — still the resize pair) | canvas.js (`relayout`: core.js) |
| world zoom: the pixel-exact rung, the eased scale, the world view, the two coordinate bridges | `ZOOM_*`, `kWant`/`kMin`/`kMax`/`zoomWantOf`, `zoomCur`, `WV_W`/`WV_H`, `sizeWorldView`, `wToSX`/`wToSY`, `mouseWX`/`mouseWY` | `canvas` | canvas.js |
| the zoom ease itself (runs first thing in `update`) | `applyZoom` | `update` | sim.js |
| panel + minimap layout anchors (`PANEL_*`, `SET_*`, `ROW_*`, `MM_*`) | assigned by `relayout()` (core.js) on every resize | `canvas` | canvas.js |
| determinism, per-tile stable rolls | `mulberry32`, `hash2`, `vnoise`, `treeRare` | `rng` (`hash2`/`vnoise`: `ground prerender`; `treeRare`: `world`) | core.js (`hash2`/`vnoise`: game.js; `treeRare`: world.js) |
| the singletons and entity arrays | `state`, `settings`, `players`, `player` | `state` (`players`/`player` + the entity arrays: `players`) | core.js (`players`/`player` + the arrays: player.js) |
| slots, teams, champions + kits, hero levels, the input struct, contested orders | `Player`, `CHAMPS`, `kitOf`, `gainGold`, `levelUp`, `makeInput`, `initPlayers`, `contest` | `players` | player.js |
| the item table and the backpack model: count, room, add, take | `ITEMS`, `BAG_CAP`, `bagCount`, `bagUsed`, `bagRoom`, `bagAdd`, `bagTake` | `players` › `inventory` | player.js |
| the gear table, the effective kit, buying a piece level | `GEAR`, `GEAR_SLOTS`, `GEAR_COSTS`, `refreshKit`, `gearCost`, `buyGear` | `players` › `gear` | player.js |
| ability ranks and skill points | `AB_RANK_MAX`, `AB_SKILL`, `abCanBuy`, `buySkill` | `players` › `gear` | player.js |
| roguelike card effects and rarities, drawing 3 distinct options | `CARDS`, `CARD_RARITIES`, `cardKey`, `pick3Distinct` | `players` › `roguelike cards` | player.js |
| death, the split between a respawn timer and permanent elimination, the team-level win check | `die`, `RESPAWN_TIME`, `updateRespawns`, `respawnPlayer`, `teamHasLivingKeep`, `teamInMatch`, `rivalTeamsInMatch`, `checkLastStanding` | `damage & death` (was under `radial wheel`) | player.js |
| how hidden a slot is, and how far anything notices it from | `concealOf`, `seenAt`, `ambushReady` | `players` › `being seen` | player.js |
| the backpack + gear widget (bottom-right): its frame, the icon row, the grid, the bottom strip (food + gold), the refusal flash | `BAG_CELL`/`BAG_GAP`/`BAG_PAD`/`BAG_STRIP`/`BAG_BG`/`BAG_WELL`, `bagFrameRect`, `bagRowRect`, `bagBtnRect`, `bagCellRect`, `bagStripRect`, `bagCellPlate`, `bagHit`, `bagClick`, `bagDenied`, `drawBag` | `UI` › `backpack and gear` | game.js |
| the pick-1-of-3 card draft: opening it, hit-testing a card, applying a pick, drawing it | `openDraft`, `draftLayout`, `draftHit`, `draftClick`, `renderDraft`, `state.draft` | `UI` › `backpack and gear` | game.js |
| the four gear cells of that row and their hit test | `gearRects`, `gearHit`, `drawGearCells` | `UI` › `the four gear cells` | game.js |
| picking variants pre-match: the full-page picker | `gearLayout`, `gearScreenHit`, `pickGear`, `renderGear`, `drawGearCard` | `main menu` › `the gear screen` | game.js |
| worn gear on the 16×16 sprite | `GEAR_MARKS`, `drawGearMarks` | `entity draw` | game.js |
| the F3 readout: fps, coords, seed | `drawTags` | `render` | game.js |
| the `.` overlay: hitboxes, the model centre column, and its 1px ring/box/line rasterisers | `drawHitboxes`, `hbRing`, `hbBox`, `hbDot`, `hbLine`, `hbMid`, `HB_*` | `debug overlays` | game.js |
| the `.` overlay's routes: waypoints + goal tile, a bird's perch line, a fish's heading arrow | `drawNavPaths`, `hbArrow` | `debug overlays` | game.js |
| key/mouse handlers, the zoom wheel | the `addEventListener` block, `sampleHumanInput` | `input` | input.js |
| worldgen, rivers, forest border | `genWorld`, `carveRiver`, `borderDepth` | `world` | world.js |
| ground painting and runtime repaints | `paintGroundTile`, `renderGround`, `repaintGround` | `ground prerender` | game.js |
| floaters, particles, drops, cost math | `addFloater`, `burst`, `spawnDrop`, `canAfford` | `helpers` | core.js |
| the gold flare and crack an ambush arrow lands with | `ambushFx`, the `crit` flag on `addDmgFloater` | `helpers` | core.js |
| tile collision, entity movement, unit-vs-unit solidity | `moveEntity`, `isSolidTile`, `separateUnits` | `movement & collision` | nav.js |
| routes around obstacles: A*, the per-unit route follower, the stall/give-up signal | `findPath`, `walkable`, `navTo`, `navStep`, `navLineClear` | `pathfinding` | nav.js |
| what a click / E / space actually does | `clickAction`, `tryWork`, `workTarget`, `tryDodge`, `fireArrow`, `hitObject`, `crackIce` | `actions` | actions.js |
| the roll as a hit: the sweep, the tackle, the stun every unit shares | `rollSweep`, `rollTackle`, `tackleObject`, `tackleObjAhead`, `rollPow`, `rollDmg`, `stunUnit` | `actions` › `the roll as a hit` | actions.js |
| going to ground and getting back up | `tryProne`, `risePlayer` | `actions` › `prone` | actions.js |
| the quiver: spending, fletching, sticking a spent arrow, the empty-press tell | `QUIVER_MAX`, `BOW_NOCK`, `SHAFT_LIFE`, `gainArrow`, `stickArrow`, `dryFire` | `actions` › `the quiver` | actions.js |
| spent arrows lying in the snow and their pick-me-up marker | `shafts`, `drawShafts`, `SHAFT_PX` | `entity draw` | game.js |
| the snow over a buried body, its row spans, and the bury meter | `drawSnowCover`, `poseBounds`, `poseSpans`, `drawBuryRing` | `entity draw` | game.js |
| the hud strip (bottom-centre): four ability slots over the xp bar, upgrade squares | `AB_CELL`/`hudStripRect`/`abHit`/`drawXpBar`/`drawHudStrip` | `UI` › `hud strip` | game.js |
| build, upgrade, demolish, refunds, the one-Keep-per-team gate, the card craft queue | `placeStruct`, `startUpgrade`, `demolishStruct`, `cumulativeCost`, `teamHasLivingKeep`, `startCraft`, `rollCardRarity` | `stump structures` | structures.js |
| wildlife behaviour: the shared lifecycle and the prey half | `updateAnimal`, `updatePrey`, `animalDies` | `animals` | wildlife.js |
| the pack: waking the den, the hunt, the leash, the bite | `wakePack`, `updateWolf` | `wolves` (was under `fish`) | wildlife.js |
| the flock: the flush, the circuit, the perch | `flushBirds`, `updateBird` | `birds` (was under `fish`) | wildlife.js |
| an animal taking a hit from anything (arrow or roll): flee/wake, floater, knockback, kill credit | `hurtAnimal` | `animals` | wildlife.js |
| where an animal walks next: the graze/patrol goal, and the bolt away from a player | `wanderGoal`, `preyWander`, `fleeGoal` | `animals` | wildlife.js |
| fish shoal and ice holes | `updateFish`, `fishClear`, `fishWater`, `spawnFish` | `fish` | wildlife.js |
| where new fish come from, and why one is invisible until it is under the ice | `spawnEmerger`, `buildEmergeSites`, `fishVis`, `f.born`/`f.vis`, `FISH_MAX`/`FISH_MIN`, `state.fishT` | `fish` | wildlife.js |
| a fish net: the lure, the catch, handing the catch over, drawing it | `nearestNet`, `angDelta`, `updateStructures` (`net` branch), `drawNet`, `NET_*` | `fish` / `structures & robots` / `entity draw` | wildlife.js / structures.js (`drawNet`: game.js) |
| is this tile a build site, and which menu does it get | `buildSiteAt`, `buildOptionsAt`, `netAt`, `STRUCT_ORDER`, `WATER_STRUCT_ORDER` | `world` (the two `*_ORDER` tables: `constants`) | world.js (tables: core.js) |
| a named place: its data, where it goes, what lives in it | `LANDMARKS`, `placeLandmarks`, `landmarkAt`, `updateLandmarks` | `landmarks` | world.js |
| construction ticks, generators, robot jobs | `updateStructures`, `updateRobot` | `structures & robots` | structures.js |
| shooting a worker bot: its hitbox, its damage, its wreck, and who it is now angry at | `robotHit`, `hurtRobot`, `robotDies`, `b.mad` | `structures & robots` | structures.js |
| what a worker does this frame: the flag dispatch, the harvest tick, the melee | the tail of `updateRobot`, `engage`, `gather`, `holdAt` | `structures & robots` | structures.js |
| one blow against a building on another team (E swing and worker axe alike) | `hurtStruct`, `STRUCT_HIT_DMG` | `actions` (its tail, beside `destroyStructure`) | actions.js |
| the worker flag: what a tile orders, planting/moving/lifting it, whose crew reads it | `FLAG_JOBS`, `FLAG_ATTACK`, `flagResolve`, `plantFlag`, `clearFlag`, `flagRecall`, `flagOf` | `worker flags` | structures.js |
| the lane a PATH flag asks for, and who has already claimed a tile in it | `flagCorridor`, `flagPathTarget`, `objTaken` | `worker flags` | structures.js |
| a worker's attack: who is a valid mark, where the axe lands, the blow itself | `robotFoeUnit`, `enemyStructNear`, `foeAlive`, `foePoint`, `robotStrike`, `ROBOT_*` | `worker flags` | structures.js |
| drawing a flag: the job glyph, the map pennant, the planted banner | `drawFlagIcon`, `drawFlagPennant`, `drawFlag`, `FLAG_MINE`/`FLAG_FOE` | `worker flags` | structures.js |
| the held-press preview: what it is aiming at, the tile brackets, the pointer glyph | `state.flagAim`, `flagTarget`, `drawFlagAim`, `drawFlagCursor`, `hasWorkers`, `overHud` | `worker flags` | structures.js |
| tuning: what a worker swing hits for, how far a flag spreads, what counts as an enemy doorstep | `ROBOT_DMG`, `ROBOT_ATK_CD`, `ROBOT_REACH`, `ROBOT_AGGRO`, `ROBOT_LEASH`, `ROBOT_MAD`, `FLAG_BASE_R`, `FLAG_HARVEST_R`, `FLAG_SIEGE_R`, `FLAG_PATH_W` | `constants` | core.js |
| radial menu geometry and hit math | `wheelSpan`, `wheelAng`, `wheelOptions`, `wheelLayout`, `resolveWheel` | `radial wheel` | game.js |
| what a bot slot decides to do this frame | `updateAI`, `aiLineClear`, `aiOpenSides` | `ai` | ai.js |
| the frame sim: momentum, day/night, timers | `update`, `updatePlay`, `updatePlayer` | `update` | sim.js |
| particles, floaters, footprints, drops, world-space snow flakes | `updateFx`, `makeFlake`, `fitFlakes` | `fx updates` | sim.js |
| the belly-crawl drag furrow: emitted in `updatePlayer`, drawn as the `f.k === 3` branch | `footprints`, `p.trailD` | `update` / `render` | sim.js / game.js |
| render pass order | `render` | `render` | game.js |
| pointer state and the bow aim line | `cursorInfo`, `drawCursor`, `drawAimLine` | `cursor & aim line` | game.js |
| drawing players / animals / robots / held tool | `drawPlayer`, `drawGhost`, `drawHeldTool`, `drawAnimal`, `drawRobot` | `entity draw` | game.js |
| the stun tell: orbiting sparks, and the plate that carries them on a player's frame while it lasts | `drawStunStars`, the overhead block inside `drawPlayer` | `entity draw` | game.js |
| the overhead frame and the name over it: where the stack sits, and centring odd-width text on a model | `FRAME_DX`, `drawHealthBar`, `centreTextX` | `entity draw` | game.js |
| the turret's rotating gun, its bolts, its aim line and muzzle flash | `drawTurretHead`, `drawBolt`, `drawTurretFx`, `paintRimmed` | `entity draw` | game.js |
| turret targeting, traverse and firing | `turretPivot`, `turretMark`, `turretSees`, `turretMuzzle`, `fireBolt` | `structures & robots` | structures.js |
| brackets, the E prompt, the fish prompt, wheel pixels | `drawSelection`, `drawWorkHint`, `drawFishHint`, `renderWheel`, `drawWheelHub`, `drawWheelStick` | `selection, hints & wheel` | game.js |
| darkness, warm glows, snow (world-space flakes, see `fx updates`), vignette | `renderLighting`, `drawWarmGlows`, `renderWeather` | `lighting & weather` | game.js |
| the rolling four-second replay: the capture ring, its resolution, the `#replay` overlay | `replayTick`, `rpTarget`, `rpEnsure`, `replayShowing`, `layoutReplay`, `renderReplay`, `RP_*` | `replay` | game.js |
| HUD and minimap | `renderUI`, `renderMinimap`, `updateMinimap` | `UI` | game.js |
| the TAB standings, the event feed | `logEvent`, `renderEventLog`, `scoreGroups`, `renderScoreboard` | `scoreboard & log` | game.js |
| the M map, and the chart point -> world tile inverse a map order needs | `buildMapPanel`, `buildWorldMapImg`, `renderWorldMap`, `mapTileAt` | `world map (M)` | game.js |
| the ESC menu | `buildSettingsPanel`, `settingsHit`, `renderSettings` | `settings menu (ESC)` | game.js |
| the PLAYER panel: the name field, its validation, the two planks | `openNamePanel`, `nameKey`, `nameOk`, `nameCommit`, `nameDismiss`, `namePanelHit`, `renderNamePanel`, `buildNamePanel` | `player profile` | game.js |
| the profile name bottom-left of the title screen, and the slot that wears it | `nameTagRect`, `overNameTag`, `drawNameTag`, `applyProfileName` | `player profile` | game.js |
| the three sound dials, the speaker that mutes them, the grey-when-muted fill | `applySliderDrag`, `muteBtnRect`, `drawMuteBtn`, `drawSliderRow` | `settings menu (ESC)` | game.js |
| the songs, the sampled one-shots, the dials behind them | `SFX.music`, `TRACKS`, `SAMPLES`, `smp`, `trim`, `setAmbience` | [js/audio.js](../../js/audio.js) | audio.js |
| the title screen: buttons, die, panels, champion select, play intro | `menuLayout`, `drawMenuButton`, `drawPillar`, `rerollWorld`, `renderSelect`, `lockIn`, `beginIntro`, `renderTitle` | `main menu` | game.js |
| the death/respawn overlay, spectating, back to the lobby, who the camera frames, what an ending freezes, the planks every ending shares | `endMatch`, `endSnapshot`, `DEAD_ITEMS`, `deadItems`, `endScreen`, `viewPlayer`, `specNext`, `toLobby`, `openDefeat`, `renderDead`, `deadLayout`, `deadReady`, `endSkip`, `drawEndPlanks` | `death & spectate` (`endMatch`/`endSnapshot`: `damage & death`, player.js) | game.js |
| the victory screen: its timeline, its sound cues, its art, and the passes both endings share | `WIN_T`, `winLayout`, `winCues`, `tallyCues`, `renderVictory`, `stampGrid`, `drawWinAurora`, `drawWinRays`, `drawWinMotes`, `drawWinBanner`, `drawBrazierIron`, `drawWinBrazier`, `drawWinDais`, `drawEndStatPlate`, `drawEndTally`, `drawEndGear` | `victory` | game.js |
| the defeat screen: the loss's own summary, on the same anchors | `DEF_T`, `DEF_STATS`, `defCues`, `renderDefeat`, `drawBlizzard`, `drawDefeatDrift`, `drawDeadBrazier` | `defeat` | game.js |
| the eagle ride, jumping, free fall, landing, the drop chart, the zoomed-out view | `makeEagleRoute`, `beginDrop`, `dropJump`, `landPlayer`, `updateDrop`, `drawDropAir`, `renderDropUI` | `eagle drop` | game.js |
| boot order, `DBG`, the rAF loop | `startGame`, `loop`, `window.DBG` | `boot` | game.js |

