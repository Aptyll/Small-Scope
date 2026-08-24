# Reflect — the standing fix list

**This is a working plan, not a reference doc.** Every entry below is a verified mismatch
between what this repo *says* and what its code *does*, paired with a goal that closes it.

**Delete entries as they land. When the last one goes, delete this file.** That is not
housekeeping — it is the whole point. A findings document that outlives its findings becomes
exactly the thing it was written to fix: a confident, stale page that a future session acts on
without re-verifying. This file is allowed to exist only while it is shrinking.

**One entry remains, and it is the one that needs a human.** Earlier passes cleared eight stale
documentation lines and three code footguns; those entries were deleted rather than ticked off,
because the git history is the record of what happened and this file is not. **Once P1 is
answered, delete this file.**

---

## How to read a goal

The entry states the mismatch, why it matters, then a goal in three fields. Those fields carry
the SMART properties so the goal stays readable instead of turning into five bullets:

| Field | Carries | Meaning |
| --- | --- | --- |
| **Change** | **S**pecific | The exact edit, named down to the file and line. No "improve the docs". |
| **Done when** | **M**easurable | A command that prints a known result, or a stated outcome. Pass/fail, not judgement. |
| **Size** | **A**chievable + **T**imely | Sized in sittings, not calendar dates. |

**R**elevant is argued in the prose — specifically, what a future session gets wrong if the line
stays as it is. That is the only reason it matters.

**On "timely".** There are no dates here on purpose: inventing deadlines for a project worked on
when you feel like it produces goals that are precise and false. The goal is sized in **sittings**
(one focused pass at the keyboard). With one entry left there is no ordering left to state — the
deadline is simply "the next time this is picked up".

**The sitting is one commit.** Per [CLAUDE.md](../../CLAUDE.md), every push to main bumps
`PATCH_TXT` by 0.01 and adds one plain-English sentence to the top of `PATCH_NOTES`, in the same
commit, before the push.

> **Line numbers drift.** Every `PATCH_NOTES` entry pushes everything below it down by one line,
> so citations below ~5900 are stable and citations above it are not. The **function and constant
> names are the durable anchors**. Re-grep before editing.

---

## P1 — decide what "show, don't label" actually means, then write that down

CLAUDE.md states the rule with no exceptions:

> **Communicate through visuals and visual indicators wherever possible; avoid text labels and
> explanatory text.** … If you catch yourself writing a hint string, build the affordance instead.

The codebase carries at least seven live hint strings:

| Location | String |
| --- | --- |
| [js/game.js:1648](../../js/game.js) | `showMsg('RIGHT CLICK THE STUMP TO BUILD ON IT', 5)` |
| [js/game.js:3248](../../js/game.js) | `showMsg('EARN GOLD - HOLD E AT A TREE OR ROCK', 6)` |
| [js/game.js:5570](../../js/game.js) | `'(Q)'` keycap beside the berry counter |
| [js/game.js:5576](../../js/game.js) | `'(F)'` keycap beside the fish counter |
| [js/game.js:5874](../../js/game.js) | `'M CLOSE'` |
| [js/game.js:6089](../../js/game.js) | `'ESC CLOSE'` |
| [js/game.js:6769](../../js/game.js), [:6787](../../js/game.js) | `'ESC BACK'` |

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

- **Sieges are still one-sided in one direction: nothing shoots buildings.** A player breaks a
  building by hand and a turret shoots people, but **arrows and bolts pass buildings without
  damaging them** (they die on the solid tile), so a base can only ever be taken down at melee
  range. Whether ranged siege should exist is a design question, not drift.
- **No AI slot attacks anything built.** `updateAI`'s ladder has no siege step, so bots build
  bases, and now defend them with turrets, but will never assault yours. This is the biggest
  remaining asymmetry: the player is the only attacker in the game.
- **Multiplayer and Tutorial are stubs.** `MENU_FROZEN = 1` seals the Multiplayer plank under ice
  until it exists ([js/game.js:6181](../../js/game.js)). Roadmap, not drift.
- **`updatePlay`'s 53,824-slot scan** ([js/game.js:3407](../../js/game.js)) is described accurately
  in [world.md](world.md). Whether it is worth optimising needs a profile first — it may well be
  free.

---

## How this was verified

- Line numbers were read directly and are accurate as of `PATCH 1.22`. See the drift warning
  above: anything cited beyond ~5900 moves by one line per patch note.
- Runtime behaviour was confirmed in the browser against `?seed=4242`, using `window.DBG` to stage
  each scene rather than playing to it — with `DBG.freeze = true` to stop the rAF loop so stepping
  is deterministic.

Anything here that a future session finds to be false should be **corrected or deleted on the
spot**, by the same rule that produced this file.
