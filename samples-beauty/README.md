# THE BEAUTY PASS — samples

Rendered-page captures (full HTML as served) from a seeded LOCAL world
(throwaway DATA_DIR — the live world was never touched; no claims were made
and no claimed-fighter play happened on the live host). As with the Phase 3
and Descent sample sets, the build seat's sandbox has no browser with a
network path, so pixel screenshots could not be produced from here; these
are the exact pages the server served, eyeballed line by line. Steven
judges the final look on his phone, on the live site.

The seeded world: two claimed fighters. "Delver" carries a real build —
EMBERBRAND (LEGENDARY Flood, No. 1) and a RARE Probe lens and an EPIC body
plate worn, an EPIC Whisper piece unworn, THE DOUBLE HARVEST (GODFORGED,
No. 1, 2 of 3 charges) on the shelf, the Keeper-style satchel (Founder's
Ember No. 1, Mirror Wrap, Second Heart, Stillbell, Anchor Stitch), three
abilities evolved (Overdrive / Ghost / Rapid Cycling), a Descent record,
and a devil standing in the Pit. "Rival" stands as the second devil.

## before/ — the old skin, same seeded world
- `before/landing.html` — the landing page before the pass: the header is
  one flex row (`brand` + `nav` with flex-wrap) — at phone widths the links
  wrap under and into the brand, the collision in Steven's screenshot.
- `before/arena-fight.html` — the Fight door before the Armory existed.
- `before/profile.html` — the profile before the pass.

## after (this folder)
- `landing.html` — the front door in the new system: rebuilt header
  (brand + ☰ menu button + `nav#topnav`; at ≤900px the links fold into a
  dropdown under the bar), the ember layer, the display-serif headings,
  the ember halo behind the hero gate, textured panels.
- `arena-fight-armory.html` — the Fight door with THE ARMORY in the
  pre-fight card: five stands (Flood/Probe/Whisper/Decoy/Body) with rarity
  frames and full affix lines, the treasure shelf with serials and the
  GODFORGED charges, and the lit abilities. This is the ceremony a
  signed-in fighter meets before BEGIN THE BREACH; site.js folds it to a
  one-line build summary on later loads of the same session.
- `descent-door-armory.html` — the Descent door harmonized: the same
  Armory above the declarations (Second Heart / Stillbell / GODFORGED
  select all intact), the gothic stage texture, ember glow under the gate.
- `pit-hall.html` — the Pit in the shared panel texture; devil cards still
  carry their "Wearing:" gear lines.
- `profile-satchel.html` — the profile/satchel in the shared system.
- `evolution-web.html` — the Evolution Web in the shared system.

## what to look for on a phone (Steven's check)
1. Header: brand on one line, ☰ at the right; tapping it opens the links
   as a clean column. Nothing overlaps, at any width.
2. Fight → the Armory stands light up in order; BEGIN THE BREACH is one
   scroll away inside the stage card; on the next visit the Armory is a
   single line with an "Unfold the armory" button.
3. Tool pods carry their sigils (eye / dawn-waves / voice / phantom gate)
   and a worn tool names its gear under the trace line.
4. PARRY is a shield plate now — gold shield sigil on steel.
5. Embers drift up the whole house, faintly; they vanish entirely for
   anyone with reduced-motion set.
