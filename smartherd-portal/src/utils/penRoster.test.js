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

    it('does not place animal in any pen before its entryDate', () => {
        const refDate = parseDateOnly('2026-08-01');
        const rosterPenA = getPenRosterAsOf([animalMoved], events, 'A', refDate);
        const rosterPenF = getPenRosterAsOf([animalMoved], events, 'F', refDate);

        expect(rosterPenA.map(a => a.id)).not.toContain(101);
        expect(rosterPenF.map(a => a.id)).not.toContain(101);
    });
});
