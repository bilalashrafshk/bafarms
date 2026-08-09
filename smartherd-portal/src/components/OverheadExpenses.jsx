import React, { useContext, useState, useMemo } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, daysBetween } from '../utils/dateOnly';

// Operating overhead ledger — salaries, electricity, rent, fuel, maintenance, etc.
// Separate from the feed/medicine stock system: these are pure dated expenses with no
// quantity/FIFO costing. Feeds the Cost of Gain report as a per-day-in-herd shared cost
// (total overhead in a range / total head-days in that range, same head-days concept
// FeedGrowthReport already uses for feed).
const CATEGORIES = ['Salary', 'Electricity', 'Rent', 'Fuel', 'Maintenance', 'Water', 'Transport', 'Other'];

export default function OverheadExpenses() {
    const { staffUser, overheadExpenses, addOverheadExpense, deleteOverheadExpense, myRequests } = useContext(FarmContext);

    // Same Herd Access gate as Feed Stock/other cost-bearing herd records.
    const isAdmin = staffUser?.accessHerd === true || staffUser?.isAdmin === true;
    const isSuperAdmin = staffUser?.isAdmin === true;

    // Maps expense id -> its still-open approval request, so a non-admin who just
    // added/deleted an expense sees it reflected in the ledger right away instead of
    // it silently disappearing into a queue — the row shows "Pending Approval"
    // instead of vanishing until a Super Admin signs off.
    const pendingById = useMemo(() => {
        const map = {};
        (myRequests || []).filter(r => r.status === 'pending' && (r.action === 'ADD_OVERHEAD_EXPENSE' || r.action === 'DELETE_OVERHEAD_EXPENSE')).forEach(r => {
            const id = r.payload?.id;
            if (id) map[id] = r.action === 'DELETE_OVERHEAD_EXPENSE' ? 'delete' : 'add';
        });
        return map;
    }, [myRequests]);

    const todayStr = todayPKT();
    const defaultFrom = (() => {
        const d = new Date(todayStr);
        d.setUTCDate(d.getUTCDate() - 29);
        return d.toISOString().split('T')[0];
    })();
    const [dateFrom, setDateFrom] = useState(defaultFrom);
    const [dateTo, setDateTo] = useState(todayStr);
    const [categoryFilter, setCategoryFilter] = useState('');

    const [eDate, setEDate] = useState(todayStr);
    const [eCategory, setECategory] = useState(CATEGORIES[0]);
    const [eDescription, setEDescription] = useState('');
    const [eAmount, setEAmount] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleAddExpense = async (e) => {
        e.preventDefault();
        const amount = parseFloat(eAmount);
        if (!eDate || !eCategory || !amount || amount <= 0) return;
        setSubmitting(true);
        await addOverheadExpense({ date: eDate, category: eCategory, description: eDescription, amount });
        setSubmitting(false);
        setEDescription('');
        setEAmount('');
    };

    const effectiveOverheadExpenses = useMemo(() => {
        const list = [...overheadExpenses];
        (myRequests || []).forEach(r => {
            if (r.status === 'pending' && r.action === 'ADD_OVERHEAD_EXPENSE' && r.payload?.id) {
                if (!list.some(e => e.id === r.payload.id)) {
                    list.push(r.payload);
                }
            }
        });
        return list;
    }, [overheadExpenses, myRequests]);

    const sorted = useMemo(() =>
        [...effectiveOverheadExpenses].sort((a, b) => daysBetween(b.date, a.date)),
        [effectiveOverheadExpenses]
    );

    const filtered = useMemo(() => sorted.filter(exp => {
        if (exp.date < dateFrom || exp.date > dateTo) return false;
        if (categoryFilter && exp.category !== categoryFilter) return false;
        return true;
    }), [sorted, dateFrom, dateTo, categoryFilter]);

    const totalInRange = filtered.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const byCategory = useMemo(() => {
        const map = {};
        filtered.forEach(exp => { map[exp.category] = (map[exp.category] || 0) + (exp.amount || 0); });
        return Object.entries(map).sort((a, b) => b[1] - a[1]);
    }, [filtered]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {!isAdmin && (
                <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)', fontSize: '1.4rem' }}></i>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        Read-only view. Only Herd Access staff can record operating expenses.
                    </span>
                </div>
            )}

            <div style={{ background: 'rgba(74, 144, 217, 0.06)', border: '1px solid rgba(74, 144, 217, 0.18)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                <i class="fa-solid fa-circle-info" style={{ color: '#4a90d9', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                    <strong style={{ color: 'var(--text-pure)' }}>What this is:</strong> a dated ledger of operating costs that aren't feed or medicine — salaries, electricity, rent, fuel, maintenance, etc. These don't attach to a specific animal or pen; the <strong>Cost of Gain Report</strong> spreads the total for a date range across every head-day in that range, the same way feed cost is already allocated.
                </span>
            </div>

            <div class="dashboard-grid">
                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Total Overhead (range)</h3>
                        <div class="stat-icon"><i class="fa-solid fa-receipt"></i></div>
                    </div>
                    <div class="stat-val">{Math.round(totalInRange).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR</small></div>
                    <span class="stat-lbl">Between {dateFrom} and {dateTo}</span>
                </div>
                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>By Category</h3>
                        <div class="stat-icon"><i class="fa-solid fa-chart-pie"></i></div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                        {byCategory.length === 0 && <span style={{ color: 'var(--text-muted)' }}>No expenses in range</span>}
                        {byCategory.slice(0, 4).map(([cat, amt]) => (
                            <div key={cat} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-muted)' }}>{cat}</span>
                                <strong style={{ color: 'var(--text-pure)' }}>{Math.round(amt).toLocaleString()}</strong>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {isAdmin && (
                <div class="glass-panel">
                    <h3 class="panel-title"><i class="fa-solid fa-circle-plus"></i> Record an Expense</h3>
                    <form onSubmit={handleAddExpense} class="form-grid-3" style={{ alignItems: 'flex-end' }}>
                        <div class="form-group">
                            <label>Date</label>
                            <input type="date" class="form-control" value={eDate} max={todayStr} onChange={e => setEDate(e.target.value)} required />
                        </div>
                        <div class="form-group">
                            <label>Category</label>
                            <select class="form-control" value={eCategory} onChange={e => setECategory(e.target.value)} required>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Amount (PKR)</label>
                            <input type="number" step="0.01" min="0" class="form-control" placeholder="e.g. 45000" value={eAmount} onChange={e => setEAmount(e.target.value)} required />
                        </div>
                        <div class="form-group" style={{ gridColumn: '1 / -1' }}>
                            <label>Description</label>
                            <input type="text" class="form-control" placeholder="e.g. August staff salaries" value={eDescription} onChange={e => setEDescription(e.target.value)} />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <button type="submit" class="btn btn-primary" style={{ minHeight: '44px' }} disabled={submitting}>
                                <i class={submitting ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-floppy-disk'}></i> {submitting ? 'Saving…' : 'Save Expense'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div class="glass-panel">
                <div class="form-header-bar" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-clipboard-list"></i> Expense History</h3>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div class="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.75rem' }}>Category</label>
                            <select class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                                <option value="">All</option>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div class="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.75rem' }}>From</label>
                            <input type="date" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)} />
                        </div>
                        <div class="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.75rem' }}>To</label>
                            <input type="date" class="form-control" style={{ minHeight: '36px', height: '36px', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }} value={dateTo} min={dateFrom} max={todayStr} onChange={e => setDateTo(e.target.value)} />
                        </div>
                    </div>
                </div>
                <div class="table-wrapper">
                    <table class="data-table" style={{ fontSize: '0.85rem' }}>
                        <thead>
                            <tr>
                                <th>DATE</th>
                                <th>CATEGORY</th>
                                <th>DESCRIPTION</th>
                                <th>AMOUNT</th>
                                {isAdmin && <th>STATUS</th>}
                                {isAdmin && <th style={{ textAlign: 'center', width: '60px' }}>REMOVE</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(exp => {
                                const pending = pendingById[exp.id];
                                return (
                                <tr key={exp.id} style={pending ? { opacity: 0.6 } : undefined}>
                                    <td>{formatDate(exp.date)}</td>
                                    <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{exp.category}</td>
                                    <td>{exp.description || '—'}</td>
                                    <td><strong style={{ color: 'var(--accent-gold)' }}>{Math.round(exp.amount).toLocaleString()} PKR</strong></td>
                                    {isAdmin && (
                                        <td>
                                            {pending === 'add' && <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', background: 'rgba(255,193,7,0.12)', color: 'hsl(43,90%,53%)' }}><i class="fa-solid fa-hourglass-half"></i> Pending Approval</span>}
                                            {pending === 'delete' && <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', background: 'rgba(220,53,69,0.12)', color: 'hsl(0,75%,65%)' }}><i class="fa-solid fa-hourglass-half"></i> Pending Removal</span>}
                                            {!pending && isSuperAdmin && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Confirmed</span>}
                                        </td>
                                    )}
                                    {isAdmin && (
                                        <td style={{ textAlign: 'center' }}>
                                            {!pending && (
                                                <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => deleteOverheadExpense(exp.id)}>
                                                    <i class="fa-solid fa-trash-can"></i>
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                                );
                            })}
                            {filtered.length === 0 && (
                                <tr><td colSpan={isAdmin ? 5 : 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>No expenses recorded in this range.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
