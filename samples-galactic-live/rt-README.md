# THE GALACTIC — REAL-TIME LAYER (G1.5) SAMPLES

Build `2026.11.27-galactic-rt`. Captured from a **seeded local world** (test
captains, file store) running the exact shipped code — the same discipline as
the G1 set: these are the live-built pages as served, not mock-ups.

## The files

- **rt-fly-page.html** — the battle page (`/galactic/fly`) as served to a
  signed-in captain: the real-time layer (`/js/galactic-rt.js`) loads ahead of
  the classic deck script, which stands by as the fail-soft fallback
  (`?classic=1` forces it). The page carries the new build stamp and the
  Phase 1 stage framing in its copy.
- **rt-map-fresh.html** — the star map for a captain who has not cleared
  Sector 1: the Phase 1 stage pips (eight stages, Stage 8 = THE HERALD) on the
  Emberfall card, Sector 2 locked with its ordinary face — **no Ledger hook**.
- **rt-map-cleared.html** — the same map for a captain who HAS cleared
  Sector 1 (seeded clear, first-clear receipt to "ClearCaptain"): the pips
  stand full, the first-clear line carries 🖋 the Ledger's seal, and Sector
  2's lock face has changed — **THE LEDGER HAS YOUR NAME NOW** — while the
  sector stays honestly locked.
- **rt-state-before-roster.json / rt-state-before-public.json** — the LIVE
  production world's deck roster and public tallies read immediately before
  the deploy (read-only). The matching `rt-state-after-*.json` files land
  beside them after live verification; the two accounts and tallies must read
  identical except Steven's own live play.

## What is NOT here, said plainly

No pixel screenshots of the real-time battle in motion. The only Chromium on
this machine is the platform's sandboxed browser, which is network-isolated
from local servers (verified twice: loopback and LAN address both return a
browser error page), so it cannot render the seeded local world; rendering
the production world instead would not be a seeded sample. The battle
layer's behavior is instead proven by `scripts/verify-realtime.mjs` (41
checks: wheel geometry unit-tested from the shipped client, referee parity,
forgery voids, and a full eight-stage seeded walk driven through the real
endpoints). The real render check is Steven's iPhone — the layer was built
for his thumb, and his first flight is the verdict that counts.
