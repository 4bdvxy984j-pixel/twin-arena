'use strict';
// THE DESCENT — the delve beneath the arena. Same Command Deck, same server
// referee, a different dark: gothic stone, ember light, loot that falls in
// beams of color. A run is a chain of depths; integrity and Trace carry
// across it; at every cleared gate the fighter chooses — descend or ascend.
(function () {
  var canvas = document.getElementById('gate');
  if (!canvas) return;
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

  var S = null;   // the current depth's fight state (mirrors the referee)
  var R = null;   // the run: { runId, depth, score, haul: [], over }
  var SFX = window.TASFX || null;
  function sfx(name) { if (SFX) SFX.play(name); }

  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function elapsed() { return performance.now() - S.startedAt; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Tool sigils — the same four marks the Armory stands carry (views.js).
  var TOOL_ICONS = {
    probe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    flood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5v3.5"/><path d="M5.5 4.5l2 2.5M18.5 4.5l-2 2.5"/><path d="M2.5 14.5c2.4 0 2.4 1.8 4.8 1.8s2.4-1.8 4.8-1.8 2.4 1.8 4.8 1.8 2.4-1.8 4.6-1.8"/><path d="M2.5 19c2.4 0 2.4 1.8 4.8 1.8S9.7 19 12.1 19s2.4 1.8 4.8 1.8 2.4-1.8 4.6-1.8"/></svg>',
    whisper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><path d="M12.5 8.8a4.6 4.6 0 0 1 0 6.4M15.8 6.2a8.4 8.4 0 0 1 0 11.6M19 3.8a12.2 12.2 0 0 1 0 16.4"/></svg>',
    decoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 21v-7.5a7.5 7.5 0 0 1 15 0V21"/><path d="M9.3 21v-4.8a2.7 2.7 0 0 1 5.4 0V21"/><path d="M2.5 21h19"/></svg>'
  };

  // ---------- the run ----------
  startBtn.addEventListener('click', function () {
    if (SFX) SFX.unlock();
    startBtn.disabled = true;
    startBtn.textContent = 'THE STAIRS STIR…';
    var itemHeart = document.getElementById('item-heart');
    var itemBell = document.getElementById('item-bell');
    var godSel = document.getElementById('god-select');
    fetch('/api/descent/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        heart: !!(itemHeart && itemHeart.checked),
        bell: !!(itemBell && itemBell.checked),
        god: godSel && godSel.value ? godSel.value : undefined
      })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          startBtn.disabled = false; startBtn.textContent = '▼ BEGIN THE DESCENT';
          var p = stageMsg.querySelector('p');
          if (p) p.textContent = res.d.message || res.d.error || 'The stairs would not open.';
          return;
        }
        R = { runId: res.d.descent.runId, depth: 0, score: 0, haul: [], over: false };
        if (abandonBtn) abandonBtn.classList.remove('hidden');
        beginDepth(res.d, true);
      })
      .catch(function () { startBtn.disabled = false; startBtn.textContent = '▼ BEGIN THE DESCENT'; });
  });

  function beginDepth(d, first) {
    var st = d.stats, cb = st.combat, dd = d.descent || {};
    R.depth = dd.depth; R.score = dd.score || 0;
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
      heart: !!dd.heart, heartUsed: false,
      bellDeclared: !!dd.bell, bellRung: false, bellUntil: 0,
      // the Descent's own state
      kind: dd.kind || 'normal', boss: dd.boss || null,
      seized: st.seized || null, seizeShown: false,
      twinTool: dd.twinTool || null,
      god: dd.god || null, mercyUsed: !!(dd.god && dd.god.mercyUsed), dawnUsed: !!(dd.god && dd.god.dawnUsed),
      vaultShapes: 14,
      // MODS v1 — the rail's purse and the hidden feeds, mirroring the referee
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
    showDepthBanner(dd);
    if (dd.boss) showBossPlate(dd.boss);
    sfx(dd.boss ? 'boss' : 'begin');
    if (SFX) SFX.humStart();
    requestAnimationFrame(frame);
  }

  function showDepthBanner(dd) {
    if (!depthbannerEl) return;
    var label = 'DEPTH ' + dd.depth;
    if (dd.kind === 'boss' && dd.boss) label += ' — ' + dd.boss.name;
    else if (dd.kind === 'vault') label += ' — THE VAULT';
    else if (dd.kind === 'elite') label += ' — THE ELITE DARK';
    depthbannerEl.textContent = label;
    depthbannerEl.classList.remove('hidden');
    depthbannerEl.classList.remove('show'); void depthbannerEl.offsetWidth;
    depthbannerEl.classList.add('show');
    setTimeout(function () { depthbannerEl.classList.add('hidden'); }, 2600);
  }
  function showBossPlate(boss) {
    if (!bossplateEl) return;
    bossplateEl.innerHTML = '<div class="bossplate-inner"><span class="boss-tag">THE GATE IS GUARDED</span>' +
      '<h2>' + esc(boss.name) + '</h2><p>' + esc(boss.line) + '</p></div>';
    bossplateEl.classList.remove('hidden');
    setTimeout(function () { bossplateEl.classList.add('hidden'); }, 5200);
  }
  function updateRunLine() {
    if (!runlineEl || !R) return;
    runlineEl.textContent = 'Depth ' + (R.depth || '—') + ' · Score ' + R.score + ' · Carrying ' +
      (R.haul.length ? R.haul.length + ' piece' + (R.haul.length === 1 ? '' : 's') + ' unbanked' : 'nothing');
  }
  function renderHaul() {
    if (!haulfeedEl) return;
    if (!R || !R.haul.length) { haulfeedEl.innerHTML = '<li class="dim">Empty hands. The depths provide.</li>'; return; }
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
      sfx(p.tier === 'GODFORGED' ? 'godforged' : p.tier === 'LEGENDARY' ? 'legendary' : p.tier === 'EPIC' ? 'lootEpic' : p.tier === 'RARE' ? 'lootRare' : 'lootSturdy');
    });
    renderHaul();
    updateRunLine();
  }

  // MODS v1: a mod that falls in the deep is banked the moment it lands —
  // it never rides the haul and death cannot take it. Beams, not baggage.
  function showModLoot(mods) {
    if (!mods || !mods.length) return;
    mods.forEach(function (m, i) {
      if (lootlayerEl) {
        var beam = document.createElement('div');
        beam.className = 'beam t-mod';
        beam.style.left = (30 + i * 22) + '%';
        beam.style.setProperty('--bc', m.kind === 'fitted' ? '#00e5ff' : '#b967ff');
        beam.innerHTML = '<i></i><span>' + esc(m.name) + '<br><b>' + (m.kind === 'fitted' ? 'FITTED MOD — BANKED' : 'RAIL MOD — BANKED') + '</b></span>';
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
      b.className = 'tool' + (t.twin ? ' twinned' : '') + (S.seized && S.seized.tool === id ? ' seizedtool' : '');
      b.id = 'tool-' + id;
      b.style.setProperty('--tc', t.color);
      var traceTxt = t.trace > 0 ? '+' + t.trace + '% trace' : (t.trace < 0 ? t.trace + '% trace' : 'no trace');
      b.innerHTML = '<span class="ticon">' + (TOOL_ICONS[id] || '') + '</span>' +
        '<span class="tname" style="color:' + t.color + '">' + t.name + (t.twin ? ' ⧉ TWINNED' : '') + '</span>' +
        '<span class="tdmg">DMG ' + t.dmg + (t.dot ? ' +' + t.dot + '/s burn' : '') + '</span>' +
        '<span class="tcost">' + t.cost + ' energy · ' + (t.cooldown / 1000).toFixed(1) + 's</span>' +
        '<span class="ttrace" style="color:' + (t.trace > 0 ? '#ff2a6d' : '#5dffa0') + '">' + traceTxt + '</span>' +
        (t.gear ? '<span class="tgear">⚜ ' + esc(t.gear.name) + ' (' + t.gear.tier + ')</span>' : '') +
        (t.mod ? '<span class="tmod" style="--mc:' + t.mod.color + '">' + t.mod.sigil + ' ' + esc(t.mod.name) + ' — SOCKETED</span>' : '') +
        '<span class="tfam">Twin familiarity <b data-fam>' + Math.round(t.familiarity * 100) + '%</b></span>' +
        '<span class="noenergy hidden">not enough energy</span>' +
        '<span class="cdveil"></span>';
      b.title = t.blurb;
      b.addEventListener('click', function () { useTool(id); });
      kitEl.appendChild(b);
    });
  }
  function heardTrace(amt, now) {
    if (amt > 0 && S.bellRung && now < S.bellUntil) return 0;
    return amt;
  }
  function dawnSave() {
    // THE SECOND DAWN (GODFORGED): once per run, death itself is refused.
    if (S.god && S.god.power === 'seconddawn' && !S.dawnUsed) {
      S.dawnUsed = true;
      S.integrity = Math.max(S.integrity, Math.ceil(S.maxIntegrity / 2));
      S.trace = 0;
      floatText('✦ THE SECOND DAWN — YOU STAND AGAIN AT HALF, THE TRACE WIPED CLEAN', '#ffe9a8', true);
      sfx('dawn');
      return true;
    }
    return false;
  }
  function applyTrace(amt, now) {
    S.trace = Math.max(0, Math.min(S.combat.traceMax, S.trace + amt));
    if (S.trace >= 90 && S.alarmStage < 2) { S.alarmStage = 2; sfx('alarm2'); }
    else if (S.trace >= 75 && S.alarmStage < 1) { S.alarmStage = 1; sfx('alarm'); }
    if (S.trace >= S.combat.traceMax) {
      if (dawnSave()) { updateHud(); return false; }
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
      lines.push('THE TWIN READS YOU: ' + t.name.toUpperCase() + ' is your tell — it is ' + mood + ' that shape (' + pct + '% familiar).');
    } else {
      lines.push('THE TWIN READS YOU: nothing yet — down here, she is also reading your gear.');
    }
    if (S.god && S.god.power === 'openbook') {
      var up = S.strikes.filter(function (s) { return !s.done; }).slice(0, 4).map(function (s) {
        return s.kind.toUpperCase() + (s.tool ? '→' + s.tool : '') + ' @' + (s.at / 1000).toFixed(0) + 's';
      });
      if (up.length) lines.push('📖 THE OPEN BOOK: ' + up.join(' · '));
    }
    if (S.god && S.god.power === 'unreadstrike' && S.god.unreadTool) {
      lines.push('✦ THE UNREAD STRIKE: your ' + S.god.unreadTool.toUpperCase() + ' teaches her nothing down here.');
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
        '<span class="ttrace" style="color:' + (a.trace > 0 ? '#ff2a6d' : '#5dffa0') + '">' + (a.trace > 0 ? '+' + a.trace + '% trace' : 'no trace') + '</span>' +
        '<span class="noenergy hidden">not enough energy</span>' +
        '<span class="cdveil"></span>';
      b.title = a.blurb;
      b.addEventListener('click', function () { useAbility(id); });
      abilitiesEl.appendChild(b);
    });
    if (S.bellDeclared) {
      var bb = document.createElement('button');
      bb.className = 'tool ability bell'; bb.id = 'ability-bell';
      bb.style.setProperty('--tc', '#ffd166');
      bb.innerHTML = '<span class="tname" style="color:#ffd166">🔔 RING THE STILLBELL</span>' +
        '<span class="tdmg">trace frozen 12s — cooling still runs</span>' +
        '<span class="tcost">declared gear · one ring</span>' +
        '<span class="cdveil"></span>';
      bb.title = 'Ring it when the trace climbs. The referee hears the same bell.';
      bb.addEventListener('click', ringBell);
      abilitiesEl.appendChild(bb);
    }
    if (S.god && S.god.power === 'keepersmercy' && !S.mercyUsed) {
      var mb = document.createElement('button');
      mb.className = 'tool ability mercy'; mb.id = 'ability-mercy';
      mb.style.setProperty('--tc', '#ffe9a8');
      mb.innerHTML = '<span class="tname" style="color:#ffe9a8">✦ THE KEEPER\u2019S MERCY</span>' +
        '<span class="tdmg">the Trace rewinds to zero — once this run</span>' +
        '<span class="tcost">GODFORGED · declared</span>' +
        '<span class="cdveil"></span>';
      mb.title = 'Call for mercy and the Trace forgets you. The referee validates the call like everything else.';
      mb.addEventListener('click', callMercy);
      abilitiesEl.appendChild(mb);
    }
    if (S.heart) {
      var hb = document.createElement('div');
      hb.className = 'tool ability heartpod'; hb.id = 'ability-heart';
      hb.innerHTML = '<span class="tname" style="color:#ff6b9d">💔 SECOND HEART — CARRIED</span>' +
        '<span class="tdmg">breaks at the first zeroing blow · you stand at 40</span>';
      abilitiesEl.appendChild(hb);
    }
  }
  function callMercy() {
    if (!S || S.over || S.mercyUsed) return;
    var now = elapsed();
    S.mercyUsed = true;
    S.trace = 0;
    S.actions.push({ t: Math.round(now), tool: 'mercy' });
    floatText('✦ MERCY — THE TRACE REWINDS TO ZERO', '#ffe9a8', true);
    sfx('mercy');
    var b = document.getElementById('ability-mercy');
    if (b) { b.disabled = true; b.classList.add('spent'); }
  }
  // ---------- MODS v1: the rail under the pods (mirrors the arena) ----------
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
        '<span class="tdmg">' + (id === 'overclock' ? 'next strike hasted' : id === 'tracepurge' ? 'trace −35% now' :
          id === 'ghostplate' ? 'blows feed a hidden plate · 8s' : 'the Twin’s next strike lands late') + '</span>' +
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
      floatText('TRACE PURGE −35%', '#5dffa0', true);
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
    if (id === 'overdrive' && S.seized && S.seized.tool === 'flood' && now >= S.seized.at) { sfx('deny'); floatText('THE CAPTOR HOLDS YOUR FLOOD', '#ff2a6d', true); return; }
    if (S.abilityCds[id] && now < S.abilityCds[id]) return;
    if (id === 'secondwind' && S.secondWindUsed) { sfx('deny'); return; }
    if (S.energy < a.cost) { sfx('deny'); return; }
    S.energy -= a.cost;
    S.abilityCds[id] = now + a.cooldown;
    S.actions.push({ t: Math.round(now), tool: 'ability:' + id });
    if (applyTrace(heardTrace(a.trace || 0, now), now)) return;
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
      var dmg = (S.morphed && a.dmgMorph !== undefined) ? a.dmgMorph : a.dmg;
      var crit = 1;
      if (S.critNext > 0) { crit *= (1 + S.critNext); S.critNext = 0; S.phantomUntil = 0; }
      if (now >= S.vulnFrom && now <= S.vulnUntil) { crit *= S.combat.vulnMult; floatText('VULNERABLE ×' + S.combat.vulnMult, '#fcee0a', true); }
      var odBonus = strikeBonusClient(now);
      S.beam = { until: performance.now() + 240, color: a.color };
      hitFx(dmg * crit + odBonus, a.color, 60);
      S.shake = Math.min(18, S.shake + 12);
      floatText('OVERDRIVE ' + Math.round(dmg * crit + odBonus), '#ff2a6d', true);
      sfx('overdrive');
    }
    updateKit();
  }
  function ringBell() {
    if (!S || S.over || !S.bellDeclared || S.bellRung) return;
    var now = elapsed();
    S.bellRung = true;
    S.bellUntil = now + 12000;
    S.actions.push({ t: Math.round(now), tool: 'bell' });
    floatText('THE STILLBELL RINGS — THE TRACE HOLDS ITS BREATH', '#ffd166', true);
    sfx('bell');
    var b = document.getElementById('ability-bell');
    if (b) { b.disabled = true; b.classList.add('spent'); }
  }

  // ---------- the Twin's side of the argument ----------
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
      floatText('PARRIED… AIR. IT WAS A MIRAGE.', '#b967ff', true);
      sfx('whiff');
    } else {
      floatText('PARRY READY — WAIT FOR IT…', '#fcee0a', false);
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
        floatText('PARRIED — IT\u2019S OPEN. HIT IT.', '#fcee0a', true);
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
    if (S.integrity <= 0) {
      if (S.heart && !S.heartUsed) {
        S.heartUsed = true;
        S.integrity = 40;
        floatText('💔 THE SECOND HEART BREAKS — YOU STAND AT 40', '#ff6b9d', true);
        sfx('heart');
        var hb = document.getElementById('ability-heart');
        if (hb) hb.classList.add('spent');
        return;
      }
      if (dawnSave()) return;
      endFight('integrity');
    }
  }

  // ---------- your side ----------
  function useTool(id) {
    if (!S || S.over) return;
    var now = elapsed();
    var t = S.stats.tools[id];
    // THE CAPTOR'S SEIZURE: from the dealt moment, the tool is his.
    if (S.seized && id === S.seized.tool && now >= S.seized.at) { sfx('deny'); floatText('SEIZED — THE CAPTOR HOLDS YOUR ' + t.name.toUpperCase(), '#ff2a6d', true); return; }
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
    traceAdd = heardTrace(traceAdd, now);
    if (t.trace > 0 && traceAdd > 0) floatText('+' + traceAdd + '% TRACE', '#ff2a6d', false);
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
      if (s) { s.eaten = true; floatText('DECOY UP — IT SWINGS AT THE GHOST', '#fcee0a', false); }
    }

    var dmg = (S.morphed && t.dmgMorph !== undefined) ? t.dmgMorph : t.dmg;
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
      S.beam = { until: performance.now() + 140, color: t.color };
      hitFx(dmg * crit + modBonus, t.color, 10);
      sfx('probe');
    } else if (id === 'flood') {
      S.beam = { until: performance.now() + 200, color: t.color };
      hitFx(dmg * crit + modBonus, t.color, 46);
      if (t.splash && !S.over) hitFx(t.splash, t.color, 6);
      if (t.ignite) S.dots.push({ until: now + t.ignite.secs * 1000, dps: t.ignite.dps });
      if (t.modBurn) S.dots.push({ until: now + t.modBurn.secs * 1000, dps: t.modBurn.dps });
      S.shake = Math.min(16, S.shake + 9);
      sfx('flood');
    } else if (id === 'whisper') {
      var dps = (S.morphed && t.dotMorph !== undefined) ? t.dotMorph : t.dot;
      S.dots.push({ until: now + t.dotSecs * 1000, dps: dps });
      if (t.traceBurn) S.trace = Math.max(0, S.trace - t.traceBurn);
      if (t.traceShed) S.trace = Math.max(0, S.trace - t.traceShed);
      hitFx(dmg * crit + modBonus, t.color, 14);
      sfx('whisper');
      if (now - S.lastDecoyAt <= 5000) {
        S.trace = Math.max(0, S.trace - 12);
        floatText('COLD TRAIL −12% TRACE', '#5dffa0', true); sfx('combo');
      }
    } else if (id === 'decoy') {
      S.critNext = S.stats.decoyCrit;
      S.phantomUntil = now + 5000;
      if (!windingHaymaker(now)) floatText('A PHANTOM GATE STANDS', '#fcee0a');
      if (t.ghostStrike && !S.over) { hitFx(t.ghostStrike, t.color, 8); floatText('THE SECOND GHOST STRIKES', '#fcee0a', true); }
      if (t.twin) S.trace = Math.max(0, S.trace + t.trace);
      sfx('decoy');
    }
    if (crit > 1 && id !== 'decoy') floatText('BREACH IN THE PATTERN ×' + crit.toFixed(1), '#ffd166');
    if (t.twin && id !== 'decoy' && !S.over) {
      var dmg2 = (S.morphed && t.dmgMorph !== undefined) ? t.dmgMorph : t.dmg;
      hitFx(dmg2, t.color, 20);
      if (id === 'whisper') { var dps2 = (S.morphed && t.dotMorph !== undefined) ? t.dotMorph : t.dot; S.dots.push({ until: now + t.dotSecs * 1000, dps: dps2 }); }
      if (id === 'flood' && t.splash && !S.over) hitFx(t.splash, t.color, 6);
      floatText('TWINNED — IT STRIKES TWICE', '#ffd166', true);
      if (!S.over) applyTrace(heardTrace(t.trace || 0, now), now);
    }
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
    // Performance is part of beautiful: the ember storm is capped, always.
    var room = Math.max(0, 240 - S.particles.length);
    var count = Math.min(n, room);
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 190;
      S.particles.push({
        x: W / 2 + Math.cos(a) * 90, y: H / 2 + Math.sin(a) * 90,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.6, age: 0, color: color, r: 1 + Math.random() * 2.6
      });
    }
    if (S.hp <= 0) endFight('breach');
  }
  function floatText(txt, color, glitch) {
    S.texts.push({ txt: txt, color: color, glitch: !!glitch, age: 0, life: 1.6, y: H / 2 - 130 - Math.random() * 40 });
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
      // THE CAPTOR'S SEIZURE lands on its dealt moment — seen and heard.
      if (S.seized && !S.seizeShown && now >= S.seized.at) {
        S.seizeShown = true;
        var seizedName = S.stats.tools[S.seized.tool] ? S.stats.tools[S.seized.tool].name : S.seized.tool;
        floatText('✋ THE CAPTOR SEIZES YOUR ' + seizedName.toUpperCase() + ' — CRACK HIS GATE TO WIN IT BACK TWINNED', '#ff2a6d', true);
        sfx('seize');
        var pod = document.getElementById('tool-' + S.seized.tool);
        if (pod) pod.classList.add('seized');
        updateTwinRead();
      }
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
      var seizedNow = S.seized && S.seized.tool === id && now >= S.seized.at;
      var cdLeft = S.cds[id] ? Math.max(0, S.cds[id] - now) : 0;
      var lockLeft = S.lockouts[id] ? Math.max(0, S.lockouts[id] - now) : 0;
      b.disabled = seizedNow || cdLeft > 0 || lockLeft > 0 || S.energy < t.cost;
      b.classList.toggle('locked', lockLeft > 0);
      b.classList.toggle('seized', !!seizedNow);
      var total = Math.max(t.cooldown, cdLeft, lockLeft);
      b.querySelector('.cdveil').style.width = (Math.max(cdLeft, lockLeft) > 0 ? (Math.max(cdLeft, lockLeft) / total * 100) : 0) + '%';
      b.querySelector('[data-fam]').textContent = Math.round(S.famShown[id] * 100) + '%';
      b.querySelector('.noenergy').classList.toggle('hidden', S.energy >= t.cost);
    });
  }

  // ---------- drawing the cathedral dark ----------
  // Deep blacks, ember red, old gold. A pointed arch stands behind the gate;
  // ash and embers drift UP, the way heat moves in a cold church.
  function draw(nowPerf, dt) {
    var now = S ? elapsed() : 0;
    ctx.clearRect(0, 0, W, H);
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#070405');
    bg.addColorStop(0.55, '#0d0608');
    bg.addColorStop(1, '#140708');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // candle-glow at the heart of the dark
    var glow = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, H * 0.72);
    glow.addColorStop(0, 'rgba(255,120,40,0.13)');
    glow.addColorStop(0.5, 'rgba(160,30,20,0.06)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    // the cathedral arch — two arcs rising to a point, in ember and bone
    ctx.save();
    ctx.strokeStyle = 'rgba(216,164,65,0.20)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 250, H - 30);
    ctx.quadraticCurveTo(W / 2 - 250, 120, W / 2, 36);
    ctx.quadraticCurveTo(W / 2 + 250, 120, W / 2 + 250, H - 30);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,90,40,0.10)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 268, H - 30);
    ctx.quadraticCurveTo(W / 2 - 268, 110, W / 2, 22);
    ctx.quadraticCurveTo(W / 2 + 268, 110, W / 2 + 268, H - 30);
    ctx.stroke();
    ctx.restore();
    // drifting ash + rising embers (cheap: a fixed field, no allocation)
    for (var i = 0; i < 30; i++) {
      var rising = i % 3 === 0;
      var sx = (i * 173.3 + (rising ? 0 : nowPerf * 0.006 * (1 + i % 3))) % W;
      var sy = H - ((i * 131.7 + nowPerf * (rising ? 0.021 : 0.004) * (1 + i % 4)) % (H + 40)) + 20;
      ctx.globalAlpha = 0.10 + 0.10 * Math.abs(Math.sin(nowPerf * 0.001 + i * 2));
      ctx.fillStyle = rising ? '#ff9a3c' : '#cbb9a0';
      ctx.fillRect(sx, sy, rising ? 2.4 : 1.8, rising ? 2.4 : 1.8);
    }
    ctx.globalAlpha = 1;
    if (!S) return;
    var cx = W / 2 + (Math.random() - 0.5) * S.shake;
    var cy = H / 2 + (Math.random() - 0.5) * S.shake;
    S.shake = Math.max(0, S.shake - dt * 26);
    S.flash = Math.max(0, S.flash - dt * 2.2);
    S.eyeRage = Math.max(0, S.eyeRage - dt * 0.5);
    S.hurt = Math.max(0, S.hurt - dt * 1.4);
    var frac = S.hp / S.maxHp;
    var t = nowPerf / 1000;
    var vuln = now >= S.vulnFrom && now <= S.vulnUntil;
    var winding = windingTelegraph(now);

    if (now < S.phantomUntil) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.12 * Math.sin(t * 6);
      ring(cx - 190, cy + 10, 92, 0.8, '#fcee0a', t * 0.4);
      ctx.restore();
    }
    if (S.kind === 'vault') {
      // THE VAULT: no gate — a swarm of fragile, fleeing shapes. Each one
      // cracks as the depth's integrity falls; the rest scatter outward.
      var alive = Math.ceil(frac * S.vaultShapes);
      for (var vi = 0; vi < S.vaultShapes; vi++) {
        var seedA = vi * 2.39996; // golden angle scatter
        var baseR = 60 + (vi % 5) * 34;
        var drift = (nowPerf * 0.00012 * (1 + (vi % 3) * 0.4)) % 1;
        var rr = baseR + drift * 130;
        var vx = cx + Math.cos(seedA + t * 0.11) * rr;
        var vy = cy + Math.sin(seedA * 1.7 + t * 0.09) * rr * 0.72;
        var sz = 9 + (vi % 4) * 2.5;
        ctx.save();
        ctx.translate(vx, vy);
        ctx.rotate(seedA + t * 0.6);
        if (vi < alive) {
          ctx.strokeStyle = 'rgba(125,249,255,0.9)';
          ctx.fillStyle = 'rgba(125,249,255,0.16)';
          ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 10;
        } else {
          ctx.strokeStyle = 'rgba(120,120,120,0.25)';
          ctx.fillStyle = 'rgba(120,120,120,0.04)';
        }
        ctx.beginPath();
        ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.7, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.7, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      // the vault's heart: a small hoard-light where the shapes swarm
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 3);
      ctx.fillStyle = '#ffd166';
      ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 26;
      ctx.beginPath(); ctx.arc(cx, cy, 7 + Math.sin(t * 3) * 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ring(cx, cy, 168, frac, '#ff5a2a', t * 0.12);
      ring(cx, cy, 128, Math.max(0, frac * 1.08 - 0.06), '#d8a441', -t * 0.18);
      ring(cx, cy, 88, Math.max(0, frac * 1.15 - 0.12), '#ff2a3c', t * 0.26);
    }
    if (vuln) {
      ctx.save();
      ctx.globalAlpha = 0.20 + 0.08 * Math.sin(t * 14);
      ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 186, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (S.beam && performance.now() < S.beam.until) {
      ctx.strokeStyle = S.beam.color; ctx.globalAlpha = 0.75; ctx.lineWidth = 3;
      ctx.shadowColor = S.beam.color; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(60, H - 40); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (S.strikeFx && performance.now() < S.strikeFx.until) {
      ctx.strokeStyle = '#ff2a3c'; ctx.globalAlpha = 0.8; ctx.lineWidth = 4;
      ctx.shadowColor = '#ff2a3c'; ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 26, cy + 120); ctx.lineTo(cx - 14, cy + 210); ctx.lineTo(cx + 10, H);
      ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (S.kind !== 'vault') drawOptic(cx, cy, t, winding, vuln);
    if (S.flash > 0) {
      ctx.fillStyle = 'rgba(255,220,160,' + (S.flash * 0.12) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (S.hurt > 0) {
      var hg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75);
      hg.addColorStop(0, 'rgba(255,42,60,0)');
      hg.addColorStop(1, 'rgba(255,42,60,' + (S.hurt * 0.4) + ')');
      ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
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

  function drawOptic(cx, cy, t, winding, vuln) {
    var learned = (S.uses.probe || 0) + (S.uses.flood || 0) + (S.uses.whisper || 0);
    var narrow = Math.min(0.55, learned * 0.03);
    var windP = 0;
    if (winding) {
      var s = windingTelegraph(elapsed());
      if (s) windP = 1 - Math.max(0, (s.at - elapsed()) / S.combat.windupMs);
    }
    var R = (15 + Math.sin(t * 2.2) * 1.6 + S.eyeRage * 7) * (vuln ? 1.7 : 1) * (1 + windP * 0.5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4 + t * 0.15);
    var ap = 34 + windP * 8;
    ctx.strokeStyle = 'rgba(226,201,160,0.85)'; ctx.lineWidth = 3;
    ctx.shadowColor = '#ff9a3c'; ctx.shadowBlur = 10;
    var off = S.flash > 0.25 ? (Math.random() - 0.5) * 7 : 0;
    ctx.strokeRect(-ap + off, -ap, ap * 2, ap * 2);
    ctx.strokeStyle = 'rgba(255,42,60,0.5)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(-ap - off, -ap, ap * 2, ap * 2);
    ctx.restore();
    ctx.shadowBlur = 0;
    var grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, 48);
    grad.addColorStop(0, vuln ? 'rgba(252,238,10,0.95)' : 'rgba(255,209,102,0.95)');
    grad.addColorStop(0.35, 'rgba(255,90,40,0.55)');
    grad.addColorStop(1, 'rgba(255,42,60,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.ellipse(cx, cy, 48, 48 * (1 - narrow * 0.5), 0, 0, Math.PI * 2); ctx.fill();
    var glitching = S.flash > 0.2 || winding || vuln;
    var bands = glitching ? 4 : 1;
    for (var b = 0; b < bands; b++) {
      var y0 = cy - R + (2 * R / bands) * b, y1 = cy - R + (2 * R / bands) * (b + 1);
      var xo = glitching ? (Math.random() - 0.5) * 6 : 0;
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - R - 8, y0, 2 * R + 16, y1 - y0); ctx.clip();
      ctx.fillStyle = b % 2 ? '#ffe9a8' : '#fff6d8';
      ctx.beginPath(); ctx.ellipse(cx + xo, cy, R, R * (1 - narrow), 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (winding) {
      ctx.save();
      ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 3;
      ctx.shadowColor = '#fcee0a'; ctx.shadowBlur = 16;
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(t * 22);
      ctx.beginPath(); ctx.arc(cx, cy, 120 - windP * 62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function ring(cx, cy, r, frac, color, rot) {
    var segs = 26;
    ctx.lineWidth = 11;
    ctx.strokeStyle = 'rgba(90,70,60,0.30)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.shadowColor = color; ctx.shadowBlur = 13;
    for (var i = 0; i < segs; i++) {
      var a0 = rot + (i / segs) * Math.PI * 2 + 0.035;
      var a1 = rot + ((i + 1) / segs) * Math.PI * 2 - 0.035;
      var keep = ((i * 2654435761 % 100) / 100);
      ctx.strokeStyle = color;
      ctx.globalAlpha = keep < frac ? 0.95 : 0.07;
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  // ---------- the depth ends; the run goes on (or doesn't) ----------
  var END_TITLES = { breach: 'THE GATE CRACKED', timeout: 'TURNED BACK', integrity: 'THROWN INTO THE DARK', trace: 'CAUGHT — TRACE COMPLETE' };
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
      handleDepthEnd(d, reason);
    }).catch(function () { showRunVerdict(null, reason, null); });
    updateHud();
  }
  function hitFxSpark() {
    if (!S || S.particles.length > 240) return;
    var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
    S.particles.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.8, age: 0, color: ['#ff9a3c', '#ff2a3c', '#fcee0a', '#d8a441'][Math.floor(Math.random() * 4)], r: 1.5 + Math.random() * 3 });
  }

  function handleDepthEnd(d, localReason) {
    var dd = d.descent || {};
    if (d.voided) { R.over = true; showRunVerdict(d.verdict, localReason, d.voided); return; }
    R.score = dd.score != null ? dd.score : R.score;
    if (dd.bankedNow && dd.bankedNow.length) {
      // A boss fell: the haul banked on the spot — out of the carried list,
      // into the satchel, announced like the treasure it is.
      R.haul = [];
      renderHaul();
      floatText('THE BOSS FALLS — YOUR HAUL BANKS ON THE SPOT', '#ffd166', true);
    }
    if (dd.drops && dd.drops.length) showLoot(dd.drops);
    if (dd.mods && dd.mods.length) showModLoot(dd.mods);
    if (dd.captor === 'twinned') {
      floatText('⚔ WON BACK — TWINNED FOR THE REST OF THE RUN', '#ffd166', true);
      sfx('twin');
    } else if (dd.captor === 'lost') {
      floatText('THE CAPTOR KEEPS WHAT HE TOOK', '#ff2a6d', true);
    }
    updateRunLine();
    if (dd.over) { R.over = true; showRunVerdict(d.verdict, localReason, null); return; }
    // The gate choice — the dramatic hinge of every delve.
    var nextDepth = R.depth + 1;
    var nextKind = nextDepth % 3 === 0 ? 'A BOSS guards it.' : nextDepth % 5 === 0 ? 'It is a VAULT — shapes and drop rolls, no gate.' : nextDepth % 2 === 0 ? 'The elite dark waits.' : 'The dark deepens.';
    gatechoiceText.textContent = 'Depth ' + R.depth + ' is cleared. You carry ' + R.haul.length + ' unbanked piece' + (R.haul.length === 1 ? '' : 's') +
      ' · integrity ' + dd.integrity + ' · trace ' + dd.trace + '%. Below is Depth ' + nextDepth + ' — ' + nextKind + ' Ascend, and everything you carry is yours for good.';
    gatechoiceEl.classList.remove('hidden');
    sfx('gatechoice');
  }

  function choose(choice) {
    gatechoiceEl.classList.add('hidden');
    sfx(choice === 'descend' ? 'descend' : 'ascend');
    fetch('/api/descent/choose', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: R.runId, choice: choice })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { gatechoiceEl.classList.remove('hidden'); return; }
        if (choice === 'ascend') { R.over = true; showRunVerdict(res.d.verdict, 'ascend', null); return; }
        beginDepth(res.d, false);
      })
      .catch(function () { gatechoiceEl.classList.remove('hidden'); });
  }
  if (descendBtn) descendBtn.addEventListener('click', function () { if (SFX) SFX.unlock(); choose('descend'); });
  if (ascendBtn) ascendBtn.addEventListener('click', function () { if (SFX) SFX.unlock(); choose('ascend'); });
  if (abandonBtn) abandonBtn.addEventListener('click', function () {
    if (!R || R.over) return;
    fetch('/api/descent/abandon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: R.runId })
    }).then(function (r) { return r.json(); }).then(function (d) {
      R.over = true;
      if (S) { S.over = true; if (SFX) SFX.humStop(); }
      showRunVerdict(d.verdict, 'ascend', null);
    }).catch(function () {});
  });

  function showRunVerdict(v, localReason, voided) {
    if (abandonBtn) abandonBtn.classList.add('hidden');
    var html;
    if (!v) {
      html = '<div class="vcard-inner vcard"><h1>THE RUN IS LOST TO THE DARK</h1><p class="dim">The verdict could not be recorded.</p><a class="fightbtn small" href="/descent">Delve again</a></div>';
    } else {
      var dv = v.descent || {};
      var titles = { death: 'THE DARK KEPT YOU', ascend: 'YOU ASCENDED — THE HAUL IS YOURS', turned: 'TURNED BACK FROM THE DEEP', void: 'RUN VOIDED' };
      var title = titles[v.endReason] || (v.result === 'win' ? 'YOU ASCENDED' : 'TURNED BACK');
      var banked = (dv.banked || []).map(function (bp) {
        return '<span class="tierbadge t-' + bp.tier.toLowerCase() + '">' + esc(bp.name) + ' (' + bp.tier + (bp.serial ? ' No. ' + bp.serial : '') + ')</span>';
      }).join(' ');
      var lost = (dv.lost || []).map(function (bp) { return esc(bp.name) + ' (' + bp.tier + ')'; }).join(' · ');
      html = '<div class="vcard-inner vcard ' + (v.result === 'win' ? 'win' : '') + '">' +
        '<h1 class="glitch">' + title + '</h1>' +
        '<p class="v-name">' + (voided ? 'That run\u2019s log did not hold up — remembered, but it taught nothing and earned nothing. ' : '') +
        'Depths cleared ' + (dv.depthsCleared || 0) + ' · deepest Depth ' + (dv.deepest || 0) + ' · score ' + (dv.score || 0) + ' · bosses slain ' + (dv.bossesSlain || 0) + '</p>' +
        (v.xp ? '<p class="v-name">+' + v.xp + ' XP' + (v.emberBonus ? ' (Founder\u2019s Ember +10%)' : '') + (v.levelUp ? ' — <strong>LEVEL UP</strong>' : '') + ' · +' + v.points + ' points</p>' : '') +
        (v.heartBroke ? '<p class="v-name">💔 Your Second Heart broke in the dark — and you stood back up.</p>' : '') +
        (v.bellRung ? '<p class="v-name">🔔 The Stillbell rang below.</p>' : '') +
        (banked ? '<p class="v-name">Banked: ' + banked + '</p>' : '<p class="v-name">Nothing banked.</p>') +
        (lost ? '<p class="v-name bad">Left in the dark: ' + lost + '</p>' : '') +
        '<div class="v-actions"><a class="fightbtn small" href="/verdict/' + v.id + '">Full verdict card</a>' +
        '<a class="ghostbtn" href="/descent">Delve again</a>' +
        '<a class="ghostbtn" href="/profile#satchel">Your satchel</a></div></div>';
    }
    verdictEl.innerHTML = html;
    verdictEl.classList.remove('hidden');
    sfx(v && v.result === 'win' ? 'verdictWin' : 'verdictLose');
  }
})();
