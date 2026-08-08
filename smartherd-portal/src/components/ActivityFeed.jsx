import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

const EVENT_META = {
    registered:    { icon: 'fa-plus-circle',        color: 'var(--accent-gold)' },
    status_change: { icon: 'fa-arrow-right-arrow-left', color: 'hsl(200,70%,60%)' },
    pen_transfer:  { icon: 'fa-right-left',         color: 'var(--accent-gold)' },
    sold:          { icon: 'fa-money-bill-transfer', color: 'var(--primary-green-light)' },
    deceased:      { icon: 'fa-skull',              color: 'hsl(0,50%,50%)' },
    treatment:     { icon: 'fa-syringe',            color: 'hsl(280,60%,65%)' },
    weight:        { icon: 'fa-weight-scale',       color: 'hsl(160,55%,50%)' },
    approval_decision: { icon: 'fa-user-shield',    color: 'var(--accent-gold)' },
    feed_missed:   { icon: 'fa-triangle-exclamation', color: 'hsl(0,75%,60%)' },
};

export default function ActivityFeed() {
    const { animals, events, treatments, weightLogs, staffUser, undoActivity } = useContext(FarmContext);
    const [filter, setFilter] = useState('all');
    const [tagSearch, setTagSearch] = useState('');

    const isAdmin = staffUser?.isAdmin === true;

    const getRfid = (animalId) => {
        // Pen-level events (e.g. 'feed_missed') aren't tied to a single animal.
        if (animalId === null || animalId === undefined) return null;
        const a = animals.find(a => a.id === animalId);
        return a ? a.rfid : `#${animalId}`;
    };

    // Merge all event sources into one timeline with user attribution and undo payload
    const allActivity = [
        ...events.map(e => ({
            key: `ev-${e.id}`,
            animalId: e.animalId,
            date: e.date,
            category: (e.eventType === 'registered' || e.eventType === 'status_change' || e.eventType === 'pen_transfer') ? 'status' : e.eventType,
            eventType: e.eventType,
            note: e.note,
            fromPen: e.fromPen,
            toPen: e.toPen,
            prevStatus: e.prevStatus,
            nextStatus: e.nextStatus,
            createdBy: e.createdBy || null,
            sortId: e.id
        })),
        ...treatments.map(t => ({
            key: `tx-${t.id}`,
            animalId: t.animalId,
            date: t.date,
            category: 'treatment',
            eventType: 'treatment',
            note: `${t.type}: ${t.medicine} ${t.dosage}${t.withholding > 0 ? ` — ${t.withholding}d withholding` : ''}`,
            createdBy: t.createdBy || null,
            sortId: t.id
        })),
        ...weightLogs.map(w => ({
            key: `wt-${w.id}`,
            animalId: w.animalId,
            date: w.date,
            category: 'weight',
            eventType: 'weight',
            note: `Weighed ${w.weight} kg${w.adg !== 0 ? ` (${w.adg > 0 ? '+' : ''}${w.adg} kg/d ADG)` : ''}`,
            createdBy: w.createdBy || null,
            sortId: w.id
        })),
    ].sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        return dateDiff !== 0 ? dateDiff : b.sortId - a.sortId;
    });

    const filtered = allActivity
        .filter(item => {
            if (filter === 'status') return item.category === 'status' || item.category === 'sold' || item.category === 'deceased';
            if (filter === 'treatments') return item.category === 'treatment';
            if (filter === 'weights') return item.category === 'weight';
            return true;
        })
        .filter(item => {
            if (!tagSearch.trim()) return true;
            return (getRfid(item.animalId) || '').toLowerCase().includes(tagSearch.trim().toLowerCase());
        })
        .slice(0, 150);

    return (
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexShrink: 0 }}>
                <h3 className="panel-title" style={{ marginBottom: 0 }}>
                    <i className="fa-solid fa-timeline"></i> Activity Log
                </h3>
                <input
                    type="text"
                    className="form-control"
                    style={{ width: '150px', minHeight: '34px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}
                    placeholder="Filter by tag..."
                    value={tagSearch}
                    onChange={e => setTagSearch(e.target.value)}
                />
            </div>

            <div className="table-filters" style={{ flexShrink: 0, marginBottom: '0.6rem' }}>
                <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
                <button className={`filter-btn ${filter === 'status' ? 'active' : ''}`} onClick={() => setFilter('status')}>Status & Moves</button>
                <button className={`filter-btn ${filter === 'treatments' ? 'active' : ''}`} onClick={() => setFilter('treatments')}>Treatments</button>
                <button className={`filter-btn ${filter === 'weights' ? 'active' : ''}`} onClick={() => setFilter('weights')}>Weights</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {filtered.map(item => {
                    const meta = EVENT_META[item.eventType] || { icon: 'fa-circle-dot', color: 'var(--text-muted)' };
                    const rfid = getRfid(item.animalId);
                    return (
                        <div key={item.key} style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', padding: '0.55rem 0.35rem', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <i className={`fa-solid ${meta.icon}`} style={{ color: meta.color, fontSize: '0.85rem', flexShrink: 0, width: '16px', textAlign: 'center' }}></i>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                                {rfid && <span style={{ fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)', fontSize: '0.88rem' }}>{rfid}</span>}
                                <span style={{ color: 'var(--text-main)', fontSize: '0.83rem' }}>{item.note}</span>
                                {item.createdBy && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-gold)', background: 'rgba(255,193,7,0.1)', padding: '0.1rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(255,193,7,0.2)', fontWeight: '600' }}>
                                        by {item.createdBy}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'var(--font-heading)', whiteSpace: 'nowrap' }}>{formatDate(item.date)}</span>
                                {isAdmin && item.eventType !== 'feed_missed' && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        style={{ padding: '0.15rem 0.45rem', minHeight: '26px', fontSize: '0.72rem', borderColor: 'rgba(220,53,69,0.3)', color: 'hsl(0,75%,70%)' }}
                                        onClick={() => {
                                            if (window.confirm(`Undo activity for ${rfid} (${item.note})?`)) {
                                                undoActivity(item);
                                            }
                                        }}
                                        title="Undo this activity"
                                    >
                                        <i className="fa-solid fa-rotate-left"></i> Undo
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
                {filtered.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                        <i className="fa-solid fa-timeline" style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem', opacity: 0.5 }}></i>
                        No activity recorded yet.
                    </div>
                )}
            </div>
        </div>
    );
}
