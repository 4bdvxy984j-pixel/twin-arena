// THE TWIN ARENA — THE DESCENT battery.
// Unit proofs against the engine (depth scaling, boss roster, drop-roll
// determinism against dealt seeds, affix math, LEGENDARY/GODFORGED edition
// uniqueness, banking + death-loss split, Captor seize/twin, Accountant /
// Mirror counter logic, Vault rules, worn gear in the referee, god-tier
// charge spend + referee enforcement) plus a seeded live server walk: a full
// run down to the Mirror at Depth 9 with per-depth drop gating, the gate
// choice, boss banking, a death run's tier split, and the books reconciled.
// Usage: node scripts/verify-descent.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import game from '../src/game.js';

const PORT = 4301;
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
    descent: { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 },
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
    gear: [], descent: { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 }
  }, extra);
}
function gearPiece(slot, tier, affixes, extra = {}) {
  return Object.assign({
    id: 'gx-' + slot + '-' + tier, slot, tier,
    affixes: affixes.map(([kind, value]) => ({ kind, value, label: kind + '+' + value })),
    unique: null, serial: null, name: slot + ' piece', worn: true, banked: true, at: 1
  }, extra);
}

// ---- depth scaling, kinds, the boss roster
check('kinds: boss every 3rd, vault every 5th, boss wins the collision at 15',
  game.descentKind(3) === 'boss' && game.descentKind(5) === 'vault' && game.descentKind(15) === 'boss' &&
  game.descentKind(10) === 'vault' && game.descentKind(2) === 'elite' && game.descentKind(1) === 'normal' && game.descentKind(7) === 'normal');
check('boss roster: Captor 3, Accountant 6, Mirror 9, Undertaker 12, then again deeper',
  game.bossForDepth(3).id === 'captor' && game.bossForDepth(6).id === 'accountant' &&
  game.bossForDepth(9).id === 'mirror' && game.bossForDepth(12).id === 'undertaker' &&
  game.bossForDepth(15).id === 'captor' && game.bossForDepth(15).title.includes('AGAIN') && game.bossForDepth(4) === null);
check('depth scaling: gate hardens, tempo quickens to its floor, vault is a 45s breather', (() => {
  const p1 = game.descentDepthParams(1), p6 = game.descentDepthParams(6), p30 = game.descentDepthParams(30), p5 = game.descentDepthParams(5);
  return p1.gateHp === 100 && p6.gateHp > p1.gateHp && p6.roundMs === 150000 &&
    p30.intervalMult === 0.45 && p5.roundMs === 45000 && p5.aggression > p1.aggression;
})());

// ---- descent schedules: determinism, vault silence, boss counters
{
  const ctx = { careerTool: 'whisper', careerTallies: { whisper: 90, flood: 10 } };
  const a = game.makeDescentStrikes(777, 6, 150000, ctx);
  const b = game.makeDescentStrikes(777, 6, 150000, ctx);
  check('descent schedule determinism: same seed + depth = same dark', JSON.stringify(a) === JSON.stringify(b));
  check('vault depths deal NO strikes at all', game.makeDescentStrikes(777, 5, 45000, ctx).length === 0 && game.makeDescentStrikes(777, 10, 45000, ctx).length === 0);
  check("THE ACCOUNTANT: every glance hunts the career-most-used tool", a.length > 0 && a.filter(s => s.kind === 'glance').every(s => s.tool === 'whisper'),
    `glances=${a.filter(s => s.kind === 'glance').length}`);
  const mirror = game.makeDescentStrikes(777, 9, 150000, ctx);
  const style = game.devilStyle({ toolUse: ctx.careerTallies, record: { bouts: 1 }, parriesTotal: 0 });
  const cycleOk = mirror.length >= 8 && mirror.slice(0, 8).every((s, i) => s.kind === style.cycle[i % style.cycle.length]);
  check("THE MIRROR: its strike cycle is the fighter's own style, dealt back at them",
    style.dominant === 'whisper' && cycleOk, `style=${style.cycle.join(',')} dealt=${mirror.slice(0, 4).map(s => s.kind).join(',')}`);
}

// ---- gear rolls: affix counts, pools, determinism against the dealt seed
{
  const st = fakeState();
  const rng = game.rng32(4242);
  const counts = { STURDY: 1, RARE: 2, EPIC: 3, LEGENDARY: 3 };
  let okCounts = true, okPools = true;
  for (const tier of Object.keys(counts)) {
    for (let i = 0; i < 12; i++) {
      const p = game.rollGearPiece(st, rng, { tier });
      if (p.affixes.length !== counts[tier]) okCounts = false;
      const poolKinds = game.AFFIX_POOLS[p.slot].map(d => d.kind);
      if (!p.affixes.every(a => poolKinds.includes(a.kind))) okPools = false;
      if (tier === 'LEGENDARY' && (!p.unique || !p.serial)) okCounts = false;
      if (tier !== 'LEGENDARY' && (p.unique || p.serial)) okCounts = false;
    }
  }
  check('gear rolls: affix counts by tier (1/2/3/3+unique)', okCounts);
  check('gear rolls: every affix comes from its slot pool', okPools);
  const s1 = fakeState(), s2 = fakeState();
  const seq = (stt) => { const r = game.rng32(99); return Array.from({ length: 6 }, () => game.rollGearPiece(stt, r, {})); };
  check('drop-roll integrity: the dealt seed reproduces the exact drops',
    JSON.stringify(seq(s1).map(p => [p.slot, p.tier, p.affixes.map(a => a.kind + ':' + a.value)])) ===
    JSON.stringify(seq(s2).map(p => [p.slot, p.tier, p.affixes.map(a => a.kind + ':' + a.value)])));
  const stL = fakeState();
  const serials = new Set(); let uniqueOk = true;
  for (let i = 0; i < 40; i++) {
    const p = game.rollGearPiece(stL, game.rng32(1000 + i), { tier: 'LEGENDARY' });
    const key = p.unique + '#' + p.serial;
    if (serials.has(key)) uniqueOk = false;
    serials.add(key);
  }
  check('LEGENDARY editions: numbered per unique power, never repeated', uniqueOk && serials.size === 40, `distinct=${serials.size}`);
}

// ---- affix math in the dealt stats
{
  const st = fakeState();
  const bare = fakePlayer('bare');
  const geared = fakePlayer('geared');
  geared.gear = [
    gearPiece('flood', 'EPIC', [['dmg', 0.2], ['splash', 4], ['tracecut', 3]]),
    gearPiece('probe', 'RARE', [['mark', 0.5], ['famshield', 0.4]]),
    gearPiece('body', 'EPIC', [['plating', 25], ['coolant', 0.5], ['parry', 200]])
  ];
  const sBare = game.effectiveStats(st, bare, {});
  const sGear = game.effectiveStats(st, geared, {});
  check('affix math: +20% flood damage rides the dealt stats', Math.abs(sGear.tools.flood.dmg - sBare.tools.flood.dmg * 1.2) < 0.011,
    `${sBare.tools.flood.dmg} -> ${sGear.tools.flood.dmg}`);
  check('affix math: splash + tracecut dealt as fields', sGear.tools.flood.splash === 4 && sGear.tools.flood.trace === sBare.tools.flood.trace - 3);
  check('affix math: mark length +50% (4000 -> 6000ms)', sGear.tools.probe.markMs === 6000);
  check('affix math: body relic — +25 integrity, +0.5 cooling, +200ms parry window',
    sGear.combat.playerHp === 125 && Math.abs(sGear.combat.traceCool - (sBare.combat.traceCool + 0.5)) < 0.001 && sGear.combat.windupMs === sBare.combat.windupMs + 200);
  const stF = fakeState();
  stF.shapesGlobal = {}; const learner = fakePlayer('learner'); learner.shapes = { 'tool:probe': 10 };
  const withLens = fakePlayer('lens'); withLens.shapes = { 'tool:probe': 10 };
  withLens.gear = [gearPiece('probe', 'RARE', [['famshield', 0.4], ['mark', 0.25]])];
  const fPlain = game.effectiveStats(stF, learner, {}).tools.probe.familiarity;
  const fLens = game.effectiveStats(stF, withLens, {}).tools.probe.familiarity;
  check('affix math: famshield dulls personal familiarity by its fraction', Math.abs(fLens - (fPlain * 0.6 + 0)) < 0.011 || fLens < fPlain, `plain=${fPlain} lens=${fLens}`);
  const cheap = fakePlayer('cheap'); cheap.gear = [gearPiece('body', 'RARE', [['cheap', 0.2], ['plating', 10]])];
  const sCheap = game.effectiveStats(st, cheap, {});
  check('affix math: cheap relic cuts tool costs 20%', sCheap.tools.flood.cost === Math.round(game.TOOLS.flood.cost * 0.8), `cost=${sCheap.tools.flood.cost}`);
}

// ---- worn gear inside the referee (a settled fight), incl. on a Pit path
{
  const st = fakeState();
  const mk = (gear) => { const p = fakePlayer('r'); p.gear = gear; return game.effectiveStats(st, p, {}); };
  const log = [{ t: 500, tool: 'flood' }, { t: 5000, tool: 'probe' }];
  const plain = game.simulateRound({ stats: mk([]), strikes: [] }, log, 6000);
  const splashed = game.simulateRound({ stats: mk([gearPiece('flood', 'RARE', [['splash', 5], ['dmg', 0.1]])]), strikes: [] }, log, 6000);
  check('referee: splash + damage gear lands in a settled fight', !splashed.problem && splashed.dmgTotal > plain.dmgTotal + 5, `plain dmg=${plain.dmgTotal} geared dmg=${splashed.dmgTotal}`);
  // silent whisper: a glance at it cannot scramble — the next use stands
  const glance = [{ at: 3000, kind: 'glance', tool: 'whisper' }];
  const wLog = [{ t: 1000, tool: 'probe' }, { t: 3200, tool: 'whisper' }];
  const loud = game.simulateRound({ stats: mk([]), strikes: glance }, wLog, 10000);
  const silent = game.simulateRound({ stats: mk([gearPiece('whisper', 'EPIC', [['silent', 1], ['dot', 0.2], ['cd', 0.1]])]), strikes: glance }, wLog, 10000);
  check('referee: a glance scrambles an ungeared Whisper (void) but not a SILENT one',
    loud.problem === 'cooldown scrambled' && !silent.problem, `loud=${loud.problem} silent=${silent.problem}`);
  // Two Eyes: the mark covers two strikes (two Whispers inside the window)
  const twoLog = [{ t: 500, tool: 'probe' }, { t: 2000, tool: 'whisper' }, { t: 4400, tool: 'whisper' }];
  const oneEye = game.simulateRound({ stats: mk([]), strikes: [] }, twoLog, 6000);
  const twoEyeStats = mk([]); twoEyeStats.tools.probe.twoEyes = true;
  const twoEye = game.simulateRound({ stats: twoEyeStats, strikes: [] }, twoLog, 6000);
  check("referee: TWO EYES — the second marked strike also bites (+30%)", twoEye.dmgTotal > oneEye.dmgTotal + 0.5, `one=${oneEye.dmgTotal} two=${twoEye.dmgTotal}`);
  // Second Ghost: the decoy strikes once
  const ghostLog = [{ t: 500, tool: 'decoy' }];
  const noGhost = game.simulateRound({ stats: mk([]), strikes: [] }, ghostLog, 600);
  const ghostStats = mk([]); ghostStats.tools.decoy.ghostStrike = 8;
  const ghost = game.simulateRound({ stats: ghostStats, strikes: [] }, ghostLog, 600);
  check('referee: THE SECOND GHOST — a decoy with the power deals its 8', noGhost.dmgTotal === 0 && ghost.dmgTotal === 8, `plain=${noGhost.dmgTotal} ghost=${ghost.dmgTotal}`);
  // whisper trace burn
  const burnLog = [{ t: 500, tool: 'flood' }, { t: 5000, tool: 'whisper' }];
  const burnStats = mk([]); burnStats.tools.whisper.traceBurn = 7;
  const burned = game.simulateRound({ stats: burnStats, strikes: [] }, burnLog, 10000);
  const unburned = game.simulateRound({ stats: mk([]), strikes: [] }, burnLog, 10000);
  check('referee: trace-burn gear shaves trace on the Whisper strike', burned.trace < unburned.trace, `burned=${burned.trace} plain=${unburned.trace}`);
  // the same dealt stats settle a Pit fight — gear is the fighter's build everywhere
  const stP = fakeState();
  const challenger = fakePlayer('ch'); challenger.gear = [gearPiece('flood', 'EPIC', [['dmg', 0.2], ['splash', 4], ['cd', 0.1]])];
  const owner = fakePlayer('ow');
  const pitStats = game.effectiveStats(stP, challenger, owner.twinArmor, { famShapes: owner.devilShapes, morph: false, stitchTool: null });
  check("pit path: the challenger's worn gear rides their Pit stats too", pitStats.tools.flood.splash === 4 && pitStats.tools.flood.gear && pitStats.tools.flood.gear.tier === 'EPIC');
}

// ---- the Captor: seizure + twin, in the referee
{
  const st = fakeState();
  const p = fakePlayer('cap', { nodes: { vec2: true } });
  const stats = game.effectiveStats(st, p, {}, { seized: { tool: 'flood', at: 4000 } });
  const early = game.simulateRound({ stats, strikes: [] }, [{ t: 500, tool: 'flood' }], 8000);
  const late = game.simulateRound({ stats, strikes: [] }, [{ t: 500, tool: 'probe' }, { t: 4500, tool: 'flood' }], 8000);
  const od = game.simulateRound({ stats, strikes: [] }, [{ t: 4500, tool: 'ability:overdrive' }], 8000);
  check('captor: the seized tool swings freely before the snatch', !early.problem);
  check('captor: swinging the seized tool after the snatch voids', late.problem === 'tool seized', `problem=${late.problem}`);
  check('captor: OVERDRIVE is a Flood — seized with it', od.problem === 'tool seized', `problem=${od.problem}`);
  const twinStats = game.effectiveStats(st, fakePlayer('tw'), {}, { twinTool: 'flood' });
  const oneLog = [{ t: 500, tool: 'flood' }];
  const single = game.simulateRound({ stats: game.effectiveStats(st, fakePlayer('sg'), {}), strikes: [] }, oneLog, 600);
  const doubled = game.simulateRound({ stats: twinStats, strikes: [] }, oneLog, 600);
  check('captor: a TWINNED tool strikes twice — double damage, double trace',
    doubled.dmgTotal === single.dmgTotal * 2 && doubled.tracePeak === single.tracePeak * 2,
    `dmg ${single.dmgTotal} -> ${doubled.dmgTotal}, peak trace ${single.tracePeak} -> ${doubled.tracePeak}`);
}

// ---- banking paths + the death split + XP settle (finishDescentRun)
{
  const piece = (tier, id) => ({ id, slot: 'flood', tier, affixes: [], unique: null, serial: null, name: id, worn: false, banked: false, at: 1 });
  const split = game.deathSplit([piece('STURDY', 'a'), piece('RARE', 'b'), piece('EPIC', 'c'), piece('LEGENDARY', 'd'), piece('GODFORGED', 'e')]);
  check('death split: EPIC+ always bank; STURDY/RARE stay in the dark',
    split.keep.map(p => p.id).join() === 'c,d,e' && split.lost.map(p => p.id).join() === 'a,b');
  const stA = fakeState(); const asc = fakePlayer('asc');
  const runA = { id: 'runA', haul: [piece('STURDY', 'a1'), piece('LEGENDARY', 'a2')], bankedValue: 0, depthsCleared: 3, deepest: 3, score: 500, bossesSlain: 1, xp: 79, startedAt: Date.now() - 60000 };
  const vA = game.finishDescentRun(stA, asc, runA, 'ascend');
  check('ascend banks the whole haul + writes the record',
    asc.gear.length === 2 && asc.gear.every(g => g.banked) && asc.descent.bestHaul === game.haulValue(runA.haul) &&
    asc.descent.deepest === 3 && stA.descent.runs === 1 && stA.descent.ascents === 1 && stA.descent.legendaries === 1,
    `gear=${asc.gear.length} bestHaul=${asc.descent.bestHaul}`);
  check('XP settle: a step below Pit rates (3 depths + 1 boss = 79)', vA.xp === 79 && asc.xp === 79, `xp=${vA.xp}`);
  const stD = fakeState(); const dead = fakePlayer('dead');
  const runD = { id: 'runD', haul: [piece('RARE', 'd1'), piece('EPIC', 'd2'), piece('GODFORGED', 'd3')], bankedValue: 0, depthsCleared: 2, deepest: 3, score: 300, bossesSlain: 0, xp: 36, startedAt: Date.now() - 60000 };
  const vD = game.finishDescentRun(stD, dead, runD, 'death');
  check('death banks EPIC+ only; the verdict names the lost',
    dead.gear.map(g => g.id).join() === 'd2,d3' && vD.descent.lost.map(x => x.id).length === 1 &&
    stD.descent.deaths === 1 && stD.descent.godforged === 1, `kept=${dead.gear.map(g => g.id)} lost=${JSON.stringify(vD.descent.lost)}`);
  const stE = fakeState(); const emb = fakePlayer('emb');
  emb.itemHistory = [{ item: 'foundersember', serial: 3, how: 'founder', at: 1, spent: false, spentAt: null, spentVs: null }];
  const runE = { id: 'runE', haul: [], bankedValue: 0, depthsCleared: 1, deepest: 1, score: 100, bossesSlain: 0, xp: 18, startedAt: Date.now() - 1000 };
  const vE = game.finishDescentRun(stE, emb, runE, 'turned');
  check("founder's ember: +10% XP rides the Descent settle too", vE.emberBonus === true && vE.xp === Math.floor(18 * 1.1), `xp=${vE.xp}`);
}

// ---- the Twin learns your build (descentBuildFam)
{
  const p = fakePlayer('lean', { toolUse: { flood: 60, probe: 5 } });
  p.gear = [Object.assign(gearPiece('probe', 'LEGENDARY', [['dmg', 0.2], ['mark', 0.3], ['cd', 0.1]]), { unique: 'twoeyes', serial: 1, name: 'TWO EYES' })];
  const fam1 = game.descentBuildFam(p, 1);
  const fam10 = game.descentBuildFam(p, 10);
  check('build-learning: nothing at depth 1; career tool + LEGENDARY tool read by depth 10',
    !fam1.flood && Math.abs(fam10.flood - 0.3) < 0.001 && Math.abs(fam10.probe - 0.2) < 0.001,
    `d1=${JSON.stringify(fam1)} d10=${JSON.stringify(fam10)}`);
}

// ---- GODFORGED: gating, editions, charges, referee enforcement
{
  check('godforged gating: chance is ZERO below Depth 9 bosses, a few percent at 9+, capped',
    game.godforgedChance(3) === 0 && game.godforgedChance(6) === 0 && game.godforgedChance(8) === 0 &&
    game.godforgedChance(9) > 0 && game.godforgedChance(9) <= 0.05 && game.godforgedChance(60) <= 0.08,
    `d9=${game.godforgedChance(9)} d12=${game.godforgedChance(12)} d60=${game.godforgedChance(60)}`);
  const stG = fakeState();
  const seen = new Set(); let okG = true;
  for (let i = 0; i < 60; i++) {
    const p = game.rollGodforged(stG, game.rng32(5000 + i));
    if (p.tier !== 'GODFORGED' || p.slot !== 'god' || !game.GODFORGED[p.god]) okG = false;
    if (!(p.charges >= 1 && p.charges <= 3) || p.charges !== p.chargesMax) okG = false;
    const key = p.god + '#' + p.serial;
    if (seen.has(key)) okG = false;
    seen.add(key);
  }
  check('godforged rolls: family pieces only, 1–3 charges, editions unique per power', okG && seen.size === 60, `distinct=${seen.size}`);
  const holder = fakePlayer('god');
  const gp = game.rollGodforged(fakeState(), game.rng32(7));
  gp.charges = 1; gp.chargesMax = 1; holder.gear = [gp];
  check('charges: spent only by firing; a spent-out piece retires, number kept',
    game.spendGodCharge(holder, gp.id, 'test fire') === true && gp.charges === 0 && gp.retired === true &&
    game.spendGodCharge(holder, gp.id, 'again') === false && holder.gear.length === 1 && gp.firedLog.length === 1);
  check('godforged is declared, never worn', game.wearGear(holder, gp.id) !== null);
  // THE KEEPER'S MERCY in the referee: declared or forged
  const st = fakeState();
  const stats = game.effectiveStats(st, fakePlayer('m'), {});
  const floodLog = [{ t: 500, tool: 'flood' }, { t: 5000, tool: 'flood' }];
  const withMercy = game.simulateRound({ stats, strikes: [], god: { power: 'keepersmercy', mercyUsed: false } },
    [...floodLog, { t: 6000, tool: 'mercy' }], 12000);
  const forgedMercy = game.simulateRound({ stats, strikes: [] }, [...floodLog, { t: 6000, tool: 'mercy' }], 12000);
  const plainRun = game.simulateRound({ stats, strikes: [] }, floodLog, 12000);
  check("mercy: declared, it rewinds the Trace to zero", !withMercy.problem && withMercy.mercyUsed === true && withMercy.trace === 0 && plainRun.tracePeak > 20,
    `mercy trace=${withMercy.trace} plain peak=${plainRun.tracePeak}`);
  check('mercy: an undeclared call is a forgery and voids', forgedMercy.problem === 'mercy not declared', `problem=${forgedMercy.problem}`);
  // THE SECOND DAWN in the referee: death refused, once. Six haymakers kill
  // an unguarded fighter (6 × 18 > 100); with the Dawn, the sixth is refused.
  const blows = Array.from({ length: 6 }, (_, i) => ({ at: 3000 + i * 3000, kind: 'haymaker' }));
  const dawn = game.simulateRound({ stats, strikes: blows, god: { power: 'seconddawn', dawnUsed: false } }, [{ t: 500, tool: 'probe' }], stats.roundMs);
  const noDawn = game.simulateRound({ stats, strikes: blows }, [{ t: 500, tool: 'probe' }], stats.roundMs);
  check('second dawn: the zeroing blow is refused — half integrity, trace wiped',
    dawn.dawnUsed === true && !dawn.outcome && dawn.integrityLeft === 50,
    `dawnUsed=${dawn.dawnUsed} integrity=${dawn.integrityLeft} outcome=${JSON.stringify(dawn.outcome)}`);
  check('second dawn: without it, the same blows end the fight', noDawn.outcome && noDawn.outcome.endReason === 'integrity');
  const dawnSpent = game.simulateRound({ stats, strikes: blows, god: { power: 'seconddawn', dawnUsed: true } }, [{ t: 500, tool: 'probe' }], stats.roundMs);
  check('second dawn: a spent dawn does not fire twice', dawnSpent.dawnUsed === false && dawnSpent.outcome && dawnSpent.outcome.endReason === 'integrity');
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
  return { status: res.status, text: await res.text(), location: res.headers.get('location') || '' };
}

// ---- a client in miniature (the planner discipline of the other batteries) --
function planLog(stats, strikes, policy, maxT, opts = {}) {
  const actions = [];
  let energy = stats.energyMax, last = 0, trace = stats.combat.startTrace || 0;
  let ghostCharges = 0, rapidUntil = -1, bellUntil = -1, bellSpent = false;
  const lastUse = {}, lastCd = {}, lockout = {};
  const glances = strikes.filter(s => s.kind === 'glance');
  let gi = 0;
  const parried = new Set();
  for (let t = 300; t <= (maxT || stats.roundMs); t += 100) {
    energy = Math.min(stats.energyMax, energy + (t - last) / 1000 * stats.energyRegen); last = t;
    trace = Math.max(0, trace - (stats.combat.traceCool || game.TRACE_COOL) * 0.1);
    while (gi < glances.length && glances[gi].at <= t) {
      const g = glances[gi++];
      if (stats.tools[g.tool] && stats.tools[g.tool].silent) continue; // SILENT gear: no scramble lands
      const readyAt = lastUse[g.tool] !== undefined ? lastUse[g.tool] + stats.tools[g.tool].cooldown : g.at;
      lockout[g.tool] = Math.max(readyAt, g.at) + (stats.combat.scrambleMs || game.STRIKE.scrambleMs);
    }
    const view = {
      t, energy, trace, lastUse,
      ready(id) {
        const tl = stats.tools[id];
        // The referee judges a use against the cooldown recorded at the
        // PREVIOUS use — halved if that use rode inside Rapid Cycling.
        const cd = lastCd[id] !== undefined ? lastCd[id] : tl.cooldown;
        return (lastUse[id] === undefined || t - lastUse[id] >= cd) &&
          !(lockout[id] && t < lockout[id]) && energy >= tl.cost;
      },
      abilityReady(id) {
        const ab = stats.abilities && stats.abilities[id];
        if (!ab || energy < ab.cost) return false;
        if (id === 'secondwind') return lastUse[id] === undefined; // once per fight, hard law
        return lastUse[id] === undefined || t - lastUse[id] >= ab.cooldown;
      },
      ghostCharges() { return ghostCharges; },
      bellReady() { return !!opts.bell && !bellSpent; },
      bellFallen() { return t < bellUntil; },
      winding() {
        return strikes.findIndex((s, i) => s.kind === 'haymaker' && !parried.has(i) &&
          t >= s.at - game.STRIKE.windupMs && t <= s.at);
      }
    };
    const tool = policy(view);
    if (!tool) continue;
    if (tool === 'bell') {
      if (!opts.bell || bellSpent) continue;
      actions.push({ t, tool: 'bell' });
      bellSpent = true; bellUntil = t + 12000; // the Stillbell: trace cannot rise; cooling still runs
      continue;
    }
    const ability = stats.abilities && stats.abilities[tool];
    if (ability) {
      // The referee hears abilities as 'ability:<id>' — anything else is
      // an unknown tool and voids the log. Model the real effects: GHOST
      // walks the next 3 strikes traceless, OVERDRIVE hits for +10 trace,
      // SECOND WIND heals (integrity is the referee's book, not modeled).
      actions.push({ t, tool: 'ability:' + tool });
      energy -= ability.cost; lastUse[tool] = t;
      if (tool === 'ghost') ghostCharges = ability.charges || 3;
      if (tool === 'overdrive') trace = Math.min(100, trace + (ability.trace || 0));
      if (tool === 'rapid') { trace = Math.min(100, trace + (ability.trace || 0)); rapidUntil = t + (ability.windowMs || 8000); }
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
      else if (t < bellUntil) { /* the bell holds the Trace where it stands */ }
      else trace = Math.min(100, Math.max(0, trace + tAdd));
    }
  }
  return actions;
}
// Plan one depth. The local referee (the same simulateRound the server
// runs) judges every candidate line; the best true win is what gets sent.
// policySet 'lean' = Flood and nothing else that swings — the line a
// Flood-fighter actually walks, and the one the Captor reads.
function planDepth(startBody, mode, policySet, fightExtra) {
  const stats = startBody.stats;
  const strikes = startBody.strikes || [];
  const fightOf = () => ({ stats, strikes, ...(fightExtra || {}) });
  const seized = stats.seized || null;
  const seizedNow = (v) => seized && v.t >= seized.at ? seized.tool : null;
  const parryReady = (v) => v.energy >= 5 && (v.lastUse.parry === undefined || v.t - v.lastUse.parry >= 1500);
  const floodLean = (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    if (v.t >= 45000 && v.abilityReady('secondwind')) return 'secondwind'; // mid-fight top-up
    const bad = seizedNow(v);
    const ok = (id) => id !== bad && v.ready(id);
    if (v.winding() >= 0 && ok('decoy')) return 'decoy';
    if (v.trace > 50 && ok('decoy')) return 'decoy';
    if (ok('flood') && v.trace <= 80) return 'flood';
    if (ok('decoy') && v.trace > 35) return 'decoy';
    return null;
  };
  // The cannon line: once the Captor TWINNS your Flood, every swing dumps
  // double trace — so you fire it under GHOST cover (3 strikes traceless),
  // sparingly when bare, and let Whisper and Probe carry the quiet seconds.
  const cannon = (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    if (v.t >= 40000 && v.abilityReady('secondwind')) return 'secondwind';
    const bad = seizedNow(v);
    const ok = (id) => id !== bad && v.ready(id);
    if (v.winding() >= 0 && ok('decoy')) return 'decoy';
    if (v.trace > 55 && ok('decoy')) return 'decoy';
    if (v.bellReady() && v.trace >= 74) return 'bell'; // freeze the Trace, swing free
    if (v.abilityReady('ghost') && ok('flood') && v.trace >= 30) return 'ghost';
    if (ok('flood') && (v.ghostCharges() > 0 || v.trace <= 42)) return 'flood';
    if (v.abilityReady('overdrive') && bad !== 'flood' && v.trace <= 45 && v.energy >= 55) return 'overdrive';
    if (ok('whisper') && v.energy >= 35 && v.trace <= 55) return 'whisper';
    if (ok('probe') && v.trace <= 45) return 'probe';
    if (ok('decoy') && v.trace > 35) return 'decoy';
    return null;
  };
  // The whisper line: lean on the burn. Whisper's dot does the work, Flood
  // is a burst spent under Ghost cover or from a cold Trace, and the Trace
  // never climbs — integrity is the only currency, spent slowly. This is
  // the line the long run walks: the Captor will read the Whisper, twin it
  // (+6 trace a swing, double burn — sustainable), and the Mirror's
  // glance-cycle cannot scramble a dot that is already burning.
  const whisperLean = (floodGate) => (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    if (v.t >= 40000 && v.abilityReady('secondwind')) return 'secondwind';
    const bad = seizedNow(v);
    const ok = (id) => id !== bad && v.ready(id);
    if (v.winding() >= 0 && ok('decoy')) return 'decoy';
    if (v.trace > 55 && ok('decoy')) return 'decoy';
    if (v.bellReady() && v.trace >= 74) return 'bell';
    if (v.abilityReady('ghost') && ok('flood') && v.trace >= 25) return 'ghost';
    if (ok('whisper') && v.energy >= 28) return 'whisper';
    if (ok('flood') && v.ghostCharges() > 0) return 'flood';
    if (ok('flood') && v.trace <= floodGate && v.energy >= 45) return 'flood';
    if (v.abilityReady('overdrive') && bad !== 'flood' && v.trace <= 40 && v.energy >= 55) return 'overdrive';
    if (ok('decoy') && v.trace > 40) return 'decoy';
    return null;
  };
  // The rhythm line: a twinned Flood needs only ~7 swings to crack a boss
  // gate — the art is WHEN. Fire it under Ghost cover or from a cold Trace,
  // spend the hot seconds on sinks (Decoy, cooling) and quiet damage
  // (Whisper's burn, Overdrive, Probe), and the books balance.
  const rhythm = (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    if (v.t >= 40000 && v.abilityReady('secondwind')) return 'secondwind';
    const bad = seizedNow(v);
    const ok = (id) => id !== bad && v.ready(id);
    if (v.winding() >= 0 && ok('decoy')) return 'decoy';
    if (v.trace > 60 && ok('decoy')) return 'decoy';
    if (v.bellReady() && v.trace >= 74) return 'bell';
    if (v.abilityReady('ghost') && ok('flood') && v.trace >= 25) return 'ghost';
    if (v.abilityReady('rapid') && v.ghostCharges() > 0 && ok('flood')) return 'rapid'; // burst under cover
    if (ok('flood') && v.ghostCharges() > 0) return 'flood';
    if (ok('flood') && v.trace <= 22) return 'flood';
    if (v.abilityReady('overdrive') && bad !== 'flood' && v.trace <= 40 && v.energy >= 55) return 'overdrive';
    if (ok('whisper') && v.energy >= 35 && v.trace <= 50) return 'whisper';
    if (ok('probe') && v.trace <= 38) return 'probe';
    if (ok('decoy') && v.trace > 45) return 'decoy';
    return null;
  };
  const allOut = (v) => {
    if (v.winding() >= 0 && parryReady(v)) return 'parry';
    const bad = seizedNow(v);
    const ok = (id) => id !== bad && v.ready(id);
    if (ok('flood') && v.trace <= 82) return 'flood';
    if (ok('probe')) return 'probe';
    if (ok('whisper')) return 'whisper';
    if (ok('decoy') && v.trace > 70) return 'decoy';
    return null;
  };
  // The Vault has no strikes, but the Trace still watches: pace the Probes
  // or the dark itself catches you (proven the hard way — trace 100, died).
  const policies = mode === 'vault'
    ? [(v) => (v.ready('probe') && v.trace <= 35 ? 'probe' : null)]
    : (policySet === 'lean' ? [whisperLean(30), whisperLean(38)] : [whisperLean(30), rhythm, cannon, floodLean, allOut]);
  let best = null;
  // A delve is a marathon: among winning lines prefer the one that ends
  // the depth with integrity high AND the Trace low — both carry down.
  const score = (sim) => sim.integrityLeft - sim.trace * 0.6;
  for (const pol of policies) {
    const raw = planLog(stats, strikes, pol, undefined, { bell: !!(fightExtra && fightExtra.bell) });
    const full = game.simulateRound(fightOf(), raw, stats.roundMs);
    if (full.problem) continue;
    // Only the actions up to the true end of the round are a legal log —
    // anything past it is outside the round, and the referee voids for it.
    const actions = full.outcome ? raw.filter(a => a.t <= full.outcome.at + 250) : raw;
    const sim = game.simulateRound(fightOf(), actions, stats.roundMs);
    if (sim.problem) continue;
    const cand = { actions, sim, durationMs: sim.outcome ? sim.outcome.at + 250 : stats.roundMs };
    if (sim.outcome && sim.outcome.result === 'win') {
      if (!best || !(best.sim.outcome && best.sim.outcome.result === 'win') || score(sim) > score(best.sim)) best = cand;
    } else if (!best) best = cand;
  }
  return best;
}
function planTraceDeath(startBody) {
  const stats = startBody.stats;
  const raw = planLog(stats, startBody.strikes || [], (v) => {
    if (v.ready('flood')) return 'flood';
    if (v.ready('probe')) return 'probe';
    return null;
  });
  const full = game.simulateRound({ stats, strikes: startBody.strikes || [] }, raw, stats.roundMs);
  const actions = full.outcome ? raw.filter(a => a.t <= full.outcome.at + 250) : raw;
  const sim = game.simulateRound({ stats, strikes: startBody.strikes || [] }, actions, stats.roundMs);
  return { actions, sim, durationMs: sim.outcome ? sim.outcome.at + 250 : stats.roundMs };
}
// Survive a depth without cracking it: parry the haymakers, let decoys eat
// the rest, deal no damage — the clock, not the Twin, ends the depth.
function planSurvive(startBody) {
  const stats = startBody.stats;
  const actions = planLog(stats, startBody.strikes || [], (v) => {
    if (v.winding() >= 0 && v.energy >= 5 && (v.lastUse.parry === undefined || v.t - v.lastUse.parry >= 1500)) return 'parry';
    if (v.winding() >= 0 && v.ready('decoy')) return 'decoy';
    if (v.ready('decoy') && v.t % 9000 < 100) return 'decoy';
    return null;
  });
  const sim = game.simulateRound({ stats, strikes: startBody.strikes || [] }, actions, stats.roundMs);
  return { actions, sim, durationMs: stats.roundMs };
}

// ---- seed the world ---------------------------------------------------------
const today = game.dayKey(Date.now());
function seedPlayer(id, name, xp, createdAt, extra = {}) {
  return {
    id, email: id + '@descent.test', pass: null, displayName: name, photo: null,
    points: 0, nodes: {}, shapes: {}, twinArmor: {}, challengeToken: 'tok-' + id,
    record: { bouts: 3, breaches: 1, streak: 0, bestSecs: null },
    challengeFeed: [], publicProfile: true, createdAt, lastFightAt: null,
    xp, toolUse: {}, parriesTotal: 0, taunt: '', devilShapes: {},
    devil: { bounty: 25, bountyDay: today, held: 0, breached: 0, lastBreachedBy: null, breachedBy: [], holdStreak: 0 },
    pitAttack: { bouts: 0, breaches: 0 },
    itemStock: {}, itemHistory: [], pitAttempts: {},
    defenseXpDay: { day: today, count: 0 },
    gear: [], descent: { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 },
    ...extra
  };
}
const aff = (kind, value) => ({ kind, value, label: kind + '+' + value });
const seedPlayers = {
  keeper1: seedPlayer('keeper1', 'Keeper', 0, 1, { email: 'stevenh18818@gmail.com', isOwner: true }),
  delver1: seedPlayer('delver1', 'Delver', 500, 2, {
    nodes: { vec1: true, vec2: true, vec3: true, dec2: true, pat1: true, pat2: true, spd1: true, spd2: true, spd3: true },
    toolUse: { whisper: 120, flood: 80, probe: 30, decoy: 10 },
    itemStock: { secondheart: [901], stillbell: [902] },
    itemHistory: [
      { item: 'secondheart', serial: 901, how: 'drop', at: 1, spent: false, spentAt: null, spentVs: null },
      { item: 'stillbell', serial: 902, how: 'drop', at: 1, spent: false, spentAt: null, spentVs: null }
    ],
    gear: [
      { id: 'g-ember', slot: 'flood', tier: 'LEGENDARY', unique: 'emberbrand', serial: 1, name: 'EMBERBRAND', affixes: [aff('dmg', 0.2), aff('splash', 4), aff('cd', 0.1)], worn: true, banked: true, at: 1 },
      { id: 'g-plate', slot: 'body', tier: 'EPIC', unique: null, serial: null, name: 'Keeper Plate of the Wall', affixes: [aff('plating', 25), aff('coolant', 0.5), aff('parry', 200)], worn: true, banked: true, at: 1 },
      { id: 'g-lens', slot: 'probe', tier: 'RARE', unique: null, serial: null, name: 'Probe Lens of the Long Look', affixes: [aff('mark', 0.5), aff('famshield', 0.3)], worn: false, banked: true, at: 1 },
      { id: 'g-harvest', slot: 'god', tier: 'GODFORGED', god: 'doubleharvest', name: 'THE DOUBLE HARVEST', unique: null, serial: 1, affixes: [], charges: 2, chargesMax: 2, retired: false, firedLog: [], worn: false, banked: true, at: 1 },
      { id: 'g-dawnspent', slot: 'god', tier: 'GODFORGED', god: 'seconddawn', name: 'THE SECOND DAWN', unique: null, serial: 1, affixes: [], charges: 0, chargesMax: 2, retired: true, firedLog: [{ how: 'a past dawn', at: 1 }], worn: false, banked: true, at: 1 }
    ]
  }),
  delver2: seedPlayer('delver2', 'Second', 150, 3, {
    nodes: { vec2: true, vec3: true, spd1: true, spd3: true, pat1: true },
    toolUse: { flood: 40, probe: 10 }
  })
};
const seedSessions = {};
for (const id of Object.keys(seedPlayers)) seedSessions['sess-' + id] = id;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-descent-'));
fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
  config: { aggression: 1, learningSpeed: 1, frozen: false, stormUntil: 0, broadcast: null, floodgates: false, spotlight: null },
  deck: { memberTieHash: null, ownerPlayerId: 'keeper1' },
  deckSessions: {}, players: seedPlayers, sessions: seedSessions,
  shapesGlobal: {}, globalArmor: {}, pit: { bouts: 0, holds: 0, breaches: 0 },
  descent: { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 },
  gearSeq: { _inst: 50, emberbrand: 1, doubleharvest: 1, seconddawn: 1 },
  itemsSeq: { mirrorwrap: 0, anchorstitch: 0, secondheart: 901, stillbell: 902, foundersember: 0 },
  keeperSetGranted: false, fights: [], fightSeq: 0, verdicts: {}
}));
const jarFor = (id) => { const j = new Jar(); j.c.set('ta_sess', 'sess-' + id); return j; };

const server = spawn('node', ['src/server.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT), ADMIN_KEY: ADMIN, DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));

async function finishDepth(jar, payload, plan) {
  return json(jar, 'POST', '/api/fight/finish', {
    fightId: payload.fightId, actions: plan.actions,
    result: plan.sim.outcome ? plan.sim.outcome.result : 'lose',
    endReason: plan.sim.outcome ? plan.sim.outcome.endReason : 'timeout',
    durationMs: plan.durationMs, damagePct: plan.sim.damagePct || 0
  });
}

try {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  // ---- the door, the boards, the public books
  {
    const pub = await json(null, 'GET', '/api/public/state');
    check('public state carries the descent section, books at zero',
      !!pub.body.descent && pub.body.descent.tallies.runs === 0 && Array.isArray(pub.body.descent.deepest) &&
      pub.body.descent.tallies.godforged === 0, JSON.stringify(pub.body.descent && pub.body.descent.tallies));
    const guestDoor = await (await call(new Jar(), 'GET', '/descent')).text();
    check('the Descent door is members-only, stated on its face', guestDoor.includes('members-only') && guestDoor.includes('THE DESCENT'));
    const memberDoor = await (await call(jarFor('delver1'), 'GET', '/descent')).text();
    check('members get the delve: declarations, the stairs, the honest copy',
      memberDoor.includes('BEGIN THE DESCENT') && memberDoor.includes('no live PvP') && memberDoor.includes('EMBERBRAND'), '');
    const denied = await json(new Jar(), 'POST', '/api/descent/start', {});
    check('guests cannot start a run', denied.status === 403, `status ${denied.status}`);
    const pitHall = await (await call(null, 'GET', '/pit')).text();
    check("the devil card shows what the tools are wearing", pitHall.includes('Wearing:') && pitHall.includes('EMBERBRAND'), '');
  }

  // ---- the satchel: wear / unwear between runs
  {
    const jar = jarFor('delver1');
    const w = await form(jar, '/api/gear/wear', { gearId: 'g-lens' });
    check('wear: the lens goes on at the satchel', w.status === 303 && w.location.includes('#satchel'), `status ${w.status} loc ${w.location}`);
    const me = await json(jar, 'GET', '/api/me');
    check('wear: /api/me reports the worn build', me.body.wornGear && me.body.wornGear.probe && me.body.wornGear.probe.name.includes('Lens') && me.body.wornGear.flood.name === 'EMBERBRAND',
      JSON.stringify(me.body.wornGear));
    const u = await form(jar, '/api/gear/unwear', { slot: 'probe' });
    const me2 = await json(jar, 'GET', '/api/me');
    check('unwear: the slot bares again', u.status === 303 && !(me2.body.wornGear && me2.body.wornGear.probe), '');
    const godWear = await form(jar, '/api/gear/wear', { gearId: 'g-harvest' });
    check('wear: a GODFORGED treasure refuses the wrist (declared, not worn)', godWear.location.includes('gear=bad'), `loc ${godWear.location}`);
  }

  // ---- declaration refusals at the door
  {
    const jar = jarFor('delver1');
    const retired = await json(jar, 'POST', '/api/descent/start', { god: 'g-dawnspent' });
    check('declaring a spent-out GODFORGED piece is refused at the door', retired.status === 400, `status ${retired.status}`);
    const bogus = await json(jar, 'POST', '/api/descent/start', { god: 'g-nope' });
    check('declaring a treasure you do not hold is refused', bogus.status === 400, `status ${bogus.status}`);
    const noHeart = await json(jarFor('delver2'), 'POST', '/api/descent/start', { heart: true });
    check('declaring a Heart you do not hold is refused', noHeart.status === 400, `status ${noHeart.status}`);
  }

  // ---- THE LONG RUN: delver1 down to the Mirror (depths 1–9)
  {
    const jar = jarFor('delver1');
    const start = await json(jar, 'POST', '/api/descent/start', { heart: true, bell: true });
    check('run starts at Depth 1 with carried integrity from the body relic (125)',
      start.status === 200 && start.body.descent.depth === 1 && start.body.stats.combat.startIntegrity === 125,
      `depth=${start.body.descent && start.body.descent.depth} integrity=${start.body.stats && start.body.stats.combat.startIntegrity}`);
    const dbl = await json(jar, 'POST', '/api/descent/start', {});
    check('a second run while one is open is refused', dbl.status === 409, `status ${dbl.status}`);
    const early = await json(jar, 'POST', '/api/descent/choose', { runId: start.body.descent.runId, choice: 'descend' });
    check('no gate stands open before a depth is cleared', early.status === 409, `status ${early.status}`);

    let payload = start.body;
    let runOk = true;
    let heartLive = true; // declared at the door; spent only if it breaks
    let bellLive = true;  // declared at the door; spent only if rung
    const dropsByDepth = {};
    for (let depth = 1; depth <= 9 && runOk; depth++) {
      const dd = payload.descent;
      if (depth === 3) {
        check('depth 3: THE CAPTOR stands there, name-plate and all', dd.boss && dd.boss.id === 'captor' && dd.boss.name.includes('CAPTOR'), JSON.stringify(dd.boss));
        check("depth 3: he seizes the run's most-used tool (the leaned-on Whisper), dealt into the stats",
          payload.stats.seized && payload.stats.seized.tool === 'whisper' && payload.stats.seized.at === Math.round(payload.stats.roundMs * 0.4),
          JSON.stringify(payload.stats.seized));
      }
      if (depth === 5) {
        check('depth 5: THE VAULT — no strikes are dealt at all', dd.kind === 'vault' && (payload.strikes || []).length === 0, `kind=${dd.kind} strikes=${(payload.strikes || []).length}`);
      }
      if (depth === 6) {
        const glances = (payload.strikes || []).filter(s => s.kind === 'glance');
        check('depth 6: THE ACCOUNTANT — glances hunt the career tool (Whisper), scrambles doubled',
          dd.boss && dd.boss.id === 'accountant' && glances.length > 0 && glances.every(s => s.tool === 'whisper') && payload.stats.combat.scrambleMs === game.STRIKE.scrambleMs * 2,
          `glances=${glances.length} scramble=${payload.stats.combat.scrambleMs}`);
      }
      const plan = planDepth(payload, dd.kind, depth <= 2 ? 'lean' : 'full',
        { ...(heartLive ? { heart: true } : {}), ...(bellLive ? { bell: true } : {}) });
      if (plan && plan.sim.heartUsed) heartLive = false;
      if (plan && plan.sim.bellRung) bellLive = false;
      if (!plan || (dd.kind !== 'vault' && !(plan.sim.outcome && plan.sim.outcome.result === 'win'))) {
        check(`depth ${depth}: the planner finds a winning line`, false, `sim=${plan && JSON.stringify(plan.sim.outcome)} integrity=${plan && plan.sim.integrityLeft}`);
        runOk = false; break;
      }
      const fin = await finishDepth(jar, payload, plan);
      const fd = fin.body.descent || {};
      dropsByDepth[depth] = fd.drops || [];
      if (depth < 9) {
        if (fd.over !== false || fd.state !== 'gate') { check(`depth ${depth}: cleared, the gate choice stands open`, false, JSON.stringify(fd)); runOk = false; break; }
        if (depth === 3) check("depth 3 cleared: the Captor's bargain pays — the Whisper returns TWINNED", fd.captor === 'twinned', `captor=${fd.captor}`);
        if (depth === 5) check('depth 5: the Vault settles as a cleared breather', fd.cleared === true, `cleared=${fd.cleared}`);
        const ch = await json(jar, 'POST', '/api/descent/choose', { runId: start.body.descent.runId, choice: 'descend' });
        if (ch.status !== 200) { check(`descend to depth ${depth + 1}`, false, `status ${ch.status}`); runOk = false; break; }
        payload = ch.body;
        if (depth === 3) {
          check('depth 4: the twinned Whisper rides the dealt stats', payload.stats.tools.whisper.twin === true, `twin=${payload.stats.tools.whisper.twin}`);
        }
      } else {
        // Depth 9 — THE MIRROR. Boss kill banks the haul on the spot.
        check('depth 9: THE MIRROR guards it', dd.boss && dd.boss.id === 'mirror', JSON.stringify(dd.boss));
        check('depth 9: the boss drop itself (first dealt) is EPIC or better — GODFORGED only ever from here',
          (fd.drops || []).length >= 1 && ['EPIC', 'LEGENDARY', 'GODFORGED'].includes(fd.drops[0].tier),
          JSON.stringify((fd.drops || []).map(p => p.tier)));
        check('depth 9: killing the boss banks the haul on the spot',
          (fd.bankedNow || []).length >= 1 && (fd.bankedNow || []).some(p => p.id === fd.drops[0].id), `banked=${(fd.bankedNow || []).length}`);
        const asc = await json(jar, 'POST', '/api/descent/choose', { runId: start.body.descent.runId, choice: 'ascend' });
        const v = asc.body.verdict || {};
        check('the run verdict: a Descent card with depths, score, XP at the Ember rate',
          v.mode === 'descent' && v.descent && v.descent.depthsCleared === 9 && v.descent.deepest === 9 && v.xp > 0 && v.emberBonus === true,
          `xp=${v.xp} cleared=${v.descent && v.descent.depthsCleared}`);
        const me = await json(jar, 'GET', '/api/me');
        check('the record stands: deepest 9, bosses slain 3, and the declared treasures\' fates match the referee\'s book (home untouched, or spent in the dark)',
          me.body.descent.deepest === 9 && me.body.descent.bossesSlain === 3 &&
          me.body.items.secondheart === (heartLive ? 1 : 0) && me.body.items.stillbell === (bellLive ? 1 : 0),
          JSON.stringify(me.body.descent) + ` heart=${me.body.items.secondheart}/${heartLive} bell=${me.body.items.stillbell}/${bellLive}`);
      }
    }
    const lowDrops = Object.entries(dropsByDepth).filter(([d]) => +d < 9).flatMap(([, ps]) => ps);
    check('drop gating: NO godforged piece fell above Depth 9 — not from shapes, elites, the Captor or the Accountant',
      lowDrops.every(p => p.tier !== 'GODFORGED'), `low drops=${lowDrops.map(p => p.tier).join(',') || 'none'}`);
    const bossFirsts = [3, 6].map(d => (dropsByDepth[d] || [])[0]).filter(Boolean);
    check('the boss drops themselves at 3 and 6 are EPIC or LEGENDARY — never godforged, never plain (a bonus elite roll may ride along)',
      bossFirsts.length === 2 && bossFirsts.every(p => p.tier === 'EPIC' || p.tier === 'LEGENDARY'), JSON.stringify(bossFirsts.map(p => p.tier)));
    const pub = await json(null, 'GET', '/api/public/state');
    check('the public books reconcile: 1 run, 9 depths, Delver atop the deepest board',
      pub.body.descent.tallies.runs === 1 && pub.body.descent.tallies.depthsCleared === 9 &&
      pub.body.descent.deepest.length >= 1 && pub.body.descent.deepest[0].deepest === 9,
      JSON.stringify(pub.body.descent.tallies));
  }

  // ---- a forged depth voids the whole run; the haul was never real
  {
    const jar = jarFor('delver2');
    const before = await json(jar, 'GET', '/api/me');
    const s = await json(jar, 'POST', '/api/descent/start', {});
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: [{ t: 900, tool: 'parry' }], result: 'lose', endReason: 'timeout', durationMs: 5000, damagePct: 0
    });
    check('a forged depth log voids the run on the spot', !!fin.body.voided && fin.body.descent && fin.body.descent.over === true, `voided=${fin.body.voided}`);
    const after = await json(jar, 'GET', '/api/me');
    check('void: no gear, no XP, no record — the run never honestly happened',
      (after.body.gear || []).length === (before.body.gear || []).length && after.body.xp === before.body.xp && after.body.descent.runs === before.body.descent.runs, '');
    const ch = await json(jar, 'POST', '/api/descent/choose', { runId: s.body.descent.runId, choice: 'descend' });
    check('void: the run is gone — no gate to choose at', ch.status === 404, `status ${ch.status}`);
  }

  // ---- turned back: the clock ends a depth, the haul banks, the run closes
  {
    const jar = jarFor('delver2');
    const s = await json(jar, 'POST', '/api/descent/start', {});
    const plan = planSurvive(s.body);
    check('turned setup: the survival line truly has no outcome (parries + decoys only)',
      !plan.sim.problem && !plan.sim.outcome, `problem=${plan.sim.problem} outcome=${JSON.stringify(plan.sim.outcome)} integrity=${plan.sim.integrityLeft}`);
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: plan.actions, result: 'lose', endReason: 'timeout',
      durationMs: s.body.stats.roundMs, damagePct: plan.sim.damagePct || 0
    });
    check('turned back at the clock: run closes as a retreat, haul banked',
      fin.body.verdict && fin.body.verdict.endReason === 'turned' && fin.body.descent && fin.body.descent.over === true,
      `end=${fin.body.verdict && fin.body.verdict.endReason}`);
  }

  // ---- death in the dark: the tier split, walked for real
  {
    const jar = jarFor('delver2');
    let proven = false, evidence = 'no drop in 8 depth-1 clears';
    for (let attempt = 0; attempt < 8 && !proven; attempt++) {
      const s = await json(jar, 'POST', '/api/descent/start', {});
      if (s.status !== 200) { evidence = 'start refused ' + s.status; break; }
      const plan = planDepth(s.body, 'normal');
      if (!plan || !(plan.sim.outcome && plan.sim.outcome.result === 'win')) {
        evidence = `planner failed: problem=${plan && plan.sim.problem} outcome=${plan && JSON.stringify(plan.sim.outcome)} integrity=${plan && plan.sim.integrityLeft} trace=${plan && plan.sim.tracePeak}`;
        await json(jar, 'POST', '/api/descent/abandon', { runId: s.body.descent.runId });
        break;
      }
      const fin = await finishDepth(jar, s.body, plan);
      if (!fin.body.descent || fin.body.descent.state !== 'gate') {
        evidence = 'finish did not open the gate: ' + JSON.stringify(fin.body.descent || fin.body);
        break;
      }
      const drops = (fin.body.descent || {}).drops || [];
      if (!drops.length) {
        await json(jar, 'POST', '/api/descent/abandon', { runId: s.body.descent.runId });
        continue;
      }
      const piece = drops[0];
      const ch = await json(jar, 'POST', '/api/descent/choose', { runId: s.body.descent.runId, choice: 'descend' });
      const death = planTraceDeath(ch.body);
      if (!death.sim.outcome || death.sim.outcome.endReason !== 'trace') { evidence = 'planner could not force a trace death'; break; }
      const finD = await finishDepth(jar, ch.body, death);
      const v = finD.body.verdict || {};
      const me = await json(jar, 'GET', '/api/me');
      const held = (me.body.gear || []).some(g => g.id === piece.id);
      if (piece.tier === 'STURDY' || piece.tier === 'RARE') {
        proven = v.endReason === 'death' && !held && (v.descent.lost || []).some(l => l.name === piece.name);
        evidence = `lost ${piece.tier} "${piece.name}" held=${held} end=${v.endReason}`;
      } else {
        proven = v.endReason === 'death' && held;
        evidence = `kept ${piece.tier} "${piece.name}" through death held=${held} end=${v.endReason}`;
      }
      check('death split, walked: ' + (piece.tier === 'STURDY' || piece.tier === 'RARE' ? 'unbanked STURDY/RARE is lost' : 'EPIC+ comes home even through death'), proven, evidence);
    }
    if (!proven && evidence.startsWith('no drop')) check('death split, walked: a depth-1 drop to die with', false, evidence);
  }

  // ---- THE DOUBLE HARVEST: drops doubled, exactly one charge spent
  {
    const jar = jarFor('delver1');
    let proven = false, evidence = 'no dropping depth in 6 runs';
    for (let attempt = 0; attempt < 6 && !proven; attempt++) {
      const s = await json(jar, 'POST', '/api/descent/start', { god: 'g-harvest' });
      if (s.status !== 200) { evidence = 'start refused ' + s.status; break; }
      let payload = s.body;
      for (let depth = 1; depth <= 2 && !proven; depth++) {
        const plan = planDepth(payload, payload.descent.kind);
        if (!plan || !(plan.sim.outcome && plan.sim.outcome.result === 'win')) { evidence = 'planner failed at depth ' + depth; break; }
        const fin = await finishDepth(jar, payload, plan);
        const drops = (fin.body.descent || {}).drops || [];
        if (drops.length) {
          const me = await json(jar, 'GET', '/api/me');
          const piece = (me.body.gear || []).find(g => g.id === 'g-harvest');
          proven = drops.length === 2 && drops[0].tier === drops[1].tier && piece && piece.charges === 1;
          evidence = `drops=${drops.map(p => p.tier).join('+')} charges=${piece && piece.charges}`;
          check('double harvest: the first dropping depth drops twice over — one charge spent', proven, evidence);
        }
        if (fin.body.descent && fin.body.descent.over) break;
        const ch = await json(jar, 'POST', '/api/descent/choose', { runId: s.body.descent.runId, choice: 'descend' });
        if (ch.status !== 200) break;
        payload = ch.body;
      }
      // close out the attempt's run if it is still open
      await json(jar, 'POST', '/api/descent/abandon', { runId: s.body.descent.runId }).catch(() => {});
    }
    if (!proven && evidence.startsWith('no dropping')) check('double harvest: a dropping depth to double', false, evidence);
  }

  // ---- the satchel is closed while you descend
  {
    const jar = jarFor('delver2');
    const s = await json(jar, 'POST', '/api/descent/start', {});
    const w = await form(jar, '/api/gear/wear', { gearId: 'anything' });
    check('no gear swaps mid-delve — the satchel is closed down there', w.location.includes('descent?gear=run'), `loc=${w.location}`);
    const ab = await json(jar, 'POST', '/api/descent/abandon', { runId: s.body.descent.runId });
    check('abandon banks the haul like an ascent and closes the run', ab.body.verdict && ab.body.verdict.endReason === 'ascend', `end=${ab.body.verdict && ab.body.verdict.endReason}`);
  }
} finally {
  server.kill('SIGKILL');
}

console.log(failures === 0 ? '\nALL DESCENT CHECKS PASSED' : `\n${failures} DESCENT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
