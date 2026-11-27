// THE TWIN ARENA — THE GALACTIC battery (G1: Sector 1 at full depth).
// Unit proofs against the engine (the encounter ladder and its tiers, the
// cleared-sector notch, strike determinism, MIRAGE feints by tier, the
// Herald's glances, attention merge math — sector memory + the Arena's
// +10% pre-read, teachGalactic's filing, attention decay on other-theater
// settles, sortie settlement: banking, the death split, the clear receipt)
// plus a seeded live server walk: the star map's locked-sector honesty,
// the Bridge (profile in the theater), carry correctness (a captain's
// Arena stats and galactic stats are the same numbers), a full eight-
// encounter sortie to the Herald, deployables firing in space, forgery
// refusals, sector-clear persistence across a server restart.
// Usage: node scripts/verify-galactic.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import game from '../src/game.js';

const PORT = 4302;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'test-deck-key';

let failures = 0;
function check(name, cond, evidence) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? '  — ' + evidence : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
async function form(jar, url, fields) {
  const res = await call(jar, 'POST', url, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  return { status: res.status, text: await res.text(), location: res.headers.get('location') || '' };
}

// ===========================================================================
// UNIT — the engine, no server
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

// ---- the ladder: Sector 1's eight encounters, tiers in the Pit's language
check('ladder: pickets, pickets, patrols, squadrons, patrols, squadrons, squadrons, capital',
  JSON.stringify(game.GALACTIC_LADDER) === JSON.stringify(['pickets', 'pickets', 'patrols', 'squadrons', 'patrols', 'squadrons', 'squadrons', 'capital']));
check('tiers: Pickets fly Spark, Patrols Ember, Squadrons and the capital Flare',
  game.galacticEncounter(1).className === 'Spark' && game.galacticEncounter(3).className === 'Ember' &&
  game.galacticEncounter(4).className === 'Flare' && game.galacticEncounter(8).className === 'Flare' &&
  game.galacticEncounter(9) === null && game.galacticEncounter(0) === null);
check('params: the capital is the biggest hull on the ladder, at the boss clock',
  game.galacticEncounterParams(8, false).gateHp === 185 && game.galacticEncounterParams(8, false).roundMs === 150000 &&
  game.galacticEncounterParams(7, false).gateHp < 185 && game.galacticEncounterParams(1, false).gateHp === 100);
check('the cleared notch: a cleared sector flies at exactly ×0.9 aggression for its clearer',
  game.galacticEncounterParams(4, true).aggression === +(game.GALACTIC_TIERS.squadrons.aggr * 0.9).toFixed(3) &&
  game.galacticEncounterParams(4, false).aggression === game.GALACTIC_TIERS.squadrons.aggr);
check('the sketch\u2019s capitals stay in their own sectors (Ledger 2, Choir 3, Heir 5); Sector 1 flies the Herald',
  game.GALACTIC_SECTORS[1].capital.name === 'THE LEDGER' && game.GALACTIC_SECTORS[2].capital.name === 'THE CHOIR' &&
  game.GALACTIC_SECTORS[4].capital.name.includes('UNDERTAKER') && game.GALACTIC_CAPITAL.name === 'THE HERALD' &&
  game.GALACTIC_SECTORS.filter(s => s.playable).length === 1);

// ---- schedules: determinism, feints by tier, the Herald's glances
{
  const a = game.makeGalacticStrikes(777, 4, 135000, {});
  const b = game.makeGalacticStrikes(777, 4, 135000, {});
  check('schedule determinism: same seed + encounter = same sky', JSON.stringify(a) === JSON.stringify(b));
  let picketFeints = 0, squadronFeints = 0;
  for (let seed = 11; seed < 40; seed += 7) {
    picketFeints += game.makeGalacticStrikes(seed, 1, 120000, {}).filter(s => s.kind === 'feint').length;
    picketFeints += game.makeGalacticStrikes(seed, 3, 120000, {}).filter(s => s.kind === 'feint').length;
    squadronFeints += game.makeGalacticStrikes(seed, 4, 135000, {}).filter(s => s.kind === 'feint').length;
  }
  check('MIRAGE feints fly only from Squadrons up — pickets and patrols never lie',
    picketFeints === 0 && squadronFeints > 0, `pickets/patrols feints=${picketFeints} squadrons=${squadronFeints}`);
  const cap = game.makeGalacticStrikes(4242, 8, 150000, { sortieTool: 'whisper' });
  const glances = cap.filter(s => s.kind === 'glance');
  check('THE HERALD: every glance hunts the tool this sortie leans on',
    glances.length > 0 && glances.every(s => s.tool === 'whisper'), `glances=${glances.length}`);
}

// ---- attention: the merge, the filing, the decay
{
  const st = fakeState();
  const p = fakePlayer('att', { shapes: { 'tool:flood': 10 } });
  game.galacticSectorShapes(p, 1)['tool:flood'] = 5;
  const merged = game.galacticFamShapes(p, 1);
  check('attention merge: sector memory in full + the Arena pre-read at +10%',
    Math.abs(merged['tool:flood'] - 6) < 1e-9, `merged=${merged['tool:flood']}`);
  const before = game.galacticAttention(st, p, 1);
  const taught = game.teachGalactic(st, p, 1, [
    { t: 100, tool: 'whisper' }, { t: 900, tool: 'whisper' }, { t: 1700, tool: 'probe' }
  ]);
  check('teachGalactic files patterns to the SECTOR, lessons to the world, nothing to the Arena shapes',
    (game.galacticSectorShapes(p, 1)['tool:whisper'] || 0) > 0 && (st.shapesGlobal['tool:whisper'] || 0) > 0 &&
    !p.shapes['tool:whisper'] && (p.toolUse.whisper || 0) === 2 && taught.newToPlayer.length > 0,
    `sector=${game.galacticSectorShapes(p, 1)['tool:whisper']} global=${st.shapesGlobal['tool:whisper']}`);
  check('attention rises as the sector learns the captain', game.galacticAttention(st, p, 1) > before);
  const sectorBefore = game.galacticSectorShapes(p, 1)['tool:whisper'];
  game.settleFight(st, p, { id: 'fx1', mode: 'breach', storm: false, pointsMult: 1, stats: { roundMs: 150000 } },
    { actions: [{ t: 100, tool: 'probe' }], result: 'win', endReason: 'breach', durationMs: 5000, damagePct: 40, fightStats: null });
  const sectorAfter = game.galacticSectorShapes(p, 1)['tool:whisper'] || 0;
  check('attention decays when the captain hunts elsewhere (a house settle cools the sector ×0.95)',
    sectorAfter < sectorBefore && Math.abs(sectorAfter - sectorBefore * 0.95) < 0.01,
    `${sectorBefore} → ${sectorAfter}`);
}

// ---- carry correctness at the unit level: same build, same numbers
{
  const st = fakeState();
  const p = fakePlayer('carry', {
    nodes: { vec1: true, vec2: true, pat1: true, spd1: true },
    modsOwned: { throughline: true, overclock: true }, modsFitted: { probe: 'throughline', flood: null, whisper: null, decoy: null },
    gear: [{ id: 'cg1', slot: 'flood', tier: 'EPIC', unique: null, serial: null, name: 'Flood Brand of Embers', affixes: [{ kind: 'dmg', value: 0.15, label: 'dmg+15%' }], worn: true, banked: true, at: 1 }]
  });
  const arena = game.effectiveStats(st, p, p.twinArmor, {});
  const sky = game.effectiveStats(st, p, p.twinArmor, { famShapes: game.galacticFamShapes(p, 1), gateHp: 100, roundMs: 120000 });
  check('carry: with an unread sky, galactic tool numbers ARE the Arena numbers (dmg, cooldown, trace, mods)',
    JSON.stringify(arena.tools) === JSON.stringify(sky.tools) &&
    JSON.stringify(arena.mods) === JSON.stringify(sky.mods) &&
    JSON.stringify(arena.abilities) === JSON.stringify(sky.abilities));
  game.galacticSectorShapes(p, 1)['tool:flood'] = 20;
  const read = game.effectiveStats(st, p, p.twinArmor, { famShapes: game.galacticFamShapes(p, 1) });
  check('carry: once the sector has read the captain, only familiarity moves — the build itself never changes',
    read.tools.flood.dmg < arena.tools.flood.dmg && read.tools.flood.cooldown === arena.tools.flood.cooldown &&
    read.tools.probe.dmg === arena.tools.probe.dmg);
}

// ---- sortie settlement: banking, the death split, the clear receipt
{
  const st = fakeState();
  const p = fakePlayer('banker', {
    itemStock: { foundersember: [7] },
    itemHistory: [{ item: 'foundersember', serial: 7, how: 'founder', at: 1, spent: false, spentAt: null, spentVs: null }]
  });
  const piece = (id, tier) => ({ id, slot: 'flood', tier, affixes: [], unique: null, serial: null, name: id, worn: false, banked: false, at: 1 });
  const death = { id: 's-death', playerId: p.id, sectorId: 1, seed: 5, encountersCleared: 3, deepest: 4, score: 430, xp: 54, haul: [piece('d-sturdy', 'STURDY'), piece('d-epic', 'EPIC')], bankedValue: 0, capitalsSlain: 0, sectorCleared: false, startedAt: Date.now() - 60000 };
  const vd = game.finishGalacticSortie(st, p, death, 'death');
  check('death in the Reach: EPIC comes home, STURDY stays among the stars',
    vd.result === 'lose' && vd.galactic.banked.length === 1 && vd.galactic.banked[0].tier === 'EPIC' &&
    vd.galactic.lost.length === 1 && p.gear.length === 1 && game.galacticRecord(p).deaths === 1);
  check('the Ember rides sortie XP too (+10%, floored)', vd.xp === Math.floor(54 * 1.1) && vd.emberBonus === true, `xp=${vd.xp}`);
  const clear = { id: 's-clear', playerId: p.id, sectorId: 1, seed: 6, encountersCleared: 8, deepest: 8, score: 1090, xp: 169, haul: [], bankedValue: 60, capitalsSlain: 1, sectorCleared: true, startedAt: Date.now() - 60000 };
  const vc = game.finishGalacticSortie(st, p, clear, 'cleared');
  check('the clear receipt: the captain\u2019s chart AND the world\u2019s first-clear book, named and dated',
    vc.galactic.sectorCleared === true && vc.galactic.firstClear === true &&
    game.galacticRecord(p).cleared['1'].clears === 1 && !!game.galacticRecord(p).cleared['1'].firstAt &&
    st.galactic.firstClear['1'].playerId === p.id && st.galactic.firstClear['1'].name === 'banker' &&
    st.galactic.capitalsSlain === 1 && game.galacticRecord(p).capitalsSlain === 1);
  const again = { id: 's-again', playerId: p.id, sectorId: 1, seed: 7, encountersCleared: 8, deepest: 8, score: 900, xp: 100, haul: [], bankedValue: 0, capitalsSlain: 1, sectorCleared: true, startedAt: Date.now() };
  const va = game.finishGalacticSortie(st, p, again, 'cleared');
  check('a second clearing counts the clears but never rewrites the first-clear receipt',
    va.galactic.firstClear === false && game.galacticRecord(p).cleared['1'].clears === 2 &&
    st.galactic.firstClear['1'].playerId === p.id);
}

// ---- the planner (the descent battery's discipline, flown in space) ------
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
function planEncounter(startBody, extraActions) {
  const stats = startBody.stats;
  const strikes = startBody.strikes || [];
  const parryReady = (v) => v.energy >= 5 && (v.lastUse.parry === undefined || v.t - v.lastUse.parry >= 1500);
  const whisperLean = (floodGate) => (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    if (v.t >= 40000 && v.abilityReady('secondwind')) return 'secondwind';
    if (v.winding() >= 0 && v.ready('decoy')) return 'decoy';
    if (v.trace > 55 && v.ready('decoy')) return 'decoy';
    if (v.abilityReady('ghost') && v.ready('flood') && v.trace >= 25) return 'ghost';
    if (v.ready('whisper') && v.energy >= 28) return 'whisper';
    if (v.ready('flood') && v.ghostCharges() > 0) return 'flood';
    if (v.ready('flood') && v.trace <= floodGate && v.energy >= 45) return 'flood';
    if (v.abilityReady('overdrive') && v.trace <= 40 && v.energy >= 55) return 'overdrive';
    if (v.ready('decoy') && v.trace > 40) return 'decoy';
    return null;
  };
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
  const allOut = (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    if (v.ready('flood') && v.trace <= 82) return 'flood';
    if (v.ready('probe')) return 'probe';
    if (v.ready('whisper')) return 'whisper';
    if (v.ready('decoy') && v.trace > 70) return 'decoy';
    return null;
  };
  let best = null;
  const score = (sim) => sim.integrityLeft - sim.trace * 0.6;
  for (const pol of [whisperLean(30), whisperLean(38), rhythm, cannon, allOut]) {
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

// ===========================================================================
// LIVE — a seeded world behind the real server
// ===========================================================================
const today = game.dayKey(Date.now());
function seedPlayer(id, name, xp, createdAt, extra = {}) {
  return {
    id, email: id + '@galactic.test', pass: null, displayName: name, photo: null,
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
  captain1: seedPlayer('captain1', 'Captain', 500, 2, {
    nodes: { vec1: true, vec2: true, vec3: true, dec2: true, pat1: true, pat2: true, spd1: true, spd2: true, spd3: true },
    toolUse: { whisper: 120, flood: 80, probe: 30, decoy: 10 },
    itemStock: { foundersember: [7], secondheart: [901] },
    itemHistory: [
      { item: 'foundersember', serial: 7, how: 'founder', at: 1, spent: false, spentAt: null, spentVs: null },
      { item: 'secondheart', serial: 901, how: 'drop', at: 1, spent: false, spentAt: null, spentVs: null }
    ],
    modsOwned: { ...ALL_MODS },
    modsFitted: { probe: 'throughline', flood: 'emberline', whisper: 'ashenveil', decoy: 'paybackcoil' },
    gear: [
      { id: 'g-ember', slot: 'flood', tier: 'LEGENDARY', unique: 'emberbrand', serial: 1, name: 'EMBERBRAND', affixes: [aff('dmg', 0.2), aff('splash', 4), aff('cd', 0.1)], worn: true, banked: true, at: 1 },
      { id: 'g-plate', slot: 'body', tier: 'EPIC', unique: null, serial: null, name: 'Keeper Plate of the Wall', affixes: [aff('plating', 25), aff('coolant', 0.5), aff('parry', 200)], worn: true, banked: true, at: 1 },
      { id: 'g-lens', slot: 'probe', tier: 'RARE', unique: null, serial: null, name: 'Probe Lens of the Long Look', affixes: [aff('mark', 0.5), aff('famshield', 0.3)], worn: false, banked: true, at: 1 }
    ]
  }),
  rookie1: seedPlayer('rookie1', 'Rookie', 0, 3, {
    nodes: { vec1: true, vec2: true, pat1: true, spd1: true, spd2: true }
  })
};
const seedSessions = {};
for (const id of Object.keys(seedPlayers)) seedSessions['sess-' + id] = id;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-galactic-'));
function writeSeed() {
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
    config: { aggression: 1, learningSpeed: 1, frozen: false, stormUntil: 0, broadcast: null, floodgates: false, spotlight: null },
    deck: { memberTieHash: null, ownerPlayerId: 'keeper1' },
    deckSessions: {}, players: seedPlayers, sessions: seedSessions,
    shapesGlobal: {}, globalArmor: {}, pit: { bouts: 0, holds: 0, breaches: 0 },
    descent: { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 },
    galactic: { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} },
    gearSeq: { _inst: 50, emberbrand: 1 },
    itemsSeq: { mirrorwrap: 0, anchorstitch: 0, secondheart: 901, stillbell: 0, foundersember: 7 },
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

  // ---- the theater door: the map, the locked sectors' honesty, the strip
  {
    const guest = await (await call(new Jar(), 'GET', '/galactic')).text();
    check('the star map opens on Sector 1 with the Herald named',
      guest.includes('EMBERFALL REACH') && guest.includes('THE HERALD'));
    check('locked sectors carry their honest reasons on their faces',
      guest.includes('THE LEDGER') && guest.includes('THE CHOIR') && guest.includes('UNDERTAKER') &&
      guest.includes('Held for the next campaign') && guest.includes('Uncharted'));
    check('the dueling field is drawn and sealed, honestly (G3 is not this build)',
      guest.includes('DUELING FIELD') && guest.includes('sealed until Phase G3'));
    check('guests are told the sky is members-only, on its face',
      guest.includes('members-only') && guest.includes('CLAIM A PROFILE TO FLY'));
    const member = await (await call(jarFor('captain1'), 'GET', '/galactic')).text();
    check('exactly one playable door stands on the map (Sector 1 only)',
      (member.match(/CHALLENGE THE ARMADA/g) || []).length === 1);
    check('a captain gets the command strip: ship, FIGHT, and the Bridge one tap off',
      member.includes('gstrip') && member.includes('⚔ FIGHT') && member.includes('THE BRIDGE') && member.includes('ATTENTION'));
    const flyGuest = await (await call(new Jar(), 'GET', '/galactic/fly')).text();
    check('the fly door is members-only for guests, boards readable',
      flyGuest.includes('members-only') && flyGuest.includes('sortie boards'));
    const fly = await (await call(jarFor('captain1'), 'GET', '/galactic/fly')).text();
    check('the fly screen stages the battle: hull HUD, systems row, shield flare plate',
      fly.includes('ENEMY HULL') && fly.includes('SHIELD FLARE') && fly.includes('modrail') && fly.includes('BEGIN THE SORTIE'));
    const denied = await json(new Jar(), 'POST', '/api/galactic/start', {});
    check('guests cannot start a sortie', denied.status === 403, `status ${denied.status}`);
  }

  // ---- THE BRIDGE: the whole profile, in the theater's dress
  {
    const bridge = await (await call(jarFor('captain1'), 'GET', '/galactic/bridge')).text();
    check('the Bridge flies the captain\u2019s own ship, drawn from the build (SVG, tier-trimmed)',
      bridge.includes('class="ship big"') && bridge.includes('EMBERBRAND') && bridge.includes('FLOOD CANNONS'));
    check('the Bridge carries identity, level and the Ember mark',
      bridge.includes('Captain') && bridge.includes("Founder's Ember No. 7") && bridge.includes('classchip'));
    check('the Bridge carries every theater\u2019s record — Arena, Pit, Descent, Galactic',
      bridge.includes('The Arena') && bridge.includes('The Pit') && bridge.includes('The Descent') && bridge.includes('The Galactic'));
    check('the Bridge carries the collection: numbered items with serials, mods aboard',
      bridge.includes('THE SECOND HEART') && bridge.includes('No. 901') && bridge.includes('Mods aboard'));
    check('the Bridge refits: unworn satchel pieces can be mounted without leaving the theater',
      bridge.includes('Mount on hull') && bridge.includes('name="back" value="bridge"'));
    const guestBridge = await (await call(new Jar(), 'GET', '/galactic/bridge')).text();
    check('the Bridge is the captain\u2019s own — guests get the claim door',
      guestBridge.includes('Claim your profile'));
    const jar = jarFor('captain1');
    const unw = await form(jar, '/api/gear/unwear', { slot: 'flood', back: 'bridge' });
    check('refit from the Bridge returns to the Bridge', unw.status === 303 && unw.location === '/galactic/bridge', `loc ${unw.location}`);
    const meA = await json(jar, 'GET', '/api/me');
    check('the unmount landed in the one shared book', !(meA.body.wornGear && meA.body.wornGear.flood), '');
    const wear = await form(jar, '/api/gear/wear', { gearId: 'g-ember', back: 'bridge' });
    const meB = await json(jar, 'GET', '/api/me');
    check('remounting from the Bridge restores the build', wear.status === 303 && meB.body.wornGear.flood.name === 'EMBERBRAND', '');
  }

  // ---- carry correctness, live: the rookie's Arena numbers = galactic numbers
  {
    const jar = jarFor('rookie1');
    const sky = await json(jar, 'POST', '/api/galactic/start', {});
    check('a rookie\u2019s sortie opens at Encounter 1 against the pickets',
      sky.status === 200 && sky.body.galactic.kind === 'pickets' && sky.body.galactic.encounter === 1,
      `kind=${sky.body.galactic && sky.body.galactic.kind}`);
    const arena = await json(jar, 'POST', '/api/fight/start', {});
    check('carry, live: galactic tool stats are the Arena tool stats, number for number',
      JSON.stringify(sky.body.stats.tools) === JSON.stringify(arena.body.stats.tools) &&
      JSON.stringify(sky.body.stats.mods) === JSON.stringify(arena.body.stats.mods),
      '');
    check('the systems row is dealt in space exactly as in the Arena (empty for the rookie)',
      JSON.stringify(sky.body.stats.mods.deploy) === JSON.stringify(arena.body.stats.mods.deploy));
    const ab = await json(jar, 'POST', '/api/galactic/abandon', { sortieId: sky.body.galactic.sortieId });
    check('abandoning a sortie banks like a withdrawal and writes the verdict',
      ab.body.verdict && ab.body.verdict.mode === 'galactic' && ab.body.verdict.endReason === 'withdraw');
    // cross-theater guard: one chained road at a time
    const run = await json(jar, 'POST', '/api/descent/start', {});
    const blocked = await json(jar, 'POST', '/api/galactic/start', {});
    check('a captain down in the Descent cannot also fly (one chained road)', blocked.status === 409, `status ${blocked.status}`);
    await json(jar, 'POST', '/api/descent/abandon', { runId: run.body.descent.runId });
    const sortie2 = await json(jar, 'POST', '/api/galactic/start', {});
    const blocked2 = await json(jar, 'POST', '/api/descent/start', {});
    check('a captain out in the Galactic cannot also delve', blocked2.status === 409, `status ${blocked2.status}`);
    await json(jar, 'POST', '/api/galactic/abandon', { sortieId: sortie2.body.galactic.sortieId });
  }

  // ---- forgery: an unowned deployable fired in space voids the sortie
  {
    const jar = jarFor('rookie1');
    const s = await json(jar, 'POST', '/api/galactic/start', {});
    const forged = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId,
      actions: [{ t: 300, tool: 'mod:overclock' }, { t: 900, tool: 'probe' }, { t: 3000, tool: 'flood' }],
      result: 'lose', endReason: 'timeout', durationMs: s.body.stats.roundMs, damagePct: 5
    });
    check('forgery: claiming a systems mod you do not own voids the sortie, referee-named',
      !!forged.body.voided && forged.body.galactic && forged.body.galactic.over === true,
      `voided=${forged.body.voided}`);
    const again = await json(jar, 'POST', '/api/galactic/start', {});
    check('a voided sortie frees the captain to fly again', again.status === 200, `status ${again.status}`);
    await json(jar, 'POST', '/api/galactic/abandon', { sortieId: again.body.galactic.sortieId });
  }

  // ---- THE FULL SORTIE: captain1 through all eight encounters to the Herald
  let firstSortieAttention = null;
  {
    const jar = jarFor('captain1');
    const start = await json(jar, 'POST', '/api/galactic/start', {});
    check('the sortie opens: Encounter 1, pickets, carried integrity from the hull plate (125)',
      start.status === 200 && start.body.galactic.encounter === 1 && start.body.stats.combat.startIntegrity === 125,
      `integrity=${start.body.stats && start.body.stats.combat.startIntegrity}`);
    const dbl = await json(jar, 'POST', '/api/galactic/start', {});
    check('a second sortie while one is open is refused', dbl.status === 409, `status ${dbl.status}`);
    const early = await json(jar, 'POST', '/api/galactic/choose', { sortieId: start.body.galactic.sortieId, choice: 'press' });
    check('no choice stands open before an encounter is cleared', early.status === 409, `status ${early.status}`);

    let payload = start.body;
    let walkOk = true;
    let feintsSeen = 0;
    const kindsSeen = [];
    for (let n = 1; n <= 8 && walkOk; n++) {
      const gd = payload.galactic;
      kindsSeen.push(gd.kind);
      feintsSeen += (payload.strikes || []).filter(s => s.kind === 'feint').length;
      if (n === 1) {
        check('the systems row rides into space: all four deployables dealt at 2 charges',
          Object.keys(payload.stats.mods.deploy).length === 4 &&
          Object.values(payload.stats.mods.deploy).every(m => m.charges === 2),
          JSON.stringify(Object.keys(payload.stats.mods.deploy)));
        check('fitted mods ride the dealt tools in space (mark ×1.75, burn, shed, coil)',
          payload.stats.tools.probe.mod && payload.stats.tools.probe.markMs === 7000 &&
          !!payload.stats.tools.flood.modBurn && payload.stats.tools.whisper.traceShed === 8 &&
          payload.stats.tools.decoy.paybackCoil === true);
      }
      if (n === 8) {
        check('Encounter 8: THE HERALD holds the Reach, name-plate and gimmick on its face',
          gd.boss && gd.boss.id === 'herald' && gd.boss.name === 'THE HERALD' && gd.boss.line.includes('leans on'),
          JSON.stringify(gd.boss));
      }
      // Encounter 1 also proves deployables FIRE in galactic battles: two
      // rail shots ride the front of the winning log (referee-legal: the
      // Overclock only hastens, the Purge only cools).
      const extra = n === 1 ? [{ t: 300, tool: 'mod:overclock' }, { t: 450, tool: 'mod:tracepurge' }] : null;
      const plan = planEncounter(payload, extra);
      if (!plan || !(plan.sim.outcome && plan.sim.outcome.result === 'win')) {
        check(`encounter ${n}: the planner finds a winning line`, false, `sim=${plan && JSON.stringify(plan.sim.outcome)}`);
        walkOk = false; break;
      }
      const fin = await finishEncounter(jar, payload, plan);
      const fd = fin.body.galactic || {};
      if (n === 1) {
        check('deployables fired in a galactic battle settle clean — not voided, charges spent by the referee',
          !fin.body.voided && fd.over === false && fd.state === 'choice', `voided=${fin.body.voided} state=${fd.state}`);
      }
      if (n < 8) {
        if (fd.over !== false || fd.state !== 'choice') { check(`encounter ${n}: cleared, the press/withdraw choice stands open`, false, JSON.stringify(fd)); walkOk = false; break; }
        const ch = await json(jar, 'POST', '/api/galactic/choose', { sortieId: start.body.galactic.sortieId, choice: 'press' });
        if (ch.status !== 200) { check(`press on to encounter ${n + 1}`, false, `status ${ch.status}`); walkOk = false; break; }
        payload = ch.body;
      } else {
        check('the capital falls: the sector clears, the haul banks on the spot, the sortie ends',
          fd.over === true && fd.sectorCleared === true && (fd.bankedNow || []).length >= 1,
          `cleared=${fd.sectorCleared} banked=${(fd.bankedNow || []).length}`);
        check('the capital\u2019s guaranteed drop is EPIC or LEGENDARY — and never GODFORGED in Sector 1',
          (fd.drops || []).length >= 1 && ['EPIC', 'LEGENDARY'].includes(fd.drops[0].tier),
          JSON.stringify((fd.drops || []).map(p => p.tier)));
        const v = fin.body.verdict || {};
        check('the after-action verdict: a Galactic card, first-clear receipt, XP at the Ember rate',
          v.mode === 'galactic' && v.endReason === 'cleared' && v.galactic && v.galactic.firstClear === true &&
          v.galactic.encountersCleared === 8 && v.xp > 0 && v.emberBonus === true,
          `xp=${v.xp} firstClear=${v.galactic && v.galactic.firstClear}`);
        const me = await json(jar, 'GET', '/api/me');
        check('the record stands: Sector 1 cleared once, one capital slain, deepest Encounter 8',
          me.body.galactic.cleared['1'] && me.body.galactic.cleared['1'].clears === 1 &&
          me.body.galactic.capitalsSlain === 1 && me.body.galactic.deepest === 8,
          JSON.stringify(me.body.galactic));
        firstSortieAttention = me.body.galactic;
      }
    }
    check('the ladder walked in order: pickets → patrols → squadrons → capital',
      JSON.stringify(kindsSeen) === JSON.stringify(['pickets', 'pickets', 'patrols', 'squadrons', 'patrols', 'squadrons', 'squadrons', 'capital']),
      kindsSeen.join(','));
    check('MIRAGE feints were dealt somewhere in the squadron sky', feintsSeen > 0, `feints=${feintsSeen}`);
    const pub = await json(null, 'GET', '/api/public/state');
    check('the public books carry the Galactic: tallies moved, the first-clear receipt is world-visible',
      !!pub.body.galactic && pub.body.galactic.tallies.capitalsSlain === 1 &&
      pub.body.galactic.firstClear['1'] && pub.body.galactic.firstClear['1'].name === 'Captain',
      JSON.stringify(pub.body.galactic && pub.body.galactic.tallies));
  }

  // ---- attention, live: the sector has read the captain; elsewhere cools it
  {
    const jar = jarFor('captain1');
    const s2 = await json(jar, 'POST', '/api/galactic/start', {});
    const famCapped = s2.body.stats.tools.whisper.familiarity;
    check('attention, live: after a full sortie the sector deals a read captain (Whisper familiarity > 0)',
      famCapped > 0, `fam=${famCapped}`);
    check('the cleared notch, live: the second sortie is dealt as a cleared sector\u2019s sky',
      s2.body.galactic.clearedBefore === true, `clearedBefore=${s2.body.galactic.clearedBefore}`);
    await json(jar, 'POST', '/api/galactic/abandon', { sortieId: s2.body.galactic.sortieId });
  }
  {
    // The decay leg flies on the rookie: one leaned encounter teaches the
    // sector his Whisper (below the familiarity cap, so the ×0.95 cooling
    // is visible in the dealt numbers), then a Probe-only house fight —
    // the elsewhere-hunt — cools it.
    const jar = jarFor('rookie1');
    const rs = await json(jar, 'POST', '/api/galactic/start', {});
    const plan = planEncounter(rs.body, null);
    check('the rookie\u2019s first encounter produces a referee-true log', !!plan && !plan.sim.problem,
      `problem=${plan && plan.sim.problem}`);
    const fin = await finishEncounter(jar, rs.body, plan);
    check('the rookie\u2019s encounter settles and teaches the sector', !fin.body.voided, `voided=${fin.body.voided}`);
    if (fin.body.galactic && fin.body.galactic.state === 'choice') {
      await json(jar, 'POST', '/api/galactic/choose', { sortieId: rs.body.galactic.sortieId, choice: 'withdraw' });
    }
    const r2 = await json(jar, 'POST', '/api/galactic/start', {});
    const famBefore = r2.body.stats.tools.whisper.familiarity;
    check('attention, live (rookie): one leaned encounter and the sector has begun to read — below the cap',
      famBefore > 0 && famBefore < 0.75, `fam=${famBefore}`);
    await json(jar, 'POST', '/api/galactic/abandon', { sortieId: r2.body.galactic.sortieId });
    const hf = await json(jar, 'POST', '/api/fight/start', {});
    const finH = await json(jar, 'POST', '/api/fight/finish', {
      fightId: hf.body.fightId, actions: [{ t: 300, tool: 'probe' }],
      result: 'lose', endReason: 'timeout', durationMs: hf.body.stats.roundMs, damagePct: 3
    });
    check('the house fight settles (the elsewhere-hunt itself is honest)', !finH.body.voided, `voided=${finH.body.voided}`);
    const r3 = await json(jar, 'POST', '/api/galactic/start', {});
    const famAfter = r3.body.stats.tools.whisper.familiarity;
    check('attention cooled by the elsewhere-hunt: the next sortie\u2019s Whisper familiarity is lower',
      famAfter < famBefore, `${famBefore} → ${famAfter}`);
    await json(jar, 'POST', '/api/galactic/abandon', { sortieId: r3.body.galactic.sortieId });
  }

  // ---- restart persistence: the clear survives the server (the store's law)
  {
    server.kill('SIGKILL');
    await sleep(600);
    server = bootServer();
    check('the server reboots on the same world', await waitUp());
    const me = await json(jarFor('captain1'), 'GET', '/api/me');
    check('SECTOR CLEAR PERSISTS ACROSS A SERVER RESTART: the receipt is still on the captain\u2019s chart',
      me.body.galactic.cleared['1'] && me.body.galactic.cleared['1'].clears === 1 && me.body.galactic.capitalsSlain === 1,
      JSON.stringify(me.body.galactic.cleared));
    const pub = await json(null, 'GET', '/api/public/state');
    check('the world\u2019s first-clear book survives the restart too',
      pub.body.galactic.firstClear['1'] && pub.body.galactic.firstClear['1'].name === 'Captain');
    const map = await (await call(jarFor('captain1'), 'GET', '/galactic')).text();
    check('the star map itself shows the sector CLEARED after the restart',
      map.includes('CLEARED BY YOU') && map.includes('First cleared by'));
  }

  // ---- the Super Deck's Galactic section (Sector Command)
  {
    const deck = await (await call(new Jar(), 'GET', '/deck?key=' + ADMIN)).text();
    check('the Super Deck carries a GALACTIC — SECTOR COMMAND section',
      deck.includes('THE GALACTIC — SECTOR COMMAND') && deck.includes('Captains of the Reach'));
    check('the deck section reads the theater\u2019s books: tallies and the first-clear receipt',
      deck.includes('sorties flown') && deck.includes('FIRST CLEARED BY') && deck.includes('Captain'));
    check('the deck section names the mint fence on its face (no numbered steel from the deck)',
      deck.includes('The deck never mints numbered steel'));
    const wrong = await json(null, 'POST', '/api/deck/grant-galactic', { key: 'nope', playerId: 'captain1' });
    check('the galactic grant refuses a wrong key', wrong.status === 403, `status=${wrong.status}`);
    const ghost = await json(null, 'POST', '/api/deck/grant-galactic', { key: ADMIN, playerId: 'nobody' });
    check('the galactic grant refuses a fighter who is not there', ghost.status === 404, `status=${ghost.status}`);
    const before = await json(jarFor('captain1'), 'GET', '/api/me');
    const gearBefore = (before.body.gear || []).length;
    const grant = await json(null, 'POST', '/api/deck/grant-galactic', { key: ADMIN, playerId: 'captain1' });
    check('the galactic grant lands: one EPIC piece off the capital table, banked unworn',
      grant.status === 200 && grant.body.granted && grant.body.granted.tier === 'EPIC' &&
      grant.body.granted.slot !== 'god',
      `status=${grant.status} granted=${JSON.stringify(grant.body.granted || null)}`);
    const after = await json(jarFor('captain1'), 'GET', '/api/me');
    const grantedPiece = (after.body.gear || []).find(g => g.id === grant.body.granted.id);
    check('the granted piece rides in the captain\u2019s satchel (gear +1, banked unworn, EPIC — not numbered steel)',
      (after.body.gear || []).length === gearBefore + 1 &&
      !!grantedPiece && !grantedPiece.worn && grantedPiece.tier === 'EPIC',
      `gear ${gearBefore} → ${(after.body.gear || []).length}`);
  }
} finally {
  try { server.kill('SIGKILL'); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL GALACTIC CHECKS PASSED' : `\n${failures} GALACTIC CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
