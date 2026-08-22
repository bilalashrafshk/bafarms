import React, { useContext, useState, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { todayPKT, daysBetween, parseDateOnly } from '../utils/dateOnly';

// Unifies every cost stream the app already tracks separately — feed (FeedGrowthReport's
// head-days allocation), medicine/treatments (ba_treatments.stock_issue_id → FIFO stock
// cost), and operating overhead (OverheadExpenses, spread per head-day the same way) —
// into one per-animal all-in cost of gain for a chosen date range. Nothing here re-derives
// truth; it re-applies the same head-days allocation principle already established in
// FeedGrowthReport to attribute shared costs to individual animals via how many days each
// one actually spent in-range (and in which pen), reconstructed from the same
// registered/pen_transfer event trail getPenRosterAsOf already replays.
export default function CostOfGainReport() {
    const {
        animals, events, weightLogs, treatments, feedLogs, feedStockIssues, feedStockItems,
        feedOpeningStock, feedPurchases, mineralSplitRatio, getFeedStockIssueCosts,
        overheadExpenses
    } = useContext(FarmContext);

    const todayStr = todayPKT();
    const defaultFrom = (() => {
        const d = new Date(todayStr);
        d.setUTCDate(d.getUTCDate() - 29);
        return d.toISOString().split('T')[0];
    })();
    const [dateFrom, setDateFrom] = useState(defaultFrom);
    const [dateTo, setDateTo] = useState(todayStr);
    const [penFilter, setPenFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'all'

    const normalizeDateStr = (val) => {
        if (!val) return '';
        if (typeof val === 'string') {
            const mIso = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
            const mDmy = val.match(/^(\d{2})-(\d{2})-(\d{4})/);
            if (mDmy) return `${mDmy[3]}-${mDmy[2]}-${mDmy[1]}`;
        }
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
            return d.toISOString().split('T')[0];
        }
        return '';
    };

    const inRange = (d) => {
        const nd = normalizeDateStr(d);
        return nd >= dateFrom && nd <= dateTo;
    };

    const activePens = useMemo(() => {
        const set = new Set();
        animals.forEach(a => { if (a.pen && a.status !== 'Sold' && a.status !== 'Deceased') set.add(a.pen); });
        feedLogs.forEach(f => { if (f.pen && f.pen !== 'ALL') set.add(f.pen); });
        return Array.from(set).sort();
    }, [animals, feedLogs]);

    const issueCosts = useMemo(() => getFeedStockIssueCosts(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [feedStockItems, feedOpeningStock, feedPurchases, feedLogs, feedStockIssues, mineralSplitRatio]);
    const costOfIssue = (iss) => issueCosts[iss.id]?.cost ?? 0;

    // --- Per-animal day accounting (built first — the head-days machinery below needs
    // it via animalsPresentOn) ---
    // Reconstructs pen-membership segments from the same registered/pen_transfer event
    // trail getPenRosterAsOf replays, clipped to the report's date range, so an animal
    // that changed pens mid-range gets its feed cost split correctly across each pen.
    const animalDays = useMemo(() => {
        const map = new Map();
        animals.forEach(animal => {
            const penEvents = events
                .filter(e => e.animalId === animal.id && (e.eventType === 'registered' || e.eventType === 'pen_transfer') && e.toPen)
                .sort((a, b) => daysBetween(parseDateOnly(a.date), parseDateOnly(b.date)) || (a.id - b.id));
            const exitEvent = events.find(e => e.animalId === animal.id && (e.eventType === 'sold' || e.eventType === 'deceased'));
            const exitDate = exitEvent ? exitEvent.date : todayStr;

            const segments = penEvents.length > 0
                ? penEvents.map((ev, i) => ({
                    pen: ev.toPen,
                    start: ev.date,
                    end: i + 1 < penEvents.length ? penEvents[i + 1].date : exitDate
                }))
                : [{ pen: animal.pen, start: animal.entryDate || dateFrom, end: exitDate }];

            const perPen = {};
            let totalDays = 0;
            segments.forEach(seg => {
                const start = seg.start > dateFrom ? seg.start : dateFrom;
                const end = seg.end < dateTo ? seg.end : dateTo;
                if (start > end) return;
                const days = daysBetween(parseDateOnly(end), parseDateOnly(start)) + 1;
                if (days <= 0) return;
                perPen[seg.pen] = (perPen[seg.pen] || 0) + days;
                totalDays += days;
            });
            map.set(animal.id, { perPen, totalDays });
        });
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animals, events, dateFrom, dateTo]);

    function animalsPresentOn(dateStr, penId) {
        let count = 0;
        animalDays.forEach((info) => {
            if (dateStr < dateFrom || dateStr > dateTo) return;
            if (penId) { if ((info.perPen[penId] || 0) > 0) count++; }
            else if (info.totalDays > 0) count++;
        });
        return count;
    }

    const herdHeadDays = useMemo(() =>
        Array.from(animalDays.values()).reduce((sum, info) => sum + info.totalDays, 0),
        [animalDays]);

    // --- Head-days machinery, same shape as FeedGrowthReport ---
    const filteredFeedLogs = useMemo(() =>
        feedLogs.filter(f => inRange(f.date)),
        [feedLogs, dateFrom, dateTo]);

    const feedIssuesInRange = useMemo(() =>
        feedStockIssues.filter(i => {
            if (i.pen === 'PRODUCTION') return false; // Premix manufacturing batches are converted to Wanda
            const item = feedStockItems.find(it => it.id === i.itemId);
            return (item?.category || 'feed') === 'feed' && inRange(i.date);
        }),
        [feedStockIssues, feedStockItems, dateFrom, dateTo]);

    const buildHeadDaysMap = (logs) => {
        const map = new Map();
        logs.forEach(f => {
            const key = `${f.date}__${f.pen}`;
            const scale = (f.feedingPct ?? 100) / 100;
            const animalDays = (f.animalCount || 0) * scale;
            map.set(key, (map.get(key) || 0) + animalDays);
        });
        return map;
    };
    const sumHeadDays = (map) => Array.from(map.values()).reduce((sum, c) => sum + c, 0);

    // Per-pen feed cost/animal/day, restricted to that exact pen (mirrors
    // FeedGrowthReport's perPenBreakdown) — used to price the days an animal actually
    // spent in a specific pen.
    const feedRatePerPen = useMemo(() => {
        const rates = {};
        activePens.forEach(pen => {
            const logs = filteredFeedLogs.filter(f => f.pen === pen);
            const issues = feedIssuesInRange.filter(i => i.pen === pen);
            const cost = logs.reduce((s, f) => s + (f.totalCost || 0), 0) + issues.reduce((s, i) => s + costOfIssue(i), 0);
            const headDays = sumHeadDays(buildHeadDaysMap(logs));
            rates[pen] = headDays > 0 ? cost / headDays : 0;
        });
        return rates;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePens, filteredFeedLogs, feedIssuesInRange, issueCosts]);

    // Whole-herd ("ALL"-pen) feed logs/issues aren't attributable to one pen — priced
    // against total herd head-days in range instead (every animal alive that day
    // benefits, not just one pen's roster), same additive logic FeedGrowthReport already
    // uses for its whole-herd totals.
    const allPoolCost = useMemo(() => {
        const logs = filteredFeedLogs.filter(f => f.pen === 'ALL');
        const issues = feedIssuesInRange.filter(i => i.pen === 'ALL');
        return logs.reduce((s, f) => s + (f.totalCost || 0), 0) + issues.reduce((s, i) => s + costOfIssue(i), 0);
    }, [filteredFeedLogs, feedIssuesInRange]);

    const allPoolRate = herdHeadDays > 0 ? allPoolCost / herdHeadDays : 0;

    const totalOverheadInRange = useMemo(() =>
        overheadExpenses.filter(e => inRange(e.date)).reduce((sum, e) => sum + (e.amount || 0), 0),
        [overheadExpenses, dateFrom, dateTo]);
    const overheadPerHeadDay = herdHeadDays > 0 ? totalOverheadInRange / herdHeadDays : 0;

    // --- Per-animal rollup ---
    const rows = useMemo(() => {
        return animals
            .filter(a => statusFilter === 'all' ? true : (a.status !== 'Sold' && a.status !== 'Deceased'))
            .map(animal => {
                const days = animalDays.get(animal.id) || { perPen: {}, totalDays: 0 };
                if (days.totalDays <= 0) return null;
                if (penFilter !== 'ALL' && !(days.perPen[penFilter] > 0)) return null;

                const feedCost = Object.entries(days.perPen).reduce((sum, [pen, d]) => sum + d * (feedRatePerPen[pen] || 0), 0)
                    + days.totalDays * allPoolRate;

                const treatCost = treatments
                    .filter(t => String(t.animalId) === String(animal.id) && inRange(t.date))
                    .reduce((sum, t) => {
                        if (t.stockIssueId && issueCosts[t.stockIssueId]?.cost) {
                            return sum + issueCosts[t.stockIssueId].cost;
                        }
                        const rawMed = (t.medicine || '').toLowerCase();
                        const matched = feedStockItems.find(i => {
                            const iname = (i.name || '').toLowerCase();
                            return iname && (rawMed.includes(iname) || iname.includes(rawMed.replace('inj.', '').trim()));
                        });
                        if (matched) {
                            const purchases = feedPurchases.filter(p => p.itemId === matched.id);
                            const rate = purchases[0]?.rate || 0;
                            if (rate > 0) {
                                const match = (t.dosage || t.medicine || '').match(/([\d.]+)\s*(ml|unit|dose|pc|kg)?/i);
                                const doseVal = match ? parseFloat(match[1]) : 1;
                                const bottleMatch = matched.name.match(/(\d+)\s*ml/i);
                                let multiplier = doseVal;
                                if (matched.unit === 'pc' && match && match[2]?.toLowerCase() === 'ml' && bottleMatch) {
                                    multiplier = doseVal / parseFloat(bottleMatch[1]);
                                }
                                return sum + (multiplier * rate);
                            }
                        }
                        return sum;
                    }, 0);

                const overheadShare = days.totalDays * overheadPerHeadDay;

                const costOfGain = feedCost + treatCost + overheadShare;

                const relevantWeightLogs = weightLogs.filter(w => w.animalId === animal.id && w.adg !== 0 && inRange(w.date));
                const avgAdg = relevantWeightLogs.length > 0
                    ? relevantWeightLogs.reduce((s, w) => s + w.adg, 0) / relevantWeightLogs.length
                    : null;
                const gainKg = avgAdg !== null ? avgAdg * days.totalDays : null;
                const costPerKgGain = gainKg && gainKg > 0 ? costOfGain / gainKg : null;

                const allInCost = (animal.purchasePrice || 0) + costOfGain;
                const isSold = animal.status === 'Sold';
                const pnl = isSold ? (animal.salePrice || 0) - allInCost : null;

                return {
                    animal, daysInRange: days.totalDays, pensResided: Object.keys(days.perPen),
                    feedCost, treatCost, overheadShare, costOfGain, avgAdg, gainKg, costPerKgGain,
                    allInCost, isSold, pnl
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.costOfGain - a.costOfGain);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animals, animalDays, feedRatePerPen, allPoolRate, treatments, issueCosts, overheadPerHeadDay, weightLogs, penFilter, statusFilter, dateFrom, dateTo]);

    const herdTotals = rows.reduce((acc, r) => ({
        feedCost: acc.feedCost + r.feedCost,
        treatCost: acc.treatCost + r.treatCost,
        overheadShare: acc.overheadShare + r.overheadShare,
        costOfGain: acc.costOfGain + r.costOfGain
    }), { feedCost: 0, treatCost: 0, overheadShare: 0, costOfGain: 0 });

    const weightedRows = rows.filter(r => r.gainKg && r.gainKg > 0);
    const herdCostPerKgGain = weightedRows.length > 0
        ? weightedRows.reduce((s, r) => s + r.costOfGain, 0) / weightedRows.reduce((s, r) => s + r.gainKg, 0)
        : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            <div style={{ background: 'rgba(74, 144, 217, 0.06)', border: '1px solid rgba(74, 144, 217, 0.18)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                <i class="fa-solid fa-circle-info" style={{ color: '#4a90d9', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                    <strong style={{ color: 'var(--text-pure)' }}>What this is:</strong> feed cost (head-days, same as the Feed &amp; Growth Report), costed medicine draws, and a per-head-day share of operating overhead — combined per animal for the selected range. Gain is estimated from each animal's average logged ADG in-range × days in-range, not a re-weigh at the range boundary, so treat Cost/kg Gain as directional, not exact to the gram.
                </span>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div class="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.75rem' }}>From</label>
                    <input type="date" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)} />
                </div>
                <div class="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.75rem' }}>To</label>
                    <input type="date" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={dateTo} min={dateFrom} max={todayStr} onChange={e => setDateTo(e.target.value)} />
                </div>
                <div class="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.75rem' }}>Pen</label>
                    <select class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={penFilter} onChange={e => setPenFilter(e.target.value)}>
                        <option value="ALL">All Pens</option>
                        {activePens.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>
                <div class="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.75rem' }}>Animals</label>
                    <select class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                        <option value="active">Active only</option>
                        <option value="all">Include sold/deceased</option>
                    </select>
                </div>
            </div>

            <div class="dashboard-grid">
                <div class="glass-panel stat-box">
                    <div class="stat-header"><h3>Herd Cost/kg Gain</h3><div class="stat-icon"><i class="fa-solid fa-scale-unbalanced"></i></div></div>
                    <div class="stat-val">{herdCostPerKgGain !== null ? herdCostPerKgGain.toFixed(0) : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR/kg</small></div>
                    <span class="stat-lbl">Feed + medicine + overhead, weighted by est. gain</span>
                </div>
                <div class="glass-panel stat-box">
                    <div class="stat-header"><h3>Feed Cost (range)</h3><div class="stat-icon"><i class="fa-solid fa-wheat-awn"></i></div></div>
                    <div class="stat-val">{Math.round(herdTotals.feedCost).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR</small></div>
                </div>
                <div class="glass-panel stat-box">
                    <div class="stat-header"><h3>Medicine Cost (range)</h3><div class="stat-icon"><i class="fa-solid fa-syringe"></i></div></div>
                    <div class="stat-val">{Math.round(herdTotals.treatCost).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR</small></div>
                </div>
                <div class="glass-panel stat-box">
                    <div class="stat-header"><h3>Overhead Share (range)</h3><div class="stat-icon"><i class="fa-solid fa-receipt"></i></div></div>
                    <div class="stat-val">{Math.round(herdTotals.overheadShare).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR</small></div>
                    <span class="stat-lbl">of {Math.round(totalOverheadInRange).toLocaleString()} PKR total overhead logged</span>
                </div>
            </div>

            <div class="glass-panel">
                <h3 class="panel-title" style={{ marginBottom: '1rem' }}><i class="fa-solid fa-table-list"></i> Per-Animal Cost of Gain</h3>
                <div class="table-wrapper">
                    <table class="data-table" style={{ fontSize: '0.83rem' }}>
                        <thead>
                            <tr>
                                <th style={{ width: '40px', color: 'var(--text-muted)', textAlign: 'center' }}>#</th>
                                <th>RFID</th>
                                <th>PEN(S)</th>
                                <th>DAYS</th>
                                <th>ADG</th>
                                <th>EST. GAIN</th>
                                <th>FEED</th>
                                <th>MEDICINE</th>
                                <th>OVERHEAD</th>
                                <th>COST OF GAIN</th>
                                <th>PKR/KG GAIN</th>
                                <th>ALL-IN COST</th>
                                <th>P&amp;L</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, idx) => (
                                <tr key={r.animal.id}>
                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                    <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{r.animal.rfid}</td>
                                    <td>{r.pensResided.join(', ') || '—'}</td>
                                    <td>{r.daysInRange}</td>
                                    <td>{r.avgAdg !== null ? `${r.avgAdg.toFixed(2)} kg/d` : '—'}</td>
                                    <td>{r.gainKg !== null ? `${r.gainKg.toFixed(1)} kg` : '—'}</td>
                                    <td>{Math.round(r.feedCost).toLocaleString()}</td>
                                    <td>{Math.round(r.treatCost).toLocaleString()}</td>
                                    <td>{Math.round(r.overheadShare).toLocaleString()}</td>
                                    <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(r.costOfGain).toLocaleString()}</strong></td>
                                    <td>{r.costPerKgGain !== null ? Math.round(r.costPerKgGain).toLocaleString() : '—'}</td>
                                    <td>{Math.round(r.allInCost).toLocaleString()}</td>
                                    <td style={{ color: r.pnl === null ? 'var(--text-muted)' : (r.pnl >= 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,55%)') }}>
                                        {r.pnl !== null ? `${r.pnl >= 0 ? '+' : ''}${Math.round(r.pnl).toLocaleString()}` : '—'}
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr><td colSpan="13" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>No animals with recorded days in this range.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
