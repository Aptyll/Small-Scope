# CLAUDE.md

Emberfrost — a browser canvas pixel-art free-for-all on a winter survival map. Fight with an
always-in-hand bow, harvest with **E** (the axe/pickaxe come out on their own for whatever's under
the cursor), build structures on stumps, and travel fast via a momentum system (slippery frozen
rivers, chained dodges, shift-sliding). **Gold is the only currency**; berries and fish are food.

Every combatant is a slot in `players` (`MAX_PLAYER_SLOTS` = 6, slot 0 = the local human, the rest
AI fills, four team colours), each playing one of two champions (WREN the ranger, SKADI the
skater — a look plus a kit read via `kitOf(p)`), and arrows hurt rival players exactly as they hurt
animals. Gold earned is also XP: every slot levels 1→9 (`p.level`, flat +hp/+arrow damage per
level, a badge beside the overhead bars). Nobody spawns in a camp: after LOCK IN every slot rides a white eagle along a seed-fixed
line across the world and jumps (Space) to pick its landing, which becomes its respawn point.
Nothing else is hostile: the gold mine and the raider waves are gone, so night is visual-only.

## Commands

```
node serve.js          # static server + screenshot sink on http://localhost:8471
```

No build step, no package manager, no dependencies, no test suite, no linter. Editing a `js/*.js`
file and reloading the page is the whole dev loop (`Cache-Control: no-store` is set, so a plain
refresh always picks up changes). `PORT` overrides the port; `.claude/launch.json` sets
`autoPort`, so a second session can preview alongside an already-running server.

**Verify changes in the browser, not by re-reading code** — three affordances drive it from outside:

- `window.DBG` (end of [js/game.js](js/game.js)) exposes the live singletons and helpers; read the
  object literal for the current surface. The non-obvious members: `step(dt, n)` runs `n`
  fixed-`dt` update ticks and one render, `freeze = true` stops the rAF loop so stepping is
  deterministic, `hideUI = true` drops the HUD/seed tag/cursor for captures, and `buildStruct`
  stages a construction site with no cost or validation. Stage a scene (place structures, jump
  `state.day`/`state.time`) instead of playing to reach it.
- `?seed=N` pins the world — same seed twice proves a change is deterministic, two seeds prove
  worldgen still varies. Without it every reload is a different world and A/B screenshots are
  meaningless. The seed prints bottom-right every frame, so a screenshot carries its world.
- `POST /shot` in [serve.js](serve.js#L14) writes a base64 PNG body to `shot.png` in the repo root,
  for a headless driver doing `canvas.toDataURL()` → POST. Nothing in the client calls it, and
  `shot.png` is not gitignored — don't commit it.

## Deep docs

Read the relevant one **before** working in that area — they carry the detail this file omits.

| Working on | Read |
| --- | --- |
| camera, zoom, a draw pass, HUD, baked panels, cursor, lighting, the main menu | [docs/dev/rendering.md](docs/dev/rendering.md) |
| worldgen, tiles, ground, determinism/RNG, day/night, ice holes and fish | [docs/dev/world.md](docs/dev/world.md) |
| movement, bow and tools, dodge, wildlife, economy, building, robots, settings, audio | [docs/dev/gameplay.md](docs/dev/gameplay.md) |
| player slots, champions and kits, the input struct, teams, AI bots, contested orders, PvP | [docs/dev/multiplayer.md](docs/dev/multiplayer.md) |
| sprite grids and palettes | [docs/dev/sprites.md](docs/dev/sprites.md) |
| adding an object/tool/structure/ground type, tuning balance, intentional dead code | [docs/dev/checklists.md](docs/dev/checklists.md) |

## Architecture

Four IIFEs loaded in a fixed order by [index.html](index.html), communicating only through
globals. Order matters: each file's globals must exist before the next runs.

| File | Exposes | Role |
| --- | --- | --- |
| [js/font.js](js/font.js) | `drawPixelText`, `drawPixelTextShadow`, `pixelTextWidth` | 3×5 bitmap font, uppercase only, unknown chars render as `?` |
| [js/sprites.js](js/sprites.js) | `SPRITES` | every sprite as a char-grid + palette map, baked to offscreen canvases at load |
| [js/audio.js](js/audio.js) | `SFX` | WebAudio synth; no asset files |
| [js/game.js](js/game.js) | `DBG` | everything else — worldgen, sim, render, UI |

All game state lives in module-scope singletons — `state`, `settings`, `players` (with `player` /
`inv` pointing at the local slot and its wallet) — plus the
arrays `animals`, `arrows`, `drops`, `particles`, `floaters`, `footprints`, `lights`,
`structures`, `robots`, `fish`.

`game.js` is one ~4100-line IIFE with no internal module boundaries, organized only by banner
comments of the form `// ------ name`. **Keep every banner honest** — one that has drifted from
what sits under it is worse than no banner, because it sends future sessions to the wrong 600
lines. If a section grows past ~250 lines or picks up a second responsibility, split it and add
the new banner to the table below.

### Where things live in game.js

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
| collision and entity movement | `moveEntity`, `isSolidTile` | `movement & collision` |
| what a click / E / space actually does | `clickAction`, `tryWork`, `workTarget`, `tryDodge`, `fireArrow`, `hitObject`, `crackIce` | `actions` |
| build, upgrade, demolish, refunds | `placeStruct`, `startUpgrade`, `demolishStruct`, `cumulativeCost` | `stump structures` |
| wildlife behaviour | `updateAnimal`, `nearestBerryBush` | `animals` |
| fish shoal and ice holes | `updateFish`, `fishClear`, `spawnFish` | `fish` |
| construction ticks, generators, robot jobs | `updateStructures`, `updateRobot` | `structures & robots` |
| radial menu hit math | `wheelLayout`, `resolveWheel` | `radial wheel` |
| what a bot slot decides to do this frame | `updateAI`, `aiLineClear`, `aiOpenSides` | `ai` |
| the frame sim: momentum, day/night, timers | `update`, `updatePlay`, `updatePlayer` | `update` |
| render pass order | `render` | `render` |
| pointer state and the bow aim line | `cursorInfo`, `drawCursor`, `drawAimLine` | `cursor & aim line` |
| drawing players / animals / robots / held tool | `drawPlayer`, `drawGhost`, `drawHeldTool`, `drawAnimal`, `drawRobot` | `entity draw` |
| brackets, the E prompt, the fish prompt, wheel pixels | `drawSelection`, `drawWorkHint`, `drawFishHint`, `renderWheel` | `selection, hints & wheel` |
| darkness, warm glows, snow, vignette | `renderLighting`, `drawWarmGlows`, `renderWeather` | `lighting & weather` |
| HUD and minimap | `renderUI`, `renderMinimap`, `updateMinimap` | `UI` |
| the M map | `buildMapPanel`, `buildWorldMapImg`, `renderWorldMap` | `world map (M)` |
| the ESC menu | `buildSettingsPanel`, `settingsHit`, `renderSettings` | `settings menu (ESC)` |
| the title screen: buttons, die, panels, champion select, play intro | `menuLayout`, `drawMenuButton`, `rerollWorld`, `renderSelect`, `lockIn`, `beginIntro`, `renderTitle` | `main menu` |
| the eagle ride, jumping, free fall, landing, the drop chart, the zoomed-out view | `makeEagleRoute`, `beginDrop`, `dropJump`, `landPlayer`, `updateDrop`, `drawDropAir`, `renderDropUI` | `eagle drop` |
| boot order, `DBG`, the rAF loop | `startGame`, `loop`, `window.DBG` | `boot` |

## Hard rules

Cross-file invariants — breaking one produces a bug that looks unrelated to its cause.

- **Canvas size changed?** Call `fitCanvas()` **then** `relayout()` — every path (window resize,
  `fullscreenchange`, camera zoom, the eagle drop's `DROP_ROWS` view via `applyView()`) goes through both. Never write layout code against a literal
  480/270; the view is `VIEW_W`×`VIEW_H`.
- **Screen position is `round(world − camera)`, rounded exactly once.** Statics subtract the
  rounded `ox`/`oy`; moving entities subtract the exact `ex`/`ey` and round at the end. Rounding
  camera and entity separately makes sprites vibrate ±1 px against the background while walking.
- **Runtime ground change?** Call `repaintGround(tx, ty)` — it repaints the tile plus its four
  neighbours into the prerendered ground canvas. Never call `renderGround()` per frame; it bakes
  the entire 3712×3712 world and is a boot-time cost.
- **Added or removed a light-emitting object?** Call `rebuildLights()`.
- **A loop over `players` that touches the world must skip `inAir(p)`** (riding or falling from the
  eagle) alongside `!p.active`/`p.dead` — arrows, drops, wildlife, the draw list and both maps all do.
- **Gold never goes straight into `p.inv.gold`** — every payout calls `gainGold(p, n)`, which is
  also the XP source; a direct `+=` earns no levels.
- **Anything a player does takes a `p` and reads `p.input`**, never `keys`/`mouse` (local slot only),
  and anything only one of them can get (a work swing, a build, a drop, a fish) goes through
  `contest()`, which picks the winner from (SEED, player id, `state.tick`).
- **Never add or remove an `rng()` call inside `genWorld()`** — it reshuffles every existing seed.
  Use `hash2`/`vnoise` for anything that must stay stable per tile, and never call `hash2` before
  the `SEED` const it closes over.
- **At most one object per tile.** Create with `placeObj`, read with `objAt`, and route structures
  through `placeStruct`/`destroyStructure` so the `structures` registry and lights stay in sync.
- **Anything drawn through `drawSpriteFlash()` must fit in 32×32** — it recolours through a shared
  32×32 scratch canvas and larger sprites clip.
- **[js/sprites.js](js/sprites.js) has a UTF-8 BOM** and one row that repairs a mangled byte via
  `.replace()`. Preserve the file's encoding or the grids corrupt.

## Keeping the docs current

**The docs are part of the deliverable.** When a change makes a line in this file or in
`docs/dev/*.md` false, fix it in the same turn as the code change — don't defer it, don't append a
changelog. Edit the section that already covers the topic; add a new one only for a genuinely new
subsystem, and prune what a change has made false, including
[Known drift](docs/dev/checklists.md#known-drift) entries once they are fixed. A stale line is
worse than a missing one, because future sessions act on it without re-verifying.

Worth recording: a new object type, buildable, ground type, resource, or enemy; new or rebound
keys; new state on `state`/`settings`/`player`; a new render pass, overlay, or offscreen canvas; a
change to the day/night, lighting, tool, or difficulty formulas; anything that adds a cross-file
invariant; any change to how the game is run or verified; and durable preferences or constraints
the user states in conversation. Not worth recording: balance tweaks to existing numbers, sprite
pixel edits, and refactors that preserve the described structure.

**This file loads in full at the start of every session — keep it under ~150 lines.** It is a
system prompt, not a knowledge base: every line costs context and attention in *every* session,
and rule adherence drops as it grows. Detail, procedures, and anything derivable by reading the
code belong in `docs/dev/*.md`, which cost nothing until opened. Before adding a line here, ask
whether leaving it out would cause a clear mistake; if not, it belongs in a deep doc — and when
the file outgrows the budget, move a section out rather than thinning every section into mush.
