'use strict';
// THE TWIN ARENA — game rules. Server-authoritative learning, points and evolution.
// The "attacks" here are game verbs only; nothing in this file touches anything real.

const TOOLS = {
  probe:   { name: 'Probe',   cost: 9,  cooldown: 1100, dmg: 3,  trace: 3,  color: '#00e5ff',
             blurb: 'A needle of light. Cheap, quick, nearly silent (+3% trace) — and it marks the gate: your next strike within 4s hits +30%.' },
  flood:   { name: 'Flood',   cost: 30, cooldown: 4000, dmg: 13, trace: 14, color: '#ff2a6d',
             blurb: 'A burst of a thousand false dawns. Heavy damage, heavy price — and loud: +14% trace every time.' },
  whisper: { name: 'Whisper', cost: 16, cooldown: 2500, dmg: 3, dot: 2.2, dotSecs: 6, trace: 0, color: '#b967ff',
             blurb: 'A slow burn inside the walls. Burns over 6s, silences the gate\u2019s healing while it lasts — and adds no trace at all.' },
  decoy:   { name: 'Decoy',   cost: 20, cooldown: 5000, dmg: 0, trace: -18, color: '#fcee0a',
             blurb: 'A phantom gate. No damage — but your next strike lands +60%, it dumps 18% of your trace, and burned during a wind-up it eats the Twin\u2019s strike whole.' }
};
const TOOL_IDS = Object.keys(TOOLS);

const ROUND_MS = 150000;           // 2:30 — inside the 2-4 minute law
const GATE_HP = 100;
const ENERGY_MAX = 100;
const ENERGY_REGEN = 7;            // per second
const GATE_REGEN = 1.1;            // hp per second, x aggression, silenced by whisper

// ---- Combat doctrine: it throws back (Phase 2) -----------------------------
// The player has integrity too. The Twin strikes on a server-generated
// schedule scaled by the deck's aggression dial; haymakers are telegraphed
// (a wind-up you can parry — a parry opens a vulnerability window), glancing
// hits scramble a tool's cooldown, clean hits cost integrity. And every tool
// feeds the TRACE: loud play spikes it, quiet play lets it cool, and at 100%
// you are caught — the round ends on the spot.
const PLAYER_HP = 100;
const TRACE_MAX = 100;
const TRACE_COOL = 1.2;            // % per second, always cooling
const PARRY = { cost: 5, cooldown: 1500 };
const STRIKE = {
  baseMs: 8000,                    // strike interval at aggression 1 (divided by the dial)
  firstMs: 5000,                   // first strike lands about here
  windupMs: 1600,                  // haymaker telegraph window — parry inside it
  vulnMs: 3500,                    // vulnerability window after a parried haymaker
  vulnMult: 2,                     // gate damage multiplier inside the window
  scrambleMs: 2600,                // cooldown extension from a glancing hit
  dmg: { clean: 6, glance: 2, haymaker: 18 },
  cycle: ['clean', 'glance', 'clean', 'haymaker']
};

// ---- The Super Deck's weather (Phase 2.5) ----------------------------------
// STORM: a deck-fired event. While it runs, verdict points double and the
// Twin's aggression has a floor — the storm level — no matter how low the
// dial sits. The state is a deadline on the config; fights snapshot it at
// start, so a round already underway keeps the weather it was dealt.
const STORM = { aggression: 1.6, pointsMult: 2 };
function stormActive(state) {
  return !!(state && state.config && state.config.stormUntil && Date.now() < state.config.stormUntil);
}
function effectiveAggression(state) {
  const base = (state && state.config && state.config.aggression) || 1;
  return stormActive(state) ? Math.max(base, STORM.aggression) : base;
}

// ---- Phase 3: the Command Deck's abilities --------------------------------
// The evolution web comes downstairs: owning a path's TIER-2 node lights a
// real ability pod in the fight. Mapping (node -> ability):
//   vec2 'Heavy Flood'  -> OVERDRIVE     one huge hit (a Vectors strike: it
//                                        inherits Flood's familiarity/armor)
//   dec2 'Ghost Hands'  -> GHOST         your next 3 tool strikes leave no trace
//   pat2 'Smolder'      -> SECOND WIND   +30 integrity, once per fight
//   spd2 'Surge'        -> RAPID CYCLING cooldowns halved for 8 seconds
// Abilities are validated by the referee like everything else: a log that
// claims an ability the fighter's dealt stats do not carry VOIDS the bout.
const ABILITIES = {
  overdrive:  { node: 'vec2', name: 'OVERDRIVE',     cost: 40, cooldown: 25000, dmg: 20, trace: 10, color: '#ff2a6d',
                blurb: 'One huge hit. Inherits everything the Twin has learned about your Flood.' },
  ghost:      { node: 'dec2', name: 'GHOST',         cost: 25, cooldown: 30000, charges: 3, trace: 0, color: '#b967ff',
                blurb: 'Your next 3 tool strikes leave no trace at all.' },
  secondwind: { node: 'pat2', name: 'SECOND WIND',   cost: 20, cooldown: 150000, heal: 30, trace: 0, color: '#5dffa0',
                blurb: '+30 integrity. Once per fight — spend it like it matters.' },
  rapid:      { node: 'spd2', name: 'RAPID CYCLING', cost: 25, cooldown: 35000, windowMs: 8000, trace: 4, color: '#00e5ff',
                blurb: 'Every tool cooldown halves for 8 seconds.' }
};

// ---- Phase 3: combos (server-scored in the referee) ------------------------
// MARK & DROWN: a Flood within 3s of a Probe hits +50% (and eats the mark).
// COLD TRAIL: a Whisper within 5s of a Decoy also dumps 12% trace.
// OPEN WINDOW: the post-parry vulnerability window (already ×2) — the deck
// now shows it as a gold frame; the referee tags it in the combo list.
const COMBO = { markDrownMs: 3000, markDrownMult: 1.5, coldTrailMs: 5000, coldTrailDump: 12 };

// ---- MODS v1 (Steven, 2026-11-27) ------------------------------------------
// Two families, one law: everything is dealt into the fight stats and
// enforced by the referee, exactly like abilities and gear.
// FITTED mods socket onto ONE tool (one per tool) at the satchel, between
// fights, under the same swap law as gear — refused mid-Descent-run. Each
// changes its tool's referee math in one distinct way.
// DEPLOYABLE mods ride the MOD RAIL on the fight screen: chunky buttons a
// live player fires mid-fight ('mod:<id>' in the log), each with a small
// charge count per fight, refilled between fights. A devil never fires one —
// devils submit no log; only the live challenger's dealt rail exists.
// Mods are UNNUMBERED and PERMANENT in v1: no serials, no charges on the
// item itself, no expiry. The uses-and-expiry economy belongs to the Forge.
const FITTED_MODS = {
  throughline: { tool: 'probe', name: 'THROUGHLINE', sigil: '◎', color: '#00e5ff',
    line: 'Socketed on your Probe: its marks burn 75% longer — and striking a Decoy re-threads the mark instead of losing it. The mark goes through.' },
  emberline: { tool: 'flood', name: 'EMBERLINE', sigil: '♨', color: '#ff2a6d',
    line: 'Socketed on your Flood: every strike lays a slow ember on the gate — 1.0 damage a second for 4 seconds.' },
  ashenveil: { tool: 'whisper', name: 'ASHEN VEIL', sigil: '≋', color: '#b967ff',
    line: 'Socketed on your Whisper: every strike sheds 8% of your trace into the ash.' },
  paybackcoil: { tool: 'decoy', name: 'PAYBACK COIL', sigil: '↩', color: '#fcee0a',
    line: 'Socketed on your Decoy: while the phantom stands (5s), a quarter of every blow you take coils into your next strike, up to +12. Punishment, returned.' }
};
const DEPLOY_MODS = {
  overclock: { name: 'OVERCLOCK', sigil: '⏩', color: '#00e5ff', charges: 2,
    line: 'Fire it and your next strike resolves hasted — its cooldown is halved.' },
  tracepurge: { name: 'TRACE PURGE', sigil: '✜', color: '#5dffa0', charges: 2,
    line: 'Fire it and 35% of your trace burns off on the spot.' },
  ghostplate: { name: 'GHOST PLATE', sigil: '⛨', color: '#b967ff', charges: 2,
    line: 'Fire it and for 8 seconds the blows you take feed a hidden plate — half their weight, up to +20 — discharged into your first strike after the plate closes. They cannot see it charging.' },
  coldsnap: { name: 'COLD SNAP', sigil: '❄', color: '#7df9ff', charges: 2,
    line: 'Fire it and the Twin\u2019s next strike freezes mid-rhythm — it lands 1.2 seconds late.' }
};
const MODS_ALL = Object.assign({}, FITTED_MODS, DEPLOY_MODS);
const MOD_NUMBERS = {
  markMult: 1.75,          // THROUGHLINE: the mark lasts this much longer
  floodBurnDps: 1.0, floodBurnSecs: 4,   // EMBERLINE
  whisperShed: 8,          // ASHEN VEIL: trace shed per Whisper strike
  paybackRate: 0.25, paybackCap: 12, phantomMs: 5000,  // PAYBACK COIL
  purgeAmount: 35,         // TRACE PURGE
  plateMs: 8000, plateRate: 0.5, plateCap: 20,         // GHOST PLATE
  coldsnapMs: 1200         // COLD SNAP
};
// Where mods come from (v1): the Descent pays them out of the same seeded
// drop rng as gear (rolled AFTER the gear, so the gear books never shift),
// and a Pit breach occasionally leaves one in the hunter's hands.
const MOD_DROPS = {
  descent: {
    normal: { fitted: 0.12, deploy: 0 },
    elite: { fitted: 0.20, deploy: 0.10 },
    boss: { fitted: 0.35, deploy: 0.25 },
    vault: { fitted: 0.15, deploy: 0 }   // once per Vault, if any shape cracked
  },
  pitWin: 0.12
};
function ensureMods(player) {
  if (!player) return player;
  if (!player.modsOwned || typeof player.modsOwned !== 'object') player.modsOwned = {};
  if (!player.modsFitted || typeof player.modsFitted !== 'object') player.modsFitted = {};
  for (const t of TOOL_IDS) if (!(t in player.modsFitted)) player.modsFitted[t] = null;
  return player;
}
// The fitted mod actually in force for a tool: socketed AND owned. Anything
// else (a stale socket, a borrowed claim) reads as bare — the referee only
// ever sees what effectiveStats deals from this.
function fittedMod(player, tool) {
  if (!player || !player.modsFitted || !player.modsOwned) return null;
  const id = player.modsFitted[tool];
  return id && FITTED_MODS[id] && FITTED_MODS[id].tool === tool && player.modsOwned[id] ? id : null;
}
function grantMod(player, id) {
  ensureMods(player);
  if (!MODS_ALL[id] || player.modsOwned[id]) return false;
  player.modsOwned[id] = true;
  return true;
}
// Socket (or unsocket, modId null) a fitted mod. One mod per tool, one tool
// per mod — a fitted mod's home is fixed by its design.
function fitMod(player, tool, modId) {
  ensureMods(player);
  if (!TOOL_IDS.includes(tool)) return 'no such tool';
  if (modId == null || modId === '') { player.modsFitted[tool] = null; return null; }
  const def = FITTED_MODS[modId];
  if (!def) return 'no such fitted mod';
  if (def.tool !== tool) return def.name + ' sockets onto the ' + TOOLS[def.tool].name + ', not the ' + TOOLS[tool].name;
  if (!player.modsOwned[modId]) return 'you do not own ' + def.name + ' yet — the depths provide';
  player.modsFitted[tool] = modId;
  return null;
}
// Roll for a mod the fighter does not own yet. kind: 'fitted' | 'deploy' |
// 'any'. Returns the mod id granted (and grants it), or null when the shelf
// for that kind is already complete — a finished collection rolls no ghosts.
function rollModDrop(rng, player, kind) {
  ensureMods(player);
  const pool = Object.keys(MODS_ALL).filter(id => {
    if (player.modsOwned[id]) return false;
    if (kind === 'fitted') return !!FITTED_MODS[id];
    if (kind === 'deploy') return !!DEPLOY_MODS[id];
    return true;
  });
  if (!pool.length) return null;
  const id = pool[Math.floor(rng() * pool.length)];
  grantMod(player, id);
  return id;
}
// The Descent's mod drops for one cleared depth, rolled from the run's own
// seeded rng (after the gear rolls). Mutates the player (grants land in the
// satchel on the spot — mods are small, and death does not take them in v1).
function rollDescentMods(rng, player, kind) {
  const table = MOD_DROPS.descent[kind];
  if (!table) return [];
  const out = [];
  if (rng() < table.fitted) { const id = rollModDrop(rng, player, 'fitted'); if (id) out.push({ id, kind: 'fitted' }); }
  if (table.deploy && rng() < table.deploy) { const id = rollModDrop(rng, player, 'deploy'); if (id) out.push({ id, kind: 'deployable' }); }
  return out;
}
function modSummary(player) {
  ensureMods(player);
  const fitted = {};
  for (const t of TOOL_IDS) { const id = fittedMod(player, t); if (id) fitted[t] = id; }
  return {
    owned: Object.keys(MODS_ALL).filter(id => player.modsOwned[id]),
    fitted,
    deployOwned: Object.keys(DEPLOY_MODS).filter(id => player.modsOwned[id])
  };
}

// ---- Phase 3: XP, levels, weight classes -----------------------------------
// XP is a progression track ONLY: never spent, never bought, no shop. House
// fights pay a flat line plus a bonus for teaching new shapes. Pit fights pay
// by class: steady in your class, richer a class up. A devil's holds pay its
// owner a trickle of defense XP, capped per day so sleep can't be farmed.
// Level thresholds: xpForLevel(L) = 25*(L-1)*L  (L2=50, L3=150, L4=300,
// L5=500, L6=750, L7=1050, L8=1400, L9=1800, L10=2250).
// Weight classes are driven by LEVEL (two levels per class); the evolution
// web is the devil's build WITHIN its class. A challenger may fight their own
// class or one class up — never down, never two up.
const XP_TABLE = {
  houseWin: 30, houseLoss: 12, perShape: 2, shapeCap: 10,
  pit: { same: { win: 40, loss: 15 }, up: { win: 60, loss: 22 } },
  defenseHold: 6, defenseHoldDailyCap: 5
};
function xpForLevel(L) { return 25 * (L - 1) * L; }
function levelForXp(xp) { let L = 1; while (xpForLevel(L + 1) <= (xp || 0)) L++; return L; }
const CLASSES = ['Spark', 'Ember', 'Flare', 'Blaze', 'Inferno'];
function classIndexForLevel(L) { return Math.min(CLASSES.length - 1, Math.floor((L - 1) / 2)); }
function classOf(player) {
  const level = levelForXp((player && player.xp) || 0);
  const idx = classIndexForLevel(level);
  return { level, idx, name: CLASSES[idx] };
}
// Devil traits by class: MIRAGE from Flare up (class idx 2, level 5+);
// MORPH ARMOR at the top class only (Inferno, level 9+). Both are printed on
// the devil's card in the hall — no hidden mechanics (fairness law).
function devilTraits(player) {
  const c = classOf(player);
  return { mirage: c.idx >= 2, armor: c.idx >= 4, classIdx: c.idx, className: c.name, level: c.level };
}

// ---- Phase 3: Morph Armor (Pit devils of the top class) --------------------
// At 50% gate integrity the armor MORPHS once: the devil sheds 60% of its
// PERSONAL familiarity with the challenger's tools (the global crowd memory
// stays) and its strike rhythm re-seeds from the fight seed. Server-side,
// seeded, replay-verified — the client mirrors from the same dealt tables.
const MORPH = { trigger: 0.5, shedKeep: 0.4 };

// ---- Phase 3: the Pit economy ----------------------------------------------
// Bounties are HOUSE-MINTED: they grow +10/day unbeaten and +4 per hold,
// capped at 300, pay out whole to the breacher, and reset to 25 on a breach.
// The owner never loses points when their devil falls — record and pride
// only, and the devil learns the shapes that beat it.
// Bonus items are EARNED ONLY (never sold, never bought): Pit wins drop the
// item that counters the trait you beat (Mirror Wrap off Mirage devils,
// Anchor Stitch off Armored devils); plain devils drop rarely; a devil's
// hold occasionally earns its owner the item matching its own trait. A full
// stack converts a drop to +10 points. Stack cap: 9 per item.
const PIT = {
  attemptCap: 3,           // per challenger, per devil, per day
  bountyBase: 25, bountyMax: 300, bountyPerDay: 10, bountyPerHold: 4,
  itemCap: 9
};
// Drop rates (Steven, 2026-11-27: the Mirror Wrap is "a very rare one").
// The Wrap is treasure: 8% even off a Mirage devil you beat, 2% off a plain
// devil, 3% when your own Mirage devil holds. The Anchor Stitch is merely
// uncommon — Armor devils are top-class and rare fights already — 22% off an
// Armored devil, 5% plain, 6% on a hold. Both earned only, never sold.
const DROPS = {
  mirrorwrap:   { trait: 0.08, plain: 0.02, hold: 0.03 },
  anchorstitch: { trait: 0.22, plain: 0.05, hold: 0.06 },
  secondheart:  { trait: 0.06, plain: 0, hold: 0.10 }, // hold rate only on a hold streak of 5+
  stillbell:    { trait: 0.05, plain: 0, hold: 0 }     // trait rate only vs high-class (Blaze+) Mirage devils
};
// Rarity is DISPLAY (Steven, 2026-11-27): the Mirror Wrap is a LEGENDARY
// item and is labeled so — gold, everywhere it appears, with a banner and
// its own voice when it drops. LEGENDARY stays singular so the word keeps
// meaning something. The hard treasures are EPIC; the Founder's Ember has
// its own FOUNDER tier. No mechanics ride the tiers — except the Ember's
// documented +10% XP, printed wherever it shows.
const ITEMS = {
  foundersember: { name: "THE FOUNDER'S EMBER", trait: null, rarity: 'FOUNDER',
                  line: 'Granted to the first 100 claimed fighters, then never minted again. A keepsake with a gentle edge: +10% XP on its holder\u2019s fights, and the ember mark on their devil\u2019s card. Passive, permanent, never spent.' },
  mirrorwrap:   { name: 'THE MIRROR WRAP', trait: 'mirage', rarity: 'LEGENDARY',
                  line: 'Steven\u2019s own design: wrap your strike in a mirror and the Mirage has to look at itself. False wind-ups crack; phantom gates ring hollow.' },
  secondheart:  { name: 'THE SECOND HEART', trait: 'armor', rarity: 'EPIC',
                  line: 'Declared before a fight. The first time your integrity would hit zero, the Heart breaks instead — and you stand back up at 40. Unbroken Hearts return to your satchel.' },
  stillbell:    { name: 'THE STILLBELL', trait: 'mirage', rarity: 'EPIC',
                  line: 'Declared before a fight, rung from the deck when the trace climbs: for 12 seconds the trace cannot rise — cooling still runs. Unrung Bells return to your satchel.' },
  anchorstitch: { name: 'ANCHOR STITCH', trait: 'armor', rarity: 'RARE',
                  line: 'One tool, stitched to your hand before the fight. When the armor morphs and sheds what it knew of you, this one lesson stays sewn in.' }
};
const HEART_RESTORE = 40;      // integrity the Second Heart hands back when it breaks
const BELL_FREEZE_MS = 12000;  // Stillbell: trace cannot rise this long; cooling still runs
const FOUNDER_CAP = 100;       // Founder's Embers: first 100 claimed members, then never again
const FOUNDER_XP_MULT = 1.1;   // the Ember's gentle edge: +10% XP on its holder's fights
// ---- Numbered, signed editions (Steven, 2026-11-27) ------------------------
// Every item instance is a numbered edition: a serial per item type, minted
// sequentially, unique forever, and signed by the Keeper. Held items live in
// player.itemStock (serial arrays); player.itemHistory keeps the provenance
// of every piece a fighter has ever held — spent ones included, marked with
// what they were spent against. Numbers are never reused.
const KEEPER_SIGNATURE = 'signed \u00B7 the Keeper of the Arena';
function mintItem(state, player, itemId, how) {
  state.itemsSeq = state.itemsSeq || { mirrorwrap: 0, anchorstitch: 0 };
  const serial = (state.itemsSeq[itemId] || 0) + 1;
  state.itemsSeq[itemId] = serial;
  player.itemStock = player.itemStock || { mirrorwrap: [], anchorstitch: [] };
  player.itemStock[itemId] = player.itemStock[itemId] || [];
  player.itemStock[itemId].push(serial);
  player.itemHistory = player.itemHistory || [];
  player.itemHistory.unshift({ item: itemId, serial, how: how || 'drop', at: Date.now(), spent: false, spentAt: null, spentVs: null });
  return serial;
}
function itemCount(player, itemId) {
  return (player.itemStock && player.itemStock[itemId]) ? player.itemStock[itemId].length : 0;
}
// Spend the oldest held piece (first minted, first spent). Returns its serial.
function spendItem(player, itemId, vsName) {
  if (itemCount(player, itemId) < 1) return null;
  const serial = player.itemStock[itemId].shift();
  const rec = (player.itemHistory || []).find(h => h.item === itemId && h.serial === serial);
  if (rec) { rec.spent = true; rec.spentAt = Date.now(); rec.spentVs = vsName || null; }
  return serial;
}
function refundItem(player, itemId, serial) {
  if (serial == null) return;
  player.itemStock = player.itemStock || { mirrorwrap: [], anchorstitch: [] };
  player.itemStock[itemId] = player.itemStock[itemId] || [];
  if (!player.itemStock[itemId].includes(serial)) {
    player.itemStock[itemId].push(serial);
    player.itemStock[itemId].sort((a, b) => a - b);
  }
  const rec = (player.itemHistory || []).find(h => h.item === itemId && h.serial === serial);
  if (rec) { rec.spent = false; rec.spentAt = null; rec.spentVs = null; }
}
// THE KEEPER'S SET: the owner fighter holds one of every item — the master
// set, numbered and signed like the rest, and just as spendable (no admin
// infinity; the fairness law binds the Keeper too). Granted once, at the
// moment the owner fighter exists; on a fresh world those are serial No. 1
// of each type, because the grant runs before any drop can settle.
function grantKeeperSet(state, owner) {
  if (!owner || state.keeperSetGranted) return false;
  state.keeperSetGranted = true;
  for (const itemId of Object.keys(ITEMS)) {
    if (itemId === 'foundersember') { grantFounderEmber(state, owner); continue; }
    mintItem(state, owner, itemId, 'keeper-set');
  }
  return true;
}
// THE FOUNDER'S EMBER: the first 100 claimed member profiles, in signup
// order — the Keeper is No. 1 (his set grant runs before any other grant).
// Idempotent (a re-login never re-grants) and closed forever at the cap.
// The grant path is synchronous inside the signup/claim handlers, so two
// signups can never both take the same number.
function grantFounderEmber(state, player) {
  if (!player) return null;
  if ((player.itemHistory || []).some(h => h.item === 'foundersember')) return null;
  state.itemsSeq = state.itemsSeq || {};
  if ((state.itemsSeq.foundersember || 0) >= FOUNDER_CAP) return null;
  return mintItem(state, player, 'foundersember', 'founder');
}
function founderSerial(player) {
  const rec = (player && player.itemHistory || []).find(h => h.item === 'foundersember');
  return rec ? rec.serial : null;
}

function dayKey(ts) { return new Date(ts || Date.now()).toISOString().slice(0, 10); }
function bountyNow(owner, now) {
  const d = (owner && owner.devil) || {};
  let b = typeof d.bounty === 'number' ? d.bounty : PIT.bountyBase;
  const days = Math.max(0, Math.round((Date.parse(dayKey(now)) - Date.parse(d.bountyDay || dayKey(now))) / 86400000));
  return Math.min(PIT.bountyMax, b + days * PIT.bountyPerDay);
}

// Evolution web — attacker branches, 12 nodes, 3 tiers each.
const NODES = [
  { id: 'vec1', branch: 'Vectors',   tier: 1, cost: 30,  name: 'Sharper Probes',  desc: 'Probe damage +35%.' },
  { id: 'vec2', branch: 'Vectors',   tier: 2, cost: 60,  name: 'Heavy Flood',     desc: 'Flood damage +30%.' },
  { id: 'vec3', branch: 'Vectors',   tier: 3, cost: 110, name: 'Deep Kit',        desc: 'All tool damage +12%.' },
  { id: 'dec1', branch: 'Deception', tier: 1, cost: 30,  name: 'False Echoes',    desc: 'The Twin learns 30% less from your fights.' },
  { id: 'dec2', branch: 'Deception', tier: 2, cost: 60,  name: 'Ghost Hands',     desc: 'Your own familiarity counts 25% less against you.' },
  { id: 'dec3', branch: 'Deception', tier: 3, cost: 110, name: 'Phantom Choir',   desc: 'Decoy\u2019s next-strike bonus rises to +90%.' },
  { id: 'pat1', branch: 'Patience',  tier: 1, cost: 30,  name: 'Slow Burn',       desc: 'Whisper damage and burn +30%.' },
  { id: 'pat2', branch: 'Patience',  tier: 2, cost: 60,  name: 'Smolder',         desc: 'The gate heals 20% slower against you, always.' },
  { id: 'pat3', branch: 'Patience',  tier: 3, cost: 110, name: 'Long Game',       desc: 'Your rounds last +25 seconds.' },
  { id: 'spd1', branch: 'Speed',     tier: 1, cost: 30,  name: 'Quick Fingers',   desc: 'All cooldowns 15% shorter.' },
  { id: 'spd2', branch: 'Speed',     tier: 2, cost: 60,  name: 'Surge',           desc: 'Energy returns 30% faster.' },
  { id: 'spd3', branch: 'Speed',     tier: 3, cost: 110, name: 'Overclock',       desc: 'Cooldowns 15% shorter again, and +20 max energy.' }
];
const NODE_BY_ID = Object.fromEntries(NODES.map(n => [n.id, n]));

function has(player, id) { return !!(player && player.nodes && player.nodes[id]); }

// ---- Familiarity / decay -------------------------------------------------
// How well the Twin knows a tool = global pattern memory + a personal memory,
// weighted. Returns 0..0.75. Damage multiplier = 1 - fam * 0.7. The personal
// memory is normally the fighter's own lessons (player.shapes); in the Pit
// the caller passes the DEVIL's memory of challengers (owner.devilShapes) as
// famShapes — the devil's familiarity is with shapes, not with one person.
// familiarityParts keeps the two halves separate because Morph Armor sheds
// only the personal half.
function familiarityParts(state, player, tool, famShapes) {
  const g = (state.shapesGlobal['tool:' + tool] || 0);
  let p = famShapes ? (famShapes['tool:' + tool] || 0)
    : (player && player.shapes ? (player.shapes['tool:' + tool] || 0) : 0);
  if (has(player, 'dec2')) p = p * 0.75;
  const ls = state.config.learningSpeed || 1;
  return { global: g * 0.004 * ls, personal: p * 0.03 * ls };
}
function familiarity(state, player, tool) {
  const parts = familiarityParts(state, player, tool, null);
  return Math.min(0.75, parts.global + parts.personal);
}

// ---- Effective stats for one fighter entering a fight --------------------
// armorMap: tool -> 0..0.5 hardening (personal grudge armor, or the challenge
// owner's armor when fighting someone else's Twin).
// opts (Pit fights): famShapes replaces the fighter's own lessons as the
// personal familiarity memory (the devil's memory); morph deals the
// post-morph damage table (familiarity shed) for Armored devils, with
// stitchTool exempted by an Anchor Stitch.
function effectiveStats(state, player, armorMap, opts) {
  opts = opts || {};
  const tools = {};
  const mults = {}, multsPost = {};
  // THE DESCENT's loot, worn: gear modifies the dealt stats here, server-side,
  // so the referee validates geared fights exactly like any other — and the
  // same build rides into house fights and the Pit (it IS the fighter's build).
  const gear = wornGearMap(player);
  const bodyMods = gear.body ? gearMods(gear.body) : null;
  for (const id of TOOL_IDS) {
    const t = TOOLS[id];
    let dmg = t.dmg, dot = t.dot || 0, cd = t.cooldown, cost = t.cost;
    if (id === 'probe' && has(player, 'vec1')) dmg *= 1.35;
    if (id === 'flood' && has(player, 'vec2')) dmg *= 1.30;
    if (id === 'whisper' && has(player, 'pat1')) { dmg *= 1.30; dot *= 1.30; }
    if (has(player, 'vec3')) { dmg *= 1.12; dot *= 1.12; }
    if (has(player, 'spd1')) cd *= 0.85;
    if (has(player, 'spd3')) cd *= 0.85;
    if (bodyMods && bodyMods.cheap) cost = Math.max(1, Math.round(cost * (1 - bodyMods.cheap)));
    const parts = familiarityParts(state, player, id, opts.famShapes || null);
    const worn = gear[id] || null;
    if (worn && id === 'probe') {
      // A Probe lens that dulls the lesson: personal familiarity grows slower.
      const fs = affixValue(worn, 'famshield');
      if (fs) parts.personal *= (1 - fs);
    }
    // The Descent's Twin learns your BUILD: opts.buildFam adds raw familiarity
    // against specific tools (a career habit, a LEGENDARY on your hand).
    const fam = Math.min(0.75, parts.global + parts.personal + ((opts.buildFam && opts.buildFam[id]) || 0));
    const armor = Math.min(0.5, (armorMap && armorMap[id]) || 0);
    const globalArmor = Math.min(0.2, state.globalArmor[id] || 0);
    const mult = (1 - fam * 0.7) * (1 - armor) * (1 - globalArmor);
    mults[id] = mult;
    const entry = {
      name: t.name, cost, cooldown: Math.round(cd),
      dmg: +(dmg * mult).toFixed(2), rawDmg: +dmg.toFixed(2),
      dot: +(dot * mult).toFixed(2), dotSecs: t.dotSecs || 0,
      // FLOODGATES (deck toggle): trace gains are halved, dealt into the
      // stats here so the referee and the client's own HUD read the same
      // halved costs — one truth, server-side. (A Decoy's dump is not a
      // gain and is never halved.)
      trace: t.trace > 0 && state.config.floodgates ? t.trace / 2 : t.trace,
      familiarity: +fam.toFixed(3), armor: +(armor + globalArmor).toFixed(3),
      color: t.color, blurb: t.blurb
    };
    if (opts.morph) {
      // Post-morph table: the personal familiarity sheds to MORPH.shedKeep —
      // except the Anchor-Stitched tool, whose lesson stays sewn in.
      const keep = opts.stitchTool === id ? 1 : MORPH.shedKeep;
      const famPost = Math.min(0.75, parts.global + parts.personal * keep);
      const multPost = (1 - famPost * 0.7) * (1 - armor) * (1 - globalArmor);
      multsPost[id] = multPost;
      entry.dmgMorph = +(dmg * multPost).toFixed(2);
      entry.dotMorph = +(dot * multPost).toFixed(2);
      entry.famMorph = +famPost.toFixed(3);
    }
    if (worn) {
      // Worn gear, applied to the dealt entry. Percentages ride the same
      // familiarity/armor math as everything else; flat fields (splash,
      // trace burn, mark length) are read by the referee directly.
      const m = gearMods(worn);
      if (m.dmg) {
        entry.dmg = +(entry.dmg * (1 + m.dmg)).toFixed(2);
        entry.rawDmg = +(entry.rawDmg * (1 + m.dmg)).toFixed(2);
        if (entry.dmgMorph !== undefined) entry.dmgMorph = +(entry.dmgMorph * (1 + m.dmg)).toFixed(2);
      }
      if (m.dot) {
        entry.dot = +(entry.dot * (1 + m.dot)).toFixed(2);
        if (entry.dotMorph !== undefined) entry.dotMorph = +(entry.dotMorph * (1 + m.dot)).toFixed(2);
      }
      if (m.graveChoir && id === 'whisper') {
        entry.dot = +(entry.dot * 1.6).toFixed(2);
        if (entry.dotMorph !== undefined) entry.dotMorph = +(entry.dotMorph * 1.6).toFixed(2);
        entry.dotSecs = (entry.dotSecs || 0) + 2;
      }
      if (m.cd) entry.cooldown = Math.max(200, Math.round(entry.cooldown * (1 - m.cd)));
      if (m.tracecut) entry.trace = Math.max(1, entry.trace - m.tracecut);
      if (m.splash) entry.splash = m.splash;
      if (m.mark) entry.markMs = Math.round(4000 * (1 + m.mark));
      if (m.traceburn) entry.traceBurn = m.traceburn;
      if (m.shed && id === 'decoy') entry.trace = entry.trace - m.shed;
      if (m.silent) entry.silent = true;
      if (m.twoEyes) entry.twoEyes = true;
      if (m.secondGhost) entry.ghostStrike = 8;
      if (m.ignite) entry.ignite = { dps: 1.5, secs: 4 };
      entry.gear = { name: worn.name, tier: worn.tier, unique: worn.unique || null };
    }
    // FITTED MODS (v1): socketed at the satchel, dealt here like gear — the
    // referee enforces exactly these numbers and no others.
    const fm = fittedMod(player, id);
    if (fm) {
      entry.mod = { id: fm, name: FITTED_MODS[fm].name, sigil: FITTED_MODS[fm].sigil, color: FITTED_MODS[fm].color };
      if (fm === 'throughline') { entry.markMs = Math.round((entry.markMs || 4000) * MOD_NUMBERS.markMult); entry.markThroughDecoy = true; }
      if (fm === 'emberline') entry.modBurn = { dps: MOD_NUMBERS.floodBurnDps, secs: MOD_NUMBERS.floodBurnSecs };
      if (fm === 'ashenveil') entry.traceShed = (entry.traceShed || 0) + MOD_NUMBERS.whisperShed;
      if (fm === 'paybackcoil') entry.paybackCoil = true;
    }
    // THE CAPTOR'S PRIZE: a twinned tool strikes twice for the rest of the run.
    if (opts.twinTool === id) entry.twin = true;
    tools[id] = entry;
  }
  // Ability pods: only the abilities this fighter's web actually carries.
  const abilities = {};
  for (const aid of Object.keys(ABILITIES)) {
    const ab = ABILITIES[aid];
    if (!has(player, ab.node)) continue;
    const entry = { name: ab.name, cost: bodyMods && bodyMods.cheap ? Math.max(1, Math.round(ab.cost * (1 - bodyMods.cheap))) : ab.cost, cooldown: ab.cooldown, trace: ab.trace, color: ab.color, blurb: ab.blurb };
    if (aid === 'overdrive') {
      const raw = ab.dmg * (has(player, 'vec3') ? 1.12 : 1);
      entry.dmg = +(raw * mults.flood).toFixed(2);
      if (opts.morph) entry.dmgMorph = +(raw * multsPost.flood).toFixed(2);
    }
    if (aid === 'ghost') entry.charges = ab.charges;
    if (aid === 'secondwind') entry.heal = ab.heal;
    if (aid === 'rapid') entry.windowMs = ab.windowMs;
    abilities[aid] = entry;
  }
  const decoyLong = gear.decoy ? affixValue(gear.decoy, 'longlife') : 0;
  // The MOD RAIL, dealt: only the deployables this fighter OWNS ride the
  // fight, each with its charge count. The referee spends from this table —
  // a log that fires an undealt mod, or fires past its charges, is forged.
  const modsDeploy = {};
  if (player && player.modsOwned) {
    for (const mid of Object.keys(DEPLOY_MODS)) {
      if (player.modsOwned[mid]) {
        const d = DEPLOY_MODS[mid];
        modsDeploy[mid] = { name: d.name, sigil: d.sigil, color: d.color, charges: d.charges, line: d.line };
      }
    }
  }
  const modsFitted = {};
  for (const t of TOOL_IDS) { const fid = fittedMod(player, t); if (fid) modsFitted[t] = fid; }
  return {
    tools, abilities,
    mods: { fitted: modsFitted, deploy: modsDeploy },
    gateHp: opts.gateHp || GATE_HP,
    gateRegen: +(GATE_REGEN * effectiveAggression(state) * (has(player, 'pat2') ? 0.8 : 1)).toFixed(2),
    energyMax: ENERGY_MAX + (has(player, 'spd3') ? 20 : 0),
    energyRegen: +(ENERGY_REGEN * (has(player, 'spd2') ? 1.3 : 1)).toFixed(2),
    roundMs: opts.roundMs || (ROUND_MS + (has(player, 'pat3') ? 25000 : 0)),
    decoyCrit: (has(player, 'dec3') ? 0.9 : 0.6) + (decoyLong || 0),
    morph: opts.morph ? { shedKeep: MORPH.shedKeep, stitchTool: opts.stitchTool || null } : null,
    // THE CAPTOR (Descent boss depths): { tool, at } — the referee refuses
    // the seized tool from `at` on; the client mirrors the same snatch.
    seized: opts.seized || null,
    gear: gearSummary(gear),
    combat: {
      playerHp: PLAYER_HP + (bodyMods ? bodyMods.plating : 0),
      parryCost: PARRY.cost, parryCooldown: PARRY.cooldown,
      traceCool: +(TRACE_COOL + (bodyMods ? bodyMods.coolant : 0)).toFixed(2), traceMax: TRACE_MAX,
      windupMs: STRIKE.windupMs + (bodyMods ? bodyMods.parry : 0), vulnMs: STRIKE.vulnMs, vulnMult: STRIKE.vulnMult,
      scrambleMs: STRIKE.scrambleMs, strikeDmg: STRIKE.dmg
    }
  };
}

// ---- Pattern extraction ---------------------------------------------------
// A "shape" is a fingerprinted pattern: a tool alone, a consecutive pair, or
// a burst (3+ of one tool inside 4 seconds). Decoy dilutes: while a decoy is
// "up" (5s after use) patterns count half.
function extractPatterns(actions) {
  const counts = {};
  const add = (k, w) => { counts[k] = (counts[k] || 0) + w; };
  let decoyUntil = -1;
  // a parry is a reflex, not a shape — an ability is a stance, not a shape —
  // and a rung Stillbell is an item spent, not a shape either
  const acts = actions.filter(a => a.tool !== 'parry' && a.tool !== 'bell' && a.tool !== 'mercy' && !String(a.tool || '').startsWith('ability:') && !String(a.tool || '').startsWith('mod:'));
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (a.tool === 'decoy') decoyUntil = a.t + 5000;
    const w = a.t <= decoyUntil && a.tool !== 'decoy' ? 0.5 : 1;
    add('tool:' + a.tool, w);
    if (i > 0) add('pair:' + acts[i - 1].tool + '>' + a.tool, w);
  }
  // bursts
  for (const id of TOOL_IDS) {
    const times = acts.filter(a => a.tool === id).map(a => a.t);
    let run = 0;
    for (let i = 0; i < times.length; i++) {
      if (i > 0 && times[i] - times[i - 1] <= 4000) run++; else run = 1;
      if (run === 3) add('burst:' + id, 1);
    }
  }
  return counts;
}

// ---- The Twin's strike schedule -------------------------------------------
// Generated server-side at fight start from a seed, scaled by the deck's
// aggression dial, and handed to the client so haymakers can be telegraphed.
// Deterministic: the referee below replays against this exact schedule.
function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeStrikes(seed, roundMs, aggression) {
  const rnd = rng32(seed);
  const interval = STRIKE.baseMs / (aggression || 1);
  const strikes = [];
  let t = STRIKE.firstMs + (rnd() - 0.5) * 1200;
  let i = 0;
  while (t < roundMs - 1200 && strikes.length < 80) {
    const kind = STRIKE.cycle[i % STRIKE.cycle.length];
    const s = { at: Math.round(t), kind };
    if (kind === 'glance') s.tool = TOOL_IDS[Math.floor(rnd() * TOOL_IDS.length)];
    strikes.push(s);
    t += interval + (rnd() - 0.5) * 1600;
    i++;
  }
  return strikes;
}

// ---- The Pit: a devil's strike schedule ------------------------------------
// A devil fights with its OWNER's build and the owner's STYLE: the owner's
// career tool tally picks the strike cycle (a Flood hand throws haymakers, a
// Whisper hand glances, a Probe hand strikes faster, a Decoy hand feints its
// rhythm), and the owner's career parry rate becomes the devil's GUARD — its
// glances scramble a challenger's tools for longer. MIRAGE devils (Flare+)
// seed false wind-ups ('feint' strikes) into the same schedule — a feint is
// part of the server's dealt truth, so a client cannot invent or erase one.
// ARMORED devils (Inferno) carry a post-morph rhythm, dealt as offsets from
// the morph moment and re-seeded from the fight seed. All deterministic:
// same seed + same owner = same defense, every time.
function devilStyle(owner) {
  const tu = (owner && owner.toolUse) || {};
  let dominant = null, best = 0;
  for (const id of TOOL_IDS) { const n = tu[id] || 0; if (n > best) { best = n; dominant = id; } }
  let cycle = STRIKE.cycle, intervalMult = 1;
  if (dominant === 'flood') cycle = ['clean', 'haymaker', 'glance', 'haymaker'];
  else if (dominant === 'whisper') cycle = ['glance', 'clean', 'glance', 'haymaker'];
  else if (dominant === 'decoy') cycle = ['glance', 'clean', 'haymaker', 'clean'];
  else if (dominant === 'probe') intervalMult = 0.85;
  const bouts = Math.max(1, (owner && owner.record && owner.record.bouts) || 0);
  const guard = Math.min(0.5, (((owner && owner.parriesTotal) || 0) / bouts) / 4);
  return { dominant, cycle, intervalMult, guard };
}
function makeDevilStrikes(seed, roundMs, owner, aggression, traits) {
  const style = devilStyle(owner);
  const rnd = rng32(seed);
  const interval = (STRIKE.baseMs / (aggression || 1)) * style.intervalMult;
  const strikes = [];
  let t = STRIKE.firstMs + (rnd() - 0.5) * 1200;
  let i = 0;
  while (t < roundMs - 1200 && strikes.length < 80) {
    const kind = style.cycle[i % style.cycle.length];
    const s = { at: Math.round(t), kind };
    if (kind === 'glance') s.tool = TOOL_IDS[Math.floor(rnd() * TOOL_IDS.length)];
    strikes.push(s);
    t += interval + (rnd() - 0.5) * 1600;
    i++;
  }
  if (traits && traits.mirage) {
    // 2-4 feints, seeded, kept clear of real haymaker windows so a parry
    // claim can always be judged against exactly one telegraph.
    const want = 2 + Math.floor(rnd() * 3);
    let placed = 0;
    for (let attempt = 0; attempt < 60 && placed < want; attempt++) {
      const ft = 3000 + Math.floor(rnd() * Math.max(1000, roundMs - 6000));
      if (strikes.some(s => Math.abs(s.at - ft) < 1800)) continue;
      strikes.push({ at: ft, kind: 'feint' });
      placed++;
    }
    strikes.sort((a, b) => a.at - b.at);
  }
  let postMorph = null;
  if (traits && traits.armor) {
    const rnd2 = rng32((seed ^ 0x9e3779b9) >>> 0);
    postMorph = [];
    let off = 3500 + Math.floor(rnd2() * 1000);
    let j = 0;
    while (off < 70000 && postMorph.length < 12) {
      const kind = style.cycle[(j + 1) % style.cycle.length];
      const s = { offset: off, kind };
      if (kind === 'glance') s.tool = TOOL_IDS[Math.floor(rnd2() * TOOL_IDS.length)];
      postMorph.push(s);
      off += Math.round(interval + (rnd2() - 0.5) * 1600);
      j++;
    }
  }
  return { strikes, postMorph, style };
}

// ---- The referee: replay a submitted round ---------------------------------
// Mirrors the client's simulation exactly (same stats, same mark/crit/dot
// math) and adds what only the server knows: the strike schedule, integrity,
// and the trace. Returns { problem } for an implausible/forged log, else the
// true outcome and the round's vital signs. Outcomes: result 'win' with
// endReason 'breach', or 'lose' with 'integrity' (thrown out), 'trace'
// (caught), or no outcome at all (the clock decides — a timeout).
function simulateRound(fight, actions, durationMs) {
  const stats = fight.stats;
  if (!Array.isArray(actions) || actions.length === 0) return { problem: 'empty log' };
  if (actions.length > Math.ceil(durationMs / 150) + 10) return { problem: 'implausibly many actions' };
  let prevT = -1;
  for (const a of actions) {
    if (!a || typeof a.t !== 'number' || a.t < 0 || a.t > durationMs + 2000) return { problem: 'action outside round' };
    if (a.t < prevT) return { problem: 'actions out of order' };
    prevT = a.t;
  }
  const strikes = (fight.strikes || []).map(s => ({ at: s.at, kind: s.kind, tool: s.tool, parried: false, eaten: false }));
  const postMorph = (fight.postMorph || []).map(s => ({ offset: s.offset, kind: s.kind, tool: s.tool, parried: false, eaten: false }));
  const allStrikes = strikes.concat(postMorph);
  const morphCfg = stats.morph || null;
  const combat = stats.combat || {};
  const maxIntegrity = combat.playerHp || PLAYER_HP;
  const windupMs = combat.windupMs || STRIKE.windupMs;
  const traceCool = combat.traceCool || TRACE_COOL;
  const S = {
    energy: stats.energyMax, gateHp: stats.gateHp,
    // THE DESCENT: integrity and trace CARRY across a run — the server deals
    // the carried values into the dealt combat block, depth after depth.
    integrity: combat.startIntegrity != null ? combat.startIntegrity : maxIntegrity,
    trace: combat.startTrace || 0, tracePeak: combat.startTrace || 0,
    markUntil: -1, markCharges: 0, critNext: 0,
    lastUse: {}, lastCd: {}, lockoutUntil: {}, dots: [],
    parries: 0, strikesTaken: 0, strikeDamage: 0, dmgTotal: 0, vulnBonus: 0,
    vulnFrom: -1, vulnUntil: -1, outcome: null,
    // Phase 3: abilities, combos, mirage, morph
    ghostCharges: 0, rapidUntil: -1, secondWindUsed: false,
    lastProbeAt: -1e9, lastDecoyAt: -1e9,
    combos: [], abilitiesUsed: [], parryWhiffs: 0,
    feintsShown: strikes.filter(s => s.kind === 'feint').length,
    morphed: false, morphAt: null, morphPending: false, morphCrossAt: 0,
    // Declared consumables — the server dealt these booleans from real
    // inventory at fight start; the referee enforces them like any claim.
    heartReady: !!fight.heart, heartUsed: false,
    bellReady: !!fight.bell, bellRung: false, bellUntil: -1,
    // GODFORGED declarations ride the fight the same way: dealt by the
    // server from a real charged treasure, enforced like any other claim.
    mercyUsed: false, dawnUsed: false,
    dawnReady: !!(fight.god && fight.god.power === 'seconddawn' && !fight.god.dawnUsed),
    // MODS v1: the rail's charge purse, the OVERCLOCK arm, the PAYBACK
    // COIL's coil, and the GHOST PLATE's hidden feed (it discharges into
    // the first strike thrown after its window closes — never before).
    modCharges: {}, modsUsed: [], overclockArmed: false,
    payback: 0, phantomUntil: -1, plateFed: 0, plateUntil: -1
  };
  const dealtDeploy = (stats.mods && stats.mods.deploy) || {};
  for (const mid of Object.keys(dealtDeploy)) S.modCharges[mid] = dealtDeploy[mid].charges || 0;
  // Flat strike bonus waiting in the fighter's hands: the Coil pays out on
  // the very next strike; the Plate only once its window has closed.
  function strikeBonus(t) {
    let b = S.payback || 0; S.payback = 0;
    if (S.plateFed > 0 && t >= S.plateUntil) { b += S.plateFed; S.plateFed = 0; }
    return b;
  }
  let cur = 0;
  function noteMorphCrossing() {
    if (morphCfg && !S.morphed && !S.morphPending && S.gateHp > 0 && S.gateHp <= stats.gateHp * MORPH.trigger) {
      S.morphPending = true; S.morphCrossAt = cur;
    }
  }
  function advance(to) {
    while (cur < to && !S.outcome) {
      const step = Math.min(50, to - cur), dt = step / 1000;
      cur += step;
      S.energy = Math.min(stats.energyMax, S.energy + stats.energyRegen * dt);
      let burning = false;
      S.dots = S.dots.filter(d => {
        if (cur <= d.until) { burning = true; S.gateHp -= d.dps * dt; return true; }
        return false;
      });
      if (!burning && S.gateHp > 0) S.gateHp = Math.min(stats.gateHp, S.gateHp + stats.gateRegen * dt);
      S.trace = Math.max(0, S.trace - traceCool * dt);
      if (S.gateHp <= 0) { S.gateHp = 0; S.outcome = { result: 'win', endReason: 'breach', at: Math.round(cur) }; }
      else noteMorphCrossing();
    }
  }
  function hearTrace(amount, t) {
    // THE STILLBELL: while it rings, the trace cannot rise. Cooling (in
    // advance) still runs — the Bell freezes the climb, not the fall.
    if (amount > 0 && S.bellRung && t < S.bellUntil) return false;
    S.trace = Math.min(TRACE_MAX, Math.max(0, S.trace + amount));
    if (S.trace > S.tracePeak) S.tracePeak = S.trace;
    if (S.trace >= TRACE_MAX) {
      // THE SECOND DAWN (GODFORGED): once per run, the catch does not take —
      // the Trace wipes clean and the fighter stands at half integrity.
      if (S.dawnReady && !S.dawnUsed) {
        S.dawnUsed = true; S.trace = 0;
        S.integrity = Math.max(S.integrity, Math.ceil(maxIntegrity / 2));
        return false;
      }
      S.outcome = { result: 'lose', endReason: 'trace', at: t }; return true;
    }
    return false;
  }
  function doAction(a) {
    const t = a.t;
    // ---- THE KEEPER'S MERCY (GODFORGED): declared or the claim is forged --
    if (a.tool === 'mercy') {
      const g = fight.god;
      if (!g || g.power !== 'keepersmercy' || g.mercyUsed) return 'mercy not declared';
      if (S.mercyUsed) return 'mercy already spent';
      S.mercyUsed = true;
      S.trace = 0;
      return null;
    }
    // ---- THE STILLBELL: rung from the deck, once, only if declared ----
    if (a.tool === 'bell') {
      if (!S.bellReady) return 'bell not declared';
      if (S.bellRung) return 'bell already rung';
      S.bellRung = true;
      S.bellUntil = t + BELL_FREEZE_MS;
      return null;
    }
    // ---- the MOD RAIL: dealt in the stats, charged, or the claim is forged ----
    if (typeof a.tool === 'string' && a.tool.startsWith('mod:')) {
      const id = a.tool.slice('mod:'.length);
      if (!dealtDeploy[id]) return 'mod not owned';
      if (!(S.modCharges[id] > 0)) return 'mod charges spent';
      S.modCharges[id]--;
      S.modsUsed.push(id);
      if (id === 'overclock') { S.overclockArmed = true; return null; }
      if (id === 'tracepurge') { S.trace = Math.max(0, S.trace - MOD_NUMBERS.purgeAmount); return null; }
      if (id === 'ghostplate') { S.plateUntil = t + MOD_NUMBERS.plateMs; return null; }
      if (id === 'coldsnap') {
        // Freeze the rhythm: the next strike on the dealt schedule lands
        // late. The event tail re-sorts; a strike pushed past the round's
        // limit simply never lands — the strongest thing a Snap can do,
        // and it costs a charge either way. No strike left (a Vault's
        // silence) means the Snap spends itself on nothing.
        for (let i = ei; i < events.length; i++) {
          if (events[i].type !== 'strike') continue;
          events[i].t += MOD_NUMBERS.coldsnapMs;
          events[i].s.at += MOD_NUMBERS.coldsnapMs;
          const tail = events.splice(ei);
          tail.sort((x, y) => x.t - y.t || (x.type === 'action' ? -1 : 1));
          for (const e of tail) events.push(e);
          break;
        }
        return null;
      }
      return 'unknown mod';
    }
    // ---- ability pods: dealt in the stats, owned or the claim is forged ----
    if (typeof a.tool === 'string' && a.tool.startsWith('ability:')) {
      const id = a.tool.slice('ability:'.length);
      const ab = stats.abilities && stats.abilities[id];
      if (!ab) return 'ability not owned';
      if (id === 'secondwind' && S.secondWindUsed) return 'second wind already spent';
      if (S.lastUse[a.tool] !== undefined && t - S.lastUse[a.tool] < ab.cooldown * 0.8) return 'cooldown violated';
      S.energy -= ab.cost;
      if (S.energy < -12) return 'energy overdrawn';
      S.lastUse[a.tool] = t;
      S.abilitiesUsed.push(id);
      if (hearTrace(ab.trace || 0, t)) return null;
      if (id === 'ghost') { S.ghostCharges = ab.charges || 3; return null; }
      if (id === 'secondwind') {
        S.secondWindUsed = true;
        S.integrity = Math.min(maxIntegrity, S.integrity + (ab.heal || 30));
        return null;
      }
      if (id === 'rapid') { S.rapidUntil = t + (ab.windowMs || 8000); return null; }
      if (id === 'overdrive') {
        // OVERDRIVE is a Flood strike wearing a bigger coat: if the Captor
        // holds your Flood, he holds this too.
        if (stats.seized && stats.seized.tool === 'flood' && t >= stats.seized.at) return 'tool seized';
        let dmg = (S.morphed && ab.dmgMorph !== undefined) ? ab.dmgMorph : ab.dmg;
        if (S.critNext > 0) { dmg *= (1 + S.critNext); S.critNext = 0; }
        if (t >= S.vulnFrom && t <= S.vulnUntil) {
          const bonus = dmg * (STRIKE.vulnMult - 1);
          S.vulnBonus += bonus; dmg += bonus;
          if (!S.combos.includes('open-window')) S.combos.push('open-window');
        }
        const coilBonus = strikeBonus(t);
        if (coilBonus) dmg += coilBonus;
        S.gateHp -= dmg;
        S.dmgTotal += dmg;
        if (S.gateHp <= 0) { S.gateHp = 0; S.outcome = { result: 'win', endReason: 'breach', at: t }; }
        else noteMorphCrossing();
        return null;
      }
      return 'unknown ability';
    }
    if (a.tool === 'parry') {
      if (S.lastUse.parry !== undefined && t - S.lastUse.parry < PARRY.cooldown * 0.8) return 'cooldown violated';
      S.energy -= PARRY.cost;
      if (S.energy < -12) return 'energy overdrawn';
      S.lastUse.parry = t;
      const inWindow = s => !s.parried && !s.eaten && s.at !== undefined &&
        t >= s.at - windupMs && t <= s.at;
      const target = allStrikes.find(s => s.kind === 'haymaker' && inWindow(s));
      if (target) { target.parried = true; S.parries++; return null; }
      // MIRAGE: a parry thrown at a FEINT's telegraph is legal — and wasted.
      // The phantom eats the reflex; no window opens. A parry claimed where
      // no telegraph of either kind stood is still a forgery.
      const feint = strikes.find(s => s.kind === 'feint' && !s.parried && !s.eaten &&
        t >= s.at - windupMs && t <= s.at);
      if (feint) { feint.parried = true; S.parryWhiffs++; return null; }
      return 'parry outside its window';
    }
    const tool = stats.tools[a.tool];
    if (!tool) return 'unknown tool';
    // THE CAPTOR'S SEIZURE: from the dealt moment on, the tool is in his
    // hands, not yours. A log that swings it anyway is a forgery.
    if (stats.seized && a.tool === stats.seized.tool && t >= stats.seized.at) return 'tool seized';
    if (S.lastUse[a.tool] !== undefined) {
      const cdInForce = S.lastCd[a.tool] !== undefined ? S.lastCd[a.tool] : tool.cooldown;
      if (t - S.lastUse[a.tool] < cdInForce * 0.8) return 'cooldown violated';
    }
    if (S.lockoutUntil[a.tool] && t < S.lockoutUntil[a.tool] - 300) return 'cooldown scrambled';
    S.energy -= tool.cost;
    if (S.energy < -12) return 'energy overdrawn';
    S.lastUse[a.tool] = t;
    // RAPID CYCLING: a use made inside the window halves its own cooldown.
    S.lastCd[a.tool] = t <= S.rapidUntil ? tool.cooldown * 0.5 : tool.cooldown;
    // OVERCLOCK (mod rail): the armed strike resolves hasted — its own
    // cooldown halves again, and the arm is spent.
    if (S.overclockArmed) { S.lastCd[a.tool] *= 0.5; S.overclockArmed = false; }
    // The trace hears everything — unless GHOST is walking (3 strikes free).
    let traceAdd = tool.trace || 0;
    if (traceAdd > 0 && S.ghostCharges > 0) { traceAdd = 0; S.ghostCharges--; }
    if (hearTrace(traceAdd, t)) return null;
    if (a.tool === 'decoy') {
      S.critNext = stats.decoyCrit;
      S.lastDecoyAt = t;
      // PAYBACK COIL (fitted): the phantom stands for 5s and drinks blows.
      if (tool.paybackCoil) S.phantomUntil = t + MOD_NUMBERS.phantomMs;
      // THROUGHLINE (fitted): the mark goes through the Decoy — a live mark
      // (or one just faded) is re-threaded at full length instead of lost.
      if (S.markCharges > 0 && stats.tools.probe && stats.tools.probe.markThroughDecoy &&
          t <= S.markUntil + 2500) {
        S.markUntil = t + (stats.tools.probe.markMs || 4000);
      }
      // Burned defensively during a wind-up, a decoy eats the strike whole.
      const pending = allStrikes.find(s => s.kind === 'haymaker' && !s.parried && !s.eaten &&
        s.at !== undefined && t >= s.at - windupMs && t <= s.at);
      if (pending) pending.eaten = true;
      // THE SECOND GHOST (a LEGENDARY decoy's unique power): before it
      // fades, the decoy strikes once — a real hit, dealt in the stats.
      if (tool.ghostStrike) {
        S.gateHp -= tool.ghostStrike;
        S.dmgTotal += tool.ghostStrike;
        if (S.gateHp <= 0) { S.gateHp = 0; S.outcome = { result: 'win', endReason: 'breach', at: t }; }
        else noteMorphCrossing();
      }
      // A TWINNED decoy dumps its trace twice — the Captor's prize, doubled.
      if (!S.outcome && tool.twin) { if (hearTrace(tool.trace || 0, t)) return null; }
      return null;
    }
    let dmg = (S.morphed && tool.dmgMorph !== undefined) ? tool.dmgMorph : tool.dmg;
    if (S.critNext > 0) { dmg *= (1 + S.critNext); S.critNext = 0; }
    if (a.tool === 'flood' && t - S.lastProbeAt <= COMBO.markDrownMs) {
      // MARK & DROWN: the combo pays +50% and eats the mark.
      dmg *= COMBO.markDrownMult; S.markUntil = -1; S.markCharges = 0;
      if (!S.combos.includes('mark-drown')) S.combos.push('mark-drown');
    } else if (a.tool !== 'probe' && t < S.markUntil) {
      dmg *= 1.3;
      // TWO EYES (a LEGENDARY probe's unique power): the mark covers two
      // strikes, not one — charges dealt in the stats, spent one at a time.
      if (--S.markCharges <= 0) S.markUntil = -1;
    }
    if (a.tool === 'probe') {
      S.markUntil = t + (tool.markMs || 4000);
      S.markCharges = tool.twoEyes ? 2 : 1;
      S.lastProbeAt = t;
    }
    if (t >= S.vulnFrom && t <= S.vulnUntil) {
      const bonus = dmg * (STRIKE.vulnMult - 1);
      S.vulnBonus += bonus; dmg += bonus;
      if (!S.combos.includes('open-window')) S.combos.push('open-window');
    }
    // The Coil and the Plate pay out here — flat weight on the strike,
    // outside every multiplier, exactly as the client mirrors it.
    const coilBonus = strikeBonus(t);
    if (coilBonus) dmg += coilBonus;
    S.gateHp -= dmg;
    S.dmgTotal += dmg;
    if (a.tool === 'whisper') {
      const dps = (S.morphed && tool.dotMorph !== undefined) ? tool.dotMorph : tool.dot;
      S.dots.push({ until: t + (tool.dotSecs || 0) * 1000, dps });
      // A geared Whisper burns trace off the books as it lands.
      if (tool.traceBurn) S.trace = Math.max(0, S.trace - tool.traceBurn);
      // ASHEN VEIL (fitted): the strike sheds its trace into the ash.
      if (tool.traceShed) S.trace = Math.max(0, S.trace - tool.traceShed);
      // COLD TRAIL: a Whisper on a fresh Decoy's heels dumps trace too.
      if (t - S.lastDecoyAt <= COMBO.coldTrailMs) {
        S.trace = Math.max(0, S.trace - COMBO.coldTrailDump);
        if (!S.combos.includes('cold-trail')) S.combos.push('cold-trail');
      }
    }
    // EMBERBRAND (a LEGENDARY flood's unique power): the strike ignites.
    if (a.tool === 'flood' && tool.ignite) {
      S.dots.push({ until: t + tool.ignite.secs * 1000, dps: tool.ignite.dps });
    }
    // EMBERLINE (fitted): the strike lays a slower ember of its own. Like
    // the ignite, the twinned second strike does not re-lay it.
    if (a.tool === 'flood' && tool.modBurn) {
      S.dots.push({ until: t + tool.modBurn.secs * 1000, dps: tool.modBurn.dps });
    }
    // A geared Flood splashes onto a second shape as it lands.
    if (a.tool === 'flood' && tool.splash) { S.gateHp -= tool.splash; S.dmgTotal += tool.splash; }
    if (S.gateHp <= 0) { S.gateHp = 0; S.outcome = { result: 'win', endReason: 'breach', at: t }; }
    else noteMorphCrossing();
    if (!S.outcome && tool.twin) {
      // TWINNED (the Captor's prize, won back): the strike lands a second
      // time — full base damage, and the trace hears it too. Double
      // everything: damage, burn, and the lesson the Twin takes home.
      let dmg2 = (S.morphed && tool.dmgMorph !== undefined) ? tool.dmgMorph : tool.dmg;
      S.gateHp -= dmg2;
      S.dmgTotal += dmg2;
      if (a.tool === 'whisper') {
        const dps2 = (S.morphed && tool.dotMorph !== undefined) ? tool.dotMorph : tool.dot;
        S.dots.push({ until: t + (tool.dotSecs || 0) * 1000, dps: dps2 });
      }
      if (a.tool === 'flood' && tool.splash) { S.gateHp -= tool.splash; S.dmgTotal += tool.splash; }
      if (S.gateHp <= 0) { S.gateHp = 0; S.outcome = { result: 'win', endReason: 'breach', at: t }; }
      else noteMorphCrossing();
      if (!S.outcome && hearTrace(tool.trace || 0, t)) return null;
    }
    return null;
  }
  function doStrike(s, t) {
    if (s.kind === 'feint') return; // MIRAGE: the wind-up was a lie; nothing lands
    if (s.kind === 'haymaker') {
      if (s.parried) { S.vulnFrom = t; S.vulnUntil = t + STRIKE.vulnMs; return; }
      if (s.eaten) return;
      S.integrity -= STRIKE.dmg.haymaker; S.strikesTaken++; S.strikeDamage += STRIKE.dmg.haymaker;
    } else if (s.kind === 'glance') {
      S.integrity -= STRIKE.dmg.glance; S.strikesTaken++; S.strikeDamage += STRIKE.dmg.glance;
      const tool = stats.tools[s.tool] ? s.tool : 'probe';
      // SILENT (a geared Whisper's affix): a glance cannot scramble what it
      // cannot hear. The integrity cost still lands — only the lockout dies.
      if (!(stats.tools[tool] && stats.tools[tool].silent)) {
        const ready = S.lastUse[tool] !== undefined ? S.lastUse[tool] + stats.tools[tool].cooldown : t;
        // A devil's GUARD (its owner's parry habits) stretches the scramble —
        // the duration rides the dealt stats, never a constant.
        const scrMs = (stats.combat && stats.combat.scrambleMs) || STRIKE.scrambleMs;
        S.lockoutUntil[tool] = Math.max(ready, t) + scrMs;
      }
    } else {
      S.integrity -= STRIKE.dmg.clean; S.strikesTaken++; S.strikeDamage += STRIKE.dmg.clean;
    }
    // MODS drink the blow: the GHOST PLATE feeds on any strike inside its
    // window (half the weight, capped); the PAYBACK COIL feeds on strikes
    // that land while the phantom stands (a quarter, capped smaller).
    const blow = s.kind === 'haymaker' ? STRIKE.dmg.haymaker
      : s.kind === 'glance' ? STRIKE.dmg.glance : STRIKE.dmg.clean;
    if (t < S.plateUntil) S.plateFed = Math.min(MOD_NUMBERS.plateCap, S.plateFed + blow * MOD_NUMBERS.plateRate);
    if (S.phantomUntil > 0 && t < S.phantomUntil) S.payback = Math.min(MOD_NUMBERS.paybackCap, S.payback + blow * MOD_NUMBERS.paybackRate);
    if (S.integrity <= 0) {
      // THE SECOND HEART: the first zeroing blow breaks the Heart instead —
      // the fighter stands back up at HEART_RESTORE and the fight goes on.
      if (S.heartReady && !S.heartUsed) { S.heartUsed = true; S.integrity = HEART_RESTORE; }
      // THE SECOND DAWN (GODFORGED): once per run, death itself is refused —
      // half integrity, Trace wiped clean.
      else if (S.dawnReady && !S.dawnUsed) { S.dawnUsed = true; S.integrity = Math.ceil(maxIntegrity / 2); S.trace = 0; }
      else { S.integrity = 0; S.outcome = { result: 'lose', endReason: 'integrity', at: t }; }
    }
  }
  let events = [];
  actions.forEach(a => events.push({ t: a.t, type: 'action', a }));
  strikes.forEach(s => events.push({ t: s.at, type: 'strike', s }));
  events.sort((x, y) => x.t - y.t || (x.type === 'action' ? -1 : 1));
  let ei = 0;
  // MORPH ARMOR: at the crossing, un-fired strikes are discarded and the
  // re-seeded rhythm (dealt as offsets) takes over from the crossing moment.
  function applyMorph() {
    S.morphed = true; S.morphAt = Math.round(S.morphCrossAt); S.morphPending = false;
    const rest = events.slice(ei).filter(e => e.type !== 'strike');
    for (const s of postMorph) {
      s.at = S.morphCrossAt + s.offset;
      rest.push({ t: s.at, type: 'strike', s });
    }
    rest.sort((x, y) => x.t - y.t || (x.type === 'action' ? -1 : 1));
    events = events.slice(0, ei).concat(rest);
  }
  const limit = Math.min(durationMs, stats.roundMs + 2000);
  while (ei < events.length) {
    const ev = events[ei++];
    if (S.outcome) break;
    if (ev.t > limit) break;
    advance(ev.t);
    if (S.morphPending && !S.morphed) applyMorph();
    if (S.outcome) break;
    if (ev.type === 'action') {
      const problem = doAction(ev.a);
      if (problem) return { problem };
    } else {
      doStrike(ev.s, ev.t);
    }
    if (S.morphPending && !S.morphed) applyMorph();
  }
  if (!S.outcome) advance(limit);
  if (S.morphPending && !S.morphed) applyMorph();
  return {
    problem: null,
    outcome: S.outcome,
    integrityLeft: Math.max(0, Math.round(S.integrity)),
    trace: Math.round(S.trace), tracePeak: Math.round(S.tracePeak),
    gateHp: Math.max(0, +S.gateHp.toFixed(2)),
    damagePct: Math.max(0, Math.min(100, Math.round((1 - S.gateHp / stats.gateHp) * 100))),
    parries: S.parries, strikesTaken: S.strikesTaken, strikeDamage: S.strikeDamage,
    dmgTotal: +S.dmgTotal.toFixed(2), vulnBonus: +S.vulnBonus.toFixed(2),
    combos: S.combos, abilitiesUsed: S.abilitiesUsed, modsUsed: S.modsUsed, parryWhiffs: S.parryWhiffs,
    feintsShown: S.feintsShown, morphed: S.morphed, morphAt: S.morphAt,
    heartUsed: S.heartUsed, bellRung: S.bellRung,
    mercyUsed: S.mercyUsed, dawnUsed: S.dawnUsed
  };
}

// Back-compat wrapper: Phase 1's plausibility check, now a thin skin over the
// referee with no Twin striking back.
function validateLog(stats, actions, durationMs) {
  const sim = simulateRound({ stats, strikes: [] }, actions, durationMs);
  return sim.problem || null;
}

// ---- Settle a finished fight ----------------------------------------------
// Mutates state + player. Returns the verdict object.
function settleFight(state, player, fight, submission) {
  const { actions, result, endReason, durationMs, damagePct, fightStats } = submission;
  const stats = fight.stats;
  const patterns = extractPatterns(actions);
  const learnMult = (has(player, 'dec1') ? 0.7 : 1) * (state.config.learningSpeed || 1);

  const newToWorld = [], newToPlayer = [];
  for (const k of Object.keys(patterns)) {
    if (!state.shapesGlobal[k]) newToWorld.push(k);
    if (!player.shapes[k]) newToPlayer.push(k);
    state.shapesGlobal[k] = (state.shapesGlobal[k] || 0) + patterns[k] * learnMult;
    player.shapes[k] = (player.shapes[k] || 0) + patterns[k] * learnMult;
  }

  // Counter-evolution: the Twin armors against this fighter's favorite tools.
  const toolUse = {};
  for (const a of actions) if (a.tool !== 'parry' && a.tool !== 'bell' && !String(a.tool || '').startsWith('ability:') && !String(a.tool || '').startsWith('mod:')) toolUse[a.tool] = (toolUse[a.tool] || 0) + 1;
  // Career tallies: a devil's style and guard are built from these.
  player.toolUse = player.toolUse || {};
  for (const [tool, n] of Object.entries(toolUse)) player.toolUse[tool] = (player.toolUse[tool] || 0) + n;
  if (fightStats && typeof fightStats.parries === 'number') {
    player.parriesTotal = (player.parriesTotal || 0) + fightStats.parries;
  }
  const ranked = Object.entries(toolUse).sort((a, b) => b[1] - a[1]);
  const armorGains = {};
  if (ranked[0]) armorGains[ranked[0][0]] = 0.05;
  if (ranked[1]) armorGains[ranked[1][0]] = 0.025;
  for (const [tool, gain] of Object.entries(armorGains)) {
    player.twinArmor[tool] = Math.min(0.45, (player.twinArmor[tool] || 0) + gain);
    state.globalArmor[tool] = Math.min(0.2, (state.globalArmor[tool] || 0) + 0.002);
  }

  // Points
  let points = 0;
  const secs = Math.max(1, Math.round(durationMs / 1000));
  if (result === 'win') {
    const timeBonus = Math.min(25, Math.round(Math.max(0, stats.roundMs - durationMs) / 1000 * 0.2));
    points = 35 + timeBonus;
  } else {
    points = 10 + Math.round(Math.min(100, Math.max(0, damagePct || 0)) * 0.1);
  }
  points += Math.min(15, newToPlayer.length * 3);
  // STORM: the whole verdict pays double — the multiplier was snapshotted
  // onto the fight at start, so the referee settles under the weather the
  // round was actually fought in.
  if (fight.pointsMult && fight.pointsMult !== 1) points = Math.round(points * fight.pointsMult);
  player.points += points;

  // Record
  player.record.bouts += 1;
  if (result === 'win') {
    player.record.breaches += 1;
    player.record.streak = player.record.streak > 0 ? player.record.streak + 1 : 1;
    if (!player.record.bestSecs || secs < player.record.bestSecs) player.record.bestSecs = secs;
  } else {
    player.record.streak = player.record.streak < 0 ? player.record.streak - 1 : -1;
  }
  player.lastFightAt = Date.now();
  // THE GALACTIC: hunting in the Arena cools the armada's attention.
  decayGalacticAttention(player);

  // XP: the progression track. Flat line for the fight, plus a bonus for
  // teaching the Twin shapes it did not know from you. A Founder's Ember
  // holder earns +10% — the relic's one gentle edge, shown on the verdict.
  let xpGain = (result === 'win' ? XP_TABLE.houseWin : XP_TABLE.houseLoss) +
    Math.min(XP_TABLE.shapeCap, newToPlayer.length * XP_TABLE.perShape);
  const emberBonus = !!founderSerial(player);
  if (emberBonus) xpGain = Math.floor(xpGain * FOUNDER_XP_MULT);
  const levelBefore = levelForXp(player.xp || 0);
  player.xp = (player.xp || 0) + xpGain;

  const verdict = {
    id: fight.id, fighterId: player.id,
    fighterName: player.displayName || 'A guest fighter',
    mode: fight.mode, challengeOwnerId: fight.challengeOwnerId || null,
    result, endReason: endReason || (result === 'win' ? 'breach' : 'timeout'),
    secs, points, storm: !!fight.storm,
    xp: xpGain, emberBonus, level: levelForXp(player.xp), levelUp: levelForXp(player.xp) > levelBefore,
    shapesTaught: newToPlayer, shapesTaughtCount: newToPlayer.length,
    newToWorldCount: newToWorld.length,
    armorGains,
    fightStats: fightStats || null,
    at: Date.now()
  };
  state.verdicts[fight.id] = verdict;
  state.fights.unshift({
    id: fight.id, name: verdict.fighterName, result, how: verdict.endReason, secs,
    shapes: newToPlayer.length, mode: fight.mode, at: verdict.at
  });
  state.fights = state.fights.slice(0, 60);

  // Challenge fights report back to the owner's grudge feed.
  if (fight.mode === 'challenge' && fight.challengeOwnerId && fight.challengeOwnerId !== player.id) {
    const owner = state.players[fight.challengeOwnerId];
    if (owner) {
      owner.challengeFeed = owner.challengeFeed || [];
      owner.challengeFeed.unshift({
        at: verdict.at, challenger: verdict.fighterName, result,
        secs, verdictId: fight.id
      });
      owner.challengeFeed = owner.challengeFeed.slice(0, 20);
    }
  }
  return verdict;
}

// ---- Settle a Pit fight ------------------------------------------------------
// Mutates state + challenger + devil owner. The Pit keeps its own books: a
// Pit fight teaches the DEVIL (never the house Twin — shapesGlobal is not
// touched), pays the challenger the devil's snapshotted bounty on a breach
// (house-minted; the owner loses nothing but record), pays the owner defense
// XP on a hold (daily-capped trickle), and rolls item drops with the rng the
// server deals from the fight seed. Items declared at start were already
// spent by the server; a voided fight never reaches this function (the
// server refunds on void instead).
function settlePitFight(state, challenger, owner, fight, submission, sim, rng) {
  const { result, endReason, durationMs, actions, fightStats } = submission;
  const secs = Math.max(1, Math.round(durationMs / 1000));
  const patterns = extractPatterns(actions || []);
  const devil = owner.devil;
  const traits = fight.pitTraits || {};
  const roll = rng || rng32((fight.seed ^ 0x51ab) >>> 0);
  const drops = [];
  let dropBonus = 0;
  const grantItem = (who, itemId, how) => {
    if (itemCount(who, itemId) >= PIT.itemCap) { who.points += 10; return 'points'; }
    return mintItem(state, who, itemId, how || 'drop');
  };
  const rollDrop = (who, itemId, chance, collect) => {
    if (roll() >= chance) return;
    const got = grantItem(who, itemId, 'drop');
    if (got === 'points') { if (collect) dropBonus += 10; }
    else if (collect) collect.push({ item: itemId, serial: got, rarity: ITEMS[itemId].rarity });
  };
  const traitItems = [];
  if (traits.mirage) traitItems.push('mirrorwrap');
  if (traits.armor) traitItems.push('anchorstitch');

  challenger.pitAttack = challenger.pitAttack || { bouts: 0, breaches: 0 };
  challenger.pitAttack.bouts += 1;
  const delta = fight.pitClassDelta || 0;
  let bountyWon = 0, xpGain = 0, points = 0;
  let modDrop = null;

  if (result === 'win') {
    challenger.pitAttack.breaches += 1;
    bountyWon = fight.pitBounty || 0;
    points = bountyWon;
    challenger.points += bountyWon;
    devil.breached += 1;
    devil.holdStreak = 0;
    devil.lastBreachedBy = challenger.displayName || 'A fighter';
    devil.breachedBy = [...new Set([challenger.id, ...(devil.breachedBy || [])])].slice(0, 20);
    devil.bounty = PIT.bountyBase;
    devil.bountyDay = dayKey(Date.now());
    // The devil learns the shapes that beat it — its own private education.
    const learnMult = state.config.learningSpeed || 1;
    owner.devilShapes = owner.devilShapes || {};
    for (const k of Object.keys(patterns)) {
      owner.devilShapes[k] = (owner.devilShapes[k] || 0) + patterns[k] * learnMult;
    }
    xpGain = delta > 0 ? XP_TABLE.pit.up.win : XP_TABLE.pit.same.win;
    // Drops: beating a trait devil rolls for the item that counters it —
    // the Mirror Wrap at LEGENDARY rarity (rare even here), the Anchor
    // Stitch uncommon. Beating a plain devil rolls low for either.
    if (traitItems.length) {
      for (const it of traitItems) rollDrop(challenger, it, DROPS[it].trait, drops);
      // The hard treasures: the Second Heart falls only off Armored devils;
      // the Stillbell only off high-class (Blaze+) Mirage devils.
      if (traits.armor) rollDrop(challenger, 'secondheart', DROPS.secondheart.trait, drops);
      if (traits.mirage && traits.classIdx >= 3) rollDrop(challenger, 'stillbell', DROPS.stillbell.trait, drops);
    } else {
      for (const it of Object.keys(DROPS)) rollDrop(challenger, it, DROPS[it].plain, drops);
    }
    // MODS v1: a breach occasionally leaves a mod in the hunter's hands —
    // rolled from the same dealt rng, after the item drops, and granted on
    // the spot (mods carry no serial and death cannot take them).
    if (roll() < MOD_DROPS.pitWin) {
      const mid = rollModDrop(roll, challenger, 'any');
      if (mid) modDrop = { id: mid, name: MODS_ALL[mid].name, kind: FITTED_MODS[mid] ? 'fitted' : 'deployable', tool: FITTED_MODS[mid] ? FITTED_MODS[mid].tool : null };
    }
  } else {
    devil.held += 1;
    devil.holdStreak = (devil.holdStreak || 0) + 1;
    devil.bounty = Math.min(PIT.bountyMax, bountyNow(owner, Date.now()) + PIT.bountyPerHold);
    devil.bountyDay = dayKey(Date.now());
    points = 5 + Math.round(Math.min(100, Math.max(0, sim.damagePct || 0)) * 0.05);
    challenger.points += points;
    xpGain = delta > 0 ? XP_TABLE.pit.up.loss : XP_TABLE.pit.same.loss;
    // Defense XP trickle for the sleeping owner — capped per day.
    const dk = dayKey(Date.now());
    if (!owner.defenseXpDay || owner.defenseXpDay.day !== dk) owner.defenseXpDay = { day: dk, count: 0 };
    if (owner.defenseXpDay.count < XP_TABLE.defenseHoldDailyCap) {
      owner.xp = (owner.xp || 0) + XP_TABLE.defenseHold;
      owner.defenseXpDay.count += 1;
    }
    // A hold occasionally earns the owner the item matching their own trait.
    for (const it of traitItems) {
      if (roll() < DROPS[it].hold) grantItem(owner, it, 'hold');
    }
    // A long unbroken defense (5+ holds in a row) can earn the owner a
    // Second Heart — the sleeping defender's rare wage.
    if (devil.holdStreak >= 5 && roll() < DROPS.secondheart.hold) grantItem(owner, 'secondheart', 'hold');
  }
  const emberBonus = !!founderSerial(challenger);
  if (emberBonus) xpGain = Math.floor(xpGain * FOUNDER_XP_MULT);
  const levelBefore = levelForXp(challenger.xp || 0);
  challenger.xp = (challenger.xp || 0) + xpGain;
  challenger.lastFightAt = Date.now();
  // THE GALACTIC: hunting in the Pit cools the armada's attention.
  decayGalacticAttention(challenger);

  let topShape = null, topN = 0;
  for (const [k, v] of Object.entries(patterns)) if (v > topN) { topN = v; topShape = k; }

  state.pit = state.pit || { bouts: 0, holds: 0, breaches: 0 };
  state.pit.bouts += 1;
  if (result === 'win') state.pit.breaches += 1; else state.pit.holds += 1;

  const verdict = {
    id: fight.id, fighterId: challenger.id,
    fighterName: challenger.displayName || 'A fighter',
    mode: 'pit', devilOwnerId: owner.id, devilName: owner.displayName || 'A fighter',
    result, endReason: endReason || (result === 'win' ? 'breach' : 'timeout'),
    secs, points, bountyWon, xp: xpGain, emberBonus,
    level: levelForXp(challenger.xp), levelUp: levelForXp(challenger.xp) > levelBefore,
    drops, dropBonus, modDrop,
    morphed: !!sim.morphed, feints: sim.feintsShown || 0,
    combos: sim.combos || [],
    shapesTaught: [], shapesTaughtCount: 0, newToWorldCount: 0, armorGains: {},
    fightStats: fightStats || null,
    at: Date.now()
  };
  state.verdicts[fight.id] = verdict;
  state.fights.unshift({
    id: fight.id, name: verdict.fighterName, result, how: verdict.endReason, secs,
    shapes: 0, mode: 'pit', at: verdict.at
  });
  state.fights = state.fights.slice(0, 60);

  // The sleeping owner hears about it — the grudge feed is the Pit's mail.
  owner.challengeFeed = owner.challengeFeed || [];
  owner.challengeFeed.unshift({
    at: verdict.at, challenger: verdict.fighterName, result,
    secs, verdictId: fight.id, mode: 'pit',
    bounty: result === 'win' ? bountyWon : devil.bounty,
    shape: result === 'win' ? topShape : null
  });
  owner.challengeFeed = owner.challengeFeed.slice(0, 20);
  return verdict;
}

// ============================================================================
// THE DESCENT — a Diablo-style delve beneath the Arena (Steven, 2026-11-27).
// Solo depths against the house Twin. Cracked shapes and bosses drop GEAR —
// rolled by the server from the depth seeds, worn by the fighter's tools,
// kept in the satchel between runs. Integrity and Trace carry across a run;
// at every cleared depth the fighter chooses: descend, or ascend and bank.
// Death loses the unbanked STURDY/RARE pieces; EPIC and LEGENDARY always
// bank. Everything settles through the same referee as every bout here.
// ============================================================================
const GEAR_SLOTS = ['flood', 'probe', 'whisper', 'decoy', 'body'];
const GEAR_TIERS = ['STURDY', 'RARE', 'EPIC', 'LEGENDARY', 'GODFORGED'];
const TIER_AFFIXES = { STURDY: 1, RARE: 2, EPIC: 3, LEGENDARY: 3 };
const HAUL_VALUES = { STURDY: 10, RARE: 25, EPIC: 60, LEGENDARY: 150, GODFORGED: 400 };
// ---- GODFORGED (Steven, 2026-11-27, mid-build addition) -------------------
// One tier above LEGENDARY, and it barely exists: GODFORGED pieces drop ONLY
// from bosses at Depth 9 and deeper, at a few percent — the books print the
// true count of how many exist in the world. They are not worn; they are
// treasures in the satchel, declared at a run's start like the Heart and the
// Bell, and they carry CHARGES (1–3, dealt with the drop). A charge is spent
// only when the power actually fires; a spent-out piece stays in the
// collection forever, powerless, its number retired — the same provenance
// law as every numbered edition in this house. Every power bends a rule
// INSIDE the referee: a forged god-tier claim voids exactly like a forged
// ability. The family stays small — five pieces, no more.
const GODFORGED = {
  unreadstrike: { name: 'THE UNREAD STRIKE', line: 'Declared for a run: one of your tools — the one the run leans on — becomes unreadable. Glances cannot scramble it, and its strikes teach the Twin nothing, all run long.' },
  openbook:     { name: 'THE OPEN BOOK', line: 'Declared for a run: every telegraph stands open. Parry windows run wide — you see every blow coming, all run long.' },
  keepersmercy: { name: "THE KEEPER'S MERCY", line: 'Declared for a run: once, mid-fight, call for mercy and the Trace rewinds to zero.' },
  seconddawn:   { name: 'THE SECOND DAWN', line: 'Declared for a run: once, when a depth would end your run — gate, blade or Trace — you stand back up at half integrity with the Trace wiped clean.' },
  doubleharvest:{ name: 'THE DOUBLE HARVEST', line: 'Declared for a run: the first depth that drops loot drops it twice over.' }
};
function godforgedChance(depth) {
  if (depth < 9) return 0;
  return Math.min(0.08, 0.04 + (depth - 9) * 0.002);
}
// Roll a GODFORGED treasure: a power from the family, 1–3 charges, and the
// next numbered edition of that power — signed by the Keeper, unique forever.
function rollGodforged(state, rng) {
  state.gearSeq = state.gearSeq || {};
  const ids = Object.keys(GODFORGED);
  const power = ids[Math.floor(rng() * ids.length)];
  const charges = 1 + Math.floor(rng() * 3);
  const serial = (state.gearSeq[power] || 0) + 1;
  state.gearSeq[power] = serial;
  const inst = (state.gearSeq._inst || 0) + 1;
  state.gearSeq._inst = inst;
  return {
    id: 'g' + inst, slot: 'god', tier: 'GODFORGED', god: power,
    name: GODFORGED[power].name, affixes: [], unique: null, serial,
    charges, chargesMax: charges, retired: false, firedLog: [],
    worn: false, banked: false, at: Date.now()
  };
}
// Spend one charge when a power fires. A piece at zero charges is retired:
// it stays in the satchel's record, powerless, its number never re-issued.
function spendGodCharge(player, pieceId, how) {
  const piece = ((player && player.gear) || []).find(g => g.id === pieceId);
  if (!piece || piece.tier !== 'GODFORGED' || piece.retired || !(piece.charges > 0)) return false;
  piece.charges -= 1;
  piece.firedLog = piece.firedLog || [];
  piece.firedLog.push({ how: how || 'fired', at: Date.now() });
  if (piece.charges <= 0) piece.retired = true;
  return true;
}
// Affix pools per slot. kind drives the math in gearMods; min/max are the
// server roll range; label renders the piece's card line. Fractions are
// multipliers (0.12 = +12%); the rest are flat values in their own units
// (trace points, damage, milliseconds, %/s of cooling).
const AFFIX_POOLS = {
  flood: [
    { kind: 'dmg',      min: 0.08, max: 0.20, label: v => `Flood damage +${Math.round(v * 100)}%`, flavor: 'of Wrath' },
    { kind: 'tracecut', min: 2,    max: 5,    label: v => `Flood trace −${v} per strike`, flavor: 'of Silence' },
    { kind: 'cd',       min: 0.08, max: 0.18, label: v => `Flood cooldown −${Math.round(v * 100)}%`, flavor: 'of Haste' },
    { kind: 'splash',   min: 2,    max: 5,    label: v => `Flood splashes +${v} onto a second shape`, flavor: 'of Embers' }
  ],
  probe: [
    { kind: 'dmg',       min: 0.10, max: 0.25, label: v => `Probe damage +${Math.round(v * 100)}%`, flavor: 'of the Needle' },
    { kind: 'mark',      min: 0.25, max: 0.60, label: v => `Marks last +${Math.round(v * 100)}% longer`, flavor: 'of the Long Look' },
    { kind: 'famshield', min: 0.20, max: 0.45, label: v => `The Twin's familiarity with your Probe grows ${Math.round(v * 100)}% slower`, flavor: 'of Forgetting' },
    { kind: 'cd',        min: 0.08, max: 0.18, label: v => `Probe cooldown −${Math.round(v * 100)}%`, flavor: 'of Haste' }
  ],
  whisper: [
    { kind: 'dot',       min: 0.15, max: 0.35, label: v => `Whisper burn +${Math.round(v * 100)}%`, flavor: 'of the Slow Fire' },
    { kind: 'traceburn', min: 3,    max: 7,    label: v => `Whisper burns ${v}% trace on strike`, flavor: 'of Ash' },
    { kind: 'cd',        min: 0.08, max: 0.18, label: v => `Whisper cooldown −${Math.round(v * 100)}%`, flavor: 'of Haste' },
    { kind: 'silent',    min: 1,    max: 1,    label: () => 'Silent: glances cannot scramble your Whisper', flavor: 'of Held Breath' }
  ],
  decoy: [
    { kind: 'cd',       min: 0.08, max: 0.18, label: v => `Decoy cooldown −${Math.round(v * 100)}%`, flavor: 'of Haste' },
    { kind: 'shed',     min: 4,    max: 9,    label: v => `Decoy sheds ${v}% more trace`, flavor: 'of Letting Go' },
    { kind: 'longlife', min: 0.15, max: 0.30, label: v => `Decoy's next-strike bonus +${Math.round(v * 100)}% more`, flavor: 'of Patience' },
    { kind: 'dmg',      min: 0.10, max: 0.20, label: v => `All strikes after a Decoy bite +${Math.round(v * 100)}% harder`, flavor: 'of the Open Door', unused: true }
  ],
  body: [
    { kind: 'plating', min: 10,   max: 25,   label: v => `+${v} max integrity`, flavor: 'of the Wall' },
    { kind: 'coolant', min: 0.3,  max: 0.8,  label: v => `Trace cools +${v.toFixed(1)}%/s faster`, flavor: 'of Cold Water' },
    { kind: 'parry',   min: 150,  max: 350,  label: v => `Parry window +${v}ms wider`, flavor: 'of the Open Hand' },
    { kind: 'cheap',   min: 0.08, max: 0.20, label: v => `Tools and abilities cost ${Math.round(v * 100)}% less energy`, flavor: 'of Thrift' }
  ]
};
// The decoy 'dmg' affix above is flavor-only in the pool draft and is never
// rolled (marked unused) — decoy pieces roll from the three working affixes.
for (const slot of Object.keys(AFFIX_POOLS)) AFFIX_POOLS[slot] = AFFIX_POOLS[slot].filter(a => !a.unused);
// LEGENDARY unique powers — one per slot, named, numbered, Keeper-signed.
const GEAR_UNIQUES = {
  flood:   { id: 'emberbrand',  name: 'EMBERBRAND',        line: 'Unique: your Floods ignite the gate — a slow burn rides every strike.' },
  probe:   { id: 'twoeyes',     name: 'TWO EYES',          line: 'Unique: your Probe marks two shapes at once — the mark covers your next two strikes.' },
  whisper: { id: 'gravechoir',  name: 'THE GRAVE CHOIR',   line: 'Unique: your Whisper burns 60% harder and two seconds longer.' },
  decoy:   { id: 'secondghost', name: 'THE SECOND GHOST',  line: 'Unique: your Decoy strikes once — a real hit — before it fades.' },
  body:    { id: 'keeperplate', name: "THE KEEPER'S PLATE", line: 'Unique: +15 more integrity and +0.4%/s more cooling, beyond its affixes.' }
};
const GEAR_FORMS = { flood: 'Brand', probe: 'Lens', whisper: 'Choir', decoy: 'Veil', body: 'Plate' };

function affixValue(piece, kind) {
  if (!piece || !piece.affixes) return 0;
  return piece.affixes.filter(a => a.kind === kind).reduce((s, a) => s + a.value, 0);
}
// Aggregate a piece's affixes into the modifier set effectiveStats reads.
function gearMods(piece) {
  const m = { dmg: 0, dot: 0, cd: 0, tracecut: 0, splash: 0, mark: 0, famshield: 0,
              traceburn: 0, shed: 0, longlife: 0, silent: false, plating: 0,
              coolant: 0, parry: 0, cheap: 0, twoEyes: false, secondGhost: false,
              ignite: false, graveChoir: false };
  if (!piece) return m;
  for (const a of piece.affixes || []) {
    if (a.kind === 'silent') m.silent = true;
    else if (m[a.kind] !== undefined) m[a.kind] += a.value;
  }
  if (piece.tier === 'LEGENDARY' && piece.unique) {
    if (piece.unique === 'twoeyes') m.twoEyes = true;
    if (piece.unique === 'secondghost') m.secondGhost = true;
    if (piece.unique === 'emberbrand') m.ignite = true;
    if (piece.unique === 'gravechoir') m.graveChoir = true;
    if (piece.unique === 'keeperplate') { m.plating += 15; m.coolant += 0.4; }
  }
  return m;
}
function wornGearMap(player) {
  const map = {};
  for (const p of (player && player.gear) || []) if (p.worn && GEAR_SLOTS.includes(p.slot)) map[p.slot] = p;
  return map;
}
function gearSummary(map) {
  const out = {};
  for (const slot of Object.keys(map || {})) {
    const p = map[slot];
    out[slot] = { name: p.name, tier: p.tier, unique: p.unique || null, serial: p.serial || null };
  }
  return out;
}
function gearLine(piece) {
  const bits = (piece.affixes || []).map(a => a.label);
  if (piece.unique) {
    const u = Object.values(GEAR_UNIQUES).find(x => x.id === piece.unique);
    if (u) bits.push(u.line);
  }
  return bits;
}
// Roll one gear piece. The rng is dealt by the server from the run/depth
// seeds, so every drop is reproducible and referee-verifiable after the fact.
function rollGearPiece(state, rng, opts) {
  opts = opts || {};
  state.gearSeq = state.gearSeq || {};
  const slot = opts.slot || GEAR_SLOTS[Math.floor(rng() * GEAR_SLOTS.length)];
  const tier = opts.tier || 'STURDY';
  const pool = AFFIX_POOLS[slot].slice();
  const affixes = [];
  const n = TIER_AFFIXES[tier] || 1;
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    const def = pool.splice(idx, 1)[0];
    const raw = def.min + rng() * (def.max - def.min);
    const value = def.kind === 'silent' ? 1
      : (def.max <= 1 ? +raw.toFixed(3) : Math.round(raw));
    affixes.push({ kind: def.kind, value, label: def.label(value), flavor: def.flavor });
  }
  let unique = null, serial = null, name;
  if (tier === 'LEGENDARY') {
    const u = GEAR_UNIQUES[slot];
    unique = u.id;
    serial = (state.gearSeq[unique] || 0) + 1;
    state.gearSeq[unique] = serial;
    name = u.name;
  } else {
    const toolName = slot === 'body' ? 'Keeper' : TOOLS[slot].name;
    name = toolName + ' ' + GEAR_FORMS[slot] + (affixes[0] && affixes[0].flavor ? ' ' + affixes[0].flavor : '');
  }
  const inst = (state.gearSeq._inst || 0) + 1;
  state.gearSeq._inst = inst;
  return { id: 'g' + inst, slot, tier, affixes, unique, serial, name, worn: false, banked: false, at: Date.now() };
}
function rollTier(rng, table) {
  let r = rng();
  for (const [tier, w] of table) { if (r < w) return tier; r -= w; }
  return table[table.length - 1][0];
}
const DROP_TABLES = {
  shape: [['STURDY', 0.68], ['RARE', 0.24], ['EPIC', 0.065], ['LEGENDARY', 0.015]],
  elite: [['STURDY', 0.45], ['RARE', 0.38], ['EPIC', 0.14], ['LEGENDARY', 0.03]],
  vault: [['STURDY', 0.60], ['RARE', 0.30], ['EPIC', 0.09], ['LEGENDARY', 0.01]]
};
function bossLegendaryChance(depth) { return Math.min(0.4, 0.18 + depth * 0.012); }
function haulValue(pieces) { return (pieces || []).reduce((s, p) => s + (HAUL_VALUES[p.tier] || 0), 0); }
// The death rule, in one place: EPIC and above always bank — the Keeper
// is not cruel. Unbanked STURDY/RARE stay in the dark.
function deathSplit(haul) {
  const keep = [], lost = [];
  for (const p of haul || []) (p.tier === 'EPIC' || p.tier === 'LEGENDARY' || p.tier === 'GODFORGED' ? keep : lost).push(p);
  return { keep, lost };
}
function bankHaul(player, pieces) {
  player.gear = player.gear || [];
  for (const p of pieces || []) { p.banked = true; p.worn = false; player.gear.push(p); }
  return (pieces || []).length;
}
function wearGear(player, gearId) {
  const piece = ((player && player.gear) || []).find(g => g.id === gearId);
  if (!piece) return 'no such piece in your satchel';
  if (piece.tier === 'GODFORGED') return 'GODFORGED treasures are declared at the Descent\u2019s door, not worn';
  for (const p of player.gear) if (p.slot === piece.slot) p.worn = false;
  piece.worn = true;
  return null;
}
function unwearGear(player, slot) {
  if (!GEAR_SLOTS.includes(slot)) return 'no such slot';
  for (const p of (player && player.gear) || []) if (p.slot === slot) p.worn = false;
  return null;
}

// ---- Descent depths, bosses, schedules ------------------------------------
const BOSSES = [
  { id: 'captor',     name: 'THE CAPTOR',     line: 'He collects what you lean on. Mid-fight he will seize your most-used tool of this run — crack his gate to win it back TWINNED for the rest of the run, or descend without it.' },
  { id: 'accountant', name: 'THE ACCOUNTANT', line: 'He has counted every fight you have ever fought. His glances hunt the tool your whole career leans on — at double strength.' },
  { id: 'mirror',     name: 'THE MIRROR',     line: 'It fights in your style. Your own career tallies drive its strike cycle — you are the lesson it studied.' },
  { id: 'undertaker', name: 'THE UNDERTAKER', line: 'The deepest named devil down here. What he carries is the best loot in the house.' }
];
function descentKind(depth) {
  if (depth % 3 === 0) return 'boss';
  if (depth % 5 === 0) return 'vault';
  if (depth % 2 === 0) return 'elite';
  return 'normal';
}
function bossForDepth(depth) {
  if (depth % 3 !== 0) return null;
  const idx = ((depth / 3 - 1) % BOSSES.length + BOSSES.length) % BOSSES.length;
  const base = BOSSES[idx];
  const cycle = Math.floor((depth / 3 - 1) / BOSSES.length);
  return Object.assign({}, base, { cycle, title: cycle > 0 ? base.name + ', AGAIN' : base.name });
}
function descentDepthParams(depth) {
  const kind = descentKind(depth);
  const intervalMult = Math.max(0.45, 1 - 0.05 * (depth - 1));
  let gateHp = Math.round(100 + 18 * (depth - 1));
  let roundMs = 120000;
  if (kind === 'boss') { gateHp = Math.round(gateHp * 1.35); roundMs = 150000; }
  if (kind === 'vault') roundMs = 45000;
  return { kind, gateHp, roundMs, intervalMult, aggression: Math.min(2.2, 1 + 0.06 * (depth - 1)) };
}
// The Twin's gear-aware counters, stated honestly: as depth grows she builds
// raw familiarity against the tool your career leans on AND against any tool
// carrying a LEGENDARY — lean on a legend down here and she learns it.
function descentBuildFam(player, depth) {
  const fam = {};
  const tu = (player && player.toolUse) || {};
  let top = null, best = 0;
  for (const id of TOOL_IDS) { const n = tu[id] || 0; if (n > best) { best = n; top = id; } }
  if (top && depth >= 2) fam[top] = Math.min(0.30, 0.03 * depth);
  const worn = wornGearMap(player);
  for (const slot of TOOL_IDS) {
    if (worn[slot] && worn[slot].tier === 'LEGENDARY') {
      fam[slot] = Math.min(0.30, (fam[slot] || 0) + Math.min(0.25, 0.02 * depth));
    }
  }
  return fam;
}
function makeDescentStrikes(seed, depth, roundMs, ctx) {
  ctx = ctx || {};
  const params = descentDepthParams(depth);
  if (params.kind === 'vault') return [];
  const boss = bossForDepth(depth);
  let cycle = STRIKE.cycle, intervalMult = params.intervalMult;
  if (boss && boss.id === 'mirror') {
    const st = devilStyle({ toolUse: ctx.careerTallies || {}, record: { bouts: 1 }, parriesTotal: 0 });
    cycle = st.cycle; intervalMult *= st.intervalMult;
  }
  if (boss && boss.id === 'undertaker') { cycle = ['haymaker', 'clean', 'haymaker', 'glance']; intervalMult *= 0.9; }
  const rnd = rng32(seed);
  const interval = (STRIKE.baseMs / params.aggression) * intervalMult;
  const strikes = [];
  let t = STRIKE.firstMs + (rnd() - 0.5) * 1200;
  let i = 0;
  while (t < roundMs - 1200 && strikes.length < 80) {
    const kind = cycle[i % cycle.length];
    const s = { at: Math.round(t), kind };
    if (kind === 'glance') {
      // THE ACCOUNTANT: every glance hunts the career-most-used tool.
      s.tool = (boss && boss.id === 'accountant' && ctx.careerTool) ? ctx.careerTool
        : TOOL_IDS[Math.floor(rnd() * TOOL_IDS.length)];
    }
    strikes.push(s);
    t += interval + (rnd() - 0.5) * 1600;
    i++;
  }
  return strikes;
}
// XP a step below Pit rates: per depth cleared, a boss bonus, a vault wage.
const DESCENT_XP = { perDepth: 18, boss: 25, vault: 10 };
// The Twin keeps the lesson of every depth, exactly like a house fight:
// shapes to the world and to the fighter, armor against favorite tools.
function teachFromActions(state, player, actions) {
  const patterns = extractPatterns(actions || []);
  const learnMult = (has(player, 'dec1') ? 0.7 : 1) * (state.config.learningSpeed || 1);
  const newToWorld = [], newToPlayer = [];
  for (const k of Object.keys(patterns)) {
    if (!state.shapesGlobal[k]) newToWorld.push(k);
    if (!player.shapes[k]) newToPlayer.push(k);
    state.shapesGlobal[k] = (state.shapesGlobal[k] || 0) + patterns[k] * learnMult;
    player.shapes[k] = (player.shapes[k] || 0) + patterns[k] * learnMult;
  }
  const toolUse = {};
  for (const a of actions || []) if (a.tool !== 'parry' && a.tool !== 'bell' && a.tool !== 'mercy' && !String(a.tool || '').startsWith('ability:') && !String(a.tool || '').startsWith('mod:')) toolUse[a.tool] = (toolUse[a.tool] || 0) + 1;
  player.toolUse = player.toolUse || {};
  for (const [tool, n] of Object.entries(toolUse)) player.toolUse[tool] = (player.toolUse[tool] || 0) + n;
  const ranked = Object.entries(toolUse).sort((a, b) => b[1] - a[1]);
  const armorGains = {};
  if (ranked[0]) armorGains[ranked[0][0]] = 0.05;
  if (ranked[1]) armorGains[ranked[1][0]] = 0.025;
  for (const [tool, gain] of Object.entries(armorGains)) {
    player.twinArmor[tool] = Math.min(0.45, (player.twinArmor[tool] || 0) + gain);
    state.globalArmor[tool] = Math.min(0.2, (state.globalArmor[tool] || 0) + 0.002);
  }
  return { patterns, newToPlayer, newToWorld, toolUse };
}
// Settle a whole run at its end (ascend / turned back / death). Banks what
// the rules bank, loses what death loses, pays XP once (Ember +10% rides),
// and writes the run's verdict into the house books.
function finishDescentRun(state, player, run, how) {
  run.over = true;
  let banked = [], lost = [];
  if (how === 'death') { const split = deathSplit(run.haul); banked = split.keep; lost = split.lost; }
  else banked = (run.haul || []).slice();
  bankHaul(player, banked);
  state.descent = state.descent || { runs: 0, deaths: 0, ascents: 0, turned: 0, bossesSlain: 0, legendaries: 0, godforged: 0, depthsCleared: 0 };
  for (const p of banked) {
    if (p.tier === 'LEGENDARY') state.descent.legendaries += 1;
    if (p.tier === 'GODFORGED') state.descent.godforged = (state.descent.godforged || 0) + 1;
  }
  const value = haulValue(banked) + (run.bankedValue || 0); // + what boss kills already banked mid-run
  const points = run.depthsCleared * 10 + run.bossesSlain * 15;
  player.points += points;
  let xpGain = run.xp || 0;
  const emberBonus = !!founderSerial(player);
  if (emberBonus) xpGain = Math.floor(xpGain * FOUNDER_XP_MULT);
  const levelBefore = levelForXp(player.xp || 0);
  player.xp = (player.xp || 0) + xpGain;
  player.lastFightAt = Date.now();
  // THE GALACTIC: hunting in the Descent cools the armada's attention.
  decayGalacticAttention(player);
  player.descent = player.descent || { runs: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, bossesSlain: 0 };
  player.descent.runs += 1;
  player.descent.deepest = Math.max(player.descent.deepest || 0, run.deepest || run.depthsCleared);
  player.descent.bestScore = Math.max(player.descent.bestScore || 0, run.score || 0);
  player.descent.bestHaul = Math.max(player.descent.bestHaul || 0, value);
  player.descent.bossesSlain = (player.descent.bossesSlain || 0) + (run.bossesSlain || 0);
  if (how === 'death') player.descent.deaths += 1;
  state.descent.runs += 1;
  state.descent.depthsCleared += run.depthsCleared || 0;
  state.descent.bossesSlain += run.bossesSlain || 0;
  if (how === 'death') state.descent.deaths += 1;
  else if (how === 'ascend') state.descent.ascents += 1;
  else state.descent.turned += 1;
  const secs = Math.max(1, Math.round((Date.now() - (run.startedAt || Date.now())) / 1000));
  const verdict = {
    id: run.id, fighterId: player.id,
    fighterName: player.displayName || 'A fighter',
    mode: 'descent',
    result: how === 'death' ? 'lose' : 'win',
    endReason: how, secs, points,
    xp: xpGain, emberBonus,
    level: levelForXp(player.xp), levelUp: levelForXp(player.xp) > levelBefore,
    shapesTaught: [], shapesTaughtCount: 0, newToWorldCount: 0, armorGains: {},
    fightStats: null,
    descent: {
      depthsCleared: run.depthsCleared || 0,
      deepest: run.deepest || run.depthsCleared || 0,
      score: run.score || 0,
      bossesSlain: run.bossesSlain || 0,
      haulValue: value,
      banked: banked.map(p => ({ name: p.name, tier: p.tier, slot: p.slot, serial: p.serial || null })),
      lost: lost.map(p => ({ name: p.name, tier: p.tier, slot: p.slot }))
    },
    at: Date.now()
  };
  state.verdicts[run.id] = verdict;
  state.fights.unshift({
    id: run.id, name: verdict.fighterName, result: verdict.result, how,
    secs, shapes: 0, mode: 'descent', at: verdict.at
  });
  state.fights = state.fights.slice(0, 60);
  return verdict;
}

// ===========================================================================
// THE GALACTIC — G1 "THE THEATER": the Twin's war takes the sky.
// One fighter, one build, one XP pool, one mind: a captain's tools become
// weapons systems with IDENTICAL referee math (effectiveStats deals them),
// worn gear rides the hull, fitted mods are hardpoints, the Mod Rail is the
// systems row, and the Trace reads as ARMADA ATTENTION — sector-level
// familiarity, kept per sector on the captain's own record, fed by the same
// pattern extraction that teaches the house Twin. Her global learning
// (shapesGlobal, globalArmor, grudge armor) ticks from galactic fights at
// exactly the Arena rate: she is one opponent, in every theater.
// ===========================================================================

// Sector 1's capital. The sketch names the capitals of Sectors 2, 3 and 5
// (THE LEDGER, THE CHOIR, THE UNDERTAKER'S HEIR) and holds them for their
// own sectors — Sector 1's flagship is named here in the same family: THE
// HERALD, the voice that announces the armada. Its gimmick is a gentle
// Accountant flavor: its glances hunt the tool this SORTIE leans on.
const GALACTIC_CAPITAL = {
  id: 'herald', name: 'THE HERALD',
  line: 'The voice of the Reach. It has announced every fleet you have met so far — and its glances hunt the weapon this sortie leans on, because it has been listening to you announce yourself.'
};
const GALACTIC_SECTORS = [
  {
    id: 1, name: 'EMBERFALL REACH', playable: true, capital: GALACTIC_CAPITAL,
    story: 'The first sky she took. Emberfall is where the armada learned to fly in formation — pickets on the rim, patrols in the lanes, Mirage wings in the dark between, and the Herald above it all, announcing her.'
  },
  {
    id: 2, name: 'THE LEDGER MARCHES', playable: false, capital: { id: 'ledger', name: 'THE LEDGER' },
    story: 'An Accountant-class dreadnought keeps these books. Every repeated action is entered, priced, and taxed with interest.',
    lockedReason: 'Held for the next campaign — the theater opens sector by sector, and Emberfall flies first.'
  },
  {
    id: 3, name: 'THE CHOIR DARK', playable: false, capital: { id: 'choir', name: 'THE CHOIR' },
    story: 'A Whisper-hulled capital fights nearly invisible here. Captains fly by Probe marks and muzzle shimmer, or they do not fly home.',
    lockedReason: 'Held for the next campaign — the theater opens sector by sector, and Emberfall flies first.'
  },
  {
    id: 4, name: 'THE UNCHARTED DEEP', playable: false, capital: null,
    story: 'The charts name no capital here yet. Something holds this sky; the armada does not say what.',
    lockedReason: 'Uncharted — no captain has flown far enough to draw this part of the sky.'
  },
  {
    id: 5, name: "THE UNDERTAKER'S ROAD", playable: false, capital: { id: 'heir', name: "THE UNDERTAKER'S HEIR" },
    story: 'It buries your strongest system first: your most-used weapon is seized at the fight\u2019s open, and won back — twinned — only by beating the Heir without it.',
    lockedReason: 'Held for the next campaign — the road to the Heir opens when the nearer skies are flown.'
  }
];
// One sortie through Sector 1: eight encounters, escalating across the
// tiers the sector holds (the sketch's fleet table, Sector 1's share of
// it — Battle Groups and Dreadnought Fleets belong to later sectors).
const GALACTIC_LADDER = ['pickets', 'pickets', 'patrols', 'squadrons', 'patrols', 'squadrons', 'squadrons', 'capital'];
const GALACTIC_TIERS = {
  pickets:   { tier: 'Pickets',   className: 'Spark', label: 'PICKET FRIGATE',    gateHp: 100, roundMs: 120000, intervalMult: 1.00, aggr: 1.00, feints: false },
  patrols:   { tier: 'Patrols',   className: 'Ember', label: 'PATROL PAIR',       gateHp: 120, roundMs: 120000, intervalMult: 0.95, aggr: 1.08, feints: false },
  squadrons: { tier: 'Squadrons', className: 'Flare', label: 'MIRAGE WING',       gateHp: 138, roundMs: 135000, intervalMult: 0.90, aggr: 1.16, feints: true },
  capital:   { tier: 'Capital',   className: 'Flare', label: 'CAPITAL SHIP',      gateHp: 185, roundMs: 150000, intervalMult: 0.85, aggr: 1.25, feints: true }
};
function galacticEncounter(n) {
  if (!Number.isInteger(n) || n < 1 || n > GALACTIC_LADDER.length) return null;
  const kind = GALACTIC_LADDER[n - 1];
  const t = GALACTIC_TIERS[kind];
  return { n, kind, tier: t.tier, className: t.className, label: t.label };
}
// `cleared` is the sector-clear notch: once a captain has taken the Reach,
// its armada flies a permanent notch quieter for them — the map remembers
// who won (the sketch's clearing law), and cleared sectors stay farmable.
function galacticEncounterParams(n, cleared) {
  const enc = galacticEncounter(n);
  if (!enc) return null;
  const t = GALACTIC_TIERS[enc.kind];
  return {
    kind: enc.kind, tier: enc.tier, className: enc.className, label: enc.label,
    gateHp: t.gateHp + (enc.kind === 'capital' ? 0 : (n - 1) * 4),
    roundMs: t.roundMs, intervalMult: t.intervalMult,
    aggression: +(t.aggr * (cleared ? 0.9 : 1)).toFixed(3),
    feints: t.feints
  };
}
// The armada's strike schedule: same STRIKE law as every theater, seeded,
// deterministic. Squadrons and the capital seed MIRAGE feints (the Pit's
// Flare law, in space — false sensor ships on the same dealt schedule).
// The Herald's glances hunt the tool this sortie leans on.
function makeGalacticStrikes(seed, n, roundMs, ctx) {
  ctx = ctx || {};
  const params = galacticEncounterParams(n, !!ctx.cleared);
  if (!params) return [];
  const rnd = rng32(seed);
  const interval = (STRIKE.baseMs / params.aggression) * params.intervalMult;
  const strikes = [];
  let t = STRIKE.firstMs + (rnd() - 0.5) * 1200;
  let i = 0;
  while (t < roundMs - 1200 && strikes.length < 80) {
    const kind = STRIKE.cycle[i % STRIKE.cycle.length];
    const s = { at: Math.round(t), kind };
    if (kind === 'glance') {
      s.tool = (params.kind === 'capital' && ctx.sortieTool) ? ctx.sortieTool
        : TOOL_IDS[Math.floor(rnd() * TOOL_IDS.length)];
    }
    strikes.push(s);
    t += interval + (rnd() - 0.5) * 1600;
    i++;
  }
  if (params.feints) {
    const want = 2 + Math.floor(rnd() * 3);
    let placed = 0;
    for (let attempt = 0; attempt < 60 && placed < want; attempt++) {
      const ft = 3000 + Math.floor(rnd() * Math.max(1000, roundMs - 6000));
      if (strikes.some(s => Math.abs(s.at - ft) < 1800)) continue;
      strikes.push({ at: ft, kind: 'feint' });
      placed++;
    }
    strikes.sort((a, b) => a.at - b.at);
  }
  return strikes;
}
// XP at the Descent's step: per encounter cleared, a capital bonus on top.
const GALACTIC_XP = { perEncounter: 18, capital: 25 };
// Mod drops in space: rolled after the gear from the same seeded rng, the
// Descent's discipline — banked on the spot, death cannot take them.
MOD_DROPS.galactic = {
  pickets:   { fitted: 0.10, deploy: 0 },
  patrols:   { fitted: 0.16, deploy: 0.08 },
  squadrons: { fitted: 0.22, deploy: 0.12 },
  capital:   { fitted: 0.35, deploy: 0.25 }
};
function rollGalacticMods(rng, player, kind) {
  const table = MOD_DROPS.galactic[kind];
  if (!table) return [];
  const out = [];
  if (rng() < table.fitted) { const id = rollModDrop(rng, player, 'fitted'); if (id) out.push({ id, kind: 'fitted' }); }
  if (table.deploy && rng() < table.deploy) { const id = rollModDrop(rng, player, 'deploy'); if (id) out.push({ id, kind: 'deployable' }); }
  return out;
}
// ---- Armada attention: the Trace, wearing a sector's sky -----------------
function galacticRecord(player) {
  if (!player) return null;
  if (!player.galactic) {
    player.galactic = { sorties: 0, deepest: 0, bestScore: 0, bestHaul: 0, deaths: 0, capitalsSlain: 0, cleared: {}, sectors: {} };
  }
  if (!player.galactic.cleared) player.galactic.cleared = {};
  if (!player.galactic.sectors) player.galactic.sectors = {};
  return player.galactic;
}
function galacticSectorShapes(player, sectorId) {
  const rec = galacticRecord(player);
  if (!rec) return {};
  const key = String(sectorId);
  if (!rec.sectors[key]) rec.sectors[key] = { shapes: {}, lastAt: 0 };
  if (!rec.sectors[key].shapes) rec.sectors[key].shapes = {};
  return rec.sectors[key].shapes;
}
// The familiarity map dealt into a galactic fight: the sector's own memory
// of this captain, PLUS the Arena's pre-read at +10% (the sketch's cap —
// theater-hopping is never punished hard). effectiveStats weights whatever
// map it is handed exactly as it weights the fighter's own lessons, so the
// referee math is the Arena's math, unchanged.
function galacticFamShapes(player, sectorId) {
  const sector = galacticSectorShapes(player, sectorId);
  const merged = {};
  for (const k of Object.keys(sector)) merged[k] = sector[k];
  const arena = (player && player.shapes) || {};
  for (const k of Object.keys(arena)) merged[k] = (merged[k] || 0) + arena[k] * 0.1;
  return merged;
}
// Attention as one honest number for the command strip: the mean tool
// familiarity this sector holds on the captain, as a percent of the cap.
function galacticAttention(state, player, sectorId) {
  if (!player) return 0;
  const famShapes = galacticFamShapes(player, sectorId);
  let sum = 0;
  for (const id of TOOL_IDS) {
    const parts = familiarityParts(state, player, id, famShapes);
    sum += Math.min(0.75, parts.global + parts.personal);
  }
  return Math.round((sum / TOOL_IDS.length) / 0.75 * 100);
}
// The lesson of a galactic fight, filed where galactic lessons live: the
// patterns go to the SECTOR's memory of this captain (attention), while
// the world lesson — shapesGlobal, globalArmor, grudge armor, career
// tallies — is written exactly as teachFromActions writes it. One mind.
function teachGalactic(state, player, sectorId, actions) {
  const patterns = extractPatterns(actions || []);
  const learnMult = (has(player, 'dec1') ? 0.7 : 1) * (state.config.learningSpeed || 1);
  const sectorShapes = galacticSectorShapes(player, sectorId);
  const newToWorld = [], newToSector = [];
  for (const k of Object.keys(patterns)) {
    if (!state.shapesGlobal[k]) newToWorld.push(k);
    if (!sectorShapes[k]) newToSector.push(k);
    state.shapesGlobal[k] = (state.shapesGlobal[k] || 0) + patterns[k] * learnMult;
    sectorShapes[k] = (sectorShapes[k] || 0) + patterns[k] * learnMult;
  }
  const rec = galacticRecord(player);
  if (rec && rec.sectors[String(sectorId)]) rec.sectors[String(sectorId)].lastAt = Date.now();
  const toolUse = {};
  for (const a of actions || []) if (a.tool !== 'parry' && a.tool !== 'bell' && a.tool !== 'mercy' && !String(a.tool || '').startsWith('ability:') && !String(a.tool || '').startsWith('mod:')) toolUse[a.tool] = (toolUse[a.tool] || 0) + 1;
  player.toolUse = player.toolUse || {};
  for (const [tool, n] of Object.entries(toolUse)) player.toolUse[tool] = (player.toolUse[tool] || 0) + n;
  const ranked = Object.entries(toolUse).sort((a, b) => b[1] - a[1]);
  const armorGains = {};
  if (ranked[0]) armorGains[ranked[0][0]] = 0.05;
  if (ranked[1]) armorGains[ranked[1][0]] = 0.025;
  for (const [tool, gain] of Object.entries(armorGains)) {
    player.twinArmor[tool] = Math.min(0.45, (player.twinArmor[tool] || 0) + gain);
    state.globalArmor[tool] = Math.min(0.2, (state.globalArmor[tool] || 0) + 0.002);
  }
  return { patterns, newToPlayer: newToSector, newToWorld, toolUse };
}
// Attention decays when the captain hunts ELSEWHERE: every settled fight
// in another theater cools every sector's memory of them by 5%. Called
// from settleFight, settlePitFight and finishDescentRun — never from a
// galactic settle, where the hunting is here.
function decayGalacticAttention(player) {
  if (!player || !player.galactic || !player.galactic.sectors) return;
  for (const key of Object.keys(player.galactic.sectors)) {
    const shapes = player.galactic.sectors[key] && player.galactic.sectors[key].shapes;
    if (!shapes) continue;
    for (const k of Object.keys(shapes)) {
      shapes[k] = +(shapes[k] * 0.95).toFixed(4);
      if (shapes[k] < 0.05) delete shapes[k];
    }
  }
}
// Settle a whole sortie at its end (sector cleared / withdrew / destroyed /
// turned back). Same banking law as the Descent: death loses the unbanked
// STURDY and RARE; EPIC and above always come home. XP pays once, the
// Founder's Ember +10% rides, and a capital kill writes the sector-clear
// receipt — the captain's own record, and the world's first-clear book,
// named and dated and permanent.
function finishGalacticSortie(state, player, sortie, how) {
  sortie.over = true;
  let banked = [], lost = [];
  if (how === 'death') { const split = deathSplit(sortie.haul); banked = split.keep; lost = split.lost; }
  else banked = (sortie.haul || []).slice();
  bankHaul(player, banked);
  state.galactic = state.galactic || { sorties: 0, withdrawals: 0, deaths: 0, turned: 0, encountersCleared: 0, capitalsSlain: 0, legendaries: 0, firstClear: {} };
  if (!state.galactic.firstClear) state.galactic.firstClear = {};
  for (const p of banked) if (p.tier === 'LEGENDARY') state.galactic.legendaries = (state.galactic.legendaries || 0) + 1;
  const value = haulValue(banked) + (sortie.bankedValue || 0);
  const points = (sortie.encountersCleared || 0) * 10 + (sortie.capitalsSlain || 0) * 15;
  player.points += points;
  let xpGain = sortie.xp || 0;
  const emberBonus = !!founderSerial(player);
  if (emberBonus) xpGain = Math.floor(xpGain * FOUNDER_XP_MULT);
  const levelBefore = levelForXp(player.xp || 0);
  player.xp = (player.xp || 0) + xpGain;
  player.lastFightAt = Date.now();
  const rec = galacticRecord(player);
  rec.sorties += 1;
  rec.deepest = Math.max(rec.deepest || 0, sortie.deepest || sortie.encountersCleared || 0);
  rec.bestScore = Math.max(rec.bestScore || 0, sortie.score || 0);
  rec.bestHaul = Math.max(rec.bestHaul || 0, value);
  rec.capitalsSlain = (rec.capitalsSlain || 0) + (sortie.capitalsSlain || 0);
  if (how === 'death') rec.deaths = (rec.deaths || 0) + 1;
  let firstClear = false;
  if (sortie.sectorCleared) {
    const key = String(sortie.sectorId || 1);
    if (!rec.cleared[key]) { rec.cleared[key] = { firstAt: Date.now(), clears: 0 }; firstClear = true; }
    rec.cleared[key].clears += 1;
    if (!state.galactic.firstClear[key]) {
      state.galactic.firstClear[key] = { playerId: player.id, name: player.displayName || 'A fighter', at: Date.now() };
    }
  }
  state.galactic.sorties += 1;
  state.galactic.encountersCleared += sortie.encountersCleared || 0;
  state.galactic.capitalsSlain += sortie.capitalsSlain || 0;
  if (how === 'death') state.galactic.deaths += 1;
  else if (how === 'withdraw') state.galactic.withdrawals += 1;
  else if (how === 'turned') state.galactic.turned += 1;
  const secs = Math.max(1, Math.round((Date.now() - (sortie.startedAt || Date.now())) / 1000));
  const verdict = {
    id: sortie.id, fighterId: player.id,
    fighterName: player.displayName || 'A fighter',
    mode: 'galactic',
    result: how === 'death' ? 'lose' : 'win',
    endReason: how, secs, points,
    xp: xpGain, emberBonus,
    level: levelForXp(player.xp), levelUp: levelForXp(player.xp) > levelBefore,
    shapesTaught: [], shapesTaughtCount: 0, newToWorldCount: 0, armorGains: {},
    fightStats: null,
    galactic: {
      sector: sortie.sectorId || 1,
      encountersCleared: sortie.encountersCleared || 0,
      deepest: sortie.deepest || sortie.encountersCleared || 0,
      score: sortie.score || 0,
      capitalsSlain: sortie.capitalsSlain || 0,
      sectorCleared: !!sortie.sectorCleared,
      firstClear,
      haulValue: value,
      banked: banked.map(p => ({ name: p.name, tier: p.tier, slot: p.slot, serial: p.serial || null })),
      lost: lost.map(p => ({ name: p.name, tier: p.tier, slot: p.slot }))
    },
    at: Date.now()
  };
  state.verdicts[sortie.id] = verdict;
  state.fights.unshift({
    id: sortie.id, name: verdict.fighterName, result: verdict.result, how,
    secs, shapes: 0, mode: 'galactic', at: verdict.at
  });
  state.fights = state.fights.slice(0, 60);
  return verdict;
}

function educationMeter(state) {
  const shapes = Object.keys(state.shapesGlobal).length;
  const fighters = Object.values(state.players).filter(p => p.record && p.record.bouts > 0).length;
  const bouts = Object.values(state.players).reduce((n, p) => n + (p.record ? p.record.bouts : 0), 0);
  return { shapes, fighters, bouts };
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

module.exports = {
  TOOLS, TOOL_IDS, NODES, NODE_BY_ID, ROUND_MS, GATE_HP,
  PLAYER_HP, TRACE_MAX, TRACE_COOL, PARRY, STRIKE,
  STORM, stormActive, effectiveAggression,
  ABILITIES, COMBO, XP_TABLE, PIT, DROPS, ITEMS, MORPH,
  xpForLevel, levelForXp, CLASSES, classIndexForLevel, classOf, devilTraits,
  dayKey, bountyNow, devilStyle, makeDevilStrikes,
  KEEPER_SIGNATURE, mintItem, itemCount, spendItem, refundItem, grantKeeperSet,
  grantFounderEmber, founderSerial, HEART_RESTORE, BELL_FREEZE_MS, FOUNDER_CAP, FOUNDER_XP_MULT,
  has, familiarity, familiarityParts, effectiveStats, extractPatterns, validateLog,
  makeStrikes, simulateRound, rng32,
  settleFight, settlePitFight, educationMeter, fmtTime,
  FITTED_MODS, DEPLOY_MODS, MODS_ALL, MOD_NUMBERS, MOD_DROPS,
  ensureMods, fittedMod, grantMod, fitMod, rollModDrop, rollDescentMods, modSummary,
  GEAR_SLOTS, GEAR_TIERS, TIER_AFFIXES, HAUL_VALUES, AFFIX_POOLS, GEAR_UNIQUES,
  affixValue, gearMods, wornGearMap, gearSummary, gearLine,
  rollGearPiece, rollTier, DROP_TABLES, bossLegendaryChance, haulValue,
  deathSplit, bankHaul, wearGear, unwearGear,
  GODFORGED, godforgedChance, rollGodforged, spendGodCharge,
  BOSSES, descentKind, bossForDepth, descentDepthParams, descentBuildFam,
  makeDescentStrikes, DESCENT_XP, teachFromActions, finishDescentRun,
  GALACTIC_SECTORS, GALACTIC_CAPITAL, GALACTIC_LADDER, GALACTIC_TIERS, GALACTIC_XP,
  galacticEncounter, galacticEncounterParams, makeGalacticStrikes,
  galacticRecord, galacticSectorShapes, galacticFamShapes, galacticAttention,
  teachGalactic, decayGalacticAttention, rollGalacticMods, finishGalacticSortie
};
