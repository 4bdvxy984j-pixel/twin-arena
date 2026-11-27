'use strict';
// Tiny JSON state store: in-memory state, atomic file saves (tmp + rename).
// Single-process server, so synchronous saves on mutation are safe and simple.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function defaultState() {
  return {
    config: {
      aggression: 1.0,      // deck dial: gate regen / pressure multiplier (0.5 - 2)
      learningSpeed: 1.0,   // deck dial: how fast familiarity grows (0.5 - 2)
      frozen: false         // deck switch: closes the arena with a maintenance card
    },
    players: {},            // id -> player record (guests have no email)
    sessions: {},           // session token -> player id
    shapesGlobal: {},       // patternKey -> times taught (all fighters, ever)
    globalArmor: {},        // tool -> 0..0.2 shared hardening from the whole crowd
    fights: [],             // recent fight summaries, newest first (spectator rail), cap 60
    fightSeq: 0,
    verdicts: {}            // fightId -> verdict record (shareable cards)
  };
}

let state = null;

function load() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      const d = defaultState();
      state = Object.assign(d, raw);
      state.config = Object.assign(d.config, raw.config || {});
    } catch (e) {
      console.error('state.json unreadable, starting fresh:', e.message);
      state = defaultState();
    }
  } else {
    state = defaultState();
  }
  return state;
}

let saveTimer = null;
function save(immediate) {
  if (!state) return;
  const write = () => {
    saveTimer = null;
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE);
  };
  if (immediate) { if (saveTimer) clearTimeout(saveTimer); write(); return; }
  if (!saveTimer) saveTimer = setTimeout(write, 150);
}

function get() { return state; }

module.exports = { load, save, get, DATA_DIR, UPLOAD_DIR, STATE_FILE };
