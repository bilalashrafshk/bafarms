import React, { useContext, useState, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, daysBetween, parseDateOnly, todayAsDate } from '../utils/dateOnly';

// Cross-references the dated feed-log ledger (what was fed, and its cost, on a given
// day) against per-animal weight logs (ADG) to answer: for a chosen date range,
// grouped by pen or across the whole herd, what did we feed, what did it cost, and
// how much weight did the herd actually gain? Both source ledgers are append-only/dated,
// so this view is always a historical report — never affected by later recipe edits.
export default function FeedGrowthReport() {
    const {
        animals, weightLogs, feedLogs, getPenRationRow, getPenRosterAsOf, systemParams,
        feedStockIssues, feedStockItems, feedOpeningStock, feedPurchases, mineralSplitRatio,
        getFeedStockIssueCosts
    } = useContext(FarmContext);
    const adgFloor = systemParams?.adgAlertThreshold ?? 1.0;

    // Every pen that could plausibly have history to report on — not just pens with
    // animals in them right now. A pen config row can be deleted (it's just ration/cycle
    // settings) and every animal can move out, but its feed logs keep the pen id forever
    // (see logFeed/getCombinedFeedIssues in FarmContext) — so a fully turned-over or
    // decommissioned pen must stay selectable here, the same way it still shows up in
    // Feed Stock & Store Ledger's "Actual Feed Cost by Pen".
    const activePens = useMemo(() => {
        const set = new Set();
        animals.forEach(a => {
            if (a.pen && a.status !== 'Sold' && a.status !== 'Deceased') set.add(a.pen);
        });
        feedLogs.forEach(f => { if (f.pen && f.pen !== 'ALL') set.add(f.pen); });
        return Array.from(set).sort();
    }, [animals, feedLogs]);

    const todayStr = todayPKT();
    const defaultFrom = (() => {
        const d = new Date(todayStr);
        d.setUTCDate(d.getUTCDate() - 29);
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
            .sort((a, b) => daysBetween(b.date, a.date));
    }, [feedLogs, dateFrom, dateTo, penFilter]);

    // Manually-issued stock (Feed Stock & Store Ledger → Issues) never creates a feedLogs
    // row — e.g. a bag of Chokar handed out loose isn't run through the TMR calculator —
    // so without this it's invisible here even though it's real feed cost. Only
    // category==='feed' issues count (medicine/other stock is out of scope for a feed
    // report); each is priced at its actual FIFO cost (issueCosts below), since a manual
    // issue has no "reference/recipe price" the way a TMR log does.
    const manualFeedIssuesInRange = useMemo(() => {
        return feedStockIssues.filter(i => {
            if (i.pen === 'PRODUCTION') return false; // Premix manufacturing batches are converted to Wanda
            const item = feedStockItems.find(it => it.id === i.itemId);
            return item?.category === 'feed' && inRange(i.date);
        });
    }, [feedStockIssues, feedStockItems, dateFrom, dateTo]);

    const manualFeedIssues = useMemo(
        () => manualFeedIssuesInRange.filter(i => penFilter === 'ALL' ? true : i.pen === penFilter),
        [manualFeedIssuesInRange, penFilter]
    );

    const issueCosts = useMemo(() => getFeedStockIssueCosts(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [feedStockItems, feedOpeningStock, feedPurchases, feedLogs, feedStockIssues, mineralSplitRatio]);

    const costOfIssue = (iss) => issueCosts[iss.id]?.cost ?? 0;

    // Days within the selected range where a pen had animals actually on feed — per the
    // HISTORICAL roster on that exact day (getPenRosterAsOf, replaying each animal's
    // registered/pen_transfer event trail), not today's live pen membership — but no feed
    // log was recorded at all. The coverage badge below only covers partial (e.g.
    // split-feeding) gaps for days that already have at least one logged row; a fully
    // missed day would otherwise just be silently absent from the table.
    // Walking the historical roster day-by-day (instead of deriving one start date from
    // whichever animals currently sit in the pen) is what makes this correct across
    // mid-range pen shifts: a pen that was fully re-sorted into another pen part-way
    // through the range still gets its real missed days flagged for the days it actually
    // had cattle, and a pen whose config row was later deleted is still walked (via
    // activePens, which stays populated from feed-log history alone — see above).
    const missedDayRows = useMemo(() => {
        const rows = [];
        const today = todayAsDate();
        const rangeStart = parseDateOnly(dateFrom);
        const rangeEnd = parseDateOnly(dateTo);
        const lastDay = rangeEnd < today ? rangeEnd : new Date(today.getTime() - 86400000);
        const penIds = penFilter === 'ALL' ? activePens : [penFilter];
        penIds.forEach(penId => {
            for (let d = new Date(rangeStart); d <= lastDay; d.setUTCDate(d.getUTCDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const headCount = getPenRosterAsOf(penId, parseDateOnly(dateStr)).length;
                if (headCount === 0) continue;
                const logged = feedLogs.some(f => f.pen === penId && f.date === dateStr);
                if (!logged) rows.push({ date: dateStr, pen: penId, animalCount: headCount });
            }
        });
        return rows;
    }, [activePens, penFilter, feedLogs, dateFrom, dateTo, getPenRosterAsOf]);

    // A pen fed on a "split" schedule (Morning/Evening, or Morning/Afternoon/Evening) logs
    // one ba_feed_logs row per feeding — group those back up by date+pen so the Daily Feed
    // Log below can show, per day, how much of that day's feeding actually got logged
    // (100%, or e.g. 50% with the Evening feed still missing).
    const SESSION_LABELS = { 2: ['Morning', 'Evening'], 3: ['Morning', 'Afternoon', 'Evening'] };
    const dailyCoverage = useMemo(() => {
        const map = new Map();
        filteredFeedLogs.forEach(f => {
            const key = `${f.date}__${f.pen}`;
            const entry = map.get(key) || { pct: 0, numFeedings: 1, indexes: new Set() };
            entry.pct += (f.feedingPct !== undefined && f.feedingPct !== null) ? f.feedingPct : 100;
            entry.numFeedings = Math.max(entry.numFeedings, f.numFeedings || 1);
            entry.indexes.add(f.feedingIndex || 0);
            map.set(key, entry);
        });
        return map;
    }, [filteredFeedLogs]);

    const sessionLabel = (log) => {
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

    const coverageBadge = (log) => {
        const entry = dailyCoverage.get(`${log.date}__${log.pen}`);
        const pct = Math.min(100, Math.round(entry ? entry.pct : (log.feedingPct ?? 100)));
        const numFeedings = entry ? entry.numFeedings : (log.numFeedings || 1);
        if (numFeedings <= 1 || pct >= 100) {
            return <span style={{ color: 'var(--primary-green-light)', fontWeight: 600 }}>{pct}%</span>;
        }
        const labels = SESSION_LABELS[numFeedings] || [];
        const missing = [];
        for (let i = 1; i <= numFeedings; i++) {
            if (!entry.indexes.has(i)) missing.push(labels[i - 1] || `Feeding ${i}`);
        }
        const isToday = log.date === todayStr;
        return (
            <span
                style={{ color: isToday ? 'var(--accent-gold)' : 'hsl(0, 75%, 60%)', fontWeight: 600 }}
                title={missing.length ? `Missing: ${missing.join(', ')}${isToday ? ' (day still in progress)' : ''}` : ''}
            >
                {pct}%{missing.length > 0 && <i class="fa-solid fa-triangle-exclamation" style={{ marginLeft: '0.35rem' }}></i>}
            </span>
        );
    };

    const manualIssueCost = manualFeedIssues.reduce((sum, iss) => sum + costOfIssue(iss), 0);
    const totalFeedCost = filteredFeedLogs.reduce((sum, f) => sum + (f.totalCost || 0), 0) + manualIssueCost;
    const daysLogged = new Set([...filteredFeedLogs.map(f => f.date), ...manualFeedIssues.map(i => i.date)]).size;

    // Feedlot-standard "head-days": for every day cost was actually incurred (a TMR feed
    // log OR a manual stock issue), how many animals were actually on feed that day —
    // taken from animalCount captured on the feed log itself at logging time where one
    // exists (see logFeed/TMRCalculator, sourced from the historical pen roster on that
    // date); a manual issue with no matching feed log the same day+pen imputes the same
    // way, via getPenRosterAsOf (summed across all pens for a pen==='ALL' issue, exactly
    // how an 'ALL'-pen feed log's animalCount is already computed). Cost/animal/day is
    // then just total cost ÷ total head-days — one division, correct no matter how many
    // animals were later sold, moved to another pen, or had their pen's config row deleted.
    // (Collapsed to one entry per date+pen so a split-fed day's Morning/Evening rows, or a
    // feed log plus a same-day manual issue for the same pen, don't double-count headcount.)
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

    const headDaysMap = useMemo(() => buildHeadDaysMap(filteredFeedLogs), [filteredFeedLogs]);
    const headDays = sumHeadDays(headDaysMap);
    const avgHeadPerDay = daysLogged > 0 ? headDays / daysLogged : null;
    const costPerAnimalPerDay = headDays > 0 ? totalFeedCost / headDays : null;

    // Cache of "which animals actually stood in this pen on this date" (replays each
    // animal's registered/pen_transfer event trail — see getPenRosterAsOf in FarmContext),
    // so a weigh-in is attributed to whichever pen the animal was actually in that day, not
    // wherever it lives now. Without this, moving an animal to another pen — or fully
    // vacating and deleting a pen — would retroactively rewrite that pen's already-recorded
    // ADG history.
    const rosterCache = new Map();
    const rosterIdsOnDate = (penId, dateStr) => {
        const key = `${penId}__${dateStr}`;
        if (!rosterCache.has(key)) {
            rosterCache.set(key, new Set(getPenRosterAsOf(penId, parseDateOnly(dateStr)).map(a => a.id)));
        }
        return rosterCache.get(key);
    };

    // adg !== 0, not > 0 — a weight-loss weigh-in has a real negative ADG and must
    // drag the average down, not be silently excluded (adg is exactly 0 only as a
    // sentinel for "no prior weigh-in to compare against", see logWeight in
    // FarmContext).
    const relevantWeightLogs = useMemo(
        () => weightLogs.filter(w => {
            if (w.adg === 0 || !inRange(w.date)) return false;
            if (penFilter === 'ALL') return true;
            return rosterIdsOnDate(penFilter, w.date).has(w.animalId);
        }),
        [weightLogs, penFilter, dateFrom, dateTo, rosterCache]
    );

    const avgAdg = relevantWeightLogs.length > 0
        ? relevantWeightLogs.reduce((sum, w) => sum + w.adg, 0) / relevantWeightLogs.length
        : null;

    // When a single pen is selected, resolve its assigned Ration Plan's target ADG for
    // the current week so actual-vs-plan can be compared directly, not just against the
    // generic system-wide floor.
    const selectedPenPlanRow = penFilter !== 'ALL' ? getPenRationRow(penFilter) : null;
    const isBelowFloor = avgAdg !== null && avgAdg < adgFloor;

    const feedCostPerKgGain = avgAdg && avgAdg > 0 && costPerAnimalPerDay ? costPerAnimalPerDay / avgAdg : null;

    // Per-pen breakdown — only meaningful when viewing the whole herd
    const perPenBreakdown = useMemo(() => {
        if (penFilter !== 'ALL') return [];
        return activePens.map(pen => {
            const penLogs = feedLogs.filter(f => inRange(f.date) && f.pen === pen);
            // Manual issues booked to a specific pen only — same treatment as an
            // 'ALL'-pen feed log, which is likewise excluded from every named pen's row
            // and only counted in the whole-herd totals above.
            const penIssues = manualFeedIssuesInRange.filter(i => i.pen === pen);
            const penCost = penLogs.reduce((sum, f) => sum + (f.totalCost || 0), 0)
                + penIssues.reduce((sum, iss) => sum + costOfIssue(iss), 0);
            const penDays = new Set([...penLogs.map(f => f.date), ...penIssues.map(i => i.date)]).size;
            const penHeadDays = sumHeadDays(buildHeadDaysMap(penLogs, penIssues));
            const penCostPerAnimalPerDay = penHeadDays > 0 ? penCost / penHeadDays : null;
            const penWeightLogs = weightLogs.filter(w => w.adg !== 0 && inRange(w.date) && rosterIdsOnDate(pen, w.date).has(w.animalId));
            const penAdg = penWeightLogs.length > 0
                ? penWeightLogs.reduce((sum, w) => sum + w.adg, 0) / penWeightLogs.length
                : null;
            const planRow = getPenRationRow(pen);
            return {
                pen,
                avgHeadPerDay: penDays > 0 ? penHeadDays / penDays : 0,
                totalCost: penCost,
                daysLogged: penDays,
                costPerAnimalPerDay: penCostPerAnimalPerDay,
                avgAdg: penAdg,
                planName: planRow?.plan?.name ?? null,
                targetAdg: planRow?.week?.targetAdg ?? null,
                isBelowFloor: penAdg !== null && penAdg < adgFloor
            };
        // Rank by weight-gain performance (highest ADG first) rather than pen name, so
        // the best/worst performing pens surface immediately — same convention as the
        // Weight Tracker performance report. Pens with no weight data yet sink to the
        // bottom rather than breaking up the ranked pens.
        }).sort((a, b) => {
            if (a.avgAdg === null && b.avgAdg === null) return 0;
            if (a.avgAdg === null) return 1;
            if (b.avgAdg === null) return -1;
            return b.avgAdg - a.avgAdg;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePens, feedLogs, weightLogs, dateFrom, dateTo, penFilter, getPenRationRow, adgFloor, rosterCache, manualFeedIssuesInRange, issueCosts]);

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
                    <span class="stat-lbl" style={{ display: 'block', marginTop: '0.2rem' }} title="TMR feed logs are priced at each ingredient's ration/stock-average rate on the day they were logged. Manual stock issues (loose feed handed out outside the TMR calculator, e.g. a bag of Chokar) are priced at their actual FIFO cost, since they have no recipe reference price. For the real cost of every specific lot a pen's feed was physically drawn from, see Feed Stock & Store Ledger → Actual Feed Cost by Pen.">
                        Feed logs at reference rate + manual issues at FIFO actual{manualIssueCost > 0 ? ` (incl. ${Math.round(manualIssueCost).toLocaleString()} PKR manual)` : ''}
                    </span>
                </div>

                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Avg Weight Gain</h3>
                        <div class="stat-icon"><i class="fa-solid fa-weight-scale"></i></div>
                    </div>
                    <div class="stat-val" style={{ color: avgAdg === null ? 'var(--text-muted)' : (isBelowFloor ? 'hsl(0, 75%, 55%)' : (avgAdg >= 1.2 ? 'var(--primary-green-light)' : 'var(--accent-gold)')) }}>
                        {avgAdg !== null ? (Number(avgAdg) || 0).toFixed(2) : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>kg/day</small>
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
                    <span class="stat-lbl" title="Total cost ÷ head-days (animals actually on feed, summed across each logged day) — not today's live pen headcount, so this stays correct even after animals are sold, re-sorted into another pen, or a pen is closed out.">
                        {avgHeadPerDay !== null ? (Number(avgHeadPerDay) || 0).toFixed(1) : '—'} avg head/day · {headDays} head-days
                    </span>
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
                                    <th style={{ width: '40px', color: 'var(--text-muted)', textAlign: 'center' }}>#</th>
                                    <th>PEN</th>
                                    <th>PLAN</th>
                                    <th title="Avg animals actually on feed per logged day (head-days ÷ days logged) — not today's live pen headcount">AVG HEAD/DAY</th>
                                    <th>DAYS LOGGED</th>
                                    <th>TOTAL FEED COST</th>
                                    <th>COST/ANIMAL/DAY</th>
                                    <th>AVG ADG</th>
                                    <th>TARGET ADG</th>
                                </tr>
                            </thead>
                            <tbody>
                                {perPenBreakdown.map((row, idx) => (
                                    <tr key={row.pen}>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                        <td><strong>Pen {row.pen}</strong></td>
                                        <td>{row.planName ?? '—'}</td>
                                        <td>{(Number(row.avgHeadPerDay) || 0).toFixed(1)}</td>
                                        <td>{row.daysLogged}</td>
                                        <td>{Math.round(row.totalCost).toLocaleString()} PKR</td>
                                        <td>{row.costPerAnimalPerDay !== null ? `${Math.round(row.costPerAnimalPerDay)} PKR` : '—'}</td>
                                        <td style={{ color: row.avgAdg === null ? 'var(--text-muted)' : (row.isBelowFloor ? 'hsl(0, 75%, 55%)' : (row.avgAdg >= 1.2 ? 'var(--primary-green-light)' : 'var(--accent-gold)')) }}>
                                            {row.avgAdg !== null ? `${(Number(row.avgAdg) || 0).toFixed(2)} kg/day` : '—'}
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
                {filteredFeedLogs.length === 0 && missedDayRows.length === 0 && manualFeedIssues.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No feed has been logged in this date range yet. Use "Log This Feeding" on the TMR Calculator to start building history.</p>
                ) : (
                    <div class="table-wrapper">
                        <table class="data-table" style={{ fontSize: '0.85rem' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', color: 'var(--text-muted)', textAlign: 'center' }}>#</th>
                                    <th>DATE</th>
                                    <th>PEN</th>
                                    <th>SESSION</th>
                                    <th>ANIMALS</th>
                                    <th>TOTAL COST</th>
                                    <th>COST / ANIMAL</th>
                                    <th>DAY COVERAGE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    ...filteredFeedLogs.map(log => ({ type: 'logged', date: log.date, pen: log.pen, log })),
                                    ...manualFeedIssues.map(iss => ({ type: 'issue', date: iss.date, pen: iss.pen, issue: iss })),
                                    ...missedDayRows.map(m => ({ type: 'missed', date: m.date, pen: m.pen, missed: m }))
                                ]
                                    .sort((a, b) => daysBetween(b.date, a.date))
                                    .map((row, idx) => row.type === 'logged' ? (
                                        <tr key={`${row.log.date}__${row.log.pen}__${row.log.feedingIndex || 0}`}>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                            <td>{formatDate(row.log.date)}</td>
                                            <td>{row.log.pen === 'ALL' ? 'All Pens' : `Pen ${row.log.pen}`}</td>
                                            <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{sessionLabel(row.log)}</td>
                                            <td>{row.log.animalCount}</td>
                                            <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(row.log.totalCost).toLocaleString()} PKR</strong></td>
                                            <td>{Math.round(row.log.costPerAnimal)} PKR</td>
                                            <td>{coverageBadge(row.log)}</td>
                                        </tr>
                                    ) : row.type === 'issue' ? (() => {
                                        const iss = row.issue;
                                        const item = feedStockItems.find(it => it.id === iss.itemId);
                                        const cost = costOfIssue(iss);
                                        const headCount = headDaysMap.get(`${iss.date}__${iss.pen}`) || 0;
                                        return (
                                            <tr key={`issue__${iss.id}`}>
                                                <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                                <td>{formatDate(iss.date)}</td>
                                                <td>{iss.pen === 'ALL' ? 'All Pens' : `Pen ${iss.pen}`}</td>
                                                <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }} title="Manually issued from Feed Stock & Store Ledger — priced at FIFO actual cost, not a TMR log">
                                                    {item?.name || iss.itemId} · {(Number(iss.quantity) || 0).toFixed(2)} kg (stock issue)
                                                </td>
                                                <td>{headCount}</td>
                                                <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(cost).toLocaleString()} PKR</strong></td>
                                                <td>{headCount > 0 ? Math.round(cost / headCount) : '—'} PKR</td>
                                                <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Stock issue</td>
                                            </tr>
                                        );
                                    })() : (
                                        <tr key={`missed__${row.missed.date}__${row.missed.pen}`}>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                            <td>{formatDate(row.missed.date)}</td>
                                            <td>{`Pen ${row.missed.pen}`}</td>
                                            <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>—</td>
                                            <td>{row.missed.animalCount}</td>
                                            <td>—</td>
                                            <td>—</td>
                                            <td>
                                                <span style={{ color: 'hsl(0, 75%, 60%)', fontWeight: 600 }} title="No feed logged this day">
                                                    0%<i class="fa-solid fa-triangle-exclamation" style={{ marginLeft: '0.35rem' }}></i>
                                                </span>
                                            </td>
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
