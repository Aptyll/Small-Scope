# CLAUDE.md

Softfall: a browser canvas 2D top-down pixel-art cozy survival free-for-all on a winter map.

- Always-in-hand bow; **E** harvests and breaks *enemy* buildings (axe/pickaxe come out on their own); build on stumps.
- Momentum is the movement: slippery frozen rivers, chained dodges, shift-sliding.
- **Gold is the only currency. Gold = XP** (levels 1→9 via `gainGold`). Berries and fish are food.
- **Gear**: 4 pieces × 3 variants (`GEAR` table), piece levels 1–4 bought with gold from anywhere
  (keys 1–4 / the HUD plates); the sim reads champions *and* gear only through `kitOf(p)`.
- 6 slots in `players` (slot 0 = you, the rest AI), four team colours, two champions (WREN, SKADI — a look + a kit via `kitOf(p)`).
- Everyone rides in on a white eagle and jumps (Space) to land. **Death is final** — spectate or back to
  the lobby. The **last team standing** wins (`rivalCount`, not a head count) and gets the victory screen.
- The world has named **landmarks**: a WOLF DEN (the only hostile wildlife) and a ROOKERY (birds).
- Night is mostly visual, but not inert: wolves see ×1.75 further at full dark and the only passive heal stops (`darkness < 0.3`).

## Commands

```
node serve.js          # static server + screenshot sink on http://localhost:8471
```

No build step, no package manager, no dependencies, no test suite, no linter. Editing a `js/*.js`
file and reloading the page is the whole dev loop (`Cache-Control: no-store` is set, so a plain
refresh always picks up changes). `PORT` overrides the port; `.claude/launch.json` sets
`autoPort`, so a second session can preview alongside an already-running server.

**Verify changes in the browser, not by re-reading code.** Three affordances drive it from
outside: `window.DBG` (end of [js/game.js](js/game.js)) exposes the live singletons and stages a
scene without playing to it, `?seed=N` pins the world so two screenshots are comparable, and
`POST /shot` ([serve.js](serve.js#L14)) sinks `canvas.toDataURL()` to `shot.png` for a headless
driver — never commit that file. How to use all three:
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

Four IIFEs loaded in a fixed order by [index.html](index.html), communicating only through
globals. Order matters: each file's globals must exist before the next runs.

| File | Exposes | Role |
| --- | --- | --- |
| [js/font.js](js/font.js) | `drawPixelText`, `drawPixelTextShadow`, `drawPixelTextOutline`, `pixelTextWidth` | 3×5 bitmap font, uppercase only, unknown chars render as `?`. **Text over the world uses `Outline`** (1px dark rim on all sides, opaque colour); `Shadow` is for text on panels/planks |
| [js/sprites.js](js/sprites.js) | `SPRITES` | every sprite as a char-grid + palette map, baked to offscreen canvases at load |
| [js/audio.js](js/audio.js) | `SFX` | WebAudio synth; no asset files |
| [js/game.js](js/game.js) | `DBG` | everything else — worldgen, sim, render, UI |

All game state lives in module-scope singletons — `state`, `settings`, `players` (with `player` /
`inv` pointing at the local slot and its wallet) — plus the
arrays `animals`, `arrows`, `drops`, `particles`, `floaters`, `footprints`, `lights`,
`structures`, `robots`, `fish`, `landmarks`.

`game.js` is one ~8700-line IIFE organized only by `// ------ name` banners. **Keep every banner
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

**Communicate through visuals and visual indicators wherever possible; avoid text labels and
explanatory text.** An icon beside a number, an arrow that is clickable, a colour that carries the
team, a plank that lifts on hover — not "CLICK OR ARROWS TO SWAP", not "PLAYERS LEFT: 5". Text
is for names, numbers and the rare headline (a death, a landmark), and a control must read as
what it does by its shape and its hover state alone. If you catch yourself writing a hint
string, build the affordance instead.

## Hard rules

Cross-file invariants — breaking one produces a bug that looks unrelated to its cause.

- **Canvas size changed?** Call `fitCanvas()` **then** `relayout()` — every path (window resize,
  `fullscreenchange`, camera zoom, the eagle drop's `DROP_ROWS` view via `applyView()`) goes through both. Never write layout code against a literal
  480/270; the view is `VIEW_W`×`VIEW_H`.
- **Screen position is `round(world − camera)`, rounded exactly once.** Statics subtract the
  rounded `ox`/`oy`; moving entities subtract the exact `ex`/`ey` and round at the end. Rounding
  camera and entity separately makes sprites vibrate ±1 px against the background while walking.
- **Runtime ground change?** Call `repaintGround(tx, ty)` — it repaints the tile plus its four
  neighbours into the prerendered ground canvas. Never call `renderGround()` per frame; it bakes
  the entire 3712×3712 world and is a boot-time cost.
- **Added or removed a light-emitting object?** Call `rebuildLights()`.
- **Units are solid to each other.** `separateUnits()` runs once per sim step after every mover
  has stepped and pushes overlapping players/animals/robots apart; a new kind of thing that walks
  must be added to its list (and to `UNIT_MASS`) or it will walk through everyone.
- **Anything that walks to a goal routes there** through `navTo`/`navStep` (the `pathfinding`
  banner), never by steering straight at it, and **drops the goal when they return `ok = false`**
  (no route, or pinned) — there are no stuck timers; a caller that ignores `ok` stands still forever.
- **A loop over `players` that touches the world must skip `inAir(p)`** (riding or falling from the
  eagle) alongside `!p.active`/`p.dead` — arrows, drops, wildlife, the draw list and both maps all do.
- **Gold never goes straight into `p.inv.gold`** — every payout calls `gainGold(p, n)`, which is
  also the XP source; a direct `+=` earns no levels.
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
