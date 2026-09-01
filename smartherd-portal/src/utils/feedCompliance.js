/**
 * Determines whether today's feed has been completely logged for the farm
 * or for a specific selected pen.
 *
 * @param {Array} animals - Herd animals list
 * @param {Array} feedLogs - Feeding logs list
 * @param {string} todayStr - YYYY-MM-DD date string for today
 * @param {string} [compliancePenFilter='ALL'] - Pen filter ('ALL' or specific pen ID)
 * @returns {boolean} true if today's feed is completely logged
 */
export function checkTodayFeedComplete(animals, feedLogs, todayStr, compliancePenFilter = 'ALL') {
    const activePenIds = Array.from(new Set(
        (animals || [])
            .filter(a => a && a.status !== 'Sold' && a.status !== 'Deceased' && a.pen)
            .map(a => String(a.pen))
    ));

    const targetPenIds = compliancePenFilter !== 'ALL'
        ? [String(compliancePenFilter)]
        : activePenIds;

    if (targetPenIds.length === 0) {
        return (feedLogs || []).some(f => f && f.date && String(f.date).split('T')[0] === todayStr);
    }

    return targetPenIds.every(penId => {
        const penLogs = (feedLogs || []).filter(f =>
            f && f.date && String(f.date).split('T')[0] === todayStr && (String(f.pen) === penId || String(f.pen) === 'ALL')
        );
        if (penLogs.length === 0) return false;
        if (penLogs.some(f => (f.feedingIndex || 0) === 0 || (f.numFeedings || 1) <= 1 || (parseFloat(f.feedingPct) >= 99.5))) {
            return true;
        }
        const maxNumFeedings = Math.max(...penLogs.map(f => parseInt(f.numFeedings) || 1));
        const loggedPct = penLogs.reduce((sum, f) => sum + (f.feedingPct !== undefined && f.feedingPct !== null ? parseFloat(f.feedingPct) || 0 : (100 / maxNumFeedings)), 0);
        const loggedIndexes = new Set(penLogs.map(f => parseInt(f.feedingIndex) || 0));
        const hasAllIndexes = Array.from({ length: maxNumFeedings }, (_, i) => i + 1).every(idx => loggedIndexes.has(idx));
        return loggedPct >= 99.5 || hasAllIndexes;
    });
}
