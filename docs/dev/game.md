# What Softfall is

The design in one page: the shape of a match and the handful of ideas every system answers to.
Read this before proposing a feature or judging whether one fits — the *how* of each pillar is in
the deep doc it links to. Nothing here is an invariant; [CLAUDE.md](../../CLAUDE.md) carries those.

**Softfall is a browser canvas 2D top-down pixel-art cozy survival team battle on a winter map.**
Cozy and a war at once is the whole tension: the snowfield is quiet, the trees are pretty, and
nine other people are on it.

## A match

Ten slots in `players` — **slot 0 is you, the rest are AI** — across **two teams of five, RED vs
BLUE** (slots alternate). Everyone picks one of **two champions** (WREN the Ranger, SKADI the
Skater) and is **dropped in by their team's armoured eagle** — the two birds fly the one line in
opposite directions and pass mid-route; nobody starts at a spawn camp. At the end of its line each
eagle dives into the treeline and becomes its team's **objective**. **Last team standing wins.**

The world is 232 tiles of 16 px — a 3712×3712 px snowfield with a forest border and an open
interior threaded by frozen lakes and rivers. See [world.md](world.md#the-tile-world).

## The pillars

**Arrows are finite, on a bow that is always in hand.** There is no weapon swap — the bow is the
default state of your hands. A spent shaft sticks in the snow where it landed and **anyone** can
pick it up, so a firefight leaves ammunition on the ground for whoever is still standing.
[The quiver](gameplay.md#the-quiver).

**Momentum is the movement.** Ice is mechanically slippery, dodges chain, and **a roll is a hit** —
the dodge is an attack, which is why a player mid-roll passes through small units instead of
colliding with them. [Momentum movement](gameplay.md#momentum-movement-players-only),
[the roll is a hit](gameplay.md#the-roll-is-a-hit).

**Ctrl goes prone and the snow covers you.** Concealment is a real state the world reads, not a
visual effect: everything that decides it can see a player goes through one function, and burial
lives inside it. [Prone](gameplay.md#prone-under-the-snow).

**E is the one verb for the world.** The same key harvests a tree, mines a rock, breaks an
enemy building, and strikes a rival's grounded eagle. [Tools and the bow](gameplay.md#tools-and-the-bow).

**Gold is the only currency, and gold is also XP.** No wood, no stone — one number earned many
ways, each source with its own yield profile. Every payout levels you as a side effect.
[Economy](gameplay.md#economy-one-currency), [Hero levels](multiplayer.md#hero-levels).

**You carry a 10-cell backpack.** The wallet (`p.inv`) is gold and nothing else; everything you
*carry* is `p.bag`, and it is small on purpose. Berries and fish are food, never spent.
[Inventory and the backpack](gameplay.md#inventory-and-the-backpack).

**Gear is 4 pieces × 3 variants, bought from anywhere.** No shop building and no trip home — the
gear page is a menu, and a piece levels through four materials. [Gear](gameplay.md#gear).

**Your eagle is your life.** The bird that carried the team in crashes into a patch of trees at
the end of its line and roosts there, armoured in team colour. Its hp pool is its **nerve**:
hits spook it, it calms back down between scares, it defends its own ground with a wing gust —
and when its nerve breaks it is **driven off**, not killed: every camera pans to watch it fly
away, and its whole side falls with it as it goes. The second, symmetric way to win a match, and the reason both teams
always have somewhere worth walking to. [Eagle drop](rendering.md#eagle-drop-mode-drop),
[Death is final](gameplay.md#death-is-final).

**A team's Keep is its way back.** No living Keep means **permadeath**, which is what makes a base
worth defending and worth attacking. The Keep also crafts **rarity-rolled roguelike cards**, drafted
three-at-a-time from a bag cell without pausing the sim. [The Keep](multiplayer.md#the-keep),
[Death is final](gameplay.md#death-is-final), [Roguelike cards](gameplay.md#roguelike-cards).

**An ice hole is a build site.** Break the ice twice and the hole it leaves takes the one `water`
building — a **fish net**, laid flat and walked *on* rather than into — over a live fish population
that spears and nets draw down and a trickle refills. [Ice holes and fishing](world.md#ice-holes-and-fishing).

**Hold middle mouse to aim your one worker flag, release to plant — what it sits on is the order.**
One flag per player, and the target tile decides the job: a tree means cut there, open ground means
clear a lane, your own building means guard it, anything another team owns means go break it.
[Worker flags](gameplay.md#worker-flags), [Robots](gameplay.md#robots).

**Landmarks are named places, not decoration.** Two exist: a **WOLF DEN** (the only hostile
wildlife in the game) and a **ROOKERY**. [Landmarks](world.md#landmarks).

## What the design is not

- **Not a resource tree.** One currency, deliberately. A proposal that adds a second resource is
  proposing a different game.
- **Not a respawn shooter.** Death is final while your Keep is dead; that is the stake everything
  else borrows from.
- **Not a solo survival game.** Every mechanic runs per slot off `p.input`, and `player` is only
  the local one — see [multiplayer.md](multiplayer.md).
- **Not a game that explains itself in text.** The UI rule in [CLAUDE.md](../../CLAUDE.md) is a
  design constraint, not a style preference.
- **Not an account.** The player profile is a display name and a few lifetime numbers in the
  browser, and it is skippable. No passwords, no sign-in, nothing gated behind it and nothing in a
  match reading it but the name over your head — see
  [architecture.md](architecture.md#profilejs). If a server ever holds it, it holds the same
  object.
