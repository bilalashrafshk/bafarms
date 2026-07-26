import React, { useContext, useState, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

// Cross-references the dated feed-log ledger (what was fed, and its cost, on a given
// day) against per-animal weight logs (ADG) to answer: for a chosen date range,
// grouped by pen or across the whole herd, what did we feed, what did it cost, and
// how much weight did the herd actually gain? Both source ledgers are append-only/dated,
// so this view is always a historical report — never affected by later recipe edits.
export default function FeedGrowthReport() {
    const { animals, weightLogs, feedLogs, getPenRationRow, systemParams } = useContext(FarmContext);
    const adgFloor = systemParams?.adgAlertThreshold ?? 1.0;

    const activePens = useMemo(() => {
        const pens = new Set();
        animals.forEach(a => {
            if (a.pen && a.status !== 'Sold' && a.status !== 'Deceased') pens.add(a.pen);
        });
        return Array.from(pens).sort();
    }, [animals]);

    const todayStr = new Date().toISOString().split('T')[0];
    const defaultFrom = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 29);
        return d.toISOString().split('T')[0];
    })();

    const [dateFrom, setDateFrom] = useState(defaultFrom);
    const [dateTo, setDateTo] = useState(todayStr);
    const [penFilter, setPenFilter] = useState('ALL'); // 'ALL' = whole herd, or a specific pen id

    const inRange = (d) => d >= dateFrom && d <= dateTo;

    // Feed logs matching the current filter, most recent first
    const filteredFeedLogs = useMemo(() => {
        return feedLogs
            .filter(f => inRange(f.date))
            .filter(f => penFilter === 'ALL' ? true : f.pen === penFilter)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [feedLogs, dateFrom, dateTo, penFilter]);

    const totalFeedCost = filteredFeedLogs.reduce((sum, f) => sum + (f.totalCost || 0), 0);
    const daysLogged = new Set(filteredFeedLogs.map(f => f.date)).size;
    const avgDailyCost = daysLogged > 0 ? totalFeedCost / daysLogged : 0;

    // Animals in scope for the current pen filter
    const relevantAnimalIds = useMemo(() => {
        if (penFilter === 'ALL') return new Set(animals.map(a => a.id));
        return new Set(animals.filter(a => a.pen === penFilter).map(a => a.id));
    }, [animals, penFilter]);

    const relevantWeightLogs = useMemo(
        () => weightLogs.filter(w => w.adg > 0 && inRange(w.date) && relevantAnimalIds.has(w.animalId)),
        [weightLogs, relevantAnimalIds, dateFrom, dateTo]
    );

    const avgAdg = relevantWeightLogs.length > 0
        ? relevantWeightLogs.reduce((sum, w) => sum + w.adg, 0) / relevantWeightLogs.length
        : null;

    // When a single pen is selected, resolve its assigned Ration Plan's target ADG for
    // the current week so actual-vs-plan can be compared directly, not just against the
    // generic system-wide floor.
    const selectedPenPlanRow = penFilter !== 'ALL' ? getPenRationRow(penFilter) : null;
    const isBelowFloor = avgAdg !== null && avgAdg < adgFloor;

    const animalCount = relevantAnimalIds.size;
    const costPerAnimalPerDay = animalCount > 0 && daysLogged > 0 ? totalFeedCost / daysLogged / animalCount : null;
    const feedCostPerKgGain = avgAdg && avgAdg > 0 && costPerAnimalPerDay ? costPerAnimalPerDay / avgAdg : null;

    // Per-pen breakdown — only meaningful when viewing the whole herd
    const perPenBreakdown = useMemo(() => {
        if (penFilter !== 'ALL') return [];
        return activePens.map(pen => {
            const penAnimalIds = new Set(animals.filter(a => a.pen === pen).map(a => a.id));
            const penLogs = feedLogs.filter(f => inRange(f.date) && f.pen === pen);
            const penCost = penLogs.reduce((sum, f) => sum + (f.totalCost || 0), 0);
            const penDays = new Set(penLogs.map(f => f.date)).size;
            const penWeightLogs = weightLogs.filter(w => w.adg > 0 && inRange(w.date) && penAnimalIds.has(w.animalId));
            const penAdg = penWeightLogs.length > 0
                ? penWeightLogs.reduce((sum, w) => sum + w.adg, 0) / penWeightLogs.length
                : null;
            const planRow = getPenRationRow(pen);
            return {
                pen,
                animalCount: penAnimalIds.size,
                totalCost: penCost,
                daysLogged: penDays,
                avgAdg: penAdg,
                planName: planRow?.plan?.name ?? null,
                targetAdg: planRow?.week?.targetAdg ?? null,
                isBelowFloor: penAdg !== null && penAdg < adgFloor
            };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePens, animals, feedLogs, weightLogs, dateFrom, dateTo, penFilter, getPenRationRow, adgFloor]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

            {/* Filter Bar */}
            <div class="glass-panel">
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div class="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '0.75rem' }}>From</label>
                        <input
                            type="date"
                            class="form-control"
                            style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}
                            value={dateFrom}
                            max={dateTo}
                            onChange={(e) => setDateFrom(e.target.value)}
                        />
                    </div>
                    <div class="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '0.75rem' }}>To</label>
                        <input
                            type="date"
                            class="form-control"
                            style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}
                            value={dateTo}
                            min={dateFrom}
                            max={todayStr}
                            onChange={(e) => setDateTo(e.target.value)}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Group:</span>
                        <button
                            type="button"
                            class={`filter-btn ${penFilter === 'ALL' ? 'active' : ''}`}
                            style={{ fontSize: '0.7rem', minHeight: '26px', padding: '0.15rem 0.5rem' }}
                            onClick={() => setPenFilter('ALL')}
                        >Whole Herd</button>
                        {activePens.map(p => (
                            <button
                                key={p}
                                type="button"
                                class={`filter-btn ${penFilter === p ? 'active' : ''}`}
                                style={{ fontSize: '0.7rem', minHeight: '26px', padding: '0.15rem 0.5rem' }}
                                onClick={() => setPenFilter(p)}
                            >Pen {p}</button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Summary Stat widgets */}
            <div class="dashboard-grid">
                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Total Feed Cost</h3>
                        <div class="stat-icon"><i class="fa-solid fa-coins"></i></div>
                    </div>
                    <div class="stat-val">{Math.round(totalFeedCost).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR</small></div>
                    <span class="stat-lbl"><i class="fa-solid fa-calendar-check"></i> {daysLogged} day{daysLogged === 1 ? '' : 's'} logged in range</span>
                </div>

                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Avg Weight Gain</h3>
                        <div class="stat-icon"><i class="fa-solid fa-weight-scale"></i></div>
                    </div>
                    <div class="stat-val" style={{ color: avgAdg === null ? 'var(--text-muted)' : (isBelowFloor ? 'hsl(0, 75%, 55%)' : (avgAdg >= 1.2 ? 'var(--primary-green-light)' : 'var(--accent-gold)')) }}>
                        {avgAdg !== null ? avgAdg.toFixed(2) : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>kg/day</small>
                    </div>
                    <span class="stat-lbl">From {relevantWeightLogs.length} weigh-in{relevantWeightLogs.length === 1 ? '' : 's'} in range</span>
                    {isBelowFloor && (
                        <span class="stat-lbl" style={{ color: 'hsl(0, 75%, 60%)', fontWeight: '600', display: 'block', marginTop: '0.2rem' }}>
                            <i class="fa-solid fa-triangle-exclamation"></i> Below {adgFloor} kg/day floor
                        </span>
                    )}
                    {selectedPenPlanRow && (
                        <span class="stat-lbl" style={{ display: 'block', marginTop: '0.2rem' }}>
                            Plan target ({selectedPenPlanRow.plan.name}, Week {selectedPenPlanRow.week.week}): <strong>{selectedPenPlanRow.week.targetAdg} kg/day</strong>
                        </span>
                    )}
                </div>

                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Feed Cost / Animal / Day</h3>
                        <div class="stat-icon"><i class="fa-solid fa-cow"></i></div>
                    </div>
                    <div class="stat-val">{costPerAnimalPerDay !== null ? Math.round(costPerAnimalPerDay) : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR</small></div>
                    <span class="stat-lbl">{animalCount} animal{animalCount === 1 ? '' : 's'} in scope</span>
                </div>

                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Feed Cost / kg Gained</h3>
                        <div class="stat-icon"><i class="fa-solid fa-scale-balanced"></i></div>
                    </div>
                    <div class="stat-val">{feedCostPerKgGain !== null ? Math.round(feedCostPerKgGain) : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR/kg</small></div>
                    <span class="stat-lbl">Feed efficiency proxy</span>
                </div>
            </div>

            {/* Per-Pen Breakdown (whole herd view only) */}
            {penFilter === 'ALL' && perPenBreakdown.length > 0 && (
                <div class="glass-panel">
                    <h3 class="panel-title"><i class="fa-solid fa-border-all"></i> Breakdown by Pen</h3>
                    <div class="table-wrapper">
                        <table class="data-table" style={{ fontSize: '0.85rem' }}>
                            <thead>
                                <tr>
                                    <th>PEN</th>
                                    <th>PLAN</th>
                                    <th>ANIMALS</th>
                                    <th>DAYS LOGGED</th>
                                    <th>TOTAL FEED COST</th>
                                    <th>AVG ADG</th>
                                    <th>TARGET ADG</th>
                                </tr>
                            </thead>
                            <tbody>
                                {perPenBreakdown.map(row => (
                                    <tr key={row.pen}>
                                        <td><strong>Pen {row.pen}</strong></td>
                                        <td>{row.planName ?? '—'}</td>
                                        <td>{row.animalCount}</td>
                                        <td>{row.daysLogged}</td>
                                        <td>{Math.round(row.totalCost).toLocaleString()} PKR</td>
                                        <td style={{ color: row.avgAdg === null ? 'var(--text-muted)' : (row.isBelowFloor ? 'hsl(0, 75%, 55%)' : (row.avgAdg >= 1.2 ? 'var(--primary-green-light)' : 'var(--accent-gold)')) }}>
                                            {row.avgAdg !== null ? `${row.avgAdg.toFixed(2)} kg/day` : '—'}
                                            {row.isBelowFloor && <i class="fa-solid fa-triangle-exclamation" style={{ marginLeft: '0.35rem' }} title="Below ADG floor"></i>}
                                        </td>
                                        <td>{row.targetAdg !== null && row.targetAdg !== undefined ? `${row.targetAdg} kg/day` : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Day-by-day feed log within range */}
            <div class="glass-panel">
                <h3 class="panel-title"><i class="fa-solid fa-calendar-days"></i> Daily Feed Log</h3>
                {filteredFeedLogs.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No feed has been logged in this date range yet. Use "Log This Feeding" on the TMR Calculator to start building history.</p>
                ) : (
                    <div class="table-wrapper">
                        <table class="data-table" style={{ fontSize: '0.85rem' }}>
                            <thead>
                                <tr>
                                    <th>DATE</th>
                                    <th>PEN</th>
                                    <th>ANIMALS</th>
                                    <th>TOTAL COST</th>
                                    <th>COST / ANIMAL</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredFeedLogs.map(log => (
                                    <tr key={`${log.date}__${log.pen}`}>
                                        <td>{formatDate(log.date)}</td>
                                        <td>{log.pen === 'ALL' ? 'All Pens' : `Pen ${log.pen}`}</td>
                                        <td>{log.animalCount}</td>
                                        <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(log.totalCost).toLocaleString()} PKR</strong></td>
                                        <td>{Math.round(log.costPerAnimal)} PKR</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

        </div>
    );
}
