# Where things live in game.js

`game.js` is one ~6700-line IIFE with no internal module boundaries, organized only by banner
comments of the form `// ------ name`. **Keep every banner honest** — one that has drifted from
what sits under it is worse than no banner, because it sends future sessions to the wrong 600
lines. If a section grows past ~250 lines or picks up a second responsibility, split it and add
the new banner to the table below.

Grep the banner (`// ------ actions`) to jump; the function names are the durable anchors —
don't cite line numbers here, they go stale within a session.

| Looking for | Start at | Banner |
| --- | --- | --- |
| tuning numbers (yields, reach, momentum caps, draw time) | `YIELD`, `WORK_REACH`, `ICE_MAX`, `BOW_CHARGE` | `constants` |
| resolution, zoom, pillarbox frame | `fitCanvas`, `relayout`, `renderBars` | `canvas` |
| panel + minimap layout anchors (`PANEL_*`, `SET_*`, `ROW_*`, `MM_*`) | declared next to `relayout()` | `canvas` |
| determinism, per-tile stable rolls | `mulberry32`, `hash2`, `vnoise`, `treeRare` | `rng` |
| the singletons and entity arrays | `state`, `settings`, `players`, `player` | `state` |
| slots, teams, champions + kits, hero levels, the input struct, contested orders | `Player`, `CHAMPS`, `kitOf`, `gainGold`, `levelUp`, `makeInput`, `initPlayers`, `contest` | `players` |
| key/mouse handlers, the zoom wheel | the `addEventListener` block, `sampleHumanInput` | `input` |
| worldgen, rivers, forest border | `genWorld`, `carveRiver`, `borderDepth` | `world` |
| ground painting and runtime repaints | `paintGroundTile`, `renderGround`, `repaintGround` | `ground prerender` |
| floaters, particles, drops, cost math | `addFloater`, `burst`, `spawnDrop`, `canAfford` | `helpers` |
| tile collision, entity movement, unit-vs-unit solidity | `moveEntity`, `isSolidTile`, `separateUnits` | `movement & collision` |
| routes around obstacles: A*, the per-unit route follower, the stall/give-up signal | `findPath`, `walkable`, `navTo`, `navStep`, `navLineClear` | `pathfinding` |
| what a click / E / space actually does | `clickAction`, `tryWork`, `workTarget`, `tryDodge`, `fireArrow`, `hitObject`, `crackIce` | `actions` |
| build, upgrade, demolish, refunds | `placeStruct`, `startUpgrade`, `demolishStruct`, `cumulativeCost` | `stump structures` |
| wildlife behaviour: prey, the wolf pack, the flock | `updateAnimal`, `updatePrey`, `updateWolf`, `updateBird`, `animalDies` | `animals` |
| a named place: its data, where it goes, what lives in it | `LANDMARKS`, `placeLandmarks`, `landmarkAt`, `updateLandmarks` | `landmarks` |
| fish shoal and ice holes | `updateFish`, `fishClear`, `spawnFish` | `fish` |
| construction ticks, generators, robot jobs | `updateStructures`, `updateRobot` | `structures & robots` |
| radial menu hit math | `wheelLayout`, `resolveWheel` | `radial wheel` |
| what a bot slot decides to do this frame | `updateAI`, `aiLineClear`, `aiOpenSides` | `ai` |
| the frame sim: momentum, day/night, timers | `update`, `updatePlay`, `updatePlayer` | `update` |
| render pass order | `render` | `render` |
| pointer state and the bow aim line | `cursorInfo`, `drawCursor`, `drawAimLine` | `cursor & aim line` |
| drawing players / animals / robots / held tool | `drawPlayer`, `drawGhost`, `drawHeldTool`, `drawAnimal`, `drawRobot` | `entity draw` |
| brackets, the E prompt, the fish prompt, wheel pixels | `drawSelection`, `drawWorkHint`, `drawFishHint`, `renderWheel` | `selection, hints & wheel` |
| darkness, warm glows, snow (world-space flakes, see `fx updates`), vignette | `renderLighting`, `drawWarmGlows`, `renderWeather` | `lighting & weather` |
| HUD and minimap | `renderUI`, `renderMinimap`, `updateMinimap` | `UI` |
| the TAB standings, the event feed | `logEvent`, `renderEventLog`, `scoreGroups`, `renderScoreboard` | `scoreboard & log` |
| the M map | `buildMapPanel`, `buildWorldMapImg`, `renderWorldMap` | `world map (M)` |
| the ESC menu | `buildSettingsPanel`, `settingsHit`, `renderSettings` | `settings menu (ESC)` |
| the title screen: buttons, die, panels, champion select, play intro | `menuLayout`, `drawMenuButton`, `drawPillar`, `rerollWorld`, `renderSelect`, `lockIn`, `beginIntro`, `renderTitle` | `main menu` |
| the death / win overlay, spectating, back to the lobby, who the camera frames | `endMatch`, `viewPlayer`, `specNext`, `toLobby`, `renderDead` | `death & spectate` |
| the eagle ride, jumping, free fall, landing, the drop chart, the zoomed-out view | `makeEagleRoute`, `beginDrop`, `dropJump`, `landPlayer`, `updateDrop`, `drawDropAir`, `renderDropUI` | `eagle drop` |
| boot order, `DBG`, the rAF loop | `startGame`, `loop`, `window.DBG` | `boot` |

