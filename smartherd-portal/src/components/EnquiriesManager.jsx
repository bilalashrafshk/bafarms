import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';

export default function EnquiriesManager() {
    const { enquiries, updateEnquiryStatus, deleteEnquiry } = useContext(FarmContext);
    const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'New' | 'Contacted' | 'Closed'
    const [searchQuery, setSearchQuery] = useState('');

    // --- Dynamic KPI Calculations ---
    const totalCount = enquiries.length;
    const newCount = enquiries.filter(e => e.status === 'New').length;
    const contactedCount = enquiries.filter(e => e.status === 'Contacted').length;
    const closedCount = enquiries.filter(e => e.status === 'Closed').length;

    // Filtered enquiries list
    const filteredEnquiries = enquiries.filter(enq => {
        // Status filter
        if (statusFilter !== 'all' && enq.status !== statusFilter) return false;

        // Search text filter
        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            const refMatch = enq.id.toLowerCase().includes(query);
            const companyMatch = enq.company.toLowerCase().includes(query);
            const contactMatch = enq.contact.toLowerCase().includes(query);
            const emailMatch = enq.email.toLowerCase().includes(query);
            const phoneMatch = enq.phone.includes(query);
            const countryMatch = enq.country.toLowerCase().includes(query);
            const cutMatch = enq.cutType.toLowerCase().includes(query);
            return refMatch || companyMatch || contactMatch || emailMatch || phoneMatch || countryMatch || cutMatch;
        }

        return true;
    }).sort((a, b) => b.id.localeCompare(a.id)); // Sort by newest reference code

    // Get color badge class for B2B status
    const getStatusClass = (status) => {
        switch (status) {
            case 'New':
                return 'badge-status quarantined'; // orange
            case 'Contacted':
                return 'badge-status active'; // blue
            case 'Closed':
                return 'badge-status fattening'; // green
            default:
                return 'badge-status quarantined';
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, minHeight: 0 }}>
            
            {/* Top KPIs stat section */}
            <div className="dashboard-grid">
                
                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Total B2B Enquiries</h3>
                        <div className="stat-icon"><i className="fa-solid fa-envelope-open-text"></i></div>
                    </div>
                    <div className="stat-val">
                        {totalCount} <small style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Leads</small>
                    </div>
                    <span className="stat-lbl"><i className="fa-solid fa-globe"></i> Global B2B leads directory</span>
                </div>

                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>New Leads</h3>
                        <div className="stat-icon"><i className="fa-solid fa-bell animate-pulse"></i></div>
                    </div>
                    <div className="stat-val" style={{ color: 'var(--accent-gold)' }}>
                        {newCount} <small style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Unprocessed</small>
                    </div>
                    <span className="stat-lbl">Awaiting initial staff contact</span>
                </div>

                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Active/Closed Pipeline</h3>
                        <div className="stat-icon"><i className="fa-solid fa-handshake"></i></div>
                    </div>
                    <div className="stat-val" style={{ color: 'var(--primary-green-light)' }}>
                        {contactedCount + closedCount} <small style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Negotiated</small>
                    </div>
                    <span className="stat-lbl">Contacted: {contactedCount} | Closed: {closedCount}</span>
                </div>

            </div>

            {/* List and table manager */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                
                <div className="table-filters" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                    
                    <div className="filter-buttons-group" style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className={`btn ${statusFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('all')} style={{ minHeight: '36px', fontSize: '0.85rem' }}>
                            All Leads
                        </button>
                        <button className={`btn ${statusFilter === 'New' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('New')} style={{ minHeight: '36px', fontSize: '0.85rem' }}>
                            New ({newCount})
                        </button>
                        <button className={`btn ${statusFilter === 'Contacted' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('Contacted')} style={{ minHeight: '36px', fontSize: '0.85rem' }}>
                            Contacted ({contactedCount})
                        </button>
                        <button className={`btn ${statusFilter === 'Closed' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter('Closed')} style={{ minHeight: '36px', fontSize: '0.85rem' }}>
                            Closed ({closedCount})
                        </button>
                    </div>

                    <div className="search-field" style={{ position: 'relative', width: '300px' }}>
                        <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.85rem' }}></i>
                        <input 
                            type="text" 
                            className="form-control" 
                            placeholder="Search Ref, Company, Country..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ paddingLeft: '2.2rem', minHeight: '36px', fontSize: '0.85rem', width: '100%', margin: 0 }}
                        />
                    </div>

                </div>

                <div className="table-wrapper" style={{ overflowY: 'auto', flex: 1 }}>
                    {filteredEnquiries.length === 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
                            <i className="fa-solid fa-envelope-open" style={{ fontSize: '3rem', marginBottom: '1rem', color: 'rgba(255,255,255,0.05)' }}></i>
                            <h3>No enquiries matched</h3>
                            <p style={{ fontSize: '0.85rem' }}>Leads from BA Foods B2B export form will appear here.</p>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Ref / Date</th>
                                    <th>Company & Contact</th>
                                    <th>Region</th>
                                    <th>Requested Spec</th>
                                    <th>Vol & Freq</th>
                                    <th>Status Console</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEnquiries.map(enq => {
                                    return (
                                        <tr key={enq.id}>
                                            <td>
                                                <strong style={{ color: 'var(--accent-gold)' }}>{enq.id}</strong>
                                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                    {enq.createdAt}
                                                </span>
                                            </td>
                                            <td>
                                                <strong>{enq.company}</strong>
                                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                    <i className="fa-solid fa-user" style={{ fontSize: '0.7rem', marginRight: '3px' }}></i> {enq.contact}
                                                </span>
                                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    <i className="fa-solid fa-envelope" style={{ fontSize: '0.7rem', marginRight: '3px' }}></i> {enq.email}
                                                </span>
                                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    <i className="fa-solid fa-phone" style={{ fontSize: '0.7rem', marginRight: '3px' }}></i> {enq.phone}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="badge-pen" style={{ background: 'rgba(255,193,7,0.05)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.1)' }}>
                                                    <i className="fa-solid fa-earth-americas" style={{ marginRight: '4px' }}></i> {enq.country}
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ fontSize: '0.85rem', fontWeight: '600' }}>
                                                    {enq.cutType}
                                                </div>
                                                {enq.notes && (
                                                    <div style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem', maxWidth: '250px', whiteSpace: 'normal' }}>
                                                        <strong>Reqs:</strong> {enq.notes}
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <strong style={{ color: 'var(--text-pure)' }}>{enq.volumeMt} MT</strong>
                                                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--primary-green-light)', marginTop: '0.2rem' }}>
                                                    {enq.frequency}
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                    <span className={getStatusClass(enq.status)}>
                                                        {enq.status}
                                                    </span>

                                                    <select
                                                        value={enq.status}
                                                        onChange={(e) => updateEnquiryStatus(enq.id, e.target.value)}
                                                        className="form-control"
                                                        style={{ minHeight: '28px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', width: 'auto', margin: 0, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                                                    >
                                                        <option value="New">New</option>
                                                        <option value="Contacted">Contacted</option>
                                                        <option value="Closed">Closed</option>
                                                    </select>
                                                </div>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <a 
                                                        href={`/quotation.html?client=${encodeURIComponent(enq.company)}&ref=${encodeURIComponent(enq.id)}&destination=${encodeURIComponent(enq.country)}&product=${encodeURIComponent(enq.cutType)}&volume=${encodeURIComponent(enq.volumeMt)}`}
                                                        target="_blank"
                                                        style={{ background: 'rgba(140,118,62,0.15)', border: '1px solid rgba(140,118,62,0.3)', color: '#a48e56', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                                        title="Generate Quotation"
                                                    >
                                                        <i className="fa-solid fa-file-invoice-dollar"></i> Quote
                                                    </a>
                                                    <button
                                                        onClick={() => {
                                                            if (window.confirm(`Delete enquiry ${enq.id}? This cannot be undone.`)) {
                                                                deleteEnquiry(enq.id);
                                                            }
                                                        }}
                                                        style={{ background: 'rgba(220,53,69,0.12)', border: '1px solid rgba(220,53,69,0.25)', color: '#e05260', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1 }}
                                                        title="Delete enquiry"
                                                    >
                                                        <i className="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </div>
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
