'use strict';
// THE TWIN ARENA — the sound engine. Synthesized WebAudio; no audio files.
//
// Why this file exists: the Phase 1/2 client had a lone beep() helper that
// created its AudioContext lazily inside a fetch().then() and NEVER called
// resume(). On phones (iOS especially) a context born outside the tap's own
// call stack starts 'suspended' and stays there — every note was scheduled
// into a dead context and the game was silent. This engine fixes that at the
// root: the context is created and resumed synchronously inside user
// gestures (a capture-phase listener on pointerdown/touchend/keydown, plus
// explicit unlock() calls in the fight's start handler), and every game beat
// gets a real, distinct synthesized sound at an audible level.
(function () {
  var STORAGE_KEY = 'ta-sound';
  var ctx = null, master = null, noiseBuf = null, humNodes = null;
  var plays = []; // test hook + sanity log: names of sounds actually sounded
  var muted = false;
  try { muted = localStorage.getItem(STORAGE_KEY) === 'off'; } catch (e) {}

  function ensure() {
    if (ctx) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 8;
      comp.attack.value = 0.004; comp.release.value = 0.18;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(comp); comp.connect(ctx.destination);
      var len = ctx.sampleRate | 0;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }

  // Call from inside a user gesture. Creates the context if needed and
  // resumes it — the two things the old beep() never did in time.
  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended') {
      try { var p = c.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    return c;
  }

  function tone(o) {
    if (!ctx) return;
    var t0 = ctx.currentTime + (o.at || 0);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }

  function noise(o) {
    if (!ctx) return;
    var t0 = ctx.currentTime + (o.at || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    var f = ctx.createBiquadFilter();
    f.type = o.ftype || 'lowpass'; f.frequency.value = o.freq || 1200; f.Q.value = o.q || 0.8;
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + o.dur + 0.05);
  }

  // ---- the repertoire: every beat of a fight, distinct -------------------
  var RECIPES = {
    click: function () { tone({ f0: 1900, dur: 0.03, gain: 0.10 }); },
    deny: function () {
      tone({ f0: 130, dur: 0.09, type: 'square', gain: 0.15 });
      tone({ f0: 98, dur: 0.1, type: 'square', gain: 0.13, at: 0.055 });
    },
    begin: function () { // the gate stirs
      tone({ f0: 98, f1: 196, dur: 0.5, type: 'triangle', gain: 0.30 });
      noise({ dur: 0.45, gain: 0.07, freq: 300, f1: 950, attack: 0.08 });
      tone({ f0: 392, dur: 0.22, gain: 0.10, at: 0.18 });
    },
    probe: function () {
      tone({ f0: 1318, f1: 1864, dur: 0.08, gain: 0.22 });
      noise({ dur: 0.03, gain: 0.05, ftype: 'highpass', freq: 4200 });
    },
    flood: function () {
      tone({ f0: 130, f1: 46, dur: 0.3, type: 'sawtooth', gain: 0.38 });
      noise({ dur: 0.3, gain: 0.32, freq: 950, f1: 180 });
    },
    whisper: function () {
      tone({ f0: 523, f1: 392, dur: 0.36, gain: 0.20, attack: 0.07 });
      noise({ dur: 0.32, gain: 0.045, ftype: 'highpass', freq: 2800, attack: 0.05 });
    },
    decoy: function () {
      tone({ f0: 392, dur: 0.16, type: 'triangle', gain: 0.20 });
      tone({ f0: 587, dur: 0.16, type: 'triangle', gain: 0.18, at: 0.07 });
      tone({ f0: 784, dur: 0.22, type: 'triangle', gain: 0.18, at: 0.14 });
      tone({ f0: 788, dur: 0.22, type: 'sine', gain: 0.07, at: 0.14 });
    },
    hit: function () { // your strike lands on the gate
      noise({ dur: 0.055, gain: 0.20, ftype: 'bandpass', freq: 1800, q: 1.1 });
      tone({ f0: 220, f1: 130, dur: 0.06, type: 'square', gain: 0.12 });
    },
    crack1: function () { crack(0.20, 3); },
    crack2: function () { crack(0.28, 4); },
    crack3: function () { crack(0.36, 6); },
    windup: function () { // the haymaker telegraph — a rising warning
      tone({ f0: 180, f1: 740, dur: 1.15, type: 'sawtooth', gain: 0.13, attack: 0.05 });
      tone({ f0: 90, f1: 370, dur: 1.15, type: 'square', gain: 0.05, attack: 0.05 });
    },
    parryArm: function () { tone({ f0: 1568, dur: 0.05, gain: 0.12 }); },
    parry: function () { // bright, satisfying — the gate hangs open
      [880, 1174, 1568, 2093].forEach(function (f, i) {
        tone({ f0: f, dur: 0.12, gain: 0.24, at: i * 0.055 });
      });
      noise({ dur: 0.16, gain: 0.05, ftype: 'highpass', freq: 6000 });
    },
    hitPlayer: function () { // a clean strike lands on you
      tone({ f0: 92, f1: 52, dur: 0.17, type: 'sawtooth', gain: 0.38 });
      noise({ dur: 0.12, gain: 0.28, freq: 520 });
    },
    haymakerHit: function () { // the big one connects
      tone({ f0: 72, f1: 36, dur: 0.38, type: 'sawtooth', gain: 0.52 });
      tone({ f0: 55, dur: 0.42, gain: 0.38 });
      noise({ dur: 0.32, gain: 0.42, freq: 720, f1: 140 });
    },
    scramble: function () { // a glance scrambles your tool — glitch stutter
      for (var i = 0; i < 5; i++) {
        tone({ f0: 950 - i * 150 + (i % 2) * 220, dur: 0.04, type: 'square', gain: 0.15, at: i * 0.045 });
      }
      noise({ dur: 0.12, gain: 0.10, ftype: 'bandpass', freq: 1300, q: 2 });
    },
    decoyEat: function () { // your decoy takes the hit
      noise({ dur: 0.18, gain: 0.24, freq: 620, f1: 240 });
      tone({ f0: 340, f1: 165, dur: 0.2, type: 'triangle', gain: 0.20 });
    },
    alarm: function () { // trace crosses 75%
      tone({ f0: 1046, dur: 0.09, type: 'square', gain: 0.19 });
      tone({ f0: 1046, dur: 0.09, type: 'square', gain: 0.19, at: 0.14 });
    },
    alarm2: function () { // trace crosses 90% — sharper
      [0, 0.1, 0.2].forEach(function (at) {
        tone({ f0: 1318, dur: 0.08, type: 'square', gain: 0.23, at: at });
      });
    },
    caught: function () { // trace complete — you are done
      tone({ f0: 392, f1: 46, dur: 0.8, type: 'sawtooth', gain: 0.42 });
      noise({ dur: 0.7, gain: 0.28, freq: 3000, f1: 160 });
      tone({ f0: 64, dur: 0.25, gain: 0.30, at: 0.72 });
    },
    breach: function () { // the gate breaks — explosion, then the sting
      noise({ dur: 0.6, gain: 0.48, freq: 2600, f1: 90 });
      tone({ f0: 66, f1: 30, dur: 0.62, gain: 0.40 });
      [523, 659, 784, 1046].forEach(function (f, i) {
        tone({ f0: f, dur: 0.3, type: 'triangle', gain: 0.24, at: 0.22 + i * 0.09 });
      });
    },
    thrownOut: function () {
      [196, 147, 98].forEach(function (f, i) {
        tone({ f0: f, dur: 0.24, type: 'triangle', gain: 0.28, at: i * 0.13 });
      });
    },
    defeat: function () { // turned back on time
      tone({ f0: 220, dur: 0.3, gain: 0.20 });
      tone({ f0: 165, dur: 0.42, gain: 0.20, at: 0.16 });
    },
    verdictWin: function () {
      tone({ f0: 784, dur: 0.13, gain: 0.17 });
      tone({ f0: 1046, dur: 0.24, gain: 0.17, at: 0.1 });
    },
    verdictLose: function () {
      tone({ f0: 392, dur: 0.15, gain: 0.14 });
      tone({ f0: 330, dur: 0.26, gain: 0.14, at: 0.11 });
    },
    evolve: function () {
      [659, 880, 1318].forEach(function (f, i) {
        tone({ f0: f, dur: 0.13, type: 'triangle', gain: 0.21, at: i * 0.08 });
      });
      tone({ f0: 1975, dur: 0.1, gain: 0.10, at: 0.24 });
    },
    // ---- Phase 3: the deck speaks -------------------------------------
    overdrive: function () { // one huge hit — a flood with a chest cavity
      tone({ f0: 60, f1: 220, dur: 0.28, type: 'sawtooth', gain: 0.42 });
      noise({ dur: 0.3, gain: 0.34, freq: 900, f1: 2400 });
      tone({ f0: 440, f1: 880, dur: 0.18, type: 'square', gain: 0.14, at: 0.05 });
    },
    ghost: function () { // traceless — a held breath, barely there
      tone({ f0: 1320, f1: 660, dur: 0.3, type: 'sine', gain: 0.10 });
      noise({ dur: 0.25, gain: 0.05, ftype: 'highpass', freq: 5000 });
    },
    secondWind: function () { // breath comes back — warm rising triad
      [392, 523, 659].forEach(function (f, i) {
        tone({ f0: f, dur: 0.2, type: 'triangle', gain: 0.20, at: i * 0.07 });
      });
    },
    modfire: function () { // MODS v1 — a heavy socket clunks home, then a spark
      tone({ f0: 180, f1: 90, dur: 0.07, type: 'square', gain: 0.2 });
      tone({ f0: 1500, f1: 2400, dur: 0.06, type: 'sawtooth', gain: 0.07, at: 0.05 });
    },
    rapid: function () { // cycling up — quickening ticks
      for (var i = 0; i < 6; i++) {
        tone({ f0: 700 + i * 130, dur: 0.045, type: 'square', gain: 0.13, at: i * (0.09 - i * 0.008) });
      }
    },
    combo: function () { // a combo lands — two notes snapping together
      tone({ f0: 988, dur: 0.07, type: 'square', gain: 0.16 });
      tone({ f0: 1480, dur: 0.12, type: 'square', gain: 0.18, at: 0.06 });
      noise({ dur: 0.08, gain: 0.08, ftype: 'bandpass', freq: 2400, q: 2, at: 0.05 });
    },
    morph: function () { // the armor sheds and re-forms — metal tearing, then a new hum-note
      noise({ dur: 0.4, gain: 0.30, ftype: 'bandpass', freq: 700, f1: 2600, q: 1.4 });
      tone({ f0: 140, f1: 55, dur: 0.35, type: 'sawtooth', gain: 0.30 });
      tone({ f0: 587, dur: 0.3, type: 'triangle', gain: 0.16, at: 0.32 });
      tone({ f0: 880, dur: 0.22, type: 'triangle', gain: 0.12, at: 0.4 });
    },
    feintReveal: function () { // cracked glass — the Wrap shows the lie
      noise({ dur: 0.09, gain: 0.22, ftype: 'bandpass', freq: 3400, q: 3 });
      tone({ f0: 2093, dur: 0.07, gain: 0.12, at: 0.02 });
      tone({ f0: 1568, dur: 0.09, gain: 0.10, at: 0.07 });
    },
    whiff: function () { // a parry bites air
      noise({ dur: 0.16, gain: 0.16, ftype: 'bandpass', freq: 1200, f1: 300, q: 1.2 });
    },
    heart: function () { // the Second Heart breaks — a crack, then a heartbeat
      noise({ dur: 0.08, gain: 0.3, ftype: 'bandpass', freq: 2000, q: 2 });
      tone({ f0: 58, dur: 0.16, gain: 0.5, at: 0.1 });
      tone({ f0: 52, dur: 0.2, gain: 0.44, at: 0.34 });
      tone({ f0: 523, dur: 0.24, type: 'triangle', gain: 0.14, at: 0.4 });
    },
    bell: function () { // the Stillbell — one clear struck bell, long tail
      tone({ f0: 1568, dur: 0.9, type: 'sine', gain: 0.22 });
      tone({ f0: 2093, dur: 0.6, type: 'sine', gain: 0.10, at: 0.01 });
      tone({ f0: 2637, dur: 0.35, type: 'sine', gain: 0.06, at: 0.02 });
    },
    drop: function () { // an item falls into the satchel — a soft chime
      tone({ f0: 1175, dur: 0.12, type: 'triangle', gain: 0.18 });
      tone({ f0: 1568, dur: 0.18, type: 'triangle', gain: 0.16, at: 0.08 });
    },
    legendary: function () { // a LEGENDARY drop — the full ceremony
      [523, 659, 784, 1046, 1318, 1568].forEach(function (f, i) {
        tone({ f0: f, dur: 0.34, type: 'triangle', gain: 0.22, at: i * 0.09 });
      });
      noise({ dur: 0.5, gain: 0.06, ftype: 'highpass', freq: 7000, at: 0.1 });
      tone({ f0: 2093, dur: 0.5, type: 'sine', gain: 0.12, at: 0.55 });
    },
    // ---- THE DESCENT's voices: lower, older, cathedral air ----------------
    lootSturdy: function () { // a pale beam — one plain note, honest and small
      tone({ f0: 392, dur: 0.16, type: 'triangle', gain: 0.16 });
      tone({ f0: 523, dur: 0.14, type: 'triangle', gain: 0.10, at: 0.07 });
    },
    lootRare: function () { // a blue beam — two notes, a step of hope
      tone({ f0: 494, dur: 0.16, type: 'triangle', gain: 0.18 });
      tone({ f0: 740, dur: 0.22, type: 'triangle', gain: 0.16, at: 0.09 });
    },
    lootEpic: function () { // a purple beam — a small chord, blooming
      [392, 587, 880].forEach(function (f, i) {
        tone({ f0: f, dur: 0.3, type: 'triangle', gain: 0.16, at: i * 0.06 });
      });
      tone({ f0: 1175, dur: 0.3, type: 'sine', gain: 0.08, at: 0.2 });
    },
    godforged: function () { // GODFORGED — the legendary ceremony, an octave deeper and a bell on top
      [262, 392, 523, 659, 784, 1046].forEach(function (f, i) {
        tone({ f0: f, dur: 0.5, type: 'triangle', gain: 0.22, at: i * 0.11 });
      });
      tone({ f0: 131, dur: 1.1, type: 'sine', gain: 0.20, at: 0 });
      tone({ f0: 1568, dur: 0.9, type: 'sine', gain: 0.14, at: 0.7 });
      tone({ f0: 2093, dur: 0.7, type: 'sine', gain: 0.08, at: 0.78 });
      noise({ dur: 0.7, gain: 0.05, ftype: 'highpass', freq: 7000, at: 0.2 });
    },
    boss: function () { // a boss's name-plate — a roar built from a falling saw and a drum of noise
      tone({ f0: 220, f1: 55, dur: 0.9, type: 'sawtooth', gain: 0.26 });
      tone({ f0: 110, f1: 41, dur: 1.1, type: 'square', gain: 0.14, at: 0.05 });
      noise({ dur: 0.7, gain: 0.12, ftype: 'lowpass', freq: 500, at: 0.02 });
      tone({ f0: 65, dur: 0.5, type: 'sine', gain: 0.24, at: 0.55 });
    },
    gatechoice: function () { // the gate stands open — two doors, two tones, a held breath between
      tone({ f0: 330, dur: 0.4, type: 'sine', gain: 0.16 });
      tone({ f0: 262, dur: 0.5, type: 'sine', gain: 0.14, at: 0.22 });
    },
    descend: function () { // down the stairs — a falling line, stone underfoot
      [392, 330, 262, 196].forEach(function (f, i) {
        tone({ f0: f, dur: 0.22, type: 'triangle', gain: 0.16, at: i * 0.11 });
      });
      noise({ dur: 0.3, gain: 0.05, ftype: 'lowpass', freq: 900, at: 0.1 });
    },
    ascend: function () { // up and out — the same stairs, climbed toward light
      [196, 262, 330, 392].forEach(function (f, i) {
        tone({ f0: f, dur: 0.22, type: 'triangle', gain: 0.16, at: i * 0.11 });
      });
      tone({ f0: 523, dur: 0.4, type: 'sine', gain: 0.12, at: 0.48 });
    },
    seize: function () { // THE CAPTOR takes your tool — a snatch: a rising grab and a lock clicking shut
      tone({ f0: 300, f1: 900, dur: 0.16, type: 'sawtooth', gain: 0.16 });
      noise({ dur: 0.08, gain: 0.14, ftype: 'bandpass', freq: 2600, q: 3, at: 0.14 });
      tone({ f0: 180, f1: 60, dur: 0.25, type: 'square', gain: 0.16, at: 0.16 });
    },
    twin: function () { // a tool won back TWINNED — one strike, sounded twice, in harmony
      tone({ f0: 659, dur: 0.18, type: 'triangle', gain: 0.18 });
      tone({ f0: 659, dur: 0.18, type: 'triangle', gain: 0.18, at: 0.13 });
      tone({ f0: 988, dur: 0.3, type: 'sine', gain: 0.12, at: 0.26 });
    },
    mercy: function () { // THE KEEPER'S MERCY — a single soft bell; the dark lets go
      tone({ f0: 1046, dur: 0.8, type: 'sine', gain: 0.20 });
      tone({ f0: 1568, dur: 0.5, type: 'sine', gain: 0.08, at: 0.03 });
      tone({ f0: 523, dur: 0.9, type: 'sine', gain: 0.10, at: 0.1 });
    },
    dawn: function () { // THE SECOND DAWN — a sunrise in three rising notes over a warm floor
      tone({ f0: 131, dur: 1.0, type: 'sine', gain: 0.16 });
      [262, 392, 523].forEach(function (f, i) {
        tone({ f0: f, dur: 0.55, type: 'triangle', gain: 0.16, at: 0.1 + i * 0.14 });
      });
      tone({ f0: 784, dur: 0.7, type: 'sine', gain: 0.10, at: 0.55 });
    }
  };
  function crack(gain, snaps) {
    for (var i = 0; i < snaps; i++) {
      noise({ dur: 0.03, gain: gain, ftype: 'bandpass', freq: 2300 + Math.random() * 1400, q: 2.5, at: i * 0.05 + Math.random() * 0.02, rate: 0.9 + Math.random() * 0.3 });
    }
    tone({ f0: 300, f1: 88, dur: 0.22, type: 'sawtooth', gain: gain * 0.8, at: 0.02 });
  }

  function play(name) {
    if (muted) return false;
    var c = unlock();
    if (!c) return false;
    var recipe = RECIPES[name];
    if (!recipe) return false;
    plays.push(name);
    if (plays.length > 600) plays.splice(0, plays.length - 600);
    try { recipe(); } catch (e) {}
    return true;
  }

  // ---- ambient hum (arena, during a fight) -------------------------------
  function humStart() {
    var c = unlock();
    if (!c || humNodes) return;
    try {
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(muted ? 0.0001 : 0.02, ctx.currentTime + 1.2);
      var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.6;
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      var lfoG = ctx.createGain(); lfoG.gain.value = 0.006;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      var nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true;
      var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 240;
      var ng = ctx.createGain(); ng.gain.value = 0.25;
      o1.connect(g); o2.connect(g);
      nz.connect(nf); nf.connect(ng); ng.connect(g);
      g.connect(master);
      o1.start(); o2.start(); lfo.start(); nz.start();
      humNodes = { g: g, oscs: [o1, o2, lfo, nz] };
    } catch (e) { humNodes = null; }
  }
  function humStop() {
    if (!ctx || !humNodes) { humNodes = null; return; }
    try {
      var h = humNodes, t = ctx.currentTime;
      h.g.gain.cancelScheduledValues(t);
      h.g.gain.setValueAtTime(h.g.gain.value, t);
      h.g.gain.linearRampToValueAtTime(0.0001, t + 0.35);
      h.oscs.forEach(function (o) { try { o.stop(t + 0.4); } catch (e) {} });
    } catch (e) {}
    humNodes = null;
  }

  // ---- mute: persisted, default ON, one state for every toggle -----------
  function syncButtons() {
    ['soundbtn', 'mutebtn'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.textContent = 'Sound: ' + (muted ? 'off' : 'on');
    });
  }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on'); } catch (e) {}
    if (master && ctx) {
      master.gain.setValueAtTime(muted ? 0 : 0.9, ctx.currentTime);
    }
    if (humNodes && ctx) {
      humNodes.g.gain.setValueAtTime(muted ? 0.0001 : 0.02, ctx.currentTime);
    }
    syncButtons();
  }
  function toggle() {
    setMuted(!muted);
    if (!muted) play('click'); // audible confirmation that sound is back
    return muted;
  }

  // The gesture net: any first tap/keypress anywhere wakes the audio.
  ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { unlock(); }, { capture: true, passive: true });
  });
  document.addEventListener('DOMContentLoaded', function () {
    ['soundbtn', 'mutebtn'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () { toggle(); });
    });
    syncButtons();
  });

  window.TASFX = {
    play: play, unlock: unlock, toggle: toggle, setMuted: setMuted,
    isMuted: function () { return muted; },
    humStart: humStart, humStop: humStop, syncButtons: syncButtons,
    plays: plays,
    _ctx: function () { return ctx; }
  };
})();
