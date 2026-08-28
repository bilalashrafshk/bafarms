// Regression suite for the pure ration resolution engine (RATION_SYSTEM_SPEC.md §11).
// Test 1 below directly encodes the live incident this whole revamp fixes: pens A, B, C
// (131.4/161.9/187.0 kg) were all being fed an identical ration because the old system
// resolved once per plan instead of per-pen against that pen's own projected weight.
// Worked numbers (bracket + ingredient qtys) are taken verbatim from spec §3.

import { describe, it, expect } from 'vitest';
import { resolveRation, resolveIngredientRampRow, getWeightDivergence, findContiguityGaps, NoMatchingRationError } from './rationResolver';

const plan = { id: 'type-1', adaptationDays: 7, adgFloor: 1.0 };

// Spec §3: plan type-1, forage chari, ADAPTATION day 2 — three brackets, distinct
// Wanda/Chari/Cottonseed Cake/Toori quantities per pen.
const chariAdaptationDay2Rows = [
    { id: 1, planId: 'type-1', phase: 'ADAPTATION', dayNo: 2, forageType: 'chari', wtMin: 130, wtMax: 134, targetAdg: 0.91 },
    { id: 2, planId: 'type-1', phase: 'ADAPTATION', dayNo: 2, forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.00 },
    { id: 3, planId: 'type-1', phase: 'ADAPTATION', dayNo: 2, forageType: 'chari', wtMin: 185, wtMax: 189, targetAdg: 1.03 }
];
const chariAdaptationDay2Items = [
    { rowId: 1, ingredientId: 'wanda', qtyKgPerHeadPerDay: 1.017 },
    { rowId: 1, ingredientId: 'chari', qtyKgPerHeadPerDay: 3.368 },
    { rowId: 1, ingredientId: 'cottonseedCake', qtyKgPerHeadPerDay: 0.646 },
    { rowId: 1, ingredientId: 'toori', qtyKgPerHeadPerDay: 0.350 },
    { rowId: 2, ingredientId: 'wanda', qtyKgPerHeadPerDay: 1.225 },
    { rowId: 2, ingredientId: 'chari', qtyKgPerHeadPerDay: 4.347 },
    { rowId: 2, ingredientId: 'cottonseedCake', qtyKgPerHeadPerDay: 0.782 },
    { rowId: 2, ingredientId: 'toori', qtyKgPerHeadPerDay: 0.350 },
    { rowId: 3, ingredientId: 'wanda', qtyKgPerHeadPerDay: 1.392 },
    { rowId: 3, ingredientId: 'chari', qtyKgPerHeadPerDay: 5.135 },
    { rowId: 3, ingredientId: 'cottonseedCake', qtyKgPerHeadPerDay: 0.892 },
    { rowId: 3, ingredientId: 'toori', qtyKgPerHeadPerDay: 0.350 }
];

// Pen weighed same-day as `today`, so projectedWeight === lastActualWeightKg exactly
// (daysSinceWeigh = 0) — isolates the bracket-lookup logic from the projection math,
// which is tested separately below.
const today = new Date('2026-01-10');
const cycleStartDate = '2026-01-09'; // daysOnFeed = 1(diff) + 1 = 2 -> ADAPTATION day 2

const makePen = (weightKg, overrides = {}) => ({
    cycleStartDate,
    forageType: 'chari',
    planId: 'type-1',
    lastActualWeightKg: weightKg,
    lastWeighDate: '2026-01-10',
    currentTargetAdg: 1.0,
    ...overrides
});

describe('resolveRation — bracket discrimination (spec §3, the live A/B/C incident)', () => {
    it('resolves three distinct wanda quantities for three pens at different projected weights', () => {
        const a = resolveRation({ pen: makePen(131.4), plan, rows: chariAdaptationDay2Rows, rowItems: chariAdaptationDay2Items, today });
        const b = resolveRation({ pen: makePen(161.9), plan, rows: chariAdaptationDay2Rows, rowItems: chariAdaptationDay2Items, today });
        const c = resolveRation({ pen: makePen(187.0), plan, rows: chariAdaptationDay2Rows, rowItems: chariAdaptationDay2Items, today });

        const wandaOf = (result) => result.items.find(i => i.ingredientId === 'wanda').qtyKgPerHeadPerDay;

        expect(wandaOf(a)).toBeCloseTo(1.017, 5);
        expect(wandaOf(b)).toBeCloseTo(1.225, 5);
        expect(wandaOf(c)).toBeCloseTo(1.392, 5);

        // The single most important regression test in the system (spec §3): if all
        // three come back equal, the bracket lookup has regressed to the old bug.
        expect(wandaOf(a)).not.toBe(wandaOf(b));
        expect(wandaOf(b)).not.toBe(wandaOf(c));
        expect(wandaOf(a)).not.toBe(wandaOf(c));

        expect(a.bracketMin).toBe(130);
        expect(b.bracketMin).toBe(160);
        expect(c.bracketMin).toBe(185);
    });
});

describe('resolveRation — phase boundary', () => {
    const steadyRow = { id: 10, planId: 'type-1', phase: 'STEADY', dayNo: null, forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.12 };
    const adaptationRow = { id: 11, planId: 'type-1', phase: 'ADAPTATION', dayNo: 7, forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.12 };
    const rows = [steadyRow, adaptationRow];
    const rowItems = [{ rowId: 10, ingredientId: 'wanda', qtyKgPerHeadPerDay: 3.0 }, { rowId: 11, ingredientId: 'wanda', qtyKgPerHeadPerDay: 2.9 }];

    it('day 7 (cycleStart 6 days ago) resolves as ADAPTATION', () => {
        const pen = makePen(161.9, { cycleStartDate: '2026-01-04' }); // daysOnFeed = 6+1 = 7
        const result = resolveRation({ pen, plan, rows, rowItems, today });
        expect(result.phase).toBe('ADAPTATION');
        expect(result.dayNo).toBe(7);
    });

    it('day 8 (cycleStart 7 days ago) resolves as STEADY for the same pen/weight', () => {
        const pen = makePen(161.9, { cycleStartDate: '2026-01-03' }); // daysOnFeed = 7+1 = 8
        const result = resolveRation({ pen, plan, rows, rowItems, today });
        expect(result.phase).toBe('STEADY');
        expect(result.dayNo).toBeNull();
    });
});

describe('resolveRation — projection math', () => {
    it('projects weight forward from the last weigh-in using the pen ADG', () => {
        const pen = {
            cycleStartDate: '2025-12-20', // well past the 7-day adaptation window -> STEADY
            forageType: 'silage',
            planId: 'type-1',
            lastActualWeightKg: 160.0,
            lastWeighDate: '2026-01-01',
            currentTargetAdg: 1.12
        };
        const rows = [{ id: 20, planId: 'type-1', phase: 'STEADY', dayNo: null, forageType: 'silage', wtMin: 160, wtMax: 165, targetAdg: 1.12 }];
        // 4 days after the weigh-in: 160.0 + 4*1.12 = 164.48kg
        const result = resolveRation({ pen, plan, rows, rowItems: [], today: new Date('2026-01-05') });
        expect(result.projectedWeight).toBeCloseTo(164.48, 5);
        expect(result.bracketMin).toBe(160);
    });
});

describe('resolveRation — inclusive-integer bracket boundaries (real ration_rows.csv convention)', () => {
    // Real data uses adjacent brackets like 130-134 then 135-139 (wtMax+1 = nextWtMin,
    // never wtMax = nextWtMin). A fractional projected weight sitting in the "gap" between
    // two integer labels (e.g. 134.5, between 130-134 and 135-139) must still resolve —
    // it belongs to the lower bracket's true continuous coverage [130, 135).
    const rows = [
        { id: 1, planId: 'type-1', phase: 'STEADY', dayNo: null, forageType: 'chari', wtMin: 130, wtMax: 134, targetAdg: 1.0 },
        { id: 2, planId: 'type-1', phase: 'STEADY', dayNo: null, forageType: 'chari', wtMin: 135, wtMax: 139, targetAdg: 1.0 }
    ];

    it('resolves a fractional weight between the two integer labels into the lower bracket', () => {
        const pen = makePen(134.5, { cycleStartDate: '2026-01-02' }); // daysOnFeed = 9 -> STEADY
        const result = resolveRation({ pen, plan, rows, rowItems: [], today });
        expect(result.bracketMin).toBe(130);
    });

    it('resolves a weight exactly on the upper integer label (134) into that same bracket', () => {
        const pen = makePen(134, { cycleStartDate: '2026-01-02' });
        const result = resolveRation({ pen, plan, rows, rowItems: [], today });
        expect(result.bracketMin).toBe(130);
    });

    it('resolves a weight exactly on the next integer label (135) into the next bracket', () => {
        const pen = makePen(135, { cycleStartDate: '2026-01-02' });
        const result = resolveRation({ pen, plan, rows, rowItems: [], today });
        expect(result.bracketMin).toBe(135);
    });
});

describe('resolveRation — no-match blocking', () => {
    it('throws NoMatchingRationError (never a nearest-bracket fallback) when weight is outside every bracket', () => {
        const rows = [{ id: 30, planId: 'type-1', phase: 'STEADY', dayNo: null, forageType: 'silage', wtMin: 160, wtMax: 164, targetAdg: 1.12 }];
        const pen = makePen(999, { forageType: 'silage', cycleStartDate: '2026-01-01' });
        expect(() => resolveRation({ pen, plan, rows, rowItems: [], today })).toThrow(NoMatchingRationError);
    });

    it('throws NoMatchingRationError when two brackets overlap and both match (data-integrity bug)', () => {
        const rows = [
            { id: 40, planId: 'type-1', phase: 'STEADY', dayNo: null, forageType: 'silage', wtMin: 160, wtMax: 165, targetAdg: 1.12 },
            { id: 41, planId: 'type-1', phase: 'STEADY', dayNo: null, forageType: 'silage', wtMin: 163, wtMax: 168, targetAdg: 1.12 }
        ];
        const pen = makePen(164, { forageType: 'silage', cycleStartDate: '2026-01-01' });
        expect(() => resolveRation({ pen, plan, rows, rowItems: [], today })).toThrow(NoMatchingRationError);
    });
});

describe('resolveRation — mixed forage type support', () => {
    it('resolves a plan row with forageType="mixed" for pens configured as silage, chari, or mixed', () => {
        const rows = [{ id: 50, planId: 'mixed-plan', phase: 'STEADY', dayNo: null, forageType: 'mixed', wtMin: 200, wtMax: 205, targetAdg: 1.12 }];
        const rowItems = [
            { rowId: 50, ingredientId: 'silage', qtyKgPerHeadPerDay: 4.0 },
            { rowId: 50, ingredientId: 'chari', qtyKgPerHeadPerDay: 3.5 }
        ];
        const planMixed = { id: 'mixed-plan', adaptationDays: 7, adgFloor: 1.0 };

        const penSilage = makePen(201.0, { planId: 'mixed-plan', forageType: 'silage', cycleStartDate: '2026-01-01' });
        const penChari = makePen(201.0, { planId: 'mixed-plan', forageType: 'chari', cycleStartDate: '2026-01-01' });
        const penMixed = makePen(201.0, { planId: 'mixed-plan', forageType: 'mixed', cycleStartDate: '2026-01-01' });

        expect(resolveRation({ pen: penSilage, plan: planMixed, rows, rowItems, today }).items).toHaveLength(2);
        expect(resolveRation({ pen: penChari, plan: planMixed, rows, rowItems, today }).items).toHaveLength(2);
        expect(resolveRation({ pen: penMixed, plan: planMixed, rows, rowItems, today }).items).toHaveLength(2);
    });
});

describe('findContiguityGaps', () => {
    // Brackets are inclusive-integer buckets (e.g. 120-124, then 125-129) — this is the
    // real convention used throughout ration_rows.csv (verified against all 972 adjacent
    // boundary pairs in the live dataset: every one steps by wtMax+1 = nextWtMin).
    it('reports no problems for a fully contiguous bracket set', () => {
        const rows = [
            { forageType: 'silage', phase: 'STEADY', dayNo: null, wtMin: 120, wtMax: 124 },
            { forageType: 'silage', phase: 'STEADY', dayNo: null, wtMin: 125, wtMax: 129 },
            { forageType: 'silage', phase: 'STEADY', dayNo: null, wtMin: 130, wtMax: 134 }
        ];
        expect(findContiguityGaps(rows)).toHaveLength(0);
    });

    it('names the offending brackets when a gap exists', () => {
        const rows = [
            { forageType: 'silage', phase: 'STEADY', dayNo: null, wtMin: 120, wtMax: 124 },
            { forageType: 'silage', phase: 'STEADY', dayNo: null, wtMin: 128, wtMax: 133 } // gap: 125 -> 128
        ];
        const problems = findContiguityGaps(rows);
        expect(problems).toHaveLength(1);
        expect(problems[0].a.wtMax).toBe(124);
        expect(problems[0].b.wtMin).toBe(128);
    });
});

// Ingredient ramp — v2 revised design (INGREDIENT_RAMP as a third, ordinary CSV phase
// with its own independent day numbering keyed to pen.rampStartDate rather than
// cycleStartDate). rampDay is computed by the caller (FarmContext's resolvePenRationV2)
// the same way daysOnFeed is: daysBetween(today, rampStartDate) + 1. These tests exercise
// resolveIngredientRampRow directly with pre-computed rampDay values, matching spec 2.5.
describe('resolveIngredientRampRow — ingredient ramp phase (spec 2.5)', () => {
    // 5-day potato ramp, one weight bracket (160-164kg), full pre-computed row per day —
    // no arithmetic/substitution, just an ordinary bracket lookup keyed on phase+dayNo.
    const rampRows = [
        { id: 100, planId: 'type-1', phase: 'INGREDIENT_RAMP', dayNo: 1, rampIngredient: 'Potato', forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.0 },
        { id: 101, planId: 'type-1', phase: 'INGREDIENT_RAMP', dayNo: 2, rampIngredient: 'Potato', forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.0 },
        { id: 102, planId: 'type-1', phase: 'INGREDIENT_RAMP', dayNo: 3, rampIngredient: 'Potato', forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.0 },
        { id: 103, planId: 'type-1', phase: 'INGREDIENT_RAMP', dayNo: 4, rampIngredient: 'Potato', forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.0 },
        { id: 104, planId: 'type-1', phase: 'INGREDIENT_RAMP', dayNo: 5, rampIngredient: 'Potato', forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.0 }
    ];
    const rampItems = [
        { rowId: 100, ingredientId: 'potato', qtyKgPerHeadPerDay: 1.0 },
        { rowId: 101, ingredientId: 'potato', qtyKgPerHeadPerDay: 2.0 },
        { rowId: 102, ingredientId: 'potato', qtyKgPerHeadPerDay: 3.0 },
        { rowId: 103, ingredientId: 'potato', qtyKgPerHeadPerDay: 4.0 },
        { rowId: 104, ingredientId: 'potato', qtyKgPerHeadPerDay: 5.0 }
    ];
    const steadyRow = { id: 105, planId: 'type-1', phase: 'STEADY', dayNo: null, forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.12 };
    const steadyItems = [{ rowId: 105, ingredientId: 'potato', qtyKgPerHeadPerDay: 5.0 }];

    const rampPen = makePen(161.9, { cycleStartDate: '2025-12-01' }); // well past adaptation -> STEADY if ramp misses

    it('1. rampStartDate = today resolves ramp day 1', () => {
        const result = resolveIngredientRampRow({ pen: rampPen, plan, rows: rampRows, rowItems: rampItems, rampDay: 1, today });
        expect(result.row.dayNo).toBe(1);
        expect(result.items.find(i => i.ingredientId === 'potato').qtyKgPerHeadPerDay).toBe(1.0);
    });

    it('2. rampStartDate = 4 days ago resolves ramp day 5', () => {
        const result = resolveIngredientRampRow({ pen: rampPen, plan, rows: rampRows, rowItems: rampItems, rampDay: 5, today });
        expect(result.row.dayNo).toBe(5);
        expect(result.items.find(i => i.ingredientId === 'potato').qtyKgPerHeadPerDay).toBe(5.0);
    });

    it('3. rampStartDate = 6 days ago with a 5-day ramp table misses (returns null, not an error) and falls through to STEADY', () => {
        const rampMatch = resolveIngredientRampRow({ pen: rampPen, plan, rows: rampRows, rowItems: rampItems, rampDay: 6, today });
        expect(rampMatch).toBeNull();

        const steadyResult = resolveRation({ pen: rampPen, plan, rows: [...rampRows, steadyRow], rowItems: [...rampItems, ...steadyItems], today });
        expect(steadyResult.phase).toBe('STEADY');
    });

    it('4. a pen with no rampStartDate resolves ADAPTATION unaffected by INGREDIENT_RAMP rows sharing the same plan/bracket', () => {
        const adaptationPen = makePen(161.9); // cycleStartDate = 2026-01-09, today = 2026-01-10 -> daysOnFeed 2
        const adaptationRow = { id: 106, planId: 'type-1', phase: 'ADAPTATION', dayNo: 2, forageType: 'chari', wtMin: 160, wtMax: 164, targetAdg: 1.0 };
        const adaptationItems = [{ rowId: 106, ingredientId: 'potato', qtyKgPerHeadPerDay: 0 }];
        const result = resolveRation({ pen: adaptationPen, plan, rows: [...rampRows, adaptationRow], rowItems: [...rampItems, ...adaptationItems], today });
        expect(result.phase).toBe('ADAPTATION');
        expect(result.dayNo).toBe(2);
        expect(result.items.find(i => i.ingredientId === 'potato').qtyKgPerHeadPerDay).toBe(0);
    });

    it('5. a plan with zero INGREDIENT_RAMP rows misses cleanly (returns null) even with rampStartDate set', () => {
        const rampMatch = resolveIngredientRampRow({ pen: rampPen, plan, rows: [steadyRow], rowItems: steadyItems, rampDay: 1, today });
        expect(rampMatch).toBeNull();
    });

    it('9. two pens on the same plan with different rampStartDate values resolve to different ramp days on the same date', () => {
        const penX = makePen(161.9, { cycleStartDate: '2025-12-01' });
        const penY = makePen(161.9, { cycleStartDate: '2025-12-01' });

        const resultX = resolveIngredientRampRow({ pen: penX, plan, rows: rampRows, rowItems: rampItems, rampDay: 2, today });
        const resultY = resolveIngredientRampRow({ pen: penY, plan, rows: rampRows, rowItems: rampItems, rampDay: 4, today });

        expect(resultX.row.dayNo).toBe(2);
        expect(resultY.row.dayNo).toBe(4);
        expect(resultX.items.find(i => i.ingredientId === 'potato').qtyKgPerHeadPerDay).toBe(2.0);
        expect(resultY.items.find(i => i.ingredientId === 'potato').qtyKgPerHeadPerDay).toBe(4.0);
    });

    it('throws NoMatchingRationError (a genuine data error) when two INGREDIENT_RAMP brackets overlap for the same day/weight', () => {
        const overlapping = [
            { id: 200, planId: 'type-1', phase: 'INGREDIENT_RAMP', dayNo: 1, rampIngredient: 'Potato', forageType: 'chari', wtMin: 158, wtMax: 163, targetAdg: 1.0 },
            { id: 201, planId: 'type-1', phase: 'INGREDIENT_RAMP', dayNo: 1, rampIngredient: 'Potato', forageType: 'chari', wtMin: 160, wtMax: 165, targetAdg: 1.0 }
        ];
        expect(() => resolveIngredientRampRow({ pen: rampPen, plan, rows: overlapping, rowItems: [], rampDay: 1, today })).toThrow(NoMatchingRationError);
    });
});

describe('getWeightDivergence', () => {
    it('flags a warning when actual weight diverges more than 5% from projected', () => {
        // projected = 160 + 7*1.12 = 167.84; actual 180kg is ~7.2% above -> warn
        const { pctDiff, warn } = getWeightDivergence({
            prevWeightKg: 160, prevDate: '2026-01-01', prevTargetAdg: 1.12,
            newWeightKg: 180, newDate: '2026-01-08'
        });
        expect(warn).toBe(true);
        expect(pctDiff).toBeGreaterThan(0.05);
    });

    it('does not flag a warning when the new weight is within 5% of projected', () => {
        // projected = 167.84; actual 170kg is ~1.3% above -> no warning
        const { warn } = getWeightDivergence({
            prevWeightKg: 160, prevDate: '2026-01-01', prevTargetAdg: 1.12,
            newWeightKg: 170, newDate: '2026-01-08'
        });
        expect(warn).toBe(false);
    });
});
