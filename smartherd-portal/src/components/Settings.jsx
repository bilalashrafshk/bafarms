import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';

export default function Settings() {
    const {
        breedsConfig, updateBreedsConfig,
        medCategories, updateMedCategories,
        systemParams, updateSystemParams,
        quarantineProtocols, updateQuarantineProtocols,
        staffUser, staffPermissions, updateStaffPermission, deleteStaffPermission,
        allApprovals
    } = useContext(FarmContext);

    const isAdmin = staffUser?.role === 'Internal Corporate Staff';
    // Narrower than isAdmin above — only true super-admins (ba_staff_permissions.is_admin)
    // can grant/restrict Sales vs Herd Management access for other staff.
    const isPermsAdmin = staffUser?.isAdmin === true;

    // Local state for Staff Access Form
    const [newStaffEmail, setNewStaffEmail] = useState('');
    const [permError, setPermError] = useState('');
    const [permSavingEmail, setPermSavingEmail] = useState(null);

    // Local state for General Params
    const [weighIntervalDays, setWeighIntervalDays] = useState(systemParams.weighIntervalDays ?? 14);
    const [quarantineDays, setQuarantineDays] = useState(systemParams.quarantineDays ?? 14);
    const [adgAlertThreshold, setAdgAlertThreshold] = useState(systemParams.adgAlertThreshold ?? 1.0);
    const [generalSaved, setGeneralSaved] = useState(false);

    // Local state for Breeds Form
    const [newBreedName, setNewBreedName] = useState('');
    const [newBreedWeight, setNewBreedWeight] = useState('');
    const [breedError, setBreedError] = useState('');

    // Local state for Medical Categories Form
    const [newMedCat, setNewMedCat] = useState('');
    const [medCatError, setMedCatError] = useState('');

    // Local state for Quarantine Protocol Form
    const [protoLabel, setProtoLabel] = useState('');
    const [protoDueDay, setProtoDueDay] = useState('1');
    const [protoType, setProtoType] = useState('');
    const [protoMedicine, setProtoMedicine] = useState('');
    const [protoDosage, setProtoDosage] = useState('');
    const [protoWithholding, setProtoWithholding] = useState('0');
    const [protoError, setProtoError] = useState('');

    // Tabs inside settings
    const [activeSettingsTab, setActiveSettingsTab] = useState('general');

    // Local state for the Approvals audit tab
    const [approvalsSearch, setApprovalsSearch] = useState('');
    const [approvalsStatusFilter, setApprovalsStatusFilter] = useState('All');

    const filteredApprovals = allApprovals.filter(a => {
        const matchesStatus = approvalsStatusFilter === 'All' || a.status === approvalsStatusFilter.toLowerCase();
        const q = approvalsSearch.trim().toLowerCase();
        const matchesSearch = !q ||
            (a.animalRfid || '').toLowerCase().includes(q) ||
            (a.animalBreed || '').toLowerCase().includes(q) ||
            (a.requestedBy || '').toLowerCase().includes(q);
        return matchesStatus && matchesSearch;
    });

    // General params submission
    const handleSaveParams = (e) => {
        e.preventDefault();
        if (!isAdmin) return;
        updateSystemParams({
            weighIntervalDays: parseInt(weighIntervalDays) || 14,
            quarantineDays: parseInt(quarantineDays) || 14,
            adgAlertThreshold: parseFloat(adgAlertThreshold) || 1.0
        });
        setGeneralSaved(true);
        setTimeout(() => setGeneralSaved(false), 2500);
    };

    // Breed Addition
    const handleAddBreed = (e) => {
        e.preventDefault();
        if (!isAdmin) return;
        setBreedError('');
        const name = newBreedName.trim();
        const weight = parseInt(newBreedWeight);

        if (!name || isNaN(weight)) {
            setBreedError('Please fill in both fields correctly.');
            return;
        }

        if (breedsConfig.some(b => b.name.toLowerCase() === name.toLowerCase())) {
            setBreedError('This breed name already exists.');
            return;
        }

        const updated = [...breedsConfig, { name, defaultTargetWeight: weight }];
        updateBreedsConfig(updated);
        setNewBreedName('');
        setNewBreedWeight('');
    };

    // Breed Deletion
    const handleDeleteBreed = (nameToDelete) => {
        if (!isAdmin) return;
        if (breedsConfig.length <= 1) {
            alert("At least one breed must remain in the configuration registry.");
            return;
        }
        if (window.confirm(`Are you sure you want to delete breed "${nameToDelete}"? New registrations of this breed will revert to standard default weights.`)) {
            const updated = breedsConfig.filter(b => b.name !== nameToDelete);
            updateBreedsConfig(updated);
        }
    };

    // Medical Category Addition
    const handleAddMedCat = (e) => {
        e.preventDefault();
        if (!isAdmin) return;
        setMedCatError('');
        const cat = newMedCat.trim();

        if (!cat) {
            setMedCatError('Category name cannot be empty.');
            return;
        }

        if (medCategories.some(c => c.toLowerCase() === cat.toLowerCase())) {
            setMedCatError('This category already exists.');
            return;
        }

        const updated = [...medCategories, cat];
        updateMedCategories(updated);
        setNewMedCat('');
    };

    // Medical Category Deletion
    const handleDeleteMedCat = (catToDelete) => {
        if (!isAdmin) return;
        if (medCategories.length <= 1) {
            alert("At least one treatment category must remain in system configuration.");
            return;
        }
        if (window.confirm(`Are you sure you want to delete medical category "${catToDelete}"?`)) {
            const updated = medCategories.filter(c => c !== catToDelete);
            updateMedCategories(updated);
        }
    };

    // Protocol Addition
    const handleAddProtocol = (e) => {
        e.preventDefault();
        if (!isAdmin) return;
        setProtoError('');
        const label = protoLabel.trim();
        const medicine = protoMedicine.trim();
        const dosage = protoDosage.trim();
        const type = protoType || (medCategories[0] || 'Vaccination');
        const dueDay = parseInt(protoDueDay);
        const withholding = parseInt(protoWithholding);

        if (!label || !medicine || !dosage || isNaN(dueDay) || isNaN(withholding)) {
            setProtoError('Please enter all required fields.');
            return;
        }

        const id = 'proto_' + Date.now();
        const newProto = { id, label, dueDay, type, medicine, dosage, withholding };

        const updated = [...quarantineProtocols, newProto];
        updateQuarantineProtocols(updated);

        // Reset
        setProtoLabel('');
        setProtoDueDay('1');
        setProtoType('');
        setProtoMedicine('');
        setProtoDosage('');
        setProtoWithholding('0');
    };

    // Protocol Deletion
    const handleDeleteProtocol = (idToDelete) => {
        if (!isAdmin) return;
        if (window.confirm("Are you sure you want to delete this quarantine checklist item?")) {
            const updated = quarantineProtocols.filter(p => p.id !== idToDelete);
            updateQuarantineProtocols(updated);
        }
    };

    // Staff Access — toggle a single permission field for one user
    const handleTogglePermission = async (email, field, currentValue) => {
        if (!isPermsAdmin) return;
        setPermSavingEmail(email);
        setPermError('');
        const row = staffPermissions.find(p => p.email === email) || { isAdmin: false, accessSales: true, accessHerd: true };
        const updates = { isAdmin: row.isAdmin, accessSales: row.accessSales, accessHerd: row.accessHerd, [field]: !currentValue };
        const result = await updateStaffPermission(email, updates);
        if (!result.success) setPermError(result.error);
        setPermSavingEmail(null);
    };

    // Staff Access — pre-authorize an email (or edit an existing one) with default access
    const handleAddStaffEmail = async (e) => {
        e.preventDefault();
        if (!isPermsAdmin) return;
        const email = newStaffEmail.trim().toLowerCase();
        if (!email) return;
        setPermError('');
        const existing = staffPermissions.find(p => p.email === email);
        const result = await updateStaffPermission(email, existing || { isAdmin: false, accessSales: true, accessHerd: true });
        if (!result.success) {
            setPermError(result.error);
            return;
        }
        setNewStaffEmail('');
    };

    const handleRemoveStaff = async (email) => {
        if (!isPermsAdmin) return;
        if (window.confirm(`Revoke access for ${email}? They will no longer be able to log in.`)) {
            setPermSavingEmail(email);
            setPermError('');
            const result = await deleteStaffPermission(email);
            if (!result.success) setPermError(result.error);
            setPermSavingEmail(null);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            
            {/* Authenticated Role Info Card */}
            {!isAdmin && (
                <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)', fontSize: '1.4rem' }}></i>
                    <div>
                        <strong style={{ color: 'var(--text-pure)', display: 'block', fontSize: '0.92rem' }}>Read-only Access Alert</strong>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                            You are authenticated as <strong>{staffUser?.name || 'Guest'}</strong> ({staffUser?.role || 'Guest'}). Only Admin level accounts can adjust operational limits, breeds, categories, or quarantine checklists.
                        </span>
                    </div>
                </div>
            )}

            {/* settings internal tab switcher */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem', flexWrap: 'wrap' }}>
                <button 
                    class={`filter-btn ${activeSettingsTab === 'general' ? 'active' : ''}`} 
                    onClick={() => setActiveSettingsTab('general')}
                >
                    ⚙️ General Limits
                </button>
                <button 
                    class={`filter-btn ${activeSettingsTab === 'breeds' ? 'active' : ''}`} 
                    onClick={() => setActiveSettingsTab('breeds')}
                >
                    🐂 Breeds & Weights
                </button>
                <button 
                    class={`filter-btn ${activeSettingsTab === 'medicals' ? 'active' : ''}`} 
                    onClick={() => setActiveSettingsTab('medicals')}
                >
                    💊 Vet Categories
                </button>
                <button
                    class={`filter-btn ${activeSettingsTab === 'protocols' ? 'active' : ''}`}
                    onClick={() => setActiveSettingsTab('protocols')}
                >
                    ☣️ Quarantine Protocols
                </button>
                {isPermsAdmin && (
                    <button
                        class={`filter-btn ${activeSettingsTab === 'staffAccess' ? 'active' : ''}`}
                        onClick={() => setActiveSettingsTab('staffAccess')}
                    >
                        🔐 Staff Access
                    </button>
                )}
                {isPermsAdmin && (
                    <button
                        class={`filter-btn ${activeSettingsTab === 'approvals' ? 'active' : ''}`}
                        onClick={() => setActiveSettingsTab('approvals')}
                    >
                        🛡️ Approvals
                    </button>
                )}
            </div>

            {/* TAB CONTENT: GENERAL PARAMETERS */}
            {activeSettingsTab === 'general' && (
                <div class="glass-panel animate-scale-up">
                    <h3 class="panel-title"><i class="fa-solid fa-sliders"></i> Operational General Thresholds</h3>
                    <form onSubmit={handleSaveParams}>
                        <div class="form-grid-3">
                            <div class="form-group">
                                <label>Weighing Frequency Interval (Days)</label>
                                <input 
                                    type="number" 
                                    class="form-control" 
                                    value={weighIntervalDays}
                                    onChange={e => setWeighIntervalDays(e.target.value)}
                                    disabled={!isAdmin}
                                    required
                                />
                                <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.3rem' }}>Alerts on dashboard if an animal is not weighed within this interval.</small>
                            </div>
                            <div class="form-group">
                                <label>Quarantine Duration (Days)</label>
                                <input 
                                    type="number" 
                                    class="form-control" 
                                    value={quarantineDays}
                                    onChange={e => setQuarantineDays(e.target.value)}
                                    disabled={!isAdmin}
                                    required
                                />
                                <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.3rem' }}>Minimum days required in isolation before calves can be transitioned.</small>
                            </div>
                            <div class="form-group">
                                <label>Alert Target ADG Threshold (kg/day)</label>
                                <input 
                                    type="number" 
                                    step="0.05"
                                    class="form-control" 
                                    value={adgAlertThreshold}
                                    onChange={e => setAdgAlertThreshold(e.target.value)}
                                    disabled={!isAdmin}
                                    required
                                />
                                <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.3rem' }}>Triggers warning indicator if average daily gain falls below this value.</small>
                            </div>
                        </div>
                        
                        {isAdmin && (
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
                                <button type="submit" class="btn btn-secondary"><i class="fa-solid fa-floppy-disk"></i> Save General Settings</button>
                                {generalSaved && (
                                    <span style={{ fontSize: '0.85rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                        <i class="fa-solid fa-circle-check"></i> Threshold values updated.
                                    </span>
                                )}
                            </div>
                        )}
                    </form>
                </div>
            )}

            {/* TAB CONTENT: BREEDS & TARGET WEIGHTS */}
            {activeSettingsTab === 'breeds' && (
                <div class="tmr-grid">
                    
                    {/* Add Breed Form (Admin Only) */}
                    <div class="glass-panel animate-scale-up" style={{ alignSelf: 'flex-start' }}>
                        <h3 class="panel-title"><i class="fa-solid fa-plus-circle"></i> Register Breed</h3>
                        {isAdmin ? (
                            <form onSubmit={handleAddBreed} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                                {breedError && <p style={{ color: 'hsl(0,75%,60%)', fontSize: '0.8rem', margin: 0 }}>{breedError}</p>}
                                <div class="form-group">
                                    <label>Breed Identifier</label>
                                    <input 
                                        type="text" 
                                        class="form-control" 
                                        placeholder="e.g. Sahiwal Cross, Holstein" 
                                        value={newBreedName}
                                        onChange={e => setNewBreedName(e.target.value)}
                                        required
                                    />
                                </div>
                                <div class="form-group">
                                    <label>Default Target Weight (kg)</label>
                                    <input 
                                        type="number" 
                                        class="form-control" 
                                        placeholder="e.g. 380" 
                                        value={newBreedWeight}
                                        onChange={e => setNewBreedWeight(e.target.value)}
                                        required
                                    />
                                </div>
                                <button type="submit" class="btn btn-primary btn-block"><i class="fa-solid fa-circle-plus"></i> Add Breed Registry</button>
                            </form>
                        ) : (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                                Add breed forms are disabled in read-only Guest mode.
                            </p>
                        )}
                    </div>

                    {/* Breed List */}
                    <div class="glass-panel animate-scale-up">
                        <h3 class="panel-title"><i class="fa-solid fa-cow"></i> Active Breed Configurations</h3>
                        <div class="table-wrapper">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>BREED NAME</th>
                                        <th>DEFAULT TARGET WT</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '80px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {breedsConfig.map(b => (
                                        <tr key={b.name}>
                                            <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>{b.name}</td>
                                            <td><strong style={{ color: 'var(--accent-gold)' }}>{b.defaultTargetWeight} kg</strong></td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }}>
                                                    <button 
                                                        type="button" 
                                                        class="btn btn-secondary" 
                                                        style={{ padding: '0.2rem 0.5rem', minHeight: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                        onClick={() => handleDeleteBreed(b.name)}
                                                    >
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: MEDICAL CATEGORIES */}
            {activeSettingsTab === 'medicals' && (
                <div class="tmr-grid">
                    
                    {/* Add Category Form (Admin Only) */}
                    <div class="glass-panel animate-scale-up" style={{ alignSelf: 'flex-start' }}>
                        <h3 class="panel-title"><i class="fa-solid fa-plus-circle"></i> Add Category</h3>
                        {isAdmin ? (
                            <form onSubmit={handleAddMedCat} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                                {medCatError && <p style={{ color: 'hsl(0,75%,60%)', fontSize: '0.8rem', margin: 0 }}>{medCatError}</p>}
                                <div class="form-group">
                                    <label>Treatment Category Name</label>
                                    <input 
                                        type="text" 
                                        class="form-control" 
                                        placeholder="e.g. Antibiotic, Supplement" 
                                        value={newMedCat}
                                        onChange={e => setNewMedCat(e.target.value)}
                                        required
                                    />
                                </div>
                                <button type="submit" class="btn btn-primary btn-block"><i class="fa-solid fa-circle-plus"></i> Add Category</button>
                            </form>
                        ) : (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                                Add category forms are disabled in read-only Guest mode.
                            </p>
                        )}
                    </div>

                    {/* Category List */}
                    <div class="glass-panel animate-scale-up">
                        <h3 class="panel-title"><i class="fa-solid fa-prescription-bottle-medical"></i> Treatment Category Ledgers</h3>
                        <div class="table-wrapper">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>CATEGORY NAME</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '80px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {medCategories.map(cat => (
                                        <tr key={cat}>
                                            <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>{cat}</td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }}>
                                                    <button 
                                                        type="button" 
                                                        class="btn btn-secondary" 
                                                        style={{ padding: '0.2rem 0.5rem', minHeight: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                        onClick={() => handleDeleteMedCat(cat)}
                                                    >
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: QUARANTINE PROTOCOLS */}
            {activeSettingsTab === 'protocols' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    
                    {/* Add Checklist Item Form (Admin Only) */}
                    <div class="glass-panel animate-scale-up">
                        <h3 class="panel-title"><i class="fa-solid fa-circle-plus"></i> Configure Protocol Task Checklist</h3>
                        {isAdmin ? (
                            <form onSubmit={handleAddProtocol}>
                                {protoError && <p style={{ color: 'hsl(0,75%,60%)', fontSize: '0.8rem', marginBottom: '1rem' }}>{protoError}</p>}
                                <div class="form-grid-3">
                                    <div class="form-group">
                                        <label>Task Display Label *</label>
                                        <input 
                                            type="text" 
                                            class="form-control" 
                                            placeholder="e.g. Deworm, FMD Booster" 
                                            value={protoLabel}
                                            onChange={e => setProtoLabel(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div class="form-group">
                                        <label>Due On Day *</label>
                                        <input 
                                            type="number" 
                                            class="form-control" 
                                            min="1"
                                            value={protoDueDay}
                                            onChange={e => setProtoDueDay(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div class="form-group">
                                        <label>Treatment Category</label>
                                        <select 
                                            class="form-control" 
                                            value={protoType} 
                                            onChange={e => setProtoType(e.target.value)}
                                        >
                                            {medCategories.map(cat => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div class="form-grid-3" style={{ marginTop: '0.8rem' }}>
                                    <div class="form-group">
                                        <label>Medicine / Drug Name *</label>
                                        <input 
                                            type="text" 
                                            class="form-control" 
                                            placeholder="e.g. Ivermectin" 
                                            value={protoMedicine}
                                            onChange={e => setProtoMedicine(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div class="form-group">
                                        <label>Dosage *</label>
                                        <input 
                                            type="text" 
                                            class="form-control" 
                                            placeholder="e.g. 5ml" 
                                            value={protoDosage}
                                            onChange={e => setProtoDosage(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div class="form-group">
                                        <label>Withholding (Days)</label>
                                        <input 
                                            type="number" 
                                            class="form-control" 
                                            value={protoWithholding}
                                            onChange={e => setProtoWithholding(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.2rem' }}>
                                    <button type="submit" class="btn btn-primary" style={{ minWidth: '180px' }}><i class="fa-solid fa-plus-circle"></i> Add Checklist Step</button>
                                </div>
                            </form>
                        ) : (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', margin: 0 }}>
                                Protocol checklist creation is restricted to Admin staff.
                            </p>
                        )}
                    </div>

                    {/* Protocol Checklist Listing */}
                    <div class="glass-panel animate-scale-up">
                        <h3 class="panel-title"><i class="fa-solid fa-list-check"></i> Operational Quarantine Protocol Steps</h3>
                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>LABEL</th>
                                        <th>DUE DAY</th>
                                        <th>CATEGORY</th>
                                        <th>MEDICINE</th>
                                        <th>DOSAGE</th>
                                        <th>WITHHOLDING</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '80px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {quarantineProtocols.map(p => (
                                        <tr key={p.id}>
                                            <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>{p.label}</td>
                                            <td>Day <strong style={{ color: 'var(--accent-gold)' }}>{p.dueDay}</strong></td>
                                            <td>{p.type}</td>
                                            <td>{p.medicine}</td>
                                            <td>{p.dosage}</td>
                                            <td>{p.withholding > 0 ? `${p.withholding} Days` : '0 (None)'}</td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center' }}>
                                                    <button 
                                                        type="button" 
                                                        class="btn btn-secondary" 
                                                        style={{ padding: '0.2rem 0.5rem', minHeight: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                        onClick={() => handleDeleteProtocol(p.id)}
                                                    >
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    {quarantineProtocols.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 7 : 6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No quarantine protocol checklist steps configured. Calves can be cleared immediately.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: STAFF ACCESS (Super-Admin Only) */}
            {activeSettingsTab === 'staffAccess' && isPermsAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                    <div class="glass-panel animate-scale-up">
                        <h3 class="panel-title"><i class="fa-solid fa-user-plus"></i> Pre-Authorize Staff Email</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                            Add a staff email to grant it default access (Sales + Herd) before they first log in, or use this to jump to editing an existing user below.
                        </p>
                        <form onSubmit={handleAddStaffEmail} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            {permError && <p style={{ color: 'hsl(0,75%,60%)', fontSize: '0.8rem', width: '100%', margin: 0 }}>{permError}</p>}
                            <div class="form-group" style={{ flex: 1, minWidth: '240px', marginBottom: 0 }}>
                                <label>Staff Email</label>
                                <input
                                    type="email"
                                    class="form-control"
                                    placeholder="name@bafoods.pk"
                                    value={newStaffEmail}
                                    onChange={e => setNewStaffEmail(e.target.value)}
                                    required
                                />
                            </div>
                            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-circle-plus"></i> Add / Update</button>
                        </form>
                    </div>

                    <div class="glass-panel animate-scale-up">
                        <h3 class="panel-title"><i class="fa-solid fa-users-gear"></i> Staff Access Roster</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                            Sales covers e-commerce sales, export enquiries, store listings, and the Quotation/Spec Sheet creators. Herd covers rotation, herd registry, weights, vet logs, TMR, and the activity log.
                        </p>
                        <div class="table-wrapper">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>EMAIL</th>
                                        <th style={{ textAlign: 'center' }}>SALES ACCESS</th>
                                        <th style={{ textAlign: 'center' }}>HERD ACCESS</th>
                                        <th style={{ textAlign: 'center' }}>SUPER ADMIN</th>
                                        <th style={{ textAlign: 'center' }}>REVOKE ACCESS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {staffPermissions.map(p => (
                                        <tr key={p.email}>
                                            <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                                {p.email}
                                                {p.email === staffUser?.email && (
                                                    <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent-gold)' }}>(you)</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={p.accessSales}
                                                    disabled={permSavingEmail === p.email}
                                                    onChange={() => handleTogglePermission(p.email, 'accessSales', p.accessSales)}
                                                />
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={p.accessHerd}
                                                    disabled={permSavingEmail === p.email}
                                                    onChange={() => handleTogglePermission(p.email, 'accessHerd', p.accessHerd)}
                                                />
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={p.isAdmin}
                                                    disabled={permSavingEmail === p.email}
                                                    onChange={() => handleTogglePermission(p.email, 'isAdmin', p.isAdmin)}
                                                />
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {p.email !== staffUser?.email ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem', color: 'hsl(0,75%,70%)', borderColor: 'rgba(220,53,69,0.3)' }}
                                                        disabled={permSavingEmail === p.email}
                                                        onClick={() => handleRemoveStaff(p.email)}
                                                        title="Revoke staff access"
                                                    >
                                                        <i className="fa-solid fa-user-minus"></i> Remove
                                                    </button>
                                                ) : (
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {staffPermissions.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No staff members have logged in yet, or none have been pre-authorized.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: APPROVALS AUDIT HISTORY (Super-Admin Only) */}
            {activeSettingsTab === 'approvals' && isPermsAdmin && (
                <div class="glass-panel animate-scale-up">
                    <h3 class="panel-title"><i class="fa-solid fa-user-shield"></i> Sensitive-Field Approval History</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                        Every entry-weight/purchase-price edit and animal deletion request submitted by non-admin staff, all-time — including who requested it, who reviewed it, and any rejection reason. Live open requests are also reviewable from the Approvals badge in the header.
                    </p>

                    <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                            type="text"
                            class="form-control"
                            style={{ maxWidth: '280px' }}
                            placeholder="Search tag, breed, or requester..."
                            value={approvalsSearch}
                            onChange={e => setApprovalsSearch(e.target.value)}
                        />
                        {['All', 'Pending', 'Approved', 'Rejected'].map(s => (
                            <button
                                key={s}
                                class={`filter-btn ${approvalsStatusFilter === s ? 'active' : ''}`}
                                onClick={() => setApprovalsStatusFilter(s)}
                            >
                                {s} {s !== 'All' && `(${allApprovals.filter(a => a.status === s.toLowerCase()).length})`}
                            </button>
                        ))}
                    </div>

                    <div class="table-wrapper">
                        <table class="data-table" style={{ fontSize: '0.85rem' }}>
                            <thead>
                                <tr>
                                    <th>ITEM / ENTITY</th>
                                    <th>REQUEST</th>
                                    <th>REQUESTED BY</th>
                                    <th>REQUESTED AT</th>
                                    <th>STATUS</th>
                                    <th>REVIEWED BY</th>
                                    <th>NOTE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredApprovals.map(a => (
                                    <tr key={a.id}>
                                        <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                            {a.animalRfid || (a.animalId ? `#${a.animalId}` : (a.previousSnapshot?.name || a.previousSnapshot?.title || a.previousSnapshot?.doc_ref || a.payload?.id || a.payload?.orderId || a.payload?.enquiryId || a.payload?.quoteId || a.payload?.refId || `ID ${a.id}`))}
                                            {a.animalBreed && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({a.animalBreed})</span>}
                                        </td>
                                        <td>
                                            <strong style={{ display: 'block', fontSize: '0.82rem' }}>
                                                {(() => {
                                                    switch (a.action) {
                                                        case 'DELETE_ANIMAL': return 'Delete Animal';
                                                        case 'UPDATE_ANIMAL': return 'Edit Animal';
                                                        case 'DELETE_FEED_PURCHASE': return 'Delete Feed Purchase';
                                                        case 'DELETE_FEED_STOCK_ISSUE': return 'Delete Feed Stock Issue';
                                                        case 'DELETE_WEIGHT_LOG': return 'Delete Weight Log';
                                                        case 'DELETE_TREATMENT': return 'Delete Treatment';
                                                        case 'DELETE_FEED_LOG': return 'Delete Feed Log';
                                                        case 'DELETE_RATION_PLAN': return 'Delete Ration Plan';
                                                        case 'DELETE_PEN': return 'Delete Pen';
                                                        case 'DELETE_ORDER': return 'Delete Order';
                                                        case 'DELETE_ENQUIRY': return 'Delete Export Enquiry';
                                                        case 'DELETE_QUOTATION': return 'Delete Quotation';
                                                        case 'DELETE_SPEC_SHEET': return 'Delete Spec Sheet';
                                                        case 'DELETE_MEAT_CUT': return 'Delete Meat Cut';
                                                        default: return a.action;
                                                    }
                                                })()}
                                            </strong>
                                            {a.action === 'UPDATE_ANIMAL' && a.payload && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    {a.payload.entryWeight !== undefined && <div>Entry Weight → {a.payload.entryWeight} kg</div>}
                                                    {a.payload.purchasePrice !== undefined && <div>Purchase Price → {a.payload.purchasePrice?.toLocaleString()} PKR</div>}
                                                </div>
                                            )}
                                            {a.action === 'DELETE_FEED_PURCHASE' && a.previousSnapshot && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    {a.previousSnapshot.quantity} kg (Supplier: {a.previousSnapshot.supplier || 'N/A'})
                                                </div>
                                            )}
                                            {a.action === 'DELETE_FEED_STOCK_ISSUE' && a.previousSnapshot && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    {a.previousSnapshot.quantity} kg to Pen {a.previousSnapshot.pen || 'ALL'}
                                                </div>
                                            )}
                                            {a.action === 'DELETE_ORDER' && a.previousSnapshot && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    Customer: {a.previousSnapshot.customer_name} (PKR {a.previousSnapshot.net_total})
                                                </div>
                                            )}
                                        </td>
                                        <td>{a.requestedBy}</td>
                                        <td>{new Date(a.requestedAt).toLocaleString()}</td>
                                        <td>
                                            <span style={{
                                                fontSize: '0.72rem', padding: '0.1rem 0.5rem', borderRadius: '4px',
                                                background: a.status === 'approved' ? 'rgba(25,135,84,0.12)' : a.status === 'rejected' ? 'rgba(220,53,69,0.12)' : 'rgba(255,193,7,0.12)',
                                                color: a.status === 'approved' ? 'var(--primary-green-light)' : a.status === 'rejected' ? 'hsl(0, 75%, 65%)' : 'hsl(43,90%,53%)'
                                            }}>
                                                {a.status.toUpperCase()}
                                            </span>
                                        </td>
                                        <td>{a.reviewedBy || '—'}</td>
                                        <td style={{ color: a.reviewNote ? 'hsl(0, 75%, 70%)' : 'var(--text-muted)' }}>{a.reviewNote || '—'}</td>
                                    </tr>
                                ))}
                                {filteredApprovals.length === 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                            No approval requests match your filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

        </div>
    );
}
