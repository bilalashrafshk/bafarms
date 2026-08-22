// Shared underperforming-animal definitions — a single source of truth so Dashboard,
// Herd Ledger, Weight Tracker, and Rotation Planner all flag exactly the same animals
// instead of each screen inventing its own threshold.
//
// Two severity tiers, based on each animal's most recently logged ADG:
//   - Lagger        — ADG < SEVERE_ADG_THRESHOLD (0.5 kg/day). Matches the "Poor Doer /
//                      Stagnant" tier already used in the Weight Tracker performance
//                      report — chronic/severe underperformers needing urgent attention.
//   - Special Focus — ADG between SEVERE_ADG_THRESHOLD and the herd's general alert
//                      threshold (systemParams.adgAlertThreshold, default 1.0 kg/day).
//                      Below target, but not yet severe enough to be a Lagger.
//
// Sold/Deceased animals are never flagged — nothing actionable once an animal has left
// the active herd. Animals with no weight logs yet, or whose only log has adg === 0
// (first-ever weigh-in, no prior baseline to compare against), are excluded rather than
// treated as a false positive.

// One-off corrupted intake window exclusion (pre-08-Aug-2026 corrupted entry
// baseline) — same exclusion Dashboard's ADG trend/alerts already apply.
const isCorruptedWeighDate = (d) => {
    if (!d) return false;
    const str = String(d);
    return str.startsWith('2026-07-29') || str.startsWith('2026-08-08');
};

const SEVERE_ADG_THRESHOLD = 0.5;

// Most recently logged ADG for an animal, or null if there's no usable baseline yet.
function latestAdg(animalId, weightLogs) {
    const logs = (weightLogs || [])
        .filter(w => w.animalId === animalId && !isCorruptedWeighDate(w.date))
        .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
    if (logs.length === 0 || logs[0].adg === 0) return null;
    return logs[0].adg;
}

export function getLaggerIds(animals, weightLogs, systemParams) {
    const ids = new Set();
    (animals || []).forEach(a => {
        if (a.status === 'Sold' || a.status === 'Deceased') return;
        const adg = latestAdg(a.id, weightLogs);
        if (adg !== null && adg < SEVERE_ADG_THRESHOLD) ids.add(a.id);
    });
    return ids;
}

export function getSpecialFocusIds(animals, weightLogs, systemParams) {
    const threshold = systemParams?.adgAlertThreshold ?? 1.0;
    const ids = new Set();
    (animals || []).forEach(a => {
        if (a.status === 'Sold' || a.status === 'Deceased') return;
        const adg = latestAdg(a.id, weightLogs);
        if (adg !== null && adg >= SEVERE_ADG_THRESHOLD && adg < threshold) ids.add(a.id);
    });
    return ids;
}
