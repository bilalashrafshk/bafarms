import React, { useContext, useState, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, daysBetween } from '../utils/dateOnly';
import { allocateFifo } from '../utils/fifoStock';

// Feed store ledger — separate from the ration/TMR ingredient list (which defines
// recipe quantities and a single reference price). This tracks what physically moves
// through the store: opening stock, dated purchases (qty/rate/supplier), and dated
// issues to a pen. Closing stock and real consumption cost are derived FIFO (each
// purchase is its own dated "lot"; issues draw the oldest lot with stock left first),
// which is more accurate than both the ration's static price field and a blended
// all-time average, since it reflects what a specific batch of feed actually cost.
export default function FeedStock() {
    const {
        staffUser, animals, pens, feedLogs,
        feedStockItems, updateFeedStockItems, addStockTrackedIngredient,
        feedOpeningStock, setItemOpeningStock,
        feedPurchases, addFeedPurchase, deleteFeedPurchase,
        feedStockIssues, addFeedStockIssue, deleteFeedStockIssue,
        getFeedStockLedger, getFeedStockLots, getFeedStockIssueCosts, getCombinedFeedIssues,
        mineralSplitRatio, setMineralSplitRatio,
        premixTypes, addPremixType, deletePremixType,
        premixFormulas, updatePremixFormula,
        premixBatches, addPremixBatch, deletePremixBatch,
        myRequests, pendingApprovals
    } = useContext(FarmContext);

    // Editing (purchases, issues, opening stock, premix) follows the same Herd Access
    // gate the server enforces for these actions (HERD_ACTIONS in api/farm.js), not the
    // legacy "Internal Corporate Staff" role — a staff member can have Herd Access
    // checked in Settings without that literal role, and previously saw a read-only
    // view here despite the server actually accepting their writes.
    const isAdmin = staffUser?.accessHerd === true || staffUser?.isAdmin === true;
    // Actual feed cost by pen is restricted to the DB-backed Super Admin flag, not the
    // broader "Internal Corporate Staff" role — cost figures stay out of view for staff
    // who only need quantities issued.
    const isSuperAdmin = staffUser?.isAdmin === true;

    const [activeTab, setActiveTab] = useState('ledger');

    const todayStr = todayPKT();
    const defaultFrom = (() => {
        const d = new Date(todayStr);
        d.setUTCDate(d.getUTCDate() - 29);
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
    const [newItemCategory, setNewItemCategory] = useState('feed');
    const [newItemUnit, setNewItemUnit] = useState('kg');

    const handleAddItem = (e) => {
        e.preventDefault();
        if (!isAdmin || !newItemName.trim()) return;
        addStockTrackedIngredient(newItemName.trim(), newItemCategory, newItemUnit.trim() || 'kg');
        setNewItemName('');
        setNewItemCategory('feed');
        setNewItemUnit('kg');
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
    // Lets an admin add a brand-new stock item right from the purchase form (e.g. a feed,
    // medicine, or other supply that's never been bought before) instead of a round trip
    // to the Stock Ledger tab first.
    const [pNewItemName, setPNewItemName] = useState('');
    const [pNewItemCategory, setPNewItemCategory] = useState('feed');
    const [pNewItemUnit, setPNewItemUnit] = useState('kg');

    const handleAddPurchase = (e) => {
        e.preventDefault();
        if (!isAdmin || !pQty || !pRate) return;
        let itemId = pItemId;
        let itemNameVal = '';
        let itemUnitVal = pNewItemUnit.trim() || 'kg';
        if (itemId === '__new__') {
            if (!pNewItemName.trim()) return;
            itemNameVal = pNewItemName.trim();
            itemId = addStockTrackedIngredient(pNewItemName.trim(), pNewItemCategory, pNewItemUnit.trim() || 'kg');
        } else {
            const found = feedStockItems.find(i => i.id === itemId);
            itemNameVal = found?.name || itemId;
            itemUnitVal = found?.unit || 'kg';
        }
        if (!itemId) return;
        addFeedPurchase({ date: pDate, itemId, itemName: itemNameVal, itemUnit: itemUnitVal, quantity: pQty, rate: pRate, supplier: pSupplier, notes: pNotes });
        setPItemId('');
        setPNewItemName('');
        setPNewItemCategory('feed');
        setPNewItemUnit('kg');
        setPQty('');
        setPRate('');
        setPSupplier('');
        setPNotes('');
    };

    const pendingPurchasesById = useMemo(() => {
        const map = {};
        (myRequests || []).filter(r => r.status === 'pending' && (r.action === 'ADD_FEED_PURCHASE' || r.action === 'DELETE_FEED_PURCHASE')).forEach(r => {
            const id = r.payload?.id;
            if (id) map[id] = r.action === 'DELETE_FEED_PURCHASE' ? 'delete' : 'add';
        });
        return map;
    }, [myRequests]);

    const effectiveFeedPurchases = useMemo(() => {
        const list = [...feedPurchases];
        (myRequests || []).forEach(r => {
            if (r.status === 'pending' && r.action === 'ADD_FEED_PURCHASE' && r.payload?.id) {
                if (!list.some(p => p.id === r.payload.id)) {
                    list.push(r.payload);
                }
            }
        });
        return list;
    }, [feedPurchases, myRequests]);

    const filteredPurchases = useMemo(() =>
        effectiveFeedPurchases.filter(p => inRange(p.date)).sort((a, b) => daysBetween(b.date, a.date)),
        [effectiveFeedPurchases, dateFrom, dateTo]
    );

    // ─── ISSUES ───
    const [iDate, setIDate] = useState(todayStr);
    const [iItemId, setIItemId] = useState('');
    const [iPen, setIPen] = useState('');
    const [iQty, setIQty] = useState('');
    const [iLotId, setILotId] = useState('');
    const [iNotes, setINotes] = useState('');

    const handleAddIssue = (e) => {
        e.preventDefault();
        if (!isAdmin || !iItemId || !iPen || !iQty) return;
        const found = feedStockItems.find(i => i.id === iItemId);
        const itemNameVal = found?.name || iItemId;
        const itemUnitVal = found?.unit || 'kg';
        addFeedStockIssue({ date: iDate, itemId: iItemId, itemName: itemNameVal, itemUnit: itemUnitVal, pen: iPen, quantity: iQty, lotId: iLotId || null, notes: iNotes });
        setIQty('');
        setILotId('');
        setINotes('');
    };

    const pendingIssuesById = useMemo(() => {
        const map = {};
        (myRequests || []).filter(r => r.status === 'pending' && (r.action === 'ADD_FEED_STOCK_ISSUE' || r.action === 'DELETE_FEED_STOCK_ISSUE')).forEach(r => {
            const id = r.payload?.id;
            if (id) map[id] = r.action === 'DELETE_FEED_STOCK_ISSUE' ? 'delete' : 'add';
        });
        return map;
    }, [myRequests]);

    const effectiveFeedStockIssues = useMemo(() => {
        const list = [...feedStockIssues];
        (myRequests || []).forEach(r => {
            if (r.status === 'pending' && r.action === 'ADD_FEED_STOCK_ISSUE' && r.payload?.id) {
                if (!list.some(i => i.id === r.payload.id)) {
                    list.push(r.payload);
                }
            }
        });
        return list;
    }, [feedStockIssues, myRequests]);

    // Auto-derived (from TMR "Log This Feeding" records) + manual exception issues,
    // merged and tagged by source — so routine pen feeding never has to be typed twice.
    const combinedIssues = useMemo(() => {
        const autoIssues = [];
        feedLogs.forEach(log => {
            (log.ingredients || []).forEach(ing => {
                feedStockItems.forEach(item => {
                    if (!item.derivedFromIngredientId || item.derivedFromIngredientId !== ing.id) return;
                    const share = item.id === 'limestone' ? mineralSplitRatio
                        : item.id === 'mineralPack' ? (1 - mineralSplitRatio)
                        : 1;
                    const quantity = (ing.wetBatch || 0) * share;
                    if (quantity > 0) {
                        const planned = ing.plannedQtyKg;
                        const actual = ing.dmTarget;
                        const differed = planned !== undefined && Math.abs((actual || 0) - planned) > 0.0005;
                        const itemNote = !differed ? 'Auto-synced from TMR feed log'
                            : planned === 0
                                ? 'Auto-synced from TMR feed log — added, not in Ration Plan'
                                : `Auto-synced from TMR feed log — diet differed from plan (planned ${planned.toFixed(2)}kg/head, fed ${(actual || 0).toFixed(2)}kg/head)`;
                        autoIssues.push({
                            id: `auto__${log.date}__${log.pen}__${item.id}`,
                            itemId: item.id,
                            date: log.date,
                            pen: log.pen,
                            quantity,
                            notes: itemNote,
                            dietDiffered: differed,
                            source: 'auto'
                        });
                    }
                });
            });
        });
        const manualIssues = effectiveFeedStockIssues.map(i => ({ ...i, source: 'manual' }));
        return [...autoIssues, ...manualIssues];
    }, [feedLogs, feedStockItems, effectiveFeedStockIssues, mineralSplitRatio]);

    const filteredIssues = useMemo(() =>
        combinedIssues.filter(i => inRange(i.date)).sort((a, b) => daysBetween(b.date, a.date)),
        [combinedIssues, dateFrom, dateTo]
    );

    // Full-history ledger (opening + all-time purchases/issues) — closing stock is
    // always a current, all-time snapshot regardless of the Purchases/Issues date filter.
    const ledger = useMemo(() => getFeedStockLedger(), [feedStockItems, feedOpeningStock, feedPurchases, feedLogs, feedStockIssues, mineralSplitRatio]);
    const ledgerByItemId = useMemo(() => Object.fromEntries(ledger.map(l => [l.item.id, l])), [ledger]);

    // FIFO lots per item (each purchase + opening balance, with remaining qty after every
    // issue drawn against it) — feeds the Purchase History "remaining" column and every
    // lot-picker dropdown (premix batch / manual issue).
    const lotsByItemId = useMemo(() =>
        Object.fromEntries(feedStockItems.map(i => [i.id, getFeedStockLots(i.id)])),
        [feedStockItems, feedOpeningStock, feedPurchases, feedLogs, feedStockIssues, mineralSplitRatio]
    );

    // Per-issue FIFO cost — each issue priced at the actual lot(s) it drew from, not one
    // blended item-wide rate.
    const issueCosts = useMemo(() => getFeedStockIssueCosts(),
        [feedStockItems, feedOpeningStock, feedPurchases, feedLogs, feedStockIssues, mineralSplitRatio]
    );

    // Actual cost per pen within the selected date range, priced at each issue's own
    // FIFO cost.
    // Feed-only: mixing feed kg with e.g. medicine ml/doses into one "qty issued" total
    // would be meaningless, so this summary (titled "Actual Feed Cost by Pen") sticks to
    // feed-category items. Cost still totals fine across units — only the raw qty column
    // needs a single, consistent unit to mean anything.
    const perPenCost = useMemo(() => {
        const totals = {};
        filteredIssues.forEach(iss => {
            const item = feedStockItems.find(i => i.id === iss.itemId);
            if ((item?.category || 'feed') !== 'feed') return;
            const cost = issueCosts[iss.id]?.cost ?? 0;
            const pen = iss.pen || 'ALL';
            if (!totals[pen]) totals[pen] = { pen, qty: 0, cost: 0, items: {} };
            totals[pen].qty += iss.quantity;
            totals[pen].cost += cost;
            // Item-level breakdown so a lump total (e.g. "All Pens · 30kg · 2,200 PKR") is
            // never left to speak for itself — a glance at the row says what it actually
            // was (a single manual "Chokar" issue, vs. a real multi-ingredient TMR day).
            const name = item?.name || iss.itemId;
            totals[pen].items[name] = (totals[pen].items[name] || 0) + iss.quantity;
        });
        return Object.values(totals)
            .map(row => ({
                ...row,
                itemBreakdown: Object.entries(row.items)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, qty]) => `${name} (${qty.toFixed(2)} kg)`)
                    .join(', ')
            }))
            .sort((a, b) => b.cost - a.cost);
    }, [filteredIssues, issueCosts, feedStockItems]);

    const totalStockValue = ledger.reduce((sum, l) => sum + l.closingValue, 0);
    const totalConsumptionValue = filteredIssues.reduce((sum, iss) => sum + (issueCosts[iss.id]?.cost ?? 0), 0);

    const itemName = (id, rec) => {
        if (rec?.itemName && !rec.itemName.startsWith('item_')) return rec.itemName;
        const found = feedStockItems.find(i => i.id === id);
        if (found?.name) return found.name;

        for (const req of [...(myRequests || []), ...(pendingApprovals || [])]) {
            if (req.action === 'SAVE_SETTINGS' && req.payload?.key === 'feed_stock_items' && Array.isArray(req.payload?.value)) {
                const pendingItem = req.payload.value.find(i => i.id === id);
                if (pendingItem?.name) return pendingItem.name;
            }
            if (req.payload?.newItem?.id === id && req.payload.newItem.name) {
                return req.payload.newItem.name;
            }
            if (req.payload?.itemId === id && req.payload?.itemName && !req.payload.itemName.startsWith('item_')) {
                return req.payload.itemName;
            }
        }
        return (rec?.itemName && !rec.itemName.startsWith('item_')) ? rec.itemName : id;
    };

    const itemUnit = (id, rec) => {
        if (rec?.itemUnit) return rec.itemUnit;
        const found = feedStockItems.find(i => i.id === id);
        if (found?.unit) return found.unit;

        for (const req of [...(myRequests || []), ...(pendingApprovals || [])]) {
            if (req.action === 'SAVE_SETTINGS' && req.payload?.key === 'feed_stock_items' && Array.isArray(req.payload?.value)) {
                const pendingItem = req.payload.value.find(i => i.id === id);
                if (pendingItem?.unit) return pendingItem.unit;
            }
            if (req.payload?.newItem?.id === id && req.payload.newItem.unit) {
                return req.payload.newItem.unit;
            }
            if (req.payload?.itemId === id && req.payload?.itemUnit) {
                return req.payload.itemUnit;
            }
        }
        return 'kg';
    };
    const itemCategory = (id) => feedStockItems.find(i => i.id === id)?.category || 'feed';
    const penLabel = (pen) => pen === 'ALL' ? 'All Pens' : pen === 'PRODUCTION' ? 'Premix Production' : `Pen ${pen}`;

    // ─── ITEM CATEGORIES ───
    // Feed items double as TMR ration ingredients (see addStockTrackedIngredient); medicine
    // and "other" items are purchase/issue-tracked only — they never appear in a ration.
    const CATEGORY_LABELS = { feed: 'Feed', medicine: 'Medicine', other: 'Other' };
    const groupItemsByCategory = (items) => {
        const groups = { feed: [], medicine: [], other: [] };
        items.forEach(i => { (groups[i.category || 'feed'] || groups.other).push(i); });
        return groups;
    };

    // ─── PREMIX PRODUCTION (e.g. "Wanda") ───
    const [isAddPremixFormOpen, setIsAddPremixFormOpen] = useState(false);
    const [newPremixName, setNewPremixName] = useState('');

    const handleAddPremixType = (e) => {
        e.preventDefault();
        if (!isAdmin || !newPremixName.trim()) return;
        const id = addPremixType(newPremixName.trim());
        setNewPremixName('');
        setIsAddPremixFormOpen(false);
        if (id) setSelectedPremixId(id);
    };

    const handleDeletePremixType = (id) => {
        if (!isAdmin) return;
        if (window.confirm('Remove this premix? Its formula and stock line are removed too. Past batch history stays on record but will no longer reference a live formula.')) {
            deletePremixType(id);
            if (selectedPremixId === id) setSelectedPremixId('');
        }
    };

    // Raw materials a formula can draw from — every feed-category stock item except premix
    // items themselves (so a premix can't accidentally be defined in terms of another
    // premix), and never medicine/other items, which aren't fed as part of a ration.
    const rawMaterialItems = feedStockItems.filter(i => !i.isPremix && (i.category || 'feed') === 'feed');

    const [selectedPremixId, setSelectedPremixId] = useState(() => premixTypes[0]?.id || '');
    React.useEffect(() => {
        if (!selectedPremixId && premixTypes.length) setSelectedPremixId(premixTypes[0].id);
    }, [premixTypes]);

    const [formulaDraft, setFormulaDraft] = useState([]);
    React.useEffect(() => {
        setFormulaDraft((premixFormulas[selectedPremixId] || []).map(r => ({ ...r })));
    }, [selectedPremixId, premixFormulas]);

    const handleFormulaRowChange = (idx, field, value) => {
        setFormulaDraft(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    };
    const handleAddFormulaRow = () => {
        const firstUnused = rawMaterialItems.find(i => !formulaDraft.some(r => r.stockItemId === i.id));
        if (!firstUnused) return;
        setFormulaDraft(prev => [...prev, { stockItemId: firstUnused.id, qtyPerKg: '' }]);
    };
    const handleRemoveFormulaRow = (idx) => {
        setFormulaDraft(prev => prev.filter((_, i) => i !== idx));
    };
    // Mass balance: kg of raw material in must equal kg of premix out (no water/loss
    // tracked), so every formula's qtyPerKg values must sum to exactly 1kg per kg of
    // premix produced — otherwise a batch would credit more (or less) premix stock than
    // the raw materials it actually deducted justify.
    const formulaSum = formulaDraft.reduce((sum, r) => sum + (parseFloat(r.qtyPerKg) || 0), 0);
    const FORMULA_TOLERANCE = 0.005;
    const formulaIsBalanced = Math.abs(formulaSum - 1) <= FORMULA_TOLERANCE;

    const handleSaveFormula = () => {
        if (!isAdmin || !selectedPremixId) return;
        if (!formulaIsBalanced) {
            window.alert(`Formula doesn't add up: ${formulaSum.toFixed(3)} kg of raw material per kg of premix (needs to total 1.000 kg, i.e. 100%). Adjust the quantities before saving.`);
            return;
        }
        updatePremixFormula(selectedPremixId, formulaDraft.map(r => ({
            stockItemId: r.stockItemId,
            qtyPerKg: parseFloat(r.qtyPerKg) || 0
        })));
    };

    // ─── LOG A BATCH ───
    const [bPremixId, setBPremixId] = useState('');
    const [bDate, setBDate] = useState(todayStr);
    const [bBagWeight, setBBagWeight] = useState('');
    const [bBagCount, setBBagCount] = useState('');
    const [bTotalKg, setBTotalKg] = useState('');
    const [bNotes, setBNotes] = useState('');
    // { stockItemId: lotId } — an explicit lot picked for a raw material that has more
    // than one lot with stock left; anything not in here draws FIFO (oldest first).
    const [bLotOverrides, setBLotOverrides] = useState({});

    // Bags are free-weight (no fixed 25kg/50kg assumption) — entering bag weight × count
    // is just a convenience that fills in total kg; total kg can also be typed directly.
    const handleBagFieldChange = (field, value) => {
        if (field === 'bagWeight') setBBagWeight(value);
        if (field === 'bagCount') setBBagCount(value);
        const w = field === 'bagWeight' ? parseFloat(value) || 0 : parseFloat(bBagWeight) || 0;
        const c = field === 'bagCount' ? parseFloat(value) || 0 : parseFloat(bBagCount) || 0;
        if (w > 0 && c > 0) setBTotalKg((w * c).toString());
    };

    // Priced FIFO, per raw material — draws the oldest lot with stock left first, unless
    // overridden via bLotOverrides, so "this batch will consume" always traces back to
    // the actual invoice(s) it's costed against instead of a blended item-wide average.
    const batchPreview = useMemo(() => {
        const totalKg = parseFloat(bTotalKg) || 0;
        if (!bPremixId || totalKg <= 0) return null;
        const formula = premixFormulas[bPremixId] || [];
        const rows = formula.map(row => {
            const qty = totalKg * (parseFloat(row.qtyPerKg) || 0);
            const lotChoices = (lotsByItemId[row.stockItemId] || []).filter(l => l.remaining > 0.005);
            const lots = lotChoices.map(l => ({ ...l }));
            const { cost, rate } = allocateFifo(lots, qty, bLotOverrides[row.stockItemId] || null);
            return { stockItemId: row.stockItemId, qty, rate, cost, lotChoices, available: ledgerByItemId[row.stockItemId]?.closingQty ?? 0 };
        });
        const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
        return { rows, totalCost, costPerKg: totalKg > 0 ? totalCost / totalKg : 0 };
    }, [bPremixId, bTotalKg, premixFormulas, lotsByItemId, ledgerByItemId, bLotOverrides]);

    const handleLogBatch = (e) => {
        e.preventDefault();
        if (!isAdmin || !bPremixId || !bTotalKg) return;
        addPremixBatch({
            premixTypeId: bPremixId, date: bDate, totalKg: bTotalKg,
            bagWeight: bBagWeight, bagCount: bBagCount, notes: bNotes,
            lotOverrides: bLotOverrides
        });
        setBBagWeight('');
        setBBagCount('');
        setBTotalKg('');
        setBNotes('');
        setBLotOverrides({});
    };

    const sortedBatches = useMemo(() =>
        [...premixBatches].sort((a, b) => daysBetween(b.date, a.date)),
        [premixBatches]
    );

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
                        <strong style={{ color: 'var(--text-pure)' }}>How this works:</strong> Set each item's <strong>Opening Stock</strong> once — the balance physically in the store before you started tracking here (leave at 0 kg if this is a fresh start). Then log dated <strong>Purchases</strong> (qty, rate, supplier) as feed comes in. Routine <strong>Issues</strong> to a pen sync automatically from every "Log This Feeding" entry in the TMR Calculator — no need to re-enter them here; the Issues tab is only for exceptions (spoilage, samples, a sale out of the store). Closing stock and actual cost per pen are calculated automatically, FIFO — each purchase is its own dated lot, and issues draw the oldest lot with stock left first (you can pick a different lot yourself when logging a premix batch or a manual issue, if more than one has stock left).
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
                <button class={`filter-btn ${activeTab === 'premix' ? 'active' : ''}`} onClick={() => setActiveTab('premix')}>
                    <i class="fa-solid fa-flask"></i> Premix Production
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
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.8rem', alignItems: 'flex-end' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Item Name</label>
                                        <input type="text" class="form-control" placeholder="e.g. Molasses" value={newItemName} onChange={e => setNewItemName(e.target.value)} required />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Category</label>
                                        <select class="form-control" value={newItemCategory} onChange={e => setNewItemCategory(e.target.value)}>
                                            <option value="feed">Feed (rationable)</option>
                                            <option value="medicine">Medicine</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Unit</label>
                                        <input type="text" class="form-control" placeholder="kg, ml, dose…" value={newItemUnit} onChange={e => setNewItemUnit(e.target.value)} />
                                    </div>
                                    <button type="submit" class="btn btn-primary">Add</button>
                                </div>
                                {newItemCategory !== 'feed' && (
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.6rem', marginBottom: 0 }}>
                                        <i class="fa-solid fa-circle-info"></i> {CATEGORY_LABELS[newItemCategory]} items are tracked for purchases/stock only — they won't appear as a selectable TMR ration ingredient.
                                    </p>
                                )}
                            </form>
                        )}

                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>ITEM</th>
                                        <th>CATEGORY</th>
                                        <th>OPENING STOCK</th>
                                        <th>PURCHASED</th>
                                        <th>ISSUED</th>
                                        <th>CLOSING STOCK</th>
                                        <th title="Weighted-average rate of the stock still in the store (FIFO — depleted lots don't drag it down/up)">AVG RATE</th>
                                        <th>STOCK VALUE</th>
                                        {isAdmin && <th style={{ textAlign: 'center' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {ledger.map(row => {
                                        const unit = row.item.unit || 'kg';
                                        return (
                                        <tr key={row.item.id}>
                                            <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{row.item.name}</td>
                                            <td style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{CATEGORY_LABELS[row.item.category || 'feed']}</td>
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
                                                            title={`Opening qty (${unit})`}
                                                        />
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{unit} @</span>
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
                                                    <span>{(Number(row.openingQty) || 0).toFixed(2)} {unit} ({Math.round(row.openingValue).toLocaleString()} PKR)</span>
                                                )}
                                            </td>
                                            <td>{(Number(row.purchasedQty) || 0).toFixed(2)} {unit}</td>
                                            <td>{(Number(row.issuedQty) || 0).toFixed(2)} {unit}</td>
                                            <td><strong style={{ color: row.closingQty < 0 ? 'hsl(0,75%,60%)' : 'var(--primary-green-light)' }}>{(Number(row.closingQty) || 0).toFixed(2)} {unit}</strong></td>
                                            <td>{(Number(row.avgRate) || 0).toFixed(2)} PKR/{unit}</td>
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
                                        );
                                    })}
                                    {ledger.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 9 : 8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
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
                                        {Object.entries(groupItemsByCategory(feedStockItems)).map(([cat, items]) => items.length > 0 && (
                                            <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                                                {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                            </optgroup>
                                        ))}
                                        <option value="__new__">+ Add new item…</option>
                                    </select>
                                </div>
                                {pItemId === '__new__' && (
                                    <>
                                        <div class="form-group">
                                            <label>New Item Name</label>
                                            <input type="text" class="form-control" placeholder="e.g. Molasses" value={pNewItemName} onChange={e => setPNewItemName(e.target.value)} required />
                                        </div>
                                        <div class="form-group">
                                            <label>Category</label>
                                            <select class="form-control" value={pNewItemCategory} onChange={e => setPNewItemCategory(e.target.value)}>
                                                <option value="feed">Feed (rationable)</option>
                                                <option value="medicine">Medicine</option>
                                                <option value="other">Other</option>
                                            </select>
                                        </div>
                                        <div class="form-group">
                                            <label>Unit</label>
                                            <input type="text" class="form-control" placeholder="kg, ml, dose…" value={pNewItemUnit} onChange={e => setPNewItemUnit(e.target.value)} />
                                        </div>
                                    </>
                                )}
                                <div class="form-group">
                                    <label>Quantity ({pItemId === '__new__' ? (pNewItemUnit.trim() || 'kg') : itemUnit(pItemId) || 'kg'})</label>
                                    <input type="number" step="0.01" class="form-control" placeholder="e.g. 500" value={pQty} onChange={e => setPQty(e.target.value)} required />
                                </div>
                                <div class="form-group">
                                    <label>Rate (PKR/{pItemId === '__new__' ? (pNewItemUnit.trim() || 'kg') : itemUnit(pItemId) || 'kg'})</label>
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
                                        <th>REMAINING</th>
                                        {isAdmin && <th>STATUS</th>}
                                        {isAdmin && <th style={{ textAlign: 'center', width: '60px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredPurchases.map(p => {
                                        const lot = lotsByItemId[p.itemId]?.find(l => l.id === p.id);
                                        const remaining = lot ? lot.remaining : p.quantity;
                                        const touched = remaining < p.quantity - 0.005;
                                        const unit = itemUnit(p.itemId, p);
                                        const pending = pendingPurchasesById[p.id];
                                        return (
                                            <tr key={p.id} style={pending ? { opacity: 0.65 } : undefined}>
                                                <td>{formatDate(p.date)}</td>
                                                <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{itemName(p.itemId, p)}</td>
                                                <td>{(Number(p.quantity) || 0).toFixed(2)} {unit}</td>
                                                <td>{(Number(p.rate) || 0).toFixed(2)} PKR/{unit}</td>
                                                <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(p.quantity * p.rate).toLocaleString()} PKR</strong></td>
                                                <td>{p.supplier || '—'}</td>
                                                <td style={{ color: remaining <= 0.005 ? 'var(--text-muted)' : 'var(--primary-green-light)' }}>{(Number(Math.max(0, remaining)) || 0).toFixed(2)} {unit}</td>
                                                {isAdmin && (
                                                    <td>
                                                        {pending === 'add' && <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', background: 'rgba(255,193,7,0.12)', color: 'hsl(43,90%,53%)' }}><i class="fa-solid fa-hourglass-half"></i> Pending Approval</span>}
                                                        {pending === 'delete' && <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', background: 'rgba(220,53,69,0.12)', color: 'hsl(0,75%,65%)' }}><i class="fa-solid fa-hourglass-half"></i> Pending Removal</span>}
                                                        {!pending && isSuperAdmin && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Confirmed</span>}
                                                    </td>
                                                )}
                                                {isAdmin && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        {!pending && (
                                                            p.supplier === 'In-house production' ? (
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }} title="Credited by a premix batch — undo it from the Premix Production tab instead"><i class="fa-solid fa-lock"></i></span>
                                                            ) : touched ? (
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }} title="This lot has already been (partly or fully) drawn from — removing it would reprice whatever was costed against it. Undo those issues/batches first."><i class="fa-solid fa-lock"></i></span>
                                                            ) : (
                                                                <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => deleteFeedPurchase(p.id)}>
                                                                    <i class="fa-solid fa-trash-can"></i>
                                                                </button>
                                                            )
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                    {filteredPurchases.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 9 : 7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
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
                                    <select class="form-control" value={iItemId} onChange={e => { setIItemId(e.target.value); setILotId(''); }} required>
                                        <option value="">Select item…</option>
                                        {Object.entries(groupItemsByCategory(feedStockItems)).map(([cat, items]) => items.length > 0 && (
                                            <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                                                {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                            </optgroup>
                                        ))}
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
                                    <label>Quantity ({iItemId ? itemUnit(iItemId) : 'kg'})</label>
                                    <input type="number" step="0.01" class="form-control" placeholder="e.g. 45.5" value={iQty} onChange={e => setIQty(e.target.value)} required />
                                </div>
                                {(() => {
                                    const availableLots = (lotsByItemId[iItemId] || []).filter(l => l.remaining > 0.005);
                                    if (availableLots.length <= 1) return null;
                                    const unit = itemUnit(iItemId);
                                    return (
                                        <div class="form-group">
                                            <label>Draw From</label>
                                            <select class="form-control" value={iLotId} onChange={e => setILotId(e.target.value)}>
                                                <option value="">Auto (FIFO — oldest first)</option>
                                                {availableLots.map(l => (
                                                    <option key={l.id} value={l.id}>{formatDate(l.date)} · {l.supplier || '—'} · {l.rate.toFixed(2)} PKR/{unit} · {l.remaining.toFixed(0)}{unit} left</option>
                                                ))}
                                            </select>
                                        </div>
                                    );
                                })()}
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
                            <i class="fa-solid fa-circle-info"></i> Each pen's consumption priced at the FIFO cost of the actual lot(s) it was drawn from — the real cost of what actually left the store for that pen, not the ration's reference price.
                        </p>
                        <div class="table-wrapper" style={{ marginBottom: '1.2rem' }}>
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>PEN</th>
                                        <th>QTY ISSUED</th>
                                        {isSuperAdmin && <th>ACTUAL FEED COST</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {perPenCost.map(row => (
                                        <tr key={row.pen}>
                                            <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                                {penLabel(row.pen)}
                                                <div style={{ fontWeight: '400', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{row.itemBreakdown}</div>
                                            </td>
                                            <td>{row.qty.toFixed(2)} kg</td>
                                            {isSuperAdmin && <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(row.cost).toLocaleString()} PKR</strong></td>}
                                        </tr>
                                    ))}
                                    {perPenCost.length === 0 && (
                                        <tr>
                                            <td colSpan={isSuperAdmin ? 3 : 2} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
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
                                        {isAdmin && <th>STATUS</th>}
                                        {isAdmin && <th style={{ textAlign: 'center', width: '60px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredIssues.map(iss => {
                                        const pending = pendingIssuesById[iss.id];
                                        return (
                                        <tr key={iss.id} style={pending ? { opacity: 0.65 } : undefined}>
                                            <td>{formatDate(iss.date)}</td>
                                            <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{itemName(iss.itemId, iss)}</td>
                                            <td>{penLabel(iss.pen)}</td>
                                            <td>{(Number(iss.quantity) || 0).toFixed(2)} {itemUnit(iss.itemId, iss)}</td>
                                            <td>
                                                {iss.source === 'auto' ? (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--primary-green-light)' }}><i class="fa-solid fa-arrows-rotate"></i> TMR log</span>
                                                ) : iss.pen === 'PRODUCTION' ? (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--accent-gold)' }}><i class="fa-solid fa-flask"></i> Premix batch</span>
                                                ) : (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-pen"></i> Manual</span>
                                                )}
                                            </td>
                                            <td style={{ color: iss.dietDiffered ? 'var(--accent-gold)' : 'var(--text-muted)', fontSize: '0.78rem' }}>
                                                {iss.dietDiffered && <i class="fa-solid fa-triangle-exclamation" style={{ marginRight: '0.3rem' }}></i>}
                                                {iss.notes || '—'}
                                            </td>
                                            {isAdmin && (
                                                <td>
                                                    {pending === 'add' && <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', background: 'rgba(255,193,7,0.12)', color: 'hsl(43,90%,53%)' }}><i class="fa-solid fa-hourglass-half"></i> Pending Approval</span>}
                                                    {pending === 'delete' && <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', background: 'rgba(220,53,69,0.12)', color: 'hsl(0,75%,65%)' }}><i class="fa-solid fa-hourglass-half"></i> Pending Removal</span>}
                                                    {!pending && isSuperAdmin && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Confirmed</span>}
                                                </td>
                                            )}
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }}>
                                                    {!pending && (
                                                        iss.source === 'auto' ? (
                                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }} title="Auto-synced from a TMR feed log — edit or delete it from the TMR Calculator's Recent Feed History instead"><i class="fa-solid fa-lock"></i></span>
                                                        ) : iss.pen === 'PRODUCTION' ? (
                                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }} title="Consumed by a premix batch — undo it from the Premix Production tab instead"><i class="fa-solid fa-lock"></i></span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                class="btn btn-secondary"
                                                                style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                                onClick={() => {
                                                                    if (window.confirm(`Undo this issue?\n\n${formatDate(iss.date)} · ${itemName(iss.itemId)} · ${iss.quantity.toFixed(2)} ${itemUnit(iss.itemId)}\n\nThis cannot be undone.`)) {
                                                                        deleteFeedStockIssue(iss.id);
                                                                    }
                                                                }}
                                                                title="Undo this issue"
                                                            >
                                                                <i class="fa-solid fa-trash-can"></i>
                                                            </button>
                                                        )
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                        );
                                    })}
                                    {filteredIssues.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 8 : 6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
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

            {/* ═══ TAB: PREMIX PRODUCTION ═══ */}
            {activeTab === 'premix' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {isAdmin && (
                        <div style={{ background: 'rgba(74, 144, 217, 0.06)', border: '1px solid rgba(74, 144, 217, 0.18)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                            <i class="fa-solid fa-circle-info" style={{ color: '#4a90d9', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                                <strong style={{ color: 'var(--text-pure)' }}>How this works:</strong> Define one or more house premixes (e.g. "Wanda") with a <strong>Formula</strong> — which raw materials from the store, and how many kg of each go into 1 kg of premix. Then <strong>Log a Batch</strong> whenever you actually mix and bag one: it deducts those raw materials from stock and credits the premix's own stock, priced at what that batch actually cost to make. Each premix also appears as its own line in the Stock Ledger and as an ingredient in the TMR recipe — feed it (and log it) exactly like Silage or Maize.
                            </span>
                        </div>
                    )}

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-flask"></i> Premix Types</h3>
                            {isAdmin && (
                                <button type="button" class="btn btn-secondary btn-sm" onClick={() => setIsAddPremixFormOpen(!isAddPremixFormOpen)}>
                                    <i class={`fa-solid ${isAddPremixFormOpen ? 'fa-xmark' : 'fa-plus'}`}></i> {isAddPremixFormOpen ? 'Cancel' : 'Add Premix'}
                                </button>
                            )}
                        </div>

                        {isAddPremixFormOpen && (
                            <form onSubmit={handleAddPremixType} style={{ background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr auto', gap: '0.8rem', alignItems: 'flex-end' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Premix Name</label>
                                        <input type="text" class="form-control" placeholder="e.g. Wanda" value={newPremixName} onChange={e => setNewPremixName(e.target.value)} required />
                                    </div>
                                    <button type="submit" class="btn btn-primary">Add</button>
                                </div>
                            </form>
                        )}

                        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                            {premixTypes.map(p => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '0.35rem 0.5rem 0.35rem 0.9rem' }}>
                                    <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-pure)' }}>{p.name}</span>
                                    {isAdmin && (
                                        <button type="button" class="btn btn-secondary" style={{ padding: '0.1rem 0.4rem', minHeight: '24px', height: '24px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => handleDeletePremixType(p.id)}>
                                            <i class="fa-solid fa-trash-can" style={{ fontSize: '0.7rem' }}></i>
                                        </button>
                                    )}
                                </div>
                            ))}
                            {premixTypes.length === 0 && (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>No premix types yet — add one above to get started.</p>
                            )}
                        </div>
                    </div>

                    {premixTypes.length > 0 && (
                        <div class="glass-panel">
                            <h3 class="panel-title"><i class="fa-solid fa-list-check"></i> Formula</h3>
                            <div class="form-group" style={{ maxWidth: '280px' }}>
                                <label style={{ fontSize: '0.75rem' }}>Premix</label>
                                <select class="form-control" value={selectedPremixId} onChange={e => setSelectedPremixId(e.target.value)}>
                                    <option value="">Select premix…</option>
                                    {premixTypes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </div>

                            {selectedPremixId && (
                                <div style={{ marginTop: '1rem' }}>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 0 }}>
                                        kg of raw material needed per 1 kg of {premixTypes.find(p => p.id === selectedPremixId)?.name} produced.
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                        {formulaDraft.map((row, idx) => (
                                            <div key={idx} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                                                <select
                                                    class="form-control" style={{ flex: 1 }}
                                                    value={row.stockItemId}
                                                    onChange={e => handleFormulaRowChange(idx, 'stockItemId', e.target.value)}
                                                    disabled={!isAdmin}
                                                >
                                                    {rawMaterialItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                                </select>
                                                <input
                                                    type="number" step="0.001" class="form-control" style={{ width: '140px' }}
                                                    placeholder="kg / kg premix" value={row.qtyPerKg}
                                                    onChange={e => handleFormulaRowChange(idx, 'qtyPerKg', e.target.value)}
                                                    disabled={!isAdmin}
                                                />
                                                {isAdmin && (
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => handleRemoveFormulaRow(idx)}>
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        {formulaDraft.length === 0 && (
                                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No raw materials added to this formula yet.</p>
                                        )}
                                    </div>
                                    {formulaDraft.length > 0 && (
                                        <p style={{ fontSize: '0.82rem', marginTop: '0.8rem', marginBottom: 0, color: formulaIsBalanced ? 'var(--primary-green-light)' : 'hsl(0,75%,65%)' }}>
                                            <i class={`fa-solid ${formulaIsBalanced ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i>{' '}
                                            Total: {formulaSum.toFixed(3)} kg per kg of premix ({Math.round(formulaSum * 100)}%)
                                            {!formulaIsBalanced && ' — must total 1.000 kg (100%) before this formula can be saved'}
                                        </p>
                                    )}
                                    {isAdmin && (
                                        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
                                            <button type="button" class="btn btn-secondary" onClick={handleAddFormulaRow} disabled={formulaDraft.length >= rawMaterialItems.length}>
                                                <i class="fa-solid fa-plus"></i> Add Raw Material
                                            </button>
                                            <button type="button" class="btn btn-primary" onClick={handleSaveFormula} disabled={!formulaIsBalanced}>
                                                <i class="fa-solid fa-floppy-disk"></i> Save Formula
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {isAdmin && premixTypes.length > 0 && (
                        <div class="glass-panel">
                            <h3 class="panel-title"><i class="fa-solid fa-circle-plus"></i> Log a Batch</h3>
                            <form onSubmit={handleLogBatch} class="form-grid-3" style={{ alignItems: 'flex-end' }}>
                                <div class="form-group">
                                    <label>Premix</label>
                                    <select class="form-control" value={bPremixId} onChange={e => setBPremixId(e.target.value)} required>
                                        <option value="">Select premix…</option>
                                        {premixTypes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Date</label>
                                    <input type="date" class="form-control" value={bDate} max={todayStr} onChange={e => setBDate(e.target.value)} required />
                                </div>
                                <div class="form-group">
                                    <label>Bag Weight (kg, optional)</label>
                                    <input type="number" step="0.01" class="form-control" placeholder="any weight" value={bBagWeight} onChange={e => handleBagFieldChange('bagWeight', e.target.value)} />
                                </div>
                                <div class="form-group">
                                    <label>Bag Count (optional)</label>
                                    <input type="number" step="1" class="form-control" placeholder="e.g. 10" value={bBagCount} onChange={e => handleBagFieldChange('bagCount', e.target.value)} />
                                </div>
                                <div class="form-group">
                                    <label>Total Produced (kg)</label>
                                    <input type="number" step="0.01" class="form-control" placeholder="e.g. 250" value={bTotalKg} onChange={e => setBTotalKg(e.target.value)} required />
                                </div>
                                <div class="form-group">
                                    <label>Notes</label>
                                    <input type="text" class="form-control" placeholder="Optional" value={bNotes} onChange={e => setBNotes(e.target.value)} />
                                </div>

                                {batchPreview && (
                                    <div style={{ gridColumn: '1 / -1', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '0.8rem 1rem' }}>
                                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>This batch will consume:</p>
                                        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: 'var(--text-pure)', listStyle: 'none' }}>
                                            {batchPreview.rows.map(r => (
                                                <li key={r.stockItemId} style={{ marginBottom: '0.4rem', color: r.qty > r.available ? 'hsl(0,75%,65%)' : 'var(--text-pure)' }}>
                                                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <span>{itemName(r.stockItemId)}: {r.qty.toFixed(2)} kg ({Math.round(r.cost).toLocaleString()} PKR{r.rate ? ` @ ${r.rate.toFixed(2)}/kg` : ''})</span>
                                                        {r.lotChoices.length > 1 && (
                                                            <select
                                                                class="form-control"
                                                                style={{ minHeight: '26px', height: '26px', padding: '0.1rem 0.4rem', fontSize: '0.72rem', width: 'auto' }}
                                                                value={bLotOverrides[r.stockItemId] || ''}
                                                                onChange={e => setBLotOverrides(prev => ({ ...prev, [r.stockItemId]: e.target.value }))}
                                                            >
                                                                <option value="">Auto (FIFO — oldest first)</option>
                                                                {r.lotChoices.map(l => (
                                                                    <option key={l.id} value={l.id}>{formatDate(l.date)} · {l.supplier || '—'} · {l.rate.toFixed(2)} PKR/kg · {l.remaining.toFixed(0)}kg left</option>
                                                                ))}
                                                            </select>
                                                        )}
                                                    </div>
                                                    {r.qty > r.available && <span> — only {r.available.toFixed(2)} kg in stock!</span>}
                                                </li>
                                            ))}
                                        </ul>
                                        <p style={{ fontSize: '0.85rem', marginTop: '0.6rem', marginBottom: 0 }}>
                                            <strong style={{ color: 'var(--accent-gold)' }}>Cost/kg: {batchPreview.costPerKg.toFixed(2)} PKR</strong>
                                        </p>
                                    </div>
                                )}

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <button type="submit" class="btn btn-primary" style={{ minHeight: '44px' }}><i class="fa-solid fa-floppy-disk"></i> Log Batch</button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div class="glass-panel">
                        <h3 class="panel-title"><i class="fa-solid fa-clock-rotate-left"></i> Batch History</h3>
                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>DATE</th>
                                        <th>PREMIX</th>
                                        <th>TOTAL PRODUCED</th>
                                        <th>BAGS</th>
                                        <th>COST/KG</th>
                                        <th>MATERIALS USED</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '60px' }}>UNDO</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedBatches.map(b => (
                                        <tr key={b.id}>
                                            <td>{formatDate(b.date)}</td>
                                            <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{b.premixTypeName || itemName(b.premixTypeId)}</td>
                                            <td>{(Number(b.totalKg) || 0).toFixed(2)} kg</td>
                                            <td>{b.bagCount > 0 ? `${b.bagCount} × ${b.bagWeight}kg` : '—'}</td>
                                            <td>{(Number(b.costPerKg) || 0).toFixed(2)} PKR</td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                                                {(b.consumed || []).map(c => `${itemName(c.stockItemId)} ${(Number(c.quantity) || 0).toFixed(3)}kg`).join(', ') || '—'}
                                            </td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }}>
                                                    <button
                                                        type="button"
                                                        class="btn btn-secondary"
                                                        style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                        onClick={() => {
                                                            if (window.confirm(`Undo this batch?\n\n${formatDate(b.date)} · ${b.premixTypeName} · ${b.totalKg.toFixed(2)} kg\n\nThis reverses the raw material deductions and the ${b.premixTypeName} stock it credited. This cannot be undone.`)) {
                                                                deletePremixBatch(b.id);
                                                            }
                                                        }}
                                                        title="Undo this batch"
                                                    >
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    {sortedBatches.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 7 : 6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No premix batches logged yet.
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
