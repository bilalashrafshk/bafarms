import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT } from '../utils/dateOnly';

// Bunk scores supporting standard feedlot percentages & descriptive ratings
const BUNK_PRESETS = [
    { value: 0, label: '0% — Bunk clean, licked out (Score 0)' },
    { value: 10, label: '10% — Few crumbs / light leftover (Score 1)' },
    { value: 20, label: '20% — Thin layer / 20% leftover (Score 2)' },
    { value: 30, label: '30% — Noticeable leftover 30% (Score 2.5)' },
    { value: 50, label: '50% — Heavy carryover / 50% untouched (Score 3)' },
    { value: 75, label: '75%+ — Mostly untouched (Score 4)' }
];

const COMMON_NOTES = [
    { label: 'ونڈا 20 فیصد چھوڑ دیا چارہ کھا لیا', text: 'ونڈا 20 فیصد چھوڑ دیا چارہ کھا لیا (Left 20% wanda, consumed all fodder)' },
    { label: 'سارا چارہ ختم کر دیا', text: 'سارا چارہ ختم کر دیا (Clean bunk, finished all feed)' },
    { label: 'آلو سارے کھا گئے', text: 'آلو سارے کھا گئے (All potatoes consumed)' },
    { label: 'ونڈا 20 فیصد چھوڑ دیا', text: 'ونڈا 20 فیصد چھوڑ دیا (20% wanda leftover)' },
    { label: 'Off feed / Lethargic', text: 'Off feed / slow eating' }
];

export default function PenCheck() {
    const { animals, pens, penChecks, logPenCheck, staffUser } = useContext(FarmContext);

    const activePens = [...new Set(animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.pen).map(a => a.pen))].sort();

    // Form states
    const [checkDate, setCheckDate] = useState(todayPKT());
    const [session, setSession] = useState('Morning'); // 'Morning' | 'Evening'
    const [checkTime, setCheckTime] = useState('06:00');
    const [pen, setPen] = useState(activePens[0] || '');
    const [bunkScore, setBunkScore] = useState('');
    const [customBunkScore, setCustomBunkScore] = useState(false);
    const [notes, setNotes] = useState('');
    const [flags, setFlags] = useState([]); // [{ animalId, rfid, note }]
    const [flagTagSearch, setFlagTagSearch] = useState('');
    const [showRosterPicker, setShowRosterPicker] = useState(false);
    const [commonFlagReason, setCommonFlagReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [justSubmitted, setJustSubmitted] = useState(false);

    const penAnimals = animals.filter(a => String(a.pen) === String(pen) && a.status !== 'Sold' && a.status !== 'Deceased');
    const headCount = penAnimals.length;

    // Fast search suggestions
    const flagSuggestions = (() => {
        const q = flagTagSearch.trim().toLowerCase();
        if (!q) return [];
        return penAnimals
            .filter(a => !flags.some(f => f.animalId === a.id))
            .filter(a => a.rfid.toLowerCase().includes(q))
            .slice(0, 8);
    })();

    const addFlag = (animal) => {
        if (!flags.some(f => f.animalId === animal.id)) {
            setFlags(prev => [...prev, { animalId: animal.id, rfid: animal.rfid, note: commonFlagReason || '' }]);
        }
        setFlagTagSearch('');
    };

    const toggleRosterAnimal = (animal) => {
        if (flags.some(f => f.animalId === animal.id)) {
            setFlags(prev => prev.filter(f => f.animalId !== animal.id));
        } else {
            setFlags(prev => [...prev, { animalId: animal.id, rfid: animal.rfid, note: commonFlagReason || '' }]);
        }
    };

    const removeFlag = (animalId) => {
        setFlags(prev => prev.filter(f => f.animalId !== animalId));
    };

    const updateFlagNote = (animalId, note) => {
        setFlags(prev => prev.map(f => f.animalId === animalId ? { ...f, note } : f));
    };

    const applyCommonReason = () => {
        if (!commonFlagReason) return;
        setFlags(prev => prev.map(f => ({ ...f, note: commonFlagReason })));
    };

    const handleSessionChange = (nextSession) => {
        setSession(nextSession);
        setCheckTime(nextSession === 'Morning' ? '06:00' : '16:30');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!pen) return;
        setSubmitting(true);
        try {
            await logPenCheck(pen, {
                date: checkDate,
                session,
                checkTime,
                headCount,
                headPulled: flags.length,
                bunkScore: bunkScore === '' ? null : parseInt(bunkScore),
                notes,
                flags: flags.map(f => ({ animalId: f.animalId, note: f.note }))
            });
            setFlags([]);
            setNotes('');
            setBunkScore('');
            setCommonFlagReason('');
            setShowRosterPicker(false);
            setJustSubmitted(true);
            setTimeout(() => setJustSubmitted(false), 3000);
        } finally {
            setSubmitting(false);
        }
    };

    // Tracking which pens have been checked for this exact date & session
    const checkedThisSessionPens = new Set(
        (penChecks || [])
            .filter(c => c.date === checkDate && (c.session || (c.checkTime && c.checkTime.startsWith('16') ? 'Evening' : 'Morning')) === session)
            .map(c => String(c.pen))
    );

    const recentChecks = [...(penChecks || [])]
        .sort((a, b) => (b.id || 0) - (a.id || 0))
        .slice(0, 30);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
            <div className="glass-panel" style={{ padding: '1.5rem', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.2rem' }}>
                    <div>
                        <h3 className="panel-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <i className="fa-solid fa-person-walking-arrow-right" style={{ color: 'var(--primary-green-light)' }}></i>
                            Daily Pen Walk &amp; Bunk Reading
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0.3rem 0 0' }}>
                            Log routine morning/evening bunk scores and pull flagged calves for medical observation.
                        </p>
                    </div>

                    {/* Session Switcher Pills */}
                    <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <button
                            type="button"
                            onClick={() => handleSessionChange('Morning')}
                            style={{
                                padding: '0.45rem 0.9rem',
                                borderRadius: '6px',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '0.82rem',
                                fontWeight: '700',
                                background: session === 'Morning' ? 'var(--accent-gold)' : 'transparent',
                                color: session === 'Morning' ? '#111' : 'var(--text-muted)',
                                transition: 'all 0.2s ease',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem'
                            }}
                        >
                            <i className="fa-solid fa-sun"></i> Morning (06:00)
                        </button>
                        <button
                            type="button"
                            onClick={() => handleSessionChange('Evening')}
                            style={{
                                padding: '0.45rem 0.9rem',
                                borderRadius: '6px',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '0.82rem',
                                fontWeight: '700',
                                background: session === 'Evening' ? 'hsl(210, 90%, 55%)' : 'transparent',
                                color: session === 'Evening' ? '#fff' : 'var(--text-muted)',
                                transition: 'all 0.2s ease',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem'
                            }}
                        >
                            <i className="fa-solid fa-moon"></i> Evening (16:30)
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit}>
                    {/* Top Row: Date, Time, Pen, Head Count */}
                    <div className="form-inline-grid-med" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.2rem' }}>
                        <div className="form-group">
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Date</label>
                            <input
                                type="date"
                                className="form-control"
                                value={checkDate}
                                onChange={(e) => setCheckDate(e.target.value)}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Check Time</label>
                            <input
                                type="text"
                                className="form-control"
                                value={checkTime}
                                onChange={(e) => setCheckTime(e.target.value)}
                                placeholder="06:00 or 16:30"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Pen *</label>
                            <select className="form-control" value={pen} onChange={(e) => setPen(e.target.value)} required>
                                <option value="" disabled>Select pen…</option>
                                {activePens.map(p => (
                                    <option key={p} value={p}>
                                        Pen {p} ({checkedThisSessionPens.has(String(p)) ? `✓ ${session} Checked` : 'Pending'})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Head in Pen</label>
                            <input type="text" className="form-control" value={`${headCount} head (Active Roster)`} disabled />
                        </div>
                    </div>

                    {/* Second Row: Bunk Score / Leftover Reading */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '1.2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-pure)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <i className="fa-solid fa-scale-balanced" style={{ color: 'var(--accent-gold)' }}></i>
                                Bunk Score / Leftover Reading (% or Score)
                            </label>
                            <button
                                type="button"
                                onClick={() => setCustomBunkScore(prev => !prev)}
                                style={{ background: 'none', border: 'none', color: 'var(--accent-gold)', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                                {customBunkScore ? 'Use Preset List' : 'Enter Custom %'}
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {customBunkScore ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '200px' }}>
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        className="form-control"
                                        placeholder="Enter percentage leftover (e.g. 20 for 20%)"
                                        value={bunkScore}
                                        onChange={(e) => setBunkScore(e.target.value)}
                                        style={{ flex: 1 }}
                                    />
                                    <span style={{ color: 'var(--text-pure)', fontWeight: 700 }}>%</span>
                                </div>
                            ) : (
                                <select className="form-control" value={bunkScore} onChange={(e) => setBunkScore(e.target.value)} style={{ flex: 1, minWidth: '240px' }}>
                                    <option value="">Not read / skipped</option>
                                    {BUNK_PRESETS.map(b => (
                                        <option key={b.value} value={b.value}>{b.label}</option>
                                    ))}
                                </select>
                            )}

                            {/* Quick Bunk Score Pills */}
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                {[0, 10, 20, 30, 50].map(val => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => { setBunkScore(val); setCustomBunkScore(false); }}
                                        style={{
                                            padding: '4px 10px',
                                            borderRadius: '4px',
                                            fontSize: '0.75rem',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            background: String(bunkScore) === String(val) ? 'var(--accent-gold)' : 'rgba(255,255,255,0.06)',
                                            color: String(bunkScore) === String(val) ? '#111' : 'var(--text-pure)',
                                            border: '1px solid rgba(255,255,255,0.1)'
                                        }}
                                    >
                                        {val}%
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Quick common notes */}
                        <div style={{ marginTop: '0.8rem' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                                Quick Observation Snippets:
                            </span>
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                {COMMON_NOTES.map((cn, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => setNotes(prev => prev ? `${prev}; ${cn.text}` : cn.text)}
                                        style={{
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            borderRadius: '4px',
                                            padding: '3px 8px',
                                            color: 'var(--text-muted)',
                                            fontSize: '0.72rem',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease'
                                        }}
                                        title={`Append: ${cn.text}`}
                                    >
                                        + {cn.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="form-group" style={{ marginTop: '0.8rem', marginBottom: 0 }}>
                            <input
                                type="text"
                                className="form-control"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Bunk notes / observations (e.g. Left 20% wanda, fodder finished; water trough checked clean)"
                            />
                        </div>
                    </div>

                    {/* Third Section: Multi-Tag Selection & Flagging */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '1.2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.8rem' }}>
                            <div>
                                <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-pure)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <i className="fa-solid fa-flag" style={{ color: flags.length > 0 ? 'hsl(0, 75%, 65%)' : 'var(--text-muted)' }}></i>
                                    Flag Pulled Animals ({flags.length} selected)
                                </label>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                    Tick tags from the roster or search individually to log observation flags.
                                </span>
                            </div>

                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setShowRosterPicker(prev => !prev)}
                                style={{ padding: '0.35rem 0.8rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                            >
                                <i className={`fa-solid ${showRosterPicker ? 'fa-angle-up' : 'fa-list-check'}`}></i>
                                {showRosterPicker ? 'Hide Pen Roster' : `Select from Pen ${pen} Roster (${headCount})`}
                            </button>
                        </div>

                        {/* Search input for single tag */}
                        <div className="form-group" style={{ position: 'relative', marginBottom: '0.8rem' }}>
                            <input
                                type="text"
                                className="form-control"
                                placeholder={`Search tag in Pen ${pen}…`}
                                value={flagTagSearch}
                                onChange={(e) => setFlagTagSearch(e.target.value)}
                            />
                            {flagSuggestions.length > 0 && (
                                <div className="combobox-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20 }}>
                                    {flagSuggestions.map(a => (
                                        <button key={a.id} type="button" className="combobox-option" onClick={() => addFlag(a)}>
                                            <strong>{a.rfid}</strong>
                                            <span className="combobox-meta">{a.breed} · {a.currentWeight || a.entryWeight} kg</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Expandable Multi-Select Pen Roster */}
                        {showRosterPicker && (
                            <div style={{
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: '8px',
                                padding: '0.8rem',
                                marginBottom: '1rem'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-pure)', fontWeight: 600 }}>
                                        Click tag to select/unselect ({headCount} animals in Pen {pen}):
                                    </span>
                                    {flags.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setFlags([])}
                                            style={{ background: 'none', border: 'none', color: 'hsl(0, 75%, 65%)', fontSize: '0.72rem', cursor: 'pointer' }}
                                        >
                                            Clear Selection
                                        </button>
                                    )}
                                </div>

                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                                    gap: '0.4rem',
                                    maxHeight: '220px',
                                    overflowY: 'auto',
                                    paddingRight: '4px'
                                }}>
                                    {penAnimals.map(a => {
                                        const isSelected = flags.some(f => f.animalId === a.id);
                                        return (
                                            <div
                                                key={a.id}
                                                onClick={() => toggleRosterAnimal(a)}
                                                style={{
                                                    padding: '0.4rem 0.6rem',
                                                    borderRadius: '6px',
                                                    fontSize: '0.75rem',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    background: isSelected ? 'rgba(255, 193, 7, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                                                    border: isSelected ? '1px solid var(--accent-gold)' : '1px solid rgba(255, 255, 255, 0.06)',
                                                    color: isSelected ? 'var(--accent-gold)' : 'var(--text-pure)',
                                                    transition: 'all 0.15s ease'
                                                }}
                                            >
                                                <div>
                                                    <strong style={{ display: 'block' }}>{a.rfid}</strong>
                                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{a.currentWeight || a.entryWeight} kg</span>
                                                </div>
                                                <i className={`fa-solid ${isSelected ? 'fa-square-check' : 'fa-square'}`} style={{ fontSize: '0.85rem' }}></i>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Flagged Animals Reason List */}
                        {flags.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.6rem' }}>
                                {/* Apply Common Reason Bar */}
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Common reason for all selected tags (e.g. Off feed, slow eating, limping)"
                                        value={commonFlagReason}
                                        onChange={(e) => setCommonFlagReason(e.target.value)}
                                        style={{ flex: 1, fontSize: '0.8rem' }}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={applyCommonReason}
                                        style={{ fontSize: '0.75rem', padding: '0.45rem 0.8rem', whiteSpace: 'nowrap' }}
                                    >
                                        Apply to All ({flags.length})
                                    </button>
                                </div>

                                {flags.map(f => (
                                    <div key={f.animalId} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 700, minWidth: '90px', fontSize: '0.82rem', color: 'var(--accent-gold)' }}>
                                            Tag {f.rfid}
                                        </span>
                                        <input
                                            type="text"
                                            className="form-control"
                                            placeholder="Specific reason for this tag…"
                                            value={f.note}
                                            onChange={(e) => updateFlagNote(f.animalId, e.target.value)}
                                            style={{ flex: 1, fontSize: '0.8rem' }}
                                        />
                                        <button type="button" className="btn btn-secondary" onClick={() => removeFlag(f.animalId)} style={{ padding: '4px 8px' }}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <button type="submit" className="btn btn-primary" disabled={submitting || !pen} style={{ padding: '0.6rem 1.4rem', fontSize: '0.9rem' }}>
                            {submitting ? 'Saving…' : `Log Pen Check: Pen ${pen} (${session})${flags.length > 0 ? ` · ${flags.length} Flagged` : ''}`}
                        </button>
                        {justSubmitted && (
                            <span style={{ color: 'var(--primary-green-light)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <i className="fa-solid fa-circle-check"></i> Pen Check Saved Successfully
                            </span>
                        )}
                    </div>
                </form>
            </div>

            {/* Recent Checks Table */}
            <div className="glass-panel" style={{ padding: '1.5rem', borderRadius: '12px' }}>
                <h3 className="panel-title" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <i className="fa-solid fa-clock-rotate-left"></i>
                    Recent Pen Walk &amp; Bunk Check Ledger ({recentChecks.length})
                </h3>

                {recentChecks.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No pen checks logged yet.</p>
                ) : (
                    <div className="table-wrapper" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                        <table className="data-table" style={{ fontSize: '0.82rem' }}>
                            <thead>
                                <tr>
                                    <th>Date &amp; Session</th>
                                    <th>Pen</th>
                                    <th>Roster</th>
                                    <th>Flagged</th>
                                    <th>Bunk Reading</th>
                                    <th>Observations &amp; Notes</th>
                                    <th>Logged By</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentChecks.map(c => {
                                    const sess = c.session || (c.checkTime && c.checkTime.startsWith('16') ? 'Evening' : 'Morning');
                                    const tm = c.checkTime || (sess === 'Morning' ? '06:00' : '16:30');
                                    return (
                                        <tr key={c.id}>
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                <strong>{formatDate(c.date)}</strong>
                                                <span style={{
                                                    display: 'block',
                                                    fontSize: '0.72rem',
                                                    color: sess === 'Morning' ? 'var(--accent-gold)' : 'hsl(210, 90%, 65%)'
                                                }}>
                                                    {sess === 'Morning' ? '🌅 Morning' : '🌇 Evening'} ({tm})
                                                </span>
                                            </td>
                                            <td>
                                                <strong style={{ color: 'var(--text-pure)' }}>Pen {c.pen}</strong>
                                            </td>
                                            <td>{c.headCount} head</td>
                                            <td>
                                                {c.headPulled > 0 ? (
                                                    <span style={{
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        background: 'rgba(220, 53, 69, 0.2)',
                                                        color: 'hsl(0, 85%, 65%)',
                                                        fontWeight: 700,
                                                        fontSize: '0.75rem'
                                                    }}>
                                                        {c.headPulled} pulled
                                                    </span>
                                                ) : (
                                                    <span style={{ color: 'var(--text-muted)' }}>0</span>
                                                )}
                                            </td>
                                            <td>
                                                {c.bunkScore !== null && c.bunkScore !== undefined ? (
                                                    <span style={{
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        background: c.bunkScore === 0 ? 'rgba(25, 135, 84, 0.15)' : (c.bunkScore <= 20 ? 'rgba(255, 193, 7, 0.15)' : 'rgba(220, 53, 69, 0.15)'),
                                                        color: c.bunkScore === 0 ? 'var(--primary-green-light)' : (c.bunkScore <= 20 ? 'var(--accent-gold)' : 'hsl(0, 85%, 65%)'),
                                                        fontWeight: 700
                                                    }}>
                                                        {c.bunkScore}% Leftover
                                                    </span>
                                                ) : (
                                                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ color: 'var(--text-pure)', maxWidth: '300px' }}>
                                                {c.notes || '—'}
                                            </td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                                {c.createdBy || 'Staff'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
