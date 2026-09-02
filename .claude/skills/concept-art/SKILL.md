---
name: concept-art
description: Make a concept sheet of two or three candidate pixel-art looks for a new sprite (a character, an NPC, a creature, a building), render it at 6x with both team palettes and every facing beside a player for scale, hand the PNG to Noah, and only build the pick into js/sprites.js. Use whenever a new sprite is asked for, a look is rejected ("looks like a witch"), or Noah asks for options, concepts, or "let me pick".
---

# Concept art for a new sprite

Noah picks looks from a sheet, not from prose. The 2026-09-01 merchant went through two sheets
(`docs/media/concepts/merchant-concepts-1.*` hoods, all rejected; `-2.*` hat / pack / apron,
D picked) before anything shipped, and the pick took one message. Do this **before** writing
any grid into `js/sprites.js`; never push a look he has not seen.

## What a sheet is

One self-contained HTML page (a template is beside this file: `sheet-template.html`) that
holds the candidate grids as **ASCII rows** — the same grid language `js/sprites.js` uses, one
char per pixel, `.` transparent, `o` outline — renders them onto a canvas at `S = 6` px per
pixel, and POSTs the canvas to the dev server's screenshot sink so the PNG lands in
`shot.png` at the repo root. Per candidate, both team colours (RED and BLUE rows), four poses
(front, right, left = right flipped, back), a labelled letter, and **the player body beside it
for scale** — a look is judged against the thing it must not be mistaken for.

Rules that make a sheet honest:

- **Game-accurate or it is useless.** 16 wide (any height; the merchant is 16 × 18), the
  outline char `o` = `#2e2440`, the game's skin `k`/`K`, eyes `e`, boots `b`, and team colour
  through the two `TEAM_SKINS` presets (`coat`/`coatL`/`coatD`, the values are in the
  template) — keep the team ink to ONE piece (a crown, a headband, a hood) so a body never
  passes for a slot. Read [docs/dev/sprites.md](../../../docs/dev/sprites.md) first for the
  palette letters and how sets are baked.
- **Every row 16 chars, front and back grids mirror-symmetric**, the side grid faces RIGHT
  (the game flips it). The template throws on a wrong width; run `node gridcheck.js <file>`
  from this folder for the symmetry report before rendering.
- **Silhouette first.** Noah rejected a palette swap of the player body twice ("looks like a
  witch", "still purple"): a new thing needs its own body plan — a wider hat, a pack, a beard,
  bare arms — and one hue family, no trim, no second accent. Simple beats detailed at 16 px.
- **Three candidates, genuinely different shapes**, not three palettes of one shape. Label
  them with letters (continue the alphabet across rounds: round one A-C, round two D-F) and
  give each a two-word name.

## The steps

1. Write the sheet from the template into
   `docs/media/concepts/<thing>-concepts-<round>.html`. It is a reference document, so its
   header comment says what was asked and, once decided, what was picked or rejected.
2. Check it: `node .claude/skills/concept-art/gridcheck.js docs/media/concepts/<file>.html`.
3. Render it: with `node app/server.js` running, open
   `http://localhost:8471/docs/media/concepts/<file>.html` in the Browser pane (a `file://`
   page outside the project does not run scripts there). Widen the viewport
   (`resize_window` 1500 × 420) for an in-pane look, then reset it to `desktop`. Read the
   console: a thrown width error means the sheet is blank past that variant.
4. Save it: `cp shot.png docs/media/concepts/<file>.png` — `shot.png` is gitignored and
   overwritten by every render, the copy is the record.
   (Or have the sheet POST to `/shot?f=docs/media/concepts/<file>.png` and skip the copy - the
   sink takes a repo-relative path since 2.45; the fish-catch sheet does this.)
5. Hand it over with `SendUserFile` (display `render`) and a one-line description of each
   letter plus your own pick and why. Then **stop and wait** for the letter.
6. Build the pick: copy its grids into `js/sprites.js` beside the sprite's palette (the
   merchant's `merchDown`/`merchUp`/`merchSide` + `merchantPal` are the pattern — the grids
   and the palette letters go over verbatim), keep the sheet's letter in the code comment,
   verify in the game at a close-up (`DBG.setK(6, true)`, `DBG.hideUI = true`, walk up to
   it), update [docs/dev/sprites.md](../../../docs/dev/sprites.md), bump the patch, push.
7. Never commit `shot.png` or a scratch copy of the sheet at the repo root; the copies in
   `docs/media/concepts/` are the deliverable.

## Why this and not a drawing tool

The ASCII grid IS the game's source format, so the concept and the shipped sprite are the
same bytes — nothing is redrawn, nothing drifts between the picture Noah approved and the
thing in the world. The arrow work of 2.25-2.29 used the same idea (an ASCII master with
symmetry asserts, rasterised by code); this skill is that workflow generalised to bodies.
