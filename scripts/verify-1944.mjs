// THE GALACTIC — 1944 FORM (Phase 1 complete): the scrolling sky, proven.
//
// The claims under test:
//   1. The client's SCROLL-MATH block is the server's own math, verbatim —
//      the preview and the referee can never drift apart.
//   2. All 8 stages of Sector 1 exist as full stretches: distinct names,
//      motifs and wave tables; deterministic per seed; only Stage 8 seats
//      THE HERALD.
//   3. The sky adapts to the pilot: a veteran's stage carries more hulls
//      at higher aggression than a rookie's, and the Twin counter-weights
//      the formations against the tool this pilot leans on.
//   4. The referee replays honestly: a planner-flown log clears Stage 1
//      and kills the Herald through all three phases; activations burn
//      for their dealt time and expire; COLD SNAP slows the sky's clock.
//   5. Forgery voids: teleports, unowned mods, spent charges, and a boss
//      log that ends before the Herald falls all fail to stand.
//   6. Over HTTP the whole Phase 1 walks end to end in 1944 form — stage
//      gating holds (no skipping), the first-clear receipt fires exactly
//      once (THE LEDGER'S SEAL; Sector 2's lock takes the captain's name),
//      and the wheel battle + classic deck stand untouched beside it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const game = require('../src/game.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. client/server math parity
// ---------------------------------------------------------------------------
console.log('\n— the mirrored math —');
function mathBlock(file) {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', file), 'utf8');
  const b = src.indexOf('SCROLL-MATH-BEGIN'), e = src.indexOf('SCROLL-MATH-END');
  if (b < 0 || e < 0) return null;
  return src.slice(b, e)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ').trim();
}
const srvMath = mathBlock('src/scroll.js');
const cliMath = mathBlock('public/js/galactic-scroll.js');
check('the server carries a SCROLL-MATH block', !!srvMath);
check('the client carries a SCROLL-MATH block', !!cliMath);
check('client math === server math (verbatim, comments aside)', srvMath === cliMath,
  srvMath && cliMath ? `server ${srvMath.length} chars vs client ${cliMath.length}` : 'missing block');

// ---------------------------------------------------------------------------
// 2–3. the eight stages + adaptive waves (engine, in-process)
// ---------------------------------------------------------------------------
console.log('\n— eight stages, dealt skies —');
const CTX_VET = { level: 6, attention: 40, dominantTool: 'flood', weakestTool: 'decoy', rookie: false };
const CTX_ROOKIE = { level: 1, attention: 0, dominantTool: 'flood', weakestTool: 'decoy', rookie: true };
const names = new Set(), motifs = new Set();
let allDeterministic = true, onlyBossAt8 = true, durationsOk = true;
for (let n = 1; n <= 8; n++) {
  const a = game.makeScrollWaves(4242, n, CTX_VET);
  const b = game.makeScrollWaves(4242, n, CTX_VET);
  const c = game.makeScrollWaves(999, n, CTX_VET);
  if (JSON.stringify(a) !== JSON.stringify(b)) allDeterministic = false;
  if (JSON.stringify(a) === JSON.stringify(c)) allDeterministic = false;
  if ((n === 8) !== !!a.boss) onlyBossAt8 = false;
  if (!(a.durationMs >= 60000)) durationsOk = false;
  names.add(a.stage.name); motifs.add(a.stage.motif);
}
check('all 8 stages: same seed deals the identical sky, another seed deals another', allDeterministic);
check('all 8 stages have distinct names', names.size === 8, [...names].join(' · '));
check('the stages wear at least five distinct motifs', motifs.size >= 5, [...motifs].join(' · '));
check('THE HERALD seats Stage 8 only', onlyBossAt8);
check('every stage is a real stretch (>= 60s)', durationsOk);

const s1r = game.makeScrollWaves(4242, 1, CTX_ROOKIE);
const s1v = game.makeScrollWaves(4242, 1, CTX_VET);
check('a rookie sky is gentler: fewer hulls than the veteran\'s same stage',
  s1r.spawns.length < s1v.spawns.length, `rookie ${s1r.spawns.length} vs vet ${s1v.spawns.length}`);
check('a rookie sky is gentler: lower aggression', s1r.aggression < s1v.aggression,
  `${s1r.aggression} vs ${s1v.aggression}`);
const domFlood = game.makeScrollWaves(777, 5, { ...CTX_VET, dominantTool: 'flood' });
const domProbe = game.makeScrollWaves(777, 5, { ...CTX_VET, dominantTool: 'probe' });
const countCls = (w, cls) => w.spawns.filter(s => s.cls === cls).length;
check('she counter-weights the pilot\'s habit: a flood pilot meets more darts (EMBERLINE\'s nemesis) than a probe pilot does',
  countCls(domFlood, 'dart') > countCls(domProbe, 'dart'),
  `flood ${countCls(domFlood, 'dart')} darts vs probe ${countCls(domProbe, 'dart')}`);
const clearedCtx = game.makeScrollWaves(4242, 3, { ...CTX_VET, cleared: true });
const unclearedCtx = game.makeScrollWaves(4242, 3, CTX_VET);
check('a cleared sector flies quieter for its clearer (fewer hulls in the same sky)',
  clearedCtx.spawns.length < unclearedCtx.spawns.length,
  `${clearedCtx.spawns.length} vs ${unclearedCtx.spawns.length}`);

// ---------------------------------------------------------------------------
// 4–5. the referee: honest logs stand, forged logs void (engine, in-process)
// ---------------------------------------------------------------------------
console.log('\n— the scroll referee —');
function fakePlayer(id, extra = {}) {
  return {
    id, email: id + '@x.io', displayName: id, photo: null, points: 0,
    nodes: {}, shapes: {}, twinArmor: {}, challengeToken: 'tok-' + id,
    record: { bouts: 0, breaches: 0, streak: 0, bestSecs: null },
    challengeFeed: [], publicProfile: true, createdAt: 1, lastFightAt: null,
    xp: 0, toolUse: {}, parriesTotal: 0, taunt: '', devilShapes: {},
    gear: [], modsOwned: {}, modsFitted: { probe: null, flood: null, whisper: null, decoy: null },
    galactic: { sorties: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, capitalsSlain: 0, cleared: {}, sectors: {} },
    ...extra
  };
}
const ALL_MODS = { throughline: true, emberline: true, ashenveil: true, paybackcoil: true, overclock: true, tracepurge: true, ghostplate: true, coldsnap: true };
const vetPilot = fakePlayer('vet', {
  xp: 750, toolUse: { flood: 200, whisper: 90, probe: 60, decoy: 20 },
  nodes: { vec1: true, vec2: true, vec3: true, dec2: true, pat1: true, pat2: true, spd1: true, spd2: true, spd3: true },
  modsOwned: { ...ALL_MODS },
  modsFitted: { probe: 'throughline', flood: 'emberline', whisper: 'ashenveil', decoy: 'paybackcoil' }
});
const rookiePilot = fakePlayer('rookie', { nodes: { spd1: true, spd2: true, vec1: true } });
function dealtFor(pilot, ctx, hull) {
  return game.scrollDealt(pilot, { hullMax: hull || 100, startHull: hull || 100, startTrace: 0, teachTool: 'flood' });
}
// The planner: greedy branch search over the cloneable stepper — the same
// honest-pilot instrument the wheel battle's suite flies.
function planScroll(fight) {
  planScroll.lastTarget = null;
  const waves = fight.scroll.waves;
  const stepper = game.createScrollStepper(fight);
  const S = stepper.state;
  const log = [{ t: 0, tool: 'fire', on: true }];
  let ocCount = 0;
  const DECIDE = 150, LOOK = 800;
  function evalBranch(cand) {
    const clone = structuredClone(S);
    const branch = game.createScrollStepper(fight, clone);
    branch.advanceTo(log.concat([{ t: S.t, tool: 'mv', x: cand.x, y: cand.y }]), S.t + LOOK);
    if (clone.problem) return -10000;
    let score = (clone.hull - S.hull) * -68 + (clone.kills - S.kills) * 5 + (clone.score - S.score) * 0.015;
    if (clone.outcome && clone.outcome.result === 'lose') score -= 5000;
    let minD = 999;
    for (const b of clone.ebullets) minD = Math.min(minD, Math.hypot(b.x - clone.ship.x, b.y - clone.ship.y));
    score += Math.min(minD, 170) * 0.09;
    // commitment: a pilot who jitters crosses every stream twice — the
    // last chosen lane keeps a small incumbency until it stops paying
    if (planScroll.lastTarget && Math.hypot(cand.x - planScroll.lastTarget.x, cand.y - planScroll.lastTarget.y) < 14) score += 5;
    if (clone.pickups.length) {
      let pkD = 9999;
      for (const pk of clone.pickups) pkD = Math.min(pkD, Math.hypot(pk.x - clone.ship.x, pk.y - clone.ship.y));
      score -= pkD * 0.03;
    }
    return score;
  }
  while (!S.outcome && !S.problem && S.t < waves.durationMs) {
    const td = S.t;
    if (S.charges.overclock > 0 && td >= S.overclockUntil && td >= 1200 &&
        (waves.boss ? S.bossHp > 0 : (ocCount === 0 || td > waves.durationMs * 0.5))) {
      log.push({ t: td, tool: 'mod:overclock' }); ocCount++;
    }
    const danger = S.ebullets.some(b => Math.hypot(b.x - S.ship.x, b.y - S.ship.y) < 115);
    if (S.charges.ghostplate > 0 && td >= S.ghostUntil &&
        (danger || (S.hull < 45 && S.ebullets.length >= 3))) log.push({ t: td, tool: 'mod:ghostplate' });
    if (S.charges.tracepurge > 0 &&
        (S.ebullets.length >= 5 || (S.trace >= 85 && S.ebullets.length >= 3))) log.push({ t: td, tool: 'mod:tracepurge' });
    if (S.charges.coldsnap > 0 && td >= S.snapUntil &&
        ((waves.boss && S.bossPhase === 3) || S.ebullets.length >= 6)) log.push({ t: td, tool: 'mod:coldsnap' });

    let wantFire = !!(waves.boss && S.bossHp > 0);
    if (!wantFire) {
      for (let i = 0; i < waves.spawns.length; i++) {
        if (S.enemyGone[i] || S.enemyHp[i] <= 0 || waves.spawns[i].at > S.et) continue;
        const p = game.scrollEnemyPos(waves.spawns[i], S.et);
        if (p && Math.abs(p.x - S.ship.x) < 74 && p.y < S.ship.y) { wantFire = true; break; }
      }
    }
    if (wantFire !== S.firing) log.push({ t: td, tool: 'fire', on: wantFire });
    const cands = [];
    for (const x of [44, 104, 164, 200, 236, 296, 356]) for (const y of [470, 545, 590]) cands.push({ x, y });
    cands.push({ x: Math.round(S.ship.x), y: Math.round(S.ship.y) });
    // the repulsion pick: the lane farthest from every live bullet — the
    // simple pilot's whole doctrine, offered to the branch search as one
    // honest candidate among the hunters
    {
      let bx = 200, by = 560, bScore = -1e9;
      for (const c of cands) {
        let d = 999;
        for (const b of S.ebullets) d = Math.min(d, Math.hypot(b.x - c.x, b.y - c.y));
        const sc = Math.min(d, 170) - Math.hypot(S.ship.x - c.x, S.ship.y - c.y) * 0.12;
        if (sc > bScore) { bScore = sc; bx = c.x; by = c.y; }
      }
      cands.push({ x: bx, y: by });
    }
    const hunts = [];
    for (let i = 0; i < waves.spawns.length && hunts.length < 4; i++) {
      if (S.enemyGone[i] || S.enemyHp[i] <= 0 || waves.spawns[i].at > S.et) continue;
      const p = game.scrollEnemyPos(waves.spawns[i], S.et);
      if (p && p.y > 0 && p.y < 420) hunts.push(p.x);
    }
    if (waves.boss && S.bossHp > 0) hunts.push(game.scrollHeraldPos(S.et).x);
    for (const hx of hunts) for (const y of [500, 560]) cands.push({ x: Math.round(Math.max(20, Math.min(380, hx))), y });
    let best = null, bestScore = -Infinity;
    for (const c of cands) { const sc = evalBranch(c); if (sc > bestScore) { bestScore = sc; best = c; } }
    planScroll.lastTarget = best;
    log.push({ t: td, tool: 'mv', x: best.x, y: best.y });
    stepper.advanceTo(log, td + DECIDE);
  }
  return { log, sim: game.simulateScroll(fight, log, waves.durationMs) };
}

const fight1 = { scroll: { waves: game.makeScrollWaves(4242, 1, CTX_ROOKIE), dealt: dealtFor(rookiePilot, CTX_ROOKIE) } };
const plan1 = planScroll(fight1);
check('an honest log clears Stage 1 (rookie sky, rookie ship)',
  plan1.sim.outcome && plan1.sim.outcome.result === 'win' && plan1.sim.outcome.endReason === 'scroll',
  JSON.stringify(plan1.sim.outcome) + ' problem=' + plan1.sim.problem);
check('the Stage 1 log teaches as it flies (the Twin learns the gun)', plan1.sim.teachActions.length > 10,
  String(plan1.sim.teachActions.length));

const fight8 = { scroll: { waves: game.makeScrollWaves(778, 8, CTX_VET), dealt: dealtFor(vetPilot, CTX_VET) } };
const plan8 = planScroll(fight8);
check('an honest log kills THE HERALD (win by capital)',
  plan8.sim.outcome && plan8.sim.outcome.result === 'win' && plan8.sim.outcome.endReason === 'capital',
  JSON.stringify(plan8.sim.outcome) + ' bossHp=' + plan8.sim.bossHpLeft + ' problem=' + plan8.sim.problem);
check('the Herald fight runs all three phases', JSON.stringify(plan8.sim.phasesSeen) === '[1,2,3]',
  JSON.stringify(plan8.sim.phasesSeen));
check('the fitted sky flies wing ships (Galaga\'s double-ship, earned)', fight8.scroll.dealt.wings === 2);
check('near-misses register in the honest boss log', plan8.sim.nearMisses > 0, String(plan8.sim.nearMisses));

// activation timing + expiry + the slowed sky
{
  const fight = { scroll: { waves: game.makeScrollWaves(55, 2, CTX_VET), dealt: dealtFor(vetPilot, CTX_VET) } };
  const st = game.createScrollStepper(fight);
  st.advanceTo([{ t: 500, tool: 'mod:coldsnap' }, { t: 1000, tool: 'mod:overclock' }], 2100);
  check('ACTIVATE starts the burn: overclock runs to its dealt limit (1000 + 8000)',
    st.state.overclockUntil === 9000, String(st.state.overclockUntil));
  check('COLD SNAP slows the sky\'s clock, not the pilot\'s (1600ms of sky at half rate)',
    st.state.et < st.state.t - 500 && st.state.et > st.state.t - 1100,
    `et=${st.state.et} t=${st.state.t}`);
  st.advanceTo([], 9050);
  check('the burn expires on schedule', st.state.overclockUntil <= st.state.t && st.state.t >= 9000,
    `until=${st.state.overclockUntil} t=${st.state.t}`);
}
// forgery, at the engine
{
  const base = () => ({ scroll: { waves: game.makeScrollWaves(4242, 1, CTX_ROOKIE), dealt: dealtFor(rookiePilot, CTX_ROOKIE) } });
  const tp = game.simulateScroll(base(), [{ t: 0, tool: 'mv', x: 30, y: 260 }, { t: 100, tool: 'mv', x: 370, y: 260 }], 1000);
  check('a teleport voids the log', tp.problem === 'impossible movement', String(tp.problem));
  const unowned = game.simulateScroll(base(), [{ t: 100, tool: 'mod:overclock' }], 1000);
  check('activating a mod the pilot does not own voids the log', unowned.problem === 'mod not owned', String(unowned.problem));
  const f8 = { scroll: { waves: game.makeScrollWaves(778, 8, CTX_VET), dealt: dealtFor(vetPilot, CTX_VET) } };
  const spent = game.simulateScroll(f8, [
    { t: 100, tool: 'mod:overclock' }, { t: 200, tool: 'mod:overclock' }, { t: 300, tool: 'mod:overclock' }
  ], 1000);
  check('a third activation on two charges voids the log', spent.problem === 'mod charges spent', String(spent.problem));
  const truncAt = Math.max(5000, plan8.sim.outcome.at - 5000);
  const truncated = game.simulateScroll(
    { scroll: { waves: f8.scroll.waves, dealt: f8.scroll.dealt } },
    plan8.log.filter(a => a.t < truncAt), truncAt);
  check('a boss log that ends before the Herald falls has no outcome to claim',
    truncated.outcome === null && !truncated.problem, JSON.stringify(truncated.outcome));
}
// the first-clear receipt fires exactly once (the sortie book, in-process)
{
  const st = {
    config: { aggression: 1, learningSpeed: 1, floodgates: false, stormUntil: 0 },
    shapesGlobal: {}, globalArmor: {}, players: {}, verdicts: {}, fights: [],
    galactic: { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} }
  };
  const cap = fakePlayer('cap', { xp: 100 });
  st.players.cap = cap;
  const mkSortie = () => ({
    id: 's' + Math.random(), playerId: 'cap', sectorId: 1, seed: 5, encounter: 8,
    encountersCleared: 8, deepest: 8, score: 900, xp: 0, haul: [], bankedValue: 0,
    capitalsSlain: 1, sectorCleared: true, integrity: 40, trace: 10, toolUseRun: {},
    awaitingChoice: false, over: false, startedAt: 1
  });
  const v1 = game.finishGalacticSortie(st, cap, mkSortie(), 'cleared');
  const v2 = game.finishGalacticSortie(st, cap, mkSortie(), 'cleared');
  check('the first clear writes THE LEDGER\'S SEAL receipt', v1.galactic.firstClear === true && !!st.galactic.firstClear['1']);
  check('the receipt fires exactly once — a second clear does not rewrite it',
    v2.galactic.firstClear === false && st.galactic.firstClear['1'].playerId === 'cap');
}

// ---------------------------------------------------------------------------
// 6. over HTTP: the whole Phase 1, walked in 1944 form
// ---------------------------------------------------------------------------
console.log('\n— the live walk —');
const PORT = 3216, BASE = 'http://127.0.0.1:' + PORT, ADMIN = 'verify44-admin';
class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) {
      const [pair] = line.split(';'); const i = pair.indexOf('=');
      if (i > 0) this.c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() { return [...this.c].map(([k, v]) => k + '=' + v).join('; '); }
}
async function call(jar, method, url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (jar && jar.c.size) headers.Cookie = jar.header();
  const res = await fetch(BASE + url, { method, headers, body: opts.body, redirect: 'manual' });
  if (jar) jar.absorb(res);
  return res;
}
async function json(jar, method, url, body) {
  const res = await call(jar, method, url, {
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function text(jar, url) {
  const res = await call(jar, 'GET', url);
  return { status: res.status, body: await res.text() };
}
const today = game.dayKey(Date.now());
function seedPlayer(id, name, xp, createdAt, extra = {}) {
  return {
    id, email: id + '@f44.test', pass: null, displayName: name, photo: null,
    points: 0, nodes: {}, shapes: {}, twinArmor: {}, challengeToken: 'tok-' + id,
    record: { bouts: 3, breaches: 1, streak: 0, bestSecs: null },
    challengeFeed: [], publicProfile: true, createdAt, lastFightAt: null,
    xp, toolUse: {}, parriesTotal: 0, taunt: '', devilShapes: {},
    devil: { bounty: 25, bountyDay: today, held: 0, breached: 0, lastBreachedBy: null, breachedBy: [], holdStreak: 0 },
    pitAttack: { bouts: 0, breaches: 0 },
    itemStock: {}, itemHistory: [], pitAttempts: {},
    defenseXpDay: { day: today, count: 0 },
    gear: [], descent: { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 },
    galactic: { sorties: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, capitalsSlain: 0, cleared: {}, sectors: {} },
    modsOwned: {}, modsFitted: { probe: null, flood: null, whisper: null, decoy: null },
    ...extra
  };
}
const seedPlayers = {
  keeper1: seedPlayer('keeper1', 'Keeper', 0, 1, { email: 'stevenh18818@gmail.com', isOwner: true }),
  cap44: seedPlayer('cap44', 'Cap44', 500, 2, {
    nodes: { vec1: true, vec2: true, vec3: true, dec2: true, pat1: true, pat2: true, spd1: true, spd2: true, spd3: true },
    toolUse: { flood: 200, whisper: 90, probe: 60, decoy: 20 },
    modsOwned: { ...ALL_MODS },
    modsFitted: { probe: 'throughline', flood: 'emberline', whisper: 'ashenveil', decoy: 'paybackcoil' }
  }),
  rook44: seedPlayer('rook44', 'Rook44', 0, 3, { nodes: { spd1: true, spd2: true, vec1: true, pat1: true } })
};
const seedSessions = {};
for (const id of Object.keys(seedPlayers)) seedSessions['sess-' + id] = id;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-1944-'));
fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
  config: { aggression: 1, learningSpeed: 1, frozen: false, stormUntil: 0, broadcast: null, floodgates: false, spotlight: null },
  deck: { memberTieHash: null, ownerPlayerId: 'keeper1' },
  deckSessions: {}, players: seedPlayers, sessions: seedSessions,
  shapesGlobal: {}, globalArmor: {}, pit: { bouts: 0, holds: 0, breaches: 0 },
  descent: { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 },
  galactic: { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} },
  gearSeq: { _inst: 50 }, itemsSeq: { mirrorwrap: 0, anchorstitch: 0, secondheart: 0, stillbell: 0, foundersember: 0 },
  keeperSetGranted: false, fights: [], fightSeq: 0, verdicts: {}
}));
const jarFor = id => { const j = new Jar(); j.c.set('ta_sess', 'sess-' + id); return j; };
const server = spawn('node', ['src/server.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT), ADMIN_KEY: ADMIN, DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) return true; } catch {}
    await sleep(200);
  }
  return false;
}
try {
  check('the seeded server boots', await waitUp());
  const capJar = jarFor('cap44'), rookJar = jarFor('rook44');

  const flyPage = await text(capJar, '/galactic/fly?form=scroll');
  check('the 1944 page serves (FLY THE CLIMB + the scroll client)',
    flyPage.status === 200 && flyPage.body.includes('FLY THE CLIMB') && flyPage.body.includes('galactic-scroll.js'));
  check('the build stamp names the 1944 build', flyPage.body.includes('2026.11.27-galactic-1944'));
  const clientJs = await text(capJar, '/js/galactic-scroll.js');
  check('the scroll client serves with its mirrored math',
    clientJs.status === 200 && clientJs.body.includes('SCROLL-MATH-BEGIN') && clientJs.body.includes('ACTIVATE'));
  const rtPage = await text(capJar, '/galactic/fly');
  check('the wheel battle stands beside it, untouched', rtPage.status === 200 && rtPage.body.includes('galactic-rt.js'));
  check('the pad offers the 1944 form', rtPage.body.includes('/galactic/fly?form=scroll'));
  const mapPage = await text(capJar, '/galactic');
  check('the star map offers the 1944 form', mapPage.body.includes('FLY IT AS 1944'));
  const classicPage = await text(capJar, '/galactic/fly?classic=1');
  check('the classic deck stands too', classicPage.status === 200 && classicPage.body.includes('galactic.js'));

  // gating: no choice stands open on a fresh sortie; stage 1 is the door
  const start = await json(capJar, 'POST', '/api/galactic/start', { form: 'scroll' });
  check('a scroll sortie starts', start.status === 200 && !!start.body.scroll, JSON.stringify(start.body).slice(0, 160));
  check('a fresh sortie always opens at Stage 1', start.body.scroll && start.body.scroll.stage.n === 1 &&
    start.body.galactic.encounter === 1, JSON.stringify(start.body.scroll && start.body.scroll.stage));
  check('the dealt sky is in the payload (waves + dealt, server-side)',
    !!(start.body.scroll.waves && start.body.scroll.waves.spawns.length > 10 && start.body.scroll.dealt));
  const early = await json(capJar, 'POST', '/api/galactic/choose', { sortieId: start.body.galactic.sortieId, choice: 'press' });
  check('stage gating: choose before a clear is refused (409)', early.status === 409, String(early.status));

  // forgery over HTTP voids and teaches nothing
  const forged = await json(capJar, 'POST', '/api/fight/finish', {
    fightId: start.body.fightId,
    actions: [{ t: 0, tool: 'mv', x: 30, y: 260 }, { t: 100, tool: 'mv', x: 370, y: 260 }],
    durationMs: 1000
  });
  check('a forged flight voids over HTTP', !!forged.body.voided && forged.body.verdict.endReason === 'void',
    JSON.stringify(forged.body).slice(0, 160));

  // the rookie's sky, dealt over HTTP
  const rStart = await json(rookJar, 'POST', '/api/galactic/start', { form: 'scroll' });
  check('the rookie is dealt a gentler sky than the captain\'s',
    rStart.body.scroll.waves.spawns.length < start.body.scroll.waves.spawns.length,
    `rookie ${rStart.body.scroll.waves.spawns.length} vs captain ${start.body.scroll.waves.spawns.length}`);
  check('the rookie carries no deployable charges (nothing owned, nothing dealt)',
    Object.keys(rStart.body.scroll.dealt.deploy).length === 0, JSON.stringify(rStart.body.scroll.dealt.deploy));
  await json(rookJar, 'POST', '/api/galactic/abandon', { sortieId: rStart.body.galactic.sortieId });

  // the full walk: eight stages, one sortie, the Herald at the top
  let payload = (await json(capJar, 'POST', '/api/galactic/start', { form: 'scroll' })).body;
  let walkOk = true, walkNote = '', finalBody = null;
  for (let stage = 1; stage <= 8; stage++) {
    if (!payload.scroll || payload.scroll.stage.n !== stage) { walkOk = false; walkNote = `stage gate broke at ${stage}: got ${payload.scroll && payload.scroll.stage.n}`; break; }
    const fight = { scroll: { waves: payload.scroll.waves, dealt: payload.scroll.dealt } };
    const plan = planScroll(fight);
    if (!plan.sim.outcome || plan.sim.outcome.result !== 'win') {
      walkOk = false; walkNote = `planner lost stage ${stage}: ${JSON.stringify(plan.sim.outcome)} hull=${plan.sim.hullLeft}`; break;
    }
    const fin = await json(capJar, 'POST', '/api/fight/finish', {
      fightId: payload.fightId, actions: plan.log, durationMs: plan.sim.outcome.at
    });
    if (fin.body.voided) { walkOk = false; walkNote = `stage ${stage} voided: ${fin.body.voided}`; break; }
    finalBody = fin.body;
    if (stage === 1) {
      var repairExpect = Math.min(payload.scroll.dealt.hullMax, plan.sim.hullLeft + Math.round(payload.scroll.dealt.hullMax * 0.35));
      var repairSeen = fin.body.galactic.integrity;
    }
    if (stage < 8) {
      if (!(fin.body.galactic.over === false && fin.body.galactic.state === 'choice')) {
        walkOk = false; walkNote = `no choice offered after stage ${stage}: ${JSON.stringify(fin.body.galactic).slice(0, 140)}`; break;
      }
      const ch = await json(capJar, 'POST', '/api/galactic/choose', { sortieId: payload.galactic.sortieId, choice: 'press' });
      if (ch.status !== 200) { walkOk = false; walkNote = `press refused after stage ${stage}: ${ch.status}`; break; }
      payload = ch.body;
    }
  }
  check('the full Phase 1 walks in 1944 form — 8 stages, one sortie, no skipping', walkOk, walkNote);
  check('a cleared stretch buys a patchwork breather (35% of hull) for the next climb',
    typeof repairSeen === 'number' && repairSeen === repairExpect,
    `integrity after stage 1: ${repairSeen}, expected ${repairExpect}`);
  check('the walk ends with the sector cleared', !!(finalBody && finalBody.galactic.sectorCleared),
    JSON.stringify(finalBody && finalBody.galactic).slice(0, 200));
  check('the first-clear receipt rides the verdict (THE LEDGER\'S SEAL)',
    !!(finalBody && finalBody.verdict && finalBody.verdict.galactic.firstClear === true));
  check('the Herald\'s fall is booked as a capital slain',
    !!(finalBody && finalBody.verdict && finalBody.verdict.galactic.capitalsSlain >= 1));
  const mapAfter = await text(capJar, '/galactic');
  check('Sector 2\'s lock wears the captain\'s name now', mapAfter.body.includes('THE LEDGER HAS YOUR NAME NOW'));
  const bridge = await text(capJar, '/galactic/bridge');
  check('the Bridge shows the cleared sector', bridge.body.includes('SECTOR 1') && bridge.body.includes('CLEARED'));

  // the wheel battle still starts in rt form (coexistence at the endpoint)
  const rtStart = await json(rookJar, 'POST', '/api/galactic/start', {});
  check('the same start door still deals the wheel battle without the scroll form',
    rtStart.status === 200 && !rtStart.body.scroll && !!rtStart.body.stats);
  await json(rookJar, 'POST', '/api/galactic/abandon', { sortieId: rtStart.body.galactic.sortieId });
} finally {
  server.kill('SIGKILL');
}
console.log(`\n1944 (scroll form): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
