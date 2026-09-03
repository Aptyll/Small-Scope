# Where things live in the game code

The game code is ~14000 lines of flat top-level code across twenty-two files sharing one global
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
| food: the 1.5 s meal, the 3 s clock berries and fish share, and every way one is broken | `FOOD_CD`/`FOOD_EAT`/`FOOD_SLOW`/`FOOD_FX_T`, `startEat`, `eatBerry`/`eatFish`, `updateEat`, `breakEat` | `helpers` › `food` (the heal numbers: `ITEMS[type].heal`, `players`, player.js; the wells that draw the clock: `drawFoodClock`, ui.js) |
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
| slots, teams, classes + kits, hero levels, the input struct, contested orders | `Player`, `CLASSES`, `kitOf`, `gainGold`, `levelUp`, `makeInput`, `initPlayers`, `contest` | `players` |
| the one on-the-spot gold payout every source uses (gold is never a drop) | `awardGold` | `players` (beside `gainGold`) |
| the numbers a slot is made of: the slot count and teams, walk/roll/slide speeds, hero levels, and the two bow baselines a kit is written against | `MAX_PLAYER_SLOTS`, `TEAM_COUNT`, `PVP`, `PLAYER_SPEED`/`PLAYER_R`, `ICE_MAX`/`SLIDE_MIN`/`SLIDE_EXIT`/`TRAIL_MIN`/`SNOW_TRAIL_*`, `LEVEL_*`/`LVL_*`, `DODGE_*`, `BOW_CHARGE`/`BOW_NOCK` | `players` (above `CHAMPS`, which reads four of them at load time) |
| the entity arrays and the local aliases | `animals`…`landmarks`, `players`, `player`, `inv` | `players` (the banner's tail) |
| the item table and the backpack model: count, room, add, take, and putting an instanced cell (a loaded tool) in whole | `ITEMS`, `BAG_CAP`, `bagCount`, `bagUsed`, `bagRoom`, `bagAdd`, `bagTake`, `bagPut` | `players` › `inventory` (the tool and bit rows register themselves from tools.js) |
| the gear table, the effective kit, buying a piece level | `GEAR`, `GEAR_SLOTS`, `GEAR_COSTS`, `baseKit`, `refreshKit`, `gearCost`, `buyGear` | `players` › `gear` |
| skill points (one per hero level, spent on class-ability levels) | `p.skillPts` (spent by `buyAbilityLv`, abilities.js) | `players` (granted in `levelUp`) |
| roguelike card effects and rarities, drawing 3 distinct options | `CARDS`, `CARD_RARITIES`, `cardKey`, `pick3Distinct` | `players` › `roguelike cards` |
| how hidden a slot is, and how far anything notices it from | `concealOf`, `seenAt`, `ambushReady` | `players` › `being seen` |
| death, the wait for the bird and the return at it, the one permanent path (a driven-off eagle), the team-level win check | `die`, `RESPAWN_TIME`/`RESPAWN_LV`/`RESPAWN_MIN`/`RESPAWN_MAX`, `respawnTime`, `updateRespawns`, `RESPAWN_OUT`, `respawnPlayer`, `teamInMatch`, `rivalTeamsInMatch`, `checkLastStanding`, `endMatch`, `endSnapshot` | `damage & death` (`teamEagleDown`: `eagle drop`, boot.js) |
| practice undoing a death on the spot | `practiceRevive` (die()'s first branch under `PRACTICE`) | `damage & death` |

## js/input.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| key/mouse handlers, the zoom wheel | `keys`, `mouse`, the `addEventListener` block, `sampleHumanInput` | `input` |

## js/world.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| worldgen, rivers, forest border and the two roost corners' guaranteed woods | `genWorld`, `carveRiver`, `borderNoise` (the seed's own border), `borderDepth` (that or the roost disc - what everything reads), `BORDER_MIN`/`BORDER_MAX`, `ROOST_R`/`ROOST_WOBBLE` | `world` |
| what a kind of scenery **is** - solid, which tool, the E verb and lift, both map colours | `OBJECTS` | `world` (buildings carry the same `mm`/`map` pair: `STRUCTS`, structures.js) |
| the colour a tile's occupant paints on either map, over both tables | `objMapColor`, `treeMapPx`, `MM_UNKNOWN`, `MAP_TREE_*`/`MAP_BUSH_*` | `world` (its two readers: `updateMinimap` ui.js, `buildWorldMapImg` panels.js) |
| a picked bush's regrow clock, the frame the bush wears at each stage of it, and the bar a hover shows over it | `BUSH_REGROW`/`BUSH_BUD_T`/`BUSH_RIPEN_T` | `world` (the pick: `hitObject`'s bush branch, actions.js; the tick: the object-timers loop, sim.js; the frame and the hover bar: the bush branch of `render()` off `hovO`, render.js; the grids: `bush`/`bushEmpty`/`bushBud`/`bushRipen`, sprites.js) |
| does this tile block a walker | `isSolidTile` | `world` (it reads `STRUCTS` then `OBJECTS`, and names no type) |
| is this tile a build site, and which menu does it get | `buildSiteAt`, `buildOptionsAt`, `netAt` | `world` (the two `*_ORDER` tables: `stump structures`, structures.js) |
| what a pine takes to fell, everywhere one is planted (the border, the practice forest, the regrowth) | `TREE_HP` (above `treeRare`) | `world` (what the fell pays: `YIELD`, core.js) |
| treasure chests: where they take their trees, and what one pays | `placeChests`, `CHEST_COUNT`/`CHEST_SPACING`/`CHEST_GOLD_*`/`CHEST_ODDS` | `world` (opening: `hitObject`'s chest branch, actions.js; sprite: `CHEST_SPR`, draw-world.js) |
| a named place: its data, where it goes, what lives in it, the top-up clock a hovered den wears | `LANDMARKS`, `placeLandmarks`, `landmarkAt`, `landmarkPop`, `updateLandmarks` (`L.repopT`; the den's `site`) | `landmarks` (the hover bar: the den branch of `render()` off `hovO`, render.js) |
| the practice arena: its gen, the dummy's numbers, the grounds' clock | `PRACTICE` (core.js, above `WORLD` — practice worlds are 76 tiles), `genPracticeWorld`, `PR_W`/`PR_H`/`PR_SPAWN`, `DUMMY_HP`/`DUMMY_WORK_DMG`/`DUMMY_RESET_T`, `practiceDummies`, `updatePractice` | `practice arena` (the hits: `hitDummy`, actions.js; sprite: `DUMMY_SPR`, draw-world.js) |
| the archery targets: the perimeter track, the two lanes and the hop, the three habits, the shared face geometry, a hit, its scoring/respawn and the consecutive-hit run | `ptargets`, `addPTarget`, `agPos`, `agEdge`, `AG_RECT`/`AG_INSET`/`AG_LEN`/`AG_LANE_GAP`/`AG_SPD`/`AG_SIZE`, `agBlocked`, `ptFace`, `ptLive`, `ptHitR`, `hitPTarget` (the impact: score and shatter land the same frame), `agShatter` (the break), `agStreak` (broken by the arrow loop, sim.js), `PT_HIT_R`/`PT_RESPAWN`/`PT_POP` | `practice arena` (the arrow test: the PRACTICE branch, `update`, sim.js; pixels: `drawAgTrack`/`drawPTarget`, draw-world.js) |
| the archery round: the bell and its held difficulty wheel, the per-difficulty spawn tables, the furniture sink (bell included), the countdown, the spawner, the record | `agame` (incl. `diff`), `AG_T`/`AG_BELL`/`AG_DIFF`, `agBellNear`, `agRing`, `agEndRound`, `agSpawn`, `agStock`, `agSinkU`, `agUpdate` (the wheel: kind `'agbell'` in keydown/keyup input.js, `wheelOptions`/`renderWheel`/`runCmd` ui.js; the `E RING` cap: `drawBellHint`, ui.js; the record: `PROFILE.bestRange`, profile.js) | `practice arena` (readouts: `drawAgame`/`drawAgameUI`, draw-world.js; the bell's pixels: `drawAgBell`, draw-world.js; the sink crop: the dummy/rack/agbell branches, render.js) |
| the ice parkour: the stock centreline, the carve, the fixed line strip, the lap clock's state and rules | `PK_PATH`, `PK_LINE` (force-iced by `pkPlanCarve`; its two end flags: `genPracticeWorld`), `PK_OFF_T`/`PK_GATE`/`PK_WALK`, `pkCarve`, `parkour` (incl. `cpTx/cpTy`, `custom`, `diff`), the parkour block of `updatePractice` | `practice arena` (pixels: `drawParkourLine`/`drawParkour`, draw-world.js) |
| the roll station: the die, its held wheel, random tracks, the carving-front sweep | `PK_DIFFS`/`PK_DIFF`, `PK_CX`/`PK_CY`/`PK_RX`/`PK_RY`/`PK_APRON`, `PK_DIE`, `pkTiles`, `pkGenPath`, `pkPlanCarve`/`pkIceTile`, `pkRoll`, `pkAngKey`/`pkAnimStep`/`pkAnim`/`PK_ANIM_T`/`PK_WARN`, `pkDieNear`, `pkWheelPick` (the wheel: kind `'pkdie'` in keydown/keyup input.js, `wheelOptions`/`renderWheel`/`runCmd` ui.js; the `E ROLL` cap: `drawPkHint`, ui.js) | `practice arena` (pixels: `drawPkDie` + `PK_PIP_*`, draw-world.js) |
| the armory: taking a tool off the practice rack, and who counts as beside it | `rackEquip`, `rackNear` (the E-held wheel: keydown/keyup in input.js; kind `'rack'` in `wheelOptions` / `runCmd`, ui.js; the `E ARM` cap: `drawRackHint` / `drawKeyPrompt`, ui.js) | `practice arena` |

## js/nav.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| entity movement and unit-vs-unit solidity | `moveEntity`, `separateUnits`, `UNIT_MASS` | `movement & collision` (the tile half, `isSolidTile`: `world`, world.js) |
| routes around obstacles: A*, the per-unit route follower, the stall/give-up signal | `findPath`, `walkable`, `navTo`, `navStep`, `navLineClear` | `pathfinding` |

## js/wildlife.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| an animal's level: dealt once at spawn from the table's average, what it grows (hp, and the kill's gold) | `ANIMAL_LV_HP`, `ANIMAL_LV_GOLD`, `animalLevel` (under `ANIMAL_HP`), `a.level` in `makeAnimal`, the payout in `animalDies` | `animals` (the wolf's bite growth: `WOLF_LV_DMG`, above the `wolves` banner) |
| the meadow's strength and its restock: the boot spawn, the clock, the clear-of-everyone spot | `PREY_POP`/`PREY_REPOP`/`PREY_CLEAR`, `spawnPrey`, `bushList`, `spawnAnimals`, `updatePreyStock` (called from `updatePlay`, sim.js, never under `PRACTICE`) | `animals` |
| wildlife behaviour: the shared lifecycle and the prey half, with the rabbit's jink (the shot it reads as coming at it, and the dash) and the noticed mark's clock (`a.senseT`, set in `updatePrey` and `updateWolf`) | `updateAnimal`, `updatePrey`, `arrowAtRabbit`, `rabbitDodge`, `animalDies` | `animals` |
| the tuning for everything wild: the prey's bolt, the deer's sprint and the rabbit's jink, the holes cut down to the fish, the shoal itself, the pack, the flock | `FLEE_SIGHT`/`FLEE_TIME`/`PREY_SPD`/`PREY_RUN`, `DEER_SPRINT`/`DEER_SPRINT_T`/`DEER_SPRINT_REGEN`, `RABBIT_DODGE_*`, `ICE_HOLE_HITS`, `HOLE_FALL_DMG`/`HOLE_FALL_T`, `FISH_CATCH_R`, `FISH_MAX`/`FISH_MIN`/`FISH_SPAWN_FAST`/`FISH_EMERGE_*`, `WOLF_*`, `BIRD_*` | the top of `animals` (the prey), `fish` (the ice and shoal half) and above `wolves` (the pack and the flock); `FISH_SPAWN_T` alone stays in core.js |
| an animal taking a hit from anything (arrow or roll): flee/wake, floater, knockback, kill credit | `hurtAnimal` | `animals` |
| where an animal walks next: the graze/patrol goal, and the bolt away from a player | `wanderGoal`, `preyWander`, `fleeGoal` | `animals` |
| the pack: the ground its threat bar fills and holds on and drains off, waking the den, the hunt to an empty bar, the bite | `WOLF_GROUND`, `WOLF_THREAT_T`/`WOLF_THREAT_DECAY` (above the banner), `wakePack`, `updateWolf` | `wolves` |
| the flock: the flush, the circuit, the perch | `flushBirds`, `updateBird` | `birds` |
| fish shoal and ice holes | `updateFish`, `fishClear`, `fishWater`, `spawnFish` | `fish` |
| where new fish come from, and why one is invisible until it is under the ice | `spawnEmerger`, `buildEmergeSites`, `fishVis`, `f.born`/`f.vis`, `FISH_MAX`/`FISH_MIN`, `state.fishT` | `fish` |
| a fish net: the lure, the catch, handing the catch over, drawing it | `nearestNet`, `angDelta`, `updateStructures` (`net` branch, structures.js), `drawNet` (`entity draw`, draw-world.js), `NET_*` | `fish` |

## js/structures.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| build, upgrade, demolish, refunds, a chest's card rarity roll | `placeStruct`, `startUpgrade`, `demolishStruct`, `cumulativeCost`, `rollCardRarity` | `stump structures` |
| every buildable: its tiers, costs, HP, footprint, and the two colours the maps paint it | `STRUCTS`, `STRUCT_ORDER`, `WATER_STRUCT_ORDER` | `stump structures` (scenery carries the same `mm`/`map` pair: `OBJECTS`, world.js) |
| the fish net's tuning: what it holds, what it lures, how fast it catches and hands over | `NET_CAP`, `NET_R`, `NET_LURE`, `NET_CATCH_T`, `NET_TAKE_T` | `stump structures` (beside `STRUCTS`, whose `net` entry it belongs to) |
| tuning: the turret's pivot and barrel, its lock window, its bolts | `TUR_PIVOT_Y`, `TUR_BARREL`, `TUR_LOCK`, `TUR_MZ`, `BOLT_SPD`, `BOLT_LIFE` | `the building sim` › `turret gunnery` |
| construction ticks, generators, the bay rolling a bot out | `updateStructures` | `the building sim` |
| turret targeting, traverse and firing | `turretPivot`, `turretMark`, `turretSees`, `turretMuzzle`, `fireBolt` | `the building sim` › `turret gunnery` |

## js/robots.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| tuning: what a worker swing hits for, how far a flag spreads, what counts as an enemy doorstep | `ROBOT_DMG`, `ROBOT_ATK_CD`, `ROBOT_REACH`, `ROBOT_AGGRO`, `ROBOT_LEASH`, `ROBOT_MAD`, `FLAG_BASE_R`, `FLAG_HARVEST_R`, `FLAG_SIEGE_R`, `FLAG_PATH_W` | `worker flags` |
| a bot leaving the bay's mouth, and the frame it spends deciding | `makeRobot`, `updateRobot` (`updateStructures` rolls them out: `the building sim`, structures.js) | `workers` |
| shooting a worker bot: its hitbox, its damage, its wreck, and who it is now angry at | `robotHit`, `hurtRobot`, `robotDies`, `b.mad` | `workers` |
| what a worker does this frame: the flag dispatch, the harvest tick, the melee | the tail of `updateRobot`, `engage`, `gather`, `holdAt` | `workers` |
| the eagle's merchant: climbing down at the crash, the gate it raises off the ring stumps, the rim it fells, keeping to the lane mouth, and standing still to serve whoever opens its counter | `MERCH_*`, `freeTileNear`, `spawnMerchant` (called from `eagleCrash`, boot.js), `updateMerchant` (dispatched from `updateRobot` on `b.merchant`), `b.plan`/`b.avoids`, `shopServing` (js/shop.js) | `merchant` |
| the worker flag: what a tile orders, planting/moving/lifting it, whose crew reads it | `FLAG_JOBS`, `FLAG_ATTACK`, `flagResolve`, `plantFlag`, `clearFlag`, `flagRecall`, `flagOf` | `worker flags` |
| the lane a PATH flag asks for, and who has already claimed a tile in it | `flagCorridor`, `flagPathTarget`, `objTaken` | `worker flags` |
| a worker's attack: who is a valid mark, where the axe lands, the blow itself | `robotFoeUnit`, `enemyStructNear`, `foeAlive`, `foePoint`, `robotStrike`, `ROBOT_*` | `worker flags` › `a worker's simple attack` |
| who can be ordered, and what the held press is aiming at right now | `hasWorkers`, `state.flagAim`, `flagTarget` | `worker flags` (its tail; `overHud`: `UI`, ui.js) |
| what a flag LOOKS like - all five draw functions | `drawFlagIcon`, `drawFlagPennant`, `drawFlag`, `drawFlagAim`, `drawFlagCursor` | not here: `entity draw` › `what a flag looks like`, draw-world.js |

## js/actions.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| what a click / E / space actually does | `clickAction`, `tryWork`, `workTarget`, `tryDodge`, `hitObject`, `crackIce` (what a click FIRES: `fireTool`, tools.js) | `actions` |
| one chop into a standing tree - gold, stump, fell payout, loot roll, jackpot - whatever landed it | `chopTree` | `actions` (above `hitObject`; its other caller is `BIT_IMPACT.chop`, tools.js) |
| the tuning for everything a player does: the three SWING tools, the shot trail, E's reach, the roll, prone | `SWING_TOOLS`/`SWING_*`, `BOW_Y`, `ARROW_*`, `WORK_REACH`, `STRUCT_HIT_DMG`, `ROLL_*`/`TACKLE_*`, `PRONE_*`, `AMBUSH_MUL` | `actions` (its head; the two kit baselines `BOW_CHARGE`/`BOW_NOCK`: `players`, player.js; the weapon's own tuning: `TOOLS`/`BITS`, tools.js) |
| the roll as a hit: the sweep and the tackle | `rollSweep`, `rollTackle`, `tackleObject`, `tackleObjAhead`, `rollPow`, `rollDmg` | `actions` › `the roll as a hit` |
| going to ground and getting back up | `tryProne`, `risePlayer` | `actions` › `prone` |
| the empty-press tell (an empty slot, nothing light enough to throw) | `dryFire` | `actions` › `the empty press` |
| one blow against a building on another team (E swing and worker axe alike) | `hurtStruct`, `STRUCT_HIT_DMG`, `destroyStructure` | `actions` (its tail) |
| every way of hurting the practice dummy (E, every bit, the tackle), and the meter's combo ledger | `hitDummy` | `actions` (its tail; the dummy itself: `practice arena`, world.js; the plate: `drawDummyMeter`, draw-world.js) |
| **the one blow every kind of unit takes** - a slot, an animal, a worker bot | `hurtUnit` | `status effects` (its per-kind ends: `damagePlayer` player.js, `hurtAnimal` wildlife.js, `hurtRobot` robots.js) |
| every living thing in a circle an area effect may touch, in one list | `unitsNear`, `unitsHit` (blows only), `unitFoe`, `unitTeam`, `unitAlive`, `unitMidY`, `isAnimalUnit` | `status effects` › `what a unit IS` |
| asking those two on behalf of a THING in the world (a net, a shot) rather than a body | `sideOf` | `status effects` › `what a unit IS` (its kill-credit half: `abCredit`, abilities.js) |
| putting a state ON a body - the one writer for each | `stunUnit`, `rootUnit`, `slowUnit`, `netUnit`, `markUnit`, `igniteUnit` | `status effects` › `the states a unit can be under` |
| what a damage TYPE is, and the fire that outlives its blow | `DMG_TYPES`, `BURN_T`/`BURN_DPS`/`BURN_TICK`/`BURN_MAX`, `igniteUnit`, `updateBurn`, `douseUnit` | `status effects` › `fire` (the bits that deal it: `BITS.flame`/`pyre`/`cinder`, tools.js; the i-frame exemption: `DOT_CAUSE`, player.js) |
| ageing those states, and what is left of a non-player's speed | `updateUnitStatus`, `unitMoveMul`, `clearUnitStatus` | `status effects` › `the clock every non-player unit runs` (a slot's own copy: `updateAbilities`, abilities.js; where the speed is spent: `navStep`, nav.js) |

## js/tools.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| what every weapon and every shot IS: the two tables the whole system is driven from | `TOOLS`, `BITS`, `TOOL_TIERS`, `TOOL_SLOTS` (1 - the one weapon slot) | `tools & bits` (its head) |
| the tier a find wears, and where that colour is read back | `TOOL_TIERS`, `itemTier`, `TIER_SHINE` (`tierPlate`/`tierShine`, which paint it: `UI`, ui.js) |`tools & bits` |
| the bag rows that make tools and bits carryable at all | the `ITEMS` / `RES_COLORS` loops at the foot of the file | `tools & bits` › `icons` |
| a tool instance and the things that read one; the cycle a press starts | `makeTool`, `heldTool`, `bitsIn`, `bitFires`, `toolMods`, `nextBit`, `peekBit`, `toolRof`, `toolCycle`, `toolReady` | `tools & bits` › `a tool instance` |
| the draw curve: what a hold buys a shot, and the one flight envelope the sim fires and the aim line measures | `DRAW_RANGE_MIN`/`DRAW_SPEED_MIN`/`DRAW_DMG_MIN`, `drawPow`, `drawSpeedMul`/`drawRangeMul`/`drawDmgMul`, `shotFlight` | `tools & bits` › `the draw` |
| the fire a shot carries, and the three modifier bits that put it there | `BITS.flame`/`pyre`/`cinder`, `PYRE_T`/`PYRE_DPS`/`CINDER_R`, `m.type`/`m.burn`/`m.burnDps`/`m.cinder` in `toolMods` | `tools & bits` (beside `BITS`; what a burn then DOES: `status effects`, actions.js) |
| moving a tool onto a key or a bit into a cell (the two the drag goes through) | `slotPut`, `bitPut` | `tools & bits` › `equipping` |
| what a press actually fires, and the shot it puts in the air | `fireTool`, `emitBit`, `spearFish` | `tools & bits` › `what a tool fires` |
| the catch pose: its clock, the cancel every press and hit call (WASD is held for its first second, then a cancel), which of its three frames is up | `CATCH_T`, `CATCH_WALK`, `startCatch`, `cancelCatch`, `catchFrame` | `tools & bits` - after `spearFish` (ticked in `updatePlayer`, sim.js; drawn by `drawPlayer`, draw-world.js; the net take in `updateStructures`, structures.js) |
| how each bit flies, and the numbers behind the five non-straight paths | `steerBit`, `ZIG_*`, `ORBIT_R`, `LOB_DRAG`/`LOB_FALL`, `CURVE_TURN` | `tools & bits` › `how a bit flies` |
| what a shot does where it LANDS, and the two that do anything | `BIT_IMPACT`, `bitImpact`, `AXE_CHOP_R`, `WARP_BACK` | `tools & bits` › `what a bit does where it lands` (called from the arrow update: `update`, sim.js) |
| the teleport itself: the jump, and the silhouettes it strings across it | `warpPlayer`, `updateWarps`, `warps`, `WARP_FLASH_T`/`WARP_STEP`/`WARP_MAX` | `tools & bits` › `the teleport` (drawn by `drawWarps`, render.js; aged in `updateFx`, sim.js) |
| how hard a shot shoves what it hits | `kb` on each `BITS` row (`HIT_KB` player.js, `ROBOT_KB` robots.js, `o.kbMul` in `hurtUnit`) | `tools & bits` (beside `BITS`) |
| where tools and bits come from, and how often | `dropLoot`, `LOOT_POOL`, `rebuildLootPool`, `ROCK_DROP`, `TREE_DROP`, `CHEST_TOOL`, `LOOT_TOOL` | `tools & bits` › `loot` (its callers: `hitObject`, actions.js) |
| the arsenal's kinds and their lineage on paper, all of it unlocked; the "held one" pip | `TECH`, `TECH_BY_ID`, `noteSeen` | `tools & bits` › `the tech tree` (storage: `PROFILE.techSeen`, profile.js; the page that lists them: `the wiki`, menu.js) |
| what each class flies in with | `CLASS_LOADOUT`, `giveLoadout` | `tools & bits` › `starting loadouts` (the weapon rides the gear pop-up's preview: `drawGearPreview`, menu.js) |
| a bot putting its loot to work, having no column and no pointer | `botFitLoadout` | `tools & bits` › `a bot fitting what it has found` (called from `updateAI`: `ai`, ai.js) |
| the icons for both, and the one bake helper they share | `TOOL_ART`, `TOOL_ART_PAL`, `BIT_ART`, `BIT_PAL`, `bakeGrid` | `tools & bits` › `icons` |
| whether the hover-raised bit column is up right now | `bitEditSlot` | `tools & bits` › `equipping` (its geometry: `bitColRect`, ui.js) |

## js/abilities.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the two kits' four actives each: name, cooldown, cast, and the whole effect | `CLASS_AB` (each row's `use(p)`) | `class abilities` |
| tuning for every ability (pierce windup/multiplier/telegraph range, net slow, grapple reach/reel/assist, shield arc, rush slam, crater, juggernaut) | `PIERCE_*`, `NET_*`, `GRAP_*`, `SHIELD_*`, `RUSH_*`, `STOMP_*`/`CRATER_*`, `JUG_*` (snow cover's numbers are `PRONE_*`, actions.js) | `class abilities` (its head) |
| ability levels: a skill point per level on the four keys, and the level-cut cooldown every setter reads | `AB_LV_MAX`/`AB_LV_CD`, `abLvCanBuy`, `buyAbilityLv`, `abCdOf` (state: `p.abLv`, player.js) | `class abilities` › `levelling` (bought via `runCmd`, ui.js; bots: `updateAI`'s rung 0, ai.js) |
| a keypress becoming a cast, and the per-slot tick that lands it | `tryAbility`, `updateAbilities` | `class abilities` › `casting` |
| every movement cap an ability may touch, folded once | `abilityMoveMul` | `class abilities` › `casting` (read by `updatePlayer`, sim.js) |
| what the abilities leave in the world, stepped per sim step | `craters`/`nets`, `updateAbilityWorld` (the piercing shot rides `arrows`, sim.js; the grapple lives on its caster: `p.grapT`/`grapX`/`grapY`, `grapEnd`, and the reel branch in `updatePlayer`) | `class abilities` › `the world tick` (called from `updatePlay`, sim.js) |
| the shield eating a shot, the rush's step/grab/slam | `abShieldBlocks` (read by the arrow loop, sim.js), `rushStep`/`rushEnd` (read by `updatePlayer`'s rush branch) | `class abilities` |
| drawing it all: ground layer, air layer, the pose on the sprite, the states on a body | `drawAbilityGround`, `drawAbilityAir`, `abilityPose`, `drawAbilityOnPlayer` | `class abilities` › `drawing` (called from render.js and `drawPlayer`, draw-world.js) |
| the net drape, the root's jaws, the flames and the mark's chevrons, on ANY sprite at its own size | `drawUnitStates` | `class abilities` › `drawing` (its four callers: `drawAbilityOnPlayer` here, `drawAnimal`/`drawBird`/`drawRobot`, draw-world.js) |
| who a thing left in the world credits its kill to, once the caster may be down | `abCredit` | `class abilities` › `the world tick` (whose SIDE it is on: `sideOf`, actions.js) |
| the eight 32×32 ability icons and their bake | `AB32`, `AB32_PAL`, `classAbIcon` | `class abilities` › `the strip icons` (drawn by `drawClassAbCell`/`tipClassAb`, ui.js) |

## js/ai.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| what a bot slot decides to do this frame | `updateAI`, `aiNearestEnemy`, `aiLineClear`, `aiOpenSides` | `ai` |
| how well it plays: the three rival levels, the ally profile a notch above, which one a slot runs | `AI_LEVELS`, `AI_ALLIES`, `aiProfile`, `AI_AIM_T`/`AI_ABIL_T` | `ai` › `difficulty` |
| the objective: who pushes and who guards, the walk into a roost through its lane, the gate turrets, the archer's station, the siege that ignores respawning defenders | `aiRank`, `aiPushers`, `aiWantsPush`, `aiOnGuard`, `aiRivalEagle`/`aiOwnEagle`, `aiToRoost`, `aiLaneGate`, `aiInLane`, `aiEagleTile`, `AI_HOLD`, `AI_GATE`, `AI_ROOST_BUDGET`, `AI_ESCALATE`, `AI_SIEGE_R` (the `siege` read in `updateAI`) | `ai` › `difficulty` (the bird's numbers: `EAGLE_HP`/`EAGLE_ARROW_DMG`/`EAGLE_WORK_DMG`, boot.js) |
| what every bot knows about both birds: nerve, last hit, who is at each, the `threat` read the defend and push rungs ask, how many a threat calls home | `aiSituation`, `aiDefendersWanted`, `AI_ROOST_R`/`AI_DEFEND_T`/`AI_JOIN_HP`/`AI_ALARM_HP` | `ai` › `difficulty` › `the two birds` |
| an ally at your side: the escorts, the anchors that let it join your fight and your push | `aiEscorts`, `AI_ESCORT`/`AI_ESCORT_R`, `AI_ANCHOR_R`/`AI_ANCHOR_D` | `ai` › `difficulty` |

## js/sim.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the frame sim: momentum, day/night, timers | `update`, `updatePlay`, `updatePlayer` | `update` |
| the disc an arrow lands in round a body | `ARROW_HIT_R` (above `updatePlay`) | `update` |
| the clock paying every slot on the ground a coin, silently | `TRICKLE_GOLD`/`TRICKLE_T` (the tick is in `updatePlay`'s slot loop) | `passive income` |
| the zoom ease itself (runs first thing in `update`) | `applyZoom` | `update` |
| particles, floaters, footprints, drops, world-space snow flakes | `updateFx`, `makeFlake`, `fitFlakes` | `fx updates` |
| the belly-crawl drag furrow: emitted in `updatePlayer`, drawn as the `f.k === 3` branch | `footprints`, `p.trailD` | `update` (the draw branch: `render`, render.js) |

## js/draw-world.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| ground painting and runtime repaints | `paintGroundTile`, `renderGround`, `repaintGround`, `hash2`, `vnoise` | `ground prerender` |
| the treasure chest's and the practice dummy's baked sprites | `CHEST_SPR`, `DUMMY_SPR` | `entity draw` (its head; drawn in the y-sorted pass, render.js) |
| the dummy's LAST HIT / DPS / TOTAL plate | `drawDummyMeter` (its linger: `DUMMY_METER_LINGER`, world.js) | `entity draw` |
| the training field's pixels: the target face bakes (both sizes), the perimeter track's rails, a carriage target in any habit, the range bell, the round's readouts and its off-screen target chevrons, the big gate flag, the two-tile bow rack, the parkour's line and readouts, the roll die | `bakeTargetFace`/`TARGET_SPR`/`TARGET_SPR_S`, `drawAgTrack`, `drawPTarget`, `drawAgRings`, `drawAgBell`, `drawAgame`, `drawAgameUI`, `drawAgMarkers`/`AG_MARK_*`/`agMarkAtlas`, `drawBanner`, `RACK_SPR`, `drawParkourLine`, `drawParkour`, `drawPkDie`, `PK_DIE_COL`/`PK_PIP_COL`/`PK_PIP_AT` | `entity draw` (the records they draw: `practice arena`, world.js) |
| the one arrow body every shaft draws: the DDA rasteriser (crisp diagonals, mirrored vanes) and its rim/colour painter | `arrowBodyPx`, `paintArrowPx` (the master: `ARROW_MAP`/`ARROW_BODY`, actions.js) | `entity draw` |
| drawing players / animals / robots / the merchant / held tool | `drawPlayer`, `drawGhost`, `drawHeldTool`, `drawAnimal`, `drawRobot`, `drawMerchant` (dispatched from `drawRobot`) | `entity draw` |
| the level plate a hero and a beast share, the noticed `!` over an animal that sees you, the stun stars | `drawLevelBadge`, `drawSenseMark`, `drawStunStars` (under `drawHealthBar`) | `entity draw` |
| the landmark glyph both maps stamp | `drawLandmarkIcon` | `entity draw` › `the landmark glyph` (its `LANDMARKS` spec: `landmarks`, world.js) |
| what a worker flag looks like: the job glyph, the map pennant, the planted banner, and the held-press preview's two halves | `drawFlagIcon`, `drawFlagPennant`, `drawFlag`, `drawFlagAim`, `drawFlagCursor` | `entity draw` › `what a flag looks like` (what they read, `flagTarget`/`FLAG_JOBS`: `worker flags`, robots.js) |
| the snow over a buried body, its row spans, and the bury meter | `drawSnowCover`, `poseBounds`, `poseSpans`, `drawBuryRing` | `entity draw` |
| worn gear on the 16×16 sprite | `GEAR_MARKS`, `drawGearMarks` | `entity draw` |
| the stun tell: orbiting sparks, and the plate that carries them on a player's frame while it lasts | `drawStunStars`, the overhead block inside `drawPlayer` | `entity draw` |
| the overhead frame and the name over it: where the stack sits, the three bars' palette (health by side, stamina white, the draw meter's two golds), and centring odd-width text on a model | `FRAME_DX`, `BAR_NEUTRAL`/`barCol`, `STAM_COL`/`STAM_GHOST`, `DRAW_COL`/`DRAW_FULL_COL`/`DRAW_FULL_FLASH`, `NOCK_COL`/`EAT_COL`, `THREAT_COL` (a wolf's threat bar; a deer's sprint bar and a rabbit's dodge bar reuse `STAM_COL`), `drawHealthBar`, `centreTextX` | `entity draw` |
| the turret's rotating gun, its bolts, its aim line and muzzle flash | `drawTurretHead`, `drawBolt`, `drawTurretFx`, `paintRimmed` | `entity draw` |
| which sway frame a pine is wearing (off the wind field) | `treeFrame` | `entity draw` |
| one baked speck (mote, star, flake) at a quantised brightness, and the atlas behind it | `bakeSpecks`, `drawSpeck` | `light & weather` |
| whether the sun shafts are up at all (the drop window, and noon) | `rayLight` | `light & weather` |
| sun shafts, drifting cloud shadows, the tileable noise they are baked from | `godRays`, `cloudShade`, `cloudLayer`, `bakeCloud`, `pnoise` | `light & weather` |
| the ice's night mirror + the parallax stars in it, and the "is this pixel on unbroken ice" mask | `drawIceStars`, `overIce` | `light & weather` |
| the night colour, a lit shot's halo, snow (world-space flakes, see `fx updates`), vignette | `renderLighting`, `litShots`, `renderWeather` | `light & weather` |

## js/render.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| render pass order | `render` | `render` |
| the occluder fade: the visibility pocket around the viewed hero, and its silhouette rim | `TREE_FADE_A`/`TREE_FADE_R0`/`TREE_FADE_R1`, `treeFadeSil`, the tree branch of the y-sorted pass | `render` (the rim stamp: `drawPlayer`, draw-world.js) |
| the work-target rim: gold outline on the hovered tree/dead tree/rock/berried bush/chest | `drawTargetRim`, the `o === fadeWkO` stamps in the y-sorted pass | `render` |
| the F3 readout: fps, coords, seed | `drawTags` | `render` |
| the `.` overlay: hitboxes, the model centre column, and its 1px ring/box/line rasterisers | `drawHitboxes`, `hbRing`, `hbBox`, `hbDot`, `hbLine`, `hbMid`, `HB_*` | `debug overlays` |
| the `.` overlay's routes: waypoints + goal tile, a bird's perch line, a fish's heading arrow | `drawNavPaths`, `hbArrow` | `debug overlays` |
| which body a bit flies as, and the four that are not the arrow | `BIT_BODY`, `drawTumbler`, `drawMote`, `drawSwungBody`/`FIST_MAP`/`AXE_MAP`/`BIT_INK`, `drawWarpShot` | `render` (after the shots pass; the names they answer to: `body` on `BITS`, tools.js) |
| the silhouettes a teleport strings across its jump | `drawWarps` | `render` › `the teleport's flash` (the flash itself: `warpPlayer`/`warps`, tools.js) |
| pointer state and the bow aim line | `cursorInfo`, `drawCursor`, `drawAimLine` | `cursor & aim line` |

## js/ui.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| radial menu geometry and hit math | `wheelSpan`, `wheelAng`, `wheelOptions`, `wheelLayout`, `resolveWheel` | `radial wheel` |
| brackets, the E prompt, the fish prompt, wheel pixels | `drawSelection`, `drawWorkHint`, `drawFishHint`, `renderWheel`, `drawWheelHub`, `drawWheelStick` | `selection, hints & wheel` |
| HUD and minimap | `renderUI`, `renderMinimap`, `updateMinimap` (throttled to `MM_REBUILD` ticks), `mmChrome`/`mmArcBand` (the disc's baked chrome and cached day/night arc band) | `UI` (the disc's per-tile colour comes from `objMapColor(o, 'mm')`: `world`, world.js) |
| is the pointer over HUD that owns its own clicks, rather than over the world | `overHud` | `UI` (its callers are input.js's middle-button handlers and `flagTarget`, robots.js) |
| the `E SHOP` cap over a merchant in reach | `drawShopHint` | `selection, hints & wheel` (the resolver and everything behind it: `merchNear`, shop.js) |
| the backpack (bottom-right): the pack button (shut: the whole widget), the open frame's ten-cell grid and bottom strip (food + gold), the refusal flash | `BAG_CELL`/`BAG_GAP`/`BAG_PAD`/`BAG_BTN`/`BAG_STRIP`/`BAG_BG`/`BAG_WELL`, `bagOpenNow`, `bagFrameRect`, `bagBtnRect`, `bagCellRect`, `bagStripRect`, `bagCellPlate`, `bagHit`, `bagClick`, `bagDenied`, `drawFoodClock`, `drawBag` | `UI` › `the backpack` |
| the pack button's 20px rucksack icon, baked once | `BAG_ICON`, `BAG_ICON_PAL`, `bagIconCv` | `UI` › `the pack icon` |
| the character panel (G): the live body with its gear bands, the stat ledger off the live kit, the four gear pieces and their buys | `CHAR_LEDW`/`CHAR_WELL`, `charLayout`, `charHit`, `gearHit` (the piece-index read tipAt and the cursor keep using), `charClick`, `drawCharPanel` (state: `state.charOpen`, core.js) | `UI` › `the character panel` |
| carrying an item between the grid, the four weapon slots and a bit column | `state.drag`/`state.dragPend`, `DRAG_SLOP`, `hudPress`, `hudMove`, `hudRelease`, `dragTake`, `dragLift` (a well's item onto the cursor), `dragReturn`, `dragDrop`, `dragDropBag`, `dragDropBit`, `dragDropSlot`, `throwCell`, `drawDragGhost` | `UI` › `carrying an item on the cursor` (its three listeners: `input`, input.js) |
| where the item a drop DISPLACES goes - home, which makes the drop a swap | `dragHome` (its three callers are the three `dragDrop*`; false = the ousted item rides the cursor as before) | `UI` › `carrying an item on the cursor` |
| a click or SHIFT-click SENDING an item to its one other side (bag <-> weapon, bag <-> bit column) | `sendBagCell`, `sendBitCell`, `sendSlot` (each returns whether it handled the click), `sendAt` (the shift-while-carrying hit test), `tipSend` | `UI` › `one click sends it to the other side` (resolved in `hudRelease`, refused by `bagDenied`/`toolDenied`) |
| the SHIFT key cap over the pack: where the hovered well would send what it holds | `shiftVerb` (LOAD / STOW / HOLD / null, asking `sendAt`'s wells in `sendAt`'s order), `drawShiftHint` | `UI` › `the pack's SHIFT plate` (the cap itself: `drawKeyPrompt`, `selection, hints & wheel`) |
| the pick-1-of-3 card draft: opening it, hit-testing a card, applying a pick, drawing it | `openDraft`, `draftLayout`, `draftHit`, `draftClick`, `renderDraft`, `state.draft` | `UI` › `the backpack` |
| what the pointer is on, said in words, bottom left | `tipAt`, `tipResolve`, `tipNow`, `tipLift`, `tipSize`, `drawTooltip`, `TIP_*` | `tooltips` (resolved once per frame in `render`, render.js; the feed steps up by `tipLift`, panels.js) |
| the per-kind descriptions that panel is built from | `tipBase`, `tipTool`, `tipBit`, `tipStack`, `tipCell`, `tipGear`, `tipClassAb`, `tipKind` (a wiki ARSENAL row), `TIP_PATH` | `tooltips` |
| the four gear cells of that row and their hit test | `gearRects`, `gearHit`, `drawGearCells` | `UI` › `the four gear cells` |
| the hud strip (bottom-centre): five wells - the weapon first, the four ability wells (fat level pips, 2x key digit) following, the two stacked meal buttons (icon, count, Q/F letter, the shared food clock, the refusal flash) on the right end - over the segmented plum xp bar, with the floating buy plates bobbing above affordable wells | `AB_CELL`/`FOOD_CELL`/`FOOD_BTNS`/`AB_SEGS`/`AB_BUY`/`hudStripRect`/`stripCellRect`/`toolCellRect`/`abCellRect`/`foodCellRect`/`foodDenied`/`toolDenied`/`abBuyRect`/`abBuyHit`/`stripHit`/`drawToolCell`/`drawClassAbCell`/`drawFoodCell`/`drawAbBuyPlate`/`drawXpBar`/`drawHudStrip` | `UI` › `hud strip` |
| the HUD SIZE scale: the 1x bake blitted about the strip's bottom-centre anchor, and the pointer's map back through it | `hudSc`, `stripMouse`, `hudScaleCv`, `drawHudScaled` (the slider: `settings.hudScale`, set in `applySliderDrag`, panels.js) | `UI` › `hud strip` |
| the weapon well's "it does not fit in here" red, the backpack's twin | `toolFlash`, `toolDenied` (aged in `updateFx`, sim.js, beside `bagFlash`) | `UI` › `hud strip` (its head, above `hudStripRect`) |
| the bit column hovering the weapon well raises out of its tool | `BITC_CELL`/`BITC_GAP`/`BITC_LIFT`, `bitColRect`, `bitColHit`, `drawBitColumn` | `UI` › `the bit column` (which slot is up, `bitEditSlot`: `tools & bits`, tools.js) |
| the plate a tier is stated on, wherever an item sits, and the shine on the top one | `tierPlate`, `tierShine`, `drawItemIcon` | `UI` › `hud strip` (the tiers themselves: `TOOL_TIERS`, tools.js) |
| the hatch and cut corners that mark a MODIFIER bit apart from a projectile, in every well either sits in | `modPlate` (its callers: `drawBag`, `drawBitColumn`, `drawDragGhost`, `drawTooltip` ui.js, `drawShopWell` shop.js, `drawTechNode` menu.js) | `UI` › `hud strip` (the `proj` flag it reads: `BITS`, tools.js) |

## js/shop.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the fish/berry market: the walk, the shocks, the rails, the three-day history, and the market's own rng stream | `GOODS`, `MKT_STEP`/`MKT_DAYS`/`MKT_HIST`/`MKT_REVERT`/`MKT_NEWS`, `mktRng`, `market`, `marketPrice`, `marketHist`, `marketWalk`, `initMarket` (called from boot.js), `updateMarket` (called once a step from `updatePlay`, sim.js) | `market` |
| a price move worth a feed line | `marketNews` (the good's own `news` gold floor beside `MKT_NEWS`) | `market` (the line itself: `logEvent`'s colour override, panels.js; the cue: `SFX.market`, audio.js) |
| the twelve offers and their turnover | `SHOP_RESTOCK`, `SHOP_COLS`, `SHOP_SECTIONS`, `SHOP_CARD_ODDS`, `shopPick`, `shopRestock`, `shopOffer` | `the counter's stock` |
| what a thing is worth, both ways | `itemValue`, `cellValue` (a tool carries its loaded bits), `sellValue` (half, except the two goods) | `buying and selling` (the prices themselves: `price` on `TOOLS`/`BITS` tools.js, `CARD_PRICE` player.js) |
| standing at a counter, and the merchant standing still to serve it | `SHOP_REACH`, `merchNear`, `inReach`, `shopServing` (read by `updateMerchant`, robots.js) | `buying and selling` |
| the trades | `shopBuy`, `shopSell`, `shopSellCell`, `shopTrade`, `shopCmd` (the `runCmd` entry, ui.js), `shopFx`, `shopDeny`/`shopNoRoom` | `buying and selling` (a sale pays through `tradeGold`, player.js - gold without XP) |
| the panel: whether it is up, opening and shutting it, and its geometry | `shopOpen`, `openShop`, `closeShop` (`state.shop` holds the merchant itself), `SHOP_W`/`SHOP_H`/`SHOP_Y`/`SHOP_WELL_*`/`SHOP_SEC_*`/`SHOP_CARD_*`, `shopLayout`, `shopHit`, `hitR`, `shopClick`, `shopDropSell` | `the shop panel` |
| its pixels | `drawShopPanel`, `drawShopSection`, `drawShopWell`, `drawSellWell`, `drawMarketCard`, `drawMarketGraph`, `drawTradePlate`, `drawTradeArrow`, `drawTrend` | `the shop panel` › `drawing` (the `E SHOP` cap over the body: `drawShopHint`, ui.js) |
| what the pointer is on there, in the shared descriptor shape | `tipShop` | `the shop panel` › `tooltips` (`tipBase`/`tipTool`/`tipBit`/`tipStack`: `tooltips`, ui.js) |

## js/panels.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the TAB standings, the event feed | `logEvent`, `renderEventLog`, `scoreGroups`, `renderScoreboard` | `scoreboard & log` |
| the M map, and the chart point -> world tile inverse a map order needs | `buildMapPanel`, `buildWorldMapImg`, `renderWorldMap`, `mapTileAt` | `world map (M)` (the parchment's per-tile colour comes from `objMapColor(o, 'map', i, h)`: `world`, world.js) |
| the ESC menu: its tabbed pages, their rows, the scroll, the layout every reader shares | `SET_TABS`, `settingsLayout`, `settingsScrollBy`, `setTab`/`setScroll`, `buildSettingsPanel`, `bakeControls`/`controlsCv`, `settingsHit`, `settingsMouseDown`, `renderSettings` | `settings menu (ESC)` |
| the VIDEO page's quality macro over the render-pass toggles | `VID_PRESETS`, `vidPreset` (the flags themselves: `settings.vid*`, core.js; their gates sit at each pass's call site) | `settings menu (ESC)` |
| the three sound dials, the speaker that mutes them, the grey-when-muted fill, the minimap and HUD size knobs | `applySliderDrag`, `muteBtnRect`, `drawMuteBtn`, `drawSliderRow`, `drawSliderById`, `toggleVal` | `settings menu (ESC)` |
| practice's exit plank under the slab | `leavePlankRect` (the click: `leavePractice`, menu.js) | `settings menu (ESC)` |
| the PLAYER panel: the name field, its validation, the two planks | `openNamePanel`, `nameKey`, `nameOk`, `nameCommit`, `nameDismiss`, `namePanelHit`, `renderNamePanel`, `buildNamePanel` | `player profile` |
| the profile name bottom-left of the title screen, and the slot that wears it | `nameTagRect`, `overNameTag`, `drawNameTag`, `applyProfileName` | `player profile` |

## js/menu.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the title screen: buttons, die, panels, play intro | `menuLayout`, `drawMenuButton`, `drawPillar`, `rerollWorld`, `beginIntro`, `renderTitle` | `main menu` |
| class select: the painted night, the two roster columns (your side left, rivals right, face-down until the count), the rivals' difficulty notches, PLAY in the title plank's place, the one-class stage with hoverable ability tooltips flanked by the emblems and the gear widget, the five-second count to the eagle (a second PLAY skips it) | `selectLayout`, `selectHit`, `selectAbilHit`, `CLASS32`/`classIcon32`, `drawSelectBackdrop`, `drawSelectPortrait`, `drawSelectStage`, `drawSelectCard`, `drawSelectRosters`, `drawSelectCount`, `renderSelect`, `selectClass`, `pressPlay`, `cancelCount`, `selectRevealed`, `setAiLevel`, `lockIn`, `COUNT_T`, `SEL_ROST_X` | `main menu` › `class select` (the levels' names: `AI_LEVELS`, ai.js) |
| the practice plank's breakable ice, and entering/leaving the arena | `menuFrozen`, `ICE_FLAW`, `iceRefuse`, `breakPracticeIce`, `beginPractice`, `leavePractice` | `main menu` (the resting crack `ICE_FLAW` and the standing knock cracks `menu.iceMarks`, both drawn in `drawMenuButton`) |
| the patch tag and its notes panel | `PATCH_TXT`, `PATCH_NOTES`, `buildPatchPanel`, `patchTagRect` | `main menu` |
| picking variants pre-match: the pop-up over class select - live preview, stat ledger with hover deltas, twelve 32×32 icon wells, the equip flash | `gearLayout`, `gearScreenHit`, `pickGear`, `renderGear`, `drawGearWell`, `drawGearPreview`, `gearPreviewKit`, `GEAR_STATS`, `GEAR32`/`gearIcon32`, `beginGear`/`leaveGear` | `main menu` › `the gear pop-up` (the numbers' base: `baseKit`, player.js) |
| the wiki: its pages as data, the slab, tabs, window and rail, the per-page scroll, what is under a point, the way in and out | `WIKI_PAGES`, `WIKI_W_MAX`/`WIKI_H`, `wikiScroll`, `wikiBlocks`, `wikiPage`, `wikiLayout`, `wikiHit`, `beginWiki`/`leaveWiki`, `wikiScrollBy`, `wikiSetTab`, `wikiKey`, `wikiClick`, `renderWiki`, `drawWikiRail` | `main menu` › `the wiki` (the tooltip a row raises: `tipKind`, ui.js; the wheel: input.js) |
| the BEASTS page: the four cards, a kind at a level, the figure wearing its frame, the labelled legend | `WIKI_BEASTS`, `WIKI_LEVELS`, `wikiBeastHp`, `wikiBeastGold`, `drawWikiBeast`, `wikiLeader` | `main menu` › `the wiki` (the numbers: `ANIMAL_HP`/`ANIMAL_LV_HP`/`ANIMAL_LV_GOLD`, wildlife.js; `YIELD`, core.js) |
| the ARSENAL page: the three tables' columns, the kinds of a sort worn to gilded, a row on its tier plate | `WIKI_TOOL_COLS`/`WIKI_BIT_COLS`/`WIKI_MOD_COLS`, `wikiKinds`, `drawWikiRow` | `main menu` › `the wiki` (the kinds themselves: `TECH`, `TOOLS`, `BITS`, tools.js) |
| the CLASSES page: an ability row's columns, the four stat pips, the word-wrap the blurbs use, the `cls` and `ab` draws in `renderWiki` | `WIKI_AB_COLS`, `WIKI_STATS`, `wikiWrap` | `main menu` › `the wiki` (the classes and kits: `CLASSES`, player.js; the abilities: `CLASS_AB`, `classAbIcon`, abilities.js; the card a hover raises: `tipClassAb`, ui.js) |

## js/screens.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the rolling four-second replay: the capture ring, its resolution, the `#replay` overlay | `replayTick`, `rpTarget`, `rpEnsure`, `replayShowing`, `layoutReplay`, `renderReplay`, `RP_*` | `replay` |
| the death/respawn overlay, spectating, back to the lobby, who the camera frames, the planks every ending shares | `DEAD_ITEMS`, `deadItems`, `endScreen`, `viewPlayer`, `specNext`, `toLobby`, `openDefeat`, `renderDead`, `deadLayout`, `deadReady`, `endSkip`, `drawEndPlanks` | `death & spectate` (`endMatch`/`endSnapshot`: `damage & death`, player.js) |
| the victory screen: its timeline, the side's stands, its sound cues, its art, and the passes both endings share | `WIN_T`, `WIN_BODY`/`WIN_TIER`/`WIN_BANNER_W`/`WIN_BANNER_H`, `winLayout`, `winStands`, `winCues`, `tallyCues`, `renderVictory`, `stampGrid`, `drawWinAurora`, `drawWinRays`, `drawWinMotes`, `WIN_CREST`, `mixHex`, `winBannerCv`, `drawWinBanner`, `drawBrazierIron`, `drawWinBrazier`, `drawWinDais`, `drawEndStatPlate`, `drawEndTally` | `victory` |
| the defeat screen: the loss's own summary, on the same anchors and stands | `DEF_T`, `DEF_STATS`, `defCues`, `renderDefeat`, `drawBlizzard`, `drawDefeatDrift`, `drawDeadBrazier`, `DEF_ARROW` | `defeat` |

## js/boot.js

| Looking for | Start at | Banner |
| --- | --- | --- |
| the twin eagle rides down the fixed corner-to-corner diagonal, the wing seats and the merchant's neck seat, the jump window and its lock, a bot's treeline-safe forced drop, riding the landing and the E hop off the roost, free fall, landing, the flight bar, the dotted path, the wind trail, the zoomed-out view | `diagEnd` (and the corner's `mouth` it returns - `e.mouth`), `makeEagleRoute`, `forestDepth`, `lastOpenU`, `makeEagles`, `eagleScale`, `riderScale`, `riderDir`, `drawSeated`, `seatPos`, `MERCH_SEAT`, `beginDrop`, `dropJump`, `landPlayer`, `handOver`, `landAboard`, `hopOff`, `HOP_FALL_T`/`HOP_ALT`, `drawHopPrompt`, `updateDrop`, `updateEagle`, `drawDropAir`, `TRAIL_T`/`TRAIL_STEP`/`TRAIL_RIM`/`TRAIL_TIP`/`TRAIL_TIP_AMP`/`TRAIL_BACK`/`TRAIL_BACK_AMP`, `drawEagleTrail`, `drawEagle`, `renderDropUI` | `eagle drop` |
| the drop brief: the roost tour a landing ridden to the crash opens on - the phase machine (a beat, the rival roost, then your own to finish), the camera's aim, the two headlines, the DAY 1 it hands back to | `state.dropBrief` (core.js), `BRIEF_WAIT`/`BRIEF_HOLD`/`BRIEF_HOLD_OURS`/`BRIEF_GO_MIN`/`BRIEF_MAX_T`, `endBrief`, `dropBriefTarget`, `drawDropBrief` (the glide: the camera banner, sim.js; the control zeroing: `sampleHumanInput`, input.js) | `eagle drop` |
| the dive past the line's end, the tree-shattering impact, the LANE it fells back to the snow pine by pine, and the roosting objective: its wing-gust defense, its preen regen, and the driven-off ceremony that ends the match | `beginDive`, `CRASH_DEPTH`/`MIN_CRASH_TREES`, `findCrashPoint`, `eagleCrash` (sets `e.laneDir`, the road's direction toward `e.mouth`), `LANE_R`/`LANE_SPD`/`LANE_WARN`/`LANE_DELAY`/`LANE_MAX`/`LANE_CLEAR`, `laneFells`, `planLane`, `laneStep`, `eagleBoomFx`, `eagleGust`, `eagleGustFx`, `hurtEagle`, `eagleFlee`, `eagleFleeResolve`, `teamEagleDown` (the driver it drops off: `spawnMerchant`, robots.js) | `eagle drop` |
| boot order, `DBG`, the rAF loop | `startGame`, `loop`, `window.DBG` | `boot` |
