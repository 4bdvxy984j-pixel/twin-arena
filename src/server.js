'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const game = require('./game');
const views = require('./views');

const PORT = process.env.PORT || 4170;
const ADMIN_KEY = process.env.ADMIN_KEY || 'twin-deck';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

store.load();
const state = store.get();
const activeFights = new Map(); // fightId -> fight (memory only; a restart voids open rounds)

const rid = (n) => crypto.randomBytes(n).toString('hex');

// ---------- helpers ----------
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, days) {
  const exp = new Date(Date.now() + (days || 30) * 864e5).toUTCString();
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Expires=${exp}; HttpOnly; SameSite=Lax`);
}
function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function bodyJson(req) {
  const buf = await readBody(req, 512 * 1024);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}
async function bodyForm(req) {
  const buf = await readBody(req, 128 * 1024);
  return Object.fromEntries(new URLSearchParams(buf.toString('utf8')));
}
function sendHtml(res, html, status) {
  res.writeHead(status || 200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
function sendJson(res, obj, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function redirect(res, to) { res.writeHead(303, { Location: to }); res.end(); }

// ---------- identity ----------
function newPlayer(displayName) {
  const p = {
    id: rid(9), email: null, pass: null,
    displayName: displayName || null,
    photo: null, points: 0, nodes: {}, shapes: {},
    twinArmor: {}, challengeToken: rid(10),
    record: { bouts: 0, breaches: 0, streak: 0, bestSecs: null },
    challengeFeed: [], publicProfile: true, createdAt: Date.now(), lastFightAt: null
  };
  state.players[p.id] = p;
  return p;
}
function identity(req, res) {
  const c = cookies(req);
  if (c.ta_sess && state.sessions[c.ta_sess] && state.players[state.sessions[c.ta_sess]]) {
    return state.players[state.sessions[c.ta_sess]];
  }
  if (c.ta_gid && state.players[c.ta_gid] && !state.players[c.ta_gid].email) {
    return state.players[c.ta_gid];
  }
  const g = newPlayer(null);
  setCookie(res, 'ta_gid', g.id, 365);
  store.save();
  return g;
}
function startSession(res, player) {
  const tok = rid(24);
  state.sessions[tok] = player.id;
  setCookie(res, 'ta_sess', tok, 30);
  store.save();
}
function hashPass(password) {
  const salt = rid(16);
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function checkPass(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}

// ---------- multipart (photo upload) ----------
function parseMultipart(buf, contentType) {
  const m = /boundary=(.+)$/.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + m[1].trim());
  const parts = [];
  let start = buf.indexOf(boundary);
  while (start >= 0) {
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd < 0) break;
    const header = buf.slice(start + boundary.length, headEnd).toString('utf8');
    const dataStart = headEnd + 4;
    let end = buf.indexOf(boundary, dataStart);
    if (end < 0) break;
    const data = buf.slice(dataStart, end - 2); // strip trailing CRLF
    const nameM = /name="([^"]+)"/.exec(header);
    const fileM = /filename="([^"]*)"/.exec(header);
    parts.push({ name: nameM && nameM[1], filename: fileM && fileM[1], data });
    start = end;
    if (buf.slice(end, end + boundary.length + 2).toString('utf8').endsWith('--')) break;
  }
  return parts;
}
function imageExt(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return ['jpg', 'image/jpeg'];
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return ['png', 'image/png'];
  if (buf.length > 4 && buf.slice(0, 4).toString() === 'GIF8') return ['gif', 'image/gif'];
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return ['webp', 'image/webp'];
  return null;
}

// ---------- static ----------
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml' };
function serveStatic(res, baseDir, urlPath) {
  const clean = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(baseDir, clean);
  if (!file.startsWith(baseDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  let type = MIME[ext];
  if (!type && baseDir === store.UPLOAD_DIR) {
    type = { '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[ext];
  }
  res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---------- routes ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const method = req.method;

  if (p.startsWith('/css/') || p.startsWith('/js/')) { if (serveStatic(res, PUBLIC_DIR, p.slice(1))) return; }
  if (p.startsWith('/uploads/')) { if (serveStatic(res, store.UPLOAD_DIR, p.slice('/uploads/'.length))) return; }

  const me = identity(req, res);

  // ---- pages
  if (method === 'GET' && p === '/') return sendHtml(res, views.landing(state, me));
  if (method === 'GET' && p === '/arena') {
    let challenge = null;
    const tok = url.searchParams.get('challenge');
    if (tok) {
      const owner = Object.values(state.players).find(x => x.challengeToken === tok);
      if (owner) challenge = { token: tok, ownerName: owner.displayName || 'A fighter' };
    }
    return sendHtml(res, views.arenaPage(state, me, challenge));
  }
  if (method === 'GET' && p === '/login') return sendHtml(res, views.authPage(state, me, 'login'));
  if (method === 'GET' && p === '/signup') return sendHtml(res, views.authPage(state, me, 'signup'));
  if (method === 'GET' && p === '/profile') {
    if (!me.email) return sendHtml(res, views.authPage(state, me, 'signup'));
    return sendHtml(res, views.profilePage(state, me));
  }
  if (method === 'GET' && p === '/web') {
    return sendHtml(res, views.webPage(state, me));
  }
  if (method === 'GET' && p.startsWith('/fighter/')) {
    const f = state.players[p.slice('/fighter/'.length)];
    if (!f || !f.email) return sendHtml(res, views.shell('Not found', '<section class="authbox"><h1>No such fighter</h1></section>', me), 404);
    return sendHtml(res, views.fighterPage(state, f));
  }
  if (method === 'GET' && p.startsWith('/challenge/')) {
    const tok = p.slice('/challenge/'.length);
    const owner = Object.values(state.players).find(x => x.challengeToken === tok);
    if (!owner) return sendHtml(res, views.shell('Not found', '<section class="authbox"><h1>That challenge has faded.</h1></section>', me), 404);
    return sendHtml(res, views.challengePage(state, owner, me));
  }
  if (method === 'GET' && p.startsWith('/verdict/')) {
    const v = state.verdicts[p.slice('/verdict/'.length)];
    if (!v) return sendHtml(res, views.shell('Not found', '<section class="authbox"><h1>No such verdict.</h1></section>', me), 404);
    return sendHtml(res, views.verdictPage(state, v, me));
  }
  if (method === 'GET' && p === '/deck') {
    const key = url.searchParams.get('key') || '';
    if (key !== ADMIN_KEY) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Arena Deck</h1><form class="authform" method="get" action="/deck"><label>Deck key<input name="key" type="password"></label><button class="fightbtn" type="submit">Enter</button></form></section>', null), 403);
    return sendHtml(res, views.deckPage(state, key, url.searchParams.get('saved') === '1'));
  }

  // ---- auth
  if (method === 'POST' && p === '/auth/signup') {
    const f = await bodyForm(req);
    const email = String(f.email || '').trim().toLowerCase();
    const password = String(f.password || '');
    const name = String(f.displayName || '').trim().slice(0, 40);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendHtml(res, views.authPage(state, me, 'signup', 'That email does not look right.'), 400);
    if (password.length < 8) return sendHtml(res, views.authPage(state, me, 'signup', 'Password needs at least 8 characters.'), 400);
    if (Object.values(state.players).some(x => x.email === email)) return sendHtml(res, views.authPage(state, me, 'signup', 'That email already fights here. Sign in instead.'), 400);
    // Carry-over: a guest record claiming a profile keeps its points, web and grudge.
    const rec = me.email ? newPlayer(name) : me;
    rec.email = email; rec.pass = hashPass(password);
    if (name) rec.displayName = name;
    store.save(true);
    startSession(res, rec);
    return redirect(res, '/profile');
  }
  if (method === 'POST' && p === '/auth/login') {
    const f = await bodyForm(req);
    const email = String(f.email || '').trim().toLowerCase();
    const rec = Object.values(state.players).find(x => x.email === email);
    if (!rec || !checkPass(String(f.password || ''), rec.pass)) {
      return sendHtml(res, views.authPage(state, me, 'login', 'Email or password did not match. The Twin is patient; try again.'), 401);
    }
    startSession(res, rec);
    return redirect(res, '/profile');
  }
  if (method === 'GET' && p === '/auth/logout') {
    const c = cookies(req);
    if (c.ta_sess) delete state.sessions[c.ta_sess];
    clearCookie(res, 'ta_sess');
    store.save();
    return redirect(res, '/');
  }

  // ---- public state (landing polling)
  if (method === 'GET' && p === '/api/public/state') {
    const leaders = Object.values(state.players)
      .filter(x => x.email && x.publicProfile !== false && x.record.bouts > 0)
      .sort((a, b) => (b.record.breaches - a.record.breaches) || (b.points - a.points)).slice(0, 8)
      .map(x => ({ id: x.id, name: x.displayName, photo: x.photo, breaches: x.record.breaches, points: x.points }));
    return sendJson(res, { meter: game.educationMeter(state), fights: state.fights.slice(0, 10), leaders, frozen: state.config.frozen });
  }
  if (method === 'GET' && p === '/api/me') {
    return sendJson(res, {
      id: me.id, claimed: !!me.email, name: me.displayName, photo: me.photo,
      points: me.points, nodes: Object.keys(me.nodes || {}),
      record: me.record, challengeToken: me.challengeToken
    });
  }
  if (method === 'GET' && p === '/api/web') {
    return sendJson(res, { nodes: game.NODES, owned: me.nodes || {}, points: me.points });
  }
  if (method === 'POST' && p === '/api/evolve') {
    const f = await bodyJson(req);
    const node = game.NODE_BY_ID[String(f.node || '')];
    if (!node) return sendJson(res, { error: 'unknown node' }, 400);
    if (me.nodes[node.id]) return sendJson(res, { error: 'already evolved' }, 400);
    if (node.tier > 1) {
      const prev = game.NODES.find(n => n.branch === node.branch && n.tier === node.tier - 1);
      if (prev && !me.nodes[prev.id]) return sendJson(res, { error: 'evolve ' + prev.name + ' first' }, 400);
    }
    if (me.points < node.cost) return sendJson(res, { error: 'not enough points' }, 400);
    me.points -= node.cost;
    me.nodes[node.id] = true;
    store.save(true);
    return sendJson(res, { ok: true, points: me.points, owned: me.nodes });
  }

  // ---- photo upload
  if (method === 'POST' && p === '/api/photo') {
    if (!me.email) return redirect(res, '/signup');
    const buf = await readBody(req, 3 * 1024 * 1024).catch(() => null);
    if (!buf) return sendHtml(res, views.shell('Too large', '<section class="authbox"><h1>That photo is too large.</h1><p><a href="/profile">Back to your profile</a></p></section>', me), 413);
    const parts = parseMultipart(buf, req.headers['content-type']);
    const file = parts && parts.find(x => x.name === 'photo' && x.filename);
    if (!file || !file.data.length) return redirect(res, '/profile');
    if (file.data.length > 2 * 1024 * 1024) return sendHtml(res, views.shell('Too large', '<section class="authbox"><h1>Photos are capped at 2 MB.</h1><p><a href="/profile">Back to your profile</a></p></section>', me), 413);
    const kind = imageExt(file.data);
    if (!kind) return sendHtml(res, views.shell('Not an image', '<section class="authbox"><h1>That file is not a PNG, JPEG, GIF or WebP image.</h1><p><a href="/profile">Back to your profile</a></p></section>', me), 400);
    const fname = me.id + '.' + kind[0];
    fs.writeFileSync(path.join(store.UPLOAD_DIR, fname), file.data);
    me.photo = '/uploads/' + fname;
    store.save(true);
    return redirect(res, '/profile');
  }

  // ---- profile settings
  if (method === 'POST' && p === '/api/profile/settings') {
    if (!me.email) return redirect(res, '/signup');
    const f = await bodyForm(req);
    if (f.displayName !== undefined) me.displayName = String(f.displayName).trim().slice(0, 40) || me.displayName;
    me.publicProfile = f.publicProfile === 'on';
    store.save(true);
    return redirect(res, '/profile');
  }

  // ---- fights
  if (method === 'POST' && p === '/api/fight/start') {
    if (state.config.frozen) return sendJson(res, { error: 'frozen', message: 'The arena is frozen.' }, 423);
    const f = await bodyJson(req).catch(() => ({}));
    let mode = 'breach', owner = null;
    if (f.challenge) {
      owner = Object.values(state.players).find(x => x.challengeToken === String(f.challenge));
      if (!owner) return sendJson(res, { error: 'challenge not found' }, 404);
      mode = 'challenge';
    }
    const armorMap = mode === 'challenge' ? (owner.twinArmor || {}) : (me.twinArmor || {});
    const stats = game.effectiveStats(state, me, armorMap);
    const seed = crypto.randomInt(1, 2147483647);
    const strikes = game.makeStrikes(seed, stats.roundMs, state.config.aggression);
    const fight = {
      id: rid(10), playerId: me.id, mode,
      challengeOwnerId: owner ? owner.id : null,
      stats, seed, strikes, startedAt: Date.now()
    };
    activeFights.set(fight.id, fight);
    return sendJson(res, { fightId: fight.id, stats, strikes, mode, ownerName: owner ? (owner.displayName || 'A fighter') : null });
  }
  if (method === 'POST' && p === '/api/fight/finish') {
    const f = await bodyJson(req);
    const fight = activeFights.get(String(f.fightId || ''));
    if (!fight || fight.playerId !== me.id) return sendJson(res, { error: 'fight not found or not yours' }, 404);
    activeFights.delete(fight.id);
    const claimedDuration = Math.min(Math.max(0, +f.durationMs || 0), fight.stats.roundMs + 5000);
    const actions = Array.isArray(f.actions) ? f.actions : [];
    // The referee replays the round: strikes, integrity and trace are
    // server-computed, so the client's claimed ending is checked against the
    // truth — and where the truth is terminal (breach, thrown out, caught),
    // the truth is what stands.
    const sim = game.simulateRound(fight, actions, claimedDuration);
    let resolved = null;
    if (!sim.problem) {
      if (sim.outcome) {
        resolved = { result: sim.outcome.result, endReason: sim.outcome.endReason, durationMs: sim.outcome.at };
      } else if (claimedDuration >= fight.stats.roundMs - 1500) {
        resolved = { result: 'lose', endReason: 'timeout', durationMs: claimedDuration };
      }
    }
    const problem = sim.problem || (resolved ? null : 'round ended without cause');
    if (problem) {
      // Honest void: the bout is remembered, but an implausible log teaches
      // nothing and earns nothing.
      me.record.bouts += 1;
      me.record.streak = me.record.streak < 0 ? me.record.streak - 1 : -1;
      const v = {
        id: fight.id, fighterId: me.id, fighterName: me.displayName || 'A guest fighter',
        mode: fight.mode, challengeOwnerId: fight.challengeOwnerId, result: 'lose', endReason: 'void',
        secs: Math.round(claimedDuration / 1000), points: 0, shapesTaught: [], shapesTaughtCount: 0,
        newToWorldCount: 0, armorGains: {}, fightStats: null, at: Date.now(), voided: problem
      };
      state.verdicts[fight.id] = v;
      state.fights.unshift({ id: fight.id, name: v.fighterName, result: 'lose', how: 'void', secs: v.secs, shapes: 0, mode: fight.mode, at: v.at });
      state.fights = state.fights.slice(0, 60);
      store.save(true);
      return sendJson(res, { verdict: v, voided: problem });
    }
    // Only the actions up to the true end of the round teach the Twin.
    const settledActions = sim.outcome ? actions.filter(a => a && a.t <= sim.outcome.at + 250) : actions;
    const verdict = game.settleFight(state, me, fight, {
      actions: settledActions,
      result: resolved.result, endReason: resolved.endReason,
      durationMs: resolved.durationMs, damagePct: sim.damagePct,
      fightStats: {
        integrityLeft: sim.integrityLeft, tracePeak: sim.tracePeak,
        parries: sim.parries, strikesTaken: sim.strikesTaken,
        vulnBonus: sim.vulnBonus, damageDealt: sim.dmgTotal
      }
    });
    store.save(true);
    return sendJson(res, { verdict });
  }

  // ---- deck
  if (method === 'POST' && p === '/api/deck/config') {
    const f = await bodyForm(req);
    if (String(f.key || '') !== ADMIN_KEY) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Wrong key.</h1></section>', null), 403);
    const clamp = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : Math.min(2, Math.max(0.5, n)); };
    state.config.aggression = clamp(f.aggression, state.config.aggression);
    state.config.learningSpeed = clamp(f.learningSpeed, state.config.learningSpeed);
    state.config.frozen = f.frozen === 'on';
    store.save(true);
    return redirect(res, '/deck?key=' + encodeURIComponent(ADMIN_KEY) + '&saved=1');
  }

  return sendHtml(res, views.shell('Not found', '<section class="authbox"><h1>Nothing stands here.</h1><p><a href="/">Back to the arena door</a></p></section>', me), 404);
}

const server = http.createServer((req, res) => {
  route(req, res).catch(e => {
    console.error(e);
    if (!res.headersSent) sendJson(res, { error: 'server error' }, 500);
  });
});
server.listen(PORT, () => console.log(`THE TWIN ARENA listening on :${PORT} (data: ${store.DATA_DIR})`));
