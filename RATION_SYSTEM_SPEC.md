# Ration System — Rebuild Specification

**BA Farms feedlot. Rebuild of: Ration Plan Maker, Daily Feed Generator, Tractor Mode, Feed Log.**

---

## 0. Read this first — the core design decision

**All ration quantities are stored as absolute kilograms per head per day. There are no percentages anywhere in the system.**

The previous implementation stored percentages that had to be multiplied against a weight-bracket lookup at feed time. This produced two production bugs:

1. A stored value of `41` (meaning 41%) was displayed and fed as **41 kg** of maize grain.
2. Three pens weighing 131 kg, 162 kg and 187 kg were all served the identical ration, because the bracket lookup silently returned one fixed row instead of matching each pen's own weight.

Both failure modes are eliminated by storing kilograms. A stored `1.225` can only ever mean 1.225 kg. If a pen shows the wrong number, the row is wrong — there is no hidden multiplication to debug.

The cost is more rows (999 for three plans), which is irrelevant to a database and is generated automatically from a CSV.

**Do not reintroduce percentage-based storage under any circumstances.**

---

## 1. Domain model

### 1.1 Ingredient

Every feedable item, including compound mixes. **A pre-mixed concentrate ("Steady State Wanda") is an ingredient exactly like maize silage or wheat straw.** The system must not special-case it.

| Field | Type | Notes |
|---|---|---|
| `ingredient_id` | PK | |
| `name` | text | e.g. "Steady State Wanda", "Chari" |
| `unit` | enum | always `kg` |
| `is_active` | bool | inactive ingredients cannot be used in new plans |
| `in_stock` | bool | derived from inventory |
| `cost_per_kg` | decimal | current purchase price |
| `dry_matter_pct` | decimal | for reporting only |

Adding a new ingredient must require **no code change** — insert a row, and it becomes available to plans.

### 1.2 Ration Plan

| Field | Type | Notes |
|---|---|---|
| `plan_id` | PK | |
| `name` | text | e.g. `type-1` |
| `description` | text | |
| `min_adg_floor` | decimal | safety-net for reporting, not used in feeding |
| `is_default` | bool | |
| `adaptation_days` | int | default 7 |

### 1.3 Ration Row — the single source of all quantities

**One table holds both adaptation and steady-state rows.** They differ only by `phase` and `day_no`.

| Field | Type | Notes |
|---|---|---|
| `row_id` | PK | |
| `plan_id` | FK | |
| `phase` | enum | `ADAPTATION` or `STEADY` |
| `day_no` | int, nullable | 1–7 when `phase=ADAPTATION`; **NULL** when `phase=STEADY` |
| `forage_type` | enum | `silage`, `chari`, … extensible |
| `wt_min` | decimal | inclusive lower bound, kg live weight |
| `wt_max` | decimal | inclusive upper bound, kg live weight |
| `target_adg` | decimal | expected kg/day gain for this row |
| `est_cost_per_head_per_day` | decimal | computed, display only |

### 1.4 Ration Row Item — quantities

Normalised child table. **Do not put ingredients in columns.** This is what makes the system scalable to any future diet.

| Field | Type | Notes |
|---|---|---|
| `row_id` | FK | |
| `ingredient_id` | FK | |
| `qty_kg_per_head_per_day` | decimal | **absolute kilograms. Never a percentage.** |

A ration row with four ingredients has four item records. An ingredient not fed in that row either has no record or a record of `0` — both must be treated as zero.

### 1.5 Pen

| Field | Type | Notes |
|---|---|---|
| `pen_id` | PK | |
| `name` | text | |
| `plan_id` | FK | which plan this pen follows |
| `forage_type` | enum | which forage this pen is currently on |
| `cycle_start_date` | date | day 1 = this date |
| `head_count` | int | |
| `last_actual_weight_kg` | decimal | pen average at last weigh-in |
| `last_weigh_date` | date | |
| `current_target_adg` | decimal | copied from the matched row at each weigh-in |

**Animals belong to pens. Rations attach to pens, never to individual animals or to a cycle.**

---

## 2. The resolution algorithm

This is the heart of the system. It runs **once per pen, every day.**

```
function resolveRation(pen, date):

    # ---- STEP 1: days on feed -------------------------------------------
    days_on_feed = (date - pen.cycle_start_date).days + 1        # day 1 = start date

    # ---- STEP 2: projected weight ---------------------------------------
    days_since_weigh = (date - pen.last_weigh_date).days
    projected_weight = pen.last_actual_weight_kg
                     + (days_since_weigh * pen.current_target_adg)

    # ---- STEP 3: phase ---------------------------------------------------
    if days_on_feed <= plan.adaptation_days:
        phase  = 'ADAPTATION'
        day_no = days_on_feed
    else:
        phase  = 'STEADY'
        day_no = NULL

    # ---- STEP 4: row lookup — MUST use THIS pen's projected weight -------
    row = SELECT * FROM ration_row
          WHERE plan_id      = pen.plan_id
            AND forage_type  = pen.forage_type
            AND phase        = phase
            AND (day_no IS NULL OR day_no = day_no)
            AND projected_weight >= wt_min
            AND projected_weight <= wt_max

    if count(row) == 0:  raise NoMatchingRation(pen, projected_weight)
    if count(row) > 1:   raise AmbiguousRation(pen, projected_weight)

    # ---- STEP 5: quantities — read directly, no arithmetic ---------------
    items = SELECT ingredient_id, qty_kg_per_head_per_day
            FROM ration_row_item WHERE row_id = row.row_id

    return items      # already kg per head per day
```

**Step 4 is where the previous build failed.** The weight predicate must be inside the query and must reference the pen currently being resolved. Resolving once per plan, or caching a row across pens, is the bug that fed a 187 kg pen the 131 kg ration.

### 2.1 Projected weight — worked example

Pen weighed at 160.0 kg on 1 August, `current_target_adg` = 1.12.

| Date | Days since weigh | Projected weight | Bracket |
|---|---|---|---|
| 1 Aug | 0 | 160.0 | 160–164 |
| 5 Aug | 4 | 164.5 | 160–164 |
| 6 Aug | 5 | 165.6 | 165–169 |
| 14 Aug | 13 | 174.6 | 170–174 |
| 15 Aug | re-weighed at 176.2 → reset | 176.2 | 175–179 |

Recompute daily. Reset to the actual figure at every weigh-in, and copy the newly matched row's `target_adg` into `pen.current_target_adg`.

**If actual and projected differ by more than 5% at a weigh-in, raise a warning on the pen.** That divergence is an early signal of illness, underfeeding or a bad weight record.

---

## 3. Worked examples — use these as acceptance tests

Plan `type-1`, forage `chari`, **ADAPTATION day 2**. These are the exact numbers the system must produce.

| Pen | Projected wt | Bracket | Wanda | Chari | Cottonseed Cake | Toori |
|---|---|---|---|---|---|---|
| A | 131.4 | 130–134 | **1.017** | **3.368** | **0.646** | **0.350** |
| B | 161.9 | 160–164 | **1.225** | **4.347** | **0.782** | **0.350** |
| C | 187.0 | 185–189 | **1.392** | **5.135** | **0.892** | **0.350** |

**If all three pens return identical values, the bracket lookup is broken.** This is the single most important regression test in the system.

Maize Silage, Maize Grain, Maize Gluten Feed, Limestone/Minerals and Urea are all **0.000** in these rows — the maize grain, gluten feed and limestone are already inside the Steady State Wanda, and feeding them separately would double the concentrate.

Plan `type-1`, forage `silage`, **STEADY**:

| Bracket | Wanda | Silage | Toori | Cottonseed Cake | target_adg |
|---|---|---|---|---|---|
| 130–134 | 2.500 | 4.120 | 0.350 | 0.010 | 1.05 |
| 160–164 | 2.990 | 5.330 | 0.350 | 0.000 | 1.12 |
| 185–189 | 3.390 | 6.230 | 0.350 | 0.010 | 1.16 |
| 220–224 | 3.920 | 7.420 | 0.350 | 0.030 | 1.21 |

---

## 4. Ration Plan Maker

### 4.1 Import (primary path)

Plans are authored externally and imported as CSV. **This is the main way plans enter the system.**

Required header:

```
plan_id, phase, day_no, forage_type, wt_min, wt_max, target_adg,
<one column per ingredient name>, est_cost_per_head_per_day
```

Ingredient columns are matched **by name against the ingredient table**. Import must:

- Create the plan if `plan_id` is new; otherwise replace all rows for that plan.
- **Reject the entire file** if any ingredient column name does not match an active ingredient. Report the unmatched names. Do not partially import.
- **Reject the entire file** if any referenced ingredient has `in_stock = false`, unless the user explicitly confirms an override. *The system must not generate a diet from stock the farm does not have.*
- Validate every numeric field (see §7).

### 4.2 Manual editing

The UI may allow editing individual rows, but the CSV import is authoritative and must be able to overwrite cleanly. Editing must never allow a value to be entered without units — the field label must read **"kg per head per day"**.

### 4.3 Versioning

Never overwrite a plan that pens are actively using. Create a new version and let pens migrate at their next weigh-in. Feed logs must reference the plan version that was actually fed.

---

## 5. Daily Feed Generator

For each active pen, each day:

1. Run `resolveRation(pen, today)`.
2. Multiply each ingredient quantity by `pen.head_count` to get the pen batch.
3. Display **both** per-head and pen-batch figures, clearly labelled.
4. Show the resolved context: plan name, phase, day number (if adaptation), forage type, matched bracket, projected weight, head count.

The header must state the matched bracket explicitly, e.g. *"bracket 160–164 kg, projected 161.9 kg"*. Without this the operator cannot tell whether the lookup worked.

**Overrides.** An operator may override today's quantity for a pen. Overrides apply to that day's feed log only and must never mutate the plan. Log the original value, the override, and the user.

---

## 6. Tractor Mode

Aggregates the day's pens into mixing batches.

- Operator selects one or more pens.
- For each ingredient, sum `qty_per_head × head_count` across selected pens.
- Display total batch weight and a per-ingredient breakdown in **descending weight order** — the operator loads the biggest item first.
- **Only aggregate pens on the same `forage_type` and the same `phase`.** Mixing an adaptation pen with a steady-state pen into one batch produces a ration correct for neither. Warn and require confirmation.
- Round each ingredient to the nearest 0.1 kg for display; keep full precision internally.
- Show a running cost for the batch from current ingredient prices.

---

## 7. Validation rules

Enforce at import and at feed generation.

| Rule | Action on failure |
|---|---|
| Every ingredient in a plan exists and `is_active` | reject import |
| Every ingredient in a plan has `in_stock = true` | reject import, allow explicit override |
| `wt_min < wt_max` | reject row |
| Brackets within a (plan, forage, phase, day) are contiguous with no gaps or overlaps | reject import, name the offending brackets |
| Brackets span at least 100–320 kg | warn |
| `qty_kg_per_head_per_day` between 0 and 25 | reject row — **this is the check that would have caught the 41 kg and 49.9 kg errors** |
| Total ration weight per head between 1 and 40 kg | reject row |
| `target_adg` between 0.2 and 2.0 | reject row |
| `day_no` present iff `phase = ADAPTATION` | reject row |
| Exactly one row matches at resolution time | raise, block feeding for that pen |

**Never silently fall back to a default row.** A pen with no matching bracket must fail loudly. Silent fallback is what caused three pens to be fed the same ration.

---

## 8. Feed Log

One record per pen per day per ingredient.

| Field | Notes |
|---|---|
| `pen_id`, `date`, `ingredient_id` | |
| `planned_qty_kg` | per head, from the resolved row |
| `actual_qty_kg` | per head, after any override |
| `head_count` | at time of feeding |
| `batch_qty_kg` | actual × head count |
| `plan_id`, `plan_version`, `row_id` | provenance — which row produced this |
| `phase`, `day_no`, `bracket_min`, `bracket_max` | resolved context, denormalised |
| `projected_weight_kg` | what the system believed the pen weighed |
| `refusal_kg` | optional, entered next morning |
| `cost` | actual × price on that date |

Storing `row_id` and the resolved bracket is essential. Without it you cannot audit, months later, why a pen was fed a particular amount.

**Refusals** enable the intake check: `intake = offered − refused`. Target 2–5% refusal. Flag pens outside that band.

---

## 9. Reports

- **Feed & Growth**: planned vs actual intake, projected vs actual weight, ADG against `target_adg`, pens below `min_adg_floor`.
- **Bracket transitions**: when each pen moved bracket, to verify the lookup is working over time.
- **Cost per kg of gain**: cumulative feed cost ÷ actual weight gain, per pen and per cycle.
- **Stock consumption**: ingredient usage against inventory, with days-of-cover remaining.

---

## 10. Scalability requirements

The system must handle, with **no code change**:

- A new ingredient — insert an ingredient row, reference it in a plan CSV.
- A new forage type — add an enum value and the corresponding rows.
- A new plan — import a CSV.
- Different bracket widths, including non-uniform widths.
- A plan with 3 ingredients or 15.
- An adaptation period other than 7 days (`plan.adaptation_days`).
- Pens on different plans, forages and cycle days simultaneously.

Anything that requires editing code to add an ingredient or a plan is a design failure.

---

## 11. Regression test suite

Implement these as automated tests. They encode the bugs already found in production.

1. **Bracket discrimination.** Three pens at 131.4, 161.9, 187.0 kg, plan `type-1`, chari, adaptation day 2 → wanda `1.017`, `1.225`, `1.392`. *Must not be equal.*
2. **Units.** No resolved ingredient quantity exceeds 25 kg per head per day, for any pen, any plan, any bracket.
3. **Phase boundary.** Pen on day 7 resolves ADAPTATION; the same pen on day 8 resolves STEADY.
4. **Projection.** Pen weighed 160.0 with adg 1.12 → day 5 projects 165.6 and matches bracket 165–169.
5. **Weigh-in reset.** After entering an actual weight, projected weight equals the actual and `current_target_adg` updates to the new bracket's value.
6. **No match.** A pen at 400 kg with no covering bracket raises `NoMatchingRation` and blocks feeding. It does not silently use another row.
7. **Overlap detection.** Importing brackets 120–130 and 128–140 is rejected.
8. **Stock gate.** Importing a plan referencing an out-of-stock ingredient is rejected.
9. **Tractor mode isolation.** Aggregating a chari pen with a silage pen warns.
10. **Override isolation.** An override on pen A day 1 does not change pen A day 2, nor pen B.

---

## 12. Data to load

Import `ration_rows.csv`: **999 rows** covering three plans.

| Plan | Steady rows | Adaptation rows |
|---|---|---|
| `conservative` (2.7→2.5% intake) | 74 | 259 |
| `type-1` (2.9→2.7% intake) — **default** | 74 | 259 |
| `high` (3.1→2.9% intake) | 74 | 259 |

Steady rows cover silage and chari; adaptation rows are chari-based, days 1–7. Brackets are 5 kg wide from 120 to 304 kg.

Column `Steady State Wanda` is the farm's own pre-mixed concentrate: 692.5 kg makai, 242.9 kg maize gluten feed 30%, 32.7 kg meetha soda, 20.3 kg limestone, 7.6 kg mineral mixture, 4.1 kg toxin binder per 1,000 kg. It is an ingredient like any other and needs no special handling.

Salt is fed free-choice from a lick block and is deliberately not in the ration rows.
