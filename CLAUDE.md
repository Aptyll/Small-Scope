# CLAUDE.md

Softfall: a browser canvas 2D top-down pixel-art cozy survival free-for-all on a winter map.

- Always-in-hand bow, but **arrows are finite**: a `QUIVER_MAX` quiver, a per-shot renock cooldown
  (`kit.nock`), slow fletching, and every spent arrow sticks in the snow as a `shafts` entry
  anyone can walk over. **E** harvests and breaks *enemy* buildings (axe/pickaxe come out on their own); build on stumps.
- **A cracked-open ice hole is a build site too** (`buildSiteAt`, two pickaxe hits): its wheel
  offers the one `water: true` building, a **fish net** — walked *on*, fishes by itself, and gives
  its catch to whoever stands on it, enemies included. The shoal is a live population, fished down
  and refilled by fish swimming in from under the snow (`born`/`vis`):
  [world](docs/dev/world.md#ice-holes-and-fishing).
- Momentum is the movement: slippery frozen rivers, chained dodges, shift-sliding. **A roll is a
  hit** scaled by the speed it carries: through anything small (one swipe + stun each), a
  both-sides tackle into anything big.
- **Ctrl goes prone** (a tap, never a hold — Ctrl+W closes the tab): lie still on snow and it covers
  you. You crawl at `PRONE_SPEED`, and the arrow loosed out of *full* cover hits for `AMBUSH_MUL`
  and breaks it.
- **Gold is the only currency. Gold = XP** (levels 1→9 via `gainGold`; a skill point each level, spent on the four abilities). Berries and fish are food.
- **What you carry is in slots**: one **backpack** (`p.bag`, 10 cells, a stack each), **B** to open.
  A full bag *refuses* a pickup; only `bagAdd`/`bagTake`/`bagRoom` touch it.
- **Gear**: 4 pieces × 3 variants (`GEAR` table), piece levels 1–4 bought with gold from anywhere
  (keys 1–4 / the HUD cells); the sim reads champions *and* gear only through `kitOf(p)`. Pack,
  gear and gold are **one frame** bottom-right — see [rendering](docs/dev/rendering.md).
- 6 slots in `players` (slot 0 = you, the rest AI), four team colours, two champions (WREN, SKADI — a look + a kit via `kitOf(p)`).
- Everyone rides in on a white eagle and jumps (Space) to land. **A team's Keep is its way back**:
  build one (5th wheel option, one per team) and a downed teammate respawns there on a flat,
  gold-free timer instead of staying out; **no living Keep = permadeath**, same as before a team
  had one. A team is eliminated only once it has no living players *and* no Keep
  (`teamInMatch`/`checkLastStanding`) — the **last team standing** wins and gets the victory
  screen. A finished Keep also crafts rarity-rolled **Roguelike Cards** for gold (`STRUCTS.keep`,
  `startCraft`); opening one from the bag drafts a permanent pick-1-of-3 buff (`CARDS`,
  `state.draft`) folded into `kitOf(p)` like gear.
- **Hold middle mouse to aim your one worker flag, release to plant** (`p.flag`, also off the M
  chart) and every worker bot you own obeys it. *What it sits on is the order* (`flagResolve`): cut
  here / clear a lane out to here / guard this / siege that / hunt them / march and hold — so
  workers got an axe. The preview is a **held gesture, never a resting state** (`state.flagAim`):
  nothing about the flag is on screen otherwise. No flag = the old bay gather, and the bay's mode
  toggle is gone.
- The world has named **landmarks**: a WOLF DEN (the only hostile wildlife) and a ROOKERY (birds).
- Night is mostly visual, but not inert: wolves see ×1.75 further at full dark and the only passive heal stops (`darkness < 0.3`).

## Commands

```
node serve.js          # static server + screenshot sink on http://localhost:8471
node bake-sfx.js       # audio/sfx/*.mp3 -> js/sfxdata.js; rerun after changing a clip
```

**Double-clicking [index.html](index.html) has to work** — that is how the game is played, so
nothing may depend on being served. A `file://` page cannot `fetch` its own folder, which is why
`bake-sfx.js` inlines the sound effects; a new asset loaded any other way is silently dead off the
disk. `serve.js` is for the screenshot sink and headless driving, not a requirement.

No package manager, no dependencies, no test suite, no linter; `bake-sfx.js` is the only build
step and its output is committed. Editing a `js/*.js` file and reloading the page is the whole dev
loop (`Cache-Control: no-store` is set, so a plain refresh always picks up changes). `PORT`
overrides the port; `.claude/launch.json` sets `autoPort`, so a second session can preview
alongside an already-running server.

**Verify changes in the browser, not by re-reading code.** Four affordances drive it from
outside: `window.DBG` (end of [js/game.js](js/game.js)) exposes the live singletons and stages a
scene without playing to it, `?seed=N` pins the world so two screenshots are comparable, and
`POST /shot` ([serve.js](serve.js#L14)) sinks `canvas.toDataURL()` to `shot.png` for a headless
driver — never commit that file, and in the game itself **`.`** toggles the hitboxes the sim
tests and the routes every walker is following. How to use all four:
[checklists](docs/dev/checklists.md#verifying-a-change).

## Deep docs

Read the relevant one **before** working in that area — they carry the detail this file omits.

| Working on | Read |
| --- | --- |
| camera, zoom, a draw pass, HUD, baked panels, cursor, lighting, the main menu | [docs/dev/rendering.md](docs/dev/rendering.md) |
| worldgen, tiles, ground, determinism/RNG, day/night, ice holes and fish, landmarks | [docs/dev/world.md](docs/dev/world.md) |
| movement, bow and tools, dodge, wildlife, wolves and birds, economy, building, robots, settings, audio | [docs/dev/gameplay.md](docs/dev/gameplay.md) |
| player slots, champions and kits, the input struct, teams, AI bots, contested orders, PvP | [docs/dev/multiplayer.md](docs/dev/multiplayer.md) |
| sprite grids and palettes | [docs/dev/sprites.md](docs/dev/sprites.md) |
| adding an object/tool/structure/ground type/landmark, tuning balance, intentional dead code | [docs/dev/checklists.md](docs/dev/checklists.md) |
| which banner / function in game.js owns a thing | [docs/dev/gamejs-map.md](docs/dev/gamejs-map.md) |

## Architecture

Four IIFEs plus one generated data file, loaded in a fixed order by [index.html](index.html) and
communicating only through globals. Order matters: each file's globals must exist before the next.

| File | Exposes | Role |
| --- | --- | --- |
| [js/font.js](js/font.js) | `drawPixelText`, `drawPixelTextShadow`, `drawPixelTextOutline`, `pixelTextWidth` | 3×5 bitmap font, uppercase only, unknown chars render as `?`. **Text over the world uses `Outline`** (1px dark rim on all sides, opaque colour); `Shadow` is for text on panels/planks |
| [js/sprites.js](js/sprites.js) | `SPRITES` | every sprite as a char-grid + palette map, baked to offscreen canvases at load |
| [js/sfxdata.js](js/sfxdata.js) | `SFXDATA` | **generated** — `audio/sfx/*.mp3` as base64, built by `node bake-sfx.js`. Rerun it after any change to `audio/sfx/` |
| [js/audio.js](js/audio.js) | `SFX` | three layers: a WebAudio synth for UI blips *and* as the fallback under every cue, one-shot samples out of `SFXDATA`, and `SFX.music` streaming `audio/music/`. Master / MUSIC / SOUNDS dials — see [gameplay](docs/dev/gameplay.md#audio) |
| [js/game.js](js/game.js) | `DBG` | everything else — worldgen, sim, render, UI |

All game state lives in module-scope singletons — `state`, `settings`, `players` (with `player` /
`inv` pointing at the local slot and its gold-only wallet; carried goods are `player.bag`) — plus the
arrays `animals`, `arrows`, `drops`, `particles`, `floaters`, `footprints`, `lights`,
`structures`, `robots`, `fish`, `landmarks`.

`game.js` is one ~10000-line IIFE organized only by `// ------ name` banners. **Keep every banner
honest**, and find any function by its banner in [docs/dev/gamejs-map.md](docs/dev/gamejs-map.md) —
read it before grepping blind. Adding a landmark is one `LANDMARKS` entry + `LANDMARK_ORDER`:
[checklists](docs/dev/checklists.md#common-changes).

## Versioning

**Every commit that is pushed to main bumps the patch number by 0.01** — `PATCH_TXT` next to
`MENU_ITEMS` in [js/game.js](js/game.js) (`PATCH 1.01` → `PATCH 1.02`), in the same commit, before the
push. It prints bottom-right of the title screen, so a screenshot carries its build. The same
commit adds **one sentence** to the top of `PATCH_NOTES` (right below `PATCH_TXT`) — plain English,
uppercase, the biggest change only, no matter how large the patch; clicking the tag opens them.

## UI rule: show, don't label

**Communicate through visuals and visual indicators wherever possible; avoid lengthy text
explanations.** An icon beside a number, an arrow that is clickable, a colour that carries the
team, a plank that lifts on hover — not "CLICK OR ARROWS TO SWAP", not "PLAYERS LEFT: 5". Text
is for names, numbers, short keybind indicators (a "1" in a slot's corner) and the rare headline
(a death, a landmark), and a control must read as what it does by its shape and its hover state
alone. If you catch yourself writing a hint sentence, build the affordance instead.

## Hard rules

Cross-file invariants — breaking one produces a bug that looks unrelated to its cause.

- **Canvas size changed?** Call `fitCanvas()` **then** `relayout()` — both paths (window resize,
  `fullscreenchange`) go through both. Never write layout code against a literal
  480/270; the view is `VIEW_W`×`VIEW_H`.
- **Zoom scales the world, never the UI.** `render()` draws the world into `worldCv` at
  `WV_W`×`WV_H`, blits it in device px, then draws the UI in `VIEW_W`×`VIEW_H` space under a
  `devScale` transform — so the HUD is the same size at every zoom. A **world** pass bounds
  itself against `WV_*`; a pointer becomes a world point only through `mouseWX()`/`mouseWY()`,
  and a world point becomes a UI point only through `wToSX()`/`wToSY()`.
- **The zoom the player rests at is a whole number of device px per world px** (`kWant`; the
  wheel steps it by 1). Anything that sets the zoom goes through that rung, or the pixel grid
  stops being uniform and sprites look stretched.
- **Screen position is `round(world − camera)`, rounded exactly once.** Statics subtract the
  rounded `ox`/`oy`; moving entities subtract the exact `ex`/`ey` and round at the end. Rounding
  camera and entity separately makes sprites vibrate ±1 px against the background while walking.
- **Runtime ground change?** Call `repaintGround(tx, ty)` — it repaints the tile plus its four
  neighbours into the prerendered ground canvas. Never call `renderGround()` per frame; it bakes
  the entire 3712×3712 world and is a boot-time cost.
- **Added or removed a light-emitting object?** Call `rebuildLights()`.
- **Units are solid to each other.** `separateUnits()` runs once per sim step after every mover
  has stepped and pushes overlapping players/animals/robots apart; a new kind of thing that walks
  must be added to its list (and to `UNIT_MASS`, and marked `small` unless a roll should stop on
  it) or it will walk through everyone. A player mid-roll is the one exception: it skips every
  contact with a small unit, because `rollSweep` turns that contact into a hit instead.
- **Anything that walks to a goal routes there** through `navTo`/`navStep` (the `pathfinding`
  banner), never by steering straight at it, and **drops the goal when they return `ok = false`**
  (no route, or pinned) — there are no stuck timers; a caller that ignores `ok` stands still forever.
- **A loop over `players` that touches the world must skip `inAir(p)`** (riding or falling from the
  eagle) alongside `!p.active`/`p.dead` — arrows, drops, wildlife, the draw list and both maps all do.
- **Gold never goes straight into `p.inv.gold`** — every payout calls `gainGold(p, n)`, which is
  also the XP source; a direct `+=` earns no levels.
- **Anything that decides it can see a player asks `seenAt(p, range)`**, never a bare range — that
  one function is where GHOSTSTEP and lying buried in the snow live, and both maps gate on
  `concealOf(p)`. A new hunter that skips it stares straight through the cover.
- **Anything a player does takes a `p` and reads `p.input`**, never `keys`/`mouse` (local slot only),
  and anything only one of them can get (a work swing, a build, a drop, a fish) goes through
  `contest()`, which picks the winner from (SEED, player id, `state.tick`).
- **Never add or remove an `rng()` call inside `genWorld()`** — it reshuffles every existing seed,
  which is why landmark placement rolls its own `lmRng` stream. Use `hash2`/`vnoise` for anything
  that must stay stable per tile, and never call `hash2` before the `SEED` const it closes over.
- **At most one object per tile.** Create with `placeObj`, read with `objAt`, and route structures
  through `placeStruct`/`destroyStructure` so the `structures` registry and lights stay in sync.
  A building with `w`/`h` in `STRUCTS` (the bot bay, 3×2) fills its other tiles with `part`
  objects pointing at the anchor — **read a building off a tile with `structOf(objAt(...))`**, and
  create/remove only through `createStruct`/`removeStruct`, which place and clear the footprint.
- **Anything drawn through `drawSpriteFlash()` must fit in 64×64** — it recolours through a shared
  64×64 scratch canvas and larger sprites clip.
- **[js/sprites.js](js/sprites.js) has a UTF-8 BOM** and **seven** rows that repair a mangled byte
  via `.replace()` (`stump`, `imp1`×2, `wall`×2, `heartHalf`, `heartEmpty`). Preserve the file's
  encoding or the grids corrupt.

## Keeping the docs current

**The docs are part of the deliverable.** When a change makes a line in this file or in
`docs/dev/*.md` false, fix it in the same turn as the code change — don't defer it, don't append a
changelog. Edit the section that already covers the topic; add a new one only for a genuinely new
subsystem, and prune what a change has made false, including
[Known drift](docs/dev/checklists.md#known-drift) entries once they are fixed. A stale line is
worse than a missing one, because future sessions act on it without re-verifying.

What is and is not worth recording:
[checklists](docs/dev/checklists.md#what-is-worth-recording).

**This file loads in full at the start of every session — keep it under ~150 lines.** It is a
system prompt, not a knowledge base: every line costs context and attention in *every* session,
and rule adherence drops as it grows. Detail, procedures, and anything derivable by reading the
code belong in `docs/dev/*.md`, which cost nothing until opened. Before adding a line here, ask
whether leaving it out would cause a clear mistake; if not, it belongs in a deep doc — and when
the file outgrows the budget, move a section out rather than thinning every section into mush.
