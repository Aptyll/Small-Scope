# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Emberfrost — a browser canvas pixel-art winter survival game. Gather by day, build a camp, keep
fires lit; raiders pour out of the central gold mine each night, and every night is harder.

## Keeping this file current

**Treat CLAUDE.md as part of the deliverable.** When a change alters something this file
describes, update the affected section in the same turn as the code change — don't leave it for
later and don't append a changelog at the bottom. Edit the section that already covers the topic;
add a new one only when the change introduces a genuinely new subsystem.

Changes worth recording include: a new object type, buildable, ground type, resource, or enemy;
new or rebound keys and input handling; new state on `state`/`settings`/`player`; a new render
pass, overlay, or offscreen canvas; a change to the day/night, cold, lighting, or difficulty
formulas; anything that adds a cross-file invariant like `rebuildLights()`; and any change to how
the game is run or verified. Balance tweaks to existing numbers, sprite pixel edits, and pure
refactors that preserve the described structure do not need an entry.

Also fold in durable working preferences and project constraints the user states in conversation,
and prune anything here that a change has made false — including entries under
[Known drift](#known-drift) once they are fixed. A stale line in this file is worse than a
missing one, because future sessions act on it without re-verifying.

## Commands

```
node serve.js          # static server + screenshot sink on http://localhost:8471
```

There is no build step, no package manager, no dependencies, no test suite, and no linter.
Editing a `js/*.js` file and reloading the page is the whole dev loop (`Cache-Control: no-store`
is set, so a plain refresh always picks up changes). `.claude/launch.json` runs the same server.

### Verifying changes

Two dev affordances exist for driving the game from outside the browser:

- `window.DBG` (end of [js/game.js](js/game.js#L2065)) exposes the live `state`, `player`, `inv`,
  `raiders`, `objects`, `lights`, `mouse`, `keys` plus `placeObj`, `spawnRaider`, `startGame`,
  `setHotbar`, `clickAction`, and `step(dt, n)` — which runs `n` fixed-`dt` update ticks and one
  render. Set `DBG.freeze = true` to stop the rAF loop and step deterministically. Use this to
  stage a scene (place structures, jump `state.day`/`state.time`, spawn raiders) instead of
  playing to reach it.
- `POST /shot` in [serve.js](serve.js#L14) writes a base64 PNG body to `shot.png` in the repo
  root. Nothing in the client calls it; it is there for a headless driver doing
  `canvas.toDataURL()` → POST. `shot.png` is not gitignored — don't commit it.

## Architecture

Four IIFEs loaded in a fixed order by [index.html](index.html), communicating only through
globals. Order matters: each file's globals must exist before the next runs.

| File | Exposes | Role |
| --- | --- | --- |
| [js/font.js](js/font.js) | `drawPixelText`, `drawPixelTextShadow`, `pixelTextWidth` | 3×5 bitmap font, glyphs as 15-char strings; uppercase only, unknown chars render as `?` |
| [js/sprites.js](js/sprites.js) | `SPRITES` | every sprite as a char-grid + palette map, baked to offscreen canvases at load |
| [js/audio.js](js/audio.js) | `SFX` | WebAudio synth; no asset files |
| [js/game.js](js/game.js) | `DBG` | everything else — worldgen, sim, render, UI |

`game.js` is one ~2100-line IIFE with no internal module boundaries; it is organized by banner
comments (`// ---- constants / rng / state / world / actions / raiders / update / render / UI /
boot`). All game state lives in module-scope singletons: `state`, `settings`, `player`, `inv`,
`hotbar`, and the arrays `raiders`, `drops`, `particles`, `floaters`, `footprints`, `lights`.

### Fixed-resolution pixel rendering

The canvas is always 480×270 internally (`VIEW_W`/`VIEW_H`). `fitCanvas()` picks an integer CSS
scale so pixels stay square. **All game logic and drawing works in the 480×270 space** — mouse
coords are divided by `scale` on the way in. Round positions when drawing (`Math.round`) or
sprites smear across subpixels.

### The tile world

- `WORLD = 192` tiles of `TILE = 16` px → a 3072×3072 px world.
- `ground` — `Uint8Array(192*192)`: `0` snow, `1` ice, `2` mine plaza.
- `objects` — flat `Array(192*192)`, **at most one object per tile**. Every object is
  `{ type, tx, ty, hp, flash, shake, ...extra }`. Types: `tree`, `stump`, `rock`, `bush`,
  `goldore`, `mine`, `wall`, `spike`, `torch`, `fire`.
- Index with `idx(tx, ty)`, read safely with `objAt`, create with `placeObj`. Deleting is
  `objects[idx] = null` (structures should go through `destroyStructure` so lights rebuild).
- The 2×2 `mine` occupies four tiles that each carry a `part` index; only `part === 0` is drawn.

`renderGround()` pre-renders the *entire* 3072×3072 ground to one offscreen canvas at boot and
the frame loop just blits the camera window out of it. It is a one-time cost — never call it per
frame, and note that ground tiles cannot change at runtime without re-rendering.

### Determinism and noise

- `rng` is a single seeded `mulberry32(20260819)` stream shared by worldgen *and* runtime effects
  (particle bursts, raider stats, drop velocities). Worldgen is reproducible only because it runs
  first at boot. **Adding or removing any `rng()` call inside `genWorld()` reshuffles the whole
  world**; adding one after boot does not.
- `hash2(x, y)` and `vnoise(x, y)` are pure position hashes independent of `rng` — use these for
  anything that must stay stable per tile (ground texture, panel mottling, map dithering).

### Day/night, cold, and the night wave

`DAY_LEN = 110`, `NIGHT_LEN = 55`, so a full `CYCLE` is 165 s. `state.time` runs within the cycle,
`state.day` increments at wrap. `update()` derives `state.darkness` (0→1) from a hand-written
ramp: dusk over the last 12 s of day, full dark, then a 10 s dawn.

Everything else keys off `state.darkness`, not `state.time`:

- `darkness > 0.65` opens the night wave — `toSpawn = min(22, 3 + (day-1)*2)` raiders that climb
  out of the mine at the world centre, trickled in by `spawnTimer`.
- `darkness < 0.3` ends it and **deletes every living raider** (`raiders.length = 0`).
- Cold accrues when `darkness > 0.5` and `warmthAt(player) < 0.15`, and at 100 it drains HP.

Difficulty scales purely off `state.day`: raider HP `24 + (day-1)*7`, speed, contact damage
`8 + day`, and wave size. Fresh gold ore respawns at the fixed `oreSpots` each dawn.

### Lighting and warmth are the same list

`lights` is rebuilt from scratch by `rebuildLights()`, which scans all 36,864 tiles for `fire` and
`torch`. Each entry has `r` (visual radius) and `warm` (gameplay warmth radius). **Any code that
adds or removes a light-emitting object must call `rebuildLights()`** or both the glow and the
warmth go stale. `warmthAt(x, y)` is the gameplay half; `renderLighting()` punches the same lights
out of a dark overlay on the offscreen `lightCv` using `destination-out`, then `drawWarmGlows()`
adds `multiply` colour grading plus a `lighter` core.

### Render pass order

`render()` runs: ground blit → footprints → flat objects (spikes, stumps) → build ghost → item
drops → **y-sorted `draws` array** (tall objects + player + raiders, sorted by feet Y) → particles
→ swing arc → floaters → `renderLighting` → `renderWeather` → `renderVignettes` → `renderUI` →
map/settings/title/death overlays. Anything that should be occluded by trees goes into `draws`
with a sort key; anything flat goes in the pre-pass.

Sprite hit-flash goes through `drawSpriteFlash()`, which recolours via a shared 32×32 `scratch`
canvas with `source-in` — sprites larger than 32×32 will clip.

### UI panels are baked once

`buildMapPanel()` and `buildSettingsPanel()` draw the static chrome (parchment, compass, labels)
into offscreen canvases at boot; per-frame code blits them and draws only the live parts on top.
Their layout constants (`PANEL_*`, `MAP_*`, `SET_*`, `SL_X`, `ROW_*`) are shared between the bake
function and the per-frame code, so both sides move together — but a bake-side change only appears
after the panel is rebuilt.

### Death is not game over

`die()` sets `mode = 'dead'`, keeps `ceil(60%)` of each resource, and after 2.6 s `respawn()` puts
the player next to the nearest surviving campfire (world centre if none). `state.mode` is
`title | play | dead`; `updatePlay()` is skipped entirely while paused, dead, or with the map or
settings overlay open, but `update()` (time, darkness, spawn timers, camera, fx) keeps running.

### Settings

`settings` (`volume`, `mmR`, `shake`, `muted`) persists to `localStorage['emberfrost.settings']`.
`applyMinimapSize()` must be called after changing `mmR` — it recomputes `MM_R`/`MM_CX`/`MM_CY`,
which the resource row in `renderUI()` also positions itself against.

### Audio

`SFX` creates its `AudioContext` lazily inside `ensure()`. Browsers require a user gesture, so
`SFX.unlock()` is called from click handlers — any new entry point that plays sound before the
first click needs to call it too.

## Working on sprites

Sprites are literal ASCII grids paired with a palette object mapping character → hex (or `null`
for transparent), baked by `bake()` at load. Left-facing variants are `flipH()` of the right ones.
Character sprites are 16×16; the player and raiders share the exact same grids with different
palettes (`PPAL` vs `RDPAL`), so a pose edit changes both.

`js/sprites.js` has a UTF-8 BOM and one heart row that repairs a mangled byte via
`'...'.replace('о', 'g')`. Preserve the file's encoding when editing — re-saving it as something
else will corrupt the grids.

## Checklists for common changes

**Adding an object type** — touch all of: `isSolidTile()` (if it blocks), `hitObject()` (what a
swing does to it), the flat pass or the `draws` y-sort in `render()`, `updateMinimap()`'s colour
table, `buildWorldMapImg()`'s colour table, and `rebuildLights()` if it glows. The two map colour
tables are the easy ones to forget — a missing entry silently draws as a stump.

**Adding a buildable** — append to `BUILDS` (index = hotbar slot; 5 slots are hard-coded in the
`1`–`5` key handler, the wheel modulo, and the hotbar loop in `renderUI()`), add a sprite, add its
icon in the hotbar loop, add it to the ghost-preview sprite lookup in `render()`, give it a branch
in `hitObject()` and in `updateRaider()`'s blocked-tile attack check, and note that
`canAfford`/`pay` only understand `wood` and `stone`.

**Adding a ground type** — extend `renderGround()`, `updateMinimap()`, and `buildWorldMapImg()`,
and remember `genWorld()`'s `free()` helper treats "ground must be 0" as the placement rule.

**Tuning balance** — the numbers live inline: `BUILDS` costs/HP, `spawnRaider()` stat formulas,
the `state.day` terms in `updateRaider()`, cold rates in `updatePlay()`, and the darkness ramp in
`update()`.

## Known drift

- [README.md](README.md) is out of date: it says **M** mutes and calls the enemies "frost imps"
  that spawn from darkness. The code binds **M** to the world map and **N** to mute, and the
  enemies are player-shaped `raiders` emerging from the central gold mine. `SPRITES.imp` is still
  baked but no longer referenced anywhere in `game.js`.
- `state.lastFire` is assigned in `tryPlace()` and never read.
- `updateRaider()` checks for a blocking `torch`, but `torch` is not in `isSolidTile()`, so that
  branch is unreachable — torches are walked over rather than attacked.
