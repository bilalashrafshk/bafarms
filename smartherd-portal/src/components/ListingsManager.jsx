import React, { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { FarmContext } from '../context/FarmContext';

// Sub-component for Drag & Drop Image Uploader
function ImageUploadZone({ id, images, setImages }) {
    const [dragActive, setDragActive] = useState(false);
    const [showManualInput, setShowManualInput] = useState(false);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const processFiles = (files) => {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.type.startsWith('image/')) continue;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                setImages(prev => [...prev, event.target.result]);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFiles(e.dataTransfer.files);
        }
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            processFiles(e.target.files);
        }
    };

    const removeImage = (indexToRemove) => {
        setImages(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const handleManualChange = (text) => {
        const arr = text.split(',').map(s => s.trim()).filter(s => s.length > 0);
        setImages(arr);
    };

    return (
        <div style={{ marginBottom: '1.2rem', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: '500' }}>
                Listing Media & Images
            </label>
            
            {/* Drop Zone */}
            <div 
                className={`upload-zone ${dragActive ? 'drag-active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById(`file-picker-${id}`).click()}
                style={{
                    border: '2px dashed rgba(25, 135, 84, 0.25)',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    textAlign: 'center',
                    background: dragActive ? 'rgba(255, 193, 7, 0.05)' : 'rgba(0, 0, 0, 0.25)',
                    borderColor: dragActive ? 'var(--accent-gold)' : 'rgba(25, 135, 84, 0.35)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    position: 'relative'
                }}
            >
                <input 
                    type="file" 
                    id={`file-picker-${id}`} 
                    multiple 
                    accept="image/*" 
                    style={{ display: 'none' }} 
                    onChange={handleChange}
                />
                
                <i className="fa-solid fa-cloud-arrow-up" style={{ fontSize: '2rem', color: dragActive ? 'var(--accent-gold)' : 'var(--text-muted)', marginBottom: '0.5rem' }}></i>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-pure)', fontWeight: '600' }}>
                    Drag & drop product images here, or <span style={{ color: 'var(--accent-gold)', textDecoration: 'underline' }}>browse files</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Supports PNG, JPG, JPEG, WebP. Primary cover image is the first one.
                </div>
            </div>

            {/* Thumbnail Preview Strip */}
            {images.length > 0 && (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
                    {images.map((imgSrc, idx) => (
                        <div 
                            key={idx} 
                            style={{ 
                                width: '75px', 
                                height: '75px', 
                                borderRadius: '6px', 
                                overflow: 'hidden', 
                                position: 'relative',
                                border: '1px solid rgba(255,255,255,0.08)',
                                background: 'rgba(255,255,255,0.02)'
                            }}
                        >
                            <img 
                                src={imgSrc} 
                                alt={`Preview ${idx + 1}`} 
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                            />
                            {/* Remove button */}
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeImage(idx);
                                }}
                                style={{
                                    position: 'absolute',
                                    top: '2px',
                                    right: '2px',
                                    background: 'rgba(220, 53, 69, 0.85)',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '18px',
                                    height: '18px',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    lineHeight: '1'
                                }}
                                title="Remove image"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                            {idx === 0 && (
                                <span style={{
                                    position: 'absolute',
                                    bottom: '0',
                                    left: '0',
                                    right: '0',
                                    background: 'var(--accent-gold)',
                                    color: 'var(--text-dark)',
                                    fontSize: '8px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    padding: '1px 0',
                                    textTransform: 'uppercase'
                                }}>
                                    Cover
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Collapsible Manual Input */}
            <div style={{ marginTop: '0.8rem' }}>
                <span 
                    style={{ fontSize: '0.78rem', color: 'var(--accent-gold)', cursor: 'pointer', textDecoration: 'underline' }} 
                    onClick={() => setShowManualInput(!showManualInput)}
                >
                    {showManualInput ? 'Hide manual image paths' : 'Or enter manual paths/URLs'}
                </span>
                {showManualInput && (
                    <input 
                        type="text" 
                        className="form-control" 
                        style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}
                        placeholder="e.g. /assets/ribeye_steak.png, https://example.com/pic.jpg"
                        value={images.join(', ')}
                        onChange={(e) => handleManualChange(e.target.value)}
                    />
                )}
            </div>
        </div>
    );
}

export default function ListingsManager() {
    const { 
        animals, 
        updateAnimal, 
        meatCuts, 
        addMeatCut, 
        updateMeatCut, 
        deleteMeatCut 
    } = useContext(FarmContext);

    // Active sub-tab: 'cuts' | 'live'
    const [activeTab, setActiveTab] = useState('cuts');

    // Search and filter states
    const [searchQuery, setSearchQuery] = useState('');

    // Modal state
    const [isCutModalOpen, setIsCutModalOpen] = useState(false);
    const [isLiveModalOpen, setIsLiveModalOpen] = useState(false);
    const [editingCut, setEditingCut] = useState(null);
    const [editingLiveAnimal, setEditingLiveAnimal] = useState(null);

    // Form inputs for Meat Cuts
    const [cutTitle, setCutTitle] = useState('');
    const [cutPrice, setCutPrice] = useState('');
    const [cutWeight, setCutWeight] = useState('');
    const [cutDesc, setCutDesc] = useState('');
    const [cutRibbon, setCutRibbon] = useState('');
    const [cutRfid, setCutRfid] = useState('');
    const [cutMarbling, setCutMarbling] = useState('');
    const [cutFatRatio, setCutFatRatio] = useState('');
    const [cutImages, setCutImages] = useState([]);

    // Form inputs for Live Cattle listings
    const [livePrice, setLivePrice] = useState('');
    const [liveDesc, setLiveDesc] = useState('');
    const [liveImages, setLiveImages] = useState([]);

    // --- MEAT CUT ACTIONS ---
    const openAddCutModal = () => {
        setEditingCut(null);
        setCutTitle('');
        setCutPrice('');
        setCutWeight('');
        setCutDesc('');
        setCutRibbon('Gourmet Cut');
        setCutRfid('');
        setCutMarbling('');
        setCutFatRatio('');
        setCutImages([]);
        setIsCutModalOpen(true);
    };

    const openEditCutModal = (cut) => {
        setEditingCut(cut);
        setCutTitle(cut.title);
        setCutPrice(cut.price);
        setCutWeight(cut.weight);
        setCutDesc(cut.desc || '');
        setCutRibbon(cut.ribbon || '');
        setCutRfid(cut.rfid || '');
        setCutMarbling(cut.marbling || '');
        setCutFatRatio(cut.fatRatio || '');
        setCutImages(cut.images ? [...cut.images] : (cut.image ? [cut.image] : []));
        setIsCutModalOpen(true);
    };

    const handleCutSubmit = (e) => {
        e.preventDefault();
        if (!cutTitle || !cutPrice) return;

        const payload = {
            title: cutTitle,
            category: 'cuts',
            price: parseFloat(cutPrice),
            weight: cutWeight,
            desc: cutDesc,
            ribbon: cutRibbon,
            rfid: cutRfid || 'BA-GEN-' + Math.floor(100 + Math.random() * 900),
            marbling: cutMarbling,
            fatRatio: cutFatRatio,
            images: cutImages.length > 0 ? cutImages : ['/assets/ribeye_steak.png']
        };

        if (editingCut) {
            updateMeatCut({ id: editingCut.id, ...payload });
        } else {
            addMeatCut(payload);
        }

        setIsCutModalOpen(false);
    };

    // --- LIVE ANIMAL LISTINGS ACTIONS ---
    const openEditLiveModal = (animal) => {
        setEditingLiveAnimal(animal);
        // Default dynamic price computation if price field not set yet
        const defaultPrice = Math.round(animal.currentWeight * (animal.breed.toLowerCase().includes('goat') || animal.breed.toLowerCase().includes('sheep') || animal.breed.toLowerCase().includes('beetal') || animal.breed.toLowerCase().includes('kajla') || animal.breed.toLowerCase().includes('teddy') ? 1300 : 700));
        setLivePrice(animal.price || defaultPrice);
        setLiveDesc(animal.desc || `Premium quality healthy ${animal.breed} calf, RFID tag verified, fully vaccinated. Ready for Eid Qurbani.`);
        setLiveImages(animal.images ? [...animal.images] : (animal.image ? [animal.image] : []));
        setIsLiveModalOpen(true);
    };

    const handleLiveSubmit = (e) => {
        e.preventDefault();
        if (!editingLiveAnimal) return;

        updateAnimal({
            ...editingLiveAnimal,
            price: parseFloat(livePrice),
            desc: liveDesc,
            images: liveImages.length > 0 ? liveImages : null
        });

        setIsLiveModalOpen(false);
    };

    // Filters
    const filteredCuts = meatCuts.filter(c => 
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.rfid.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const activeLiveAnimals = animals.filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.status !== 'Sick');
    
    const filteredLive = activeLiveAnimals.filter(a =>
        a.rfid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.breed.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div class="glass-panel">
            {/* Header controls */}
            <div class="form-header-bar">
                <div class="search-bar-wrap">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input 
                        type="text" 
                        placeholder={activeTab === 'cuts' ? 'Search cuts name or tag...' : 'Search breed or Tag ID...'}
                        class="form-control search-control"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                {activeTab === 'cuts' && (
                    <button class="btn btn-primary" onClick={openAddCutModal}>
                        <i class="fa-solid fa-plus"></i> Add New Gourmet Cut
                    </button>
                )}
            </div>

            {/* Catalog sub-tabs */}
            <div class="table-filters">
                <button 
                    class={`filter-btn ${activeTab === 'cuts' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('cuts'); setSearchQuery(''); }}
                >
                    Gourmet Cuts ({meatCuts.length})
                </button>
                <button 
                    class={`filter-btn ${activeTab === 'live' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('live'); setSearchQuery(''); }}
                >
                    Live Cattle Listings ({activeLiveAnimals.length})
                </button>
            </div>

            {/* TAB 1: GOURMET MEAT CUTS */}
            {activeTab === 'cuts' && (
                <div class="table-wrapper">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>RFID</th>
                                <th>TITLE</th>
                                <th>WEIGHT</th>
                                <th>PRICE (PKR)</th>
                                <th>RIBBON</th>
                                <th style={{ textAlign: 'center' }}>PICS COUNT</th>
                                <th style={{ textAlign: 'center' }}>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCuts.map(cut => (
                                <tr key={cut.id}>
                                    <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)' }}>{cut.rfid}</td>
                                    <td><strong>{cut.title}</strong></td>
                                    <td>{cut.weight}</td>
                                    <td>PKR {cut.price.toLocaleString()}</td>
                                    <td>
                                        <span style={{ fontSize: '0.8rem', background: 'rgba(25, 135, 84, 0.1)', color: 'var(--primary-green-light)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                                            {cut.ribbon || 'None'}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <strong>{cut.images ? cut.images.length : (cut.image ? 1 : 0)}</strong> pics
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                            <button class="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openEditCutModal(cut)}>
                                                <i class="fa-solid fa-pen-to-square"></i> Edit
                                            </button>
                                            <button 
                                                class="btn btn-secondary" 
                                                style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(220, 53, 69, 0.3)', color: 'hsl(0, 75%, 65%)' }}
                                                onClick={() => {
                                                    if (confirm(`Remove Gourmet Listing for "${cut.title}"?`)) {
                                                        deleteMeatCut(cut.id);
                                                    }
                                                }}
                                            >
                                                <i class="fa-solid fa-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredCuts.length === 0 && (
                                <tr>
                                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                        No gourmet cuts matched your criteria.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* TAB 2: LIVE ANIMAL LISTINGS */}
            {activeTab === 'live' && (
                <div class="table-wrapper">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>TAG ID</th>
                                <th>BREED</th>
                                <th>WT (KG)</th>
                                <th>STORE PRICE (PKR)</th>
                                <th>STATUS</th>
                                <th style={{ textAlign: 'center' }}>PICS COUNT</th>
                                <th style={{ textAlign: 'center' }}>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLive.map(a => {
                                const defaultPrice = Math.round(a.currentWeight * (a.breed.toLowerCase().includes('goat') || a.breed.toLowerCase().includes('sheep') || a.breed.toLowerCase().includes('beetal') || a.breed.toLowerCase().includes('kajla') || a.breed.toLowerCase().includes('teddy') ? 1300 : 700));
                                const currentPrice = a.price || defaultPrice;
                                const customPicsCount = a.images ? a.images.length : (a.image ? 1 : 1); // fallback dynamic check

                                return (
                                    <tr key={a.id}>
                                        <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)' }}>{a.rfid}</td>
                                        <td>{a.breed}</td>
                                        <td><strong>{a.currentWeight} kg</strong></td>
                                        <td>
                                            PKR {currentPrice.toLocaleString()} {a.price ? '' : <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>(Auto ADG)</span>}
                                        </td>
                                        <td>
                                            <span class={`badge-status ${a.status.toLowerCase()}`}>
                                                {a.status}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <strong>{customPicsCount}</strong> pics
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                                <button class="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openEditLiveModal(a)}>
                                                    <i class="fa-solid fa-store"></i> Edit Store Info
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {filteredLive.length === 0 && (
                                <tr>
                                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                        No active herd animals match your search query.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* --- MEAT CUT EDIT/ADD MODAL --- */}
            {isCutModalOpen && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container">
                        <button class="modal-close-btn" onClick={() => setIsCutModalOpen(false)}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', marginBottom: '1rem' }}>
                            <i class="fa-solid fa-ribbon"></i> {editingCut ? 'Edit Gourmet Cut Listing' : 'Add Gourmet Cut Listing'}
                        </h2>

                        <form onSubmit={handleCutSubmit}>
                            <div class="modal-body-scroll">
                                <div class="form-grid-3">
                                    <div class="form-group">
                                        <label>Title *</label>
                                        <input type="text" class="form-control" placeholder="e.g. Sahiwal Prime Ribeye" value={cutTitle} onChange={(e) => setCutTitle(e.target.value)} required />
                                    </div>
                                    <div class="form-group">
                                        <label>Store Price (PKR) *</label>
                                        <input type="number" class="form-control" placeholder="e.g. 2800" value={cutPrice} onChange={(e) => setCutPrice(e.target.value)} required />
                                    </div>
                                    <div class="form-group">
                                        <label>Weight Description</label>
                                        <input type="text" class="form-control" placeholder="e.g. 1.0 kg Pack (2 Steaks)" value={cutWeight} onChange={(e) => setCutWeight(e.target.value)} />
                                    </div>
                                </div>

                                <div class="form-grid-3">
                                    <div class="form-group">
                                        <label>Store Tag (RFID)</label>
                                        <input type="text" class="form-control" placeholder="e.g. BA-RIB-901" value={cutRfid} onChange={(e) => setCutRfid(e.target.value)} />
                                    </div>
                                    <div class="form-group">
                                        <label>Ribbon Tag</label>
                                        <input type="text" class="form-control" placeholder="e.g. Gourmet Cut" value={cutRibbon} onChange={(e) => setCutRibbon(e.target.value)} />
                                    </div>
                                    <div class="form-group">
                                        <label>Marbling Profile</label>
                                        <input type="text" class="form-control" placeholder="e.g. Grade 4+ (Aged)" value={cutMarbling} onChange={(e) => setCutMarbling(e.target.value)} />
                                    </div>
                                </div>

                                <div class="form-grid-row">
                                    <div class="form-group">
                                        <label>Fat Ratio Cap</label>
                                        <input type="text" class="form-control" placeholder="e.g. 18% Fat Cap" value={cutFatRatio} onChange={(e) => setCutFatRatio(e.target.value)} />
                                    </div>
                                </div>

                                <ImageUploadZone id="cuts" images={cutImages} setImages={setCutImages} />

                                <div class="form-group">
                                    <label>Description</label>
                                    <textarea 
                                        rows="3" 
                                        class="form-control" 
                                        style={{ height: 'auto', resize: 'vertical' }}
                                        placeholder="Gourmet description of the portion cut..." 
                                        value={cutDesc} 
                                        onChange={(e) => setCutDesc(e.target.value)}
                                    ></textarea>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
                                <button type="button" class="btn btn-secondary" onClick={() => setIsCutModalOpen(false)}>Cancel</button>
                                <button type="submit" class="btn btn-primary">Save listing</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* --- LIVE ANIMAL STORE LISTING MODAL --- */}
            {isLiveModalOpen && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container" style={{ maxWidth: '520px' }}>
                        <button class="modal-close-btn" onClick={() => setIsLiveModalOpen(false)}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', marginBottom: '1.2rem' }}>
                            <i class="fa-solid fa-store"></i> Edit Store Details — Tag {editingLiveAnimal.rfid}
                        </h2>

                        <form onSubmit={handleLiveSubmit}>
                            <div class="modal-body-scroll">
                                <div class="form-grid-row">
                                    <div class="form-group">
                                        <label>Store Booking Price (PKR) *</label>
                                        <input type="number" class="form-control" placeholder="e.g. 285000" value={livePrice} onChange={(e) => setLivePrice(e.target.value)} required />
                                    </div>
                                </div>

                                <ImageUploadZone id="live" images={liveImages} setImages={setLiveImages} />

                                <div class="form-group">
                                    <label>Store Description</label>
                                    <textarea 
                                        rows="4" 
                                        class="form-control" 
                                        style={{ height: 'auto', resize: 'vertical' }}
                                        placeholder="Add commercial details of structure, teeth age, feed quality etc..." 
                                        value={liveDesc} 
                                        onChange={(e) => setLiveDesc(e.target.value)}
                                    ></textarea>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
                                <button type="button" class="btn btn-secondary" onClick={() => setIsLiveModalOpen(false)}>Cancel</button>
                                <button type="submit" class="btn btn-primary">Save Commercial Store Info</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
