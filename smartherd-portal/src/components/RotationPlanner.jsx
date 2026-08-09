import React, { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, parseDateOnly, daysBetween } from '../utils/dateOnly';

export default function RotationPlanner() {
    const {
        animals, treatments, transitionAnimalStatus, updateAnimal, recordSale, addTreatment, deleteTreatment, quarantineProtocols, systemParams, pens,
        feedStockItems, addStockTrackedIngredient, addFeedPurchase, addFeedStockIssue, getFeedStockLedger
    } = useContext(FarmContext);

    // Medicine stock for the bulk task modal below — same category-agnostic FIFO stock
    // system feed/MedicalLog already use (feedStockItems/feedPurchases/feedStockIssues).
    const medicineItems = feedStockItems.filter(i => (i.category || 'feed') === 'medicine');
    const stockQtyOf = (itemId) => getFeedStockLedger().find(r => r.item.id === itemId)?.closingQty ?? 0;

    const [activeTab, setActiveTab] = useState('quarantine');
    const [searchQuery, setSearchQuery] = useState('');
    const [penFilter, setPenFilter] = useState('all');
    const [loggingTask, setLoggingTask] = useState(null);

    // Bulk selection state
    const [selectedIds, setSelectedIds] = useState([]);
    const [bulkTargetStatus, setBulkTargetStatus] = useState('');
    const [bulkTargetPen, setBulkTargetPen] = useState('');

    // Bulk quarantine-protocol logging (e.g. deworm/vaccinate a whole selection at once),
    // with an optional draw against tracked medicine stock — same idea as the single-animal
    // "Draw from medicine stock" option on Medical Log, just applied per selected animal.
    const [bulkTaskId, setBulkTaskId] = useState('');
    const [bulkTaskModalOpen, setBulkTaskModalOpen] = useState(false);
    const [bulkDrawFromStock, setBulkDrawFromStock] = useState(false);
    const [bulkStockMode, setBulkStockMode] = useState('existing'); // 'existing' | 'new'
    const [bulkStockItemId, setBulkStockItemId] = useState('');
    const [bulkStockQtyPerAnimal, setBulkStockQtyPerAnimal] = useState('1');
    const [bulkNewMedName, setBulkNewMedName] = useState('');
    const [bulkNewMedUnit, setBulkNewMedUnit] = useState('unit');
    const [bulkNewMedRate, setBulkNewMedRate] = useState('');
    const [bulkTaskDate, setBulkTaskDate] = useState(todayPKT());
    const [bulkTaskSubmitting, setBulkTaskSubmitting] = useState(false);

    const toggleSelect = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleSelectAll = (currentList) => {
        const listIds = currentList.map(c => c.id);
        const allSelected = listIds.length > 0 && listIds.every(id => selectedIds.includes(id));
        if (allSelected) {
            setSelectedIds(prev => prev.filter(id => !listIds.includes(id)));
        } else {
            setSelectedIds(prev => [...new Set([...prev, ...listIds])]);
        }
    };

    const handleApplyBulkStatus = () => {
        if (!bulkTargetStatus || selectedIds.length === 0) return;
        selectedIds.forEach(id => {
            transitionAnimalStatus(id, bulkTargetStatus);
        });
        setSelectedIds([]);
        setBulkTargetStatus('');
    };

    const handleApplyBulkPen = () => {
        if (!bulkTargetPen || selectedIds.length === 0) return;
        const penVal = bulkTargetPen === 'none' ? null : bulkTargetPen;
        selectedIds.forEach(id => {
            updateAnimal({ id, pen: penVal });
        });
        setSelectedIds([]);
        setBulkTargetPen('');
    };

    // Sale modal state
    const [saleAnimal, setSaleAnimal] = useState(null);
    const [salePrice, setSalePrice] = useState('');
    const [buyerName, setBuyerName] = useState('');
    const [saleDate, setSaleDate] = useState(todayPKT());

    const openSaleModal = (animal) => {
        setSaleAnimal(animal);
        setSalePrice('');
        setBuyerName('');
        setSaleDate(todayPKT());
        setSaleError('');
    };

    const [saleError, setSaleError] = useState('');
    const [saleSubmitting, setSaleSubmitting] = useState(false);

    const handleSaleSubmit = async (e) => {
        e.preventDefault();
        if (!salePrice || Number(salePrice) <= 0 || !saleDate) return;
        setSaleError('');
        setSaleSubmitting(true);
        const result = await recordSale(saleAnimal.id, salePrice, buyerName, saleDate);
        setSaleSubmitting(false);
        if (!result.success) {
            setSaleError(result.error || 'Sale could not be recorded.');
            return;
        }
        setSaleAnimal(null);
    };

    // Helpers — all anchored to PKT (see utils/dateOnly.js), never the runtime's own
    // timezone. Uses Math.floor (not round) so a withholding period isn't treated as
    // cleared up to ~12 hours early.
    const dof = (entryDate) => Math.max(1, Math.floor(daysBetween(todayPKT(), entryDate)));

    const maxWithholding = (animalId) => {
        let max = 0;
        treatments.filter(t => t.animalId === animalId).forEach(t => {
            const passed = Math.floor(daysBetween(todayPKT(), t.date));
            if (passed < t.withholding) max = Math.max(max, t.withholding - passed);
        });
        return max;
    };

    const isTaskDone = (animal, task) =>
        treatments.some(t => t.animalId === animal.id && String(t.protocolTaskId) === String(task.id));

    const logProtocolTask = (animal, task) => {
        setSelectedIds([animal.id]);
        setBulkTaskId(String(task.id));
        setBulkTaskDate(todayPKT());
        setBulkDrawFromStock(true);
        setBulkStockMode('existing');
        setBulkStockItemId('');
        setBulkStockQtyPerAnimal('1');
        setBulkNewMedName('');
        setBulkNewMedUnit('unit');
        setBulkNewMedRate('');
        setBulkTaskModalOpen(true);
    };

    // Same matching logic as isTaskDone, but returns the actual treatment record so a
    // mistakenly-logged checklist step can be undone. Picks the most recent match if
    // more than one somehow qualifies.
    const findTaskTreatment = (animal, task) => {
        const exact = treatments.filter(t => t.animalId === animal.id && String(t.protocolTaskId) === String(task.id));
        if (exact.length > 0) {
            return exact.reduce((latest, t) => parseDateOnly(t.date) > parseDateOnly(latest.date) ? t : latest);
        }
        const byType = treatments.filter(t => t.animalId === animal.id && (t.type === task.type || (task.type === 'Deworming' && t.type === 'Deworming')));
        if (byType.length > 0) {
            return byType.reduce((latest, t) => parseDateOnly(t.date) > parseDateOnly(latest.date) ? t : latest);
        }
        return null;
    };

    const undoProtocolTask = (animal, task) => {
        const record = findTaskTreatment(animal, task);
        if (!record) return;
        deleteTreatment(record.id);
    };

    const openBulkTaskModal = () => {
        if (!bulkTaskId) return;
        setBulkTaskDate(todayPKT());
        setBulkDrawFromStock(true);
        setBulkStockMode('existing');
        setBulkStockItemId('');
        setBulkStockQtyPerAnimal('1');
        setBulkNewMedName('');
        setBulkNewMedUnit('unit');
        setBulkNewMedRate('');
        setBulkCustomType('Treatment');
        setBulkCustomWithholding('0');
        setBulkTaskModalOpen(true);
    };

    // Animals from the current selection that are actually eligible for the chosen task
    // (skips anyone it's already logged for — see isTaskDone — so re-running this on an
    // overlapping selection never double-doses/double-costs an animal).
    const bulkTaskEligible = (() => {
        if (bulkTaskId === 'other') {
            return selectedIds.map(id => animals.find(a => a.id === id)).filter(Boolean);
        }
        const task = quarantineProtocols.find(t => String(t.id) === String(bulkTaskId));
        if (!task) return [];
        return selectedIds
            .map(id => animals.find(a => a.id === id))
            .filter(a => a && !isTaskDone(a, task));
    })();

    const handleBulkLogTask = async () => {
        const isCustom = bulkTaskId === 'other';
        const task = isCustom ? null : quarantineProtocols.find(t => String(t.id) === String(bulkTaskId));
        const eligible = bulkTaskEligible;
        if ((!isCustom && !task) || eligible.length === 0) { setBulkTaskModalOpen(false); return; }

        const logDate = bulkTaskDate || todayPKT();
        let itemId = bulkStockItemId;
        let actualMedicine = isCustom ? 'Custom Treatment' : task.medicine;
        let actualDosage = isCustom ? '1 unit' : task.dosage;
        let taskType = isCustom ? bulkCustomType : task.type;
        let withholding = isCustom ? (parseInt(bulkCustomWithholding) || 0) : task.withholding;
        let taskId = isCustom ? null : task.id;
        let taskLabel = isCustom ? (bulkStockMode === 'existing' ? (medicineItems.find(i => i.id === itemId)?.name || 'Custom Treatment') : (bulkNewMedName || 'Custom Treatment')) : task.label;

        const qtyPerAnimal = parseFloat(bulkStockQtyPerAnimal) || 0;
        if (qtyPerAnimal <= 0) {
            alert('Enter a valid quantity/dosage per animal for the stock draw.');
            return;
        }
        if (bulkStockMode === 'new') {
            const name = bulkNewMedName.trim();
            const rate = parseFloat(bulkNewMedRate);
            if (!name || isNaN(rate) || rate < 0) {
                alert('Enter a name and price per unit for the new medicine.');
                return;
            }
            itemId = addStockTrackedIngredient(name, 'medicine', bulkNewMedUnit.trim() || 'unit');
            setBulkTaskSubmitting(true);
            await addFeedPurchase({
                itemId, date: logDate, quantity: qtyPerAnimal * eligible.length, rate,
                supplier: 'Direct purchase (bulk treatment)',
                notes: `Backfilled for "${taskLabel}" — ${eligible.length} animal${eligible.length === 1 ? '' : 's'}`
            });
            actualMedicine = `${name} (${qtyPerAnimal} ${bulkNewMedUnit.trim() || 'unit'})`;
            actualDosage = `${qtyPerAnimal} ${bulkNewMedUnit.trim() || 'unit'}`;
        } else if (!itemId) {
            alert('Select a medicine from stock, or switch to "New medicine".');
            return;
        } else {
            const available = stockQtyOf(itemId);
            const needed = qtyPerAnimal * eligible.length;
            if (available < needed) {
                alert(`Insufficient stock. Available: ${available}, needed: ${needed} (${qtyPerAnimal} × ${eligible.length} animals). Purchase more first or switch to "New medicine".`);
                return;
            }
            const stockObj = medicineItems.find(i => i.id === itemId);
            if (stockObj) {
                actualMedicine = `${stockObj.name} (${qtyPerAnimal} ${stockObj.unit || 'unit'})`;
                actualDosage = `${qtyPerAnimal} ${stockObj.unit || 'unit'}`;
            }
        }

        setBulkTaskSubmitting(true);
        for (let i = 0; i < eligible.length; i++) {
            const animal = eligible[i];
            const stockIssueId = `fi-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
            await addFeedStockIssue({
                id: stockIssueId,
                itemId,
                date: logDate,
                pen: animal.pen || 'ALL',
                quantity: qtyPerAnimal,
                notes: `"${taskLabel}" stock draw — ${animal.rfid}`
            });
            await addTreatment(animal.id, logDate, taskType, actualMedicine, actualDosage, withholding, taskId, stockIssueId);
        }
        setBulkTaskSubmitting(false);
        setBulkTaskModalOpen(false);
        setBulkTaskId('');
    };

    // Classify animals
    const quarantineList = [], fatteningList = [], sickList = [], marketList = [];
    const soldList = animals.filter(a => a.status === 'Sold');

    animals.forEach(a => {
        if (a.status === 'Sold' || a.status === 'Deceased') return;
        const d = dof(a.entryDate);
        const wh = maxWithholding(a.id);
        const pct = Math.min(100, (a.currentWeight / a.targetWeight) * 100);
        const obj = { ...a, dof: d, withholdingDays: wh, weightPercent: pct };
        if (a.status === 'Quarantined') quarantineList.push(obj);
        else if (a.status === 'Sick') sickList.push(obj);
        else if (a.currentWeight >= a.targetWeight && wh === 0) marketList.push(obj);
        else fatteningList.push(obj);
    });

    const activePens = [...new Set(animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.pen).map(a => a.pen))].sort();

    const applyFilter = (list) => list.filter(c => {
        const q = searchQuery.trim().toLowerCase();
        const matchSearch = !q || c.rfid.toLowerCase().includes(q) || c.breed.toLowerCase().includes(q);
        const matchPen = penFilter === 'all' || (penFilter === 'none' && !c.pen) || c.pen === penFilter;
        return matchSearch && matchPen;
    }).sort((a, b) => (a.pen || 'zzz').localeCompare(b.pen || 'zzz') || a.rfid.localeCompare(b.rfid));

    const fQ = applyFilter(quarantineList);
    const fF = applyFilter(fatteningList);
    const fS = applyFilter(sickList);
    const fM = applyFilter(marketList);
    const fSold = soldList.filter(c => {
        const q = searchQuery.trim().toLowerCase();
        return !q || c.rfid.toLowerCase().includes(q) || c.breed.toLowerCase().includes(q) || (c.buyerName || '').toLowerCase().includes(q);
    });

    // Stats
    const totalRevenue = soldList.reduce((s, a) => s + (a.salePrice || 0), 0);
    const totalCost = soldList.reduce((s, a) => s + (a.purchasePrice || 0), 0);
    const totalProfit = totalRevenue - totalCost;

    const tabs = [
        { id: 'quarantine', label: 'Quarantine',   count: quarantineList.length, icon: 'fa-shield-virus',  color: 'var(--accent-gold)' },
        { id: 'fattening',  label: 'Fattening',    count: fatteningList.length,  icon: 'fa-rotate',        color: 'var(--primary-green-light)' },
        { id: 'sick',       label: 'Sick Pen',     count: sickList.length,       icon: 'fa-stethoscope',   color: 'hsl(0,75%,55%)' },
        { id: 'market',     label: 'Market Ready', count: marketList.length,     icon: 'fa-award',         color: 'var(--accent-gold)' },
    ];

    const cellStyle = { padding: '0.5rem 0.7rem', borderBottom: '1px solid rgba(255,255,255,0.03)', color: 'var(--text-main)', fontSize: '0.85rem', verticalAlign: 'middle' };
    const headStyle = { padding: '0.45rem 0.7rem', background: 'rgba(255,255,255,0.02)', fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' };

    const currentTabList = activeTab === 'quarantine' ? fQ : activeTab === 'fattening' ? fF : activeTab === 'sick' ? fS : activeTab === 'market' ? fM : [];
    const isAllCurrentSelected = currentTabList.length > 0 && currentTabList.every(c => selectedIds.includes(c.id));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Stat row */}
            <div class="dashboard-grid">
                <div class="glass-panel stat-box" style={{ borderLeft: '4px solid var(--accent-gold)' }}>
                    <div class="stat-header"><h3>Quarantine Clearing</h3><div class="stat-icon"><i class="fa-solid fa-truck-ramp-box"></i></div></div>
                    <div class="stat-val">{quarantineList.filter(c => c.dof >= systemParams.quarantineDays).length} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Ready</small></div>
                    <span class="stat-lbl">{quarantineList.length} total in quarantine</span>
                </div>
                <div class="glass-panel stat-box" style={{ borderLeft: '4px solid var(--primary-green-light)' }}>
                    <div class="stat-header"><h3>Ready for Dispatch</h3><div class="stat-icon"><i class="fa-solid fa-award"></i></div></div>
                    <div class="stat-val" style={{ color: 'var(--primary-green-light)' }}>{marketList.length} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Calves</small></div>
                    <span class="stat-lbl">Peak weight · med clear</span>
                </div>
                <div class="glass-panel stat-box" style={{ borderLeft: '4px solid var(--accent-gold)' }}>
                    <div class="stat-header"><h3>Sold Revenue</h3><div class="stat-icon"><i class="fa-solid fa-sack-dollar"></i></div></div>
                    <div class="stat-val" style={{ color: totalProfit >= 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,55%)' }}>{soldList.length} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Dispatched</small></div>
                    <span class="stat-lbl">{soldList.length > 0 ? <>P&L: <strong style={{ color: totalProfit >= 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,55%)' }}>{totalProfit >= 0 ? '+' : ''}{totalProfit.toLocaleString()} PKR</strong></> : 'No sales yet'}</span>
                </div>
            </div>

            {/* Search + filter bar */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px', maxWidth: '300px' }}>
                    <i class="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.85rem' }}></i>
                    <input type="text" class="form-control search-control" style={{ minHeight: '38px', fontSize: '0.85rem' }} placeholder="Search tag or breed..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
                <select class="form-control" style={{ minHeight: '38px', width: '140px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={penFilter} onChange={e => setPenFilter(e.target.value)}>
                    <option value="all">All Pens</option>
                    <option value="none">Unassigned</option>
                    {activePens.map(p => <option key={p} value={p}>Pen {p}</option>)}
                </select>
            </div>

            {/* Bulk Actions Toolbar Bar */}
            {selectedIds.length > 0 && (
                <div style={{ background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', borderRadius: '10px', padding: '0.8rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <strong style={{ fontSize: '0.9rem', color: 'var(--accent-gold)' }}>
                            <i className="fa-solid fa-square-check"></i> {selectedIds.length} Animal{selectedIds.length === 1 ? '' : 's'} Selected
                        </strong>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem' }} onClick={() => setSelectedIds([])}>
                            Clear
                        </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600' }}>Move Status:</span>
                        <select className="form-control" style={{ width: '150px', minHeight: '34px', padding: '0.2rem 0.6rem', fontSize: '0.82rem' }} value={bulkTargetStatus} onChange={e => setBulkTargetStatus(e.target.value)}>
                            <option value="">Select Status...</option>
                            <option value="Quarantined">→ Quarantine</option>
                            <option value="Fattening">→ Fattening</option>
                            <option value="Sick">→ Sick Pen</option>
                        </select>
                        <button type="button" className="btn btn-primary btn-sm" style={{ minHeight: '34px' }} disabled={!bulkTargetStatus} onClick={handleApplyBulkStatus}>
                            Apply Status
                        </button>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600', marginLeft: '0.4rem' }}>Or Pen:</span>
                        <select className="form-control" style={{ width: '130px', minHeight: '34px', padding: '0.2rem 0.6rem', fontSize: '0.82rem' }} value={bulkTargetPen} onChange={e => setBulkTargetPen(e.target.value)}>
                            <option value="">Select Pen...</option>
                            <option value="none">Unassigned</option>
                            {activePens.map(p => <option key={p} value={p}>Pen {p}</option>)}
                        </select>
                        <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: '34px' }} disabled={!bulkTargetPen} onClick={handleApplyBulkPen}>
                            Apply Pen
                        </button>
                        {activeTab === 'quarantine' && (
                            <>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600', marginLeft: '0.4rem' }}>Or Log Task:</span>
                                <select className="form-control" style={{ width: '180px', minHeight: '34px', padding: '0.2rem 0.6rem', fontSize: '0.82rem' }} value={bulkTaskId} onChange={e => setBulkTaskId(e.target.value)}>
                                    <option value="">Select Task...</option>
                                    {quarantineProtocols.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                    <option value="other">💉 Other Medicine / Custom...</option>
                                </select>
                                <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: '34px' }} disabled={!bulkTaskId} onClick={openBulkTaskModal}>
                                    Bulk Log Task
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Phase tabs + table */}
            <div class="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>

                {/* Tab bar */}
                <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto', WebkitOverflowScrolling: 'touch', whiteSpace: 'nowrap' }}>
                    {tabs.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            style={{ flex: 1, minWidth: '125px', flexShrink: 0, padding: '0.75rem 0.6rem', background: activeTab === tab.id ? 'rgba(255,255,255,0.04)' : 'none', border: 'none', borderBottom: activeTab === tab.id ? `2px solid ${tab.color}` : '2px solid transparent', cursor: 'pointer', fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '0.82rem', color: activeTab === tab.id ? 'var(--text-pure)' : 'var(--text-muted)', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                            <i class={`fa-solid ${tab.icon}`} style={{ color: tab.color, fontSize: '0.8rem' }}></i>
                            {tab.label}
                            <span style={{ background: activeTab === tab.id ? tab.color : 'rgba(255,255,255,0.08)', color: activeTab === tab.id ? '#000' : 'var(--text-muted)', borderRadius: '50px', padding: '0 0.4rem', fontSize: '0.7rem', fontWeight: '700', lineHeight: '1.6' }}>{tab.count}</span>
                        </button>
                    ))}
                </div>

                {/* QUARANTINE TABLE */}
                {activeTab === 'quarantine' && (
                    <div class="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                        <table class="data-table" style={{ fontSize: '0.83rem' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...headStyle, width: '40px', textAlign: 'center' }}>
                                        <input type="checkbox" checked={isAllCurrentSelected} onChange={() => toggleSelectAll(fQ)} />
                                    </th>
                                    <th style={headStyle}>Tag</th>
                                    <th style={headStyle}>Breed</th>
                                    <th style={headStyle}>Pen</th>
                                    <th style={headStyle}>Day In</th>
                                    {quarantineProtocols.map(t => <th key={t.id} style={{ ...headStyle, textAlign: 'center' }}>{t.label}<div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: '400', textTransform: 'none', letterSpacing: 0 }}>Day {t.dueDay}</div></th>)}
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Done</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fQ.map(c => {
                                    const doneCount = quarantineProtocols.filter(t => isTaskDone(c, t)).length;
                                    const cleared = c.dof >= systemParams.quarantineDays;
                                    return (
                                        <tr key={c.id} style={{ borderLeft: cleared ? '3px solid var(--primary-green-light)' : '3px solid var(--accent-gold)' }}>
                                            <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} />
                                            </td>
                                            <td style={{ ...cellStyle, fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)' }}>{c.rfid}</td>
                                            <td style={cellStyle}>{c.breed}</td>
                                            <td style={cellStyle}>{c.pen ? <span style={{ color: 'var(--accent-gold)', fontWeight: '600' }}>{c.pen}</span> : <span style={{ opacity: 0.3 }}>—</span>}</td>
                                            <td style={{ ...cellStyle, color: cleared ? 'var(--primary-green-light)' : 'var(--accent-gold)', fontWeight: '700' }}>Day {c.dof}</td>
                                            {quarantineProtocols.map(task => {
                                                const done = isTaskDone(c, task);
                                                const due = c.dof >= task.dueDay;
                                                const key = `${c.id}-${task.id}`;
                                                return (
                                                    <td key={task.id} style={{ ...cellStyle, textAlign: 'center' }}>
                                                        {done
                                                            ? <i class="fa-solid fa-circle-check" style={{ color: 'var(--primary-green-light)', cursor: 'pointer' }} title="Logged by mistake? Click to undo." onClick={() => undoProtocolTask(c, task)}></i>
                                                            : due
                                                            ? <button class="btn btn-secondary" style={{ minHeight: '24px', padding: '0.05rem 0.4rem', fontSize: '0.68rem', borderColor: 'rgba(255,193,7,0.3)', color: 'var(--accent-gold)' }} onClick={() => logProtocolTask(c, task)} disabled={loggingTask === key}>{loggingTask === key ? '…' : 'Log'}</button>
                                                            : <span style={{ opacity: 0.2, fontSize: '0.7rem' }}>—</span>
                                                        }
                                                    </td>
                                                );
                                            })}
                                            <td style={{ ...cellStyle, textAlign: 'center', fontFamily: 'var(--font-heading)', fontWeight: '700', color: doneCount === quarantineProtocols.length ? 'var(--primary-green-light)' : 'var(--text-muted)' }}>{doneCount}/{quarantineProtocols.length}</td>
                                            <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                {cleared
                                                    ? <button class="btn btn-primary" style={{ minHeight: '28px', padding: '0.15rem 0.6rem', fontSize: '0.75rem' }} onClick={() => transitionAnimalStatus(c.id, 'Fattening')}>→ Fatten</button>
                                                    : <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{systemParams.quarantineDays - c.dof}d left</span>
                                                }
                                            </td>
                                        </tr>
                                    );
                                })}
                                {fQ.length === 0 && <tr><td colSpan={8 + quarantineProtocols.length} style={{ ...cellStyle, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-circle-check" style={{ color: 'var(--primary-green-light)', marginRight: '0.5rem' }}></i>Quarantine pen is empty.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* FATTENING TABLE */}
                {activeTab === 'fattening' && (
                    <div class="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                        <table class="data-table" style={{ fontSize: '0.83rem' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...headStyle, width: '40px', textAlign: 'center' }}>
                                        <input type="checkbox" checked={isAllCurrentSelected} onChange={() => toggleSelectAll(fF)} />
                                    </th>
                                    <th style={headStyle}>Tag</th>
                                    <th style={headStyle}>Breed</th>
                                    <th style={headStyle}>Pen</th>
                                    <th style={headStyle}>DOF</th>
                                    <th style={headStyle}>Weight</th>
                                    <th style={headStyle}>Target</th>
                                    <th style={headStyle}>Progress</th>
                                    <th style={headStyle}>Med Lock</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fF.map(c => (
                                    <tr key={c.id}>
                                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                                            <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} />
                                        </td>
                                        <td style={{ ...cellStyle, fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)' }}>{c.rfid}</td>
                                        <td style={cellStyle}>{c.breed}</td>
                                        <td style={cellStyle}>{c.pen ? <span style={{ color: 'var(--accent-gold)', fontWeight: '600' }}>{c.pen}</span> : <span style={{ opacity: 0.3 }}>—</span>}</td>
                                        <td style={cellStyle}>{c.dof}d</td>
                                        <td style={{ ...cellStyle, fontWeight: '700', color: 'var(--text-pure)' }}>{c.currentWeight} kg</td>
                                        <td style={cellStyle}>{c.targetWeight} kg</td>
                                        <td style={cellStyle}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${c.weightPercent}%`, background: 'var(--primary-green-light)', borderRadius: '4px' }}></div>
                                                </div>
                                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: '32px' }}>{Math.round(c.weightPercent)}%</span>
                                            </div>
                                        </td>
                                        <td style={cellStyle}>
                                            {c.withholdingDays > 0
                                                ? <span style={{ color: 'hsl(0,75%,55%)', fontWeight: '700', fontSize: '0.78rem' }}><i class="fa-solid fa-ban" style={{ marginRight: '0.3rem' }}></i>{c.withholdingDays}d</span>
                                                : <span style={{ color: 'var(--primary-green-light)', fontSize: '0.78rem' }}><i class="fa-solid fa-circle-check"></i></span>
                                            }
                                        </td>
                                    </tr>
                                ))}
                                {fF.length === 0 && <tr><td colSpan={9} style={{ ...cellStyle, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>No fattening animals match criteria.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* SICK TABLE */}
                {activeTab === 'sick' && (
                    <div class="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                        <table class="data-table" style={{ fontSize: '0.83rem' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...headStyle, width: '40px', textAlign: 'center' }}>
                                        <input type="checkbox" checked={isAllCurrentSelected} onChange={() => toggleSelectAll(fS)} />
                                    </th>
                                    <th style={headStyle}>Tag</th>
                                    <th style={headStyle}>Breed</th>
                                    <th style={headStyle}>Pen</th>
                                    <th style={headStyle}>DOF</th>
                                    <th style={headStyle}>Weight</th>
                                    <th style={headStyle}>Med Lock</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fS.map(c => (
                                    <tr key={c.id}>
                                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                                            <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} />
                                        </td>
                                        <td style={{ ...cellStyle, fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'hsl(0,75%,65%)' }}>{c.rfid}</td>
                                        <td style={cellStyle}>{c.breed}</td>
                                        <td style={cellStyle}>{c.pen ? <span style={{ color: 'var(--accent-gold)', fontWeight: '600' }}>{c.pen}</span> : <span style={{ opacity: 0.3 }}>—</span>}</td>
                                        <td style={cellStyle}>{c.dof}d</td>
                                        <td style={{ ...cellStyle, fontWeight: '700', color: 'var(--text-pure)' }}>{c.currentWeight} kg</td>
                                        <td style={cellStyle}>
                                            {c.withholdingDays > 0
                                                ? <span style={{ color: 'hsl(0,75%,55%)', fontWeight: '700', fontSize: '0.78rem' }}><i class="fa-solid fa-ban" style={{ marginRight: '0.3rem' }}></i>{c.withholdingDays}d</span>
                                                : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>
                                            }
                                        </td>
                                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                                            <button class="btn btn-secondary" style={{ minHeight: '28px', padding: '0.15rem 0.6rem', fontSize: '0.75rem', borderColor: 'rgba(25,135,84,0.3)', color: 'var(--primary-green-light)' }} onClick={() => transitionAnimalStatus(c.id, 'Fattening')}>
                                                <i class="fa-solid fa-circle-check"></i> Recovered
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {fS.length === 0 && <tr><td colSpan={8} style={{ ...cellStyle, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-circle-check" style={{ color: 'var(--primary-green-light)', marginRight: '0.5rem' }}></i>Sick pen is clear.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* MARKET READY TABLE */}
                {activeTab === 'market' && (
                    <div class="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                        <table class="data-table" style={{ fontSize: '0.83rem' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...headStyle, width: '40px', textAlign: 'center' }}>
                                        <input type="checkbox" checked={isAllCurrentSelected} onChange={() => toggleSelectAll(fM)} />
                                    </th>
                                    <th style={headStyle}>Tag</th>
                                    <th style={headStyle}>Breed</th>
                                    <th style={headStyle}>Pen</th>
                                    <th style={headStyle}>DOF</th>
                                    <th style={headStyle}>Final Weight</th>
                                    <th style={headStyle}>Cost Paid</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fM.map(c => (
                                    <tr key={c.id} style={{ borderLeft: '3px solid var(--accent-gold)' }}>
                                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                                            <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} />
                                        </td>
                                        <td style={{ ...cellStyle, fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--accent-gold)' }}>{c.rfid}</td>
                                        <td style={cellStyle}>{c.breed}</td>
                                        <td style={cellStyle}>{c.pen ? <span style={{ color: 'var(--accent-gold)', fontWeight: '600' }}>{c.pen}</span> : <span style={{ opacity: 0.3 }}>—</span>}</td>
                                        <td style={cellStyle}>{c.dof}d</td>
                                        <td style={{ ...cellStyle, fontWeight: '700', color: 'var(--primary-green-light)' }}>{c.currentWeight} kg ✓</td>
                                        <td style={cellStyle}>{c.purchasePrice.toLocaleString()} PKR</td>
                                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                                            <button class="btn btn-primary" style={{ minHeight: '28px', padding: '0.15rem 0.7rem', fontSize: '0.75rem', background: 'linear-gradient(135deg, var(--accent-gold), hsl(38,90%,42%))', color: '#000', fontWeight: '700' }} onClick={() => openSaleModal(c)}>
                                                Sell
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {fM.length === 0 && <tr><td colSpan={8} style={{ ...cellStyle, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>No animals at market weight yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}

            </div>

            {/* Sold Ledger */}
            {fSold.length > 0 && (
                <div class="glass-panel">
                    <h3 class="panel-title"><i class="fa-solid fa-receipt"></i> Sold Animals Ledger</h3>
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>TAG</th><th>BREED</th><th>SALE DATE</th><th>BUYER</th><th>COST</th><th>SOLD</th><th>P&L</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fSold.map(a => {
                                    const profit = (a.salePrice || 0) - (a.purchasePrice || 0);
                                    return (
                                        <tr key={a.id}>
                                            <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', color: 'var(--text-pure)' }}>{a.rfid}</td>
                                            <td>{a.breed}</td>
                                            <td>{formatDate(a.saleDate) || '—'}</td>
                                            <td>{a.buyerName || '—'}</td>
                                            <td>{(a.purchasePrice || 0).toLocaleString()} PKR</td>
                                            <td><strong>{a.salePrice ? a.salePrice.toLocaleString() + ' PKR' : '—'}</strong></td>
                                            <td style={{ fontWeight: '700', color: profit >= 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,55%)' }}>
                                                {a.salePrice ? (profit >= 0 ? '+' : '') + profit.toLocaleString() + ' PKR' : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Sale Modal */}
            {saleAnimal && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container" style={{ maxWidth: '480px' }}>
                        <button class="modal-close-btn" onClick={() => setSaleAnimal(null)}><i class="fa-solid fa-xmark"></i></button>
                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', marginBottom: '1rem', color: 'var(--accent-gold)' }}>
                            <i class="fa-solid fa-sack-dollar"></i> Record Sale — {saleAnimal.rfid}
                        </h2>
                        <div style={{ background: 'rgba(255,193,7,0.04)', border: '1px solid rgba(255,193,7,0.15)', borderRadius: '8px', padding: '0.7rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', gap: '1.5rem' }}>
                            <span>Breed: <strong style={{ color: 'var(--text-pure)' }}>{saleAnimal.breed}</strong></span>
                            <span>Weight: <strong style={{ color: 'var(--text-pure)' }}>{saleAnimal.currentWeight} kg</strong></span>
                            <span>Cost: <strong style={{ color: 'var(--text-pure)' }}>{saleAnimal.purchasePrice.toLocaleString()} PKR</strong></span>
                        </div>
                        <form onSubmit={handleSaleSubmit}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Sale Price (PKR) *</label>
                                    <input type="number" class="form-control" placeholder="e.g. 250000" min="0" step="1" value={salePrice} onChange={e => setSalePrice(e.target.value)} required autoFocus />
                                </div>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Sale Date *</label>
                                    <input type="date" class="form-control" value={saleDate} onChange={e => setSaleDate(e.target.value)} required />
                                </div>
                            </div>
                            <div class="form-group" style={{ marginBottom: '0.75rem' }}>
                                <label>Buyer Name</label>
                                <input type="text" class="form-control" placeholder="e.g. Ahmed Meat Traders" value={buyerName} onChange={e => setBuyerName(e.target.value)} />
                            </div>
                            {salePrice && (
                                <div style={{ background: 'rgba(25,135,84,0.06)', border: '1px solid rgba(25,135,84,0.2)', borderRadius: '8px', padding: '0.7rem 1rem', marginBottom: '0.75rem', fontSize: '0.88rem' }}>
                                    P&L: <strong style={{ color: (parseFloat(salePrice) - saleAnimal.purchasePrice) >= 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,55%)', fontSize: '1.1rem' }}>
                                        {(parseFloat(salePrice) - saleAnimal.purchasePrice) >= 0 ? '+' : ''}{(parseFloat(salePrice) - saleAnimal.purchasePrice).toLocaleString()} PKR
                                    </strong>
                                </div>
                            )}
                            {saleError && (
                                <div style={{ background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.3)', borderRadius: '8px', padding: '0.7rem 1rem', marginBottom: '0.75rem', fontSize: '0.85rem', color: 'hsl(0,75%,65%)' }}>
                                    <i class="fa-solid fa-triangle-exclamation"></i> {saleError}
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                                <button type="button" class="btn btn-secondary" onClick={() => setSaleAnimal(null)}>Cancel</button>
                                <button type="submit" class="btn btn-primary" disabled={saleSubmitting} style={{ background: 'linear-gradient(135deg, var(--accent-gold), hsl(38,90%,42%))', color: '#000', fontWeight: '700', opacity: saleSubmitting ? 0.6 : 1 }}>
                                    <i class={saleSubmitting ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-circle-check'}></i> {saleSubmitting ? 'Checking…' : 'Confirm Sale'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* Bulk Log Task Modal */}
            {bulkTaskModalOpen && (quarantineProtocols.find(t => String(t.id) === String(bulkTaskId)) || bulkTaskId === 'other') && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container" style={{ maxWidth: '480px' }}>
                        <button class="modal-close-btn" onClick={() => setBulkTaskModalOpen(false)}><i class="fa-solid fa-xmark"></i></button>
                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', marginBottom: '1rem', color: 'var(--accent-gold)' }}>
                            <i class="fa-solid fa-syringe"></i> {bulkTaskId === 'other' ? 'Log Custom Treatment / Medicine' : `Log Protocol Task — ${quarantineProtocols.find(t => String(t.id) === String(bulkTaskId))?.label}`}
                        </h2>
                        <div style={{ background: 'rgba(255,193,7,0.04)', border: '1px solid rgba(255,193,7,0.15)', borderRadius: '8px', padding: '0.7rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {bulkTaskEligible.length} of {selectedIds.length} selected animal{selectedIds.length === 1 ? '' : 's'} eligible
                            {bulkTaskEligible.length < selectedIds.length && <> — {selectedIds.length - bulkTaskEligible.length} already logged for this task and will be skipped</>}.
                        </div>
                        <div style={{ background: 'rgba(25,135,84,0.08)', border: '1px solid rgba(25,135,84,0.25)', borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--primary-green-light)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <i class="fa-solid fa-shield-halved"></i>
                            <span><strong>Mandatory Compliance:</strong> Draws from medicine stock & records vet treatment logs</span>
                        </div>
                        <div class="form-group" style={{ marginBottom: '0.75rem' }}>
                            <label style={{ fontSize: '0.82rem', color: 'var(--text-pure)', fontWeight: '600' }}>Date Logged *</label>
                            <input type="date" class="form-control" value={bulkTaskDate} onChange={e => setBulkTaskDate(e.target.value)} />
                        </div>
                        {bulkTaskId === 'other' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Treatment Type *</label>
                                    <select class="form-control" value={bulkCustomType} onChange={e => setBulkCustomType(e.target.value)}>
                                        <option value="Deworming">Deworming</option>
                                        <option value="Vaccination">Vaccination</option>
                                        <option value="Treatment">Vet Treatment</option>
                                        <option value="Injury">Injury Care</option>
                                    </select>
                                </div>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Withholding (Days)</label>
                                    <input type="number" class="form-control" placeholder="0" min="0" value={bulkCustomWithholding} onChange={e => setBulkCustomWithholding(e.target.value)} />
                                </div>
                            </div>
                        )}
                        {bulkDrawFromStock && (
                            <>
                                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                        <input type="radio" name="bulkStockMode" checked={bulkStockMode === 'existing'} onChange={() => setBulkStockMode('existing')} /> Existing item
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                        <input type="radio" name="bulkStockMode" checked={bulkStockMode === 'new'} onChange={() => setBulkStockMode('new')} /> New medicine
                                    </label>
                                </div>
                                {bulkStockMode === 'existing' ? (
                                    <div class="form-group" style={{ marginBottom: '0.75rem' }}>
                                        <label>Medicine *</label>
                                        <select class="form-control" value={bulkStockItemId} onChange={e => setBulkStockItemId(e.target.value)}>
                                            <option value="">Select medicine...</option>
                                            {medicineItems.map(item => (
                                                <option key={item.id} value={item.id}>{item.name} (in stock: {stockQtyOf(item.id)} {item.unit})</option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label>Medicine Name *</label>
                                            <input type="text" class="form-control" placeholder="e.g. Ivermectin" value={bulkNewMedName} onChange={e => setBulkNewMedName(e.target.value)} />
                                        </div>
                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label>Unit</label>
                                            <input type="text" class="form-control" placeholder="e.g. ml, dose" value={bulkNewMedUnit} onChange={e => setBulkNewMedUnit(e.target.value)} />
                                        </div>
                                        <div class="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                                            <label>Price per Unit (PKR) *</label>
                                            <input type="number" class="form-control" placeholder="e.g. 150" min="0" step="0.01" value={bulkNewMedRate} onChange={e => setBulkNewMedRate(e.target.value)} />
                                        </div>
                                    </div>
                                )}
                                <div class="form-group" style={{ marginBottom: '0.75rem' }}>
                                    <label>Quantity per Animal *</label>
                                    <input type="number" class="form-control" min="0" step="0.01" value={bulkStockQtyPerAnimal} onChange={e => setBulkStockQtyPerAnimal(e.target.value)} />
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                    Priced at FIFO actual cost. Stock draws by non-admins require Super Admin approval before they're reflected in reports.
                                </div>
                            </>
                        )}
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button type="button" class="btn btn-secondary" onClick={() => setBulkTaskModalOpen(false)}>Cancel</button>
                            <button type="button" class="btn btn-primary" disabled={bulkTaskSubmitting || bulkTaskEligible.length === 0} style={{ background: 'linear-gradient(135deg, var(--accent-gold), hsl(38,90%,42%))', color: '#000', fontWeight: '700', opacity: (bulkTaskSubmitting || bulkTaskEligible.length === 0) ? 0.6 : 1 }} onClick={handleBulkLogTask}>
                                <i class={bulkTaskSubmitting ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-circle-check'}></i> {bulkTaskSubmitting ? 'Logging…' : `Log for ${bulkTaskEligible.length}`}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
}
