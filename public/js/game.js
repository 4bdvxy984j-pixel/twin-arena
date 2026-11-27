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
  function elapsed() { return performance.now() - S.startedAt; }

  // ---------- start ----------
  startBtn.addEventListener('click', function () {
    if (SFX) SFX.unlock(); // inside the tap, synchronously — this is what wakes the audio
    startBtn.disabled = true;
    startBtn.textContent = 'THE GATE STIRS…';
    fetch('/api/fight/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: window.TA_CHALLENGE || undefined })
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
      markUntil: 0, critNext: 0,
      strikes: (d.strikes || []).map(function (s) { return { at: s.at, kind: s.kind, tool: s.tool, parried: false, eaten: false, done: false }; }),
      vulnFrom: -1, vulnUntil: -1, parryCdUntil: 0,
      alarmStage: 0, crackStage: 0,
      shake: 0, flash: 0, eyeRage: 0, hurt: 0, over: false, endReason: null,
      particles: [], texts: [], phantomUntil: 0, beam: null, strikeFx: null,
      famShown: {}, uses: {}
    };
    for (var id in st.tools) S.famShown[id] = st.tools[id].familiarity;
    stageMsg.classList.add('hidden');
    verdictEl.classList.add('hidden');
    parryBtn.disabled = false;
    buildKit(st);
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
      b.innerHTML = '<span class="tname" style="color:' + t.color + '">' + t.name + '</span>' +
        '<span class="tcost">' + t.cost + ' energy · ' + (t.cooldown / 1000).toFixed(1) + 's</span>' +
        '<span class="ttrace" style="color:' + (t.trace > 0 ? '#ff2a6d' : '#5dffa0') + '">' + traceTxt + '</span>' +
        '<span class="tfam">Twin familiarity <b data-fam>' + Math.round(t.familiarity * 100) + '%</b></span>' +
        '<span class="noenergy hidden">not enough energy</span>' +
        '<span class="cdveil"></span>';
      b.title = t.blurb;
      b.addEventListener('click', function () { useTool(id); });
      kitEl.appendChild(b);
    });
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
  function tryParry() {
    if (!S || S.over) return;
    var now = elapsed();
    if (now < S.parryCdUntil) return;
    var s = windingHaymaker(now);
    if (!s) { sfx('deny'); return; } // never log a parry the referee would call forged
    if (S.energy < S.combat.parryCost) { sfx('deny'); return; }
    S.energy -= S.combat.parryCost;
    S.parryCdUntil = now + S.combat.parryCooldown;
    s.parried = true;
    S.actions.push({ t: Math.round(now), tool: 'parry' });
    floatText('PARRY READY — WAIT FOR IT…', '#fcee0a', false);
    sfx('parryArm');
  }
  parryBtn.addEventListener('click', tryParry);

  function resolveStrike(s, now) {
    s.done = true;
    var cb = S.combat;
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
    S.integrity = Math.max(0, S.integrity - dmg);
    S.hurt = Math.min(1, S.hurt + (big ? 0.85 : 0.45));
    S.shake = Math.min(18, S.shake + (big ? 13 : 6));
    if (label) floatText(label, '#ff2a6d', true);
    if (S.integrity <= 0) endFight('integrity');
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
    S.cds[id] = now + t.cooldown;
    S.lastUse[id] = now;
    S.actions.push({ t: Math.round(now), tool: id });
    S.uses[id] = (S.uses[id] || 0) + 1;

    // The trace hears everything — and at 75% / 90% it says so, out loud.
    S.trace = Math.max(0, Math.min(S.combat.traceMax, S.trace + t.trace));
    if (t.trace > 0) floatText('+' + t.trace + '% TRACE', '#ff2a6d', false);
    if (S.trace >= 90 && S.alarmStage < 2) { S.alarmStage = 2; sfx('alarm2'); }
    else if (S.trace >= 75 && S.alarmStage < 1) { S.alarmStage = 1; sfx('alarm'); }
    if (S.trace >= S.combat.traceMax) { updateHud(); endFight('trace'); return; }

    // The Twin visibly learns: every repeat of a tool raises its shown familiarity.
    S.famShown[id] = Math.min(0.75, S.famShown[id] + 0.02);
    if (S.uses[id] === 3) floatText('IT HAS SEEN THIS SHAPE', '#ff2a6d', true);
    if (S.uses[id] === 6) floatText('IT KNOWS THIS ONE NOW', '#ff6b6b', true);

    // A decoy burned into a wind-up eats the strike before it lands.
    if (id === 'decoy') {
      var s = windingHaymaker(now);
      if (s) { s.eaten = true; floatText('DECOY UP — IT SWINGS AT THE GHOST', '#fcee0a', false); }
    }

    var dmg = t.dmg;
    var crit = 1;
    if (id !== 'decoy') {
      if (S.critNext > 0) { crit *= (1 + S.critNext); S.critNext = 0; S.phantomUntil = 0; }
      if (S.markUntil > now && id !== 'probe') { crit *= 1.3; S.markUntil = 0; }
      if (now >= S.vulnFrom && now <= S.vulnUntil) { crit *= S.combat.vulnMult; floatText('VULNERABLE ×' + S.combat.vulnMult, '#fcee0a', true); }
    }
    if (id === 'probe') {
      S.markUntil = now + 4000;
      S.beam = { until: performance.now() + 140, color: t.color };
      hitFx(dmg * crit, t.color, 10);
      sfx('probe');
    } else if (id === 'flood') {
      S.beam = { until: performance.now() + 200, color: t.color };
      hitFx(dmg * crit, t.color, 46);
      S.shake = Math.min(16, S.shake + 9);
      sfx('flood');
    } else if (id === 'whisper') {
      S.dots.push({ until: now + t.dotSecs * 1000, dps: t.dot });
      hitFx(dmg * crit, t.color, 14);
      sfx('whisper');
    } else if (id === 'decoy') {
      S.critNext = S.stats.decoyCrit;
      S.phantomUntil = now + 5000;
      if (!windingHaymaker(now)) floatText('A PHANTOM GATE STANDS', '#fcee0a');
      sfx('decoy');
    }
    if (crit > 1 && id !== 'decoy') floatText('BREACH IN THE PATTERN ×' + crit.toFixed(1), '#ffd166');
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
    if (windingHaymaker(elapsed())) tryParry(); else useTool('probe');
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
      if (!S.over && !burning && S.hp > 0) S.hp = Math.min(S.stats.gateHp, S.hp + S.stats.gateRegen * dt);
      if (S.trace < 70 && S.alarmStage) S.alarmStage = 0; // cooled off — the alarm can speak again
      // the haymaker's wind-up gets a voice the moment the telegraph opens
      var windingNow = windingHaymaker(now);
      if (windingNow && !windingNow.sndWindup) { windingNow.sndWindup = true; sfx('windup'); }
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
    var winding = !S.over && !!windingHaymaker(elapsed());
    parryBtn.classList.toggle('armed', winding);
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
    var winding = windingHaymaker(now);

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
    if (winding) {
      var s = windingHaymaker(elapsed());
      if (s) windP = 1 - Math.max(0, (s.at - elapsed()) / S.combat.windupMs);
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
    // wind-up warning ring, contracting onto the optic
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
      html = '<div class="vcard-inner vcard ' + (v.result === 'win' ? 'win' : '') + '">' +
        '<h1 class="glitch">' + title + '</h1>' +
        '<p class="v-name">' + (voided ? 'That bout\u2019s log did not hold up — remembered, but it taught nothing and earned nothing. ' : '') + shapes + '</p>' + fsLine +
        '<div class="v-stats"><div><strong>+' + v.points + '</strong><span>points</span></div>' +
        '<div><strong>' + Math.floor(v.secs / 60) + ':' + String(v.secs % 60).padStart(2, '0') + '</strong><span>time</span></div></div>' +
        '<div class="v-actions"><a class="fightbtn small" href="/verdict/' + v.id + '">Full verdict card</a>' +
        '<a class="ghostbtn" href="/arena">Fight again</a>' +
        '<a class="ghostbtn" href="/web">Evolve</a>' +
        '<a class="ghostbtn" href="/signup">Claim a profile</a></div></div>';
    }
    verdictEl.innerHTML = html;
    verdictEl.classList.remove('hidden');
    sfx(v && v.result === 'win' ? 'verdictWin' : 'verdictLose');
  }
})();
