# Dashboard UI fixes — code to paste in

Paste into `smartherd-portal/src/index.css` and `smartherd-portal/src/components/Dashboard.jsx`. Matches the mockup in `SmartHerd Dashboard Redesign.dc.html`.

## 1. KPI row — no more orphan card

`index.css` — replace `.dashboard-grid`:

```css
.dashboard-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    flex-shrink: 0;
}
.dashboard-grid .stat-box {
    flex: 1 1 220px;
}
```

In the `@media (max-width: 1024px)` block, replace the `.dashboard-grid` override:

```css
.dashboard-grid .stat-box {
    flex-basis: 100%;
}
```

(`grid-template-columns` on `.dashboard-grid` at that breakpoint can be deleted — it's no longer a grid.)

## 2. Critical alerts — grouped by pen, not one big card per issue

`index.css` — add:

```css
.alert-pen-group {
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    overflow: hidden;
    flex-shrink: 0; /* prevents flex-column squeeze/clip inside the scroll list */
}
.alert-pen-group-header {
    padding: 0.6rem 0.9rem;
    background: rgba(255, 255, 255, 0.02);
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--text-pure);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.alert-pen-group-header small {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-weight: 500;
}
.alert-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.6rem 0.9rem;
    border-top: 1px solid rgba(255, 255, 255, 0.03);
}
.alert-row i { font-size: 0.95rem; flex-shrink: 0; width: 16px; text-align: center; }
.alert-row .alert-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.alert-row .alert-row-title { font-size: 0.85rem; font-weight: 600; color: var(--text-pure); }
.alert-row .alert-row-desc { font-size: 0.76rem; color: var(--text-muted); }
```

Replace `.critical-alerts-grid` rule with:

```css
.critical-alerts-grid {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 300px;
    overflow-y: auto;
    padding-right: 0.3rem;
}
```

`Dashboard.jsx` — group `criticalAlerts` by pen before the return, and swap the render block:

```jsx
const alertGroups = useMemo(() => {
    const map = new Map();
    criticalAlerts.forEach(a => {
        const m = a.title.match(/^Pen (\w+)/);
        const key = m ? m[1] : 'General';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(a);
    });
    return Array.from(map.entries()).map(([pen, issues]) => ({ pen, issues }));
}, [criticalAlerts]);
```

```jsx
<div className="critical-alerts-grid">
    {alertGroups.map(g => (
        <div className="alert-pen-group" key={g.pen}>
            <div className="alert-pen-group-header">
                <i className="fa-solid fa-warehouse" style={{ color: 'var(--accent-gold)' }}></i>
                {g.pen === 'General' ? 'General' : `Pen ${g.pen}`}
                <small>— {g.issues.length} {g.issues.length === 1 ? 'issue' : 'issues'}</small>
            </div>
            {g.issues.map((issue, i) => (
                <div className="alert-row" key={i} style={{ borderLeft: `3px solid ${issue.badgeColor === 'danger' ? 'hsl(0,75%,55%)' : 'var(--accent-gold)'}` }}>
                    <i className={`fa-solid ${issue.icon}`} style={{ color: issue.badgeColor === 'danger' ? 'hsl(0,75%,60%)' : 'var(--accent-gold)' }}></i>
                    <div className="alert-row-body">
                        <span className="alert-row-title">{issue.title.replace(/^Pen \w+ — /, '')}</span>
                        <span className="alert-row-desc">{issue.desc}</span>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => onNavigate && onNavigate(issue.action.tab)}>
                        {issue.action.label} <i className="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
            ))}
        </div>
    ))}
</div>
```

## 3. ADG chart — sparse-data state

`index.css` — add:

```css
.chart-sparse-state {
    flex: 1;
    min-height: 220px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    text-align: center;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 10px;
    border: 1px dashed rgba(255, 255, 255, 0.08);
}
```

`Dashboard.jsx` — add a threshold, and branch the render:

```jsx
const hasEnoughChartData = adgByDate.length >= 3;
```

```jsx
{!hasEnoughChartData ? (
    <div className="chart-sparse-state">
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: '2.1rem', fontWeight: 800, color: 'var(--accent-gold)' }}>
            {avgHerdAdg ?? '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>kg/day</small>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: 280, lineHeight: 1.4 }}>
            {adgByDate.length === 0
                ? 'No weigh sessions logged yet.'
                : `Only ${adgByDate.length} weigh session${adgByDate.length > 1 ? 's' : ''} logged so far — the trend line will build in as more come in.`} Target: 1.30 kg/day.
        </div>
    </div>
) : (
    // existing <svg className="chart-svg">...</svg> block, unchanged
    ...
)}
```

## 4. Upcoming schedule — vertical timeline (mobile-safe)

`index.css` — add:

```css
.schedule-day-row {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.85rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.schedule-day-label {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
}
.schedule-day-label strong { font-family: var(--font-heading); font-weight: 700; font-size: 0.85rem; color: var(--accent-gold); }
.schedule-day-label span { font-size: 0.75rem; color: var(--text-muted); }
.schedule-event-card {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 0.65rem 0.9rem;
}
.schedule-event-top { display: flex; align-items: flex-start; gap: 0.7rem; min-width: 0; }
.schedule-event-top i { font-size: 1rem; width: 18px; text-align: center; flex-shrink: 0; margin-top: 0.15rem; }
.schedule-event-meta { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-left: 1.85rem; }
```

Delete the old fixed-width horizontal-scroll day-card CSS/markup and replace the render block with:

```jsx
<div style={{ display: 'flex', flexDirection: 'column' }}>
    {sortedCalendarDays.map(day => (
        <div className="schedule-day-row" key={day.dateStr}>
            <div className="schedule-day-label">
                <strong>{day.relativeLabel}</strong>
                <span>{day.formattedDate}</span>
            </div>
            {day.events.map((ev, i) => (
                <div className="schedule-event-card" key={i} style={{ borderLeft: `3px solid ${ev.badgeColor === 'danger' ? 'hsl(0,75%,55%)' : ev.badgeColor === 'info' ? '#38bdf8' : 'var(--accent-gold)'}` }}>
                    <div className="schedule-event-top">
                        <i className={`fa-solid ${ev.icon}`} style={{ color: ev.badgeColor === 'danger' ? 'hsl(0,75%,60%)' : ev.badgeColor === 'info' ? '#38bdf8' : 'var(--accent-gold)' }}></i>
                        <div>
                            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-pure)' }}>{ev.title}</div>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{ev.subtitle}</div>
                        </div>
                    </div>
                    <div className="schedule-event-meta">
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '0.15rem 0.55rem', borderRadius: 50 }}>{ev.count} {ev.count === 1 ? 'calf' : 'calves'}</span>
                        <button className="btn btn-secondary btn-sm" onClick={() => ev.action.tab && onNavigate && onNavigate(ev.action.tab)}>{ev.action.label}</button>
                    </div>
                </div>
            ))}
        </div>
    ))}
</div>
```
