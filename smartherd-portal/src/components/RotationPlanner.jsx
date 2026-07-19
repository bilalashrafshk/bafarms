import React, { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';

export default function RotationPlanner() {
    const { animals, treatments, transitionAnimalStatus, recordSale, addTreatment, deleteTreatment, quarantineProtocols, systemParams } = useContext(FarmContext);

    const [activeTab, setActiveTab] = useState('quarantine');
    const [searchQuery, setSearchQuery] = useState('');
    const [penFilter, setPenFilter] = useState('all');
    const [loggingTask, setLoggingTask] = useState(null);

    // Sale modal state
    const [saleAnimal, setSaleAnimal] = useState(null);
    const [salePrice, setSalePrice] = useState('');
    const [buyerName, setBuyerName] = useState('');
    const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);

    const openSaleModal = (animal) => {
        setSaleAnimal(animal);
        setSalePrice('');
        setBuyerName('');
        setSaleDate(new Date().toISOString().split('T')[0]);
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

    // Helpers — uses Math.floor (not round) so a withholding period isn't treated as
    // cleared up to ~12 hours early.
    const dof = (entryDate) => Math.max(1, Math.floor((new Date() - new Date(entryDate)) / 86400000));

    const maxWithholding = (animalId) => {
        let max = 0;
        treatments.filter(t => t.animalId === animalId).forEach(t => {
            const passed = Math.floor((new Date() - new Date(t.date)) / 86400000);
            if (passed < t.withholding) max = Math.max(max, t.withholding - passed);
        });
        return max;
    };

    // Prefer an exact link (protocolTaskId, set when the task was logged via the
    // checklist below) over the old heuristic. The heuristic alone can't tell apart
    // two checklist steps that share the same type + medicine (e.g. "FMD" on day 1 vs
    // "FMD Boost" on day 7) — it's kept only so treatments logged before this field
    // existed still show as complete, narrowed to a window around that task's own due
    // day so it no longer bleeds into a neighboring step's window.
    const isTaskDone = (animal, task) =>
        treatments.some(t => t.animalId === animal.id && t.protocolTaskId === task.id) ||
        treatments.some(t =>
            t.animalId === animal.id &&
            !t.protocolTaskId &&
            t.type === task.type &&
            t.medicine.toLowerCase().includes(task.medicine.split(' ')[0].toLowerCase()) &&
            (() => { const d = (new Date(t.date) - new Date(animal.entryDate)) / 86400000; return d >= (task.dueDay - 2) && d <= (task.dueDay + 3); })()
        );

    const logProtocolTask = async (animal, task) => {
        const key = `${animal.id}-${task.id}`;
        setLoggingTask(key);
        await addTreatment(animal.id, new Date().toISOString().split('T')[0], task.type, task.medicine, task.dosage, task.withholding, task.id);
        setLoggingTask(null);
    };

    // Same matching logic as isTaskDone, but returns the actual treatment record so a
    // mistakenly-logged checklist step can be undone. Picks the most recent match if
    // more than one somehow qualifies.
    const findTaskTreatment = (animal, task) => {
        const exact = treatments.filter(t => t.animalId === animal.id && t.protocolTaskId === task.id);
        const matches = exact.length > 0 ? exact : treatments.filter(t =>
            t.animalId === animal.id &&
            !t.protocolTaskId &&
            t.type === task.type &&
            t.medicine.toLowerCase().includes(task.medicine.split(' ')[0].toLowerCase()) &&
            (() => { const d = (new Date(t.date) - new Date(animal.entryDate)) / 86400000; return d >= (task.dueDay - 2) && d <= (task.dueDay + 3); })()
        );
        if (matches.length === 0) return null;
        return matches.reduce((latest, t) => new Date(t.date) > new Date(latest.date) ? t : latest);
    };

    const undoProtocolTask = (animal, task) => {
        const record = findTaskTreatment(animal, task);
        if (!record) return;
        if (window.confirm(`Undo "${task.label}" for ${animal.rfid}? This deletes the logged treatment record.`)) {
            deleteTreatment(record.id);
        }
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

            {/* Phase tabs + table */}
            <div class="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>

                {/* Tab bar */}
                <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {tabs.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            style={{ flex: 1, padding: '0.75rem 0.5rem', background: activeTab === tab.id ? 'rgba(255,255,255,0.04)' : 'none', border: 'none', borderBottom: activeTab === tab.id ? `2px solid ${tab.color}` : '2px solid transparent', cursor: 'pointer', fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '0.82rem', color: activeTab === tab.id ? 'var(--text-pure)' : 'var(--text-muted)', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
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
                                {fQ.length === 0 && <tr><td colSpan={7 + quarantineProtocols.length} style={{ ...cellStyle, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-circle-check" style={{ color: 'var(--primary-green-light)', marginRight: '0.5rem' }}></i>Quarantine pen is empty.</td></tr>}
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
                                {fF.length === 0 && <tr><td colSpan={8} style={{ ...cellStyle, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>No fattening animals match criteria.</td></tr>}
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
                                {fS.length === 0 && <tr><td colSpan={7} style={{ ...cellStyle, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}><i class="fa-solid fa-circle-check" style={{ color: 'var(--primary-green-light)', marginRight: '0.5rem' }}></i>Sick pen is clear.</td></tr>}
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
                                {fM.length === 0 && <tr><td colSpan={7} style={{ ...cellStyle, textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>No animals at market weight yet.</td></tr>}
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
                                            <td>{a.saleDate || '—'}</td>
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

        </div>
    );
}
