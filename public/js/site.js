'use strict';
// THE TWIN ARENA — shared site behaviors: live meter/rail refresh, evolution purchases.
(function () {
  // Landing: keep the education meter and spectator rail alive.
  var meter = document.getElementById('meter');
  if (meter) {
    var fmt = function (s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    var refresh = function () {
      fetch('/api/public/state').then(function (r) { return r.json(); }).then(function (d) {
        document.getElementById('m-shapes').textContent = d.meter.shapes;
        document.getElementById('m-fighters').textContent = d.meter.fighters;
        document.getElementById('m-bouts').textContent = d.meter.bouts;
        // Super Deck weather, kept honest between page loads.
        var speak = document.getElementById('speak-text');
        if (speak && d.broadcast) speak.textContent = d.broadcast;
        var stormLine = document.getElementById('storm-line');
        if (stormLine && d.storm && d.storm.active) {
          var mins = Math.max(1, Math.round(d.storm.secsLeft / 60));
          stormLine.textContent = 'About ' + mins + ' minute' + (mins === 1 ? '' : 's') + ' left in the storm.';
        }
        var rail = document.getElementById('rail');
        if (rail && d.fights.length) {
          var howText = function (f) {
            if (f.result === 'win') return 'breached the gate';
            if (f.how === 'trace') return 'was caught';
            if (f.how === 'integrity') return 'was thrown out';
            if (f.how === 'void') return 'had a bout voided';
            return 'was turned back';
          };
          rail.innerHTML = d.fights.map(function (f) {
            var name = String(f.name).replace(/[<>&"]/g, '');
            return '<li class="railitem ' + f.result + '"><span class="railname">' + name + '</span>' +
              '<span class="railres">' + howText(f) + '</span>' +
              '<span class="railtime">' + fmt(f.secs) + (f.shapes ? ' · taught ' + f.shapes + ' shape' + (f.shapes === 1 ? '' : 's') : '') + '</span></li>';
          }).join('');
        }
      }).catch(function () {});
    };
    setInterval(refresh, 5000);
  }

  // Mobile nav: at phone widths the links live behind the menu button —
  // the brand and the link row never share a line again.
  var navToggle = document.getElementById('navtoggle');
  var topbar = document.querySelector('.topbar');
  if (navToggle && topbar) {
    navToggle.addEventListener('click', function () {
      var open = topbar.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    });
  }

  // THE ARMORY: grand on a session's first load — after that it folds to a
  // one-line build summary so a returning fighter is never trapped behind
  // the ceremony. The fold toggle always brings it back.
  document.querySelectorAll('[data-armory]').forEach(function (el) {
    var btn = el.querySelector('[data-armory-toggle]');
    var setFold = function (folded) {
      el.classList.toggle('folded', folded);
      if (btn) btn.textContent = folded ? 'Unfold the armory' : 'Fold the armory';
    };
    var seen = false;
    try { seen = sessionStorage.getItem('ta-armory-seen') === '1'; } catch (e) {}
    if (seen) setFold(true);
    try { sessionStorage.setItem('ta-armory-seen', '1'); } catch (e) {}
    if (btn) btn.addEventListener('click', function () { setFold(!el.classList.contains('folded')); });
  });

  // Sound: big doors tick (and wake the audio) on the way in.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.fightbtn') : null;
    if (t && window.TASFX) { TASFX.unlock(); TASFX.play('click'); }
  });

  // Evolution web: purchase buttons.
  document.querySelectorAll('.evolvebtn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (window.TASFX) TASFX.unlock();
      btn.disabled = true;
      fetch('/api/evolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node: btn.getAttribute('data-node') })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) {
          if (window.TASFX) TASFX.play('evolve');
          setTimeout(function () { location.reload(); }, 320); // let the sound land
          return;
        }
        if (window.TASFX) TASFX.play('deny');
        var err = document.getElementById('weberr');
        if (err) { err.textContent = d.error || 'That evolution refused.'; err.classList.remove('hidden'); }
        btn.disabled = false;
      }).catch(function () { btn.disabled = false; });
    });
  });
})();
