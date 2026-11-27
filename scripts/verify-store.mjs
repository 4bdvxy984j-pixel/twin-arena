// THE TWIN ARENA — state store verification. STANDALONE: deliberately NOT
// part of `npm run verify` (the five batteries keep their counts and never
// depend on a live database).
//
//   node scripts/verify-store.mjs
//     → file-mode round-trip only (temp DATA_DIR, two processes).
//
//   ARENA_TEST_DATABASE_URL=postgres://…/arena_proof node scripts/verify-store.mjs
//     → the full Postgres proof against a THROWAWAY database (the name must
//       contain test/proof/staging — this script refuses anything else):
//       boot the real server on Postgres, claim a fighter (Founder's Ember
//       No. 1), upload a photo, read the books — then SIGKILL the server,
//       DELETE its data dir (the ephemeral-disk wipe a redeploy performs),
//       boot again on the same database, and read everything back.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let failures = 0;
function check(name, cond, evidence) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? '  — ' + evidence : ''}`);
  if (!cond) failures++;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

async function req(jar, url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (jar && jar.header()) headers.cookie = jar.header();
  const res = await fetch(url, { redirect: 'manual', ...opts, headers });
  if (jar) jar.absorb(res);
  return res;
}
async function form(jar, url, fields) {
  return req(jar, url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
}

// ---------- Part A: file-mode round-trip ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-store-file-'));
  const driver = (code) => new Promise((resolve, reject) => {
    const child = spawn('node', ['-e', code], {
      cwd: path.join(import.meta.dirname, '..'),
      env: { ...process.env, DATA_DIR: dir, DATABASE_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('exit', c => (c === 0 ? resolve(out.trim()) : reject(new Error('driver exit ' + c))));
  });
  await driver(`require('./src/store').init().then(async (s) => {
    const st = require('./src/store');
    st.get().players.__marker = { id: '__marker', email: 'mark@example.com' };
    st.save(true); await st.flush();
    console.log(st.mode());
  })`).then(m => check('file mode reports itself', m === 'file', m));
  const seen = await driver(`require('./src/store').init().then(async () => {
    const st = require('./src/store');
    console.log(st.get().players.__marker ? st.get().players.__marker.email : 'MISSING');
  })`);
  check('file mode round-trip survives a process restart', seen === 'mark@example.com', seen);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- Part B: Postgres end-to-end proof ----------
const PG = process.env.ARENA_TEST_DATABASE_URL;
if (!PG) {
  console.log('SKIP  postgres proof (set ARENA_TEST_DATABASE_URL to a throwaway DB to run it)');
} else {
  const dbName = (() => { try { return new URL(PG).pathname.slice(1); } catch (e) { return ''; } })();
  if (!/test|proof|staging/i.test(dbName)) {
    check('postgres proof refuses a non-throwaway database', false, `db "${dbName}" lacks test/proof/staging in its name`);
  } else {
    const PORT = 4197;
    const BASE = `http://127.0.0.1:${PORT}`;
    const boot = (dataDir) => {
      const child = spawn('node', ['src/server.js'], {
        cwd: path.join(import.meta.dirname, '..'),
        env: { ...process.env, PORT: String(PORT), ADMIN_KEY: 'store-proof-key', DATA_DIR: dataDir, DATABASE_URL: PG },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.log = '';
      child.stdout.on('data', d => { child.log += d; });
      child.stderr.on('data', d => { child.log += d; });
      return child;
    };
    const waitUp = async (child) => {
      for (let i = 0; i < 60; i++) {
        if (child.exitCode !== null) throw new Error('server exited early:\n' + child.log);
        try { const r = await fetch(BASE + '/api/public/state'); if (r.ok) return; } catch (e) {}
        await sleep(500);
      }
      throw new Error('server never came up:\n' + child.log);
    };

    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-store-pg-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-store-pg-b-'));
    const jar = new Jar();
    const email = 'proof@example.com';
    const password = 'proof-password-1';
    let photoPath = null;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

    let s1 = boot(dirA);
    try {
      await waitUp(s1);
      check('boot log names the postgres store', s1.log.includes('store mode: postgres'), s1.log.split('\n')[0]);
      const r = await form(jar, BASE + '/auth/signup', { displayName: 'Proof Fighter', email, password });
      check('signup (the claim) redirects to profile', r.status === 303, `status ${r.status}`);
      const pub = await (await req(null, BASE + '/api/public/state')).json();
      check('books show the founder claim', pub.founders && pub.founders.claimed === 1, JSON.stringify(pub.founders));
      const prof = await (await req(jar, BASE + '/profile')).text();
      const emberAt = prof.indexOf('FOUNDER&#39;S EMBER'); // esc() entity-encodes the apostrophe
      check('profile carries the Founder\u2019s Ember', emberAt >= 0, emberAt >= 0 ? prof.slice(Math.max(0, emberAt - 4), emberAt + 60).replace(/\s+/g, ' ') : 'not found');
      // photo upload (multipart, minimal hand-rolled body)
      const boundary = '----ta-proof-boundary';
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\n`),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);
      const up = await req(jar, BASE + '/api/photo', { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body });
      check('photo upload accepted', up.status === 303 || up.status === 302, `status ${up.status}`);
      const prof2 = await (await req(jar, BASE + '/profile')).text();
      const m = prof2.match(/\/uploads\/[\w.\-]+/);
      photoPath = m && m[0];
      check('profile references the uploaded photo', !!photoPath, photoPath || 'none');
      if (photoPath) {
        const got = Buffer.from(await (await req(null, BASE + photoPath)).arrayBuffer());
        check('photo serves back byte-identical', got.equals(png), `${got.length} bytes`);
      }
      await sleep(600); // let the write-through chain land, as a live server would have long before a redeploy
    } finally {
      s1.kill('SIGKILL');
      await sleep(300);
    }
    fs.rmSync(dirA, { recursive: true, force: true }); // the ephemeral disk is gone — the redeploy wipe

    let s2 = boot(dirB);
    try {
      await waitUp(s2);
      const pub = await (await req(null, BASE + '/api/public/state')).json();
      check('after redeploy: founder claim SURVIVED', pub.founders && pub.founders.claimed === 1, JSON.stringify(pub.founders));
      const jar2 = new Jar();
      const r = await form(jar2, BASE + '/auth/login', { email, password });
      check('after redeploy: login still works (the player record SURVIVED)', r.status === 303, `status ${r.status}`);
      const prof = await (await req(jar2, BASE + '/profile')).text();
      check('after redeploy: the fighter record is intact (display name on profile)', prof.includes('Proof Fighter'), '');
      check('after redeploy: the Ember is still in the satchel', prof.includes('FOUNDER&#39;S EMBER'), '');
      if (photoPath) {
        const got = Buffer.from(await (await req(null, BASE + photoPath)).arrayBuffer());
        check('after redeploy: the photo SURVIVED (rehydrated from the DB)', got.equals(png), `${got.length} bytes`);
      }
    } finally {
      s2.kill('SIGKILL');
      await sleep(300);
    }
    fs.rmSync(dirB, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} store check(s) FAILED` : '\nAll store checks passed.');
process.exit(failures ? 1 : 0);
