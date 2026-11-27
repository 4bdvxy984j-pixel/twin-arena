'use strict';
// THE TWIN ARENA — game rules. Server-authoritative learning, points and evolution.
// The "attacks" here are game verbs only; nothing in this file touches anything real.

const TOOLS = {
  probe:   { name: 'Probe',   cost: 9,  cooldown: 1100, dmg: 3,  trace: 3,  color: '#00e5ff',
             blurb: 'A needle of light. Cheap, quick, nearly silent (+3% trace) — and it marks the gate: your next strike within 4s hits +30%.' },
  flood:   { name: 'Flood',   cost: 30, cooldown: 4000, dmg: 13, trace: 14, color: '#ff2a6d',
             blurb: 'A burst of a thousand false dawns. Heavy damage, heavy price — and loud: +14% trace every time.' },
  whisper: { name: 'Whisper', cost: 16, cooldown: 2500, dmg: 3, dot: 2.2, dotSecs: 6, trace: 0, color: '#b967ff',
             blurb: 'A slow burn inside the walls. Burns over 6s, silences the gate\u2019s healing while it lasts — and adds no trace at all.' },
  decoy:   { name: 'Decoy',   cost: 20, cooldown: 5000, dmg: 0, trace: -18, color: '#fcee0a',
             blurb: 'A phantom gate. No damage — but your next strike lands +60%, it dumps 18% of your trace, and burned during a wind-up it eats the Twin\u2019s strike whole.' }
};
const TOOL_IDS = Object.keys(TOOLS);

const ROUND_MS = 150000;           // 2:30 — inside the 2-4 minute law
const GATE_HP = 100;
const ENERGY_MAX = 100;
const ENERGY_REGEN = 7;            // per second
const GATE_REGEN = 1.1;            // hp per second, x aggression, silenced by whisper

// ---- Combat doctrine: it throws back (Phase 2) -----------------------------
// The player has integrity too. The Twin strikes on a server-generated
// schedule scaled by the deck's aggression dial; haymakers are telegraphed
// (a wind-up you can parry — a parry opens a vulnerability window), glancing
// hits scramble a tool's cooldown, clean hits cost integrity. And every tool
// feeds the TRACE: loud play spikes it, quiet play lets it cool, and at 100%
// you are caught — the round ends on the spot.
const PLAYER_HP = 100;
const TRACE_MAX = 100;
const TRACE_COOL = 1.2;            // % per second, always cooling
const PARRY = { cost: 5, cooldown: 1500 };
const STRIKE = {
  baseMs: 8000,                    // strike interval at aggression 1 (divided by the dial)
  firstMs: 5000,                   // first strike lands about here
  windupMs: 1600,                  // haymaker telegraph window — parry inside it
  vulnMs: 3500,                    // vulnerability window after a parried haymaker
  vulnMult: 2,                     // gate damage multiplier inside the window
  scrambleMs: 2600,                // cooldown extension from a glancing hit
  dmg: { clean: 6, glance: 2, haymaker: 18 },
  cycle: ['clean', 'glance', 'clean', 'haymaker']
};

// ---- The Super Deck's weather (Phase 2.5) ----------------------------------
// STORM: a deck-fired event. While it runs, verdict points double and the
// Twin's aggression has a floor — the storm level — no matter how low the
// dial sits. The state is a deadline on the config; fights snapshot it at
// start, so a round already underway keeps the weather it was dealt.
const STORM = { aggression: 1.6, pointsMult: 2 };
function stormActive(state) {
  return !!(state && state.config && state.config.stormUntil && Date.now() < state.config.stormUntil);
}
function effectiveAggression(state) {
  const base = (state && state.config && state.config.aggression) || 1;
  return stormActive(state) ? Math.max(base, STORM.aggression) : base;
}

// Evolution web — attacker branches, 12 nodes, 3 tiers each.
const NODES = [
  { id: 'vec1', branch: 'Vectors',   tier: 1, cost: 30,  name: 'Sharper Probes',  desc: 'Probe damage +35%.' },
  { id: 'vec2', branch: 'Vectors',   tier: 2, cost: 60,  name: 'Heavy Flood',     desc: 'Flood damage +30%.' },
  { id: 'vec3', branch: 'Vectors',   tier: 3, cost: 110, name: 'Deep Kit',        desc: 'All tool damage +12%.' },
  { id: 'dec1', branch: 'Deception', tier: 1, cost: 30,  name: 'False Echoes',    desc: 'The Twin learns 30% less from your fights.' },
  { id: 'dec2', branch: 'Deception', tier: 2, cost: 60,  name: 'Ghost Hands',     desc: 'Your own familiarity counts 25% less against you.' },
  { id: 'dec3', branch: 'Deception', tier: 3, cost: 110, name: 'Phantom Choir',   desc: 'Decoy\u2019s next-strike bonus rises to +90%.' },
  { id: 'pat1', branch: 'Patience',  tier: 1, cost: 30,  name: 'Slow Burn',       desc: 'Whisper damage and burn +30%.' },
  { id: 'pat2', branch: 'Patience',  tier: 2, cost: 60,  name: 'Smolder',         desc: 'The gate heals 20% slower against you, always.' },
  { id: 'pat3', branch: 'Patience',  tier: 3, cost: 110, name: 'Long Game',       desc: 'Your rounds last +25 seconds.' },
  { id: 'spd1', branch: 'Speed',     tier: 1, cost: 30,  name: 'Quick Fingers',   desc: 'All cooldowns 15% shorter.' },
  { id: 'spd2', branch: 'Speed',     tier: 2, cost: 60,  name: 'Surge',           desc: 'Energy returns 30% faster.' },
  { id: 'spd3', branch: 'Speed',     tier: 3, cost: 110, name: 'Overclock',       desc: 'Cooldowns 15% shorter again, and +20 max energy.' }
];
const NODE_BY_ID = Object.fromEntries(NODES.map(n => [n.id, n]));

function has(player, id) { return !!(player && player.nodes && player.nodes[id]); }

// ---- Familiarity / decay -------------------------------------------------
// How well the Twin knows a tool = global pattern memory + this player's own
// lessons, weighted. Returns 0..0.75. Damage multiplier = 1 - fam * 0.7.
function familiarity(state, player, tool) {
  const g = (state.shapesGlobal['tool:' + tool] || 0);
  let p = player && player.shapes ? (player.shapes['tool:' + tool] || 0) : 0;
  if (has(player, 'dec2')) p = p * 0.75;
  const ls = state.config.learningSpeed || 1;
  const fam = (g * 0.004 + p * 0.03) * ls;
  return Math.min(0.75, fam);
}

// ---- Effective stats for one fighter entering a fight --------------------
// armorMap: tool -> 0..0.5 hardening (personal grudge armor, or the challenge
// owner's armor when fighting someone else's Twin).
function effectiveStats(state, player, armorMap) {
  const tools = {};
  for (const id of TOOL_IDS) {
    const t = TOOLS[id];
    let dmg = t.dmg, dot = t.dot || 0, cd = t.cooldown, cost = t.cost;
    if (id === 'probe' && has(player, 'vec1')) dmg *= 1.35;
    if (id === 'flood' && has(player, 'vec2')) dmg *= 1.30;
    if (id === 'whisper' && has(player, 'pat1')) { dmg *= 1.30; dot *= 1.30; }
    if (has(player, 'vec3')) { dmg *= 1.12; dot *= 1.12; }
    if (has(player, 'spd1')) cd *= 0.85;
    if (has(player, 'spd3')) cd *= 0.85;
    const fam = familiarity(state, player, id);
    const armor = Math.min(0.5, (armorMap && armorMap[id]) || 0);
    const globalArmor = Math.min(0.2, state.globalArmor[id] || 0);
    const mult = (1 - fam * 0.7) * (1 - armor) * (1 - globalArmor);
    tools[id] = {
      name: t.name, cost, cooldown: Math.round(cd),
      dmg: +(dmg * mult).toFixed(2), rawDmg: +dmg.toFixed(2),
      dot: +(dot * mult).toFixed(2), dotSecs: t.dotSecs || 0,
      // FLOODGATES (deck toggle): trace gains are halved, dealt into the
      // stats here so the referee and the client's own HUD read the same
      // halved costs — one truth, server-side. (A Decoy's dump is not a
      // gain and is never halved.)
      trace: t.trace > 0 && state.config.floodgates ? t.trace / 2 : t.trace,
      familiarity: +fam.toFixed(3), armor: +(armor + globalArmor).toFixed(3),
      color: t.color, blurb: t.blurb
    };
  }
  return {
    tools,
    gateHp: GATE_HP,
    gateRegen: +(GATE_REGEN * effectiveAggression(state) * (has(player, 'pat2') ? 0.8 : 1)).toFixed(2),
    energyMax: ENERGY_MAX + (has(player, 'spd3') ? 20 : 0),
    energyRegen: +(ENERGY_REGEN * (has(player, 'spd2') ? 1.3 : 1)).toFixed(2),
    roundMs: ROUND_MS + (has(player, 'pat3') ? 25000 : 0),
    decoyCrit: has(player, 'dec3') ? 0.9 : 0.6,
    combat: {
      playerHp: PLAYER_HP,
      parryCost: PARRY.cost, parryCooldown: PARRY.cooldown,
      traceCool: TRACE_COOL, traceMax: TRACE_MAX,
      windupMs: STRIKE.windupMs, vulnMs: STRIKE.vulnMs, vulnMult: STRIKE.vulnMult,
      scrambleMs: STRIKE.scrambleMs, strikeDmg: STRIKE.dmg
    }
  };
}

// ---- Pattern extraction ---------------------------------------------------
// A "shape" is a fingerprinted pattern: a tool alone, a consecutive pair, or
// a burst (3+ of one tool inside 4 seconds). Decoy dilutes: while a decoy is
// "up" (5s after use) patterns count half.
function extractPatterns(actions) {
  const counts = {};
  const add = (k, w) => { counts[k] = (counts[k] || 0) + w; };
  let decoyUntil = -1;
  const acts = actions.filter(a => a.tool !== 'parry'); // a parry is a reflex, not a shape
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (a.tool === 'decoy') decoyUntil = a.t + 5000;
    const w = a.t <= decoyUntil && a.tool !== 'decoy' ? 0.5 : 1;
    add('tool:' + a.tool, w);
    if (i > 0) add('pair:' + acts[i - 1].tool + '>' + a.tool, w);
  }
  // bursts
  for (const id of TOOL_IDS) {
    const times = acts.filter(a => a.tool === id).map(a => a.t);
    let run = 0;
    for (let i = 0; i < times.length; i++) {
      if (i > 0 && times[i] - times[i - 1] <= 4000) run++; else run = 1;
      if (run === 3) add('burst:' + id, 1);
    }
  }
  return counts;
}

// ---- The Twin's strike schedule -------------------------------------------
// Generated server-side at fight start from a seed, scaled by the deck's
// aggression dial, and handed to the client so haymakers can be telegraphed.
// Deterministic: the referee below replays against this exact schedule.
function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeStrikes(seed, roundMs, aggression) {
  const rnd = rng32(seed);
  const interval = STRIKE.baseMs / (aggression || 1);
  const strikes = [];
  let t = STRIKE.firstMs + (rnd() - 0.5) * 1200;
  let i = 0;
  while (t < roundMs - 1200 && strikes.length < 80) {
    const kind = STRIKE.cycle[i % STRIKE.cycle.length];
    const s = { at: Math.round(t), kind };
    if (kind === 'glance') s.tool = TOOL_IDS[Math.floor(rnd() * TOOL_IDS.length)];
    strikes.push(s);
    t += interval + (rnd() - 0.5) * 1600;
    i++;
  }
  return strikes;
}

// ---- The referee: replay a submitted round ---------------------------------
// Mirrors the client's simulation exactly (same stats, same mark/crit/dot
// math) and adds what only the server knows: the strike schedule, integrity,
// and the trace. Returns { problem } for an implausible/forged log, else the
// true outcome and the round's vital signs. Outcomes: result 'win' with
// endReason 'breach', or 'lose' with 'integrity' (thrown out), 'trace'
// (caught), or no outcome at all (the clock decides — a timeout).
function simulateRound(fight, actions, durationMs) {
  const stats = fight.stats;
  if (!Array.isArray(actions) || actions.length === 0) return { problem: 'empty log' };
  if (actions.length > Math.ceil(durationMs / 150) + 10) return { problem: 'implausibly many actions' };
  let prevT = -1;
  for (const a of actions) {
    if (!a || typeof a.t !== 'number' || a.t < 0 || a.t > durationMs + 2000) return { problem: 'action outside round' };
    if (a.t < prevT) return { problem: 'actions out of order' };
    prevT = a.t;
  }
  const strikes = (fight.strikes || []).map(s => ({ at: s.at, kind: s.kind, tool: s.tool, parried: false, eaten: false }));
  const S = {
    energy: stats.energyMax, gateHp: stats.gateHp, integrity: PLAYER_HP,
    trace: 0, tracePeak: 0, markUntil: -1, critNext: 0,
    lastUse: {}, lockoutUntil: {}, dots: [],
    parries: 0, strikesTaken: 0, strikeDamage: 0, dmgTotal: 0, vulnBonus: 0,
    vulnFrom: -1, vulnUntil: -1, outcome: null
  };
  let cur = 0;
  function advance(to) {
    while (cur < to && !S.outcome) {
      const step = Math.min(50, to - cur), dt = step / 1000;
      cur += step;
      S.energy = Math.min(stats.energyMax, S.energy + stats.energyRegen * dt);
      let burning = false;
      S.dots = S.dots.filter(d => {
        if (cur <= d.until) { burning = true; S.gateHp -= d.dps * dt; return true; }
        return false;
      });
      if (!burning && S.gateHp > 0) S.gateHp = Math.min(stats.gateHp, S.gateHp + stats.gateRegen * dt);
      S.trace = Math.max(0, S.trace - TRACE_COOL * dt);
      if (S.gateHp <= 0) { S.gateHp = 0; S.outcome = { result: 'win', endReason: 'breach', at: Math.round(cur) }; }
    }
  }
  function doAction(a) {
    const t = a.t;
    if (a.tool === 'parry') {
      if (S.lastUse.parry !== undefined && t - S.lastUse.parry < PARRY.cooldown * 0.8) return 'cooldown violated';
      S.energy -= PARRY.cost;
      if (S.energy < -12) return 'energy overdrawn';
      S.lastUse.parry = t;
      const target = strikes.find(s => s.kind === 'haymaker' && !s.parried && !s.eaten &&
        t >= s.at - STRIKE.windupMs && t <= s.at);
      if (!target) return 'parry outside its window';
      target.parried = true;
      S.parries++;
      return null;
    }
    const tool = stats.tools[a.tool];
    if (!tool) return 'unknown tool';
    if (S.lastUse[a.tool] !== undefined && t - S.lastUse[a.tool] < tool.cooldown * 0.8) return 'cooldown violated';
    if (S.lockoutUntil[a.tool] && t < S.lockoutUntil[a.tool] - 300) return 'cooldown scrambled';
    S.energy -= tool.cost;
    if (S.energy < -12) return 'energy overdrawn';
    S.lastUse[a.tool] = t;
    // The trace hears everything.
    S.trace = Math.min(TRACE_MAX, Math.max(0, S.trace + (tool.trace || 0)));
    if (S.trace > S.tracePeak) S.tracePeak = S.trace;
    if (S.trace >= TRACE_MAX) { S.outcome = { result: 'lose', endReason: 'trace', at: t }; return null; }
    if (a.tool === 'decoy') {
      S.critNext = stats.decoyCrit;
      // Burned defensively during a wind-up, a decoy eats the strike whole.
      const pending = strikes.find(s => s.kind === 'haymaker' && !s.parried && !s.eaten &&
        t >= s.at - STRIKE.windupMs && t <= s.at);
      if (pending) pending.eaten = true;
      return null;
    }
    let dmg = tool.dmg;
    if (S.critNext > 0) { dmg *= (1 + S.critNext); S.critNext = 0; }
    if (a.tool !== 'probe' && t < S.markUntil) { dmg *= 1.3; S.markUntil = -1; }
    if (a.tool === 'probe') S.markUntil = t + 4000;
    if (t >= S.vulnFrom && t <= S.vulnUntil) {
      const bonus = dmg * (STRIKE.vulnMult - 1);
      S.vulnBonus += bonus; dmg += bonus;
    }
    S.gateHp -= dmg;
    S.dmgTotal += dmg;
    if (a.tool === 'whisper') S.dots.push({ until: t + (tool.dotSecs || 0) * 1000, dps: tool.dot });
    if (S.gateHp <= 0) { S.gateHp = 0; S.outcome = { result: 'win', endReason: 'breach', at: t }; }
    return null;
  }
  function doStrike(s) {
    const t = s.at;
    if (s.kind === 'haymaker') {
      if (s.parried) { S.vulnFrom = t; S.vulnUntil = t + STRIKE.vulnMs; return; }
      if (s.eaten) return;
      S.integrity -= STRIKE.dmg.haymaker; S.strikesTaken++; S.strikeDamage += STRIKE.dmg.haymaker;
    } else if (s.kind === 'glance') {
      S.integrity -= STRIKE.dmg.glance; S.strikesTaken++; S.strikeDamage += STRIKE.dmg.glance;
      const tool = stats.tools[s.tool] ? s.tool : 'probe';
      const ready = S.lastUse[tool] !== undefined ? S.lastUse[tool] + stats.tools[tool].cooldown : t;
      S.lockoutUntil[tool] = Math.max(ready, t) + STRIKE.scrambleMs;
    } else {
      S.integrity -= STRIKE.dmg.clean; S.strikesTaken++; S.strikeDamage += STRIKE.dmg.clean;
    }
    if (S.integrity <= 0) { S.integrity = 0; S.outcome = { result: 'lose', endReason: 'integrity', at: t }; }
  }
  const events = [];
  actions.forEach(a => events.push({ t: a.t, type: 'action', a }));
  strikes.forEach(s => events.push({ t: s.at, type: 'strike', s }));
  events.sort((x, y) => x.t - y.t || (x.type === 'action' ? -1 : 1));
  const limit = Math.min(durationMs, stats.roundMs + 2000);
  for (const ev of events) {
    if (S.outcome) break;
    if (ev.t > limit) break;
    advance(ev.t);
    if (S.outcome) break;
    if (ev.type === 'action') {
      const problem = doAction(ev.a);
      if (problem) return { problem };
    } else {
      doStrike(ev.s);
    }
  }
  if (!S.outcome) advance(limit);
  return {
    problem: null,
    outcome: S.outcome,
    integrityLeft: Math.max(0, Math.round(S.integrity)),
    trace: Math.round(S.trace), tracePeak: Math.round(S.tracePeak),
    gateHp: Math.max(0, +S.gateHp.toFixed(2)),
    damagePct: Math.max(0, Math.min(100, Math.round((1 - S.gateHp / stats.gateHp) * 100))),
    parries: S.parries, strikesTaken: S.strikesTaken, strikeDamage: S.strikeDamage,
    dmgTotal: +S.dmgTotal.toFixed(2), vulnBonus: +S.vulnBonus.toFixed(2)
  };
}

// Back-compat wrapper: Phase 1's plausibility check, now a thin skin over the
// referee with no Twin striking back.
function validateLog(stats, actions, durationMs) {
  const sim = simulateRound({ stats, strikes: [] }, actions, durationMs);
  return sim.problem || null;
}

// ---- Settle a finished fight ----------------------------------------------
// Mutates state + player. Returns the verdict object.
function settleFight(state, player, fight, submission) {
  const { actions, result, endReason, durationMs, damagePct, fightStats } = submission;
  const stats = fight.stats;
  const patterns = extractPatterns(actions);
  const learnMult = (has(player, 'dec1') ? 0.7 : 1) * (state.config.learningSpeed || 1);

  const newToWorld = [], newToPlayer = [];
  for (const k of Object.keys(patterns)) {
    if (!state.shapesGlobal[k]) newToWorld.push(k);
    if (!player.shapes[k]) newToPlayer.push(k);
    state.shapesGlobal[k] = (state.shapesGlobal[k] || 0) + patterns[k] * learnMult;
    player.shapes[k] = (player.shapes[k] || 0) + patterns[k] * learnMult;
  }

  // Counter-evolution: the Twin armors against this fighter's favorite tools.
  const toolUse = {};
  for (const a of actions) if (a.tool !== 'parry') toolUse[a.tool] = (toolUse[a.tool] || 0) + 1;
  const ranked = Object.entries(toolUse).sort((a, b) => b[1] - a[1]);
  const armorGains = {};
  if (ranked[0]) armorGains[ranked[0][0]] = 0.05;
  if (ranked[1]) armorGains[ranked[1][0]] = 0.025;
  for (const [tool, gain] of Object.entries(armorGains)) {
    player.twinArmor[tool] = Math.min(0.45, (player.twinArmor[tool] || 0) + gain);
    state.globalArmor[tool] = Math.min(0.2, (state.globalArmor[tool] || 0) + 0.002);
  }

  // Points
  let points = 0;
  const secs = Math.max(1, Math.round(durationMs / 1000));
  if (result === 'win') {
    const timeBonus = Math.min(25, Math.round(Math.max(0, stats.roundMs - durationMs) / 1000 * 0.2));
    points = 35 + timeBonus;
  } else {
    points = 10 + Math.round(Math.min(100, Math.max(0, damagePct || 0)) * 0.1);
  }
  points += Math.min(15, newToPlayer.length * 3);
  // STORM: the whole verdict pays double — the multiplier was snapshotted
  // onto the fight at start, so the referee settles under the weather the
  // round was actually fought in.
  if (fight.pointsMult && fight.pointsMult !== 1) points = Math.round(points * fight.pointsMult);
  player.points += points;

  // Record
  player.record.bouts += 1;
  if (result === 'win') {
    player.record.breaches += 1;
    player.record.streak = player.record.streak > 0 ? player.record.streak + 1 : 1;
    if (!player.record.bestSecs || secs < player.record.bestSecs) player.record.bestSecs = secs;
  } else {
    player.record.streak = player.record.streak < 0 ? player.record.streak - 1 : -1;
  }
  player.lastFightAt = Date.now();

  const verdict = {
    id: fight.id, fighterId: player.id,
    fighterName: player.displayName || 'A guest fighter',
    mode: fight.mode, challengeOwnerId: fight.challengeOwnerId || null,
    result, endReason: endReason || (result === 'win' ? 'breach' : 'timeout'),
    secs, points, storm: !!fight.storm,
    shapesTaught: newToPlayer, shapesTaughtCount: newToPlayer.length,
    newToWorldCount: newToWorld.length,
    armorGains,
    fightStats: fightStats || null,
    at: Date.now()
  };
  state.verdicts[fight.id] = verdict;
  state.fights.unshift({
    id: fight.id, name: verdict.fighterName, result, how: verdict.endReason, secs,
    shapes: newToPlayer.length, mode: fight.mode, at: verdict.at
  });
  state.fights = state.fights.slice(0, 60);

  // Challenge fights report back to the owner's grudge feed.
  if (fight.mode === 'challenge' && fight.challengeOwnerId && fight.challengeOwnerId !== player.id) {
    const owner = state.players[fight.challengeOwnerId];
    if (owner) {
      owner.challengeFeed = owner.challengeFeed || [];
      owner.challengeFeed.unshift({
        at: verdict.at, challenger: verdict.fighterName, result,
        secs, verdictId: fight.id
      });
      owner.challengeFeed = owner.challengeFeed.slice(0, 20);
    }
  }
  return verdict;
}

function educationMeter(state) {
  const shapes = Object.keys(state.shapesGlobal).length;
  const fighters = Object.values(state.players).filter(p => p.record && p.record.bouts > 0).length;
  const bouts = Object.values(state.players).reduce((n, p) => n + (p.record ? p.record.bouts : 0), 0);
  return { shapes, fighters, bouts };
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

module.exports = {
  TOOLS, TOOL_IDS, NODES, NODE_BY_ID, ROUND_MS, GATE_HP,
  PLAYER_HP, TRACE_MAX, TRACE_COOL, PARRY, STRIKE,
  STORM, stormActive, effectiveAggression,
  has, familiarity, effectiveStats, extractPatterns, validateLog,
  makeStrikes, simulateRound,
  settleFight, educationMeter, fmtTime
};
