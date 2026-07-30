import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';

export default function RationPlans() {
    const {
        rationPlans, saveRationPlan, duplicateRationPlan, deleteRationPlan,
        pens, savePen, deletePen, getPenRationRow,
        animals, feedIngredients, getIngredientStockPrice, addStockTrackedIngredient, staffUser
    } = useContext(FarmContext);

    const isAdmin = staffUser?.role === 'Internal Corporate Staff';

    const [activeTab, setActiveTab] = useState('plans');

    // Only ingredients backed by a real feed-stock item can be scheduled into a Ration Plan —
    // that's what lets cost figures come straight from the purchase ledger instead of a
    // manually-typed number that can drift from reality. Legacy untracked ingredients (from
    // before this existed) still display wherever they're already in use, priced at whatever
    // static value they were last saved with.
    const stockTrackedIngredients = feedIngredients.filter(i => getIngredientStockPrice(i.id) !== null);

    const [isAddIngredientFormOpen, setIsAddIngredientFormOpen] = useState(false);
    const [newStockIngredientName, setNewStockIngredientName] = useState('');

    const handleAddStockIngredient = (e) => {
        e.preventDefault();
        if (!isAdmin || !newStockIngredientName.trim()) return;
        addStockTrackedIngredient(newStockIngredientName.trim());
        setNewStockIngredientName('');
        setIsAddIngredientFormOpen(false);
    };

    // Estimated cost/day for a week's ingredient quantities, priced live off the feed stock
    // ledger's weighted-average rate — no manual entry, nothing to fall out of sync.
    const estimateWeekCost = (weekIngredients, plan = null) => {
        return Object.entries(weekIngredients || {}).reduce((sum, [id, qty]) => {
            const stockPrice = getIngredientStockPrice(id);
            const planPrice = plan?.ingredientPrices?.[id];
            const ing = feedIngredients.find(i => i.id === id || i.name?.toLowerCase() === id?.toLowerCase());
            const defaultFallbackPrice = ing?.price && ing.price > 0 ? ing.price
                : (id === 'wanda' || id.toLowerCase().includes('wanda') ? 72.47
                : id === 'silage' || id.toLowerCase().includes('silage') ? 12.5
                : id === 'straw' || id.toLowerCase().includes('straw') || id.toLowerCase().includes('toori') ? 16.0
                : id === 'chari' || id.toLowerCase().includes('chari') ? 8.0
                : 0);
            const price = (stockPrice !== null && stockPrice > 0)
                ? stockPrice
                : (planPrice !== undefined && planPrice !== null && parseFloat(planPrice) > 0)
                    ? parseFloat(planPrice)
                    : defaultFallbackPrice;
            return sum + (parseFloat(qty) || 0) * price;
        }, 0);
    };

    const estimateWeekAvgCost = (week, plan = null) => {
        if (week.scheduleMode === 'day' && week.dailyIngredients && Object.keys(week.dailyIngredients).length > 0) {
            const days = Object.values(week.dailyIngredients);
            return days.reduce((sum, dayIng) => sum + estimateWeekCost(dayIng, plan), 0) / days.length;
        }
        return estimateWeekCost(week.ingredients, plan);
    };

    // ─── PLAN EDITOR STATE ───
    const [editingId, setEditingId] = useState(null); // null = closed, 'new' = creating, else plan id
    const [formName, setFormName] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formAdgFloor, setFormAdgFloor] = useState(1.0);
    const [formIsDefault, setFormIsDefault] = useState(false);
    const [formWandaStockItemId, setFormWandaStockItemId] = useState('');
    const [formIngredientIds, setFormIngredientIds] = useState([]);
    const [formWeeks, setFormWeeks] = useState([]);
    // Day 1-7 adaptation table (percentage-based, per forage_type) — separate from the
    // weight-indexed steady-state rows above. Empty means this plan has no adaptation
    // table and falls back to the legacy per-week scheduleMode/dailyIngredients toggle.
    const [formAdaptation, setFormAdaptation] = useState([]);
    const [addIngredientChoice, setAddIngredientChoice] = useState('');
    const [saveConfirm, setSaveConfirm] = useState(false);
    const [isNewIngredientFormOpen, setIsNewIngredientFormOpen] = useState(false);
    const [newIngredientName, setNewIngredientName] = useState('');
    const [showBulkImport, setShowBulkImport] = useState(false);
    const [bulkForageType, setBulkForageType] = useState('silage');
    const [bulkBracketText, setBulkBracketText] = useState('');
    const [bulkAdaptationText, setBulkAdaptationText] = useState('');

    const DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 7];
    const FORAGE_TYPES = [{ id: 'silage', label: 'Silage' }, { id: 'chari', label: 'Chari' }];

    const blankWeek = (weekNum, ingredientIds, prevWeek) => ({
        week: weekNum,
        liveWeightMin: prevWeek ? prevWeek.liveWeightMax : '',
        liveWeightMax: '',
        targetAdg: prevWeek ? prevWeek.targetAdg : '',
        forageType: prevWeek?.forageType || 'silage',
        note: '',
        scheduleMode: 'week',
        dailyIngredients: {},
        ingredients: ingredientIds.reduce((acc, id) => {
            acc[id] = prevWeek?.ingredients?.[id] ?? 0;
            return acc;
        }, {})
    });

    const blankAdaptationSet = (forageType) => DAYS_OF_WEEK.map(day => ({
        day, forageType, wandaPct: 0, tooriKg: 0, forageKg: 0, foragePct: 100, starchCapPct: 0
    }));

    // Splits pasted tab- or comma-separated rows into arrays of trimmed string cells.
    const parsePastedRows = (text) => text.split('\n').map(l => l.trim()).filter(Boolean).map(line =>
        (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim())
    );

    // Bulk-import steady-state bracket rows pasted as: wt_min, wt_max, target_adg, then
    // one value per configured ingredient column (in the same order as the table above).
    const handleBulkImportBrackets = () => {
        const rows = parsePastedRows(bulkBracketText);
        if (rows.length === 0) return;
        const startWeek = formWeeks.length > 0 ? Math.max(...formWeeks.map(w => parseInt(w.week) || 0)) : 0;
        const newRows = rows.map((cols, i) => {
            const [wtMin, wtMax, adg, ...ingVals] = cols;
            const ingredients = formIngredientIds.reduce((acc, id, idx) => {
                acc[id] = parseFloat(ingVals[idx]) || 0;
                return acc;
            }, {});
            return {
                week: startWeek + i + 1,
                liveWeightMin: parseFloat(wtMin) || 0,
                liveWeightMax: parseFloat(wtMax) || 0,
                targetAdg: parseFloat(adg) || 0,
                forageType: bulkForageType,
                note: '',
                scheduleMode: 'week',
                dailyIngredients: {},
                ingredients
            };
        });
        setFormWeeks(prev => [...prev, ...newRows]);
        setBulkBracketText('');
    };

    // Bulk-import adaptation rows pasted as: day, wanda_pct, toori_kg, forage_val (silage kg / chari %), starch_cap_pct
    // (or 4 cols: day, wanda_pct, toori_kg, starch_cap_pct).
    const handleBulkImportAdaptation = () => {
        const rows = parsePastedRows(bulkAdaptationText);
        if (rows.length === 0) return;
        const newRows = rows.map(cols => {
            const isChari = bulkForageType === 'chari';
            if (cols.length >= 5) {
                const [day, wandaPct, tooriKg, forageVal, starchCapPct] = cols;
                return {
                    day: parseInt(day) || 0,
                    forageType: bulkForageType,
                    wandaPct: parseFloat(wandaPct) || 0,
                    tooriKg: parseFloat(tooriKg) || 0,
                    forageKg: isChari ? 0 : (parseFloat(forageVal) || 0),
                    foragePct: isChari ? (parseFloat(forageVal) || 0) : 100,
                    starchCapPct: parseFloat(starchCapPct) || 0
                };
            } else {
                const [day, wandaPct, tooriKg, starchCapPct] = cols;
                return {
                    day: parseInt(day) || 0,
                    forageType: bulkForageType,
                    wandaPct: parseFloat(wandaPct) || 0,
                    tooriKg: parseFloat(tooriKg) || 0,
                    forageKg: 0,
                    foragePct: 100,
                    starchCapPct: parseFloat(starchCapPct) || 0
                };
            }
        });
        setFormAdaptation(prev => {
            const filtered = prev.filter(r => !(r.forageType === bulkForageType && newRows.some(n => n.day === r.day)));
            return [...filtered, ...newRows];
        });
        setBulkAdaptationText('');
    };

    const handleAddAdaptationSet = (forageType) => {
        setFormAdaptation(prev => prev.some(r => r.forageType === forageType) ? prev : [...prev, ...blankAdaptationSet(forageType)]);
    };

    const handleRemoveAdaptationSet = (forageType) => {
        setFormAdaptation(prev => prev.filter(r => r.forageType !== forageType));
    };

    const handleAdaptationFieldChange = (forageType, day, field, value) => {
        setFormAdaptation(prev => prev.map(r => (r.forageType === forageType && r.day === day) ? { ...r, [field]: value } : r));
    };

    const openNewPlan = () => {
        const defaultIds = ['silage', 'maizeGrain', 'glutenFeed', 'straw', 'urea', 'minerals'].filter(id =>
            stockTrackedIngredients.some(i => i.id === id)
        );
        const defaultWanda = stockTrackedIngredients.find(i => i.isPremix || i.id === 'wanda' || i.name.toLowerCase().includes('wanda'))?.id || 'wanda';
        setEditingId('new');
        setFormName('');
        setFormDesc('');
        setFormAdgFloor(1.0);
        setFormIsDefault(false);
        setFormWandaStockItemId(defaultWanda);
        setFormIngredientIds(defaultIds.length ? defaultIds : stockTrackedIngredients.map(i => i.id));
        setFormWeeks([blankWeek(1, defaultIds, null)]);
        setFormAdaptation([]);
    };

    const openEditPlan = (plan) => {
        const idSet = new Set();
        (plan.weeks || []).forEach(w => Object.keys(w.ingredients || {}).forEach(id => idSet.add(id)));
        setEditingId(plan.id);
        setFormName(plan.name);
        setFormDesc(plan.description || '');
        setFormAdgFloor(plan.adgFloor ?? 1.0);
        setFormIsDefault(!!plan.isDefault);
        setFormWandaStockItemId(plan.wandaStockItemId || 'wanda');
        setFormIngredientIds([...idSet]);
        setFormWeeks((plan.weeks || []).map(w => ({
            ...w,
            forageType: w.forageType || 'silage',
            ingredients: { ...w.ingredients },
            scheduleMode: w.scheduleMode === 'day' ? 'day' : 'week',
            dailyIngredients: w.dailyIngredients
                ? Object.fromEntries(Object.entries(w.dailyIngredients).map(([day, ing]) => [day, { ...ing }]))
                : {}
        })));
        setFormAdaptation((plan.adaptation || []).map(r => ({ ...r })));
    };

    const closeEditor = () => {
        setEditingId(null);
        setAddIngredientChoice('');
        setShowBulkImport(false);
        setBulkBracketText('');
        setBulkAdaptationText('');
    };

    const handleAddIngredientColumn = () => {
        if (!addIngredientChoice || formIngredientIds.includes(addIngredientChoice)) return;
        setFormIngredientIds(prev => [...prev, addIngredientChoice]);
        setAddIngredientChoice('');
    };

    // Lets an admin create a brand-new stock-tracked ingredient (e.g. a specific mineral
    // blend) and add it as a schedule column in one step. It's automatically priced from
    // whatever it's purchased at in Feed Stock — nothing to type in here.
    const handleCreateAndAddIngredient = (e) => {
        e.preventDefault();
        if (!isAdmin || !newIngredientName.trim()) return;
        const newId = addStockTrackedIngredient(newIngredientName.trim());
        if (newId) setFormIngredientIds(prev => [...prev, newId]);
        setNewIngredientName('');
        setIsNewIngredientFormOpen(false);
    };

    const handleRemoveIngredientColumn = (id) => {
        setFormIngredientIds(prev => prev.filter(x => x !== id));
        setFormWeeks(prev => prev.map(w => {
            const ing = { ...w.ingredients };
            delete ing[id];
            const dailyIngredients = w.dailyIngredients
                ? Object.fromEntries(Object.entries(w.dailyIngredients).map(([day, dayIng]) => {
                    const d = { ...dayIng };
                    delete d[id];
                    return [day, d];
                }))
                : w.dailyIngredients;
            return { ...w, ingredients: ing, dailyIngredients };
        }));
    };

    const handleWeekFieldChange = (index, field, value) => {
        setFormWeeks(prev => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
    };

    const handleWeekIngredientChange = (index, ingId, value) => {
        setFormWeeks(prev => prev.map((w, i) => (i === index ? { ...w, ingredients: { ...w.ingredients, [ingId]: value } } : w)));
    };

    // Flip a week between "same ration every day" and "different ration per day" —
    // switching into day mode for the first time seeds all 7 days from the current
    // whole-week quantities so nothing is lost, just editable per day from there.
    const handleToggleWeekMode = (index) => {
        setFormWeeks(prev => prev.map((w, i) => {
            if (i !== index) return w;
            const nextMode = w.scheduleMode === 'day' ? 'week' : 'day';
            if (nextMode === 'day' && (!w.dailyIngredients || Object.keys(w.dailyIngredients).length === 0)) {
                const seeded = {};
                DAYS_OF_WEEK.forEach(day => { seeded[day] = { ...w.ingredients }; });
                return { ...w, scheduleMode: nextMode, dailyIngredients: seeded };
            }
            return { ...w, scheduleMode: nextMode };
        }));
    };

    const handleDailyIngredientChange = (weekIndex, day, ingId, value) => {
        setFormWeeks(prev => prev.map((w, i) => {
            if (i !== weekIndex) return w;
            const dailyIngredients = { ...(w.dailyIngredients || {}) };
            dailyIngredients[day] = { ...(dailyIngredients[day] || {}), [ingId]: value };
            return { ...w, dailyIngredients };
        }));
    };

    const handleAddWeek = () => {
        const last = formWeeks[formWeeks.length - 1];
        setFormWeeks(prev => [...prev, blankWeek((last?.week || 0) + 1, formIngredientIds, last)]);
    };

    const handleRemoveWeek = (index) => {
        setFormWeeks(prev => prev.filter((_, i) => i !== index));
    };

    const handleSavePlan = (e) => {
        e.preventDefault();
        if (!isAdmin || !formName.trim()) return;

        const id = editingId === 'new'
            ? `plan-${formName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`
            : editingId;

        const weeks = formWeeks.map(w => {
            const scheduleMode = w.scheduleMode === 'day' ? 'day' : 'week';
            const record = {
                week: parseInt(w.week) || 0,
                liveWeightMin: parseFloat(w.liveWeightMin) || 0,
                liveWeightMax: parseFloat(w.liveWeightMax) || 0,
                targetAdg: parseFloat(w.targetAdg) || 0,
                forageType: w.forageType || 'silage',
                note: w.note || '',
                scheduleMode,
                // In day mode this whole-week field is just a Day-1 fallback for any code
                // path that doesn't know about dailyIngredients — the real per-day figures
                // live in dailyIngredients below.
                ingredients: formIngredientIds.reduce((acc, ingId) => {
                    const source = scheduleMode === 'day' ? w.dailyIngredients?.[1] : w.ingredients;
                    acc[ingId] = parseFloat(source?.[ingId]) || 0;
                    return acc;
                }, {})
            };
            if (scheduleMode === 'day') {
                record.dailyIngredients = DAYS_OF_WEEK.reduce((dacc, day) => {
                    dacc[day] = formIngredientIds.reduce((acc, ingId) => {
                        acc[ingId] = parseFloat(w.dailyIngredients?.[day]?.[ingId]) || 0;
                        return acc;
                    }, {});
                    return dacc;
                }, {});
            }
            return record;
        });

        const adaptation = formAdaptation.map(r => ({
            day: parseInt(r.day) || 0,
            forageType: r.forageType || 'silage',
            wandaPct: parseFloat(r.wandaPct) || 0,
            tooriKg: parseFloat(r.tooriKg) || 0,
            forageKg: parseFloat(r.forageKg) || 0,
            foragePct: parseFloat(r.foragePct) || 0,
            starchCapPct: parseFloat(r.starchCapPct) || 0
        }));

        saveRationPlan({
            id,
            name: formName.trim(),
            description: formDesc.trim(),
            adgFloor: parseFloat(formAdgFloor) || 1.0,
            isDefault: formIsDefault,
            wandaStockItemId: formWandaStockItemId || 'wanda',
            weeks,
            adaptation
        });

        setSaveConfirm(true);
        setTimeout(() => setSaveConfirm(false), 2000);
        closeEditor();
    };

    const handleDeletePlan = (plan) => {
        if (!isAdmin) return;
        const affectedPens = pens.filter(p => p.rationPlanId === plan.id).map(p => p.id);
        const impactMsg = affectedPens.length > 0
            ? `\n\n${affectedPens.length} pen${affectedPens.length === 1 ? '' : 's'} currently use this plan and will be unassigned and stop being fed until reassigned: Pen ${affectedPens.join(', Pen ')}.`
            : '\n\nNo pens are currently using this plan.';
        if (window.confirm(`Delete Ration Plan "${plan.name}"?${impactMsg}\n\nThis cannot be undone.`)) {
            if (editingId === plan.id) closeEditor();
            deleteRationPlan(plan.id);
        }
    };

    // Non-blocking heads-up for gaps/overlaps in the 5kg brackets, checked separately per
    // forage_type group since silage and chari row-sets cover the same weight range but
    // are independent tables.
    const bracketWarnings = (() => {
        const groups = {};
        formWeeks.forEach(w => {
            const ft = w.forageType || 'silage';
            (groups[ft] = groups[ft] || []).push(w);
        });
        const warnings = [];
        Object.entries(groups).forEach(([ft, rows]) => {
            const sorted = [...rows].sort((a, b) => (parseFloat(a.liveWeightMin) || 0) - (parseFloat(b.liveWeightMin) || 0));
            for (let i = 1; i < sorted.length; i++) {
                const prevMax = parseFloat(sorted[i - 1].liveWeightMax) || 0;
                const curMin = parseFloat(sorted[i].liveWeightMin) || 0;
                if (curMin > prevMax) warnings.push(`${ft}: gap between ${prevMax}kg and ${curMin}kg`);
                else if (curMin < prevMax) warnings.push(`${ft}: overlap around ${curMin}–${prevMax}kg`);
            }
        });
        return warnings;
    })();

    // ─── PEN ASSIGNMENT ───
    const distinctPenNames = [...new Set([
        ...animals.filter(a => a.pen).map(a => a.pen),
        ...pens.map(p => p.id)
    ])].sort();

    // Pens with active animals but no Ration Plan attached — the TMR Calculator can't
    // feed these until a plan is assigned, so surface it here rather than silently.
    const unassignedPens = distinctPenNames.filter(penId => {
        const hasActiveAnimals = animals.some(a => a.pen === penId && a.status !== 'Sold' && a.status !== 'Deceased');
        const penConfig = pens.find(p => p.id === penId);
        return hasActiveAnimals && !penConfig?.rationPlanId;
    });

    const [newPenId, setNewPenId] = useState('');

    const handleAddPen = (e) => {
        e.preventDefault();
        if (!isAdmin) return;
        const id = newPenId.trim();
        if (!id) return;
        savePen({ id, rationPlanId: null, cycleStartDate: null, forageType: 'silage', expectedExitDate: null, notes: '' });
        setNewPenId('');
    };

    const handlePenFieldChange = (penId, field, value) => {
        if (!isAdmin) return;
        const existing = pens.find(p => p.id === penId) || { id: penId, rationPlanId: null, cycleStartDate: null, forageType: 'silage', expectedExitDate: null, notes: '' };
        savePen({ ...existing, [field]: value || null });
    };

    // Animals sorted into the same pen at very different weights muddy both the ration
    // bracket match and the batch feed sheet. Spread is measured as a % of the pen's
    // average weight (not a flat kg number) so the tolerance scales with animal size:
    // up to 15% apart is fine, 15-20% is a soft warning, above 20% is a strict warning —
    // surfaced, not hard-blocked, since reassignment happens elsewhere (Herd Registry).
    const penWeightSpreads = distinctPenNames.map(penId => {
        const penAnimals = animals.filter(a => a.pen === penId && a.status !== 'Sold' && a.status !== 'Deceased');
        if (penAnimals.length < 2) return null;
        const weights = penAnimals.map(a => parseFloat(a.currentWeight) || 0);
        const avg = weights.reduce((s, w) => s + w, 0) / weights.length;
        if (avg <= 0) return null;
        const spreadPct = ((Math.max(...weights) - Math.min(...weights)) / avg) * 100;
        return { penId, spreadPct };
    }).filter(Boolean);

    const wideSpreadPens = penWeightSpreads.filter(p => p.spreadPct > 15 && p.spreadPct <= 20);
    const strictSpreadPens = penWeightSpreads.filter(p => p.spreadPct > 20);

    const handleDeletePen = (penId) => {
        if (!isAdmin) return;
        if (window.confirm(`Remove pen "${penId}"'s ration plan assignment? Animals keep their pen label — this only clears the plan/cycle config.`)) {
            deletePen(penId);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {!isAdmin && (
                <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)', fontSize: '1.4rem' }}></i>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        Read-only view. Only Admin staff can create Ration Plans or assign them to pens.
                    </span>
                </div>
            )}

            {isAdmin && (
                <div style={{ background: 'rgba(74, 144, 217, 0.06)', border: '1px solid rgba(74, 144, 217, 0.18)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                    <i class="fa-solid fa-circle-info" style={{ color: '#4a90d9', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                        <strong style={{ color: 'var(--text-pure)' }}>How this works:</strong> Build a weekly schedule under <strong>Ration Plans</strong> (or use the pre-loaded "Baseline" plan) — only ingredients with real Feed Stock inventory can be scheduled, and every cost figure is priced live off that ingredient's current average purchase rate in <strong>Feed Pricing</strong>, so there's nothing to type in or keep in sync. Finally, switch to <strong>Pen Assignment</strong> to link a plan and cycle start date to each pen — the TMR Calculator will then auto-fill each pen's daily batch from the plan, with no cost figures cluttering that page.
                    </span>
                </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem', flexWrap: 'wrap' }}>
                <button class={`filter-btn ${activeTab === 'plans' ? 'active' : ''}`} onClick={() => setActiveTab('plans')}>
                    <i class="fa-solid fa-clipboard-list"></i> Ration Plans
                </button>
                <button class={`filter-btn ${activeTab === 'pens' ? 'active' : ''}`} onClick={() => setActiveTab('pens')}>
                    <i class="fa-solid fa-warehouse"></i> Pen Assignment
                </button>
                <button class={`filter-btn ${activeTab === 'costs' ? 'active' : ''}`} onClick={() => setActiveTab('costs')}>
                    <i class="fa-solid fa-money-bill-wave"></i> Feed Pricing
                </button>
            </div>

            {/* ═══ TAB: RATION PLANS ═══ */}
            {activeTab === 'plans' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-list-check"></i> Named Ration Plans</h3>
                            {isAdmin && (
                                <button type="button" class="btn btn-primary btn-sm" onClick={openNewPlan}>
                                    <i class="fa-solid fa-circle-plus"></i> New Plan
                                </button>
                            )}
                        </div>

                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>NAME</th>
                                        <th>WEEKS</th>
                                        <th>ADG FLOOR</th>
                                        <th>EST. COST/DAY</th>
                                        <th>PENS ASSIGNED</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '160px' }}>ACTIONS</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rationPlans.map(plan => {
                                        const weekCosts = (plan.weeks || []).map(w => estimateWeekAvgCost(w, plan));
                                        const minCost = weekCosts.length ? Math.min(...weekCosts) : null;
                                        const maxCost = weekCosts.length ? Math.max(...weekCosts) : null;
                                        return (
                                        <tr key={plan.id}>
                                            <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                                {plan.name}
                                                {plan.isDefault && <span style={{ marginLeft: '0.5rem', fontSize: '0.68rem', color: 'var(--accent-gold)' }}>DEFAULT</span>}
                                                {plan.description && <div style={{ fontWeight: '400', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{plan.description}</div>}
                                            </td>
                                            <td>{(plan.weeks || []).length}</td>
                                            <td>{plan.adgFloor} kg/day</td>
                                            <td>{minCost !== null ? (minCost === maxCost ? `${Math.round(minCost)} PKR` : `${Math.round(minCost)}–${Math.round(maxCost)} PKR`) : '—'}</td>
                                            <td>{pens.filter(p => p.rationPlanId === plan.id).length}</td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center', display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => openEditPlan(plan)} title="Edit">
                                                        <i class="fa-solid fa-pen"></i>
                                                    </button>
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => duplicateRationPlan(plan)} title="Duplicate as scenario variant">
                                                        <i class="fa-solid fa-copy"></i>
                                                    </button>
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => handleDeletePlan(plan)} title="Delete">
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                        );
                                    })}
                                    {rationPlans.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 6 : 5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No Ration Plans defined yet.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ─── PLAN EDITOR ─── */}
                    {editingId && isAdmin && (
                        <div class="glass-panel animate-scale-up" style={{ borderTop: '4px solid var(--accent-gold)' }}>
                            <div class="form-header-bar" style={{ marginBottom: '1.2rem' }}>
                                <h3 class="panel-title" style={{ margin: 0 }}>
                                    <i class="fa-solid fa-flask"></i> {editingId === 'new' ? 'New Ration Plan' : `Editing: ${formName}`}
                                </h3>
                                <button type="button" class="btn btn-secondary btn-sm" onClick={closeEditor}>
                                    <i class="fa-solid fa-xmark"></i> Close
                                </button>
                            </div>

                            <form onSubmit={handleSavePlan}>
                                <div class="form-grid-3" style={{ marginBottom: '1rem' }}>
                                    <div class="form-group">
                                        <label>Plan Name *</label>
                                        <input type="text" class="form-control" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Baseline, Scenario A" required />
                                    </div>
                                    <div class="form-group">
                                        <label>Wanda Stock Item / Premix *</label>
                                        <select class="form-control" value={formWandaStockItemId} onChange={e => setFormWandaStockItemId(e.target.value)}>
                                            <option value="">Select Wanda premix from Feed Stock…</option>
                                            {stockTrackedIngredients.map(i => (
                                                <option key={i.id} value={i.id}>{i.name} {i.isPremix ? '(Premix)' : ''}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Minimum ADG Floor (kg/day)</label>
                                        <input type="number" step="0.05" class="form-control" value={formAdgFloor} onChange={e => setFormAdgFloor(e.target.value)} />
                                        <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.3rem' }}>Safety-net floor — pens falling below this flag on the Feed &amp; Growth Report.</small>
                                    </div>
                                </div>
                                <div class="form-group" style={{ marginBottom: '1rem' }}>
                                    <label>Description</label>
                                    <input type="text" class="form-control" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Optional notes" />
                                </div>

                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--text-pure)', marginBottom: '1.2rem', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={formIsDefault} onChange={e => setFormIsDefault(e.target.checked)} style={{ width: '15px', height: '15px' }} />
                                    Mark as default plan
                                </label>

                                {/* Ingredient column management */}
                                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.6rem', background: 'rgba(0,0,0,0.15)', padding: '0.8rem', borderRadius: '8px' }}>
                                    <div class="form-group" style={{ marginBottom: 0, minWidth: '220px' }}>
                                        <label style={{ fontSize: '0.75rem' }}>Add Ingredient Column</label>
                                        <select class="form-control" value={addIngredientChoice} onChange={e => setAddIngredientChoice(e.target.value)}>
                                            <option value="">Select ingredient…</option>
                                            {stockTrackedIngredients.filter(i => !formIngredientIds.includes(i.id)).map(i => (
                                                <option key={i.id} value={i.id}>{i.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <button type="button" class="btn btn-secondary" onClick={handleAddIngredientColumn} disabled={!addIngredientChoice}>
                                        <i class="fa-solid fa-plus"></i> Add Column
                                    </button>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>or</span>
                                    <button type="button" class="btn btn-secondary" onClick={() => setIsNewIngredientFormOpen(!isNewIngredientFormOpen)}>
                                        <i class={`fa-solid ${isNewIngredientFormOpen ? 'fa-xmark' : 'fa-circle-plus'}`}></i> {isNewIngredientFormOpen ? 'Cancel' : 'New Ingredient'}
                                    </button>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>or</span>
                                    <button type="button" class="btn btn-secondary" onClick={() => setShowBulkImport(!showBulkImport)}>
                                        <i class={`fa-solid ${showBulkImport ? 'fa-xmark' : 'fa-file-import'}`}></i> {showBulkImport ? 'Cancel Bulk Import' : 'Bulk Import Rows'}
                                    </button>
                                </div>

                                {showBulkImport && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.9rem', borderRadius: '8px' }}>
                                        <div class="form-group" style={{ marginBottom: 0, maxWidth: '220px' }}>
                                            <label style={{ fontSize: '0.75rem' }}>Forage type for this paste</label>
                                            <select class="form-control" value={bulkForageType} onChange={e => setBulkForageType(e.target.value)}>
                                                {FORAGE_TYPES.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
                                            </select>
                                        </div>

                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Steady-state bracket rows</label>
                                            <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                                                One bracket per line, tab- or comma-separated: <code>wt_min, wt_max, target_adg, {formIngredientIds.map(id => feedIngredients.find(i => i.id === id)?.name || id).join(', ') || '(add ingredient columns above first)'}</code>
                                            </small>
                                            <textarea class="form-control" rows={5} style={{ fontFamily: 'monospace', fontSize: '0.78rem' }} value={bulkBracketText} onChange={e => setBulkBracketText(e.target.value)} placeholder={`120\t125\t1.15\t0.5\t5.2\t0.35\t1.1\t0.05`}></textarea>
                                            <button type="button" class="btn btn-secondary" style={{ marginTop: '0.4rem' }} onClick={handleBulkImportBrackets} disabled={!bulkBracketText.trim()}>
                                                <i class="fa-solid fa-plus"></i> Append Bracket Rows
                                            </button>
                                        </div>

                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Adaptation rows (Day 1-7)</label>
                                            <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                                                One day per line: <code>day, wanda_pct, toori_kg, {bulkForageType === 'chari' ? 'chari_pct' : 'silage_kg'}, starch_cap_pct</code> — re-pasting overwrites the matching day for {bulkForageType}.
                                            </small>
                                            <textarea class="form-control" rows={4} style={{ fontFamily: 'monospace', fontSize: '0.78rem' }} value={bulkAdaptationText} onChange={e => setBulkAdaptationText(e.target.value)} placeholder={bulkForageType === 'chari' ? `1\t30\t0.35\t100\t18\n2\t41\t0.35\t100\t22` : `1\t30\t0.35\t12.5\t18\n2\t41\t0.35\t12.5\t22`}></textarea>
                                            <button type="button" class="btn btn-secondary" style={{ marginTop: '0.4rem' }} onClick={handleBulkImportAdaptation} disabled={!bulkAdaptationText.trim()}>
                                                <i class="fa-solid fa-plus"></i> Import Adaptation Rows
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {bracketWarnings.length > 0 && (
                                    <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.6rem 0.9rem', marginBottom: '0.8rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)' }}></i> Bracket check: {bracketWarnings.join(' · ')}
                                    </div>
                                )}

                                {isNewIngredientFormOpen && (
                                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.8rem', borderRadius: '8px' }}>
                                        <div class="form-group" style={{ marginBottom: 0, minWidth: '180px' }}>
                                            <label style={{ fontSize: '0.75rem' }}>New Ingredient Name</label>
                                            <input type="text" class="form-control" placeholder="e.g. Custom Mineral Mix" value={newIngredientName} onChange={e => setNewIngredientName(e.target.value)} />
                                        </div>
                                        <button type="button" class="btn btn-primary" onClick={handleCreateAndAddIngredient} disabled={!newIngredientName.trim()}>
                                            <i class="fa-solid fa-plus"></i> Create &amp; Add Column
                                        </button>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: '100%' }}>
                                            Also registers it as a Feed Stock item — buy it from the Purchases tab and its price here updates automatically.
                                        </span>
                                    </div>
                                )}

                                {/* Weekly schedule table */}
                                <div class="table-wrapper" style={{ marginBottom: '1rem' }}>
                                    <table class="data-table" style={{ fontSize: '0.8rem' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '50px' }}>WK</th>
                                                <th style={{ whiteSpace: 'nowrap' }}>FORAGE</th>
                                                <th>LIVE WT MIN</th>
                                                <th>LIVE WT MAX</th>
                                                <th>TARGET ADG</th>
                                                {formAdaptation.length === 0 && <th style={{ whiteSpace: 'nowrap' }}>DIET</th>}
                                                {formIngredientIds.map(id => {
                                                    const ing = feedIngredients.find(i => i.id === id);
                                                    return (
                                                        <th key={id} style={{ whiteSpace: 'nowrap' }}>
                                                            {ing?.name || id}
                                                            <button type="button" onClick={() => handleRemoveIngredientColumn(id)} style={{ background: 'none', border: 'none', color: 'hsl(0,75%,60%)', cursor: 'pointer', marginLeft: '0.3rem' }} title="Remove column">
                                                                <i class="fa-solid fa-xmark"></i>
                                                            </button>
                                                        </th>
                                                    );
                                                })}
                                                <th>NOTE</th>
                                                <th style={{ whiteSpace: 'nowrap' }}>EST. COST/DAY</th>
                                                <th style={{ width: '50px' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {formWeeks.map((w, idx) => {
                                                const isDayMode = w.scheduleMode === 'day';
                                                return (
                                                <React.Fragment key={idx}>
                                                <tr>
                                                    <td>
                                                        <input type="number" class="form-control" style={{ width: '55px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.week} onChange={e => handleWeekFieldChange(idx, 'week', e.target.value)} />
                                                    </td>
                                                    <td>
                                                        <select class="form-control" style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.forageType || 'silage'} onChange={e => handleWeekFieldChange(idx, 'forageType', e.target.value)}>
                                                            {FORAGE_TYPES.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <input type="number" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.liveWeightMin} onChange={e => handleWeekFieldChange(idx, 'liveWeightMin', e.target.value)} />
                                                    </td>
                                                    <td>
                                                        <input type="number" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.liveWeightMax} onChange={e => handleWeekFieldChange(idx, 'liveWeightMax', e.target.value)} />
                                                    </td>
                                                    <td>
                                                        <input type="number" step="0.01" class="form-control" style={{ width: '75px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.targetAdg} onChange={e => handleWeekFieldChange(idx, 'targetAdg', e.target.value)} />
                                                    </td>
                                                    {formAdaptation.length === 0 && (
                                                    <td>
                                                        <button
                                                            type="button"
                                                            class="btn btn-secondary"
                                                            style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                                                            onClick={() => handleToggleWeekMode(idx)}
                                                            title={isDayMode ? 'Same ration every day of this week' : 'Set a different ration for each of the 7 days'}
                                                        >
                                                            <i class={`fa-solid ${isDayMode ? 'fa-calendar-days' : 'fa-calendar-week'}`}></i> {isDayMode ? 'Per Day' : 'Per Week'}
                                                        </button>
                                                    </td>
                                                    )}
                                                    {formIngredientIds.map(id => (
                                                        <td key={id}>
                                                            {isDayMode ? (
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Set below ↓</span>
                                                            ) : (
                                                                <input type="number" step="0.001" class="form-control" style={{ width: '75px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.ingredients[id] ?? 0} onChange={e => handleWeekIngredientChange(idx, id, e.target.value)} />
                                                            )}
                                                        </td>
                                                    ))}
                                                    <td>
                                                        <input type="text" class="form-control" style={{ minWidth: '160px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.note} onChange={e => handleWeekFieldChange(idx, 'note', e.target.value)} placeholder="e.g. adaptation week" />
                                                    </td>
                                                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                                                        {Math.round(estimateWeekAvgCost(w))} PKR{isDayMode && <span style={{ fontSize: '0.68rem' }}> avg</span>}
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button type="button" onClick={() => handleRemoveWeek(idx)} style={{ background: 'none', border: 'none', color: 'hsl(0,75%,60%)', cursor: 'pointer' }} title="Remove week">
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    </td>
                                                </tr>
                                                {isDayMode && formAdaptation.length === 0 && (
                                                    <tr>
                                                        <td colSpan={9 + formIngredientIds.length} style={{ background: 'rgba(0,0,0,0.15)', padding: '0.7rem' }}>
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                                                                <i class="fa-solid fa-calendar-days"></i> Daily diet for Week {w.week || idx + 1} — Day 1 is the pen's first day in this bracket (from its cycle start date).
                                                            </div>
                                                            <div class="table-wrapper">
                                                                <table class="data-table" style={{ fontSize: '0.78rem' }}>
                                                                    <thead>
                                                                        <tr>
                                                                            <th style={{ width: '60px' }}>DAY</th>
                                                                            {formIngredientIds.map(id => {
                                                                                const ing = feedIngredients.find(i => i.id === id);
                                                                                return <th key={id} style={{ whiteSpace: 'nowrap' }}>{ing?.name || id}</th>;
                                                                            })}
                                                                            <th style={{ whiteSpace: 'nowrap' }}>EST. COST/DAY</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {DAYS_OF_WEEK.map(day => (
                                                                            <tr key={day}>
                                                                                <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>Day {day}</td>
                                                                                {formIngredientIds.map(id => (
                                                                                    <td key={id}>
                                                                                        <input
                                                                                            type="number"
                                                                                            step="0.001"
                                                                                            class="form-control"
                                                                                            style={{ width: '75px', minHeight: '30px', height: '30px', padding: '0.15rem 0.4rem' }}
                                                                                            value={w.dailyIngredients?.[day]?.[id] ?? 0}
                                                                                            onChange={e => handleDailyIngredientChange(idx, day, id, e.target.value)}
                                                                                        />
                                                                                    </td>
                                                                                ))}
                                                                                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                                                                                    {Math.round(estimateWeekCost(w.dailyIngredients?.[day]))} PKR
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                                </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Adaptation Table (Day 1-7, percentage-based, per forage type) */}
                                <div style={{ marginBottom: '1.2rem', background: 'rgba(0,0,0,0.15)', padding: '0.9rem', borderRadius: '8px' }}>
                                    <div class="form-header-bar" style={{ marginBottom: '0.5rem' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-pure)' }}>
                                            <i class="fa-solid fa-seedling"></i> Adaptation Table (Day 1–7)
                                        </h4>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            {FORAGE_TYPES.filter(ft => !formAdaptation.some(r => r.forageType === ft.id)).map(ft => (
                                                <button key={ft.id} type="button" class="btn btn-secondary btn-sm" onClick={() => handleAddAdaptationSet(ft.id)}>
                                                    <i class="fa-solid fa-plus"></i> Add {ft.label} Adaptation
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.7rem' }}>
                                        For a pen's first 7 days on feed, this overrides the steady-state bracket above: Wanda is fed as a % of whatever the pen's <em>current</em> weight bracket's Wanda quantity is, Toori is a fixed kg, Chari is fed as a % of the bracket's Chari quantity, Silage is an explicitly imported/entered kg, and Starch Cap is reference-only. A plan with no adaptation table falls back to the legacy Per-Day toggle on the bracket table instead.
                                    </small>

                                    {formAdaptation.length === 0 && (
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                            No adaptation table configured for this plan yet.
                                        </div>
                                    )}

                                    {FORAGE_TYPES.map(ft => {
                                        const rows = formAdaptation.filter(r => r.forageType === ft.id).sort((a, b) => a.day - b.day);
                                        if (rows.length === 0) return null;
                                        return (
                                            <div key={ft.id} style={{ marginBottom: '1rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                                                    <strong style={{ fontSize: '0.8rem', color: 'var(--text-pure)' }}>{ft.label} Adaptation</strong>
                                                    <button type="button" onClick={() => handleRemoveAdaptationSet(ft.id)} style={{ background: 'none', border: 'none', color: 'hsl(0,75%,60%)', cursor: 'pointer', fontSize: '0.72rem' }}>
                                                        <i class="fa-solid fa-trash-can"></i> Remove {ft.label} set
                                                    </button>
                                                </div>
                                                <div class="table-wrapper">
                                                    <table class="data-table" style={{ fontSize: '0.8rem' }}>
                                                        <thead>
                                                            <tr>
                                                                <th style={{ width: '70px' }}>DAY</th>
                                                                <th>WANDA %</th>
                                                                <th>TOORI (KG)</th>
                                                                <th>{ft.id === 'chari' ? 'CHARI %' : 'SILAGE (KG)'}</th>
                                                                <th style={{ whiteSpace: 'nowrap' }}>STARCH CAP % (ref)</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {rows.map(r => (
                                                                <tr key={r.day}>
                                                                    <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>Day {r.day}</td>
                                                                    <td>
                                                                        <input type="number" step="0.1" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.wandaPct} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'wandaPct', e.target.value)} />
                                                                    </td>
                                                                    <td>
                                                                        <input type="number" step="0.01" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.tooriKg} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'tooriKg', e.target.value)} />
                                                                    </td>
                                                                    <td>
                                                                        {ft.id === 'chari' ? (
                                                                            <input type="number" step="0.1" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.foragePct ?? 100} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'foragePct', e.target.value)} />
                                                                        ) : (
                                                                            <input type="number" step="0.1" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.forageKg ?? 0} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'forageKg', e.target.value)} />
                                                                        )}
                                                                    </td>
                                                                    <td>
                                                                        <input type="number" step="0.1" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.starchCapPct} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'starchCapPct', e.target.value)} />
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                    <button type="button" class="btn btn-secondary" onClick={handleAddWeek}>
                                        <i class="fa-solid fa-plus"></i> Add Week
                                    </button>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        {saveConfirm && (
                                            <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                                <i class="fa-solid fa-circle-check"></i> Saved!
                                            </span>
                                        )}
                                        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save Ration Plan</button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ TAB: PEN ASSIGNMENT ═══ */}
            {activeTab === 'pens' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {unassignedPens.length > 0 && (
                        <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                            <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                                <strong style={{ color: 'var(--text-pure)' }}>{unassignedPens.length} pen{unassignedPens.length === 1 ? '' : 's'} with active animals have no Ration Plan assigned</strong> and can't be fed from the TMR Calculator: Pen {unassignedPens.join(', Pen ')}. Assign a plan below.
                            </span>
                        </div>
                    )}

                    {strictSpreadPens.length > 0 && (
                        <div style={{ background: 'rgba(220, 53, 69, 0.08)', border: '1px solid rgba(220, 53, 69, 0.3)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                            <i class="fa-solid fa-triangle-exclamation" style={{ color: 'hsl(0,75%,60%)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                                <strong style={{ color: 'hsl(0,75%,65%)' }}>{strictSpreadPens.length} pen{strictSpreadPens.length === 1 ? '' : 's'} mix animals more than 20% apart in body weight</strong> — {strictSpreadPens.map(p => `Pen ${p.penId} (${p.spreadPct.toFixed(0)}% spread)`).join(', ')}. Re-sort at intake — this is too wide for the bracket match and batch feed sheet to stay accurate.
                            </span>
                        </div>
                    )}

                    {wideSpreadPens.length > 0 && (
                        <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                            <i class="fa-solid fa-scale-unbalanced" style={{ color: 'var(--accent-gold)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                                <strong style={{ color: 'var(--text-pure)' }}>{wideSpreadPens.length} pen{wideSpreadPens.length === 1 ? '' : 's'} mix animals 15–20% apart in body weight</strong> — {wideSpreadPens.map(p => `Pen ${p.penId} (${p.spreadPct.toFixed(0)}% spread)`).join(', ')}. Consider re-sorting at intake.
                            </span>
                        </div>
                    )}

                    {isAdmin && (
                        <div class="glass-panel">
                            <h3 class="panel-title"><i class="fa-solid fa-circle-plus"></i> Register a Pen</h3>
                            <form onSubmit={handleAddPen} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div class="form-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
                                    <label>Pen Identifier</label>
                                    <input type="text" class="form-control" placeholder="e.g. A, B, 1" value={newPenId} onChange={e => setNewPenId(e.target.value)} required />
                                </div>
                                <button type="submit" class="btn btn-primary"><i class="fa-solid fa-circle-plus"></i> Add Pen</button>
                            </form>
                        </div>
                    )}

                    <div class="glass-panel">
                        <h3 class="panel-title"><i class="fa-solid fa-warehouse"></i> Pen Ration Plan Assignment</h3>
                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>PEN</th>
                                        <th>HEAD COUNT</th>
                                        <th>AVG WEIGHT</th>
                                        <th>ASSIGNED PLAN</th>
                                        <th>FORAGE</th>
                                        <th>CYCLE START DATE</th>
                                        <th>EXPECTED EXIT</th>
                                        <th>CURRENT RATION</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '70px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {distinctPenNames.map(penId => {
                                        const penConfig = pens.find(p => p.id === penId) || {};
                                        const resolved = getPenRationRow(penId);
                                        return (
                                            <tr key={penId}>
                                                <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>Pen {penId}</td>
                                                <td>{resolved ? resolved.headCount : animals.filter(a => a.pen === penId && a.status !== 'Sold' && a.status !== 'Deceased').length}</td>
                                                <td>{resolved?.avgWeight ? `${resolved.avgWeight.toFixed(1)} kg` : '—'}</td>
                                                <td>
                                                    <select
                                                        class="form-control"
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem', borderColor: unassignedPens.includes(penId) ? 'rgba(255, 193, 7, 0.5)' : undefined }}
                                                        value={penConfig.rationPlanId || ''}
                                                        onChange={e => handlePenFieldChange(penId, 'rationPlanId', e.target.value)}
                                                        disabled={!isAdmin}
                                                    >
                                                        <option value="">— No plan —</option>
                                                        {rationPlans.map(plan => (
                                                            <option key={plan.id} value={plan.id}>{plan.name}</option>
                                                        ))}
                                                    </select>
                                                    {unassignedPens.includes(penId) && (
                                                        <span style={{ fontSize: '0.68rem', color: 'var(--accent-gold)', display: 'block', marginTop: '0.2rem' }}>
                                                            <i class="fa-solid fa-triangle-exclamation"></i> Can't be fed
                                                        </span>
                                                    )}
                                                </td>
                                                <td>
                                                    <select
                                                        class="form-control"
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem' }}
                                                        value={penConfig.forageType || 'silage'}
                                                        onChange={e => handlePenFieldChange(penId, 'forageType', e.target.value)}
                                                        disabled={!isAdmin}
                                                    >
                                                        {FORAGE_TYPES.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
                                                    </select>
                                                </td>
                                                <td>
                                                    <input
                                                        type="date"
                                                        class="form-control"
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem' }}
                                                        value={penConfig.cycleStartDate || ''}
                                                        onChange={e => handlePenFieldChange(penId, 'cycleStartDate', e.target.value)}
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="date"
                                                        class="form-control"
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem' }}
                                                        value={penConfig.expectedExitDate || ''}
                                                        onChange={e => handlePenFieldChange(penId, 'expectedExitDate', e.target.value)}
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td>
                                                    {resolved ? (
                                                        <span>
                                                            {resolved.usesAdaptationTable ? (
                                                                <span style={{ color: 'var(--accent-gold)' }}>Adaptation Day {resolved.adaptationDay}</span>
                                                            ) : (
                                                                <span>
                                                                    Week {resolved.week.week}
                                                                    {resolved.usesDailyDiet && resolved.dayInWeek && <span style={{ color: 'var(--primary-green-light)' }}> · Day {resolved.dayInWeek}</span>}
                                                                    {resolved.isAdaptationWeek && <span style={{ color: 'var(--accent-gold)' }}> (adaptation)</span>}
                                                                </span>
                                                            )}
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                                {resolved.matchedByWeight ? 'Matched by weight' : 'Matched by cycle day (no weigh-in yet)'} · target {resolved.week.targetAdg} kg/day
                                                                {resolved.forageAdLib && <span> · {resolved.adLibForageId === 'chari' ? 'Chari' : 'Silage'} ad lib</span>}
                                                            </div>
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                                                    )}
                                                </td>
                                                {isAdmin && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button
                                                            type="button"
                                                            class="btn btn-secondary"
                                                            style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                            onClick={() => handleDeletePen(penId)}
                                                        >
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                    {distinctPenNames.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 9 : 8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No pens registered yet. Assign animals to a pen in Herd Registry, or add one above.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ TAB: FEED PRICING ═══ */}
            {activeTab === 'costs' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                        <i class="fa-solid fa-circle-info" style={{ color: 'var(--accent-gold)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                            Prices here are <strong>read-only</strong> — each ingredient's current weighted-average cost per kg, pulled live from its purchase history in Feed Stock. It drives every cost figure across the portal (Ration Plan estimates, TMR Calculator, Feed &amp; Growth Report). To change what an ingredient costs, record a purchase at the new rate in <strong>Feed Stock → Purchases</strong> — there's nothing to edit here.
                        </span>
                    </div>

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-money-bill-wave"></i> Feed Ingredient Pricing</h3>
                            {isAdmin && (
                                <button type="button" class="btn btn-secondary btn-sm" onClick={() => setIsAddIngredientFormOpen(!isAddIngredientFormOpen)}>
                                    <i class={`fa-solid ${isAddIngredientFormOpen ? 'fa-xmark' : 'fa-plus'}`}></i> {isAddIngredientFormOpen ? 'Cancel' : 'Add Ingredient'}
                                </button>
                            )}
                        </div>

                        {isAddIngredientFormOpen && (
                            <form onSubmit={handleAddStockIngredient} style={{ background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr auto', gap: '0.8rem', alignItems: 'flex-end' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Name</label>
                                        <input type="text" class="form-control" placeholder="e.g. Molasses" value={newStockIngredientName} onChange={e => setNewStockIngredientName(e.target.value)} required />
                                    </div>
                                    <button type="submit" class="btn btn-primary">Add</button>
                                </div>
                                <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.5rem' }}>
                                    Registers it as a Feed Stock item too — its price appears here as soon as you record a purchase.
                                </small>
                            </form>
                        )}

                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>INGREDIENT</th>
                                        <th>CURRENT AVG PRICE (PKR/KG)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {feedIngredients.map(ing => {
                                        const stockPrice = getIngredientStockPrice(ing.id);
                                        return (
                                            <tr key={ing.id}>
                                                <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{ing.name}</td>
                                                <td>
                                                    {stockPrice !== null
                                                        ? `${stockPrice.toFixed(2)} PKR`
                                                        : <span style={{ color: 'var(--text-muted)' }} title="No matching Feed Stock item — legacy price used">{(ing.price || 0).toFixed(2)} PKR (not stock-tracked)</span>
                                                    }
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
