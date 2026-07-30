// Pure, dependency-free ration resolution engine (RATION_SYSTEM_SPEC.md).
//
// No React/context imports on purpose: this is the exact logic that decides what a
// pen gets fed, so it needs to be independently unit-testable (see rationResolver.test.js)
// and auditable in one place — not buried inside a 60-line branch of a UI context hook.
// This replaces the old percentage-based getPenRationRow adaptation math, which is what
// let three real pens (A/B/C) at meaningfully different weights get fed an identical
// ration: it resolved once per plan/heuristically instead of per-pen against that pen's
// own projected weight.
//
// Absolute kg/head/day only. No percentages anywhere in this module.

export class NoMatchingRationError extends Error {
    constructor(message, context) {
        super(message);
        this.name = 'NoMatchingRationError';
        this.context = context || {};
    }
}

const dayDiff = (fromDate, toDate) => Math.floor((new Date(toDate) - new Date(fromDate)) / 86400000);

/**
 * Resolves the single deterministic ration row for a pen "as of" `today`.
 *
 * pen: { cycleStartDate, forageType, planId, lastActualWeightKg, lastWeighDate, currentTargetAdg }
 * plan: { id, adaptationDays, adgFloor }
 * rows: [{ id, planId, phase: 'ADAPTATION'|'STEADY', dayNo, forageType, wtMin, wtMax, targetAdg, estCostPerHeadPerDay }]
 * rowItems: [{ rowId, ingredientId, qtyKgPerHeadPerDay }]
 *
 * Throws NoMatchingRationError (never falls back to a nearby bracket) when zero or
 * more than one row matches — the caller must block feeding on this pen until an
 * admin fixes the plan/pen data.
 */
export function resolveRation({ pen, plan, rows, rowItems, today = new Date() }) {
    if (!pen.cycleStartDate) {
        throw new NoMatchingRationError('Pen has no cycle start date on record.', { pen });
    }
    if (pen.lastActualWeightKg == null || !pen.lastWeighDate) {
        throw new NoMatchingRationError('Pen has no weigh-in on record — cannot project weight.', { pen });
    }

    const daysOnFeed = dayDiff(pen.cycleStartDate, today) + 1;
    const daysSinceWeigh = Math.max(0, dayDiff(pen.lastWeighDate, today));
    const adg = pen.currentTargetAdg != null ? pen.currentTargetAdg : (plan?.adgFloor ?? 0);
    const projectedWeight = pen.lastActualWeightKg + daysSinceWeigh * adg;

    const adaptationDays = plan?.adaptationDays ?? 7;
    const phase = daysOnFeed <= adaptationDays ? 'ADAPTATION' : 'STEADY';
    const dayNo = phase === 'ADAPTATION' ? daysOnFeed : null;

    const matches = rows.filter(r => (
        r.planId === pen.planId &&
        r.forageType === pen.forageType &&
        r.phase === phase &&
        (phase === 'ADAPTATION' ? r.dayNo === dayNo : (r.dayNo === null || r.dayNo === undefined)) &&
        // Brackets are inclusive-integer buckets (e.g. 130-134, then 135-139) — confirmed
        // against the real ration_rows.csv data, where every adjacent pair steps by
        // exactly wtMax+1 = nextWtMin, never wtMax = nextWtMin. So the bracket's true
        // continuous coverage is [wtMin, wtMax+1) — anything else leaves 1kg-wide gaps
        // that would wrongly block feeding for in-between projected weights.
        projectedWeight >= r.wtMin && projectedWeight < r.wtMax + 1
    ));

    if (matches.length === 0) {
        throw new NoMatchingRationError(
            `No ration bracket matches this pen's projected weight (${projectedWeight.toFixed(1)}kg, ${pen.forageType}, ${phase}${dayNo ? ` day ${dayNo}` : ''}). Feeding blocked until the plan is fixed.`,
            { pen, phase, dayNo, projectedWeight }
        );
    }
    if (matches.length > 1) {
        throw new NoMatchingRationError(
            `Ration data error: ${matches.length} overlapping brackets match projected weight ${projectedWeight.toFixed(1)}kg. Feeding blocked — fix the plan's bracket overlap.`,
            { pen, phase, dayNo, projectedWeight, matches }
        );
    }

    const row = matches[0];
    const items = rowItems.filter(i => i.rowId === row.id);

    return {
        row,
        items,
        projectedWeight,
        phase,
        dayNo,
        bracketMin: row.wtMin,
        bracketMax: row.wtMax,
        daysOnFeed
    };
}

/**
 * >5% divergence check run at weigh-in time: compares the new actual weight against
 * what the pen should weigh given its previous weigh-in + elapsed days at the target
 * ADG that was in force back then. Early warning for illness/underfeeding/bad record.
 */
export function getWeightDivergence({ prevWeightKg, prevDate, prevTargetAdg, newWeightKg, newDate }) {
    const days = Math.max(1, dayDiff(prevDate, newDate));
    const projected = prevWeightKg + days * (prevTargetAdg || 0);
    if (projected <= 0) return { pctDiff: 0, warn: false, projected };
    const pctDiff = (newWeightKg - projected) / projected;
    return { pctDiff, warn: Math.abs(pctDiff) > 0.05, projected };
}

/**
 * Bracket contiguity check for a set of ration rows, grouped by (forageType, phase,
 * dayNo): sorted brackets must have wtMax[i] + 1 === wtMin[i+1] (inclusive-integer
 * buckets, e.g. 130-134 then 135-139 — verified against every boundary in the real
 * ration_rows.csv dataset) with no gaps or overlaps. Returns a list of problem pairs
 * (empty = fully contiguous). Used both by CSV import validation (rejects the whole
 * file) and by any future plan-editor sanity check.
 */
export function findContiguityGaps(rows) {
    const groups = {};
    rows.forEach(r => {
        const key = `${r.forageType}|${r.phase}|${r.dayNo == null ? '' : r.dayNo}`;
        (groups[key] = groups[key] || []).push(r);
    });

    const problems = [];
    Object.entries(groups).forEach(([key, groupRows]) => {
        const sorted = [...groupRows].sort((a, b) => a.wtMin - b.wtMin);
        for (let i = 0; i < sorted.length - 1; i++) {
            if (Math.abs(sorted[i].wtMax + 1 - sorted[i + 1].wtMin) > 0.001) {
                problems.push({ key, a: sorted[i], b: sorted[i + 1] });
            }
        }
    });
    return problems;
}
