// Game audio in three layers, all hanging off one master dial:
//   - a WebAudio synth (tone/noise) for the UI blips, and as the fallback under
//     every sampled cue - the game is never silent waiting on a download
//   - one-shot SAMPLES decoded out of audio/sfx/, trimmed of their padding and
//     pitch-jittered per shot, played through sfxBus
//   - a streamed MUSIC layer (HTMLAudioElement) out of audio/music/, crossfaded
//     between tracks, a track able to chain into the next when it ends
// Three dials, all persisted in settings and all set from the ESC panel: master
// (this file's `volume`), MUSIC (`musicVol`) and SOUNDS (`sfxVol`).
(function () {
  let ctx = null;
  let master = null;   // the master dial: destination for everything synthesised or sampled
  let sfxBus = null;   // the SOUNDS dial, under master
  let muted = false;
  let volume = 0.5;    // master
  let musicVol = 0.7;
  let sfxVol = 1;
  let windGain = null;
  let an = null;       // lazy analyser on sfxBus, for SFX.meter()

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxVol;
      sfxBus.connect(master);
      startWind();
      loadBank();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function startWind() {
    // Gentle filtered noise loop for winter ambience.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 420;
    filt.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0.035;
    src.connect(filt).connect(windGain).connect(sfxBus);
    src.start();
    // Slow wind swells.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(windGain.gain);
    lfo.start();
  }

  function tone(freq, dur, type, vol, slide, delay) {
    if (muted) return;
    const c = ensure();
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, freq, delay) {
    if (muted) return;
    const c = ensure();
    const t = c.currentTime + (delay || 0);
    const len = Math.max(1, (c.sampleRate * dur) | 0);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = freq || 1200;
    const g = c.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(sfxBus);
    src.start(t);
  }

  // ---------------------------------------------------------------- samples
  // key -> the files behind it. A call picks one at random, so the two yelps and
  // the three bow shots never repeat back to back, and every shot is pitched a
  // few percent off besides. The whole layer is OPTIONAL: until a file has
  // decoded (or if it never does - file://, a missing folder, a codec) smp()
  // returns false and the caller's synth line plays in its place.
  const SFX_DIR = 'audio/sfx/';
  const RESTOCK_RING = 0.9; // s between the wagon and the bell in SFX.restock
  const SAMPLES = {
    chop: ['wood_chop_#2-1787704670150.mp3'],
    mine: ['stone_on_wood.mp3', 'stone_tap_wood.mp3'],
    bow: ['bow firing.mp3', 'bow firing 2.mp3', 'bow firing 3.mp3'],
    whoosh: ['arrow flying through.mp3'],
    impact: ['deer_getting_hit_by__#2-1787704873503.mp3'],
    oof: ['deep masculine oof 2.mp3', 'deep_masculine_oof_#3-1787704775074.mp3'],
    yelp: ['Sharp,_sudden_yelp_o_#1-1787704729513.mp3', 'Sharp,_sudden_yelp_o_#4-1787704737368.mp3'],
    beastDie: ['rabbit_death_#3-1787705452920.mp3'],
    wolf: ['wolf_noise_#4-1787703570165.mp3'],
    timber: ['tree_falling_down_#1-1787704695709.mp3', 'tree_falling_down_#3-1787704695712.mp3'],
    coin: ['gold_coin_dropping_o_#1-1787704006953.mp3', 'gold_coin_dropping_o_#4-1787704018023.mp3'],
    stash: ['pocket_items_thrown__#2-1787704061469.mp3', 'pocket_items_thrown__#4-1787704061471.mp3'],
    hammer: ['hammer_on_nails_cons_#1-1787704939116.mp3', 'hammer_on_nails_cons_#4-1787704939119.mp3'],
    chew: ['Mouthwatering_chewin_#1-1787704822637.mp3', 'Mouthwatering_chewin_#2-1787704817176.mp3'],
    power: ['power_up_gentle_#1-1787704980322.mp3'],
    warm: ['power_up_gentle_#3-1787704976093.mp3'],
    step: ['walking_on_solid_til_#1-1787704564071.mp3', 'Worn_leather_elf_boot.mp3'],
    wind: ['gentle_wind_blowing_#1-1787704908517.mp3', 'gentle_wind_blowing_#3-1787704902018.mp3',
      'gentle_wind_blowing__#4-1787704410848.mp3'],
    owl: ['owl_sound_at_night_#2-1787704444687.mp3'],
    // the market's four, notification cues rather than world sounds: a coin
    // ding for a price spike, a falling sigh for a crash, and the wagon and the
    // bell the counter's turnover is announced by (SFX.restock, below)
    spike: ['money ding.mp3'],
    crash: ['sad sound.mp3'],
    freight: ['freigh moving.mp3'],
    restock: ['market refresh notification.mp3'],
  };

  const bank = {};   // key -> [{ buf, s, d, g }], one entry per file that decoded
  let banked = false;
  const SMP_PEAK = 0.9;   // every sample is brought to this peak; `vol` mixes from there
  const SMP_MAXG = 8;     // ...but never louder than this, or a near-silent clip becomes hiss

  // Where the sound actually is inside a padded clip, and how loud it is.
  //
  // These files are cut to a fixed length, so an axe hit whose sample opens with
  // 200ms of silence reads as lag: playback starts at `s` and runs for `d`
  // instead of the whole file. They also arrive at wildly different levels -
  // measured peaks run from 0.089 (the chewing) to 1.03 (the falling tree), a
  // 20dB spread - so `g` normalises each one to SMP_PEAK. Without that the quiet
  // third of the bank is inaudible under the music at any sane master setting,
  // and no per-cue `vol` can be tuned, because it means something different for
  // every file. Peak is taken across ALL channels (they are stereo) and the
  // silence threshold is relative to it, or the quiet clips get their own
  // content trimmed off as if it were padding.
  function trim(buf) {
    const ch = [];
    for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
    const n = buf.length, sr = buf.sampleRate;
    const amp = (i) => { let m = 0; for (const d of ch) { const v = Math.abs(d[i]); if (v > m) m = v; } return m; };
    let peak = 0;
    for (let i = 0; i < n; i++) { const v = amp(i); if (v > peak) peak = v; }
    const g = peak > 0.0005 ? Math.min(SMP_MAXG, SMP_PEAK / peak) : 1;
    const th = Math.max(0.002, peak * 0.03);
    let a = 0, b = n - 1;
    while (a < n && amp(a) < th) a++;
    if (a >= n) return { buf, s: 0, d: buf.duration, g }; // silent by this measure: play it whole
    while (b > a && amp(b) < th) b--;
    a = Math.max(0, a - Math.round(sr * 0.005));           // a hair of the attack's run-up
    b = Math.min(n - 1, b + Math.round(sr * 0.06));        // let the tail ring out
    return { buf, s: a / sr, d: Math.max(0.02, (b - a) / sr), g };
  }

  // how the load went, so a silent game can be told apart from a broken one.
  // NEVER swallow these failures: a bank that quietly stayed empty is
  // indistinguishable by ear from a cue wired to the wrong event, and both
  // sound exactly like the game did before the samples existed.
  const bankStat = { want: 0, got: 0, err: [] };

  // base64 out of js/sfxdata.js into bytes decodeAudioData can take. A fresh
  // buffer per call: decodeAudioData detaches the one it is given.
  function bytesOf(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  // Where a clip's bytes come from. js/sfxdata.js (baked by app/bake-sfx.js) is
  // preferred and is what makes opening index.html off the disk work at all - a
  // file:// page is allowed neither fetch nor XHR against its own folder, so
  // without it every sampled cue silently falls back to synth. fetch stays as
  // the fallback for a file that is in audio/sfx/ but not yet baked, so adding a
  // clip works over http before anyone reruns the script.
  function bytes(f) {
    const inline = window.SFXDATA && window.SFXDATA[f];
    if (inline) {
      try { return Promise.resolve(bytesOf(inline)); } catch (e) { /* fall through to fetch */ }
    }
    return fetch(SFX_DIR + encodeURIComponent(f))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))));
  }

  function loadBank() {
    if (banked || !ctx) return;
    banked = true;
    bankStat.want = 0; bankStat.got = 0; bankStat.err.length = 0;
    for (const key in SAMPLES) {
      bank[key] = [];
      for (const f of SAMPLES[key]) {
        bankStat.want++;
        bytes(f)
          .then((b) => ctx.decodeAudioData(b))
          .then((buf) => { bank[key].push(trim(buf)); bankStat.got++; })
          .catch((e) => {
            bankStat.err.push(f + ': ' + (e && e.message ? e.message : e));
            // one line, the first time only, naming the likeliest cause
            if (bankStat.err.length === 1) {
              console.warn('[SFX] sample load failed - the game falls back to its synth cues, '
                + 'which is what "the new sounds do nothing" sounds like. '
                + (window.SFXDATA ? 'js/sfxdata.js is loaded but does not carry this clip: rerun '
                  : 'js/sfxdata.js did not load - index.html must include it, and it is built by ')
                + '`node app/bake-sfx.js`. First failure:', bankStat.err[0]);
            }
          });
      }
    }
  }
  // a bank that came up empty gets one more go on the next gesture: a dev server
  // started after the page was opened is the common way this happens
  function retryBank() {
    if (!banked || bankStat.got > 0 || !bankStat.err.length) return;
    banked = false;
    loadBank();
  }

  const lastAt = {}; // per key, when it last fired: two events in one frame must not double up
  // Play one of `key`'s samples. Returns true if the sampled layer handled the
  // cue (including while muted), false if the caller should fall back to synth.
  // opts: vol, rate + jitter (fraction of rate, random per shot), lp/hp filter
  // corners, delay, gap (the minimum seconds between two of this key), and dur -
  // seconds of the sample to take. Several of these clips hold more than one
  // cue (the footstep file is a whole walking loop, the coin rolls for two
  // seconds), so `dur` cuts one hit out of the front and rides a release ramp
  // down over its last 40ms rather than clicking off mid-waveform.
  function smp(key, o) {
    if (muted) return true;                       // silent either way - don't let the synth double up
    if (!ctx || !bank[key] || !bank[key].length) return false;
    ensure();                                     // a context suspended behind a tab switch must resume
    o = o || {};
    const t = ctx.currentTime + (o.delay || 0);
    const gap = o.gap === undefined ? 0.03 : o.gap;
    if (t - (lastAt[key] === undefined ? -9 : lastAt[key]) < gap) return true;
    lastAt[key] = t;
    const s = bank[key][(Math.random() * bank[key].length) | 0];
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    const r = o.rate === undefined ? 1 : o.rate;
    const j = o.jitter === undefined ? 0.06 : o.jitter;
    src.playbackRate.value = Math.max(0.25, r * (1 + (Math.random() * 2 - 1) * j));
    let node = src;
    if (o.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; node = node.connect(f); }
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node = node.connect(f); }
    const g = ctx.createGain();
    const vol = (o.vol === undefined ? 1 : o.vol) * s.g; // s.g levels the bank; vol is the mix
    g.gain.value = vol;
    const dur = o.dur && o.dur < s.d ? o.dur : s.d;
    if (dur < s.d) { // cut short: ramp out, or the waveform snaps off with a click
      const end = t + dur / src.playbackRate.value;
      const rel = Math.min(0.04, dur * 0.3);
      g.gain.setValueAtTime(vol, end - rel);
      g.gain.linearRampToValueAtTime(0.0001, end);
    }
    node.connect(g).connect(sfxBus);
    src.start(t, s.s, dur);
    return true;
  }

  // ------------------------------------------------------------------ music
  // One streamed element per track (they are minutes long - decoding them into
  // buffers would cost tens of MB), volume-faded by hand from tick(). `next`
  // is the chain the eagle jump rides: JUMPING OFF EAGLE runs to its end and
  // hands straight over to FOXGLOVE DROP, which ends in silence.
  const MUS_DIR = 'audio/music/';
  const TRACKS = {
    intro: { f: 'Frozen North Run Intro.mp3', loop: true, vol: 1 },
    select: { f: 'Frozen North Run Class Selection.mp3', loop: true, vol: 1 },
    eagle: { f: 'Flying On Eagle.mp3', loop: true, vol: 1 },
    jump: { f: 'Jumping Off Eagle.mp3', loop: false, vol: 1, next: 'foxglove' },
    foxglove: { f: 'Foxglove Drop.mp3', loop: false, vol: 0.85 },
    village: { f: 'Forest Village Loop.mp3', loop: true, vol: 0.9 },
    victory: { f: 'Drop the Ice.mp3', loop: true, vol: 1 },
    defeat: { f: 'Sleepy Game Save.mp3', loop: true, vol: 1 },
  };
  const els = {};      // key -> HTMLAudioElement, made on first play
  let curKey = null;   // what should be sounding; anything else is fading out
  let pending = null;  // a play() the autoplay policy refused: retried on the first gesture
  // What a HOLD interrupted, remembered with the second it was interrupted AT:
  // the trading post's song takes the layer while its counter is open and hands
  // it straight back, and what was playing picks up mid-phrase rather than from
  // the top. Any ordinary play() or stop() clears it, so a track that takes the
  // layer for its own reason (a victory, the lobby) can never be undone by a
  // release arriving after it.
  let held = null;

  function musicGain(el, t) {
    el.volume = Math.max(0, Math.min(1, el._g * t.vol * musicVol * volume * (muted ? 0 : 1)));
  }
  function applyMusicVol() {
    for (const k in els) musicGain(els[k], TRACKS[k]);
  }

  function elFor(key) {
    let el = els[key];
    if (el) return el;
    const t = TRACKS[key];
    el = new Audio(MUS_DIR + encodeURIComponent(t.f));
    el.preload = 'auto';
    el.loop = !!t.loop;
    el._g = 0; el._to = 0; el._spd = 0; el._off = false;
    el.addEventListener('ended', () => {
      if (curKey !== key) return; // already handed off; whatever replaced it owns the layer
      curKey = null;
      if (t.next) musicPlay(t.next, { in: 1.4, out: 0 });
    });
    els[key] = el;
    return el;
  }

  function musicPlay(key, o) {
    o = o || {};
    if (!TRACKS[key]) return;
    if (!o.keep) held = null; // an ordinary play owns the layer outright
    if (curKey === key && !o.restart) return;
    const outT = o.out === undefined ? 0.8 : o.out;
    for (const k in els) {
      if (k === key) continue;
      const e = els[k];
      if (e._g > 0 || !e.paused) { e._to = 0; e._spd = outT > 0 ? 1 / outT : 99; e._off = true; }
    }
    curKey = key;
    pending = null;
    const el = elFor(key);
    if (o.restart || el.paused || el.ended) { try { el.currentTime = 0; } catch (e) { } }
    el._off = false;
    el._to = 1;
    const inT = o.in === undefined ? 0.8 : o.in;
    el._spd = inT > 0 ? 1 / inT : 99;
    musicGain(el, TRACKS[key]);
    const pr = el.play();
    // Chrome will not start audio before a gesture; remember what was wanted
    // and let the first click or keypress start it (see the gesture listeners).
    if (pr && pr.catch) pr.catch(() => { if (curKey === key) pending = key; });
  }

  function musicStop(fade) {
    curKey = null;
    pending = null;
    held = null;
    const s = fade === undefined ? 0.8 : fade;
    for (const k in els) { const e = els[k]; e._to = 0; e._spd = s > 0 ? 1 / s : 99; e._off = true; }
  }

  // Borrow the layer. What was sounding is noted WITH its position and faded
  // out; release() brings it back and seeks it to that second, so a long
  // interruption costs the listener the bars it covered rather than the whole
  // song. Holding twice over is still ONE hold - the first thing interrupted is
  // the thing that comes back.
  function musicHold(key, o) {
    if (!TRACKS[key] || curKey === key) return;
    if (!held) {
      const e = curKey ? els[curKey] : null;
      held = { key: curKey, at: e ? e.currentTime : 0 };
    }
    musicPlay(key, Object.assign({ keep: true }, o));
  }
  // Hand it back. Nothing held - or something else took the layer meanwhile -
  // and this is a no-op; a hold taken over silence fades back out to silence.
  function musicRelease(o) {
    if (!held) return;
    const h = held;
    held = null;
    if (!h.key) { musicStop(o && o.out !== undefined ? o.out : 0.8); return; }
    musicPlay(h.key, Object.assign({ keep: true }, o));
    const el = els[h.key];
    // ...after the play, not before: a faded-out element is PAUSED, and
    // musicPlay rewinds a paused one to the top
    if (el) { try { el.currentTime = h.at; } catch (e) { } }
  }

  // ---------------------------------------------------- ambience + the ticker
  // A wind gust every ten-odd seconds over the synth bed, and an owl instead of
  // it once night is properly down. game.js sets the two flags each frame.
  const amb = { on: false, night: false, t: 8 };

  function ambTick(dt) {
    if (!amb.on || muted || !ctx) return;
    amb.t -= dt;
    if (amb.t > 0) return;
    amb.t = 11 + Math.random() * 15;
    if (amb.night && Math.random() < 0.4) smp('owl', { vol: 0.34, jitter: 0.05, gap: 0 });
    else smp('wind', { vol: 0.32, rate: 0.85, jitter: 0.12, lp: 1500, gap: 0 });
  }

  let lastT = 0;
  function tick() {
    const now = (window.performance ? performance.now() : Date.now()) / 1000;
    const dt = lastT ? Math.min(0.25, now - lastT) : 0;
    lastT = now;
    for (const k in els) {
      const el = els[k];
      if (el._g === el._to) continue;
      const step = el._spd * dt;
      el._g = el._to > el._g ? Math.min(el._to, el._g + step) : Math.max(el._to, el._g - step);
      musicGain(el, TRACKS[k]);
      if (el._g <= 0 && el._off) { el._off = false; el.pause(); }
    }
    ambTick(dt);
  }
  setInterval(tick, 50);

  // the first gesture of the session: open the context and start whatever the
  // autoplay policy refused (the title track, almost always)
  function gesture() {
    if (!pending && ctx && ctx.state !== 'suspended') { retryBank(); return; }
    ensure();
    retryBank();
    if (pending) { const k = pending; pending = null; musicPlay(k, { restart: true, in: 0.6, out: 0 }); }
  }
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('mousedown', gesture, true);
  window.addEventListener('keydown', gesture, true);

  // A dial setting, or the value it already had. The guard is not paranoia: a
  // settings blob carrying null or a missing key clamps to 0 through a bare
  // Math.min, which silences a whole bus - and a silenced SOUNDS bus with the
  // music still playing is indistinguishable from every cue being wired wrong.
  // Note the typeof test: `+null` is 0, not NaN, so a coercing guard would let
  // a null straight through to silence - which is the exact trap this exists to
  // close. A real 0 is still honoured; only a non-number keeps the old value.
  function dial(v, keep) {
    if (typeof v !== 'number' || !isFinite(v)) return keep;
    return Math.max(0, Math.min(1, v));
  }

  window.SFX = {
    unlock() { ensure(); gesture(); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : volume;
      applyMusicVol();
      return muted;
    },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : volume;
      applyMusicVol();
    },
    isMuted() { return muted; },
    // the master dial: everything, music included
    setVolume(v) {
      volume = dial(v, volume);
      if (master && !muted) master.gain.value = volume;
      applyMusicVol();
    },
    getVolume() { return volume; },
    setMusicVolume(v) { musicVol = dial(v, musicVol); applyMusicVol(); },
    getMusicVolume() { return musicVol; },
    setSfxVolume(v) {
      sfxVol = dial(v, sfxVol);
      if (sfxBus) sfxBus.gain.value = sfxVol;
    },
    getSfxVolume() { return sfxVol; },
    // the songs. play() is a no-op when that track is already the current one,
    // so a caller can shout it every frame; stop() fades the layer to silence.
    music: {
      play(key, opts) { ensure(); musicPlay(key, opts); },
      stop(fade) { musicStop(fade); },
      // borrow the layer while something is up on screen (the trading post's
      // counter) and give it back at the second it was taken
      hold(key, opts) { ensure(); musicHold(key, opts); },
      release(opts) { ensure(); musicRelease(opts); },
      get held() { return held; },
      get current() { return curKey; },
      // the live element behind a track (the current one by default). For
      // driving from outside: seeking it is how the JUMP -> FOXGLOVE handover
      // gets proved without sitting through five minutes of the jump.
      el(key) { return els[key || curKey] || null; },
    },
    // wind gusts and the night owl over the synth bed
    setAmbience(on, night) { amb.on = !!on; amb.night = !!night; },
    // What the sampled layer actually holds: the context's state, the dials, and
    // per key the trim window + levelling gain of every file that decoded. An
    // empty bank here is the difference between "the cue is wired wrong" and
    // "nothing downloaded", which is otherwise indistinguishable by ear.
    debug() {
      const b = {};
      for (const k in bank) b[k] = bank[k].map((s) => ({ s: +s.s.toFixed(3), d: +s.d.toFixed(3), g: +s.g.toFixed(2) }));
      return { state: ctx ? ctx.state : 'none', volume, musicVol, sfxVol, muted, music: curKey,
        loaded: bankStat.got, want: bankStat.want, errors: bankStat.err.slice(), bank: b };
    },
    // how many sample files are actually decoded and ready, out of how many the
    // table asks for. The info stack (F3) prints this, so "I hear no new sounds"
    // is one keypress from an answer instead of a guess.
    banked() { return { got: bankStat.got, want: bankStat.want, err: bankStat.err.length }; },
    // Peak on the SOUNDS bus right now, 0..1. Costs nothing until first asked
    // for; poll it around a cue to prove the cue makes signal.
    meter() {
      if (!ctx) return 0;
      if (!an) { an = ctx.createAnalyser(); an.fftSize = 2048; sfxBus.connect(an); }
      const d = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(d);
      let p = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > p) p = v; }
      return p;
    },

    chop() { if (smp('chop', { vol: 0.7, jitter: 0.09, dur: 0.42 })) return; noise(0.08, 0.3, 900); tone(180, 0.06, 'triangle', 0.12, -60); },
    mine() { if (smp('mine', { vol: 0.7, rate: 1.05, jitter: 0.12, dur: 0.4 })) return; noise(0.06, 0.25, 2200); tone(320, 0.05, 'square', 0.06, -80); },
    // the UI blip: a selection moving, a panel answering. Synth on purpose -
    // menus need a click that is instant and identical every time, and the
    // world's own pickups have coin()/stash() of their own.
    pickup() { tone(660, 0.07, 'square', 0.16); tone(990, 0.09, 'square', 0.16, 0, 0.06); },
    // gold landing in the purse
    coin() { if (smp('coin', { vol: 0.7, jitter: 0.12, dur: 0.55 })) return; tone(880, 0.06, 'square', 0.07); tone(1320, 0.09, 'triangle', 0.06, 0, 0.05); },
    // something going into the backpack
    stash() { if (smp('stash', { vol: 0.7, jitter: 0.12 })) return; tone(520, 0.06, 'triangle', 0.08); tone(760, 0.08, 'triangle', 0.07, 0, 0.05); },
    swing() { if (smp('whoosh', { vol: 0.6, rate: 1.6, jitter: 0.12, hp: 400, dur: 0.45 })) return; noise(0.07, 0.1, 600); },
    bowDraw() { noise(0.14, 0.06, 350); tone(160, 0.12, 'triangle', 0.04, 60); },
    dodge() { if (smp('whoosh', { vol: 0.65, rate: 0.8, jitter: 0.08, lp: 2400, dur: 0.6 })) return; noise(0.16, 0.14, 550); tone(340, 0.12, 'triangle', 0.06, -220); },
    arrow() { if (smp('bow', { vol: 0.7, jitter: 0.08, dur: 0.6 })) return; noise(0.09, 0.18, 1800); tone(720, 0.06, 'triangle', 0.07, -260); },
    // one boot in the snow. Quiet and heavily jittered - it plays six times a second.
    step() { smp('step', { vol: 0.45, jitter: 0.15, gap: 0.08, dur: 0.24 }); },
    // the shot rhythm: a dry wooden tick the moment the next arrow is nocked and
    // the bow can be drawn again. Quiet on purpose - it plays after every shot.
    nock() { tone(880, 0.03, 'square', 0.035); tone(1240, 0.03, 'square', 0.025, 0, 0.03); },
    // pressing a tool that cannot answer (an empty slot, nothing light enough to throw): a slack string and nothing behind it
    dryFire() { noise(0.05, 0.07, 260); tone(120, 0.09, 'triangle', 0.06, -40); },
    // going to ground: a body dropping into deep snow, all low crunch and no pitch
    bury() { noise(0.22, 0.2, 380); tone(96, 0.16, 'triangle', 0.06, -26); },
    // the cover finishes settling. Barely there on purpose - it is the sound of
    // NOT being heard, and it plays with a rival somewhere close by
    hidden() { noise(0.14, 0.05, 260); tone(1320, 0.1, 'sine', 0.022, 180, 0.03); },
    // getting back up: the snow sheds off in one shove
    rise() { noise(0.16, 0.16, 1000, 0); tone(150, 0.11, 'triangle', 0.05, 70); },
    // the shot out of the snow lands: the bow sample dropped a third under the
    // synth crack and thump, so an ambush never sounds like an ordinary arrow
    ambush() {
      if (!smp('bow', { vol: 0.8, rate: 0.8, jitter: 0.04, dur: 0.7 })) tone(720, 0.05, 'square', 0.1, -520);
      noise(0.12, 0.32, 1700); tone(104, 0.2, 'sawtooth', 0.13, -34, 0.02);
    },
    // turret: a hard electric crack with a low thump under it, so it never reads as a bow
    turretFire() { tone(880, 0.05, 'square', 0.07, -520); noise(0.07, 0.2, 2600); tone(230, 0.11, 'triangle', 0.09, -90, 0.02); },
    hit() { if (smp('impact', { vol: 0.65, rate: 1.1, jitter: 0.1, dur: 0.5 })) return; noise(0.06, 0.25, 800); tone(140, 0.08, 'sawtooth', 0.1, -50); },
    hurt() { if (smp('oof', { vol: 0.7, jitter: 0.07 })) return; tone(200, 0.18, 'sawtooth', 0.16, -120); noise(0.12, 0.2, 500); },
    // a creature crying out under a hit it survived
    yelp() { if (smp('yelp', { vol: 0.55, jitter: 0.1, delay: 0.05 })) return; tone(620, 0.12, 'sawtooth', 0.07, -240, 0.05); },
    // a UI confirmation - a panel opening, a slot returning. The world's own
    // building work is hammer().
    place() { tone(240, 0.06, 'triangle', 0.2); tone(360, 0.08, 'triangle', 0.18, 0, 0.05); },
    // raising, upgrading or finishing a structure: the punctuation
    hammer() { if (smp('hammer', { vol: 0.7, jitter: 0.1 })) return; tone(240, 0.06, 'triangle', 0.14); tone(360, 0.08, 'triangle', 0.12, 0, 0.05); },
    // one blow of the work still going on, on the site's dust tick. Quieter and
    // shorter than hammer(), and widely jittered, because it repeats for as long
    // as the build takes and must never settle into a rhythm.
    building() { smp('hammer', { vol: 0.34, rate: 1.15, jitter: 0.22, dur: 0.3, gap: 0.2 }); },
    // a body arriving out of the sky: the boot sample dropped an octave under a
    // low thump, so a landing reads as weight and not as an arrow connecting
    land() {
      smp('step', { vol: 0.7, rate: 0.5, jitter: 0.05, lp: 1100, dur: 0.45, gap: 0 });
      noise(0.22, 0.24, 420); tone(88, 0.2, 'triangle', 0.09, -22);
    },
    deny() { tone(140, 0.12, 'square', 0.17, -30); },
    // knocking on solid ice: a glassy crack over a dull refusal
    iceKnock() { noise(0.06, 0.3, 3200); tone(1400, 0.08, 'triangle', 0.06, -700); tone(130, 0.12, 'square', 0.07, -25); },
    break_() { if (smp('timber', { vol: 0.6, rate: 1.4, jitter: 0.1, hp: 180, dur: 0.6 })) return; noise(0.2, 0.3, 700); tone(120, 0.15, 'triangle', 0.12, -60); },
    // an animal going down; a wolf yelps where everything else squeals
    monsterDie(kind) {
      if (smp(kind === 'wolf' ? 'yelp' : 'beastDie', { vol: 0.7, jitter: 0.08 })) return;
      tone(500, 0.2, 'triangle', 0.12, -350); noise(0.15, 0.15, 3000);
    },
    eat() { if (smp('chew', { vol: 0.65, jitter: 0.1 })) return; tone(300, 0.05, 'triangle', 0.1); tone(260, 0.05, 'triangle', 0.1, 0, 0.07); },
    treeFall() { if (smp('timber', { vol: 0.75, jitter: 0.06 })) return; noise(0.35, 0.35, 400); tone(90, 0.3, 'triangle', 0.14, -30); },
    // a wingbeat blast - the eagle's gust and its takeoff: the dodge whoosh
    // slowed into a heavy buffet of air over a low push
    gust() {
      if (smp('whoosh', { vol: 0.85, rate: 0.55, jitter: 0.06, lp: 1600, dur: 0.9 })) return;
      noise(0.3, 0.32, 500); tone(120, 0.22, 'triangle', 0.09, -55);
    },
    // an eagle hitting the treeline: the timber sample dropped low with a
    // synth blast wave stacked under it (layered on purpose, not a fallback)
    boom() {
      smp('timber', { vol: 0.9, rate: 0.55, jitter: 0.04 });
      noise(0.5, 0.5, 320); noise(0.2, 0.4, 1100);
      tone(58, 0.5, 'triangle', 0.2, -26); tone(40, 0.75, 'sine', 0.16, -10);
    },
    nightSting() {
      tone(196, 1.2, 'triangle', 0.09, -20);
      tone(147, 1.4, 'triangle', 0.08, -15, 0.15);
    },
    dawnChime() {
      tone(523, 0.35, 'triangle', 0.07);
      tone(659, 0.35, 'triangle', 0.07, 0, 0.18);
      tone(784, 0.5, 'triangle', 0.07, 0, 0.36);
    },
    levelUp() {
      if (smp('power', { vol: 0.7, jitter: 0.04 })) return;
      tone(523, 0.08, 'square', 0.08); tone(659, 0.08, 'square', 0.08, 0, 0.07); tone(784, 0.16, 'square', 0.09, 0, 0.14); tone(1046, 0.22, 'triangle', 0.08, 0, 0.2);
    },
    // the match won: a four-note fanfare over a held low fifth, capped by a
    // bright ring - the sting the victory song comes up underneath
    victory() {
      tone(392, 0.11, 'square', 0.09);
      tone(523, 0.11, 'square', 0.09, 0, 0.10);
      tone(659, 0.11, 'square', 0.09, 0, 0.20);
      tone(784, 0.45, 'square', 0.10, 0, 0.30);
      tone(1046, 0.75, 'triangle', 0.09, 0, 0.46);
      tone(196, 1.5, 'triangle', 0.07, 0, 0.30);
      tone(294, 1.5, 'triangle', 0.05, 0, 0.30);
      noise(0.45, 0.09, 3200);
    },
    // one number climbing on the victory screen: a dry, quiet blip
    tally() { tone(1320, 0.03, 'square', 0.035); },
    // The market moving hard (marketNews, js/shop.js), under the plate that
    // rises with it (the `market notices` banner, js/shop.js): a coin dinging
    // on a spike, a sad fall on a crash. Two DIFFERENT clips rather than one
    // pitched two ways, and unjittered, because this is read as a DIRECTION
    // and not as a texture - a spike must never be mistakable for a crash.
    // The synth pair underneath is the fallback, and says the same thing.
    market(up) {
      if (smp(up ? 'spike' : 'crash', { vol: up ? 0.6 : 0.75, jitter: 0 })) return;
      tone(up ? 700 : 990, 0.07, 'square', 0.06);
      tone(up ? 990 : 700, 0.14, 'triangle', 0.07, 0, 0.06);
    },
    // The counter turning over (shopRestock, js/shop.js): the wagon pulling
    // in, and RESTOCK_RING seconds behind it the bell over the new stock -
    // one cue in two beats, the second landing as the plate settles. The gap
    // is deliberate and fixed: it is the sound of the goods arriving and THEN
    // being laid out, and jitter on either half would blur that into one noise.
    restock() {
      // both whole: the wagon is 3.3 s and still rolling under the bell,
      // which is the point - the goods arrive, then they are laid out
      const a = smp('freight', { vol: 0.5, jitter: 0 });
      const b = smp('restock', { vol: 0.7, jitter: 0, delay: RESTOCK_RING });
      if (a || b) return;
      tone(240, 0.06, 'triangle', 0.2); tone(360, 0.08, 'triangle', 0.18, 0, 0.05);
      tone(523, 0.1, 'triangle', 0.09, 0, RESTOCK_RING);
      tone(784, 0.18, 'triangle', 0.09, 0, RESTOCK_RING + 0.09);
    },
    heal() { if (smp('warm', { vol: 0.6, rate: 1.3, jitter: 0.06 })) return; tone(440, 0.1, 'triangle', 0.08); tone(554, 0.12, 'triangle', 0.08, 0, 0.08); },
    splash() { noise(0.28, 0.28, 750); tone(300, 0.22, 'sine', 0.1, -190); noise(0.14, 0.12, 1500, 0.06); },
    // the wolf den: the pack answering, or a rising synth howl that sags at the end
    howl() {
      if (smp('wolf', { vol: 0.7, jitter: 0.08 })) return;
      tone(280, 0.55, 'sawtooth', 0.05, 150); tone(430, 0.75, 'triangle', 0.06, -140, 0.1); tone(360, 0.5, 'triangle', 0.035, -110, 0.34);
    },
    bite() { if (smp('impact', { vol: 0.5, rate: 1.45, jitter: 0.1, gap: 0.05, dur: 0.35 })) return; noise(0.07, 0.32, 1100); tone(210, 0.08, 'sawtooth', 0.11, -110); },
    // the rookery going up: three overlapping beats of wings
    wings() { noise(0.09, 0.14, 520); noise(0.09, 0.12, 460, 0.07); noise(0.08, 0.09, 400, 0.15); },
  };
})();
