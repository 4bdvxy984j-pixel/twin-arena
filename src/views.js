'use strict';
const { TOOLS, TOOL_IDS, NODES, educationMeter, fmtTime, stormActive } = require('./game');

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
<script src="/js/sfx.js"></script>
</head><body>
<header class="topbar">
  <a class="brand" href="/"><span class="brandmark">◐</span> THE TWIN ARENA</a>
  <nav><a href="/arena">Fight</a><a href="/web">Evolution</a>${who}<button id="soundbtn" class="ghostbtn soundbtn" type="button">Sound: on</button></nav>
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

// ---- Super Deck weather, shown honestly wherever fighters stand ----------
function activeBroadcast(state) {
  const bc = state.config.broadcast;
  if (!bc || !bc.text) return null;
  if (bc.expiresAt && Date.now() >= bc.expiresAt) return null;
  return bc.text;
}
function bannersHtml(state) {
  const out = [];
  if (stormActive(state)) {
    const mins = Math.max(1, Math.round((state.config.stormUntil - Date.now()) / 60000));
    out.push(`<div class="banner stormbanner">⚡ <strong>STORM IN THE ARENA</strong> — every verdict pays <strong>double points</strong>, and the Twin fights at storm fury. <span id="storm-line">About ${mins} minute${mins === 1 ? '' : 's'} left in the storm.</span></div>`);
  }
  const bc = activeBroadcast(state);
  if (bc) out.push(`<div class="banner speakbanner"><span class="speak-tag">THE TWIN SPEAKS</span> <span id="speak-text">${esc(bc)}</span></div>`);
  if (state.config.floodgates) out.push(`<div class="banner floodbanner">🌊 <strong>THE FLOODGATES ARE OPEN</strong> — trace pressure is halved. Loud play costs half the noise, while it lasts.</div>`);
  return out.join('\n');
}
function spotlightHtml(state) {
  if (!state.config.spotlight) return '';
  const owner = Object.values(state.players).find(x => x.challengeToken === state.config.spotlight);
  if (!owner) return '';
  return `<section class="devilcard">
    ${owner.photo ? `<img class="p-face" src="${esc(owner.photo)}" alt="">` : '<div class="p-face ghost">◐</div>'}
    <div class="devil-info">
      <span class="devil-tag">★ TONIGHT'S DEVIL</span>
      <h2>${esc(owner.displayName || 'A fighter')}'s Twin holds the door</h2>
      <p class="dim">Hardened by ${owner.record.bouts} of their bouts · ${owner.record.breaches} breaches of their own. The keeper has pinned this devil to the door — go and meet it.</p>
    </div>
    <a class="fightbtn" href="/challenge/${esc(owner.challengeToken)}">⚔&nbsp; FIGHT THE DEVIL</a>
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
  ${bannersHtml(state)}
  ${spotlightHtml(state)}
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
    ${bannersHtml(state)}
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
      ${v.storm ? '<p class="v-storm">⚡ Storm verdict — points paid double under the storm.</p>' : ''}
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

function deckPage(state, opts) {
  const key = opts.key || '';
  const keyField = key ? `<input type="hidden" name="key" value="${esc(key)}">` : '';
  const m = educationMeter(state);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  // Today's tallies come from the verdict ledger (complete), not the capped rail.
  const tally = { breach: 0, integrity: 0, trace: 0, timeout: 0, total: 0 };
  for (const v of Object.values(state.verdicts)) {
    if (v.at < t0) continue;
    tally.total++;
    if (tally[v.endReason] !== undefined) tally[v.endReason]++;
  }
  const rail = state.fights.slice(0, 10).map(f => `<li class="railitem ${f.result}"><span class="railname">${esc(f.name)}</span><span class="railres">${railText(f)}</span><span class="railtime">${fmtTime(f.secs)}</span></li>`).join('') || '<li class="railitem">No fights yet.</li>';
  const leaders = Object.values(state.players)
    .filter(p => p.email && p.publicProfile !== false && p.record.bouts > 0)
    .sort((a, b) => (b.record.breaches - a.record.breaches) || (b.points - a.points))
    .slice(0, 5);
  const board = leaders.map(p => `<li><a href="/fighter/${p.id}">${p.photo ? `<img class="face" src="${esc(p.photo)}" alt="">` : '<span class="face ghost">◐</span>'}<span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${p.record.breaches} breaches · ${p.points} pts</span></a></li>`).join('') || '<li class="dim">No claimed fighters on the board yet.</li>';
  const storm = stormActive(state);
  const stormMins = storm ? Math.max(1, Math.round((state.config.stormUntil - Date.now()) / 60000)) : 0;
  const bc = activeBroadcast(state);
  const bcRaw = state.config.broadcast;
  const spotOwner = state.config.spotlight ? Object.values(state.players).find(x => x.challengeToken === state.config.spotlight) : null;
  const tied = !!state.deck.memberTieHash;
  const ownerFighter = state.deck.ownerPlayerId ? state.players[state.deck.ownerPlayerId] : null;
  const ERRORS = {
    spotlight: 'No fighter or challenge matches that — nothing was pinned.',
    tieexists: 'This deck is already tied to a Member Key. Remove the tie before tying another.',
    tiekey: 'That key is too short to tie. Paste the full Member Key.',
    untie: 'That was not the admin key — the tie still stands.'
  };
  const NOTICES = {
    tied: 'Tied. This deck now answers to your Member Key — and your fighter stands in the arena as you.',
    untied: 'Tie removed. The Member Key no longer opens this deck; the admin key still does.'
  };
  const body = `
  <section class="deckwrap">
    <h1>⚒ Arena Deck <span class="decksub">GOD-MODE TOYBOX</span></h1>
    <p class="dim">Every lever here moves the real game — the referee settles under whatever weather you set. ${opts.admin ? 'You hold the <strong>admin key</strong> (break-glass).' : 'You came in on your <strong>Member Key</strong>.'}</p>
    ${opts.saved ? '<p class="ok">Saved. The Twin adjusts immediately.</p>' : ''}
    ${opts.error ? `<p class="err">${esc(ERRORS[opts.error] || 'That did not take.')}</p>` : ''}
    ${opts.notice ? `<p class="ok">${esc(NOTICES[opts.notice] || '')}</p>` : ''}

    <div class="deckpanel wall">
      <h2>📺 THE WALL — the arena, live</h2>
      <div class="wallstats">
        <div><strong id="w-shapes">${m.shapes}</strong><span>shapes learned</span></div>
        <div><strong id="w-fighters">${m.fighters}</strong><span>fighters</span></div>
        <div><strong id="w-bouts">${m.bouts}</strong><span>bouts all-time</span></div>
        <div><strong>${tally.total}</strong><span>verdicts today</span></div>
      </div>
      <div class="wallstats tally">
        <div><strong class="good">${tally.breach}</strong><span>breached today</span></div>
        <div><strong>${tally.integrity}</strong><span>thrown out</span></div>
        <div><strong>${tally.trace}</strong><span>caught</span></div>
        <div><strong>${tally.timeout}</strong><span>turned back</span></div>
      </div>
      <h3>Recent fights</h3>
      <ul class="rail" id="w-rail">${rail}</ul>
      <h3>Top of the leaderboard</h3>
      <ul class="board">${board}</ul>
    </div>

    <div class="deckgrid">
      <div class="deckpanel stormp">
        <h2>⚡ STORM</h2>
        ${storm
          ? `<p><span class="led on gold"></span><strong>STORM LIVE</strong> — points ×2, aggression floor at storm fury. <strong>About ${stormMins} minute${stormMins === 1 ? '' : 's'}</strong> left on the clock.</p>
             <form method="post" action="/api/deck/storm" class="deckform">${keyField}<input type="hidden" name="cancel" value="1"><button class="bigbtn danger" type="submit">☀ CALM THE STORM</button></form>`
          : `<p><span class="led off"></span>The sky is quiet. Fire a storm and every verdict pays <strong>double points</strong> while the Twin fights at storm fury — banner up on the door and in the arena.</p>
             <form method="post" action="/api/deck/storm" class="deckform">${keyField}
               <label>Storm length (minutes)<input name="minutes" type="number" min="1" max="240" step="1" value="30"></label>
               <button class="bigbtn storm" type="submit">⚡ FIRE THE STORM</button></form>`}
      </div>

      <div class="deckpanel speakp">
        <h2>🗣 THE TWIN SPEAKS</h2>
        ${bc
          ? `<p><span class="led on"></span>The Twin is saying, to the whole arena:</p><blockquote class="twinline">${esc(bc)}</blockquote>
             <form method="post" action="/api/deck/broadcast" class="deckform">${keyField}<input type="hidden" name="clear" value="1"><button class="bigbtn" type="submit">SILENCE IT</button></form>`
          : '<p><span class="led off"></span>The Twin is silent. Give it a line and it says it on the door and in the arena, in its own banner.</p>'}
        <form method="post" action="/api/deck/broadcast" class="deckform">${keyField}
          <label>${bc ? 'Say something else' : 'The Twin says'} (140 characters, plain text)
            <input name="text" type="text" maxlength="140" placeholder="THE GATE REMEMBERS YOU."></label>
          <label>Keep it up for (minutes — blank = until cleared)<input name="minutes" type="number" min="0" max="1440" step="1" placeholder="∞"></label>
          <button class="bigbtn speak" type="submit">🗣 SPEAK</button></form>
        ${bcRaw && !bc ? '<p class="dim">The last line has expired.</p>' : ''}
      </div>

      <div class="deckpanel floodp">
        <h2>🌊 OPEN THE FLOODGATES</h2>
        ${state.config.floodgates
          ? `<p><span class="led on violet"></span><strong class="bad">THE FLOODGATES ARE OPEN.</strong> Trace gains are halved across the arena — the deck warns you because the arena shows it too. Chaos is honest or it is nothing.</p>
             <form method="post" action="/api/deck/floodgates" class="deckform">${keyField}<input type="hidden" name="state" value="off"><button class="bigbtn danger" type="submit">🌊 CLOSE THE FLOODGATES</button></form>`
          : `<p><span class="led off"></span>The floodgates are shut; the trace bites at full strength. Open them and every trace gain in the arena halves — loud play gets cheaper, and the arena says so on its face.</p>
             <form method="post" action="/api/deck/floodgates" class="deckform">${keyField}<input type="hidden" name="state" value="on"><button class="bigbtn flood" type="submit">🌊 OPEN THE FLOODGATES</button></form>`}
      </div>

      <div class="deckpanel spotp">
        <h2>★ SPOTLIGHT</h2>
        ${spotOwner
          ? `<p><span class="led on pink"></span><strong>Tonight's Devil:</strong> ${esc(spotOwner.displayName || 'A fighter')} — pinned to the arena door with their challenge link.</p>
             <p><a href="/challenge/${esc(spotOwner.challengeToken)}">/challenge/${esc(spotOwner.challengeToken)}</a> · <a href="/fighter/${spotOwner.id}">their profile</a></p>
             <form method="post" action="/api/deck/spotlight" class="deckform">${keyField}<input type="hidden" name="clear" value="1"><button class="bigbtn" type="submit">CLEAR THE SPOTLIGHT</button></form>`
          : '<p><span class="led off"></span>No devil is pinned. Pin any fighter\'s challenge to the arena door as <strong>Tonight\'s Devil</strong> — the Pit, arriving early.</p>'}
        <form method="post" action="/api/deck/spotlight" class="deckform">${keyField}
          <label>Pin by fighter id or challenge token<input name="pin" type="text" placeholder="fighter id or challenge token"></label>
          <button class="bigbtn spot" type="submit">★ PIN THE DEVIL</button></form>
      </div>
    </div>

    <div class="deckpanel tiep">
      <h2>🔑 THE MEMBER TIE</h2>
      ${tied
        ? `<p><span class="led on"></span>This deck is <strong>tied to your Gatekeeper Member Key</strong> — paste it at the deck door and you walk in, the way Gatekeeper itself signs you in. Only a hash of the key is kept here; the key itself is stored nowhere.</p>
           ${ownerFighter ? `<p>Your fighter in the arena: <a href="/fighter/${ownerFighter.id}"><strong>${esc(ownerFighter.displayName || 'Steven Hall')}</strong></a> — ${esc(ownerFighter.email || '')} · house owner · their devil, their grudge page, <em>theirs</em>.</p>` : ''}
           <form method="post" action="/api/deck/untie" class="deckform">${keyField}
             <label>Remove the tie — enter the ADMIN key to confirm<input name="adminKey" type="password" autocomplete="off"></label>
             <button class="bigbtn danger" type="submit">REMOVE THE TIE</button></form>`
        : (opts.admin
          ? `<p><span class="led off"></span>No member tie yet. Paste your <strong>Gatekeeper Member Key</strong> once, here, and this deck is yours by that key forever after — the server keeps only a scrypt hash of it, never the key. Tying also claims your fighter: <strong>Steven Hall</strong>, under your member identity.</p>
             <form method="post" action="/api/deck/tie" class="deckform">${keyField}
               <label>Your Gatekeeper Member Key (pasted once, never stored)<input name="memberKey" type="password" autocomplete="off"></label>
               <button class="bigbtn tie" type="submit">🔑 TIE THIS DECK TO MY MEMBER KEY</button></form>`
          : '<p><span class="led off"></span>No member tie yet — tying is done from an admin-key visit.</p>')}
    </div>

    <div class="deckpanel ctrlp">
      <h2>🎛 THE DIALS &amp; THE BIG SWITCH</h2>
      <p class="dim">Aggression <strong>${state.config.aggression}</strong> · learning speed <strong>${state.config.learningSpeed}</strong> · ${state.config.frozen ? '<strong class="bad">ARENA FROZEN</strong>' : 'arena open'}</p>
      <form method="post" action="/api/deck/config" class="deckform">
        ${keyField}
        <label>Twin aggression (0.5 – 2) — gate healing &amp; how hard it throws back (strike rate)
          <input name="aggression" type="number" step="0.1" min="0.5" max="2" value="${state.config.aggression}"></label>
        <label>Learning speed (0.5 – 2) — how fast familiarity grows
          <input name="learningSpeed" type="number" step="0.1" min="0.5" max="2" value="${state.config.learningSpeed}"></label>
        <label class="check"><input type="checkbox" name="frozen" ${state.config.frozen ? 'checked' : ''}> 🧊 FREEZE THE ARENA (closes it with a maintenance card — the deck stays up)</label>
        <button class="fightbtn" type="submit">Apply</button>
      </form>
    </div>
  </section>
  <script>
  // The wall stays live: poll the public state and refresh meter + rail.
  (function () {
    var fmt = function (s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    setInterval(function () {
      fetch('/api/public/state').then(function (r) { return r.json(); }).then(function (d) {
        document.getElementById('w-shapes').textContent = d.meter.shapes;
        document.getElementById('w-fighters').textContent = d.meter.fighters;
        document.getElementById('w-bouts').textContent = d.meter.bouts;
        var rail = document.getElementById('w-rail');
        if (rail && d.fights.length) {
          var how = function (f) {
            if (f.result === 'win') return 'breached the gate';
            if (f.how === 'trace') return 'was caught';
            if (f.how === 'integrity') return 'was thrown out';
            if (f.how === 'void') return 'had a bout voided';
            return 'was turned back';
          };
          rail.innerHTML = d.fights.map(function (f) {
            var name = String(f.name).replace(/[<>&"]/g, '');
            return '<li class="railitem ' + f.result + '"><span class="railname">' + name + '</span><span class="railres">' + how(f) + '</span><span class="railtime">' + fmt(f.secs) + '</span></li>';
          }).join('');
        }
      }).catch(function () {});
    }, 8000);
  })();
  </script>`;
  return shell('Arena Deck', body, null);
}

module.exports = { esc, shell, landing, arenaPage, authPage, profilePage, fighterPage, webPage, verdictPage, challengePage, deckPage, maintenanceCard };
