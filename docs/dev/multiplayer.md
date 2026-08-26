# Player slots, teams and AI

Softfall is a free-for-all. Every combatant — the local human, the AI fills, and eventually a
network peer — is a `Player` in the module-scope `players` array, and they all run the same code.
Read this before adding an ability, an input, or anything a player can do to the world.

## The slot model

`MAX_PLAYER_SLOTS` (6) slots are created once at boot by `initPlayers()`. Each slot is one of:

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
`team`, `control`, `name`, `spawn` (the tile it landed on from the eagle), `aboard`/`dropT`/`dropU`
(the eagle ride, see [Eagle drop](rendering.md#eagle-drop-mode-drop)), its own `inv` wallet and
`bag` (see [the backpack](gameplay.md#inventory-and-the-backpack)),
`level`/`xp` (see [Hero levels](#hero-levels)), `kills`, an `input` struct and an `ai` brain.
`reset(first)` places it at `spawn` and clears every transient; it is the single definition of
"a fresh player". Only boot calls it now (death is final — see below); the `first` flag still
decides whether the slot gets 3 s of i-frames, so a future respawn path can pass `false`.

Behaviour lives in free functions taking `p` (`updatePlayer`, `tryWork`, `fireArrow`, `tryDodge`,
`eatBerry`, `damagePlayer`, `die`, `spillInventory`, `placeStruct`, …), matching the rest of the file's
style — the class is the state container, not a god object.

## The input struct

`makeInput()` is the **entire interface between a controller and the sim**:

```
mx, my        movement axis, -1..1 (the sim normalises)
aimX, aimY    world-space aim point — cursor for a human, target for a bot
fire          bow held: rising edge draws, falling edge looses
work          E held
slide         shift held
dodge         edge-triggered, cleared by the sim when it reads it
prone         edge-triggered (Ctrl): TOGGLES the burrow, never a held level -
              holding a modifier while tapping W is Ctrl+W, which closes the tab
eatBerry      edge-triggered (Q)
eatFish       edge-triggered (F)
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

## Champions

Every slot also carries a champion (`p.champ`, an index into `CHAMPS` in the `players` banner).
A champion is a look plus a kit — the handful of numbers the sim reads through `kitOf(p)`
instead of the bare constants. **`kitOf(p)` returns the *effective* kit**: the champion's numbers
with the slot's [gear](gameplay.md#gear) folded in by `refreshKit(p)` (cached on `p.kit`, rebuilt
on champion or gear change — never per frame). The champion fields: `iceMax` (× `ICE_MAX`), `iceSteer`, `slideMin`, `fatigue`
(snow-slide fatigue rate), `chargeMul` (speed while drawn), `bowCharge` (seconds to full draw),
`nock` (seconds between a shot and the next draw — see [the quiver](gameplay.md#the-quiver)),
`dmgBase`/`dmgPow` (arrow damage = base + pow × draw), `spdDmg` (extra damage scaled by the
shooter's speed at release, capped at 200 px/s), `dodgeSpeed`, `maxHp`. Sites that read it:
`updatePlayer`'s movement block, `fireArrow`, `tryDodge`, the AI's draw timing, the cursor,
aim line and draw meter. `setChamp(p, c)` swaps one in (full heal — it's a pre-match choice);
`p.maxHp` is always `levelMaxHp(p)` = kit hp + the level growth below.

| # | Name | Look | Kit |
| --- | --- | --- | --- |
| 0 | **WREN**, the Ranger | the original pom-hat sprite | the original numbers, unchanged |
| 1 | **SKADI**, the Skater | hood, goggles, trailing scarf, skate blades (`SPRITES.champ[1]`) | ice cap ×1.35, sharper carves, slide engages at 60 and fatigues half as fast, draw 0.6 s at 85 % speed, arrows 3 + 6·draw **+ up to 7 for speed**, dash 245, 85 hp |

The local slot picks on the champion select screen (see
[Main menu](rendering.md#main-menu-title)); AI slots hash theirs — champion **and** all four gear
variants — from the seed in `initPlayers()` so a replayed world fields the same roster in the
same loadouts. Sprites live in `SPRITES.champ[c][team]` — same
16×16 body plan and frame set as the player, so `drawPlayer`/`drawGhost` just swap the set via
`champSet(p)`; `SPRITES.playerTeam` is champion 0.

## Hero levels

League-style: every slot has `p.level` (1–`LEVEL_MAX` = 9) and `p.xp`, which is simply lifetime
gold earned. **`gainGold(p, n)` is the only way gold enters a wallet** (drop pickups and robot
deposits both route through it) — it pays the purse, adds the same `n` to `xp` and calls
`levelUp(p)` while `xp >= LEVEL_XP[level]` (cumulative thresholds 10, 25, 45, 70, 100, 135, 175,
220 — the gap grows by 5 each level, ~220 gold to cap). Spending gold and dying never touch
`xp`; level and xp are set in the constructor, not `reset()`, so they would survive a `reset`.

Growth is flat and identical for both champions: each level past 1 adds `LVL_HP` (6) to
`maxHp` (via `levelMaxHp(p)`, healed on the spot) and `LVL_DMG` (1) to every arrow
(`fireArrow` adds it after the kit's base + pow × draw + speed bonus). Level 9 is +48 hp / +8
damage. A level-up pushes a 2× gold `LEVEL n` floater over the slot (skipped while `inAir`) and
plays `SFX.levelUp()` for the local slot.

Each level also grants **one skill point** (`p.skillPts`, starting with one at level 1). The four
hud abilities — loose, dodge, ambush, fletch — take ranks 0–`AB_RANK_MAX` (3) on `p.skill`. Rank 0
is the baseline everything already does; `buySkill(p, i)` spends a point, bumps that rank, and
`refreshKit` folds `AB_SKILL` into the same kit gear uses (`nock`, `dodgeCd`, `ambushMul`/`bury`,
`fletch`). The hud strip's plus-squares (perched on the plate, gone once spent) are the ask; bots dump a free point onto the lowest rank at
the top of `updateAI`. Nine points by level 9 fill three abilities to rank 3.

The level shows as a 7×7 badge in `drawPlayer`, flush against the left edge of the overhead
bars' backing and spanning the health bar + stamina bar stacked (`py-8 .. py-1`), drawn for every
slot in the bars' backing/track colours with the digit in gold. `DBG.gainGold(n, p?)` pays a
slot (default local) the way a pickup would, which is how to stage a level.

## Teams and colours

Four presets live in `SPRITES.teams` (`TEAM_SKINS` in [js/sprites.js](../../js/sprites.js)):
**EMBER** (the original red/teal look), **FROST**, **PINE**, **DUSK**. A slot's team is
`slot % TEAM_COUNT`, so with 6 slots the last two double up with slots 0 and 1 — teammates, not
rivals. The team table is the only place a team colour is written down; game.js reads it back as
`TEAMS` for name tags, map markers and death bursts.

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

Six slots over four presets means **teammates share a colour**, so anything that names one player
in text takes a second axis: `playerTint(p)` returns a per-slot shade of that team's palette
(`trim`, `hatL`, `trimD`, `hat` by `floor(id / TEAM_COUNT)`). The team colour stays the
background, the tint is the ink — see the
[scoreboard and event feed](rendering.md#scoreboard-and-event-feed).

## PvP

`enemyOf(p, q)` is the one place the rule lives: another live, active slot on **another** team.
Arrows carry `owner`/`team` and test players first in `updatePlay`'s arrow loop, using the
same body radius; a hit calls `damagePlayer(target, dmg, dx, dy, src, cause)` for knockback, flash,
floater and possibly `die(p, src, cause)`. Friendly fire is off, and an arrow can never hit its
shooter. `damagePlayer` takes a seventh argument, `crit`, which the arrow loop passes from
`a.ambush`: it runs the damage floater hotter and at double scale and doubles the local shake. Any
hit also calls `risePlayer` before anything else, so nobody stays buried through one.

**Whether a rival can be seen at all is a separate question from whether they can be shot.**
`enemyOf` answers the second; `seenAt(p, range)` answers the first, and every watcher in the
game — the bot brain, the wolf pack, both turret checks — resolves through it. See
[Prone](gameplay.md#prone-under-the-snow).

**A rival's worker bots are targets too** — they are tested straight after the players, on the same
team rule, through `hurtRobot` (see [Robots](gameplay.md#robots)). Shooting one costs the owner
its income and spills the gold it was carrying, so a base's economy can be raided without ever
touching the base; the feed says so, but a worker is never a kill on the scoreboard.

`die(p, src, cause)` empties the wallet **and the bag** the same way regardless of what happens
next: the killer pockets the gold via `gainGold`, an uncredited death spills it, and every carried
stack always spills, one drop each (the standings rank lifetime `xp`, so they still show what the
slot earned). What happens next depends on `teamHasLivingKeep(p.team)` — see
[The Keep](#the-keep) — either a flat, gold-free respawn timer (`p.respawnT`, ticked by
`updateRespawns`) or, with no Keep, `p.eliminated = true`, today's exact permanent path;
`updatePlayer` just zeroes a dead slot's intents either way. Only the local slot's **elimination**
takes the full death overlay with it (`endMatch('lost')`); a respawn-pending local death gets the
lighter `endMatch('respawning')` overlay instead — same `state.mode = 'dead'` machinery (so the
4-second replay window, the TAB scoreboard and the dim all still work), just a countdown string
and no permanent loss. Either way `state.mode = 'dead'` offers spectating a living rival through
`viewPlayer()`/`specNext()`, or `toLobby()` back to the title. Every death (and every Keep's
destruction) runs `checkLastStanding()`, which ends the match as a win once no **rival team** is
left — `rivalTeamsInMatch()`/`teamInMatch()` read the same other-team rule `enemyOf` does, so the
last *team* standing wins: a surviving teammate, or a Keep still waiting to respawn someone into,
keeps a team in the match even at zero living players. **The match keeps simulating while you are
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
one), fish spears (`fireArrow`, keyed by fish index — a full bag refuses the catch before the
contest is even entered), drop pickups (keyed by drop index — every player standing on a drop
claims it *if they have room for it*, and the magnet pulls it toward the nearest such player,
so a full bag hands the pickup on rather than sitting on it — a dropped card is a neutral pickup
the same way, first-come whichever team gets there), and spent-arrow
pickups (keyed by `shafts` index — a shaft is neutral like a drop, so anyone short of a full quiver
can pull one out, whoever shot it; see [the quiver](gameplay.md#the-quiver)).

## AI slots

`updateAI(p, dt)` (the `ai` banner) writes `p.input` and nothing else — a bot can never do anything
a human couldn't. It is a priority ladder re-picked a few times a second:

1. **eat** — fish below 50% hp, berry below 80%.
2. **burrow** — decided up front, because two rungs below read the answer. A bot that has come off
   worse (under 40% hp) with no rival and no wolf in sight goes [prone](gameplay.md#prone-under-the-snow)
   and waits the fight out for `ai.hideT` (7–12 s); it only ever tries where a player could, on
   snow and on its own feet, which is also what stops it planting itself on a river. It gets
   straight back up for a wolf, for a rival inside 48 px, or when the spell runs out, and rising
   starts an 18 s lockout so no bot spends the match flopping up and down. `hideT` doubles as the
   give-up: a spot that will not take burns it four times as fast and ends in the lockout.
   The toggle goes through `inp.prone`, exactly the flag Ctrl sets.
3. **fight** — a rival within `AI_SIGHT` (150 px, now filtered through `seenAt()` so a buried one
   is simply not there): circle at ~70 px, draw and loose near full, dodge when hurt. Only shoots
   when `aiLineClear()` says the flight path is open. **Already prone, it holds perfectly still
   and shoots from where it lies** — which earns it the ambush multiplier off the same
   `ambushReady()` check a human gets, since `concealOf` discounts a moving mound and
   `ambushReady` refuses a moving shot outright.
4. **wolves** — a wolf within 92 px (or any wolf already hunting this bot): shoot it and give
   ground under 64 px, dodge under 30. A bot that wanders into a den has to fight its way out.
5. **lie low** — prone with nothing in sight: hold still and let the snow finish. Everything below
   this rung walks somewhere, and a bot crawling to a berry bush at 20 px/s has stopped playing.
6. **hunt** — an animal within `AI_HUNT` (120 px), with a 6 s catch timer per animal (prey
   outruns a walk). Birds are excluded: they fly, and no ground route catches a flushed flock.
7. **loot** — walk onto a drop within 72 px (drops are neutral and first-come). A bot at or below
   half a quiver counts spent [shafts](gameplay.md#the-quiver) in the same scan, so the arrows a
   firefight leaves lying around get picked back up.
8. **spend** — first a [gear](gameplay.md#gear) level when the purse covers the cheapest piece
   plus a 15-gold float. Then: with no living or rising team [Keep](gameplay.md#base-building), a
   bot saves for and builds one before anything else (`needKeep` short-circuits the rest of this
   rung until it can afford tier 0 — a team with no Keep is one wipe from permanent elimination
   with no way back) — otherwise, with gold in hand, build a generator (or, 30% of the time and
   only where `findSite` finds 3×2 of room, a bot bay) on a nearby stump, else upgrade its own
   work, else queue a card craft on an owned finished Keep; steps off a build site first, since a
   building is solid. Picking up a dropped card off the ground already falls out of rung 7 below
   (drops are type-agnostic loot); a bot never opens the pick-1-of-3 draft itself
   (`bagClick` is mouse-only) — the instant one is carried, `resolveCardForBot` resolves it with a
   single random pick, since choosing among three is specifically the human decision point.
9. **harvest** — walk to a tree/rock/berried bush within `AI_FORAGE` (12 tiles) and hold E.
10. **roam** — wander between its landing site and the map centre.

Every walk goes through `steerTo(x, y, reach)`, which is `navTo` on the bot's own slot
([gameplay.md](gameplay.md#pathfinding)) — it routes around trees, rocks, buildings and water,
and returns **-1 when there is no route** (or the bot has been pinned for a while). That, not a
timer, is what makes a bot drop a goal: harvest puts the target on `ai.avoid` for 12 s, hunt on
`ai.huntAvoid`, loot lets the drop lie, spend backs off for 15 s, roam re-picks. Harvest routes
with reach `WORK_REACH` (any open tile beside the target), so `aiOpenSides() >= 1` is the only
prefilter on work; a build site still wants `>= 3` open sides. Keep the -1 branches when you
extend the ladder — a goal that is never dropped is a bot that stands still forever.

## Where players start

Nowhere, until they land: every active slot boards the eagle in `beginDrop()` and gets its
`spawn` from `landPlayer()` — the nearest open tile to where it jumped (AI slots jump at a hashed
fraction of the line, the human where they press Space — drifting with WASD on the way down — or at
the end of the line). That tile is
what the bot brain treats as "home". There are no
spawn pockets, no starter rings, and no guaranteed resources near a landing — reading the
chart during the ride is the whole point. `ringPts` (six points on a ring `SPAWN_D` tiles from
the centre) is the old camp ring, kept only because river spokes and the keep-clear rules in
`genWorld()` are built on it.
