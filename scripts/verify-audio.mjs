// THE TWIN ARENA — audio verification. Steven's bug: "there are no sound
// effects." Root cause was an AudioContext born inside a fetch callback and
// never resumed — silent forever on phones. This harness drives the REAL
// client (public/js/sfx.js + public/js/game.js) in a DOM stub against the
// REAL server, with an instrumented AudioContext, and asserts:
//   - the context is created and RESUMED synchronously inside the start tap;
//   - every fight beat actually sounds (tools, hit, wind-up, parry, scramble,
//     player hit, trace alarms, caught, crack stages, breach, verdict, hum);
//   - mute persists, defaults ON, and both toggles stay in sync;
//   - with no AudioContext at all, the game still runs and never throws.
// A silent no-op fails here by construction: plays are recorded only when a
// recipe really schedules oscillators/noise into a running context's graph.
// Usage: node scripts/verify-audio.mjs   (part of npm run verify)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4207;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-audio-'));

let failures = 0;
function check(name, cond, evidence) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? '  — ' + evidence : ''}`);
  if (!cond) failures++;
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
// The fight-start fetch makes a REAL network roundtrip to the throwaway
// server; poll real time until the client has digested it.
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); }
  return fn();
};

// ---------- instrumented WebAudio ------------------------------------------
let gestureDepth = 0;
const acLog = { constructed: 0, resumeCalls: [], oscStarts: [], oscStops: [] };
function resetAcLog() { acLog.constructed = 0; acLog.resumeCalls = []; acLog.oscStarts = []; acLog.oscStops = []; }
class FakeParam {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}
class FakeOsc {
  constructor() { this.type = 'sine'; this.frequency = new FakeParam(440); }
  connect() {} disconnect() {}
  start() { acLog.oscStarts.push({ freq: this.frequency.value, type: this.type }); }
  stop() { acLog.oscStops.push({ freq: this.frequency.value, type: this.type }); }
}
class FakeGain { constructor() { this.gain = new FakeParam(1); } connect() {} disconnect() {} }
let vnow = 0, rafQ = [];
class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.sampleRate = 44100; this.destination = {}; acLog.constructed++; }
  get currentTime() { return vnow / 1000; }
  resume() { acLog.resumeCalls.push({ duringGesture: gestureDepth > 0 }); this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  createOscillator() { return new FakeOsc(); }
  createGain() { return new FakeGain(); }
  createDynamicsCompressor() {
    return { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam(), connect() {} };
  }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() {
    return { buffer: null, loop: false, playbackRate: new FakeParam(1), connect() {},
      start() { acLog.oscStarts.push({ freq: -1, type: 'noise' }); },
      stop() { acLog.oscStops.push({ freq: -1, type: 'noise' }); } };
  }
  createBiquadFilter() { return { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1), connect() {} }; }
}

// ---------- DOM stub ---------------------------------------------------------
class ClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach(x => this.s.add(x)); }
  remove(...c) { c.forEach(x => this.s.delete(x)); }
  toggle(c, force) { const on = force === undefined ? !this.s.has(c) : !!force; if (on) this.s.add(c); else this.s.delete(c); return on; }
  contains(c) { return this.s.has(c); }
}
function makeCtx2d() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => grad;
      if (typeof p === 'string') return t[p] !== undefined ? t[p] : function () {};
      return undefined;
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}
class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.parent = null;
    this.classList = new ClassList();
    this.style = { setProperty() {} };
    this.dataset = {}; this.disabled = false; this.title = ''; this.id = '';
    this._listeners = {}; this._innerHTML = ''; this._text = ''; this.offsetWidth = 100;
    this._qs = new Map();
  }
  set innerHTML(v) { this._innerHTML = v; if (v === '') this.children = []; }
  get innerHTML() { return this._innerHTML; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(ev, arg = {}) {
    gestureDepth++;
    try { (this._listeners[ev] || []).slice().forEach(fn => fn(arg)); } finally { gestureDepth--; }
  }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  querySelector(sel) { if (!this._qs.has(sel)) this._qs.set(sel, new El('span')); return this._qs.get(sel); }
  closest() { return null; }
}
function makeDocument() {
  const byId = new Map();
  const ctx2d = makeCtx2d();
  const doc = {
    _listeners: {},
    addEventListener(ev, fn) { (doc._listeners[ev] ||= []).push(fn); },
    getElementById(id) {
      if (!byId.has(id)) {
        const el = new El(id === 'gate' ? 'canvas' : 'div');
        el.id = id;
        if (id === 'gate') { el.width = 900; el.height = 560; el.getContext = () => ctx2d; }
        byId.set(id, el);
      }
      return byId.get(id);
    },
    createElement(tag) { return new El(tag); },
    fire(ev, arg) { (doc._listeners[ev] || []).forEach(fn => fn(arg || {})); },
    _byId: byId
  };
  return doc;
}

// ---------- world builder ----------------------------------------------------
class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of set) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() { return [...this.c.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
}
const finishCalls = [];
function makeFetch(jar, opts) {
  return async (url, init = {}) => {
    if (url === '/api/fight/start') {
      const res = await fetch(BASE + url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar.header() }, body: init.body
      });
      jar.absorb(res);
      const d = await res.json();
      if (opts.strikes) d.strikes = opts.strikes;
      if (opts.gateHp) d.stats.gateHp = opts.gateHp;
      return { ok: res.ok, status: res.status, json: async () => d };
    }
    if (url === '/api/fight/finish') {
      finishCalls.push(JSON.parse(init.body || '{}'));
      return { ok: true, status: 200, json: async () => ({ verdict: opts.verdict }) };
    }
    throw new Error('unexpected fetch: ' + url);
  };
}
function makeWorld(opts = {}) {
  vnow = 0; rafQ = []; resetAcLog();
  const doc = makeDocument();
  const jar = new Jar();
  const ls = new Map(Object.entries(opts.localStorage || {}));
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => vnow },
    requestAnimationFrame: cb => { rafQ.push(cb); },
    localStorage: {
      getItem: k => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: k => ls.delete(k)
    },
    document: doc,
    navigator: { userAgent: 'verify-audio' },
    location: { reload() {}, href: 'http://x/arena' },
    TA_CHALLENGE: null
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  if (opts.audio !== false) sandbox.AudioContext = FakeAudioContext;
  sandbox.fetch = makeFetch(jar, opts);
  const context = vm.createContext(sandbox);
  for (const f of ['sfx.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8'), context, { filename: f });
  }
  doc.fire('DOMContentLoaded');
  return { sandbox, doc, jar, ls };
}
function pump(ms) {
  const end = vnow + ms;
  while (vnow < end) {
    vnow = Math.min(end, vnow + 16);
    rafQ.splice(0, rafQ.length).forEach(cb => cb(vnow));
  }
}
function toolBtn(doc, id) { return doc.getElementById('kit').children.find(c => c.id === 'tool-' + id); }

// ---------- boot the real server ----------------------------------------------
const server = spawn('node', ['src/server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_KEY: 'audio-test-key' },
  stdio: 'ignore'
});
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const r = await fetch(BASE + '/'); up = r.status === 200; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  check('throwaway server boots for the audio walk', up);

  // Static wiring: the real server must hand browsers the engine + toggle.
  const arenaHtml = await (await fetch(BASE + '/arena')).text();
  check('arena page loads /js/sfx.js', arenaHtml.includes('/js/sfx.js'));
  check('arena page carries the header sound toggle', arenaHtml.includes('id="soundbtn"'));
  const sfxRes = await fetch(BASE + '/js/sfx.js');
  const sfxText = await sfxRes.text();
  check('/js/sfx.js serves the engine', sfxRes.status === 200 && sfxText.includes('TASFX') && sfxText.includes('resume'), `status ${sfxRes.status}`);

  // ===== Scenario A: a full fight, every beat sounds ========================
  {
    const { sandbox, doc } = makeWorld({
      strikes: [
        { at: 4000, kind: 'haymaker' },
        { at: 9000, kind: 'glance', tool: 'flood' },
        { at: 14000, kind: 'clean' }
      ],
      gateHp: 100000, // the gate cannot break here — this scenario is the trace's
      verdict: { id: 'vA', result: 'lose', endReason: 'trace', points: 20, secs: 95, shapesTaughtCount: 2,
        fightStats: { integrityLeft: 92, tracePeak: 100, parries: 1, strikesTaken: 3 } }
    });
    const plays = sandbox.TASFX.plays;
    check('A: engine present, sound defaults ON', !!sandbox.TASFX && sandbox.TASFX.isMuted() === false);

    doc.getElementById('startbtn').dispatch('click');
    check('A: AudioContext created by the start tap', acLog.constructed >= 1, `constructed=${acLog.constructed}`);
    check('A: resume() called synchronously inside the tap gesture',
      acLog.resumeCalls.some(r => r.duringGesture), JSON.stringify(acLog.resumeCalls));
    await waitFor(() => doc.getElementById('kit').children.length === 4);
    check('A: fight began (kit built)', doc.getElementById('kit').children.length === 4,
      `tools=${doc.getElementById('kit').children.length}`);
    check('A: "begin" sounded as the gate stirred', plays.includes('begin'), plays.join(','));
    check('A: ambient hum started (55Hz oscillator running)',
      acLog.oscStarts.some(o => o.freq === 55 || o.freq === 55.6));

    toolBtn(doc, 'probe').dispatch('click');
    toolBtn(doc, 'flood').dispatch('click');
    toolBtn(doc, 'whisper').dispatch('click');
    toolBtn(doc, 'decoy').dispatch('click');
    for (const t of ['probe', 'flood', 'whisper', 'decoy', 'hit']) {
      check(`A: "${t}" sounded`, plays.includes(t), plays.join(','));
    }

    pump(2000);
    check('A: no wind-up warning before the telegraph opens', !plays.includes('windup'));
    pump(800); // elapsed ~2800 — inside the 1600ms wind-up of the 4000ms haymaker
    check('A: wind-up warning sounded as the haymaker telegraphed', plays.includes('windup'));
    doc.getElementById('parrybtn').dispatch('click');
    check('A: parry arm tick sounded', plays.includes('parryArm'));
    pump(1500); // past the strike — parried
    check('A: PARRY sounded when the haymaker was turned', plays.includes('parry'));
    pump(5000); // glance at 9000 resolves
    check('A: scramble sounded on the glancing hit', plays.includes('scramble'));
    pump(5000); // clean hit at 14000 resolves
    check('A: player-hit sounded on the clean strike', plays.includes('hitPlayer'));

    // Loud play to the trace's end: alarm at 75, sharper at 90, caught at 100.
    let cycles = 0;
    while (!plays.includes('caught') && cycles < 30) { toolBtn(doc, 'flood').dispatch('click'); pump(5000); cycles++; }
    check('A: trace alarm sounded crossing 75%', plays.includes('alarm'), `cycles=${cycles}`);
    check('A: sharper alarm sounded crossing 90%', plays.includes('alarm2'));
    check('A: CAUGHT sounded at trace 100%', plays.includes('caught'));
    await settle();
    check('A: verdict chime sounded (lose)', plays.includes('verdictLose'));
    check('A: hum stopped when the fight ended', acLog.oscStops.some(o => o.freq === 55 || o.freq === 55.6));
    check('A: the context actually produced sound (oscillator starts > 20)',
      acLog.oscStarts.length > 20, `starts=${acLog.oscStarts.length}`);
  }

  // ===== Scenario B: cracking stages and the breach ==========================
  {
    const { sandbox, doc } = makeWorld({
      strikes: [],
      gateHp: 26, // two floods from broken
      verdict: { id: 'vB', result: 'win', endReason: 'breach', points: 65, secs: 28, shapesTaughtCount: 2,
        fightStats: { integrityLeft: 100, tracePeak: 28, parries: 0, strikesTaken: 0 } }
    });
    const plays = sandbox.TASFX.plays;
    doc.getElementById('startbtn').dispatch('click');
    await waitFor(() => doc.getElementById('kit').children.length === 4);
    toolBtn(doc, 'flood').dispatch('click'); // 26 -> 13: half the gate gone
    check('B: crack sounded as the gate crossed half integrity',
      plays.includes('crack2') || plays.includes('crack1'), plays.join(','));
    let tries = 0;
    while (!plays.includes('breach') && tries < 6) { pump(4200); toolBtn(doc, 'flood').dispatch('click'); tries++; }
    check('B: final crack stage sounded (25%)', plays.includes('crack3'), plays.join(','));
    check('B: BREACH sounded as the gate broke', plays.includes('breach'));
    await settle();
    check('B: verdict chime sounded (win)', plays.includes('verdictWin'));
  }

  // ===== Scenario C: mute — persisted, default-on, toggles in sync ===========
  {
    const { sandbox, doc, ls } = makeWorld({
      strikes: [], verdict: { id: 'vC', result: 'lose', endReason: 'timeout', points: 10, secs: 150, shapesTaughtCount: 0, fightStats: null },
      localStorage: { 'ta-sound': 'off' }
    });
    const plays = sandbox.TASFX.plays;
    check('C: stored "off" starts muted', sandbox.TASFX.isMuted() === true);
    check('C: header toggle label reads off', doc.getElementById('soundbtn').textContent === 'Sound: off',
      doc.getElementById('soundbtn').textContent);
    doc.getElementById('startbtn').dispatch('click');
    await waitFor(() => doc.getElementById('kit').children.length === 4);
    check('C: fight still begins while muted', doc.getElementById('kit').children.length === 4);
    toolBtn(doc, 'probe').dispatch('click');
    check('C: nothing sounds while muted', !plays.includes('begin') && !plays.includes('probe'), plays.join(',') || '(silent)');
    doc.getElementById('soundbtn').dispatch('click'); // toggle back ON
    check('C: toggle un-mutes and persists "on"', sandbox.TASFX.isMuted() === false && ls.get('ta-sound') === 'on');
    check('C: both toggles agree (arena button too)', doc.getElementById('mutebtn').textContent === 'Sound: on',
      doc.getElementById('mutebtn').textContent);
    toolBtn(doc, 'flood').dispatch('click');
    check('C: sounds return after un-muting', plays.includes('flood'));
    doc.getElementById('mutebtn').dispatch('click'); // arena toggle mutes again
    check('C: arena toggle mutes, header agrees', sandbox.TASFX.isMuted() === true &&
      doc.getElementById('soundbtn').textContent === 'Sound: off');
  }

  // ===== Scenario D: no WebAudio at all — the game must not break ============
  {
    let threw = null;
    try {
      const { doc } = makeWorld({ audio: false, strikes: [], verdict: { id: 'vD', result: 'lose', endReason: 'timeout', points: 10, secs: 150, shapesTaughtCount: 0, fightStats: null } });
      doc.getElementById('startbtn').dispatch('click');
      await waitFor(() => doc.getElementById('kit').children.length === 4);
      toolBtn(doc, 'probe').dispatch('click');
      pump(1000);
      check('D: without AudioContext the fight still begins and plays',
        doc.getElementById('kit').children.length === 4);
    } catch (e) { threw = e; }
    check('D: no exception without WebAudio', !threw, threw && threw.message);
  }
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} audio check(s) FAILED` : '\nAll audio checks passed.');
process.exit(failures ? 1 : 0);
