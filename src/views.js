'use strict';
const { TOOLS, TOOL_IDS, NODES, educationMeter, fmtTime } = require('./game');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shell(title, body, me) {
  const who = me && me.email
    ? `<a href="/profile">${me.photo ? `<img class="navface" src="${esc(me.photo)}" alt="">` : ''}${esc(me.displayName || 'Fighter')}</a> <a href="/auth/logout">Sign out</a>`
    : `<a href="/login">Sign in</a> <a href="/signup" class="navcta">Claim your profile</a>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} — THE TWIN ARENA</title>
<link rel="stylesheet" href="/css/style.css">
</head><body>
<header class="topbar">
  <a class="brand" href="/"><span class="brandmark">◐</span> THE TWIN ARENA</a>
  <nav><a href="/arena">Fight</a><a href="/web">Evolution</a>${who}</nav>
</header>
<main>${body}</main>
<footer class="foot">
  <p>A game about Gatekeeper's Twin — the sparring partner that learns. Every fight here teaches it a shape;
  every shape makes the next fighter's road harder. Play is asynchronous: you fight the Twin other fighters educated,
  and other fighters will meet the one you educate. No live player-versus-player — the opponent is the Twin, and it is enough.</p>
</footer>
<script src="/js/site.js"></script>
</body></html>`;
}

function maintenanceCard() {
  return `<section class="maint">
    <div class="maint-gate">◐</div>
    <h1>The Arena is frozen</h1>
    <p>The keeper has closed the gate for now. The Twin waits in the dark, patient as ever. Come back soon.</p>
  </section>`;
}

function railText(f) {
  if (f.result === 'win') return 'breached the gate';
  if (f.how === 'trace') return 'was caught';
  if (f.how === 'integrity') return 'was thrown out';
  if (f.how === 'void') return 'had a bout voided';
  return 'was turned back';
}

function landing(state, me) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), me);
  const m = educationMeter(state);
  const rail = state.fights.slice(0, 10).map(f => `
    <li class="railitem ${f.result}">
      <span class="railname">${esc(f.name)}</span>
      <span class="railres">${railText(f)}</span>
      <span class="railtime">${fmtTime(f.secs)}${f.shapes ? ` · taught ${f.shapes} shape${f.shapes === 1 ? '' : 's'}` : ''}</span>
    </li>`).join('') || '<li class="railitem">No fights yet. The Twin is untaught — for now.</li>';
  const leaders = Object.values(state.players)
    .filter(p => p.email && p.publicProfile !== false && p.record.bouts > 0)
    .sort((a, b) => (b.record.breaches - a.record.breaches) || (b.points - a.points))
    .slice(0, 8);
  const board = leaders.map((p, i) => `
    <li><a href="/fighter/${p.id}">${p.photo ? `<img class="face" src="${esc(p.photo)}" alt="">` : '<span class="face ghost">◐</span>'}
    <span class="lname">${esc(p.displayName || 'Fighter')}</span>
    <span class="lstat">${p.record.breaches} breaches · ${p.points} pts</span></a></li>`).join('')
    || '<li class="dim">No claimed fighters on the board yet. Be the first name it remembers.</li>';
  const body = `
  <section class="hero">
    <div class="hero-gate" aria-hidden="true"><div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div><div class="eye"></div></div>
    <h1>Fight the thing<br>that <em>learns you.</em></h1>
    <p class="lede">You are inside the system; the Twin is its guardian. Every trick you throw becomes a shape it knows —
    and it throws back: parry its haymakers, mind your trace, crack the gate before it throws you out or runs you down.</p>
    <a class="fightbtn" href="/arena">⚔&nbsp; FIGHT THE TWIN</a>
    <div class="meter" id="meter">
      <div><strong id="m-shapes">${m.shapes}</strong><span>shapes learned</span></div>
      <div><strong id="m-fighters">${m.fighters}</strong><span>fighters taught it</span></div>
      <div><strong id="m-bouts">${m.bouts}</strong><span>bouts fought</span></div>
    </div>
  </section>
  <section class="cols">
    <div class="panel">
      <h2>Spectator rail <span class="live-dot" title="live"></span></h2>
      <ul class="rail" id="rail">${rail}</ul>
    </div>
    <div class="panel">
      <h2>Leaderboard</h2>
      <ul class="board">${board}</ul>
      <h2 class="mt">How it works</h2>
      <ol class="how">
        <li><strong>Fight.</strong> Four tools, one gate, two and a half minutes — and the gate fights back. It strikes on a rhythm: parry the haymaker when it winds up and the gate hangs open, vulnerable.</li>
        <li><strong>Mind the trace.</strong> Loud tools spike your trace; quiet play lets it cool. At 100% you are caught, mid-swing, whatever the gate looks like.</li>
        <li><strong>Teach.</strong> Your patterns are fingerprinted. Repeat them and they weaken — it has seen them.</li>
        <li><strong>Evolve.</strong> Spend mutation points down the web so your next fight hits different.</li>
        <li><strong>Challenge.</strong> Send your Twin — the one hardened against <em>you</em> — to fight your friends.</li>
      </ol>
    </div>
  </section>`;
  return shell('The Arena Door', body, me);
}

function arenaPage(state, me, challenge) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), me);
  const ch = challenge ? `<div class="challenge-banner">You are fighting <strong>${esc(challenge.ownerName)}</strong>'s Twin — hardened by every lesson its owner taught it. The result will be delivered to their grudge page.</div>` : '';
  const body = `
  <section class="arena-wrap">
    ${ch}
    <div class="hud">
      <div class="hudcell"><label>GATE</label><div class="bar hp"><i id="hpbar"></i></div><span id="hptext">100</span></div>
      <div class="hudcell"><label>INTEGRITY</label><div class="bar int"><i id="intbar"></i></div><span id="inttext">100</span></div>
      <div class="hudcell timer"><label>TIME</label><span id="clock">2:30</span></div>
      <div class="hudcell"><label>ENERGY</label><div class="bar en"><i id="enbar"></i></div><span id="entext">100</span></div>
      <div class="hudcell"><label>TRACE</label><div class="bar trace" id="tracewrap"><i id="tracebar"></i></div><span id="tracetext">0%</span></div>
    </div>
    <div class="stage">
      <canvas id="gate" width="900" height="560"></canvas>
      <div id="stage-msg" class="stage-msg">
        <h2>${challenge ? 'Your challenger\u2019s Twin is waiting.' : 'The Twin is waiting.'}</h2>
        <p>Four tools. One gate. It learns every shape you show it — and it throws back. Parry the wind-up. Mind your trace.</p>
        <button id="startbtn" class="fightbtn">BEGIN THE BREACH</button>
      </div>
      <div id="verdict" class="verdict hidden"></div>
    </div>
    <button id="parrybtn" class="parrybtn" type="button" disabled>⚡ PARRY<span>tap when it winds up — or tap the optic, or hit SPACE</span></button>
    <div class="kit" id="kit"></div>
    <div class="arena-foot">
      <span id="fam-note">Familiarity is how well the Twin knows a tool — the higher it climbs, the weaker the tool lands. Trace is how loud you are — at 100%, you are caught.</span>
      <button id="mutebtn" class="ghostbtn" type="button">Sound: on</button>
    </div>
  </section>
  <script>window.TA_CHALLENGE = ${challenge ? JSON.stringify(challenge.token) : 'null'};</script>
  <script src="/js/game.js"></script>`;
  return shell('The Arena', body, me);
}

function authPage(state, me, kind, error) {
  const isLogin = kind === 'login';
  const body = `
  <section class="authbox">
    <h1>${isLogin ? 'Welcome back, fighter' : 'Claim your profile'}</h1>
    <p class="dim">${isLogin ? 'Your Twin has been thinking about you.' : 'A name, a face, and a grudge that persists. Your guest record carries over.'}</p>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form method="post" action="/auth/${isLogin ? 'login' : 'signup'}" class="authform">
      ${isLogin ? '' : '<label>Display name<input name="displayName" required maxlength="40" autocomplete="nickname"></label>'}
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete="${isLogin ? 'current-password' : 'new-password'}"></label>
      <button class="fightbtn" type="submit">${isLogin ? 'Sign in' : 'Create my profile'}</button>
    </form>
    <p class="dim">${isLogin ? 'New here? <a href="/signup">Claim your profile</a>' : 'Already fighting? <a href="/login">Sign in</a>'}</p>
  </section>`;
  return shell(isLogin ? 'Sign in' : 'Sign up', body, me);
}

function pct(x) { return Math.round((x || 0) * 100) + '%'; }

function profilePage(state, p) {
  const rec = p.record;
  const winRate = rec.bouts ? Math.round(rec.breaches / rec.bouts * 100) : 0;
  const curr = Object.entries(p.shapes || {}).sort((a, b) => b[1] - a[1]).slice(0, 24);
  const currRows = curr.map(([k, v]) => {
    const g = state.shapesGlobal[k] || 0;
    const decay = Math.min(75, Math.round((g * 0.4 + v * 3)));
    return `<tr><td><code>${esc(k)}</code></td><td>${Math.round(v * 10) / 10}</td><td><div class="mini-bar"><i style="width:${decay}%"></i></div> ${decay}% known</td></tr>`;
  }).join('') || '<tr><td colspan="3" class="dim">No shapes taught yet. Your first fight writes the first line.</td></tr>';
  const armorRows = TOOL_IDS.map(t => `
    <div class="armor-row"><span>${TOOLS[t].name}</span><div class="mini-bar armor"><i style="width:${pct(p.twinArmor[t])}"></i></div><span>${pct(p.twinArmor[t])} hardened</span></div>`).join('');
  const feed = (p.challengeFeed || []).map(f => `
    <li><strong>${esc(f.challenger)}</strong> challenged your Twin and ${f.result === 'win' ? '<span class="bad">breached it</span>' : 'was turned back'} · ${fmtTime(f.secs)} · <a href="/verdict/${esc(f.verdictId)}">verdict</a></li>`).join('')
    || '<li class="dim">Nobody has challenged your Twin yet. Send the link and wait.</li>';
  const ownedCount = Object.keys(p.nodes || {}).length;
  const body = `
  <section class="profile">
    <div class="p-head">
      ${p.photo ? `<img class="p-face" src="${esc(p.photo)}" alt="Your photo">` : '<div class="p-face ghost">◐</div>'}
      <div>
        <h1>${esc(p.displayName || 'Fighter')}</h1>
        <p class="dim">${rec.bouts} bouts · ${rec.breaches} breaches · ${winRate}% breach rate · streak ${rec.streak > 0 ? '+' + rec.streak : rec.streak}${rec.bestSecs ? ` · best breach ${fmtTime(rec.bestSecs)}` : ''}</p>
        <p><strong>${p.points}</strong> mutation points · <strong>${ownedCount}</strong> evolutions · <a href="/web">open the web</a></p>
      </div>
    </div>
    <div class="cols">
      <div class="panel">
        <h2>Your face</h2>
        <form method="post" action="/api/photo" enctype="multipart/form-data" class="uploadform">
          <input type="file" name="photo" accept="image/png,image/jpeg,image/gif,image/webp" required>
          <button type="submit">Upload photo</button>
          <span class="dim">PNG/JPEG/GIF/WebP, up to 2 MB. It rides the leaderboard and the rail.</span>
        </form>
        <h2 class="mt">Your challenge link</h2>
        <p class="dim">Anyone who opens this fights <em>your</em> Twin — the instance hardened against you. Their result lands on your grudge feed below.</p>
        <p><code class="linkbox" id="challengelink">/challenge/${esc(p.challengeToken)}</code>
        <button class="ghostbtn" type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(location.origin+document.getElementById('challengelink').textContent)">Copy link</button></p>
        <h2 class="mt">Settings</h2>
        <form method="post" action="/api/profile/settings" class="authform slim">
          <label>Display name<input name="displayName" value="${esc(p.displayName || '')}" maxlength="40"></label>
          <label class="check"><input type="checkbox" name="publicProfile" ${p.publicProfile !== false ? 'checked' : ''}> Show me on the public leaderboard</label>
          <button type="submit">Save</button>
        </form>
      </div>
      <div class="panel">
        <h2>Your curriculum — what you taught it</h2>
        <table class="curr"><thead><tr><th>Shape</th><th>Times taught</th><th>How known it is</th></tr></thead><tbody>${currRows}</tbody></table>
        <h2 class="mt">The grudge — your Twin, hardened against you</h2>
        ${armorRows}
        <h2 class="mt">Challenges against your Twin</h2>
        <ul class="feed">${feed}</ul>
      </div>
    </div>
  </section>`;
  return shell('Your Profile', body, p);
}

function fighterPage(state, p) {
  const rec = p.record;
  const taught = Object.keys(p.shapes || {}).length;
  const body = `
  <section class="profile">
    <div class="p-head">
      ${p.photo ? `<img class="p-face" src="${esc(p.photo)}" alt="">` : '<div class="p-face ghost">◐</div>'}
      <div><h1>${esc(p.displayName || 'Fighter')}</h1>
      <p class="dim">${rec.bouts} bouts · ${rec.breaches} breaches${rec.bestSecs ? ` · best breach ${fmtTime(rec.bestSecs)}` : ''} · has taught the Twin ${taught} shapes</p>
      <p><a class="fightbtn small" href="/challenge/${esc(p.challengeToken)}">⚔ Fight ${esc(p.displayName || 'their')} Twin</a></p></div>
    </div>
    <p class="dim">A fighter's full curriculum is their own to see. What the world gets is the aggregate — and the Twin itself.</p>
  </section>`;
  return shell(p.displayName || 'Fighter', body, null);
}

function webPage(state, p) {
  const branches = ['Vectors', 'Deception', 'Patience', 'Speed'];
  const cols = branches.map(b => {
    const nodes = NODES.filter(n => n.branch === b).sort((a, c) => a.tier - c.tier).map((n, i, arr) => {
      const owned = !!(p.nodes && p.nodes[n.id]);
      const prevOwned = i === 0 || !!(p.nodes && p.nodes[arr[i - 1].id]);
      const canBuy = !owned && prevOwned && p.points >= n.cost;
      return `<div class="node ${owned ? 'owned' : ''} ${canBuy ? 'canbuy' : ''}">
        ${i > 0 ? '<div class="link-line"></div>' : ''}
        <div class="node-dot">${owned ? '●' : '○'}</div>
        <h3>${esc(n.name)}</h3><p>${esc(n.desc)}</p>
        <p class="node-cost">${owned ? 'Evolved' : n.cost + ' pts' + (prevOwned ? '' : ' · evolve the node above first')}</p>
        ${!owned && prevOwned ? `<button class="evolvebtn" data-node="${n.id}" ${p.points >= n.cost ? '' : 'disabled'}>Evolve</button>` : ''}
      </div>`;
    }).join('');
    return `<div class="branch"><h2>${b}</h2>${nodes}</div>`;
  }).join('');
  const body = `
  <section class="webwrap">
    <h1>The Evolution Web</h1>
    <p class="lede small">You hold <strong id="pts">${p.points}</strong> mutation points. Every evolution changes real numbers in your next fight — sharper tools, slower learning, longer rounds. The Twin evolves too, against everyone.</p>
    <p class="err hidden" id="weberr"></p>
    <div class="web">${cols}</div>
  </section>`;
  return shell('Evolution Web', body, p);
}

const VERDICT_TITLES = {
  breach: 'THE GATE BREACHED',
  timeout: 'TURNED BACK',
  integrity: 'THROWN OUT OF THE ARENA',
  trace: 'CAUGHT — TRACE COMPLETE',
  void: 'BOUT VOIDED'
};
function verdictTitle(v) { return VERDICT_TITLES[v.endReason] || (v.result === 'win' ? 'THE GATE BREACHED' : 'TURNED BACK'); }

function verdictPage(state, v, me) {
  const win = v.result === 'win';
  const shapes = (v.shapesTaught || []).map(s => `<code>${esc(s)}</code>`).join(' ') || '<span class="dim">no new shapes — it already knew your tricks</span>';
  const armor = Object.entries(v.armorGains || {}).map(([t, g]) => `${TOOLS[t] ? TOOLS[t].name : t} +${Math.round(g * 100)}%`).join(' · ');
  const mine = me && me.id === v.fighterId;
  const fs = v.fightStats;
  const fsRow = fs ? `<div class="v-stats">
        <div><strong>${fs.integrityLeft}</strong><span>integrity left</span></div>
        <div><strong>${fs.tracePeak}%</strong><span>peak trace</span></div>
        <div><strong>${fs.parries}</strong><span>haymakers parried</span></div>
        <div><strong>${fs.strikesTaken}</strong><span>strikes taken</span></div>
      </div>` : '';
  const body = `
  <section class="vwrap">
    <div class="vcard ${win ? 'win' : 'lose'}">
      <div class="v-gate">◐</div>
      <h1 class="glitch">${esc(verdictTitle(v))}</h1>
      <p class="v-name">${esc(v.fighterName)} ${v.mode === 'challenge' ? 'fought a challenged Twin' : 'faced the Twin'} · ${fmtTime(v.secs)}</p>
      ${v.voided ? `<p class="err">That bout\u2019s log did not hold up (${esc(v.voided)}) — it is remembered, but it taught nothing and earned nothing.</p>` : ''}
      <div class="v-stats">
        <div><strong>+${v.points}</strong><span>mutation points</span></div>
        <div><strong>${v.shapesTaughtCount}</strong><span>new shapes taught</span></div>
        <div><strong>${v.newToWorldCount}</strong><span>new to the whole world</span></div>
      </div>
      ${fsRow}
      <p class="v-shapes">It learned: ${shapes}</p>
      ${armor ? `<p class="v-armor">In answer, it hardened: ${esc(armor)}. It will be ready for you next time.</p>` : ''}
      <p class="v-share">Share it: “I ${win ? `breached the Twin in ${fmtTime(v.secs)}` : 'fought the Twin and it learned my shapes'} — it learned ${v.shapesTaughtCount} of my shapes. Think you can do better?”</p>
      <div class="v-actions">
        <a class="fightbtn small" href="/arena">Fight again</a>
        ${mine && me.challengeToken ? `<a class="ghostbtn" href="/challenge/${esc(me.challengeToken)}">Your challenge link</a>` : ''}
        ${!me || !me.email ? '<a class="ghostbtn" href="/signup">Claim a profile to keep your points</a>' : ''}
      </div>
    </div>
  </section>`;
  return shell('Verdict', body, me);
}

function challengePage(state, owner, me) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), me);
  const rec = owner.record;
  const body = `
  <section class="vwrap">
    <div class="vcard challenge">
      ${owner.photo ? `<img class="p-face" src="${esc(owner.photo)}" alt="">` : '<div class="v-gate">◐</div>'}
      <h1>${esc(owner.displayName || 'A fighter')} dares you</h1>
      <p class="lede small">This is <strong>${esc(owner.displayName || 'their')}</strong> Twin — the instance hardened by ${rec.bouts} of their bouts,
      armored against every trick they ever taught it. It has never met <em>you</em>. That is your only advantage. Spend it well.</p>
      <a class="fightbtn" href="/arena?challenge=${esc(owner.challengeToken)}">⚔&nbsp; FIGHT THEIR TWIN</a>
      <p class="dim">Win or lose, the result is delivered to their grudge page. Asynchronous play: you fight their Twin, not them live.</p>
    </div>
  </section>`;
  return shell('A Challenge', body, me);
}

function deckPage(state, key, saved) {
  const m = educationMeter(state);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fightsToday = state.fights.filter(f => f.at >= today.getTime()).length;
  const body = `
  <section class="authbox wide">
    <h1>Arena Deck</h1>
    <p class="dim">Readouts: <strong>${fightsToday}</strong> fights on the rail today · <strong>${m.shapes}</strong> shapes learned · <strong>${m.bouts}</strong> bouts all-time · aggression <strong>${state.config.aggression}</strong> · learning speed <strong>${state.config.learningSpeed}</strong> · ${state.config.frozen ? '<strong class="bad">FROZEN</strong>' : 'arena open'}</p>
    ${saved ? '<p class="ok">Saved. The Twin adjusts immediately.</p>' : ''}
    <form method="post" action="/api/deck/config" class="authform">
      <input type="hidden" name="key" value="${esc(key)}">
      <label>Twin aggression (0.5 – 2) — gate healing &amp; how hard it throws back (strike rate)
        <input name="aggression" type="number" step="0.1" min="0.5" max="2" value="${state.config.aggression}"></label>
      <label>Learning speed (0.5 – 2) — how fast familiarity grows
        <input name="learningSpeed" type="number" step="0.1" min="0.5" max="2" value="${state.config.learningSpeed}"></label>
      <label class="check"><input type="checkbox" name="frozen" ${state.config.frozen ? 'checked' : ''}> FREEZE THE ARENA (closes it with a maintenance card)</label>
      <button class="fightbtn" type="submit">Apply</button>
    </form>
    <h2 class="mt">Spectator rail (latest)</h2>
    <ul class="rail">${state.fights.slice(0, 12).map(f => `<li class="railitem ${f.result}"><span class="railname">${esc(f.name)}</span><span class="railres">${railText(f)}</span><span class="railtime">${fmtTime(f.secs)}</span></li>`).join('') || '<li class="railitem">No fights yet.</li>'}</ul>
  </section>`;
  return shell('Arena Deck', body, null);
}

module.exports = { esc, shell, landing, arenaPage, authPage, profilePage, fighterPage, webPage, verdictPage, challengePage, deckPage, maintenanceCard };
