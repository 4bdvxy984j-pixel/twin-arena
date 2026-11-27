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
  for (const id of TOOL_IDS) {
    const t = TOOLS[id];
    let dmg = t.dmg, dot = t.dot || 0, cd = t.cooldown, cost = t.cost;
    if (id === 'probe' && has(player, 'vec1')) dmg *= 1.35;
    if (id === 'flood' && has(player, 'vec2')) dmg *= 1.30;
    if (id === 'whisper' && has(player, 'pat1')) { dmg *= 1.30; dot *= 1.30; }
    if (has(player, 'vec3')) { dmg *= 1.12; dot *= 1.12; }
    if (has(player, 'spd1')) cd *= 0.85;
    if (has(player, 'spd3')) cd *= 0.85;
    const parts = familiarityParts(state, player, id, opts.famShapes || null);
    const fam = Math.min(0.75, parts.global + parts.personal);
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
    tools[id] = entry;
  }
  // Ability pods: only the abilities this fighter's web actually carries.
  const abilities = {};
  for (const aid of Object.keys(ABILITIES)) {
    const ab = ABILITIES[aid];
    if (!has(player, ab.node)) continue;
    const entry = { name: ab.name, cost: ab.cost, cooldown: ab.cooldown, trace: ab.trace, color: ab.color, blurb: ab.blurb };
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
  return {
    tools, abilities,
    gateHp: GATE_HP,
    gateRegen: +(GATE_REGEN * effectiveAggression(state) * (has(player, 'pat2') ? 0.8 : 1)).toFixed(2),
    energyMax: ENERGY_MAX + (has(player, 'spd3') ? 20 : 0),
    energyRegen: +(ENERGY_REGEN * (has(player, 'spd2') ? 1.3 : 1)).toFixed(2),
    roundMs: ROUND_MS + (has(player, 'pat3') ? 25000 : 0),
    decoyCrit: has(player, 'dec3') ? 0.9 : 0.6,
    morph: opts.morph ? { shedKeep: MORPH.shedKeep, stitchTool: opts.stitchTool || null } : null,
    combat: {
      playerHp: PLAYER_HP,
      parryCost: PARRY.cost, parryCooldown: PARRY.cooldown,
      traceCool: TRACE_COOL, traceMax: TRACE_MAX,
      windupMs: STRIKE.windupMs, vulnMs: STRIKE.vulnMs, vulnMult: STRIKE.vulnMult,
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
  const acts = actions.filter(a => a.tool !== 'parry' && a.tool !== 'bell' && !String(a.tool || '').startsWith('ability:'));
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
  const S = {
    energy: stats.energyMax, gateHp: stats.gateHp, integrity: PLAYER_HP,
    trace: 0, tracePeak: 0, markUntil: -1, critNext: 0,
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
    bellReady: !!fight.bell, bellRung: false, bellUntil: -1
  };
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
      S.trace = Math.max(0, S.trace - TRACE_COOL * dt);
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
    if (S.trace >= TRACE_MAX) { S.outcome = { result: 'lose', endReason: 'trace', at: t }; return true; }
    return false;
  }
  function doAction(a) {
    const t = a.t;
    // ---- THE STILLBELL: rung from the deck, once, only if declared ----
    if (a.tool === 'bell') {
      if (!S.bellReady) return 'bell not declared';
      if (S.bellRung) return 'bell already rung';
      S.bellRung = true;
      S.bellUntil = t + BELL_FREEZE_MS;
      return null;
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
        S.integrity = Math.min(PLAYER_HP, S.integrity + (ab.heal || 30));
        return null;
      }
      if (id === 'rapid') { S.rapidUntil = t + (ab.windowMs || 8000); return null; }
      if (id === 'overdrive') {
        let dmg = (S.morphed && ab.dmgMorph !== undefined) ? ab.dmgMorph : ab.dmg;
        if (S.critNext > 0) { dmg *= (1 + S.critNext); S.critNext = 0; }
        if (t >= S.vulnFrom && t <= S.vulnUntil) {
          const bonus = dmg * (STRIKE.vulnMult - 1);
          S.vulnBonus += bonus; dmg += bonus;
          if (!S.combos.includes('open-window')) S.combos.push('open-window');
        }
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
        t >= s.at - STRIKE.windupMs && t <= s.at;
      const target = allStrikes.find(s => s.kind === 'haymaker' && inWindow(s));
      if (target) { target.parried = true; S.parries++; return null; }
      // MIRAGE: a parry thrown at a FEINT's telegraph is legal — and wasted.
      // The phantom eats the reflex; no window opens. A parry claimed where
      // no telegraph of either kind stood is still a forgery.
      const feint = strikes.find(s => s.kind === 'feint' && !s.parried && !s.eaten &&
        t >= s.at - STRIKE.windupMs && t <= s.at);
      if (feint) { feint.parried = true; S.parryWhiffs++; return null; }
      return 'parry outside its window';
    }
    const tool = stats.tools[a.tool];
    if (!tool) return 'unknown tool';
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
    // The trace hears everything — unless GHOST is walking (3 strikes free).
    let traceAdd = tool.trace || 0;
    if (traceAdd > 0 && S.ghostCharges > 0) { traceAdd = 0; S.ghostCharges--; }
    if (hearTrace(traceAdd, t)) return null;
    if (a.tool === 'decoy') {
      S.critNext = stats.decoyCrit;
      S.lastDecoyAt = t;
      // Burned defensively during a wind-up, a decoy eats the strike whole.
      const pending = allStrikes.find(s => s.kind === 'haymaker' && !s.parried && !s.eaten &&
        s.at !== undefined && t >= s.at - STRIKE.windupMs && t <= s.at);
      if (pending) pending.eaten = true;
      return null;
    }
    let dmg = (S.morphed && tool.dmgMorph !== undefined) ? tool.dmgMorph : tool.dmg;
    if (S.critNext > 0) { dmg *= (1 + S.critNext); S.critNext = 0; }
    if (a.tool === 'flood' && t - S.lastProbeAt <= COMBO.markDrownMs) {
      // MARK & DROWN: the combo pays +50% and eats the mark.
      dmg *= COMBO.markDrownMult; S.markUntil = -1;
      if (!S.combos.includes('mark-drown')) S.combos.push('mark-drown');
    } else if (a.tool !== 'probe' && t < S.markUntil) { dmg *= 1.3; S.markUntil = -1; }
    if (a.tool === 'probe') { S.markUntil = t + 4000; S.lastProbeAt = t; }
    if (t >= S.vulnFrom && t <= S.vulnUntil) {
      const bonus = dmg * (STRIKE.vulnMult - 1);
      S.vulnBonus += bonus; dmg += bonus;
      if (!S.combos.includes('open-window')) S.combos.push('open-window');
    }
    S.gateHp -= dmg;
    S.dmgTotal += dmg;
    if (a.tool === 'whisper') {
      const dps = (S.morphed && tool.dotMorph !== undefined) ? tool.dotMorph : tool.dot;
      S.dots.push({ until: t + (tool.dotSecs || 0) * 1000, dps });
      // COLD TRAIL: a Whisper on a fresh Decoy's heels dumps trace too.
      if (t - S.lastDecoyAt <= COMBO.coldTrailMs) {
        S.trace = Math.max(0, S.trace - COMBO.coldTrailDump);
        if (!S.combos.includes('cold-trail')) S.combos.push('cold-trail');
      }
    }
    if (S.gateHp <= 0) { S.gateHp = 0; S.outcome = { result: 'win', endReason: 'breach', at: t }; }
    else noteMorphCrossing();
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
      const ready = S.lastUse[tool] !== undefined ? S.lastUse[tool] + stats.tools[tool].cooldown : t;
      // A devil's GUARD (its owner's parry habits) stretches the scramble —
      // the duration rides the dealt stats, never a constant.
      const scrMs = (stats.combat && stats.combat.scrambleMs) || STRIKE.scrambleMs;
      S.lockoutUntil[tool] = Math.max(ready, t) + scrMs;
    } else {
      S.integrity -= STRIKE.dmg.clean; S.strikesTaken++; S.strikeDamage += STRIKE.dmg.clean;
    }
    if (S.integrity <= 0) {
      // THE SECOND HEART: the first zeroing blow breaks the Heart instead —
      // the fighter stands back up at HEART_RESTORE and the fight goes on.
      if (S.heartReady && !S.heartUsed) { S.heartUsed = true; S.integrity = HEART_RESTORE; }
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
    combos: S.combos, abilitiesUsed: S.abilitiesUsed, parryWhiffs: S.parryWhiffs,
    feintsShown: S.feintsShown, morphed: S.morphed, morphAt: S.morphAt,
    heartUsed: S.heartUsed, bellRung: S.bellRung
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
  for (const a of actions) if (a.tool !== 'parry' && a.tool !== 'bell' && !String(a.tool || '').startsWith('ability:')) toolUse[a.tool] = (toolUse[a.tool] || 0) + 1;
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
    drops, dropBonus,
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
  settleFight, settlePitFight, educationMeter, fmtTime
};
