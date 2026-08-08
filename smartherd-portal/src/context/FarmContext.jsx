import React, { createContext, useState, useEffect, useRef } from 'react';
import { resolveRation, getWeightDivergence, NoMatchingRationError } from '../lib/rationResolver';
import { todayPKT, todayAsDate, parseDateOnly, daysBetween } from '../utils/dateOnly';
import { buildLots, allocateFifo } from '../utils/fifoStock';

export const FarmContext = createContext();

const loadStoredData = (key, defaultVal) => {
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            return JSON.parse(stored);
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

// Seeded from the BA Farms Master Ration Model (Section 3 — Baseline schedule).
// Ingredient quantities are already as-fed kg/head/day (no DM/moisture conversion
// needed), keyed by feedIngredients id. Live-weight brackets are used to resolve
// a pen's current week from its animals' actual average weight, not just elapsed
// days-on-feed (cycleStartDate is kept only as a secondary/reference field).
const defaultBaselineRationPlan = {
    id: 'baseline',
    name: 'Baseline',
    description: 'BA Farms Master Ration Model — Section 3 baseline weekly schedule (165kg entry → ~265kg exit, 95-day cycle).',
    adgFloor: 1.0,
    isDefault: true,
    weeks: [
        { week: 1, liveWeightMin: 165, liveWeightMax: 170, targetAdg: 0.65, costPerDay: 205, note: 'Adaptation week: Days 1-3 silage + 0.2kg toori only (no grain/urea); Days 4-7 grain ramped to ~60% with urea introduced gradually.', ingredients: { silage: 5.25, maizeGrain: 1.48, glutenFeed: 0.10, straw: 0.20, urea: 0.024, minerals: 0.021 } },
        { week: 2, liveWeightMin: 170, liveWeightMax: 177, targetAdg: 1.03, costPerDay: 291, ingredients: { silage: 5.22, maizeGrain: 2.52, glutenFeed: 0.18, straw: 0.26, urea: 0.041, minerals: 0.035 } },
        { week: 3, liveWeightMin: 177, liveWeightMax: 184, targetAdg: 1.04, costPerDay: 301, ingredients: { silage: 5.42, maizeGrain: 2.62, glutenFeed: 0.19, straw: 0.26, urea: 0.043, minerals: 0.037 } },
        { week: 4, liveWeightMin: 184, liveWeightMax: 191, targetAdg: 1.05, costPerDay: 310, ingredients: { silage: 5.63, maizeGrain: 2.71, glutenFeed: 0.19, straw: 0.27, urea: 0.044, minerals: 0.038 } },
        { week: 5, liveWeightMin: 191, liveWeightMax: 199, targetAdg: 1.06, costPerDay: 320, ingredients: { silage: 5.87, maizeGrain: 2.81, glutenFeed: 0.20, straw: 0.27, urea: 0.046, minerals: 0.039 } },
        { week: 6, liveWeightMin: 199, liveWeightMax: 206, targetAdg: 1.07, costPerDay: 330, ingredients: { silage: 6.12, maizeGrain: 2.91, glutenFeed: 0.20, straw: 0.26, urea: 0.047, minerals: 0.041 } },
        { week: 7, liveWeightMin: 206, liveWeightMax: 214, targetAdg: 1.08, costPerDay: 339, ingredients: { silage: 6.39, maizeGrain: 3.01, glutenFeed: 0.20, straw: 0.25, urea: 0.049, minerals: 0.042 } },
        { week: 8, liveWeightMin: 214, liveWeightMax: 222, targetAdg: 1.09, costPerDay: 349, ingredients: { silage: 6.67, maizeGrain: 3.11, glutenFeed: 0.21, straw: 0.23, urea: 0.050, minerals: 0.043 } },
        { week: 9, liveWeightMin: 222, liveWeightMax: 229, targetAdg: 1.10, costPerDay: 360, ingredients: { silage: 6.98, maizeGrain: 3.21, glutenFeed: 0.21, straw: 0.21, urea: 0.052, minerals: 0.045 } },
        { week: 10, liveWeightMin: 229, liveWeightMax: 237, targetAdg: 1.10, costPerDay: 367, ingredients: { silage: 6.99, maizeGrain: 3.29, glutenFeed: 0.22, straw: 0.27, urea: 0.053, minerals: 0.046 } },
        { week: 11, liveWeightMin: 237, liveWeightMax: 245, targetAdg: 1.11, costPerDay: 378, ingredients: { silage: 7.33, maizeGrain: 3.40, glutenFeed: 0.22, straw: 0.24, urea: 0.055, minerals: 0.047 } },
        { week: 12, liveWeightMin: 245, liveWeightMax: 252, targetAdg: 1.12, costPerDay: 388, ingredients: { silage: 7.68, maizeGrain: 3.50, glutenFeed: 0.21, straw: 0.20, urea: 0.056, minerals: 0.049 } },
        { week: 13, liveWeightMin: 252, liveWeightMax: 260, targetAdg: 1.12, costPerDay: 396, ingredients: { silage: 7.73, maizeGrain: 3.58, glutenFeed: 0.23, straw: 0.25, urea: 0.058, minerals: 0.050 } },
        { week: 14, liveWeightMin: 260, liveWeightMax: 265, targetAdg: 1.13, costPerDay: 406, ingredients: { silage: 8.12, maizeGrain: 3.69, glutenFeed: 0.23, straw: 0.20, urea: 0.059, minerals: 0.051 } }
    ]
};

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
    // Super-admin's live review queue of staged sensitive-field edits/deletes from
    // non-admin staff (populated from GET when the logged-in user is an admin; empty
    // for everyone else). Drives the login-triggered approval popup.
    const [pendingApprovals, setPendingApprovals] = useState([]);
    // A non-admin staff member's own request history (any status) — lets them see
    // whether their sensitive edit/delete request is still pending, was approved, or
    // was rejected (and why).
    const [myRequests, setMyRequests] = useState([]);
    // Super-admin's all-time approval history (any status, up to 500 most recent) —
    // backs the searchable Approvals audit tab in Settings, distinct from the live
    // pendingApprovals queue which only ever holds open requests.
    const [allApprovals, setAllApprovals] = useState([]);

    const handleLoginSuccess = (userSession) => {
        localStorage.setItem('ba_staff_logged_in', 'true');
        localStorage.setItem('ba_staff_user', JSON.stringify(userSession));
        setIsLoggedIn(true);
        setStaffUser(userSession);
        // A fresh token means any mutations stuck on a 401 can now go through. The
        // staffUser?.token-keyed effect below picks up the change and flushes the
        // queue before it re-fetches from the server — don't also kick off a flush
        // here, or the two runs race and the GET can win, overwriting a just-queued
        // edit (e.g. a pen ration assignment) with stale pre-edit server data.
        setSessionExpired(false);
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
    // True when the queue hit a 401 (expired/invalid session token) rather than a real
    // validation/permission rejection. Kept distinct from failedMutations on purpose —
    // those items are still perfectly valid, just blocked on a fresh login, so they must
    // never be offered a "Dismiss" button that could permanently discard real data.
    const [sessionExpired, setSessionExpired] = useState(false);

    const pendingRef = useRef(pendingMutations);
    const staffUserRef = useRef(staffUser);
    // Holds the in-flight flush promise so concurrent callers (e.g. the post-login
    // GET refresh racing the login flush) await the SAME run instead of each kicking
    // off their own pass — that race is what used to let a fresh GET clobber a pen/
    // ration-plan edit that hadn't finished (re-)saving yet after a re-login.
    const flushPromiseRef = useRef(null);

    useEffect(() => { pendingRef.current = pendingMutations; }, [pendingMutations]);
    useEffect(() => { staffUserRef.current = staffUser; }, [staffUser]);

    useEffect(() => {
        localStorage.setItem('ba_pending_mutations', JSON.stringify(pendingMutations));
    }, [pendingMutations]);

    useEffect(() => {
        localStorage.setItem('ba_failed_mutations', JSON.stringify(failedMutations));
    }, [failedMutations]);

    // Active session security heartbeat: verifies token validity & authorization with /api/auth.
    // Immediately evicts users whose session token has expired or whose access was revoked.
    useEffect(() => {
        if (!isLoggedIn || !staffUser?.token) return;

        let isMounted = true;
        const verifyActiveSession = async () => {
            try {
                const res = await fetch('/api/auth', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${staffUser.token}`
                    },
                    body: JSON.stringify({ refresh: true })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    if (isMounted) {
                        console.warn('Session invalidated or access revoked by auth server:', data.error);
                        handleLogout();
                    }
                    return;
                }

                if (data.token && data.user && isMounted) {
                    setStaffUser(prev => {
                        const updated = { ...prev, ...data.user, token: data.token };
                        localStorage.setItem('ba_staff_user', JSON.stringify(updated));
                        return updated;
                    });
                }
            } catch (err) {
                // Ignore transient network drops
            }
        };

        verifyActiveSession();

        const onFocus = () => verifyActiveSession();
        window.addEventListener('focus', onFocus);
        const interval = setInterval(verifyActiveSession, 30000);

        return () => {
            isMounted = false;
            window.removeEventListener('focus', onFocus);
            clearInterval(interval);
        };
    }, [isLoggedIn, staffUser?.token]);

    // Sends one mutation to the server. Shared by the immediate fast-path send in
    // persistMutation and the durable queue flush loop below, so both stay in sync
    // on auth headers / request shape.
    const sendMutationToServer = async (action, payload) => {
        const headers = {
            'Content-Type': 'application/json',
            ...(staffUserRef.current?.token ? { Authorization: `Bearer ${staffUserRef.current.token}` } : {})
        };
        const res = await fetch('/api/farm', {
            method: 'POST',
            headers,
            body: JSON.stringify({ action, payload })
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
    };

    // Cheap re-fetch used after a staged sensitive-field edit/delete request or an
    // approve/reject decision, so the requester's/admin's approval lists reflect the
    // new state immediately instead of waiting for the next login/page load.
    const refreshApprovals = async () => {
        try {
            const res = await fetch('/api/farm', { headers: authHeaders() });
            const data = await res.json().catch(() => ({}));
            if (data.success) {
                setPendingApprovals(data.pendingApprovals || []);
                setMyRequests(data.myRequests || []);
                setAllApprovals(data.allApprovals || []);
            }
        } catch (err) {
            // Best-effort — the lists will catch up on next login/page load anyway.
        }
    };

    const flushQueue = () => {
        if (flushPromiseRef.current) return flushPromiseRef.current;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();

        const run = (async () => {
            setIsSyncing(true);
            try {
                await flushQueueBody();
            } finally {
                setIsSyncing(false);
                flushPromiseRef.current = null;
            }
        })();
        flushPromiseRef.current = run;
        return run;
    };

    const flushQueueBody = async () => {
        while (pendingRef.current.length > 0) {
            const item = pendingRef.current[0];

            let res, data;
            try {
                ({ res, data } = await sendMutationToServer(item.action, item.payload));
            } catch (err) {
                // Offline / network error — stop here so ordering is preserved,
                // the item stays queued and we retry later.
                break;
            }

            if (res.status === 401) {
                // Session token expired/invalid — this mutation is still perfectly
                // valid, it just can't be authenticated right now. Leave it queued
                // (not failed) and stop the flush loop entirely, since every other
                // queued item will hit the same 401 with a stale token.
                setSessionExpired(true);
                break;
            }

            if (!res.ok || data.success === false) {
                // Server rejected it for a real reason (validation/permission/etc).
                // Don't let this block the rest of the queue, but never drop it
                // silently either.
                const failedItem = { ...item, error: data.error || `HTTP ${res.status}`, failedAt: Date.now() };
                setFailedMutations(prev => [...prev, failedItem]);
            } else {
                setSessionExpired(false);
            }

            setPendingMutations(prev => prev.filter(p => p.id !== item.id));
            pendingRef.current = pendingRef.current.filter(p => p.id !== item.id);
        }
    };

    // Send a mutation. If we're online and nothing is already queued ahead of it,
    // send it directly so a normal save resolves in one round trip with no
    // "Pending"/"Syncing" badge flash. Only drop into the durable localStorage
    // queue (and its retry/offline machinery) on a real network failure, or when
    // there's already queued work ahead of it — sending straight through in that
    // case could land out of order relative to what's still waiting to flush.
    const persistMutation = async (action, payload) => {
        const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, action, payload, createdAt: Date.now() };

        if (pendingRef.current.length === 0 && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
            try {
                const { res, data } = await sendMutationToServer(action, payload);

                if (res.status === 401) {
                    // Session token expired/invalid — this mutation is still perfectly
                    // valid, it just can't be authenticated right now. Never drop it:
                    // queue it durably so it flushes automatically once the user logs
                    // back in, same as the durable-queue path below handles it.
                    setSessionExpired(true);
                    setPendingMutations(prev => [...prev, item]);
                    setTimeout(flushQueue, 0);
                } else if (!res.ok || data.success === false) {
                    setFailedMutations(prev => [...prev, { ...item, error: data.error || `HTTP ${res.status}`, failedAt: Date.now() }]);
                } else {
                    setSessionExpired(false);
                }
                return;
            } catch (err) {
                // Network error mid-flight — fall through and queue it durably below.
            }
        }

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

    // ─── SLIDING SESSION ───
    // Best-practice dashboards (Gmail, GitHub, Notion, etc.) don't log an active user
    // out on a fixed timer — the session silently renews itself in the background as
    // long as the person keeps using the app, and only truly expires after a long
    // stretch of real inactivity. We do the same: as long as the current token is
    // still valid, quietly trade it in for a fresh one before it gets anywhere near
    // expiring, so staff are never randomly booted out mid-task.
    const lastRefreshRef = useRef(0);
    const refreshSession = async () => {
        const current = staffUserRef.current;
        if (!current?.token || current.provider === 'dev') return;

        // Throttle — no need to hit the server more than once every few minutes even
        // if focus/visibility events fire in a burst.
        const now = Date.now();
        if (now - lastRefreshRef.current < 5 * 60 * 1000) return;
        lastRefreshRef.current = now;

        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.token}` },
                body: JSON.stringify({ refresh: true })
            });

            if (res.status === 401 || res.status === 403) {
                // The token is genuinely dead (not just "about to expire") — this is a
                // real re-login case, not a network blip.
                setSessionExpired(true);
                return;
            }

            const data = await res.json().catch(() => ({}));
            if (data.success && data.token) {
                setStaffUser(prev => {
                    if (!prev) return prev;
                    const merged = { ...prev, ...data.user, token: data.token };
                    localStorage.setItem('ba_staff_user', JSON.stringify(merged));
                    return merged;
                });
            }
        } catch (err) {
            // Network error — say nothing, the next scheduled attempt will retry.
        }
    };

    useEffect(() => {
        // Ask the browser not to evict this origin's storage under storage pressure /
        // inactivity-based purges (Safari's 7-day script-writable-storage cap, iOS
        // low-disk eviction). Best-effort — unsupported/denied browsers just no-op.
        if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(() => {});
        }

        flushQueue();
        refreshSession();
        window.addEventListener('online', flushQueue);
        // iOS Safari's 'online' event is unreliable on cellular reconnects — also flush
        // whenever the app comes back to the foreground, which is when a field worker
        // actually notices they have signal again. Also a good moment to silently renew
        // the session, since "came back to the app" is exactly when a stale token would
        // otherwise surprise them.
        const onFocus = () => { flushQueue(); refreshSession(); };
        window.addEventListener('focus', onFocus);
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') { flushQueue(); refreshSession(); }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        const interval = setInterval(flushQueue, 20000);
        // Belt-and-braces renewal for long-running tabs that never lose/regain focus.
        const refreshInterval = setInterval(refreshSession, 15 * 60 * 1000);
        return () => {
            window.removeEventListener('online', flushQueue);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            clearInterval(interval);
            clearInterval(refreshInterval);
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
        persistMutation('SAVE_SETTINGS', { key: 'breeds_config', value: newBreeds });
    };

    const updateMedCategories = (newCategories) => {
        setMedCategories(newCategories);
        localStorage.setItem('ba_med_categories', JSON.stringify(newCategories));
        persistMutation('SAVE_SETTINGS', { key: 'med_categories', value: newCategories });
    };

    const updateSystemParams = (newParams) => {
        setSystemParams(newParams);
        localStorage.setItem('ba_system_params', JSON.stringify(newParams));
        persistMutation('SAVE_SETTINGS', { key: 'system_params', value: newParams });
    };

    const updateQuarantineProtocols = (newProtocols) => {
        setQuarantineProtocols(newProtocols);
        localStorage.setItem('ba_quarantine_protocols', JSON.stringify(newProtocols));
        persistMutation('SAVE_SETTINGS', { key: 'quarantine_protocols', value: newProtocols });
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
    // Ration Plans (named weekly schedules) and Pens (plan assignment + cycle start
    // date per pen) — authoritative source is DB, same load pattern as orders/quotations.
    const [rationPlans, setRationPlans] = useState(() => loadStoredData('ba_ration_plans', []));
    const [pens, setPens] = useState(() => loadStoredData('ba_pens', []));

    // New normalized, CSV-imported ration system (RATION_SYSTEM_SPEC.md) — absolute
    // kg/head/day only, no percentages. Coexists with the legacy rationPlans/weeks
    // system above: a pen only uses these once its `planId` (not `rationPlanId`) is set.
    const [rationPlansV2, setRationPlansV2] = useState(() => loadStoredData('ba_ration_plans_v2', []));
    const [rationRows, setRationRows] = useState(() => loadStoredData('ba_ration_rows', []));
    const [rationRowItems, setRationRowItems] = useState(() => loadStoredData('ba_ration_row_items', []));

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

    // Ensure the Master Ration Model's ingredients always exist, even for browsers
    // whose localStorage cache predates this feature — the seeded Baseline Ration Plan
    // references these ids for its per-week as-fed quantities.
    useEffect(() => {
        const masterModelDefaults = [
            { id: 'maizeGrain', name: 'Maize Grain', dmTarget: 2.8, price: 55.0, moisture: 12, isDefault: true },
            { id: 'glutenFeed', name: 'Maize Gluten Feed 30%', dmTarget: 0.2, price: 68.0, moisture: 10, isDefault: true },
            { id: 'urea', name: 'Urea', dmTarget: 0.05, price: 92.0, moisture: 0, isDefault: true }
        ];
        setFeedIngredients(prev => {
            const missing = masterModelDefaults.filter(d => !prev.some(i => i.id === d.id));
            return missing.length ? [...prev, ...missing] : prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    // ─── FEED STOCK / STORE LEDGER ───
    // A physical store ledger, separate from feedIngredients (the ration/TMR recipe
    // definition) and feedLogs (the TMR's computed daily batch). This tracks what
    // actually moves in and out of the feed store: opening stock, dated purchases
    // (qty/rate/supplier), and dated issues to a pen — so closing stock and real
    // consumption cost (at weighted-average purchase rate, not the ration's static
    // price field) can be derived per item and per pen. Device-local only (like
    // feedIngredients above) — there's no server-side action for this yet, so it's
    // cached to localStorage rather than routed through persistMutation.
    // `derivedFromIngredientId` maps a stock item to the feedIngredients/feedLog id it should
    // auto-pull "Issued" quantity from, so a TMR "Log This Feeding" entry (already per-pen,
    // per-date, per-ingredient) doesn't have to be re-typed into this ledger by hand. TMR only
    // has one combined "minerals" ingredient, so both limestone and mineralPack point at it and
    // get split by mineralSplitRatio below.
    const defaultFeedStockItems = [
        { id: 'silage', name: 'Silage', unit: 'kg', category: 'feed', isDefault: true, derivedFromIngredientId: 'silage' },
        { id: 'maizeGrain', name: 'Maize', unit: 'kg', category: 'feed', isDefault: true, derivedFromIngredientId: 'maizeGrain' },
        { id: 'glutenFeed', name: 'Gluten Feed', unit: 'kg', category: 'feed', isDefault: true, derivedFromIngredientId: 'glutenFeed' },
        { id: 'straw', name: 'Toori (Straw)', unit: 'kg', category: 'feed', isDefault: true, derivedFromIngredientId: 'straw' },
        { id: 'urea', name: 'Urea', unit: 'kg', category: 'feed', isDefault: true, derivedFromIngredientId: 'urea' },
        { id: 'limestone', name: 'Limestone', unit: 'kg', category: 'feed', isDefault: true, derivedFromIngredientId: 'minerals' },
        { id: 'mineralPack', name: 'Mineral Pack', unit: 'kg', category: 'feed', isDefault: true, derivedFromIngredientId: 'minerals' }
    ];
    const [feedStockItems, setFeedStockItems] = useState(() => loadStoredData('ba_feed_stock_items', defaultFeedStockItems));

    // Ensures the weight-based ration system's forage-specific ingredients (the Wanda
    // premix and Chari green fodder) exist even for browsers whose localStorage cache
    // predates this feature — mirrors the masterModelDefaults backfill above. Silage,
    // Toori and Khal already exist under their prior ids ('silage', 'straw', 'cottonseed').
    useEffect(() => {
        const weightRationDefaults = [
            { id: 'wanda', name: 'Wanda', dmTarget: 0, price: 72.47, moisture: 0, isDefault: true },
            { id: 'chari', name: 'Chari (Green Fodder)', dmTarget: 0, price: 0, moisture: 80, isDefault: true }
        ];
        setFeedIngredients(prev => {
            const missing = weightRationDefaults.filter(d => !prev.some(i => i.id === d.id));
            return missing.length ? [...prev, ...missing] : prev;
        });
        setFeedStockItems(prev => {
            const missing = weightRationDefaults.filter(d => !prev.some(i => i.id === d.id));
            if (missing.length === 0) return prev;
            return [...prev, ...missing.map(d => ({ id: d.id, name: d.name, unit: 'kg', category: 'feed', isDefault: true, derivedFromIngredientId: d.id }))];
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Baseline qty/value per item as of whenever this ledger was first set up — everything
    // after that is reconstructed purely from dated purchases/issues below.
    const [feedOpeningStock, setFeedOpeningStock] = useState(() => loadStoredData('ba_feed_opening_stock', {}));
    const [feedPurchases, setFeedPurchases] = useState(() => loadStoredData('ba_feed_purchases', []));
    // Manual/exception issues only (spoilage, samples, sales) — routine pen feeding is
    // auto-derived from feedLogs in getCombinedFeedIssues() below.
    const [feedStockIssues, setFeedStockIssues] = useState(() => loadStoredData('ba_feed_stock_issues', []));
    // Share of the combined TMR "minerals" line attributed to Limestone vs Mineral Pack
    // (must sum to 1) — adjustable since the actual product mix varies by farm.
    const [mineralSplitRatio, setMineralSplitRatioState] = useState(() => loadStoredData('ba_mineral_split_ratio', 0.7));
    const setMineralSplitRatio = (newRatio) => {
        setMineralSplitRatioState(newRatio);
        persistMutation('SAVE_SETTINGS', { key: 'mineral_split_ratio', value: newRatio });
    };

    // Backfill derivedFromIngredientId onto any ledger saved to localStorage before this
    // auto-sync mapping existed, so existing farms don't lose the feature silently.
    useEffect(() => {
        const derivedMap = {
            silage: 'silage', maizeGrain: 'maizeGrain', glutenFeed: 'glutenFeed',
            straw: 'straw', urea: 'urea', limestone: 'minerals', mineralPack: 'minerals'
        };
        setFeedStockItems(prev => {
            let changed = false;
            const next = prev.map(item => {
                if (item.derivedFromIngredientId === undefined && derivedMap[item.id]) {
                    changed = true;
                    return { ...item, derivedFromIngredientId: derivedMap[item.id] };
                }
                return item;
            });
            return changed ? next : prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Any feed stock item that's its own canonical ingredient (i.e. not a split component
    // like limestone/mineralPack, which both share the combined "minerals" ingredient id)
    // but has no matching feedIngredients entry gets one auto-created here. This covers
    // stock items that were added before ration ingredients were required to be paired
    // (or added directly to the ledger some other way) — without this, they're real,
    // purchasable stock but silently invisible in the Ration Plans "Add Ingredient" list,
    // since that list is only ever built from feedIngredients.
    useEffect(() => {
        const missing = feedStockItems
            .filter(item => item.derivedFromIngredientId && item.derivedFromIngredientId === item.id)
            .filter(item => !feedIngredients.some(i => i.id === item.id));
        if (missing.length === 0) return;
        setFeedIngredients(prev => {
            const stillMissing = missing.filter(item => !prev.some(i => i.id === item.id));
            if (stillMissing.length === 0) return prev;
            const next = [...prev, ...stillMissing.map(item => ({ id: item.id, name: item.name, dmTarget: 0, price: 0, isDefault: false }))];
            persistMutation('SAVE_SETTINGS', { key: 'feed_ingredients', value: next });
            return next;
        });
    }, [feedStockItems, feedIngredients]);

    const updateFeedStockItems = (newItems) => {
        setFeedStockItems(newItems);
        persistMutation('SAVE_SETTINGS', { key: 'feed_stock_items', value: newItems });
    };

    const setItemOpeningStock = (itemId, qty, value) => {
        setFeedOpeningStock(prev => {
            const next = { ...prev, [itemId]: { qty: parseFloat(qty) || 0, value: parseFloat(value) || 0 } };
            persistMutation('SAVE_SETTINGS', { key: 'feed_opening_stock', value: next });
            return next;
        });
    };

    const addFeedPurchase = async (purchase) => {
        const record = {
            id: purchase.id || `fp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            itemId: purchase.itemId,
            date: purchase.date || todayPKT(),
            quantity: parseFloat(purchase.quantity) || 0,
            rate: parseFloat(purchase.rate) || 0,
            supplier: purchase.supplier || '',
            notes: purchase.notes || ''
        };
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('ADD_FEED_PURCHASE', record);
        }
        setFeedPurchases(prev => [...prev, record]);
        persistMutation('ADD_FEED_PURCHASE', record);
        return record;
    };

    const handleNonAdminDelete = async (action, payload) => {
        try {
            const { res, data } = await sendMutationToServer(action, payload);
            if (!res.ok || data.success === false) {
                alert(data.error || 'Delete request could not be submitted.');
                return { success: false, error: data.error || 'Delete request could not be submitted.' };
            }
            refreshApprovals();
            alert('Deletion request submitted for Super Admin approval.');
            return { success: true, pending: true };
        } catch (err) {
            console.error(`${action} (pending) failed:`, err);
            alert('Network error — deletion request was not submitted. Please try again.');
            return { success: false, error: 'Network error — request was not submitted.' };
        }
    };

    const deleteFeedPurchase = async (id) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_FEED_PURCHASE', { id });
        }
        setFeedPurchases(prev => prev.filter(p => p.id !== id));
        persistMutation('DELETE_FEED_PURCHASE', { id });
        return { success: true };
    };

    const addFeedStockIssue = (issue) => {
        const record = {
            id: `fi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            itemId: issue.itemId,
            date: issue.date || todayPKT(),
            pen: issue.pen || 'ALL',
            quantity: parseFloat(issue.quantity) || 0,
            lotId: issue.lotId || null,
            notes: issue.notes || ''
        };
        setFeedStockIssues(prev => [...prev, record]);
        persistMutation('ADD_FEED_STOCK_ISSUE', record);
        return record;
    };

    const deleteFeedStockIssue = async (id) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_FEED_STOCK_ISSUE', { id });
        }
        setFeedStockIssues(prev => prev.filter(i => i.id !== id));
        persistMutation('DELETE_FEED_STOCK_ISSUE', { id });
        return { success: true };
    };

    // Merges auto-derived issues (from every "Log This Feeding" record in TMR — same
    // per-pen, per-date, per-ingredient wetBatch quantities already fed) with manually
    // entered exception issues (spoilage, samples, sales), so the store ledger never
    // needs the same feeding event typed in twice. Each row is tagged with its source.
    const getCombinedFeedIssues = () => {
        const autoIssues = [];
        feedLogs.forEach(log => {
            (log.ingredients || []).forEach(ing => {
                feedStockItems.forEach(item => {
                    if (!item.derivedFromIngredientId || item.derivedFromIngredientId !== ing.id) return;
                    const share = item.id === 'limestone' ? mineralSplitRatio
                        : item.id === 'mineralPack' ? (1 - mineralSplitRatio)
                        : 1;
                    const quantity = (ing.wetBatch || 0) * share;
                    if (quantity > 0) {
                        // plannedQtyKg is per-head and always present on ingredients logged after
                        // the diet-differed feature shipped (0 for anything not in the plan at
                        // all) — compare against dmTarget (also per-head) to say exactly how this
                        // item's issue diverged from the Ration Plan, not just that "something" did.
                        const planned = ing.plannedQtyKg;
                        const actual = ing.dmTarget;
                        const differed = planned !== undefined && Math.abs((actual || 0) - planned) > 0.0005;
                        const itemNote = !differed ? 'Auto-synced from TMR feed log'
                            : planned === 0
                                ? 'Auto-synced from TMR feed log — added, not in Ration Plan'
                                : `Auto-synced from TMR feed log — diet differed from plan (planned ${planned.toFixed(2)}kg/head, fed ${(actual || 0).toFixed(2)}kg/head)`;
                        autoIssues.push({
                            id: `auto__${log.date}__${log.pen}__${item.id}`,
                            itemId: item.id,
                            date: log.date,
                            pen: log.pen,
                            quantity,
                            notes: itemNote,
                            dietDiffered: differed,
                            source: 'auto'
                        });
                    }
                });
            });
        });
        const manualIssues = feedStockIssues.map(i => ({ ...i, source: 'manual' }));
        return [...autoIssues, ...manualIssues];
    };

    // Single-pass FIFO valuation across every stock item: each item's opening balance +
    // purchases are tracked as separate dated "lots" (see utils/fifoStock.js), and every
    // combined issue (auto-synced from TMR feed logs + manual exceptions, in date order)
    // is drawn from the oldest lot with stock left — honoring a manual issue's pinned
    // lotId (from a lot picker) first, with any shortfall spilling FIFO into the next lot.
    // This is what lets closing stock and consumption cost reflect what a specific batch
    // of feed actually cost, instead of one all-time blended average across every
    // purchase ever made (which let a premix batch's cost swing on rates from stock that
    // had nothing to do with it, and made "which invoice did this cost come from" unanswerable).
    const getFeedStockValuationMap = () => {
        const combinedIssues = getCombinedFeedIssues();
        const issuesByItem = {};
        combinedIssues.forEach(i => {
            (issuesByItem[i.itemId] = issuesByItem[i.itemId] || []).push(i);
        });

        const issueCosts = {};
        const byItem = {};
        feedStockItems.forEach(item => {
            const opening = feedOpeningStock[item.id] || { qty: 0, value: 0 };
            const lots = buildLots(item.id, opening, feedPurchases);
            const issues = (issuesByItem[item.id] || [])
                .slice()
                .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)));

            let consumptionValue = 0;
            let issuedQty = 0;
            issues.forEach(issue => {
                const { cost, rate } = allocateFifo(lots, issue.quantity, issue.lotId);
                issueCosts[issue.id] = { cost, rate };
                consumptionValue += cost;
                issuedQty += issue.quantity;
            });

            const closingQty = lots.reduce((sum, l) => sum + l.remaining, 0);
            const closingValue = lots.reduce((sum, l) => sum + l.remaining * l.rate, 0);
            const avgRate = closingQty > 0.0001 ? closingValue / closingQty : (lots[lots.length - 1]?.rate || 0);

            byItem[item.id] = {
                lots, closingQty, closingValue, avgRate, consumptionValue, issuedQty,
                openingQty: opening.qty, openingValue: opening.value
            };
        });

        return { byItem, issueCosts };
    };

    // Per-item running ledger: opening + purchases − issues = closing, priced at FIFO
    // (see getFeedStockValuationMap above) — avgRate here is the weighted-average rate
    // of only the stock still physically in the store (closingValue / closingQty), not
    // a stale all-time blend that never forgets stock that's long gone.
    const getFeedStockLedger = () => {
        const { byItem } = getFeedStockValuationMap();
        return feedStockItems.map(item => {
            const v = byItem[item.id];
            const purchases = feedPurchases.filter(p => p.itemId === item.id);
            const purchasedQty = purchases.reduce((sum, p) => sum + p.quantity, 0);
            const purchasedValue = purchases.reduce((sum, p) => sum + (p.quantity * p.rate), 0);

            return {
                item,
                openingQty: v.openingQty,
                openingValue: v.openingValue,
                purchasedQty,
                purchasedValue,
                issuedQty: v.issuedQty,
                avgRate: v.avgRate,
                consumptionValue: v.consumptionValue,
                closingQty: v.closingQty,
                closingValue: v.closingValue
            };
        });
    };

    // The FIFO lots (each purchase + opening balance, with remaining qty after every
    // issue drawn against it) for one item — what a lot-picker dropdown (premix batch /
    // manual issue) and the Purchase History "remaining" column are built from.
    const getFeedStockLots = (itemId) => getFeedStockValuationMap().byItem[itemId]?.lots || [];

    // Per-issue FIFO cost (id -> { cost, rate }), for pricing "Actual Feed Cost by Pen"
    // and total consumption at what that specific issue actually drew from stock,
    // instead of one blended item-wide rate.
    const getFeedStockIssueCosts = () => getFeedStockValuationMap().issueCosts;

    // Live weighted-average price for a ration ingredient, sourced straight from the stock
    // ledger instead of a manually-typed number — so Ration Plans / TMR costing always reflect
    // what was actually paid for feed still sitting in store. Handles the "minerals" case where
    // one ingredient's consumption is split across two stock items (see mineralSplitRatio).
    // Returns null when the ingredient has no matching stock item at all (not stock-tracked).
    const getIngredientStockPrice = (ingredientId) => {
        const ledger = getFeedStockLedger();
        const linked = feedStockItems.filter(item => item.id === ingredientId || item.derivedFromIngredientId === ingredientId);
        const fallbackPrice = feedIngredients.find(i => i.id === ingredientId)?.price || 0;
        if (linked.length === 0) return fallbackPrice > 0 ? fallbackPrice : null;
        let rate = 0;
        if (linked.length === 1) {
            rate = ledger.find(l => l.item.id === linked[0].id)?.avgRate || 0;
        } else {
            rate = linked.reduce((sum, item) => {
                const itemRate = ledger.find(l => l.item.id === item.id)?.avgRate || 0;
                const share = item.id === 'limestone' ? mineralSplitRatio : item.id === 'mineralPack' ? (1 - mineralSplitRatio) : (1 / linked.length);
                return sum + itemRate * share;
            }, 0);
        }
        return rate > 0 ? rate : (fallbackPrice > 0 ? fallbackPrice : 0);
    };

    // Returns current available physical closing stock quantity (in kg) for an ingredient.
    // Sourced straight from the stock ledger. Returns null if not stock-tracked.
    const getIngredientStockQty = (ingredientId) => {
        const ledger = getFeedStockLedger();
        const linked = feedStockItems.filter(item => item.id === ingredientId || item.derivedFromIngredientId === ingredientId);
        if (linked.length === 0) return null;
        return linked.reduce((sum, item) => {
            const closing = ledger.find(l => l.item.id === item.id)?.closingQty || 0;
            return sum + Math.max(0, closing);
        }, 0);
    };

    // Creates a new feedStockItems entry — the single "add item" path shared by the Stock
    // Ledger and Purchases forms, so anything the farm buys (feed, medicine, or anything
    // else animal-related) is backed by real trackable stock. Only 'feed' category items
    // also get a paired feedIngredients entry, since only those are meant to be selectable
    // in a TMR/ration recipe — medicine and other supplies are purchased/issued here but
    // never fed as part of a ration.
    const addStockTrackedIngredient = (name, category = 'feed', unit = 'kg') => {
        const trimmed = (name || '').trim();
        if (!trimmed) return null;
        const id = 'item_' + Date.now();
        const item = { id, name: trimmed, unit: unit || 'kg', category, isDefault: false };
        if (category === 'feed') {
            item.derivedFromIngredientId = id;
            updateFeedIngredients([...feedIngredients, { id, name: trimmed, dmTarget: 0, price: 0, isDefault: false }]);
        }
        updateFeedStockItems([...feedStockItems, item]);
        return id;
    };

    // ─── PREMIX PRODUCTION (e.g. "Wanda") ───
    // Some farms don't feed raw materials straight into the TMR — they first blend a chosen
    // subset of feedStockItems into a house premix, bag it, and feed the premix itself day
    // to day instead of mixing fresh. A premix type is just another feedStockItems +
    // feedIngredients entry (so it slots into the store ledger and ration recipe exactly like
    // Silage or Maize, with no special-casing anywhere else) plus two things nothing else has:
    // a formula (which raw materials, and how many kg of each per kg of premix produced) and a
    // dated batch log that converts raw material stock into premix stock — deducting the
    // formula's raw materials via addFeedStockIssue (pen 'PRODUCTION') and crediting the
    // premix's own stock via addFeedPurchase (rate = that batch's rolled-up material cost).
    // Reusing those two existing functions means getFeedStockLedger needs no changes at all.
    // Any number of differently-named premixes can be defined (not just one hardcoded "Wanda").
    const [premixTypes, setPremixTypes] = useState(() => loadStoredData('ba_premix_types', []));
    const [premixFormulas, setPremixFormulas] = useState(() => loadStoredData('ba_premix_formulas', {}));
    const [premixBatches, setPremixBatches] = useState(() => loadStoredData('ba_premix_batches', []));

    const addPremixType = (name) => {
        const trimmed = (name || '').trim();
        if (!trimmed) return null;
        const id = 'premix_' + Date.now();
        setPremixTypes(prev => {
            const next = [...prev, { id, name: trimmed }];
            persistMutation('SAVE_SETTINGS', { key: 'premix_types', value: next });
            return next;
        });
        setPremixFormulas(prev => {
            const next = { ...prev, [id]: [] };
            persistMutation('SAVE_SETTINGS', { key: 'premix_formulas', value: next });
            return next;
        });
        // derivedFromIngredientId points at itself: once Wanda-style premix is fed as a TMR
        // ingredient, "Log This Feeding" quantities auto-sync to this stock item's Issued
        // column exactly like every other ingredient (see getCombinedFeedIssues above).
        updateFeedStockItems([...feedStockItems, { id, name: trimmed, unit: 'kg', isDefault: false, isPremix: true, derivedFromIngredientId: id }]);
        updateFeedIngredients([...feedIngredients, { id, name: trimmed, dmTarget: 0, price: 0, isDefault: false, isPremix: true }]);
        return id;
    };

    const deletePremixType = (id) => {
        setPremixTypes(prev => {
            const next = prev.filter(p => p.id !== id);
            persistMutation('SAVE_SETTINGS', { key: 'premix_types', value: next });
            return next;
        });
        setPremixFormulas(prev => {
            const next = { ...prev };
            delete next[id];
            persistMutation('SAVE_SETTINGS', { key: 'premix_formulas', value: next });
            return next;
        });
        updateFeedStockItems(feedStockItems.filter(i => i.id !== id));
        updateFeedIngredients(feedIngredients.filter(i => i.id !== id));
    };

    // rows: [{ stockItemId, qtyPerKg }] — kg of that raw material needed per 1kg of premix
    // produced. Any feedStockItems id can be added here freely, in any ratio.
    const updatePremixFormula = (premixTypeId, rows) => {
        setPremixFormulas(prev => {
            const next = { ...prev, [premixTypeId]: rows };
            persistMutation('SAVE_SETTINGS', { key: 'premix_formulas', value: next });
            return next;
        });
    };

    // Converts raw materials sitting in the store into a batch of premix. totalKg is the
    // authoritative quantity produced — bagWeight/bagCount are optional, free-form (any
    // weight) fields kept only for display/reference on the batch history, since farms don't
    // necessarily use a fixed bag size.
    const addPremixBatch = (batch) => {
        const premixTypeId = batch.premixTypeId;
        const premixType = premixTypes.find(p => p.id === premixTypeId);
        const totalKg = parseFloat(batch.totalKg) || 0;
        if (!premixType || totalKg <= 0) return null;

        const formula = premixFormulas[premixTypeId] || [];
        // { stockItemId: lotId } — an explicit lot chosen for that raw material via the
        // "Log a Batch" lot picker (only offered when the item has more than one lot with
        // stock left); anything not in here just draws FIFO. Snapshotting every item's lots
        // once up front (rather than re-deriving per row) keeps two raw materials that
        // happen to share an item from stepping on each other's `.remaining` mid-batch.
        const lotOverrides = batch.lotOverrides || {};
        const { byItem } = getFeedStockValuationMap();

        const consumed = formula
            .map(row => {
                const quantity = totalKg * (parseFloat(row.qtyPerKg) || 0);
                if (quantity <= 0) return null;
                const lots = (byItem[row.stockItemId]?.lots || []).map(l => ({ ...l }));
                const { cost, rate } = allocateFifo(lots, quantity, lotOverrides[row.stockItemId] || null);
                return { stockItemId: row.stockItemId, quantity, rate, cost, lotId: lotOverrides[row.stockItemId] || null };
            })
            .filter(Boolean);

        const totalMaterialCost = consumed.reduce((sum, c) => sum + c.cost, 0);
        const costPerKg = totalMaterialCost / totalKg;
        const date = batch.date || todayPKT();
        const bagWeight = parseFloat(batch.bagWeight) || 0;
        const bagCount = parseFloat(batch.bagCount) || 0;

        const issueIds = consumed.map(c => addFeedStockIssue({
            date, itemId: c.stockItemId, pen: 'PRODUCTION', quantity: c.quantity, lotId: c.lotId,
            notes: `Used to produce ${totalKg.toFixed(2)} kg of ${premixType.name}`
        }).id);

        const purchaseRec = addFeedPurchase({
            date, itemId: premixTypeId, quantity: totalKg, rate: costPerKg,
            supplier: 'In-house production',
            notes: batch.notes || `Batch of ${premixType.name} from ${consumed.length} raw material(s)`
        });

        // Keep this premix's ration/reference price honest — it should reflect what it
        // actually cost to make from raw materials, not a manually-typed guess.
        updateFeedIngredients(feedIngredients.map(ing => ing.id === premixTypeId ? { ...ing, price: costPerKg } : ing));

        const record = {
            id: `pb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            premixTypeId,
            premixTypeName: premixType.name,
            date, totalKg, bagWeight, bagCount, costPerKg,
            consumed, purchaseId: purchaseRec.id, issueIds,
            notes: batch.notes || ''
        };
        setPremixBatches(prev => {
            const next = [...prev, record];
            persistMutation('SAVE_SETTINGS', { key: 'premix_batches', value: next });
            return next;
        });
        return record;
    };

    // Reverses a batch entirely — undoes the raw-material deductions and the premix stock
    // credit it created — then removes the batch record itself.
    const deletePremixBatch = (id) => {
        const batch = premixBatches.find(b => b.id === id);
        if (!batch) return;
        (batch.issueIds || []).forEach(issueId => deleteFeedStockIssue(issueId));
        if (batch.purchaseId) deleteFeedPurchase(batch.purchaseId);
        setPremixBatches(prev => {
            const next = prev.filter(b => b.id !== id);
            persistMutation('SAVE_SETTINGS', { key: 'premix_batches', value: next });
            return next;
        });
    };

    // localStorage cache sync for animals/weights/treatments/events (portal reads these on
    // init before DB loads). These are just a read-on-init display cache, not the source of
    // truth (that's the DB + the durable pending-mutation queue, which persists itself
    // synchronously and separately) — so it's safe to debounce these writes instead of
    // re-serializing the whole array on every single change. Without this, ticking off
    // several quarantine checklist items back-to-back re-stringifies the entire
    // `treatments` array on every tick, which gets slower as history grows.
    const cacheWriteTimers = useRef({});
    const debouncedCacheWrite = (key, value) => {
        const timers = cacheWriteTimers.current;
        clearTimeout(timers[key]?.timer);
        const write = () => localStorage.setItem(key, JSON.stringify(value));
        timers[key] = { timer: setTimeout(write, 400), write };
    };

    useEffect(() => {
        const flushAll = () => {
            Object.values(cacheWriteTimers.current).forEach(t => { clearTimeout(t.timer); t.write(); });
        };
        window.addEventListener('beforeunload', flushAll);
        window.addEventListener('pagehide', flushAll);
        return () => {
            window.removeEventListener('beforeunload', flushAll);
            window.removeEventListener('pagehide', flushAll);
        };
    }, []);

    useEffect(() => {
        debouncedCacheWrite('ba_animals', animals);
    }, [animals]);

    useEffect(() => {
        debouncedCacheWrite('ba_weights', weightLogs);
    }, [weightLogs]);

    useEffect(() => {
        debouncedCacheWrite('ba_treatments', treatments);
    }, [treatments]);

    useEffect(() => {
        debouncedCacheWrite('ba_events', events);
    }, [events]);

    useEffect(() => {
        debouncedCacheWrite('ba_feed_ingredients', feedIngredients);
    }, [feedIngredients]);

    useEffect(() => {
        debouncedCacheWrite('ba_feed_stock_items', feedStockItems);
    }, [feedStockItems]);

    useEffect(() => {
        debouncedCacheWrite('ba_feed_opening_stock', feedOpeningStock);
    }, [feedOpeningStock]);

    useEffect(() => {
        debouncedCacheWrite('ba_feed_purchases', feedPurchases);
    }, [feedPurchases]);

    useEffect(() => {
        debouncedCacheWrite('ba_feed_stock_issues', feedStockIssues);
    }, [feedStockIssues]);

    useEffect(() => {
        debouncedCacheWrite('ba_premix_types', premixTypes);
    }, [premixTypes]);

    useEffect(() => {
        debouncedCacheWrite('ba_premix_formulas', premixFormulas);
    }, [premixFormulas]);

    useEffect(() => {
        debouncedCacheWrite('ba_premix_batches', premixBatches);
    }, [premixBatches]);

    useEffect(() => {
        debouncedCacheWrite('ba_mineral_split_ratio', mineralSplitRatio);
    }, [mineralSplitRatio]);

    useEffect(() => {
        debouncedCacheWrite('ba_feed_logs', feedLogs);
    }, [feedLogs]);

    useEffect(() => {
        debouncedCacheWrite('ba_ration_plans', rationPlans);
    }, [rationPlans]);

    useEffect(() => {
        debouncedCacheWrite('ba_pens', pens);
    }, [pens]);

    useEffect(() => {
        debouncedCacheWrite('ba_ration_plans_v2', rationPlansV2);
    }, [rationPlansV2]);

    useEffect(() => {
        debouncedCacheWrite('ba_ration_rows', rationRows);
    }, [rationRows]);

    useEffect(() => {
        debouncedCacheWrite('ba_ration_row_items', rationRowItems);
    }, [rationRowItems]);

    useEffect(() => {
        debouncedCacheWrite('ba_quotations', quotations);
    }, [quotations]);

    useEffect(() => {
        debouncedCacheWrite('ba_spec_sheets', specSheets);
    }, [specSheets]);

    // ─── NEON DB GET SYNC RUNNER ───
    // Re-runs whenever the staff session token changes (login/logout) — without a
    // valid token the server only returns the public-safe subset of the data (no
    // orders/treatments/weight logs/etc), so we need a fresh authenticated fetch
    // right after login rather than waiting for a page reload.
    useEffect(() => {
        const syncState = async () => {
            // Replay any locally-queued writes (made while offline or mid-session-expiry)
            // with the current token BEFORE pulling the "authoritative" snapshot below.
            // Otherwise this GET can race the queued POST and win, overwriting a just-made
            // edit (e.g. a pen ration assignment) with stale pre-edit server data — which is
            // what made changes look like they "disappeared" right after logging back in.
            await flushQueue();

            setFetchLoading(true);
            try {
                const res = await fetch('/api/farm', { headers: authHeaders() });
                const data = await res.json();

                if (data.success) {
                    setAnimals(data.animals);
                    if (data.meatCuts) setMeatCuts(data.meatCuts);

                    // Weights/treatments/events/feed logs/ration plans/pens are herd-access
                    // gated on the server: an expired or invalid session doesn't get a 401
                    // here, it just gets back `[]` for all of these while `success` stays
                    // true. Only trust this response as the authoritative full dataset when
                    // the session actually still has herd access — otherwise a stale/expired
                    // token would silently wipe out unsynced local ration plans, pens, etc.
                    const hasHerdAccess = !!(data.session && data.session.accessHerd);
                    if (hasHerdAccess) {
                        setWeightLogs(data.weightLogs);
                        setTreatments(data.treatments);
                        if (data.events) setEvents(data.events);
                        if (data.feedLogs) setFeedLogs(data.feedLogs);
                        if (data.rationPlans) setRationPlans(data.rationPlans);
                        if (data.pens) setPens(data.pens);
                        if (data.rationPlansV2) setRationPlansV2(data.rationPlansV2);
                        if (data.rationRows) setRationRows(data.rationRows);
                        if (data.rationRowItems) setRationRowItems(data.rationRowItems);
                        // First-ever load with no Ration Plans defined yet: seed the Master
                        // Ration Model's Baseline schedule so admins have something to assign
                        // to a pen immediately instead of starting from a blank slate.
                        if (data.rationPlans && data.rationPlans.length === 0) {
                            setRationPlans([defaultBaselineRationPlan]);
                            persistMutation('SAVE_RATION_PLAN', defaultBaselineRationPlan);
                        }

                        // Server-persisted admin settings (breed roster, med categories, system
                        // params, quarantine protocols, TMR recipe/prices, Feed Stock config) —
                        // only trust these once the server has at least one saved, so a
                        // brand-new/never-configured DB doesn't stomp the local defaults.
                        if (data.settings) {
                            const s = data.settings;
                            if (s.breeds_config) setBreedsConfig(s.breeds_config);
                            if (s.med_categories) setMedCategories(s.med_categories);
                            if (s.system_params) setSystemParams(s.system_params);
                            if (s.quarantine_protocols) setQuarantineProtocols(s.quarantine_protocols);
                            if (s.feed_ingredients) setFeedIngredients(s.feed_ingredients);
                            if (s.feed_stock_items) setFeedStockItems(s.feed_stock_items);
                            if (s.feed_opening_stock) setFeedOpeningStock(s.feed_opening_stock);
                            if (s.mineral_split_ratio !== undefined) setMineralSplitRatioState(s.mineral_split_ratio);
                            if (s.premix_types) setPremixTypes(s.premix_types);
                            if (s.premix_formulas) setPremixFormulas(s.premix_formulas);
                            if (s.premix_batches) setPremixBatches(s.premix_batches);
                        }
                        if (data.feedPurchases) setFeedPurchases(data.feedPurchases);
                        if (data.feedStockIssues) setFeedStockIssues(data.feedStockIssues);
                    }

                    const hasSalesAccess = !!(data.session && data.session.accessSales);
                    if (hasSalesAccess) {
                        if (data.orders) setOrders(data.orders);
                        if (data.enquiries) setEnquiries(data.enquiries);
                        if (data.quotations) setQuotations(data.quotations);
                        if (data.specSheets) setSpecSheets(data.specSheets);
                    }

                    if (data.session) {
                        setStaffUser(prev => {
                            if (!prev) return prev;
                            const merged = { ...prev, ...data.session, token: prev.token };
                            localStorage.setItem('ba_staff_user', JSON.stringify(merged));
                            return merged;
                        });
                    }
                    setStaffPermissions(data.staffPermissions || []);
                    setPendingApprovals(data.pendingApprovals || []);
                    setMyRequests(data.myRequests || []);
                    setAllApprovals(data.allApprovals || []);
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
            entryDate: newAnimal.entryDate || todayPKT(),
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
                                     .sort((a, b) => daysBetween(a.date, b.date));

        let calculatedAdg = 0;
        if (animalLogs.length > 0) {
            const lastLog = animalLogs[animalLogs.length - 1];
            const daysElapsed = Math.max(1, daysBetween(date, lastLog.date));
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

    // Recomputes the entire ADG chain for one animal after a weight or date edit.
    // Editing a log in place can shift its position in the chronological sequence
    // (e.g. moving its date earlier/later than a neighboring log), so the safest fix
    // is to re-sort all of that animal's logs and recalculate ADG from scratch rather
    // than patching only the edited row — this is what makes ADG (and currentWeight)
    // "dynamically update" when a past entry weight or weighing date is corrected.
    const recalcWeightChain = (animalId, logId, updates) => {
        const animalLogs = weightLogs
            .filter(w => w.animalId === animalId)
            .map(w => w.id === logId ? { ...w, ...updates } : w)
            .sort((a, b) => daysBetween(a.date, b.date));

        let prevLog = null;
        const recalculated = animalLogs.map(w => {
            let adg = 0;
            if (prevLog) {
                const daysElapsed = Math.max(1, daysBetween(w.date, prevLog.date));
                adg = parseFloat(((w.weight - prevLog.weight) / daysElapsed).toFixed(2));
            }
            prevLog = w;
            return { ...w, adg };
        });

        const latestWeight = recalculated.length > 0 ? recalculated[recalculated.length - 1].weight : undefined;

        // 1. Sync UI locally
        setWeightLogs(prev => prev.map(w => recalculated.find(r => r.id === w.id) || w));
        if (latestWeight !== undefined) {
            setAnimals(prev => prev.map(a => a.id === animalId ? { ...a, currentWeight: latestWeight } : a));
        }

        // 2. Queue database transaction durably
        persistMutation('UPDATE_WEIGHT_LOGS_BATCH', {
            animalId,
            logs: recalculated.map(w => ({ id: w.id, date: w.date, weight: w.weight, adg: w.adg })),
            currentWeight: latestWeight
        });
    };

    // Correcting a mis-keyed weight or weighing date on an existing log — recalculates
    // ADG for that log and every log after it for the same animal, and refreshes the
    // animal's currentWeight if the edited log turns out to be the latest one.
    const updateWeightLog = async (logId, updates) => {
        const log = weightLogs.find(w => w.id === logId);
        if (!log) return;
        recalcWeightChain(log.animalId, logId, {
            date: updates.date ?? log.date,
            weight: updates.weight !== undefined ? parseFloat(updates.weight) : log.weight
        });
    };

    const addTreatment = async (animalId, date, type, medicine, dosage, withholding, protocolTaskId = null) => {
        const id = treatments.length > 0 ? Math.max(...treatments.map(t => t.id)) + 1 : 1;
        const currentUser = staffUserRef.current?.email || staffUserRef.current?.name || null;
        const newTreatment = {
            id,
            animalId: parseInt(animalId),
            date,
            type,
            medicine,
            dosage,
            withholding: parseInt(withholding) || 0,
            protocolTaskId: protocolTaskId || null,
            createdBy: currentUser
        };

        // 1. Sync UI locally
        setTreatments(prev => [...prev, newTreatment]);

        // 2. Queue database transaction durably
        persistMutation('LOG_TREATMENT', { animalId: parseInt(animalId), date, type, medicine, dosage, withholding: parseInt(withholding) || 0, protocolTaskId: protocolTaskId || null, createdBy: currentUser });
    };

    const transitionAnimalStatus = async (animalId, nextStatus) => {
        const today = todayPKT();
        const currentUser = staffUserRef.current?.email || staffUserRef.current?.name || null;
        const existing = animals.find(a => a.id === parseInt(animalId));
        const prevStatus = existing ? existing.status : 'Quarantined';

        // 1. Sync UI locally
        setAnimals(prev => prev.map(animal => {
            if (animal.id === parseInt(animalId)) {
                return { ...animal, status: nextStatus };
            }
            return animal;
        }));
        setEvents(prev => [...prev, {
            id: Date.now(),
            animalId: parseInt(animalId),
            date: today,
            eventType: 'status_change',
            note: `→ ${nextStatus}`,
            prevStatus,
            nextStatus,
            createdBy: currentUser
        }]);

        // 2. Queue database transaction durably
        persistMutation('TRANSITION_STATUS', { animalId: parseInt(animalId), status: nextStatus, date: today, note: `→ ${nextStatus}` });
    };

    // Only Super Admins can hard-delete an animal directly. Everyone else's request
    // is staged server-side as a pending approval instead — this function is
    // deliberately non-optimistic for that path (mirroring recordSale) so the animal
    // never disappears from a non-admin's view before a super admin actually signs
    // off on the deletion.
    const deleteAnimal = async (animalId) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;

        if (!isAdmin) {
            try {
                const { res, data } = await sendMutationToServer('DELETE_ANIMAL', { animalId });
                if (!res.ok || data.success === false) {
                    return { success: false, error: data.error || 'Delete request could not be submitted.' };
                }
                refreshApprovals();
                return { success: true, pending: true };
            } catch (err) {
                console.error('DELETE_ANIMAL (pending) failed:', err);
                return { success: false, error: 'Network error — request was not submitted. Please try again.' };
            }
        }

        // 1. Sync UI locally
        setAnimals(prev => prev.filter(a => a.id !== animalId));
        setWeightLogs(prev => prev.filter(w => w.animalId !== animalId));
        setTreatments(prev => prev.filter(t => t.animalId !== animalId));

        // 2. Queue DB transaction durably
        persistMutation('DELETE_ANIMAL', { animalId });
        return { success: true };
    };

    const updateAnimal = async (updatedAnimal) => {
        const existing = animals.find(a => a.id === updatedAnimal.id);
        const isAdmin = staffUserRef.current?.isAdmin === true;
        const currentUser = staffUserRef.current?.email || staffUserRef.current?.name || null;

        if (existing && updatedAnimal.pen !== undefined && String(updatedAnimal.pen) !== String(existing.pen)) {
            const fromPen = existing.pen || 'Unassigned';
            const toPen = updatedAnimal.pen || 'Unassigned';
            setEvents(prev => [...prev, {
                id: Date.now(),
                animalId: existing.id,
                date: todayPKT(),
                eventType: 'pen_transfer',
                note: `Moved ${fromPen} → ${toPen}`,
                fromPen,
                toPen,
                createdBy: currentUser
            }]);
        }

        const newEntryWeight = updatedAnimal.entryWeight !== undefined ? parseFloat(updatedAnimal.entryWeight) : existing?.entryWeight;
        const newPurchasePrice = updatedAnimal.purchasePrice !== undefined ? parseFloat(updatedAnimal.purchasePrice) : existing?.purchasePrice;
        const sensitiveChanged = !!existing && (
            newEntryWeight !== existing.entryWeight || newPurchasePrice !== existing.purchasePrice
        );

        if (!isAdmin && sensitiveChanged) {
            try {
                const { res, data } = await sendMutationToServer('UPDATE_ANIMAL', updatedAnimal);
                if (!res.ok || data.success === false) {
                    return { success: false, error: data.error || 'Update could not be saved.' };
                }
                setAnimals(prev => prev.map(a => a.id === updatedAnimal.id
                    ? { ...a, ...updatedAnimal, entryWeight: existing.entryWeight, purchasePrice: existing.purchasePrice }
                    : a));
                refreshApprovals();
                return { success: true, pending: true, pendingFields: data.pendingFields || [] };
            } catch (err) {
                console.error('UPDATE_ANIMAL (pending) failed:', err);
                return { success: false, error: 'Network error — change was not saved. Please try again.' };
            }
        }

        // 1. Sync UI locally
        setAnimals(prev => prev.map(a => a.id === updatedAnimal.id ? { ...a, ...updatedAnimal } : a));

        if (existing) {
            const newEntryDate = updatedAnimal.entryDate ?? existing.entryDate;
            if (newEntryWeight !== existing.entryWeight || newEntryDate !== existing.entryDate) {
                const baselineLog = weightLogs
                    .filter(w => w.animalId === existing.id)
                    .sort((a, b) => daysBetween(a.date, b.date))[0];
                if (baselineLog) {
                    recalcWeightChain(existing.id, baselineLog.id, { date: newEntryDate, weight: newEntryWeight });
                }
            }
        }

        // 2. Queue DB transaction durably
        persistMutation('UPDATE_ANIMAL', updatedAnimal);
        return { success: true };
    };

    const undoActivity = async (item) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            alert('Undo is restricted to Super Admins.');
            return { success: false, error: 'Unauthorized: Undo requires Super Admin access.' };
        }
        const currentUser = staffUserRef.current?.name || staffUserRef.current?.email || 'Admin';

        if (item.eventType === 'pen_transfer' || (item.note && item.note.includes('Moved '))) {
            const animalId = item.animalId;
            let fromPen = item.fromPen;
            if (!fromPen && item.note && item.note.includes('Moved ')) {
                const match = item.note.match(/Moved\s+(?:Pen\s+)?([^\s→]+)\s*→/i);
                if (match && match[1]) {
                    fromPen = match[1];
                }
            }
            const targetPen = (fromPen === 'Unassigned' || !fromPen) ? null : fromPen;
            setAnimals(prev => prev.map(a => a.id === animalId ? { ...a, pen: targetPen } : a));
            setEvents(prev => prev.filter(e => e.id !== item.sortId));
            persistMutation('UPDATE_ANIMAL', { id: animalId, pen: targetPen });
        } else if (item.eventType === 'status_change') {
            const animalId = item.animalId;
            const targetStatus = item.prevStatus || 'Quarantined';
            setAnimals(prev => prev.map(a => a.id === animalId ? { ...a, status: targetStatus } : a));
            setEvents(prev => prev.filter(e => e.id !== item.sortId));
            persistMutation('TRANSITION_STATUS', { animalId, status: targetStatus, date: todayPKT(), note: `Restored to ${targetStatus}` });
        } else if (item.eventType === 'treatment') {
            deleteTreatment(item.sortId);
        } else if (item.eventType === 'weight') {
            deleteWeightLog(item.sortId);
        } else if (item.eventType === 'sold' || item.eventType === 'deceased') {
            const animalId = item.animalId;
            setAnimals(prev => prev.map(a => a.id === animalId ? { ...a, status: 'Fattening', salePrice: null, buyerName: null, saleDate: null, deceasedDate: null, deceasedCause: null } : a));
            setEvents(prev => prev.filter(e => e.id !== item.sortId));
            persistMutation('UPDATE_ANIMAL', { id: animalId, status: 'Fattening' });
        }
    };

    // Admin-only: approve a staged sensitive-field edit or delete request. Applies
    // the change locally (rippling ADG the same way a direct admin edit would) only
    // after the server confirms the approval, then drops it from the live queue.
    const approvePendingChange = async (approval) => {
        try {
            const { res, data } = await sendMutationToServer('APPROVE_PENDING_CHANGE', { approvalId: approval.id });
            if (!res.ok || data.success === false) {
                return { success: false, error: data.error || 'Could not approve request.' };
            }

            if (approval.action === 'UPDATE_ANIMAL') {
                const changes = approval.payload || {};
                const existing = animals.find(a => a.id === approval.animalId);
                setAnimals(prev => prev.map(a => a.id === approval.animalId ? { ...a, ...changes } : a));

                if (existing && changes.entryWeight !== undefined && changes.entryWeight !== existing.entryWeight) {
                    const baselineLog = weightLogs
                        .filter(w => w.animalId === approval.animalId)
                        .sort((a, b) => daysBetween(a.date, b.date))[0];
                    if (baselineLog) {
                        recalcWeightChain(approval.animalId, baselineLog.id, { date: baselineLog.date, weight: changes.entryWeight });
                    }
                }
            } else if (approval.action === 'DELETE_ANIMAL') {
                setAnimals(prev => prev.filter(a => a.id !== approval.animalId));
                setWeightLogs(prev => prev.filter(w => w.animalId !== approval.animalId));
                setTreatments(prev => prev.filter(t => t.animalId !== approval.animalId));
            } else if (approval.action === 'DELETE_FEED_PURCHASE') {
                setFeedPurchases(prev => prev.filter(p => p.id !== (approval.payload?.id)));
            } else if (approval.action === 'DELETE_FEED_STOCK_ISSUE') {
                setFeedStockIssues(prev => prev.filter(i => i.id !== (approval.payload?.id)));
            } else if (approval.action === 'DELETE_WEIGHT_LOG') {
                setWeightLogs(prev => prev.filter(w => w.id !== (approval.payload?.logId)));
            } else if (approval.action === 'DELETE_TREATMENT') {
                setTreatments(prev => prev.filter(t => t.id !== (approval.payload?.treatmentId)));
            } else if (approval.action === 'DELETE_FEED_LOG') {
                const changes = approval.payload || {};
                setFeedLogs(prev => prev.filter(f => !(f.date === changes.date && (f.pen === changes.pen || (!f.pen && changes.pen === 'ALL')) && (changes.feedingIndex === undefined || changes.feedingIndex === null || f.feedingIndex === changes.feedingIndex))));
            } else if (approval.action === 'DELETE_RATION_PLAN') {
                setRationPlans(prev => prev.filter(p => p.id !== (approval.payload?.id)));
                setPens(prev => prev.map(pen => pen.rationPlanId === (approval.payload?.id) ? { ...pen, rationPlanId: null } : pen));
            } else if (approval.action === 'DELETE_PEN') {
                setPens(prev => prev.filter(p => p.id !== (approval.payload?.id)));
            } else if (approval.action === 'DELETE_ORDER') {
                setOrders(prev => prev.filter(o => o.id !== (approval.payload?.orderId)));
            } else if (approval.action === 'DELETE_MEAT_CUT') {
                setMeatCuts(prev => prev.filter(c => c.id !== (approval.payload?.cutId)));
            } else if (approval.action === 'DELETE_ENQUIRY') {
                setEnquiries(prev => prev.filter(e => e.id !== (approval.payload?.enquiryId)));
            } else if (approval.action === 'DELETE_QUOTATION') {
                setQuotations(prev => prev.filter(q => q.id !== (approval.payload?.quoteId)));
            } else if (approval.action === 'DELETE_SPEC_SHEET') {
                setSpecSheets(prev => prev.filter(s => s.docRef !== (approval.payload?.refId)));
            } else if (approval.action === 'RECORD_DEATH') {
                const changes = approval.payload || {};
                setAnimals(prev => prev.map(a => a.id === approval.animal_id || a.id === approval.animalId ? { ...a, status: 'Deceased', deceasedDate: changes.deceasedDate, deceasedCause: changes.deceasedCause } : a));
            } else if (approval.action === 'RECORD_SALE') {
                const changes = approval.payload || {};
                setAnimals(prev => prev.map(a => a.id === approval.animal_id || a.id === approval.animalId ? { ...a, status: 'Sold', salePrice: parseFloat(changes.salePrice), buyerName: changes.buyerName, saleDate: changes.saleDate } : a));
            } else if (approval.action === 'ADD_FEED_PURCHASE') {
                const changes = approval.payload || {};
                setFeedPurchases(prev => [...prev, changes]);
            } else if (approval.action === 'SAVE_SETTINGS') {
                const changes = approval.payload || {};
                if (changes.key) setSettings(prev => ({ ...prev, [changes.key]: changes.value }));
            } else if (approval.action === 'ADD_MEAT_CUT') {
                const changes = approval.payload || {};
                setMeatCuts(prev => [...prev, changes]);
            } else if (approval.action === 'UPDATE_MEAT_CUT') {
                const changes = approval.payload || {};
                setMeatCuts(prev => prev.map(c => c.id === changes.id ? changes : c));
            } else if (approval.action === 'UPDATE_WEIGHT_LOGS_BATCH') {
                const changes = approval.payload || {};
                if (changes.logs) {
                    setWeightLogs(prev => {
                        const next = [...prev];
                        changes.logs.forEach(log => {
                            const idx = next.findIndex(w => w.id === log.id);
                            if (idx >= 0) next[idx] = { ...next[idx], ...log };
                        });
                        return next;
                    });
                }
                if (changes.currentWeight !== undefined) {
                    setAnimals(prev => prev.map(a => a.id === (approval.animal_id || approval.animalId) ? { ...a, currentWeight: changes.currentWeight } : a));
                }
            }

            setPendingApprovals(prev => prev.filter(p => p.id !== approval.id));
            setAllApprovals(prev => prev.map(p => p.id === approval.id ? { ...p, status: 'approved' } : p));
            return { success: true };
        } catch (err) {
            console.error('APPROVE_PENDING_CHANGE failed:', err);
            return { success: false, error: 'Network error — approval was not recorded. Please try again.' };
        }
    };

    // Admin-only: reject a staged request with an optional short reason, visible to
    // the requester via their myRequests history.
    const rejectPendingChange = async (approvalId, note) => {
        try {
            const { res, data } = await sendMutationToServer('REJECT_PENDING_CHANGE', { approvalId, note });
            if (!res.ok || data.success === false) {
                return { success: false, error: data.error || 'Could not reject request.' };
            }
            setPendingApprovals(prev => prev.filter(p => p.id !== approvalId));
            setAllApprovals(prev => prev.map(p => p.id === approvalId ? { ...p, status: 'rejected', reviewNote: note || null } : p));
            return { success: true };
        } catch (err) {
            console.error('REJECT_PENDING_CHANGE failed:', err);
            return { success: false, error: 'Network error — rejection was not recorded. Please try again.' };
        }
    };

    const deleteWeightLog = async (logId) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_WEIGHT_LOG', { logId });
        }
        setWeightLogs(prev => prev.filter(w => w.id !== logId));
        persistMutation('DELETE_WEIGHT_LOG', { logId });
        return { success: true };
    };

    const deleteTreatment = async (treatmentId) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_TREATMENT', { treatmentId });
        }
        setTreatments(prev => prev.filter(t => t.id !== treatmentId));
        persistMutation('DELETE_TREATMENT', { treatmentId });
        return { success: true };
    };

    // Unlike most mutations in this file, recordSale is NOT optimistic: the backend
    // enforces the medicine withholding (food-safety) period and can legitimately
    // reject a sale, so we wait for its verdict before touching local state.
    const recordSale = async (animalId, salePrice, buyerName, saleDate) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            try {
                const { res, data } = await sendMutationToServer('RECORD_SALE', { animalId: parseInt(animalId), salePrice: parseFloat(salePrice), buyerName, saleDate });
                if (!res.ok || data.success === false) {
                    alert(data.error || 'Sale request could not be submitted.');
                    return { success: false, error: data.error || 'Sale request could not be submitted.' };
                }
                refreshApprovals();
                alert('Sale record request submitted for Super Admin approval.');
                return { success: true, pending: true };
            } catch (err) {
                console.error('RECORD_SALE (pending) failed:', err);
                alert('Network error — sale request was not submitted.');
                return { success: false, error: 'Network error — request was not submitted.' };
            }
        }
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
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('RECORD_DEATH', { animalId: parseInt(animalId), deceasedDate, deceasedCause });
        }
        setAnimals(prev => prev.map(a => a.id === parseInt(animalId)
            ? { ...a, status: 'Deceased', deceasedDate, deceasedCause }
            : a
        ));
        setEvents(prev => [...prev, { id: Date.now(), animalId: parseInt(animalId), date: deceasedDate, eventType: 'deceased', note: `Deceased — ${deceasedCause}` }]);
        persistMutation('RECORD_DEATH', { animalId: parseInt(animalId), deceasedDate, deceasedCause });
        return { success: true };
    };

    const updateTMRPrices = (prices) => {
        setFeedIngredients(prev => {
            const next = prev.map(ing => {
                if (ing.id === 'silage' && prices.silagePrice !== undefined) return { ...ing, price: prices.silagePrice };
                if (ing.id === 'cottonseed' && prices.cottonseedPrice !== undefined) return { ...ing, price: prices.cottonseedPrice };
                if (ing.id === 'straw' && prices.strawPrice !== undefined) return { ...ing, price: prices.strawPrice };
                if (ing.id === 'minerals' && prices.mineralsPrice !== undefined) return { ...ing, price: prices.mineralsPrice };
                return ing;
            });
            persistMutation('SAVE_SETTINGS', { key: 'feed_ingredients', value: next });
            return next;
        });
    };

    const updateFeedRecipe = (recipe) => {
        setFeedIngredients(prev => {
            const next = prev.map(ing => {
                if (ing.id === 'silage' && recipe.silageDM !== undefined) return { ...ing, dmTarget: recipe.silageDM };
                if (ing.id === 'cottonseed' && recipe.cottonseedDM !== undefined) return { ...ing, dmTarget: recipe.cottonseedDM };
                if (ing.id === 'straw' && recipe.strawDM !== undefined) return { ...ing, dmTarget: recipe.strawDM };
                if (ing.id === 'minerals' && recipe.mineralsDM !== undefined) return { ...ing, dmTarget: recipe.mineralsDM };
                return ing;
            });
            persistMutation('SAVE_SETTINGS', { key: 'feed_ingredients', value: next });
            return next;
        });
    };

    const updateFeedIngredients = (newIngredients) => {
        setFeedIngredients(newIngredients);
        persistMutation('SAVE_SETTINGS', { key: 'feed_ingredients', value: newIngredients });
    };

    // Snapshots what was actually fed today (or a chosen date) — ingredients, quantities
    // and cost — as an immutable dated record, separate from editing the live recipe.
    // One record per (date, pen); re-logging the same day/pen overwrites that day only,
    // never earlier days. This is what makes the recipe non-retroactive.
    const logFeed = (entry) => {
        const date = entry.date || todayPKT();
        const pen = entry.pen || 'ALL';
        // feedingIndex 0 = a single Full Day (100%) log; 1-3 = which feeding of a
        // Morning/Evening (or Morning/Afternoon/Evening) split this is. Each feeding_index
        // is its own row in the DB, so logging "Feeding 2 of 2" no longer overwrites
        // "Feeding 1 of 2" from earlier the same day.
        const feedingIndex = entry.feedingIndex || 0;
        const record = {
            id: `${date}__${pen}__${feedingIndex}`,
            date,
            pen,
            animalCount: entry.animalCount || 0,
            ingredients: entry.ingredients || [],
            totalDmKg: entry.totalDmKg || 0,
            totalBatchKg: entry.totalBatchKg || 0,
            totalCost: entry.totalCost || 0,
            costPerAnimal: entry.costPerAnimal || 0,
            notes: entry.notes || '',
            dietDiffered: !!entry.dietDiffered,
            feedingIndex,
            numFeedings: entry.numFeedings || 1,
            feedingPct: entry.feedingPct !== undefined ? entry.feedingPct : 100
        };

        // 1. Sync UI locally immediately (upsert by date+pen+feedingIndex)
        setFeedLogs(prev => {
            const exists = prev.some(f => f.date === date && f.pen === pen && (f.feedingIndex || 0) === feedingIndex);
            return exists
                ? prev.map(f => (f.date === date && f.pen === pen && (f.feedingIndex || 0) === feedingIndex) ? { ...f, ...record } : f)
                : [...prev, record];
        });

        // 2. Queue DB transaction durably
        persistMutation('LOG_FEED', record);
    };

    const deleteFeedLog = async (date, pen, feedingIndex) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_FEED_LOG', { date, pen, feedingIndex });
        }
        setFeedLogs(prev => prev.filter(f => !(f.date === date && f.pen === pen && (feedingIndex === undefined || (f.feedingIndex || 0) === feedingIndex))));
        persistMutation('DELETE_FEED_LOG', { date, pen, feedingIndex });
        return { success: true };
    };

    // ─── RATION PLANS & PEN ASSIGNMENT ───

    const saveRationPlan = (plan) => {
        const record = {
            id: plan.id || `plan-${Date.now()}`,
            name: plan.name || 'Untitled Plan',
            description: plan.description || '',
            adgFloor: plan.adgFloor ?? 1.0,
            weeks: plan.weeks || [],
            // Day 1-7 adaptation table (percentage-based, per forage_type), separate from
            // the weight-indexed steady-state rows in `weeks`. Empty = plan has no
            // adaptation table yet, and getPenRationRow falls back to the legacy per-week
            // scheduleMode/dailyIngredients behavior for backward compatibility.
            adaptation: plan.adaptation || [],
            // Per-plan procurement price overrides (PKR/kg), keyed by ingredient id.
            // Ingredients not present here fall back to the global feed ingredient price.
            ingredientPrices: plan.ingredientPrices || {},
            isDefault: !!plan.isDefault
        };

        setRationPlans(prev => {
            const exists = prev.some(p => p.id === record.id);
            return exists ? prev.map(p => (p.id === record.id ? { ...p, ...record } : p)) : [...prev, record];
        });

        persistMutation('SAVE_RATION_PLAN', record);
        return record;
    };

    const duplicateRationPlan = (plan) => {
        const newId = `plan-${Date.now()}`;
        const duplicated = {
            ...plan,
            id: newId,
            name: `${plan.name} (Copy)`,
            isDefault: false
        };
        setRationPlans(prev => [...prev, duplicated]);
        persistMutation('SAVE_RATION_PLAN', duplicated);
        return duplicated;
    };

    const deleteRationPlan = async (id) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_RATION_PLAN', { id });
        }
        setRationPlans(prev => prev.filter(p => p.id !== id));
        // Unassign any pen that was pointed at this plan, mirroring the server's
        // ON DELETE SET NULL / explicit unassign in the DELETE_RATION_PLAN handler.
        setPens(prev => prev.map(p => (p.rationPlanId === id ? { ...p, rationPlanId: null } : p)));
        persistMutation('DELETE_RATION_PLAN', { id });
        return { success: true };
    };

    const savePen = (pen) => {
        const record = {
            ...pen,
            id: pen.id,
            rationPlanId: pen.rationPlanId || null,
            planId: pen.planId || null,
            cycleStartDate: pen.cycleStartDate || null,
            forageType: pen.forageType || 'silage',
            expectedExitDate: pen.expectedExitDate || null,
            notes: pen.notes || ''
        };

        setPens(prev => {
            const exists = prev.some(p => String(p.id) === String(record.id));
            return exists ? prev.map(p => (String(p.id) === String(record.id) ? { ...p, ...record } : p)) : [...prev, record];
        });

        persistMutation('SAVE_PEN', record);
        return record;
    };

    const deletePen = async (id) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_PEN', { id });
        }
        setPens(prev => prev.filter(p => p.id !== id));
        persistMutation('DELETE_PEN', { id });
        return { success: true };
    };

    // Imports a CSV-defined ration plan (RATION_SYSTEM_SPEC.md) — the primary, strict
    // path for the new absolute-kg/head/day ration system. `rows` is already parsed
    // client-side into structured objects; the server is the sole source of truth for
    // validation (ingredient-name matching against feed stock, numeric bounds, bracket
    // contiguity) and rejects the whole import (never partial) on any violation.
    // Never overwrites an existing plan version — always creates plan_key vN+1.
    const importRationPlanCSV = async ({ planKey, planName, adaptationDays, adgFloor, isDefault, rows }) => {
        const { res, data } = await sendMutationToServer('IMPORT_RATION_PLAN', {
            planKey, planName, adaptationDays, adgFloor, isDefault, rows
        });

        if (!res.ok || data.success === false) {
            return { success: false, errors: data.errors || [data.error || `HTTP ${res.status}`] };
        }

        // Optimistically add the newly created plan/rows/items to local state instead
        // of waiting for a full page refetch — same pattern as saveRationPlan/savePen.
        setRationPlansV2(prev => [...prev, data.plan]);
        setRationRows(prev => [...prev, ...data.rows]);
        setRationRowItems(prev => [...prev, ...data.items]);

        return { success: true, planId: data.planId, planKey: data.planKey, version: data.version, rowCount: data.rowCount };
    };

    // Metadata-only edit for an imported (v2) plan — name, adaptation window, ADG floor,
    // default flag. Never touches the imported bracket/ingredient rows themselves; fixing
    // those still means uploading a new CSV version (see importRationPlanCSV).
    const updateRationPlanV2 = async ({ id, name, adaptationDays, adgFloor, isDefault }) => {
        const { res, data } = await sendMutationToServer('UPDATE_RATION_PLAN_V2', {
            id, name, adaptationDays, adgFloor, isDefault
        });

        if (!res.ok || data.success === false) {
            return { success: false, error: data.error || `HTTP ${res.status}` };
        }

        setRationPlansV2(prev => prev.map(p => (p.id === id ? { ...p, name, adaptationDays: adaptationDays || 7, adgFloor: adgFloor || 1.0, isDefault: !!isDefault } : p)));
        return { success: true };
    };

    // Corrects a single imported bracket row in place (weight range, target ADG, ingredient
    // quantities) — e.g. a typo caught after import — without re-uploading a whole new CSV
    // version. Server re-validates bounds + bracket contiguity against sibling rows before
    // writing, since live pens may already be resolving against this exact version.
    const updateRationRow = async ({ rowId, wtMin, wtMax, targetAdg, estCostPerHeadPerDay, items }) => {
        const { res, data } = await sendMutationToServer('UPDATE_RATION_ROW', {
            rowId, wtMin, wtMax, targetAdg, estCostPerHeadPerDay, items
        });

        if (!res.ok || data.success === false) {
            return { success: false, errors: data.errors || [data.error || `HTTP ${res.status}`] };
        }

        setRationRows(prev => prev.map(r => (r.id === data.row.id ? data.row : r)));
        setRationRowItems(prev => [...prev.filter(i => i.rowId !== data.row.id), ...data.items]);

        return { success: true };
    };

    // Finds the steady-state bracket row for a given forage type + weight, falling back
    // to the nearest bracket by midpoint distance so a pen never silently loses its
    // ration. Rows saved before forageType existed are treated as 'silage' (the only
    // forage type ever in use historically), so existing plans need no data migration.
    const findWeightBracket = (plan, forageType, weight) => {
        if (!plan || !plan.weeks || plan.weeks.length === 0) return null;

        const matchingRows = plan.weeks.filter(w => !w.forageType || w.forageType === forageType || (w.forageType || 'silage') === forageType);
        const pool = matchingRows.length > 0 ? matchingRows : plan.weeks;

        if (weight === null || weight === undefined || isNaN(weight)) return pool[0];

        const numericWeight = parseFloat(weight);

        // 1. Try exact range match (inclusive of min and max bounds)
        const exact = pool.find(w => {
            const min = parseFloat(w.liveWeightMin) || 0;
            const max = parseFloat(w.liveWeightMax) || 9999;
            return numericWeight >= min && numericWeight <= max;
        });
        if (exact) return exact;

        // 2. Fall back to closest bracket by midpoint distance
        return pool.reduce((closest, w) => {
            const min = parseFloat(w.liveWeightMin) || 0;
            const max = parseFloat(w.liveWeightMax) || 9999;
            const mid = (min + max) / 2;

            const cMin = parseFloat(closest.liveWeightMin) || 0;
            const cMax = parseFloat(closest.liveWeightMax) || 9999;
            const closestMid = (cMin + cMax) / 2;

            return Math.abs(numericWeight - mid) < Math.abs(numericWeight - closestMid) ? w : closest;
        }, pool[0]);
    };

    // Extrapolates an animal's weight forward from its last actual weigh-in using the
    // target ADG of whichever bracket it was in at that weigh-in, so the ration bracket
    // tracks expected growth day-to-day instead of only updating when someone re-weighs.
    // Reset to the real value automatically the moment a new weigh-in is logged, since
    // that becomes the new "last actual weight".
    const getAnimalProjectedWeight = (animal, plan, forageType, targetDate = null) => {
        const refDate = targetDate ? parseDateOnly(targetDate) : todayAsDate();
        const logs = weightLogs.filter(w => w.animalId === animal.id).sort((a, b) => daysBetween(b.date, a.date));
        const validLogs = logs.filter(w => parseDateOnly(w.date) <= refDate);
        const lastLog = validLogs[0] || logs[0];
        const lastWeight = lastLog ? parseFloat(lastLog.weight) : (parseFloat(animal.currentWeight) || 0);
        const lastDate = lastLog ? lastLog.date : animal.entryDate;
        const daysSinceWeigh = lastDate
            ? Math.max(0, daysBetween(refDate, lastDate))
            : 0;
        const bracketAtWeigh = findWeightBracket(plan, forageType, lastWeight);
        const targetAdg = bracketAtWeigh?.targetAdg ?? plan?.adgFloor ?? 0;
        return lastWeight + daysSinceWeigh * targetAdg;
    };

    // Reconstructs which animals were actually standing in a pen on a given date, by
    // replaying each animal's registered/pen_transfer event trail (see api/farm.js —
    // 'registered' and 'pen_transfer' ba_events rows carry a to_pen) instead of
    // trusting today's live `pen`/`status` fields. Without this, logging feed
    // retroactively (or peeking a past date) would wrongly pull in animals bought
    // into the pen after that date, or drop ones sold/moved since — this is what
    // makes both correct for any date, not just today.
    // Animals with no dated pen history yet (registered before this tracking
    // existed) fall back to today's live pen, same as the old always-current-roster
    // behavior — so nothing regresses for existing data.
    const getPenRosterAsOf = (penId, refDate) => {
        return animals.filter(animal => {
            if (animal.entryDate && parseDateOnly(animal.entryDate) > refDate) return false;

            if (animal.status === 'Sold' || animal.status === 'Deceased') {
                const exitEvent = events.find(e => e.animalId === animal.id
                    && (e.eventType === 'sold' || e.eventType === 'deceased'));
                // No dated exit event on record (legacy data) → always exclude, same
                // as the old current-status-only filter.
                if (!exitEvent || parseDateOnly(exitEvent.date) <= refDate) return false;
            }

            const penEvents = events
                .filter(e => e.animalId === animal.id
                    && (e.eventType === 'registered' || e.eventType === 'pen_transfer')
                    && e.toPen
                    && parseDateOnly(e.date) <= refDate)
                .sort((a, b) => daysBetween(parseDateOnly(a.date), parseDateOnly(b.date)) || (a.id - b.id));

            const effectivePen = penEvents.length > 0 ? penEvents[penEvents.length - 1].toPen : animal.pen;
            return effectivePen === penId;
        });
    };

    // Resolves the current ration row for a pen from its assigned plan. Primary lookup
    // key is the pen's average PROJECTED weight (see getAnimalProjectedWeight above) —
    // not the raw last-recorded weight — matched against the steady-state bracket for
    // the pen's current forage_type. For a pen's first 7 days on feed, a separate
    // percentage-based adaptation table (day 1-7, also forage_type-tagged) overrides the
    // ingredient mix: Wanda scaled to a % of the current bracket's Wanda quantity, Toori
    // fed as a fixed kg, and forage fed ad-lib (no fixed quantity). Plans without an
    // adaptation table (e.g. the legacy "Baseline" plan) fall back to the old per-week
    // scheduleMode/dailyIngredients behavior unchanged.
    // Resolves a pen's ration through the new normalized, CSV-imported system
    // (RATION_SYSTEM_SPEC.md) — absolute kg/head/day only, one deterministic bracket
    // lookup keyed on this pen's own projected weight. Used whenever pen.planId is set,
    // in place of the legacy percentage-based per-plan heuristic below. Never falls back
    // to a nearby bracket on a miss — returns `blocked: true` instead, since silently
    // feeding the wrong bracket is exactly the bug this system replaces.
    const resolvePenRationV2 = (pen, refDate) => {
        const plan = rationPlansV2.find(p => p.id === pen.planId);
        const forageType = pen.forageType || 'silage';
        const penAnimals = getPenRosterAsOf(pen.id, refDate);
        const headCount = penAnimals.length;
        const avgWeight = headCount > 0
            ? penAnimals.reduce((sum, a) => sum + (parseFloat(a.currentWeight) || 0), 0) / headCount
            : null;

        if (!plan) {
            return { system: 'v2', blocked: true, error: 'Assigned ration plan version not found.', forageType, headCount, avgWeight, plan: null };
        }

        const penForResolver = {
            cycleStartDate: pen.cycleStartDate,
            forageType,
            planId: pen.planId,
            lastActualWeightKg: pen.lastActualWeightKg,
            lastWeighDate: pen.lastWeighDate,
            currentTargetAdg: pen.currentTargetAdg
        };

        try {
            const result = resolveRation({ pen: penForResolver, plan, rows: rationRows, rowItems: rationRowItems, today: refDate });
            const ingredients = {};
            result.items.forEach(item => { ingredients[item.ingredientId] = item.qtyKgPerHeadPerDay; });

            return {
                system: 'v2',
                blocked: false,
                plan,
                forageType,
                headCount,
                avgWeight,
                avgProjectedWeight: result.projectedWeight,
                daysOnFeed: result.daysOnFeed,
                phase: result.phase,
                dayNo: result.dayNo,
                bracketMin: result.bracketMin,
                bracketMax: result.bracketMax,
                estCostPerHeadPerDay: result.row.estCostPerHeadPerDay,
                week: { targetAdg: result.row.targetAdg, ingredients },
                matchedByWeight: true,
                isAdaptationWeek: result.phase === 'ADAPTATION',
                usesAdaptationTable: result.phase === 'ADAPTATION',
                forageAdLib: false,
                adLibForageId: null
            };
        } catch (err) {
            if (err instanceof NoMatchingRationError) {
                const altForage = forageType === 'silage' ? 'chari' : 'silage';
                const altPenForResolver = { ...penForResolver, forageType: altForage };
                let altResult = null;
                try {
                    altResult = resolveRation({ pen: altPenForResolver, plan, rows: rationRows, rowItems: rationRowItems, today: refDate });
                } catch (e) {
                    altResult = null;
                }

                const daysOnFeed = pen.cycleStartDate ? daysBetween(refDate, pen.cycleStartDate) + 1 : null;
                const daysSinceWeigh = pen.lastWeighDate ? Math.max(0, daysBetween(refDate, pen.lastWeighDate)) : 0;
                const adg = pen.currentTargetAdg != null ? pen.currentTargetAdg : (plan?.adgFloor ?? 0);
                const projectedWeight = (pen.lastActualWeightKg || 0) + daysSinceWeigh * adg;

                const adaptationDays = plan?.adaptationDays ?? 7;
                const phase = daysOnFeed !== null && daysOnFeed <= adaptationDays ? 'ADAPTATION' : 'STEADY';
                const dayNo = phase === 'ADAPTATION' ? daysOnFeed : null;

                const availableDiets = rationRows.filter(r => (
                    r.planId === pen.planId &&
                    r.phase === phase &&
                    (phase === 'ADAPTATION' ? r.dayNo === dayNo : (r.dayNo === null || r.dayNo === undefined)) &&
                    projectedWeight >= r.wtMin && projectedWeight < r.wtMax + 1
                )).map(r => {
                    const items = rationRowItems.filter(i => i.rowId === r.id);
                    const ingredients = {};
                    items.forEach(item => { ingredients[item.ingredientId] = item.qtyKgPerHeadPerDay; });
                    return {
                        forageType: r.forageType,
                        bracketMin: r.wtMin,
                        bracketMax: r.wtMax,
                        targetAdg: r.targetAdg,
                        estCostPerHeadPerDay: r.estCostPerHeadPerDay,
                        ingredients
                    };
                });

                const nearestBrackets = rationRows.filter(r => (
                    r.planId === pen.planId &&
                    r.forageType === forageType &&
                    r.phase === phase &&
                    (phase === 'ADAPTATION' ? r.dayNo === dayNo : (r.dayNo === null || r.dayNo === undefined))
                )).sort((a, b) => Math.abs(a.wtMin - projectedWeight) - Math.abs(b.wtMin - projectedWeight)).slice(0, 3);

                return {
                    system: 'v2',
                    blocked: true,
                    error: err.message,
                    forageType,
                    headCount,
                    avgWeight,
                    avgProjectedWeight: projectedWeight,
                    dayNo,
                    plan,
                    altResult,
                    altForage,
                    availableDiets,
                    nearestBrackets
                };
            }
            throw err;
        }
    };

    const getPenRationRow = (penId, targetDate = null) => {
        if (!penId || penId === 'all') return null;

        const refDate = targetDate ? parseDateOnly(targetDate) : todayAsDate();

        const pen = pens.find(p => p.id === penId);
        if (!pen) return null;

        // New-system pens (planId set) resolve exclusively through the v2 engine —
        // never fall through to the legacy heuristic below, even if a stale
        // rationPlanId is also present from before migration.
        if (pen.planId) return resolvePenRationV2(pen, refDate);

        if (!pen.rationPlanId) return null;

        const plan = rationPlans.find(p => p.id === pen.rationPlanId);
        if (!plan || !plan.weeks || plan.weeks.length === 0) return null;

        const forageType = pen.forageType || 'silage';
        const penAnimals = getPenRosterAsOf(penId, refDate);
        const headCount = penAnimals.length;
        const avgWeight = headCount > 0
            ? penAnimals.reduce((sum, a) => sum + (parseFloat(a.currentWeight) || 0), 0) / headCount
            : null;
        const avgProjectedWeight = headCount > 0
            ? penAnimals.reduce((sum, a) => sum + getAnimalProjectedWeight(a, plan, forageType, refDate), 0) / headCount
            : null;

        const daysOnFeed = pen.cycleStartDate
            ? Math.max(0, daysBetween(refDate, pen.cycleStartDate))
            : null;

        const lookupWeight = avgProjectedWeight !== null ? avgProjectedWeight : avgWeight;
        const hasWeightData = lookupWeight !== null && lookupWeight > 0;
        let week = null;
        let matchedByWeight = false;

        if (hasWeightData) {
            week = findWeightBracket(plan, forageType, lookupWeight);
            matchedByWeight = true;
        } else if (daysOnFeed !== null) {
            // No weighed animals yet in this pen — fall back to calendar week so the
            // calculator still has something to show until the first weigh-in.
            const weekNum = Math.min(plan.weeks.length, Math.floor(daysOnFeed / 7) + 1);
            week = plan.weeks.find(w => w.week === weekNum) || plan.weeks[0];
            matchedByWeight = false;
        } else {
            week = plan.weeks[0];
            matchedByWeight = false;
        }
        if (!week) return null;

        const dayInWeek = daysOnFeed !== null ? (daysOnFeed % 7) + 1 : null;

        // day_no is 1-indexed (1-7); daysOnFeed is 0-indexed from cycleStartDate.
        const adaptationDay = daysOnFeed !== null ? daysOnFeed + 1 : null;
        const adaptationRows = (plan.adaptation || []).filter(r => (r.forageType || forageType) === forageType);
        const usesAdaptationTable = adaptationRows.length > 0 && adaptationDay !== null && adaptationDay <= 7;

        let resolvedIngredients;
        let forageAdLib = false;
        let adLibForageId = null;
        let usesDailyDiet = false;

        if (usesAdaptationTable) {
            const adaptRow = adaptationRows.find(r => r.day === adaptationDay) || adaptationRows[0];
            const bracket = week.ingredients || {};

            // Helper: normalized string matching against bracket keys or ingredient names
            const normString = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            // Extract adaptation percentage values (clamped between 0% and 130%)
            const wandaPct = Math.min(130, Math.max(0, parseFloat(adaptRow?.wandaPct) || 0));
            const chariPct = Math.min(130, Math.max(0, parseFloat(adaptRow?.foragePct !== undefined && adaptRow?.foragePct !== null ? adaptRow.foragePct : 100)));
            const tooriKg = Math.max(0, parseFloat(adaptRow?.tooriKg) || 0); // Absolute kg/day

            // Retrieve khalPct dynamically from custom adaptation columns (khal, cottonseed, etc.)
            let resolvedKhalPct = 0;
            if (adaptRow?.custom) {
                const khalKey = Object.keys(adaptRow.custom).find(k => {
                    const ingName = feedIngredients.find(i => i.id === k)?.name || k;
                    const norm = normString(ingName);
                    return norm.includes('khal') || norm.includes('cottonseed');
                });
                if (khalKey && adaptRow.custom[khalKey] !== undefined && adaptRow.custom[khalKey] !== '') {
                    resolvedKhalPct = parseFloat(adaptRow.custom[khalKey]) || 0;
                }
            }
            if (!resolvedKhalPct) {
                resolvedKhalPct = parseFloat(adaptRow?.khalPct ?? adaptRow?.khal ?? adaptRow?.custom?.khal ?? adaptRow?.custom?.khal_pct ?? 0) || 0;
            }
            const khalPct = Math.min(130, Math.max(0, resolvedKhalPct));

            const getBracketQty = (key) => {
                if (bracket[key] !== undefined) return parseFloat(bracket[key]) || 0;
                const targetNorm = normString(key);
                const matchingKey = Object.keys(bracket).find(k => {
                    const ingName = feedIngredients.find(i => i.id === k)?.name || k;
                    const keyNorm = normString(k);
                    const nameNorm = normString(ingName);
                    return keyNorm === targetNorm || nameNorm.includes(targetNorm) || targetNorm.includes(nameNorm);
                });
                return matchingKey ? (parseFloat(bracket[matchingKey]) || 0) : 0;
            };

            // 1. Calculate total Wanda raw materials in steady-state bracket
            let bracketWandaTotal = 0;
            let bracketSilageTotal = 0;

            Object.keys(bracket).forEach(ingId => {
                const ingObj = feedIngredients.find(i => i.id === ingId);
                const norm = normString(ingObj?.name || ingId);
                const qty = parseFloat(bracket[ingId]) || 0;

                if (norm.includes('silage') || norm.includes('forage')) {
                    bracketSilageTotal += qty;
                } else if (norm.includes('wanda') || norm.includes('maize') || norm.includes('grain') || norm.includes('gluten') || norm.includes('limestone') || norm.includes('mineral') || norm.includes('premix')) {
                    bracketWandaTotal += qty;
                }
            });

            if (bracketSilageTotal === 0) {
                bracketSilageTotal = getBracketQty('silage') || getBracketQty('forage') || 4.0;
            }

            const baseWandaQty = bracketWandaTotal > 0 ? bracketWandaTotal : (getBracketQty('maizeGrain') || getBracketQty('wanda') || 2.5);

            forageAdLib = false;
            adLibForageId = null;
            resolvedIngredients = {};

            // 2. Process all configured steady-state bracket ingredient columns:
            Object.keys(bracket).forEach(ingId => {
                const ingObj = feedIngredients.find(i => i.id === ingId);
                const norm = normString(ingObj?.name || ingId);

                if (norm.includes('urea')) {
                    // Urea is 0 during adaptation
                    resolvedIngredients[ingId] = 0;
                } else if (norm.includes('straw') || norm.includes('toori')) {
                    // Toori is absolute kg/day from adaptation row
                    resolvedIngredients[ingId] = tooriKg;
                } else if (forageType === 'chari' && norm.includes('silage')) {
                    // Silage is 0 during adaptation when forage_type is chari (Chari replaces it)
                    resolvedIngredients[ingId] = 0;
                } else if (forageType === 'chari' && norm.includes('chari')) {
                    // Chari = bracket.maize_silage * (chari_pct / 100)
                    const baseQty = bracketSilageTotal || parseFloat(bracket[ingId]) || 0;
                    resolvedIngredients[ingId] = baseQty * (chariPct / 100);
                } else if (norm.includes('silage')) {
                    // Silage adaptation when forage_type is silage
                    const silageVal = adaptRow?.forageKg ? parseFloat(adaptRow.forageKg) : (bracketSilageTotal * (chariPct / 100));
                    resolvedIngredients[ingId] = silageVal;
                } else if (norm.includes('khal') || norm.includes('cottonseed')) {
                    // Cottonseed / Khal = bracket.wanda * (khal_pct / 100)
                    resolvedIngredients[ingId] = baseWandaQty * (khalPct / 100);
                } else {
                    // Wanda ingredients (Maize Grain, Gluten Feed, Limestone/Minerals, Wanda, Premixes):
                    // Scale bracket quantity by wanda_pct / 100
                    const origBracketQty = parseFloat(bracket[ingId]) || 0;
                    resolvedIngredients[ingId] = origBracketQty * (wandaPct / 100);
                }
            });

            // 3. Ensure Chari is present if forageType === 'chari' and not in bracket keys
            if (forageType === 'chari') {
                const hasChari = Object.keys(resolvedIngredients).some(k => {
                    const norm = normString(feedIngredients.find(i => i.id === k)?.name || k);
                    return norm.includes('chari');
                });
                if (!hasChari) {
                    resolvedIngredients['chari'] = bracketSilageTotal * (chariPct / 100);
                }
            }

            // 4. Ensure Wanda line item is present when wandaPct > 0 and no non-zero Wanda components exist
            const hasWandaQty = Object.keys(resolvedIngredients).some(k => {
                const norm = normString(feedIngredients.find(i => i.id === k)?.name || k);
                return (norm.includes('wanda') || norm.includes('maize') || norm.includes('grain') || norm.includes('gluten')) && resolvedIngredients[k] > 0;
            });

            if (!hasWandaQty && wandaPct > 0) {
                const wandaKey = plan.wandaStockItemId || 'wanda';
                resolvedIngredients[wandaKey] = baseWandaQty * (wandaPct / 100);
            }

            // 5. If Cottonseed Cake / Khal is in adaptation row but not in bracket keys, resolve it
            if (khalPct > 0) {
                const hasKhal = Object.keys(resolvedIngredients).some(k => {
                    const norm = normString(feedIngredients.find(i => i.id === k)?.name || k);
                    return norm.includes('khal') || norm.includes('cottonseed');
                });
                if (!hasKhal) {
                    resolvedIngredients['cottonseed'] = baseWandaQty * (khalPct / 100);
                }
            }

            // 5. RATION SAFETY GUARD: Flag and clamp any resolved ingredient quantity above 15 kg/head/day
            Object.keys(resolvedIngredients).forEach(k => {
                if (resolvedIngredients[k] > 15) {
                    console.error(`[RATION SAFETY GUARD] Resolved ingredient quantity ${resolvedIngredients[k]} kg for ${k} exceeds 15 kg/head/day safety limit! Clamping to 15 kg.`);
                    resolvedIngredients[k] = 15;
                }
            });
        } else {
            // Legacy per-week day-stepped diet, kept for plans with no adaptation table.
            usesDailyDiet = week.scheduleMode === 'day' && week.dailyIngredients && Object.keys(week.dailyIngredients).length > 0;
            resolvedIngredients = usesDailyDiet
                ? (week.dailyIngredients[dayInWeek] || week.dailyIngredients[1] || week.ingredients || {})
                : (week.ingredients || {});
        }

        return {
            plan,
            week: { ...week, ingredients: resolvedIngredients },
            forageType,
            headCount,
            avgWeight,
            avgProjectedWeight,
            daysOnFeed,
            dayInWeek,
            adaptationDay: usesAdaptationTable ? adaptationDay : null,
            usesDailyDiet,
            usesAdaptationTable,
            forageAdLib,
            adLibForageId,
            matchedByWeight,
            isAdaptationWeek: usesAdaptationTable || week.week === 1
        };
    };

    // Compares each animal's most recent weigh-in against what its weight should have
    // been (previous weigh-in + elapsed days x target ADG of the bracket it was in back
    // then). A >5% gap either way is an early warning — illness, underfeeding, or a bad
    // scale/record. Purely computed on the fly from existing weightLogs history; nothing
    // new is persisted.
    const getPenWeightFlags = (penId) => {
        const pen = pens.find(p => p.id === penId);
        if (!pen) return [];
        const forageType = pen.forageType || 'silage';
        const legacyPlan = pen.rationPlanId ? rationPlans.find(p => p.id === pen.rationPlanId) : null;
        const v2Plan = pen.planId ? rationPlansV2.find(p => p.id === pen.planId) : null;
        const penAnimals = animals.filter(a => a.pen === penId && a.status !== 'Sold' && a.status !== 'Deceased');

        // Target ADG "as of" a given weight — used as the growth rate driving the
        // projection between two consecutive weigh-ins. New-system pens look this up
        // from the imported ration rows; legacy pens keep using the old weeks table.
        const targetAdgAtWeight = (weight) => {
            if (v2Plan) {
                const row = rationRows.find(r => r.planId === v2Plan.id && r.forageType === forageType && weight >= r.wtMin && weight < r.wtMax);
                return row ? row.targetAdg : (v2Plan.adgFloor || 0);
            }
            if (legacyPlan) {
                const bracket = findWeightBracket(legacyPlan, forageType, weight);
                return bracket?.targetAdg ?? legacyPlan.adgFloor ?? 0;
            }
            return 0;
        };

        const flags = [];
        penAnimals.forEach(animal => {
            const logs = weightLogs.filter(w => w.animalId === animal.id).sort((a, b) => daysBetween(a.date, b.date));
            if (logs.length < 2) return;
            const prev = logs[logs.length - 2];
            const curr = logs[logs.length - 1];
            const prevTargetAdg = targetAdgAtWeight(parseFloat(prev.weight));
            const { pctDiff, warn, projected } = getWeightDivergence({
                prevWeightKg: parseFloat(prev.weight),
                prevDate: prev.date,
                prevTargetAdg,
                newWeightKg: parseFloat(curr.weight),
                newDate: curr.date
            });
            if (warn) {
                flags.push({
                    animalId: animal.id,
                    rfid: animal.rfid,
                    date: curr.date,
                    actual: parseFloat(curr.weight),
                    projected,
                    pctDiff
                });
            }
        });
        return flags;
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

        // Mark live animals as sold in register and Neon DB. Awaited in parallel (not
        // fire-and-forget) so a rejected sale — e.g. the medicine withholding period
        // hasn't cleared — is reported back to the caller instead of silently leaving
        // that animal marked unsold with no indication anything went wrong.
        let saleFailures = [];
        if (order.items) {
            const results = await Promise.all(order.items.map(async item => {
                const animal = animals.find(a => a.rfid === item.rfid);
                if (!animal) return null;
                const result = await recordSale(animal.id, item.price * item.quantity, order.customerName, order.date);
                return result.success ? null : { rfid: item.rfid, error: result.error };
            }));
            saleFailures = results.filter(Boolean);
        }

        // Queue the order insert durably (idempotent server-side via ON CONFLICT DO NOTHING)
        persistMutation('ADD_ORDER', order);

        return { success: saleFailures.length === 0, saleFailures };
    };

    const updateOrderStatus = async (orderId, nextStatus) => {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: nextStatus } : o));
        persistMutation('UPDATE_ORDER_STATUS', { orderId, status: nextStatus });
    };

    const deleteOrder = async (orderId) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_ORDER', { orderId });
        }
        setOrders(prev => prev.filter(o => o.id !== orderId));
        persistMutation('DELETE_ORDER', { orderId });
        return { success: true };
    };

    const addMeatCut = async (newCut) => {
        const id = newCut.id || newCut.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const cut = { id, ...newCut };
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('ADD_MEAT_CUT', cut);
        }
        setMeatCuts(prev => [...prev, cut]);
        persistMutation('ADD_MEAT_CUT', cut);
        return { success: true };
    };

    const updateMeatCut = async (updatedCut) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('UPDATE_MEAT_CUT', updatedCut);
        }
        setMeatCuts(prev => prev.map(c => c.id === updatedCut.id ? updatedCut : c));
        persistMutation('UPDATE_MEAT_CUT', updatedCut);
        return { success: true };
    };

    const deleteMeatCut = async (cutId) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_MEAT_CUT', { cutId });
        }
        setMeatCuts(prev => prev.filter(c => c.id !== cutId));
        persistMutation('DELETE_MEAT_CUT', { cutId });
        return { success: true };
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
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_ENQUIRY', { enquiryId });
        }
        setEnquiries(prev => prev.filter(e => e.id !== enquiryId));
        persistMutation('DELETE_ENQUIRY', { enquiryId });
        return { success: true };
    };

    const updateQuotationStatus = async (quoteId, newStatus) => {
        setQuotations(prev => prev.map(q => q.id === quoteId ? { ...q, status: newStatus } : q));
        persistMutation('UPDATE_QUOTATION_STATUS', { quoteId, status: newStatus });
    };

    const deleteQuotation = async (quoteId) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_QUOTATION', { quoteId });
        }
        setQuotations(prev => prev.filter(q => q.id !== quoteId));
        persistMutation('DELETE_QUOTATION', { quoteId });
        return { success: true };
    };

    const duplicateQuotation = async (quote) => {
        const today = todayPKT();
        const [yyyy, mm, dd] = today.split('-');
        const newId = `BAQ-${yyyy}${mm}${dd}-${Math.floor(10 + Math.random() * 90)}`;

        const duplicated = {
            ...quote,
            id: newId,
            createdAt: today,
            status: 'Draft'
        };

        setQuotations(prev => [duplicated, ...prev]);
        persistMutation('SAVE_QUOTATION', duplicated);
    };

    const deleteSpecSheet = async (refId) => {
        const isAdmin = staffUserRef.current?.isAdmin === true;
        if (!isAdmin) {
            return await handleNonAdminDelete('DELETE_SPEC_SHEET', { refId });
        }
        setSpecSheets(prev => prev.filter(s => s.docRef !== refId));
        persistMutation('DELETE_SPEC_SHEET', { refId });
        return { success: true };
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

    const deleteStaffPermission = async (email) => {
        setStaffPermissions(prev => prev.filter(p => p.email !== email));
        try {
            const res = await fetch('/api/farm', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    action: 'DELETE_STAFF_PERMISSIONS',
                    payload: { email }
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success === false) {
                return { success: false, error: data.error || 'Failed to remove staff member.' };
            }
            return { success: true };
        } catch (err) {
            console.error('DELETE_STAFF_PERMISSIONS failed:', err);
            return { success: false, error: 'Network error — staff removal was not saved.' };
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
            feedStockItems,
            updateFeedStockItems,
            feedOpeningStock,
            setItemOpeningStock,
            feedPurchases,
            addFeedPurchase,
            deleteFeedPurchase,
            feedStockIssues,
            addFeedStockIssue,
            deleteFeedStockIssue,
            getFeedStockLedger,
            getFeedStockLots,
            getFeedStockIssueCosts,
            getCombinedFeedIssues,
            getIngredientStockPrice,
            getIngredientStockQty,
            addStockTrackedIngredient,
            mineralSplitRatio,
            setMineralSplitRatio,
            premixTypes,
            addPremixType,
            deletePremixType,
            premixFormulas,
            updatePremixFormula,
            premixBatches,
            addPremixBatch,
            deletePremixBatch,
            rationPlans,
            rationPlansV2,
            rationRows,
            rationRowItems,
            pens,
            saveRationPlan,
            duplicateRationPlan,
            deleteRationPlan,
            importRationPlanCSV,
            updateRationPlanV2,
            updateRationRow,
            savePen,
            deletePen,
            getPenRationRow,
            getPenWeightFlags,
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
            undoActivity,
            deleteWeightLog,
            updateWeightLog,
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
            sessionExpired,
            retryFailedMutation,
            dismissFailedMutation,
            staffPermissions,
            updateStaffPermission,
            deleteStaffPermission,
            pendingApprovals,
            myRequests,
            allApprovals,
            approvePendingChange,
            rejectPendingChange
        }}>
            {children}
        </FarmContext.Provider>
    );
};
