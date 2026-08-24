# Reflect — the standing fix list

**This is a working plan, not a reference doc.** Every entry below is a verified mismatch
between what this repo *says* and what its code *does*, paired with a goal that closes it.

**Delete entries as they land. When the last one goes, delete this file.** That is not
housekeeping — it is the whole point. A findings document that outlives its findings becomes
exactly the thing it was written to fix: a confident, stale page that a future session acts on
without re-verifying. This file is allowed to exist only while it is shrinking.

**Four entries remain: three code footguns and one policy call.** An earlier pass cleared eight
stale documentation lines; those entries were deleted rather than ticked off, because the git
history is the record of what happened and this file is not.

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
sequence**. The deadline is ordinal, not calendar: *the F-group before P1.* That keeps "timely"
honest and still gives each goal a bound it can miss.

**Each sitting is one commit.** Per [CLAUDE.md](../../CLAUDE.md), every push to main bumps
`PATCH_TXT` by 0.01 and adds one plain-English sentence to the top of `PATCH_NOTES`, in the same
commit, before the push. Two sittings means two patch bumps. Don't batch them.

> **Line numbers drift.** Every `PATCH_NOTES` entry pushes everything below it down by one line,
> so citations below ~5900 are stable and citations above it are not. The **function and constant
> names are the durable anchors** — each entry names them. Re-grep before editing.

---

## Sitting 1 — code footguns (goals F1–F3)

Three places where the code contradicts a stated hard rule. **All three are harmless right now** —
none produces a visible bug today. They are worth a sitting anyway because each is a trap armed
and waiting: the next feature that walks past it triggers it, and the resulting bug will look
completely unrelated to its cause. That is the exact failure mode CLAUDE.md's hard rules exist to
prevent.

Unlike prose edits these touch behaviour, so each needs verifying in the running game —
`node serve.js`, `?seed=N` pinned, before/after comparison.

---

### F1 — one `players` loop is missing its `inAir` check

CLAUDE.md's hard rule: *"A loop over `players` that touches the world must skip `inAir(p)`
(riding or falling from the eagle) alongside `!p.active`/`p.dead`."*

Thirteen loops obey it. One does not — the swing-arc render pass at
[js/game.js:3934](../../js/game.js):

```js
// swing arcs (every player who is mid-swing)      <- line 3933
for (const p of players) {                          // 3934
  if (!p.active || p.dead || p.swingT <= 0) continue; // 3935  <- no inAir()
```

**Why it matters:** it is safe today **purely by accident** — a slot on the eagle cannot start a
swing, so `swingT` is always 0 and the loop body never runs for an airborne player. Nothing
enforces that. Any future change that lets a falling player act (a mid-air ability, a swing that
survives the jump, a debug stage) turns this into a swing arc drawn in world space at the
coordinates of someone 56 px up in the sky. The bug would appear in the renderer, far from
whatever change caused it.

- **Change:** add `|| inAir(p)` to the guard on the line after `for (const p of players) {` in the
  swing-arc pass.
- **Done when:** every world-touching hit of `grep -n "for (const p of players)" js/game.js` also
  tests `inAir`. Verified in the browser: `DBG.beginDrop()`, step frames, confirm no arc renders
  and nothing else changes against a same-seed before-shot.
- **Size:** 10 minutes including verification.

---

### F2 — `renderLighting` mixes a rounded camera with an exact position

CLAUDE.md's hard rule: *"Screen position is `round(world − camera)`, rounded exactly once.
Statics subtract the rounded `ox`/`oy`; moving entities subtract the exact `ex`/`ey`."*

`renderLighting` is called with the **rounded** camera — `renderLighting(ox, oy, now)` at
[js/game.js:3960](../../js/game.js) — but draws the player's personal night glow against the
**exact** player position, at [js/game.js:4836](../../js/game.js):

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

## Sitting 2 — one policy decision (goal P1)

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
| [js/game.js:6486](../../js/game.js), [:6504](../../js/game.js) | `'ESC BACK'` |

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
  and sizing it means deciding what siege should feel like first.
  [gameplay.md](gameplay.md#base-building) now documents this accurately; the design question is
  still open.
- **Multiplayer and Tutorial are stubs.** `MENU_FROZEN = 1` seals the Multiplayer plank under ice
  until it exists ([js/game.js:5902](../../js/game.js)). Roadmap, not drift.
- **`updatePlay`'s 53,824-slot scan** ([js/game.js:3283](../../js/game.js)) is now described
  accurately in [world.md](world.md). Whether it is worth optimising is a separate question that
  needs a profile first — it may well be free.

---

## How this was verified

Every claim above was checked against the code, not against another document:

- Line numbers were read directly and are accurate as of `PATCH 1.19`. See the drift warning at
  the top: anything above ~5900 moves by one line per patch note.
- Counts came from commands, not estimates — e.g. `grep -o '// -\{10,\} .*' js/game.js` yields the
  35 banners that the [gamejs-map](gamejs-map.md) table is checked against.
- Runtime behaviour was confirmed in the browser against `?seed=4242` — the eagle ride, landing,
  harvesting to a stump, the build wheel, a wolf den at night, the TAB scoreboard, death and
  spectate — using `window.DBG` to stage each scene rather than playing to it.

Anything here that a future session finds to be false should be **corrected or deleted on the
spot**, by the same rule that produced this file.
