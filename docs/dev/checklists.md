# Checklists

Step-by-step lists for the changes that touch many places at once, plus the intentionally dead
code you should not "clean up".

## Verifying a change

The rule is in [CLAUDE.md](../../CLAUDE.md): look at the running game, don't re-read the code and
declare victory. The three affordances:

- **`window.DBG`** (end of [js/game.js](../../js/game.js)) — read the object literal for the
  current surface; it is the whole external API. The non-obvious members: `step(dt, n)` runs `n`
  fixed-`dt` update ticks and one render, `freeze = true` stops the rAF loop so stepping is
  deterministic (it halts `render()` too, so the canvas holds the last frame — set the value you
  want *before* freezing), `hideUI = true` drops the HUD/info stack/cursor for captures, `buildStruct` stages
  a construction site with no cost or validation, `warp(tx, ty, p?)` drops a slot on a tile, and
  `setControl(slot, mode)` hands a slot to an AI, a human or nobody. **Stage the scene** (place
  structures, warp to a landmark, jump `state.day`/`state.time`) instead of playing to reach it.
- **`?seed=N`** pins the world — the same seed twice proves a change is deterministic, two seeds
  prove worldgen still varies. Without it every reload is a different world and A/B screenshots
  are meaningless. The seed prints in the [info stack](gameplay.md#settings) — top quarter of the
  left edge — but only while `settings.info` is on, and it defaults **off**: flip it on (the ESC
  menu's INFO row, or F3) before capturing anything you intend to compare later.
- **`POST /shot`** in [serve.js](../../serve.js#L14) writes a base64 PNG body to `shot.png` in the
  repo root, for a headless driver doing `canvas.toDataURL()` → POST. Nothing in the client calls
  it, and `shot.png` is not gitignored — don't commit it.

A page that loads the same four scripts, stages through `DBG` and POSTs the canvas is enough to
drive the whole game from a headless browser; keep such a rig out of the repo (or delete it when
you are done) so `index.html` stays the only entry point.

## What is worth recording

[CLAUDE.md](../../CLAUDE.md) carries the rule (docs are part of the deliverable, fixed in the same
turn as the code); this is the inventory.

**Worth recording:** a new object type, buildable, ground type, resource, landmark, or enemy; new
or rebound keys; new state on `state`/`settings`/`player`; a new render pass, overlay, or
offscreen canvas; a change to the day/night, lighting, tool, or difficulty formulas; anything that
adds a cross-file invariant; any change to how the game is run or verified; and durable
preferences or constraints the user states in conversation.

**Not worth recording:** balance tweaks to existing numbers, sprite pixel edits, and refactors
that preserve the described structure.

## Common changes

**Adding an object type** — touch all of: `isSolidTile()` (if it blocks), `hitObject()` (what a
swing does to it — including which tool is allowed, see the gating block at its top), the flat
pass or the `draws` y-sort in `render()`, `updateMinimap()`'s colour table,
`buildWorldMapImg()`'s colour table, `rebuildLights()` if it glows, and `workTarget()` if E
should work it (that one line also gives it the cursor's lock ring). The two map colour
tables are the easy ones to forget — a missing entry silently draws as a stump.

**Adding a tool** — append to `TOOLS` with a `TOOL_*` index constant, add an 8×8 icon sprite
and name it in the entry's `icon` field, map the object types it works in `workTarget()`
(that is the only selection logic — there are no keys or bar slots), and give its `key`
behavior in `hitObject()`'s gating.

**Adding an ability or input** — it belongs to *every* slot, not to the local player. Add the
field to `makeInput()`, fill it for the human in `sampleHumanInput()` (edge-triggered flags are
set by the event handlers and cleared by the sim), consume it in `updatePlayer(p, dt)`, and give
bots a way to use it in `updateAI()`. If only one player can have the result, queue it through
`contest()`. See [multiplayer.md](multiplayer.md).

**Adding a way to hurt a player** — pass the attacker as `damagePlayer`'s `src` (or, when the
world did it, a `DEATH_CAUSE` key as `cause`). Miss it and the kill is uncredited on the TAB
scoreboard and the event feed reports the death as an accident. See
[multiplayer.md](multiplayer.md#kills-and-the-event-feed).

**Adding a stump-built structure** — add a `STRUCTS` entry (3 tiers) and its wheel slot in
`STRUCT_ORDER` (the build wheel draws the local team's `SPRITES.teamBuild[team][type][0]`, and
sizes itself: a fifth entry is five even wedges, no layout to touch), a
16×16 grid baked into the per-team `teamBuild` sets (see [sprites.md](sprites.md)), entries in
`isSolidTile()`, both map colour tables, and a functional tick branch in
`updateStructures()`. `hitObject()`, the draws pass (via `structSprite`), construction, ownership
and refunds already dispatch on `STRUCTS[o.type]` — no per-type work there.

**Adding a landmark** — a `LANDMARKS` entry plus its `gen`, and its key in `LANDMARK_ORDER`; that
is the whole feature (see [world.md](world.md#landmarks) for the fields). The entry's shape:

```js
shipwreck: { name, tag,           // what both maps, the chart and the arrival toast print
             count, r, surface,   // how many, footprint radius in tiles, 'snow' | 'ice'
             mark, icon,          // map ink; the glyph is [x,y,w,h] rects in a 7x7 box
             pop, repop,          // inhabitants kept alive, seconds between top-ups
             gen(L), spawnOne(L) } // stamp the objects (in worldgen); add one inhabitant (after)
```

The abandoned mine, frozen fort, shipwreck and shop are meant to land here. Nothing in the maps, the
drop chart or the HUD needs to learn about it. What *does* cost work: any **new object type** its
`gen` stamps (the checklist above), any **new kind of inhabitant** its `spawnOne` pushes into
`animals` (a `kind` branch in `updateAnimal`, hp in `ANIMAL_HP`, a `HIT_PUFF` colour, a payout in
`animalDies`, `UNIT_MASS` + `unitRadius` if it is solid, a hover box in `cursorInfo`, and — if it
can hurt a player — a `DEATH_CAUSE` key), and rolling **only** through `lmRng`, never `rng`.

**Adding a ground type** — extend `paintGroundTile()`, `updateMinimap()`, and `buildWorldMapImg()`,
give it a surface branch in `updatePlayer()`'s momentum block (steer/decay/target rates — ice is
the template), and remember `genWorld()`'s `free()` helper treats "ground must be 0" as the
placement rule.

**Tuning balance** — the numbers live inline: `STRUCTS` costs/HP/build times (plus turret
range/dmg/rate, generator pay/period, bay bot count/HP and its `w`/`h` footprint; the roll-out
cadence is inline in `updateStructures()`'s spawner branch), the `YIELD` table (every gold
payout), `WORK_REACH`, `BOW_CHARGE`, and the
momentum constants (`ICE_MAX`, `SLIDE_MIN`/`SLIDE_EXIT`, `TRAIL_MIN`) in the constants banner,
the per-surface steer/decay rates inline in `updatePlayer()`'s movement block,
the slot count (`MAX_PLAYER_SLOTS`) and the bot ranges (`AI_SIGHT`, `AI_HUNT`, `AI_FORAGE`),
the arrow speed/damage formulas in `fireArrow()`,
`TREE_RARE_CHANCE` in `treeRare()`, and the darkness ramp in
`update()`.

## Known drift

- [README.md](../../README.md) is a storefront page (hero + mechanic shots in `docs/media/`), not a
  tech guide — no run instructions, controls list, or code layout. Those live in the root
  [CLAUDE.md](../../CLAUDE.md) and these dev docs.
- `SPRITES.imp` (the `imp1`/`imp2` grids, `IPAL`) is baked but unreferenced since the worker bot
  got its own grids — kept in case the imp returns.
- The flat `SPRITES.spawner` (the old 16×16 hut grid in the three tier palettes) is baked but
  unreferenced since the bot bay; the live sprite is `teamBuild[team].spawner[0]`.
- `SPRITES.spikes`, `SPRITES.fire`, `SPRITES.torch`, and the three heart sprites are baked but
  unreferenced since the buildables/HUD removal — kept in case those features return (the heart
  grids also carry the file's mangled-byte repair).
- The `<` glyph in [js/font.js](../../js/font.js) was added for the removed resolution cycle
  control and is currently unreferenced — kept as generic font coverage. (`>` is live again: it
  marks your own row on the scoreboard.)
- `SPRITES.raider` (+ `RDPAL`) and `SPRITES.mine` are still baked but unreferenced since the
  raider/mine removal — kept in case a threat returns; the raider set shares the player grids
  (as do the four `playerTeam` sets, which are the live ones).
- `SPRITES.goldOre`, `SPRITES.itemWood`, and `SPRITES.itemStone` are baked but unreferenced since
  the single-currency change (no ore object, no wood/stone drops or HUD counters).
- `SFX.nightSting` in [js/audio.js](../../js/audio.js) is unreferenced since the raider removal
  (`SFX.monsterDie` is live again — every animal death plays it).
- The spawner's guard mode (loiters) and the `tracers` pass are kept working but have no trigger —
  they went idle with the raiders. The **turret is live again** (it shoots enemy players and worker
  bots) but it does not use `tracers`: it fires a travelling bolt through the `arrows` array, so
  the `tracers` pass still has nothing pushing to it. Wolves are hostile but only to players.
  Worker bots take arrows from any rival now (and so, at last, the turret bolts that were already
  aiming at them — see [Robots](gameplay.md#robots)), but nothing **melees** one and the AI's
  target picker still ignores them: a bot slot only downs a worker by accident, with a shot meant
  for a player. Buildings are not immune either: a **player** on another
  team breaks one with E (see [Base building](gameplay.md#base-building)), but no AI or wildlife
  does, and arrows and bolts pass buildings without damaging them.
