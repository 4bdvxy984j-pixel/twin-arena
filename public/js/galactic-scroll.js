/* THE GALACTIC — 1944 FORM (G2): the scrolling sky.
 *
 * The Reach flown as a vertical-scrolling shooter in the 1942/1943/1944
 * lineage: the sky streams under you, the Twin's waves move and shoot
 * back, carriers drop their cargo, and THE HERALD waits at the top of
 * Stage 8's climb. The pilot flies with a thumb (the ship rides above
 * it), holds one big FIRE button, spins the fly wheel to choose a
 * system, and fires it with ACTIVATE — every system burns for its dealt
 * time, counts down in the open, and dies on schedule.
 *
 * The referee doctrine holds exactly as in the wheel battle: this layer
 * submits ONE input log — movement samples, fire toggles, activations,
 * all timestamped — and the server replays it through the identical
 * scroll math (the SCROLL-MATH block below is the server's own code,
 * mirrored verbatim; a verify check holds the two copies to it). The
 * local simulation is a preview of the referee's truth, never a claim:
 * kills, damage, drops and clears stand only as the replay calls them.
 * Ship position is presentation; the log is the fight.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SFX = window.TASFX || null;
  function sfx(n) { if (SFX) { try { SFX.play(n); } catch (e) {} } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function post(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

/* SCROLL-MATH-BEGIN */
// ---- the field, the ship, the sky's shared arithmetic ------------------
const SCROLL_FIELD = { w: 400, h: 640 };
const SCROLL_STEP_MS = 50;
const SHIP_SPEED = 540;          // logical px per second — the flight law
const SHIP_R = 12;
const SHOT_SPEED = 660;          // player bolts, px/s upward
const EBULLET_R = 4;
// Enemy classes: hull, radius, score, and how they cross the sky.
const SCROLL_CLASSES = {
  dart:    { hp: 18,  r: 13, score: 50,  vy: 148 },
  weaver:  { hp: 27,  r: 14, score: 70,  vy: 96 },
  flanker: { hp: 22,  r: 13, score: 80,  vx: 168 },
  gunship: { hp: 74,  r: 20, score: 150, vy: 62, fireMs: 2500, bulletSpeed: 228, bulletDmg: 7 },
  carrier: { hp: 124, r: 24, score: 200, vy: 34 }
};
// Closed-form enemy position: pure in (spawn, t). t and spawn.at in ms.
function scrollEnemyPos(sp, t) {
  const dt = (t - sp.at) / 1000;
  if (dt < 0) return null;
  const W = SCROLL_FIELD.w, H = SCROLL_FIELD.h;
  switch (sp.cls) {
    case 'dart':
      return { x: sp.x + Math.sin(dt * 2.1 + sp.phase) * 26, y: -30 + SCROLL_CLASSES.dart.vy * dt };
    case 'weaver':
      return { x: sp.x + Math.sin(dt * 1.35 + sp.phase) * 74, y: -30 + SCROLL_CLASSES.weaver.vy * dt };
    case 'flanker': {
      const dir = sp.side > 0 ? 1 : -1;
      const x = (sp.side > 0 ? -30 : W + 30) + dir * SCROLL_CLASSES.flanker.vx * dt;
      return { x, y: sp.y + Math.sin(dt * 1.8 + sp.phase) * 34 };
    }
    case 'gunship': {
      // Descends to its hover line over ~2.6s, holds and fires, then
      // climbs away when its window closes — a gunship never lands.
      const hoverY = sp.hoverY;
      let y;
      if (dt < 2.6) y = -36 + (hoverY + 36) * (dt / 2.6);
      else if (t < sp.retreatAt) y = hoverY;
      else y = hoverY - 74 * (dt - (sp.retreatAt - sp.at) / 1000);
      return { x: sp.x + Math.sin(dt * 0.7 + sp.phase) * 20, y };
    }
    case 'carrier':
      return { x: sp.x + Math.sin(dt * 0.5 + sp.phase) * 14, y: -44 + SCROLL_CLASSES.carrier.vy * dt };
    default:
      return null;
  }
}
// Is the enemy still on the field at time t? (Pure, mirrors the sim.)
function scrollEnemyGone(sp, t) {
  const p = scrollEnemyPos(sp, t);
  if (!p) return true;
  if (sp.cls === 'flanker') return p.x < -46 || p.x > SCROLL_FIELD.w + 46;
  if (sp.cls === 'gunship') return t >= sp.retreatAt && p.y < -52;
  return p.y > SCROLL_FIELD.h + 48;
}
// THE HERALD: a capital construct riding the top of the field. Its body
// sways on a slow loom; its two cores ride at fixed offsets. Phase is a
// pure function of the hull fraction the referee has left it.
const HERALD_DEF = {
  hp: 2850, r: 62, y: 118, swayAmp: 26, swayMs: 5200,
  coreR: 19, coreDx: 54, coreDy: 16, coreMult: 2,
  turretFireMs: [1750, 1350, 1050], turretBulletSpeed: 246, turretDmg: 7,
  burstMs: 3800, burstCount: 10
};
function scrollHeraldPos(t) {
  return { x: SCROLL_FIELD.w / 2 + Math.sin(t / HERALD_DEF.swayMs * Math.PI * 2) * HERALD_DEF.swayAmp, y: HERALD_DEF.y };
}
function scrollHeraldPhase(hpFrac) { return hpFrac > 0.7 ? 1 : hpFrac > 0.4 ? 2 : 3; }

// ---- the eight stages of the Reach, each its own stretch of sky --------
const SCROLL_STAGES = [
  { n: 1, name: 'THE EMBER GATE', motif: 'spires', durationMs: 75000, aggression: 1.00,
    palette: { skyTop: '#070a1e', skyBottom: '#1b1030', surface: '#2a1638', accent: '#ff7a3c', star: '#ffe9d2' },
    line: 'The first gate of the Reach. Pickets on the rim, and the sky just learning your name.' },
  { n: 2, name: 'CINDER LANES', motif: 'grid', durationMs: 78000, aggression: 1.06,
    palette: { skyTop: '#0a0716', skyBottom: '#241126', surface: '#33182e', accent: '#ff2a6d', star: '#ffd7e6' },
    line: 'A ruined city grid slides beneath you — lanes the patrols learned to hunt in pairs.' },
  { n: 3, name: 'THE GLASS FLATS', motif: 'flats', durationMs: 82000, aggression: 1.12,
    palette: { skyTop: '#041018', skyBottom: '#0d2436', surface: '#12303c', accent: '#39d5c0', star: '#d8fff6' },
    line: 'Shard fields glitter below. Weavers ride the glare where your eyes slide off them.' },
  { n: 4, name: 'MIRAGE SHOALS', motif: 'rifts', durationMs: 86000, aggression: 1.19,
    palette: { skyTop: '#0d0618', skyBottom: '#2a1140', surface: '#341650', accent: '#b967ff', star: '#eedcff' },
    line: 'The Mirage wings hunt here — false shapes in the rifts, real guns behind them.' },
  { n: 5, name: 'THE ASHEN DRIFT', motif: 'dunes', durationMs: 90000, aggression: 1.26,
    palette: { skyTop: '#100a10', skyBottom: '#2c1a20', surface: '#3a232a', accent: '#ff9a8a', star: '#ffe3dc' },
    line: 'Ash dunes, slow carriers, and gunships that sit in the drift and wait for you.' },
  { n: 6, name: 'CHOIR WRECKS', motif: 'wrecks', durationMs: 94000, aggression: 1.34,
    palette: { skyTop: '#050d14', skyBottom: '#12262e', surface: '#17323a', accent: '#5dffa0', star: '#dcffec' },
    line: 'The wrecks of the Choir\'s first fleet. Flankers run the gaps between the dead hulls.' },
  { n: 7, name: "THE HERALD'S APRON", motif: 'spires', durationMs: 94000, aggression: 1.44,
    palette: { skyTop: '#12060d', skyBottom: '#33101c', surface: '#421624', accent: '#ff4a3c', star: '#ffded2' },
    line: 'The red deepens. Everything the Reach has left flies here, in front of its voice.' },
  { n: 8, name: 'THE HERALD', motif: 'throne', durationMs: 150000, aggression: 1.55,
    palette: { skyTop: '#0d0408', skyBottom: '#2a0a14', surface: '#380d1a', accent: '#ff2a3c', star: '#ffd9d2' },
    line: 'The voice of the Reach, enthroned at the top of its own sky. Silence it.' }
];
function scrollStageDef(n) { return SCROLL_STAGES[n - 1] || null; }

// Base composition per stage (before pilot scaling): the escalation of
// Phase 1, stage over stage — pickets teach, patrols pair, Mirage wings
// multiply, and the apron throws everything left at the capital's door.
const SCROLL_TABLES = {
  1: { dart: 14, weaver: 4,  flanker: 0, gunship: 0, carrier: 1 },
  2: { dart: 16, weaver: 6,  flanker: 2, gunship: 1, carrier: 1 },
  3: { dart: 18, weaver: 9,  flanker: 4, gunship: 2, carrier: 1 },
  4: { dart: 20, weaver: 11, flanker: 5, gunship: 3, carrier: 2 },
  5: { dart: 22, weaver: 12, flanker: 6, gunship: 5, carrier: 2 },
  6: { dart: 24, weaver: 13, flanker: 8, gunship: 6, carrier: 2 },
  7: { dart: 26, weaver: 14, flanker: 9, gunship: 7, carrier: 3 },
  8: { dart: 10, weaver: 8,  flanker: 4, gunship: 2, carrier: 2 }
};
// The Twin counters habits: each tool's nemesis class. She weights the
// sky toward the counter of the weapon you lean on AND the counter of
// the weapon you never practice — the formation you handle worst flies.
const SCROLL_COUNTERS = { probe: 'weaver', flood: 'dart', whisper: 'gunship', decoy: 'flanker' };

// Deployables in the scroll register: ACTIVATE, burn for a time, expire.
// Charges are dealt per stage exactly as the Mod Rail deals them.
const SCROLL_MOD_TIMES = { overclock: 8000, ghostplate: 4500, coldsnap: 6000, tracepurge: 0 };
const SCROLL_GUN = { cadenceMs: 150, dmg: 9, overclockCadenceMs: 92 };
const DROP_CYCLE = ['hull', 'charge', 'score'];

// ---- the dealt waves ----------------------------------------------------
// ctx: { level, attention (0-100), dominantTool, weakestTool, rookie,
//        cleared } — the pilot's experience, read by the server from the
// books. A first-time pilot gets a gentler sky; a read pilot gets the
// sky she has prepared for them. Deterministic in (seed, n, ctx).
function makeScrollWaves(seed, n, ctx) {
  ctx = ctx || {};
  const stage = scrollStageDef(n);
  if (!stage) return null;
  const rnd = rng32(seed >>> 0);
  const level = Math.max(1, ctx.level || 1);
  const levelFactor = 1 + Math.min(0.5, (level - 1) * 0.045);
  const rookieFactor = ctx.rookie ? 0.72 : 1;
  const countMult = levelFactor * rookieFactor * (ctx.cleared ? 0.9 : 1);
  const aggr = stage.aggression * (1 + Math.min(0.35, (level - 1) * 0.03)) *
    (ctx.rookie ? 0.85 : 1) * (1 + (ctx.attention || 0) / 400);
  const table = Object.assign({}, SCROLL_TABLES[n]);
  // Her counter-weighting: +2 of the nemesis of your favorite weapon,
  // +2 of the nemesis of your least-flown — formations you handle worst.
  const bump = (tool) => {
    const cls = tool && SCROLL_COUNTERS[tool];
    if (cls) table[cls] += 2;
  };
  bump(ctx.dominantTool); bump(ctx.weakestTool);
  for (const cls of Object.keys(table)) table[cls] = Math.max(0, Math.round(table[cls] * countMult));

  const spawns = [];
  const dur = stage.durationMs;
  const bossStage = n === 8;
  const fieldSpan = bossStage ? dur - 10000 : dur - 5000;
  // Waves ride in clusters: a breath, a knot of hulls, a breath.
  const place = (cls, count, t0, t1) => {
    for (let i = 0; i < count; i++) {
      const at = Math.round(t0 + rnd() * Math.max(1, t1 - t0));
      const sp = { at, cls, phase: +(rnd() * Math.PI * 2).toFixed(3) };
      if (cls === 'flanker') { sp.side = rnd() < 0.5 ? 1 : -1; sp.y = Math.round(90 + rnd() * 300); sp.x = 0; }
      else sp.x = Math.round(36 + rnd() * (SCROLL_FIELD.w - 72));
      if (cls === 'gunship') {
        sp.hoverY = Math.round(96 + rnd() * 130);
        sp.retreatAt = at + Math.round(15000 + rnd() * 9000);
        sp.fireMs = Math.round(SCROLL_CLASSES.gunship.fireMs / aggr);
        sp.firstFire = Math.round(2900 + rnd() * 1400);
        sp.bulletSpeed = Math.round(SCROLL_CLASSES.gunship.bulletSpeed * (0.9 + aggr * 0.12));
      }
      spawns.push(sp);
    }
  };
  // Distribute each class across the stretch in rough thirds so the
  // stage breathes: openers light, the middle thick, the end thickest.
  for (const cls of ['dart', 'weaver', 'flanker', 'gunship', 'carrier']) {
    const total = table[cls];
    if (!total) continue;
    const a = Math.ceil(total * 0.3), b = Math.ceil(total * 0.35), c = total - a - b;
    place(cls, a, 2500, fieldSpan * 0.36);
    place(cls, b, fieldSpan * 0.34, fieldSpan * 0.7);
    place(cls, c, fieldSpan * 0.66, fieldSpan);
  }
  if (bossStage) {
    // The Herald's escort screens, tagged by the phase they fly cover
    // for — a screen whose hour has passed never launches.
    for (let i = 0; i < 7; i++) {
      const at = 9000 + Math.round(rnd() * 26000);
      spawns.push({ at, cls: rnd() < 0.6 ? 'dart' : 'weaver', phase: +(rnd() * 6.28).toFixed(3), x: Math.round(40 + rnd() * 320), escortPhase: 1 });
    }
    for (let i = 0; i < 6; i++) {
      const at = 55000 + Math.round(rnd() * 55000);
      spawns.push({ at, cls: rnd() < 0.5 ? 'weaver' : 'flanker', phase: +(rnd() * 6.28).toFixed(3), x: Math.round(40 + rnd() * 320), side: rnd() < 0.5 ? 1 : -1, y: Math.round(100 + rnd() * 260), escortPhase: 3 });
    }
  }
  spawns.sort((a, b) => a.at - b.at);
  return {
    stage: { n: stage.n, name: stage.name, motif: stage.motif, line: stage.line, palette: stage.palette },
    durationMs: dur, aggression: +aggr.toFixed(3),
    spawns,
    boss: bossStage ? { hp: HERALD_DEF.hp, at: 6000 } : null,
    dropOffset: Math.floor(rnd() * 3)
  };
}

// ---- the replay ---------------------------------------------------------
// State is pure data (structuredClone-able) so test planners can branch
// it. The stepper advances in fixed 50ms steps; enemy time (S.et) runs
// on its own clock because COLD SNAP slows the sky, not the pilot.
function createScrollStepper(fight, resumeState) {
  const waves = fight.scroll.waves;
  const dealt = fight.scroll.dealt;
  const bossStage = !!waves.boss;
  const S = resumeState || {
    t: 0, et: 0, outcome: null, problem: null,
    ship: { x: SCROLL_FIELD.w / 2, y: SCROLL_FIELD.h - 100 },
    mvTarget: null, lastSample: null, cursor: 0,
    firing: false, nextShotAt: 0, lastTeachAt: 0,
    hull: dealt.startHull, trace: dealt.startTrace || 0, coil: 0,
    shots: [], ebullets: [], pickups: [],
    enemyHp: waves.spawns.map(sp => SCROLL_CLASSES[sp.cls].hp),
    enemyGone: waves.spawns.map(() => false),
    enemyNextFire: waves.spawns.map(sp => (sp.cls === 'gunship' ? sp.at + sp.firstFire : Infinity)),
    charges: Object.assign({}, dealt.deploy),
    overclockUntil: 0, ghostUntil: 0, snapUntil: 0, lastRamAt: -2000,
    kills: 0, carrierKills: 0, score: 0, nearMisses: 0, volleys: 0, hitsTaken: 0,
    damageDealt: 0, modsUsed: {}, teachActions: [],
    bossHp: waves.boss ? waves.boss.hp : null, bossPhase: 0, phasesSeen: [],
    turretNext: waves.boss ? [waves.boss.at + 1300, waves.boss.at + 2100] : [],
    nextBurstAt: 0
  };
  const waveHpTotal = waves.spawns.reduce((s, sp) => s + SCROLL_CLASSES[sp.cls].hp, 0) + (waves.boss ? waves.boss.hp : 0);
  const fittedHas = (id) => !!dealt.fitted[id];

  function aimError(idx, shotNo, base) {
    // Deterministic scatter: a hash, not an rng — replays agree forever.
    const h = ((Math.imul(idx + 7, 2654435761) ^ Math.imul(shotNo + 1, 40503)) >>> 0) % 1000;
    return (h / 1000 - 0.5) * base * (fittedHas('ashenveil') ? 3 : 1);
  }
  function fireBullet(x, y, angle, speed, dmg) {
    S.ebullets.push({ x, y, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed, dmg, grazed: false });
  }
  function aimedBullet(x, y, speed, dmg, idx, shotNo) {
    const ang = Math.atan2(S.ship.x - x, S.ship.y - y) + aimError(idx, shotNo, 0.11);
    fireBullet(x, y, ang, speed, dmg);
  }
  function killEnemy(i, byRam) {
    const sp = waves.spawns[i];
    S.enemyGone[i] = true;
    S.kills++;
    S.score += SCROLL_CLASSES[sp.cls].score;
    if (sp.cls === 'carrier') {
      const p = scrollEnemyPos(sp, S.et);
      const kind = DROP_CYCLE[(S.carrierKills + (waves.dropOffset || 0)) % DROP_CYCLE.length];
      S.carrierKills++;
      if (p) S.pickups.push({ x: p.x, y: p.y, kind, t0: S.t });
    }
  }
  function damageEnemy(i, dmg, isSplash) {
    if (S.enemyGone[i] || S.enemyHp[i] <= 0) return;
    S.enemyHp[i] -= dmg;
    S.damageDealt += dmg;
    if (S.enemyHp[i] <= 0) killEnemy(i, false);
  }
  function damageBoss(dmg) {
    if (S.bossHp == null || S.bossHp <= 0) return;
    S.bossHp -= dmg;
    S.damageDealt += dmg;
    if (S.bossHp <= 0) {
      S.bossHp = 0;
      S.score += 2000;
      S.outcome = { result: 'win', endReason: 'capital', at: S.t };
    }
  }
  function applyAction(a) {
    const t = a.t;
    if (a.tool === 'mv') {
      const x = +a.x, y = +a.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 'impossible movement';
      const prev = S.lastSample || { t: 0, x: SCROLL_FIELD.w / 2, y: SCROLL_FIELD.h - 100 };
      const dt = Math.max(1, t - prev.t) / 1000;
      const dist = Math.hypot(x - prev.x, y - prev.y);
      if (dist > SHIP_SPEED * dt * 1.5 + 48) return 'impossible movement';
      S.lastSample = { t, x, y };
      S.mvTarget = {
        x: Math.max(14, Math.min(SCROLL_FIELD.w - 14, x)),
        y: Math.max(30, Math.min(SCROLL_FIELD.h - 14, y))
      };
      return null;
    }
    if (a.tool === 'fire') { S.firing = !!a.on; return null; }
    if (typeof a.tool === 'string' && a.tool.startsWith('mod:')) {
      const id = a.tool.slice(4);
      if (!DEPLOY_MODS[id]) return 'unknown tool';
      if (!(id in S.charges)) return 'mod not owned';
      if (!(S.charges[id] > 0)) return 'mod charges spent';
      S.charges[id]--;
      S.modsUsed[id] = (S.modsUsed[id] || 0) + 1;
      if (id === 'overclock') S.overclockUntil = t + SCROLL_MOD_TIMES.overclock;
      else if (id === 'ghostplate') S.ghostUntil = t + SCROLL_MOD_TIMES.ghostplate;
      else if (id === 'coldsnap') S.snapUntil = t + SCROLL_MOD_TIMES.coldsnap;
      else if (id === 'tracepurge') { S.trace = Math.max(0, S.trace - 35); S.ebullets = []; }
      return null;
    }
    return 'unknown tool';
  }

  function step() {
    const dtMs = SCROLL_STEP_MS, dt = dtMs / 1000;
    const newT = S.t + dtMs;
    const snap = S.t < S.snapUntil;
    const newEt = S.et + dtMs * (snap ? 0.5 : 1);
    // -- enemy fire scheduled in enemy time, resolved before motion
    for (let i = 0; i < waves.spawns.length; i++) {
      const sp = waves.spawns[i];
      if (sp.cls !== 'gunship' || S.enemyGone[i] || S.enemyHp[i] <= 0) continue;
      while (S.enemyNextFire[i] <= newEt && S.enemyNextFire[i] < sp.retreatAt) {
        const p = scrollEnemyPos(sp, S.enemyNextFire[i]);
        if (p && p.y > 0) {
          const shotNo = Math.round((S.enemyNextFire[i] - sp.at) / sp.fireMs);
          aimedBullet(p.x, p.y + 14, sp.bulletSpeed, SCROLL_CLASSES.gunship.bulletDmg, i, shotNo);
        }
        S.enemyNextFire[i] += sp.fireMs / (1 + S.trace / 400);
      }
    }
    // -- the Herald wakes, sways, and fires its banks
    if (waves.boss && S.bossHp > 0 && newEt >= waves.boss.at) {
      const hpFrac = S.bossHp / waves.boss.hp;
      const phase = scrollHeraldPhase(hpFrac);
      if (phase !== S.bossPhase) {
        S.bossPhase = phase;
        S.phasesSeen.push(phase);
        if (phase === 3) S.nextBurstAt = newEt + 1400;
      }
      const hp = scrollHeraldPos(newEt);
      for (let k = 0; k < 2; k++) {
        if (newEt >= S.turretNext[k]) {
          const tx = hp.x + (k === 0 ? -HERALD_DEF.coreDx : HERALD_DEF.coreDx), ty = hp.y + 26;
          if (phase === 2) {
            for (const off of [-0.16, 0, 0.16]) {
              const ang = Math.atan2(S.ship.x - tx, S.ship.y - ty) + off;
              fireBullet(tx, ty, ang, HERALD_DEF.turretBulletSpeed, HERALD_DEF.turretDmg);
            }
          } else {
            aimedBullet(tx, ty, HERALD_DEF.turretBulletSpeed, HERALD_DEF.turretDmg, 900 + k, S.turretNext[k]);
          }
          S.turretNext[k] += HERALD_DEF.turretFireMs[phase - 1];
        }
      }
      if (phase === 3 && S.nextBurstAt && newEt >= S.nextBurstAt) {
        for (let j = 0; j < HERALD_DEF.burstCount; j++) {
          const ang = (j / HERALD_DEF.burstCount) * Math.PI * 2 + newEt / 900;
          fireBullet(hp.x, hp.y + 10, ang, 186, HERALD_DEF.turretDmg);
        }
        S.nextBurstAt += HERALD_DEF.burstMs;
      }
    }
    // -- the pilot's ship flies toward the sampled thumb
    if (S.mvTarget) {
      const dx = S.mvTarget.x - S.ship.x, dy = S.mvTarget.y - S.ship.y;
      const d = Math.hypot(dx, dy), maxD = SHIP_SPEED * dt;
      if (d <= maxD) { S.ship.x = S.mvTarget.x; S.ship.y = S.mvTarget.y; }
      else { S.ship.x += dx / d * maxD; S.ship.y += dy / d * maxD; }
    }
    // -- the gun speaks
    if (S.firing && !S.outcome) {
      const cadence = S.t < S.overclockUntil ? dealt.gun.overclockCadenceMs : dealt.gun.cadenceMs;
      while (newT >= S.nextShotAt) {
        const fireT = Math.max(S.nextShotAt, S.t);
        let mainDmg = dealt.gun.dmg;
        if (fittedHas('paybackcoil') && S.coil > 0) { mainDmg += Math.round(S.coil); S.coil = 0; }
        S.shots.push({ x: S.ship.x, y: S.ship.y - 18, dmg: mainDmg, pierce: fittedHas('throughline'), hitSet: {} });
        for (let wgi = 0; wgi < (dealt.wings || 0); wgi++) {
          const off = wgi === 0 ? -34 : 34;
          S.shots.push({ x: S.ship.x + off, y: S.ship.y - 8, dmg: Math.round(dealt.gun.dmg * 0.55), pierce: false, hitSet: {} });
        }
        S.volleys++;
        if (fireT - S.lastTeachAt >= 1000) {
          S.teachActions.push({ t: fireT, tool: dealt.teachTool });
          S.lastTeachAt = fireT;
        }
        S.nextShotAt = (S.nextShotAt || newT) + cadence;
        if (S.nextShotAt <= S.t) S.nextShotAt = newT + cadence;
      }
    }
    // -- bolts fly and find hulls
    const liveShots = [];
    for (const sh of S.shots) {
      sh.y -= SHOT_SPEED * dt;
      if (sh.y < -24) continue;
      let spent = false;
      // the Herald first — it fills the top of the sky
      if (waves.boss && S.bossHp > 0 && newEt >= waves.boss.at) {
        const hp = scrollHeraldPos(newEt);
        let hit = false, mult = 1;
        if (S.bossPhase >= 2) {
          for (const sgn of [-1, 1]) {
            const cx = hp.x + sgn * HERALD_DEF.coreDx, cy = hp.y + HERALD_DEF.coreDy;
            if (Math.hypot(sh.x - cx, sh.y - cy) < HERALD_DEF.coreR + 4) { hit = true; mult = HERALD_DEF.coreMult; break; }
          }
        }
        if (!hit && Math.hypot(sh.x - hp.x, sh.y - hp.y) < HERALD_DEF.r + 4) hit = true;
        if (hit) {
          damageBoss(sh.dmg * mult);
          spent = !sh.pierce;
          if (S.outcome) { /* the capital fell mid-step */ }
        }
      }
      if (!spent) {
        for (let i = 0; i < waves.spawns.length; i++) {
          if (S.enemyGone[i] || S.enemyHp[i] <= 0 || sh.hitSet[i]) continue;
          const sp = waves.spawns[i];
          if (sp.at > newEt) continue;
          if (sp.escortPhase && waves.boss && S.bossPhase !== sp.escortPhase) continue;
          const p = scrollEnemyPos(sp, newEt);
          if (!p || p.y < -50) continue;
          const rr = SCROLL_CLASSES[sp.cls].r + 4;
          if (Math.abs(sh.x - p.x) < rr && Math.abs(sh.y - p.y) < rr && Math.hypot(sh.x - p.x, sh.y - p.y) < rr) {
            sh.hitSet[i] = true;
            damageEnemy(i, sh.dmg, false);
            if (fittedHas('emberline')) {
              for (let j = 0; j < waves.spawns.length; j++) {
                if (j === i || S.enemyGone[j] || S.enemyHp[j] <= 0 || waves.spawns[j].at > newEt) continue;
                const q = scrollEnemyPos(waves.spawns[j], newEt);
                if (q && Math.hypot(q.x - p.x, q.y - p.y) < 48) damageEnemy(j, Math.round(sh.dmg * 0.4), true);
              }
            }
            if (!sh.pierce) { spent = true; }
            break;
          }
        }
      }
      if (!spent) liveShots.push(sh);
    }
    S.shots = liveShots;
    // -- the sky's answers fly
    const liveBullets = [];
    for (const b of S.ebullets) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -20 || b.x > SCROLL_FIELD.w + 20 || b.y < -20 || b.y > SCROLL_FIELD.h + 20) continue;
      const d = Math.hypot(b.x - S.ship.x, b.y - S.ship.y);
      if (d < SHIP_R + EBULLET_R - 3) {
        if (S.t < S.ghostUntil) { continue; } // the plate eats it, unseen
        S.hull -= b.dmg;
        S.hitsTaken++;
        if (fittedHas('paybackcoil')) S.coil = Math.min(12, S.coil + b.dmg * 0.25);
        if (S.hull <= 0 && !S.outcome) {
          S.hull = 0;
          S.outcome = { result: 'lose', endReason: 'destroyed', at: newT };
        }
        continue;
      }
      if (!b.grazed && d < 34) { b.grazed = true; S.nearMisses++; S.score += 15; }
      liveBullets.push(b);
    }
    S.ebullets = liveBullets;
    // -- rams: hulls that meet, meet honestly
    if (!S.outcome && S.t - S.lastRamAt > 800) {
      for (let i = 0; i < waves.spawns.length; i++) {
        if (S.enemyGone[i] || S.enemyHp[i] <= 0 || waves.spawns[i].at > newEt) continue;
        if (waves.spawns[i].escortPhase && waves.boss && S.bossPhase !== waves.spawns[i].escortPhase) continue;
        const p = scrollEnemyPos(waves.spawns[i], newEt);
        if (!p) continue;
        if (Math.hypot(p.x - S.ship.x, p.y - S.ship.y) < SCROLL_CLASSES[waves.spawns[i].cls].r + SHIP_R - 2) {
          S.enemyHp[i] = 0; killEnemy(i, true);
          if (S.t >= S.ghostUntil) {
            S.hull -= 16; S.hitsTaken++;
            if (fittedHas('paybackcoil')) S.coil = Math.min(12, S.coil + 4);
          }
          S.lastRamAt = S.t;
          if (S.hull <= 0) { S.hull = 0; S.outcome = { result: 'lose', endReason: 'destroyed', at: newT }; }
          break;
        }
      }
    }
    // -- drops fall; a pilot who flies to them, keeps them
    const livePickups = [];
    for (const pk of S.pickups) {
      pk.y += 92 * dt;
      if (Math.hypot(pk.x - S.ship.x, pk.y - S.ship.y) < 32) {
        if (pk.kind === 'hull') S.hull = Math.min(dealt.hullMax, S.hull + 18);
        else if (pk.kind === 'score') S.score += 50;
        else if (pk.kind === 'charge') {
          for (const id of ['overclock', 'tracepurge', 'ghostplate', 'coldsnap']) {
            if (id in S.charges && S.charges[id] < dealt.deploy[id]) { S.charges[id]++; break; }
          }
        }
        continue;
      }
      if (pk.y < SCROLL_FIELD.h + 24) livePickups.push(pk);
    }
    S.pickups = livePickups;
    // -- hulls that fled the field are simply gone; an escort screen
    // whose phase has passed never launched at all
    for (let i = 0; i < waves.spawns.length; i++) {
      if (S.enemyGone[i] || S.enemyHp[i] <= 0) continue;
      const sp = waves.spawns[i];
      if (sp.at > newEt) continue;
      if (sp.escortPhase && waves.boss && S.bossPhase > sp.escortPhase) { S.enemyGone[i] = true; continue; }
      if (scrollEnemyGone(sp, newEt)) S.enemyGone[i] = true;
    }
    // -- trace: loud flying is read; quiet flying cools
    if (S.firing) S.trace = Math.min(100, S.trace + 2.4 * dt * (fittedHas('ashenveil') ? 0.55 : 1));
    else S.trace = Math.max(0, S.trace - 1.2 * dt);
    S.t = newT; S.et = newEt;
    // -- the stretch ends
    if (!S.outcome && newT >= waves.durationMs) {
      if (bossStage) S.outcome = { result: 'lose', endReason: 'timeout', at: newT };
      else S.outcome = { result: 'win', endReason: 'scroll', at: newT };
    }
    return S.problem;
  }

  return {
    state: S,
    waveHpTotal,
    // Advance the replay, applying every action due by time t.
    advanceTo(actions, t) {
      while (!S.outcome && !S.problem && S.t < t) {
        // An action stamped t governs from the step that STARTS at t —
        // never the step that ends there. That is what makes a live,
        // growing log (the client, a planner) replay identically to the
        // finished log the referee judges: an action appended the
        // moment its time comes lands on the same step either way.
        while (S.cursor < actions.length && actions[S.cursor].t <= S.t) {
          const a = actions[S.cursor++];
          if (typeof a.t !== 'number' || a.t < 0) { S.problem = 'bad action time'; return S; }
          const prob = applyAction(a);
          if (prob) { S.problem = prob; return S; }
        }
        step();
      }
      return S;
    }
  };
}

// The referee's whole replay: one log in, one truth out. The shape
// matches simulateRound's contract so the sortie director settles a
// scroll fight exactly as it settles a wheel fight.
function simulateScroll(fight, actions, durationMs) {
  const waves = fight.scroll.waves;
  const list = Array.isArray(actions) ? actions.slice() : [];
  for (const a of list) {
    if (!a || typeof a.t !== 'number' || typeof a.tool !== 'string') {
      return { problem: 'bad action', outcome: null };
    }
  }
  list.sort((a, b) => a.t - b.t);
  const stepper = createScrollStepper(fight);
  const cap = Math.min(Math.max(0, durationMs || 0), waves.durationMs + 1000);
  stepper.advanceTo(list, cap);
  const S = stepper.state;
  if (S.problem) return { problem: S.problem, outcome: null };
  // Actions past the outcome are not crimes; actions that claim the
  // fight continued past its true end are not read at all.
  return {
    problem: null,
    outcome: S.outcome,
    integrityLeft: Math.round(S.hull),
    hullLeft: Math.round(S.hull),
    trace: Math.round(S.trace),
    parries: 0,
    score: S.score, kills: S.kills, nearMisses: S.nearMisses,
    volleys: S.volleys, hitsTaken: S.hitsTaken,
    modsUsed: S.modsUsed, phasesSeen: S.phasesSeen.slice(),
    bossHpLeft: S.bossHp,
    damagePct: stepper.waveHpTotal ? Math.round(S.damageDealt / stepper.waveHpTotal * 100) : 0,
    teachActions: S.teachActions.concat(
      Object.keys(S.modsUsed).map((id, i) => ({ t: 100 + i, tool: 'mod:' + id }))
    )
  };
}

/* SCROLL-MATH-END */

  // ---------- the wheel's furniture (display names; the dealt payload
  // carries the charges and the burn times — the law is the server's) ----
  var DEPLOY_ORDER = ['overclock', 'ghostplate', 'coldsnap', 'tracepurge'];
  var DEPLOY_INFO = {
    overclock: { name: 'OVERCLOCK', short: 'OVERCLOCK', glyph: '»', color: '#00e5ff', blurb: 'the gun cycles faster' },
    ghostplate: { name: 'GHOST PLATE', short: 'GHOST', glyph: '◐', color: '#b967ff', blurb: 'her fire cannot find you' },
    coldsnap: { name: 'COLD SNAP', short: 'SNAP', glyph: '✻', color: '#7df9ff', blurb: 'the whole sky slows' },
    tracepurge: { name: 'TRACE PURGE', short: 'PURGE', glyph: '⌁', color: '#5dffa0', blurb: 'attention burns off — instant' }
  };

  var el = {};
  ['schullbar', 'schulltext', 'scscore', 'scstage', 'sctracebar', 'sctracetext',
   'scrunline', 'scfield', 'scplate', 'scchoice', 'scchoice-text', 'scpress-btn',
   'scwithdraw-btn', 'scstage-msg', 'scverdict', 'scwheel', 'scwheel-label',
   'scactivate', 'scactivate-name', 'scactivate-sub', 'scfire', 'schhaulfeed',
   'scabandonbtn', 'scstartbtn'].forEach(function (id) { el[id] = $(id); });
  if (!el.scfield || !el.scstartbtn) return;
  var ctx = el.scfield.getContext('2d');
  var wctx = el.scwheel.getContext('2d');
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  el.scfield.width = SCROLL_FIELD.w * DPR; el.scfield.height = SCROLL_FIELD.h * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  el.scwheel.width = 148 * DPR; el.scwheel.height = 148 * DPR;
  wctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // ---------- sortie + flight state ---------------------------------------
  var R = { sortieId: null, encounter: 0, score: 0, haul: [], over: false, attention: 0 };
  var F = null; // the live flight
  function newFlight(payload) {
    var waves = payload.scroll.waves, dealt = payload.scroll.dealt;
    var stepper = createScrollStepper({ scroll: { waves: waves, dealt: dealt } });
    return {
      fightId: payload.fightId, waves: waves, dealt: dealt,
      stepper: stepper, sim: stepper.state, log: [],
      firing: false, selected: null, running: true, finishing: false,
      pointer: { active: false, x: 200, y: 560 }, lastSample: null, lastSampleAt: 0,
      acc: 0, lastTs: 0, prevEt: 0, prevShip: { x: 200, y: 540 },
      particles: [], texts: [], shake: 0, hitFlashAt: -9999, plateUntil: 0,
      prevHp: stepper.state.enemyHp.slice(), prevBossHp: stepper.state.bossHp,
      prevHull: stepper.state.hull, prevKills: 0, prevNear: 0, prevHits: 0,
      prevCharges: JSON.stringify(stepper.state.charges), raf: 0
    };
  }

  // ---------- plates, texts, particles ------------------------------------
  function showPlate(kicker, title, line, boss) {
    el.scplate.innerHTML = '<div class="scplate-kicker">' + esc(kicker) + '</div><h2>' +
      esc(title) + '</h2><p>' + esc(line) + '</p>' +
      (boss ? '<div class="scplate-boss">⚠ CAPITAL SIGNATURE — THE HERALD ⚠</div>' : '');
    el.scplate.classList.remove('hidden');
    if (F) F.plateUntil = performance.now() + 2800;
  }
  function hidePlate() { el.scplate.classList.add('hidden'); }
  function floatText(txt, color, x, y, big) {
    if (!F) return;
    F.texts.push({ txt: txt, color: color, x: x, y: y, born: F.sim.t, big: !!big });
    if (F.texts.length > 14) F.texts.shift();
  }
  function explode(x, y, scale, colors) {
    if (!F) return;
    var n = Math.round(14 * scale);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 240 * scale;
      F.particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
        life: 0.5 + Math.random() * 0.7, age: 0, r: 1.5 + Math.random() * 3 * scale,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
    F.particles.push({ ring: true, x: x, y: y, age: 0, life: 0.4, r: 6 * scale, vr: 260 * scale, color: colors[0] });
    if (F.particles.length > 320) F.particles.splice(0, F.particles.length - 320);
  }

  // ---------- HUD ----------------------------------------------------------
  function updateHud() {
    if (!F) return;
    var s = F.sim, d = F.dealt;
    var pct = Math.max(0, Math.round(s.hull / d.hullMax * 100));
    el.schullbar.style.width = pct + '%';
    el.schullbar.style.background = pct > 50 ? '#5dffa0' : pct > 25 ? '#ffd24a' : '#ff5a4c';
    el.schulltext.textContent = Math.max(0, Math.round(s.hull)) + ' / ' + d.hullMax;
    el.sctracetext.textContent = Math.round(s.trace) + '%';
    el.sctracebar.style.width = Math.min(100, Math.round(s.trace)) + '%';
    el.scscore.textContent = String(R.score + s.score);
    updateRunLine();
    drawWheel();
    updateActivate();
  }
  function updateRunLine() {
    if (!F) return;
    el.scrunline.textContent = 'Stage ' + F.waves.stage.n + ' of 8 · ' + F.waves.stage.name +
      ' · Score ' + (R.score + F.sim.score) + ' · Carrying ' +
      (R.haul.length ? R.haul.length + ' unbanked piece' + (R.haul.length === 1 ? '' : 's') : 'nothing');
  }
  function renderHaul() {
    if (!R.haul.length) {
      el.schhaulfeed.innerHTML = '<li class="dim">Empty hold. The Reach provides.</li>';
      return;
    }
    el.schhaulfeed.innerHTML = R.haul.map(function (p) {
      return '<li><span class="tierbadge t-' + String(p.tier || '').toLowerCase() + '">' +
        esc(p.name) + ' (' + esc(p.tier || '') + (p.serial ? ' No. ' + p.serial : '') + ')</span></li>';
    }).join('');
  }

  // ---------- the fly wheel + ACTIVATE -------------------------------------
  function burning(id) {
    if (!F) return 0;
    var s = F.sim, now = s.t;
    if (id === 'overclock') return Math.max(0, s.overclockUntil - now);
    if (id === 'ghostplate') return Math.max(0, s.ghostUntil - now);
    if (id === 'coldsnap') return Math.max(0, s.snapUntil - now);
    return 0;
  }
  function drawWheel() {
    var W = 148, C = W / 2, R0 = 26, R1 = 70;
    wctx.clearRect(0, 0, W, W);
    for (var i = 0; i < 4; i++) {
      var id = DEPLOY_ORDER[i], info = DEPLOY_INFO[id];
      var a0 = -Math.PI / 2 + i * Math.PI / 2 - Math.PI / 4 + 0.06;
      var a1 = -Math.PI / 2 + i * Math.PI / 2 + Math.PI / 4 - 0.06;
      var charges = F ? F.sim.charges[id] : (F ? 0 : 2);
      var burn = burning(id);
      var spent = F && charges <= 0 && burn <= 0;
      wctx.beginPath();
      wctx.arc(C, C, R1, a0, a1); wctx.arc(C, C, R0, a1, a0, true); wctx.closePath();
      var sel = F && F.selected === id;
      wctx.fillStyle = spent ? 'rgba(40,44,60,.55)' : sel ? info.color + '55' : 'rgba(16,20,38,.88)';
      wctx.fill();
      wctx.strokeStyle = sel ? info.color : 'rgba(140,160,220,.35)';
      wctx.lineWidth = sel ? 2 : 1;
      wctx.stroke();
      if (burn > 0 && F) {
        var frac = burn / (F.dealt.modTimes[id] || 1);
        wctx.beginPath();
        wctx.arc(C, C, R1 - 4, a0, a0 + (a1 - a0) * frac);
        wctx.strokeStyle = '#ffd24a'; wctx.lineWidth = 3; wctx.stroke();
      }
      var mx = C + Math.cos((a0 + a1) / 2) * (R0 + R1) / 2, my = C + Math.sin((a0 + a1) / 2) * (R0 + R1) / 2;
      wctx.fillStyle = spent ? '#5a6378' : info.color;
      wctx.font = '17px serif'; wctx.textAlign = 'center'; wctx.textBaseline = 'middle';
      wctx.fillText(info.glyph, mx, my - 5);
      // charge pips
      var max = F ? 2 : 2;
      for (var p = 0; p < max; p++) {
        wctx.beginPath();
        wctx.arc(mx - 6 + p * 12, my + 11, 2.6, 0, Math.PI * 2);
        wctx.fillStyle = F && p < charges ? info.color : 'rgba(120,130,160,.35)';
        wctx.fill();
      }
    }
    wctx.beginPath(); wctx.arc(C, C, R0 - 3, 0, Math.PI * 2);
    wctx.fillStyle = 'rgba(10,12,26,.92)'; wctx.fill();
    wctx.strokeStyle = 'rgba(140,160,220,.3)'; wctx.lineWidth = 1; wctx.stroke();
    wctx.fillStyle = '#cfd6ff'; wctx.font = '700 9px sans-serif'; wctx.textAlign = 'center'; wctx.textBaseline = 'middle';
    var label = F && F.selected ? DEPLOY_INFO[F.selected].short : 'SYS';
    wctx.fillText(label, C, C);
    el['scwheel-label'].textContent = F && F.selected ? DEPLOY_INFO[F.selected].name :
      (F ? 'SPIN · CHOOSE A SYSTEM' : 'SYSTEMS');
  }
  function updateActivate() {
    if (!F || !F.running) { el.scactivate.disabled = true; return; }
    var id = F.selected, info = id ? DEPLOY_INFO[id] : null;
    var burn = id ? burning(id) : 0;
    if (!id) {
      el.scactivate.disabled = true;
      el['scactivate-name'].textContent = 'ACTIVATE';
      el['scactivate-sub'].textContent = 'spin the wheel';
      el.scactivate.className = 'scactivate';
    } else if (burn > 0) {
      el.scactivate.disabled = true;
      el['scactivate-name'].textContent = info.name;
      el['scactivate-sub'].textContent = 'burning — ' + (burn / 1000).toFixed(1) + 's';
      el.scactivate.className = 'scactivate burning';
    } else if (F.sim.charges[id] > 0) {
      el.scactivate.disabled = false;
      el['scactivate-name'].textContent = 'ACTIVATE';
      el['scactivate-sub'].textContent = info.name + ' · ' +
        (F.dealt.modTimes[id] ? (F.dealt.modTimes[id] / 1000) + 's · ' : 'instant · ') +
        F.sim.charges[id] + ' charge' + (F.sim.charges[id] === 1 ? '' : 's');
      el.scactivate.className = 'scactivate armed';
    } else {
      el.scactivate.disabled = true;
      el['scactivate-name'].textContent = info.name;
      el['scactivate-sub'].textContent = 'charges spent';
      el.scactivate.className = 'scactivate';
    }
  }
  el.scwheel.addEventListener('pointerdown', function (ev) {
    if (!F || !F.running) return;
    var r = el.scwheel.getBoundingClientRect();
    var x = (ev.clientX - r.left) / r.width * 148 - 74, y = (ev.clientY - r.top) / r.height * 148 - 74;
    var dist = Math.hypot(x, y);
    if (dist < 24 || dist > 76) return;
    var ang = Math.atan2(y, x); // -PI..PI; wedges centered at -90,0,90,180 deg
    var idx = Math.round((ang + Math.PI / 2) / (Math.PI / 2)) % 4;
    if (idx < 0) idx += 4;
    F.selected = DEPLOY_ORDER[idx];
    sfx('click');
    drawWheel(); updateActivate();
  });
  el.scactivate.addEventListener('click', function () {
    if (!F || !F.running || !F.selected) return;
    var id = F.selected;
    if (F.sim.charges[id] <= 0 || burning(id) > 0) { sfx('deny'); return; }
    F.log.push({ t: F.sim.t, tool: 'mod:' + id });
    var info = DEPLOY_INFO[id];
    floatText(info.name + (F.dealt.modTimes[id] ? ' — ' + (F.dealt.modTimes[id] / 1000) + 's' : ''),
      info.color, F.sim.ship.x, F.sim.ship.y - 40, true);
    sfx('modfire');
    // the local sim applies the activation on its next step; the wheel
    // answers on the referee's preview, which is the same math.
    updateActivate();
  });

  // ---------- flight input --------------------------------------------------
  function fieldCoords(ev) {
    var r = el.scfield.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width * SCROLL_FIELD.w,
      y: (ev.clientY - r.top) / r.height * SCROLL_FIELD.h
    };
  }
  el.scfield.addEventListener('pointerdown', function (ev) {
    if (!F || !F.running) return;
    ev.preventDefault();
    try { el.scfield.setPointerCapture(ev.pointerId); } catch (e) {}
    var p = fieldCoords(ev);
    F.pointer.active = true; F.pointer.x = p.x; F.pointer.y = p.y;
  });
  el.scfield.addEventListener('pointermove', function (ev) {
    if (!F || !F.pointer.active) return;
    var p = fieldCoords(ev);
    F.pointer.x = p.x; F.pointer.y = p.y;
  });
  function pointerEnd() { if (F) F.pointer.active = false; }
  el.scfield.addEventListener('pointerup', pointerEnd);
  el.scfield.addEventListener('pointercancel', pointerEnd);

  function setFiring(on) {
    if (!F || !F.running) return;
    if (F.firing === on) return;
    F.firing = on;
    F.log.push({ t: F.sim.t, tool: 'fire', on: on });
    el.scfire.classList.toggle('firing', on);
  }
  el.scfire.addEventListener('pointerdown', function (ev) { ev.preventDefault(); setFiring(true); });
  el.scfire.addEventListener('pointerup', function () { setFiring(false); });
  el.scfire.addEventListener('pointerleave', function () { setFiring(false); });
  el.scfire.addEventListener('pointercancel', function () { setFiring(false); });
  window.addEventListener('keydown', function (ev) {
    if (ev.code === 'Space') { ev.preventDefault(); setFiring(true); }
  });
  window.addEventListener('keyup', function (ev) {
    if (ev.code === 'Space') setFiring(false);
  });

  // ---------- fx from sim deltas --------------------------------------------
  function spawnFx() {
    var s = F.sim;
    for (var i = 0; i < s.enemyHp.length; i++) {
      if (F.prevHp[i] > 0 && s.enemyHp[i] <= 0) {
        var sp = F.waves.spawns[i];
        var p = scrollEnemyPos(sp, s.et);
        var def = SCROLL_CLASSES[sp.cls];
        explode(p.x, Math.max(10, p.y), sp.cls === 'carrier' || sp.cls === 'gunship' ? 1.5 : 1,
          ['#ff9a3c', '#ff2a3c', '#fcee0a', '#ffffff']);
        floatText('+' + def.score, '#ffd166', p.x, Math.max(20, p.y));
        sfx(sp.cls === 'carrier' ? 'crack3' : 'crack1');
        F.shake = Math.min(10, F.shake + (sp.cls === 'carrier' ? 5 : 2));
      }
    }
    F.prevHp = s.enemyHp.slice();
    if (F.prevBossHp > 0 && s.bossHp <= 0 && F.waves.boss) {
      var hp = scrollHeraldPos(s.et);
      explode(hp.x, hp.y, 3.2, ['#ff9a3c', '#ff2a3c', '#fcee0a', '#c99aff', '#ffffff']);
      explode(hp.x - 50, hp.y + 16, 2, ['#ff9a3c', '#ffffff']);
      explode(hp.x + 50, hp.y + 16, 2, ['#ff9a3c', '#ffffff']);
      F.shake = 16;
      sfx('boss');
    }
    if (s.bossHp < F.prevBossHp) F.prevBossHp = s.bossHp;
    if (s.hitsTaken > F.prevHits) {
      F.prevHits = s.hitsTaken;
      F.hitFlashAt = performance.now();
      F.shake = Math.min(12, F.shake + 4);
      sfx('hit');
    }
    if (s.nearMisses > F.prevNear) {
      F.prevNear = s.nearMisses;
      floatText('CLOSE +15', '#7df9ff', s.ship.x, s.ship.y - 34);
    }
    if (s.hull > F.prevHull + 0.5) floatText('+' + Math.round(s.hull - F.prevHull) + ' HULL', '#5dffa0', s.ship.x, s.ship.y - 30);
    F.prevHull = s.hull;
    var ch = JSON.stringify(s.charges);
    if (ch !== F.prevCharges) {
      var before = JSON.parse(F.prevCharges);
      for (var id in s.charges) {
        if (s.charges[id] > (before[id] || 0)) floatText('CHARGE +1 — ' + DEPLOY_INFO[id].name, '#ffd24a', s.ship.x, s.ship.y - 52);
      }
      F.prevCharges = ch;
    }
    var phaseNow = s.bossPhase;
    if (F.lastPhase == null) F.lastPhase = phaseNow;
    if (phaseNow > F.lastPhase) {
      F.lastPhase = phaseNow;
      showPlate('THE HERALD', phaseNow === 2 ? 'HER TURRETS OPEN' : 'HER CORE BURNS OPEN',
        phaseNow === 2 ? 'Spread fire. The escorts come faster now.' : 'The desperation pattern — radial fire. Stay moving.', true);
      sfx('boss');
    }
  }

  // ---------- drawing ---------------------------------------------------------
  function hash2(a, b) { return hash01(a * 7919 + b * 131); }
  function drawGround(etDisp) {
    var pal = F.waves.stage.palette, W = SCROLL_FIELD.w, H = SCROLL_FIELD.h;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal.sky0); g.addColorStop(1, pal.sky1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // far stars / embers
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    var soff = etDisp * 0.012;
    for (var i = 0; i < 26; i++) {
      var sx = hash2(i, 7) * W, sy = (hash2(i, 13) * (H + 40) + soff) % (H + 40) - 20;
      ctx.globalAlpha = 0.25 + hash2(i, 3) * 0.5;
      ctx.fillRect(sx, sy, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
    drawLayer(etDisp * 0.05, 150, pal.ground, 0.55, 11);
    drawLayer(etDisp * 0.115, 96, pal.feature, 0.9, 23);
    // the Reach's river-road, winding through every motif
    ctx.strokeStyle = pal.water; ctx.globalAlpha = 0.5; ctx.lineWidth = 26;
    ctx.beginPath();
    for (var y = -20; y <= H + 20; y += 24) {
      var cxp = W / 2 + Math.sin((y + etDisp * 0.115) / 210) * 88;
      if (y === -20) ctx.moveTo(cxp, y); else ctx.lineTo(cxp, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }
  function drawLayer(off, spacing, color, alpha, seed) {
    var W = SCROLL_FIELD.w, H = SCROLL_FIELD.h, motif = F.waves.stage.motif;
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.globalAlpha = alpha;
    var first = Math.floor(off / spacing);
    for (var k = -1; k < H / spacing + 2; k++) {
      var idx = first + k;
      var y = idx * spacing - off + spacing;
      var x = hash2(idx, seed) * (W - 60) + 30;
      var s = 0.6 + hash2(idx, seed + 5) * 0.9;
      ctx.beginPath();
      if (motif === 'spires') {
        ctx.moveTo(x - 16 * s, y + 30 * s); ctx.lineTo(x, y - 44 * s); ctx.lineTo(x + 16 * s, y + 30 * s); ctx.closePath(); ctx.fill();
      } else if (motif === 'grid') {
        ctx.strokeRect(x - 20 * s, y - 14 * s, 40 * s, 28 * s);
        ctx.beginPath(); ctx.moveTo(x - 20 * s, y); ctx.lineTo(x + 20 * s, y); ctx.stroke();
      } else if (motif === 'flats') {
        ctx.ellipse(x, y, 34 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
      } else if (motif === 'rifts') {
        ctx.moveTo(x - 22 * s, y); ctx.lineTo(x - 6 * s, y - 16 * s); ctx.lineTo(x + 8 * s, y + 6 * s); ctx.lineTo(x + 22 * s, y - 10 * s); ctx.stroke();
      } else if (motif === 'dunes') {
        ctx.ellipse(x, y, 44 * s, 12 * s, 0, Math.PI, Math.PI * 2); ctx.fill();
      } else if (motif === 'wrecks') {
        ctx.save(); ctx.translate(x, y); ctx.rotate(hash2(idx, seed + 9) * 1.2 - 0.6);
        ctx.strokeRect(-24 * s, -8 * s, 48 * s, 16 * s);
        ctx.beginPath(); ctx.moveTo(-24 * s, 0); ctx.lineTo(24 * s, 0); ctx.stroke();
        ctx.restore();
      } else { // throne — the Herald's court: rings and pillars
        ctx.arc(x, y, 16 * s, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 7 * s, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawShipShape(x, y, trim, scale, ghost, flame) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    if (ghost) ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 90) * 0.2;
    if (flame) {
      var fl = 8 + Math.random() * 7;
      ctx.fillStyle = '#ff9a3c';
      ctx.beginPath(); ctx.moveTo(-4, 14); ctx.lineTo(0, 14 + fl); ctx.lineTo(4, 14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fcee0a';
      ctx.beginPath(); ctx.moveTo(-2, 14); ctx.lineTo(0, 14 + fl * 0.55); ctx.lineTo(2, 14); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#1b2438';
    ctx.strokeStyle = trim; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -16); ctx.lineTo(5, -4); ctx.lineTo(15, 10); ctx.lineTo(15, 14); ctx.lineTo(5, 12);
    ctx.lineTo(0, 15); ctx.lineTo(-5, 12); ctx.lineTo(-15, 14); ctx.lineTo(-15, 10); ctx.lineTo(-5, -4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = trim;
    ctx.beginPath(); ctx.ellipse(0, -5, 3, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (ghost) {
      ctx.save();
      ctx.strokeStyle = 'rgba(185,103,255,.75)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  function drawEnemy(sp, p, hpFrac, flash) {
    var def = SCROLL_CLASSES[sp.cls];
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = flash ? '#ffffff' : '#231128';
    ctx.strokeStyle = flash ? '#ffffff' : F.waves.stage.palette.accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (sp.cls === 'dart') {
      ctx.moveTo(0, 12); ctx.lineTo(6, -2); ctx.lineTo(11, -9); ctx.lineTo(0, -5); ctx.lineTo(-11, -9); ctx.lineTo(-6, -2); ctx.closePath();
    } else if (sp.cls === 'weaver') {
      ctx.moveTo(0, 10); ctx.lineTo(16, -8); ctx.lineTo(7, -11); ctx.lineTo(0, -5); ctx.lineTo(-7, -11); ctx.lineTo(-16, -8); ctx.closePath();
    } else if (sp.cls === 'flanker') {
      ctx.moveTo(9, 0); ctx.lineTo(-6, -10); ctx.lineTo(-11, 0); ctx.lineTo(-6, 10); ctx.closePath();
    } else if (sp.cls === 'gunship') {
      ctx.moveTo(0, 14); ctx.lineTo(13, 6); ctx.lineTo(17, -8); ctx.lineTo(6, -14); ctx.lineTo(-6, -14); ctx.lineTo(-17, -8); ctx.lineTo(-13, 6); ctx.closePath();
    } else {
      ctx.moveTo(0, 20); ctx.lineTo(10, 8); ctx.lineTo(12, -14); ctx.lineTo(5, -21); ctx.lineTo(-5, -21); ctx.lineTo(-12, -14); ctx.lineTo(-10, 8); ctx.closePath();
    }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = F.waves.stage.palette.accent;
    ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    if (sp.cls === 'carrier') {
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(-8, -18, 3, 3); ctx.fillRect(5, -18, 3, 3);
    }
    ctx.restore();
    if (hpFrac < 1) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(p.x - 14, p.y - def.r - 9, 28, 3.4);
      ctx.fillStyle = hpFrac > 0.4 ? '#5dffa0' : '#ff5a4c';
      ctx.fillRect(p.x - 14, p.y - def.r - 9, 28 * Math.max(0, hpFrac), 3.4);
    }
    if (hpFrac < 0.45 && Math.random() < 0.3 && F) {
      F.particles.push({ x: p.x + (Math.random() - 0.5) * 14, y: p.y - 6, vx: 0, vy: -26, life: 0.7, age: 0, r: 3.5, color: 'rgba(90,90,100,.8)', smoke: true });
    }
  }
  function drawHerald(etDisp) {
    var s = F.sim;
    if (!F.waves.boss || s.bossHp <= 0) return;
    var hp = scrollHeraldPos(etDisp);
    var frac = s.bossHp / F.waves.boss.hp;
    var phase = scrollHeraldPhase(s.bossHp, F.waves.boss.hp);
    ctx.save(); ctx.translate(hp.x, hp.y);
    // hull — the biggest thing on the field, a throne with wings
    var grad = ctx.createLinearGradient(0, -46, 0, 52);
    grad.addColorStop(0, '#2a1030'); grad.addColorStop(1, '#12081c');
    ctx.fillStyle = grad;
    ctx.strokeStyle = phase === 3 ? '#ff5a4c' : '#c99aff'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 52); ctx.lineTo(30, 30); ctx.lineTo(74, 34); ctx.lineTo(86, -6); ctx.lineTo(52, -30);
    ctx.lineTo(26, -44); ctx.lineTo(-26, -44); ctx.lineTo(-52, -30); ctx.lineTo(-86, -6); ctx.lineTo(-74, 34);
    ctx.lineTo(-30, 30); ctx.closePath(); ctx.fill(); ctx.stroke();
    // turret nubs
    ctx.fillStyle = '#3a1a4a';
    [-HERALD_DEF.coreDx, HERALD_DEF.coreDx].forEach(function (dx) {
      ctx.beginPath(); ctx.arc(dx, HERALD_DEF.coreDy, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    // cores — they burn brighter as she weakens
    var pulse = 0.6 + Math.sin(performance.now() / (phase === 3 ? 90 : 200)) * 0.4;
    [-HERALD_DEF.coreDx, HERALD_DEF.coreDx].forEach(function (dx) {
      var coreG = ctx.createRadialGradient(dx, HERALD_DEF.coreDy, 1, dx, HERALD_DEF.coreDy, HERALD_DEF.coreR);
      coreG.addColorStop(0, 'rgba(255,238,160,' + (0.75 + pulse * 0.25) + ')');
      coreG.addColorStop(0.5, 'rgba(255,120,60,.75)');
      coreG.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = coreG;
      ctx.beginPath(); ctx.arc(dx, HERALD_DEF.coreDy, HERALD_DEF.coreR, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#ffe9d2';
    ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('THE HERALD', 0, -52);
    if (phase >= 2) { // damage state: scoring and smoke
      ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-40, -20); ctx.lineTo(-12, 4); ctx.lineTo(-30, 26); ctx.stroke();
      if (Math.random() < 0.4) {
        F.particles.push({ x: hp.x - 30 + Math.random() * 60, y: hp.y - 20, vx: 0, vy: -30, life: 0.9, age: 0, r: 5, color: 'rgba(70,60,80,.8)', smoke: true });
      }
    }
    if (phase === 3) {
      ctx.beginPath(); ctx.moveTo(18, -34); ctx.lineTo(4, -6); ctx.lineTo(26, 18); ctx.stroke();
    }
    ctx.restore();
    // herald health bar
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(30, 12, SCROLL_FIELD.w - 60, 7);
    ctx.fillStyle = phase === 3 ? '#ff5a4c' : phase === 2 ? '#ff9a3c' : '#c99aff';
    ctx.fillRect(30, 12, (SCROLL_FIELD.w - 60) * Math.max(0, frac), 7);
  }
  function draw() {
    if (!F) return;
    var s = F.sim;
    var f = Math.min(1, F.acc / SCROLL_STEP_MS);
    var etDisp = F.prevEt + (s.et - F.prevEt) * f;
    ctx.save();
    if (F.shake > 0.3) ctx.translate((Math.random() - 0.5) * F.shake, (Math.random() - 0.5) * F.shake);
    drawGround(etDisp);
    drawHerald(etDisp);
    // pickups
    for (var i = 0; i < s.pickups.length; i++) {
      var pk = s.pickups[i];
      ctx.save(); ctx.translate(pk.x, pk.y);
      ctx.fillStyle = 'rgba(8,10,24,.85)';
      ctx.strokeStyle = pk.kind === 'hull' ? '#5dffa0' : pk.kind === 'charge' ? '#ffd24a' : '#7df9ff';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, 10 + Math.sin(performance.now() / 160) * 1.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      if (pk.kind === 'hull') { ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-6, -2, 12, 4); }
      else if (pk.kind === 'charge') {
        ctx.beginPath(); ctx.moveTo(2, -7); ctx.lineTo(-4, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 7); ctx.lineTo(4, -1); ctx.lineTo(0, -1); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 0); ctx.lineTo(0, 7); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // enemies
    for (var e = 0; e < F.waves.spawns.length; e++) {
      if (s.enemyGone[e] || s.enemyHp[e] <= 0 || F.waves.spawns[e].at > etDisp) continue;
      var sp = F.waves.spawns[e];
      if (sp.escortPhase && s.bossHp > 0 && scrollHeraldPhase(s.bossHp, F.waves.boss.hp) < sp.escortPhase) continue;
      var p = scrollEnemyPos(sp, etDisp);
      if (!p || p.y < -60 || p.y > SCROLL_FIELD.h + 60) continue;
      drawEnemy(sp, p, s.enemyHp[e] / SCROLL_CLASSES[sp.cls].hp, false);
    }
    // bullets — enemy orbs first, then the pilot's tracers
    for (var b = 0; b < s.ebullets.length; b++) {
      var eb = s.ebullets[b];
      ctx.fillStyle = '#ff2a6d';
      ctx.beginPath(); ctx.arc(eb.x, eb.y, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,120,170,.35)';
      ctx.beginPath(); ctx.arc(eb.x, eb.y, 6.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = F.dealt.fitted.emberline ? '#ff7a3c' : '#ffd24a';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (var pb = 0; pb < s.shots.length; pb++) {
      var shot = s.shots[pb];
      ctx.moveTo(shot.x, shot.y + 15);
      ctx.lineTo(shot.x, shot.y);
    }
    ctx.stroke();
    // wings + the pilot
    var shipX = F.prevShip.x + (s.ship.x - F.prevShip.x) * f;
    var shipY = F.prevShip.y + (s.ship.y - F.prevShip.y) * f;
    var ghost = s.ghostUntil > s.t;
    if (F.dealt.wings >= 1) drawShipShape(shipX - 27, shipY + 7, F.dealt.trim, 0.62, ghost, true);
    if (F.dealt.wings >= 2) drawShipShape(shipX + 27, shipY + 7, F.dealt.trim, 0.62, ghost, true);
    drawShipShape(shipX, shipY, F.dealt.trim, 1, ghost, true);
    // particles
    for (var q = 0; q < F.particles.length; q++) {
      var pt = F.particles[q];
      var al = Math.max(0, 1 - pt.age / pt.life);
      if (pt.ring) {
        ctx.strokeStyle = pt.color; ctx.globalAlpha = al;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r + pt.vr * pt.age, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.globalAlpha = pt.smoke ? al * 0.6 : al;
        ctx.fillStyle = pt.color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r * (pt.smoke ? 1 + pt.age : 1), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // floating texts
    ctx.textAlign = 'center';
    for (var t = 0; t < F.texts.length; t++) {
      var ft = F.texts[t];
      var age = (s.t - ft.born) / 1000;
      ctx.globalAlpha = Math.max(0, 1 - age / 1.15);
      ctx.fillStyle = ft.color;
      ctx.font = (ft.big ? '700 14px' : '700 11px') + ' sans-serif';
      ctx.fillText(ft.txt, ft.x, ft.y - age * 30);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // hit vignette
    var sinceHit = performance.now() - F.hitFlashAt;
    if (sinceHit < 220) {
      ctx.fillStyle = 'rgba(255,40,40,' + (0.26 * (1 - sinceHit / 220)) + ')';
      ctx.fillRect(0, 0, SCROLL_FIELD.w, SCROLL_FIELD.h);
    }
    if (ghost) {
      ctx.strokeStyle = 'rgba(185,103,255,.4)'; ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, SCROLL_FIELD.w - 3, SCROLL_FIELD.h - 3);
    }
  }

  // ---------- the flight loop -------------------------------------------------
  function frame(ts) {
    if (!F || !F.running) return;
    if (!F.lastTs) F.lastTs = ts;
    var dt = Math.min(100, ts - F.lastTs);
    F.lastTs = ts;
    F.acc += dt;
    F.prevEt = F.sim.et;
    F.prevShip = { x: F.sim.ship.x, y: F.sim.ship.y };
    var guard = 0;
    while (F.acc >= SCROLL_STEP_MS && !F.sim.outcome && !F.sim.problem && guard++ < 8) {
      // sample the thumb: the ship rides above it; samples are the log
      if (F.pointer.active) {
        var tx = Math.max(18, Math.min(SCROLL_FIELD.w - 18, Math.round(F.pointer.x)));
        var ty = Math.max(250, Math.min(SCROLL_FIELD.h - 22, Math.round(F.pointer.y - 74)));
        var last = F.lastSample;
        if (!last || Math.hypot(tx - last.x, ty - last.y) > 5 || F.sim.t - F.lastSampleAt >= 140) {
          F.log.push({ t: F.sim.t, tool: 'mv', x: tx, y: ty });
          F.lastSample = { x: tx, y: ty };
          F.lastSampleAt = F.sim.t;
        }
      }
      F.stepper.advanceTo(F.log, F.sim.t + SCROLL_STEP_MS);
      F.acc -= SCROLL_STEP_MS;
      spawnFx();
    }
    // particles age on real time
    for (var i = F.particles.length - 1; i >= 0; i--) {
      var pt = F.particles[i];
      pt.age += dt / 1000;
      if (!pt.ring) { pt.x += pt.vx * dt / 1000; pt.y += pt.vy * dt / 1000; }
      if (pt.age >= pt.life) F.particles.splice(i, 1);
    }
    F.texts = F.texts.filter(function (ft) { return F.sim.t - ft.born < 1200; });
    if (F.shake > 0) F.shake *= Math.pow(0.0015, dt / 1000);
    if (F.plateUntil && ts > F.plateUntil) { hidePlate(); F.plateUntil = 0; }
    draw();
    updateHud();
    if (F.sim.outcome || F.sim.problem) { finishFlight(); return; }
    F.raf = requestAnimationFrame(frame);
  }

  // ---------- sortie flow ------------------------------------------------------
  function beginFlight(payload) {
    R.sortieId = payload.galactic.sortieId;
    R.encounter = payload.galactic.encounter;
    R.attention = payload.galactic.attention;
    F = newFlight(payload);
    el['scstage-msg'].classList.add('hidden');
    el.scverdict.classList.add('hidden');
    el.scchoice.classList.add('hidden');
    el.scabandonbtn.classList.remove('hidden');
    el.scfire.disabled = false;
    el.scstage.textContent = 'STAGE ' + F.waves.stage.n + ' — ' + F.waves.stage.name;
    showPlate('STAGE ' + F.waves.stage.n + ' OF 8 · SECTOR 1', F.waves.stage.name,
      F.waves.stage.line, !!F.waves.boss);
    sfx(F.waves.boss ? 'boss' : 'begin');
    if (SFX && SFX.humStart) { try { SFX.humStart(); } catch (e) {} }
    updateHud();
    F.raf = requestAnimationFrame(frame);
  }
  function stopFlight() {
    if (F) { F.running = false; if (F.raf) cancelAnimationFrame(F.raf); }
    if (SFX && SFX.humStop) { try { SFX.humStop(); } catch (e) {} }
    el.scfire.disabled = true;
    el.scactivate.disabled = true;
  }
  function finishFlight() {
    if (!F || F.finishing) return;
    F.finishing = true;
    var sim = F.sim;
    setFiring(false);
    stopFlight();
    var dur = sim.outcome ? sim.outcome.at : sim.t;
    post('/api/fight/finish', { fightId: F.fightId, actions: F.log, durationMs: dur })
      .then(function (res) {
        var d = res.body;
        if (d.voided) { R.over = true; showSortieVerdict(d.verdict, 'void'); return; }
        var dd = d.galactic || {};
        R.score = dd.score != null ? dd.score : R.score;
        if (dd.sectorCleared) { R.haul = []; renderHaul(); }
        if (dd.drops && dd.drops.length) {
          dd.drops.forEach(function (p) {
            R.haul.push(p);
            floatText('LOOT — ' + p.name, '#ffd166', 200, 300, true);
          });
          renderHaul();
        }
        if (dd.mods && dd.mods.length) {
          dd.mods.forEach(function (m) { floatText('MOD RECOVERED — ' + m.name, '#5dffa0', 200, 340, true); });
        }
        if (dd.over) { R.over = true; showSortieVerdict(d.verdict, sim.outcome ? sim.outcome.endReason : ''); return; }
        // the hinge: press on, or bank it all
        var nextDef = SCROLL_STAGES[R.encounter] || { name: 'the deep sky' };
        el['scchoice-text'].textContent = 'Stage ' + R.encounter + ' is cleared. You carry ' +
          R.haul.length + ' unbanked piece' + (R.haul.length === 1 ? '' : 's') +
          ' · hull ' + dd.integrity + ' · attention ' + dd.trace + '%. Ahead is Stage ' +
          (R.encounter + 1) + ' — ' + nextDef.name + '. Withdraw, and everything you carry is yours for good.';
        el.scchoice.classList.remove('hidden');
        sfx('gatechoice');
        updateRunLine();
      })
      .catch(function () { showSortieVerdict(null, ''); });
  }
  function choose(choice) {
    el.scchoice.classList.add('hidden');
    sfx(choice === 'press' ? 'descend' : 'ascend');
    post('/api/galactic/choose', { sortieId: R.sortieId, choice: choice })
      .then(function (res) {
        if (res.status !== 200) { el.scchoice.classList.remove('hidden'); return; }
        if (choice === 'withdraw') { R.over = true; showSortieVerdict(res.body.verdict, 'withdraw'); return; }
        beginFlight(res.body);
      })
      .catch(function () { el.scchoice.classList.remove('hidden'); });
  }
  el['scpress-btn'].addEventListener('click', function () { choose('press'); });
  el['scwithdraw-btn'].addEventListener('click', function () { choose('withdraw'); });
  el.scabandonbtn.addEventListener('click', function () {
    if (!R.sortieId) return;
    stopFlight();
    post('/api/galactic/abandon', { sortieId: R.sortieId })
      .then(function (res) { R.over = true; showSortieVerdict(res.body.verdict, 'withdraw'); })
      .catch(function () { showSortieVerdict(null, ''); });
  });
  el.scstartbtn.addEventListener('click', function () {
    if (SFX && SFX.unlock) { try { SFX.unlock(); } catch (e) {} }
    el.scstartbtn.disabled = true;
    post('/api/galactic/start', { form: 'scroll' })
      .then(function (res) {
        el.scstartbtn.disabled = false;
        var d = res.body;
        if (res.status !== 200 || !d.scroll) {
          el['scstage-msg'].querySelector('h2').textContent = d.message || 'The sky would not open.';
          return;
        }
        R.score = 0; R.haul = []; R.over = false;
        renderHaul();
        beginFlight(d);
      })
      .catch(function () { el.scstartbtn.disabled = false; });
  });

  function showSortieVerdict(v, localReason) {
    stopFlight();
    el.scchoice.classList.add('hidden');
    el.scabandonbtn.classList.add('hidden');
    var html;
    if (!v) {
      html = '<div class="vcard"><h2>THE SORTIE IS LOST TO THE DARK</h2><p class="dim">The verdict could not be recorded.</p><a class="fightbtn small" href="/galactic/fly?form=scroll">Fly again</a></div>';
    } else {
      var gv = v.galactic || {};
      var titles = { death: 'DESTROYED IN THE REACH', withdraw: 'YOU WITHDREW — THE HAUL IS YOURS', cleared: '★ SECTOR CLEARED — THE HERALD FALLS', turned: 'TURNED BACK FROM THE REACH', void: 'SORTIE VOIDED' };
      var title = titles[v.endReason] || (v.result === 'win' ? 'YOU WITHDREW' : 'TURNED BACK');
      var banked = (gv.banked || []).map(function (bp) {
        return '<span class="tierbadge t-' + String(bp.tier || '').toLowerCase() + '">' + esc(bp.name) + ' (' + esc(bp.tier || '') + (bp.serial ? ' No. ' + bp.serial : '') + ')</span>';
      }).join(' ');
      var lost = (gv.lost || []).map(function (bp) { return esc(bp.name) + ' (' + esc(bp.tier || '') + ')'; }).join(' · ');
      var hook = gv.sectorCleared ?
        '<p class="v-name">✦ <strong>THE RELAY GOES DARK — AND SOMETHING BEYOND IT LOOKS UP.</strong> The Herald was never the Reach\'s master; it was a relay, repeating your shape to a deeper book. That book has your name in it now. On the chart, Sector 2\'s lock has changed its face: <strong>THE LEDGER HAS YOUR NAME NOW.</strong></p>' +
        (gv.firstClear ? '<p class="v-name">🖋 <strong>THE LEDGER\'S SEAL</strong> stands on this receipt — the tie-in mark of the first clearing, carried in the books beside your name and the date.</p>' : '') : '';
      html = '<div class="vcard ' + (v.result === 'win' ? 'win' : '') + '">' +
        '<h2>' + title + '</h2>' +
        '<p class="v-name">' + (localReason === 'void' ? 'That sortie\'s log did not hold up — remembered, but it taught nothing and earned nothing. ' : '') +
        'Stages cleared ' + (gv.encountersCleared || 0) + ' · deepest Stage ' + (gv.deepest || 0) + ' · score ' + (gv.score || 0) + ' · capitals slain ' + (gv.capitalsSlain || 0) + '</p>' +
        (gv.sectorCleared ? '<p class="v-name">★ <strong>SECTOR 1 — EMBERFALL REACH — IS CLEARED</strong>' + (gv.firstClear ? ' — your first clearing, receipted in the books, named and dated and permanent.' : ' — the Reach stays cleared on your chart, and its armada flies a notch quieter for you now.') + '</p>' : '') +
        hook +
        (v.xp ? '<p class="v-name">+' + v.xp + ' XP' + (v.emberBonus ? ' (Founder\'s Ember +10%)' : '') + (v.levelUp ? ' — <strong>LEVEL UP</strong>' : '') + ' · +' + v.points + ' points</p>' : '') +
        (banked ? '<p class="v-name">Banked: ' + banked + '</p>' : '<p class="v-name">Nothing banked.</p>') +
        (lost ? '<p class="v-name bad">Lost among the stars: ' + lost + '</p>' : '') +
        '<div class="v-actions"><a class="fightbtn small" href="/verdict/' + v.id + '">Full after-action report</a>' +
        '<a class="ghostbtn" href="/galactic/fly?form=scroll">Fly again</a>' +
        '<a class="ghostbtn" href="/galactic">The star map</a>' +
        '<a class="ghostbtn" href="/galactic/bridge">The Bridge</a></div></div>';
    }
    el.scverdict.innerHTML = html;
    el.scverdict.classList.remove('hidden');
    sfx(v && v.result === 'win' ? 'verdictWin' : 'verdictLose');
  }

  drawWheel();
})();
