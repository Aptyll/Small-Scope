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
"a fresh player". Only boot calls it now (death is final — see below); the `first` flag still
decides whether the slot gets 3 s of i-frames, so a future respawn path can pass `false`.

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
cmd           one-shot order {kind:'build'|'upgrade'|'demolish'|'craft', tx, ty, id}
              or {kind:'gear', piece} - a gear buy: no tile, no reach, no contest
              or {kind:'skill', i} - a hud-ability rank: same, free (a skill point)
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
| 1 | **WARRIOR** — close pressure, blocking, momentum | get to arm's length and stay there | 120 hp, faster on ice (×1.15), +5 speed damage, dash 230, softer bow numbers | a SLING loaded ARROW + HEFT |

The **weapon is part of the class**: `CLASS_LOADOUT` (js/tools.js) pairs each one with a tool
and its bits, and `setClass` / `Player.reset` hand it over — so the two classes do not shoot the
same thing, every AI slot arrives armed, and a respawn is re-armed after
[death spills the build](gameplay.md#death-is-final). See
[Tools and bits](gameplay.md#tools-and-bits). The four ABILITIES beside the weapon — what each
one does, its cooldown, cast, and the states it leaves on a body — are
[Class abilities](gameplay.md#class-abilities-keys-1-4) in gameplay.md.

The local slot picks on the class select screen (see
[Main menu](rendering.md#main-menu-title)); AI slots hash theirs — class **and** all four gear
variants — from the seed in `initPlayers()` so a replayed world fields the same roster in the
same loadouts. Class select shows that roster as two columns of cards — your side left, the
rivals right, their picks face-down until PLAY's countdown turns them — and the three notches
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
`levelUp(p)` while `xp >= LEVEL_XP[level]` (cumulative thresholds 10, 25, 45, 70, 100, 135, 175,
220, 270, 325, 385 — the gap grows by 5 each level, ~385 gold to cap). Spending gold and dying never touch
`xp`; level and xp are set in the constructor, not `reset()`, so they would survive a `reset`.

Growth is flat and identical for both classes: each level past 1 adds `LVL_HP` (6) to
`maxHp` (via `levelMaxHp(p)`, healed on the spot) and `LVL_DMG` (1) to every arrow
(`emitBit` adds it after the bit's base + pow × draw + speed bonus). Level 12 is +66 hp / +11
damage. A level-up pushes a 2× gold `LEVEL n` floater over the slot (skipped while `inAir`) and
plays `SFX.levelUp()` for the local slot.

Each level also grants **one skill point** (`p.skillPts`, starting with one at level 1), and a
point buys exactly one thing: **a level on one of the four class abilities**
([gameplay.md](gameplay.md#class-abilities-keys-1-4)), spent on the hud strip's floating buy
plates. Twelve points by level 12 max the four keys' twelve levels exactly. (The old kit-skill
row — LOOSE/DODGE/AMBUSH/FLETCH ranks in the backpack — was removed with the pack's
simplification; its passive bonuses live on only as gear variants and cards.) Bots spend each
free point in `updateAI`'s rung 0, lowest ability level first.

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
Arrows carry `owner`/`team` and test players first in `updatePlay`'s arrow loop, using the
same body radius; a hit calls `damagePlayer(target, dmg, dx, dy, src, cause)` for knockback, flash,
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
strike without damage — a rival **E swing** chips `EAGLE_WORK_DMG` (60) through `hitObject`'s eagle
branch (the roost tiles are `eagle` objects, a rival-only work target — `workTarget` reads the
`team` they carry), and at zero the bird is **driven off**: `eagleFlee` lifts it away over the
treeline while every camera pans to watch (`state.eagleCine`, the driven-off ceremony), and
`EAGLE_CINE_T` later `eagleFleeResolve` takes the whole owning side out of the match (see
[Death is final](gameplay.md#death-is-final) and the eagle-drop section in
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
slot earned). What happens next depends on `teamHasLivingKeep(p.team)` **and**
`teamEagleDown(p.team)` — see [The Keep](#the-keep) — either a flat, gold-free respawn timer
(`p.respawnT`, ticked by `updateRespawns`; only with a living Keep *and* a living eagle) or
`p.eliminated = true`, the permanent path;
`updatePlayer` just zeroes a dead slot's intents either way. Only the local slot's **elimination**
takes the full death overlay with it (`endMatch('lost')`); a respawn-pending local death gets the
lighter `endMatch('respawning')` overlay instead — same `state.mode = 'dead'` machinery (so the
4-second replay window, the TAB scoreboard and the dim all still work), just a countdown string
and no permanent loss. Either way `state.mode = 'dead'` offers spectating a living rival through
`viewPlayer()`/`specNext()`, or the way out to the title — which for an **elimination** goes
through [the defeat screen](rendering.md#the-end-screens) first (`openDefeat()`, and its own plank
calls `toLobby()`), because a lost match ends when you stop watching it rather than when you go
down. Every death (and every Keep's destruction) runs `checkLastStanding()`, which ends the match
as a win once no **rival team** is
left — `rivalTeamsInMatch()`/`teamInMatch()` read the same other-team rule `enemyOf` does, so the
last *team* standing wins: a surviving teammate, or a Keep still waiting to respawn someone into,
keeps a team in the match even at zero living players — **unless its eagle has been driven off**:
`teamInMatch` asks `teamEagleDown(team)` first, and a fled eagle takes the side out whatever
else it still holds (`eagleFlee` in js/boot.js is what puts every slot down at liftoff). **The match keeps simulating while you are
out** — `update()` runs `updatePlay` in both `play` and `dead` mode; only pause and the settings
panel stop the world (the map does not). Full detail: [Death is final](gameplay.md#death-is-final).

### The Keep

A team's Keep (`STRUCTS.keep`, a 2×2 singleton — `teamHasLivingKeep(team)` is the one-per-team
gate, checked both before and inside the build's `contest()` callback since two teammates could
otherwise both pass the pre-check in one tick) is what makes a death temporary: `die()` reads it
to decide between a respawn timer and permanent elimination, and `checkLastStanding()` reads it to
decide whether a team with zero living players is actually out. It's built and managed through the
same [radial wheel](gameplay.md#base-building) every other structure uses — see
[gameplay.md](gameplay.md#base-building) for the build, the craft queue, and the card drops; see
[gameplay.md](gameplay.md#roguelike-cards) for what a drafted card actually does to `kitOf(p)`.

`updateRespawns(dt)` (called from `updatePlay` beside `updateStructures`) counts down every
`p.dead && !p.eliminated` slot's `p.respawnT`; at zero it re-checks the Keep is still standing (it
may have fallen mid-timer — the wait is never cut short, so a rival can't get credit for
eliminating a team faster than the timer promises) and either calls `respawnPlayer(p)` — which
finds a clear tile near the Keep's `structMouth()` (`nearestDryTile`, the same spiral search
`landPlayer` uses for an eagle landing) and calls `p.reset(false)`, the exact full-clear a fresh
landing gets, i-frames included — or falls back to `p.eliminated = true` and calls
`checkLastStanding()` itself, since a Keep dying mid-timer can be the actual elimination blow.
`p.cards` (picked roguelike cards) is never touched by `reset()`, so a build survives every
respawn within a match, the same way gear and skill ranks already do.

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
tile — a Keep order adds a second check, `teamHasLivingKeep`, re-run *inside* the winning
callback so two teammates ordering one on two different stumps in the same tick can't both land
one), fish spears (`spearFish`, keyed by fish index — a full bag refuses the catch before the
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
keeps moving in a fight; the rest it stands, which is when a new player hits it), `pick`
(`'near'`, or IMPOSSIBLE's `'weak'` — the rival with the least hp), `push`, `guard` and
`defendR` (the objective, below), `support` (allies only).

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
   when `aiLineClear()` says the flight path is open. **Class abilities are spent here, off
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
6. **defend** — its own bird hit inside the last `AI_DEFEND_T` (8 s) and the bot inside the
   profile's `defendR` (900 / 1600 / everywhere; allies 2000): walk to it (`aiToRoost`, below)
   and stand 80 px off; the bird anchors rung 3, so the attackers are in sight on arrival.
7. **guard** — from 0.6 × `push.t` on, the profile's `guard` bots (1 / 2 / 2; allies 1) after
   the pushers in slot order (`aiRank`) stand by their own bird, going on down the ladder to work
   what is near while inside `AI_GUARD_R` of it. The bird is their anchor.
8. **push (the objective)** — after `push.t` (360 / 240 / 150 s; allies 420 / 300 / 240) the
   side's `push.n` lowest-ranked bots (2 / 3 / 3), **one more every `AI_ESCALATE`** (120 s) so a
   stalemate always breaks (`aiPushers`), go for the rival bird — and an ally goes whenever
   **the human is already on it** (within 220 px), so a push you start is a push your side joins.
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
   it, gust and all, exactly as a hand does. Defenders in sight are rung 3's business. A roost it
   cannot route to is left for `ai.pushCd` (10 s).
9. **escort** (allies only) — the two lowest allied AI slots (`aiEscorts`) keep within
   `AI_ESCORT` (120 px) of the human while they are on the ground and inside `AI_ESCORT_R`
   (400 px), going on down the ladder while they are close.
10. **hunt** — an animal within `AI_HUNT` (120 px), with a 6 s catch timer per animal (prey
   outruns a walk). Birds are excluded: they fly, and no ground route catches a flushed flock.
11. **loot** — walk onto a drop within 72 px (drops are neutral and first-come).
12. **spend** — first a [gear](gameplay.md#gear) level when the purse covers the cheapest piece
   plus a 15-gold float. Then: with no living or rising team [Keep](gameplay.md#base-building), a
   bot saves for and builds one before anything else (`needKeep` short-circuits the rest of this
   rung until it can afford tier 0 — a team with no Keep is one wipe from permanent elimination
   with no way back) — otherwise, with gold in hand, build a generator (or, 30% of the time and
   only where `findSite` finds 3×2 of room, a bot bay) on a nearby stump, else upgrade its own
   work, else queue a card craft on an owned finished Keep; steps off a build site first, since a
   building is solid. Picking up a dropped card off the ground already falls out of the loot rung
   (drops are type-agnostic loot); a bot never opens the pick-1-of-3 draft itself
   (`bagClick` is mouse-only) — the instant one is carried, `resolveCardForBot` resolves it with a
   single random pick, since choosing among three is specifically the human decision point.
13. **harvest** — walk to a tree/rock/berried bush within `AI_FORAGE` (12 tiles) and hold E at
   the profile's `work` duty cycle.
14. **roam** — wander between its landing site and the map centre.

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
the local slot is dead, so bound the loop by steps too). On 2.61's numbers, five seeds a level
with that passive proxy: NORMAL — the rivals never took the bird (two ally wins past twelve
minutes, three stalemates the human is there to break); HARD — one win, two losses, one
stalemate; IMPOSSIBLE — one win, one loss at five minutes, two stalemates. A first game is
NORMAL with a player who engages, which those numbers put comfortably past the four-in-five
wins asked for; the gradient above it is what the notches are for.

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
