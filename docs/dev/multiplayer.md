# Player slots, teams and AI

Softfall is a two-sided team battle, RED vs BLUE. Every combatant — the local human, the AI
fills, and eventually a network peer — is a `Player` in the module-scope `players` array, and they
all run the same code. Read this before adding an ability, an input, or anything a player can do
to the world.

## The slot model

`MAX_PLAYER_SLOTS` (10) slots are created once at boot by `initPlayers()`. Each slot is one of:

- `control: 'human'` — driven by keyboard/mouse. Today exactly one slot is human: **slot 0, this
  session's player**. `player` and `inv` point at it (and only at it) for the camera, HUD, cursor,
  audio gating and the aim line.
- `control: 'ai'` — driven by `updateAI()`. Every vacant slot is filled with one at boot.
- `control: 'none'` — nobody is in it. The slot still exists; it is drawn as a flat team-tinted
  silhouette at its `spawn` (`drawGhost`) and is skipped by the sim, arrows and drops. A slot
  emptied before it ever landed stands at the world centre, the placeholder `spawn`.
  `p.active` is the `control !== 'none'` test every such loop uses.

`DBG.setControl(slot, 'human'|'ai'|'none')` flips a slot live, which is how you stage a scene with
fewer bots, a frozen target dummy, or a ghost.

**A `Player` owns everything the old singleton did** — position, velocity, facing, hp, bow draw,
dodge charges, slide state, swing state, held tool, i-frames, footprint cadence — plus `id`,
`team`, `control`, `name` (`TEAMS[team].name + '-' + (slot + 1)` for an AI fill; the local slot
wears the profile's display name, set in the constructor and refreshed by `applyProfileName()`
when it is edited — see [architecture.md](architecture.md#profilejs)), `spawn` (the tile it landed
on from the eagle), `aboard`/`dropT`/`dropU`
(the eagle ride, see [Eagle drop](rendering.md#eagle-drop-mode-drop)), its own `inv` wallet and
`bag` (see [the backpack](gameplay.md#inventory-and-the-backpack)),
`level`/`xp` (see [Hero levels](#hero-levels)), `kills`, an `input` struct and an `ai` brain.
`reset(first)` places it at `spawn` and clears every transient; it is the single definition of
"a fresh player". Boot calls it with `first` true, and `respawnPlayer` — the team's bird setting a
downed slot back down — with `false`, which is what gives the return its 3 s of i-frames.

Behaviour lives in free functions taking `p` (`updatePlayer`, `tryWork`, `fireTool`, `tryDodge`,
`startEat`, `damagePlayer`, `die`, `spillInventory`, `placeStruct`, …), matching the rest of the file's
style — the class is the state container, not a god object.

## The input struct

`makeInput()` is the **entire interface between a controller and the sim**:

```
mx, my        movement axis, -1..1 (the sim normalises)
aimX, aimY    world-space aim point — cursor for a human, target for a bot
fire          bow held: rising edge draws, falling edge looses. The rising edge
              also CANCELS a meal in progress (see Food in gameplay.md), so the
              button a player reaches for in a fight is never refused
work          E held
slide         shift held
dodge         edge-triggered, cleared by the sim when it reads it
grapple       held (key 3): the hunter's grapple reels only while this is down -
              the one held ability input (updatePlayer's grapple branch reads it;
              the burrow is the SNOW COVER cast on `ability`, not a field here)
eatBerry      edge-triggered (Q): STARTS the 1.5s meal, it does not heal on the spot
eatFish       edge-triggered (F): same, and off the same shared 3s clock
              (startEat, js/core.js - see Food in gameplay.md)
ability       edge-triggered (keys 1-4): cast that class ability, -1 = none
              (tryAbility, js/abilities.js - see Classes below)
cmd           one-shot order {kind:'build'|'upgrade'|'demolish', tx, ty, id}
              or {kind:'gear', piece} - a gear buy: no tile, no reach, no contest
              or {kind:'skill', i} - a hud-ability rank: same, free (a skill point)
              or {kind:'shop', act, ...} - a buy or a food trade at the
              merchant's counter: no tile and no contest (an offer is a line,
              not a queue), but it re-checks its own reach (shopCmd, js/shop.js)
```

`sampleHumanInput(player)` (input banner) folds `keys`/`mouse` into slot 0's struct once per step,
and zeroes it — dropping any draw — while pause or the settings panel is up. The wheel and the
[map](gameplay.md#the-m-map-does-not-pause) don't stop the sim and so don't zero the whole struct:
each drops only the intents it swallows (the map keeps movement, the wheel keeps movement minus
the roll). The keydown
handlers and `resolveWheel()` no longer act directly: they set `input.dodge` / `input.eatFish` /
`input.cmd` and let the next `updatePlayer` perform it. **A new ability must be a field here**, or
bots and future network peers can't use it.

`workTarget(p)` reads `p.input.aimX/aimY`, not the mouse, which is why the cursor's lock ring and a
bot's chop resolve through exactly the same function.

## Classes

Every slot also carries a class (`p.cls`, an index into `CLASSES` in the `players` banner).
A class is a look, a kit, and **four active abilities on keys 1-4** (`CLASS_AB`,
[js/abilities.js](../../js/abilities.js) — see [Class abilities](gameplay.md#class-abilities-keys-1-4)).
The kit is the handful of numbers the sim reads through `kitOf(p)`
instead of the bare constants. **`kitOf(p)` returns the *effective* kit**: the class's numbers
with the slot's [gear](gameplay.md#gear) folded in by `refreshKit(p)` (cached on `p.kit`, rebuilt
on class or gear change — never per frame). The kit fields: `iceMax` (× `ICE_MAX`), `iceSteer`, `slideMin`, `fatigue`
(snow-slide fatigue rate), `chargeMul` (speed while drawn), `bowCharge` (seconds to full draw),
`nock` (the baseline every rate of fire is scaled against — a tool's own `rof` is multiplied by
`nock / BOW_NOCK`, so a class's hands still set the rhythm; see
[the cycle](gameplay.md#the-cycle)),
`dmgBase`/`dmgPow` (what the *player* adds to the bit's own damage), `spdDmg` (extra damage scaled
by the shooter's speed at release, capped at 200 px/s), `dodgeSpeed`, `maxHp`. Sites that read it:
`updatePlayer`'s movement block, `emitBit`, `tryDodge`, the AI's draw timing, the cursor,
aim line and draw meter. `setClass(p, c)` swaps one in (full heal — it's a pre-match choice);
`p.maxHp` is always `levelMaxHp(p)` = kit hp + the level growth below.

| # | Name | Fantasy | Kit | Flies in with |
| --- | --- | --- | --- | --- |
| 0 | **HUNTER** — bow, distance control, the one class that hides | keep the gap and own the ground between | the ranged numbers: quick nock (0.4 s), full draw power, 92 hp | a SHORTBOW loaded ARROW + BARBED SHOT |
| 1 | **WARRIOR** — close pressure, blocking, momentum | get to arm's length and stay there | 120 hp, faster on ice (×1.15), +5 speed damage, dash 230, softer bow numbers | a SLING loaded HEFT then ARROW - the fitting under the shot, filling its 7 tensile exactly |

The **weapon is part of the class**: `CLASS_LOADOUT` (js/tools.js) pairs each one with a tool
and its bits, and `setClass` / `Player.reset` hand it over — so the two classes do not shoot the
same thing, every AI slot arrives armed, and a respawn is re-armed after
[death spills the build](gameplay.md#death-and-respawn). See
[Tools and bits](gameplay.md#tools-and-bits). The four ABILITIES beside the weapon — what each
one does, its cooldown, cast, and the states it leaves on a body — are
[Class abilities](gameplay.md#class-abilities-keys-1-4) in gameplay.md.

The local slot picks on the class select screen (see
[Main menu](rendering.md#main-menu-title)); AI slots hash theirs — class **and** all four gear
variants — from the seed in `initPlayers()` so a replayed world fields the same roster in the
same loadouts. Class select shows that roster as two columns of cards — your side left, the
rivals right, their picks face-down until PLAY's countdown turns them (a second PLAY skips the
rest of the count) — and the three notches
over the rivals' column set `settings.aiLevel` (`AI_LEVELS`, js/ai.js: NORMAL / HARD /
IMPOSSIBLE, remembered with the profile), which is stored and shown but **not yet read by
`updateAI`** ([known drift](checklists.md#known-drift)). Sprites live in `SPRITES.champ[c][team]` (the sprite key keeps its legacy name;
js/sprites.js is never rewritten) — same
16×16 body plan and frame set as the player, so `drawPlayer`/`drawGhost` just swap the set via
`classSet(p)`; `SPRITES.playerTeam` is class 0.

## Hero levels

League-style: every slot has `p.level` (1–`LEVEL_MAX` = 12) and `p.xp`, which is simply lifetime
gold earned. **`gainGold(p, n)` is the only way gold enters a wallet** (`awardGold` — the on-the-spot
payout every source uses — and robot deposits both route through it) — it pays the purse, adds the same `n` to `xp` and calls
`levelUp(p)` while `xp >= LEVEL_XP[level]` (cumulative thresholds 40, 100, 180, 280, 400, 540,
700, 880, 1080, 1300, 1540 — the gap grows by 20 each level, 1540 gold to cap). The table is
sized against a bot chaining pines all match (about a gold a second on the fells plus the
[trickle](gameplay.md#economy-one-currency)'s 15 a minute): that bot is level 9 or 10 at fifteen
minutes and capped past twenty, a player who fights and farms by halves sits two or three levels
under it, and the trickle alone is level 3 by seven minutes — a level is news all match, where
2.62's table (385 to cap) had every bot capped by 2:00. Spending gold and dying never touch
`xp`; level and xp are set in the constructor, not `reset()`, so they would survive a `reset`.

Growth is flat and identical for both classes: each level past 1 adds `LVL_HP` (9) to
`maxHp` (via `levelMaxHp(p)`, healed on the spot) and `LVL_DMG` (2) to every arrow
(`emitBit` adds it after the bit's base + pow × draw + speed bonus). Level 12 is +99 hp / +22
damage, and a level-8 hero of this table is about a capped hero of the old one: rarer, and
worth more. A level-up pushes a 2× gold `LEVEL n` floater over the slot (skipped while `inAir`) and
plays `SFX.levelUp()` for the local slot. The table's **average** level is also what the
wildlife is dealt at spawn (`animalLevel`, js/wildlife.js): an animal never levels, but the
meadow and the dens restock at the level the match has reached —
[gameplay.md](gameplay.md#wildlife).

Each level also grants **one skill point** (`p.skillPts`, starting with one at level 1), and a
point buys exactly one thing: **a level on one of the four class abilities**
([gameplay.md](gameplay.md#class-abilities-keys-1-4)), spent on the hud strip's floating buy
plates. The keys start **locked at level 0** — the first point on one is what makes it castable
at all — and the four of them hold exactly 12 levels, so twelve points by level 12 cap all four
with nothing stranded; what a build chooses is the ORDER, since you land with one point, four
dark keys and a match to spend the rest across. (The old kit-skill
row — LOOSE/DODGE/AMBUSH/FLETCH ranks in the backpack — was removed with the pack's
simplification; its passive bonuses live on only as gear variants and cards.) Bots spend each
free point in `updateAI`'s rung 0, lowest ability level first, so their first four unlock all
four keys.

The level shows as a 7-tall badge in `drawPlayer`, flush against the left edge of the overhead
bars' backing and spanning the health bar + stamina bar stacked (`py-8 .. py-1`), drawn for every
slot in the bars' backing/track colours with the digit in gold — it sizes itself to the number
and grows left, so a two-digit level overhangs like the stun plate does on the other side.
`DBG.gainGold(n, p?)` pays a
slot (default local) the way a pickup would, which is how to stage a level.

## Teams and colours

Two presets live in `SPRITES.teams` (`TEAM_SKINS` in [js/sprites.js](../../js/sprites.js)):
**RED** (the original red/teal look, once called EMBER) and **BLUE** (once FROST). A slot's team
is `slot % TEAM_COUNT` (2), so the ten slots alternate into five a side. The team table is the
only place a team colour is written down; the game code reads it back as `TEAMS` for name tags,
map markers, death bursts and the eagles' armour.

**The paint is per screen, the team is not.** Every colour lookup goes through
`skin(team)` (js/player.js) — `TEAMS[skin(p.team)]`, `SPRITES.champ[cls][skin(team)]`,
`eagleTeam`/`teamBuild`/`robotTeam`/`merchant[skin(...)]`, the two maps' eagle marks — and with
`settings.teamBlue` (the default, the ESC menu's MY TEAM row) it returns the BLUE preset for the
local slot's side and RED for the rival side whatever indices the roster dealt, so allies are
always blue and enemies always red on your screen (a second human on the other team would see the
mirror). Bot names follow the paint live (`Player.name` is a getter: `RED-3` becomes `BLUE-3` with
the toggle); the human's profile name is stored. Nothing in the rules reads `skin` — `p.team`,
`enemyOf`, `PVP`, ownership and the eagles' `team` fields are untouched — so the toggle is purely
what colour things are drawn.

A team colour drives both **characters** and **buildings**:

- `SPRITES.playerTeam[team][dir][frame]` — the player grids baked with the coat/hat/trim swapped.
  `SPRITES.player` is literally `playerTeam[0]`, so team 0 is the pre-existing art.
- `SPRITES.teamBuild[team][type][tier]` — the tier material (wood → stone → gold) with the iron
  fittings and glow repainted in team colour, so tier still reads as tier. `structSprite(o)` is the
  lookup; it falls back to team 0 for an object with no `team`.
- `SPRITES.robotTeam[team]` — bay robots wear their owner's colour, and the bay itself is one
  palette per team (`bayTeamPal`: its lintel band), not a tier material.

Structures carry `owner` (slot id) and `team`, set by `placeStruct()`. `ownsStruct(o, p)` gates the
manage wheel, upgrades and demolition; the right-click handler and `cursorInfo()` only offer the
hammer over a stump (neutral) or your own building.

Five slots per colour means **teammates share it**, so anything that names one player in text
takes a second axis: `playerTint(p)` returns a per-slot shade of that team's palette (`trim`,
`hatL`, `trimD`, `hat` by `floor(id / TEAM_COUNT) % 4` — the fifth teammate reuses the first
shade). The team colour stays the background, the tint is the ink — see the
[scoreboard and event feed](rendering.md#scoreboard-and-event-feed).

## PvP

`enemyOf(p, q)` is the one place the rule lives: another live, active slot on **another** team.
Arrows carry `owner`/`team` and test players first in `updatePlay`'s arrow loop, on an
`ARROW_HIT_R` (10 px) disc round the slot's centre — wider than the 4.5 px body a walker
collides with, because a walking target crosses its own width twice in the quarter second a
full-draw arrow takes to fly 80 px, and the same disc on every side keeps it a fact of arrows
rather than a hidden handicap; a hit calls `damagePlayer(target, dmg, dx, dy, src, cause)` for knockback, flash,
floater and possibly `die(p, src, cause)`. Friendly fire is off, and an arrow can never hit its
shooter. `damagePlayer` takes a seventh argument, `crit`, which the arrow loop passes from
`a.ambush`: it runs the damage floater hotter and at double scale and doubles the local shake. Any
hit also calls `risePlayer` before anything else, so nobody stays buried through one. A hunter's
PIERCING SHOT (`a.pierce`) is the one arrow that takes a body and keeps flying — everyone on the
line is hit once each (`a.pierceHit`), and only a raised shield or the world stops it.

**Whether a rival can be seen at all is a separate question from whether they can be shot.**
`enemyOf` answers the second; `seenAt(p, range)` answers the first, and every watcher in the
game — the bot brain, the wolf pack, both turret checks — resolves through it. See
[Prone](gameplay.md#prone-under-the-snow).

**A rival's worker bots are targets too** — they are tested straight after the players, on the same
team rule, through `hurtRobot` (see [Robots](gameplay.md#robots)). Shooting one costs the owner
its income and hands the gold it was carrying to whoever downed it, so a base's economy can be
raided without ever touching the base; the feed says so, but a worker is never a kill on the scoreboard.

**So is a rival's grounded eagle** — tested before tile solidity (its own roost tiles are solid,
and would otherwise eat the shot), same team rule, through `hurtEagle` (the `eagle drop` banner in
js/boot.js): a rival arrow landing on **any roost tile** spooks the bird `EAGLE_ARROW_DMG` (12) off
its `EAGLE_HP` (2000) pool — a flat chip, whatever the arrow would do to a body, so archers
standing off it take minutes and the side has time to answer — the
tiles are the one hit test walkers, arrows and E all share, so there is no corner an arrow can
strike without damage — a rival **E swing** chips `EAGLE_WORK_DMG` (20: a hundred swings, about a
minute for a lone warrior under the gust, measured at 53 s) through `hitObject`'s eagle
branch (the roost tiles are `eagle` objects, a rival-only work target — `workTarget` reads the
`team` they carry), and at zero the bird is **driven off**: `eagleFlee` lifts it away over the
treeline while every camera pans to watch (`state.eagleCine`, the driven-off ceremony), and
`EAGLE_CINE_T` later `eagleFleeResolve` takes the whole owning side out of the match (see
[Death and respawn](gameplay.md#death-and-respawn) and the eagle-drop section in
[rendering.md](rendering.md#eagle-drop-mode-drop)). Friendly arrows pass over it; a friendly
swing is refused. It is not helpless either: a rival lingering in `GUST_R` makes it rear
(wings spread for `GUST_WIND_T` — the telegraph) and **gust**, throwing every rival in
`GUST_BLAST_R` into a `GUST_STUN` tumble with no damage — the trigger resolves through
`seenAt`, like every other watcher — and after `PREEN_DELAY` unhit it preens `PREEN_RATE`
hp/s back.

`die(p, src, cause)` empties the wallet **and the bag** the same way regardless of what happens
next: the killer pockets the gold via `awardGold`, an uncredited death's gold goes down with the
body (gold is never a physical drop), and every carried
stack always spills, one drop each (the standings rank lifetime `xp`, so they still show what the
slot earned). What happens next depends on `teamEagleDown(p.team)` alone — see
[Respawn at the bird](#respawn-at-the-bird) — either a gold-free respawn timer (`p.respawnT`,
`respawnTime(p)`, ticked by `updateRespawns`) while the team's eagle still roosts, or
`p.eliminated = true`, the permanent path, once it has been driven off;
`updatePlayer` just zeroes a dead slot's intents either way. Only the local slot's **elimination**
takes the full death overlay with it (`endMatch('lost')`); a respawn-pending local death gets the
lighter `endMatch('respawning')` wait instead — same `state.mode = 'dead'` machinery (so the
replay window and the TAB scoreboard still work), but no dim and no planks: the camera goes to an
ally, one countdown line sits over it, and the replay of the death opens large over the view until
it is closed. An elimination offers spectating any living slot through
`viewPlayer()`/`specNext()` (a wait keeps to the side's own, `specOk`), or the way out to the
title — which for an **elimination** goes
through [the defeat screen](rendering.md#the-end-screens) first (`openDefeat()`, and its own plank
calls `toLobby()`), because a lost match ends when you stop watching it rather than when you go
down. Every death runs `checkLastStanding()`, which ends the match as a win once no **rival
team** is left — `rivalTeamsInMatch()`/`teamInMatch()` read the same other-team rule `enemyOf`
does, and **a team is in the match while its eagle roosts**: `teamInMatch` asks
`teamEagleDown(team)` first, so a fled eagle takes the side out whatever else it still holds
(`eagleFlee` in js/boot.js is what puts every slot down at liftoff), and a side with every slot
dead and waiting on its bird is not out — kills never end a match, only the bird does. **The
match keeps simulating while you are out** — `update()` runs `updatePlay` in both `play` and
`dead` mode; only pause and the settings panel stop the world (the map does not). Full detail:
[Death and respawn](gameplay.md#death-and-respawn).

### Respawn at the bird

There is no Keep and no permadeath: the team's roosting eagle is the way back, and the only thing
that takes a slot out for good is that eagle being driven off. `updateRespawns(dt)` (called from
`updatePlay` beside `updateStructures`) counts down every `p.dead && !p.eliminated` slot's
`p.respawnT` — `respawnTime(p)`: `RESPAWN_BASE` (1 s) plus `RESPAWN_LV` (2 s) per hero level —
3 s at level 1, 5 s at level 2, 25 s at the `LEVEL_MAX` of 12, and nothing off the match clock:
gold is XP and the table only climbs, so the level *is* the clock. An early death costs almost
nothing and a late one costs real match, which is what makes a wiped side late in a game (everyone
high) a real window on a roost its defenders otherwise come back to from sixty pixels away every
few seconds. At zero it calls `respawnPlayer(p)`, which puts `p.spawn`
`RESPAWN_OUT` (40 px) down the lane from the bird (`e.laneDir`; the nearest standable tile there
through `nearestDryTile`, the same spiral a hole is climbed out of) and calls `p.reset(false)`,
the exact full-clear a fresh landing gets, i-frames included — so the way back into the match is
the road everyone walked out on, past the merchant and the gate. A bird still in the air (a slot
shot in the seconds between its own landing and the bird's) has nowhere to set anyone down, so
the timer holds at zero until it roosts; a bird that has fled mid-timer is left to
`eagleFleeResolve`, which puts the whole side out at the end of the ceremony. `p.cards` (picked
roguelike cards), gear, skill ranks, level and xp are never touched by `reset()`, so a build
survives every respawn within a match; the wallet, the bag and the weapon do not.

### Kills and the event feed

The last two arguments are the whole credit system. `src` is the player who dealt the damage
(`players[a.owner]` for an arrow, null for the world) and `cause` names what the world did when
there is no `src` (`DEATH_CAUSE`: `'ice'` for a hole, `'wolf'` for a den's pack). A death with an `src` other than
the victim bumps `src.kills` — the scoreboard's KILLS column — and writes `"<killer> SHOT <victim>"` into the feed in the killer's colours;
without one it writes `"<victim> FELL THROUGH THE ICE"` in the victim's. **Any new way to hurt a
player must pass its `src`**, or the kill goes uncredited and the feed line reads as an accident.

The other thing logged today is a level-up at `LOG_LEVEL` (5) or above — the early levels come too
fast to be news. `logEvent(txt, p)` is the whole interface; the feed's look and lifetimes are in
[rendering.md](rendering.md#scoreboard-and-event-feed). `DBG.logEvent`/`DBG.events` stage lines
without staging the kills behind them.

## Contested orders

Several players can order the same thing in one step and only one can have it. Those actions queue
a claim instead of acting:

```js
contest('work:' + idx(tx, ty), p, () => { /* runs only if p wins */ });
```

`resolveContests()` runs exactly one claim per key, choosing the lowest `contestRank(p)` =
`hash2(p.id * 131 + 7, state.tick)` — a pure function of the run **seed**, the **player id** and the
**sim tick**, so every machine simulating that step picks the same winner. It is called twice in
`updatePlay`: once after the player loop (work swings, build orders, fish) and once at the end
(drop pickups). Claims must re-check their preconditions inside the callback — cost is paid at
resolution, so a loser keeps its gold.

Currently contested: work swings (`swingHit`, keyed by tile), build orders (`placeStruct`, keyed by
tile), fish spears (`spearFish`, keyed by fish index — a full bag refuses the catch before the
contest is even entered), drop pickups (keyed by drop index — every player standing on a drop
claims it *if they have room for it*, and the magnet pulls it toward the nearest such player,
so a full bag hands the pickup on rather than sitting on it — a dropped card is a neutral pickup
the same way, first-come whichever team gets there).

## AI slots

`updateAI(p, dt)` (the `ai` banner) writes `p.input` and nothing else — a bot can never do anything
a human couldn't. It is a priority ladder re-picked a few times a second, and **a profile says how
well each rung is played** (the `difficulty` banner at the top of ai.js): the **rivals** run
`AI_LEVELS[settings.aiLevel]` — NORMAL / HARD / IMPOSSIBLE, class select's notches, remembered
with the profile — and **your allies** run `AI_ALLIES[level]`, the next notch up (capped at the
top) plus the support fields, so your side is always the more competent one and the difficulty
is how good the *other* side is. `aiProfile(p)` is the one place that choice is made
(`p.ai.prof` overrides it for a staged bot — `DBG`, the calibration harness). Every field is a
worse or better use of the same input struct: `sight` (110 / 150 / 200 px, through `seenAt` so
cover still works), `react` (0.7 / 0.3 / 0 s a rival stays noticed before the bot turns on it),
`aim` (22 / 8 / 0 px of scatter, re-rolled every `AI_AIM_T`), `lead` (0 / 0.5 / 1 of the
target's motion), `draw` (0.7 / 0.9 / 0.95 of `bowCharge` it looses at — a short draw is a
weak shot), `dodge` (×0.5 / 1 / 2), `abil` (0.35 / 0.8 / 1 chance per `AI_ABIL_T` that a
ready ability is spent), `flee` (0.5 / 0.35 / 0.2 hp it hides at), `work` (0.5 / 0.8 / 1 duty
cycle of the E key while harvesting — its level pace), `strafe` (0.45 / 0.8 / 1 of each 2 s it
keeps moving in a fight; the rest it PLANTS — stands, draws and shoots, the only time a slow side
fires, so stopping is the tell and the moment a new player hits it — and under 1 it circles that
much less, walking in straighter), `pick`
(`'near'`, or IMPOSSIBLE's `'weak'` — the rival with the least hp), `push` and `guard` (the
objective, below), `support` (allies only). What is **not** in a profile: answering a hit on its
own bird — at every level the side answers from anywhere on the map, as many bots as the threat
calls for (**the two birds**, below); the difficulty is how well they fight when they get there,
never whether they come.

The ladder:

1. **eat** — fish below 50% hp, berry below 80%.
2. **burrow** — a hunter bot only, and decided up front, because two rungs below read the answer.
   A bot that has come off
   worse (under the profile's `flee`) with no rival and no wolf in sight goes [prone](gameplay.md#prone-under-the-snow)
   and waits the fight out for `ai.hideT` (7–12 s); it only ever tries where a player could — on
   snow, on its own feet, and with SNOW COVER's 60 s cooldown in hand. It gets
   straight back up for a wolf, for a rival inside 48 px, or when the spell runs out, and rising
   starts an 18 s lockout so no bot spends the match flopping up and down. `hideT` doubles as the
   give-up: a spot that will not take burns it four times as fast and ends in the lockout.
   Both directions go through `inp.ability = 3`, exactly the cast key a human presses (rising is
   free — tryAbility's snow toggle).
3. **fight** — a rival within the profile's `sight` (`aiNearestEnemy`, filtered through `seenAt()`
   so a buried one is simply not there — plus anyone within `AI_ANCHOR_R` of an **anchor** the bot
   is minding, noticed from up to `AI_ANCHOR_D`: its own bird under attack, the rival bird it is
   pushing, the human it escorts — so a defender finds the archer standing off its roost and an
   ally joins the fight you are in) and **reacted to** (`ai.seeT` past `react`): circle at ~70 px,
   draw and loose at the profile's `draw`, dodge at its rate, stand for the profile's share of
   every strafe. The aim point carries the scatter and the lead. Only shoots
   when `aiLineClear()` says the flight path is open — and with **no** line it never walks into
   the corner blocking it: past 60 px it routes in through the open (`steerTo`, so in a lane it
   comes down the axis rather than into the tree wall), inside it gives ground straight back and
   lets them come round the corner into the line (ten bodies pushing into a lane's bend was a
   fight nobody fired a shot in for a quarter of an hour). **Class abilities are spent here, off
   cooldown at the foe** — on the profile's ability roll (`ai.abilOk`), through the same edge
   field a human's key
   sets (`inp.ability`), each gated by the range it is good at (a warrior rushes the mid-gap,
   stomps at arm's length; a hunter locks the piercing draw on an open lane and nets the gap —
   the grapple alone is skipped, a held key and a terrain read the ladder does not try to fake).
   **Already prone, it holds perfectly still
   and shoots from where it lies** — which earns it the ambush multiplier off the same
   `ambushReady()` check a human gets, since `concealOf` discounts a moving mound and
   `ambushReady` refuses a moving shot outright.
4. **wolves** — a wolf within 92 px (or any wolf already hunting this bot): shoot it and give
   ground under 64 px, dodge under 30. A bot that wanders into a den has to fight its way out.
5. **lie low** — prone with nothing in sight: hold still and let the snow finish. Everything below
   this rung walks somewhere, and a bot crawling to a berry bush at 20 px/s has stopped playing.
6. **defend** — its own bird under `threat` on the shared read (**the two birds**, below): as
   many bots as the threat calls for (`aiDefendersWanted` — one more than the attackers seen at
   it, never fewer than two) walk to it (`aiToRoost`, below) from wherever on the map they are,
   farming, escorting or guarding, and stand 80 px off — the bird anchors rung 3, so the
   attackers are in sight on arrival — while a bot already inside `AI_ROOST_R` holds its station
   and the rest go on with the match (a side that empties the map for one arrow is a side that
   never pushes). Under `AI_ALARM_HP` (half its nerve) everyone comes, pushers included, the one
   exception a pusher whose side is winning the race — the rival bird lower still — who presses on.
7. **guard** — from 0.6 × `push.t` on, the profile's `guard` bots (1 / 2 / 2; allies 1) after
   the pushers in slot order (`aiRank`) stand by their own bird, going on down the ladder to work
   what is near while inside `AI_GUARD_R` of it. The bird is their anchor.
8. **push (the objective)** — after `push.t` (360 / 360 / 300 s; allies 720 / 480 / 420) the
   side's `push.n` lowest-ranked bots (2 / 3 / 3), **one more every `AI_ESCALATE`** (120 s) so a
   stalemate always breaks (`aiPushers`), go for the rival bird — an ally goes whenever
   **the human is already on it** (inside `AI_ROOST_R`), so a push you start is a push your side
   joins — and **any** bot joins a siege its side has going once the rival bird is under
   `AI_JOIN_HP` (0.6) with friends at it, unless its own bird is under threat, which is where it
   is wanted.
   The walk is `aiToRoost`: the roost sits in its corner's forest at the end of its lane and the
   lane is the only way in, so off it the route is field → `aiLaneGate` (`AI_GATE` px past the
   mouth on open snow) → mouth → lane → bird, on a bigger pathfinder budget (`AI_ROOST_BUDGET`,
   `navTo`'s optional last argument); a route straight at the bird runs `NAV_BUDGET` out in
   the border and leaves a bot wedged in a pocket, which is what this exists to prevent. In the
   lane, the roost's **gate turrets come down first** (E, `STRUCT_HIT_DMG` a swing — a bot
   standing off the bird under bolt fire never finishes a draw), then a hunter takes its
   station `AI_HOLD` (96 px) out **on the lane's axis**, where the gate's gap leaves the line to
   the roost open (off the axis its walls eat the shot) and outside the gust, and looses at the
   profile's draw; a warrior walks up to the nearest roost tile (`aiEagleTile`) and swings E on
   it, gust and all, exactly as a hand does. Defenders in sight are rung 3's business — until
   the side outnumbers them: a pusher inside `AI_ROOST_R` of the rival bird whose side has more
   bodies there than the defenders (the `siege` read, above rung 3) keeps hitting the bird and
   leaves the fight to its friends, turning only for a rival inside `AI_SIEGE_R` (48 px),
   because defenders come back from sixty pixels away every few seconds and a push that turns
   to meet each one never lands a swing. A roost it cannot route to is left for `ai.pushCd`
   (10 s).
9. **escort** (allies only) — the two lowest allied AI slots (`aiEscorts`) keep within
   `AI_ESCORT` (120 px) of the human while they are on the ground and inside `AI_ESCORT_R`
   (400 px), going on down the ladder while they are close.
10. **hunt** — an animal within `AI_HUNT` (120 px), with a 6 s catch timer per animal (prey
   outruns a walk). Birds are excluded: they fly, and no ground route catches a flushed flock.
11. **loot** — walk onto a drop within 72 px (drops are neutral and first-come).
12. **spend** — first a [gear](gameplay.md#gear) level when the purse covers the cheapest piece
   plus a 15-gold float. **A bot never shops**: [the merchant's counter](gameplay.md#the-merchants-counter)
   takes the same `input.cmd` a gear buy does and `shopBuy`/`shopTrade` take any `p`, so the
   path is there the day this rung learns to walk to a roost and read a price — nothing about the
   shop is human-only except the drag that sells. Then, with gold in hand, build a generator (or, 30% of the time and
   only where `findSite` finds 3×2 of room, a bot bay) on a nearby stump, else upgrade its own
   work; steps off a build site first, since a building is solid. Picking up a dropped card off the ground already falls out of the loot rung
   (drops are type-agnostic loot); a bot never opens the pick-1-of-3 draft itself
   (`bagClick` is mouse-only) — the instant one is carried, `resolveCardForBot` resolves it with a
   single random pick, since choosing among three is specifically the human decision point.
13. **harvest** — walk to a tree/rock/berried bush within `AI_FORAGE` (12 tiles) and hold E at
   the profile's `work` duty cycle.
14. **roam** — wander between its landing site and the map centre.

**The two birds.** `aiSituation()` (the `the two birds` sub-banner) is what every bot knows
about the objective, both sides of it, all match — read once per sim step (cached on
`state.tick`) and shared by all ten slots: for each roosting bird its position, its nerve as a
fraction of `EAGLE_HP`, how long since it was last hit, and who is **at** it inside `AI_ROOST_R`
(240 px) — `defenders` (its own side) and `attackers` (rivals, each resolved through `seenAt`, so
a buried archer is buried for the whole side) — with `human` set when the local slot is among the
attackers. `threat` is the one word the ladder asks — hit inside `AI_DEFEND_T` (8 s) or an
attacker seen — and `aiDefendersWanted` is how many it calls home (one more than the attackers,
at least two, everyone under `AI_ALARM_HP`). A hit on a roost is therefore news on the far side of the map the same tick,
which is what lets rung 6 answer from anywhere and rungs 6 and 8 weigh one bird against the
other. Nothing in it lets a bot do what a hand cannot: a human reads the same facts off the
map's eagle marks and the bird's nerve bar.

Every walk goes through `steerTo(x, y, reach, budget)`, which is `navTo` on the bot's own slot
([gameplay.md](gameplay.md#pathfinding)) — it routes around trees, rocks, buildings and water,
and returns **-1 when there is no route** (or the bot has been pinned for a while). That, not a
timer, is what makes a bot drop a goal: harvest puts the target on `ai.avoid` for 12 s, hunt on
`ai.huntAvoid`, loot lets the drop lie, spend backs off for 15 s, a push on `ai.pushCd`, roam
re-picks. Harvest routes
with reach `WORK_REACH` (any open tile beside the target), so `aiOpenSides() >= 1` is the only
prefilter on work; a build site still wants `>= 3` open sides. Keep the -1 branches when you
extend the ladder — a goal that is never dropped is a bot that stands still forever.

**Calibrating a level** is done bot-vs-bot, headless, in the served page: make the local slot a
bot (`player.control = 'ai'`, `players[0].ai.prof = AI_LEVELS[0]` for a middling player who
never pushes — `aiRank` skips `player`, so it holds no push or guard slot), stub
`sampleHumanInput`, `DBG.beginDrop()`, then step `update(1 / 30)` in a loop until
`teamInMatch` fails for a side (a 15-minute match takes ~10 s; `state.elapsed` pauses while
the local slot is dead, so write your own clock back into it each step, and only `'won'` /
`'lost'` in `state.over` end a match — `'respawning'` is the proxy dying). Set `DBG.freeze`
first so the frame loop stops stepping under you. Two runs of one seed are **not** the same
match: the title screen's live world spends seed draws for however many frames it was up
before the harness started, so a seed is a distribution, not a replay. Wrapping `gainGold`
and bucketing by the caller in `new Error().stack` (`hitObject`, `spillInventory`,
`animalDies`, `updateStructures`, else the trickle) is how the economy was sized in 2.63.
The match-length target is a match that ends round fifteen minutes with the human sitting it
out, ten to twenty at the tails, which is what the ally clocks are set for. On 2.64's numbers
(respawn at the bird, the proportionate defence, the siege rule and the blocked-line rule)
every NORMAL run resolved on the ally push — seeds 42, 99 and 7 at 17:28, 18:26 and 20:35, the
rivals' own pushes taking the allied bird down to 560–1060 nerve on the way and being thrown
back — where 2.63's runs half-stalemated; seed 42 on HARD was an ally win at 12:35 and on
IMPOSSIBLE a loss at 16:40, the allies' siege at 380 nerve when the rivals came home and won
the race. The NORMAL tail runs a few minutes long of the target, so the ally clocks are the
next thing to tune. Before the siege rule two to four allies sat at the rival roost for eight
minutes winning every fight against defenders who came back from sixty pixels away and never
landed a swing on the bird — the reason respawn at the objective needs the rule.

## Where players start

Nowhere, until they land: every active slot boards **its team's** eagle in `beginDrop()` — RED
and BLUE fly the map's one diagonal (a fixed `EAGLE_FLIGHT_T` 10 s each) in opposite directions,
RED from the top-right corner down to the bottom-left, BLUE the reverse, so the two sides salt
themselves along it from opposite ends and each roosts in its own fixed corner — and gets its
`spawn` from `landPlayer()`, the
nearest open tile to where it jumped. Jumping only unlocks over the line's **last `DROP_LOCK_T`
(4 s)**: AI slots jump at a hashed fraction of that window (never past its end, the last open
ground before the corner's treeline — no bot is ever force-dropped in the trees), the human where
they press Space — drifting with WASD on the way down — or **not at all**: a human who never
jumps rides the dive and the crash on the bird's back, sits through the
[drop brief](rendering.md#the-drop-brief) (the camera tour of both roosts), then hops off the
roost with E under the E - HOP OFF indicator. A profile's first flight is exactly that ride with
the manual leap refused — scripted onboarding — and a real jump is the opt-out for everyone
after. That tile is what the bot brain
treats as "home". There are no spawn pockets, no starter rings, and no guaranteed resources near
a landing — reading the ride (the dotted path over the snow, or M for the map) is the whole
point. `ringPts` (six points on a ring
`SPAWN_D` tiles from the centre — `RING_N` is frozen at 6, decoupled from the slot count) is the
old camp ring, kept only because river spokes and the keep-clear rules in `genWorld()` are built
on it.
