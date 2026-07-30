import React, { useContext, useState, useEffect } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

export default function TMRCalculator() {
    const {
        feedIngredients, animals, staffUser, feedLogs, logFeed, deleteFeedLog,
        pens, getPenRationRow, getPenWeightFlags, getIngredientStockPrice, getIngredientStockQty
    } = useContext(FarmContext);
    const isAdmin = staffUser?.role === 'Internal Corporate Staff';

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
    const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0]);

    // Plan-driven lookup: resolves the pen's assigned Ration Plan + current week
    // by matching its animals' average actual weight against each week's live-weight
    // bracket (scaled by head count for the batch) for the selected logDate.
    const resolvedPlanRow = selectedTMRPen !== 'all' ? getPenRationRow(selectedTMRPen, logDate) : null;
    // A v2 pen with no matching bracket comes back as { blocked: true } rather than
    // null (spec: never silently fall back to a nearby bracket) — that's a hard stop,
    // not a plan-driven state, so it must never reach the ingredient-math below.
    const isBlocked = !!resolvedPlanRow?.blocked;
    const isPlanDriven = !!resolvedPlanRow && !isBlocked;

    // Early-warning: animals whose most recent weigh-in diverged >5% from what growth
    // should have predicted since their prior weigh-in — illness, underfeeding, or a bad
    // record. Purely informational here, doesn't affect the batch calculation.
    const penWeightFlags = selectedTMRPen !== 'all' ? getPenWeightFlags(selectedTMRPen) : [];

    // Per-ingredient overrides for today's plan-driven batch only — never written back
    // to the Ration Plan itself, so the schedule stays intact for every other pen/day.
    const [planOverrides, setPlanOverrides] = useState({});
    useEffect(() => {
        setPlanOverrides({});
    }, [selectedTMRPen, logDate, resolvedPlanRow?.plan?.id, resolvedPlanRow?.week?.week]);

    // 1. LOCAL UI STATE
    const [animalsCount, setAnimalsCount] = useState(activeHerdCount || 1);

    const [isTractorMode, setIsTractorMode] = useState(false);

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
    const tractorPenResolutions = tractorSelectedPens
        .map(penId => ({ penId, resolved: getPenRationRow(penId, logDate) }))
        .filter(r => r.resolved && !r.resolved.blocked);

    const tractorPhaseOf = (resolved) => resolved.system === 'v2' ? resolved.phase : (resolved.usesAdaptationTable ? 'ADAPTATION' : 'STEADY');
    const tractorForageTypes = [...new Set(tractorPenResolutions.map(r => r.resolved.forageType))];
    const tractorPhases = [...new Set(tractorPenResolutions.map(r => tractorPhaseOf(r.resolved)))];
    const tractorMismatch = tractorForageTypes.length > 1 || tractorPhases.length > 1;
    const tractorMismatchedPens = tractorMismatch
        ? tractorPenResolutions.map(r => `Pen ${r.penId} (${r.resolved.forageType}, ${tractorPhaseOf(r.resolved)})`)
        : [];

    // Aggregate qty×headCount per ingredient across all resolved pens, once a
    // mismatch is either absent or explicitly confirmed by the user.
    const tractorAggregateIngredients = (() => {
        if (tractorPenResolutions.length === 0) return [];
        if (tractorMismatch && !tractorConfirmedMismatch) return [];
        const totals = {};
        tractorPenResolutions.forEach(({ resolved }) => {
            const headCount = resolved.headCount || 0;
            Object.entries(resolved.week.ingredients || {}).forEach(([id, qtyPerHead]) => {
                const ing = feedIngredients.find(i => i.id === id) || { id, name: id.charAt(0).toUpperCase() + id.slice(1) };
                const stockPrice = getIngredientStockPrice(id);
                const price = (stockPrice !== null && stockPrice > 0) ? stockPrice : (ing.price || 0);
                const batchQty = (parseFloat(qtyPerHead) || 0) * headCount;
                if (!totals[id]) totals[id] = { id, name: ing.name, wetBatch: 0, cost: 0 };
                totals[id].wetBatch += batchQty;
                totals[id].cost += batchQty * price;
            });
        });
        return Object.values(totals);
    })();

    const tractorTotalHeadCount = tractorPenResolutions.reduce((sum, r) => sum + (r.resolved.headCount || 0), 0);
    const tractorTotalBatchWeight = tractorAggregateIngredients.reduce((sum, i) => sum + i.wetBatch, 0);
    const tractorTotalCost = tractorAggregateIngredients.reduce((sum, i) => sum + i.cost, 0);

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

    // 2. QUANTITY MATH — plan-driven only. Ingredient quantities are as-fed kg/head/day
    // straight from the Ration Plan's weekly schedule (no moisture/DM conversion — small
    // quantities like urea or minerals matter, so nothing here is rounded to whole kg;
    // decimals are preserved all the way through to the batch table and feed log).
    // Plan-driven quantities are already as-fed kg/head/day straight from the Ration
    // Plan's weekly schedule — just scale by head count, keeping full decimal precision.
    // Price is always the live weighted-average rate from the Feed Stock ledger — nothing
    // is typed in per plan. Legacy ingredients with no matching stock item fall back to
    // whatever static price they were last saved with.
    const planIngredientRows = isPlanDriven
        ? Object.entries(resolvedPlanRow.week.ingredients).map(([id, qty]) => {
            const ing = feedIngredients.find(i => i.id === id || i.name.toLowerCase() === id.toLowerCase() || (id === 'wanda' && i.name.toLowerCase().includes('wanda')))
                || { id, name: id.charAt(0).toUpperCase() + id.slice(1), price: 0 };
            const stockPrice = getIngredientStockPrice(id);
            const price = (stockPrice !== null && stockPrice > 0) ? stockPrice : (ing.price || 0);
            const qtyPerHead = planOverrides[id] !== undefined ? planOverrides[id] : qty;
            return {
                id,
                name: ing.name,
                price,
                planQty: qty,
                qtyPerHead,
                isOverridden: planOverrides[id] !== undefined,
                wetBatch: qtyPerHead * animalsCount,
                costSingle: qtyPerHead * price
            };
        })
        : [];

    // Display array feeding the batch table / tractor mode / feed log below.
    const displayIngredients = isPlanDriven
        ? planIngredientRows.map(r => ({
            id: r.id,
            name: r.name,
            dmTarget: r.qtyPerHead,
            wetSingle: r.qtyPerHead,
            wetBatch: r.wetBatch,
            costSingle: r.costSingle,
            price: r.price
        }))
        : [];

    const totalDM = displayIngredients.reduce((sum, ing) => sum + ing.dmTarget, 0);
    const totalBatchWeight = displayIngredients.reduce((sum, ing) => sum + ing.wetBatch, 0);
    const totalCostSingle = displayIngredients.reduce((sum, ing) => sum + ing.costSingle, 0);

    const handlePlanOverride = (id, value) => {
        setPlanOverrides(prev => ({ ...prev, [id]: parseFloat(value) || 0 }));
    };

    const handleResetOverride = (id) => {
        setPlanOverrides(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
    };

    // Snapshots the currently calculated batch (for the selected pen and date) into the
    // immutable feed log — this records what was actually fed, distinct from the Ration
    // Plan schedule itself, so later schedule edits never alter this day's history.
    const handleLogFeed = () => {
        if (!isPlanDriven) return;
        const pen = selectedTMRPen;
        const isV2 = resolvedPlanRow.system === 'v2';
        const stageNote = isV2
            ? `${resolvedPlanRow.plan.name} v${resolvedPlanRow.plan.version}, bracket ${resolvedPlanRow.bracketMin}-${resolvedPlanRow.bracketMax}kg${resolvedPlanRow.phase === 'ADAPTATION' ? `, Adaptation Day ${resolvedPlanRow.dayNo}` : ', Steady State'}`
            : (resolvedPlanRow.usesAdaptationTable
                ? `Adaptation Day ${resolvedPlanRow.adaptationDay}`
                : `Week ${resolvedPlanRow.week.week}${resolvedPlanRow.usesDailyDiet && resolvedPlanRow.dayInWeek ? `, Day ${resolvedPlanRow.dayInWeek}` : ''}`);
        const notes = `Auto-filled from ${isV2 ? stageNote : `${resolvedPlanRow.plan.name}, ${stageNote}`}${resolvedPlanRow.matchedByWeight ? '' : ' (matched by cycle day)'}`;
        // Overrides applied on this page are logged alongside the plan's originally
        // resolved quantity (plannedQtyKg) so the feed log preserves provenance — what
        // the plan said to feed vs. what was actually fed, per ingredient.
        const plannedById = isPlanDriven
            ? Object.fromEntries(planIngredientRows.map(r => [r.id, r.planQty]))
            : {};
        logFeed({
            date: logDate,
            pen,
            animalCount: animalsCount,
            ingredients: displayIngredients.map(ing => ({
                id: ing.id,
                name: ing.name,
                dmTarget: ing.dmTarget,
                price: ing.price,
                wetSingle: ing.wetSingle,
                wetBatch: ing.wetBatch,
                costSingle: ing.costSingle,
                plannedQtyKg: plannedById[ing.id] ?? ing.dmTarget
            })),
            totalDmKg: totalDM,
            totalBatchKg: totalBatchWeight,
            totalCost: totalCostSingle * animalsCount,
            costPerAnimal: totalCostSingle,
            createdBy: staffUser?.email || staffUser?.name || null,
            notes
        });
        setLogSaved(true);
        setTimeout(() => setLogSaved(false), 2500);
    };

    const recentFeedLogs = [...feedLogs].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

            {/* Top Grid: Ingredients list and Batch Recipe Output */}
            <div class="tmr-grid">

                {/* Left: the plan-driven ration (auto-filled from the pen's assigned Ration Plan),
                    or an empty-state prompt when no plan is attached — rations are never set here */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

                    {isBlocked ? (
                        <div class="glass-panel" style={{ borderTop: '4px solid hsl(0,75%,55%)', textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                            <i class="fa-solid fa-ban" style={{ fontSize: '2rem', color: 'hsl(0,75%,60%)', marginBottom: '1rem' }}></i>
                            <h3 class="panel-title" style={{ justifyContent: 'center', marginBottom: '0.5rem', color: 'hsl(0,75%,65%)' }}>
                                Feeding Blocked — Pen {selectedTMRPen}
                            </h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto' }}>
                                {resolvedPlanRow.error}
                            </p>
                            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', maxWidth: '480px', margin: '0.8rem auto 0', fontStyle: 'italic' }}>
                                No ration is calculated or fed until an admin fixes the plan for this pen — the system never falls back to a nearby bracket.
                            </p>
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
                                        {resolvedPlanRow.forageType === 'chari' ? 'CHARI' : 'SILAGE'}
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
                                                    <input
                                                        type="number"
                                                        step="0.001"
                                                        className="form-control"
                                                        style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '110px', color: row.isOverridden ? 'var(--accent-gold)' : 'inherit' }}
                                                        value={row.qtyPerHead}
                                                        onChange={(e) => handlePlanOverride(row.id, e.target.value)}
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {row.isOverridden ? (
                                                        <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => handleResetOverride(row.id)} title="Reset to plan quantity">
                                                            <i class="fa-solid fa-rotate-left"></i>
                                                        </button>
                                                    ) : (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.8rem', marginBottom: 0 }}>
                                <i class="fa-solid fa-circle-info"></i> Overrides here apply to today's logged feeding only — the Ration Plan schedule itself is unchanged. Manage the schedule from Ration Plans.
                            </p>
                        </div>
                    ) : (
                        /* Rations are only ever set by a Ration Plan (under Ration Plans) — this
                           page never allows a manual/global recipe. Nothing to feed or calculate
                           until a plan is assigned to the selected pen. */
                        <div class="glass-panel" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                            <i class="fa-solid fa-clipboard-list" style={{ fontSize: '2rem', color: 'var(--text-muted)', marginBottom: '1rem' }}></i>
                            <h3 class="panel-title" style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>
                                {selectedTMRPen === 'all' ? 'Select a Pen' : `No Ration Plan Assigned — Pen ${selectedTMRPen}`}
                            </h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '440px', margin: '0 auto' }}>
                                {selectedTMRPen === 'all'
                                    ? 'Choose a pen above to feed. Every ration comes from a Ration Plan — nothing is fed without one.'
                                    : 'This pen has no Ration Plan attached, so there\'s nothing to feed or calculate here. Assign one under Ration Plans → Pen Assignment.'}
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
                                <button type="button" class="btn btn-secondary" style={{ minHeight: '44px' }} onClick={openTractorMode} disabled={tractorEligiblePens.length === 0}>
                                    <i class="fa-solid fa-tractor"></i> Tractor Mode
                                </button>
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
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {displayIngredients.map(ing => (
                                                    <tr key={ing.id}>
                                                        <td><strong>{ing.name}</strong></td>
                                                        <td>{ing.dmTarget.toFixed(2)} kg</td>
                                                        <td>{ing.wetSingle.toFixed(2)} kg</td>
                                                        <td><strong style={{ color: 'var(--primary-green-light)', fontSize: '1.05rem' }}>{ing.wetBatch.toFixed(2)} kg</strong></td>
                                                    </tr>
                                                ))}
                                                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                                    <td><strong>Total Feed Mix</strong></td>
                                                    <td><strong>{totalDM.toFixed(2)} kg</strong></td>
                                                    <td><strong>{displayIngredients.reduce((sum, ing) => sum + ing.wetSingle, 0).toFixed(2)} kg</strong></td>
                                                    <td><strong style={{ color: 'var(--accent-gold)', fontSize: '1.15rem' }}>{totalBatchWeight.toFixed(2)} kg</strong></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Batch Weight Summary — cost figures live in Feed & Growth Report, not here */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.2rem', alignItems: 'center' }}>
                                        <div>
                                            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total batch to mix</span>
                                            <strong style={{ fontSize: '1.4rem', color: 'var(--accent-gold)', fontFamily: 'var(--font-heading)' }}>
                                                {totalBatchWeight.toFixed(2)} kg
                                            </strong>
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
                                            max={new Date().toISOString().split('T')[0]}
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

                            {tractorAggregateIngredients.length > 0 && (
                                <>
                                    <p class="batch-sub">Total batch for {tractorTotalHeadCount} calves across {tractorPenResolutions.length} pen{tractorPenResolutions.length === 1 ? '' : 's'}{tractorMismatch ? ' (mismatched forage/phase — confirmed)' : ''}</p>
                                    <div class="tractor-mix-list">
                                        {tractorAggregateIngredients.map((ing, idx) => (
                                            <div class="tractor-mix-item" key={ing.id} style={ing.id === 'minerals' ? { borderLeftColor: 'var(--accent-gold)' } : {}}>
                                                <span>{idx + 1}. WET {ing.name.toUpperCase()}</span>
                                                <strong>{(Math.round(ing.wetBatch * 10) / 10).toFixed(1)} KG</strong>
                                            </div>
                                        ))}
                                    </div>

                                    <p style={{ marginTop: '2rem', fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                        <i class="fa-solid fa-circle-info"></i> Weigh ingredients sequentially inside the mixer wagon scales. Total batch target: {tractorTotalBatchWeight.toFixed(2)} kg · Est. cost: {Math.round(tractorTotalCost)} PKR.
                                    </p>
                                </>
                            )}
                        </div>
                    )}

                </div>

            </div>

            {/* Feed History — what was actually fed each logged day, immutable regardless
                of later recipe edits. Full historical view lives in Feed & Growth Report. */}
            {recentFeedLogs.length > 0 && (
                <div class="glass-panel">
                    <h3 class="panel-title"><i class="fa-solid fa-clock-rotate-left"></i> Recent Feed History</h3>
                    <div class="table-wrapper">
                        <table class="data-table" style={{ fontSize: '0.85rem' }}>
                            <thead>
                                <tr>
                                    <th>DATE</th>
                                    <th>PEN</th>
                                    <th>ANIMALS</th>
                                    <th>TOTAL BATCH</th>
                                    {isAdmin && <th style={{ width: '60px', textAlign: 'center' }}>REMOVE</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {recentFeedLogs.map(log => (
                                    <tr key={`${log.date}__${log.pen}`}>
                                        <td>{formatDate(log.date)}</td>
                                        <td>{log.pen === 'ALL' ? 'All Pens' : `Pen ${log.pen}`}</td>
                                        <td>{log.animalCount}</td>
                                        <td><strong style={{ color: 'var(--accent-gold)' }}>{(log.totalBatchKg || 0).toFixed(2)} kg</strong></td>
                                        {isAdmin && (
                                            <td style={{ textAlign: 'center' }}>
                                                <button
                                                    type="button"
                                                    class="btn btn-secondary"
                                                    style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                    onClick={() => {
                                                        const penLabel = log.pen === 'ALL' ? 'All Pens' : `Pen ${log.pen}`;
                                                        if (window.confirm(`Undo this feed log?\n\n${formatDate(log.date)} · ${penLabel} · ${(log.totalBatchKg || 0).toFixed(2)} kg\n\nThis also reverses the matching entry in the Feed Stock ledger and the Feed & Growth Report. This cannot be undone.`)) {
                                                            deleteFeedLog(log.date, log.pen);
                                                        }
                                                    }}
                                                    title="Undo this feed log"
                                                >
                                                    <i class="fa-solid fa-trash-can"></i>
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

        </div>
    );
}
