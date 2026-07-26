// Single source of truth for how dates are displayed across the portal —
// always DD-MM-YYYY (date-month-year), regardless of browser/locale defaults.
// Accepts a Date, an ISO string (YYYY-MM-DD or full timestamp), or anything
// `new Date()` can parse. Returns '' for missing/invalid input so callers can
// fall back to a placeholder (e.g. '—') without throwing.
export function formatDate(value) {
    if (!value) return '';

    // Plain 'YYYY-MM-DD' (what the API and <input type="date"> both use) has no
    // timezone info — parsing it with `new Date()` treats it as UTC midnight,
    // which can roll back to the previous day in timezones behind UTC. Parse
    // the components directly instead of going through the Date constructor.
    if (typeof value === 'string') {
        const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    }

    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}
