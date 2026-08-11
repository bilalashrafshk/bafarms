import React, { useContext, useState, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { renderSettingsDiff } from '../utils/renderSettingsDiff';

export default function AdminApprovals() {
    const {
        pendingApprovals,
        approvePendingChange,
        rejectPendingChange,
        feedStockItems,
        staffUser
    } = useContext(FarmContext);

    const isSuperAdmin = staffUser?.isAdmin === true;

    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState('ALL');
    const [rejectingId, setRejectingId] = useState(null);
    const [rejectNote, setRejectNote] = useState('');
    const [processingId, setProcessingId] = useState(null);

    // Smart stock item name resolver — resolves raw item IDs (e.g. item_1786264181344)
    // to human names (e.g. "xuyz", "Silage") using:
    // 1) Explicit itemName attached to payload/snap
    // 2) Active feedStockItems array
    // 3) Other pending SAVE_SETTINGS in the approvals queue (so brand new items created in the same session resolve instantly)
    const resolveStockItemName = (id, payload, snap) => {
        if (payload?.itemName) return payload.itemName;
        if (snap?.itemName) return snap.itemName;
        const known = (feedStockItems || []).find(i => i.id === id);
        if (known?.name) return known.name;

        // Inspect pending SAVE_SETTINGS for feed_stock_items in pendingApprovals queue
        for (const app of (pendingApprovals || [])) {
            if (app.action === 'SAVE_SETTINGS' && app.payload?.key === 'feed_stock_items' && Array.isArray(app.payload?.value)) {
                const foundInPending = app.payload.value.find(i => i.id === id);
                if (foundInPending?.name) return foundInPending.name;
            }
        }
        return id || '—';
    };

    const resolveStockItemUnit = (id, payload, snap) => {
        if (payload?.itemUnit) return payload.itemUnit;
        if (snap?.itemUnit) return snap.itemUnit;
        const known = (feedStockItems || []).find(i => i.id === id);
        if (known?.unit) return known.unit;

        for (const app of (pendingApprovals || [])) {
            if (app.action === 'SAVE_SETTINGS' && app.payload?.key === 'feed_stock_items' && Array.isArray(app.payload?.value)) {
                const foundInPending = app.payload.value.find(i => i.id === id);
                if (foundInPending?.unit) return foundInPending.unit;
            }
        }
        return 'kg';
    };

    const handleApprove = async (approval) => {
        setProcessingId(approval.id);
        const result = await approvePendingChange(approval);
        setProcessingId(null);
        if (!result.success) alert(result.error || 'Could not approve request.');
    };

    const handleReject = async (approvalId) => {
        setProcessingId(approvalId);
        const result = await rejectPendingChange(approvalId, rejectNote.trim() || null);
        setProcessingId(null);
        setRejectingId(null);
        setRejectNote('');
        if (!result.success) alert(result.error || 'Could not reject request.');
    };

    const filteredApprovals = useMemo(() => {
        return (pendingApprovals || []).filter(item => {
            if (actionFilter !== 'ALL') {
                if (actionFilter === 'PURCHASES' && item.action !== 'ADD_FEED_PURCHASE' && item.action !== 'DELETE_FEED_PURCHASE') return false;
                if (actionFilter === 'ISSUES' && item.action !== 'ADD_FEED_STOCK_ISSUE' && item.action !== 'DELETE_FEED_STOCK_ISSUE') return false;
                if (actionFilter === 'EXPENSES' && item.action !== 'ADD_OVERHEAD_EXPENSE' && item.action !== 'DELETE_OVERHEAD_EXPENSE') return false;
                if (actionFilter === 'SETTINGS' && item.action !== 'SAVE_SETTINGS') return false;
                if (actionFilter === 'DELETIONS' && !item.action.startsWith('DELETE_')) return false;
            }
            if (!searchTerm.trim()) return true;
            const term = searchTerm.toLowerCase();
            const requestedBy = (item.requestedBy || '').toLowerCase();
            const action = (item.action || '').toLowerCase();
            const payloadStr = JSON.stringify(item.payload || {}).toLowerCase();
            return requestedBy.includes(term) || action.includes(term) || payloadStr.includes(term);
        });
    }, [pendingApprovals, actionFilter, searchTerm]);

    if (!isSuperAdmin) {
        return (
            <div class="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                <i class="fa-solid fa-lock" style={{ fontSize: '2.5rem', color: 'var(--accent-gold)', marginBottom: '1rem' }}></i>
                <h3>Super Admin Access Restricted</h3>
                <p style={{ color: 'var(--text-muted)' }}>The staff approval queue is accessible exclusively to Super Admin accounts.</p>
            </div>
        );
    }

    return (
        <div className="admin-approvals-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Header Controls Banner */}
            <div class="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'rgba(255,193,7,0.15)', border: '1px solid var(--accent-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i class="fa-solid fa-user-shield" style={{ fontSize: '1.2rem', color: 'var(--accent-gold)' }}></i>
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-pure)' }}>
                            Staff Requests &amp; Pending Approvals
                        </h2>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                            Review and authorize sensitive actions, feed entries, overhead expenses, and configuration changes.
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', width: '220px' }}>
                        <i class="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.8rem' }}></i>
                        <input
                            type="text"
                            class="form-control"
                            placeholder="Search requests..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ paddingLeft: '2.2rem', fontSize: '0.8rem', height: '36px' }}
                        />
                    </div>

                    <select
                        class="form-control"
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                        style={{ fontSize: '0.8rem', height: '36px', width: '160px' }}
                    >
                        <option value="ALL">All Actions</option>
                        <option value="PURCHASES">Feed Purchases</option>
                        <option value="ISSUES">Stock Issues</option>
                        <option value="EXPENSES">Overhead Expenses</option>
                        <option value="SETTINGS">Setting Changes</option>
                        <option value="DELETIONS">Deletions Only</option>
                    </select>

                    <div style={{ background: 'rgba(255,193,7,0.15)', color: 'hsl(43,90%,53%)', padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '700', border: '1px solid rgba(255,193,7,0.3)' }}>
                        {pendingApprovals.length} Pending
                    </div>
                </div>
            </div>

            {/* Approvals Data Table */}
            <div class="glass-panel" style={{ padding: '1.25rem' }}>
                {pendingApprovals.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                        <i class="fa-solid fa-circle-check" style={{ fontSize: '3rem', color: 'var(--primary-green-light)', marginBottom: '1rem', display: 'block' }}></i>
                        <h4 style={{ color: 'var(--text-pure)', marginBottom: '0.4rem' }}>No Requests Awaiting Approval</h4>
                        <p style={{ fontSize: '0.85rem' }}>All non-admin staff submissions and sensitive edits have been reviewed and approved.</p>
                    </div>
                ) : filteredApprovals.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                        <p>No pending approvals match your search filter.</p>
                    </div>
                ) : (
                    <div class="table-wrapper" style={{ overflowX: 'auto' }}>
                        <table class="data-table" style={{ fontSize: '0.85rem', width: '100%', minWidth: '900px' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '170px' }}>ACTION / TYPE</th>
                                    <th style={{ width: '190px' }}>REQUESTED BY &amp; DATE</th>
                                    <th style={{ width: '160px' }}>TARGET / ITEM</th>
                                    <th>DETAILS &amp; IMPACT</th>
                                    <th style={{ textAlign: 'center', width: '190px' }}>DECISION</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredApprovals.map(item => {
                                    const snap = item.previousSnapshot || {};
                                    const payload = item.payload || {};

                                    const actionBadge = (() => {
                                        switch (item.action) {
                                            case 'ADD_FEED_PURCHASE':
                                                return <span class="badge" style={{ background: 'rgba(40,167,69,0.15)', color: 'var(--primary-green-light)', border: '1px solid rgba(40,167,69,0.3)' }}><i class="fa-solid fa-plus-circle"></i> Add Feed Purchase</span>;
                                            case 'UPDATE_FEED_PURCHASE':
                                                return <span class="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i class="fa-solid fa-pen-to-square"></i> Edit Feed Purchase</span>;
                                            case 'ADD_FEED_STOCK_ISSUE':
                                                return <span class="badge" style={{ background: 'rgba(74,144,217,0.15)', color: '#4a90d9', border: '1px solid rgba(74,144,217,0.3)' }}><i class="fa-solid fa-dolly"></i> Add Stock Issue</span>;
                                            case 'ADD_OVERHEAD_EXPENSE':
                                                return <span class="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i class="fa-solid fa-receipt"></i> Add Expense</span>;
                                            case 'SAVE_SETTINGS':
                                                return <span class="badge" style={{ background: 'rgba(111,66,193,0.15)', color: '#a370f7', border: '1px solid rgba(111,66,193,0.3)' }}><i class="fa-solid fa-sliders"></i> Master Setting Change</span>;
                                            case 'UPDATE_ANIMAL':
                                                return <span class="badge" style={{ background: 'rgba(23,162,184,0.15)', color: '#17a2b8', border: '1px solid rgba(23,162,184,0.3)' }}><i class="fa-solid fa-pen-to-square"></i> Edit Animal</span>;
                                            case 'RECORD_DEATH':
                                                return <span class="badge" style={{ background: 'rgba(108,117,125,0.15)', color: '#adb5bd', border: '1px solid rgba(108,117,125,0.3)' }}><i class="fa-solid fa-skull"></i> Record Death</span>;
                                            case 'RECORD_SALE':
                                                return <span class="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i class="fa-solid fa-handshake"></i> Record Sale</span>;
                                            case 'OVERWRITE_FEED_LOG':
                                                return <span class="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i class="fa-solid fa-rotate"></i> Overwrite Feed Log</span>;
                                            default:
                                                if (item.action.startsWith('DELETE_')) {
                                                    return <span class="badge" style={{ background: 'rgba(220,53,69,0.15)', color: 'hsl(0,75%,65%)', border: '1px solid rgba(220,53,69,0.3)' }}><i class="fa-solid fa-trash-can"></i> {item.action.replace('DELETE_', 'Delete ')}</span>;
                                                }
                                                return <span class="badge" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-pure)' }}>{item.action}</span>;
                                        }
                                    })();

                                    const targetName = (() => {
                                        switch (item.action) {
                                            case 'ADD_FEED_PURCHASE':
                                            case 'DELETE_FEED_PURCHASE':
                                                return resolveStockItemName(payload.itemId || snap.itemId, payload, snap);
                                            case 'ADD_FEED_STOCK_ISSUE':
                                            case 'DELETE_FEED_STOCK_ISSUE':
                                                return resolveStockItemName(payload.itemId || snap.itemId, payload, snap);
                                            case 'ADD_OVERHEAD_EXPENSE':
                                            case 'DELETE_OVERHEAD_EXPENSE':
                                                return payload.category || snap.category || 'Overhead Expense';
                                            case 'SAVE_SETTINGS':
                                                return payload.key || 'Setting';
                                            case 'DELETE_ANIMAL':
                                            case 'UPDATE_ANIMAL':
                                            case 'RECORD_DEATH':
                                            case 'RECORD_SALE':
                                            case 'DELETE_WEIGHT_LOG':
                                            case 'UPDATE_WEIGHT_LOGS_BATCH':
                                            case 'DELETE_TREATMENT':
                                                return `${item.animalRfid || 'Animal #' + item.animalId}${item.animalBreed ? ' (' + item.animalBreed + ')' : ''}`;
                                            default:
                                                return snap.title || snap.name || payload.title || payload.id || 'Record';
                                        }
                                    })();

                                    return (
                                        <tr key={item.id}>
                                            <td>{actionBadge}</td>
                                            <td>
                                                <div style={{ fontWeight: '600', color: 'var(--text-pure)', fontSize: '0.82rem' }}>{item.requestedBy}</div>
                                                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{formatDate(item.requestedAt)}</div>
                                            </td>
                                            <td style={{ fontWeight: '700', color: 'var(--accent-gold)' }}>
                                                {targetName}
                                            </td>
                                            <td>
                                                {(() => {
                                                    try {
                                                        switch (item.action) {
                                                            case 'ADD_FEED_PURCHASE': {
                                                                const unit = resolveStockItemUnit(payload?.itemId, payload, snap);
                                                                const qty = Number(payload?.quantity) || 0;
                                                                const rate = Number(payload?.rate) || 0;
                                                                const total = Math.round(qty * rate);
                                                                return (
                                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-pure)' }}>
                                                                        <strong>{qty} {unit}</strong> @ <strong>PKR {rate.toLocaleString()}/{unit}</strong> = <strong style={{ color: 'var(--accent-gold)' }}>PKR {total.toLocaleString()}</strong>
                                                                        {payload?.supplier && <span> · Supplier: <em>{payload.supplier}</em></span>}
                                                                        {payload?.notes && <span> · Notes: {payload.notes}</span>}
                                                                    </div>
                                                                );
                                                            }
                                                            case 'UPDATE_FEED_PURCHASE': {
                                                                const oldQty = Number(snap?.quantity) || 0;
                                                                const newQty = Number(payload?.quantity) || 0;
                                                                const oldRate = Number(snap?.rate) || 0;
                                                                const newRate = Number(payload?.rate) || 0;
                                                                const oldName = snap?.itemName || resolveStockItemName(snap?.itemId, payload, snap);
                                                                const newName = payload?.itemName || resolveStockItemName(payload?.itemId, payload, snap);
                                                                return (
                                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-pure)' }}>
                                                                        Item: <strong>{oldName}</strong> → <strong style={{ color: 'var(--accent-gold)' }}>{newName}</strong> {payload?.category ? `(${payload.category})` : ''}<br/>
                                                                        Qty: {oldQty} → <strong style={{ color: 'var(--accent-gold)' }}>{newQty} {payload?.unit || payload?.itemUnit || 'kg'}</strong> ·
                                                                        Rate: PKR {oldRate} → <strong style={{ color: 'var(--accent-gold)' }}>PKR {newRate}</strong>
                                                                        {payload?.supplier && <span> · Supplier: {payload.supplier}</span>}
                                                                    </div>
                                                                );
                                                            }
                                                            case 'ADD_FEED_STOCK_ISSUE': {
                                                                const unit = resolveStockItemUnit(payload?.itemId, payload, snap);
                                                                const qty = Number(payload?.quantity) || 0;
                                                                return (
                                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-pure)' }}>
                                                                        Issued <strong>{qty} {unit}</strong> to <strong>Pen {payload?.pen || 'ALL'}</strong>
                                                                        {payload?.notes && <span> · Notes: {payload.notes}</span>}
                                                                    </div>
                                                                );
                                                            }
                                                            case 'ADD_OVERHEAD_EXPENSE': {
                                                                const amt = Number(payload?.amount) || 0;
                                                                return (
                                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-pure)' }}>
                                                                        Category: <strong>{payload?.category || '—'}</strong> · Amount: <strong style={{ color: 'var(--accent-gold)' }}>PKR {Math.round(amt).toLocaleString()}</strong>
                                                                        {payload?.description && <span> · {payload.description}</span>}
                                                                    </div>
                                                                );
                                                            }
                                                            case 'SAVE_SETTINGS':
                                                                return renderSettingsDiff(payload?.key, payload?.value, snap);
                                                            case 'UPDATE_ANIMAL':
                                                                return (
                                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                                        {payload?.entryWeight !== undefined && (
                                                                            <div>Entry Weight: <strong style={{ color: 'var(--text-pure)' }}>{snap?.entryWeight || '—'}</strong> → <strong style={{ color: 'var(--accent-gold)' }}>{payload.entryWeight}</strong> kg</div>
                                                                        )}
                                                                        {payload?.purchasePrice !== undefined && (
                                                                            <div>Purchase Price: <strong style={{ color: 'var(--text-pure)' }}>{(Number(snap?.purchasePrice) || 0).toLocaleString()}</strong> → <strong style={{ color: 'var(--accent-gold)' }}>{(Number(payload.purchasePrice) || 0).toLocaleString()}</strong> PKR</div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            case 'RECORD_DEATH':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Deceased Date: {payload?.deceasedDate || '—'} · Cause: {payload?.deceasedCause || 'N/A'}</div>;
                                                            case 'RECORD_SALE':
                                                                return <div style={{ fontSize: '0.78rem', color: 'var(--accent-gold)' }}>Buyer: {payload?.buyerName || 'N/A'} · Sale Price: PKR {(Number(payload?.salePrice) || 0).toLocaleString()} · Sale Date: {payload?.saleDate || '—'}</div>;
                                                            case 'DELETE_ANIMAL':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Permanently remove animal and all logs/history.</div>;
                                                            case 'DELETE_FEED_PURCHASE':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Date: {snap?.date || payload?.date || '—'} · Qty: {Number(snap?.quantity || payload?.quantity) || 0} kg · Supplier: {snap?.supplier || payload?.supplier || 'N/A'} · Rate: PKR {Number(snap?.rate || payload?.rate) || 0}</div>;
                                                            case 'DELETE_FEED_STOCK_ISSUE':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Date: {snap?.date || payload?.date || '—'} · Qty: {Number(snap?.quantity || payload?.quantity) || 0} kg · Pen: {snap?.pen || payload?.pen || 'ALL'}</div>;
                                                            case 'DELETE_OVERHEAD_EXPENSE':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Amount: PKR {(Number(snap?.amount || payload?.amount) || 0).toLocaleString()} · Category: {snap?.category || payload?.category || '—'} · Date: {snap?.date || payload?.date || '—'}</div>;
                                                            case 'DELETE_WEIGHT_LOG':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Weight log on {snap?.date || payload?.date}: {snap?.weight || payload?.weight} kg (ADG: {(Number(snap?.adg || payload?.adg) || 0).toFixed(2)} kg/day)</div>;
                                                            case 'DELETE_TREATMENT':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Treatment on {snap?.date || payload?.date}: {snap?.medicine || snap?.type || payload?.medicine || payload?.type} (Dosage: {snap?.dosage || payload?.dosage || '—'})</div>;
                                                            case 'DELETE_FEED_LOG':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Feed log for {snap?.date || payload?.date} (Pen {snap?.pen || payload?.pen || 'ALL'})</div>;
                                                            case 'OVERWRITE_FEED_LOG': {
                                                                const oldKg = Number(snap ? (snap.total_batch_kg || snap.totalBatchKg || 0) : 0) || 0;
                                                                const newKg = Number(payload?.totalBatchKg || payload?.total_batch_kg || 0) || 0;
                                                                return (
                                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-pure)' }}>
                                                                        Date: {payload?.date || snap?.date} · Pen: {payload?.pen || snap?.pen || 'ALL'} · Total Batch: <strong>{oldKg.toFixed(2)} kg</strong> → <strong style={{ color: 'var(--accent-gold)' }}>{newKg.toFixed(2)} kg</strong>
                                                                    </div>
                                                                );
                                                            }
                                                            case 'DELETE_RATION_PLAN':
                                                            case 'DELETE_RATION_PLAN_V2':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Plan name: {snap?.name || payload?.name || payload?.id}</div>;
                                                            case 'DELETE_PEN':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Pen ID: {snap?.id || payload?.id}</div>;
                                                            default:
                                                                return <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Action: {item.action}</div>;
                                                        }
                                                    } catch (err) {
                                                        return <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Action: {item.action}</div>;
                                                    }
                                                })()}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {processingId === item.id ? (
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--accent-gold)' }}>
                                                        <i class="fa-solid fa-spinner fa-spin"></i> Processing...
                                                    </span>
                                                ) : rejectingId === item.id ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
                                                        <input
                                                            type="text"
                                                            class="form-control"
                                                            placeholder="Reason for rejecting (optional)"
                                                            value={rejectNote}
                                                            onChange={(e) => setRejectNote(e.target.value)}
                                                            autoFocus
                                                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
                                                        />
                                                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                                            <button class="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }} onClick={() => { setRejectingId(null); setRejectNote(''); }}>Cancel</button>
                                                            <button class="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', borderColor: 'rgba(220, 53, 69, 0.4)', color: 'hsl(0, 75%, 65%)' }} onClick={() => handleReject(item.id)}>Confirm</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                                        <button class="btn btn-primary btn-sm" style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }} onClick={() => handleApprove(item)}>
                                                            <i className="fa-solid fa-check"></i> Approve
                                                        </button>
                                                        <button class="btn btn-secondary btn-sm" style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem', color: 'hsl(0, 75%, 65%)', borderColor: 'rgba(220, 53, 69, 0.3)' }} onClick={() => setRejectingId(item.id)}>
                                                            <i className="fa-solid fa-xmark"></i> Reject
                                                        </button>
                                                    </div>
                                                )}
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
