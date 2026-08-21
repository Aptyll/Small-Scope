# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Emberfrost — a browser canvas pixel-art winter survival game. Gather by day with three
tool-gated tools (bow, axe, pickaxe) and build defenses on stumps; raiders pour out of the
central gold mine each night, and every night is harder.

## Keeping this file current

**Treat CLAUDE.md as part of the deliverable.** When a change alters something this file
describes, update the affected section in the same turn as the code change — don't leave it for
later and don't append a changelog at the bottom. Edit the section that already covers the topic;
add a new one only when the change introduces a genuinely new subsystem.

Changes worth recording include: a new object type, buildable, ground type, resource, or enemy;
new or rebound keys and input handling; new state on `state`/`settings`/`player`; a new render
pass, overlay, or offscreen canvas; a change to the day/night, lighting, tool, or difficulty
formulas; anything that adds a cross-file invariant like `rebuildLights()`; and any change to how
the game is run or verified. Balance tweaks to existing numbers, sprite pixel edits, and pure
refactors that preserve the described structure do not need an entry.

Also fold in durable working preferences and project constraints the user states in conversation,
and prune anything here that a change has made false — including entries under
[Known drift](#known-drift) once they are fixed. A stale line in this file is worse than a
missing one, because future sessions act on it without re-verifying.

## Commands

```
node serve.js          # static server + screenshot sink on http://localhost:8471
```

The port honors `PORT` in the environment (default 8471), and `.claude/launch.json` sets
`autoPort: true`, so a second session can preview alongside an already-running server.

There is no build step, no package manager, no dependencies, no test suite, and no linter.
Editing a `js/*.js` file and reloading the page is the whole dev loop (`Cache-Control: no-store`
is set, so a plain refresh always picks up changes). `.claude/launch.json` runs the same server.

### Verifying changes

Three dev affordances exist for driving the game from outside the browser:

- `window.DBG` (end of [js/game.js](js/game.js)) exposes the live `SEED`, `state`, `player`,
 `inv`, `raiders`, `animals`, `structures`, `robots`, `tracers`, `arrows`, `objects`, `lights`,
 `mouse`, `keys`, `settings`, `perf`, `STRUCTS`, `TOOLS` plus `placeObj`, `spawnRaider`,
 `spawnAnimal(kind, x, y)`, `buildStruct(tx, ty, type, tier)` (stages a construction site
 directly, no cost or validation), `finishBuild(o)`, `startGame`, `setTool`/`getTool`,
 `clickAction`, `fireArrow`, `tryDodge`, `treeRare`, and `step(dt, n)` — which runs `n`
 fixed-`dt` update ticks and one render. Set `DBG.freeze = true` to stop the rAF loop and step
 deterministically. Set `DBG.hideUI = true` to skip the HUD and seed tag (storefront / screenshot
 captures). Use this to stage a scene (place structures, jump `state.day`/`state.time`,
 spawn raiders) instead of playing to reach it.
- `?seed=N` pins the world (see [Determinism and noise](#determinism-and-noise)). Load the same
  seed twice to confirm a change is deterministic, or two different seeds to confirm worldgen
  actually varies. Without it every reload is a different world, which makes A/B screenshots
  meaningless.
- `POST /shot` in [serve.js](serve.js#L14) writes a base64 PNG body to `shot.png` in the repo
  root. Nothing in the client calls it; it is there for a headless driver doing
  `canvas.toDataURL()` → POST. `shot.png` is not gitignored — don't commit it.

## Architecture

Four IIFEs loaded in a fixed order by [index.html](index.html), communicating only through
globals. Order matters: each file's globals must exist before the next runs.

| File | Exposes | Role |
| --- | --- | --- |
| [js/font.js](js/font.js) | `drawPixelText`, `drawPixelTextShadow`, `pixelTextWidth` | 3×5 bitmap font, glyphs as 15-char strings; uppercase only, unknown chars render as `?` |
| [js/sprites.js](js/sprites.js) | `SPRITES` | every sprite as a char-grid + palette map, baked to offscreen canvases at load |
| [js/audio.js](js/audio.js) | `SFX` | WebAudio synth; no asset files |
| [js/game.js](js/game.js) | `DBG` | everything else — worldgen, sim, render, UI |

`game.js` is one ~2100-line IIFE with no internal module boundaries; it is organized by banner
comments (`// ---- constants / rng / state / world / actions / raiders / update / render / UI /
boot`). All game state lives in module-scope singletons: `state`, `settings`, `player`, `inv`,
`tool` (selected `TOOLS` index), and the arrays `raiders`, `animals`, `arrows`, `drops`,
`particles`, `floaters`, `footprints`, `lights`.

### One-camera fullscreen pixel rendering

Every player gets the **same camera** (the SC2/League model): the view always shows
`TARGET_ROWS` (270) rows of world — a 1920×1080 fullscreen is exactly 480×270 at 4×, and other
monitors buy sharpness with their extra pixels, never zoom. There is deliberately **no
resolution setting**; camera zoom is a gameplay feature (below), not a display one.
`VIEW_W`/`VIEW_H` are `let`s set by `fitCanvas()`:

- It picks an integer **device**-pixel scale (via `devicePixelRatio`, so game pixels land
  exactly on device pixels even under fractional 125%/150% OS scaling) closest to
  `deviceH / TARGET_ROWS`. `scale` is fractional in CSS px and must not be floored.
- Heights that don't divide cleanly (1440p → 5×, 288 rows) **"breathe"** a few percent rather
  than letterbox or blur — the Terraria/Stardew trade. 16:9 screens always fill edge-to-edge.
- `VIEW_W` is **capped at 16:9** (`ceil(VIEW_H * 16/9)`): wider-than-16:9 monitors get pillarbox
  bars instead of extra vision — the SC2 rule. Narrower screens simply see less width. A guard
  keeps the view at least 320×240 so the UI panels always fit.
- The bars are **themed, not black**: a second full-window canvas (`#bars`, z-order under
  `#game`, `pointer-events: none`) carries a static frost-panel frame — night slab, mottling,
  ice crystals, icicle fringes on the top and bottom edges, and an icy bevel hugging the game
  view — baked by
  `renderBars()` in the game palette. It spans `FULL_W` (the pre-cap window width in game px)
  and is deliberately darker than the world so the eye stays on the game; on ≤16:9 screens it
  is cleared and fully covered. It uses `hash2`, so it must never run before boot — it is baked
  once per canvas size by `relayout()`, never per frame, and the game never draws into it.

**Scroll-wheel camera zoom** rides on the same machinery: each `zoomStep` raises the integer
device-pixel scale by one (so every level stays pixel-perfect), zoom **out** is hard-capped at
the `TARGET_ROWS` baseline (the fairness ceiling — scrolling out never buys extra vision) and
zoom **in** at `MIN_ROWS` (150) rows, so the number of steps varies per monitor (`zoomMax`, set
by `fitCanvas()`). The wheel handler only bumps `zoomStep`; `update()` applies it by diffing
against `zoomEff` and calling `fitCanvas()`/`relayout()` — overlays (map/settings) and non-play
modes force base zoom so the fixed-size panels always fit, restoring on close. The whole
presentation zooms, HUD included. `DBG.setZoom(n)`/`DBG.getZoom()` drive it externally. The
scroll wheel does **not** switch tools anymore — that's keys 1–3 only.

**All game logic and drawing works in the `VIEW_W`×`VIEW_H` space** — mouse coords are divided
by `scale` on the way in. Round positions when drawing (`Math.round`) or sprites smear across
subpixels.

**Cross-file invariant:** any code path that changes the canvas size — window resize,
`fullscreenchange` — must call `fitCanvas()` then `relayout()`. `relayout()` recomputes
everything positioned off `VIEW_W`/`VIEW_H`: the minimap anchors, the map/settings panel
positions (`PANEL_X/Y`, `SET_X/Y`, `SL_X`, `ROW_*` — now `let`s; the offsets *within* each baked
panel stay fixed), `fitFlakes()`, which keeps snow density constant by topping up/trimming
the `flakes` array, and `renderBars()`, which re-bakes the pillarbox frame. Never write layout
code against a literal 480/270; `renderTitle()` shows the pattern for recentering a 270-authored
layout (`toy` offset).

`render()` keeps two camera offsets: tiles and other statics subtract the rounded `ox`/`oy`,
while moving entities (player, raiders, animals, drops, particles, floaters, swing arc) subtract
the exact `ex`/`ey` and round once at the end. Screen pos must be `round(world - camera)` with a
**single** rounding — rounding camera and entity separately makes their boundary crossings
disagree and the sprite vibrates ±1px against the background while walking (measured 48 flips/s),
which reads as ghosting on high-refresh displays. New entity draw code must use `ex`/`ey`.

### The tile world

- `WORLD = 192` tiles of `TILE = 16` px → a 3072×3072 px world.
- `ground` — `Uint8Array(192*192)`: `0` snow, `1` ice, `2` mine plaza.
- `objects` — flat `Array(192*192)`, **at most one object per tile**. Every object is
  `{ type, tx, ty, hp, flash, shake, ...extra }`. Types: `tree`, `stump`, `rock`, `bush`,
  `goldore`, `mine`, `wall`, `turret`, `generator`, `spawner`.
- Index with `idx(tx, ty)`, read safely with `objAt`, create with `placeObj`. Deleting is
  `objects[idx] = null` (structures should go through `destroyStructure` so lights rebuild and
  the `structures` registry stays in sync — it routes tiered types through `removeStruct`).
- `wall`, `turret`, `generator`, `spawner` are the **stump-built tiered structures** (see
  [Base building](#base-building)). Each carries `{ tier: 0|1|2, maxHp, building, buildT,
  buildTotal, dustT }` plus per-type fields (turret `cd`; generator `payT`; spawner `mode`,
  `bots`, `respawnT`), and every live one is also referenced from the module-scope `structures`
  array so per-frame ticks never scan the 36k grid. Stumps are **consumable build anchors**:
  building on one replaces it, and demolition/destruction leaves the tile empty, not a stump.
- The 2×2 `mine` occupies four tiles that each carry a `part` index; only `part === 0` is drawn.
- Every `tree` carries `rare`, set at worldgen from `treeRare(tx, ty)`: a `hash2` roll gives each
  tree a `TREE_RARE_CHANCE` (8%) shot at a bonus resource — `gold` for the scarcer ~30% of that
  band, `stone` otherwise, `null` for the rest. `hitObject()` pays it out (2 drops, plus a floater)
  only when the tree actually falls, on top of the usual wood. Being a position hash rather than an
  `rng()` draw, the roll is the same whenever it is asked — `DBG.treeRare(tx, ty)` reports it for
  any tile, occupied or not.

`renderGround()` pre-renders the *entire* 3072×3072 ground to one offscreen canvas at boot and
the frame loop just blits the camera window out of it. It is a one-time cost — never call it per
frame, and note that ground tiles cannot change at runtime without re-rendering.

### Determinism and noise

Every run picks a fresh `SEED` at boot from `Date.now() ^ Math.random()`, and **everything random
derives from it** — there is no other entropy source. `?seed=N` in the URL overrides it, which is
how you replay or diff a specific world. `drawSeedTag()` prints `SEED_TXT` bottom-right on every
frame (drawn last in `render()`, so it survives the map, settings, title, and death overlays), so
any screenshot carries the world it came from.

- `rng` is a single `mulberry32(SEED)` stream shared by worldgen *and* runtime effects (particle
  bursts, raider stats, drop velocities). Worldgen is reproducible only because it runs first at
  boot. **Adding or removing any `rng()` call inside `genWorld()` reshuffles the whole world**;
  adding one after boot does not.
- `hash2(x, y)` mixes `SEED` in, and `vnoise(x, y)` is built on it. Both are still pure functions
  of position *within a run* — use them for anything that must stay stable per tile no matter when
  it is asked (ground texture, forest boundary, tree rare-drops, panel mottling, map dithering).
  `borderDepth()` rides on `vnoise`, so the seed reshapes the forest and with it the whole map.
- One exception to the single stream: `fxRng` (a second `mulberry32` seeded from
  `SEED ^ 0x9e3779b9`) feeds resize-driven snowflake top-ups in `fitFlakes()`, precisely so that
  window size / resolution changes can never perturb the main `rng`'s worldgen prefix — the same
  seed yields the same world on every device (the boot-time 70 flakes still draw from `rng`,
  unchanged).
- `SEED` is a `const` in the rng banner and `hash2` closes over it, so nothing may call `hash2`
  before that line runs. Everything that does — `genWorld`, `renderGround`, the panel bakes — is
  further down in boot order.

### Day/night and the night wave

`DAY_LEN = 110`, `NIGHT_LEN = 55`, so a full `CYCLE` is 165 s. `state.time` runs within the cycle,
`state.day` increments at wrap. `update()` derives `state.darkness` (0→1) from a hand-written
ramp: dusk over the last 12 s of day, full dark, then a 10 s dawn.

Everything else keys off `state.darkness`, not `state.time`:

- `darkness > 0.65` opens the night wave — `toSpawn = min(22, 3 + (day-1)*2)` raiders that climb
  out of the mine at the world centre, trickled in by `spawnTimer`.
- `darkness < 0.3` ends it and **deletes every living raider** (`raiders.length = 0`).
- `darkness < 0.3` is also the only passive heal: slow daylight HP regen in `updatePlay()`.
  (There is no cold/warmth system — it was removed along with placeable campfires.)

Difficulty scales purely off `state.day`: raider HP `24 + (day-1)*7`, speed, contact damage
`8 + day`, and wave size. Fresh gold ore respawns at the fixed `oreSpots` each dawn.

### Tools and the bow

The old 4-slot hotbar (axe + placeable spike/torch/campfire) is gone. The player has three
infinite tools in the `TOOLS` table — `bow`, `axe`, `pick` — selected by keys **1–3** only
(`selectTool()` flashes the name above the bar via `state.toolMsgT`; the scroll wheel is the
camera zoom, not a tool cycler). The default
is the axe. Harvesting is **hard-gated** in `hitObject()`: trees need the axe, rock/gold ore
need the pickaxe; the wrong tool plays `SFX.deny` and floats `NEEDS AXE`/`NEEDS PICKAXE` with
no damage. Bushes and structures accept either melee tool. Axe and pickaxe still melee raiders
and animals, but only for `MELEE_DMG` (6) — the bow is the real weapon.

The bow is **hold-to-charge**: mousedown starts `player.charging`/`player.chargeT` (movement
slows to 55%, facing tracks the mouse, a draw meter renders above the player's health bar),
and mouseup fires via `fireArrow()` — power scales speed (170–360 px/s) and damage (4–13).
Arrows live in the `arrows` array, updated in `updatePlay()`: they die on solid tiles, on any
raider or animal hit (knockback scales with power), or after 0.85 s. They render as short
velocity-aligned lines in their own pass (using `ex`/`ey`) and never hit robots or structures.
Switching tools, opening an overlay, or dying drops the draw without firing; `BOW_CHARGE`
(0.9 s) is a full draw.

The selected tool is also drawn **on the player** by `drawHeldTool()` (called from
`drawPlayer()`): carried at the hand while idle/walking (mirrored via a `scale(-1,1)` transform
for `left`, drawn *before* the body sprite for `up` so it's occluded, 1px walk bob), swept along
the same arc as the swing effect during a melee swing, and rotated toward the mouse while the
bow is drawn — the bow icon fires along −x (arc on the left), so aim rotation is `a + PI`.
Raiders share the player grids but never get a held tool.

### Dodge roll

**Space** (`tryDodge()`) dashes the player in the held 8-way WASD direction (facing direction
if nothing is held): `DODGE_SPEED` (215) for `DODGE_T` (0.28 s) ≈ 60 px, with i-frames for the
whole roll (`player.invuln`). Two charges (`DODGE_CHARGES`), refilling **one at a time** every
`DODGE_CD` (3.5 s); state lives on `player` as `dodgeT/dodgeVX/dodgeVY/dodgeCharges/
dodgeRegenT/dodgeDustT`. While rolling, movement input, footprints, walk animation, and the
held tool are suppressed — the roll owns `moveEntity` (still collides with solids) and
`drawPlayer` swaps to a full 360° sprite spin with two afterimage ghosts trailing the velocity
plus dust bursts. The charge meter is two cyan pips on a plate directly beneath the overhead
health bar; the recharging slot fills left-to-right. Death cancels the roll, respawn refills
charges; overlays (map/settings/wheel/pause) block the input.

### Wildlife

`animals` holds passive fauna spawned once at boot by `spawnAnimals()` (called right after
`genWorld()`, so its `rng()` draws don't reshuffle the world layout): 8 rabbits (8 HP, biased to
spawn near berry bushes) and 5 deer (24 HP). Neither reproduces or respawns, and unlike raiders
they survive dawn. Behavior lives in `updateAnimal()`: both wander in idle/move bursts; when a
rabbit picks a new wander it drifts toward the nearest berried bush within 7 tiles
(`nearestBerryBush`) and idles ("nibbles") once within 22 px; rabbits also bolt when the player
comes within 26 px, and any axe hit sends either species fleeing directly away from the player
(`fleeT`). Deaths pay out in `updateAnimal`: rabbits drop 1 berry, deer drop 2-3 gold plus a
`GOLD!` floater. `swingHit()` checks animals alongside raiders (same `MELEE_DMG`), arrows hit
them too (and set `fleeT`), animals join the y-sorted `draws` pass via `drawAnimal()`, and
sprites are side-view only (`dir` is `left|right`). They are not shown on the minimap or world
map.

### Base building

Right-clicking a **stump** within 60 px opens a radial **build wheel** anchored at the stump's
screen position (clamped to stay on-screen): up = wall, right = turret, down = generator, left =
spawner (`STRUCT_ORDER`); release over a segment to build, release in the 10 px deadzone to
cancel. Right-clicking a **finished** structure opens a **manage wheel**: up = upgrade, down =
demolish, and (spawners only) right = mode toggle. This wheel is the **only** way to build —
there are no free-placed buildables. All the data lives in the `STRUCTS` table: three tiers per
type (wood → stone → gold) with `cost`, `hp`, `buildT`, and per-type stats. `tiers[0]` is what
the wheel builds; upgrading pays the next tier's cost and re-runs a shorter construction. Gold
is spent only here — it is the tier-3 cost.

Mechanics, all in `game.js`:

- `state.wheel` (`{kind:'build'|'manage', tx, ty, seg}`) is the open wheel; ESC/M/settings/death
  close it, left-click is swallowed while it's open, and the game **keeps running** — opening the
  wheel mid-night is deliberate pressure. `wheelLayout()` is shared by `resolveWheel()` and
  `renderWheel()` so hover math and pixels can never disagree.
- `placeStruct()` consumes the stump (the tile is **empty** after demolition — stumps are a
  finite site resource), pays `tiers[0].cost`, and drops the object into `building` state at 30%
  hp. It enforces the 60 px reach and the don't-entomb-yourself AABB check.
- **Construction**: `updateStructures()` (called from `updatePlay`, iterating only the
  `structures` registry) advances `buildT`, grows hp toward max, and puffs dust; the draws pass
  shows `SPRITES.scaffold[0|1]` under 2/3 progress, then the real sprite under the `scaffold[2]`
  lattice, and completion fires a particle burst + `SFX.place` + screen shake. A yellow progress
  bar renders above every site. Sites are solid and raider-attackable from placement.
- **Turret**: re-scans `raiders` for the nearest live target in range every shot (no stored
  refs, so the dawn wipe can't dangle); instant hit, gold tracer line pushed to `tracers`,
  knockback. **Generator**: pays 1 of its tier's resource (`wood`/`stone`/`gold`) every `period`
  seconds as a physical drop at its base, capped at 6 uncollected drops nearby. **Spawner**:
  keeps `tiers[tier].bots` robots alive (first fill immediate, replacements every 12 s), and
  `removeStruct()` kills its robots with it.
- Demolish and player melee destruction refund **50% of the cumulative cost across tiers**
  (`cumulativeCost`); raider destruction refunds nothing. `canAfford`/`pay`/`costText` are
  generic over every `inv` key.
- None of the four structures emits light (see [Lighting](#lighting)).

### Robots

`robots` holds the spawner-owned wooden units (re-baked `imp` grids, front-facing, 2 frames).
`updateRobot()` mirrors the animal state machine plus jobs, driven live by the owning spawner's
`mode`: **gather** — pick the nearest tree/rock/goldore within 8 tiles of the spawner
(`nearestObj`, the predicate generalisation of `nearestBerryBush`), work it in 0.9 s ticks into a
`carry` pouch (tree-fall leaves a stump and pays the rare bonus, exactly like `hitObject` minus
the drops), and walk home to deposit into `inv` with floaters at 3+ carried; **guard** — chase
and melee (5 dmg / 0.7 s) any raider within 5.5 tiles of the spawner, else loiter near home.
Raiders swat back for `8 + day` in `updateRaider`. Robots use `moveEntity` with the raider
jitter idiom, abandon a target after ~5 s stuck, survive dawn, die with their spawner, and are
reaped like animals. They join the y-sorted draws via `drawRobot()` and show a health bar; the
player's axe does **not** hit them (no friendly fire). Their SFX are gated on player proximity
(`nearPlayer`) so a remote base doesn't spam audio.

### Overhead health bars

`drawHealthBar()` draws a small color-coded bar (green → amber → red by hp fraction) above every
unit, always visible: the player (in `drawPlayer`, play mode only), raiders (in `drawRaider`,
replacing the old damaged-only sliver), animals (in `drawAnimal`), and robots (in `drawRobot`).
The player's bar is the **only** player health display — the old top-left Minecraft-style hearts
were removed in the HUD redesign (their sprites are still baked, unreferenced). While the bow is
drawn, a second small meter (white → gold at full draw) renders just above the player's bar.

### Damage feedback

`addDmgFloater(x, y, amount, taken)` pushes a combat damage number into the shared `floaters`
array: **gold** for damage the player's side deals (melee, arrows, turret shots, robot guard
melee), **red `-N`** for damage taken (`damagePlayer`, raider swats on robots). Numbers of 10+
render at 2× scale, and each gets a small random x-drift so rapid repeat hits stay readable.
Floater entries carry optional `vx`/`scale`/`rise` fields honored by the floaters render pass;
plain `addFloater` entries default to the old look. Units also flash white on hit via
`drawSpriteFlash` (0.8-alpha overlay). Raider hits on **structures** intentionally get no
numbers — a multi-raider siege would spam them; structures show flash, shake, and damage
cracks instead.

### Lighting

**Nothing currently emits light.** Campfires and torches were removed with the old hotbar, so
`rebuildLights()` just empties the `lights` array — but the whole pipeline is kept intact as
the single rebuild point for any future glowing object: `renderLighting()` punches `lights`
entries (`{x, y, r, warm}`) out of a dark overlay on the offscreen `lightCv` using
`destination-out`, then `drawWarmGlows()` adds `multiply` colour grading plus a `lighter` core.
**Any code that adds or removes a light-emitting object must call `rebuildLights()`.** The only
night light today is the player's personal glow (radius 44) baked into `renderLighting()`.
There is no warmth/cold system anymore — night darkness is purely visual pressure plus raiders.

### Render pass order

`render()` runs: ground blit → footprints → flat objects (stumps) → item drops → **y-sorted
`draws` array** (tall objects + player + raiders + animals + robots, sorted by feet Y) →
selection brackets (`drawSelection`: white pulsing corners with a dark shadow over the hovered
stump / finished structure, or the wheel's target) → construction progress bars → particles →
arrows → turret tracers → swing arc → floaters → `renderLighting` → `renderWeather` →
`renderVignettes` → `renderUI` → `renderWheel` (radial menu, above the UI) →
map/settings/title/death overlays. Anything that should be occluded by trees goes into `draws`
with a sort key; anything flat goes in the pre-pass.

Trees draw at `py - 8`, so a tree's canopy overhangs the bottom half of the tile *above* it.
Short ground sprites (rock, bush, goldore, stump) all draw at `py + 4` to stay clear of that
band — drop one lower and a tree on the tile below hides it almost completely.

Sprite hit-flash goes through `drawSpriteFlash()`, which recolours via a shared 32×32 `scratch`
canvas with `source-in` — sprites larger than 32×32 will clip.

### UI panels are baked once

`buildMapPanel()` and `buildSettingsPanel()` draw the static chrome (parchment, compass, labels)
into offscreen canvases at boot; per-frame code blits them and draws only the live parts on top.
Their layout variables (`PANEL_*`, `MAP_*`, `SET_*`, `SL_X`, `ROW_*`) are shared between the bake
function and the per-frame code, so both sides move together — but a bake-side change only appears
after the panel is rebuilt. The position variables are `let`s recentered by `relayout()` on every
canvas-size change; the bake draws in panel-relative coordinates (e.g. `ROW_FPS - SET_Y`), so a
recenter never requires a re-bake — keep any new row's bake-side label and per-frame widget
expressed the same way.

### Death is not game over

`die()` sets `mode = 'dead'`, drops any bow draw, keeps `ceil(60%)` of each resource, and after
2.6 s `respawn()` puts the player back at the original spawn pocket (`playerSpawn`, never the
raider-spewing world centre). `state.mode` is
`title | play | dead`; `updatePlay()` is skipped entirely while paused, dead, or with the map or
settings overlay open, but `update()` (time, darkness, spawn timers, camera, fx) keeps running.

### Settings

`settings` (`volume`, `mmR`, `shake`, `muted`, `fps`) persists to
`localStorage['emberfrost.settings']`. `applyMinimapSize()` must be called after changing `mmR` —
it recomputes `MM_R`/`MM_CX`/`MM_CY`, which the resource row in `renderUI()` also positions
itself against. (Old saves may still carry a `res` key from the removed resolution setting;
`Object.assign` in `loadSettings` copies it harmlessly and nothing reads it.)

There is no fullscreen control in the ESC menu (players use F11); a `fullscreenchange` listener
still refits the canvas when the browser toggles it.

`settings.fps` (toggle row in the ESC menu) shows a performance monitor: `loop()` accumulates raw
unclamped frame deltas into `perf` and refreshes `perf.fps` every half second; `drawFps()` prints
it in the extreme top-right corner, drawn just before the seed tag so it survives every overlay,
and turns red below 45. The elapsed clock in `renderMinimap()` sits centered beneath the
minimap, so it never collides with the fps readout.

### Audio

`SFX` creates its `AudioContext` lazily inside `ensure()`. Browsers require a user gesture, so
`SFX.unlock()` is called from click handlers — any new entry point that plays sound before the
first click needs to call it too.

## Working on sprites

Sprites are literal ASCII grids paired with a palette object mapping character → hex (or `null`
for transparent), baked by `bake()` at load. Left-facing variants are `flipH()` of the right ones.
Character sprites are 16×16; the player and raiders share the exact same grids with different
palettes (`PPAL` vs `RDPAL`), so a pose edit changes both. The tiered structures use the same
trick: one 16×16 grid each (`wall`, `turret`, `generator`, `spawner`) baked with `WPAL` /
`WPAL_STONE` / `WPAL_GOLD` into `SPRITES[type][tier]` arrays — a grid edit changes all three
tiers, and the palettes share the extra `k`/`K` (iron fitting) and `e` (glow) chars. The
construction stages are one shared `scaffold` set (`[posts, frame, lattice-overlay]`, `SCPAL`),
and the robot is the old `imp1`/`imp2` grids re-baked with the wooden `ROBPAL`. The tool-bar
icons (`itemBow`/`itemAxe`/`itemPick`) are 8×8 grids sharing `AXPAL` and are drawn at a crisp
2× in `renderUI()`. Wildlife is
side-view only — rabbits are 12×11 (sit) / 14×9 (hop), deer are 26×22 (stand + two walk frames
sharing a `deerHead` upper body) — and left variants are `flipH` of the right-facing grids.
Anything drawn through `drawSpriteFlash` must stay within 32×32.

`js/sprites.js` has a UTF-8 BOM and one heart row that repairs a mangled byte via
`'...'.replace('о', 'g')`. Preserve the file's encoding when editing — re-saving it as something
else will corrupt the grids.

## Checklists for common changes

**Adding an object type** — touch all of: `isSolidTile()` (if it blocks), `hitObject()` (what a
swing does to it — including which tool is allowed, see the gating block at its top), the flat
pass or the `draws` y-sort in `render()`, `updateMinimap()`'s colour table,
`buildWorldMapImg()`'s colour table, and `rebuildLights()` if it glows. The two map colour
tables are the easy ones to forget — a missing entry silently draws as a stump.

**Adding a tool** — append to `TOOLS` (order = bar slot; the `1`–`3` key handler is generic
over `TOOLS.length`, but a fourth tool needs the key range in the keydown handler widened), add
an 8×8 icon sprite and name it in the entry's `icon` field, and give its `key` behavior in
`clickAction()` / `hitObject()`'s gating.

**Adding a stump-built structure** — add a `STRUCTS` entry (3 tiers) and its wheel slot in
`STRUCT_ORDER` (the build wheel draws `SPRITES[type][0]` directly), a `[wood, stone, gold]`
sprite array, entries in `isSolidTile()`, both map colour tables, and a functional tick branch in
`updateStructures()`. `hitObject()`, the raider attack check, the draws pass, construction, and
refunds already dispatch on `STRUCTS[o.type]` — no per-type work there.

**Adding a ground type** — extend `renderGround()`, `updateMinimap()`, and `buildWorldMapImg()`,
and remember `genWorld()`'s `free()` helper treats "ground must be 0" as the placement rule.

**Tuning balance** — the numbers live inline: `STRUCTS` costs/HP/build times (plus turret
range/dmg/rate, generator period, spawner bot counts/HP), `spawnRaider()` stat formulas, the
`state.day` terms in `updateRaider()`, robot melee in `updateRobot()`, `MELEE_DMG` and
`BOW_CHARGE` in the constants banner, the arrow speed/damage formulas in `fireArrow()`,
`TREE_RARE_CHANCE` and the gold/stone split in `treeRare()`, and the darkness ramp in
`update()`.

## Known drift

- [README.md](README.md) is a storefront page (hero + mechanic shots in `docs/media/`), not a
  tech guide — no run instructions, controls list, or code layout. Those live here.
- `SPRITES.imp` is still baked with its old ice palette and unreferenced, but its *grids* are
  now the robot sprite — don't delete them.
- `SPRITES.spikes`, `SPRITES.fire`, `SPRITES.torch`, and the three heart sprites are baked but
  unreferenced since the buildables/HUD removal — kept in case those features return (the heart
  grids also carry the file's mangled-byte repair).
- The `<` and `>` glyphs in [js/font.js](js/font.js) were added for the removed resolution
  cycle control and are currently unreferenced — kept as generic font coverage.
