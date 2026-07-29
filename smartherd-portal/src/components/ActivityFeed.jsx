import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

const EVENT_META = {
    registered:    { icon: 'fa-plus-circle',        color: 'var(--accent-gold)' },
    status_change: { icon: 'fa-arrow-right-arrow-left', color: 'hsl(200,70%,60%)' },
    sold:          { icon: 'fa-money-bill-transfer', color: 'var(--primary-green-light)' },
    deceased:      { icon: 'fa-skull',              color: 'hsl(0,50%,50%)' },
    treatment:     { icon: 'fa-syringe',            color: 'hsl(280,60%,65%)' },
    weight:        { icon: 'fa-weight-scale',       color: 'hsl(160,55%,50%)' },
    approval_decision: { icon: 'fa-user-shield',    color: 'var(--accent-gold)' },
};

export default function ActivityFeed() {
    const { animals, events, treatments, weightLogs } = useContext(FarmContext);
    const [filter, setFilter] = useState('all');
    const [tagSearch, setTagSearch] = useState('');

    const getRfid = (animalId) => {
        const a = animals.find(a => a.id === animalId);
        return a ? a.rfid : `#${animalId}`;
    };

    // Merge all event sources into one timeline
    const allActivity = [
        ...events.map(e => ({
            key: `ev-${e.id}`,
            animalId: e.animalId,
            date: e.date,
            category: e.eventType === 'registered' ? 'status' : e.eventType === 'status_change' ? 'status' : e.eventType,
            eventType: e.eventType,
            note: e.note,
            sortId: e.id
        })),
        ...treatments.map(t => ({
            key: `tx-${t.id}`,
            animalId: t.animalId,
            date: t.date,
            category: 'treatment',
            eventType: 'treatment',
            note: `${t.type}: ${t.medicine} ${t.dosage}${t.withholding > 0 ? ` — ${t.withholding}d withholding` : ''}`,
            sortId: t.id
        })),
        ...weightLogs.map(w => ({
            key: `wt-${w.id}`,
            animalId: w.animalId,
            date: w.date,
            category: 'weight',
            eventType: 'weight',
            note: `Weighed ${w.weight} kg${w.adg !== 0 ? ` (${w.adg > 0 ? '+' : ''}${w.adg} kg/d ADG)` : ''}`,
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
            return getRfid(item.animalId).toLowerCase().includes(tagSearch.trim().toLowerCase());
        })
        .slice(0, 150);

    return (
        <div class="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexShrink: 0 }}>
                <h3 class="panel-title" style={{ marginBottom: 0 }}>
                    <i class="fa-solid fa-timeline"></i> Activity Log
                </h3>
                <input
                    type="text"
                    class="form-control"
                    style={{ width: '150px', minHeight: '34px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}
                    placeholder="Filter by tag..."
                    value={tagSearch}
                    onChange={e => setTagSearch(e.target.value)}
                />
            </div>

            <div class="table-filters" style={{ flexShrink: 0, marginBottom: '0.6rem' }}>
                <button class={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
                <button class={`filter-btn ${filter === 'status' ? 'active' : ''}`} onClick={() => setFilter('status')}>Status</button>
                <button class={`filter-btn ${filter === 'treatments' ? 'active' : ''}`} onClick={() => setFilter('treatments')}>Treatments</button>
                <button class={`filter-btn ${filter === 'weights' ? 'active' : ''}`} onClick={() => setFilter('weights')}>Weights</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {filtered.map(item => {
                    const meta = EVENT_META[item.eventType] || { icon: 'fa-circle-dot', color: 'var(--text-muted)' };
                    const rfid = getRfid(item.animalId);
                    return (
                        <div key={item.key} style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start', padding: '0.5rem 0.25rem', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                            <i class={`fa-solid ${meta.icon}`} style={{ color: meta.color, fontSize: '0.82rem', marginTop: '0.2rem', flexShrink: 0, width: '14px', textAlign: 'center' }}></i>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)', fontSize: '0.88rem', marginRight: '0.5rem' }}>{rfid}</span>
                                <span style={{ color: 'var(--text-main)', fontSize: '0.83rem' }}>{item.note}</span>
                            </div>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0, fontFamily: 'var(--font-heading)', whiteSpace: 'nowrap' }}>{formatDate(item.date)}</span>
                        </div>
                    );
                })}
                {filtered.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                        <i class="fa-solid fa-timeline" style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem', opacity: 0.5 }}></i>
                        No activity recorded yet.
                    </div>
                )}
            </div>
        </div>
    );
}
