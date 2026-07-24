import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';

export default function RationPlans() {
    const {
        rationPlans, saveRationPlan, duplicateRationPlan, deleteRationPlan,
        pens, savePen, deletePen, getPenRationRow,
        animals, feedIngredients, updateFeedIngredients, staffUser
    } = useContext(FarmContext);

    const isAdmin = staffUser?.role === 'Internal Corporate Staff';

    const [activeTab, setActiveTab] = useState('plans');

    // ─── INGREDIENT COST EDITOR STATE (procurement settings — kept off the TMR page) ───
    const [costDraft, setCostDraft] = useState(() => feedIngredients.map(i => ({ ...i })));
    const [costSaved, setCostSaved] = useState(false);
    const [isAddCostFormOpen, setIsAddCostFormOpen] = useState(false);
    const [newCostName, setNewCostName] = useState('');
    const [newCostPrice, setNewCostPrice] = useState('');

    React.useEffect(() => {
        setCostDraft(feedIngredients.map(i => ({ ...i })));
    }, [feedIngredients]);

    const handleCostFieldChange = (id, field, value) => {
        setCostDraft(prev => prev.map(i => (i.id === id ? { ...i, [field]: value } : i)));
    };

    const handleSaveCosts = (e) => {
        e.preventDefault();
        if (!isAdmin) return;
        updateFeedIngredients(costDraft.map(i => ({
            ...i,
            price: parseFloat(i.price) || 0
        })));
        setCostSaved(true);
        setTimeout(() => setCostSaved(false), 2000);
    };

    const handleAddCostIngredient = (e) => {
        e.preventDefault();
        if (!isAdmin || !newCostName.trim() || !newCostPrice) return;
        const newIng = {
            id: 'custom_' + Date.now(),
            name: newCostName.trim(),
            dmTarget: 0,
            price: parseFloat(newCostPrice) || 0,
            isDefault: false
        };
        updateFeedIngredients([...feedIngredients, newIng]);
        setNewCostName('');
        setNewCostPrice('');
        setIsAddCostFormOpen(false);
    };

    const handleDeleteCostIngredient = (id) => {
        if (!isAdmin) return;
        if (window.confirm('Remove this ingredient from the master list? It will disappear from the TMR recipe and any Ration Plans referencing it.')) {
            updateFeedIngredients(feedIngredients.filter(i => i.id !== id));
        }
    };

    // Estimated cost/day for a week's ingredient quantities, priced at today's ingredient costs.
    const estimateWeekCost = (weekIngredients) => {
        return Object.entries(weekIngredients || {}).reduce((sum, [id, qty]) => {
            const ing = feedIngredients.find(i => i.id === id);
            return sum + (parseFloat(qty) || 0) * (ing?.price || 0);
        }, 0);
    };

    // ─── PLAN EDITOR STATE ───
    const [editingId, setEditingId] = useState(null); // null = closed, 'new' = creating, else plan id
    const [formName, setFormName] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formAdgFloor, setFormAdgFloor] = useState(1.0);
    const [formIsDefault, setFormIsDefault] = useState(false);
    const [formIngredientIds, setFormIngredientIds] = useState([]);
    const [formWeeks, setFormWeeks] = useState([]);
    const [addIngredientChoice, setAddIngredientChoice] = useState('');
    const [saveConfirm, setSaveConfirm] = useState(false);
    const [isNewIngredientFormOpen, setIsNewIngredientFormOpen] = useState(false);
    const [newIngredientName, setNewIngredientName] = useState('');
    const [newIngredientPrice, setNewIngredientPrice] = useState('');

    const blankWeek = (weekNum, ingredientIds, prevWeek) => ({
        week: weekNum,
        liveWeightMin: prevWeek ? prevWeek.liveWeightMax : '',
        liveWeightMax: '',
        targetAdg: prevWeek ? prevWeek.targetAdg : '',
        note: '',
        ingredients: ingredientIds.reduce((acc, id) => {
            acc[id] = prevWeek?.ingredients?.[id] ?? 0;
            return acc;
        }, {})
    });

    const openNewPlan = () => {
        const defaultIds = ['silage', 'maizeGrain', 'glutenFeed', 'straw', 'urea', 'minerals'].filter(id =>
            feedIngredients.some(i => i.id === id)
        );
        setEditingId('new');
        setFormName('');
        setFormDesc('');
        setFormAdgFloor(1.0);
        setFormIsDefault(false);
        setFormIngredientIds(defaultIds.length ? defaultIds : feedIngredients.map(i => i.id));
        setFormWeeks([blankWeek(1, defaultIds, null)]);
    };

    const openEditPlan = (plan) => {
        const idSet = new Set();
        (plan.weeks || []).forEach(w => Object.keys(w.ingredients || {}).forEach(id => idSet.add(id)));
        setEditingId(plan.id);
        setFormName(plan.name);
        setFormDesc(plan.description || '');
        setFormAdgFloor(plan.adgFloor ?? 1.0);
        setFormIsDefault(!!plan.isDefault);
        setFormIngredientIds([...idSet]);
        setFormWeeks((plan.weeks || []).map(w => ({ ...w, ingredients: { ...w.ingredients } })));
    };

    const closeEditor = () => {
        setEditingId(null);
        setAddIngredientChoice('');
    };

    const handleAddIngredientColumn = () => {
        if (!addIngredientChoice || formIngredientIds.includes(addIngredientChoice)) return;
        setFormIngredientIds(prev => [...prev, addIngredientChoice]);
        setAddIngredientChoice('');
    };

    // Lets an admin create a brand-new ingredient (e.g. a specific mineral blend) and
    // add it as a schedule column in one step, instead of a round trip to the
    // Ingredient Costs tab first.
    const handleCreateAndAddIngredient = (e) => {
        e.preventDefault();
        if (!isAdmin || !newIngredientName.trim()) return;
        const newIng = {
            id: 'custom_' + Date.now(),
            name: newIngredientName.trim(),
            dmTarget: 0,
            price: parseFloat(newIngredientPrice) || 0,
            isDefault: false
        };
        updateFeedIngredients([...feedIngredients, newIng]);
        setFormIngredientIds(prev => [...prev, newIng.id]);
        setNewIngredientName('');
        setNewIngredientPrice('');
        setIsNewIngredientFormOpen(false);
    };

    const handleRemoveIngredientColumn = (id) => {
        setFormIngredientIds(prev => prev.filter(x => x !== id));
        setFormWeeks(prev => prev.map(w => {
            const ing = { ...w.ingredients };
            delete ing[id];
            return { ...w, ingredients: ing };
        }));
    };

    const handleWeekFieldChange = (index, field, value) => {
        setFormWeeks(prev => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
    };

    const handleWeekIngredientChange = (index, ingId, value) => {
        setFormWeeks(prev => prev.map((w, i) => (i === index ? { ...w, ingredients: { ...w.ingredients, [ingId]: value } } : w)));
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

        const weeks = formWeeks.map(w => ({
            week: parseInt(w.week) || 0,
            liveWeightMin: parseFloat(w.liveWeightMin) || 0,
            liveWeightMax: parseFloat(w.liveWeightMax) || 0,
            targetAdg: parseFloat(w.targetAdg) || 0,
            note: w.note || '',
            ingredients: formIngredientIds.reduce((acc, ingId) => {
                acc[ingId] = parseFloat(w.ingredients[ingId]) || 0;
                return acc;
            }, {})
        }));

        saveRationPlan({
            id,
            name: formName.trim(),
            description: formDesc.trim(),
            adgFloor: parseFloat(formAdgFloor) || 1.0,
            isDefault: formIsDefault,
            weeks
        });

        setSaveConfirm(true);
        setTimeout(() => setSaveConfirm(false), 2000);
        closeEditor();
    };

    const handleDeletePlan = (plan) => {
        if (!isAdmin) return;
        if (window.confirm(`Delete Ration Plan "${plan.name}"? Any pens assigned to it will be unassigned.`)) {
            if (editingId === plan.id) closeEditor();
            deleteRationPlan(plan.id);
        }
    };

    // ─── PEN ASSIGNMENT ───
    const distinctPenNames = [...new Set([
        ...animals.filter(a => a.pen).map(a => a.pen),
        ...pens.map(p => p.id)
    ])].sort();

    const [newPenId, setNewPenId] = useState('');

    const handleAddPen = (e) => {
        e.preventDefault();
        if (!isAdmin) return;
        const id = newPenId.trim();
        if (!id) return;
        savePen({ id, rationPlanId: null, cycleStartDate: null, notes: '' });
        setNewPenId('');
    };

    const handlePenFieldChange = (penId, field, value) => {
        if (!isAdmin) return;
        const existing = pens.find(p => p.id === penId) || { id: penId, rationPlanId: null, cycleStartDate: null, notes: '' };
        savePen({ ...existing, [field]: value || null });
    };

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
                        <strong style={{ color: 'var(--text-pure)' }}>How this works:</strong> First, set your <strong>Ingredient Costs</strong> (procurement price per kg), then build a weekly schedule under <strong>Ration Plans</strong> (or use the pre-loaded "Baseline" plan). Finally, switch to <strong>Pen Assignment</strong> to link a plan and cycle start date to each pen — the TMR Calculator will then auto-fill each pen's daily batch from the plan, with no cost figures cluttering that page.
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
                    <i class="fa-solid fa-money-bill-wave"></i> Ingredient Costs
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
                                        const weekCosts = (plan.weeks || []).map(w => estimateWeekCost(w.ingredients));
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
                                        <label>Description</label>
                                        <input type="text" class="form-control" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Optional notes" />
                                    </div>
                                    <div class="form-group">
                                        <label>Minimum ADG Floor (kg/day)</label>
                                        <input type="number" step="0.05" class="form-control" value={formAdgFloor} onChange={e => setFormAdgFloor(e.target.value)} />
                                        <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.3rem' }}>Safety-net floor — pens falling below this flag on the Feed &amp; Growth Report.</small>
                                    </div>
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
                                            {feedIngredients.filter(i => !formIngredientIds.includes(i.id)).map(i => (
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
                                </div>

                                {isNewIngredientFormOpen && (
                                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.8rem', borderRadius: '8px' }}>
                                        <div class="form-group" style={{ marginBottom: 0, minWidth: '180px' }}>
                                            <label style={{ fontSize: '0.75rem' }}>New Ingredient Name</label>
                                            <input type="text" class="form-control" placeholder="e.g. Custom Mineral Mix" value={newIngredientName} onChange={e => setNewIngredientName(e.target.value)} />
                                        </div>
                                        <div class="form-group" style={{ marginBottom: 0, minWidth: '140px' }}>
                                            <label style={{ fontSize: '0.75rem' }}>Price (PKR/kg)</label>
                                            <input type="number" step="0.1" class="form-control" placeholder="e.g. 45" value={newIngredientPrice} onChange={e => setNewIngredientPrice(e.target.value)} />
                                        </div>
                                        <button type="button" class="btn btn-primary" onClick={handleCreateAndAddIngredient} disabled={!newIngredientName.trim()}>
                                            <i class="fa-solid fa-plus"></i> Create &amp; Add Column
                                        </button>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: '100%' }}>
                                            Adds this ingredient to the master list (also editable later in Ingredient Costs) and inserts it as a schedule column here.
                                        </span>
                                    </div>
                                )}

                                {/* Weekly schedule table */}
                                <div class="table-wrapper" style={{ marginBottom: '1rem' }}>
                                    <table class="data-table" style={{ fontSize: '0.8rem' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '50px' }}>WK</th>
                                                <th>LIVE WT MIN</th>
                                                <th>LIVE WT MAX</th>
                                                <th>TARGET ADG</th>
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
                                            {formWeeks.map((w, idx) => (
                                                <tr key={idx}>
                                                    <td>
                                                        <input type="number" class="form-control" style={{ width: '55px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.week} onChange={e => handleWeekFieldChange(idx, 'week', e.target.value)} />
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
                                                    {formIngredientIds.map(id => (
                                                        <td key={id}>
                                                            <input type="number" step="0.001" class="form-control" style={{ width: '75px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.ingredients[id] ?? 0} onChange={e => handleWeekIngredientChange(idx, id, e.target.value)} />
                                                        </td>
                                                    ))}
                                                    <td>
                                                        <input type="text" class="form-control" style={{ minWidth: '160px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.note} onChange={e => handleWeekFieldChange(idx, 'note', e.target.value)} placeholder="e.g. adaptation week" />
                                                    </td>
                                                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                                                        {Math.round(estimateWeekCost(w.ingredients))} PKR
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button type="button" onClick={() => handleRemoveWeek(idx)} style={{ background: 'none', border: 'none', color: 'hsl(0,75%,60%)', cursor: 'pointer' }} title="Remove week">
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
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
                                        <th>CYCLE START DATE</th>
                                        <th>CURRENT WEEK</th>
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
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem' }}
                                                        value={penConfig.rationPlanId || ''}
                                                        onChange={e => handlePenFieldChange(penId, 'rationPlanId', e.target.value)}
                                                        disabled={!isAdmin}
                                                    >
                                                        <option value="">— No plan —</option>
                                                        {rationPlans.map(plan => (
                                                            <option key={plan.id} value={plan.id}>{plan.name}</option>
                                                        ))}
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
                                                    {resolved ? (
                                                        <span>
                                                            Week {resolved.week.week}
                                                            {resolved.isAdaptationWeek && <span style={{ color: 'var(--accent-gold)' }}> (adaptation)</span>}
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                                {resolved.matchedByWeight ? 'Matched by weight' : 'Matched by cycle day (no weigh-in yet)'} · target {resolved.week.targetAdg} kg/day
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
                                            <td colSpan={isAdmin ? 7 : 6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
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

            {/* ═══ TAB: INGREDIENT COSTS ═══ */}
            {activeTab === 'costs' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                        <i class="fa-solid fa-circle-info" style={{ color: 'var(--accent-gold)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                            Procurement price (PKR/kg) drives every cost figure across the portal (Ration Plan cost estimates, Feed &amp; Growth Report). This lives here, not on the TMR Calculator — the TMR page only shows quantities to feed, never prices.
                        </span>
                    </div>

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-money-bill-wave"></i> Feed Ingredient Costs</h3>
                            {isAdmin && (
                                <button type="button" class="btn btn-secondary btn-sm" onClick={() => setIsAddCostFormOpen(!isAddCostFormOpen)}>
                                    <i class={`fa-solid ${isAddCostFormOpen ? 'fa-xmark' : 'fa-plus'}`}></i> {isAddCostFormOpen ? 'Cancel' : 'Add Ingredient'}
                                </button>
                            )}
                        </div>

                        {isAddCostFormOpen && (
                            <form onSubmit={handleAddCostIngredient} style={{ background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr auto', gap: '0.8rem', alignItems: 'flex-end' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Name</label>
                                        <input type="text" class="form-control" placeholder="e.g. Molasses" value={newCostName} onChange={e => setNewCostName(e.target.value)} required />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Price (PKR/kg)</label>
                                        <input type="number" step="0.1" class="form-control" placeholder="e.g. 45" value={newCostPrice} onChange={e => setNewCostPrice(e.target.value)} required />
                                    </div>
                                    <button type="submit" class="btn btn-primary">Add</button>
                                </div>
                            </form>
                        )}

                        <form onSubmit={handleSaveCosts}>
                            <div class="table-wrapper" style={{ marginBottom: '1rem' }}>
                                <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr>
                                            <th>INGREDIENT</th>
                                            <th>PRICE (PKR/KG)</th>
                                            {isAdmin && <th style={{ width: '60px', textAlign: 'center' }}>REMOVE</th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {costDraft.map(ing => (
                                            <tr key={ing.id}>
                                                <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{ing.name}</td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        class="form-control"
                                                        style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', maxWidth: '110px' }}
                                                        value={ing.price}
                                                        onChange={e => handleCostFieldChange(ing.id, 'price', e.target.value)}
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                {isAdmin && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {ing.isDefault ? (
                                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-lock" title="Baseline ingredients cannot be removed"></i></span>
                                                        ) : (
                                                            <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => handleDeleteCostIngredient(ing.id)}>
                                                                <i class="fa-solid fa-trash-can"></i>
                                                            </button>
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {isAdmin && (
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save Costs</button>
                                    {costSaved && (
                                        <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                            <i class="fa-solid fa-circle-check"></i> Saved!
                                        </span>
                                    )}
                                </div>
                            )}
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
