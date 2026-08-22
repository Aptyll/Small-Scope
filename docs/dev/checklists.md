# Checklists

Step-by-step lists for the changes that touch many places at once, plus the intentionally dead
code you should not "clean up".

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
`STRUCT_ORDER` (the build wheel draws the local team's `SPRITES.teamBuild[team][type][0]`), a
16×16 grid baked into the per-team `teamBuild` sets (see [sprites.md](sprites.md)), entries in
`isSolidTile()`, both map colour tables, and a functional tick branch in
`updateStructures()`. `hitObject()`, the draws pass (via `structSprite`), construction, ownership
and refunds already dispatch on `STRUCTS[o.type]` — no per-type work there.

**Adding a ground type** — extend `paintGroundTile()`, `updateMinimap()`, and `buildWorldMapImg()`,
give it a surface branch in `updatePlayer()`'s momentum block (steer/decay/target rates — ice is
the template), and remember `genWorld()`'s `free()` helper treats "ground must be 0" as the
placement rule.

**Tuning balance** — the numbers live inline: `STRUCTS` costs/HP/build times (plus turret
range/dmg/rate, generator pay/period, spawner bot counts/HP), the `YIELD` table (every gold
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
- `SPRITES.imp` is still baked with its old ice palette and unreferenced, but its *grids* are
  now the robot sprite — don't delete them.
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
- `SFX.nightSting` and `SFX.monsterDie` in [js/audio.js](../../js/audio.js) are unreferenced since
  the raider removal.
- The turret type (its tick is an idle no-op), the spawner's guard mode (loiters), and the
  `tracers` pass are kept working but have no trigger — they went idle with the raiders, and
  nothing but players is hostile now.
