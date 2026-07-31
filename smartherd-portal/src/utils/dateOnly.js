// Pakistan Standard Time is a fixed UTC+5 offset (no DST) — the farm operates on
// PKT regardless of where the browser/server happens to be running (e.g. a
// serverless API function executing in UTC), so "today" and every day-count
// (days on feed, days since weigh-in, days in quarantine, missed feeding days,
// withholding remaining, etc.) must be anchored to PKT, not the runtime's local
// timezone. Mixing `new Date(dateString)` (a plain 'YYYY-MM-DD' is parsed as UTC
// midnight) with a runtime-local `new Date()` "today" is exactly the bug class
// formatDate.js already documents for display: a UTC-midnight timestamp rolls
// back to the previous calendar day in timezones behind UTC, silently shifting
// every day-count by one. The helpers below give every caller a single,
// consistent "day space" so date-only values always diff/compare correctly no
// matter what timezone the code happens to execute in.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

// Today's calendar date in PKT as 'YYYY-MM-DD', independent of the executing
// environment's local timezone (uses the absolute clock, Date.now(), then reads
// the calendar date back out via UTC getters after applying the fixed +5h offset).
export function todayPKT() {
    return new Date(Date.now() + PKT_OFFSET_MS).toISOString().split('T')[0];
}

// Parses a 'YYYY-MM-DD' (or full timestamp/Date) date-only value into a Date
// anchored at UTC midnight of that exact calendar day — safe to diff/compare
// against any other value produced by this module, since they all live in the
// same UTC-anchored day-space and never drift with local timezone/DST. A Date
// instance is passed through unchanged (as a clone) rather than re-derived via
// local getters — it's assumed to already be one of this module's own
// UTC-anchored values (e.g. chained from another parseDateOnly()/todayAsDate()
// call), and re-reading it with local getters would reintroduce the exact
// timezone drift this module exists to avoid.
export function parseDateOnly(value) {
    if (!value) return null;
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value === 'string') {
        const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// Today's calendar date in PKT, as a Date anchored the same way as
// parseDateOnly() so it can be diffed directly against parsed date-only values.
export function todayAsDate() {
    return parseDateOnly(todayPKT());
}

// Whole calendar days between two date-only values (a - b), in the shared
// UTC-anchored day-space — never fractional, never off-by-one from DST/local tz.
// Accepts Date objects or raw values (strings/Dates), parsing raw values with
// parseDateOnly() first.
export function daysBetween(a, b) {
    const da = a instanceof Date ? a : parseDateOnly(a);
    const db = b instanceof Date ? b : parseDateOnly(b);
    if (!da || !db) return NaN;
    return Math.round((da - db) / 86400000);
}
