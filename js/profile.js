// The local player profile: who you are between matches.
//
// One object under one localStorage key, and THE ONLY PLACE THE GAME TOUCHES
// STORAGE. Everything else - game.js included - goes through window.PROFILE, so
// putting the profile on a server later is a change to this file and nothing
// else: swap the private read()/write() pair for requests, keep the surface
// below identical.
//
// There are no accounts, no passwords and no sign-in. A profile is a name, a
// handful of lifetime stats, and the settings that used to live under a key of
// their own (moved here in v1; the old key is migrated once and removed).
(function () {
  const KEY = 'softfall.profile';
  const OLD_SETTINGS = 'softfall.settings'; // pre-profile saves; migrated once
  const NAME_MAX = 16;
  const DEFAULT_NAME = 'WANDERER'; // what a corrupt save falls back to mid-session

  // A fresh profile is NAMED, not asked: the first-launch prompt was friction
  // where a new player wanted the game, so load() rolls one of these winter
  // words instead and the name panel waits behind the title's name tag for
  // whenever they care. Every word passes validate() (A-Z, under NAME_MAX,
  // clean), and none is a class name.
  const NAME_POOL = [
    'JUNIPER', 'ROWAN', 'ASPEN', 'BIRCH', 'ALDER', 'BRAMBLE', 'SORREL', 'THISTLE',
    'FROST', 'DRIFT', 'FLURRY', 'EMBER', 'FLINT', 'TINDER', 'GLACIER', 'AURORA',
    'MARTEN', 'ERMINE', 'SABLE', 'VIXEN', 'LYNX', 'STOAT', 'OTTER', 'BADGER',
    'HERON', 'MAGPIE', 'STARLING', 'PLOVER', 'SISKIN', 'KESTREL', 'REDPOLL', 'BRANT',
  ];
  function randomName() {
    return NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
  }

  // A basic filter, deliberately: it normalises the obvious letter-for-digit
  // swaps and then looks for any of these ANYWHERE in the name, so a handful of
  // innocent strings will be refused too. That trade is the right way round for
  // a name every other player sees, and the list is the one thing here a server
  // would replace outright.
  const BAD = [
    'FUCK', 'SHIT', 'CUNT', 'BITCH', 'BASTARD', 'DICK', 'COCK', 'PUSSY', 'PENIS',
    'VAGINA', 'WHORE', 'SLUT', 'ANUS', 'RAPE', 'NAZI', 'HITLER', 'NIGG', 'FAGG',
    'RETARD', 'WANK', 'TWAT', 'PISS', 'BOLLOCK', 'ARSEHOLE', 'ASSHOLE', 'PORN',
  ];
  // Entries are matched as substrings, so the list is deliberately missing the
  // short ones that live inside ordinary words - ASS in CLASS, CUM in SCUM. A
  // name is 16 characters; refusing half the dictionary to catch those is the
  // worse failure.
  const LEET = { '0': 'O', '1': 'I', '3': 'E', '4': 'A', '5': 'S', '7': 'T', '8': 'B' };

  // the shape a fresh install starts from; also what a corrupt save is repaired
  // against, so every field below is guaranteed present to every reader
  function blank() {
    return {
      v: 1,
      name: '',        // '' only until load() rolls a random one; edited from the name panel
      dropped: false,  // has this profile ever jumped off the eagle - gates the first-flight countdown
      practice: false, // has the PRACTICE TOOL plank been knocked open (3 knocks; stays open)
      bestLap: 0,      // the ice parkour's all-time best lap in seconds (0 = never lapped)
      bestRange: 0,    // the archery range's all-time best round score (0 = never played) - these two are all practice writes
      // wins = matches the local player was standing for at the win
      // (endMatch('won')); days = days begun (takeoff + each dawn still in).
      // A save written as games/bestDay is a different pair and is not copied.
      stats: { wins: 0, gold: 0, days: 0 },
      // The arsenal tree. A MATCH reads nothing back out of here - every kind
      // is unlocked for every profile alike - so the one live list is `seen`:
      // every `TECH` node id this profile has ever held, written from the
      // pickup and drawn as a pip on the node. `done` is the research a save
      // from before the unlock (PATCH 2.08) had bought; it is still carried
      // through so a veteran's record is not thrown away, and nothing reads it.
      tech: { seen: [], done: [] },
      // null, not {} - game.js reads a null here as "nothing was ever saved"
      // and skips its own settings migration, which a bare {} would trigger
      settings: null,
    };
  }

  let profile = blank();
  let dirty = false;
  let timer = 0;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function write(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { }
  }
  // coalesced write: the stat calls fire mid-match (every gold payout is one),
  // and a localStorage round trip per coin is not worth paying
  function scheduleSave() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => { timer = 0; flush(); }, 800);
  }
  function flush() {
    if (dirty) saveNow();
  }
  function saveNow() {
    dirty = false;
    write(profile);
  }

  // ---- name ---------------------------------------------------------------
  function fold(s) {
    let out = '';
    for (const ch of s) out += LEET[ch] || ch;
    return out;
  }
  function profane(name) {
    const f = fold(name);
    for (const w of BAD) if (f.indexOf(w) >= 0) return true;
    return false;
  }
  // The one validator. Returns { ok:true, name } with the stored form, or
  // { ok:false, why } where why is 'EMPTY' | 'CHARS' | 'LONG' | 'RUDE'. The UI
  // stops most of these at the keystroke, but every write goes through here.
  function validate(raw) {
    const s = String(raw == null ? '' : raw).trim().toUpperCase();
    if (!s) return { ok: false, why: 'EMPTY' };
    if (s.length > NAME_MAX) return { ok: false, why: 'LONG' };
    if (!/^[A-Z0-9]+$/.test(s)) return { ok: false, why: 'CHARS' };
    if (profane(s)) return { ok: false, why: 'RUDE' };
    return { ok: true, name: s };
  }

  window.PROFILE = {
    NAME_MAX, DEFAULT_NAME,

    // Read the store once, at boot, before anything asks for a name. Repairs a
    // partial or corrupt save against blank() rather than throwing, and folds a
    // pre-profile settings key in on the way past.
    load() {
      const s = read();
      profile = blank();
      if (s && typeof s === 'object') {
        if (typeof s.name === 'string') profile.name = s.name;
        profile.dropped = !!s.dropped;
        profile.practice = !!s.practice;
        if (typeof s.bestLap === 'number' && isFinite(s.bestLap) && s.bestLap > 0) profile.bestLap = s.bestLap;
        if (typeof s.bestRange === 'number' && isFinite(s.bestRange) && s.bestRange > 0) profile.bestRange = Math.floor(s.bestRange);
        if (s.stats && typeof s.stats === 'object') {
          // only the live keys. games/bestDay from PATCH 1.82 are not wins/days
          // (matches started vs matches won; highest day vs days begun), so an
          // old save keeps its gold and starts the new counters at zero
          for (const k in profile.stats) {
            if (typeof s.stats[k] === 'number' && isFinite(s.stats[k])) {
              profile.stats[k] = Math.max(0, Math.floor(s.stats[k]));
            }
          }
        }
        // the tech lists: strings only, de-duplicated, and a save written
        // before the tree existed simply arrives without them and keeps the
        // empty pair blank() made
        if (s.tech && typeof s.tech === 'object') {
          for (const k of ['seen', 'done']) {
            if (!Array.isArray(s.tech[k])) continue;
            for (const id of s.tech[k]) {
              if (typeof id === 'string' && profile.tech[k].indexOf(id) < 0) profile.tech[k].push(id);
            }
          }
        }
        if (s.settings && typeof s.settings === 'object') profile.settings = s.settings;
      } else {
        // no profile yet: adopt the settings the player already had
        try {
          const old = JSON.parse(localStorage.getItem(OLD_SETTINGS));
          if (old && typeof old === 'object') profile.settings = old;
          localStorage.removeItem(OLD_SETTINGS);
        } catch (e) { }
        saveNow();
      }
      // a stored name that no longer passes (the filter grew, a hand-edited
      // save) is dropped rather than shown, and an empty name - a fresh
      // profile, an old SKIP, or that repair - rolls a random one and keeps
      // it, so a player always has a name and never has to stop for one
      if (profile.name && !validate(profile.name).ok) profile.name = '';
      if (!profile.name) { profile.name = randomName(); saveNow(); }
      return profile;
    },

    get() { return profile; },
    // the name to print: load() guarantees one, the default is a last resort
    name() { return profile.name || DEFAULT_NAME; },
    validate,

    // Set the name, validated. Returns validate()'s result; on failure nothing
    // is written and the caller keeps its editor open.
    setName(raw) {
      const r = validate(raw);
      if (!r.ok) return r;
      profile.name = r.name;
      saveNow();
      return r;
    },

    // ---- first flight -------------------------------------------------------
    // whether this profile has ever left the eagle: false means the next ride
    // runs the PREPARE TO DROP countdown and jumps itself (js/boot.js)
    hasDropped() { return !!profile.dropped; },
    markDropped() { if (!profile.dropped) { profile.dropped = true; saveNow(); } },

    // ---- the practice tool --------------------------------------------------
    // whether the PRACTICE TOOL plank's ice has been broken (three knocks at
    // the title menu, js/menu.js). Once open it never refreezes for this
    // profile - the plank is a live menu item from then on.
    practiceOpen() { return !!profile.practice; },
    markPractice() { if (!profile.practice) { profile.practice = true; saveNow(); } },
    // the ice parkour's all-time best lap - one of the two things the arena
    // itself writes back (updatePractice, js/world.js). Stored at the plate's
    // own 0.1 s precision so the number shown IS the number kept; only a
    // strictly better (lower) time writes, and a lap record is a moment, not
    // a trickle, so it saves through immediately.
    bestLap() { return profile.bestLap; },
    setBestLap(t) {
      if (!(t > 0)) return false;
      const r = Math.round(t * 10) / 10;
      if (profile.bestLap && r >= profile.bestLap) return false;
      profile.bestLap = r;
      saveNow();
      return true;
    },
    // the archery range's all-time best round score - the lap record's twin
    // (agEndRound, js/world.js). Whole points; only a strictly higher score
    // writes, and a record is a moment, so it saves through immediately.
    bestRange() { return profile.bestRange; },
    setBestRange(n) {
      if (!(n > 0)) return false;
      const r = Math.floor(n);
      if (r <= profile.bestRange) return false;
      profile.bestRange = r;
      saveNow();
      return true;
    },

    // ---- settings ---------------------------------------------------------
    // The live stored object, or null if this profile has never saved any.
    settings() { return profile.settings; },
    putSettings(s) { profile.settings = s; saveNow(); },

    // ---- stats ------------------------------------------------------------
    stats() { return profile.stats; },
    addWin() { profile.stats.wins++; scheduleSave(); },
    addGold(n) { if (n > 0) { profile.stats.gold += n; scheduleSave(); } },
    // one call per day the player sets foot in: day 1 as the eagles take off
    // (js/boot.js beginDrop), every later day at its dawn (js/sim.js) - counted
    // at the START of the day, so quitting mid-match keeps the days begun
    addDay() { profile.stats.days++; scheduleSave(); },

    // ---- tech tree ----------------------------------------------------------
    // Ids in and out; what a node IS lives in js/tools.js. This file only
    // remembers which kinds have been held.
    techSeen(id) { return profile.tech.seen.indexOf(id) >= 0; },
    // fired from the pickup, so it is coalesced like the stat calls
    markSeen(id) {
      if (profile.tech.seen.indexOf(id) >= 0) return false;
      profile.tech.seen.push(id);
      scheduleSave();
      return true;
    },
    // back to an unmarked tree without losing the name or the stats behind it
    // - the only way to re-stage the page for a look at it (DBG.wipeTech)
    clearTech() {
      profile.tech.seen.length = 0;
      profile.tech.done.length = 0;
      saveNow();
    },

    flush,
  };

  // a coalesced write still pending when the tab goes away
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
})();
