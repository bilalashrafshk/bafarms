// Shared "lagger" (special attention) definition — a single source of truth so
// Dashboard, Herd Ledger, Weight Tracker, and Rotation Planner all flag exactly the
// same set of animals instead of each screen inventing its own threshold. An animal
// is a lagger if its most recently logged ADG has fallen below the herd's alert
// threshold (systemParams.adgAlertThreshold, default 1.0 kg/day) — mirrors the
// "Low gain" check Dashboard's Action Required list already used before this file
// existed, just centralized so other screens can flag the same animals.
//
// Sold/Deceased animals are never laggers — nothing actionable to flag once an
// animal has left the active herd. Animals with no weight logs yet, or whose only
// log has adg === 0 (first-ever weigh-in, no prior baseline to compare against),
// are excluded rather than treated as a false-positive lagger.

// One-off corrupted intake window exclusion (pre-08-Aug-2026 corrupted entry
// baseline) — same exclusion Dashboard's ADG trend/alerts already apply.
const isCorruptedWeighDate = (d) => {
    if (!d) return false;
    const str = String(d);
    return str.startsWith('2026-07-29') || str.startsWith('2026-08-08');
};

export function getLaggerIds(animals, weightLogs, systemParams) {
    const threshold = systemParams?.adgAlertThreshold ?? 1.0;
    const ids = new Set();
    (animals || []).forEach(a => {
        if (a.status === 'Sold' || a.status === 'Deceased') return;
        const logs = (weightLogs || [])
            .filter(w => w.animalId === a.id && !isCorruptedWeighDate(w.date))
            .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
        if (logs.length > 0 && logs[0].adg !== 0 && logs[0].adg < threshold) {
            ids.add(a.id);
        }
    });
    return ids;
}
