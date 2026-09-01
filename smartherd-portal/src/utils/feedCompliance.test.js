import { describe, it, expect } from 'vitest';
import { checkTodayFeedComplete } from './feedCompliance';

describe('checkTodayFeedComplete utility', () => {
    const todayStr = '2026-09-01';

    const sampleAnimals = [
        { id: 'BA-001', pen: 'A', status: 'Active' },
        { id: 'BA-002', pen: 'A', status: 'Active' },
        { id: 'BA-003', pen: 'B', status: 'Active' },
        { id: 'BA-004', pen: 'C', status: 'Sold' }, // Sold should be ignored
        { id: 'BA-005', pen: 'D', status: 'Deceased' } // Deceased should be ignored
    ];

    it('returns false when no feed logs exist for today', () => {
        const feedLogs = [
            { id: 1, date: '2026-08-31', pen: 'A', feedingIndex: 0, feedingPct: 100 }
        ];
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'ALL')).toBe(false);
    });

    it('returns false when only some active pens have been fed', () => {
        const feedLogs = [
            { id: 1, date: todayStr, pen: 'A', feedingIndex: 0, feedingPct: 100 }
            // Pen B is missing
        ];
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'ALL')).toBe(false);
    });

    it('returns true when all active pens have full day logs (feedingIndex = 0)', () => {
        const feedLogs = [
            { id: 1, date: todayStr, pen: 'A', feedingIndex: 0, feedingPct: 100 },
            { id: 2, date: todayStr, pen: 'B', feedingIndex: 0, feedingPct: 100 }
        ];
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'ALL')).toBe(true);
    });

    it('returns false when a split feeding is only half logged (e.g. morning done, evening missing)', () => {
        const feedLogs = [
            { id: 1, date: todayStr, pen: 'A', numFeedings: 2, feedingIndex: 1, feedingPct: 50 },
            { id: 2, date: todayStr, pen: 'B', feedingIndex: 0, feedingPct: 100 }
        ];
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'ALL')).toBe(false);
    });

    it('returns true when all sessions of split feedings are logged across all active pens', () => {
        const feedLogs = [
            { id: 1, date: todayStr, pen: 'A', numFeedings: 2, feedingIndex: 1, feedingPct: 50 },
            { id: 2, date: todayStr, pen: 'A', numFeedings: 2, feedingIndex: 2, feedingPct: 50 },
            { id: 3, date: todayStr, pen: 'B', numFeedings: 3, feedingIndex: 1, feedingPct: 33.3 },
            { id: 4, date: todayStr, pen: 'B', numFeedings: 3, feedingIndex: 2, feedingPct: 33.3 },
            { id: 5, date: todayStr, pen: 'B', numFeedings: 3, feedingIndex: 3, feedingPct: 33.4 }
        ];
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'ALL')).toBe(true);
    });

    it('evaluates pen-specific completion when compliancePenFilter is specified', () => {
        const feedLogs = [
            { id: 1, date: todayStr, pen: 'A', feedingIndex: 0, feedingPct: 100 }
            // Pen B is not logged
        ];
        // Farm overall is incomplete
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'ALL')).toBe(false);
        // Pen A is complete
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'A')).toBe(true);
        // Pen B is incomplete
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'B')).toBe(false);
    });

    it('handles farm-wide ALL pen log correctly', () => {
        const feedLogs = [
            { id: 1, date: todayStr, pen: 'ALL', feedingIndex: 0, feedingPct: 100 }
        ];
        expect(checkTodayFeedComplete(sampleAnimals, feedLogs, todayStr, 'ALL')).toBe(true);
    });

    it('handles empty active animal list by checking if any feed log exists for today', () => {
        const emptyAnimals = [];
        const logsWithToday = [{ id: 1, date: todayStr, pen: 'A', feedingIndex: 0 }];
        const logsWithoutToday = [{ id: 1, date: '2026-08-31', pen: 'A', feedingIndex: 0 }];

        expect(checkTodayFeedComplete(emptyAnimals, logsWithToday, todayStr, 'ALL')).toBe(true);
        expect(checkTodayFeedComplete(emptyAnimals, logsWithoutToday, todayStr, 'ALL')).toBe(false);
    });
});
