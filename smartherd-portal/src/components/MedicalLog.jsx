import React, { useContext, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT, todayAsDate, parseDateOnly } from '../utils/dateOnly';

export default function MedicalLog() {
    const {
        animals, treatments, addTreatment, deleteTreatment, medCategories,
        feedStockItems, addStockTrackedIngredient, addFeedPurchase, addFeedStockIssue,
        getFeedStockLedger, getFeedStockIssueCosts
    } = useContext(FarmContext);

    // Medicine is just another category on the same category-agnostic FIFO stock system
    // feed already uses (feedStockItems/feedPurchases/feedStockIssues) — see Feed Stock &
    // Store Ledger. A treatment can optionally draw from it, so vet costs stop being
    // invisible the way manual feed issues used to be (see Feed Cost & Growth Report).
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
    const [medicine, setMedicine] = useState('');
    const [dosage, setDosage] = useState('');
    const [withholding, setWithholding] = useState('0');
    const [isSuccess, setIsSuccess] = useState(false);

    // Optional stock draw — see medicineItems/stockLedger above.
    const [drawFromStock, setDrawFromStock] = useState(false);
    const [stockMode, setStockMode] = useState('existing'); // 'existing' | 'new'
    const [stockItemId, setStockItemId] = useState('');
    const [stockQty, setStockQty] = useState('1');
    const [newMedName, setNewMedName] = useState('');
    const [newMedUnit, setNewMedUnit] = useState('unit');
    const [newMedRate, setNewMedRate] = useState('');

    const resetStockFields = () => {
        setDrawFromStock(false);
        setStockMode('existing');
        setStockItemId('');
        setStockQty('1');
        setNewMedName('');
        setNewMedUnit('unit');
        setNewMedRate('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedAnimal || !medicine || !dosage) return;

        let stockIssueId = null;
        if (drawFromStock) {
            const qty = parseFloat(stockQty) || 0;
            if (qty <= 0) {
                alert('Enter a quantity used for the stock draw, or turn off "Draw from medicine stock".');
                return;
            }

            let itemId = stockItemId;
            if (stockMode === 'new') {
                const name = newMedName.trim();
                const rate = parseFloat(newMedRate);
                if (!name || isNaN(rate) || rate < 0) {
                    alert('Enter a name and a price/unit for the new medicine.');
                    return;
                }
                // Purchase-first: the lot is created before it's drawn against, in this
                // same action, so FIFO cost is always backed by a real recorded price —
                // never a stock draw invented after the fact with no purchase behind it.
                itemId = addStockTrackedIngredient(name, 'medicine', newMedUnit.trim() || 'unit');
                await addFeedPurchase({
                    itemId, date, quantity: qty, rate,
                    supplier: 'Direct purchase (treatment)',
                    notes: `Backfilled for treatment — ${medicine} (${dosage})`
                });
            } else if (!itemId) {
                alert('Select a medicine from stock, or switch to "New medicine".');
                return;
            }

            stockIssueId = `fi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const animalObj = animals.find(a => a.id === parseInt(selectedAnimal));
            await addFeedStockIssue({
                id: stockIssueId,
                itemId,
                date,
                pen: animalObj?.pen || 'ALL',
                quantity: qty,
                notes: `Treatment stock draw — ${animalObj?.rfid || selectedAnimal}, ${medicine} (${dosage})`
            });
        }

        addTreatment(
            selectedAnimal,
            date,
            type || (medCategories[0] || 'Vaccination'),
            medicine,
            dosage,
            parseInt(withholding),
            null,
            stockIssueId
        );

        setSelectedAnimal('');
        setTagSearch('');
        setMedicine('');
        setDosage('');
        setWithholding('0');
        resetStockFields();
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

                        {/* Optional: cost this treatment against tracked medicine stock —
                            same FIFO stock system Feed Stock & Store Ledger uses, just a
                            'medicine' category item instead of 'feed'. */}
                        <div style={{ marginTop: '1rem', padding: '0.85rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', marginBottom: drawFromStock ? '0.85rem' : 0 }}>
                                <input type="checkbox" checked={drawFromStock} onChange={(e) => setDrawFromStock(e.target.checked)} />
                                Draw from medicine stock (tracks cost)
                            </label>

                            {drawFromStock && (
                                <>
                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.85rem', fontSize: '0.8rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                            <input type="radio" name="stockMode" checked={stockMode === 'existing'} onChange={() => setStockMode('existing')} />
                                            Existing stock item
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                            <input type="radio" name="stockMode" checked={stockMode === 'new'} onChange={() => setStockMode('new')} />
                                            New medicine (not in stock)
                                        </label>
                                    </div>

                                    {stockMode === 'existing' ? (
                                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                            <div class="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
                                                <label>Medicine</label>
                                                <select class="form-control" value={stockItemId} onChange={(e) => setStockItemId(e.target.value)}>
                                                    <option value="">Select…</option>
                                                    {medicineItems.map(item => (
                                                        <option key={item.id} value={item.id}>
                                                            {item.name} — {(Number(stockQtyOf(item.id)) || 0).toFixed(2)} {item.unit} in stock
                                                        </option>
                                                    ))}
                                                </select>
                                                {medicineItems.length === 0 && (
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>No medicine stock items yet — use "New medicine" or add one in Feed Stock & Store Ledger.</span>
                                                )}
                                            </div>
                                            <div class="form-group" style={{ flex: '0 1 140px', marginBottom: 0 }}>
                                                <label>Quantity Used</label>
                                                <input type="number" min="0" step="0.01" class="form-control" value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                            <div class="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
                                                <label>Medicine Name</label>
                                                <input type="text" class="form-control" placeholder="e.g. Oxytetracycline" value={newMedName} onChange={(e) => setNewMedName(e.target.value)} />
                                            </div>
                                            <div class="form-group" style={{ flex: '0 1 100px', marginBottom: 0 }}>
                                                <label>Unit</label>
                                                <input type="text" class="form-control" placeholder="ml, dose…" value={newMedUnit} onChange={(e) => setNewMedUnit(e.target.value)} />
                                            </div>
                                            <div class="form-group" style={{ flex: '0 1 120px', marginBottom: 0 }}>
                                                <label>Quantity Used</label>
                                                <input type="number" min="0" step="0.01" class="form-control" value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
                                            </div>
                                            <div class="form-group" style={{ flex: '0 1 130px', marginBottom: 0 }}>
                                                <label>Price / Unit (PKR)</label>
                                                <input type="number" min="0" step="0.01" class="form-control" value={newMedRate} onChange={(e) => setNewMedRate(e.target.value)} />
                                            </div>
                                        </div>
                                    )}
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.5rem' }}>
                                        Priced at actual FIFO stock cost, same as feed. If you're not a Super Admin, this stock draw is queued for Super Admin approval — the treatment itself still saves immediately.
                                    </span>
                                </>
                            )}
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
                                <th title="FIFO actual cost of the linked stock draw, if any">COST</th>
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
                                        <td style={{ fontSize: '0.8rem' }}>
                                            {!t.stockIssueId ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                                                : issueCosts[t.stockIssueId] ? `${Math.round(issueCosts[t.stockIssueId].cost).toLocaleString()} PKR`
                                                : <span style={{ color: 'var(--accent-gold)' }} title="Stock draw not yet approved/synced">Pending</span>}
                                        </td>
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
