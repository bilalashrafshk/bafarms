import React, { useContext, useState, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, parseDateOnly } from '../utils/dateOnly';

export default function RationVarianceReport() {
    const {
        feedLogs, pens, animals, staffUser, feedStockItems
    } = useContext(FarmContext);

    const isSuperAdmin = staffUser?.isAdmin === true;

    // Filter states
    const [viewMode, setViewMode] = useState('daily'); // 'daily' (Rollup Morning+Evening) | 'session' (Individual feeding sessions)
    const [selectedPen, setSelectedPen] = useState('ALL'); // 'ALL' (Overall Farm) | 'A' | 'B' | 'C' | 'D'
    const [complianceFilter, setComplianceFilter] = useState('all'); // 'all' | 'deviations' | 'omissions'
    const [datePreset, setDatePreset] = useState('30d');
    const [dateFrom, setDateFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
    });
    const [dateTo, setDateTo] = useState(todayPKT());
    const [expandedRowKeys, setExpandedRowKeys] = useState(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [breakdownByPen, setBreakdownByPen] = useState(true);
    const [showPenSummary, setShowPenSummary] = useState(true);

    // Unique pens present in logs
    const uniquePens = useMemo(() => {
        const set = new Set();
        (feedLogs || []).forEach(f => {
            if (f.pen && f.pen !== 'ALL') set.add(f.pen);
        });
        (pens || []).forEach(p => set.add(p.id));
        return Array.from(set).sort();
    }, [feedLogs, pens]);

    // Apply quick date presets
    const handleDatePreset = (preset) => {
        setDatePreset(preset);
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        if (preset === 'today') {
            setDateFrom(todayStr);
            setDateTo(todayStr);
        } else if (preset === 'yesterday') {
            const yest = new Date(today);
            yest.setDate(yest.getDate() - 1);
            const yestStr = yest.toISOString().split('T')[0];
            setDateFrom(yestStr);
            setDateTo(yestStr);
        } else if (preset === '7d') {
            const d = new Date(today);
            d.setDate(d.getDate() - 7);
            setDateFrom(d.toISOString().split('T')[0]);
            setDateTo(todayStr);
        } else if (preset === '30d') {
            const d = new Date(today);
            d.setDate(d.getDate() - 30);
            setDateFrom(d.toISOString().split('T')[0]);
            setDateTo(todayStr);
        } else if (preset === 'thisMonth') {
            setDateFrom(`${yyyy}-${mm}-01`);
            setDateTo(todayStr);
        } else if (preset === 'all') {
            setDateFrom('2026-01-01');
            setDateTo(todayStr);
        }
    };

    const toggleRow = (key) => {
        setExpandedRowKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const expandAll = () => {
        const allKeys = new Set(varianceRows.map(r => r.key));
        setExpandedRowKeys(allKeys);
    };

    const collapseAll = () => {
        setExpandedRowKeys(new Set());
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

    // Core Aggregation Engine
    const varianceRows = useMemo(() => {
        const filteredLogs = (feedLogs || []).filter(f => {
            if (!f.date) return false;
            const d = f.date;
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            if (selectedPen !== 'ALL' && f.pen !== selectedPen) return false;
            return true;
        });

        // Grouping
        const groupsMap = new Map();

        filteredLogs.forEach(f => {
            let groupKey = '';
            let groupTitle = '';
            let penScope = f.pen;

            if (viewMode === 'daily') {
                if (selectedPen === 'ALL' && !breakdownByPen) {
                    groupKey = `${f.date}__ALL_PENS`;
                    groupTitle = 'All Pens (Overall Farm Total)';
                    penScope = 'ALL';
                } else {
                    groupKey = `${f.date}__${f.pen}`;
                    groupTitle = f.pen === 'ALL' ? 'All Pens' : `Pen ${f.pen}`;
                    penScope = f.pen;
                }
            } else {
                groupKey = `${f.date}__${f.pen}__${f.feedingIndex || 0}`;
                groupTitle = f.pen === 'ALL' ? 'All Pens' : `Pen ${f.pen}`;
                penScope = f.pen;
            }

            if (!groupsMap.has(groupKey)) {
                groupsMap.set(groupKey, {
                    key: groupKey,
                    date: f.date,
                    pen: penScope,
                    penTitle: groupTitle,
                    logs: [],
                    totalAnimals: 0,
                    pensSet: new Set(),
                    sessionsSet: new Set(),
                    notesList: []
                });
            }

            const group = groupsMap.get(groupKey);
            group.logs.push(f);
            group.pensSet.add(f.pen);
            group.sessionsSet.add(parseFeedingSession(f));
            if (f.notes) group.notesList.push(f.notes);
        });

        // Compute variances for each group
        const result = [];

        groupsMap.forEach(group => {
            const ingMap = new Map();
            let totalActualWeight = 0;
            let totalPlannedWeight = 0;
            let totalActualCost = 0;
            let totalPlannedCost = 0;
            let maxAnimalCount = 0;

            // In daily rollup mode across all pens, total animals is the sum of headCount per pen on that day
            if (viewMode === 'daily' && group.pen === 'ALL') {
                const penAnimalMap = new Map();
                group.logs.forEach(f => {
                    const existing = penAnimalMap.get(f.pen) || 0;
                    penAnimalMap.set(f.pen, Math.max(existing, f.animalCount || 0));
                });
                maxAnimalCount = Array.from(penAnimalMap.values()).reduce((a, b) => a + b, 0);
            } else {
                group.logs.forEach(f => {
                    maxAnimalCount = Math.max(maxAnimalCount, f.animalCount || 0);
                });
            }

            group.logs.forEach(f => {
                const rawIngs = Array.isArray(f.ingredients) ? f.ingredients : (typeof f.ingredients === 'string' ? JSON.parse(f.ingredients || '[]') : []);
                const logAnimals = f.animalCount || maxAnimalCount || 1;

                rawIngs.forEach(ing => {
                    const ingId = ing.id || ing.name;
                    const name = ing.name || ingId;
                    const price = parseFloat(ing.price || ing.rate || 0);
                    
                    const actualPerHead = parseFloat(ing.wetSingle || ing.qtyKg || 0);
                    const plannedPerHead = ing.plannedQtyKg !== undefined && ing.plannedQtyKg !== null ? parseFloat(ing.plannedQtyKg) : actualPerHead;
                    
                    const actualTotalBatch = ing.wetBatch !== undefined && ing.wetBatch !== null ? parseFloat(ing.wetBatch) : (actualPerHead * logAnimals);
                    const plannedTotalBatch = plannedPerHead * logAnimals;
                    
                    const actualCostSingle = ing.costSingle !== undefined && ing.costSingle !== null ? parseFloat(ing.costSingle) : (actualPerHead * price);
                    const actualCostTotal = actualTotalBatch * price;
                    const plannedCostTotal = plannedTotalBatch * price;

                    if (!ingMap.has(name)) {
                        ingMap.set(name, {
                            id: ingId,
                            name: name,
                            price: price,
                            actualTotalKg: 0,
                            plannedTotalKg: 0,
                            actualCostTotal: 0,
                            plannedCostTotal: 0,
                            occurrences: 0
                        });
                    }

                    const record = ingMap.get(name);
                    record.actualTotalKg += actualTotalBatch;
                    record.plannedTotalKg += plannedTotalBatch;
                    record.actualCostTotal += actualCostTotal;
                    record.plannedCostTotal += plannedCostTotal;
                    record.price = Math.max(record.price, price);
                    record.occurrences += 1;
                });
            });

            // Flatten ingredients list
            const ingredientRows = [];
            let omissionsCount = 0;
            let additionsCount = 0;
            let anyVariance = false;

            ingMap.forEach((data, name) => {
                const actualPerHead = maxAnimalCount > 0 ? (data.actualTotalKg / maxAnimalCount) : 0;
                const plannedPerHead = maxAnimalCount > 0 ? (data.plannedTotalKg / maxAnimalCount) : 0;
                const diffKg = data.actualTotalKg - data.plannedTotalKg;
                const diffPerHead = actualPerHead - plannedPerHead;
                const diffCost = data.actualCostTotal - data.plannedCostTotal;
                
                let diffPct = 0;
                if (data.plannedTotalKg > 0.001) {
                    diffPct = ((data.actualTotalKg - data.plannedTotalKg) / data.plannedTotalKg) * 100;
                } else if (data.actualTotalKg > 0.001) {
                    diffPct = 100;
                }

                const isOmitted = data.plannedTotalKg > 0.01 && data.actualTotalKg <= 0.001;
                const isExtra = data.plannedTotalKg <= 0.001 && data.actualTotalKg > 0.01;
                const isSignificant = Math.abs(diffPct) >= 2.0;

                if (isOmitted) omissionsCount += 1;
                if (isExtra) additionsCount += 1;
                if (isSignificant || isOmitted || isExtra) anyVariance = true;

                totalActualWeight += data.actualTotalKg;
                totalPlannedWeight += data.plannedTotalKg;
                totalActualCost += data.actualCostTotal;
                totalPlannedCost += data.plannedCostTotal;

                ingredientRows.push({
                    name,
                    price: data.price,
                    plannedPerHead,
                    actualPerHead,
                    plannedTotalKg: data.plannedTotalKg,
                    actualTotalKg: data.actualTotalKg,
                    diffKg,
                    diffPerHead,
                    diffPct,
                    diffCost,
                    plannedCostTotal: data.plannedCostTotal,
                    actualCostTotal: data.actualCostTotal,
                    isOmitted,
                    isExtra,
                    isSignificant
                });
            });

            // Sort ingredients by planned weight descending
            ingredientRows.sort((a, b) => b.plannedTotalKg - a.plannedTotalKg);

            const netWeightDiff = totalActualWeight - totalPlannedWeight;
            const netWeightDiffPct = totalPlannedWeight > 0.001 ? (netWeightDiff / totalPlannedWeight) * 100 : 0;
            const netCostDiff = totalActualCost - totalPlannedCost;
            const netCostDiffPct = totalPlannedCost > 0.001 ? (netCostDiff / totalPlannedCost) * 100 : 0;

            const plannedPerHeadTotal = maxAnimalCount > 0 ? (totalPlannedWeight / maxAnimalCount) : 0;
            const actualPerHeadTotal = maxAnimalCount > 0 ? (totalActualWeight / maxAnimalCount) : 0;
            const plannedCostPerHeadTotal = maxAnimalCount > 0 ? (totalPlannedCost / maxAnimalCount) : 0;
            const actualCostPerHeadTotal = maxAnimalCount > 0 ? (totalActualCost / maxAnimalCount) : 0;

            let status = 'exact';
            if (omissionsCount > 0) {
                status = 'omission';
            } else if (Math.abs(netWeightDiffPct) >= 5.0 || Math.abs(netCostDiffPct) >= 5.0 || additionsCount > 0) {
                status = 'major';
            } else if (anyVariance || Math.abs(netWeightDiffPct) >= 1.0) {
                status = 'minor';
            }

            result.push({
                ...group,
                maxAnimalCount,
                sessionsCount: group.sessionsSet.size,
                sessionsLabel: Array.from(group.sessionsSet).join(', '),
                pensCount: group.pensSet.size,
                pensLabel: Array.from(group.pensSet).join(', '),
                totalActualWeight,
                totalPlannedWeight,
                netWeightDiff,
                netWeightDiffPct,
                totalActualCost,
                totalPlannedCost,
                netCostDiff,
                netCostDiffPct,
                plannedPerHeadTotal,
                actualPerHeadTotal,
                plannedCostPerHeadTotal,
                actualCostPerHeadTotal,
                omissionsCount,
                additionsCount,
                anyVariance,
                status,
                ingredientRows
            });
        });

        // Filter by compliance status & search query
        return result
            .filter(row => {
                if (complianceFilter === 'deviations' && row.status === 'exact') return false;
                if (complianceFilter === 'omissions' && row.omissionsCount === 0) return false;
                if (searchQuery.trim()) {
                    const q = searchQuery.toLowerCase().trim();
                    const matchDate = (row.date || '').toLowerCase().includes(q);
                    const matchPen = (row.penTitle || '').toLowerCase().includes(q);
                    const matchIng = row.ingredientRows.some(i => i.name.toLowerCase().includes(q));
                    if (!matchDate && !matchPen && !matchIng) return false;
                }
                return true;
            })
            .sort((a, b) => b.date.localeCompare(a.date));
    }, [feedLogs, dateFrom, dateTo, selectedPen, viewMode, complianceFilter, searchQuery, pens]);

    // Top KPI Summary Metrics across current filtered view
    const kpiMetrics = useMemo(() => {
        const count = varianceRows.length;
        if (count === 0) {
            return {
                totalFeedings: 0,
                exactCount: 0,
                minorCount: 0,
                majorCount: 0,
                omissionCount: 0,
                compliancePct: 100,
                totalPlannedWeight: 0,
                totalActualWeight: 0,
                netWeightDiff: 0,
                netWeightDiffPct: 0,
                totalPlannedCost: 0,
                totalActualCost: 0,
                netCostDiff: 0
            };
        }

        let exactCount = 0;
        let minorCount = 0;
        let majorCount = 0;
        let totalOmissions = 0;
        let totalPlannedWeight = 0;
        let totalActualWeight = 0;
        let totalPlannedCost = 0;
        let totalActualCost = 0;

        varianceRows.forEach(r => {
            if (r.status === 'exact') exactCount += 1;
            else if (r.status === 'minor') minorCount += 1;
            else if (r.status === 'major' || r.status === 'omission') majorCount += 1;
            totalOmissions += r.omissionsCount;
            totalPlannedWeight += r.totalPlannedWeight;
            totalActualWeight += r.totalActualWeight;
            totalPlannedCost += r.totalPlannedCost;
            totalActualCost += r.totalActualCost;
        });

        const compliancePct = Math.round((exactCount / count) * 100);
        const netWeightDiff = totalActualWeight - totalPlannedWeight;
        const netWeightDiffPct = totalPlannedWeight > 0.001 ? (netWeightDiff / totalPlannedWeight) * 100 : 0;
        const netCostDiff = totalActualCost - totalPlannedCost;

        return {
            totalFeedings: count,
            exactCount,
            minorCount,
            majorCount,
            totalOmissions,
            compliancePct,
            totalPlannedWeight,
            totalActualWeight,
            netWeightDiff,
            netWeightDiffPct,
            totalPlannedCost,
            totalActualCost,
            netCostDiff
        };
    }, [varianceRows]);

    // Compute pen-by-pen summary comparison for the current date window
    const penSummaries = useMemo(() => {
        const pensList = uniquePens.filter(p => p !== 'ALL');
        const map = new Map();
        pensList.forEach(p => {
            map.set(p, {
                pen: p,
                headCount: 0,
                feedingsCount: 0,
                exactCount: 0,
                totalPlannedWeight: 0,
                totalActualWeight: 0,
                totalPlannedCost: 0,
                totalActualCost: 0,
                omissionsCount: 0
            });
        });

        const inWindowLogs = (feedLogs || []).filter(f => {
            if (!f.date) return false;
            const d = f.date;
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            return true;
        });

        inWindowLogs.forEach(f => {
            const p = f.pen;
            if (!p || p === 'ALL' || !map.has(p)) return;
            const stats = map.get(p);
            stats.feedingsCount += 1;
            stats.headCount = Math.max(stats.headCount, f.animalCount || 0);

            const rawIngs = Array.isArray(f.ingredients) ? f.ingredients : (typeof f.ingredients === 'string' ? JSON.parse(f.ingredients || '[]') : []);
            const logAnimals = f.animalCount || 1;

            let logPlannedWt = 0;
            let logActualWt = 0;
            let logPlannedCost = 0;
            let logActualCost = 0;
            let hasOmission = false;

            rawIngs.forEach(ing => {
                const price = parseFloat(ing.price || ing.rate || 0);
                const actualPerHead = parseFloat(ing.wetSingle || ing.qtyKg || 0);
                const plannedPerHead = ing.plannedQtyKg !== undefined && ing.plannedQtyKg !== null ? parseFloat(ing.plannedQtyKg) : actualPerHead;

                const actualTotal = ing.wetBatch !== undefined && ing.wetBatch !== null ? parseFloat(ing.wetBatch) : (actualPerHead * logAnimals);
                const plannedTotal = plannedPerHead * logAnimals;

                logActualWt += actualTotal;
                logPlannedWt += plannedTotal;
                logActualCost += actualTotal * price;
                logPlannedCost += plannedTotal * price;

                if (plannedTotal > 0.01 && actualTotal <= 0.001) hasOmission = true;
            });

            stats.totalPlannedWeight += logPlannedWt;
            stats.totalActualWeight += logActualWt;
            stats.totalPlannedCost += logPlannedCost;
            stats.totalActualCost += logActualCost;
            if (hasOmission) stats.omissionsCount += 1;

            const diff = Math.abs(logActualWt - logPlannedWt);
            if (diff < 0.5 || (logPlannedWt > 0 && (diff / logPlannedWt) < 0.02)) {
                stats.exactCount += 1;
            }
        });

        return Array.from(map.values()).map(s => {
            const diffWeight = s.totalActualWeight - s.totalPlannedWeight;
            const diffPct = s.totalPlannedWeight > 0.001 ? (diffWeight / s.totalPlannedWeight) * 100 : 0;
            const diffCost = s.totalActualCost - s.totalPlannedCost;
            const compliancePct = s.feedingsCount > 0 ? Math.round((s.exactCount / s.feedingsCount) * 100) : 100;
            const activeAnimalsInPen = animals.filter(a => String(a.pen) === String(s.pen) && a.status !== 'Sold' && a.status !== 'Deceased');
            const headCount = activeAnimalsInPen.length || s.headCount;

            const penPlan = pens.find(p => String(p.id) === String(s.pen));

            return {
                ...s,
                headCount,
                diffWeight,
                diffPct,
                diffCost,
                compliancePct,
                planName: penPlan?.name || penPlan?.planKey || `Pen ${s.pen}`
            };
        });
    }, [feedLogs, dateFrom, dateTo, uniquePens, animals, pens]);

    // CSV Export
    const exportCSV = () => {
        if (varianceRows.length === 0) {
            alert('No variance data available to export.');
            return;
        }

        const headers = [
            'Date', 'Pen/Scope', 'Head Count', 'Sessions',
            'Planned Total (kg)', 'Actual Fed Total (kg)', 'Variance (kg)', 'Variance (%)',
            'Planned / Head (kg)', 'Actual / Head (kg)',
            'Planned Cost (PKR)', 'Actual Cost (PKR)', 'Cost Variance (PKR)', 'Compliance Status'
        ];

        const rows = varianceRows.map(r => [
            `"${r.date}"`,
            `"${r.penTitle}"`,
            r.maxAnimalCount,
            `"${r.sessionsLabel}"`,
            r.totalPlannedWeight.toFixed(2),
            r.totalActualWeight.toFixed(2),
            r.netWeightDiff.toFixed(2),
            `${r.netWeightDiffPct.toFixed(1)}%`,
            r.plannedPerHeadTotal.toFixed(2),
            r.actualPerHeadTotal.toFixed(2),
            r.totalPlannedCost.toFixed(2),
            r.totalActualCost.toFixed(2),
            r.netCostDiff.toFixed(2),
            `"${r.status.toUpperCase()}"`
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `Ration_Plan_vs_Actual_Variance_${dateFrom}_to_${dateTo}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            
            {/* Header Title & Controls */}
            <div className="section-header" style={{ marginBottom: 0 }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <i className="fa-solid fa-scale-unbalanced-flip" style={{ color: 'var(--primary-green-light)' }}></i>
                        Ration Plan vs Actual Variance Report
                    </h2>
                    <p style={{ margin: 0 }}>
                        Multi-date compliance audit, ingredient deviations, omitted micro-nutrients & financial variance
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        className={`btn ${showPenMatrix ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setShowPenMatrix(prev => !prev)}
                        style={{ fontSize: '0.8rem' }}
                        title="Toggle Pen Comparison Matrix"
                    >
                        <i className="fa-solid fa-table-columns"></i> {showPenMatrix ? 'Hide Pen Matrix' : 'Pen-Wise Matrix'}
                    </button>
                    <button className="btn btn-secondary" onClick={exportCSV} title="Export CSV for Excel" style={{ fontSize: '0.8rem' }}>
                        <i className="fa-solid fa-file-csv"></i> Export CSV
                    </button>
                    <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem' }}
                        onClick={() => {
                            if (expandedRowKeys.size === varianceRows.length) collapseAll();
                            else expandAll();
                        }}
                    >
                        <i className={`fa-solid ${expandedRowKeys.size === varianceRows.length ? 'fa-compress' : 'fa-expand'}`}></i>
                        {expandedRowKeys.size === varianceRows.length ? 'Collapse All' : 'Expand All'}
                    </button>
                </div>
            </div>

            {/* Quick Pen-Select Pill Header */}
            <div className="glass-panel" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', borderLeft: '4px solid var(--primary-green-light)' }}>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', marginRight: '0.2rem' }}>
                        <i className="fa-solid fa-layer-group" style={{ color: 'var(--primary-green-light)', marginRight: '4px' }}></i> Pen Scope:
                    </span>
                    <button
                        type="button"
                        className={`filter-btn ${selectedPen === 'ALL' ? 'active' : ''}`}
                        onClick={() => setSelectedPen('ALL')}
                        style={{ fontSize: '0.76rem', padding: '0.25rem 0.75rem' }}
                    >
                        🌐 All Pens ({animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased').length} Head)
                    </button>
                    {uniquePens.map(p => {
                        const penHeadCount = animals.filter(a => String(a.pen) === String(p) && a.status !== 'Sold' && a.status !== 'Deceased').length;
                        return (
                            <button
                                key={p}
                                type="button"
                                className={`filter-btn ${selectedPen === p ? 'active' : ''}`}
                                onClick={() => setSelectedPen(p)}
                                style={{ fontSize: '0.76rem', padding: '0.25rem 0.75rem' }}
                            >
                                🏷️ Pen {p} ({penHeadCount} Head)
                            </button>
                        );
                    })}
                </div>

                {selectedPen === 'ALL' && viewMode === 'daily' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Daily Rows:</span>
                        <button
                            type="button"
                            className={`btn btn-sm ${breakdownByPen ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setBreakdownByPen(true)}
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
                        >
                            <i className="fa-solid fa-table-cells"></i> Pen-by-Pen
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm ${!breakdownByPen ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setBreakdownByPen(false)}
                            style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
                        >
                            <i className="fa-solid fa-globe"></i> Farm Consolidated
                        </button>
                    </div>
                )}
            </div>

            {/* Pen-by-Pen Comparative Performance Matrix (Side-by-side cards) */}
            {showPenMatrix && penSummaries.length > 0 && (
                <div className="glass-panel" style={{ padding: '1rem', borderTop: '3px solid var(--accent-gold)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                            <h3 className="panel-title" style={{ margin: 0, fontSize: '0.92rem' }}>
                                <i className="fa-solid fa-chart-pie" style={{ color: 'var(--accent-gold)', marginRight: '6px' }}></i>
                                Pen-Wise Plan vs Actual Comparison Matrix
                            </h3>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                Period: {formatDate(dateFrom)} ➔ {formatDate(dateTo)} • Side-by-side pen compliance & intake variance
                            </span>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.8rem' }}>
                        {penSummaries.map(ps => {
                            const isSelected = selectedPen === ps.pen;
                            const isOver = ps.diffWeight > 0.5;
                            const isUnder = ps.diffWeight < -0.5;
                            const statusColor = ps.compliancePct >= 90 ? 'var(--primary-green-light)' : ps.compliancePct >= 70 ? 'hsl(43,90%,53%)' : 'hsl(0,75%,65%)';

                            return (
                                <div
                                    key={ps.pen}
                                    style={{
                                        background: isSelected ? 'rgba(74, 222, 128, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                                        border: isSelected ? '1.5px solid var(--primary-green-light)' : '1px solid rgba(255, 255, 255, 0.08)',
                                        borderRadius: '8px',
                                        padding: '0.85rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.5rem',
                                        position: 'relative'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ fontWeight: '800', fontSize: '1rem', color: 'var(--text-pure)' }}>
                                                Pen {ps.pen}
                                            </span>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--accent-gold)', background: 'rgba(255,193,7,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '600' }}>
                                                {ps.headCount} Head
                                            </span>
                                        </div>
                                        <span style={{ fontSize: '0.72rem', fontWeight: '700', color: statusColor }}>
                                            {ps.compliancePct}% On Plan
                                        </span>
                                    </div>

                                    {/* Weight Variance */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.35rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>Fed / Planned:</span>
                                        <span>
                                            <strong>{ps.totalActualWeight.toFixed(0)} kg</strong>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}> / {ps.totalPlannedWeight.toFixed(0)} kg</span>
                                        </span>
                                    </div>

                                    {/* Net Delta */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.35rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>Variance:</span>
                                        <span style={{ fontWeight: '700', color: Math.abs(ps.diffPct) <= 2 ? 'var(--primary-green-light)' : isOver ? 'hsl(43,90%,53%)' : 'hsl(0,75%,65%)' }}>
                                            {ps.diffWeight > 0 ? '+' : ''}{ps.diffWeight.toFixed(1)} kg ({ps.diffPct > 0 ? '+' : ''}{ps.diffPct.toFixed(1)}%)
                                        </span>
                                    </div>

                                    {/* Cost Impact */}
                                    {isSuperAdmin && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.35rem' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>Cost Delta:</span>
                                            <span style={{ fontWeight: '700', color: ps.diffCost > 0 ? 'hsl(43,90%,53%)' : 'var(--primary-green-light)' }}>
                                                {ps.diffCost > 0 ? '+' : ''}{Math.round(ps.diffCost).toLocaleString()} PKR
                                            </span>
                                        </div>
                                    )}

                                    {/* Action Button */}
                                    <button
                                        type="button"
                                        className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setSelectedPen(ps.pen)}
                                        style={{ marginTop: '0.2rem', fontSize: '0.72rem', padding: '0.2rem 0.5rem', width: '100%' }}
                                    >
                                        {isSelected ? '✓ Currently Viewing' : `Filter to Pen ${ps.pen}`}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Filter Panel */}
            <div className="glass-panel" style={{ padding: '1rem' }}>
                <div className="form-grid-3" style={{ marginBottom: '0.8rem', gap: '0.8rem' }}>
                    
                    {/* View Mode (Daily vs Session) */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: '600' }}>Aggregation Mode</label>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                            <button
                                type="button"
                                className={`btn ${viewMode === 'daily' ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ flex: 1, fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
                                onClick={() => setViewMode('daily')}
                            >
                                <i className="fa-solid fa-calendar-day" style={{ marginRight: '4px' }}></i> Full Day Rollup
                            </button>
                            <button
                                type="button"
                                className={`btn ${viewMode === 'session' ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ flex: 1, fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
                                onClick={() => setViewMode('session')}
                            >
                                <i className="fa-solid fa-clock" style={{ marginRight: '4px' }}></i> By Session (Split)
                            </button>
                        </div>
                    </div>

                    {/* Pen Scope Filter Dropdown */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: '600' }}>Pen / Scope Selection</label>
                        <select
                            className="form-control"
                            value={selectedPen}
                            onChange={(e) => setSelectedPen(e.target.value)}
                            style={{ fontSize: '0.82rem', padding: '0.35rem 0.6rem' }}
                        >
                            <option value="ALL">🌐 All Pens Combined (Overall Farm)</option>
                            {uniquePens.map(p => (
                                <option key={p} value={p}>Pen {p}</option>
                            ))}
                        </select>
                    </div>

                    {/* Search Filter */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: '600' }}>Search Ingredient / Date</label>
                        <div className="search-bar" style={{ width: '100%' }}>
                            <i className="fa-solid fa-search"></i>
                            <input
                                type="text"
                                placeholder="Search ingredient, date..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ width: '100%', fontSize: '0.8rem' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Date Presets & Custom Range */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginRight: '0.3rem' }}>Date Presets:</span>
                        {[['Today', 'today'], ['Yesterday', 'yesterday'], ['Last 7d', '7d'], ['Last 30d', '30d'], ['This Month', 'thisMonth'], ['All Time', 'all']].map(([label, val]) => (
                            <button
                                key={val}
                                type="button"
                                className={`btn ${datePreset === val ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', minHeight: '26px' }}
                                onClick={() => handleDatePreset(val)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <input
                            type="date"
                            className="form-control"
                            value={dateFrom}
                            onChange={(e) => { setDateFrom(e.target.value); setDatePreset('custom'); }}
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', width: '130px', height: '28px' }}
                        />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>to</span>
                        <input
                            type="date"
                            className="form-control"
                            value={dateTo}
                            onChange={(e) => { setDateTo(e.target.value); setDatePreset('custom'); }}
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', width: '130px', height: '28px' }}
                        />
                    </div>
                </div>

                {/* Compliance Quick Filters */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', paddingTop: '0.6rem', marginTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.06)', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginRight: '0.3rem' }}>Compliance Filter:</span>
                    <button
                        type="button"
                        className={`filter-btn ${complianceFilter === 'all' ? 'active' : ''}`}
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '26px' }}
                        onClick={() => setComplianceFilter('all')}
                    >
                        All Feedings ({varianceRows.length})
                    </button>
                    <button
                        type="button"
                        className={`filter-btn ${complianceFilter === 'deviations' ? 'active' : ''}`}
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '26px', color: 'hsl(43,90%,53%)' }}
                        onClick={() => setComplianceFilter('deviations')}
                    >
                        ⚠️ Deviations Only ({varianceRows.filter(r => r.status !== 'exact').length})
                    </button>
                    <button
                        type="button"
                        className={`filter-btn ${complianceFilter === 'omissions' ? 'active' : ''}`}
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', minHeight: '26px', color: 'hsl(0,75%,65%)' }}
                        onClick={() => setComplianceFilter('omissions')}
                    >
                        🔴 Skipped / Omitted Items ({varianceRows.filter(r => r.omissionsCount > 0).length})
                    </button>
                </div>
            </div>

            {/* KPI Summary Overview Cards */}
            <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.8rem' }}>
                
                {/* 1. Compliance Rate */}
                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Plan Compliance Rate</h3>
                        <div className="stat-icon"><i className="fa-solid fa-circle-check"></i></div>
                    </div>
                    <div className="stat-val" style={{ color: kpiMetrics.compliancePct >= 80 ? 'var(--primary-green-light)' : 'hsl(43,90%,53%)' }}>
                        {kpiMetrics.compliancePct}%
                    </div>
                    <span className="stat-lbl">
                        {kpiMetrics.exactCount} of {kpiMetrics.totalFeedings} feedings 100% on target
                    </span>
                </div>

                {/* 2. Weight Variance */}
                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Net Feed Weight Variance</h3>
                        <div className="stat-icon"><i className="fa-solid fa-weight-scale"></i></div>
                    </div>
                    <div className="stat-val" style={{ color: Math.abs(kpiMetrics.netWeightDiffPct) <= 2.0 ? 'var(--text-pure)' : kpiMetrics.netWeightDiff > 0 ? 'var(--accent-gold)' : 'hsl(0,75%,65%)' }}>
                        {kpiMetrics.netWeightDiff > 0 ? '+' : ''}{kpiMetrics.netWeightDiff.toFixed(1)} <small style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>kg ({kpiMetrics.netWeightDiffPct > 0 ? '+' : ''}{kpiMetrics.netWeightDiffPct.toFixed(1)}%)</small>
                    </div>
                    <span className="stat-lbl">
                        Fed {kpiMetrics.totalActualWeight.toFixed(0)} kg vs Planned {kpiMetrics.totalPlannedWeight.toFixed(0)} kg
                    </span>
                </div>

                {/* 3. Cost Impact */}
                {isSuperAdmin && (
                    <div className="glass-panel stat-box">
                        <div className="stat-header">
                            <h3>Ration Cost Impact</h3>
                            <div className="stat-icon"><i className="fa-solid fa-money-bill-wave"></i></div>
                        </div>
                        <div className="stat-val" style={{ color: kpiMetrics.netCostDiff > 0 ? 'hsl(43,90%,53%)' : 'var(--primary-green-light)' }}>
                            {kpiMetrics.netCostDiff > 0 ? '+' : ''}{Math.round(kpiMetrics.netCostDiff).toLocaleString()} <small style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>PKR</small>
                        </div>
                        <span className="stat-lbl">
                            Actual: {Math.round(kpiMetrics.totalActualCost).toLocaleString()} PKR vs Budget: {Math.round(kpiMetrics.totalPlannedCost).toLocaleString()} PKR
                        </span>
                    </div>
                )}

                {/* 4. Omissions Alert */}
                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Omitted Nutrients</h3>
                        <div className="stat-icon"><i className="fa-solid fa-triangle-exclamation"></i></div>
                    </div>
                    <div className="stat-val" style={{ color: kpiMetrics.totalOmissions === 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,65%)' }}>
                        {kpiMetrics.totalOmissions} <small style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>instances</small>
                    </div>
                    <span className="stat-lbl">
                        {kpiMetrics.totalOmissions === 0 ? 'All formulated micro-nutrients fed' : 'Critical micro-nutrients or straw omitted'}
                    </span>
                </div>
            </div>

            {/* Master Variance Table */}
            <div className="glass-panel" style={{ padding: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                    <h3 className="panel-title" style={{ margin: 0, fontSize: '0.95rem' }}>
                        <i className="fa-solid fa-list-check" style={{ marginRight: '6px' }}></i>
                        Feeding Log Compliance Ledger ({varianceRows.length} {viewMode === 'daily' ? 'Days' : 'Sessions'})
                    </h3>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        <i className="fa-solid fa-info-circle" style={{ marginRight: '4px' }}></i> Click any row to expand the full ingredient delta breakdown
                    </span>
                </div>

                <div className="table-wrapper">
                    <table className="data-table" style={{ fontSize: '0.85rem' }}>
                        <thead>
                            <tr>
                                <th style={{ width: '35px', textAlign: 'center', color: 'var(--text-muted)' }}>#</th>
                                <th>DATE</th>
                                <th>PEN / SCOPE</th>
                                <th style={{ textAlign: 'center' }}>ANIMALS</th>
                                {viewMode === 'session' && <th>SESSION</th>}
                                <th>PLANNED (KG)</th>
                                <th>ACTUAL FED (KG)</th>
                                <th>WEIGHT VARIANCE</th>
                                {isSuperAdmin && <th>PLANNED COST</th>}
                                {isSuperAdmin && <th>ACTUAL COST</th>}
                                {isSuperAdmin && <th>COST VARIANCE</th>}
                                <th style={{ textAlign: 'center' }}>COMPLIANCE</th>
                                <th style={{ width: '70px', textAlign: 'center' }}>DETAILS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {varianceRows.map((row, idx) => {
                                const isExpanded = expandedRowKeys.has(row.key);
                                const isPositive = row.netWeightDiff > 0.05;
                                const isNegative = row.netWeightDiff < -0.05;

                                return (
                                    <React.Fragment key={row.key}>
                                        <tr
                                            onClick={() => toggleRow(row.key)}
                                            style={{
                                                cursor: 'pointer',
                                                background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent',
                                                transition: 'background 0.15s ease'
                                            }}
                                        >
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                            <td style={{ fontWeight: '600', color: 'var(--text-pure)', whiteSpace: 'nowrap' }}>
                                                {formatDate(row.date)}
                                            </td>
                                            <td>
                                                <strong style={{ color: row.pen === 'ALL' ? 'var(--accent-gold)' : 'var(--text-pure)' }}>
                                                    {row.penTitle}
                                                </strong>
                                                {viewMode === 'daily' && row.sessionsCount > 1 && (
                                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                        {row.sessionsCount} feedings ({row.sessionsLabel})
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center', fontWeight: '600' }}>
                                                {row.maxAnimalCount}
                                            </td>
                                            {viewMode === 'session' && (
                                                <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    {row.sessionsLabel}
                                                </td>
                                            )}
                                            <td>
                                                <div><strong>{row.totalPlannedWeight.toFixed(1)} kg</strong></div>
                                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                    {row.plannedPerHeadTotal.toFixed(2)} kg/head
                                                </div>
                                            </td>
                                            <td>
                                                <div><strong>{row.totalActualWeight.toFixed(1)} kg</strong></div>
                                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                    {row.actualPerHeadTotal.toFixed(2)} kg/head
                                                </div>
                                            </td>
                                            <td>
                                                <div style={{
                                                    fontWeight: '700',
                                                    color: Math.abs(row.netWeightDiffPct) <= 1.0 ? 'var(--primary-green-light)' : isPositive ? 'var(--accent-gold)' : 'hsl(0,75%,65%)'
                                                }}>
                                                    {isPositive ? '+' : ''}{row.netWeightDiff.toFixed(1)} kg
                                                    <span style={{ fontSize: '0.72rem', marginLeft: '4px', fontWeight: '400' }}>
                                                        ({isPositive ? '+' : ''}{row.netWeightDiffPct.toFixed(1)}%)
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                    {row.netWeightDiff > 0 ? '+' : ''}{(row.actualPerHeadTotal - row.plannedPerHeadTotal).toFixed(2)} kg/hd
                                                </div>
                                            </td>

                                            {/* Cost Columns */}
                                            {isSuperAdmin && (
                                                <td>
                                                    <div>{Math.round(row.totalPlannedCost).toLocaleString()} PKR</div>
                                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                        {Math.round(row.plannedCostPerHeadTotal)}/hd
                                                    </div>
                                                </td>
                                            )}
                                            {isSuperAdmin && (
                                                <td>
                                                    <div><strong>{Math.round(row.totalActualCost).toLocaleString()} PKR</strong></div>
                                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                        {Math.round(row.actualCostPerHeadTotal)}/hd
                                                    </div>
                                                </td>
                                            )}
                                            {isSuperAdmin && (
                                                <td>
                                                    <span style={{
                                                        fontWeight: '600',
                                                        color: row.netCostDiff > 50 ? 'hsl(43,90%,53%)' : row.netCostDiff < -50 ? 'hsl(0,75%,65%)' : 'var(--primary-green-light)'
                                                    }}>
                                                        {row.netCostDiff > 0 ? '+' : ''}{Math.round(row.netCostDiff).toLocaleString()} PKR
                                                    </span>
                                                </td>
                                            )}

                                            {/* Compliance Badge */}
                                            <td style={{ textAlign: 'center' }}>
                                                {row.status === 'exact' ? (
                                                    <span style={{
                                                        fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px',
                                                        background: 'rgba(25,135,84,0.12)', color: 'var(--primary-green-light)',
                                                        border: '1px solid rgba(25,135,84,0.25)', fontWeight: '600', display: 'inline-block'
                                                    }}>
                                                        <i className="fa-solid fa-check" style={{ marginRight: '3px' }}></i> Exact
                                                    </span>
                                                ) : row.status === 'omission' ? (
                                                    <span style={{
                                                        fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px',
                                                        background: 'rgba(220,53,69,0.12)', color: 'hsl(0,75%,65%)',
                                                        border: '1px solid rgba(220,53,69,0.25)', fontWeight: '600', display: 'inline-block'
                                                    }} title={`${row.omissionsCount} ingredients omitted`}>
                                                        <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: '3px' }}></i> {row.omissionsCount} Omitted
                                                    </span>
                                                ) : row.status === 'major' ? (
                                                    <span style={{
                                                        fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px',
                                                        background: 'rgba(255,193,7,0.12)', color: 'hsl(43,90%,53%)',
                                                        border: '1px solid rgba(255,193,7,0.25)', fontWeight: '600', display: 'inline-block'
                                                    }}>
                                                        <i className="fa-solid fa-arrows-split-up-and-left" style={{ marginRight: '3px' }}></i> Deviated
                                                    </span>
                                                ) : (
                                                    <span style={{
                                                        fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px',
                                                        background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)',
                                                        border: '1px solid rgba(255,255,255,0.1)', display: 'inline-block'
                                                    }}>
                                                        Minor ±1%
                                                    </span>
                                                )}
                                            </td>

                                            <td style={{ textAlign: 'center' }}>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ padding: '0.15rem 0.5rem', minHeight: '26px', fontSize: '0.75rem' }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleRow(row.key);
                                                    }}
                                                >
                                                    <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                                                </button>
                                            </td>
                                        </tr>

                                        {/* Expandable Surgical Ingredient Breakdown */}
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan={isSuperAdmin ? (viewMode === 'session' ? 13 : 12) : (viewMode === 'session' ? 10 : 9)} style={{ background: 'rgba(0,0,0,0.25)', padding: '0.8rem 1.2rem' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                        
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                            <div style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-pure)' }}>
                                                                <i className="fa-solid fa-layer-group" style={{ marginRight: '6px', color: 'var(--primary-green-light)' }}></i>
                                                                Ingredient Delta Breakdown for {formatDate(row.date)} · {row.penTitle} ({row.maxAnimalCount} Cattle)
                                                            </div>
                                                            {row.notesList.length > 0 && (
                                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', maxWidth: '600px' }}>
                                                                    <strong>Log Note:</strong> {row.notesList[0]}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Sub-table */}
                                                        <div className="table-wrapper" style={{ margin: '0.3rem 0' }}>
                                                            <table className="data-table" style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.02)' }}>
                                                                <thead>
                                                                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                                                                        <th>INGREDIENT</th>
                                                                        <th>PLANNED / HEAD</th>
                                                                        <th>ACTUAL FED / HEAD</th>
                                                                        <th>TOTAL PLANNED (KG)</th>
                                                                        <th>TOTAL FED (KG)</th>
                                                                        <th>DELTA (KG)</th>
                                                                        <th>DELTA (%)</th>
                                                                        {isSuperAdmin && <th>RATE (PKR/KG)</th>}
                                                                        {isSuperAdmin && <th>COST VARIANCE</th>}
                                                                        <th style={{ textAlign: 'center' }}>STATUS</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {row.ingredientRows.map((ing, iIdx) => {
                                                                        return (
                                                                            <tr key={iIdx} style={{ background: ing.isOmitted ? 'rgba(220,53,69,0.04)' : 'transparent' }}>
                                                                                <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>
                                                                                    {ing.name}
                                                                                </td>
                                                                                <td>{ing.plannedPerHead.toFixed(3)} kg</td>
                                                                                <td>
                                                                                    <strong style={{ color: ing.actualPerHead === 0 ? 'hsl(0,75%,65%)' : 'var(--text-pure)' }}>
                                                                                        {ing.actualPerHead.toFixed(3)} kg
                                                                                    </strong>
                                                                                </td>
                                                                                <td>{ing.plannedTotalKg.toFixed(2)} kg</td>
                                                                                <td><strong>{ing.actualTotalKg.toFixed(2)} kg</strong></td>
                                                                                <td style={{
                                                                                    fontWeight: '600',
                                                                                    color: ing.diffKg > 0.01 ? 'var(--accent-gold)' : ing.diffKg < -0.01 ? 'hsl(0,75%,65%)' : 'var(--primary-green-light)'
                                                                                }}>
                                                                                    {ing.diffKg > 0 ? '+' : ''}{ing.diffKg.toFixed(2)} kg
                                                                                </td>
                                                                                <td>
                                                                                    <span style={{
                                                                                        fontWeight: '600',
                                                                                        color: ing.isOmitted ? 'hsl(0,75%,65%)' : Math.abs(ing.diffPct) > 5 ? 'hsl(43,90%,53%)' : 'var(--text-muted)'
                                                                                    }}>
                                                                                        {ing.isOmitted ? '-100%' : `${ing.diffPct > 0 ? '+' : ''}${ing.diffPct.toFixed(1)}%`}
                                                                                    </span>
                                                                                </td>
                                                                                {isSuperAdmin && (
                                                                                    <td style={{ color: 'var(--text-muted)' }}>
                                                                                        {ing.price ? `${ing.price.toFixed(2)}` : '—'}
                                                                                    </td>
                                                                                )}
                                                                                {isSuperAdmin && (
                                                                                    <td style={{
                                                                                        fontWeight: '600',
                                                                                        color: ing.diffCost > 0 ? 'hsl(43,90%,53%)' : ing.diffCost < 0 ? 'hsl(0,75%,65%)' : 'var(--text-muted)'
                                                                                    }}>
                                                                                        {ing.diffCost > 0 ? '+' : ''}{Math.round(ing.diffCost).toLocaleString()} PKR
                                                                                    </td>
                                                                                )}
                                                                                <td style={{ textAlign: 'center' }}>
                                                                                    {ing.isOmitted ? (
                                                                                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: 'rgba(220,53,69,0.15)', color: 'hsl(0,75%,65%)', fontWeight: '700' }}>
                                                                                            🔴 Omitted
                                                                                        </span>
                                                                                    ) : ing.isExtra ? (
                                                                                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: 'rgba(13,110,253,0.15)', color: '#6ea8fe', fontWeight: '700' }}>
                                                                                            🔵 Extra Added
                                                                                        </span>
                                                                                    ) : Math.abs(ing.diffPct) <= 1.0 ? (
                                                                                        <span style={{ fontSize: '0.7rem', color: 'var(--primary-green-light)' }}>
                                                                                            🟢 Exact
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span style={{ fontSize: '0.7rem', color: ing.diffKg > 0 ? 'var(--accent-gold)' : 'hsl(0,75%,65%)' }}>
                                                                                            {ing.diffKg > 0 ? '▲ Overfed' : '▼ Underfed'}
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}

                            {varianceRows.length === 0 && (
                                <tr>
                                    <td colSpan={isSuperAdmin ? 13 : 10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                        <i className="fa-solid fa-scale-balanced" style={{ fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}></i>
                                        No feed log variance records found matching your selected date and pen filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}
