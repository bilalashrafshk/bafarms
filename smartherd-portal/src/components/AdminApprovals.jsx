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
        staffUser,
        aiRequireApproval,
        updateAiRequireApproval
    } = useContext(FarmContext);

    const isSuperAdmin = staffUser?.isAdmin === true;

    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState('ALL');
    const [rejectingId, setRejectingId] = useState(null);
    const [rejectNote, setRejectNote] = useState('');
    const [processingId, setProcessingId] = useState(null);

    // Bulk selection state
    const [selectedIds, setSelectedIds] = useState([]);
    const [isBulkRejectModalOpen, setIsBulkRejectModalOpen] = useState(false);
    const [bulkRejectNote, setBulkRejectNote] = useState('');
    const [bulkProgress, setBulkProgress] = useState(null); // { current: number, total: number, action: 'approving' | 'rejecting' }

    // Smart stock item name resolver
    const resolveStockItemName = (id, payload, snap) => {
        if (payload?.itemName) return payload.itemName;
        if (snap?.itemName) return snap.itemName;
        const known = (feedStockItems || []).find(i => i.id === id);
        if (known?.name) return known.name;

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

    const filteredApprovals = useMemo(() => {
        return (pendingApprovals || []).filter(item => {
            if (actionFilter !== 'ALL') {
                if (actionFilter === 'PURCHASES' && item.action !== 'ADD_FEED_PURCHASE' && item.action !== 'DELETE_FEED_PURCHASE') return false;
                if (actionFilter === 'ISSUES' && item.action !== 'ADD_FEED_STOCK_ISSUE' && item.action !== 'DELETE_FEED_STOCK_ISSUE') return false;
                if (actionFilter === 'EXPENSES' && item.action !== 'ADD_OVERHEAD_EXPENSE' && item.action !== 'DELETE_OVERHEAD_EXPENSE') return false;
                if (actionFilter === 'SETTINGS' && item.action !== 'SAVE_SETTINGS') return false;
                if (actionFilter === 'WEIGHTS' && item.action !== 'LOG_WEIGHT' && item.action !== 'DELETE_WEIGHT_LOG' && item.action !== 'UPDATE_WEIGHT_LOGS_BATCH') return false;
                if (actionFilter === 'FEED' && item.action !== 'ADD_FEED_LOG' && item.action !== 'OVERWRITE_FEED_LOG' && item.action !== 'DELETE_FEED_LOG') return false;
                if (actionFilter === 'TREATMENTS' && item.action !== 'LOG_TREATMENT' && item.action !== 'DELETE_TREATMENT') return false;
                if (actionFilter === 'AI_ONLY' && !String(item.requestedBy || '').toLowerCase().includes('api:') && !String(item.requestedBy || '').toLowerCase().includes('spark') && !String(item.requestedBy || '').toLowerCase().includes('ai')) return false;
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

    // Clean up selectedIds if items are no longer pending
    const currentSelectedIds = useMemo(() => {
        const pendingIdSet = new Set((pendingApprovals || []).map(p => p.id));
        return selectedIds.filter(id => pendingIdSet.has(id));
    }, [selectedIds, pendingApprovals]);

    const isAllFilteredSelected = filteredApprovals.length > 0 && filteredApprovals.every(item => currentSelectedIds.includes(item.id));
    const isSomeFilteredSelected = filteredApprovals.some(item => currentSelectedIds.includes(item.id)) && !isAllFilteredSelected;

    const handleToggleSelectAll = () => {
        if (isAllFilteredSelected) {
            const filteredSet = new Set(filteredApprovals.map(i => i.id));
            setSelectedIds(prev => prev.filter(id => !filteredSet.has(id)));
        } else {
            const filteredSet = new Set(filteredApprovals.map(i => i.id));
            setSelectedIds(prev => Array.from(new Set([...prev, ...filteredApprovals.map(i => i.id)])));
        }
    };

    const handleToggleSelect = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const handleClearSelection = () => {
        setSelectedIds([]);
    };

    const handleApprove = async (approval) => {
        setProcessingId(approval.id);
        const result = await approvePendingChange(approval);
        setProcessingId(null);
        setSelectedIds(prev => prev.filter(x => x !== approval.id));
        if (!result.success) alert(result.error || 'Could not approve request.');
    };

    const handleReject = async (approvalId) => {
        setProcessingId(approvalId);
        const result = await rejectPendingChange(approvalId, rejectNote.trim() || null);
        setProcessingId(null);
        setRejectingId(null);
        setRejectNote('');
        setSelectedIds(prev => prev.filter(x => x !== approvalId));
        if (!result.success) alert(result.error || 'Could not reject request.');
    };

    // Bulk Approve
    const handleBulkApprove = async () => {
        if (currentSelectedIds.length === 0) return;
        const confirmMsg = `Are you sure you want to approve ${currentSelectedIds.length} selected request${currentSelectedIds.length === 1 ? '' : 's'}?`;
        if (!window.confirm(confirmMsg)) return;

        const approvalsToProcess = (pendingApprovals || []).filter(a => currentSelectedIds.includes(a.id));
        setBulkProgress({ current: 0, total: approvalsToProcess.length, action: 'approving' });

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < approvalsToProcess.length; i++) {
            const app = approvalsToProcess[i];
            setBulkProgress({ current: i + 1, total: approvalsToProcess.length, action: 'approving' });
            try {
                const res = await approvePendingChange(app);
                if (res.success) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (err) {
                failCount++;
            }
        }

        setBulkProgress(null);
        setSelectedIds([]);
        if (failCount > 0) {
            alert(`Bulk Approval complete: ${successCount} approved, ${failCount} failed.`);
        }
    };

    // Bulk Reject
    const handleOpenBulkRejectModal = () => {
        if (currentSelectedIds.length === 0) return;
        setBulkRejectNote('');
        setIsBulkRejectModalOpen(true);
    };

    const handleConfirmBulkReject = async () => {
        if (currentSelectedIds.length === 0) return;
        setIsBulkRejectModalOpen(false);

        const idsToReject = [...currentSelectedIds];
        const note = bulkRejectNote.trim() || null;
        setBulkProgress({ current: 0, total: idsToReject.length, action: 'rejecting' });

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < idsToReject.length; i++) {
            const id = idsToReject[i];
            setBulkProgress({ current: i + 1, total: idsToReject.length, action: 'rejecting' });
            try {
                const res = await rejectPendingChange(id, note);
                if (res.success) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (err) {
                failCount++;
            }
        }

        setBulkProgress(null);
        setBulkRejectNote('');
        setSelectedIds([]);
        if (failCount > 0) {
            alert(`Bulk Rejection complete: ${successCount} rejected, ${failCount} failed.`);
        }
    };

    if (!isSuperAdmin) {
        return (
            <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                <i className="fa-solid fa-lock" style={{ fontSize: '2.5rem', color: 'var(--accent-gold)', marginBottom: '1rem' }}></i>
                <h3>Super Admin Access Restricted</h3>
                <p style={{ color: 'var(--text-muted)' }}>The staff approval queue is accessible exclusively to Super Admin accounts.</p>
            </div>
        );
    }

    return (
        <div className="admin-approvals-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Header Controls Banner */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'rgba(255,193,7,0.15)', border: '1px solid var(--accent-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className="fa-solid fa-user-shield" style={{ fontSize: '1.2rem', color: 'var(--accent-gold)' }}></i>
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
                        <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.8rem' }}></i>
                        <input
                            type="text"
                            className="form-control"
                            placeholder="Search requests..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ paddingLeft: '2.2rem', fontSize: '0.8rem', height: '36px' }}
                        />
                    </div>

                    <select
                        className="form-control"
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                        style={{ fontSize: '0.8rem', height: '36px', width: '160px' }}
                    >
                        <option value="ALL">All Actions</option>
                        <option value="FEED">Feed Logs</option>
                        <option value="WEIGHTS">Weight Logs</option>
                        <option value="TREATMENTS">Treatments</option>
                        <option value="PURCHASES">Feed Purchases</option>
                        <option value="ISSUES">Stock Issues</option>
                        <option value="EXPENSES">Overhead Expenses</option>
                        <option value="SETTINGS">Setting Changes</option>
                        <option value="AI_ONLY">🤖 AI Agent Requests Only</option>
                        <option value="DELETIONS">Deletions Only</option>
                    </select>

                    <div style={{ background: 'rgba(255,193,7,0.15)', color: 'hsl(43,90%,53%)', padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '700', border: '1px solid rgba(255,193,7,0.3)' }}>
                        {pendingApprovals.length} Pending
                    </div>
                </div>
            </div>

            {/* AI Assistant Governance Switch (Super Admin only) */}
            {isSuperAdmin && (
                <div style={{
                    background: aiRequireApproval
                        ? 'linear-gradient(135deg, rgba(255, 193, 7, 0.12) 0%, rgba(33, 37, 41, 0.9) 100%)'
                        : 'linear-gradient(135deg, rgba(40, 167, 69, 0.12) 0%, rgba(33, 37, 41, 0.9) 100%)',
                    border: `1px solid ${aiRequireApproval ? 'var(--accent-gold)' : 'var(--primary-green-light)'}`,
                    borderRadius: '10px',
                    padding: '0.9rem 1.25rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '1rem',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.25)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                        <div style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '8px',
                            background: aiRequireApproval ? 'rgba(255,193,7,0.2)' : 'rgba(40,167,69,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.15rem',
                            color: aiRequireApproval ? 'var(--accent-gold)' : 'var(--primary-green-light)'
                        }}>
                            <i className={`fa-solid ${aiRequireApproval ? 'fa-user-shield' : 'fa-robot'}`}></i>
                        </div>
                        <div>
                            <div style={{ fontWeight: '700', color: 'var(--text-pure)', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span>AI Assistant Governance:</span>
                                <span className="badge" style={{
                                    background: aiRequireApproval ? 'rgba(255,193,7,0.25)' : 'rgba(40,167,69,0.25)',
                                    color: aiRequireApproval ? 'var(--accent-gold)' : 'var(--primary-green-light)',
                                    border: `1px solid ${aiRequireApproval ? 'rgba(255,193,7,0.5)' : 'rgba(40,167,69,0.5)'}`,
                                    fontSize: '0.75rem',
                                    padding: '0.2rem 0.6rem'
                                }}>
                                    {aiRequireApproval ? 'JUNIOR EMPLOYEE (APPROVAL REQUIRED)' : 'NORMAL HERD STAFF (DIRECT EXECUTION)'}
                                </span>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                {aiRequireApproval
                                    ? 'All tasks submitted by the AI (daily feeding, scale weigh-ins, health treatments, purchases, and custom mixing) are parked here for your review and approval.'
                                    : 'The AI operates with normal herd staff permissions. Valid entries commit directly to active herd databases while protected by biological sanity clamps.'}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <button
                            type="button"
                            className={`btn btn-sm ${aiRequireApproval ? 'btn-warning' : 'btn-outline-secondary'}`}
                            onClick={() => updateAiRequireApproval(true)}
                            style={{ fontSize: '0.78rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                            title="Require admin approval for every action"
                        >
                            <i className="fa-solid fa-lock"></i>
                            Junior Employee
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm ${!aiRequireApproval ? 'btn-success' : 'btn-outline-secondary'}`}
                            onClick={() => updateAiRequireApproval(false)}
                            style={{ fontSize: '0.78rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                            title="Allow direct commits like normal staff"
                        >
                            <i className="fa-solid fa-bolt"></i>
                            Normal Staff
                        </button>
                    </div>
                </div>
            )}

            {/* Bulk Actions Toolbar */}
            {currentSelectedIds.length > 0 && (
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255, 193, 7, 0.12) 0%, rgba(33, 37, 41, 0.95) 100%)',
                    border: '1px solid var(--accent-gold)',
                    borderRadius: '10px',
                    padding: '0.85rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                        <span style={{
                            background: 'var(--accent-gold)',
                            color: '#000',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.65rem',
                            borderRadius: '12px'
                        }}>
                            {currentSelectedIds.length} Selected
                        </span>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-pure)' }}>
                            Choose a batch action to apply across all selected requests:
                        </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={handleClearSelection}
                            disabled={!!bulkProgress}
                            style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                        >
                            <i className="fa-solid fa-xmark"></i> Deselect All
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={handleOpenBulkRejectModal}
                            disabled={!!bulkProgress}
                            style={{
                                fontSize: '0.78rem',
                                padding: '0.35rem 0.85rem',
                                color: 'hsl(0, 75%, 65%)',
                                borderColor: 'rgba(220, 53, 69, 0.5)',
                                background: 'rgba(220, 53, 69, 0.12)'
                            }}
                        >
                            <i className="fa-solid fa-ban"></i> Bulk Reject ({currentSelectedIds.length})
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={handleBulkApprove}
                            disabled={!!bulkProgress}
                            style={{
                                fontSize: '0.78rem',
                                padding: '0.35rem 0.95rem',
                                fontWeight: '700'
                            }}
                        >
                            <i className="fa-solid fa-check-double"></i> Bulk Approve ({currentSelectedIds.length})
                        </button>
                    </div>
                </div>
            )}

            {/* Bulk Progress Indicator */}
            {bulkProgress && (
                <div style={{
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: '8px',
                    padding: '0.75rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <i className="fa-solid fa-spinner fa-spin" style={{ color: '#60a5fa', fontSize: '1rem' }}></i>
                        <span style={{ fontSize: '0.85rem', color: '#93c5fd', fontWeight: '600' }}>
                            {bulkProgress.action === 'approving' ? 'Approving' : 'Rejecting'} {bulkProgress.current} of {bulkProgress.total} requests...
                        </span>
                    </div>
                    <div style={{ width: '160px', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                            width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
                            height: '100%',
                            background: '#3b82f6',
                            transition: 'width 0.2s ease'
                        }}></div>
                    </div>
                </div>
            )}

            {/* Approvals Data Table */}
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
                {pendingApprovals.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                        <i className="fa-solid fa-circle-check" style={{ fontSize: '3rem', color: 'var(--primary-green-light)', marginBottom: '1rem', display: 'block' }}></i>
                        <h4 style={{ color: 'var(--text-pure)', marginBottom: '0.4rem' }}>No Requests Awaiting Approval</h4>
                        <p style={{ fontSize: '0.85rem' }}>All non-admin staff submissions and sensitive edits have been reviewed and approved.</p>
                    </div>
                ) : filteredApprovals.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                        <p>No pending approvals match your search filter.</p>
                    </div>
                ) : (
                    <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                        <table className="data-table" style={{ fontSize: '0.85rem', width: '100%', minWidth: '940px' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '38px', textAlign: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={isAllFilteredSelected}
                                            ref={el => { if (el) el.indeterminate = isSomeFilteredSelected; }}
                                            onChange={handleToggleSelectAll}
                                            style={{ cursor: 'pointer', transform: 'scale(1.15)', accentColor: 'var(--accent-gold)' }}
                                            title="Select all filtered requests"
                                        />
                                    </th>
                                    <th style={{ width: '36px', color: 'var(--text-muted)', textAlign: 'center' }}>#</th>
                                    <th style={{ width: '170px' }}>ACTION / TYPE</th>
                                    <th style={{ width: '190px' }}>REQUESTED BY &amp; DATE</th>
                                    <th style={{ width: '160px' }}>TARGET / ITEM</th>
                                    <th>DETAILS &amp; IMPACT</th>
                                    <th style={{ textAlign: 'center', width: '190px' }}>DECISION</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredApprovals.map((item, idx) => {
                                    const snap = item.previousSnapshot || {};
                                    const payload = item.payload || {};
                                    const isSelected = currentSelectedIds.includes(item.id);

                                    const actionBadge = (() => {
                                        switch (item.action) {
                                            case 'ADD_FEED_PURCHASE':
                                                return <span className="badge" style={{ background: 'rgba(40,167,69,0.15)', color: 'var(--primary-green-light)', border: '1px solid rgba(40,167,69,0.3)' }}><i className="fa-solid fa-plus-circle"></i> Add Feed Purchase</span>;
                                            case 'UPDATE_FEED_PURCHASE':
                                                return <span className="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i className="fa-solid fa-pen-to-square"></i> Edit Feed Purchase</span>;
                                            case 'ADD_FEED_STOCK_ISSUE':
                                                return <span className="badge" style={{ background: 'rgba(74,144,217,0.15)', color: '#4a90d9', border: '1px solid rgba(74,144,217,0.3)' }}><i className="fa-solid fa-dolly"></i> Add Stock Issue</span>;
                                            case 'ADD_OVERHEAD_EXPENSE':
                                                return <span className="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i className="fa-solid fa-receipt"></i> Add Expense</span>;
                                            case 'SAVE_SETTINGS':
                                                return <span className="badge" style={{ background: 'rgba(111,66,193,0.15)', color: '#a370f7', border: '1px solid rgba(111,66,193,0.3)' }}><i className="fa-solid fa-sliders"></i> Master Setting Change</span>;
                                            case 'UPDATE_ANIMAL':
                                                return <span className="badge" style={{ background: 'rgba(23,162,184,0.15)', color: '#17a2b8', border: '1px solid rgba(23,162,184,0.3)' }}><i className="fa-solid fa-pen-to-square"></i> Edit Animal</span>;
                                            case 'RECORD_DEATH':
                                                return <span className="badge" style={{ background: 'rgba(108,117,125,0.15)', color: '#adb5bd', border: '1px solid rgba(108,117,125,0.3)' }}><i className="fa-solid fa-skull"></i> Record Death</span>;
                                            case 'RECORD_SALE':
                                                return <span className="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i className="fa-solid fa-handshake"></i> Record Sale</span>;
                                            case 'LOG_WEIGHT':
                                                return <span className="badge" style={{ background: 'rgba(40,167,69,0.15)', color: 'var(--primary-green-light)', border: '1px solid rgba(40,167,69,0.3)' }}><i className="fa-solid fa-weight-scale"></i> Log Weight</span>;
                                            case 'UPDATE_WEIGHT_LOGS_BATCH':
                                                return <span className="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i className="fa-solid fa-pen-to-square"></i> Edit Weight Log</span>;
                                            case 'OVERWRITE_FEED_LOG':
                                                return <span className="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i className="fa-solid fa-rotate"></i> Overwrite Feed Log</span>;
                                            case 'ADD_FEED_LOG':
                                                return <span className="badge" style={{ background: 'rgba(40,167,69,0.15)', color: 'var(--primary-green-light)', border: '1px solid rgba(40,167,69,0.3)' }}><i className="fa-solid fa-wheat-awn"></i> Add Feed Log</span>;
                                            case 'LOG_TREATMENT':
                                                return <span className="badge" style={{ background: 'rgba(23,162,184,0.15)', color: '#17a2b8', border: '1px solid rgba(23,162,184,0.3)' }}><i className="fa-solid fa-syringe"></i> Health Treatment</span>;
                                            case 'LOG_PEN_CHECK':
                                                return <span className="badge" style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.3)' }}><i className="fa-solid fa-clipboard-check"></i> Pen Check</span>;
                                            case 'ADD_ANIMAL':
                                                return <span className="badge" style={{ background: 'rgba(40,167,69,0.15)', color: 'var(--primary-green-light)', border: '1px solid rgba(40,167,69,0.3)' }}><i className="fa-solid fa-plus-circle"></i> Add Cattle Intake</span>;
                                            default:
                                                if (item.action.startsWith('DELETE_')) {
                                                    return <span className="badge" style={{ background: 'rgba(220,53,69,0.15)', color: 'hsl(0,75%,65%)', border: '1px solid rgba(220,53,69,0.3)' }}><i className="fa-solid fa-trash-can"></i> {item.action.replace('DELETE_', 'Delete ')}</span>;
                                                }
                                                return <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-pure)' }}>{item.action}</span>;
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
                                            case 'LOG_WEIGHT':
                                            case 'DELETE_WEIGHT_LOG':
                                            case 'UPDATE_WEIGHT_LOGS_BATCH':
                                            case 'LOG_TREATMENT':
                                            case 'DELETE_TREATMENT':
                                                return `${item.animalRfid || 'Animal #' + item.animalId}${item.animalBreed ? ' (' + item.animalBreed + ')' : ''}`;
                                            case 'ADD_FEED_LOG':
                                            case 'OVERWRITE_FEED_LOG':
                                            case 'DELETE_FEED_LOG':
                                                return `Pen ${payload.pen || snap.pen || 'ALL'} (${payload.date || snap.date || '—'})`;
                                            case 'LOG_PEN_CHECK':
                                                return `Pen ${payload.pen || snap.pen || '—'} (${payload.session || snap.session || 'Morning'})`;
                                            case 'ADD_ANIMAL':
                                                return `${payload.tag || payload.rfid || 'New Cattle'} (${payload.breed || 'Cross'})`;
                                            default:
                                                return snap.title || snap.name || payload.title || payload.id || 'Record';
                                        }
                                    })();

                                    return (
                                        <tr
                                            key={item.id}
                                            style={{
                                                background: isSelected ? 'rgba(255, 193, 7, 0.08)' : undefined,
                                                transition: 'background 0.15s ease'
                                            }}
                                        >
                                            <td style={{ textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => handleToggleSelect(item.id)}
                                                    style={{ cursor: 'pointer', transform: 'scale(1.15)', accentColor: 'var(--accent-gold)' }}
                                                />
                                            </td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
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
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Deceased Date: {formatDate(payload?.deceasedDate) || '—'} · Cause: {payload?.deceasedCause || 'N/A'}</div>;
                                                            case 'RECORD_SALE':
                                                                return <div style={{ fontSize: '0.78rem', color: 'var(--accent-gold)' }}>Buyer: {payload?.buyerName || 'N/A'} · Sale Price: PKR {(Number(payload?.salePrice) || 0).toLocaleString()} · Sale Date: {formatDate(payload?.saleDate) || '—'}</div>;
                                                            case 'DELETE_ANIMAL':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Permanently remove animal and all logs/history.</div>;
                                                            case 'DELETE_FEED_PURCHASE':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Date: {formatDate(snap?.date || payload?.date) || '—'} · Qty: {Number(snap?.quantity || payload?.quantity) || 0} kg · Supplier: {snap?.supplier || payload?.supplier || 'N/A'} · Rate: PKR {Number(snap?.rate || payload?.rate) || 0}</div>;
                                                            case 'DELETE_FEED_STOCK_ISSUE':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Date: {formatDate(snap?.date || payload?.date) || '—'} · Qty: {Number(snap?.quantity || payload?.quantity) || 0} kg · Pen: {snap?.pen || payload?.pen || 'ALL'}</div>;
                                                            case 'DELETE_OVERHEAD_EXPENSE':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Amount: PKR {(Number(snap?.amount || payload?.amount) || 0).toLocaleString()} · Category: {snap?.category || payload?.category || '—'} · Date: {formatDate(snap?.date || payload?.date) || '—'}</div>;
                                                            case 'DELETE_WEIGHT_LOG':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Weight log on {formatDate(snap?.date || payload?.date)}: {snap?.weight || payload?.weight} kg (ADG: {(Number(snap?.adg || payload?.adg) || 0).toFixed(2)} kg/day)</div>;
                                                            case 'LOG_WEIGHT':
                                                                return (
                                                                    <div style={{ fontSize: '0.78rem', color: 'var(--primary-green-light)' }}>
                                                                        Weight: <strong>{payload?.weight} kg</strong> · Date: {formatDate(payload?.date)} {payload?.adg !== undefined ? `· ADG: ${Number(payload?.adg) > 0 ? '+' : ''}${Number(payload?.adg).toFixed(2)} kg/day` : ''}
                                                                    </div>
                                                                );
                                                            case 'DELETE_TREATMENT':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Treatment on {formatDate(snap?.date || payload?.date)}: {snap?.medicine || snap?.type || payload?.medicine || payload?.type} (Dosage: {snap?.dosage || payload?.dosage || '—'})</div>;
                                                            case 'DELETE_FEED_LOG':
                                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Feed log for {formatDate(snap?.date || payload?.date)} (Pen {snap?.pen || payload?.pen || 'ALL'})</div>;
                                                            case 'OVERWRITE_FEED_LOG': {
                                                                const oldKg = Number(snap ? (snap.total_batch_kg || snap.totalBatchKg || 0) : 0) || 0;
                                                                const newKg = Number(payload?.totalBatchKg || payload?.total_batch_kg || 0) || 0;
                                                                return (
                                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-pure)' }}>
                                                                        Date: {formatDate(payload?.date || snap?.date)} · Pen: {payload?.pen || snap?.pen || 'ALL'} · Total Batch: <strong>{oldKg.toFixed(2)} kg</strong> → <strong style={{ color: 'var(--accent-gold)' }}>{newKg.toFixed(2)} kg</strong>
                                                                    </div>
                                                                );
                                                            }
                                                            case 'ADD_FEED_LOG': {
                                                                const kg = Number(payload?.totalBatchKg || payload?.total_batch_kg || 0) || 0;
                                                                const ingCount = Array.isArray(payload?.ingredients) ? payload.ingredients.length : 0;
                                                                return (
                                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-pure)' }}>
                                                                        Date: {formatDate(payload?.date)} · Pen: <strong>{payload?.pen || 'ALL'}</strong> · Batch: <strong style={{ color: 'var(--primary-green-light)' }}>{kg.toFixed(2)} kg</strong> ({ingCount} ingredients, #{payload?.feedingIndex || 1}/{payload?.numFeedings || 1})
                                                                        {payload?.notes && <span> · Notes: {payload.notes}</span>}
                                                                    </div>
                                                                );
                                                            }
                                                            case 'LOG_TREATMENT': {
                                                                return (
                                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-pure)' }}>
                                                                        Medicine: <strong style={{ color: 'var(--accent-gold)' }}>{payload?.medicine}</strong> ({payload?.type || 'Curative'}) · Dosage: <strong>{payload?.dosage}</strong> · Withholding: <strong>{payload?.withholding || 0} days</strong>
                                                                        {payload?.notes && <span> · Notes: {payload.notes}</span>}
                                                                    </div>
                                                                );
                                                            }
                                                            case 'LOG_PEN_CHECK': {
                                                                const score = payload?.bunkScore !== undefined ? payload.bunkScore : (payload?.bunk_score !== undefined ? payload.bunk_score : payload?.bunk_score_pct);
                                                                return (
                                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-pure)' }}>
                                                                        Pen: <strong>{payload?.pen}</strong> ({payload?.session || 'Morning'}) · Bunk Score: <strong style={{ color: 'var(--accent-gold)' }}>{score !== null && score !== undefined ? score + '%' : 'Clean'}</strong>
                                                                        {Array.isArray(payload?.flags) && payload.flags.length > 0 && <span> · Flagged: {payload.flags.length} head</span>}
                                                                        {payload?.notes && <span> · Notes: {payload.notes}</span>}
                                                                    </div>
                                                                );
                                                            }
                                                            case 'ADD_ANIMAL': {
                                                                return (
                                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-pure)' }}>
                                                                        Tag: <strong style={{ color: 'var(--accent-gold)' }}>{payload?.tag || payload?.rfid}</strong> · Breed: <strong>{payload?.breed || 'Cross'}</strong> · Entry Wt: <strong>{payload?.entryWeight} kg</strong> · Cost: <strong>PKR {Number(payload?.purchasePrice || 0).toLocaleString()}</strong> · Pen: <strong>{payload?.pen || 'Quarantine'}</strong>
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
                                                        <i className="fa-solid fa-spinner fa-spin"></i> Processing...
                                                    </span>
                                                ) : rejectingId === item.id ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
                                                        <input
                                                            type="text"
                                                            className="form-control"
                                                            placeholder="Reason for rejecting (optional)"
                                                            value={rejectNote}
                                                            onChange={(e) => setRejectNote(e.target.value)}
                                                            autoFocus
                                                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
                                                        />
                                                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                                            <button className="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }} onClick={() => { setRejectingId(null); setRejectNote(''); }}>Cancel</button>
                                                            <button className="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', borderColor: 'rgba(220, 53, 69, 0.4)', color: 'hsl(0, 75%, 65%)' }} onClick={() => handleReject(item.id)}>Confirm</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                                        <button className="btn btn-primary btn-sm" style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }} onClick={() => handleApprove(item)}>
                                                            <i className="fa-solid fa-check"></i> Approve
                                                        </button>
                                                        <button className="btn btn-secondary btn-sm" style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem', color: 'hsl(0, 75%, 65%)', borderColor: 'rgba(220, 53, 69, 0.3)' }} onClick={() => setRejectingId(item.id)}>
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

            {/* Bulk Reject Reason Modal */}
            {isBulkRejectModalOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.75)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                    padding: '1rem'
                }}>
                    <div className="glass-panel" style={{
                        width: '100%',
                        maxWidth: '460px',
                        padding: '1.5rem',
                        border: '1px solid rgba(220, 53, 69, 0.4)',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                            <div style={{
                                width: '38px',
                                height: '38px',
                                borderRadius: '50%',
                                background: 'rgba(220, 53, 69, 0.15)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'hsl(0, 75%, 65%)'
                            }}>
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-pure)' }}>Bulk Reject Requests</h3>
                                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    Rejecting {currentSelectedIds.length} selected request{currentSelectedIds.length === 1 ? '' : 's'}.
                                </p>
                            </div>
                        </div>

                        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-pure)', marginBottom: '0.4rem', display: 'block' }}>
                                Reason for Rejection (optional — attached to all selected items):
                            </label>
                            <textarea
                                className="form-control"
                                rows={3}
                                placeholder="e.g. Duplicate entry, incorrect rate, not authorized..."
                                value={bulkRejectNote}
                                onChange={(e) => setBulkRejectNote(e.target.value)}
                                autoFocus
                                style={{ fontSize: '0.82rem', resize: 'vertical' }}
                            />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setIsBulkRejectModalOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={handleConfirmBulkReject}
                                style={{
                                    borderColor: 'rgba(220, 53, 69, 0.5)',
                                    color: 'hsl(0, 75%, 65%)',
                                    background: 'rgba(220, 53, 69, 0.15)',
                                    fontWeight: '700'
                                }}
                            >
                                <i className="fa-solid fa-ban"></i> Confirm Rejection ({currentSelectedIds.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

