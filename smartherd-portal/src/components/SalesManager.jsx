import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

export default function SalesManager() {
    const { orders, updateOrderStatus, deleteOrder, animals } = useContext(FarmContext);
    const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'live' | 'cuts'
    const [searchQuery, setSearchQuery] = useState('');

    // --- Dynamic KPI Calculations ---
    const totalOrdersCount = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.netTotal || 0), 0);
    
    // Count active live animal bookings
    const activeLiveBookings = orders.filter(o => 
        o.hasLive && o.status !== 'Delivered'
    ).length;

    // Count chilled cuts dispatch queue
    const activeCutsQueue = orders.filter(o => 
        !o.hasLive && o.status !== 'Delivered'
    ).length;

    // Filtered orders list
    const filteredOrders = orders.filter(order => {
        // Status filter (Category division)
        if (statusFilter === 'live' && !order.hasLive) return false;
        if (statusFilter === 'cuts' && order.hasLive) return false;

        // Search text filter — fields guarded with `|| ''` since older/imported
        // order records aren't guaranteed to have every field populated, and a
        // missing field would otherwise throw on .toLowerCase() and crash this tab.
        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            const refMatch = (order.id || '').toLowerCase().includes(query);
            const nameMatch = (order.customerName || '').toLowerCase().includes(query);
            const phoneMatch = (order.customerPhone || '').includes(query);
            const cityMatch = (order.customerCity || '').toLowerCase().includes(query);
            return refMatch || nameMatch || phoneMatch || cityMatch;
        }

        return true;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    // Get color badge class for dispatch status
    const getStatusClass = (status) => {
        switch (status) {
            case 'Confirmed':
                return 'badge-status quarantined'; // orange-yellow
            case 'Pre-Slaughter Care':
            case 'Pre-cooling Reefer':
                return 'badge-status sick'; // reddish-orange
            case 'Slaughtered':
            case 'Cargo Loaded':
            case 'Loaded for Transit':
                return 'badge-status active'; // blue
            case 'In Route':
                return 'badge-status fattening'; // green-cyan
            case 'Arrived at Holding Pens':
            case 'Arrived at Regional Hub':
                return 'badge-status transit'; // purple/indigo
            case 'Delivered':
                return 'badge-status active'; // green
            default:
                return 'badge-status quarantined';
        }
    };

    // Get specific status options for an order type
    const getStatusOptions = (order) => {
        if (order.hasLive) {
            if (order.qurbaniService === 'OnFarmSlaughter') {
                return [
                    'Confirmed',
                    'Pre-Slaughter Care',
                    'Slaughtered',
                    'Loaded for Transit',
                    'In Route',
                    'Delivered'
                ];
            } else {
                return [
                    'Confirmed',
                    'Loaded for Transit',
                    'In Route',
                    'Arrived at Holding Pens',
                    'Delivered'
                ];
            }
        } else {
            return [
                'Confirmed',
                'Pre-cooling Reefer',
                'Cargo Loaded',
                'In Route',
                'Arrived at Regional Hub',
                'Delivered'
            ];
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, minHeight: 0 }}>
            
            {/* Top KPIs stat section */}
            <div className="dashboard-grid">
                
                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Direct E-Commerce Sales</h3>
                        <div className="stat-icon"><i className="fa-solid fa-cart-shopping"></i></div>
                    </div>
                    <div className="stat-val">
                        PKR {totalRevenue.toLocaleString()}
                    </div>
                    <span className="stat-lbl"><i className="fa-solid fa-receipt"></i> {totalOrdersCount} orders received</span>
                </div>

                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Active Qurbani Bookings</h3>
                        <div className="stat-icon"><i className="fa-solid fa-cow"></i></div>
                    </div>
                    <div className="stat-val" style={{ color: 'var(--accent-gold)' }}>
                        {activeLiveBookings} <small style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Livestock</small>
                    </div>
                    <span className="stat-lbl">Advance booking deposits active</span>
                </div>

                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Chilled Reefer Queue</h3>
                        <div className="stat-icon"><i className="fa-solid fa-snowflake"></i></div>
                    </div>
                    <div className="stat-val" style={{ color: 'var(--primary-green-light)' }}>
                        {activeCutsQueue} <small style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Orders</small>
                    </div>
                    <span className="stat-lbl">Standard cold-chain deliveries</span>
                </div>

            </div>

            {/* List and table manager */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                
                <div className="table-filters" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                    
                    <div className="filter-buttons-group" style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className={`btn ${statusFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('all')} style={{ minHeight: '36px', fontSize: '0.85rem' }}>
                            All Bookings
                        </button>
                        <button className={`btn ${statusFilter === 'live' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('live')} style={{ minHeight: '36px', fontSize: '0.85rem' }}>
                            Live Qurbani
                        </button>
                        <button className={`btn ${statusFilter === 'cuts' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('cuts')} style={{ minHeight: '36px', fontSize: '0.85rem' }}>
                            Gourmet Cuts
                        </button>
                    </div>

                    <div className="search-field" style={{ position: 'relative', width: '300px' }}>
                        <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.85rem' }}></i>
                        <input 
                            type="text" 
                            className="form-control" 
                            placeholder="Search Ref, Customer, Phone..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ paddingLeft: '2.2rem', minHeight: '36px', fontSize: '0.85rem', width: '100%', margin: 0 }}
                        />
                    </div>

                </div>

                <div className="table-wrapper" style={{ overflowY: 'auto', flex: 1 }}>
                    {filteredOrders.length === 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
                            <i className="fa-solid fa-box-open" style={{ fontSize: '3rem', marginBottom: '1rem', color: 'rgba(255,255,255,0.05)' }}></i>
                            <h3>No bookings matched</h3>
                            <p style={{ fontSize: '0.85rem' }}>E-commerce orders or bookings will appear here once checked out.</p>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Ref / Date</th>
                                    <th>Recipient / Contact</th>
                                    <th>Destination City</th>
                                    <th>Cart Items</th>
                                    <th>Total & Deposit</th>
                                    <th>Dispatch Status Console</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredOrders.map(order => {
                                    return (
                                        <tr key={order.id}>
                                            <td>
                                                <strong style={{ color: order.hasLive ? 'var(--accent-gold)' : 'var(--text-pure)' }}>{order.id}</strong>
                                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                    {formatDate(order.date)}
                                                </span>
                                            </td>
                                            <td>
                                                <strong>{order.customerName}</strong>
                                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                    <i className="fa-solid fa-phone" style={{ fontSize: '0.7rem', marginRight: '3px' }}></i> {order.customerPhone}
                                                </span>
                                                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '240px' }} title={order.customerAddress}>
                                                    {order.customerAddress}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="badge-pen" style={{ background: 'rgba(255,193,7,0.05)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.1)' }}>
                                                    {order.customerCity}
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                                    {order.items && order.items.map((item, idx) => (
                                                        <div key={idx} style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            {order.hasLive ? (
                                                                <i className="fa-solid fa-cow" style={{ color: 'var(--accent-gold)', fontSize: '0.75rem' }}></i>
                                                            ) : (
                                                                <i className="fa-solid fa-ribbon" style={{ color: 'var(--primary-green-light)', fontSize: '0.75rem' }}></i>
                                                            )}
                                                            <span>
                                                                {item.title} (x{item.quantity})
                                                            </span>
                                                            <span style={{ fontSize: '0.7rem', color: 'var(--accent-gold)', background: 'rgba(0,0,0,0.3)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>
                                                                {item.rfid}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                            <td>
                                                <strong style={{ color: 'var(--text-pure)' }}>PKR {order.netTotal.toLocaleString()}</strong>
                                                {order.hasLive ? (
                                                    <div style={{ display: 'block', fontSize: '0.72rem', color: 'var(--accent-gold)', marginTop: '0.2rem' }}>
                                                        <span>Booking Adv (50%): </span>
                                                        <strong>PKR {(order.netTotal * 0.5).toLocaleString()}</strong>
                                                    </div>
                                                ) : (
                                                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--primary-green-light)', marginTop: '0.2rem' }}>
                                                        100% Paid (Card/COD)
                                                    </span>
                                                )}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                    <span className={getStatusClass(order.status)}>
                                                        {order.status}
                                                    </span>

                                                    <select
                                                        value={order.status}
                                                        onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                                                        className="form-control"
                                                        style={{ minHeight: '28px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', width: 'auto', margin: 0, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                                                    >
                                                        {getStatusOptions(order).map(opt => (
                                                            <option key={opt} value={opt}>{opt}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </td>
                                            <td>
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm(`Delete order ${order.id}? This cannot be undone.`)) {
                                                            deleteOrder(order.id);
                                                        }
                                                    }}
                                                    style={{ background: 'rgba(220,53,69,0.12)', border: '1px solid rgba(220,53,69,0.25)', color: '#e05260', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1 }}
                                                    title="Delete order"
                                                >
                                                    <i className="fa-solid fa-trash-can"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
