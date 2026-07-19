import React, { createContext, useState, useEffect, useRef } from 'react';

export const FarmContext = createContext();

const loadStoredData = (key, defaultVal) => {
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (false) { // seed detection removed — no more demo data
                localStorage.removeItem(key);
                return defaultVal;
            }
            return parsed;
        }
        return defaultVal;
    } catch (e) {
        console.error("Error loading LocalStorage key: " + key, e);
        return defaultVal;
    }
};

const defaultBreeds = [
    { name: 'Sahiwal', defaultTargetWeight: 360 },
    { name: 'Cholistani', defaultTargetWeight: 360 },
    { name: 'Beetal', defaultTargetWeight: 75 },
    { name: 'Kajla', defaultTargetWeight: 65 },
    { name: 'Teddy', defaultTargetWeight: 45 },
    { name: 'Angus Cross', defaultTargetWeight: 450 },
    { name: 'Brahman Cross', defaultTargetWeight: 420 }
];

const defaultMedCategories = ['Vaccination', 'Deworming', 'Antibiotic', 'Supplement', 'Injury'];

const defaultSystemParams = {
    weighIntervalDays: 14,
    quarantineDays: 14,
    adgAlertThreshold: 1.0
};

const defaultQuarantineProtocols = [
    { id: 'deworm', label: 'Deworm',      dueDay: 1,  type: 'Deworming',   medicine: 'Ivermectin',   dosage: '5ml',   withholding: 21 },
    { id: 'fmd1',   label: 'FMD',         dueDay: 1,  type: 'Vaccination', medicine: 'FMD Vaccine',  dosage: '2ml',   withholding: 0  },
    { id: 'vitb12', label: 'Vit B12',     dueDay: 1,  type: 'Vaccination', medicine: 'Vitamin B12',  dosage: '3ml',   withholding: 0  },
    { id: 'tick',   label: 'Tick Spray',  dueDay: 1,  type: 'Injury',      medicine: 'Cypermethrin', dosage: 'Spray', withholding: 7  },
    { id: 'fmd2',   label: 'FMD Boost',   dueDay: 7,  type: 'Vaccination', medicine: 'FMD Vaccine',  dosage: '2ml',   withholding: 0  },
];

const defaultMeatCuts = [
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
        images: ['/assets/ribeye_steak.png', '/assets/tbone_steak.png', '/assets/striploin_steak.png']
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
        images: ['/assets/tbone_steak.png', '/assets/ribeye_steak.png', '/assets/striploin_steak.png']
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
        images: ['/assets/striploin_steak.png', '/assets/ribeye_steak.png', '/assets/tbone_steak.png']
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
        images: ['/assets/minced_beef.png', '/assets/burger_patties.png']
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
        images: ['/assets/bong_cut.png', '/assets/minced_beef.png']
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
        images: ['/assets/burger_patties.png', '/assets/minced_beef.png']
    }
];

export const FarmProvider = ({ children }) => {
    // Auth States
    const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem('ba_staff_logged_in') === 'true');
    const [staffUser, setStaffUser] = useState(() => {
        const stored = localStorage.getItem('ba_staff_user');
        return stored ? JSON.parse(stored) : null;
    });
    // Admin-only roster of per-user Sales/Herd access (populated from GET when the
    // logged-in user is an admin; empty for everyone else).
    const [staffPermissions, setStaffPermissions] = useState([]);

    const handleLoginSuccess = (userSession) => {
        localStorage.setItem('ba_staff_logged_in', 'true');
        localStorage.setItem('ba_staff_user', JSON.stringify(userSession));
        setIsLoggedIn(true);
        setStaffUser(userSession);
    };

    // Attaches the staff session token (issued by /api/auth) to every write against
    // /api/farm. Without it, the server rejects all non-public actions with 401.
    const authHeaders = () => ({
        'Content-Type': 'application/json',
        ...(staffUser?.token ? { Authorization: `Bearer ${staffUser.token}` } : {})
    });

    // ─── DURABLE OFFLINE MUTATION QUEUE ───
    // Any write made while offline (or that hits a network error) is queued to
    // localStorage instead of being dropped. The queue is flushed in order on load,
    // whenever the browser regains connectivity, and on a periodic interval, so a
    // change is never silently lost even if the tab is closed before it syncs.
    // Exclusions: recordSale (must be verified live against the food-safety
    // withholding gate), resetSystem (destructive, must never auto-retry), and
    // updateStaffPermission (access-control changes need an immediate confirmation).
    const [pendingMutations, setPendingMutations] = useState(() => loadStoredData('ba_pending_mutations', []));
    const [failedMutations, setFailedMutations] = useState(() => loadStoredData('ba_failed_mutations', []));
    const [isSyncing, setIsSyncing] = useState(false);

    const pendingRef = useRef(pendingMutations);
    const staffUserRef = useRef(staffUser);
    const flushingRef = useRef(false);

    useEffect(() => { pendingRef.current = pendingMutations; }, [pendingMutations]);
    useEffect(() => { staffUserRef.current = staffUser; }, [staffUser]);

    useEffect(() => {
        localStorage.setItem('ba_pending_mutations', JSON.stringify(pendingMutations));
    }, [pendingMutations]);

    useEffect(() => {
        localStorage.setItem('ba_failed_mutations', JSON.stringify(failedMutations));
    }, [failedMutations]);

    const flushQueue = async () => {
        if (flushingRef.current || typeof navigator !== 'undefined' && navigator.onLine === false) return;
        flushingRef.current = true;
        setIsSyncing(true);
        try {
            while (pendingRef.current.length > 0) {
                const item = pendingRef.current[0];
                const headers = {
                    'Content-Type': 'application/json',
                    ...(staffUserRef.current?.token ? { Authorization: `Bearer ${staffUserRef.current.token}` } : {})
                };

                let res, data;
                try {
                    res = await fetch('/api/farm', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ action: item.action, payload: item.payload })
                    });
                    data = await res.json().catch(() => ({}));
                } catch (err) {
                    // Offline / network error — stop here so ordering is preserved,
                    // the item stays queued and we retry later.
                    break;
                }

                if (!res.ok || data.success === false) {
                    // Server rejected it (validation/permission/etc). Don't let this
                    // block the rest of the queue, but never drop it silently either.
                    const failedItem = { ...item, error: data.error || `HTTP ${res.status}`, failedAt: Date.now() };
                    setFailedMutations(prev => [...prev, failedItem]);
                }

                setPendingMutations(prev => prev.filter(p => p.id !== item.id));
                pendingRef.current = pendingRef.current.filter(p => p.id !== item.id);
            }
        } finally {
            flushingRef.current = false;
            setIsSyncing(false);
        }
    };

    // Queue a mutation durably, then attempt to sync it immediately if online.
    const persistMutation = (action, payload) => {
        const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, action, payload, createdAt: Date.now() };
        setPendingMutations(prev => [...prev, item]);
        // Let the pendingRef-sync effect commit before we read it in flushQueue.
        setTimeout(flushQueue, 0);
    };

    const retryFailedMutation = (id) => {
        const item = failedMutations.find(f => f.id === id);
        if (!item) return;
        setFailedMutations(prev => prev.filter(f => f.id !== id));
        setPendingMutations(prev => [...prev, { id: item.id, action: item.action, payload: item.payload, createdAt: item.createdAt }]);
        setTimeout(flushQueue, 0);
    };

    const dismissFailedMutation = (id) => {
        setFailedMutations(prev => prev.filter(f => f.id !== id));
    };

    useEffect(() => {
        flushQueue();
        window.addEventListener('online', flushQueue);
        const interval = setInterval(flushQueue, 20000);
        return () => {
            window.removeEventListener('online', flushQueue);
            clearInterval(interval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleLogout = () => {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const audioCtx = new AudioContext();
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 note
                osc.frequency.setValueAtTime(440, audioCtx.currentTime + 0.1); // A4 note
                gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.25);
            }
        } catch (e) {}

        localStorage.removeItem('ba_staff_logged_in');
        localStorage.removeItem('ba_staff_user');
        setIsLoggedIn(false);
        setStaffUser(null);
    };

    // Custom Configurations
    const [breedsConfig, setBreedsConfig] = useState(() => loadStoredData('ba_breeds_config', defaultBreeds));
    const [medCategories, setMedCategories] = useState(() => loadStoredData('ba_med_categories', defaultMedCategories));
    const [systemParams, setSystemParams] = useState(() => loadStoredData('ba_system_params', defaultSystemParams));
    const [quarantineProtocols, setQuarantineProtocols] = useState(() => loadStoredData('ba_quarantine_protocols', defaultQuarantineProtocols));

    const updateBreedsConfig = (newBreeds) => {
        setBreedsConfig(newBreeds);
        localStorage.setItem('ba_breeds_config', JSON.stringify(newBreeds));
    };

    const updateMedCategories = (newCategories) => {
        setMedCategories(newCategories);
        localStorage.setItem('ba_med_categories', JSON.stringify(newCategories));
    };

    const updateSystemParams = (newParams) => {
        setSystemParams(newParams);
        localStorage.setItem('ba_system_params', JSON.stringify(newParams));
    };

    const updateQuarantineProtocols = (newProtocols) => {
        setQuarantineProtocols(newProtocols);
        localStorage.setItem('ba_quarantine_protocols', JSON.stringify(newProtocols));
    };

    // ─── INITIAL LOCAL SEEDS ───
    const initialAnimals = [
        {
            id: 1,
            rfid: 'BA-BULL-101',
            breed: 'Sahiwal',
            entryDate: '2026-04-10',
            entryWeight: 380,
            currentWeight: 420,
            targetWeight: 420,
            purchasePrice: 150000,
            source: 'Ashraf Zia Agro-Complex',
            status: 'Ready',
            pen: 'B-4',
            price: 285000,
            desc: 'Purebred Sahiwal bull with excellent physical structure, deep red coat, and verified teeth age compliance. Raised on organic feeds.',
            images: ['/assets/sahiwal_bull.png']
        },
        {
            id: 2,
            rfid: 'BA-COW-202',
            breed: 'Cholistani',
            entryDate: '2026-04-15',
            entryWeight: 320,
            currentWeight: 360,
            targetWeight: 360,
            purchasePrice: 130000,
            source: 'Ashraf Zia Agro-Complex',
            status: 'Ready',
            pen: 'C-1',
            price: 245000,
            desc: 'Beautiful Cholistani heifer featuring signature spot markings. Active health log, fully vaccinated against FMD.',
            images: ['/assets/cholistani_cow.png']
        },
        {
            id: 3,
            rfid: 'BA-BULL-505',
            breed: 'Sahiwal',
            entryDate: '2026-03-20',
            entryWeight: 500,
            currentWeight: 580,
            targetWeight: 580,
            purchasePrice: 280000,
            source: 'Ashraf Zia Agro-Complex',
            status: 'Ready',
            pen: 'F-2',
            price: 480000,
            desc: 'Heavyweight Sahiwal show bull. Unmatched muscle mass, clean posture, and active veterinary passport. Ideal for family shared booking.',
            images: ['/assets/sahiwal_bull.png']
        },
        {
            id: 4,
            rfid: 'BA-GOAT-303',
            breed: 'Beetal',
            entryDate: '2026-05-01',
            entryWeight: 60,
            currentWeight: 75,
            targetWeight: 75,
            purchasePrice: 65000,
            source: 'Ashraf Zia Agro-Complex',
            status: 'Ready',
            pen: 'G-2',
            price: 95000,
            desc: 'Purebred Rajanpuri Beetal goat with long floppy ears and clean pink nose. Complies with Islamic Qurbani requirements.',
            images: ['/assets/beetal_goat.png']
        },
        {
            id: 5,
            rfid: 'BA-SHP-404',
            breed: 'Kajla',
            entryDate: '2026-05-05',
            entryWeight: 55,
            currentWeight: 65,
            targetWeight: 65,
            purchasePrice: 55000,
            source: 'Ashraf Zia Agro-Complex',
            status: 'Ready',
            pen: 'S-1',
            price: 85000,
            desc: 'Signature Kajla sheep with deep dark circle eye markings. Reared in Faisalabad complex with automated grain rations.',
            images: ['/assets/kajla_sheep.png']
        },
        {
            id: 6,
            rfid: 'BA-GOAT-606',
            breed: 'Teddy',
            entryDate: '2026-05-10',
            entryWeight: 35,
            currentWeight: 45,
            targetWeight: 45,
            purchasePrice: 35000,
            source: 'Ashraf Zia Agro-Complex',
            status: 'Ready',
            pen: 'G-1',
            price: 55000,
            desc: 'Healthy and active compact Teddy goat. Raised on natural grain feeds. Islamic compliance verified.',
            images: ['/assets/teddy_goat.png']
        }
    ];

    const initialWeights = [
        { id: 1, animalId: 1, date: '2026-04-10', weight: 380, adg: 0 },
        { id: 2, animalId: 1, date: '2026-06-10', weight: 420, adg: 0.66 },
        { id: 3, animalId: 2, date: '2026-04-15', weight: 320, adg: 0 },
        { id: 4, animalId: 2, date: '2026-06-15', weight: 360, adg: 0.66 },
        { id: 5, animalId: 3, date: '2026-03-20', weight: 500, adg: 0 },
        { id: 6, animalId: 3, date: '2026-06-20', weight: 580, adg: 0.87 },
        { id: 7, animalId: 4, date: '2026-05-01', weight: 60, adg: 0 },
        { id: 8, animalId: 4, date: '2026-06-01', weight: 75, adg: 0.48 },
        { id: 9, animalId: 5, date: '2026-05-05', weight: 55, adg: 0 },
        { id: 10, animalId: 5, date: '2026-06-05', weight: 65, adg: 0.32 },
        { id: 11, animalId: 6, date: '2026-05-10', weight: 35, adg: 0 },
        { id: 12, animalId: 6, date: '2026-06-10', weight: 45, adg: 0.32 }
    ];

    const initialTreatments = [];

    const initialEvents = [
        { id: 1, animalId: 1, date: '2026-04-10', eventType: 'registered', note: 'Registered — Sahiwal, 380kg, Ready' },
        { id: 2, animalId: 2, date: '2026-04-15', eventType: 'registered', note: 'Registered — Cholistani, 320kg, Ready' },
        { id: 3, animalId: 3, date: '2026-03-20', eventType: 'registered', note: 'Registered — Sahiwal, 500kg, Ready' },
        { id: 4, animalId: 4, date: '2026-05-01', eventType: 'registered', note: 'Registered — Beetal, 60kg, Ready' },
        { id: 5, animalId: 5, date: '2026-05-05', eventType: 'registered', note: 'Registered — Kajla, 55kg, Ready' },
        { id: 6, animalId: 6, date: '2026-05-10', eventType: 'registered', note: 'Registered — Teddy, 35kg, Ready' }
    ];

    // Core state pools loaded first from LocalStorage (animals/weights/treatments/events as cache)
    const [animals, setAnimals] = useState(() => loadStoredData('ba_animals', initialAnimals));
    const [weightLogs, setWeightLogs] = useState(() => loadStoredData('ba_weights', initialWeights));
    const [treatments, setTreatments] = useState(() => loadStoredData('ba_treatments', initialTreatments));
    const [events, setEvents] = useState(() => loadStoredData('ba_events', initialEvents));
    // Orders, enquiries and meatCuts start empty — authoritative source is DB
    const [orders, setOrders] = useState([]);
    const [meatCuts, setMeatCuts] = useState(defaultMeatCuts);
    const [enquiries, setEnquiries] = useState([]);
    const [quotations, setQuotations] = useState(() => loadStoredData('ba_quotations', []));
    const [specSheets, setSpecSheets] = useState(() => loadStoredData('ba_spec_sheets', []));
    // Dated, immutable "what was actually fed" ledger — distinct from feedIngredients
    // (the live, always-current recipe definition below). Editing the recipe never
    // rewrites these historical snapshots.
    const [feedLogs, setFeedLogs] = useState(() => loadStoredData('ba_feed_logs', []));

    // Database load and sync metrics
    const [fetchLoading, setFetchLoading] = useState(true);
    const [dbUnconfigured, setDbUnconfigured] = useState(false);

    // Feed optimized data
    const [feedIngredients, setFeedIngredients] = useState(() => {
        const stored = localStorage.getItem('ba_feed_ingredients');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error("Error parsing ba_feed_ingredients", e);
            }
        }

        // Migrate legacy settings
        const recipe = loadStoredData('ba_feed_recipe', {
            silageDM: 4.5,
            cottonseedDM: 1.5,
            strawDM: 1.0,
            mineralsDM: 0.15
        });
        const prices = loadStoredData('ba_feed_prices', {
            silagePrice: 12.5,
            cottonseedPrice: 95.0,
            strawPrice: 16.0,
            mineralsPrice: 150.0
        });

        return [
            { id: 'silage', name: 'Maize Silage', dmTarget: recipe.silageDM ?? 4.5, price: prices.silagePrice ?? 12.5, moisture: 65, isDefault: true },
            { id: 'cottonseed', name: 'Cottonseed Cake', dmTarget: recipe.cottonseedDM ?? 1.5, price: prices.cottonseedPrice ?? 95.0, moisture: 10, isDefault: true },
            { id: 'straw', name: 'Wheat Straw (Toori)', dmTarget: recipe.strawDM ?? 1.0, price: prices.strawPrice ?? 16.0, moisture: 10, isDefault: true },
            { id: 'minerals', name: 'Limestone / Minerals', dmTarget: recipe.mineralsDM ?? 0.15, price: prices.mineralsPrice ?? 150.0, moisture: 5, isDefault: true }
        ];
    });

    const feedRecipe = {
        silageDM: feedIngredients.find(i => i.id === 'silage')?.dmTarget ?? 4.5,
        cottonseedDM: feedIngredients.find(i => i.id === 'cottonseed')?.dmTarget ?? 1.5,
        strawDM: feedIngredients.find(i => i.id === 'straw')?.dmTarget ?? 1.0,
        mineralsDM: feedIngredients.find(i => i.id === 'minerals')?.dmTarget ?? 0.15
    };
    const feedPrices = {
        silagePrice: feedIngredients.find(i => i.id === 'silage')?.price ?? 12.5,
        cottonseedPrice: feedIngredients.find(i => i.id === 'cottonseed')?.price ?? 95.0,
        strawPrice: feedIngredients.find(i => i.id === 'straw')?.price ?? 16.0,
        mineralsPrice: feedIngredients.find(i => i.id === 'minerals')?.price ?? 150.0
    };

    // localStorage cache sync for animals/weights/treatments/events (portal reads these on init before DB loads)
    useEffect(() => {
        localStorage.setItem('ba_animals', JSON.stringify(animals));
    }, [animals]);

    useEffect(() => {
        localStorage.setItem('ba_weights', JSON.stringify(weightLogs));
    }, [weightLogs]);

    useEffect(() => {
        localStorage.setItem('ba_treatments', JSON.stringify(treatments));
    }, [treatments]);

    useEffect(() => {
        localStorage.setItem('ba_events', JSON.stringify(events));
    }, [events]);

    useEffect(() => {
        localStorage.setItem('ba_feed_ingredients', JSON.stringify(feedIngredients));
    }, [feedIngredients]);

    useEffect(() => {
        localStorage.setItem('ba_feed_logs', JSON.stringify(feedLogs));
    }, [feedLogs]);

    useEffect(() => {
        localStorage.setItem('ba_quotations', JSON.stringify(quotations));
    }, [quotations]);

    useEffect(() => {
        localStorage.setItem('ba_spec_sheets', JSON.stringify(specSheets));
    }, [specSheets]);

    // ─── NEON DB GET SYNC RUNNER ───
    // Re-runs whenever the staff session token changes (login/logout) — without a
    // valid token the server only returns the public-safe subset of the data (no
    // orders/treatments/weight logs/etc), so we need a fresh authenticated fetch
    // right after login rather than waiting for a page reload.
    useEffect(() => {
        const syncState = async () => {
            setFetchLoading(true);
            try {
                const res = await fetch('/api/farm', { headers: authHeaders() });
                const data = await res.json();

                if (data.success) {
                    setAnimals(data.animals);
                    setWeightLogs(data.weightLogs);
                    setTreatments(data.treatments);
                    if (data.events) setEvents(data.events);
                    if (data.feedLogs) setFeedLogs(data.feedLogs);
                    if (data.orders) setOrders(data.orders);
                    if (data.meatCuts) setMeatCuts(data.meatCuts);
                    if (data.enquiries) setEnquiries(data.enquiries);
                    if (data.quotations) setQuotations(data.quotations);
                    if (data.specSheets) setSpecSheets(data.specSheets);
                    if (data.session) {
                        setStaffUser(prev => {
                            if (!prev) return prev;
                            const merged = { ...prev, ...data.session, token: prev.token };
                            localStorage.setItem('ba_staff_user', JSON.stringify(merged));
                            return merged;
                        });
                    }
                    setStaffPermissions(data.staffPermissions || []);
                } else if (data.unconfigured) {
                    setDbUnconfigured(true);
                    console.warn("Neon Database connection string unconfigured. Utilizing offline localStorage backup.");
                }
            } catch (err) {
                console.error("Neon API unreachable, preserving localStorage backup states:", err);
            } finally {
                setFetchLoading(false);
            }
        };
        syncState();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [staffUser?.token]);

    // ─── STATE TRANSACTIONS TRIGGER SYNCS ───

    const addAnimal = async (newAnimal) => {
        const id = animals.length > 0 ? Math.max(...animals.map(a => a.id)) + 1 : 1;

        const matched = breedsConfig.find(b => b.name === newAnimal.breed);
        const defaultTarget = matched ? matched.defaultTargetWeight : 360;

        const animal = {
            id,
            rfid: newAnimal.rfid || String(id).padStart(3, '0'),
            breed: newAnimal.breed || 'Sahiwal',
            entryDate: newAnimal.entryDate || new Date().toISOString().split('T')[0],
            entryWeight: parseFloat(newAnimal.entryWeight) || 120,
            currentWeight: parseFloat(newAnimal.entryWeight) || 120,
            targetWeight: parseFloat(newAnimal.targetWeight) || defaultTarget,
            purchasePrice: parseFloat(newAnimal.purchasePrice) || 150000,
            source: newAnimal.source || 'Local Mandi',
            status: newAnimal.status || 'Quarantined',
            pen: newAnimal.pen || null
        };

        // 1. Sync UI locally immediately for zero-lag response
        setAnimals(prev => [...prev, animal]);
        setEvents(prev => [...prev, { id: Date.now(), animalId: id, date: animal.entryDate, eventType: 'registered', note: `Registered — ${animal.breed}, ${animal.entryWeight}kg, ${animal.status}` }]);

        const weightId = weightLogs.length > 0 ? Math.max(...weightLogs.map(w => w.id)) + 1 : 1;
        const initialLog = {
            id: weightId,
            animalId: id,
            date: animal.entryDate,
            weight: animal.entryWeight,
            adg: 0
        };
        setWeightLogs(prev => [...prev, initialLog]);

        // 2. Queue the database transaction durably (survives offline/refresh/crash)
        persistMutation('ADD_ANIMAL', animal);
    };

    const logWeight = async (animalId, date, weight) => {
        const targetWeight = parseFloat(weight);
        const animalLogs = weightLogs.filter(w => w.animalId === parseInt(animalId))
                                     .sort((a, b) => new Date(a.date) - new Date(b.date));

        let calculatedAdg = 0;
        if (animalLogs.length > 0) {
            const lastLog = animalLogs[animalLogs.length - 1];
            const msDiff = new Date(date) - new Date(lastLog.date);
            const daysElapsed = Math.max(1, Math.round(msDiff / (1000 * 60 * 60 * 24)));
            const weightDiff = targetWeight - lastLog.weight;
            calculatedAdg = parseFloat((weightDiff / daysElapsed).toFixed(2));
        }

        const id = weightLogs.length > 0 ? Math.max(...weightLogs.map(w => w.id)) + 1 : 1;
        const newLog = {
            id,
            animalId: parseInt(animalId),
            date,
            weight: targetWeight,
            adg: calculatedAdg
        };

        // 1. Sync UI locally
        setWeightLogs(prev => [...prev, newLog]);
        setAnimals(prev => prev.map(animal => {
            if (animal.id === parseInt(animalId)) {
                return { ...animal, currentWeight: targetWeight };
            }
            return animal;
        }));

        // 2. Queue database transaction durably
        persistMutation('LOG_WEIGHT', { animalId: parseInt(animalId), date, weight: targetWeight, adg: calculatedAdg });
    };

    const addTreatment = async (animalId, date, type, medicine, dosage, withholding) => {
        const id = treatments.length > 0 ? Math.max(...treatments.map(t => t.id)) + 1 : 1;
        const newTreatment = {
            id,
            animalId: parseInt(animalId),
            date,
            type,
            medicine,
            dosage,
            withholding: parseInt(withholding) || 0
        };

        // 1. Sync UI locally
        setTreatments(prev => [...prev, newTreatment]);

        // 2. Queue database transaction durably
        persistMutation('LOG_TREATMENT', { animalId: parseInt(animalId), date, type, medicine, dosage, withholding: parseInt(withholding) || 0 });
    };

    const transitionAnimalStatus = async (animalId, nextStatus) => {
        const today = new Date().toISOString().split('T')[0];
        // 1. Sync UI locally
        setAnimals(prev => prev.map(animal => {
            if (animal.id === parseInt(animalId)) {
                return { ...animal, status: nextStatus };
            }
            return animal;
        }));
        setEvents(prev => [...prev, { id: Date.now(), animalId: parseInt(animalId), date: today, eventType: 'status_change', note: `→ ${nextStatus}` }]);

        // 2. Queue database transaction durably
        persistMutation('TRANSITION_STATUS', { animalId: parseInt(animalId), status: nextStatus, date: today, note: `→ ${nextStatus}` });
    };

    const deleteAnimal = async (animalId) => {
        // 1. Sync UI locally
        setAnimals(prev => prev.filter(a => a.id !== animalId));
        setWeightLogs(prev => prev.filter(w => w.animalId !== animalId));
        setTreatments(prev => prev.filter(t => t.animalId !== animalId));

        // 2. Queue DB transaction durably
        persistMutation('DELETE_ANIMAL', { animalId });
    };

    const updateAnimal = async (updatedAnimal) => {
        // 1. Sync UI locally
        setAnimals(prev => prev.map(a => a.id === updatedAnimal.id ? { ...a, ...updatedAnimal } : a));

        // 2. Queue DB transaction durably
        persistMutation('UPDATE_ANIMAL', updatedAnimal);
    };

    const deleteWeightLog = async (logId) => {
        // 1. Sync UI locally
        setWeightLogs(prev => prev.filter(w => w.id !== logId));

        // 2. Queue DB transaction durably
        persistMutation('DELETE_WEIGHT_LOG', { logId });
    };

    const deleteTreatment = async (treatmentId) => {
        // 1. Sync UI locally
        setTreatments(prev => prev.filter(t => t.id !== treatmentId));

        // 2. Queue DB transaction durably
        persistMutation('DELETE_TREATMENT', { treatmentId });
    };

    // Unlike most mutations in this file, recordSale is NOT optimistic: the backend
    // enforces the medicine withholding (food-safety) period and can legitimately
    // reject a sale, so we wait for its verdict before touching local state.
    const recordSale = async (animalId, salePrice, buyerName, saleDate) => {
        try {
            const res = await fetch('/api/farm', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    action: 'RECORD_SALE',
                    payload: { animalId: parseInt(animalId), salePrice: parseFloat(salePrice), buyerName, saleDate }
                })
            });
            const data = await res.json().catch(() => ({}));

            if (!data.unconfigured && (!res.ok || data.success === false)) {
                const message = data.error || 'Sale could not be recorded.';
                console.error("recordSale rejected:", message);
                return { success: false, error: message };
            }

            // Server confirmed the sale (or no DB is configured, in which case we run
            // local-only and there's nothing authoritative to check against).
            setAnimals(prev => prev.map(a => a.id === parseInt(animalId)
                ? { ...a, status: 'Sold', salePrice: parseFloat(salePrice), buyerName, saleDate }
                : a
            ));
            setEvents(prev => [...prev, { id: Date.now(), animalId: parseInt(animalId), date: saleDate, eventType: 'sold', note: `Sold to ${buyerName} — PKR ${parseFloat(salePrice).toLocaleString()}` }]);

            return { success: true };
        } catch (err) {
            console.error("DB post failed for recordSale:", err);
            return { success: false, error: 'Network error — sale was not recorded. Please try again.' };
        }
    };

    const recordDeath = async (animalId, deceasedDate, deceasedCause) => {
        // 1. Sync UI locally
        setAnimals(prev => prev.map(a => a.id === parseInt(animalId)
            ? { ...a, status: 'Deceased', deceasedDate, deceasedCause }
            : a
        ));
        setEvents(prev => [...prev, { id: Date.now(), animalId: parseInt(animalId), date: deceasedDate, eventType: 'deceased', note: `Deceased — ${deceasedCause}` }]);

        // 2. Queue database transaction durably
        persistMutation('RECORD_DEATH', { animalId: parseInt(animalId), deceasedDate, deceasedCause });
    };

    const updateTMRPrices = (prices) => {
        setFeedIngredients(prev => prev.map(ing => {
            if (ing.id === 'silage' && prices.silagePrice !== undefined) return { ...ing, price: prices.silagePrice };
            if (ing.id === 'cottonseed' && prices.cottonseedPrice !== undefined) return { ...ing, price: prices.cottonseedPrice };
            if (ing.id === 'straw' && prices.strawPrice !== undefined) return { ...ing, price: prices.strawPrice };
            if (ing.id === 'minerals' && prices.mineralsPrice !== undefined) return { ...ing, price: prices.mineralsPrice };
            return ing;
        }));
    };

    const updateFeedRecipe = (recipe) => {
        setFeedIngredients(prev => prev.map(ing => {
            if (ing.id === 'silage' && recipe.silageDM !== undefined) return { ...ing, dmTarget: recipe.silageDM };
            if (ing.id === 'cottonseed' && recipe.cottonseedDM !== undefined) return { ...ing, dmTarget: recipe.cottonseedDM };
            if (ing.id === 'straw' && recipe.strawDM !== undefined) return { ...ing, dmTarget: recipe.strawDM };
            if (ing.id === 'minerals' && recipe.mineralsDM !== undefined) return { ...ing, dmTarget: recipe.mineralsDM };
            return ing;
        }));
    };

    const updateFeedIngredients = (newIngredients) => {
        setFeedIngredients(newIngredients);
    };

    // Snapshots what was actually fed today (or a chosen date) — ingredients, quantities
    // and cost — as an immutable dated record, separate from editing the live recipe.
    // One record per (date, pen); re-logging the same day/pen overwrites that day only,
    // never earlier days. This is what makes the recipe non-retroactive.
    const logFeed = (entry) => {
        const date = entry.date || new Date().toISOString().split('T')[0];
        const pen = entry.pen || 'ALL';
        const record = {
            id: `${date}__${pen}`,
            date,
            pen,
            animalCount: entry.animalCount || 0,
            ingredients: entry.ingredients || [],
            totalDmKg: entry.totalDmKg || 0,
            totalBatchKg: entry.totalBatchKg || 0,
            totalCost: entry.totalCost || 0,
            costPerAnimal: entry.costPerAnimal || 0,
            notes: entry.notes || ''
        };

        // 1. Sync UI locally immediately (upsert by date+pen)
        setFeedLogs(prev => {
            const exists = prev.some(f => f.date === date && f.pen === pen);
            return exists
                ? prev.map(f => (f.date === date && f.pen === pen) ? { ...f, ...record } : f)
                : [...prev, record];
        });

        // 2. Queue DB transaction durably
        persistMutation('LOG_FEED', record);
    };

    const deleteFeedLog = (date, pen) => {
        setFeedLogs(prev => prev.filter(f => !(f.date === date && f.pen === pen)));
        persistMutation('DELETE_FEED_LOG', { date, pen });
    };

    // Cross-tab real-time sync via Storage API (cart and config only)
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'ba_animals') {
                try {
                    setAnimals(JSON.parse(e.newValue || '[]'));
                } catch (err) {}
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const addOrder = async (order) => {
        // Optimistic update
        setOrders(prev => [...prev, order]);

        // Mark live animals as sold in register and Neon DB
        if (order.items) {
            order.items.forEach(item => {
                const animal = animals.find(a => a.rfid === item.rfid);
                if (animal) {
                    recordSale(animal.id, item.price * item.quantity, order.customerName, order.date);
                }
            });
        }

        // Queue the order insert durably (idempotent server-side via ON CONFLICT DO NOTHING)
        persistMutation('ADD_ORDER', order);
    };

    const updateOrderStatus = async (orderId, nextStatus) => {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: nextStatus } : o));
        persistMutation('UPDATE_ORDER_STATUS', { orderId, status: nextStatus });
    };

    const deleteOrder = async (orderId) => {
        setOrders(prev => prev.filter(o => o.id !== orderId));
        persistMutation('DELETE_ORDER', { orderId });
    };

    const addMeatCut = async (newCut) => {
        const id = newCut.id || newCut.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const cut = { id, ...newCut };
        setMeatCuts(prev => [...prev, cut]);
        persistMutation('ADD_MEAT_CUT', cut);
    };

    const updateMeatCut = async (updatedCut) => {
        setMeatCuts(prev => prev.map(c => c.id === updatedCut.id ? updatedCut : c));
        persistMutation('UPDATE_MEAT_CUT', updatedCut);
    };

    const deleteMeatCut = async (cutId) => {
        setMeatCuts(prev => prev.filter(c => c.id !== cutId));
        persistMutation('DELETE_MEAT_CUT', { cutId });
    };

    const resetSystem = async () => {
        localStorage.removeItem('ba_animals');
        localStorage.removeItem('ba_weights');
        localStorage.removeItem('ba_treatments');

        setAnimals([]);
        setWeightLogs([]);
        setTreatments([]);
        setOrders([]);
        setMeatCuts([]);

        try {
            await fetch('/api/farm', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ action: 'RESET_DATABASE' })
            });
        } catch (err) {
            console.error("DB reset transaction failed:", err);
        }
    };

    const updateEnquiryStatus = async (enquiryId, nextStatus) => {
        setEnquiries(prev => prev.map(e => e.id === enquiryId ? { ...e, status: nextStatus } : e));
        persistMutation('UPDATE_ENQUIRY_STATUS', { enquiryId, status: nextStatus });
    };

    const deleteEnquiry = async (enquiryId) => {
        setEnquiries(prev => prev.filter(e => e.id !== enquiryId));
        persistMutation('DELETE_ENQUIRY', { enquiryId });
    };

    const updateQuotationStatus = async (quoteId, newStatus) => {
        setQuotations(prev => prev.map(q => q.id === quoteId ? { ...q, status: newStatus } : q));
        persistMutation('UPDATE_QUOTATION_STATUS', { quoteId, status: newStatus });
    };

    const deleteQuotation = async (quoteId) => {
        setQuotations(prev => prev.filter(q => q.id !== quoteId));
        persistMutation('DELETE_QUOTATION', { quoteId });
    };

    const duplicateQuotation = async (quote) => {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const newId = `BAQ-${yyyy}${mm}${dd}-${Math.floor(10 + Math.random() * 90)}`;
        
        const duplicated = {
            ...quote,
            id: newId,
            createdAt: today.toISOString().split('T')[0],
            status: 'Draft'
        };

        setQuotations(prev => [duplicated, ...prev]);
        persistMutation('SAVE_QUOTATION', duplicated);
    };

    const deleteSpecSheet = async (refId) => {
        setSpecSheets(prev => prev.filter(s => s.docRef !== refId));
        persistMutation('DELETE_SPEC_SHEET', { refId });
    };

    // Admin-only: grant/restrict a staff member's access to Sales vs Herd Management.
    // Kept as a live (non-queued) call — access-control changes need an immediate
    // confirmation rather than silently sitting in an offline queue.
    const updateStaffPermission = async (email, updates) => {
        const current = staffPermissions.find(p => p.email === email) || { isAdmin: false, accessSales: true, accessHerd: true };
        const next = { ...current, ...updates, email };

        setStaffPermissions(prev => {
            const exists = prev.some(p => p.email === email);
            return exists ? prev.map(p => p.email === email ? next : p) : [...prev, next];
        });

        try {
            const res = await fetch('/api/farm', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    action: 'UPDATE_STAFF_PERMISSIONS',
                    payload: { email, isAdmin: next.isAdmin, accessSales: next.accessSales, accessHerd: next.accessHerd }
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success === false) {
                return { success: false, error: data.error || 'Failed to update permissions.' };
            }
            return { success: true };
        } catch (err) {
            console.error('UPDATE_STAFF_PERMISSIONS failed:', err);
            return { success: false, error: 'Network error — permission change was not saved. Please try again once online.' };
        }
    };

    return (
        <FarmContext.Provider value={{
            animals,
            weightLogs,
            treatments,
            events,
            feedRecipe,
            feedPrices,
            feedIngredients,
            feedLogs,
            logFeed,
            deleteFeedLog,
            fetchLoading,
            dbUnconfigured,
            orders,
            addOrder,
            updateOrderStatus,
            deleteOrder,
            enquiries,
            updateEnquiryStatus,
            deleteEnquiry,
            quotations,
            updateQuotationStatus,
            deleteQuotation,
            duplicateQuotation,
            specSheets,
            deleteSpecSheet,
            meatCuts,
            addMeatCut,
            updateMeatCut,
            deleteMeatCut,
            addAnimal,
            logWeight,
            addTreatment,
            updateTMRPrices,
            updateFeedRecipe,
            updateFeedIngredients,
            transitionAnimalStatus,
            recordSale,
            recordDeath,
            deleteAnimal,
            updateAnimal,
            deleteWeightLog,
            deleteTreatment,
            resetSystem,
            isLoggedIn,
            staffUser,
            handleLoginSuccess,
            handleLogout,
            breedsConfig,
            medCategories,
            systemParams,
            quarantineProtocols,
            updateBreedsConfig,
            updateMedCategories,
            updateSystemParams,
            updateQuarantineProtocols,
            pendingMutations,
            failedMutations,
            isSyncing,
            retryFailedMutation,
            dismissFailedMutation,
            staffPermissions,
            updateStaffPermission
        }}>
            {children}
        </FarmContext.Provider>
    );
};
