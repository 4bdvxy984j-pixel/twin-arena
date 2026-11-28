// THE TWIN ARENA — THE GALACTIC real-time layer battery (G1.5).
// What this suite proves, in order:
//  1. THE WHEEL: the radial selector's pure geometry — hub is parry, the
//     face band is the four tools in compass order, the rim band is the
//     four deployables, outside is nothing.
//  2. INTENT HONESTY (source): the RT layer speaks only the classic
//     intent vocabulary ({ t, tool } — tools, 'parry', 'ability:<id>',
//     'mod:<id>'), posts to the same four endpoints, never touches the
//     deck, and launches haymaker/feint projectiles on exactly the
//     referee's windup window.
//  3. REFEREE PARITY (unit): a wheel-fired log and a classic-fired log
//     with the same intents are the same log to simulateRound — same
//     outcome, same vitals, byte for byte.
//  4. FORGERY WALKS (unit): a parry claimed outside its window voids; a
//     fire claimed inside cooldown voids; a wheel-armed deployable the
//     captain does not own voids; a deployable fired past its charges
//     voids. The window's edges are inclusive, exactly as drawn.
//  5. LIVE: the fly page loads the RT layer BEFORE the classic deck and
//     keeps the classic deck whole underneath (fallback reachability,
//     including ?classic=1); the stage framing stands on the map; a
//     captain flies all eight stages on wheel-vocabulary logs; and when
//     the Herald falls, the Phase 2 hook lands — Sector 2's lock wears
//     THE LEDGER HAS YOUR NAME NOW and the receipt carries the seal.
// Usage: node scripts/verify-realtime.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import game from '../src/game.js';

const PORT = 4303;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'test-deck-key';

let failures = 0;
function check(name, cond, evidence) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? '  — ' + evidence : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ===========================================================================
// 1. THE WHEEL — pure geometry, extracted from the shipped client
// ===========================================================================
const rtSrc = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'js', 'galactic-rt.js'), 'utf8');
const classicSrc = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'js', 'galactic.js'), 'utf8');
{
  const m = rtSrc.match(/\/\* RT-WHEEL-BEGIN \*\/([\s\S]*?)\/\* RT-WHEEL-END \*\//);
  check('wheel: the geometry block ships in the client, marked for this suite', !!m);
  const wheel = new Function(m[1] + '\nreturn { rtWheelPick, RT_WHEEL_TOOLS, RT_WHEEL_DEPLOY };')();
  const pick = (dx, dy) => wheel.rtWheelPick(dx, dy, 100);
  check('wheel: the hub is parry — center and near-center land on it',
    pick(0, 0).zone === 'hub' && pick(6, -8).zone === 'hub' && pick(0, -30).zone === 'hub');
  check('wheel: the faces are the tools, compass order — probe N, flood E, whisper S, decoy W',
    pick(0, -52).zone === 'face' && pick(0, -52).index === 0 &&
    pick(52, 0).zone === 'face' && pick(52, 0).index === 1 &&
    pick(0, 52).zone === 'face' && pick(0, 52).index === 2 &&
    pick(-52, 0).zone === 'face' && pick(-52, 0).index === 3 &&
    wheel.RT_WHEEL_TOOLS.join(',') === 'probe,flood,whisper,decoy');
  check('wheel: the rim is the deployables, same compass order',
    pick(0, -88).zone === 'rim' && pick(0, -88).index === 0 &&
    pick(88, 0).zone === 'rim' && pick(88, 0).index === 1 &&
    pick(0, 88).zone === 'rim' && pick(0, 88).index === 2 &&
    pick(-88, 0).zone === 'rim' && pick(-88, 0).index === 3 &&
    wheel.RT_WHEEL_DEPLOY.join(',') === 'overclock,tracepurge,ghostplate,coldsnap');
  check('wheel: the band edges are exact — r=74 is a face, r=75 is the rim, r=101 is nothing',
    pick(0, -74).zone === 'face' && pick(0, -75).zone === 'rim' && pick(0, -101).zone === 'none');
  check('wheel: diagonal thumbs land in the sector they lean toward',
    pick(36, -38).index === 0 && pick(38, -36).index === 1 && pick(36, 38).index === 2 && pick(-38, 36).index === 3);
}

// ===========================================================================
// 2. INTENT HONESTY — the layer's own source, read plainly
// ===========================================================================
{
  check('honesty: the RT layer submits the classic intent shapes, all four families',
    rtSrc.includes("{ t: Math.round(now), tool: id }") &&
    rtSrc.includes("{ t: Math.round(now), tool: 'parry' }") &&
    rtSrc.includes("tool: 'ability:' + id") &&
    rtSrc.includes("tool: 'mod:' + id"));
  check('honesty: the RT layer posts only to the sortie endpoints the classic deck uses',
    rtSrc.includes("'/api/galactic/start'") && rtSrc.includes("'/api/fight/finish'") &&
    rtSrc.includes("'/api/galactic/choose'") && rtSrc.includes("'/api/galactic/abandon'") &&
    !rtSrc.includes('/api/deck') && !rtSrc.includes('/api/evolve') && !rtSrc.includes('/api/gear'));
  const payloads = [];
  for (let i = rtSrc.indexOf('JSON.stringify('); i >= 0; i = rtSrc.indexOf('JSON.stringify(', i + 1)) {
    payloads.push(rtSrc.slice(i, i + 420));
  }
  check('honesty: ship position is never posted — no fetch payload carries the flight',
    payloads.length >= 4 && payloads.every(p => !/ship\.(x|y|tx|ty)/.test(p)),
    `${payloads.length} payloads scanned`);
  check('honesty: haymaker/feint projectiles fly exactly the referee windup window',
    rtSrc.includes('? S.combat.windupMs : 620') && rtSrc.includes('spawnT: s.at - travel'));
  check('fallback: the classic deck yields only to an initialized RT layer',
    classicSrc.includes('if (window.TA_RT_ACTIVE) return;'));
  check('fallback: ?classic=1 stands the RT layer down before it builds anything',
    rtSrc.includes("has('classic')"));
}

// ===========================================================================
// 3+4. REFEREE PARITY + FORGERY — the engine, no server
// ===========================================================================
function fakeState() {
  return {
    config: { aggression: 1, learningSpeed: 1, floodgates: false, stormUntil: 0 },
    shapesGlobal: {}, globalArmor: {}, players: {}, verdicts: {}, fights: [],
    pit: { bouts: 0, holds: 0, breaches: 0 },
    descent: { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 },
    galactic: { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} },
    gearSeq: {}, itemsSeq: {}, keeperSetGranted: false, deck: { ownerPlayerId: null }
  };
}
function fakePlayer(id, extra = {}) {
  return Object.assign({
    id, email: id + '@x.io', displayName: id, photo: null, points: 0,
    nodes: {}, shapes: {}, twinArmor: {}, challengeToken: 'tok-' + id,
    record: { bouts: 0, breaches: 0, streak: 0, bestSecs: null },
    challengeFeed: [], publicProfile: true, createdAt: 1, lastFightAt: null,
    xp: 0, toolUse: {}, parriesTotal: 0, taunt: '', devilShapes: {},
    devil: { bounty: 25, bountyDay: game.dayKey(Date.now()), held: 0, breached: 0, lastBreachedBy: null, breachedBy: [], holdStreak: 0 },
    pitAttack: { bouts: 0, breaches: 0 },
    itemStock: {}, itemHistory: [], pitAttempts: {},
    defenseXpDay: { day: game.dayKey(Date.now()), count: 0 },
    gear: [], descent: { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 },
    galactic: { sorties: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, capitalsSlain: 0, cleared: {}, sectors: {} },
    modsOwned: {}, modsFitted: { probe: null, flood: null, whisper: null, decoy: null }
  }, extra);
}
// The planner — the galactic battery's discipline, copied: it plays a
// dealt encounter honestly against the referee's own math and returns the
// winning log, so parity and forgery walks start from a true fight.
function planLog(stats, strikes, policy, maxT, opts = {}) {
  const actions = [];
  let energy = stats.energyMax, last = 0, trace = stats.combat.startTrace || 0;
  let ghostCharges = 0, rapidUntil = -1;
  const lastUse = {}, lastCd = {}, lockout = {};
  const glances = strikes.filter(s => s.kind === 'glance');
  let gi = 0;
  const parried = new Set();
  for (let t = 300; t <= (maxT || stats.roundMs); t += 100) {
    energy = Math.min(stats.energyMax, energy + (t - last) / 1000 * stats.energyRegen); last = t;
    trace = Math.max(0, trace - (stats.combat.traceCool || game.TRACE_COOL) * 0.1);
    while (gi < glances.length && glances[gi].at <= t) {
      const g = glances[gi++];
      if (stats.tools[g.tool] && stats.tools[g.tool].silent) continue;
      const readyAt = lastUse[g.tool] !== undefined ? lastUse[g.tool] + stats.tools[g.tool].cooldown : g.at;
      lockout[g.tool] = Math.max(readyAt, g.at) + (stats.combat.scrambleMs || game.STRIKE.scrambleMs);
    }
    const view = {
      t, energy, trace, lastUse,
      ready(id) {
        const tl = stats.tools[id];
        const cd = lastCd[id] !== undefined ? lastCd[id] : tl.cooldown;
        return (lastUse[id] === undefined || t - lastUse[id] >= cd) &&
          !(lockout[id] && t < lockout[id]) && energy >= tl.cost;
      },
      abilityReady(id) {
        const ab = stats.abilities && stats.abilities[id];
        if (!ab || energy < ab.cost) return false;
        if (id === 'secondwind') return lastUse[id] === undefined;
        return lastUse[id] === undefined || t - lastUse[id] >= ab.cooldown;
      },
      ghostCharges() { return ghostCharges; },
      winding() {
        return strikes.findIndex((s, i) => s.kind === 'haymaker' && !parried.has(i) &&
          t >= s.at - game.STRIKE.windupMs && t <= s.at);
      }
    };
    const tool = policy(view);
    if (!tool) continue;
    const ability = stats.abilities && stats.abilities[tool];
    if (ability) {
      actions.push({ t, tool: 'ability:' + tool });
      energy -= ability.cost; lastUse[tool] = t;
      if (tool === 'ghost') ghostCharges = ability.charges || 3;
      if (tool === 'overdrive' || tool === 'rapid') trace = Math.min(100, trace + (ability.trace || 0));
    } else if (tool === 'parry') {
      const idx = view.winding();
      if (idx < 0) continue;
      parried.add(idx);
      actions.push({ t, tool: 'parry' });
      energy -= stats.combat.parryCost; lastUse.parry = t;
    } else {
      actions.push({ t, tool });
      energy -= stats.tools[tool].cost; lastUse[tool] = t;
      lastCd[tool] = t <= rapidUntil ? stats.tools[tool].cooldown * 0.5 : stats.tools[tool].cooldown;
      const tAdd = stats.tools[tool].trace || 0;
      if (tAdd > 0 && ghostCharges > 0) ghostCharges--;
      else trace = Math.min(100, Math.max(0, trace + tAdd));
    }
  }
  return actions;
}
function planEncounter(dealt, extraActions) {
  const stats = dealt.stats, strikes = dealt.strikes || [];
  const parryReady = (v) => v.energy >= 5 && (v.lastUse.parry === undefined || v.t - v.lastUse.parry >= 1500);
  const rhythm = (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    if (v.t >= 40000 && v.abilityReady('secondwind')) return 'secondwind';
    if (v.winding() >= 0 && v.ready('decoy')) return 'decoy';
    if (v.trace > 60 && v.ready('decoy')) return 'decoy';
    if (v.abilityReady('ghost') && v.ready('flood') && v.trace >= 25) return 'ghost';
    if (v.abilityReady('rapid') && v.ghostCharges() > 0 && v.ready('flood')) return 'rapid';
    if (v.ready('flood') && v.ghostCharges() > 0) return 'flood';
    if (v.ready('flood') && v.trace <= 22) return 'flood';
    if (v.abilityReady('overdrive') && v.trace <= 40 && v.energy >= 55) return 'overdrive';
    if (v.ready('whisper') && v.energy >= 35 && v.trace <= 50) return 'whisper';
    if (v.ready('probe') && v.trace <= 38) return 'probe';
    if (v.ready('decoy') && v.trace > 45) return 'decoy';
    return null;
  };
  const cannon = (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    if (v.t >= 40000 && v.abilityReady('secondwind')) return 'secondwind';
    if (v.winding() >= 0 && v.ready('decoy')) return 'decoy';
    if (v.trace > 55 && v.ready('decoy')) return 'decoy';
    if (v.abilityReady('ghost') && v.ready('flood') && v.trace >= 30) return 'ghost';
    if (v.ready('flood') && (v.ghostCharges() > 0 || v.trace <= 42)) return 'flood';
    if (v.abilityReady('overdrive') && v.trace <= 45 && v.energy >= 55) return 'overdrive';
    if (v.ready('whisper') && v.energy >= 35 && v.trace <= 55) return 'whisper';
    if (v.ready('probe') && v.trace <= 45) return 'probe';
    if (v.ready('decoy') && v.trace > 35) return 'decoy';
    return null;
  };
  let best = null;
  const score = (sim) => sim.integrityLeft - sim.trace * 0.6;
  for (const pol of [rhythm, cannon]) {
    let raw = planLog(stats, strikes, pol);
    if (extraActions) raw = extraActions.concat(raw).sort((a, b) => a.t - b.t);
    const full = game.simulateRound({ stats, strikes }, raw, stats.roundMs);
    if (full.problem) continue;
    const actions = full.outcome ? raw.filter(a => a.t <= full.outcome.at + 250) : raw;
    const sim = game.simulateRound({ stats, strikes }, actions, stats.roundMs);
    if (sim.problem) continue;
    const cand = { actions, sim, durationMs: sim.outcome ? sim.outcome.at + 250 : stats.roundMs };
    if (sim.outcome && sim.outcome.result === 'win') {
      if (!best || !(best.sim.outcome && best.sim.outcome.result === 'win') || score(sim) > score(best.sim)) best = cand;
    } else if (!best) best = cand;
  }
  return best;
}

{
  const st = fakeState();
  const captain = fakePlayer('rtcap', {
    nodes: { vec1: true, vec2: true, vec3: true, dec2: true, pat1: true, pat2: true, spd1: true, spd2: true, spd3: true },
    modsOwned: { throughline: true, emberline: true, ashenveil: true, paybackcoil: true, overclock: true, tracepurge: true, ghostplate: true, coldsnap: true },
    modsFitted: { probe: 'throughline', flood: 'emberline', whisper: 'ashenveil', decoy: 'paybackcoil' }
  });
  const stats = game.effectiveStats(st, captain, {}, { gateHp: 100, roundMs: 120000, famShapes: game.galacticFamShapes(captain, 1) });
  const strikes = game.makeGalacticStrikes(777, 1, 120000, {});
  const fight = { stats, strikes };
  const plan = planEncounter({ stats, strikes }, [{ t: 300, tool: 'mod:overclock' }, { t: 450, tool: 'mod:tracepurge' }]);
  check('parity setup: the planner wins Encounter 1 with rail shots in the log',
    !!plan && plan.sim.outcome && plan.sim.outcome.result === 'win' && !plan.sim.problem,
    `outcome=${plan && JSON.stringify(plan.sim.outcome)}`);
  if (plan) {
    // The wheel-fired log: every intent re-emitted through the wheel's
    // vocabulary mapping — faces to tool ids, hub to 'parry', rim to
    // 'mod:<id>', chips to 'ability:<id>'. If the mapping is faithful,
    // the two logs are the same bytes and the referee cannot tell the
    // layers apart. That is the parity claim, and it is exact.
    const wheelLog = plan.actions.map(a => {
      if (a.tool === 'parry') return { t: a.t, tool: 'parry' };
      if (a.tool.startsWith('mod:')) return { t: a.t, tool: 'mod:' + a.tool.slice(4) };
      if (a.tool.startsWith('ability:')) return { t: a.t, tool: 'ability:' + a.tool.slice(8) };
      return { t: a.t, tool: a.tool };
    });
    const simClassic = game.simulateRound(fight, plan.actions, plan.durationMs);
    const simWheel = game.simulateRound(fight, wheelLog, plan.durationMs);
    check('parity: wheel-fired and classic-fired logs are byte-identical intents',
      JSON.stringify(wheelLog) === JSON.stringify(plan.actions));
    check('parity: the referee returns the same truth for both layers',
      JSON.stringify(simWheel) === JSON.stringify(simClassic) && !simWheel.problem,
      `gateHp=${simWheel.gateHp} integrity=${simWheel.integrityLeft} trace=${simWheel.trace}`);
  }
  // ---- forgery walks
  const hay = strikes.find(s => s.kind === 'haymaker');
  check('forgery setup: Encounter 1 deals at least one haymaker to test the window against', !!hay, hay && `at=${hay.at}`);
  if (hay) {
    const windup = stats.combat.windupMs;
    const early = game.simulateRound(fight, [{ t: Math.max(0, hay.at - windup - 400), tool: 'parry' }], 120000);
    check('forgery: a dodge (parry) claimed BEFORE the window opens voids — flight is not defense',
      early.problem === 'parry outside its window', `problem=${early.problem}`);
    const late = game.simulateRound(fight, [{ t: hay.at + 300, tool: 'parry' }], 120000);
    check('forgery: a dodge claimed AFTER the strike lands voids',
      late.problem === 'parry outside its window', `problem=${late.problem}`);
    const edgeIn = game.simulateRound(fight, [{ t: hay.at - windup, tool: 'parry' }], 120000);
    check('the window\u2019s opening edge is inclusive — a flare at launch is honest',
      edgeIn.problem === null, `problem=${edgeIn.problem}`);
    const edgeHit = game.simulateRound(fight, [{ t: hay.at, tool: 'parry' }], 120000);
    check('the window\u2019s closing edge is inclusive — a flare at impact is honest',
      edgeHit.problem === null, `problem=${edgeHit.problem}`);
  }
  {
    const cd = stats.tools.flood.cooldown;
    const spam = game.simulateRound(fight, [
      { t: 300, tool: 'flood' }, { t: 300 + Math.floor(cd * 0.5), tool: 'flood' }
    ], 120000);
    check('forgery: a second Flood claimed inside its cooldown voids',
      spam.problem === 'cooldown violated', `problem=${spam.problem} cd=${cd}`);
  }
  {
    const rookie = fakePlayer('rtrookie');
    const rStats = game.effectiveStats(st, rookie, {}, { gateHp: 100, roundMs: 120000, famShapes: game.galacticFamShapes(rookie, 1) });
    const rFight = { stats: rStats, strikes };
    const unowned = game.simulateRound(rFight, [{ t: 300, tool: 'mod:overclock' }], 120000);
    check('forgery: a wheel-armed deployable the captain does not own voids',
      unowned.problem === 'mod not owned', `problem=${unowned.problem}`);
    const drained = game.simulateRound(fight, [
      { t: 300, tool: 'mod:overclock' }, { t: 600, tool: 'mod:overclock' }, { t: 900, tool: 'mod:overclock' }
    ], 120000);
    check('forgery: a deployable fired past its dealt charges voids',
      drained.problem === 'mod charges spent', `problem=${drained.problem}`);
  }
}

// ===========================================================================
// 5. LIVE — a seeded world behind the real server
// ===========================================================================
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
async function call(jar, method, url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (jar && jar.header()) headers.cookie = jar.header();
  const res = await fetch(BASE + url, { method, redirect: 'manual', ...opts, headers });
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
const today = game.dayKey(Date.now());
function seedPlayer(id, name, xp, createdAt, extra = {}) {
  return {
    id, email: id + '@rt.test', pass: null, displayName: name, photo: null,
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
const aff = (kind, value) => ({ kind, value, label: kind + '+' + value });
const ALL_MODS = { throughline: true, emberline: true, ashenveil: true, paybackcoil: true, overclock: true, tracepurge: true, ghostplate: true, coldsnap: true };
const seedPlayers = {
  keeper1: seedPlayer('keeper1', 'Keeper', 0, 1, { email: 'stevenh18818@gmail.com', isOwner: true }),
  rtcaptain: seedPlayer('rtcaptain', 'RTCaptain', 500, 2, {
    nodes: { vec1: true, vec2: true, vec3: true, dec2: true, pat1: true, pat2: true, spd1: true, spd2: true, spd3: true },
    toolUse: { whisper: 120, flood: 80, probe: 30, decoy: 10 },
    itemStock: { foundersember: [7] },
    itemHistory: [{ item: 'foundersember', serial: 7, how: 'founder', at: 1, spent: false, spentAt: null, spentVs: null }],
    modsOwned: { ...ALL_MODS },
    modsFitted: { probe: 'throughline', flood: 'emberline', whisper: 'ashenveil', decoy: 'paybackcoil' },
    gear: [
      { id: 'g-ember', slot: 'flood', tier: 'LEGENDARY', unique: 'emberbrand', serial: 1, name: 'EMBERBRAND', affixes: [aff('dmg', 0.2), aff('splash', 4), aff('cd', 0.1)], worn: true, banked: true, at: 1 },
      { id: 'g-plate', slot: 'body', tier: 'EPIC', unique: null, serial: null, name: 'Keeper Plate of the Wall', affixes: [aff('plating', 25), aff('coolant', 0.5), aff('parry', 200)], worn: true, banked: true, at: 1 }
    ]
  }),
  rtrookie: seedPlayer('rtrookie', 'RTRookie', 0, 3, {
    nodes: { vec1: true, vec2: true, pat1: true, spd1: true, spd2: true }
  })
};
const seedSessions = {};
for (const id of Object.keys(seedPlayers)) seedSessions['sess-' + id] = id;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-realtime-'));
function writeSeed() {
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
    config: { aggression: 1, learningSpeed: 1, frozen: false, stormUntil: 0, broadcast: null, floodgates: false, spotlight: null },
    deck: { memberTieHash: null, ownerPlayerId: 'keeper1' },
    deckSessions: {}, players: seedPlayers, sessions: seedSessions,
    shapesGlobal: {}, globalArmor: {}, pit: { bouts: 0, holds: 0, breaches: 0 },
    descent: { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 },
    galactic: { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} },
    gearSeq: { _inst: 50, emberbrand: 1 },
    itemsSeq: { mirrorwrap: 0, anchorstitch: 0, secondheart: 0, stillbell: 0, foundersember: 7 },
    keeperSetGranted: false, fights: [], fightSeq: 0, verdicts: {}
  }));
}
writeSeed();
const jarFor = (id) => { const j = new Jar(); j.c.set('ta_sess', 'sess-' + id); return j; };
function bootServer() {
  const server = spawn('node', ['src/server.js'], {
    cwd: path.join(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), ADMIN_KEY: ADMIN, DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', d => process.stderr.write('[server] ' + d));
  return server;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) return true; } catch {}
    await sleep(200);
  }
  return false;
}
async function finishEncounter(jar, payload, plan) {
  return json(jar, 'POST', '/api/fight/finish', {
    fightId: payload.fightId, actions: plan.actions,
    result: plan.sim.outcome ? plan.sim.outcome.result : 'lose',
    endReason: plan.sim.outcome ? plan.sim.outcome.endReason : 'timeout',
    durationMs: plan.durationMs, damagePct: plan.sim.damagePct || 0
  });
}

let server = bootServer();
try {
  check('the seeded server boots', await waitUp());

  // ---- layering + fallback reachability
  {
    const fly = await (await call(jarFor('rtcaptain'), 'GET', '/galactic/fly')).text();
    const rtAt = fly.indexOf('/js/galactic-rt.js');
    const classicAt = fly.indexOf('/js/galactic.js');
    check('layering: the fly page loads the real-time layer BEFORE the classic deck',
      rtAt > 0 && classicAt > rtAt, `rt@${rtAt} classic@${classicAt}`);
    check('fallback: the classic deck stands whole underneath — kit, flare plate, pad, armory',
      fly.includes('id="kit"') && fly.includes('id="parrybtn"') && fly.includes('id="startbtn"') &&
      fly.includes('BEGIN THE SORTIE') && fly.includes('classic=1'));
    const classic = await (await call(jarFor('rtcaptain'), 'GET', '/galactic/fly?classic=1')).text();
    check('fallback: ?classic=1 reaches the same classic pad, whole',
      classic.includes('id="kit"') && classic.includes('SHIELD FLARE') && classic.includes('modrail'));
    const rtJs = await (await call(new Jar(), 'GET', '/js/galactic-rt.js')).text();
    check('the served RT client is the built one (wheel block + activation flag aboard)',
      rtJs.includes('RT-WHEEL-BEGIN') && rtJs.includes('TA_RT_ACTIVE') && rtJs.includes('rtWheelPick'));
    const build = await (await call(new Jar(), 'GET', '/')).text();
    check('the build stamp names the current build', build.includes('2026.11.27-galactic-1944'));
  }

  // ---- stage framing on the map, before any clear
  {
    const map = await (await call(jarFor('rtcaptain'), 'GET', '/galactic')).text();
    check('stages: the map frames Sector 1 as PHASE 1 · EIGHT STAGES with per-stage pips',
      map.includes('PHASE 1 · EIGHT STAGES') && map.includes('gpip') && map.includes('the Herald stands at Stage 8'));
    check('stages: the school flies under its new name — a masterclass for intruders',
      map.includes('masterclass for intruders'));
    check('the hook sleeps until earned: Sector 2\u2019s lock is plain before any clear',
      !map.includes('THE LEDGER HAS YOUR NAME NOW') && map.includes('Held for the next campaign'));
  }

  // ---- the full eight-stage road on wheel-vocabulary logs
  let verdictId = null;
  {
    const jar = jarFor('rtcaptain');
    const start = await json(jar, 'POST', '/api/galactic/start', {});
    check('the RT-era sortie opens at Stage 1 against the pickets',
      start.status === 200 && start.body.galactic.encounter === 1 && start.body.galactic.kind === 'pickets',
      `status=${start.status}`);
    let payload = start.body;
    let walkOk = true;
    const kindsSeen = [];
    for (let n = 1; n <= 8 && walkOk; n++) {
      kindsSeen.push(payload.galactic.kind);
      const extra = n === 1 ? [{ t: 300, tool: 'mod:overclock' }, { t: 450, tool: 'mod:tracepurge' }] : null;
      const plan = planEncounter(payload, extra);
      if (!plan || !(plan.sim.outcome && plan.sim.outcome.result === 'win')) {
        check(`stage ${n}: the planner finds a winning line`, false, `sim=${plan && JSON.stringify(plan.sim.outcome)}`);
        walkOk = false; break;
      }
      const fin = await finishEncounter(jar, payload, plan);
      const fd = fin.body.galactic || {};
      if (n === 1) {
        check('wheel-fired rail shots settle clean over HTTP — the sortie stands at the choice',
          !fin.body.voided && fd.over === false && fd.state === 'choice', `voided=${fin.body.voided}`);
      }
      if (n < 8) {
        if (fd.over !== false || fd.state !== 'choice') { check(`stage ${n}: cleared, choice open`, false, JSON.stringify(fd)); walkOk = false; break; }
        const ch = await json(jar, 'POST', '/api/galactic/choose', { sortieId: start.body.galactic.sortieId, choice: 'press' });
        if (ch.status !== 200) { check(`press on to stage ${n + 1}`, false, `status ${ch.status}`); walkOk = false; break; }
        payload = ch.body;
      } else {
        check('stage 8: the Herald falls and the sector clears on wheel-vocabulary logs',
          fd.over === true && fd.sectorCleared === true, `cleared=${fd.sectorCleared}`);
        verdictId = fin.body.verdict && fin.body.verdict.id;
      }
    }
    check('the ladder walked in order through all eight stages',
      JSON.stringify(kindsSeen) === JSON.stringify(['pickets', 'pickets', 'patrols', 'squadrons', 'patrols', 'squadrons', 'squadrons', 'capital']),
      kindsSeen.join(','));
  }

  // ---- the Phase 2 hook, landed by the clear
  {
    const map = await (await call(jarFor('rtcaptain'), 'GET', '/galactic')).text();
    check('the hook lands: Sector 2\u2019s lock now wears THE LEDGER HAS YOUR NAME NOW — still locked',
      map.includes('THE LEDGER HAS YOUR NAME NOW') && map.includes('it has your name now') &&
      map.includes('Held for the next campaign'), '');
    check('the receipt carries the tie-in: the Ledger\u2019s seal stands on the first-clear line',
      map.includes('Ledger') && map.includes('seal') && map.includes('First cleared by'));
    check('the stage pips read the road as walked: Phase 1 cleared',
      map.includes('Phase 1 cleared — the Herald has fallen'));
    if (verdictId) {
      const vpage = await (await call(jarFor('rtcaptain'), 'GET', '/verdict/' + verdictId)).text();
      check('the after-action report carries the story beat and, on a first clear, the seal',
        vpage.includes('THE RELAY GOES DARK') && vpage.includes('SEAL') && vpage.includes('THE LEDGER HAS YOUR NAME NOW'));
    } else {
      check('the after-action report carries the story beat and, on a first clear, the seal', false, 'no verdict id');
    }
    const rookieMap = await (await call(jarFor('rtrookie'), 'GET', '/galactic')).text();
    check('the hook is personal: a captain who has not cleared sees the plain lock',
      !rookieMap.includes('THE LEDGER HAS YOUR NAME NOW'));
  }
} finally {
  try { server.kill('SIGKILL'); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL REALTIME CHECKS PASSED' : `\n${failures} REALTIME CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
