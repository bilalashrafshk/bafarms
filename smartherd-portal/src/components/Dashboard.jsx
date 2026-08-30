import React, { useState, useContext, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayAsDate, todayPKT, parseDateOnly, daysBetween } from '../utils/dateOnly';
import { getLaggerIds, getSpecialFocusIds } from '../utils/laggers';

export default function Dashboard({ onNavigate }) {
    const {
        animals, weightLogs, treatments, feedLogs, transitionAnimalStatus,
        systemParams, orders, pens, quarantineProtocols, feedStockIssues,
        feedStockItems, feedPurchases, getFeedStockIssueCosts, getPenRosterAsOf, events
    } = useContext(FarmContext);

    // 1. DYNAMIC CALCULATIONS

    // One-off corrupted intake window exclusion (pre-08-Aug-2026 uncalibrated intake scale entries).
    // 08-Aug-2026 is the valid baseline starting weight across the herd.
    const isCorruptedWeighDate = d => {
        if (!d) return false;
        const str = String(d);
        return str.startsWith('2026-07-29') || str.startsWith('2026-08-02');
    };

    // ADG recorded on 08-Aug was calculated against uncalibrated intake weights, so its
    // derivative ADG rate is excluded from herd ADG averaging, but its actual weight is valid.
    const isCorruptedAdgDate = d => isCorruptedWeighDate(d) || (d && String(d).startsWith('2026-08-08'));

    const isPreBaselineFeedDate = d => {
        if (!d) return false;
        const str = String(d);
        return str < '2026-08-08';
    };

    // A. Actual Daily Feed Cost per Animal (PKR/Day)
    // Derived strictly from actual logged feedings and manual stock issues in the valid baseline window.
    // - 0% feed days / unlogged days are completely excluded (never drag down the average).
    // - Partial sessions (e.g. 50% Morning session) are weighted by (feedingPct / 100) so partial
    //   feedings do not artificially cut the reported daily cost rate in half.
    const validFeedLogs = (feedLogs || []).filter(f =>
        !isPreBaselineFeedDate(f.date) &&
        (f.totalCost || 0) > 0 &&
        (f.animalCount || 0) > 0 &&
        (f.feedingPct === undefined || f.feedingPct > 0)
    );

    const manualFeedIssues = (feedStockIssues || []).filter(i => {
        if (isPreBaselineFeedDate(i.date)) return false;
        if (i.pen === 'PRODUCTION') return false; // Premix manufacturing batches are converted to Wanda, not direct cattle feeding
        const item = (feedStockItems || []).find(it => it.id === i.itemId);
        return item?.category === 'feed';
    });

    const issueCostsMap = getFeedStockIssueCosts ? getFeedStockIssueCosts() : {};
    const totalManualIssueCost = manualFeedIssues.reduce((sum, iss) => sum + (issueCostsMap[iss.id]?.cost || 0), 0);

    const totalLoggedFeedCost = validFeedLogs.reduce((sum, f) => sum + (f.totalCost || 0), 0) + totalManualIssueCost;

    const tmrAnimalDays = validFeedLogs.reduce((sum, f) => {
        const scale = ((f.feedingPct !== undefined && f.feedingPct !== null) ? f.feedingPct : 100) / 100;
        return sum + (f.animalCount || 0) * scale;
    }, 0);

    const dailyCostPerAnimal = tmrAnimalDays > 0
        ? totalLoggedFeedCost / tmrAnimalDays
        : null;

    // B. Herd Average ADG — overall average across all valid weight logs across time,
    // excluding the one-off corrupted intake window (pre-08-Aug-2026 interval).
    // All subsequent weigh-ins will be accumulated and averaged together normally.
    const validAdgLogs = (weightLogs || []).filter(w => w.adg !== 0 && !isCorruptedAdgDate(w.date));
    const avgHerdAdg = validAdgLogs.length > 0
        ? parseFloat((validAdgLogs.reduce((sum, log) => sum + log.adg, 0) / validAdgLogs.length).toFixed(2))
        : null;

    // A2. Actual Cost per kg Gained — rebuilt at RFID/animal level, the way a feedlot
    // actually closes out cost-of-gain: for every animal with ≥2 weight logs, each
    // consecutive pair of logs is its own "closeout interval" — actual kg gained is the
    // real weight delta between the two weigh-ins (not an extrapolated ADG × days
    // estimate), and the feed cost charged to that interval is that animal's pro-rata
    // head-day share of the pen's actual feed spend during that exact date window (feed
    // is fed per-pen in TMR batches, not individually metered, so head-days is the
    // standard way to split a shared pen cost across the animals that were actually
    // present). The blended rate is Σ(cost across every animal-interval) ÷ Σ(gain across
    // every animal-interval) — not an average of each animal's own $/kg ratio — so one
    // noisy/low-gain animal can't dominate the herd number the way a simple average would.
    // Animals with 0 or 1 usable weight logs contribute nothing (no closeable interval).
    // Reuses the exact same pen-residency/head-days reconstruction CostOfGainReport.jsx
    // already uses (registered/pen_transfer event replay), just re-applied per animal
    // interval instead of one fixed report-wide date range.
    const addDaysStr = (dateStr, n) => {
        const d = parseDateOnly(dateStr);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().split('T')[0];
    };

    const segmentsByAnimal = useMemo(() => {
        const map = new Map();
        const todayStr = todayPKT();
        (animals || []).forEach(animal => {
            const penEvents = (events || [])
                .filter(e => e.animalId === animal.id && (e.eventType === 'registered' || e.eventType === 'pen_transfer') && e.toPen)
                .sort((a, b) => daysBetween(parseDateOnly(a.date), parseDateOnly(b.date)) || (a.id - b.id));
            const exitEvent = (events || []).find(e => e.animalId === animal.id && (e.eventType === 'sold' || e.eventType === 'deceased'));
            const exitDate = exitEvent ? exitEvent.date : todayStr;

            const segments = penEvents.length > 0
                ? penEvents.map((ev, i) => ({
                    pen: ev.toPen,
                    start: ev.date,
                    end: i + 1 < penEvents.length ? penEvents[i + 1].date : exitDate
                }))
                : [{ pen: animal.pen, start: animal.entryDate || exitDate, end: exitDate }];
            map.set(animal.id, segments);
        });
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animals, events]);

    // Days a single animal spent in `pen` within [wStart, wEnd] (inclusive both ends).
    const daysInPenWindow = (animalId, pen, wStart, wEnd) => {
        const segs = segmentsByAnimal.get(animalId) || [];
        let total = 0;
        segs.forEach(seg => {
            if (seg.pen !== pen) return;
            const start = seg.start > wStart ? seg.start : wStart;
            const end = seg.end < wEnd ? seg.end : wEnd;
            if (start > end) return;
            total += daysBetween(end, start) + 1;
        });
        return total;
    };

    // Every pen-segment (possibly more than one, if the animal was transferred) a single
    // animal actually occupied within [wStart, wEnd], clipped to that window.
    const clippedSegments = (animalId, wStart, wEnd) => {
        const segs = segmentsByAnimal.get(animalId) || [];
        const out = [];
        segs.forEach(seg => {
            const start = seg.start > wStart ? seg.start : wStart;
            const end = seg.end < wEnd ? seg.end : wEnd;
            if (start > end) return;
            out.push({ pen: seg.pen, start, end });
        });
        return out;
    };

    // Total herd head-days (every animal, every pen) within [wStart, wEnd].
    const totalHerdHeadDaysWindow = (wStart, wEnd) => {
        let total = 0;
        segmentsByAnimal.forEach((segs) => {
            segs.forEach(seg => {
                const start = seg.start > wStart ? seg.start : wStart;
                const end = seg.end < wEnd ? seg.end : wEnd;
                if (start > end) return;
                total += daysBetween(end, start) + 1;
            });
        });
        return total;
    };

    // Total head-days ALL animals spent specifically in `pen` within [wStart, wEnd].
    const totalHeadDaysInPenWindow = (pen, wStart, wEnd) => {
        let total = 0;
        segmentsByAnimal.forEach((_segs, animalId) => {
            total += daysInPenWindow(animalId, pen, wStart, wEnd);
        });
        return total;
    };

    const feedCostInWindow = (pen, wStart, wEnd) =>
        validFeedLogs
            .filter(f => f.pen === pen && f.date >= wStart && f.date <= wEnd)
            .reduce((sum, f) => sum + (f.totalCost || 0), 0)
        + manualFeedIssues
            .filter(i => i.pen === pen && i.date >= wStart && i.date <= wEnd)
            .reduce((sum, iss) => sum + (issueCostsMap[iss.id]?.cost || 0), 0);

    let totalMeasuredFeedCost = 0;
    let totalMeasuredGainKg = 0;

    const weightLogsByAnimal = new Map();
    (weightLogs || []).forEach(w => {
        if (isCorruptedWeighDate(w.date)) return;
        if (!weightLogsByAnimal.has(w.animalId)) weightLogsByAnimal.set(w.animalId, []);
        weightLogsByAnimal.get(w.animalId).push(w);
    });

    weightLogsByAnimal.forEach((logs, animalId) => {
        if (logs.length < 2) return;
        logs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        for (let i = 1; i < logs.length; i++) {
            const prevLog = logs[i - 1];
            const currLog = logs[i];
            const prevWeight = Number(prevLog.weight);
            const currWeight = Number(currLog.weight);
            // One malformed/missing weight (e.g. an un-synced local draft, or a legacy
            // entry-weight gap) must never poison the running herd-wide total via NaN —
            // skip just this one interval instead of silently zeroing the whole stat.
            if (!Number.isFinite(prevWeight) || !Number.isFinite(currWeight)) continue;
            if (!parseDateOnly(prevLog.date) || !parseDateOnly(currLog.date)) continue;

            const wStart = addDaysStr(prevLog.date, 1);
            const wEnd = currLog.date;
            if (wStart > wEnd) continue; // same-day re-weigh, no closeable window
            // Interval opens before the valid feed-cost baseline (validFeedLogs/manualFeedIssues
            // are baseline-filtered) — real gain happened, but no cost data can exist for the
            // window, so counting the gain here would understate the rate. Skip rather than
            // credit it as free.
            if (isPreBaselineFeedDate(wStart)) continue;

            const gainKg = currWeight - prevWeight;

            let costShare = 0;
            clippedSegments(animalId, wStart, wEnd).forEach(seg => {
                const segDays = daysBetween(seg.end, seg.start) + 1;
                const penCost = feedCostInWindow(seg.pen, seg.start, seg.end);
                const penHeadDays = totalHeadDaysInPenWindow(seg.pen, seg.start, seg.end);
                if (penHeadDays > 0) costShare += penCost * (segDays / penHeadDays);
            });

            const allCost = validFeedLogs
                .filter(f => f.pen === 'ALL' && f.date >= wStart && f.date <= wEnd)
                .reduce((sum, f) => sum + (f.totalCost || 0), 0)
                + manualFeedIssues
                    .filter(i => i.pen === 'ALL' && i.date >= wStart && i.date <= wEnd)
                    .reduce((sum, iss) => sum + (issueCostsMap[iss.id]?.cost || 0), 0);
            const animalDaysInWindow = daysBetween(wEnd, wStart) + 1;
            const herdDaysInWindow = totalHerdHeadDaysWindow(wStart, wEnd);
            if (herdDaysInWindow > 0) costShare += allCost * (animalDaysInWindow / herdDaysInWindow);

            totalMeasuredFeedCost += costShare;
            totalMeasuredGainKg += gainKg;
        }
    });

    const costPerKgGain = totalMeasuredGainKg > 0 ? totalMeasuredFeedCost / totalMeasuredGainKg : null;

    // D. Medical & Vaccine Cost per Head (Combined Med Cost)
    // Computes total actual medication, vaccination, and deworming expenses allocated across active herd.
    let totalMedCost = 0;
    let vaccineCost = 0;
    let dewormingCost = 0;

    (treatments || []).forEach(t => {
        let cost = 0;
        if (t.stockIssueId && issueCostsMap[t.stockIssueId]?.cost) {
            const issueCostObj = issueCostsMap[t.stockIssueId];
            const match = (t.dosage || '').match(/([\d.]+)/);
            const doseVal = match ? parseFloat(match[1]) : 0;
            if (doseVal > 0 && issueCostObj.rate > 0 && issueCostObj.cost > (doseVal * issueCostObj.rate * 1.5)) {
                cost = doseVal * issueCostObj.rate;
            } else {
                cost = issueCostObj.cost;
            }
        } else {
            const rawMed = (t.medicine || '').toLowerCase();
            const matched = (feedStockItems || []).find(i => {
                const iname = (i.name || '').toLowerCase();
                return iname && (rawMed.includes(iname) || iname.includes(rawMed.replace('inj.', '').trim()));
            });
            if (matched) {
                const purchases = (feedPurchases || []).filter(p => p.itemId === matched.id);
                const rate = purchases[0]?.rate || 0;
                if (rate > 0) {
                    const match = (t.dosage || t.medicine || '').match(/([\d.]+)\s*(ml|unit|dose|pc|kg)?/i);
                    const doseVal = match ? parseFloat(match[1]) : 1;
                    const bottleMatch = matched.name.match(/(\d+)\s*ml/i);
                    let multiplier = doseVal;
                    if (matched.unit === 'pc' && match && match[2]?.toLowerCase() === 'ml' && bottleMatch) {
                        multiplier = doseVal / parseFloat(bottleMatch[1]);
                    }
                    cost = multiplier * rate;
                }
            }
        }
        totalMedCost += cost;
        const type = (t.type || '').toLowerCase();
        if (type.includes('vaccin')) vaccineCost += cost;
        else if (type.includes('deworm')) dewormingCost += cost;
    });

    const activeHerdCount = animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased').length || animals.length || 1;
    const medCostPerHead = activeHerdCount > 0 ? (totalMedCost / activeHerdCount) : 0;

    // D2. Sick — animals currently in the Sick pen only. (Withholding from a routine
    // treatment doesn't by itself mean an animal is sick, so it's not counted here.)
    const sickCount = animals.filter(a => a.status === 'Sick').length;

    // C. Trigger Alerts for Underperforming Calves (ADG < adgAlertThreshold) — "laggers".
    // Membership comes from the shared utils/laggers.js definition so Dashboard, Herd
    // Ledger, Weight Tracker, and Rotation Planner all flag exactly the same animals.
    const laggerIds = getLaggerIds(animals, weightLogs, systemParams);
    const specialFocusIds = getSpecialFocusIds(animals, weightLogs, systemParams);
    const alertCalves = [];
    animals.forEach(animal => {
        if (!laggerIds.has(animal.id)) return;
        const animalLogs = (weightLogs || [])
            .filter(w => w.animalId === animal.id && !isCorruptedWeighDate(w.date))
            .sort((a, b) => daysBetween(b.date, a.date));
        alertCalves.push({
            rfid: animal.rfid,
            adg: animalLogs[0].adg,
            breed: animal.breed
        });
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
    const isProtocolTaskDone = (animal, task) => {
        if (!animal || !task) return false;
        const taskIdStr = String(task.id);
        return (treatments || []).some(t => {
            if (Number(t.animalId) !== Number(animal.id)) return false;
            const protId = String(t.protocolTaskId || '');
            if (protId === taskIdStr) return true;
            if (taskIdStr === 'deworm1' && (protId === 'deworm' || protId === 'deworm1')) return true;
            if (taskIdStr === 'ivermectin1' && (protId === 'ivermectin' || protId === 'ivermactine' || protId === 'ivermectin1')) return true;
            const med = (t.medicine || '').toLowerCase();
            const type = (t.type || '').toLowerCase();
            if (taskIdStr === 'deworm1' && (med.includes('oxfa') || med.includes('oxf') || (type.includes('deworm') && t.date <= '2026-08-05'))) return true;
            if (taskIdStr === 'ivermectin1' && (med.includes('ivo') || med.includes('iver') || med.includes('endect')) && t.date <= '2026-08-14') return true;
            return false;
        });
    };

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
    //
    // Also flags HALF-missed days: a split feeding (Morning/Evening, or Morning/
    // Afternoon/Evening) where at least one session was logged but not all of them
    // (e.g. Morning done, Evening never logged). Mirrors the session-gap detection
    // in api/farm.js's checkMissedFeeds(), computed client-side here so it shows up
    // immediately in this Action Required list rather than only in the Activity Feed
    // after the server's 30-min throttled check runs.
    const SESSION_LABELS = { 2: ['Morning', 'Evening'], 3: ['Morning', 'Afternoon', 'Evening'] };
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
            const dayLogs = feedLogs.filter(f => f.pen === pen.id && f.date === dateStr);
            if (dayLogs.length === 0) {
                missedFeedings.push({ pen, date: dateStr, half: false });
                continue;
            }
            const numFeedings = Math.max(...dayLogs.map(f => f.numFeedings || 1));
            const loggedPct = dayLogs.reduce((sum, f) => sum + (f.feedingPct !== undefined && f.feedingPct !== null ? f.feedingPct : 100), 0);
            if (numFeedings <= 1 || loggedPct >= 99.5) continue; // single full-day log, or fully covered split
            const loggedIndexes = new Set(dayLogs.map(f => f.feedingIndex || 0));
            const labels = SESSION_LABELS[numFeedings] || [];
            const missing = [];
            for (let i = 1; i <= numFeedings; i++) {
                if (!loggedIndexes.has(i)) missing.push(labels[i - 1] || `Feeding ${i}`);
            }
            if (missing.length > 0) missedFeedings.push({ pen, date: dateStr, half: true, missing, loggedPct });
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

    // CRITICAL OPERATIONAL ALERTS (Top Collapsible Banner)
    // 1. Sick calves untreated for >7 days (immediate vet intervention needed)
    // 2. Missed / half-missed feeding sessions (feed compliance failure)
    // 3. Wide pen weight spreads >20% (ration bracket distortion)
    const criticalAlerts = [
        ...sickUntreated.map(a => ({
            type: 'sick',
            title: `${a.rfid} — Sick, No Treatment Logged`,
            desc: `Calf in Sick pen with no treatment in 7+ days — requires immediate veterinary attention`,
            badge: 'Urgent Vet Care',
            badgeColor: 'danger',
            icon: 'fa-stethoscope',
            action: { label: 'Log Treatment', tab: 'vet' }
        })),
        ...missedFeedings.map(m => ({
            type: 'missed-feed',
            title: m.half ? `Pen ${m.pen.id} — Missed ${m.missing.join('/')} Feeding` : `Pen ${m.pen.id} — Missed Entire Feed Day`,
            desc: m.half
                ? `Only ${Math.round(m.loggedPct)}% logged for ${formatDate(m.date)} (missing: ${m.missing.join(', ')})`
                : `No feed recorded for ${formatDate(m.date)}`,
            badge: m.half ? 'Incomplete Feed' : 'Missed Feed',
            badgeColor: 'danger',
            icon: 'fa-bowl-food',
            action: { label: 'Log Feed', tab: 'tmr' }
        })),
        ...widePenSpreads.map(p => ({
            type: 'weight-spread',
            title: `Pen ${p.penId} — Weight Spread Too Wide (${(Number(p.spreadPct) || 0).toFixed(0)}%)`,
            desc: `Spread exceeds 20% limit — re-sort calves to prevent TMR bracket & batch feed sheet inaccuracy`,
            badge: 'Pen Uniformity',
            badgeColor: 'warning',
            icon: 'fa-scale-unbalanced',
            action: { label: 'Re-sort Pen', tab: 'rationPlans' }
        }))
    ];

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

    // OPERATIONS TASKS (Right-Hand Segmented Panel)
    // Tab 1: Vaccines & Protocols
    const vaccineTasks = pendingVaccines.map(v => ({
        type: 'vaccine',
        rfid: v.animal.rfid,
        animalId: v.animal.id,
        pen: v.animal.pen,
        msg: `${v.animal.rfid} — ${v.task.label} Due`,
        desc: v.overdueDays > 0 
            ? `Pen ${v.animal.pen || 'Unassigned'} · Day ${v.task.dueDay} protocol (${v.task.medicine || v.task.type}) · ${v.overdueDays}d overdue` 
            : `Pen ${v.animal.pen || 'Unassigned'} · Day ${v.task.dueDay} protocol (${v.task.medicine || v.task.type}) · Due today`,
        tag: v.overdueDays > 0 ? `${v.overdueDays}d overdue` : 'Due today',
        tagDanger: v.overdueDays > 0,
        color: 'hsl(0,75%,55%)',
        icon: 'fa-syringe',
        action: { label: 'Log Treatment', tab: 'vet' }
    }));

    // Tab 2: Weigh-ins & Growth Gain (Overdue Weigh-ins + Low Gain Laggers)
    const weightTasks = [
        ...overdueWeighing.map(a => ({
            type: 'overdue-weigh',
            rfid: a.rfid,
            animalId: a.id,
            pen: a.pen,
            msg: `${a.rfid} — Overdue Weigh-in`,
            desc: `Pen ${a.pen || '—'} · Last weighed >${WEIGH_INTERVAL_DAYS} days ago`,
            tag: 'Overdue',
            tagDanger: true,
            color: 'var(--accent-gold)',
            icon: 'fa-weight-scale',
            action: { label: 'Log Weight', tab: 'weights' }
        })),
        ...alertCalves.map(c => ({
            type: 'adg-lagger',
            rfid: c.rfid,
            pen: c.pen,
            msg: `${c.rfid} — Low Growth Gain`,
            desc: `Pen ${c.pen || '—'} · ${c.breed || 'Calf'} · ADG ${c.adg} kg/d (below ${(Number(systemParams.adgAlertThreshold ?? 1.0) || 0).toFixed(1)} kg/d target)`,
            tag: 'Lagger',
            tagDanger: false,
            color: 'hsl(45,90%,55%)',
            icon: 'fa-arrow-trend-down',
            action: { label: 'View Weights', tab: 'weights' }
        }))
    ];

    // Tab 3: Movements & Dispatch
    const movementTasks = [
        ...quarantineReady.map(a => ({
            type: 'quarantine-clear',
            rfid: a.rfid,
            animalId: a.id,
            pen: a.pen,
            msg: `${a.rfid} — Quarantine Cleared`,
            desc: `Pen ${a.pen || '—'} · ${daysBetween(today, a.entryDate)}d completed in Quarantine · Ready for Fattening`,
            tag: 'Ready to Move',
            tagDanger: false,
            color: 'hsl(200,70%,60%)',
            icon: 'fa-shield-virus',
            action: { label: '→ Fattening', inline: true }
        })),
        ...marketReady.map(a => ({
            type: 'market-ready',
            rfid: a.rfid,
            animalId: a.id,
            pen: a.pen,
            msg: `${a.rfid} — Ready for Market Sale`,
            desc: `Pen ${a.pen || '—'} · ${a.currentWeight}kg / ${a.targetWeight}kg target · Medical withholding clear`,
            tag: 'Target Met',
            tagDanger: false,
            color: 'var(--primary-green-light)',
            icon: 'fa-award',
            action: { label: 'Dispatch', tab: 'rotation' }
        }))
    ];

    const [activeTaskTab, setActiveTaskTab] = useState('vaccines');

    const activeTaskItems = activeTaskTab === 'vaccines'
        ? vaccineTasks
        : activeTaskTab === 'weights'
        ? weightTasks
        : movementTasks;

    // H. UPCOMING OPERATIONS & WEIGHING SCHEDULE (Next 7-14 Days)
    const [calendarHorizon, setCalendarHorizon] = useState(14);
    const [calendarFilter, setCalendarFilter] = useState('all');
    const [isCriticalExpanded, setIsCriticalExpanded] = useState(true);

    // 1. Upcoming Weigh-ins (Next projected weigh date per active calf)
    const upcomingWeighList = [];
    (animals || []).forEach(a => {
        if (a.status === 'Sold' || a.status === 'Deceased') return;
        const animalLogs = (weightLogs || [])
            .filter(w => w.animalId === a.id && !isCorruptedWeighDate(w.date))
            .sort((x, y) => (x.date < y.date ? 1 : -1));
        const lastDate = animalLogs.length > 0 ? animalLogs[0].date : a.entryDate;
        if (!lastDate) return;
        const nextDate = addDaysStr(lastDate, WEIGH_INTERVAL_DAYS);
        if (!nextDate) return;
        const daysUntil = daysBetween(parseDateOnly(nextDate), today);
        if (daysUntil >= 0 && daysUntil <= calendarHorizon) {
            upcomingWeighList.push({
                animal: a,
                date: nextDate,
                daysUntil,
                pen: a.pen || 'Unassigned',
                lastDate,
                lastWeight: animalLogs.length > 0 ? animalLogs[0].weight : a.initialWeight
            });
        }
    });

    // 2. Upcoming Quarantine Protocol Milestones
    const upcomingVaccineList = [];
    (animals || []).filter(a => a.status === 'Quarantined').forEach(a => {
        if (!a.entryDate) return;
        (quarantineProtocols || []).forEach(task => {
            if (isProtocolTaskDone(a, task)) return;
            const targetDate = addDaysStr(a.entryDate, (task.dueDay || 1) - 1);
            if (!targetDate) return;
            const daysUntil = daysBetween(parseDateOnly(targetDate), today);
            if (daysUntil >= 0 && daysUntil <= calendarHorizon) {
                upcomingVaccineList.push({
                    animal: a,
                    task,
                    date: targetDate,
                    daysUntil,
                    pen: a.pen || 'Quarantine Pen'
                });
            }
        });
    });

    // 3. Upcoming Quarantine Graduations (Exit Quarantine -> Fattening)
    const upcomingQuarantineExits = [];
    const QUARANTINE_DAYS = systemParams.quarantineDays ?? 14;
    (animals || []).filter(a => a.status === 'Quarantined').forEach(a => {
        if (!a.entryDate) return;
        const exitDate = addDaysStr(a.entryDate, QUARANTINE_DAYS);
        if (!exitDate) return;
        const daysUntil = daysBetween(parseDateOnly(exitDate), today);
        if (daysUntil >= 0 && daysUntil <= calendarHorizon) {
            upcomingQuarantineExits.push({
                animal: a,
                date: exitDate,
                daysUntil,
                pen: a.pen || 'Quarantine Pen'
            });
        }
    });

    // Aggregate into daily buckets
    const calendarDaysMap = new Map();
    const addCalendarEvent = (dateStr, eventObj) => {
        if (!calendarDaysMap.has(dateStr)) {
            calendarDaysMap.set(dateStr, []);
        }
        calendarDaysMap.get(dateStr).push(eventObj);
    };

    if (calendarFilter === 'all' || calendarFilter === 'weigh') {
        const weighByDatePen = new Map();
        upcomingWeighList.forEach(item => {
            const key = `${item.date}__${item.pen}`;
            if (!weighByDatePen.has(key)) {
                weighByDatePen.set(key, { date: item.date, pen: item.pen, daysUntil: item.daysUntil, animals: [] });
            }
            weighByDatePen.get(key).animals.push(item.animal);
        });
        weighByDatePen.forEach(group => {
            addCalendarEvent(group.date, {
                type: 'weigh',
                date: group.date,
                daysUntil: group.daysUntil,
                title: `Pen ${group.pen} — Weigh-in Due`,
                subtitle: `${group.animals.length} ${group.animals.length === 1 ? 'calf' : 'calves'} scheduled for 14-day weigh-in`,
                count: group.animals.length,
                pen: group.pen,
                animals: group.animals,
                icon: 'fa-scale-balanced',
                badgeColor: 'warning',
                action: { label: 'Log Weights', tab: 'weights' }
            });
        });
    }

    if (calendarFilter === 'all' || calendarFilter === 'vaccine') {
        const vaccByDateTask = new Map();
        upcomingVaccineList.forEach(item => {
            const key = `${item.date}__${item.task.id}`;
            if (!vaccByDateTask.has(key)) {
                vaccByDateTask.set(key, { date: item.date, task: item.task, daysUntil: item.daysUntil, animals: [] });
            }
            vaccByDateTask.get(key).animals.push(item.animal);
        });
        vaccByDateTask.forEach(group => {
            addCalendarEvent(group.date, {
                type: 'vaccine',
                date: group.date,
                daysUntil: group.daysUntil,
                title: `${group.task.label} Protocol (Day ${group.task.dueDay})`,
                subtitle: `${group.task.medicine || group.task.type} (${group.task.dosage || 'Standard dose'}) · ${group.animals.length} ${group.animals.length === 1 ? 'calf' : 'calves'}`,
                count: group.animals.length,
                animals: group.animals,
                icon: 'fa-syringe',
                badgeColor: 'danger',
                action: { label: 'Log Treatment', tab: 'vet' }
            });
        });
    }

    if (calendarFilter === 'all' || calendarFilter === 'quarantine') {
        const exitsByDatePen = new Map();
        upcomingQuarantineExits.forEach(item => {
            const key = `${item.date}__${item.pen}`;
            if (!exitsByDatePen.has(key)) {
                exitsByDatePen.set(key, { date: item.date, pen: item.pen, daysUntil: item.daysUntil, animals: [] });
            }
            exitsByDatePen.get(key).animals.push(item.animal);
        });
        exitsByDatePen.forEach(group => {
            addCalendarEvent(group.date, {
                type: 'quarantine',
                date: group.date,
                daysUntil: group.daysUntil,
                title: `Pen ${group.pen} — Quarantine Cleared`,
                subtitle: `${group.animals.length} ${group.animals.length === 1 ? 'calf' : 'calves'} completing 14-day quarantine · Ready for Fattening`,
                count: group.animals.length,
                pen: group.pen,
                animals: group.animals,
                icon: 'fa-shield-virus',
                badgeColor: 'info',
                action: { label: 'Move to Fattening', tab: 'rotation' }
            });
        });
    }

    const sortedCalendarDays = Array.from(calendarDaysMap.keys())
        .sort((a, b) => (a < b ? -1 : 1))
        .map(dateStr => {
            const events = calendarDaysMap.get(dateStr);
            const diff = daysBetween(parseDateOnly(dateStr), today);
            let relativeLabel = `In ${diff} days`;
            if (diff === 0) relativeLabel = 'Today';
            else if (diff === 1) relativeLabel = 'Tomorrow';

            return {
                dateStr,
                diff,
                relativeLabel,
                formattedDate: formatDate(dateStr),
                events
            };
        });

    const totalUpcomingEventsCount = upcomingWeighList.length + upcomingVaccineList.length + upcomingQuarantineExits.length;

    const adgByDate = (() => {
        if (!weightLogs || weightLogs.length === 0) return [];
        const groups = {};
        weightLogs.filter(w => w.adg !== 0 && !isCorruptedAdgDate(w.date)).forEach(w => {
            if (!groups[w.date]) groups[w.date] = { sum: 0, count: 0 };
            groups[w.date].sum += w.adg;
            groups[w.date].count += 1;
        });
        return Object.keys(groups)
            .map(date => ({ date, avgAdg: parseFloat((Number(groups[date].sum / groups[date].count) || 0).toFixed(2)) }))
            .sort((a, b) => parseDateOnly(a.date) - parseDateOnly(b.date));
    })();

    const hasEnoughChartData = adgByDate.length >= 3;
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', paddingBottom: '1.5rem' }}>

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
                    <span class="stat-lbl" style={{ color: 'var(--text-muted)' }}>{costPerKgGain !== null ? 'Per-animal feed cost ÷ actual weigh-in gain' : 'Needs feeding + weight logs'}</span>
                </div>

                {/* Med & Vaccine Cost per Head */}
                <div class="glass-panel stat-box" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('vet')} title="Click to view Veterinary Treatment & Vaccination History">
                    <div class="stat-header">
                        <h3>Med & Vaccine Cost</h3>
                        <div class="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.1)', borderColor: 'rgba(56, 189, 248, 0.25)', color: '#38bdf8' }}>
                            <i class="fa-solid fa-syringe"></i>
                        </div>
                    </div>
                    <div class="stat-val">
                        {totalMedCost > 0 ? Math.round(medCostPerHead).toLocaleString() : '0'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR/head</small>
                    </div>
                    <span class="stat-lbl" style={{ color: 'var(--text-muted)' }}>
                        <i class="fa-solid fa-pills"></i> Total: PKR {Math.round(totalMedCost).toLocaleString()} · {treatments.length} treatments
                    </span>
                </div>

                {/* Sick */}
                <div class="glass-panel stat-box" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('rotation')} title="Click to view Sick Pen">
                    <div class="stat-header">
                        <h3>Sick</h3>
                        <div class="stat-icon" style={{ background: 'rgba(220,53,69,0.1)', borderColor: 'rgba(220,53,69,0.25)', color: 'hsl(0,75%,60%)' }}>
                            <i class="fa-solid fa-stethoscope"></i>
                        </div>
                    </div>
                    <div class="stat-val" style={sickCount > 0 ? { color: 'hsl(0,75%,60%)' } : undefined}>
                        {sickCount} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Calves</small>
                    </div>
                    <span class="stat-lbl" style={{ color: 'var(--text-muted)' }}>
                        <i class="fa-solid fa-bed-pulse"></i> in Sick Pen
                    </span>
                </div>

                {/* Special Attention / Laggers (severe: ADG < 0.5 kg/day) */}
                <div class="glass-panel stat-box" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('weights')} title="Click to view Weight Tracker">
                    <div class="stat-header">
                        <h3>Special Attention</h3>
                        <div class="stat-icon" style={{ background: 'rgba(220,53,69,0.1)', borderColor: 'rgba(220,53,69,0.25)', color: 'hsl(0,75%,60%)' }}>
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </div>
                    </div>
                    <div class="stat-val" style={laggerIds.size > 0 ? { color: 'hsl(0,75%,60%)' } : undefined}>
                        {laggerIds.size} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Laggers</small>
                    </div>
                    <span class="stat-lbl" style={{ color: 'var(--text-muted)' }}>
                        <i class="fa-solid fa-arrow-trend-down"></i> ADG below 0.5 kg/day (Poor Doer)
                    </span>
                </div>

                {/* Special Focus — below target but not yet a severe Lagger */}
                <div class="glass-panel stat-box" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('weights')} title="Click to view Weight Tracker">
                    <div class="stat-header">
                        <h3>Special Focus</h3>
                        <div class="stat-icon" style={{ background: 'rgba(255,193,7,0.1)', borderColor: 'rgba(255,193,7,0.25)', color: 'hsl(45,90%,55%)' }}>
                            <i class="fa-solid fa-magnifying-glass"></i>
                        </div>
                    </div>
                    <div class="stat-val" style={specialFocusIds.size > 0 ? { color: 'hsl(45,90%,50%)' } : undefined}>
                        {specialFocusIds.size} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Calves</small>
                    </div>
                    <span class="stat-lbl" style={{ color: 'var(--text-muted)' }}>
                        <i class="fa-solid fa-arrow-trend-down"></i> ADG 0.5–{(Number(systemParams.adgAlertThreshold ?? 1.0) || 0).toFixed(1)} kg/day
                    </span>
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

            {/* Critical Operational Alerts Banner (Only renders when active alerts exist) */}
            {criticalAlerts.length > 0 && (
                <div className="dashboard-critical-banner glass-panel">
                    <div
                        className="critical-banner-header"
                        onClick={() => setIsCriticalExpanded(prev => !prev)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                        title="Click to collapse/expand critical operational alerts"
                    >
                        <div className="critical-banner-title">
                            <i className="fa-solid fa-triangle-exclamation" style={{ color: 'hsl(0,75%,60%)' }}></i>
                            <span>Critical Operational Attention Required</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <span className="critical-banner-badge">
                                {alertGroups.length > 1 ? `${alertGroups.length} Pens · ` : ''}{criticalAlerts.length} {criticalAlerts.length === 1 ? 'Issue' : 'Issues'}
                            </span>
                            <i className={`fa-solid ${isCriticalExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}></i>
                        </div>
                    </div>
                    {isCriticalExpanded && (
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
                    )}
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

                    {!hasEnoughChartData ? (
                        <div className="chart-sparse-state">
                            <div style={{ fontFamily: 'var(--font-heading)', fontSize: '2.1rem', fontWeight: 800, color: 'var(--accent-gold)' }}>
                                {avgHerdAdg !== null ? avgHerdAdg : '—'} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>kg/day</small>
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: 280, lineHeight: 1.4 }}>
                                {adgByDate.length === 0
                                    ? 'No weigh sessions logged yet.'
                                    : `Only ${adgByDate.length} weigh session${adgByDate.length > 1 ? 's' : ''} logged so far — the trend line will build in as more come in.`} Target: 1.30 kg/day.
                            </div>
                        </div>
                    ) : (
                        <div className="chart-container">
                            <svg className="chart-svg" viewBox="0 0 500 220" preserveAspectRatio="none">
                                {yGridLines.map((line, idx) => (
                                    <line key={idx} x1="50" y1={line.y} x2="450" y2={line.y} className="chart-grid-line" />
                                ))}
                                <line x1="50" y1="20" x2="50" y2="190" className="chart-axis-line" />
                                <line x1="50" y1="190" x2="480" y2="190" className="chart-axis-line" />

                                {/* Target 1.3 kg/day line */}
                                {targetY !== null && targetY >= 20 && targetY <= 190 && (
                                    <g>
                                        <line x1="50" y1={targetY} x2="450" y2={targetY} stroke="rgba(255,193,7,0.4)" strokeWidth="1.5" strokeDasharray="5 3" />
                                        <text x="455" y={targetY + 4} className="chart-axis-text" style={{ fill: 'var(--accent-gold)' }}>1.3</text>
                                    </g>
                                )}

                                {pathD && <path d={pathD} className="chart-curve" fill="none" />}

                                {chartPoints.map((pt, idx) => (
                                    <g key={idx}>
                                        <circle cx={pt.x} cy={pt.y} r="5.5" className="chart-point" />
                                        <text x={pt.x} y={pt.y - 10} textAnchor="middle" className="chart-axis-text" style={{ fill: pt.val >= TARGET_ADG ? 'var(--primary-green-light)' : 'hsl(0,75%,60%)' }}>{pt.val}</text>
                                        <text x={pt.x} y="205" textAnchor="middle" className="chart-axis-text">{pt.label}</text>
                                    </g>
                                ))}

                                {yGridLines.map((line, idx) => (
                                    <text key={idx} x="44" y={line.y + 4} textAnchor="end" className="chart-axis-text">{line.val}</text>
                                ))}
                            </svg>
                        </div>
                    )}
                </div>

                {/* Segmented Operations Tasks Panel */}
                <div class="glass-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div className="task-panel-header">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 className="panel-title" style={{ margin: 0 }}>
                                <i className="fa-solid fa-list-check"></i> Operations Tasks
                            </h3>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>
                                {vaccineTasks.length + weightTasks.length + movementTasks.length} active
                            </span>
                        </div>
                        <div className="task-tabs-nav">
                            <button
                                type="button"
                                className={`task-tab-btn ${activeTaskTab === 'vaccines' ? 'active' : ''}`}
                                onClick={() => setActiveTaskTab('vaccines')}
                            >
                                <i className="fa-solid fa-syringe"></i>
                                <span>Vaccines</span>
                                {vaccineTasks.length > 0 && (
                                    <span className="task-tab-count danger">{vaccineTasks.length}</span>
                                )}
                            </button>
                            <button
                                type="button"
                                className={`task-tab-btn ${activeTaskTab === 'weights' ? 'active' : ''}`}
                                onClick={() => setActiveTaskTab('weights')}
                            >
                                <i className="fa-solid fa-scale-balanced"></i>
                                <span>Weigh-ins</span>
                                {weightTasks.length > 0 && (
                                    <span className="task-tab-count warning">{weightTasks.length}</span>
                                )}
                            </button>
                            <button
                                type="button"
                                className={`task-tab-btn ${activeTaskTab === 'movements' ? 'active' : ''}`}
                                onClick={() => setActiveTaskTab('movements')}
                            >
                                <i className="fa-solid fa-arrows-split-up-and-left"></i>
                                <span>Movements</span>
                                {movementTasks.length > 0 && (
                                    <span className="task-tab-count success">{movementTasks.length}</span>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="alarms-list" style={{ marginTop: '0.6rem' }}>
                        {activeTaskItems.map((item, idx) => (
                            <div
                                key={idx}
                                className={`alarm-card ${item.type.includes('vaccine') || item.type.includes('overdue') ? 'danger' : item.type === 'market-ready' ? '' : 'warning'}`}
                                style={
                                    item.type === 'market-ready'
                                        ? { borderLeft: '4px solid var(--primary-green-light)', background: 'rgba(25,135,84,0.02)' }
                                        : item.type === 'quarantine-clear'
                                        ? { borderLeft: '4px solid hsl(200,70%,60%)', background: 'rgba(0,120,200,0.02)' }
                                        : {}
                                }
                            >
                                <div className="alarm-icon">
                                    <i className={`fa-solid ${item.icon}`} style={{ color: item.color }}></i>
                                </div>
                                <div className="alarm-text" style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                        <span className="alarm-msg" style={{ color: 'var(--text-pure)' }}>{item.msg}</span>
                                        {item.tag && (
                                            <span
                                                style={{
                                                    fontSize: '0.68rem',
                                                    padding: '0.05rem 0.4rem',
                                                    borderRadius: '4px',
                                                    fontWeight: '600',
                                                    background: item.tagDanger ? 'rgba(220,53,69,0.15)' : 'rgba(255,255,255,0.08)',
                                                    color: item.tagDanger ? 'hsl(0,75%,65%)' : 'var(--text-muted)'
                                                }}
                                            >
                                                {item.tag}
                                            </span>
                                        )}
                                    </div>
                                    <span className="alarm-desc">{item.desc}</span>
                                </div>
                                {item.action && item.action.inline && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ minHeight: '28px', padding: '0.15rem 0.5rem', fontSize: '0.72rem', flexShrink: 0, borderColor: 'rgba(0,150,200,0.3)', color: 'hsl(200,70%,60%)' }}
                                        onClick={() => transitionAnimalStatus(item.animalId, 'Fattening')}
                                    >
                                        → Fattening
                                    </button>
                                )}
                                {item.action && item.action.tab && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ minHeight: '28px', padding: '0.15rem 0.5rem', fontSize: '0.72rem', flexShrink: 0 }}
                                        onClick={() => onNavigate && onNavigate(item.action.tab)}
                                    >
                                        {item.action.label}
                                    </button>
                                )}
                            </div>
                        ))}

                        {activeTaskItems.length === 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.4rem', minHeight: '120px', color: 'var(--text-muted)' }}>
                                <i className="fa-solid fa-circle-check" style={{ fontSize: '1.8rem', color: 'var(--primary-green-light)' }}></i>
                                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', color: 'var(--text-pure)', fontSize: '0.92rem' }}>
                                    {activeTaskTab === 'vaccines' && 'Vaccines Up to Date'}
                                    {activeTaskTab === 'weights' && 'Weigh-ins On Track'}
                                    {activeTaskTab === 'movements' && 'No Pending Movements'}
                                </span>
                                <span style={{ fontSize: '0.78rem' }}>
                                    {activeTaskTab === 'vaccines' && 'No overdue or due protocol treatments in quarantine.'}
                                    {activeTaskTab === 'weights' && 'All active calves weighed within interval and gaining.'}
                                    {activeTaskTab === 'movements' && 'No calves awaiting quarantine transition or market dispatch.'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* Upcoming Operations & Weighing Schedule Calendar (Next 7-14 Days) */}
            <div className="glass-panel upcoming-calendar-panel">
                <div className="calendar-panel-header">
                    <div className="calendar-title-group">
                        <h3 className="panel-title" style={{ margin: 0 }}>
                            <i className="fa-solid fa-calendar-days" style={{ color: 'var(--accent-gold)' }}></i> Upcoming Operations Schedule
                        </h3>
                        <span className="calendar-count-badge">
                            {totalUpcomingEventsCount} {totalUpcomingEventsCount === 1 ? 'event' : 'events'} ahead
                        </span>
                    </div>

                    <div className="calendar-header-controls">
                        {/* Filter Pills */}
                        <div className="calendar-filter-group">
                            <button
                                type="button"
                                className={`calendar-filter-btn ${calendarFilter === 'all' ? 'active' : ''}`}
                                onClick={() => setCalendarFilter('all')}
                            >
                                All ({upcomingWeighList.length + upcomingVaccineList.length + upcomingQuarantineExits.length})
                            </button>
                            <button
                                type="button"
                                className={`calendar-filter-btn ${calendarFilter === 'weigh' ? 'active' : ''}`}
                                onClick={() => setCalendarFilter('weigh')}
                            >
                                <i className="fa-solid fa-scale-balanced"></i> Weigh-ins ({upcomingWeighList.length})
                            </button>
                            <button
                                type="button"
                                className={`calendar-filter-btn ${calendarFilter === 'vaccine' ? 'active' : ''}`}
                                onClick={() => setCalendarFilter('vaccine')}
                            >
                                <i className="fa-solid fa-syringe"></i> Vaccines ({upcomingVaccineList.length})
                            </button>
                            <button
                                type="button"
                                className={`calendar-filter-btn ${calendarFilter === 'quarantine' ? 'active' : ''}`}
                                onClick={() => setCalendarFilter('quarantine')}
                            >
                                <i className="fa-solid fa-shield-virus"></i> Quarantine ({upcomingQuarantineExits.length})
                            </button>
                        </div>

                        {/* Horizon Selector (7d vs 14d) */}
                        <div className="calendar-horizon-toggle">
                            <button
                                type="button"
                                className={`horizon-btn ${calendarHorizon === 7 ? 'active' : ''}`}
                                onClick={() => setCalendarHorizon(7)}
                            >
                                7 Days
                            </button>
                            <button
                                type="button"
                                className={`horizon-btn ${calendarHorizon === 14 ? 'active' : ''}`}
                                onClick={() => setCalendarHorizon(14)}
                            >
                                14 Days
                            </button>
                        </div>
                    </div>
                </div>

                {/* Calendar timeline days vertical layout */}
                {sortedCalendarDays.length > 0 ? (
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
                ) : (
                    <div className="calendar-empty-state">
                        <i className="fa-solid fa-calendar-check" style={{ fontSize: '2rem', color: 'var(--primary-green-light)', marginBottom: '0.4rem' }}></i>
                        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', color: 'var(--text-pure)', fontSize: '0.95rem' }}>
                            All Clear Ahead
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            No operations or weigh-ins scheduled for the next {calendarHorizon} days matching this filter.
                        </span>
                    </div>
                )}
            </div>

        </div>
    );
}
