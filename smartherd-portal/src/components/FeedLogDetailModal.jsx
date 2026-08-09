import React, { useContext } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

export default function FeedLogDetailModal({ feedLog, onClose }) {
    const { feedStockItems, staffUser } = useContext(FarmContext);
    if (!feedLog) return null;

    const isSuperAdmin = staffUser?.isAdmin === true;

    const parseFeedingSession = (log) => {
        if (!log) return 'Full Day (100%)';
        const total = log.numFeedings || 1;
        const pct = log.feedingPct !== undefined && log.feedingPct !== null ? Math.round(log.feedingPct) : (total > 1 ? Math.round(100 / total) : 100);

        let rawIdx = log.feedingIndex;
        if (rawIdx === undefined || rawIdx === null || rawIdx === 0) {
            if (total <= 1) return `Full Day (${pct}%)`;
            return `Morning (${pct}%)`;
        }

        let idx = rawIdx;
        if (rawIdx >= 1) {
            idx = rawIdx - 1;
        }

        if (total <= 1) return `Full Day (${pct}%)`;

        let name = '';
        if (total === 2) {
            name = idx === 0 ? 'Morning' : 'Evening';
        } else if (total === 3) {
            name = idx === 0 ? 'Morning' : idx === 1 ? 'Afternoon' : 'Evening';
        } else {
            name = `Feeding ${idx + 1} of ${total}`;
        }
        return `${name} (${pct}%)`;
    };

    const getItemName = (ingId) => {
        const found = (feedStockItems || []).find(i => i.id === ingId || i.derivedFromIngredientId === ingId);
        return found ? found.name : ingId;
    };

    return createPortal(
        <div
            className="portal-modal-overlay"
            onClick={onClose}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0, 0, 0, 0.78)', backdropFilter: 'blur(5px)',
                zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
            }}
        >
            <div
                className="glass-panel animate-scale-up"
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: '820px', maxHeight: '92vh', overflowY: 'auto',
                    border: '1px solid rgba(255, 255, 255, 0.15)', boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                    background: 'var(--panel-bg, #121824)', borderRadius: '14px', padding: '1.8rem'
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.2rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
                    <div>
                        <h3 className="panel-title" style={{ fontSize: '1.35rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <i className="fa-solid fa-wheat-awn" style={{ color: 'var(--accent-gold)' }}></i>
                            Feed Log Breakdown — {feedLog.pen === 'ALL' ? 'All Pens' : `Pen ${feedLog.pen}`}
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', margin: 0 }}>
                            Logged for <strong>{formatDate(feedLog.date)}</strong>
                            {feedLog.createdAt && (
                                <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }}>
                                    (Action performed on {new Date(feedLog.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})
                                </span>
                            )}
                            {feedLog.createdBy && (
                                <span> by <strong style={{ color: 'var(--accent-gold)' }}>{feedLog.createdBy}</strong></span>
                            )}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={onClose}
                        style={{ fontSize: '1.1rem', padding: '0.15rem 0.6rem', lineHeight: 1 }}
                    >
                        ✕
                    </button>
                </div>

                {/* Summary Metrics Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.8rem', marginBottom: '1.5rem' }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Session</span>
                        <strong style={{ fontSize: '0.98rem', color: 'var(--accent-gold)' }}>{parseFeedingSession(feedLog)}</strong>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Head Count</span>
                        <strong style={{ fontSize: '0.98rem', color: 'var(--text-pure)' }}>{feedLog.animalCount} animals</strong>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Batch</span>
                        <strong style={{ fontSize: '0.98rem', color: 'var(--primary-green-light)' }}>{(feedLog.totalBatchKg || 0).toFixed(2)} kg</strong>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg Feed / Head</span>
                        <strong style={{ fontSize: '0.98rem', color: 'var(--text-pure)' }}>{((feedLog.totalBatchKg || 0) / (feedLog.animalCount || 1)).toFixed(2)} kg/head</strong>
                    </div>
                    {isSuperAdmin && (
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Cost</span>
                            <strong style={{ fontSize: '0.98rem', color: 'var(--accent-gold)' }}>{Math.round(feedLog.totalCost || 0).toLocaleString()} PKR</strong>
                        </div>
                    )}
                </div>

                {feedLog.notes && (
                    <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.2)', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.2rem', color: 'hsl(43,90%,70%)', fontSize: '0.85rem' }}>
                        <i className="fa-solid fa-note-sticky" style={{ marginRight: '0.5rem' }}></i>
                        <strong>Notes:</strong> {feedLog.notes.replace(/\s*—\s*FEEDING\s*\d+\s*OF\s*\d+\s*\(\d+%\)/gi, '').trim()}
                    </div>
                )}

                {/* Ingredient Ingredients Breakdown Table */}
                <h4 style={{ fontSize: '0.95rem', color: 'var(--text-pure)', marginBottom: '0.7rem' }}>TMR Ingredient Mix Breakdown</h4>
                <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                <th style={{ padding: '0.6rem 0.8rem' }}>Ingredient</th>
                                <th style={{ padding: '0.6rem 0.8rem', textAlign: 'right' }}>Fed DM (kg/head)</th>
                                <th style={{ padding: '0.6rem 0.8rem', textAlign: 'right' }}>Plan DM (kg/head)</th>
                                <th style={{ padding: '0.6rem 0.8rem', textAlign: 'right' }}>Wet Batch (kg)</th>
                                {isSuperAdmin && <th style={{ padding: '0.6rem 0.8rem', textAlign: 'right' }}>Cost (PKR)</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {(feedLog.ingredients || []).map((ing, idx) => {
                                const fedDm = ing.dmTarget || 0;
                                const planned = ing.plannedQtyKg;
                                const differed = planned !== undefined && Math.abs((fedDm || 0) - planned) > 0.0005;
                                return (
                                    <tr key={ing.id || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <td style={{ padding: '0.6rem 0.8rem', color: 'var(--text-pure)', fontWeight: '600' }}>
                                            {getItemName(ing.id || ing.name)}
                                        </td>
                                        <td style={{ padding: '0.6rem 0.8rem', textAlign: 'right', color: differed ? 'hsl(43,90%,60%)' : 'var(--text-main)' }}>
                                            {fedDm.toFixed(2)} kg
                                        </td>
                                        <td style={{ padding: '0.6rem 0.8rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                                            {planned !== undefined ? `${planned.toFixed(2)} kg` : '—'}
                                        </td>
                                        <td style={{ padding: '0.6rem 0.8rem', textAlign: 'right', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                            {(ing.wetBatch || 0).toFixed(2)} kg
                                        </td>
                                        {isSuperAdmin && (
                                            <td style={{ padding: '0.6rem 0.8rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                                                {Math.round(ing.cost || 0).toLocaleString()}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onClose}
                        style={{ padding: '0.4rem 1.2rem' }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
