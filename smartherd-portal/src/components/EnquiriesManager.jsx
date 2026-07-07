import React, { useContext, useState, useEffect } from 'react';
import { FarmContext } from '../context/FarmContext';

export default function EnquiriesManager() {
    const { 
        enquiries, updateEnquiryStatus, deleteEnquiry,
        quotations, updateQuotationStatus, deleteQuotation, duplicateQuotation,
        specSheets, deleteSpecSheet
    } = useContext(FarmContext);
    const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'New' | 'Contacted' | 'Closed'
    const [searchQuery, setSearchQuery] = useState('');
    const [activeSubTab, setActiveSubTab] = useState('leads'); // 'leads' | 'quotes' | 'specs'

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

            {/* Sub-tab navigation */}
            <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1.25rem', borderRadius: '8px', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button 
                        className={`btn ${activeSubTab === 'leads' ? 'btn-primary' : 'btn-secondary'}`} 
                        onClick={() => setActiveSubTab('leads')}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '38px', fontSize: '0.85rem' }}
                    >
                        <i className="fa-solid fa-envelope-open-text"></i> Export Leads / Enquiries ({filteredEnquiries.length})
                    </button>
                    <button 
                        className={`btn ${activeSubTab === 'quotes' ? 'btn-primary' : 'btn-secondary'}`} 
                        onClick={() => setActiveSubTab('quotes')}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '38px', fontSize: '0.85rem' }}
                    >
                        <i className="fa-solid fa-file-invoice-dollar"></i> Saved Quotations Tracker ({quotations.length})
                    </button>
                    <button 
                        className={`btn ${activeSubTab === 'specs' ? 'btn-primary' : 'btn-secondary'}`} 
                        onClick={() => setActiveSubTab('specs')}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '38px', fontSize: '0.85rem' }}
                    >
                        <i className="fa-solid fa-file-shield"></i> Saved Spec Sheets ({specSheets.length})
                    </button>
                </div>
                
                <a 
                    href="/smartherd-portal/BA_Foods_Blank_Letterhead.docx" 
                    download 
                    className="btn btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '38px', fontSize: '0.85rem', textDecoration: 'none', border: '1px solid rgba(43, 87, 154, 0.4)', background: 'rgba(43, 87, 154, 0.05)' }}
                >
                    <i className="fa-solid fa-file-word" style={{ color: '#2b579a' }}></i> Download Blank Letterhead
                </a>
            </div>

            {/* Conditional Sub-tab Content Rendering */}
            {activeSubTab === 'leads' ? (
                /* List and table manager for Leads */
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
                                                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                                        <a 
                                                            href={`/quotation.html?client=${encodeURIComponent(enq.company)}&ref=${encodeURIComponent(enq.id)}&destination=${encodeURIComponent(enq.country)}&product=${encodeURIComponent(enq.cutType)}&volume=${encodeURIComponent(enq.volumeMt)}`}
                                                            target="_blank"
                                                            style={{ background: 'rgba(140,118,62,0.15)', border: '1px solid rgba(140,118,62,0.3)', color: '#a48e56', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                                            title="Generate Quotation"
                                                        >
                                                            <i className="fa-solid fa-file-invoice-dollar"></i> Quote
                                                        </a>
                                                        <a 
                                                            href={`/spec-sheet.html?product=${encodeURIComponent(enq.cutType)}&client=${encodeURIComponent(enq.contact)}&ref=${encodeURIComponent(enq.id)}`}
                                                            target="_blank"
                                                            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                                            title="Generate Spec Sheet"
                                                        >
                                                            <i className="fa-solid fa-file-shield"></i> Spec
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
            ) : activeSubTab === 'quotes' ? (
                /* Saved Quotations Tracker list view */
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    
                    <div className="table-filters" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                        
                        <h3 style={{ fontSize: '1.05rem', color: 'var(--accent-gold)', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                            <i className="fa-solid fa-file-invoice-dollar"></i> Active Quotation Ledgers
                        </h3>

                        <a 
                            href="/quotation.html" 
                            target="_blank" 
                            className="btn btn-primary"
                            style={{ minHeight: '36px', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                        >
                            <i className="fa-solid fa-plus"></i> Create Blank Quote
                        </a>

                    </div>

                    <div className="table-wrapper" style={{ overflowY: 'auto', flex: 1 }}>
                        {quotations.length === 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
                                <i className="fa-solid fa-file-invoice" style={{ fontSize: '3rem', marginBottom: '1rem', color: 'rgba(255,255,255,0.05)' }}></i>
                                <h3>No saved quotations</h3>
                                <p style={{ fontSize: '0.85rem' }}>Save quotes from the Quotation Creator to track them here.</p>
                            </div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Ref / Date</th>
                                        <th>Client Company</th>
                                        <th>Destination</th>
                                        <th>Incoterm</th>
                                        <th>Products Summary</th>
                                        <th>Status Console</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {quotations.map(quote => {
                                        const prodNames = quote.products.map(p => `${p.title} (${p.weight})`).join(', ');
                                        const destName = quote.scope === 'single' ? quote.targetDestination : 'Multi-Destination';
                                        return (
                                            <tr key={quote.id}>
                                                <td>
                                                    <strong style={{ color: 'var(--accent-gold)' }}>{quote.id}</strong>
                                                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                        {quote.createdAt}
                                                    </span>
                                                </td>
                                                <td>
                                                    <strong>{quote.clientName || 'N/A'}</strong>
                                                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                        Prepared By: {quote.preparerName}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="badge-pen" style={{ background: 'rgba(255,193,7,0.05)', color: 'var(--accent-gold)', border: '1px solid rgba(255,193,7,0.1)' }}>
                                                        <i className="fa-solid fa-location-dot" style={{ marginRight: '4px' }}></i> {destName}
                                                    </span>
                                                </td>
                                                <td>
                                                    <strong style={{ color: 'var(--text-pure)' }}>{quote.incotermBasis}</strong>
                                                </td>
                                                <td style={{ maxWidth: '250px', whiteSpace: 'normal', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                    {prodNames || 'Custom Items'}
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                        <span className={`badge-status ${
                                                            quote.status === 'Accepted' ? 'fattening' : 
                                                            quote.status === 'Sent' ? 'active' : 
                                                            quote.status === 'Draft' ? 'quarantined' : 'quarantined'
                                                        }`}>
                                                            {quote.status || 'Sent'}
                                                        </span>
                                                        <select
                                                            value={quote.status || 'Sent'}
                                                            onChange={(e) => updateQuotationStatus(quote.id, e.target.value)}
                                                            className="form-control"
                                                            style={{ minHeight: '28px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', width: 'auto', margin: 0, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                                                        >
                                                            <option value="Draft">Draft</option>
                                                            <option value="Sent">Sent</option>
                                                            <option value="Accepted">Accepted</option>
                                                            <option value="Rejected">Rejected</option>
                                                            <option value="Expired">Expired</option>
                                                        </select>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                        <a 
                                                            href={`/quotation.html?load_saved_id=${encodeURIComponent(quote.id)}`}
                                                            target="_blank"
                                                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-pure)', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                                            title="Edit/View Quotation"
                                                        >
                                                            <i className="fa-solid fa-pen-to-square"></i> Open
                                                        </a>
                                                        <button
                                                            onClick={() => {
                                                                if (window.confirm(`Are you sure you want to duplicate quotation ${quote.id}? A new draft will be created.`)) {
                                                                    duplicateQuotation(quote);
                                                                }
                                                            }}
                                                            style={{ background: 'rgba(25,135,84,0.12)', border: '1px solid rgba(25,135,84,0.25)', color: 'var(--primary-green-light)', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                                            title="Duplicate Quotation"
                                                        >
                                                            <i className="fa-solid fa-copy"></i> Duplicate
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                if (window.confirm(`Are you sure you want to delete quotation ${quote.id}?`)) {
                                                                    deleteQuotation(quote.id);
                                                                }
                                                            }}
                                                            style={{ background: 'rgba(220,53,69,0.12)', border: '1px solid rgba(220,53,69,0.25)', color: '#e05260', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1 }}
                                                            title="Delete quotation record"
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
            ) : (
                /* Saved Spec Sheets Tracker list view */
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    
                    <div className="table-filters" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                        
                        <h3 style={{ fontSize: '1.05rem', color: 'var(--accent-gold)', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                            <i className="fa-solid fa-file-shield"></i> Active Product Spec Sheets
                        </h3>

                        <a 
                            href="/spec-sheet.html" 
                            target="_blank" 
                            className="btn btn-primary"
                            style={{ minHeight: '36px', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                        >
                            <i className="fa-solid fa-plus"></i> Create Blank Spec
                        </a>

                    </div>

                    <div className="table-wrapper" style={{ overflowY: 'auto', flex: 1 }}>
                        {specSheets.length === 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
                                <i className="fa-solid fa-file-shield" style={{ fontSize: '3rem', marginBottom: '1rem', color: 'rgba(255,255,255,0.05)' }}></i>
                                <h3>No saved spec sheets</h3>
                                <p style={{ fontSize: '0.85rem' }}>Save spec sheets from the Spec Sheet Creator to track them here.</p>
                            </div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Ref / Date</th>
                                        <th>Product Name</th>
                                        <th>Client Buyer</th>
                                        <th>Category</th>
                                        <th>Form / State</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {specSheets.map(spec => (
                                        <tr key={spec.docRef}>
                                            <td>
                                                <strong style={{ color: 'var(--accent-gold)' }}>{spec.docRef}</strong>
                                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                    {formatDate(spec.createdAt)}
                                                </span>
                                            </td>
                                            <td>
                                                <strong>{spec.idName}</strong>
                                                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                                    SKU: {spec.idSku || '—'}
                                                </span>
                                            </td>
                                            <td>
                                                <strong>{spec.clientName || 'N/A'}</strong>
                                            </td>
                                            <td>
                                                {spec.idCategory || '—'}
                                            </td>
                                            <td>
                                                <span className="badge-pen" style={{ background: 'rgba(59,130,246,0.05)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.1)' }}>
                                                    {spec.specForm || '—'}
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <a 
                                                        href={`/spec-sheet.html?load_saved_id=${encodeURIComponent(spec.docRef)}`}
                                                        target="_blank"
                                                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-pure)', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                                        title="Edit/View Spec Sheet"
                                                    >
                                                        <i className="fa-solid fa-pen-to-square"></i> Open
                                                    </a>
                                                    <button
                                                        onClick={() => deleteSpecSheet(spec.docRef)}
                                                        style={{ background: 'rgba(220,53,69,0.12)', border: '1px solid rgba(220,53,69,0.25)', color: '#e05260', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1 }}
                                                        title="Delete spec sheet record"
                                                    >
                                                        <i className="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
