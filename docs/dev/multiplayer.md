# Player slots, teams and AI

Emberfrost is a free-for-all. Every combatant — the local human, the AI fills, and eventually a
network peer — is a `Player` in the module-scope `players` array, and they all run the same code.
Read this before adding an ability, an input, or anything a player can do to the world.

## The slot model

`MAX_PLAYER_SLOTS` (6) slots are created once at boot by `initPlayers()`, which runs after
`genWorld()` because the constructor needs `spawnPts`. Each slot is one of:

- `control: 'human'` — driven by keyboard/mouse. Today exactly one slot is human: **slot 0, this
  session's player**. `player` and `inv` point at it (and only at it) for the camera, HUD, cursor,
  audio gating and the aim line.
- `control: 'ai'` — driven by `updateAI()`. Every vacant slot is filled with one at boot.
- `control: 'none'` — nobody is in it. The slot still exists and still owns a camp; it is drawn as
  a flat team-tinted silhouette there (`drawGhost`) and is skipped by the sim, arrows and drops.
  `p.active` is the `control !== 'none'` test every such loop uses.

`DBG.setControl(slot, 'human'|'ai'|'none')` flips a slot live, which is how you stage a scene with
fewer bots, a frozen target dummy, or a ghost.

**A `Player` owns everything the old singleton did** — position, velocity, facing, hp, bow draw,
dodge charges, slide state, swing state, held tool, i-frames, footprint cadence — plus `id`,
`team`, `control`, `name`, `spawn`, its own `inv` wallet, an `input` struct and an `ai` brain.
`reset(first)` does camp placement and clears every transient; it is the single definition of
"a fresh player", used at boot and on respawn (respawn passes `false`, which grants 3 s i-frames).

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
aim line and draw meter. `setChamp(p, c)` swaps one in (full heal — it's a pre-match choice).

| # | Name | Look | Kit |
| --- | --- | --- | --- |
| 0 | **WREN**, the Ranger | the original pom-hat sprite | the original numbers, unchanged |
| 1 | **SKADI**, the Skater | hood, goggles, trailing scarf, skate blades (`SPRITES.champ[1]`) | ice cap ×1.35, sharper carves, slide engages at 60 and fatigues half as fast, draw 0.6 s at 85 % speed, arrows 3 + 6·draw **+ up to 7 for speed**, dash 245, 85 hp |

The local slot picks on the champion select screen (see
[Main menu](rendering.md#main-menu-title)); AI slots hash theirs from the seed in `initPlayers()`
so a replayed world fields the same roster. Sprites live in `SPRITES.champ[c][team]` — same
16×16 body plan and frame set as the player, so `drawPlayer`/`drawGhost` just swap the set via
`champSet(p)`; `SPRITES.playerTeam` is champion 0.

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
- `SPRITES.robotTeam[team]` — spawner robots wear their owner's colour.

Structures carry `owner` (slot id) and `team`, set by `placeStruct()`. `ownsStruct(o, p)` gates the
manage wheel, upgrades and demolition; the right-click handler and `cursorInfo()` only offer the
hammer over a stump (neutral) or your own building.

## PvP

`enemyOf(p, q)` is the one place the rule lives: another live, active slot on **another** team.
Arrows carry `owner`/`team` and test players before animals in `updatePlay`'s arrow loop, using the
same body radius; a hit calls `damagePlayer(target, dmg, dx, dy)` for knockback, flash, floater and
possibly `die(p)`. Friendly fire is off, and an arrow can never hit its shooter.

`die(p)` marks the slot dead, keeps 60% of its wallet and starts a 2.6 s `respawnT`; `updatePlayer`
counts it down and calls `respawn(p)`. Only the local slot's death takes the screen with it
(`state.mode = 'dead'` for the overlay). **The match keeps simulating while you are down** —
`update()` runs `updatePlay` in both `play` and `dead` mode; only the local overlays (pause, map,
settings) stop the world.

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
3. **hunt** — an animal within `AI_HUNT` (120 px), with a 6 s give-up timer per animal.
4. **unwedge** — after being stuck, walk back toward its camp before doing anything else.
5. **loot** — walk onto a drop within 72 px (drops are neutral and first-come).
6. **spend** — with gold in hand, build a generator/spawner on a nearby stump, else upgrade its own
   work; steps off the stump first, since a building is solid.
7. **harvest** — walk to a tree/rock/berried bush within `AI_FORAGE` (12 tiles) and hold E.
8. **roam** — wander between its camp and the map centre.

**Nothing here paths around an obstacle**, so every pursuit carries a give-up timer and a short
blacklist (`ai.avoid`, `ai.huntAvoid`), and `aiOpenSides()` keeps bots from targeting work buried
inside the treeline. Those guards are what stop a bot freezing against a wall forever — keep them
when you extend the ladder.

## Spawn pockets

`spawnPts` is one camp per slot, evenly spaced on a ring `SPAWN_D` (`WORLD/2 - 55`) tiles from the
centre, so no start is favoured. `genWorld()` clears a pocket at each, carves a river spoke from
each to the centre plus a ring between neighbouring camps, keeps ponds/rocks/bushes clear of them,
and gives **every** camp the same starter ring of rocks and bushes. Changing the slot count changes
worldgen for a given seed.
