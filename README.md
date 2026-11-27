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
- **Deck** — `/deck?key=<ADMIN_KEY>`: fights/shapes readouts plus two working
  dials (aggression — which now also sets how often the Twin strikes — and
  learning speed) and a freeze switch that closes the arena behind a
  maintenance card. The deck stays reachable while frozen.
- **Multiplayer is asynchronous** — one shared global education, spectator
  rail, leaderboards, challenge links. There is **no live PvP**, and the copy
  says so.

## What it is not

- HOLD THE GATE mode, the defender evolution web, seasons/generations, daily
  storm events, Gatekeeper Member Key sign-in, chain receipts, and any
  crossover of arena education into the live Shield — all later phases, per
  the design sketch (`~/workspace/gatekeeper/THE-TWIN-ARENA-DESIGN-2026-11-26.md`).
- The Twin's "learning" is pattern memory + counter-adaptation + evolution
  trees — real learning in the game sense, not a language model. The copy
  never claims more.

## Verify

```
npm run verify   # boots a throwaway instance on :4199 with a temp DATA_DIR and
                 # walks the full member path over HTTP, printing evidence per step
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

**UNTESTED, plainly:** the by-eye / by-finger feel of the fight — telegraph
readability, parry timing on a real phone, screen shake, the glitch skin in a
real browser. The verify walk proves the mechanics exist, validate and settle;
it cannot prove the game *feels* wild. First visual check is owed on a real
device before any deployment talk.
