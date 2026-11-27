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

// State is initialized by src/server.js (the boot file) BEFORE this module
// is required — the store is ready here; this module never loads it itself.
const state = store.get();
const activeFights = new Map(); // fightId -> fight (memory only; a restart voids open rounds)
const activeRuns = new Map();   // runId -> Descent run (memory only, same law)

// THE DESCENT's books, for worlds written before it existed.
if (!state.descent) state.descent = { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 };
if (typeof state.descent.godforged !== 'number') state.descent.godforged = 0;
if (!state.gearSeq) state.gearSeq = {};

// THE KEEPER'S SET: if the house owner fighter already exists (the deck was
// tied in an earlier age), grant the master set now — at boot, before any
// fight can settle a drop, so on a fresh world the Keeper's pieces are
// serial No. 1 of each type. If the tie comes later, the tie route grants it.
if (!state.itemsSeq) state.itemsSeq = {};
for (const itemId of Object.keys(game.ITEMS)) if (typeof state.itemsSeq[itemId] !== 'number') state.itemsSeq[itemId] = 0;
if (state.deck && state.deck.ownerPlayerId && state.players[state.deck.ownerPlayerId]) {
  if (game.grantKeeperSet(state, ensurePlayer(state.players[state.deck.ownerPlayerId]))) store.save(true);
}
// Founder's Embers for members claimed before Phase 3 existed: granted in
// signup order (the Keeper already holds No. 1 via his set), idempotently,
// until the 100 are gone — then never again.
{
  const members = Object.values(state.players).filter(x => x.email)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let granted = false;
  for (const m of members) if (game.grantFounderEmber(state, ensurePlayer(m))) granted = true;
  if (granted) store.save(true);
}

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
    challengeFeed: [], publicProfile: true, createdAt: Date.now(), lastFightAt: null,
    // Phase 3: progression + the Pit
    xp: 0, toolUse: {}, parriesTotal: 0,
    taunt: '', devilShapes: {},
    devil: { bounty: game.PIT.bountyBase, bountyDay: game.dayKey(Date.now()), held: 0, breached: 0, lastBreachedBy: null, breachedBy: [] },
    pitAttack: { bouts: 0, breaches: 0 },
    itemStock: { mirrorwrap: [], anchorstitch: [] }, itemHistory: [],
    pitAttempts: {}, defenseXpDay: { day: game.dayKey(Date.now()), count: 0 },
    // THE DESCENT: the satchel's gear shelf + the delve record
    gear: [], descent: { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 },
    // MODS v1: owned mods (unnumbered, permanent) + the fitted sockets
    modsOwned: {}, modsFitted: { probe: null, flood: null, whisper: null, decoy: null }
  };
  state.players[p.id] = p;
  return p;
}
// Records written before Phase 3 lack the new fields; fill them in place.
function ensurePlayer(p) {
  if (!p) return p;
  if (typeof p.xp !== 'number') p.xp = 0;
  if (!p.toolUse) p.toolUse = {};
  if (typeof p.parriesTotal !== 'number') p.parriesTotal = 0;
  if (typeof p.taunt !== 'string') p.taunt = '';
  if (!p.devilShapes) p.devilShapes = {};
  if (!p.devil) p.devil = { bounty: game.PIT.bountyBase, bountyDay: game.dayKey(Date.now()), held: 0, breached: 0, lastBreachedBy: null, breachedBy: [] };
  if (!p.pitAttack) p.pitAttack = { bouts: 0, breaches: 0 };
  if (!p.itemStock) {
    // Migrate any bare pre-edition counts into numbered stock, in order.
    p.itemStock = { mirrorwrap: [], anchorstitch: [] };
    p.itemHistory = p.itemHistory || [];
    for (const itemId of Object.keys(game.ITEMS)) {
      const n = (p.items && p.items[itemId]) || 0;
      for (let i = 0; i < n; i++) game.mintItem(state, p, itemId, 'migration');
    }
  }
  if (!p.itemHistory) p.itemHistory = [];
  if (!p.pitAttempts) p.pitAttempts = {};
  if (!p.defenseXpDay) p.defenseXpDay = { day: game.dayKey(Date.now()), count: 0 };
  if (!p.gear) p.gear = [];
  if (!p.descent) p.descent = { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 };
  game.ensureMods(p);
  return p;
}
// Item counts as a plain object, for the surfaces that just need numbers.
function itemCounts(p) {
  const out = {};
  for (const itemId of Object.keys(game.ITEMS)) out[itemId] = game.itemCount(p, itemId);
  return out;
}
function identity(req, res) {
  const c = cookies(req);
  if (c.ta_sess && state.sessions[c.ta_sess] && state.players[state.sessions[c.ta_sess]]) {
    return ensurePlayer(state.players[state.sessions[c.ta_sess]]);
  }
  if (c.ta_gid && state.players[c.ta_gid] && !state.players[c.ta_gid].email) {
    return ensurePlayer(state.players[c.ta_gid]);
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

// ---------- deck auth (Super Deck) ----------
// Three ways in, in order: the ADMIN_KEY (break-glass, always works), the
// owner's Gatekeeper Member Key — checked against the scrypt hash stored by
// the one-time tie, never against a stored value — and a deck session cookie
// minted at member-key sign-in so the key itself is never echoed into a page.
function deckAuth(req, formKey) {
  if (formKey && formKey === ADMIN_KEY) return 'admin';
  if (formKey && state.deck && state.deck.memberTieHash && checkPass(formKey, state.deck.memberTieHash)) return 'member';
  const c = cookies(req);
  if (c.ta_deck && state.deckSessions && state.deckSessions[c.ta_deck]) return state.deckSessions[c.ta_deck];
  return null;
}
function deckBack(res, formKey, extra) {
  const q = extra || '';
  if (formKey && formKey === ADMIN_KEY) return redirect(res, '/deck?key=' + encodeURIComponent(ADMIN_KEY) + (q ? '&' + q : ''));
  return redirect(res, '/deck' + (q ? '?' + q : ''));
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

// ---------- THE DESCENT: run machinery -------------------------------------
function mostUsedTool(tallies) {
  let top = null, best = 0;
  for (const id of game.TOOL_IDS) { const n = (tallies && tallies[id]) || 0; if (n > best) { best = n; top = id; } }
  return top;
}
function dropSummaries(pieces) {
  return (pieces || []).map(p => ({
    id: p.id, name: p.name, tier: p.tier, slot: p.slot, serial: p.serial || null,
    unique: p.unique || null, affixes: (p.affixes || []).map(a => a.label)
  }));
}
function refundRunGear(me, run) {
  if (run.heartSerial != null && !run.heartUsed) game.refundItem(me, 'secondheart', run.heartSerial);
  if (run.bellSerial != null && !run.bellRung) game.refundItem(me, 'stillbell', run.bellSerial);
}
// Deal the next depth of a run: seeded schedule, boss rules, carried
// integrity/trace dealt into the combat block, the Captor's seizure dealt
// into the stats where the referee can enforce it.
function dealDescentDepth(me, run) {
  const depth = run.depth + 1;
  run.depth = depth;
  run.awaitingChoice = false;
  const params = game.descentDepthParams(depth);
  const kind = params.kind;
  const boss = game.bossForDepth(depth);
  const depthSeed = (run.seed ^ Math.imul(depth, 2654435761)) >>> 0;
  let seized = null;
  if (boss && boss.id === 'captor') {
    const tool = mostUsedTool(run.toolUseRun) || mostUsedTool(me.toolUse) || 'flood';
    run.seizedTool = tool;
    seized = { tool, at: Math.round(params.roundMs * 0.4) };
  }
  const stats = game.effectiveStats(state, me, me.twinArmor || {}, {
    gateHp: params.gateHp, roundMs: params.roundMs,
    twinTool: run.twinTool, seized,
    buildFam: game.descentBuildFam(me, depth)
  });
  stats.combat.startIntegrity = run.integrity;
  stats.combat.startTrace = run.trace;
  // THE ACCOUNTANT: double-strength counters — his glances scramble the
  // career tool for twice as long, dealt into the combat block.
  if (boss && boss.id === 'accountant') stats.combat.scrambleMs = game.STRIKE.scrambleMs * 2;
  // GODFORGED, dealt like everything else: the run's declared treasure rides
  // the fight as a snapshot the referee enforces.
  let godSnap = null;
  if (run.godPower) {
    godSnap = { power: run.godPower, mercyUsed: !!run.mercyUsed, dawnUsed: !!run.dawnUsed };
    if (run.godPower === 'openbook') {
      // THE OPEN BOOK: every telegraph stands open — parry windows run wide.
      stats.combat.windupMs += 600;
    }
    if (run.godPower === 'unreadstrike') {
      // THE UNREAD STRIKE: the tool this run leans on cannot be scrambled,
      // and (at settle) its strikes teach the Twin nothing.
      const unreadTool = mostUsedTool(run.toolUseRun) || mostUsedTool(me.toolUse) || 'flood';
      run.godUnreadTool = unreadTool;
      if (stats.tools[unreadTool]) stats.tools[unreadTool].silent = true;
      stats.godUnread = unreadTool;
      godSnap.unreadTool = unreadTool;
    }
  }
  const strikes = game.makeDescentStrikes(depthSeed, depth, params.roundMs, {
    careerTool: mostUsedTool(me.toolUse), careerTallies: me.toolUse || {}
  });
  const fight = {
    id: rid(10), playerId: me.id, mode: 'descent', runId: run.id,
    depth, kind, bossId: boss ? boss.id : null,
    heart: run.heartSerial != null && !run.heartUsed,
    bell: run.bellSerial != null && !run.bellRung,
    god: godSnap,
    gearSerials: null, // run-scoped: settled at the run's end, never per depth
    stats, seed: depthSeed, strikes, startedAt: Date.now(),
    storm: false, pointsMult: 1, floodgates: !!state.config.floodgates
  };
  activeFights.set(fight.id, fight);
  return {
    fightId: fight.id, stats, strikes, mode: 'descent',
    descent: {
      runId: run.id, depth, kind,
      boss: boss ? { id: boss.id, name: boss.title, line: boss.line } : null,
      score: run.score, haulCount: run.haul.length,
      integrity: run.integrity, trace: run.trace,
      twinTool: run.twinTool, seizedTool: seized ? seized.tool : null,
      heart: fight.heart, bell: fight.bell,
      god: run.godPower ? { power: run.godPower, name: game.GODFORGED[run.godPower].name, unreadTool: run.godUnreadTool || null, mercyUsed: !!run.mercyUsed, dawnUsed: !!run.dawnUsed } : null
    }
  };
}
// Settle one depth of a run (called from /api/fight/finish). Drops roll from
// the run seed and the depth — reproducible, referee-verifiable, unforgeable.
function finishDescentDepth(res, me, fight, sim, problem, actions, claimedDuration) {
  const run = activeRuns.get(fight.runId);
  const depth = fight.depth, kind = fight.kind;
  if (problem || !run) {
    // A forged depth voids the whole run: the haul was never real, declared
    // pieces that never fired come home, and the books record the void.
    if (run) { refundRunGear(me, run); activeRuns.delete(run.id); }
    const v = {
      id: fight.id, fighterId: me.id, fighterName: me.displayName || 'A fighter',
      mode: 'descent', challengeOwnerId: null, result: 'lose', endReason: 'void',
      secs: Math.round(claimedDuration / 1000), points: 0, xp: 0, emberBonus: false,
      level: game.levelForXp(me.xp || 0), levelUp: false,
      shapesTaught: [], shapesTaughtCount: 0, newToWorldCount: 0, armorGains: {},
      fightStats: null, at: Date.now(), voided: problem || 'run lost'
    };
    state.verdicts[fight.id] = v;
    state.fights.unshift({ id: fight.id, name: v.fighterName, result: 'lose', how: 'void', secs: v.secs, shapes: 0, mode: 'descent', at: v.at });
    state.fights = state.fights.slice(0, 60);
    store.save(true);
    return sendJson(res, { verdict: v, voided: v.voided, descent: { over: true } });
  }
  const settledActions = sim.outcome ? actions.filter(a => a && a.t <= sim.outcome.at + 250) : actions;
  // THE UNREAD STRIKE (GODFORGED): the declared tool's strikes teach the
  // Twin nothing this depth — the lesson is filtered before it is learned.
  const teachActions = (run.godPower === 'unreadstrike' && run.godUnreadTool)
    ? settledActions.filter(a => a.tool !== run.godUnreadTool) : settledActions;
  // The Twin keeps the lesson of every depth, exactly like a house fight.
  game.teachFromActions(state, me, teachActions);
  if (sim.parries) me.parriesTotal = (me.parriesTotal || 0) + sim.parries;
  for (const a of settledActions) {
    if (a.tool !== 'parry' && a.tool !== 'bell' && a.tool !== 'mercy' && !String(a.tool || '').startsWith('ability:')) {
      run.toolUseRun[a.tool] = (run.toolUseRun[a.tool] || 0) + 1;
    }
  }
  if (sim.heartUsed) run.heartUsed = true;
  if (sim.bellRung) run.bellRung = true;
  // GODFORGED charges are spent only when a power FIRES — never for riding
  // along. Passive powers (Unread Strike, Open Book) fire by standing open
  // for the run: their charge is spent at the run's first settled depth.
  if (run.godPieceId && !run.godFired) {
    let firedHow = null;
    if (sim.mercyUsed && run.godPower === 'keepersmercy') firedHow = 'mercy at depth ' + depth;
    else if (sim.dawnUsed && run.godPower === 'seconddawn') firedHow = 'the dawn at depth ' + depth;
    else if ((run.godPower === 'unreadstrike' || run.godPower === 'openbook') && !run.godSettles) firedHow = run.godPower + ' stood open';
    if (firedHow) {
      if (game.spendGodCharge(me, run.godPieceId, firedHow)) run.godFired = true;
    }
  }
  if (sim.mercyUsed) run.mercyUsed = true;
  if (sim.dawnUsed) run.dawnUsed = true;
  run.godSettles = (run.godSettles || 0) + 1;
  let cleared = false, died = false, turned = false;
  if (sim.outcome && sim.outcome.result === 'win') cleared = true;
  else if (sim.outcome && sim.outcome.result === 'lose') died = true;
  else turned = true; // the clock ran out
  if (kind === 'vault' && !died) { cleared = true; turned = false; } // the Vault's timer IS its ending
  // ---- drops, rolled from the run seed ^ the depth — the dealt truth
  const drops = [];
  let vaultCracks = 0;
  const drng = game.rng32((run.seed ^ Math.imul(depth, 40503)) >>> 0);
  if (kind === 'vault') {
    const shapeCount = 14;
    const cracks = Math.round((sim.damagePct / 100) * shapeCount);
    vaultCracks = cracks;
    run.score += cracks * 15;
    for (let i = 0; i < cracks; i++) {
      if (drng() < 0.30) {
        const piece = game.rollGearPiece(state, drng, { tier: game.rollTier(drng, game.DROP_TABLES.vault) });
        run.haul.push(piece); drops.push(piece);
      }
    }
  } else if (cleared) {
    run.score += 100 + depth * 10;
    if (kind === 'boss') {
      run.score += 150;
      // GODFORGED: bosses at Depth 9 and deeper only, at a few percent —
      // or it isn't one. The chance is dealt here, from the same seeded rng
      // as every other drop, and the books count every piece that exists.
      if (depth >= 9 && drng() < game.godforgedChance(depth)) {
        const piece = game.rollGodforged(state, drng);
        run.haul.push(piece); drops.push(piece);
      } else {
        const tier = drng() < game.bossLegendaryChance(depth) ? 'LEGENDARY' : 'EPIC';
        const piece = game.rollGearPiece(state, drng, { tier });
        run.haul.push(piece); drops.push(piece);
      }
      if (drng() < 0.5) {
        const p2 = game.rollGearPiece(state, drng, { tier: game.rollTier(drng, game.DROP_TABLES.elite) });
        run.haul.push(p2); drops.push(p2);
      }
    } else if (drng() < (kind === 'elite' ? 0.75 : 0.40)) {
      const piece = game.rollGearPiece(state, drng, { tier: game.rollTier(drng, game.DROP_TABLES[kind === 'elite' ? 'elite' : 'shape']) });
      run.haul.push(piece); drops.push(piece);
    }
  }
  // MODS v1: rolled AFTER the gear from the same seeded rng (the gear books
  // never shift), and granted on the spot — mods ride no haul, are banked
  // the moment they fall, and death in the dark cannot take them.
  const modDrops = [];
  if (kind === 'vault') {
    if (vaultCracks > 0) modDrops.push(...game.rollDescentMods(drng, me, 'vault'));
  } else if (cleared) {
    modDrops.push(...game.rollDescentMods(drng, me, kind));
  }
  // THE DOUBLE HARVEST (GODFORGED): the first depth of the run that drops
  // loot drops it twice over — every piece rolled is rolled again, same tier.
  if (run.godPower === 'doubleharvest' && !run.godFired && drops.length) {
    const extra = [];
    for (const p of drops.slice()) {
      extra.push(p.tier === 'GODFORGED' ? game.rollGodforged(state, drng)
        : game.rollGearPiece(state, drng, { tier: p.tier }));
    }
    for (const p of extra) { run.haul.push(p); drops.push(p); }
    if (game.spendGodCharge(me, run.godPieceId, 'the harvest at depth ' + depth)) run.godFired = true;
  }
  // ---- the Captor's bargain resolves with his depth
  let captor = null;
  if (fight.bossId === 'captor' && run.seizedTool) {
    if (cleared) { run.twinTool = run.seizedTool; captor = 'twinned'; }
    else captor = 'lost';
    if (cleared) run.seizedTool = null;
  }
  run.integrity = died ? 0 : sim.integrityLeft;
  run.trace = sim.trace;
  run.deepest = Math.max(run.deepest || 0, depth);
  if (cleared) {
    run.depthsCleared += 1;
    run.xp += kind === 'boss' ? game.DESCENT_XP.perDepth + game.DESCENT_XP.boss
      : kind === 'vault' ? game.DESCENT_XP.vault : game.DESCENT_XP.perDepth;
    if (kind === 'boss') run.bossesSlain += 1;
  }
  // ---- a boss kill banks the haul on the spot
  let bankedNow = [];
  if (cleared && kind === 'boss' && run.haul.length) {
    bankedNow = run.haul.splice(0, run.haul.length);
    game.bankHaul(me, bankedNow);
    run.bankedValue = (run.bankedValue || 0) + game.haulValue(bankedNow);
    for (const pc of bankedNow) {
      if (pc.tier === 'LEGENDARY') state.descent.legendaries += 1;
      if (pc.tier === 'GODFORGED') state.descent.godforged = (state.descent.godforged || 0) + 1;
    }
  }
  const depthReport = {
    depth, kind, cleared, died, drops: dropSummaries(drops),
    mods: modDrops.map(md => ({
      id: md.id, kind: md.kind, name: game.MODS_ALL[md.id].name,
      tool: game.FITTED_MODS[md.id] ? game.FITTED_MODS[md.id].tool : null
    })),
    bankedNow: dropSummaries(bankedNow), captor,
    score: run.score, haulCount: run.haul.length,
    integrity: run.integrity, trace: run.trace, twinTool: run.twinTool
  };
  if (died || turned) {
    refundRunGear(me, run);
    const verdict = game.finishDescentRun(state, me, run, died ? 'death' : 'turned');
    verdict.heartBroke = !!run.heartUsed;
    verdict.bellRung = !!run.bellRung;
    activeRuns.delete(run.id);
    store.save(true);
    return sendJson(res, { verdict, descent: Object.assign({ over: true }, depthReport) });
  }
  run.awaitingChoice = true;
  store.save(true);
  return sendJson(res, { descent: Object.assign({ over: false, state: 'gate' }, depthReport) });
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
    let pit = null;
    const pitId = url.searchParams.get('pit');
    if (pitId) {
      const owner = ensurePlayer(state.players[pitId]);
      if (owner && owner.email) {
        const traits = game.devilTraits(owner);
        pit = {
          ownerId: owner.id, ownerName: owner.displayName || 'A fighter',
          traits, bounty: game.bountyNow(owner, Date.now()),
          myItems: itemCounts(me), myStock: me.itemStock || { mirrorwrap: [], anchorstitch: [] }
        };
      }
    }
    return sendHtml(res, views.arenaPage(state, me, challenge, pit));
  }
  if (method === 'GET' && p === '/pit') {
    const sort = ['bounty', 'record', 'grudge'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'bounty';
    return sendHtml(res, views.pitPage(state, me, sort));
  }
  if (method === 'GET' && p === '/descent') {
    return sendHtml(res, views.descentPage(state, me));
  }
  if (method === 'GET' && p === '/login') return sendHtml(res, views.authPage(state, me, 'login'));
  if (method === 'GET' && p === '/signup') return sendHtml(res, views.authPage(state, me, 'signup'));
  if (method === 'GET' && p === '/profile') {
    if (!me.email) return sendHtml(res, views.authPage(state, me, 'signup'));
    return sendHtml(res, views.profilePage(state, me, { tauntError: url.searchParams.get('taunt') === 'bad' }));
  }
  if (method === 'GET' && p === '/web') {
    return sendHtml(res, views.webPage(state, me));
  }
  if (method === 'GET' && p.startsWith('/fighter/')) {
    const f = ensurePlayer(state.players[p.slice('/fighter/'.length)]);
    if (!f || !f.email) return sendHtml(res, views.shell('Not found', '<section class="authbox"><h1>No such fighter</h1></section>', me), 404);
    return sendHtml(res, views.fighterPage(state, f, me));
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
    const keyParam = url.searchParams.get('key');
    let auth = null, viaKey = '';
    if (keyParam) {
      if (keyParam === ADMIN_KEY) { auth = 'admin'; viaKey = ADMIN_KEY; }
      else if (state.deck.memberTieHash && checkPass(keyParam, state.deck.memberTieHash)) {
        // Member-key sign-in: mint a deck session so the key is never
        // echoed back into the deck's own pages or forms.
        const tok = rid(24);
        state.deckSessions[tok] = 'member';
        setCookie(res, 'ta_deck', tok, 30);
        store.save(true);
        return redirect(res, '/deck');
      }
    } else {
      auth = deckAuth(req, null);
    }
    if (!auth) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Arena Deck</h1><form class="authform" method="get" action="/deck"><label>Deck key — or your Gatekeeper Member Key<input name="key" type="password"></label><button class="fightbtn" type="submit">Enter</button></form></section>', null), 403);
    return sendHtml(res, views.deckPage(state, {
      key: viaKey, admin: auth === 'admin',
      saved: url.searchParams.get('saved') === '1',
      error: url.searchParams.get('error') || null,
      notice: url.searchParams.get('notice') || null
    }));
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
    // THE FOUNDER'S EMBER: claiming a profile is the grant moment — the
    // first 100 claimed members, in order, then the mint closes forever.
    // Synchronous between the email check and the save: no two claims can
    // take the same number, and re-login never re-grants.
    game.grantFounderEmber(state, ensurePlayer(rec));
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
  // CORS: this endpoint is public by design (meter, leaders, rail, weather) —
  // Steven's Arena Space reads it live from another origin. Public data only;
  // no other route gets a CORS header.
  if (method === 'OPTIONS' && p === '/api/public/state') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }
  if (method === 'GET' && p === '/api/public/state') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const leaders = Object.values(state.players)
      .filter(x => x.email && x.publicProfile !== false && x.record.bouts > 0)
      .sort((a, b) => (b.record.breaches - a.record.breaches) || (b.points - a.points)).slice(0, 8)
      .map(x => ({ id: x.id, name: x.displayName, photo: x.photo, breaches: x.record.breaches, points: x.points, level: game.levelForXp(x.xp || 0) }));
    // THE PIT's boards: devils that hold, devils worth hunting, hunters.
    const members = Object.values(state.players).map(ensurePlayer).filter(x => x.email);
    const pitTop = {
      holds: members.filter(x => x.devil.held > 0).sort((a, b) => b.devil.held - a.devil.held).slice(0, 5)
        .map(x => ({ id: x.id, name: x.displayName, holds: x.devil.held })),
      bounties: members.slice().sort((a, b) => game.bountyNow(b, Date.now()) - game.bountyNow(a, Date.now())).slice(0, 5)
        .map(x => ({ id: x.id, name: x.displayName, bounty: game.bountyNow(x, Date.now()) })),
      hunters: members.filter(x => x.pitAttack.breaches > 0).sort((a, b) => b.pitAttack.breaches - a.pitAttack.breaches).slice(0, 5)
        .map(x => ({ id: x.id, name: x.displayName, breaches: x.pitAttack.breaches }))
    };
    // THE DESCENT's boards: deepest delves, richest runs, fattest hauls.
    const drec = x => x.descent || { deepest: 0, bestScore: 0, bestHaul: 0 };
    const descentBoards = {
      tallies: state.descent || { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, depthsCleared: 0 },
      deepest: members.filter(x => drec(x).deepest > 0).sort((a, b) => drec(b).deepest - drec(a).deepest).slice(0, 5)
        .map(x => ({ id: x.id, name: x.displayName, deepest: drec(x).deepest })),
      scores: members.filter(x => drec(x).bestScore > 0).sort((a, b) => drec(b).bestScore - drec(a).bestScore).slice(0, 5)
        .map(x => ({ id: x.id, name: x.displayName, score: drec(x).bestScore })),
      hauls: members.filter(x => drec(x).bestHaul > 0).sort((a, b) => drec(b).bestHaul - drec(a).bestHaul).slice(0, 5)
        .map(x => ({ id: x.id, name: x.displayName, haul: drec(x).bestHaul }))
    };
    const storm = game.stormActive(state);
    const bc = state.config.broadcast;
    const broadcast = bc && bc.text && (!bc.expiresAt || Date.now() < bc.expiresAt) ? bc.text : null;
    let spotlight = null;
    if (state.config.spotlight) {
      const owner = Object.values(state.players).find(x => x.challengeToken === state.config.spotlight);
      if (owner) spotlight = { token: owner.challengeToken, name: owner.displayName || 'A fighter', photo: owner.photo, breaches: owner.record.breaches, bouts: owner.record.bouts };
    }
    return sendJson(res, {
      meter: game.educationMeter(state), fights: state.fights.slice(0, 10), leaders, frozen: state.config.frozen,
      storm: { active: storm, until: storm ? state.config.stormUntil : 0, secsLeft: storm ? Math.max(0, Math.round((state.config.stormUntil - Date.now()) / 1000)) : 0 },
      broadcast, floodgates: !!state.config.floodgates, spotlight,
      pit: { tallies: state.pit || { bouts: 0, holds: 0, breaches: 0 }, holds: pitTop.holds, bounties: pitTop.bounties, hunters: pitTop.hunters },
      descent: descentBoards,
      founders: { claimed: (state.itemsSeq && state.itemsSeq.foundersember) || 0, cap: game.FOUNDER_CAP }
    });
  }
  if (method === 'GET' && p === '/api/me') {
    const cls = game.classOf(me);
    return sendJson(res, {
      id: me.id, claimed: !!me.email, name: me.displayName, photo: me.photo,
      points: me.points, nodes: Object.keys(me.nodes || {}),
      record: me.record, challengeToken: me.challengeToken,
      xp: me.xp || 0, level: cls.level, className: cls.name, classIdx: cls.idx,
      items: itemCounts(me), itemStock: me.itemStock || { mirrorwrap: [], anchorstitch: [] },
      gear: me.gear || [], wornGear: game.gearSummary(game.wornGearMap(me)),
      mods: game.modSummary(me),
      descent: me.descent || { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 },
      pitAttack: me.pitAttack || { bouts: 0, breaches: 0 },
      devil: me.devil ? { held: me.devil.held, breached: me.devil.breached, bounty: game.bountyNow(me, Date.now()) } : null
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
    store.saveUpload(fname, file.data);
    me.photo = '/uploads/' + fname;
    store.save(true);
    return redirect(res, '/profile');
  }

  // ---- the devil's taunt (owner-written, exact-text, light hygiene only)
  if (method === 'POST' && p === '/api/profile/taunt') {
    if (!me.email) return redirect(res, '/signup');
    const f = await bodyForm(req);
    const raw = String(f.taunt || '').replace(/[<>]/g, '').trim().slice(0, 90);
    const PROFANE = ['fuck', 'shit', 'bitch', 'nigger', 'faggot', 'cunt', 'whore', 'rape'];
    if (PROFANE.some(w => raw.toLowerCase().includes(w))) return redirect(res, '/profile?taunt=bad');
    me.taunt = raw;
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
    const seed = crypto.randomInt(1, 2147483647);
    const storm = game.stormActive(state);
    // Declared consumables that ride ANY fight (house or Pit): the Second
    // Heart (breaks at the first zeroing blow) and the Stillbell (rung from
    // the deck). Validated against the satchel here; spent per-branch below
    // once the bout itself is admitted; unspent pieces return after settle.
    const wantHeart = !!f.heart, wantBell = !!f.bell;
    if (wantHeart && game.itemCount(me, 'secondheart') < 1) return sendJson(res, { error: 'item', message: 'You hold no Second Heart.' }, 400);
    if (wantBell && game.itemCount(me, 'stillbell') < 1) return sendJson(res, { error: 'item', message: 'You hold no Stillbell.' }, 400);

    // ---- THE PIT: a member challenges another member's devil -------------
    if (f.pit) {
      if (!me.email) return sendJson(res, { error: 'members-only', message: 'The Pit is members-only. Claim a profile to fight devils.' }, 403);
      const devilOwner = ensurePlayer(state.players[String(f.pit)]);
      if (!devilOwner || !devilOwner.email) return sendJson(res, { error: 'devil not found' }, 404);
      if (devilOwner.id === me.id) return sendJson(res, { error: 'own devil', message: 'Your own devil will not fight you. It knows you too well.' }, 400);
      const myClass = game.classOf(me), devilClass = game.classOf(devilOwner);
      const classDelta = devilClass.idx - myClass.idx;
      if (classDelta < 0) return sendJson(res, { error: 'class', message: `That devil is ${devilClass.name} — below your ${myClass.name} class. The Pit does not feed the small to the large.` }, 403);
      if (classDelta > 1) return sendJson(res, { error: 'class', message: `That devil is ${devilClass.name} — two or more classes above your ${myClass.name}. Climb first.` }, 403);
      // Anti-farm: attempts are consumed at the door, win, lose or void.
      const akey = devilOwner.id + ':' + game.dayKey(Date.now());
      me.pitAttempts = me.pitAttempts || {};
      const used = me.pitAttempts[akey] || 0;
      if (used >= game.PIT.attemptCap) return sendJson(res, { error: 'cap', message: `You have had your ${game.PIT.attemptCap} tries at this devil today. It needs its sleep too.` }, 429);
      // Bonus items: declared at the door, validated against the satchel,
      // spent on entry, refunded if the bout is voided.
      const wantWrap = !!f.mirrorwrap;
      const stitchTool = f.stitch && game.TOOL_IDS.includes(String(f.stitch)) ? String(f.stitch) : null;
      const traits = game.devilTraits(devilOwner);
      if (wantWrap && !traits.mirage) return sendJson(res, { error: 'item', message: 'The Mirror Wrap only speaks to a MIRAGE-marked devil.' }, 400);
      if (wantWrap && game.itemCount(me, 'mirrorwrap') < 1) return sendJson(res, { error: 'item', message: 'You hold no Mirror Wrap.' }, 400);
      if (stitchTool && !traits.armor) return sendJson(res, { error: 'item', message: 'An Anchor Stitch only matters against MORPH ARMOR.' }, 400);
      if (stitchTool && game.itemCount(me, 'anchorstitch') < 1) return sendJson(res, { error: 'item', message: 'You hold no Anchor Stitch.' }, 400);
      // Spend the actual numbered pieces; their serials ride the fight so a
      // void can hand back the very same editions.
      const spentSerials = { mirrorwrap: null, anchorstitch: null };
      if (wantWrap) spentSerials.mirrorwrap = game.spendItem(me, 'mirrorwrap', devilOwner.displayName || 'a devil');
      if (stitchTool) spentSerials.anchorstitch = game.spendItem(me, 'anchorstitch', devilOwner.displayName || 'a devil');
      const gearSerials = { secondheart: null, stillbell: null };
      if (wantHeart) gearSerials.secondheart = game.spendItem(me, 'secondheart', devilOwner.displayName || 'a devil');
      if (wantBell) gearSerials.stillbell = game.spendItem(me, 'stillbell', devilOwner.displayName || 'a devil');
      me.pitAttempts[akey] = used + 1;
      // The devil's familiarity is its memory of challengers' shapes; its
      // armor is its owner's grudge plating; its guard stretches scrambles.
      const stats = game.effectiveStats(state, me, devilOwner.twinArmor || {}, {
        famShapes: devilOwner.devilShapes || {},
        morph: traits.armor, stitchTool
      });
      const built = game.makeDevilStrikes(seed, stats.roundMs, devilOwner, game.effectiveAggression(state), traits);
      stats.combat.scrambleMs = Math.round(game.STRIKE.scrambleMs * (1 + built.style.guard));
      const bounty = game.bountyNow(devilOwner, Date.now());
      const fight = {
        id: rid(10), playerId: me.id, mode: 'pit',
        devilOwnerId: devilOwner.id, pitTraits: traits, pitClassDelta: classDelta,
        pitBounty: bounty, pitItems: { mirrorwrap: wantWrap, stitch: stitchTool, serials: spentSerials },
        heart: wantHeart, bell: wantBell, gearSerials,
        stats, seed, strikes: built.strikes, postMorph: built.postMorph, startedAt: Date.now(),
        storm, pointsMult: 1, floodgates: !!state.config.floodgates
      };
      activeFights.set(fight.id, fight);
      store.save(true);
      // The Mirror Wrap's reveal rides the RESPONSE only: feints are flagged
      // for a wrapped challenger; the stored schedule keeps its secret.
      const dealtStrikes = built.strikes.map(s => (wantWrap && s.kind === 'feint') ? { ...s, revealed: true } : s);
      return sendJson(res, {
        fightId: fight.id, stats, strikes: dealtStrikes, postMorph: built.postMorph, mode: 'pit',
        ownerName: devilOwner.displayName || 'A fighter',
        pit: { traits, bounty, classDelta, wrapped: wantWrap, stitch: stitchTool, devilClass: devilClass.name },
        gear: { heart: wantHeart, bell: wantBell },
        storm, floodgates: fight.floodgates
      });
    }

    const armorMap = mode === 'challenge' ? (owner.twinArmor || {}) : (me.twinArmor || {});
    const stats = game.effectiveStats(state, me, armorMap);
    // The weather is snapshotted at the door: storm aggression deals the
    // strike schedule, the points multiplier rides the fight into the
    // referee, and floodgates are already baked into the stats' trace costs.
    const strikes = game.makeStrikes(seed, stats.roundMs, game.effectiveAggression(state));
    const gearSerials = { secondheart: null, stillbell: null };
    if (wantHeart) gearSerials.secondheart = game.spendItem(me, 'secondheart', 'the house Twin');
    if (wantBell) gearSerials.stillbell = game.spendItem(me, 'stillbell', 'the house Twin');
    const fight = {
      id: rid(10), playerId: me.id, mode,
      challengeOwnerId: owner ? owner.id : null,
      heart: wantHeart, bell: wantBell, gearSerials,
      stats, seed, strikes, startedAt: Date.now(),
      storm, pointsMult: storm ? game.STORM.pointsMult : 1,
      floodgates: !!state.config.floodgates
    };
    activeFights.set(fight.id, fight);
    return sendJson(res, {
      fightId: fight.id, stats, strikes, mode, ownerName: owner ? (owner.displayName || 'A fighter') : null,
      gear: { heart: wantHeart, bell: wantBell },
      storm, floodgates: fight.floodgates
    });
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
    // THE DESCENT settles depth by depth through its own director (drops,
    // banking, the Captor's bargain, god-tier charges) — same referee above.
    if (fight.mode === 'descent') {
      return finishDescentDepth(res, me, fight, sim, problem, actions, claimedDuration);
    }
    if (problem) {
      // A voided Pit bout refunds its declared items — the fight, honestly,
      // never happened. (The daily attempt stays spent: the door was used.)
      if (fight.mode === 'pit' && fight.pitItems && fight.pitItems.serials) {
        game.refundItem(me, 'mirrorwrap', fight.pitItems.serials.mirrorwrap);
        game.refundItem(me, 'anchorstitch', fight.pitItems.serials.anchorstitch);
      }
      if (fight.gearSerials) {
        game.refundItem(me, 'secondheart', fight.gearSerials.secondheart);
        game.refundItem(me, 'stillbell', fight.gearSerials.stillbell);
      }
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
    const fightStats = {
      integrityLeft: sim.integrityLeft, tracePeak: sim.tracePeak,
      parries: sim.parries, strikesTaken: sim.strikesTaken,
      vulnBonus: sim.vulnBonus, damageDealt: sim.dmgTotal,
      combos: sim.combos, abilitiesUsed: sim.abilitiesUsed, modsUsed: sim.modsUsed,
      parryWhiffs: sim.parryWhiffs, morphed: sim.morphed
    };
    // Declared gear settles honestly: a Heart that never broke and a Bell
    // that never rang go back to the satchel — the very same editions.
    if (fight.gearSerials) {
      if (!sim.heartUsed) game.refundItem(me, 'secondheart', fight.gearSerials.secondheart);
      if (!sim.bellRung) game.refundItem(me, 'stillbell', fight.gearSerials.stillbell);
    }
    if (fight.mode === 'pit') {
      const devilOwner = ensurePlayer(state.players[fight.devilOwnerId]);
      const verdict = game.settlePitFight(state, me, devilOwner, fight, {
        actions: settledActions,
        result: resolved.result, endReason: resolved.endReason,
        durationMs: resolved.durationMs, fightStats
      }, sim);
      verdict.heartBroke = !!sim.heartUsed;
      verdict.bellRung = !!sim.bellRung;
      store.save(true);
      return sendJson(res, { verdict });
    }
    const verdict = game.settleFight(state, me, fight, {
      actions: settledActions,
      result: resolved.result, endReason: resolved.endReason,
      durationMs: resolved.durationMs, damagePct: sim.damagePct,
      fightStats
    });
    verdict.heartBroke = !!sim.heartUsed;
    verdict.bellRung = !!sim.bellRung;
    store.save(true);
    return sendJson(res, { verdict });
  }

  // ---- THE DESCENT: runs ---------------------------------------------------
  if (method === 'POST' && p === '/api/descent/start') {
    if (state.config.frozen) return sendJson(res, { error: 'frozen', message: 'The arena is frozen.' }, 423);
    if (!me.email) return sendJson(res, { error: 'members-only', message: 'The Descent is members-only. Claim a profile to delve.' }, 403);
    const f = await bodyJson(req).catch(() => ({}));
    for (const r of activeRuns.values()) {
      if (r.playerId === me.id) return sendJson(res, { error: 'already descending', message: 'You are already down there. Finish or abandon that run first.' }, 409);
    }
    const wantHeart = !!f.heart, wantBell = !!f.bell;
    if (wantHeart && game.itemCount(me, 'secondheart') < 1) return sendJson(res, { error: 'item', message: 'You hold no Second Heart.' }, 400);
    if (wantBell && game.itemCount(me, 'stillbell') < 1) return sendJson(res, { error: 'item', message: 'You hold no Stillbell.' }, 400);
    // GODFORGED declaration: one treasure per run, from the satchel, with
    // charges left to spend. A retired or borrowed number is refused here.
    let godPiece = null;
    if (f.god) {
      godPiece = (me.gear || []).find(g => g.id === String(f.god));
      if (!godPiece || godPiece.tier !== 'GODFORGED') return sendJson(res, { error: 'item', message: 'That is not a GODFORGED treasure in your satchel.' }, 400);
      if (godPiece.retired || !(godPiece.charges > 0)) return sendJson(res, { error: 'item', message: godPiece.name + ' is spent out — its number is retired.' }, 400);
    }
    const run = {
      id: rid(10), playerId: me.id, seed: crypto.randomInt(1, 2147483647),
      depth: 0, depthsCleared: 0, deepest: 0, score: 0, xp: 0,
      haul: [], bankedValue: 0, bossesSlain: 0,
      integrity: 100, trace: 0, toolUseRun: {}, twinTool: null, seizedTool: null,
      heartSerial: null, bellSerial: null, heartUsed: false, bellRung: false,
      godPieceId: godPiece ? godPiece.id : null, godPower: godPiece ? godPiece.god : null,
      godFired: false, godSettles: 0, mercyUsed: false, dawnUsed: false, godUnreadTool: null,
      awaitingChoice: false, over: false, startedAt: Date.now()
    };
    if (wantHeart) run.heartSerial = game.spendItem(me, 'secondheart', 'the Descent');
    if (wantBell) run.bellSerial = game.spendItem(me, 'stillbell', 'the Descent');
    const base = game.effectiveStats(state, me, me.twinArmor || {});
    run.integrity = base.combat.playerHp;
    activeRuns.set(run.id, run);
    const payload = dealDescentDepth(me, run);
    store.save(true);
    return sendJson(res, payload);
  }
  if (method === 'POST' && p === '/api/descent/choose') {
    const f = await bodyJson(req).catch(() => ({}));
    const run = activeRuns.get(String(f.runId || ''));
    if (!run || run.playerId !== me.id) return sendJson(res, { error: 'run not found or not yours' }, 404);
    if (!run.awaitingChoice) return sendJson(res, { error: 'no gate stands open' }, 409);
    if (f.choice === 'ascend') {
      refundRunGear(me, run);
      const verdict = game.finishDescentRun(state, me, run, 'ascend');
      verdict.heartBroke = !!run.heartUsed;
      verdict.bellRung = !!run.bellRung;
      activeRuns.delete(run.id);
      store.save(true);
      return sendJson(res, { verdict, descent: { over: true } });
    }
    if (f.choice === 'descend') {
      const payload = dealDescentDepth(me, run);
      store.save(true);
      return sendJson(res, payload);
    }
    return sendJson(res, { error: 'choose descend or ascend' }, 400);
  }
  if (method === 'POST' && p === '/api/descent/abandon') {
    const f = await bodyJson(req).catch(() => ({}));
    const run = activeRuns.get(String(f.runId || ''));
    if (!run || run.playerId !== me.id) return sendJson(res, { error: 'run not found or not yours' }, 404);
    for (const [fid, ft] of activeFights) if (ft.runId === run.id) activeFights.delete(fid);
    refundRunGear(me, run);
    const verdict = game.finishDescentRun(state, me, run, 'ascend');
    verdict.heartBroke = !!run.heartUsed;
    verdict.bellRung = !!run.bellRung;
    activeRuns.delete(run.id);
    store.save(true);
    return sendJson(res, { verdict, descent: { over: true } });
  }

  // ---- the satchel's gear shelf: swapping happens between runs, never mid-delve
  if (method === 'POST' && p === '/api/gear/wear') {
    if (!me.email) return redirect(res, '/signup');
    const f = await bodyForm(req);
    for (const r of activeRuns.values()) if (r.playerId === me.id) return redirect(res, '/descent?gear=run');
    const err = game.wearGear(me, String(f.gearId || ''));
    if (err) return redirect(res, '/profile?gear=bad');
    store.save(true);
    return redirect(res, '/profile#satchel');
  }
  if (method === 'POST' && p === '/api/gear/unwear') {
    if (!me.email) return redirect(res, '/signup');
    const f = await bodyForm(req);
    for (const r of activeRuns.values()) if (r.playerId === me.id) return redirect(res, '/descent?gear=run');
    const err = game.unwearGear(me, String(f.slot || ''));
    if (err) return redirect(res, '/profile?gear=bad');
    store.save(true);
    return redirect(res, '/profile#satchel');
  }

  // ---- MODS v1: socketing happens at the satchel, between runs — the same
  // law as gear. A JSON body gets a JSON answer; the profile's forms get the
  // redirect they expect. Mid-delve, the sockets are closed like the shelf.
  if (method === 'POST' && p === '/api/mods/fit') {
    const isJson = (req.headers['content-type'] || '').includes('json');
    if (!me.email) return isJson ? sendJson(res, { error: 'members-only' }, 403) : redirect(res, '/signup');
    const f = isJson ? await bodyJson(req).catch(() => ({})) : await bodyForm(req);
    for (const r of activeRuns.values()) {
      if (r.playerId === me.id) return isJson
        ? sendJson(res, { error: 'run-active', message: 'Sockets are closed while you are down in the Descent.' }, 409)
        : redirect(res, '/descent?gear=run');
    }
    const err = game.fitMod(me, String(f.tool || ''), f.mod ? String(f.mod) : null);
    if (err) return isJson ? sendJson(res, { error: err }, 400) : redirect(res, '/profile?mods=bad');
    store.save(true);
    return isJson ? sendJson(res, { ok: true, mods: game.modSummary(me) }) : redirect(res, '/profile#mods');
  }

  // ---- deck
  if (method === 'POST' && p === '/api/deck/config') {
    const f = await bodyForm(req);
    if (!deckAuth(req, String(f.key || ''))) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Wrong key.</h1></section>', null), 403);
    const clamp = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : Math.min(2, Math.max(0.5, n)); };
    state.config.aggression = clamp(f.aggression, state.config.aggression);
    state.config.learningSpeed = clamp(f.learningSpeed, state.config.learningSpeed);
    state.config.frozen = f.frozen === 'on';
    store.save(true);
    return deckBack(res, String(f.key || ''), 'saved=1');
  }

  // SUPER DECK — STORM: fire or cancel the timed event. Points ×2 and the
  // aggression floor are applied by the referee from the fight snapshot.
  if (method === 'POST' && p === '/api/deck/storm') {
    const f = await bodyForm(req);
    if (!deckAuth(req, String(f.key || ''))) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Wrong key.</h1></section>', null), 403);
    if (f.cancel === '1') {
      state.config.stormUntil = 0;
    } else {
      const mins = parseFloat(f.minutes);
      const m = isNaN(mins) ? 30 : Math.min(240, Math.max(1, mins));
      state.config.stormUntil = Date.now() + Math.round(m * 60000);
    }
    store.save(true);
    return deckBack(res, String(f.key || ''), 'saved=1');
  }

  // SUPER DECK — THE TWIN SPEAKS: a broadcast line with an expiry
  // (minutes; blank/0 = until cleared). Plain text, capped, escaped at render.
  if (method === 'POST' && p === '/api/deck/broadcast') {
    const f = await bodyForm(req);
    if (!deckAuth(req, String(f.key || ''))) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Wrong key.</h1></section>', null), 403);
    const text = String(f.text || '').trim().slice(0, 140);
    if (f.clear === '1' || !text) {
      state.config.broadcast = null;
    } else {
      const mins = parseFloat(f.minutes);
      const expiresAt = (!mins || isNaN(mins) || mins <= 0) ? 0 : Date.now() + Math.round(Math.min(1440, mins) * 60000);
      state.config.broadcast = { text, expiresAt };
    }
    store.save(true);
    return deckBack(res, String(f.key || ''), 'saved=1');
  }

  // SUPER DECK — OPEN THE FLOODGATES: trace gains halve while on. The
  // halving is dealt into each new fight's stats (see game.effectiveStats).
  if (method === 'POST' && p === '/api/deck/floodgates') {
    const f = await bodyForm(req);
    if (!deckAuth(req, String(f.key || ''))) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Wrong key.</h1></section>', null), 403);
    state.config.floodgates = f.state === 'on';
    store.save(true);
    return deckBack(res, String(f.key || ''), 'saved=1');
  }

  // SUPER DECK — SPOTLIGHT: pin a real fighter's challenge as Tonight's
  // Devil, by fighter id or by challenge token. Anything else is refused.
  if (method === 'POST' && p === '/api/deck/spotlight') {
    const f = await bodyForm(req);
    if (!deckAuth(req, String(f.key || ''))) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Wrong key.</h1></section>', null), 403);
    if (f.clear === '1') {
      state.config.spotlight = null;
      store.save(true);
      return deckBack(res, String(f.key || ''), 'saved=1');
    }
    const pin = String(f.pin || '').trim();
    const owner = Object.values(state.players).find(x => x.id === pin || x.challengeToken === pin);
    if (!owner) return deckBack(res, String(f.key || ''), 'error=spotlight');
    state.config.spotlight = owner.challengeToken;
    store.save(true);
    return deckBack(res, String(f.key || ''), 'saved=1');
  }

  // SUPER DECK — MEMBER-KEY TIE (one-time, ADMIN_KEY only): the owner pastes
  // his Gatekeeper Member Key once; only its scrypt hash is kept. The tie
  // also binds his fighter: the house owner's profile, under his member
  // identity — created here if it does not exist, claimed if it does.
  if (method === 'POST' && p === '/api/deck/tie') {
    const f = await bodyForm(req);
    if (String(f.key || '') !== ADMIN_KEY) return sendHtml(res, views.shell('Deck', '<section class="authbox"><h1>Wrong key.</h1></section>', null), 403);
    if (state.deck.memberTieHash) return deckBack(res, ADMIN_KEY, 'error=tieexists');
    const memberKey = String(f.memberKey || '');
    if (memberKey.length < 8) return deckBack(res, ADMIN_KEY, 'error=tiekey');
    state.deck.memberTieHash = hashPass(memberKey);
    let owner = Object.values(state.players).find(x => x.email === 'stevenh18818@gmail.com');
    if (!owner) { owner = newPlayer('Steven Hall'); owner.email = 'stevenh18818@gmail.com'; }
    owner.displayName = 'Steven Hall';
    owner.isOwner = true;
    state.deck.ownerPlayerId = owner.id;
    // The owner fighter comes into being here if he did not exist: the
    // Keeper's Set (one of every item, numbered + signed) is his by right.
    game.grantKeeperSet(state, ensurePlayer(owner));
    store.save(true);
    return deckBack(res, ADMIN_KEY, 'notice=tied');
  }

  // SUPER DECK — REMOVE TIE (ADMIN_KEY only): clears the hash and every
  // member deck session. The owner fighter itself stays — it is his profile.
  if (method === 'POST' && p === '/api/deck/untie') {
    const f = await bodyForm(req);
    if (String(f.adminKey || '') !== ADMIN_KEY) return deckBack(res, String(f.key || ''), 'error=untie');
    state.deck.memberTieHash = null;
    for (const tok of Object.keys(state.deckSessions)) {
      if (state.deckSessions[tok] === 'member') delete state.deckSessions[tok];
    }
    store.save(true);
    return deckBack(res, ADMIN_KEY, 'notice=untied');
  }

  // SUPER DECK — ROSTER (ADMIN_KEY only): the member roll with satchels, so
  // the Keeper can see exactly who holds what. Read-only; JSON.
  if (method === 'GET' && p === '/api/deck/roster') {
    if (String(url.searchParams.get('key') || '') !== ADMIN_KEY) return sendJson(res, { error: 'wrong key' }, 403);
    const members = Object.values(state.players).map(ensurePlayer).filter(x => x.email)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .map(x => ({
        id: x.id, email: x.email, name: x.displayName, isOwner: !!x.isOwner,
        createdAt: x.createdAt || null, xp: x.xp || 0, level: game.levelForXp(x.xp || 0),
        points: x.points || 0, bouts: x.record ? x.record.bouts : 0, breaches: x.record ? x.record.breaches : 0,
        items: itemCounts(x),
        mods: game.modSummary(x),
        gear: (x.gear || []).map(g => ({
          id: g.id, slot: g.slot, tier: g.tier, name: g.name, worn: !!g.worn, banked: !!g.banked,
          unique: g.unique || null, serial: g.serial || null,
          affixes: (g.affixes || []).map(a => a.label)
        }))
      }));
    return sendJson(res, { members });
  }

  // SUPER DECK — GRANT GEAR (ADMIN_KEY only): the Keeper hands a fighter real
  // Descent gear, rolled by the same machinery that rolls the drops
  // (rollGearPiece + bankHaul — genuine records with affixes, never display
  // fakes). Deliberately capped at EPIC: LEGENDARY and GODFORGED are numbered
  // Keeper-signed editions and are NEVER granted here — they are earned in
  // the deep or not at all. Bonus items and Founder's Embers are likewise
  // outside this route. Wears the granted piece per slot when asked, so the
  // fighter steps into battle already kitted.
  if (method === 'POST' && p === '/api/deck/grant-gear') {
    const f = await bodyJson(req).catch(() => ({}));
    if (String(f.key || '') !== ADMIN_KEY) return sendJson(res, { error: 'wrong key' }, 403);
    const target = state.players[String(f.playerId || '')];
    if (!target || !target.email) return sendJson(res, { error: 'no such member fighter' }, 404);
    ensurePlayer(target);
    const GRANT_TIERS = ['STURDY', 'RARE', 'EPIC'];
    const spec = Array.isArray(f.pieces) ? f.pieces.slice(0, 20) : [];
    if (!spec.length) return sendJson(res, { error: 'no pieces requested' }, 400);
    for (const s of spec) {
      if (!game.GEAR_SLOTS.includes(String(s && s.slot))) return sendJson(res, { error: 'bad slot: ' + (s && s.slot) }, 400);
      if (!GRANT_TIERS.includes(String(s && s.tier))) return sendJson(res, { error: 'tier not grantable: ' + (s && s.tier) + ' (grants cap at EPIC; LEGENDARY and GODFORGED are earned, never handed out)' }, 400);
    }
    const rng = () => crypto.randomInt(0, 281474976710655) / 281474976710655;
    const rolled = spec.map(s => game.rollGearPiece(state, rng, { slot: String(s.slot), tier: String(s.tier) }));
    game.bankHaul(target, rolled);
    if (f.wear) {
      // Wear the strongest granted piece in each slot it covers.
      const rank = { STURDY: 1, RARE: 2, EPIC: 3 };
      const best = {};
      for (const piece of rolled) if (!best[piece.slot] || rank[piece.tier] > rank[best[piece.slot].tier]) best[piece.slot] = piece;
      for (const slot of Object.keys(best)) game.wearGear(target, best[slot].id);
    }
    store.save(true);
    return sendJson(res, {
      grantedTo: { id: target.id, email: target.email, name: target.displayName },
      granted: rolled.map(g => ({ id: g.id, slot: g.slot, tier: g.tier, name: g.name, worn: !!g.worn, affixes: (g.affixes || []).map(a => a.label) })),
      gearNow: (target.gear || []).map(g => ({ id: g.id, slot: g.slot, tier: g.tier, name: g.name, worn: !!g.worn, affixes: (g.affixes || []).map(a => a.label) }))
    });
  }

  // SUPER DECK — GRANT MODS (ADMIN_KEY only): the Keeper hands a fighter
  // mods — unnumbered, permanent v1 items, granted through the same books
  // as the drops grant them (grantMod). No discipline is relaxed here:
  // mods carry no serials to protect, and nothing numbered (items, gear
  // editions, GODFORGED) is reachable from this route either.
  if (method === 'POST' && p === '/api/deck/grant-mods') {
    const f = await bodyJson(req).catch(() => ({}));
    if (String(f.key || '') !== ADMIN_KEY) return sendJson(res, { error: 'wrong key' }, 403);
    const target = state.players[String(f.playerId || '')];
    if (!target || !target.email) return sendJson(res, { error: 'no such member fighter' }, 404);
    ensurePlayer(target);
    const want = Array.isArray(f.mods) && f.mods.length ? f.mods.map(String) : Object.keys(game.MODS_ALL);
    for (const mid of want) if (!game.MODS_ALL[mid]) return sendJson(res, { error: 'unknown mod: ' + mid }, 400);
    const granted = [];
    for (const mid of want) if (game.grantMod(target, mid)) granted.push(mid);
    // Fit the fitted family when asked, so the fighter steps in loaded.
    if (f.fit) for (const mid of Object.keys(game.FITTED_MODS)) {
      if (target.modsOwned[mid]) game.fitMod(target, game.FITTED_MODS[mid].tool, mid);
    }
    store.save(true);
    return sendJson(res, {
      grantedTo: { id: target.id, email: target.email, name: target.displayName },
      granted,
      modsNow: game.modSummary(target)
    });
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
