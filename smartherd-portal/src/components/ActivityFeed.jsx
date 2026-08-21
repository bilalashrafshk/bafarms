import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import FeedLogDetailModal from './FeedLogDetailModal';

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
    tag_replacement: { icon: 'fa-tags',             color: 'hsl(45,95%,55%)' },
};

export default function ActivityFeed() {
    const { animals, events, treatments, weightLogs, feedLogs, feedPurchases, feedStockIssues, feedStockItems, premixBatches, allApprovals, staffUser, undoActivity } = useContext(FarmContext);
    const [filter, setFilter] = useState('all');
    const [tagSearch, setTagSearch] = useState('');
    const [selectedFeedLog, setSelectedFeedLog] = useState(null);

    const isAdmin = staffUser?.isAdmin === true;

    const getRfid = (animalId) => {
        if (animalId === null || animalId === undefined) return null;
        const a = animals.find(a => a.id === animalId);
        return a ? a.rfid : `#${animalId}`;
    };

    const getLogTimestamp = (item) => {
        if (item.createdAt) {
            const parsed = Date.parse(item.createdAt);
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        if (typeof item.sortId === 'number' && !isNaN(item.sortId) && item.sortId > 1000000000000) {
            return item.sortId;
        }
        if (typeof item.key === 'string') {
            const match = item.key.match(/(\d{13})/);
            if (match) return parseInt(match[1], 10);
        }
        const d = item.date ? Date.parse(item.date) : 0;
        return !isNaN(d) ? d : 0;
    };

    const formatActivityTime = (item) => {
        const ts = getLogTimestamp(item);
        if (!ts || ts === 0 || ts < 1000000000000) return formatDate(item.date);
        const d = new Date(ts);
        const today = new Date();
        const isToday = d.toDateString() === today.toDateString();
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (isToday) return `Today at ${timeStr}`;
        return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
    };

    const parseFeedingSession = (log) => {
        if (!log) return 'Full Day (100%)';
        const total = log.numFeedings || 1;
        const pct = log.feedingPct !== undefined && log.feedingPct !== null ? Math.round(log.feedingPct) : (total > 1 ? Math.round(100 / total) : 100);

        let rawIdx = log.feedingIndex;
        if (rawIdx === undefined || rawIdx === null || rawIdx === 0) {
            if (total <= 1) return `Full Day (${pct}%)`;
            return `Morning (${pct}%)`;
        }

        let idx = rawIdx;
        if (rawIdx >= 1) {
            idx = rawIdx - 1;
        }

        if (total <= 1) return `Full Day (${pct}%)`;

        let name = '';
        if (total === 2) {
            name = idx === 0 ? 'Morning' : 'Evening';
        } else if (total === 3) {
            name = idx === 0 ? 'Morning' : idx === 1 ? 'Afternoon' : 'Evening';
        } else {
            name = `Feeding ${idx + 1} of ${total}`;
        }
        return `${name} (${pct}%)`;
    };

    // Merge all event sources into one timeline sorted strictly by WHEN the activity occurred / was logged
    const allActivity = [
        ...events.map(e => ({
            key: `ev-${e.id}`,
            animalId: e.animalId,
            pen: e.toPen || e.fromPen || null,
            date: e.date,
            createdAt: e.createdAt || e.date,
            category: (e.eventType === 'registered' || e.eventType === 'status_change' || e.eventType === 'pen_transfer' || e.eventType === 'tag_replacement') ? 'status' : e.eventType,
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
            createdAt: t.createdAt || t.date,
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
            createdAt: w.createdAt || w.date,
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
            createdAt: f.createdAt || f.date,
            category: 'feeds',
            eventType: 'feed_log',
            note: `Fed Pen ${f.pen || 'ALL'} — ${(f.totalBatchKg || 0).toLocaleString()} kg TMR (${f.animalCount || 0} head, ${parseFeedingSession(f)})`,
            createdBy: f.createdBy || null,
            originalLog: f,
            sortId: Date.parse(f.date) || 0
        })),
        ...(feedPurchases || []).map(p => {
            const itemObj = (feedStockItems || []).find(i => i.id === p.itemId);
            const itemName = p.itemName || (itemObj ? itemObj.name : p.itemId);
            return {
                key: `fp-${p.id}`,
                recordId: p.id,
                originalObj: p,
                animalId: null,
                pen: null,
                date: p.date,
                createdAt: p.createdAt || p.date,
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
                recordId: s.id,
                originalObj: s,
                animalId: null,
                pen: s.pen,
                date: s.date,
                createdAt: s.createdAt || s.date,
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
                recordId: app.id,
                approvalObj: app,
                animalId: app.animal_id || app.animalId || null,
                pen: null,
                date: dateStr,
                createdAt: app.reviewedAt || app.requestedAt || dateStr,
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
            createdAt: b.createdAt || b.date,
            category: 'feeds',
            eventType: 'feed_issue',
            note: `Premix Mixed: ${b.producedQtyKg?.toLocaleString() || 0} kg ${b.premixName || 'Premix'}`,
            createdBy: b.createdBy || null,
            sortId: Date.parse(b.date) || 0
        }))
    ].sort((a, b) => getLogTimestamp(b) - getLogTimestamp(a));

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
                    const isFeedLog = item.eventType === 'feed_log';
                    const opDate = formatDate(item.date);
                    const actionTimeStr = formatActivityTime(item);
                    const isRetro = item.date && actionTimeStr.indexOf(opDate) === -1;

                    return (
                        <div
                            key={item.key}
                            onClick={() => {
                                if (isFeedLog && item.originalLog) {
                                    setSelectedFeedLog(item.originalLog);
                                }
                            }}
                            style={{
                                display: 'flex', gap: '0.7rem', alignItems: 'center', padding: '0.65rem 0.5rem',
                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                                cursor: isFeedLog ? 'pointer' : 'default',
                                transition: 'background 0.15s ease'
                            }}
                            className={isFeedLog ? 'activity-feed-row-clickable' : ''}
                        >
                            <i className={`fa-solid ${meta.icon}`} style={{ color: meta.color, fontSize: '0.85rem', flexShrink: 0, width: '16px', textAlign: 'center' }}></i>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                                {rfid && <span style={{ fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)', fontSize: '0.88rem' }}>{rfid}</span>}
                                <span style={{ color: 'var(--text-main)', fontSize: '0.83rem' }}>{item.note}</span>
                                {item.createdBy && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-gold)', background: 'rgba(255,193,7,0.1)', padding: '0.1rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(255,193,7,0.2)', fontWeight: '600' }}>
                                        by {item.createdBy}
                                    </span>
                                )}
                                {isFeedLog && (
                                    <span style={{ fontSize: '0.68rem', color: 'var(--primary-green-light)', background: 'rgba(74, 222, 128, 0.1)', padding: '0.08rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
                                        <i className="fa-solid fa-up-right-from-square" style={{ fontSize: '0.6rem', marginRight: '3px' }}></i> View Breakdown
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem', flexShrink: 0 }}>
                                <span style={{ color: 'var(--text-pure)', fontSize: '0.78rem', fontFamily: 'var(--font-heading)', whiteSpace: 'nowrap', fontWeight: '600' }}>
                                    {actionTimeStr}
                                </span>
                                {isRetro && (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', opacity: 0.85 }}>
                                        For: {opDate}
                                    </span>
                                )}
                                {isAdmin && item.eventType !== 'feed_missed' && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        style={{ padding: '0.1rem 0.4rem', minHeight: '22px', fontSize: '0.68rem', borderColor: 'rgba(220,53,69,0.3)', color: 'hsl(0,75%,70%)', marginTop: '2px' }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (window.confirm(`Undo activity for ${rfid || item.note}?`)) {
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

            {/* Modal for detailed TMR feed log breakdown */}
            {selectedFeedLog && (
                <FeedLogDetailModal
                    feedLog={selectedFeedLog}
                    onClose={() => setSelectedFeedLog(null)}
                />
            )}
        </div>
    );
}
