# Gameplay systems

The player (momentum, tools, dodge), the entities that share the world, the gold economy, what
you can build, and the supporting subsystems. Read this before changing how an input resolves,
what something pays out, or what a structure does.

Everything below describes **a player**, not *the* player: each mechanic runs per slot off
`p.input`, and `player` is only the local slot. [multiplayer.md](multiplayer.md) covers the slot
model, the input struct, teams, bots and how two players' orders are resolved.

> Several numbers below (ice cap, steer, slide threshold and fatigue, draw time and speed, arrow
> damage, dash speed, max hp) are **per champion** — the constants are champion 0's values and
> the sim reads them through `kitOf(p)`. See [Champions](multiplayer.md#champions).

## Momentum movement (players only)

A player moves on a real velocity (`p.vx/vy`): `p.input.mx/my` accelerates, and the surface
underfoot sets friction and speed caps. All the tuning constants live in the constants banner
(`ICE_MAX`, `SLIDE_MIN`/`SLIDE_EXIT`, `TRAIL_MIN`) and the per-surface rates inline in
`updatePlayer()`'s movement block, which every slot runs. **Momentum is deliberately players-only**
— animals, robots, and knockback still use the old direct-move idiom.

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
  ice-gliding use the standing pose. `die(p)` and `Player.reset()` zero `vx/vy` and clear
  `sliding`. Footprints and slide trails from every slot share the one `footprints` decal array.

## Unit collisions

Players, animals and robots are solid circles to each other (`PLAYER_R` 4.5, deer 5, wolf 4.5,
rabbit 2.5, robot 3 — `unitRadius`). **Birds are the exception**: they fly, so `separateUnits()`
skips them entirely and they have no `UNIT_MASS` entry. Tile collision stays per-mover in
`moveEntity`; unit-vs-unit is a separate relaxation pass, `separateUnits()` in the
`movement & collision` banner, that `updatePlay` runs once after every player, animal and robot
has stepped. For each overlapping pair it splits the overlap by inverse mass (`UNIT_MASS`:
player 3, deer 2.2, wolf 2, robot 0.7, rabbit 0.5 — a player shoves a rabbit aside and barely
notices, two players split it evenly). Every
push goes through `moveEntity(…, strict)`, which treats open water as a wall even for players
(a shove never dunks anyone), and **any push a wall refuses is handed to the other unit** — the
player's share is tried first, so a small unit can never pin a player in a corner: the pinner
is the one that gets moved (a rabbit wedged between you and a rock squirts out sideways).
Two passes settle piles; the pass is deterministic (fixed order, no `rng`).

## Pathfinding

Everything that walks to a goal on its own — robots, fleeing prey, hunting wolves, bot slots,
any future enemy — routes through the `pathfinding` banner rather than steering straight at it.
`findPath(sx, sy, gx, gy, reach, budget)` is grid A* over the tile map: a tile is `walkable()`
when it is in-world, not `isSolidTile`, and not open water (ground 2); eight-connected with no
corner cutting (a diagonal needs both orthogonal neighbours open, so a unit of radius ≤ 5 never
clips a tree walking centre to centre); octile heuristic; typed-array scores stamped by a
generation counter so nothing is cleared between searches; a binary heap; no `rng`, so it is
deterministic. `reach` is the Chebyshev distance at which the goal counts as reached — 1 lets a
unit path to a tree it cannot stand on (and is exactly `WORK_REACH` for a bot's swing). A search
that exhausts `NAV_BUDGET` (700 expansions, ~a 25-tile detour) returns the route to the closest
tile it saw with `path.partial = true`, so a far goal still gets a first leg and a later replan
finishes it; only an enclosed goal (or an unwalkable one with reach 0) returns `null`. Measured:
~12 µs per full search, so dozens of units replanning several times a second is noise.

Units do not call `findPath` directly. `navTo(e, gx, gy, r, reach, dt)` keeps a route on
`e.nav` (`{ path, i, gtx, gty, replanT, fail, stallT, … }`, created lazily on any entity) and
returns `{ dx, dy, d, ok }` — the unit direction to move this frame, the straight-line distance
to the goal (callers keep their own arrive radius), and `ok`. A plan first tries
`navLineClear()` (the same four-corner test `moveEntity` makes, every 4 px) and takes a direct
line when it is open, else A* plus `navSmooth()` string-pulling; it replans when the goal moves
more than a tile, every `NAV_REPLAN` (0.6 s), or — through `navStep()` — when `moveEntity`
reports a wall. **`ok = false` is the give-up signal**: the goal is unreachable, or the unit has
made no progress for `NAV_STALL` (1.6 s — pinned by other units, which routes ignore and
`separateUnits` resolves). There are no stuck timers anywhere else; a caller that gets `false`
drops the goal (robots and bots blacklist it for 12 s). A failed goal is not searched again until
`replanT` runs out. `navStep(e, gx, gy, r, spd, dt, reach)` wraps `navTo` with the
`moveEntity` call and `mvx/mvy` for the animal/robot movers; players (bots) take `navTo`'s
direction into `p.input` and move through their momentum. `navClear(e)` forgets a route.
`DBG.showPaths = true` draws every live route (`drawNavPaths`: bots gold, prey green, wolves
red, robots blue), and `DBG.findPath`/`DBG.walkable`/`DBG.navTo` are exposed for staging.

Momentum: on the first pass a unit closing on the contact loses only its *share* of the
velocity component along the normal — tangential speed is untouched, so a slide into a deer
deflects along it and carries on rather than sticking — the rest of that component is handed to
the other unit as knockback (`kbx/kby`, the same channel arrows use), and the lighter side of
a contact gets a 0.3 bounce. Players carry `vx/vy`; animals and robots only carry their
knockback (their walk is a direction re-chosen each tick), and an idle animal/robot now applies
its knockback too, so a shoved deer actually moves. Measured: a 150 px/s slide into a deer
comes out at ~60 px/s with a sideways kick and the deer shoved ~14 px.

## Tools and the bow

There is **no tool bar and no tool selection**. `TOOLS` (`bow`, `axe`, `pick`, indices
`TOOL_BOW/AXE/PICK`) is an internal table for icons and names; `p.tool` is that player's *held*
index, which is the bow at rest. The bottom strip of the HUD is deliberately empty — it is reserved
for combat abilities. Two verbs, two inputs:

- **Left click = bow**, always. The press only records intent (`clickAction` sets `input.fire`);
  `updatePlayer` starts the draw on the rising edge and looses on the falling one.
- **E = work** (`tryWork(p)`, auto-repeating every swing cooldown while held — `updatePlayer`
  calls it whenever `p.input.work` is set). It resolves `workTarget(p)`: the tile that player is
  aiming at, if it holds a tree or a dead tree (→ axe), rock (→ pick), a berried bush (→ axe), or
  is bare ice with no object (→ pick, cracking toward a fishing hole); and `near` = the tile is
  within `WORK_REACH` (1) tiles, Chebyshev, of the tile the player stands on — i.e. the 3×3
  ring around you, never a second row, regardless of where in your tile you stand. Out of reach or nothing workable, E
  does nothing. A valid target swaps `p.tool` to the right one, drops any bow draw, faces the
  tile, and starts the swing; `swingHit(p)` **contests** the locked tile (`p.workTx/Ty`) so only
  one player's swing lands on it in a step, then hits whatever is there via
  `hitObject(o, p)`/`crackIce()`. Once `swingT` and `swingCd`
  both reach 0, `updatePlayer` puts the bow back (`p.tool = TOOL_BOW`), so the axe only exists
  visually for the duration of the work. `workTarget()` is shared with the cursor, so the
  lock ring is exactly "E will do something here".

Whenever `workTarget()` is non-null and `near` (and tools aren't blocked or the bow drawn),
`drawWorkHint()` — called right after `drawSelection` in the overlay pass — floats a
Fortnite-style key prompt over the target: a 9×10 pixel key-cap with an **E** plus the verb
(CHOP / MINE / PICK / CRACK ICE), lifted above trees by 20 px and short objects by 10. The cap
visibly presses (face drops a pixel, highlight gone, label goes gold) while the local player's
`input.work` is set.
If the prompt would overlap the player sprite (an adjacent target) it flips under the tile
instead. Since it only appears in reach, it doubles as the "you're close enough" signal.

`hitObject()` keeps its hard tool gating (trees need the axe, rocks the pick, with
`SFX.deny` + a `NEEDS AXE`/`NEEDS PICKAXE` floater) as a safety net, but since `tryWork`
always picks the right tool it is no longer reachable in normal play. Stumps and structures
are **not** E targets — they are the right-click wheel's domain — and there is no melee against
animals anymore: the bow is the only weapon.

The bow is **hold-to-charge**: the press edge starts `p.charging`/`p.chargeT` (movement
targets scale to 55% — walk speed and the ice cap both — facing tracks the mouse, a draw meter
renders above the player's health bar),
and the release edge fires via `fireArrow(p)` — power scales speed (170–360 px/s) and damage
(4–13). Arrows carry their shooter's `owner`/`team`, live in the `arrows` array, and are updated
in `updatePlay()`: they die on solid tiles, on a **rival player** (tested before animals — see
[PvP](multiplayer.md#pvp)), on any animal hit (knockback scales with power), or after 0.85 s. They render as short
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

**Space** (`tryDodge(p)`, driven by the edge-triggered `input.dodge`) dashes a player along its
`input.mx/my` (facing direction if nothing is held): an impulse of
`max(DODGE_SPEED (215), current speed)` into `p.vx/vy`
for `DODGE_T` (0.28 s), with i-frames for the roll only (`p.invuln` — momentum carried
past the roll gets no i-frames). Two charges (`DODGE_CHARGES`), refilling **one at a time**
every `DODGE_CD` (3.5 s); state lives on the player as `dodgeT/dodgeVX/dodgeVY/dodgeCharges/
dodgeRegenT/dodgeDustT` (`dodgeVX/VY` exist only for the spin/ghost render — movement runs on
`vx/vy`). While rolling, movement input, friction, footprints, walk animation, and the held
tool are suppressed (still collides with solids; a wall zeroes that axis), and `drawPlayer`
swaps to a full 360° sprite spin with two afterimage ghosts trailing the velocity plus dust
bursts. The roll's exit speed is spent by the surface — see
[Momentum movement](#momentum-movement-players-only). The charge meter is a single unsegmented cyan stamina
bar on a plate directly beneath the overhead health bar — charges stay discrete in the sim,
the bar shows the pooled total (full charges + regen progress). Spending a charge leaves a
pale ghost of the lost chunk (`player.stamGhost`/`stamGhostT`): it holds ~0.3 s, then drains
into the live fill souls-style. Death cancels the roll, respawn refills
charges; overlays (map/settings/wheel/pause) block the local player's input. The bar is drawn for
the local slot only — a rival's tells are their draw meter and their position.

## Wildlife

`animals` holds **everything that is shot rather than swung at** — four kinds, keyed by
`a.kind` with hp from `ANIMAL_HP`. The passive pair is spawned once at boot by `spawnAnimals()`
(called right after `genWorld()`, so its `rng()` draws don't reshuffle the world layout): 16
rabbits (8 HP, biased to spawn near berry bushes) and 10 deer (24 HP). Neither reproduces or
respawns. **Wolves** (30 HP) and **birds** (3 HP) belong to a
[landmark](world.md#landmarks) instead — `a.home` points at it, and the site restocks them.

`updateAnimal()` is the shared shell: it ages the flash and knockback, dispatches to
`updatePrey` / `updateWolf` / `updateBird`, clamps to the world, and calls `animalDies(a)` — the
one place a kill pays out, straight from the `YIELD` table. Everything in `animals` is a target
for arrows (`animalHit(a, x, y)`, shared by the arrow update and the aim line), gets the amber
hunt reticle, and joins the y-sorted draws.

Prey behaviour lives in `updatePrey()`: both wander in idle/move bursts; when a
rabbit picks a new wander it drifts toward the nearest berried bush within 7 tiles
(`nearestBerryBush`) and idles ("nibbles") once within 22 px; rabbits also bolt when **any**
player comes within 26 px, and a hit sends either species fleeing from the nearest one
(`fleeT`). A flight is a chain of routed legs: `fleeGoal(a, from)` picks a tile ~6 tiles off, as
straight away from the threat as the ground allows (fanning out, then sideways, then past it),
the first it can route to, and `navStep` runs it ([Pathfinding](#pathfinding)); a leg that
arrives or fails hands over to the next, and an animal with nowhere to run stops fleeing. Rabbits drop 1 berry plus `YIELD.rabbit` coins; deer drop `YIELD.deer` coins plus a `GOLD!`
floater. Arrows are the only thing that hurts any of them (there is no melee); animals are solid
to players, robots and each other except birds, which fly (see
[Unit collisions](#unit-collisions)), and sprites are side-view only (`dir` is `left|right`).
They are not shown on the minimap or world map.

### Wolves: the first enemy

A **wolf den** ([world.md](world.md#landmarks)) keeps 4 wolves. `updateWolf()`:

- **Sight.** A wolf takes the nearest player inside `WOLF_SIGHT` (96 px) — scaled by
  `1 + darkness * 0.75`, so at full night it sees ~168 px and the den is a different proposition
  after sunset. It only ever considers players within `WOLF_LEASH` (190 px) **of its den**, and
  drops a quarry that leaves that radius, so a den is a place you walk into, not a patrol that
  follows you home.
- **The pack.** `wakePack(w, target)` hands one wolf's find to every wolf of the same den and
  plays `SFX.howl()` — spotting you, or an arrow, wakes all four (a wolf shot from cover does
  **not** flee like a deer; the den comes for the shooter).
- **The chase.** `WOLF_SPD` (96 px/s) is faster than the 72 px/s walk and slower than a slide or
  the ice cap, so the answer is the momentum system, not distance — and the wolf routes around
  trees and water ([Pathfinding](#pathfinding)), so a treeline is not cover; a quarry it cannot
  route to (out on a hole) it holds and faces. Bites do `WOLF_BITE_DMG` (9)
  inside `WOLF_BITE_R` (13 px) every `WOLF_BITE_CD` (1 s) per wolf, through
  `damagePlayer(t, dmg, dx, dy, null, 'wolf')` — whose own 0.7 s of i-frames is what keeps four
  wolves from deleting anyone: measured, standing in a den costs ~9 hp/s, so a level-1 slot has
  ~10 s to get out. Death reads `WENT TO THE WOLVES` in the feed
  ([multiplayer.md](multiplayer.md#kills-and-the-event-feed)).
- **Off duty** it patrols its den, wandering back whenever it drifts past `r * 0.8` tiles.
- **The payout** is `YIELD.wolf` — 24 gold, the biggest single kill in the game, for 30 hp of
  arrows (three full draws at level 1). Dangerous, rewarding.

### Birds: the flock

A **rookery** keeps 9 birds perched in its dead trees. `updateBird()`:

- **Flighty.** Any player inside `BIRD_FLUSH` (34 px) — or an arrow hitting one, or a snag being
  chopped — calls `flushBirds(L, from)`, which puts **the whole rookery** up at once with
  `SFX.wings()`. One bird leaving alone would read as a bug; the flock is the personality.
- **In the air** for 2.4–4.2 s at `BIRD_SPD` (112 px/s): a wandering circuit that never leaves
  the stand, then a run back to a perch (`rookeryPerch(L)`, re-picked on every flush).
- **Height** is `a.alt` — `BIRD_ALT` (15 px) perched, easing to 26 in flight. It is the only
  thing in the world off the ground: `animalHit` and the cursor both subtract it, birds are
  skipped by `separateUnits`, and `drawBird` lifts the sprite off its own shadow.
- **The shot.** 3 hp (any arrow kills) but a 5 px body instead of 8, moving, at altitude, with
  the flock scattering — `YIELD.bird` pays 8 gold and there are nine of them. It is the archery
  range of the map, and bots deliberately don't hunt them (they fly; no ground route catches a flock).

## Economy (one currency)

Every player owns a wallet: `p.inv` is `{ gold, berry, fish }` (and `inv` is an alias for the
local slot's, which is what the HUD draws). **Gold is the only resource** — there is no wood or stone —
and berries/fish are consumables (Q/F heals), never spent on anything. The whole economy is the
`YIELD` table in the constants banner, which gives every source a different **yield profile**
rather than a different resource (the League model: one number, many ways to earn it):

| Source | Pays | Profile |
| --- | --- | --- |
| tree (4 hp) | `treeHit` 1 per swing + `treeFall` 1 → 5 | slow, safe, everywhere; leaves a stump |
| dead tree (3 hp) | `deadTreeHit` 1 per swing + `deadTreeFall` 2 → 5 | a tree in fewer swings, but only at a rookery |
| rare tree (8%) | + `treeRare` 6 → 11 | jackpot roll, see `treeRare()` |
| rock (5 hp) | `rockHit` 1 per swing + `rockBreak` 4 → 9 | a bit more than a tree, back-loaded |
| rabbit | `rabbit` 2 coins × 5 → 10 (+1 berry) | bolts when approached |
| deer | `deer` 3 coins × 6 → 18 | the big mobile target |
| wolf | `wolf` 3 coins × 8 → 24 | the biggest kill, and it bites back |
| bird | `bird` 2 coins × 4 → 8 | tiny, airborne, nine per rookery |
| generator | `tiers[tier].pay` (1/2/4) every `period` s | passive income, capped at 6 uncollected |

Payouts are physical pickups: `spawnDrop(x, y, type, n)` takes the **value** of the drop
(`d.n`, default 1) so a single coin can carry several gold — the pickup adds `d.n` (gold through
`gainGold`, which is also XP — see [Hero levels](multiplayer.md#hero-levels)) and floats
`+n` in `RES_COLORS[type]`. Only `gold` and `berry` drops exist (fish go straight to `inv`).
The HUD shows the local wallet's gold counter (`itemGold`) left of the minimap; the berry/fish
indicators sit top-left as before. `die(p)` keeps 60% of all three. Robots carry a single gold
number (`b.carry`) and deposit at 8+ into their **owner's** wallet (via `gainGold`, so robot
income levels the owner too). Drops are neutral: they drift
toward the nearest player, and everyone standing on one contests it
(`canAfford`/`pay` also take the player whose wallet is meant).

## Base building

Right-clicking a **stump** within 60 px opens a radial **build wheel** anchored at the stump's
screen position (clamped to stay on-screen): up = wall, right = turret, down = generator, left =
bot bay (`STRUCT_ORDER`, type `spawner`); release over a segment to build, release without having moved to
cancel. Right-clicking a **finished** structure (any tile of it) opens a **manage wheel**: up = upgrade, down =
demolish, and (bays only) right = mode toggle. This wheel is the **only** way to build —
there are no free-placed buildables. All the data lives in the `STRUCTS` table: three tiers for
wall/turret/generator (the wood → stone → gold *look* is just the sprite palette) and **one for the
bay**, each with a gold `cost`, `hp`, `buildT`, and per-type stats. `tiers[0]` is what the wheel
builds; upgrading pays the next tier's cost and re-runs a shorter construction, and the last tier
(`tiers.length - 1`) reports MAX TIER. Building is the only gold sink.

Mechanics, all in `game.js`:

- `state.wheel` (`{kind:'build'|'manage', tx, ty, seg, ax, ay}`) is the open wheel; ESC/M/settings/death
  close it, left-click is swallowed while it's open, and the game **keeps running** — opening the
  wheel mid-night is deliberate pressure. `wheelLayout()` is shared by `resolveWheel()` and
  `renderWheel()` so hover math and pixels can never disagree. `resolveWheel()` does not act: it
  writes `player.input.cmd`, and `runCmd(p, c)` performs it in the next sim step (re-checking
  ownership and the 60 px reach).
- **The pointer is measured from `ax`/`ay`, the point the right button went down at**, not from
  the wheel's drawn hub: that press is what the hand remembers, and the hub is pinned to the tile,
  so it drifts as the camera follows the player and gets clamped near a screen edge. Travel past
  `WHEEL_DEAD` (2 px) in any direction commits to the nearest segment by angle — a flick, not a
  drag — and only sitting still cancels. Because that travel is invisible (the cursor can be
  anywhere on screen), `drawWheelStick()` draws it at the hub: an origin pip, a knob that snaps
  4 px clear and goes gold the instant a segment is live, and a dot of trail between them. The
  knob is a compact readout, not a 1:1 echo — it caps at 12 px, inside the option icons, so it
  never sits under the cursor.
- `placeStruct(tx, ty, type, p)` consumes the stump (the tile is **empty** after demolition —
  stumps are a finite site resource), pays `tiers[0].cost` from that player's wallet, and has
  `createStruct()` drop the object into `building` state at 30% hp, stamped with `owner`/`team`
  (`createStruct` is the one constructor — `DBG.buildStruct` uses it too — and lays the `part`
  fillers for a big footprint). It enforces the 60 px reach
  and the don't-entomb-yourself AABB check, and the placement itself is
  [contested](multiplayer.md#contested-orders) so two players can't claim one stump.
- **The bay needs room**: `findSite(type, tx, ty)` tries every 3×2 anchor that covers the clicked
  stump and takes the one covering the most stumps, where every tile is in-world snow holding
  nothing or a stump and no player stands inside it; none → "NO ROOM" and the order is denied (the
  AI only orders a bay where `findSite` succeeds). The anchor is the top-left tile.
- **Ownership**: a building wears its team's palette (`structSprite`), and `ownsStruct(o, p)`
  means only its side can open the manage wheel, upgrade or demolish it. Stumps are neutral.
- **Construction**: `updateStructures()` (called from `updatePlay`, iterating only the
  `structures` registry) advances `buildT`, grows hp toward max, and puffs dust; the draws pass
  shows `SPRITES.scaffold[0|1]` under 2/3 progress, then the real sprite under the `scaffold[2]`
  lattice. A sprite wider than 16 px — the bay — builds differently: the first 12% of the timer
  shows only a staked-out foundation pad over the footprint, then the sprite rises bottom-up behind
  a weld line that throws sparks from `updateStructures` (`bigBuildReveal()` is the shared split so
  the sparks sit on the drawn edge), and completion flashes the sprite white (`o.flash`), puffs
  snow along the roofline and shakes harder. Small builds keep their burst + `SFX.place` + shake. A
  yellow progress bar renders above every site (centred over the roof for a big one). Sites are
  solid from placement. A big building y-sorts by the bottom of its footprint and sits its snow
  skirt on that edge.
- **Turret**: currently idle — its targeting/firing tick was removed with the raiders, so it is
  a decorative buildable until a new threat exists (the `tracers` array and its render pass are
  kept for that). **Generator**: pays `tiers[tier].pay` gold every `period` seconds as one
  coin drop at its base, capped at 6 uncollected drops nearby. **Bot bay** (`spawner`):
  keeps `tiers[0].bots` (3) robots alive, rolling them out **one at a time** — the first 1 s after
  completion, then 4 s apart; a lost bot takes 12 s to replace (`respawnT`/`respawnTotal`).
  `makeRobot` spawns at `structMouth()` (the ring around the footprint if that is blocked) with an
  exhaust puff. `drawBayOverlay()` draws everything live on top of the baked sprite: the next bot
  sliding down the doorway over the last 0.8 s of its timer; a roll-up **shutter** over the doorway
  (`o.door`, lerped in the tick — open in gather, shut in guard, and always open for a roll-out);
  three **bot pips** on the right flank (lit = alive, blinking = being built, dark = empty) with the
  roll-out timer as a bar under them; a flickering slat across each vent grille; a roof **beacon**
  that blinks amber while a bot is due; and an hp bar over the roof once damaged. `removeStruct()`
  clears the whole footprint and kills its robots with it.
- Demolish refunds **50% of the cumulative cost across tiers** (`cumulativeCost`); the
  `hitObject()` structure-damage branch and `destroyStructure(o, true)` refund path still
  exist but nothing reaches them now that E ignores structures. `canAfford`/`pay`/`costText` are generic over every `inv` key.
- None of the four structures emits light (see [Lighting](rendering.md#lighting)).

## Robots

`robots` holds the bay-owned worker bots (one 12×10 faceless tread-bot grid in team colour, two
tread frames — see [sprites.md](sprites.md)). `updateRobot()` mirrors the animal state machine plus
jobs, driven live by the owning bay's `mode`: **gather** — pick the nearest tree/rock within 8
tiles of the bay's mouth (`structMouth`, also where they deposit)
(`nearestObj`, the predicate generalisation of `nearestBerryBush`), work it in 0.9 s ticks into a
`carry` gold count (same `YIELD` numbers as `hitObject`, tree-fall leaves a stump and pays the
jackpot, minus the physical drops), and walk home to deposit into their owner's `inv.gold` with a
floater at 8+ carried; **guard** — with
raiders removed it just loiters near home (the mode toggle is kept for a future threat).
Robots drive on `navStep` ([Pathfinding](#pathfinding): reach 1 to a tree or rock, reach 0
home) and are solid to players and animals (see [Unit collisions](#unit-collisions)); a target
with no route, or one they get pinned on the way to, goes on `b.avoid` for 12 s. They die with
their bay and are reaped like animals. They inherit their bay's `team`/`owner`, join the y-sorted draws via
`drawRobot()` in team colours (the whole sprite bobs while driving, the tool swings at a target,
carried gold shows as a nugget up front), and show a health bar; nothing any player does can hit them yet. Their SFX are gated on player proximity
(`nearPlayer`) so a remote base doesn't spam audio.

## Death is final

`die(p, src, cause)` marks that slot dead, drops its bow draw and clears its momentum; there is no
respawn — a dead slot stays out for the rest of the match (the wallet is untouched, so the
standings still show what it earned). It also credits the kill and writes the feed line — see
[Kills and the event feed](multiplayer.md#kills-and-the-event-feed) — and then
`checkLastStanding()` asks whether the local slot is now the only one left (with at least one
rival to have beaten), which ends the match as a win. Either way the local slot leaves through
`endMatch('lost' | 'won')` (the `death & spectate` banner): `state.mode = 'dead'`, every local
overlay closed, and the death overlay takes the screen with two planks — **SPECTATE** (lost) or
**KEEP PLAYING** (won), and **LOBBY**. Spectating sets `state.spec` to a living rival's id and
`viewPlayer()` — the one place the camera and minimap ask who to frame — returns it. The control is
a top-centre `[<] NAME [>]` strip (`specLayout`/`specHit`, sized to the widest slot name so the
arrows never shift): clicking an arrow or pressing the arrow keys cycles (`specNext`, slot order,
skipping the dead), ESC returns to the planks, and a watched slot that dies hands the view to the
next. There is deliberately no hint text — the arrows are the whole explanation (CLAUDE.md's
"show, don't label" rule); with nobody left the plate shows a dash instead of a name. LOBBY (`toLobby`) fades to dark and reloads
the page on the same seed, which boots into the title screen. **TAB still opens the standings
while you are out**, which is the point of holding them above the dim.
`state.mode` is `title | drop | play | dead`, and `updatePlay()` runs in `play`, `dead` **and**
`drop` (the clock starts with the eagle; airborne slots are skipped) — the match carries on
without you. Only the local overlays (paused, map, settings) stop the sim;
`update()` (time, darkness, camera, fx) always keeps running. In `title` only the ambient half
runs (`updateTitle`: animals and fish) — see [Main menu](rendering.md#main-menu-title).

## Settings

`settings` (`volume`, `mmR`, `shake`, `muted`, `fps`, `pixelCursor`) persists to
`localStorage['softfall.settings']`. `applyMinimapSize()` must be called after changing `mmR` —
it recomputes `MM_R`/`MM_CX`/`MM_CY`, which the resource row in `renderUI()` also positions
itself against. (Old saves may still carry a `res` key from the removed resolution setting;
`Object.assign` in `loadSettings` copies it harmlessly and nothing reads it.)

There is no fullscreen control in the ESC menu (players use F11); a `fullscreenchange` listener
still refits the canvas when the browser toggles it.

`settings.fps` (toggle row in the ESC menu) shows a performance monitor: `loop()` accumulates raw
unclamped frame deltas into `perf` and refreshes `perf.fps` every half second; `drawFps()` prints
it in the extreme top-right corner, drawn just before the seed tag so it survives every overlay,
and turns red below 45. Beneath the minimap `renderMinimap()` prints one centred row: a 5×7
pixel figure (`ALIVE_ICON`, no label) with `aliveCount()` — slots active and not dead, riders
included — then the elapsed clock; the row is centred under the minimap, so it never collides
with the fps readout.

## Audio

`SFX` creates its `AudioContext` lazily inside `ensure()`. Browsers require a user gesture, so
`SFX.unlock()` is called from click handlers — any new entry point that plays sound before the
first click needs to call it too.

