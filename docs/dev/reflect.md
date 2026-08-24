# Reflect — the standing fix list

**This is a working plan, not a reference doc.** Every entry below is a verified mismatch
between what this repo *says* and what its code *does*, paired with a goal that closes it.

**Delete entries as they land. When the last one goes, delete this file.** That is not
housekeeping — it is the whole point. A findings document that outlives its findings becomes
exactly the thing it was written to fix: a confident, stale page that a future session acts on
without re-verifying. This file is allowed to exist only while it is shrinking.

Findings were produced by reading every banner of [js/game.js](../../js/game.js) and all four
support files against the docs, then re-verifying each one directly in the code. Every line
number and quotation below was checked by hand; see [How this was verified](#how-this-was-verified).

---

## How to read a goal

Each entry states the mismatch, why it matters, then a goal in three fields. Those fields carry
the SMART properties so the goals stay readable instead of turning into five bullets apiece:

| Field | Carries | Meaning |
| --- | --- | --- |
| **Change** | **S**pecific | The exact edit, named down to the file and line. No "improve the docs". |
| **Done when** | **M**easurable | A command that prints a known result, or a browser check with a stated outcome. Pass/fail, not judgement. |
| **Size** | **A**chievable + **T**imely | Sized in sittings, with a fixed order. See below. |

**R**elevant is argued in the prose of each entry — specifically, what a future session gets
wrong if the line stays as it is. That is the only reason any of these matter.

**On "timely".** There are no calendar dates here on purpose: inventing deadlines for a project
worked on when you feel like it produces goals that are precise and false. Instead every goal is
sized in **sittings** (one focused pass at the keyboard) and given a **fixed position in a
sequence**. The deadline is ordinal, not calendar: *D-group before F-group, F-group before P.*
That keeps "timely" honest and still gives each goal a bound it can miss.

**Each sitting is one commit.** Per [CLAUDE.md](../../CLAUDE.md), every push to main bumps
`PATCH_TXT` by 0.01 and adds one plain-English sentence to the top of `PATCH_NOTES`, in the same
commit, before the push. Three sittings means three patch bumps. Don't batch them.

---

## Sitting 1 — stale doc lines (goals D1–D8)

Eight statements that are false today. All are pure prose edits: **no code changes, no behaviour
change, nothing to verify in the browser.** Doing them as one commit is correct and cheap.

These are first because they are the highest-damage-per-byte problem in the repo. CLAUDE.md loads
in full at the start of *every* session, so a wrong line there is wrong in every future
conversation before any work begins.

---

### D1 — "Night is visual only for now" is false

[CLAUDE.md:11](../../CLAUDE.md) reads:

> `- Night is visual only for now.`

Night has two real mechanical effects:

1. **Wolves see further in the dark.** [js/game.js:2092](../../js/game.js) is
   `let bd = WOLF_SIGHT * (1 + state.darkness * 0.75);` — aggro range grows from 96 px to 168 px
   at full dark. The comment on that very line says *"night gives the pack its teeth"*.
2. **The only passive heal is switched off at night.** [js/game.js:3548](../../js/game.js) gates
   regeneration behind `state.darkness < 0.3`.

**Why it matters:** this is the single worst line in the repo. It sits in the file that opens
every session, and it tells you a system is inert when it is in fact the game's main night-time
pressure. A session that trusts it will "add night mechanics" on top of two that already exist,
or balance wolves without knowing their range nearly doubles after dusk.
[docs/dev/world.md:159–169](world.md) already describes both effects correctly — the deep doc is
right and the root file is wrong, which is the worst way round for this to be.

- **Change:** replace CLAUDE.md:11 with a line naming both effects, worded to match
  world.md:159–169 so the two cannot drift apart again.
- **Done when:** `grep -n "visual only" CLAUDE.md` returns nothing, and the replacement line names
  both the wolf-sight scaling and the daylight-gated regen.
- **Size:** 5 minutes. First in sitting 1 — it is the highest-value edit in this file.

---

### D2 — a WOLF DEN is not "the only hostile thing"

[CLAUDE.md:10](../../CLAUDE.md) reads:

> `- The world has named **landmarks**: a WOLF DEN (the only hostile thing) and a ROOKERY (birds).`

The landmark half is exactly right. The parenthetical is not — two other things damage players:

- **Rival players.** `PVP = true` ([js/game.js:51](../../js/game.js)) and the arrow-vs-player test
  at [js/game.js:3194](../../js/game.js) damages any slot on another team.
- **The ice.** Falling into a carved hole deals `HOLE_FALL_DMG` 15
  ([js/game.js:3447](../../js/game.js)) and has its own death headline:
  `DEATH_CAUSE = { ice: 'FELL THROUGH THE ICE', ... }` at [js/game.js:2737](../../js/game.js).

**Why it matters:** it is a small phrase doing real damage in a free-for-all game. A session
reading "the only hostile thing" reasonably concludes there is no combat threat model to think
about — in a codebase whose whole player architecture exists to make six slots fight each other.

- **Change:** narrow the parenthetical to "the only hostile **wildlife**".
- **Done when:** `grep -n "only hostile thing" CLAUDE.md` returns nothing.
- **Size:** 2 minutes.

---

### D3 — game.js is 7414 lines, not ~6700

Stated twice:

- [CLAUDE.md:62](../../CLAUDE.md) — "`game.js` is one ~6700-line IIFE organized only by `// ------ name` banners."
- [docs/dev/gamejs-map.md:3](gamejs-map.md) — "`game.js` is one ~6700-line IIFE with no internal module boundaries…"

`wc -l js/game.js` reports **7414**. Off by ~700 in both places.

**Why it matters:** on its own this is cosmetic — nobody makes a wrong decision because a file is
described as 700 lines shorter than it is. It earns its place here for a different reason: it is
the cheapest possible signal of whether these docs are being maintained. A number that has been
wrong across ten patches tells the next session to distrust everything near it. Fixing it is
almost free and restores that signal.

- **Change:** both occurrences to "~7400-line".
- **Done when:** `grep -rn --exclude=reflect.md "6700" CLAUDE.md docs/` returns nothing.
  (The exclude is needed on every check in this file that scans `docs/` — this page quotes the
  strings it is hunting, so without it the check can never pass.)
- **Size:** 2 minutes. Consider whether to keep an exact figure at all — a rounded "~7400" will
  drift again by design. That is fine; it is meant to convey scale, not precision.

---

### D4 — the `fx updates` banner has no row in the banner table

`js/game.js` has **35** `// ------` banners. [docs/dev/gamejs-map.md](gamejs-map.md)'s table has
35 rows, but `canvas` occupies two of them — so only **34 distinct banners** are covered. The one
with no row of its own is **`fx updates`** at [js/game.js:3554](../../js/game.js), which owns
particles, floaters, footprints, drops and the world-space snow flakes. It appears only as a
parenthetical inside the `lighting & weather` row.

**Why it matters:** this is the one finding where a doc gap directly causes the behaviour CLAUDE.md
tries to prevent. That file says *"find any function by its banner in docs/dev/gamejs-map.md —
read it before grepping blind."* A session looking for where particles tick will consult the
table, not find it, and grep blind — which is precisely the failure the table exists to stop. The
table's own stated rule ("add the new banner to the table below") has simply not been applied.

- **Change:** add a row — *particles, floaters, footprints, drops, world-space snow* →
  `addFloater` / `burst` / `fitFlakes` → `fx updates` — positioned between `update` and `render`
  to match code order. While there, fix the row order of `fish` and `landmarks` (the table lists
  landmarks first; the code is fish at 1869, landmarks at 2210).
- **Done when:** every banner name from
  `grep -o '// -\{10,\} .*' js/game.js` appears in the table, `fx updates` included.
- **Size:** 10 minutes.

---

### D5 — sprites.js has seven repair rows, not "one"

[CLAUDE.md:121](../../CLAUDE.md) and [docs/dev/sprites.md:42](sprites.md) both describe **one**
row that repairs a mangled byte (sprites.md narrows it further to "one heart row"). There are
**seven** `.replace()` calls in [js/sprites.js](../../js/sprites.js):

| Line | Sprite | Note |
| --- | --- | --- |
| 299 | stump row 6 | |
| 474 | imp1 row 8 | |
| 477 | imp1 row 11 | |
| 648 | wall row 7 | |
| 655 | wall row 14 | `/g` — three occurrences on one row |
| 1150 | heartHalf row 1 | **no-op**: `'orRoGgo.'.replace('g', 'g')` |
| 1159 | heartEmpty row 1 | |

Only two are heart rows, and one of those two does nothing.

**Why it matters:** this rule exists to stop someone destroying the sprite grids with a careless
re-encode. Told there is *one* repair, a session that goes looking will find one, fix it, and
leave six live ones untouched — believing the file is now safe. The failure mode is quiet:
`bake()` sizes each canvas from `rows[0].length` alone, so an unmatched palette character is
indistinguishable from a transparent pixel. A broken repair shifts a grid row one column sideways
and simply renders slightly wrong, with no error anywhere.

- **Change:** both lines to say **seven** rows across five sprites (stump, imp1, wall, heartHalf,
  heartEmpty); drop sprites.md's "heart" qualifier. Note that 1150 is currently a no-op.
- **Done when:** `grep -c '\.replace(' js/sprites.js` prints `7` and both docs say seven.
- **Size:** 5 minutes. **Do not delete the no-op at 1150 in this sitting** — that is a code change,
  and it belongs in [Known drift](checklists.md#known-drift) as deliberate residue first.

---

### D6 — sprites.md describes a tool bar that does not exist

[docs/dev/sprites.md:31–33](sprites.md) reads:

> The tool-bar icons (`itemBow`/`itemAxe`/`itemPick`) are 8×8 grids sharing `AXPAL` and are drawn
> at a crisp 2× in `renderUI()`.

There is no tool bar, and `renderUI` never draws these. Grepping the three names returns exactly
four lines, and both consumers draw at **1×**:

- `drawHeldTool` ([js/game.js:4520](../../js/game.js)) — `ctx.drawImage(icon, -4, -4)` after a
  translate/rotate, resolving through `SPRITES[t.icon]` from the `TOOLS` table.
- `drawRobot` ([js/game.js:4368](../../js/game.js)) — picks axe or pick for the robot's swing.

The phrase "tool-bar" is residue from a hotbar that was removed.

**Why it matters:** it points at the wrong function *and* the wrong scale. Someone restyling the
tool icons will open `renderUI`, find nothing, and have no idea where to look — while the real
call site sits inside a rotated canvas transform where a 2× assumption would be actively wrong.

- **Change:** rewrite to name `drawHeldTool` and `drawRobot`, state 1×, and drop "tool-bar".
- **Done when:** `grep -n "tool-bar" docs/dev/sprites.md` returns nothing and the passage names
  both real call sites.
- **Size:** 5 minutes.

---

### D7 — gameplay.md calls a live refund path dead

[docs/dev/gameplay.md:388–390](gameplay.md) reads:

> the `hitObject()` structure-damage branch and `destroyStructure(o, true)` refund path still
> exist but nothing reaches them now that E ignores structures.

Half true, and **the false half is the dangerous one.**

- ✅ The `hitObject()` structure-damage branch ([js/game.js:1682](../../js/game.js)) really is
  unreachable. Its only caller, `swingHit`, filters structures out first:
  `if (o.type !== 'stump' && o.type !== 'part' && !STRUCTS[o.type]) hitObject(o, p);`
  ([js/game.js:1554](../../js/game.js)), and `hitObject` has no other call site.
- ❌ `destroyStructure(o, true)` runs on **every demolition**. `demolishStruct`
  ([js/game.js:1791](../../js/game.js)) is a two-line function whose entire body is
  `destroyStructure(o, true)`, reached from `runCmd` for the wheel's demolish order. The refund
  loop spawns `floor(total / 2)` individual 1-gold drops — **23 separate coin entities** for a
  fully-upgraded wall.

**Why it matters:** this sentence reads as "refunds are dead code you may delete." Deleting that
path would silently remove every demolish refund in the game and, in the process, stop spawning 23
entities that a future performance investigation might otherwise be hunting for. It is the one
finding in this file where acting on the doc as written breaks the game.

- **Change:** split the sentence. Keep the `hitObject()` branch described as unreachable; state
  plainly that `destroyStructure(o, true)` is the live demolish path and describe the drop count.
- **Done when:** the passage no longer groups the two, and demolish is described as live.
- **Size:** 5 minutes.

---

### D8 — four wrong numbers and one wrong grid size

Small, individually trivial, worth one pass together:

| Doc | Says | Actually |
| --- | --- | --- |
| [world.md:39](world.md) | "never scan the 36k grid" | `WORLD` is 232, so the grid is 232² = **53,824** tiles. The 36k figure is from the old 192² world. |
| [world.md:39](world.md) | implies no per-frame full-grid scan | True of `updateStructures`, **false of `updatePlay`**: [js/game.js:3283](../../js/game.js) is an unconditional `for (const o of objects)` over all 53,824 slots every sim step, just to decrement `flash`/`shake` and tick bush regrow. |
| [rendering.md:383](rendering.md) | `drawDie` shows `SEED % 6` | [js/game.js:6293](../../js/game.js) is `let face = 1 + (SEED % 6);` — faces 1–6. `SEED % 6` would give 0–5. |
| [rendering.md:431](rendering.md) | eagle flies "~14–18 s" | `EAGLE_R` = 232/2 − 40 = 76 tiles = 1216 px; endpoints are separated by π ± 0.7 rad, so the chord is 2284–2432 px, and `len / EAGLE_SPD` (170 px/s) is **13.4–14.3 s**. The 18 s upper bound is impossible for any seed. |

**Why it matters:** the eagle and die numbers are cosmetic. The world.md line is not — it is
phrased as a performance guarantee ("per-frame ticks never scan the grid"), and it points at the
wrong place. Anyone profiling a frame-rate problem will trust it and skip the one loop in
`updatePlay` that genuinely touches all 53,824 slots every step.

- **Change:** all four numbers; reword world.md:39 to scope the guarantee to `updateStructures`
  and name the `updatePlay` scan as the real full-grid pass.
- **Done when:** `grep -rn --exclude=reflect.md "36k" docs/` returns nothing;
  `grep -n "SEED % 6" docs/dev/rendering.md` returns nothing; the flight range reads 13–15 s.
- **Size:** 10 minutes.

---

## Sitting 2 — code footguns (goals F1–F3)

Three places where the code contradicts a stated hard rule. **All three are harmless right now** —
none produces a visible bug today. They are worth a sitting anyway because each is a trap armed
and waiting: the next feature that walks past it triggers it, and the resulting bug will look
completely unrelated to its cause. That is the exact failure mode CLAUDE.md's hard rules exist to
prevent.

These come second because unlike sitting 1 they touch behaviour, so each needs verifying in the
running game — `node serve.js`, `?seed=N` pinned, before/after screenshots.

---

### F1 — one `players` loop is missing its `inAir` check

CLAUDE.md's hard rule: *"A loop over `players` that touches the world must skip `inAir(p)`
(riding or falling from the eagle) alongside `!p.active`/`p.dead`."*

Thirteen loops obey it. One does not — the swing-arc render pass at
[js/game.js:3934](../../js/game.js):

```js
for (const p of players) {
  if (!p.active || p.dead || p.swingT <= 0) continue;
```

**Why it matters:** it is safe today **purely by accident** — a slot on the eagle cannot start a
swing, so `swingT` is always 0 and the loop body never runs for an airborne player. Nothing
enforces that. Any future change that lets a falling player act (a mid-air ability, a swing that
survives the jump, a debug stage) turns this into a swing arc drawn in world space at the
coordinates of someone 56 px up in the sky. The bug would appear in the renderer, far from
whatever change caused it.

- **Change:** add `|| inAir(p)` to the guard at [js/game.js:3934](../../js/game.js).
- **Done when:** `grep -n "for (const p of players)" js/game.js` — every world-touching hit also
  tests `inAir`. Verified in the browser: `DBG.beginDrop()`, step frames, confirm no arc renders
  and nothing else changes against a same-seed before-shot.
- **Size:** 10 minutes including verification.

---

### F2 — `renderLighting` mixes a rounded camera with an exact position

CLAUDE.md's hard rule: *"Screen position is `round(world − camera)`, rounded exactly once.
Statics subtract the rounded `ox`/`oy`; moving entities subtract the exact `ex`/`ey`."*

`renderLighting` is called with the **rounded** camera (`renderLighting(ox, oy, now)`, line 3960)
but draws the player's personal night glow against the **exact** player position —
[js/game.js:4834](../../js/game.js):

```js
const lx = player.x - ox, ly = player.y - 4 - oy;
```

That is a rounded camera subtracted from an unrounded entity: precisely the mix the rule forbids.

**Why it matters:** invisible today because the glow is a soft radial gradient with no hard edge —
a ±1 px wobble in a 44 px feathered falloff cannot be seen. Add any hard-edged light to that block
(a campfire, a torch, a lit window) and it will shimmer against the world while you walk, and the
cause will not be in the code you just wrote.

There is a second, quieter half to this: `drawPlayer`, `drawGhost`, `drawAnimal`, `drawBird` and
`drawRobot` all declare their parameters as `(..., ox, oy, ...)` but are called from the draw loop
with `ex, ey`. Each function body therefore *reads* as though it receives the rounded camera when
it does not. The naming actively teaches the wrong lesson to anyone reading those bodies.

- **Change:** in the glow block, either pass the exact camera or round the player position once —
  whichever keeps a single rounding. Separately, rename those five parameters to `ex, ey` to match
  what is actually passed.
- **Done when:** no expression in `renderLighting` subtracts a rounded camera from an unrounded
  world coordinate. Verified in the browser: same seed, night staged via `DBG.state.time`, glow
  screenshot unchanged.
- **Size:** 20 minutes. The rename is mechanical but touches five functions — do it in the same
  commit or not at all.

---

### F3 — the `LANDMARK_ORDER` comment is backwards

[js/game.js:2288](../../js/game.js):

```js
const LANDMARK_ORDER = ['wolfDen', 'rookery']; // placement order: the pickiest site first
```

The comment is wrong. `wolfDen` has `r: 5` ([js/game.js:2239](../../js/game.js)) and `rookery` has
`r: 6` ([js/game.js:2262](../../js/game.js)); `landmarkSite`'s free-tile threshold scales with disc
area, so the rookery's 113-tile footprint is the **pickier** of the two — and it is placed
**second**.

> ⚠️ **Fix the comment, not the array.** `placeLandmarks` draws from the `lmRng` stream in
> `LANDMARK_ORDER` sequence ([js/game.js:2343](../../js/game.js)). Reordering the array reshuffles
> the landmark layout of every existing seed — every screenshot, every pinned `?seed=N`
> reproduction, every "same world" comparison in this repo's history.

**Why it matters:** this is the most dangerous entry in the file, precisely because the fix looks
so obvious. A future session reads a comment saying "pickiest first", checks the two radii, sees
they are in the wrong order, and swaps the array — a one-token change that silently invalidates
every seed the project has ever used, with no error and no visible failure. The comment is the
bug.

- **Change:** correct the comment to say the rookery is the pickier site and is placed second, and
  add an inline warning that the array order is a seed-stability contract.
- **Done when:** the comment matches the radii, and `LANDMARK_ORDER` is byte-for-byte unchanged.
  Verified in the browser: `?seed=4242` still places dens at (60,123), (119,157), (141,118) and
  rookeries at (101,167), (125,87), (159,169) — read off `DBG.landmarks`.
- **Size:** 10 minutes including the seed check. **Do the seed check** — it is the entire point.

---

## Sitting 3 — one policy decision (goal P1)

### P1 — decide what "show, don't label" actually means, then write that down

CLAUDE.md states the rule with no exceptions:

> **Communicate through visuals and visual indicators wherever possible; avoid text labels and
> explanatory text.** … If you catch yourself writing a hint string, build the affordance instead.

The codebase carries at least seven live hint strings:

| Location | String |
| --- | --- |
| [js/game.js:1631](../../js/game.js) | `showMsg('RIGHT CLICK THE STUMP TO BUILD ON IT', 5)` |
| [js/game.js:3124](../../js/game.js) | `showMsg('EARN GOLD - HOLD E AT A TREE OR ROCK', 6)` |
| [js/game.js:5291](../../js/game.js) | `'(Q)'` keycap beside the berry counter |
| [js/game.js:5297](../../js/game.js) | `'(F)'` keycap beside the fish counter |
| [js/game.js:5595](../../js/game.js) | `'M CLOSE'` |
| [js/game.js:5810](../../js/game.js) | `'ESC CLOSE'` |
| [js/game.js:6485](../../js/game.js), [:6503](../../js/game.js) | `'ESC BACK'` |

Plus the entire settings panel, which is text rows and ON/OFF values with no iconography, and the
eagle drop's `SPACE - JUMP` and `THE EAGLE DROPS YOU AT THE END OF ITS LINE`.

**Why it matters — and why this is a decision, not a fix.** Every one of these is a reasonable
piece of UI. First-run onboarding and modal-dismiss affordances are the two places where a text
hint genuinely beats an icon, and a settings panel that replaced "SCREEN SHAKE" with a pictogram
would be worse, not better. The problem is not the strings; it is that the rule is written as
absolute while the code has seven exceptions. A rule with undocumented exceptions stops being a
rule — the next session either strips good UI to comply, or quietly concludes the rule is
decorative and ignores it somewhere it actually mattered.

This is scoped as a **documentation** goal. It does not commit to building any affordance.

- **Change:** reword the CLAUDE.md rule as a strong default with a named carve-out list — most
  likely *first-run onboarding*, *modal dismiss keys*, and *the settings panel* — or decide the
  rule stands as absolute and open a separate goal per string. Either answer is fine; the current
  ambiguity is not.
- **Done when:** every string in the table above is either covered by a written carve-out or
  listed as a known violation with an owner. `grep -n "showMsg('" js/game.js` produces no string
  that the rule leaves unaddressed.
- **Size:** one sitting, mostly thinking. **Needs Noah's call** — this is a design decision about
  the game's voice, not a mechanical correction, and it should not be made by a session acting
  alone.

---

## Deliberately out of scope

Recorded so a future session knows these were **seen and excluded**, not missed.

- **Structures are currently indestructible.** Nothing damages a building: `swingHit` filters
  `STRUCTS` out before `hitObject` ([js/game.js:1554](../../js/game.js)), `hitObject` has no other
  caller, arrows die on solid tiles without dealing damage, and the turret's tick is an explicit
  no-op (`// idle: nothing hostile exists since raiders were removed`,
  [js/game.js:2459](../../js/game.js)). Demolish is the only way a structure comes down. In a PvP
  game with walls and turrets this is a real hole — but it is an **unbuilt feature**, not drift,
  and sizing it means deciding what siege should feel like first. D7 corrects the *documentation*
  of this area without touching the design question.
- **Multiplayer and Tutorial are stubs.** `MENU_FROZEN = 1` seals the Multiplayer plank under ice
  until it exists ([js/game.js:5902](../../js/game.js)). Roadmap, not drift.
- **`updatePlay`'s 53,824-slot scan** ([js/game.js:3283](../../js/game.js)) is named in D8 as a
  documentation correction only. Whether it is worth optimising is a separate question that needs
  a profile first — it may well be free.

---

## How this was verified

Every claim above was checked against the code, not against another document:

- Line numbers were read directly and are accurate as of `PATCH 1.17` (commit `683fee1`). They
  **will drift** as `game.js` changes — the function and constant names are the durable anchors,
  and each entry names them.
- Counts came from commands, not estimates: `wc -l js/game.js` → 7414;
  `grep -c '\.replace(' js/sprites.js` → 7; `grep -o '// -\{10,\} .*' js/game.js` → 35 banners.
- The eagle flight range was recomputed from the constants rather than taken from the doc:
  `EAGLE_R` = `WORLD / 2 - 40` = 76 tiles = 1216 px; endpoints at π ± 0.7 rad give a chord of
  2·1216·sin(Δ/2) ∈ [2284, 2432] px; ÷ `EAGLE_SPD` 170 → 13.4–14.3 s.
- Runtime behaviour was confirmed in the browser against `?seed=4242` — the eagle ride, landing,
  harvesting to a stump, the build wheel, a wolf den at night, the TAB scoreboard, death and
  spectate — using `window.DBG` to stage each scene rather than playing to it.

Anything here that a future session finds to be false should be **corrected or deleted on the
spot**, by the same rule that produced this file.
