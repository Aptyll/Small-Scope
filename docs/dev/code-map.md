# Where things live in the game code

The game code is ~12600 lines of flat top-level code across nineteen files sharing one global
scope ([architecture.md](architecture.md) has the file table and the load order), organized
inside each file only by banner comments of the form `// ------ name`. **Keep every banner
honest** — one that has drifted from what sits under it is worse than no banner, because it sends
future sessions to the wrong 600 lines. If a section grows past ~250 lines or picks up a second
responsibility, split it and add the new banner to its file's table below.

Grep the banner (`// ------ actions`) to jump; the function names are the durable anchors —
don't cite line numbers here, they go stale within a session. Sections follow index.html's load
order; the legacy `audio.js` row rides along because its dials get asked after constantly.

## js/audio.js (legacy IIFE)

| Looking for | Start at | Banner |
| --- | --- | --- |
| the songs, the sampled one-shots, the dials behind them | `SFX.music`, `TRACKS`, `SAMPLES`, `smp`, `trim`, `setAmbience` | its own IIFE — see [gameplay.md](gameplay.md#audio) |

## js/core.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the numbers with no one owner: the tile grid, the view, the day cycle | `TILE`, `WORLD`, `VIEW_W`/`VIEW_H`/`FULL_W`, `DAY_LEN`/`NIGHT_LEN`/`CYCLE` | `constants` |
| the economy: every gold payout in one table | `YIELD` | `constants` (`gainGold`, the one way it is paid: `players`, player.js) |
| tuning for one feature (the bow, the roll, prone, a wolf, a turret, a flag, a fish) | **not here** - each block sits above the code that reads it; find it in this file's per-file section | - |
| the one exception to that: `state` reads it at load, so it cannot live in a later file | `FISH_SPAWN_T` | `constants` (the rest of the shoal: `fish`, wildlife.js) |
| determinism: the seeded stream every world draw comes from | `mulberry32`, `SEED`, `rng` | `rng` (`hash2`/`vnoise`: `ground prerender`, draw-world.js; `treeRare`: `world`, world.js) |
| the singletons | `state`, `settings`, `perf` | `state` (`players`/`player` + the entity arrays: `players`, player.js) |
| settings persistence and the minimap-size helpers | `saveSettings`, `loadSettings`, `mmScale`, `applyMinimapSize` | `state` |
| `relayout()` — the resize pair's second half | `relayout` | `state` (`fitCanvas`: `canvas`, canvas.js — still the resize pair) |
| floaters, particles, drops, cost math | `addFloater`, `burst`, `spawnDrop`, `canAfford` | `helpers` |
| the gold flare and crack an ambush arrow lands with | `ambushFx`, the `crit` flag on `addDmgFloater` | `helpers` |

## js/canvas.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| resolution, pillarbox frame | `fitCanvas`, `renderBars` | `canvas` (`relayout`: `state`, core.js) |
| world zoom: the pixel-exact rung, the eased scale, the world view, the two coordinate bridges | `ZOOM_*`, `kWant`/`kMin`/`kMax`/`zoomWantOf`, `zoomCur`, `WV_W`/`WV_H`, `sizeWorldView`, `wToSX`/`wToSY`, `mouseWX`/`mouseWY` | `canvas` |
| panel + minimap layout anchors (`PANEL_*`, `SET_*`, `ROW_*`, `MM_*`) | assigned by `relayout()` (core.js) on every resize | `canvas` |

## js/player.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| slots, teams, champions + kits, hero levels, the input struct, contested orders | `Player`, `CHAMPS`, `kitOf`, `gainGold`, `levelUp`, `makeInput`, `initPlayers`, `contest` | `players` |
| the one on-the-spot gold payout every source uses (gold is never a drop) | `awardGold` | `players` (beside `gainGold`) |
| the numbers a slot is made of: the slot count and teams, walk/roll/slide speeds, hero levels, and the two bow baselines a kit is written against | `MAX_PLAYER_SLOTS`, `TEAM_COUNT`, `PVP`, `PLAYER_SPEED`/`PLAYER_R`, `ICE_MAX`/`SLIDE_MIN`/`SLIDE_EXIT`/`TRAIL_MIN`/`SNOW_TRAIL_*`, `LEVEL_*`/`LVL_*`, `DODGE_*`, `BOW_CHARGE`/`BOW_NOCK` | `players` (above `CHAMPS`, which reads four of them at load time) |
| the entity arrays and the local aliases | `animals`…`landmarks`, `players`, `player`, `inv` | `players` (the banner's tail) |
| the item table and the backpack model: count, room, add, take | `ITEMS`, `BAG_CAP`, `bagCount`, `bagUsed`, `bagRoom`, `bagAdd`, `bagTake` | `players` › `inventory` |
| the gear table, the effective kit, buying a piece level | `GEAR`, `GEAR_SLOTS`, `GEAR_COSTS`, `refreshKit`, `gearCost`, `buyGear` | `players` › `gear` |
| ability ranks and skill points | `AB_RANK_MAX`, `AB_SKILL`, `abCanBuy`, `buySkill` | `players` › `gear` |
| roguelike card effects and rarities, drawing 3 distinct options | `CARDS`, `CARD_RARITIES`, `cardKey`, `pick3Distinct` | `players` › `roguelike cards` |
| how hidden a slot is, and how far anything notices it from | `concealOf`, `seenAt`, `ambushReady` | `players` › `being seen` |
| death, the split between a respawn timer and permanent elimination, the team-level win check | `die`, `RESPAWN_TIME`, `updateRespawns`, `respawnPlayer`, `teamHasLivingKeep`, `teamInMatch`, `rivalTeamsInMatch`, `checkLastStanding`, `endMatch`, `endSnapshot` | `damage & death` |

## js/input.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| key/mouse handlers, the zoom wheel | `keys`, `mouse`, the `addEventListener` block, `sampleHumanInput` | `input` |

## js/world.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| worldgen, rivers, forest border | `genWorld`, `carveRiver`, `borderDepth`, `BORDER_MIN`/`BORDER_MAX` | `world` |
| what a kind of scenery **is** - solid, which tool, the E verb and lift, both map colours | `OBJECTS` | `world` (buildings carry the same `mm`/`map` pair: `STRUCTS`, structures.js) |
| the colour a tile's occupant paints on either map, over both tables | `objMapColor`, `treeMapPx`, `MM_UNKNOWN`, `MAP_TREE_*`/`MAP_BUSH_*` | `world` (its two readers: `updateMinimap` ui.js, `buildWorldMapImg` panels.js) |
| does this tile block a walker | `isSolidTile` | `world` (it reads `STRUCTS` then `OBJECTS`, and names no type) |
| is this tile a build site, and which menu does it get | `buildSiteAt`, `buildOptionsAt`, `netAt` | `world` (the two `*_ORDER` tables: `stump structures`, structures.js) |
| treasure chests: where they take their trees, and what one pays | `placeChests`, `CHEST_COUNT`/`CHEST_SPACING`/`CHEST_GOLD_*`/`CHEST_ODDS` | `world` (opening: `hitObject`'s chest branch, actions.js; sprite: `CHEST_SPR`, draw-world.js) |
| a named place: its data, where it goes, what lives in it | `LANDMARKS`, `placeLandmarks`, `landmarkAt`, `updateLandmarks` | `landmarks` |

## js/nav.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| entity movement and unit-vs-unit solidity | `moveEntity`, `separateUnits`, `UNIT_MASS` | `movement & collision` (the tile half, `isSolidTile`: `world`, world.js) |
| routes around obstacles: A*, the per-unit route follower, the stall/give-up signal | `findPath`, `walkable`, `navTo`, `navStep`, `navLineClear` | `pathfinding` |

## js/wildlife.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| wildlife behaviour: the shared lifecycle and the prey half | `updateAnimal`, `updatePrey`, `animalDies` | `animals` |
| the tuning for everything wild: the holes cut down to the fish, the shoal itself, the pack, the flock | `ICE_HOLE_HITS`, `HOLE_FALL_DMG`/`HOLE_FALL_T`, `FISH_CATCH_R`, `FISH_MAX`/`FISH_MIN`/`FISH_SPAWN_FAST`/`FISH_EMERGE_*`, `WOLF_*`, `BIRD_*` | `fish` (the ice and shoal half) and above `wolves` (the pack and the flock); `FISH_SPAWN_T` alone stays in core.js |
| an animal taking a hit from anything (arrow or roll): flee/wake, floater, knockback, kill credit | `hurtAnimal` | `animals` |
| where an animal walks next: the graze/patrol goal, and the bolt away from a player | `wanderGoal`, `preyWander`, `fleeGoal` | `animals` |
| the pack: waking the den, the hunt, the leash, the bite | `wakePack`, `updateWolf` | `wolves` |
| the flock: the flush, the circuit, the perch | `flushBirds`, `updateBird` | `birds` |
| fish shoal and ice holes | `updateFish`, `fishClear`, `fishWater`, `spawnFish` | `fish` |
| where new fish come from, and why one is invisible until it is under the ice | `spawnEmerger`, `buildEmergeSites`, `fishVis`, `f.born`/`f.vis`, `FISH_MAX`/`FISH_MIN`, `state.fishT` | `fish` |
| a fish net: the lure, the catch, handing the catch over, drawing it | `nearestNet`, `angDelta`, `updateStructures` (`net` branch, structures.js), `drawNet` (`entity draw`, draw-world.js), `NET_*` | `fish` |

## js/structures.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| build, upgrade, demolish, refunds, the one-Keep-per-team gate, the card craft queue | `placeStruct`, `startUpgrade`, `demolishStruct`, `cumulativeCost`, `teamHasLivingKeep`, `startCraft`, `rollCardRarity` | `stump structures` |
| every buildable: its tiers, costs, HP, footprint, and the two colours the maps paint it | `STRUCTS`, `STRUCT_ORDER`, `WATER_STRUCT_ORDER` | `stump structures` (scenery carries the same `mm`/`map` pair: `OBJECTS`, world.js) |
| the fish net's tuning: what it holds, what it lures, how fast it catches and hands over | `NET_CAP`, `NET_R`, `NET_LURE`, `NET_CATCH_T`, `NET_TAKE_T` | `stump structures` (beside `STRUCTS`, whose `net` entry it belongs to) |
| tuning: the turret's pivot and barrel, its lock window, its bolts | `TUR_PIVOT_Y`, `TUR_BARREL`, `TUR_LOCK`, `TUR_MZ`, `BOLT_SPD`, `BOLT_LIFE` | `the building sim` › `turret gunnery` |
| construction ticks, generators, the bay rolling a bot out, the Keep's craft | `updateStructures` | `the building sim` |
| turret targeting, traverse and firing | `turretPivot`, `turretMark`, `turretSees`, `turretMuzzle`, `fireBolt` | `the building sim` › `turret gunnery` |

## js/robots.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| tuning: what a worker swing hits for, how far a flag spreads, what counts as an enemy doorstep | `ROBOT_DMG`, `ROBOT_ATK_CD`, `ROBOT_REACH`, `ROBOT_AGGRO`, `ROBOT_LEASH`, `ROBOT_MAD`, `FLAG_BASE_R`, `FLAG_HARVEST_R`, `FLAG_SIEGE_R`, `FLAG_PATH_W` | `worker flags` |
| a bot leaving the bay's mouth, and the frame it spends deciding | `makeRobot`, `updateRobot` (`updateStructures` rolls them out: `the building sim`, structures.js) | `workers` |
| shooting a worker bot: its hitbox, its damage, its wreck, and who it is now angry at | `robotHit`, `hurtRobot`, `robotDies`, `b.mad` | `workers` |
| what a worker does this frame: the flag dispatch, the harvest tick, the melee | the tail of `updateRobot`, `engage`, `gather`, `holdAt` | `workers` |
| the worker flag: what a tile orders, planting/moving/lifting it, whose crew reads it | `FLAG_JOBS`, `FLAG_ATTACK`, `flagResolve`, `plantFlag`, `clearFlag`, `flagRecall`, `flagOf` | `worker flags` |
| the lane a PATH flag asks for, and who has already claimed a tile in it | `flagCorridor`, `flagPathTarget`, `objTaken` | `worker flags` |
| a worker's attack: who is a valid mark, where the axe lands, the blow itself | `robotFoeUnit`, `enemyStructNear`, `foeAlive`, `foePoint`, `robotStrike`, `ROBOT_*` | `worker flags` › `a worker's simple attack` |
| who can be ordered, and what the held press is aiming at right now | `hasWorkers`, `state.flagAim`, `flagTarget` | `worker flags` (its tail; `overHud`: `UI`, ui.js) |
| what a flag LOOKS like - all five draw functions | `drawFlagIcon`, `drawFlagPennant`, `drawFlag`, `drawFlagAim`, `drawFlagCursor` | not here: `entity draw` › `what a flag looks like`, draw-world.js |

## js/actions.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| what a click / E / space actually does | `clickAction`, `tryWork`, `workTarget`, `tryDodge`, `fireArrow`, `hitObject`, `crackIce` | `actions` |
| the tuning for everything a player does: the three tools, the quiver and its spent shafts, the arrow trail, E's reach, the roll, prone | `TOOLS`/`TOOL_*`, `BOW_Y`, `QUIVER_*`, `SHAFT_*`, `ARROW_*`, `WORK_REACH`, `STRUCT_HIT_DMG`, `ROLL_*`/`TACKLE_*`, `PRONE_*`, `AMBUSH_MUL` | `actions` (its head; the two kit baselines `BOW_CHARGE`/`BOW_NOCK`: `players`, player.js) |
| the roll as a hit: the sweep, the tackle, the stun every unit shares | `rollSweep`, `rollTackle`, `tackleObject`, `tackleObjAhead`, `rollPow`, `rollDmg`, `stunUnit` | `actions` › `the roll as a hit` |
| going to ground and getting back up | `tryProne`, `risePlayer` | `actions` › `prone` |
| the quiver: spending, fletching, sticking a spent arrow, the empty-press tell | `QUIVER_MAX`, `BOW_NOCK`, `SHAFT_LIFE`, `gainArrow`, `stickArrow`, `dryFire` | `actions` › `the quiver` |
| one blow against a building on another team (E swing and worker axe alike) | `hurtStruct`, `STRUCT_HIT_DMG`, `destroyStructure` | `actions` (its tail) |

## js/ai.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| what a bot slot decides to do this frame | `updateAI`, `aiLineClear`, `aiOpenSides` | `ai` |

## js/sim.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the frame sim: momentum, day/night, timers | `update`, `updatePlay`, `updatePlayer` | `update` |
| the zoom ease itself (runs first thing in `update`) | `applyZoom` | `update` |
| particles, floaters, footprints, drops, world-space snow flakes | `updateFx`, `makeFlake`, `fitFlakes` | `fx updates` |
| the belly-crawl drag furrow: emitted in `updatePlayer`, drawn as the `f.k === 3` branch | `footprints`, `p.trailD` | `update` (the draw branch: `render`, render.js) |

## js/draw-world.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| ground painting and runtime repaints | `paintGroundTile`, `renderGround`, `repaintGround`, `hash2`, `vnoise` | `ground prerender` |
| spent arrows lying in the snow and their pick-me-up marker | `shafts`, `drawShafts`, `SHAFT_PX` | `entity draw` |
| drawing players / animals / robots / held tool | `drawPlayer`, `drawGhost`, `drawHeldTool`, `drawAnimal`, `drawRobot` | `entity draw` |
| the landmark glyph both maps stamp | `drawLandmarkIcon` | `entity draw` › `the landmark glyph` (its `LANDMARKS` spec: `landmarks`, world.js) |
| what a worker flag looks like: the job glyph, the map pennant, the planted banner, and the held-press preview's two halves | `drawFlagIcon`, `drawFlagPennant`, `drawFlag`, `drawFlagAim`, `drawFlagCursor` | `entity draw` › `what a flag looks like` (what they read, `flagTarget`/`FLAG_JOBS`: `worker flags`, robots.js) |
| the snow over a buried body, its row spans, and the bury meter | `drawSnowCover`, `poseBounds`, `poseSpans`, `drawBuryRing` | `entity draw` |
| worn gear on the 16×16 sprite | `GEAR_MARKS`, `drawGearMarks` | `entity draw` |
| the stun tell: orbiting sparks, and the plate that carries them on a player's frame while it lasts | `drawStunStars`, the overhead block inside `drawPlayer` | `entity draw` |
| the overhead frame and the name over it: where the stack sits, and centring odd-width text on a model | `FRAME_DX`, `drawHealthBar`, `centreTextX` | `entity draw` |
| the turret's rotating gun, its bolts, its aim line and muzzle flash | `drawTurretHead`, `drawBolt`, `drawTurretFx`, `paintRimmed` | `entity draw` |
| darkness, warm glows, snow (world-space flakes, see `fx updates`), vignette | `renderLighting`, `drawWarmGlows`, `renderWeather` | `lighting & weather` |

## js/render.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| render pass order | `render` | `render` |
| the F3 readout: fps, coords, seed | `drawTags` | `render` |
| the `.` overlay: hitboxes, the model centre column, and its 1px ring/box/line rasterisers | `drawHitboxes`, `hbRing`, `hbBox`, `hbDot`, `hbLine`, `hbMid`, `HB_*` | `debug overlays` |
| the `.` overlay's routes: waypoints + goal tile, a bird's perch line, a fish's heading arrow | `drawNavPaths`, `hbArrow` | `debug overlays` |
| pointer state and the bow aim line | `cursorInfo`, `drawCursor`, `drawAimLine` | `cursor & aim line` |

## js/ui.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| radial menu geometry and hit math | `wheelSpan`, `wheelAng`, `wheelOptions`, `wheelLayout`, `resolveWheel` | `radial wheel` |
| brackets, the E prompt, the fish prompt, wheel pixels | `drawSelection`, `drawWorkHint`, `drawFishHint`, `renderWheel`, `drawWheelHub`, `drawWheelStick` | `selection, hints & wheel` |
| HUD and minimap | `renderUI`, `renderMinimap`, `updateMinimap` | `UI` (the disc's per-tile colour comes from `objMapColor(o, 'mm')`: `world`, world.js) |
| is the pointer over HUD that owns its own clicks, rather than over the world | `overHud` | `UI` (its callers are input.js's middle-button handlers and `flagTarget`, robots.js) |
| the backpack + gear widget (bottom-right): its frame, the icon row, the grid, the bottom strip (food + gold), the refusal flash | `BAG_CELL`/`BAG_GAP`/`BAG_PAD`/`BAG_STRIP`/`BAG_BG`/`BAG_WELL`, `bagFrameRect`, `bagRowRect`, `bagBtnRect`, `bagCellRect`, `bagStripRect`, `bagCellPlate`, `bagHit`, `bagClick`, `bagDenied`, `drawBag` | `UI` › `backpack and gear` |
| the pick-1-of-3 card draft: opening it, hit-testing a card, applying a pick, drawing it | `openDraft`, `draftLayout`, `draftHit`, `draftClick`, `renderDraft`, `state.draft` | `UI` › `backpack and gear` |
| the four gear cells of that row and their hit test | `gearRects`, `gearHit`, `drawGearCells` | `UI` › `the four gear cells` |
| the hud strip (bottom-centre): four ability slots over the xp bar, upgrade squares | `AB_CELL`/`hudStripRect`/`abHit`/`drawXpBar`/`drawHudStrip` | `UI` › `hud strip` |

## js/panels.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the TAB standings, the event feed | `logEvent`, `renderEventLog`, `scoreGroups`, `renderScoreboard` | `scoreboard & log` |
| the M map, and the chart point -> world tile inverse a map order needs | `buildMapPanel`, `buildWorldMapImg`, `renderWorldMap`, `mapTileAt` | `world map (M)` (the parchment's per-tile colour comes from `objMapColor(o, 'map', i, h)`: `world`, world.js) |
| the ESC menu | `buildSettingsPanel`, `settingsHit`, `renderSettings` | `settings menu (ESC)` |
| the three sound dials, the speaker that mutes them, the grey-when-muted fill | `applySliderDrag`, `muteBtnRect`, `drawMuteBtn`, `drawSliderRow` | `settings menu (ESC)` |
| the PLAYER panel: the name field, its validation, the two planks | `openNamePanel`, `nameKey`, `nameOk`, `nameCommit`, `nameDismiss`, `namePanelHit`, `renderNamePanel`, `buildNamePanel` | `player profile` |
| the profile name bottom-left of the title screen, and the slot that wears it | `nameTagRect`, `overNameTag`, `drawNameTag`, `applyProfileName` | `player profile` |

## js/menu.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the title screen: buttons, die, panels, champion select, play intro | `menuLayout`, `drawMenuButton`, `drawPillar`, `rerollWorld`, `renderSelect`, `lockIn`, `beginIntro`, `renderTitle` | `main menu` |
| the patch tag and its notes panel | `PATCH_TXT`, `PATCH_NOTES`, `buildPatchPanel`, `patchTagRect` | `main menu` |
| picking variants pre-match: the full-page picker | `gearLayout`, `gearScreenHit`, `pickGear`, `renderGear`, `drawGearCard` | `main menu` › `the gear screen` |

## js/screens.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the rolling four-second replay: the capture ring, its resolution, the `#replay` overlay | `replayTick`, `rpTarget`, `rpEnsure`, `replayShowing`, `layoutReplay`, `renderReplay`, `RP_*` | `replay` |
| the death/respawn overlay, spectating, back to the lobby, who the camera frames, the planks every ending shares | `DEAD_ITEMS`, `deadItems`, `endScreen`, `viewPlayer`, `specNext`, `toLobby`, `openDefeat`, `renderDead`, `deadLayout`, `deadReady`, `endSkip`, `drawEndPlanks` | `death & spectate` (`endMatch`/`endSnapshot`: `damage & death`, player.js) |
| the victory screen: its timeline, its sound cues, its art, and the passes both endings share | `WIN_T`, `winLayout`, `winCues`, `tallyCues`, `renderVictory`, `stampGrid`, `drawWinAurora`, `drawWinRays`, `drawWinMotes`, `drawWinBanner`, `drawBrazierIron`, `drawWinBrazier`, `drawWinDais`, `drawEndStatPlate`, `drawEndTally`, `drawEndGear` | `victory` |
| the defeat screen: the loss's own summary, on the same anchors | `DEF_T`, `DEF_STATS`, `defCues`, `renderDefeat`, `drawBlizzard`, `drawDefeatDrift`, `drawDeadBrazier` | `defeat` |

## js/boot.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the twin eagle rides, the wing seats, the jump window and its lock, the treeline-safe forced drop, free fall, landing, the flight bar and first-flight countdown, the dotted path, the zoomed-out view | `makeEagleRoute`, `lastOpenU`, `makeEagles`, `seatPos`, `beginDrop`, `dropJump`, `landPlayer`, `updateDrop`, `updateEagle`, `drawDropAir`, `drawEagle`, `renderDropUI` | `eagle drop` |
| the dive past the line's end, the tree-shattering impact, and the roosting objective: its wing-gust defense, its preen regen, and the driven-off ceremony that ends the match | `beginDive`, `findCrashPoint`, `eagleCrash`, `eagleBoomFx`, `eagleGust`, `eagleGustFx`, `hurtEagle`, `eagleFlee`, `eagleFleeResolve`, `teamEagleDown` | `eagle drop` |
| boot order, `DBG`, the rAF loop | `startGame`, `loop`, `window.DBG` | `boot` |
