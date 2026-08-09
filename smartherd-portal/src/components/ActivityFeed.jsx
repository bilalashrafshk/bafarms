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
    feed_log:      { icon: 'fa-wheat-awn',          color: 'hsl(140,65%,55%)' },
    feed_purchase: { icon: 'fa-cart-shopping',     color: 'hsl(210,75%,60%)' },
    feed_issue:    { icon: 'fa-boxes-packing',      color: 'hsl(30,80%,55%)' },
};

export default function ActivityFeed() {
    const { animals, events, treatments, weightLogs, feedLogs, feedPurchases, feedStockIssues, feedStockItems, premixBatches, allApprovals, staffUser, undoActivity } = useContext(FarmContext);
    const [filter, setFilter] = useState('all');
    const [tagSearch, setTagSearch] = useState('');

    const isAdmin = staffUser?.isAdmin === true;

    const getRfid = (animalId) => {
        // Pen-level events (e.g. 'feed_missed') aren't tied to a single animal.
        if (animalId === null || animalId === undefined) return null;
        const a = animals.find(a => a.id === animalId);
        return a ? a.rfid : `#${animalId}`;
    };

    const getSortTimestamp = (item) => {
        if (typeof item.sortId === 'number' && !isNaN(item.sortId)) return item.sortId;
        const d = item.date ? Date.parse(item.date) : 0;
        return !isNaN(d) ? d : 0;
    };

    // Merge all event sources into one timeline with user attribution and undo payload
    const allActivity = [
        ...events.map(e => ({
            key: `ev-${e.id}`,
            animalId: e.animalId,
            pen: e.toPen || e.fromPen || null,
            date: e.date,
            category: (e.eventType === 'registered' || e.eventType === 'status_change' || e.eventType === 'pen_transfer') ? 'status' : e.eventType,
            eventType: e.eventType,
            note: e.note,
            fromPen: e.fromPen,
            toPen: e.toPen,
            prevStatus: e.prevStatus,
            nextStatus: e.nextStatus,
            createdBy: e.createdBy || null,
            sortId: typeof e.id === 'number' ? e.id : (Date.parse(e.date) || 0)
        })),
        ...treatments.map(t => ({
            key: `tx-${t.id}`,
            animalId: t.animalId,
            pen: null,
            date: t.date,
            category: 'treatment',
            eventType: 'treatment',
            note: `${t.type}: ${t.medicine} ${t.dosage}${t.withholding > 0 ? ` — ${t.withholding}d withholding` : ''}`,
            createdBy: t.createdBy || null,
            sortId: typeof t.id === 'number' ? t.id : (Date.parse(t.date) || 0)
        })),
        ...weightLogs.map(w => ({
            key: `wt-${w.id}`,
            animalId: w.animalId,
            pen: null,
            date: w.date,
            category: 'weight',
            eventType: 'weight',
            note: `Weighed ${w.weight} kg${w.adg !== 0 ? ` (${w.adg > 0 ? '+' : ''}${w.adg} kg/d ADG)` : ''}`,
            createdBy: w.createdBy || null,
            sortId: typeof w.id === 'number' ? w.id : (Date.parse(w.date) || 0)
        })),
        ...(feedLogs || []).map(f => ({
            key: `fl-${f.id || (f.date + '-' + f.pen + '-' + (f.feedingIndex || 0))}`,
            animalId: null,
            pen: f.pen,
            date: f.date,
            category: 'feeds',
            eventType: 'feed_log',
            note: `Fed Pen ${f.pen || 'ALL'} — ${(f.totalBatchKg || 0).toLocaleString()} kg TMR (${f.animalCount || 0} head${f.feedingIndex !== undefined ? `, Feeding #${(f.feedingIndex || 0) + 1}` : ''})`,
            createdBy: f.createdBy || null,
            sortId: Date.parse(f.date) || 0
        })),
        ...(feedPurchases || []).map(p => {
            const itemObj = (feedStockItems || []).find(i => i.id === p.itemId);
            const itemName = p.itemName || (itemObj ? itemObj.name : p.itemId);
            return {
                key: `fp-${p.id}`,
                animalId: null,
                pen: null,
                date: p.date,
                category: 'feeds',
                eventType: 'feed_purchase',
                note: `Purchased ${p.quantity?.toLocaleString() || 0} kg ${itemName} @ PKR ${p.rate || 0}/kg${p.supplier ? ` (${p.supplier})` : ''}`,
                createdBy: p.createdBy || null,
                sortId: Date.parse(p.date) || 0
            };
        }),
        ...(feedStockIssues || []).map(s => {
            const itemObj = (feedStockItems || []).find(i => i.id === s.itemId);
            const itemName = s.itemName || (itemObj ? itemObj.name : s.itemId);
            return {
                key: `fi-${s.id}`,
                animalId: null,
                pen: s.pen,
                date: s.date,
                category: 'feeds',
                eventType: 'feed_issue',
                note: `Feed Issue: ${s.quantity?.toLocaleString() || 0} kg ${itemName} to Pen ${s.pen || 'ALL'}${s.notes ? ` (${s.notes})` : ''}`,
                createdBy: s.createdBy || null,
                sortId: Date.parse(s.date) || 0
            };
        }),
        ...(allApprovals || []).map(app => {
            const dateStr = (app.reviewedAt || app.requestedAt || '').split('T')[0] || new Date().toISOString().split('T')[0];
            const actionText = (app.action || '').replace(/_/g, ' ');
            const targetName = app.payload?.itemName || (app.payload?.newItem ? app.payload.newItem.name : null) || app.payload?.id || '';
            const statusTag = (app.status || 'PENDING').toUpperCase();
            return {
                key: `app-${app.id}`,
                animalId: app.animal_id || app.animalId || null,
                pen: null,
                date: dateStr,
                category: 'status',
                eventType: 'approval_decision',
                note: `Staff Approval [${statusTag}]: ${actionText}${targetName ? ` (${targetName})` : ''} by ${app.requestedBy || 'Staff'}${app.reviewedBy ? ` — Reviewed by ${app.reviewedBy}` : ''}`,
                createdBy: app.reviewedBy || app.requestedBy || null,
                sortId: Date.parse(dateStr) || 0
            };
        }),
        ...(premixBatches || []).map(b => ({
            key: `pb-${b.id}`,
            animalId: null,
            pen: null,
            date: b.date,
            category: 'feeds',
            eventType: 'feed_issue',
            note: `Premix Mixed: ${b.producedQtyKg?.toLocaleString() || 0} kg ${b.premixName || 'Premix'}`,
            createdBy: b.createdBy || null,
            sortId: Date.parse(b.date) || 0
        }))
    ].sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        return getSortTimestamp(b) - getSortTimestamp(a);
    });

    const filtered = allActivity
        .filter(item => {
            if (filter === 'status') return item.category === 'status' || item.category === 'sold' || item.category === 'deceased';
            if (filter === 'treatments') return item.category === 'treatment';
            if (filter === 'weights') return item.category === 'weight';
            if (filter === 'feeds') return item.category === 'feeds' || item.eventType === 'feed_missed';
            return true;
        })
        .filter(item => {
            if (!tagSearch.trim()) return true;
            const query = tagSearch.trim().toLowerCase();
            const rfid = (getRfid(item.animalId) || '').toLowerCase();
            const note = (item.note || '').toLowerCase();
            const pen = (item.pen || '').toLowerCase();
            return rfid.includes(query) || note.includes(query) || pen.includes(query);
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
                <button className={`filter-btn ${filter === 'feeds' ? 'active' : ''}`} onClick={() => setFilter('feeds')}>Feeds</button>
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
