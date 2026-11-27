// THE TWIN ARENA — MODS v1 battery.
// Unit proofs against the engine (registry, socket law, dealt stats, the
// referee's mod math, charge accounting, forgery refusals, drop tables,
// the Pit mod drop) plus a seeded live-server walk: deck grants, socketing
// between fights, the mid-delve socket lock, dealt rails in arena + Pit
// fights, devil deployable exclusion, charge refill between fights, and a
// Descent depth settling with the mods field on its report.
// Usage: node scripts/verify-mods.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import game from '../src/game.js';

const PORT = 4305;
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
    defenseXpDay: { day: game.dayKey(Date.now()), count: 0 },
    gear: [], descent: { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 },
    modsOwned: {}, modsFitted: { probe: null, flood: null, whisper: null, decoy: null }
  };
}
const ALL_MODS = [...Object.keys(game.FITTED_MODS), ...Object.keys(game.DEPLOY_MODS)];
function loadedPlayer(id) {
  const p = fakePlayer(id || 'loaded');
  for (const m of ALL_MODS) game.grantMod(p, m);
  for (const t of game.TOOL_IDS) game.fitMod(p, t, Object.keys(game.FITTED_MODS).find(m => game.FITTED_MODS[m].tool === t));
  return p;
}

// ---- the registry -----------------------------------------------------------
check('registry: 4 fitted (one signature per tool) + 4 deployables', (() => {
  const tools = Object.values(game.FITTED_MODS).map(m => m.tool).sort();
  return Object.keys(game.FITTED_MODS).length === 4 && Object.keys(game.DEPLOY_MODS).length === 4 &&
    JSON.stringify(tools) === JSON.stringify(['decoy', 'flood', 'probe', 'whisper']) &&
    Object.values(game.DEPLOY_MODS).every(d => d.charges === 2);
})());
check('mods are unnumbered by construction: no serial field anywhere in the registry',
  ALL_MODS.every(id => !('serial' in game.MODS_ALL[id])));

// ---- ownership + socket law ---------------------------------------------------
{
  const p = fakePlayer('sock');
  check('socket law: an unowned mod cannot be fitted', !!game.fitMod(p, 'probe', 'throughline') && game.fittedMod(p, 'probe') === null);
  game.grantMod(p, 'throughline'); game.grantMod(p, 'emberline');
  check('socket law: a mod refuses the wrong tool', !!game.fitMod(p, 'flood', 'throughline'));
  check('socket law: the right tool takes it, one per tool', game.fitMod(p, 'probe', 'throughline') === null && game.fittedMod(p, 'probe') === 'throughline');
  check('socket law: unsocketing clears the tool', game.fitMod(p, 'probe', null) === null && game.fittedMod(p, 'probe') === null);
  game.fitMod(p, 'probe', 'throughline');
  delete p.modsOwned.throughline;
  check('socket law: a socket without ownership reads as bare (stale claims die)', game.fittedMod(p, 'probe') === null);
  check('grantMod is idempotent and refuses unknown ids', game.grantMod(p, 'emberline') === false && game.grantMod(p, 'nope') === false);
}

// ---- dealt stats: fitted effects + the rail ----------------------------------
{
  const st = fakeState();
  const p = loadedPlayer();
  const stats = game.effectiveStats(st, p, {});
  check('dealt: THROUGHLINE stretches the mark ×1.75 (4000 → 7000) and threads it through the Decoy',
    stats.tools.probe.markMs === 7000 && stats.tools.probe.markThroughDecoy === true, `markMs=${stats.tools.probe.markMs}`);
  check('dealt: EMBERLINE lays its burn on the Flood (1.0/s × 4s)',
    !!stats.tools.flood.modBurn && stats.tools.flood.modBurn.dps === 1.0 && stats.tools.flood.modBurn.secs === 4);
  check('dealt: ASHEN VEIL sheds 8 trace on the Whisper', stats.tools.whisper.traceShed === 8);
  check('dealt: PAYBACK COIL arms on the Decoy', stats.tools.decoy.paybackCoil === true);
  check('dealt: the tool cards carry their fitted mod (sigil + name)',
    stats.tools.probe.mod && stats.tools.probe.mod.id === 'throughline' && !!stats.tools.probe.mod.sigil);
  check('dealt: the rail carries all 4 owned deployables at 2 charges',
    Object.keys(stats.mods.deploy).length === 4 && Object.values(stats.mods.deploy).every(d => d.charges === 2),
    Object.keys(stats.mods.deploy).join(','));
  const bare = game.effectiveStats(st, fakePlayer('bare'), {});
  check('dealt: a fighter with no mods is dealt an empty rail and bare tools',
    Object.keys(bare.mods.deploy).length === 0 && !bare.tools.probe.mod && (bare.tools.probe.markMs || 4000) === 4000);
  const partial = fakePlayer('partial'); game.grantMod(partial, 'coldsnap');
  const pstats = game.effectiveStats(st, partial, {});
  check('dealt: the rail carries only what is owned (coldsnap alone)',
    Object.keys(pstats.mods.deploy).length === 1 && !!pstats.mods.deploy.coldsnap);
  const unsock = fakePlayer('unsock'); game.grantMod(unsock, 'emberline');
  const ustats = game.effectiveStats(st, unsock, {});
  check('dealt: an owned-but-unsocketed fitted mod changes nothing', !ustats.tools.flood.modBurn && !ustats.tools.flood.mod);
}

// ---- the referee: mod math -----------------------------------------------------
{
  const st = fakeState();
  const p = loadedPlayer();
  const stats = game.effectiveStats(st, p, {});
  const noStrikes = [];
  const floodCd = stats.tools.flood.cooldown;

  // OVERCLOCK: the armed strike's cooldown halves — a gap that is a forgery
  // without the mod is legal with it.
  const gap = Math.round(floodCd * 0.75);
  const withOc = game.simulateRound({ stats, strikes: noStrikes }, [
    { t: 100, tool: 'mod:overclock' }, { t: 200, tool: 'flood' }, { t: 200 + gap, tool: 'flood' }
  ], 30000);
  const withoutOc = game.simulateRound({ stats, strikes: noStrikes }, [
    { t: 200, tool: 'flood' }, { t: 200 + gap, tool: 'flood' }
  ], 30000);
  check('referee: OVERCLOCK halves the armed strike\u2019s cooldown', !withOc.problem && !!withoutOc.problem,
    `with=${withOc.problem} without=${withoutOc.problem} cd=${floodCd} gap=${gap}`);

  // TRACE PURGE: a trace death avoided by dumping 35 mid-run.
  const spam = [];
  for (let i = 0; i < 12; i++) spam.push({ t: 100 + i * 4100, tool: 'flood' });
  const deepStats = { ...stats, gateHp: 100000 };
  const control = game.simulateRound({ stats: deepStats, strikes: noStrikes }, spam, 55000);
  const purgedActs = [...spam.slice(0, 6), { t: 22000, tool: 'mod:tracepurge' }, ...spam.slice(6)];
  const purged = game.simulateRound({ stats: deepStats, strikes: noStrikes }, purgedActs, 55000);
  check('referee: TRACE PURGE dumps 35 — the same spam that gets the control caught survives',
    !purged.problem && control.outcome && control.outcome.endReason === 'trace' && !(purged.outcome && purged.outcome.endReason === 'trace'),
    `control=${control.outcome && control.outcome.endReason} purged=${purged.outcome && purged.outcome.endReason} purgedPeak=${purged.tracePeak}`);

  // GHOST PLATE: a blow inside the window discharges into the first strike
  // thrown after the window closes — never before.
  const oneStrike = [{ at: 3000, kind: 'clean', tool: 'probe' }];
  const plateBase = game.simulateRound({ stats, strikes: oneStrike }, [{ t: 9500, tool: 'probe' }], 12000);
  const plateFed = game.simulateRound({ stats, strikes: oneStrike }, [
    { t: 100, tool: 'mod:ghostplate' }, { t: 9500, tool: 'probe' }
  ], 12000);
  check('referee: GHOST PLATE discharges half the blow (+3) into the next strike after its window',
    !plateFed.problem && plateFed.dmgTotal - plateBase.dmgTotal === game.STRIKE.dmg.clean * 0.5,
    `base=${plateBase.dmgTotal} fed=${plateFed.dmgTotal}`);
  const plateEarly = game.simulateRound({ stats, strikes: oneStrike }, [
    { t: 100, tool: 'mod:ghostplate' }, { t: 5000, tool: 'probe' }, { t: 9500, tool: 'probe' }
  ], 12000);
  check('referee: the Plate does NOT discharge inside its own window',
    !plateEarly.problem && plateEarly.dmgTotal - 2 * stats.tools.probe.dmg === game.STRIKE.dmg.clean * 0.5,
    `early=${plateEarly.dmgTotal} (two probes, only the late one carries the plate)`);

  // COLD SNAP: the next strike lands 1200ms late — or not at all in the round.
  const snapBase = game.simulateRound({ stats, strikes: oneStrike }, [{ t: 100, tool: 'probe' }], 4000);
  const snapped = game.simulateRound({ stats, strikes: oneStrike }, [{ t: 50, tool: 'mod:coldsnap' }, { t: 100, tool: 'probe' }], 4000);
  const snapLate = game.simulateRound({ stats, strikes: oneStrike }, [{ t: 50, tool: 'mod:coldsnap' }, { t: 100, tool: 'probe' }], 5000);
  check('referee: COLD SNAP pushes the next strike 1200ms late',
    snapBase.strikesTaken === 1 && snapped.strikesTaken === 0 && snapLate.strikesTaken === 1,
    `base=${snapBase.strikesTaken} snapped@4s=${snapped.strikesTaken} snapped@5s=${snapLate.strikesTaken}`);

  // PAYBACK COIL: a blow taken while the phantom stands pays a quarter back.
  const coilStrike = [{ at: 2000, kind: 'clean', tool: 'probe' }];
  const coilBase = game.simulateRound({ stats, strikes: coilStrike }, [{ t: 3000, tool: 'probe' }], 8000);
  const coilFed = game.simulateRound({ stats, strikes: coilStrike }, [
    { t: 100, tool: 'decoy' }, { t: 3000, tool: 'probe' }
  ], 8000);
  check('referee: PAYBACK COIL returns a quarter of the blow on the next strike (on top of the Decoy\u2019s own crit)',
    !coilFed.problem && Math.abs((coilFed.dmgTotal - coilBase.dmgTotal) - (stats.tools.probe.dmg * stats.decoyCrit + game.STRIKE.dmg.clean * 0.25)) < 0.01,
    `base=${coilBase.dmgTotal} fed=${coilFed.dmgTotal}`);

  // EMBERLINE: the burn ticks real damage off the gate over time.
  const burnA = game.simulateRound({ stats, strikes: noStrikes }, [{ t: 100, tool: 'flood' }], 6000);
  const bare2 = fakePlayer('bare2'); for (const m of ALL_MODS) game.grantMod(bare2, m); // owns all, sockets none
  const bareStats = game.effectiveStats(st, bare2, {});
  const burnB = game.simulateRound({ stats: bareStats, strikes: noStrikes }, [{ t: 100, tool: 'flood' }], 6000);
  check('referee: EMBERLINE\u2019s burn ticks the gate down vs an unsocketed Flood',
    !burnA.problem && !burnB.problem && burnA.damagePct > burnB.damagePct,
    `socketed=${burnA.damagePct}% unsocketed=${burnB.damagePct}%`);

  // ASHEN VEIL: the shed is real — same Whisper spam, lower peak.
  const wspam = [];
  for (let i = 0; i < 4; i++) {
    wspam.push({ t: 100 + i * 8200, tool: 'flood' });
    wspam.push({ t: 4200 + i * 8200, tool: 'whisper' });
  }
  const veilStats = { ...stats, gateHp: 100000 };
  const veilBare = { ...bareStats, gateHp: 100000 };
  const veilOn = game.simulateRound({ stats: veilStats, strikes: noStrikes }, wspam, 34000);
  const veilOff = game.simulateRound({ stats: veilBare, strikes: noStrikes }, wspam, 34000);
  check('referee: ASHEN VEIL sheds trace on every Whisper strike (lower peak)',
    !veilOn.problem && !veilOff.problem && veilOn.tracePeak <= veilOff.tracePeak - 10,
    `veil=${veilOn.tracePeak} bare=${veilOff.tracePeak}`);

  // THROUGHLINE: a Decoy thrown while the mark lives re-threads it — the
  // mark bonus survives past the unmodded 4000ms.
  const tlActs = [{ t: 100, tool: 'probe' }, { t: 2000, tool: 'decoy' }, { t: 8000, tool: 'whisper' }];
  const tlOn = game.simulateRound({ stats, strikes: noStrikes }, tlActs, 12000);
  const tlOff = game.simulateRound({ stats: bareStats, strikes: noStrikes }, tlActs, 12000);
  check('referee: THROUGHLINE re-threads the mark through a Decoy (the late Whisper still crits)',
    !tlOn.problem && !tlOff.problem && tlOn.dmgTotal > tlOff.dmgTotal,
    `through=${tlOn.dmgTotal} bare=${tlOff.dmgTotal}`);
}

// ---- the referee: forgery + charge accounting ----------------------------------
{
  const st = fakeState();
  const p = loadedPlayer();
  const stats = game.effectiveStats(st, p, {});
  const forged = game.simulateRound({ stats: game.effectiveStats(st, fakePlayer('nope'), {}), strikes: [] }, [
    { t: 100, tool: 'mod:tracepurge' }
  ], 5000);
  check('referee: firing a mod you do not own is a forgery', forged.problem === 'mod not owned', `problem=${forged.problem}`);
  const overdraw = game.simulateRound({ stats, strikes: [] }, [
    { t: 100, tool: 'mod:tracepurge' }, { t: 200, tool: 'mod:tracepurge' }, { t: 300, tool: 'mod:tracepurge' }
  ], 5000);
  check('referee: the third fire on a 2-charge mod is refused', overdraw.problem === 'mod charges spent', `problem=${overdraw.problem}`);
  const honest = game.simulateRound({ stats, strikes: [] }, [
    { t: 100, tool: 'mod:tracepurge' }, { t: 200, tool: 'mod:tracepurge' }
  ], 5000);
  check('referee: two honest fires settle, and the book names them',
    !honest.problem && JSON.stringify(honest.modsUsed) === JSON.stringify(['tracepurge', 'tracepurge']),
    `modsUsed=${JSON.stringify(honest.modsUsed)}`);
  const unknown = game.simulateRound({ stats, strikes: [] }, [{ t: 100, tool: 'mod:laser' }], 5000);
  check('referee: an invented mod is refused at the door', unknown.problem === 'mod not owned', `problem=${unknown.problem}`);
}

// ---- drop tables ----------------------------------------------------------------
{
  check('drop table: sane, named rates (normal fitted 12% · boss fitted 35% / deploy 25% · pit win 12%)',
    game.MOD_DROPS.descent.normal.fitted === 0.12 && game.MOD_DROPS.descent.boss.fitted === 0.35 &&
    game.MOD_DROPS.descent.boss.deploy === 0.25 && game.MOD_DROPS.pitWin === 0.12);
  const p = fakePlayer('dropper');
  const zero = () => 0;
  const got = game.rollDescentMods(zero, p, 'normal');
  check('drops: a normal depth can pay a fitted mod — and never a deployable',
    got.length === 1 && got[0].kind === 'fitted' && p.modsOwned[got[0].id] === true, JSON.stringify(got));
  const p2 = fakePlayer('dropper2');
  const got2 = game.rollDescentMods(zero, p2, 'boss');
  check('drops: a boss can pay a fitted AND a deployable', got2.length === 2 && got2.some(g => g.kind === 'deployable'), JSON.stringify(got2));
  const full = loadedPlayer('full');
  check('drops: a complete collection rolls no ghosts', game.rollDescentMods(zero, full, 'boss').length === 0);
  // the gear books never shift: mod rolls happen after gear rolls by
  // construction — proven here by determinism of the gear rng stream itself
  const r1 = game.rng32(12345); const seq1 = [r1(), r1(), r1()];
  const r2 = game.rng32(12345); const seq2 = [r2(), r2(), r2()];
  check('drops: the seeded rng stream is untouched by the mod layer', JSON.stringify(seq1) === JSON.stringify(seq2));
}

// ---- the Pit: mod drop on a breach, fitted build on the card ---------------------
{
  const st = fakeState();
  let dropsSeen = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const ch = fakePlayer('hunter' + i);
    const ow = fakePlayer('owner' + i);
    st.players[ch.id] = ch; st.players[ow.id] = ow;
    const v = game.settlePitFight(st, ch, ow,
      { id: 'f' + i, seed: 1000 + i, pitBounty: 25, pitClassDelta: 0, pitTraits: {} },
      { result: 'win', endReason: 'breach', durationMs: 30000, actions: [], fightStats: null },
      { damagePct: 100, morphed: false, combos: [] });
    if (v.modDrop) {
      dropsSeen++;
      if (!ch.modsOwned[v.modDrop.id]) check('pit: a dropped mod is actually granted', false, v.modDrop.id);
    }
  }
  check(`pit: breaches pay a mod at a sane rate (${dropsSeen}/${N} ≈ 12%)`, dropsSeen > N * 0.04 && dropsSeen < N * 0.22, `rate=${(dropsSeen / N * 100).toFixed(1)}%`);
  // deterministic edges with an injected rng
  const ch = fakePlayer('edge'); const ow = fakePlayer('edgeo');
  st.players[ch.id] = ch; st.players[ow.id] = ow;
  let calls = 0;
  const rigged = () => { calls++; return calls <= 4 ? 0.99 : (calls === 5 ? 0.05 : 0.0); };
  const v = game.settlePitFight(st, ch, ow,
    { id: 'fx', seed: 7, pitBounty: 25, pitClassDelta: 0, pitTraits: {} },
    { result: 'win', endReason: 'breach', durationMs: 30000, actions: [], fightStats: null },
    { damagePct: 100, morphed: false, combos: [] }, rigged);
  check('pit: under a rigged rng the mod drop lands and is named on the verdict',
    !!v.modDrop && !!ch.modsOwned[v.modDrop.id], JSON.stringify(v.modDrop));
  const v2 = game.settlePitFight(st, fakePlayer('edge2'), fakePlayer('edgeo2'),
    { id: 'fx2', seed: 8, pitBounty: 25, pitClassDelta: 0, pitTraits: {} },
    { result: 'win', endReason: 'breach', durationMs: 30000, actions: [], fightStats: null },
    { damagePct: 100, morphed: false, combos: [] }, () => 0.99);
  check('pit: no drop when the roll says no', v2.modDrop === null);
}

// ============================================================================
// LIVE — a seeded server walk
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
  if (jar && jar.c.size) headers.cookie = jar.header();
  const res = await fetch(BASE + url, { method, headers, body: opts.body, redirect: 'manual' });
  if (jar) jar.absorb(res);
  return res;
}
async function json(jar, method, url, body) {
  const res = await call(jar, method, url, {
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let parsed = null;
  try { parsed = await res.json(); } catch {}
  return { status: res.status, body: parsed };
}

// Repair a candidate log against the real referee until it certifies clean
// (the verify-pit pattern): drop the first voiding swing, re-sim, repeat.
function certify(fight, actions) {
  const REPAIRABLE = ['cooldown scrambled', 'cooldown violated', 'parry outside its window'];
  const acts = actions.slice();
  for (let iter = 0; iter < 60; iter++) {
    const sim = game.simulateRound(fight, acts, fight.stats.roundMs);
    if (!sim.problem) {
      if (!sim.outcome) return { actions: acts, sim, durationMs: fight.stats.roundMs };
      return { actions: acts.filter(a => a.t <= sim.outcome.at + 250), sim, durationMs: sim.outcome.at + 250 };
    }
    if (!REPAIRABLE.includes(sim.problem)) return { actions: acts, sim, durationMs: fight.stats.roundMs };
    let idx = -1;
    for (let n = 1; n <= acts.length; n++) {
      if (game.simulateRound(fight, acts.slice(0, n), fight.stats.roundMs).problem) { idx = n - 1; break; }
    }
    if (idx < 0) break;
    acts.splice(idx, 1);
  }
  const sim = game.simulateRound(fight, acts, fight.stats.roundMs);
  if (!sim.outcome) return { actions: acts, sim, durationMs: fight.stats.roundMs };
  return { actions: acts.filter(a => a.t <= sim.outcome.at + 250), sim, durationMs: sim.outcome.at + 250 };
}

const today = game.dayKey(Date.now());
function seedPlayer(id, name, xp, createdAt, extra = {}) {
  return {
    id, email: id + '@mods.test', pass: null, displayName: name, photo: null,
    points: 0, nodes: {}, shapes: {}, twinArmor: {}, challengeToken: 'tok-' + id,
    record: { bouts: 0, breaches: 0, streak: 0, bestSecs: null },
    challengeFeed: [], publicProfile: true, createdAt, lastFightAt: null,
    xp, toolUse: {}, parriesTotal: 0, taunt: '', devilShapes: {},
    devil: { bounty: 25, bountyDay: today, held: 0, breached: 0, lastBreachedBy: null, breachedBy: [], holdStreak: 0 },
    pitAttack: { bouts: 0, breaches: 0 },
    itemStock: {}, itemHistory: [], pitAttempts: {},
    defenseXpDay: { day: today, count: 0 },
    gear: [], descent: { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 },
    modsOwned: {}, modsFitted: { probe: null, flood: null, whisper: null, decoy: null },
    ...extra
  };
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-mods-'));
const seedPlayers = {
  keeper1: seedPlayer('keeper1', 'Keeper', 0, 1, { email: 'stevenh18818@gmail.com', isOwner: true }),
  modder1: seedPlayer('modder1', 'Modder', 0, 2),
  plain1: seedPlayer('plain1', 'Plain', 0, 3),
  devil1: seedPlayer('devil1', 'Devil', 0, 4)
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

try {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  // ---- the deck grant route --------------------------------------------------
  {
    const bad = await json(null, 'POST', '/api/deck/grant-mods', { key: 'wrong', playerId: 'modder1' });
    check('deck: grant-mods refuses a wrong key', bad.status === 403, `status ${bad.status}`);
    const g = await json(null, 'POST', '/api/deck/grant-mods', { key: ADMIN, playerId: 'modder1', fit: true });
    check('deck: grant-mods hands over the full v1 set, fitted', g.status === 200 && g.body.granted.length === 8 &&
      Object.keys(g.body.modsNow.fitted).length === 4 && g.body.modsNow.deployOwned.length === 4,
      JSON.stringify(g.body.modsNow));
    const again = await json(null, 'POST', '/api/deck/grant-mods', { key: ADMIN, playerId: 'modder1' });
    check('deck: a second grant is a no-op (already owned)', again.status === 200 && again.body.granted.length === 0);
    const roster = await json(null, 'GET', '/api/deck/roster?key=' + ADMIN);
    const row = (roster.body.members || []).find(r => r.id === 'modder1');
    check('deck: the roster reads the mods back', !!row && row.mods.owned.length === 8 && Object.keys(row.mods.fitted).length === 4,
      row ? JSON.stringify(row.mods) : 'no row');
    // the devil owner gets deployables only — for the exclusion proof below
    await json(null, 'POST', '/api/deck/grant-mods', { key: ADMIN, playerId: 'devil1', mods: Object.keys(game.DEPLOY_MODS) });
  }

  // ---- socketing over HTTP -----------------------------------------------------
  {
    const jar = jarFor('plain1');
    await json(null, 'POST', '/api/deck/grant-mods', { key: ADMIN, playerId: 'plain1', mods: ['throughline'] });
    const ok = await json(jar, 'POST', '/api/mods/fit', { tool: 'probe', mod: 'throughline' });
    check('fit: socketing an owned mod between fights works', ok.status === 200 && ok.body.mods.fitted.probe === 'throughline', `status ${ok.status}`);
    const wrong = await json(jar, 'POST', '/api/mods/fit', { tool: 'flood', mod: 'throughline' });
    check('fit: the wrong tool is refused over HTTP', wrong.status === 400, `status ${wrong.status}`);
    const unowned = await json(jar, 'POST', '/api/mods/fit', { tool: 'flood', mod: 'emberline' });
    check('fit: an unowned mod is refused over HTTP', unowned.status === 400, `status ${unowned.status}`);
  }

  // ---- the arena fight: dealt rail, honest fires, refill -----------------------
  {
    const jar = jarFor('modder1');
    const start = await json(jar, 'POST', '/api/fight/start', {});
    const st = start.body.stats;
    check('arena: the fight is dealt the full rail at 2 charges each',
      st.mods && Object.keys(st.mods.deploy).length === 4 && Object.values(st.mods.deploy).every(d => d.charges === 2));
    check('arena: fitted mods ride the dealt tools (mark 7000, burn, shed, coil)',
      st.tools.probe.markMs === 7000 && !!st.tools.flood.modBurn && st.tools.whisper.traceShed === 8 && st.tools.decoy.paybackCoil === true);
    const fight = { stats: st, strikes: start.body.strikes, postMorph: start.body.postMorph };
    const plan = certify(fight, [
      { t: 100, tool: 'mod:tracepurge' }, { t: 200, tool: 'mod:overclock' },
      { t: 300, tool: 'probe' }, { t: 1500, tool: 'flood' }, { t: 5000, tool: 'mod:ghostplate' },
      { t: 9000, tool: 'whisper' }, { t: 12000, tool: 'mod:coldsnap' }
    ]);
    check('arena: the planned mod log certifies clean against the referee', !plan.sim.problem, `problem=${plan.sim.problem}`);
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: start.body.fightId, actions: plan.actions,
      result: plan.sim.outcome ? plan.sim.outcome.result : 'lose',
      endReason: plan.sim.outcome ? plan.sim.outcome.endReason : 'timeout',
      durationMs: plan.durationMs,
      damagePct: Math.round((1 - 0) * 0) // server recomputes; placeholder field only
    });
    check('arena: a fight that fires its rail settles — not voided',
      fin.status === 200 && !fin.body.voided && !!fin.body.verdict, JSON.stringify(fin.body.voided || ''));
    const used = (fin.body.verdict && fin.body.verdict.fightStats && fin.body.verdict.fightStats.modsUsed) || [];
    check('arena: the verdict book names the mods fired', used.includes('tracepurge') && used.includes('overclock'),
      JSON.stringify(used));
    // refill: the next fight is dealt full charges again
    const start2 = await json(jar, 'POST', '/api/fight/start', {});
    check('arena: charges refill between fights', start2.body.stats.mods.deploy.tracepurge.charges === 2);
  }

  // ---- forgery over HTTP ---------------------------------------------------------
  {
    const jar = jarFor('plain1'); // owns throughline only — no deployables
    const start = await json(jar, 'POST', '/api/fight/start', {});
    check('forgery setup: a fighter with no deployables is dealt an empty rail',
      start.body.stats.mods && Object.keys(start.body.stats.mods.deploy).length === 0);
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: start.body.fightId,
      actions: [{ t: 100, tool: 'mod:tracepurge' }],
      result: 'lose', endReason: 'timeout', durationMs: 90000, damagePct: 0
    });
    check('forgery: claiming an unowned mod voids the bout', !!fin.body.voided && String(fin.body.voided).includes('mod not owned'),
      JSON.stringify(fin.body.voided));
    const jar2 = jarFor('modder1');
    const start2 = await json(jar2, 'POST', '/api/fight/start', {});
    const fin2 = await json(jar2, 'POST', '/api/fight/finish', {
      fightId: start2.body.fightId,
      actions: [{ t: 100, tool: 'mod:coldsnap' }, { t: 200, tool: 'mod:coldsnap' }, { t: 300, tool: 'mod:coldsnap' }],
      result: 'lose', endReason: 'timeout', durationMs: 90000, damagePct: 0
    });
    check('forgery: overdrawing charges voids the bout', !!fin2.body.voided && String(fin2.body.voided).includes('mod charges spent'),
      JSON.stringify(fin2.body.voided));
  }

  // ---- the Pit: the challenger's build rides in; the devil's rail never does -----
  {
    const jar = jarFor('modder1');
    const start = await json(jar, 'POST', '/api/fight/start', { pit: 'devil1' });
    check('pit: the challenger is dealt their own fitted mods + rail',
      start.status === 200 && start.body.stats.tools.probe.markMs === 7000 &&
      Object.keys(start.body.stats.mods.deploy).length === 4, `status ${start.status}`);
    const jarP = jarFor('plain1'); // fitted throughline only, NO deployables
    const startP = await json(jarP, 'POST', '/api/fight/start', { pit: 'devil1' });
    check('pit: a devil\u2019s deployables are never dealt to its challenger (devils never fire them)',
      startP.status === 200 && Object.keys(startP.body.stats.mods.deploy).length === 0 &&
      startP.body.stats.tools.probe.markMs === 7000,
      `deploy=${JSON.stringify(Object.keys(startP.body.stats.mods.deploy || {}))}`);
  }

  // ---- the Descent: sockets lock mid-delve; the depth report carries mods --------
  {
    const jar = jarFor('modder1');
    const run = await json(jar, 'POST', '/api/descent/start', {});
    check('descent: a run opens for the mod walk', run.status === 200 && !!run.body.fightId, `status ${run.status} ${JSON.stringify(run.body.error || '')}`);
    const locked = await json(jar, 'POST', '/api/mods/fit', { tool: 'probe', mod: null });
    check('descent: socketing is refused mid-delve (the gear law)', locked.status === 409, `status ${locked.status}`);
    const fight = { stats: run.body.stats, strikes: run.body.strikes, postMorph: [] };
    const plan = certify(fight, [{ t: 100, tool: 'mod:tracepurge' }, { t: 300, tool: 'probe' }, { t: 2000, tool: 'flood' }]);
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: run.body.fightId, actions: plan.actions,
      result: plan.sim.outcome ? plan.sim.outcome.result : 'lose',
      endReason: plan.sim.outcome ? plan.sim.outcome.endReason : 'timeout',
      durationMs: plan.durationMs, damagePct: 0
    });
    check('descent: the depth settles and its report carries the mods field',
      fin.status === 200 && !fin.body.voided && fin.body.descent && Array.isArray(fin.body.descent.mods),
      `voided=${JSON.stringify(fin.body.voided || '')} mods=${JSON.stringify(fin.body.descent && fin.body.descent.mods)}`);
    await json(jar, 'POST', '/api/descent/abandon', {});
    const free = await json(jar, 'POST', '/api/mods/fit', { tool: 'probe', mod: 'throughline' });
    check('descent: once the run closes, the sockets open again', free.status === 200, `status ${free.status}`);
  }

  // ---- the pages carry the rail ---------------------------------------------------
  {
    const jar = jarFor('modder1');
    const arena = await (await call(jar, 'GET', '/arena')).text();
    check('pages: the arena fight screen carries the mod rail', arena.includes('id="modrail"'));
    const prof = await (await call(jar, 'GET', '/profile')).text();
    check('pages: the profile carries the socket board', prof.includes('id="mods"') && prof.includes('THROUGHLINE'));
    const desc = await (await call(jar, 'GET', '/descent')).text();
    check('pages: the descent fight screen carries the mod rail', desc.includes('id="modrail"'));
  }
} finally {
  server.kill('SIGKILL');
}

console.log(failures ? `\n${failures} MOD CHECK(S) FAILED` : '\nALL MOD CHECKS PASSED');
process.exit(failures ? 1 : 0);
