import { describe, it, expect } from 'vitest';
import { parseDateOnly, daysBetween } from './dateOnly';

// Pure implementation mirroring getPenRosterAsOf in FarmContext.jsx
function getPenRosterAsOf(animals, events, penId, refDate) {
    return animals.filter(animal => {
        if (animal.entryDate && parseDateOnly(animal.entryDate) > refDate) return false;

        if (animal.status === 'Sold' || animal.status === 'Deceased') {
            const exitEvent = events.find(e => e.animalId === animal.id
                && (e.eventType === 'sold' || e.eventType === 'deceased'));
            if (!exitEvent || parseDateOnly(exitEvent.date) <= refDate) return false;
        }

        const allPenEvents = events
            .filter(e => e.animalId === animal.id
                && (e.eventType === 'registered' || e.eventType === 'pen_transfer')
                && (e.toPen || e.fromPen))
            .sort((a, b) => daysBetween(parseDateOnly(a.date), parseDateOnly(b.date)) || (a.id - b.id));

        const pastOrPresentEvents = allPenEvents.filter(e => e.toPen && parseDateOnly(e.date) <= refDate);

        let effectivePen;
        if (pastOrPresentEvents.length > 0) {
            effectivePen = pastOrPresentEvents[pastOrPresentEvents.length - 1].toPen;
        } else if (allPenEvents.length > 0 && allPenEvents[0].fromPen) {
            effectivePen = allPenEvents[0].fromPen;
        } else {
            effectivePen = animal.pen;
        }
        return effectivePen === penId;
    });
}

describe('getPenRosterAsOf historical pen resolution', () => {
    const animalMoved = {
        id: 101,
        entryDate: '2026-08-02',
        pen: 'F', // Currently in Pen F
        status: 'Active'
    };

    const events = [
        {
            id: 1,
            animalId: 101,
            date: '2026-09-01',
            eventType: 'pen_transfer',
            fromPen: 'A',
            toPen: 'F'
        }
    ];

    it('places the animal in Pen A prior to pen transfer date', () => {
        const refDate = parseDateOnly('2026-08-15');
        const rosterPenA = getPenRosterAsOf([animalMoved], events, 'A', refDate);
        const rosterPenF = getPenRosterAsOf([animalMoved], events, 'F', refDate);

        expect(rosterPenA.map(a => a.id)).toContain(101);
        expect(rosterPenF.map(a => a.id)).not.toContain(101);
    });

    it('places the animal in Pen F on or after pen transfer date', () => {
        const refDate = parseDateOnly('2026-09-02');
        const rosterPenA = getPenRosterAsOf([animalMoved], events, 'A', refDate);
        const rosterPenF = getPenRosterAsOf([animalMoved], events, 'F', refDate);

        expect(rosterPenA.map(a => a.id)).not.toContain(101);
        expect(rosterPenF.map(a => a.id)).toContain(101);
    });

    it('resolves empty pen correctly when animals are transferred out', () => {
        const herd = [
            { id: 1, pen: 'A', status: 'Active', entryDate: '2026-08-01' },
            { id: 2, pen: 'A', status: 'Active', entryDate: '2026-08-01' },
            { id: 3, pen: 'C', status: 'Active', entryDate: '2026-08-01' },
            { id: 4, pen: 'D', status: 'Active', entryDate: '2026-08-01' },
            { id: 5, pen: 'D', status: 'Active', entryDate: '2026-08-01' },
            { id: 6, pen: 'B', status: 'Active', entryDate: '2026-08-01' }
        ];
        const transferEvents = [
            { id: 10, animalId: 1, date: '2026-09-05', eventType: 'pen_transfer', fromPen: 'F', toPen: 'A' },
            { id: 11, animalId: 2, date: '2026-09-05', eventType: 'pen_transfer', fromPen: 'F', toPen: 'A' },
            { id: 12, animalId: 3, date: '2026-09-05', eventType: 'pen_transfer', fromPen: 'F', toPen: 'C' },
            { id: 13, animalId: 4, date: '2026-09-05', eventType: 'pen_transfer', fromPen: 'F', toPen: 'D' },
            { id: 14, animalId: 5, date: '2026-09-05', eventType: 'pen_transfer', fromPen: 'F', toPen: 'D' }
        ];
        const refDate = parseDateOnly('2026-09-05');
        const rosterF = getPenRosterAsOf(herd, transferEvents, 'F', refDate);
        const rosterA = getPenRosterAsOf(herd, transferEvents, 'A', refDate);
        const rosterC = getPenRosterAsOf(herd, transferEvents, 'C', refDate);
        const rosterD = getPenRosterAsOf(herd, transferEvents, 'D', refDate);
        const rosterB = getPenRosterAsOf(herd, transferEvents, 'B', refDate);

        expect(rosterF.length).toBe(0);
        expect(rosterA.length).toBe(2);
        expect(rosterC.length).toBe(1);
        expect(rosterD.length).toBe(2);
        expect(rosterB.length).toBe(1);

        const totalResolved = rosterF.length + rosterA.length + rosterC.length + rosterD.length + rosterB.length;
        expect(totalResolved).toBe(herd.length); // 6, not 6 + 5 = 11
    });
});

