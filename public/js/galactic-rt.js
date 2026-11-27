'use strict';
// THE GALACTIC — REAL-TIME FLIGHT LAYER (G1.5).
// Steven's order: full screen, free flight, a sky that streams past, the
// armada firing back in the open, a wheel to choose weapons and defense,
// and fire with weight — a real video game over the same referee.
//
// THE INTEGRITY LAW, kept: this layer is PRESENTATION + INTENTS. It runs
// the same local mirror the classic deck runs and submits the same action
// log ({ t, tool }) to the same server referee at /api/fight/finish. The
// ship's position is never sent anywhere and never decides anything: a
// dodge counts only as the parry intent, valid only inside the incoming
// strike's referee window — the projectile's flight IS that window,
// drawn. Movement between events is free cosmetic flight.
//
// FAIL-SOFT: this file loads BEFORE galactic.js. If anything here cannot
// initialize, TA_RT_ACTIVE is never set, this layer removes itself, and
// the classic command deck underneath is the battle entire. ?classic=1
// asks for the classic deck directly.
(function () {
  var classicWanted = false;
  try { classicWanted = new URLSearchParams(location.search).has('classic'); } catch (e) {}
  if (classicWanted) return;
  var gateCanvas = document.getElementById('gate');
  var classicStart = document.getElementById('startbtn');
  if (!gateCanvas || !classicStart) return; // not the member fly pad
  var probeCtx = null;
  try { probeCtx = document.createElement('canvas').getContext('2d'); } catch (e) {}
  if (!probeCtx) return;

  /* RT-WHEEL-BEGIN */
  // The weapon wheel's geometry, pure: given a pointer offset (dx, dy)
  // from the wheel's center and the wheel's outer radius R, decide what
  // the thumb is on. The hub is PARRY. The face band carries the four
  // tools; the rim band carries the four deployables. Sectors are laid
  // from 12 o'clock, clockwise: 0 = top, 1 = right, 2 = bottom, 3 = left.
  // The client maps indices through RT_WHEEL_TOOLS / RT_WHEEL_DEPLOY.
  function rtWheelPick(dx, dy, R) {
    var r = Math.sqrt(dx * dx + dy * dy);
    if (!(R > 0) || r > R) return { zone: 'none', index: -1 };
    if (r <= R * 0.30) return { zone: 'hub', index: -1 };
    var a = Math.atan2(dx, -dy); // 0 at top, clockwise positive
    if (a < 0) a += Math.PI * 2;
    var idx = Math.floor(((a + Math.PI / 4) % (Math.PI * 2)) / (Math.PI / 2));
    return { zone: r <= R * 0.74 ? 'face' : 'rim', index: idx };
  }
  var RT_WHEEL_TOOLS = ['probe', 'flood', 'whisper', 'decoy'];
  var RT_WHEEL_DEPLOY = ['overclock', 'tracepurge', 'ghostplate', 'coldsnap'];
  /* RT-WHEEL-END */

  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var SFX = window.TASFX || null;
  function sfx(name) { if (SFX) SFX.play(name); }
  var TIER_TRIM = { STURDY: '#cfd6dd', RARE: '#3fa9ff', EPIC: '#b967ff', LEGENDARY: '#ffd700', GODFORGED: '#fff3c4' };
  var STAGE_LABELS = ['PICKET FRIGATE', 'PICKET FRIGATE', 'PATROL PAIR', 'MIRAGE WING', 'PATROL PAIR', 'MIRAGE WING', 'MIRAGE WING', 'THE HERALD — CAPITAL OF THE REACH'];
  var TOOL_SHORT = { probe: 'PROBE', flood: 'FLOOD', whisper: 'WHISPER', decoy: 'DECOY' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ---------- the layer's DOM ----------
  var layer, canvas, ctx;
  var W = 0, H = 0, DPR = 1;
  var el = {};
  function buildDom() {
    layer = document.createElement('div');
    layer.id = 'rt-layer';
    layer.innerHTML =
      '<canvas id="rt-canvas"></canvas>' +
      '<div class="rt-hud rt-hidden" id="rt-hud">' +
        '<div class="rt-cell"><label id="rt-enemy-label">ENEMY HULL</label><div class="bar hp"><i id="rt-hpbar"></i></div><span class="rt-num" id="rt-hptext">100</span></div>' +
        '<div class="rt-clock" id="rt-clock">2:00</div>' +
        '<div class="rt-cell right"><label>ATTENTION</label><div class="bar trace" id="rt-tracewrap"><i id="rt-tracebar"></i></div><span class="rt-num" id="rt-tracetext">0%</span></div>' +
        '<div class="rt-cell"><label>INTEGRITY</label><div class="bar int"><i id="rt-intbar"></i></div><span class="rt-num" id="rt-inttext">100</span></div>' +
        '<div class="rt-runline" id="rt-runline">Stage — · Score 0 · Carrying nothing</div>' +
        '<div class="rt-cell right"><label>ENERGY</label><div class="bar en"><i id="rt-enbar"></i></div><span class="rt-num" id="rt-entext">100</span></div>' +
      '</div>' +
      '<div class="rt-topbtns rt-hidden" id="rt-topbtns">' +
        '<button id="rt-holdchip" class="rt-holdchip" type="button">HOLD · 0</button>' +
        '<button id="rt-mutebtn" type="button">SOUND</button>' +
        '<button id="rt-abandonbtn" type="button">ABANDON</button>' +
      '</div>' +
      '<div class="rt-holdlist rt-hidden" id="rt-holdlist"><h3>IN THE HOLD — UNBANKED</h3><ul id="rt-haulfeed"><li class="dim">Empty hold. The Reach provides.</li></ul></div>' +
      '<div id="rt-winframe" class="rt-winframe rt-hidden"><span>OPEN WINDOW ×2</span><i id="rt-winframe-bar"></i></div>' +
      '<div id="rt-lootlayer" class="lootlayer"></div>' +
      '<div id="rt-bossplate" class="bossplate rt-hidden"></div>' +
      '<div id="rt-banner" class="rt-banner"></div>' +
      '<div id="rt-twinread" class="rt-twinread rt-hidden">The armada is reading you…</div>' +
      '<div class="rt-controls rt-hidden" id="rt-controls">' +
        '<div class="rt-cluster"><button id="rt-shield" class="rt-bigbtn" type="button"><span class="parry-charge" id="rt-parry-charge"></span><span class="bl">⚡ FLARE</span><span class="bs">shield · parry</span></button></div>' +
        '<div class="rt-cluster">' +
          '<div class="rt-abilities" id="rt-abilities"></div>' +
          '<div style="display:flex; gap:12px; align-items:flex-end">' +
            '<button id="rt-wheelbtn" class="rt-bigbtn" type="button"><span class="bl">WHEEL</span><span class="bs">hold · slide</span></button>' +
            '<button id="rt-fire" class="rt-bigbtn" type="button"><span class="bl">FIRE</span><span class="bs" id="rt-fire-sub">PROBE</span><span class="cdveil" id="rt-fire-veil"></span></button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rt-panel" id="rt-startpanel"><div class="rt-card">' +
        '<span class="rt-kicker">SECTOR 1 · EMBERFALL REACH — PHASE 1 · EIGHT STAGES</span>' +
        '<h2 id="rt-pad-title">Your ship is on the pad.</h2>' +
        '<p class="dim" style="margin:.2rem 0">THE GALACTIC MASTERCLASS — the sky is a school for intruders, and this is the flying lesson: your build is your ship, her armada is the faculty, and every stage is an exam she grades in real time.</p>' +
        '<div id="rt-record"></div><div id="rt-armory"></div>' +
        '<p class="rt-controls-help"><b>DRAG</b> the sky to fly — your ship rides above your thumb.<br>' +
        '<b>HOLD FIRE</b> to shoot the armed weapon; it fires the moment the referee clears it.<br>' +
        '<b>HOLD THE WHEEL</b> and slide: weapons on its faces, PARRY at its heart, your systems on its rim — release to choose.<br>' +
        '<b>FLARE</b> when her fire is almost on you: the gold orb\'s flight is your window. Time the shield inside it, or throw a Decoy into its path.<br>' +
        'Refit at <a href="/galactic/bridge">the Bridge</a>, never mid-sortie. The classic command deck stands under this sky at <a href="/galactic/fly?classic=1">?classic=1</a>.</p>' +
        '<button id="rt-startbtn" class="fightbtn" type="button">🚀 BEGIN THE SORTIE</button>' +
        '<p class="dim">A sortie abandoned from this pad banks its haul like a withdrawal — the Keeper is not cruel, but the Reach keeps its own ledger.</p>' +
      '</div></div>' +
      '<div class="rt-panel rt-hidden" id="rt-gatechoice"><div class="rt-card">' +
        '<h2>THE ENEMY BREAKS</h2><p id="rt-gatechoice-text"></p>' +
        '<div class="gatechoice-btns"><button id="rt-press-btn" class="fightbtn descend" type="button">▲ PRESS ON</button>' +
        '<button id="rt-withdraw-btn" class="fightbtn ascend" type="button">▼ WITHDRAW &amp; BANK</button></div>' +
      '</div></div>' +
      '<div class="rt-panel rt-hidden" id="rt-verdict"></div>';
    document.body.appendChild(layer);
    canvas = layer.querySelector('#rt-canvas');
    ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('rt: no 2d context');
    ['hud', 'hpbar', 'hptext', 'intbar', 'inttext', 'enbar', 'entext', 'tracebar', 'tracetext', 'tracewrap',
     'clock', 'runline', 'enemy-label', 'topbtns', 'holdchip', 'holdlist', 'haulfeed', 'winframe', 'winframe-bar',
     'lootlayer', 'bossplate', 'banner', 'twinread', 'controls', 'abilities', 'shield', 'parry-charge',
     'wheelbtn', 'fire', 'fire-sub', 'fire-veil', 'startpanel', 'startbtn', 'gatechoice', 'gatechoice-text',
     'press-btn', 'withdraw-btn', 'verdict', 'mutebtn', 'abandonbtn', 'record', 'armory', 'pad-title']
      .forEach(function (id) { el[id] = layer.querySelector('#rt-' + id); });
  }

  // ---------- flight + battle state ----------
  var S = null;   // the current encounter's fight state (mirrors the referee)
  var R = null;   // the sortie: { sortieId, encounter, score, haul: [], over }
  var ship = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, bank: 0, recoil: 0 };
  var scroll = { x: 0, y: 0 };
  var projectiles = [];   // enemy fire in flight — presentation of the strike schedule
  var tracers = [];       // your fire in flight — presentation only
  var firing = false;
  var movePointer = null; // { id, dx, dy, downAt, moved }
  var keys = {};
  var wheel = { open: false, pointerId: null, ax: 0, ay: 0, R: 118, pick: null, sticky: false, idleAt: 0 };
  var spawnCounter = 0;
  var STARS = [];
  (function () {
    var a = 987654321;
    function rnd() { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    for (var i = 0; i < 150; i++) STARS.push({ x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.8, layer: i % 3, tw: rnd() * 6.28 });
  })();

  function elapsed() { return performance.now() - S.startedAt; }
  function fit() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ship.tx = Math.max(44, Math.min(W - 44, ship.tx || W * 0.3));
    ship.ty = Math.max(70, Math.min(H - 100, ship.ty || H * 0.68));
    if (!ship.x) { ship.x = ship.tx; ship.y = ship.ty; }
  }

  // ---------- the sortie ----------
  function startSortie() {
    if (SFX) SFX.unlock();
    el.startbtn.disabled = true;
    el.startbtn.textContent = 'THE PAD STIRS…';
    fetch('/api/galactic/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          el.startbtn.disabled = false; el.startbtn.textContent = '🚀 BEGIN THE SORTIE';
          el['pad-title'].textContent = res.d.message || res.d.error || 'The pad would not open.';
          return;
        }
        R = { sortieId: res.d.galactic.sortieId, encounter: 0, score: 0, haul: [], over: false };
        el.startpanel.classList.add('rt-hidden');
        el.hud.classList.remove('rt-hidden');
        el.controls.classList.remove('rt-hidden');
        el.topbtns.classList.remove('rt-hidden');
        el.twinread.classList.remove('rt-hidden');
        beginEncounter(res.d, true);
      })
      .catch(function () { el.startbtn.disabled = false; el.startbtn.textContent = '🚀 BEGIN THE SORTIE'; });
  }

  function beginEncounter(d, first) {
    var st = d.stats, cb = st.combat, dd = d.galactic || {};
    R.encounter = dd.encounter; R.score = dd.score || 0;
    S = {
      fightId: d.fightId, stats: st, combat: cb,
      hp: st.gateHp, maxHp: st.gateHp,
      integrity: cb.startIntegrity != null ? cb.startIntegrity : cb.playerHp,
      maxIntegrity: cb.playerHp,
      trace: cb.startTrace || 0,
      energy: st.energyMax,
      left: st.roundMs, startedAt: performance.now(), lastFrame: performance.now(),
      cds: {}, lastUse: {}, lockouts: {}, actions: [], dots: [],
      markUntil: 0, markCharges: 0, critNext: 0,
      strikes: (d.strikes || []).map(function (s) { return { at: s.at, kind: s.kind, tool: s.tool, revealed: !!s.revealed, parried: false, eaten: false, done: false, spawned: false, shipIdx: 0 }; }),
      postMorph: [], morphed: false,
      vulnFrom: -1, vulnUntil: -1, parryCdUntil: 0,
      alarmStage: 0, crackStage: 0,
      shake: 0, flash: 0, eyeRage: 0, hurt: 0, over: false, endReason: null,
      particles: [], texts: [], phantomUntil: 0, beam: null, strikeFx: null,
      famShown: {}, uses: {},
      abilityCds: {}, ghostCharges: 0, rapidUntil: 0, secondWindUsed: false,
      lastProbeAt: -1e9, lastDecoyAt: -1e9, windowCalled: false,
      kind: dd.kind || 'pickets', boss: dd.boss || null,
      encounter: dd.encounter || 1, attention: dd.attention || 0,
      modCharges: {}, overclockArmed: false,
      payback: 0, paybackPhantomUntil: 0, plateFed: 0, plateUntil: 0,
      // the real-time layer's own state
      armed: 'probe', muzzle: null, flareUntil: 0
    };
    var dep0 = (st.mods && st.mods.deploy) || {};
    for (var mid0 in dep0) S.modCharges[mid0] = dep0[mid0].charges || 0;
    for (var id in st.tools) S.famShown[id] = st.tools[id].familiarity;
    projectiles = []; tracers = []; spawnCounter = 0; firing = false;
    wheel.open = false; wheel.pointerId = null;
    ship.tx = W * 0.3; ship.ty = H * 0.68; ship.x = ship.tx; ship.y = ship.ty; ship.recoil = 0;
    el.verdict.classList.add('rt-hidden');
    el.gatechoice.classList.add('rt-hidden');
    el.shield.disabled = false;
    buildAbilityChips(st);
    updateTwinRead();
    updateRunLine();
    el.clock.textContent = fmtClock(S.left);
    el['enemy-label'].textContent = dd.boss ? 'THE HERALD — CAPITAL HULL' : 'ENEMY HULL · ' + (STAGE_LABELS[(dd.encounter || 1) - 1] || 'ARMADA');
    showStageBanner(dd);
    if (dd.boss) showBossPlate(dd.boss);
    sfx(dd.boss ? 'boss' : 'begin');
    if (SFX) SFX.humStart();
  }

  function showStageBanner(dd) {
    var label = STAGE_LABELS[(dd.encounter || 1) - 1] || 'ARMADA CONTACT';
    el.banner.innerHTML = '<span class="rt-stage-no">STAGE ' + dd.encounter + ' OF 8 · PHASE 1</span>' + esc(label);
    el.banner.classList.remove('show'); void el.banner.offsetWidth;
    el.banner.classList.add('show');
  }
  function showBossPlate(boss) {
    el.bossplate.innerHTML = '<div class="bossplate-inner"><span class="boss-tag">THE CAPITAL OF THE REACH — FLAGSHIP SYSTEM</span>' +
      '<h2>' + esc(boss.name) + '</h2><p>' + esc(boss.line) + '</p><p class="boss-sub">BREACH IT, AND THE SECTOR IS YOURS</p></div>';
    el.bossplate.classList.remove('rt-hidden');
    setTimeout(function () { el.bossplate.classList.add('rt-hidden'); }, 5200);
  }
  function updateRunLine() {
    if (!R) return;
    el.runline.innerHTML = 'Stage <b>' + (R.encounter || '—') + ' of 8</b> · Score <b>' + R.score + '</b> · Carrying <b>' +
      (R.haul.length ? R.haul.length + ' piece' + (R.haul.length === 1 ? '' : 's') + ' unbanked' : 'nothing') + '</b>';
    el.holdchip.textContent = 'HOLD · ' + R.haul.length;
  }
  function renderHaul() {
    if (!R || !R.haul.length) { el.haulfeed.innerHTML = '<li class="dim">Empty hold. The Reach provides.</li>'; return; }
    el.haulfeed.innerHTML = R.haul.map(function (p) {
      return '<li class="gearline t-' + p.tier.toLowerCase() + '"><strong>' + esc(p.name) + '</strong> ' +
        '<span class="tierbadge t-' + p.tier.toLowerCase() + '">' + p.tier + '</span>' +
        (p.serial ? ' No. ' + p.serial : '') + ' · ' + esc(p.slot) + '</li>';
    }).join('');
  }
  function showLoot(drops) {
    if (!drops || !drops.length) return;
    drops.forEach(function (p, i) {
      R.haul.push(p);
      var beam = document.createElement('div');
      beam.className = 'beam t-' + p.tier.toLowerCase();
      beam.style.left = (12 + i * 22) + '%';
      beam.innerHTML = '<i></i><span>' + esc(p.name) + (p.serial ? ' No. ' + p.serial : '') + '<br><b>' + p.tier + '</b></span>';
      el.lootlayer.appendChild(beam);
      setTimeout(function () { beam.classList.add('fade'); }, 2900);
      setTimeout(function () { beam.remove(); }, 3600);
      sfx(p.tier === 'LEGENDARY' ? 'legendary' : p.tier === 'EPIC' ? 'lootEpic' : p.tier === 'RARE' ? 'lootRare' : 'lootSturdy');
    });
    renderHaul();
    updateRunLine();
  }
  function showModLoot(mods) {
    if (!mods || !mods.length) return;
    mods.forEach(function (m, i) {
      var beam = document.createElement('div');
      beam.className = 'beam t-mod';
      beam.style.left = (30 + i * 22) + '%';
      beam.style.setProperty('--bc', m.kind === 'fitted' ? '#00e5ff' : '#b967ff');
      beam.innerHTML = '<i></i><span>' + esc(m.name) + '<br><b>' + (m.kind === 'fitted' ? 'FITTED MOD — BANKED' : 'SYSTEMS MOD — BANKED') + '</b></span>';
      el.lootlayer.appendChild(beam);
      setTimeout(function () { beam.classList.add('fade'); }, 2900);
      setTimeout(function () { beam.remove(); }, 3600);
      floatText('MOD BANKED — ' + m.name, '#b967ff', true);
      sfx('lootEpic');
    });
  }

  // ---------- abilities: compact chips over the FIRE cluster ----------
  function buildAbilityChips(st) {
    el.abilities.innerHTML = '';
    var abs = st.abilities || {};
    Object.keys(abs).forEach(function (id) {
      var a = abs[id];
      var b = document.createElement('button');
      b.className = 'rt-ability'; b.id = 'rt-ability-' + id;
      b.style.setProperty('--tc', a.color);
      b.innerHTML = '<span class="an">✦ ' + esc(a.name) + '</span>' +
        '<span class="noenergy rt-hidden">no energy</span><span class="cdveil"></span>';
      b.title = a.blurb;
      b.addEventListener('click', function () { useAbility(id); });
      el.abilities.appendChild(b);
    });
  }
  function applyTrace(amt, now) {
    S.trace = Math.max(0, Math.min(S.combat.traceMax, S.trace + amt));
    if (S.trace >= 90 && S.alarmStage < 2) { S.alarmStage = 2; sfx('alarm2'); }
    else if (S.trace >= 75 && S.alarmStage < 1) { S.alarmStage = 1; sfx('alarm'); }
    if (S.trace >= S.combat.traceMax) {
      updateHud(); endFight('trace'); return true;
    }
    return false;
  }
  function updateTwinRead() {
    if (!S) return;
    var lines = [];
    var best = null, bestN = 0;
    for (var id in S.uses) if (S.uses[id] > bestN) { bestN = S.uses[id]; best = id; }
    if (best) {
      var t = S.stats.tools[best];
      var pct = Math.round((S.famShown[best] || 0) * 100);
      var mood = pct < 35 ? 'still guessing at' : pct < 60 ? 'learning' : 'KNOWS';
      lines.push('THE ARMADA READS YOU: ' + t.name.toUpperCase() + ' is your tell — it is ' + mood + ' that shape (' + pct + '% familiar).');
    } else {
      lines.push('THE ARMADA READS YOU: Sector attention on this ship stands at ' + S.attention + '% — everything you fire teaches the fleet.');
    }
    el.twinread.textContent = lines.join(' ');
  }

  // ---------- intents: the only things this layer ever tells the referee --
  // Every intent lands in S.actions as { t, tool } — the identical log the
  // classic deck submits. Nothing else about the flight is ever claimed.
  function strikeBonusClient(now) {
    var b = S.payback || 0; S.payback = 0;
    if (S.plateFed > 0 && now >= S.plateUntil) { b += S.plateFed; S.plateFed = 0; floatText('THE GHOST PLATE DISCHARGES +' + Math.round(b), '#b967ff', true); }
    return b;
  }
  function fireMod(id) {
    if (!S || S.over) return;
    var dep = (S.stats.mods && S.stats.mods.deploy) || {};
    if (!dep[id]) return;
    if (!(S.modCharges[id] > 0)) { sfx('deny'); return; }
    var now = elapsed();
    S.modCharges[id]--;
    S.actions.push({ t: Math.round(now), tool: 'mod:' + id });
    if (id === 'overclock') {
      S.overclockArmed = true;
      floatText('OVERCLOCK — THE NEXT STRIKE RESOLVES HASTED', '#00e5ff', true);
    } else if (id === 'tracepurge') {
      S.trace = Math.max(0, S.trace - 35);
      floatText('ATTENTION PURGE −35%', '#5dffa0', true);
    } else if (id === 'ghostplate') {
      S.plateUntil = now + 8000;
      floatText('GHOST PLATE — ARMED', '#b967ff', true);
    } else if (id === 'coldsnap') {
      for (var i = 0; i < S.strikes.length; i++) {
        var s = S.strikes[i];
        if (!s.done) { s.at += 1200; floatText('COLD SNAP — ITS RHYTHM FREEZES', '#7df9ff', true); break; }
      }
      S.strikes.sort(function (a, b) { return a.at - b.at; });
      // A snapped strike flies later: its projectile, if already in the
      // air, stretches to the new arrival — the window serves the referee.
      for (var j = 0; j < projectiles.length; j++) {
        if (projectiles[j].s === s) projectiles[j].travel = projectiles[j].s.at - projectiles[j].spawnT;
      }
    }
    sfx('modfire');
    updateHud();
  }
  function useAbility(id) {
    if (!S || S.over) return;
    var now = elapsed();
    var a = S.stats.abilities && S.stats.abilities[id];
    if (!a) return;
    if (S.abilityCds[id] && now < S.abilityCds[id]) return;
    if (id === 'secondwind' && S.secondWindUsed) { sfx('deny'); return; }
    if (S.energy < a.cost) { sfx('deny'); return; }
    S.energy -= a.cost;
    S.abilityCds[id] = now + a.cooldown;
    S.actions.push({ t: Math.round(now), tool: 'ability:' + id });
    if (applyTrace(a.trace || 0, now)) return;
    if (id === 'ghost') {
      S.ghostCharges = a.charges || 3;
      floatText('GHOST — THE NEXT 3 STRIKES LEAVE NO TRACE', '#b967ff', true);
      sfx('ghost');
    } else if (id === 'secondwind') {
      S.secondWindUsed = true;
      S.integrity = Math.min(S.maxIntegrity, S.integrity + (a.heal || 30));
      floatText('SECOND WIND +' + (a.heal || 30), '#5dffa0', true);
      sfx('secondWind');
    } else if (id === 'rapid') {
      S.rapidUntil = now + (a.windowMs || 8000);
      floatText('RAPID CYCLING — COOLDOWNS HALVED', '#00e5ff', true);
      sfx('rapid');
    } else if (id === 'overdrive') {
      var dmg = a.dmg;
      var crit = 1;
      if (S.critNext > 0) { crit *= (1 + S.critNext); S.critNext = 0; S.phantomUntil = 0; }
      if (now >= S.vulnFrom && now <= S.vulnUntil) { crit *= S.combat.vulnMult; floatText('VULNERABLE ×' + S.combat.vulnMult, '#fcee0a', true); }
      var odBonus = strikeBonusClient(now);
      S.beam = { until: performance.now() + 240, color: a.color, tool: 'flood' };
      S.muzzle = { until: performance.now() + 130, color: a.color, big: true };
      ship.recoil = Math.min(14, ship.recoil + 9);
      hitFx(dmg * crit + odBonus, a.color, 60);
      S.shake = Math.min(18, S.shake + 12);
      floatText('OVERDRIVE ' + Math.round(dmg * crit + odBonus), '#ff2a6d', true);
      sfx('overdrive');
    }
    updateHud();
  }

  // ---------- the armada's side of the argument ----------
  function windingHaymaker(now) {
    for (var i = 0; i < S.strikes.length; i++) {
      var s = S.strikes[i];
      if (s.kind === 'haymaker' && !s.done && !s.parried && !s.eaten &&
          now >= s.at - S.combat.windupMs && now <= s.at) return s;
    }
    return null;
  }
  function windingTelegraph(now) {
    for (var i = 0; i < S.strikes.length; i++) {
      var s = S.strikes[i];
      if ((s.kind === 'haymaker' || s.kind === 'feint') && !s.done && !s.parried && !s.eaten &&
          now >= s.at - S.combat.windupMs && now <= s.at) return s;
    }
    return null;
  }
  // DEFENSE = the parry intent, and nothing else. Where the ship happens
  // to be standing is never consulted — here or on the server.
  function tryParry() {
    if (!S || S.over) return;
    var now = elapsed();
    if (now < S.parryCdUntil) return;
    var s = windingTelegraph(now);
    if (!s) { sfx('deny'); return; }
    if (S.energy < S.combat.parryCost) { sfx('deny'); return; }
    S.energy -= S.combat.parryCost;
    S.parryCdUntil = now + S.combat.parryCooldown;
    s.parried = true;
    S.actions.push({ t: Math.round(now), tool: 'parry' });
    if (s.kind === 'feint') {
      floatText('FLARED AT… NOTHING. IT WAS A MIRAGE.', '#b967ff', true);
      sfx('whiff');
    } else {
      floatText('SHIELD FLARE — WAIT FOR IT…', '#fcee0a', false);
      sfx('parryArm');
    }
  }

  function resolveStrike(s, now) {
    s.done = true;
    var cb = S.combat;
    if (s.kind === 'feint') {
      if (!s.parried) floatText('A WIND-UP… THAT NEVER CAME', '#b967ff', false);
      strikeVisual(s);
      return;
    }
    if (s.kind === 'haymaker') {
      if (s.parried) {
        S.vulnFrom = s.at; S.vulnUntil = s.at + cb.vulnMs;
        S.flareUntil = performance.now() + 450;
        floatText('FLARED — ITS HULL IS OPEN. HIT IT.', '#fcee0a', true);
        S.eyeRage = 1;
        sfx('parry');
        strikeVisual(s);
        return;
      }
      if (s.eaten) { floatText('THE DECOY TOOK THE HIT', '#fcee0a', false); sfx('decoyEat'); strikeVisual(s); return; }
      hurt(cb.strikeDmg.haymaker, 'HAYMAKER CONNECTS −' + cb.strikeDmg.haymaker, true);
      sfx('haymakerHit');
      strikeVisual(s);
      return;
    }
    if (s.kind === 'glance') {
      var tool = S.stats.tools[s.tool] ? s.tool : 'probe';
      if (S.stats.tools[tool] && S.stats.tools[tool].silent) {
        floatText('GLANCE — ' + S.stats.tools[tool].name.toUpperCase() + ' IS SILENT. NOTHING SCRAMBLES.', '#b967ff', true);
        hurt(cb.strikeDmg.glance, null, false);
        sfx('hitPlayer');
        strikeVisual(s);
        return;
      }
      var ready = S.lastUse[tool] !== undefined ? S.lastUse[tool] + S.stats.tools[tool].cooldown : now;
      S.lockouts[tool] = Math.max(ready, now) + cb.scrambleMs;
      floatText('GLANCE — ' + S.stats.tools[tool].name.toUpperCase() + ' SCRAMBLED', '#ffd166', true);
      hurt(cb.strikeDmg.glance, null, false);
      sfx('scramble');
      strikeVisual(s);
      return;
    }
    hurt(cb.strikeDmg.clean, null, false);
    sfx('hitPlayer');
    strikeVisual(s);
  }
  function hurt(dmg, label, big) {
    var hnow = elapsed();
    if (hnow < S.plateUntil) S.plateFed = Math.min(20, S.plateFed + dmg * 0.5);
    if (S.paybackPhantomUntil > 0 && hnow < S.paybackPhantomUntil) S.payback = Math.min(12, S.payback + dmg * 0.25);
    S.integrity = Math.max(0, S.integrity - dmg);
    S.hurt = Math.min(1, S.hurt + (big ? 0.85 : 0.45));
    S.shake = Math.min(18, S.shake + (big ? 13 : 6));
    if (label) floatText(label, '#ff2a6d', true);
    if (S.integrity <= 0) endFight('integrity');
  }
  // Impact dressing for a resolved strike: bursts where the truth landed.
  function strikeVisual(s) {
    var p = projectileFor(s);
    var x = p ? p.x : ship.x, y = p ? p.y : ship.y;
    if (s.kind === 'feint') { burst(x, y, '#b967ff', 14, 120); return; }
    if (s.parried) { burst(ship.x + 44, ship.y, '#fcee0a', 20, 190); return; }
    if (s.eaten) { var ph = phantomPos(performance.now() / 1000); burst(ph.x, ph.y, '#fcee0a', 18, 170); return; }
    burst(ship.x + 20, ship.y, s.kind === 'glance' ? '#ffd166' : '#ff5a3c', s.kind === 'haymaker' ? 26 : 12, 200);
  }
  function burst(x, y, color, n, sp) {
    if (!S) return;
    var room = Math.max(0, 260 - S.particles.length);
    var count = Math.min(n, room);
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2, v = (0.3 + Math.random() * 0.7) * sp;
      S.particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.5, age: 0, color: color, r: 1 + Math.random() * 2.4 });
    }
  }
  function projectileFor(s) {
    for (var i = 0; i < projectiles.length; i++) if (projectiles[i].s === s) return projectiles[i];
    return null;
  }

  // ---------- staging geometry (the battle is open space, flown) --------
  function enemyShips() {
    if (!S) return [{ x: W * 0.7, y: H * 0.26, s: 1, main: true }];
    var t = performance.now() / 1000;
    var bob = REDUCED ? 0 : Math.sin(t * 0.9) * 4;
    if (S.kind === 'capital') return [{ x: W * 0.5, y: H * 0.21 + bob * 0.4, s: 2.7, main: true }];
    if (S.kind === 'squadrons') return [
      { x: W * 0.68, y: H * 0.24 + bob, s: 0.95, main: true },
      { x: W * 0.47, y: H * 0.36 + bob * 1.4, s: 0.62, main: false },
      { x: W * 0.88, y: H * 0.38 - bob * 1.2, s: 0.62, main: false }
    ];
    if (S.kind === 'patrols') return [
      { x: W * 0.7, y: H * 0.24 + bob, s: 1.05, main: true },
      { x: W * 0.88, y: H * 0.37 - bob, s: 0.7, main: false }
    ];
    return [{ x: W * 0.72, y: H * 0.25 + bob, s: 1.0, main: true }];
  }
  function enemyPos() {
    var ships = enemyShips();
    for (var i = 0; i < ships.length; i++) if (ships[i].main) return ships[i];
    return ships[0];
  }
  function phantomPos(t) {
    var pa = t * 0.9;
    return { x: ship.x + Math.cos(pa) * 92, y: ship.y - 58 + Math.sin(pa * 1.3) * 26 };
  }

  // ---------- your side ----------
  function useTool(id) {
    if (!S || S.over) return;
    var now = elapsed();
    var t = S.stats.tools[id];
    if (!t) return;
    if (S.cds[id] && now < S.cds[id]) return;
    if (S.lockouts[id] && now < S.lockouts[id]) return;
    if (S.energy < t.cost) { sfx('deny'); return; }
    S.energy -= t.cost;
    S.cds[id] = now + (now <= S.rapidUntil ? t.cooldown * 0.5 : t.cooldown);
    if (S.overclockArmed) { S.cds[id] = now + (S.cds[id] - now) * 0.5; S.overclockArmed = false; }
    S.lastUse[id] = now;
    S.actions.push({ t: Math.round(now), tool: id });
    S.uses[id] = (S.uses[id] || 0) + 1;
    S.muzzle = { until: performance.now() + 120, color: t.color, big: id === 'flood' };
    ship.recoil = Math.min(12, ship.recoil + (id === 'flood' ? 6 : 3.5));
    if (id !== 'decoy') spawnTracer(id, t.color);

    var traceAdd = t.trace;
    if (traceAdd > 0 && S.ghostCharges > 0) { traceAdd = 0; S.ghostCharges--; floatText('GHOST — NO TRACE', '#b967ff', false); }
    if (t.trace > 0 && traceAdd > 0) floatText('+' + traceAdd + '% ATTENTION', '#ff2a6d', false);
    if (applyTrace(traceAdd, now)) return;

    S.famShown[id] = Math.min(0.75, S.famShown[id] + 0.02);
    if (S.uses[id] === 3) floatText('IT HAS SEEN THIS SHAPE', '#ff2a6d', true);
    if (S.uses[id] === 6) floatText('IT KNOWS THIS ONE NOW', '#ff6b6b', true);
    updateTwinRead();

    if (id === 'decoy') {
      S.lastDecoyAt = now;
      if (t.paybackCoil) S.paybackPhantomUntil = now + 5000;
      var pt = S.stats.tools.probe;
      if (pt && pt.markThroughDecoy && S.markCharges > 0 && now <= S.markUntil + 2500) S.markUntil = now + (pt.markMs || 4000);
      var s = windingHaymaker(now);
      if (s) { s.eaten = true; floatText('DECOY UP — IT FIRES AT THE FALSE SHIP', '#fcee0a', false); }
    }

    var dmg = t.dmg;
    var crit = 1;
    var modBonus = id !== 'decoy' ? strikeBonusClient(now) : 0;
    if (id !== 'decoy') {
      if (S.critNext > 0) { crit *= (1 + S.critNext); S.critNext = 0; S.phantomUntil = 0; }
      if (id === 'flood' && now - S.lastProbeAt <= 3000) {
        crit *= 1.5; S.markUntil = 0; S.markCharges = 0;
        floatText('MARK & DROWN ×1.5', '#ffd166', true); sfx('combo');
      } else if (S.markUntil > now && id !== 'probe') { crit *= 1.3; if (--S.markCharges <= 0) S.markUntil = 0; }
      if (now >= S.vulnFrom && now <= S.vulnUntil) {
        crit *= S.combat.vulnMult;
        floatText('VULNERABLE ×' + S.combat.vulnMult, '#fcee0a', true);
        if (!S.windowCalled) { S.windowCalled = true; sfx('combo'); }
      }
    }
    if (id === 'probe') {
      S.markUntil = now + (t.markMs || 4000);
      S.markCharges = t.twoEyes ? 2 : 1;
      S.lastProbeAt = now;
      S.beam = { until: performance.now() + 150, color: t.color, tool: 'probe' };
      hitFx(dmg * crit + modBonus, t.color, 10);
      sfx('probe');
    } else if (id === 'flood') {
      S.beam = { until: performance.now() + 210, color: t.color, tool: 'flood' };
      hitFx(dmg * crit + modBonus, t.color, 46);
      if (t.splash && !S.over) hitFx(t.splash, t.color, 6);
      if (t.ignite) S.dots.push({ until: now + t.ignite.secs * 1000, dps: t.ignite.dps });
      if (t.modBurn) S.dots.push({ until: now + t.modBurn.secs * 1000, dps: t.modBurn.dps });
      S.shake = Math.min(16, S.shake + 9);
      sfx('flood');
    } else if (id === 'whisper') {
      var dps = t.dot;
      S.dots.push({ until: now + t.dotSecs * 1000, dps: dps });
      if (t.traceBurn) S.trace = Math.max(0, S.trace - t.traceBurn);
      if (t.traceShed) S.trace = Math.max(0, S.trace - t.traceShed);
      S.beam = { until: performance.now() + 90, color: t.color, tool: 'whisper' };
      hitFx(dmg * crit + modBonus, t.color, 14);
      sfx('whisper');
      if (now - S.lastDecoyAt <= 5000) {
        S.trace = Math.max(0, S.trace - 12);
        floatText('COLD TRAIL −12% ATTENTION', '#5dffa0', true); sfx('combo');
      }
    } else if (id === 'decoy') {
      S.critNext = S.stats.decoyCrit;
      S.phantomUntil = now + 5000;
      if (!windingHaymaker(now)) floatText('A FALSE SHIP FLIES', '#fcee0a');
      if (t.ghostStrike && !S.over) { hitFx(t.ghostStrike, t.color, 8); floatText('THE SECOND GHOST STRIKES', '#fcee0a', true); }
      sfx('decoy');
    }
    if (crit > 1 && id !== 'decoy') floatText('BREACH IN THE PATTERN ×' + crit.toFixed(1), '#ffd166');
    updateHud();
  }
  function spawnTracer(id, color) {
    var ep = enemyPos();
    var mx = ship.x + 52, my = ship.y - 4;
    tracers.push({ x0: mx, y0: my, x1: ep.x - 30, y1: ep.y, born: performance.now(), life: id === 'flood' ? 150 : 110, color: color, tool: id });
    if (tracers.length > 24) tracers.splice(0, tracers.length - 24);
  }

  function checkCrack() {
    if (!S || S.over) return;
    var frac = S.hp / S.maxHp;
    var stage = frac <= 0.25 ? 3 : frac <= 0.5 ? 2 : frac <= 0.75 ? 1 : 0;
    if (stage > S.crackStage) { S.crackStage = stage; sfx('crack' + stage); }
  }
  function hitFx(dmg, color, n) {
    S.hp = Math.max(0, S.hp - dmg);
    sfx('hit');
    checkCrack();
    S.flash = Math.min(1, S.flash + 0.35);
    S.eyeRage = Math.min(1, S.eyeRage + 0.25);
    var ep = enemyPos();
    burst(ep.x - 20, ep.y, color, n, 190);
    if (S.hp <= 0) endFight('breach');
  }
  function floatText(txt, color, glitch) {
    if (!S) return;
    var ep = enemyPos();
    S.texts.push({ txt: txt, color: color, glitch: !!glitch, age: 0, life: 1.6, y: ep.y - 90 - Math.random() * 40 });
  }

  // ---------- input: thumbs, wheel, keys ----------
  // Flight is pointer-drag: the ship rides ~84px above the thumb so the
  // hand never covers it. A quick tap (no drag) is the classic reflex:
  // FLARE when she winds up, otherwise fire the armed weapon once.
  canvas.addEventListener('pointerdown', function (e) {
    if (wheel.open && wheel.pointerId === null) {
      var pick = pickAt(e.clientX, e.clientY);
      if (pick) { commitPick(pick); closeWheel(); return; }
      closeWheel();
    }
    movePointer = { id: e.pointerId, downAt: performance.now(), moved: 0, sx: e.clientX, sy: e.clientY };
    ship.tx = clampX(e.clientX); ship.ty = clampY(e.clientY - 84);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', function (e) {
    if (wheel.open && wheel.pointerId === e.pointerId) {
      wheel.pick = rtWheelPick(e.clientX - wheel.ax, e.clientY - wheel.ay, wheel.R);
      return;
    }
    if (!movePointer || movePointer.id !== e.pointerId) return;
    movePointer.moved += Math.abs(e.clientX - movePointer.sx) + Math.abs(e.clientY - movePointer.sy);
    movePointer.sx = e.clientX; movePointer.sy = e.clientY;
    ship.tx = clampX(e.clientX); ship.ty = clampY(e.clientY - 84);
  });
  function endMove(e) {
    if (wheel.open && wheel.pointerId === e.pointerId) {
      if (wheel.pick) commitPick(wheel.pick);
      closeWheel();
      return;
    }
    if (!movePointer || movePointer.id !== e.pointerId) return;
    var quick = performance.now() - movePointer.downAt < 260 && movePointer.moved < 14;
    movePointer = null;
    if (quick && S && !S.over) {
      if (windingTelegraph(elapsed())) tryParry();
      else useTool(S.armed);
    }
  }
  canvas.addEventListener('pointerup', endMove);
  canvas.addEventListener('pointercancel', endMove);
  function clampX(x) { return Math.max(42, Math.min(W - 42, x)); }
  function clampY(y) { return Math.max(64, Math.min(H - 96, y)); }

  el.fire.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (!S || S.over) return;
    firing = true;
    useTool(S.armed);
    try { el.fire.setPointerCapture(e.pointerId); } catch (err) {}
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
    el.fire.addEventListener(ev, function () { firing = false; });
  });
  el.shield.addEventListener('pointerdown', function (e) { e.preventDefault(); tryParry(); });

  // The wheel: hold WHEEL and slide — release commits. A plain tap opens
  // it sticky; then a tap on a segment commits, a tap elsewhere closes.
  el.wheelbtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (!S || S.over) return;
    var r = el.wheelbtn.getBoundingClientRect();
    wheel.open = true; wheel.sticky = false;
    wheel.pointerId = e.pointerId;
    wheel.ax = r.left + r.width / 2; wheel.ay = r.top + r.height / 2 - 130;
    wheel.R = Math.max(96, Math.min(132, W * 0.34));
    wheel.pick = null; wheel.idleAt = performance.now();
    try { el.wheelbtn.setPointerCapture(e.pointerId); } catch (err) {}
  });
  el.wheelbtn.addEventListener('pointermove', function (e) {
    if (!wheel.open || wheel.pointerId !== e.pointerId) return;
    wheel.pick = rtWheelPick(e.clientX - wheel.ax, e.clientY - wheel.ay, wheel.R);
  });
  function endWheel(e) {
    if (!wheel.open || wheel.pointerId !== e.pointerId) return;
    var wasDrag = !!wheel.pick;
    if (wheel.pick) commitPick(wheel.pick);
    wheel.pointerId = null;
    if (wasDrag) closeWheel();
    else { wheel.sticky = true; wheel.idleAt = performance.now(); } // a tap: stay open for a tap-pick
  }
  el.wheelbtn.addEventListener('pointerup', endWheel);
  el.wheelbtn.addEventListener('pointercancel', endWheel);
  function pickAt(cx, cy) {
    var dx = cx - wheel.ax, dy = cy - wheel.ay;
    if (Math.sqrt(dx * dx + dy * dy) > wheel.R) return null;
    return rtWheelPick(dx, dy, wheel.R);
  }
  function closeWheel() { wheel.open = false; wheel.sticky = false; wheel.pick = null; wheel.pointerId = null; }
  function commitPick(pick) {
    if (!S || S.over || !pick) return;
    wheel.idleAt = performance.now();
    if (pick.zone === 'hub') { tryParry(); return; }
    if (pick.zone === 'face') {
      var id = RT_WHEEL_TOOLS[pick.index];
      if (id && S.stats.tools[id]) { S.armed = id; useTool(id); }
      return;
    }
    if (pick.zone === 'rim') {
      var mid = RT_WHEEL_DEPLOY[pick.index];
      if (mid) fireMod(mid);
    }
  }

  document.addEventListener('keydown', function (e) {
    keys[e.key.toLowerCase()] = true;
    if (!S || S.over) return;
    if (e.key === ' ' || e.key === 'p' || e.key === 'P') { e.preventDefault(); tryParry(); return; }
    var ids = ['probe', 'flood', 'whisper', 'decoy'];
    var i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0) { S.armed = ids[i]; useTool(ids[i]); return; }
    var dep = RT_WHEEL_DEPLOY[['5', '6', '7', '8'].indexOf(e.key)];
    if (dep) fireMod(dep);
  });
  document.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

  el['press-btn'].addEventListener('click', function () { choose('press'); });
  el['withdraw-btn'].addEventListener('click', function () { choose('withdraw'); });
  el.abandonbtn.addEventListener('click', function () {
    if (!R || R.over) return;
    fetch('/api/galactic/abandon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortieId: R.sortieId })
    }).then(function (r) { return r.json(); }).then(function (d) {
      R.over = true;
      if (S) { S.over = true; if (SFX) SFX.humStop(); }
      showSortieVerdict(d.verdict, 'withdraw', null);
    }).catch(function () {});
  });
  el.holdchip.addEventListener('click', function () { el.holdlist.classList.toggle('rt-hidden'); });
  el.mutebtn.addEventListener('click', function () {
    if (SFX) { SFX.toggle(); el.mutebtn.textContent = SFX.isMuted() ? 'SOUND OFF' : 'SOUND ON'; }
  });
  el.startbtn.addEventListener('click', startSortie);

  // ---------- projectiles: her fire, drawn on the referee's clock -------
  // A haymaker's or feint's projectile is in the air for exactly the
  // referee's windup window: launched at (at − windupMs), arriving at
  // (at). The FLARE intent is the only defense, and it is judged by its
  // timestamp against that same window — the visuals serve the numbers.
  // Clean and glance bolts fly a short cosmetic 620ms and home onto the
  // ship: they were never parryable, and the drawing does not pretend
  // otherwise. On the capital, each true strike wears two cosmetic
  // flanker bolts that dissolve mid-flight — a capital fires in spreads;
  // only the center bolt is the strike, and only it can be flared.
  function strikeTravel(s) {
    return (s.kind === 'haymaker' || s.kind === 'feint') ? S.combat.windupMs : 620;
  }
  function spawnProjectiles(now) {
    var ships = enemyShips();
    for (var i = 0; i < S.strikes.length; i++) {
      var s = S.strikes[i];
      if (s.done || s.spawned) continue;
      var travel = strikeTravel(s);
      if (now < s.at - travel) continue;
      s.spawned = true;
      s.shipIdx = spawnCounter++ % ships.length;
      var from = ships[s.shipIdx];
      projectiles.push({
        s: s, spawnT: s.at - travel, travel: travel,
        x0: from.x - 40 * from.s, y0: from.y + 6, x: from.x - 40 * from.s, y: from.y + 6,
        bow: (Math.random() - 0.5) * 90, flanker: false
      });
      if (S.kind === 'capital' && (s.kind === 'haymaker' || s.kind === 'clean')) {
        for (var f = -1; f <= 1; f += 2) {
          projectiles.push({
            s: s, spawnT: s.at - travel, travel: travel * 1.45,
            x0: from.x - 40 * from.s + f * 30, y0: from.y + 26, x: from.x - 40 * from.s + f * 30, y: from.y + 26,
            bow: f * 120, flanker: true
          });
        }
      }
    }
  }
  function updateProjectiles(now) {
    projectiles = projectiles.filter(function (p) {
      if (p.s.done && !p.flanker) return false;
      var t = (now - p.spawnT) / p.travel;
      if (p.flanker && t >= 0.7) { burst(p.x, p.y, '#ff7a2a', 3, 60); return false; }
      if (t >= 1) return false;
      t = Math.max(0, t);
      var tx = p.s.eaten ? phantomPos(now / 1000 + S.startedAt / 1000).x : ship.x;
      var ty = p.s.eaten ? phantomPos(now / 1000 + S.startedAt / 1000).y : ship.y;
      var mx = (p.x0 + tx) / 2 + p.bow, my = (p.y0 + ty) / 2 - Math.abs(p.bow) * 0.4;
      var u = 1 - t;
      p.x = u * u * p.x0 + 2 * u * t * mx + t * t * tx;
      p.y = u * u * p.y0 + 2 * u * t * my + t * t * ty;
      p.t = t;
      return true;
    });
  }

  // ---------- the frame ----------
  var lastHudText = 0;
  function frame(nowPerf) {
    requestAnimationFrame(frame);
    var dt = 0.016;
    if (S) { dt = Math.min(0.05, (nowPerf - S.lastFrame) / 1000); S.lastFrame = nowPerf; }
    // flight: keys first (desktop), then the eased thumb
    if (S && !S.over) {
      var kvx = (keys['arrowright'] || keys['d'] ? 1 : 0) - (keys['arrowleft'] || keys['a'] ? 1 : 0);
      var kvy = (keys['arrowdown'] || keys['s'] ? 1 : 0) - (keys['arrowup'] || keys['w'] ? 1 : 0);
      if (kvx || kvy) { ship.tx = clampX(ship.tx + kvx * 480 * dt); ship.ty = clampY(ship.ty + kvy * 480 * dt); }
    }
    var pvx = ship.vx, pvy = ship.vy;
    var ease = Math.min(1, dt * 10);
    ship.x += (ship.tx - ship.x) * ease;
    ship.y += (ship.ty - ship.y) * ease;
    ship.vx = dt > 0 ? (ship.vx * 0.7 + ((ship.x - (ship.px == null ? ship.x : ship.px)) / dt) * 0.3) : 0;
    ship.vy = dt > 0 ? (ship.vy * 0.7 + ((ship.y - (ship.py == null ? ship.y : ship.py)) / dt) * 0.3) : 0;
    ship.px = ship.x; ship.py = ship.y;
    ship.bank += ((Math.max(-0.45, Math.min(0.45, ship.vx * 0.00045))) - ship.bank) * Math.min(1, dt * 8);
    ship.recoil = Math.max(0, ship.recoil - dt * 46);
    if (!REDUCED) {
      scroll.x += ship.vx * dt * 0.32;
      scroll.y += ship.vy * dt * 0.32 + dt * 13;
    }
    if (Math.abs(ship.vx - pvx) + Math.abs(ship.vy - pvy) > 4000) { /* velocity spike guard: no-op, easing handles it */ }

    if (S && !S.over) {
      var now = elapsed();
      S.left -= dt * 1000;
      S.energy = Math.min(S.stats.energyMax, S.energy + S.stats.energyRegen * dt);
      S.trace = Math.max(0, S.trace - S.combat.traceCool * dt);
      var burning = false;
      S.dots = S.dots.filter(function (d) {
        if (now < d.until) { burning = true; S.hp = Math.max(0, S.hp - d.dps * dt); return true; }
        return false;
      });
      if (S.hp <= 0) { endFight('breach'); }
      checkCrack();
      if (!S.over && !burning && S.hp > 0) S.hp = Math.min(S.stats.gateHp, S.hp + S.stats.gateRegen * dt);
      if (S.trace < 70 && S.alarmStage) S.alarmStage = 0;
      var windingNow = windingTelegraph(now);
      if (windingNow && !windingNow.sndWindup) {
        windingNow.sndWindup = true;
        sfx('windup');
      }
      spawnProjectiles(now);
      for (var i = 0; i < S.strikes.length && !S.over; i++) {
        var s = S.strikes[i];
        if (!s.done && now >= s.at) resolveStrike(s, now);
      }
      updateProjectiles(now);
      if (firing) useTool(S.armed);
      if (wheel.open && wheel.sticky && nowPerf - wheel.idleAt > 4000) closeWheel();
      if (!S.over && S.left <= 0 && S.hp > 0) { S.left = 0; endFight('timeout'); }
      updateHud(nowPerf);
    } else {
      projectiles = [];
      tracers = [];
    }
    draw(nowPerf, dt);
  }

  function updateHud(nowPerf) {
    el.hpbar.style.width = (S.hp / S.maxHp * 100) + '%';
    el.intbar.style.width = (S.integrity / S.maxIntegrity * 100) + '%';
    el.enbar.style.width = (S.energy / S.stats.energyMax * 100) + '%';
    el.tracebar.style.width = S.trace + '%';
    el.tracewrap.classList.toggle('hot', S.trace > 75);
    el.tracetext.classList.toggle('hot', S.trace > 75);
    var nowH = elapsed();
    var winding = !S.over && !!windingTelegraph(nowH);
    el.shield.classList.toggle('armed', winding);
    var cdFrac = S.parryCdUntil > nowH ? 1 - (S.parryCdUntil - nowH) / S.combat.parryCooldown : 1;
    el['parry-charge'].style.width = Math.round(Math.max(0, Math.min(1, cdFrac)) * 100) + '%';
    var inWin = !S.over && nowH >= S.vulnFrom && nowH <= S.vulnUntil;
    el.winframe.classList.toggle('rt-hidden', !inWin);
    if (inWin) {
      var span = Math.max(1, S.vulnUntil - S.vulnFrom);
      el['winframe-bar'].style.width = Math.round(Math.max(0, (S.vulnUntil - nowH) / span) * 100) + '%';
    }
    // the FIRE button wears the armed weapon: its color, its cooldown veil
    var at = S.stats.tools[S.armed];
    if (at) {
      el.fire.style.borderColor = at.color;
      el['fire-sub'].textContent = TOOL_SHORT[S.armed] + (S.overclockArmed ? ' · OVERCLOCKED' : '');
      var cdLeft = S.cds[S.armed] ? Math.max(0, S.cds[S.armed] - nowH) : 0;
      var lockLeft = S.lockouts[S.armed] ? Math.max(0, S.lockouts[S.armed] - nowH) : 0;
      var wait = Math.max(cdLeft, lockLeft);
      el['fire-veil'].style.height = (wait > 0 ? Math.min(100, wait / at.cooldown * 100) : 0) + '%';
      el.fire.style.opacity = S.energy < at.cost ? 0.55 : 1;
    }
    if (nowPerf - lastHudText > 160) {
      lastHudText = nowPerf;
      el.hptext.textContent = Math.ceil(S.hp);
      el.inttext.textContent = Math.ceil(S.integrity);
      el.entext.textContent = Math.floor(S.energy);
      el.tracetext.textContent = Math.floor(S.trace) + '%';
      el.clock.textContent = fmtClock(S.left);
      el.clock.classList.toggle('low', S.left < 20000);
      Object.keys(S.stats.abilities || {}).forEach(function (id) {
        var b = document.getElementById('rt-ability-' + id);
        if (!b) return;
        var a = S.stats.abilities[id];
        var cdL = S.abilityCds[id] ? Math.max(0, S.abilityCds[id] - nowH) : 0;
        var spent = id === 'secondwind' && S.secondWindUsed;
        b.disabled = cdL > 0 || spent || S.energy < a.cost;
        b.querySelector('.cdveil').style.width = (cdL > 0 ? (cdL / a.cooldown * 100) : 0) + '%';
        var ne = b.querySelector('.noenergy');
        if (ne) ne.classList.toggle('rt-hidden', S.energy >= a.cost);
      });
    }
  }

  // ---------- drawing the sky ----------
  // Ember-and-void, at the key art's register: layered nebulae, streaming
  // starfields, gothic hulls with tier-lit trim, and her ember-red as the
  // one warm threat color. Everything is drawn in code — no assets.
  function segRing(cx, cy, r, frac, color, rot) {
    var segs = 26;
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(90,80,110,0.28)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4.5;
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    for (var i = 0; i < segs; i++) {
      var a0 = rot + (i / segs) * Math.PI * 2 + 0.035;
      var a1 = rot + ((i + 1) / segs) * Math.PI * 2 - 0.035;
      var keep = ((i * 2654435761 % 100) / 100);
      ctx.strokeStyle = color;
      ctx.globalAlpha = keep < frac ? 0.95 : 0.08;
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  function drawShip(x, y, s, enemy, corePulse, trim, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(enemy ? -s : s, s);
    // swept whisper-fins, shadowed against the hull
    ctx.beginPath();
    ctx.moveTo(-38, -10); ctx.lineTo(-58, -30); ctx.lineTo(-18, -14); ctx.closePath();
    ctx.moveTo(-38, 10); ctx.lineTo(-58, 30); ctx.lineTo(-18, 14); ctx.closePath();
    ctx.fillStyle = enemy ? '#160b10' : '#10182a';
    ctx.strokeStyle = trim; ctx.lineWidth = 1.6; ctx.fill(); ctx.stroke();
    // the hull — layered plate gradient, lit from above
    var hg = ctx.createLinearGradient(0, -20, 0, 20);
    if (enemy) { hg.addColorStop(0, '#3a161c'); hg.addColorStop(0.45, '#1c0c12'); hg.addColorStop(1, '#0a0508'); }
    else { hg.addColorStop(0, '#2c3c5c'); hg.addColorStop(0.5, '#16203a'); hg.addColorStop(1, '#0a0e18'); }
    ctx.beginPath();
    ctx.moveTo(-56, 0); ctx.lineTo(-28, -15); ctx.lineTo(26, -19); ctx.lineTo(58, 0); ctx.lineTo(26, 19); ctx.lineTo(-28, 15); ctx.closePath();
    ctx.fillStyle = hg; ctx.fill();
    ctx.shadowColor = trim; ctx.shadowBlur = 7;
    ctx.strokeStyle = trim; ctx.lineWidth = 2; ctx.stroke();
    ctx.shadowBlur = 0;
    // plate seams + a lit spine
    ctx.beginPath(); ctx.moveTo(-30, -8); ctx.lineTo(30, -11); ctx.moveTo(-30, 8); ctx.lineTo(30, 11); ctx.moveTo(-8, -14); ctx.lineTo(-8, 14);
    ctx.strokeStyle = enemy ? 'rgba(255,90,40,.35)' : 'rgba(140,180,235,.25)'; ctx.lineWidth = 1.1; ctx.stroke();
    if (enemy) {
      // the Twin's core, riding in the hull — it brightens as it winds up
      var cr = 6 + corePulse * 5;
      var cg = ctx.createRadialGradient(-4, 0, 1, -4, 0, 26 + corePulse * 16);
      cg.addColorStop(0, 'rgba(255,209,102,.95)');
      cg.addColorStop(0.35, 'rgba(255,90,40,.55)');
      cg.addColorStop(1, 'rgba(255,42,60,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(-4, 0, 26 + corePulse * 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.arc(-4, 0, cr * 0.5, 0, Math.PI * 2); ctx.fill();
      // ember windows along the hull — a crewed, watching thing
      ctx.fillStyle = 'rgba(255,170,90,.75)';
      [-30, -16, 8, 22].forEach(function (wx) { ctx.fillRect(wx, -3, 2.4, 2.4); });
      ctx.fillStyle = 'rgba(255,60,50,.9)';
      ctx.fillRect(38, -13, 3, 3); ctx.fillRect(38, 10, 3, 3);
    } else {
      ctx.beginPath(); ctx.ellipse(20, -5, 13, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(185,103,255,.85)'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(20, -5, 13, 5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(230,200,255,.5)'; ctx.lineWidth = 1; ctx.stroke();
      // weapon mount tips wear the gear's own colors
      var gear = (S && S.stats.gear) || {};
      var tip = function (slot, tx, ty) {
        ctx.fillStyle = gear[slot] ? (TIER_TRIM[gear[slot].tier] || '#8b98a9') : '#54627c';
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(tx, ty, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      };
      tip('probe', 57, -3); tip('flood', 34, 14); tip('whisper', -52, -26); tip('decoy', -40, 20);
      // engine flame, breathing with the throttle
      var spd = Math.min(1, Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy) / 620);
      var fl = 12 + Math.sin(t * 30) * 3 + spd * 13 + (S && S.flash > 0.2 ? 5 : 0);
      var eg = ctx.createRadialGradient(-58, 0, 1, -58, 0, 24 + spd * 10);
      eg.addColorStop(0, 'rgba(255,209,102,.9)'); eg.addColorStop(0.5, 'rgba(255,122,42,.5)'); eg.addColorStop(1, 'rgba(255,122,42,0)');
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(-58, 0, 24 + spd * 10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-56, -6); ctx.lineTo(-56 - fl, 0); ctx.lineTo(-56, 6); ctx.closePath();
      ctx.fillStyle = '#ffb35c'; ctx.fill();
    }
    ctx.restore();
  }
  function drawWheelGlyph(id, x, y, u, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 6;
    if (id === 'probe') {
      ctx.beginPath(); ctx.ellipse(x, y, u, u * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, u * 0.32, 0, Math.PI * 2); ctx.fill();
    } else if (id === 'flood') {
      for (var r = -1; r <= 1; r++) {
        ctx.beginPath();
        ctx.moveTo(x - u, y + r * u * 0.55);
        ctx.quadraticCurveTo(x - u * 0.5, y + r * u * 0.55 - u * 0.4, x, y + r * u * 0.55);
        ctx.quadraticCurveTo(x + u * 0.5, y + r * u * 0.55 + u * 0.4, x + u, y + r * u * 0.55);
        ctx.stroke();
      }
    } else if (id === 'whisper') {
      ctx.beginPath(); ctx.arc(x - u * 0.5, y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x - u * 0.5, y, u * 0.55, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x - u * 0.5, y, u * 0.95, -0.9, 0.9); ctx.stroke();
    } else if (id === 'decoy') {
      ctx.beginPath(); ctx.arc(x, y + u * 0.4, u * 0.85, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - u, y + u * 0.4); ctx.lineTo(x + u, y + u * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y + u * 0.4, u * 0.38, Math.PI, 0); ctx.stroke();
    }
    ctx.restore();
  }
  function wheelSectorPath(r0, r1, i) {
    var a0 = (i * 90 - 135) * Math.PI / 180, a1 = (i * 90 - 45) * Math.PI / 180;
    ctx.beginPath();
    ctx.arc(wheel.ax, wheel.ay, r1, a0, a1);
    ctx.arc(wheel.ax, wheel.ay, r0, a1, a0, true);
    ctx.closePath();
  }
  function sectorCenter(i, r) {
    var th = i * Math.PI / 2;
    return { x: wheel.ax + Math.sin(th) * r, y: wheel.ay - Math.cos(th) * r };
  }
  function drawWheel(nowPerf) {
    if (!wheel.open || !S) return;
    var R = wheel.R, now = elapsed();
    ctx.save();
    // the disc: smoked glass over the battle, ringed in cyan
    var dg = ctx.createRadialGradient(wheel.ax, wheel.ay, R * 0.1, wheel.ax, wheel.ay, R);
    dg.addColorStop(0, 'rgba(8,12,22,0.88)'); dg.addColorStop(0.8, 'rgba(5,8,16,0.9)'); dg.addColorStop(1, 'rgba(5,8,16,0.96)');
    ctx.beginPath(); ctx.arc(wheel.ax, wheel.ay, R, 0, Math.PI * 2);
    ctx.fillStyle = dg; ctx.fill();
    ctx.strokeStyle = 'rgba(0,229,255,.5)'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
    var dep = (S.stats.mods && S.stats.mods.deploy) || {};
    for (var i = 0; i < 4; i++) {
      var tid = RT_WHEEL_TOOLS[i];
      var tool = S.stats.tools[tid];
      var pickedF = wheel.pick && wheel.pick.zone === 'face' && wheel.pick.index === i;
      // face band: the tools
      wheelSectorPath(R * 0.30, R * 0.74, i);
      ctx.fillStyle = tool.color; ctx.globalAlpha = pickedF ? 0.42 : 0.15; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = tool.color; ctx.lineWidth = pickedF ? 2.4 : 1.1; ctx.stroke();
      // its cooldown, drawn as a dark sweep eating the sector — referee-true
      var cdLeft = S.cds[tid] ? Math.max(0, S.cds[tid] - now) : 0;
      var lockLeft = S.lockouts[tid] ? Math.max(0, S.lockouts[tid] - now) : 0;
      var wait = Math.max(cdLeft, lockLeft);
      if (wait > 0 && tool.cooldown > 0) {
        var frac = Math.min(1, wait / tool.cooldown);
        var a0 = (i * 90 - 135) * Math.PI / 180, sweep = frac * Math.PI / 2;
        ctx.beginPath();
        ctx.arc(wheel.ax, wheel.ay, R * 0.74, a0, a0 + sweep);
        ctx.arc(wheel.ax, wheel.ay, R * 0.30, a0 + sweep, a0, true);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
      }
      var fc = sectorCenter(i, R * 0.52);
      drawWheelGlyph(tid, fc.x, fc.y - 4, 10, S.energy < tool.cost ? '#ff4655' : tool.color);
      ctx.font = '700 8.5px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = S.armed === tid ? '#ffffff' : 'rgba(233,244,255,.75)';
      ctx.fillText(TOOL_SHORT[tid] + (S.armed === tid ? ' ●' : ''), fc.x, fc.y + 15);
      // rim band: the deployables, with their true charges as pips
      var mid = RT_WHEEL_DEPLOY[i];
      var m = dep[mid];
      var charges = m ? (S.modCharges[mid] || 0) : 0;
      var pickedR = wheel.pick && wheel.pick.zone === 'rim' && wheel.pick.index === i;
      wheelSectorPath(R * 0.74, R, i);
      ctx.fillStyle = m ? m.color : '#333';
      ctx.globalAlpha = !m || charges <= 0 ? 0.05 : (pickedR ? 0.45 : 0.18); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = m ? m.color : '#333'; ctx.lineWidth = pickedR ? 2.4 : 1; ctx.stroke();
      if (m) {
        var rc = sectorCenter(i, R * 0.87);
        ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = charges > 0 ? m.color : 'rgba(120,130,150,.5)';
        ctx.fillText(m.sigil, rc.x, rc.y + 1);
        for (var p = 0; p < (m.charges || 0); p++) {
          ctx.beginPath();
          ctx.arc(rc.x - (m.charges - 1) * 4.5 + p * 9, rc.y + 9, 2.1, 0, Math.PI * 2);
          ctx.fillStyle = p < charges ? m.color : 'rgba(120,130,150,.35)';
          ctx.fill();
        }
      }
    }
    // the hub: PARRY — gold, and lit when her fire is in the air
    var winding = !!windingTelegraph(now);
    ctx.beginPath(); ctx.arc(wheel.ax, wheel.ay, R * 0.30, 0, Math.PI * 2);
    var hg2 = ctx.createRadialGradient(wheel.ax, wheel.ay, 2, wheel.ax, wheel.ay, R * 0.30);
    hg2.addColorStop(0, winding ? 'rgba(252,238,10,.5)' : 'rgba(60,50,16,.85)');
    hg2.addColorStop(1, 'rgba(14,12,4,.92)');
    ctx.fillStyle = hg2; ctx.fill();
    ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = (wheel.pick && wheel.pick.zone === 'hub') || winding ? 3 : 1.6;
    ctx.shadowColor = '#fcee0a'; ctx.shadowBlur = winding ? 18 : 6; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(wheel.ax, wheel.ay - 13);
    ctx.quadraticCurveTo(wheel.ax + 11, wheel.ay - 9, wheel.ax + 10, wheel.ay + 1);
    ctx.quadraticCurveTo(wheel.ax + 9, wheel.ay + 10, wheel.ax, wheel.ay + 15);
    ctx.quadraticCurveTo(wheel.ax - 9, wheel.ay + 10, wheel.ax - 10, wheel.ay + 1);
    ctx.quadraticCurveTo(wheel.ax - 11, wheel.ay - 9, wheel.ax, wheel.ay - 13);
    ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.font = '800 8.5px "Segoe UI",sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#fcee0a';
    ctx.fillText('FLARE', wheel.ax, wheel.ay + 26);
    ctx.restore();
  }

  function draw(nowPerf, dt) {
    var t = nowPerf / 1000;
    var now = S ? elapsed() : 0;
    ctx.clearRect(0, 0, W, H);
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#02030a'); bg.addColorStop(0.55, '#050914'); bg.addColorStop(1, '#0a0616');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // nebula washes — plum, teal, and the armada's ember breathing far off,
    // drifting a breath against the flight (the deepest parallax layer)
    var neb = function (x, y, r, color, a) {
      var g = ctx.createRadialGradient(x, y, 10, x, y, r);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
    };
    var nx = -scroll.x * 0.12, ny = -scroll.y * 0.12;
    neb(W * 0.78 + nx, H * 0.2 + ny, 330, 'rgba(120,50,180,0.55)', 0.17 + 0.03 * Math.sin(t * 0.4));
    neb(W * 0.16 - nx, H * 0.82 - ny, 310, 'rgba(20,120,140,0.5)', 0.14);
    neb(W * 0.55 + nx * 0.6, H * 0.42 + ny * 0.6, 390, 'rgba(255,90,40,0.4)', 0.08 + 0.02 * Math.sin(t * 0.3 + 2));
    // the streaming starfield: three layers; the nearer the star, the more
    // your flight moves it. This is the motion of the world.
    for (var i = 0; i < STARS.length; i++) {
      var st = STARS[i];
      var f = (st.layer + 1) / 3;
      var sx = (((st.x * W - scroll.x * f) % W) + W) % W;
      var sy = (((st.y * H + scroll.y * f) % H) + H) % H;
      var alpha = 0.35 + 0.55 * Math.abs(Math.sin(t * (0.6 + st.layer * 0.35) + st.tw));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = st.layer === 2 ? '#ffffff' : st.layer === 1 ? '#cfe4ff' : '#8fa8cc';
      var stretch = REDUCED ? 0 : Math.min(7, Math.abs(ship.vy) * 0.012 * f + Math.abs(ship.vx) * 0.004 * f);
      ctx.fillRect(sx, sy, st.r, st.r + stretch);
    }
    ctx.globalAlpha = 1;

    var shx = 0, shy = 0;
    if (S) {
      shx = REDUCED ? 0 : (Math.random() - 0.5) * S.shake;
      shy = REDUCED ? 0 : (Math.random() - 0.5) * S.shake;
      S.shake = Math.max(0, S.shake - dt * 26);
      S.flash = Math.max(0, S.flash - dt * 2.2);
      S.eyeRage = Math.max(0, S.eyeRage - dt * 0.5);
      S.hurt = Math.max(0, S.hurt - dt * 1.4);
    }
    var gear = (S && S.stats.gear) || {};
    var hullTrim = gear.body ? (TIER_TRIM[gear.body.tier] || '#8b98a9') : '#54627c';

    if (S) {
      var frac = S.hp / S.maxHp;
      var vuln = now >= S.vulnFrom && now <= S.vulnUntil;
      var winding = windingTelegraph(now);
      var windP = 0;
      if (winding) windP = 1 - Math.max(0, (winding.at - now) / S.combat.windupMs);
      var ships = enemyShips();
      ctx.save();
      ctx.translate(shx, shy);
      ships.forEach(function (sh) {
        if (sh.main && S.kind === 'capital') {
          segRing(sh.x, sh.y + 6, 190, frac, '#ff5a2a', t * 0.05);
          segRing(sh.x, sh.y + 6, 150, Math.max(0, frac * 1.06 - 0.05), '#d8a441', -t * 0.08);
        } else if (sh.main) {
          segRing(sh.x, sh.y, S.kind === 'squadrons' ? 96 : 104, frac, '#ff5a2a', t * 0.1);
        }
        var pulse = sh.main ? windP + S.eyeRage * 0.5 : 0.22;
        drawShip(sh.x, sh.y, sh.s, true, pulse, sh.main ? '#ff7a2a' : '#c2452e', t);
      });
      var ep = enemyPos();
      if (S.kind === 'capital') {
        ctx.font = '700 15px "Palatino Linotype",Georgia,serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,180,120,.85)';
        ctx.fillText('T H E   H E R A L D', ep.x, ep.y + 96);
      }
      // the wind-up: a contracting gold ring on the ship that's firing —
      // the flare's one warning, married to the projectile in flight
      if (winding) {
        var wship = ships[winding.shipIdx % ships.length] || ep;
        ctx.save();
        ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 3;
        ctx.shadowColor = '#fcee0a'; ctx.shadowBlur = 16;
        ctx.globalAlpha = 0.55 + 0.4 * Math.sin(t * 22);
        ctx.beginPath(); ctx.arc(wship.x, wship.y, 118 - windP * 60, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // Probe's mark: a targeting bracket that tightens on the hull
      if (now <= S.markUntil) {
        var inset = 30 + Math.min(18, (S.markUntil - now) / 220);
        ctx.save();
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2;
        ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 8;
        var bx = ep.x, by = ep.y, L = 13, iy = inset * 0.72;
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) {
          ctx.beginPath();
          ctx.moveTo(bx + c[0] * inset, by + c[1] * iy - c[1] * L);
          ctx.lineTo(bx + c[0] * inset, by + c[1] * iy);
          ctx.lineTo(bx + c[0] * inset - c[0] * L, by + c[1] * iy);
          ctx.stroke();
        });
        ctx.restore();
      }
      if (vuln) {
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.08 * Math.sin(t * 14);
        ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 2;
        var vr = S.kind === 'capital' ? 200 : 118;
        ctx.beginPath(); ctx.arc(ep.x, ep.y, vr, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // ---- your ship, its ghosts, and its shield
      if (now < S.phantomUntil) {
        var ph = phantomPos(t);
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.12 * Math.sin(t * 6);
        drawShip(ph.x, ph.y, 0.8, false, 0, '#fcee0a', t);
        ctx.restore();
      }
      if (now < S.plateUntil) {
        ctx.save();
        ctx.globalAlpha = 0.16 + 0.05 * Math.sin(t * 5);
        ctx.strokeStyle = '#b967ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ship.x, ship.y, 84, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // engine trail: flight leaves light behind
      var spd = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
      if (!REDUCED && spd > 130 && S.particles.length < 250) {
        S.particles.push({
          x: ship.x - 54, y: ship.y + (Math.random() - 0.5) * 8,
          vx: -ship.vx * 0.24 + (Math.random() - 0.5) * 22, vy: -ship.vy * 0.24 + (Math.random() - 0.5) * 22,
          life: 0.42, age: 0, color: Math.random() < 0.5 ? '#ff9a3c' : '#ffd166', r: 1 + Math.random() * 1.8
        });
      }
      ctx.save();
      ctx.translate(ship.x + shx - ship.recoil, ship.y + shy);
      ctx.rotate(ship.bank);
      ctx.translate(-(ship.x + shx - ship.recoil), -(ship.y + shy));
      drawShip(ship.x + shx - ship.recoil, ship.y + shy, 1.0, false, 0, hullTrim, t);
      ctx.restore();
      // muzzle bloom: the shot's birth-light
      if (S.muzzle && performance.now() < S.muzzle.until) {
        var mb = 1 - (S.muzzle.until - performance.now()) / 130;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var mg = ctx.createRadialGradient(ship.x + 56, ship.y - 4, 1, ship.x + 56, ship.y - 4, (S.muzzle.big ? 34 : 22) * (0.6 + mb * 0.4));
        mg.addColorStop(0, 'rgba(255,255,255,.9)');
        mg.addColorStop(0.3, S.muzzle.color);
        mg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.85 * (1 - mb * 0.6);
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(ship.x + 56, ship.y - 4, (S.muzzle.big ? 34 : 22), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // the shield flare: a gold hemisphere bloom at the parry's moment
      if (S.flareUntil && performance.now() < S.flareUntil) {
        var fa = 1 - (S.flareUntil - performance.now()) / 450;
        ctx.save();
        ctx.globalAlpha = 0.75 * (1 - fa);
        ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 4;
        ctx.shadowColor = '#fcee0a'; ctx.shadowBlur = 22;
        ctx.beginPath(); ctx.arc(ship.x + 30, ship.y, 46 + fa * 30, -1.2, 1.2); ctx.stroke();
        ctx.restore();
      }
      // ---- fire, both ways
      if (S.beam && performance.now() < S.beam.until) {
        ctx.save();
        ctx.strokeStyle = S.beam.color;
        ctx.shadowColor = S.beam.color; ctx.shadowBlur = 14;
        if (S.beam.tool === 'flood') {
          ctx.globalAlpha = 0.8; ctx.lineWidth = 2.5;
          [-12, 0, 12].forEach(function (off) {
            ctx.beginPath(); ctx.moveTo(ship.x + 56, ship.y + off * 0.4); ctx.lineTo(ep.x - 40, ep.y + off); ctx.stroke();
          });
        } else if (S.beam.tool === 'whisper') {
          ctx.globalAlpha = 0.22; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(ship.x + 56, ship.y - 8); ctx.lineTo(ep.x - 40, ep.y); ctx.stroke();
        } else {
          ctx.globalAlpha = 0.85; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(ship.x + 56, ship.y - 6); ctx.lineTo(ep.x - 30, ep.y - 4); ctx.stroke();
        }
        ctx.restore();
      }
      // your tracers, in flight
      tracers = tracers.filter(function (tr) {
        var age = performance.now() - tr.born;
        if (age > tr.life) return false;
        var p = age / tr.life;
        var hx = tr.x0 + (tr.x1 - tr.x0) * p, hy = tr.y0 + (tr.y1 - tr.y0) * p;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.9 * (1 - p * 0.4);
        ctx.strokeStyle = tr.color; ctx.lineWidth = tr.tool === 'flood' ? 2.4 : 1.8;
        ctx.shadowColor = tr.color; ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.moveTo(hx - (tr.x1 - tr.x0) * 0.09, hy - (tr.y1 - tr.y0) * 0.09);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.restore();
        return true;
      });
      // her projectiles, in flight — additive, tailed, honest
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      projectiles.forEach(function (p) {
        var tailX = p.x + (p.x0 - p.x) * 0.055, tailY = p.y + (p.y0 - p.y) * 0.055;
        if (p.s.kind === 'haymaker' || p.s.kind === 'feint') {
          var r = (p.flanker ? 4.5 : 6.5) + (p.t || 0) * 5;
          ctx.strokeStyle = 'rgba(255,140,50,.5)'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(p.x, p.y); ctx.stroke();
          var og = ctx.createRadialGradient(p.x, p.y, 0.5, p.x, p.y, r * 2.6);
          og.addColorStop(0, 'rgba(255,240,190,.98)');
          og.addColorStop(0.35, 'rgba(255,170,60,.85)');
          og.addColorStop(0.7, 'rgba(255,80,40,.4)');
          og.addColorStop(1, 'rgba(255,42,60,0)');
          ctx.fillStyle = og;
          ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2); ctx.fill();
        } else {
          var col = p.s.kind === 'glance' ? '#ffd166' : '#ff5a3c';
          ctx.strokeStyle = col; ctx.lineWidth = 3;
          ctx.shadowColor = col; ctx.shadowBlur = 10;
          ctx.globalAlpha = 0.92;
          ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.shadowBlur = 0; ctx.globalAlpha = 1;
          ctx.fillStyle = '#ffe9c9';
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
        }
      });
      ctx.restore();
      if (S.flash > 0) {
        ctx.fillStyle = 'rgba(255,220,160,' + (S.flash * 0.10) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      if (S.hurt > 0) {
        var hg3 = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75);
        hg3.addColorStop(0, 'rgba(255,42,60,0)');
        hg3.addColorStop(1, 'rgba(255,42,60,' + (S.hurt * 0.4) + ')');
        ctx.fillStyle = hg3; ctx.fillRect(0, 0, W, H);
      }
      S.particles = S.particles.filter(function (pt) {
        pt.age += dt;
        if (pt.age > pt.life) return false;
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        pt.vx *= 0.96; pt.vy *= 0.96;
        ctx.globalAlpha = 1 - pt.age / pt.life;
        ctx.fillStyle = pt.color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;
      S.texts = S.texts.filter(function (tx) {
        tx.age += dt;
        if (tx.age > tx.life) return false;
        var a = 1 - tx.age / tx.life;
        ctx.font = '700 19px "Arial Narrow","Avenir Next","Segoe UI",sans-serif';
        ctx.textAlign = 'center';
        var y = tx.y - tx.age * 26;
        if (tx.glitch) {
          var j = (Math.random() - 0.5) * 5;
          ctx.globalAlpha = a * 0.8; ctx.fillStyle = '#ff9a3c';
          ctx.fillText(tx.txt, W / 2 - 2 + j, y);
          ctx.fillStyle = '#ff2a3c';
          ctx.fillText(tx.txt, W / 2 + 2 - j, y);
        }
        ctx.globalAlpha = a;
        ctx.fillStyle = tx.color;
        ctx.fillText(tx.txt, W / 2, y);
        return true;
      });
      ctx.globalAlpha = 1;
      drawWheel(nowPerf);
    } else {
      // the pad, at rest: your ship hovers over a quiet sky
      ctx.save();
      ctx.translate(ship.x, ship.y + (REDUCED ? 0 : Math.sin(t * 1.3) * 3));
      ctx.translate(-ship.x, -(ship.y + (REDUCED ? 0 : Math.sin(t * 1.3) * 3)));
      drawShip(ship.x, ship.y + (REDUCED ? 0 : Math.sin(t * 1.3) * 3), 1.0, false, 0, hullTrim, t);
      ctx.restore();
    }
  }

  // ---------- the encounter ends; the sortie goes on (or doesn't) -------
  function endFight(reason) {
    if (S.over) return;
    S.over = true;
    S.endReason = reason;
    firing = false;
    closeWheel();
    el.shield.disabled = true;
    el.shield.classList.remove('armed');
    var durationMs = Math.round(elapsed());
    var damagePct = Math.round((1 - S.hp / S.maxHp) * 100);
    if (SFX) SFX.humStop();
    if (reason === 'breach') sfx('breach');
    else if (reason === 'trace') sfx('caught');
    else if (reason === 'integrity') sfx('thrownOut');
    else sfx('defeat');
    if (reason === 'breach') { for (var i = 0; i < 90; i++) hitFxSpark(); }
    fetch('/api/fight/finish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fightId: S.fightId, actions: S.actions,
        result: reason === 'breach' ? 'win' : 'lose', endReason: reason,
        durationMs: durationMs, damagePct: damagePct
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      handleEncounterEnd(d, reason);
    }).catch(function () { showSortieVerdict(null, reason, null); });
    updateHud(performance.now());
  }
  function hitFxSpark() {
    if (!S || S.particles.length > 260) return;
    var ep = enemyPos();
    var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
    S.particles.push({ x: ep.x, y: ep.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.8, age: 0, color: ['#ff9a3c', '#ff2a3c', '#fcee0a', '#d8a441'][Math.floor(Math.random() * 4)], r: 1.5 + Math.random() * 3 });
  }

  function handleEncounterEnd(d, localReason) {
    var dd = d.galactic || {};
    if (d.voided) { R.over = true; showSortieVerdict(d.verdict, localReason, d.voided); return; }
    R.score = dd.score != null ? dd.score : R.score;
    if (dd.sectorCleared) {
      R.haul = [];
      renderHaul();
      floatText('★ THE HERALD FALLS — YOUR HAUL BANKS ON THE SPOT', '#ffd166', true);
    }
    if (dd.drops && dd.drops.length) showLoot(dd.drops);
    if (dd.mods && dd.mods.length) showModLoot(dd.mods);
    updateRunLine();
    if (dd.over) { R.over = true; showSortieVerdict(d.verdict, localReason, null); return; }
    // The hinge of every sortie: press on, or bank it all.
    var next = R.encounter + 1;
    var nextLabel = STAGE_LABELS[next - 1] || 'the deep sky';
    el['gatechoice-text'].textContent = 'Stage ' + R.encounter + ' is cleared. You carry ' + R.haul.length + ' unbanked piece' + (R.haul.length === 1 ? '' : 's') +
      ' · integrity ' + dd.integrity + ' · attention ' + dd.trace + '%. Ahead is Stage ' + next + ' — ' + nextLabel + '. Withdraw, and everything you carry is yours for good.';
    el.gatechoice.classList.remove('rt-hidden');
    sfx('gatechoice');
  }

  function choose(choice) {
    el.gatechoice.classList.add('rt-hidden');
    sfx(choice === 'press' ? 'descend' : 'ascend');
    fetch('/api/galactic/choose', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortieId: R.sortieId, choice: choice })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { el.gatechoice.classList.remove('rt-hidden'); return; }
        if (choice === 'withdraw') { R.over = true; showSortieVerdict(res.d.verdict, 'withdraw', null); return; }
        beginEncounter(res.d, false);
      })
      .catch(function () { el.gatechoice.classList.remove('rt-hidden'); });
  }

  function showSortieVerdict(v, localReason, voided) {
    var html;
    if (!v) {
      html = '<div class="rt-card"><h2>THE SORTIE IS LOST TO THE DARK</h2><p class="dim">The verdict could not be recorded.</p><a class="fightbtn small" href="/galactic/fly">Fly again</a></div>';
    } else {
      var gv = v.galactic || {};
      var titles = { death: 'DESTROYED IN THE REACH', withdraw: 'YOU WITHDREW — THE HAUL IS YOURS', cleared: '★ SECTOR CLEARED — THE HERALD FALLS', turned: 'TURNED BACK FROM THE REACH', void: 'SORTIE VOIDED' };
      var title = titles[v.endReason] || (v.result === 'win' ? 'YOU WITHDREW' : 'TURNED BACK');
      var banked = (gv.banked || []).map(function (bp) {
        return '<span class="tierbadge t-' + bp.tier.toLowerCase() + '">' + esc(bp.name) + ' (' + bp.tier + (bp.serial ? ' No. ' + bp.serial : '') + ')</span>';
      }).join(' ');
      var lost = (gv.lost || []).map(function (bp) { return esc(bp.name) + ' (' + bp.tier + ')'; }).join(' · ');
      // THE PHASE 2 HOOK, landed on the clear: the Reach was a relay, and
      // what it served has the captain's name now. Story, not mechanics —
      // Sector 2 stays locked on the chart, and its lock wears the hook.
      var hook = gv.sectorCleared ?
        '<p class="v-name">✦ <strong>THE RELAY GOES DARK — AND SOMETHING BEYOND IT LOOKS UP.</strong> The Herald was never the Reach\'s master; it was a relay, repeating your shape to a deeper book. That book has your name in it now. On the chart, Sector 2\'s lock has changed its face: <strong>THE LEDGER HAS YOUR NAME NOW.</strong></p>' +
        (gv.firstClear ? '<p class="v-name">🖋 <strong>THE LEDGER\'S SEAL</strong> stands on this receipt — the tie-in mark of the first clearing, carried in the books beside your name and the date.</p>' : '') : '';
      html = '<div class="rt-card vcard ' + (v.result === 'win' ? 'win' : '') + '">' +
        '<h2 class="glitch">' + title + '</h2>' +
        '<p class="v-name">' + (voided ? 'That sortie\u2019s log did not hold up — remembered, but it taught nothing and earned nothing. ' : '') +
        'Stages cleared ' + (gv.encountersCleared || 0) + ' · deepest Stage ' + (gv.deepest || 0) + ' · score ' + (gv.score || 0) + ' · capitals slain ' + (gv.capitalsSlain || 0) + '</p>' +
        (gv.sectorCleared ? '<p class="v-name">★ <strong>SECTOR 1 — EMBERFALL REACH — IS CLEARED</strong>' + (gv.firstClear ? ' — your first clearing, receipted in the books, named and dated and permanent.' : ' — the Reach stays cleared on your chart, and its armada flies a notch quieter for you now.') + '</p>' : '') +
        hook +
        (v.xp ? '<p class="v-name">+' + v.xp + ' XP' + (v.emberBonus ? ' (Founder\u2019s Ember +10%)' : '') + (v.levelUp ? ' — <strong>LEVEL UP</strong>' : '') + ' · +' + v.points + ' points</p>' : '') +
        (banked ? '<p class="v-name">Banked: ' + banked + '</p>' : '<p class="v-name">Nothing banked.</p>') +
        (lost ? '<p class="v-name bad">Lost among the stars: ' + lost + '</p>' : '') +
        '<div class="v-actions"><a class="fightbtn small" href="/verdict/' + v.id + '">Full after-action report</a>' +
        '<a class="ghostbtn" href="/galactic/fly">Fly again</a>' +
        '<a class="ghostbtn" href="/galactic">The star map</a>' +
        '<a class="ghostbtn" href="/galactic/bridge">The Bridge</a></div></div>';
    }
    el.verdict.innerHTML = html;
    el.verdict.classList.remove('rt-hidden');
    sfx(v && v.result === 'win' ? 'verdictWin' : 'verdictLose');
  }

  // ---------- init: build the layer, or stand down and let the classic --
  // deck underneath be the battle (the fail-soft law).
  try {
    buildDom();
    fit();
    window.addEventListener('resize', fit);
    // The pad wears the captain's own record and armory, mirrored from the
    // classic pad underneath — one book, two dresses.
    var rec = document.querySelector('.descent-record');
    if (rec) el.record.innerHTML = rec.outerHTML;
    var arm = document.querySelector('.gfly .armory');
    if (arm) {
      var clone = arm.cloneNode(true);
      clone.removeAttribute('data-armory');
      var tg = clone.querySelector('[data-armory-toggle]');
      if (tg) tg.remove();
      el.armory.appendChild(clone);
    }
    var h2 = document.querySelector('#stage-msg h2');
    if (h2) el['pad-title'].textContent = h2.textContent.replace('Your ship is on the pad', 'Your ship is on the pad');
    if (SFX) el.mutebtn.textContent = SFX.isMuted() ? 'SOUND OFF' : 'SOUND ON';
    document.body.classList.add('rt-on');
    window.TA_RT_ACTIVE = true;
    requestAnimationFrame(frame);
  } catch (err) {
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    window.TA_RT_ACTIVE = false;
  }
})();
