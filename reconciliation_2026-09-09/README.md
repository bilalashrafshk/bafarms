# Ear-tag reconciliation — 2026-09-09

What this was: after the Sunday 06-09 weigh-in, tags got shuffled/lost/re-applied across
pens A/B and C/D. This folder holds the scripts that reconciled old tags to new tags and
wrote the resulting weights into the live database, simulating a human entering them via
the portal (same LOG_WEIGHT / rfid-change / pen-transfer code paths `api/farm.js` uses).

## To undo everything this did

```
cd "/Users/bilalashraf/BA Foods"
node reconciliation_2026-09-09/undo.js
```

Reads `backup.json` (the pre-write snapshot of every row touched) and restores the DB
exactly as it was — deletes every inserted weight/event row, restores every renamed
tag/pen/status back to its prior value. Single command, fully reversible. After it runs,
`backup.json` is renamed to `backup.reverted.json` so it can't accidentally be run twice.

If `backup.json` is missing, it's already been undone (or never applied).

## What was actually decided (in case you need to re-litigate any of it later)

- **AB pen**: 21 tags unchanged, 6 clean reassignments (67→17, 98→85, 52→68, 90→87,
  28→10, 05→55), plus **65→22** by elimination — AB is a closed 29-animal pool, so once
  the other 6 pairs were made, tag 22 (144kg) had to be tag 65's animal (last 223.5kg,
  2026-08-20). That implies a **-3.98 kg/day ADG** (~79.5kg apparent loss in 20 days) —
  not a plausible normal growth curve. Worth a physical check on this animal (illness, or
  the 08-20 entry was mis-keyed).
- **Tag 93 / animal id 34**: stays in pen A, no pen/status change — just logged today's
  184kg reading (ADG +0.60, clean). AB count stays 29, CD stays 35.
- **CD pen**: 20 tags unchanged, 11 reassignments (91→70, 13→75, 17→96, 79→52, 55→45,
  68→66, 22→99, 03→23, 76→64, 85→100, 87→91). Tag 98 was originally going to be renamed
  to "58" but that would've collided with an existing untouched animal already wearing
  rfid 58 — cancelled, tag 98 kept its own number instead.
- **Untouched / unresolved** (all three belong to C/D, all Quarantined; no Sunday or
  today reading exists anywhere in the source data for them, so there's nothing to write
  until confirmed on-site):
  - tag 08 (pen C) — last known 135kg, 2026-08-14 — ✓ matches the 35-tag written CD roster
  - tag 46 (pen D) — last known 201kg, 2026-08-21 — ✗ **does NOT appear anywhere in the
    35-tag written CD roster you sent.** Every other CD tag in the DB checks out against
    that list; this is the one exception. Left as-is (no rename attempted — guessing a
    replacement number isn't safe); needs a physical look at this animal's ear to confirm
    what it's actually wearing.
  - tag 58 (pen D) — last known 226kg, 2026-08-21 — ✓ matches the 35-tag written CD roster
- Side effect: fixed a pre-existing data bug where two different animals (ids 11 and 43)
  both had rfid "98" — id 11 got renamed to 85 as part of this reconciliation, resolving it.

## Final ADG (from last weigh-in, pooled = total gain ÷ total animal-days)

- AB: 29 animals with prior history, pooled ADG **0.180 kg/day** (dragged down by the
  65→22 forced pairing above)
- CD: 32 animals with prior history, pooled ADG **0.185 kg/day**
