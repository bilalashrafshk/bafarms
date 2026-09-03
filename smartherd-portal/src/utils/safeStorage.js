/**
 * safeStorage.js
 * Bulletproof localStorage wrapper for SmartHerd Portal.
 * 
 * Prevents "Failed to execute 'setItem' on 'Storage': Setting the value of '...' exceeded the quota"
 * errors from crashing the React tree. Automatically evicts volatile read-on-init display caches
 * when quota is reached while safeguarding critical session state and offline pending mutations.
 */

export const DISPENSABLE_CACHE_KEYS = [
    'ba_feed_logs',
    'ba_weights',
    'ba_treatments',
    'ba_events',
    'ba_feed_purchases',
    'ba_feed_stock_issues',
    'ba_overhead_expenses',
    'ba_quotations',
    'ba_spec_sheets',
    'ba_meat_cuts',
    'ba_premix_batches',
    'ba_premix_formulas',
    'ba_ration_rows',
    'ba_ration_row_items',
    'ba_ration_plans_v2',
    'ba_ration_plans',
    'ba_pens',
    'ba_animals',
    'ba_feed_stock_items',
    'ba_feed_opening_stock'
];

export const isQuotaError = (err) => {
    if (!err) return false;
    return (
        err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22 ||
        err.code === 1014 ||
        err.number === -2147024882 ||
        String(err.message || '').toLowerCase().includes('quota') ||
        String(err.message || '').toLowerCase().includes('exceeded')
    );
};

const getStorage = () => {
    try {
        if (typeof localStorage !== 'undefined') return localStorage;
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (_) {}
    return null;
};

/**
 * Removes volatile display caches from localStorage to free up browser quota.
 * Never removes session tokens, settings, pending mutations, or failed mutation notices.
 */
export const clearDispensableCaches = () => {
    const storage = getStorage();
    if (!storage) return;
    try {
        for (const key of DISPENSABLE_CACHE_KEYS) {
            storage.removeItem(key);
        }
    } catch (e) {
        console.warn('Error clearing dispensable caches:', e);
    }
};

/**
 * Truncates / sanitizes payloads on failed mutations so base64 images or massive
 * JSON arrays do not consume megabytes in localStorage.
 */
export const sanitizeFailedMutation = (item) => {
    if (!item) return item;
    const sanitized = { ...item };
    if (sanitized.payload && typeof sanitized.payload === 'object') {
        const payloadCopy = Array.isArray(sanitized.payload)
            ? sanitized.payload.slice(0, 10)
            : { ...sanitized.payload };

        // Strip heavy base64 strings or huge nested arrays
        for (const [k, v] of Object.entries(payloadCopy)) {
            if (typeof v === 'string' && v.length > 500) {
                payloadCopy[k] = v.slice(0, 100) + '... [truncated]';
            } else if (Array.isArray(v) && v.length > 20) {
                payloadCopy[k] = v.slice(0, 20);
            }
        }
        sanitized.payload = payloadCopy;
    }
    return sanitized;
};

/**
 * Caps failed mutations list to at most `maxCount` items (default 15)
 * and sanitizes their payloads to protect storage quota.
 */
export const pruneFailedMutations = (items, maxCount = 15) => {
    if (!Array.isArray(items)) return [];
    return items
        .slice(-maxCount)
        .map(sanitizeFailedMutation);
};

/**
 * Safely loads stored data with error handling.
 */
export const safeGetItem = (key, defaultVal = null) => {
    const storage = getStorage();
    if (!storage) return defaultVal;
    try {
        const stored = storage.getItem(key);
        if (stored === null || stored === undefined) return defaultVal;
        return JSON.parse(stored);
    } catch (e) {
        console.warn(`safeGetItem failed for key "${key}":`, e);
        return defaultVal;
    }
};

/**
 * Safely sets an item in localStorage.
 * If quota is exceeded, automatically evicts dispensable cache keys and retries.
 * NEVER throws an uncaught error into React.
 */
export const safeSetItem = (key, value) => {
    const storage = getStorage();
    if (!storage) return false;

    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    try {
        storage.setItem(key, serialized);
        return true;
    } catch (err) {
        if (isQuotaError(err)) {
            console.warn(`localStorage quota exceeded while saving "${key}". Evicting dispensable caches...`);
            
            // Step 1: Evict dispensable caches
            clearDispensableCaches();

            // Step 2: Retry saving
            try {
                storage.setItem(key, serialized);
                console.info(`Successfully saved "${key}" after evicting caches.`);
                return true;
            } catch (retryErr) {
                // If it's a failed mutation or pending mutation, try saving a compact version
                if (key === 'ba_failed_mutations' && Array.isArray(value)) {
                    try {
                        const ultraCompact = pruneFailedMutations(value, 5).map(f => ({
                            id: f.id,
                            action: f.action,
                            error: f.error,
                            failedAt: f.failedAt
                        }));
                        storage.setItem(key, JSON.stringify(ultraCompact));
                        return true;
                    } catch (_) {}
                }

                console.warn(`Failed to save "${key}" to localStorage even after clearing caches:`, retryErr);
                return false;
            }
        } else {
            console.warn(`Error writing "${key}" to localStorage:`, err);
            return false;
        }
    }
};

/**
 * Safely removes an item from localStorage.
 */
export const safeRemoveItem = (key) => {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.removeItem(key);
    } catch (e) {
        console.warn(`Error removing "${key}" from localStorage:`, e);
    }
};
