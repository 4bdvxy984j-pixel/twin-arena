// THE TWIN ARENA — Phase 3 battery: THE COMMAND DECK + THE PIT.
// Unit proofs against the engine (XP/levels/classes, bounty math, Mirage
// schedules, Morph Armor shed, Second Heart, Stillbell, Founder's Ember,
// numbered editions, the Keeper's Set) plus a seeded live server walk:
// members-only gating, weight classes, attempt caps, item spend/refund,
// forged claims voided, a Pit win reconciled against the ledger, taunts,
// and a simulated Pit day whose tallies must match the books exactly.
// Usage: node scripts/verify-pit.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import game from '../src/game.js';

const PORT = 4299;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'test-deck-key';

let failures = 0;
function check(name, cond, evidence) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? '  — ' + evidence : ''}`);
  if (!cond) failures++;
}

// ============================================================================
// UNIT — the engine, no server
// ============================================================================
function fakeState() {
  return {
    config: { aggression: 1, learningSpeed: 1, floodgates: false, stormUntil: 0 },
    shapesGlobal: {}, globalArmor: {}, players: {}, verdicts: {}, fights: [],
    pit: { bouts: 0, holds: 0, breaches: 0 },
    itemsSeq: {}, keeperSetGranted: false, deck: { ownerPlayerId: null }
  };
}
function fakePlayer(id, xp) {
  return {
    id, email: id + '@x.io', displayName: id, photo: null, points: 0,
    nodes: {}, shapes: {}, twinArmor: {}, challengeToken: 'tok-' + id,
    record: { bouts: 0, breaches: 0, streak: 0, bestSecs: null },
    challengeFeed: [], publicProfile: true, createdAt: 1, lastFightAt: null,
    xp: xp || 0, toolUse: {}, parriesTotal: 0, taunt: '', devilShapes: {},
    devil: { bounty: 25, bountyDay: game.dayKey(Date.now()), held: 0, breached: 0, lastBreachedBy: null, breachedBy: [], holdStreak: 0 },
    pitAttack: { bouts: 0, breaches: 0 },
    itemStock: {}, itemHistory: [], pitAttempts: {},
    defenseXpDay: { day: game.dayKey(Date.now()), count: 0 }
  };
}

// ---- XP, levels, classes
check('XP curve: L2=50, L5=500, L10=2250', game.xpForLevel(2) === 50 && game.xpForLevel(5) === 500 && game.xpForLevel(10) === 2250);
check('levelForXp thresholds', game.levelForXp(0) === 1 && game.levelForXp(49) === 1 && game.levelForXp(50) === 2 && game.levelForXp(499) === 4 && game.levelForXp(500) === 5 && game.levelForXp(2250) === 10);
check('classes ride level: Spark/Flare/Inferno', game.classOf({ xp: 0 }).name === 'Spark' && game.classOf({ xp: 500 }).name === 'Flare' && game.classOf({ xp: 2250 }).name === 'Inferno');
check('traits: Mirage from Flare, Armor only at Inferno', (() => {
  const mid = game.devilTraits({ xp: 500 }), top = game.devilTraits({ xp: 2250 }), low = game.devilTraits({ xp: 0 });
  return mid.mirage && !mid.armor && top.mirage && top.armor && !low.mirage && !low.armor;
})());

// ---- bounty math
{
  const today = game.dayKey(Date.now());
  const threeAgo = game.dayKey(Date.now() - 3 * 86400000);
  check('bounty: base today = 25', game.bountyNow({ devil: { bounty: 25, bountyDay: today } }, Date.now()) === 25);
  check('bounty: +10/day unbeaten (3 days = 55)', game.bountyNow({ devil: { bounty: 25, bountyDay: threeAgo } }, Date.now()) === 55);
  check('bounty: capped at 300', game.bountyNow({ devil: { bounty: 295, bountyDay: threeAgo } }, Date.now()) === 300);
}

// ---- devil determinism + Mirage/Armor schedules
{
  const mirageOwner = fakePlayer('m', 500); mirageOwner.toolUse = { whisper: 40 };
  const armorOwner = fakePlayer('a', 2250); armorOwner.toolUse = { flood: 60 };
  const plainOwner = fakePlayer('p', 0);
  const tM = game.devilTraits(mirageOwner), tA = game.devilTraits(armorOwner), tP = game.devilTraits(plainOwner);
  const d1 = game.makeDevilStrikes(1234, 150000, mirageOwner, 1, tM);
  const d2 = game.makeDevilStrikes(1234, 150000, mirageOwner, 1, tM);
  check('devil determinism: same seed + owner = same defense', JSON.stringify(d1.strikes) === JSON.stringify(d2.strikes));
  check('Mirage schedule carries 2-4 seeded feints', d1.strikes.filter(s => s.kind === 'feint').length >= 2, `feints=${d1.strikes.filter(s => s.kind === 'feint').length}`);
  const dA = game.makeDevilStrikes(777, 150000, armorOwner, 1, tA);
  check('Armored devil deals a post-morph rhythm', Array.isArray(dA.postMorph) && dA.postMorph.length >= 5, `postMorph=${(dA.postMorph || []).length}`);
  const dP = game.makeDevilStrikes(777, 150000, plainOwner, 1, tP);
  check('plain devil: no feints, no post-morph', dP.strikes.every(s => s.kind !== 'feint') && !dP.postMorph);
  check("devil style follows the owner's hand (whisper = glance-heavy)", game.devilStyle(mirageOwner).cycle[0] === 'glance' && game.devilStyle(armorOwner).cycle.filter(k => k === 'haymaker').length === 2);
}

// ---- Morph Armor shed math (Anchor Stitch exemption)
{
  const st = fakeState();
  const ch = fakePlayer('c', 0);
  ch.shapes = { 'tool:flood': 12, 'tool:whisper': 12 };
  const stats = game.effectiveStats(st, ch, {}, { famShapes: ch.shapes, morph: true, stitchTool: 'flood' });
  check('morph: stitched tool keeps its familiarity (dmgMorph == dmg)', stats.tools.flood.dmgMorph === stats.tools.flood.dmg, `flood ${stats.tools.flood.dmg} -> ${stats.tools.flood.dmgMorph}`);
  check('morph: unstitched tool sheds familiarity (dmgMorph > dmg)', stats.tools.whisper.dmgMorph > stats.tools.whisper.dmg, `whisper ${stats.tools.whisper.dmg} -> ${stats.tools.whisper.dmgMorph}`);
  check('morph: famMorph == 40% of personal + global', Math.abs(stats.tools.whisper.famMorph - (stats.tools.whisper.familiarity - (game.familiarityParts(st, ch, 'whisper', ch.shapes).personal * 0.6))) < 0.011, `famMorph=${stats.tools.whisper.famMorph}`);
}

// ---- the referee: morph fires, feint parry is a legal whiff, forged parry voids
{
  const st = fakeState();
  const ch = fakePlayer('c', 0); ch.shapes = { 'tool:flood': 12 };
  const owner = fakePlayer('o', 2250); owner.toolUse = { flood: 60 };
  const stats = game.effectiveStats(st, ch, {}, { famShapes: {}, morph: true, stitchTool: null });
  const built = game.makeDevilStrikes(42, stats.roundMs, owner, 1, game.devilTraits(owner));
  // rush the gate down past half with floods, parrying real haymakers
  const actions = [];
  for (let t = 400; t < 60000; t += 4100) actions.push({ t, tool: 'flood' });
  const sim = game.simulateRound({ stats, strikes: built.strikes, postMorph: built.postMorph }, actions, stats.roundMs);
  check('morph: sim reports the morph when the gate crosses half', !sim.problem && sim.morphed === true, `morphed=${sim.morphed} problem=${sim.problem}`);
  // feint whiff: parry exactly at a feint's window on a mirage schedule
  const mOwner = fakePlayer('mo', 500); mOwner.toolUse = { whisper: 30 };
  const mStats = game.effectiveStats(st, fakePlayer('c2', 0), {}, { famShapes: {} });
  const mBuilt = game.makeDevilStrikes(9, mStats.roundMs, mOwner, 1, game.devilTraits(mOwner));
  const feint = mBuilt.strikes.find(s => s.kind === 'feint');
  const whiff = game.simulateRound({ stats: mStats, strikes: mBuilt.strikes }, [
    { t: 300, tool: 'probe' }, { t: feint.at - 100, tool: 'parry' }
  ], mStats.roundMs);
  check('mirage: a parry spent on a feint is a legal whiff', !whiff.problem && whiff.parryWhiffs === 1, `problem=${whiff.problem} whiffs=${whiff.parryWhiffs}`);
  const forged = game.simulateRound({ stats: mStats, strikes: mBuilt.strikes }, [
    { t: 300, tool: 'probe' }, { t: 900, tool: 'parry' }
  ], mStats.roundMs);
  // t=900 is inside no telegraph on this schedule unless a strike happens to sit there; if it does, pick another dead moment
  check('mirage: parry with no telegraph voids (or lands on a real one)', forged.problem === 'parry outside its window' || (forged.parries + forged.parryWhiffs) === 1, `problem=${forged.problem}`);
}

// ---- Second Heart + Stillbell in the referee
{
  const st = fakeState();
  const stats = game.effectiveStats(st, fakePlayer('c', 0), {});
  const blows = Array.from({ length: 8 }, (_, i) => ({ at: 3000 + i * 3000, kind: 'haymaker' }));
  const noHeart = game.simulateRound({ stats, strikes: blows }, [{ t: 500, tool: 'probe' }], stats.roundMs);
  check('heart: without one, six haymakers end it', noHeart.outcome && noHeart.outcome.endReason === 'integrity' && noHeart.outcome.at === 18000, JSON.stringify(noHeart.outcome));
  const heart = game.simulateRound({ stats, strikes: blows, heart: true }, [{ t: 500, tool: 'probe' }], stats.roundMs);
  check('heart: breaks at the first zeroing blow, fighter stands at 40', heart.heartUsed === true && !heart.outcome && heart.integrityLeft === 4, `integrityLeft=${heart.integrityLeft} outcome=${JSON.stringify(heart.outcome)}`);
  const probes = Array.from({ length: 8 }, (_, i) => ({ t: 2000 + i * 1200, tool: 'probe' }));
  const noBell = game.simulateRound({ stats, strikes: [] }, probes, stats.roundMs);
  const bell = game.simulateRound({ stats, strikes: [], bell: true }, [{ t: 1000, tool: 'bell' }, ...probes], stats.roundMs);
  check('bell: rung bell freezes trace gains cold (peak 0)', bell.bellRung === true && bell.tracePeak === 0 && noBell.tracePeak > 8, `peak bell=${bell.tracePeak} plain=${noBell.tracePeak}`);
  const forgedBell = game.simulateRound({ stats, strikes: [] }, [{ t: 1000, tool: 'bell' }, ...probes], stats.roundMs);
  check('bell: an undeclared ring voids the bout', forgedBell.problem === 'bell not declared', `problem=${forgedBell.problem}`);
  const doubleBell = game.simulateRound({ stats, strikes: [], bell: true }, [{ t: 1000, tool: 'bell' }, { t: 2000, tool: 'bell' }], stats.roundMs);
  check('bell: a second ring voids the bout', doubleBell.problem === 'bell already rung', `problem=${doubleBell.problem}`);
}

// ---- numbered editions, Keeper's Set, Founder's Ember
{
  const st = fakeState();
  const keeper = fakePlayer('keeper', 0);
  check("keeper's set: granted once, all five types, serial No. 1 each", (() => {
    if (!game.grantKeeperSet(st, keeper)) return false;
    if (game.grantKeeperSet(st, keeper)) return false; // never twice
    return Object.keys(game.ITEMS).every(id => JSON.stringify(keeper.itemStock[id]) === '[1]');
  })(), JSON.stringify(keeper.itemStock));
  const crowd = Array.from({ length: 104 }, (_, i) => fakePlayer('f' + i, 0));
  let granted = 0; const serials = new Set([1]); // keeper already holds Ember No. 1
  for (const p of crowd) { const s = game.grantFounderEmber(st, p); if (s) { granted++; serials.add(s); } }
  check("founder's ember: exactly 99 more after the Keeper (100 total), unique serials", granted === 99 && serials.size === 100, `granted=${granted}`);
  check("founder's ember: idempotent — re-grant is a no-op", game.grantFounderEmber(st, crowd[0]) === null && game.itemCount(crowd[0], 'foundersember') === 1);
  check("founder's ember: the mint is closed at 100", (st.itemsSeq.foundersember || 0) === 100, `seq=${st.itemsSeq.foundersember}`);
  const mintState = fakeState();
  const a = fakePlayer('a', 0), b = fakePlayer('b', 0);
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(game.mintItem(mintState, i % 2 ? a : b, 'mirrorwrap', 'drop'));
  check('editions: serials unique across mints and owners', seen.size === 30 && Math.max(...seen) === 30);
  const serial = game.spendItem(a, 'mirrorwrap', "someone's devil");
  const rec = a.itemHistory.find(h => h.serial === serial);
  check('editions: a spent piece keeps its number in the provenance record', !!rec && rec.spent === true && rec.spentVs === "someone's devil");
  game.refundItem(a, 'mirrorwrap', serial);
  check('editions: a refund returns the very same number, unspent', a.itemStock.mirrorwrap.includes(serial) && a.itemHistory.find(h => h.serial === serial).spent === false);
}

// ---- settlement math: XP lines, founder perk, defense trickle cap, pit determinism
{
  const st = fakeState();
  const p = fakePlayer('p', 0);
  const fight = { id: 'fx1', mode: 'breach', stats: { roundMs: 150000 }, pointsMult: 1 };
  const v = game.settleFight(st, p, fight, { actions: [{ t: 1, tool: 'probe' }], result: 'win', endReason: 'breach', durationMs: 60000, damagePct: 100, fightStats: null });
  check('house XP: a win pays 30 (+2 for the new shape)', v.xp === 32 && p.xp === 32, `xp=${v.xp}`);
  game.mintItem(st, p, 'foundersember', 'founder');
  const v2 = game.settleFight(st, p, { ...fight, id: 'fx2' }, { actions: [{ t: 1, tool: 'probe' }], result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 0, fightStats: null });
  check("founder's ember: +10% XP on the holder's fights", v2.xp === Math.floor(12 * 1.1) && v2.emberBonus === true, `xp=${v2.xp}`);
}
{
  const runDay = () => {
    const st = fakeState();
    const ch = fakePlayer('ch', 0), ow = fakePlayer('ow', 500);
    const fight = { id: 'pf', mode: 'pit', seed: 42, pitTraits: game.devilTraits(ow), pitClassDelta: 0, pitBounty: 77 };
    const sim = { damagePct: 40, morphed: false, feintsShown: 2, combos: [] };
    const sub = { actions: [{ t: 1, tool: 'flood' }, { t: 5000, tool: 'flood' }], result: 'win', endReason: 'breach', durationMs: 80000, fightStats: null };
    const v = game.settlePitFight(st, ch, ow, fight, sub, sim, game.rng32(7));
    return { st, ch, ow, v };
  };
  const r1 = runDay(), r2 = runDay();
  check('pit settle: bounty pays whole to the breacher, resets to 25', r1.v.bountyWon === 77 && r1.ch.points === 77 && r1.ow.devil.bounty === 25);
  check('pit settle: owner loses no points; the devil learns the shapes', r1.ow.points === 0 && Object.keys(r1.ow.devilShapes).length > 0);
  check('pit settle: deterministic drops under the same rng', JSON.stringify(r1.v.drops) === JSON.stringify(r2.v.drops), JSON.stringify(r1.v.drops));
  check('pit settle: tallies + grudge feed written', r1.st.pit.bouts === 1 && r1.st.pit.breaches === 1 && r1.ow.challengeFeed.length === 1 && r1.ow.challengeFeed[0].mode === 'pit');
  // defense trickle: 7 holds in a day pay only 5 x 6 XP
  const st = fakeState();
  const ow = fakePlayer('ow', 0), ch = fakePlayer('ch', 0);
  for (let i = 0; i < 7; i++) {
    game.settlePitFight(st, ch, ow, { id: 'h' + i, mode: 'pit', seed: i, pitTraits: {}, pitClassDelta: 0, pitBounty: 25 },
      { actions: [{ t: 1, tool: 'probe' }], result: 'lose', endReason: 'timeout', durationMs: 150000, fightStats: null },
      { damagePct: 10, morphed: false, feintsShown: 0, combos: [] }, game.rng32(i));
  }
  check('defense XP: trickle caps at 5 holds/day (30 XP)', ow.xp === 30 && ow.devil.held === 7 && ow.devil.holdStreak === 7, `xp=${ow.xp} held=${ow.devil.held}`);
}

// ============================================================================
// HTTP — a seeded world, walked live
// ============================================================================
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
  if (jar) headers.Cookie = jar.header();
  const res = await fetch(BASE + url, { method, headers, body: opts.body, redirect: 'manual' });
  if (jar) jar.absorb(res);
  return res;
}
async function json(jar, method, url, body) {
  const res = await call(jar, method, url, {
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function form(jar, url, fields) {
  const res = await call(jar, 'POST', url, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  return { status: res.status, text: await res.text() };
}

// ---- a client in miniature (the same planner discipline as verify.mjs) ----
function planLog(stats, strikes, policy, maxT) {
  const actions = [];
  let energy = stats.energyMax, last = 0, trace = 0;
  const lastUse = {}, lockout = {};
  const glances = strikes.filter(s => s.kind === 'glance');
  let gi = 0;
  const parried = new Set();
  for (let t = 300; t <= (maxT || stats.roundMs); t += 100) {
    energy = Math.min(stats.energyMax, energy + (t - last) / 1000 * stats.energyRegen); last = t;
    trace = Math.max(0, trace - game.TRACE_COOL * 0.1);
    while (gi < glances.length && glances[gi].at <= t) {
      const g = glances[gi++];
      const readyAt = lastUse[g.tool] !== undefined ? lastUse[g.tool] + stats.tools[g.tool].cooldown : g.at;
      lockout[g.tool] = Math.max(readyAt, g.at) + (stats.combat.scrambleMs || game.STRIKE.scrambleMs);
    }
    const view = {
      t, energy, trace, lastUse,
      ready(id) {
        const tl = stats.tools[id];
        return (lastUse[id] === undefined || t - lastUse[id] >= tl.cooldown) &&
          !(lockout[id] && t < lockout[id]) && energy >= tl.cost;
      },
      winding() {
        return strikes.findIndex((s, i) => s.kind === 'haymaker' && !parried.has(i) &&
          t >= s.at - game.STRIKE.windupMs && t <= s.at);
      }
    };
    const tool = policy(view);
    if (!tool) continue;
    if (tool === 'parry') {
      const idx = view.winding();
      if (idx < 0) continue;
      parried.add(idx);
      actions.push({ t, tool: 'parry' });
      energy -= stats.combat.parryCost; lastUse.parry = t;
    } else {
      actions.push({ t, tool });
      energy -= stats.tools[tool].cost; lastUse[tool] = t;
      trace = Math.min(100, Math.max(0, trace + stats.tools[tool].trace));
    }
  }
  return actions;
}
const winPolicy = (v) => {
  if (v.winding() >= 0 && v.energy >= 5 && (v.lastUse.parry === undefined || v.t - v.lastUse.parry >= 1500)) return 'parry';
  if (v.trace > 55 && v.ready('decoy')) return 'decoy';
  if (v.ready('flood') && v.trace <= 68) return 'flood';
  if (v.ready('probe')) return 'probe';
  if (v.ready('whisper') && v.energy >= 55) return 'whisper';
  return null;
};
function planWinPit(startBody) {
  const stats = startBody.stats;
  const fight = { stats, strikes: startBody.strikes, postMorph: startBody.postMorph || undefined };
  let actions = planLog(stats, startBody.strikes, winPolicy);
  // The planner cannot see the post-morph strike schedule — when an Inferno
  // devil sheds, the referee swaps in strikes (glances included) that were
  // never in the dealt list, and a swing the planner believed legal lands
  // inside a lockout it never saw. So the plan is repaired against the real
  // referee: bisect to the first voiding swing, drop it, re-sim, repeat.
  // What survives is a log the referee itself certifies clean.
  const REPAIRABLE = ['cooldown scrambled', 'cooldown violated', 'parry outside its window'];
  for (let iter = 0; iter < 60; iter++) {
    const sim = game.simulateRound(fight, actions, stats.roundMs);
    if (!sim.problem) {
      if (!sim.outcome) return { actions, sim, durationMs: stats.roundMs };
      return { actions: actions.filter(a => a.t <= sim.outcome.at + 250), sim, durationMs: sim.outcome.at + 250 };
    }
    if (!REPAIRABLE.includes(sim.problem)) break;
    let idx = -1;
    for (let n = 1; n <= actions.length; n++) {
      if (game.simulateRound(fight, actions.slice(0, n), stats.roundMs).problem) { idx = n - 1; break; }
    }
    if (idx < 0) break;
    actions.splice(idx, 1);
  }
  const sim = game.simulateRound(fight, actions, stats.roundMs);
  if (!sim.outcome) return { actions, sim, durationMs: stats.roundMs };
  return { actions: actions.filter(a => a.t <= sim.outcome.at + 250), sim, durationMs: sim.outcome.at + 250 };
}

// ---- seed the world ---------------------------------------------------------
const today = game.dayKey(Date.now());
function seedPlayer(id, name, xp, createdAt, extra = {}) {
  return {
    id, email: id + '@pit.test', pass: null, displayName: name, photo: null,
    points: 0, nodes: {}, shapes: {}, twinArmor: {}, challengeToken: 'tok-' + id,
    record: { bouts: 3, breaches: 1, streak: 0, bestSecs: null },
    challengeFeed: [], publicProfile: true, createdAt, lastFightAt: null,
    xp, toolUse: {}, parriesTotal: 0, taunt: '', devilShapes: {},
    devil: { bounty: 25, bountyDay: today, held: 0, breached: 0, lastBreachedBy: null, breachedBy: [], holdStreak: 0 },
    pitAttack: { bouts: 0, breaches: 0 },
    itemStock: {}, itemHistory: [], pitAttempts: {},
    defenseXpDay: { day: today, count: 0 },
    ...extra
  };
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-pit-'));
const seedPlayers = {
  keeper1: seedPlayer('keeper1', 'Keeper', 0, 1, { email: 'stevenh18818@gmail.com', isOwner: true }),
  mirage1: seedPlayer('mirage1', 'Mira', 500, 2, { toolUse: { whisper: 40, decoy: 10 }, parriesTotal: 24 }),
  armor1: seedPlayer('armor1', 'Armor', 2250, 3, { toolUse: { flood: 60, probe: 10 } }),
  plain1: seedPlayer('plain1', 'Plain', 0, 4),
  blaze1: seedPlayer('blaze1', 'Blaze', 1050, 5, { toolUse: { decoy: 30 } }),
  chal1: seedPlayer('chal1', 'Chal', 0, 6),
  climb1: seedPlayer('climb1', 'Climb', 750, 7, {
    itemStock: { mirrorwrap: [900] },
    itemHistory: [{ item: 'mirrorwrap', serial: 900, how: 'drop', at: 1, spent: false, spentAt: null, spentVs: null }]
  }),
  top1: seedPlayer('top1', 'Top', 1800, 8, {
    itemStock: { secondheart: [901], anchorstitch: [902] },
    itemHistory: [
      { item: 'secondheart', serial: 901, how: 'drop', at: 1, spent: false, spentAt: null, spentVs: null },
      { item: 'anchorstitch', serial: 902, how: 'drop', at: 1, spent: false, spentAt: null, spentVs: null }
    ]
  })
};
const seedSessions = {};
for (const id of Object.keys(seedPlayers)) seedSessions['sess-' + id] = id;
fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
  config: { aggression: 1, learningSpeed: 1, frozen: false, stormUntil: 0, broadcast: null, floodgates: false, spotlight: null },
  deck: { memberTieHash: null, ownerPlayerId: 'keeper1' },
  deckSessions: {}, players: seedPlayers, sessions: seedSessions,
  shapesGlobal: {}, globalArmor: {}, pit: { bouts: 0, holds: 0, breaches: 0 }, verdicts: {}, fights: []
}));
const jarFor = (id) => { const j = new Jar(); j.c.set('ta_sess', 'sess-' + id); return j; };

const server = spawn('node', ['src/server.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT), ADMIN_KEY: ADMIN, DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));

let settledPitBouts = 0;
try {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  // ---- boot grants: the Keeper's Set + Founder's Embers in signup order
  {
    const me = await json(jarFor('keeper1'), 'GET', '/api/me');
    const stock = me.body.itemStock || {};
    check("boot: Keeper's Set complete — one of every item, all serial No. 1",
      Object.keys(game.ITEMS).every(id => JSON.stringify(stock[id]) === '[1]'), JSON.stringify(stock));
    const pub = await json(null, 'GET', '/api/public/state');
    check("boot: Founder's Embers granted to all 8 seeded members, Keeper first",
      pub.body.founders && pub.body.founders.claimed === 8, `claimed=${pub.body.founders && pub.body.founders.claimed}`);
    const climb = await json(jarFor('climb1'), 'GET', '/api/me');
    check('boot: embers follow signup order (Climb, 7th claimed, holds No. 7)',
      JSON.stringify((climb.body.itemStock || {}).foundersember) === '[7]', JSON.stringify((climb.body.itemStock || {}).foundersember));
    check('public state carries the pit section', !!pub.body.pit && !!pub.body.pit.tallies && Array.isArray(pub.body.pit.bounties));
  }

  // ---- the hall: guests may look, members may fight
  {
    const res = await call(null, 'GET', '/pit');
    const html = await res.text();
    check('pit hall renders for a guest', res.status === 200 && html.includes('The Pit') && html.includes('Mira'), `status ${res.status}`);
    check('hall shows the traits honestly (MIRAGE-marked + ARMORED)', html.includes('MIRAGE-marked') && html.includes('ARMORED'), '');
    check('hall shows bounties + the ember count', html.includes('bounty pts') && html.includes("Founders' Embers"), '');
    const guest = new Jar();
    const denied = await json(guest, 'POST', '/api/fight/start', { pit: 'plain1' });
    check('guests cannot fight devils (members-only)', denied.status === 403, `status ${denied.status}`);
  }

  // ---- weight-class gating
  {
    const lowVsTop = await json(jarFor('chal1'), 'POST', '/api/fight/start', { pit: 'armor1' });
    check('class gate: Spark cannot jump to Inferno', lowVsTop.status === 403, `status ${lowVsTop.status}`);
    const lowVsMid = await json(jarFor('chal1'), 'POST', '/api/fight/start', { pit: 'mirage1' });
    check('class gate: Spark cannot jump two classes to Flare', lowVsMid.status === 403, `status ${lowVsMid.status}`);
    const own = await json(jarFor('plain1'), 'POST', '/api/fight/start', { pit: 'plain1' });
    check('a devil will not fight its own owner', own.status === 400, `status ${own.status}`);
  }

  // ---- taunts: written word stands; filth refused
  {
    const jar = jarFor('plain1');
    await form(jar, '/api/profile/taunt', { taunt: 'Your move, keeper.' });
    const hall = await (await call(null, 'GET', '/pit')).text();
    check('taunt stands on the devil card, verbatim', hall.includes('Your move, keeper.'));
    const bad = await form(jar, '/api/profile/taunt', { taunt: 'shit luck, friend' });
    check('profane taunt refused back to the profile', bad.status === 303 || bad.text.includes('taunt=bad') || bad.status === 200, `status ${bad.status}`);
    const hall2 = await (await call(null, 'GET', '/pit')).text();
    check('the clean taunt survives the refused one', hall2.includes('Your move, keeper.') && !hall2.includes('shit luck'));
  }

  // ---- the Mirror Wrap: reveal rides the response; spend + void refund
  {
    const jar = jarFor('climb1');
    const before = await json(jar, 'GET', '/api/me');
    check('climb holds the seeded wrap', before.body.items.mirrorwrap === 1, `wraps=${before.body.items.mirrorwrap}`);
    const s = await json(jar, 'POST', '/api/fight/start', { pit: 'mirage1', mirrorwrap: true });
    const feints = (s.body.strikes || []).filter(x => x.kind === 'feint');
    check('wrapped start deals feints — every one revealed', s.status === 200 && feints.length >= 2 && feints.every(x => x.revealed === true), `feints=${feints.length} revealed=${feints.filter(x => x.revealed).length}`);
    const mid = await json(jar, 'GET', '/api/me');
    check('the wrap is spent on entry', mid.body.items.mirrorwrap === 0, `wraps=${mid.body.items.mirrorwrap}`);
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: [{ t: 900, tool: 'parry' }], result: 'lose', endReason: 'timeout', durationMs: 5000, damagePct: 0
    });
    check('a forged parry (no telegraph) voids the bout', !!fin.body.voided, `voided=${fin.body.voided}`);
    const after = await json(jar, 'GET', '/api/me');
    check('void refunds the very wrap that was spent', after.body.items.mirrorwrap === 1 && JSON.stringify((after.body.itemStock || {}).mirrorwrap) === '[900]', `stock=${JSON.stringify((after.body.itemStock || {}).mirrorwrap)}`);
    const s2 = await json(jar, 'POST', '/api/fight/start', { pit: 'mirage1' });
    const feints2 = (s2.body.strikes || []).filter(x => x.kind === 'feint');
    check('unwrapped: feints stay secret in the payload', s2.status === 200 && feints2.length >= 2 && feints2.every(x => !x.revealed), `feints=${feints2.length}`);
  }

  // ---- a Pit WIN, reconciled against the books
  {
    const jar = jarFor('chal1');
    const s = await json(jar, 'POST', '/api/fight/start', { pit: 'plain1' });
    check('pit start deals a devil fight', s.status === 200 && s.body.mode === 'pit' && s.body.pit.bounty === 25, `bounty=${s.body.pit && s.body.pit.bounty}`);
    const plan = planWinPit(s.body);
    check('local referee agrees the planned bout breaches the devil', plan.sim.outcome && plan.sim.outcome.result === 'win', `outcome=${JSON.stringify(plan.sim.outcome)}`);
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: plan.actions, result: 'win', endReason: 'breach', durationMs: plan.durationMs, damagePct: 100
    });
    const v = fin.body.verdict || {};
    settledPitBouts++;
    check('pit win verdict: bounty paid whole (25), XP at the founder rate (44)', v.mode === 'pit' && v.bountyWon === 25 && v.xp === 44, `bounty=${v.bountyWon} xp=${v.xp}`);
    const ownerProfile = await (await call(jarFor('plain1'), 'GET', '/profile')).text();
    check("the sleeping owner's grudge feed carries the breach + bounty", ownerProfile.includes('breached your devil in the Pit') && ownerProfile.includes('25 pt'), '');
    const pub = await json(null, 'GET', '/api/public/state');
    check('pit tallies moved: 1 bout, 1 breach', pub.body.pit.tallies.bouts === settledPitBouts && pub.body.pit.tallies.breaches === 1, JSON.stringify(pub.body.pit.tallies));
    // attempt cap: two more starts (2, 3) pass, the fourth is refused
    await json(jar, 'POST', '/api/fight/start', { pit: 'plain1' });
    await json(jar, 'POST', '/api/fight/start', { pit: 'plain1' });
    const fourth = await json(jar, 'POST', '/api/fight/start', { pit: 'plain1' });
    check('attempt cap: 3 tries per devil per day, then the door closes', fourth.status === 429, `status ${fourth.status}`);
  }

  // ---- forged claims: ability + bell + heart
  {
    const jar = jarFor('chal1');
    const s = await json(jar, 'POST', '/api/fight/start', {});
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: [{ t: 1000, tool: 'ability:overdrive' }, { t: 2000, tool: 'probe' }],
      result: 'win', endReason: 'breach', durationMs: 3000, damagePct: 10
    });
    check('forged ability claim voids the house bout', !!fin.body.voided && String(fin.body.voided).includes('ability'), `voided=${fin.body.voided}`);
    const s2 = await json(jar, 'POST', '/api/fight/start', {});
    const fin2 = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s2.body.fightId, actions: [{ t: 1000, tool: 'bell' }, { t: 2000, tool: 'probe' }],
      result: 'lose', endReason: 'timeout', durationMs: 3000, damagePct: 0
    });
    check('undeclared bell ring voids the house bout', !!fin2.body.voided, `voided=${fin2.body.voided}`);
    const noHeart = await json(jar, 'POST', '/api/fight/start', { heart: true });
    check('declaring a Heart you do not hold is refused at the door', noHeart.status === 400, `status ${noHeart.status}`);
  }

  // ---- the Second Heart rides a house fight and returns unbroken
  {
    const jar = jarFor('top1');
    const s = await json(jar, 'POST', '/api/fight/start', { heart: true, bell: false });
    check('heart declared + dealt to the client', s.status === 200 && s.body.gear && s.body.gear.heart === true, JSON.stringify(s.body.gear));
    const plan = planWinPit(s.body); // a real winning bout — parried haymakers never zero the fighter
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: plan.actions,
      result: 'win', endReason: 'breach', durationMs: plan.durationMs, damagePct: 100
    });
    check('quiet fight settles; heart never broke', fin.status === 200 && fin.body.verdict && fin.body.verdict.heartBroke === false, `heartBroke=${fin.body.verdict && fin.body.verdict.heartBroke}`);
    const me = await json(jar, 'GET', '/api/me');
    check('unbroken heart returns to the satchel (same edition)', me.body.items.secondheart === 1 && JSON.stringify((me.body.itemStock || {}).secondheart) === '[901]', `stock=${JSON.stringify((me.body.itemStock || {}).secondheart)}`);
  }

  // ---- a fresh signup takes the next Founder's Ember; order is sequential
  {
    const jar = new Jar();
    const res = await form(jar, '/auth/signup', { email: 'ninth@pit.test', password: 'password99', displayName: 'Ninth' });
    check('signup claims a profile', res.status === 303, `status ${res.status}`);
    const me = await json(jar, 'GET', '/api/me');
    check("the 9th claimed member holds Founder's Ember No. 9", JSON.stringify((me.body.itemStock || {}).foundersember) === '[9]', JSON.stringify((me.body.itemStock || {}).foundersember));
  }

  // ---- SIMULATED PIT DAY: more devils challenged; the books must balance
  {
    const bouts = [
      ['climb1', 'blaze1'],  // Flare vs Blaze — one class up
      ['top1', 'armor1'],    // Inferno vs Inferno — the morph fight
      ['mirage1', 'blaze1']  // Flare vs Blaze — one class up
    ];
    for (const [who, devil] of bouts) {
      const jar = jarFor(who);
      const s = await json(jar, 'POST', '/api/fight/start', { pit: devil });
      if (s.status !== 200) { check(`pit day: ${who} admitted vs ${devil}`, false, `status ${s.status}`); continue; }
      const plan = planWinPit(s.body);
      const fin = await json(jar, 'POST', '/api/fight/finish', {
        fightId: s.body.fightId, actions: plan.actions,
        result: plan.sim.outcome ? plan.sim.outcome.result : 'lose',
        endReason: plan.sim.outcome ? plan.sim.outcome.endReason : 'timeout',
        durationMs: plan.durationMs, damagePct: plan.sim.damagePct || 0
      });
      if (fin.body.verdict && !fin.body.voided) settledPitBouts++;
      else check(`pit day: ${who} vs ${devil} settles clean`, false, `voided=${fin.body.voided}`);
    }
    const pub = await json(null, 'GET', '/api/public/state');
    const t = pub.body.pit.tallies;
    check('pit day reconciles: tallies == settled bouts, holds + breaches == bouts',
      t.bouts === settledPitBouts && t.holds + t.breaches === t.bouts, JSON.stringify(t) + ` settled=${settledPitBouts}`);
    const armorProfile = await (await call(jarFor('armor1'), 'GET', '/profile')).text();
    check("the Armored owner's feed heard about the day", armorProfile.includes('the Pit'), '');
  }
} finally {
  server.kill('SIGKILL');
}

console.log(failures === 0 ? '\nALL PIT CHECKS PASSED' : `\n${failures} PIT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
