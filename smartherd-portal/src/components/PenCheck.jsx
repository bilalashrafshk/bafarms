import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT } from '../utils/dateOnly';

// Daily pen-walk / health-check log, deliberately modeled on how real feedlot pen
// riders record routine checks: one quick pen-level entry (pen, head observed, head
// pulled, bunk leftover reading) as the default action, with per-animal detail only
// appearing for the small number of animals actually pulled that day. See
// LOG_PEN_CHECK in api/farm.js and logPenCheck in FarmContext.jsx for the backend/
// state wiring — this component is just the entry form + a short recent-checks list.
const BUNK_SCORES = [
    { value: 0, label: '0 — Bunk clean, licked out' },
    { value: 1, label: '1 — Few kernels/crumbs left' },
    { value: 2, label: '2 — Thin, even layer left' },
    { value: 3, label: '3 — Noticeable leftover' },
    { value: 4, label: '4 — Heavy carryover / mostly untouched' }
];

export default function PenCheck() {
    const { animals, pens, penChecks, logPenCheck, staffUser } = useContext(FarmContext);

    const activePens = [...new Set(animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.pen).map(a => a.pen))].sort();

    const [pen, setPen] = useState(activePens[0] || '');
    const [headPulled, setHeadPulled] = useState(0);
    const [bunkScore, setBunkScore] = useState('');
    const [notes, setNotes] = useState('');
    const [flags, setFlags] = useState([]); // [{ animalId, rfid, note }]
    const [flagTagSearch, setFlagTagSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [justSubmitted, setJustSubmitted] = useState(false);

    const penAnimals = animals.filter(a => String(a.pen) === String(pen) && a.status !== 'Sold' && a.status !== 'Deceased');
    const headCount = penAnimals.length;

    const flagSuggestions = (() => {
        const q = flagTagSearch.trim().toLowerCase();
        if (!q) return [];
        return penAnimals
            .filter(a => !flags.some(f => f.animalId === a.id))
            .filter(a => a.rfid.toLowerCase().includes(q))
            .slice(0, 6);
    })();

    const addFlag = (animal) => {
        setFlags(prev => [...prev, { animalId: animal.id, rfid: animal.rfid, note: '' }]);
        setFlagTagSearch('');
    };

    const removeFlag = (animalId) => {
        setFlags(prev => prev.filter(f => f.animalId !== animalId));
    };

    const updateFlagNote = (animalId, note) => {
        setFlags(prev => prev.map(f => f.animalId === animalId ? { ...f, note } : f));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!pen) return;
        setSubmitting(true);
        try {
            await logPenCheck(pen, {
                headCount,
                headPulled: flags.length,
                bunkScore: bunkScore === '' ? null : parseInt(bunkScore),
                notes,
                flags: flags.map(f => ({ animalId: f.animalId, note: f.note }))
            });
            setFlags([]);
            setNotes('');
            setBunkScore('');
            setJustSubmitted(true);
            setTimeout(() => setJustSubmitted(false), 3000);
        } finally {
            setSubmitting(false);
        }
    };

    const todayStr = todayPKT();
    const recentChecks = [...(penChecks || [])]
        .sort((a, b) => (b.id || 0) - (a.id || 0))
        .slice(0, 20);

    const checkedTodayPens = new Set((penChecks || []).filter(c => c.date === todayStr).map(c => String(c.pen)));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="glass-panel">
                <h3 className="panel-title">
                    <i className="fa-solid fa-person-walking-arrow-right" style={{ color: 'var(--primary-green-light)' }}></i>
                    {' '}Daily Pen Check
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '-0.5rem', marginBottom: '1.2rem' }}>
                    One entry per pen, per walk. Only add a flag below for an animal you're actually pulling for a closer look — everything else in the pen is assumed fine.
                </p>

                <form onSubmit={handleSubmit}>
                    <div className="form-inline-grid-med" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                        <div className="form-group">
                            <label>Pen *</label>
                            <select className="form-control" value={pen} onChange={(e) => setPen(e.target.value)} required>
                                <option value="" disabled>Select pen…</option>
                                {activePens.map(p => (
                                    <option key={p} value={p}>
                                        Pen {p} {checkedTodayPens.has(String(p)) ? '✓ checked today' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Head Observed</label>
                            <input type="text" className="form-control" value={`${headCount} (active roster)`} disabled />
                        </div>
                        <div className="form-group">
                            <label>Bunk Reading (optional)</label>
                            <select className="form-control" value={bunkScore} onChange={(e) => setBunkScore(e.target.value)}>
                                <option value="">Not read</option>
                                {BUNK_SCORES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="form-group" style={{ position: 'relative', marginBottom: '1rem' }}>
                        <label>Flag an Animal (only if pulling one for a closer look)</label>
                        <input
                            type="text"
                            className="form-control"
                            placeholder="Type tag to flag…"
                            value={flagTagSearch}
                            onChange={(e) => setFlagTagSearch(e.target.value)}
                        />
                        {flagSuggestions.length > 0 && (
                            <div className="combobox-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20 }}>
                                {flagSuggestions.map(a => (
                                    <button key={a.id} type="button" className="combobox-option" onClick={() => addFlag(a)}>
                                        <strong>{a.rfid}</strong>
                                        <span className="combobox-meta">{a.breed} · Pen {a.pen}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {flags.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
                            {flags.map(f => (
                                <div key={f.animalId} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 700, minWidth: '90px' }}>{f.rfid}</span>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="One-line reason (e.g. off feed, coughing, limping)"
                                        value={f.note}
                                        onChange={(e) => updateFlagNote(f.animalId, e.target.value)}
                                        style={{ flex: 1 }}
                                    />
                                    <button type="button" className="btn btn-secondary" onClick={() => removeFlag(f.animalId)}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                        <label>Pen Notes (optional)</label>
                        <input type="text" className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else worth noting about this pen" />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={submitting || !pen}>
                        {submitting ? 'Saving…' : `Log Pen Check${flags.length > 0 ? ` (${flags.length} flagged)` : ''}`}
                    </button>
                    {justSubmitted && (
                        <span style={{ marginLeft: '1rem', color: 'var(--primary-green-light)', fontWeight: 600 }}>
                            <i className="fa-solid fa-check"></i> Saved
                        </span>
                    )}
                </form>
            </div>

            <div className="glass-panel">
                <h3 className="panel-title" style={{ marginBottom: '1rem' }}>
                    <i className="fa-solid fa-clock-rotate-left"></i> Recent Checks
                </h3>
                {recentChecks.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No pen checks logged yet.</p>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Pen</th>
                                <th>Head Observed</th>
                                <th>Pulled</th>
                                <th>Bunk</th>
                                <th>Notes</th>
                                <th>Logged By</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentChecks.map(c => (
                                <tr key={c.id}>
                                    <td>{formatDate(c.date)}</td>
                                    <td>Pen {c.pen}</td>
                                    <td>{c.headCount}</td>
                                    <td>{c.headPulled > 0 ? <strong style={{ color: 'hsl(0,75%,60%)' }}>{c.headPulled}</strong> : 0}</td>
                                    <td>{c.bunkScore !== null && c.bunkScore !== undefined ? c.bunkScore : '—'}</td>
                                    <td>{c.notes || '—'}</td>
                                    <td>{c.createdBy || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
