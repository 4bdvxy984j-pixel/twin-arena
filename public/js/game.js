'use strict';
// THE TWIN ARENA — the fight itself. Phase 2: it throws back.
// Canvas fortress-face of chrome and neon; four tools, one learning Twin that
// strikes on a server-dealt schedule. The round is simulated here for feel —
// integrity, trace, parries, scrambles and all — and the action log goes back
// to the server referee, which replays the same math and settles the truth.
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

  var S = null; // fight state
  // Sound lives in /js/sfx.js (window.TASFX): a real engine whose context is
  // created + resumed inside user gestures. The old local beep() created its
  // context inside a fetch callback and never resumed it — on phones the
  // context stayed suspended and the game was silent. The arena's own
  // #mutebtn is wired by sfx.js, alongside the header's #soundbtn.
  var SFX = window.TASFX || null;
  function sfx(name) { if (SFX) SFX.play(name); }

  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  // Tool sigils — the same four marks the Armory stands carry (views.js).
  var TOOL_ICONS = {
    probe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    flood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5v3.5"/><path d="M5.5 4.5l2 2.5M18.5 4.5l-2 2.5"/><path d="M2.5 14.5c2.4 0 2.4 1.8 4.8 1.8s2.4-1.8 4.8-1.8 2.4 1.8 4.8 1.8 2.4-1.8 4.6-1.8"/><path d="M2.5 19c2.4 0 2.4 1.8 4.8 1.8S9.7 19 12.1 19s2.4 1.8 4.8 1.8 2.4-1.8 4.6-1.8"/></svg>',
    whisper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><path d="M12.5 8.8a4.6 4.6 0 0 1 0 6.4M15.8 6.2a8.4 8.4 0 0 1 0 11.6M19 3.8a12.2 12.2 0 0 1 0 16.4"/></svg>',
    decoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 21v-7.5a7.5 7.5 0 0 1 15 0V21"/><path d="M9.3 21v-4.8a2.7 2.7 0 0 1 5.4 0V21"/><path d="M2.5 21h19"/></svg>'
  };
  function elapsed() { return performance.now() - S.startedAt; }

  // ---------- start ----------
  startBtn.addEventListener('click', function () {
    if (SFX) SFX.unlock(); // inside the tap, synchronously — this is what wakes the audio
    startBtn.disabled = true;
    startBtn.textContent = 'THE GATE STIRS…';
    var itemMirror = document.getElementById('item-mirror');
    var itemStitch = document.getElementById('item-stitch');
    var itemHeart = document.getElementById('item-heart');
    var itemBell = document.getElementById('item-bell');
    fetch('/api/fight/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge: window.TA_CHALLENGE || undefined,
        pit: window.TA_PIT || undefined,
        mirrorwrap: !!(itemMirror && itemMirror.checked),
        stitch: itemStitch && itemStitch.value ? itemStitch.value : undefined,
        heart: !!(itemHeart && itemHeart.checked),
        bell: !!(itemBell && itemBell.checked)
      })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          startBtn.disabled = false; startBtn.textContent = 'BEGIN THE BREACH';
          stageMsg.querySelector('p').textContent = res.d.message || res.d.error || 'The gate would not open.';
          return;
        }
        beginFight(res.d);
      })
      .catch(function () {
        startBtn.disabled = false; startBtn.textContent = 'BEGIN THE BREACH';
      });
  });

  function beginFight(d) {
    var st = d.stats, cb = st.combat;
    S = {
      fightId: d.fightId, stats: st, combat: cb,
      hp: st.gateHp, maxHp: st.gateHp,
      integrity: cb.playerHp, maxIntegrity: cb.playerHp,
      trace: 0,
      energy: st.energyMax,
      left: st.roundMs, startedAt: performance.now(), lastFrame: performance.now(),
      cds: {}, lastUse: {}, lockouts: {}, actions: [], dots: [],
      markUntil: 0, markCharges: 0, critNext: 0,
      strikes: (d.strikes || []).map(function (s) { return { at: s.at, kind: s.kind, tool: s.tool, revealed: !!s.revealed, parried: false, eaten: false, done: false }; }),
      postMorph: (d.postMorph || []).map(function (s) { return { offset: s.offset, kind: s.kind, tool: s.tool, revealed: !!s.revealed, parried: false, eaten: false, done: false }; }),
      morphed: false,
      vulnFrom: -1, vulnUntil: -1, parryCdUntil: 0,
      alarmStage: 0, crackStage: 0,
      shake: 0, flash: 0, eyeRage: 0, hurt: 0, over: false, endReason: null,
      particles: [], texts: [], phantomUntil: 0, beam: null, strikeFx: null,
      famShown: {}, uses: {},
      // Phase 3 deck state — mirrors the referee exactly
      abilityCds: {}, ghostCharges: 0, rapidUntil: 0, secondWindUsed: false,
      lastProbeAt: -1e9, lastDecoyAt: -1e9, windowCalled: false,
      heart: !!(d.gear && d.gear.heart), heartUsed: false,
      bellDeclared: !!(d.gear && d.gear.bell), bellRung: false, bellUntil: 0,
      // MODS v1 — the rail's purse and the hidden feeds, mirroring the referee
      modCharges: {}, overclockArmed: false,
      payback: 0, paybackPhantomUntil: 0, plateFed: 0, plateUntil: 0
    };
    var dep = (st.mods && st.mods.deploy) || {};
    for (var mid in dep) S.modCharges[mid] = dep[mid].charges || 0;
    for (var id in st.tools) S.famShown[id] = st.tools[id].familiarity;
    stageMsg.classList.add('hidden');
    verdictEl.classList.add('hidden');
    parryBtn.disabled = false;
    buildKit(st);
    buildAbilities(st);
    buildModRail(st);
    updateTwinRead();
    clockEl.textContent = fmtClock(S.left);
    sfx('begin');
    if (SFX) SFX.humStart();
    requestAnimationFrame(frame);
  }

  function buildKit(st) {
    kitEl.innerHTML = '';
    Object.keys(st.tools).forEach(function (id) {
      var t = st.tools[id];
      var b = document.createElement('button');
      b.className = 'tool'; b.id = 'tool-' + id;
      b.style.setProperty('--tc', t.color);
      var traceTxt = t.trace > 0 ? '+' + t.trace + '% trace' : (t.trace < 0 ? t.trace + '% trace' : 'no trace');
      b.innerHTML = '<span class="ticon">' + (TOOL_ICONS[id] || '') + '</span>' +
        '<span class="tname" style="color:' + t.color + '">' + t.name + '</span>' +
        '<span class="tdmg">DMG ' + t.dmg + (t.dot ? ' +' + t.dot + '/s burn' : '') + '</span>' +
        '<span class="tcost">' + t.cost + ' energy · ' + (t.cooldown / 1000).toFixed(1) + 's</span>' +
        '<span class="ttrace" style="color:' + (t.trace > 0 ? '#ff2a6d' : '#5dffa0') + '">' + traceTxt + '</span>' +
        (t.gear ? '<span class="tgear">⚜ ' + escHtml(t.gear.name) + ' (' + escHtml(t.gear.tier) + ')</span>' : '') +
        (t.mod ? '<span class="tmod" style="--mc:' + t.mod.color + '">' + t.mod.sigil + ' ' + escHtml(t.mod.name) + ' — SOCKETED</span>' : '') +
        '<span class="tfam">Twin familiarity <b data-fam>' + Math.round(t.familiarity * 100) + '%</b></span>' +
        '<span class="noenergy hidden">not enough energy</span>' +
        '<span class="cdveil"></span>';
      b.title = t.blurb;
      b.addEventListener('click', function () { useTool(id); });
      kitEl.appendChild(b);
    });
  }

  // ---------- the command deck: abilities, gear, the read ----------
  // Trace gains pass through two honest filters, in the referee's order:
  // GHOST eats the gain charge by charge; a rung STILLBELL freezes all rises.
  function heardTrace(amt, now) {
    if (amt > 0 && S.bellRung && now < S.bellUntil) return 0;
    return amt;
  }
  function applyTrace(amt, now) {
    S.trace = Math.max(0, Math.min(S.combat.traceMax, S.trace + amt));
    if (S.trace >= 90 && S.alarmStage < 2) { S.alarmStage = 2; sfx('alarm2'); }
    else if (S.trace >= 75 && S.alarmStage < 1) { S.alarmStage = 1; sfx('alarm'); }
    if (S.trace >= S.combat.traceMax) { updateHud(); endFight('trace'); return true; }
    return false;
  }
  function updateTwinRead() {
    if (!twinreadEl || !S) return;
    var best = null, bestN = 0;
    for (var id in S.uses) if (S.uses[id] > bestN) { bestN = S.uses[id]; best = id; }
    if (!best) { twinreadEl.textContent = 'THE TWIN READS YOU: nothing yet — it is watching your hands.'; return; }
    var t = S.stats.tools[best];
    var pct = Math.round((S.famShown[best] || 0) * 100);
    var mood = pct < 35 ? 'still guessing at' : pct < 60 ? 'learning' : 'KNOWS';
    twinreadEl.textContent = 'THE TWIN READS YOU: ' + t.name.toUpperCase() + ' is your tell — it is ' + mood +
      ' that shape (' + pct + '% familiar).' + (pct >= 60 ? ' Change the shape or pay for it.' : '');
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
    if (S.heart) {
      var hb = document.createElement('div');
      hb.className = 'tool ability heartpod'; hb.id = 'ability-heart';
      hb.innerHTML = '<span class="tname" style="color:#ff6b9d">💔 SECOND HEART — CARRIED</span>' +
        '<span class="tdmg">breaks at the first zeroing blow · you stand at 40</span>';
      abilitiesEl.appendChild(hb);
    }
  }
  // ---------- MODS v1: the rail under the pods ----------
  // The rail mirrors the referee charge for charge: buttons only exist for
  // dealt mods, charges only spend on a logged fire, and the hidden feeds
  // (Coil, Plate) accumulate exactly where the referee accumulates them.
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
  // The flat bonus waiting in the fighter's hands — the referee's own rule:
  // the Coil pays on the next strike; the Plate only after its window closes.
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
  // A parry answers a TELEGRAPH — a real wind-up or a Mirage feint alike.
  // The referee accepts both (the feint eats the reflex); a parry with no
  // telegraph of either kind would be a forgery, so the deck never logs one.
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
    if (!s) { sfx('deny'); return; } // never log a parry the referee would call forged
    if (S.energy < S.combat.parryCost) { sfx('deny'); return; }
    S.energy -= S.combat.parryCost;
    S.parryCdUntil = now + S.combat.parryCooldown;
    s.parried = true;
    S.actions.push({ t: Math.round(now), tool: 'parry' });
    if (s.kind === 'feint') {
      floatText(s.revealed ? 'YOU SAW THE LIE — AND PARRIED AIR ANYWAY' : 'PARRIED… AIR. IT WAS A MIRAGE.', '#b967ff', true);
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
      // MIRAGE: the wind-up was a lie. Nothing lands — unless you spent a
      // parry on it, in which case the phantom already ate your reflex.
      if (!s.parried) floatText(s.revealed ? 'THE CRACKED ONE — NOTHING THERE' : 'A WIND-UP… THAT NEVER CAME', '#b967ff', false);
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
      // SILENT (gear): a glance cannot scramble what it cannot hear.
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
    // clean hit — it punches back, plain and hard
    hurt(cb.strikeDmg.clean, null, false);
    S.strikeFx = { until: performance.now() + 160 };
    sfx('hitPlayer');
  }
  function hurt(dmg, label, big) {
    // MODS drink the blow first: the Plate feeds inside its window (half
    // the weight, capped); the Coil feeds while its phantom stands.
    var hnow = elapsed();
    if (hnow < S.plateUntil) S.plateFed = Math.min(20, S.plateFed + dmg * 0.5);
    if (S.paybackPhantomUntil > 0 && hnow < S.paybackPhantomUntil) S.payback = Math.min(12, S.payback + dmg * 0.25);
    S.integrity = Math.max(0, S.integrity - dmg);
    S.hurt = Math.min(1, S.hurt + (big ? 0.85 : 0.45));
    S.shake = Math.min(18, S.shake + (big ? 13 : 6));
    if (label) floatText(label, '#ff2a6d', true);
    if (S.integrity <= 0) {
      // THE SECOND HEART: the first zeroing blow breaks it instead.
      if (S.heart && !S.heartUsed) {
        S.heartUsed = true;
        S.integrity = 40;
        floatText('💔 THE SECOND HEART BREAKS — YOU STAND AT 40', '#ff6b9d', true);
        sfx('heart');
        var hb = document.getElementById('ability-heart');
        if (hb) hb.classList.add('spent');
        return;
      }
      endFight('integrity');
    }
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
    // RAPID CYCLING: a use inside the window earns the halved cooldown —
    // the same one the referee will hold you to.
    S.cds[id] = now + (now <= S.rapidUntil ? t.cooldown * 0.5 : t.cooldown);
    // OVERCLOCK (mod rail): the armed strike's own cooldown halves again.
    if (S.overclockArmed) { S.cds[id] = now + (S.cds[id] - now) * 0.5; S.overclockArmed = false; }
    S.lastUse[id] = now;
    S.actions.push({ t: Math.round(now), tool: id });
    S.uses[id] = (S.uses[id] || 0) + 1;

    // The trace hears everything — GHOST eats 3 strikes' worth, a rung
    // STILLBELL freezes the rest. At 75% / 90% the trace says so, out loud.
    var traceAdd = t.trace;
    if (traceAdd > 0 && S.ghostCharges > 0) { traceAdd = 0; S.ghostCharges--; floatText('GHOST — NO TRACE', '#b967ff', false); }
    traceAdd = heardTrace(traceAdd, now);
    if (t.trace > 0 && traceAdd > 0) floatText('+' + traceAdd + '% TRACE', '#ff2a6d', false);
    if (applyTrace(traceAdd, now)) return;

    // The Twin visibly learns: every repeat of a tool raises its shown familiarity.
    S.famShown[id] = Math.min(0.75, S.famShown[id] + 0.02);
    if (S.uses[id] === 3) floatText('IT HAS SEEN THIS SHAPE', '#ff2a6d', true);
    if (S.uses[id] === 6) floatText('IT KNOWS THIS ONE NOW', '#ff6b6b', true);
    updateTwinRead();

    // A decoy burned into a wind-up eats the strike before it lands.
    if (id === 'decoy') {
      S.lastDecoyAt = now;
      // PAYBACK COIL (fitted): its phantom drinks blows for 5 seconds.
      if (t.paybackCoil) S.paybackPhantomUntil = now + 5000;
      // THROUGHLINE (fitted): the mark goes through the Decoy.
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
        // MARK & DROWN — the combo replaces the plain mark bonus.
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
      // COLD TRAIL — a Whisper on a fresh Decoy's heels dumps trace.
      if (now - S.lastDecoyAt <= 5000) {
        S.trace = Math.max(0, S.trace - 12);
        floatText('COLD TRAIL −12% TRACE', '#5dffa0', true); sfx('combo');
      }
    } else if (id === 'decoy') {
      S.critNext = S.stats.decoyCrit;
      S.phantomUntil = now + 5000;
      if (!windingHaymaker(now)) floatText('A PHANTOM GATE STANDS', '#fcee0a');
      // THE SECOND GHOST (gear): the decoy strikes once before it fades.
      if (t.ghostStrike && !S.over) { hitFx(t.ghostStrike, t.color, 8); floatText('THE SECOND GHOST STRIKES', '#fcee0a', true); }
      // A twinned decoy dumps its trace twice.
      if (t.twin) S.trace = Math.max(0, S.trace + t.trace);
      sfx('decoy');
    }
    if (crit > 1 && id !== 'decoy') floatText('BREACH IN THE PATTERN ×' + crit.toFixed(1), '#ffd166');
    // TWINNED (the Captor's prize): the strike lands a second time — full
    // base damage, and the trace hears it too. Mirrors the referee exactly.
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

  // The gate audibly comes apart in stages: 75% / 50% / 25% integrity.
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
    for (var i = 0; i < n; i++) {
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
      // whisper burns + gate healing (silenced while a burn lives)
      var burning = false;
      S.dots = S.dots.filter(function (d) {
        if (now < d.until) { burning = true; S.hp = Math.max(0, S.hp - d.dps * dt); return true; }
        return false;
      });
      if (S.hp <= 0) { endFight('breach'); }
      checkCrack();
      // MORPH ARMOR: at half integrity the devil sheds its lessons and its
      // rhythm re-seeds — the dealt post-morph offsets take over from here.
      if (!S.over && !S.morphed && S.stats.morph && S.hp > 0 && S.hp <= S.maxHp * 0.5) {
        S.morphed = true;
        S.strikes = S.strikes.filter(function (x) { return x.done; });
        S.postMorph.forEach(function (x) { x.at = now + x.offset; S.strikes.push(x); });
        S.strikes.sort(function (a, b) { return a.at - b.at; });
        for (var tid in S.stats.tools) {
          var tt = S.stats.tools[tid];
          if (tt.famMorph !== undefined) S.famShown[tid] = tt.famMorph;
        }
        floatText('⚠ THE ARMOR MORPHS — OLD LESSONS SHED', '#ff6b9d', true);
        sfx('morph');
        updateTwinRead();
      }
      if (!S.over && !burning && S.hp > 0) S.hp = Math.min(S.stats.gateHp, S.hp + S.stats.gateRegen * dt);
      if (S.trace < 70 && S.alarmStage) S.alarmStage = 0; // cooled off — the alarm can speak again
      // a telegraph gets a voice the moment it opens — a REVEALED feint
      // sounds cracked; an unrevealed one sounds exactly like the truth
      var windingNow = windingTelegraph(now);
      if (windingNow && !windingNow.sndWindup) {
        windingNow.sndWindup = true;
        if (windingNow.kind === 'feint' && windingNow.revealed) { sfx('feintReveal'); floatText('CRACKED GLASS — THAT WIND-UP IS A LIE', '#7df9ff', true); }
        else sfx('windup');
      }
      // the Twin's rhythm: strikes land on schedule whether you watch or not
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
    // OPEN WINDOW: the gold frame counts down the vulnerability window.
    if (winframeEl) {
      var inWin = !S.over && nowH >= S.vulnFrom && nowH <= S.vulnUntil;
      winframeEl.classList.toggle('hidden', !inWin);
      if (inWin && winframeBar) {
        var span = Math.max(1, S.vulnUntil - S.vulnFrom);
        winframeBar.style.width = Math.round(Math.max(0, (S.vulnUntil - nowH) / span) * 100) + '%';
      }
    }
    // The MOD RAIL refreshes on the same sweep: pips are charges, spent
    // buttons go dark, an armed Overclock or a live Plate pulses.
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
    // Ability pods cool down on the same sweep as the tools.
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

  // ---------- drawing the fortress-face ----------
  function draw(nowPerf, dt) {
    var now = S ? elapsed() : 0;
    ctx.clearRect(0, 0, W, H);
    // neon grid floor + drifting data dust
    ctx.strokeStyle = 'rgba(0,229,255,0.07)'; ctx.lineWidth = 1;
    for (var gx = 0; gx <= W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 0; gy <= H; gy += 60) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,229,255,0.5)';
    for (var i = 0; i < 26; i++) {
      var sx = (i * 173.3 + nowPerf * 0.008 * (1 + i % 3)) % W;
      var sy = (i * 97.7 + Math.sin(nowPerf * 0.0004 + i) * 14 + H) % H;
      ctx.globalAlpha = 0.10 + 0.08 * Math.sin(nowPerf * 0.001 + i * 2);
      ctx.fillRect(sx, sy, 2, 2);
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

    // phantom decoy gate
    if (now < S.phantomUntil) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.12 * Math.sin(t * 6);
      ring(cx - 190, cy + 10, 92, 0.8, '#fcee0a', t * 0.4);
      ctx.restore();
    }
    // the fortress rings — chrome understructure, neon skin; segments wink out as integrity falls
    ring(cx, cy, 168, frac, '#00e5ff', t * 0.12);
    ring(cx, cy, 128, Math.max(0, frac * 1.08 - 0.06), '#b967ff', -t * 0.18);
    ring(cx, cy, 88, Math.max(0, frac * 1.15 - 0.12), '#ff2a6d', t * 0.26);
    if (vuln) {
      ctx.save();
      ctx.globalAlpha = 0.20 + 0.08 * Math.sin(t * 14);
      ctx.strokeStyle = '#fcee0a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 186, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // beam (your strike) and counter-beam (its answer)
    if (S.beam && performance.now() < S.beam.until) {
      ctx.strokeStyle = S.beam.color; ctx.globalAlpha = 0.75; ctx.lineWidth = 3;
      ctx.shadowColor = S.beam.color; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(60, H - 40); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (S.strikeFx && performance.now() < S.strikeFx.until) {
      ctx.strokeStyle = '#ff2a6d'; ctx.globalAlpha = 0.8; ctx.lineWidth = 4;
      ctx.shadowColor = '#ff2a6d'; ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 26, cy + 120); ctx.lineTo(cx - 14, cy + 210); ctx.lineTo(cx + 10, H);
      ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    drawOptic(cx, cy, t, winding, vuln);
    if (S.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (S.flash * 0.14) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (S.hurt > 0) {
      var hg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75);
      hg.addColorStop(0, 'rgba(255,42,109,0)');
      hg.addColorStop(1, 'rgba(255,42,109,' + (S.hurt * 0.4) + ')');
      ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
    }
    // particles
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
    // floating texts — the important ones stutter in RGB split
    S.texts = S.texts.filter(function (tx) {
      tx.age += dt;
      if (tx.age > tx.life) return false;
      var a = 1 - tx.age / tx.life;
      ctx.font = '700 19px "Arial Narrow","Avenir Next","Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      var y = tx.y - tx.age * 26;
      if (tx.glitch) {
        var j = (Math.random() - 0.5) * 5;
        ctx.globalAlpha = a * 0.8; ctx.fillStyle = '#00e5ff';
        ctx.fillText(tx.txt, W / 2 - 2 + j, y);
        ctx.fillStyle = '#ff2a6d';
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
    var windStrike = null;
    if (winding) {
      var s = windingTelegraph(elapsed());
      if (s) { windStrike = s; windP = 1 - Math.max(0, (s.at - elapsed()) / S.combat.windupMs); }
    }
    var R = (15 + Math.sin(t * 2.2) * 1.6 + S.eyeRage * 7) * (vuln ? 1.7 : 1) * (1 + windP * 0.5);
    // chrome aperture — a rotated square frame, glitching when struck
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4 + t * 0.15);
    var ap = 34 + windP * 8;
    ctx.strokeStyle = 'rgba(215,221,232,0.85)'; ctx.lineWidth = 3;
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 10;
    var off = S.flash > 0.25 ? (Math.random() - 0.5) * 7 : 0;
    ctx.strokeRect(-ap + off, -ap, ap * 2, ap * 2);
    ctx.strokeStyle = 'rgba(255,42,109,0.5)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(-ap - off, -ap, ap * 2, ap * 2);
    ctx.restore();
    ctx.shadowBlur = 0;
    // halo
    var grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, 48);
    grad.addColorStop(0, vuln ? 'rgba(252,238,10,0.95)' : 'rgba(255,209,102,0.95)');
    grad.addColorStop(0.35, 'rgba(255,42,109,0.55)');
    grad.addColorStop(1, 'rgba(255,42,109,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.ellipse(cx, cy, 48, 48 * (1 - narrow * 0.5), 0, 0, Math.PI * 2); ctx.fill();
    // the iris, drawn in glitch slices while it rages or winds up
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
    // wind-up warning ring, contracting onto the optic — a REVEALED feint
    // renders cracked (dashed ice-blue): the Mirror Wrap shows the lie
    if (winding) {
      ctx.save();
      var cracked = windStrike && windStrike.kind === 'feint' && windStrike.revealed;
      ctx.strokeStyle = cracked ? '#7df9ff' : '#fcee0a'; ctx.lineWidth = 3;
      ctx.shadowColor = cracked ? '#7df9ff' : '#fcee0a'; ctx.shadowBlur = 16;
      if (cracked) ctx.setLineDash([7, 6]);
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(t * 22);
      ctx.beginPath(); ctx.arc(cx, cy, 120 - windP * 62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function ring(cx, cy, r, frac, color, rot) {
    var segs = 26;
    // chrome understructure
    ctx.lineWidth = 11;
    ctx.strokeStyle = 'rgba(120,132,150,0.28)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.shadowColor = color; ctx.shadowBlur = 13;
    for (var i = 0; i < segs; i++) {
      var a0 = rot + (i / segs) * Math.PI * 2 + 0.035;
      var a1 = rot + ((i + 1) / segs) * Math.PI * 2 - 0.035;
      // deterministic per-segment "damage map": segments wink out as frac falls
      var keep = ((i * 2654435761 % 100) / 100);
      ctx.strokeStyle = color;
      ctx.globalAlpha = keep < frac ? 0.95 : 0.07;
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  // ---------- end ----------
  var END_TITLES = { breach: 'THE GATE BREACHED', timeout: 'TURNED BACK', integrity: 'THROWN OUT OF THE ARENA', trace: 'CAUGHT — TRACE COMPLETE' };
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
      showVerdict(d.verdict, reason, d.voided);
    }).catch(function () { showVerdict(null, reason, null); });
    updateHud();
  }
  function hitFxSpark() {
    if (!S) return;
    var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
    S.particles.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.8, age: 0, color: ['#00e5ff', '#ff2a6d', '#fcee0a', '#b967ff'][Math.floor(Math.random() * 4)], r: 1.5 + Math.random() * 3 });
  }

  function showVerdict(v, localReason, voided) {
    var html;
    if (!v) {
      html = '<div class="vcard-inner vcard"><h1>' + (END_TITLES[localReason] || 'TURNED BACK') + '</h1><p class="dim">The verdict could not be recorded. The Twin keeps what it learned anyway.</p><a class="fightbtn small" href="/arena">Fight again</a></div>';
    } else {
      var reason = v.endReason || localReason;
      var title = END_TITLES[reason] || (v.result === 'win' ? 'THE GATE BREACHED' : 'TURNED BACK');
      var shapes = v.shapesTaughtCount ? ('It learned ' + v.shapesTaughtCount + ' of your shapes.') : 'It already knew your tricks — no new shapes taught.';
      var fs = v.fightStats;
      var fsLine = fs ? ('<p class="v-name">Integrity left ' + fs.integrityLeft + ' · peak trace ' + fs.tracePeak + '% · ' + fs.parries + ' parried · ' + fs.strikesTaken + ' strikes taken</p>') : '';
      var xpLine = v.xp ? ('<p class="v-name">+' + v.xp + ' XP' + (v.emberBonus ? ' (Founder\u2019s Ember +10%)' : '') + (v.levelUp ? ' — <strong>LEVEL UP</strong>' : '') + '</p>') : '';
      var comboLine = fs && fs.combos && fs.combos.length ? ('<p class="v-name">Combos: ' + fs.combos.map(function (c) { return { 'mark-drown': 'MARK & DROWN', 'cold-trail': 'COLD TRAIL', 'open-window': 'OPEN WINDOW' }[c] || c; }).join(' · ') + '</p>') : '';
      var pitLine = v.mode === 'pit' ? ('<p class="v-name">⚔ The Pit' + (v.bountyWon ? ' — bounty taken: <strong>' + v.bountyWon + ' pts</strong>' : '') + (v.feints ? ' · it showed ' + v.feints + ' Mirage phantom' + (v.feints === 1 ? '' : 's') : '') + (v.morphed ? ' · its armor <strong>morphed</strong> mid-fight' : '') + '</p>') : '';
      var gearLine = (v.heartBroke ? '<p class="v-name">💔 Your Second Heart broke — and you stood back up.</p>' : '') + (v.bellRung ? '<p class="v-name">🔔 The Stillbell rang; the trace held its breath.</p>' : '');
      var modsLine = fs && fs.modsUsed && fs.modsUsed.length ? ('<p class="v-name">Mods fired: ' + fs.modsUsed.map(function (m) { return { overclock: 'OVERCLOCK', tracepurge: 'TRACE PURGE', ghostplate: 'GHOST PLATE', coldsnap: 'COLD SNAP' }[m] || m; }).join(' · ') + '</p>') : '';
      var modDropLine = v.modDrop ? ('<p class="dropbanner rare">MOD FOUND IN THE WRECKAGE — ' + escHtml(v.modDrop.name) + (v.modDrop.kind === 'fitted' ? ' · socket it at your satchel' : ' · it rides your rail now') + '</p>') : '';
      var dropHtml = '';
      (v.drops || []).forEach(function (dr) {
        var names = { mirrorwrap: 'THE MIRROR WRAP', anchorstitch: 'ANCHOR STITCH', secondheart: 'THE SECOND HEART', stillbell: 'THE STILLBELL', foundersember: "THE FOUNDER'S EMBER" };
        if (dr.rarity === 'LEGENDARY') {
          dropHtml += '<p class="dropbanner legendary">★ LEGENDARY DROP — ' + (names[dr.item] || dr.item) + ' No. ' + dr.serial + ' · signed · the Keeper of the Arena</p>';
          sfx('legendary');
        } else {
          dropHtml += '<p class="dropbanner ' + String(dr.rarity || 'rare').toLowerCase() + '">' + (dr.rarity || 'RARE') + ' DROP — ' + (names[dr.item] || dr.item) + ' No. ' + dr.serial + ' · signed · the Keeper of the Arena</p>';
          sfx('drop');
        }
      });
      var againHref = v.mode === 'pit' && v.devilOwnerId ? '/arena?pit=' + v.devilOwnerId : '/arena';
      html = '<div class="vcard-inner vcard ' + (v.result === 'win' ? 'win' : '') + '">' +
        '<h1 class="glitch">' + title + '</h1>' +
        '<p class="v-name">' + (voided ? 'That bout\u2019s log did not hold up — remembered, but it taught nothing and earned nothing. ' : '') + shapes + '</p>' + fsLine +
        xpLine + comboLine + pitLine + gearLine + modsLine + modDropLine + dropHtml +
        '<div class="v-stats"><div><strong>+' + v.points + '</strong><span>points</span></div>' +
        '<div><strong>' + Math.floor(v.secs / 60) + ':' + String(v.secs % 60).padStart(2, '0') + '</strong><span>time</span></div></div>' +
        '<div class="v-actions"><a class="fightbtn small" href="/verdict/' + v.id + '">Full verdict card</a>' +
        '<a class="ghostbtn" href="' + againHref + '">Fight again</a>' +
        '<a class="ghostbtn" href="/web">Evolve</a>' +
        '<a class="ghostbtn" href="/signup">Claim a profile</a></div></div>';
    }
    verdictEl.innerHTML = html;
    verdictEl.classList.remove('hidden');
    sfx(v && v.result === 'win' ? 'verdictWin' : 'verdictLose');
  }
})();
