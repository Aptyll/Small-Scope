# Gameplay systems

The player (momentum, tools, dodge), the entities that share the world, the gold economy, what
you can build, and the supporting subsystems. Read this before changing how an input resolves,
what something pays out, or what a structure does.

## Momentum movement (player-only)

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
  on release (hysteresis). Sliding keeps momentum across snow (low friction, reduced steering).
  Tools work normally while sliding — you can draw, hold, and loose the bow or E a tree
  mid-slide; only the hole-flounder and the dodge roll lock tools out. Snow slides have **fatigue** (`player.slideT`): friction ramps
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

## Tools and the bow

There is **no tool bar and no tool selection**. `TOOLS` (`bow`, `axe`, `pick`, indices
`TOOL_BOW/AXE/PICK`) is an internal table for icons and names; `player.tool` is the *held*
index, which is the bow at rest. The bottom strip of the HUD is deliberately empty — it is reserved
for combat abilities. Two verbs, two inputs:

- **Left click = bow**, always (`clickAction`).
- **E = work** (`tryWork`, auto-repeating every swing cooldown while held — `updatePlay`
  calls it whenever `keys['e']` is down). It resolves `workTarget()`: the tile under the
  cursor, if it holds a tree (→ axe), rock (→ pick), a berried bush (→ axe), or is
  bare ice with no object (→ pick, cracking toward a fishing hole); and `near` = the tile is
  within `WORK_REACH` (1) tiles, Chebyshev, of the tile the player stands on — i.e. the 3×3
  ring around you, never a second row, regardless of where in your tile you stand. Out of reach or nothing workable, E
  does nothing. A valid target swaps `player.tool` to the right one, drops any bow draw, faces the
  tile, and starts the swing; `swingHit()` lands on the locked tile (`player.workTx/Ty`) —
  whatever is there by then — via `hitObject()`/`crackIce()`. Once `swingT` and `swingCd`
  both reach 0, `updatePlay` puts the bow back (`player.tool = TOOL_BOW`), so the axe only exists
  visually for the duration of the work. `workTarget()` is shared with the cursor, so the
  lock ring is exactly "E will do something here".

Whenever `workTarget()` is non-null and `near` (and tools aren't blocked or the bow drawn),
`drawWorkHint()` — called right after `drawSelection` in the overlay pass — floats a
Fortnite-style key prompt over the target: a 9×10 pixel key-cap with an **E** plus the verb
(CHOP / MINE / PICK / CRACK ICE), lifted above trees by 20 px and short objects by 10. The cap
visibly presses (face drops a pixel, highlight gone, label goes gold) while `keys['e']` is down.
If the prompt would overlap the player sprite (an adjacent target) it flips under the tile
instead. Since it only appears in reach, it doubles as the "you're close enough" signal.

`hitObject()` keeps its hard tool gating (trees need the axe, rocks the pick, with
`SFX.deny` + a `NEEDS AXE`/`NEEDS PICKAXE` floater) as a safety net, but since `tryWork`
always picks the right tool it is no longer reachable in normal play. Stumps and structures
are **not** E targets — they are the right-click wheel's domain — and there is no melee against
animals anymore: the bow is the only weapon.

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
along the path *or the first animal the arrow would hit* (the same 8 px body test as the arrow
update) with an impact cross — line-coloured on a solid, hunt-amber on a body — and otherwise
ends in a short perpendicular range-cap bar. Colour follows the draw meter: yellow charging, hot orange at
full. If the player stands on ice with a fish inside `FISH_CATCH_R` the line is replaced by
four ticks closing over that fish, because that shot becomes the catch and never flies.

The selected tool is also drawn **on the player** by `drawHeldTool()` (called from
`drawPlayer()`): carried at the hand while idle/walking (mirrored via a `scale(-1,1)` transform
for `left`, drawn *before* the body sprite for `up` so it's occluded, 1px walk bob), swept along
the same arc as the swing effect during a melee swing, and rotated toward the mouse while the
bow is drawn — the bow icon fires along −x (arc on the left), so aim rotation is `a + PI`.

## Dodge roll

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

## Wildlife

`animals` holds passive fauna spawned once at boot by `spawnAnimals()` (called right after
`genWorld()`, so its `rng()` draws don't reshuffle the world layout): 16 rabbits (8 HP, biased to
spawn near berry bushes) and 10 deer (24 HP). Neither reproduces or respawns.
Behavior lives in `updateAnimal()`: both wander in idle/move bursts; when a
rabbit picks a new wander it drifts toward the nearest berried bush within 7 tiles
(`nearestBerryBush`) and idles ("nibbles") once within 22 px; rabbits also bolt when the player
comes within 26 px, and an arrow hit sends either species fleeing directly away from the player
(`fleeT`). Deaths pay out in `updateAnimal` from the `YIELD` table: rabbits drop 1 berry plus
`YIELD.rabbit` coins, deer drop `YIELD.deer` coins plus a `GOLD!` floater. Arrows are the only thing that hurts them (there is no melee);
animals join the y-sorted `draws` pass via `drawAnimal()`, and
sprites are side-view only (`dir` is `left|right`). They are not shown on the minimap or world
map.

## Economy (one currency)

`inv` is `{ gold, berry, fish }`. **Gold is the only resource** — there is no wood or stone —
and berries/fish are consumables (Q/F heals), never spent on anything. The whole economy is the
`YIELD` table in the constants banner, which gives every source a different **yield profile**
rather than a different resource (the League model: one number, many ways to earn it):

| Source | Pays | Profile |
| --- | --- | --- |
| tree (4 hp) | `treeHit` 1 per swing + `treeFall` 1 → 5 | slow, safe, everywhere; leaves a stump |
| rare tree (8%) | + `treeRare` 6 → 11 | jackpot roll, see `treeRare()` |
| rock (5 hp) | `rockHit` 1 per swing + `rockBreak` 4 → 9 | a bit more than a tree, back-loaded |
| rabbit | `rabbit` 2 coins × 5 → 10 (+1 berry) | bolts when approached |
| deer | `deer` 3 coins × 6 → 18 | the big mobile target |
| generator | `tiers[tier].pay` (1/2/4) every `period` s | passive income, capped at 6 uncollected |

Payouts are physical pickups: `spawnDrop(x, y, type, n)` takes the **value** of the drop
(`d.n`, default 1) so a single coin can carry several gold — the pickup adds `d.n` and floats
`+n` in `RES_COLORS[type]`. Only `gold` and `berry` drops exist (fish go straight to `inv`).
The HUD shows one gold counter (`itemGold`) left of the minimap; the berry/fish indicators sit
top-left as before. `die()` keeps 60% of all three. Robots carry a single gold number
(`b.carry`) and deposit at 8+.

## Base building

Right-clicking a **stump** within 60 px opens a radial **build wheel** anchored at the stump's
screen position (clamped to stay on-screen): up = wall, right = turret, down = generator, left =
spawner (`STRUCT_ORDER`); release over a segment to build, release in the 10 px deadzone to
cancel. Right-clicking a **finished** structure opens a **manage wheel**: up = upgrade, down =
demolish, and (spawners only) right = mode toggle. This wheel is the **only** way to build —
there are no free-placed buildables. All the data lives in the `STRUCTS` table: three tiers per
type (the wood → stone → gold *look* is just the sprite palette) with a gold `cost`, `hp`,
`buildT`, and per-type stats. `tiers[0]` is what the wheel builds; upgrading pays the next
tier's cost and re-runs a shorter construction. Building is the only gold sink.

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
  kept for that). **Generator**: pays `tiers[tier].pay` gold every `period` seconds as one
  coin drop at its base, capped at 6 uncollected drops nearby. **Spawner**:
  keeps `tiers[tier].bots` robots alive (first fill immediate, replacements every 12 s), and
  `removeStruct()` kills its robots with it.
- Demolish refunds **50% of the cumulative cost across tiers** (`cumulativeCost`); the
  `hitObject()` structure-damage branch and `destroyStructure(o, true)` refund path still
  exist but nothing reaches them now that E ignores structures. `canAfford`/`pay`/`costText` are generic over every `inv` key.
- None of the four structures emits light (see [Lighting](rendering.md#lighting)).

## Robots

`robots` holds the spawner-owned wooden units (re-baked `imp` grids, front-facing, 2 frames).
`updateRobot()` mirrors the animal state machine plus jobs, driven live by the owning spawner's
`mode`: **gather** — pick the nearest tree/rock within 8 tiles of the spawner
(`nearestObj`, the predicate generalisation of `nearestBerryBush`), work it in 0.9 s ticks into a
`carry` gold count (same `YIELD` numbers as `hitObject`, tree-fall leaves a stump and pays the
jackpot, minus the physical drops), and walk home to deposit into `inv.gold` with a floater at
8+ carried; **guard** — with
raiders removed it just loiters near home (the mode toggle is kept for a future threat).
Robots use `moveEntity`, abandon a target after ~5 s stuck, die with their spawner, and are
reaped like animals. They join the y-sorted draws via `drawRobot()` and show a health bar;
nothing the player does can hit them (no friendly fire). Their SFX are gated on player proximity
(`nearPlayer`) so a remote base doesn't spam audio.

## Death is not game over

`die()` sets `mode = 'dead'`, drops any bow draw, keeps `ceil(60%)` of each resource, and after
2.6 s `respawn()` puts the player back at the original spawn pocket (`playerSpawn`).
`state.mode` is
`title | play | dead`; `updatePlay()` is skipped entirely while paused, dead, or with the map or
settings overlay open, but `update()` (time, darkness, camera, fx) keeps running. With nothing
hostile in the game, `die()` is currently unreachable but kept working.

## Settings

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

## Audio

`SFX` creates its `AudioContext` lazily inside `ensure()`. Browsers require a user gesture, so
`SFX.unlock()` is called from click handlers — any new entry point that plays sound before the
first click needs to call it too.

