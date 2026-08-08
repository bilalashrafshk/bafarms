import React, { useContext, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, todayAsDate, parseDateOnly } from '../utils/dateOnly';

export default function MedicalLog() {
    const { animals, treatments, addTreatment, deleteTreatment, medCategories } = useContext(FarmContext);

    // Form states
    const [selectedAnimal, setSelectedAnimal] = useState('');
    const [tagSearch, setTagSearch] = useState('');
    const [tagOpen, setTagOpen] = useState(false);
    const [date, setDate] = useState(todayPKT());
    const [type, setType] = useState('');
    const [medicine, setMedicine] = useState('');
    const [dosage, setDosage] = useState('');
    const [withholding, setWithholding] = useState('0');
    const [isSuccess, setIsSuccess] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!selectedAnimal || !medicine || !dosage) return;

        addTreatment(
            selectedAnimal,
            date,
            type || (medCategories[0] || 'Vaccination'),
            medicine,
            dosage,
            parseInt(withholding)
        );

        setSelectedAnimal('');
        setTagSearch('');
        setMedicine('');
        setDosage('');
        setWithholding('0');
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

    // Portaled to <body> and positioned via this rect — .glass-panel has
    // overflow:hidden, which clips an absolutely-positioned dropdown whenever the
    // panel's bottom edge sits close below the input (e.g. desktop, where this
    // row's fields sit side by side). See WeightTracker.jsx for the same fix.
    const tagFieldRef = useRef(null);
    const [tagDropdownRect, setTagDropdownRect] = useState(null);

    useEffect(() => {
        if (!tagOpen) return;
        const updateRect = () => {
            if (tagFieldRef.current) {
                const r = tagFieldRef.current.getBoundingClientRect();
                setTagDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
            }
        };
        updateRect();
        window.addEventListener('scroll', updateRect, true);
        window.addEventListener('resize', updateRect);
        return () => {
            window.removeEventListener('scroll', updateRect, true);
            window.removeEventListener('resize', updateRect);
        };
    }, [tagOpen, tagSearch]);

    // Sort treatment logs by date descending
    const sortedTreatments = [...treatments].sort((a, b) => new Date(b.date) - new Date(a.date));

    const getRfid = (animalId) => {
        const animal = animals.find(a => a.id === animalId);
        return animal ? animal.rfid : `Unknown (ID #${animalId})`;
    };

    // Calculate active withholding status for rows. Uses Math.floor (not round) so a
    // period isn't shown as cleared up to ~12 hours before it actually elapses.
    const checkWithholdingActive = (treatmentDate, withholdingDays) => {
        const msDiff = todayAsDate() - parseDateOnly(treatmentDate);
        const daysPassed = Math.floor(msDiff / (1000 * 60 * 60 * 24));
        return daysPassed < withholdingDays ? (withholdingDays - daysPassed) : 0;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            
            <div>

                {/* Form to log medical treatment */}
                <div class="glass-panel">
                    <h3 class="panel-title" style={{ marginBottom: '1.2rem' }}><i class="fa-solid fa-file-prescription"></i> Log Treatment</h3>
                    
                    <form onSubmit={handleSubmit}>
                        
                        {selectedAnimal && (() => {
                            const a = animals.find(x => x.id === parseInt(selectedAnimal));
                            return a ? (
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.5rem 0.85rem', marginBottom: '1rem', background: 'rgba(25,135,84,0.07)', border: '1px solid rgba(25,135,84,0.2)', borderRadius: '8px', fontSize: '0.82rem' }}>
                                    <i class="fa-solid fa-microchip" style={{ color: 'var(--accent-gold)' }}></i>
                                    <strong style={{ color: 'var(--text-pure)' }}>{a.rfid}</strong>
                                    <span style={{ color: 'var(--text-muted)' }}>{a.breed}</span>
                                    {a.pen && <span style={{ color: 'var(--accent-gold)' }}>Pen {a.pen}</span>}
                                    <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto', fontSize: '0.9rem' }} onClick={() => { setSelectedAnimal(''); setTagSearch(''); }}>✕</button>
                                </div>
                            ) : null;
                        })()}

                        {/* Row 1: Animal, Category, Medicine, Dosage */}
                        <div class="form-inline-grid-med-row1">
                            <div class="form-group" style={{ position: 'relative' }} ref={tagFieldRef}>
                                <label>Tag Number</label>
                                <input
                                    type="text"
                                    class="form-control"
                                    placeholder="Type tag or scan..."
                                    value={tagSearch}
                                    onChange={e => { setTagSearch(e.target.value); setSelectedAnimal(''); setTagOpen(true); }}
                                    onFocus={() => setTagOpen(true)}
                                    onBlur={() => setTimeout(() => setTagOpen(false), 150)}
                                    autoComplete="off"
                                />
                                {tagOpen && tagSuggestions.length > 0 && tagDropdownRect && createPortal(
                                    <div style={{ position: 'fixed', top: tagDropdownRect.top, left: tagDropdownRect.left, width: tagDropdownRect.width, zIndex: 9999, background: 'hsl(210,15%,8%)', border: '1px solid var(--border-subtle)', borderRadius: '8px', maxHeight: '240px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                                        {tagSuggestions.map(a => (
                                            <button key={a.id} type="button"
                                                style={{ display: 'flex', width: '100%', padding: '0.65rem 1rem', gap: '0.8rem', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', textAlign: 'left' }}
                                                onMouseDown={() => selectAnimalFromPicker(a)}>
                                                <strong style={{ color: 'var(--text-pure)', fontFamily: 'var(--font-heading)', minWidth: '48px', fontSize: '1rem' }}>{a.rfid}</strong>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{a.breed}</span>
                                                {a.pen && <span style={{ fontSize: '0.75rem', color: 'var(--accent-gold)' }}>Pen {a.pen}</span>}
                                                <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', marginLeft: 'auto', fontWeight: '600' }}>{a.currentWeight} kg</span>
                                            </button>
                                        ))}
                                    </div>,
                                    document.body
                                )}
                            </div>

                            <div class="form-group">
                                <label>Category</label>
                                <select class="form-control" value={type || (medCategories[0] || 'Vaccination')} onChange={(e) => setType(e.target.value)}>
                                    {medCategories.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Medicine Name *</label>
                                <input 
                                    type="text" 
                                    class="form-control" 
                                    placeholder="e.g. FMD Vaccine"
                                    value={medicine}
                                    onChange={(e) => setMedicine(e.target.value)}
                                    required
                                />
                            </div>

                            <div class="form-group">
                                <label>Dosage Volume *</label>
                                <input 
                                    type="text" 
                                    class="form-control" 
                                    placeholder="e.g. 5ml, 10cc"
                                    value={dosage}
                                    onChange={(e) => setDosage(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        {/* Row 2: Date, Withholding, Submit Button */}
                        <div class="form-inline-grid-med-row2">
                            <div class="form-group">
                                <label>Treatment Date</label>
                                <input 
                                    type="date" 
                                    class="form-control" 
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    required
                                />
                            </div>

                            <div class="form-group">
                                <label>Withholding (Days)</label>
                                <input 
                                    type="number" 
                                    min="0"
                                    class="form-control" 
                                    placeholder="e.g. 14"
                                    value={withholding}
                                    onChange={(e) => setWithholding(e.target.value)}
                                    required
                                />
                            </div>

                            <div class="form-group">
                                <button type="submit" class="btn btn-primary btn-block" style={{ width: '100%' }}>
                                    Save Treatment
                                </button>
                            </div>
                        </div>

                        {isSuccess && (
                            <div style={{ marginTop: '1.2rem', padding: '0.8rem', background: 'rgba(25,135,84,0.1)', border: '1px solid var(--primary-green-light)', borderRadius: '8px', color: 'var(--primary-green-light)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
                                <i class="fa-solid fa-circle-check"></i>
                                Treatment saved.
                            </div>
                        )}

                    </form>
                </div>

            </div>

            {/* Historical list */}
            <div className="glass-panel">
                <h3 className="panel-title"><i className="fa-solid fa-clock-rotate-left"></i> Treatment History</h3>
                
                {/* Table */}
                <div className="table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>RFID</th>
                                <th>DATE</th>
                                <th>CATEGORY</th>
                                <th>MEDICINE</th>
                                <th>WTHLD</th>
                                <th>STATUS</th>
                                <th style={{ textAlign: 'center' }}>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedTreatments.map((t) => {
                                const daysRemaining = checkWithholdingActive(t.date, t.withholding);
                                return (
                                    <tr key={t.id}>
                                        <td>#{t.id}</td>
                                        <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', color: 'var(--text-pure)' }}>
                                            {getRfid(t.animalId)}
                                        </td>
                                        <td>{formatDate(t.date)}</td>
                                        <td>{t.type}</td>
                                        <td><strong>{t.medicine}</strong> ({t.dosage})</td>
                                        <td>{t.withholding} Days</td>
                                        <td>
                                            {daysRemaining > 0 ? (
                                                <span style={{ color: 'hsl(0, 75%, 55%)', fontWeight: '700' }}>
                                                    <i className="fa-solid fa-circle-xmark" style={{ marginRight: '0.3rem' }}></i>
                                                    {daysRemaining}d LOCKED
                                                </span>
                                            ) : (
                                                <span style={{ color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                                    <i className="fa-solid fa-circle-check" style={{ marginRight: '0.3rem' }}></i>
                                                    CLEAR
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(220, 53, 69, 0.15)', color: 'hsl(0, 75%, 65%)', background: 'rgba(220, 53, 69, 0.01)' }} onClick={() => {
                                                    if (window.confirm("Delete this treatment record?")) {
                                                        deleteTreatment(t.id);
                                                    }
                                                }}>
                                                    <i className="fa-solid fa-trash-can"></i> Del
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {sortedTreatments.length === 0 && (
                                <tr>
                                    <td colSpan="8" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
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
