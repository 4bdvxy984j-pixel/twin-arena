# THE TWIN ARENA — Phase 2

A game about Gatekeeper's Twin: the sparring partner that learns — and, since
Phase 2, **fights back**. You are inside the system; the gate is its firewall; the
Twin is its guardian ICE. You attack a gate of chrome and light with four tools;
every pattern you use is fingerprinted, and the Twin grows familiar with your
shapes — repeat a trick and it lands weaker. Between fights it counter-evolves
against your favorite tools (the grudge), and you spend the mutation points you
earn down an evolution web so your next fight hits different. During the fight
the Twin throws strikes back at you, and every loud move you make feeds a trace
that can get you caught.

Built and verified **locally only**. It is not deployed anywhere.

## Run it

```
node src/server.js          # or: npm start
```

- `PORT` — port to listen on (default 4170)
- `ADMIN_KEY` — key for the read/write deck at `/deck` (default `twin-deck` — change it before any public use)
- `DATA_DIR` — where state + uploads live (default `./data`)

No dependencies, no build step. State is a single JSON file (`data/state.json`,
atomic saves); uploaded avatars live in `data/uploads/`.

## The fight (Phase 2)

Three bars run every round, all refereed by the server:

- **GATE** — the gate's integrity. Break it to 0 to win (a *breach*).
- **INTEGRITY** — *your* health, 100. The Twin strikes on a rhythm set by the
  deck's aggression dial:
  - **Haymakers** are telegraphed: a wind-up (~1.6s, generous enough for a
    phone) with the eye flaring wide. Land the **PARRY** in the window — the
    big PARRY button, tap-the-eye, or the spacebar — and the strike is negated
    and the gate hangs **vulnerable** for ~3.5s, taking double damage.
    A Decoy burned during the wind-up also eats the strike whole.
  - **Glancing hits** scramble one of your tools: its cooldown is extended
    (+2.6s) server-side, and using it inside the lockout voids the bout.
  - **Clean hits** cost integrity and shake the screen.
  At 0 integrity you are **thrown out of the arena** — a defeat with the same
  verdict-card and points treatment as any loss.
- **TRACE** — the detection meter, 0–100%. Loud tools spike it (Flood +14,
  Probe +3, Whisper +0), quiet time cools it (−6/s), a Decoy dumps 18%. At
  100% you are **caught**: the round ends at once, a third distinct defeat
  beside the integrity loss and the timeout. Per-action trace deltas are
  printed on the tool buttons so the meter is always legible.

Balance was re-tuned in Phase 2 after the verify bot exposed Probe-spam as the
dominant strategy (Probe 4 dmg/0.8s out-DPSed Flood): Probe is now 3 dmg on a
1.1s cooldown at 9 energy — the scout and marker, not the kill path.

### The round protocol

1. `POST /api/fight/start` — the server deals the fight: computed stats (with
   per-tool **trace costs** and a `combat` block: your integrity, parry cost,
   strike damages, vulnerability numbers) and a **strike schedule** — seeded,
   stored server-side, kinds/timings/targets fixed for the round.
2. The client plays the round locally, mirroring the referee exactly: same
   energy/cooldown economy, same strike resolution, same trace math.
3. `POST /api/fight/finish` — the client reports its action log (now including
   `parry` actions) and its claimed outcome. The server **replays the whole
   round** through `simulateRound` — strike timing from its own schedule,
   parry windows checked against the wind-ups, glance lockouts, integrity and
   trace computed server-side — and the replay, not the claim, is the verdict:
   - a claim that disagrees with the replay is corrected to the replay
     (claim a win while the replay says your trace hit 100% → **caught**);
   - an *impossible* log (cooldown/energy violations, actions after the round
     ended, a parry outside any window, a scrambled tool used inside its
     lockout) is **voided**: remembered, but it teaches nothing and earns
     nothing. Phase 1's plausibility validation is fully retained and extended,
     not weakened.

## The skin (Phase 2)

Cyberpunk 2077 as the north star: neon-noir — cyan / magenta / acid yellow on
black, the gate re-skinned as a chrome-and-neon fortress-face, the Twin's optic
with a chrome glitch treatment, scanline + grain overlays, glitch-stutter
callouts ("IT HAS SEEN THIS SHAPE" tears sideways), cyberdeck UI chrome,
angular clipped panels and type. Landing, arena, verdict and profile are one
world. Touch targets and readability were kept: the PARRY control is the
biggest button in the room when a haymaker winds up.

## What the game is

- **Landing** — the arena door: public education meter ("shapes learned /
  fighters / bouts"), a live spectator rail of real recent fights, a
  leaderboard, FIGHT button.
- **BREACH mode** — canvas gate (rings that lose segments as integrity falls, a
  watching eye that flares, narrows as it learns, and winds up before it
  strikes), 4 tools + PARRY with energy + cooldown economy, 2:30 rounds, three
  defeat states (thrown out / caught / timeout) and the breach, touch-first
  controls (big buttons, tap-the-gate for Probe, tap-the-eye or spacebar to
  parry, keys 1–4).
- **The Twin learns** — attack patterns (singles, consecutive pairs, bursts)
  are fingerprinted server-side. Familiarity decays a tool's damage and is
  shown on its button. After every fight the Twin armors against your
  most-used tools; that hardening is *yours* — your personal Twin carries a
  grudge across visits.
- **Evolution web** — 12 nodes across Vectors / Deception / Patience / Speed.
  Purchases persist per fighter and change real numbers in the next fight (the
  stats are computed server-side and handed to the client at fight start).
- **Verdict cards** — `/verdict/<id>`: result and ending (breach / thrown out /
  caught / timeout), time, points, shapes taught, how the Twin hardened in
  answer, the fight line (parries landed, strikes taken, trace peak, integrity
  left), plus share copy.
- **Profiles** — email + password (scrypt-hashed), photo upload (PNG/JPEG/GIF/
  WebP, ≤ 2 MB, magic-byte checked), profile dossier: record, points,
  curriculum (shapes taught + how known they are), the grudge page (per-tool
  hardening bars + challenge feed), public-leaderboard toggle. Guest fighters
  play immediately; signing up *claims* the guest record — points, web and
  grudge carry over.
- **Challenge links** — `/challenge/<token>`: anyone opening one fights the
  owner's counter-evolved Twin instance (the owner's hardening applies). The
  result is delivered to the owner's grudge feed and the rail.
- **Deck** — `/deck`: the arena's controls, behind a key. See **The Super Deck**
  below.
- **Multiplayer is asynchronous** — one shared global education, spectator
  rail, leaderboards, challenge links. There is **no live PvP**, and the copy
  says so.

## The Super Deck (Phase 2.5)

`/deck` is a god-mode toybox in the same neon skin — chunky arcade controls,
LEDs that mean things — and every control is *real*: each one is proven in the
verify walk to change the referee's math or the arena's face, never just the
page.

- **THE WALL** — live readouts: the education meter (shapes / fighters /
  bouts), today's verdict tallies from the full ledger (breached / thrown out
  / caught / turned back), the latest fights, and the top of the leaderboard.
  The meter and rail keep polling while the deck is open.
- **STORM** — fire a timed event (deck sets the minutes, default 30). While
  it runs, every settled verdict pays **double points** and the Twin's
  aggression has a floor at storm level (1.6) no matter how low the dial
  sits — the strike schedule and the gate's healing both answer to it. The
  weather is snapshotted onto each fight at start, so the referee settles a
  round under the weather it was actually fought in. Landing and arena carry
  the storm banner; the deck shows the storm clock and can calm it early.
- **THE TWIN SPEAKS** — a broadcast box: the deck writes a line (plain text,
  140 characters, HTML-escaped everywhere it renders) and the Twin says it to
  the whole arena — banner on the landing and in the arena — until its expiry
  (deck-set minutes, or blank for until-cleared) or until it is silenced.
- **OPEN THE FLOODGATES** — a chaos toggle: while on, **trace gains halve**
  across the arena. The halving is dealt into each new fight's stats at
  start, so the referee and the client's HUD read the same halved costs (a
  Decoy's trace *dump* is not a gain and is never halved). The arena shows
  the state on its face while it lasts; the deck keeps its warning lit.
- **SPOTLIGHT** — pin any real fighter's challenge — by fighter id or by
  challenge token — to the landing as **Tonight's Devil**, with their photo,
  record and challenge link. A pin that matches no fighter is refused with a
  plain error and changes nothing.
- **The dials & the big switch** — the Phase 1 controls, unchanged: Twin
  aggression (gate healing + strike rate), learning speed, and FREEZE, which
  closes the arena behind a maintenance card while the deck stays reachable.

### The member-key tie

The deck answers to two keys:

- **`ADMIN_KEY`** — the break-glass key from the environment. It always
  works, for everything, including tying and untying.
- **The owner's Gatekeeper Member Key** — after a one-time **tie**. Opened
  with the admin key, the deck offers "Tie this deck to my Member Key": the
  owner pastes his Member Key *once* into that form (on the live site, over
  HTTPS). The server stores **only a scrypt hash** of it — the same hashing
  as fighter passwords — as the deck's member tie. The key value itself is
  never stored, logged, or echoed into any page. From then on the deck also
  opens by pasting the Member Key at the deck door (mirroring Gatekeeper's
  own "Sign in with my Member Key"); that sign-in mints a deck session
  cookie so the key never rides a URL or a form again. A **remove-tie**
  control (admin key required) clears the hash and every member deck
  session.
- The tie also **binds the owner's fighter**: linking creates — or claims,
  if one already exists — the arena profile under his Gatekeeper identity
  (email `stevenh18818@gmail.com`, display name **Steven Hall**, flagged as
  the house owner), so his profile, his devil, and his grudge page are
  *him*, the member, not a random signup.

## What it is not

- HOLD THE GATE mode, the defender evolution web, seasons/generations,
  Gatekeeper Member Key sign-in *as a fighter login* (the member key opens
  the deck via the tie above; fighter sign-in is still email + password),
  chain receipts, and any crossover of arena education into the live
  Shield — all later phases, per the design sketch
  (`~/workspace/gatekeeper/THE-TWIN-ARENA-DESIGN-2026-11-26.md`).
- The Twin's "learning" is pattern memory + counter-adaptation + evolution
  trees — real learning in the game sense, not a language model. The copy
  never claims more.

## Verify

```
npm run verify   # two batteries: scripts/verify.mjs (:4199) walks the full
                 # member path over HTTP; scripts/verify-deck.mjs (:4198)
                 # walks the Super Deck. Both use temp DATA_DIRs.
```

Phase 2's walk (49 checks) covers everything Phase 1 proved, plus: strikes
landing until an idle fighter is thrown out at 0 integrity (verdict + points);
a parried haymaker opening the vulnerability window with measurably doubled
damage inside it; a forged parry outside its window voided; a glancing hit's
scramble enforced server-side (early use voids, patient use settles); flood
spam caught mid-round by the trace — including a false "win" claim resolving
as caught; whisper-led play keeping the trace near zero; a Decoy dumping trace
measured in the referee itself; and the aggression dial measurably changing
the strike rate (37 strikes vs 9 across a full round at 2.0 vs 0.5).

Phase 2.5's walk (50 more checks, 99 total) proves the Super Deck end to end:
floodgates halving a loud log's trace in the referee (14 → 7, in the dealt
stats and in a settled verdict's peak trace); a storm settling an identical
win for exactly double points, its aggression floor overriding a 0.5 dial
(gate regen 1.76, strike count up), the storm banner on the door, and a calm
idle loss paying 13 against the storm's 26; the broadcast standing on landing
and arena, escaped, and cleared; the spotlight pinned by token and by fighter
id, a bogus pin refused with the real pin untouched; and the member-key tie —
the raw test key asserted *absent* from the data file, only its scrypt hash
stored, the owner fighter bound as Steven Hall under the member email, the
member key opening the deck and working a control through its session cookie,
a wrong key refused, the admin key working throughout, and remove-tie
clearing it all. The Phase 1 dial/freeze battery is re-run as regression.

**UNTESTED, plainly:** the by-eye / by-finger feel of the fight — telegraph
readability, parry timing on a real phone, screen shake, the glitch skin in a
real browser. The verify walk proves the mechanics exist, validate and settle;
it cannot prove the game *feels* wild. First visual check is owed on a real
device before any deployment talk.
