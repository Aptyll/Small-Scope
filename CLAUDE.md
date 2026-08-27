# CLAUDE.md

Softfall: a browser canvas 2D top-down pixel-art cozy survival free-for-all on a winter map. Six
slots over four teams, dropped in by eagle; a team's Keep is its way back, and last team standing
wins. **Read [docs/dev/game.md](docs/dev/game.md) before proposing a feature or judging whether
one fits** — that is the design in one page. This file is only the rules.

## Commands

```
node tools/serve.js          # static server + screenshot sink on http://localhost:8471
node tools/bake-sfx.js       # audio/sfx/*.mp3 -> js/sfxdata.js; rerun after changing a clip
```

**Double-clicking [index.html](index.html) has to work** — nothing may depend on being served. A
`file://` page cannot `fetch` its own folder, which is why `tools/bake-sfx.js` inlines the sound
effects; an asset loaded any other way is silently dead off the disk. `tools/serve.js` is only the
screenshot sink and headless driving. No package manager, dependencies, tests or linter; editing a
`js/*.js` file and reloading is the whole dev loop, and the baker's output is committed.

**Verify changes in the browser, not by re-reading code.** `window.DBG` (end of
[js/game.js](js/game.js)) exposes the live singletons and stages a scene without playing to it,
`?seed=N` pins the world, `POST /shot` ([tools/serve.js](tools/serve.js#L14)) sinks the canvas to
`shot.png`, and **`.`** toggles hitboxes and routes: [checklists](docs/dev/checklists.md#verifying-a-change).

## Deep docs

Read the relevant one **before** working in that area — they carry the detail this file omits.

| Working on | Read |
| --- | --- |
| what the game *is* — the pillars, and what it deliberately is not | [docs/dev/game.md](docs/dev/game.md) |
| camera, zoom, a draw pass, HUD, baked panels, cursor, lighting, the main menu | [docs/dev/rendering.md](docs/dev/rendering.md) |
| worldgen, tiles, ground, determinism/RNG, day/night, ice holes and fish, landmarks | [docs/dev/world.md](docs/dev/world.md) |
| movement, bow and tools, dodge, wildlife, wolves and birds, economy, building, robots, settings, audio | [docs/dev/gameplay.md](docs/dev/gameplay.md) |
| player slots, champions and kits, the input struct, teams, AI bots, contested orders, PvP | [docs/dev/multiplayer.md](docs/dev/multiplayer.md) |
| sprite grids and palettes | [docs/dev/sprites.md](docs/dev/sprites.md) |
| adding an object/tool/structure/ground type/landmark, tuning balance, intentional dead code | [docs/dev/checklists.md](docs/dev/checklists.md) |
| the file layout, load order, what each file exposes, `tools/` | [docs/dev/architecture.md](docs/dev/architecture.md) |
| splitting game.js into files — the approved migration playbook | [docs/dev/split-plan.md](docs/dev/split-plan.md) |
| which banner / function in game.js owns a thing | [docs/dev/gamejs-map.md](docs/dev/gamejs-map.md) |

## Architecture

Five legacy files — `profile.js`, `font.js`, `sprites.js`, the generated `sfxdata.js`,
`audio.js` — keep their IIFEs and expose fixed `window` globals; after them the game code is
**flat top-level classic scripts sharing one global scope** (fifteen files so far plus the
`game.js` residual; the split is in progress — [split-plan](docs/dev/split-plan.md)).
[index.html](index.html) loads them in a fixed order and they communicate **only through
globals**, so each file's globals must exist before the next loads. The file table and the
shared-scope mechanism: [architecture](docs/dev/architecture.md).

**`js/profile.js` is the only file that touches `localStorage`** — the local player profile (name,
lifetime stats, and the settings that live under it). Everything else goes through `PROFILE`, so
putting the profile on a server stays a one-file change; never read or write a storage key
directly.

All game state lives in module-scope singletons — `state`, `settings`, `players` (`player`/`inv`
point at the local slot and its gold-only wallet; carried goods are `player.bag`) — plus the arrays
`animals`, `arrows`, `drops`, `particles`, `floaters`, `footprints`, `lights`, `structures`, `robots`, `fish`, `landmarks`.

`game.js` is ~2800 lines of flat top-level code organized only by `// ------ name` banners.
**Keep every banner honest**, and find any function by its banner in
[docs/dev/gamejs-map.md](docs/dev/gamejs-map.md) — read it before grepping blind. Adding a landmark is one `LANDMARKS` entry + `LANDMARK_ORDER`:
[checklists](docs/dev/checklists.md#common-changes).

## Versioning

**Every commit pushed to main bumps the patch by 0.01** — `PATCH_TXT` in [js/game.js](js/game.js),
same commit, before the push; it prints bottom-right of the title screen, so a screenshot carries
its build. The same commit tops `PATCH_NOTES` with **one sentence**: plain English, uppercase.

## UI rule: show, don't label

**Communicate through visuals and visual indicators wherever possible; avoid lengthy text
explanations.** An icon beside a number, an arrow that is clickable, a colour that carries the
team, a plank that lifts on hover — not "CLICK OR ARROWS TO SWAP", not "PLAYERS LEFT: 5". A
control must read as what it does by its shape and its hover state alone, and if you catch
yourself writing a hint sentence, build the affordance instead. Text is for names, numbers,
headlines (a death, a landmark) and three deliberate carve-outs: **keybind indicators** (`'ESC
BACK'`, a "1" in a slot's corner), the **settings panel**'s labelled rows, and **first-run
onboarding** (the two `showMsg` teaching lines). Anything else that wants words is a design bug.

## Hard rules

Cross-file invariants — breaking one produces a bug that looks unrelated to its cause. The test
for a line belonging here: **would you break it without ever having reason to open the deep doc?**
If not, it lives in `docs/dev/*.md` beside the code it protects.

- **Canvas size changed?** Call `fitCanvas()` **then** `relayout()` — both paths (window resize,
  `fullscreenchange`) do. Never write layout against a literal 480/270; the view is `VIEW_W`×`VIEW_H`.
- **Zoom scales the world, never the UI.** `render()` draws the world into `worldCv` at
  `WV_W`×`WV_H`, blits it in device px, then draws the UI in `VIEW_W`×`VIEW_H` under a `devScale`
  transform, so the HUD is one size at every zoom. A **world** pass bounds itself against `WV_*`;
  cross between spaces only through `mouseWX()`/`mouseWY()` and `wToSX()`/`wToSY()`.
- **The zoom the player rests at is a whole number of device px per world px** (`kWant`; the
  wheel steps it by 1). Anything that sets the zoom goes through that rung, or the pixel grid
  stops being uniform and sprites look stretched.
- **Screen position is `round(world − camera)`, rounded exactly once.** Statics subtract the
  rounded `ox`/`oy`; moving entities subtract the exact `ex`/`ey` and round at the end. Rounding
  camera and entity separately makes sprites vibrate ±1 px against the background while walking.
- **Text over the world uses `drawPixelTextOutline`** (a 1px dark rim on all sides, opaque colour);
  `Shadow` is for text on panels and planks, and for anything under a `globalAlpha` fade. White
  pixel text on white snow with only a drop shadow is unreadable.
- **Runtime ground change?** Call `repaintGround(tx, ty)` — it repaints the tile plus its four
  neighbours into the prerendered ground canvas. Never call `renderGround()` per frame; it bakes
  the entire 3712×3712 world and is a boot-time cost.
- **Added or removed a light-emitting object?** Call `rebuildLights()`.
- **Units are solid to each other.** `separateUnits()` runs once per sim step after every mover has
  stepped; a new kind of thing that walks must join its list (and `UNIT_MASS`, and be marked `small`
  unless a roll should stop on it) or it walks through everyone. A player mid-roll is the exception:
  it skips contact with a small unit, because `rollSweep` turns that contact into a hit instead.
- **Anything that walks to a goal routes there** through `navTo`/`navStep` (the `pathfinding`
  banner), never by steering straight at it, and **drops the goal when they return `ok = false`**
  (no route, or pinned) — there are no stuck timers; a caller that ignores `ok` stands still forever.
- **A loop over `players` that touches the world must skip `inAir(p)`** (riding or falling from the
  eagle) alongside `!p.active`/`p.dead` — arrows, drops, wildlife, the draw list and both maps all do.
- **Gold never goes straight into `p.inv.gold`** — every payout calls `gainGold(p, n)`, which is
  also the XP source; a direct `+=` earns no levels.
- **Anything deciding it can see a player asks `seenAt(p, range)`**, never a bare range — that one
  function is where GHOSTSTEP and burial live (both maps gate on `concealOf(p)`).
- **Anything a player does takes a `p` and reads `p.input`**, never `keys`/`mouse` (local slot only),
  and anything only one of them can get (a work swing, a build, a drop, a fish) goes through
  `contest()`, which picks the winner from (SEED, player id, `state.tick`).
- **Never add or remove an `rng()` call inside `genWorld()`** — it reshuffles every existing seed
  (hence landmarks' own `lmRng`). Use `hash2`/`vnoise` per tile, never before the `SEED` const.
- **At most one object per tile.** Create with `placeObj`, read with `objAt`, and route structures
  through `placeStruct`/`destroyStructure` so the registry and lights stay in sync. A building with
  `w`/`h` in `STRUCTS` (the bot bay, 3×2) fills its other tiles with `part` objects pointing at the
  anchor — **read one off a tile with `structOf(objAt(...))`**, create/remove only via
  `createStruct`/`removeStruct`.

## Keeping the docs current

**The docs are part of the deliverable.** When a change makes a line in this file or in
`docs/dev/*.md` false, fix it in the same turn as the code change — a stale line is worse than a
missing one, because future sessions act on it without re-verifying. Prune
[Known drift](docs/dev/checklists.md#known-drift) entries once fixed; what is worth recording at
all: [checklists](docs/dev/checklists.md#what-is-worth-recording).

**Keep this file under ~150 lines** — it loads in full at the start of every session, and rule
adherence drops as it grows. Anything derivable by reading the code belongs in `docs/dev/*.md`,
which costs nothing until opened. Move a section out rather than thinning every section into mush.
