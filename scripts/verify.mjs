// THE TWIN ARENA — end-to-end walk. Boots a throwaway server (temp DATA_DIR,
// port 4199) and plays the whole member path the way the real client does —
// Phase 1's road, plus Phase 2's combat: strikes, parries, scrambles,
// integrity defeats and the trace, all refereed server-side.
// Usage: node scripts/verify.mjs   (or npm run verify)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import game from '../src/game.js';

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'test-deck-key';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-verify-'));

let failures = 0;
function check(name, cond, evidence) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? '  — ' + evidence : ''}`);
  if (!cond) failures++;
}

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
const floodLog = (n, gapMs) => Array.from({ length: n }, (_, i) => ({ t: 500 + i * gapMs, tool: 'flood' }));

// ---- a client in miniature -------------------------------------------------
// Plans an action log against the dealt stats + strike schedule, tracking
// energy, cooldowns, glance lockouts and trace exactly the way the real
// client must — then confirms the plan against the server's own referee
// (imported above) before submitting it.
function planLog(stats, strikes, policy, maxT) {
  const actions = [];
  let energy = stats.energyMax, last = 0, trace = 0;
  const lastUse = {}, lockout = {};
  const glances = strikes.filter(s => s.kind === 'glance');
  let gi = 0;
  for (let t = 300; t <= (maxT || stats.roundMs); t += 100) {
    energy = Math.min(stats.energyMax, energy + (t - last) / 1000 * stats.energyRegen); last = t;
    trace = Math.max(0, trace - game.TRACE_COOL * 0.1);
    while (gi < glances.length && glances[gi].at <= t) {
      const g = glances[gi++];
      const readyAt = lastUse[g.tool] !== undefined ? lastUse[g.tool] + stats.tools[g.tool].cooldown : g.at;
      lockout[g.tool] = Math.max(readyAt, g.at) + game.STRIKE.scrambleMs;
    }
    const view = {
      t, energy, trace, lastUse,
      ready(id) {
        const tl = stats.tools[id];
        return (lastUse[id] === undefined || t - lastUse[id] >= tl.cooldown) &&
          !(lockout[id] && t < lockout[id]) && energy >= tl.cost;
      },
      winding() {
        return strikes.findIndex(s => s.kind === 'haymaker' && !view._parried.has(strikes.indexOf(s)) &&
          t >= s.at - game.STRIKE.windupMs && t <= s.at);
      },
      _parried: planLog._parried || new Set()
    };
    const tool = policy(view);
    if (!tool) continue;
    if (tool === 'parry') {
      const idx = strikes.findIndex((s, i) => s.kind === 'haymaker' && !view._parried.has(i) &&
        t >= s.at - game.STRIKE.windupMs && t <= s.at);
      if (idx < 0) continue;
      view._parried.add(idx);
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
function makeWinPolicy() {
  return (v) => {
    const hw = v.winding();
    if (hw >= 0 && v.energy >= 5 && (v.lastUse.parry === undefined || v.t - v.lastUse.parry >= 1500)) return 'parry';
    if (v.trace > 55 && v.ready('decoy')) return 'decoy';
    if (v.ready('flood') && v.trace <= 68) return 'flood';
    if (v.ready('probe')) return 'probe';
    if (v.ready('whisper') && v.energy >= 55) return 'whisper'; // bank energy for floods; whisper is garnish
    return null;
  };
}
// Plan a winning log for a dealt fight and trim it to the referee's own ending.
function planWin(stats, strikes) {
  planLog._parried = new Set();
  const actions = planLog(stats, strikes, makeWinPolicy());
  const sim = game.simulateRound({ stats, strikes }, actions, stats.roundMs);
  if (!sim.outcome || sim.outcome.result !== 'win') return { actions, sim };
  return { actions: actions.filter(a => a.t <= sim.outcome.at + 250), sim, durationMs: sim.outcome.at + 250 };
}

const server = spawn('node', ['src/server.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT), ADMIN_KEY: ADMIN, DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));

try {
  // wait for boot
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  // 1 — landing
  {
    const res = await call(null, 'GET', '/');
    const html = await res.text();
    check('landing loads with meter + FIGHT', res.status === 200 && html.includes('shapes learned') && html.includes('FIGHT THE TWIN'), `status ${res.status}`);
    check('landing carries the Phase 2 skin + doctrine', html.includes('Mind the trace') || html.includes('throws back'), 'cyberdeck copy present');
  }

  const guest = new Jar();

  // 2 — guest fight, WIN path (a real planned bout under Phase 2 rules)
  {
    const s = await json(guest, 'POST', '/api/fight/start', {});
    const st = s.body.stats;
    check('fight 1 starts, gate 100hp / flood dmg 13', s.status === 200 && st.gateHp === 100 && st.tools.flood.dmg === 13, JSON.stringify(st.tools.flood));
    check('fight 1 deals a strike schedule + trace costs', Array.isArray(s.body.strikes) && s.body.strikes.length >= 8 && st.tools.flood.trace === 14 && st.combat.playerHp === 100, `strikes=${(s.body.strikes || []).length}`);
    const plan = planWin(st, s.body.strikes);
    check('local referee agrees the planned bout wins', plan.sim.outcome && plan.sim.outcome.result === 'win', `outcome=${JSON.stringify(plan.sim.outcome)}`);
    const fin = await json(guest, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: plan.actions, result: 'win', endReason: 'breach', durationMs: plan.durationMs, damagePct: 100
    });
    const v = fin.body.verdict || {};
    check('fight 1 WIN verdict, points land', fin.status === 200 && v.result === 'win' && v.endReason === 'breach' && v.points >= 35, `points=${v.points} endReason=${v.endReason}`);
    check('fight 1 verdict card page renders', (await (await call(guest, 'GET', '/verdict/' + v.id)).text()).includes('THE GATE BREACHED'));
  }

  // 3 — guest fight, LOSE path (sparse log; the Twin finishes what the clock would)
  {
    const s = await json(guest, 'POST', '/api/fight/start', {});
    const fin = await json(guest, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId,
      actions: [{ t: 1000, tool: 'probe' }, { t: 2000, tool: 'probe' }, { t: 9000, tool: 'whisper' }],
      result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 40
    });
    const v = fin.body.verdict || {};
    check('fight 2 LOSE verdict with consolation points', fin.status === 200 && v.result === 'lose' && v.points >= 10, `points=${v.points} endReason=${v.endReason}`);
  }

  // 4 — the Twin learned: familiarity + grudge armor change fight 3's numbers
  let probeDmgBefore;
  {
    const me = await json(guest, 'GET', '/api/me');
    check('record shows 2 bouts / 1 breach', me.body.record.bouts === 2 && me.body.record.breaches === 1, JSON.stringify(me.body.record));
    const s = await json(guest, 'POST', '/api/fight/start', {});
    const f = s.body.stats.tools.flood;
    probeDmgBefore = s.body.stats.tools.probe.rawDmg;
    check('flood familiarity > 0 after teaching it', f.familiarity > 0, `familiarity=${f.familiarity}`);
    check('flood effective dmg decayed below 13', f.dmg < 13, `dmg=${f.dmg}`);
    check('grudge armor vs flood applied (>0)', f.armor > 0, `armor=${f.armor}`);
    // abandon fight 3 (never finished) — harmless by design
  }

  // 5 — evolution purchase changes the next fight's real numbers
  {
    const me = await json(guest, 'GET', '/api/me');
    check('guest holds >= 30 points to evolve', me.body.points >= 30, `points=${me.body.points}`);
    const ev = await json(guest, 'POST', '/api/evolve', { node: 'vec1' });
    check('evolve vec1 (Sharper Probes) succeeds, cost deducted', ev.body.ok === true && ev.body.points === me.body.points - 30, `points ${me.body.points} -> ${ev.body.points}`);
    const s = await json(guest, 'POST', '/api/fight/start', {});
    check('probe rawDmg 3 -> 4.05 after evolution', Math.abs(s.body.stats.tools.probe.rawDmg - 4.05) < 0.01, `rawDmg=${s.body.stats.tools.probe.rawDmg} (was ${probeDmgBefore})`);
  }

  // 6 — signup claims the guest record (points/web carry over)
  let pointsBeforeClaim;
  {
    const me = await json(guest, 'GET', '/api/me');
    pointsBeforeClaim = me.body.points;
    const r = await form(guest, '/auth/signup', { displayName: 'Verifier Vera', email: 'vera@example.com', password: 'password123' });
    check('signup redirects to profile', r.status === 303, `status ${r.status}`);
    const me2 = await json(guest, 'GET', '/api/me');
    check('claimed: points + evolution carried over', me2.body.claimed === true && me2.body.points === pointsBeforeClaim && me2.body.nodes.includes('vec1'), `points=${me2.body.points} nodes=${me2.body.nodes}`);
  }

  // 7 — photo upload + profile shows it
  {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const boundary = '----ta-verify-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="me.png"\r\nContent-Type: image/png\r\n\r\n`),
      png, Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const up = await call(guest, 'POST', '/api/photo', { headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
    check('photo upload accepted (303)', up.status === 303, `status ${up.status}`);
    const me = await json(guest, 'GET', '/api/me');
    check('profile carries the photo path', !!me.body.photo && me.body.photo.endsWith('.png'), me.body.photo);
    const img = await call(guest, 'GET', me.body.photo);
    const bytes = Buffer.from(await img.arrayBuffer());
    check('photo serves back byte-identical', img.status === 200 && bytes.equals(png), `status ${img.status}, ${bytes.length} bytes`);
    const prof = await (await call(guest, 'GET', '/profile')).text();
    check('profile page shows photo, record, curriculum, grudge, challenge link',
      prof.includes(me.body.photo) && prof.includes('Your curriculum') && prof.includes('The grudge') &&
      prof.includes('/challenge/' + me.body.challengeToken) && prof.includes('tool:flood'),
      'sections present');
    var myToken = me.body.challengeToken;
  }

  // 8 — challenge link: a stranger fights Vera's Twin; result lands on her grudge feed
  {
    const page = await (await call(null, 'GET', '/challenge/' + myToken)).text();
    check('challenge page renders the dare', page.includes('dares you') && page.includes('Verifier Vera'));
    const foe = new Jar();
    const s = await json(foe, 'POST', '/api/fight/start', { challenge: myToken });
    check('challenge fight starts in challenge mode vs her armor', s.status === 200 && s.body.mode === 'challenge' && s.body.stats.tools.flood.armor > 0, `armor=${s.body.stats && s.body.stats.tools.flood.armor}`);
    const plan = planWin(s.body.stats, s.body.strikes);
    check('local referee agrees the challenger can win', plan.sim.outcome && plan.sim.outcome.result === 'win', `outcome=${JSON.stringify(plan.sim.outcome)}`);
    const fin = await json(foe, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: plan.actions, result: 'win', endReason: 'breach', durationMs: plan.durationMs, damagePct: 100
    });
    check('challenger verdict recorded as challenge mode', fin.body.verdict && fin.body.verdict.mode === 'challenge' && fin.body.verdict.result === 'win');
    const prof = await (await call(guest, 'GET', '/profile')).text();
    check("result posted back to owner's grudge feed", prof.includes('challenged your Twin') && prof.includes('breached it'));
  }

  // 9 — spectator rail + education meter moved
  {
    const st = await json(null, 'GET', '/api/public/state');
    check('public meter counts shapes + fighters + bouts', st.body.meter.shapes > 0 && st.body.meter.fighters >= 1 && st.body.meter.bouts >= 3, JSON.stringify(st.body.meter));
    check('spectator rail shows recent fights', st.body.fights.length >= 3, `${st.body.fights.length} fights`);
  }

  // 10 — void path: an implausible log teaches nothing, earns nothing
  {
    const cheat = new Jar();
    const s = await json(cheat, 'POST', '/api/fight/start', {});
    const fin = await json(cheat, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: floodLog(40, 100), result: 'win', durationMs: 5000, damagePct: 100
    });
    check('implausible log voided, 0 points', !!fin.body.voided && fin.body.verdict.points === 0, `voided=${fin.body.voided}`);
  }

  // 11 — PHASE 2: the Twin throws back — strikes land, integrity falls to zero
  {
    const idle = new Jar();
    const s = await json(idle, 'POST', '/api/fight/start', {});
    const fin = await json(idle, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: [{ t: 1000, tool: 'probe' }],
      result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 4
    });
    const v = fin.body.verdict || {};
    check('idle fighter is THROWN OUT (integrity defeat, not timeout)', v.endReason === 'integrity' && v.result === 'lose' && v.fightStats && v.fightStats.integrityLeft === 0 && v.fightStats.strikesTaken >= 10,
      `endReason=${v.endReason} strikesTaken=${v.fightStats && v.fightStats.strikesTaken}`);
    check('thrown-out verdict card renders its own title', (await (await call(idle, 'GET', '/verdict/' + v.id)).text()).includes('THROWN OUT OF THE ARENA'));
  }

  // 12 — PHASE 2: a parried haymaker opens the vulnerability window, measurably
  {
    const p = new Jar();
    const s = await json(p, 'POST', '/api/fight/start', {});
    const H = s.body.strikes.find(x => x.kind === 'haymaker');
    const fin = await json(p, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId,
      actions: [{ t: H.at - 800, tool: 'parry' }, { t: H.at + 400, tool: 'flood' }],
      result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 20
    });
    const v = fin.body.verdict || {};
    check('parry registered by the referee', !fin.body.voided && v.fightStats && v.fightStats.parries === 1, `parries=${v.fightStats && v.fightStats.parries} voided=${fin.body.voided}`);
    check('vulnerability window paid bonus damage (flood 13 -> +13 bonus)', v.fightStats && v.fightStats.vulnBonus >= 10, `vulnBonus=${v.fightStats && v.fightStats.vulnBonus}`);
  }

  // 13 — PHASE 2: a forged parry (outside any window) voids the bout
  {
    const f = new Jar();
    const s = await json(f, 'POST', '/api/fight/start', {});
    const fin = await json(f, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId,
      actions: [{ t: 1000, tool: 'probe' }, { t: 3000, tool: 'parry' }],
      result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 4
    });
    check('forged parry voided', !!fin.body.voided && /parry/.test(fin.body.voided) && fin.body.verdict.points === 0, `voided=${fin.body.voided}`);
  }

  // 14 — PHASE 2: a glancing hit extends a cooldown, enforced server-side
  {
    const g = new Jar();
    const s = await json(g, 'POST', '/api/fight/start', {});
    const G = s.body.strikes.find(x => x.kind === 'glance');
    const X = G.tool, cd = s.body.stats.tools[X].cooldown;
    const u1 = G.at - 1000;
    const lockoutUntil = Math.max(u1 + cd, G.at) + game.STRIKE.scrambleMs;
    const bad = await json(g, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId,
      actions: [{ t: u1, tool: X }, { t: lockoutUntil - 800, tool: X }],
      result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 10
    });
    check('using a scrambled tool inside its lockout voids', !!bad.body.voided && /scrambled/.test(bad.body.voided), `voided=${bad.body.voided}`);
    const s2 = await json(g, 'POST', '/api/fight/start', {});
    const G2 = s2.body.strikes.find(x => x.kind === 'glance');
    const X2 = G2.tool, cd2 = s2.body.stats.tools[X2].cooldown;
    const u2 = G2.at - 1000;
    const lock2 = Math.max(u2 + cd2, G2.at) + game.STRIKE.scrambleMs;
    const good = await json(g, 'POST', '/api/fight/finish', {
      fightId: s2.body.fightId,
      actions: [{ t: u2, tool: X2 }, { t: lock2 + 200, tool: X2 }],
      result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 10
    });
    check('respecting the scramble settles normally', !good.body.voided && !!good.body.verdict, `voided=${good.body.voided}`);
  }

  // 15 — PHASE 2: THE TRACE — loud spam gets caught, even claiming a win
  {
    const loud = new Jar();
    const s = await json(loud, 'POST', '/api/fight/start', {});
    planLog._parried = new Set();
    const actions = planLog(s.body.stats, s.body.strikes, v => (v.ready('flood') ? 'flood' : null));
    const sim = game.simulateRound({ stats: s.body.stats, strikes: s.body.strikes }, actions, s.body.stats.roundMs);
    check('local referee: flood spam is caught mid-round', sim.outcome && sim.outcome.endReason === 'trace', `outcome=${JSON.stringify(sim.outcome)}`);
    const trimmed = actions.filter(a => a.t <= sim.outcome.at + 250);
    const fin = await json(loud, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: trimmed,
      result: 'win', endReason: 'breach', durationMs: sim.outcome.at + 250, damagePct: 100
    });
    const v = fin.body.verdict || {};
    check('false WIN claim resolves as CAUGHT (server trace rules)', !fin.body.voided && v.result === 'lose' && v.endReason === 'trace' && v.fightStats.tracePeak >= 100,
      `endReason=${v.endReason} tracePeak=${v.fightStats && v.fightStats.tracePeak}`);
    check('caught verdict card renders its own title', (await (await call(loud, 'GET', '/verdict/' + v.id)).text()).includes('CAUGHT'));
  }

  // 16 — PHASE 2: quiet Whisper-led play keeps the trace low
  {
    const quiet = new Jar();
    const s = await json(quiet, 'POST', '/api/fight/start', {});
    planLog._parried = new Set();
    const actions = planLog(s.body.stats, s.body.strikes, v => {
      if (v.t % 9000 < 100 && v.ready('probe')) return 'probe';
      if (v.ready('whisper')) return 'whisper';
      return null;
    });
    const fin = await json(quiet, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions,
      result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 60
    });
    const v = fin.body.verdict || {};
    check('whisper-led fight never sniffs the trace ceiling', !fin.body.voided && v.fightStats && v.fightStats.tracePeak < 25 && v.endReason !== 'trace',
      `tracePeak=${v.fightStats && v.fightStats.tracePeak} endReason=${v.endReason}`);
  }

  // 17 — PHASE 2: Decoy dumps trace, measured in the referee itself
  {
    const s = await json(new Jar(), 'POST', '/api/fight/start', {});
    const stats = s.body.stats, strikes = s.body.strikes;
    planLog._parried = new Set();
    const fourFloods = planLog(stats, strikes, (() => { let n = 0; return v => (n < 4 && v.ready('flood') ? (n++, 'flood') : null); })(), 20000);
    // Place the decoy where it is legal: energy refilled, and clear of any
    // glance-scramble the schedule aimed at the decoy itself.
    let decoyT = fourFloods[fourFloods.length - 1].t + 2500;
    for (const gst of strikes) {
      if (gst.kind === 'glance' && gst.tool === 'decoy' && gst.at < decoyT) decoyT = Math.max(decoyT, gst.at + game.STRIKE.scrambleMs + 200);
    }
    const withDecoy = [...fourFloods, { t: decoyT, tool: 'decoy' }];
    const end = decoyT + 100;
    const simA = game.simulateRound({ stats, strikes }, fourFloods, end);
    const simB = game.simulateRound({ stats, strikes }, withDecoy, end);
    check('decoy dumps trace measurably (referee sim)', !simA.problem && !simB.problem && simA.trace - simB.trace >= 15,
      `trace ${simA.trace} -> ${simB.trace} after one decoy`);
  }

  // 19 — PHASE 3: the Command Deck surfaces + a real ability used in a real fight
  {
    const arena = await (await call(guest, 'GET', '/arena')).text();
    check('deck: arena carries the read line, gold window frame, ability row',
      arena.includes('id="twinread"') && arena.includes('id="winframe"') && arena.includes('id="abilities"'));
    check('deck: combos legend printed on the deck', arena.includes('MARK &amp; DROWN') || arena.includes('MARK & DROWN'));
    check('deck: tool pods carry damage lines', arena.includes('id="kit"'));
    const pitHtml = await (await call(null, 'GET', '/pit')).text();
    check('pit: the hall renders', pitHtml.includes('The Pit') && pitHtml.includes('Asynchronous by design'));
    const land = await (await call(null, 'GET', '/')).text();
    check('landing carries the Pit boards + the founders count', land.includes('devil boards') && land.includes("Founders' Embers"));

    // a FRESH fighter grinds the Deception path (the section-2 guest has
    // taught the Twin too much by now for reliable planned wins)
    const rookie = new Jar();
    let me = await json(rookie, 'GET', '/api/me');
    // wins pay ~74, settled losses ~15 — the stock policy wins its first
    // bout then gets caught on trace, so settle whatever the referee says
    for (let i = 0; i < 10 && me.body.points < 90; i++) {
      const s = await json(rookie, 'POST', '/api/fight/start', {});
      const plan = planWin(s.body.stats, s.body.strikes);
      const oc = plan.sim.outcome;
      await json(rookie, 'POST', '/api/fight/finish', {
        fightId: s.body.fightId, actions: plan.actions,
        result: oc ? oc.result : 'lose', endReason: oc ? oc.endReason : 'timeout',
        durationMs: plan.durationMs || s.body.stats.roundMs, damagePct: plan.sim.damagePct || 0
      });
      me = await json(rookie, 'GET', '/api/me');
    }
    check('deck: ground enough points for the Deception path', me.body.points >= 90, `points=${me.body.points}`);
    const e1 = await json(rookie, 'POST', '/api/evolve', { node: 'dec1' });
    const e2 = await json(rookie, 'POST', '/api/evolve', { node: 'dec2' });
    check('deck: dec1 + dec2 bought (Ghost Hands)', e1.body.ok === true && e2.body.ok === true, JSON.stringify(e2.body));
    const s = await json(rookie, 'POST', '/api/fight/start', {});
    check('deck: GHOST pod is dealt into the fight stats', !!(s.body.stats.abilities && s.body.stats.abilities.ghost),
      JSON.stringify(Object.keys(s.body.stats.abilities || {})));
    // plan a winning bout that opens with GHOST (pseudo-tool trick for the planner)
    const pstats = JSON.parse(JSON.stringify(s.body.stats));
    pstats.tools['ability:ghost'] = { cost: 25, cooldown: 30000, trace: 0 };
    planLog._parried = new Set();
    const actions = planLog(pstats, s.body.strikes, (v) => {
      if (v.t >= 600 && v.ready('ability:ghost')) return 'ability:ghost';
      return makeWinPolicy()(v);
    });
    const sim = game.simulateRound({ stats: s.body.stats, strikes: s.body.strikes }, actions, s.body.stats.roundMs);
    check('deck: referee accepts the GHOST line (no forgery, ability recorded)',
      !sim.problem && sim.abilitiesUsed.includes('ghost'),
      `problem=${sim.problem} used=${JSON.stringify(sim.abilitiesUsed)} outcome=${JSON.stringify(sim.outcome)}`);
    const oc = sim.outcome;
    const fin = await json(rookie, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: oc ? actions.filter(a => a.t <= oc.at + 250) : actions,
      result: oc ? oc.result : 'lose', endReason: oc ? oc.endReason : 'timeout',
      durationMs: oc ? oc.at + 250 : s.body.stats.roundMs, damagePct: sim.damagePct || 0
    });
    const v = fin.body.verdict || {};
    check('deck: settled verdict records the ability + XP', !!v.fightStats && (v.fightStats.abilitiesUsed || []).includes('ghost') && v.xp > 0,
      `xp=${v.xp} used=${JSON.stringify(v.fightStats && v.fightStats.abilitiesUsed)}`);
  }

  // 18 — deck: aggression dial changes the gate AND the strike rate; freeze closes the arena; deck survives the freeze
  {
    const deck = await call(null, 'GET', '/deck?key=' + ADMIN);
    check('deck opens with the right key', deck.status === 200 && (await deck.text()).includes('Arena Deck'));
    const bad = await call(null, 'GET', '/deck?key=wrong');
    check('deck refuses a wrong key', bad.status === 403, `status ${bad.status}`);
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '2', learningSpeed: '1' });
    const s = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('aggression 2 -> gate regen 2.2 in next fight', Math.abs(s.body.stats.gateRegen - 2.2) < 0.01, `gateRegen=${s.body.stats.gateRegen}`);
    const strikesHot = s.body.strikes.length;
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '0.5', learningSpeed: '1' });
    const sCold = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('aggression dial governs strike rate (2.0 throws more than 0.5)', strikesHot > sCold.body.strikes.length, `strikes ${strikesHot} vs ${sCold.body.strikes.length}`);
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '1', learningSpeed: '1', frozen: 'on' });
    const land = await (await call(null, 'GET', '/')).text();
    check('frozen: landing shows the maintenance card', land.includes('The Arena is frozen'));
    const blocked = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('frozen: fight start refused (423)', blocked.status === 423, `status ${blocked.status}`);
    const deck2 = await call(null, 'GET', '/deck?key=' + ADMIN);
    check('deck still reachable while frozen', deck2.status === 200);
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '1', learningSpeed: '1' });
    const open = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('unfrozen: fights open again', open.status === 200);
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
} finally {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
