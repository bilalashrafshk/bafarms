// FIFO (first-in, first-out) costing for feed stock. Replaces pricing every issue at
// one all-time blended average across every purchase ever made for an item — which lets
// a price spike on today's purchase retroactively reprice stock bought weeks ago, and
// (worse) blends the cost of unrelated purchases together even when a single premix
// batch is really only drawing from one of them. FIFO instead tracks each purchase as
// its own "lot" and consumes the oldest one with stock left first, same as how the feed
// physically comes off the pile — so cost always traces back to an actual invoice.

// Builds the ordered list of stock lots for one item: the opening balance (if any),
// followed by every dated purchase, oldest first. Ties on the same date are broken by
// id (purchase ids embed a millisecond creation timestamp, e.g. `fp-<Date.now()>-xxxx`),
// so same-day purchases still resolve to a stable, real creation order.
export function buildLots(itemId, opening, purchases) {
    const lots = [];
    if (opening && opening.qty > 0) {
        lots.push({
            id: 'opening',
            date: '0000-01-01',
            supplier: 'Opening stock',
            qty: opening.qty,
            rate: opening.qty > 0 ? opening.value / opening.qty : 0,
            remaining: opening.qty
        });
    }
    purchases
        .filter(p => p.itemId === itemId)
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)))
        .forEach(p => lots.push({
            id: p.id,
            date: p.date,
            supplier: p.supplier,
            qty: p.quantity,
            rate: p.rate,
            remaining: p.quantity
        }));
    return lots;
}

// Draws `qty` kg out of `lots` (mutating each lot's `.remaining` in place). Draws from
// `pinnedLotId` first if given (an explicit lot chosen via a lot picker), then FIFO
// (oldest lot with stock left) for whatever that lot couldn't cover. If total stock
// across every lot is less than `qty` (an over-issue), the shortfall is drawn from the
// most recent lot at its rate and allowed to go negative — consistent with closing
// stock already going negative elsewhere when issues exceed what's on hand, and more
// honest than silently costing the shortfall at zero.
//
// Edge case: if the item has NO lots at all yet (no opening stock, no purchases —
// e.g. a premix consumed in a TMR log before its first production batch was ever
// run), there's nothing to draw from or price against, so `unpriced: true` is
// returned alongside a $0 cost/rate — callers should surface this rather than let a
// $0-priced issue quietly understate cost.
export function allocateFifo(lots, qty, pinnedLotId) {
    let need = qty;
    const breakdown = [];
    const take = (lot, allowNegative) => {
        if (need <= 0) return;
        if (!allowNegative && lot.remaining <= 0) return;
        const amt = allowNegative ? need : Math.min(lot.remaining, need);
        lot.remaining -= amt;
        need -= amt;
        if (amt > 0) breakdown.push({ lotId: lot.id, date: lot.date, supplier: lot.supplier, rate: lot.rate, qty: amt });
    };

    if (pinnedLotId) {
        const pinned = lots.find(l => l.id === pinnedLotId);
        if (pinned) take(pinned, false);
    }
    for (const lot of lots) {
        if (need <= 0) break;
        if (pinnedLotId && lot.id === pinnedLotId) continue;
        take(lot, false);
    }
    if (need > 0 && lots.length > 0) {
        take(lots[lots.length - 1], true);
    }

    const cost = breakdown.reduce((sum, b) => sum + b.qty * b.rate, 0);
    const unpriced = qty > 0 && lots.length === 0;
    return { breakdown, cost, rate: qty > 0 ? cost / qty : 0, unpriced };
}
