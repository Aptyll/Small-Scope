# Gameplay systems

The player (momentum, tools, dodge), the entities that share the world, the gold economy, what
you can build, and the supporting subsystems. Read this before changing how an input resolves,
what something pays out, or what a structure does.

Everything below describes **a player**, not *the* player: each mechanic runs per slot off
`p.input`, and `player` is only the local slot. [multiplayer.md](multiplayer.md) covers the slot
model, the input struct, teams, bots and how two players' orders are resolved.

> Several numbers below (ice cap, steer, slide threshold and fatigue, draw time and speed, arrow
> damage, dash speed, max hp) are **per class** — the constants are baselines the kits are
> written against and the sim reads them through `kitOf(p)`. See [Classes](multiplayer.md#classes).

## Momentum movement (players only)

A player moves on a real velocity (`p.vx/vy`): `p.input.mx/my` accelerates, and the surface
underfoot sets friction and speed caps. All the tuning constants live in the `players` banner of
[js/player.js](../../js/player.js) (`ICE_MAX`, `SLIDE_MIN`/`SLIDE_EXIT`, `TRAIL_MIN`, above
`CLASSES`, whose kits are written against them) and the per-surface rates inline in
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
  chain into real speed on ice but die fast on snow. I-frames still end with the roll. That
  carried speed is also what the roll **hits** for — see [The roll is a hit](#the-roll-is-a-hit).
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
  normal movement, so you never grind along a treeline at full speed. A wall taken **head-on
  mid-roll** costs more than the axis: past `TACKLE_MIN` of speed driven into it, that is a
  [tackle](#the-roll-is-a-hit).
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

**A live dodge roll is the one exception to any of it.** `separateUnits` skips a pair outright
when one side is a player mid-roll and the other is *small* — every player, every robot, and
every animal but a deer — because the roll goes through them and
[swipes them](#the-roll-is-a-hit) instead of shoving them. A deer keeps its mass and its contact,
which is what makes running into one a tackle rather than a pass.

## Pathfinding

Everything that walks to a goal on its own — robots, bot slots, hunting wolves and patrolling
ones, prey both fleeing and grazing, any future enemy — routes through the `pathfinding` banner
rather than steering straight at it. Nothing that walks holds a bare heading on a timer any more.
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

## Tools and bits

Everything in this section lives in **[js/tools.js](../../js/tools.js)**, under the `tools & bits`
banner. It loads after `actions.js` because a shot it fires is the arrow pipeline's, and its
top-level code registers one `ITEMS` row per kind — which is what makes the bag, the drop pickup,
the death spill and the refusal flash work on tools and bits with no storage code of their own.

**There is ONE weapon slot** (`p.tools`, `TOOL_SLOTS` = 1 — the array and the drag plumbing stay
generic over it), and the left button fires it. Keys 1-4 belong to the
[class abilities](#class-abilities-keys-1-4) now. The slot holds a **tool**; a tool holds
**bits**; the bits are what actually fly. Both are found in the world, never bought, and both are
carried items you can drag around — so the weapon is a thing a player assembles rather than a
thing they are issued.

### A tool

One entry in the `TOOLS` table (`shortbow`, `sling`, `recurve`, `hornbow`, `longbow`). A tool is a
**body** and carries no behaviour of its own — three numbers and a look:

| field | means |
| --- | --- |
| `rof` | game steps between shots. `toolRof(p, cell)` turns it into seconds and scales it by `kit.nock / BOW_NOCK`, so QUICKDRAW, the LOOSE ability rank and QUICK HANDS all still quicken it |
| `cap` | how many bit cells it has (2–5) |
| `tensile` | the heaviest bit it can throw; anything heavier sits in its cell as dead weight and is skipped |
| `tier` / `art` | which of the three `TOOL_TIERS` palettes it wears, and which 12×12 silhouette |

A tool is **instanced**: its bag cell *is* the tool, `bits` array and all (`makeTool`), so it is
moved between bag, slot and drop rather than rebuilt from its type name — see the hard rule in
[CLAUDE.md](../../CLAUDE.md#hard-rules). That is what makes "throw a loaded tool away and pick it
up later" work with no code: `spawnDrop`'s `it` payload is the same object the bag had, and
`bagPut` puts that same object back.

### A bit

One entry in the `BITS` table, and there are two kinds of them, told apart by `proj`.

A **projectile bit** is one shot: `weight` (what the tool has to be strong enough to throw),
`path` (how it flies), `solid` (whether a wall stops it), `ff` (whether it will hurt your own
side), `life`/`speed`/`dmg` as baselines, and `stick` — whether the spent shot lands as a shaft
anyone can pull back out. Optional `lit` is a light radius it carries in flight.

A **modifier bit** (`proj: false`) never flies and has no weight. Its `mod(m)` edits the envelope
**every projectile bit on the same tool** is fired through, folded once per press by `toolMods`:
`spdMul`, `dmgMul`, `dmgAdd`, `lifeMul`, `fan` (one shot becomes N in a spread), `burn`, `twin`
(fire the next two projectile bits in one press) and `lit`. SPEEDUP, SPLITTER, FLAME, DUPLICATE,
HEFT and LONGSHOT are the six that exist.

### Firing

`fireTool(p)` is the one entry point — the falling edge of `input.fire`, for every slot alike:

1. Read the cover first (`ambushReady`), before anything below can break it.
2. `spearFish(p)` — bow-fishing survived the new weapon: **any** tool, standing on ice with a fish
   in `FISH_CATCH_R`, spears through the sheet instead of loosing. It takes the press and the
   cycle, and costs no arrow.
3. No tool on the selected slot → `dryFire(p)` and stop.
4. `toolMods(cell)`; DUPLICATE makes the press consume two bits instead of one.
5. Per shot: spend one from the quiver, `nextBit(cell)` (walk forward from `cell.idx`, wrapping
   once, and take the first bit that is a projectile **and** light enough — the index tracker
   lands one past what it found, which is what makes the list cycle), then `emitBit`.
6. Nothing fired at all → `dryFire`. Otherwise `p.nockT = toolRof(...)`, one `SFX.arrow`, and
   `risePlayer` (the shot is what breaks cover).

`emitBit` is where the player is folded back in: the bit's own damage leads, and the draw
(`pwScale`), the class kit's `dmgBase`/`dmgPow`, the kit's speed bonus (`spdDmg`), the hero level and then
the modifiers scale it — so gear, cards and levels all still matter to a weapon they know nothing
about. The shot goes into the same `arrows` array as before, carrying `path`, `solid`, `ff`,
`stick`, `burn`, `lit` and `col` alongside the old fields.

`toolReady(p)` is the second half of the old quiver gate: an empty slot and a tool with no bit
light enough to throw are both as dry as an empty quiver, and `updatePlayer` refuses the draw on
all three the same way.

### Flight paths

`steerBit(a, dt)` runs once per shot per sim step **before** the step is integrated, so the path
owns the velocity and the trail, the hit tests and the drawn body just follow it. A turret bolt
carries no `path` and falls straight through.

| `path` | what it does |
| --- | --- |
| `line` | nothing — the old arrow, and it costs nothing |
| `zig` | the bearing weaves ±`ZIG_SWING` at `ZIG_HZ` |
| `lob` | drag on both axes plus `LOB_FALL` gravity: a heavy throw that arcs down and lands |
| `boomer` | out on the bearing slowing to nothing, then hauled back to whoever threw it; the flight ends when it gets home |
| `orbit` | a ring of `ORBIT_R` around the shooter, eased out over the first 0.25 s and swept at its own speed |

Three per-bit rules land in the arrow update in `updatePlay`: `a.solid !== false` gates the tile
test (that is the whole of "never hits ground"), `a.ff` lifts the team check on players and worker
bots (never on the shooter, at any weight), and `a.stick` decides whether the spent shot leaves a
shaft. A burning shot trails fire instead of team colour and bursts embers where it lands.

### The bit column

**Hovering the weapon well raises its bit cells out of it** — `bitEditSlot()` (js/tools.js) is
derived from the pointer every read, never stored: open over the well, kept open while the
pointer is on the risen column itself, and forced open while a **bit is being carried** anywhere
(the column is where a bit goes, so picking one up presents the destination). Cell 0 is at the
**bottom**, nearest the tool, because that is
what fires first; a gold caret on the left edge marks what the next press will fire and climbs as
the tool cycles. While the column is up the backpack is open too (`bagOpenNow`), because
customising a tool means dragging bits between the two. It is a hover, not a mode.

The drag is one mechanism shared by the grid, the weapon slot and the column
([UI banner](../../js/ui.js), `state.drag`): a press **arms** a pick-up and only travel past
`DRAG_SLOP` promotes it, so a tap on a berry still eats it
while a drag off either one picks it up. A release over any well that will take it puts it there;
over the rest of the HUD it goes home; **over the world it is thrown**, which is the only way to
get rid of a tool — and it goes with its bits.

### Where tools and bits come from

`dropLoot(x, y, tier, chance)` rolls one find on the shared `rng` at the moment a swing lands
(never inside `genWorld` — see the seed rule). `LOOT_TOOL` (0.3) of any find is a tool, the rest a
bit, and only kinds at or under the given tier are in the pool.

| source | chance | tier |
| --- | --- | --- |
| a broken rock | `ROCK_DROP` 0.2 | 0 |
| a felled tree | `TREE_DROP` 0.04 | 0 |
| a sprung chest | `CHEST_TOOL` 0.75 | up to 2 |

So the bottom tier lies around loose and the good stuff is in the treeline's chests. A found tool
comes out **empty** — its bits are the next thing to find.

The pool a roll draws from is not the whole table: it is what this profile has **researched**, so
a kind nobody has unlocked never appears in any match. See [the tech tree](#the-tech-tree).

### Tiers, and how a find reads

`TOOL_TIERS` is a colour and nothing else in the sim: what a tier buys you is written into each
tool's own numbers. The tier is stated in **one** place and the same way everywhere — the plate
behind the icon, in every well the item ever sits in (bag cell, weapon slot, bit cell, drag ghost,
loadout card) — which is why nothing on screen has to say "TIER 2". `tierPlate(type)` is that
lookup and `itemTier(type)` the raw index. The top tier is the only one that moves: `tierShine`
sweeps a highlight across its plate. On the ground a find glints in its tier's colour so it is
told from a berry at a distance. A tool's **shape** says which family it is and its **palette**
says its tier, so three 12×12 silhouettes cover five tools across three tiers — the same trick
`GEAR_MATS` plays with one gear icon across four materials.

### Bots

A bot has no bit column and no pointer, so `botFitLoadout(p)` (called from `updateAI`'s step 8 on
a 2.5 s timer) does by hand what a person does with a drag: push loose bits into the tool it is
firing, and put a spare tool on a free key — or over a strictly worse body, which then takes the
bag cell the new one came out of. It only takes bits that fly *toward* what they were aimed at; a
bot cannot read a boomerang or an orbit and leaves those for someone who can.

### Starting loadouts

`CLASS_LOADOUT` gives each class a tool and its bits, and `giveLoadout(p)` is called from
`Player.reset()` and from `setClass()` — so the weapon is part of picking a class, every AI
slot gets its own, and a respawn is re-armed. The HUNTER flies in with a SHORTBOW loaded ARROW +
BARBED SHOT; the WARRIOR with a SLING loaded ARROW + HEFT. Death **spills the equipped tool** with
the bag (`spillInventory`), so a build lies where its owner fell and the Keep hands back the
starting one — you come back armed, but not as the player you were. The gear pop-up's preview
shows the weapon at the body's side (`drawGearPreview`, js/menu.js) — the other half of what a
class flies out with.

## Class abilities (keys 1-4)

Everything in this section lives in **[js/abilities.js](../../js/abilities.js)**, under the
`class abilities` banner. Keys 1-4 cast the four actives of the slot's
[class](multiplayer.md#classes) — `CLASS_AB[p.cls]`, one row per key, where **what an ability IS
lives in its table entry** (`cd`, `cast`, `use(p)`), never in an `if` elsewhere. The press goes
through `input.ability` (edge-triggered, like the dodge) into `tryAbility(p, i)`, so a bot casts
through exactly the key a human presses; `updateAbilities(p, dt)` runs the cooldowns, lands the
cast, and ages every state an ability leaves on a body; `updateAbilityWorld(dt)` (called from
`updatePlay`) steps what they leave in the world.

**A cast is a performance**: `p.castT` runs the ability's `cast` seconds, the body visibly does
it (`abilityPose` shifts/tilts the sprite — a kneel to set a trap, a hop into the stomp, the
recoil hop off the net shot), movement halves, and the effect fires at the aim held at the END
of the cast. Casting breaks prone cover like a shot, is refused mid-roll / mid-stun / in a hole,
and a stun knocks a cast (and the shield, and a rush) out of the hands. Everything an ability
does to a body is **drawn on that body for both sides** (`drawAbilityOnPlayer`) — readability
first: a trap is plainly visible to both teams, a mark hangs gold chevrons over the head, a
netted player wears the net.

HUNTER — bow, traps, distance control:

| key | name | cd | what it does |
| --- | --- | --- | --- |
| 1 | **SNARE TRAP** | 10 s | sets an iron jaw at the aim (≤ `TRAP_RANGE`, tile-snapped, visible to everyone). Arms in 1 s — the jaws visibly spread — then the first rival on it takes 8 and is **rooted** (`p.rootT`, 1.2 s: no walk, no roll, no slide; tools still work). `TRAP_MAX` 2 per owner, a third springs the oldest |
| 2 | **NET SHOT** | 11 s | a weighted net down a line (`nets`): first rival hit takes 4 and is **slowed** (`p.slowT`/`slowMul` ×0.4, 2 s, the drape drawn on them); the recoil kicks the hunter backward with an animated hop (`p.hopT`) |
| 3 | **FALCON SWEEP** | 18 s | the bird flies the aim line (`falcons`, 340 px): every rival under it is **marked** (`p.markT`, 4 s) — `seenAt()` returns full range for a marked body (its one legal bypass) and both maps keep showing them |
| 4 | **VOLLEY** | 16 s | calls a rain on a circle at the aim (≤ 150 px): a dashed danger ring with an inner ring closing over 0.8 s, then 14 damage in `VOLLEY_R`, and `VOLLEY_SHAFTS` plain shafts stick for **anyone** — the ammo pillar holds even for a called strike |

WARRIOR — close pressure, blocking, momentum:

| key | name | cd | what it does |
| --- | --- | --- | --- |
| 1 | **SHIELD WALL** | 9 s | raises a tower shield toward the aim for up to 2.2 s (the key again lowers it early; the cooldown starts when it comes DOWN). Any shot flying into the front arc dies on it (`abShieldBlocks`, checked in the arrow loop before the body); walking drops to 40 % and the bow is out of hand |
| 2 | **BULL RUSH** | 12 s | charges the aim line at 300 px/s for 0.42 s (its own movement branch in `updatePlayer`, no i-frames): the **first rival hit is carried** on the shoulder and **slammed** at the end — 10 damage + 0.6 s stun, ×1.6 driven into a wall (`rushStep`/`rushEnd`) |
| 3 | **AVALANCHE STOMP** | 14 s | a leap-stomp at the feet: 12 damage + radial knockback + a beat of stun in `STOMP_R`, and the **crater** (`craters`) is deep snow that slows rivals crossing it for 4 s |
| 4 | **JUGGERNAUT** | 20 s | 5 s: immune to stun (`stunUnit` head) and knockback (`damagePlayer`), speed ramps +50 % over the duration, and body contact at speed bowls rivals over — damage scales with the speed carried in, once per rival per activation (`p.jugHit`) |

The movement caps fold through one function — `abilityMoveMul(p)`: root pins, cast/shield/net/
crater drag, juggernaut ramps — applied to the walk cap **and** the ice cap in `updatePlayer`.
All damage passes its `src`, so an ability kill credits like an arrow. Bots spend abilities in
`updateAI`'s fight rung, off cooldown at ranges each is good at. The strip's ability wells (icons,
cooldown wipes) are the HUD's half and live with it in [rendering.md](rendering.md).

## The tech tree

The one thing in this game that outlives a match, and the **only part of a profile that a match
reads back**. Every tool and every bit is a node; researching one is permanent; and what it buys
is that the kind joins the world's loot pool from then on. So the tree is not a shop and not a
skill tree — it is the arsenal the map is allowed to hand you, and it grows as you play. It is
reached from the main menu's **TECH TREE** plank (`m.screen = 'tech'`, its own `techT` ease, ESC
back); the page itself is in [rendering.md](rendering.md#the-tech-tree-screen).

The table is `TECH` in [js/tools.js](../../js/tools.js), and it carries exactly one edge per node:

```
req      the node beneath this one; null on the free tier-0 row
```

That is the whole graph, and because each lineage happens to be one root plus at most two
children, it also lays out as a 7×3 grid — one **row** per lineage, one **column** per tier, and
every edge a horizontal line. The seven lineages:

| root (WORN, free) | KEEN | GILDED |
| --- | --- | --- |
| SHORTBOW | RECURVE BOW | LONGBOW |
| SLING | HORN BOW | — |
| ARROW | CARE ARROW | ICE LANCE |
| BARBED SHOT | THROWING LOG | HEFT |
| HOOKSHOT | WISP | LONGSHOT |
| SPEEDUP | FLAME | — |
| SPLITTER | DUPLICATE | — |

**The whole tier-0 row is free and already done** (`techDone` returns true for tier 0 without
asking the profile), so a fresh install finds the basics from its first rock and an old save
needs no migration. Everything above opens one node at a time from the node beneath it
(`techOpen`), which is what makes this a tree rather than a list.

**Research is not a stored number.** `techPoints()` is
`floor(PROFILE.stats().gold / TECH_GOLD_PER_PT) − Σ techCost(done)` — earned from lifetime gold,
spent by what is already researched — so the two halves can never drift apart and there is no
counter to corrupt. `TECH_GOLD_PER_PT` is 50 and `TECH_COST` is `[0, 2, 4]` by tier, which puts
the first unlock inside a match or two.

**`techResearch(id)` is the only writer**, and it calls `rebuildLootPool()` itself — so the pool
and the profile cannot disagree. `LOOT_POOL` is rebuilt at boot (after `PROFILE.load()`, before
anything can swing) and on every unlock, never filtered per roll, because a drop happens in the
middle of a swing while the tree only changes between matches. `dropLoot` returns null on an empty
pool rather than throwing.

`PROFILE.markSeen(id)` is the other half and gates **nothing**: it is fired for the local player
only (`noteSeen(p, type)`) from the drop pickup and from the loadout they fly in with, and it puts
a blue pip on the node. The tree doubles as a record of what you have actually met in the snow.

Storage is [js/profile.js](../../js/profile.js) and nothing here writes a key — see
[architecture.md](architecture.md#profilejs).

## The swing tools (E)

The axe and the pick are **not selectable and are not weapons**. `SWING_TOOLS` (`bow`, `axe`,
`pick`, indices `SWING_BOW/AXE/PICK`) is an internal table for icons and names; `p.swing` is what
that player is *holding for work*, and it returns to `SWING_BOW` — which draws the weapon on the
selected slot — the moment a swing ends. Two verbs, two inputs:

- **Left click = the selected tool slot.** The press only records intent (`clickAction` sets
  `input.fire`); `updatePlayer` starts the draw on the rising edge and fires on the falling one.
- **E = work** (`tryWork(p)`, auto-repeating every swing cooldown while held — `updatePlayer`
  calls it whenever `p.input.work` is set). It resolves `workTarget(p)`: the tile that player is
  aiming at, if it holds a tree or a dead tree (→ axe), rock (→ pick), a berried bush (→ axe), or
  is bare ice with no object (→ pick, cracking toward a fishing hole); and `near` = the tile is
  within `WORK_REACH` (1) tiles, Chebyshev, of the tile the player stands on — i.e. the 3×3
  ring around you, never a second row, regardless of where in your tile you stand. Out of reach or nothing workable, E
  does nothing. A valid target swaps `p.swing` to the right one, drops any draw, faces the
  tile, and starts the swing; `swingHit(p)` **contests** the locked tile (`p.workTx/Ty`) so only
  one player's swing lands on it in a step, then hits whatever is there via
  `hitObject(o, p)`/`crackIce()`. Once `swingT` and `swingCd`
  both reach 0, `updatePlayer` puts the weapon back (`p.swing = SWING_BOW`), so the axe only
  exists visually for the duration of the work. `workTarget()` is shared with the cursor, so the
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

**Stumps and open ice holes** are not E targets — they are the right-click wheel's domain (`buildSiteAt`). **Buildings on another
team are**: `workTarget()` resolves the tile through `structOf()` (so any tile of a 3×2 footprint
counts, via its `part`) and returns the axe when `ownsStruct()` is false, and `swingHit` routes
the swing to the anchor. Your own buildings stay wheel-only, so E is never ambiguous. See
[Base building](#base-building) for the damage numbers. There is still no melee against animals:
the tool on the selected slot is the only weapon aimed at a living thing.

Every tool is **hold-to-charge**: holding the button arms the shot (`p.fireArmed`), the draw
starts as soon as the tool is actually ready and runs `p.charging`/`p.chargeT` (movement targets
scale to 55% — walk speed and the ice cap both — facing tracks the mouse, a draw meter renders
above the player's health bar), and the release edge fires via `fireTool(p)`. The draw scales the
bit's damage and a shot loosed out of full snow cover multiplies the lot by `AMBUSH_MUL` (see
[Prone](#prone-under-the-snow)). Shots carry their shooter's `owner`/`team`, live in the `arrows`
array, and are updated in `updatePlay()`: they die on solid tiles (unless the bit passes through
them), on a **rival player** (tested first — see [PvP](multiplayer.md#pvp)), on an **enemy worker
bot** (`robotHit`/`hurtRobot`, tested next), on any animal hit (knockback scales with power), or
at the end of the bit's life. They never hit structures — a building is broken by hand with E, not
shot. A shot from a bit with `stick` **leaves a shaft behind wherever it ends** (`stickArrow`) —
see [The quiver](#the-quiver).

`p.fireArmed` is what makes the draw survive a tool that isn't ready. It is set on the press edge,
cleared on release and at every point that cancels a draw (`tryWork`, falling in a hole, an
overlay opening in `sampleHumanInput`, changing slot, `die`), and the draw begins on the first
step where it is set *and* `nockT <= 0` *and* `toolReady(p)` *and* `quiver > 0`. Requiring a fresh
press instead would deadlock every controller that simply holds the button down — which is every
AI slot: `updateAI` sets `inp.fire = chargeT < bowCharge * k`, so after a shot it goes straight
back to true and no second edge ever arrives.

### The quiver

Arrows are a resource, and they are the ammunition for **every** projectile bit, not just the
plain one — which is what keeps an exotic loadout honest. `p.quiver` starts at `QUIVER_MAX` (6);
`fireTool` spends one per projectile bit fired (so DUPLICATE costs two) and sets
`p.nockT = toolRof(p, cell)` — the tool's own `rof`, scaled by the same `kit.nock` factors QUICKDRAW
and the loose ranks always moved — and no draw can begin while that runs. Below the ceiling,
`p.fletchT` accumulates and hands back one arrow every `kit.fletch` (starts at `QUIVER_REGEN`
2.4 s, shortened by fletch ranks) through `gainArrow` — the floor that keeps a player who never
picks anything up throttled rather than disarmed. Bow-fishing is the one press that costs nothing:
it never leaves the tool, so it takes the cycle but not the arrow.

Only a bit with `stick` comes back: the plain ARROW and the BARBED SHOT do, and a thrown log or a
conjured wisp plainly does not, which is a real cost on the heavy bits over and above their
weight. Spent shots land in **`shafts`** (`{x, y, nx, ny, team, t}`), one per sticking shot that
ends its flight, however it ends — miss, wall, body, or expiry. `stickArrow` places it 3 px back along the flight
(so it is never inside the tile that stopped it), drops it entirely if the tile is open water, and
trims the oldest past `SHAFT_MAX` (90). A shaft lives `SHAFT_LIFE` (30 s), is inert for
`SHAFT_ARM` (0.3 s), and is then **neutral**: any player inside `SHAFT_R` (10 px) whose quiver
isn't full claims it through `contest('shaft:' + i, …)`, exactly like a drop — so shooting at
someone on their ground is also shooting them ammo. Bots join in: `updateAI`'s loot step counts
shafts as loot once a bot is at or below half a quiver. Dying spills whatever is left in the
quiver as shafts around the body, the same way `spillInventory` spills the bag.

Five indicators carry it, and none of them is a word:

- **The hud strip's rail** (`drawHudStrip`, bottom-centre). Above it sit the five wells — the one
  weapon slot ([above](#tools-and-bits)) between the four class-ability wells
  ([rendering.md](rendering.md#the-hud-strip)); between them and the gold xp bar sits a thin rail carrying the
  two numbers a firefight is actually read off — what is left in the quiver, with the arrow that
  spends it, on the left, and the dodge charges as pips on the right. Both used to live on the
  ability wells that moved into the backpack, and both are needed with the pack shut. A gained
  arrow (`quiverFlash`) inks the count gold; an empty one reddens it and dims the icon, and a
  press on a tool that cannot answer (`dryT`, set by `dryFire`) reddens the selected slot's rim.
- **The ability row in the backpack** (`drawAbilityRow`) keeps the rest of that readout: the
  renock, dodge and fletch cooldowns still wipe their wells top-down, rank is three pips along the
  bottom edge, and an ability a skill point can land on wears a pulsing gold rim and a plus badge
  in its corner — gone the moment one cannot. The pack's own column counts the unspent points.
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

A shot in flight is drawn in its own pass (using `ex`/`ey`). Two bits have bodies of their own —
a `lob` tumbles as a spinning 5×5 block (`drawTumbler`) and an `orbit` is a breathing rimmed core
with no bearing at all (`drawMote`) — and everything else is the arrow silhouette, **rasterised
pixel by pixel** rather than stroked so it stays opaque and crisp at any angle: an 8 px shaft in
the bit's own `col`, two barbs 2 px back that keep the head pointing whatever direction it flies,
and 4 px of fletching at the tail in `TEAMS[a.team].mark` — so the bit is readable from the shaft
and whose shot it is from the tail. Every one of those
pixels is dilated into `ARROW_RIM` first (a plus-shaped 1 px dark edge) so the shaft reads over
snow, and the tip is left pure white. The body is built into the `ARROW_PX` scratch array, and a
shot off the edge of the view is skipped before any of it runs.

Behind it, each shot lays a **trail of team-coloured motes** into `particles` (fire instead, if a
FLAME modifier is riding it — the burn is the more urgent fact about that shot than whose it is),
one every
`ARROW_TRAIL_STEP` (4) px of *flight distance* — not per tick, so a slow arrow streaks as evenly
as a fast one, and a long frame is subdivided instead of leaving a gap. Motes are dropped at the
distance behind the head they are owed (`a.trailD` banks the remainder), drift back at 8 px/s and
fade from `ARROW_TRAIL_A` (0.7) over `ARROW_TRAIL_LIFE` (0.22 s), leaving a tail that thins out
behind the shot. The particle draw pass is what makes that possible: a particle's
`maxLife` is the seconds it spends fading (`burst` uses 0.4) and its optional `alpha` caps how
opaque it ever gets. Particles draw before the arrows, so a trail always sits under its own shaft.
Switching tools, opening an overlay, or dying drops the draw without firing (and clears
`fireArmed` with it); `BOW_CHARGE` (0.9 s) is a full draw.

While a tool is drawn, `drawAimLine()` (called from `render()` right before the shots pass, using
`ex`/`ey`) shows the shot: a static line of 2×2 drop-shadowed dots from the spawn point along the
exact direction `emitBit()` uses. Both aim from `player.y - BOW_Y` (6 px above the feet, where the
shot spawns) — not the feet — so the line and the flight pass exactly through the cursor instead
of running parallel a few px above it.

The line is **truthful, not decorative**, and it is truthful about the **bit that is up next**
(`peekBit`), not about a bow in general: it runs exactly as far as that bit would fly
(`speed × life`, both through the tool's modifiers), and only stops at an `isSolidTile` if that
bit is one a wall stops. It still stops at the first animal it would hit (the same 8 px body test
as the arrow update) with an impact cross — line-coloured on a solid, hunt-amber on a body — and
otherwise ends in a short perpendicular range-cap bar. A `lob` gets only the first 35% of its
flight, where it is still on the bearing; a `boomer` or an `orbit` gets **no line at all**, since
the only honest straight line for those is none — what they do is shown by the shot itself the
moment it leaves. Colour follows the draw meter: yellow charging, hot orange at full. If the
player stands on ice with a fish inside `FISH_CATCH_R` the line is replaced by four ticks closing
over that fish, because that press becomes the catch and never flies.

The weapon is also drawn **on the player** by `drawHeldTool()` (called from `drawPlayer()`): at
rest the hands hold the tool on the *selected slot*, in its own tier colour, so what someone is
carrying reads off their sprite from across the snow — and an empty slot reads as empty hands.
It is carried at the hand while idle/walking (mirrored via a `scale(-1,1)` transform for `left`,
drawn *before* the body sprite for `up` so it's occluded, 1px walk bob), and rotated toward the
mouse while drawn — the bow art fires along −x (arc on the left), so aim rotation is `a + PI`.
Mid-swing the axe or pick takes over, swept along the same arc as the swing effect. Both sizes go
through the same code: the icon is centred on its own half-width, 8×8 for a swing tool and 12×12
for a weapon.

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

### The roll is a hit

A dash is a body thrown at whatever is in front of it. Every step of the roll, `rollSweep(p)`
takes everything inside `ROLL_HIT_R` (7px) of the roller's own radius and splits it two ways:

- **Small — rabbits, wolves, robots, other slots.** One swipe each, **once per roll**
  (`p.rollHit`, cleared by `tryDodge` and again when the roll ends), and the roll goes straight
  **through** them: `separateUnits` skips any pair where one side is a live roll and the other is
  small, so there is nothing to bump against. Friendly bots and teammates are passed through
  untouched — you roll *under* them, you do not run them down. A rival with i-frames up (mid-roll
  of their own) refuses the whole thing, damage and stun both, so **rolls cancel rolls**.
- **Big — a deer, a tree, a rock, a building.** A **tackle**: both sides take it, both are
  stunned, and the roll ends on the spot. `rollTackle` drops the roller's own i-frames first,
  because the tackle is the one hit a roll cannot dodge, and bounces them back off the contact.
  A wall only counts when it is taken head-on — the speed actually driven into the axis
  `moveEntity` refused has to clear `TACKLE_MIN` (120 px/s), so brushing past a pine at a run is
  free and dashing straight into one is not. `tackleObject` puts real damage into an **enemy
  building** (it has an hp pool); a tree or a rock only shudders, because its `hp` is a chop count
  behind a tool gate and a shoulder is not an axe. Fish are under the ice and are in none of it — and
  nor is a **fish net**, which is not solid, so a roll crosses one without a contact at all.

**Everything scales with the speed the roll is actually carrying** — `rollPow` runs from the
class's own `kit.dodgeSpeed` up to `ROLL_FAST` (340 px/s), which is why a dash launched out of
an ice slide deals `ROLL_DMG`'s top end (16 and a 1.1s stun) against 5 and 0.5s off a standing
start. That is the whole reason to chain a dash out of momentum instead of from rest.

### Stun

`stunUnit(e, t)` is one state across all three kinds of unit, and it never touches velocity —
whatever hit you still slides you, and the surface spends it like any other momentum.

- a **player** has every intent dropped out of `p.input` at the top of `updatePlayer` (movement,
  fire, work, slide, the edge-triggered lot) rather than each action refusing separately, so a
  human and an AI fill are pinned by the identical window. The draw, the swing in flight and any
  roll are cancelled outright.
- an **animal** or a **robot** skips its brain for the window in `updateAnimal`/`updateRobot`; a
  shove still moves it, and an animal drops the route it was walking when it comes round.

The tell is one visual everywhere: **three sparks orbiting** (`drawStunStars`), phased off the
unit's own `stunT` so no global clock is involved and two stunned units are never in lockstep.
Over an animal or a robot they sit above the health bar. On a player they ride a badge that
**mirrors the level badge on the other side of the overhead frame** — same backing and track, its
left frame column shared with the health bar backing's right edge — whose 5×5 track drains from
the bottom as the window runs out (`stunMax` is the height it drains from). It is drawn for every
slot, like the stamina bar: a rival seeing stars is a tell worth having.

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

`p.hide` (0..1) is the whole state. It climbs at `1 / kit.bury` (starts at `PRONE_BURY` 1.5 s,
shortened by ambush ranks) while lying **still on
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
`fireTool` reads it before anything else can break the cover, multiplies the whole damage roll
(class + power + speed + level) by `kit.ambushMul` (starts at `AMBUSH_MUL` 2.5, grown by ambush
ranks), tags the arrow `ambush: true`, and calls
`risePlayer` after the loose — one ambush per burrow, then you are a player lying in the open with
a bow that still has to be renocked. A HUNTER's full draw goes 12 → 30. Bow-fishing is the exception
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

Prey behaviour lives in `updatePrey()`, and **every step of it is a routed goal** — grazing
included, which is what keeps the `.` overlay honest ([rendering.md](rendering.md#routes)).

- **Grazing.** Idle, then pick one goal and walk it. `wanderGoal(a, base, spread, near, far)`
  tries 8 tiles in an arc, takes the first it can actually route to, and returns `null` when the
  animal is boxed in (the caller just idles and picks again). `preyWander` is the per-kind
  chooser: a rabbit with a berried bush inside 7 tiles (`nearestBerryBush`) aims at it and
  returns `null` — idling, i.e. "nibbling" — once within 22 px, which is what makes a bush patch
  read as a warren; everyone else takes an open direction, 3–6 tiles. `navStep` walks it at
  `PREY_SPD`, and arriving (or `ok === false`) drops the goal and idles.
- **Bolting.** Both species now flee, on `FLEE_SIGHT` / `FLEE_TIME`: a rabbit sits tight and goes
  at 26 px, a deer watches wider and runs longer at 46 px. The trigger asks
  **`seenAt(p, FLEE_SIGHT[kind])`**, not raw distance, so GHOSTSTEP and lying buried in the snow
  are how a hunter closes on a deer at all — measured, full cover collapses a deer's ring from 46
  to `PRONE_SNIFF` (22), and inside *that* it bolts no matter what you are lying under. A hit
  also sends either species running from the nearest player (`fleeT`).
- **The flight** is a chain of routed legs at `PREY_RUN`: `fleeGoal(a, from)` picks a tile ~6
  tiles off, as straight away from the threat as the ground allows (fanning out, then sideways,
  then past it), the first it can route to; a leg that arrives or fails hands over to the next,
  and an animal with nowhere to run stops fleeing.

A kill pays its `YIELD` gold straight to whoever landed the final blow (`a.lastHit`, through
`awardGold` — see [Economy](#economy-one-currency)); rabbits also drop 1 berry as a physical
pickup. Arrows are the only thing that hurts any of them (there is no melee); animals are solid
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
- **Off duty** it patrols its den on routed legs from the same `wanderGoal` the prey graze with
  (2–5 tiles); once it drifts past `r * 0.8` the arc narrows to 0.5 rad straight back at the den,
  so the only way it will walk out there is home. Taking a quarry drops the patrol goal.
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

Every player owns a wallet **and** a bag. `p.inv` is `{ gold }` — currency only, no ceiling —
while everything you *carry* lives in `p.bag`, the slot array described in
[Inventory and the backpack](#inventory-and-the-backpack). (`inv` is an alias for the local
slot's wallet.) **Gold is the only resource** — there is no wood or stone —
and berries/fish are consumables (Q/F heals), never spent on anything. The whole economy is the
`YIELD` table in the constants banner of [js/core.js](../../js/core.js) - the one tuning table
with no single owner - which gives every source a different **yield profile**
rather than a different resource (the League model: one number, many ways to earn it):

| Source | Pays | Profile |
| --- | --- | --- |
| tree (4 hp) | `treeHit` 1 per swing + `treeFall` 1 → 5 | slow, safe, everywhere; leaves a stump, and 1 in 25 leaves a tier-0 [find](#where-tools-and-bits-come-from) |
| dead tree (3 hp) | `deadTreeHit` 1 per swing + `deadTreeFall` 2 → 5 | a tree in fewer swings, but only at a rookery |
| rare tree (8%) | + `treeRare` 6 → 11 | jackpot roll, see `treeRare()` |
| rock (5 hp) | `rockHit` 1 per swing + `rockBreak` 4 → 9 | a bit more than a tree, back-loaded, and 1 in 5 hides a tier-0 tool or bit |
| rabbit | `rabbit` 2 coins × 5 → 10 (+1 berry) | bolts when approached |
| deer | `deer` 3 coins × 6 → 18 | the big mobile target |
| wolf | `wolf` 3 coins × 8 → 24 | the biggest kill, and it bites back |
| bird | `bird` 2 coins × 4 → 8 | tiny, airborne, nine per rookery |
| generator | `tiers[tier].pay` (1/2/4) every `period` s | passive income, deposited to its owner |
| chest | `CHEST_GOLD_MIN`–`MAX` (8–20) + a card, and 3 in 4 a **top-tier** tool or bit | ~14 caches along the treeline, one free E press — the only source of the best weapons |

**Gold is never a physical drop.** Every source pays the earner on the spot through
`awardGold(p, n, x, y)` (`players` banner, js/player.js, beside `gainGold` — which it wraps, so
every payout is also XP, see [Hero levels](multiplayer.md#hero-levels)): the `+N` floater rises
at the place the action happened (the tree, the kill, the wreck), and the local earner gets the
coin blip. Who earns is always the actor: the swinger of the blow, the final-blow shooter of an
animal or a loaded worker bot (its `b.carry` goes to whoever downed it), the breaker of an enemy
building (the 50% wreck refund, same as a demolishing owner's), the killer of a player (the
victim's whole wallet — an uncredited death takes its gold down with the body), and a
generator's **owner**, into whose wallet each `pay` tick deposits directly. Robots still carry a
single gold number (`b.carry`) and deposit at 8+ into their owner's wallet.

**Treasure chests** are the free-money exception to earning it: `placeChests()`
([world.md](world.md#treasure-chests)) swaps ~14 inner-edge border trees for chests, and one E
press (`OPEN`, no tool gate) springs one — `CHEST_GOLD_MIN`–`CHEST_GOLD_MAX` gold straight to
the purse plus one unopened card drop rolled from `CHEST_ODDS` (rarity odds beside the other
chest constants in js/world.js). The chest's tile opens with it.

Physical drops still exist for everything **carried**: `spawnDrop(x, y, type, n)` takes the
value of the drop (`d.n`, default 1) and the pickup adds what fits through `bagAdd`, floating
that number in `RES_COLORS[type]`. **Whatever was taken comes off `d.n`, and the drop is only
removed when `d.n` hits zero** — that is what lets a stack of 5 berries half-fill a bag and
leave 3 lying in the snow. A drop's `type` is always an `ITEMS` key now: sources pay `berry` and
the card rarities, a caught fish goes straight into the bag (speared, or handed over by a
[fish net](world.md#fish-nets) you are standing on), and death spills — and a wrecked net's
contents — carry `fish` too (`SPRITES.itemFish` in the drop draw pass). Gold, berries and fish all read on
the **strip along the bottom of the backpack frame** (bottom right) — food from the left as icon
+ count, gold right-aligned; the food totals the whole bag across its stacks. Death empties
wallet and bag both —
see [Death is final](#death-is-final). Drops are neutral: they drift
toward the nearest player, and everyone standing on one contests it
(`canAfford`/`pay` also take the player whose wallet is meant) — except that a player with **no
room** for a drop is neither magnetised by it nor a claimant, so a full bag hands the pickup to
whoever else is standing there instead of sitting on it, and standing alone on something you
cannot carry fires the [refusal tell](#inventory-and-the-backpack) rather than eating it.

## Inventory and the backpack

Everything a slot carries is in **`p.bag`**: a fixed array of `p.bagCap` cells, each one `null`
or a `{ type, n }` stack of at most `ITEMS[type].stack`. Everyone starts with **one bag of 25**
(`BAG_CAP`, five rows of `BAG_COLS`); a second bag is a bigger `bagCap` and a longer array,
nothing else. The table:

| Item | Icon | Stack | Used by |
| --- | --- | --- | --- |
| `berry` | `itemBerry` | 3 | Q, or clicking its cell — eats it |
| `fish` | `itemFish` | 2 | F, or clicking its cell — eats it |
| `cardWhite`/`cardGreen`/`cardBlue`/`cardPurple`/`cardGold` | `itemCard<Rarity>` | 5 each | clicking its cell — opens the pick-1-of-3 draft (see [Roguelike cards](#roguelike-cards)) instead of eating |
| `tool:<id>` | `toolArt_<shape>_<tier>` | 1 | dragged onto one of the four weapon slots (see [Tools and bits](#tools-and-bits)) |
| `bit:<id>` | `bitArt_<id>` | 4 each | dragged into a cell of a tool's bit column |

An unopened card is a completely ordinary `ITEMS` entry — one per rarity, since a stack has to be
homogeneous and a white card and a gold card are not interchangeable — which is what makes bag
storage, the drop pickup, the refusal flash and death-spill (see
[Death is final](#death-is-final)) all free for it, same as any other carried item. Tools and bits
register their rows the same way, from [js/tools.js](../../js/tools.js), under namespaced keys so
a kind can never collide with a berry.

A tool is the **one instanced** item: its cell carries the bits loaded into it, so it stacks to 1
and moves as a whole object (`bagPut(p, cell)`, and `spawnDrop`'s `it` payload) rather than being
rebuilt from `s.type`. `bagAdd` cannot make one and must not be asked to — the drop pickup
branches on `d.it` for exactly this reason. Everything else in the bag is stateless.

**The slot is the unit of capacity**, which is the whole reason this is an array and not a pair of
counters: two half stacks cost two cells, so a bag genuinely fills and the pickup path can
genuinely refuse. Six helpers in the `players` banner are the entire API — `bagCount(p, type)`,
`bagUsed(p)`, `bagRoom(p, type)` (room in partial stacks + a full stack per empty cell),
`bagAdd(p, type, n)` (tops up partial stacks before opening a cell, returns how many went in),
`bagTake(p, type, n)` (spends from the **last** stack backwards, so partials empty and free their
cell) and `bagPut(p, cell)` (an instanced cell into the first free slot, or false). Nothing outside
them touches `p.bag` — `eatBerry`/`eatFish`, the fish catch, the drop pickup, the AI's food check
and `spillInventory` all go through the six. The one deliberate exception is the **drag**
([UI banner](../../js/ui.js)), which is moving cells between wells rather than storing items, and
owns `p.bag[i]` directly for exactly the length of one gesture.

**Refusing is a real outcome**, and every path that cannot store something says so the same way:
`bagDenied()` reddens and shakes the whole backpack frame for 0.6 s with one `SFX.deny()`, and re-firing while
it is already up does nothing, so standing on a drop you cannot carry is one flash and not sixty a
second. A bow-fishing press with a full bag denies **and returns** (the tool still cycles) rather
than falling through and firing at the floor.

The HUD is in the `UI` › `backpack` banner — see
[the backpack](rendering.md#the-gear-row-and-the-backpack).

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
(every boot builds fresh `Player`s). The human picks variants in the **gear pop-up** — opened
from class select's collapsed gear widget, all 12 variants at once as 32×32 icon wells beside a
live preview and a real-number stat ledger with hover deltas (League runes-style; see
[Main menu](rendering.md#main-menu-title)); `pickGear()` writes straight to `player.gear`. AI
slots hash all four variants from the seed in `initPlayers()`. **Every variant has its own
icons**: the 12×12 material-swapped `SPRITES.gearIcons[slot][variant][material]` the HUD and
the select screen's plaque wear, and the detailed 32×32 `GEAR32` set the pop-up's wells wear —
a pick is a distinct picture, not a label.

**Worn gear shows on the sprite**: each piece at level 2+ lays a 1 px band of its material across
the shared 16×16 body plan — hat, coat, hips, one mark per foot (`GEAR_MARKS`/`drawGearMarks`,
called from `drawPlayer` under the held tool; skipped while rolling, in a hole, or in title). The
free level-1 pick draws nothing, so the baseline look stays the class's; a fed player reads
iron → steel → gold at a glance, the same materials the HUD plates wear.

**Mechanism**: a variant's `mod(k, L)` writes its bonus into the slot's *effective kit* —
`refreshKit(p)` copies the class kit, adds the gear-only defaults (`huntMul`, `dr`, `foodMul`,
`nightHeal`, `walkMul`, `harvest`, `dodgeCd`, `stealth`) and applies the four mods; `kitOf(p)`
returns that cache, so every existing kit read site (movement, `emitBit`, dodge timing, the AI,
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
own wallet. The human sends it by clicking the **gear row**: four 18 px cells — **cells 1–4 of the
backpack's top row**, bottom right (`gearRects`/`gearHit`/`drawGearCells`, UI banner), one per
piece head-to-toe after the pack button. There is no keyboard shortcut for it any more: keys 1-4
select a weapon slot ([Tools and bits](#tools-and-bits)), and gear is bought where gear is.
A plate shows **your variant's own icon** in the **material of its level** (leather → iron →
steel → gold), pips **above** the icon count the buys, an affordable piece grows a bobbing gold
chevron over the plate, hover lifts the plate and shows the cost (coin + number, nothing else),
and a maxed piece goes quiet behind a gold rim. The pips sit on top because that is the edge the
chevron points at — the ask and the progress it asks about read as one column. There is **no
saving meter**: the 1 px bar that used to creep along under each plate was four bars all filling
off the same purse, so it said "you have gold" four times and never said which buy mattered; the
chevron already answers that, on the piece it applies to, only when the answer is yes.
`gearHit` is shared by the click handler, `cursorInfo` (hand cursor) and the row's hover, so they
can never disagree, and it is asked **before** `bagHit` everywhere because `bagHit` deliberately
does not report the four gear cells. The click is swallowed **before** `clickAction` — the
backpack widget, the hud strip (the weapon well, and an ability well casting on the press) and a
raised bit column are the left-clickable HUD in play.
Living in that widget is also what
keeps the chevrons legible: see
[the backpack](rendering.md#the-backpack-and-gear-widget) for why the icon row sits on top. Bots buy in `updateAI`'s spend step: cheapest piece first, keeping a 15-gold
float so they still build.

## Roguelike cards

A permanent buff picked from a team's [Keep](#base-building), one at a time, one draft at a time.
`CARDS` is `{ white: [...], green: [...], blue: [...], purple: [...], gold: [...] }`
(`CARD_RARITIES`, White → Gold rising in rarity and magnitude), each entry `{ name, blurb, mod(k) }` —
the exact shape a `GEAR` variant's `mod(k, L)` is, minus the level argument, since a card is a
one-shot pick rather than a leveled buy. Every effect stays inside `kitOf`'s existing field
vocabulary (`dmgBase`, `dr`, `maxHp`, `walkMul`, `stealth`, `ambushMul`, `iceMax`, …) except one
genuinely new field, `killHeal` — a flat heal on a confirmed kill, hooked at `die()`'s existing
kill-credit line the same way `eatBerry` applies its heal.

**The draft**: clicking an unopened card's bag cell (`bagClick`, instead of the eat branch berry/fish
take) calls `openDraft(rarity)`, which sets `state.draft = { rarity, options }` — three distinct
entries drawn at random from `CARDS[rarity]` (`pick3Distinct`). `renderDraft`/`draftLayout`/
`draftHit` draw and hit-test three cards centred on screen, but as an in-match overlay like
the bag or the map — **it does not pause the sim**, same as every other HUD overlay here, so a
draft is read at real risk, not in a safe pause. `draftClick()` (the mousedown handler routes to it
first, ahead of the wheel/settings/map/bag, whenever `state.draft` is set) either applies the
clicked card — `bagTake` the one card, push `{ rarity, id }` onto `p.cards`, `refreshKit(p)` — or,
for a click anywhere else (or ESC), just closes the draft; either way the click never reaches the
world underneath. `refreshKit` folds every entry in `p.cards` in after gear and skill, cumulatively
(`for (const c of p.cards) CARDS[c.rarity][c.id].mod(k);`), so picking the same effect twice stacks
it, and every existing kit-reading site in the sim — movement, `emitBit`, dodge timing, the AI,
`seenAt`'s stealth — picks a card up for free, the same way it already does for gear. `p.cards` is
set once in the `Player` constructor and never touched by `reset()`, so a build survives every
respawn within a match.

**Bots never see the draft** — `bagClick` is a mouse-only entry point `updateAI` never calls.
Instead, the instant a bot is carrying any unopened card, `resolveCardForBot(p)` resolves it
server-side with one random pick from that rarity's pool — no 3-option UI, since choosing among
three is specifically the human decision point.

## Base building

Right-clicking a **stump** within 60 px opens a radial **build wheel** anchored at the stump's
screen position (clamped to stay on-screen), five even wedges now: wall, turret, generator, bot
bay (`STRUCT_ORDER`, type `spawner`), Keep (`STRUCT_ORDER`, type `keep`) — `wheelSpan(n)`/
`wheelAng(i, n)` re-derive n even wedges from `STRUCT_ORDER.length` alone, so a 5th entry needed no
layout code, only the option itself; push out of the hub and release over a wedge to build,
release inside the hub to cancel.

**The site picks the menu.** `buildSiteAt(tx, ty)` answers `'land'` for a stump, `'water'` for a
bare open ice hole, and `null` otherwise — and the input handler, the cursor's hammer, the
selection brackets and `wheelOptions()` all ask that one function, so none of them can offer a site
another refuses. A water site lists `WATER_STRUCT_ORDER`, which is just the
[fish net](world.md#fish-nets); nothing is special-cased for a single option, because
`wheelSpan(1)` is the whole circle and the hub still cancels.

Right-clicking a **finished** structure (any tile of it) opens a
**manage wheel**: upgrade straight up, demolish last, and — unlike the build wheel — this list
*isn't* generic over `STRUCT_ORDER` (`wheelOptions()` hand-builds it): a Keep gets `craft`
(QUEUE CARD, see below) between the two. The bay used to get a gather/guard toggle here; that is
gone — its crew is commanded by the [worker flag](#worker-flags). This wheel is the **only** way to
build — there are no free-placed buildables. All the data lives in the `STRUCTS` table: three
tiers for wall/turret/generator/**keep** (the wood → stone → gold *look* is just the sprite
palette) and **one each for the bay and the net**, each with a gold `cost`, `hp`, `buildT`, and
per-type stats. A `water: true` entry (only the net) goes on a hole instead of a stump, and that
flag — never the type name — is what `placeStruct`, `isSolidTile` and the dawn refreeze each read;
see [Fish nets](world.md#fish-nets).
`tiers[0]` is what the wheel builds; upgrading pays the next tier's cost and re-runs a shorter
construction, and the last tier (`tiers.length - 1`) reports MAX TIER. Building and [gear](#gear)
are the two gold sinks (a Keep's card craft is a third, gated behind building one first).

Mechanics (the wheel in [ui.js](../../js/ui.js), the buildings in [structures.js](../../js/structures.js)):

- `state.wheel` (`{kind:'build'|'manage'|'rack', tx, ty, seg, ax, ay}`) is the open wheel — `'rack'`
  is the practice armory, opened by holding **E** at the rack and resolved on its release
  ([world.md](world.md#the-practice-arena)); ESC/M/settings/death
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
  **Generator**: deposits `tiers[tier].pay` gold every `period` seconds straight into its
  **owner's** wallet (`awardGold` — the `+N` floater rises at the generator, but there is
  nothing to collect and no pile to cap). **Bot bay** (`spawner`):
  keeps `tiers[0].bots` (3) robots alive, rolling them out **one at a time** — the first 1 s after
  completion, then 4 s apart; a lost bot takes 12 s to replace (`respawnT`/`respawnTotal`).
  `makeRobot` spawns at `structMouth()` (the ring around the footprint if that is blocked) with an
  exhaust puff. `drawBayOverlay()` draws everything live on top of the baked sprite: the next bot
  sliding down the doorway over the last 0.8 s of its timer; a roll-up **shutter** over the doorway
  (`o.door`, lerped in the tick — open while any of its workers is out of the yard or one is
  rolling out, shut when the whole crew is home, so the door reports the bay's state rather than
  a mode nobody sets any more);
  three **bot pips** on the right flank (lit = alive, blinking = being built, dark = empty) with the
  roll-out timer as a bar under them; a flickering slat across each vent grille; a roof **beacon**
  that blinks amber while a bot is due; and an hp bar over the roof once damaged. `removeStruct()`
  clears the whole footprint and kills its robots with it.
- **Buildings take damage from E, but only from the other team.** `hitObject()`'s structure
  branch deals `STRUCT_HIT_DMG` (10) a swing, at the `swingCd` of 0.34 s — so ~2 s for a tier-1
  wall (60 hp), ~10 s for a tier-3 one (300 hp), ~7.5 s for the bay (220 hp). It flashes and
  shakes the building like any other struck object, floats the damage, and shakes the camera for
  the local player. Damage is **contested** with everything else E does, since it runs inside
  `swingHit`'s `contest('work:' + idx)`. At 0 hp it calls `destroyStructure(o, true, p)` — the
  wreck pays out exactly like a demolition, straight to the wrecker — and
  logs `<NAME> WRECKED A <TYPE>` to the event feed. Nothing else damages a building: arrows die
  on solid tiles without hurting them, and no AI or wildlife targets one.
- Demolish refunds **50% of the cumulative cost across tiers** (`cumulativeCost`), paid to the
  demolisher on the spot through `awardGold` — 23 gold for a fully-upgraded wall. `demolishStruct()` →
  `destroyStructure(o, true, p)` is the live path for that, reached from `runCmd` for the wheel's
  demolish order. `canAfford`/`pay`/`costText` are generic over every `inv` key. Demolishing (or
  losing) a Keep is **not** specially guarded beyond that — no confirmation dialog exists anywhere
  in this game — so stripping a team's only way back is a real, deliberate stake, not a bug.
- **Every damaged building wears an hp bar** (`drawHealthBar`, centred on the sprite, `sy - 5`),
  drawn only once `hp < maxHp` so an untouched base stays clean — and never while `building`, when
  hp is climbing rather than falling. The bot bay is excluded: `drawBayOverlay` draws its own at
  `sy - 11`. Below 60% hp a building also picks up four crack marks placed as fractions of its
  sprite, so damage reads without the bar.
- **The Keep** (`STRUCTS.keep`, 2×2, the `bigBuildReveal` construction path): `teamHasLivingKeep(team)`
  is the one-per-team gate (a Keep still `building` doesn't count — same reason an unfinished
  generator doesn't pay out yet), checked both at the build order and again inside its
  [contested](multiplayer.md#contested-orders) callback so two teammates ordering one on different
  stumps in the same tick can't both land one. A finished Keep's manage-wheel `craft` order
  (`startCraft`) pays `tiers[tier].craftCost` and starts `o.craftT`/`o.craftTotal`, ticked in
  `updateStructures`'s per-type dispatch exactly like a generator's `payT` countdown — it freezes
  for free while the Keep is mid-upgrade (the whole per-type branch is skipped then) and forfeits
  outright if the Keep is destroyed mid-craft, no refund, the same as a turret's charge or a
  spawner's mid-roll bot. On completion it rolls a rarity against `tiers[tier].odds`
  (`rollCardRarity`, the shared runtime `rng()` — never `genWorld`'s stream) and `spawnDrop`s the
  matching card at `structMouth()` as a neutral pickup. Odds shift toward the
  rare end at each tier (roughly White-heavy at tier 0 to a real shot at Gold by tier 2) — see the
  `STRUCTS.keep` table for the exact weights. The same over-the-roof progress bar construction
  already draws also covers a finished Keep's `craftT` countdown, in an icy blue instead of
  construction's gold so the two read as different things. What the Keep does for **respawns and
  the win condition** lives in [multiplayer.md](multiplayer.md#the-keep); what a dropped card
  *does* once picked up lives in [Roguelike cards](#roguelike-cards).
- None of the five structures emits light (see [Lighting](rendering.md#lighting)).

## Robots

`robots` holds the bay-owned worker bots (one 12×10 faceless tread-bot grid in team colour, two
tread frames — see [sprites.md](sprites.md)). `updateRobot()` mirrors the animal state machine plus
jobs. **What job it runs is decided by the [worker flag](#worker-flags) of the player who owns its
bay** (`flagOf(b)`); with no flag it falls back to the original bay-centred gather: pick the
nearest tree/rock within 8 tiles of the bay's mouth (`structMouth`, also where they deposit)
(`nearestObj`, the predicate generalisation of `nearestBerryBush`), work it in 0.9 s ticks into a
`carry` gold count (same `YIELD` numbers as `hitObject`, tree-fall leaves a stump and pays the
jackpot — banked in the carry rather than paid on the spot), and walk home to deposit into their
owner's `inv.gold` with a floater at 8+ carried. A worker's `harvest()` handles **deadTree** too (rookery perches: quicker,
`YIELD.deadTree*`, and felling one calls `flushBirds`), because a flag can be planted on one.
Robots drive on `navStep` ([Pathfinding](#pathfinding): reach 1 to a tree, rock or building,
reach 0 to a body or home) and are solid to players and animals (see
[Unit collisions](#unit-collisions)); a target
with no route, or one they get pinned on the way to, goes on `b.avoid` for 12 s. They die with
their bay and are reaped like animals. They inherit their bay's `team`/`owner`, join the y-sorted draws via
`drawRobot()` in team colours (the whole sprite bobs while driving, the tool swings at a target,
carried gold shows as a nugget up front), and show a health bar. Their SFX are gated on player proximity
(`nearPlayer`) so a remote base doesn't spam audio.

**A worker can now fight.** One axe swing, `ROBOT_DMG` (5) every `ROBOT_ATK_CD` (1.1 s) at
anything inside `ROBOT_REACH` (15 px) — deliberately flat, with nothing scaling it yet; that is
the balance pass. `robotStrike(b, e, pt)` is the single blow: a building goes through
`hurtStruct` (the same path a player's E swing takes, so the wreck, the rubble payout and the
`WRECKED A` line are one code path), a slot through `damagePlayer` with `cause: 'worker'`, a rival
worker through `hurtRobot` — all credited to `players[b.owner]`, so a worker kill pays the bounty
and levels its owner like any other. `cause` doubles as the feed's **verb** (`KILL_VERB`), so a
worker kill reads `YOU CUT DOWN <NAME>` instead of `SHOT`. Targets come from
`robotFoeUnit(b, range)` (nearest enemy slot or worker; slots are noticed through `seenAt`, so a
buried body is as invisible to a worker as to a wolf) and `enemyStructNear(team, x, y, r)`.
`foePoint(e, fx, fy)` is where the axe lands: a body a little above its feet, or **the nearest
point on a building's footprint** — the bay is 3×2 and a worker measuring to its centre could
never reach past the wall it is standing against. The same swing animation `drawRobot()` already
had draws it, off `b.atkAim` and `b.atkCd` instead of `b.tgt` and `b.workT`.

A worker is **shootable**: `robotHit(b, x, y)` is its hitbox (radius 7 about `b.y - 1`, the middle
of a body whose treads sit at `b.y + 4`), and `hurtRobot(b, dmg, nx, ny, src)` is the single entry
point for damage — flash, knockback, a damage floater, a scrap-and-sparks burst, `SFX.hit`, and
`robotDies` at zero. Only arrows reach it, and only from another team (friendly fire is off, as it
is for players), so a bay's own side drives through its workers safely. `robotDies(b, src)`
**hands whatever the worker was hauling to whoever downed it** (`awardGold` on `b.carry`) — which
is what keeps shooting a loaded worker on its way home worth the arrows — and logs
`<NAME> SCRAPPED A WORKER` to the feed. A downed worker is not a downed slot, so it never touches
the kill count. `updateRobot`'s own `hp <= 0` check routes through the same function (with no
`src`, so the wreck goes unclaimed). Turret bolts ride the arrow pipeline, so a turret's mark
finally dies; a rival's **worker on an attack flag** melees one; nothing else — a player's swing,
wildlife, the AI's target picker — goes after a worker.

`hurtRobot` also sets `b.mad`/`b.madT`/`b.madX`/`b.madY` when the hit came from another team **and
the worker is under a flag**: it fights back for `ROBOT_MAD` (6 s) from where it was standing, and
never follows past `ROBOT_LEASH` (90 px) of that spot. An unflagged worker is the same defenceless
hauler it always was — see [Worker flags](#worker-flags) for why the anger is gated on the flag.

## Worker flags

**One order marker per player, planted with the middle mouse button, that every worker bot that
player owns reads as its standing order.** Two players on one team have one flag each; the crew a
flag commands is `b.owner === p.id`, i.e. everyone out of the bays that player built. The whole
system is the `worker flags` banner in [robots.js](../../js/robots.js), plus the dispatch
at the tail of `updateRobot()`.

**What the flag is standing on IS the order.** There is no menu and no mode. `flagResolve(p, tx, ty)`
is the one function that decides, and both the cursor preview and `plantFlag` read it, so what the
pointer promises is what the crew does:

| under the flag | job | what the crew does |
| --- | --- | --- |
| a unit on another team | `hunt` | chase *that* unit anywhere and kill it |
| a building on another team | `siege` | break it, then the nearest enemy building within `FLAG_SIEGE_R` (14 tiles) of the flag |
| your own building | `guard` | ring up on its `structMouth` and hold; swing at any foe inside `ROBOT_AGGRO` (70 px) without leaving the post |
| a tree, dead tree or rock | `harvest` | cut that spot, then spread outward over `FLAG_HARVEST_R` (7 tiles) |
| open ground within `FLAG_BASE_R` (9 tiles) of an enemy building | `march` | route there fighting hostile *units* met on the way, then hold |
| open ground anywhere else | `path` | clear a straight lane to it from the bay's mouth, chopping and mining what is in the way |

Only `job` (and a hunt's `unit`) is stored on `p.flag = { tx, ty, job, unit }`. Everything else is
re-read off the tile as it is needed, which is what makes the jobs *survive their own success*:
felling the tree a harvest flag stands on spreads the crew outward instead of stranding it, and
wrecking the building a siege flag stands on rolls them straight on to the next one. A hunt whose
mark dies falls back to holding the flag's ground.

- **`path`** builds its lane with `flagCorridor(from, tx, ty)` — the straight line from
  `structMouth(b.home)` out to the flag, `FLAG_PATH_W` (1) tiles either side of it, walked
  **outward** so a crew clears from the door forward rather than from the far end back.
  `flagPathTarget` hands each worker the first obstacle in it no sibling has already claimed
  (`objTaken`), so they fan out along the lane instead of stacking on one trunk. Once the lane is
  open they fall through to harvesting around the far end.
- **Only the three attack jobs chase** (`FLAG_ATTACK`). On every other flag a worker swings back
  at whoever hit it and no further ([Robots](#robots), `b.mad`). **Moving the flag home is the
  retreat** — there is no separate order for it.
- **The middle button is press-and-HOLD, not a click.** The press raises the preview
  (`state.flagAim`), the release plants where the pointer ended up — the build wheel's grammar one
  button over. It is a *gesture and not a mode* on purpose: everything else in this game that
  previews, previews something you are already doing (the aim line needs a drawn bow, the wheel a
  held right-click), and an always-on hover ghost for an order you have not started is clutter
  that also fights `drawSelection` for the same tile. **Nothing about the flag is on screen unless
  `state.flagAim` is true.** Escape or losing window focus drops it — the press has no hub to
  release into, so those two are the cancel. The press is refused outright when `hasWorkers(p)` is
  false (a live worker, or a bay about to roll one out): with nobody to order, the button is dead.
- The gesture **plants, moves and picks up**: releasing on the flag's own tile lifts it, and a
  lifted flag hands the crew back to the bay, which is exactly the behaviour that existed before
  flags did. Releasing over the HUD is "thought better of it". `flagRecall(p)` clears every
  commanded worker's target and route the frame an order lands, so the crew is *visibly* seen to
  turn.
- It works **over the chart (M) too**, through `mapTileAt(sx, sy)` — the only way to command a tile
  that is off-screen. At `MAP_S` (192/232 px per tile) one chart pixel is ~1.2 tiles, so a map
  order is ±1 tile: fine for "march on that base", not for picking one tree.
- Because the flag has **no resting affordance by design**, one `state.hints.flag` message fires
  the first time a worker rolls out of *your* bay — the same one-shot nudge the first felled tree
  gives for stumps, and the only place the flag is ever spelled out in words.
- The order is per-player state, not a world resource, so it does **not** go through `contest()`.
  AI slots never plant one, which is why a bot's bay still gathers exactly as it always did.

**What it looks like** (the `what a flag looks like` group in [draw-world.js](../../js/draw-world.js)
draws all three; `FLAG_JOBS`, in robots.js, holds the 7×7 icon grids as landmark-style rect lists):

- **The preview**, up only while the press is held, in two halves because they live in two spaces.
  Both read `flagTarget()`, which resolves the tile once and returns `null` for every reason
  nothing should be drawn (no `flagAim`, an overlay up, the pointer over the HUD).
  `drawFlagAim(ox, oy)` marks the target tile in the **world** pass, right beside `drawSelection` —
  the same four 3 px corner brackets over the same offset dark rim, so it scales with the tile and
  speaks the language the E bracket already speaks. It does **not** pulse: the E bracket breathes
  to catch an eye that isn't looking, and this one is only on screen because a hand is holding it
  there. `drawFlagCursor()` rides the pointer in the **UI** pass at a fixed size, carrying the
  job's icon — or the flag itself, when the release would lift it.
- **Two colours, and they carry the stakes, not the job** (`FLAG_MINE` / `FLAG_FOE`): anything
  pointed at your own side is the game's standard bright ink, the three that point at another team
  are the danger red. The *icon* says which job it is; amber and green are already spoken for
  (affordable / interactable, and good) and a work order is neither. `FLAG_MINE` is `#f4f7ff` and
  not a softer slate for a reason — this world is snow, and anything near it disappears into the
  ground; it reads for the same reason `drawSelection`'s white brackets do.
- **The planted flag**, `drawFlag()`, y-sorted into the world draws half a pixel behind its own
  tile so a flag on a tree isn't swallowed by the canopy: a pole with a **dark banner carrying the
  same job icon inked in the team's colour**. Dark cloth and a bright glyph, not the reverse — at
  nine pixels square a solid colour with a hole punched in it is a blob, and the glyph is the
  message. Only your own side's flags are drawn (an order marker is not intelligence to hand a
  rival), on all three surfaces.
- **Both maps**, through the shared `drawFlagPennant()`: a pole-and-pennant in the team's colour on
  the minimap disc, and the same pennant with the job icon over it on the chart. The chart's
  *hover* preview is gated on `state.flagAim` exactly like the world's — the planted pennants are
  always drawn, the preview never is.

## Death is final

...unless your team's [Keep](multiplayer.md#the-keep) is still standing **and its eagle still
roosts** (`teamEagleDown`, the eagle-drop banner in js/boot.js — a driven-off objective makes
every death on that side permanent), in which case it's a flat respawn timer instead. `die(p, src, cause)` marks that slot dead and drops its bow draw and
momentum either way. **Death empties the wallet** (`spillInventory(p, killer)`, right beside
`die`): a credited killer pockets the victim's gold outright through `awardGold` — so a kill levels
the killer, which is the bounty that makes taking the fight worth it — while an uncredited death
(ice, wolves, or the killer already dead) takes its gold down with the body, because gold is never
a physical drop. Any other `inv` key would spill as pickups split into up to 3 drops. **The
backpack empties too**, one drop per stack — a stack is already the unit the bag counts in, so a
killer whose own bag is full simply leaves them lying; this is also, for free, how an **unopened
roguelike card drops on death** (see [Roguelike cards](#roguelike-cards)) — a picked card is
already baked into the kit, not an item, so only what's still sitting unopened in the bag spills.
**And the four weapon slots empty with it**, each tool going down *loaded*: a build lies where its
owner fell, for whoever walks over it, and `reset()` hands the dead slot its class's starting
loadout back — so a respawn is armed but is not the player it was. (An item riding the cursor
mid-drag goes back in the bag first, so it spills with the rest instead of vanishing with the hand
holding it.) All three loops are generic per type, so a future resource spills without touching
death code, and an instanced tool travels as the same object it always was
(`spawnDrop`'s `it`). The standings are unaffected because `scoreOf` ranks lifetime
`xp`, not the purse, so a looted slot keeps the place it earned. `die` also credits the kill (and
heals the killer if their kit carries `killHeal`, off a card) and writes the feed line — see
[Kills and the event feed](multiplayer.md#kills-and-the-event-feed) — then checks
`teamHasLivingKeep(p.team)` and `teamEagleDown(p.team)`: with a Keep and a living eagle,
`p.respawnT` starts counting down (`updateRespawns`, see [The Keep](multiplayer.md#the-keep) for
the whole respawn path); otherwise `p.eliminated = true`, the permanent path. Either way `checkLastStanding()` asks whether every **rival team**
is now gone, which ends the match as a win — full detail in
[The Keep](multiplayer.md#the-keep), since that's now a team-level, not a per-player, question.

Either way the local slot's overlay goes up through `endMatch('lost' | 'won' | 'respawning')` (the
`death & spectate` banner): `state.mode = 'dead'`, every local overlay closed, and the screen goes
to a dim with two planks — **SPECTATE** and **LOBBY** for `'lost'` (permanent) and `'respawning'`
(temporary — the second plank line reads a live countdown instead of "OUT OF THE MATCH", see
`renderDead`) alike — or to [the victory screen](rendering.md#the-end-screens), whose planks are
**KEEP PLAYING** and **LOBBY**, for `'won'`. **LOBBY** on a `'lost'` dim does not leave: it opens
[the defeat screen](rendering.md#the-end-screens), the loss's own summary, and that screen's single
plank is the door out — a lost match ends when you stop watching it, not the instant you go down.
A `'respawning'` LOBBY still leaves directly, and `'respawning'` needs no state of its own beyond
that: once `p.respawnT` hits 0, `respawnPlayer(p)` snaps `state.mode` back to `'play'` the same
one-line way `'KEEP PLAYING'` already does, lands the local slot near its Keep, and replays the HUD
slide-in a fresh eagle landing gets. A win *or* an elimination also freezes what its screen will
print (`endSnapshot()` on `state.end`: gold, kills, level, clock, team, class, the kit, and the
placing and killer only the loss prints) because the match keeps running underneath and a total
that climbs behind a tally which already counted it reads as a bug — and because a loss's summary
is opened off a plank minutes later, by which time none of those numbers are still true. Spectating
sets `state.spec` to a living rival's id and `viewPlayer()` — the one place the camera and minimap
ask who to frame — returns it. The control is
a top-centre `[<] NAME [>]` strip (`specLayout`/`specHit`, sized to the widest slot name so the
arrows never shift): clicking an arrow or pressing the arrow keys cycles (`specNext`, slot order,
skipping the dead), ESC returns to the planks, and a watched slot that dies hands the view to the
next. There is deliberately no hint text — the arrows are the whole explanation (CLAUDE.md's
"show, don't label" rule); with nobody left the plate shows a dash instead of a name. LOBBY (`toLobby`) fades to dark and reloads
the page on the same seed, which boots into the title screen. **TAB still opens the standings
while you are out**, which is the point of holding them above the dim.
`state.mode` is `title | drop | play | dead`, and `updatePlay()` runs in `play`, `dead` **and**
`drop` (the clock starts with the eagle; airborne slots are skipped) — the match carries on
without you, and `updateRespawns` ticks a respawn timer down under the `'respawning'` overlay the
same way. Only **pause (P) and the settings panel (ESC)** stop the sim;
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
- Dying with the map open is now possible; `endMatch` clears `state.mapOpen` (and
  `state.bagOpen`), and M only toggles in `play` and `drop` modes (mid-flight it is the ride's
  wide read; `landPlayer` closes it at touchdown), so the chart cannot survive into the death
  overlay.
- The world keeps the zoom you were playing at. The panel is a fixed 308×226 and the canvas no
  longer shrinks when you zoom ([World zoom](rendering.md#world-zoom-and-the-two-pixel-spaces)),
  so it fits regardless and the map no longer yanks the camera back to base.

## Settings

`settings` (`v`, `volume`, `musicVol`, `sfxVol`, `mmR`, `mmZoom`, `shake`, `muted`, `info`, `pixelCursor`, `hitbox`) persists
**under the player profile** — `saveSettings()` is a call to `PROFILE.putSettings()` and
`loadSettings()` reads `PROFILE.settings()`, which returns `null` when this profile has never
saved any. A pre-profile save under the old `localStorage['softfall.settings']` key is folded in
once by `PROFILE.load()` and the key removed; see
[architecture.md](architecture.md#profilejs). `applyMinimapSize()` must be called after changing `mmR` —
it recomputes `MM_R`/`MM_CX`/`MM_CY`. The **backpack**'s open/closed state is `state.bagOpen`,
not a setting: it is per-match HUD, and `endMatch` closes it. (Old saves may still carry `res`, `fps`, `seed` or `paths` keys from removed settings;
`Object.assign` in `loadSettings` copies them harmlessly and nothing reads them.)

There is no fullscreen control in the ESC menu (players use F11); a `fullscreenchange` listener
still refits the canvas when the browser toggles it.

The panel has **seven** rows — MASTER, MUSIC, SOUNDS, MINIMAP SIZE, SCREEN SHAKE, INFO DISPLAY,
CURSOR — at a **14 px pitch** rather than 16, which is what lets the three sound dials fit above
the CONTROLS divider without `SET_H` growing: 218 is already close to the 240-row floor
`fitCanvas()` guarantees, so the slab cannot get taller. `settingsHit()`'s row bands are
`y-3 .. y+10` to match that pitch — 14 px each, touching but never overlapping, so one click can
never land on two rows.

**In [practice](world.md#the-practice-arena) the slab grows one hanger.** A LEAVE PRACTICE frost
plank (`leavePlankRect`, drawn by the title's own `drawMenuButton`) hangs under the panel — the
ESC slab is the arena's only menu, so its exit lives there. `settingsHit()` answers `'leave'`
for it (PRACTICE only) and the click is `leavePractice()` (js/menu.js): the reroll's whiteout
onto a bare URL, landing on a fresh title world.

**Mute is not a row.** It is a 9×9 speaker plate (`muteBtnRect`, `drawMuteBtn`) hard against the
left end of the MASTER track: a cone with two waves coming off it, the waves swapped for a red ×
when it is off. `settingsHit()` tests it *before* the track's x-gate, since it sits left of
`SL_X`. While muted all three sound dials draw grey rather than gold (`drawSliderRow`'s `dim`)
while MINIMAP SIZE stays gold, so what the speaker silences reads off the panel without a word of
text. **N** still toggles the same flag from anywhere.

Below those rows, the baked CONTROLS block lists the hotkeys in two columns of **seven**
(`buildSettingsPanel`) — `CTRL SNEAK` joined the left one and `. HITBOX` the right one, and the
rows start at y 137 rather than 140 so the last still clears `ESC CLOSE`. The title screen's TUTORIAL panel carries the same key
as `CTRL HIDE IN SNOW`.

`settings.info` (one INFO DISPLAY toggle row in the ESC menu, **or F3**, minecraft-style — the
keydown handler flips it in any mode and suppresses the browser's find bar; default off) shows
the **info stack** — `drawTags()`, a vertical list on the left edge at the top quarter of the
view, drawn above every overlay. Four lines — **FPS** (`loop()`
accumulates raw unclamped frame deltas into `perf` and refreshes `perf.fps` every half second),
**SFX**, the sampled sound bank's decoded/asked-for tally (below),
**POS**, the tile coordinates of the slot the camera frames (`viewPlayer()`, so spectators read
the watched slot), and **SEED**, the run seed (see
[world.md](world.md#determinism-and-noise)) — each drawn as a dim label plus a value on one
shared x, so the numbers line up in a column; that dim-label / bright-value pairing is the same
one the berry and fish counters use. **Red on the fps value (below 45) is the only colour in the
stack that means anything** alongside **SFX** (below), and nothing else is tinted, which is what
lets a warning read. In title, FPS and SFX show and the other two do not.

**SFX** is the sampled sound bank: files decoded / files the table asks for, from `SFX.banked()`,
red on anything missing. It earns its place in a three-line stack because an empty bank is *silent
in exactly the way a mis-wired cue is* — every sampled sound falls back to its synth line and the
game sounds untouched — so without it "I hear no new sounds" has three indistinguishable causes.
See [Audio](#audio).

`settings.hitbox` is the same idea one key over: **`.`** toggles it 0 ↔ 2 in any mode. One press
draws the circles and boxes the sim actually tests over the sprites that hide them, *and* the
route every walker is following with the tile it is heading for; the next press turns both off. It
has no ESC-menu row, only the `. HITBOX` line in the CONTROLS block; the rest is in
[Debug overlays](rendering.md#debug-overlays-hitboxes-and-routes).

Beneath the minimap
`renderMinimap()` prints one centred row: a 5×7 pixel figure (`ALIVE_ICON`, no label) with
`aliveCount()` — slots active and not dead, riders included — then the elapsed clock.

## Audio

[js/audio.js](../../js/audio.js) is three layers under one master dial, and `SFX` is all of them.

`ensure()` builds the graph lazily: `master` (the master dial) → destination, and `sfxBus` (the
SOUNDS dial) under it. **Everything synthesised or sampled goes through `sfxBus`**, the wind bed
included — a new voice that connects to `master` directly would ignore the SOUNDS dial. The three
dial setters go through `dial(v, keep)`, which keeps the old value for anything that is not a
finite **number** — note the `typeof` test, since `+null` is `0`, not `NaN`, and a coercing guard
would let a null from a stale save clamp a whole bus to silence. Music runs *outside* this graph,
so a zeroed or broken `sfxBus` is silent while the songs play on, which is a confusing failure to
be handed and worth guarding against. Browsers
require a user gesture, so `SFX.unlock()` is called from click handlers; audio.js also arms its
own `pointerdown`/`mousedown`/`keydown` listeners, which is what actually starts the title track
(see *Music* below).

**The synth** (`tone`/`noise`) is unchanged, and it is now two things: the UI blips in their own
right, and the fallback line under every sampled cue.

**Samples.** `SAMPLES` maps a key to the files behind it in `audio/sfx/`; `loadBank()` decodes all
of them on the first `ensure()`.

**The bytes come from [js/sfxdata.js](../../js/sfxdata.js), not from the network.** That file is
generated — `node tools/bake-sfx.js` writes every clip in `audio/sfx/` into it as base64 — and it exists
because **double-clicking `index.html` has to work**: a `file://` page is allowed neither `fetch`
nor XHR against its own folder, so the whole sample layer fell back to synth when the game was
opened off the disk rather than served, sounding *exactly* as it did before the samples existed.
`bytes(f)` prefers the inline data and falls back to `fetch` for a clip that is in the folder but
not yet baked, so adding one works over http before anyone reruns the script — **rerun it before
committing, or the new sound is dead for anyone opening the file directly.** The music is
deliberately *not* baked: it is ~70 MB, and an `<audio>` element streams a relative `file://` path
perfectly well — it was only ever `fetch` that was blocked. Filenames still go through
`encodeURIComponent` on the fetch path, since several carry a `#` that a raw URL reads as a
fragment. Each decoded buffer is run through `trim()`,
which finds where the sound actually starts and ends inside a clip padded out to a fixed length,
so an axe hit does not fire 200 ms late.

**`trim()` also levels the bank, and that is not cosmetic.** These files arrive at wildly
different levels — measured peaks run from **0.089** (the chewing) to **1.03** (the falling tree),
a 20 dB spread — so each one gets a gain `g` bringing it to `SMP_PEAK`, capped at `SMP_MAXG` so a
near-silent clip is not amplified into hiss. Without it the quiet third of the bank is inaudible
under the music at any sane master setting, *and* no per-cue `vol` can be tuned, because the same
number means something different for every file. With it, `vol` is a pure mix control: every world
cue is aimed at **0.3–0.7 peak on the SOUNDS bus**, measured with `SFX.meter()`, against the synth
UI blips at 0.15–0.18. Peak is taken across **all** channels (the files are stereo) and the
silence threshold is relative to that peak — an absolute one trims the quiet clips' own content
off as if it were padding.

**A failed load must never be quiet about it.** `loadBank()` counts every file into `bankStat`
(`want`/`got`/`err`), logs one console warning naming the first failure, and `SFX.banked()` reads
the tally back — the **info stack prints `SFX got/want`, red when anything is missing**. This is
not decoration: an empty bank falls back to the synth on every cue, so the game sounds *exactly as
it did before the samples existed*, which is indistinguishable by ear from every cue being wired
to the wrong event. Swallowing those rejections cost two rounds of debugging. A bank that came up
empty also gets one retry on the next gesture (`retryBank`), since starting the dev server after
opening the page is the ordinary way this happens.

`smp(key, opts)` plays one, **and returns whether it handled the cue**: false means nothing has
decoded yet (or ever will — `file://`, a missing folder, a codec) and the caller falls through to
its synth line, so the game is never silent waiting on a download. It returns *true* while muted,
so a muted cue never doubles up. Every cue therefore reads
`someCue() { if (smp('key', {...})) return; ...synth... }`. `opts`: `vol`, `rate` + `jitter` (a
fraction of rate, rolled per shot, which is what stops a repeated cue sounding looped), `lp`/`hp`
filter corners, `delay`, `gap` (the minimum seconds between two of this key — insurance against
two events in one frame), and `dur`. **`dur` matters more than it looks:** several of these clips
hold more than one cue — the footstep file is a whole walking loop, the coin rolls for two seconds
— so `dur` takes one hit off the front and rides a release ramp down over its last 40 ms rather
than clicking off mid-waveform. A key with several files picks one at random per shot.

New sampled cues beside the old synth ones: `coin()` (gold into the purse — an `awardGold`
payout, a bot's deposit) and `stash()` (something into the backpack)
split off from `pickup()`, which stays the synth UI blip so menus keep an instant, identical
click; `hammer()` (raising, upgrading or finishing a structure) splits off from `place()` the same
way, with `building()` as its quieter, shorter sibling on a site's dust tick — it repeats for as
long as the build takes, so it is widely jittered and must never settle into a rhythm. `step()` is
one boot per footprint the local slot leaves; `land()` is the same boot dropped an octave under a
low thump, so touching down off the eagle reads as weight rather than as an arrow connecting.
`yelp()` is a creature crying out under a hit it survived, and `monsterDie(kind)` takes the
animal's kind — a wolf yelps where a rabbit squeals.

**Ambience.** `SFX.setAmbience(on, night)` is called every frame from `update()`: on wherever the
world is live, off under the death and end screens where a song already owns the mix. audio.js
schedules a wind gust (or, once `state.darkness > 0.55`, sometimes an owl) every 11–26 s over the
synth wind bed.

**Music.** `SFX.music` streams `audio/music/` through one `HTMLAudioElement` per track — they run
minutes, and decoding them into buffers would cost tens of MB. They sit *outside* the WebAudio
graph, so `musicGain()` multiplies each element's `.volume` by its track volume, the MUSIC dial,
the master dial and mute by hand; a 50 ms `setInterval` walks the fades. `music.play(key, opts)`
crossfades (`in`/`out` seconds, `restart`), is a no-op when that key is already current, and
`music.stop(fade)` fades the whole layer out. `music.current` reads back the key; `music.el(key)`
hands out the live element, which is how a driver proves the handover chain without sitting
through five minutes of a track.

| Track | Plays from | Loops |
| --- | --- | --- |
| `intro` — FROZEN NORTH RUN INTRO | boot, and `leaveSelect()` back to the menu | yes |
| `select` — FROZEN NORTH RUN CLASS SELECTION | `beginSelect()`; the gear pop-up keeps it | yes |
| `eagle` — FLYING ON EAGLE | `beginDrop()` | yes |
| `jump` — JUMPING OFF EAGLE | `dropJump()` for the local slot | no → `foxglove` |
| `foxglove` — FOXGLOVE DROP | the end of `jump`, via `TRACKS.next` | no → silence |
| `victory` — DROP THE ICE | `endMatch('won')` | yes |
| `defeat` — SLEEPY GAME SAVE | `endMatch('lost')` | yes |

The jump is a **hard cut**, not a crossfade (`{ out: 0.1, in: 0.05 }`): the ride's song is
interrupted by the leap. From there the layer runs itself — `jump` reaches its end, its `ended`
handler follows `TRACKS.next` into `foxglove`, and when *that* ends nothing follows it, so the
match plays out in silence until an end screen. `endMatch` is gated on `'won'`/`'lost'`, each with
its own song (`victory` / `defeat`); a `'respawning'` overlay is not the end of anything and must
not start either.
`rerollWorld()` and `toLobby()` fade the layer out under their wipe; both reload the page, so the
title track comes back from boot.

The **title track cannot start on its own** — no gesture has happened at boot. `musicPlay` catches
the rejected `play()` promise into `pending`, and the first click or keypress starts it. This is
why the dev server ([tools/serve.js](../../tools/serve.js)) answers Range requests: served a plain 200, an
`<audio>` element treats a multi-MB mp3 as an unbounded stream (`duration` `Infinity`) and cannot
seek in it.

The bow's rhythm has three of its own: `SFX.nock()` (a dry wooden tick when the renock clears —
deliberately near-silent, since it fires after every shot), `SFX.dryFire()` (a slack string on an
empty quiver) and `SFX.shaftPull()` (retrieving a spent arrow). See
[the quiver](#the-quiver).

[Prone](#prone-under-the-snow) has four: `SFX.bury()` (a body dropping into deep snow — low crunch,
no pitch), `SFX.hidden()` (the cover finishing, barely there on purpose: it is the sound of *not*
being heard, and it plays with a rival somewhere close by), `SFX.rise()` (the snow shed in one
shove) and `SFX.ambush()` (the shot out of the snow landing — deeper and harder than `hit()`, with
a crack over the top, so an ambush never sounds like an ordinary arrow).

`SFX.victory()` (a four-note fanfare over a held low fifth) is the one *synth* cue longer than a
second; `endMatch` fires it the moment the match is won, as the sting the `victory` song comes up
underneath. `SFX.tally()` is the dry blip a climbing number makes on the victory screen — see
[The end screens](rendering.md#the-end-screens) for the rest of that timeline.

