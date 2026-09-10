import React, { useState, useMemo, useContext, useEffect } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

export default function TagDetailLookup({ initialTag = '', onTagSelect } = {}) {
    const { animals, weightLogs, treatments, events, pens } = useContext(FarmContext);
    const [searchInput, setSearchInput] = useState(initialTag);
    const [selectedRfid, setSelectedRfid] = useState(initialTag);

    useEffect(() => {
        if (initialTag) {
            setSearchInput(initialTag);
            setSelectedRfid(initialTag);
        }
    }, [initialTag]);

    // Fast normalization
    const norm = (s) => (s || '').toString().trim().toLowerCase();

    // Matching animal
    const selectedAnimal = useMemo(() => {
        if (!selectedRfid) return null;
        const target = norm(selectedRfid);
        return animals.find(a => 
            norm(a.rfid) === target || 
            (Array.isArray(a.previousTags) && a.previousTags.some(pt => norm(pt) === target))
        );
    }, [animals, selectedRfid]);

    // Autocomplete options
    const searchSuggestions = useMemo(() => {
        const q = norm(searchInput);
        if (!q) return [];
        return animals
            .filter(a => norm(a.rfid).includes(q) || (a.pen && norm(a.pen).includes(q)) || norm(a.breed).includes(q))
            .slice(0, 8);
    }, [animals, searchInput]);

    const handleSelectTag = (rfid) => {
        setSearchInput(rfid);
        setSelectedRfid(rfid);
        if (onTagSelect) onTagSelect(rfid);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (searchSuggestions.length > 0) {
                handleSelectTag(searchSuggestions[0].rfid);
            } else if (searchInput) {
                setSelectedRfid(searchInput.trim());
            }
        }
    };

    // Animal specific datasets
    const animalWeights = useMemo(() => {
        if (!selectedAnimal) return [];
        return (weightLogs || [])
            .filter(w => w.animalId === selectedAnimal.id)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }, [weightLogs, selectedAnimal]);

    const animalTreatments = useMemo(() => {
        if (!selectedAnimal) return [];
        return (treatments || [])
            .filter(t => t.animalId === selectedAnimal.id)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [treatments, selectedAnimal]);

    const animalEvents = useMemo(() => {
        if (!selectedAnimal) return [];
        return (events || [])
            .filter(e => e.animalId === selectedAnimal.id)
            .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    }, [events, selectedAnimal]);

    // Growth stats
    const entryW = selectedAnimal ? parseFloat(selectedAnimal.entryWeight) || 0 : 0;
    const currentW = selectedAnimal ? parseFloat(selectedAnimal.currentWeight) || entryW : 0;
    const targetW = selectedAnimal ? parseFloat(selectedAnimal.targetWeight) || 0 : 0;
    const totalGain = currentW - entryW;

    // Interval ADG & Days on feed
    const firstDate = selectedAnimal?.entryDate ? new Date(selectedAnimal.entryDate) : null;
    const lastWeightDate = animalWeights.length > 0 ? new Date(animalWeights[animalWeights.length - 1].date) : null;
    const daysOnFeed = firstDate && !isNaN(firstDate.getTime())
        ? Math.max(1, Math.round((new Date() - firstDate) / 86400000))
        : 1;
    const overallAdg = totalGain > 0 && daysOnFeed > 0 ? (totalGain / daysOnFeed).toFixed(2) : '0.00';

    const weightProgressPct = targetW > entryW
        ? Math.min(100, Math.max(0, Math.round(((currentW - entryW) / (targetW - entryW)) * 100)))
        : 0;

    // Status colors
    const statusColor = (st) => {
        switch ((st || '').toLowerCase()) {
            case 'fattening': return 'var(--primary-green-light)';
            case 'quarantined': return 'var(--accent-gold)';
            case 'sick': return 'hsl(0, 75%, 65%)';
            case 'sold': return 'hsl(210, 90%, 65%)';
            case 'deceased': return 'hsl(0, 0%, 50%)';
            default: return 'var(--text-muted)';
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '1280px', margin: '0 auto' }}>
            {/* 1. Header & Minimal Search Bar */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.8rem' }}>
                    <div>
                        <h2 style={{ fontSize: '1.35rem', color: 'var(--text-pure)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <i className="fa-solid fa-id-card-clip" style={{ color: 'var(--accent-gold)' }}></i>
                            Animal Tag Dossier &amp; Passport
                        </h2>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Instant lookup for complete biometric identity, registry origin, health, and weigh-in timeline
                        </span>
                    </div>
                    {selectedAnimal && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span className="farm-badge" style={{ borderColor: 'var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
                                <i className="fa-solid fa-calendar-day" style={{ color: 'var(--accent-gold)' }}></i>
                                {daysOnFeed} Days on Feed
                            </span>
                            <span className="farm-badge" style={{ borderColor: 'var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
                                <i className="fa-solid fa-layer-group" style={{ color: 'var(--primary-green-light)' }}></i>
                                Pen {selectedAnimal.pen || 'Unassigned'}
                            </span>
                        </div>
                    )}
                </div>

                {/* Instant Search Bar */}
                <div style={{ position: 'relative', width: '100%' }}>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-gold)', fontSize: '0.95rem' }}></i>
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Type or scan RFID Tag # (e.g. 23, 36, 101)..."
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem 1rem 0.75rem 2.8rem',
                                    fontSize: '1rem',
                                    fontFamily: 'var(--font-heading)',
                                    fontWeight: '600',
                                    background: 'rgba(0,0,0,0.3)',
                                    borderColor: searchInput ? 'var(--accent-gold)' : 'var(--border-subtle)',
                                    borderRadius: '8px'
                                }}
                                autoFocus
                            />
                            {searchInput && (
                                <button
                                    type="button"
                                    onClick={() => { setSearchInput(''); setSelectedRfid(''); }}
                                    style={{
                                        position: 'absolute',
                                        right: '0.8rem',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'none',
                                        border: 'none',
                                        color: 'var(--text-muted)',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    <i className="fa-solid fa-xmark"></i>
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setSelectedRfid(searchInput.trim())}
                            style={{ minHeight: '44px', padding: '0 1.4rem' }}
                        >
                            Lookup
                        </button>
                    </div>

                    {/* Quick suggestions dropdown */}
                    {searchInput && searchSuggestions.length > 0 && norm(searchInput) !== norm(selectedRfid) && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 50,
                            marginTop: '4px',
                            background: '#0d1512',
                            border: '1px solid var(--accent-gold-glow)',
                            borderRadius: '8px',
                            boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
                            overflow: 'hidden'
                        }}>
                            {searchSuggestions.map((a) => (
                                <div
                                    key={a.id}
                                    onClick={() => handleSelectTag(a.rfid)}
                                    style={{
                                        padding: '0.65rem 1rem',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                                        transition: 'background 0.15s ease'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <strong style={{ color: 'var(--accent-gold)', fontSize: '1rem', fontFamily: 'var(--font-heading)' }}>Tag {a.rfid}</strong>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-pure)' }}>{a.breed}</span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pen {a.pen || '—'}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-pure)' }}>{a.currentWeight || a.entryWeight} kg</span>
                                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: statusColor(a.status) }}>
                                            {a.status}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 2. Content: Details Dossier or Empty State */}
            {!selectedAnimal ? (
                <div className="glass-panel" style={{ padding: '3.5rem 1.5rem', textAlign: 'center', borderRadius: '12px' }}>
                    <i className="fa-solid fa-microchip animate-pulse" style={{ fontSize: '3rem', color: 'var(--accent-gold)', opacity: 0.6, marginBottom: '1rem' }}></i>
                    <h3 style={{ fontSize: '1.2rem', color: 'var(--text-pure)', marginBottom: '0.4rem' }}>
                        {searchInput ? `No Animal Found with Tag "${searchInput}"` : 'Enter a Tag ID to View Dossier'}
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '420px', margin: '0 auto 1.2rem' }}>
                        Search any ear tag (e.g. 08, 16, 23, 36, 101) or scan with your Bluetooth wand to inspect complete historical metrics.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Quick Picks:</span>
                        {animals.slice(0, 6).map(a => (
                            <button
                                key={a.id}
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleSelectTag(a.rfid)}
                                style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                            >
                                Tag {a.rfid}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* TOP HERO PROFILE CARD */}
                    <div className="glass-panel" style={{
                        padding: '1.5rem',
                        borderRadius: '12px',
                        borderLeft: `4px solid ${statusColor(selectedAnimal.status)}`,
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.3) 100%)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.2rem' }}>
                            <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'center' }}>
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '10px',
                                    background: 'rgba(255,193,7,0.08)',
                                    border: '1px solid var(--accent-gold-glow)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TAG</span>
                                    <strong style={{ fontSize: '1.5rem', color: 'var(--accent-gold)', fontFamily: 'var(--font-heading)', lineHeight: 1 }}>
                                        {selectedAnimal.rfid}
                                    </strong>
                                </div>

                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                                        <h3 style={{ fontSize: '1.3rem', color: 'var(--text-pure)', margin: 0, fontFamily: 'var(--font-heading)' }}>
                                            {selectedAnimal.breed} Calf
                                        </h3>
                                        <span style={{
                                            fontSize: '0.72rem',
                                            fontWeight: '700',
                                            padding: '2px 8px',
                                            borderRadius: '6px',
                                            background: 'rgba(255,255,255,0.06)',
                                            color: statusColor(selectedAnimal.status),
                                            border: `1px solid ${statusColor(selectedAnimal.status)}33`
                                        }}>
                                            {selectedAnimal.status}
                                        </span>
                                        {Array.isArray(selectedAnimal.previousTags) && selectedAnimal.previousTags.length > 0 && (
                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                (Prev Tags: {selectedAnimal.previousTags.join(', ')})
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                        <span><i className="fa-solid fa-layer-group" style={{ marginRight: '4px' }}></i> Pen: <strong style={{ color: 'var(--text-pure)' }}>{selectedAnimal.pen || 'Unassigned'}</strong></span>
                                        <span><i className="fa-solid fa-truck-ramp-box" style={{ marginRight: '4px' }}></i> Mandi: <strong style={{ color: 'var(--text-pure)' }}>{selectedAnimal.source || '—'}</strong></span>
                                        <span><i className="fa-solid fa-calendar-check" style={{ marginRight: '4px' }}></i> Intake: <strong style={{ color: 'var(--text-pure)' }}>{formatDate(selectedAnimal.entryDate)}</strong></span>
                                    </div>
                                </div>
                            </div>

                            {/* Weight metric tiles */}
                            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.6rem 1rem', borderRadius: '8px', minWidth: '100px' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Entry Weight</span>
                                    <strong style={{ fontSize: '1.1rem', color: 'var(--text-pure)' }}>{entryW} <small style={{ fontSize: '0.75rem' }}>kg</small></strong>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.6rem 1rem', borderRadius: '8px', minWidth: '100px' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Current Weight</span>
                                    <strong style={{ fontSize: '1.1rem', color: 'var(--accent-gold)' }}>{currentW} <small style={{ fontSize: '0.75rem' }}>kg</small></strong>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.6rem 1rem', borderRadius: '8px', minWidth: '100px' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Total Gain</span>
                                    <strong style={{ fontSize: '1.1rem', color: totalGain >= 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,65%)' }}>
                                        {totalGain >= 0 ? `+${totalGain.toFixed(1)}` : totalGain.toFixed(1)} <small style={{ fontSize: '0.75rem' }}>kg</small>
                                    </strong>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.6rem 1rem', borderRadius: '8px', minWidth: '100px' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Lifetime ADG</span>
                                    <strong style={{ fontSize: '1.1rem', color: 'var(--primary-green-light)' }}>
                                        {overallAdg} <small style={{ fontSize: '0.75rem' }}>kg/d</small>
                                    </strong>
                                </div>
                            </div>
                        </div>

                        {/* Target Weight Progress Bar */}
                        {targetW > 0 && (
                            <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.35rem', color: 'var(--text-muted)' }}>
                                    <span>Growth Target: <strong>{targetW} kg</strong></span>
                                    <span>{weightProgressPct}% of Target Goal Completed</span>
                                </div>
                                <div style={{ height: '7px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${weightProgressPct}%`, background: 'var(--primary-green-light)', borderRadius: '4px', transition: 'width 0.4s ease' }}></div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* TWO-COLUMN GRID: FINANCIALS & TIMELINE */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
                        
                        {/* A. Weight History & Weigh-ins */}
                        <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <i className="fa-solid fa-weight-scale" style={{ color: 'var(--accent-gold)' }}></i>
                                    Weigh-in History ({animalWeights.length})
                                </h4>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Chronological Growth</span>
                            </div>

                            {animalWeights.length === 0 ? (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
                                    Only baseline entry weight recorded ({entryW} kg).
                                </p>
                            ) : (
                                <div className="table-wrapper" style={{ maxHeight: '260px', overflowY: 'auto' }}>
                                    <table className="data-table" style={{ fontSize: '0.8rem' }}>
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Weight</th>
                                                <th>Interval Gain</th>
                                                <th>Recorded By</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {animalWeights.map((w, i) => {
                                                const prev = i > 0 ? animalWeights[i - 1].weight : entryW;
                                                const diff = w.weight - prev;
                                                return (
                                                    <tr key={w.id || i}>
                                                        <td>{formatDate(w.date)}</td>
                                                        <td><strong style={{ color: 'var(--text-pure)' }}>{w.weight} kg</strong></td>
                                                        <td>
                                                            <span style={{ color: diff >= 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,65%)', fontWeight: '600' }}>
                                                                {diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)} kg
                                                            </span>
                                                        </td>
                                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{w.createdBy || 'Staff'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* B. Acquisition & Commercial Financials */}
                        <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <i className="fa-solid fa-receipt" style={{ color: 'var(--accent-gold)' }}></i>
                                    Acquisition &amp; Landed Cost
                                </h4>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Mandi Ledger</span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', fontSize: '0.8rem' }}>
                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Mandi Base Price</span>
                                    <strong style={{ color: 'var(--text-pure)' }}>
                                        {selectedAnimal.mandiPrice ? `PKR ${parseFloat(selectedAnimal.mandiPrice).toLocaleString()}` : (selectedAnimal.purchasePrice ? `PKR ${parseFloat(selectedAnimal.purchasePrice).toLocaleString()}` : '—')}
                                    </strong>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Mandi Weight</span>
                                    <strong style={{ color: 'var(--text-pure)' }}>
                                        {selectedAnimal.mandiWeight ? `${selectedAnimal.mandiWeight} kg` : `${entryW} kg`}
                                    </strong>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Carriage / Transport</span>
                                    <strong style={{ color: 'var(--text-pure)' }}>
                                        {selectedAnimal.carriage ? `PKR ${parseFloat(selectedAnimal.carriage).toLocaleString()}` : '—'}
                                    </strong>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Mandi Tax &amp; Fees</span>
                                    <strong style={{ color: 'var(--text-pure)' }}>
                                        {selectedAnimal.mandiTax ? `PKR ${parseFloat(selectedAnimal.mandiTax).toLocaleString()}` : '—'}
                                    </strong>
                                </div>
                            </div>

                            {/* Total Landed Cost Banner */}
                            {(() => {
                                const base = parseFloat(selectedAnimal.mandiPrice || selectedAnimal.purchasePrice) || 0;
                                const extra = (parseFloat(selectedAnimal.mandiTax) || 0) + (parseFloat(selectedAnimal.carriage) || 0) + (parseFloat(selectedAnimal.miscExpense) || 0);
                                const totalLanded = base + extra;
                                const costPerKg = entryW > 0 ? (totalLanded / entryW).toFixed(1) : 0;
                                return (
                                    <div style={{
                                        marginTop: '0.9rem',
                                        padding: '0.75rem 1rem',
                                        background: 'rgba(25, 135, 84, 0.08)',
                                        border: '1px solid rgba(25, 135, 84, 0.25)',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        <div>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--primary-green-light)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: '700' }}>
                                                Total Landed Cost
                                            </span>
                                            <strong style={{ display: 'block', fontSize: '1.1rem', color: 'var(--text-pure)' }}>
                                                PKR {Math.round(totalLanded).toLocaleString()}
                                            </strong>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Landed Cost / KG</span>
                                            <strong style={{ fontSize: '1rem', color: 'var(--accent-gold)' }}>PKR {costPerKg} / kg</strong>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {/* TWO-COLUMN GRID: MEDICAL LOGS & EVENT TIMELINE */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
                        
                        {/* C. Medical & Treatment Log */}
                        <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <i className="fa-solid fa-stethoscope" style={{ color: 'var(--accent-gold)' }}></i>
                                    Medical Treatments &amp; Vaccines ({animalTreatments.length})
                                </h4>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Clinical Passport</span>
                            </div>

                            {animalTreatments.length === 0 ? (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
                                    <i className="fa-solid fa-circle-check" style={{ color: 'var(--primary-green-light)', marginRight: '6px' }}></i>
                                    No veterinary sickness or treatments on file.
                                </p>
                            ) : (
                                <div className="table-wrapper" style={{ maxHeight: '260px', overflowY: 'auto' }}>
                                    <table className="data-table" style={{ fontSize: '0.8rem' }}>
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Type</th>
                                                <th>Medicine &amp; Dose</th>
                                                <th>Notes / Diagnosis</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {animalTreatments.map((t) => (
                                                <tr key={t.id}>
                                                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.date)}</td>
                                                    <td>
                                                        <span style={{
                                                            fontSize: '0.68rem',
                                                            padding: '2px 5px',
                                                            borderRadius: '4px',
                                                            background: (t.type || '').toLowerCase().includes('vaccin') ? 'rgba(25, 135, 84, 0.15)' : 'rgba(255, 193, 7, 0.15)',
                                                            color: (t.type || '').toLowerCase().includes('vaccin') ? 'var(--primary-green-light)' : 'var(--accent-gold)'
                                                        }}>
                                                            {t.type || 'Medicine'}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <strong style={{ color: 'var(--text-pure)', display: 'block' }}>{t.medicine}</strong>
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Dose: {t.dosage}</span>
                                                    </td>
                                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                                        {t.notes || '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* D. Pen Movements & Life Events */}
                        <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <i className="fa-solid fa-timeline" style={{ color: 'var(--accent-gold)' }}></i>
                                    Pen Transfers &amp; Lifecycle Events ({animalEvents.length})
                                </h4>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Audit Trail</span>
                            </div>

                            {animalEvents.length === 0 ? (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
                                    No recorded pen shifts or lifecycle events.
                                </p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '260px', overflowY: 'auto', paddingRight: '0.2rem' }}>
                                    {animalEvents.map((ev, i) => (
                                        <div
                                            key={ev.id || i}
                                            style={{
                                                background: 'rgba(0,0,0,0.2)',
                                                border: '1px solid rgba(255,255,255,0.05)',
                                                padding: '0.6rem 0.8rem',
                                                borderRadius: '6px',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                fontSize: '0.78rem'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                <i className={`fa-solid ${ev.eventType === 'pen_transfer' ? 'fa-right-left' : (ev.eventType === 'tag_replacement' ? 'fa-tag' : 'fa-info-circle')}`} style={{ color: 'var(--accent-gold)' }}></i>
                                                <div>
                                                    <strong style={{ color: 'var(--text-pure)', display: 'block' }}>{ev.note || ev.eventType}</strong>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Logged by: {ev.createdBy || 'Staff'}</span>
                                                </div>
                                            </div>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                                {formatDate(ev.date || ev.createdAt)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
}
