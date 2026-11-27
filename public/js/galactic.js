'use strict';
// THE GALACTIC — the war in the sky. Same Command Deck, same server
// referee, a different theater: open space, your ship low-left, the armada
// high-right, and the Trace wearing a sector's sky as ARMADA ATTENTION.
// A sortie is a chain of encounters; integrity and attention carry across
// it; at every cleared encounter the captain chooses — press on, withdraw.
(function () {
  var canvas = document.getElementById('gate');
  if (!canvas) return;
  // THE REAL-TIME LAYER (galactic-rt.js) loads first: if it initialized,
  // it owns this sky and the classic deck stands down — the fail-soft law.
  // If it could not initialize, TA_RT_ACTIVE is never set and this deck
  // is the battle, whole and referee-true, exactly as before.
  if (window.TA_RT_ACTIVE) return;
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var startBtn = document.getElementById('startbtn');
  var stageMsg = document.getElementById('stage-msg');
  var verdictEl = document.getElementById('verdict');
  var kitEl = document.getElementById('kit');
  var abilitiesEl = document.getElementById('abilities');
  var modrailEl = document.getElementById('modrail');
  var twinreadEl = document.getElementById('twinread');
  var winframeEl = document.getElementById('winframe');
  var winframeBar = document.getElementById('winframe-bar');
  var parryBtn = document.getElementById('parrybtn');
  var hpbar = document.getElementById('hpbar'), hptext = document.getElementById('hptext');
  var intbar = document.getElementById('intbar'), inttext = document.getElementById('inttext');
  var enbar = document.getElementById('enbar'), entext = document.getElementById('entext');
  var tracebar = document.getElementById('tracebar'), tracetext = document.getElementById('tracetext');
  var tracewrap = document.getElementById('tracewrap');
  var clockEl = document.getElementById('clock');
  var bossplateEl = document.getElementById('bossplate');
  var lootlayerEl = document.getElementById('lootlayer');
  var gatechoiceEl = document.getElementById('gatechoice');
  var gatechoiceText = document.getElementById('gatechoice-text');
  var depthbannerEl = document.getElementById('depthbanner');
  var haulfeedEl = document.getElementById('haulfeed');
  var runlineEl = document.getElementById('runline');
  var descendBtn = document.getElementById('descend-btn');
  var ascendBtn = document.getElementById('ascend-btn');
  var abandonBtn = document.getElementById('abandonbtn');

  var S = null;   // the current encounter's fight state (mirrors the referee)
  var R = null;   // the sortie: { sortieId, encounter, score, haul: [], over }
  var SFX = window.TASFX || null;
  function sfx(name) { if (SFX) SFX.play(name); }
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var TIER_TRIM = { STURDY: '#cfd6dd', RARE: '#3fa9ff', EPIC: '#b967ff', LEGENDARY: '#ffd700', GODFORGED: '#fff3c4' };
  var LADDER_LABELS = ['PICKET FRIGATE', 'PICKET FRIGATE', 'PATROL PAIR', 'MIRAGE WING', 'PATROL PAIR', 'MIRAGE WING', 'MIRAGE WING', 'THE HERALD — CAPITAL OF THE REACH'];
  // The starfield, seeded once: three parallax layers, far to near.
  var STARS = [];
  (function () {
    var a = 1234567;
    function rnd() { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    for (var i = 0; i < 130; i++) STARS.push({ x: rnd() * W, y: rnd() * H, r: 0.6 + rnd() * 1.7, layer: i % 3, tw: rnd() * 6.28 });
  })();

  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function elapsed() { return performance.now() - S.startedAt; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var TOOL_ICONS = {
    probe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    flood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5v3.5"/><path d="M5.5 4.5l2 2.5M18.5 4.5l-2 2.5"/><path d="M2.5 14.5c2.4 0 2.4 1.8 4.8 1.8s2.4-1.8 4.8-1.8 2.4 1.8 4.8 1.8 2.4-1.8 4.6-1.8"/><path d="M2.5 19c2.4 0 2.4 1.8 4.8 1.8S9.7 19 12.1 19s2.4 1.8 4.8 1.8 2.4-1.8 4.6-1.8"/></svg>',
    whisper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><path d="M12.5 8.8a4.6 4.6 0 0 1 0 6.4M15.8 6.2a8.4 8.4 0 0 1 0 11.6M19 3.8a12.2 12.2 0 0 1 0 16.4"/></svg>',
    decoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 21v-7.5a7.5 7.5 0 0 1 15 0V21"/><path d="M9.3 21v-4.8a2.7 2.7 0 0 1 5.4 0V21"/><path d="M2.5 21h19"/></svg>'
  };

  // ---------- the sortie ----------
  startBtn.addEventListener('click', function () {
    if (SFX) SFX.unlock();
    startBtn.disabled = true;
    startBtn.textContent = 'THE PAD STIRS…';
    fetch('/api/galactic/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          startBtn.disabled = false; startBtn.textContent = '🚀 BEGIN THE SORTIE';
          var p = stageMsg.querySelector('p');
          if (p) p.textContent = res.d.message || res.d.error || 'The pad would not open.';
          return;
        }
        R = { sortieId: res.d.galactic.sortieId, encounter: 0, score: 0, haul: [], over: false };
        if (abandonBtn) abandonBtn.classList.remove('hidden');
        beginEncounter(res.d, true);
      })
      .catch(function () { startBtn.disabled = false; startBtn.textContent = '🚀 BEGIN THE SORTIE'; });
  });

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
      strikes: (d.strikes || []).map(function (s) { return { at: s.at, kind: s.kind, tool: s.tool, revealed: !!s.revealed, parried: false, eaten: false, done: false }; }),
      postMorph: [], morphed: false,
      vulnFrom: -1, vulnUntil: -1, parryCdUntil: 0,
      alarmStage: 0, crackStage: 0,
      shake: 0, flash: 0, eyeRage: 0, hurt: 0, over: false, endReason: null,
      particles: [], texts: [], phantomUntil: 0, beam: null, strikeFx: null,
      famShown: {}, uses: {},
      abilityCds: {}, ghostCharges: 0, rapidUntil: 0, secondWindUsed: false,
      lastProbeAt: -1e9, lastDecoyAt: -1e9, windowCalled: false,
      // the Galactic's own state
      kind: dd.kind || 'pickets', boss: dd.boss || null,
      encounter: dd.encounter || 1, attention: dd.attention || 0,
      // MODS v1 — the systems row's purse and hidden feeds, referee-mirrored
      modCharges: {}, overclockArmed: false,
      payback: 0, paybackPhantomUntil: 0, plateFed: 0, plateUntil: 0
    };
    var dep0 = (st.mods && st.mods.deploy) || {};
    for (var mid0 in dep0) S.modCharges[mid0] = dep0[mid0].charges || 0;
    for (var id in st.tools) S.famShown[id] = st.tools[id].familiarity;
    stageMsg.classList.add('hidden');
    verdictEl.classList.add('hidden');
    gatechoiceEl.classList.add('hidden');
    parryBtn.disabled = false;
    buildKit(st);
    buildAbilities(st);
    buildModRail(st);
    updateTwinRead();
    updateRunLine();
    clockEl.textContent = fmtClock(S.left);
    showEncounterBanner(dd);
    if (dd.boss) showBossPlate(dd.boss);
    sfx(dd.boss ? 'boss' : 'begin');
    if (SFX) SFX.humStart();
    requestAnimationFrame(frame);
  }

  function showEncounterBanner(dd) {
    if (!depthbannerEl) return;
    var label = 'ENCOUNTER ' + dd.encounter + ' — ' + (LADDER_LABELS[(dd.encounter || 1) - 1] || 'ARMADA CONTACT');
    depthbannerEl.textContent = label;
    depthbannerEl.classList.remove('hidden');
    depthbannerEl.classList.remove('show'); void depthbannerEl.offsetWidth;
    depthbannerEl.classList.add('show');
    setTimeout(function () { depthbannerEl.classList.add('hidden'); }, 2600);
  }
  function showBossPlate(boss) {
    if (!bossplateEl) return;
    bossplateEl.innerHTML = '<div class="bossplate-inner"><span class="boss-tag">THE CAPITAL OF THE REACH — FLAGSHIP SYSTEM</span>' +
      '<h2>' + esc(boss.name) + '</h2><p>' + esc(boss.line) + '</p><p class="boss-sub">BREACH IT, AND THE SECTOR IS YOURS</p></div>';
    bossplateEl.classList.remove('hidden');
    setTimeout(function () { bossplateEl.classList.add('hidden'); }, 5200);
  }
  function updateRunLine() {
    if (!runlineEl || !R) return;
    runlineEl.textContent = 'Encounter ' + (R.encounter || '—') + ' of 8 · Score ' + R.score + ' · Carrying ' +
      (R.haul.length ? R.haul.length + ' piece' + (R.haul.length === 1 ? '' : 's') + ' unbanked' : 'nothing');
  }
  function renderHaul() {
    if (!haulfeedEl) return;
    if (!R || !R.haul.length) { haulfeedEl.innerHTML = '<li class="dim">Empty hold. The Reach provides.</li>'; return; }
    haulfeedEl.innerHTML = R.haul.map(function (p) {
      return '<li class="gearline t-' + p.tier.toLowerCase() + '"><strong>' + esc(p.name) + '</strong> ' +
        '<span class="tierbadge t-' + p.tier.toLowerCase() + '">' + p.tier + '</span>' +
        (p.serial ? ' No. ' + p.serial : '') + ' · ' + esc(p.slot) + '</li>';
    }).join('');
  }
  function showLoot(drops) {
    if (!drops || !drops.length) return;
    drops.forEach(function (p, i) {
      R.haul.push(p);
      if (lootlayerEl) {
        var beam = document.createElement('div');
        beam.className = 'beam t-' + p.tier.toLowerCase();
        beam.style.left = (12 + i * 22) + '%';
        beam.innerHTML = '<i></i><span>' + esc(p.name) + (p.serial ? ' No. ' + p.serial : '') + '<br><b>' + p.tier + '</b></span>';
        lootlayerEl.appendChild(beam);
        setTimeout(function () { beam.classList.add('fade'); }, 2900);
        setTimeout(function () { beam.remove(); }, 3600);
      }
      sfx(p.tier === 'LEGENDARY' ? 'legendary' : p.tier === 'EPIC' ? 'lootEpic' : p.tier === 'RARE' ? 'lootRare' : 'lootSturdy');
    });
    renderHaul();
    updateRunLine();
  }
  function showModLoot(mods) {
    if (!mods || !mods.length) return;
    mods.forEach(function (m, i) {
      if (lootlayerEl) {
        var beam = document.createElement('div');
        beam.className = 'beam t-mod';
        beam.style.left = (30 + i * 22) + '%';
        beam.style.setProperty('--bc', m.kind === 'fitted' ? '#00e5ff' : '#b967ff');
        beam.innerHTML = '<i></i><span>' + esc(m.name) + '<br><b>' + (m.kind === 'fitted' ? 'FITTED MOD — BANKED' : 'SYSTEMS MOD — BANKED') + '</b></span>';
        lootlayerEl.appendChild(beam);
        setTimeout(function () { beam.classList.add('fade'); }, 2900);
        setTimeout(function () { beam.remove(); }, 3600);
      }
      floatText('MOD BANKED — ' + m.name, '#b967ff', true);
      sfx('lootEpic');
    });
  }

  // ---------- the command deck (mirrors the arena's, referee-true) ----------
  function buildKit(st) {
    kitEl.innerHTML = '';
    Object.keys(st.tools).forEach(function (id) {
      var t = st.tools[id];
      var b = document.createElement('button');
      b.className = 'tool';
      b.id = 'tool-' + id;
      b.style.setProperty('--tc', t.color);
      var traceTxt = t.trace > 0 ? '+' + t.trace + '% attention' : (t.trace < 0 ? t.trace + '% attention' : 'no attention');
      b.innerHTML = '<span class="ticon">' + (TOOL_ICONS[id] || '') + '</span>' +
        '<span class="tname" style="color:' + t.color + '">' + t.name + '</span>' +
        '<span class="tdmg">DMG ' + t.dmg + (t.dot ? ' +' + t.dot + '/s burn' : '') + '</span>' +
        '<span class="tcost">' + t.cost + ' energy · ' + (t.cooldown / 1000).toFixed(1) + 's</span>' +
        '<span class="ttrace" style="color:' + (t.trace > 0 ? '#ff2a6d' : '#5dffa0') + '">' + traceTxt + '</span>' +
        (t.gear ? '<span class="tgear">⚜ ' + esc(t.gear.name) + ' (' + t.gear.tier + ')</span>' : '') +
        (t.mod ? '<span class="tmod" style="--mc:' + t.mod.color + '">' + t.mod.sigil + ' ' + esc(t.mod.name) + ' — HARDPOINT</span>' : '') +
        '<span class="tfam">Armada attention <b data-fam>' + Math.round(t.familiarity * 100) + '%</b></span>' +
        '<span class="noenergy hidden">not enough energy</span>' +
        '<span class="cdveil"></span>';
      b.title = t.blurb;
      b.addEventListener('click', function () { useTool(id); });
      kitEl.appendChild(b);
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
    if (!twinreadEl || !S) return;
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
    twinreadEl.textContent = lines.join(' ');
  }
  function buildAbilities(st) {
    if (!abilitiesEl) return;
    abilitiesEl.innerHTML = '';
    var abs = st.abilities || {};
    Object.keys(abs).forEach(function (id) {
      var a = abs[id];
      var b = document.createElement('button');
      b.className = 'tool ability'; b.id = 'ability-' + id;
      b.style.setProperty('--tc', a.color);
      var detail = id === 'overdrive' ? 'DMG ' + a.dmg : id === 'secondwind' ? '+' + a.heal + ' integrity · once' :
        id === 'ghost' ? 'next ' + (a.charges || 3) + ' strikes traceless' : 'cooldowns halved ' + ((a.windowMs || 8000) / 1000) + 's';
      b.innerHTML = '<span class="tname" style="color:' + a.color + '">✦ ' + a.name + '</span>' +
        '<span class="tdmg">' + detail + '</span>' +
        '<span class="tcost">' + a.cost + ' energy · ' + (a.cooldown / 1000).toFixed(0) + 's cd</span>' +
        '<span class="ttrace" style="color:' + (a.trace > 0 ? '#ff2a6d' : '#5dffa0') + '">' + (a.trace > 0 ? '+' + a.trace + '% attention' : 'no attention') + '</span>' +
        '<span class="noenergy hidden">not enough energy</span>' +
        '<span class="cdveil"></span>';
      b.title = a.blurb;
      b.addEventListener('click', function () { useAbility(id); });
      abilitiesEl.appendChild(b);
    });
  }
  // ---------- MODS v1: the systems row under the pods ----------
  function buildModRail(st) {
    if (!modrailEl) return;
    modrailEl.innerHTML = '';
    var dep = (st.mods && st.mods.deploy) || {};
    Object.keys(dep).forEach(function (id) {
      var m = dep[id];
      var b = document.createElement('button');
      b.className = 'tool mod'; b.id = 'mod-' + id;
      b.style.setProperty('--mc', m.color);
      var pips = '';
      for (var i = 0; i < (m.charges || 0); i++) pips += '<span class="pip full"></span>';
      b.innerHTML = '<span class="tname" style="color:' + m.color + '">' + m.sigil + ' ' + m.name + '</span>' +
        '<span class="tdmg">' + (id === 'overclock' ? 'next strike hasted' : id === 'tracepurge' ? 'attention −35% now' :
          id === 'ghostplate' ? 'blows feed a hidden plate · 8s' : 'its next strike lands late') + '</span>' +
        '<span class="pips">' + pips + '</span>';
      b.title = m.line;
      b.addEventListener('click', function () { fireMod(id); });
      modrailEl.appendChild(b);
    });
  }
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
      hitFx(dmg * crit + odBonus, a.color, 60);
      S.shake = Math.min(18, S.shake + 12);
      floatText('OVERDRIVE ' + Math.round(dmg * crit + odBonus), '#ff2a6d', true);
      sfx('overdrive');
    }
    updateKit();
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
  parryBtn.addEventListener('click', tryParry);

  function resolveStrike(s, now) {
    s.done = true;
    var cb = S.combat;
    if (s.kind === 'feint') {
      if (!s.parried) floatText('A WIND-UP… THAT NEVER CAME', '#b967ff', false);
      return;
    }
    if (s.kind === 'haymaker') {
      if (s.parried) {
        S.vulnFrom = s.at; S.vulnUntil = s.at + cb.vulnMs;
        S.flareUntil = performance.now() + 450;
        floatText('FLARED — ITS HULL IS OPEN. HIT IT.', '#fcee0a', true);
        S.eyeRage = 1;
        sfx('parry');
        return;
      }
      if (s.eaten) { floatText('THE DECOY TOOK THE HIT', '#fcee0a', false); sfx('decoyEat'); return; }
      hurt(cb.strikeDmg.haymaker, 'HAYMAKER CONNECTS −' + cb.strikeDmg.haymaker, true);
      sfx('haymakerHit');
      return;
    }
    if (s.kind === 'glance') {
      var tool = S.stats.tools[s.tool] ? s.tool : 'probe';
      if (S.stats.tools[tool] && S.stats.tools[tool].silent) {
        floatText('GLANCE — ' + S.stats.tools[tool].name.toUpperCase() + ' IS SILENT. NOTHING SCRAMBLES.', '#b967ff', true);
        hurt(cb.strikeDmg.glance, null, false);
        sfx('hitPlayer');
        return;
      }
      var ready = S.lastUse[tool] !== undefined ? S.lastUse[tool] + S.stats.tools[tool].cooldown : now;
      S.lockouts[tool] = Math.max(ready, now) + cb.scrambleMs;
      var b = document.getElementById('tool-' + tool);
      if (b) { b.classList.remove('scrambled'); void b.offsetWidth; b.classList.add('scrambled'); }
      floatText('GLANCE — ' + S.stats.tools[tool].name.toUpperCase() + ' SCRAMBLED', '#ffd166', true);
      hurt(cb.strikeDmg.glance, null, false);
      sfx('scramble');
      return;
    }
    hurt(cb.strikeDmg.clean, null, false);
    S.strikeFx = { until: performance.now() + 160 };
    sfx('hitPlayer');
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

  // ---------- staging geometry (the battle is open space) ----------
  function playerPos() { return { x: 150, y: H - 140 }; }
  function enemyPos() {
    if (!S) return { x: W - 230, y: 150 };
    if (S.kind === 'capital') return { x: W / 2 + 40, y: 116 };
    if (S.kind === 'squadrons') return { x: W - 250, y: 148 };
    return { x: W - 235, y: 150 };
  }

  // ---------- your side ----------
  function useTool(id) {
    if (!S || S.over) return;
    var now = elapsed();
    var t = S.stats.tools[id];
    if (S.cds[id] && now < S.cds[id]) return;
    if (S.lockouts[id] && now < S.lockouts[id]) return;
    if (S.energy < t.cost) { sfx('deny'); return; }
    S.energy -= t.cost;
    S.cds[id] = now + (now <= S.rapidUntil ? t.cooldown * 0.5 : t.cooldown);
    if (S.overclockArmed) { S.cds[id] = now + (S.cds[id] - now) * 0.5; S.overclockArmed = false; }
    S.lastUse[id] = now;
    S.actions.push({ t: Math.round(now), tool: id });
    S.uses[id] = (S.uses[id] || 0) + 1;

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
      S.beam = { until: performance.now() + 140, color: t.color, tool: 'probe' };
      hitFx(dmg * crit + modBonus, t.color, 10);
      sfx('probe');
    } else if (id === 'flood') {
      S.beam = { until: performance.now() + 200, color: t.color, tool: 'flood' };
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
    updateKit();
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
    var room = Math.max(0, 240 - S.particles.length);
    var count = Math.min(n, room);
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 190;
      S.particles.push({
        x: ep.x + Math.cos(a) * 40, y: ep.y + Math.sin(a) * 26,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.6, age: 0, color: color, r: 1 + Math.random() * 2.6
      });
    }
    if (S.hp <= 0) endFight('breach');
  }
  function floatText(txt, color, glitch) {
    var ep = enemyPos();
    S.texts.push({ txt: txt, color: color, glitch: !!glitch, age: 0, life: 1.6, y: ep.y - 90 - Math.random() * 40 });
  }
  canvas.addEventListener('pointerdown', function () {
    if (!S || S.over) return;
    if (windingTelegraph(elapsed())) tryParry(); else useTool('probe');
  });
  document.addEventListener('keydown', function (e) {
    if (!S || S.over) return;
    if (e.key === ' ' || e.key === 'p' || e.key === 'P') { e.preventDefault(); tryParry(); return; }
    var ids = ['probe', 'flood', 'whisper', 'decoy'];
    var i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0) useTool(ids[i]);
  });

  // ---------- frame ----------
  function frame(nowPerf) {
    if (!S) return;
    var dt = Math.min(0.05, (nowPerf - S.lastFrame) / 1000);
    S.lastFrame = nowPerf;
    if (!S.over) {
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
      for (var i = 0; i < S.strikes.length && !S.over; i++) {
        var s = S.strikes[i];
        if (!s.done && now >= s.at) resolveStrike(s, now);
      }
      if (!S.over && S.left <= 0 && S.hp > 0) { S.left = 0; endFight('timeout'); }
      updateHud();
      updateKit();
    }
    draw(nowPerf, dt);
    if (!S.over || S.particles.length) requestAnimationFrame(frame);
  }

  function updateHud() {
    hpbar.style.width = (S.hp / S.maxHp * 100) + '%';
    hptext.textContent = Math.ceil(S.hp);
    intbar.style.width = (S.integrity / S.maxIntegrity * 100) + '%';
    inttext.textContent = Math.ceil(S.integrity);
    enbar.style.width = (S.energy / S.stats.energyMax * 100) + '%';
    entext.textContent = Math.floor(S.energy);
    tracebar.style.width = S.trace + '%';
    tracetext.textContent = Math.floor(S.trace) + '%';
    tracewrap.classList.toggle('hot', S.trace > 75);
    tracetext.classList.toggle('hot', S.trace > 75);
    clockEl.textContent = fmtClock(S.left);
    clockEl.classList.toggle('low', S.left < 20000);
    var nowH = elapsed();
    var winding = !S.over && !!windingTelegraph(nowH);
    parryBtn.classList.toggle('armed', winding);
    var charge = document.getElementById('parry-charge');
    if (charge) {
      var cdFrac = S.parryCdUntil > nowH ? 1 - (S.parryCdUntil - nowH) / S.combat.parryCooldown : 1;
      charge.style.width = Math.round(Math.max(0, Math.min(1, cdFrac)) * 100) + '%';
    }
    if (winframeEl) {
      var inWin = !S.over && nowH >= S.vulnFrom && nowH <= S.vulnUntil;
      winframeEl.classList.toggle('hidden', !inWin);
      if (inWin && winframeBar) {
        var span = Math.max(1, S.vulnUntil - S.vulnFrom);
        winframeBar.style.width = Math.round(Math.max(0, (S.vulnUntil - nowH) / span) * 100) + '%';
      }
    }
    if (modrailEl && S.stats.mods && S.stats.mods.deploy) {
      Object.keys(S.stats.mods.deploy).forEach(function (id) {
        var b = document.getElementById('mod-' + id);
        if (!b) return;
        var left = S.modCharges[id] || 0;
        b.disabled = left <= 0 || S.over;
        b.classList.toggle('spent', left <= 0);
        b.classList.toggle('armed', (id === 'overclock' && S.overclockArmed) || (id === 'ghostplate' && elapsed() < S.plateUntil));
        var pips = b.querySelectorAll('.pip');
        for (var i = 0; i < pips.length; i++) pips[i].classList.toggle('full', i < left);
      });
    }
    if (abilitiesEl && S.stats.abilities) {
      Object.keys(S.stats.abilities).forEach(function (id) {
        var b = document.getElementById('ability-' + id);
        if (!b) return;
        var a = S.stats.abilities[id];
        var cdLeft = S.abilityCds[id] ? Math.max(0, S.abilityCds[id] - nowH) : 0;
        var spent = id === 'secondwind' && S.secondWindUsed;
        b.disabled = cdLeft > 0 || spent || S.energy < a.cost;
        b.classList.toggle('spent', !!spent);
        b.querySelector('.cdveil').style.width = (cdLeft > 0 ? (cdLeft / a.cooldown * 100) : 0) + '%';
        var ne = b.querySelector('.noenergy');
        if (ne) ne.classList.toggle('hidden', S.energy >= a.cost);
      });
    }
  }
  function updateKit() {
    if (!S) return;
    var now = elapsed();
    Object.keys(S.stats.tools).forEach(function (id) {
      var b = document.getElementById('tool-' + id);
      if (!b) return;
      var t = S.stats.tools[id];
      var cdLeft = S.cds[id] ? Math.max(0, S.cds[id] - now) : 0;
      var lockLeft = S.lockouts[id] ? Math.max(0, S.lockouts[id] - now) : 0;
      b.disabled = cdLeft > 0 || lockLeft > 0 || S.energy < t.cost;
      b.classList.toggle('locked', lockLeft > 0);
      var total = Math.max(t.cooldown, cdLeft, lockLeft);
      b.querySelector('.cdveil').style.width = (Math.max(cdLeft, lockLeft) > 0 ? (Math.max(cdLeft, lockLeft) / total * 100) : 0) + '%';
      b.querySelector('[data-fam]').textContent = Math.round(S.famShown[id] * 100) + '%';
      b.querySelector('.noenergy').classList.toggle('hidden', S.energy >= t.cost);
    });
  }

  // ---------- drawing the sky ----------
  // Ember-and-void: deep blue-black space, plum and teal nebulae, starlight,
  // and the armada's ember-red as the one warm threat color. Your ship is
  // composed from your build — hull trim and mount tips wear your gear's
  // tier colors, exactly as the Bridge draws it. Capital ships fill the
  // top of the sky. You are small; they are not.
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
  function drawFrigate(x, y, s, enemy, corePulse, trim) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(enemy ? -s : s, s);
    // swept whisper-fins
    ctx.beginPath();
    ctx.moveTo(-38, -10); ctx.lineTo(-58, -30); ctx.lineTo(-18, -14); ctx.closePath();
    ctx.moveTo(-38, 10); ctx.lineTo(-58, 30); ctx.lineTo(-18, 14); ctx.closePath();
    ctx.fillStyle = enemy ? '#160b10' : '#10182a';
    ctx.strokeStyle = trim; ctx.lineWidth = 1.6; ctx.fill(); ctx.stroke();
    // the hull
    var hg = ctx.createLinearGradient(0, -20, 0, 20);
    if (enemy) { hg.addColorStop(0, '#2a1216'); hg.addColorStop(0.55, '#180a10'); hg.addColorStop(1, '#0a0508'); }
    else { hg.addColorStop(0, '#232f47'); hg.addColorStop(0.55, '#131a2a'); hg.addColorStop(1, '#0a0e18'); }
    ctx.beginPath();
    ctx.moveTo(-56, 0); ctx.lineTo(-28, -15); ctx.lineTo(26, -19); ctx.lineTo(58, 0); ctx.lineTo(26, 19); ctx.lineTo(-28, 15); ctx.closePath();
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = trim; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-30, -8); ctx.lineTo(30, -11); ctx.moveTo(-30, 8); ctx.lineTo(30, 11);
    ctx.strokeStyle = enemy ? 'rgba(255,90,40,.35)' : 'rgba(120,160,220,.22)'; ctx.lineWidth = 1.2; ctx.stroke();
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
      // running lights
      ctx.fillStyle = 'rgba(255,60,50,.9)';
      ctx.fillRect(38, -13, 3, 3); ctx.fillRect(38, 10, 3, 3);
    } else {
      ctx.beginPath(); ctx.ellipse(20, -5, 13, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(185,103,255,.85)'; ctx.fill();
      // weapon mount tips wear the gear's own colors
      var gear = (S && S.stats.gear) || {};
      var tip = function (slot, tx, ty) {
        ctx.fillStyle = gear[slot] ? (TIER_TRIM[gear[slot].tier] || '#8b98a9') : '#54627c';
        ctx.beginPath(); ctx.arc(tx, ty, 2.6, 0, Math.PI * 2); ctx.fill();
      };
      tip('probe', 57, -3); tip('flood', 34, 14); tip('whisper', -52, -26); tip('decoy', -40, 20);
      // engine flame, breathing
      var fl = 12 + Math.sin(performance.now() * 0.03) * 4 + (S && S.flash > 0.2 ? 6 : 0);
      var eg = ctx.createRadialGradient(-58, 0, 1, -58, 0, 24);
      eg.addColorStop(0, 'rgba(255,209,102,.9)'); eg.addColorStop(0.5, 'rgba(255,122,42,.5)'); eg.addColorStop(1, 'rgba(255,122,42,0)');
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(-58, 0, 24, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-56, -6); ctx.lineTo(-56 - fl, 0); ctx.lineTo(-56, 6); ctx.closePath();
      ctx.fillStyle = '#ffb35c'; ctx.fill();
    }
    ctx.restore();
  }
  function draw(nowPerf, dt) {
    var now = S ? elapsed() : 0;
    ctx.clearRect(0, 0, W, H);
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#02030a'); bg.addColorStop(0.55, '#050914'); bg.addColorStop(1, '#0a0616');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // nebula washes — plum, teal, and the armada's ember breathing far off
    var t = nowPerf / 1000;
    var neb = function (x, y, r, color, a) {
      var g = ctx.createRadialGradient(x, y, 10, x, y, r);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
    };
    neb(W * 0.78, H * 0.2, 320, 'rgba(120,50,180,0.55)', 0.16 + 0.03 * Math.sin(t * 0.4));
    neb(W * 0.16, H * 0.82, 300, 'rgba(20,120,140,0.5)', 0.13);
    neb(W * 0.55, H * 0.4, 380, 'rgba(255,90,40,0.4)', 0.07 + 0.02 * Math.sin(t * 0.3 + 2));
    // the starfield — three layers, near stars drift faster (parallax)
    for (var i = 0; i < STARS.length; i++) {
      var st = STARS[i];
      var speed = REDUCED ? 0 : (st.layer + 1) * 3.2;
      var sy = (st.y + nowPerf * 0.001 * speed * 10) % (H + 4);
      var alpha = 0.35 + 0.55 * Math.abs(Math.sin(t * (0.6 + st.layer * 0.35) + st.tw));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = st.layer === 2 ? '#ffffff' : st.layer === 1 ? '#cfe4ff' : '#8fa8cc';
      ctx.fillRect(st.x, sy, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    if (!S) return;
    var pp = playerPos(), ep = enemyPos();
    pp.y += REDUCED ? 0 : Math.sin(t * 1.3) * 3;
    var shx = REDUCED ? 0 : (Math.random() - 0.5) * S.shake;
    var shy = REDUCED ? 0 : (Math.random() - 0.5) * S.shake;
    S.shake = Math.max(0, S.shake - dt * 26);
    S.flash = Math.max(0, S.flash - dt * 2.2);
    S.eyeRage = Math.max(0, S.eyeRage - dt * 0.5);
    S.hurt = Math.max(0, S.hurt - dt * 1.4);
    var frac = S.hp / S.maxHp;
    var vuln = now >= S.vulnFrom && now <= S.vulnUntil;
    var winding = windingTelegraph(now);
    var windP = 0;
    if (winding) windP = 1 - Math.max(0, (winding.at - now) / S.combat.windupMs);
    var gear = S.stats.gear || {};
    var hullTrim = gear.body ? (TIER_TRIM[gear.body.tier] || '#8b98a9') : '#54627c';

    // ---- the armada (high-right; the capital fills the top of the sky)
    ctx.save();
    ctx.translate(shx, shy);
    if (S.kind === 'capital') {
      // halo of ember rings behind the dreadnought
      segRing(ep.x, ep.y + 6, 190, frac, '#ff5a2a', t * 0.05);
      segRing(ep.x, ep.y + 6, 150, Math.max(0, frac * 1.06 - 0.05), '#d8a441', -t * 0.08);
      drawFrigate(ep.x, ep.y, 2.7, true, windP + S.eyeRage * 0.5, '#ff7a2a');
      ctx.font = '700 15px "Palatino Linotype",Georgia,serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,180,120,.85)';
      ctx.fillText('T H E   H E R A L D', ep.x, ep.y + 92);
    } else if (S.kind === 'squadrons') {
      drawFrigate(ep.x - 74, ep.y + 40, 0.62, true, 0.2, '#c2452e');
      drawFrigate(ep.x + 78, ep.y + 34, 0.62, true, 0.2, '#c2452e');
      segRing(ep.x, ep.y, 96, frac, '#ff5a2a', t * 0.1);
      drawFrigate(ep.x, ep.y, 0.95, true, windP + S.eyeRage * 0.5, '#ff7a2a');
    } else if (S.kind === 'patrols') {
      drawFrigate(ep.x + 66, ep.y + 52, 0.7, true, 0.25, '#c2452e');
      segRing(ep.x, ep.y, 104, frac, '#ff5a2a', t * 0.1);
      drawFrigate(ep.x, ep.y, 1.05, true, windP + S.eyeRage * 0.5, '#ff7a2a');
    } else {
      segRing(ep.x, ep.y, 100, frac, '#ff5a2a', t * 0.1);
      drawFrigate(ep.x, ep.y, 1.0, true, windP + S.eyeRage * 0.5, '#ff7a2a');
    }
    // the wind-up: a contracting gold ring — the flare's one warning
    if (winding) {
      ctx.save();
      ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 3;
      ctx.shadowColor = '#fcee0a'; ctx.shadowBlur = 16;
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(t * 22);
      ctx.beginPath(); ctx.arc(ep.x, ep.y, 120 - windP * 62, 0, Math.PI * 2); ctx.stroke();
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
    // vulnerability: the gold frame hangs on the enemy
    if (vuln) {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.08 * Math.sin(t * 14);
      ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 2;
      var vr = S.kind === 'capital' ? 200 : 118;
      ctx.beginPath(); ctx.arc(ep.x, ep.y, vr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // ---- your ship (low-left), and its ghosts
    if (now < S.phantomUntil) {
      // the Decoy's false ship, flying its own little arc
      var pa = t * 0.9;
      var dx = pp.x + Math.cos(pa) * 90, dy = pp.y - 60 + Math.sin(pa * 1.3) * 26;
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.12 * Math.sin(t * 6);
      drawFrigate(dx, dy, 0.8, false, 0, '#fcee0a');
      ctx.restore();
    }
    if (now < S.plateUntil) {
      ctx.save();
      ctx.globalAlpha = 0.16 + 0.05 * Math.sin(t * 5);
      ctx.strokeStyle = '#b967ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pp.x, pp.y, 84, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    drawFrigate(pp.x + shx, pp.y + shy, 1.0, false, 0, hullTrim);
    // the shield flare: a gold hemisphere bloom at the parry's moment
    if (S.flareUntil && performance.now() < S.flareUntil) {
      var fa = 1 - (S.flareUntil - performance.now()) / 450;
      ctx.save();
      ctx.globalAlpha = 0.75 * (1 - fa);
      ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 4;
      ctx.shadowColor = '#fcee0a'; ctx.shadowBlur = 22;
      ctx.beginPath(); ctx.arc(pp.x + 30, pp.y, 46 + fa * 30, -1.2, 1.2); ctx.stroke();
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
          ctx.beginPath(); ctx.moveTo(pp.x + 56, pp.y + off * 0.4); ctx.lineTo(ep.x - 40, ep.y + off); ctx.stroke();
        });
      } else if (S.beam.tool === 'whisper') {
        ctx.globalAlpha = 0.22; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(pp.x + 56, pp.y - 8); ctx.lineTo(ep.x - 40, ep.y); ctx.stroke();
      } else {
        ctx.globalAlpha = 0.85; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pp.x + 56, pp.y - 6); ctx.lineTo(ep.x - 30, ep.y - 4); ctx.stroke();
      }
      ctx.restore();
    }
    if (S.strikeFx && performance.now() < S.strikeFx.until) {
      ctx.save();
      ctx.strokeStyle = '#ff2a3c'; ctx.globalAlpha = 0.8; ctx.lineWidth = 3.5;
      ctx.shadowColor = '#ff2a3c'; ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(ep.x - 40, ep.y + 10);
      ctx.lineTo(pp.x + 90, pp.y - 30); ctx.lineTo(pp.x + 40, pp.y + 6); ctx.lineTo(pp.x + 62, pp.y + 26);
      ctx.stroke();
      ctx.restore();
    }
    if (S.flash > 0) {
      ctx.fillStyle = 'rgba(255,220,160,' + (S.flash * 0.10) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (S.hurt > 0) {
      var hg2 = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75);
      hg2.addColorStop(0, 'rgba(255,42,60,0)');
      hg2.addColorStop(1, 'rgba(255,42,60,' + (S.hurt * 0.4) + ')');
      ctx.fillStyle = hg2; ctx.fillRect(0, 0, W, H);
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
  }

  // ---------- the encounter ends; the sortie goes on (or doesn't) ----------
  var END_TITLES = { breach: 'HULL BREACHED', timeout: 'THE FLEET HELD ITS SKY', integrity: 'SHIP DESTROYED', trace: 'READ COMPLETELY — ATTENTION TOTAL' };
  function endFight(reason) {
    if (S.over) return;
    S.over = true;
    S.endReason = reason;
    parryBtn.disabled = true;
    parryBtn.classList.remove('armed');
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
    updateHud();
  }
  function hitFxSpark() {
    if (!S || S.particles.length > 240) return;
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
    var nextLabel = LADDER_LABELS[next - 1] || 'the deep sky';
    gatechoiceText.textContent = 'Encounter ' + R.encounter + ' is cleared. You carry ' + R.haul.length + ' unbanked piece' + (R.haul.length === 1 ? '' : 's') +
      ' · integrity ' + dd.integrity + ' · attention ' + dd.trace + '%. Ahead is Encounter ' + next + ' — ' + nextLabel + '. Withdraw, and everything you carry is yours for good.';
    gatechoiceEl.classList.remove('hidden');
    sfx('gatechoice');
  }

  function choose(choice) {
    gatechoiceEl.classList.add('hidden');
    sfx(choice === 'press' ? 'descend' : 'ascend');
    fetch('/api/galactic/choose', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortieId: R.sortieId, choice: choice })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { gatechoiceEl.classList.remove('hidden'); return; }
        if (choice === 'withdraw') { R.over = true; showSortieVerdict(res.d.verdict, 'withdraw', null); return; }
        beginEncounter(res.d, false);
      })
      .catch(function () { gatechoiceEl.classList.remove('hidden'); });
  }
  if (descendBtn) descendBtn.addEventListener('click', function () { if (SFX) SFX.unlock(); choose('press'); });
  if (ascendBtn) ascendBtn.addEventListener('click', function () { if (SFX) SFX.unlock(); choose('withdraw'); });
  if (abandonBtn) abandonBtn.addEventListener('click', function () {
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

  function showSortieVerdict(v, localReason, voided) {
    if (abandonBtn) abandonBtn.classList.add('hidden');
    var html;
    if (!v) {
      html = '<div class="vcard-inner vcard"><h1>THE SORTIE IS LOST TO THE DARK</h1><p class="dim">The verdict could not be recorded.</p><a class="fightbtn small" href="/galactic/fly">Fly again</a></div>';
    } else {
      var gv = v.galactic || {};
      var titles = { death: 'DESTROYED IN THE REACH', withdraw: 'YOU WITHDREW — THE HAUL IS YOURS', cleared: '★ SECTOR CLEARED — THE HERALD FALLS', turned: 'TURNED BACK FROM THE REACH', void: 'SORTIE VOIDED' };
      var title = titles[v.endReason] || (v.result === 'win' ? 'YOU WITHDREW' : 'TURNED BACK');
      var banked = (gv.banked || []).map(function (bp) {
        return '<span class="tierbadge t-' + bp.tier.toLowerCase() + '">' + esc(bp.name) + ' (' + bp.tier + (bp.serial ? ' No. ' + bp.serial : '') + ')</span>';
      }).join(' ');
      var lost = (gv.lost || []).map(function (bp) { return esc(bp.name) + ' (' + bp.tier + ')'; }).join(' · ');
      html = '<div class="vcard-inner vcard ' + (v.result === 'win' ? 'win' : '') + '">' +
        '<h1 class="glitch">' + title + '</h1>' +
        '<p class="v-name">' + (voided ? 'That sortie\u2019s log did not hold up — remembered, but it taught nothing and earned nothing. ' : '') +
        'Encounters cleared ' + (gv.encountersCleared || 0) + ' · deepest Encounter ' + (gv.deepest || 0) + ' · score ' + (gv.score || 0) + ' · capitals slain ' + (gv.capitalsSlain || 0) + '</p>' +
        (gv.sectorCleared ? '<p class="v-name">★ <strong>SECTOR 1 — EMBERFALL REACH — IS CLEARED</strong>' + (gv.firstClear ? ' — your first clearing, receipted in the books, named and dated and permanent.' : ' — the Reach stays cleared on your chart, and its armada flies a notch quieter for you now.') + '</p>' : '') +
        (v.xp ? '<p class="v-name">+' + v.xp + ' XP' + (v.emberBonus ? ' (Founder\u2019s Ember +10%)' : '') + (v.levelUp ? ' — <strong>LEVEL UP</strong>' : '') + ' · +' + v.points + ' points</p>' : '') +
        (banked ? '<p class="v-name">Banked: ' + banked + '</p>' : '<p class="v-name">Nothing banked.</p>') +
        (lost ? '<p class="v-name bad">Lost among the stars: ' + lost + '</p>' : '') +
        '<div class="v-actions"><a class="fightbtn small" href="/verdict/' + v.id + '">Full after-action report</a>' +
        '<a class="ghostbtn" href="/galactic/fly">Fly again</a>' +
        '<a class="ghostbtn" href="/galactic/bridge">The Bridge</a></div></div>';
    }
    verdictEl.innerHTML = html;
    verdictEl.classList.remove('hidden');
    sfx(v && v.result === 'win' ? 'verdictWin' : 'verdictLose');
  }
})();
