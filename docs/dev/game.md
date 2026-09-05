# What Softfall is

The design in one page: the shape of a match and the handful of ideas every system answers to.
Read this before proposing a feature or judging whether one fits — the *how* of each pillar is in
the deep doc it links to. Nothing here is an invariant; [CLAUDE.md](../../CLAUDE.md) carries those.

**Softfall is a browser canvas 2D top-down pixel-art cozy survival team battle on a winter map.**
Cozy and a war at once is the whole tension: the snowfield is quiet, the trees are pretty, and
nine other people are on it.

## A match

Ten players in `players` — **player 0 is you, the rest are AI** — across **two teams of five, RED vs
BLUE** (players alternate). Everyone picks one of **two classes** (the ranged HUNTER, the melee
WARRIOR) and is **dropped in by their team's armoured eagle** — the two birds fly the map's one
diagonal in opposite directions and pass mid-route; nobody starts at a spawn camp. At the end of
its line each eagle dives into its **corner's** treeline — RED always bottom-left, BLUE always
top-right — and becomes its team's **objective**; its **merchant** climbs down to raise a gate,
clear the rim and then keep shop at the lane mouth for anybody at all who walks up to it, and a
**lane** of pines falls open back to the snow. **Drive off the rival eagle
and the match is won** — nothing else ends one: a player who goes down waits, and is set back
down at their own bird.

**Your side is always blue.** Whatever team index the roster dealt you, your allies are painted
BLUE and your enemies RED — nameplates, arrows, armour, buildings, map marks, bot names, all of
it — through one function (`skin`, js/player.js) the paint goes through and the rules never do.
A settings toggle (MY TEAM) shows the roster's real colours instead.
[Teams and colours](multiplayer.md#teams-and-colours).

The world is 232 tiles of 16 px — a 3712×3712 px snowfield with a forest border and an open
interior threaded by frozen lakes and rivers. See [world.md](world.md#the-tile-world).

Outside the match sits one room: the **practice tool** — a small, fixed, seedless training field
cut to pure combat (a mending dummy, a perimeter target track with a bell-rung scored archery
round, and a timed ice-parkour loop through
the surrounding forest), found by breaking the ice off its menu plank. Nothing in it counts and
nothing in it is at stake. See [the practice arena](world.md#the-practice-arena).

## The pillars

**Your weapon is something you build.** One weapon slot holds a **tool** — a body
with a rate of fire, a number of bit cells and a weight it is strong enough to throw. What comes
out of it is the **bits** loaded into it, fired in order and then round again: a plain arrow, a
log that arcs down and flattens whoever it lands on, a wisp that circles you lighting the dark,
or a modifier that rewrites every shot on that tool at once. Both are **found first** — in broken
rocks, in felled trees, and at the top tier in the treeline's chests — so the weapon you finish a
match with is one the map handed you a piece at a time. The other way in is the **merchant's
counter**, which puts a rotating handful of them behind a price: gold you earned somewhere else,
spent on the twelve things that happen to be on the counter this minute, never on the one thing
you wanted. Hover the weapon well and its bit column rises out of it to be rebuilt mid-fight.
[Tools and bits](gameplay.md#tools-and-bits), [the counter](gameplay.md#the-merchants-counter).

**Keys 1-4 are your class.** Each class carries four active abilities — the HUNTER's piercing
shot, net, grapple and snow cover; the WARRIOR's shield, rush, stomp and juggernaut — each with a
cooldown, a
cast the body visibly performs, and effects drawn plainly for both sides: the game is readable
first, sneaky second. [Class abilities](gameplay.md#class-abilities-keys-1-4),
[Classes](multiplayer.md#classes).

**The whole arsenal is on the table from the first match.** A **wiki** on the main menu writes
every tool and bit down with its numbers, and all of it is unlocked: what your fiftieth match may
drop is exactly what your first one may drop, so a new player and a veteran play the same game and
a find is a find because of what it *is*, never because of what you have ground out. The same
wiki is where the game explains itself — the beasts, what a level does to them — one page a
subject, so the snow never has to. [The wiki](gameplay.md#the-wiki).

**The draw is the ammunition.** There is no quiver: what a shot is worth — how far, how fast, how
hard — is how long the string was held, and the tool's own cycle is all that sits between one
press and the next. Spamming the button is punished by the shots themselves, short and weak, never
by a counter, so what the meter shows is exactly what you get.
[The draw](gameplay.md#the-draw).

**Momentum is the movement.** Ice is mechanically slippery, dodges chain, and **a roll is a hit** —
the dodge is an attack, which is why a player mid-roll passes through small units instead of
colliding with them. [Momentum movement](gameplay.md#momentum-movement-players-only),
[the roll is a hit](gameplay.md#the-roll-is-a-hit).

**Snow cover goes prone and the snow covers you — and it is the hunter's.** Concealment is a real
state the world reads, not a
visual effect: everything that decides it can see a player goes through one function, and burial
lives inside it. It is a class ability now (the hunter's key 4), not a universal key.
[Prone](gameplay.md#prone-under-the-snow).

**E is the one verb for the world.** The same key harvests a tree, mines a rock, breaks an
enemy building, and strikes a rival's grounded eagle — and the axe and pick it swings are never
selected, they come out on their own for whatever is under the cursor.
[The swing tools](gameplay.md#the-swing-tools-e).

**Gold is the only currency, and gold is also XP.** No wood, no stone — one number earned many
ways, each source with its own yield profile, and it pays itself: gold is never a pickup on the
ground, every source pays the earner on the spot. Every payout levels you as a side effect — a
*sale* at the counter is the one exception, because a price you can both buy and sell at would
otherwise be a level farm. **Fish and berries have a price that moves**, drastically and all day,
and they are the only two things in the game that do: the counter buys them at the same number it
sells them for, so what a bag of fish is worth is a question of *when*.
[Economy](gameplay.md#economy-one-currency), [the counter](gameplay.md#the-merchants-counter),
[Hero levels](multiplayer.md#hero-levels).

**You carry a 10-cell backpack.** The wallet (`p.inv`) is gold and nothing else; everything you
*carry* is `p.bag`. Berries and fish are food, never spent; tools and bits are the build being laid
out. [Inventory and the backpack](gameplay.md#inventory-and-the-backpack).

**Gear is 4 pieces × 3 variants, bought from anywhere.** No trip home for *armour* — the gear
pop-up is a menu, and a piece levels through four materials. The counter is the opposite bargain
on purpose: it sells what changes the way you *play* rather than what you survive, and it makes
you walk to a body to get it. [Gear](gameplay.md#gear).

**Your eagle is your life.** The bird that carried the team in crashes into its corner's trees at
the end of its line and roosts there, armoured in team colour — the crater it blows, the lane its
landing cuts to the open snow and the gate its merchant raises are the team's starting base, an
easier opening for a new player who can help fortify before walking out. Its hp pool is its **nerve**:
hits spook it, it calms back down between scares, it defends its own ground with a wing gust —
and when its nerve breaks it is **driven off**, not killed: every camera pans to watch it fly
away, and its whole side falls with it as it goes. **It is also the way back**: a player who
goes down waits out a timer and is set down again at the roost — no Keep, no permadeath; death
costs the wallet, the bag and the walk. The bird is the **only objective** and the one way a
match ends, which is why both teams always have somewhere worth walking to — and why every bot
on the map knows where both birds are and what is happening at them, and answers a hit on its
own from anywhere. [Eagle drop](rendering.md#eagle-drop-mode-drop),
[Death and respawn](gameplay.md#death-and-respawn), [Bots](multiplayer.md#bots).

**Roguelike cards come out of the treeline's chests.** A sprung chest drops a **rarity-rolled
card**, drafted three-at-a-time from a bag cell without pausing the sim, and a picked card is
baked into the kit for the rest of the match. [Roguelike cards](gameplay.md#roguelike-cards).

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
- **Not a deathmatch.** Kills never win a match and never end one — only the bird does. Death
  still costs everything you carried and the walk back from your roost; that is the stake
  everything else borrows from, and the objective is the only place it is ever permanent.
- **Not a solo survival game.** Every mechanic runs per player off `p.input`, and `player` is only
  the local one — see [multiplayer.md](multiplayer.md).
- **Not a game that explains itself in text.** The UI rule in [CLAUDE.md](../../CLAUDE.md) is a
  design constraint, not a style preference.
- **Not an account.** The player profile is a display name, a few lifetime numbers and a record of
  which kinds you have held, in the browser, and it names itself — a fresh profile rolls a random
  name rather than stopping a new player at a prompt. No passwords, no sign-in, nothing
  to log into. A match reads **nothing** back out of it — everything about a match is decided
  inside that match, and the arsenal is unlocked for everybody alike. See
  [architecture.md](architecture.md#profilejs). If a server ever holds it, it holds the same
  object.
