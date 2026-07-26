import React, { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';

export default function HerdRegistry() {
    const { animals, addAnimal, updateAnimal, deleteAnimal, recordDeath, transitionAnimalStatus, breedsConfig, updateBreedsConfig } = useContext(FarmContext);

    // UI State
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAnimal, setEditingAnimal] = useState(null);

    // Deceased modal state
    const [deathAnimal, setDeathAnimal] = useState(null);
    const [deathDate, setDeathDate] = useState(new Date().toISOString().split('T')[0]);
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
        const headers = ['RFID,Breed,Entry Date,Entry Weight (kg),Current Weight (kg),Total Gain (kg),Purchase Cost (PKR),Source,Pen,Status'];
        const rows = filteredAnimals.map(a =>
            [a.rfid, a.breed, formatDate(a.entryDate), a.entryWeight, a.currentWeight,
             (a.currentWeight - a.entryWeight).toFixed(1), a.purchasePrice, a.source || '', a.pen || '', a.status].join(',')
        );
        const csv = [...headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `BA_Farms_Herd_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
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
        setEntryDate(new Date().toISOString().split('T')[0]);
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
        setDeathDate(new Date().toISOString().split('T')[0]);
        setDeathCause('Disease');
    };

const handleSubmit = (e) => {
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
            updateAnimal({
                id: editingAnimal.id,
                currentWeight: editingAnimal.currentWeight, // preserve current weight
                ...payload
            });
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

                <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <button class="btn btn-secondary" onClick={exportCSV} title="Export current view to CSV">
                        <i class="fa-solid fa-file-csv"></i> Export CSV
                    </button>
                    <button class="btn btn-primary" onClick={openRegisterModal}>
                        <i class="fa-solid fa-plus"></i> Register New Calf
                    </button>
                </div>
            </div>

            {/* Filtering toggles */}
            <div class="table-filters">
                <button class={`filter-btn ${filterStatus === 'All' ? 'active' : ''}`} onClick={() => setFilterStatus('All')}>All ({animals.length})</button>
                <button class={`filter-btn ${filterStatus === 'Fattening' ? 'active' : ''}`} onClick={() => setFilterStatus('Fattening')}>Fattening ({animals.filter(a => a.status === 'Fattening').length})</button>
                <button class={`filter-btn ${filterStatus === 'Quarantined' ? 'active' : ''}`} onClick={() => setFilterStatus('Quarantined')}>Quarantined ({animals.filter(a => a.status === 'Quarantined').length})</button>
                <button class={`filter-btn ${filterStatus === 'Sick' ? 'active' : ''}`} onClick={() => setFilterStatus('Sick')}>Sick ({animals.filter(a => a.status === 'Sick').length})</button>
                <button class={`filter-btn ${filterStatus === 'Deceased' ? 'active' : ''}`} onClick={() => setFilterStatus('Deceased')}>Deceased ({animals.filter(a => a.status === 'Deceased').length})</button>
                <button class={`filter-btn ${filterStatus === 'Sold' ? 'active' : ''}`} onClick={() => setFilterStatus('Sold')}>Sold ({animals.filter(a => a.status === 'Sold').length})</button>
            </div>

            {/* Main Ledger Table */}
            <div className="table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>TAG</th>
                            <th>BREED</th>
                            <th>WT (KG)</th>
                            <th>GAIN</th>
                            <th>COST (PKR)</th>
                            <th>PEN</th>
                            <th>STATUS</th>
                            <th style={{ textAlign: 'center' }}>ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAnimals.map((animal) => (
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
                                <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600' }}>
                                    {animal.pen ? <span style={{ color: 'var(--accent-gold)' }}>{animal.pen}</span> : <span style={{ opacity: 0.4 }}>—</span>}
                                </td>
                                <td>
                                    <span className={`badge-status ${animal.status.toLowerCase()}`}>
                                        {animal.status}
                                    </span>
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
                                        <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(220, 53, 69, 0.2)', color: 'hsl(0, 75%, 65%)', background: 'rgba(220, 53, 69, 0.02)' }} onClick={() => {
                                            if (window.confirm(`Delete ${animal.rfid}?`)) {
                                                deleteAnimal(animal.id);
                                            }
                                        }} title="Delete">
                                            <i className="fa-solid fa-trash-can"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredAnimals.length === 0 && (
                            <tr>
                                <td colSpan="8" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
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
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Purchase Cost (PKR) *</label>
                                        <input type="number" class="form-control" placeholder="e.g. 150000" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} required />
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

        </div>
    );
}
