// THE TWIN ARENA — SUPER DECK walk (Phase 2.5). Boots a throwaway server
// (temp DATA_DIR, port 4198) and proves every deck control moves the real
// game: storm (points ×2 + aggression floor, in the referee), THE TWIN
// SPEAKS, floodgates (trace halved in the referee), spotlight, the wall,
// the member-key tie (hash-only storage, owner fighter binding), and the
// Phase 1 dials/freeze as regression. Run via `npm run verify` (after the
// main battery) or directly: node scripts/verify-deck.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import game from '../src/game.js';

const PORT = 4198;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'deck-test-key';
const TESTKEY = 'test-member-key-0000-not-a-real-key';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-deck-'));
const stateFile = path.join(dataDir, 'state.json');

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
  return { status: res.status, text: await res.text(), location: res.headers.get('location') || '' };
}
async function page(jar, url) {
  const res = await call(jar, 'GET', url);
  return { status: res.status, text: await res.text(), location: res.headers.get('location') || '' };
}
// An idle fighter: one probe, then the Twin finishes the argument. The
// referee resolves this as an integrity defeat with the gate fully healed —
// a deterministic points line (10 + 0 damage + 3 for the one new shape).
async function idleLoss(jar) {
  const s = await json(jar, 'POST', '/api/fight/start', {});
  const fin = await json(jar, 'POST', '/api/fight/finish', {
    fightId: s.body.fightId, actions: [{ t: 1000, tool: 'probe' }],
    result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 0
  });
  return { start: s.body, verdict: fin.body.verdict || {}, voided: fin.body.voided };
}
function fakeState(cfg = {}) {
  return {
    config: { aggression: 1, learningSpeed: 1, frozen: false, stormUntil: 0, broadcast: null, floodgates: false, spotlight: null, ...cfg },
    players: {}, sessions: {}, shapesGlobal: {}, globalArmor: {}, fights: [], fightSeq: 0, verdicts: {},
    deck: { memberTieHash: null, ownerPlayerId: null }, deckSessions: {}
  };
}
function fakePlayer() {
  return { id: 'fake', email: null, displayName: 'Fake', photo: null, points: 0, nodes: {}, shapes: {}, twinArmor: {}, challengeToken: 'x', record: { bouts: 0, breaches: 0, streak: 0, bestSecs: null }, challengeFeed: [], publicProfile: true };
}

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

  // 0 — boot + two claimed fighters to pin, challenge and bind against
  const vera = new Jar(), jax = new Jar();
  {
    const home = await page(null, '/');
    check('landing loads', home.status === 200 && home.text.includes('FIGHT THE TWIN'), `status ${home.status}`);
    await form(vera, '/auth/signup', { displayName: 'Vera Voss', email: 'vera@example.com', password: 'password123' });
    await form(jax, '/auth/signup', { displayName: 'Jax Meridian', email: 'jax@example.com', password: 'password123' });
    var veraMe = (await json(vera, 'GET', '/api/me')).body;
    var jaxMe = (await json(jax, 'GET', '/api/me')).body;
    check('two fighters claimed with challenge tokens', !!veraMe.challengeToken && !!jaxMe.id && veraMe.id !== jaxMe.id, `vera=${veraMe.id} jax=${jaxMe.id}`);
  }

  // 1 — UNIT: floodgates halve trace gains inside the referee itself
  {
    const st = fakeState();
    const pl = fakePlayer();
    const off = game.effectiveStats(st, pl, {});
    const simOff = game.simulateRound({ stats: off, strikes: [] }, [{ t: 1000, tool: 'flood' }], 2000);
    st.config.floodgates = true;
    const on = game.effectiveStats(st, pl, {});
    const simOn = game.simulateRound({ stats: on, strikes: [] }, [{ t: 1000, tool: 'flood' }], 2000);
    check('floodgates: dealt flood trace 14 -> 7 in the stats', off.tools.flood.trace === 14 && on.tools.flood.trace === 7, `off=${off.tools.flood.trace} on=${on.tools.flood.trace}`);
    check('floodgates: referee trace for the same loud log is exactly half', simOff.tracePeak === 14 && simOn.tracePeak === 7, `peak ${simOff.tracePeak} -> ${simOn.tracePeak}`);
  }

  // 2 — UNIT: storm doubles the settled verdict, exactly
  {
    const settleOnce = (mult) => {
      const st = fakeState(); const pl = fakePlayer();
      const stats = game.effectiveStats(st, pl, {});
      const fight = { id: 'u' + mult, stats, mode: 'breach', challengeOwnerId: null, storm: mult > 1, pointsMult: mult };
      return game.settleFight(st, pl, fight, {
        actions: [{ t: 1000, tool: 'flood' }, { t: 6000, tool: 'flood' }],
        result: 'win', endReason: 'breach', durationMs: 30000, damagePct: 100, fightStats: null
      });
    };
    const v1 = settleOnce(1), v2 = settleOnce(2);
    check('storm: identical win settles for exactly double under storm', v1.points > 0 && v2.points === v1.points * 2 && v2.storm === true && !v1.storm, `points ${v1.points} -> ${v2.points}`);
  }

  // 3 — baseline: an idle loss in calm weather pays the plain line (13)
  {
    const g = new Jar();
    const r = await idleLoss(g);
    check('calm-weather idle loss pays 13 (10 + 0 dmg + 3 new shape)', !r.voided && r.verdict.endReason === 'integrity' && r.verdict.points === 13 && !r.verdict.storm, `points=${r.verdict.points} endReason=${r.verdict.endReason}`);
  }

  // 4 — THE WALL renders the readouts
  {
    const deck = await page(null, '/deck?key=' + ADMIN);
    check('the wall: meter, tallies, recent fights, leaderboard all on the deck',
      deck.status === 200 && deck.text.includes('THE WALL') && deck.text.includes('verdicts today') &&
      deck.text.includes('breached today') && deck.text.includes('thrown out') && deck.text.includes('caught') &&
      deck.text.includes('Recent fights') && deck.text.includes('Top of the leaderboard'), `status ${deck.status}`);
  }

  // 5 — STORM integration: floor beats the dial, banner up, verdicts double
  {
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '0.5', learningSpeed: '1' });
    const cold = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('dial 0.5, no storm: gate regen 0.55', Math.abs(cold.body.stats.gateRegen - 0.55) < 0.01, `gateRegen=${cold.body.stats.gateRegen}`);
    const coldStrikes = cold.body.strikes.length;
    const fired = await form(null, '/api/deck/storm', { key: ADMIN, minutes: '30' });
    check('storm fired from the deck (303)', fired.status === 303, `status ${fired.status}`);
    const pub = await json(null, 'GET', '/api/public/state');
    check('public state reports the live storm + countdown', pub.body.storm.active === true && pub.body.storm.secsLeft > 1700, `secsLeft=${pub.body.storm.secsLeft}`);
    const home = await page(null, '/');
    check('storm banner stands on the landing', home.text.includes('STORM IN THE ARENA') && home.text.includes('double points'));
    const hot = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('storm floor: gate regen 1.76 despite dial 0.5, fight flagged storm', hot.body.storm === true && Math.abs(hot.body.stats.gateRegen - 1.76) < 0.01, `gateRegen=${hot.body.stats.gateRegen} storm=${hot.body.storm}`);
    check('storm floor: strike rate rises above the cold dial', hot.body.strikes.length > coldStrikes, `strikes ${coldStrikes} -> ${hot.body.strikes.length}`);
    const deck = await page(null, '/deck?key=' + ADMIN);
    check('deck shows the storm clock (STORM LIVE)', deck.text.includes('STORM LIVE'));
    const g = new Jar();
    const r = await idleLoss(g);
    check('storm idle loss pays exactly double the calm line (26)', !r.voided && r.verdict.points === 26 && r.verdict.storm === true, `points=${r.verdict.points} storm=${r.verdict.storm}`);
    await form(null, '/api/deck/storm', { key: ADMIN, cancel: '1' });
    const pub2 = await json(null, 'GET', '/api/public/state');
    check('storm cancelled: public state calm again', pub2.body.storm.active === false);
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '1', learningSpeed: '1' });
  }

  // 6 — THE TWIN SPEAKS: set, heard on door + arena, escaped, cleared
  {
    await form(null, '/api/deck/broadcast', { key: ADMIN, text: 'THE GATE REMEMBERS YOU.', minutes: '30' });
    const home = await page(null, '/');
    const arena = await page(null, '/arena');
    const pub = await json(null, 'GET', '/api/public/state');
    check('broadcast stands on landing + arena + public state', home.text.includes('THE TWIN SPEAKS') && home.text.includes('THE GATE REMEMBERS YOU.') && arena.text.includes('THE GATE REMEMBERS YOU.') && pub.body.broadcast === 'THE GATE REMEMBERS YOU.');
    await form(null, '/api/deck/broadcast', { key: ADMIN, text: '<script>alert(1)</script>', minutes: '30' });
    const home2 = await page(null, '/');
    check('broadcast is HTML-escaped everywhere it renders', home2.text.includes('&lt;script&gt;alert(1)') && !home2.text.includes('<script>alert(1)'));
    await form(null, '/api/deck/broadcast', { key: ADMIN, clear: '1' });
    const home3 = await page(null, '/');
    const pub3 = await json(null, 'GET', '/api/public/state');
    check('broadcast cleared: gone from the door and the wire', !home3.text.includes('THE TWIN SPEAKS') && pub3.body.broadcast === null);
  }

  // 7 — FLOODGATES integration: the arena shows it, the referee halves it
  {
    await form(null, '/api/deck/floodgates', { key: ADMIN, state: 'on' });
    const pub = await json(null, 'GET', '/api/public/state');
    const arena = await page(null, '/arena');
    check('floodgates on: public state + arena banner show it honestly', pub.body.floodgates === true && arena.text.includes('THE FLOODGATES ARE OPEN'));
    const jar = new Jar();
    const s = await json(jar, 'POST', '/api/fight/start', {});
    check('floodgates on: dealt flood trace is 7', s.body.floodgates === true && s.body.stats.tools.flood.trace === 7, `trace=${s.body.stats.tools.flood.trace}`);
    const fin = await json(jar, 'POST', '/api/fight/finish', {
      fightId: s.body.fightId, actions: [{ t: 1000, tool: 'flood' }],
      result: 'lose', endReason: 'timeout', durationMs: 150000, damagePct: 0
    });
    check('floodgates on: settled verdict tracePeak is the halved 7', !fin.body.voided && fin.body.verdict.fightStats.tracePeak === 7, `tracePeak=${fin.body.verdict && fin.body.verdict.fightStats.tracePeak}`);
    await form(null, '/api/deck/floodgates', { key: ADMIN, state: 'off' });
    const s2 = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('floodgates off: flood trace back to full 14', s2.body.stats.tools.flood.trace === 14, `trace=${s2.body.stats.tools.flood.trace}`);
  }

  // 8 — SPOTLIGHT: pin by token, by id; bogus refused; clear works
  {
    const pin = await form(null, '/api/deck/spotlight', { key: ADMIN, pin: veraMe.challengeToken });
    check('spotlight pin by challenge token accepted (303)', pin.status === 303 && pin.location.includes('saved=1'), `location=${pin.location}`);
    const home = await page(null, '/');
    const pub = await json(null, 'GET', '/api/public/state');
    check("landing carries Tonight's Devil with the real challenge link", home.text.includes("TONIGHT'S DEVIL") && home.text.includes('Vera Voss') && home.text.includes('/challenge/' + veraMe.challengeToken) && pub.body.spotlight && pub.body.spotlight.token === veraMe.challengeToken);
    await form(null, '/api/deck/spotlight', { key: ADMIN, clear: '1' });
    const home2 = await page(null, '/');
    check('spotlight cleared from the door', !home2.text.includes("TONIGHT'S DEVIL"));
    await form(null, '/api/deck/spotlight', { key: ADMIN, pin: jaxMe.id });
    const home3 = await page(null, '/');
    check('spotlight pin by fighter id works', home3.text.includes("TONIGHT'S DEVIL") && home3.text.includes('Jax Meridian'));
    const bogus = await form(null, '/api/deck/spotlight', { key: ADMIN, pin: 'zzz-no-such-fighter' });
    check('bogus spotlight pin rejected with a plain error', bogus.status === 303 && bogus.location.includes('error=spotlight'), `location=${bogus.location}`);
    const deck = await page(null, '/deck?key=' + ADMIN + '&error=spotlight');
    const home4 = await page(null, '/');
    check('deck shows the refusal; the real pin stands untouched', deck.text.includes('No fighter or challenge matches') && home4.text.includes('Jax Meridian'));
    await form(null, '/api/deck/spotlight', { key: ADMIN, clear: '1' });
  }

  // 9 — MEMBER-KEY TIE: hash-only storage, owner binding, sign-in, removal
  {
    const deck = await page(null, '/deck?key=' + ADMIN);
    check('untied deck (admin visit) offers the tie form', deck.text.includes('TIE THIS DECK TO MY MEMBER KEY'));
    const tie = await form(null, '/api/deck/tie', { key: ADMIN, memberKey: TESTKEY });
    check('tie accepted (303, notice=tied)', tie.status === 303 && tie.location.includes('notice=tied'), `location=${tie.location}`);
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    check('the raw member key appears NOWHERE in the data file', !raw.includes(TESTKEY));
    check('only a scrypt hash of the key is stored', !!parsed.deck.memberTieHash && !parsed.deck.memberTieHash.includes(TESTKEY) && parsed.deck.memberTieHash.includes(':'));
    const owner = Object.values(parsed.players).find(p => p.email === 'stevenh18818@gmail.com');
    check('owner fighter bound: member email, name, owner flag', !!owner && owner.displayName === 'Steven Hall' && owner.isOwner === true && parsed.deck.ownerPlayerId === owner.id, owner && `id=${owner.id}`);
    const fpage = await page(null, '/fighter/' + owner.id);
    check('owner fighter profile renders as Steven Hall', fpage.status === 200 && fpage.text.includes('Steven Hall'));
    const deck2 = await page(null, '/deck?key=' + ADMIN);
    check('tied deck shows the tie + the owner fighter + remove control', deck2.text.includes('REMOVE THE TIE') && deck2.text.includes('Steven Hall') && deck2.text.includes('tied to your Gatekeeper Member Key'));
    // member-key sign-in: paste once, ride the session cookie after
    const member = new Jar();
    const signin = await page(member, '/deck?key=' + encodeURIComponent(TESTKEY));
    check('member key opens the deck (303 to a clean /deck, session minted)', signin.status === 303 && signin.location === '/deck', `status=${signin.status} location=${signin.location}`);
    const deckM = await page(member, '/deck');
    check('member session rides the cookie into the deck', deckM.status === 200 && deckM.text.includes('Arena Deck') && deckM.text.includes('Member Key'));
    const wrong = await page(null, '/deck?key=not-the-member-key');
    check('a wrong key is still refused (403)', wrong.status === 403, `status=${wrong.status}`);
    const adminStill = await page(null, '/deck?key=' + ADMIN);
    check('ADMIN_KEY break-glass still works after the tie', adminStill.status === 200);
    // member session can work the controls (cookie auth, no key in any form)
    await form(member, '/api/deck/floodgates', { state: 'on' });
    const pub = await json(null, 'GET', '/api/public/state');
    check('member session works a real control (floodgates on)', pub.body.floodgates === true);
    await form(member, '/api/deck/floodgates', { state: 'off' });
    // remove-tie: wrong admin key refused, tie stands; right key clears it
    await form(null, '/api/deck/untie', { adminKey: 'not-the-admin-key' });
    const still = await page(new Jar(), '/deck?key=' + encodeURIComponent(TESTKEY));
    check('untie with a wrong admin key refused — the tie stands', still.status === 303, `status=${still.status}`);
    await form(null, '/api/deck/untie', { adminKey: ADMIN });
    const gone = await page(null, '/deck?key=' + encodeURIComponent(TESTKEY));
    const raw2 = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    check('untie with the admin key clears the tie', gone.status === 403 && raw2.deck.memberTieHash === null, `status=${gone.status}`);
    const adminAfter = await page(null, '/deck?key=' + ADMIN);
    check('ADMIN_KEY still works after the tie is removed', adminAfter.status === 200);
  }

  // 10 — regression: the Phase 1 dials + freeze, exactly as before
  {
    const bad = await page(null, '/deck?key=wrong');
    check('deck refuses a wrong key (403)', bad.status === 403, `status ${bad.status}`);
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '2', learningSpeed: '1' });
    const s = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('aggression 2 -> gate regen 2.2 in next fight', Math.abs(s.body.stats.gateRegen - 2.2) < 0.01, `gateRegen=${s.body.stats.gateRegen}`);
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '1', learningSpeed: '1', frozen: 'on' });
    const land = await page(null, '/');
    check('frozen: landing shows the maintenance card', land.text.includes('The Arena is frozen'));
    const blocked = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('frozen: fight start refused (423)', blocked.status === 423, `status ${blocked.status}`);
    const deck = await page(null, '/deck?key=' + ADMIN);
    check('deck still reachable while frozen', deck.status === 200);
    await form(null, '/api/deck/config', { key: ADMIN, aggression: '1', learningSpeed: '1' });
    const open = await json(new Jar(), 'POST', '/api/fight/start', {});
    check('unfrozen: fights open again', open.status === 200);
  }

  console.log(failures === 0 ? '\nALL DECK CHECKS PASSED' : `\n${failures} DECK CHECK(S) FAILED`);
} finally {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
