'use strict';
// World state store — two backends, one interface.
//
// FILE mode (default, no DATABASE_URL): in-memory state, atomic JSON file
// saves (tmp + rename) under DATA_DIR. This is the local-dev/test path and
// behaves exactly as the arena always has.
//
// POSTGRES mode (DATABASE_URL set): the same in-memory state, but the world
// loads from a Postgres table at boot and every mutation writes through to
// it (debounced like the file saves, serialized on one promise chain).
// Uploaded photos are mirrored into a table too and re-hydrated to disk at
// boot, so a redeploy or restart on an ephemeral host loses NOTHING —
// fighters, Founder's Embers, loot, devils and the books all survive.
// Postgres is seeded fresh ONLY when its state row genuinely does not
// exist (and a local state.json, if one is present, is adopted as the seed).
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PG_URL = process.env.DATABASE_URL || null;

function defaultState() {
  return {
    config: {
      aggression: 1.0,      // deck dial: gate regen / pressure multiplier (0.5 - 2)
      learningSpeed: 1.0,   // deck dial: how fast familiarity grows (0.5 - 2)
      frozen: false,        // deck switch: closes the arena with a maintenance card
      stormUntil: 0,        // SUPER DECK: storm deadline (epoch ms); 0 = no storm
      broadcast: null,      // SUPER DECK: { text, expiresAt } — THE TWIN SPEAKS; expiresAt 0 = until cleared
      floodgates: false,    // SUPER DECK: chaos toggle — trace gains halved while on
      spotlight: null       // SUPER DECK: challenge token pinned as Tonight's Devil
    },
    deck: {
      memberTieHash: null,  // scrypt hash ONLY of the owner's Gatekeeper Member Key — the key itself is never stored
      ownerPlayerId: null   // the fighter profile the tie binds (the house owner)
    },
    deckSessions: {},       // deck session token -> 'admin' | 'member' (member-key sign-in rides a cookie, never the URL)
    players: {},            // id -> player record (guests have no email)
    sessions: {},           // session token -> player id
    shapesGlobal: {},       // patternKey -> times taught (all fighters, ever)
    globalArmor: {},        // tool -> 0..0.2 shared hardening from the whole crowd
    pit: { bouts: 0, holds: 0, breaches: 0 }, // THE PIT's own tallies — devils, not the house Twin
    descent: { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 }, // THE DESCENT's tallies
    galactic: { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} }, // THE GALACTIC's tallies + the world's first-clear book
    gearSeq: {},              // LEGENDARY gear edition counters, per unique power (+ _inst instance counter)
    itemsSeq: { mirrorwrap: 0, anchorstitch: 0 }, // numbered-edition mint counters, per item type
    keeperSetGranted: false, // the Keeper's master set is granted once, when the owner fighter exists
    fights: [],             // recent fight summaries, newest first (spectator rail), cap 60
    fightSeq: 0,
    verdicts: {}            // fightId -> verdict record (shareable cards)
  };
}

let state = null;
let modeName = PG_URL ? 'postgres' : 'file';
let pool = null;
let writeChain = Promise.resolve();
let saveTimer = null;

function adopt(raw) {
  const d = defaultState();
  state = Object.assign(d, raw);
  state.config = Object.assign(d.config, raw.config || {});
  state.deck = Object.assign(d.deck, raw.deck || {});
  return state;
}

// ---------- file backend ----------
function load() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (fs.existsSync(STATE_FILE)) {
    try {
      adopt(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    } catch (e) {
      console.error('state.json unreadable, starting fresh:', e.message);
      state = defaultState();
    }
  } else {
    state = defaultState();
  }
  return state;
}

function writeFileNow() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

// ---------- postgres backend ----------
function pgNeedsSsl(url) {
  try {
    const h = new URL(url).hostname;
    return !(h === 'localhost' || h === '127.0.0.1' || h === '::1');
  } catch (e) { return true; }
}

function enqueuePgWrite() {
  if (!pool || !state) return writeChain;
  const snapshot = JSON.stringify(state);
  writeChain = writeChain
    .then(() => pool.query(
      'INSERT INTO arena_state (id, doc, updated_at) VALUES (1, $1, now()) ' +
      'ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()',
      [snapshot]))
    .catch(e => console.error('arena_state write failed:', e.message));
  return writeChain;
}

async function initPg() {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: PG_URL,
    ssl: pgNeedsSsl(PG_URL) ? { rejectUnauthorized: false } : false,
    max: 3
  });
  await pool.query(
    'CREATE TABLE IF NOT EXISTS arena_state (' +
    'id integer PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  await pool.query(
    'CREATE TABLE IF NOT EXISTS arena_uploads (' +
    'name text PRIMARY KEY, data bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const { rows } = await pool.query('SELECT doc FROM arena_state WHERE id = 1');
  if (rows.length && rows[0].doc) {
    adopt(rows[0].doc);
  } else {
    // Genuinely empty database: adopt a local state.json if one exists
    // (a migration), otherwise seed a fresh world — then persist the seed.
    let seeded = false;
    if (fs.existsSync(STATE_FILE)) {
      try { adopt(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); seeded = true; }
      catch (e) { console.error('state.json unreadable during PG seed:', e.message); }
    }
    if (!seeded) state = defaultState();
    await pool.query('INSERT INTO arena_state (id, doc) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
      [JSON.stringify(state)]);
  }
  // Photos: the database is the truth; disk is only the serving cache.
  const up = await pool.query('SELECT name, data FROM arena_uploads');
  for (const r of up.rows) {
    try { fs.writeFileSync(path.join(UPLOAD_DIR, r.name), r.data); }
    catch (e) { console.error('upload hydrate failed for', r.name, e.message); }
  }
  // A graceful stop (Render redeploys send SIGTERM) flushes the last writes.
  const flushAndExit = (sig) => {
    flush().catch(() => {}).then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGTERM', flushAndExit);
  process.once('SIGINT', flushAndExit);
  return state;
}

// ---------- shared interface ----------
async function init() {
  if (PG_URL) return initPg();
  modeName = 'file';
  return load();
}

function save(immediate) {
  if (!state) return;
  if (modeName === 'postgres') {
    if (immediate) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      enqueuePgWrite();
      return;
    }
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; enqueuePgWrite(); }, 150);
    return;
  }
  if (immediate) { if (saveTimer) clearTimeout(saveTimer); saveTimer = null; writeFileNow(); return; }
  if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; writeFileNow(); }, 150);
}

// Resolves when every queued Postgres write has landed (file mode: the
// pending debounced write is forced out synchronously first).
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; if (state) { if (modeName === 'postgres') enqueuePgWrite(); else writeFileNow(); } }
  return writeChain;
}

// Photo write-through: in Postgres mode the bytes are mirrored into the DB
// (the server has already written the local file itself, as always).
function saveUpload(name, data) {
  if (modeName !== 'postgres' || !pool) return;
  writeChain = writeChain
    .then(() => pool.query(
      'INSERT INTO arena_uploads (name, data, updated_at) VALUES ($1, $2, now()) ' +
      'ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
      [name, data]))
    .catch(e => console.error('arena_uploads write failed:', e.message));
}

function get() { return state; }
function mode() { return modeName; }

module.exports = { init, load, save, flush, saveUpload, get, mode, DATA_DIR, UPLOAD_DIR, STATE_FILE };
