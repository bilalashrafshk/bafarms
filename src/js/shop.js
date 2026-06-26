/* ==========================================
   BA FARMS B2C GOURMET & QURBANI SHOP - INTERACTIVE SUITE
   ========================================== */

/// 1. PRODUCTS DATASET (COMBINED: LIVE ANIMALS & MEAT CUTS)
let PRODUCTS = [];
let RFID_DATABASE = {};

// Module-level DB state — populated by syncFromRemoteDatabase
let dbAnimals = [];
let dbMeatCuts = [];
let dbOrders = [];

const MEAT_CUTS = [
    {
        id: 'ribeye',
        title: 'Sahiwal Prime Ribeye Steak',
        category: 'cuts',
        price: 2850,
        weight: '1.0 kg Pack (2 Steaks)',
        desc: 'Portion-cut from premium grain-finished Sahiwal cattle. Dry-aged for 21 days for supreme marbling, tenderness, and rich flavor.',
        ribbon: 'Gourmet Cut',
        rfid: 'BA-RIB-901',
        marbling: 'Grade 4+ (Aged)',
        fatRatio: '18% Fat Cap',
        image: 'assets/ribeye_steak.png'
    },
    {
        id: 'tbone',
        title: 'Cholistani Gourmet T-Bone',
        category: 'cuts',
        price: 2650,
        weight: '1.2 kg Pack (2 Steaks)',
        desc: 'Classic cut combining robust strip loin and tender tenderloin. Sourced from grass-fed Cholistani steers raised under medical surveillance.',
        ribbon: 'Gourmet Cut',
        rfid: 'BA-TBN-902',
        marbling: 'Grade 3+ (Premium)',
        fatRatio: '14%',
        image: 'assets/tbone_steak.png'
    },
    {
        id: 'striploin',
        title: 'Premium Angus Cross Striploin',
        category: 'cuts',
        price: 3100,
        weight: '1.0 kg Pack (3 Steaks)',
        desc: 'Angus cross cattle reared at Faisalabad. Offers unmatched juicy texture and a thick fat cap that renders beautifully on the grill.',
        ribbon: 'Gourmet Cut',
        rfid: 'BA-STR-903',
        marbling: 'Grade 5 (Supreme)',
        fatRatio: '20%',
        image: 'assets/striploin_steak.png'
    },
    {
        id: 'minced',
        title: 'Organic Grass-Fed Minced Beef',
        category: 'cuts',
        price: 1850,
        weight: '1.0 kg Pack (Fine Ground)',
        desc: 'Extra lean minced beef processed daily under strict sterile cold room conditions. Zero additives, pure organic ground chuck.',
        ribbon: 'Fresh Minced',
        rfid: 'BA-MIN-904',
        marbling: 'Standard Lean',
        fatRatio: '8%',
        image: 'assets/minced_beef.png'
    },
    {
        id: 'bong',
        title: 'Premium Beef Shank (Bong Cut)',
        category: 'cuts',
        price: 1950,
        weight: '1.5 kg Pack (Bone-in)',
        desc: 'Traditional cross-cut shank featuring rich marrow bone. Ideal for slow cooking, stews, and traditional Nihari preparations.',
        ribbon: 'Fresh Cut',
        rfid: 'BA-BNG-905',
        marbling: 'Lean & Marrow',
        fatRatio: '10%',
        image: 'assets/bong_cut.png'
    },
    {
        id: 'patties',
        title: 'Gourmet Chuck Burger Patties',
        category: 'cuts',
        price: 1600,
        weight: '6 Patties (900g Total)',
        desc: 'House blend of 80% lean chuck and 20% premium brisket. Lightly seasoned and vacuum packed for instant grilling.',
        ribbon: 'Ready to Grill',
        rfid: 'BA-PAT-906',
        marbling: 'Burger Ratio 80/20',
        fatRatio: '20%',
        image: 'assets/burger_patties.png'
    }
];

const SEED_LIVESTOCK = [
    {
        rfid: 'BA-BULL-101',
        breed: 'Sahiwal Red Bull (Steer #409)',
        breedKey: 'Sahiwal',
        price: 285000,
        weight: 420,
        targetWeight: 420,
        desc: 'Purebred Sahiwal bull with excellent physical structure, deep red coat, and verified teeth age compliance. Raised on organic feeds.',
        pen: 'B-4',
        purchasePrice: 150000,
        entryWeight: 380,
        entryDate: '2026-04-10',
        status: 'Ready',
        image: 'assets/sahiwal_bull.png',
        images: ['assets/sahiwal_bull.png']
    },
    {
        rfid: 'BA-COW-202',
        breed: 'Cholistani White Cow (Heifer #512)',
        breedKey: 'Cholistani',
        price: 245000,
        weight: 360,
        targetWeight: 360,
        desc: 'Beautiful Cholistani heifer featuring signature spot markings. Active health log, fully vaccinated against FMD.',
        pen: 'C-1',
        purchasePrice: 130000,
        entryWeight: 320,
        entryDate: '2026-04-15',
        status: 'Ready',
        image: 'assets/cholistani_cow.png',
        images: ['assets/cholistani_cow.png']
    },
    {
        rfid: 'BA-BULL-505',
        breed: 'Sahiwal Heavyweight Bull (#380)',
        breedKey: 'Sahiwal',
        price: 480000,
        weight: 580,
        targetWeight: 580,
        desc: 'Heavyweight Sahiwal show bull. Unmatched muscle mass, clean posture, and active veterinary passport. Ideal for family shared booking.',
        pen: 'F-2',
        purchasePrice: 280000,
        entryWeight: 500,
        entryDate: '2026-03-20',
        status: 'Ready',
        image: 'assets/sahiwal_bull.png',
        images: ['assets/sahiwal_bull.png']
    },
    {
        rfid: 'BA-GOAT-303',
        breed: 'Beetal Rajanpuri Goat (#780)',
        breedKey: 'Beetal',
        price: 95000,
        weight: 75,
        targetWeight: 75,
        desc: 'Purebred Rajanpuri Beetal goat with long floppy ears and clean pink nose. Complies with Islamic Qurbani requirements.',
        pen: 'G-2',
        purchasePrice: 65000,
        entryWeight: 60,
        entryDate: '2026-05-01',
        status: 'Ready',
        image: 'assets/beetal_goat.png',
        images: ['assets/beetal_goat.png']
    },
    {
        rfid: 'BA-SHP-404',
        breed: 'Premium Kajla Sheep (#801)',
        breedKey: 'Kajla',
        price: 85000,
        weight: 65,
        targetWeight: 65,
        desc: 'Signature Kajla sheep with deep dark circle eye markings. Reared in Faisalabad complex with automated grain rations.',
        pen: 'S-1',
        purchasePrice: 55000,
        entryWeight: 55,
        entryDate: '2026-05-05',
        status: 'Ready',
        image: 'assets/kajla_sheep.png',
        images: ['assets/kajla_sheep.png']
    },
    {
        rfid: 'BA-GOAT-606',
        breed: 'Teddy Goat Compact (#902)',
        breedKey: 'Teddy',
        price: 55000,
        weight: 45,
        targetWeight: 45,
        desc: 'Healthy and active compact Teddy goat. Raised on natural grain feeds. Islamic compliance verified.',
        pen: 'G-1',
        purchasePrice: 35000,
        entryWeight: 35,
        entryDate: '2026-05-10',
        status: 'Ready',
        image: 'assets/teddy_goat.png',
        images: ['assets/teddy_goat.png']
    }
];

const syncProductsFromState = () => {
    // Use DB animals if available, fall back to SEED_LIVESTOCK
    let list = dbAnimals.length > 0 ? dbAnimals : SEED_LIVESTOCK.map((s, idx) => ({
        id: idx + 1,
        rfid: s.rfid,
        breed: s.breedKey,
        entryDate: s.entryDate,
        entryWeight: s.entryWeight,
        currentWeight: s.weight,
        targetWeight: s.targetWeight,
        purchasePrice: s.purchasePrice,
        source: 'Ashraf Zia Agro-Complex',
        status: s.status,
        pen: s.pen,
        price: s.price,
        desc: s.desc,
        images: s.images
    }));

    // Filter available live animals: status != 'Sold' && status != 'Deceased' && status != 'Sick'
    const liveAnimals = list.filter(a => a.status !== 'Sold' && a.status !== 'Deceased' && a.status !== 'Sick');

    // Use DB meat cuts if available, fall back to static MEAT_CUTS
    const cutsList = dbMeatCuts.length > 0 ? dbMeatCuts : MEAT_CUTS;

    // Build PRODUCTS list
    PRODUCTS = [
        ...liveAnimals.map(a => {
            const seed = SEED_LIVESTOCK.find(s => s.rfid === a.rfid);
            const price = a.price ? a.price : (seed ? seed.price : Math.round(a.currentWeight * (a.breed.toLowerCase().includes('goat') || a.breed.toLowerCase().includes('sheep') || a.breed.toLowerCase().includes('beetal') || a.breed.toLowerCase().includes('kajla') || a.breed.toLowerCase().includes('teddy') ? 1300 : 700)));
            const title = seed ? seed.breed : `${a.breed} (#${a.rfid})`;
            const desc = a.desc ? a.desc : (seed ? seed.desc : `Premium quality healthy ${a.breed} calf, RFID tag verified, fully vaccinated. Ready for Eid Qurbani.`);
            let fallbackImg = 'assets/beetal_goat.png';
            const br = a.breed.toLowerCase();
            if (br.includes('sahiwal')) {
                fallbackImg = 'assets/sahiwal_bull.png';
            } else if (br.includes('cholistani')) {
                fallbackImg = 'assets/cholistani_cow.png';
            } else if (br.includes('kajla') || br.includes('sheep')) {
                fallbackImg = 'assets/kajla_sheep.png';
            } else if (br.includes('teddy')) {
                fallbackImg = 'assets/teddy_goat.png';
            } else if (br.includes('cow') || br.includes('bull') || br.includes('steer') || br.includes('heifer')) {
                fallbackImg = 'assets/sahiwal_bull.png';
            }
            const images = a.images ? a.images : (seed ? (seed.images || [seed.image]) : [fallbackImg]);

            return {
                id: a.rfid.toLowerCase(),
                title: title,
                category: 'live',
                price: price,
                weight: `${a.currentWeight} kg (Live Weight)`,
                desc: desc,
                ribbon: 'Live Animal',
                rfid: a.rfid,
                marbling: a.breed === 'Sahiwal' || a.breed === 'Cholistani' ? '2 Teeth (Dandaan)' : 'Age Verified',
                fatRatio: 'Bio-Safety Cleared',
                image: images[0],
                images: images
            };
        }),
        ...cutsList.map(c => ({
            id: c.id,
            title: c.title,
            category: 'cuts',
            price: c.price,
            weight: c.weight,
            desc: c.desc,
            ribbon: c.ribbon,
            rfid: c.rfid,
            marbling: c.marbling,
            fatRatio: c.fatRatio,
            image: c.images ? c.images[0] : (c.image || 'assets/ribeye_steak.png'),
            images: c.images ? c.images : [c.image || 'assets/ribeye_steak.png']
        }))
    ];

    // Build RFID Passport database for lookup
    RFID_DATABASE = {};

    // Load local weights and treatments for tracing (these stay as localStorage cache)
    let weightsList = [];
    try {
        const storedWeights = localStorage.getItem('ba_weights');
        if (storedWeights) {
            weightsList = JSON.parse(storedWeights);
        }
    } catch (e) {
        console.warn('Could not read ba_weights:', e);
    }

    let treatmentsList = [];
    try {
        const storedTreatments = localStorage.getItem('ba_treatments');
        if (storedTreatments) {
            treatmentsList = JSON.parse(storedTreatments);
        }
    } catch (e) {
        console.warn('Could not read ba_treatments:', e);
    }

    // Populate cuts in RFID database
    cutsList.forEach(c => {
        RFID_DATABASE[c.rfid] = {
            tagId: c.rfid,
            breed: `${c.title} (Portion Cut)`,
            age: '22 Mo Average (Traceable Herd)',
            division: 'Partner Export Processing Complex - Hall 3',
            nutrition: c.desc.substring(0, 45) + '...',
            vaccinations: 'Slaughtered at partner export-certified Halal facility',
            tempCurve: 'Blast-Chilled at 1.8°C (Vacuum Sealed)'
        };
    });

    // Populate live animals in RFID Database
    list.forEach(a => {
        const animalWeights = weightsList.filter(w => w.animalId === a.id).sort((w1, w2) => new Date(w1.date) - new Date(w2.date));
        const animalTreatments = treatmentsList.filter(t => t.animalId === a.id);

        let lastAdg = 1.6; // default to feedlot standard ADG
        let lastScaleDate = a.entryDate;
        if (animalWeights.length > 0) {
            const lastW = animalWeights[animalWeights.length - 1];
            lastAdg = lastW.adg || 0;
            lastScaleDate = lastW.date;
        }

        let vacString = '100% Certified (FMD, Black Quarter, HS)';
        if (animalTreatments.length > 0) {
            const treatmentNames = animalTreatments.map(t => `${t.medicine} (${t.type})`);
            vacString = treatmentNames.join(', ');
        }

        RFID_DATABASE[a.rfid] = {
            tagId: a.rfid,
            breed: `${a.breed} (${a.status})`,
            age: a.breed === 'Sahiwal' || a.breed === 'Cholistani' ? '22 Months (2 Teeth / Dandaan Verified)' : '14 Months (Age Verified)',
            division: `Agro-Complex - Paddock Pen ${a.pen || 'General'}`,
            nutrition: 'TMR Organic Rations & Alfalfa Silage',
            vaccinations: vacString,
            tempCurve: `Scale: ${a.currentWeight} kg (ADG: ${lastAdg.toFixed(2)} kg/d as of ${lastScaleDate})`
        };
    });
};

// 3. APPLICATION STATE
let cart = [];
let currentFilter = 'all';
let appliedDiscount = 0; // percentage
let activeCoupon = '';
let selectedQurbaniService = 'LiveDelivery'; // 'LiveDelivery' | 'OnFarmSlaughter'
let selectedCity = 'Lahore';

// Load cart from localStorage
const loadCartFromStorage = () => {
    try {
        const savedCart = localStorage.getItem('ba_farms_combined_cart');
        if (savedCart) {
            cart = JSON.parse(savedCart);
        }
    } catch (err) {
        console.warn('Could not read cart from storage:', err);
    }
};

// Save cart to localStorage
const saveCartToStorage = () => {
    try {
        localStorage.setItem('ba_farms_combined_cart', JSON.stringify(cart));
    } catch (err) {
        console.warn('Could not write cart to storage:', err);
    }
};

// Check if cart contains any Live Animals
const checkCartHasLiveAnimals = () => {
    return cart.some(item => {
        const p = PRODUCTS.find(prod => prod.id === item.id);
        return p && p.category === 'live';
    });
};

// 4. INTERACTIVE CATALOG RENDERING
const renderCatalog = () => {
    const grid = document.getElementById('product-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const filteredProducts = PRODUCTS.filter(p => {
        if (currentFilter === 'all') return true;
        return p.category === currentFilter;
    });

    if (filteredProducts.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">No products found in this category.</div>`;
        return;
    }

    filteredProducts.forEach(product => {
        // Icon mapping
        let iconHtml = '<i class="fa-solid fa-cow product-graphic-icon"></i>';
        if (product.category === 'cuts') {
            if (product.id === 'ribeye' || product.id === 'striploin') {
                iconHtml = '<i class="fa-solid fa-ribbon product-graphic-icon"></i>';
            } else if (product.id === 'minced' || product.id === 'bong') {
                iconHtml = '<i class="fa-solid fa-meat product-graphic-icon" style="color:var(--accent-gold);"></i>';
            } else if (product.id === 'patties') {
                iconHtml = '<i class="fa-solid fa-burger product-graphic-icon"></i>';
            }
        } else {
            // Live caprines
            if (product.id === 'beetal-goat' || product.id === 'teddy-goat') {
                iconHtml = '<i class="fa-solid fa-cloud product-graphic-icon" style="color:var(--accent-gold); font-size:4.5rem;"></i>';
            } else if (product.id === 'kajla-sheep') {
                iconHtml = '<i class="fa-solid fa-circle product-graphic-icon" style="color:var(--accent-gold); font-size:4.5rem;"></i>';
            }
        }

        const isLive = product.category === 'live';

        const card = document.createElement('div');
        card.className = 'glass-card product-card animate-slide-in';
        card.innerHTML = `
            <a href="/product?id=${product.id}" style="text-decoration: none; color: inherit; display: block;">
                <div class="product-image-container" style="position: relative; overflow: hidden;">
                    <span class="product-ribbon" style="${!isLive ? 'background:var(--primary-green-light); color:#fff; z-index: 2;' : 'z-index: 2;'}">${product.ribbon}</span>
                    ${product.image ? `<img src="${product.image}" alt="${product.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 9px; position: absolute; top: 0; left: 0;" class="product-img-element" onerror="this.style.display='none'">` : iconHtml}
                    <span class="product-rfid-badge" style="z-index: 2;">
                        <i class="fa-solid fa-microchip"></i>
                        <span>${product.rfid}</span>
                    </span>
                </div>

                <h3 class="product-title" style="transition: color 0.2s ease;">${product.title}</h3>
            </a>

            <div class="product-meta-row">
                <span class="product-meta-item"><i class="fa-solid ${isLive ? 'fa-weight-scale' : 'fa-weight-hanging'}"></i> ${product.weight}</span>
                <span class="product-meta-item"><i class="fa-solid ${isLive ? 'fa-tooth' : 'fa-dna'}"></i> ${isLive ? 'Teeth' : 'Marbling'}: ${product.marbling.split(' ')[0]}</span>
            </div>

            <p class="product-desc">${product.desc}</p>

            <div class="product-price-row">
                <div class="price-box">
                    <span>${isLive ? 'Booking Price' : 'Direct Price'}</span>
                    <strong>PKR ${product.price.toLocaleString()}</strong>
                </div>
                <div class="product-actions-btn-group">
                    <a class="btn btn-secondary btn-icon-only" href="/product?id=${product.id}" title="View details and gallery" style="display: flex; align-items: center; justify-content: center; width: 38px; height: 38px;">
                        <i class="fa-solid fa-circle-info"></i>
                    </a>
                    <button class="btn btn-secondary btn-icon-only btn-trace-product" data-rfid="${product.rfid}" title="Trace passport origins">
                        <i class="fa-solid fa-fingerprint"></i>
                    </button>
                    <button class="btn btn-primary btn-add-to-cart-action" data-id="${product.id}">
                        <i class="fa-solid fa-plus"></i> Buy
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    // Rebind add to cart & trace click handlers
    document.querySelectorAll('.btn-add-to-cart-action').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            addToCart(id);
            // Auto open cart drawer
            openCartDrawer();
            // Visual success indicator
            const originalHtml = btn.innerHTML;
            btn.style.background = 'linear-gradient(135deg, var(--primary-green-light) 0%, var(--primary-green) 100%)';
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Added';
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.style.background = '';
            }, 1000);
        });
    });

    document.querySelectorAll('.btn-trace-product').forEach(btn => {
        btn.addEventListener('click', () => {
            const rfid = btn.getAttribute('data-rfid');
            triggerTraceLookup(rfid);
            document.getElementById('traceability').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
};

// 5. SHOPPING CART OPERATIONS
const showNotification = (message, type = 'info') => {
    let container = document.getElementById('ba-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'ba-toast-container';
        container.style.position = 'fixed';
        container.style.bottom = '24px';
        container.style.right = '24px';
        container.style.zIndex = '99999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        container.style.pointerEvents = 'none';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `ba-toast toast-${type}`;
    toast.style.background = type === 'warning' ? 'rgba(217, 83, 79, 0.95)' : 'rgba(25, 135, 84, 0.95)';
    toast.style.backdropFilter = 'blur(12px)';
    toast.style.border = type === 'warning' ? '1px solid #d9534f' : '1px solid var(--primary-green-light)';
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '0.88rem';
    toast.style.fontFamily = 'var(--font-body)';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.pointerEvents = 'all';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';

    const icon = document.createElement('i');
    icon.className = type === 'warning' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check';
    toast.appendChild(icon);

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3500);
};
window.showNotification = showNotification;

const addToCart = (productId) => {
    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) return;

    const existingItem = cart.find(item => item.id === productId);
    if (existingItem) {
        if (product.category === 'live') {
            showNotification(`Live Animal #${product.rfid} is already in your basket. (Limit: 1 per booking)`, 'warning');
            return;
        }
        existingItem.quantity += 1;
    } else {
        cart.push({
            id: product.id,
            title: product.title,
            price: product.price,
            weight: product.weight,
            rfid: product.rfid,
            quantity: 1
        });
        showNotification(`Added ${product.title} to your basket!`, 'success');
    }

    saveCartToStorage();
    updateCartHUD();
};

const removeFromCart = (productId) => {
    cart = cart.filter(item => item.id !== productId);
    saveCartToStorage();
    updateCartHUD();
};

const updateQuantity = (productId, delta) => {
    const item = cart.find(item => item.id === productId);
    if (!item) return;

    if (delta > 0) {
        const product = PRODUCTS.find(p => p.id === productId);
        if (product && product.category === 'live' && item.quantity >= 1) {
            showNotification(`Unique Live Animal #${product.rfid} cannot be incremented.`, 'warning');
            return;
        }
    }

    item.quantity += delta;
    if (item.quantity <= 0) {
        removeFromCart(productId);
    } else {
        saveCartToStorage();
        updateCartHUD();
    }
};

const updateCartHUD = () => {
    const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);

    // Header cart badges
    const badge = document.getElementById('cart-count-badge');
    if (badge) {
        badge.textContent = totalCount;
        if (totalCount > 0) {
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // Render cart items list in drawer
    const listContainer = document.getElementById('cart-items-list');
    const emptyState = document.getElementById('cart-empty-state');
    const footer = document.getElementById('cart-drawer-footer');

    if (!listContainer || !emptyState || !footer) return;

    if (cart.length === 0) {
        listContainer.style.display = 'none';
        emptyState.style.display = 'flex';
        footer.style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        listContainer.style.display = 'flex';
        footer.style.display = 'block';

        listContainer.innerHTML = '';
        cart.forEach(item => {
            const product = PRODUCTS.find(p => p.id === item.id);
            if (!product) return; // product was removed from catalog (e.g. sold); skip stale cart entry
            let itemIconHtml = '<i class="fa-solid fa-cow"></i>';
            if (product) {
                if (product.category === 'cuts') {
                    if (product.id === 'ribeye' || product.id === 'striploin') {
                        itemIconHtml = '<i class="fa-solid fa-ribbon" style="color: var(--primary-green-light);"></i>';
                    } else if (product.id === 'minced' || product.id === 'bong') {
                        itemIconHtml = '<i class="fa-solid fa-bone" style="color: var(--accent-gold);"></i>';
                    } else if (product.id === 'patties') {
                        itemIconHtml = '<i class="fa-solid fa-burger" style="color: var(--primary-green-light);"></i>';
                    } else {
                        itemIconHtml = '<i class="fa-solid fa-box-open" style="color: var(--text-muted);"></i>';
                    }
                } else {
                    if (product.id === 'beetal-goat' || product.id === 'teddy-goat') {
                        itemIconHtml = '<i class="fa-solid fa-cloud" style="color: var(--accent-gold);"></i>';
                    } else if (product.id === 'kajla-sheep') {
                        itemIconHtml = '<i class="fa-solid fa-circle" style="color: var(--accent-gold);"></i>';
                    }
                }
            }

            const isLiveAnimal = product && product.category === 'live';
            const qtyControlsHtml = isLiveAnimal ? `
                <div class="qty-controls" style="border: none; background: none; padding: 0;">
                    <span style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent-gold); font-weight: 700;">Unique Booking</span>
                </div>
            ` : `
                <div class="qty-controls">
                    <button class="qty-btn btn-qty-minus" data-id="${item.id}"><i class="fa-solid fa-minus"></i></button>
                    <span class="qty-val">${item.quantity}</span>
                    <button class="qty-btn btn-qty-plus" data-id="${item.id}"><i class="fa-solid fa-plus"></i></button>
                </div>
            `;

            const row = document.createElement('div');
            row.className = 'cart-item-card';
            row.innerHTML = `
                <div class="cart-item-icon">
                    ${itemIconHtml}
                </div>
                <div class="cart-item-details">
                    <h4>${item.title}</h4>
                    <span>${item.weight}${isLiveAnimal ? ` &bull; Tag: ${item.rfid}` : ''}</span>
                </div>
                <div class="cart-item-qty-price">
                    ${qtyControlsHtml}
                    <span class="item-price">PKR ${(item.price * item.quantity).toLocaleString()}</span>
                </div>
                <button class="cart-item-remove-btn btn-item-remove" data-id="${item.id}"><i class="fa-solid fa-trash-can"></i></button>
            `;
            listContainer.appendChild(row);
        });

        // Rebind quantity adjustment clicks
        document.querySelectorAll('.btn-qty-minus').forEach(btn => {
            btn.addEventListener('click', () => {
                updateQuantity(btn.getAttribute('data-id'), -1);
            });
        });

        document.querySelectorAll('.btn-qty-plus').forEach(btn => {
            btn.addEventListener('click', () => {
                updateQuantity(btn.getAttribute('data-id'), 1);
            });
        });

        document.querySelectorAll('.btn-item-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                removeFromCart(btn.getAttribute('data-id'));
            });
        });

        // Recalculate billing sums
        calculateTotals();
    }
};

const calculateTotals = () => {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const hasLive = checkCartHasLiveAnimals();

    // Smart Cart calculations for Shipping fee
    let shipping = 350; // default for meat cuts
    if (hasLive) {
        shipping = 5000; // default live cattle transit
        if (selectedCity === 'Faisalabad') {
            shipping = 0;
        } else if (selectedCity === 'Karachi') {
            shipping = 12000;
        }
    } else {
        // cuts only
        if (selectedCity === 'Faisalabad') {
            shipping = 0;
        }
    }

    const discountAmount = Math.round(subtotal * (appliedDiscount / 100));
    const total = subtotal - discountAmount + shipping;
    const deposit = Math.round(total * 0.50); // 50% Booking Deposit

    const subtotalSpan = document.getElementById('cart-subtotal');
    const discountRow = document.getElementById('cart-discount-row');
    const discountSpan = document.getElementById('cart-discount');
    const shippingSpan = document.getElementById('cart-shipping');
    const totalSpan = document.getElementById('cart-total');

    const depositSpan = document.getElementById('cart-deposit');
    const depositRow = document.getElementById('cart-deposit-row');

    if (subtotalSpan) subtotalSpan.textContent = `PKR ${subtotal.toLocaleString()}`;
    if (shippingSpan) shippingSpan.textContent = `PKR ${shipping.toLocaleString()}`;
    if (totalSpan) totalSpan.textContent = `PKR ${total.toLocaleString()}`;

    // Morph cart deposit calculations
    if (depositRow && depositSpan) {
        if (hasLive) {
            depositSpan.textContent = `PKR ${deposit.toLocaleString()}`;
            depositRow.style.display = 'flex';
        } else {
            depositRow.style.display = 'none';
        }
    }

    if (discountRow && discountSpan) {
        if (appliedDiscount > 0) {
            discountSpan.textContent = `-PKR ${discountAmount.toLocaleString()}`;
            discountRow.style.display = 'flex';
        } else {
            discountRow.style.display = 'none';
        }
    }
};

// 6. RFID TRANSPARENCY SEARCH LOGIC
const triggerTraceLookup = (rfidCode) => {
    const placeholder = document.getElementById('trace-placeholder');
    const passport = document.getElementById('cattle-passport');
    const statusMsg = document.getElementById('trace-status-message');

    if (!placeholder || !passport) return;

    const cleanCode = rfidCode.trim().toUpperCase();

    // Check if it is an Order Reference ID instead of cattle RFID tag!
    if (cleanCode.startsWith('BA-QUR-') || cleanCode.startsWith('BA-ORD-')) {
        const matchedOrder = dbOrders.find(o => o.id.toUpperCase() === cleanCode);
        if (matchedOrder) {
            // Close cart drawer if open
            document.getElementById('cart-drawer').classList.remove('active');
            document.getElementById('cart-drawer-overlay').classList.remove('active');

            // Load and launch Step 3 Live GPS Tracker Modal directly for this order!
            resetWizardState();

            selectedCity = matchedOrder.customerCity;
            selectedQurbaniService = matchedOrder.qurbaniService;

            document.getElementById('receipt-order-ref').textContent = matchedOrder.id;
            document.getElementById('checkout-wizard-header').style.display = 'none';

            // Set success title based on type
            const successTitle = document.getElementById('success-header-title');
            if (successTitle) {
                successTitle.textContent = matchedOrder.hasLive ? "Qurbani Booking Active" : "Order Dispatch Status";
            }

            // Load steps
            const stepsContainer = document.getElementById('tracker-steps-container');
            if (matchedOrder.hasLive) {
                if (matchedOrder.qurbaniService === 'LiveDelivery') {
                    stepsContainer.innerHTML = `
                        <div class="track-step" id="ts-1"><i class="fa-solid fa-stethoscope"></i> Vet health & age verification check</div>
                        <div class="track-step" id="ts-2"><i class="fa-solid fa-dolly"></i> Animal loaded on specialized transport</div>
                        <div class="track-step" id="ts-3"><i class="fa-solid fa-road"></i> Motorway transit (watering/feeding stops)</div>
                        <div class="track-step" id="ts-4"><i class="fa-solid fa-warehouse"></i> Local city holding pens check-in</div>
                        <div class="track-step" id="ts-5"><i class="fa-solid fa-house-chimney-user"></i> Doorstep hand-off (Passports delivered)</div>
                    `;
                } else {
                    stepsContainer.innerHTML = `
                        <div class="track-step" id="ts-1"><i class="fa-solid fa-shield-virus"></i> Bio-safety quarantine rest & Sunnah feeding</div>
                        <div class="track-step" id="ts-2"><i class="fa-solid fa-mosque"></i> Slaughter at partner certified Halal facility</div>
                        <div class="track-step" id="ts-3"><i class="fa-solid fa-snowflake"></i> Chilling & vacuum packaging at partner facility</div>
                        <div class="track-step" id="ts-4"><i class="fa-solid fa-truck-cold"></i> Dispatch via cold chain refrigerated reefers</div>
                        <div class="track-step" id="ts-5"><i class="fa-solid fa-box-open"></i> Doorstep delivery of chilled meat boxes</div>
                    `;
                }
            } else {
                stepsContainer.innerHTML = `
                    <div class="track-step" id="ts-1"><i class="fa-solid fa-snowflake"></i> Chilled reefer pre-cooling (2°C)</div>
                    <div class="track-step" id="ts-2"><i class="fa-solid fa-dolly"></i> Cargo loading & weight audit check-in</div>
                    <div class="track-step" id="ts-3"><i class="fa-solid fa-road"></i> Motorway cold chain transit (M-4 route)</div>
                    <div class="track-step" id="ts-4"><i class="fa-solid fa-warehouse"></i> Regional distribution hub inspection</div>
                    <div class="track-step" id="ts-5"><i class="fa-solid fa-box-open"></i> Doorstep chilled meat delivery</div>
                `;
            }

            // Highlight steps based on status
            const status = matchedOrder.status;
            let activeIdx = 1;
            if (status === 'Confirmed') activeIdx = 1;
            else if (status === 'Pre-Slaughter Care' || status === 'Pre-cooling Reefer') activeIdx = 2;
            else if (status === 'Slaughtered' || status === 'Cargo Loaded' || status === 'Loaded for Transit') activeIdx = 3;
            else if (status === 'In Route') activeIdx = 4;
            else if (status === 'Arrived at Holding Pens' || status === 'Arrived at Regional Hub') activeIdx = 5;
            else if (status === 'Delivered') activeIdx = 6;

            for (let i = 1; i <= 5; i++) {
                const ts = document.getElementById(`ts-${i}`);
                if (ts) {
                    if (i < activeIdx) {
                        ts.className = 'track-step completed';
                    } else if (i === activeIdx) {
                        ts.className = 'track-step active';
                    } else {
                        ts.className = 'track-step';
                    }
                }
            }

            let targetPct = 0.1;
            if (status === 'Confirmed') targetPct = 0.1;
            else if (status === 'Pre-Slaughter Care' || status === 'Pre-cooling Reefer') targetPct = 0.3;
            else if (status === 'Slaughtered' || status === 'Cargo Loaded' || status === 'Loaded for Transit') targetPct = 0.5;
            else if (status === 'In Route') targetPct = 0.7;
            else if (status === 'Arrived at Holding Pens' || status === 'Arrived at Regional Hub') targetPct = 0.9;
            else if (status === 'Delivered') targetPct = 1.0;

            // Open modal wizard
            document.getElementById('checkout-modal-overlay').classList.add('active');
            document.body.style.overflow = 'hidden';
            goToStep(3);

            startTrackingSimulation(targetPct, matchedOrder.hasLive);

            if (statusMsg) {
                statusMsg.style.display = 'block';
                statusMsg.style.color = 'var(--primary-green-light)';
                statusMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connected! Details loaded for Order Reference <strong>${cleanCode}</strong>.`;
            }
            return;
        } else {
            if (statusMsg) {
                statusMsg.style.display = 'block';
                statusMsg.style.color = '#dc3545';
                statusMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Reference ID <strong>"${rfidCode}"</strong> not found.`;
            }
            return;
        }
    }

    const result = RFID_DATABASE[cleanCode];

    if (result) {
        // Populating cattle details card
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('pass-tag-id', result.tagId);
        setEl('pass-breed', result.breed);
        setEl('pass-age', result.age);
        setEl('pass-division', result.division);
        setEl('pass-nutrition', result.nutrition);
        setEl('pass-vacc', result.vaccinations);
        setEl('pass-temp', result.tempCurve);

        placeholder.style.display = 'none';
        passport.style.display = 'block';

        if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.style.color = 'var(--primary-green-light)';
            statusMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connected! Records retrieved for tag <strong>${cleanCode}</strong>.`;
        }
    } else {
        passport.style.display = 'none';
        placeholder.style.display = 'block';
        if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.style.color = '#dc3545';
            statusMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> RFID Tag <strong>"${rfidCode}"</strong> not matched in the live farm database logs. Please check spelling.`;
        }
    }
};

// 7. CHECKOUT WIZARD PROCESS & VALIDATION
const setupCheckoutWizard = () => {
    const wizardOverlay = document.getElementById('checkout-modal-overlay');
    const closeBtn = document.getElementById('checkout-modal-close');
    const checkoutBtn = document.getElementById('cart-checkout-btn');

    if (!wizardOverlay || !closeBtn || !checkoutBtn) return;

    // Open Checkout
    checkoutBtn.addEventListener('click', openCheckoutWizard);

    // Close Checkout
    const closeCheckoutAction = () => {
        wizardOverlay.classList.remove('active');
        document.body.style.overflow = '';
        // If order was simulated, clear cart on final exit
        if (document.getElementById('checkout-step-pane-3').classList.contains('active')) {
            cart = [];
            appliedDiscount = 0;
            activeCoupon = '';
            const couponInput = document.getElementById('coupon-input');
            const couponMsg = document.getElementById('coupon-message');
            if (couponInput) couponInput.value = '';
            if (couponMsg) couponMsg.style.display = 'none';
            saveCartToStorage();
            updateCartHUD();
        }
    };

    closeBtn.addEventListener('click', closeCheckoutAction);
    document.getElementById('btn-tracker-reset').addEventListener('click', closeCheckoutAction);

    // Form steps navigation logic
    const formStep1 = document.getElementById('checkout-form-step-1');
    const formStep2 = document.getElementById('checkout-form-step-2');

    // Step 1 Submission
    formStep1.addEventListener('submit', (e) => {
        e.preventDefault();
        if (validateStep1()) {
            goToStep(2);
        }
    });

    // Back to Step 1
    document.getElementById('btn-back-to-step-1').addEventListener('click', () => {
        goToStep(1);
    });

    // Step 2 Submission (Confirm Order)
    formStep2.addEventListener('submit', (e) => {
        e.preventDefault();

        const checkedPayment = document.querySelector('input[name="payment_method"]:checked');
        const isCOD = checkedPayment ? checkedPayment.value === 'COD' : false;
        if (isCOD || validateStep2()) {
            submitOrderSimulation();
        }
    });

    // Toggle Payment tabs Card vs COD
    const payRadios = document.querySelectorAll('input[name="payment_method"]');
    const payTabs = document.querySelectorAll('.pay-tab');
    const cardSection = document.getElementById('card-payment-details');
    const codSection = document.getElementById('cod-payment-details');

    payRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            payTabs.forEach(tab => tab.classList.remove('active'));
            radio.parentElement.classList.add('active');

            if (radio.value === 'COD') {
                cardSection.style.display = 'none';
                codSection.style.display = 'block';
                clearCardValidators();
            } else {
                cardSection.style.display = 'block';
                codSection.style.display = 'none';
            }
        });
    });

    payTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const radio = tab.querySelector('input');
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        });
    });

    // Toggle Qurbani Service Tabs
    const serviceRadios = document.querySelectorAll('input[name="qurbani_service"]');
    const serviceTabs = document.querySelectorAll('.service-tab');

    serviceRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            serviceTabs.forEach(tab => tab.classList.remove('active'));
            radio.parentElement.classList.add('active');
            selectedQurbaniService = radio.value;
        });
    });

    serviceTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const radio = tab.querySelector('input');
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        });
    });

    // City Selection updates transit price dynamically
    const citySelector = document.getElementById('checkout-city');
    if (citySelector) {
        citySelector.addEventListener('change', (e) => {
            selectedCity = e.target.value;
            calculateTotals();
        });
    }

    // Card Input Auto Formatters
    const cardInput = document.getElementById('card-number');
    const cardExpiry = document.getElementById('card-expiry');

    if (cardInput) {
        cardInput.addEventListener('input', (e) => {
            let val = cardInput.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
            let matches = val.match(/\d{4,16}/g);
            let match = matches && matches[0] || '';
            let parts = [];

            for (let i = 0, len = match.length; i < len; i += 4) {
                parts.push(match.substring(i, i + 4));
            }

            if (parts.length > 0) {
                cardInput.value = parts.join(' ');
            } else {
                cardInput.value = val;
            }

            const icon = document.getElementById('card-brand-icon');
            if (val.startsWith('4')) {
                icon.className = 'fa-brands fa-cc-visa';
                icon.style.color = '#3b71ca';
            } else if (val.startsWith('5')) {
                icon.className = 'fa-brands fa-cc-mastercard';
                icon.style.color = '#f59e0b';
            } else if (val.startsWith('3')) {
                icon.className = 'fa-brands fa-cc-amex';
                icon.style.color = '#10b981';
            } else {
                icon.className = 'fa-solid fa-credit-card';
                icon.style.color = 'var(--text-muted)';
            }
        });
    }

    if (cardExpiry) {
        cardExpiry.addEventListener('input', (e) => {
            let val = cardExpiry.value.replace(/\D/g, '');
            if (val.length >= 2) {
                cardExpiry.value = val.substring(0, 2) + '/' + val.substring(2, 4);
            } else {
                cardExpiry.value = val;
            }
        });
    }
};

const resetWizardState = () => {
    const hasLive = checkCartHasLiveAnimals();

    // Reset wizard headers
    document.getElementById('checkout-wizard-header').style.display = 'block';

    // Change steps indicators based on mode
    const text1 = document.querySelector('#indicator-step-1 .step-text');
    const text2 = document.querySelector('#indicator-step-2 .step-text');
    const text3 = document.querySelector('#indicator-step-3 .step-text');

    if (hasLive) {
        if (text1) text1.textContent = "Rearing & Service";
        if (text2) text2.textContent = "Booking Deposit";
        if (text3) text3.textContent = "Live GPS Tracker";
    } else {
        if (text1) text1.textContent = "Delivery Address";
        if (text2) text2.textContent = "Secure Payment";
        if (text3) text3.textContent = "Reefer Cold-Chain";
    }

    document.getElementById('checkout-form-step-1').reset();
    document.getElementById('checkout-form-step-2').reset();

    document.querySelectorAll('.form-group').forEach(grp => {
        grp.classList.remove('valid', 'invalid');
        const err = grp.querySelector('.validation-msg');
        if (err) err.style.display = 'none';
    });

    // Morph step 1 inputs dynamically
    const qurbaniGroup = document.getElementById('qurbani-service-group');
    if (qurbaniGroup) {
        qurbaniGroup.style.display = hasLive ? 'block' : 'none';
    }

    // Morph step 2 payments text & methods dynamically
    const payText = document.getElementById('pay-tab-cod-text');
    const payDesc = document.getElementById('cod-gateway-desc');
    const payTitle = document.getElementById('cod-gateway-title');
    const payIcon = document.getElementById('cod-gateway-icon');
    const payInstructions = document.getElementById('checkout-payment-instructions');
    const btnSubmit = document.getElementById('btn-submit-order');

    if (hasLive) {
        if (payText) payText.textContent = "COD / Bank Deposit";
        if (payInstructions) payInstructions.textContent = "To secure your Qurbani animal, a 50% advance booking deposit is required. Settle remaining values on delivery.";
        if (payTitle) payTitle.textContent = "Bank Transfer Required";
        if (payDesc) payDesc.textContent = "Submit a 50% deposit payment slip to BA Farms MCB Corporate Account: 0982-14029-2194.";
        if (payIcon) payIcon.className = "fa-solid fa-university";
        if (btnSubmit) btnSubmit.innerHTML = 'Book Qurbani Animal <i class="fa-solid fa-circle-check"></i>';
    } else {
        if (payText) payText.textContent = "Cash on Delivery";
        if (payInstructions) payInstructions.textContent = "Select your payment gateway below. Debit card transactions are simulated securely.";
        if (payTitle) payTitle.textContent = "Cash on Delivery Option Activated";
        if (payDesc) payDesc.textContent = "You will settle the invoice value in cash directly with the cold-chain logistics driver at your doorstep.";
        if (payIcon) payIcon.className = "fa-solid fa-truck-loading";
        if (btnSubmit) btnSubmit.innerHTML = 'Confirm Order & Checkout <i class="fa-solid fa-circle-check"></i>';
    }

    document.getElementById('pay-tab-card').classList.add('active');
    document.getElementById('pay-tab-cod').classList.remove('active');
    document.querySelector('input[name="payment_method"][value="Card"]').checked = true;
    document.getElementById('card-payment-details').style.display = 'block';
    document.getElementById('cod-payment-details').style.display = 'none';

    document.getElementById('service-tab-live').classList.add('active');
    document.getElementById('service-tab-slaughter').classList.remove('active');
    document.querySelector('input[name="qurbani_service"][value="LiveDelivery"]').checked = true;
    selectedQurbaniService = 'LiveDelivery';
    selectedCity = 'Lahore';

    cancelTrackingSimulation();
    goToStep(1);
};

const openCheckoutWizard = () => {
    if (cart.length === 0) return;

    // Close cart drawer
    const cartDrawer = document.getElementById('cart-drawer');
    const cartOverlay = document.getElementById('cart-drawer-overlay');
    if (cartDrawer) cartDrawer.classList.remove('active');
    if (cartOverlay) cartOverlay.classList.remove('active');

    // Launch Wizard
    resetWizardState();
    const wizardOverlay = document.getElementById('checkout-modal-overlay');
    if (wizardOverlay) {
        wizardOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    // Set wizard title based on cart contents
    const hasLiveInCart = checkCartHasLiveAnimals();
    const wizardTitle = document.getElementById('checkout-wizard-title');
    if (wizardTitle) {
        wizardTitle.textContent = hasLiveInCart ? 'Qurbani Booking Wizard' : 'Secure Checkout';
    }
};

const goToStep = (stepNumber) => {
    const pane1 = document.getElementById('checkout-form-step-1');
    const pane2 = document.getElementById('checkout-form-step-2');
    const pane3 = document.getElementById('checkout-step-pane-3');

    const ind1 = document.getElementById('indicator-step-1');
    const ind2 = document.getElementById('indicator-step-2');
    const ind3 = document.getElementById('indicator-step-3');

    const line1 = document.getElementById('line-step-1');
    const line2 = document.getElementById('line-step-2');

    pane1.classList.remove('active');
    pane2.classList.remove('active');
    pane3.classList.remove('active');

    ind1.className = 'step-indicator';
    ind2.className = 'step-indicator';
    ind3.className = 'step-indicator';

    line1.className = 'step-line';
    line2.className = 'step-line';

    if (stepNumber === 1) {
        pane1.classList.add('active');
        ind1.classList.add('active');
    } else if (stepNumber === 2) {
        pane2.classList.add('active');
        ind1.classList.add('completed');
        line1.classList.add('completed');
        ind2.classList.add('active');
    } else if (stepNumber === 3) {
        pane3.classList.add('active');
        ind1.classList.add('completed');
        line1.classList.add('completed');
        ind2.classList.add('completed');
        line2.classList.add('completed');
        ind3.classList.add('active');
    }
};

const setInputState = (inputId, msgId, isValid, message = '') => {
    const inputEl = document.getElementById(inputId);
    const msgEl = document.getElementById(msgId);
    if (!inputEl) return;

    const formGroup = inputEl.closest('.form-group');
    if (isValid) {
        if (formGroup) {
            formGroup.classList.remove('invalid');
            formGroup.classList.add('valid');
        }
        if (msgEl) {
            msgEl.textContent = '';
            msgEl.style.display = 'none';
        }
    } else {
        if (formGroup) {
            formGroup.classList.remove('valid');
            formGroup.classList.add('invalid');
        }
        if (msgEl) {
            msgEl.textContent = message;
            msgEl.style.display = 'block';
        }
    }
};

const validateStep1 = () => {
    let isValid = true;

    const nameVal = document.getElementById('checkout-name').value.trim();
    if (!nameVal || nameVal.length < 3) {
        setInputState('checkout-name', 'checkout-msg-name', false, 'Full recipient name is required.');
        isValid = false;
    } else {
        setInputState('checkout-name', 'checkout-msg-name', true);
    }

    const phoneVal = document.getElementById('checkout-phone').value.trim();
    const phoneRegex = /^03\d{9}$/;
    if (!phoneVal || !phoneRegex.test(phoneVal)) {
        setInputState('checkout-phone', 'checkout-msg-phone', false, 'Enter a valid Pakistani mobile number (03XXXXXXXXX).');
        isValid = false;
    } else {
        setInputState('checkout-phone', 'checkout-msg-phone', true);
    }

    const emailVal = document.getElementById('checkout-email').value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailVal || !emailRegex.test(emailVal)) {
        setInputState('checkout-email', 'checkout-msg-email', false, 'Enter a valid email address.');
        isValid = false;
    } else {
        setInputState('checkout-email', 'checkout-msg-email', true);
    }

    const cityVal = document.getElementById('checkout-city').value;
    if (!cityVal) {
        setInputState('checkout-city', 'checkout-msg-city', false, 'Please select a delivery city.');
        isValid = false;
    } else {
        setInputState('checkout-city', 'checkout-msg-city', true);
    }

    const addressVal = document.getElementById('checkout-address').value.trim();
    if (!addressVal || addressVal.length < 10) {
        setInputState('checkout-address', 'checkout-msg-address', false, 'Provide a detailed shipping address (min 10 chars).');
        isValid = false;
    } else {
        setInputState('checkout-address', 'checkout-msg-address', true);
    }

    return isValid;
};

const validateStep2 = () => {
    let isValid = true;

    const holderVal = document.getElementById('card-holder').value.trim();
    if (!holderVal || holderVal.length < 3) {
        setInputState('card-holder', 'checkout-msg-holder', false, 'Card holder name is required.');
        isValid = false;
    } else {
        setInputState('card-holder', 'checkout-msg-holder', true);
    }

    const cardVal = document.getElementById('card-number').value.replace(/\s/g, '');
    if (!cardVal || cardVal.length < 16) {
        setInputState('card-number', 'checkout-msg-cardno', false, 'Enter a valid 16-digit card number.');
        isValid = false;
    } else {
        setInputState('card-number', 'checkout-msg-cardno', true);
    }

    const expiryVal = document.getElementById('card-expiry').value.trim();
    const expRegex = /^(0[1-9]|1[0-2])\/?([2-3][0-9])$/;
    if (!expiryVal || !expRegex.test(expiryVal)) {
        setInputState('card-expiry', 'checkout-msg-expiry', false, 'Enter expiry date in MM/YY format.');
        isValid = false;
    } else {
        setInputState('card-expiry', 'checkout-msg-expiry', true);
    }

    const cvvVal = document.getElementById('card-cvv').value.trim();
    if (!cvvVal || cvvVal.length < 3) {
        setInputState('card-cvv', 'checkout-msg-cvv', false, 'Enter CVC/CVV security code.');
        isValid = false;
    } else {
        setInputState('card-cvv', 'checkout-msg-cvv', true);
    }

    return isValid;
};

const clearCardValidators = () => {
    setInputState('card-holder', 'checkout-msg-holder', true);
    setInputState('card-number', 'checkout-msg-cardno', true);
    setInputState('card-expiry', 'checkout-msg-expiry', true);
    setInputState('card-cvv', 'checkout-msg-cvv', true);
};

// 8. COLD-CHAIN MOTORWAY TRANSIT SIMULATION (GPS MAP)
let trackingAnimationId = null;
let trackingIntervalId = null;

const submitOrderSimulation = () => {
    const btnSubmit = document.getElementById('btn-submit-order');
    const isLive = checkCartHasLiveAnimals();
    btnSubmit.setAttribute('disabled', 'disabled');
    const originalText = btnSubmit.innerHTML;

    btnSubmit.innerHTML = isLive ? '<i class="fa-solid fa-spinner fa-spin"></i> Processing booking...' : '<i class="fa-solid fa-spinner fa-spin"></i> Authorizing payment...';

    setTimeout(async () => {
        btnSubmit.removeAttribute('disabled');
        btnSubmit.innerHTML = originalText;

        const randRef = isLive ? 'BA-QUR-' + Math.floor(10000 + Math.random() * 90000) : 'BA-ORD-' + Math.floor(10000 + Math.random() * 90000);
        document.getElementById('receipt-order-ref').textContent = randRef;
        document.getElementById('checkout-wizard-header').style.display = 'none';

        // Set success title based on type
        const successTitle = document.getElementById('success-header-title');
        if (successTitle) {
            successTitle.textContent = isLive ? "Qurbani Booking Confirmed!" : "Order Received Successfully!";
        }

        // Calculate pricing sums
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        let shipping = isLive ? (selectedCity === 'Faisalabad' ? 0 : (selectedCity === 'Karachi' ? 12000 : 5000)) : (selectedCity === 'Faisalabad' ? 0 : 350);
        const discountAmount = Math.round(subtotal * (appliedDiscount / 100));
        const total = subtotal - discountAmount + shipping;

        // Create Order Object
        const orderData = {
            id: randRef,
            date: new Date().toISOString().split('T')[0],
            customerName: document.getElementById('checkout-name').value.trim(),
            customerPhone: document.getElementById('checkout-phone').value.trim(),
            customerEmail: document.getElementById('checkout-email').value.trim(),
            customerCity: selectedCity,
            customerAddress: document.getElementById('checkout-address').value.trim(),
            paymentMethod: document.querySelector('input[name="payment_method"]:checked').value,
            qurbaniService: isLive ? document.querySelector('input[name="qurbani_service"]:checked').value : null,
            hasLive: isLive,
            status: 'Confirmed',
            items: cart.map(item => ({
                id: item.id,
                title: item.title,
                price: item.price,
                quantity: item.quantity,
                rfid: item.rfid
            })),
            netTotal: total
        };

        // Persist order to DB and update in-memory list for same-session lookups
        try {
            await fetch('/api/farm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'ADD_ORDER', payload: orderData })
            });
        } catch (err) {
            console.error('Failed to persist order to database:', err);
        }
        dbOrders.push(orderData);

        // Mark live animals as sold in database
        if (isLive) {
            for (const cartItem of cart) {
                const anim = dbAnimals.find(a => a.rfid === cartItem.rfid);
                if (anim) {
                    // Trigger Postgres DB Sync
                    try {
                        await fetch('/api/farm', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'RECORD_SALE',
                                payload: {
                                    animalId: anim.id,
                                    salePrice: cartItem.price * cartItem.quantity,
                                    buyerName: orderData.customerName,
                                    saleDate: orderData.date
                                }
                            })
                        });
                    } catch (err) {
                        console.error('Failed to sync sale to database:', err);
                    }
                    // Update in-memory dbAnimals so catalog reflects sold status immediately
                    anim.status = 'Sold';
                    anim.buyerName = orderData.customerName;
                    anim.salePrice = cartItem.price * cartItem.quantity;
                    anim.saleDate = orderData.date;
                }
            }
        }

        // Initialize progress tracker steps dynamically based on Qurbani service chosen vs Standard Meat cuts
        const stepsContainer = document.getElementById('tracker-steps-container');
        if (isLive) {
            if (selectedQurbaniService === 'LiveDelivery') {
                stepsContainer.innerHTML = `
                    <div class="track-step active" id="ts-1"><i class="fa-solid fa-stethoscope"></i> Vet health & age verification check</div>
                    <div class="track-step" id="ts-2"><i class="fa-solid fa-dolly"></i> Animal loaded on specialized transport</div>
                    <div class="track-step" id="ts-3"><i class="fa-solid fa-road"></i> Motorway transit (watering/feeding stops)</div>
                    <div class="track-step" id="ts-4"><i class="fa-solid fa-warehouse"></i> Local city holding pens check-in</div>
                    <div class="track-step" id="ts-5"><i class="fa-solid fa-house-chimney-user"></i> Doorstep hand-off (Passports delivered)</div>
                `;
            } else {
                stepsContainer.innerHTML = `
                    <div class="track-step active" id="ts-1"><i class="fa-solid fa-shield-virus"></i> Bio-safety quarantine rest & Sunnah feeding</div>
                    <div class="track-step" id="ts-2"><i class="fa-solid fa-mosque"></i> Slaughter at partner certified Halal facility</div>
                    <div class="track-step" id="ts-3"><i class="fa-solid fa-snowflake"></i> Chilling & vacuum packaging at partner facility</div>
                    <div class="track-step" id="ts-4"><i class="fa-solid fa-truck-cold"></i> Dispatch via cold chain refrigerated reefers</div>
                    <div class="track-step" id="ts-5"><i class="fa-solid fa-box-open"></i> Doorstep delivery of chilled meat boxes</div>
                `;
            }
        } else {
            // cuts only cold-chain steps
            stepsContainer.innerHTML = `
                <div class="track-step active" id="ts-1"><i class="fa-solid fa-snowflake"></i> Chilled reefer pre-cooling (2°C)</div>
                <div class="track-step" id="ts-2"><i class="fa-solid fa-dolly"></i> Cargo loading & weight audit check-in</div>
                <div class="track-step" id="ts-3"><i class="fa-solid fa-road"></i> Motorway cold chain transit (M-4 route)</div>
                <div class="track-step" id="ts-4"><i class="fa-solid fa-warehouse"></i> Regional distribution hub inspection</div>
                <div class="track-step" id="ts-5"><i class="fa-solid fa-box-open"></i> Doorstep chilled meat delivery</div>
            `;
        }

        goToStep(3);
        startTrackingSimulation();
    }, 1500);
};

const startTrackingSimulation = (targetPct = null, orderIsLive = null) => {
    const city = selectedCity;
    const destNameSpan = document.getElementById('map-dest-name');
    const destDot = document.getElementById('dest-city-dot');

    if (city === 'Faisalabad') {
        destNameSpan.textContent = 'Faisalabad Local';
        if (destDot) destDot.className = 'city-dot pulse-gold';
    } else if (city === 'Lahore') {
        destNameSpan.textContent = 'Lahore Hub';
        if (destDot) destDot.className = 'city-dot pulse-gold';
    } else if (city === 'Karachi') {
        destNameSpan.textContent = 'Karachi Hub';
        if (destDot) destDot.className = 'city-dot pulse-gold';
    }

    const canvas = document.getElementById('tracker-canvas');
    if (!canvas) return;

    // Sync canvas buffer to its actual CSS render size so drawing scales correctly on all screens
    canvas.width = canvas.offsetWidth || 300;
    canvas.height = canvas.offsetHeight || 180;
    const cw = canvas.width;
    const ch = canvas.height;

    const ctx = canvas.getContext('2d');

    // Coordinates as fractions of canvas size — no hardcoded pixels
    let startX = cw * 0.12;
    let startY = ch * 0.75;
    let endX   = cw * 0.88;
    let endY   = ch * 0.19;

    if (city === 'Faisalabad') {
        endX = cw * 0.40;
        endY = ch * 0.56;
        const tag = document.getElementById('map-dest-tag');
        if (tag) { tag.style.left = `${cw * 0.35}px`; tag.style.top = `${ch * 0.50}px`; tag.style.right = 'auto'; }
    } else if (city === 'Lahore') {
        endX = cw * 0.88;
        endY = ch * 0.19;
        const tag = document.getElementById('map-dest-tag');
        if (tag) { tag.style.right = '25px'; tag.style.top = '25px'; tag.style.left = 'auto'; }
    } else if (city === 'Karachi') {
        endX = cw * 0.73;
        endY = ch * 0.89;
        const tag = document.getElementById('map-dest-tag');
        if (tag) { tag.style.right = '40px'; tag.style.top = `${ch * 0.80}px`; tag.style.left = 'auto'; }
    }

    let progress = 0;
    const speed = city === 'Faisalabad' ? 0.008 : (city === 'Lahore' ? 0.004 : 0.0025);

    const textStatus = document.getElementById('live-tracker-status');
    const timeStatus = document.getElementById('live-tracker-time');
    const gpsPctSpan = document.getElementById('live-gps-pct');
    const isLive = orderIsLive !== null ? orderIsLive : checkCartHasLiveAnimals();
    const maxPct = targetPct !== null ? targetPct : 1.0;

    const animateLoop = () => {
        const ts1 = document.getElementById('ts-1');
        const ts2 = document.getElementById('ts-2');
        const ts3 = document.getElementById('ts-3');
        const ts4 = document.getElementById('ts-4');
        const ts5 = document.getElementById('ts-5');

        progress += speed;
        if (progress > maxPct) progress = maxPct;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw Highway Route dashed line
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        if (city === 'Lahore') {
            ctx.quadraticCurveTo(120, 40, endX, endY);
        } else if (city === 'Karachi') {
            ctx.quadraticCurveTo(startX + 100, startY + 30, endX, endY);
        } else {
            ctx.lineTo(endX, endY);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Draw Completed path (Solid gold)
        ctx.beginPath();
        ctx.moveTo(startX, startY);

        let currentX = startX + (endX - startX) * progress;
        let currentY = startY + (endY - startY) * progress;

        if (city === 'Lahore') {
            const t = progress;
            const cx = 120;
            const cy = 40;
            currentX = (1-t)*(1-t)*startX + 2*(1-t)*t*cx + t*t*endX;
            currentY = (1-t)*(1-t)*startY + 2*(1-t)*t*cy + t*t*endY;

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            for (let i = 0; i <= t * 50; i++) {
                const stepT = i / 50;
                const bx = (1-stepT)*(1-stepT)*startX + 2*(1-stepT)*stepT*cx + stepT*stepT*endX;
                const by = (1-stepT)*(1-stepT)*startY + 2*(1-stepT)*stepT*cy + stepT*stepT*endY;
                ctx.lineTo(bx, by);
            }
        } else if (city === 'Karachi') {
            const t = progress;
            const cx = startX + 100;
            const cy = startY + 30;
            currentX = (1-t)*(1-t)*startX + 2*(1-t)*t*cx + t*t*endX;
            currentY = (1-t)*(1-t)*startY + 2*(1-t)*t*cy + t*t*endY;

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            for (let i = 0; i <= t * 50; i++) {
                const stepT = i / 50;
                const bx = (1-stepT)*(1-stepT)*startX + 2*(1-stepT)*stepT*cx + stepT*stepT*endX;
                const by = (1-stepT)*(1-stepT)*startY + 2*(1-stepT)*stepT*cy + stepT*stepT*endY;
                ctx.lineTo(bx, by);
            }
        } else {
            ctx.lineTo(currentX, currentY);
        }

        ctx.strokeStyle = 'var(--accent-gold)';
        ctx.lineWidth = 4;
        ctx.shadowColor = 'var(--accent-gold-glow)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(currentX, currentY, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'var(--accent-gold)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const displayPct = Math.round(progress * 100);
        gpsPctSpan.textContent = `${displayPct}%`;

        // Manage Phase status transitions dynamically based on Qurbani service chosen vs Standard Meat cuts
        if (displayPct >= 0 && displayPct < 15) {
            if (isLive) {
                textStatus.textContent = selectedQurbaniService === 'LiveDelivery' ? 'Rearing verification check...' : 'Pre-slaughter quarantine rest...';
                timeStatus.textContent = selectedQurbaniService === 'LiveDelivery' ? 'Scanning RFID health logs before boarding...' : 'Sunnah grain feeds and diagnostic checkups...';
            } else {
                textStatus.textContent = 'Reefer pre-cooling to 2°C...';
                timeStatus.textContent = 'Pre-cooling vehicle cargo hold to ensure safety temp...';
            }
            if (ts1) ts1.className = 'track-step active';
        } else if (displayPct >= 15 && displayPct < 35) {
            if (isLive) {
                textStatus.textContent = selectedQurbaniService === 'LiveDelivery' ? 'Cattle loaded into transit...' : 'Executing Halal Slaughter...';
                timeStatus.textContent = selectedQurbaniService === 'LiveDelivery' ? 'Safe boarding inside ventilated double-deck trucks...' : 'Slaughter executed at partner certified Halal facility...';
            } else {
                textStatus.textContent = 'Cargo loading & audit scan...';
                timeStatus.textContent = 'Scanning package RFID labels for database logging...';
            }
            if (ts1) ts1.className = 'track-step completed';
            if (ts2) ts2.className = 'track-step active';
        } else if (displayPct >= 35 && displayPct < 75) {
            if (isLive) {
                textStatus.textContent = selectedQurbaniService === 'LiveDelivery' ? 'Highway Transit - In Route' : 'Portioning & Cold Room Packaging';
                timeStatus.textContent = selectedQurbaniService === 'LiveDelivery' ? 'Traveling via Motorway (livestock rest stops)...' : 'Vacuum skin packaging in partner facility cleanrooms...';
            } else {
                textStatus.textContent = 'Motorway Transit - In Route';
                timeStatus.textContent = 'Chilled truck traveling on highway. Temperature: 2.1°C.';
            }
            if (ts1) ts1.className = 'track-step completed';
            if (ts2) ts2.className = 'track-step completed';
            if (ts3) ts3.className = 'track-step active';
        } else if (displayPct >= 75 && displayPct < 95) {
            if (isLive) {
                textStatus.textContent = selectedQurbaniService === 'LiveDelivery' ? 'Arrived at Local holding pens' : 'Dispatching chilled reefers';
                timeStatus.textContent = selectedQurbaniService === 'LiveDelivery' ? 'Watering and city entry quarantine check-ins...' : 'Refrigerated transit delivering meat portions to regional hub...';
            } else {
                textStatus.textContent = 'Arrived at Regional Cooling Hub';
                timeStatus.textContent = 'Verifying cold-chain telemetry logs. Dispatching local van...';
            }
            if (ts1) ts1.className = 'track-step completed';
            if (ts2) ts2.className = 'track-step completed';
            if (ts3) ts3.className = 'track-step completed';
            if (ts4) ts4.className = 'track-step active';
        } else if (displayPct >= 95 && displayPct < 100) {
            textStatus.textContent = 'Out for doorstep delivery';
            timeStatus.textContent = isLive ? 'Livestock vehicle approaching your address...' : 'Delivery courier arriving at your doorstep...';
            if (ts1) ts1.className = 'track-step completed';
            if (ts2) ts2.className = 'track-step completed';
            if (ts3) ts3.className = 'track-step completed';
            if (ts4) ts4.className = 'track-step completed';
            if (ts5) ts5.className = 'track-step active';
        } else if (displayPct === 100) {
            textStatus.textContent = isLive ? (selectedQurbaniService === 'LiveDelivery' ? 'Animal Delivered! Eid Mubarak' : 'Chilled Meat Delivered! Eid Mubarak') : 'Meat Boxes Delivered! Eid Mubarak';
            timeStatus.textContent = isLive ? (selectedQurbaniService === 'LiveDelivery' ? 'Verification documents and RFID passport handed over.' : 'Chilled vacuum meat boxes handed over successfully.') : 'Order hand-off complete. Cold chain integrity verified.';
            if (ts1) ts1.className = 'track-step completed';
            if (ts2) ts2.className = 'track-step completed';
            if (ts3) ts3.className = 'track-step completed';
            if (ts4) ts4.className = 'track-step completed';
            if (ts5) ts5.className = 'track-step completed';
        }

        if (progress < maxPct) {
            trackingAnimationId = requestAnimationFrame(animateLoop);
        }
    };

    trackingAnimationId = requestAnimationFrame(animateLoop);
};

const cancelTrackingSimulation = () => {
    if (trackingAnimationId) {
        cancelAnimationFrame(trackingAnimationId);
        trackingAnimationId = null;
    }
    if (trackingIntervalId) {
        clearInterval(trackingIntervalId);
        trackingIntervalId = null;
    }
};

const openCartDrawer = () => {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('cart-drawer-overlay');
    if (drawer && overlay) {
        drawer.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
};

const closeCartDrawer = () => {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('cart-drawer-overlay');
    if (drawer && overlay) {
        drawer.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
};

// Fetch latest catalog from Postgres/Neon API (if online) to match portal updates
const syncFromRemoteDatabase = async () => {
    try {
        const res = await fetch('/api/farm');
        const data = await res.json();
        if (data.success) {
            if (data.animals) dbAnimals = data.animals;
            if (data.meatCuts) dbMeatCuts = data.meatCuts;
            if (data.orders) dbOrders = data.orders;
            syncProductsFromState();
            renderCatalog();
        }
    } catch (e) {
        console.warn('API sync failed, using local seed data:', e);
    }
};

// 9. EVENT LISTENERS INITIALIZATION
const initShop = () => {
    // Render immediately from SEED_LIVESTOCK fallback for instant paint
    syncProductsFromState();
    loadCartFromStorage();
    updateCartHUD();
    renderCatalog();

    // Then fetch from DB — will update catalog when response arrives
    syncFromRemoteDatabase();

    // Cross-tab cart sync only (orders/meat cuts come from DB now)
    window.addEventListener('storage', (e) => {
        if (e.key === 'ba_farms_combined_cart') {
            loadCartFromStorage();
            updateCartHUD();
        }
    });

    const categoryTabs = document.querySelectorAll('.filter-tab');
    categoryTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            categoryTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.getAttribute('data-filter');
            renderCatalog();
        });
    });

    const cartToggle = document.getElementById('cart-toggle-btn');
    const cartClose = document.getElementById('cart-drawer-close');
    const cartContinue = document.getElementById('btn-cart-continue');
    const cartOverlay = document.getElementById('cart-drawer-overlay');
    const cartDrawer = document.getElementById('cart-drawer');

    if (cartToggle) cartToggle.addEventListener('click', openCartDrawer);
    if (cartClose) cartClose.addEventListener('click', closeCartDrawer);
    if (cartContinue) cartContinue.addEventListener('click', closeCartDrawer);
    if (cartOverlay) cartOverlay.addEventListener('click', closeCartDrawer);

    const couponInput = document.getElementById('coupon-input');
    const couponBtn = document.getElementById('coupon-apply-btn');
    const couponMsg = document.getElementById('coupon-message');

    if (couponBtn && couponInput && couponMsg) {
        couponBtn.addEventListener('click', () => {
            const code = couponInput.value.trim().toUpperCase();
            if (code === 'BAFARMS20') {
                appliedDiscount = 20;
                activeCoupon = code;
                couponMsg.style.color = 'var(--primary-green-light)';
                couponMsg.innerHTML = '<i class="fa-solid fa-circle-check"></i> Coupon applied successfully! 20% discount activated.';
                couponMsg.style.display = 'block';
                updateCartHUD();
            } else if (code === '') {
                couponMsg.style.display = 'none';
            } else {
                appliedDiscount = 0;
                activeCoupon = '';
                couponMsg.style.color = '#dc3545';
                couponMsg.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Invalid discount code.';
                couponMsg.style.display = 'block';
                updateCartHUD();
            }
        });
    }

    const traceForm = document.getElementById('trace-search-form');
    const traceInput = document.getElementById('trace-input');

    if (traceForm && traceInput) {
        traceForm.addEventListener('submit', (e) => {
            e.preventDefault();
            triggerTraceLookup(traceInput.value);
        });
    }

    document.querySelectorAll('.trace-suggestions .tag-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.getAttribute('data-tag');
            if (traceInput) traceInput.value = tag;
            triggerTraceLookup(tag);
        });
    });

    const mobileToggle = document.getElementById('shop-menu-toggle');
    const mobileNav = document.getElementById('shop-nav-menu');

    if (mobileToggle && mobileNav) {
        const toggleIcon = mobileToggle.querySelector('i');
        mobileToggle.addEventListener('click', () => {
            mobileNav.classList.toggle('mobile-active');
            if (mobileNav.classList.contains('mobile-active')) {
                toggleIcon.className = 'fa-solid fa-xmark';
                document.body.style.overflow = 'hidden';
            } else {
                toggleIcon.className = 'fa-solid fa-bars';
                document.body.style.overflow = '';
            }
        });

        mobileNav.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                mobileNav.classList.remove('mobile-active');
                toggleIcon.className = 'fa-solid fa-bars';
                document.body.style.overflow = '';
            });
        });
    }

    setupCheckoutWizard();

    // Cross-module exposures for product detail page
    window.PRODUCTS = PRODUCTS;
    window.RFID_DATABASE = RFID_DATABASE;
    window.addToCart = addToCart;
    window.openCartDrawer = openCartDrawer;
    window.openCheckoutWizard = openCheckoutWizard;

    Object.defineProperty(window, 'selectedCity', {
        get: () => selectedCity,
        set: (val) => {
            selectedCity = val;
            const citySel = document.getElementById('checkout-city');
            if (citySel) citySel.value = val;
            calculateTotals();
        }
    });

    Object.defineProperty(window, 'selectedQurbaniService', {
        get: () => selectedQurbaniService,
        set: (val) => {
            selectedQurbaniService = val;
            calculateTotals();
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShop);
} else {
    initShop();
}
