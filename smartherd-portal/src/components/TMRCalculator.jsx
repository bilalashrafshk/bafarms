import React, { useContext, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, daysBetween, parseDateOnly } from '../utils/dateOnly';

// Offsets a 'YYYY-MM-DD' date-only string by `delta` calendar days, staying in the
// same PKT-anchored day-space as every other date helper in the app (see dateOnly.js)
// so preview shortcuts (Yesterday/Tomorrow/+7d…) never drift a day off in any timezone.
const addDaysPKT = (dateStr, delta) => {
    const d = parseDateOnly(dateStr);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().split('T')[0];
};

// Number input for editing a diet override (plan qty, extra ingredient, tractor batch
// weight, etc). These all display a value that gets recomputed — sometimes through
// proportional multi-pen scaling and `.toFixed()` rounding — the instant it's committed.
// A plain controlled <input value={computedValue}> fights typing in that situation: every
// keystroke commits immediately, the recomputed value snaps back slightly different from
// what was typed, and the next keystroke lands on that reformatted text instead of the
// user's intended number (e.g. typing "46" over "4.01" ends up as "4.6" or similar). This
// keeps its own draft text while focused and only commits on blur/Enter, exactly like a
// normal form field, so the underlying data only ever changes once the user is done typing.
function DeferredNumberInput({ value, onCommit, ...props }) {
    const [draft, setDraft] = useState(null);
    const commit = () => {
        if (draft !== null) {
            onCommit(draft);
            setDraft(null);
        }
    };
    return (
        <input
            {...props}
            type="number"
            value={draft !== null ? draft : value}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    commit();
                    e.target.blur();
                }
            }}
        />
    );
}

export default function TMRCalculator() {
    const {
        feedIngredients, animals, staffUser, feedLogs, logFeed, deleteFeedLog,
        pens, getPenRationRow, getPenWeightFlags, getIngredientStockPrice, getIngredientStockQty
    } = useContext(FarmContext);
    // Herd Management access (admin-configurable in Settings) is the real gate for editing
    // diets — the "Internal Corporate Staff" role is just an email-domain login role, so it's
    // OR'd in for backward compatibility (matches FeedStock.jsx / RationPlans.jsx).
    const isAdmin = staffUser?.accessHerd === true || staffUser?.isAdmin === true;
    // Cost figures (per-ingredient and batch total) are restricted to the DB-backed
    // Super Admin flag, not the broader "Internal Corporate Staff" role — pen staff
    // logging feed should see quantities to mix, not what it costs.
    const isSuperAdmin = staffUser?.isAdmin === true;

    // Active (non-sold, non-deceased) herd count — auto-synced
    const activeHerdCount = animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased').length;

    // Unique pens from active animals
    const activePens = [...new Set(
        animals
            .filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.pen)
            .map(a => a.pen)
    )].sort();

    // Selected pen for TMR batch sizing
    const [selectedTMRPen, setSelectedTMRPen] = useState('all');

    // Daily feed-log state (snapshotting what was actually fed — separate from the
    // Ration Plan schedule itself, so schedule edits never rewrite past days)
    const [logDate, setLogDate] = useState(todayPKT());

    // Diet Preview — a read-only "peek" at what a pen was/will be fed on any date,
    // deliberately decoupled from `logDate` (which drives the actual batch + feed log
    // and is capped at today). This lets staff check yesterday's diet or next week's
    // upcoming diet without ever risking logging feed against a future date.
    const [peekDate, setPeekDate] = useState(todayPKT());
    // Which pens' ingredient breakdown is expanded in the Diet Preview panel — collapsed
    // by default so the panel shows one summary line per pen instead of dumping every
    // ingredient for every pen on screen at once (too much info, especially on mobile).
    const [selectedFeedLogDetails, setSelectedFeedLogDetails] = useState(null);

    const parseFeedingSession = (log) => {
        if (!log) return 'Feed (100%)';
        // Prefer the structured feedingIndex/feedingPct columns (backed by the DB, and
        // always in sync — a log fetched fresh from the server always has these). Notes
        // parsing is only a fallback for anything still going through the old code path.
        if (log.feedingIndex) {
            return `Feed ${log.feedingIndex} (${Math.round(log.feedingPct)}%)`;
        }
        if (log.notes) {
            const match = log.notes.match(/FEEDING (\d+) OF (\d+) \((\d+%)\)/i);
            if (match) {
                return `Feed ${match[1]} (${match[3]})`;
            }
            const matchAlt = log.notes.match(/FEEDING (\d+)/i);
            if (matchAlt) {
                return `Feed ${matchAlt[1]}`;
            }
        }
        return 'Feed (100%)';
    };
    const [peekExpandedPens, setPeekExpandedPens] = useState(new Set());
    const togglePeekPen = (penId) => setPeekExpandedPens(prev => {
        const next = new Set(prev);
        if (next.has(penId)) next.delete(penId); else next.add(penId);
        return next;
    });

    // Early-warning: animals whose most recent weigh-in diverged >5% from what growth
    // should have predicted since their prior weigh-in — illness, underfeeding, or a bad
    // record. Purely informational here, doesn't affect the batch calculation.
    const penWeightFlags = selectedTMRPen !== 'all' ? getPenWeightFlags(selectedTMRPen) : [];

    // Per-ingredient overrides for today's plan-driven batch, keyed by pen id so every
    // pen's editable table (single-pen view, or every pen's table stacked under "All")
    // keeps its own independent edits — never written back to the Ration Plan itself,
    // so the schedule stays intact for every other pen/day.
    const [planOverridesByPen, setPlanOverridesByPen] = useState({});
    // Ingredients fed today that aren't part of a pen's assigned ration at all (e.g. a
    // one-off substitution or top-up) — kept separate from planOverridesByPen since
    // these have no "planned" quantity to fall back to.
    const [extraIngredientsByPen, setExtraIngredientsByPen] = useState({});
    const [addIngredientChoiceByPen, setAddIngredientChoiceByPen] = useState({});
    // Changing the logged date invalidates any in-progress "today's qty" edits for
    // every pen — they were made against a specific day's batch.
    useEffect(() => {
        setPlanOverridesByPen({});
        setExtraIngredientsByPen({});
        setAddIngredientChoiceByPen({});
    }, [logDate]);

    const getPlanOverrides = (penId) => planOverridesByPen[penId] || {};
    const getExtraIngredients = (penId) => extraIngredientsByPen[penId] || {};
    const getAddIngredientChoice = (penId) => addIngredientChoiceByPen[penId] || '';
    const setAddIngredientChoice = (penId, value) => {
        setAddIngredientChoiceByPen(prev => ({ ...prev, [penId]: value }));
    };

    // Multi-feeding split state: 1, 2, or 3 feedings per day with custom percentage split
    const [numFeedings, setNumFeedings] = useState(1); // 1, 2, or 3
    const [feedingSplits, setFeedingSplits] = useState({
        2: [50, 50],
        3: [40, 30, 30]
    });
    const [activeFeedingIndex, setActiveFeedingIndex] = useState(0); // 0 = Full Day (100%), 1 = Feeding 1, 2 = Feeding 2, 3 = Feeding 3

    const activeSplitList = numFeedings === 1 ? [100] : (feedingSplits[numFeedings] || (numFeedings === 2 ? [50, 50] : [40, 30, 30]));
    const totalSplitPct = activeSplitList.reduce((a, b) => a + (parseFloat(b) || 0), 0);
    const activeFeedingPct = activeFeedingIndex === 0
        ? 100
        : (parseFloat(activeSplitList[activeFeedingIndex - 1]) || (100 / numFeedings));
    const activeFeedingScale = activeFeedingIndex === 0 ? 1.0 : (activeFeedingPct / 100);

    const handleSplitPctChange = (feedingNumIdx, value) => {
        const val = Math.max(0, Math.min(100, parseFloat(value) || 0));
        setFeedingSplits(prev => {
            const list = [...(prev[numFeedings] || (numFeedings === 2 ? [50, 50] : [40, 30, 30]))];
            list[feedingNumIdx] = val;
            return { ...prev, [numFeedings]: list };
        });
    };

    // 1. LOCAL UI STATE
    const [animalsCount, setAnimalsCount] = useState(activeHerdCount || 1);

    const [isTractorMode, setIsTractorMode] = useState(false);

    // 2. QUANTITY MATH — plan-driven only. Ingredient quantities are as-fed kg/head/day
    // straight from the Ration Plan's weekly schedule (no moisture/DM conversion — small
    // quantities like urea or minerals matter, so nothing here is rounded to whole kg;
    // decimals are preserved all the way through to the batch table and feed log).
    // Price is always the live weighted-average rate from the Feed Stock ledger — nothing
    // is typed in per plan. Legacy ingredients with no matching stock item fall back to
    // whatever static price they were last saved with.
    //
    // Resolves everything needed to render + edit + log a single pen's batch for
    // `logDate`. Pulled out into one function (instead of a pile of pen-scoped
    // top-level variables) so the exact same math/editing model can be used both for
    // the single selected pen and for every pen's own card when "All" is selected —
    // each pen keeps its own overrides/extras (via planOverridesByPen/extraIngredientsByPen)
    // and its own resolved plan, so editing one pen never touches another's batch.
    // `headCountOverride` lets the single-pen view size the batch off the user-editable
    // "Calves" input instead of the pen's registered head count (e.g. for pens not yet
    // fully logged in the system); per-pen cards under "All" always use the real headcount.
    // Defined here (before Tractor Mode below) since tractorAggregateIngredients calls
    // it eagerly during render — declaring it later would throw a temporal-dead-zone
    // "Cannot access before initialization" error the moment a tractor batch is computed.
    const computePenBatch = (penId, headCountOverride) => {
        const resolvedPlanRow = getPenRationRow(penId, logDate);
        const isBlocked = !!resolvedPlanRow?.blocked;
        const isPlanDriven = !!resolvedPlanRow && !isBlocked;
        const headCount = headCountOverride != null ? headCountOverride : (resolvedPlanRow?.headCount || 0);
        const overrides = getPlanOverrides(penId);
        const extras = getExtraIngredients(penId);

        const planIngredientRows = isPlanDriven
            ? Object.entries(resolvedPlanRow.week.ingredients).map(([id, qty]) => {
                const ing = feedIngredients.find(i => i.id === id || i.name.toLowerCase() === id.toLowerCase() || (id === 'wanda' && i.name.toLowerCase().includes('wanda')))
                    || { id, name: id.charAt(0).toUpperCase() + id.slice(1), price: 0 };
                const stockPrice = getIngredientStockPrice(id);
                const price = (stockPrice !== null && stockPrice > 0) ? stockPrice : (ing.price || 0);
                const qtyPerHead = overrides[id] !== undefined ? overrides[id] : qty;
                return {
                    id,
                    name: ing.name,
                    price,
                    planQty: qty,
                    qtyPerHead,
                    isOverridden: overrides[id] !== undefined,
                    wetBatch: qtyPerHead * headCount,
                    costSingle: qtyPerHead * price
                };
            })
            : [];

        // Ingredients added on top of the plan for today only — not part of the pen's
        // Ration Plan at all (planQty is always 0, so they always count as a diet
        // difference). Any ingredient with real stock can be picked, not just what's
        // already scheduled — a one-off substitution or top-up shouldn't require editing
        // the Ration Plan itself.
        const extraIngredientRows = isPlanDriven
            ? Object.entries(extras).map(([id, qty]) => {
                const ing = feedIngredients.find(i => i.id === id) || { id, name: id, price: 0 };
                const stockPrice = getIngredientStockPrice(id);
                const price = (stockPrice !== null && stockPrice > 0) ? stockPrice : (ing.price || 0);
                const qtyPerHead = parseFloat(qty) || 0;
                return {
                    id,
                    name: ing.name,
                    price,
                    planQty: 0,
                    qtyPerHead,
                    isOverridden: true,
                    isExtra: true,
                    wetBatch: qtyPerHead * headCount,
                    costSingle: qtyPerHead * price
                };
            })
            : [];

        // Ingredients with real stock, not already part of today's plan or already added,
        // available to pick from for a one-off substitution/top-up.
        const availableExtraIngredients = feedIngredients.filter(i =>
            !planIngredientRows.some(r => r.id === i.id) &&
            !(i.id in extras) &&
            (getIngredientStockQty(i.id) === null || getIngredientStockQty(i.id) > 0)
        );

        // Display array feeding the batch table / tractor mode / feed log below.
        const displayIngredients = isPlanDriven
            ? [...planIngredientRows, ...extraIngredientRows].map(r => ({
                id: r.id,
                name: r.name,
                dmTarget: r.qtyPerHead,
                wetSingle: r.qtyPerHead,
                wetBatch: r.wetBatch,
                costSingle: r.costSingle,
                price: r.price,
                planQty: r.planQty,
                isOverridden: r.isOverridden,
                isExtra: !!r.isExtra
            }))
            : [];

        const totalDM = displayIngredients.reduce((sum, ing) => sum + ing.dmTarget, 0);
        const totalBatchWeight = displayIngredients.reduce((sum, ing) => sum + ing.wetBatch, 0);
        const totalCostSingle = displayIngredients.reduce((sum, ing) => sum + ing.costSingle, 0);

        // True the instant any ingredient's fed quantity today doesn't match what the
        // Ration Plan calls for — an overridden quantity or a substituted/added ingredient.
        // Drives the mandatory note on save and the flag shown in Recent Feed History /
        // Feed Stock's Issues by Pen, so a deviation is never silently invisible later.
        const dietDiffered = planIngredientRows.some(r => r.isOverridden) || extraIngredientRows.length > 0;

        return {
            resolvedPlanRow, isBlocked, isPlanDriven, headCount,
            planIngredientRows, extraIngredientRows, availableExtraIngredients,
            displayIngredients, totalDM, totalBatchWeight, totalCostSingle, dietDiffered
        };
    };

    // Headcount-weighted avg plan qty / fed qty per ingredient across a set of
    // already-resolved pen batches (`{ penId, batch }[]`, from computePenBatch above).
    // Shared by the "All Pens" aggregate view and Tractor Mode so both edit an
    // aggregate quantity the exact same way — the only difference between them is
    // which pens are passed in (every active pen vs. just the tractor-checked ones).
    const computeAggregateTableRows = (resolutions, totalHeadCount) => {
        if (totalHeadCount === 0) return [];
        const map = {};
        resolutions.forEach(({ batch }) => {
            const penHead = batch.headCount || 0;
            batch.planIngredientRows.forEach(r => {
                if (!map[r.id]) {
                    map[r.id] = { id: r.id, name: r.name, planWetTotal: 0, fedWetTotal: 0, isOverridden: false, isExtra: false };
                }
                map[r.id].planWetTotal += r.planQty * penHead;
                map[r.id].fedWetTotal += r.qtyPerHead * penHead;
                if (r.isOverridden) map[r.id].isOverridden = true;
            });

            batch.extraIngredientRows.forEach(r => {
                if (!map[r.id]) {
                    map[r.id] = { id: r.id, name: r.name, planWetTotal: 0, fedWetTotal: 0, isOverridden: true, isExtra: true };
                }
                map[r.id].fedWetTotal += r.qtyPerHead * penHead;
            });
        });

        return Object.values(map).map(r => ({
            id: r.id,
            name: r.name,
            avgPlanQty: r.planWetTotal / totalHeadCount,
            avgFedQty: r.fedWetTotal / totalHeadCount,
            isOverridden: r.isOverridden,
            isExtra: r.isExtra
        }));
    };

    // Applies a target herd/tractor-average quantity for one ingredient by scaling
    // each pen's own existing quantity proportionally (rather than flattening every
    // pen to the same value) — so pens with a naturally larger ration stay
    // proportionally larger. `penIds`/`tableRows` scope this to whichever pens the
    // calling view is actually showing (all active pens, or just the tractor-checked
    // ones), so an edit here never touches a pen that isn't part of that batch.
    const handleAggregateOverride = (penIds, tableRows, id, targetAvgStr) => {
        const targetAvgInput = parseFloat(targetAvgStr);
        if (isNaN(targetAvgInput)) return;
        const targetAvg = activeFeedingScale > 0 ? targetAvgInput / activeFeedingScale : targetAvgInput;

        const row = tableRows.find(r => r.id === id);
        if (!row) return;

        if (row.isExtra) {
            const currentAvg = row.avgFedQty;
            setExtraIngredientsByPen(prev => {
                const next = { ...prev };
                penIds.forEach(penId => {
                    const penBatch = computePenBatch(penId);
                    const currentPenQty = penBatch.extraIngredientRows.find(r => r.id === id)?.qtyPerHead || 0;
                    let newPenQty = targetAvg;
                    if (currentAvg > 0 && currentPenQty > 0) {
                        newPenQty = parseFloat((currentPenQty * (targetAvg / currentAvg)).toFixed(3));
                    }
                    next[penId] = { ...(next[penId] || {}), [id]: newPenQty };
                });
                return next;
            });
        } else {
            const baseAvg = row.avgPlanQty > 0 ? row.avgPlanQty : row.avgFedQty;
            setPlanOverridesByPen(prev => {
                const next = { ...prev };
                penIds.forEach(penId => {
                    const penBatch = computePenBatch(penId);
                    const planQty = penBatch.planIngredientRows.find(r => r.id === id)?.planQty || 0;
                    let newPenQty = targetAvg;
                    if (baseAvg > 0 && planQty > 0) {
                        newPenQty = parseFloat((planQty * (targetAvg / baseAvg)).toFixed(3));
                    }
                    next[penId] = { ...(next[penId] || {}), [id]: newPenQty };
                });
                return next;
            });
        }
    };

    // ─── TRACTOR MODE: multi-pen batch aggregation ───
    // Pens eligible for a tractor batch are those with any Ration Plan assigned
    // (legacy or v2) and active animals — selecting several sums qty×headCount per
    // ingredient across them, but only after confirming they share the same forage
    // type and phase. An adaptation-phase pen and a steady-state pen (or silage vs.
    // chari) use meaningfully different rations, so silently summing them would
    // produce a wrong batch — this requires an explicit "aggregate anyway" click.
    const tractorEligiblePens = activePens.filter(p => pens.some(pc => pc.id === p && (pc.rationPlanId || pc.planId)));
    const [tractorSelectedPens, setTractorSelectedPens] = useState([]);
    const [tractorConfirmedMismatch, setTractorConfirmedMismatch] = useState(false);

    const openTractorMode = () => {
        setTractorSelectedPens(selectedTMRPen !== 'all' && tractorEligiblePens.includes(selectedTMRPen) ? [selectedTMRPen] : []);
        setTractorConfirmedMismatch(false);
        setIsTractorMode(true);
    };

    const toggleTractorPen = (penId) => {
        setTractorConfirmedMismatch(false);
        setTractorSelectedPens(prev => prev.includes(penId) ? prev.filter(p => p !== penId) : [...prev, penId]);
    };

    // Resolve each selected pen independently — never assume they share a plan.
    // Carries its own `batch` (via computePenBatch) so every aggregate below reads
    // live overrides/extras exactly once per pen, instead of each aggregate
    // re-resolving the pen separately (previously a source of drift between the
    // mismatch check, the aggregate totals, and the override math).
    const tractorPenResolutions = tractorSelectedPens
        .map(penId => ({ penId, batch: computePenBatch(penId) }))
        .map(r => ({ ...r, resolved: r.batch.resolvedPlanRow }))
        .filter(r => r.batch.isPlanDriven);

    const tractorPhaseOf = (resolved) => resolved.system === 'v2' ? resolved.phase : (resolved.usesAdaptationTable ? 'ADAPTATION' : 'STEADY');
    const tractorForageTypes = [...new Set(tractorPenResolutions.map(r => r.resolved.forageType))];
    const tractorPhases = [...new Set(tractorPenResolutions.map(r => tractorPhaseOf(r.resolved)))];
    const tractorMismatch = tractorForageTypes.length > 1 || tractorPhases.length > 1;
    const tractorMismatchedPens = tractorMismatch
        ? tractorPenResolutions.map(r => `Pen ${r.penId} (${r.resolved.forageType}, ${tractorPhaseOf(r.resolved)})`)
        : [];

    // Aggregate qty×headCount per ingredient across all resolved pens in Tractor Mode,
    // reflecting live overrides, added ingredients, and active feeding run scaling.
    const tractorAggregateIngredients = (() => {
        if (tractorPenResolutions.length === 0) return [];
        if (tractorMismatch && !tractorConfirmedMismatch) return [];
        const totals = {};
        tractorPenResolutions.forEach(({ batch }) => {
            const headCount = batch.headCount || 0;
            batch.displayIngredients.forEach(ing => {
                const id = ing.id;
                const batchQty = ing.wetBatch * activeFeedingScale;
                const cost = ing.costSingle * headCount * activeFeedingScale;
                if (!totals[id]) totals[id] = { id, name: ing.name, wetBatch: 0, cost: 0, isExtra: false, isOverridden: false };
                totals[id].wetBatch += batchQty;
                totals[id].cost += cost;
                if (ing.isExtra) totals[id].isExtra = true;
                if (ing.isOverridden) totals[id].isOverridden = true;
            });
        });
        return Object.values(totals);
    })();

    const tractorTotalHeadCount = tractorPenResolutions.reduce((sum, r) => sum + (r.batch.headCount || 0), 0);
    const tractorTotalBatchWeight = tractorAggregateIngredients.reduce((sum, i) => sum + i.wetBatch, 0);
    const tractorTotalCost = tractorAggregateIngredients.reduce((sum, i) => sum + i.cost, 0);
    // Headcount-weighted avg plan/fed qty per ingredient, scoped strictly to the pens
    // actually checked in Tractor Mode — the base an in-mixer edit scales against, so
    // typing a new batch weight here only ever rewrites overrides for these pens (see
    // handleAggregateOverride below), never the whole herd's.
    const tractorTableRows = computeAggregateTableRows(tractorPenResolutions, tractorTotalHeadCount);

    // One click into Tractor Mode with every eligible pen already checked — "feed all
    // pens together" without making the user tick each box by hand. Still lands in the
    // same mismatch-confirmation flow as manual multi-select, so a genuinely mixed
    // forage/phase farm still gets the "aggregate anyway" guard before logging.
    const openFeedAllPens = () => {
        setTractorSelectedPens(tractorEligiblePens);
        setTractorConfirmedMismatch(false);
        setIsTractorMode(true);
    };

    // Daily feed-log state
    const [logSaved, setLogSaved] = useState(false);

    // Rations are only ever set by a Ration Plan (managed under Ration Plans, not
    // here). This page's job is strictly to feed today's plan-driven batch and
    // calculate the total kg to mix — no recipe editing lives here. Procurement
    // cost is likewise set per Ration Plan and never shown on this page.

    // Sync animalsCount when herd data loads/changes or pen selection changes
    useEffect(() => {
        if (selectedTMRPen === 'all') {
            if (activeHerdCount > 0) setAnimalsCount(activeHerdCount);
        } else {
            const penCount = animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.pen === selectedTMRPen).length;
            setAnimalsCount(Math.max(1, penCount));
        }
    }, [activeHerdCount, selectedTMRPen, animals]);

    // Editing is per-pen (keyed by penId) so the same handlers work for the single
    // selected pen's table and for every pen's own table stacked under "All".
    const handlePlanOverride = (penId, id, value) => {
        const val = parseFloat(value) || 0;
        const fullDayVal = activeFeedingScale > 0 ? val / activeFeedingScale : val;
        setPlanOverridesByPen(prev => ({ ...prev, [penId]: { ...(prev[penId] || {}), [id]: fullDayVal } }));
    };

    const handleResetOverride = (penId, id) => {
        setPlanOverridesByPen(prev => {
            const next = { ...(prev[penId] || {}) };
            delete next[id];
            return { ...prev, [penId]: next };
        });
    };

    const handleAddExtraIngredient = (penId) => {
        const choice = getAddIngredientChoice(penId);
        if (!choice) return;
        setExtraIngredientsByPen(prev => ({ ...prev, [penId]: { ...(prev[penId] || {}), [choice]: 0 } }));
        setAddIngredientChoice(penId, '');
    };

    const handleExtraIngredientQty = (penId, id, value) => {
        const val = parseFloat(value) || 0;
        const fullDayVal = activeFeedingScale > 0 ? val / activeFeedingScale : val;
        setExtraIngredientsByPen(prev => ({ ...prev, [penId]: { ...(prev[penId] || {}), [id]: fullDayVal } }));
    };

    const handleRemoveExtraIngredient = (penId, id) => {
        setExtraIngredientsByPen(prev => {
            const next = { ...(prev[penId] || {}) };
            delete next[id];
            return { ...prev, [penId]: next };
        });
    };

    const handleSwitchPenForage = (penId, targetForage) => {
        const existingPen = pens.find(p => String(p.id) === String(penId)) || { id: penId };
        savePen({
            ...existingPen,
            id: penId,
            forageType: targetForage
        });
    };

    // Batch for whichever pen is currently selected in the filter bar (null when "All"
    // is selected — that view renders every pen's own card via computePenBatch directly).
    const selectedBatch = selectedTMRPen !== 'all' ? computePenBatch(selectedTMRPen, animalsCount) : null;
    const resolvedPlanRow = selectedBatch?.resolvedPlanRow || null;
    const isBlocked = selectedBatch?.isBlocked || false;
    const isPlanDriven = selectedBatch?.isPlanDriven || false;
    const planIngredientRows = selectedBatch?.planIngredientRows || [];
    const extraIngredientRows = selectedBatch?.extraIngredientRows || [];
    const availableExtraIngredients = selectedBatch?.availableExtraIngredients || [];
    const displayIngredients = selectedBatch?.displayIngredients || [];
    const totalDM = selectedBatch?.totalDM || 0;
    const totalBatchWeight = selectedBatch?.totalBatchWeight || 0;
    const totalCostSingle = selectedBatch?.totalCostSingle || 0;
    const dietDiffered = selectedBatch?.dietDiffered || false;

    // Snapshots a resolved+edited batch (for the given pen and date) into the immutable
    // feed log — this records what was actually fed, distinct from the Ration Plan
    // schedule itself, so later schedule edits never alter this day's history. Shared
    // by the single selected-pen "Log This Feeding" button and each pen's own button
    // when "All" is selected.
    const logBatchForPen = (penId, batch, headCount) => {
        if (!batch.isPlanDriven) return;
        const resolvedPlanRow = batch.resolvedPlanRow;
        const isV2 = resolvedPlanRow.system === 'v2';
        const stageNote = isV2
            ? `${resolvedPlanRow.plan.name} v${resolvedPlanRow.plan.version}, bracket ${resolvedPlanRow.bracketMin}-${resolvedPlanRow.bracketMax}kg${resolvedPlanRow.phase === 'ADAPTATION' ? `, Adaptation Day ${resolvedPlanRow.dayNo}` : ', Steady State'}`
            : (resolvedPlanRow.usesAdaptationTable
                ? `Adaptation Day ${resolvedPlanRow.adaptationDay}`
                : `Week ${resolvedPlanRow.week.week}${resolvedPlanRow.usesDailyDiet && resolvedPlanRow.dayInWeek ? `, Day ${resolvedPlanRow.dayInWeek}` : ''}`);
        let notes = `Auto-filled from ${isV2 ? stageNote : `${resolvedPlanRow.plan.name}, ${stageNote}`}${resolvedPlanRow.matchedByWeight ? '' : ' (matched by cycle day)'}`;

        // Any override or added ingredient is a real deviation from what the Ration
        // Plan calls for — spell it out in the note itself (not just implied by a
        // flag) so anyone reading the feed log later, without cross-referencing the
        // plan, immediately knows the diet differed that day and by how much.
        if (batch.dietDiffered) {
            const deviations = [
                ...batch.planIngredientRows.filter(r => r.isOverridden).map(r => `${r.name} planned ${r.planQty.toFixed(2)}kg/head → fed ${r.qtyPerHead.toFixed(2)}kg/head`),
                ...batch.extraIngredientRows.map(r => `${r.name} added ${r.qtyPerHead.toFixed(2)}kg/head (not in plan)`)
            ];
            notes += ` — DIET DIFFERED FROM PLAN: ${deviations.join('; ')}`;
        }

        // Overrides/additions are logged alongside the plan's originally resolved
        // quantity (plannedQtyKg, 0 for anything not in the plan at all) so the feed
        // log preserves provenance — what the plan said to feed vs. what was actually
        // fed, per ingredient — and downstream views (Feed Stock's Issues by Pen) can
        // detect the same deviation without re-parsing the notes text.
        if (activeFeedingIndex > 0) {
            notes += ` — FEEDING ${activeFeedingIndex} OF ${numFeedings} (${activeFeedingPct}%)`;
        }

        logFeed({
            date: logDate,
            pen: penId,
            animalCount: headCount,
            dietDiffered: batch.dietDiffered,
            ingredients: batch.displayIngredients.map(ing => ({
                id: ing.id,
                name: ing.name,
                dmTarget: ing.dmTarget * activeFeedingScale,
                price: ing.price,
                wetSingle: ing.wetSingle * activeFeedingScale,
                wetBatch: ing.wetBatch * activeFeedingScale,
                costSingle: ing.costSingle * activeFeedingScale,
                plannedQtyKg: ing.planQty * activeFeedingScale
            })),
            totalDmKg: batch.totalDM * activeFeedingScale,
            totalBatchKg: batch.totalBatchWeight * activeFeedingScale,
            totalCost: batch.totalCostSingle * headCount * activeFeedingScale,
            costPerAnimal: batch.totalCostSingle * activeFeedingScale,
            createdBy: staffUser?.email || staffUser?.name || null,
            // A "Full Day" log (index 0) is complete on its own — no other session is
            // expected that day — so it's always recorded as 1 feeding at 100%, regardless
            // of whatever split ratio happens to be selected in the UI at the time.
            feedingIndex: activeFeedingIndex,
            numFeedings: activeFeedingIndex === 0 ? 1 : numFeedings,
            feedingPct: activeFeedingIndex === 0 ? 100 : activeFeedingPct,
            notes
        });
        setLogSaved(true);
        setTimeout(() => setLogSaved(false), 2500);
    };

    const handleLogFeed = () => logBatchForPen(selectedTMRPen, selectedBatch, animalsCount);

    // Shared with the "Feed All Pens" bulk log below — same provenance text as the
    // single-pen path, just parameterized on whichever pen/resolution is being logged
    // instead of closing over selectedTMRPen/resolvedPlanRow.
    const stageNoteFor = (resolved) => resolved.system === 'v2'
        ? `${resolved.plan.name} v${resolved.plan.version}, bracket ${resolved.bracketMin}-${resolved.bracketMax}kg${resolved.phase === 'ADAPTATION' ? `, Adaptation Day ${resolved.dayNo}` : ', Steady State'}`
        : (resolved.usesAdaptationTable
            ? `Adaptation Day ${resolved.adaptationDay}`
            : `Week ${resolved.week.week}${resolved.usesDailyDiet && resolved.dayInWeek ? `, Day ${resolved.dayInWeek}` : ''}`);

    // Logs one pen's already-resolved ration as its own feed-log record (own pen id,
    // own head count, own ingredients) — used by "Feed All Pens" so every pen in a
    // multi-pen batch still gets correct, per-pen history downstream (Feed & Growth
    // Report, Feed Stock's Issues by Pen both key strictly off a real pen id). No
    // per-ingredient overrides here — Tractor Mode is a mixing/logging view, not an
    // editing one, so there's nothing to diff against the plan.
    const logPenBatch = (penId, resolved, date) => {
        const headCount = resolved.headCount || 0;
        const rows = Object.entries(resolved.week.ingredients || {}).map(([id, qty]) => {
            const ing = feedIngredients.find(i => i.id === id) || { id, name: id.charAt(0).toUpperCase() + id.slice(1), price: 0 };
            const stockPrice = getIngredientStockPrice(id);
            const price = (stockPrice !== null && stockPrice > 0) ? stockPrice : (ing.price || 0);
            const qtyPerHead = parseFloat(qty) || 0;
            return {
                id, name: ing.name, dmTarget: qtyPerHead, price,
                wetSingle: qtyPerHead, wetBatch: qtyPerHead * headCount,
                costSingle: qtyPerHead * price, plannedQtyKg: qtyPerHead
            };
        });
        const totalDmKg = rows.reduce((sum, r) => sum + r.dmTarget, 0);
        const totalBatchKg = rows.reduce((sum, r) => sum + r.wetBatch, 0);
        const totalCostSingleRow = rows.reduce((sum, r) => sum + r.costSingle, 0);
        const isV2 = resolved.system === 'v2';
        const stageNote = stageNoteFor(resolved);
        const notes = `Auto-filled from ${isV2 ? stageNote : `${resolved.plan.name}, ${stageNote}`}${resolved.matchedByWeight ? '' : ' (matched by cycle day)'} — logged via Feed All Pens`;

        logFeed({
            date, pen: penId, animalCount: headCount, dietDiffered: false,
            ingredients: rows, totalDmKg, totalBatchKg,
            totalCost: totalCostSingleRow * headCount, costPerAnimal: totalCostSingleRow,
            createdBy: staffUser?.email || staffUser?.name || null, notes
        });
    };

    // "Feed all pens together" — logs every resolved pen in the current Tractor Mode
    // selection in one action, each as its own record via logPenBatch above. Gated the
    // same way the aggregate mixing view is: a forage/phase mismatch across pens must
    // be explicitly confirmed first, since that mismatch is a real signal something's
    // off (e.g. a pen still mid-adaptation lumped in with steady-state pens).
    const handleLogAllPens = () => {
        if (tractorPenResolutions.length === 0) return;
        if (tractorMismatch && !tractorConfirmedMismatch) return;
        tractorSelectedPens.forEach(penId => {
            const batch = computePenBatch(penId);
            if (batch.isPlanDriven) {
                logBatchForPen(penId, batch, batch.headCount);
            }
        });
        setLogSaved(true);
        setTimeout(() => setLogSaved(false), 2500);
    };

    // ─── "ALL" PENS AGGREGATE (average diet across the whole herd) ───
    const [bulkAddChoice, setBulkAddChoice] = useState('');
    const handleAddExtraIngredientToAllPens = () => {
        if (!bulkAddChoice) return;
        setExtraIngredientsByPen(prev => {
            const next = { ...prev };
            activePens.forEach(penId => {
                next[penId] = { ...(next[penId] || {}), [bulkAddChoice]: 0 };
            });
            return next;
        });
        setBulkAddChoice('');
    };

    const bulkAvailableExtraIngredients = feedIngredients.filter(i =>
        (getIngredientStockQty(i.id) === null || getIngredientStockQty(i.id) > 0)
    );

    const allPensResolutions = activePens
        .map(penId => {
            const batch = computePenBatch(penId);
            return { penId, batch, resolved: batch.resolvedPlanRow };
        })
        .filter(r => r.batch.isPlanDriven);

    const allPensForageTypes = [...new Set(allPensResolutions.map(r => r.resolved.forageType))];
    const allPensPhases = [...new Set(allPensResolutions.map(r => tractorPhaseOf(r.resolved)))];
    const allPensMismatch = allPensForageTypes.length > 1 || allPensPhases.length > 1;
    const allPensMismatchedPens = allPensMismatch
        ? allPensResolutions.map(r => `Pen ${r.penId} (${r.resolved.forageType}, ${tractorPhaseOf(r.resolved)})`)
        : [];
    const [allPensConfirmedMismatch, setAllPensConfirmedMismatch] = useState(false);
    useEffect(() => {
        setAllPensConfirmedMismatch(false);
        setBulkAddChoice('');
    }, [logDate]);

    const allPensTotalHeadCount = allPensResolutions.reduce((sum, r) => sum + (r.batch.headCount || 0), 0);
    const allPensAggregateIngredients = (() => {
        if (allPensResolutions.length === 0) return [];
        if (allPensMismatch && !allPensConfirmedMismatch) return [];
        const totals = {};
        allPensResolutions.forEach(({ batch }) => {
            const headCount = batch.headCount || 0;
            batch.displayIngredients.forEach(ing => {
                const id = ing.id;
                const batchQty = ing.wetBatch;
                const cost = ing.costSingle * headCount;
                if (!totals[id]) totals[id] = { id, name: ing.name, wetBatch: 0, cost: 0, isExtra: ing.isExtra, isOverridden: ing.isOverridden };
                totals[id].wetBatch += batchQty;
                totals[id].cost += cost;
                if (ing.isExtra) totals[id].isExtra = true;
                if (ing.isOverridden) totals[id].isOverridden = true;
            });
        });
        return Object.values(totals).map(t => ({
            ...t,
            avgPerHead: allPensTotalHeadCount > 0 ? t.wetBatch / allPensTotalHeadCount : 0
        }));
    })();
    const allPensTotalBatchWeight = allPensAggregateIngredients.reduce((sum, i) => sum + i.wetBatch, 0);
    const allPensTotalCost = allPensAggregateIngredients.reduce((sum, i) => sum + i.cost, 0);

    const [showPerPenBreakdown, setShowPerPenBreakdown] = useState(false);

    const allPensTableRows = computeAggregateTableRows(allPensResolutions, allPensTotalHeadCount);

    const handleAllPensResetOverride = (id) => {
        setPlanOverridesByPen(prev => {
            const next = { ...prev };
            activePens.forEach(penId => {
                if (next[penId]) {
                    const copy = { ...next[penId] };
                    delete copy[id];
                    next[penId] = copy;
                }
            });
            return next;
        });
    };

    const handleAllPensRemoveExtraIngredient = (id) => {
        setExtraIngredientsByPen(prev => {
            const next = { ...prev };
            activePens.forEach(penId => {
                if (next[penId]) {
                    const copy = { ...next[penId] };
                    delete copy[id];
                    next[penId] = copy;
                }
            });
            return next;
        });
    };

    // Logs every pen with a resolved plan as its own feed-log record — same per-pen
    // provenance as "Feed All Pens", preserving all overrides and custom added ingredients.
    const handleLogAllPensFromAllView = () => {
        if (allPensResolutions.length === 0) return;
        if (allPensMismatch && !allPensConfirmedMismatch) return;
        allPensResolutions.forEach(({ penId, batch }) => logBatchForPen(penId, batch, batch.headCount));
        setLogSaved(true);
        setTimeout(() => setLogSaved(false), 2500);
    };

    const recentFeedLogs = [...feedLogs].sort((a, b) => daysBetween(b.date, a.date)).slice(0, 10);

    // ─── DIET PREVIEW (peek) ───
    // Read-only lookup of what a pen's diet was/will be on any date — completely
    // decoupled from logDate/animalsCount/overrides above, so browsing history or
    // an upcoming week never risks touching what actually gets logged. Scope follows
    // whatever's currently selected: the single pen in normal mode, the tractor
    // selection (or all eligible pens if none picked yet) in Tractor Mode, or every
    // active pen when "All" is selected in normal mode.
    const peekPens = isTractorMode
        ? (tractorSelectedPens.length > 0 ? tractorSelectedPens : tractorEligiblePens)
        : (selectedTMRPen !== 'all' ? [selectedTMRPen] : activePens);
    const peekResolutions = peekPens.map(penId => ({ penId, resolved: getPenRationRow(penId, peekDate) }));
    const peekDateShortcuts = [['Yesterday', -1], ['Today', 0], ['Tomorrow', 1], ['+7d', 7], ['+14d', 14], ['+30d', 30]];

    // Normal-view only — deliberately not shown in Tractor Mode, which is meant to be
    // a minimal, glance-and-go screen (mounted on a tractor dashboard/phone in the
    // pen), not a place to browse historical/upcoming diets.
    const renderDietPreviewPanel = () => (
        <div class="glass-panel" style={{ borderTop: '4px solid #4a90d9' }}>
            <h3 class="panel-title"><i class="fa-solid fa-calendar-days"></i> Diet Preview</h3>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '-0.4rem', marginBottom: '0.8rem' }}>
                Peek at what {peekPens.length === 1 ? `Pen ${peekPens[0]}` : 'the selected pens'} {peekDate < todayPKT() ? 'were fed' : peekDate > todayPKT() ? 'are scheduled to be fed' : 'are being fed'} on any day, past or future — read-only, never affects logging.
            </p>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
                {peekDateShortcuts.map(([label, delta]) => {
                    const d = addDaysPKT(todayPKT(), delta);
                    return (
                        <button
                            key={label}
                            type="button"
                            class={`filter-btn ${peekDate === d ? 'active' : ''}`}
                            style={{ fontSize: '0.7rem', minHeight: '26px', padding: '0.15rem 0.5rem' }}
                            onClick={() => setPeekDate(d)}
                        >{label}</button>
                    );
                })}
                <input
                    type="date"
                    class="form-control"
                    style={{ width: '150px', minHeight: '28px', height: '28px', padding: '0.15rem 0.4rem', fontSize: '0.8rem' }}
                    value={peekDate}
                    onChange={(e) => setPeekDate(e.target.value)}
                />
            </div>

            {peekPens.length === 0 && (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Select a pen (or check some in Tractor Mode) to preview its diet.</p>
            )}

            {peekResolutions.map(({ penId, resolved }) => {
                const expanded = peekExpandedPens.has(penId);
                const canExpand = resolved && !resolved.blocked;
                return (
                    <div key={penId} style={{ marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <div
                            onClick={() => canExpand && togglePeekPen(penId)}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', cursor: canExpand ? 'pointer' : 'default' }}
                        >
                            <div style={{ fontWeight: '700', color: 'var(--text-pure)', fontSize: '0.85rem' }}>
                                Pen {penId}
                                {resolved && !resolved.blocked && (
                                    <span style={{ marginLeft: '0.5rem', fontWeight: '400', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                        {resolved.plan.name}{resolved.system === 'v2' ? ` v${resolved.plan.version}` : ''}
                                        {' · '}{(resolved.phase === 'ADAPTATION' || resolved.usesAdaptationTable)
                                            ? `Adaptation Day ${resolved.dayNo ?? resolved.adaptationDay}`
                                            : (resolved.system === 'v2' ? 'Steady State' : `Week ${resolved.week.week}`)}
                                        {' · '}Day {resolved.daysOnFeed ?? '—'} on feed
                                    </span>
                                )}
                            </div>
                            {canExpand && <i class={`fa-solid fa-chevron-${expanded ? 'up' : 'down'}`} style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}></i>}
                        </div>
                        {!resolved && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No Ration Plan assigned.</span>}
                        {resolved?.blocked && (
                            <span style={{ fontSize: '0.78rem', color: 'hsl(0,75%,65%)' }}><i class="fa-solid fa-ban"></i> {resolved.error}</span>
                        )}
                        {canExpand && expanded && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                                {Object.entries(resolved.week.ingredients || {}).map(([id, qty]) => {
                                    const ing = feedIngredients.find(i => i.id === id) || { name: id };
                                    return (
                                        <span key={id}>
                                            <strong style={{ color: 'var(--text-pure)' }}>{ing.name}</strong>: {(parseFloat(qty) || 0).toFixed(2)} kg/head
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

            {/* Top Grid: Ingredients list and Batch Recipe Output */}
            <div class="tmr-grid">

                {/* Left: the plan-driven ration (auto-filled from the pen's assigned Ration Plan),
                    or an empty-state prompt when no plan is attached — rations are never set here */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

                    {selectedTMRPen === 'all' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                            {/* Main Herd Aggregate Ration Panel */}
                            <div className="glass-panel" style={{ borderTop: '4px solid var(--primary-green-light)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.6rem' }}>
                                    <h3 className="panel-title" style={{ marginBottom: 0 }}>
                                        <i className="fa-solid fa-clipboard-check"></i> Plan-Driven Ration — All Pens (Herd Average)
                                    </h3>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {allPensResolutions.length} Pens ({allPensTotalHeadCount} head)
                                    </span>
                                </div>

                                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                                    Weighted average diet across all pens. Editing any quantity here scales the diet proportionally across all pens for today's feeding.
                                </p>

                                <div className="table-wrapper">
                                    <table className="data-table" style={{ fontSize: '0.85rem' }}>
                                        <thead>
                                            <tr>
                                                <th>INGREDIENT</th>
                                                <th>AVG PLAN QTY</th>
                                                <th>TODAY'S AVG QTY (KG/HEAD)</th>
                                                <th style={{ width: '60px', textAlign: 'center' }}>RESET</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {allPensTableRows.filter(r => !r.isExtra).map(row => (
                                                <tr key={row.id}>
                                                    <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{row.name}</td>
                                                    <td>{row.avgPlanQty.toFixed(3)} kg</td>
                                                    <td>
                                                        <DeferredNumberInput
                                                            step="0.001"
                                                            className="form-control"
                                                            style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '110px', color: row.isOverridden ? 'var(--accent-gold)' : 'inherit' }}
                                                            value={parseFloat(row.avgFedQty.toFixed(3))}
                                                            onCommit={(val) => handleAggregateOverride(activePens, allPensTableRows, row.id, val)}
                                                            disabled={!isAdmin}
                                                        />
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        {row.isOverridden ? (
                                                            <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => handleAllPensResetOverride(row.id)} title="Reset to plan quantity across all pens">
                                                                <i className="fa-solid fa-rotate-left"></i>
                                                            </button>
                                                        ) : (
                                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                            {allPensTableRows.filter(r => r.isExtra).map(row => (
                                                <tr key={row.id} style={{ background: 'rgba(212,175,55,0.06)' }}>
                                                    <td style={{ fontWeight: '600', color: 'var(--accent-gold)' }}>
                                                        {row.name} <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: '400' }}>(added to all pens)</span>
                                                    </td>
                                                    <td>—</td>
                                                    <td>
                                                        <DeferredNumberInput
                                                            step="0.001"
                                                            className="form-control"
                                                            style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '110px', color: 'var(--accent-gold)' }}
                                                            value={parseFloat(row.avgFedQty.toFixed(3))}
                                                            onCommit={(val) => handleAggregateOverride(activePens, allPensTableRows, row.id, val)}
                                                            disabled={!isAdmin}
                                                        />
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => handleAllPensRemoveExtraIngredient(row.id)} title="Remove this ingredient from all pens">
                                                            <i className="fa-solid fa-xmark"></i>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {isAdmin && bulkAvailableExtraIngredients.length > 0 && (
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.8rem', flexWrap: 'wrap' }}>
                                        <select
                                            className="form-control form-control-sm"
                                            style={{ maxWidth: '280px', width: 'auto', flex: '1 1 auto' }}
                                            value={bulkAddChoice}
                                            onChange={(e) => setBulkAddChoice(e.target.value)}
                                        >
                                            <option value="">Substitute / add an ingredient to ALL pens…</option>
                                            {bulkAvailableExtraIngredients.map(i => {
                                                const stockQty = getIngredientStockQty(i.id);
                                                return <option key={i.id} value={i.id}>{i.name}{stockQty !== null ? ` (${stockQty.toFixed(2)}kg in stock)` : ''}</option>;
                                            })}
                                        </select>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddExtraIngredientToAllPens} disabled={!bulkAddChoice}>
                                            <i className="fa-solid fa-circle-plus"></i> Add
                                        </button>
                                    </div>
                                )}

                                {allPensTableRows.some(r => r.isOverridden) && (
                                    <div style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '8px', padding: '0.5rem 0.8rem', marginTop: '0.8rem', fontSize: '0.76rem', color: 'var(--accent-gold)' }}>
                                        <i className="fa-solid fa-triangle-exclamation"></i> Today's feeding differs from the Ration Plan across one or more pens.
                                    </div>
                                )}

                                <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.8rem', marginBottom: 0 }}>
                                    <i className="fa-solid fa-circle-info"></i> Overrides/additions here apply to today's logged feeding only — the Ration Plan schedule itself is unchanged.
                                </p>
                            </div>

                            {/* Optional Collapsible Per-Pen Breakdown */}
                            <div style={{ textAlign: 'center' }}>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setShowPerPenBreakdown(!showPerPenBreakdown)}
                                >
                                    <i className={`fa-solid fa-chevron-${showPerPenBreakdown ? 'up' : 'down'}`}></i> {showPerPenBreakdown ? 'Hide' : 'Show'} Per-Pen Individual Breakdown ({activePens.length} Pens)
                                </button>
                            </div>

                            {showPerPenBreakdown && activePens.map(penId => {
                                const penBatch = computePenBatch(penId);
                                const {
                                    resolvedPlanRow: penResolvedPlanRow,
                                    isBlocked: penIsBlocked,
                                    isPlanDriven: penIsPlanDriven,
                                    headCount: penHeadCount,
                                    planIngredientRows: penPlanIngredientRows,
                                    extraIngredientRows: penExtraIngredientRows,
                                    availableExtraIngredients: penAvailableExtraIngredients,
                                    dietDiffered: penDietDiffered
                                } = penBatch;

                                const penWeightFlagsList = getPenWeightFlags(penId);

                                if (penIsBlocked) {
                                    const penObj = pens.find(p => p.id === penId);
                                    return (
                                        <div key={penId} className="glass-panel" style={{ borderTop: '4px solid hsl(0,75%,55%)' }}>
                                            <h4 style={{ color: 'hsl(0,75%,65%)', margin: 0 }}><i className="fa-solid fa-ban"></i> Pen {penId} — Feeding Blocked</h4>
                                            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.4rem', marginBottom: '0.6rem' }}>{penResolvedPlanRow.error}</p>
                                            {penResolvedPlanRow.availableDiets && penResolvedPlanRow.availableDiets.length > 0 && (
                                                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '0.6rem 0.8rem', marginTop: '0.5rem' }}>
                                                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--accent-gold)' }}>
                                                        Available Alternative:
                                                    </span>
                                                    {penResolvedPlanRow.availableDiets.map((alt, idx) => (
                                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-pure)' }}>
                                                                {alt.forageType.toUpperCase()} Diet ({alt.bracketMin}–{alt.bracketMax}kg)
                                                            </span>
                                                            {isAdmin && (
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-secondary btn-sm"
                                                                    onClick={() => handleSwitchPenForage(penId, alt.forageType)}
                                                                >
                                                                    <i className="fa-solid fa-right-left"></i> Switch Pen {penId} to {alt.forageType.toUpperCase()}
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                if (!penIsPlanDriven) {
                                    return (
                                        <div key={penId} className="glass-panel">
                                            <h4 style={{ margin: 0 }}><i className="fa-solid fa-clipboard-list"></i> Pen {penId} — No Plan Assigned</h4>
                                            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>Assign a Ration Plan under Ration Plans to configure this pen's diet.</p>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={penId} className="glass-panel" style={{ borderTop: '4px solid var(--primary-green-light)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                                            <h3 className="panel-title" style={{ marginBottom: 0 }}>
                                                <i className="fa-solid fa-clipboard-check"></i> Pen {penId} ({penHeadCount} head)
                                            </h3>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                {penResolvedPlanRow.system === 'v2'
                                                    ? `${penResolvedPlanRow.plan.name} v${penResolvedPlanRow.plan.version}`
                                                    : penResolvedPlanRow.plan.name}
                                            </span>
                                        </div>

                                        <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.8rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                            {penResolvedPlanRow.system === 'v2' ? (
                                                <>Bracket {penResolvedPlanRow.bracketMin}–{penResolvedPlanRow.bracketMax}kg · {penResolvedPlanRow.phase === 'ADAPTATION' ? `Day ${penResolvedPlanRow.dayNo} (Adaptation)` : 'Steady State'}</>
                                            ) : (
                                                <>{penResolvedPlanRow.usesAdaptationTable ? `Adaptation Day ${penResolvedPlanRow.adaptationDay}` : `Week ${penResolvedPlanRow.week.week}`}</>
                                            )}
                                            {' · '}{(penResolvedPlanRow.forageType || 'silage').toUpperCase()}
                                            {penResolvedPlanRow.daysOnFeed != null && <> · Day {penResolvedPlanRow.daysOnFeed} on feed</>}
                                        </div>

                                        {penWeightFlagsList.length > 0 && (
                                            <div style={{ background: 'rgba(220, 53, 69, 0.08)', border: '1px solid rgba(220, 53, 69, 0.25)', borderRadius: '8px', padding: '0.5rem 0.8rem', marginBottom: '0.8rem', fontSize: '0.76rem', color: 'hsl(0,75%,65%)' }}>
                                                <i className="fa-solid fa-triangle-exclamation"></i> {penWeightFlagsList.length} animal(s) weight divergence flagged in this pen.
                                            </div>
                                        )}

                                        <div className="table-wrapper">
                                            <table className="data-table" style={{ fontSize: '0.85rem' }}>
                                                <thead>
                                                    <tr>
                                                        <th>INGREDIENT</th>
                                                        <th>PLAN QTY</th>
                                                        <th>TODAY'S QTY (KG/HEAD)</th>
                                                        <th style={{ width: '60px', textAlign: 'center' }}>RESET</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {penPlanIngredientRows.map(row => (
                                                        <tr key={row.id}>
                                                            <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{row.name}</td>
                                                            <td>{row.planQty.toFixed(3)} kg</td>
                                                            <td>
                                                                <DeferredNumberInput
                                                                    step="0.001"
                                                                    className="form-control"
                                                                    style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '110px', color: row.isOverridden ? 'var(--accent-gold)' : 'inherit' }}
                                                                    value={row.qtyPerHead}
                                                                    onCommit={(val) => handlePlanOverride(penId, row.id, val)}
                                                                    disabled={!isAdmin}
                                                                />
                                                            </td>
                                                            <td style={{ textAlign: 'center' }}>
                                                                {row.isOverridden ? (
                                                                    <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => handleResetOverride(penId, row.id)} title="Reset to plan quantity">
                                                                        <i className="fa-solid fa-rotate-left"></i>
                                                                    </button>
                                                                ) : (
                                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {penExtraIngredientRows.map(row => (
                                                        <tr key={row.id} style={{ background: 'rgba(212,175,55,0.06)' }}>
                                                            <td style={{ fontWeight: '600', color: 'var(--accent-gold)' }}>
                                                                {row.name} <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: '400' }}>(added, not in plan)</span>
                                                            </td>
                                                            <td>—</td>
                                                            <td>
                                                                <DeferredNumberInput
                                                                    step="0.001"
                                                                    className="form-control"
                                                                    style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '110px', color: 'var(--accent-gold)' }}
                                                                    value={row.qtyPerHead}
                                                                    onCommit={(val) => handleExtraIngredientQty(penId, row.id, val)}
                                                                    disabled={!isAdmin}
                                                                />
                                                            </td>
                                                            <td style={{ textAlign: 'center' }}>
                                                                <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => handleRemoveExtraIngredient(penId, row.id)} title="Remove this ingredient">
                                                                    <i className="fa-solid fa-xmark"></i>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {isAdmin && penAvailableExtraIngredients.length > 0 && (
                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.8rem', flexWrap: 'wrap' }}>
                                                <select
                                                    className="form-control form-control-sm"
                                                    style={{ maxWidth: '280px', width: 'auto', flex: '1 1 auto' }}
                                                    value={getAddIngredientChoice(penId)}
                                                    onChange={(e) => setAddIngredientChoice(penId, e.target.value)}
                                                >
                                                    <option value="">Substitute / add an ingredient not in Pen {penId}'s plan…</option>
                                                    {penAvailableExtraIngredients.map(i => {
                                                        const stockQty = getIngredientStockQty(i.id);
                                                        return <option key={i.id} value={i.id}>{i.name}{stockQty !== null ? ` (${stockQty.toFixed(2)}kg in stock)` : ''}</option>;
                                                    })}
                                                </select>
                                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleAddExtraIngredient(penId)} disabled={!getAddIngredientChoice(penId)}>
                                                    <i className="fa-solid fa-circle-plus"></i> Add
                                                </button>
                                            </div>
                                        )}

                                        {penDietDiffered && (
                                            <div style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '8px', padding: '0.5rem 0.8rem', marginTop: '0.8rem', fontSize: '0.76rem', color: 'var(--accent-gold)' }}>
                                                <i className="fa-solid fa-triangle-exclamation"></i> Pen {penId}'s feeding differs from its Ration Plan today.
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : isBlocked ? (
                        <div className="glass-panel" style={{ borderTop: '4px solid hsl(0,75%,55%)', padding: '2rem 1.5rem' }}>
                            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                                <i className="fa-solid fa-ban" style={{ fontSize: '2.2rem', color: 'hsl(0,75%,60%)', marginBottom: '0.8rem' }}></i>
                                <h3 className="panel-title" style={{ justifyContent: 'center', marginBottom: '0.5rem', color: 'hsl(0,75%,65%)' }}>
                                    Feeding Blocked — Pen {selectedTMRPen}
                                </h3>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '520px', margin: '0 auto' }}>
                                    {resolvedPlanRow.error}
                                </p>
                            </div>

                            {resolvedPlanRow.availableDiets && resolvedPlanRow.availableDiets.length > 0 && (
                                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '1rem 1.2rem', marginTop: '1rem' }}>
                                    <h4 style={{ fontSize: '0.88rem', fontWeight: '700', color: 'var(--accent-gold)', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <i className="fa-solid fa-circle-nodes"></i> Available Diet Alternative(s) for Day {resolvedPlanRow.dayNo || '—'} ({resolvedPlanRow.avgProjectedWeight?.toFixed(1)}kg)
                                    </h4>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.8rem' }}>
                                        A ration bracket for <strong>{resolvedPlanRow.forageType.toUpperCase()}</strong> is missing for this weight, but matching diet plan(s) exist under other forage types:
                                    </p>

                                    {resolvedPlanRow.availableDiets.map((alt, idx) => (
                                        <div key={idx} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem' }}>
                                            <div>
                                                <span style={{ fontWeight: '700', color: 'var(--text-pure)', fontSize: '0.85rem' }}>
                                                    {alt.forageType.toUpperCase()} Diet
                                                </span>
                                                <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', color: 'var(--primary-green-light)' }}>
                                                    Bracket {alt.bracketMin}–{alt.bracketMax}kg
                                                </span>
                                                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                                    {Object.entries(alt.ingredients).map(([id, qty]) => {
                                                        const ingName = feedIngredients.find(i => i.id === id)?.name || id;
                                                        return `${ingName}: ${qty}kg`;
                                                    }).join(' · ')}
                                                </div>
                                            </div>
                                            {isAdmin && (
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => handleSwitchPenForage(selectedTMRPen, alt.forageType)}
                                                >
                                                    <i className="fa-solid fa-right-left"></i> Switch Pen {selectedTMRPen} to {alt.forageType.toUpperCase()}
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {(!resolvedPlanRow.availableDiets || resolvedPlanRow.availableDiets.length === 0) && resolvedPlanRow.nearestBrackets && resolvedPlanRow.nearestBrackets.length > 0 && (
                                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '1rem 1.2rem', marginTop: '1rem' }}>
                                    <h4 style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--accent-gold)', marginBottom: '0.4rem' }}>
                                        <i className="fa-solid fa-list-ol"></i> Nearest Brackets Defined in Plan for {resolvedPlanRow.forageType.toUpperCase()}
                                    </h4>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {resolvedPlanRow.nearestBrackets.map(b => `Bracket ${b.wtMin}–${b.wtMax}kg (ADG ${b.targetAdg}kg)`).join(' · ')}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : isPlanDriven ? (
                        <div class="glass-panel" style={{ borderTop: '4px solid var(--primary-green-light)' }}>
                            <h3 class="panel-title" style={{ marginBottom: '0.6rem' }}><i class="fa-solid fa-clipboard-check"></i> Plan-Driven Ration — Pen {selectedTMRPen}</h3>
                            <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <div style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                    {resolvedPlanRow.system === 'v2' ? (
                                        <>
                                            {resolvedPlanRow.plan.name} v{resolvedPlanRow.plan.version} — Bracket {resolvedPlanRow.bracketMin}–{resolvedPlanRow.bracketMax}kg · Projected {resolvedPlanRow.avgProjectedWeight?.toFixed(1)}kg
                                        </>
                                    ) : (
                                        <>
                                            {resolvedPlanRow.plan.name} — {resolvedPlanRow.usesAdaptationTable ? `Adaptation Day ${resolvedPlanRow.adaptationDay} of 7` : `Week ${resolvedPlanRow.week.week}`}
                                        </>
                                    )}
                                    <span style={{ marginLeft: '0.5rem', color: '#4a90d9', fontSize: '0.7rem', border: '1px solid rgba(74,144,217,0.3)', borderRadius: '4px', padding: '0.1rem 0.4rem' }}>
                                        {(resolvedPlanRow.forageType || 'silage').toUpperCase()}
                                    </span>
                                    {resolvedPlanRow.system === 'v2' && (
                                        <span style={{ marginLeft: '0.5rem', color: resolvedPlanRow.phase === 'ADAPTATION' ? 'var(--accent-gold)' : 'var(--primary-green-light)', fontSize: '0.75rem' }}>
                                            {resolvedPlanRow.phase === 'ADAPTATION' ? `DAY ${resolvedPlanRow.dayNo} (ADAPTATION)` : 'STEADY STATE'}
                                        </span>
                                    )}
                                    {resolvedPlanRow.system !== 'v2' && !resolvedPlanRow.usesAdaptationTable && resolvedPlanRow.usesDailyDiet && resolvedPlanRow.dayInWeek && <span style={{ marginLeft: '0.5rem', color: 'var(--primary-green-light)', fontSize: '0.75rem' }}>DAY {resolvedPlanRow.dayInWeek} OF 7</span>}
                                    {resolvedPlanRow.system !== 'v2' && resolvedPlanRow.usesAdaptationTable && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-gold)', fontSize: '0.75rem' }}>ADAPTATION</span>}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                    {resolvedPlanRow.matchedByWeight
                                        ? `Matched by projected weight (${resolvedPlanRow.avgProjectedWeight?.toFixed(1)} kg across ${resolvedPlanRow.headCount} head, last actual avg ${resolvedPlanRow.avgWeight?.toFixed(1)} kg)`
                                        : 'No weigh-in yet for this pen — matched by cycle day instead of actual weight'}
                                    {' · '}Target ADG {resolvedPlanRow.week.targetAdg || resolvedPlanRow.plan.adgFloor || 1.0} kg/day
                                    {resolvedPlanRow.daysOnFeed != null && <>{' · '}<strong style={{ color: 'var(--text-pure)' }}>Day {resolvedPlanRow.daysOnFeed} on feed</strong></>}
                                    {resolvedPlanRow.usesDailyDiet && !resolvedPlanRow.dayInWeek && ' · No cycle start date set — using Day 1 diet until one is set'}
                                </div>
                                {resolvedPlanRow.forageAdLib && (
                                    <div style={{ fontSize: '0.76rem', color: 'var(--primary-green-light)', marginTop: '0.3rem' }}>
                                        <i class="fa-solid fa-leaf"></i> {resolvedPlanRow.adLibForageId === 'chari' ? 'Chari' : 'Silage'}: fed ad lib — feed to appetite, not scaled into the batch below.
                                    </div>
                                )}
                                {resolvedPlanRow.week.note && (
                                    <div style={{ fontSize: '0.76rem', color: 'var(--accent-gold)', marginTop: '0.3rem', fontStyle: 'italic' }}>
                                        <i class="fa-solid fa-circle-info"></i> {resolvedPlanRow.week.note}
                                    </div>
                                )}
                            </div>

                            {penWeightFlags.length > 0 && (
                                <div style={{ background: 'rgba(220, 53, 69, 0.08)', border: '1px solid rgba(220, 53, 69, 0.25)', borderRadius: '8px', padding: '0.7rem 0.9rem', marginBottom: '1.2rem' }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: '700', color: 'hsl(0,75%,65%)', marginBottom: '0.3rem' }}>
                                        <i class="fa-solid fa-triangle-exclamation"></i> Weight divergence — check for illness, underfeeding, or a bad record
                                    </div>
                                    {penWeightFlags.map(f => (
                                        <div key={f.animalId} style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                            {f.rfid || f.animalId}: weighed {f.actual.toFixed(1)} kg on {formatDate(f.date)}, {f.pctDiff > 0 ? 'above' : 'below'} the {f.projected.toFixed(1)} kg projected ({(f.pctDiff * 100).toFixed(1)}%)
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div class="table-wrapper">
                                <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr>
                                            <th>INGREDIENT</th>
                                            <th>PLAN QTY (KG/HEAD/DAY)</th>
                                            <th>TODAY'S QTY</th>
                                            <th style={{ width: '60px', textAlign: 'center' }}>RESET</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {planIngredientRows.map(row => (
                                            <tr key={row.id}>
                                                <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{row.name}</td>
                                                <td>{row.planQty.toFixed(3)} kg</td>
                                                <td>
                                                    <DeferredNumberInput
                                                        step="0.001"
                                                        className="form-control"
                                                        style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '110px', color: row.isOverridden ? 'var(--accent-gold)' : 'inherit' }}
                                                        value={row.qtyPerHead}
                                                        onCommit={(val) => handlePlanOverride(selectedTMRPen, row.id, val)}
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {row.isOverridden ? (
                                                        <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => handleResetOverride(selectedTMRPen, row.id)} title="Reset to plan quantity">
                                                            <i class="fa-solid fa-rotate-left"></i>
                                                        </button>
                                                    ) : (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                        {extraIngredientRows.map(row => (
                                            <tr key={row.id} style={{ background: 'rgba(212,175,55,0.06)' }}>
                                                <td style={{ fontWeight: '600', color: 'var(--accent-gold)' }}>
                                                    {row.name} <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: '400' }}>(added, not in plan)</span>
                                                </td>
                                                <td>—</td>
                                                <td>
                                                    <DeferredNumberInput
                                                        step="0.001"
                                                        className="form-control"
                                                        style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '110px', color: 'var(--accent-gold)' }}
                                                        value={row.qtyPerHead}
                                                        onCommit={(val) => handleExtraIngredientQty(selectedTMRPen, row.id, val)}
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => handleRemoveExtraIngredient(selectedTMRPen, row.id)} title="Remove this ingredient">
                                                        <i class="fa-solid fa-xmark"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {isAdmin && availableExtraIngredients.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.8rem', flexWrap: 'wrap' }}>
                                    <select
                                        className="form-control form-control-sm"
                                        style={{ maxWidth: '280px', width: 'auto', flex: '1 1 auto' }}
                                        value={getAddIngredientChoice(selectedTMRPen)}
                                        onChange={(e) => setAddIngredientChoice(selectedTMRPen, e.target.value)}
                                    >
                                        <option value="">Substitute / add an ingredient not in this plan…</option>
                                        {availableExtraIngredients.map(i => {
                                            const stockQty = getIngredientStockQty(i.id);
                                            return <option key={i.id} value={i.id}>{i.name}{stockQty !== null ? ` (${stockQty.toFixed(2)}kg in stock)` : ''}</option>;
                                        })}
                                    </select>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleAddExtraIngredient(selectedTMRPen)} disabled={!getAddIngredientChoice(selectedTMRPen)}>
                                        <i className="fa-solid fa-circle-plus"></i> Add
                                    </button>
                                </div>
                            )}

                            {dietDiffered && (
                                <div style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '8px', padding: '0.6rem 0.9rem', marginTop: '1rem', fontSize: '0.78rem', color: 'var(--accent-gold)' }}>
                                    <i class="fa-solid fa-triangle-exclamation"></i> Today's feeding differs from the Ration Plan — this will be recorded in the feed log's notes and flagged in Feed Stock's Issues by Pen.
                                </div>
                            )}

                            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.8rem', marginBottom: 0 }}>
                                <i class="fa-solid fa-circle-info"></i> Overrides/additions here apply to today's logged feeding only — the Ration Plan schedule itself is unchanged. Manage the schedule from Ration Plans.
                            </p>
                        </div>
                    ) : (
                        /* Rations are only ever set by a Ration Plan (under Ration Plans) — this
                           page never allows a manual/global recipe. Nothing to feed or calculate
                           until a plan is assigned to the selected pen. */
                        <div class="glass-panel" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                            <i class="fa-solid fa-clipboard-list" style={{ fontSize: '2rem', color: 'var(--text-muted)', marginBottom: '1rem' }}></i>
                            <h3 class="panel-title" style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>
                                No Ration Plan Assigned — Pen {selectedTMRPen}
                            </h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '440px', margin: '0 auto' }}>
                                This pen has no Ration Plan attached, so there's nothing to feed or calculate here. Assign one under Ration Plans → Pen Assignment.
                            </p>
                        </div>
                    )}

                </div>

                {/* Right: Outputs, Batch Scale & Tractor mixer mode */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

                    {!isTractorMode ? (
                        <div class="glass-panel" style={{ borderTop: '4px solid var(--accent-gold)' }}>
                            <div class="form-header-bar" style={{ marginBottom: '1.2rem', gap: '1rem', flexWrap: 'wrap' }}>
                                <h3 class="panel-title" style={{ marginBottom: '0' }}><i class="fa-solid fa-scale-balanced"></i> Batch Recipe</h3>
                                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                    <button type="button" class="btn btn-secondary" style={{ minHeight: '44px' }} onClick={openTractorMode} disabled={tractorEligiblePens.length === 0}>
                                        <i class="fa-solid fa-tractor"></i> Tractor Mode
                                    </button>
                                </div>
                            </div>

                            {/* Daily Feeding Schedule Split Selector */}
                            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: numFeedings > 1 ? '0.6rem' : 0 }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <i className="fa-solid fa-clock-rotate-left" style={{ color: 'var(--accent-gold)' }}></i> Daily Feeding Schedule
                                    </span>
                                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                                        {[1, 2, 3].map(n => (
                                            <button
                                                key={n}
                                                type="button"
                                                className={`filter-btn ${numFeedings === n ? 'active' : ''}`}
                                                style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '28px' }}
                                                onClick={() => {
                                                    setNumFeedings(n);
                                                    setActiveFeedingIndex(0);
                                                }}
                                            >
                                                {n} {n === 1 ? 'Feeding (100%)' : 'Feedings'}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {numFeedings > 1 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.8rem', borderRadius: '8px', marginBottom: '0.6rem' }}>
                                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: '600' }}>Custom Split (%):</span>
                                        {activeSplitList.map((pct, idx) => (
                                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-pure)' }}>Feed {idx + 1}:</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="100"
                                                    className="form-control"
                                                    style={{ width: '60px', height: '28px', minHeight: '28px', padding: '0.1rem 0.4rem', fontSize: '0.8rem', textAlign: 'center' }}
                                                    value={pct}
                                                    onChange={(e) => handleSplitPctChange(idx, e.target.value)}
                                                />
                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>%</span>
                                            </div>
                                        ))}
                                        <span style={{ fontSize: '0.72rem', fontWeight: '700', marginLeft: 'auto', color: totalSplitPct === 100 ? 'var(--primary-green-light)' : 'hsl(0,75%,65%)' }}>
                                            Total: {totalSplitPct}% {totalSplitPct !== 100 && '(must = 100%)'}
                                        </span>
                                    </div>
                                )}

                                {numFeedings > 1 && (
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                                        <button
                                            type="button"
                                            className={`filter-btn ${activeFeedingIndex === 0 ? 'active' : ''}`}
                                            style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '26px' }}
                                            onClick={() => setActiveFeedingIndex(0)}
                                        >
                                            Full Day Total (100%)
                                        </button>
                                        {activeSplitList.map((pct, idx) => {
                                            const feedNum = idx + 1;
                                            const label = numFeedings === 2 ? (feedNum === 1 ? 'Morning' : 'Evening') : (feedNum === 1 ? 'Morning' : feedNum === 2 ? 'Afternoon' : 'Evening');
                                            return (
                                                <button
                                                    key={feedNum}
                                                    type="button"
                                                    className={`filter-btn ${activeFeedingIndex === feedNum ? 'active' : ''}`}
                                                    style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '26px' }}
                                                    onClick={() => setActiveFeedingIndex(feedNum)}
                                                >
                                                    Feeding {feedNum} ({label} — {pct}%)
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Batch Sizing and Filter bar inline */}
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', background: 'rgba(0, 0, 0, 0.15)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
                                {activePens.length > 0 && (
                                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pen:</span>
                                        <button
                                            type="button"
                                            class={`filter-btn ${selectedTMRPen === 'all' ? 'active' : ''}`}
                                            style={{ fontSize: '0.7rem', minHeight: '26px', padding: '0.15rem 0.5rem' }}
                                            onClick={() => setSelectedTMRPen('all')}
                                        >All ({activeHerdCount})</button>
                                        {activePens.map(p => {
                                            const penCount = animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.pen === p).length;
                                            const hasPlan = pens.some(pc => pc.id === p && pc.rationPlanId);
                                            return (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    class={`filter-btn ${selectedTMRPen === p ? 'active' : ''}`}
                                                    style={{ fontSize: '0.7rem', minHeight: '26px', padding: '0.15rem 0.5rem' }}
                                                    onClick={() => setSelectedTMRPen(p)}
                                                    title={hasPlan ? 'Has a Ration Plan assigned — selecting this pen auto-fills the batch' : 'No Ration Plan assigned — assign one under Ration Plans to feed this pen'}
                                                >Pen {p} ({penCount}){hasPlan && ' \u2713'}</button>
                                            );
                                        })}
                                        {activePens.some(p => pens.some(pc => pc.id === p && pc.rationPlanId)) && (
                                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: '0.2rem' }}>
                                                ({'\u2713'} = has a Ration Plan — auto-fills the batch below)
                                            </span>
                                        )}
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Calves:</span>
                                    <input
                                        type="number"
                                        class="form-control"
                                        style={{ width: '70px', minHeight: '28px', height: '28px', padding: '0.15rem 0.4rem', fontSize: '0.82rem' }}
                                        value={animalsCount}
                                        onChange={(e) => setAnimalsCount(Math.max(1, parseInt(e.target.value) || 1))}
                                    />
                                </div>
                            </div>

                            {isPlanDriven ? (
                                <>
                                    <div class="table-wrapper" style={{ marginBottom: '1.2rem' }}>
                                        <table class="data-table">
                                            <thead>
                                                <tr>
                                                    <th>FEED INGREDIENT</th>
                                                    <th>QTY / HEAD</th>
                                                    <th>WET WT / ANIMAL</th>
                                                    <th>BATCH WEIGHT</th>
                                                    {isSuperAdmin && <th>BATCH COST</th>}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {displayIngredients.map(ing => (
                                                    <tr key={ing.id}>
                                                        <td><strong>{ing.name}</strong>{ing.isExtra && <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--accent-gold)' }}>ADDED</span>}</td>
                                                        <td>{(ing.dmTarget * activeFeedingScale).toFixed(2)} kg</td>
                                                        <td>{(ing.wetSingle * activeFeedingScale).toFixed(2)} kg</td>
                                                        <td><strong style={{ color: 'var(--primary-green-light)', fontSize: '1.05rem' }}>{(ing.wetBatch * activeFeedingScale).toFixed(2)} kg</strong></td>
                                                        {isSuperAdmin && <td>{Math.round(ing.costSingle * animalsCount * activeFeedingScale).toLocaleString()} PKR</td>}
                                                    </tr>
                                                ))}
                                                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                                    <td><strong>Total Feed Mix</strong></td>
                                                    <td><strong>{(totalDM * activeFeedingScale).toFixed(2)} kg</strong></td>
                                                    <td><strong>{(displayIngredients.reduce((sum, ing) => sum + ing.wetSingle, 0) * activeFeedingScale).toFixed(2)} kg</strong></td>
                                                    <td><strong style={{ color: 'var(--accent-gold)', fontSize: '1.15rem' }}>{(totalBatchWeight * activeFeedingScale).toFixed(2)} kg</strong></td>
                                                    {isSuperAdmin && <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(totalCostSingle * animalsCount * activeFeedingScale).toLocaleString()} PKR</strong></td>}
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Batch Weight Summary — total batch cost is Super Admin only (staffUser.isAdmin),
                                        pen-level staff logging feed only need the weight to mix. */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.2rem', alignItems: 'center' }}>
                                        <div>
                                            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                {activeFeedingIndex > 0 ? `Target for Feeding ${activeFeedingIndex} of ${numFeedings} (${activeFeedingPct}%)` : 'Total batch to mix'}
                                            </span>
                                            <strong style={{ fontSize: '1.4rem', color: 'var(--accent-gold)', fontFamily: 'var(--font-heading)' }}>
                                                {(totalBatchWeight * activeFeedingScale).toFixed(2)} kg
                                            </strong>
                                            {isSuperAdmin && (
                                                <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                    Cost: <strong style={{ color: 'var(--accent-gold)' }}>{Math.round(totalCostSingle * animalsCount * activeFeedingScale).toLocaleString()} PKR</strong>
                                                    {' '}({Math.round(totalCostSingle * activeFeedingScale).toLocaleString()} PKR/head)
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                            For {animalsCount} animal{animalsCount === 1 ? '' : 's'}
                                        </div>
                                    </div>

                                    {/* Log Today's Feed — snapshots this batch as a dated, immutable
                                        record so it's known exactly what was fed which day and what
                                        it cost, independent of any later Ration Plan edits. */}
                                    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.2rem', marginTop: '1.2rem' }}>
                                        <input
                                            type="date"
                                            class="form-control"
                                            style={{ width: '150px', minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.82rem' }}
                                            value={logDate}
                                            max={todayPKT()}
                                            onChange={(e) => setLogDate(e.target.value)}
                                        />
                                        <button type="button" class="btn btn-primary btn-sm" onClick={handleLogFeed}>
                                            <i class="fa-solid fa-clipboard-check"></i> Log This Feeding (Pen {selectedTMRPen})
                                        </button>
                                        {logSaved && (
                                            <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                                <i class="fa-solid fa-circle-check"></i> Feed logged for {formatDate(logDate)}.
                                            </span>
                                        )}
                                    </div>
                                </>
                            ) : selectedTMRPen === 'all' ? (
                                allPensResolutions.length === 0 ? (
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
                                        No pens have an assigned Ration Plan yet — nothing to average.
                                    </p>
                                ) : (
                                    <>
                                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '-0.6rem', marginBottom: '1rem' }}>
                                            Headcount-weighted average across {allPensResolutions.length} pen{allPensResolutions.length === 1 ? '' : 's'} ({allPensTotalHeadCount} head) — aggregated dynamically from the per-pen rations and custom overrides on the left.
                                        </p>

                                        {allPensMismatch && !allPensConfirmedMismatch && (
                                            <div style={{ background: 'rgba(220, 53, 69, 0.1)', border: '1px solid rgba(220, 53, 69, 0.35)', borderRadius: '8px', padding: '1rem 1.2rem', marginBottom: '1.2rem' }}>
                                                <div style={{ fontWeight: '700', color: 'hsl(0,75%,70%)', marginBottom: '0.5rem' }}>
                                                    <i class="fa-solid fa-triangle-exclamation"></i> Pens don't share the same forage type / feeding phase
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.8rem' }}>
                                                    {allPensMismatchedPens.join(' · ')} — averaging these together blends meaningfully different rations.
                                                </div>
                                                <button type="button" class="btn btn-secondary btn-sm" onClick={() => setAllPensConfirmedMismatch(true)}>
                                                    Average Anyway
                                                </button>
                                            </div>
                                        )}

                                        {allPensAggregateIngredients.length > 0 && (
                                            <>
                                                <div class="table-wrapper" style={{ marginBottom: '1.2rem' }}>
                                                    <table class="data-table">
                                                        <thead>
                                                            <tr>
                                                                <th>FEED INGREDIENT</th>
                                                                <th>AVG QTY / HEAD</th>
                                                                <th>BATCH WEIGHT</th>
                                                                {isSuperAdmin && <th>BATCH COST</th>}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {allPensAggregateIngredients.map(ing => (
                                                                <tr key={ing.id}>
                                                                    <td><strong>{ing.name}</strong></td>
                                                                    <td>{(ing.avgPerHead * activeFeedingScale).toFixed(3)} kg</td>
                                                                    <td><strong style={{ color: 'var(--primary-green-light)', fontSize: '1.05rem' }}>{(ing.wetBatch * activeFeedingScale).toFixed(2)} kg</strong></td>
                                                                    {isSuperAdmin && <td>{Math.round(ing.cost * activeFeedingScale).toLocaleString()} PKR</td>}
                                                                </tr>
                                                            ))}
                                                            <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                                                <td><strong>Total Feed Mix</strong></td>
                                                                <td><strong>{(allPensAggregateIngredients.reduce((sum, i) => sum + i.avgPerHead, 0) * activeFeedingScale).toFixed(3)} kg</strong></td>
                                                                <td><strong style={{ color: 'var(--accent-gold)', fontSize: '1.15rem' }}>{(allPensTotalBatchWeight * activeFeedingScale).toFixed(2)} kg</strong></td>
                                                                {isSuperAdmin && <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(allPensTotalCost * activeFeedingScale).toLocaleString()} PKR</strong></td>}
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.2rem', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem' }}>
                                                    <div>
                                                        <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                            {activeFeedingIndex > 0 ? `Target for Feeding ${activeFeedingIndex} of ${numFeedings} (${activeFeedingPct}%)` : 'Total batch to mix'}
                                                        </span>
                                                        <strong style={{ fontSize: '1.4rem', color: 'var(--accent-gold)', fontFamily: 'var(--font-heading)' }}>
                                                            {(allPensTotalBatchWeight * activeFeedingScale).toFixed(2)} kg
                                                        </strong>
                                                        {isSuperAdmin && (
                                                            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                                Cost: <strong style={{ color: 'var(--accent-gold)' }}>{Math.round(allPensTotalCost * activeFeedingScale).toLocaleString()} PKR</strong>
                                                                {' '}({Math.round((allPensTotalCost / (allPensTotalHeadCount || 1)) * activeFeedingScale).toLocaleString()} PKR/head)
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                        For {allPensTotalHeadCount} animals across {allPensResolutions.length} pen{allPensResolutions.length === 1 ? '' : 's'}
                                                    </div>
                                                </div>

                                                <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.2rem', marginTop: '1.2rem' }}>
                                                    <input
                                                        type="date"
                                                        class="form-control"
                                                        style={{ width: '150px', minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.82rem' }}
                                                        value={logDate}
                                                        max={todayPKT()}
                                                        onChange={(e) => setLogDate(e.target.value)}
                                                    />
                                                    <button type="button" class="btn btn-primary btn-sm" onClick={handleLogAllPensFromAllView}>
                                                        <i class="fa-solid fa-clipboard-check"></i> Log This Feeding — {allPensResolutions.length} Pen{allPensResolutions.length === 1 ? '' : 's'}
                                                    </button>
                                                    {logSaved && (
                                                        <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                                            <i class="fa-solid fa-circle-check"></i> Feed logged for {formatDate(logDate)}.
                                                        </span>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </>
                                )
                            ) : (
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
                                    Nothing to calculate yet — select a pen with an assigned Ration Plan.
                                </p>
                            )}
                        </div>
                    ) : (
                        /* Tractor Mixing View Console — a genuine fullscreen overlay
                           (see .tractor-mode-box, position:fixed) so it's always reachable
                           and tappable on a phone regardless of scroll position. */
                        <div class="tractor-mode-box">
                            <button type="button" class="modal-close-btn" onClick={() => setIsTractorMode(false)}>
                                <i class="fa-solid fa-rectangle-list" style={{ marginRight: '0.4rem', fontSize: '0.95rem', color: 'var(--accent-gold)' }}></i>
                                <span style={{ fontFamily: 'var(--font-heading)', fontSize: '0.85rem', fontWeight: '700', color: 'var(--accent-gold)' }}>Exit Tractor Mode</span>
                            </button>

                            <div class="tractor-logo-icon"><i class="fa-solid fa-tractor"></i></div>
                            <h2>Tractor Mixing Screen</h2>

                            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Feeding Date:</span>
                                <input
                                    type="date"
                                    class="form-control"
                                    style={{ width: '150px', minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.82rem' }}
                                    value={logDate}
                                    max={todayPKT()}
                                    onChange={(e) => setLogDate(e.target.value)}
                                />
                                <button type="button" class="btn btn-secondary btn-sm" onClick={() => setTractorSelectedPens(tractorEligiblePens)} disabled={tractorSelectedPens.length === tractorEligiblePens.length}>
                                    <i class="fa-solid fa-check-double"></i> Select All ({tractorEligiblePens.length})
                                </button>
                                {tractorSelectedPens.length > 0 && (
                                    <button type="button" class="btn btn-secondary btn-sm" onClick={() => setTractorSelectedPens([])}>
                                        Clear
                                    </button>
                                )}
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', margin: '1rem 0' }}>
                                {tractorEligiblePens.map(p => (
                                    <label
                                        key={p}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer',
                                            background: tractorSelectedPens.includes(p) ? 'rgba(255,193,7,0.15)' : 'rgba(0,0,0,0.2)',
                                            border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
                                            padding: '0.35rem 0.7rem', fontSize: '0.8rem', color: 'var(--text-pure)'
                                        }}
                                    >
                                        <input type="checkbox" checked={tractorSelectedPens.includes(p)} onChange={() => toggleTractorPen(p)} />
                                        Pen {p}
                                    </label>
                                ))}
                            </div>

                            {tractorPenResolutions.length === 0 && (
                                <p class="batch-sub">Select one or more pens above with an assigned Ration Plan.</p>
                            )}

                            {tractorPenResolutions.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center', margin: '0 auto 1rem', maxWidth: '640px' }}>
                                    {tractorPenResolutions.map(({ penId, resolved }) => (
                                        <span
                                            key={penId}
                                            style={{
                                                fontSize: '0.72rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.25)',
                                                border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '0.2rem 0.55rem'
                                            }}
                                        >
                                            <strong style={{ color: 'var(--text-pure)' }}>Pen {penId}</strong>
                                            {' — Day '}{resolved.daysOnFeed ?? '—'}{' on feed · '}
                                            {tractorPhaseOf(resolved) === 'ADAPTATION' ? 'Adaptation' : 'Steady State'}
                                            {' · '}{resolved.headCount} head
                                        </span>
                                    ))}
                                </div>
                            )}

                            {tractorMismatch && !tractorConfirmedMismatch && tractorPenResolutions.length > 0 && (
                                <div style={{ background: 'rgba(220, 53, 69, 0.1)', border: '1px solid rgba(220, 53, 69, 0.35)', borderRadius: '8px', padding: '1rem 1.2rem', maxWidth: '520px', margin: '0 auto 1rem', textAlign: 'left' }}>
                                    <div style={{ fontWeight: '700', color: 'hsl(0,75%,70%)', marginBottom: '0.5rem' }}>
                                        <i class="fa-solid fa-triangle-exclamation"></i> Selected pens don't share the same forage type / feeding phase
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.8rem' }}>
                                        {tractorMismatchedPens.join(' · ')} — aggregating these into one batch would mix meaningfully different rations.
                                    </div>
                                    <button type="button" class="btn btn-secondary btn-sm" onClick={() => setTractorConfirmedMismatch(true)}>
                                        Aggregate Anyway
                                    </button>
                                </div>
                            )}

                            {/* Daily Feeding Schedule Split Selector inside Tractor Mode */}
                            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '0.8rem 1rem', maxWidth: '640px', margin: '0 auto 1.2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: numFeedings > 1 ? '0.6rem' : 0 }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <i className="fa-solid fa-clock-rotate-left" style={{ color: 'var(--accent-gold)' }}></i> Daily Feeding Schedule
                                    </span>
                                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                                        {[1, 2, 3].map(n => (
                                            <button
                                                key={n}
                                                type="button"
                                                className={`filter-btn ${numFeedings === n ? 'active' : ''}`}
                                                style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '28px' }}
                                                onClick={() => {
                                                    setNumFeedings(n);
                                                    setActiveFeedingIndex(0);
                                                }}
                                            >
                                                {n} {n === 1 ? 'Feeding (100%)' : 'Feedings'}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {numFeedings > 1 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.8rem', borderRadius: '8px', marginBottom: '0.6rem' }}>
                                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: '600' }}>Custom Split (%):</span>
                                        {activeSplitList.map((pct, idx) => (
                                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-pure)' }}>Feed {idx + 1}:</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="100"
                                                    className="form-control"
                                                    style={{ width: '60px', height: '28px', minHeight: '28px', padding: '0.1rem 0.4rem', fontSize: '0.8rem', textAlign: 'center' }}
                                                    value={pct}
                                                    onChange={(e) => handleSplitPctChange(idx, e.target.value)}
                                                />
                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>%</span>
                                            </div>
                                        ))}
                                        <span style={{ fontSize: '0.72rem', fontWeight: '700', marginLeft: 'auto', color: totalSplitPct === 100 ? 'var(--primary-green-light)' : 'hsl(0,75%,65%)' }}>
                                            Total: {totalSplitPct}% {totalSplitPct !== 100 && '(must = 100%)'}
                                        </span>
                                    </div>
                                )}

                                {numFeedings > 1 && (
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                                        <button
                                            type="button"
                                            className={`filter-btn ${activeFeedingIndex === 0 ? 'active' : ''}`}
                                            style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '26px' }}
                                            onClick={() => setActiveFeedingIndex(0)}
                                        >
                                            Full Day Total (100%)
                                        </button>
                                        {activeSplitList.map((pct, idx) => {
                                            const feedNum = idx + 1;
                                            const label = numFeedings === 2 ? (feedNum === 1 ? 'Morning' : 'Evening') : (feedNum === 1 ? 'Morning' : feedNum === 2 ? 'Afternoon' : 'Evening');
                                            return (
                                                <button
                                                    key={feedNum}
                                                    type="button"
                                                    className={`filter-btn ${activeFeedingIndex === feedNum ? 'active' : ''}`}
                                                    style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '26px' }}
                                                    onClick={() => setActiveFeedingIndex(feedNum)}
                                                >
                                                    Feeding {feedNum} ({label} — {pct}%)
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {tractorAggregateIngredients.length > 0 && (
                                <>
                                    <p class="batch-sub">
                                        Total batch for {tractorTotalHeadCount} calves across {tractorPenResolutions.length} pen{tractorPenResolutions.length === 1 ? '' : 's'}
                                        {activeFeedingIndex > 0 ? ` — Feeding ${activeFeedingIndex} of ${numFeedings} (${activeFeedingPct}%)` : ' — Full Day Total (100%)'}
                                        {tractorMismatch ? ' (mismatched forage/phase — confirmed)' : ''}
                                    </p>
                                    <div class="tractor-mix-list">
                                        {tractorAggregateIngredients.map((ing, idx) => (
                                            <div class="tractor-mix-item" key={ing.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(ing.id === 'minerals' ? { borderLeftColor: 'var(--accent-gold)' } : {}) }}>
                                                <span>{idx + 1}. WET {ing.name.toUpperCase()}</span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    <DeferredNumberInput
                                                        step="0.1"
                                                        className="form-control"
                                                        style={{ width: '110px', height: '36px', minHeight: '36px', textAlign: 'right', fontSize: '1.05rem', fontWeight: '700', color: 'var(--primary-green-light)', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)' }}
                                                        value={parseFloat(ing.wetBatch.toFixed(2))}
                                                        onCommit={(val) => {
                                                            // `ing.wetBatch` is already scaled to the active feeding
                                                            // (Full Day / Feeding N of the split), so the typed value
                                                            // is this feeding's batch weight — pass its per-head
                                                            // equivalent straight through. handleAggregateOverride
                                                            // does its own /activeFeedingScale conversion to a
                                                            // full-day value internally; unscaling here too was
                                                            // dividing twice, inflating whatever was typed whenever
                                                            // a split other than Full Day (100%) was active.
                                                            const newScaledBatch = parseFloat(val) || 0;
                                                            const newAvgPerHeadThisFeeding = tractorTotalHeadCount > 0 ? newScaledBatch / tractorTotalHeadCount : 0;
                                                            handleAggregateOverride(tractorSelectedPens, tractorTableRows, ing.id, newAvgPerHeadThisFeeding.toString());
                                                        }}
                                                        disabled={!isAdmin}
                                                    />
                                                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-muted)' }}>KG</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <p style={{ marginTop: '2rem', fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                        <i class="fa-solid fa-circle-info"></i> Weigh ingredients sequentially inside the mixer wagon scales. Total batch target: {tractorTotalBatchWeight.toFixed(2)} kg · Est. cost: {Math.round(tractorTotalCost)} PKR.
                                    </p>

                                    {/* Logs every pen in tractorPenResolutions as its own feed-log record in one
                                        click — "feeding all pens together" from the mixer's point of view, while
                                        keeping per-pen history intact for every downstream report. */}
                                    <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
                                        <button
                                            type="button"
                                            class="btn btn-primary"
                                            style={{ minHeight: '48px' }}
                                            onClick={handleLogAllPens}
                                            disabled={tractorMismatch && !tractorConfirmedMismatch}
                                        >
                                            <i class="fa-solid fa-clipboard-check"></i> Log This Feeding — {tractorPenResolutions.length} Pen{tractorPenResolutions.length === 1 ? '' : 's'}
                                        </button>
                                        {logSaved && (
                                            <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                                <i class="fa-solid fa-circle-check"></i> Feed logged for {formatDate(logDate)} across {tractorPenResolutions.length} pen{tractorPenResolutions.length === 1 ? '' : 's'}.
                                            </span>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                </div>

            </div>

            {!isTractorMode && renderDietPreviewPanel()}

            {/* Feed History — what was actually fed each logged day, immutable regardless
                of later recipe edits. Full historical view lives in Feed & Growth Report. */}
            {recentFeedLogs.length > 0 && (
                <div class="glass-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                        <h3 class="panel-title" style={{ margin: 0 }}>
                            <i class="fa-solid fa-clock-rotate-left"></i> Recent Feed History
                        </h3>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                            <i class="fa-solid fa-circle-info" style={{ marginRight: '4px' }}></i> Click any row to view full ingredient breakdown & per head details
                        </span>
                    </div>
                    <div class="table-wrapper">
                        <table class="data-table" style={{ fontSize: '0.85rem' }}>
                            <thead>
                                <tr>
                                    <th>DATE</th>
                                    <th>PEN</th>
                                    <th>SESSION / SPLIT</th>
                                    <th>ANIMALS</th>
                                    <th>TOTAL BATCH</th>
                                    <th>NOTES</th>
                                    <th style={{ width: '80px', textAlign: 'center' }}>DETAILS</th>
                                    {isAdmin && <th style={{ width: '60px', textAlign: 'center' }}>REMOVE</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {recentFeedLogs.map((log, idx) => {
                                    const sessionLabel = parseFeedingSession(log);
                                    return (
                                        <tr
                                            key={`${log.date}__${log.pen}__${idx}`}
                                            style={{ cursor: 'pointer', transition: 'background 0.15s ease' }}
                                            onClick={() => setSelectedFeedLogDetails(log)}
                                            title="Click to view full ingredient breakdown"
                                        >
                                            <td>{formatDate(log.date)}</td>
                                            <td><strong style={{ color: 'var(--text-pure)' }}>{log.pen === 'ALL' ? 'All Pens' : `Pen ${log.pen}`}</strong></td>
                                            <td>
                                                <span style={{
                                                    fontSize: '0.74rem',
                                                    fontWeight: '600',
                                                    padding: '0.15rem 0.55rem',
                                                    borderRadius: '4px',
                                                    background: 'rgba(255, 193, 7, 0.12)',
                                                    color: 'var(--accent-gold)',
                                                    border: '1px solid rgba(255, 193, 7, 0.25)',
                                                    display: 'inline-block'
                                                }}>
                                                    <i class="fa-solid fa-cookie-bite" style={{ marginRight: '4px', fontSize: '0.7rem' }}></i>
                                                    {sessionLabel}
                                                </span>
                                            </td>
                                            <td>{log.animalCount}</td>
                                            <td><strong style={{ color: 'var(--primary-green-light)', fontSize: '0.95rem' }}>{(log.totalBatchKg || 0).toFixed(2)} kg</strong></td>
                                            <td>
                                                {log.dietDiffered ? (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--accent-gold)' }} title={log.notes}>
                                                        <i class="fa-solid fa-triangle-exclamation"></i> Differed from plan
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>As planned</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <button
                                                    type="button"
                                                    class="btn btn-secondary btn-sm"
                                                    style={{ padding: '0.15rem 0.55rem', minHeight: '26px', fontSize: '0.75rem', color: 'var(--accent-gold)', borderColor: 'rgba(255,193,7,0.3)' }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedFeedLogDetails(log);
                                                    }}
                                                    title="Click to view complete feed breakdown"
                                                >
                                                    <i class="fa-solid fa-eye"></i> View
                                                </button>
                                            </td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                                    <button
                                                        type="button"
                                                        class="btn btn-secondary"
                                                        style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                        onClick={() => {
                                                            const penLabel = log.pen === 'ALL' ? 'All Pens' : `Pen ${log.pen}`;
                                                            if (window.confirm(`Undo this feed log?\n\n${formatDate(log.date)} · ${penLabel} · ${(log.totalBatchKg || 0).toFixed(2)} kg\n\nThis also reverses the matching entry in the Feed Stock ledger and the Feed & Growth Report. This cannot be undone.`)) {
                                                                deleteFeedLog(log.date, log.pen, log.feedingIndex);
                                                            }
                                                        }}
                                                        title="Undo this feed log"
                                                    >
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Complete Feed Breakdown Modal */}
            {selectedFeedLogDetails && createPortal(
                <div
                    className="portal-modal-overlay"
                    onClick={() => setSelectedFeedLogDetails(null)}
                    style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0, 0, 0, 0.78)', backdropFilter: 'blur(5px)',
                        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
                    }}
                >
                    <div
                        className="glass-panel animate-scale-up"
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: '100%', maxWidth: '820px', maxHeight: '92vh', overflowY: 'auto',
                            border: '1px solid rgba(255, 255, 255, 0.15)', boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                            background: 'var(--panel-bg, #121824)', borderRadius: '14px', padding: '1.8rem'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.2rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
                            <div>
                                <h3 className="panel-title" style={{ fontSize: '1.35rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <i className="fa-solid fa-wheat-awn" style={{ color: 'var(--accent-gold)' }}></i>
                                    Feed Log Breakdown — {selectedFeedLogDetails.pen === 'ALL' ? 'All Pens' : `Pen ${selectedFeedLogDetails.pen}`}
                                </h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', margin: 0 }}>
                                    Logged on <strong>{formatDate(selectedFeedLogDetails.date)}</strong>
                                    {selectedFeedLogDetails.createdBy && (
                                        <span> by <strong style={{ color: 'var(--accent-gold)' }}>{selectedFeedLogDetails.createdBy}</strong></span>
                                    )}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setSelectedFeedLogDetails(null)}
                                style={{ fontSize: '1.1rem', padding: '0.15rem 0.6rem', lineHeight: 1 }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Summary Metrics Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.8rem', marginBottom: '1.5rem' }}>
                            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Feeding Session</span>
                                <strong style={{ fontSize: '0.98rem', color: 'var(--accent-gold)' }}>{parseFeedingSession(selectedFeedLogDetails)}</strong>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Head Count</span>
                                <strong style={{ fontSize: '0.98rem', color: 'var(--text-pure)' }}>{selectedFeedLogDetails.animalCount} animals</strong>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Batch Weight</span>
                                <strong style={{ fontSize: '0.98rem', color: 'var(--primary-green-light)' }}>{(selectedFeedLogDetails.totalBatchKg || 0).toFixed(2)} kg</strong>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg Feed / Head</span>
                                <strong style={{ fontSize: '0.98rem', color: 'var(--text-pure)' }}>{((selectedFeedLogDetails.totalBatchKg || 0) / (selectedFeedLogDetails.animalCount || 1)).toFixed(2)} kg/head</strong>
                            </div>
                            {isSuperAdmin && (
                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Cost</span>
                                    <strong style={{ fontSize: '0.98rem', color: 'var(--accent-gold)' }}>{Math.round(selectedFeedLogDetails.totalCost || 0).toLocaleString()} PKR</strong>
                                </div>
                            )}
                        </div>

                        {/* Complete Ingredient Breakdown Table */}
                        <h4 style={{ fontSize: '0.95rem', color: 'var(--text-pure)', marginBottom: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <i className="fa-solid fa-list-check" style={{ color: 'var(--accent-gold)' }}></i> Complete Ingredient Breakdown
                        </h4>
                        <div className="table-wrapper" style={{ marginBottom: '1.4rem' }}>
                            <table className="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>INGREDIENT</th>
                                        <th style={{ textAlign: 'right' }}>BATCH TOTAL (KG)</th>
                                        <th style={{ textAlign: 'right' }}>FED / HEAD (KG)</th>
                                        <th style={{ textAlign: 'right' }}>PLANNED / HEAD</th>
                                        {isSuperAdmin && <th style={{ textAlign: 'right' }}>PRICE / KG</th>}
                                        {isSuperAdmin && <th style={{ textAlign: 'right' }}>TOTAL COST</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(selectedFeedLogDetails.ingredients || []).map((ing, idx) => {
                                        const fedHead = ing.wetSingle || (ing.wetBatch / (selectedFeedLogDetails.animalCount || 1)) || 0;
                                        const isDiff = ing.plannedQtyKg != null && Math.abs(fedHead - ing.plannedQtyKg) > 0.001;
                                        return (
                                            <tr key={ing.id || idx}>
                                                <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>
                                                    {ing.name}
                                                    {isDiff && (
                                                        <span style={{ marginLeft: '0.45rem', fontSize: '0.7rem', color: 'var(--accent-gold)' }}>
                                                            <i className="fa-solid fa-pen-clip"></i> modified
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--primary-green-light)' }}>
                                                    {(ing.wetBatch || 0).toFixed(2)} kg
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: '600' }}>
                                                    {fedHead.toFixed(2)} kg
                                                </td>
                                                <td style={{ textAlign: 'right', color: isDiff ? 'var(--accent-gold)' : 'var(--text-muted)' }}>
                                                    {ing.plannedQtyKg != null ? `${ing.plannedQtyKg.toFixed(2)} kg` : '—'}
                                                </td>
                                                {isSuperAdmin && (
                                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                                        {ing.price ? `${ing.price.toFixed(2)} PKR` : '—'}
                                                    </td>
                                                )}
                                                {isSuperAdmin && (
                                                    <td style={{ textAlign: 'right', fontWeight: '600', color: 'var(--accent-gold)' }}>
                                                        {ing.costSingle ? `${Math.round(ing.costSingle * selectedFeedLogDetails.animalCount).toLocaleString()} PKR` : '—'}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Plan Notes & Audit Provenance */}
                        {selectedFeedLogDetails.notes && (
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', padding: '1rem 1.2rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
                                <strong style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: '0.4rem', letterSpacing: '0.5px' }}>
                                    <i className="fa-solid fa-note-sticky" style={{ color: 'var(--accent-gold)', marginRight: '4px' }}></i> Log Rationale & Diet Plan Notes:
                                </strong>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.55 }}>
                                    {selectedFeedLogDetails.notes}
                                </span>
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem' }}>
                            <button type="button" className="btn btn-secondary" onClick={() => setSelectedFeedLogDetails(null)}>Close</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
}
