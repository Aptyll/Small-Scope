'use strict';
// The class abilities: keys 1-4, four unique actives per class, each with a
// cooldown, a cast the body visibly performs, and world entities of its own
// (traps, nets, a falcon, a volley, a shield, a rush, a crater, a fury).
// Everything here runs per slot off p.input.ability, so a bot casts through
// exactly the key a human presses. Loaded after tools.js (it shares the
// world's fx helpers at runtime and nothing at load time - and it must draw
// no load-time rng(), or every seed reshuffles).
// ------------------------------------------------------------ class abilities

// ---- tuning --------------------------------------------------------------
const AB_KEYS = 4;          // keys 1-4
// ability levels: the hero's own growth, never the purse's. The class kit is
// level 1; each level past 1 costs ONE SKILL POINT - the only thing a point
// buys, one per hero level, so the 12 points a capped hero earns max the
// four keys' 12 levels exactly. Each level shaves AB_LV_CD off that
// ability's cooldown - one lever, universally meaningful (more traps out,
// the wall up more often), read back through abCdOf so every
// cooldown-setting site scales alike.
const AB_LV_MAX = 4;
const AB_LV_CD = 0.12;
// hunter
const TRAP_RANGE = 44;      // px from the feet a trap can be set
const TRAP_ARM = 1.0;       // s before a fresh trap bites
const TRAP_LIFE = 25;       // s a set trap waits before rusting away
const TRAP_R = 9;           // px: step this close and it goes
const TRAP_DMG = 8;
const TRAP_ROOT = 1.2;      // s the victim is pinned
const TRAP_MAX = 2;         // per owner; a third replaces the oldest
const NET_SPD = 300;
const NET_RANGE = 130;
const NET_DMG = 4;
const NET_SLOW = 0.4;       // speed multiplier under the net...
const NET_SLOW_T = 2;       // ...for this long
const NET_KICK = 150;       // px/s of recoil the hunter takes backward
const FALCON_SPD = 240;
const FALCON_RANGE = 340;
const MARK_T = 4;           // s a swept rival stays revealed
const VOLLEY_RANGE = 150;   // px from the feet the circle can be called
const VOLLEY_R = 26;        // px radius of the strike
const VOLLEY_T = 0.8;       // s of telegraph before the arrows land
// What actually falls is the caster's own loaded bit (abFireBit). VOLLEY_DMG
// is the FLOOR underneath that - what the ring still does with a dry quiver.
const VOLLEY_DMG = 14;
// Three, against a QUIVER_MAX of 6 and QUIVER_REGEN of 2.4s: half the quiver,
// back in ~7s of the 16s cooldown, so calling a volley costs real ammunition
// without disarming the bow the class is built around. Six would leave the
// hunter dry for 14 of those 16 seconds, and the eight staged shafts below
// are the PICTURE of a rain - most of a volley misses.
const VOLLEY_SHOTS = 3;
const VOLLEY_DROP = 22;     // px above its mark a shaft comes down from...
const VOLLEY_PASS = 6;      // ...and how far past it the shaft carries
// The ring is drawn as a squashed ellipse (perspective - drawVolley below),
// and where the shafts SCATTER has to use the same number, or the rain falls
// somewhere the telegraph never promised. One constant, read by both.
const VOLLEY_SQUASH = 0.72;
// warrior
const SHIELD_T = 2.2;       // s the shield can be held up
const SHIELD_ARC = 0.35;    // cos-margin of the front arc that blocks
const RUSH_SPD = 300;
const RUSH_T = 0.42;        // s of charge (~4 tiles)
const RUSH_DMG = 10;
const RUSH_STUN = 0.6;
const RUSH_WALL_MUL = 1.6;  // driven into a tree/rock/wall: the slam is worse
const STOMP_R = 34;
const STOMP_DMG = 12;
const STOMP_KB = 170;       // px/s radial shove
const STOMP_STUN = 0.25;
const CRATER_R = 30;        // the deep-snow crater the stomp leaves...
const CRATER_T = 4;         // ...and how long it slows rivals crossing it
const CRATER_SLOW = 0.55;
// stalker
const BLIND_RANGE = 130;    // px from the feet the cloud can be thrown
const BLIND_R = 40;         // px radius of blown snow
const BLIND_T = 7;          // s the cloud hangs before it thins out
const BLIND_DRIFT = 9;      // px/s it walks downwind while it does
const VEIL_T = 0.2;         // s of veil a body keeps per step inside it...
const VEIL_CUT = 0.45;      // ...and what that does to every sight range
const TRAIL_T = 5;          // s of leaving no print
const TRAIL_SPD = 1.25;     // ...and the stride while it lasts
const FROST_T = 6;          // s to spend the promised ambush in
const WHITE_T = 4;          // s of storm: a crawl keeps its cover...
const WHITE_SPD = 2.1;      // ...and moves at this multiple of a crawl
// tinker
const SCAT_SPREAD = 0.17;   // rad between the arms of a scattered volley
const CLOCK_T = 5;          // s of overclock...
const CLOCK_FAN = 3;        // ...every shot splitting this many ways...
const CLOCK_DMG = 0.55;     // ...each arm worth this much...
const CLOCK_ROF = 0.55;     // ...and the rhythm cut to this
const CLOCK_MOVE = 0.85;    // she is planted while it runs: volume costs footwork
const CACHE_T = 30;         // s a dropped cache waits to be opened
const CACHE_R = 12;         // px you have to stand within to take it
const MAG_T = 3;            // s of pull...
const MAG_R = 90;           // ...and how far it reaches for loose drops
const DROP_PULL = 28;       // the reach everyone else has (js/sim.js reads both)
// warden
const WALL_RANGE = 120;     // px from the feet the wall can be raised
const WALL_LEN = 3;         // tiles across, laid square to the aim
const WALL_T = 9;           // s before it melts
const BRAZ_RANGE = 90;      // px from the feet the hearth can be set
const BRAZ_R = 46;          // px it warms
const BRAZ_T = 12;          // s it burns
const BRAZ_HEAL = 4.5;      // hp/s to an ally standing in it
const SPIKE_RANGE = 110;    // px from the feet the line can be laid
const SPIKE_LEN = 54;       // px long
const SPIKE_R = 11;         // px either side of it
const SPIKE_T = 8;          // s it lasts
const SPIKE_DMG = 9;        // once per body, not per step
const SPIKE_SLOW = 0.5;
const SPIKE_SLOW_T = 1.2;
const RED_R = 34;           // px radius of the redoubt ring
const RED_T = 6;            // s it stands
const JUG_T = 5;            // s of juggernaut
const JUG_SPD = 0.5;        // extra speed ramped in over the duration
const JUG_MIN_SP = 90;      // px/s of body speed before contact hurts anyone
const JUG_STUN = 0.5;

// ---- the two kits --------------------------------------------------------
// One row per key. `use(p)` is the whole effect, fired when the cast lands -
// what an ability IS lives here, never in an `if` somewhere else. `cast` is
// the seconds the body spends performing it (the pose is abilityPose below).
const CLASS_AB = [
  [ // HUNTER - bow, traps, distance control
    {
      id: 'trap', name: 'SNARE TRAP', cd: 10, cast: 0.32,
      blurb: 'SET AN IRON JAW IN THE SNOW. IT BITES THE FIRST RIVAL ON IT.',
      use: (p) => abSetTrap(p),
    },
    {
      id: 'net', name: 'NET SHOT', cd: 11, cast: 0.18,
      blurb: 'A WEIGHTED NET THAT TANGLES. THE RECOIL KICKS YOU BACKWARD.',
      use: (p) => abNetShot(p),
    },
    {
      id: 'falcon', name: 'FALCON SWEEP', cd: 18, cast: 0.28,
      blurb: 'SEND THE BIRD DOWN A LINE. RIVALS UNDER IT ARE REVEALED.',
      use: (p) => abFalcon(p),
    },
    {
      id: 'volley', name: 'VOLLEY', cd: 16, cast: 0.35,
      blurb: 'CALL A RAIN OF ARROWS ON A CIRCLE. SOME STICK FOR ANYONE.',
      use: (p) => abVolley(p),
    },
  ],
  [ // WARRIOR - close pressure, blocking, momentum
    {
      id: 'shield', name: 'SHIELD WALL', cd: 9, cast: 0.12,
      blurb: 'RAISE THE TOWER SHIELD. ARROWS FROM THE FRONT BREAK ON IT.',
      use: (p) => abShieldUp(p),
      // the strip's active tell: how much of the wall is left, and its colour
      acol: '#f2cc6a', activeF: (p) => (p.shieldT > 0 ? p.shieldT / SHIELD_T : 0),
    },
    {
      id: 'rush', name: 'BULL RUSH', cd: 12, cast: 0.2,
      blurb: 'CHARGE A LINE. THE FIRST RIVAL HIT IS CARRIED AND SLAMMED.',
      use: (p) => abRush(p),
    },
    {
      id: 'stomp', name: 'AVALANCHE STOMP', cd: 14, cast: 0.28,
      blurb: 'LEAP AND SLAM THE SNOW. THE CRATER SLOWS WHOEVER CROSSES IT.',
      use: (p) => abStomp(p),
    },
    {
      id: 'jug', name: 'JUGGERNAUT', cd: 20, cast: 0.3,
      blurb: 'NOTHING STOPS YOU. YOUR BODY BOWLS RIVALS OVER AS YOU RUN.',
      use: (p) => abJuggernaut(p),
      acol: '#e05a4a', activeF: (p) => (p.jugT > 0 ? p.jugT / JUG_T : 0),
    },
  ],
  [ // STALKER - cover, patience, the ambush
    {
      id: 'blind', name: 'SNOWBLIND', cd: 12, cast: 0.24,
      blurb: 'THROW UP A DRIFT OF BLOWN SNOW. NOBODY SEES FAR INSIDE IT.',
      use: (p) => abSnowblind(p),
    },
    {
      id: 'trail', name: 'COLD TRAIL', cd: 14, cast: 0.16,
      blurb: 'MOVE FAST AND LEAVE NO PRINT IN THE SNOW.',
      use: (p) => abColdTrail(p),
      acol: '#9fc4dd', activeF: (p) => (p.trailT > 0 ? p.trailT / TRAIL_T : 0),
    },
    {
      id: 'frost', name: 'KILLING FROST', cd: 14, cast: 0.2,
      blurb: 'YOUR NEXT SHOT LANDS LIKE ONE LOOSED OUT OF COVER.',
      use: (p) => abKillingFrost(p),
      acol: '#bfe6ff', activeF: (p) => (p.frostT > 0 ? p.frostT / FROST_T : 0),
    },
    {
      id: 'white', name: 'WHITEOUT', cd: 22, cast: 0.3,
      blurb: 'THE STORM COMES WITH YOU. CRAWL FAST AND STAY BURIED.',
      use: (p) => abWhiteout(p),
      acol: '#f4f7ff', activeF: (p) => (p.whiteT > 0 ? p.whiteT / WHITE_T : 0),
    },
  ],
  [ // TINKER - the arsenal, and what it will throw
    {
      id: 'scatter', name: 'SCATTER', cd: 11, cast: 0.22,
      blurb: 'THROW EVERY BIT IN THE TOOL AT ONCE, IN ONE SPREAD.',
      use: (p) => abScatter(p),
    },
    {
      id: 'clock', name: 'OVERCLOCK', cd: 20, cast: 0.26,
      blurb: 'EVERY SHOT SPLITS THREE WAYS AND COMES TWICE AS FAST, EACH WEAKER.',
      use: (p) => abOverclock(p),
      acol: '#c8a24a', activeF: (p) => (p.clockT > 0 ? p.clockT / CLOCK_T : 0),
    },
    {
      id: 'cache', name: 'FIELD CACHE', cd: 18, cast: 0.3,
      blurb: 'DROP A CRATE OF SHAFTS. WHOEVER REACHES IT FILLS THEIR QUIVER.',
      use: (p) => abFieldCache(p),
    },
    {
      id: 'magnet', name: 'MAGNET', cd: 16, cast: 0.24,
      blurb: 'EVERY LOOSE FIND NEARBY SLIDES TO YOUR FEET.',
      use: (p) => abMagnet(p),
      acol: '#9fc4dd', activeF: (p) => (p.magT > 0 ? p.magT / MAG_T : 0),
    },
  ],
  [ // WARDEN - geometry and denial
    {
      id: 'wall', name: 'ICE WALL', cd: 16, cast: 0.32,
      blurb: 'RAISE A WALL OF ICE. IT STOPS ARROWS AND FEET ALIKE.',
      use: (p) => abIceWall(p),
    },
    {
      id: 'brazier', name: 'BRAZIER', cd: 20, cast: 0.3,
      blurb: 'SET A HEARTH. YOUR SIDE MENDS IN ITS WARMTH AND THAWS OUT.',
      use: (p) => abBrazier(p),
    },
    {
      id: 'spikes', name: 'SPIKE LINE', cd: 12, cast: 0.26,
      blurb: 'DRIVE A LINE OF STAKES. WHATEVER CROSSES IT PAYS AND SLOWS.',
      use: (p) => abSpikeLine(p),
    },
    {
      id: 'redoubt', name: 'REDOUBT', cd: 24, cast: 0.3,
      blurb: 'THROW UP A RING OF COVER. NO SHOT CROSSES IT - YOURS INCLUDED.',
      use: (p) => abRedoubt(p),
      acol: '#9fb6d8', activeF: (p) => (p.redT > 0 ? p.redT / RED_T : 0),
    },
  ],
];

// the world the abilities put things into
const traps = [];    // {x, y, owner, team, t}
const craters = [];  // {x, y, team, t}
const falcons = [];  // {x, y, nx, ny, d, owner, team, seen:[]}
const nets = [];     // {x, y, nx, ny, d, owner, team, spin}
const volleys = [];  // {x, y, owner, team, t}
const blinds = [];   // {x, y, owner, team, t} - blown snow, drifting downwind
const caches = [];   // {x, y, owner, team, t} - a crate of shafts, first come
const walls = [];    // {o, t} - the structure the ice wall made, and its clock
const braziers = []; // {x, y, owner, team, t} - a hearth warming one side
const spikes = [];   // {x, y, nx, ny, team, t, hit:[]} - a staked line
const redoubts = []; // {p, t} - a ring no shot crosses. The arrow loop reads it
const volleyFx = []; // falling shafts, visual only: {x, y, delay, t}

// ---- levelling -----------------------------------------------------------
// can-buy or not (a point in hand, room on the key), the one entry point a
// buyer reaches through runCmd (HUD plate click and bots alike), and the
// effective number the sim reads instead of the table's base
function abLvCanBuy(p, i) { return p.skillPts > 0 && p.abLv[i] < AB_LV_MAX; }
function abCdOf(p, i) { return CLASS_AB[p.cls][i].cd * (1 - AB_LV_CD * (p.abLv[i] - 1)); }
function buyAbilityLv(p, i) {
  if (!abLvCanBuy(p, i)) { if (p === player) SFX.deny(); return; }
  p.skillPts--;
  p.abLv[i]++;
  addFloater(p.x, p.y - 18, CLASS_AB[p.cls][i].name + ' ' + p.abLv[i], GEAR_MATS[p.abLv[i] - 1]);
  burst(p.x, p.y - 8, GEAR_MATS[p.abLv[i] - 1], 8, 40, 0.45);
  if (p === player) SFX.levelUp();
  else if (nearPlayer(p.x, p.y)) SFX.pickup();
}

// ---- casting -------------------------------------------------------------
// The press. Refused flat while the body is otherwise occupied; the shield's
// own key is the one toggle - pressing it again lowers the shield early.
function tryAbility(p, i) {
  if (i < 0 || i >= AB_KEYS || p.dead || p.stunT > 0 || p.fallT > 0 ||
    p.dodgeT > 0 || p.rushT > 0 || p.castT > 0 || p.eatT > 0 || inAir(p)) return; // a meal occupies the hands the same way a cast does
  const ab = CLASS_AB[p.cls][i];
  if (!ab) return;
  if (ab.id === 'shield' && p.shieldT > 0) { abShieldDown(p, true); return; }
  if (p.abCd[i] > 0) { if (p === player) SFX.deny(); return; }
  if (ab.id === 'rush' && p.rootT > 0) { if (p === player) SFX.deny(); return; } // pinned: nothing that moves you
  // a cast breaks cover the way the shot does - and is paid for the same way
  // by a class that keeps it (spendCover, js/actions.js)
  if (!spendCover(p)) risePlayer(p);
  if (p.charging) { p.charging = false; p.chargeT = 0; }
  p.fireArmed = false;
  p.castAb = i;
  p.castT = ab.cast;
  const dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else p.dir = dy > 0 ? 'down' : 'up';
  if (nearPlayer(p.x, p.y)) SFX.swing();
}

// per-slot tick: cooldowns, the cast landing, and every timed state an
// ability leaves on a body. Called from updatePlayer once the slot is alive.
function updateAbilities(p, dt) {
  for (let i = 0; i < AB_KEYS; i++) if (p.abCd[i] > 0) p.abCd[i] = Math.max(0, p.abCd[i] - dt);
  if (p.hopT > 0) p.hopT = Math.max(0, p.hopT - dt);
  if (p.trailT > 0) p.trailT = Math.max(0, p.trailT - dt);
  if (p.frostT > 0) p.frostT = Math.max(0, p.frostT - dt);
  if (p.whiteT > 0) p.whiteT = Math.max(0, p.whiteT - dt);
  if (p.clockT > 0) p.clockT = Math.max(0, p.clockT - dt);
  if (p.magT > 0) p.magT = Math.max(0, p.magT - dt);
  // root / slow / net / mark / fire: the shared clock every kind of unit runs
  // (updateUnitStatus, js/actions.js) - an animal and a worker bot age the
  // identical states off the identical timers
  updateUnitStatus(p, dt);
  if (p.dead) return; // a burn can finish a slot mid-tick
  if (p.rootT > 0) p.sliding = false;
  // juggernaut: the body is the weapon while it moves. One bowl-over per
  // rival per activation, scaled by the speed actually carried into them.
  if (p.jugT > 0) {
    p.jugT = Math.max(0, p.jugT - dt);
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 40) {
      p.jugFxT -= dt;
      if (p.jugFxT <= 0) {
        p.jugFxT = 0.05;
        particles.push({
          x: p.x - p.vx / sp * 6 + rand(-2, 2), y: p.y - 2 + rand(-3, 3),
          vx: rand(-6, 6), vy: rand(-14, -6),
          life: rand(0.3, 0.5), maxLife: 0.4, color: Math.random() < 0.5 ? '#e05a4a' : '#f2937f',
          size: 1, grav: -6, alpha: 0.7,
        });
      }
    }
    if (sp > JUG_MIN_SP) {
      const nx = p.vx / sp, ny = p.vy / sp;
      // anything alive in the way, not only the rival slots: a body running
      // this hard bowls a deer or a worker over exactly as it does a player
      for (const q of unitsHit(p, p.x, p.y, PLAYER_R * 2 + 2)) {
        if (p.jugHit.includes(q)) continue;
        p.jugHit.push(q);
        const dmg = Math.max(3, Math.round(4 + sp * 0.04));
        hurtUnit(q, dmg, nx, ny, p, { kb: 140 });
        if (!q.dead) { stunUnit(q, JUG_STUN); q.kbx += nx * 140; q.kby += ny * 140; }
        burst(q.x, unitMidY(q), '#e05a4a', 8, 55, 0.5, true);
        if (p === player || q === player) state.shake = Math.max(state.shake, 3);
      }
    }
  }
  // the shield tracks the aim while it is up, and lowers itself on the timer
  if (p.shieldT > 0) {
    p.shieldT -= dt;
    p.shieldA = Math.atan2(p.input.aimY - (p.y - BOW_Y), p.input.aimX - p.x);
    const adx = Math.cos(p.shieldA), ady = Math.sin(p.shieldA);
    if (Math.abs(adx) > Math.abs(ady)) p.dir = adx > 0 ? 'right' : 'left';
    else p.dir = ady > 0 ? 'down' : 'up';
    if (p.charging) { p.charging = false; p.chargeT = 0; }
    p.fireArmed = false;
    if (p.shieldT <= 0) abShieldDown(p, false);
  }
  // the cast: a short performance, then the effect fires at the aim the
  // caster is holding NOW - a bot tracking its target casts like a hand does
  if (p.castT > 0) {
    p.castT -= dt;
    const ab = CLASS_AB[p.cls][p.castAb];
    if (ab && ab.id === 'trap' && Math.random() < dt * 30) {
      burst(p.x + rand(-4, 4), p.y + 5, '#eef4fb', 1, 18, 0.3, true); // kneeling, digging the set in
    }
    if (p.castT <= 0) {
      const i = p.castAb;
      p.castAb = -1;
      p.castT = 0;
      p.abCd[i] = abCdOf(p, i);
      CLASS_AB[p.cls][i].use(p);
    }
  }
}

// every movement cap an ability is allowed to touch, in one multiplier: the
// root pins, a cast and a raised shield slow, a net drags, the juggernaut
// ramps. updatePlayer applies it to the walk cap and the ice cap alike.
function abilityMoveMul(p) {
  if (p.rootT > 0) return 0;
  let m = 1;
  if (p.castT > 0) m *= 0.5;
  if (p.shieldT > 0) m *= 0.4;
  if (p.slowT > 0) m *= p.slowMul;
  if (p.jugT > 0) m *= 1 + JUG_SPD * (1 - p.jugT / JUG_T);
  if (p.trailT > 0) m *= TRAIL_SPD;
  if (p.clockT > 0) m *= CLOCK_MOVE;
  // WHITEOUT multiplies the CRAWL, which is what updatePlayer is capping
  // while prone - a storm you can only use lying down is the whole trade
  if (p.whiteT > 0 && p.prone) m *= WHITE_SPD;
  return m;
}

// The same idea over the RHYTHM instead of the movement caps: every ability
// allowed to touch the seconds between shots, folded once. `toolRof` spends it
// (js/tools.js) so no ability ever edits a tool's own numbers.
function abilityRofMul(p) {
  return p && p.clockT > 0 ? CLOCK_ROF : 1;
}

// ---- the one crossing into the arsenal -----------------------------------
// An ability shaped like a SHOT fires the caster's own loaded bit instead of
// carrying a damage constant of its own. A hunter who found PYRE gets a
// burning volley; one holding an ICE LANCE gets a very different one - and
// neither costs a line of code here, because the multiplication lives in the
// tables (BITS, the envelope) rather than in a branch, the way OBJECTS and
// STRUCTS already work.
//
// This is deliberately the ONLY reach from this file into the tool system.
// Everything else here stays kind-blind and constant-driven; anything that
// wants the arsenal comes through this function rather than around it, or
// abilities.js quietly grows a second copy of fireTool.
//
// Fires `o.n` (default 1) shots of whatever nextBit hands back, from (x, y)
// along `ang`, each spending one arrow. Every shot still goes through the
// caster's full envelope, so SPLITTER still fans it and FLAME still lights it.
//
// Returns HOW MANY actually left. 0 means the quiver was dry or the tool held
// nothing it can throw, and the CALLER decides what happens then: an ability
// that silently does nothing is dead weight, so every caller needs a floor.
//
// It does NOT risePlayer - the cast already broke cover - and does NOT touch
// p.nockT, because the ability's cooldown is its rhythm, not the bow's.
//
// It also ignores m.twin on purpose. DUPLICATE doubles what one PRESS spends,
// and an ability is not a press: the caller named its own shot count, and
// letting DUPLICATE double an eight-shot volley into sixteen is a
// multiplication nobody asked for. m.fan is different and DOES apply - it
// splits each shot rather than adding shots, which is what SPLITTER means.
function abFireBit(p, x, y, ang, o) {
  o = o || {};
  const cell = heldTool(p);
  if (!cell) return 0;
  const m = toolMods(cell, p);
  if (o.mod) o.mod(m); // the ability's own say over the envelope, folded last
  const n = o.n || 1;
  // an even fan when the caller asked for one, so a burst is deterministic:
  // the sim must not spend rng() on where a shot went
  const spread = o.spread || 0;
  let fired = 0;
  for (let i = 0; i < n; i++) {
    if (p.quiver <= 0) break;
    const nb = nextBit(cell, p);
    if (!nb) break;
    p.quiver = Math.max(0, p.quiver - 1);
    emitBit(p, BITS[nb.id], nb.id, m, false, 0, {
      x, y, pow: o.pow === undefined ? 1 : o.pow, reach: o.reach,
      ang: ang + (n > 1 && spread ? (i - (n - 1) / 2) * spread : 0),
    });
    fired++;
  }
  return fired;
}

// ---- hunter: the four effects --------------------------------------------
function abSetTrap(p) {
  // at the aim, clamped to arm's reach, snapped to the tile - a trap is a
  // TILE fact, plainly visible to both sides: the play is around it, not
  // under it. Somewhere a trap cannot sit (a wall, open water) sets at the
  // feet instead.
  let dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const r = Math.min(TRAP_RANGE, d);
  let tx = Math.floor((p.x + dx / d * r) / TILE), ty = Math.floor((p.y + dy / d * r) / TILE);
  if (!inWorld(tx, ty) || isSolidTile(tx, ty) || ground[idx(tx, ty)] === 2) {
    tx = Math.floor(p.x / TILE); ty = Math.floor((p.y + 4) / TILE);
    if (!inWorld(tx, ty) || isSolidTile(tx, ty) || ground[idx(tx, ty)] === 2) { if (p === player) SFX.deny(); return; }
  }
  // the cap: a third trap springs the oldest still out
  const mine = traps.filter((t) => t.owner === p.id);
  if (mine.length >= TRAP_MAX) {
    const old = mine[0];
    burst(old.x, old.y, '#8b93a8', 5, 30, 0.3, true);
    traps.splice(traps.indexOf(old), 1);
  }
  traps.push({ x: tx * TILE + 8, y: ty * TILE + 8, owner: p.id, team: p.team, t: 0 });
  if (nearPlayer(p.x, p.y)) SFX.place();
}

function abNetShot(p) {
  const dx = p.input.aimX - p.x, dy = p.input.aimY - (p.y - BOW_Y);
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  nets.push({ x: p.x, y: p.y - BOW_Y, nx, ny, d: 0, owner: p.id, team: p.team, spin: 0 });
  // the recoil: a real backward hop, animated on the body (p.hopT)
  p.vx -= nx * NET_KICK;
  p.vy -= ny * NET_KICK;
  p.hopT = 0.3;
  burst(p.x, p.y + 4, '#eef4fb', 4, 30, 0.3, true);
  if (nearPlayer(p.x, p.y)) SFX.arrow();
}

function abFalcon(p) {
  const dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  falcons.push({ x: p.x, y: p.y - 10, nx: dx / d, ny: dy / d, d: 0, owner: p.id, team: p.team, seen: [], t: 0 });
  burst(p.x, p.y - 12, '#d9ad72', 5, 35, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.rise();
}

function abVolley(p) {
  let dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const r = Math.min(VOLLEY_RANGE, d);
  const x = p.x + dx / d * r, y = p.y + dy / d * r;
  volleys.push({ x, y, owner: p.id, team: p.team, t: VOLLEY_T });
  // the rain, staged now so the fall is already stacked when the ring closes
  for (let i = 0; i < 8; i++) {
    volleyFx.push({
      x: x + rand(-VOLLEY_R + 4, VOLLEY_R - 4), y: y + rand(-VOLLEY_R + 6, VOLLEY_R - 6),
      delay: VOLLEY_T + i * 0.03, t: 0, team: p.team,
    });
  }
  if (nearPlayer(p.x, p.y)) SFX.arrow();
}

// ---- stalker: the four effects -------------------------------------------
// None of the four does damage. All four move the same one question - who can
// see whom - which is the axis nothing else on the roster touches.
function abSnowblind(p) {
  let dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const r = Math.min(BLIND_RANGE, d);
  blinds.push({ x: p.x + dx / d * r, y: p.y + dy / d * r, owner: p.id, team: p.team, t: 0 });
  burst(p.x, p.y, '#eef4fb', 8, 45, 0.45, true);
  if (nearPlayer(p.x, p.y)) SFX.place();
}
function abColdTrail(p) {
  p.trailT = TRAIL_T;
  burst(p.x, p.y + 3, '#cfe0f2', 6, 35, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.dodge();
}
function abKillingFrost(p) {
  p.frostT = FROST_T;
  burst(p.x, p.y - 6, '#bfe6ff', 8, 40, 0.5, true);
  if (nearPlayer(p.x, p.y)) SFX.rise();
}
// the crack of the promise being spent, on the body that spent it (fireTool)
function frostFx(p) {
  burst(p.x, p.y - 6, '#bfe6ff', 10, 55, 0.45, true);
  if (p === player) state.shake = Math.max(state.shake, 2);
}
function abWhiteout(p) {
  p.whiteT = WHITE_T;
  // the storm arrives already holding: a whiteout cast standing up is wasted,
  // so it also finishes the burial it found in progress
  if (p.prone) p.hide = 1;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    particles.push({
      x: p.x + Math.cos(a) * 7, y: p.y + 2 + Math.sin(a) * 5,
      vx: Math.cos(a) * 40, vy: Math.sin(a) * 26 - 10,
      life: 0.55, maxLife: 0.5, color: i % 2 ? '#f4f7ff' : '#cfe0f2', size: 1, grav: 20,
    });
  }
  if (nearPlayer(p.x, p.y)) SFX.hidden ? SFX.hidden() : SFX.place();
}

// ---- tinker: the four effects --------------------------------------------
// Two of the four reach into the arsenal rather than the world, which is the
// only class on the roster that does - SCATTER through abFireBit, OVERCLOCK
// through the class mod's `p`.
function abScatter(p) {
  const cell = heldTool(p);
  let n = 0;
  if (cell) for (let i = 0; i < cell.bits.length; i++) if (bitFires(cell, i, p)) n++;
  const ang = Math.atan2(p.input.aimY - (p.y - BOW_Y), p.input.aimX - p.x);
  const fired = n ? abFireBit(p, p.x, p.y - BOW_Y, ang, { n, spread: SCAT_SPREAD, pow: 1 }) : 0;
  // The floor. Everything a tool holds thrown at once is nothing at all when
  // the tool holds nothing throwable or the quiver is dry - so rather than
  // burn the cooldown on an empty press, hand most of it back. An ability that
  // does nothing must not also cost you the next twenty seconds.
  if (!fired) {
    const i = CLASS_AB[p.cls].findIndex((a) => a.id === 'scatter');
    if (i >= 0) p.abCd[i] = Math.min(p.abCd[i], 1.5);
    if (p === player) SFX.deny();
    return;
  }
  burst(p.x, p.y - BOW_Y, '#c8a24a', 6 + fired * 2, 45, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.arrow();
}
function abOverclock(p) {
  p.clockT = CLOCK_T;
  burst(p.x, p.y - 4, '#c8a24a', 10, 50, 0.5, true);
  burst(p.x, p.y - 6, '#f2cc6a', 6, 38, 0.45, true);
  if (nearPlayer(p.x, p.y)) SFX.levelUp ? SFX.levelUp() : SFX.place();
}
function abFieldCache(p) {
  caches.push({ x: p.x, y: p.y + 4, owner: p.id, team: p.team, t: 0 });
  burst(p.x, p.y + 4, '#a8794a', 6, 35, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.place();
}
function abMagnet(p) {
  p.magT = MAG_T;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    particles.push({
      x: p.x + Math.cos(a) * MAG_R * 0.5, y: p.y + Math.sin(a) * MAG_R * 0.3,
      vx: -Math.cos(a) * 70, vy: -Math.sin(a) * 44,
      life: 0.5, maxLife: 0.45, color: i % 2 ? '#9fc4dd' : '#c8a24a', size: 1, grav: 0,
    });
  }
  if (nearPlayer(p.x, p.y)) SFX.pickup();
}
// how far a slot reaches for a loose find - everyone's 28 px, hers while the
// magnet runs. js/sim.js's drop loop is the only reader.
function dropReach(p) { return p && p.magT > 0 ? MAG_R : DROP_PULL; }

// ---- warden: the four effects --------------------------------------------
// The only class whose abilities change the MAP. That is handled entirely by
// the tables: `icewall` is a STRUCTS entry, isSolidTile answers "any STRUCTS
// entry is solid" off that table, and so arrows stop on it, bodies collide
// with it and navTo reroutes around it without one line anywhere naming it.
// Nothing here is a special case, and if a later change needs one, something
// has gone wrong upstream rather than here.
function abIceWall(p) {
  let dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const r = Math.min(WALL_RANGE, d);
  const cx = p.x + dx / d * r, cy = p.y + dy / d * r;
  // laid SQUARE to the aim, so it cuts the line you are looking down
  const px = -dy / d, py = dx / d;
  const ctx0 = Math.floor(cx / TILE), cty0 = Math.floor(cy / TILE);
  let built = 0;
  for (let k = -(WALL_LEN >> 1); k <= (WALL_LEN >> 1); k++) {
    const tx = ctx0 + Math.round(px * k), ty = cty0 + Math.round(py * k);
    if (!inWorld(tx, ty) || objAt(tx, ty) || ground[idx(tx, ty)] === 2) continue;
    // never raise one THROUGH a body - a wall that entombs whoever is
    // standing there is a wall that deleted them
    const wx = tx * TILE + 8, wy = ty * TILE + 8;
    if (unitsNear(null, wx, wy, 11).length) continue;
    walls.push({ o: createStruct(tx, ty, 'icewall', 0, p, false), t: 0 });
    burst(wx, wy, '#bfe6ff', 6, 40, 0.4, true);
    built++;
  }
  // The floor: nowhere to put it - open water, occupied tiles, bodies in the
  // way. Hand most of the cooldown back rather than eat sixteen seconds.
  if (!built) {
    const i = CLASS_AB[p.cls].findIndex((a) => a.id === 'wall');
    if (i >= 0) p.abCd[i] = Math.min(p.abCd[i], 2);
    if (p === player) SFX.deny();
    return;
  }
  if (p === player) state.shake = Math.max(state.shake, 3);
  if (nearPlayer(cx, cy)) SFX.place();
}
function abBrazier(p) {
  let dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const r = Math.min(BRAZ_RANGE, d);
  braziers.push({ x: p.x + dx / d * r, y: p.y + dy / d * r, owner: p.id, team: p.team, t: 0 });
  burst(p.x, p.y - 4, '#ff9440', 8, 45, 0.45);
  if (nearPlayer(p.x, p.y)) SFX.place();
}
function abSpikeLine(p) {
  let dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const r = Math.min(SPIKE_RANGE, d);
  // square to the aim, like the wall: both of hers cut the line you look down
  spikes.push({
    x: p.x + dx / d * r, y: p.y + dy / d * r,
    nx: -dy / d, ny: dx / d, team: p.team, owner: p.id, t: 0, hit: [],
  });
  burst(p.x + dx / d * r, p.y + dy / d * r, '#8a6d50', 8, 40, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.place();
}
function abRedoubt(p) {
  p.redT = RED_T;
  redoubts.push({ p, t: RED_T });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    particles.push({
      x: p.x + Math.cos(a) * RED_R * 0.6, y: p.y + 2 + Math.sin(a) * RED_R * 0.4,
      vx: Math.cos(a) * 30, vy: Math.sin(a) * 18 - 20,
      life: 0.6, maxLife: 0.55, color: i % 2 ? '#cfe0f2' : '#9fb6d8', size: 1, grav: 40,
    });
  }
  if (p === player) state.shake = Math.max(state.shake, 4);
  if (nearPlayer(p.x, p.y)) SFX.place();
}
// Does this shot die on somebody's redoubt? The ring is symmetric on purpose:
// it eats what comes in AND what tries to leave, which is the whole cost of
// standing inside one. Read once per arrow per step by the arrow loop
// (js/sim.js) - `redoubts` is empty almost always, so this costs nothing.
function redoubtStops(a, x0, y0, x1, y1) {
  for (const rd of redoubts) {
    const q = rd.p;
    if (!q || q.dead || !q.active) continue;
    const d0 = Math.hypot(x0 - q.x, y0 - q.y), d1 = Math.hypot(x1 - q.x, y1 - q.y);
    if ((d0 > RED_R) !== (d1 > RED_R)) return q;
  }
  return null;
}

// ---- warrior: the four effects -------------------------------------------
function abShieldUp(p) {
  p.shieldT = SHIELD_T;
  p.shieldA = Math.atan2(p.input.aimY - (p.y - BOW_Y), p.input.aimX - p.x);
  burst(p.x, p.y - 4, '#9aa3ad', 6, 35, 0.35, true);
  if (nearPlayer(p.x, p.y)) SFX.place();
}
// down early (the key again) or on the timer: the cooldown starts HERE, so
// holding the wall the full stretch and dropping it at once cost the same
function abShieldDown(p, early) {
  if (p.shieldT <= 0 && !early) return;
  p.shieldT = 0;
  const i = CLASS_AB[p.cls].findIndex((a) => a.id === 'shield');
  if (i >= 0) p.abCd[i] = abCdOf(p, i);
  if (nearPlayer(p.x, p.y)) SFX.pickup();
}
// an incoming shot dies on a raised shield when it flies INTO the front arc
function abShieldBlocks(t, nx, ny) {
  if (t.shieldT <= 0) return false;
  return nx * Math.cos(t.shieldA) + ny * Math.sin(t.shieldA) < -SHIELD_ARC;
}

function abRush(p) {
  const dx = p.input.aimX - p.x, dy = p.input.aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  p.rushNX = dx / d; p.rushNY = dy / d;
  p.rushT = RUSH_T;
  p.rushVictim = null;
  p.sliding = false;
  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else p.dir = dy > 0 ? 'down' : 'up';
  burst(p.x, p.y + 4, '#dfe8f4', 8, 45, 0.4, true);
  if (nearPlayer(p.x, p.y)) SFX.dodge();
}
// one step of the charge, called from updatePlayer's movement branch with the
// wall verdict for this frame. The first rival in the path is grabbed and
// carried; the end of the line (or a wall) is where the slam happens.
function rushStep(p, mv, dt) {
  // plowed snow off the front
  p.rushFxT = (p.rushFxT || 0) - dt;
  if (p.rushFxT <= 0) {
    p.rushFxT = 0.04;
    burst(p.x + p.rushNX * 5, p.y + 4, '#eef4fb', 2, 30, 0.35, true);
  }
  // p.rushVictim is the BODY, whatever kind it is: the charge picks up a deer
  // or a worker bot the same way it picks up a rival, and slams it just as hard
  const v = p.rushVictim;
  if (!v) {
    for (const q of unitsHit(p, p.x, p.y, ROLL_HIT_R + PLAYER_R)) {
      p.rushVictim = q;
      if (q instanceof Player) risePlayer(q);
      stunUnit(q, 0.3); // manhandled: nothing they hold survives the grab
      burst(q.x, unitMidY(q), '#eef4fb', 6, 40, 0.4, true);
      if (nearPlayer(q.x, q.y)) SFX.hit();
      break;
    }
  } else if (unitAlive(v)) {
    // carried on the shoulder: held one body ahead, stun refreshed so their
    // own step stays limp until the slam
    stunUnit(v, 0.2);
    const wx = p.x + p.rushNX * 9, wy = p.y + p.rushNY * 9;
    moveEntity(v, wx - v.x, wy - v.y, unitRadius(v));
  } else {
    p.rushVictim = null; // it died on the way: the charge runs on empty
  }
  const wall = mv.blockedX || mv.blockedY;
  if (wall || p.rushT <= 0) rushEnd(p, wall);
}
function rushEnd(p, wall) {
  p.rushT = 0;
  const v = p.rushVictim;
  p.rushVictim = null;
  p.vx = p.rushNX * 60; p.vy = p.rushNY * 60;
  if (v && unitAlive(v)) {
    const mul = wall ? RUSH_WALL_MUL : 1;
    hurtUnit(v, Math.round(RUSH_DMG * mul), p.rushNX, p.rushNY, p, { kb: 110 * mul });
    if (!v.dead) stunUnit(v, RUSH_STUN * mul);
    burst(v.x, v.y - 5, '#e04a54', 8, 50, 0.5);
    burst(v.x, v.y - 4, '#eef4fb', 10, 55, 0.5, true);
    if (p === player || v === player) state.shake = Math.max(state.shake, wall ? 6 : 4);
    if (nearPlayer(v.x, v.y)) SFX.hit();
  } else if (wall) {
    p.vx = -p.rushNX * 40; p.vy = -p.rushNY * 40; // the thud, without a body to spend it on
    burst(p.x + p.rushNX * 6, p.y - 2, '#eef4fb', 8, 45, 0.45, true);
    if (p === player) state.shake = Math.max(state.shake, 3);
    if (nearPlayer(p.x, p.y)) SFX.hit();
  }
}

function abStomp(p) {
  const px = p.x, py = p.y;
  // one list, every living thing in the ring: slots, wildlife and worker bots
  // take the same damage, the same shove and the same beat of stun
  for (const q of unitsHit(p, px, py, STOMP_R)) {
    const d = Math.hypot(q.x - px, q.y - py) || 1;
    const nx = (q.x - px) / d, ny = (q.y - py) / d;
    hurtUnit(q, STOMP_DMG, nx, ny, p, { kb: STOMP_KB });
    if (!q.dead) { stunUnit(q, STOMP_STUN); q.kbx += nx * STOMP_KB; q.kby += ny * STOMP_KB; }
  }
  if (PRACTICE) abHitDummies(px, py, STOMP_R, STOMP_DMG);
  craters.push({ x: px, y: py + 3, team: p.team, t: 0 });
  // the shockwave: one ring of snow thrown outward
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    particles.push({
      x: px + Math.cos(a) * 6, y: py + 2 + Math.sin(a) * 4,
      vx: Math.cos(a) * 90, vy: Math.sin(a) * 55 - 15,
      life: 0.4, maxLife: 0.35, color: i % 3 ? '#eef4fb' : '#cfd8e8', size: i % 2 ? 2 : 1, grav: 60,
    });
  }
  if (p === player) state.shake = Math.max(state.shake, 5);
  if (nearPlayer(px, py)) SFX.break_();
}

function abJuggernaut(p) {
  p.jugT = JUG_T;
  p.jugHit.length = 0;
  p.jugFxT = 0;
  burst(p.x, p.y - 6, '#e05a4a', 10, 50, 0.5, true);
  burst(p.x, p.y - 8, '#f2937f', 6, 40, 0.45, true);
  if (p === player) state.shake = Math.max(state.shake, 3);
  if (nearPlayer(p.x, p.y)) SFX.hit();
}

// the practice dummy takes area hits like everything else: any dummy tile
// whose base is inside the circle rings the meter
function abHitDummies(x, y, r, dmg) {
  const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (!inWorld(tx, ty)) continue;
    const o = objects[idx(tx, ty)];
    if (o && o.type === 'dummy' && Math.hypot(tx * TILE + 8 - x, ty * TILE + 8 - y) <= r + 8) {
      hitDummy(o, dmg, tx * TILE + 8, ty * TILE - 4);
    }
  }
}

// ---- the world tick ------------------------------------------------------
// Everything the abilities left lying in the world, stepped once per sim
// step from updatePlay: traps wait and bite, craters drag, the falcon flies
// its line, nets fly theirs, and a called volley lands when its ring closes.

// Each of them is asked about through `sideOf` (js/actions.js), which hands
// unitsNear/unitsHit the side a thing in the world is on rather than a living
// caster. Everything those two return is fair game: slots, wildlife AND worker
// bots, none of them a special case.
// This is the other half: who to credit a kill to - the caster, if they are
// still standing. A trap that outlives its hunter kills for nobody.
function abCredit(w) { const o = players[w.owner]; return o && !o.dead ? o : null; }

function updateAbilityWorld(dt) {
  for (let i = traps.length - 1; i >= 0; i--) {
    const t = traps[i];
    t.t += dt;
    if (t.t > TRAP_LIFE) { burst(t.x, t.y, '#8b93a8', 4, 25, 0.3, true); traps.splice(i, 1); continue; }
    if (t.t < TRAP_ARM) continue;
    // iron does not ask what stood on it: the first body over the pan is
    // bitten, rival, rabbit or worker bot alike
    for (const q of unitsHit(sideOf(t), t.x, t.y - 4, TRAP_R)) {
      // the bite: pinned on the spot, and the jaws show on the body (rootT)
      hurtUnit(q, TRAP_DMG, 0, -0.2, abCredit(t), { kb: 0 });
      if (!q.dead) rootUnit(q, TRAP_ROOT);
      burst(t.x, t.y - 2, '#f2cc6a', 10, 55, 0.5, true);
      burst(t.x, t.y - 4, '#8b93a8', 8, 45, 0.45, true);
      if (nearPlayer(t.x, t.y)) SFX.hit();
      traps.splice(i, 1);
      break;
    }
  }
  // Blown snow. It hides EVERYONE standing in it, the caster and her rivals
  // and a deer alike - it is weather, not a team effect - and it walks
  // downwind off the same field the snow and the pines read (windSway), so it
  // is never a static circle sitting where it was thrown.
  for (let i = blinds.length - 1; i >= 0; i--) {
    const z = blinds[i];
    z.t += dt;
    if (z.t > BLIND_T) { blinds.splice(i, 1); continue; }
    const w = windSway(Math.floor(z.x / TILE), Math.floor(z.y / TILE));
    z.x += w * BLIND_DRIFT * dt;
    for (const q of unitsNear(null, z.x, z.y, BLIND_R)) veilUnit(q, VEIL_T);
  }
  // A dropped cache is neutral ground, exactly like a loose find: whoever is
  // standing on it claims it, and the CONTEST decides between two who are -
  // never the owner by right. A tinker who drops one in the wrong place has
  // resupplied the other team.
  for (let i = caches.length - 1; i >= 0; i--) {
    const c = caches[i];
    c.t += dt;
    if (c.t > CACHE_T) { burst(c.x, c.y, '#a8794a', 5, 28, 0.35, true); caches.splice(i, 1); continue; }
    let taken = false;
    for (const q of players) {
      if (!q.active || q.dead || inAir(q) || q.quiver >= QUIVER_MAX) continue;
      if (Math.hypot(q.x - c.x, q.y - c.y) > CACHE_R) continue;
      taken = true;
      contest('cache:' + i, q, () => {
        gainArrow(q, QUIVER_MAX);
        addFloater(c.x, c.y - 10, 'QUIVER', '#f2cc6a');
        burst(c.x, c.y - 2, '#f2cc6a', 10, 50, 0.5, true);
        if (nearPlayer(c.x, c.y)) SFX.pickup();
        const at = caches.indexOf(c);
        if (at >= 0) caches.splice(at, 1);
      });
    }
    if (taken) continue;
  }
  // The ice wall melting. Two ways it can already be gone - somebody shot it
  // down, or a Keep fell on it - and both leave `structures` without it, so
  // the list is checked rather than trusted before anything is removed twice.
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    w.t += dt;
    if (structures.indexOf(w.o) < 0) { walls.splice(i, 1); continue; } // already down
    if (w.t < WALL_T) continue;
    destroyStructure(w.o, false, null); // no refund: it was never paid for
    walls.splice(i, 1);
  }
  // The hearth. Its side only - a fire you built is yours, which is the one
  // asymmetry among the five zone abilities and the reason it is not weather
  // the way SNOWBLIND is.
  for (let i = braziers.length - 1; i >= 0; i--) {
    const b = braziers[i];
    b.t += dt;
    if (b.t > BRAZ_T) { burst(b.x, b.y, '#8a6d50', 5, 30, 0.35, true); braziers.splice(i, 1); continue; }
    for (const q of players) {
      if (!q.active || q.dead || inAir(q) || q.team !== b.team) continue;
      if (Math.hypot(q.x - b.x, q.y - b.y) > BRAZ_R) continue;
      if (q.hp < q.maxHp) q.hp = Math.min(q.maxHp, q.hp + BRAZ_HEAL * dt);
      q.slowT = 0; q.slowMul = 1;   // thawed out: the crater and the net let go
      if (q.netT > 0) q.netT = 0;
    }
    for (const b2 of robots) {
      if (b2.dead || b2.team !== b.team) continue;
      if (Math.hypot(b2.x - b.x, b2.y - b.y) > BRAZ_R) continue;
      if (b2.hp < (b2.maxHp || b2.hp)) b2.hp = Math.min(b2.maxHp || b2.hp, b2.hp + BRAZ_HEAL * dt);
    }
  }
  // The staked line. Damage is once per body - it is a thing you crossed, not
  // a thing you are standing in - but the slow refreshes the whole time.
  for (let i = spikes.length - 1; i >= 0; i--) {
    const s = spikes[i];
    s.t += dt;
    if (s.t > SPIKE_T) { spikes.splice(i, 1); continue; }
    for (let k = -1; k <= 1; k++) {
      const sx = s.x + s.nx * k * (SPIKE_LEN / 2), sy = s.y + s.ny * k * (SPIKE_LEN / 2);
      for (const q of unitsNear(s, sx, sy, SPIKE_R)) {
        slowUnit(q, SPIKE_SLOW_T, SPIKE_SLOW);
        if (s.hit.includes(q)) continue;
        s.hit.push(q);
        hurtUnit(q, SPIKE_DMG, 0, -0.2, abCredit(s), { kb: 20 });
        burst(q.x, unitMidY(q), '#8a6d50', 7, 40, 0.4, true);
        if (nearPlayer(q.x, q.y)) SFX.hit();
      }
    }
  }
  for (let i = redoubts.length - 1; i >= 0; i--) {
    const rd = redoubts[i];
    rd.t -= dt;
    if (rd.t <= 0 || !rd.p || rd.p.dead) { if (rd.p) rd.p.redT = 0; redoubts.splice(i, 1); }
  }
  for (let i = craters.length - 1; i >= 0; i--) {
    const z = craters[i];
    z.t += dt;
    if (z.t > CRATER_T) { craters.splice(i, 1); continue; }
    // deep snow is deep snow for everything that has to cross it, refreshed
    // every step spent inside
    for (const q of unitsNear(sideOf(z), z.x, z.y - 4, CRATER_R)) slowUnit(q, 0.15, CRATER_SLOW);
  }
  for (let i = falcons.length - 1; i >= 0; i--) {
    const f = falcons[i];
    f.t += dt;
    f.x += f.nx * FALCON_SPD * dt;
    f.y += f.ny * FALCON_SPD * dt;
    f.d += FALCON_SPD * dt;
    // the bird's eye is not a blow, so nothing dodges it: everything alive
    // under the line is marked, a deer and a worker bot included
    for (const q of unitsNear(sideOf(f), f.x, f.y, 18)) {
      markUnit(q, MARK_T);
      if (!f.seen.includes(q)) {
        f.seen.push(q);
        burst(q.x, unitMidY(q) - 4, '#f2cc6a', 8, 45, 0.5, true);
        if (nearPlayer(q.x, q.y)) SFX.ambush();
      }
    }
    if (f.d >= FALCON_RANGE) { burst(f.x, f.y, '#d9ad72', 4, 30, 0.35, true); falcons.splice(i, 1); }
  }
  for (let i = nets.length - 1; i >= 0; i--) {
    const n = nets[i];
    n.x += n.nx * NET_SPD * dt;
    n.y += n.ny * NET_SPD * dt;
    n.d += NET_SPD * dt;
    n.spin += dt * 14;
    let dead = n.d >= NET_RANGE;
    if (!dead && isSolidTile(Math.floor(n.x / TILE), Math.floor(n.y / TILE))) {
      burst(n.x, n.y, '#cfd8e8', 4, 30, 0.3, true);
      dead = true;
    }
    // the first body in the way tangles in it, whatever kind of body it is
    if (!dead) for (const q of unitsHit(sideOf(n), n.x, n.y + 6, 8)) {
      if (q instanceof Player && abShieldBlocks(q, n.nx, n.ny)) {
        burst(n.x, n.y, '#cfd8e8', 6, 40, 0.35, true); dead = true; break;
      }
      hurtUnit(q, NET_DMG, n.nx, n.ny, abCredit(n), { kb: 40 });
      if (!q.dead) netUnit(q, NET_SLOW_T, NET_SLOW); // the drape the slow is read off
      burst(q.x, unitMidY(q), '#cfd8e8', 8, 45, 0.4, true);
      dead = true;
      break;
    }
    if (dead) nets.splice(i, 1);
  }
  for (let i = volleys.length - 1; i >= 0; i--) {
    const v = volleys[i];
    v.t -= dt;
    if (v.t > 0) continue;
    const src = players[v.owner];
    const by = src && !src.dead ? src : null;
    // What falls is the caster's OWN loaded bit. A hunter who found PYRE
    // drops a burning volley, one carrying an ICE LANCE drops a very
    // different one, and nothing here says so - the multiplication lives in
    // BITS and the envelope, never in a branch (abFireBit, the crossing).
    //
    // Each shaft is aimed at a body the ring promised to hit, spawned
    // VOLLEY_DROP above it and flying straight DOWN over a bounded reach, so
    // it passes through that body and dies inside the circle. Shafts left
    // over after the bodies are scattered inside the ring, where they can
    // still catch someone walking in late.
    let fired = 0;
    if (by && !inAir(by)) {
      const marks = [];
      for (const q of unitsHit(sideOf(v), v.x, v.y, VOLLEY_R)) {
        if (marks.length >= VOLLEY_SHOTS) break;
        marks.push([q.x, unitMidY(q)]);
      }
      while (marks.length < VOLLEY_SHOTS) { // rand() is the seeded rng: still deterministic
        const a = rand(0, Math.PI * 2), r = Math.sqrt(rng()) * VOLLEY_R;
        marks.push([v.x + Math.cos(a) * r, v.y + Math.sin(a) * r * VOLLEY_SQUASH]);
      }
      for (const mk of marks) {
        fired += abFireBit(by, mk[0], mk[1] - VOLLEY_DROP, Math.PI / 2,
          { reach: VOLLEY_DROP + VOLLEY_PASS });
      }
    }
    // The floor. A dry quiver, a tool with nothing throwable in it, or a
    // caster who has gone down since the call - the ability is never dead
    // weight, so the ring still does the flat strike it did before the
    // arsenal ever reached it. The dummies belong here too: when real shafts
    // fall, the arrow loop already rings them (js/sim.js).
    if (!fired) {
      for (const q of unitsHit(sideOf(v), v.x, v.y, VOLLEY_R + 4)) {
        const d = Math.hypot(q.x - v.x, q.y - v.y) || 1;
        hurtUnit(q, VOLLEY_DMG, (q.x - v.x) / d * 0.3, 0.4, by, { kb: 30 });
      }
      if (PRACTICE) abHitDummies(v.x, v.y, VOLLEY_R, VOLLEY_DMG);
    }
    burst(v.x, v.y, '#eef4fb', 12, 55, 0.5, true);
    if (nearPlayer(v.x, v.y)) SFX.hit();
    volleys.splice(i, 1);
  }
  for (let i = volleyFx.length - 1; i >= 0; i--) {
    const f = volleyFx[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    f.t += dt;
    if (f.t > 0.16) {
      burst(f.x, f.y, '#eef4fb', 3, 30, 0.3, true);
      volleyFx.splice(i, 1);
    }
  }
}

// ---- drawing: the world layer --------------------------------------------
// Flat things on the snow, drawn before the drops and the entities:
// a trap is as plainly visible as a shaft is, to BOTH sides - the game is
// readable first, sneaky second.
function drawAbilityGround(ex, ey, now) {
  for (const z of craters) {
    const px = Math.round(z.x - ex), py = Math.round(z.y - ey);
    if (px < -40 || py < -40 || px > WV_W + 40 || py > WV_H + 40) continue;
    const a = Math.max(0, 1 - z.t / CRATER_T);
    // dithered pressed-snow bowl: pixels thin out toward the rim
    for (let dy = -CRATER_R; dy <= CRATER_R; dy += 2) {
      for (let dx = -CRATER_R; dx <= CRATER_R; dx += 2) {
        const d = Math.hypot(dx, dy * 1.6);
        if (d > CRATER_R) continue;
        const h = hash2(z.x + dx, z.y + dy);
        if (h > 0.28 + 0.55 * (1 - d / CRATER_R)) continue;
        ctx.fillStyle = h < 0.18 ? 'rgba(118,144,186,' + (a * 0.5).toFixed(2) + ')'
          : 'rgba(160,182,214,' + (a * 0.4).toFixed(2) + ')';
        ctx.fillRect(px + dx, py + Math.round(dy * 0.62), 1, 1);
      }
    }
    // the rim: shoved-up snow, lit pale
    for (let i = 0; i < 14; i++) {
      const an = (i / 14) * Math.PI * 2 + 0.2;
      ctx.fillStyle = 'rgba(238,244,251,' + (a * 0.6).toFixed(2) + ')';
      ctx.fillRect(px + Math.round(Math.cos(an) * CRATER_R * 0.9), py + Math.round(Math.sin(an) * CRATER_R * 0.55), 2, 1);
    }
  }
  // the staked line: driven stakes and the churned ground between them
  for (const s of spikes) {
    const px = Math.round(s.x - ex), py = Math.round(s.y - ey);
    if (px < -70 || py < -70 || px > WV_W + 70 || py > WV_H + 70) continue;
    const a = Math.min(1, (SPIKE_T - s.t) / 1.5);
    ctx.globalAlpha = a;
    for (let k = -6; k <= 6; k++) {
      const t = k / 6;
      const sx = px + Math.round(s.nx * t * (SPIKE_LEN / 2));
      const sy = py + Math.round(s.ny * t * (SPIKE_LEN / 2));
      const h = 4 + ((k + 6) % 3);
      ctx.fillStyle = '#2b2118';
      ctx.fillRect(sx, sy - h, 2, h + 1);
      ctx.fillStyle = '#8a6d50';
      ctx.fillRect(sx, sy - h, 1, h);
      ctx.fillStyle = '#c8b08a';
      ctx.fillRect(sx, sy - h, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  // the hearth: a ring of thawed ground, and the fire in the middle of it
  for (const b of braziers) {
    const px = Math.round(b.x - ex), py = Math.round(b.y - ey);
    if (px < -70 || py < -70 || px > WV_W + 70 || py > WV_H + 70) continue;
    const a = Math.min(1, b.t / 0.4) * Math.min(1, (BRAZ_T - b.t) / 1.5);
    for (let k = 0; k < 42; k++) {
      const h1 = hash2(b.x + k * 5, k * 11), h2 = hash2(k * 17, b.y + k * 7);
      const an = h1 * Math.PI * 2, rr = Math.sqrt(h2) * BRAZ_R;
      ctx.globalAlpha = a * 0.3 * (1 - rr / BRAZ_R);
      ctx.fillStyle = h1 < 0.5 ? '#c8956a' : '#a8794a';
      ctx.fillRect(px + Math.round(Math.cos(an) * rr), py + Math.round(Math.sin(an) * rr * 0.6), 1, 1);
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(px - 4, py - 2, 8, 5);
    ctx.fillStyle = '#6e4a28';
    ctx.fillRect(px - 3, py - 1, 6, 3);
    const ph = b.t * 8;
    for (let k = 0; k < 3; k++) {
      const lift = 3 + Math.round(2.4 * (1 + Math.sin(ph + k * 2.1)));
      ctx.fillStyle = '#e0533a';
      ctx.fillRect(px - 2 + k * 2, py - 2 - lift, 1, lift);
      ctx.fillStyle = '#ffd95c';
      ctx.fillRect(px - 2 + k * 2, py - 2 - lift, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  // a cache is as plainly visible as a trap is, and to both sides: it is a
  // crate of shafts sitting in the open, not a secret
  for (const c of caches) {
    const px = Math.round(c.x - ex), py = Math.round(c.y - ey);
    if (px < -16 || py < -16 || px > WV_W + 16 || py > WV_H + 16) continue;
    const fade = c.t > CACHE_T - 3 ? Math.max(0.25, (CACHE_T - c.t) / 3) : 1;
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(px - 6, py - 5, 12, 9);
    ctx.fillStyle = '#a8794a';
    ctx.fillRect(px - 5, py - 4, 10, 7);
    ctx.fillStyle = '#6e4a28';
    ctx.fillRect(px - 5, py - 1, 10, 1);
    // the shafts standing in it, and the team ribbon on the lid
    ctx.fillStyle = '#e8dcb4';
    for (let k = 0; k < 4; k++) ctx.fillRect(px - 4 + k * 3, py - 7, 1, 3);
    ctx.fillStyle = TEAMS[c.team].mark;
    ctx.fillRect(px - 5, py - 4, 10, 1);
    ctx.globalAlpha = 1;
  }
  for (const t of traps) {
    const px = Math.round(t.x - ex), py = Math.round(t.y - ey);
    if (px < -16 || py < -16 || px > WV_W + 16 || py > WV_H + 16) continue;
    const armed = t.t >= TRAP_ARM;
    // opening: the jaws spread over the arm time, so "not yet live" is visible
    const open = Math.min(1, t.t / TRAP_ARM);
    const spread = 2 + Math.round(open * 2);
    // base plate + pin chain
    ctx.fillStyle = '#3c4356';
    ctx.fillRect(px - 4, py - 1, 8, 3);
    ctx.fillStyle = '#242a3a';
    ctx.fillRect(px - 4, py + 1, 8, 1);
    ctx.fillRect(px + 4, py, 2, 1);
    // the two toothed jaws
    ctx.fillStyle = armed && Math.sin(now * 6 + t.x) > 0.6 ? '#c8d2e4' : '#8b93a8';
    for (let k = -3; k <= 3; k += 2) {
      ctx.fillRect(px + k, py - spread, 1, 1);
      ctx.fillRect(px + k, py + spread - 1, 1, 1);
    }
    ctx.fillRect(px - 4, py - spread + 1, 1, spread * 2 - 2);
    ctx.fillRect(px + 3, py - spread + 1, 1, spread * 2 - 2);
  }
  for (const v of volleys) {
    const px = Math.round(v.x - ex), py = Math.round(v.y - ey);
    if (px < -40 || py < -40 || px > WV_W + 40 || py > WV_H + 40) continue;
    // the warning: a dashed danger ring, and an inner ring closing on the
    // centre as the rain gets near - the time left IS the picture
    const closing = Math.max(0, v.t / VOLLEY_T);
    for (let i = 0; i < 26; i++) {
      if ((i + ((now * 10) | 0)) % 2) continue;
      const a = (i / 26) * Math.PI * 2;
      ctx.fillStyle = 'rgba(224,99,122,0.85)';
      ctx.fillRect(px + Math.round(Math.cos(a) * VOLLEY_R), py + Math.round(Math.sin(a) * VOLLEY_R * VOLLEY_SQUASH), 1, 1);
    }
    const ir = VOLLEY_R * closing;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.fillStyle = 'rgba(255,217,92,0.8)';
      ctx.fillRect(px + Math.round(Math.cos(a) * ir), py + Math.round(Math.sin(a) * ir * 0.72), 1, 1);
    }
  }
}

// airborne ability bodies, drawn with the arrows: the net spinning open, the
// falcon and its shadow racing the snow, the volley's shafts coming down
function drawAbilityAir(ex, ey, now) {
  // The redoubt ring, drawn over the bodies because it is what a shot meets.
  // Both sides see the same ring: it eats their arrows and hers alike, so
  // there is nothing here to keep from them.
  for (const rd of redoubts) {
    const q = rd.p;
    if (!q || q.dead || !q.active) continue;
    const px = Math.round(q.x - ex), py = Math.round(q.y - ey);
    const a = Math.min(1, rd.t / 0.8);
    ctx.globalAlpha = a * 0.85;
    for (let k = 0; k < 30; k++) {
      const an = (k / 30) * Math.PI * 2;
      const wob = 1 + Math.sin(now * 3 + k) * 0.5;
      const sx = px + Math.round(Math.cos(an) * (RED_R + wob));
      const sy = py + Math.round(Math.sin(an) * (RED_R + wob) * 0.62);
      ctx.fillStyle = k % 3 ? '#cfe0f2' : '#9fb6d8';
      ctx.fillRect(sx, sy, 1, 2);
    }
    ctx.globalAlpha = 1;
  }
  // Blown snow: drawn OVER the bodies, because that is what makes it hard to
  // see through them. It fades in over its first beat and thins out over its
  // last, so "the cloud is going" is visible before it goes.
  for (const z of blinds) {
    const px = Math.round(z.x - ex), py = Math.round(z.y - ey);
    if (px < -BLIND_R * 2 || py < -BLIND_R * 2 || px > WV_W + BLIND_R * 2 || py > WV_H + BLIND_R * 2) continue;
    const a = Math.min(1, z.t / 0.35) * Math.min(1, (BLIND_T - z.t) / 1.4);
    for (let k = 0; k < 44; k++) {
      // each mote keeps its own place in the drift and slides across it
      const h1 = hash2(z.x + k * 7, k * 13), h2 = hash2(k * 29, z.y + k * 3);
      const an = h1 * Math.PI * 2 + now * (0.5 + h2 * 0.7);
      const rr = (0.25 + h2 * 0.75) * BLIND_R;
      const sx = px + Math.round(Math.cos(an) * rr);
      const sy = py + Math.round(Math.sin(an) * rr * 0.62);
      ctx.globalAlpha = a * (0.25 + h1 * 0.45);
      ctx.fillStyle = h2 < 0.5 ? '#f4f7ff' : '#cfe0f2';
      ctx.fillRect(sx, sy, 1 + (h1 > 0.8 ? 1 : 0), 1);
    }
    ctx.globalAlpha = 1;
  }
  for (const n of nets) {
    const px = Math.round(n.x - ex), py = Math.round(n.y - ey);
    if (px < -12 || py < -12 || px > WV_W + 12 || py > WV_H + 12) continue;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(n.spin);
    ctx.fillStyle = '#0d1226';
    for (let k = -3; k <= 3; k += 3) { ctx.fillRect(k - 1, -4, 1, 8); ctx.fillRect(-4, k - 1, 8, 1); }
    ctx.fillStyle = '#cfd8e8';
    for (let k = -3; k <= 3; k += 3) { ctx.fillRect(k, -4, 1, 8); ctx.fillRect(-4, k, 8, 1); }
    ctx.fillStyle = '#8b93a8'; // the weights on the corners
    ctx.fillRect(-4, -4, 2, 2); ctx.fillRect(3, -4, 2, 2);
    ctx.fillRect(-4, 3, 2, 2); ctx.fillRect(3, 3, 2, 2);
    ctx.restore();
  }
  for (const f of falcons) {
    const px = Math.round(f.x - ex), py = Math.round(f.y - ey);
    if (px < -16 || py < -16 || px > WV_W + 16 || py > WV_H + 16) continue;
    // the shadow on the snow says where the sweep IS; the bird rides above it
    ctx.fillStyle = 'rgba(60,72,100,0.4)';
    ctx.fillRect(px - 3, py + 10, 6, 2);
    const flap = Math.sin(f.t * 18) > 0;
    ctx.fillStyle = '#0d1226';
    ctx.fillRect(px - 4, py - 1, 9, 3);
    ctx.fillStyle = '#6b5a48';
    ctx.fillRect(px - 3, py, 7, 1);
    ctx.fillStyle = '#d9ad72';
    ctx.fillRect(px - 1, py, 3, 1);
    ctx.fillStyle = '#6b5a48'; // wings beat above and below the body line
    if (flap) { ctx.fillRect(px - 4, py - 2, 3, 1); ctx.fillRect(px + 2, py - 2, 3, 1); }
    else { ctx.fillRect(px - 4, py + 1, 3, 1); ctx.fillRect(px + 2, py + 1, 3, 1); }
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(px + 4, py, 1, 1); // the head
  }
  // the rain wears the shared arrow body, falling tip-first (the tail
  // stretches up ARROW_LEN px, which is why the top cull bound is deep)
  for (const f of volleyFx) {
    if (f.delay > 0) continue;
    const drop = Math.min(1, f.t / 0.14);
    const px = Math.round(f.x - ex), py = Math.round(f.y - ey - 34 * (1 - drop));
    if (px < -12 || py < -70 || px > WV_W + 12 || py > WV_H + 12) continue;
    const tm = TEAMS[f.team || 0];
    ARROW_PX.length = 0;
    arrowBodyPx(ARROW_PX, f.x - ex, f.y - ey - 34 * (1 - drop), 0, 1,
      0, ARROW_LEN, tm.mark, tm.coatD, ARROW_INK.G, 0);
    paintArrowPx(ARROW_PX);
  }
}

// ---- drawing: on the body ------------------------------------------------
// The pose a cast (or the net shot's recoil hop, or the rush's lean) puts on
// the sprite itself: drawPlayer applies dx/dy/rot to the body draw, so every
// ability visibly happens TO the model, not just around it.
function abilityPose(p) {
  if (p.rushT > 0) {
    return { dx: 0, dy: -1, rot: 0.26 * (p.rushNX >= 0 ? 1 : -1) };
  }
  if (p.hopT > 0) {
    return { dx: 0, dy: -Math.round(4 * Math.sin(Math.PI * (1 - p.hopT / 0.3))), rot: 0 };
  }
  if (p.castT <= 0 || p.castAb < 0) return null;
  const ab = CLASS_AB[p.cls][p.castAb];
  const prog = 1 - p.castT / ab.cast;
  switch (ab.id) {
    case 'trap': return { dx: 0, dy: 2, rot: 0 };                                   // kneel to set it
    case 'net': return { dx: p.dir === 'left' ? 1 : p.dir === 'right' ? -1 : 0, dy: 0, rot: 0 }; // braced back
    case 'falcon': return { dx: 0, dy: -1, rot: 0 };                                // arm up
    case 'volley': return { dx: 0, dy: -1, rot: p.dir === 'left' ? -0.12 : 0.12 };  // loosed skyward
    case 'shield': return { dx: 0, dy: 1, rot: 0 };                                 // planted
    case 'rush': return { dx: 0, dy: 0, rot: 0.14 * (p.dir === 'left' ? -1 : 1) };  // head down
    case 'stomp': return { dx: 0, dy: -Math.round(6 * Math.sin(Math.PI * prog)), rot: 0 }; // the leap
    case 'jug': return { dx: 0, dy: prog < 0.5 ? 1 : -1, rot: 0 };                  // the chest-beat
    case 'blind': return { dx: p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0, dy: 0, rot: 0 }; // the underarm throw
    case 'trail': return { dx: 0, dy: 1, rot: 0 };                                  // crouched to run
    case 'frost': return { dx: 0, dy: -1, rot: 0 };                                 // drawn up, holding it
    case 'white': return { dx: 0, dy: Math.round(2 * Math.sin(Math.PI * prog)), rot: 0 }; // pulled under
    case 'scatter': return { dx: 0, dy: -1, rot: p.dir === 'left' ? -0.16 : 0.16 };  // the whole armful thrown
    case 'clock': return { dx: 0, dy: prog < 0.5 ? 1 : -1, rot: 0 };                 // winding it up
    case 'cache': return { dx: 0, dy: 2, rot: 0 };                                   // set down at the feet
    case 'magnet': return { dx: 0, dy: -1, rot: 0 };                                 // arm out, palm open
    case 'wall': return { dx: 0, dy: -Math.round(3 * Math.sin(Math.PI * prog)), rot: 0 }; // hauled up
    case 'brazier': return { dx: 0, dy: 2, rot: 0 };                                 // set down and lit
    case 'spikes': return { dx: 0, dy: 2, rot: 0 };                                  // driven in
    case 'redoubt': return { dx: 0, dy: 1, rot: 0 };                                 // braced, arms wide
  }
  return null;
}

// Everything a STATUS leaves on a body, drawn over whatever sprite is
// wearing it: the net drape, the sprung jaws at rooted feet, the flames, and
// the falcon's mark. Takes the sprite's own box, so a rabbit, a worker bot
// and a player slot wear the same four tells at their own size - a state you
// cannot see is a rule you cannot play around, and that is as true of a deer
// as of a rival. Called by drawAbilityOnPlayer below and by drawAnimal /
// drawBird / drawRobot (js/draw-world.js).
function drawUnitStates(e, px, py, w, h, now) {
  if (e.netT > 0) {
    ctx.globalAlpha = Math.min(1, e.netT / 0.4);
    ctx.fillStyle = '#cfd8e8';
    // a 3px mesh inside the sprite's own box, however big that box is
    for (let x = 3; x < w - 2; x += 3) ctx.fillRect(px + x, py + 3, 1, h - 5);
    for (let y = 4; y < h - 2; y += 3) ctx.fillRect(px + 3, py + y, w - 6, 1);
    ctx.fillStyle = '#8b93a8';
    ctx.fillRect(px + 3, py + h - 3, w - 6, 1); // the sag at the hem
    ctx.globalAlpha = 1;
  }
  if (e.rootT > 0) {
    // the sprung jaws, closed on the feet
    ctx.fillStyle = '#3c4356';
    ctx.fillRect(px + 4, py + h - 2, w - 8, 2);
    ctx.fillStyle = '#c8d2e4';
    for (let k = 0; k * 2 + 5 < w - 4; k++) ctx.fillRect(px + 5 + k * 2, py + h - 3, 1, 1);
  }
  if (e.burnT > 0) {
    // Alight: tongues licking UP off the crown, and the snow under the feet
    // lit by them - never a wash over the body, because a burning rival still
    // has to read as the rival it is. Phased off the body's own burn clock, so
    // two burning things are never in lockstep and no global clock is involved.
    const ph = e.burnT * 9;
    const n = Math.max(2, Math.min(4, w >> 2));
    for (let k = 0; k < n; k++) {
      const fx = px + 1 + Math.round((w - 3) * ((k + 0.5) / n));
      const lift = 2 + Math.round(2.2 * (1 + Math.sin(ph + k * 2.1)));
      ctx.fillStyle = '#e0533a';
      ctx.fillRect(fx, py - lift, 2, lift + 1);
      ctx.fillStyle = '#ff9440';
      ctx.fillRect(fx, py - lift + 1, 1, lift);
      ctx.fillStyle = '#ffd95c';
      ctx.fillRect(fx, py - lift, 1, 1);
    }
    ctx.globalAlpha = 0.45 + 0.2 * Math.sin(ph * 1.7);
    ctx.fillStyle = '#ff9440';
    ctx.fillRect(px + 2, py + h - 1, w - 4, 1);
    ctx.globalAlpha = 1;
  }
  if (e.veilT > 0) {
    // veiled: snow blowing ACROSS the body, so a rival standing in a
    // SNOWBLIND still reads as a rival - the cloud is what is hard to see
    // through, and the body inside it is never simply erased
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#f4f7ff';
    for (let k = 0; k < 3; k++) {
      const yy = py + 3 + ((k * 5 + Math.floor(now * 26)) % Math.max(1, h - 5));
      ctx.fillRect(px + 1, yy, w - 2, 1);
    }
    ctx.globalAlpha = 1;
  }
  if (e.markT > 0) {
    // the falcon's mark: gold chevrons falling toward the head, for everyone
    const ph = (now * 2.2) % 1;
    ctx.globalAlpha = e.markT < 0.6 ? e.markT / 0.6 : 1;
    const mx = px + (w >> 1) - 3;
    for (let k = 0; k < 2; k++) {
      const y = py - 8 - 5 * k + Math.round(ph * 4);
      ctx.fillStyle = '#0f1632';
      ctx.fillRect(mx, y + 1, 6, 2);
      ctx.fillStyle = '#f2cc6a';
      ctx.fillRect(mx, y, 2, 2); ctx.fillRect(mx + 4, y, 2, 2); ctx.fillRect(mx + 2, y + 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
}

// The player's own layer: the two states only a slot can be in - a raised
// shield and the juggernaut's fury - over the four every unit shares.
function drawAbilityOnPlayer(p, px, py, now) {
  if (p.shieldT > 0) {
    const a = p.shieldA;
    ctx.save();
    ctx.translate(px + 8 + Math.round(Math.cos(a) * 7), py + 8 + Math.round(Math.sin(a) * 5));
    ctx.rotate(a);
    ctx.fillStyle = '#242a3a';
    ctx.fillRect(-1, -7, 4, 14);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(-1, -6, 3, 12);
    ctx.fillStyle = '#c8d2e4';
    ctx.fillRect(-1, -6, 1, 12);
    ctx.fillStyle = TEAMS[p.team].mark; // the trim carries the side
    ctx.fillRect(0, -2, 1, 4);
    ctx.restore();
  }
  if (p.jugT > 0) {
    // fury: a red rim pulsing off the sprite's own silhouette
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(now * 10);
    ctx.fillStyle = '#e05a4a';
    ctx.fillRect(px + 3, py + 1, 10, 1);
    ctx.fillRect(px + 2, py + 4, 1, 8);
    ctx.fillRect(px + 13, py + 4, 1, 8);
    ctx.globalAlpha = 1;
  }
  // KILLING FROST held: three cold motes over the crown. The tell IS the
  // point - a promised ambush that nobody can see coming is a shot from
  // nowhere, and the rule is that everything an ability does to a body is
  // drawn on that body for both sides.
  if (p.frostT > 0) {
    ctx.fillStyle = '#bfe6ff';
    for (let k = 0; k < 3; k++) {
      const lift = 2 + Math.round(1.6 * (1 + Math.sin(now * 5 + k * 2.1)));
      ctx.fillRect(px + 4 + k * 4, py - lift, 1, 1);
    }
  }
  // OVERCLOCKED: brass sparks coming off the harness. The other team needs to
  // know why the volume tripled before the third arm lands.
  if (p.clockT > 0) {
    ctx.fillStyle = Math.sin(now * 22) > 0 ? '#f2cc6a' : '#c8a24a';
    ctx.fillRect(px + 2, py + 5, 1, 1);
    ctx.fillRect(px + 13, py + 7, 1, 1);
    ctx.fillRect(px + 4, py + 9, 1, 1);
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now * 12);
    ctx.fillStyle = '#c8a24a';
    ctx.fillRect(px + 3, py + 6, 10, 1);
    ctx.globalAlpha = 1;
  }
  // MAGNET: the pull drawn as rings closing on her, so anyone watching a drop
  // slide across the snow can see what is doing it
  if (p.magT > 0) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#9fc4dd';
    const r = 4 + ((now * 26) % 10);
    for (let k = 0; k < 10; k++) {
      const a = k * (Math.PI / 5);
      ctx.fillRect(px + 8 + Math.round(Math.cos(a) * r), py + 9 + Math.round(Math.sin(a) * r * 0.6), 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  // WHITEOUT: the storm around her. She is faint under it - concealOf sees to
  // that - but the swirl is not, so the other team is told WHERE the storm is
  // even when the body inside it will not resolve.
  if (p.whiteT > 0) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#f4f7ff';
    for (let k = 0; k < 6; k++) {
      const a = now * 3.4 + k * (Math.PI / 3);
      ctx.fillRect(px + 8 + Math.round(Math.cos(a) * 9), py + 9 + Math.round(Math.sin(a) * 5), 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  drawUnitStates(p, px, py, 16, 16, now);
}

// ---- the strip icons -----------------------------------------------------
// The eight ability icons: detailed 32x32 char grids in the sprite system's
// grammar (sprites.md - new sprites bake beside the code that draws them),
// AB32[cls][key] in CLASS_AB's own order, baked lazily onto their own
// canvases. Drawn by the strip's ability wells and the ability tooltip
// (drawClassAbCell / tipClassAb, js/ui.js). Each icon repeats the ability's
// in-world look - the trap's jaws, the net's corner weights, the volley's
// danger ring - so the well and the snow speak the same picture.
const AB32_PAL = {
  o: '#141a2c', k: '#0f1632',
  W: '#f4f7ff', b: '#cfe0f2', B: '#9fb6d8',
  C: '#c8d2e4', s: '#8b93a8', S: '#5f6f96', D: '#3c4356',
  t: '#e8dcb4', d: '#a89263', w: '#a8794a', u: '#6e4a28',
  g: '#f2cc6a', G: '#b98a2e',
  r: '#e05a4a', R: '#a03428', p: '#f2937f',
  H: '#d9ad72', h: '#8a6d50', n: '#5c4a38',
  E: '#cfd8e8', e: '#8b93a8',
};
const AB32 = [
  [ // HUNTER
    [ // SNARE TRAP: the iron jaw head-on - two toothed arcs open around the
      // gold trigger pan, the base bar and its rivets below
      '................................',
      '................................',
      '.....oooooo..........oooooo.....',
      '....oCCCCCo..........oCCCCCo....',
      '...oCCssoo............oossCCo...',
      '...oCsSo................oSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSCCCo..........oCCCSsCo...',
      '...oCsSCCo............oCCSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSCCCo..........oCCCSsCo...',
      '...oCsSCCo............oCCSsCo...',
      '...oCsSo.....oooooo.....oSsCo...',
      '...oCsSo....ogggggGo....oSsCo...',
      '...oCsSCCCo.oggggGGo.oCCCSsCo...',
      '...oCsSCCo..ogggGGGo..oCCSsCo...',
      '...oCsSo.....oooooo.....oSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSCCCo..........oCCCSsCo...',
      '...oCsSCCo............oCCSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsSo................oSsCo...',
      '...oCsso................ossCo...',
      '....oCsso..............ossCo....',
      '.....ooSso............osSoo.....',
      '......oooooooooooooooooooo......',
      '......oDDkDDDDkDDDDkDDDDDo......',
      '......oSSSSSSSSSSSSSSSSSSo......',
      '.......oooooooooooooooooo.......',
      '................................',
      '................................',
    ],
    [ // NET SHOT: the weighted net mid-flight - the rope weave bright on the
      // throw lines, and the four steel corner weights the air sprite wears
      '................................',
      '................................',
      '................................',
      '.....ooo.................ooo....',
      '....osCso...............osCso...',
      '....osCsoEWEEEWEEEWEEEWEosCso...',
      '....osSso...............osSso...',
      '.....ooo..e...e...e...e..ooo....',
      '......e...e...e...e...e...e.....',
      '......WeeeWeeeWeeeWeeeWeeeW.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......WeeeWeeeWeeeWeeeWeeeW.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......WeeeWeeeWeeeWeeeWeeeW.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......e...e...e...e...e...e.....',
      '......WeeeWeeeWeeeWeeeWeeeW.....',
      '......e...e...e...e...e...e.....',
      '.....ooo..e...e...e...e..ooo....',
      '....osCso.e...e...e...e.osCso...',
      '....osCsoEWEEEWEEEWEEEWEosCso...',
      '....osSso...............osSso...',
      '.....ooo.................ooo....',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // FALCON SWEEP: the bird in its stoop, head-first down the line, the
      // gold mark chevron already falling where it swept
      '................................',
      '................................',
      '................................',
      '...bb...........................',
      '....bb..........................',
      '.....oo.........................',
      '.....onoo....oo.................',
      '.....onnoo...onno...............',
      '......onnnoo..onnho.............',
      '.......onnnnoo.onnhho...........',
      '........onnnnnooonnhhho.........',
      '.........onnnnnnnnhhHhho........',
      '..........onnnnhhhhHHhho........',
      '...........onnhhhhHHHHho........',
      '............onhhhHHHHHHoo.......',
      '.............onhhHHHHHHHo.......',
      '..............onhHHHHHHHHo......',
      '...............onhHHHHWWHo......',
      '................onnHHWWWWno.....',
      '.................onnHWWnnnno....',
      '..................onnnnngnno....',
      '...................onnnnnnnoo...',
      '....gg....gg........onnnnnoGGo..',
      '.....gg..gg..........onnnnoGo...',
      '......gggg............oonnoo....',
      '........................oo......',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // VOLLEY: three shafts raining onto the dashed danger ring, the gold
      // inner ring already closing
      '................................',
      '......orro..........orro........',
      '......orto..........orto........',
      '......otro..........otro........',
      '.......oto...orro....oto........',
      '.......odo...orto....odo........',
      '.......oto...otro....oto........',
      '.......odo....oto....odo........',
      '.......oto....odo....oto........',
      '.......odo....oto....odo........',
      '.......oto....odo....oto........',
      '......oWWo....oto....oWWo.......',
      '......oWWo...oWWo....oWWo.......',
      '.......oo....oWWo.....oo........',
      '..............oo................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '............rr....rr............',
      '........rr..........rr..........',
      '......r....gggggggg....r........',
      '.....r....g........g....r.......',
      '....r....g..........g....r......',
      '....r....g..........g....r......',
      '.....r....g........g....r.......',
      '......r....gggggggg....r........',
      '........rr..........rr..........',
      '............rr....rr............',
      '................................',
      '................................',
    ],
  ],
  [ // WARRIOR
    [ // SHIELD WALL: the tower shield face-on - bright left edge, gold band
      // and boss, riveted corners
      '................................',
      '................................',
      '................................',
      '.........oooooooooooooo.........',
      '.........oCssssggssssSo.........',
      '.........oCksssggssskSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssogggGossSo.........',
      '.........oCssogWgGossSo.........',
      '.........oCssoggGGossSo.........',
      '.........oCssoooooossSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCssssggssssSo.........',
      '.........oCksssggssskSo.........',
      '.........oCssssggssssSo.........',
      '..........oCsssggsssSo..........',
      '...........oCssggssSo...........',
      '.............oCggSo.............',
      '...............oo...............',
      '................................',
      '................................',
    ],
    [ // BULL RUSH: the warrior mid-charge - head tucked, the big pauldron
      // leading, gauntlet up, legs driving, speed lines and plowed snow
      '................................',
      '................................',
      '................................',
      '................................',
      '.....................oooooo.....',
      '....................oCssssso....',
      '...................oCsssssso....',
      '...................oCskkkkso....',
      '...................oCsssssso....',
      '..............oooooossssoo......',
      '.............oCCCCCCssssso......',
      '..bbb........oCCCCssssssso......',
      '..bbb.......oCCssssssssSSo......',
      '............oCsssssssssSSo......',
      '............ossssssssssSSo......',
      '...........orrssssssssSSo.......',
      '.bbb......orrrsssssssoCWCo......',
      '..........orrrsssssssoCCCo......',
      '..........orrrrssssssooooo......',
      '..........orrrrrsssssoo.........',
      '.........orrrrrrrrroo...........',
      '........oDDDo.oDDDo.............',
      '.bb....oDDDo...oDDDo............',
      '......oDDDo.....oDDo............',
      '.....oDDDo......oDDDoo..........',
      '....oDDDDo......oDDDDDo.........',
      '....oooooo......ooooooo.........',
      '...bb............bWb..bb........',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // AVALANCHE STOMP: the boot coming down, the shock chevrons and thrown
      // snow already leaving the point of impact
      '................................',
      '................................',
      '.........oooooooo...............',
      '........oWWWWWWWWo..............',
      '........obbWWWWbbo..............',
      '........oooooooooo..............',
      '.........owwwwwwuo..............',
      '.........owwwwwwuo..............',
      '.........owwgwwwuo..............',
      '.........owwwwwwuo..............',
      '.........owwwwwwuo..............',
      '.........owwwwwwuo..............',
      '.........owwwwwwuoo.............',
      '.........owwwwwwwuooo...........',
      '.........owwwwwwwwwuooo.........',
      '.........owwwwwwwwwwwuoo........',
      '.........owwwwwwwwwwwwwuo.......',
      '........oDDDDDDDDDDDDDDDDo......',
      '........oDkDDkDDkDDkDDkDDo......',
      '........oooooooooooooooooo......',
      '..........WW...WW...WW..........',
      '........WW.....WW.....WW........',
      '......bb.......bb.......bb......',
      '....bb.........BB.........bb....',
      '.........WW.........WW..........',
      '.....W.......b....b.......W.....',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // JUGGERNAUT: the great helm wreathed in fury - the eye slit burning,
      // embers off the crown
      '................................',
      '.............r....r.............',
      '..........r...rr...r............',
      '...........oooooooooo...........',
      '..........oSSSSSSSSSSo..........',
      '.........oSssssssssssSo.........',
      '........oSsssCCCCsssssSo........',
      '........oSssssCCssssssSo........',
      '....r...oSssssCCssssssSo...r....',
      '........oSssssCCssssssSo........',
      '........oSssssCCssssssSo........',
      '........oSssssCCssssssSo........',
      '........oSokrrrpprrrkoSo........',
      '........oSokrrrrrrrrkoSo........',
      '........oSooooooooooooSo........',
      '...r....oSssssssssssssSo....r...',
      '........oSssssssssssssSo........',
      '........oSssssssssssssSo........',
      '........oSssksskssksssSo........',
      '........oSssksskssksssSo........',
      '........oSssssssssssssSo........',
      '.........oSssssssssssSo.........',
      '..........oSssssssssSo..........',
      '...........oSSSSSSSSo...........',
      '............oooooooo............',
      '......r.................r.......',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
  ],
  [ // STALKER
    [ // SNOWBLIND: blown snow boiling out, motes escaping the edge
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '....Wb......ooooooooo...........',
      '.........ooooB..BBBBoooo...Wb...',
      '.......oooBBBBBBBBBBBBBooo......',
      '......ooBBBBBbbbbbbbBBBBBoo.....',
      '.....ooBBBBbbbbbbbbbbbBBBBoo.Wb.',
      '..WbooBBBbbbbbbbbbbbbbbbBBBoo...',
      '....o.BBbbbbbWWWWWWWbbbbbBB.o...',
      '...o.BBBbbbbWWWWWWWWWbbbbBB.Bo..',
      '...oBBBbbbbWWWWWWWWWWWbbbbBBBo..',
      '...oBBBbbbbWWWWWWWWWWWbbbbBBBo..',
      '...oBBBbbbbWWWWWWWWWWWbbbbBBBo..',
      '...oB.BBbbbbWWWWWWWWWbbbbBBBooWb',
      '...Wb.BBbbbbbWWWWWWWbbbbbBB.o...',
      '....ooBBBbbbbbbbbbbbbbbbBBBoo...',
      '.....oBBBBBbbbbbbbbbbbBBBBWb....',
      '......ooBBBBBbbbbbbbBBBBBoo.....',
      '.......oooBBBBBBBBBBBBBooo......',
      '.....Wb..ooooBBBB..Boooo........',
      '............ooooooooo...........',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // COLD TRAIL: the print just made, and the one already filled in
      '................................',
      '................................',
      '................................',
      '................................',
      '...................BBBBBBB......',
      '..................BBCCCCCBB.....',
      '..................BCCWCCCCB.....',
      '..................BCCCCCCCBB....',
      '..................BBCCCCCCCB....',
      '...................BCCCCCCWB....',
      '...................BCCCCCCCB....',
      '.....ooooooo.......BCCCCCCCB....',
      '....ooSSSSSoo......BCCCCCCCB....',
      '....oSSSSSSSo......BCCCCCCCB....',
      '....oSSSSSSSoo.....BBCCCCCBB....',
      '....ooSSSSSSSo.....WBBBBBBB.....',
      '.....oSSSSSSSo.......BCCCBBB....',
      '.....oSSSSSSSo......BBCCCCCWB...',
      '.....oSSSSSSSo......BCCCCCCCB...',
      '.....oSSSSSSSo......BBCCCCCBB...',
      '.....oSSSSSSSo.......BBCCCBB....',
      '.....ooSSSSSoo........BBBBB.....',
      '......ooooooo...................',
      '.......oSSSooo..................',
      '......ooSSSSSoo.................',
      '......oSSSSSSSo.................',
      '......ooSSSSSoo.................',
      '.......ooSSSoo..................',
      '........ooooo...................',
      '................................',
      '................................',
      '................................',
    ],
    [ // KILLING FROST: the promised shaft, crusted over with a frost star
      '................................',
      '................................',
      '................................',
      '................b...............',
      '................b...............',
      '................b...............',
      '...............bbb..............',
      '..............bWWWb.............',
      '...............bWb..............',
      '.....b...b.....WWW..............',
      '......b.bb.....WWW.....bb.bb....',
      '.......bWWb....WWW....Wb.bb.....',
      '.......bWbWW..BBBBB..WbWWb......',
      '.......bbW.WWBBWWWBBWWWb........',
      '..........WWBBWWWWWBBWW.bb......',
      '............BWWWWWWWB...........',
      '............BWWWWWWWB...........',
      '............BWWWWWWWB...........',
      '..........WWBBWWWWWBBWW.bb......',
      '.......bbW.WWBBWWWBBWWWb........',
      '.......bWbWW..BBBBB..WbWWb......',
      '.......bWWb....WWW....Wb.bb.....',
      '......b.bb.....WWW.....bb.bb....',
      '.....b...b.....WWW..............',
      '...............bWb..............',
      '..............bWWWb.............',
      '...............bbb..............',
      '................b...............',
      '................b...............',
      '................b...............',
      '................................',
      '................................',
    ],
    [ // WHITEOUT: a hood with no face, dissolving into the storm around it
      '................................',
      '................................',
      '................................',
      '................................',
      '...............BB...............',
      '..........BBBBBB.BBBBBB.........',
      '.......BBB.............BBB......',
      '.....BBB......bbbbb......BB.....',
      '....BB....bbbb....bbbbb....BB...',
      '...BB...bbb...........bbb...BB..',
      '..BB...bb.....WW........bb...BB.',
      '......bb...WWooooooo.....bb...BB',
      '.....bb...WW.oSSSSSo......bb...B',
      '.....b...WW.oSSSSSSSo......b...B',
      '....b...WW.oSSSSSSSSSo......b...',
      '....b...W..oSSSSkSSSSo......b...',
      '....b...W..oDDDkkkDDDo..........',
      '....b...W..oDDkkkkkDDo..........',
      '....b...WW.oDDDkkkDDDo..........',
      '.....b...WWoDDDDkDDDDo.W.......B',
      '.....bb...WoDDDDDDDDDoW........B',
      '......bb...WWW....WWWW........BB',
      '.......bb.....WWWWW..........BB.',
      '........bbb.................BB..',
      '...........................BB...',
      '.........................BB.....',
      '.......................BBB......',
      '.................BBBBBB.........',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
  ],
  [ // TINKER
    [ // SCATTER: one nock, every shaft leaving it at once
      '................................',
      '................................',
      '................................',
      '.......................C........',
      '.......................CC.......',
      '.......................CCC......',
      '.......................CCCCC....',
      '.......................CCCd.....',
      '......................tCCd......',
      '....................ttdCC.......',
      '..................ttdd.CCC......',
      '................ttdd...CCCCC....',
      '..............ttdd...ttCCCd.....',
      '......o.....ttdd.ttttddCC.......',
      '....ooSoo.ttdttttdddd..CC.......',
      '....oSCSottttdddd......CCC......',
      '...oSCCCSotttttttttttttCCCCC....',
      '....oSCSotttdddddddddddCCCd.....',
      '....ooSoottdtttt.......CC.......',
      '......o..ddttdddtttt...CC.......',
      '...........ddtt.ddddtttCCC......',
      '.............ddtt...dddCCCCC....',
      '...............ddtt....CCCd.....',
      '.................ddtt..CC.......',
      '...................ddttCC.......',
      '.....................ddCCC......',
      '.......................CCCCC....',
      '.......................CCCd.....',
      '.......................CC.......',
      '.......................C........',
      '................................',
      '................................',
    ],
    [ // OVERCLOCK: the gear wound past its stop, throwing sparks
      '................................',
      '................................',
      '................................',
      '...................o............',
      '.................GGG............',
      '.........oG......GGG............',
      '.........G.G....GGGG.......g....',
      '....g....GGGGGGGGGGGG.......G...',
      '.....G....GGGGGGgGGGGGG.........',
      '.........GGGGgggggggGGGG.GGo.g..',
      '........GGGgggggggggggGGGG.G..G.',
      '........GGgggggggggggggGGGG.....',
      '.......GGGggggggoggggggGGG......',
      '...oGGGGGgggggooooogggggGG......',
      '....GGGGGggggooGGGooggggGG......',
      '....GGGGGggggoGGGGGoggggGG......',
      '......GGggggooGGGGGooggggGG.....',
      '.......GGggggoGGGGGoggggGGGGG...',
      '.......GGggggooGGGooggggGGGGG...',
      '.......GGgggggooooogggggGGGGGo..',
      '.......GGGggggggoggggggGGG......',
      '......GGGGgggggggggggggGG.......',
      '..g..G.GGGGgggggggggggGGG.......',
      '...G.oGG.GGGGgggggggGGGG........',
      '..........GGGGGGgGGGGGG.....g...',
      '....g.......GGGGGGGGGGGG.....G..',
      '.....G.......GGGG....G.G........',
      '.............GGG......Go........',
      '.............GGG................',
      '.............o..................',
      '................................',
      '................................',
    ],
    [ // FIELD CACHE: the open crate, shafts standing in it
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '.........C..C..C..C..C..........',
      '.........t..t..t..t..t..........',
      '........dtddtddtddtddtd.........',
      '.........t..t..t..t..t..........',
      '.........t..t..t..t..t..........',
      '.........t..t..t..t..t..........',
      '.........t..t..t..t..t..........',
      '.........t..t..t..t..t..........',
      '.........t..t..t..t..t..........',
      '......oootootootootootoooo......',
      '......oHHHHHHHHHHHHHHHHHHo......',
      '......owwwwwwwwwwwwwwwwwwo......',
      '......owwwwwwwwwwwwwwwwwwo......',
      '......ouuuuuuuuuuuuuuuuuuo......',
      '......owwwwwwwwwwwwwwwwwwo......',
      '......owwwwwwwwwwwwwwwwwwo......',
      '......owwwwwwwwwwwwwwwwwwo......',
      '......ouuuuuuuuuuuuuuuuuuo......',
      '......owwwwwwwwwwwwwwwwwwo......',
      '......owwwwwwwwwwwwwwwwwwo......',
      '......owwwwwwwwwwwwwwwwwwo......',
      '......oooooooooooooooooooo......',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // MAGNET: three loose finds dragged in along their arcs
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '............................g...',
      '...g.......................ggg..',
      '..ggg..BBBBbbb............ggGgg.',
      '.ggGggBB.....bbb...........ggg..',
      '..ggg......................Bg...',
      '...g............S.........B.....',
      '..............SSCSS.......B.....',
      '..............SCCCS......BB.....',
      '.............SCCCCCS....bb......',
      '..............SCCCS...bbb.......',
      '..............SSCSS.............',
      '............b...S...............',
      '............b...................',
      '............b...................',
      '............b...................',
      '............BB..................',
      '.............BB.................',
      '..............BB.g..............',
      '...............Bggg.............',
      '...............ggGgg............',
      '................ggg.............',
      '.................g..............',
      '................................',
    ],
  ],
  [ // WARDEN
    [ // ICE WALL: three slabs stood in a row, a shot breaking on them
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '......W........W........W.......',
      '......W........W........W.......',
      '.....bWb......bWb......bWb......',
      '.....bWb......bWb......bWb......',
      '...oobWbooo.oobWbooo.oobWbooo...',
      '...oWbbbbbo.oWbbbbbo.oWbbbbbo...',
      '...oBBBBBBo.oBBBBBBo.oBBBBBBo...',
      '...oWWbbbbo.oWWbbbbo.oWWbbbCo...',
      '...oWWbbbbo.oWWbbbbo.oWWbbbbo...',
      '...oWWbbbbo.oWWbbbbo.oWWbCbbo...',
      '...oBBBBBBo.oBBBBBBo.oBCBBBBo...',
      '...oWWbbbbo.oWWbbbbo.oWWbbtttttt',
      '...oWWbbbbo.oWWbbbbo.oWWbbbbo...',
      '...oWWbbbbo.oWWbbbbo.oWWCbbbo...',
      '...oBBBBBBo.oBBBBBBo.oBBBBBBo...',
      '...oWWbbbbo.oWWbbbbo.oWWbbCbo...',
      '...oWWbbbbo.oWWbbbbo.oWWbbbbo...',
      '...oWWbbbbo.oWWbbbbo.oWWbbbbo...',
      '...oBBBBBBo.oBBBBBBo.oBBBBBBo...',
      '...oWWbbbbo.oWWbbbbo.oWWbbbbo...',
      '...oooooooo.oooooooo.oooooooo...',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // BRAZIER: the fire bowl on its legs, flame standing out of it
      '................................',
      '................................',
      '................W...............',
      '................g...............',
      '................g...............',
      '...............ggg..............',
      '............W..rrr..W...........',
      '............g..rrr..g...........',
      '...........ggg.rrr.ggg..........',
      '...........gggrrrrrggg..........',
      '...........rrrrrrrrrrr..........',
      '..........rrrrrrrrrrrrr.........',
      '..........rrrrrrrrrrrrr.........',
      '..........rrrrrrrrrrrrr.........',
      '......ooooooooooooooooooooo.....',
      '......HHHHHHHHHHHHHHHHHHHHH.....',
      '.......uuwwwwwwwwwwwwwwwuu......',
      '........uuwwwwwwwwwwwwwuu.......',
      '.........uuwwwwwwwwwwwuu........',
      '..........uuwwwwwwwwwuu.........',
      '...........uuwwwwwwwuu..........',
      '............uuwwwwwuu...........',
      '.............ouwwwuo............',
      '............ou.....uo...........',
      '...........ou.......uo..........',
      '..........ou.........uo.........',
      '.........ou...........uo........',
      '........ou.............uo.......',
      '.......ou...............uo......',
      '................................',
      '................................',
      '................................',
    ],
    [ // SPIKE LINE: five stakes driven point-up through churned ground
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '....o...........o...........o...',
      '..o.h.o.......o.h.o.......o.h.o.',
      '..o.h.o.......o.h.o.......o.h.o.',
      '..o.h.o...o...o.h.o...o...o.h.o.',
      '..oHhno.o.h.o.oHhno.o.h.o.oHhno.',
      '..oHhno.o.h.o.oHhno.o.h.o.oHhno.',
      '..oHhno.o.h.o.oHhno.o.h.o.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..oHhno.oHhno.oHhno.oHhno.oHhno.',
      '..SSSSS.SSSSS.SSSSS.SSSSS.SSSSS.',
      '.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
    [ // REDOUBT: a closed ring of cover, and the arrow it refused
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '...............o.o.........C....',
      '..........o.o..C.C..o.o..C......',
      '..........C.C..C.C..C.C.........',
      '........o.C.C..S.S..C.CCo.tttttt',
      '......o.C.S.S..S.S..S.S.C.o.....',
      '......C.C.S.S..S.S..S.S.C.C.....',
      '.....oC.S.S.S..o.o..S.S.S.Co....',
      '.....CS.S.o.o.......o.o.S.SC....',
      '.....CS.S....BBBBBBB....S.SC....',
      '.....SS.o..BB.......BB..o.SS....',
      '.....So...BB...DDD...BB...oS....',
      '.....S....B...DDDDD...B....S....',
      '.....oo...B..DDDDDDD..B...oo....',
      '.....SC.o.B...DDDDD...B.o.CS....',
      '.....oC.C.BB...DDD...BB.C.CS....',
      '.....SS.C.oBB.......BBo.C.SS....',
      '.....oS.S.C.CBBBBBBBC.C.S.So....',
      '......S.S.C.C..C.C..C.C.S.S.....',
      '......o.S.S.S..C.C..S.S.S.o.....',
      '........o.S.S..S.S..S.S.o.......',
      '..........S.S..S.S..S.S.........',
      '..........o.o..S.S..o.o.........',
      '...............o.o..............',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
  ],
];
const ab32Cache = new Map();
// the baked 32x32 icon for class ability (cls, i)
function classAbIcon(cls, i) {
  const key = cls + ':' + i;
  let cv = ab32Cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const g = cv.getContext('2d');
    const rows = AB32[cls][i];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const col = AB32_PAL[row[c]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(c, r, 1, 1);
      }
    }
    ab32Cache.set(key, cv);
  }
  return cv;
}
