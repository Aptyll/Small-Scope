# Architecture

Which file holds what, what each one puts on `window`, and the load order that makes it work.
Read this before adding a file, moving a function between files, or wondering where a global
came from. The rules that survive in [CLAUDE.md](../../CLAUDE.md) are the ones you break without
ever opening this page; everything here is reference.

## Four legacy IIFEs, one generated data file, and the flat game code

[index.html](../../index.html) loads them in a fixed order. There is no bundler,
no module system and no import statement anywhere — **the files communicate only through
globals, so each file's globals must exist before the next one loads.** Reordering the script
tags breaks the build silently: a missing global is `undefined` at call time, not at parse time.

| File | Lines | Exposes | Role |
| --- | --- | --- | --- |
| [js/profile.js](../../js/profile.js) | ~160 | `PROFILE` | the local player profile, and the only file that touches storage |
| [js/font.js](../../js/font.js) | ~100 | `drawPixelText`, `drawPixelTextShadow`, `drawPixelTextOutline`, `pixelTextWidth` | the bitmap font |
| [js/sprites.js](../../js/sprites.js) | ~2500 | `SPRITES` | every sprite as a char-grid + palette, baked at load |
| [js/sfxdata.js](../../js/sfxdata.js) | ~40 | `SFXDATA` | **generated** — the sfx bank as base64 |
| [js/audio.js](../../js/audio.js) | ~570 | `SFX` | synth, samples and music under one master dial |
| [js/core.js](../../js/core.js) | ~250 | shared scope, no `window.*` export | the base layer: the numbers with no one owner (grid, view, day cycle, `YIELD`), the seeded rng, `state`/`settings`, the fx/economy helpers |
| [js/canvas.js](../../js/canvas.js) | ~250 | shared scope, no `window.*` export | screen + world + light buffers, `fitCanvas`, pixel-exact zoom, the panel layout anchors |
| [js/player.js](../../js/player.js) | ~760 | shared scope, no `window.*` export | the `Player` class and slots, champions/kits/gear/cards, the entity arrays, damage & death |
| [js/input.js](../../js/input.js) | ~230 | shared scope, no `window.*` export | `keys`/`mouse` and the listeners; `sampleHumanInput` folds them into the input struct |
| [js/world.js](../../js/world.js) | ~470 | shared scope, no `window.*` export | the tile grid, the `OBJECTS` table every kind of scenery is an entry in, worldgen, and the landmarks with their own `lmRng` stream |
| [js/nav.js](../../js/nav.js) | ~310 | shared scope, no `window.*` export | `moveEntity`, `separateUnits`, and A* routing (`findPath`/`navTo`/`navStep`) |
| [js/wildlife.js](../../js/wildlife.js) | ~600 | shared scope, no `window.*` export | prey, the fish shoal, the wolf pack and the rookery flock |
| [js/structures.js](../../js/structures.js) | ~500 | shared scope, no `window.*` export | the `STRUCTS` table, building/upgrading/wrecking, and the per-type building sim |
| [js/robots.js](../../js/robots.js) | ~520 | shared scope, no `window.*` export | the worker bots a bay rolls out, and the one flag per player whose tile is their standing order |
| [js/actions.js](../../js/actions.js) | ~620 | shared scope, no `window.*` export | what a player does: tools and harvesting, the roll as a hit, prone, the quiver |
| [js/ai.js](../../js/ai.js) | ~350 | shared scope, no `window.*` export | the bot brain — a priority ladder writing the same input struct a human fills |
| [js/sim.js](../../js/sim.js) | ~810 | shared scope, no `window.*` export | `update`/`updatePlay`/`updatePlayer`, the camera (`camX`/`camY`), fx aging, the snow |
| [js/draw-world.js](../../js/draw-world.js) | ~1160 | shared scope, no `window.*` export | the world's pixels: the prerendered ground, every entity's sprite pass, the flag and landmark glyphs, lighting/weather/vignettes |
| [js/render.js](../../js/render.js) | ~980 | shared scope, no `window.*` export | `render()` composes and blits the frame; the `.` debug overlays; cursor, reticle and aim line |
| [js/ui.js](../../js/ui.js) | ~1260 | shared scope, no `window.*` export | the in-match HUD: radial wheel, brackets and prompts, minimap, backpack + gear widget, hud strip, card draft |
| [js/panels.js](../../js/panels.js) | ~820 | shared scope, no `window.*` export | the TAB scoreboard + event feed, the M world map, the ESC settings slab, the PLAYER name panel |
| [js/menu.js](../../js/menu.js) | ~1200 | shared scope, no `window.*` export | the title screen: menu planks, reroll die, tutorial + patch panels, champion select, the gear screen, `PATCH_TXT` |
| [js/screens.js](../../js/screens.js) | ~1160 | shared scope, no `window.*` export | the replay window, the death overlay and spectating, the victory and defeat ceremonies |
| [js/boot.js](../../js/boot.js) | ~490 | `DBG` + shared scope | the last file to load: the eagle drop, the boot order, `window.DBG`, the rAF loop |

Line counts are approximate on purpose; they are here for a sense of scale, not to be maintained.

### Shared global scope

The game code is **not** wrapped in an IIFE (it was, until the split began — tag `pre-split`).
It is flat top-level code in classic scripts: a top-level `function` declaration becomes a
`window` property, and a top-level `let`/`const` becomes a global lexical binding visible **as a
bare identifier** to every classic script loaded after it. That is the whole splitting mechanism
— sections moved between files verbatim and bare identifiers kept resolving, with no export
lists and no namespace. ES modules are off the table because `file://` must keep working. The
split is complete; the tag `pre-split` keeps the one-file history.

- **Load-order rule**: a file may reference names from any file at runtime, but its top-level
  (load-time) statements may only reference names from files loaded above it.
- **Collision behavior**: a `let`/`const` declared in two files throws a `SyntaxError` at load
  (loud, good); a `function` declared in two files silently overwrites (silent, bad) — which is
  why the split's Gate A greps for duplicate top-level names before every commit.
- **Performance**: splitting changes nothing at runtime — same total parse, same JIT. The split
  is for maintainability, a sim/render seam, and files a session can load whole.

### profile.js

The local player profile — display name, lifetime stats (`games`, `gold`, `bestDay`) and the
`settings` object that used to live under a key of its own — as one JSON blob under
`softfall.profile`. **It is the only file in the project that touches `localStorage`**, and that
is the whole point of it: swapping the private `read()` / `write()` pair for requests turns the
local profile into a server account without touching the game code.
There are no accounts, no passwords and no sign-in, and nothing here is authoritative — a save
file is a save file.

- **`PROFILE.load()`** repairs a partial or corrupt save against a blank profile rather than
  throwing, and folds a pre-profile `softfall.settings` key in on the way past (once, then removes
  it). Boot calls it **before `loadSettings()`**, which now reads `PROFILE.settings()`.
- **`PROFILE.validate(raw)`** is the one name validator: trimmed, uppercased, `A-Z0-9` only, 16
  characters, and a basic profanity list matched after the obvious digit-for-letter swaps are
  folded out. It returns `{ ok, name }` or `{ ok: false, why }`. A stored name that no longer
  passes is dropped at load and the first-launch prompt comes back for it.
- **The stat calls coalesce.** `addGold` fires on every payout, so writes are batched behind an
  800 ms timer and flushed on `pagehide` / `visibilitychange`; `setName` and `putSettings` write
  through immediately.

The panel, the field and the title-screen tag are in panels.js, under the `player profile` banner.

### font.js

A 3×5 bitmap font, **uppercase only** — an unknown character renders as `?`, so a lowercase
string silently comes out as a row of question marks. Four exports: `drawPixelText` (plain),
`drawPixelTextShadow` (one bottom-right 1 px shadow), `drawPixelTextOutline` (a 1 px rim on all
eight sides) and `pixelTextWidth` for layout.

**Which one to use is a rendering rule, not a taste call** — text over the world uses `Outline`,
text on a panel or plank uses `Shadow`, and anything drawn under a `globalAlpha` fade must use
`Shadow` because the outline's eight overlapping passes stack unevenly. The full reasoning and
the site-by-site list is in [rendering.md](rendering.md#text-over-the-world).

`<` was added for a resolution cycle that no longer exists — see
[Known drift](checklists.md#known-drift) before deleting a glyph that looks unused.

### sprites.js

Literal ASCII grids paired with palette objects, baked to offscreen canvases by `bake()` at load.
Team colours, champions and building tiers are all palette swaps of shared grids, which is why a
pose edit propagates further than it looks. **The file has a UTF-8 BOM and seven rows repairing a
mangled byte** (one of the seven is currently a no-op) — re-saving it in another encoding corrupts
the grids silently. All of it, including which sprites share which grid: [sprites.md](sprites.md).

Anything drawn through `drawSpriteFlash()` must fit in **64×64** — it recolours through a shared
64×64 scratch canvas and larger sprites clip.

### sfxdata.js

Generated by `node tools/bake-sfx.js`, which reads `audio/sfx/*.mp3` and writes each clip into
this file as base64. **The output is committed.** It exists because a `file://` page may not
`fetch` its own folder, so without the inlined bytes every sound effect falls back to the synth
when the game is opened off the disk — which sounds exactly as it did before samples existed, and
is therefore invisible unless you are listening for it. Rerun the baker after any change to
`audio/sfx/` and before committing.

Music is deliberately **not** baked: it is ~70 MB, and an `<audio>` element streams a relative
`file://` path perfectly well — it was only ever `fetch` that was blocked.

### audio.js

Three layers under one master dial: a WebAudio synth for UI blips *and* as the fallback line
under every sampled cue, one-shot samples decoded out of `SFXDATA`, and `SFX.music` streaming
`audio/music/` through one `HTMLAudioElement` per track. Master / MUSIC / SOUNDS dials, the cue
list, the mixing targets and the track table: [gameplay.md](gameplay.md#audio).

### The game files (core.js … boot.js)

Nineteen files of flat top-level code (see [Shared global scope](#shared-global-scope)), each
organized only by `// ------ name` banners.
**Keep every banner honest.** Find any function by its banner in [code-map.md](code-map.md)
rather than grepping blind.

**A file that decides things does not also draw them.** Every one of the sim files - core, player,
input, world, nav, wildlife, structures, robots, actions, ai, sim - contains zero canvas calls;
the pixels for what they own live in draw-world.js, render.js, ui.js and panels.js. canvas.js is
the exception that proves it: it owns the buffers themselves.

**A feature's tuning constants live in the file that owns the feature**, directly above the code
that reads them — `WOLF_*` in wildlife.js, `TUR_*` in structures.js, `PRONE_*` in actions.js. Only
the numbers with no one owner stay in core.js: `TILE`/`WORLD`, the view size, the day cycle, and
the `YIELD` economy table that three files read. Adding a number for a feature means adding it
beside that feature, never here.

The one rule that constrains a move: **a const is only visible to a file that loads after the one
declaring it**, so anything read at *load time* — an object literal, a top-level loop, a `const`
initialised from another — has to be declared no later than that. Reads inside a function are
free, because every function in the game runs long after the last script tag. Two constants sit
where they do only because of this: `FISH_SPAWN_T` (core.js, because `state`'s literal reads it)
and `BOW_CHARGE`/`BOW_NOCK`/`DODGE_SPEED`/`SLIDE_MIN` (player.js, because the `CHAMPS` table
does). Each one says so in a comment; if you move a block and the console shows a
`ReferenceError` naming a constant on load, this is why.

`softfall.reroll` is the only storage key touched outside profile.js; sessionStorage by design
(write in menu.js, read in boot.js — survives the reload, not the tab).

Their only deliberate `window.*` export is `DBG`, the debug surface at the end of boot.js: live
singletons plus the helpers that stage a scene without playing to it. Read the object literal
for the current API — it is deliberately the whole external surface, and
[checklists.md](checklists.md#verifying-a-change) covers the non-obvious members.

## State

All game state lives in top-level singletons shared across the game files — `state` and
`settings` in core.js, `players`/`player`/`inv` and the entity arrays in player.js:

- **`state`** — the match: tick, day/time, darkness, mode, overlays (`state.draft`, `state.msg`).
- **`settings`** — the player's dials, persisted **under the profile** (`PROFILE.putSettings`).
- **`players`** — the six slots. `player` and `inv` are aliases for **the local slot only**
  (slot 0) and its gold-only wallet; carried goods are `player.bag`. See
  [multiplayer.md](multiplayer.md#the-slot-model).

Plus the flat arrays every pass iterates: `animals`, `arrows`, `drops`, `particles`, `floaters`,
`footprints`, `lights`, `structures`, `robots`, `fish`, `landmarks`.

## tools/

Neither script is part of the game, and nothing in `js/` may depend on either having run — except
`sfxdata.js`, which one of them writes.

- **`tools/serve.js`** — a static server on `http://localhost:8471` with a `POST /shot` sink that
  writes the canvas to `shot.png`. It answers **Range requests**, which is why music seeks work
  when served; a plain 200 makes an `<audio>` element treat a multi-MB mp3 as an unbounded stream.
  Its single `ROOT` const carries the static root, the traversal guard and the shot sink alike.
- **`tools/bake-sfx.js`** — reads `audio/sfx/`, writes `js/sfxdata.js`.
