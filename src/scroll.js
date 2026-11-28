'use strict';
// ===========================================================================
// THE TWIN ARENA — 1944 MODE: the scroll engine (Sector 1, Phase 1 complete).
//
// A vertical-scrolling shooter in the 1942/1943/1944 lineage, flown beside
// the wheel battle and the classic deck — a third battle FORM of the same
// sortie, never a replacement. The referee doctrine is unchanged and it is
// the crown: the client flies, records ONE input log (movement samples,
// fire on/off, mod activations — timestamped), and submits it to the same
// /api/fight/finish door. The server replays the flight deterministically
// against the dealt waves and validates kills, damage, drops and the clear.
// Ship position is an INPUT here, never an authority: the replay moves the
// ship under the same speed law the client flies, and a log that claims
// more sky than the ship can cross voids — flight is real, and so is the
// referee watching it.
//
// Enemy motion is closed-form (a pure function of spawn params and time),
// so the client renders the identical sky from the dealt waves and this
// file's math — the SCROLL-MATH block below is mirrored verbatim in
// public/js/galactic-scroll.js, and verify-1944 proves the two agree.
// ===========================================================================

module.exports = function createScrollEngine(deps) {
  const rng32 = deps.rng32;
  const FITTED_MODS = deps.FITTED_MODS;
  const DEPLOY_MODS = deps.DEPLOY_MODS;
  const fittedMod = deps.fittedMod;
  const levelForXp = deps.levelForXp;

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

  // ---- what the server deals the pilot (never the client's word) ---------
  function scrollDealt(player, opts) {
    opts = opts || {};
    const fitted = {};
    for (const id of Object.keys(FITTED_MODS)) {
      if (fittedMod(player, FITTED_MODS[id].tool) === id) fitted[id] = FITTED_MODS[id].tool;
    }
    const deploy = {};
    for (const id of Object.keys(DEPLOY_MODS)) {
      if (player.modsOwned && player.modsOwned[id]) deploy[id] = DEPLOY_MODS[id].charges;
    }
    const fittedCount = Object.keys(fitted).length;
    // Wing ships: the Galaga law — your fitted hardpoints fly beside you.
    // Two fitted mods earn one wing; a full rail earns two.
    const wings = fittedCount >= 4 ? 2 : fittedCount >= 2 ? 1 : 0;
    const bodyTier = opts.bodyTier || null;
    const trim = { LEGENDARY: '#ffd24a', GODFORGED: '#fff3c4', EPIC: '#b967ff', RARE: '#39c2ff', STURDY: '#9fb4c8' }[bodyTier] || '#9fb4c8';
    return {
      hullMax: opts.hullMax || 100, startHull: opts.startHull != null ? opts.startHull : (opts.hullMax || 100),
      startTrace: opts.startTrace || 0,
      fitted, deploy, wings, trim,
      gun: { cadenceMs: SCROLL_GUN.cadenceMs, dmg: SCROLL_GUN.dmg, overclockCadenceMs: SCROLL_GUN.overclockCadenceMs },
      modTimes: Object.assign({}, SCROLL_MOD_TIMES),
      teachTool: opts.teachTool || 'flood'
    };
  }

  return {
    SCROLL_FIELD, SCROLL_STEP_MS, SHIP_SPEED, SCROLL_CLASSES,
    SCROLL_STAGES, SCROLL_TABLES, SCROLL_COUNTERS, SCROLL_MOD_TIMES, SCROLL_GUN,
    HERALD_DEF, scrollStageDef, scrollEnemyPos, scrollEnemyGone,
    scrollHeraldPos, scrollHeraldPhase,
    makeScrollWaves, scrollDealt, createScrollStepper, simulateScroll
  };
};
