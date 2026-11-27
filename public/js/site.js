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

  // Evolution web: purchase buttons.
  document.querySelectorAll('.evolvebtn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      fetch('/api/evolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node: btn.getAttribute('data-node') })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { location.reload(); return; }
        var err = document.getElementById('weberr');
        if (err) { err.textContent = d.error || 'That evolution refused.'; err.classList.remove('hidden'); }
        btn.disabled = false;
      }).catch(function () { btn.disabled = false; });
    });
  });
})();
