# Splitting js/game.js into eighteen files — the migration playbook

This is the approved, self-contained plan for breaking `js/game.js` apart. A session executing it
reads: Context, The mechanism, Ground rules, the SEP, the three Gates, and the current commit's
section — nothing else needs re-deriving. **One commit = one work session.** Tick the box here in
the same commit as the work.

## Status

- [x] Commit 1 — de-IIFE game.js in place
- [x] Commit 2 — js/core.js + js/canvas.js
- [ ] Commit 3 — js/player.js + js/input.js
- [ ] Commit 4 — js/world.js + js/nav.js
- [ ] Commit 5 — js/wildlife.js + js/structures.js
- [ ] Commit 6 — js/actions.js + js/ai.js + js/sim.js
- [ ] Commit 7 — js/draw-world.js + js/render.js
- [ ] Commit 8 — js/ui.js + js/panels.js
- [ ] Commit 9 — js/menu.js + js/screens.js
- [ ] Commit 10 — rename to boot.js + final docs sweep (deletes this file)

## Context

`js/game.js` is 12,619 lines — one strict-mode IIFE holding 468 functions, one class (`Player`),
and every game singleton, organized only by `// ------` banners. Goals: maintainability, a
sim/render seam toward real multiplayer someday, AI-tooling friendliness (files a session can load
whole), performance curiosity. **Honest note: splitting changes nothing at runtime** (same total
parse, same JIT) — the docs will say so plainly.

Migration is **incremental**: 10 commits, each leaving the game fully playable off `file://`, each
bumping `PATCH_TXT` by 0.01 with a one-sentence uppercase `PATCH_NOTES` entry, each pushed to main
directly.

## The mechanism (already validated — do not re-derive)

ES modules are impossible (`file://` must keep working; no bundler). But classic `<script>` tags
share one global scope: top-level `function` declarations become `window` properties; top-level
`let`/`const` become global lexical bindings visible **as bare identifiers** to every later classic
script. So: **de-IIFE the game code**. Each new file is flat top-level code with `'use strict';` on
line 1 (same semantics as today's IIFE) and section bodies move **verbatim** — bare identifiers
keep resolving. No export lists, no namespace rewrite; the ~1,058 bare-`ctx.` lines are never
touched.

Facts verified against the 1.59 source (trust these):

- The IIFE wrapper is exactly: line 2 `(function () {`, line 3 `  'use strict';`, last line
  `})();`. The whole body sits at one 2-space indent. Zero column-0 declarations, zero top-level
  `var`, zero top-level `this`, zero top-level `return`, no `arguments`/`eval`/`with` at module
  scope — de-IIFE changes no semantics.
- **No multiline template literals** (every line's backticks are paired), so a mechanical 2-space
  dedent cannot change any string's contents.
- **No duplicate module-scope declaration names exist today** — Gate A starts from a clean
  baseline. 61 lines declare multiple consts (`const A = 1, B = 2;`); the inventory grep captures
  only the first name per line, which is fine — it's line-consistent before/after a verbatim move,
  so losses still show. **Zero top-level destructuring declarations**, so the grep patterns see
  every module-scope declaration line.
- **Files are CRLF; `core.autocrlf=true`; no `.gitattributes`.** Any tool that rewrites game.js
  must preserve CRLF (the sed command in Commit 1 does).
- The legacy files' `typeof` uses are all internal object-shape checks (profile.js merge, audio.js
  volume guard) — none feature-detect globals, so game names becoming global cannot change their
  behavior.
- index.html: the three canvases (`#bars`, `#game`, `#replay`) precede the six script tags at the
  end of `<body>`; all new tags slot between `audio.js` and `game.js`, so `getElementById` always
  runs after the DOM exists. `#game`/`#bars` are grabbed in the canvas banner (→ canvas.js),
  `#replay` in the replay banner (→ screens.js).
- No game.js top-level name collides with `PROFILE`, `drawPixelText`/`Shadow`/`Outline`,
  `pixelTextWidth`, `SPRITES`, `SFXDATA`, `SFX`, or risky window built-ins.
- Duplicate `let`/`const` across files throws SyntaxError at load (loud, good). Duplicate
  `function` across files silently overwrites (silent, bad) — hence Gate A.
- Only **load-time** execution order matters across files. Runtime calls all happen after every
  script has loaded, so forward references between files are fine.
- The five existing files (profile, font, sprites, sfxdata, audio) keep their IIFEs untouched.
  **sprites.js has a UTF-8 BOM — no commit in this plan may rewrite it.**
- game.js touches `sessionStorage` twice (menu reroll write, boot read). That does NOT violate the
  "profile.js only" rule — that rule is localStorage-only. Do not "fix" it; document it (Commit 9).

## Safety net (do once, before Commit 1)

1. **Tag the last pre-split build**: `git tag pre-split && git push origin pre-split`. Any
   disaster is one checkout away from a known-good game.
2. **Record the baseline** in `docs/dev/split-baseline.txt` — a bare sorted identifier list,
   nothing else (Gate B diffs against it verbatim). Committed with Commit 1, deleted in Commit 10:
   ```bash
   grep -hE '^  (async )?(function|const|let|class) [A-Za-z_$]' js/game.js | sed -E 's/^  (async )?(function|const|let|class) ([A-Za-z0-9_$]+).*/\3/' | sort > docs/dev/split-baseline.txt
   ```
3. In the running game (`?seed=42`), record `Object.keys(DBG).length` (208 as of 1.60) and
   `Object.keys(DBG).sort().join(',')` in a second file, `docs/dev/split-baseline-dbg.txt` (also
   committed at Commit 1, deleted at Commit 10).
4. Screenshot the `?seed=42` title screen and a mid-match frame; keep them for eyeball comparison
   (outside the repo — the numbers in the txt are the durable record).

## The no-loss proof (run before EVERY commit — this is the feature-loss guarantee)

Features can only be lost here by (a) a line not making the move, (b) a duplicate name silently
overwriting, or (c) load-order breakage. Each has a mechanical detector:

- **Gate A — collision** (catches b):
  ```bash
  grep -hE '^(async )?function [A-Za-z_$]|^(const|let|class) [A-Za-z_$]' js/*.js | sed -E 's/^(async )?(function|const|let|class) ([A-Za-z0-9_$]+).*/\3/' | sort | uniq -d
  ```
  Must print **nothing**.
- **Gate B — inventory** (catches a): the union of all top-level identifiers across all game files
  must equal the baseline exactly:
  ```bash
  grep -hE '^(async )?function [A-Za-z_$]|^(const|let|class) [A-Za-z_$]' js/core.js js/canvas.js js/player.js js/input.js js/world.js js/nav.js js/wildlife.js js/structures.js js/actions.js js/ai.js js/sim.js js/draw-world.js js/render.js js/ui.js js/panels.js js/menu.js js/screens.js js/game.js js/boot.js 2>/dev/null | sed -E 's/^(async )?(function|const|let|class) ([A-Za-z0-9_$]+).*/\3/' | sort | diff - docs/dev/split-baseline.txt
  ```
  Must print nothing (`2>/dev/null` swallows the not-yet-existing filenames). From Commit 1 on,
  game.js is at column 0, so the column-0 pattern covers the residual too. A nonempty diff means a
  lost or duplicated declaration — find it before anything else.
- **Gate C — behavior**:
  1. `'use strict';` is line 1 of every game-code file (`head -1` them).
  2. Served smoke: `node tools/serve.js`, open `http://localhost:8471/?seed=42`, console must
     have zero errors.
  3. `file://` smoke: open `index.html?seed=42` straight off the disk, console clean, title
     renders. (file:// is the transport that catches fetch-shaped mistakes; load-order mistakes
     show on both.)
  4. `Object.keys(DBG).length` equals the baseline number; spot-check `DBG.freeze = true;
     DBG.warp(player, 1850, 1850); DBG.step(1/60, 120);` advances frames.
  5. Same-seed determinism: `?seed=42` world matches the baseline screenshots (same landmark
     layout, same treeline).
  6. `.` cycles hitboxes → routes → off; ESC opens settings; M opens the map.

## Ground rules for every commit

1. **Line numbers in this plan are from 1.59 and go stale after Commit 1.** Never cut by stored
   line number. Re-locate fresh every time:
   ```bash
   grep -n "// ------" js/game.js
   ```
   A top-level banner section runs from its banner line to the line before the next banner (or
   EOF).
2. **Move code verbatim.** No renames, no cleanup, no reformatting, no "while I'm here" fixes.
   Intentional dead code (checklists.md Known drift) stays. The ONLY permitted edits to moved code
   are the three banner-line edits named in Commits 3 and 5 — and those must use the exact
   existing banner style (copy a real banner line and change the name; `grep -n "// ------"
   js/*.js` and gamejs-map.md both key on this format).
3. Every new file's line 1 is exactly `'use strict';`, then a 1–3 line header comment in the voice
   of the existing file headers.
4. Docs update **in the same commit** as the code (repo rule). Each commit lists its exact doc
   edits. Tick this file's Status box too.
5. PATCH bump same commit: `PATCH_TXT` +0.01 and one uppercase sentence atop `PATCH_NOTES` (in
   game.js until Commit 9 moves them to menu.js).
6. Run Gates A, B, C plus the commit's **Noah playtest** before committing. Never commit on a
   failed gate.
7. Push only after Noah has done his playtest — commit locally, tell Noah what to check, push on
   his OK. This is the human verification point.

## Target layout — 18 files

Load-order rule (goes verbatim into index.html as a comment and into architecture.md): **a file
may reference names from any file at runtime, but its top-level (load-time) statements may only
reference names from files loaded above it.**

Script tags after `js/audio.js`, in exactly this order (this table is the banner→file assignment;
1.59 start lines in parens for orientation only):

| # | File | Banners moved in | ~Lines |
|---|---|---|---:|
| 1 | `js/core.js` | constants (5), rng (478), state (499), helpers (1665) | 445 |
| 2 | `js/canvas.js` | canvas incl. `---- world zoom` (227) — owns `let ctx`, fitCanvas, layout consts | 251 |
| 3 | `js/player.js` | players incl. all six sub-banners (620) **plus `---- damage & death` cut out of radial wheel** | 714 |
| 4 | `js/input.js` | input (1087) — the ten load-time listeners | 230 |
| 5 | `js/world.js` | world (1317), landmarks (3350, incl. lmRng) | 422 |
| 6 | `js/nav.js` | movement & collision (1745), pathfinding (1850, incl. NAV typed arrays) | 307 |
| 7 | `js/wildlife.js` | animals (2779), fish (2861) — **wolves + birds promoted to top-level banners** | 571 |
| 8 | `js/structures.js` | stump structures (2611), structures & robots (3544), worker flags (4080) | 1008 |
| 9 | `js/actions.js` | actions (2052) | 559 |
| 10 | `js/ai.js` | ai (4719) | 347 |
| 11 | `js/sim.js` | update (5066), fx updates (5800, incl. fxRng) | 810 |
| 12 | `js/draw-world.js` | ground prerender (1545, incl. groundCv), entity draw (6850), lighting & weather (7931) | 1078 |
| 13 | `js/render.js` | render (5876), debug overlays (6367), cursor & aim line (6588) | 974 |
| 14 | `js/ui.js` | radial wheel remainder (~88 lines), selection hints & wheel (7680), UI (8265) | 1256 |
| 15 | `js/panels.js` | scoreboard & log (9182), world map (9328), settings menu (9584), player profile (9791) | 814 |
| 16 | `js/menu.js` | main menu (9996) incl. champion select, gear screen, `PATCH_TXT`/`PATCH_NOTES`, sessionStorage reroll write | 1189 |
| 17 | `js/screens.js` | replay (8059), death & spectate (11185), victory (11431), defeat (11939) | 1154 |
| 18 | `js/boot.js` | eagle drop (12133), boot (12426) incl. sessionStorage reroll read, `window.DBG`, `requestAnimationFrame(loop)` | 486 |

Placement rationale (for the docs and future sessions): `helpers` (burst/addFloater/spawnDrop) is
the base layer with the most inbound edges and pushes to arrays rather than drawing → core.js.
`damage & death` is player lifecycle, not UI → player.js (`endMatch` rides along; noted in the
map). Eagle drop pairs with boot because `startGame()` → `beginDrop()` is the boot handoff. The
radial wheel is a widget (hover geometry + drawing) → ui.js. Sim files (3, 5–11) contain **no
drawing**; decoupling `ctx`/`burst`/`SFX` *calls* out of sim is explicitly OUT of scope — a
documented future multiplayer task.

Extraction is **base-first**, but be precise about what that does and does not guarantee: the
residual game.js always loads last with its internal order intact, and extracted files run in
table order — however several sections DO shift load-time position relative to the original
(`helpers` runs earlier than it used to; `ground prerender` and `actions` run later). **The safety
argument is not "order is preserved" — it is SEP step 6**: every moved section's top-level
statements must reference only names from files loaded above it. This has been pre-verified for
the whole file: the ONLY top-level statements that call another section's function at load are the
three `mulberry32(...)` seedings (`rng` in core.js #1; `lmRng` in world.js #5; `fxRng` in sim.js
#11 — all after core.js), the self-contained `SEED` IIFE (reads `location.search` only), the
`fitCanvas()` call inside the canvas banner (own file), and the boot chain (boot file, loads
last). Everything else load-time is literals, arithmetic on earlier consts, built-in constructors
(`new Map`/typed arrays), DOM lookups, and listener registrations. Still run step 6 every commit —
it is the tripwire for anything this survey missed.

## The Standard Extraction Procedure (SEP)

Commits 2–9 run this once per new file:

1. `grep -n "// ------" js/game.js` for current banner boundaries.
2. Read the whole span(s) to move, boundary to boundary.
3. Write the new file: `'use strict';`, header comment, banner sections pasted **verbatim in
   original relative order**.
4. Delete those spans from js/game.js (no gap markers; adjacent banners now abut).
5. Add `<script src="js/NEWFILE.js"></script>` to index.html at the layout-table position
   (game.js stays the last tag).
6. **Load-time dependency check**: scan the new file's top-level statements — declarations with
   initializers, bare calls, **method-call statements** (`window.addEventListener(...)`,
   `PROFILE.load()`, canvas sizing assignments), and any `const X = someFn(...)` initializer.
   Every identifier they reference must be defined in a file loaded above (or be a browser
   built-in). Each commit pre-lists its known load-time statements — if you find one NOT on the
   list, **stop and reassess before proceeding** (see Failure playbook F6).
7. Docs, same commit: architecture.md file-table row (Lines approx; Exposes: "shared scope, no
   window.* export"; one-line Role); gamejs-map.md File column for every moved banner row; keep
   index.html's comment above the game-code block accurate; tick the Status box here.
8. Gates A/B/C + targeted checks + Noah playtest → PATCH bump → commit → Noah's OK → push.

## Commit-by-commit

Every commit ends with a **"Noah verifies"** list: a ≤5-minute in-browser playtest in plain
gameplay terms, needing no DBG. That plus Gates A/B/C is the definition of done. Patch numbers are
relative: each commit is current `PATCH_TXT` + 0.01.

### Commit 1 — de-IIFE game.js in place (no new files)

The mechanism-proving commit: every binding becomes global, nothing moves.

1. Delete line 2 `(function () {` and line 3 `  'use strict';`; insert `'use strict';` as the new
   line 2 (under the title comment); delete the final `})();` line.
2. Dedent the entire body by one 2-space level mechanically, preserving CRLF endings — in Git
   Bash:
   ```bash
   sed -i 's/^  //' js/game.js
   ```
   (strips exactly the first two spaces of every line, touches nothing at end-of-line; safe
   because there are no multiline template literals — verified). Never hand-edit lines.
3. **Proof of no-op**: `git diff -w js/game.js` must show ONLY the wrapper lines (±3), and
   `git diff --stat` shows only game.js. Anything else → `git checkout js/game.js`, redo. Note
   for later archaeology: after this commit use `git blame -w` on game code (plain blame
   attributes every line to the dedent).
4. Commit `docs/dev/split-baseline.txt` and `docs/dev/split-baseline-dbg.txt` (from the Safety
   net) in this commit.
5. Docs: CLAUDE.md Architecture paragraph rewritten (five legacy IIFEs exporting one `window.X`
   each + flat shared-scope game code, split in progress; point at architecture.md for the table
   to protect the ~150-line cap). architecture.md gains a "Shared global scope" subsection: the
   mechanism, the load-order rule sentence, the collision behavior, the honest performance note.
   gamejs-map.md gains a migration header: "Split in progress — the File column says where each
   banner lives NOW."
6. Gates A/B/C (Gate B is trivially the baseline itself — run it anyway to prove the harness).
7. **Noah verifies**: double-click index.html. Title screen up, music plays, patch tag shows this
   commit's bump. Start a match, play ~2 minutes: walk, chop a tree, shoot something, open
   bag/map/settings. If it feels identical, it is — nothing moved.

### Commit 2 — js/core.js + js/canvas.js

- SEP for **core.js** (banners `constants`, `rng`, `state`, `helpers`). Known load-time
  statements: const tables, `let VIEW_W/VIEW_H/FULL_W`, `SEED`/`SEED_TXT` (reads
  `location.search`), `rng = mulberry32(SEED)`, `state`/`settings`/`perf` literals, entity-array
  literals, `MM_ZOOMS`/`MM_MIGRATE`/`mmCur`. No deps → first game file, fine.
  - **Verified quirk, do not "fix" it**: the `state` banner also physically contains the settings
    persistence pair (`saveSettings`/`loadSettings` → PROFILE), the minimap-size helpers
    (`mmStep`/`mmWant`/`mmScale`/`overMinimap`/`applyMinimapSize`), and **`relayout()`** (line 603
    at 1.59). They move to core.js **verbatim with their banner** — no cherry-picking functions
    across the cut. `relayout` writing canvas.js's layout globals (`MM_CX`, `PANEL_X`, …) is
    runtime-only and legal under the mechanism; record in the map that core.js's `state` banner
    includes relayout, and that `fitCanvas` (canvas.js) + `relayout` (core.js) remain the resize
    pair per the CLAUDE.md hard rule.
- SEP for **canvas.js** (banner `canvas` incl. world zoom). Known load-time: `canvas`/`uictx`
  getElementById, `let ctx = uictx`, `imageSmoothingEnabled`, worldCv/lightCv/barsCv/scratch/mmCv
  creation (`mmImg` needs `WORLD` → core.js), resize + fullscreenchange listeners, the load-time
  `fitCanvas()` call, layout consts from `VIEW_W/H`. Deps: core.js only → satisfied.
  - **Internal order is load-bearing**: the load-time `fitCanvas()` call (~line 373) precedes the
    layout `let` declarations (~443–471) in the original, and today's code only works because that
    call doesn't touch them. Verbatim order preserves this; do not "tidy" declaration order.
- gamejs-map.md: add the **File** column now (moved rows `core.js`/`canvas.js`, rest `game.js`).
- **Errata found executing this commit** (facts, verified against the source): the entity arrays
  (`animals`…`landmarks`) are NOT in the `state` banner — they sit at the tail of the `players`
  banner, so they ride to player.js in Commit 3, not core.js. `keys`/`mouse` are the first two
  declarations of the `input` banner, not the `state` banner — they ride to input.js in Commit 3
  (their initializers read `VIEW_W`/`VIEW_H` from core.js: legal, loaded above). Neither has any
  load-time reader, so the load-order rule holds either way. Also `DBG.warp` is `(tx, ty, p)` in
  tile coords, not `(p, x, y)` as Gate C's spot-check writes it.
- checklists.md: add a "moving code between js files" checklist mirroring SEP + Gates (strict
  directive; verbatim; Gate A; load-time deps; tag position; doc rows; full gate; never rewrite
  sprites.js).
- **Noah verifies**: resize the window and toggle fullscreen (no stretching, bars correct),
  wheel-zoom all the way in and out (pixels stay crisp at every stop), then 1 minute of normal
  play.

### Commit 3 — js/player.js + js/input.js

- SEP for **player.js**: banner `players` with all six sub-banners, **plus** the
  `---- damage & death` sub-banner found inside `radial wheel` (`grep -n "damage & death"
  js/game.js`; span ends at the next banner line; contains `damagePlayer`, `die`, `RESPAWN_TIME`,
  `updateRespawns`, `respawnPlayer`, `teamInMatch`, `checkLastStanding`, `endMatch`,
  `endSnapshot`). **Permitted edit #1**: retitle it in player.js as a top-level `damage & death`
  banner after the players content. The `radial wheel` banner keeps its ~88 remaining lines in
  game.js. Known load-time: `class Player` (evaluated at load, not hoisted — fine, boot runs
  later), `TEAMS = SPRITES.teams` (sprites.js loads far earlier), `CHAMPS`/`ITEMS`/`GEAR`/`CARDS`
  tables, `contests` Map.
- SEP for **input.js**: banner `input`. Load-time: the ten `addEventListener` calls
  (`keys`/`mouse` themselves live in the state banner → core.js). Listeners only call into other
  files at event time (runtime) → registering at load is unchanged behavior.
- gamejs-map.md: damage & death becomes a player.js row, noted "was under radial wheel".
- **Noah verifies**: start a match and touch every input once — WASD, mouse aim + fire, wheel
  zoom, E on a tree and a rock, space dodge, roll into an enemy, TAB scoreboard, F3, bag
  click-and-drag, `.` overlay. Then get killed on purpose: death screen appears, respawn timer
  runs, you come back at the Keep. Buy a gear piece and a skill point (gainGold/levelUp path).

### Commit 4 — js/world.js + js/nav.js

- SEP for **world.js** (banners `world`, `landmarks`). Load-time: `ground` Uint8Array + `objects`
  array, `LANDMARKS` table, `lmRng` (from `SEED` → core.js).
- SEP for **nav.js** (banners `movement & collision`, `pathfinding`). Load-time:
  `UNIT_MASS`/`BOUNCE`, `NAV_N = WORLD*WORLD` + four typed arrays (needs `WORLD` → core.js).
- **Noah verifies**: reload `?seed=42` — the world must look **exactly** like it did yesterday
  (same river, same landmarks; this commit is the determinism-risk one). Walk into
  trees/rocks/water (solid), shove another unit (they separate), plant a worker flag across the
  map and watch the robot route around obstacles to it.

### Commit 5 — js/wildlife.js + js/structures.js

- SEP for **wildlife.js** (banners `animals`, `fish` — which physically contains wolves + birds).
  **Permitted edits #2/#3**: promote the wolves and birds sub-banners to top-level `wolves` and
  `birds` banners in wildlife.js. Load-time: `ANIMAL_HP`/flee tables, FISH consts, `emergeSites`.
- SEP for **structures.js** (banners `stump structures`, `structures & robots`, `worker flags`).
  Load-time: `RES_COLORS`, `FLAG_JOBS`, robot/turret const tables.
- gamejs-map.md: wolves/birds get their own rows under wildlife.js (truer than the old
  cross-reference under animals).
- **Noah verifies**: hunt a prey animal (it flees, drops meat), aggro a wolf near its den (it
  hunts you, leashes when you run), scare birds up, crack an ice hole and net a fish, build +
  upgrade a structure, watch a turret shoot, plant every flag type from the wheel and recall one.

### Commit 6 — js/actions.js + js/ai.js + js/sim.js

Three files, one commit — actions and ai have zero load-time statements; sim has only `fxRng`
(from `SEED`) and the `flakes` array.

- SEP ×3 per the layout table (`actions`; `ai`; `update` + `fx updates`).
- **Noah verifies**: chop, mine, fish, shoot, dry-fire with an empty quiver, dodge-roll, tackle,
  go prone in snow and ambush something. Then idle and *watch the bots* for two minutes: they
  gather, build, and fight each other like before. Let day turn to night and back (snowfall,
  darkness ramp).

### Commit 7 — js/draw-world.js + js/render.js

- SEP for **draw-world.js** (banners `ground prerender`, `entity draw`, `lighting & weather`).
  Load-time: `groundCv` creation/sizing (needs `WORLD`/`TILE` → core.js), `SHAFT_PX`,
  `GEAR_MARKS`, `TUR_METAL`, `poseSpans`.
- SEP for **render.js** (banners `render`, `debug overlays`, `cursor & aim line`). Load-time:
  `HB_*`, `CUR_HOT`/`RETICLE`, `lastCssCursor`.
- Note: `ctx` already lives in canvas.js; these files reference it bare — no edit needed, that's
  the mechanism working.
- **Noah verifies**: pure eyeball pass — walk at night near a brazier (warm glow), weather
  visible, health bars/name tags/level badges sit square over heads, cursor changes over
  tree/rock/water/enemy, `.` shows hitboxes then routes, everything pixel-crisp at all zooms.

### Commit 8 — js/ui.js + js/panels.js

- SEP for **ui.js** (banners `radial wheel` remainder, `selection, hints & wheel`, `UI`).
  Load-time: `WHEEL_*`/`BAG_*`/`AB_*` consts, `mmView` creation, flash-state Maps/Sets,
  `abIconCache`, `mmMasks`.
- SEP for **panels.js** (banners `scoreboard & log`, `world map (M)`, `settings menu (ESC)`,
  `player profile`). Load-time: `EVENT_*`/`SB_*`/`NAME_*` consts, `events` array,
  mapCv/panelCv/setPanelCv/namePanelCv creation (need canvas.js consts → loaded), `dragSlider`.
- **Noah verifies**: HUD strip, XP bar, minimap ping, bag open/stash/drop, the four gear cells, a
  card draft, radial wheel, TAB scoreboard, M map, ESC settings — drag a slider, mute, change a
  setting, reload: **the setting stuck** (PROFILE round-trip). Open the name panel, edit the name,
  cancel, edit again, confirm.

### Commit 9 — js/menu.js + js/screens.js

- SEP for **menu.js** (banner `main menu` incl. title dressing, champion select, gear screen,
  `PATCH_TXT`/`PATCH_NOTES`, helpPanelCv/patchPanelCv, the sessionStorage reroll **write**). This
  commit's own bump is the first edit at the new location.
- SEP for **screens.js** (banners `replay`, `death & spectate`, `victory`, `defeat`). Load-time:
  `RP_*` + replay ring state + rpOv/rpAt canvases, `DEAD_*`/`WIN_*`/`DEF_*` consts.
- CLAUDE.md versioning rule now points at js/menu.js. architecture.md gets the note:
  "`softfall.reroll` is the only storage key touched outside profile.js; sessionStorage by design
  (write in menu.js, read in boot — survives the reload, not the tab)."
- **Noah verifies**: full title screen with dressing, patch tag opens the notes (this commit's
  entry on top), help panel, **reroll the world die** (page reloads into a new world — this
  exercises the cross-file sessionStorage pair), champion select → gear screen → lock in → eagle
  drop. Play to a win or a loss (or spectate to one): victory ceremony, defeat screen, the replay
  window mid-match, spectating after death.

### Commit 10 — rename to boot.js + final docs sweep

1. `git mv js/game.js js/boot.js` (only `eagle drop` + `boot` remain). Update index.html's last
   tag.
2. `git mv docs/dev/gamejs-map.md docs/dev/code-map.md`; reorganize as one section per file in
   load order (each with its banner→function table); drop the migration header and File column.
3. Delete `docs/dev/split-baseline.txt`, `docs/dev/split-baseline-dbg.txt`, and **this file**
   (`docs/dev/split-plan.md`) — the migration is over; the tag `pre-split` keeps the history.
4. Sweep every stale reference:
   ```bash
   grep -rn "game\.js\|gamejs-map\|split-plan" CLAUDE.md docs/ index.html tools/
   ```
   Fix each: CLAUDE.md deep-docs table links, the "one ~12000-line IIFE" sentence (now false —
   rewrite), `window.DBG (end of js/game.js)` → boot.js; architecture.md final table pass + "Five
   IIFEs" opener; checklists.md DBG pointer + the stale "same four scripts" line → "the same
   script set as index.html"; prune Known-drift entries this migration fixed.
5. Gates A/B/C + **Noah verifies**: double-click index.html, play one full match start → victory
   or defeat, off both file:// and the served URL.

## Failure playbook

Symptoms → cause → fix. Work top-down; don't guess past the console.

- **F1 — Blank/black page, console: `SyntaxError: Identifier 'X' has already been declared`** → a
  `let`/`const` exists in two files (a span was copied but not deleted, or cut boundaries
  overlapped). Gate A output + `grep -n "\bX\b" js/*.js` finds both; delete the stray copy. This
  error is the mechanism *protecting* you.
- **F2 — Console: `ReferenceError: Cannot access 'X' before initialization`** (TDZ) or **`X is
  not defined`** at load → a top-level statement in an earlier file references a name from a later
  file. Fix by the load-order rule: move that one statement into the file that owns the name
  (preferred, if it belongs there) or accept that the whole section belongs later and move the
  section; never reorder script tags away from the layout table without updating it and the docs.
- **F3 — Game boots, one feature silently wrong** (a tool does nothing, a panel won't open) →
  suspect (i) duplicate `function` overwrite — run Gate A; (ii) a half-moved function (top in one
  file, closing braces left behind) — Gate B catches the lost name; (iii) a listener registered
  twice — check the input banner wasn't duplicated. Compare the moved span against the previous
  commit: `git show HEAD~1:js/game.js` and diff the section text against the new file.
- **F4 — Same seed, different world** → an `rng()` call's order changed (the one unforgivable in
  genWorld). Nothing in this plan reorders code around genWorld, so this means a cut crossed a
  banner boundary. Revert the commit (F7) and re-cut.
- **F5 — Works served, breaks off file://** (or vice versa) → almost certainly a path/asset
  mistake, not scope: check the new `<script src>` value is a relative `js/...` path with
  exact-case filename. If the page shows a *stale* build (old patch tag), it's browser cache —
  hard-refresh (Ctrl+Shift+R).
- **F5b — `git diff` shows every line of a file changed** → a tool converted line endings (repo
  is CRLF, `core.autocrlf=true`, no .gitattributes). `git checkout` the file and redo the edit
  with a CRLF-preserving method (the sed in Commit 1, or a surgical editor — never a whole-file
  re-save from a tool with its own EOL opinion).
- **F6 — SEP step 6 finds an unlisted load-time statement** → stop. Determine what it references.
  If only earlier files: proceed, and add it to this plan's list for the record. If it references
  a later file: it is evidence the section assignment is wrong — reassess the file boundary with
  Noah before cutting, don't improvise a hoist.
- **F7 — A pushed commit turns out broken** → `git revert <sha>` (restores the previous
  fully-playable state — every commit is self-contained), bump PATCH again for the revert commit
  per repo rule, push, then re-attempt the extraction fresh. Never fix-forward a broken split
  commit with piecemeal patches.
- **F8 — The mechanism itself fails at Commit 1** (some environment rejects shared globals — not
  expected in any browser): revert to the `pre-split` tag and fall back to Plan B: keep game code
  in per-file IIFEs that each attach their section's names to one shared `window.SF` namespace
  object, and rewrite call sites section-by-section. Plan B is ~100× more edit surface — only on
  demonstrated failure of Plan A, never on suspicion.
- **Mid-migration pause is safe by design**: the repo is fully playable after every commit, and
  gamejs-map.md's File column plus this file's Status list always say where everything currently
  lives. Any future session can resume at the next unticked commit.

## Risks (residual)

| Risk | Mitigation |
|---|---|
| Load-time TDZ/order violation | Base-first order + SEP step 6 + loud ReferenceError caught by Gate C smoke (F2) |
| Silent `function` overwrite | Gate A every commit |
| A declaration lost in a move | Gate B inventory diff every commit |
| Missing `'use strict'` mints silent globals | Gate C step 1 |
| Wrong cut boundary from stale line numbers | Ground rule 1: re-grep banners; cut boundary-to-boundary |
| `let ctx` (~1,058 refs) | Deliberately untouched — shared global in canvas.js; parameterizing it is the future render-decoupling task, recorded in architecture.md |
| Map stale mid-migration | File column updated in the same commit as every move |
| sprites.js BOM corruption | No commit touches sprites.js; checklist warning (Commit 2) |
| Broken commit on main | Playtest-before-push (ground rule 7); F7 revert path; `pre-split` tag |
