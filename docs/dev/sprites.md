# Working on sprites

How the ASCII-grid sprite system works and which sprites share grids with which. Read this before
editing [../../js/sprites.js](../../js/sprites.js) — note the encoding warning at the end.

Sprites are literal ASCII grids paired with a palette object mapping character → hex (or `null`
for transparent), baked by `bake()` at load. Left-facing variants are `flipH()` of the right ones.
Character sprites are 16×16; the raider set (`SPRITES.raider`, `RDPAL`) is baked from the exact
same grids as the player, so a player pose edit changes both. The tiered structures use the same
trick: one grid each (`wall`, `turret`, `generator` at 16×16, the **Keep** at 32×28 for its 2×2
footprint) baked with `WPAL` /
`WPAL_STONE` / `WPAL_GOLD` — a grid edit changes all three
tiers, and the palettes share the extra `k`/`K` (iron fitting) and `e` (glow) chars, which is also
what a building's team paint rides on (see below). The Keep's sprite is too big for a 16×16 wheel
wedge, so it gets the same escape hatch as the turret and the bay: a dedicated `keepIcon` grid,
baked into `teamBuild[team].icon.keep`. The
**bot bay** (`spawner`) is the one big sprite: a single-tier 48×38 grid (`bay`, `BAYPAL`) on a 3×2
tile footprint — steel plates under a flat two-row snow cap, a team-painted lintel band (`L`/`T`/`t`
via `bayTeamPal`), riveted flanks with a grille and hazard stripe, and a 20-px dark doorway (cols
14–33, rows 13–35, floor row 36 — `drawBayOverlay` in draw-world.js clips to it). Its 16×16 wheel glyph is
a separate grid, `bayIcon`, exported as `teamBuild[team].icon.spawner`; the old 16×16 `spawner` grid
is still baked as the flat `SPRITES.spawner` but unreferenced. The
construction stages are one shared `scaffold` set (`[posts, frame, lattice-overlay]`, `SCPAL`),
and the worker bot is one 12×10 grid on `BOTPAL` (`botA`/`botB`: a faceless boxy chassis with
stub arms sitting on a single full-width tread, the two frames differing only in the tread
notches). The body chars `L`/`T`/`t` are the team paint (`teamRobotPal` → `coatL`/`coat`/`coatD`),
so `robotTeam[team]` is the whole bot in that colour; `drawRobot()` bobs the entire sprite while
driving and adds the tool swing and the carried nugget in code.

**Prone is a fifth pose direction**, a `prone` key sitting beside `down`/`up`/`right`/`left` in
each champion's set (`champ[c][team].prone[dir][frame]`, three frames a direction: settled and two
of the crawl). The body lies **across** the 16×16 cell rather than standing up through it, so a
player's ground contact stays where the standing feet were and the y-sort never jumps when they
drop — foreshortened, not shrunk: twelve rows head-on to the standing sixteen, eight deep and
fifteen long side-on. Everything about the read is segmentation (boots, split calves, thighs
widening into the coat hem, elbows out past the shoulders to the full width of the cell, a small
head at the front), because pants sit a shade off the outline colour and an unsegmented lower body
just reads as a dark brick. The crawl frames alternate the reaching arm **and** the drawn-up knee,
since a belly crawl hauls with one arm and pushes off the opposite leg; the 1 px inch forward
between them is applied by `drawPlayer`, not baked into a second set of grids. The skater's set
swaps the pom hat for her hood, the eye for the goggle band, adds the trailing scarf and shows the
blade as a plate under each boot.

These are the one place `bakeSpan()` is used instead of `bake()`: it attaches `spans`, the per-row
`[firstX, lastX]` of painted pixels computed straight off the char grid, and `flipH` mirrors that
array with the canvas. The game's snow cover reads it to size the mound to the pose
([rendering.md](rendering.md#snow-over-a-body)) — which means editing a prone grid updates the
cover for free, and there is no canvas readback anywhere in the feature.

**Team colours are palette swaps of those same grids.** `TEAM_SKINS` (two presets, RED and BLUE,
also exported as `SPRITES.teams` so the game code can read the names and marker colours) drives
four baked sets — the three below plus `eagleTeam[team]`: the drop eagle's three flap frames with
the torso band (the rows the head sits in, which hold still across the frames) re-lettered by
`armorize()` to plate/helm chars and baked in team colour, so the armour recolours only pixels
the bird already has and the silhouette is untouched (`eagleFlash` is the same trick in all
white, for the downed objective's hit flash):
`playerTeam[team]` (coat/hat/trim swapped — `SPRITES.player` *is* `playerTeam[0]`),
`teamBuild[team][type][tier]` (the tier material with the `k`/`K`/`e` accents repainted, so tier
still reads as tier), `robotTeam[team]`, and `merchant[team]` — the eagle's driver
([the merchant](gameplay.md#the-merchant)): its **own grids**, `merchDown`/`merchUp`/`merchSide`
plus `merchFeet` — **16 × 18**, two rows taller than a slot and a hand wider at the shoulder — a
**hooded robe**: the hood's shadow (`s`) around a narrow four-wide face, gold trim (`g`) at the
collar and the hem, a belt (`y`) that is the ONLY team ink on it, boots under the hem, three
frames a direction (the boots walk, the robe hangs; the side grid faces right and flips), under
`merchantPal` (plum `r`/`R`/`d`). Nothing on it is a slot's coat or hat, so the side reads off
the belt, the nameplate and the bar (no prone poses — it never lies down). A new character or building sprite has to
be added to those bakes, not just to the flat `SPRITES` entry, or it will not wear a team's
colour — and every read of one of them indexes by `skin(team)` (js/player.js), never the bare
team, so your side is painted blue whichever index it was dealt. The swing
tool icons (`itemBow`/`itemAxe`/`itemPick`) are 8×8 grids sharing `AXPAL`, drawn at **1×** by
`drawHeldTool()` (inside a translate/rotate, resolved through `SPRITES[t.icon]` from the
`SWING_TOOLS` table) and by `drawRobot()` for a bot's swing — E picks the tool, there is no tool
bar. At rest `drawHeldTool()` draws the **weapon on the selected slot** instead, which is a 12×12
`toolArt_*` canvas baked in [js/tools.js](../../js/tools.js) rather than here; both sizes go
through the same code because the icon is centred on its own half-width. The **gear icons** are
twelve 12×12 grids, **one per variant** (`gearLongsight` … `gearGhoststep`), each baked once per
**material** — `GEAR_MAT_PALS`, leather → iron → steel → gold, plus the shared accent chars `w`
(ice-white) and `r` (hearth-red) — into `SPRITES.gearIcons[slot][variant][material]`: the glyph
says which piece, the material says its level. Drawn by the HUD's gear plates and class select's
collapsed gear widget; the gear pop-up's wells wear the detailed 32×32 `GEAR32` set instead
(js/menu.js — see [gameplay.md](gameplay.md#gear)). `itemBag` is
12×12 for the same reason — it sits in the same 18 px HUD well — but shares `ITPAL` with the
8×8 item icons rather than taking a material palette: it is one object, not four levels of one.
The five **roguelike card** icons take the gear icons' trick the other way round: one shared 8×8
`itemCard` silhouette (a card face with a sparkle pip), baked five times through `CARD_PALS` —
White/Green/Blue/Purple/Gold — where the rarity itself is the only colour that changes (`C`), so
`itemCardWhite`…`itemCardGold` are five palette swaps of one grid, the same relationship `GEAR_MATS`
has to a single gear icon.

**The pine is sixteen frames of one tree**, and the one sprite here that was not drawn by hand:
`treeSway` is `docs/media/new_media/*.png` cropped to **27×37** and snapped onto
`TSPAL` (fourteen colours, `bake`d like everything else). It draws at
`(px - 5, py - 21)` with its trunk on the tile's centre line, and **through `SPRITES.treeAtlas`,
never through `SPRITES.tree`** — all sixteen frames in one canvas, because a `drawImage` that
changes source texture cannot be batched and a wide view holds a thousand pines
([rendering.md](rendering.md#drawing-a-thousand-of-something)). The **source file order is
not the animation order**: the sixteen files are variants of one tree rather than a hand-animated
sway, so they are laid out here as a **cycle**, ordered so consecutive frames differ least (a
2-opt tour of the pixel distance between them) - which also sorted the 1-2px vertical bob baked
into them into one smooth rise and fall. That ordering is what makes `treeFrame`'s ±8 walk either
side of a rest frame smooth, and smooth across the wrap. `TPAL` above it stays: it still dresses
the `stump` a felled pine leaves. Which frame a tree is wearing is decided by the wind, not here -
[rendering.md](rendering.md#the-wind-field).

**The turret is half grid, half raster.** `turret` is a **32×32** mount — collar, column, plinth
and snow skirt — whose top 16 rows are deliberately empty. The rotating housing and barrel are not
baked at all: `drawTurretHead()` in draw-world.js rasterises them pixel by pixel at the live bearing and
dilates the result into a 1px dark rim, exactly as the arrows do, because a baked grid would lock
the gun to one angle. The pivot is sprite-local **(16, 14)**, just above the collar. Two knock-ons:
the sprite is wider than its one-tile footprint, so the draw pass centres it (`sx` in the structure
branch of `render()`); and a 32px sprite is too big for a radial-wheel segment, so `turretIcon` (the
old 16×16 cannon) is baked into `teamBuild[team].icon.turret`, the same escape hatch the bay uses.
Wildlife is
side-view only — rabbits are 12×11 (sit) / 14×9 (hop), deer are 26×22 (stand + two walk frames
sharing a `deerHead` upper body), wolves are 16×13 (a shared `wolfBody` plus three leg rows per
frame, the deer's trick), birds are 9×6 (perched) / 9×5 (two wing frames) — and left variants are
`flipH` of the right-facing grids. The two [landmark](world.md#landmarks) props are
`deadTree` (two 16×24 snags on `DTPAL`, the footprint the pine used to share so they draw in the same
band) and `den` (one 16×12 mound on `DNPAL`, drawn at `py + 4` like a rock).
Anything drawn through `drawSpriteFlash` must stay within 64×64.

**New sprites bake beside the code that draws them, not here.** The treasure chest (`CHEST_SPR`,
js/draw-world.js) and every tool and bit icon (`TOOL_ART` / `BIT_ART` / `bakeGrid`, js/tools.js)
paint their char grids onto their own canvases and assign into `SPRITES`, which works because it
is a plain object. The reason is the paragraph below: `js/sprites.js` is byte-fragile, so the
fewer sessions that rewrite it, the better. Tool art goes further and follows the gear icons'
trick — one 12×12 silhouette per family, baked once per **tier** through `TOOL_ART_PAL`, so shape
says which weapon and palette says how good it is. The two detailed 32×32 icon sets do the same:
the ability icons (`AB32`/`AB32_PAL`, js/abilities.js) and the gear-variant icons (`GEAR32`,
js/menu.js) bake lazily beside their drawers, and `GEAR32` deliberately shares `AB32_PAL` so
every big icon in the game speaks one palette.

`js/sprites.js` has a UTF-8 BOM and **seven** rows that repair a mangled byte via
`'...'.replace('о', 'g')` — in `stump`, `imp1` (×2), `wall` (×2, one of them a `/g` replace),
`heartHalf` and `heartEmpty`. Preserve the file's encoding when editing — re-saving it as
something else will corrupt the grids, and the corruption is silent: `bake()` sizes each canvas
from `rows[0].length` alone, so an unmatched palette char is indistinguishable from a transparent
pixel and a broken repair just shifts that grid row one column sideways. (`heartHalf`'s repair is
currently a no-op — `.replace('g', 'g')`.)

