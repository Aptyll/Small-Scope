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
  `setControl(slot, mode)` hands a slot to an AI, a human or nobody. `setHide(h, p?)` stages a
  buried body without lying in the snow for `PRONE_BURY`, and `concealOf` / `seenAt(range, p?)` /
  `ambushReady` read back what the world makes of it. **Stage the scene** (place
  structures, warp to a landmark, jump `state.day`/`state.time`) instead of playing to reach it.
  Two things a staged scene walks into: `warp` moves a slot but **not the camera**, which lerps
  after it over about a second of stepped frames — step ~120 frames of `1/60` after warping before
  cropping anything, or the crop lands on empty world; and a live AI slot parked beside the staged
  player will quietly shoot it dead mid-capture, so empty its quiver with `setQuiver(0, p)` first.
- **`?seed=N`** pins the world — the same seed twice proves a change is deterministic, two seeds
  prove worldgen still varies. Without it every reload is a different world and A/B screenshots
  are meaningless. The seed prints in the [info stack](gameplay.md#settings) — top quarter of the
  left edge — but only while `settings.info` is on, and it defaults **off**: flip it on (the ESC
  menu's INFO row, or F3) before capturing anything you intend to compare later.
- **`.`** cycles the [debug overlay](rendering.md#debug-overlays-hitboxes-and-routes): one press
  for the boxes and circles the sim tests, a second for the route every walker is following and
  the tile it is heading for. Reach for it before reasoning about a collision from the code alone.
  It draws in every mode, `settings.hitbox` sets it from `DBG` without the keypress, and
  `DBG.showPaths` still forces the routes on by itself.
- **`localStorage.removeItem('softfall.profile')`** re-stages a first launch: the display-name
  prompt only opens itself while `PROFILE.named()` is false, so a machine that has answered it
  once will never show it again. `DBG.PROFILE` is the store and `DBG.openNamePanel(first)` opens
  the panel either way (`true` = the SKIP variant). See
  [architecture.md](architecture.md#profilejs).
- **`POST /shot`** in [tools/serve.js](../../tools/serve.js#L14) writes a base64 PNG body to `shot.png` in the
  repo root, for a headless driver doing `canvas.toDataURL()` → POST. Nothing in the client calls
  it; `shot.png` is gitignored.

The server itself needs no configuration: `PORT` overrides the default 8471, `.claude/launch.json`
sets `autoPort` so a second session previews alongside an already-running one, and it sends
`Cache-Control: no-store`, so a plain refresh always picks up an edit.

**Test off `file://`, not just off the server.** `node tools/serve.js` hides a whole class of bug: the
game is played by double-clicking [index.html](../../index.html), where `fetch` and XHR are
blocked against the page's own folder. Point the driver at the repo's own
`file:///.../index.html?seed=N` for anything that loads an asset — the sampled sound layer was dead
there for two rounds while every served check passed.

**Audio** is verifiable from outside too, and needs to be — headless Chrome has no speakers, and
"I can't hear it" has several completely different causes that are indistinguishable by ear.
- **`SFX got/want` in the info stack (F3) answers it first**, red when anything is missing — no
  console needed. `SFX.banked()` is the same tally, and `SFX.debug()` adds the context state, the
  three dials and the per-file errors. An **empty bank** means nothing downloaded (the console
  carries one warning naming the first failure); a **populated bank** means the cue is wired
  wrong, mixed too low, or a dial is at zero.
- **Which dial is zero matters.** The SOUNDS bus carries the synth cues too, so `sfxVol: 0` kills
  *every* sound effect, old and new, while the music plays on — whereas an empty bank kills only
  the sampled half and leaves the old synth cues audible. "I hear the menu clicks but no new
  sounds" and "I hear nothing but music" are different faults; do not treat them as one.
- `SFX.meter()` is the peak on the SOUNDS bus right now. Poll it every 25 ms around a cue and take
  the maximum: world cues should land at **0.3–0.7**, the synth UI blips at 0.15–0.18. Anything
  under ~0.12 is inaudible in play, which is how a third of the bank was caught sitting at
  0.05–0.15 before `trim()` levelled it ([Audio](gameplay.md#audio)). The meter costs nothing
  until first called.
- `SFX.music.current` names the track the state machine thinks should be sounding, and
  `SFX.music.el(key)` hands out the live `<audio>` element: seek it to `duration - 0.6` to prove
  the `jump → foxglove → silence` chain in seconds instead of nine minutes. `duration` is only
  finite because [tools/serve.js](../../tools/serve.js) answers Range requests — a plain 200 makes an element
  treat a multi-MB mp3 as an unbounded stream.
- For the ESC panel, `DBG.settingsRows` and `DBG.muteBtnRect()` give the row anchors and the
  speaker's plate, so a driver can click a dial through the real pointer instead of guessing at
  the 14 px pitch.

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

**Adding a carried item** — one `ITEMS` entry (`icon`, `stack`) is the storage half: the bag,
the drop pickup, the death spill and the refusal tell are all generic over that table. What is
*not* generic and must be written per item: an 8×8 icon sprite beside `itemBerry`, a colour in
`RES_COLORS` for the pickup floater, the sprite branch in the drop draw pass, whatever *makes*
the item, and what using it does — `bagClick` maps a cell click onto an input flag, so a new
item needs its own branch there or clicking its cell will just deny. Gold is **not** an `ITEMS`
entry and must not become one: it is a wallet number with no ceiling.
See [gameplay.md](gameplay.md#inventory-and-the-backpack).

**Adding a stored profile field** — the field goes in `blank()` in
[js/profile.js](../../js/profile.js) *and* in the repair loop `PROFILE.load()` runs over an
existing save, or an old profile reaches its readers without it. Give it an accessor on the
`PROFILE` object rather than letting callers reach into `PROFILE.get()`, and pick a write policy:
`saveNow()` for something the player just chose, `scheduleSave()` for anything the sim writes
mid-match. Nothing outside that file may name a storage key.

**Adding a tool** — append to `TOOLS` with a `TOOL_*` index constant, add an 8×8 icon sprite
and name it in the entry's `icon` field, map the object types it works in `workTarget()`
(that is the only selection logic — there are no keys or bar slots), and give its `key`
behavior in `hitObject()`'s gating.

**Adding an ability or input** — it belongs to *every* slot, not to the local player. Add the
field to `makeInput()`, fill it for the human in `sampleHumanInput()` (edge-triggered flags are
set by the event handlers and cleared by the sim), consume it in `updatePlayer(p, dt)`, and give
bots a way to use it in `updateAI()`. If only one player can have the result, queue it through
`contest()`. See [multiplayer.md](multiplayer.md). **A modifier key is a trap**: Ctrl+W, Ctrl+T
and Ctrl+N are reserved above the page and `preventDefault()` cannot stop them, so a modifier
bound as a *held* state that the player uses alongside WASD will close their tab. Bind it as a
tap that toggles, and drop `e.repeat` — a held modifier auto-repeats.

**Adding something that hunts a player** — a new enemy, a new building, anything that decides it
can see a slot — asks `seenAt(p, range)`, never a bare distance against a bare range. That one
function is where GHOSTSTEP and lying buried in the snow both live, and a hunter that skips it
stares straight through the cover with nothing in the code to say why. If it also *marks* the
player somewhere the player can read (a map dot, an icon), gate that on
`concealOf(p) >= PRONE_MAP` the way both maps do. See
[gameplay.md](gameplay.md#prone-under-the-snow).

**Adding a way to hurt a player** — pass the attacker as `damagePlayer`'s `src` (or, when the
world did it, a `DEATH_CAUSE` key as `cause`). Miss it and the kill is uncredited on the TAB
scoreboard and the event feed reports the death as an accident. See
[multiplayer.md](multiplayer.md#kills-and-the-event-feed).

**Adding a stump-built structure** — add a `STRUCTS` entry (3 tiers) and its wheel slot in
`STRUCT_ORDER` (the **build** wheel draws the local team's `SPRITES.teamBuild[team][type][0]` or,
for a sprite too big to be its own 16×16 icon — see the Keep, the bay, the turret — a dedicated
entry in `teamBuild[team].icon`, and sizes itself: a sixth entry is six even wedges, no layout to
touch), a grid baked into the per-team `teamBuild` sets (see [sprites.md](sprites.md)), and both
map colour tables (`updateMinimap`/`buildWorldMapImg` — both resolve a multi-tile footprint's
`part` fillers through `structOf()` first, so one branch on the real type colours the whole
building, but the branch itself is still hand-written per type; skip it and a new type silently
draws as a bare stump). `isSolidTile()` is now generic (`!!STRUCTS[o.type] || ...`) — a new
`STRUCTS` entry is automatically solid for free, and only a genuinely new *non-`STRUCTS`* scenery
type needs a line there. `hitObject()`, the draws pass (via `structSprite`), construction,
ownership and refunds already dispatch on `STRUCTS[o.type]` too — no per-type work there, and
nothing to add unless the type does something once built (a functional tick branch in
`updateStructures()`, e.g. the generator's payout timer or the Keep's craft queue).
**The manage wheel is a separate, hand-built list, not generic over `STRUCT_ORDER`** — this bit
the Keep's "queue card" order and is worth remembering for the next one: `wheelOptions()` only
ever returns `[upgrade, (a spawner's mode / a keep's craft), demolish]`, so a structure with its
own extra manage-wheel order needs a line there (and a matching `runCmd()` branch), regardless of
how automatic the *build* wheel's sizing is.

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

**Adding a sound** — drop the file in `audio/sfx/`, **run `node tools/bake-sfx.js`** (this is not
optional: without it the clip works when served and is silently dead when `index.html` is opened
off the disk, which is how the game is actually played), add it to `SAMPLES` in
[js/audio.js](../../js/audio.js) (a key may list several files; one is picked per shot), and write
the cue as `name() { if (smp('key', {...})) return; ...synth line... }`. **The synth line is not
optional** — `smp` returns false until the file has decoded, and a cue with nothing behind it is
silent on the first swing of every session. `trim()` levels the file for you, so pick `vol` as a
mix against the other cues, not against the file's own loudness — then check it with `SFX.meter()`
(0.3–0.7 for a world cue) rather than by ear, because these clips arrive 20 dB apart. Set `dur` if
the clip holds more than one hit; several of the existing files are a whole loop padded to a fixed
length. World cues gate on `nearPlayer(x, y)` so a remote base cannot spam the mix; cues only the
local slot should hear gate on `p === player`. A cue on a repeating tick (`building()` on a
site's dust timer) needs a wide `jitter` and a `gap`, or it settles into a rhythm.
See [Audio](gameplay.md#audio).

**Adding a song** — one `TRACKS` entry in [js/audio.js](../../js/audio.js) (`f`, `loop`, `vol`,
and `next` if it should chain into another when it ends), then one `SFX.music.play('key')` at the
transition that owns it. Nothing polls for the right track: `play()` no-ops when its key is
already current, so it is safe to call from a state change that repeats.

**Tuning balance** — the numbers live inline: `STRUCTS` costs/HP/build times (plus turret
range/dmg/rate, generator pay/period, bay bot count/HP and its `w`/`h` footprint, the Keep's
`craftCost`/`craftT` and its per-tier rarity `odds`; the roll-out
cadence is inline in `updateStructures()`'s spawner branch), `RESPAWN_TIME` (the flat respawn
timer beside `die()`), the `CARDS` table (every card's effect, by rarity) and `pick3Distinct`'s
draw-3 rule, the `YIELD` table (every gold
payout), `WORK_REACH`, `BOW_CHARGE`, and the
momentum constants (`ICE_MAX`, `SLIDE_MIN`/`SLIDE_EXIT`, `TRAIL_MIN`) in the constants banner,
the per-surface steer/decay rates inline in `updatePlayer()`'s movement block,
the slot count (`MAX_PLAYER_SLOTS`) and the bot ranges (`AI_SIGHT`, `AI_HUNT`, `AI_FORAGE`),
the arrow speed/damage formulas in `fireArrow()`,
`TREE_RARE_CHANCE` in `treeRare()`, and the darkness ramp in
`update()`.

## Known drift

- [README.md](../../README.md) is a storefront page (hero + mechanic shots in `docs/media/`), not a
  tech guide. It carries the one-line "double-click `index.html`" and links into
  [game.md](game.md) / [architecture.md](architecture.md); the controls list and the code layout
  stay in the root [CLAUDE.md](../../CLAUDE.md) and these dev docs.
- **Every shot in `docs/media/` predates the free-for-all** — they are solo-survival captures from
  the original storefront, so there is no image of a team colour, a Keep, a worker bot, a fish net
  or a landmark. The README copy was rewritten in `PATCH 1.54` to describe the current game *around
  what those seven shots actually show*, which is why the wildlife cells carry the economy and the
  newer pillars sit in text below the table. New captures would let the table carry them instead.
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
  the single-currency change (no ore object, no wood/stone drops or HUD counters). They are now
  one `ITEMS` entry each away from being carryable, should a resource ever return.
- `SFX.nightSting` in [js/audio.js](../../js/audio.js) is unreferenced since the raider removal
  (`SFX.monsterDie` is live again — every animal death plays it).
- `audio/music/` is now exactly the six files `TRACKS` names — the alternate takes and album art
  that sat beside them (34 MB, nothing loading them) were deleted in `PATCH 1.53`; recover one with
  `git show ee284a0:"audio/music/<name>"` if a cue ever wants it. A track is live only once it is in
  `TRACKS`. `tools/serve.js`'s `.ogg`/`.wav` MIME rows are forward-looking — every asset in the repo
  is an mp3.
- The `tracers` pass is kept working but has no trigger — it went idle with the raiders. The
  **turret is live** (it shoots enemy players and worker bots) but it does not use `tracers`: it
  fires a travelling bolt through the `arrows` array, so the `tracers` pass still has nothing
  pushing to it. Wolves are hostile but only to players.
  Worker bots take arrows from any rival, the turret bolts that were already aiming at them, and
  now a rival worker's axe on an attack [flag](gameplay.md#worker-flags) — but the AI's target
  picker still ignores them: a bot slot only downs a worker by accident, with a shot meant for a
  player. Buildings are not immune either: a **player** on another team breaks one with E, and a
  worker on a siege flag does the same through the same `hurtStruct` (see
  [Base building](gameplay.md#base-building)), but no wildlife does, and arrows and bolts pass
  buildings without damaging them.
- **AI slots never plant a worker flag.** `p.flag` exists on every slot and the whole dispatch is
  slot-generic, but only `sampleHumanInput`'s middle-click writes one, so a bot's bay gathers the
  way it always did. Teaching `updateAI` to plant one is the obvious next move and needs no new
  plumbing.
