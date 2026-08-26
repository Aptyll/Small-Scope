# CLAUDE.md

Softfall: a browser canvas 2D top-down pixel-art cozy survival free-for-all on a winter map.

- **Arrows are finite** on an always-in-hand bow, and spent shafts stick in the snow for anyone.
  **E** harvests and breaks enemy buildings, **Ctrl** goes prone and the snow covers you, and
  momentum is the movement — ice, chained dodges, and **a roll is a hit**.
- **Gold is the only currency, and gold = XP.** You carry a 10-cell backpack (`p.bag`); **gear**
  is 4 pieces × 3 variants bought from anywhere. Berries and fish are food.
- 6 slots in `players` (slot 0 = you, the rest AI), four teams, two champions, all dropped in by
  eagle. **A team's Keep is its way back** — no living Keep = permadeath — and crafts rarity-rolled
  **roguelike cards**. **Last team standing wins.**
- **An ice hole is a build site** for the one water building, a **fish net**, over a live fish
  population. **Hold middle mouse to aim your one worker flag, release to plant** — *what it sits
  on is the order*. Named **landmarks**: a WOLF DEN (the only hostile wildlife) and a ROOKERY.

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
| camera, zoom, a draw pass, HUD, baked panels, cursor, lighting, the main menu | [docs/dev/rendering.md](docs/dev/rendering.md) |
| worldgen, tiles, ground, determinism/RNG, day/night, ice holes and fish, landmarks | [docs/dev/world.md](docs/dev/world.md) |
| movement, bow and tools, dodge, wildlife, wolves and birds, economy, building, robots, settings, audio | [docs/dev/gameplay.md](docs/dev/gameplay.md) |
| player slots, champions and kits, the input struct, teams, AI bots, contested orders, PvP | [docs/dev/multiplayer.md](docs/dev/multiplayer.md) |
| sprite grids and palettes | [docs/dev/sprites.md](docs/dev/sprites.md) |
| adding an object/tool/structure/ground type/landmark, tuning balance, intentional dead code | [docs/dev/checklists.md](docs/dev/checklists.md) |
| which banner / function in game.js owns a thing | [docs/dev/gamejs-map.md](docs/dev/gamejs-map.md) |

## Architecture

Four IIFEs plus one generated data file, loaded in a fixed order by [index.html](index.html) and communicating only through globals — each file's globals must exist before the next loads.

| File | Exposes | Role |
| --- | --- | --- |
| [js/font.js](js/font.js) | `drawPixelText`, `drawPixelTextShadow`, `drawPixelTextOutline`, `pixelTextWidth` | 3×5 bitmap font, uppercase only, unknown chars render as `?`. **Text over the world uses `Outline`** (1px dark rim on all sides, opaque colour); `Shadow` is for text on panels/planks |
| [js/sprites.js](js/sprites.js) | `SPRITES` | every sprite as a char-grid + palette map, baked to offscreen canvases at load |
| [js/sfxdata.js](js/sfxdata.js) | `SFXDATA` | **generated** — `audio/sfx/*.mp3` as base64, built by `node tools/bake-sfx.js`. Rerun it after any change to `audio/sfx/` |
| [js/audio.js](js/audio.js) | `SFX` | three layers: a WebAudio synth for UI blips *and* as the fallback under every cue, one-shot samples out of `SFXDATA`, and `SFX.music` streaming `audio/music/`. Master / MUSIC / SOUNDS dials — see [gameplay](docs/dev/gameplay.md#audio) |
| [js/game.js](js/game.js) | `DBG` | everything else — worldgen, sim, render, UI |

All game state lives in module-scope singletons — `state`, `settings`, `players` (`player`/`inv`
point at the local slot and its gold-only wallet; carried goods are `player.bag`) — plus the arrays
`animals`, `arrows`, `drops`, `particles`, `floaters`, `footprints`, `lights`, `structures`, `robots`, `fish`, `landmarks`.

`game.js` is one ~12000-line IIFE organized only by `// ------ name` banners. **Keep every banner
honest**, and find any function by its banner in [docs/dev/gamejs-map.md](docs/dev/gamejs-map.md) —
read it before grepping blind. Adding a landmark is one `LANDMARKS` entry + `LANDMARK_ORDER`:
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

Cross-file invariants — breaking one produces a bug that looks unrelated to its cause.

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
- **Anything drawn through `drawSpriteFlash()` must fit in 64×64** — it recolours through a shared
  64×64 scratch canvas and larger sprites clip.
- **[js/sprites.js](js/sprites.js) has a UTF-8 BOM** and **seven** rows repairing a mangled byte via
  `.replace()` (`stump`, `imp1`×2, `wall`×2, `heartHalf`, `heartEmpty`) — preserve its encoding.

## Keeping the docs current

**The docs are part of the deliverable.** When a change makes a line in this file or in
`docs/dev/*.md` false, fix it in the same turn as the code change — edit the section that already
covers the topic, and prune what the change made false, including
[Known drift](docs/dev/checklists.md#known-drift) entries once fixed. A stale line is worse than a
missing one, because future sessions act on it without re-verifying. What is worth recording:
[checklists](docs/dev/checklists.md#what-is-worth-recording).

**This file loads in full at the start of every session — keep it under ~150 lines.** It is a
system prompt, not a knowledge base: every line costs context in *every* session, and rule
adherence drops as it grows. Anything derivable by reading the code belongs in `docs/dev/*.md`,
which costs nothing until opened. When this file outgrows the budget, move a section out rather
than thinning every section into mush.
