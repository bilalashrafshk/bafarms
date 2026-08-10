import React, { useContext } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayAsDate, parseDateOnly, daysBetween } from '../utils/dateOnly';

export default function Dashboard({ onNavigate }) {
    const { animals, weightLogs, treatments, feedLogs, transitionAnimalStatus, systemParams, orders, pens, quarantineProtocols } = useContext(FarmContext);

    // 1. DYNAMIC CALCULATIONS

    // A. Actual Daily Feed Cost per Animal (PKR/Day)
    // Derived from the logged feed-log ledger (what was actually fed and its actual
    // cost each day), not the live TMR recipe — rations and ingredient prices change
    // day to day, so a recipe snapshot would be stale/misleading. Weighted by the
    // animal-count actually covered in each log entry (cost ÷ animal-days logged) —
    // NOT total cost ÷ (days × whole-herd-count), which used to silently assume every
    // pen was logged on every counted day. That made the figure swing wildly based on
    // how many pens happened to be logged: feeding just one pen spread its cost across
    // the entire herd (falsely tiny), while feeding every pen that day looked correct
    // by comparison. Null (shown as "—") until at least one feeding has been logged.
    const totalLoggedFeedCost = (feedLogs || []).reduce((sum, f) => sum + (f.totalCost || 0), 0);
    const totalLoggedAnimalDays = (feedLogs || []).reduce((sum, f) => sum + (f.animalCount || 0), 0);
    const dailyCostPerAnimal = totalLoggedAnimalDays > 0
        ? totalLoggedFeedCost / totalLoggedAnimalDays
        : null;

    // B. Herd Average ADG — from actual weight logs only. Null (shown as "—") until
    // weight has actually been logged; no fallback/target default.
    // `adg !== 0` (not `> 0`) — a weighed-in animal that's LOSING weight has a real
    // negative ADG and must drag the average down, not get silently excluded (which
    // was inflating the reported average by only counting gains). adg is exactly 0
    // as a sentinel for "no prior weigh-in to compare against" (see logWeight in
    // FarmContext), so that case is still correctly excluded.
    const logsWithAdg = weightLogs.filter(w => w.adg !== 0);
    const avgHerdAdg = logsWithAdg.length > 0
        ? parseFloat((logsWithAdg.reduce((sum, log) => sum + log.adg, 0) / logsWithAdg.length).toFixed(2))
        : null;

    // A2. Actual Cost per kg Gained = actual logged feed cost/day ÷ actual herd ADG.
    // Requires both real feeding logs and real weight logs; null otherwise.
    const costPerKgGain = (dailyCostPerAnimal !== null && avgHerdAdg) ? dailyCostPerAnimal / avgHerdAdg : null;

    // C. Trigger Alerts for Underperforming Calves (ADG < 1.0 kg/day)
    const alertCalves = [];
    animals.forEach(animal => {
        const animalLogs = weightLogs.filter(w => w.animalId === animal.id)
                                     .sort((a, b) => daysBetween(b.date, a.date));
        // adg !== 0 (see note above) — a calf actively losing weight (negative ADG)
        // is the clearest case of underperforming and must still trigger this alert,
        // not be skipped for having "too positive" a check.
        if (animalLogs.length > 0 && animalLogs[0].adg !== 0 && animalLogs[0].adg < (systemParams.adgAlertThreshold ?? 1.0)) {
            alertCalves.push({
                rfid: animal.rfid,
                adg: animalLogs[0].adg,
                breed: animal.breed
            });
        }
    });

    // All "today"/day-count math is anchored to PKT (see utils/dateOnly.js) — the
    // farm operates in Pakistan regardless of what timezone the browser or API
    // server happens to be running in, and date-only strings (entryDate, treatment
    // date, etc.) are parsed as plain calendar days rather than UTC-midnight
    // timestamps, so none of this drifts by a day depending on where the code runs.
    const today = todayAsDate();



    // E. ACTION REQUIRED COMPUTATIONS
    const WEIGH_INTERVAL_DAYS = systemParams.weighIntervalDays ?? 14;

    const overdueWeighing = animals.filter(a => {
        if (a.status === 'Sold' || a.status === 'Deceased') return false;
        const animalLogs = weightLogs.filter(w => w.animalId === a.id).sort((x, y) => daysBetween(y.date, x.date));
        const lastDate = animalLogs.length > 0 ? animalLogs[0].date : a.entryDate;
        const daysSince = daysBetween(today, lastDate);
        return daysSince > WEIGH_INTERVAL_DAYS;
    });

    const quarantineReady = animals.filter(a => {
        if (a.status !== 'Quarantined') return false;
        const dof = daysBetween(today, a.entryDate);
        return dof >= (systemParams.quarantineDays ?? 14);
    });

    const marketReady = animals.filter(a => {
        if (a.status === 'Sold' || a.status === 'Deceased') return false;
        if (a.currentWeight < a.targetWeight) return false;
        const activeWH = treatments.filter(t => {
            if (t.animalId !== a.id) return false;
            const days = daysBetween(today, t.date);
            return days < t.withholding;
        });
        return activeWH.length === 0;
    });

    // Sick animals with no treatment logged in last 7 days — need vet attention
    const sickUntreated = animals.filter(a => {
        if (a.status !== 'Sick') return false;
        const recent = treatments.filter(t => {
            if (t.animalId !== a.id) return false;
            const days = daysBetween(today, t.date);
            return days <= 7;
        });
        return recent.length === 0;
    });

    // F. Pending Vaccines/Protocol Tasks — quarantine checklist steps (Vaccination,
    // Deworming, etc.) whose due day has passed for an animal but haven't been logged
    // yet. Same matching logic as RotationPlanner's quarantine checklist (isTaskDone):
    // prefer an exact protocolTaskId link, fall back to a type+medicine+date-window
    // heuristic for treatments logged before that field existed.
    const isProtocolTaskDone = (animal, task) =>
        treatments.some(t => t.animalId === animal.id && t.protocolTaskId === task.id) ||
        treatments.some(t =>
            t.animalId === animal.id &&
            !t.protocolTaskId &&
            t.type === task.type &&
            (t.medicine || '').toLowerCase().includes((task.medicine || '').split(' ')[0].toLowerCase()) &&
            (() => { const d = daysBetween(t.date, animal.entryDate); return d >= (task.dueDay - 2) && d <= (task.dueDay + 3); })()
        );

    const pendingVaccines = [];
    animals.filter(a => a.status === 'Quarantined').forEach(a => {
        const daysOnFeed = Math.max(1, daysBetween(today, a.entryDate));
        (quarantineProtocols || []).forEach(task => {
            if (daysOnFeed >= task.dueDay && !isProtocolTaskDone(a, task)) {
                pendingVaccines.push({ animal: a, task, overdueDays: daysOnFeed - task.dueDay });
            }
        });
    });

    // G. Missed Feeding Days — for each active pen, walk every day from the later of
    // its cycle start date and the earliest entry date among its currently-active
    // animals (never before an animal actually existed in the pen — a stale/pre-set
    // cycleStartDate predating every animal's entryDate must not flag days when there
    // was nothing to feed) through yesterday, flagging any day with no feed log for
    // that pen. Today isn't flagged — there's still time left in the day to log it.
    // Includes the registration/cycle-start day itself in the walk.
    const missedFeedings = [];
    (pens || []).forEach(pen => {
        const penAnimals = animals.filter(a => a.pen === pen.id && a.status !== 'Sold' && a.status !== 'Deceased');
        if (penAnimals.length === 0) return;
        const earliestEntry = penAnimals.reduce((earliest, a) =>
            (!earliest || parseDateOnly(a.entryDate) < parseDateOnly(earliest)) ? a.entryDate : earliest, null);
        let startDateStr = pen.cycleStartDate;
        if (!startDateStr || (earliestEntry && parseDateOnly(earliestEntry) > parseDateOnly(startDateStr))) {
            startDateStr = earliestEntry;
        }
        if (!startDateStr) return;
        const start = parseDateOnly(startDateStr);
        for (let d = new Date(start); d < today; d.setUTCDate(d.getUTCDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const logged = feedLogs.some(f => f.pen === pen.id && f.date === dateStr);
            if (!logged) missedFeedings.push({ pen, date: dateStr });
        }
    });

    const widePenSpreads = (pens || []).map(pen => {
        const penAnimals = animals.filter(a => a.pen === pen.id && a.status !== 'Sold' && a.status !== 'Deceased');
        if (penAnimals.length < 2) return null;
        const weights = penAnimals.map(a => parseFloat(a.currentWeight) || 0).filter(w => w > 0);
        if (weights.length < 2) return null;
        const avg = weights.reduce((s, w) => s + w, 0) / weights.length;
        if (avg <= 0) return null;
        const spreadPct = ((Math.max(...weights) - Math.min(...weights)) / avg) * 100;
        return spreadPct > 20 ? { penId: pen.id, spreadPct } : null;
    }).filter(Boolean);

    const taskItems = [
        ...widePenSpreads.map(p => ({
            type: 'weight-spread',
            msg: `Pen ${p.penId} — Weight spread too wide`,
            desc: `${(Number(p.spreadPct) || 0).toFixed(0)}% spread — re-sort at intake, bracket match and batch feed sheet won't stay accurate`,
            color: 'hsl(0,75%,55%)',
            icon: 'fa-scale-unbalanced',
            action: { label: 'Re-sort Pen', tab: 'rationPlans' }
        })),
        ...missedFeedings.map(m => ({
            type: 'missed-feed',
            msg: `Pen ${m.pen.id} — Missed feeding`,
            desc: `No feed logged for ${formatDate(m.date)}`,
            color: 'hsl(0,75%,55%)',
            icon: 'fa-bowl-food',
            action: { label: 'Log Feed', tab: 'tmr' }
        })),
        ...pendingVaccines.map(v => ({
            type: 'vaccine',
            rfid: v.animal.rfid,
            msg: `${v.animal.rfid} — ${v.task.label} due`,
            desc: v.overdueDays > 0 ? `Day ${v.task.dueDay} protocol · ${v.overdueDays}d overdue` : `Day ${v.task.dueDay} protocol · due today`,
            color: 'hsl(0,75%,55%)',
            icon: 'fa-syringe',
            action: { label: 'Log Treatment', tab: 'vet' }
        })),
        ...sickUntreated.map(a => ({
            type: 'sick',
            rfid: a.rfid,
            animalId: a.id,
            msg: `${a.rfid} — Sick, no treatment logged`,
            desc: 'Needs vet attention',
            color: 'hsl(0,75%,55%)',
            icon: 'fa-stethoscope',
            action: { label: 'Log Treatment', tab: 'vet' }
        })),
        ...alertCalves.map(c => ({
            type: 'adg',
            rfid: c.rfid,
            msg: `${c.rfid} — Low gain`,
            desc: `ADG ${c.adg} kg/d — below ${(Number(systemParams.adgAlertThreshold ?? 1.0) || 0).toFixed(1)} target`,
            color: 'hsl(0,75%,55%)',
            icon: 'fa-arrow-trend-down',
            action: null
        })),

        ...overdueWeighing.map(a => ({
            type: 'weigh',
            rfid: a.rfid,
            animalId: a.id,
            msg: `${a.rfid} — Overdue weigh-in`,
            desc: 'Last weighed >14 days ago',
            color: 'var(--accent-gold)',
            icon: 'fa-weight-scale',
            action: { label: 'Log Weight', tab: 'weights' }
        })),
        ...quarantineReady.map(a => ({
            type: 'quarantine',
            rfid: a.rfid,
            animalId: a.id,
            msg: `${a.rfid} — Quarantine cleared`,
            desc: `${daysBetween(today, a.entryDate)}d in quarantine`,
            color: 'hsl(200,70%,60%)',
            icon: 'fa-shield-virus',
            action: { label: '→ Fattening', inline: true }
        })),
        ...marketReady.map(a => ({
            type: 'market',
            rfid: a.rfid,
            animalId: a.id,
            msg: `${a.rfid} — Ready for sale`,
            desc: `${a.currentWeight}kg / ${a.targetWeight}kg target — withholding clear`,
            color: 'var(--primary-green-light)',
            icon: 'fa-award',
            action: { label: 'Dispatch', tab: 'rotation' }
        })),
    ];

    const adgByDate = (() => {
        if (!weightLogs || weightLogs.length === 0) return [];
        const groups = {};
        weightLogs.filter(w => w.adg !== 0).forEach(w => {
            if (!groups[w.date]) groups[w.date] = { sum: 0, count: 0 };
            groups[w.date].sum += w.adg;
            groups[w.date].count += 1;
        });
        return Object.keys(groups)
            .map(date => ({ date, avgAdg: parseFloat((Number(groups[date].sum / groups[date].count) || 0).toFixed(2)) }))
            .sort((a, b) => parseDateOnly(a.date) - parseDateOnly(b.date));
    })();

    const hasChartData = adgByDate.length > 0;
    let chartPoints = [];
    let adgMin = 0;
    let adgMax = 2;
    let pathD = '';
    let yGridLines = [];

    if (hasChartData) {
        const vals = adgByDate.map(pt => pt.avgAdg);
        adgMin = Math.max(0, Math.min(...vals) - 0.2);
        adgMax = Math.max(...vals) + 0.2;
        if (adgMax === adgMin) { adgMin = 0; adgMax = 2; }

        const count = adgByDate.length;
        chartPoints = adgByDate.map((pt, idx) => {
            const x = count > 1 ? 60 + (idx / (count - 1)) * 390 : 250;
            const y = 170 - ((pt.avgAdg - adgMin) / (adgMax - adgMin)) * 140;
            let label = pt.date;
            try { label = parseDateOnly(pt.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch (e) {}
            return { label, val: pt.avgAdg, x, y };
        });

        pathD = chartPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

        for (let i = 0; i <= 3; i++) {
            const v = parseFloat((Number(adgMin + (i / 3) * (adgMax - adgMin)) || 0).toFixed(2));
            const y = 170 - (i / 3) * 140;
            yGridLines.push({ val: v, y });
        }
    }

    const TARGET_ADG = 1.3;
    const targetY = hasChartData ? 170 - ((TARGET_ADG - adgMin) / (adgMax - adgMin)) * 140 : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, minHeight: 0 }}>

            {/* Top Stat widgets */}
            <div class="dashboard-grid">

                {/* Herd Size */}
                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Herd Enrollment</h3>
                        <div class="stat-icon"><i class="fa-solid fa-cow"></i></div>
                    </div>
                    <div class="stat-val">{animals.length} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Calves</small></div>
                    <span class="stat-lbl"><i class="fa-solid fa-microchip"></i> {animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased').length} active</span>
                </div>

                {/* Avg ADG */}
                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Average Daily Gain</h3>
                        <div class="stat-icon"><i class="fa-solid fa-weight-scale"></i></div>
                    </div>
                    <div class="stat-val" style={avgHerdAdg !== null ? { color: avgHerdAdg >= 1.2 ? 'var(--primary-green-light)' : 'var(--accent-gold)' } : undefined}>
                        {avgHerdAdg !== null ? avgHerdAdg : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>kg/day</small>
                    </div>
                    <span class="stat-lbl">{avgHerdAdg !== null ? 'Target: 1.30 kg/day' : 'No weight logged yet'}</span>
                </div>

                {/* Feed Cost */}
                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Daily Feed Cost</h3>
                        <div class="stat-icon"><i class="fa-solid fa-scale-balanced"></i></div>
                    </div>
                    <div class="stat-val" style={dailyCostPerAnimal !== null ? { color: dailyCostPerAnimal <= 300 ? 'var(--text-pure)' : 'hsl(0, 75%, 55%)' } : undefined}>
                        {dailyCostPerAnimal !== null ? Math.round(dailyCostPerAnimal) : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR/day</small>
                    </div>

                    {/* Live Dials */}
                    {dailyCostPerAnimal !== null && (
                        <div class="budget-gauge-box">
                            <div class="gauge-track">
                                <div
                                    class={`gauge-bar ${dailyCostPerAnimal > 300 ? 'danger' : ''}`}
                                    style={{ width: `${Math.min(100, (dailyCostPerAnimal / 350) * 100)}%` }}
                                ></div>
                            </div>
                            <div class="gauge-labels">
                                <span>Target: 300 PKR</span>
                                <span>Max: 350 PKR</span>
                            </div>
                        </div>
                    )}
                    <span class="stat-lbl" style={{ color: 'var(--text-muted)' }}>{dailyCostPerAnimal !== null ? 'Avg. of logged feedings' : 'No feeding logged yet'}</span>
                </div>

                {/* Cost per kg Gained */}
                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Cost / kg Gain</h3>
                        <div class="stat-icon"><i class="fa-solid fa-money-bill-trend-up"></i></div>
                    </div>
                    <div class="stat-val">
                        {costPerKgGain !== null ? Math.round(costPerKgGain) : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR/kg</small>
                    </div>
                    <span class="stat-lbl" style={{ color: 'var(--text-muted)' }}>{costPerKgGain !== null ? 'Logged feed cost ÷ actual ADG' : 'Needs feeding + weight logs'}</span>
                </div>

            </div>

            {/* E-Commerce Sales Overview */}
            {orders && orders.length > 0 && (
                <div className="dashboard-grid" style={{ marginTop: '0.2rem' }}>
                    <div className="glass-panel stat-box" style={{ borderLeft: '3px solid var(--accent-gold)' }}>
                        <div className="stat-header">
                            <h3>E-Commerce Revenue</h3>
                            <div className="stat-icon"><i className="fa-solid fa-cart-shopping"></i></div>
                        </div>
                        <div className="stat-val">PKR {orders.reduce((sum, o) => sum + (o.netTotal || 0), 0).toLocaleString()}</div>
                        <span className="stat-lbl" style={{ color: 'var(--text-muted)' }}><i className="fa-solid fa-receipt"></i> {orders.length} orders total</span>
                    </div>
                    <div className="glass-panel stat-box" style={{ borderLeft: '3px solid var(--accent-gold)' }}>
                        <div className="stat-header">
                            <h3>Active Live Bookings</h3>
                            <div className="stat-icon"><i className="fa-solid fa-cow"></i></div>
                        </div>
                        <div className="stat-val">{orders.filter(o => o.hasLive && o.status !== 'Delivered').length} Bookings</div>
                        <span className="stat-lbl" style={{ color: 'var(--text-muted)' }}>Awaiting dispatch/slaughter</span>
                    </div>
                    <div className="glass-panel stat-box" style={{ borderLeft: '3px solid var(--accent-gold)' }}>
                        <div className="stat-header">
                            <h3>Cold-Chain Queue</h3>
                            <div className="stat-icon"><i className="fa-solid fa-truck-snowflake"></i></div>
                        </div>
                        <div className="stat-val">{orders.filter(o => !o.hasLive && o.status !== 'Delivered').length} Shipments</div>
                        <span className="stat-lbl" style={{ color: 'var(--text-muted)' }}>Chilled reefer deliveries</span>
                    </div>
                </div>
            )}

            {/* Bottom Section splits */}
            <div class="dashboard-bottom-grid">

                {/* ADG Trend Chart */}
                <div class="glass-panel">
                    <h3 class="panel-title">
                        <i class="fa-solid fa-chart-line"></i> Herd ADG Trend
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '500' }}>avg daily gain per weigh session</span>
                    </h3>

                    {!hasChartData ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '12px' }}>
                            <i class="fa-solid fa-chart-area" style={{ fontSize: '2rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}></i>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Log weights on 2+ dates to see trend.</p>
                        </div>
                    ) : (
                        <div class="chart-container">
                            <svg class="chart-svg" viewBox="0 0 500 220" preserveAspectRatio="none">
                                {yGridLines.map((line, idx) => (
                                    <line key={idx} x1="50" y1={line.y} x2="450" y2={line.y} class="chart-grid-line" />
                                ))}
                                <line x1="50" y1="20" x2="50" y2="190" class="chart-axis-line" />
                                <line x1="50" y1="190" x2="480" y2="190" class="chart-axis-line" />

                                {/* Target 1.3 kg/day line */}
                                {targetY !== null && targetY >= 20 && targetY <= 190 && (
                                    <g>
                                        <line x1="50" y1={targetY} x2="450" y2={targetY} stroke="rgba(255,193,7,0.4)" strokeWidth="1.5" strokeDasharray="5 3" />
                                        <text x="455" y={targetY + 4} class="chart-axis-text" style={{ fill: 'var(--accent-gold)' }}>1.3</text>
                                    </g>
                                )}

                                {pathD && <path d={pathD} class="chart-curve" fill="none" />}

                                {chartPoints.map((pt, idx) => (
                                    <g key={idx}>
                                        <circle cx={pt.x} cy={pt.y} r="5.5" class="chart-point" />
                                        <text x={pt.x} y={pt.y - 10} text-anchor="middle" class="chart-axis-text" style={{ fill: pt.val >= TARGET_ADG ? 'var(--primary-green-light)' : 'hsl(0,75%,60%)' }}>{pt.val}</text>
                                        <text x={pt.x} y="205" text-anchor="middle" class="chart-axis-text">{pt.label}</text>
                                    </g>
                                ))}

                                {yGridLines.map((line, idx) => (
                                    <text key={idx} x="44" y={line.y + 4} text-anchor="end" class="chart-axis-text">{line.val}</text>
                                ))}
                            </svg>
                        </div>
                    )}
                </div>

                {/* Unified Tasks Panel */}
                <div class="glass-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <h3 class="panel-title" style={{ flexShrink: 0 }}>
                        <i class="fa-solid fa-list-check"></i> Today's Tasks
                        {taskItems.length > 0 && <span style={{ marginLeft: 'auto', background: 'rgba(220,53,69,0.15)', color: 'hsl(0,75%,60%)', borderRadius: '50px', padding: '0.1rem 0.55rem', fontSize: '0.78rem', fontWeight: '700' }}>{taskItems.length}</span>}
                    </h3>

                    <div class="alarms-list">
                        {taskItems.map((item, idx) => (
                            <div key={idx} class={`alarm-card ${item.type === 'sick' || item.type === 'adg' || item.type === 'vaccine' || item.type === 'missed-feed' || item.type === 'weight-spread' ? 'danger' : item.type === 'market' ? '' : 'warning'}`}
                                style={item.type === 'market' ? { borderLeft: '4px solid var(--primary-green-light)', background: 'rgba(25,135,84,0.02)' } : item.type === 'quarantine' ? { borderLeft: '4px solid hsl(200,70%,60%)', background: 'rgba(0,120,200,0.02)' } : {}}>
                                <div class="alarm-icon"><i class={`fa-solid ${item.icon}`} style={{ color: item.color }}></i></div>
                                <div class="alarm-text" style={{ flex: 1, minWidth: 0 }}>
                                    <span class="alarm-msg" style={{ color: 'var(--text-pure)' }}>{item.msg}</span>
                                    <span class="alarm-desc">{item.desc}</span>
                                </div>
                                {item.action && item.action.inline && (
                                    <button class="btn btn-secondary" style={{ minHeight: '28px', padding: '0.15rem 0.5rem', fontSize: '0.72rem', flexShrink: 0, borderColor: 'rgba(0,150,200,0.3)', color: 'hsl(200,70%,60%)' }}
                                        onClick={() => transitionAnimalStatus(item.animalId, 'Fattening')}>
                                        → Fattening
                                    </button>
                                )}
                                {item.action && item.action.tab && (
                                    <button class="btn btn-secondary" style={{ minHeight: '28px', padding: '0.15rem 0.5rem', fontSize: '0.72rem', flexShrink: 0 }}
                                        onClick={() => onNavigate && onNavigate(item.action.tab)}>
                                        {item.action.label}
                                    </button>
                                )}
                            </div>
                        ))}

                        {taskItems.length === 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.4rem', minHeight: '120px', color: 'var(--text-muted)' }}>
                                <i class="fa-solid fa-circle-check" style={{ fontSize: '1.8rem', color: 'var(--primary-green-light)' }}></i>
                                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', color: 'var(--text-pure)', fontSize: '0.92rem' }}>All Clear</span>
                                <span style={{ fontSize: '0.78rem' }}>No tasks across the herd.</span>
                            </div>
                        )}
                    </div>
                </div>

            </div>

        </div>
    );
}
