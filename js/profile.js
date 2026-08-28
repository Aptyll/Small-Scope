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
  const DEFAULT_NAME = 'WANDERER'; // what SKIP takes, and what a corrupt save falls back to

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
      name: '',        // '' until the first-launch prompt is answered
      named: false,    // has that prompt been answered at all (SKIP counts)
      dropped: false,  // has this profile ever jumped off the eagle - gates the first-flight countdown
      // wins = matches the local slot was standing for at the win
      // (endMatch('won')); days = days begun (takeoff + each dawn still in).
      // A save written as games/bestDay is a different pair and is not copied.
      stats: { wins: 0, gold: 0, days: 0 },
      // The tech tree, and the only part of a profile that a MATCH reads back
      // (js/tools.js decides what the world can drop from `done`). Two id
      // lists, both of `TECH` node ids: `seen` is every kind this profile has
      // ever held - written from the pickup, purely a marker on the node -
      // and `done` is every kind researched. Nothing else is stored: the
      // research spent is the sum of what `done` costs and the points earned
      // come from stats.gold, so the two can never drift apart.
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
        profile.named = !!s.named;
        profile.dropped = !!s.dropped;
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
      // save) is dropped rather than shown - the prompt comes back for it
      if (profile.name && !validate(profile.name).ok) { profile.name = ''; profile.named = false; }
      return profile;
    },

    get() { return profile; },
    // the name to print: the default stands in for a skipped prompt
    name() { return profile.name || DEFAULT_NAME; },
    // has the first-launch prompt been answered - the ONLY thing that decides
    // whether the menu opens it unasked
    named() { return !!profile.named; },
    validate,

    // Set the name, validated. Returns validate()'s result; on failure nothing
    // is written and the caller keeps its editor open.
    setName(raw) {
      const r = validate(raw);
      if (!r.ok) return r;
      profile.name = r.name;
      profile.named = true;
      saveNow();
      return r;
    },
    // answer the prompt without a name: the default sticks until it is edited
    skipName() {
      profile.name = '';
      profile.named = true;
      saveNow();
    },

    // ---- first flight -------------------------------------------------------
    // whether this profile has ever left the eagle: false means the next ride
    // runs the PREPARE TO DROP countdown and jumps itself (js/boot.js)
    hasDropped() { return !!profile.dropped; },
    markDropped() { if (!profile.dropped) { profile.dropped = true; saveNow(); } },

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
    // Ids in and out; what a node IS, what it costs and what unlocking one
    // does to a match all live in js/tools.js. This file only remembers.
    tech() { return profile.tech; },
    techSeen(id) { return profile.tech.seen.indexOf(id) >= 0; },
    techDone(id) { return profile.tech.done.indexOf(id) >= 0; },
    // fired from the pickup, so it is coalesced like the stat calls
    markSeen(id) {
      if (profile.tech.seen.indexOf(id) >= 0) return false;
      profile.tech.seen.push(id);
      scheduleSave();
      return true;
    },
    // a deliberate spend at the tree: written through, like setName
    markDone(id) {
      if (profile.tech.done.indexOf(id) >= 0) return false;
      profile.tech.done.push(id);
      saveNow();
      return true;
    },
    // back to a fresh tree without losing the name or the stats behind it -
    // the only way to re-stage the tree for a look at it (DBG.wipeTech)
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
