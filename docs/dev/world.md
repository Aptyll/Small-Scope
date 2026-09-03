# The world

The tile grid, worldgen, the seeded RNG contract, the day/night cycle, and the one runtime
ground change (ice holes). Read this before touching `genWorld()`, adding a ground type, or
anything that must stay stable per tile.

## The tile world

- `WORLD = 232` tiles of `TILE = 16` px → a 3712×3712 px world (under `PRACTICE` the const is
  76 instead — see [the practice arena](#the-practice-arena)). The forest border keeps its
  original depth (`BORDER_MIN`/`BORDER_MAX` 30–70, avg ~50), so the growth all went into the
  open interior (~132 tiles across, double the old ~92²'s area). The two **roost corners** —
  bottom-left and top-right, where the eagles always come down
  ([eagle drop](rendering.md#eagle-drop-mode-drop)) — are forested to `ROOST_R` (68 tiles from the
  corner, ~48 along the diagonal) outright: `borderDepth` is the seed's own `borderNoise` **or**
  a quarter-disc whose arc wobbles ±`ROOST_WOBBLE` (3) on the fine noise, so whatever the seed grew
  there the corner holds one solid block of woods and the treeline the lane cuts to is at least
  the arc. The union only adds pines, and `genWorld` rolls its per-tree `rng()` only under
  `borderNoise`, so a seed's interior is exactly what it was before the corners were guaranteed
  (the seed-42 ground hash and landmarks are unchanged); not under `PRACTICE`. Interior feature counts
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
  `objects[idx] = null` (structures should go through `destroyStructure` so the `structures`
  registry stays in sync — it routes tiered types through `removeStruct`).
- `wall`, `turret`, `generator`, `spawner` are the **stump-built structures** (see
  [Base building](gameplay.md#base-building)). Each carries `{ tier, maxHp, building, buildT,
  buildTotal, dustT, sparkT }` plus per-type fields (turret `cd`; generator `payT`; spawner `mode`,
  `bots`, `respawnT`/`respawnTotal`, `door`), and every live one is also referenced from the module-scope `structures`
  array so `updateStructures()` never scans the 53,824-tile grid. (`updatePlay` does: one
  unconditional pass over all of `objects` every step, ticking `flash`/`shake` and bush regrow —
  that loop, not the structure tick, is where a full-grid frame cost actually lives.) A picked
  bush regrows in `BUSH_REGROW` (70 s) and **wears its own clock**: `bushEmpty` until ripening is
  `BUSH_BUD_T` away, then `bushBud` (pale buds where the berries will be), `bushRipen` (the
  berries back but dull) inside `BUSH_RIPEN_T`, then `bush` — chosen in `render()`'s bush
  branch, so a player reads wait-or-move-on off the plant at a glance, and **under the pointer a
  regrowing bush wears the neutral unit bar** filling toward ripe (the frames say roughly, a hover
  says exactly — [rendering.md](rendering.md#the-tree-fade)); `ready` still refuses E until the
  berries are ripe, so neither in-between frame ever rims. The first
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

The TRAINING FIELD behind the title's PRACTICE TOOL plank (three knocks break its ice —
[rendering.md](rendering.md#main-menu-title)): `?practice=1` boots `genPracticeWorld()` (the
`practice arena` banner, js/world.js) **instead of** `genWorld()`, and js/boot.js skips
landmarks, chests, wildlife spawns and the eagle drop entirely. **The practice world itself is
small — `WORLD` is 76 under `PRACTICE`, against the match's 232** (the conditional above the
`WORLD` const, js/core.js; everything downstream sizes itself off `WORLD`, so the match world is
untouched). The **clock never runs**: js/boot.js pins `state.time` to early morning and sim.js
never advances it under `PRACTICE` — crisp daylight forever, no dusk, no dawn refreeze. The
**cloud shadows are skipped there too** for the same reason the clock is pinned: a shadow drifting
over the dummy's meter or the parkour's ice would change what those instruments measure between
one lap and the next. The sun shafts stay ([rendering.md](rendering.md#light-and-weather)).

The arena is one open **40×23-tile snowfield** (`PR_W`/`PR_H`) cut to pure combat: a single
**dummy** standing in the open snow in the middle, the two-tile bow **rack** in the open snow
east of the dummy on its own row (`lead` on the left tile, a solid silent follower right; a
two-tile pair can only centre on a tile boundary, so the lead carries `dx: -8` and the sprite,
brackets and prompt all draw nudged 8px left — `RACK_SPR` itself is baked per-pixel
in js/draw-world.js so the strung staves get true curves), the spawn just south of the dummy —
**the rack is the armory**: standing within E's own reach of it (`rackNear`) raises an `E ARM`
key-cap over it (`drawRackHint`, ui.js — proximity, not hover), **holding E opens a radial
wheel** of every tool in the game (`state.wheel` kind `'rack'`, the ordinary wheel pipeline),
the pointer picks, and **releasing E takes** — the right-click wheel's hold-and-release grammar
moved onto the key (a real work target in reach keeps E's day job, the same rule that decides
which prompt shows). The pick lands in `rackEquip` (`PRACTICE`-gated, the practice banner),
replacing the selected slot with a fresh instance of the picked tool, a plain arrow seated so
it fires the moment it is taken — the **archery targets riding a two-rail track around the
field's whole perimeter** (below), and the **range bell** that runs the timed archery round
over that track, standing west of the dummy as the rack's mirror: bell and rack flank the
dummy on its row, each five tiles out. No fences, no wildlife, no chests, no pond, no
harvest, and nothing spawns or restocks outside a round. `PRACTICE`
(js/core.js) pins `SEED` to `PRACTICE_SEED` *above* the `?seed` parse, so the field is
bit-identical on every visit and no seed can reshape it.

**The ice parkour** runs through the forest collar around the field: a narrow carved-ice loop
(`PK_PATH` is the *stock* centreline in world tiles, carved by `pkCarve` — trees hug
both sides, and ice being mechanically slippery is the whole game of it). A cleared walk
(`PK_WALK`) leads out of the field's west side to the **checkered start/finish line**: a
**fixed five-tile strip** (`PK_LINE`) that `pkPlanCarve` force-ices on every carve whatever
width the roll cut the lane, so the painted band (`drawParkourLine`, render.js's flat pass), the
lap test and the two `banner` flags capping its ends never stretch, gap or move. The lap:
stepping onto the line box starts the clock (`parkour`, the
module state beside `PK_*`), a checkpoint at the current track's farthest-east waypoint keeps a
lap honest (`parkour.cpTx/cpTy`, a radius test on the ice), and recrossing the
line records it and rolls straight into the next lap. Leaving the ice for `PK_OFF_T` seconds (or
dying) abandons the run. The live clock rides over the runner's head (gold, icy blue once the
checkpoint is armed) and BEST / LAST hang on a frost plate above the gate (`drawParkour`,
js/draw-world.js) — the dummy meter's instrument language, same recorded carve-out. **BEST is
the profile's all-time record on the stock track**: seeded from `PROFILE.bestLap()` at gen,
written back through
`PROFILE.setBestLap()` on a record (stored at the plate's own 0.1 s precision; only a strictly
lower time writes) — the one thing practice ever puts in the profile, while LAST stays
session-only. Everything
is coordinate tests against the carved ice — no objects, no triggers. The trickle that refills a
match's shoal is **off entirely under `PRACTICE`** (js/wildlife.js), because the only ice in the
world is the race line and a fish emerging into it would be absurd; `crackIce` still works on
the track (a hole in the racing line is the player's own doing, and re-entering rebuilds —
and a reroll unregisters the old track's cracks and holes before the forest regrows).

**The roll station is one die and one held wheel**: the die on its plinth stands in a small
felled nook off the walk's south side, adjacent to the walk so its `E ROLL` cap rises as you
pass (`pkdie`, `PK_DIE` — `pkDieNear` resolves it, shared by the prompt, `drawPkHint` in
js/ui.js, and the press in js/input.js). **Holding E beside it opens a three-wedge radial
wheel** (kind `'pkdie'`, the armory rack's own hold-and-release grammar and the ordinary wheel
pipeline): one wedge per difficulty, each drawn as **that difficulty's coloured die** — a
green, amber or red cube with its pip count (`PK_DIE_COL`, draw-world.js), the current track's
one wearing a gold frame. Releasing on a wedge IS the roll (`pkWheelPick`, through the same
`input.cmd` → `runCmd` path every wheel uses): it carves a **fresh random track** at that
difficulty, and the standing die's whole body recolours to the picked cube, so the die always
says what the current track is without opening anything. `pkRoll` picks the loop (`pkGenPath`: waypoints on a
jittered ellipse per `PK_DIFF` around `PK_CX`/`PK_CY` at `PK_RX`/`PK_RY` — easy few points/wide
carve, hard many alternating slalom points/narrow carve — pinned to the west gate with lightly
jittered approach legs so consecutive rolls visibly differ where the roller stands, kept out of
the field's `PK_APRON` (6) tile **tree belt** with chord segments routed around its corners,
and the carve plan itself refuses field tiles) and re-aims the checkpoint at the new
farthest-east waypoint. **The terrain change is a watched sweep, not a blink**: `pkRoll` sorts
every affected tile into events keyed by ring angle (`pkAngKey`, 0 at the gate) and
`pkAnimStep` (from `updatePractice`) spends them as one eased carving front laps the collar in
`PK_ANIM_T` seconds — slow off the gate, quick round the far side, slow home — closing forest
over the old track (tree + flash + snow poof, never onto the player) and cutting the new lane
(each pine **shudders `PK_WARN` radians before it falls** — a `k:2` event sets `o.shake`, which
sim.js's object-timer loop decays — then goes down in a needle burst; frost sparkles settle on
fresh ice, a sparse `break_` ticks, and the line flashes when the front comes home). A **sparkle
plume rides the front** the whole way: the roll samples the new path into a dense angle-ordered
trail (`pkAnim.trail`) and the step emits deep-blue-and-white sparks at the front's trail
position on a time-based clock (refresh-rate independent), so the sweep stays visible even
where old and new track share tiles and no event fires. Each event is one ground write plus
one `repaintGround` (a shudder is neither) —
a handful per frame, `PK_ANIM_CAP` bounds dt spikes — and the die tumbles for the whole sweep
while `pkRoll` refuses a re-roll and the `E ROLL` cap hides. `pkTiles` remembers
the current carve (the walk, line and station never move), and a shared tile the player broke a
hole through gets its own re-ice event, since its registration was wiped with the roll. **A rolled track flips
`parkour.custom`**: BEST/LAST restart and the
profile is never written from one — random loops are not comparable, so the stored record stays
what it claims to be, the stock lap. Track rolls draw on the runtime `rng()` stream — post-boot
calls reshuffle nothing ([determinism](#determinism-and-noise)), and the arena's boot remains
bit-identical: the stock loop is carved before any roll can happen.

**There is no ground type 3 any more** — the dummy's packed-earth pad was the only thing that
ever wrote it (2.27 returned that patch to snow and removed the earth paint branches with it),
so the live grounds are 0 snow, 1 ice, 2 open water.

**The archery targets** (Link's-Crossbow-Training-style) all ride one piece of furniture: a
**two-rail track ringing the field** (`AG_RECT`, `AG_INSET` tiles in from the rim, so the ring
sits in open snow with the treeline well clear of every face; rails drawn flat by
`drawAgTrack` — two nested bands built from one exact-cornered `band` helper, with ties
spanning the rails kept clear of the corner joins). Every target is a trolley
on a rail — ENTITIES in `ptargets`, never tile objects (a mover crosses tiles every frame, and
a raised face should not block a walker) — so only arrows meet them: the PRACTICE branch of the
arrow loop (js/sim.js) tests every live face disc (`ptFace`/`ptLive`/`ptHitR` — the hit disc
scales with the target's `size`, small or large, `AG_SIZE`). A target lives at track distance
`s` (`agPos` maps it to world x/y) on one of **two lanes** (`AG_LANE_GAP` px apart), with three
habits: `still`, `move` (rolling `dir × spd` along the rail, `AG_SPD` slow/medium/fast) and
`pop` (flipping up out of its trolley on its own `{hide, rise, hold, sink}` clock). **Every
habit tells at a glance** (`drawPTarget`): a target is a rail *carriage* — plank body, steel
wheels seated on the rail along the rail's own axis (`agEdge`, so a side-rail target rides its
rail rather than dangling beside it), a mast sized to its face and planted in the body with the
face overlapping it, so the stack never gaps — whose wheels visibly turn while it rolls (plus a
snow trail paced by distance), whose lane hop lifts the whole carriage and lands with a puff,
and whose hidden pop-up form rattles on the rail with a snow fleck for a beat before the face
flips up, bouncing as it locks. The two face sizes are separate per-pixel bakes
(`bakeTargetFace` → `TARGET_SPR`/`TARGET_SPR_S`, draw-world.js), never runtime downscales,
every break snaps a quick shock ring out from the hit, sized to the face it came off
(`agRings`/`drawAgRings` — rasterised dots over a dark rim pass, white-hot cooling to gold),
and a milestone run (every fifth consecutive hit) flares at the face. **A mover
about to run into anything parked — or rolling slower — on its rail hops to the free lane and
keeps going** (`laneU` eases the hop, and `agBlocked` refuses a hop into an occupied stretch),
which is what lets a crowded round keep flowing. A hit lands in `hitPTarget`, and **the face
explodes on contact**: points, popup, the run and the shatter (`agShatter` — chips, straw,
splinters and the shock ring) all land the same frame, so the feedback is instant and the round
clock can never eat a landed shot. After the break a **stock** target (the free-practice roster,
`agStock`) stands bare `PT_RESPAWN` seconds and springs a fresh face, while a round target is
spent for good. **Every arrow into a face also extends a consecutive-hit run** (`agStreak`),
minigame or not: the hit popup carries it from the second hit on (`X3` alone in free practice —
white, gold from five, hot orange from ten — appended to the points during a round), any
practice arrow that ends without striking a face breaks it (the arrow loop, js/sim.js — the
dummy counts as a break: the run is a *target* run), and ringing a round in starts it over. `drawPTarget` (js/draw-world.js) owns every pixel, `TARGET_SPR` is the 32×32 face —
baked per-pixel (true circles, hash-dithered band edges, top-left light) rather than from a grid.

**The archery round** hangs off the **bell** (`agbell`, `AG_BELL`) west of the dummy: standing
within E's reach (`agBellNear`) raises an `E RING` cap (`drawBellHint`, ui.js), and **holding E
opens a three-wedge radial wheel** (kind `'agbell'`, the roll die's own hold-and-release
grammar and the ordinary wheel pipeline) — one wedge per difficulty, each drawn as **the target
face the round pours out, smaller as the pick gets harder**, the armed one wearing a gold frame
(the bell itself never wears the difficulty — no recolour, the wheel's frame is the readout).
Releasing on a wedge IS the ring (`agRing`, through the same `input.cmd` → `runCmd` path every
order takes) and runs the show (`agame.phase`, ticked by `agUpdate` from `updatePractice`): the
stock roster bursts away and **the dummy, the rack and the bell itself sink under the snow**
(`agSinkU` crops their sprites in render.js; at full depth their objects leave the grid
entirely, so nothing blocks a shot — which is also why a running round cannot be rung off, and
`agEndRound` puts the same instances back), a **3-2-1 countdown** lands in the eagle drop's
big-number language, and for `AG_T` seconds **random targets pour onto the track from the
picked difficulty's spawn table** (`AG_DIFF`: the three mover speeds, the small/still/pop odds,
the crowd cap and its refill pace — easy is slow, large and sparse, hard fast, small and
crowded) — each worth points on the harder-shot-pays-more rule (base 10; small, pop-up and
fast/medium pay more, speed scored by **class** so the bonus means the same thing on every
difficulty's table; the floater at the face says what it paid). A TIME / SCORE / HITS plate
rides top-centre (`drawAgameUI` — a practice instrument, the dummy meter's carve-out), every
live face outside the view gets a gold chevron pinned to the screen edge on the archer's line to
it (`drawAgMarkers`, draw-world.js — the shooter's off-screen marker, eight baked pixel
arrowheads, and none at all while every face is in view), timing
out ends the round with the final score standing large, and BEST / LAST hang
on a frost plate over the bell (`drawAgame`). **BEST is the profile's all-time record**
(`PROFILE.bestRange()`/`setBestRange` — whole points, only a strictly higher score writes), the
lap record's twin and the second of the only two things practice ever writes.

Practice is not a match, and everything with stakes is guarded on `PRACTICE`: the local slot is
the only active one (js/boot.js parks the other nine as `control: 'none'` in the corner
forest), `die()` becomes `practiceRevive()` (full pool, spawn tile `PR_SPAWN`, a beat of
grace), `checkLastStanding()` never fires, and the profile is never written — `gainGold` skips
`PROFILE.addGold` and the pinned clock means `addDay` can never fire — with two deliberate
exceptions: a record parkour lap (`PROFILE.setBestLap`) and a record archery round
(`PROFILE.setBestRange`, both above). The way out is the ESC
slab's LEAVE PRACTICE plank ([settings](gameplay.md#settings)).

The **dummy** is an `OBJECTS` entry (`solid`, any tool, verb HIT) with one solid tile and a
26×42 sprite (`DUMMY_SPR`, baked in js/draw-world.js beside the chest). Every way of hurting it
lands in `hitDummy` (js/actions.js): the E swing (`DUMMY_WORK_DMG`), every bit — the arrow loop
tests the dummy across its base tile and the two above it, so torso and head shots land — and
the roll's tackle. It never breaks: the pool floors at zero, the overhead bar appears only
while it is hurt, and `updatePractice` (called from `updatePlay` under `PRACTICE`) mends it
back to `DUMMY_HP` after `DUMMY_RESET_T` seconds unhit, with a shimmer for the announcement.
`updatePractice` is also the grounds' clock: it ticks every target's habit, rail roll and
respawn, runs the archery round (`agUpdate`), and times the parkour laps.

Over the dummy's head hangs its **damage meter** — LAST HIT / DPS / TOTAL for the combo in
progress, a recorded labelled-row carve-out from show-don't-label (CLAUDE.md, shared with the
parkour's plate). `hitDummy` keeps the ledger (`mLast`/`mTotal`/`mT0`/`mT1` on the object; a
hit after the mend window starts it over), DPS is total over first-to-last hit floored at one
second, and `drawDummyMeter` (js/draw-world.js) draws the plate — visible only while a combo is
live, lingering `DUMMY_METER_LINGER` past the mend so the final read stands, then fading.

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
  `borderDepth()` rides on `vnoise`, so the seed reshapes the forest and with it the whole map
  (everywhere but inside the two roost discs, which every seed grows alike).
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
`state.day` increments at wrap. Each wrap (and the landing, for DAY 1) raises the **day headline**
— `state.dayPop`, a ~3.5 s fade of bare `DAY N` at 2×, top centre (drawn in `renderUI`, ui.js) —
because days are the calendar a survival strategy is timed against, so a new one headlines
rather than riding the bottom message line.
`update()` derives `state.darkness` (0→1) from a hand-written
ramp: dusk over the last 12 s of day, full dark, then a 10 s dawn.

Night is visual pressure plus one real edge: a wolf's sight range scales
with `state.darkness` (×1.75 at full dark), so a den is a different proposition after sunset.
The visual half is a **colour**, not a darkness — a blue multiply over the finished frame with the
stars reflected in the ice under it, and nothing to carry a lamp for
([rendering.md](rendering.md#light-and-weather)). What else keys off the cycle:

- `darkness < 0.3` gates the only passive heal: slow daylight HP regen in `updatePlayer()`, for every slot.
  (There is no cold/warmth system — it was removed along with placeable campfires.)
- **The wind dies with the light.** `windAmp()` squares `1 - darkness`, so the snow stops blowing
  sideways and every pine goes still over the twelve seconds of dusk and stays still until dawn
  ([the wind field](rendering.md#the-wind-field)).
- The **sun shafts** are not on the darkness curve at all: they are up for the eagle drop and for
  about fifteen seconds around noon, and dark otherwise
  ([god rays](rendering.md#light-and-weather)). The **cloud shadows** fade out on it, and the **ice** darkens
  into a mirror on it with the **reflected stars** coming up inside that
  ([the reflected sky](rendering.md#the-reflected-sky)) - so a frozen lake reads darker than the
  snow around it after dusk, and an ice hole is a hole in the reflection.
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
`holes` list, and is repainted into the ground canvas via `repaintGround()`. Constants live in the `fish` banner of
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
  [contested](multiplayer.md#contested-orders), so two players can't land the same fish. **The catch is a pose**: the contest's
  callback calls `startCatch(p)` (below `spearFish` in js/tools.js), `CATCH_T` (2 s) of three
  down-facing frames whatever the body faced - `CATCH_STOOP` (0.16 s) bent to the hole,
  `CATCH_HAUL` (0.22 s) with the fish coming up, then the trophy hoist over the head
  (`catchFrame(p)` says which; `drawPlayer` draws it, the held tool and gear marks off, the
  overhead stack lifted 4 px for the hoist). The body holds still for its first `CATCH_WALK` (1 s) -
  `updatePlayer` swallows WASD, as a stun does - and a step walks out of it after that; it is no
  channel, because any other intent (a fresh press, a roll, a cast, a swing, a meal) and a hit
  through `damagePlayer` end it at any moment via `cancelCatch`. A net's first fish is hoisted
  the same way from `updateStructures`. The frames:
  [sprites](sprites.md). `DBG.startCatch`/`cancelCatch`/`catchFrame` stage it. Hovering a fish (`hoverFish()`, a 7 px disc) switches the
  cursor to the water-blue **fish** reticle and `drawFishHint()` (overlay pass, after the E
  prompt) frames it with the same pulsing white brackets stumps get plus a click prompt — a
  pixel mouse icon (`drawMouseIcon`: only the left button is coloured — gold, pale gold while
  pressed/charging — so nothing hints at right-click) reading
  **SPEAR** when `fishInRange()` holds, or a dimmed **GET CLOSE** otherwise, because the
  mechanic is proximity, not aim. Fish are food: **F** eats one for +50 HP over a 1.5 s channel a
  hit can break (`eatFish`, mirroring the berry's Q/+20; both meals share one 3 s clock - see
  [Food](gameplay.md#food-the-meal-is-a-channel)), counted beside the berries on the backpack strip
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

