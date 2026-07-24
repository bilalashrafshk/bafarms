import React, { useContext, useState, useEffect } from 'react';
import { FarmContext } from '../context/FarmContext';

export default function TMRCalculator() {
    const {
        feedIngredients, updateFeedIngredients, animals, staffUser, feedLogs, logFeed, deleteFeedLog,
        pens, rationPlans, getPenRationRow
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

    // Plan-driven lookup: resolves the pen's assigned Ration Plan + current week
    // by matching its animals' average actual weight against each week's live-weight
    // bracket (scaled by head count for the batch) — see FarmContext.getPenRationRow.
    const resolvedPlanRow = selectedTMRPen !== 'all' ? getPenRationRow(selectedTMRPen) : null;
    const isPlanDriven = !!resolvedPlanRow;

    // Per-ingredient overrides for today's plan-driven batch only — never written back
    // to the Ration Plan itself, so the schedule stays intact for every other pen/day.
    const [planOverrides, setPlanOverrides] = useState({});
    useEffect(() => {
        setPlanOverrides({});
    }, [selectedTMRPen, resolvedPlanRow?.plan?.id, resolvedPlanRow?.week?.week]);

    // 1. LOCAL UI STATE
    const [animalsCount, setAnimalsCount] = useState(activeHerdCount || 1);
    const [ingredients, setIngredients] = useState([]);

    const [isTractorMode, setIsTractorMode] = useState(false);
    const [isSaved, setIsSaved] = useState(false);

    // Daily feed-log state (snapshotting what was actually fed — separate from the
    // live recipe definition above, so recipe edits never rewrite past days)
    const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0]);
    const [logSaved, setLogSaved] = useState(false);

    // Procurement cost is set per-ingredient in Ration Plans → Ingredient Costs, not
    // here. Ingredient quantities on this page are as-fed kg/head/day directly (no
    // moisture/DM conversion); price is intentionally not shown on this page.

    // Sync state from context when ready
    useEffect(() => {
        if (feedIngredients) {
            setIngredients(feedIngredients);
        }
    }, [feedIngredients]);

    // Sync animalsCount when herd data loads/changes or pen selection changes
    useEffect(() => {
        if (selectedTMRPen === 'all') {
            if (activeHerdCount > 0) setAnimalsCount(activeHerdCount);
        } else {
            const penCount = animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.pen === selectedTMRPen).length;
            setAnimalsCount(Math.max(1, penCount));
        }
    }, [activeHerdCount, selectedTMRPen, animals]);

    // 2. QUANTITY MATH — manual/global recipe mode. Ingredient quantities are as-fed
    // kg/head/day directly (no moisture/DM conversion — small quantities like urea or
    // minerals matter, so nothing here is rounded to whole kg; decimals are preserved
    // all the way through to the batch table and feed log).
    const calculatedIngredients = ingredients.map(ing => {
        const wetSingle = ing.dmTarget;
        const wetBatch = wetSingle * animalsCount;
        const costSingle = wetSingle * ing.price;

        return {
            ...ing,
            wetSingle,
            wetBatch,
            costSingle
        };
    });

    // Plan-driven quantities are already as-fed kg/head/day straight from the Ration
    // Plan's weekly schedule — just scale by head count, keeping full decimal precision.
    const planIngredientRows = isPlanDriven
        ? Object.entries(resolvedPlanRow.week.ingredients).map(([id, qty]) => {
            const ing = feedIngredients.find(i => i.id === id) || { id, name: id, price: 0 };
            const qtyPerHead = planOverrides[id] !== undefined ? planOverrides[id] : qty;
            return {
                id,
                name: ing.name,
                price: ing.price,
                planQty: qty,
                qtyPerHead,
                isOverridden: planOverrides[id] !== undefined,
                wetBatch: qtyPerHead * animalsCount,
                costSingle: qtyPerHead * ing.price
            };
        })
        : [];

    // Unified display array so the batch table / tractor mode / cost summary below
    // work identically whether the pen is plan-driven or on the manual global recipe.
    const displayIngredients = isPlanDriven
        ? planIngredientRows.map(r => ({
            id: r.id,
            name: r.name,
            dmTarget: r.qtyPerHead,
            wetSingle: r.qtyPerHead,
            wetBatch: r.wetBatch,
            costSingle: r.costSingle
        }))
        : calculatedIngredients;

    const totalDM = displayIngredients.reduce((sum, ing) => sum + ing.dmTarget, 0);
    const totalBatchWeight = displayIngredients.reduce((sum, ing) => sum + ing.wetBatch, 0);
    const totalCostSingle = displayIngredients.reduce((sum, ing) => sum + ing.costSingle, 0);

    // Updaters
    const updateLocalIngredient = (id, field, value) => {
        setIngredients(prev => prev.map(ing => {
            if (ing.id === id) {
                return { ...ing, [field]: value };
            }
            return ing;
        }));
    };

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

    const handleSaveAllIngredients = (e) => {
        if (e) e.preventDefault();
        updateFeedIngredients(ingredients);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2500);
    };

    // Snapshots the currently calculated batch (for the selected pen and date) into the
    // immutable feed log — this records what was actually fed, distinct from the live
    // recipe definition, so later recipe edits never alter this day's history.
    const handleLogFeed = () => {
        const pen = selectedTMRPen === 'all' ? 'ALL' : selectedTMRPen;
        const notes = isPlanDriven
            ? `Auto-filled from ${resolvedPlanRow.plan.name}, Week ${resolvedPlanRow.week.week}${resolvedPlanRow.matchedByWeight ? '' : ' (matched by cycle day)'}`
            : '';
        logFeed({
            date: logDate,
            pen,
            animalCount: animalsCount,
            ingredients: displayIngredients.map(ing => ({
                id: ing.id,
                name: ing.name,
                dmTarget: ing.dmTarget,
                price: feedIngredients.find(i => i.id === ing.id)?.price ?? 0,
                wetSingle: ing.wetSingle,
                wetBatch: ing.wetBatch,
                costSingle: ing.costSingle
            })),
            totalDmKg: totalDM,
            totalBatchKg: totalBatchWeight,
            totalCost: totalCostSingle * animalsCount,
            costPerAnimal: totalCostSingle,
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

                {/* Left: either the plan-driven ration (auto-filled) or the manual global recipe editor */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

                    {isPlanDriven ? (
                        <div class="glass-panel" style={{ borderTop: '4px solid var(--primary-green-light)' }}>
                            <h3 class="panel-title" style={{ marginBottom: '0.6rem' }}><i class="fa-solid fa-clipboard-check"></i> Plan-Driven Ration — Pen {selectedTMRPen}</h3>
                            <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <div style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                    {resolvedPlanRow.plan.name} — Week {resolvedPlanRow.week.week}
                                    {resolvedPlanRow.isAdaptationWeek && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-gold)', fontSize: '0.75rem' }}>ADAPTATION WEEK</span>}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                    {resolvedPlanRow.matchedByWeight
                                        ? `Matched by average weight (${resolvedPlanRow.avgWeight.toFixed(1)} kg across ${resolvedPlanRow.headCount} head)`
                                        : 'No weigh-in yet for this pen — matched by cycle day instead of actual weight'}
                                    {' · '}Target ADG {resolvedPlanRow.week.targetAdg} kg/day
                                </div>
                                {resolvedPlanRow.week.note && (
                                    <div style={{ fontSize: '0.76rem', color: 'var(--accent-gold)', marginTop: '0.3rem', fontStyle: 'italic' }}>
                                        <i class="fa-solid fa-circle-info"></i> {resolvedPlanRow.week.note}
                                    </div>
                                )}
                            </div>

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
                    <>
                    {/* Unified Formulation Card (manual / global recipe mode) — quantities only.
                        Ingredient prices and moisture % are configured under
                        Ration Plans → Ingredient Costs, not here. */}
                    <div class="glass-panel">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-flask"></i> Ingredients & Recipe</h3>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                No plan assigned to this pen — using the manual fallback recipe
                            </span>
                        </div>

                        {/* Ingredients Table (Desktop) */}
                        <form onSubmit={handleSaveAllIngredients}>
                            <div className="table-wrapper" style={{ marginBottom: '1.2rem' }}>
                                <table className="data-table" style={{ fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr>
                                            <th>INGREDIENT</th>
                                            <th>DM TARGET (KG/HEAD/DAY)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ingredients.map(ing => (
                                            <tr key={ing.id}>
                                                <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{ing.name}</td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className="form-control"
                                                        style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '90px' }}
                                                        value={ing.dmTarget}
                                                        onChange={(e) => updateLocalIngredient(ing.id, 'dmTarget', parseFloat(e.target.value) || 0)}
                                                        required
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Card Inputs */}
                            <div className="mobile-card-list mobile-only" style={{ marginBottom: '1.2rem' }}>
                                {ingredients.map(ing => (
                                    <div key={ing.id} className="mobile-item-card">
                                        <div className="mobile-item-card-header">
                                            <span className="mobile-item-card-title">{ing.name}</span>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.72rem' }}>DM Target (kg/head/day)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="form-control"
                                                value={ing.dmTarget}
                                                onChange={(e) => updateLocalIngredient(ing.id, 'dmTarget', parseFloat(e.target.value) || 0)}
                                                disabled={!isAdmin}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {isAdmin ? (
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <button type="submit" className="btn btn-secondary" style={{ width: '100%', minHeight: '44px' }}><i className="fa-solid fa-floppy-disk"></i> Save Formulation</button>
                                    {isSaved && (
                                        <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                            <i className="fa-solid fa-circle-check"></i> Saved!
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span style={{ fontSize: '0.85rem', color: 'var(--accent-gold)', fontWeight: '600' }}>
                                    <i className="fa-solid fa-circle-info"></i> Recipe viewing mode.
                                </span>
                            )}
                        </form>
                    </div>
                    </>
                    )}

                </div>

                {/* Right: Outputs, Batch Scale & Tractor mixer mode */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

                    {!isTractorMode ? (
                        <div class="glass-panel" style={{ borderTop: '4px solid var(--accent-gold)' }}>
                            <div class="form-header-bar" style={{ marginBottom: '1.2rem', gap: '1rem', flexWrap: 'wrap' }}>
                                <h3 class="panel-title" style={{ marginBottom: '0' }}><i class="fa-solid fa-scale-balanced"></i> Batch Recipe</h3>
                                <button type="button" class="btn btn-secondary" style={{ minHeight: '44px' }} onClick={() => setIsTractorMode(true)}>
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
                                                    title={hasPlan ? 'Has a Ration Plan assigned — selecting this pen auto-fills the batch' : 'No Ration Plan assigned — manual recipe only'}
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

                            <div class="table-wrapper" style={{ marginBottom: '1.2rem' }}>
                                <table class="data-table">
                                    <thead>
                                        <tr>
                                            <th>FEED INGREDIENT</th>
                                            <th>{isPlanDriven ? 'QTY / HEAD' : 'DM TARGET'}</th>
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
                                it cost, independent of any later recipe edits. */}
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
                                    <i class="fa-solid fa-clipboard-check"></i> Log This Feeding ({selectedTMRPen === 'all' ? 'All Pens' : `Pen ${selectedTMRPen}`})
                                </button>
                                {logSaved && (
                                    <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                        <i class="fa-solid fa-circle-check"></i> Feed logged for {logDate}.
                                    </span>
                                )}
                            </div>
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
                            <p class="batch-sub">Total batch scaled up for {animalsCount} calves</p>

                            <div class="tractor-mix-list">
                                {displayIngredients.map((ing, idx) => (
                                    <div class="tractor-mix-item" key={ing.id} style={ing.id === 'minerals' ? { borderLeftColor: 'var(--accent-gold)' } : {}}>
                                        <span>{idx + 1}. WET {ing.name.toUpperCase()}</span>
                                        <strong>{ing.wetBatch.toFixed(2)} KG</strong>
                                    </div>
                                ))}
                            </div>

                            <p style={{ marginTop: '2rem', fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                <i class="fa-solid fa-circle-info"></i> Weigh ingredients sequentially inside the mixer wagon scales. Total batch target: {totalBatchWeight.toFixed(2)} kg.
                            </p>
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
                                        <td>{log.date}</td>
                                        <td>{log.pen === 'ALL' ? 'All Pens' : `Pen ${log.pen}`}</td>
                                        <td>{log.animalCount}</td>
                                        <td><strong style={{ color: 'var(--accent-gold)' }}>{(log.totalBatchKg || 0).toFixed(2)} kg</strong></td>
                                        {isAdmin && (
                                            <td style={{ textAlign: 'center' }}>
                                                <button
                                                    type="button"
                                                    class="btn btn-secondary"
                                                    style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                    onClick={() => deleteFeedLog(log.date, log.pen)}
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
