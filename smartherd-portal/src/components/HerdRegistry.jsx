import React, { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT } from '../utils/dateOnly';

// Accessors used to sort the herd table by column. Defined outside the component
// since they don't depend on props/state.
const SORT_ACCESSORS = {
    tag: (a) => a.rfid,
    breed: (a) => a.breed,
    weight: (a) => a.currentWeight,
    gain: (a) => a.currentWeight - a.entryWeight,
    cost: (a) => a.purchasePrice,
    costPerKg: (a) => (a.entryWeight ? a.purchasePrice / a.entryWeight : 0),
    pen: (a) => a.pen || '',
    status: (a) => a.status
};

export default function HerdRegistry() {
    const { animals, addAnimal, updateAnimal, deleteAnimal, recordDeath, transitionAnimalStatus, breedsConfig, updateBreedsConfig, staffUser, myRequests } = useContext(FarmContext);

    // Strictly the DB-backed Super Admin flag — non-admins can add animals freely
    // but have entry weight/purchase price edits and deletes staged for approval.
    const isSuperAdmin = staffUser?.isAdmin === true;

    // UI State
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAnimal, setEditingAnimal] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [notice, setNotice] = useState(null);
    const [showMyRequests, setShowMyRequests] = useState(false);

    // Deceased modal state
    const [deathAnimal, setDeathAnimal] = useState(null);
    const [deathDate, setDeathDate] = useState(todayPKT());
    const [deathCause, setDeathCause] = useState('Disease');

    // Form Input state
    const [rfid, setRfid] = useState('');
    const [breed, setBreed] = useState('');
    const [entryWeight, setEntryWeight] = useState('');
    const [purchasePrice, setPurchasePrice] = useState('');
    const [source, setSource] = useState('');
    const [status, setStatus] = useState('Quarantined');
    const [targetWeight, setTargetWeight] = useState('');
    const [entryDate, setEntryDate] = useState('');
    const [pen, setPen] = useState('');
    // When true, the Breed field is a free-text input instead of the preset dropdown —
    // lets staff register an animal with a breed that isn't in the configured list yet.
    const [customBreedMode, setCustomBreedMode] = useState(false);
    const CUSTOM_BREED_OPTION = '__custom__';

    const exportCSV = () => {
        const headers = ['RFID,Breed,Entry Date,Entry Weight (kg),Current Weight (kg),Total Gain (kg),Purchase Cost (PKR),Cost per KG (PKR),Source,Pen,Status'];
        const rows = sortedAnimals.map(a =>
            [a.rfid, a.breed, formatDate(a.entryDate), a.entryWeight, a.currentWeight,
             (a.currentWeight - a.entryWeight).toFixed(1), a.purchasePrice,
             a.entryWeight ? (a.purchasePrice / a.entryWeight).toFixed(0) : '', a.source || '', a.pen || '', a.status].join(',')
        );
        const csv = [...headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `BA_Farms_Herd_${todayPKT()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportPDF = () => {
        const totalCost = filteredAnimals.reduce((sum, a) => sum + (a.purchasePrice || 0), 0);
        const totalWeight = filteredAnimals.reduce((sum, a) => sum + (a.entryWeight || 0), 0);
        const avgPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;

        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(16);
        doc.text('BA Farms — Herd Registry', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Generated ${formatDate(todayPKT())} · ${filteredAnimals.length} animal${filteredAnimals.length === 1 ? '' : 's'} · Avg Purchase Price/Gross Weight: ${Math.round(avgPerKg).toLocaleString()} PKR/kg`, 14, 21);

        autoTable(doc, {
            startY: 27,
            head: [['Tag', 'Breed', 'Entry Date', 'Entry Wt (kg)', 'Current Wt (kg)', 'Gain (kg)', 'Cost (PKR)', 'Cost/kg (PKR)', 'Source', 'Pen', 'Status']],
            body: sortedAnimals.map(a => [
                a.rfid,
                a.breed,
                formatDate(a.entryDate),
                a.entryWeight,
                a.currentWeight,
                (a.currentWeight - a.entryWeight).toFixed(1),
                a.purchasePrice.toLocaleString(),
                a.entryWeight ? Math.round(a.purchasePrice / a.entryWeight).toLocaleString() : '—',
                a.source || '—',
                a.pen || '—',
                a.status
            ]),
            foot: [['', '', '', totalWeight.toLocaleString(), '', '', totalCost.toLocaleString(), Math.round(avgPerKg).toLocaleString(), '', '', 'TOTAL / AVG']],
            styles: { fontSize: 8 },
            headStyles: { fillColor: [25, 90, 60] },
            footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: 'bold' }
        });

        doc.save(`BA_Farms_Herd_${todayPKT()}.pdf`);
    };

    const openRegisterModal = () => {
        setEditingAnimal(null);
        setRfid('');
        setBreed(breedsConfig[0]?.name || 'Sahiwal');
        setCustomBreedMode(false);
        setEntryWeight('');
        setPurchasePrice('');
        setSource('');
        setStatus('Quarantined');
        setTargetWeight('');
        setEntryDate(todayPKT());
        setPen('');
        setIsModalOpen(true);
    };

    const openEditModal = (animal) => {
        setEditingAnimal(animal);
        setRfid(animal.rfid);
        setBreed(animal.breed);
        // If this animal's breed isn't in the configured list (e.g. it was entered as a
        // custom breed, or the config was later trimmed), keep the field editable as
        // free text instead of silently swapping it for the first preset breed.
        setCustomBreedMode(!breedsConfig.some(b => b.name === animal.breed));
        setEntryWeight(animal.entryWeight);
        setPurchasePrice(animal.purchasePrice);
        setSource(animal.source);
        setStatus(animal.status);
        setTargetWeight(animal.targetWeight || '');
        setEntryDate(animal.entryDate);
        setPen(animal.pen || '');
        setIsModalOpen(true);
    };

    const openDeathModal = (animal) => {
        setDeathAnimal(animal);
        setDeathDate(todayPKT());
        setDeathCause('Disease');
    };

const handleSubmit = async (e) => {
        e.preventDefault();
        if (!entryWeight || !purchasePrice) return;

        const selectedBreed = (breed || '').trim() || (breedsConfig[0]?.name || 'Sahiwal');
        const matchedBreed = breedsConfig.find(b => b.name.toLowerCase() === selectedBreed.toLowerCase());
        const defaultTarget = matchedBreed ? matchedBreed.defaultTargetWeight : (parseFloat(targetWeight) || 360);

        // A newly typed custom breed isn't in the registry yet — add it now so it's
        // available in future dropdowns and shows up alongside the presets in Settings.
        if (customBreedMode && !matchedBreed) {
            updateBreedsConfig([...breedsConfig, { name: selectedBreed, defaultTargetWeight: defaultTarget }]);
        }

        const payload = {
            rfid,
            breed: selectedBreed,
            entryWeight: parseFloat(entryWeight),
            purchasePrice: parseFloat(purchasePrice),
            source,
            status,
            targetWeight: parseFloat(targetWeight) || defaultTarget,
            entryDate,
            pen: pen || null
        };

        if (editingAnimal) {
            const result = await updateAnimal({
                id: editingAnimal.id,
                currentWeight: editingAnimal.currentWeight, // preserve current weight
                ...payload
            });
            if (result?.success === false) {
                setNotice({ type: 'error', text: result.error || 'Update could not be saved.' });
                return;
            }
            if (result?.pending) {
                setNotice({ type: 'pending', text: `Entry Weight / Purchase Price change for ${payload.rfid} needs Super Admin approval. Every other field was saved.` });
            }
        } else {
            addAnimal(payload);
        }

        // Reset form & close
        setRfid('');
        setBreed(breedsConfig[0]?.name || 'Sahiwal');
        setCustomBreedMode(false);
        setEntryWeight('');
        setPurchasePrice('');
        setSource('');
        setStatus('Quarantined');
        setTargetWeight('');
        setEntryDate('');
        setPen('');
        setEditingAnimal(null);
        setIsModalOpen(false);
    };

    const handleDeathSubmit = async (e) => {
        e.preventDefault();
        if (!deathDate || !deathCause) return;
        await recordDeath(deathAnimal.id, deathDate, deathCause);
        setDeathAnimal(null);
    };

    // This staff member's own open (pending) requests, keyed by animal — drives the
    // per-row "Pending Approval" chip so a non-admin can see at a glance which of
    // their edits/deletes are still awaiting a super admin's sign-off.
    const myPendingByAnimal = React.useMemo(() => {
        const map = {};
        myRequests.filter(r => r.status === 'pending').forEach(r => { map[r.animalId] = r; });
        return map;
    }, [myRequests]);

    // Filter and Search Logic
    const filteredAnimals = animals.filter(animal => {
        const matchesSearch = (
            animal.rfid.toLowerCase().includes(search.toLowerCase()) ||
            animal.breed.toLowerCase().includes(search.toLowerCase()) ||
            (animal.source || '').toLowerCase().includes(search.toLowerCase())
        );
        const matchesFilter = filterStatus === 'All' || animal.status === filterStatus;
        return matchesSearch && matchesFilter;
    });

    // Overall purchase average = total purchase cost / total gross (entry) weight, across the current view
    const totalPurchaseCost = filteredAnimals.reduce((sum, a) => sum + (a.purchasePrice || 0), 0);
    const totalGrossWeight = filteredAnimals.reduce((sum, a) => sum + (a.entryWeight || 0), 0);
    const avgCostPerKg = totalGrossWeight > 0 ? totalPurchaseCost / totalGrossWeight : 0;

    // Column sorting — click a header to sort by it, click again to reverse direction
    const handleSort = (key) => {
        setSortConfig(prev => prev.key === key
            ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
            : { key, direction: 'asc' });
    };

    const sortedAnimals = React.useMemo(() => {
        if (!sortConfig.key) return filteredAnimals;
        const accessor = SORT_ACCESSORS[sortConfig.key];
        const sorted = [...filteredAnimals].sort((a, b) => {
            const valA = accessor(a);
            const valB = accessor(b);
            if (typeof valA === 'string') return valA.localeCompare(valB);
            return valA - valB;
        });
        if (sortConfig.direction === 'desc') sorted.reverse();
        return sorted;
    }, [filteredAnimals, sortConfig]);

    const renderSortIcon = (key) => {
        if (sortConfig.key !== key) {
            return <i className="fa-solid fa-sort" style={{ opacity: 0.25, marginLeft: '0.4rem', fontSize: '0.7rem' }}></i>;
        }
        return sortConfig.direction === 'asc'
            ? <i className="fa-solid fa-sort-up" style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--accent-gold)' }}></i>
            : <i className="fa-solid fa-sort-down" style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--accent-gold)' }}></i>;
    };

    const sortableTh = (label, key) => (
        <th onClick={() => handleSort(key)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Click to sort">
            {label}{renderSortIcon(key)}
        </th>
    );

    return (
        <div class="glass-panel">

            {/* Header with Search and Registration toggle */}
            <div class="form-header-bar">
                <div class="search-bar-wrap">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input
                        type="text"
                        placeholder="Search Tag, Breed, or Mandi..."
                        class="form-control search-control"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                    {!isSuperAdmin && myRequests.length > 0 && (
                        <button
                            class="btn btn-secondary"
                            style={{ borderColor: 'rgba(255,193,7,0.3)', color: 'hsl(43,90%,53%)' }}
                            onClick={() => setShowMyRequests(true)}
                            title="View the status of your submitted edit/delete requests"
                        >
                            <i class="fa-solid fa-hourglass-half"></i> My Requests ({myRequests.filter(r => r.status === 'pending').length})
                        </button>
                    )}
                    <button class="btn btn-secondary" onClick={exportCSV} title="Export current view to CSV">
                        <i class="fa-solid fa-file-csv"></i> Export CSV
                    </button>
                    <button class="btn btn-secondary" onClick={exportPDF} title="Export current view to PDF">
                        <i class="fa-solid fa-file-pdf"></i> Export PDF
                    </button>
                    <button class="btn btn-primary" onClick={openRegisterModal}>
                        <i class="fa-solid fa-plus"></i> Register New Calf
                    </button>
                </div>
            </div>

            {notice && (
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem',
                    padding: '0.6rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem',
                    background: notice.type === 'error' ? 'rgba(220, 53, 69, 0.08)' : 'rgba(255,193,7,0.08)',
                    border: `1px solid ${notice.type === 'error' ? 'rgba(220, 53, 69, 0.3)' : 'rgba(255,193,7,0.3)'}`,
                    color: notice.type === 'error' ? 'hsl(0, 75%, 70%)' : 'hsl(43,90%,53%)'
                }}>
                    <span><i className={`fa-solid ${notice.type === 'error' ? 'fa-triangle-exclamation' : 'fa-hourglass-half'}`}></i> {notice.text}</span>
                    <button class="modal-close-btn" style={{ position: 'static' }} onClick={() => setNotice(null)}>
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            )}

            {/* Filtering toggles */}
            <div class="table-filters">
                <button class={`filter-btn ${filterStatus === 'All' ? 'active' : ''}`} onClick={() => setFilterStatus('All')}>All ({animals.length})</button>
                <button class={`filter-btn ${filterStatus === 'Fattening' ? 'active' : ''}`} onClick={() => setFilterStatus('Fattening')}>Fattening ({animals.filter(a => a.status === 'Fattening').length})</button>
                <button class={`filter-btn ${filterStatus === 'Quarantined' ? 'active' : ''}`} onClick={() => setFilterStatus('Quarantined')}>Quarantined ({animals.filter(a => a.status === 'Quarantined').length})</button>
                <button class={`filter-btn ${filterStatus === 'Sick' ? 'active' : ''}`} onClick={() => setFilterStatus('Sick')}>Sick ({animals.filter(a => a.status === 'Sick').length})</button>
                <button class={`filter-btn ${filterStatus === 'Deceased' ? 'active' : ''}`} onClick={() => setFilterStatus('Deceased')}>Deceased ({animals.filter(a => a.status === 'Deceased').length})</button>
                <button class={`filter-btn ${filterStatus === 'Sold' ? 'active' : ''}`} onClick={() => setFilterStatus('Sold')}>Sold ({animals.filter(a => a.status === 'Sold').length})</button>
            </div>

            {/* Average purchase price per kg of gross (entry) weight, across the current view */}
            <div class="dashboard-grid" style={{ marginBottom: '1rem' }}>
                <div class="glass-panel stat-box">
                    <div class="stat-header">
                        <h3>Avg Purchase Price / Gross Weight</h3>
                        <div class="stat-icon"><i class="fa-solid fa-scale-balanced"></i></div>
                    </div>
                    <div class="stat-val">{Math.round(avgCostPerKg).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR/kg</small></div>
                    <span class="stat-lbl">
                        <i class="fa-solid fa-cow"></i> {totalPurchaseCost.toLocaleString()} PKR ÷ {totalGrossWeight.toLocaleString()} kg across {filteredAnimals.length} animal{filteredAnimals.length === 1 ? '' : 's'}
                    </span>
                </div>
            </div>

            {/* Main Ledger Table */}
            <div className="table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            {sortableTh('TAG', 'tag')}
                            {sortableTh('BREED', 'breed')}
                            {sortableTh('WT (KG)', 'weight')}
                            {sortableTh('GAIN', 'gain')}
                            {sortableTh('COST (PKR)', 'cost')}
                            {sortableTh('COST/KG', 'costPerKg')}
                            {sortableTh('PEN', 'pen')}
                            {sortableTh('STATUS', 'status')}
                            <th style={{ textAlign: 'center' }}>ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedAnimals.map((animal) => (
                            <tr key={animal.id}>
                                <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)' }}>
                                    {animal.rfid}
                                </td>
                                <td>{animal.breed}</td>
                                <td><strong>{animal.currentWeight} kg</strong></td>
                                <td style={{ color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                    +{parseFloat((animal.currentWeight - animal.entryWeight).toFixed(1))} kg
                                </td>
                                <td>{animal.purchasePrice.toLocaleString()}</td>
                                <td style={{ color: 'var(--text-muted)' }}>
                                    {animal.entryWeight ? `${Math.round(animal.purchasePrice / animal.entryWeight).toLocaleString()} /kg` : '—'}
                                </td>
                                <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600' }}>
                                    {animal.pen ? <span style={{ color: 'var(--accent-gold)' }}>{animal.pen}</span> : <span style={{ opacity: 0.4 }}>—</span>}
                                </td>
                                <td>
                                    <span className={`badge-status ${animal.status.toLowerCase()}`}>
                                        {animal.status}
                                    </span>
                                    {myPendingByAnimal[animal.id] && (
                                        <span
                                            title={`${myPendingByAnimal[animal.id].action === 'DELETE_ANIMAL' ? 'Deletion' : 'Edit'} request awaiting Super Admin approval`}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(255,193,7,0.12)', color: 'hsl(43,90%,53%)', marginLeft: '0.4rem' }}
                                        >
                                            <i className="fa-solid fa-hourglass-half"></i> Pending
                                        </span>
                                    )}
                                </td>
                                <td>
                                    <div className="herd-actions-group" style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                        <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openEditModal(animal)}>
                                            <i className="fa-solid fa-pen-to-square"></i>
                                        </button>
                                        {animal.status !== 'Sick' && animal.status !== 'Sold' && animal.status !== 'Deceased' && (
                                            <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(255,193,7,0.3)', color: 'hsl(43,90%,53%)', background: 'rgba(255,193,7,0.04)' }} onClick={() => transitionAnimalStatus(animal.id, 'Sick')} title="Mark Sick">
                                                <i className="fa-solid fa-heart-pulse"></i> Sick
                                            </button>
                                        )}
                                        {animal.status === 'Sick' && (
                                            <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(25,135,84,0.3)', color: 'var(--primary-green-light)', background: 'rgba(25,135,84,0.04)' }} onClick={() => transitionAnimalStatus(animal.id, 'Fattening')} title="Mark Recovered">
                                                <i className="fa-solid fa-circle-check"></i> OK
                                            </button>
                                        )}
                                        {animal.status !== 'Sold' && animal.status !== 'Deceased' && (
                                            <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(100, 50, 50, 0.3)', color: 'hsl(0, 60%, 55%)', background: 'rgba(80, 20, 20, 0.05)' }} onClick={() => openDeathModal(animal)} title="Record Death">
                                                ☠
                                            </button>
                                        )}
                                        <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(220, 53, 69, 0.2)', color: 'hsl(0, 75%, 65%)', background: 'rgba(220, 53, 69, 0.02)' }} onClick={async () => {
                                            const confirmMsg = isSuperAdmin ? `Delete ${animal.rfid}?` : `Request deletion of ${animal.rfid}? A Super Admin will need to approve it.`;
                                            if (!window.confirm(confirmMsg)) return;
                                            const result = await deleteAnimal(animal.id);
                                            if (result?.success === false) {
                                                setNotice({ type: 'error', text: result.error || 'Delete could not be submitted.' });
                                            } else if (result?.pending) {
                                                setNotice({ type: 'pending', text: `Deletion of ${animal.rfid} needs Super Admin approval.` });
                                            }
                                        }} title={isSuperAdmin ? 'Delete' : 'Request Deletion'}>
                                            <i className="fa-solid fa-trash-can"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {sortedAnimals.length === 0 && (
                            <tr>
                                <td colSpan="9" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                    <i className="fa-solid fa-cow" style={{ fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}></i>
                                    No animal records matching your filters were found in the database.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>



            {/* 4. MODAL POPUP ADD/EDIT CALF REGISTER FORM */}
            {isModalOpen && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container">
                        <button class="modal-close-btn" onClick={() => setIsModalOpen(false)}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', marginBottom: '1rem' }}>
                            <i class="fa-solid fa-plus-circle"></i> {editingAnimal ? 'Edit Animal' : 'Register Animal'}
                        </h2>

                        <form onSubmit={handleSubmit}>
                            <div class="modal-body-scroll">
                                {/* Row 1: RFID, Source, Breed */}
                                <div class="form-grid-3">
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Tag ID</label>
                                        <input type="text" class="form-control" placeholder="e.g. 001, 012" value={rfid} onChange={(e) => setRfid(e.target.value)} required />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Source Mandi</label>
                                        <input type="text" class="form-control" placeholder="e.g. Jhang Mandi" value={source} onChange={(e) => setSource(e.target.value)} />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Breed</label>
                                        {customBreedMode ? (
                                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                <input
                                                    type="text"
                                                    class="form-control"
                                                    placeholder="Enter breed name"
                                                    value={breed}
                                                    onChange={(e) => setBreed(e.target.value)}
                                                    required
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    class="btn btn-secondary"
                                                    style={{ minHeight: '38px', padding: '0 0.7rem', flexShrink: 0 }}
                                                    title="Back to preset breed list"
                                                    onClick={() => { setCustomBreedMode(false); setBreed(breedsConfig[0]?.name || 'Sahiwal'); }}
                                                >
                                                    <i class="fa-solid fa-xmark"></i>
                                                </button>
                                            </div>
                                        ) : (
                                            <select
                                                class="form-control"
                                                value={breed || (breedsConfig[0]?.name || 'Sahiwal')}
                                                onChange={(e) => {
                                                    if (e.target.value === CUSTOM_BREED_OPTION) {
                                                        setCustomBreedMode(true);
                                                        setBreed('');
                                                    } else {
                                                        setBreed(e.target.value);
                                                    }
                                                }}
                                            >
                                                {breedsConfig.map(b => (
                                                    <option key={b.name} value={b.name}>{b.name}</option>
                                                ))}
                                                <option value={CUSTOM_BREED_OPTION}>+ Add Custom Breed…</option>
                                            </select>
                                        )}
                                    </div>
                                </div>

                                {/* Row 2: Entry Weight, Purchase Cost, Target Weight */}
                                <div class="form-grid-3">
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Entry Weight (kg) *</label>
                                        <input type="number" class="form-control" placeholder="e.g. 120" value={entryWeight} onChange={(e) => setEntryWeight(e.target.value)} required />
                                        {editingAnimal && !isSuperAdmin && (
                                            <small style={{ color: 'hsl(43,90%,53%)', fontSize: '0.7rem' }}>Changes need Super Admin approval</small>
                                        )}
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Purchase Cost (PKR) *</label>
                                        <input type="number" class="form-control" placeholder="e.g. 150000" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} required />
                                        {editingAnimal && !isSuperAdmin && (
                                            <small style={{ color: 'hsl(43,90%,53%)', fontSize: '0.7rem' }}>Changes need Super Admin approval</small>
                                        )}
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Target Weight (kg)</label>
                                        <input type="number" class="form-control" placeholder="e.g. 360" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} />
                                    </div>
                                </div>

                                {/* Row 3: Status, Entry Date, Pen */}
                                <div class="form-grid-3" style={{ marginBottom: '0.5rem' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Status</label>
                                        <select class="form-control" value={status} onChange={(e) => setStatus(e.target.value)}>
                                            <option value="Quarantined">Quarantined</option>
                                            <option value="Fattening">Fattening</option>
                                            <option value="Sick">Sick</option>
                                            <option value="Deceased">Deceased</option>
                                            <option value="Sold">Sold</option>
                                        </select>
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Entry Date</label>
                                        <input type="date" class="form-control" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Pen / Lot</label>
                                        <input type="text" class="form-control" placeholder="e.g. A, B, 1" value={pen} onChange={(e) => setPen(e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
                                <button type="button" class="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                <button type="submit" class="btn btn-primary">Save</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* DECEASED RECORDING MODAL */}
            {deathAnimal && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container" style={{ maxWidth: '420px' }}>
                        <button class="modal-close-btn" onClick={() => setDeathAnimal(null)}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.8rem', marginBottom: '1.5rem', color: 'hsl(0,60%,55%)' }}>
                            ☠ Record Death — {deathAnimal.rfid}
                        </h2>

                        <div style={{ background: 'rgba(150,30,30,0.05)', border: '1px solid rgba(150,30,30,0.2)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Breed: <strong style={{ color: 'var(--text-pure)' }}>{deathAnimal.breed}</strong></span>
                                <span>Weight: <strong style={{ color: 'var(--text-pure)' }}>{deathAnimal.currentWeight} kg</strong></span>
                            </div>
                        </div>

                        <form onSubmit={handleDeathSubmit}>
                            <div class="form-grid-row" style={{ marginBottom: '1.2rem' }}>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Date of Death *</label>
                                    <input
                                        type="date"
                                        class="form-control"
                                        value={deathDate}
                                        onChange={(e) => setDeathDate(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Cause of Death *</label>
                                    <select
                                        class="form-control"
                                        value={deathCause}
                                        onChange={(e) => setDeathCause(e.target.value)}
                                        required
                                    >
                                        <option value="Disease">Disease</option>
                                        <option value="Injury">Injury</option>
                                        <option value="Unknown">Unknown</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" class="btn btn-secondary" onClick={() => setDeathAnimal(null)}>Cancel</button>
                                <button type="submit" class="btn btn-primary" style={{ background: 'rgba(150,30,30,0.5)', borderColor: 'rgba(150,30,30,0.4)' }}>
                                    ☠ Confirm Death Record
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* MY REQUESTS — a non-admin's own edit/delete request history & status */}
            {showMyRequests && createPortal(
                <div class="modal-overlay" onClick={() => setShowMyRequests(false)}>
                    <div class="glass-panel modal-container" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
                        <button class="modal-close-btn" onClick={() => setShowMyRequests(false)}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', marginBottom: '1rem' }}>
                            <i class="fa-solid fa-hourglass-half"></i> My Requests
                        </h2>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '60vh', overflowY: 'auto' }}>
                            {myRequests.length === 0 ? (
                                <p class="unregistered-help-text">You haven't submitted any edit/delete requests.</p>
                            ) : myRequests.map(item => (
                                <div key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <strong style={{ color: 'var(--text-pure)' }}>
                                            {item.action === 'DELETE_ANIMAL' ? 'Delete' : 'Edit'} — {item.animalRfid || `Animal #${item.animalId}`}
                                        </strong>
                                        <span style={{
                                            fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px',
                                            background: item.status === 'approved' ? 'rgba(25,135,84,0.12)' : item.status === 'rejected' ? 'rgba(220,53,69,0.12)' : 'rgba(255,193,7,0.12)',
                                            color: item.status === 'approved' ? 'var(--primary-green-light)' : item.status === 'rejected' ? 'hsl(0, 75%, 65%)' : 'hsl(43,90%,53%)'
                                        }}>
                                            {item.status.toUpperCase()}
                                        </span>
                                    </div>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Submitted {formatDate(item.requestedAt)}</span>
                                    {item.status === 'rejected' && item.reviewNote && (
                                        <span style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Reason: {item.reviewNote}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
}
