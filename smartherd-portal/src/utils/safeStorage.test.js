import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    safeGetItem,
    safeSetItem,
    safeRemoveItem,
    isQuotaError,
    clearDispensableCaches,
    pruneFailedMutations,
    sanitizeFailedMutation,
    DISPENSABLE_CACHE_KEYS
} from './safeStorage';

describe('safeStorage', () => {
    let mockStore = {};

    beforeEach(() => {
        mockStore = {};
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key) => mockStore[key] ?? null),
            setItem: vi.fn((key, val) => {
                mockStore[key] = String(val);
            }),
            removeItem: vi.fn((key) => {
                delete mockStore[key];
            }),
            clear: vi.fn(() => {
                mockStore = {};
            })
        });
    });

    it('safely stores and retrieves JSON objects', () => {
        const data = { foo: 'bar', num: 42 };
        expect(safeSetItem('test_key', data)).toBe(true);
        expect(safeGetItem('test_key')).toEqual(data);
    });

    it('returns default value if key does not exist or fails', () => {
        expect(safeGetItem('non_existent', [])).toEqual([]);
    });

    it('identifies quota exceeded errors', () => {
        const domException = new Error("Failed to execute 'setItem' on 'Storage': Setting the value of 'ba_failed_mutations' exceeded the quota.");
        domException.name = 'QuotaExceededError';
        expect(isQuotaError(domException)).toBe(true);

        const customError = new Error('Quota reached');
        expect(isQuotaError(customError)).toBe(true);

        const normalError = new Error('Random failure');
        expect(isQuotaError(normalError)).toBe(false);
    });

    it('clears dispensable caches to free storage', () => {
        mockStore['ba_feed_logs'] = 'huge_logs';
        mockStore['ba_weights'] = 'huge_weights';
        mockStore['ba_staff_user'] = 'user_info';
        mockStore['ba_pending_mutations'] = 'queued_data';

        clearDispensableCaches();

        expect(mockStore['ba_feed_logs']).toBeUndefined();
        expect(mockStore['ba_weights']).toBeUndefined();
        // Critical data preserved
        expect(mockStore['ba_staff_user']).toBe('user_info');
        expect(mockStore['ba_pending_mutations']).toBe('queued_data');
    });

    it('automatically recovers from QuotaExceededError by clearing caches and retrying', () => {
        mockStore['ba_feed_logs'] = 'big_logs';
        mockStore['ba_weights'] = 'big_weights';

        let hasThrown = false;
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key) => mockStore[key] ?? null),
            setItem: vi.fn((key, val) => {
                if (!hasThrown && key === 'ba_failed_mutations') {
                    hasThrown = true;
                    const err = new Error("Setting the value of 'ba_failed_mutations' exceeded the quota.");
                    err.name = 'QuotaExceededError';
                    throw err;
                }
                mockStore[key] = String(val);
            }),
            removeItem: vi.fn((key) => {
                delete mockStore[key];
            })
        });

        const success = safeSetItem('ba_failed_mutations', [{ id: '1', action: 'TEST' }]);
        expect(success).toBe(true);
        expect(mockStore['ba_feed_logs']).toBeUndefined();
        expect(mockStore['ba_weights']).toBeUndefined();
        expect(mockStore['ba_failed_mutations']).toContain('TEST');
    });

    it('never throws even if storage remains completely full', () => {
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(),
            setItem: vi.fn(() => {
                const err = new Error('Storage quota exceeded');
                err.name = 'QuotaExceededError';
                throw err;
            }),
            removeItem: vi.fn()
        });

        expect(() => {
            const res = safeSetItem('any_key', { data: 'test' });
            expect(res).toBe(false);
        }).not.toThrow();
    });

    it('prunes and sanitizes failed mutations', () => {
        const largePayload = {
            name: 'Cow 1',
            photo: 'data:image/jpeg;base64,' + 'A'.repeat(2000),
            items: new Array(50).fill('sub_item')
        };
        const items = Array.from({ length: 30 }, (_, i) => ({
            id: `item-${i}`,
            action: 'ADD_ANIMAL',
            payload: largePayload,
            error: 'Server Error'
        }));

        const pruned = pruneFailedMutations(items, 10);
        expect(pruned.length).toBe(10);
        expect(pruned[pruned.length - 1].id).toBe('item-29');
        // Check payload truncation
        expect(pruned[0].payload.photo).toContain('[truncated]');
        expect(pruned[0].payload.photo.length).toBeLessThan(200);
        expect(pruned[0].payload.items.length).toBeLessThanOrEqual(20);
    });
});
