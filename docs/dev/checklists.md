# Checklists

Step-by-step lists for the changes that touch many places at once, plus the intentionally dead
code you should not "clean up".

## Verifying a change

The rule is in [CLAUDE.md](../../CLAUDE.md): look at the running game, don't re-read the code and
declare victory. The three affordances:

- **`window.DBG`** (end of [js/boot.js](../../js/boot.js)) — read the object literal for the
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
  It also draws the **pink centre column** down every player, animal, robot and building
  ([hbMid](rendering.md#the-centre-column-hbmid)) — the only way to see whether an overhead frame
  is square with the sprite it belongs to, since the true middle of an even-width sprite is a pixel
  boundary and being three pixels out is invisible without it.
  It draws in every mode, `settings.hitbox` sets it from `DBG` without the keypress, and
  `DBG.showPaths` still forces the routes on by itself.
- **`localStorage.removeItem('softfall.profile')`** re-stages a first launch: the display-name
  prompt only opens itself while `PROFILE.named()` is false, so a machine that has answered it
  once will never show it again. `DBG.PROFILE` is the store and `DBG.openNamePanel(first)` opens
  the panel either way (`true` = the SKIP variant). See
  [architecture.md](architecture.md#profilejs).
- **The [tech tree](gameplay.md#the-tech-tree) needs no staging** — every kind is unlocked for
  every profile, so `DBG.LOOT_POOL` is the same on a fresh install as on a played-in one, and
  reading it back is how you prove what a match may drop. `DBG.wipeTech()` still forgets which
  kinds this profile has *held*, which is all the page's blue pips are.
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

A page that loads the same script set as index.html, stages through `DBG` and POSTs the canvas is enough to
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

**Adding an object type** — one `OBJECTS` entry in [js/world.js](../../js/world.js) is most of
it: `solid` (does it block a walker), `tool` (what E reaches for) and `ready` (whether it is worth
reaching *right now* — the bush's berries), `needs` (the tool a swing must already be holding,
null = any), `verb` and `lift` (the E key prompt), and `mm`/`map` (the colour each of the two maps
paints it — an `[r, g, b]`, or a `(o, i, h)` function when it is not a constant, as the tree's
canopy and the bush's berries are not). `isSolidTile()`, `workTarget()`, `hitObject()`'s tool
gate, `drawWorkHint()`, `updateMinimap()` and `buildWorldMapImg()` all read that one entry and
need no edit — none of them names a type any more. An object *instance* carrying a `team` field
(the roosting eagles' hitbox tiles) is a rival-only E target — `workTarget()` applies that
generically, the same rule buildings answer through `ownsStruct`.

What is still per-type and has to be written by hand: the sprite branch in the flat pass or the
`draws` y-sort in `render()` (the draw *order* is one ordered function on purpose — see
[rendering.md](rendering.md)), what a swing actually **does** to it in `hitObject()` (its
particles, its sounds, what it leaves behind), and a pass of its own in `renderLighting` if it
glows — there is no light registry to add it to
([rendering](rendering.md#light-and-weather)). A **building**
is not an object type: it is a `STRUCTS` entry in [js/structures.js](../../js/structures.js),
which carries the same `mm`/`map` pair and gets solidity, both maps and the E prompt for free.

**Adding a carried item** — one `ITEMS` entry (`icon`, `stack`, plus `heal` if it is food) is the storage half: the bag,
the drop pickup, the death spill, the drag and the refusal tell are all generic over that table.
What is *not* generic and must be written per item: an 8×8 icon sprite (bake it beside its own
code, not in the byte-fragile js/sprites.js — see `bakeGrid` in js/tools.js and `CHEST_SPR`), a
colour in `RES_COLORS` for the pickup floater, whatever *makes* the item, and what using it does —
`bagClick` maps a cell click onto an input flag, so a new item needs its own branch there or
clicking its cell will just deny (`sendBagCell` runs first and handles only the two kinds that
have somewhere to *go*, a bit and a tool) — and a branch in `tipStack` (the `tooltips` banner, js/ui.js) or
hovering it says only its raw type name. **A new FOOD is the one item that is already generic**:
give its `ITEMS` row a `heal` and it picks up the meal channel, the shared clock, the cell/strip
wipe and the tooltip rows for free (`startEat`, js/core.js — see
[Food](gameplay.md#food-the-meal-is-a-channel)); it still needs its own key or `bagClick` branch. The drop draw pass and the bag cell both centre an icon
on its own width, so a 12×12 needs no branch. Gold is **not** an `ITEMS` entry and must not become
one: it is a wallet number with no ceiling. See
[gameplay.md](gameplay.md#inventory-and-the-backpack).

**Adding a weapon (a tool) or a bit** — both are one entry in `TOOLS` / `BITS`
([js/tools.js](../../js/tools.js)); the loop at the foot of that file registers the `ITEMS` and
`RES_COLORS` rows, so storage, drops, the death spill, the drag, the click that sends it between
pack and weapon, and the loot pools all pick it up
with no other edit. A **tool** needs `rof`/`cap`/`tensile`/`tier` and an `art` key — reuse one of
the three 12×12 silhouettes in `TOOL_ART` (it is baked once per tier) or add a fourth. A
**projectile bit** needs `weight`/`path`/`solid`/`ff`/`life`/`speed`/`dmg`/`stick`/`col` and an
8×8 grid in `BIT_ART`; a **modifier bit** needs `proj: false` and a `mod(m)` that edits the
envelope in `toolMods` — and, because cells fold in whatever order they sit in, that `mod` must
write order-independent values (a max or a set, never a multiply of what is already there), or two
of them in one tool give different tools depending on which cell holds which. Both need a `name`
and a `blurb` — the tooltip prints them, and they are the only words the kind ever gets. A modifier
that carries a **damage type** sets `m.type` (see `DMG_TYPES`, js/actions.js) and the arrow carries
it to `hurtUnit` with no per-kind code; add its numbers to `tipBit`'s modifier branch, which reads
them back out of `toolMods` rather than restating them.

**It also needs a `TECH` node**, or the tech screen never shows it — the loot pool rolls it either
way, since the pool is every kind at or under a tier, but a kind missing from the page is a kind
nobody can read the numbers of. Give it a `req` naming the node beneath it (null only on the
tier-0 row), and keep each lineage to a root plus at most two children — the tech screen's 7×3 grid
derives its rows from `TECH` and a fourth column would draw off the page. The screen and its
tooltip both follow from that one row.

A brand-new `path` is the only thing that is not table-driven: it needs a
branch in `steerBit`, and a body of its own in the shots pass (`drawTumbler`/`drawMote`,
js/render.js) if the arrow silhouette would misread it — plus a line in `drawAimLine`'s honesty
rule, which refuses to draw a straight line for a path that does not fly straight.

**Adding a class** — the tables make most of it mechanical, and every screen picks the new
entry up with no edit: the select roster grows a portrait (the column wraps right past
`SEL_P_PER`), the strip, the gear pop-up's preview/ledger and the bot class hash
(`initPlayers`, already `floor(hash × CLASSES.length)`) are all generic over the tables. What a
new class needs written:

1. a `CLASSES` entry ([js/player.js](../../js/player.js)) — `name` and the `kit` numbers are
   the load-bearing halves;
2. the full sprite set in the byte-fragile [js/sprites.js](../../js/sprites.js) —
   4 directions × 3 frames plus the 5-pose prone set, baked into `SPRITES.champ[c]` per team
   via the `TEAM_SKINS` bakes ([sprites.md](sprites.md)) — **this is the expensive part**;
3. a `CLASS_AB` row of four actives ([js/abilities.js](../../js/abilities.js)): each ability's
   `cd`/`cast`/`blurb`/`use(p)` (plus `acol`/`activeF` if a state runs on the body), its
   `abilityPose` case, any world entities it leaves and their tick/draw, and its on-body draw
   in `drawAbilityOnPlayer` if it leaves a visible state;
4. four detailed 32×32 icons in `AB32` (on `AB32_PAL` — one palette across every big icon);
5. a 32×32 class **emblem** in `CLASS32` ([js/menu.js](../../js/menu.js), same palette) — the
   symbolic mark the select roster reads the class by;
6. a `CLASS_LOADOUT` entry ([js/tools.js](../../js/tools.js));
7. a fight rung in `updateAI` ([js/ai.js](../../js/ai.js)) that spends the four keys at the
   ranges the kit is good at — the class branch there is per-class content and the one `if`
   that must grow.

**Adding a stored profile field** — the field goes in `blank()` in
[js/profile.js](../../js/profile.js) *and* in the repair loop `PROFILE.load()` runs over an
existing save, or an old profile reaches its readers without it. Give it an accessor on the
`PROFILE` object rather than letting callers reach into `PROFILE.get()`, and pick a write policy:
`saveNow()` for something the player just chose, `scheduleSave()` for anything the sim writes
mid-match. Nothing outside that file may name a storage key.

**Adding a swing tool** (the axe/pick family that E brings out — *not* a weapon, which is the
entry above) — append to `SWING_TOOLS` with a `SWING_*` index constant, add an 8×8 icon sprite and
name it in the entry's `icon` field, map the object types it works in `workTarget()` (that is the
only selection logic — there are no keys or bar slots), and give its `key` behavior in
`hitObject()`'s gating.

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

**Adding a way to hurt anything** — call `hurtUnit(e, dmg, nx, ny, src, o)`, never `damagePlayer` /
`hurtAnimal` / `hurtRobot` directly, and put a state on a body with its setter (`stunUnit`,
`rootUnit`, `slowUnit`, `netUnit`, `markUnit`, `igniteUnit`). One call, and a slot, a deer and a
worker bot all take it; the three per-kind functions under `hurtUnit` exist for what is genuinely
per-kind and are not the entry point. For an **area** effect sweep `unitsHit(src, x, y, r)` (a blow:
i-framed slots dropped) or `unitsNear` (a lasting ground condition, which is not dodged by having
just taken a hit) rather than writing a loop per kind — that loop is exactly how wildlife and bots
fall out of a feature. Still pass the attacker as `src` (or, when the world did it, a `DEATH_CAUSE`
key as `o.cause`): miss it and the kill is uncredited on the TAB scoreboard and the event feed
reports the death as an accident. A **new damage type** is one row in `DMG_TYPES`; if it lingers on
the body the way `fire` does, it also needs a `DOT_CAUSE` key, or every bite is eaten by the 0.7 s
of i-frames the previous one granted. See
[gameplay.md](gameplay.md#status-effects-one-set-for-every-unit) and
[multiplayer.md](multiplayer.md#kills-and-the-event-feed).

**Adding a kind of unit (neutral fauna included)** — a new thing that walks and can be hit is
pushed into `animals` (neutral: give it no `team`, and `unitFoe` makes it fair game to everyone) or
`robots` (sided). What it gets for free, with no edit at the call sites: every class ability, the
roll sweep, every bit the left button fires, all six status effects, and the four on-body tells.
What it must do to get them:

1. build it through a maker that calls **`clearUnitStatus(e)`** (as `makeAnimal`/`makeRobot` do),
   or it has no status fields and the setters write onto a body nothing reads;
2. run **`updateUnitStatus(e, dt)`** at the top of its own update, and bail if the burn killed it —
   a corpse must not then take a step;
3. move through **`navStep`** (which spends `unitMoveMul`), or fold `unitMoveMul(e)` in by hand if
   it steers itself the way a bird's flight and a bot's loiter do — otherwise nothing slows it;
4. call **`drawUnitStates(e, px, py, w, h, now)`** in its draw pass, or its states are invisible and
   unplayable-around;
5. join `separateUnits`, `UNIT_MASS` and `unitRadius` (see the CLAUDE.md rule), and give it a hit
   test the way `animalHit`/`robotHit` do — that is the one thing the arrow loop asks per kind.

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
shipwreck: { name, tag,           // what both maps and the arrival toast print
             count, r, surface,   // how many, footprint radius in tiles, 'snow' | 'ice'
             mark, icon,          // map ink; the glyph is [x,y,w,h] rects in a 7x7 box
             pop, repop,          // inhabitants kept alive, seconds between top-ups
             gen(L), spawnOne(L) } // stamp the objects (in worldgen); add one inhabitant (after)
```

The abandoned mine, frozen fort, shipwreck and shop are meant to land here. Nothing in the maps
or the HUD needs to learn about it. What *does* cost work: any **new object type** its
`gen` stamps (the checklist above), any **new kind of inhabitant** its `spawnOne` pushes into
`animals` (a `kind` branch in `updateAnimal`, hp in `ANIMAL_HP`, a `HIT_PUFF` colour, a payout in
`animalDies`, `UNIT_MASS` + `unitRadius` if it is solid, a hover box in `cursorInfo`, and — if it
can hurt a player — a `DEATH_CAUSE` key), and rolling **only** through `lmRng`, never `rng`.

**Adding a ground type** — extend `paintGroundTile()`, `updateMinimap()`, and `buildWorldMapImg()`,
give it a surface branch in `updatePlayer()`'s momentum block (steer/decay/target rates — ice is
the template; a ground that should walk like snow needs none, because only ice and holes are
special-cased — packed earth, ground 3, is that precedent), and remember `genWorld()`'s `free()`
helper treats "ground must be 0" as the placement rule — as do `tryProne` (snow to dig into) and
the footprint emitter. Check `fishWater()` too: it names the swimmable grounds outright.

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
draw-3 rule, the `YIELD` table (every gold payout, the one table still in core.js), the chest
count/spacing/payout (`CHEST_*` above `placeChests()` in js/world.js),
`WORK_REACH` and the roll/prone blocks in js/actions.js, `BOW_CHARGE` and the
momentum constants (`ICE_MAX`, `SLIDE_MIN`/`SLIDE_EXIT`, `TRAIL_MIN`) in js/player.js above
`CHAMPS`, the per-surface steer/decay rates inline in `updatePlayer()`'s movement block,
the slot count (`MAX_PLAYER_SLOTS`, js/player.js) and the bot ranges (`AI_SIGHT`, `AI_HUNT`, `AI_FORAGE`),
the `TOOLS` and `BITS` tables and the loot rates (`ROCK_DROP`/`TREE_DROP`/`CHEST_TOOL`/`LOOT_TOOL`)
in js/tools.js, the flight-path constants beside `steerBit`, the damage roll in `emitBit()`,
`TREE_RARE_CHANCE` in `treeRare()`, the darkness ramp in
`update()`, the `WIND_*` block in js/sim.js (the three ripples, the bend that meanders them, the
gust envelope's floor and peak, and how fast it all dies at dusk) and the
`CLOUD_*` / `RAY_*` / `NIGHT_*` / `STAR_*` blocks in the
`light & weather` banner of js/draw-world.js (including `RAY_AFTER` / `RAY_NOON_HALF`, which decide
how long the sun shafts are up for), and `FLAKE_BASE` / `FLAKE_MIN` / `FLAKE_MAX` beside the flake
block in js/sim.js. Several of those bake at LOAD, so a change to them needs a reload rather than
just a repaint: `bakeCloud`'s `lo`/`hi` ramp, its `CLOUD_CURVE` / `CLOUD_GAIN` contrast shaping and
`CLOUD_TINT` (all three baked into both cloud textures), the beam texture `RAY_CV`, and
the speck atlases `MOTE_CV` / `STAR_CV` / `FLAKE_CV` (colour and shape are baked in; only the alpha
that picks a level is live).

**Moving code between js files** — the game files share one global scope
([architecture.md](architecture.md#shared-global-scope)); these rules stand for any move.
Move whole sections **verbatim** — no renames, no reformatting, no "while I'm here" fixes
(intentional dead code stays; see Known drift). Cut banner-boundary to banner-boundary, re-located
fresh with `grep -n "// ------" js/*.js`, never by remembered line numbers. Before committing:
grep all files for duplicate top-level names (a duplicate `function` silently overwrites:
`grep -hE '^(async )?function |^(const|let|class) ' js/*.js | sed -E 's/^(async )?(function|const|let|class) ([A-Za-z0-9_$]+).*/\3/' | sort | uniq -d`
must print nothing); scan the moved code's **top-level statements** — every name a
load-time statement references must live in a file loaded above it in index.html (runtime calls
may point anywhere); never reorder existing `<script>` tags; and update the docs in the same
commit — the architecture.md file table, code-map.md's sections, index.html's comment. Then the
full browser pass off both
the served URL and `file://`. Use a CRLF-preserving editor (the repo is CRLF; `sed -i` mangles it
here), and **never rewrite js/sprites.js** — it has a UTF-8 BOM and byte-fragile grids.

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
- A tree's `variant` (rolled by `randi(0, 1)` in `genWorld`) picks no art any more: there is one
  pine in sixteen wind frames, and `treeFrame` reads the tile's own `hash2` for the frame it rests
  on. **The roll has to stay** — removing an `rng()` call inside `genWorld` reshuffles every
  existing seed. `deadTree` still uses its `variant` for real.
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
- `SWING_TOOLS[SWING_BOW].icon` (`'itemBow'`) is unread since the weapon slots landed —
  `drawHeldTool` puts the *equipped* tool in the hands at rest, and only the axe and pick rows'
  icons are still resolved through the table. The row is kept so `SWING_TOOLS` stays one entry per
  `p.swing` value, and `SPRITES.itemBow` itself is live on the end screen's kills plate.
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
  Worker bots take arrows from any rival, the turret bolts that were already aiming at them, a
  rival worker's axe on an attack [flag](gameplay.md#worker-flags), and now every class ability and
  the roll like any other body — but the AI's target picker still ignores them: a bot slot only
  downs a worker by accident, with a shot meant for a player. Buildings are not immune either: a
  **player** on another team breaks one with E, and a worker on a siege flag does the same through
  the same `hurtStruct` (see [Base building](gameplay.md#base-building)), but no wildlife does, and
  arrows and bolts pass buildings without damaging them.
- **A structure is not a unit, and neither is the roosting eagle.** Everything in
  [status effects](gameplay.md#status-effects-one-set-for-every-unit) — damage types, fire, the six
  states — is for bodies that walk. A building has an hp pool and `hurtStruct`; the eagle is an
  objective with `hurtEagle` and a ceremony of its own. A flaming shot that hits either does its
  impact damage and nothing more: neither burns. That is deliberate, not an oversight — but it is
  the obvious next place fire could go, and it would need a burn clock and a draw pass on each.
- **The AI does not play around the new states.** `updateAI` reads no `burnT`, `netT` or `rootT`,
  so a bot on fire does not break off and a netted one does not change its mind. Everything lands
  on them correctly; nothing reacts to it yet.
- **AI slots never plant a worker flag.** `p.flag` exists on every slot and the whole dispatch is
  slot-generic, but only `sampleHumanInput`'s middle-click writes one, so a bot's bay gathers the
  way it always did. Teaching `updateAI` to plant one is the obvious next move and needs no new
  plumbing.
