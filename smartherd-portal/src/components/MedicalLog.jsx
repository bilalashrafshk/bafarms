import React, { useContext, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, todayAsDate, parseDateOnly } from '../utils/dateOnly';

export default function MedicalLog() {
    const {
        animals, treatments, addTreatment, deleteTreatment, medCategories,
        feedStockItems, feedPurchases, addStockTrackedIngredient, addFeedPurchase, addFeedStockIssue,
        getFeedStockLedger, getFeedStockLots, getFeedStockIssueCosts
    } = useContext(FarmContext);

    // Filter tracked medicine items from the store ledger
    const medicineItems = feedStockItems.filter(i => (i.category || 'feed') === 'medicine');
    const stockLedger = getFeedStockLedger();
    const stockQtyOf = (itemId) => stockLedger.find(r => r.item.id === itemId)?.closingQty ?? 0;
    const issueCosts = getFeedStockIssueCosts();

    // Form states
    const [selectedAnimal, setSelectedAnimal] = useState('');
    const [tagSearch, setTagSearch] = useState('');
    const [tagOpen, setTagOpen] = useState(false);
    const [date, setDate] = useState(todayPKT());
    const [type, setType] = useState('');
    
    // Unified medicine & unit selection
    const [selectedMedMode, setSelectedMedMode] = useState('inventory'); // 'inventory' | 'new' | 'manual'
    const [selectedMedId, setSelectedMedId] = useState(medicineItems[0]?.id || '');
    const [dosageQty, setDosageQty] = useState('1');
    const [manualMedName, setManualMedName] = useState('');
    const [manualDosage, setManualDosage] = useState('');
    const [newMedName, setNewMedName] = useState('');
    const [newMedUnit, setNewMedUnit] = useState('unit');
    const [newMedRate, setNewMedRate] = useState('');
    
    const [withholding, setWithholding] = useState('0');
    const [isSuccess, setIsSuccess] = useState(false);

    // Selected stock item helper
    const activeStockItem = medicineItems.find(i => i.id === selectedMedId);
    const activeUnit = activeStockItem?.unit || 'unit';
    const activeLots = activeStockItem ? getFeedStockLots(activeStockItem.id) : [];
    const activeRate = activeLots[0]?.rate || (feedPurchases.find(p => p.itemId === activeStockItem?.id)?.rate) || 0;
    const activeStockQty = activeStockItem ? stockQtyOf(activeStockItem.id) : 0;

    // Reset form helper
    const resetForm = () => {
        setSelectedAnimal('');
        setTagSearch('');
        setDosageQty('1');
        setManualMedName('');
        setManualDosage('');
        setNewMedName('');
        setNewMedUnit('unit');
        setNewMedRate('');
        setWithholding('0');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedAnimal) {
            alert('Please select an animal.');
            return;
        }

        let medName = '';
        let finalDosage = '';
        let stockIssueId = null;

        const animalObj = animals.find(a => a.id === parseInt(selectedAnimal));
        const pen = animalObj?.pen || 'ALL';

        if (selectedMedMode === 'inventory') {
            if (!activeStockItem) {
                alert('Please select a medicine from stock.');
                return;
            }
            const qty = parseFloat(dosageQty) || 0;
            if (qty <= 0) {
                alert(`Enter a valid quantity/dosage in ${activeUnit} (e.g. 1, 0.5, 0.1).`);
                return;
            }
            medName = activeStockItem.name;
            finalDosage = `${qty} ${activeUnit}`;
            stockIssueId = `fi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            await addFeedStockIssue({
                id: stockIssueId,
                itemId: activeStockItem.id,
                date,
                pen,
                quantity: qty,
                notes: `Treatment stock draw — ${animalObj?.rfid || selectedAnimal}, ${medName} (${finalDosage})`
            });
        } else if (selectedMedMode === 'new') {
            const name = newMedName.trim();
            const rate = parseFloat(newMedRate);
            const qty = parseFloat(dosageQty) || 0;
            const unit = newMedUnit.trim() || 'unit';
            if (!name || isNaN(rate) || rate < 0 || qty <= 0) {
                alert('Please enter a medicine name, price/unit, and quantity.');
                return;
            }
            medName = name;
            finalDosage = `${qty} ${unit}`;
            const itemId = addStockTrackedIngredient(name, 'medicine', unit);
            await addFeedPurchase({
                itemId,
                itemName: name,
                itemUnit: unit,
                date,
                quantity: qty,
                rate,
                supplier: 'Direct purchase (treatment)',
                notes: `Backfilled for treatment — ${name} (${finalDosage})`
            });
            stockIssueId = `fi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            await addFeedStockIssue({
                id: stockIssueId,
                itemId,
                date,
                pen,
                quantity: qty,
                notes: `Treatment stock draw — ${animalObj?.rfid || selectedAnimal}, ${medName} (${finalDosage})`
            });
        } else {
            // Manual / non-inventory
            medName = manualMedName.trim();
            finalDosage = manualDosage.trim();
            if (!medName || !finalDosage) {
                alert('Please enter a medicine name and dosage.');
                return;
            }
        }

        await addTreatment(
            selectedAnimal,
            date,
            type || (medCategories[0] || 'Vaccination'),
            medName,
            finalDosage,
            parseInt(withholding) || 0,
            null,
            stockIssueId
        );

        resetForm();
        setIsSuccess(true);
        setTimeout(() => setIsSuccess(false), 3000);
    };

    const tagSuggestions = (() => {
        const q = tagSearch.trim().toLowerCase();
        const pool = animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased');
        if (!q) return pool.slice(0, 8);
        return pool.filter(a =>
            a.rfid.toLowerCase().includes(q) ||
            a.breed.toLowerCase().includes(q) ||
            (a.pen && a.pen.toLowerCase().includes(q))
        ).slice(0, 10);
    })();

    const selectAnimalFromPicker = (animal) => {
        setSelectedAnimal(String(animal.id));
        setTagSearch(animal.rfid);
        setTagOpen(false);
    };

    const checkWithholdingActive = (tDate, wDays) => {
        if (!wDays || wDays <= 0) return 0;
        const treated = parseDateOnly(tDate);
        const today = todayAsDate();
        const diffDays = Math.floor((today - treated) / (1000 * 60 * 60 * 24));
        const remaining = wDays - diffDays;
        return remaining > 0 ? remaining : 0;
    };

    const getRfid = (animalId) => {
        const a = animals.find(an => an.id === animalId);
        return a ? a.rfid : `ID: ${animalId}`;
    };

    // Calculate treatment cost reliably for table display
    const getTreatmentCostDisplay = (t) => {
        if (t.stockIssueId && issueCosts[t.stockIssueId]?.cost) {
            return `${Math.round(issueCosts[t.stockIssueId].cost).toLocaleString()} PKR`;
        }
        // Match medicine name against stock items
        const rawMed = (t.medicine || '').toLowerCase();
        const matched = feedStockItems.find(i => {
            const iname = (i.name || '').toLowerCase();
            return iname && (rawMed.includes(iname) || iname.includes(rawMed.replace('inj.', '').trim()));
        });
        if (matched) {
            const purchases = feedPurchases.filter(p => p.itemId === matched.id);
            const rate = purchases[0]?.rate || 0;
            if (rate > 0) {
                const match = (t.dosage || t.medicine || '').match(/([\d.]+)\s*(ml|unit|dose|pc|kg)?/i);
                const doseVal = match ? parseFloat(match[1]) : 1;
                const bottleMatch = matched.name.match(/(\d+)\s*ml/i);
                let multiplier = doseVal;
                if (matched.unit === 'pc' && match && match[2]?.toLowerCase() === 'ml' && bottleMatch) {
                    multiplier = doseVal / parseFloat(bottleMatch[1]);
                }
                const cost = Math.round(multiplier * rate);
                return `${cost.toLocaleString()} PKR`;
            }
        }
        return '—';
    };

    const sortedTreatments = [...treatments].sort((a, b) => {
        const da = parseDateOnly(a.date);
        const db = parseDateOnly(b.date);
        return db - da || b.id - a.id;
    });

    const pickerAnchorRef = useRef(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

    useEffect(() => {
        if (!tagOpen || !pickerAnchorRef.current) return;
        const rect = pickerAnchorRef.current.getBoundingClientRect();
        setDropdownPos({
            top: rect.bottom + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width
        });
    }, [tagOpen]);

    return (
        <div className="medical-log-page">
            
            {/* Action Bar / Form Container */}
            <div className="glass-panel" style={{ marginBottom: '2rem' }}>
                <h3 className="panel-title">
                    <i className="fa-solid fa-syringe" style={{ color: 'var(--primary-green-light)' }}></i> 
                    Record Animal Treatment
                </h3>

                <div className="form-wrapper">
                    <form onSubmit={handleSubmit} className="medical-form">
                        
                        {/* Row 1: Animal, Category, Medicine, Dosage */}
                        <div className="form-inline-grid-med">
                            <div className="form-group" style={{ position: 'relative' }}>
                                <label>Animal RFID / Tag *</label>
                                <div className="combobox-wrapper" ref={pickerAnchorRef}>
                                    <input 
                                        type="text" 
                                        className="form-control" 
                                        placeholder="Type RFID or select…"
                                        value={tagSearch}
                                        onChange={(e) => {
                                            setTagSearch(e.target.value);
                                            setSelectedAnimal('');
                                            setTagOpen(true);
                                        }}
                                        onFocus={() => setTagOpen(true)}
                                        required={!selectedAnimal}
                                    />
                                    {selectedAnimal && (
                                        <button 
                                            type="button"
                                            className="combobox-clear"
                                            onClick={() => {
                                                setSelectedAnimal('');
                                                setTagSearch('');
                                            }}
                                        >
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    )}
                                </div>
                                {tagOpen && createPortal(
                                    <div 
                                        className="combobox-dropdown"
                                        style={{
                                            position: 'absolute',
                                            top: dropdownPos.top,
                                            left: dropdownPos.left,
                                            width: dropdownPos.width,
                                            zIndex: 9999
                                        }}
                                    >
                                        {tagSuggestions.map(a => (
                                            <button
                                                key={a.id}
                                                type="button"
                                                className={`combobox-option ${String(a.id) === selectedAnimal ? 'selected' : ''}`}
                                                onClick={() => selectAnimalFromPicker(a)}
                                            >
                                                <strong>{a.rfid}</strong>
                                                <span className="combobox-meta">{a.breed} · Pen {a.pen || 'None'}</span>
                                            </button>
                                        ))}
                                    </div>,
                                    document.body
                                )}
                            </div>

                            <div className="form-group">
                                <label>Category</label>
                                <select className="form-control" value={type || (medCategories[0] || 'Vaccination')} onChange={(e) => setType(e.target.value)}>
                                    {medCategories.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Medicine Source *</label>
                                <select 
                                    className="form-control"
                                    value={selectedMedMode === 'inventory' ? selectedMedId : (selectedMedMode === 'new' ? '__new__' : '__manual__')}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        if (v === '__new__') {
                                            setSelectedMedMode('new');
                                        } else if (v === '__manual__') {
                                            setSelectedMedMode('manual');
                                        } else {
                                            setSelectedMedMode('inventory');
                                            setSelectedMedId(v);
                                        }
                                    }}
                                >
                                    <optgroup label="Tracked Medicine Stock">
                                        {medicineItems.map(item => (
                                            <option key={item.id} value={item.id}>
                                                {item.name} ({(Number(stockQtyOf(item.id)) || 0).toFixed(2)} {item.unit} on hand)
                                            </option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Other Options">
                                        <option value="__new__">+ Register New Medicine…</option>
                                        <option value="__manual__">Manual / Non-inventory Entry</option>
                                    </optgroup>
                                </select>
                            </div>

                            {selectedMedMode === 'inventory' && (
                                <div className="form-group">
                                    <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Dosage ({activeUnit}) *</span>
                                        {activeRate > 0 && (
                                            <span style={{ color: 'var(--accent-gold)', fontSize: '0.75rem', fontWeight: 600 }}>
                                                ~{Math.round((parseFloat(dosageQty) || 0) * activeRate).toLocaleString()} PKR
                                            </span>
                                        )}
                                    </label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <input 
                                            type="number"
                                            step="any"
                                            min="0.001"
                                            className="form-control" 
                                            placeholder="e.g. 1, 0.5, 0.1"
                                            value={dosageQty}
                                            onChange={(e) => setDosageQty(e.target.value)}
                                            required
                                        />
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, minWidth: '32px' }}>
                                            {activeUnit}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {selectedMedMode === 'manual' && (
                                <>
                                    <div className="form-group">
                                        <label>Medicine Name *</label>
                                        <input 
                                            type="text" 
                                            className="form-control" 
                                            placeholder="e.g. Antibiotic"
                                            value={manualMedName}
                                            onChange={(e) => setManualMedName(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Dosage *</label>
                                        <input 
                                            type="text" 
                                            className="form-control" 
                                            placeholder="e.g. 10ml, 1 dose"
                                            value={manualDosage}
                                            onChange={(e) => setManualDosage(e.target.value)}
                                            required
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        {/* New Medicine Mode Sub-form */}
                        {selectedMedMode === 'new' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.8rem', marginTop: '0.5rem', marginBottom: '0.8rem', padding: '0.8rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>Medicine Name *</label>
                                    <input type="text" className="form-control" placeholder="e.g. Loxin 100ml" value={newMedName} onChange={(e) => setNewMedName(e.target.value)} required />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>Unit *</label>
                                    <input type="text" className="form-control" placeholder="pc, ml, dose…" value={newMedUnit} onChange={(e) => setNewMedUnit(e.target.value)} required />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>Dosage ({newMedUnit}) *</label>
                                    <input type="number" step="any" min="0.001" className="form-control" value={dosageQty} onChange={(e) => setDosageQty(e.target.value)} required />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ fontSize: '0.75rem' }}>Price / Unit (PKR) *</label>
                                    <input type="number" min="0" step="any" className="form-control" placeholder="PKR" value={newMedRate} onChange={(e) => setNewMedRate(e.target.value)} required />
                                </div>
                            </div>
                        )}

                        {/* Row 2: Date, Withholding, Submit Button */}
                        <div className="form-inline-grid-med-row2" style={{ marginTop: '0.6rem' }}>
                            <div className="form-group">
                                <label>Treatment Date</label>
                                <input 
                                    type="date" 
                                    className="form-control" 
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label>Withholding (Days)</label>
                                <input 
                                    type="number" 
                                    min="0"
                                    className="form-control" 
                                    placeholder="e.g. 14"
                                    value={withholding}
                                    onChange={(e) => setWithholding(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <button type="submit" className="btn btn-primary btn-block" style={{ width: '100%', height: '42px' }}>
                                    <i className="fa-solid fa-floppy-disk" style={{ marginRight: '0.4rem' }}></i> Save Treatment
                                </button>
                            </div>
                        </div>

                        {isSuccess && (
                            <div style={{ marginTop: '1.2rem', padding: '0.8rem', background: 'rgba(25,135,84,0.1)', border: '1px solid var(--primary-green-light)', borderRadius: '8px', color: 'var(--primary-green-light)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
                                <i className="fa-solid fa-circle-check"></i>
                                Treatment saved and medicine stock updated.
                            </div>
                        )}

                    </form>
                </div>

            </div>

            {/* Historical list */}
            <div className="glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h3 className="panel-title" style={{ margin: 0 }}>
                        <i className="fa-solid fa-clock-rotate-left"></i> Treatment History
                    </h3>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {sortedTreatments.length} record{sortedTreatments.length === 1 ? '' : 's'} logged
                    </span>
                </div>
                
                {/* Table */}
                <div className="table-wrapper">
                    <table className="data-table" style={{ fontSize: '0.85rem' }}>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>RFID</th>
                                <th>DATE</th>
                                <th>CATEGORY</th>
                                <th>MEDICINE</th>
                                <th style={{ textAlign: 'right' }} title="FIFO actual cost of medicine used">COST</th>
                                <th>WTHLD</th>
                                <th>STATUS</th>
                                <th style={{ textAlign: 'center', width: '60px' }}>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedTreatments.map((t) => {
                                const daysRemaining = checkWithholdingActive(t.date, t.withholding);
                                const costDisplay = getTreatmentCostDisplay(t);
                                return (
                                    <tr key={t.id}>
                                        <td>#{t.id}</td>
                                        <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', color: 'var(--text-pure)' }}>
                                            {getRfid(t.animalId)}
                                        </td>
                                        <td>{formatDate(t.date)}</td>
                                        <td>
                                            <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.45rem', borderRadius: '6px', background: 'rgba(255,255,255,0.06)' }}>
                                                {t.type}
                                            </span>
                                        </td>
                                        <td>
                                            <strong>{t.medicine}</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>({t.dosage})</span>
                                        </td>
                                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: costDisplay === '—' ? 'var(--text-muted)' : 'var(--accent-gold)' }}>
                                            {costDisplay}
                                        </td>
                                        <td>{t.withholding} Days</td>
                                        <td>
                                            {daysRemaining > 0 ? (
                                                <span style={{ color: 'hsl(0, 75%, 55%)', fontWeight: '700', fontSize: '0.78rem' }}>
                                                    <i className="fa-solid fa-circle-xmark" style={{ marginRight: '0.3rem' }}></i>
                                                    {daysRemaining}d LOCKED
                                                </span>
                                            ) : (
                                                <span style={{ color: 'var(--primary-green-light)', fontWeight: '600', fontSize: '0.78rem' }}>
                                                    <i className="fa-solid fa-circle-check" style={{ marginRight: '0.3rem' }}></i>
                                                    CLEAR
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                <button className="btn btn-secondary" style={{ minHeight: '26px', height: '26px', padding: '0.1rem 0.45rem', fontSize: '0.72rem', borderColor: 'rgba(220, 53, 69, 0.15)', color: 'hsl(0, 75%, 65%)', background: 'rgba(220, 53, 69, 0.01)' }} onClick={() => {
                                                    if (window.confirm("Delete this treatment record?")) {
                                                        deleteTreatment(t.id);
                                                    }
                                                }} title="Delete treatment">
                                                    <i className="fa-solid fa-trash-can"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {sortedTreatments.length === 0 && (
                                <tr>
                                    <td colSpan="9" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                        <i className="fa-solid fa-prescription-bottle-medical" style={{ fontSize: '2rem', marginBottom: '0.8rem', display: 'block', color: 'var(--text-muted)', opacity: '0.8' }}></i>
                                        No veterinary treatment records logged in the database yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

            </div>

        </div>
    );
}
