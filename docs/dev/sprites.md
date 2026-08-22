# Working on sprites

How the ASCII-grid sprite system works and which sprites share grids with which. Read this before
editing [../../js/sprites.js](../../js/sprites.js) — note the encoding warning at the end.

Sprites are literal ASCII grids paired with a palette object mapping character → hex (or `null`
for transparent), baked by `bake()` at load. Left-facing variants are `flipH()` of the right ones.
Character sprites are 16×16; the raider set (`SPRITES.raider`, `RDPAL`) is baked from the exact
same grids as the player, so a player pose edit changes both. The tiered structures use the same
trick: one 16×16 grid each (`wall`, `turret`, `generator`) baked with `WPAL` /
`WPAL_STONE` / `WPAL_GOLD` — a grid edit changes all three
tiers, and the palettes share the extra `k`/`K` (iron fitting) and `e` (glow) chars. The
**bot bay** (`spawner`) is the one big sprite: a single-tier 48×38 grid (`bay`, `BAYPAL`) on a 3×2
tile footprint — steel plates under a flat two-row snow cap, a team-painted lintel band (`L`/`T`/`t`
via `bayTeamPal`), riveted flanks with a grille and hazard stripe, and a 20-px dark doorway (cols
14–33, rows 13–35, floor row 36 — `drawBayRollout` in game.js clips to it). Its 16×16 wheel glyph is
a separate grid, `bayIcon`, exported as `teamBuild[team].icon.spawner`; the old 16×16 `spawner` grid
is still baked as the flat `SPRITES.spawner` but unreferenced. The
construction stages are one shared `scaffold` set (`[posts, frame, lattice-overlay]`, `SCPAL`),
and the worker bot is one 12×10 grid on `BOTPAL` (`botA`/`botB`: a faceless boxy chassis with
stub arms sitting on a single full-width tread, the two frames differing only in the tread
notches). The body chars `L`/`T`/`t` are the team paint (`teamRobotPal` → `coatL`/`coat`/`coatD`),
so `robotTeam[team]` is the whole bot in that colour; `drawRobot()` bobs the entire sprite while
driving and adds the tool swing and the carried nugget in code.

**Team colours are palette swaps of those same grids.** `TEAM_SKINS` (four presets, also exported
as `SPRITES.teams` so game.js can read the names and marker colours) drives three baked sets:
`playerTeam[team]` (coat/hat/trim swapped — `SPRITES.player` *is* `playerTeam[0]`),
`teamBuild[team][type][tier]` (the tier material with the `k`/`K`/`e` accents repainted, so tier
still reads as tier), and `robotTeam[team]`. A new character or building sprite has to be added to
those bakes, not just to the flat `SPRITES` entry, or it will not wear a team's colour. The tool-bar
icons (`itemBow`/`itemAxe`/`itemPick`) are 8×8 grids sharing `AXPAL` and are drawn at a crisp
2× in `renderUI()`. Wildlife is
side-view only — rabbits are 12×11 (sit) / 14×9 (hop), deer are 26×22 (stand + two walk frames
sharing a `deerHead` upper body), wolves are 16×13 (a shared `wolfBody` plus three leg rows per
frame, the deer's trick), birds are 9×6 (perched) / 9×5 (two wing frames) — and left variants are
`flipH` of the right-facing grids. The two [landmark](world.md#landmarks) props are
`deadTree` (two 16×24 snags on `DTPAL`, the same footprint as a pine so they draw in the same
band) and `den` (one 16×12 mound on `DNPAL`, drawn at `py + 4` like a rock).
Anything drawn through `drawSpriteFlash` must stay within 64×64.

`js/sprites.js` has a UTF-8 BOM and one heart row that repairs a mangled byte via
`'...'.replace('о', 'g')`. Preserve the file's encoding when editing — re-saving it as something
else will corrupt the grids.

