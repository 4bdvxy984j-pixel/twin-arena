'use strict';
// Boot file. Initializes the state store FIRST — Postgres when DATABASE_URL
// is set (the world then persists across deploys and restarts), the local
// file store otherwise — and only then starts the app (src/app.js), which
// expects the store ready and never loads state itself.
const store = require('./store');

store.init()
  .then(() => {
    console.log(store.mode() === 'postgres'
      ? 'THE TWIN ARENA store mode: postgres (DATABASE_URL set — the world persists)'
      : 'THE TWIN ARENA store mode: file (local disk — the world is ephemeral)');
    require('./app');
  })
  .catch(e => {
    console.error('FATAL: state store failed to initialize:', e.message);
    process.exit(1);
  });
