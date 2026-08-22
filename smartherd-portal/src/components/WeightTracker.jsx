import React, { useContext, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, daysBetween } from '../utils/dateOnly';
import { getLaggerIds } from '../utils/laggers';

export default function WeightTracker() {
    const { animals, weightLogs, logWeight, deleteWeightLog, updateWeightLog, systemParams } = useContext(FarmContext);

    // Animals flagged as "laggers" (ADG below the herd alert threshold) — same shared
    // definition Dashboard/Herd Ledger/Rotation Planner use, surfaced on the report table.
    const laggerIds = React.useMemo(() => getLaggerIds(animals, weightLogs, systemParams), [animals, weightLogs, systemParams]);

    // Edit weight log modal state
    const [editingLog, setEditingLog] = useState(null);
    const [editWeight, setEditWeight] = useState('');
    const [editDate, setEditDate] = useState('');

    // Pen filter for animal dropdown
    const [selectedPen, setSelectedPen] = useState('all');

    // Form inputs state
    const [selectedAnimal, setSelectedAnimal] = useState('');
    const [tagSearch, setTagSearch] = useState('');
    const [tagOpen, setTagOpen] = useState(false);
    const [weight, setWeight] = useState('');
    const [date, setDate] = useState(todayPKT());
    const [isSuccess, setIsSuccess] = useState(false);

    // Weigh Day Mode state
    const [weighDayMode, setWeighDayMode] = useState(false);
    const [weighPen, setWeighPen] = useState('all');
    const [weighQueue, setWeighQueue] = useState([]);
    const [weighIndex, setWeighIndex] = useState(0);
    const [batchWeight, setBatchWeight] = useState('');
    const [batchDate, setBatchDate] = useState(todayPKT());
    const [weighDayComplete, setWeighDayComplete] = useState(false);
    const [weighedCount, setWeighedCount] = useState(0);
    const [skippedCount, setSkippedCount] = useState(0);

    const batchWeightRef = useRef(null);

    // Auto-focus batch weight input when advancing
    useEffect(() => {
        if (weighDayMode && !weighDayComplete && batchWeightRef.current) {
            batchWeightRef.current.focus();
        }
    }, [weighDayMode, weighIndex, weighDayComplete]);

    // Compute unique pens from active animals
    const activePens = [...new Set(
        animals
            .filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.pen)
            .map(a => a.pen)
    )].sort();

    // Searchable tag suggestions
    const tagSuggestions = (() => {
        const q = tagSearch.trim().toLowerCase();
        const pool = (selectedPen === 'all' ? animals : animals.filter(a => a.pen === selectedPen))
            .filter(a => a.status !== 'Sold' && a.status !== 'Deceased');
        if (!q) return pool.slice(0, 8);
        return pool.filter(a =>
            a.rfid.toLowerCase().includes(q) ||
            a.breed.toLowerCase().includes(q) ||
            (a.pen && a.pen.toLowerCase().includes(q))
        ).slice(0, 10);
    })();

    const selectAnimalFromPicker = (animal) => {
        setSelectedAnimal(String(animal.id));
        setTagSearch(animal.rfid);
        setTagOpen(false);
    };

    // The tag suggestion dropdown is portaled to <body> and positioned with fixed
    // coords from this rect. .glass-panel has overflow:hidden (needed elsewhere to
    // stop panels overgrowing their flex parent), which was silently clipping the
    // absolutely-positioned dropdown any time the panel's bottom edge sat close
    // below the input — i.e. on desktop, where Tag/Date/Weight/Button share one
    // row. On mobile the fields stack, leaving room below, so it never clipped
    // there — hence "works on mobile, not on PC".
    const tagFieldRef = useRef(null);
    const [tagDropdownRect, setTagDropdownRect] = useState(null);

    useEffect(() => {
        if (!tagOpen) return;
        const updateRect = () => {
            if (tagFieldRef.current) {
                const r = tagFieldRef.current.getBoundingClientRect();
                setTagDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
            }
        };
        updateRect();
        window.addEventListener('scroll', updateRect, true);
        window.addEventListener('resize', updateRect);
        return () => {
            window.removeEventListener('scroll', updateRect, true);
            window.removeEventListener('resize', updateRect);
        };
    }, [tagOpen, tagSearch]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!selectedAnimal || !weight || !date) return;

        logWeight(selectedAnimal, date, parseFloat(weight));
        setWeight('');
        setIsSuccess(true);
        setTimeout(() => setIsSuccess(false), 3000);
    };

    // Correcting a mis-keyed weight or weighing date — ADG for this log and every
    // later log for the animal (plus its currentWeight) recalculates automatically
    // via updateWeightLog in FarmContext.
    const openEditLogModal = (log) => {
        setEditingLog(log);
        setEditWeight(String(log.weight));
        setEditDate(log.date);
    };

    const closeEditLogModal = () => {
        setEditingLog(null);
        setEditWeight('');
        setEditDate('');
    };

    const handleEditLogSubmit = async (e) => {
        e.preventDefault();
        if (!editingLog || !editWeight || !editDate) return;
        await updateWeightLog(editingLog.id, { date: editDate, weight: parseFloat(editWeight) });
        closeEditLogModal();
    };

    // Sort weight logs by date descending for overview
    const sortedLogs = [...weightLogs].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Per-animal history for the selected animal
    const selectedAnimalData = selectedAnimal ? animals.find(a => a.id === parseInt(selectedAnimal)) : null;
    const animalHistory = selectedAnimal
        ? [...weightLogs.filter(w => w.animalId === parseInt(selectedAnimal))].sort((a, b) => new Date(a.date) - new Date(b.date))
        : [];

    // ─── WEIGHT & GAIN REPORT ───
    // Animal-wise before/after weight differential over an (optional) date range,
    // plus each animal's most recent single-weighing differential. Only animals
    // with at least 2 REAL logged weigh-ins qualify for a row — an animal that's
    // only ever had its registration entry weight (no actual re-weigh logged here)
    // has nothing to diff against, so it's excluded rather than faked against
    // entryWeight/currentWeight (which are equal until the first log anyway).
    const [reportPen, setReportPen] = useState('all');
    const [reportMode, setReportMode] = useState('interval'); // 'interval' | 'cumulative' | 'custom'
    const [reportFrom, setReportFrom] = useState('');
    const [reportTo, setReportTo] = useState('');

    const weightReportRows = (() => {
        const pool = reportPen === 'all' ? animals : animals.filter(a => a.pen === reportPen);
        return pool.map(animal => {
            const logs = weightLogs
                .filter(w => w.animalId === animal.id)
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            if (logs.length < 2) return null;

            let beforeLog = null;
            let afterLog = null;

            if (reportMode === 'interval') {
                // Mode A: Latest Interval (Second-to-last weigh-in ➔ Most recent weigh-in)
                beforeLog = logs[logs.length - 2];
                afterLog = logs[logs.length - 1];
            } else if (reportMode === 'cumulative') {
                // Mode B: Full Cycle (First-ever weigh-in ➔ Most recent weigh-in)
                beforeLog = logs[0];
                afterLog = logs[logs.length - 1];
            } else {
                // Custom Date Range
                beforeLog = reportFrom ? [...logs].reverse().find(l => l.date <= reportFrom) : logs[0];
                afterLog = reportTo ? [...logs].reverse().find(l => l.date <= reportTo) : logs[logs.length - 1];
            }

            if (!beforeLog || !afterLog || beforeLog.id === afterLog.id) return null;

            const days = Math.max(1, daysBetween(afterLog.date, beforeLog.date));
            const totalGain = parseFloat((afterLog.weight - beforeLog.weight).toFixed(1));
            const periodAdg = parseFloat((totalGain / days).toFixed(2));

            // World-class feedlot performance tiers:
            // 🟢 High Gainers: ADG >= 1.4 kg/day
            // 🟡 On Target: 1.0 <= ADG < 1.4 kg/day
            // 🔴 Poor Doers / Stagnant: ADG < 0.5 kg/day (or negative)
            let tier = 'moderate';
            let tierLabel = 'Moderate';
            if (periodAdg >= 1.4) {
                tier = 'high';
                tierLabel = 'High Gainer (≥1.4)';
            } else if (periodAdg >= 1.0) {
                tier = 'on_target';
                tierLabel = 'On Target (1.0-1.4)';
            } else if (periodAdg < 0.5) {
                tier = 'stagnant';
                tierLabel = 'Poor Doer (<0.5)';
            } else {
                tierLabel = 'Moderate (0.5-1.0)';
            }

            return { animal, beforeLog, afterLog, days, totalGain, periodAdg, tier, tierLabel, latestDiff: logs[logs.length - 1].adg };
        // Ranked report, not a static ledger — sort by weight-gain performance (highest
        // ADG first) so the best/worst performers surface immediately, the standard
        // convention for feedlot performance reports (rank by the metric being measured,
        // not by an arbitrary identifier like tag number).
        }).filter(Boolean).sort((a, b) => b.periodAdg - a.periodAdg);
    })();

    const reportTotals = weightReportRows.reduce((acc, r) => ({
        before: acc.before + r.beforeLog.weight,
        after: acc.after + r.afterLog.weight,
        gain: acc.gain + r.totalGain
    }), { before: 0, after: 0, gain: 0 });

    const reportKpis = (() => {
        const n = weightReportRows.length;
        if (n === 0) return { headCount: 0, beforeAvg: 0, afterAvg: 0, totalGain: 0, avgAdg: 0, stdDev: 0, cv: 0, highCount: 0, targetCount: 0, poorCount: 0 };

        const beforeAvg = parseFloat((reportTotals.before / n).toFixed(1));
        const afterAvg = parseFloat((reportTotals.after / n).toFixed(1));
        const totalGain = parseFloat(reportTotals.gain.toFixed(1));
        const avgAdg = parseFloat((weightReportRows.reduce((sum, r) => sum + r.periodAdg, 0) / n).toFixed(2));

        // Uniformity Score: Standard Deviation & Coefficient of Variation (CV%)
        const variance = weightReportRows.reduce((sum, r) => sum + Math.pow(r.afterLog.weight - afterAvg, 2), 0) / n;
        const stdDev = parseFloat(Math.sqrt(variance).toFixed(1));
        const cv = afterAvg > 0 ? parseFloat(((stdDev / afterAvg) * 100).toFixed(1)) : 0;

        const highCount = weightReportRows.filter(r => r.tier === 'high').length;
        const targetCount = weightReportRows.filter(r => r.tier === 'on_target').length;
        const poorCount = weightReportRows.filter(r => r.tier === 'stagnant').length;

        return { headCount: n, beforeAvg, afterAvg, totalGain, avgAdg, stdDev, cv, highCount, targetCount, poorCount };
    })();

    const exportReportCSV = () => {
        const headers = ['#,Tag,Previous Tags,Breed,Pen,Start Date,Start Wt (kg),End Date,End Wt (kg),Total Gain (kg),Days,Period ADG (kg/day),Performance Tier'];
        const rows = weightReportRows.map((r, idx) =>
            [
                idx + 1,
                r.animal.rfid,
                (r.animal.previousTags && r.animal.previousTags.length > 0) ? r.animal.previousTags.join(';') : '',
                r.animal.breed,
                r.animal.pen || '',
                formatDate(r.beforeLog.date),
                r.beforeLog.weight,
                formatDate(r.afterLog.date),
                r.afterLog.weight,
                r.totalGain,
                r.days,
                r.periodAdg,
                r.tierLabel
            ].join(',')
        );
        rows.push(['TOTAL', '', '', '', '', reportTotals.before.toFixed(1), '', reportTotals.after.toFixed(1), reportTotals.gain.toFixed(1), '', reportKpis.avgAdg, '']);
        const csv = [...headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `BA_Farms_Weight_Gain_Report_${todayPKT()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportReportPDF = () => {
        const doc = new jsPDF({ orientation: 'landscape' });
        
        // Brand Header
        doc.setFillColor(20, 60, 40);
        doc.rect(0, 0, doc.internal.pageSize.width, 18, 'F');
        doc.setFontSize(14);
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        doc.text('BA FARMS · FEEDLOT WEIGHT & GAIN AUDIT REPORT', 14, 12);

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(220, 240, 230);
        const modeTitle = reportMode === 'interval'
            ? 'Latest Interval (Last 2 Weigh-Ins)'
            : reportMode === 'cumulative'
            ? 'Full Cycle (Entry ➔ Latest)'
            : `Custom Range (${reportFrom || 'Earliest'} → ${reportTo || 'Latest'})`;
        doc.text(`Horizon: ${modeTitle}   |   Pen: ${reportPen === 'all' ? 'All Active Pens' : 'Pen ' + reportPen}   |   Generated: ${formatDate(todayPKT())}`, doc.internal.pageSize.width - 14, 12, { align: 'right' });

        // Executive KPI Summary Strip
        autoTable(doc, {
            startY: 23,
            head: [['EXECUTIVE PEN KPI SUMMARY', 'START AVG', 'CURRENT AVG', 'TOTAL GAIN', 'AVG ADG', 'UNIFORMITY SCORE', 'TIER BREAKDOWN']],
            body: [[
                `${reportKpis.headCount} Head Active`,
                `${reportKpis.beforeAvg} kg`,
                `${reportKpis.afterAvg} kg`,
                `+${reportKpis.totalGain} kg`,
                `+${reportKpis.avgAdg} kg/d`,
                `±${reportKpis.stdDev} kg (CV ${reportKpis.cv}%)`,
                `High: ${reportKpis.highCount}  |  Target: ${reportKpis.targetCount}  |  Poor: ${reportKpis.poorCount}`
            ]],
            styles: { fontSize: 8.5, cellPadding: 3, fontStyle: 'bold' },
            headStyles: { fillColor: [35, 45, 40], textColor: [240, 240, 240], fontSize: 7.5 },
            bodyStyles: { fillColor: [245, 248, 246], textColor: [30, 40, 35] },
            theme: 'grid'
        });

        // Animal Data Table
        autoTable(doc, {
            startY: doc.lastAutoTable.finalY + 4,
            head: [['#', 'Tag ID', 'Breed', 'Pen', 'Start Date', 'Start Wt', 'End Date', 'End Wt', 'Gain', 'Days', 'ADG', 'Performance Tier']],
            body: weightReportRows.map((r, idx) => {
                const prevTagText = (r.animal.previousTags && r.animal.previousTags.length > 0)
                    ? `\n(prev: ${r.animal.previousTags.join(', ')})`
                    : '';
                return [
                    idx + 1,
                    `${r.animal.rfid}${prevTagText}`,
                    r.animal.breed,
                    r.animal.pen || '—',
                    formatDate(r.beforeLog.date),
                    `${r.beforeLog.weight} kg`,
                    formatDate(r.afterLog.date),
                    `${r.afterLog.weight} kg`,
                    `${r.totalGain > 0 ? '+' : ''}${r.totalGain} kg`,
                    `${r.days}d`,
                    `${r.periodAdg > 0 ? '+' : ''}${r.periodAdg} kg/d`,
                    r.tierLabel
                ];
            }),
            foot: [[
                `TOTAL (${reportKpis.headCount} Head)`, '', '', '', '',
                `${reportTotals.before.toFixed(1)} kg`, '',
                `${reportTotals.after.toFixed(1)} kg`,
                `+${reportTotals.gain.toFixed(1)} kg`, '',
                `Avg +${reportKpis.avgAdg} kg/d`,
                `High: ${reportKpis.highCount} | Target: ${reportKpis.targetCount} | Poor: ${reportKpis.poorCount}`
            ]],
            styles: { fontSize: 8, cellPadding: 2.5, valign: 'middle' },
            headStyles: { fillColor: [25, 90, 60], textColor: 255, fontStyle: 'bold' },
            footStyles: { fillColor: [230, 235, 230], textColor: 20, fontStyle: 'bold', fontSize: 8 },
            didParseCell: (data) => {
                if (data.section === 'body') {
                    const row = weightReportRows[data.row.index];
                    if (!row) return;
                    if (data.column.index === 10 || data.column.index === 11) {
                        if (row.tier === 'high') {
                            data.cell.styles.textColor = [15, 120, 50];
                            data.cell.styles.fontStyle = 'bold';
                        } else if (row.tier === 'stagnant') {
                            data.cell.styles.textColor = [190, 40, 40];
                            data.cell.styles.fontStyle = 'bold';
                        } else if (row.tier === 'on_target') {
                            data.cell.styles.textColor = [150, 105, 10];
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                }
            }
        });

        doc.save(`BA_Farms_Weight_Gain_Report_${todayPKT()}.pdf`);
    };

    // Helper to find RFID code for table rows
    const getRfid = (animalId) => {
        const animal = animals.find(a => a.id === animalId);
        return animal ? animal.rfid : `Unknown (ID #${animalId})`;
    };

    // Helper: get last weight date for an animal
    const getLastWeighDate = (animalId) => {
        const logs = weightLogs.filter(w => w.animalId === animalId).sort((a, b) => new Date(b.date) - new Date(a.date));
        return logs.length > 0 ? logs[0].date : null;
    };

    // Start Weigh Day
    const startWeighDay = () => {
        const queue = animals
            .filter(a => {
                if (a.status === 'Sold' || a.status === 'Deceased') return false;
                if (weighPen === 'all') return true;
                return a.pen === weighPen;
            })
            .sort((a, b) => a.rfid.localeCompare(b.rfid));
        setWeighQueue(queue);
        setWeighIndex(0);
        setWeighedCount(0);
        setSkippedCount(0);
        setWeighDayComplete(false);
        setBatchWeight('');
        setBatchDate(todayPKT());
        setWeighDayMode(true);
    };

    const handleWeighDaySave = async () => {
        if (!batchWeight) return;
        const currentAnimal = weighQueue[weighIndex];
        await logWeight(currentAnimal.id, batchDate, parseFloat(batchWeight));
        setBatchWeight('');
        setWeighedCount(prev => prev + 1);
        const nextIndex = weighIndex + 1;
        if (nextIndex >= weighQueue.length) {
            setWeighDayComplete(true);
        } else {
            setWeighIndex(nextIndex);
        }
    };

    const handleWeighDaySkip = () => {
        setBatchWeight('');
        setSkippedCount(prev => prev + 1);
        const nextIndex = weighIndex + 1;
        if (nextIndex >= weighQueue.length) {
            setWeighDayComplete(true);
        } else {
            setWeighIndex(nextIndex);
        }
    };

    const exitWeighDay = () => {
        setWeighDayMode(false);
        setWeighDayComplete(false);
        setWeighQueue([]);
        setWeighIndex(0);
        setBatchWeight('');
        setWeighedCount(0);
        setSkippedCount(0);
    };

    if (weighDayMode) {
        const currentAnimal = !weighDayComplete ? weighQueue[weighIndex] : null;
        const progress = weighDayComplete ? weighQueue.length : weighIndex;
        const progressPct = weighQueue.length > 0 ? (progress / weighQueue.length) * 100 : 0;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div class="glass-panel" style={{ borderTop: '4px solid var(--accent-gold)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
                        <h3 class="panel-title" style={{ margin: 0 }}>
                            <i class="fa-solid fa-weight-scale" style={{ color: 'var(--accent-gold)' }}></i>
                            Weigh Day — {weighQueue.length} Animals
                        </h3>
                        <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.3rem 0.8rem', fontSize: '0.8rem', height: '32px' }} onClick={exitWeighDay}>
                            <i class="fa-solid fa-xmark"></i> Exit
                        </button>
                    </div>

                    {/* Progress bar */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                            <span>Progress</span>
                            <strong style={{ color: 'var(--text-pure)' }}>{progress} / {weighQueue.length}</strong>
                        </div>
                        <div class="gauge-track" style={{ height: '8px' }}>
                            <div class="gauge-bar" style={{ width: `${progressPct}%`, background: weighDayComplete ? 'var(--primary-green-light)' : 'var(--accent-gold)', transition: 'width 0.3s ease' }}></div>
                        </div>
                    </div>

                    {weighDayComplete ? (
                        <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                            <i class="fa-solid fa-circle-check" style={{ fontSize: '3rem', color: 'var(--primary-green-light)', marginBottom: '1rem', display: 'block' }}></i>
                            <h3 style={{ color: 'var(--text-pure)', marginBottom: '0.5rem' }}>Weigh Day Complete!</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
                                Weighed: <strong style={{ color: 'var(--primary-green-light)' }}>{weighedCount}</strong> &nbsp;·&nbsp;
                                Skipped: <strong style={{ color: 'var(--accent-gold)' }}>{skippedCount}</strong>
                            </p>
                            <button class="btn btn-primary" onClick={exitWeighDay}>
                                <i class="fa-solid fa-check"></i> Exit Weigh Day
                            </button>
                        </div>
                    ) : currentAnimal && (
                        <div>
                            {/* Current animal card */}
                            <div style={{ background: 'rgba(255,193,7,0.04)', border: '1px solid rgba(255,193,7,0.15)', borderRadius: '10px', padding: '1rem 1.2rem', marginBottom: '1.2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                    <strong style={{ color: 'var(--accent-gold)', fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}>
                                        <i class="fa-solid fa-microchip"></i> {currentAnimal.rfid}
                                    </strong>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '0.2rem 0.5rem' }}>
                                        {weighIndex + 1} of {weighQueue.length}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                    <span>Breed: <strong style={{ color: 'var(--text-pure)' }}>{currentAnimal.breed}</strong></span>
                                    <span>Last Wt: <strong style={{ color: 'var(--text-pure)' }}>{currentAnimal.currentWeight} kg</strong></span>
                                    {currentAnimal.pen && <span>Pen: <strong style={{ color: 'var(--accent-gold)' }}>{currentAnimal.pen}</strong></span>}
                                    {getLastWeighDate(currentAnimal.id) && <span>Last Weighed: <strong style={{ color: 'var(--text-pure)' }}>{formatDate(getLastWeighDate(currentAnimal.id))}</strong></span>}
                                </div>
                            </div>

                            {/* Weight + Date inputs + actions in one line */}
                            <div class="form-inline-grid-weight">
                                <div class="form-group">
                                    <label>Scale Weight (kg)</label>
                                    <input
                                        ref={batchWeightRef}
                                        type="number"
                                        step="0.1"
                                        class="form-control"
                                        placeholder="e.g. 220"
                                        value={batchWeight}
                                        onChange={(e) => setBatchWeight(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') { e.preventDefault(); handleWeighDaySave(); }
                                        }}
                                    />
                                </div>
                                <div class="form-group">
                                    <label>Weighing Date</label>
                                    <input
                                        type="date"
                                        class="form-control"
                                        value={batchDate}
                                        onChange={(e) => setBatchDate(e.target.value)}
                                    />
                                </div>
                                <div class="form-group">
                                    <button class="btn btn-primary" style={{ width: '100%' }} onClick={handleWeighDaySave} disabled={!batchWeight}>
                                        <i class="fa-solid fa-floppy-disk"></i> Save & Next
                                    </button>
                                </div>
                                <div class="form-group">
                                    <button class="btn btn-secondary" style={{ width: '100%', minWidth: '90px' }} onClick={handleWeighDaySkip}>
                                        Skip
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

            <div>
                {/* Form to log weight */}
                <div class="glass-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
                        <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-scale-balanced"></i> Log Weight</h3>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            {/* Pen selector for Weigh Day */}
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Weigh Pen:</span>
                                <button
                                    type="button"
                                    class={`filter-btn ${weighPen === 'all' ? 'active' : ''}`}
                                    style={{ fontSize: '0.72rem', minHeight: '28px', padding: '0.2rem 0.6rem' }}
                                    onClick={() => setWeighPen('all')}
                                >All</button>
                                {activePens.map(p => (
                                    <button
                                        key={p}
                                        type="button"
                                        class={`filter-btn ${weighPen === p ? 'active' : ''}`}
                                        style={{ fontSize: '0.72rem', minHeight: '28px', padding: '0.2rem 0.6rem' }}
                                        onClick={() => setWeighPen(p)}
                                    >Pen {p}</button>
                                ))}
                            </div>
                            <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.3rem 0.9rem', fontSize: '0.8rem', height: '32px' }} onClick={startWeighDay}>
                                <i class="fa-solid fa-list-check"></i> Start Weigh Day
                            </button>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit}>

                        {/* Selected animal confirmation chip */}
                        {selectedAnimal && (() => {
                            const a = animals.find(x => x.id === parseInt(selectedAnimal));
                            return a ? (
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.5rem 0.85rem', background: 'rgba(25,135,84,0.07)', border: '1px solid rgba(25,135,84,0.2)', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.82rem' }}>
                                    <i class="fa-solid fa-microchip" style={{ color: 'var(--accent-gold)' }}></i>
                                    <strong style={{ color: 'var(--text-pure)' }}>{a.rfid}</strong>
                                    <span style={{ color: 'var(--text-muted)' }}>{a.breed}</span>
                                    {a.pen && <span style={{ color: 'var(--accent-gold)' }}>Pen {a.pen}</span>}
                                    <span style={{ color: 'var(--primary-green-light)', marginLeft: 'auto' }}>Last: {a.currentWeight} kg</span>
                                    <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' }} onClick={() => { setSelectedAnimal(''); setTagSearch(''); }}>✕</button>
                                </div>
                            ) : null;
                        })()}

                        <div class="form-inline-grid-weight">
                            {/* Searchable tag picker */}
                            <div class="form-group" style={{ position: 'relative' }} ref={tagFieldRef}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                                    <label style={{ margin: 0 }}>Tag Number</label>
                                    {activePens.length > 0 && (
                                        <div style={{ display: 'flex', gap: '0.2rem' }}>
                                            <button type="button" class={`filter-btn ${selectedPen === 'all' ? 'active' : ''}`}
                                                style={{ fontSize: '0.62rem', minHeight: '18px', padding: '0.05rem 0.3rem' }}
                                                onClick={() => { setSelectedPen('all'); setSelectedAnimal(''); setTagSearch(''); }}>All</button>
                                            {activePens.map(p => (
                                                <button key={p} type="button" class={`filter-btn ${selectedPen === p ? 'active' : ''}`}
                                                    style={{ fontSize: '0.62rem', minHeight: '18px', padding: '0.05rem 0.3rem' }}
                                                    onClick={() => { setSelectedPen(p); setSelectedAnimal(''); setTagSearch(''); }}>P-{p}</button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <input
                                    type="text"
                                    class="form-control"
                                    placeholder="Type tag or scan..."
                                    value={tagSearch}
                                    onChange={e => { setTagSearch(e.target.value); setSelectedAnimal(''); setTagOpen(true); }}
                                    onFocus={() => setTagOpen(true)}
                                    onBlur={() => setTimeout(() => setTagOpen(false), 150)}
                                    autoComplete="off"
                                />
                                {tagOpen && tagSuggestions.length > 0 && tagDropdownRect && createPortal(
                                    <div style={{ position: 'fixed', top: tagDropdownRect.top, left: tagDropdownRect.left, width: tagDropdownRect.width, zIndex: 9999, background: 'hsl(210,15%,8%)', border: '1px solid var(--border-subtle)', borderRadius: '8px', maxHeight: '240px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                                        {tagSuggestions.map(a => (
                                            <button key={a.id} type="button"
                                                style={{ display: 'flex', width: '100%', padding: '0.65rem 1rem', gap: '0.8rem', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'left' }}
                                                onMouseDown={() => selectAnimalFromPicker(a)}>
                                                <strong style={{ color: 'var(--text-pure)', fontFamily: 'var(--font-heading)', minWidth: '48px', fontSize: '1rem' }}>{a.rfid}</strong>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{a.breed}</span>
                                                {a.pen && <span style={{ fontSize: '0.75rem', color: 'var(--accent-gold)' }}>Pen {a.pen}</span>}
                                                <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', marginLeft: 'auto', fontWeight: '600' }}>{a.currentWeight} kg</span>
                                            </button>
                                        ))}
                                    </div>,
                                    document.body
                                )}
                            </div>

                            <div class="form-group">
                                <label>Date of Weighing</label>
                                <input
                                    type="date"
                                    class="form-control"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    required
                                />
                            </div>

                            <div class="form-group">
                                <label>Weight (kg)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    class="form-control"
                                    placeholder="e.g. 185"
                                    value={weight}
                                    onChange={(e) => setWeight(e.target.value)}
                                    required
                                />
                            </div>

                            <div class="form-group">
                                <button type="submit" class="btn btn-primary" style={{ width: '100%' }}>
                                    Save & Calculate ADG
                                </button>
                            </div>
                        </div>


                        {isSuccess && (
                            <div style={{ marginTop: '1.2rem', padding: '0.8rem', background: 'rgba(25,135,84,0.1)', border: '1px solid var(--primary-green-light)', borderRadius: '8px', color: 'var(--primary-green-light)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
                                <i class="fa-solid fa-circle-check"></i>
                                Weight logged.
                            </div>
                        )}

                    </form>
                </div>

            </div>

            {/* Per-animal history panel */}
            {selectedAnimalData && animalHistory.length > 0 && (
                <div class="glass-panel" style={{ borderTop: '3px solid var(--primary-green-light)' }}>
                    <h3 class="panel-title">
                        <i class="fa-solid fa-chart-line"></i> {selectedAnimalData.rfid} — Individual Growth History
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                        {selectedAnimalData.breed} · Entry: {selectedAnimalData.entryWeight} kg · Current: <strong style={{ color: 'var(--primary-green-light)' }}>{selectedAnimalData.currentWeight} kg</strong> · Target: {selectedAnimalData.targetWeight} kg
                        {selectedAnimalData.pen && <> · Pen: <strong style={{ color: 'var(--accent-gold)' }}>{selectedAnimalData.pen}</strong></>}
                    </p>

                    {/* Mini SVG weight chart */}
                    {animalHistory.length >= 2 && (() => {
                        const weights = animalHistory.map(w => w.weight);
                        const minW = Math.min(...weights) - 5;
                        const maxW = Math.max(...weights) + 5;
                        const W = 600, H = 140, pad = 30;
                        const xStep = (W - pad * 2) / (animalHistory.length - 1);
                        const points = animalHistory.map((w, i) => {
                            const x = pad + i * xStep;
                            const y = H - pad - ((w.weight - minW) / (maxW - minW)) * (H - pad * 2);
                            return { x, y, w };
                        });
                        const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                        return (
                            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '140px', marginBottom: '1rem' }}>
                                <polyline
                                    points={points.map(p => `${p.x},${p.y}`).join(' ')}
                                    fill="none"
                                    stroke="var(--primary-green-light)"
                                    strokeWidth="2.5"
                                    strokeLinejoin="round"
                                />
                                {points.map((p, i) => (
                                    <g key={i}>
                                        <circle cx={p.x} cy={p.y} r="4" fill="var(--primary-green-light)" />
                                        <text x={p.x} y={p.y - 8} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="10">{p.w.weight}kg</text>
                                    </g>
                                ))}
                                {/* Target weight line */}
                                {selectedAnimalData.targetWeight >= minW && selectedAnimalData.targetWeight <= maxW && (() => {
                                    const ty = H - pad - ((selectedAnimalData.targetWeight - minW) / (maxW - minW)) * (H - pad * 2);
                                    return <line x1={pad} y1={ty} x2={W - pad} y2={ty} stroke="rgba(255,193,7,0.4)" strokeWidth="1" strokeDasharray="4 3" />;
                                })()}
                            </svg>
                        );
                    })()}

                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', color: 'var(--text-muted)', textAlign: 'center' }}>#</th>
                                    <th>DATE</th>
                                    <th>WEIGHT (KG)</th>
                                    <th>ADG (KG/DAY)</th>
                                    <th>STATUS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {animalHistory.map((log, idx) => (
                                    <tr key={log.id}>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                        <td>{formatDate(log.date)}</td>
                                        <td><strong>{log.weight} kg</strong></td>
                                        <td>
                                            {log.adg !== 0 ? (
                                                <span class={log.adg >= (systemParams.adgAlertThreshold ?? 1.0) ? 'adg-text good' : 'adg-text alert'}>{log.adg > 0 ? '+' : ''}{log.adg} kg/day</span>
                                            ) : (
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Baseline</span>
                                            )}
                                        </td>
                                        <td>
                                            {log.adg === 0 ? <span style={{ color: 'var(--text-muted)' }}>Entry</span>
                                                : log.adg >= (systemParams.adgAlertThreshold ?? 1.0) ? <span style={{ color: 'var(--primary-green-light)' }}><i class="fa-solid fa-circle-check"></i> On Track</span>
                                                : <span style={{ color: 'hsl(0,75%,55%)' }}><i class="fa-solid fa-triangle-exclamation"></i> Below Target</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Weight & Gain Report */}
            <div class="glass-panel" style={{ borderTop: '3px solid var(--accent-gold)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', gap: '1rem', flexWrap: 'wrap' }}>
                    <h3 class="panel-title" style={{ margin: 0 }}>
                        <i class="fa-solid fa-file-invoice" style={{ color: 'var(--accent-gold)' }}></i> Weight &amp; Gain Report
                    </h3>
                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.3rem 0.8rem', fontSize: '0.8rem', height: '32px' }} onClick={exportReportCSV} disabled={weightReportRows.length === 0}>
                            <i class="fa-solid fa-file-csv"></i> Export CSV
                        </button>
                        <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.3rem 0.8rem', fontSize: '0.8rem', height: '32px' }} onClick={exportReportPDF} disabled={weightReportRows.length === 0}>
                            <i class="fa-solid fa-file-pdf"></i> Export PDF
                        </button>
                    </div>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.2rem' }}>
                    Animal-wise before/after weight differential. Only animals with at least two real logged weigh-ins are included — a registration-only weight has nothing to diff against.
                </p>

                {/* 1-Click Mode Selector & Filters */}
                <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.4rem' }}>
                    <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Horizon Mode</div>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                            <button type="button" class={`filter-btn ${reportMode === 'interval' ? 'active' : ''}`}
                                style={{ fontSize: '0.72rem', minHeight: '28px', padding: '0.2rem 0.6rem' }}
                                onClick={() => setReportMode('interval')}>
                                <i class="fa-solid fa-bolt" style={{ marginRight: '3px' }}></i> Latest Interval (Last 2)
                            </button>
                            <button type="button" class={`filter-btn ${reportMode === 'cumulative' ? 'active' : ''}`}
                                style={{ fontSize: '0.72rem', minHeight: '28px', padding: '0.2rem 0.6rem' }}
                                onClick={() => setReportMode('cumulative')}>
                                <i class="fa-solid fa-chart-line" style={{ marginRight: '3px' }}></i> Full Cycle (Entry ➔ Latest)
                            </button>
                            <button type="button" class={`filter-btn ${reportMode === 'custom' ? 'active' : ''}`}
                                style={{ fontSize: '0.72rem', minHeight: '28px', padding: '0.2rem 0.6rem' }}
                                onClick={() => setReportMode('custom')}>
                                <i class="fa-solid fa-calendar" style={{ marginRight: '3px' }}></i> Custom Dates
                            </button>
                        </div>
                    </div>

                    <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Pen</div>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                            <button type="button" class={`filter-btn ${reportPen === 'all' ? 'active' : ''}`}
                                style={{ fontSize: '0.72rem', minHeight: '28px', padding: '0.2rem 0.6rem' }}
                                onClick={() => setReportPen('all')}>All</button>
                            {activePens.map(p => (
                                <button key={p} type="button" class={`filter-btn ${reportPen === p ? 'active' : ''}`}
                                    style={{ fontSize: '0.72rem', minHeight: '28px', padding: '0.2rem 0.6rem' }}
                                    onClick={() => setReportPen(p)}>Pen {p}</button>
                            ))}
                        </div>
                    </div>

                    {reportMode === 'custom' && (
                        <>
                            <div class="form-group" style={{ marginBottom: 0 }}>
                                <label style={{ fontSize: '0.75rem' }}>From (Start)</label>
                                <input type="date" class="form-control" style={{ minHeight: '28px', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} value={reportFrom} onChange={e => setReportFrom(e.target.value)} />
                            </div>
                            <div class="form-group" style={{ marginBottom: 0 }}>
                                <label style={{ fontSize: '0.75rem' }}>To (End)</label>
                                <input type="date" class="form-control" style={{ minHeight: '28px', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} value={reportTo} onChange={e => setReportTo(e.target.value)} />
                            </div>
                            {(reportFrom || reportTo) && (
                                <button type="button" class="btn btn-secondary" style={{ minHeight: '28px', padding: '0.2rem 0.7rem', fontSize: '0.75rem' }} onClick={() => { setReportFrom(''); setReportTo(''); }}>
                                    Clear Dates
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* Executive KPI Summary Cards */}
                {weightReportRows.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.2rem' }}>
                        <div class="glass-panel" style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Head Count &amp; Average Weight</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-pure)', marginTop: '0.2rem' }}>
                                {reportKpis.headCount} Head <span style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-muted)' }}>({reportKpis.beforeAvg}kg ➔ {reportKpis.afterAvg}kg)</span>
                            </div>
                        </div>

                        <div class="glass-panel" style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Gain &amp; Pen Average ADG</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: '700', color: reportKpis.avgAdg >= 1.0 ? 'var(--primary-green-light)' : 'var(--accent-gold)', marginTop: '0.2rem' }}>
                                +{reportKpis.totalGain} kg <span style={{ fontSize: '0.8rem', fontWeight: '600' }}>({reportKpis.avgAdg > 0 ? '+' : ''}{reportKpis.avgAdg} kg/day)</span>
                            </div>
                        </div>

                        <div class="glass-panel" style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Uniformity Score (Spread)</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-pure)', marginTop: '0.2rem' }}>
                                ±{reportKpis.stdDev} kg <span style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-muted)' }}>(CV {reportKpis.cv}%)</span>
                            </div>
                        </div>

                        <div class="glass-panel" style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Performance Tiers</div>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem', fontSize: '0.8rem', fontWeight: '600' }}>
                                <span style={{ color: 'hsl(140,75%,60%)' }}>🟢 High: {reportKpis.highCount}</span>
                                <span style={{ color: 'hsl(45,95%,60%)' }}>🟡 Target: {reportKpis.targetCount}</span>
                                <span style={{ color: 'hsl(0,75%,60%)' }}>🔴 Poor: {reportKpis.poorCount}</span>
                            </div>
                        </div>
                    </div>
                )}

                {weightReportRows.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                        <i class="fa-solid fa-scale-unbalanced" style={{ fontSize: '2rem', marginBottom: '0.8rem', display: 'block', opacity: '0.8' }}></i>
                        No animals with at least two logged weigh-ins in this range yet.
                    </div>
                ) : (
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '45px', color: 'var(--text-muted)', textAlign: 'center' }}>#</th>
                                    <th>TAG ID</th>
                                    <th>BREED</th>
                                    <th>PEN</th>
                                    <th>START DATE</th>
                                    <th>START WT (KG)</th>
                                    <th>END DATE</th>
                                    <th>END WT (KG)</th>
                                    <th>TOTAL GAIN</th>
                                    <th>DAYS</th>
                                    <th>PERIOD ADG</th>
                                    <th>PERFORMANCE TIER</th>
                                </tr>
                            </thead>
                            <tbody>
                                {weightReportRows.map((r, idx) => (
                                    <tr key={r.animal.id}>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                        <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', color: 'var(--text-pure)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                <span>{r.animal.rfid}</span>
                                                {r.animal.previousTags && r.animal.previousTags.length > 0 && (
                                                    <span style={{ fontSize: '0.65rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.12)' }}>
                                                        prev: {r.animal.previousTags.join(', ')}
                                                    </span>
                                                )}
                                                {laggerIds.has(r.animal.id) && (
                                                    <span
                                                        style={{ fontSize: '0.65rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(255,193,7,0.12)', color: 'hsl(45,90%,55%)', fontWeight: '600', border: '1px solid rgba(255,193,7,0.3)' }}
                                                        title="Special Attention: ADG below herd alert threshold"
                                                    >
                                                        <i class="fa-solid fa-triangle-exclamation"></i> Lagger
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>{r.animal.breed}</td>
                                        <td>{r.animal.pen ? <span style={{ color: 'var(--accent-gold)' }}>{r.animal.pen}</span> : '—'}</td>
                                        <td>{formatDate(r.beforeLog.date)}</td>
                                        <td>{r.beforeLog.weight} kg</td>
                                        <td>{formatDate(r.afterLog.date)}</td>
                                        <td><strong>{r.afterLog.weight} kg</strong></td>
                                        <td>
                                            <span class={r.totalGain >= 0 ? 'adg-text good' : 'adg-text alert'}>
                                                {r.totalGain > 0 ? '+' : ''}{r.totalGain} kg
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--text-muted)' }}>{r.days}d</td>
                                        <td>
                                            <span class={r.tier === 'high' ? 'adg-text good' : r.tier === 'stagnant' ? 'adg-text alert' : 'adg-text good'}>
                                                {r.periodAdg > 0 ? '+' : ''}{r.periodAdg} kg/d
                                            </span>
                                        </td>
                                        <td>
                                            {r.tier === 'high' && (
                                                <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '2px 8px', borderRadius: '12px', background: 'rgba(40,167,69,0.15)', color: 'hsl(140,75%,60%)', border: '1px solid rgba(40,167,69,0.3)' }}>
                                                    🟢 High Gainer
                                                </span>
                                            )}
                                            {r.tier === 'on_target' && (
                                                <span style={{ fontSize: '0.72rem', fontWeight: '600', padding: '2px 8px', borderRadius: '12px', background: 'rgba(255,193,7,0.15)', color: 'hsl(45,95%,60%)', border: '1px solid rgba(255,193,7,0.3)' }}>
                                                    🟡 On Target
                                                </span>
                                            )}
                                            {r.tier === 'stagnant' && (
                                                <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '2px 8px', borderRadius: '12px', background: 'rgba(220,53,69,0.15)', color: 'hsl(0,75%,60%)', border: '1px solid rgba(220,53,69,0.3)' }}>
                                                    🔴 Poor Doer
                                                </span>
                                            )}
                                            {r.tier === 'moderate' && (
                                                <span style={{ fontSize: '0.72rem', fontWeight: '500', padding: '2px 8px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                                                    Moderate
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ fontWeight: '700', borderTop: '2px solid rgba(255,255,255,0.1)' }}>
                                    <td colSpan="5">TOTAL ({weightReportRows.length} animal{weightReportRows.length === 1 ? '' : 's'})</td>
                                    <td>{reportTotals.before.toFixed(1)} kg</td>
                                    <td></td>
                                    <td>{reportTotals.after.toFixed(1)} kg</td>
                                    <td>
                                        <span class={reportTotals.gain >= 0 ? 'adg-text good' : 'adg-text alert'}>
                                            {reportTotals.gain > 0 ? '+' : ''}{reportTotals.gain.toFixed(1)} kg
                                        </span>
                                    </td>
                                    <td></td>
                                    <td>
                                        <span style={{ color: reportKpis.avgAdg >= 1.0 ? 'var(--primary-green-light)' : 'var(--accent-gold)' }}>
                                            Avg +{reportKpis.avgAdg} kg/d
                                        </span>
                                    </td>
                                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        🟢 {reportKpis.highCount} | 🟡 {reportKpis.targetCount} | 🔴 {reportKpis.poorCount}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* Historical list */}
            <div className="glass-panel">
                <h3 className="panel-title"><i className="fa-solid fa-clock-rotate-left"></i> Weight History</h3>

                {/* Table */}
                <div className="table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: '45px', color: 'var(--text-muted)', textAlign: 'center' }}>#</th>
                                <th>WEIGHT ENTRY ID</th>
                                <th>RFID TAG ID</th>
                                <th>WEIGHING DATE</th>
                                <th>SCALE WEIGHT (KG)</th>
                                <th>CALCULATED DAILY GAIN (ADG)</th>
                                <th>GROWTH COMPLIANCE</th>
                                <th style={{ textAlign: 'center' }}>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedLogs.map((log, idx) => (
                                <tr key={log.id}>
                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                    <td>#{log.id}</td>
                                    <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', color: 'var(--text-pure)' }}>
                                        {getRfid(log.animalId)}
                                    </td>
                                    <td>{formatDate(log.date)}</td>
                                    <td><strong>{log.weight} kg</strong></td>
                                    <td style={{ fontFamily: 'var(--font-heading)' }}>
                                        {log.adg !== 0 ? (
                                            <span className={log.adg >= (systemParams.adgAlertThreshold ?? 1.0) ? 'adg-text good' : 'adg-text alert'}>
                                                {log.adg > 0 ? '+' : ''}{log.adg} kg/day
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Baseline Record</span>
                                        )}
                                    </td>
                                    <td>
                                        {log.adg === 0 ? (
                                            <span style={{ color: 'var(--text-muted)' }}>Registered</span>
                                        ) : log.adg >= (systemParams.adgAlertThreshold ?? 1.0) ? (
                                            <span style={{ color: 'var(--primary-green-light)', fontWeight: '600' }}><i className="fa-solid fa-circle-check"></i> Standard Met</span>
                                        ) : (
                                            <span style={{ color: 'hsl(0, 75%, 55%)', fontWeight: '600' }}><i className="fa-solid fa-triangle-exclamation"></i> Growth Stunted</span>
                                        )}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.3rem' }}>
                                            <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openEditLogModal(log)}>
                                                <i className="fa-solid fa-pen-to-square"></i>
                                            </button>
                                            <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(220, 53, 69, 0.15)', color: 'hsl(0, 75%, 65%)', background: 'rgba(220, 53, 69, 0.01)' }} onClick={() => {
                                                if (window.confirm("Delete this weight record?")) {
                                                    deleteWeightLog(log.id);
                                                }
                                            }}>
                                                <i className="fa-solid fa-trash-can"></i> Del
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {sortedLogs.length === 0 && (
                                <tr>
                                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                        <i className="fa-solid fa-weight-scale" style={{ fontSize: '2rem', marginBottom: '0.8rem', display: 'block', color: 'var(--text-muted)', opacity: '0.8' }}></i>
                                        No scale weight records registered in the herd database yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* EDIT WEIGHT LOG MODAL */}
            {editingLog && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container" style={{ maxWidth: '420px' }}>
                        <button class="modal-close-btn" onClick={closeEditLogModal}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.8rem', marginBottom: '1.5rem' }}>
                            <i class="fa-solid fa-pen-to-square"></i> Edit Weight Record — {getRfid(editingLog.animalId)}
                        </h2>

                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '-1rem', marginBottom: '1.2rem' }}>
                            Correcting the weight or date recalculates ADG for this and every later record for this animal automatically.
                        </p>

                        <form onSubmit={handleEditLogSubmit}>
                            <div class="form-grid-row" style={{ marginBottom: '1.2rem' }}>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Weight (kg) *</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        class="form-control"
                                        value={editWeight}
                                        onChange={(e) => setEditWeight(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Weighing Date *</label>
                                    <input
                                        type="date"
                                        class="form-control"
                                        value={editDate}
                                        onChange={(e) => setEditDate(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" class="btn btn-secondary" onClick={closeEditLogModal}>Cancel</button>
                                <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save Correction</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
}
