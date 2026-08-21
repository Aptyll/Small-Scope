# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Emberfrost — a browser canvas pixel-art winter survival game. Gather with three tool-gated
tools (bow, axe, pickaxe), build structures on stumps, and travel fast via a momentum system
(slippery frozen rivers, chained dodges, shift-sliding). The central gold mine and the
night raider waves were removed — night is currently visual-only (darkness, no threat).

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
 `inv`, `animals`, `structures`, `robots`, `tracers`, `arrows`, `objects`, `ground`, `lights`,
 `mouse`, `keys`, `settings`, `perf`, `STRUCTS`, `TOOLS` plus `placeObj`,
 `spawnAnimal(kind, x, y)`, `buildStruct(tx, ty, type, tier)` (stages a construction site
 directly, no cost or validation), `finishBuild(o)`, `startGame`, `setTool`/`getTool`,
 `clickAction`, `fireArrow`, `tryDodge`, `treeRare`, `cursorInfo` (the resolved pointer state
  for the current `mouse` position — see [Cursor](#cursor)), and `step(dt, n)` — which runs `n`
 fixed-`dt` update ticks and one render. Set `DBG.freeze = true` to stop the rAF loop and step
 deterministically. Set `DBG.hideUI = true` to skip the HUD and seed tag (storefront / screenshot
 captures). Use this to stage a scene (place structures, jump `state.day`/`state.time`)
 instead of playing to reach it.
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
comments (`// ---- constants / rng / state / world / actions / update / render / UI /
boot`). All game state lives in module-scope singletons: `state`, `settings`, `player`, `inv`,
`tool` (selected `TOOLS` index), and the arrays `animals`, `arrows`, `drops`,
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
while moving entities (player, animals, robots, drops, particles, floaters, swing arc) subtract
the exact `ex`/`ey` and round once at the end. Screen pos must be `round(world - camera)` with a
**single** rounding — rounding camera and entity separately makes their boundary crossings
disagree and the sprite vibrates ±1px against the background while walking (measured 48 flips/s),
which reads as ghosting on high-refresh displays. New entity draw code must use `ex`/`ey`.

### The tile world

- `WORLD = 232` tiles of `TILE = 16` px → a 3712×3712 px world. The forest border keeps its
  original depth (`BORDER_MIN`/`BORDER_MAX` 30–70, avg ~50), so the growth all went into the
  open interior (~132 tiles across, double the old ~92²'s area); interior feature counts
  (ponds, rock clusters, bushes, wildlife) were doubled to hold density. `SPAWN_D` is derived
  (`WORLD / 2 - 55`) so the camps stay 55 tiles from the world edge, nestled at the treeline.
- `ground` — `Uint8Array(WORLD²)`: `0` snow, `1` ice, `2` open-water hole (runtime-only, see
  [Ice holes and fishing](#ice-holes-and-fishing)). Ice is **mechanically slippery** (see
  [Momentum movement](#momentum-movement-player-only)), and worldgen carves it as a travel
  network: 14 frozen lakes plus winding ~5-tile-wide rivers (`carveRiver` in `genWorld()`) —
  a spoke from each camp to the central ore field and a ring linking adjacent camps. The
  shared `carveIce` rule skips existing objects, the camps, and the ore field, so rivers gap
  naturally around them.
- `objects` — flat `Array(192*192)`, **at most one object per tile**. Every object is
  `{ type, tx, ty, hp, flash, shake, ...extra }`. Types: `tree`, `stump`, `rock`, `bush`,
  `goldore`, `wall`, `turret`, `generator`, `spawner`.
- Index with `idx(tx, ty)`, read safely with `objAt`, create with `placeObj`. Deleting is
  `objects[idx] = null` (structures should go through `destroyStructure` so lights rebuild and
  the `structures` registry stays in sync — it routes tiered types through `removeStruct`).
- `wall`, `turret`, `generator`, `spawner` are the **stump-built tiered structures** (see
  [Base building](#base-building)). Each carries `{ tier: 0|1|2, maxHp, building, buildT,
  buildTotal, dustT }` plus per-type fields (turret `cd`; generator `payT`; spawner `mode`,
  `bots`, `respawnT`), and every live one is also referenced from the module-scope `structures`
  array so per-frame ticks never scan the 36k grid. Stumps are **consumable build anchors**:
  building on one replaces it, and demolition/destruction leaves the tile empty, not a stump.
- The world center holds a ring of `goldore` at the fixed `oreSpots` (respawned each dawn);
  `CENTER_R` in `genWorld()` keeps ice ponds, rocks, and bushes clear of it.
- Every `tree` carries `rare`, set at worldgen from `treeRare(tx, ty)`: a `hash2` roll gives each
  tree a `TREE_RARE_CHANCE` (8%) shot at a bonus resource — `gold` for the scarcer ~30% of that
  band, `stone` otherwise, `null` for the rest. `hitObject()` pays it out (2 drops, plus a floater)
  only when the tree actually falls, on top of the usual wood. Being a position hash rather than an
  `rng()` draw, the roll is the same whenever it is asked — `DBG.treeRare(tx, ty)` reports it for
  any tile, occupied or not.

`renderGround()` pre-renders the *entire* 3712×3712 ground to one offscreen canvas at boot and
the frame loop just blits the camera window out of it. It is a one-time cost — never call it per
frame. The per-tile painter is factored out as `paintGroundTile(g, tx, ty)`, and a runtime
ground change must call `repaintGround(tx, ty)` — it repaints the tile plus its four neighbors
(edge rims depend on neighbors) into the prerendered canvas. Ice holes are currently the only
runtime ground change.

### Determinism and noise

Every run picks a fresh `SEED` at boot from `Date.now() ^ Math.random()`, and **everything random
derives from it** — there is no other entropy source. `?seed=N` in the URL overrides it, which is
how you replay or diff a specific world. `drawSeedTag()` prints `SEED_TXT` bottom-right on every
frame (drawn last in `render()`, so it survives the map, settings, title, and death overlays), so
any screenshot carries the world it came from.

- `rng` is a single `mulberry32(SEED)` stream shared by worldgen *and* runtime effects (particle
  bursts, animal wanders, drop velocities). Worldgen is reproducible only because it runs first at
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

### Day/night

`DAY_LEN = 110`, `NIGHT_LEN = 55`, so a full `CYCLE` is 165 s. `state.time` runs within the cycle,
`state.day` increments at wrap. `update()` derives `state.darkness` (0→1) from a hand-written
ramp: dusk over the last 12 s of day, full dark, then a 10 s dawn.

With the raider waves removed, night is purely visual pressure (darkness + lighting). What still
keys off the cycle:

- `darkness < 0.3` gates the only passive heal: slow daylight HP regen in `updatePlay()`.
  (There is no cold/warmth system — it was removed along with placeable campfires.)
- Fresh gold ore respawns at the fixed `oreSpots` each dawn.
- Carved ice holes refreeze at dawn (cracks heal too) and the fish shoal tops back up to
  `FISH_COUNT` — see [Ice holes and fishing](#ice-holes-and-fishing).

`state.day` no longer drives any difficulty — nothing hostile exists, so nothing currently
damages the player (`damagePlayer`/`die`/`respawn` are kept intact for whatever threat comes
next).

### Momentum movement (player-only)

The player moves on a real velocity (`player.vx/vy`): input accelerates, and the surface
underfoot sets friction and speed caps. All the tuning constants live in the constants banner
(`ICE_MAX`, `SLIDE_MIN`/`SLIDE_EXIT`, `TRAIL_MIN`) and the per-surface rates inline in
`updatePlay()`'s movement block. **Momentum is deliberately player-only** — animals, robots,
and knockback still use the old direct-move idiom.

- **Snow at walking speed** uses a near-instant vector approach (settles in ~3 frames) tuned to
  feel exactly like the old fixed `PLAYER_SPEED` — crisp starts and stops, nothing floaty.
- **Everything faster** (ice, sliding, or overspeed on snow) switches to a steer-the-heading /
  ease-the-speed model: the travel direction *rotates* toward the input at a per-state rad/s
  rate (carving, never snapping), while speed eases toward a per-state target. Ice pumps
  toward `ICE_MAX` (150, ~2× walk) while a direction is held, glides on idle, and barely
  bleeds overspeed; snow kills overspeed (dodge exits included) in well under a second
  unless you shift-slide to keep it.
- **Dodge roll** is an impulse into the same velocity: `tryDodge()` sets `vx/vy` to
  `max(DODGE_SPEED, current speed)` (a dash never slows you), the roll itself applies no
  friction, and the speed **carries out of the roll** for the surface to spend — so dashes
  chain into real speed on ice but die fast on snow. I-frames still end with the roll.
- **Shift = slide**: engages only above `SLIDE_MIN` (85), drops out below `SLIDE_EXIT` (55) or
  on release (hysteresis). Sliding keeps momentum across snow (low friction, reduced steering),
  drops any bow draw, and blocks all tool use (`clickAction` and the held-button auto-swing
  both check `player.sliding`). Snow slides have **fatigue** (`player.slideT`): friction ramps
  with slide duration, so the early glide is cheap but the tail drops off hard and a slide
  ends decisively (~2.2 s from full speed). The timer recovers while sliding on ice, so
  snow→ice→snow chains start each snow leg fresh-ish; ice slide friction itself is flat. Above `TRAIL_MIN` (110) it carves a surface-specific double
  trail: on snow, two-tone carved grooves (shadowed top row, lit bottom row — lit from the
  top-left like the rest of the art); on ice, thin frosted skate scratches. Marks are
  `k`-tagged entries pushed into the existing `footprints` decal array (cap 800) every ~2.5px
  of travel, interpolated along the path so a fast frame never gaps the line — never drawn
  into the pre-rendered ground canvas — plus snow-spray particle bursts. Snow grooves have
  their own short hold-then-fade life (`SNOW_TRAIL_LIFE` 3.5 s, fading only over the last
  `SNOW_TRAIL_FADE` 1.4 s), so a trail stays crisp and then wipes away tail-first behind the
  player; ice scratches and walking footprints keep the original 9 s linear fade.
- **Walls kill the blocked axis** (`blockedX` → `vx = 0`, same for y) in both the roll and
  normal movement, so you never grind along a treeline at full speed.
- Walk animation and footprints key off actual speed now (`sp > 8`), not input; sliding and
  ice-gliding use the standing pose. `die()`/`respawn()` zero `vx/vy` and clear `sliding`.

### Tools and the bow

The old 4-slot hotbar (axe + placeable spike/torch/campfire) is gone. The player has three
infinite tools in the `TOOLS` table — `bow`, `axe`, `pick` — selected by keys **1–3** only
(`selectTool()` flashes the name above the bar via `state.toolMsgT`; the scroll wheel is the
camera zoom, not a tool cycler). The default
is the axe. Harvesting is **hard-gated** in `hitObject()`: trees need the axe, rock/gold ore
need the pickaxe; the wrong tool plays `SFX.deny` and floats `NEEDS AXE`/`NEEDS PICKAXE` with
no damage. Bushes and structures accept either melee tool. A pick swing that finds no object
over bare ice cracks it toward a fishing hole (see
[Ice holes and fishing](#ice-holes-and-fishing)). Axe and pickaxe still melee animals,
but only for `MELEE_DMG` (6) — the bow is the ranged weapon.

The bow is **hold-to-charge**: mousedown starts `player.charging`/`player.chargeT` (movement
targets scale to 55% — walk speed and the ice cap both — facing tracks the mouse, a draw meter
renders above the player's health bar),
and mouseup fires via `fireArrow()` — power scales speed (170–360 px/s) and damage (4–13).
Arrows live in the `arrows` array, updated in `updatePlay()`: they die on solid tiles, on any
animal hit (knockback scales with power), or after 0.85 s. They render as short
velocity-aligned lines in their own pass (using `ex`/`ey`) and never hit robots or structures.
Switching tools, opening an overlay, or dying drops the draw without firing; `BOW_CHARGE`
(0.9 s) is a full draw.

While the bow is drawn, `drawAimLine()` (called from `render()` right before the arrows pass,
using `ex`/`ey`) shows the shot: a static line of 2×2 drop-shadowed dots from the arrow's spawn
point along the exact direction `fireArrow()` uses. Both aim from `player.y - BOW_Y` (6 px above
the feet, where the arrow spawns) — not the feet — so the line and the flight pass exactly
through the cursor instead of running parallel a few px above it. The
line is **truthful, not decorative** — it runs exactly as far as the arrow would fly
(`(170 + 190p) × 0.85`, so it lengthens with the draw), stops at the first `isSolidTile`
along the path with an impact cross (arrows die on solids), and otherwise ends in a short
perpendicular range-cap bar. Colour follows the draw meter: yellow charging, hot orange at
full. If the player stands on ice with a fish inside `FISH_CATCH_R` the line is replaced by
four ticks closing over that fish, because that shot becomes the catch and never flies.

The selected tool is also drawn **on the player** by `drawHeldTool()` (called from
`drawPlayer()`): carried at the hand while idle/walking (mirrored via a `scale(-1,1)` transform
for `left`, drawn *before* the body sprite for `up` so it's occluded, 1px walk bob), swept along
the same arc as the swing effect during a melee swing, and rotated toward the mouse while the
bow is drawn — the bow icon fires along −x (arc on the left), so aim rotation is `a + PI`.

### Dodge roll

**Space** (`tryDodge()`) dashes the player in the held 8-way WASD direction (facing direction
if nothing is held): an impulse of `max(DODGE_SPEED (215), current speed)` into `player.vx/vy`
for `DODGE_T` (0.28 s), with i-frames for the roll only (`player.invuln` — momentum carried
past the roll gets no i-frames). Two charges (`DODGE_CHARGES`), refilling **one at a time**
every `DODGE_CD` (3.5 s); state lives on `player` as `dodgeT/dodgeVX/dodgeVY/dodgeCharges/
dodgeRegenT/dodgeDustT` (`dodgeVX/VY` exist only for the spin/ghost render — movement runs on
`vx/vy`). While rolling, movement input, friction, footprints, walk animation, and the held
tool are suppressed (still collides with solids; a wall zeroes that axis), and `drawPlayer`
swaps to a full 360° sprite spin with two afterimage ghosts trailing the velocity plus dust
bursts. The roll's exit speed is spent by the surface — see
[Momentum movement](#momentum-movement-player-only). The charge meter is a single unsegmented cyan stamina
bar on a plate directly beneath the overhead health bar — charges stay discrete in the sim,
the bar shows the pooled total (full charges + regen progress). Spending a charge leaves a
pale ghost of the lost chunk (`player.stamGhost`/`stamGhostT`): it holds ~0.3 s, then drains
into the live fill souls-style. Death cancels the roll, respawn refills
charges; overlays (map/settings/wheel/pause) block the input.

### Wildlife

`animals` holds passive fauna spawned once at boot by `spawnAnimals()` (called right after
`genWorld()`, so its `rng()` draws don't reshuffle the world layout): 16 rabbits (8 HP, biased to
spawn near berry bushes) and 10 deer (24 HP). Neither reproduces or respawns.
Behavior lives in `updateAnimal()`: both wander in idle/move bursts; when a
rabbit picks a new wander it drifts toward the nearest berried bush within 7 tiles
(`nearestBerryBush`) and idles ("nibbles") once within 22 px; rabbits also bolt when the player
comes within 26 px, and any axe hit sends either species fleeing directly away from the player
(`fleeT`). Deaths pay out in `updateAnimal`: rabbits drop 1 berry, deer drop 2-3 gold plus a
`GOLD!` floater. `swingHit()` checks animals first (same `MELEE_DMG`), arrows hit
them too (and set `fleeT`), animals join the y-sorted `draws` pass via `drawAnimal()`, and
sprites are side-view only (`dir` is `left|right`). They are not shown on the minimap or world
map.

### Ice holes and fishing

The pickaxe works on **bare ice tiles** (no object): each swing that finds no object while the
pick is selected calls `crackIce(tx, ty)` on the reach-point tile. Hits accumulate in the
`iceCracks` map (`tile idx → hits`, rendered as bright fracture decals in their own pass);
`ICE_HOLE_HITS` (3) breaks through — the tile becomes `ground = 2` (open water), joins the
`holes` list, and is repainted into the ground canvas via `repaintGround()`. Constants live in
the constants banner (`ICE_HOLE_HITS`, `HOLE_FALL_DMG`, `HOLE_FALL_T`, `FISH_COUNT`,
`FISH_CATCH_R`).

- **Falling in**: standing over a hole tile (checked at the player's feet in `updatePlay`)
  plunges the player: `HOLE_FALL_DMG` (15) via `damagePlayer`, velocity zeroed, and
  `player.fallT` runs `HOLE_FALL_T` (1.1 s) of floundering — no movement, tools, dodge, or
  slide (`clickAction`, the auto-swing, and `tryDodge` all check `fallT`). `drawPlayer` clips
  the sprite to the waterline with ripple rects. The climb-out teleports to
  `nearestDryTile()` with brief i-frames. An **active dodge roll crosses holes safely**
  (the fall check skips while `dodgeT > 0`). `die()`/`respawn()` clear `fallT`.
- **Everyone else avoids water**: `moveEntity` treats hole tiles as solid for every entity
  except the player, so animals and robots never wade in. `isSolidTile` itself is unchanged —
  arrows still fly over holes.
- **Refreeze**: at dawn every hole reverts to ice (`repaintGround` again) and `iceCracks`
  clears, alongside the ore respawn.
- **Fish**: the `fish` array holds `FISH_COUNT` (30) passive swimmers spawned at boot
  (`spawnFish()`, after `spawnAnimals()`) on **interior** ice only (tile centers passing
  `fishClear` with a 14 px margin, ~a tile off the shore). `updateFish()` wanders them with a
  **soft edge cap**: `fishClear(x, y)` requires `FISH_MARGIN` (6 px) of water on all four sides
  of the body, the steering veers away from shore a look-ahead early (choosing the more open
  side, falling back to the fish's per-fish `ts` turn bias), and movement is hard-clamped —
  a position that would poke the body into snow is never committed, so fish can't visually
  overlap the shoreline. They render as translucent silhouettes
  through the ice — brighter and surfaced inside an open hole — in a pass right after the
  ground blit (using `ex`/`ey`). Cracking ice spooks nearby fish into a fast dart.
- **Bow-fishing**: `fireArrow()` first checks whether the player stands on an ice tile with a
  fish within `FISH_CATCH_R` (16 px); if so the shot becomes the catch (any charge level):
  `inv.fish++`, splash, no arrow. Fish are food: **F** eats one for +50 HP (`eatFish`, mirroring
  the berry's Q/+20), with a count indicator under the berry indicator top-left
  (`SPRITES.itemFish`, 8×8, own `FIPAL`). The shoal tops back up to `FISH_COUNT` each dawn,
  never within 120 px of the player. `SFX.splash()` was added for the water sounds. `DBG`
  exposes `fish`, `iceCracks`, `holes`, `crackIce`, `addFish`.

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
  bar renders above every site. Sites are solid from placement.
- **Turret**: currently idle — its targeting/firing tick was removed with the raiders, so it is
  a decorative buildable until a new threat exists (the `tracers` array and its render pass are
  kept for that). **Generator**: pays 1 of its tier's resource (`wood`/`stone`/`gold`) every `period`
  seconds as a physical drop at its base, capped at 6 uncollected drops nearby. **Spawner**:
  keeps `tiers[tier].bots` robots alive (first fill immediate, replacements every 12 s), and
  `removeStruct()` kills its robots with it.
- Demolish and player melee destruction refund **50% of the cumulative cost across tiers**
  (`cumulativeCost`). `canAfford`/`pay`/`costText` are generic over every `inv` key.
- None of the four structures emits light (see [Lighting](#lighting)).

### Robots

`robots` holds the spawner-owned wooden units (re-baked `imp` grids, front-facing, 2 frames).
`updateRobot()` mirrors the animal state machine plus jobs, driven live by the owning spawner's
`mode`: **gather** — pick the nearest tree/rock/goldore within 8 tiles of the spawner
(`nearestObj`, the predicate generalisation of `nearestBerryBush`), work it in 0.9 s ticks into a
`carry` pouch (tree-fall leaves a stump and pays the rare bonus, exactly like `hitObject` minus
the drops), and walk home to deposit into `inv` with floaters at 3+ carried; **guard** — with
raiders removed it just loiters near home (the mode toggle is kept for a future threat).
Robots use `moveEntity`, abandon a target after ~5 s stuck, die with their spawner, and are
reaped like animals. They join the y-sorted draws via `drawRobot()` and show a health bar; the
player's axe does **not** hit them (no friendly fire). Their SFX are gated on player proximity
(`nearPlayer`) so a remote base doesn't spam audio.

### Overhead health bars

`drawHealthBar()` draws a small color-coded bar (green → amber → red by hp fraction) above every
unit, always visible: the player (in `drawPlayer`, play mode only), animals (in `drawAnimal`),
and robots (in `drawRobot`).
The player's bar is the **only** player health display — the old top-left Minecraft-style hearts
were removed in the HUD redesign (their sprites are still baked, unreferenced). While the bow is
drawn, a second small meter renders just above the player's bar: yellow while charging,
turning hot orange at full draw (two discrete states — a gradient is unreadable at 14 px). The player's overhead stack floats clear of the sprite: stamina plate at `py - 4`,
health at `py - 7`, draw meter at `py - 12`.

### Cursor

The native pointer is hidden over the canvas and a **pixel-art cursor is drawn in-canvas** as
the very last thing in `render()` (above every overlay and the seed tag), so it sits on the
game's pixel grid at every zoom level. `cursorInfo()` resolves the pointer state once per
frame from `mouse`, `state`, `tool`, and what's under the pointer, and both the pixel cursor
and the browser-cursor fallback read from it. It returns `{ kind, mode, dim, frac }`:

- `kind` **arrow** — title, dead, paused, map, and anywhere in the settings/wheel that isn't
  a widget; **hand** — over a settings widget (`settingsHit()`, shared with the click handler
  so hover and click can never disagree) or a live wheel segment; **grab** — dragging a
  slider; **hammer** — over a stump or finished structure (right-clickable; `dim` beyond the
  60 px reach); **reticle** — everywhere else in play.
- Reticle `mode` (table `RETICLE`): **idle** white cross; **lock** gold ring — the held tool
  can work the object under the pointer (tree+axe, rock/ore+pick, berried bush+melee);
  **bad** red with a centre slash — the wrong tool, mirroring `hitObject()`'s gating;
  **hunt** amber breathing ring over an animal; **ice** pale-blue ring over bare ice with the
  pick (crackable); **bow** — while charging the ring closes as the draw fills and turns
  orange at full, like the meter. `dim` (50% alpha) means tools are blocked right now:
  sliding, floundering in a hole, or mid-roll.
- Sprites live in `SPRITES.cursor.{arrow,hand,grab,hammer}` (`CUPAL`, lit top-left, icy
  bevel) with one-colour `SPRITES.cursorShadow` twins drawn 1 px offset beneath; hotspots are
  in `CUR_HOT`. Reticles are procedural via `drawOutlinedRects()` (dark rim pass, then fill),
  which the aim line's markers reuse.
- `settings.pixelCursor` (default **on**, the CURSOR row in the ESC menu: PIXEL/BROWSER)
  switches to the native pointer; `applyCursorStyle()` then maps the same state to the
  nearest CSS cursor (`crosshair`/`pointer`/`grabbing`/`default`) and sets
  `canvas.style.cursor` only on change. `mouse.inside` (set by mousemove, cleared by
  `mouseleave` on the canvas and document) hides the drawn cursor when the pointer leaves,
  and `DBG.hideUI` hides it for captures.

### Damage feedback

`addDmgFloater(x, y, amount, taken)` pushes a combat damage number into the shared `floaters`
array: **gold** for damage the player's side deals (melee, arrows), **red `-N`** for damage
taken (`damagePlayer` — currently unreachable, since nothing hostile exists). Numbers of 10+
render at 2× scale, and each gets a small random x-drift so rapid repeat hits stay readable.
Floater entries carry optional `vx`/`scale`/`rise` fields honored by the floaters render pass;
plain `addFloater` entries default to the old look. Units also flash white on hit via
`drawSpriteFlash` (0.8-alpha overlay). Hits on **structures** intentionally get no numbers;
structures show flash, shake, and damage cracks instead.

### Lighting

**Nothing currently emits light.** Campfires and torches were removed with the old hotbar, so
`rebuildLights()` just empties the `lights` array — but the whole pipeline is kept intact as
the single rebuild point for any future glowing object: `renderLighting()` punches `lights`
entries (`{x, y, r, warm}`) out of a dark overlay on the offscreen `lightCv` using
`destination-out`, then `drawWarmGlows()` adds `multiply` colour grading plus a `lighter` core.
**Any code that adds or removes a light-emitting object must call `rebuildLights()`.** The only
night light today is the player's personal glow (radius 44) baked into `renderLighting()`.
There is no warmth/cold system anymore — night darkness is purely visual.

### Render pass order

`render()` runs: ground blit → under-ice fish → ice-crack decals → footprints → flat objects
(stumps) → item drops → **y-sorted
`draws` array** (tall objects + player + animals + robots, sorted by feet Y) →
selection brackets (`drawSelection`: white pulsing corners with a dark shadow over the hovered
stump / finished structure, or the wheel's target) → construction progress bars → particles →
arrows → turret tracers → swing arc → floaters → `renderLighting` → `renderWeather` →
`renderVignettes` → `renderUI` → `renderWheel` (radial menu, above the UI) →
map/settings/title/death overlays → fps/seed tags → the pixel cursor (always last). The bow's
`drawAimLine` sits between the particles and the arrows pass. Anything that should be occluded by trees goes into `draws`
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

The map panel's bake keeps a fixed 192×192 map slot; the world is bigger than that, so
`renderWorldMap()` blits `mapCv` scaled by `MAP_S = MAP_W / WORLD` and every tile-space
position drawn on top (grid lines, camera rect, player marker) must be multiplied by `MAP_S`.
The minimap needs no such factor — it is a scrolling 1px-per-tile viewport, not a whole-world
view.

### Death is not game over

`die()` sets `mode = 'dead'`, drops any bow draw, keeps `ceil(60%)` of each resource, and after
2.6 s `respawn()` puts the player back at the original spawn pocket (`playerSpawn`).
`state.mode` is
`title | play | dead`; `updatePlay()` is skipped entirely while paused, dead, or with the map or
settings overlay open, but `update()` (time, darkness, camera, fx) keeps running. With nothing
hostile in the game, `die()` is currently unreachable but kept working.

### Settings

`settings` (`volume`, `mmR`, `shake`, `muted`, `fps`, `pixelCursor`) persists to
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
Character sprites are 16×16; the raider set (`SPRITES.raider`, `RDPAL`) is baked from the exact
same grids as the player, so a player pose edit changes both. The tiered structures use the same
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
`buildWorldMapImg()`'s colour table, `rebuildLights()` if it glows, and `cursorInfo()` if the
pointer should react to it (lock/bad per tool). The two map colour
tables are the easy ones to forget — a missing entry silently draws as a stump.

**Adding a tool** — append to `TOOLS` (order = bar slot; the `1`–`3` key handler is generic
over `TOOLS.length`, but a fourth tool needs the key range in the keydown handler widened), add
an 8×8 icon sprite and name it in the entry's `icon` field, and give its `key` behavior in
`clickAction()` / `hitObject()`'s gating — and mirror that gating in `cursorInfo()` so the
reticle's lock/bad hint stays truthful.

**Adding a stump-built structure** — add a `STRUCTS` entry (3 tiers) and its wheel slot in
`STRUCT_ORDER` (the build wheel draws `SPRITES[type][0]` directly), a `[wood, stone, gold]`
sprite array, entries in `isSolidTile()`, both map colour tables, and a functional tick branch in
`updateStructures()`. `hitObject()`, the draws pass, construction, and
refunds already dispatch on `STRUCTS[o.type]` — no per-type work there.

**Adding a ground type** — extend `paintGroundTile()`, `updateMinimap()`, and `buildWorldMapImg()`,
give it a surface branch in `updatePlay()`'s momentum block (steer/decay/target rates — ice is
the template), and remember `genWorld()`'s `free()` helper treats "ground must be 0" as the
placement rule.

**Tuning balance** — the numbers live inline: `STRUCTS` costs/HP/build times (plus turret
range/dmg/rate, generator period, spawner bot counts/HP), `MELEE_DMG`, `BOW_CHARGE`, and the
momentum constants (`ICE_MAX`, `SLIDE_MIN`/`SLIDE_EXIT`, `TRAIL_MIN`) in the constants banner,
the per-surface steer/decay rates inline in `updatePlay()`'s movement block,
the arrow speed/damage formulas in `fireArrow()`,
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
- `SPRITES.raider` (+ `RDPAL`) and `SPRITES.mine` are still baked but unreferenced since the
  raider/mine removal — kept in case a threat returns; the raider set shares the player grids.
- `SFX.nightSting` and `SFX.monsterDie` in [js/audio.js](js/audio.js) are unreferenced since
  the raider removal.
- With nothing hostile, `damagePlayer`/`die`/`respawn`, the turret type (its tick is an idle
  no-op), the spawner's guard mode (loiters), and the `tracers` pass are all kept working but
  currently have no trigger.
