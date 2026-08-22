# The world

The tile grid, worldgen, the seeded RNG contract, the day/night cycle, and the one runtime
ground change (ice holes). Read this before touching `genWorld()`, adding a ground type, or
anything that must stay stable per tile.

## The tile world

- `WORLD = 232` tiles of `TILE = 16` px → a 3712×3712 px world. The forest border keeps its
  original depth (`BORDER_MIN`/`BORDER_MAX` 30–70, avg ~50), so the growth all went into the
  open interior (~132 tiles across, double the old ~92²'s area); interior feature counts
  (ponds, rock clusters, bushes, wildlife) were doubled to hold density. `ringPts` is one point
  per player slot, evenly spaced on a ring `SPAWN_D` (`WORLD / 2 - 55`) tiles from the centre at
  the treeline — the old spawn camps. Nobody starts there any more (players land from the eagle,
  see [multiplayer.md](multiplayer.md#where-players-start)) and no pocket is carved, but the river
  spokes and the keep-clear rules still hang off them, so `MAX_PLAYER_SLOTS` still shapes worldgen.
- `ground` — `Uint8Array(WORLD²)`: `0` snow, `1` ice, `2` open-water hole (runtime-only, see
  [Ice holes and fishing](#ice-holes-and-fishing)). Ice is **mechanically slippery** (see
  [Momentum movement](gameplay.md#momentum-movement-players-only)), and worldgen carves it as a travel
  network: 14 frozen lakes plus winding ~5-tile-wide rivers (`carveRiver` in `genWorld()`) —
  a spoke from each ring point to the central clearing and a ring linking each point to its
  neighbour. The shared `carveIce` rule skips existing objects, the ring points, and the clearing,
  so rivers gap naturally around them.
- `objects` — flat `Array(192*192)`, **at most one object per tile**. Every object is
  `{ type, tx, ty, hp, flash, shake, ...extra }`. Types: `tree`, `stump`, `rock`, `bush`,
  `wall`, `turret`, `generator`, `spawner`.
- Index with `idx(tx, ty)`, read safely with `objAt`, create with `placeObj`. Deleting is
  `objects[idx] = null` (structures should go through `destroyStructure` so lights rebuild and
  the `structures` registry stays in sync — it routes tiered types through `removeStruct`).
- `wall`, `turret`, `generator`, `spawner` are the **stump-built tiered structures** (see
  [Base building](gameplay.md#base-building)). Each carries `{ tier: 0|1|2, maxHp, building, buildT,
  buildTotal, dustT }` plus per-type fields (turret `cd`; generator `payT`; spawner `mode`,
  `bots`, `respawnT`), and every live one is also referenced from the module-scope `structures`
  array so per-frame ticks never scan the 36k grid. Stumps are **consumable build anchors**:
  building on one replaces it, and demolition/destruction leaves the tile empty, not a stump.
- The world center is an empty clearing (the old gold-ore ring is gone); `CENTER_R` in
  `genWorld()` still keeps ice ponds, rocks, and bushes clear of it so the river spokes meet in
  open ground, and the ore loop's two `rand()` draws per spot are kept as no-ops so existing
  seeds still generate the same world.
- Every `tree` carries `rare` (boolean), set at worldgen from `treeRare(tx, ty)`: a `hash2`
  roll gives each tree a `TREE_RARE_CHANCE` (8%) shot at a **jackpot** — `YIELD.treeRare` extra
  gold (as two coins, plus a `JACKPOT!` floater), paid by `hitObject()` only when the tree
  actually falls, on top of the normal payout. Being a position hash rather than an `rng()`
  draw, the roll is the same whenever it is asked — `DBG.treeRare(tx, ty)` reports it for any
  tile, occupied or not.

`renderGround()` pre-renders the *entire* 3712×3712 ground to one offscreen canvas at boot and
the frame loop just blits the camera window out of it. It is a one-time cost — never call it per
frame. The per-tile painter is factored out as `paintGroundTile(g, tx, ty)`, and a runtime
ground change must call `repaintGround(tx, ty)` — it repaints the tile plus its four neighbors
(edge rims depend on neighbors) into the prerendered canvas. Ice holes are currently the only
runtime ground change.

## Determinism and noise

Every run picks a fresh `SEED` at boot from `Date.now() ^ Math.random()`, and **everything random
derives from it** — there is no other entropy source. `?seed=N` in the URL overrides it, which is
how you replay or diff a specific world. `drawSeedTag()` prints `SEED_TXT` bottom-right on every
frame (drawn after the map, settings, and death overlays), so any screenshot carries the world
it came from; in `title` mode the main menu prints the seed instead, next to the reroll die.

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

## Day/night

`DAY_LEN = 110`, `NIGHT_LEN = 55`, so a full `CYCLE` is 165 s. `state.time` runs within the cycle,
`state.day` increments at wrap. `update()` derives `state.darkness` (0→1) from a hand-written
ramp: dusk over the last 12 s of day, full dark, then a 10 s dawn.

With the raider waves removed, night is purely visual pressure (darkness + lighting). What still
keys off the cycle:

- `darkness < 0.3` gates the only passive heal: slow daylight HP regen in `updatePlayer()`, for every slot.
  (There is no cold/warmth system — it was removed along with placeable campfires.)
- Carved ice holes refreeze at dawn (cracks heal too) and the fish shoal tops back up to
  `FISH_COUNT` — see [Ice holes and fishing](#ice-holes-and-fishing).

`state.day` no longer drives any difficulty — nothing hostile exists, so nothing currently
damages a player except another player's arrows and a plunge through the ice (see
[PvP](multiplayer.md#pvp)).

## Ice holes and fishing

**E over a bare ice tile** (no object) brings out the pickaxe and calls `crackIce(tx, ty)` on
that tile (see [Tools and the bow](gameplay.md#tools-and-the-bow)). Hits accumulate in the
`iceCracks` map (`tile idx → hits`, rendered as bright fracture decals in their own pass);
`ICE_HOLE_HITS` (3) breaks through — the tile becomes `ground = 2` (open water), joins the
`holes` list, and is repainted into the ground canvas via `repaintGround()`. Constants live in
the constants banner (`ICE_HOLE_HITS`, `HOLE_FALL_DMG`, `HOLE_FALL_T`, `FISH_COUNT`,
`FISH_CATCH_R`).

- **Falling in**: standing over a hole tile (checked at the player's feet in `updatePlay`)
  plunges the player: `HOLE_FALL_DMG` (15) via `damagePlayer`, velocity zeroed, and
  `player.fallT` runs `HOLE_FALL_T` (1.1 s) of floundering — no movement, tools, dodge, or
  slide (`clickAction`, `tryWork`, and `tryDodge` all check `fallT`). `drawPlayer` clips
  the sprite to the waterline with ripple rects. The climb-out teleports to
  `nearestDryTile()` with brief i-frames. An **active dodge roll crosses holes safely**
  (the fall check skips while `dodgeT > 0`). Every player falls in; `die(p)` and `Player.reset()`
  clear `fallT`.
- **Everyone else avoids water**: `moveEntity` treats hole tiles as solid for every entity
  except the player, so animals and robots never wade in. `isSolidTile` itself is unchanged —
  arrows still fly over holes.
- **Refreeze**: at dawn every hole reverts to ice (`repaintGround` again) and `iceCracks`
  clears.
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
- **Bow-fishing**: `fireArrow(p)` first checks whether that player stands on an ice tile with a
  fish within `FISH_CATCH_R` (16 px); if so the shot becomes the catch (any charge level):
  `p.inv.fish++`, splash, no arrow — and the catch is
  [contested](multiplayer.md#contested-orders), so two players can't land the same fish. Hovering a fish (`hoverFish()`, a 7 px disc) switches the
  cursor to the water-blue **fish** reticle and `drawFishHint()` (overlay pass, after the E
  prompt) frames it with the same pulsing white brackets stumps get plus a click prompt — a
  pixel mouse icon (`drawMouseIcon`: only the left button is coloured — gold, hot orange while
  pressed/charging — so nothing hints at right-click) reading
  **SPEAR** when `fishInRange()` holds, or a dimmed **GET CLOSE** otherwise, because the
  mechanic is proximity, not aim. Fish are food: **F** eats one for +50 HP (`eatFish`, mirroring
  the berry's Q/+20), with a count indicator under the berry indicator top-left
  (`SPRITES.itemFish`, 8×8, own `FIPAL`). The shoal tops back up to `FISH_COUNT` each dawn,
  never within 120 px of any player. `SFX.splash()` was added for the water sounds. `DBG`
  exposes `fish`, `iceCracks`, `holes`, `crackIce`, `addFish`.

