# Rendering

Everything that draws: the camera, the pass order, the baked panels, and the pixel cursor.
Read this before touching `render()`, adding a draw pass, or changing anything positioned off
`VIEW_W`/`VIEW_H`. The hard invariants are summarised in [../../CLAUDE.md](../../CLAUDE.md).

## One-camera fullscreen pixel rendering

Every player gets the **same camera** (the SC2/League model): the view always shows
`TARGET_ROWS` (270) rows of world — a 1920×1080 fullscreen is exactly 480×270 at 4×, and other
monitors buy sharpness with their extra pixels, never zoom. There is deliberately **no
resolution setting**; camera zoom is a gameplay feature (below), not a display one.
`VIEW_W`/`VIEW_H` are `let`s set by `fitCanvas()`:

- It picks an integer **device**-pixel scale (via `devicePixelRatio`, so game pixels land
  exactly on device pixels even under fractional 125%/150% OS scaling) closest to
  `deviceH / viewRows`. `viewRows` is `TARGET_ROWS` except during the eagle drop, where
  `applyView()` swaps in `DROP_ROWS` (540) so the rider sees twice the world (the one sanctioned
  zoom-out: nobody is in the world yet, so the fairness ceiling doesn't apply). `scale` is
  fractional in CSS px and must not be floored.
- Heights that don't divide cleanly (1440p → 5×, 288 rows) **"breathe"** a few percent rather
  than letterbox or blur — the Terraria/Stardew trade. 16:9 screens always fill edge-to-edge.
- `VIEW_W` is **capped at 16:9** (`ceil(VIEW_H * 16/9)`): wider-than-16:9 monitors get pillarbox
  bars instead of extra vision — the SC2 rule. Narrower screens simply see less width. A guard
  keeps the view at least 320×240 so the UI panels always fit.
- A third canvas, `#replay`, sits *above* `#game` and carries the replay window at device
  resolution; see [Replay](#replay-the-last-four-seconds). It is the only thing drawn outside
  `#game`'s pixel grid, and the only reason is that the grid has too few pixels there.
- The bars are **themed, not black**: a second full-window canvas (`#bars`, z-order under
  `#game`, `pointer-events: none`) carries a static frost-panel frame — night slab, mottling,
  ice crystals, icicle fringes on the top and bottom edges, and an icy bevel hugging the game
  view — baked by
  `renderBars()` in the game palette. It spans `FULL_W` (the pre-cap window width in game px)
  and is deliberately darker than the world so the eye stays on the game; on ≤16:9 screens it
  is cleared and fully covered. It uses `hash2`, so it must never run before boot — it is baked
  once per canvas size by `relayout()`, never per frame, and the game never draws into it.

**Scroll-wheel camera zoom** rides on the same machinery: each `zoomStep` raises the integer
device-pixel scale by one (so every level stays pixel-perfect), zoom **out** is hard-capped at
the `TARGET_ROWS` baseline (the fairness ceiling — scrolling out never buys extra vision) and
zoom **in** at `MIN_ROWS` (150) rows, so the number of steps varies per monitor (`zoomMax`, set
by `fitCanvas()`). The wheel handler only bumps `zoomStep`; `applyView()` (first thing in
`update()`, also called directly by `beginDrop`/`landPlayer`) applies it by diffing against
`zoomEff`/`viewRows` and calling `fitCanvas()`/`relayout()` — overlays (map/settings) and non-play
modes force base zoom so the fixed-size panels always fit, restoring on close. The whole
presentation zooms, HUD included. `DBG.setZoom(n)`/`DBG.getZoom()` drive it externally. The
scroll wheel is zoom only — there is no tool selection to cycle.

**All game logic and drawing works in the `VIEW_W`×`VIEW_H` space** — mouse coords are divided
by `scale` on the way in. Round positions when drawing (`Math.round`) or sprites smear across
subpixels.

**Cross-file invariant:** any code path that changes the canvas size — window resize,
`fullscreenchange` — must call `fitCanvas()` then `relayout()`. `relayout()` recomputes
everything positioned off `VIEW_W`/`VIEW_H`: the minimap anchors, the map/settings panel
positions (`PANEL_X/Y`, `SET_X/Y`, `SL_X`, `ROW_*` — `let`s **declared in the `canvas` banner
beside `relayout()`**, not down in their own sections, so `relayout()` never reaches forward
into a temporal dead zone; the offsets *within* each baked panel stay fixed in their own
sections), `fitFlakes()`, which keeps snow density constant by topping up/trimming
the `flakes` array (see [Snow](#snow)), and `renderBars()`, which re-bakes the pillarbox frame. Never write layout
code against a literal 480/270; `menuLayout()` shows the pattern for recentering a 270-authored
layout (`toy` offset).

`render()` keeps two camera offsets: tiles and other statics subtract the rounded `ox`/`oy`,
while moving entities (player, animals, robots, drops, particles, floaters, swing arc) subtract
the exact `ex`/`ey` and round once at the end. Screen pos must be `round(world - camera)` with a
**single** rounding — rounding camera and entity separately makes their boundary crossings
disagree and the sprite vibrates ±1px against the background while walking (measured 48 flips/s),
which reads as ghosting on high-refresh displays. New entity draw code must use `ex`/`ey`.

## Render pass order

`render()` runs: ground blit → under-ice fish → ice-crack decals → footprints → flat objects
(stumps) → item drops → **y-sorted
`draws` array** (tall objects + every live player + animals + robots, sorted by feet Y; empty
slots draw as team-tinted silhouettes via `drawGhost`) →
selection brackets (`drawSelection`: white pulsing corners with a dark shadow over the hovered
stump / finished structure, or the wheel's target) → the E work prompt (`drawWorkHint`) → the
fish brackets + click prompt (`drawFishHint`) → construction progress bars → particles →
arrows (bolts branch to `drawBolt`) → `drawTurretFx` (each turret's charging aim line and its
muzzle flash) → turret tracers → swing arcs (one per swinging player) → floaters → `drawDropAir` (the
eagle, its shadow, the rider and every faller, while `state.drop` exists) → `renderLighting` → `renderWeather` (snow, see below) →
`renderVignettes` → **`replayTick`** (banks the frame just finished into the replay ring — it
sits here, not at the end of `render()`, so the strip holds no HUD, no dim and no picture of
itself) → `renderUI` (skipped in `title` and `drop`) → `renderDropUI` (mode `drop` only:
chart, jump prompt, timer) → `renderWheel` (radial menu, above the UI) →
map/settings overlays → `renderTitle` (the main menu, also during the play intro) → death overlay →
`renderReplay` (the replay window, above both the death dim and the pause dim) →
the event feed and the held-TAB scoreboard (deliberately **above** the death dim, see
[Scoreboard and event feed](#scoreboard-and-event-feed)) →
fps/seed tags (the seed tag is skipped in `title`, where the menu prints it) → the screen fade
(`state.fade`, the reroll whiteout) → the pixel cursor (always last). The bow's
`drawAimLine` sits between the particles and the arrows pass. Anything that should be occluded by trees goes into `draws`
with a sort key; anything flat goes in the pre-pass.

Trees draw at `py - 8`, so a tree's canopy overhangs the bottom half of the tile *above* it; a
**dead tree** shares that 16×24 footprint and that offset. Short ground sprites (rock, bush,
stump, the wolf den's mouth) all draw at `py + 4` to stay clear of that band — drop one lower and
a tree on the tile below hides it almost completely.

Sprite hit-flash goes through `drawSpriteFlash()`, which recolours via a shared 64×64 `scratch`
canvas with `source-in` — sprites larger than 64×64 will clip (the 48×38 bot bay is the biggest).

### Snow

Flakes are **world-space**, not a screen overlay: each entry of `flakes` (the block at the top of
the `fx updates` banner) has a world `x/y`, drifts in world px (`spd` down, a sine sway plus a
light wind), and so scrolls with the camera like everything else. The field is kept exactly one
view in size — `fitFlakes()` scales the count to `VIEW_W×VIEW_H` (70 at 480×270) — and
`renderWeather(ex, ey)` draws every flake **wrapped modulo `VIEW_W`/`VIEW_H` around the exact
camera**, so the screen is always fully covered at constant density at any zoom or view size
(including the drop view) while a pan still slides every flake the right way; the wrap is invisible
because it only ever happens at the screen edge. A flake does not fall screen-top to
screen-bottom: it is born with `h` (30–120) world px left to fall, **lands** when that runs out,
rests on the ground fading out for `FLAKE_REST` (0.7 s), and is then reborn (`makeFlake`) at a
fresh spot in the field. Boot flakes and rebirths draw from `rng`; resize/zoom top-ups draw from
`fxRng` (see [world.md](world.md)). Drawn after `renderLighting` (never darkened) and before the
vignettes and HUD. `DBG.flakes` and `DBG.cam()` expose the array and the exact camera.

## UI panels are baked once

`buildMapPanel()`, `buildSettingsPanel()` and `buildHelpPanel()` draw the static chrome (parchment,
compass, labels) into offscreen canvases at boot (the two frost slabs share `bakeFrostSlab()`); per-frame code blits them and draws only the live parts on top.
Their layout variables (`PANEL_*`, `MAP_*`, `SET_*`, `SL_X`, `ROW_*`) are shared between the bake
function and the per-frame code, so both sides move together — but a bake-side change only appears
after the panel is rebuilt. They are declared **up in the `canvas` banner next to `relayout()`**
(which reassigns them on every canvas-size change) rather than in these sections; a new panel row
must be declared there too. The bake draws in panel-relative coordinates (e.g. `ROW_FPS - SET_Y`),
so a recenter never requires a re-bake — keep any new row's bake-side label and per-frame widget
expressed the same way.

The map panel's bake keeps a fixed 192×192 map slot; the world is bigger than that, so
`renderWorldMap()` blits `mapCv` scaled by `MAP_S = MAP_W / WORLD` and every tile-space
position drawn on top (grid lines, camera rect, player marker) must be multiplied by `MAP_S`.
The minimap is a scrolling viewport, not a whole-world view: `renderMinimap()` blits a
`MM_R / s`-tile square of `mmCv` around `viewPlayer()` into the disc, where `s = mmScale()` is
px per tile — `MM_ZOOMS[settings.mmZoom]` (0.5 … 3, index 2 = the 1:1 baseline), stepped by the
scroll wheel while `overMinimap()` (pointer inside the disc + ring), which pre-empts the camera
zoom in the wheel handler and is saved with the settings. Every marker drawn over it (slots,
landmark glyphs) multiplies its tile offset by `s`. The disc sits on an opaque `#0f1632`
backing with a pale 1 px outer rim that brightens while hovered — the hover state is the whole
affordance, there is no hint. **No `arc()` anywhere in it**: canvas arcs anti-alias, and at
game resolution that reads as blur, so `mmRing(g, cx, cy, r0, r1, col, a0?, a1?)` paints the
backing, rims and the day/night band one pixel at a time (pixel-centre distance test, optional
clockwise angle span), and the map view is clipped by `mmMask(r)` — a cached pixel disc
composited with `destination-in` on the `mmView` scratch canvas — instead of `clip()`.

## Overhead health bars

`drawHealthBar()` draws a small color-coded bar (green → amber → red by hp fraction) above every
unit, always visible: every player (in `drawPlayer`), animals (in `drawAnimal`),
and robots (in `drawRobot`). **Birds are the one exception** — 3 hp means every hit is a kill, and
a bar over something that small is all bar; `drawBird` draws the sprite lifted off its own shadow
by `a.alt` instead, which is the only read on how high one is.
The overhead bar is the **only** player health display — the old top-left Minecraft-style hearts
were removed in the HUD redesign (their sprites are still baked, unreferenced). While the bow is
drawn, a second small meter renders just above it: yellow while charging,
turning hot orange at full draw (two discrete states — a gradient is unreadable at 14 px) — drawn
for **everyone**, because it is the tell that a shot is coming. The overhead stack floats clear of
the sprite: stamina plate at `py - 4` (every slot, since the level badge spans both bars), health at `py - 7`, draw meter at
`py - 10` (inside the same frame, directly above the hp bar with a track-grey gap row, the mirror of
the stamina bar), and a rival's name tag in team colour at `py - 18`, a clear row above the meter's
frame. The backings are translucent, so each plate paints only its own rows - no overlap.

## Text over the world

White pixel text on a white snowfield is unreadable with a drop shadow, so everything drawn over
the world goes through `drawPixelTextOutline(ctx, text, x, y, color, outline, scale)` in
[font.js](../../js/font.js): the glyph stamped at the eight 1-px integer offsets in the outline
colour, then once in the text colour — a solid rim on every side, exactly 1 game px at any text
scale, no blur. The outline colour is the opaque `#0f1632` (the eight passes overlap, so a
translucent colour would stack unevenly). Sites: floaters (damage numbers, gold, `LEVEL n`),
rival name tags, the E and fish prompts, the radial-wheel labels, the HUD counters (berry/fish,
gold, the alive count and clock under the minimap — the alive icon is stamped with the same
eight-offset rim by `drawAliveIcon`), `state.msg`, the fps and seed tags, and the drop-UI text.
`drawPixelTextShadow` (a single bottom-right 1 px shadow) remains for text sitting on a panel,
plank or overlay — the settings/map panels, the main menu, the death overlay, the scoreboard and
the event feed's plates — where a full outline reads heavy. Checked at noon on open snow and at
full night. A line drawn under a `globalAlpha` fade must use `Shadow`: the outline's eight passes
overlap, so a translucent stamp stacks unevenly and the rim goes blotchy.

## Damage feedback

`addDmgFloater(x, y, amount, taken)` pushes a combat damage number into the shared `floaters`
array: **gold** for damage dealt (arrows, whoever fired them), **red `-N`** for damage the local
player takes (`damagePlayer`). Numbers of 10+
render at 2× scale, and each gets a small random x-drift so rapid repeat hits stay readable.
Floater entries carry optional `vx`/`scale`/`rise` fields honored by the floaters render pass;
plain `addFloater` entries default to the old look. Units also flash white on hit via
`drawSpriteFlash` (0.8-alpha overlay). Hits on **structures** intentionally get no numbers;
structures show flash, shake, and damage cracks instead.

## Landmarks on the maps

A [landmark](world.md#landmarks) is a *named* place, so it has to be legible on every surface
that shows the world. `drawLandmarkIcon(g, L, x, y, col, rim)` is the shared stamp: the spec's
`icon` rects inside a 7×7 box, drawn once inflated by 1 px in a rim colour and once in the ink,
so the same glyph reads on parchment, on snow and over forest.

- **The minimap** (`renderMinimap`) draws the glyph for any landmark inside the disc, in the
  spec's `mark` over a dark rim. No name — `WOLF DEN` is wider than the whole 48 px disc.
- **The M map** (`renderWorldMap`) draws the glyph plus the name in map ink under it, clamped
  to the map rect so a landmark near the edge keeps its label.
- **The eagle's chart** (`renderDropUI`) draws both, and this is the one that matters: choosing
  between them is the whole jump decision. Names only when the chart is at full scale
  (`VIEW_H >= 500`); at half scale they would sit on top of each other, so it is glyphs only.
- **Arrival** — `updatePlay` keeps `state.loc` (`{ L, t }`) for the local slot from
  `landmarkAt(player.x, player.y)`, and `renderUI` shows a toast top centre for ~3.5 s whenever it
  changes: a dark plate ruled in the spec's `mark`, the glyph, the name at 2× and the `tag` under
  it. It fades in and out, so it uses `drawPixelTextShadow` (see
  [Text over the world](#text-over-the-world) — an outline stamped under `globalAlpha` goes
  blotchy).

## Replay: the last four seconds

The `replay` banner keeps a rolling four seconds of what was on screen and plays it back in the
bottom-left corner while you are **dead** (the planks view, not while spectating) or **paused**.
It records pixels, not state, so it costs nothing to keep and re-renders nothing to play.

**Why it is not drawn in the game canvas.** The window is `RP_W`×`RP_H` (160×90) *game* px, and a
480×270 view does not fit in a ninth of itself — eight of every nine pixels are gone before
anything is drawn, and no amount of stored resolution brings them back. The same corner of the
*screen* is `RP_W * devScale` px across (640 device px at a 1080p fullscreen's 4× scale), which is
**more** pixels than the view itself has. So the frame goes to its own canvas, `#replay`
(z-order above `#game`, `pointer-events: none`), positioned over that rect by `layoutReplay()` —
which `relayout()` calls, so it follows every resize, fullscreen toggle and camera zoom. The game
canvas draws only the plate, the frost rim, the playhead and a low-res copy underneath, which
keeps the feature legible in a plain `canvas.toDataURL()` capture (`POST /shot`) and is covered
exactly by the overlay on screen.

Fullscreen here is the browser's (F11), which fullscreens the document, so a `position: fixed`
sibling still renders. Calling `requestFullscreen()` on `#game` itself would render *only* that
element and the replay window would vanish — fullscreen the document, or move the overlay inside
whatever element goes fullscreen.

**The ring.** `replayTick(now)` runs once per frame from the pass order above and owns the clock
(one `Math.min(0.05, …)` delta feeds both the capture cadence and the playhead). While
`replayLive()` — mode `play`, the local slot alive, and no overlay freezing the sim, i.e. exactly
the condition `update()` steps on — it blits the finished canvas into slot `rpHead` of one atlas
canvas every `1/RP_FPS` s and wraps. `RP_SECS` 4 × `RP_FPS` 30 = `RP_N` 120 slots, `RP_COLS` 12
across; `RP_RATE` 0.5 is the playback speed.

**Capture resolution rides on `devScale`** (device px per game px, the integer `fitCanvas()`
picks). `rpTarget()` fits the view inside three ceilings — what the corner can show
(`RP_W * devScale`), the memory cap (`RP_CAP_W`×`RP_CAP_H`, 480×270), and 1:1, since upscaling the
view would cost memory and add no detail. At a 1080p or 4K fullscreen all three land on the view
itself, so the capture is **1:1 and nothing is resampled anywhere** — the atlas slot, the overlay
backing store and the blit out are all the same pixels. A window wide enough to render more than
the cap loses the excess, which the corner could not have shown anyway.

**A resize does not cost frames.** Each slot records the size it was captured at (`rpFW`/`rpFH`),
so a change in view or zoom changes what the *next* frames look like and leaves the banked ones
alone. If the new size needs a bigger slot, `rpEnsure()` allocates a larger atlas and re-blits
every banked frame into it at its own resolution — only ever upward, so dragging a window about
does not reallocate on every step. Playback resizes the overlay's backing store to whatever the
current frame was captured at (the CSS size stays put), which is why a replay spanning a resize
changes sharpness mid-loop instead of jumping size or losing its history.

**Memory** is `RP_CAP_W * RP_CAP_H * 4 * RP_N` at the ceiling — 62 MB, and the ring only grows to
what a given window actually captures (a small window with `devScale` 1 stays near 7 MB). This is
the price of the resolution: it is the biggest allocation in the game, ahead of the 55 MB baked
ground. `RP_CAP_*`, `RP_FPS` and `RP_SECS` are the knobs.

**Per-frame cost while alive** is one `drawImage` at `RP_FPS`, straight off the finished world
pass. Canvas-to-canvas stays on the GPU; `getImageData`/`toDataURL` would stall the pipeline every
capture, so neither is used, and nothing is allocated per frame. The one downscale path (a view
bigger than the corner) runs with `imageSmoothingEnabled` on `rpCtx` — nearest there would sample
1 px in 9 and strobe an arrow in flight in and out of the recording.

**Playback.** `replayShowing()` decides; every fresh open restarts at the oldest frame. The
playhead advances `RP_FPS * RP_RATE` frames a second, so the four seconds take eight to watch and
then loop at 15 fps on screen. The window wears the standard `#35426e` frost rim with a gold
playhead sweeping the bottom — no label and no "REPLAY" string: a looping window under a sweeping
playhead is what a recording looks like. Because the overlay is a DOM layer it is **not** covered
by anything the game canvas draws, so `renderReplay()` hides it outright when the window is down
and mirrors `state.fade` onto its `opacity` — otherwise the replay would sit there through the
LOBBY fade-out.

`DBG.replay` exposes `{ cv, frames, showing(), shot, slot, bytes, W, H, fps, rate, ov }` — `cv` is
the whole filmstrip and `shot`/`slot`/`bytes` report the live capture size, slot size and atlas
cost, so a headless driver can check the resolution without playing to a death.

## Scoreboard and event feed

Two readouts of the **match** rather than of the world, in the `scoreboard & log` banner. Both
draw after the death overlay, so the dim never touches them — being down is exactly when you read
them — and both duck under the map/settings panels.

**The feed** (bottom left) is the last `EVENT_MAX` (4) lines of `events`, oldest at the top,
newest along the bottom. It shares that corner with the
[replay window](#replay-the-last-four-seconds) and steps up by `replayLift()` px for as long as
that window is open. `logEvent(txt, p)` pushes one; `p` is the slot the line is *about* and
supplies both colours — plate in the team's dark `coatD` over an opaque dark base (a bright plate
on snow leaves the text nothing to sit on), a 1 px edge in the team's bright `mark`, and the ink
in `playerTint(p)` so two players on one team read as two people. `updateFx()` ages every line on
wall time (so the feed fades in any mode, including paused) and drops it at `EVENT_LIFE` (8 s);
alpha is `1 - t/EVENT_LIFE`, i.e. purely the line's age, which is what makes the stack read
oldest-faintest. A new line arrives with an `EVENT_FLASH` (0.35 s) pop: it slides in from the left
edge and takes a white wash that decays quadratically. What gets logged lives in
[multiplayer.md](multiplayer.md#kills-and-the-event-feed).

**The scoreboard** is held-TAB (`scoreboardOpen()`: `keys['tab']`, any mode but `title`, so it
works while dead and while riding the eagle) and is drawn per frame, not baked — every number on
it is live. `scoreGroups()` is the ordering: slots grouped by team, teams ranked by their total
`scoreOf(p)` and players inside a team by their own, ties broken by team then slot id. `scoreOf`
is **lifetime gold earned** (`p.xp`), not the purse — spending gold on a building is progress, and
it is the number levels already run on — while the GOLD column shows the purse, so a slot that has
spent can sit above one showing more gold (its LVL column is the visible tell). A team stripe in
`TEAMS[team].mark` runs down each group, each row carries a faint team wash (stronger for the
local slot, which also gets a gold `>`), dead slots dim to 0.55 and gain an `OUT` tag. The panel
is `SB_W` (168) wide, its height follows the row count, and it is centred on `VIEW_W`/`VIEW_H`
every frame — no `relayout()` anchors, so it needs nothing on a resize.

## Cursor

The native pointer is hidden over the canvas and a **pixel-art cursor is drawn in-canvas** as
the very last thing in `render()` (above every overlay and the seed tag), so it sits on the
game's pixel grid at every zoom level. `cursorInfo()` resolves the pointer state once per
frame from `mouse`, `state`, `player` (draw/flounder/roll), and what's under the pointer, and
both the pixel cursor and the browser-cursor fallback read from it. It returns
`{ kind, mode, dim, frac }`:

- `kind` **arrow** — dead (off a plank), paused, map, and anywhere in the title/settings/wheel that isn't
  a widget; **hand** — over a main-menu item (`menuHit()`), a death-overlay plank (`deadHit()`) or spectate arrow (`specHit()`), a settings widget (`settingsHit()`, shared with the click handler
  so hover and click can never disagree), a live wheel segment, or a gear plate (`gearHit()`, the
  one left-clickable HUD widget in play — see [gameplay.md](gameplay.md#gear)); **grab** — dragging a
  slider; **hammer** — over a stump or finished structure (right-clickable; `dim` beyond the
  60 px reach); **reticle** — everywhere else in play.
- Reticle `mode` (table `RETICLE`): **idle** white cross; **lock** gold ring — E will work
  the object under the pointer (`workTarget()` is non-null: tree, rock, berried bush),
  dimmed when it is beyond `WORK_REACH`; **ice** the same lock in pale blue over bare ice;
  **hunt** amber breathing ring over an animal; **fish** water-blue ring over a fish; **bow** — while charging the ring closes as
  the draw fills and turns orange at full, like the meter. `dim` (50% alpha) also means tools
  are blocked right now: floundering in a hole, or mid-roll.
- Sprites live in `SPRITES.cursor.{arrow,hand,grab,hammer}` (`CUPAL`, lit top-left, icy
  bevel) with one-colour `SPRITES.cursorShadow` twins drawn 1 px offset beneath; hotspots are
  in `CUR_HOT`. Reticles are procedural via `drawOutlinedRects()` (dark rim pass, then fill),
  which the aim line's markers reuse.
- `settings.pixelCursor` (default **on**, the CURSOR row in the ESC menu: PIXEL/BROWSER)
  switches to the native pointer; `applyCursorStyle()` then maps the same state to the
  nearest CSS cursor (`crosshair`/`pointer`/`grabbing`/`default`) and sets
  `canvas.style.cursor` only on change. `mouse.inside` (set by mousemove, cleared by
  `mouseleave` on the canvas and document) hides the drawn cursor when the pointer leaves,
  and `DBG.hideUI` hides it for captures.

## Main menu (title)

`state.mode === 'title'` is a real menu, not a splash: the sim's ambient half keeps running
behind it (`updateTitle()` steps animals and fish and advances the menu timers; players, arrows
and structures do not tick and `state.time` is frozen), snow falls as usual, and the camera is
driven by `titleCamTarget()` — a slow lissajous drift around the open interior that stays
`BORDER_MAX + 6` tiles clear of the forest. Everything lives in the `main menu` banner and on
`state.menu`:

- **Items** `MENU_ITEMS` (SINGLEPLAYER / MULTIPLAYER / TUTORIAL / SETTINGS — MULTIPLAYER is
  `MENU_FROZEN`: drawn sealed under an ice glaze by `drawMenuButton(..., frozen)`, never
  selectable or activatable until multiplayer exists; arrow keys skip over it and the hand
  cursor ignores it. Its `menu.hover` slot tracks the pointer instead of the selection and
  drives a cold shimmer — pale rim, a sheen sweeping the glaze, frost breath — and clicking it
  calls `iceRefuse()`: the plank rattles for `menu.iceT`, hairline cracks flash from the struck
  point (`menu.iceX/iceY`, reseeded per knock by `menu.iceSeed`) and heal as it refreezes, and
  `menu.shards` ice chips spray and fall, to `SFX.iceKnock`) plus the seed row (`SEED N` + an
  11×11 die) as one more selectable, stacked
  `MENU_PITCH` apart from `MENU_Y0`; the slab and pillars size themselves to the rects; `menuLayout()` is the single source of rects for hit-testing
  (`menuHit()`) and drawing. `menu.sel` is the keyboard selection; the mouse only steals it
  when it actually moves (`menu.moved`, set by mousemove), so arrows and hover never fight.
  Up/Down/W/S move, Enter/Space activate, Esc/Backspace close a panel; `menuKey()` and
  `menuClick()` are the only entry points (`keydown`/`mousedown` route there in title mode,
  and `mousedown` re-reads the pointer position from its own event).
- **Dressing** (the Frozen-Throne-style frame, all procedural, every piece taking its alpha from the
  caller so it fades with the chrome): `drawTitleBackdrop` replaces the flat tint with one that
  weighs on the top/bottom edges plus a corner vignette, leaving the centre clear; `drawPillar`
  draws the two stone pillars `TITLE_PILLAR_DX` either side of the column (coursed shaft, frost
  at the base, snow-capped capital, an iron brazier whose flame flickers and throws an additive
  warm light); `drawMenuSlab` is the translucent slab with gilt corner brackets behind the items;
  `drawGoldRule` the gold rule with diamond finials under the logo (`SOFTFALL`, no subtitle), along the bottom and
  under the select header; `drawEmbers` the sparks rising off the logo and the braziers. The logo
  gets a pulsing ember glow behind it and a 1px ice rim along its top edges. Pillars rise from
  below at boot and sink away with the items on play. `PATCH_TXT` prints bottom-right.
- **Buttons** are procedural frost planks (`drawMenuButton`): chamfered slab with hashed
  wood-grain, a snow cap along the top, icicles off the bottom, corner rivets and a gold rule
  when hot (no glow behind the hot plank - it lifts and warms only). `menu.hover[i]` eases 0→1 toward the selected item and drives lift (2 px, the
  shadow stays on the ground) and the warm fill; `menu.pressT`
  sinks it for a beat; the lift, warm fill and gold rule are the whole selection cue (no selector arrows).
- **Die** (`drawDie`): shows `1 + (SEED % 6)` (faces 1–6), cycles faces and jitters while hovered, tumbles while
  `menu.rolling`. Activating it (`rerollWorld`) starts a whiteout via `state.fade`
  (`{ a, to, spd, color, then }`, stepped in `update()`, painted after the seed tag) and then
  navigates to `?seed=<new>` — `SEED` is a const everything closes over, so a new world is a
  new page. Boot checks `sessionStorage['softfall.reroll']` and lands with the fade
  clearing from white and the die still settling.
- **Panels** slide up from the bottom edge over the still-visible world (`menu.panel`,
  `menu.panelT` over `PANEL_SLIDE_T`, `menu.closing` on the way out); the menu chrome ducks to
  zero alpha underneath. SETTINGS is the existing panel via `renderSettings(now, { bare, slide })`
  (no dim, no minimap preview, translated by `slide`) — its widgets only take input once
  `menuPanelReady()`, so a click can never land on a half-slid row, and clicking outside the
  slab closes it. TUTORIAL is `helpPanelCv` (controls + the rules of the frostlands); PATCH
  NOTES is `patchPanelCv`, opened by clicking the `PATCH_TXT` tag bottom-right (`patchTagRect` /
  `overPatchTag`; the tag turns gold with an underline on hover): the frame is baked once, the
  entries (newest first, word-wrapped) into `patchNotesCv` as tall as they need, and render blits
  the `PN_H` window at `menu.patchScroll`. Past one window a pixel scrollbar appears (`drawPatchBar`:
  iron rail, gilt thumb, ice nubs) — wheel, Up/Down, the nubs (step) and the track (page) move it.
  Any open panel ducks the logo to zero alpha.
- **Champion select** (`menu.screen = 'select'`, entered by PLAY via `beginSelect`): cross-fades
  over the menu (`menu.screenT`, the menu chrome ducks to zero). Cards for every `CHAMPS` entry on
  the left (`drawChampCard`: portrait well + name + role), the highlighted one drawn 6× in the
  middle over a plinth with name, role, blurb lines and four stat-pip rows, and a LOCK IN plank.
  `selectLayout()`/`selectHit()` are the rect source for both drawing and the mouse; Up/Down or
  card clicks move `menu.csel` (`menu.cswapT` pops the big sprite, which walks in place), and the
  **loadout strip** (the four picked variant icons under the stat pips) is a button. Enter/Space,
  LOCK IN or the strip call `beginGear()` — champion locked, on to the **gear page**;
  Esc/Backspace go back to the menu.
- **Gear page** (`menu.screen = 'gear'`, cross-faded from select on `menu.gearT`): the full-page
  loadout picker — all 12 variants at once as four rows of three cards (`gearLayout()`/
  `gearScreenHit()`/`drawGearCard`), each card its variant's own icon + name + blurb, the picked
  one gold-trimmed, the keyboard focus (`menu.grow`, W/S rows, A/D or Left/Right picks) wearing
  pulsing corner ticks. Clicks pick via `pickGear()`; Enter or the **FLY** plank (the champion
  sprite waits beside it) calls `lockIn()` — `setChamp`, `menu.lockT`, then `beginDrop()` (the
  eagle ride, below); Esc returns to the champion screen. See [gameplay.md](gameplay.md#gear).
- **Entrance**: `menu.t` staggers the logo and items in at boot.
- **Menu exit**: `state.intro` counting down from `INTRO_T` (1.6 s) with `state.introLen = INTRO_T`
  is what dissolves the menu — `renderTitle` keeps drawing while it runs: the tint dissolves over
  the first 45 % and the chrome sinks away in the first 22 % — and the camera eases from
  `state.introFrom` with `easeInOut(1 - intro / introLen)` instead of the play lerp. `beginDrop`
  starts it (into the eagle ride); `beginIntro` (debug only, `DBG.beginIntro`) starts it straight
  into `play` with the player already standing in the world.
- **Landing intro**: the human's `landPlayer` sets `state.intro = state.introLen = HUD_IN_T` (0.7 s)
  with `introFrom` at the touchdown framing, so `renderUI` slides the HUD in (the left stack from
  the left, the gold/minimap stack from the top) while the camera settles onto the play framing.
  The first-run hint message fires when that intro ends.

`DBG` exposes `menu`, `menuHit`, `menuClick`, `menuKey`, `settingsHit`, `beginIntro` and
`layout()` (the live `SET_*`/`ROW_*`/`MM_*` anchors) for driving all of this headlessly.

## Eagle drop (mode `drop`)

Everything in the `eagle drop` banner. `beginDrop()` (from `lockIn`, or `startGame`/`DBG.beginDrop`)
puts every active slot aboard (`p.aboard`), builds `state.drop` from `makeEagleRoute()` — two
points on a ring `EAGLE_R` (`WORLD/2 - 40`) tiles from the centre, roughly opposite, both from
`hash2` so the line is the seed's — bakes the chart once (`buildWorldMapImg` into `mapCv`), sets
mode `drop`, refits the view to `DROP_ROWS` around its centre and starts the menu exit. The bird
flies the line at `EAGLE_SPD` (170 px/s, ~13–15 s); `updateDrop` (called from `updatePlay`, so
pause stops it) moves it, carries everyone aboard with it, jumps each AI slot at its hashed
`p.dropU` (0.12–0.88 of the line, scattered ±4 tiles off it) and the human at the end if they
never pressed Space/Enter/E/click (`dropJump`). A jumper free-falls for `FALL_T` (1.3 s), steering
with WASD/arrows at `DRIFT_SPD` (130 px/s, ~10 tiles over the fall) — `sampleHumanInput` keeps the
movement axis alive in mode `drop` while zeroing everything else; `landPlayer` then spirals out (up to 80 tiles) to the nearest tile with no object and no
water hole, which becomes `p.spawn` — the respawn point — with 2 s of i-frames and a snow burst.
Only the human's landing changes mode: `play`, `applyView()` back to base zoom centred on the
landing, `shake`, and the landing intro above. `state.drop` outlives the mode: the eagle keeps
flying (and dropping bots) until it is 60 tiles past the line's end with nobody in the air.

Drawing: `drawDropAir` (above the world, below lighting) draws the `SPRITES.eagleShadow`
silhouette `DROP_ALT` (56 px) below and 10 px right of the bird, the bird itself (`SPRITES.eagle`
cycling spread → mid → back → mid, rotated to its heading, at `EAGLE_SCALE` 2× because it is
high up, bobbing 3 px), the local rider unrotated on its back, a pulsing gold landing ring under
the bird while the human is still aboard, and every faller shrinking from 2× to 1× along
`alt = DROP_ALT·(1 − q²)` with a widening shadow. `renderDropUI` (mode `drop` only) draws the
chart (`mapCv` at 1× when `VIEW_H ≥ 500`, else ½×, so pixels stay even) with the line inked dark
under a dashed gold line, the flown part solid, the end-of-line marker, the bird as a white
diamond with a pulsing ring, landed rivals as team pips and your own red diamond once you have
jumped; top centre the pulsing `SPACE - JUMP` prompt with a draining time-left bar (red under
3 s) and seconds, or `WASD - DRIFT` while falling. Text scale follows the view (2× when tall).

Airborne slots (`inAir(p)`: aboard or `dropT > 0`) are skipped by `updatePlayer`/`updateAI`, arrows,
drops, wildlife scares, `enemyOf`, the y-sorted draws, the minimap and the M map.

## Lighting

**Nothing currently emits light.** Campfires and torches were removed with the old hotbar, so
`rebuildLights()` just empties the `lights` array — but the whole pipeline is kept intact as
the single rebuild point for any future glowing object: `renderLighting()` punches `lights`
entries (`{x, y, r, warm}`) out of a dark overlay on the offscreen `lightCv` using
`destination-out`, then `drawWarmGlows()` adds `multiply` colour grading plus a `lighter` core.
**Any code that adds or removes a light-emitting object must call `rebuildLights()`.** The only
night light today is the player's personal glow (radius 44) baked into `renderLighting()`.
There is no warmth/cold system anymore — night darkness is purely visual.

