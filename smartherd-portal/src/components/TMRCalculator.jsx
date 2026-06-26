import React, { useContext, useState, useEffect } from 'react';
import { FarmContext } from '../context/FarmContext';

export default function TMRCalculator() {
    const { feedIngredients, updateFeedIngredients, animals, staffUser } = useContext(FarmContext);
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

    // 1. LOCAL UI STATE
    const [animalsCount, setAnimalsCount] = useState(activeHerdCount || 1);
    const [ingredients, setIngredients] = useState([]);
    
    // Custom ingredient addition form states
    const [newName, setNewName] = useState('');
    const [newDM, setNewDM] = useState('');
    const [newPrice, setNewPrice] = useState('');
    const [newMoisture, setNewMoisture] = useState('10');
    
    const [isCustomFormOpen, setIsCustomFormOpen] = useState(false);
    const [isTractorMode, setIsTractorMode] = useState(false);
    const [isSaved, setIsSaved] = useState(false);

    // Load moisture discretion toggle
    const [incorporateMoisture, setIncorporateMoisture] = useState(() => {
        try {
            const stored = localStorage.getItem('ba_tmr_incorporate_moisture');
            return stored !== null ? JSON.parse(stored) : true;
        } catch (e) {
            return true;
        }
    });

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

    // 2. MATHEMATICAL FORMULATIONS (Dry-Matter to Wet-weight)
    const calculatedIngredients = ingredients.map(ing => {
        const currentMoisture = incorporateMoisture ? (ing.moisture ?? 0) : 0;
        const wetFactor = currentMoisture < 100 ? (100 / (100 - currentMoisture)) : 1.0;
        const wetSingle = ing.dmTarget * wetFactor;
        const wetBatch = Math.round(wetSingle * animalsCount);
        const costSingle = wetSingle * ing.price;

        return {
            ...ing,
            currentMoisture,
            wetFactor,
            wetSingle,
            wetBatch,
            costSingle
        };
    });

    const totalDM = calculatedIngredients.reduce((sum, ing) => sum + ing.dmTarget, 0);
    const totalBatchWeight = calculatedIngredients.reduce((sum, ing) => sum + ing.wetBatch, 0);
    const totalCostSingle = calculatedIngredients.reduce((sum, ing) => sum + ing.costSingle, 0);

    // Updaters
    const updateLocalIngredient = (id, field, value) => {
        setIngredients(prev => prev.map(ing => {
            if (ing.id === id) {
                return { ...ing, [field]: value };
            }
            return ing;
        }));
    };

    const handleDeleteIngredient = (id) => {
        setIngredients(prev => prev.filter(ing => ing.id !== id));
    };

    const handleAddIngredient = (e) => {
        e.preventDefault();
        if (!newName.trim() || !newDM || !newPrice) return;

        const newIng = {
            id: 'custom_' + Date.now(),
            name: newName.trim(),
            dmTarget: parseFloat(newDM) || 0,
            price: parseFloat(newPrice) || 0,
            moisture: parseFloat(newMoisture) || 0,
            isDefault: false
        };

        setIngredients(prev => [...prev, newIng]);
        setNewName('');
        setNewDM('');
        setNewPrice('');
        setNewMoisture('10');
        setIsCustomFormOpen(false);
    };

    const handleSaveAllIngredients = (e) => {
        if (e) e.preventDefault();
        updateFeedIngredients(ingredients);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2500);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            
            {/* Top Grid: Ingredients list and Batch Recipe Output */}
            <div class="tmr-grid">

                {/* Left: Input, Custom addition & Formulation list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    
                    {/* Unified Formulation Card */}
                    <div class="glass-panel">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-flask"></i> Ingredients & Recipe</h3>
                            <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-pure)', cursor: isAdmin ? 'pointer' : 'default', margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={incorporateMoisture}
                                        onChange={(e) => {
                                            if (!isAdmin) return;
                                            setIncorporateMoisture(e.target.checked);
                                            localStorage.setItem('ba_tmr_incorporate_moisture', JSON.stringify(e.target.checked));
                                        }}
                                        disabled={!isAdmin}
                                        style={{ width: '15px', height: '15px', cursor: isAdmin ? 'pointer' : 'default' }}
                                    />
                                    Use Moisture
                                </label>
                                {isAdmin && (
                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', minHeight: '32px', height: '32px', fontSize: '0.8rem' }} onClick={() => setIsCustomFormOpen(!isCustomFormOpen)}>
                                        <i class={`fa-solid ${isCustomFormOpen ? 'fa-xmark' : 'fa-plus'}`}></i> {isCustomFormOpen ? 'Cancel' : 'Add Custom'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Inline Form to Add Custom Ingredient - Single compact row */}
                        {isCustomFormOpen && (
                            <form onSubmit={handleAddIngredient} style={{ background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <h4 style={{ fontSize: '0.78rem', color: 'var(--accent-gold)', marginBottom: '0.6rem', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}>
                                    <i class="fa-solid fa-circle-plus"></i> Add Custom Ingredient
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.2fr 1.2fr auto', gap: '0.8rem', alignItems: 'flex-end' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Name</label>
                                        <input type="text" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} placeholder="e.g. Molasses" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>DM Target (kg)</label>
                                        <input type="number" step="0.01" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} placeholder="e.g. 1.2" value={newDM} onChange={(e) => setNewDM(e.target.value)} required />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Moisture (%)</label>
                                        <input type="number" step="1" min="0" max="95" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} placeholder="e.g. 15" value={newMoisture} onChange={(e) => setNewMoisture(e.target.value)} />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Price (PKR/kg)</label>
                                        <input type="number" step="0.1" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} placeholder="e.g. 45" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} required />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <button type="submit" class="btn btn-primary" style={{ minHeight: '36px', height: '36px', padding: '0 1rem', fontSize: '0.85rem' }}>Add</button>
                                    </div>
                                </div>
                            </form>
                        )}

                        {/* Ingredients Table */}
                        <form onSubmit={handleSaveAllIngredients}>
                            <div class="table-wrapper" style={{ marginBottom: '1.2rem' }}>
                                <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr>
                                            <th>INGREDIENT</th>
                                            <th>DM TARGET (KG)</th>
                                            <th>MOISTURE (%)</th>
                                            <th>PRICE (PKR/KG)</th>
                                            <th style={{ width: '60px', textAlign: 'center' }}>REMOVE</th>
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
                                                        class="form-control"
                                                        style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '90px' }}
                                                        value={ing.dmTarget}
                                                        onChange={(e) => updateLocalIngredient(ing.id, 'dmTarget', parseFloat(e.target.value) || 0)}
                                                        required
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="95"
                                                        class="form-control"
                                                        style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '90px', opacity: incorporateMoisture ? 1 : 0.5 }}
                                                        value={ing.moisture ?? 0}
                                                        onChange={(e) => updateLocalIngredient(ing.id, 'moisture', parseInt(e.target.value) || 0)}
                                                        required
                                                        disabled={!isAdmin || !incorporateMoisture}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        class="form-control"
                                                        style={{ minHeight: '34px', height: '34px', padding: '0.2rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '90px' }}
                                                        value={ing.price}
                                                        onChange={(e) => updateLocalIngredient(ing.id, 'price', parseFloat(e.target.value) || 0)}
                                                        required
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {ing.isDefault ? (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-lock" title="Baseline ingredients cannot be removed"></i></span>
                                                    ) : !isAdmin ? (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-lock" title="Admin permissions required to modify ingredients"></i></span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            class="btn btn-secondary"
                                                            style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                            onClick={() => handleDeleteIngredient(ing.id)}
                                                        >
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {isAdmin ? (
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <button type="submit" class="btn btn-secondary"><i class="fa-solid fa-floppy-disk"></i> Save Formulation</button>
                                    {isSaved && (
                                        <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                            <i class="fa-solid fa-circle-check"></i> Changes committed successfully.
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span style={{ fontSize: '0.85rem', color: 'var(--accent-gold)', fontWeight: '600' }}>
                                    <i class="fa-solid fa-circle-info"></i> Recipe viewing mode (Admin authorization required to modify).
                                </span>
                            )}
                        </form>
                    </div>

                </div>

                {/* Right: Outputs, Batch Scale & Tractor mixer mode */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    
                    {!isTractorMode ? (
                        <div class="glass-panel" style={{ borderTop: '4px solid var(--accent-gold)' }}>
                            <div class="form-header-bar" style={{ marginBottom: '1.2rem', gap: '1rem', flexWrap: 'wrap' }}>
                                <h3 class="panel-title" style={{ marginBottom: '0' }}><i class="fa-solid fa-scale-balanced"></i> Batch Recipe</h3>
                                <button type="button" class="btn btn-secondary btn-sm" onClick={() => setIsTractorMode(true)}>
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
                                            return (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    class={`filter-btn ${selectedTMRPen === p ? 'active' : ''}`}
                                                    style={{ fontSize: '0.7rem', minHeight: '26px', padding: '0.15rem 0.5rem' }}
                                                    onClick={() => setSelectedTMRPen(p)}
                                                >Pen {p} ({penCount})</button>
                                            );
                                        })}
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
                                            <th>DM TARGET</th>
                                            <th>MOISTURE</th>
                                            <th>WET WT / ANIMAL</th>
                                            <th>BATCH WEIGHT</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {calculatedIngredients.map(ing => (
                                            <tr key={ing.id}>
                                                <td><strong>{ing.name}</strong></td>
                                                <td>{ing.dmTarget.toFixed(2)} kg</td>
                                                <td>{incorporateMoisture ? `${ing.moisture}%` : '0% (Ignored)'}</td>
                                                <td>{ing.wetSingle.toFixed(2)} kg</td>
                                                <td><strong style={{ color: 'var(--primary-green-light)', fontSize: '1.05rem' }}>{ing.wetBatch} kg</strong></td>
                                            </tr>
                                        ))}
                                        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                            <td><strong>Total Feed Mix</strong></td>
                                            <td><strong>{totalDM.toFixed(2)} kg</strong></td>
                                            <td>—</td>
                                            <td><strong>{calculatedIngredients.reduce((sum, ing) => sum + ing.wetSingle, 0).toFixed(2)} kg</strong></td>
                                            <td><strong style={{ color: 'var(--accent-gold)', fontSize: '1.15rem' }}>{totalBatchWeight.toLocaleString()} kg</strong></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* Cost Summary Box */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.2rem', alignItems: 'center' }}>
                                <div>
                                    <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Daily feeding cost / calf</span>
                                    <strong style={{ fontSize: '1.4rem', color: totalCostSingle <= 300 ? 'var(--primary-green-light)' : 'hsl(0, 75%, 55%)', fontFamily: 'var(--font-heading)' }}>
                                        {Math.round(totalCostSingle)} PKR <small style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>per day</small>
                                    </strong>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <span class={`badge-status ${totalCostSingle <= 300 ? 'fattening' : 'quarantined'}`}>
                                        {totalCostSingle <= 300 ? 'Within Budget' : 'Exceeds Target'}
                                    </span>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                                        Total Daily Herd Cost: <strong style={{ color: 'var(--text-pure)' }}>{Math.round(totalCostSingle * animalsCount).toLocaleString()} PKR</strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Tractor Mixing View Console */
                        <div class="tractor-mode-box">
                            <div class="modal-close-btn" style={{ top: '1rem', right: '1.5rem', color: 'var(--accent-gold)' }} onClick={() => setIsTractorMode(false)}>
                                <i class="fa-solid fa-rectangle-list" style={{ marginRight: '0.5rem', fontSize: '0.95rem' }}></i>
                                <span style={{ fontFamily: 'var(--font-heading)', fontSize: '0.85rem', fontWeight: '700' }}>Standard Mode</span>
                            </div>

                            <div class="tractor-logo-icon"><i class="fa-solid fa-tractor"></i></div>
                            <h2>Tractor Mixing Screen</h2>
                            <p class="batch-sub">Total batch scaled up for {animalsCount} calves</p>

                            <div class="tractor-mix-list">
                                {calculatedIngredients.map((ing, idx) => (
                                    <div class="tractor-mix-item" key={ing.id} style={ing.id === 'minerals' ? { borderLeftColor: 'var(--accent-gold)' } : {}}>
                                        <span>{idx + 1}. WET {ing.name.toUpperCase()}</span>
                                        <strong>{ing.wetBatch.toLocaleString()} KG</strong>
                                    </div>
                                ))}
                            </div>

                            <p style={{ marginTop: '2rem', fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                <i class="fa-solid fa-circle-info"></i> Weigh ingredients sequentially inside the mixer wagon scales. Total batch target: {totalBatchWeight.toLocaleString()} kg.
                            </p>
                        </div>
                    )}

                </div>

            </div>

        </div>
    );
}
