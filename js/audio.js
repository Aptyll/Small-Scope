// Small WebAudio synth for all game sounds. No assets, all generated.
(function () {
  let ctx = null;
  let master = null;
  let muted = false;
  let volume = 0.5;
  let windGain = null;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      startWind();
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
    src.connect(filt).connect(windGain).connect(master);
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
    o.connect(g).connect(master);
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
    src.connect(filt).connect(g).connect(master);
    src.start(t);
  }

  window.SFX = {
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : volume;
      return muted;
    },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : volume;
    },
    isMuted() { return muted; },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master && !muted) master.gain.value = volume;
    },
    getVolume() { return volume; },
    chop() { noise(0.08, 0.3, 900); tone(180, 0.06, 'triangle', 0.12, -60); },
    mine() { noise(0.06, 0.25, 2200); tone(320, 0.05, 'square', 0.06, -80); },
    pickup() { tone(660, 0.07, 'square', 0.08); tone(990, 0.09, 'square', 0.08, 0, 0.06); },
    swing() { noise(0.07, 0.1, 600); },
    hit() { noise(0.06, 0.25, 800); tone(140, 0.08, 'sawtooth', 0.1, -50); },
    hurt() { tone(200, 0.18, 'sawtooth', 0.16, -120); noise(0.12, 0.2, 500); },
    place() { tone(240, 0.06, 'triangle', 0.14); tone(360, 0.08, 'triangle', 0.12, 0, 0.05); },
    deny() { tone(140, 0.12, 'square', 0.08, -30); },
    break_() { noise(0.2, 0.3, 700); tone(120, 0.15, 'triangle', 0.12, -60); },
    monsterDie() { tone(500, 0.2, 'triangle', 0.12, -350); noise(0.15, 0.15, 3000); },
    eat() { tone(300, 0.05, 'triangle', 0.1); tone(260, 0.05, 'triangle', 0.1, 0, 0.07); },
    treeFall() { noise(0.35, 0.35, 400); tone(90, 0.3, 'triangle', 0.14, -30); },
    nightSting() {
      tone(196, 1.2, 'triangle', 0.09, -20);
      tone(147, 1.4, 'triangle', 0.08, -15, 0.15);
    },
    dawnChime() {
      tone(523, 0.35, 'triangle', 0.07);
      tone(659, 0.35, 'triangle', 0.07, 0, 0.18);
      tone(784, 0.5, 'triangle', 0.07, 0, 0.36);
    },
    heal() { tone(440, 0.1, 'triangle', 0.08); tone(554, 0.12, 'triangle', 0.08, 0, 0.08); },
  };
})();
