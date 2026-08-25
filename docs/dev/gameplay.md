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
- **Prone** short-circuits all of it: a belly crawl takes the plain direct-approach branch on any
  surface at a flat `PRONE_SPEED`, and sliding is refused outright. See
  [Prone](#prone-under-the-snow).
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
index, which is the bow at rest. The bottom-centre strip of the HUD carries the quiver
([below](#the-quiver)) and nothing else. Two verbs, two inputs:

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
(CHOP / MINE / PICK / BREAK / CRACK ICE), lifted above trees by 20 px and short objects by 10 —
a building instead clears its own sprite (which is drawn up from the footprint's bottom edge and
can be taller than its tiles) and centres the prompt on the footprint, not the tile aimed at. The cap
visibly presses (face drops a pixel, highlight gone, label goes gold) while the local player's
`input.work` is set.
If the prompt would overlap the player sprite (an adjacent target) it flips under the tile
instead. Since it only appears in reach, it doubles as the "you're close enough" signal.

`hitObject()` keeps its hard tool gating (trees need the axe, rocks the pick, with
`SFX.deny` + a `NEEDS AXE`/`NEEDS PICKAXE` floater) as a safety net, but since `tryWork`
always picks the right tool it is no longer reachable in normal play; buildings are not gated
at all, since the axe is the only tool E ever brings out for one.

**Stumps** are not E targets — they are the right-click wheel's domain. **Buildings on another
team are**: `workTarget()` resolves the tile through `structOf()` (so any tile of a 3×2 footprint
counts, via its `part`) and returns the axe when `ownsStruct()` is false, and `swingHit` routes
the swing to the anchor. Your own buildings stay wheel-only, so E is never ambiguous. See
[Base building](#base-building) for the damage numbers. There is still no melee against animals:
the bow is the only weapon aimed at a living thing.

The bow is **hold-to-charge**: holding the button arms the shot (`p.fireArmed`), the draw starts
as soon as the bow is actually ready and runs `p.charging`/`p.chargeT` (movement targets scale to
55% — walk speed and the ice cap both — facing tracks the mouse, a draw meter renders above the
player's health bar), and the release edge fires via `fireArrow(p)` — power scales speed
(170–360 px/s) and damage (4–13), and a shot loosed out of full snow cover multiplies the lot by
`AMBUSH_MUL` (see [Prone](#prone-under-the-snow)). Arrows carry their shooter's `owner`/`team`, live in the
`arrows` array, and are updated in `updatePlay()`: they die on solid tiles, on a **rival player**
(tested first — see [PvP](multiplayer.md#pvp)), on an **enemy worker bot**
(`robotHit`/`hurtRobot`, tested next), on any animal hit (knockback scales with power), or after
0.85 s. They never hit structures — a building is broken by hand with E, not shot. **Wherever a
shot ends it leaves a shaft behind** (`stickArrow`) — see [The quiver](#the-quiver).

`p.fireArmed` is what makes the draw survive a bow that isn't ready. It is set on the press edge,
cleared on release and at every point that cancels a draw (`tryWork`, falling in a hole, an
overlay opening in `sampleHumanInput`, `die`), and the draw begins on the first step where it is
set *and* `nockT <= 0` *and* `quiver > 0`. Requiring a fresh press instead would deadlock every
controller that simply holds the button down — which is every AI slot: `updateAI` sets
`inp.fire = chargeT < bowCharge * k`, so after a shot it goes straight back to true and no second
edge ever arrives.

### The quiver

Arrows are a resource. `p.quiver` starts at `QUIVER_MAX` (6); `fireArrow` spends one and sets
`p.nockT = kit.nock` (WREN 0.45 s, SKADI 0.3 s, both scaled by QUICKDRAW), and no draw can begin
while that runs. Below the ceiling, `p.fletchT` accumulates and hands back one arrow every
`QUIVER_REGEN` (2.4 s) through `gainArrow` — the floor that keeps a player who never picks
anything up throttled rather than disarmed. Bow-fishing is the one shot that costs nothing: it
never leaves the bow, so it takes the renock but not the arrow.

Spent arrows land in **`shafts`** (`{x, y, nx, ny, team, t}`), one per arrow that ends its flight,
however it ends — miss, wall, body, or expiry. `stickArrow` places it 3 px back along the flight
(so it is never inside the tile that stopped it), drops it entirely if the tile is open water, and
trims the oldest past `SHAFT_MAX` (90). A shaft lives `SHAFT_LIFE` (30 s), is inert for
`SHAFT_ARM` (0.3 s), and is then **neutral**: any player inside `SHAFT_R` (10 px) whose quiver
isn't full claims it through `contest('shaft:' + i, …)`, exactly like a drop — so shooting at
someone on their ground is also shooting them ammo. Bots join in: `updateAI`'s loot step counts
shafts as loot once a bot is at or below half a quiver. Dying spills whatever is left in the
quiver as shafts around the body, the same way `spillInventory` spills the wallet.

Four indicators carry it, and none of them is a word:

- **The quiver strip** (`drawQuiver`, bottom-centre — the strip `renderUI` had reserved for combat
  abilities). One pip per arrow, drawn from the `QUIVER_PIP` char grid: lit = held, dark plate =
  spent, and the pip on the boundary fills **from the nock up** as `fletchT` runs, so an arrow
  visibly re-forms. The glyph is diagonal on purpose — an upright arrow 5 px wide reads as a
  dagger or an anchor whatever you do to the head and feathers. Fletching is the local team's
  colour, the same colour on every shaft in the snow. A gained arrow (`quiverFlash`) and a
  completed renock (`readyFlash`) flash the strip white; a press on an empty bow (`dryT`, set by
  `dryFire`) shakes it and reddens the empty *plates* (reddening the glyphs reads as six red
  arrows, which is the opposite of what happened). Under the pips, one gold rule sweeps the strip
  while `nockT` runs and lands white when it clears.
- **The overhead bar** (`drawPlayer`) — the draw meter's slot doubles as the renock readout for
  *every* slot: gold filling = drawing, slate filling = reloading, white = just came back. Same
  geometry either way, so it never jumps.
- **The reticle** (`cursorInfo` → `drawCursor`). Every reticle in play carries `nock` (elapsed
  fraction, 1 = ready) and `dry` (empty quiver), whatever the pointer is over. While the renock
  runs, four gold corner marks fall inward and land on the ring; an empty quiver drops the centre
  pixel and greys the ticks — the crosshair goes hollow.
- **The shafts themselves** (`drawShafts`, in the flat pass just before drops). Body at the
  bearing it flew in on, head buried, fletching in the shooter's colour, rimmed like a flying
  arrow. Inside `SHAFT_NEAR` (34 px) of a local player with room for it, the whole thing turns
  gold — this HUD's "you can take this" colour — and grows a bobbing arrowhead. It blinks over its
  last 1.6 s so nobody walks toward one that is about to go.

Sounds: `SFX.nock()` on the renock completing (very quiet — it plays after every shot),
`SFX.dryFire()` on an empty press, `SFX.shaftPull()` on a retrieval.

An arrow in flight is drawn in its own pass (using `ex`/`ey`) and **rasterised pixel by pixel**
rather than stroked, so it stays opaque and crisp at any angle: an 8 px shaft, two barbs 2 px back
that keep the head pointing whatever direction it flies, and 4 px of fletching at the tail in
`TEAMS[a.team].mark` — whose shot it is is readable from the arrow itself. Every one of those
pixels is dilated into `ARROW_RIM` first (a plus-shaped 1 px dark edge) so the shaft reads over
snow, and the tip is left pure white. The body is built into the `ARROW_PX` scratch array, and a
shot off the edge of the view is skipped before any of it runs.

Behind it, each arrow lays a **trail of team-coloured motes** into `particles`, one every
`ARROW_TRAIL_STEP` (4) px of *flight distance* — not per tick, so a slow arrow streaks as evenly
as a fast one, and a long frame is subdivided instead of leaving a gap. Motes are dropped at the
distance behind the head they are owed (`a.trailD` banks the remainder), drift back at 8 px/s and
fade from `ARROW_TRAIL_A` (0.7) over `ARROW_TRAIL_LIFE` (0.22 s), leaving a tail that thins out
behind the shot. The particle draw pass is what makes that possible: a particle's
`maxLife` is the seconds it spends fading (`burst` uses 0.4) and its optional `alpha` caps how
opaque it ever gets. Particles draw before the arrows, so a trail always sits under its own shaft.
Switching tools, opening an overlay, or dying drops the draw without firing (and clears
`fireArmed` with it); `BOW_CHARGE` (0.9 s) is a full draw.

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
charges; pause, the settings panel and the wheel block the local player's roll (the
[map](#the-m-map-does-not-pause) does not). The bar is drawn for
the local slot only — a rival's tells are their draw meter and their position. A roll out of
[prone](#prone-under-the-snow) is legal and is the fast way out of the snow: `tryDodge` stands the
player up first, so the escape costs a charge.

## Prone: under the snow

**Ctrl** lies a player face-down in the snow and pulls it over them. It is the game's only
stealth, and it is paid for entirely in speed.

**Ctrl is a tap, not a hold** (`input.prone` is edge-triggered, like `dodge`). This is not a
style choice: holding a modifier and tapping W is Ctrl+W, which closes the browser tab, and
`preventDefault()` cannot stop it — the shortcut is reserved above the page, fullscreen included.
The keydown handler also drops `e.repeat`, since a held modifier auto-repeats and would otherwise
flip the burrow several times a second.

`tryProne(p)`/`risePlayer(p)` (the `actions` banner) are the only two ways in and out. Going down
needs **both feet still** (`hypot(vx, vy) <= PRONE_ENTER`, 14 px/s — you cannot dive at a run),
not sliding, not mid-roll, and **snow underfoot**: a river has nothing to dig into, and Ctrl there
just plays `SFX.deny`. Getting up happens on Ctrl again, on the ambush shot, on a `tryWork` E
press, on `tryDodge` (a roll is the fast way out and costs a charge), on any hit
(`damagePlayer` calls `risePlayer` before anything else), on falling through the ice, and on death.

### The one number

`p.hide` (0..1) is the whole state. It climbs at `1 / PRONE_BURY` (1.5 s) while lying **still on
snow**, holds while crawling, decays fast off snow — a body dragged onto bare ice keeps the pose
but loses the cover, because the cover is the snow, not the posture — and is zeroed the instant
`risePlayer` runs. Two derived reads sit on top of it and **everything else in the game uses
those, never `p.hide` directly**:

- `concealOf(p)` = `hide`, discounted to `PRONE_MOVE` (×0.5) while `p.moving`. A crawling mound is
  worth half a still one, which is what makes "stop before you shoot" a real decision.
- `seenAt(p, range)` = the distance a watcher with plain sight `range` actually notices p from:
  `range × kit.stealth × (1 − PRONE_CUT × conceal)`, floored at `PRONE_SNIFF` (22 px) whenever
  there is any cover at all — **nothing hides at arm's length**. Full cover takes a bot's 150 px
  down to 22, a wolf's 96 down to 22, and a tier-3 turret's 92 down to 22.

Four watchers resolve through `seenAt` and there must never be a fifth that doesn't:
`aiNearestEnemy` (which **ignored `kit.stealth` entirely** before this — GHOSTSTEP did nothing
against another player until now), `updateWolf`'s target pick, and `turretMark`/`turretHolds`.
Both maps gate separately on `concealOf(p) >= PRONE_MAP` (0.55): a rival buried and still drops off
the minimap and the M map, and a rival *crawling* tops out at 0.5 and stays on both — moving puts
you back on their map before it puts you back in their sights.

### Crawling

`updatePlayer`'s movement block forces the plain direct-approach branch with
`walkMax = PRONE_SPEED` (20 px/s against a 72 px/s walk) on **any** surface — no ice cap, no
`chargeMul`, nothing to stack, and `inp.slide` is ignored (`wantSlide` requires `!p.prone`).
Rising costs `PRONE_RISE` (0.34 s) at 45% walk speed. Instead of footprints a crawl lays a **drag
furrow**: `k: 3` entries in the shared `footprints` array every 2 px, each storing the
perpendicular it was pushed with so the trough draws square to the path whichever way it went, two
deep so consecutive marks tile into one continuous line, with an elbow dimple to one side on every
other mark. It keeps the full 9 s footprint life — a trail worth following has to outlast the crawl
that made it — and it is the counterplay: a line like that leads straight to the mound at the end.

### The ambush shot

`ambushReady(p)` is `prone && hide >= 1 && !moving`: **full** cover, and dead still while it goes.
`fireArrow` reads it before anything else can break the cover, multiplies the whole damage roll
(champion + power + speed + level) by `AMBUSH_MUL` (2.5), tags the arrow `ambush: true`, and calls
`risePlayer` after the loose — one ambush per burrow, then you are a player lying in the open with
a bow that still has to be renocked. A WREN's full draw goes 12 → 30. Bow-fishing is the exception
that proves the rule: it never leaves the bow, so it costs no arrow and breaks no cover.

Wherever the tagged arrow lands — player, worker bot or animal — `ambushFx()` puts a gold flare
over the ordinary hit puff and plays `SFX.ambush()`; `damagePlayer`'s `crit` argument runs the
damage floater hotter and at double scale, and doubles the local shake.

### The tells

None of them is a word:

- **The body disappears.** `drawSnowCover` closes over the prone sprite **from the outside in** —
  boots and elbows first, the middle of the back last — so at 85% there is still a seam of coat
  showing down the spine. Row extents come from `spr.spans`, the per-row `[firstX, lastX]`
  [sprites.md](sprites.md) takes off the char grid at bake time, dilated a row into its neighbours
  so it is a drift rather than a traced outline; the finished mound is lit like every other drift
  here (white crest, shaded far side, dark rim under it doing the grounding a prone body's missing
  cast shadow would have done). Alpha is 1 for a rival, 0.85 for an ally and 0.66 for yourself, so
  **you can always see yourself under the snow** and nobody else can.
- **The overhead furniture fades with the cover** (`drawPlayer`) — name tag, health bar, stamina
  bar, level badge, and the draw meter that says a shot is coming. A rival keeps none of it. The
  whole stack also drops 6 rows with the pose, since a prone body starts that much lower in the
  same 16×16 cell.
- **The bury ring** (`drawBuryRing`, local slot only) — twelve marks on a ring in the snow that
  light one at a time as the cover builds, then flash white and go. Each gets a dark pixel under
  it, because white on snow is white on white. A rival needs no meter: they can watch you vanish.
- **The reticle arms.** `cursorInfo` puts `amb` on every reticle it builds; `drawCursor` grows a
  second segment out along each of the crosshair's own axes and warms the centre pixel to gold —
  deliberately on the cross, where the renock's marks are on the diagonals.
- **Breath.** One timer on the player does two jobs, and which one says what state the body is in:
  while the cover is still building it throws up the snow being pulled over, and once it is
  finished it becomes a plume of breath every ~2 s. That, the mound itself and the furrow are the
  three things that keep "almost invisible" honest.

### Bots

Bots use it through the same edge-triggered flag Ctrl sets — rung 2 of the
[ladder](multiplayer.md#ai-slots), decided before the rest because two later rungs read the answer.

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
`+n` in `RES_COLORS[type]`. A drop's `type` is an `inv` key — the pickup and the AI's loot step
are generic over them; sources pay `gold` and `berry` (a caught fish goes straight to `inv`), and
death spills can carry `fish` too (`SPRITES.itemFish` in the drop draw pass).
The HUD shows the local wallet's gold counter (`itemGold`) left of the minimap; the berry/fish
indicators sit top-left as before. Death empties the wallet — see
[Death is final](#death-is-final). Robots carry a single gold
number (`b.carry`) and deposit at 8+ into their **owner's** wallet (via `gainGold`, so robot
income levels the owner too). Drops are neutral: they drift
toward the nearest player, and everyone standing on one contests it
(`canAfford`/`pay` also take the player whose wallet is meant).

## Gear

Every slot wears four pieces — **helmet, chest, legs, boots** (`GEAR_SLOTS`) — each one of three
variants with a distinct lane, all in the `GEAR` table in the `players` banner:

| Slot | Variants (per piece level) |
| --- | --- |
| helmet | LONGSIGHT +1 arrow dmg · QUICKDRAW −8% draw *and* renock time · HUNTSMAN +15% animal-kill gold |
| chest | BULWARK +8 max hp · IRONHIDE −1 dmg from every hit (min 1) · HEARTHWEAVE +25% food heal, passive heal runs at night |
| legs | STRIDER +4% walk speed · SLIDEWORN −12% fatigue, slide engages 5 sooner · PACKMULE +1 gold on fells/breaks |
| boots | SKATES +8% ice cap, +0.15 steer · DANCER −0.4 s dodge refill · GHOSTSTEP wolves/turrets acquire at −10% range |

The variant pick is free and is **level 1**; in-match gold buys each piece to level `GEAR_LV_MAX`
(4) for `GEAR_COSTS` 10/20/35 — the second gold sink beside building. Levels reset with the match
(every boot builds fresh `Player`s). The human picks variants on the **gear page** — a full
screen after champion select showing all 12 variants at once as cards (League runes-style; see
[Main menu](rendering.md#main-menu-title)); `pickGear()` writes straight to `player.gear`. AI
slots hash all four variants from the seed in `initPlayers()`. **Every variant has its own
12×12 icon** (`SPRITES.gearIcons[slot][variant][material]`), so a pick is a distinct picture,
not a label.

**Worn gear shows on the sprite**: each piece at level 2+ lays a 1 px band of its material across
the shared 16×16 body plan — hat, coat, hips, one mark per foot (`GEAR_MARKS`/`drawGearMarks`,
called from `drawPlayer` under the held tool; skipped while rolling, in a hole, or in title). The
free level-1 pick draws nothing, so the baseline look stays the champion's; a fed player reads
iron → steel → gold at a glance, the same materials the HUD plates wear.

**Mechanism**: a variant's `mod(k, L)` writes its bonus into the slot's *effective kit* —
`refreshKit(p)` copies the champion kit, adds the gear-only defaults (`huntMul`, `dr`, `foodMul`,
`nightHeal`, `walkMul`, `harvest`, `dodgeCd`, `stealth`) and applies the four mods; `kitOf(p)`
returns that cache, so every existing kit read site (movement, `fireArrow`, dodge timing, the AI,
the draw meter) picks gear up without knowing it exists. The sim never reads `p.gear` directly.
Sites that read the gear-only fields: `damagePlayer` (`dr`), `eatBerry`/`eatFish` and the daylight
regen (`foodMul`/`nightHeal`), `hitObject`'s fell/break payouts (`harvest`), `animalDies`
(`huntMul`, paid to `a.lastHit` — stamped by the arrow loop — as one extra coin), **`seenAt()`**
(`stealth` — see [Prone](#prone-under-the-snow); the wolf pack, both turret checks *and*
`aiNearestEnemy` all go through it now, so GHOSTSTEP finally does something against another
player instead of only against wolves and turrets), and the three dodge-refill sites (`dodgeCd`).

**Buying** goes through `input.cmd = {kind:'gear', piece}` → `runCmd` → `buyGear(p, i)` — the one
entry point: it re-validates cost, pays, bumps `gearLv`, rebuilds the kit, and heals a BULWARK
bump on the spot like a hero level. No tile, no reach, no contest — it only touches the buyer's
own wallet. The human sends it from keys **1–4** or by clicking the **gear row**: four 18 px
plates bottom-right (`gearRects`/`gearHit`/`drawGearRow`, UI banner), one per piece head-to-toe.
A plate shows **your variant's own icon** in the **material of its level** (leather → iron →
steel → gold), pips under the icon count the buys, a 1 px meter under the plate fills as the purse
approaches the next cost, an affordable piece grows a bobbing gold chevron, hover lifts the plate
and shows the cost (coin + number, nothing else), and a maxed piece goes quiet behind a gold rim.
`gearHit` is shared by the click handler, `cursorInfo` (hand cursor) and the row's hover, so they
can never disagree; the click is swallowed **before** `clickAction`, the one left-clickable HUD
widget in play. Bots buy in `updateAI`'s spend step: cheapest piece first, keeping a 15-gold
float so they still build.

## Base building

Right-clicking a **stump** within 60 px opens a radial **build wheel** anchored at the stump's
screen position (clamped to stay on-screen): up = wall, right = turret, down = generator, left =
bot bay (`STRUCT_ORDER`, type `spawner`); push out of the hub and release over a wedge to build,
release inside the hub to cancel. Right-clicking a **finished** structure (any tile of it) opens a
**manage wheel**: upgrade straight up, demolish last, and a bay's mode toggle between them. This wheel is the **only** way to build —
there are no free-placed buildables. All the data lives in the `STRUCTS` table: three tiers for
wall/turret/generator (the wood → stone → gold *look* is just the sprite palette) and **one for the
bay**, each with a gold `cost`, `hp`, `buildT`, and per-type stats. `tiers[0]` is what the wheel
builds; upgrading pays the next tier's cost and re-runs a shorter construction, and the last tier
(`tiers.length - 1`) reports MAX TIER. Building and [gear](#gear) are the two gold sinks.

Mechanics, all in `game.js`:

- `state.wheel` (`{kind:'build'|'manage', tx, ty, seg, ax, ay}`) is the open wheel; ESC/M/settings/death
  close it, a left-click cancels it, and the game **keeps running** — opening the
  wheel mid-night is deliberate pressure. `wheelLayout()` is shared by `resolveWheel()` and
  `renderWheel()` so hover math and pixels can never disagree. `resolveWheel()` does not act: it
  writes `player.input.cmd`, and `runCmd(p, c)` performs it in the next sim step (re-checking
  ownership and the 60 px reach).
- **One geometry, any number of options.** `wheelSpan(n)` is `2*PI/n` and `wheelAng(i, n)` is
  `-PI/2 + i * span`: n wedges of exactly the same size, the first centred straight up and the
  rest clockwise. Nothing is special-cased per count — 4 options land on up/right/down/left and 2
  on up/down because that is what the formula gives, and 3 land 120° apart. The hover test reads
  the segment with the *same* `floor((angle + span/2) / span)` the wedges are drawn from, so a
  wedge is exactly its own hitbox at any count. `wheelOptions()` returns ids only; `wheelLayout()`
  stamps the angle on each, so there is one source for the layout.
- **Radii** (all in the `radial wheel` banner): `WHEEL_HUB` 13 is the hole in the middle,
  `WHEEL_R` 40 the rim, `WHEEL_PAD` 4 the backing disc beyond it, and `WHEEL_RING` — the midpoint
  of the band — is where every icon and label sits, so they are the same distance from the centre
  in every direction. Wedges are drawn as annulus sectors (arc out at `WHEEL_R`, arc back at
  `WHEEL_HUB`) with a `WHEEL_GAP` of daylight between them, measured in px at the rim so the gap
  looks the same however many wedges there are.
- **The hub is the cancel target.** It carries a cross rather than the word CANCEL, and goes hot
  red while the pointer is inside it — which is where the pointer starts, so the way out is the way
  you came in. `WHEEL_HUB` is also the deadzone: nothing is chosen until the pointer travels 13 px,
  which makes a plain right-click (press and release without moving) a no-op. ESC and a left-click
  both close the wheel outright, and the left-click also stops the right-release that follows from
  firing the order.
- **The pointer is measured from `ax`/`ay`, the point the right button went down at**, not from
  the wheel's drawn hub: that press is what the hand remembers, and the hub is pinned to the tile,
  so it drifts as the camera follows the player and gets clamped near a screen edge. Because that
  travel is invisible (the cursor can be anywhere on screen), `drawWheelStick()` draws it at the
  hub as a knob that moves **1:1** with the pointer — so the knob is visibly inside the lit wedge —
  clamped to the lane between the hub rim and the icon ring so it never lands on an icon. Grey on
  the cross means nothing is chosen; gold out in a wedge means that is what a release will do.
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
- **Turret**: picks the nearest enemy player or worker bot inside `tiers[tier].range`, swings the
  gun onto it at `traverse` rad/s (2.2 / 3.0 / 3.8 — it never snaps), and once the bearing is
  inside `TUR_LOCK` (0.14 rad) charges for `aim` seconds (0.55 / 0.45 / 0.35) before firing a
  **bolt** every `rate` seconds. Losing the bearing bleeds the charge back down rather than
  cancelling it. Targeting runs through `turretMark`/`turretHolds`, which reject anything on the
  turret's own team, anything dead, and any slot still `inAir` on the eagle; `turretSees` walks
  tiles from the pivot and holds fire when a solid tile blocks the shot, skipping the turret's own
  footprint (the pivot sits above the tile, so the first samples fall back inside the mount). With
  no mark it sweeps ±1.15 rad at a third of its traverse, so a live turret never reads as a prop.
  A bolt is an ordinary entry in `arrows` tagged `kind: 'bolt'`, so it inherits arrow collision,
  friendly fire and kill credit for free — it just draws differently and flies at `BOLT_SPD` (250).
  `fireBolt` walks the spawn point out of the turret's own footprint first: turrets are solid
  tiles and bolts die on solid tiles, so a depressed barrel would otherwise shoot itself.
  **Generator**: pays `tiers[tier].pay` gold every `period` seconds as one
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
- **Buildings take damage from E, but only from the other team.** `hitObject()`'s structure
  branch deals `STRUCT_HIT_DMG` (10) a swing, at the `swingCd` of 0.34 s — so ~2 s for a tier-1
  wall (60 hp), ~10 s for a tier-3 one (300 hp), ~7.5 s for the bay (220 hp). It flashes and
  shakes the building like any other struck object, floats the damage, and shakes the camera for
  the local player. Damage is **contested** with everything else E does, since it runs inside
  `swingHit`'s `contest('work:' + idx)`. At 0 hp it calls `destroyStructure(o, true)` — the wreck
  pays out exactly like a demolition, so the rubble is loot for whoever is standing closest — and
  logs `<NAME> WRECKED A <TYPE>` to the event feed. Nothing else damages a building: arrows die
  on solid tiles without hurting them, and no AI or wildlife targets one.
- Demolish refunds **50% of the cumulative cost across tiers** (`cumulativeCost`), spawned as
  that many separate 1-gold drops — 23 of them for a fully-upgraded wall. `demolishStruct()` →
  `destroyStructure(o, true)` is the live path for that, reached from `runCmd` for the wheel's
  demolish order. `canAfford`/`pay`/`costText` are generic over every `inv` key.
- **Every damaged building wears an hp bar** (`drawHealthBar`, centred on the sprite, `sy - 5`),
  drawn only once `hp < maxHp` so an untouched base stays clean — and never while `building`, when
  hp is climbing rather than falling. The bot bay is excluded: `drawBayOverlay` draws its own at
  `sy - 11`. Below 60% hp a building also picks up four crack marks placed as fractions of its
  sprite, so damage reads without the bar.
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
carried gold shows as a nugget up front), and show a health bar. Their SFX are gated on player proximity
(`nearPlayer`) so a remote base doesn't spam audio.

A worker is **shootable**: `robotHit(b, x, y)` is its hitbox (radius 7 about `b.y - 1`, the middle
of a body whose treads sit at `b.y + 4`), and `hurtRobot(b, dmg, nx, ny, src)` is the single entry
point for damage — flash, knockback, a damage floater, a scrap-and-sparks burst, `SFX.hit`, and
`robotDies` at zero. Only arrows reach it, and only from another team (friendly fire is off, as it
is for players), so a bay's own side drives through its workers safely. `robotDies(b, src)`
**spills whatever the worker was hauling** as up to three gold coins splitting `b.carry` — which is
what makes shooting a loaded worker on its way home worth the arrows — and logs
`<NAME> SCRAPPED A WORKER` to the feed. A downed worker is not a downed slot, so it never touches
the kill count. `updateRobot`'s own `hp <= 0` check routes through the same function (with no
`src`, so the wreck goes unclaimed). Turret bolts ride the arrow pipeline, so a turret's mark
finally dies; nothing else — a swing, wildlife, the AI's target picker — goes after a worker.

## Death is final

`die(p, src, cause)` marks that slot dead, drops its bow draw and clears its momentum; there is no
respawn — a dead slot stays out for the rest of the match. **Death empties the wallet**
(`spillInventory(p, killer)`, right beside `die`): a credited killer pockets the victim's gold
outright through `gainGold` — so a kill levels the killer, which is the bounty that makes taking
the fight worth it — while an uncredited death (ice, wolves, or the killer already dead) spills it
as up to 5 coins at the corpse. Every **other** `inv` key always spills as pickups, split into up
to 3 drops like a downed worker's carry — food today, and any future resource key (wood, stone,
hide) will spill through the same loop without touching death code; the drop draw pass and pickup
handler are already generic per type (`itemFish` included). The standings are unaffected because
`scoreOf` ranks lifetime `xp`, not the purse, so a looted slot keeps the place it earned. `die`
also credits the kill and writes the feed line — see
[Kills and the event feed](multiplayer.md#kills-and-the-event-feed) — and then
`checkLastStanding()` asks whether every **rival** is now gone, which ends the match as a win.
Rivals, not players: `rivalCount(p, all)` counts live slots on another team by the same rule
`enemyOf` states, minus its `inAir()` skip (a rival on the eagle has not lost, it is about to
land), so **teams win together** — a surviving teammate is not something left to beat. `all` asks
the same question of the whole roster, dead included, and a match that never fielded a rival
cannot be won. Either way the local slot leaves through
`endMatch('lost' | 'won')` (the `death & spectate` banner): `state.mode = 'dead'`, every local
overlay closed, and the screen goes to the loss overlay — two planks, **SPECTATE** and
**LOBBY** — or to [the victory screen](rendering.md#the-victory-screen), whose planks are
**KEEP PLAYING** and **LOBBY**. A win also freezes what it will print (`winSnapshot()` on
`state.win`: gold, kills, level, clock, team, champion and the kit) because the match keeps
running underneath and a total that climbs behind a tally which already counted it reads as a
bug. Spectating sets `state.spec` to a living rival's id and
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
without you. Only **pause (P) and the settings panel (ESC)** stop the sim;
`update()` (time, darkness, camera, fx) always keeps running. In `title` only the ambient half
runs (`updateTitle`: animals and fish) — see [Main menu](rendering.md#main-menu-title).

## The M map does not pause

**M** opens the world chart with the sim still stepping, the same deal the
[build wheel](#base-building) takes: night still falls, arrows still fly, bots still hunt you.
`sampleHumanInput` handles it in its own branch, and the rule is *the map keeps your feet and
nothing else*: `mx`/`my` and `slide` are read as usual, the edge-triggered `dodge`/`prone` pass
straight through, and `fire`/`work`/`eatBerry`/`eatFish`/`cmd` are dropped along with any held
draw (the pointer is over the parchment, so there is nothing to aim or work at, and a gear plate
bought blind under the dim would be bought by accident). So you walk with the chart up and watch
your own marker cross it. Consequences worth knowing:

- The replay ring keeps recording (`replayLive`) — the capture point is above the map's dim, so
  the banked frames are clean world frames. `replayShowing` still hides the *window* under the panel.
- Dying with the map open is now possible; `endMatch` already clears `state.mapOpen`, and M only
  toggles in `play` mode, so the chart cannot survive into the death overlay.
- The world keeps the zoom you were playing at. The panel is a fixed 308×226 and the canvas no
  longer shrinks when you zoom ([World zoom](rendering.md#world-zoom-and-the-two-pixel-spaces)),
  so it fits regardless and the map no longer yanks the camera back to base.

## Settings

`settings` (`v`, `volume`, `mmR`, `mmZoom`, `shake`, `muted`, `info`, `pixelCursor`, `hitbox`, `paths`) persists to
`localStorage['softfall.settings']`. `applyMinimapSize()` must be called after changing `mmR` —
it recomputes `MM_R`/`MM_CX`/`MM_CY`, which the resource row in `renderUI()` also positions
itself against. (Old saves may still carry `res`, `fps` or `seed` keys from removed settings;
`Object.assign` in `loadSettings` copies them harmlessly and nothing reads them.)

There is no fullscreen control in the ESC menu (players use F11); a `fullscreenchange` listener
still refits the canvas when the browser toggles it.

Below the six rows, the baked CONTROLS block lists the hotkeys in columns of **seven and eight**
(`buildSettingsPanel`) — `CTRL SNEAK` joined the left one, `. HITBOX` and `, PATHS` the right one,
which is why the rows start at y 137 and the pitch is 9 rather than 10: the eighth still has to
clear `ESC CLOSE`. The title screen's TUTORIAL panel carries the same key
as `CTRL HIDE IN SNOW`.

`settings.info` (one INFO DISPLAY toggle row in the ESC menu, **or F3**, minecraft-style — the
keydown handler flips it in any mode and suppresses the browser's find bar; default off) shows
the **info stack** — `drawTags()`, a vertical list on the left edge at the top quarter of the
view, clear of the berry/fish counters, drawn above every overlay. Three lines — **FPS** (`loop()`
accumulates raw unclamped frame deltas into `perf` and refreshes `perf.fps` every half second),
**POS**, the tile coordinates of the slot the camera frames (`viewPlayer()`, so spectators read
the watched slot), and **SEED**, the run seed (see
[world.md](world.md#determinism-and-noise)) — each drawn as a dim label plus a value on one
shared x, so the numbers line up in a column; that dim-label / bright-value pairing is the same
one the berry and fish counters use. **Red on the fps value (below 45) is the only colour in the
stack that means anything** — nothing else is tinted, which is what lets the warning read. In
title only the fps line shows.

`settings.hitbox` is the same idea one key over: **`.`** cycles it 0 → 1 → 2 (off / bodies /
bodies + ranges) in any mode, and draws the circles and boxes the sim actually tests over the
sprites that hide them; `settings.paths`, toggled by **`,`**, draws the route every walker is
following and the tile it is heading for. Neither has an ESC-menu row — only the `. HITBOX` and
`, PATHS` lines in the CONTROLS block. Both are in
[Debug overlays](rendering.md#debug-overlays-hitboxes-and-routes).

Beneath the minimap
`renderMinimap()` prints one centred row: a 5×7 pixel figure (`ALIVE_ICON`, no label) with
`aliveCount()` — slots active and not dead, riders included — then the elapsed clock.

## Audio

`SFX` creates its `AudioContext` lazily inside `ensure()`. Browsers require a user gesture, so
`SFX.unlock()` is called from click handlers — any new entry point that plays sound before the
first click needs to call it too.

The bow's rhythm has three of its own: `SFX.nock()` (a dry wooden tick when the renock clears —
deliberately near-silent, since it fires after every shot), `SFX.dryFire()` (a slack string on an
empty quiver) and `SFX.shaftPull()` (retrieving a spent arrow). See
[the quiver](#the-quiver).

[Prone](#prone-under-the-snow) has four: `SFX.bury()` (a body dropping into deep snow — low crunch,
no pitch), `SFX.hidden()` (the cover finishing, barely there on purpose: it is the sound of *not*
being heard, and it plays with a rival somewhere close by), `SFX.rise()` (the snow shed in one
shove) and `SFX.ambush()` (the shot out of the snow landing — deeper and harder than `hit()`, with
a crack over the top, so an ambush never sounds like an ordinary arrow).

`SFX.victory()` (a four-note fanfare over a held low fifth) is the one cue longer than a second;
`endMatch` fires it the moment the match is won. `SFX.tally()` is the dry blip a climbing number
makes on the victory screen — see [The victory screen](rendering.md#the-victory-screen) for the
rest of that timeline.

