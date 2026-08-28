# The world

The tile grid, worldgen, the seeded RNG contract, the day/night cycle, and the one runtime
ground change (ice holes). Read this before touching `genWorld()`, adding a ground type, or
anything that must stay stable per tile.

## The tile world

- `WORLD = 232` tiles of `TILE = 16` px → a 3712×3712 px world. The forest border keeps its
  original depth (`BORDER_MIN`/`BORDER_MAX` 30–70, avg ~50), so the growth all went into the
  open interior (~132 tiles across, double the old ~92²'s area); interior feature counts
  (ponds, rock clusters, bushes, wildlife) were doubled to hold density. `ringPts` is `RING_N`
  (6) points, evenly spaced on a ring `SPAWN_D` (`WORLD / 2 - 55`) tiles from the centre at
  the treeline — the old spawn camps. Nobody starts there any more (players land from the eagles,
  see [multiplayer.md](multiplayer.md#where-players-start)) and no pocket is carved, but the river
  spokes and the keep-clear rules still hang off them — which is exactly why `RING_N` is frozen at
  six instead of tracking `MAX_PLAYER_SLOTS`: the roster growing to ten must not reshape terrain.
- `ground` — `Uint8Array(WORLD²)`: `0` snow, `1` ice, `2` open-water hole (runtime-only, see
  [Ice holes and fishing](#ice-holes-and-fishing)). Ice is **mechanically slippery** (see
  [Momentum movement](gameplay.md#momentum-movement-players-only)), and worldgen carves it as a travel
  network: 14 frozen lakes plus winding ~5-tile-wide rivers (`carveRiver` in `genWorld()`) —
  a spoke from each ring point to the central clearing and a ring linking each point to its
  neighbour. The shared `carveIce` rule skips existing objects, the ring points, and the clearing,
  so rivers gap naturally around them.
- `objects` — flat `Array(WORLD*WORLD)`, **at most one object per tile**. Every object is
  `{ type, tx, ty, hp, flash, shake, ...extra }`. Types: `tree`, `deadTree`, `stump`, `rock`,
  `bush`, `chest`, `den`, `wall`, `turret`, `generator`, `spawner`, `part`. `deadTree` (a 3 hp snag, chopped like a
  tree for `YIELD.deadTreeHit`/`deadTreeFall`, leaves a stump) and `den` (solid, inert scenery)
  exist only inside [landmarks](#landmarks); `chest` is a
  [treasure chest](#treasure-chests) standing where a border tree stood. `part` is the filler a multi-tile building leaves on
  every footprint tile but its anchor (`{ type: 'part', of: <building> }`): solid, coloured like its
  building on both maps, ignored by work swings, and resolved by `structOf()` for every "what building
  is here" read (right-click, cursor, wheel, orders).
- Index with `idx(tx, ty)`, read safely with `objAt`, create with `placeObj`. Deleting is
  `objects[idx] = null` (structures should go through `destroyStructure` so lights rebuild and
  the `structures` registry stays in sync — it routes tiered types through `removeStruct`).
- `wall`, `turret`, `generator`, `spawner` are the **stump-built structures** (see
  [Base building](gameplay.md#base-building)). Each carries `{ tier, maxHp, building, buildT,
  buildTotal, dustT, sparkT }` plus per-type fields (turret `cd`; generator `payT`; spawner `mode`,
  `bots`, `respawnT`/`respawnTotal`, `door`), and every live one is also referenced from the module-scope `structures`
  array so `updateStructures()` never scans the 53,824-tile grid. (`updatePlay` does: one
  unconditional pass over all of `objects` every step, ticking `flash`/`shake` and bush regrow —
  that loop, not the structure tick, is where a full-grid frame cost actually lives.) The first
  three have three tiers; the spawner
  (the bot bay) has one and a **3×2 footprint** — `STRUCTS.spawner.w/h`, with `footprint()`,
  `structCenter()` and `structMouth()` (the ground point in front of the doorway) as the geometry
  helpers. Stumps are **consumable build anchors**: building on one replaces it (a bay consumes
  every stump under it), and demolition/destruction leaves the tiles empty, not stumps.
- The world center is an empty clearing (the old gold-ore ring is gone); `CENTER_R` in
  `genWorld()` still keeps ice ponds, rocks, and bushes clear of it so the river spokes meet in
  open ground, and the ore loop's two `rand()` draws per spot are kept as no-ops so existing
  seeds still generate the same world.
- Every `tree` carries `rare` (boolean), set at worldgen from `treeRare(tx, ty)`: a `hash2`
  roll gives each tree a `TREE_RARE_CHANCE` (8%) shot at a **jackpot** — `YIELD.treeRare` extra
  gold (straight to the feller through `awardGold`, plus a `JACKPOT!` floater), paid by
  `hitObject()` only when the tree actually falls, on top of the normal payout. Being a position hash rather than an `rng()`
  draw, the roll is the same whenever it is asked — `DBG.treeRare(tx, ty)` reports it for any
  tile, occupied or not.

## Treasure chests

`placeChests()` (the `world` banner, right above the landmarks) runs at boot after
`placeLandmarks()`: it scans for **border trees on the forest's inner edge** (a `tree` with at
least one cardinal neighbour of open snow — reachable with E from open ground) and swaps
`CHEST_COUNT` (14) of them for `chest` objects, at least `CHEST_SPACING` (22) tiles apart.
Selection rolls on its own `mulberry32(SEED ^ 0x43484553)` stream — the `lmRng` pattern — so it
can never perturb the shared `rng` stream and terrain stays bit-identical for an existing seed
(chests place after landmarks and touch only `objects`, never `ground`). A chest is solid, gold
on both maps (its `mm`/`map` entry), and one free E press (`OPEN`, `needs: null`) springs it —
`hitObject`'s chest branch pays `CHEST_GOLD_MIN`–`CHEST_GOLD_MAX` gold on the spot and drops one
card rolled from `CHEST_ODDS` (all four constants beside `placeChests`). The tile empties with
it, leaving a one-tile notch in the treeline where the cache was dug out. The sprite bakes in
[draw-world.js](../../js/draw-world.js) (`CHEST_SPR`, top of the entity draw banner) rather than
in the byte-fragile js/sprites.js.

`renderGround()` pre-renders the *entire* 3712×3712 ground to one offscreen canvas at boot and
the frame loop just blits the camera window out of it. It is a one-time cost — never call it per
frame. The per-tile painter is factored out as `paintGroundTile(g, tx, ty)`, and a runtime
ground change must call `repaintGround(tx, ty)` — it repaints the tile plus its four neighbors
(edge rims depend on neighbors) into the prerendered canvas. Ice holes are currently the only
runtime ground change.

## Landmarks

Named points of interest scattered through the open interior, each with its own personality — the
thing a player is choosing between while the eagle is still in the air. They live in the
`landmarks` banner of [world.js](../../js/world.js) and in the module-scope `landmarks` array
(`{ key, spec, name, tag, tx, ty, r, repopT }` per placed site).

**One entry in `LANDMARKS` is one kind of place**, and that entry plus its generator is the whole
feature — no map, chart or HUD code knows any landmark by name:

| Field | Meaning |
| --- | --- |
| `name` | printed by the minimap (glyph only), the M map and the arrival toast |
| `tag` | the one-line personality under the name on the toast (`THE PACK HUNTS HERE`) |
| `count` | how many worldgen scatters |
| `r` | footprint radius in tiles: the keep-clear ring, the canvas `gen` draws in, and the radius `landmarkAt()` calls "here" |
| `surface` | the ground its site must sit on — `'snow'` or `'ice'` (a shipwreck wants ice) |
| `mark` | map ink for its glyph and its toast rule |
| `icon` | the glyph itself: `[x, y, w, h]` rects inside a 7×7 box, stamped by `drawLandmarkIcon()` with a dark rim pass so it reads on parchment, snow and forest alike |
| `pop` | how many inhabitants the site keeps alive (`a.home === L` is the backref) |
| `repop` | seconds between top-ups; `0` never restocks |
| `gen(L)` | stamps the objects/ground, inside worldgen and **before** `renderGround()` bakes |
| `spawnOne(L)` | adds one inhabitant, after the world (and the ordinary wildlife) is standing |

`LANDMARK_ORDER` is the placement order — the pickiest site first, since each one reserves
`r + other.r + 8` tiles around itself.

### Placement

`placeLandmarks()` runs as worldgen's last pass (boot, right after `genWorld()`), then
`stockLandmarks()` fills every site once `spawnAnimals`/`spawnFish` are done. `landmarkSite()`
rejects a candidate that is on the wrong surface, inside 20 tiles of the world centre, within 12
tiles of a `ringPts` point, too close to a landmark already placed, closer to the treeline than
`borderDepth(tx, ty) + r + 4` (measured, not worst-case — assuming `BORDER_MAX` bunches every
landmark into one narrow ring), or whose footprint is less than 72 % free of the right surface.

**Everything a landmark rolls comes from `lmRng`**, a second `mulberry32` seeded from
`SEED ^ 0x4c414e44` — the same trick `fxRng` uses. Placement, `gen` and `spawnOne` therefore
cannot perturb the shared `rng` stream, so terrain is bit-identical for an existing seed. (The
objects they stamp *do* displace what `spawnAnimals`/`spawnFish` can land on, so a replayed seed
keeps its terrain but not its exact rabbit positions.)

### The two that exist

- **WOLF DEN** (3, r 5) — a `den` mouth ringed by boulders, with a pack of 4 wolves. The only
  hostile thing in the world; see [Wolves](gameplay.md#wolves-the-first-enemy).
- **ROOKERY** (3, r 6) — 6–9 `deadTree` snags and a few rocks, with a flock of 9 birds. No danger
  at all, just the hardest shooting in the game; see [Birds](gameplay.md#birds-the-flock).

### Saved for later

The **abandoned mine**, **frozen fort**, **shipwreck** and **shop** are meant to be table entries
here, not new systems. The format already holds them: `surface: 'ice'` puts a shipwreck out on a
frozen lake, `gen` may write `ground` as well as objects (it runs before the ground bake, so no
`repaintGround` is needed) and may stand up structures through `placeStruct` for a fort,
`pop`/`repop` stock a mine with whatever lives down it, and a site with `pop: 0` and no
`spawnOne` is simply a place made of scenery. What a new landmark *does* cost is any **new object
type** it stamps — that is the checklist in
[checklists.md](checklists.md#common-changes).

### Runtime

`updateLandmarks(dt)` (from `updatePlay`) counts each site's living inhabitants every `repop`
seconds and calls `spawnOne` when it is short — never while any player is within 96 px, so
clearing a den is a real reward for a while and the site still grows back. `landmarkAt(x, y)`
returns the landmark a world position stands in; `updatePlay` feeds it `state.loc`
(`{ L, t }`), which drives the arrival toast in
[rendering.md](rendering.md#landmarks-on-the-maps).

`DBG` exposes `landmarks`, `LANDMARKS`, `landmarkAt`, `stockLandmarks`, `flushBirds` and
`warp(tx, ty, p?)` — warping a slot onto a site is how to stage one.

## The practice arena

The training room behind the title's PRACTICE TOOL plank (three knocks break its ice —
[rendering.md](rendering.md#main-menu-title)): `?practice=1` boots `genPracticeWorld()` (the
`practice arena` banner, js/world.js) **instead of** `genWorld()`, and js/boot.js skips
landmarks, chests, wildlife spawns and the eagle drop entirely — the arena stocks itself. The
room is a **48×27-tile clearing** (`PR_W`/`PR_H`, deliberately 16:9 — the view's own shape)
carved out of a world that is otherwise solid forest, holding one of everything worth
practising on: the **dummy**, an ice pond with `PR_FISH` fish (the shoal trickle caps there
instead of `FISH_MAX`, js/wildlife.js), trees, a snag, rocks, bushes, three rabbits, two stumps
and two chests. `PRACTICE` (js/core.js) pins `SEED` to `PRACTICE_SEED` *above* the `?seed`
parse, so the arena is bit-identical on every visit and no seed can reshape it.

Practice is not a match, and everything with stakes is guarded on `PRACTICE`: the local slot is
the only active one (js/boot.js parks the other nine as `control: 'none'` in the corner
forest), `die()` becomes `practiceRevive()` (full pool, spawn tile `PR_SPAWN`, a beat of
grace), `checkLastStanding()` never fires, and the profile is never written — `gainGold` skips
`PROFILE.addGold` (a free room with chests must not farm tech points) and the dawn skips
`addDay`. The way out is the ESC slab's LEAVE PRACTICE plank
([settings](gameplay.md#settings)).

The **dummy** is an `OBJECTS` entry (`solid`, any tool, verb HIT) with one solid tile and a
26×42 sprite (`DUMMY_SPR`, baked in js/draw-world.js beside the chest). Every way of hurting it
lands in `hitDummy` (js/actions.js): the E swing (`DUMMY_WORK_DMG`), every bit — the arrow loop
tests the dummy across its base tile and the two above it, so torso and head shots land — and
the roll's tackle. It never breaks: the pool floors at zero, the overhead bar appears only
while it is hurt, and `updatePractice` (called from `updatePlay` under `PRACTICE`) mends it
back to `DUMMY_HP` after `DUMMY_RESET_T` seconds unhit, with a shimmer for the announcement.

## Determinism and noise

Every run picks a fresh `SEED` at boot from `Date.now() ^ Math.random()`, and **everything random
derives from it** — there is no other entropy source. `?seed=N` in the URL overrides it, which is
how you replay or diff a specific world (and `?practice=1` overrides *that*: the
[practice arena](#the-practice-arena) pins `SEED` to `PRACTICE_SEED`). `drawTags()` prints `SEED_TXT` as a line of the **info
stack** on the left edge at the top quarter of the view (drawn after the map, settings, and death
overlays), so a screenshot carries the world it came from while `settings.info` is on — the INFO
DISPLAY row in the ESC menu or **F3**, default **off**, so flip it on before comparison captures;
in `title` mode the main menu prints the seed instead, next to the reroll die.

- `rng` is a single `mulberry32(SEED)` stream shared by worldgen *and* runtime effects (particle
  bursts, animal wanders, drop velocities). Worldgen is reproducible only because it runs first at
  boot. **Adding or removing any `rng()` call inside `genWorld()` reshuffles the whole world**;
  adding one after boot does not.
- `hash2(x, y)` mixes `SEED` in, and `vnoise(x, y)` is built on it. Both are still pure functions
  of position *within a run* — use them for anything that must stay stable per tile no matter when
  it is asked (ground texture, forest boundary, tree rare-drops, panel mottling, map dithering).
  `borderDepth()` rides on `vnoise`, so the seed reshapes the forest and with it the whole map.
- Two exceptions to the single stream, both for the same reason — nothing outside worldgen may
  perturb the main `rng`'s worldgen prefix. `fxRng` (`SEED ^ 0x9e3779b9`) feeds resize-driven
  snowflake top-ups in `fitFlakes()`, so window size / resolution changes cannot move the world
  (the boot-time 70 flakes still draw from `rng`, unchanged). `lmRng` (`SEED ^ 0x4c414e44`) feeds
  everything [landmarks](#landmarks) roll, at boot and at runtime.
- `SEED` is a `const` in the rng banner and `hash2` closes over it, so nothing may call `hash2`
  before that line runs. Everything that does — `genWorld`, `renderGround`, the panel bakes — is
  further down in boot order.

## Day/night

`DAY_LEN = 110`, `NIGHT_LEN = 55`, so a full `CYCLE` is 165 s. `state.time` runs within the cycle,
`state.day` increments at wrap. `update()` derives `state.darkness` (0→1) from a hand-written
ramp: dusk over the last 12 s of day, full dark, then a 10 s dawn.

Night is visual pressure (darkness + lighting) plus one real edge: a wolf's sight range scales
with `state.darkness` (×1.75 at full dark), so a den is a different proposition after sunset.
What else keys off the cycle:

- `darkness < 0.3` gates the only passive heal: slow daylight HP regen in `updatePlayer()`, for every slot.
  (There is no cold/warmth system — it was removed along with placeable campfires.)
- Carved ice holes refreeze at dawn and cracks heal — **unless a fish net stands on the hole**,
  which is what holds that water open. The shoal is *not* topped up here any more; it refills
  continuously instead. See [Ice holes and fishing](#ice-holes-and-fishing).

`state.day` no longer drives any difficulty. What damages a player: another player's arrows, a
plunge through the ice (see [PvP](multiplayer.md#pvp)), and the wolves of a
[wolf den](#landmarks).

## Ice holes and fishing

**E over a bare ice tile** (no object) brings out the pickaxe and calls `crackIce(tx, ty)` on
that tile (see [Tools and the bow](gameplay.md#tools-and-the-bow)). Hits accumulate in the
`iceCracks` map (`tile idx → hits`, rendered as bright fracture decals in their own pass);
`ICE_HOLE_HITS` (2) breaks through — the tile becomes `ground = 2` (open water), joins the
`holes` list, and is repainted into the ground canvas via `repaintGround()`. Breaking through for
the first time is the one place the net is spelled out (`state.hints.hole`, the same one-shot
`showMsg` the first stump gets). Constants live in the `fish` banner of
[js/wildlife.js](../../js/wildlife.js) (`ICE_HOLE_HITS`, `HOLE_FALL_DMG`, `HOLE_FALL_T`,
`FISH_MAX`/`FISH_MIN`, `FISH_CATCH_R`; `FISH_SPAWN_T` alone stays in core.js, and the `NET_*` set
sits beside `STRUCTS` in [js/structures.js](../../js/structures.js) with the net entry it tunes).

- **Falling in**: standing over a hole tile (checked at the player's feet in `updatePlay`)
  plunges the player: `HOLE_FALL_DMG` (15) via `damagePlayer`, velocity zeroed, and
  `player.fallT` runs `HOLE_FALL_T` (1.1 s) of floundering — no movement, tools, dodge, or
  slide (`clickAction`, `tryWork`, and `tryDodge` all check `fallT`). `drawPlayer` clips
  the sprite to the waterline with ripple rects. The climb-out teleports to
  `nearestDryTile()` with brief i-frames. An **active dodge roll crosses holes safely**
  (the fall check skips while `dodgeT > 0`). Every player falls in; `die(p)` and `Player.reset()`
  clear `fallT`. **A hole with a net on it is planked over** and the check skips it (`netAt`) —
  that tile is walked across like any other, which is how the catch changes hands.
- **Everyone else avoids water**: `moveEntity` treats hole tiles as solid for every entity
  except the player, so animals and robots never wade in — a net does not change that, because
  `walkable()` still refuses `ground === 2`, so no bot ever routes over one. `isSolidTile` now
  skips any `water: true` STRUCTS entry, so a net is not solid either; arrows still fly over holes.
- **Refreeze**: at dawn every hole reverts to ice (`repaintGround` again) and `iceCracks`
  clears — except a hole carrying a net, which stays open water *and stays in `holes`*, so it
  refreezes the dawn after somebody wrecks the net.
- **Fish**: the `fish` array holds up to `FISH_MAX` (30) passive swimmers, that many spawned at
  boot (`spawnFish()`, after `spawnAnimals()`) on **interior** ice only (tile centers passing
  `fishClear` with a 14 px margin, ~a tile off the shore). `updateFish()` wanders them with a
  **soft edge cap**: `fishClear(x, y)` requires `FISH_MARGIN` (6 px) of water on all four sides
  of the body, the steering veers away from shore a look-ahead early (choosing the more open
  side, falling back to the fish's per-fish `ts` turn bias), and movement is hard-clamped —
  a position that would poke the body into snow is never committed. That clamp is **axis-aligned**
  (`fishClear` probes ±margin on the four compass directions from the centre) while the drawn body
  is rotated, so a fish swimming diagonally along a shore can still clip a corner of snow with its
  nose or tail for a frame or two — measured at ~19 frames in 20 s across a 30-fish shoal, at the
  0.4 alpha an under-ice fish is drawn with. It is a shimmer at the waterline, not a fish in a
  snowdrift. They render as translucent silhouettes
  through the ice — brighter and surfaced inside an open hole — in a pass right after the
  ground blit (using `ex`/`ey`). Cracking ice spooks nearby fish into a fast dart.
- **Bow-fishing**: `spearFish(p)`, the first thing `fireTool(p)` tries, checks whether that player stands on an ice tile with a
  fish within `FISH_CATCH_R` (16 px); if so the shot becomes the catch (any charge level):
  `p.inv.fish++`, splash, no arrow — and the catch is
  [contested](multiplayer.md#contested-orders), so two players can't land the same fish. Hovering a fish (`hoverFish()`, a 7 px disc) switches the
  cursor to the water-blue **fish** reticle and `drawFishHint()` (overlay pass, after the E
  prompt) frames it with the same pulsing white brackets stumps get plus a click prompt — a
  pixel mouse icon (`drawMouseIcon`: only the left button is coloured — gold, hot orange while
  pressed/charging — so nothing hints at right-click) reading
  **SPEAR** when `fishInRange()` holds, or a dimmed **GET CLOSE** otherwise, because the
  mechanic is proximity, not aim. Fish are food: **F** eats one for +50 HP (`eatFish`, mirroring
  the berry's Q/+20), counted beside the berries on the backpack strip
  (`SPRITES.itemFish`, 8×8, own `FIPAL`). `SFX.splash()` was added for the water sounds. `DBG`
  exposes `fish`, `iceCracks`, `holes`, `crackIce`, `addFish`, `spawnEmerger`, `netAt`,
  `buildSiteAt`.

### The shoal is a population, not a nightly reset

Spears and nets take fish **out** of `fish`, and nothing puts them back at dawn any more. What
refills it is a trickle in `updateFish`: `state.fishT` counts down `FISH_SPAWN_T` (11 s), or
`FISH_SPAWN_FAST` (4 s) while the shoal is under `FISH_MIN` (10), and each expiry calls
`spawnEmerger()` unless the shoal is already at `FISH_MAX` (30). So the water can be fished down
hard, never to nothing, and recovers fastest when it is emptiest. Measured from a shoal of 4:
**4 → 11 in 30 s** under the floor, then **11 → 16 over the next 60 s** above it.

**`born` is a fish's whole life story.** A born fish is the one the game always had: hard-clamped
inside the water, drawn, spearable, nettable. An **emerger** is none of those. `spawnEmerger()`
puts it two tiles *into the snow* beside a roomy shore tile, pointed at the water — the snow being
the deep lake the map has no way to draw — and it creeps in at `FISH_EMERGE_SPD` (7 px/s) with the
wander, the edge cap and the clamp all switched off, because the shore is the thing it is crossing.

`fishVis(f)` samples five points nose-to-tail and returns the fraction over water; that is `f.vis`,
and it is what promotes the fish (`vis >= 1` *and* `fishClear` agreeing ⇒ `born`, after which the
clamp keeps `vis` at 1 forever). The **draw alpha ramps off the back half of it** —
`max(0, (vis - 0.5) * 2)` — so an emerger is completely invisible until more than half its body is
under the ice, and by the time anything is drawn the only part still outside is a pixel or two of
tail at a fraction of 0.4 (worst case measured: **0.24**). An emerger that has not made it in
`FISH_EMERGE_MAX` (14 s) is dropped, unseen. Everything that selects a fish — `hoverFish`,
`fishInRange`, `spearFish`, `drawAimLine`'s marker, the net, the `crackIce` spook — tests
`born` first.

**The emerge sites are found once and cached** (`emergeSites`/`buildEmergeSites`, a lazy one-time
scan costing ~1.4 ms). The first version rejection-sampled random tiles for one, and on a 232²
world the odds of a random tile being ice with swimming room *and* having snow exactly two tiles
off are low enough that thirty tries routinely found nothing — which silently throttled the whole
trickle to near zero (measured 0 successes in 12 calls). With the cached list it is 20/20. The
shoreline never moves, and a hole only flips ice↔water which `fishClear` counts as swimmable
either way, so one scan stays correct for the match; `genWorld()` only ever runs at boot.

### Fish nets

`STRUCTS.net` (`FISH NET`, 8 gold, 45 hp, one tier) is the only `water: true` building, and that
one flag — never the type name — is what every site reads:

| `water: true` means | where |
| --- | --- |
| built on a bare open hole, not a stump | `placeStruct` (and the contest callback re-checks it) |
| the wheel over open water offers it, and only it | `buildSiteAt` → `buildOptionsAt` → `WATER_STRUCT_ORDER` |
| not solid — you walk **on** it, and the plunge check skips it | `isSolidTile`, `updatePlay` |
| its hole never refreezes while it stands | the dawn branch, via `netAt` |
| drawn flat, under everything, never y-sorted | `drawNet` in the flat pass — see [rendering](rendering.md#render-pass-order) |

Right-clicking a hole opens the ordinary build wheel with a single option. Nothing is special-cased
for a one-option wheel: `wheelSpan(1)` is the full circle, so any direction out of the hub picks
the net and the hub still cancels.

A finished net runs two clocks in `updateStructures`' `net` branch:

- **Catching.** Any `born` fish within `NET_R` (9 px) of the tile centre is spliced out of `fish`
  and becomes `o.fish`, capped at `NET_CAP` (3), one every `NET_CATCH_T` (2.2 s) so a net fills
  visibly instead of hoovering the pond. Fish are *drawn into* it: `nearestNet` gives every born
  fish a gentle lean toward any net inside `NET_LURE` (44 px) that still has room — that lure is
  what makes a net read as working rather than waiting on luck.
- **Emptying.** Any living player whose feet are on the tile takes one fish every `NET_TAKE_T`
  (0.3 s) straight into their bag — **team is never checked**. A net is a thing lying on the ice,
  not a locked chest, so an enemy standing on yours walks off with the catch. It is
  [contested](multiplayer.md#contested-orders) (`net:<idx>`) so two players over one rope cannot
  take the same fish, and a full bag flashes the refusal (`bagDenied`) and leaves the fish in.

Enemies break a net with **E** like any other building (`workTarget` finds the object on the tile
and gates on `ownsStruct`); the owner demolishes it from the manage wheel. Either way
`destroyStructure` tips what it was holding back out as `fish` drops before it goes.

