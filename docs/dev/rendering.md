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
arrows → turret tracers → swing arcs (one per swinging player) → floaters → `drawDropAir` (the
eagle, its shadow, the rider and every faller, while `state.drop` exists) → `renderLighting` → `renderWeather` (snow, see below) →
`renderVignettes` → `renderUI` (skipped in `title` and `drop`) → `renderDropUI` (mode `drop` only:
chart, jump prompt, timer) → `renderWheel` (radial menu, above the UI) →
map/settings overlays → `renderTitle` (the main menu, also during the play intro) → death overlay →
fps/seed tags (the seed tag is skipped in `title`, where the menu prints it) → the screen fade
(`state.fade`, the reroll whiteout) → the pixel cursor (always last). The bow's
`drawAimLine` sits between the particles and the arrows pass. Anything that should be occluded by trees goes into `draws`
with a sort key; anything flat goes in the pre-pass.

Trees draw at `py - 8`, so a tree's canopy overhangs the bottom half of the tile *above* it.
Short ground sprites (rock, bush, stump) all draw at `py + 4` to stay clear of that
band — drop one lower and a tree on the tile below hides it almost completely.

Sprite hit-flash goes through `drawSpriteFlash()`, which recolours via a shared 32×32 `scratch`
canvas with `source-in` — sprites larger than 32×32 will clip.

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
The minimap needs no such factor — it is a scrolling 1px-per-tile viewport, not a whole-world
view.

## Overhead health bars

`drawHealthBar()` draws a small color-coded bar (green → amber → red by hp fraction) above every
unit, always visible: every player (in `drawPlayer`), animals (in `drawAnimal`),
and robots (in `drawRobot`).
The overhead bar is the **only** player health display — the old top-left Minecraft-style hearts
were removed in the HUD redesign (their sprites are still baked, unreferenced). While the bow is
drawn, a second small meter renders just above it: yellow while charging,
turning hot orange at full draw (two discrete states — a gradient is unreadable at 14 px) — drawn
for **everyone**, because it is the tell that a shot is coming. The overhead stack floats clear of
the sprite: stamina plate at `py - 4` (local slot only), health at `py - 7`, draw meter at
`py - 12`, and a rival's name tag in team colour above that.

## Damage feedback

`addDmgFloater(x, y, amount, taken)` pushes a combat damage number into the shared `floaters`
array: **gold** for damage dealt (arrows, whoever fired them), **red `-N`** for damage the local
player takes (`damagePlayer`). Numbers of 10+
render at 2× scale, and each gets a small random x-drift so rapid repeat hits stay readable.
Floater entries carry optional `vx`/`scale`/`rise` fields honored by the floaters render pass;
plain `addFloater` entries default to the old look. Units also flash white on hit via
`drawSpriteFlash` (0.8-alpha overlay). Hits on **structures** intentionally get no numbers;
structures show flash, shake, and damage cracks instead.

## Cursor

The native pointer is hidden over the canvas and a **pixel-art cursor is drawn in-canvas** as
the very last thing in `render()` (above every overlay and the seed tag), so it sits on the
game's pixel grid at every zoom level. `cursorInfo()` resolves the pointer state once per
frame from `mouse`, `state`, `player` (draw/flounder/roll), and what's under the pointer, and
both the pixel cursor and the browser-cursor fallback read from it. It returns
`{ kind, mode, dim, frac }`:

- `kind` **arrow** — dead, paused, map, and anywhere in the title/settings/wheel that isn't
  a widget; **hand** — over a main-menu item (`menuHit()`), a settings widget (`settingsHit()`, shared with the click handler
  so hover and click can never disagree) or a live wheel segment; **grab** — dragging a
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

- **Items** `MENU_ITEMS` (PLAY / SETTINGS / HOW TO PLAY) plus the seed row (`SEED N` + an 11×11
  die) as a fourth selectable; `menuLayout()` is the single source of rects for hit-testing
  (`menuHit()`) and drawing. `menu.sel` is the keyboard selection; the mouse only steals it
  when it actually moves (`menu.moved`, set by mousemove), so arrows and hover never fight.
  Up/Down/W/S move, Enter/Space activate, Esc/Backspace close a panel; `menuKey()` and
  `menuClick()` are the only entry points (`keydown`/`mousedown` route there in title mode,
  and `mousedown` re-reads the pointer position from its own event).
- **Buttons** are procedural frost planks (`drawMenuButton`): chamfered slab with hashed
  wood-grain, a snow cap along the top, icicles off the bottom, ember gems and a gold rule
  when hot. `menu.hover[i]` eases 0→1 toward the selected item and drives lift (2 px, the
  shadow stays on the ground), the warm fill, and a pulsing ember glow behind; `menu.pressT`
  sinks it for a beat. The selector is a pair of bobbing pixel arrows (`drawSelector`).
- **Die** (`drawDie`): shows `SEED % 6`, cycles faces and jitters while hovered, tumbles while
  `menu.rolling`. Activating it (`rerollWorld`) starts a whiteout via `state.fade`
  (`{ a, to, spd, color, then }`, stepped in `update()`, painted after the seed tag) and then
  navigates to `?seed=<new>` — `SEED` is a const everything closes over, so a new world is a
  new page. Boot checks `sessionStorage['emberfrost.reroll']` and lands with the fade
  clearing from white and the die still settling.
- **Panels** slide up from the bottom edge over the still-visible world (`menu.panel`,
  `menu.panelT` over `PANEL_SLIDE_T`, `menu.closing` on the way out); the menu chrome ducks to
  zero alpha underneath. SETTINGS is the existing panel via `renderSettings(now, { bare, slide })`
  (no dim, no minimap preview, translated by `slide`) — its widgets only take input once
  `menuPanelReady()`, so a click can never land on a half-slid row, and clicking outside the
  slab closes it. HOW TO PLAY is `helpPanelCv` (controls + the rules of the frostlands).
- **Champion select** (`menu.screen = 'select'`, entered by PLAY via `beginSelect`): cross-fades
  over the menu (`menu.screenT`, the menu chrome ducks to zero). Cards for every `CHAMPS` entry on
  the left (`drawChampCard`: portrait well + name + role), the highlighted one drawn 6× in the
  middle over a plinth with name, role, blurb lines and four stat-pip rows, and a LOCK IN plank.
  `selectLayout()`/`selectHit()` are the rect source for both drawing and the mouse; Up/Down or
  card clicks move `menu.csel` (`menu.cswapT` pops the big sprite), Enter/Space/LOCK IN call
  `lockIn()` — which stamps `setChamp(player, csel)`, holds `menu.lockT` for the press, then
  `beginDrop()` (the eagle ride, below); Esc/Backspace go back to the menu.
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
flies the line at `EAGLE_SPD` (170 px/s, ~14–18 s); `updateDrop` (called from `updatePlay`, so
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

