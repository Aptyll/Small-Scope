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
(the eagle ride, see [Eagle drop](rendering.md#eagle-drop-mode-drop)), its own `inv` wallet,
`level`/`xp` (see [Hero levels](#hero-levels)), `kills`, an `input` struct and an `ai` brain.
`reset(first)` places it at `spawn` and clears every transient; it is the single definition of
"a fresh player". Only boot calls it now (death is final — see below); the `first` flag still
decides whether the slot gets 3 s of i-frames, so a future respawn path can pass `false`.

Behaviour lives in free functions taking `p` (`updatePlayer`, `tryWork`, `fireArrow`, `tryDodge`,
`eatBerry`, `damagePlayer`, `die`, `respawn`, `placeStruct`, …), matching the rest of the file's
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
eatBerry      edge-triggered (Q)
eatFish       edge-triggered (F)
cmd           one-shot order {kind:'build'|'upgrade'|'demolish'|'mode', tx, ty, id}
```

`sampleHumanInput(player)` (input banner) folds `keys`/`mouse` into slot 0's struct once per step,
and zeroes it — dropping any draw — while an overlay, the wheel or pause is up. The keydown
handlers and `resolveWheel()` no longer act directly: they set `input.dodge` / `input.eatFish` /
`input.cmd` and let the next `updatePlayer` perform it. **A new ability must be a field here**, or
bots and future network peers can't use it.

`workTarget(p)` reads `p.input.aimX/aimY`, not the mouse, which is why the cursor's lock ring and a
bot's chop resolve through exactly the same function.

## Champions

Every slot also carries a champion (`p.champ`, an index into `CHAMPS` in the `players` banner).
A champion is a look plus a kit — the handful of numbers the sim reads through `kitOf(p)`
instead of the bare constants: `iceMax` (× `ICE_MAX`), `iceSteer`, `slideMin`, `fatigue`
(snow-slide fatigue rate), `chargeMul` (speed while drawn), `bowCharge` (seconds to full draw),
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
[Main menu](rendering.md#main-menu-title)); AI slots hash theirs from the seed in `initPlayers()`
so a replayed world fields the same roster. Sprites live in `SPRITES.champ[c][team]` — same
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
Arrows carry `owner`/`team` and test players before animals in `updatePlay`'s arrow loop, using the
same body radius; a hit calls `damagePlayer(target, dmg, dx, dy, src, cause)` for knockback, flash,
floater and possibly `die(p, src, cause)`. Friendly fire is off, and an arrow can never hit its
shooter.

`die(p, src, cause)` marks the slot dead for good — no respawn, the wallet kept for the
standings; `updatePlayer` just zeroes a dead slot's intents. Only the local slot's death takes
the screen with it (`endMatch('lost')` → `state.mode = 'dead'` and the death overlay: spectate a
living rival through `viewPlayer()`/`specNext()`, or `toLobby()` back to the title), and every
death runs `checkLastStanding()`, which ends the match as a win when the local slot is the only one
left. **The match keeps simulating while you are out** — `update()` runs `updatePlay` in both
`play` and `dead` mode; only the local overlays (pause, map, settings) stop the world. Full
detail: [Death is final](gameplay.md#death-is-final).

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
tile), fish spears (`fireArrow`, keyed by fish index), drop pickups (keyed by drop index — every
player standing on a drop claims it; the magnet still pulls it toward the nearest).

## AI slots

`updateAI(p, dt)` (the `ai` banner) writes `p.input` and nothing else — a bot can never do anything
a human couldn't. It is a priority ladder re-picked a few times a second:

1. **eat** — fish below 50% hp, berry below 80%.
2. **fight** — a rival within `AI_SIGHT` (150 px): circle at ~70 px, draw and loose near full,
   dodge when hurt. Only shoots when `aiLineClear()` says the flight path is open.
3. **wolves** — a wolf within 92 px (or any wolf already hunting this bot): shoot it and give
   ground under 64 px, dodge under 30. A bot that wanders into a den has to fight its way out.
4. **hunt** — an animal within `AI_HUNT` (120 px), with a 6 s give-up timer per animal. Birds are
   excluded: with no pathfinding, a flushed flock is a wild goose chase.
5. **unwedge** — after being stuck, walk back toward its landing site before doing anything else.
6. **loot** — walk onto a drop within 72 px (drops are neutral and first-come).
7. **spend** — with gold in hand, build a generator (or, 30% of the time and only where
   `findSite` finds 3×2 of room, a bot bay) on a nearby stump, else upgrade its own
   work; steps off the stump first, since a building is solid.
8. **harvest** — walk to a tree/rock/berried bush within `AI_FORAGE` (12 tiles) and hold E.
9. **roam** — wander between its landing site and the map centre.

**Nothing here paths around an obstacle**, so every pursuit carries a give-up timer and a short
blacklist (`ai.avoid`, `ai.huntAvoid`), and `aiOpenSides()` keeps bots from targeting work buried
inside the treeline. Those guards are what stop a bot freezing against a wall forever — keep them
when you extend the ladder.

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
