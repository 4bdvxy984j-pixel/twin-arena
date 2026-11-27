'use strict';
const game = require('./game');
const { TOOLS, TOOL_IDS, NODES, educationMeter, fmtTime, stormActive } = game;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Drifting embers — one ambient layer for the whole house, neon yard and
// gothic deep alike. Pure CSS sparks (capped count, reduced-motion safe).
const EMBERS_HTML = `<div class="embers" aria-hidden="true">${'<i></i>'.repeat(14)}</div>`;

function shell(title, body, me) {
  const who = me && me.email
    ? `<a href="/profile">${me.photo ? `<img class="navface" src="${esc(me.photo)}" alt="">` : ''}${esc(me.displayName || 'Fighter')}</a> <a href="/auth/logout">Sign out</a>`
    : `<a href="/login">Sign in</a> <a href="/signup" class="navcta">Claim your profile</a>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- twin-arena build: 2026.11.27-galactic -->
<title>${esc(title)} — THE TWIN ARENA</title>
<link rel="stylesheet" href="/css/style.css">
<script src="/js/sfx.js"></script>
</head><body>
${EMBERS_HTML}
<header class="topbar">
  <a class="brand" href="/"><span class="brandmark">◐</span> THE TWIN ARENA</a>
  <button id="navtoggle" class="navtoggle" type="button" aria-expanded="false" aria-controls="topnav" aria-label="Open the menu">☰</button>
  <nav id="topnav"><a href="/arena">Fight</a><a href="/pit">The Pit</a><a href="/descent">The Descent</a><a href="/galactic">The Galactic</a><a href="/web">Evolution</a>${who}<button id="soundbtn" class="ghostbtn soundbtn" type="button">Sound: on</button></nav>
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

// ---- THE ARMORY — the fighter's build, loaded with ceremony -------------
// Presentation only: every line below is read off the fighter's real record
// (worn gear, satchel items, GODFORGED treasures, evolved abilities) — the
// same build the referee will settle. Grand on a session's first load;
// site.js folds it to a one-line summary after that, one tap to unfold.
const TOOL_ICONS = {
  probe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  flood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5v3.5"/><path d="M5.5 4.5l2 2.5M18.5 4.5l-2 2.5"/><path d="M2.5 14.5c2.4 0 2.4 1.8 4.8 1.8s2.4-1.8 4.8-1.8 2.4 1.8 4.8 1.8 2.4-1.8 4.6-1.8"/><path d="M2.5 19c2.4 0 2.4 1.8 4.8 1.8S9.7 19 12.1 19s2.4 1.8 4.8 1.8 2.4-1.8 4.6-1.8"/></svg>',
  whisper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><path d="M12.5 8.8a4.6 4.6 0 0 1 0 6.4M15.8 6.2a8.4 8.4 0 0 1 0 11.6M19 3.8a12.2 12.2 0 0 1 0 16.4"/></svg>',
  decoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 21v-7.5a7.5 7.5 0 0 1 15 0V21"/><path d="M9.3 21v-4.8a2.7 2.7 0 0 1 5.4 0V21"/><path d="M2.5 21h19"/></svg>',
  body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 19 5v6c0 4.8-3 8.4-7 10.2C8 19.4 5 15.8 5 11V5Z"/><path d="M12 6.2v11.4M7.6 9.2h8.8"/></svg>'
};
function toolIcon(id) { return TOOL_ICONS[id] || TOOL_ICONS.body; }

function armoryHtml(p) {
  if (!p || !p.email) return '';
  const worn = game.wornGearMap(p);
  const stands = game.GEAR_SLOTS.map(slot => {
    const g = worn[slot];
    const label = slot === 'body' ? 'Body relic' : TOOLS[slot].name;
    // MODS v1: the socketed mod rides the stand, sigil and all.
    const fm = slot !== 'body' ? game.fittedMod(p, slot) : null;
    const modChip = fm ? `<span class="stand-mod" style="--mc:${game.FITTED_MODS[fm].color}">${game.FITTED_MODS[fm].sigil} ${esc(game.FITTED_MODS[fm].name)} socketed</span>` : '';
    if (!g) {
      return `<div class="stand bare"><span class="stand-icon">${toolIcon(slot)}</span><span class="stand-slot">${label}</span><strong class="stand-name dim">BARE</strong><span class="stand-affixes dim">nothing worn — the depths provide</span>${modChip}</div>`;
    }
    const tier = String(g.tier || 'STURDY').toUpperCase();
    const affixes = game.gearLine(g).map(esc).join(' · ');
    return `<div class="stand r-${tier.toLowerCase()}"><span class="stand-icon">${toolIcon(slot)}</span><span class="stand-slot">${label}</span><strong class="stand-name">${esc(g.name)}</strong><span class="tierbadge t-${tier.toLowerCase()}">${tier}${g.serial ? ' No. ' + g.serial : ''}</span>${affixes ? `<span class="stand-affixes">${affixes}</span>` : ''}${modChip}</div>`;
  }).join('');
  const stock = p.itemStock || {};
  const shelf = [];
  for (const itemId of Object.keys(game.ITEMS)) {
    const serials = stock[itemId] || [];
    if (!serials.length) continue;
    const it = game.ITEMS[itemId];
    shelf.push(`<li class="shelfline ${it.rarity.toLowerCase()}"><strong>${esc(it.name)}</strong> <span class="rarity ${it.rarity.toLowerCase()}">${it.rarity}</span> <span class="dim">· yours: ${serials.map(n => 'No. ' + n).join(', ')}</span></li>`);
  }
  const gods = (p.gear || []).filter(g => g.tier === 'GODFORGED');
  for (const g of gods) {
    shelf.push(`<li class="shelfline godforged"><strong>${esc(g.name)} No. ${g.serial}</strong> <span class="tierbadge t-godforged">GODFORGED</span> <span class="dim">· ${g.retired ? 'spent out — its number rests in your record' : `charges: ${g.charges} of ${g.chargesMax}`}</span></li>`);
  }
  const abilities = Object.keys(game.ABILITIES)
    .filter(aid => p.nodes && p.nodes[game.ABILITIES[aid].node])
    .map(aid => `<span class="ability-chip"><i style="background:${game.ABILITIES[aid].color}"></i>✦ ${esc(game.ABILITIES[aid].name)}</span>`)
    .join('');
  const wornNames = game.GEAR_SLOTS.filter(s => worn[s]).map(s => worn[s].name);
  const lineBits = [];
  lineBits.push(wornNames.length ? 'Build: ' + wornNames.join(' · ') : 'Build: bare tools, no gear worn');
  const modSum = game.modSummary(p);
  if (Object.keys(modSum.fitted).length) lineBits.push(Object.keys(modSum.fitted).length + ' mod' + (Object.keys(modSum.fitted).length === 1 ? '' : 's') + ' socketed');
  if (modSum.deployOwned.length) lineBits.push(modSum.deployOwned.length + ' rail mod' + (modSum.deployOwned.length === 1 ? '' : 's') + ' owned');
  if (shelf.length) lineBits.push(shelf.length + ' treasure' + (shelf.length === 1 ? '' : 's') + ' shelved');
  if (abilities) lineBits.push(Object.keys(game.ABILITIES).filter(aid => p.nodes && p.nodes[game.ABILITIES[aid].node]).length + ' abilities lit');
  return `<div class="armory" data-armory>
    <div class="armory-head"><span class="armory-title">⚔ THE ARMORY — YOUR BUILD, LOADED</span><button class="ghostbtn armory-toggle" type="button" data-armory-toggle>Fold the armory</button></div>
    <div class="armory-body">
      <div class="armory-stands">${stands}</div>
      ${shelf.length ? `<h4 class="armory-sub">On the shelf — treasures of the house</h4><ul class="armory-shelf">${shelf.join('')}</ul>` : ''}
      ${abilities ? `<h4 class="armory-sub">Abilities lit</h4><div class="armory-abilities">${abilities}</div>` : ''}
    </div>
    <p class="armory-line" data-armory-line>${esc(lineBits.join(' · '))}</p>
  </div>`;
}

function railText(f) {
  if (f.mode === 'galactic') {
    if (f.how === 'cleared') return 'cleared a sector of the Reach';
    if (f.how === 'death') return 'was destroyed in the Reach';
    if (f.how === 'withdraw') return 'withdrew from the Reach';
    if (f.how === 'void') return 'had a sortie voided';
    return 'was turned back in the Reach';
  }
  if (f.mode === 'descent') {
    if (f.how === 'death') return 'died in the Descent';
    if (f.how === 'ascend') return 'ascended from the deep';
    if (f.how === 'void') return 'had a run voided';
    return 'was turned back in the deep';
  }
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
    <span class="lstat">Lv ${game.levelForXp(p.xp || 0)} · ${p.record.breaches} breaches · ${p.points} pts</span></a></li>`).join('')
    || '<li class="dim">No claimed fighters on the board yet. Be the first name it remembers.</li>';
  const pit = state.pit || { bouts: 0, holds: 0, breaches: 0 };
  const membersAll = Object.values(state.players).filter(x => x.email && x.devil);
  const topHolds = membersAll.filter(x => x.devil.held > 0).sort((a, b) => b.devil.held - a.devil.held).slice(0, 5);
  const topBounty = membersAll.slice().sort((a, b) => game.bountyNow(b, Date.now()) - game.bountyNow(a, Date.now())).slice(0, 5);
  const topHunters = membersAll.filter(x => x.pitAttack && x.pitAttack.breaches > 0).sort((a, b) => b.pitAttack.breaches - a.pitAttack.breaches).slice(0, 5);
  const pitBoards = `
      <h2 class="mt">The Pit — devil boards</h2>
      <p class="dim">${pit.bouts} pit bouts · ${pit.holds} holds · ${pit.breaches} devils breached. <a href="/pit">Walk the hall →</a></p>
      <h3 class="boardh">Most holds</h3>
      <ul class="board">${topHolds.map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${p.devil.held} holds</span></a></li>`).join('') || '<li class="dim">No devil has held yet.</li>'}</ul>
      <h3 class="boardh">Biggest bounties</h3>
      <ul class="board">${topBounty.map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${game.bountyNow(p, Date.now())} pts</span></a></li>`).join('') || '<li class="dim">No devils stand yet.</li>'}</ul>
      <h3 class="boardh">Most breaches — the hunters</h3>
      <ul class="board">${topHunters.map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${p.pitAttack.breaches} devils breached</span></a></li>`).join('') || '<li class="dim">No hunter has drawn blood yet.</li>'}</ul>
      <p class="dim founders-line">🔥 Founders' Embers: <strong>${(state.itemsSeq && state.itemsSeq.foundersember) || 0} of 100</strong> claimed${((state.itemsSeq && state.itemsSeq.foundersember) || 0) >= 100 ? ' — the mint is closed forever' : ' — granted to the first 100 claimed fighters, then never again'}.</p>`;
  const dtally = state.descent || { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 };
  const dplayers = Object.values(state.players).filter(x => x.email && x.descent);
  const drec = x => x.descent || { deepest: 0, bestScore: 0, bestHaul: 0 };
  const topDeep = dplayers.filter(x => drec(x).deepest > 0).sort((a, b) => drec(b).deepest - drec(a).deepest).slice(0, 5);
  const topScore = dplayers.filter(x => drec(x).bestScore > 0).sort((a, b) => drec(b).bestScore - drec(a).bestScore).slice(0, 5);
  const topHaul = dplayers.filter(x => drec(x).bestHaul > 0).sort((a, b) => drec(b).bestHaul - drec(a).bestHaul).slice(0, 5);
  const descentBoards = `
      <h2 class="mt">The Descent — delve boards</h2>
      <p class="dim">${dtally.runs} runs down · ${dtally.depthsCleared} depths cleared · ${dtally.bossesSlain} bosses slain · ${dtally.legendaries} LEGENDARY pieces banked · <strong>${dtally.godforged || 0} GODFORGED pieces exist in the world</strong> — they fall only from bosses at Depth 9 and deeper, at a few percent, and the count above is the whole truth of how many there are. <a href="/descent">Take the stairs down →</a></p>
      <h3 class="boardh">Deepest depth</h3>
      <ul class="board">${topDeep.map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">Depth ${drec(p).deepest}</span></a></li>`).join('') || '<li class="dim">Nobody has gone down yet.</li>'}</ul>
      <h3 class="boardh">Highest score</h3>
      <ul class="board">${topScore.map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${drec(p).bestScore} pts</span></a></li>`).join('') || '<li class="dim">No scored run yet.</li>'}</ul>
      <h3 class="boardh">Richest haul banked</h3>
      <ul class="board">${topHaul.map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${drec(p).bestHaul}</span></a></li>`).join('') || '<li class="dim">No haul banked yet.</li>'}</ul>`;
  const gtally = state.galactic || { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} };
  const gplayers = Object.values(state.players).filter(x => x.email && x.galactic);
  const grec2 = x => game.galacticRecord(x);
  const topReach = gplayers.filter(x => grec2(x).deepest > 0).sort((a, b) => grec2(b).deepest - grec2(a).deepest).slice(0, 5);
  const topSortie = gplayers.filter(x => grec2(x).bestScore > 0).sort((a, b) => grec2(b).bestScore - grec2(a).bestScore).slice(0, 5);
  const fc1 = (gtally.firstClear || {})['1'];
  const galacticBoards = `
      <h2 class="mt">The Galactic — sortie boards</h2>
      <p class="dim">${gtally.sorties} sorties flown · ${gtally.encountersCleared} encounters cleared · ${gtally.capitalsSlain} capitals slain · ${gtally.legendaries || 0} LEGENDARY pieces banked from the sky. ${fc1 ? `★ <strong>Sector 1 was first cleared by ${esc(fc1.name)}</strong> — receipted in the books, named and dated.` : '★ Sector 1 — Emberfall Reach — stands <strong>uncleared</strong>. Its capital, THE HERALD, is waiting.'} <a href="/galactic">Take the sky →</a></p>
      <h3 class="boardh">Deepest into the Reach</h3>
      <ul class="board">${topReach.map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">Encounter ${grec2(p).deepest}</span></a></li>`).join('') || '<li class="dim">No captain has flown yet.</li>'}</ul>
      <h3 class="boardh">Highest sortie score</h3>
      <ul class="board">${topSortie.map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${grec2(p).bestScore} pts</span></a></li>`).join('') || '<li class="dim">No scored sortie yet.</li>'}</ul>`;
  const body = `
  <section class="hero">
    <div class="hero-gate" aria-hidden="true"><div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div><div class="eye"></div></div>
    <h1>Fight the thing<br>that <em>learns you.</em></h1>
    <p class="lede">You are inside the system; the Twin is its guardian. Every trick you throw becomes a shape it knows —
    and it throws back: parry its haymakers, mind your trace, crack the gate before it throws you out or runs you down.</p>
    <a class="fightbtn" href="/arena">⚔&nbsp; FIGHT THE TWIN</a>
    <a class="ghostbtn herobtn" href="/galactic">🚀&nbsp; THE GALACTIC — HER ARMADA HOLDS THE SKY</a>
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
      ${pitBoards}
      ${descentBoards}
      ${galacticBoards}
      <h2 class="mt">How it works</h2>
      <ol class="how">
        <li><strong>Fight.</strong> Four tools, one gate, two and a half minutes — and the gate fights back. It strikes on a rhythm: parry the haymaker when it winds up and the gate hangs open, vulnerable.</li>
        <li><strong>Mind the trace.</strong> Loud tools spike your trace; quiet play lets it cool. At 100% you are caught, mid-swing, whatever the gate looks like.</li>
        <li><strong>Teach.</strong> Your patterns are fingerprinted. Repeat them and they weaken — it has seen them.</li>
        <li><strong>Evolve.</strong> Spend mutation points down the web so your next fight hits different.</li>
        <li><strong>Level up.</strong> Fighting earns XP; levels raise your weight class — Spark, Ember, Flare, Blaze, Inferno. XP is a track, never a currency: it cannot be spent or bought.</li>
        <li><strong>The Pit.</strong> Every member's Twin stands as a devil in <a href="/pit">the Pit</a>. Fight other fighters' devils — they play their owners' way, and yours defends while you sleep. High-class devils carry the Mirage, and the top class wears Morph Armor. Bounties grow on the unbeaten.</li>
        <li><strong>Challenge.</strong> Send your Twin — the one hardened against <em>you</em> — to fight your friends.</li>
      </ol>
    </div>
  </section>`;
  return shell('The Arena Door', body, me);
}

function traitBadges(traits) {
  const out = [];
  if (traits && traits.mirage) out.push('<span class="badge mirage">MIRAGE-marked</span>');
  if (traits && traits.armor) out.push('<span class="badge armor">ARMORED — Morph Armor</span>');
  return out.join(' ');
}

function arenaPage(state, me, challenge, pit) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), me);
  const ch = challenge ? `<div class="challenge-banner">You are fighting <strong>${esc(challenge.ownerName)}</strong>'s Twin — hardened by every lesson its owner taught it. The result will be delivered to their grudge page.</div>` : '';
  let pitBanner = '', itemPanel = '';
  if (pit) {
    pitBanner = `<div class="challenge-banner pit-banner">⚔ <strong>THE PIT</strong> — you face <strong>${esc(pit.ownerName)}</strong>'s devil: a ${esc(pit.traits.className)}-class Twin that fights its owner's way. Bounty on its head: <strong>${pit.bounty} pts</strong>. ${traitBadges(pit.traits)}<br><span class="dim">Asynchronous play: the devil is server-driven by its owner's build and habits — its owner is not at the keys, and may be asleep. That is the design, stated plainly.</span></div>`;
    const bits = [];
    if (pit.traits.mirage) {
      if ((pit.myItems.mirrorwrap || 0) > 0) {
        const serials = (pit.myStock.mirrorwrap || []).map(n => 'No. ' + n).join(', ');
        bits.push(`<label class="check itemopt legendary"><input type="checkbox" id="item-mirror"> 🪞 Use <strong>THE MIRROR WRAP</strong> <span class="rarity legendary">LEGENDARY</span> — yours: ${esc(serials)} · ${esc(game.KEEPER_SIGNATURE)}. One wrap, one fight: its false wind-ups crack and show.</label>`);
      } else {
        bits.push(`<p class="dim">🪞 You hold no <strong>Mirror Wrap</strong> <span class="rarity legendary">LEGENDARY</span> — the Mirage will lie to you freely. Wraps are earned by breaching Mirage devils, rarely.</p>`);
      }
    }
    if (pit.traits.armor) {
      if ((pit.myItems.anchorstitch || 0) > 0) {
        const serials = (pit.myStock.anchorstitch || []).map(n => 'No. ' + n).join(', ');
        bits.push(`<label class="itemopt rare">🧵 <strong>ANCHOR STITCH</strong> <span class="rarity rare">RARE</span> — yours: ${esc(serials)} · ${esc(game.KEEPER_SIGNATURE)}. Stitch one tool so the morph cannot shed it:
          <select id="item-stitch"><option value="">— no stitch —</option>${TOOL_IDS.map(t => `<option value="${t}">${TOOLS[t].name}</option>`).join('')}</select></label>`);
      } else {
        bits.push(`<p class="dim">🧵 You hold no <strong>Anchor Stitch</strong> <span class="rarity rare">RARE</span> — when this devil's armor morphs at half integrity, it sheds what it knows of you. Stitches are earned by breaching Armored devils.</p>`);
      }
    }
    if (bits.length) itemPanel = `<div class="itempanel"><h3>Satchel — declared before the fight, spent on entry</h3>${bits.join('')}</div>`;
  }
  // Gear that rides ANY fight (Second Heart / Stillbell), from your satchel.
  let gearPanel = '';
  if (me) {
    const stock = me.itemStock || {};
    const gbits = [];
    if ((stock.secondheart || []).length) {
      gbits.push(`<label class="check itemopt epic"><input type="checkbox" id="item-heart"> 💔 Carry <strong>THE SECOND HEART</strong> <span class="rarity epic">EPIC</span> — yours: ${stock.secondheart.map(n => 'No. ' + n).join(', ')} · ${esc(game.KEEPER_SIGNATURE)}. If a blow would zero you, it breaks instead and you stand at 40. Unbroken, it returns.</label>`);
    }
    if ((stock.stillbell || []).length) {
      gbits.push(`<label class="check itemopt epic"><input type="checkbox" id="item-bell"> 🔔 Carry <strong>THE STILLBELL</strong> <span class="rarity epic">EPIC</span> — yours: ${stock.stillbell.map(n => 'No. ' + n).join(', ')} · ${esc(game.KEEPER_SIGNATURE)}. A button joins your deck: ring it and the trace cannot rise for 12 seconds. Unrung, it returns.</label>`);
    }
    if (gbits.length) gearPanel = `<div class="itempanel gearpanel"><h3>Gear — declared before the fight</h3>${gbits.join('')}</div>`;
  }
  const body = `
  <section class="arena-wrap">
    ${ch}
    ${pitBanner}
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
      <div id="winframe" class="winframe hidden"><span id="winframe-label">OPEN WINDOW ×2</span><i id="winframe-bar"></i></div>
      <div id="stage-msg" class="stage-msg">
        <h2>${pit ? `${esc(pit.ownerName)}'s devil is waiting.` : (challenge ? 'Your challenger\u2019s Twin is waiting.' : 'The Twin is waiting.')}</h2>
        <p>Your command deck is below: four tool pods, your evolution abilities, one big parry plate. It learns every shape you show it — and it throws back. Parry the wind-up. Mind your trace.</p>
        ${itemPanel}
        ${gearPanel}
        ${armoryHtml(me)}
        <button id="startbtn" class="fightbtn">BEGIN THE BREACH</button>
      </div>
      <div id="verdict" class="verdict hidden"></div>
    </div>
    <div id="twinread" class="twinread">The Twin is reading you…</div>
    <button id="parrybtn" class="parrybtn" type="button" disabled><span class="parry-charge" id="parry-charge"></span>⚡ PARRY<span>tap when it winds up — or tap the optic, or hit SPACE</span></button>
    <div class="kit" id="kit"></div>
    <div class="kit abilities" id="abilities"></div>
    <div class="kit modrail" id="modrail"></div>
    <div class="combos-legend">
      <span><strong>MARK &amp; DROWN</strong> — Probe, then Flood within 3s: +50%</span>
      <span><strong>COLD TRAIL</strong> — Whisper on a fresh Decoy: dumps trace</span>
      <span><strong>OPEN WINDOW</strong> — strike inside the gold frame after a parry: ×2</span>
    </div>
    <div class="arena-foot">
      <span id="fam-note">Familiarity is how well the Twin knows a tool — the higher it climbs, the weaker the tool lands. Trace is how loud you are — at 100%, you are caught.</span>
      <button id="mutebtn" class="ghostbtn" type="button">Sound: on</button>
    </div>
  </section>
  <script>window.TA_CHALLENGE = ${challenge ? JSON.stringify(challenge.token) : 'null'}; window.TA_PIT = ${pit ? JSON.stringify(pit.ownerId) : 'null'};</script>
  <script src="/js/game.js"></script>`;
  return shell('The Arena', body, me);
}

// ---- THE PIT -----------------------------------------------------------------
// One devil's card: the same card stands in the hall, on the fighter's page,
// and (as "your devil") on the owner's own profile.
function devilCardHtml(state, owner, me, opts) {
  opts = opts || {};
  const traits = game.devilTraits(owner);
  const devil = owner.devil || { held: 0, breached: 0, bounty: game.PIT.bountyBase, lastBreachedBy: null };
  const bounty = game.bountyNow(owner, Date.now());
  const shapesKnown = Object.keys(owner.devilShapes || {}).length;
  const nodesOwned = Object.keys(owner.nodes || {}).length;
  const armorTools = TOOL_IDS.map(t => ({ t, v: (owner.twinArmor || {})[t] || 0 })).sort((a, b) => b.v - a.v);
  const armorLine = armorTools[0] && armorTools[0].v > 0
    ? `Hardened most against ${TOOLS[armorTools[0].t].name} (${Math.round(armorTools[0].v * 100)}%)`
    : 'No grudge armor yet — an unscarred devil';
  const mine = me && me.id === owner.id;
  let gate = '';
  if (opts.hall) {
    if (mine) gate = '<span class="dim">Your own devil. It will not fight you.</span>';
    else if (!me || !me.email) gate = '<span class="dim">Members only — <a href="/signup">claim a profile</a> to fight devils.</span>';
    else {
      const myClass = game.classOf(me);
      const delta = traits.classIdx - myClass.idx;
      if (delta < 0) gate = `<span class="dim">Below your ${myClass.name} class — the Pit does not feed the small to the large.</span>`;
      else if (delta > 1) gate = `<span class="dim">${traits.className} — too far above your ${myClass.name}. Climb first.</span>`;
      else gate = `<a class="fightbtn small" href="/arena?pit=${owner.id}">⚔ FIGHT THIS DEVIL</a>`;
    }
  }
  return `<article class="pitcard ${traits.armor ? 'is-armor' : ''} ${traits.mirage ? 'is-mirage' : ''}">
    <div class="pit-head">
      ${owner.photo ? `<img class="p-face small" src="${esc(owner.photo)}" alt="">` : '<div class="p-face ghost small">◐</div>'}
      <div class="pit-title">
        <h3><a href="/fighter/${owner.id}">${esc(owner.displayName || 'Fighter')}</a>'s devil</h3>
        <p class="dim">Lv ${traits.level} · <span class="classchip c${traits.classIdx}">${esc(traits.className)} class</span> ${traitBadges(traits)}</p>
      </div>
      <div class="pit-bounty"><strong>${bounty}</strong><span>bounty pts</span></div>
    </div>
    ${owner.taunt ? `<p class="taunt">“${esc(owner.taunt)}”</p>` : ''}
    ${game.founderSerial(owner) ? `<p class="embermark">🔥 Founder's Ember No. ${game.founderSerial(owner)} — one of the first hundred. Its holder earns +10% XP; the mark is the honor.</p>` : ''}
    ${(() => { const worn = game.wornGearMap(owner); const list = game.GEAR_SLOTS.filter(s => worn[s]).map(s => worn[s]); return list.length ? `<p class="pit-gear">Wearing: ${list.map(gp => `<span class="tierbadge t-${gp.tier.toLowerCase()}">${esc(gp.name)} · ${gp.slot === 'body' ? 'Body' : TOOLS[gp.slot].name} (${gp.tier})</span>`).join(' ')}</p>` : ''; })()}
    ${(() => { const fm = game.modSummary(owner).fitted; const ids = Object.keys(fm); return ids.length ? `<p class="pit-gear">Socketed: ${ids.map(t => `<span class="tierbadge" style="border-color:${game.FITTED_MODS[fm[t]].color};color:${game.FITTED_MODS[fm[t]].color}">${game.FITTED_MODS[fm[t]].sigil} ${esc(game.FITTED_MODS[fm[t]].name)} \u00b7 ${TOOLS[t].name}</span>`).join(' ')}</p>` : ''; })()}
    <p class="pit-stats">Held <strong>${devil.held}</strong> · breached <strong>${devil.breached}</strong>${devil.lastBreachedBy ? ` · last breached by ${esc(devil.lastBreachedBy)}` : ''}<br>
    <span class="dim">Knows ${shapesKnown} challenger shapes · owner's web: ${nodesOwned} evolutions · ${esc(armorLine)}</span></p>
    <div class="pit-gate">${gate}</div>
  </article>`;
}

function pitPage(state, me, sort) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), me);
  const members = Object.values(state.players).filter(p => p.email && p.devil);
  const now = Date.now();
  const sorted = members.slice();
  if (sort === 'record') sorted.sort((a, b) => (b.devil.held - a.devil.held) || (game.bountyNow(b, now) - game.bountyNow(a, now)));
  else if (sort === 'grudge' && me) {
    const grudges = new Set(me.devil && me.devil.breachedBy ? me.devil.breachedBy : []);
    sorted.sort((a, b) => ((grudges.has(b.id) ? 1 : 0) - (grudges.has(a.id) ? 1 : 0)) || (game.bountyNow(b, now) - game.bountyNow(a, now)));
  } else sorted.sort((a, b) => game.bountyNow(b, now) - game.bountyNow(a, now));
  const myClass = me && me.email ? game.classOf(me) : null;
  const cards = sorted.map(p => devilCardHtml(state, p, me, { hall: true })).join('')
    || '<p class="dim">No devils stand yet. The first claimed profile raises the first devil.</p>';
  const pit = state.pit || { bouts: 0, holds: 0, breaches: 0 };
  const body = `
  <section class="pitwrap">
    <h1>The Pit</h1>
    <p class="lede small">Every member's Twin stands here as a devil — fighting its owner's way, learning from everyone who comes for it.
    Yours defends while you sleep; results land on your grudge feed. <strong>Asynchronous by design:</strong> you fight their devil live; no devil is its owner at the keys.
    ${myClass ? `You stand in the <strong>${esc(myClass.name)}</strong> class (Lv ${myClass.level}) — you may fight your class or one above it.` : 'Guests may walk the hall; fighting is members-only.'}</p>
    <p class="dim">${pit.bouts} pit bouts fought · ${pit.holds} holds · ${pit.breaches} breaches. Bounties are minted by the house and grow +${game.PIT.bountyPerDay}/day and +${game.PIT.bountyPerHold} per hold on the unbeaten, up to ${game.PIT.bountyMax}.</p>
    <p class="dim founders-line">🔥 Founders' Embers: <strong>${(state.itemsSeq && state.itemsSeq.foundersember) || 0} of 100</strong> claimed — granted to the first 100 claimed fighters, then never minted again.</p>
    <p class="sortlinks">Sort: <a href="/pit?sort=bounty">biggest bounty</a> · <a href="/pit?sort=record">best record</a> · <a href="/pit?sort=grudge">my grudges first</a></p>
    <div class="pitgrid">${cards}</div>
    <div class="panel mt">
      <h2>The flavors of trouble</h2>
      <p><span class="badge mirage">MIRAGE-marked</span> — from the Flare class up, a devil lies: some wind-ups are phantoms, and a parry thrown at one bites air. <strong>${esc(game.ITEMS.mirrorwrap.name)}</strong> <span class="rarity legendary">LEGENDARY</span> — ${esc(game.ITEMS.mirrorwrap.line)}</p>
      <p><span class="badge armor">ARMORED</span> — Inferno-class devils wear Morph Armor: at half integrity it morphs once, shedding most of what it knew of your tools and changing its rhythm mid-fight. <strong>${esc(game.ITEMS.anchorstitch.name)}</strong> <span class="rarity rare">RARE</span> — ${esc(game.ITEMS.anchorstitch.line)}</p>
      <p><strong>${esc(game.ITEMS.secondheart.name)}</strong> <span class="rarity epic">EPIC</span> — ${esc(game.ITEMS.secondheart.line)} Earned only off Armored devils, or by a devil that holds five times running for its sleeping owner.</p>
      <p><strong>${esc(game.ITEMS.stillbell.name)}</strong> <span class="rarity epic">EPIC</span> — ${esc(game.ITEMS.stillbell.line)} Earned only off high-class Mirage devils.</p>
      <p><strong>${esc(game.ITEMS.foundersember.name)}</strong> <span class="rarity founder">FOUNDER</span> — ${esc(game.ITEMS.foundersember.line)}</p>
      <p class="dim">Items are earned only — breaching trait devils drops them (the Wrap rarely; it is a legendary thing), and a devil's hold occasionally earns its owner the matching piece. They are numbered editions, ${esc(game.KEEPER_SIGNATURE)}. Never sold, never bought.</p>
    </div>
  </section>`;
  return shell('The Pit', body, me);
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

function itemLine(itemId, serial, extra) {
  const it = game.ITEMS[itemId];
  const rar = `<span class="rarity ${it.rarity.toLowerCase()}">${it.rarity}</span>`;
  return `<li class="itemline ${it.rarity.toLowerCase()}"><strong>${esc(it.name)} No. ${serial}</strong> ${rar} · ${esc(game.KEEPER_SIGNATURE)}${extra || ''}</li>`;
}

function profilePage(state, p, opts) {
  opts = opts || {};
  const rec = p.record;
  const winRate = rec.bouts ? Math.round(rec.breaches / rec.bouts * 100) : 0;
  const cls = game.classOf(p);
  const xpNow = p.xp || 0;
  const xpNext = game.xpForLevel(cls.level + 1);
  const xpFloor = game.xpForLevel(cls.level);
  const xpPct = xpNext > xpFloor ? Math.min(100, Math.round((xpNow - xpFloor) / (xpNext - xpFloor) * 100)) : 100;
  const curr = Object.entries(p.shapes || {}).sort((a, b) => b[1] - a[1]).slice(0, 24);
  const currRows = curr.map(([k, v]) => {
    const g = state.shapesGlobal[k] || 0;
    const decay = Math.min(75, Math.round((g * 0.4 + v * 3)));
    return `<tr><td><code>${esc(k)}</code></td><td>${Math.round(v * 10) / 10}</td><td><div class="mini-bar"><i style="width:${decay}%"></i></div> ${decay}% known</td></tr>`;
  }).join('') || '<tr><td colspan="3" class="dim">No shapes taught yet. Your first fight writes the first line.</td></tr>';
  const armorRows = TOOL_IDS.map(t => `
    <div class="armor-row"><span>${TOOLS[t].name}</span><div class="mini-bar armor"><i style="width:${pct(p.twinArmor[t])}"></i></div><span>${pct(p.twinArmor[t])} hardened</span></div>`).join('');
  const feed = (p.challengeFeed || []).map(f => {
    if (f.mode === 'pit') {
      return f.result === 'win'
        ? `<li>⚔ <strong>${esc(f.challenger)}</strong> breached your devil in the Pit and took its <strong>${f.bounty || 0} pt</strong> bounty${f.shape ? ` — the shape that did it: <code>${esc(f.shape)}</code>, and your devil has learned it` : ''} · ${fmtTime(f.secs)} · <a href="/verdict/${esc(f.verdictId)}">verdict</a></li>`
        : `<li>⚔ <strong>${esc(f.challenger)}</strong> came for your devil in the Pit and <strong>was held</strong> · ${fmtTime(f.secs)} · <a href="/verdict/${esc(f.verdictId)}">verdict</a></li>`;
    }
    return `<li><strong>${esc(f.challenger)}</strong> challenged your Twin and ${f.result === 'win' ? '<span class="bad">breached it</span>' : 'was turned back'} · ${fmtTime(f.secs)} · <a href="/verdict/${esc(f.verdictId)}">verdict</a></li>`;
  }).join('')
    || '<li class="dim">Nobody has challenged your Twin yet. Send the link and wait.</li>';
  const ownedCount = Object.keys(p.nodes || {}).length;
  const stock = p.itemStock || { mirrorwrap: [], anchorstitch: [] };
  const heldItems = Object.keys(game.ITEMS).flatMap(itemId => (stock[itemId] || []).map(serial => itemLine(itemId, serial)));
  const spentItems = (p.itemHistory || []).filter(h => h.spent).slice(0, 12).map(h =>
    itemLine(h.item, h.serial, ` — <span class="dim">spent${h.spentVs ? ' against ' + esc(h.spentVs) + "'s devil" : ''} · the number stays yours in the record</span>`));
  const inventory = `
        <h2 class="mt">Your satchel — numbered editions</h2>
        ${heldItems.length ? `<ul class="items">${heldItems.join('')}</ul>` : '<p class="dim">Empty. Pit wins drop the pieces — the Mirror Wrap rarely; it is a legendary thing.</p>'}
        ${spentItems.length ? `<h3 class="boardh">Collection record — spent</h3><ul class="items spent">${spentItems.join('')}</ul>` : ''}`;
  // THE DESCENT's gear shelf: worn pieces on their slots, the unworn shelf,
  // and the GODFORGED treasures with their charges and their retired numbers.
  const gearAll = p.gear || [];
  const wornMap = game.wornGearMap(p);
  const gearRows = game.GEAR_SLOTS.map(slot => {
    const w = wornMap[slot];
    const label = slot === 'body' ? 'Body relic' : TOOLS[slot].name;
    return `<div class="gear-row"><span class="gear-slot">${label}</span> ${w
      ? `<span class="tierbadge t-${w.tier.toLowerCase()}">${esc(w.name)} (${w.tier})</span> <form method="post" action="/api/gear/unwear" class="inlineform"><input type="hidden" name="slot" value="${slot}"><button class="ghostbtn" type="submit">Unwear</button></form>`
      : '<span class="dim">bare</span>'}</div>`;
  }).join('');
  const unworn = gearAll.filter(g => !g.worn && g.tier !== 'GODFORGED');
  const unwornRows = unworn.map(g => `<li class="gearline t-${g.tier.toLowerCase()}"><strong>${esc(g.name)}</strong> <span class="tierbadge t-${g.tier.toLowerCase()}">${g.tier}</span>${g.serial ? ` No. ${g.serial}` : ''} · ${g.slot === 'body' ? 'body relic' : TOOLS[g.slot].name}<br><span class="dim">${game.gearLine(g).map(esc).join(' · ')}</span> <form method="post" action="/api/gear/wear" class="inlineform"><input type="hidden" name="gearId" value="${g.id}"><button class="ghostbtn" type="submit">Wear it</button></form></li>`).join('');
  const godRows = gearAll.filter(g => g.tier === 'GODFORGED').map(g => `<li class="gearline t-godforged"><strong>${esc(g.name)} No. ${g.serial}</strong> <span class="tierbadge t-godforged">GODFORGED</span> · ${esc(game.KEEPER_SIGNATURE)}<br><span class="dim">${esc(game.GODFORGED[g.god] ? game.GODFORGED[g.god].line : '')}</span><br>${g.retired
    ? '<span class="bad">SPENT OUT — its charges are gone; the number is retired and stays in your record.</span>'
    : `<span>Charges: <strong>${g.charges}</strong> of ${g.chargesMax} — declare it at the Descent's door.</span>`}${g.firedLog && g.firedLog.length ? `<br><span class="dim">Fired: ${g.firedLog.map(fl => esc(fl.how)).join(' · ')}</span>` : ''}</li>`).join('');
  const gearShelf = `
        <h2 class="mt" id="satchel">The gear shelf — loot of the Descent</h2>
        ${gearRows}
        ${unworn.length ? `<h3 class="boardh">In the satchel, unworn</h3><ul class="items">${unwornRows}</ul>` : '<p class="dim">No unworn gear on the shelf. What the depths drop, you keep — <a href="/descent">delve</a> to fill it.</p>'}
        ${godRows ? `<h3 class="boardh">GODFORGED treasures</h3><ul class="items">${godRows}</ul>` : ''}
        <p class="dim">Gear swaps happen here, between runs — never mid-delve. Your worn gear is your build: it rides your house fights and your Pit devil too, and your devil's card shows it. The Mirror Wrap and the Anchor Stitch are Pit treasures — they do not ride the Descent. Second Hearts and Stillbells are declared at the Descent's door.</p>`;
  // MODS v1: the socket board and the rail shelf. Socketing lives here,
  // between fights, under the same law as the gear shelf.
  const modSum = game.modSummary(p);
  const fittedRows = game.TOOL_IDS.map(t => {
    const fid = modSum.fitted[t];
    if (!fid) return `<div class="gear-row"><span class="gear-slot">${TOOLS[t].name} socket</span> <span class="dim">empty — the depths provide</span></div>`;
    const d = game.FITTED_MODS[fid];
    return `<div class="gear-row"><span class="gear-slot">${TOOLS[t].name} socket</span> <span class="modchip" style="--mc:${d.color}">${d.sigil} ${esc(d.name)}</span> <form method="post" action="/api/mods/fit" class="inlineform"><input type="hidden" name="tool" value="${t}"><input type="hidden" name="mod" value=""><button class="ghostbtn" type="submit">Unsocket</button></form></div>`;
  }).join('');
  const unfitRows = Object.keys(game.FITTED_MODS).filter(mid => p.modsOwned && p.modsOwned[mid] && modSum.fitted[game.FITTED_MODS[mid].tool] !== mid)
    .map(mid => { const d = game.FITTED_MODS[mid]; return `<li class="gearline"><span class="modchip" style="--mc:${d.color}">${d.sigil} <strong>${esc(d.name)}</strong></span> <span class="dim">${esc(d.line)}</span> <form method="post" action="/api/mods/fit" class="inlineform"><input type="hidden" name="tool" value="${d.tool}"><input type="hidden" name="mod" value="${mid}"><button class="ghostbtn" type="submit">Socket onto the ${TOOLS[d.tool].name}</button></form></li>`; }).join('');
  const deployRows = Object.keys(game.DEPLOY_MODS).filter(mid => p.modsOwned && p.modsOwned[mid])
    .map(mid => { const d = game.DEPLOY_MODS[mid]; return `<li class="gearline"><span class="modchip" style="--mc:${d.color}">${d.sigil} <strong>${esc(d.name)}</strong></span> <span class="dim">${esc(d.line)}</span> <span class="dim">· ${d.charges} charges a fight, refilled between fights</span></li>`; }).join('');
  const modsSection = `
        <h2 class="mt" id="mods">Mods — sockets and the rail</h2>
        <p class="dim">Mods are unnumbered and permanent: the depths and the Pit hand them out, and what you own, you keep. Fitted mods socket onto one tool each and change its math in every fight — your devil fights with them too. Rail mods are fired by hand, mid-fight, from the MOD RAIL under your tools; a devil never fires one. Socketing happens here, between runs — never mid-delve.</p>
        ${fittedRows}
        ${unfitRows ? `<h3 class="boardh">Owned, unsocketed</h3><ul class="items">${unfitRows}</ul>` : ''}
        ${deployRows ? `<h3 class="boardh">On your rail</h3><ul class="items">${deployRows}</ul>` : '<p class="dim">No rail mods yet. The deep bosses and the Vaults carry them; a Pit breach sometimes leaves one behind.</p>'}`;
  const body = `
  <section class="profile">
    <div class="p-head">
      ${p.photo ? `<img class="p-face" src="${esc(p.photo)}" alt="Your photo">` : '<div class="p-face ghost">◐</div>'}
      <div>
        <h1>${esc(p.displayName || 'Fighter')}</h1>
        <p class="dim">${rec.bouts} bouts · ${rec.breaches} breaches · ${winRate}% breach rate · streak ${rec.streak > 0 ? '+' + rec.streak : rec.streak}${rec.bestSecs ? ` · best breach ${fmtTime(rec.bestSecs)}` : ''}</p>
        <p><strong>${p.points}</strong> mutation points · <strong>${ownedCount}</strong> evolutions · <a href="/web">open the web</a></p>
        <p class="level-line"><strong>Level ${cls.level}</strong> · <span class="classchip c${cls.idx}">${esc(cls.name)} class</span> · ${xpNow} XP
          <span class="xpbar"><i style="width:${xpPct}%"></i></span> <span class="dim">${xpNext - xpNow} XP to level ${cls.level + 1} · XP is a track, never a currency</span></p>
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
        ${inventory}
        ${gearShelf}
        ${modsSection}
      </div>
      <div class="panel">
        <h2>Your devil — standing in <a href="/pit">the Pit</a></h2>
        ${devilCardHtml(state, p, p, {})}
        <form method="post" action="/api/profile/taunt" class="authform slim">
          <label>Your devil's taunt — one line, yours, shown on its card
            <input name="taunt" value="${esc(p.taunt || '')}" maxlength="90" placeholder="It learned from the best. You are not the best."></label>
          ${opts.tauntError ? '<p class="err">That line was refused — keep it clean and it stands as written.</p>' : ''}
          <button type="submit">Set the taunt</button>
        </form>
        <p class="dim">Your Pit record as a hunter: ${(p.pitAttack || {}).bouts || 0} bouts · ${(p.pitAttack || {}).breaches || 0} devils breached.</p>
        <h2 class="mt">Your curriculum — what you taught it</h2>
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

function fighterPage(state, p, me) {
  const rec = p.record;
  const taught = Object.keys(p.shapes || {}).length;
  const cls = game.classOf(p);
  const body = `
  <section class="profile">
    <div class="p-head">
      ${p.photo ? `<img class="p-face" src="${esc(p.photo)}" alt="">` : '<div class="p-face ghost">◐</div>'}
      <div><h1>${esc(p.displayName || 'Fighter')}</h1>
      <p class="dim">Level ${cls.level} · ${esc(cls.name)} class · ${rec.bouts} bouts · ${rec.breaches} breaches${rec.bestSecs ? ` · best breach ${fmtTime(rec.bestSecs)}` : ''} · has taught the Twin ${taught} shapes</p>
      <p><a class="fightbtn small" href="/challenge/${esc(p.challengeToken)}">⚔ Fight ${esc(p.displayName || 'their')} Twin</a></p></div>
    </div>
    <h2 class="mt">Their devil — standing in <a href="/pit">the Pit</a></h2>
    ${devilCardHtml(state, p, me || null, { hall: true })}
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
function verdictTitle(v) {
  if (v.mode === 'galactic') {
    if (v.endReason === 'cleared') return 'SECTOR CLEARED — THE HERALD FALLS';
    if (v.endReason === 'death') return 'DESTROYED IN THE REACH';
    if (v.endReason === 'void') return 'SORTIE VOIDED';
    if (v.endReason === 'withdraw') return 'WITHDREW — THE HAUL IS YOURS';
    return 'TURNED BACK FROM THE REACH';
  }
  if (v.mode === 'descent') {
    if (v.endReason === 'death') return 'THE DARK KEPT YOU';
    if (v.endReason === 'ascend') return 'YOU ASCENDED — THE HAUL IS YOURS';
    if (v.endReason === 'void') return 'RUN VOIDED';
    return 'TURNED BACK FROM THE DEEP';
  }
  return VERDICT_TITLES[v.endReason] || (v.result === 'win' ? 'THE GATE BREACHED' : 'TURNED BACK');
}

function verdictPage(state, v, me) {
  const win = v.result === 'win';
  const shapes = (v.shapesTaught || []).map(s => `<code>${esc(s)}</code>`).join(' ') || '<span class="dim">no new shapes — it already knew your tricks</span>';
  const armor = Object.entries(v.armorGains || {}).map(([t, g]) => `${TOOLS[t] ? TOOLS[t].name : t} +${Math.round(g * 100)}%`).join(' · ');
  const mine = me && me.id === v.fighterId;
  const fs = v.fightStats;
  const xpLine = v.xp ? `<p class="v-xp">+${v.xp} XP${v.emberBonus ? ' (Founder\u2019s Ember +10%)' : ''}${v.level ? ` · Level ${v.level}` : ''}${v.levelUp ? ' — <strong>LEVEL UP</strong>' : ''}</p>` : '';
  const comboLine = fs && fs.combos && fs.combos.length
    ? `<p class="v-combos">Combos landed: ${fs.combos.map(c => ({ 'mark-drown': 'MARK & DROWN', 'cold-trail': 'COLD TRAIL', 'open-window': 'OPEN WINDOW' }[c] || c)).join(' · ')}</p>` : '';
  const pitLine = v.mode === 'pit' ? `<p class="v-pit">⚔ A Pit fight against <strong>${esc(v.devilName || 'a fighter')}</strong>'s devil.${v.result === 'win' ? ` Bounty taken: <strong>${v.bountyWon || 0} pts</strong>.` : ''}${v.feints ? ` It showed ${esc(v.feints)} Mirage phantom${v.feints === 1 ? '' : 's'}.` : ''}${v.morphed ? ' Its armor <strong>morphed</strong> mid-fight — old lessons shed, rhythm changed.' : ''}</p>` : '';
  const descentLine = v.mode === 'descent' && v.descent ? `<div class="v-descent">
      <p>🕯 A Descent run: <strong>${v.descent.depthsCleared}</strong> depths cleared · deepest reached <strong>Depth ${v.descent.deepest}</strong> · score <strong>${v.descent.score}</strong> · bosses slain <strong>${v.descent.bossesSlain}</strong>.</p>
      ${v.descent.banked && v.descent.banked.length ? `<p>Banked into the satchel (haul value ${v.descent.haulValue}): ${v.descent.banked.map(bp => `<span class="tierbadge t-${bp.tier.toLowerCase()}">${esc(bp.name)} (${bp.tier}${bp.serial ? ' No. ' + bp.serial : ''})</span>`).join(' ')}</p>` : `<p>Nothing banked — the haul was empty when the run ended.</p>`}
      ${v.descent.lost && v.descent.lost.length ? `<p class="bad">Left in the dark: ${v.descent.lost.map(bp => `${esc(bp.name)} (${bp.tier})`).join(' · ')} — death takes the unbanked STURDY and RARE. EPIC and above always come home.</p>` : ''}
    </div>` : '';
  const galacticLine = v.mode === 'galactic' && v.galactic ? `<div class="v-descent">
      <p>🚀 A Galactic sortie in <strong>Sector ${v.galactic.sector} — Emberfall Reach</strong>: <strong>${v.galactic.encountersCleared}</strong> encounters cleared · deepest <strong>Encounter ${v.galactic.deepest}</strong> · score <strong>${v.galactic.score}</strong> · capitals slain <strong>${v.galactic.capitalsSlain}</strong>.</p>
      ${v.galactic.sectorCleared ? `<p>★ <strong>SECTOR CLEARED</strong>${v.galactic.firstClear ? ' — this captain\u2019s first clearing of the Reach, receipted in the books, named and dated and permanent.' : ' — the Reach stays cleared on this captain\u2019s chart, and its armada flies a notch quieter for them now.'}</p>` : ''}
      ${v.galactic.banked && v.galactic.banked.length ? `<p>Banked into the cargo hold (haul value ${v.galactic.haulValue}): ${v.galactic.banked.map(bp => `<span class="tierbadge t-${bp.tier.toLowerCase()}">${esc(bp.name)} (${bp.tier}${bp.serial ? ' No. ' + bp.serial : ''})</span>`).join(' ')}</p>` : `<p>Nothing banked — the hold was empty when the sortie ended.</p>`}
      ${v.galactic.lost && v.galactic.lost.length ? `<p class="bad">Lost among the stars: ${v.galactic.lost.map(bp => `${esc(bp.name)} (${bp.tier})`).join(' · ')} — destruction takes the unbanked STURDY and RARE. EPIC and above always come home.</p>` : ''}
    </div>` : '';
  const dropLines = (v.drops || []).map(d => {
    const it = game.ITEMS[d.item];
    if (!it) return '';
    const mark = { LEGENDARY: '★', EPIC: '✦', RARE: '◆', FOUNDER: '🔥' }[it.rarity] || '◆';
    return `<p class="dropbanner ${it.rarity.toLowerCase()}">${mark} ${it.rarity} DROP — <strong>${esc(it.name)} No. ${d.serial}</strong> · ${esc(game.KEEPER_SIGNATURE)}</p>`;
  }).join('');
  const gearLines = `${v.heartBroke ? '<p class="v-gear">💔 <strong>Your Second Heart broke</strong> — and you stood back up at 40. It is spent; its number stays in your collection record.</p>' : ''}${v.bellRung ? '<p class="v-gear">🔔 <strong>You rang the Stillbell</strong> — the trace froze where it stood. It is spent; its number stays in your record.</p>' : ''}`;
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
      <p class="v-name">${esc(v.fighterName)} ${v.mode === 'challenge' ? 'fought a challenged Twin' : v.mode === 'galactic' ? 'flew against the Twin\u2019s armada' : v.mode === 'descent' ? 'went down into the dark' : 'faced the Twin'} · ${fmtTime(v.secs)}</p>
      ${v.voided ? `<p class="err">That bout\u2019s log did not hold up (${esc(v.voided)}) — it is remembered, but it taught nothing and earned nothing.</p>` : ''}
      <div class="v-stats">
        <div><strong>+${v.points}</strong><span>mutation points</span></div>
        <div><strong>${v.shapesTaughtCount}</strong><span>new shapes taught</span></div>
        <div><strong>${v.newToWorldCount}</strong><span>new to the whole world</span></div>
      </div>
      ${fsRow}
      ${xpLine}
      ${comboLine}
      ${pitLine}
      ${descentLine}
      ${galacticLine}
      ${gearLines}
      ${dropLines}
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

// ---- THE DESCENT -------------------------------------------------------------
// A gothic-cathedral delve beneath the arena: deep blacks, ember red, gold.
// Same referee, same deck — but the dark down here keeps what it catches.
function descentPage(state, me) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), me);
  const dtally = state.descent || { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 };
  const dplayers = Object.values(state.players).filter(x => x.email && x.descent);
  const drec = x => x.descent || { deepest: 0, bestScore: 0, bestHaul: 0 };
  const boardList = (key, fmt) => dplayers.filter(x => drec(x)[key] > 0)
    .sort((a, b) => drec(b)[key] - drec(a)[key]).slice(0, 5)
    .map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${fmt(drec(p)[key])}</span></a></li>`).join('')
    || '<li class="dim">No mark set yet.</li>';
  const boards = `
    <div class="panel descent-boards">
      <h2>The delve boards</h2>
      <p class="dim">${dtally.runs} runs · ${dtally.depthsCleared} depths cleared · ${dtally.bossesSlain} bosses slain · ${dtally.deaths} deaths in the dark · ${dtally.legendaries} LEGENDARY pieces banked · <strong>${dtally.godforged || 0} GODFORGED in the world</strong>.</p>
      <h3 class="boardh">Deepest depth</h3><ul class="board">${boardList('deepest', v => 'Depth ' + v)}</ul>
      <h3 class="boardh">Highest score</h3><ul class="board">${boardList('bestScore', v => v + ' pts')}</ul>
      <h3 class="boardh">Richest haul banked</h3><ul class="board">${boardList('bestHaul', v => '' + v)}</ul>
    </div>`;
  const hero = `
    <div class="descent-hero">
      <div class="descent-arch" aria-hidden="true">⛪</div>
      <h1>THE DESCENT</h1>
      <p class="lede">Beneath the arena there are stairs, and at the bottom of the stairs there is loot, and between you and the loot there is the Twin — on her home ground, learning your build as you go.</p>
      <p class="dim">Crack each depth's gate and choose: <strong>descend</strong> for better drops and a meaner dark, or <strong>ascend</strong> and bank what you carry. Your integrity and your Trace carry across the whole run. Bosses guard every third depth and pay the best loot in the house; every fifth depth is a Vault — no gate, no strikes, only fleeing shapes and drop rolls. Death takes your unbanked STURDY and RARE pieces; EPIC, LEGENDARY and GODFORGED always come home. Solo and asynchronous, server-refereed like every bout here — no live PvP, and the loot counts on this page are the real books.</p>
      <p class="dim">And she is learning <em>you</em>, specifically: lean on a tool — above all a LEGENDARY one — and the deeper you go, the more she scrambles it on sight. Stated plainly, like everything in this house.</p>
    </div>`;
  if (!me || !me.email) {
    const body = `<section class="descent-wrap">${hero}
      <div class="panel"><h2>The door is members-only</h2>
      <p>The Descent keeps what you find — and keeping requires a satchel, and a satchel requires a name. <a href="/signup">Claim your profile</a> and the stairs are yours. Guests may read the boards:</p></div>
      ${boards}</section>`;
    return shell('The Descent', body, me);
  }
  const rec = me.descent || { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 };
  const stock = me.itemStock || {};
  const decl = [];
  if ((stock.secondheart || []).length) {
    decl.push(`<label class="check itemopt epic"><input type="checkbox" id="item-heart"> 💔 Declare <strong>THE SECOND HEART</strong> <span class="rarity epic">EPIC</span> — yours: ${stock.secondheart.map(n => 'No. ' + n).join(', ')}. Once per run, the blow that would end you breaks it instead. Unbroken, it returns.</label>`);
  }
  if ((stock.stillbell || []).length) {
    decl.push(`<label class="check itemopt epic"><input type="checkbox" id="item-bell"> 🔔 Declare <strong>THE STILLBELL</strong> <span class="rarity epic">EPIC</span> — yours: ${stock.stillbell.map(n => 'No. ' + n).join(', ')}. Ring it mid-depth and the Trace cannot rise for 12 seconds. Unrung, it returns.</label>`);
  }
  const godPieces = (me.gear || []).filter(g => g.tier === 'GODFORGED');
  const godUsable = godPieces.filter(g => !g.retired && g.charges > 0);
  if (godUsable.length) {
    decl.push(`<label class="itemopt godopt">✦ Declare one <strong>GODFORGED</strong> treasure — charges are spent only when its power fires:
      <select id="god-select"><option value="">— carry none —</option>${godUsable.map(g => `<option value="${g.id}">${esc(g.name)} No. ${g.serial} — ${g.charges} charge${g.charges === 1 ? '' : 's'}</option>`).join('')}</select></label>`);
  } else if (godPieces.length) {
    decl.push('<p class="dim">✦ Your GODFORGED treasures are spent out — their numbers rest in your collection record.</p>');
  }
  const wornLine = `<p class="dim wornline">Gear swaps happen at <a href="/profile#satchel">your satchel</a>, between runs — never mid-delve.</p>`;
  const body = `
  <section class="descent-wrap">
    ${hero}
    ${bannersHtml(state)}
    <div class="descent-record">
      <div><strong>${rec.runs}</strong><span>runs</span></div>
      <div><strong>${rec.deepest ? 'Depth ' + rec.deepest : '—'}</strong><span>deepest</span></div>
      <div><strong>${rec.bestScore}</strong><span>best score</span></div>
      <div><strong>${rec.bestHaul}</strong><span>richest haul</span></div>
      <div><strong>${rec.bossesSlain}</strong><span>bosses slain</span></div>
    </div>
    <div class="hud">
      <div class="hudcell"><label>GATE</label><div class="bar hp"><i id="hpbar"></i></div><span id="hptext">100</span></div>
      <div class="hudcell"><label>INTEGRITY</label><div class="bar int"><i id="intbar"></i></div><span id="inttext">100</span></div>
      <div class="hudcell timer"><label>TIME</label><span id="clock">2:00</span></div>
      <div class="hudcell"><label>ENERGY</label><div class="bar en"><i id="enbar"></i></div><span id="entext">100</span></div>
      <div class="hudcell"><label>TRACE</label><div class="bar trace" id="tracewrap"><i id="tracebar"></i></div><span id="tracetext">0%</span></div>
    </div>
    <div class="runline" id="runline">Depth — · Score 0 · Carrying nothing</div>
    <div class="stage descent-stage">
      <canvas id="gate" width="900" height="560"></canvas>
      <div id="lootlayer" class="lootlayer"></div>
      <div id="bossplate" class="bossplate hidden"></div>
      <div id="depthbanner" class="depthbanner hidden"></div>
      <div id="gatechoice" class="gatechoice hidden">
        <h2>THE GATE STANDS OPEN</h2>
        <p id="gatechoice-text">The way down is darker and richer. The way up banks everything you carry.</p>
        <div class="gatechoice-btns">
          <button id="descend-btn" class="fightbtn descend" type="button">▼ DESCEND DEEPER</button>
          <button id="ascend-btn" class="fightbtn ascend" type="button">▲ ASCEND &amp; BANK</button>
        </div>
      </div>
      <div id="winframe" class="winframe hidden"><span id="winframe-label">OPEN WINDOW ×2</span><i id="winframe-bar"></i></div>
      <div id="stage-msg" class="stage-msg">
        <h2>The stairs are waiting, ${esc(me.displayName || 'fighter')}.</h2>
        <p>Your full Command Deck goes down with you — tool pods, abilities, the parry plate — plus whatever your tools are wearing. Declare your treasures, then take the first step.</p>
        ${armoryHtml(me)}
        ${wornLine}
        ${decl.length ? `<div class="itempanel"><h3>Declared at the door — spent only as the design says</h3>${decl.join('')}</div>` : ''}
        <button id="startbtn" class="fightbtn">▼ BEGIN THE DESCENT</button>
        <p class="dim">A run abandoned from this door banks its haul like an ascent — the Keeper is not cruel, but the dark keeps its own ledger below.</p>
      </div>
      <div id="verdict" class="verdict hidden"></div>
    </div>
    <div id="twinread" class="twinread">The dark is reading you…</div>
    <button id="parrybtn" class="parrybtn" type="button" disabled><span class="parry-charge" id="parry-charge"></span>⚡ PARRY<span>tap when it winds up — or tap the optic, or hit SPACE</span></button>
    <div class="kit" id="kit"></div>
    <div class="kit abilities" id="abilities"></div>
    <div class="kit modrail" id="modrail"></div>
    <div class="haulfeed panel"><h2>Carried haul — unbanked until you ascend or a boss falls</h2><ul id="haulfeed"><li class="dim">Empty hands. The depths provide.</li></ul>
    <p><button id="abandonbtn" class="ghostbtn hidden" type="button">Abandon the run — ascend with what you carry</button></p></div>
    ${boards}
    <div class="arena-foot">
      <span>Bosses stand at Depths 3, 6, 9, 12 and onward — the Captor, the Accountant, the Mirror, the Undertaker, and then they come again, deeper. Vaults open at Depths 5, 10, 15… GODFORGED treasures fall only from bosses at Depth 9 and deeper, at a few percent — ${dtally.godforged || 0} exist in the world as of this page.</span>
      <button id="mutebtn" class="ghostbtn" type="button">Sound: on</button>
    </div>
  </section>
  <script>window.TA_DESCENT = true;</script>
  <script src="/js/descent.js"></script>`;
  return shell('The Descent', body, me);
}

// ---- THE GALACTIC -------------------------------------------------------------
// A totally different layout language: no halls, no doors in a row — a sky.
// The star map fills the screen; sectors are places you touch; the command
// strip rides the bottom with your ship on it. The Bridge is the fighter's
// full profile in the theater's own dress: captain, ship, records from
// every theater, and the whole collection — nobody flies out to check who
// they are.
const TIER_TRIM = { STURDY: '#cfd6dd', RARE: '#3fa9ff', EPIC: '#b967ff', LEGENDARY: '#ffd700', GODFORGED: '#fff3c4' };
const SHIP_SLOTS = { flood: 'FLOOD CANNONS', probe: 'PROBE LANCE', whisper: 'WHISPER VANES', decoy: 'DECOY PROJECTOR', body: 'HULL PLATING' };
let shipUid = 0;
// The ship, composed from the build itself: hull trim from the body relic's
// tier, every weapon mount tipped in its gear's tier color, fitted mods as
// glowing hardpoint pips in their own colors. Code-drawn SVG — no assets.
function shipSvg(p, big) {
  const uid = 'sh' + (++shipUid);
  const worn = game.wornGearMap(p || {});
  const mods = p ? game.modSummary(p) : { fitted: {} };
  const trim = s => worn[s] ? (TIER_TRIM[worn[s].tier] || '#8b98a9') : '#54627c';
  const pip = (tool, x, y) => {
    const mid = mods.fitted[tool];
    if (!mid) return '';
    const m = game.FITTED_MODS[mid];
    return `<circle cx="${x}" cy="${y}" r="${big ? 7 : 5}" fill="none" stroke="${m.color}" stroke-width="2"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="${big ? 9 : 7}" fill="${m.color}">${m.sigil}</text>`;
  };
  return `<svg class="ship ${big ? 'big' : 'mini'}" viewBox="0 0 340 200" role="img" aria-label="Your ship, built from your build">
  <defs>
    <linearGradient id="${uid}h" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#232f47"/><stop offset=".55" stop-color="#131a2a"/><stop offset="1" stop-color="#0a0e18"/>
    </linearGradient>
    <radialGradient id="${uid}e" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#ffd166"/><stop offset=".45" stop-color="#ff7a2a"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path d="M58 62 L26 34 L96 74 Z" fill="#10182a" stroke="${trim('whisper')}" stroke-width="2"/>
  <path d="M58 138 L26 166 L96 126 Z" fill="#10182a" stroke="${trim('whisper')}" stroke-width="2"/>
  <ellipse cx="26" cy="100" rx="20" ry="13" fill="url(#${uid}e)" opacity=".9"/>
  <polygon points="34,91 4,100 34,109" fill="#ffb35c"/>
  <path d="M34 100 L112 64 Q206 48 272 72 L326 100 L272 128 Q206 152 112 136 Z" fill="url(#${uid}h)" stroke="${trim('body')}" stroke-width="${big ? 3 : 2}"/>
  <path d="M120 78 Q200 66 262 84" fill="none" stroke="rgba(185,103,255,.28)" stroke-width="2"/>
  <path d="M120 122 Q200 134 262 116" fill="none" stroke="rgba(120,160,220,.18)" stroke-width="2"/>
  <ellipse cx="222" cy="86" rx="17" ry="7" fill="#b967ff" opacity=".85"/>
  <ellipse cx="222" cy="86" rx="17" ry="7" fill="none" stroke="#e6ccff" stroke-width="1" opacity=".6"/>
  <line x1="298" y1="90" x2="338" y2="80" stroke="${trim('probe')}" stroke-width="2.5"/>
  <circle cx="338" cy="80" r="3.5" fill="${trim('probe')}"/>
  <rect x="246" y="120" width="42" height="5" rx="2" fill="#1b2740" stroke="${trim('flood')}" stroke-width="1.6"/>
  <rect x="254" y="128" width="36" height="5" rx="2" fill="#1b2740" stroke="${trim('flood')}" stroke-width="1.6"/>
  <path d="M64 146 l9 9 l-9 9 l-9 -9 Z" fill="none" stroke="${trim('decoy')}" stroke-width="2" stroke-dasharray="3 3"/>
  ${pip('probe', 306, 74)}${pip('flood', 240, 132)}${pip('whisper', 52, 52)}${pip('decoy', 84, 154)}
</svg>`;
}
function xpBarHtml(p) {
  const xp = p.xp || 0, lv = game.levelForXp(xp);
  const cur = game.xpForLevel(lv), next = game.xpForLevel(lv + 1);
  const pctv = Math.max(0, Math.min(100, Math.round((xp - cur) / (next - cur) * 100)));
  return `<div class="xpbar"><i style="width:${pctv}%"></i></div><span class="xptext">${xp} XP · Lv ${lv} at ${cur} · next at ${next}</span>`;
}
function galacticBoardsHtml(state) {
  const gt = state.galactic || { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} };
  const gp = Object.values(state.players).filter(x => x.email && x.galactic);
  const gr = x => game.galacticRecord(x);
  const list = (key, fmt) => gp.filter(x => gr(x)[key] > 0).sort((a, b) => gr(b)[key] - gr(a)[key]).slice(0, 5)
    .map(p => `<li><a href="/fighter/${p.id}"><span class="lname">${esc(p.displayName || 'Fighter')}</span><span class="lstat">${fmt(gr(p)[key])}</span></a></li>`).join('')
    || '<li class="dim">No mark set yet.</li>';
  const fc = (gt.firstClear || {})['1'];
  return `<div class="panel descent-boards">
    <h2>The sortie boards</h2>
    <p class="dim">${gt.sorties} sorties flown · ${gt.encountersCleared} encounters cleared · ${gt.capitalsSlain} capitals slain · ${gt.deaths} ships destroyed · ${gt.legendaries || 0} LEGENDARY pieces banked from the sky.</p>
    ${fc ? `<p class="g-firstclear">★ SECTOR 1 FIRST CLEARED BY <strong>${esc(fc.name)}</strong> · ${new Date(fc.at).toISOString().slice(0, 10)} — receipted in the books, named and dated and permanent.</p>` : '<p class="g-firstclear unclaimed">★ Sector 1 stands uncleared. The first captain to bring down THE HERALD is receipted in the books forever.</p>'}
    <h3 class="boardh">Deepest into the Reach</h3><ul class="board">${list('deepest', v => 'Encounter ' + v)}</ul>
    <h3 class="boardh">Highest sortie score</h3><ul class="board">${list('bestScore', v => v + ' pts')}</ul>
    <h3 class="boardh">Richest haul banked</h3><ul class="board">${list('bestHaul', v => '' + v)}</ul>
  </div>`;
}

function galacticPage(state, me) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), me);
  const member = !!(me && me.email);
  const rec = member ? game.galacticRecord(me) : null;
  const cleared1 = rec && rec.cleared['1'];
  const fc = (state.galactic && state.galactic.firstClear || {})['1'];
  const coords = [{ x: 20, y: 79 }, { x: 42, y: 61 }, { x: 58, y: 44 }, { x: 74, y: 28 }, { x: 87, y: 13 }];
  const numerals = ['I', 'II', 'III', 'IV', 'V'];
  const nodes = game.GALACTIC_SECTORS.map((s, i) => {
    const c = coords[i];
    if (s.playable) {
      const st = cleared1 ? `<span class="gn-state cleared">★ CLEARED — ${new Date(cleared1.firstAt).toISOString().slice(0, 10)}</span>`
        : `<span class="gn-state held">HELD BY THE ARMADA</span>`;
      return `<a class="gnode playable ${cleared1 ? 'is-cleared' : ''}" href="#sector-1" style="left:${c.x}%;top:${c.y}%"><span class="gn-num">${numerals[i]}</span><span class="gn-name">${esc(s.name)}</span>${st}<span class="gn-cap">capital: ${esc(s.capital.name)}</span></a>`;
    }
    return `<div class="gnode locked" style="left:${c.x}%;top:${c.y}%" aria-disabled="true"><span class="gn-num">${numerals[i]}</span><span class="gn-name">${esc(s.name)}</span><span class="gn-state locked">🔒 LOCKED</span><span class="gn-cap">${s.capital ? 'capital: ' + esc(s.capital.name) : 'capital: uncharted'}</span></div>`;
  }).join('');
  const routePts = coords.map(c => `${c.x},${c.y}`).join(' ');
  const ladder = game.GALACTIC_LADDER.map((kind, i) => {
    const t = game.GALACTIC_TIERS[kind];
    return `<span class="glad ${kind === 'capital' ? 'cap' : ''}">${i + 1} · ${t.tier.toUpperCase()} <em>${t.className}</em>${kind === 'squadrons' ? ' · MIRAGE feints' : ''}${kind === 'capital' ? ' · ' + esc(game.GALACTIC_CAPITAL.name) : ''}</span>`;
  }).join('');
  const myRecord = member ? `
    <div class="descent-record grec">
      <div><strong>${rec.sorties}</strong><span>sorties</span></div>
      <div><strong>${rec.deepest ? 'Enc. ' + rec.deepest : '—'}</strong><span>deepest</span></div>
      <div><strong>${rec.bestScore}</strong><span>best score</span></div>
      <div><strong>${rec.capitalsSlain}</strong><span>capitals slain</span></div>
      <div><strong>${game.galacticAttention(state, me, 1)}%</strong><span>armada attention</span></div>
    </div>` : '';
  const sectorCards = game.GALACTIC_SECTORS.map((s, i) => {
    if (s.playable) {
      return `<article class="gsector open" id="sector-1">
        <header><span class="gsec-num">${numerals[i]}</span><div><h2>${esc(s.name)}</h2><span class="gsec-state ${cleared1 ? 'cleared' : 'held'}">${cleared1 ? '★ CLEARED BY YOU — the armada flies a notch quieter for you here' : 'HELD BY THE ARMADA'}</span></div></header>
        <p class="gsec-story">${esc(s.story)}</p>
        <div class="gladder">${ladder}</div>
        <p class="dim">Eight encounters, flown as one sortie: your integrity and your attention carry from fight to fight, and the haul rides unbanked until you withdraw — or the Herald falls and banks it all on the spot. Destruction takes the unbanked STURDY and RARE; EPIC and above always come home. Clearing pays a burst of XP, a guaranteed capital-table drop (EPIC, with a LEGENDARY's chance), and a permanent notch off this sector's aggression for you. No GODFORGED falls in Sector 1 — god-tier steel waits at Blaze-class capitals, in deeper skies.</p>
        ${fc ? `<p class="g-firstclear">★ First cleared by <strong>${esc(fc.name)}</strong> · ${new Date(fc.at).toISOString().slice(0, 10)} — the receipt stands in the books.</p>` : '<p class="g-firstclear unclaimed">★ No captain has cleared this sector. The first receipt is unwritten.</p>'}
        ${myRecord}
        <div class="gdoors">
          ${member ? '<a class="fightbtn gfight" href="/galactic/fly">🚀&nbsp; CHALLENGE THE ARMADA</a>' : '<p class="dim">The sky is members-only — a sortie keeps what it wins, and keeping requires a name. <a href="/signup">Claim your profile</a> and the Reach is yours to fly.</p>'}
          <button class="ghostbtn gduel" type="button" disabled title="Live duels arrive in a later phase">⚔ THE DUELING FIELD — <em>sealed until Phase G3</em></button>
        </div>
        <p class="dim">The dueling field is drawn on the chart because it is coming — live captain-versus-captain duels, refereed in real time. It opens in its own phase, on its own order, and not a day before it can be refereed honestly. The armada, meanwhile, is here now.</p>
      </article>`;
    }
    return `<article class="gsector locked" id="sector-${s.id}">
      <header><span class="gsec-num">${numerals[i]}</span><div><h2>${esc(s.name)}</h2><span class="gsec-state locked">🔒 LOCKED</span></div></header>
      <p class="gsec-story">${esc(s.story)}</p>
      ${s.capital ? `<p class="dim">Its capital: <strong>${esc(s.capital.name)}</strong> — held for its own sector, fought in its own campaign.</p>` : '<p class="dim">Its capital is not yet charted.</p>'}
      <p class="glockreason">${esc(s.lockedReason)}</p>
    </article>`;
  }).join('');
  const strip = member ? `
  <div class="gstrip">
    <a class="gstrip-ship" href="/galactic/bridge">${shipSvg(me, false)}<span class="gstrip-id"><strong>${esc(me.displayName || 'Captain')}</strong><span>Lv ${game.levelForXp(me.xp || 0)} · ${esc(game.classOf(me).name)} class</span></span></a>
    <div class="gstrip-meters">
      <div class="gmeter"><label>HULL</label><div class="bar int"><i style="width:100%"></i></div><span>${100 + (game.gearMods(game.wornGearMap(me).body || {}).plating || 0)}</span></div>
      <div class="gmeter"><label>ATTENTION</label><div class="bar trace"><i style="width:${game.galacticAttention(state, me, 1)}%"></i></div><span>${game.galacticAttention(state, me, 1)}%</span></div>
    </div>
    <div class="gstrip-btns">
      <a class="fightbtn small" href="/galactic/fly">⚔ FIGHT</a>
      <a class="ghostbtn" href="/galactic/bridge">THE BRIDGE</a>
    </div>
  </div>` : `
  <div class="gstrip guest">
    <span class="dim">You are looking at her sky as a guest.</span>
    <div class="gstrip-btns"><a class="fightbtn small" href="/signup">CLAIM A PROFILE TO FLY</a><a class="ghostbtn" href="/login">Sign in</a></div>
  </div>`;
  const body = `
  <section class="gwrap">
    <div class="gtop">
      <div><span class="g-kicker">THE TWIN ARENA · THEATER III</span><h1>THE GALACTIC</h1></div>
      <div class="gtop-meta"><span>SECTOR 1 · ARMADA PRESENCE: FLARE</span><a href="/">← the Arena door</a></div>
    </div>
    <p class="glede">The Twin's war has left the cathedral and taken the sky. Your fighter is a ship now — same build, same levels, same mind hunting you. Everything you ever earned flies with you.</p>
    ${bannersHtml(state)}
    <div class="gmap" role="navigation" aria-label="Star map of the armada's sectors">
      <div class="gnebula n1"></div><div class="gnebula n2"></div><div class="gnebula n3"></div>
      <div class="gstars a"></div><div class="gstars b"></div>
      <svg class="groutes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${routePts}" fill="none" stroke="rgba(255,150,80,.34)" stroke-width=".45" stroke-dasharray="1.6 1.1"/><polyline points="${routePts}" fill="none" stroke="rgba(185,103,255,.16)" stroke-width="1.4"/></svg>
      ${nodes}
      <span class="gyou" style="left:${coords[0].x}%;top:${coords[0].y}%">YOU ARE HERE</span>
    </div>
    ${sectorCards}
    ${galacticBoardsHtml(state)}
    <div class="panel">
      <h2>How the sky works</h2>
      <ol class="how">
        <li><strong>Your build is your ship.</strong> Tools become weapons systems with identical referee math; worn gear rides the hull and sets its trim; fitted mods are hardpoints; the Mod Rail is your systems row, and its deployables fire in space exactly as in the Arena.</li>
        <li><strong>One pool, one mind.</strong> XP, levels and weight class are shared across every theater. Her global learning ticks from galactic fights at the Arena rate — a counter she evolves against you anywhere is waiting everywhere.</li>
        <li><strong>The Trace is Armada Attention here.</strong> The more you fight in a sector, the more its armada has read you — sector familiarity that sharpens its counters, filed per sector. It decays when you hunt in other theaters. Your Arena habits pre-read you at +10%, capped low.</li>
        <li><strong>Fly the sortie.</strong> Eight encounters, escalating Pickets → Patrols → Mirage Squadrons → THE HERALD. Press on or withdraw after each; the capital's fall clears the sector, banks the haul, and is receipted forever.</li>
      </ol>
    </div>
  </section>
  ${strip}`;
  return shell('The Galactic', body, me);
}

function galacticFlyPage(state, me) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), me);
  const hero = `
    <div class="gfly-hero">
      <span class="g-kicker">SECTOR 1 · EMBERFALL REACH</span>
      <h1>FLY THE SORTIE</h1>
      <p class="lede">Eight encounters between you and the Herald. Your ship is your build — weapons, hull, hardpoints, systems row — and the armada is reading you the whole way out.</p>
    </div>`;
  if (!me || !me.email) {
    const body = `<section class="descent-wrap">${hero}
      <div class="panel"><h2>The sky is members-only</h2>
      <p>A sortie keeps what it wins — and keeping requires a cargo hold, and a hold requires a name. <a href="/signup">Claim your profile</a> and take the sky. Guests may read the boards:</p></div>
      ${galacticBoardsHtml(state)}</section>`;
    return shell('Fly the Sortie', body, me);
  }
  const rec = game.galacticRecord(me);
  const cleared1 = rec.cleared['1'];
  const body = `
  <section class="descent-wrap gfly">
    ${hero}
    ${bannersHtml(state)}
    <div class="descent-record">
      <div><strong>${rec.sorties}</strong><span>sorties</span></div>
      <div><strong>${rec.deepest ? 'Enc. ' + rec.deepest : '—'}</strong><span>deepest</span></div>
      <div><strong>${rec.bestScore}</strong><span>best score</span></div>
      <div><strong>${rec.bestHaul}</strong><span>richest haul</span></div>
      <div><strong>${rec.capitalsSlain}</strong><span>capitals slain</span></div>
      <div><strong>${cleared1 ? '★ YES' : '—'}</strong><span>sector cleared</span></div>
    </div>
    <div class="hud">
      <div class="hudcell"><label>ENEMY HULL</label><div class="bar hp"><i id="hpbar"></i></div><span id="hptext">100</span></div>
      <div class="hudcell"><label>INTEGRITY</label><div class="bar int"><i id="intbar"></i></div><span id="inttext">100</span></div>
      <div class="hudcell timer"><label>TIME</label><span id="clock">2:00</span></div>
      <div class="hudcell"><label>ENERGY</label><div class="bar en"><i id="enbar"></i></div><span id="entext">100</span></div>
      <div class="hudcell"><label>ATTENTION</label><div class="bar trace" id="tracewrap"><i id="tracebar"></i></div><span id="tracetext">0%</span></div>
    </div>
    <div class="runline" id="runline">Encounter — · Score 0 · Carrying nothing</div>
    <div class="stage galactic-stage">
      <canvas id="gate" width="900" height="560"></canvas>
      <div id="lootlayer" class="lootlayer"></div>
      <div id="bossplate" class="bossplate hidden"></div>
      <div id="depthbanner" class="depthbanner hidden"></div>
      <div id="gatechoice" class="gatechoice hidden">
        <h2>THE ENEMY BREAKS</h2>
        <p id="gatechoice-text">Press on into the Reach, or withdraw and bank everything you carry.</p>
        <div class="gatechoice-btns">
          <button id="descend-btn" class="fightbtn descend" type="button">▲ PRESS ON</button>
          <button id="ascend-btn" class="fightbtn ascend" type="button">▼ WITHDRAW &amp; BANK</button>
        </div>
      </div>
      <div id="winframe" class="winframe hidden"><span id="winframe-label">OPEN WINDOW ×2</span><i id="winframe-bar"></i></div>
      <div id="stage-msg" class="stage-msg">
        <h2>Your ship is on the pad, ${esc(me.displayName || 'captain')}.</h2>
        <p>Your full Command Deck flies with you — tool pods as weapons systems, abilities, the shield flare — plus whatever your hull is wearing. Refit at <a href="/galactic/bridge">the Bridge</a>, never mid-sortie.</p>
        ${armoryHtml(me)}
        <button id="startbtn" class="fightbtn">🚀 BEGIN THE SORTIE</button>
        <p class="dim">A sortie abandoned from this pad banks its haul like a withdrawal — the Keeper is not cruel, but the Reach keeps its own ledger.</p>
      </div>
      <div id="verdict" class="verdict hidden"></div>
    </div>
    <div id="twinread" class="twinread">The armada is reading you…</div>
    <button id="parrybtn" class="parrybtn" type="button" disabled><span class="parry-charge" id="parry-charge"></span>⚡ SHIELD FLARE<span>tap when it winds up — or tap the enemy, or hit SPACE</span></button>
    <div class="kit" id="kit"></div>
    <div class="kit abilities" id="abilities"></div>
    <div class="kit modrail" id="modrail"></div>
    <div class="haulfeed panel"><h2>In the hold — unbanked until you withdraw or a capital falls</h2><ul id="haulfeed"><li class="dim">Empty hold. The Reach provides.</li></ul>
    <p><button id="abandonbtn" class="ghostbtn hidden" type="button">Abandon the sortie — withdraw with what you carry</button></p></div>
    ${galacticBoardsHtml(state)}
    <div class="arena-foot">
      <span>Pickets teach the theater; Patrols pair up; Squadrons fly MIRAGE feints — false wind-ups that eat a hasty flare. THE HERALD crowns the Reach, and its glances hunt the weapon your sortie leans on. Attention is the Trace wearing a sector's sky: loud flying is read, and read flying is countered.</span>
      <button id="mutebtn" class="ghostbtn" type="button">Sound: on</button>
    </div>
  </section>
  <script>window.TA_GALACTIC = true;</script>
  <script src="/js/galactic.js"></script>`;
  return shell('Fly the Sortie', body, me);
}

// ---- THE BRIDGE: the captain's whole profile, in the theater's dress -------
function galacticBridgePage(state, p) {
  if (state.config.frozen) return shell('Frozen', maintenanceCard(), p);
  const cls = game.classOf(p);
  const rec = game.galacticRecord(p);
  const worn = game.wornGearMap(p);
  const modSum = game.modSummary(p);
  const founder = game.founderSerial(p);
  const cleared1 = rec.cleared['1'];
  const stands = game.GEAR_SLOTS.map(slot => {
    const g = worn[slot];
    const fm = slot !== 'body' ? game.fittedMod(p, slot) : null;
    const modChip = fm ? `<span class="stand-mod" style="--mc:${game.FITTED_MODS[fm].color}">${game.FITTED_MODS[fm].sigil} ${esc(game.FITTED_MODS[fm].name)} on the hardpoint</span>` : '';
    const unwear = g ? `<form method="post" action="/api/gear/unwear" class="inlineform"><input type="hidden" name="slot" value="${slot}"><input type="hidden" name="back" value="bridge"><button class="ghostbtn small" type="submit">Unmount</button></form>` : '';
    if (!g) return `<div class="stand bare"><span class="stand-icon">${toolIcon(slot)}</span><span class="stand-slot">${SHIP_SLOTS[slot]}</span><strong class="stand-name dim">BARE STEEL</strong><span class="stand-affixes dim">nothing mounted — the Reach provides</span>${modChip}</div>`;
    const tier = String(g.tier || 'STURDY').toUpperCase();
    const affixes = game.gearLine(g).map(esc).join(' · ');
    return `<div class="stand r-${tier.toLowerCase()}"><span class="stand-icon">${toolIcon(slot)}</span><span class="stand-slot">${SHIP_SLOTS[slot]}</span><strong class="stand-name">${esc(g.name)}</strong><span class="tierbadge t-${tier.toLowerCase()}">${tier}${g.serial ? ' No. ' + g.serial : ''}</span>${affixes ? `<span class="stand-affixes">${affixes}</span>` : ''}${modChip}${unwear}</div>`;
  }).join('');
  const satchel = (p.gear || []).filter(g => !g.worn).map(g => {
    const tier = String(g.tier || 'STURDY').toUpperCase();
    const mount = g.tier === 'GODFORGED'
      ? `<span class="dim">declared at the Descent's door — treasures are not mounted</span>`
      : `<form method="post" action="/api/gear/wear" class="inlineform"><input type="hidden" name="gearId" value="${g.id}"><input type="hidden" name="back" value="bridge"><button class="ghostbtn small" type="submit">Mount on hull</button></form>`;
    return `<li class="gearline t-${tier.toLowerCase()}"><strong>${esc(g.name)}</strong> <span class="tierbadge t-${tier.toLowerCase()}">${tier}${g.serial ? ' No. ' + g.serial : ''}</span> <span class="dim">${SHIP_SLOTS[g.slot] || g.slot}${g.tier === 'GODFORGED' ? ` · charges ${g.charges} of ${g.chargesMax}${g.retired ? ' · spent out' : ''}` : ''}</span> ${mount}</li>`;
  }).join('') || '<li class="dim">The hold is empty. Fly, delve, and breach — the house provides.</li>';
  const fitForms = game.TOOL_IDS.map(tool => {
    const owned = Object.keys(game.FITTED_MODS).filter(id => game.FITTED_MODS[id].tool === tool && p.modsOwned && p.modsOwned[id]);
    const cur = game.fittedMod(p, tool);
    if (!owned.length && !cur) return '';
    return `<form method="post" action="/api/mods/fit" class="fitform"><input type="hidden" name="tool" value="${tool}"><input type="hidden" name="back" value="bridge"><label>${SHIP_SLOTS[tool]} hardpoint
      <select name="mod"><option value="">— bare —</option>${owned.map(id => `<option value="${id}" ${cur === id ? 'selected' : ''}>${game.FITTED_MODS[id].sigil} ${esc(game.FITTED_MODS[id].name)}</option>`).join('')}</select></label><button class="ghostbtn small" type="submit">Socket</button></form>`;
  }).join('');
  const shelf = [];
  for (const itemId of Object.keys(game.ITEMS)) {
    const serials = (p.itemStock && p.itemStock[itemId]) || [];
    for (const n of serials) shelf.push(itemLine(itemId, n));
  }
  const devil = p.devil || { held: 0, breached: 0 };
  const body = `
  <section class="bridge">
    <div class="gtop">
      <div><span class="g-kicker">THE GALACTIC · YOUR SHIP</span><h1>THE BRIDGE</h1></div>
      <div class="gtop-meta"><a href="/galactic">← the star map</a></div>
    </div>
    <div class="captain-plate">
      ${p.photo ? `<img class="p-face" src="${esc(p.photo)}" alt="">` : '<div class="p-face ghost">◐</div>'}
      <div class="captain-id">
        <h2>${esc(p.displayName || 'Captain')}</h2>
        <p class="dim">${esc(p.email || '')} · <span class="classchip c${cls.idx}">${esc(cls.name)} class</span> · ${p.points} mutation points</p>
        ${xpBarHtml(p)}
        ${founder ? `<p class="embermark">🔥 Founder's Ember No. ${founder} — one of the first hundred. +10% XP in every theater.</p>` : ''}
      </div>
      <div class="captain-ship">${shipSvg(p, true)}</div>
    </div>
    <h2 class="bridge-h">The ship — your build, mounted</h2>
    <div class="armory-stands">${stands}</div>
    ${fitForms ? `<div class="panel"><h3>Hardpoints — socket the fitted mods</h3>${fitForms}</div>` : ''}
    <div class="panel">
      <h3>In the hold — the cargo satchel</h3>
      <ul class="satchel">${satchel}</ul>
      <p class="dim">Mounting and socketing happen here, between flights — never mid-sortie, never mid-delve. The same law in every theater.</p>
    </div>
    <h2 class="bridge-h">The record — every theater, one captain</h2>
    <div class="record-grid">
      <div class="record-card"><h3>⚔ The Arena</h3><p><strong>${p.record.bouts}</strong> bouts · <strong>${p.record.breaches}</strong> breaches · streak ${p.record.streak}${p.record.bestSecs ? ` · best ${game.fmtTime(p.record.bestSecs)}` : ''}</p><a href="/arena">Fight →</a></div>
      <div class="record-card"><h3>🔥 The Pit</h3><p>As a hunter: <strong>${(p.pitAttack || {}).breaches || 0}</strong> devils breached in ${(p.pitAttack || {}).bouts || 0} bouts. Your devil: <strong>${devil.held}</strong> holds · breached ${devil.breached} · bounty ${game.bountyNow(p, Date.now())} pts.</p><a href="/pit">The hall →</a></div>
      <div class="record-card"><h3>🕯 The Descent</h3><p><strong>${(p.descent || {}).runs || 0}</strong> runs · deepest Depth ${(p.descent || {}).deepest || 0} · best score ${(p.descent || {}).bestScore || 0} · bosses slain ${(p.descent || {}).bossesSlain || 0}.</p><a href="/descent">The stairs →</a></div>
      <div class="record-card sky"><h3>🚀 The Galactic</h3><p><strong>${rec.sorties}</strong> sorties · deepest Encounter ${rec.deepest || 0} · best score ${rec.bestScore} · capitals slain ${rec.capitalsSlain} · Sector 1 attention ${game.galacticAttention(state, p, 1)}%.</p>
      ${cleared1 ? `<p class="g-firstclear">★ SECTOR 1 CLEARED · first on ${new Date(cleared1.firstAt).toISOString().slice(0, 10)} · ${cleared1.clears} clearing${cleared1.clears === 1 ? '' : 's'} on your chart.</p>` : '<p class="dim">Sector 1 stands uncleared on your chart. THE HERALD is waiting.</p>'}
      <a href="/galactic/fly">Fly →</a></div>
    </div>
    <h2 class="bridge-h">The collection — numbered, signed, earned</h2>
    <div class="panel">
      ${shelf.length ? `<ul class="shelf">${shelf.join('')}</ul>` : '<p class="dim">No numbered treasures yet. Breach Mirage and Armored devils, hold the Pit, take the deep bosses — the shelf fills with deeds, never with purchases.</p>'}
      ${modSum.owned.length ? `<p class="pit-gear">Mods aboard: ${modSum.owned.map(id => `<span class="tierbadge" style="border-color:${game.MODS_ALL[id].color};color:${game.MODS_ALL[id].color}">${game.MODS_ALL[id].sigil} ${esc(game.MODS_ALL[id].name)}</span>`).join(' ')}</p>` : '<p class="dim">No mods aboard yet — they fall in the Descent and the Reach, and off breached devils.</p>'}
      <p class="dim">The full satchel, evolution web and house profile live at <a href="/profile">your profile</a> — the same record, in the Arena's dress. Nothing here is a copy; it is one book, read from the Bridge.</p>
    </div>
  </section>`;
  return shell('The Bridge', body, p);
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

module.exports = { esc, shell, landing, arenaPage, authPage, profilePage, fighterPage, webPage, verdictPage, challengePage, deckPage, maintenanceCard, pitPage, devilCardHtml, descentPage, galacticPage, galacticFlyPage, galacticBridgePage, shipSvg };
