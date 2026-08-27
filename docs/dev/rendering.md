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
  `deviceH / TARGET_ROWS`. It does not depend on the zoom — the canvas is laid out the same at
  every zoom (see [World zoom](#world-zoom-and-the-two-pixel-spaces)), which is what keeps the
  HUD a fixed size on screen. `scale` is fractional in CSS px and must not be floored.
- **The backing store is in device pixels**: `canvas.width = VIEW_W * devScale`. The UI still
  draws in `VIEW_W`×`VIEW_H` space — `render()` puts a `devScale` transform under it, so 1px
  rects and the 3×5 font blow up by a whole number and stay exact — and no layout code changes.
  The extra resolution exists for one reason: it is what lets a world pixel be a whole number of
  *device* pixels at zooms that are not whole numbers of *canvas* pixels.
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

## World zoom, and the two pixel spaces

**Zoom scales the world and nothing else.** The canvas keeps its `TARGET_ROWS` size at every
zoom level, so the HUD, the baked panels, the minimap and the cursor are pixel-identical
however close the camera is — scrolling in moves the camera, it does not magnify the interface.

That falls out of rendering in **two pixel spaces**:

| Space | Size | Written through | Holds |
| --- | --- | --- | --- |
| world | `WV_W`×`WV_H` | `ctx` while it points at `wctx` | ground → … → `renderLighting` |
| screen | `VIEW_W`×`VIEW_H` (backed by `VIEW * devScale` device px) | `ctx` while it points at `uictx`, under a `devScale` transform | weather, vignettes, all UI |

`ctx` is therefore **not a fixed binding**: `render()` sets `ctx = wctx` before the ground blit
and `ctx = uictx` straight after `renderLighting`. Between them it drops to the identity
transform and blits `worldCv` **in device pixels** at `k = zoomCur * devScale` px per world px,
then sets the `devScale` transform for everything below. Doing the scale-up as **one
nearest-neighbour resample of an already-composed frame** is what keeps it coherent: ground,
sprites, particles and floaters are drawn together at 1:1 first, so they share one pixel grid
instead of each rounding its own edges and shimmering against its neighbours.

Consequences a new pass has to respect:

- **A world pass bounds itself against `WV_W`/`WV_H`, never `VIEW_W`/`VIEW_H`.** Below zoom 1
  the world view is *wider* than the canvas, and culling to the canvas eats the edges.
- `worldCv` and `lightCv` are allocated at the most zoomed-out size (`ZOOM_FLOOR`) once per
  canvas size, and each frame uses the `WV_W`×`WV_H` corner — never resize them per frame.
- Anything **UI-layer but anchored to a world point** (only the radial wheel today) converts
  through `wToSX`/`wToSY`, and keeps its own pixel size.
- **A pointer position becomes a world position only through `mouseWX()`/`mouseWY()`**
  (`mouse / zoomCur + cam`). Aim, hover, the work target and the right-click tile all read them,
  so the zoom cannot be applied in one place and forgotten in another.
- The camera centres and clamps on `WV_W`/`WV_H`; the aim lean divides by `zoomCur` so it stays
  the same *fraction* of the view at every zoom.
- Weather and the vignettes sit **above** the blit deliberately: a flake keeps its own crisp
  size at every zoom, and its drift multiplies by `zoomCur` so the field still scrolls with the
  ground under it.

### The resting zoom is always pixel-exact

A world pixel ends up covering **`zoom × devScale` device pixels**. Unless that is a whole
number, some world pixels get an extra row of device pixels and their neighbours do not — which
on a 16×16 sprite is exactly what "stretched" looks like. So the zoom the player rests at is
not stored as a float at all:

- **`kWant` is that whole number** — device px per world px — and the wheel steps it by **±1**,
  clamped to `kMin()`…`kMax()` (`ZOOM_MIN` 0.5 … `ZOOM_MAX` 3.6 × `devScale`). `zoomWantOf()`
  derives the float scale as `kWant / devScale`.
- The rungs are therefore `k / devScale`. At `devScale` 4 that is **quarter steps** — 0.5, 0.75,
  1, 1.25, 1.5 … 3.5, thirteen of them; at 3 it is thirds, ten of them. A display with fewer
  pixels to spend gets fewer, coarser rungs, which is the honest answer rather than a lie.
- `sizeWorldView()` **ceils** (never rounds): `WV × k` must *cover* the canvas or a sliver of
  stale pixels survives down the right edge.
- `fitCanvas()` re-rungs `kWant` onto the new ladder (`round(zoomCur * dev)`) whenever `devScale`
  changes — a resize, a fullscreen toggle, a drag to another monitor.

**In motion it is deliberately not exact.** `applyZoom(dt)`, first thing in `update()`, eases
`zoomCur` toward `kWant / devScale` exponentially at `ZOOM_EASE` 16/s (~0.13 s to 90%,
frame-rate independent) and parks it exactly on the rung. While the ease runs the blit scale is
fractional and ~12% of pixels break the grid; nobody reads pixel edges mid-zoom, and it lands
clean. Measured with a block-uniformity scan over ~270k device px per rung: **0 stray pixels at
every rung, on both a `devScale` 3 and a `devScale` 4 display; 12.3% mid-glide.**

Nothing in that path touches the canvas, so unlike the old `applyView()` it never calls
`fitCanvas()`/`relayout()` **and the overlays no longer force the zoom back to base** — the
fixed-size panels fit at any zoom now. `applyZoom(0, true)` snaps instead of easing, which is
what `beginDrop`/`landPlayer` use. The eagle ride forces `DROP_ZOOM` 0.5 (twice the world) for
as long as mode is `drop`; landing returns to whatever the player had set.
`DBG.setK(k, snap)` sets the rung directly, `DBG.setZoom(z, snap)` lands on the nearest rung,
and `DBG.getZoom()` reports `k`, `devScale`, `exact` and the whole `rungs` ladder. The scroll
wheel is zoom only — there is no tool selection to cycle.

Zooming **out** past the baseline is now allowed, which retires the old fairness ceiling
(nobody buys vision) — a PvP rule from when widening the view meant enlarging the canvas.

**Mouse coords are divided by `scale` on the way in**, landing in screen space. Round positions
when drawing (`Math.round`) or sprites smear across subpixels.

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

`render()` runs: ground blit → under-ice fish → ice-crack decals → footprints (walking prints,
slide grooves, skate scratches and belly-crawl furrows all share the one `footprints` array,
branching on `f.k`) → flat objects
(stumps, and **fish nets** via `drawNet`) → spent arrows (`drawShafts`) → item drops → **y-sorted
`draws` array** (tall objects + every live player + animals + robots, sorted by feet Y; empty
slots draw as team-tinted silhouettes via `drawGhost`) →
selection brackets (`drawSelection`: white pulsing corners with a dark shadow over the hovered
stump / open ice hole / finished structure, or the wheel's target) → the E work prompt (`drawWorkHint`) → the
fish brackets + click prompt (`drawFishHint`) → construction progress bars → particles →
arrows (bolts branch to `drawBolt`) → `drawTurretFx` (each turret's charging aim line and its
muzzle flash) → turret tracers → swing arcs (one per swinging player) → floaters → `drawDropAir` (the
eagle, its shadow, the rider and every faller, while `state.drop` exists) → `renderLighting` →
`drawNavPaths` + `drawHitboxes` (the `.` debug overlay — deliberately **above** the lighting,
see [Debug overlays](#debug-overlays-hitboxes-and-routes)) →
**the world blit** (`worldCv` scaled onto the canvas — everything above it drew in world space,
everything below draws in screen space; see [World zoom](#world-zoom-and-the-two-pixel-spaces))
→ `renderWeather` (snow, see below) →
`renderVignettes` → **`replayTick`** (banks the frame just finished into the replay ring — it
sits here, not at the end of `render()`, so the strip holds no HUD, no dim and no picture of
itself) → `renderUI` (skipped in `title` and `drop`) → `renderDropUI` (mode `drop` only:
the flight bar, the first-flight countdown, keybind indicators) → `renderWheel` (radial menu, above the UI) →
map/settings overlays (the M map also in mode `drop`) → `renderTitle` (the main menu, also during the play intro) → the end-of-match
overlay (`renderDead`: the death dim and its planks, or `renderVictory` / `renderDefeat` — see
[The end screens](#the-end-screens)) →
`renderReplay` (the replay window, above both the death dim and the pause dim) →
the event feed and the held-TAB scoreboard (deliberately **above** the death dim, see
[Scoreboard and event feed](#scoreboard-and-event-feed)) →
the info stack (`drawTags`, left edge at the top quarter: FPS / POS / SEED as aligned
label-value rows — one ESC-menu toggle or F3; only the fps line in `title`) → the screen fade
(`state.fade`, the reroll whiteout) → the pixel cursor (always last). The bow's
`drawAimLine` sits between the particles and the arrows pass. Anything that should be occluded by trees goes into `draws`
with a sort key; anything flat goes in the pre-pass.

Trees draw at `py - 8`, so a tree's canopy overhangs the bottom half of the tile *above* it; a
**dead tree** shares that 16×24 footprint and that offset. Short ground sprites (rock, bush,
stump, the wolf den's mouth) all draw at `py + 4` to stay clear of that band — drop one lower and
a tree on the tile below hides it almost completely.

The **fish net** is the one building that is not in `draws` at all. It lies flat on its hole and
gets walked over, so y-sorting it would put it in front of the player standing on it: `drawNet`
runs in the flat pre-pass instead, at `(px, py)` filling its tile exactly, with its own health bar
and its catch (up to `NET_CAP` fish at `NET_FISH_AT`, each on its own bob) drawn into the mesh —
the catch showing through the rope is the only thing that says a net is worth walking to. An
unfinished net fades in with `buildT` rather than wearing a scaffold, because there is nothing out
on the water to stand a frame on. Its construction bar comes from the shared progress-bar pass
like every other building's.

Sprite hit-flash goes through `drawSpriteFlash()`, which recolours via a shared 64×64 `scratch`
canvas with `source-in` — sprites larger than 64×64 will clip (the 48×38 bot bay is the biggest).

### Snow over a body

A [prone](gameplay.md#prone-under-the-snow) player draws inside the same `draws` slot as a
standing one — prone pose set, then `drawSnowCover(p, spr, px, py, alpha)` over body and bow
alike, and `drawBuryRing` under it for the local slot only. The cover closes **from the outside
in** (each row's covered band grows from both edges toward a seam down the middle that shuts at
`hide = 1`), so boots and elbows go first and the middle of the back last. Row extents are not
guessed: `spr.spans` is the per-row `[firstX, lastX]` that [sprites.md](sprites.md) takes off the
char grid at bake time, so there is **no `getImageData` anywhere in this** and the cover stays
correct on its own if the poses are redrawn. `poseBounds` caches a dilated copy per sprite — the
union of each row with its two neighbours, which rounds the jagged bits out and adds the row of
piled snow above and below the body — and keeps the raw spans beside it, because the taper that
rounds the drift's two ends must never pull the cover inside the body it is covering (both
head-on poses run to the bottom of the cell and have no spare row to round into). No cast shadow
is drawn while lying: a body flat on the snow has nothing to cast one over, and the mound's own
dark lower rim does the grounding instead.

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
The sim keeps stepping under it and the local slot keeps walking
([the M map does not pause](gameplay.md#the-m-map-does-not-pause)), so every one of those live
parts — the camera rect, the slot markers, the player's own diamond — moves while the chart is
open, and `buildWorldMapImg()` re-inks the terrain each frame so a wall built or a tree felled
behind the parchment shows up on it.
The minimap is a scrolling viewport, not a whole-world view: `renderMinimap()` blits a
`MM_R / s`-tile square of `mmCv` around `viewPlayer()` into the disc, where `s = mmScale()` is
px per tile — an eased `mmCur` chasing `MM_ZOOMS[settings.mmZoom]` (0.25 … 4 over twelve rungs,
index 5 = the 1:1 baseline) on the same `ZOOM_EASE` the camera uses, so both zooms under one
hand feel like one control. A save written before `settings.v` indexes the old six-rung ladder
and is carried across by `MM_MIGRATE` on load. Stepped by the
scroll wheel while `overMinimap()` (pointer inside the disc + ring), which pre-empts the camera
zoom in the wheel handler and is saved with the settings. Every marker drawn over it (slots,
landmark glyphs, your side's [worker flags](gameplay.md#worker-flags)) multiplies its tile
offset by `s`. The disc sits on an opaque `#0f1632`
backing with a pale 1 px outer rim that brightens while hovered — the hover state is the whole
affordance, there is no hint. **No `arc()` anywhere in it**: canvas arcs anti-alias, and at
game resolution that reads as blur, so `mmRing(g, cx, cy, r0, r1, col, a0?, a1?)` paints the
backing, rims and the day/night band one pixel at a time (pixel-centre distance test, optional
clockwise angle span), and the map view is clipped by `mmMask(r)` — a cached pixel disc
composited with `destination-in` on the `mmView` scratch canvas — instead of `clip()`.

## The HUD corners

`renderUI()` owns three corners and one strip, and every one of them is positioned off
`VIEW_W`/`VIEW_H` (never a literal), so a resize needs nothing from them. **The top left is
deliberately empty** — the berry/fish counts that used to stack there, and the gold that sat left
of the minimap, are all on the backpack's bottom strip now, which is why nothing slides in from
the left during the landing intro any more. The strip and the backpack sit on the view's last
pixel — no margin, the 1 px rim is the edge — so a resize keeps them flush on every size.

| Where | What | Function |
| --- | --- | --- |
| top left | **nothing** — see the strip below | — |
| top right | the minimap and its day/night ring, alive count, clock | `renderMinimap` |
| bottom left | the event feed | `renderEventLog` |
| bottom centre | four ability slots over the xp bar, flush to the bottom; a plus-square perches on the frame to spend a skill point | `drawHudStrip` |
| bottom right | the backpack **and** the gear row: one frame — five icons, the grid when open, a gold strip; flush to the bottom-right | `drawBag` |

### The hud strip

`drawHudStrip` is one plate, flush to the bottom: four ability wells on top, a gold xp bar along the bottom (lifetime gold, left-to-right, no level number — that lives on the overhead badge). The bar has a dark silhouette and a frost rim so it reads against the plate. While `p.skillPts` is free and that ability is below `AB_RANK_MAX` (3) a plus-square perches on the plate's top rim — drawn after the frame, so the border does not wrap it — and is a button (`abHit` / `buySkill` through `input.cmd {kind:'skill'}`). It is gone the moment a point cannot land there. Rank is three pips on the well itself. The plate swallows clicks so the bow never fires through it. A point lands at level 1 and on every `levelUp`.

### The backpack and gear widget

Everything a slot owns is **one frame in one corner** — the gear row is not a separate widget any
more, it is the top row of the bag. `bagFrameRect()` is the whole thing, and top to bottom it is:

1. an **icon row** of five identical cells — the pack, then helmet / chest / legs / boots;
2. the **inventory grid**, only when `state.bagOpen`, continuing straight down the row's own
   five columns on the same `BAG_GAP` — no wider seam between them, because they are cells of
   the same size holding the same kind of thing;
3. a single 1 px rule, the only line inside the widget;
4. the **gold row** (`bagStripRect()`), full inner width, hard against the bottom rim.

**The row is on top and the grid hangs below it, and that is load-bearing rather than taste.** An
affordable gear piece bobs a gold chevron *above* its cell and the hover price sits higher still,
so whatever is over the row has to be empty screen — put the grid up there and every chevron draws
into it. (The carets start 14 px up rather than 10 so the bottom of their bob clears the frame's
own lit edge, `BAG_PAD` being only 3.) The frame is pinned by its **bottom-right** to the view edge (`VIEW_W` / `VIEW_H`,
the 1 px rim is the last pixel) and
grows upward, so opening the bag lifts the row instead of pushing the gold off the screen.

- **Nothing in it is a different size from anything else.** `BAG_CELL` (18) is a grid slot, a gear
  plate and the pack button alike, and all three are painted by `bagCellPlate()` — one function,
  so a button can never drift out of style with a slot. `BAG_PAD` (3) from the frame to the first
  cell and `BAG_GAP` (2) between neighbours are the only two gaps in the widget; `BAG_W` is 104,
  and `bagRowRect(i)` and `bagCellRect(i)` share the same column arithmetic, so the five columns
  line up from the row straight down through the grid.
- **One background, one border, one internal line.** Every part of the frame — behind the cells,
  behind the grid, behind the gold — is the same opaque `BAG_BG`, so nothing inside reads as a
  separate panel stacked on another. The border is a single 1 px rim: no lit inner edge, no rule
  under the icon row, no wider gap there either. The **one** line that stays is the rule over the
  gold row, because money is a different *kind* of thing from the slots above it, and that is the
  only break the widget makes.
- **Depth comes from the cells, not from panels.** Three tones say it without a line: a filled
  cell recesses to `BAG_WELL` *below* the frame's ground, an empty one sits *above* it at
  `#171f45`, and the ground itself is between — occupied / free / frame.
- **The strip is every number the widget has**, League-style: berries and fish from the left, each
  an icon and a count and nothing else, then the gold hard against the **right** edge with its
  coin ahead of it, inked `#f5c542` so the one number that is money does not read as a count of
  something carried. The food totals the *whole bag* across its stacks, so the strip answers "can
  I heal" without opening the grid, and a meal you have none of takes no room at all — which is
  why the gold is right-aligned and the food left-aligned: neither moves the other.
- **The eat keys are not printed on it.** Q and F are looked up in the ESC panel's CONTROLS
  block, which is what that block is for; a letter beside every count is a caption the strip
  would carry forever for the two minutes it is useful.
- **No cast shadow.** The frame is hard against two edges of the screen, where a shadow has
  nothing to fall on, and the cells already carry the depth — a drop shadow only smeared the
  outline that reads the whole thing as one box.
- **An empty cell is the *lighter* one**: it has no icon to show off, and free space is what the
  grid is being read for, while a full cell goes dark behind its item. A stack draws its icon
  high in the cell so the count can have the bottom-right corner without its outline eating the
  cell's rim, and a stack of one prints no number — an empty corner says it.
- **Two things are said in colour rather than in words**: the pack's rim goes amber when no cell
  is free, and the whole frame reddens and shakes for `bagFlash` seconds when something could not
  be carried (`bagDenied()`, aged in `updateFx` on wall time like the rest of the chrome).
- **The frame swallows every click over itself.** `bagHit` reports `btn` (the pack), `cell` (a
  grid slot) or `frame` (anywhere else inside, inert but eaten), so nothing is ever fired at the
  world through the panel; `gearHit` owns the four gear cells and is asked *first* by the click
  handler, `cursorInfo` and the row's own hover, so the three can never disagree. The cursor is a
  **hand** only over something that does something — the gold strip reads as a plain arrow.
- **The grid does not stop the sim.** It is HUD, not an overlay — the same deal the
  [M map](gameplay.md#the-m-map-does-not-pause) takes, only smaller: nothing dims, nothing is
  zeroed in `sampleHumanInput`, and the only input it takes is the clicks over its own frame.

The model behind the grid is in [gameplay.md](gameplay.md#inventory-and-the-backpack); the gear
table and what a buy does are in [gameplay.md](gameplay.md#gear).

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
the stamina bar), and the slot's name tag in team colour at `py - 18`, a clear row above the meter's
frame — **every** slot, the local one included: the name is the profile's
([architecture.md](architecture.md#profilejs)), and yours is what the rest of the table reads over
your head, so hiding it from you alone would make it the one label in the game you cannot check. The backings are translucent, so each plate paints only its own rows - no overlap.

**The frame is centred on the body, and the bars pay for it (`FRAME_DX`).** Horizontally the frame
is a 6 px level plate hard against the 16 px bar backing — 22 px — and it is the *frame* that has
to straddle the sprite, not the bars inside it. So the whole stack is drawn `FRAME_DX` (3 px) right
of the sprite's own centre: `fx = round(p.x - ex) + FRAME_DX` is the stack's centre column and
everything in it hangs off that, giving `cx-11 .. cx+10`, exactly centred on the seam a 16×16
sprite is centred on. Measured off the canvas: a 22-column run from −11 to +10, centre 0.

**The stun plate is deliberately not counted.** It is a transient annex sharing the bar backing's
right edge (`fx+8 .. fx+13`), so a stun makes the frame 28 px and overhangs to the right until it
clears. Sizing the resting frame around it is what made the plate lopsided in the first place —
the level badge is permanent and the stun plate is not, so the geometry follows the permanent one.
Drawing the stun plate **empty** at rest would square both states, but it parks a bar that is never
a bar over every head, which is worse than the overhang. Turn the
[centre column](#the-centre-column-hbmid) on under `.` before changing any of these numbers.

**The name tag is centred by `centreTextX`, on the body and not on `fx`.** It is not part of the
frame — it is a label on the model, so it takes the sprite's own centre. A glyph run is
an **odd** number of pixels wide at scale 1 (`pixelTextWidth` is `4n - 1`), so unlike the frame it
can never sit exactly on the seam — but it must at least sit on the same side of it every frame,
and `round(p.x - ex - w / 2)` does not: the half pixel the odd width carries lands on top of the
camera's own fraction, so which way it rounds flips as the model walks and the tag hops a pixel
left and right against a body that is holding still. `centreTextX` rounds the position first (the
once-and-only-once rule in [CLAUDE.md](../../CLAUDE.md)) and then steps back a whole number of
pixels, `w >> 1`, which puts the run's **middle column** on `round(sx)` — the column
[hbMid](#the-centre-column-hbmid) draws, so the overlay runs straight down the middle glyph. Use it
for any text centred over a model; free-floating text (damage floaters, wheel labels) is not
centred on anything and keeps its own maths.

**Every other bar in the game is centred on its model directly** — none of them carries a badge, so
none of them needs `FRAME_DX`. `drawHealthBar(cxp, …)` centres an even-width bar on `cxp`, and
every caller hands it a true centre: `a.x - ex` for an
animal (whose sprite is placed at `round(a.x - w/2 - ex)`), `b.x - ex` for a robot, and the centre
of the **footprint** for a building — `sx + sh + (spr.width >> 1)`, which is where the sprite
centres itself, `+ sh` so the readout rides the hit shudder with the thing it belongs to rather
than holding still over a wall that is rocking. Bar widths are kept even for the same reason the
sprites are.

**The whole stack hangs off one `hy`**, not off `py` directly, for two reasons. It drops 6 rows
for a [prone](gameplay.md#prone-under-the-snow) pose, which starts that much lower in the same
16×16 cell — bars floating where a head no longer is look broken. And its alpha fades with
`concealOf(p)`: name tag, both bars, the level badge and the draw meter that says a shot is coming
all go with the cover, weighted so you keep a readable copy of your own (×0.55), your side keeps
most of theirs (×0.7) and a rival keeps none (×1, skipped entirely below 3%). A buried rival whose
draw meter still showed would make the whole thing pointless.

## Text over the world

White pixel text on a white snowfield is unreadable with a drop shadow, so everything drawn over
the world goes through `drawPixelTextOutline(ctx, text, x, y, color, outline, scale)` in
[font.js](../../js/font.js): the glyph stamped at the eight 1-px integer offsets in the outline
colour, then once in the text colour — a solid rim on every side, exactly 1 game px at any text
scale, no blur. The outline colour is the opaque `#0f1632` (the eight passes overlap, so a
translucent colour would stack unevenly). Sites: floaters (damage numbers, gold, `LEVEL n`),
the overhead name tags, the E and fish prompts, the radial-wheel labels, every number on the backpack
widget (the strip's food counts and gold, each bag cell's stack count, a gear cell's hover price),
the alive count and clock under the minimap — the alive icon is stamped with the same eight-offset
rim by `drawAliveIcon` — `state.msg`, the info stack, and the drop-UI text.
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

## Debug overlays: hitboxes and routes

What the sim tests, drawn over what the art shows — the two are deliberately different (a tree's
canopy overhangs the tile above it; an arrow is tested against a circle at the *chest*, 6 px above
the feet), and every collision question is faster to answer by looking than by reading. One key:
`.` toggles `settings.hitbox` in **any** mode, beside F3 and for the same reason — the title
screen's world is live and a spectated match is someone else's feet:

| `settings.hitbox` | draws |
| --- | --- |
| `0` | nothing (default; persists under the profile like every other setting) |
| `2` | bodies (tile boxes, unit circles, projectile points, pickup radii) plus the route every walker is following |

Colour carries the kind, so there is nothing to label: **cyan** a wall to everyone (`isSolidTile`,
so a multi-tile building boxes each of its footprint tiles), **blue** open water — a wall to
animals and robots, a hole a player falls into — **green** the body circle
`moveEntity`/`separateUnits` push apart, plus a dot on the anchor point itself, **red** the circle
an arrow is tested against, **violet** a walk-over pickup or a click target, **gold** a projectile
(a point, never a circle), **pink** the model's own centre column (`hbMid`).

Every shape is read from the expression the sim uses, never a copy of the number — an overlay that
disagrees with the sim is worse than none, because it is believed.

### The centre column (`hbMid`)

The one shape here that is about the **art** rather than the sim. The overhead frame — health bar,
stamina bar, level plate — is the only thing in the game that has to line up with a *sprite*
instead of with a number, and nothing else on screen shows where a sprite's middle is; a frame
three pixels off centre is invisible until something draws the line. Every player, animal, robot
and building gets one: movers off the exact camera (`ex`/`ey`), buildings off the rounded one
(`ox`/`oy`) and from the centre of the **footprint**, which is what a structure sprite centres
itself over whether or not it is wider than its tiles.

Every sprite in the game is an **even** number of pixels wide and centred on the seam between its
two halves, so the true middle is a pixel *boundary* and no 1 px line can sit on it. `hbMid` draws
at `round(centre)` — the column just right of that seam — which turns the test into a count: a
frame that is genuinely centred has as many columns strictly left of the line as it has from the
line rightwards. It is dotted so the frame it is measuring reads through it.

**Reaches and sight ranges are deliberately not drawn.** `WORK_REACH`, a wolf's bite and sight, a
turret's acquisition ring, the bird flush, the fish catch: they were in an earlier version of the
pass and are out again, because they are wide enough to bury the 7 px circle the overlay exists to
show, and because a sight range is per-target (`seenAt`) and so needs a design of its own rather
than a ring. They come back on their own terms later.

Both passes draw **above `renderLighting`** — the only world passes that do — because a debug view
has to be as readable at midnight as at noon. Rings are rasterised by `hbRing` as 1 px world
pixels rather than stroked with `arc()`: a stroke is anti-aliased, and the world blit magnifies a
soft edge into mush. It plots the left/right extremes by row and the top/bottom by column, so the
ring closes at every radius and a fractional one (`PLAYER_R` is 4.5) is not rounded away. `hbLine`
is the same idiom for a straight run, and its `step` is what dots a planned route leg.

### Routes

`drawNavPaths` runs from the same place, one layer under the hitboxes, because a route is on the
ground and a body stands on it. It draws the **plan, not the walk** — the line leaves the unit,
runs through the waypoints it has left (`nav.i` onward), and ends in a box on `nav.gtx`/`nav.gty`,
the tile the unit decided to go to, which is the answer to *why is it walking over there*. The leg
it is on now is solid and the legs beyond it are dotted, so a route being followed reads
differently from one being replanned. One colour per kind of walker, as on the minimap: slots
gold, a wolf red, the rest of the wildlife green, a worker bot blue.

Most routes are one leg: `navTo` takes the straight line whenever `navLineClear` allows it and
`navSmooth` collapses the rest, so a chain of waypoints means the unit is genuinely going around
something. `DBG.showPaths` still forces the same pass on by itself, whatever `settings.hitbox` is.

**Everything that walks has one of these**, grazing and patrolling included — see
[wildlife](gameplay.md#wildlife). That is what makes the overlay readable: a line always shrinks
into its box and ends on the tile the walker actually stops on. It used to be that an idling
animal held a random heading on a timer with no `nav` at all, so there was nothing honest to draw
and it stopped mid-stride wherever the clock ran out; wandering is a routed goal now, so that
whole class of "line that never shrinks" is gone.

The two exceptions are the two things that don't walk:

| Not a walker | Drawn as | Why |
| --- | --- | --- |
| a bird in flight | straight dotted line to `a.perch` + the goal box | it flies over the route grid, but the perch it's coming down on is a real decided destination |
| a fish | `hbArrow` — a barbed heading stub, teal, **no box** | it steers (`f.a`) and genuinely has nowhere it is going; a box would claim a destination that doesn't exist |

The arrowhead is the whole tell: **a barbed stub is a heading, a line ending in a box is a walk to
a decided place.** Keep that split if you add another mover — draw the box only when there is a
goal tile to put it on.

## Landmarks on the maps

A [landmark](world.md#landmarks) is a *named* place, so it has to be legible on every surface
that shows the world. `drawLandmarkIcon(g, L, x, y, col, rim)` is the shared stamp: the spec's
`icon` rects inside a 7×7 box, drawn once inflated by 1 px in a rim colour and once in the ink,
so the same glyph reads on parchment, on snow and over forest.

- **The minimap** (`renderMinimap`) draws the glyph for any landmark inside the disc, in the
  spec's `mark` over a dark rim. No name — `WOLF DEN` is wider than the whole 48 px disc.
- **The M map** (`renderWorldMap`) draws the glyph plus the name in map ink under it, clamped
  to the map rect so a landmark near the edge keeps its label. It opens mid-flight too (M in
  mode `drop`), where choosing between landmarks is the whole jump decision.
- **Arrival** — `updatePlay` keeps `state.loc` (`{ L, t }`) for the local slot from
  `landmarkAt(player.x, player.y)`, and `renderUI` shows a toast top centre for ~3.5 s whenever it
  changes: a dark plate ruled in the spec's `mark`, the glyph, the name at 2× and the `tag` under
  it. It fades in and out, so it uses `drawPixelTextShadow` (see
  [Text over the world](#text-over-the-world) — an outline stamped under `globalAlpha` goes
  blotchy).

## The end screens

A match ends on one of two full-frame ceremonies — `renderVictory` in the `victory` banner,
`renderDefeat` in the `defeat` one — and they are deliberately **one composition drawn twice**:
both read their anchors from `winLayout()` (in the same 270-tall authored frame every other screen
uses), so DEFEAT sits exactly where VICTORY sat and the rule, the tally and the kit strip land in
the same bands. `deadLayout()` reads the same `plankY`, so the planks sit under the tally on both.

**When each is up.** A win goes straight to its screen (`endMatch('won')` → `state.over = 'won'`).
A loss does **not**: an elimination only dims the play screen, because the match runs on underneath
and you can sit and watch it, so a lost match ends when you stop watching — **LOBBY** on the death
overlay opens the defeat screen (`openDefeat()`, `state.deadView = 'defeat'`) and that screen's own
single **LOBBY** plank is the door out. A respawn-pending death's LOBBY still leaves directly:
nothing has been lost yet. `endScreen()` is the one test for "a ceremony owns the frame" —
`renderUI`, `renderEventLog` and `replayShowing` all bow out under it (the replay window sits
exactly where the tally does); the held-TAB scoreboard and the info stack still draw over both.

**The two timelines.** `WIN_T` and `DEF_T` name every beat, and the render pass and the sound cues
(`winCues` / `defCues`, called from `update`) read one table each so they cannot drift apart. The
win is clocked off `state.deadTimer`, already ticking since the body fell; the loss has
`state.defeatT`, started when its view opens, which may be minutes later. Any press before the last
beat calls `endSkip()`, which jumps the relevant clock to the end.

- **Victory**: white bloom → **VICTORY** dropping in a letter at a time (each landing white, then
  gold, kicking up snow) → the gold rule sweeping out → braziers, team banners, the two-tier dais
  and the champion at 5× rising → a crown falling onto its head → four stat plates popping in with
  their numbers climbing from zero → the kit strip → the planks sliding up.
- **Defeat**: the same beats inverted. A colder, heavier wash → **DEFEAT** *falling* in a letter at
  a time on an ease-**in** (it drops, it does not spring), flashing cold rather than white → a
  **frost** rule (`drawGoldRule` takes a `pal`; `RULE_FROST`) → the stage *settling* rather than
  rising: the braziers out (`drawDeadBrazier` — the same ironwork with ash on the rim and a thread
  of smoke), a snow bank where the dais stood, the champion **prone and side-on** at the same 5×
  lying in it, an arrow planted beside it where the crown would be → five stat plates → the kit
  strip → one plank.

**What they print** is one frozen object either way — `endSnapshot()` on `state.end`, taken in
`endMatch` because the match keeps running underneath and a total that climbs behind a tally which
already counted it reads as a bug. The four shared columns are gold / kills / level / clock; the
loss puts its **placing** (`4/6`, off `place`/`of`) in front of them and names who did it under the
rule (FELLED BY *name*, in the killer's team colour, off `p.downedBy` — or the `DEATH_CAUSE` line
when the world did it). `drawEndTally` / `drawEndStatPlate` / `drawEndGear` / `drawEndPlanks` are
the shared passes: each takes the ending's timeline and its accent pair (`WIN_ACCENT` gold,
`DEF_ACCENT` frost), so one plate tallies both. `dy` on the planks slides them without moving the
rects `deadHit()` tests, so a plank is only clickable once it has arrived. The fallen champion
draws **no gear marks** — those sit on the standing body plan (see `drawPlayer`), which is why the
kit strip below is where the kit is read on that screen.

The art is procedural, in the title screen's idiom — `drawWinAurora` (three additive curtains of
2 px strands across the top band), `drawWinRays` (stepped wedges walking out from behind the
champion, blocks rather than an anti-aliased triangle), `drawWinMotes` (gold and snow falling from
`hash2` alone, no array; `cold` drops the sparks for the loss), `drawBlizzard` (wind streaks on the
same no-array idiom, a second speed under the motes), `drawWinBanner`, `drawBrazierIron` +
`drawWinBrazier` / `drawDeadBrazier`, `drawWinDais` and `drawDefeatDrift`. The drift's profile is a
cosine under a flattening root: a plain cosine domes, and a dome leaves the ends of a body lying on
it up in the air. It is drawn twice, once behind the body and once in front, so the champion lies
**in** the snow rather than on a hill. `stampGrid(rows, pal, x, y, s, rim)` paints a char grid at
any cell size, the shape [sprites.js](../../js/sprites.js) authors in, for the crown, the arrow and
the stat glyphs (`WIN_ICONS`) that never earned a baked sprite; the sprites the screens do use are
the champion, `SPRITES.gearIcons`, `itemGold` and `itemBow`.

**The death dim** underneath is the third state, and it is not a ceremony: a wash, **YOU COLLAPSED
IN THE SNOW** at 3× (2× on a view too narrow to hold it) in the upper band — it is the first thing
to read and the match is still playing behind it, so it goes where an eye lands rather than over
the body that fell — a second line saying whether this is permanent or a countdown, and two planks.

## Replay: the last four seconds

The `replay` banner keeps a rolling four seconds of what was on screen and plays it back in the
bottom-left corner while you are **dead** (the planks view, not while spectating, and never over
[the end screens](#the-end-screens)) or **paused**.
It records pixels, not state, so it costs nothing to keep and re-renders nothing to play.

**Why it is not drawn in the game canvas.** The window is `RP_W`×`RP_H` (160×90) *game* px, and a
480×270 view does not fit in a ninth of itself — eight of every nine pixels are gone before
anything is drawn, and no amount of stored resolution brings them back. The same corner of the
*screen* is `RP_W * devScale` px across (640 device px at a 1080p fullscreen's 4× scale), which is
**more** pixels than the view itself has. So the frame goes to its own canvas, `#replay`
(z-order above `#game`, `pointer-events: none`), positioned over that rect by `layoutReplay()` —
which `relayout()` calls, so it follows every resize and fullscreen toggle (camera zoom no longer
resizes anything). The game
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
bigger than the corner) runs with `imageSmoothingEnabled` on `rpAtx` — nearest there would sample
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
them — and both duck under the map/settings panels. The feed also stands down over
[the end screens](#the-end-screens); the scoreboard does not.

**The feed** (bottom left) is the last `EVENT_MAX` (4) lines of `events`, oldest at the top,
newest along the bottom. It has that corner to itself now the gear row lives in the
[backpack](#the-backpack-and-gear-widget), and shares it only with the
[replay window](#replay-the-last-four-seconds), stepping up by `replayLift()` px for as long as
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
the very last thing in `render()` (above every overlay and the info stack), so it sits on the
game's pixel grid at every zoom level. `cursorInfo()` resolves the pointer state once per
frame from `mouse`, `state`, `player` (draw/flounder/roll), and what's under the pointer, and
both the pixel cursor and the browser-cursor fallback read from it. It returns
`{ kind, mode, dim, frac, nock, dry, amb }`:

- `kind` **arrow** — dead (off a plank), paused, map, and anywhere in the title/settings/wheel that isn't
  a widget; **hand** — over a main-menu item (`menuHit()`), a death-overlay plank (`deadHit()`) or spectate arrow (`specHit()`), a settings widget (`settingsHit()`, shared with the click handler
  so hover and click can never disagree), a live wheel segment, or a control inside the backpack
  widget (`gearHit()` / `bagHit()`), or a free skill-point square on the hud strip
  (`abHit()` — the gold strip of the bag stays an arrow, see [The HUD corners](#the-hud-corners)); **grab** — dragging a
  slider; **hammer** — over a stump or finished structure (right-clickable; `dim` beyond the
  60 px reach); **reticle** — everywhere else in play.
- Reticle `mode` (table `RETICLE`): **idle** white cross; **lock** gold ring — E will work
  the object under the pointer (`workTarget()` is non-null: tree, rock, berried bush),
  dimmed when it is beyond `WORK_REACH`; **ice** the same lock in pale blue over bare ice;
  **hunt** amber breathing ring over an animal; **fish** water-blue ring over a fish; **bow** — while charging the ring closes as
  the draw fills and turns orange at full, like the meter. `dim` (50% alpha) also means tools
  are blocked right now: floundering in a hole, or mid-roll.
- Every reticle in play also carries the **bow's own state**, whatever the pointer is over, since
  the crosshair is where the eye already is: `nock` (0→1 as the renock cooldown elapses) draws
  four gold corner marks falling inward onto the ring, and `dry` (empty quiver) drops the centre
  pixel and greys the ticks — a hollow crosshair. `amb` (buried, settled: the next arrow is worth
  `AMBUSH_MUL`) grows a second segment out along each of the crosshair's **own axes** and warms the
  centre pixel to gold — deliberately on the cross, where the renock's marks are on the diagonals,
  so a bow that is both reloading and buried says two separate things at once. All three come from
  the one `ret()` helper inside `cursorInfo`, so no return site can forget them. See
  [the quiver](gameplay.md#the-quiver) and [Prone](gameplay.md#prone-under-the-snow).
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
  below at boot and sink away with the items on play. `PATCH_TXT` prints bottom-right and the
  profile name bottom-left (`drawNameTag`); both are click targets, and both ride the footer's
  fade so a panel hides them.
- **Buttons** are procedural frost planks (`drawMenuButton`): chamfered slab with hashed
  wood-grain, a snow cap along the top, icicles off the bottom, corner rivets and a gold rule
  when hot (no glow behind the hot plank - it lifts and warms only). `menu.hover[i]` eases 0→1 toward the selected item and drives lift (2 px, the
  shadow stays on the ground) and the warm fill; `menu.pressT`
  sinks it for a beat; the lift, warm fill and gold rule are the whole selection cue (no selector arrows).
- **Die** (`drawDie`): shows `1 + (SEED % 6)` (faces 1–6), cycles faces and jitters while hovered, tumbles while
  `menu.rolling`. Activating it (`rerollWorld`) starts a whiteout via `state.fade`
  (`{ a, to, spd, color, then }`, stepped in `update()`, painted after the info stack) and then
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
  PLAYER is `namePanelCv` (the `player profile` banner), opened by clicking the profile name
  bottom-left (`nameTagRect` / `overNameTag`, the mirror of the patch tag, with a quill glyph that
  gilds beside it) and once by itself on a first launch. It is the one panel that **owns the
  keyboard**: the `keydown` handler routes to `nameKey()` before its own shortcuts while it is
  up, so letters are text rather than hotkeys. A character the name may not hold is simply never
  drawn, the DONE plank dims while the buffer would be refused, and Enter on a refused one rattles
  the field red instead of printing a reason. Under the rule, the three lifetime stats read as a
  ledger — icon, labelled row (MATCHES / GOLD EARNED / BEST DAY, a deliberate text carve-out),
  dotted leader, number right-aligned with a thousands comma. The first-launch variant is modal
  (an outside click does nothing) and its second plank reads SKIP — the default name — where an
  edit reads CANCEL.
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
  the left, the minimap from the top, the backpack-and-gear widget from the right and the hud strip
  up from the bottom) while the camera settles onto the play framing.
  The first-run hint message fires when that intro ends.

`DBG` exposes `menu`, `menuHit`, `menuClick`, `menuKey`, `settingsHit`, `beginIntro` and
`layout()` (the live `SET_*`/`ROW_*`/`MM_*` anchors) for driving all of this headlessly.

## Eagle drop (mode `drop`)

Everything in the `eagle drop` banner. `beginDrop()` (from `lockIn`, or `startGame`/`DBG.beginDrop`)
puts every active slot aboard **its team's bird** (`p.aboard`) and builds
`state.drop = { eagles: [red, blue] }` via `makeEagles()`: one base line from `makeEagleRoute()` —
two points on a ring `EAGLE_R` (`WORLD/2 - 40`) tiles from the centre, roughly opposite, both from
`hash2` so the line is the seed's — flown in **opposite directions**, each bird shifted
`EAGLE_LANE` (2.5 tiles) along its own right-hand perpendicular so the mid-route pass is a fly-by,
~5 tiles apart, never a collision. `beginDrop` sets mode `drop`, snaps the world zoom to
`DROP_ZOOM` around its centre and starts the menu exit. Every rider gets a **wing seat**
(`p.seat`, dealt per team in `beginDrop`; `seatPos`
rotates the `EAGLE_SEATS` offsets — one on the back, two inner wings, two out on the primaries —
by the heading, and the human sits seat 0 of their own bird). Every flight takes exactly
`EAGLE_FLIGHT_T` (10 s) — each bird derives `e.spd` from its own line's length — and jumping is
**locked until the line's last `DROP_LOCK_T` (4 s)**: `dropJump` refuses (and `SFX.deny`s) an
unforced jump before then. The window's far end is `e.jumpEnd` from `lastOpenU` — the last point
on the line still over open ground (`borderDepth` + `DROP_EDGE_MARGIN` tiles clear), so **a forced
drop never lands in the treeline**; `e.jumpOpen` is the lock's fraction, clamped under it.
`updateDrop` (called from `updatePlay`, so pause stops it) runs
`updateEagle` per bird, keeps every rider glued to its seat, and force-drops each slot at its
`p.dropU`: AI slots at a hashed fraction of the jump window (scattered ±4 tiles off the line), the
human at `jumpEnd` if they never pressed Space/Enter/E/click (`dropJump` — the fall starts **from
the seat**, so the leap visibly leaves the wing). A profile that has **never jumped**
(`PROFILE.hasDropped()`, the drop-side gate of the `state.drop.firstFlight` flag) instead
auto-drops at `TUT_DROP_T` (8 s, near the tree edge and clear of the mid-route pass) behind a
`TUT_COUNT` (5 s) `PREPARE TO DROP` countdown — first-run onboarding; any real jump
(`PROFILE.markDropped`) retires it for good. A jumper free-falls for `FALL_T` (1.3 s), steering with WASD/arrows at
`DRIFT_SPD` (130 px/s, ~10 tiles over the fall) — `sampleHumanInput` keeps the movement axis alive in mode `drop` while zeroing
everything else; `landPlayer` then spirals out (up to 80 tiles) to the nearest tile with no object
and no water hole, which becomes `p.spawn` — the respawn point — with 2 s of i-frames and a snow
burst. Only the human's landing changes mode: `play` (closing the M map if it was up),
`applyZoom(0, true)` back to the player's own zoom centred on the landing, `shake`, and the
landing intro above.

**`state.drop` now outlives the whole match** — it never goes null, because the roosts are the
objectives. A bird's life is `fly → dive → down → flee → gone` (`e.state`): at the end of its line
`beginDive` throws any remaining rider, `findCrashPoint` walks 8–44 tiles further along the
heading for the first spot whose 7×7 holds ≥`MIN_CRASH_TREES` (20) trees — the roost sits properly
**inside** the woods, with the densest spot seen as the fallback (pure reads — no `rng()`, no
`hash2` — so a seed always buries its birds in the same trees) — and the stoop runs `EAGLE_DIVE_T` (1.4 s,
`u²`-eased, wingbeats quickening, speed motes streaming). `eagleCrash` then clears every tree
within `BOOM_R` (2.6 tiles) outright, snaps the ring out to `BOOM_STUMP_R` (3.6) to stumps —
**paying no gold**, a crater of free fells would warp the economy at minute one — plants the
**roost hitbox** (`eagle` objects on the open tiles within `EAGLE_TILE_R`, solid to walkers and a
rival-only E target; `eagleFlee` clears them again at liftoff) and fires `eagleBoomFx` (snow + team-colour
bursts, hanging feathers, a radial dust ring, two shockwave rings squashed flat over `BOOM_LIFE`
so they read as a blast wave along the ground, never a halo), distance-scaled `state.shake`,
`SFX.boom()` (the timber sample dropped low under a synth blast, layered on purpose) and a
`HAS LANDED` feed headline — the landing is a landing, not a wound: the bird takes **no damage**
from its own dive. The grounded bird is the team's **objective**, and its hp pool is its
**nerve**: `EAGLE_HP` (320), spooked down by rival arrows through `hurtEagle` (the sim.js arrow
loop tests the roost tiles themselves — *before* tile solidity, which would eat the shot — so the
arrow hitbox is exactly the collision box, corners included) and by rival E swings
(`EAGLE_WORK_DMG` via `hitObject`'s eagle branch). It is not helpless: a rival inside `GUST_R`
(resolved through `seenAt`, like every watcher) makes it rear — wings thrown open for
`GUST_WIND_T`, the whole telegraph — then `eagleGust` throws every rival in `GUST_BLAST_R` back at
`GUST_KB` with a `GUST_STUN` tumble and `risePlayer` (wind strips the snow off a buried body), on
a `GUST_CD` cooldown, dealing **no damage** — the objective punishes face-tanking, it never earns
kills. Left unhit for `PREEN_DELAY` it **preens**, recovering `PREEN_RATE` hp/s — the refilling
bar is the whole announcement, so chip damage must be pressed home. At zero nerve the bird is
**driven off, not killed**, and liftoff starts the **driven-off ceremony**, League-style:
`eagleFlee` clears the roost tiles, blasts the takeoff downdraft (`eagleGustFx` writ large,
`SFX.gust`), logs `WAS DRIVEN OFF` and sets `state.eagleCine` — the camera (its banner in
js/sim.js) glides to the fleeing bird and holds it centred, `sampleHumanInput` zeroes the local
controls exactly as pause does, `hurtEagle` refuses a second flee, and `checkLastStanding` waits.
`EAGLE_CINE_T` (3.2 s) after liftoff, `eagleFleeResolve` (ticked from `updateDrop`) puts the
owning side down permanently (`die(p, null, 'eagle')` / `teamEagleDown`, which `die`,
`updateRespawns` and `teamInMatch` all gate on — see [multiplayer.md](multiplayer.md#pvp)) and the
victory or defeat screen rises **over the escape still flying underneath** — the camera stays on
the bird through mode `dead` and only KEEP PLAYING (back to mode `play`) takes it back early. The
takeoff itself: over `FLEE_LIFT_T` the bird turns from wherever the dive left it pointing to
`fleeTo` (away from the world's centre, shortest arc) while climbing; then it flies at `FLEE_SPD`
until `FLEE_T`, when it is `gone` and draws nothing ever again.

Drawing: `drawDropAir` (above the world, below lighting) first dots **the flight path across the
snow itself** while mode is `drop` — each flying bird's whole line dashed in its team colour, dots
crawling toward the end so the line reads as a direction, with your own bird's jump window overlaid
in gold that brightens and pulses once the lock opens — then runs `drawEagle` per bird — the
`SPRITES.eagleShadow` silhouette `alt` px below and up to 10 px right of the body (`alt` is
`DROP_ALT` 56 px in flight, converging to 0 down the dive so shadow and bird meet at the crash
point), the bird itself in its team's armour (`SPRITES.eagleTeam[team]` cycling spread → mid →
back → mid, rotated to its heading, at `EAGLE_SCALE` 3× walking down to `EAGLE_REST_SCALE` 2×
through the dive, bobbing 3 px in level flight), **every rider on its wing seat** (unrotated so
the faces read, at `RIDER_SCALE` 2×, the local slot drawn last), and a pulsing gold landing ring
under the human's own bird — only while the jump window is open, so the ring never promises a jump
the lock refuses — then every faller: a `sin` **hop** off the wing
over the first quarter of the fall, then the shrink from `RIDER_SCALE` to 1× along
`alt = DROP_ALT·(1 − q²)` with a widening shadow. The faller cull is against `WV_*`, the world
pass rule — it was `VIEW_*` once, which is exactly why fallers in the far half of the zoomed-out
frame used to vanish mid-air. A `down` bird casts **no shadow** — it is on the ground, and a dark
copy under it read as a second bird — and folds its wings over `EAGLE_SETTLE_T` (the three
frames as a settle animation), then **rests**, breathing a ±1 px bob with a wing-shuffle idle
every 3.5–7 s (`RUFFLE_T`, mid frame only with a puff of settling snow — the full spread stays
the gust's telegraph, so the idle can never cry wolf), flashing via the baked
all-white `SPRITES.eagleFlash` when hit (it is taller than the 64×64 `drawSpriteFlash` scratch),
with its team-colour hp bar up **from the moment it roosts** — the bar is the objective's
introduction, anchored to the bird's rotated extent. A gust windup draws wings thrown open
(frame 0) lifted 2 px: the spread IS the telegraph, no text. A `flee` bird climbs back out —
scale and `alt` walk from the roost's numbers to the flight's over `FLEE_LIFT_T`, the shadow
returning and diverging as the ground falls away, wingbeats at full panic — and fades over the
last 1.4 s of `FLEE_T`; `gone` draws nothing. `renderDropUI` (mode `drop` only) draws the
**flight bar**, top centre: the whole line as one track, the flown part filled in team colour
under the chart-style bird diamond, the **jump window as a gold stretch** (dim while locked,
pulsing bright once open — the lock is taught by the bar's shape, no sentence), seconds left as a
number beside it (gold once open); the `PREPARE TO DROP` countdown over the bird on a profile's
first flight; `WASD - DRIFT` while falling; and an `M - MAP` keybind indicator bottom right —
the ride's wider read is the **M map** now (`renderWorldMap` also runs in mode `drop`, where it
draws each flying bird's line dashed in team colour with the bird diamond riding it; M/Esc are
handled in input.js's drop branch, the map swallows the jump click, and the sim keeps running
under it). Text scale follows the view (2× when tall). Once `down`, both objectives are marked on
the minimap disc and the M map as the same bird diamond in team colour.

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

