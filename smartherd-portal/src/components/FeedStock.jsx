import React, { useContext, useState, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

// Feed store ledger — separate from the ration/TMR ingredient list (which defines
// recipe quantities and a single reference price). This tracks what physically moves
// through the store: opening stock, dated purchases (qty/rate/supplier), and dated
// issues to a pen. Closing stock and real consumption cost are derived (weighted-
// average cost of everything ever brought into stock), which is more accurate than
// the ration's static price field since it reflects what was actually paid.
export default function FeedStock() {
    const {
        staffUser, animals, pens, feedLogs,
        feedStockItems, updateFeedStockItems,
        feedOpeningStock, setItemOpeningStock,
        feedPurchases, addFeedPurchase, deleteFeedPurchase,
        feedStockIssues, addFeedStockIssue, deleteFeedStockIssue,
        getFeedStockLedger, getCombinedFeedIssues,
        mineralSplitRatio, setMineralSplitRatio
    } = useContext(FarmContext);

    const isAdmin = staffUser?.role === 'Internal Corporate Staff';

    const [activeTab, setActiveTab] = useState('ledger');

    const todayStr = new Date().toISOString().split('T')[0];
    const defaultFrom = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 29);
        return d.toISOString().split('T')[0];
    })();
    const [dateFrom, setDateFrom] = useState(defaultFrom);
    const [dateTo, setDateTo] = useState(todayStr);
    const inRange = (d) => d >= dateFrom && d <= dateTo;

    const distinctPenNames = useMemo(() => [...new Set([
        ...animals.filter(a => a.pen).map(a => a.pen),
        ...pens.map(p => p.id)
    ])].sort(), [animals, pens]);

    // ─── ITEM MASTER (add/remove stock line items) ───
    const [isAddItemFormOpen, setIsAddItemFormOpen] = useState(false);
    const [newItemName, setNewItemName] = useState('');

    const handleAddItem = (e) => {
        e.preventDefault();
        if (!isAdmin || !newItemName.trim()) return;
        const newItem = { id: 'item_' + Date.now(), name: newItemName.trim(), unit: 'kg', isDefault: false };
        updateFeedStockItems([...feedStockItems, newItem]);
        setNewItemName('');
        setIsAddItemFormOpen(false);
    };

    const handleDeleteItem = (id) => {
        if (!isAdmin) return;
        if (window.confirm('Remove this item from the stock ledger? Its purchase/issue history stays on record but it will no longer appear for new entries.')) {
            updateFeedStockItems(feedStockItems.filter(i => i.id !== id));
        }
    };

    // ─── OPENING STOCK ───
    const [openingDraft, setOpeningDraft] = useState({});
    const getOpeningDraftVal = (itemId, field) => {
        if (openingDraft[itemId]?.[field] !== undefined) return openingDraft[itemId][field];
        return feedOpeningStock[itemId]?.[field] ?? 0;
    };
    const handleOpeningDraftChange = (itemId, field, value) => {
        setOpeningDraft(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
    };
    const handleSaveOpening = (itemId) => {
        if (!isAdmin) return;
        setItemOpeningStock(itemId, getOpeningDraftVal(itemId, 'qty'), getOpeningDraftVal(itemId, 'value'));
        setOpeningDraft(prev => {
            const next = { ...prev };
            delete next[itemId];
            return next;
        });
    };

    // ─── PURCHASES ───
    const [pDate, setPDate] = useState(todayStr);
    const [pItemId, setPItemId] = useState('');
    const [pQty, setPQty] = useState('');
    const [pRate, setPRate] = useState('');
    const [pSupplier, setPSupplier] = useState('');
    const [pNotes, setPNotes] = useState('');

    const handleAddPurchase = (e) => {
        e.preventDefault();
        if (!isAdmin || !pItemId || !pQty || !pRate) return;
        addFeedPurchase({ date: pDate, itemId: pItemId, quantity: pQty, rate: pRate, supplier: pSupplier, notes: pNotes });
        setPQty('');
        setPRate('');
        setPSupplier('');
        setPNotes('');
    };

    const filteredPurchases = useMemo(() =>
        feedPurchases.filter(p => inRange(p.date)).sort((a, b) => new Date(b.date) - new Date(a.date)),
        [feedPurchases, dateFrom, dateTo]
    );

    // ─── ISSUES ───
    const [iDate, setIDate] = useState(todayStr);
    const [iItemId, setIItemId] = useState('');
    const [iPen, setIPen] = useState('');
    const [iQty, setIQty] = useState('');
    const [iNotes, setINotes] = useState('');

    const handleAddIssue = (e) => {
        e.preventDefault();
        if (!isAdmin || !iItemId || !iPen || !iQty) return;
        addFeedStockIssue({ date: iDate, itemId: iItemId, pen: iPen, quantity: iQty, notes: iNotes });
        setIQty('');
        setINotes('');
    };

    // Auto-derived (from TMR "Log This Feeding" records) + manual exception issues,
    // merged and tagged by source — so routine pen feeding never has to be typed twice.
    const combinedIssues = useMemo(() => getCombinedFeedIssues(),
        [feedLogs, feedStockItems, feedStockIssues, mineralSplitRatio]
    );
    const filteredIssues = useMemo(() =>
        combinedIssues.filter(i => inRange(i.date)).sort((a, b) => new Date(b.date) - new Date(a.date)),
        [combinedIssues, dateFrom, dateTo]
    );

    // Full-history ledger (opening + all-time purchases/issues) — closing stock is
    // always a current, all-time snapshot regardless of the Purchases/Issues date filter.
    const ledger = useMemo(() => getFeedStockLedger(), [feedStockItems, feedOpeningStock, feedPurchases, feedLogs, feedStockIssues, mineralSplitRatio]);
    const ledgerByItemId = useMemo(() => Object.fromEntries(ledger.map(l => [l.item.id, l])), [ledger]);

    // Actual cost per pen within the selected date range, priced at each item's
    // current all-time weighted-average rate.
    const perPenCost = useMemo(() => {
        const totals = {};
        filteredIssues.forEach(iss => {
            const rate = ledgerByItemId[iss.itemId]?.avgRate || 0;
            const pen = iss.pen || 'ALL';
            if (!totals[pen]) totals[pen] = { pen, qty: 0, cost: 0 };
            totals[pen].qty += iss.quantity;
            totals[pen].cost += iss.quantity * rate;
        });
        return Object.values(totals).sort((a, b) => b.cost - a.cost);
    }, [filteredIssues, ledgerByItemId]);

    const totalStockValue = ledger.reduce((sum, l) => sum + l.closingValue, 0);
    const totalConsumptionValue = filteredIssues.reduce((sum, iss) => sum + iss.quantity * (ledgerByItemId[iss.itemId]?.avgRate || 0), 0);

    const itemName = (id) => feedStockItems.find(i => i.id === id)?.name || id;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {!isAdmin && (
                <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)', fontSize: '1.4rem' }}></i>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        Read-only view. Only Admin staff can record purchases, issues, or edit opening stock.
                    </span>
                </div>
            )}

            {isAdmin && (
                <div style={{ background: 'rgba(74, 144, 217, 0.06)', border: '1px solid rgba(74, 144, 217, 0.18)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                    <i class="fa-solid fa-circle-info" style={{ color: '#4a90d9', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                        <strong style={{ color: 'var(--text-pure)' }}>How this works:</strong> Set each item's <strong>Opening Stock</strong> once — the balance physically in the store before you started tracking here (leave at 0 kg if this is a fresh start). Then log dated <strong>Purchases</strong> (qty, rate, supplier) as feed comes in. Routine <strong>Issues</strong> to a pen sync automatically from every "Log This Feeding" entry in the TMR Calculator — no need to re-enter them here; the Issues tab is only for exceptions (spoilage, samples, a sale out of the store). Closing stock and actual cost per pen are calculated automatically at the weighted-average purchase rate.
                    </span>
                </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem', flexWrap: 'wrap' }}>
                <button class={`filter-btn ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>
                    <i class="fa-solid fa-warehouse"></i> Stock Ledger
                </button>
                <button class={`filter-btn ${activeTab === 'purchases' ? 'active' : ''}`} onClick={() => setActiveTab('purchases')}>
                    <i class="fa-solid fa-truck-ramp-box"></i> Purchases
                </button>
                <button class={`filter-btn ${activeTab === 'issues' ? 'active' : ''}`} onClick={() => setActiveTab('issues')}>
                    <i class="fa-solid fa-dolly"></i> Issues by Pen
                </button>
            </div>

            {/* ═══ TAB: STOCK LEDGER ═══ */}
            {activeTab === 'ledger' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    <div class="dashboard-grid">
                        <div class="glass-panel stat-box">
                            <div class="stat-header">
                                <h3>Current Stock Value</h3>
                                <div class="stat-icon"><i class="fa-solid fa-coins"></i></div>
                            </div>
                            <div class="stat-val">{Math.round(totalStockValue).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR</small></div>
                            <span class="stat-lbl"><i class="fa-solid fa-boxes-stacked"></i> Across {feedStockItems.length} item{feedStockItems.length === 1 ? '' : 's'}, at weighted-avg cost</span>
                        </div>
                        <div class="glass-panel stat-box">
                            <div class="stat-header">
                                <h3>Consumption Value (range)</h3>
                                <div class="stat-icon"><i class="fa-solid fa-fire"></i></div>
                            </div>
                            <div class="stat-val">{Math.round(totalConsumptionValue).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR</small></div>
                            <span class="stat-lbl">Issues between {dateFrom} and {dateTo}</span>
                        </div>
                    </div>

                    {isAdmin && (
                        <div class="glass-panel">
                            <h3 class="panel-title" style={{ marginBottom: '0.5rem' }}><i class="fa-solid fa-sliders"></i> Mineral Split (auto-sync)</h3>
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.8rem' }}>
                                TMR logs one combined "Limestone / Minerals" ingredient — this decides what share of that quantity is auto-counted against each line below.
                            </p>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>Limestone %</label>
                                    <input
                                        type="number" min="0" max="100" step="1" class="form-control" style={{ width: '90px' }}
                                        value={Math.round(mineralSplitRatio * 100)}
                                        onChange={e => setMineralSplitRatio(Math.min(1, Math.max(0, (parseFloat(e.target.value) || 0) / 100)))}
                                    />
                                </div>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>Mineral Pack %</label>
                                    <input type="number" class="form-control" style={{ width: '90px' }} value={Math.round((1 - mineralSplitRatio) * 100)} disabled />
                                </div>
                            </div>
                        </div>
                    )}

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-clipboard-list"></i> Per-Item Ledger</h3>
                            {isAdmin && (
                                <button type="button" class="btn btn-secondary btn-sm" onClick={() => setIsAddItemFormOpen(!isAddItemFormOpen)}>
                                    <i class={`fa-solid ${isAddItemFormOpen ? 'fa-xmark' : 'fa-plus'}`}></i> {isAddItemFormOpen ? 'Cancel' : 'Add Item'}
                                </button>
                            )}
                        </div>

                        {isAddItemFormOpen && (
                            <form onSubmit={handleAddItem} style={{ background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr auto', gap: '0.8rem', alignItems: 'flex-end' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Item Name</label>
                                        <input type="text" class="form-control" placeholder="e.g. Molasses" value={newItemName} onChange={e => setNewItemName(e.target.value)} required />
                                    </div>
                                    <button type="submit" class="btn btn-primary">Add</button>
                                </div>
                            </form>
                        )}

                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>ITEM</th>
                                        <th>OPENING STOCK</th>
                                        <th>PURCHASED</th>
                                        <th>ISSUED</th>
                                        <th>CLOSING STOCK</th>
                                        <th>AVG RATE</th>
                                        <th>STOCK VALUE</th>
                                        {isAdmin && <th style={{ textAlign: 'center' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {ledger.map(row => (
                                        <tr key={row.item.id}>
                                            <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{row.item.name}</td>
                                            <td>
                                                {isAdmin ? (
                                                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            class="form-control"
                                                            style={{ width: '80px', minHeight: '30px', height: '30px', padding: '0.15rem 0.4rem', fontSize: '0.8rem' }}
                                                            value={getOpeningDraftVal(row.item.id, 'qty')}
                                                            onChange={e => handleOpeningDraftChange(row.item.id, 'qty', e.target.value)}
                                                            title="Opening qty (kg)"
                                                        />
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>kg @</span>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            class="form-control"
                                                            style={{ width: '90px', minHeight: '30px', height: '30px', padding: '0.15rem 0.4rem', fontSize: '0.8rem' }}
                                                            value={getOpeningDraftVal(row.item.id, 'value')}
                                                            onChange={e => handleOpeningDraftChange(row.item.id, 'value', e.target.value)}
                                                            title="Opening total value (PKR)"
                                                        />
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>PKR</span>
                                                        <button type="button" class="btn btn-secondary" style={{ padding: '0.15rem 0.5rem', minHeight: '30px', height: '30px' }} onClick={() => handleSaveOpening(row.item.id)} title="Save opening stock">
                                                            <i class="fa-solid fa-floppy-disk"></i>
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span>{row.openingQty.toFixed(2)} kg ({Math.round(row.openingValue).toLocaleString()} PKR)</span>
                                                )}
                                            </td>
                                            <td>{row.purchasedQty.toFixed(2)} kg</td>
                                            <td>{row.issuedQty.toFixed(2)} kg</td>
                                            <td><strong style={{ color: row.closingQty < 0 ? 'hsl(0,75%,60%)' : 'var(--primary-green-light)' }}>{row.closingQty.toFixed(2)} kg</strong></td>
                                            <td>{row.avgRate.toFixed(2)} PKR/kg</td>
                                            <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(row.closingValue).toLocaleString()} PKR</strong></td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }}>
                                                    {row.item.isDefault ? (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-lock" title="Baseline items cannot be removed"></i></span>
                                                    ) : (
                                                        <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => handleDeleteItem(row.item.id)}>
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    {ledger.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 8 : 7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No stock items defined yet.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {ledger.some(l => l.closingQty < 0) && (
                            <p style={{ fontSize: '0.76rem', color: 'hsl(0,75%,65%)', marginTop: '0.8rem', marginBottom: 0 }}>
                                <i class="fa-solid fa-triangle-exclamation"></i> One or more items show negative closing stock — issues exceed opening stock + purchases logged. Check for a missing purchase entry or an incorrect opening balance.
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* ═══ TAB: PURCHASES ═══ */}
            {activeTab === 'purchases' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {isAdmin && (
                        <div class="glass-panel">
                            <h3 class="panel-title"><i class="fa-solid fa-circle-plus"></i> Record a Purchase</h3>
                            <form onSubmit={handleAddPurchase} class="form-grid-3" style={{ alignItems: 'flex-end' }}>
                                <div class="form-group">
                                    <label>Date</label>
                                    <input type="date" class="form-control" value={pDate} max={todayStr} onChange={e => setPDate(e.target.value)} required />
                                </div>
                                <div class="form-group">
                                    <label>Item</label>
                                    <select class="form-control" value={pItemId} onChange={e => setPItemId(e.target.value)} required>
                                        <option value="">Select item…</option>
                                        {feedStockItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Quantity (kg)</label>
                                    <input type="number" step="0.01" class="form-control" placeholder="e.g. 500" value={pQty} onChange={e => setPQty(e.target.value)} required />
                                </div>
                                <div class="form-group">
                                    <label>Rate (PKR/kg)</label>
                                    <input type="number" step="0.01" class="form-control" placeholder="e.g. 55" value={pRate} onChange={e => setPRate(e.target.value)} required />
                                </div>
                                <div class="form-group">
                                    <label>Supplier</label>
                                    <input type="text" class="form-control" placeholder="e.g. Faisalabad Grain Mandi" value={pSupplier} onChange={e => setPSupplier(e.target.value)} />
                                </div>
                                <div class="form-group">
                                    <label>Notes</label>
                                    <input type="text" class="form-control" placeholder="Optional" value={pNotes} onChange={e => setPNotes(e.target.value)} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <button type="submit" class="btn btn-primary" style={{ minHeight: '44px' }}><i class="fa-solid fa-floppy-disk"></i> Save Purchase</button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-truck-ramp-box"></i> Purchase History</h3>
                            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>From</label>
                                    <input type="date" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)} />
                                </div>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>To</label>
                                    <input type="date" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={dateTo} min={dateFrom} max={todayStr} onChange={e => setDateTo(e.target.value)} />
                                </div>
                            </div>
                        </div>
                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>DATE</th>
                                        <th>ITEM</th>
                                        <th>QTY</th>
                                        <th>RATE</th>
                                        <th>TOTAL</th>
                                        <th>SUPPLIER</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '60px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredPurchases.map(p => (
                                        <tr key={p.id}>
                                            <td>{formatDate(p.date)}</td>
                                            <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{itemName(p.itemId)}</td>
                                            <td>{p.quantity.toFixed(2)} kg</td>
                                            <td>{p.rate.toFixed(2)} PKR/kg</td>
                                            <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(p.quantity * p.rate).toLocaleString()} PKR</strong></td>
                                            <td>{p.supplier || '—'}</td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }}>
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => deleteFeedPurchase(p.id)}>
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    {filteredPurchases.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 7 : 6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No purchases logged in this date range.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ TAB: ISSUES BY PEN ═══ */}
            {activeTab === 'issues' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {isAdmin && (
                        <div class="glass-panel">
                            <h3 class="panel-title"><i class="fa-solid fa-circle-plus"></i> Record an Issue</h3>
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.8rem' }}>
                                <i class="fa-solid fa-circle-info"></i> Routine pen feeding is auto-filled below from TMR's "Log This Feeding" entries — use this form only for exceptions (spoilage, samples, a direct sale out of the store).
                            </p>
                            <form onSubmit={handleAddIssue} class="form-grid-3" style={{ alignItems: 'flex-end' }}>
                                <div class="form-group">
                                    <label>Date</label>
                                    <input type="date" class="form-control" value={iDate} max={todayStr} onChange={e => setIDate(e.target.value)} required />
                                </div>
                                <div class="form-group">
                                    <label>Item</label>
                                    <select class="form-control" value={iItemId} onChange={e => setIItemId(e.target.value)} required>
                                        <option value="">Select item…</option>
                                        {feedStockItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Pen</label>
                                    <select class="form-control" value={iPen} onChange={e => setIPen(e.target.value)} required>
                                        <option value="">Select pen…</option>
                                        {distinctPenNames.map(p => <option key={p} value={p}>Pen {p}</option>)}
                                        <option value="ALL">All Pens</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Quantity (kg)</label>
                                    <input type="number" step="0.01" class="form-control" placeholder="e.g. 45.5" value={iQty} onChange={e => setIQty(e.target.value)} required />
                                </div>
                                <div class="form-group">
                                    <label>Notes</label>
                                    <input type="text" class="form-control" placeholder="Optional" value={iNotes} onChange={e => setINotes(e.target.value)} />
                                </div>
                                <div>
                                    <button type="submit" class="btn btn-primary" style={{ minHeight: '44px', width: '100%' }}><i class="fa-solid fa-floppy-disk"></i> Save Issue</button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-border-all"></i> Actual Feed Cost by Pen</h3>
                            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>From</label>
                                    <input type="date" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)} />
                                </div>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>To</label>
                                    <input type="date" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={dateTo} min={dateFrom} max={todayStr} onChange={e => setDateTo(e.target.value)} />
                                </div>
                            </div>
                        </div>
                        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem' }}>
                            <i class="fa-solid fa-circle-info"></i> Consumption (by difference) × each item's weighted-average purchase rate — the real cost of what actually left the store for that pen, not the ration's reference price.
                        </p>
                        <div class="table-wrapper" style={{ marginBottom: '1.2rem' }}>
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>PEN</th>
                                        <th>QTY ISSUED</th>
                                        <th>ACTUAL FEED COST</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {perPenCost.map(row => (
                                        <tr key={row.pen}>
                                            <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>{row.pen === 'ALL' ? 'All Pens' : `Pen ${row.pen}`}</td>
                                            <td>{row.qty.toFixed(2)} kg</td>
                                            <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(row.cost).toLocaleString()} PKR</strong></td>
                                        </tr>
                                    ))}
                                    {perPenCost.length === 0 && (
                                        <tr>
                                            <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                                No issues logged in this date range.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="glass-panel">
                        <h3 class="panel-title"><i class="fa-solid fa-dolly"></i> Issue History</h3>
                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>DATE</th>
                                        <th>ITEM</th>
                                        <th>PEN</th>
                                        <th>QTY</th>
                                        <th>SOURCE</th>
                                        <th>NOTES</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '60px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredIssues.map(iss => (
                                        <tr key={iss.id}>
                                            <td>{formatDate(iss.date)}</td>
                                            <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{itemName(iss.itemId)}</td>
                                            <td>{iss.pen === 'ALL' ? 'All Pens' : `Pen ${iss.pen}`}</td>
                                            <td>{iss.quantity.toFixed(2)} kg</td>
                                            <td>
                                                {iss.source === 'auto' ? (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--primary-green-light)' }}><i class="fa-solid fa-arrows-rotate"></i> TMR log</span>
                                                ) : (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-pen"></i> Manual</span>
                                                )}
                                            </td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{iss.notes || '—'}</td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }}>
                                                    {iss.source === 'auto' ? (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }} title="Auto-synced from a TMR feed log — edit or delete it from the TMR Calculator's Recent Feed History instead"><i class="fa-solid fa-lock"></i></span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            class="btn btn-secondary"
                                                            style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                            onClick={() => {
                                                                if (window.confirm(`Undo this issue?\n\n${formatDate(iss.date)} · ${itemName(iss.itemId)} · ${iss.quantity.toFixed(2)} kg\n\nThis cannot be undone.`)) {
                                                                    deleteFeedStockIssue(iss.id);
                                                                }
                                                            }}
                                                            title="Undo this issue"
                                                        >
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    {filteredIssues.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 7 : 6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No issues logged in this date range.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
