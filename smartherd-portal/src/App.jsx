import React, { useState, useEffect, useContext, useRef } from 'react';
import { FarmProvider, FarmContext } from './context/FarmContext';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './components/Dashboard';
import HerdRegistry from './components/HerdRegistry';
import WeightTracker from './components/WeightTracker';
import MedicalLog from './components/MedicalLog';
import TMRCalculator from './components/TMRCalculator';
import RationPlans from './components/RationPlans';
import FeedStock from './components/FeedStock';
import FeedGrowthReport from './components/FeedGrowthReport';
import RotationPlanner from './components/RotationPlanner';
import ActivityFeed from './components/ActivityFeed';
import Login from './components/Login';
import Settings from './components/Settings';
import SalesManager from './components/SalesManager';
import ListingsManager from './components/ListingsManager';
import { formatDate } from './utils/formatDate';
import { todayPKT } from './utils/dateOnly';
import { renderSettingsDiff } from './utils/renderSettingsDiff';

function AppContent() {
    const [activeTab, setActiveTab] = useState('dashboard');
    const {
        animals, logWeight, addTreatment, addAnimal, transitionAnimalStatus, fetchLoading, dbUnconfigured,
        isLoggedIn, staffUser, handleLoginSuccess, handleLogout, breedsConfig, medCategories, systemParams, quarantineProtocols,
        enquiries, pendingMutations, failedMutations, isSyncing, retryFailedMutation, dismissFailedMutation, sessionExpired,
        pendingApprovals, approvePendingChange, rejectPendingChange
    } = useContext(FarmContext);

    const isSuperAdmin = staffUser?.isAdmin === true;
    const canAccessSales = staffUser?.accessSales === true || isSuperAdmin;
    const canAccessHerd = staffUser?.accessHerd === true || isSuperAdmin;
    const isPermissionsAdmin = isSuperAdmin;

    useEffect(() => {
        const herdTabs = ['rotation', 'herd', 'weights', 'vet', 'tmr', 'rationPlans', 'feedStock', 'feedReport', 'activity'];
        if (herdTabs.includes(activeTab) && !canAccessHerd) {
            setActiveTab('dashboard');
        }
    }, [activeTab, canAccessHerd]);

    const [showSyncPanel, setShowSyncPanel] = useState(false);
    const [showMobileMore, setShowMobileMore] = useState(false);
    const [showApprovalsModal, setShowApprovalsModal] = useState(false);
    const [rejectingId, setRejectingId] = useState(null);
    const [rejectNote, setRejectNote] = useState('');
    // Auto-open the approval queue once per session the moment a super admin logs
    // in (or reloads) with at least one open request — this is the "popup on login"
    // the review workflow is built around. Only fires once so re-rendering or the
    // list shrinking as items are resolved doesn't keep forcing it back open.
    const autoOpenedApprovalsRef = useRef(false);
    useEffect(() => {
        if (isSuperAdmin && pendingApprovals.length > 0 && !autoOpenedApprovalsRef.current) {
            autoOpenedApprovalsRef.current = true;
            setShowApprovalsModal(true);
        }
    }, [isSuperAdmin, pendingApprovals.length]);

    const handleApprove = async (approval) => {
        const result = await approvePendingChange(approval);
        if (!result.success) alert(result.error || 'Could not approve request.');
    };

    const handleReject = async (approvalId) => {
        const result = await rejectPendingChange(approvalId, rejectNote.trim() || null);
        if (!result.success) alert(result.error || 'Could not reject request.');
        setRejectingId(null);
        setRejectNote('');
    };

    // Global HUD Scanner States
    const [scannedTag, setScannedTag] = useState(null);
    const [hudVisible, setHudVisible] = useState(false);
    const [hudAction, setHudAction] = useState(null); // 'weight', 'treatment', 'register'

    // Mini Form inputs state
    const [miniWeight, setMiniWeight] = useState('');
    const [miniDate, setMiniDate] = useState(todayPKT());
    const [miniMedType, setMiniMedType] = useState('');
    const [miniMedName, setMiniMedName] = useState('');
    const [miniDosage, setMiniDosage] = useState('');
    const [miniWithholding, setMiniWithholding] = useState('');

    // Register incoming forms state
    const [newBreed, setNewBreed] = useState('');
    const [newWeight, setNewWeight] = useState('');
    const [newCost, setNewCost] = useState('');
    const [newSource, setNewSource] = useState('');
    const [newStatus, setNewStatus] = useState('Quarantined');

    // References for keyboard parsing buffers
    const bufferRef = useRef('');
    const lastKeyTimeRef = useRef(0);

    // Synthesize a pleasant physical wand device beep on scan
    const playBeep = (type = 'success') => {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const audioCtx = new AudioContext();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            if (type === 'success') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
                osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.08); // high pitch chirp
                gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.22);
            } else if (type === 'new') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 note
                osc.frequency.setValueAtTime(392.00, audioCtx.currentTime + 0.1); // G4 note
                gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.3);
            }
        } catch (err) {
            console.warn('Wand beep synthesis error:', err);
        }
    };

    const triggerGlobalScan = (tag) => {
        setScannedTag(tag);
        setHudVisible(true);
        setHudAction(null); // Reset layout to standard actions
        
        // Lookup matched tag
        const matched = animals.find(a => a.rfid === tag);
        if (matched) {
            playBeep('success');
        } else {
            playBeep('new');
        }
    };

    // Global Key Listener for parsing physical Bluetooth RFID Keyboard Emulation (HID) wands
    useEffect(() => {
        const handleKeyDown = (e) => {
            const target = e.target;
            const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
            
            const now = Date.now();
            const char = e.key;
            const elapsed = now - lastKeyTimeRef.current;
            lastKeyTimeRef.current = now;

            // Physical Bluetooth HID wands stream characters at hyper-speeds (<40ms interval).
            // A slow human typing in a normal text box will exceed this limit, preventing input pollution.
            if (isInputField && elapsed > 45) {
                bufferRef.current = '';
                return;
            }

            if (char.length === 1) {
                if (elapsed > 120) {
                    bufferRef.current = ''; // Reset on normal human pause
                }
                bufferRef.current += char;
            } else if (char === 'Enter') {
                const candidate = bufferRef.current.trim();
                // Matches either standard 15-digit veterinary standards or our custom mock tag prefixes
                if (candidate.length >= 2 && (candidate.startsWith('BA-') || /^\d+$/.test(candidate))) {
                    e.preventDefault();
                    triggerGlobalScan(candidate);
                    bufferRef.current = '';
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [animals]);

    // Dynamically mount FontAwesome CSS link for rich icon renders on compile
    useEffect(() => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
        document.head.appendChild(link);
        return () => {
            document.head.removeChild(link);
        };
    }, []);

    // Render targeted sub-component depending on navigation choice
    const renderActiveComponent = () => {
        switch (activeTab) {
            case 'dashboard':
                return <Dashboard onNavigate={setActiveTab} />;
            case 'sales':
                return <SalesManager />;
            case 'enquiries':
                return <EnquiriesManager />;
            case 'listings':
                return <ListingsManager />;
            case 'herd':
                return <HerdRegistry />;
            case 'weights':
                return <WeightTracker />;
            case 'vet':
                return <MedicalLog />;
            case 'tmr':
                return <TMRCalculator />;
            case 'rationPlans':
                return <RationPlans />;
            case 'feedStock':
                return <FeedStock />;
            case 'feedReport':
                return <FeedGrowthReport />;
            case 'rotation':
                return <RotationPlanner />;
            case 'activity':
                return <ActivityFeed />;
            case 'settings':
                return <Settings />;
            default:
                return <Dashboard />;
        }
    };

    const getPageTitle = () => {
        switch (activeTab) {
            case 'dashboard': return "Operations Dashboard";
            case 'sales': return "E-Commerce Bookings & Orders";
            case 'enquiries': return "Export Enquiries (B2B)";
            case 'listings': return "Commercial Store Listings";
            case 'herd': return "Herd Registry Ledger";
            case 'weights': return "Weight & Gain Tracker";
            case 'vet': return "Medical & Vet Compliance";
            case 'tmr': return "TMR Moisture Optimizer";
            case 'rationPlans': return "Ration Plans & Pen Assignment";
            case 'feedStock': return "Feed Stock & Store Ledger";
            case 'feedReport': return "Feed Cost & Growth Report";
            case 'rotation': return "Rotation & Batch Flow";
            case 'activity': return "Activity Log";
            case 'settings': return "System Configuration Panel";
            default: return "Dashboard";
        }
    };

    if (!isLoggedIn) {
        return <Login onLoginSuccess={handleLoginSuccess} />;
    }

    // Session genuinely expired (a real 401 from the server, not just an offline
    // network blip) — block all further interaction with a full-screen sign-in
    // gate rather than a dismissible corner badge, so no one keeps working under
    // the illusion that changes are saving to the database. Nothing is lost:
    // staffUser/pendingMutations stay intact in context, so the moment they sign
    // back in, any locally-queued edits flush automatically.
    if (sessionExpired) {
        return <Login onLoginSuccess={handleLoginSuccess} reauth pendingCount={pendingMutations.length} />;
    }

    return (
        <div class="app-container">
            
            {/* 1. DESKTOP FLOATING SIDEBAR DRAWER */}
            <aside class="sidebar">
                <div class="sidebar-header" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', textAlign: 'center' }}>
                    <div className="sidebar-logo">
                        <img src="/smartherd-portal/logo_white.png?v=2" alt="BA Farms Logo" style={{ height: '120px', width: 'auto', display: 'block', margin: '0 auto' }} />
                    </div>
                    <div>
                        <span className="portal-tag" style={{ marginLeft: 0 }}>PORTAL OPERATIONS</span>
                    </div>
                </div>

                <nav class="sidebar-menu">
                    <button class={`menu-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                        <i class="fa-solid fa-chart-pie"></i> Dashboard
                    </button>

                    {(canAccessSales || isPermissionsAdmin) && (
                        <>
                            <div class="sidebar-group-label">Sales &amp; Commerce</div>
                            <button class={`menu-item ${activeTab === 'sales' ? 'active' : ''}`} onClick={() => setActiveTab('sales')}>
                                <i class="fa-solid fa-cart-shopping"></i> E-Commerce Sales
                            </button>
                            <button class={`menu-item ${activeTab === 'enquiries' ? 'active' : ''}`} onClick={() => setActiveTab('enquiries')}>
                                <i class="fa-solid fa-envelope-open-text"></i> Export Enquiries
                            </button>
                            <button class={`menu-item ${activeTab === 'listings' ? 'active' : ''}`} onClick={() => setActiveTab('listings')}>
                                <i class="fa-solid fa-store"></i> Store Listings
                            </button>
                            <a href="/quotation.html" target="_blank" class="menu-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                                <i class="fa-solid fa-file-invoice-dollar"></i> Quotation Creator
                            </a>
                            <a href="/spec-sheet.html" target="_blank" class="menu-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                                <i class="fa-solid fa-file-shield"></i> Spec Sheet Creator
                            </a>
                        </>
                    )}

                    {(canAccessHerd || isPermissionsAdmin) && (
                        <>
                            <div class="sidebar-group-label">Herd Management</div>
                            <button class={`menu-item ${activeTab === 'rotation' ? 'active' : ''}`} onClick={() => setActiveTab('rotation')}>
                                <i class="fa-solid fa-rotate"></i> Rotation Flow
                            </button>
                            <button class={`menu-item ${activeTab === 'herd' ? 'active' : ''}`} onClick={() => setActiveTab('herd')}>
                                <i class="fa-solid fa-cow"></i> Herd Registry
                            </button>
                            <button class={`menu-item ${activeTab === 'weights' ? 'active' : ''}`} onClick={() => setActiveTab('weights')}>
                                <i class="fa-solid fa-weight-scale"></i> Weight Logs
                            </button>
                            <button class={`menu-item ${activeTab === 'vet' ? 'active' : ''}`} onClick={() => setActiveTab('vet')}>
                                <i class="fa-solid fa-prescription-bottle-medical"></i> Medical Logs
                            </button>
                            <button class={`menu-item ${activeTab === 'tmr' ? 'active' : ''}`} onClick={() => setActiveTab('tmr')}>
                                <i class="fa-solid fa-scale-balanced"></i> TMR Calculator
                            </button>
                            <button class={`menu-item ${activeTab === 'rationPlans' ? 'active' : ''}`} onClick={() => setActiveTab('rationPlans')}>
                                <i class="fa-solid fa-clipboard-list"></i> Ration Plans
                            </button>
                            <button class={`menu-item ${activeTab === 'feedStock' ? 'active' : ''}`} onClick={() => setActiveTab('feedStock')}>
                                <i class="fa-solid fa-warehouse"></i> Feed Stock
                            </button>
                            <button class={`menu-item ${activeTab === 'feedReport' ? 'active' : ''}`} onClick={() => setActiveTab('feedReport')}>
                                <i class="fa-solid fa-calendar-days"></i> Feed &amp; Growth Report
                            </button>
                            <button class={`menu-item ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>
                                <i class="fa-solid fa-timeline"></i> Activity Log
                            </button>
                        </>
                    )}

                    <div class="sidebar-group-label">System</div>
                    <button class={`menu-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
                        <i class="fa-solid fa-gears"></i> System Settings
                    </button>

                    <button className="menu-item logout-btn" style={{ marginTop: '2rem', border: '1px solid rgba(220, 53, 69, 0.2)', color: 'hsl(0, 75%, 65%)' }} onClick={handleLogout}>
                        <i className="fa-solid fa-power-off" style={{ color: 'hsl(0, 75%, 65%)' }}></i> Secure Logout
                    </button>
                </nav>

                <div class="sidebar-footer">
                    <p>Agro-Complex:<br/><strong>Khurrianwala, Faisalabad</strong></p>
                    <p style={{ marginTop: '0.4rem', fontSize: '0.7rem' }}>Subsidiary of Ashraf Zia Textile Mills</p>
                </div>
            </aside>

            {/* 2. MAIN CORE VIEWS */}
            <main class="main-content">
                <header class="top-header">
                    <div class="page-title">
                        <h1>{getPageTitle()}</h1>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {/* Live Database Sync Badge */}
                        {fetchLoading ? (
                            <div className="farm-badge" style={{ borderColor: 'var(--accent-gold-glow)', color: 'var(--accent-gold)' }} title="Synchronizing state with Neon Postgres database...">
                                <i className="fa-solid fa-sync fa-spin"></i>
                                <span>Syncing...</span>
                            </div>
                        ) : !dbUnconfigured && (
                            <div className="farm-badge" style={{ borderColor: 'rgba(25, 135, 84, 0.25)', color: 'var(--primary-green-light)' }} title="Operational databases fully synchronized in real-time with Neon Postgres cloud.">
                                <i className="fa-solid fa-database"></i>
                                <span>Database: Live</span>
                            </div>
                        )}

                        {/* Offline durable queue status — never silently drop a change */}
                        {pendingMutations.length > 0 && (
                            <div className="farm-badge" style={{ borderColor: 'var(--accent-gold-glow)', color: 'var(--accent-gold)' }} title={`${pendingMutations.length} change(s) saved locally, waiting to sync to the database.`}>
                                <i className={`fa-solid ${isSyncing ? 'fa-sync fa-spin' : 'fa-cloud-arrow-up'}`}></i>
                                <span>{isSyncing ? 'Syncing' : 'Pending'} ({pendingMutations.length})</span>
                            </div>
                        )}
                        {failedMutations.length > 0 && (
                            <div
                                className="farm-badge"
                                style={{ borderColor: 'rgba(220, 53, 69, 0.4)', color: 'hsl(0, 75%, 65%)', cursor: 'pointer' }}
                                title="Some changes could not be saved to the database — click to review."
                                onClick={() => setShowSyncPanel(true)}
                            >
                                <i className="fa-solid fa-triangle-exclamation"></i>
                                <span>Sync Issues ({failedMutations.length})</span>
                            </div>
                        )}

                        {/* Super-admin review queue for staged sensitive-field edits/deletes */}
                        {isSuperAdmin && pendingApprovals.length > 0 && (
                            <div
                                className="farm-badge"
                                style={{ borderColor: 'rgba(13, 110, 253, 0.4)', color: 'hsl(211, 90%, 68%)', cursor: 'pointer' }}
                                title="Staff have staged edits/deletes awaiting your approval — click to review."
                                onClick={() => setShowApprovalsModal(true)}
                            >
                                <i className="fa-solid fa-user-shield"></i>
                                <span>Approvals ({pendingApprovals.length})</span>
                            </div>
                        )}

                        {staffUser && (
                            <div className="farm-badge staff-profile-badge" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', borderColor: 'var(--border-subtle)', background: 'rgba(255, 193, 7, 0.03)' }} title={`Authenticated via ${staffUser.provider} as ${staffUser.role}`}>
                                {staffUser.picture ? (
                                    <img src={staffUser.picture} alt={staffUser.name} style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid var(--accent-gold)' }} referrerPolicy="no-referrer" />
                                ) : (
                                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--accent-gold-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--accent-gold)' }}>
                                        <i className="fa-solid fa-user-shield" style={{ fontSize: '0.65rem', color: 'var(--accent-gold)' }}></i>
                                    </div>
                                )}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.1', minWidth: 0 }}>
                                    <span className="staff-name-text" style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-pure)' }}>{staffUser.name}</span>
                                    <span style={{ fontSize: '0.62rem', color: 'var(--accent-gold)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: '600' }}>{staffUser.role}</span>
                                </div>
                            </div>
                        )}
                        <div class="farm-badge rfid-badge-glow">
                            <span class="rfid-ping-dot"></span>
                            <i class="fa-solid fa-tower-broadcast" style={{ color: 'var(--accent-gold)' }}></i>
                            <span>RFID Wand: Linked</span>
                        </div>
                        <div class="farm-badge">
                            <i class="fa-solid fa-building-circle-check"></i>
                            <span>BA Farms Faisalabad</span>
                        </div>
                    </div>
                </header>

                <div class="page-content">
                    {renderActiveComponent()}
                </div>
            </main>

            {/* 3. MOBILE RESPONSIVE BOTTOM NAVIGATION BAR */}
            <nav className="mobile-nav-bar" style={{ padding: '0.5rem 0.15rem' }}>
                <div className="mobile-nav-menu">
                    <button className={`mobile-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                        <i className="fa-solid fa-chart-pie"></i>
                        <span>Dashboard</span>
                    </button>
                    {canAccessHerd && (
                        <button className={`mobile-nav-item ${activeTab === 'herd' ? 'active' : ''}`} onClick={() => setActiveTab('herd')}>
                            <i className="fa-solid fa-cow"></i>
                            <span>Herd</span>
                        </button>
                    )}
                    {canAccessHerd && (
                        <button className={`mobile-nav-item ${activeTab === 'tmr' ? 'active' : ''}`} onClick={() => setActiveTab('tmr')}>
                            <i className="fa-solid fa-scale-balanced"></i>
                            <span>Feed</span>
                        </button>
                    )}
                    {canAccessHerd && (
                        <button className={`mobile-nav-item ${activeTab === 'weights' ? 'active' : ''}`} onClick={() => setActiveTab('weights')}>
                            <i className="fa-solid fa-weight-scale"></i>
                            <span>Weights</span>
                        </button>
                    )}
                    {canAccessHerd && (
                        <button className={`mobile-nav-item ${activeTab === 'vet' ? 'active' : ''}`} onClick={() => setActiveTab('vet')}>
                            <i className="fa-solid fa-prescription-bottle-medical"></i>
                            <span>Vet Log</span>
                        </button>
                    )}
                    <button className="mobile-nav-item" onClick={() => setShowMobileMore(true)}>
                        <i className="fa-solid fa-ellipsis"></i>
                        <span>More</span>
                    </button>
                </div>
            </nav>

            {/* Mobile "More" drawer — surfaces every remaining section (including the
                Quotation/Spec Sheet creator tools, which otherwise have no mobile entry point) */}
            {showMobileMore && (
                <div className="mobile-more-drawer-overlay" onClick={() => setShowMobileMore(false)}>
                    <div className="rfid-hud-card glass-panel mobile-more-drawer-card" style={{ maxWidth: '360px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="rfid-hud-header">
                            <span className="hud-status-title">More Sections</span>
                            <button className="hud-close" onClick={() => setShowMobileMore(false)}>
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div className="rfid-hud-body mobile-more-drawer-body">
                            {canAccessSales && (
                                <>
                                    <div className="sidebar-group-label">Sales &amp; Commerce</div>
                                    <button className="menu-item" onClick={() => { setActiveTab('sales'); setShowMobileMore(false); }}>
                                        <i className="fa-solid fa-cart-shopping"></i> E-Commerce Sales
                                    </button>
                                    <button className="menu-item" onClick={() => { setActiveTab('enquiries'); setShowMobileMore(false); }}>
                                        <i className="fa-solid fa-envelope-open-text"></i> Export Enquiries
                                    </button>
                                    <button className="menu-item" onClick={() => { setActiveTab('listings'); setShowMobileMore(false); }}>
                                        <i className="fa-solid fa-store"></i> Store Listings
                                    </button>
                                    <a href="/quotation.html" target="_blank" className="menu-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <i className="fa-solid fa-file-invoice-dollar"></i> Quotation Creator
                                    </a>
                                    <a href="/spec-sheet.html" target="_blank" className="menu-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <i className="fa-solid fa-file-shield"></i> Spec Sheet Creator
                                    </a>
                                </>
                            )}
                            {canAccessHerd && (
                                <>
                                    <div className="sidebar-group-label">Herd Management</div>
                                    <button className="menu-item" onClick={() => { setActiveTab('rotation'); setShowMobileMore(false); }}>
                                        <i className="fa-solid fa-rotate"></i> Rotation Flow
                                    </button>
                                    <button className="menu-item" onClick={() => { setActiveTab('rationPlans'); setShowMobileMore(false); }}>
                                        <i className="fa-solid fa-clipboard-list"></i> Ration Plans
                                    </button>
                                    <button className="menu-item" onClick={() => { setActiveTab('feedStock'); setShowMobileMore(false); }}>
                                        <i className="fa-solid fa-warehouse"></i> Feed Stock
                                    </button>
                                    <button className="menu-item" onClick={() => { setActiveTab('feedReport'); setShowMobileMore(false); }}>
                                        <i className="fa-solid fa-calendar-days"></i> Feed &amp; Growth Report
                                    </button>
                                    <button className="menu-item" onClick={() => { setActiveTab('activity'); setShowMobileMore(false); }}>
                                        <i className="fa-solid fa-timeline"></i> Activity Log
                                    </button>
                                </>
                            )}
                            <div className="sidebar-group-label">System</div>
                            <button className="menu-item" onClick={() => { setActiveTab('settings'); setShowMobileMore(false); }}>
                                <i className="fa-solid fa-gears"></i> System Settings
                            </button>
                            <button className="menu-item logout-btn" style={{ border: '1px solid rgba(220, 53, 69, 0.2)', color: 'hsl(0, 75%, 65%)' }} onClick={handleLogout}>
                                <i className="fa-solid fa-power-off" style={{ color: 'hsl(0, 75%, 65%)' }}></i> Secure Logout
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 4. GLOBAL GLASSMORPHIC RFID SCANNER HUD OVERLAY */}
            {hudVisible && (
                <div class="rfid-hud-overlay">
                    <div class="rfid-hud-card glass-panel">
                        <div class="rfid-hud-header">
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <div class="rfid-radar-glow"></div>
                                <span class="hud-status-title">📶 Bluetooth RFID Wand Active</span>
                            </div>
                            <button class="hud-close" onClick={() => setHudVisible(false)}>
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <div class="rfid-hud-body">
                            <div class="rfid-code-badge">
                                <i class="fa-solid fa-microchip"></i>
                                <span>{scannedTag}</span>
                            </div>

                            {/* Render Details depending on context match */}
                            {animals.find(a => a.rfid === scannedTag) ? (
                                (() => {
                                    const animal = animals.find(a => a.rfid === scannedTag);
                                    return (
                                        <div class="hud-animal-details animate-slide-in">
                                            <div class="hud-detail-row">
                                                <span class="hud-label">Breed Category:</span>
                                                <strong class="hud-value">{animal.breed}</strong>
                                            </div>
                                            <div class="hud-detail-row">
                                                <span class="hud-label">Division Status:</span>
                                                <span class={`badge-status ${animal.status.toLowerCase()}`}>{animal.status}</span>
                                            </div>
                                            <div class="hud-detail-row">
                                                <span class="hud-label">Current Weight:</span>
                                                <strong class="hud-value" style={{ color: 'var(--text-pure)' }}>{animal.currentWeight} kg</strong>
                                            </div>
                                            <div class="hud-detail-row">
                                                <span class="hud-label">Entry Weight:</span>
                                                <span class="hud-value">{animal.entryWeight} kg</span>
                                            </div>
                                            <div class="hud-detail-row">
                                                <span class="hud-label">Total Gain:</span>
                                                <span class="hud-value" style={{ color: 'var(--primary-green-light)', fontWeight: '700' }}>
                                                    +{parseFloat((animal.currentWeight - animal.entryWeight).toFixed(1))} kg
                                                </span>
                                            </div>

                                            {/* Action selectors */}
                                            {!hudAction ? (
                                                <div class="hud-actions-grid">
                                                    <button class="btn btn-primary" onClick={() => setHudAction('weight')}>
                                                        <i class="fa-solid fa-weight-scale"></i> Log Weight
                                                    </button>
                                                    <button class="btn btn-secondary" onClick={() => setHudAction('treatment')}>
                                                        <i class="fa-solid fa-prescription-bottle-medical"></i> Log Vet Treatment
                                                    </button>
                                                    <div class="hud-status-change" style={{ gridColumn: 'span 2', display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                                        <button class="btn btn-secondary btn-block" style={{ fontSize: '0.8rem', minHeight: '36px', padding: '0.4rem', border: '1px solid var(--border-subtle)' }} onClick={() => { transitionAnimalStatus(animal.id, 'Quarantined'); setHudVisible(false); }}>
                                                            ☣️ Quarantine
                                                        </button>
                                                        <button class="btn btn-secondary btn-block" style={{ fontSize: '0.8rem', minHeight: '36px', padding: '0.4rem', border: '1px solid var(--border-subtle)' }} onClick={() => { transitionAnimalStatus(animal.id, 'Fattening'); setHudVisible(false); }}>
                                                            🌾 Fattening
                                                        </button>
                                                        <button class="btn btn-secondary btn-block" style={{ fontSize: '0.8rem', minHeight: '36px', padding: '0.4rem', border: '1px solid var(--border-subtle)', color: 'hsl(0,75%,65%)' }} onClick={() => { transitionAnimalStatus(animal.id, 'Sick'); setHudVisible(false); }}>
                                                            🩺 Sick
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : hudAction === 'weight' ? (
                                                <form class="hud-mini-form animate-slide-in" onSubmit={(e) => {
                                                    e.preventDefault();
                                                    if (!miniWeight) return;
                                                    logWeight(animal.id, miniDate, parseFloat(miniWeight));
                                                    setMiniWeight('');
                                                    setHudVisible(false);
                                                }}>
                                                    <h4 class="mini-form-title">⚖️ Record Scale Weight</h4>
                                                    <div class="form-grid-row" style={{ gap: '0.8rem', marginBottom: '0.8rem' }}>
                                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                                            <label>Scale Wt (kg)</label>
                                                            <input type="number" step="0.1" class="form-control" placeholder="e.g. 195" value={miniWeight} onChange={(e) => setMiniWeight(e.target.value)} required />
                                                        </div>
                                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                                            <label>Weighing Date</label>
                                                            <input type="date" class="form-control" value={miniDate} onChange={(e) => setMiniDate(e.target.value)} required />
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
                                                        <button type="button" class="btn btn-secondary" style={{ minHeight: '36px', padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={() => setHudAction(null)}>Back</button>
                                                        <button type="submit" class="btn btn-primary" style={{ minHeight: '36px', padding: '0.5rem 1rem', fontSize: '0.8rem' }}>Save Weight</button>
                                                    </div>
                                                </form>
                                            ) : hudAction === 'treatment' ? (
                                                <form class="hud-mini-form animate-slide-in" onSubmit={(e) => {
                                                    e.preventDefault();
                                                    if (!miniMedName || !miniDosage) return;
                                                    addTreatment(animal.id, miniDate, miniMedType || (medCategories[0] || 'Vaccination'), miniMedName, miniDosage, miniWithholding || 0);
                                                    setMiniMedName('');
                                                    setMiniDosage('');
                                                    setMiniWithholding('');
                                                    setHudVisible(false);
                                                }}>
                                                    <h4 class="mini-form-title">💊 Log Vet Treatment</h4>
                                                    <div class="form-group" style={{ marginBottom: '0.6rem' }}>
                                                        <label>Treatment Type</label>
                                                        <select class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} value={miniMedType || (medCategories[0] || 'Vaccination')} onChange={(e) => setMiniMedType(e.target.value)}>
                                                            {medCategories.map(cat => (
                                                                <option key={cat} value={cat}>{cat}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div class="form-group" style={{ marginBottom: '0.6rem' }}>
                                                        <label>Medicine / Drug Name</label>
                                                        <input type="text" class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} placeholder="e.g. FMD Vaccine, Ivermectin" value={miniMedName} onChange={(e) => setMiniMedName(e.target.value)} required />
                                                    </div>
                                                    <div class="form-grid-row" style={{ gap: '0.8rem', marginBottom: '0.8rem' }}>
                                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                                            <label>Dosage</label>
                                                            <input type="text" class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} placeholder="e.g. 5ml" value={miniDosage} onChange={(e) => setMiniDosage(e.target.value)} required />
                                                        </div>
                                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                                            <label>Withholding (Days)</label>
                                                            <input type="number" class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} placeholder="e.g. 14" value={miniWithholding} onChange={(e) => setMiniWithholding(e.target.value)} />
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
                                                        <button type="button" class="btn btn-secondary" style={{ minHeight: '36px', padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={() => setHudAction(null)}>Back</button>
                                                        <button type="submit" class="btn btn-primary" style={{ minHeight: '36px', padding: '0.5rem 1rem', fontSize: '0.8rem' }}>Save Medical</button>
                                                    </div>
                                                </form>
                                            ) : null}
                                        </div>
                                    );
                                })()
                            ) : (
                                <div class="hud-unregistered-tag animate-slide-in">
                                    <div class="unregistered-warning animate-pulse">
                                        <i class="fa-solid fa-triangle-exclamation"></i>
                                        <span>Unregistered RFID Chip Detected</span>
                                    </div>
                                    <p class="unregistered-help-text">This animal collar strap chip is not yet in the BA Farms database ledger.</p>
                                    
                                    {!hudAction ? (
                                        <button class="btn btn-primary btn-block" style={{ marginTop: '1rem' }} onClick={() => setHudAction('register')}>
                                            <i class="fa-solid fa-plus-circle"></i> Quick Register Incoming Calf
                                        </button>
                                    ) : hudAction === 'register' ? (
                                        <form class="hud-mini-form animate-slide-in" onSubmit={(e) => {
                                            e.preventDefault();
                                            if (!newWeight || !newCost) return;
                                            addAnimal({
                                                rfid: scannedTag,
                                                breed: newBreed || (breedsConfig[0]?.name || 'Sahiwal'),
                                                entryWeight: parseFloat(newWeight),
                                                purchasePrice: parseFloat(newCost),
                                                source: newSource,
                                                status: newStatus
                                            });
                                            setNewWeight('');
                                            setNewCost('');
                                            setNewSource('');
                                            setHudVisible(false);
                                        }}>
                                            <h4 class="mini-form-title">➕ Quick Register</h4>
                                            
                                            <div class="form-group" style={{ marginBottom: '0.6rem' }}>
                                                <label>Breed Selection</label>
                                                <select class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} value={newBreed || (breedsConfig[0]?.name || 'Sahiwal')} onChange={(e) => setNewBreed(e.target.value)}>
                                                    {breedsConfig.map(b => (
                                                        <option key={b.name} value={b.name}>{b.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div class="form-grid-row" style={{ gap: '0.8rem', marginBottom: '0.6rem' }}>
                                                <div class="form-group" style={{ marginBottom: 0 }}>
                                                    <label>Scale Wt (kg)</label>
                                                    <input type="number" class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} placeholder="e.g. 120" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} required />
                                                </div>
                                                <div class="form-group" style={{ marginBottom: 0 }}>
                                                    <label>Cost (PKR)</label>
                                                    <input type="number" class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} placeholder="e.g. 150000" value={newCost} onChange={(e) => setNewCost(e.target.value)} required />
                                                </div>
                                            </div>

                                            <div class="form-grid-row" style={{ gap: '0.8rem', marginBottom: '0.8rem' }}>
                                                <div class="form-group" style={{ marginBottom: 0 }}>
                                                    <label>Mandi Source</label>
                                                    <input type="text" class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} placeholder="e.g. Jhang Mandi" value={newSource} onChange={(e) => setNewSource(e.target.value)} />
                                                </div>
                                                <div class="form-group" style={{ marginBottom: 0 }}>
                                                    <label>Status</label>
                                                    <select class="form-control" style={{ minHeight: '36px', padding: '0.4rem' }} value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                                                        <option value="Quarantined">Quarantined</option>
                                                        <option value="Fattening">Fattening</option>
                                                        <option value="Sick">Sick</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
                                                <button type="button" class="btn btn-secondary" style={{ minHeight: '36px', padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={() => setHudAction(null)}>Back</button>
                                                <button type="submit" class="btn btn-primary" style={{ minHeight: '36px', padding: '0.5rem 1rem', fontSize: '0.8rem' }}>Save & Register</button>
                                            </div>
                                        </form>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Failed-sync review panel — a rejected change is never silently discarded */}
            {showSyncPanel && (
                <div class="rfid-hud-overlay" onClick={() => setShowSyncPanel(false)}>
                    <div class="rfid-hud-card glass-panel" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
                        <div class="rfid-hud-header">
                            <span class="hud-status-title">⚠️ Changes That Failed to Sync</span>
                            <button class="hud-close" onClick={() => setShowSyncPanel(false)}>
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="rfid-hud-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            {failedMutations.length === 0 ? (
                                <p class="unregistered-help-text">No sync issues.</p>
                            ) : failedMutations.map(item => (
                                <div key={item.id} class="hud-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.6rem' }}>
                                    <strong class="hud-value">{item.action}</strong>
                                    <span class="hud-label" style={{ color: 'hsl(0, 75%, 70%)' }}>{item.error}</span>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                                        <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }} onClick={() => retryFailedMutation(item.id)}>Retry</button>
                                        <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }} onClick={() => dismissFailedMutation(item.id)}>Dismiss</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Super-admin approval queue — staged sensitive-field edits (purchase price,
                entry weight) and delete requests from non-admin staff. Auto-opens on
                login when there's something to review; also reopenable via the header
                badge above at any time. */}
            {showApprovalsModal && (
                <div class="rfid-hud-overlay" onClick={() => { setShowApprovalsModal(false); setRejectingId(null); setRejectNote(''); }}>
                    <div class="rfid-hud-card glass-panel" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
                        <div class="rfid-hud-header">
                            <span class="hud-status-title">🛡️ Staff Requests Awaiting Approval</span>
                            <button class="hud-close" onClick={() => { setShowApprovalsModal(false); setRejectingId(null); setRejectNote(''); }}>
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="rfid-hud-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            {pendingApprovals.length === 0 ? (
                                <p class="unregistered-help-text">Nothing awaiting approval.</p>
                            ) : pendingApprovals.map(item => (
                                <div key={item.id} class="hud-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.6rem' }}>
                                    <strong class="hud-value">
                                        {(() => {
                                            switch (item.action) {
                                                case 'DELETE_ANIMAL': return `Delete Animal — ${item.animalRfid || 'Animal #' + item.animalId} (${item.animalBreed || '—'})`;
                                                case 'UPDATE_ANIMAL': return `Edit Animal — ${item.animalRfid || 'Animal #' + item.animalId} (${item.animalBreed || '—'})`;
                                                case 'RECORD_DEATH': return `Record Animal Death — ${item.animalRfid || 'Animal #' + item.animalId}`;
                                                case 'RECORD_SALE': return `Record Animal Sale — ${item.animalRfid || 'Animal #' + item.animalId}`;
                                                case 'ADD_FEED_PURCHASE': return `Add Feed Purchase — ID ${item.payload?.id || '—'}`;
                                                case 'DELETE_FEED_PURCHASE': return `Delete Feed Purchase — ID ${item.payload?.id || '—'}`;
                                                case 'DELETE_FEED_STOCK_ISSUE': return `Delete Feed Stock Issue — ID ${item.payload?.id || '—'}`;
                                                case 'DELETE_WEIGHT_LOG': return `Delete Weight Log — ${item.animalRfid || 'Animal #' + item.animalId}`;
                                                case 'UPDATE_WEIGHT_LOGS_BATCH': return `Update Weight History — ${item.animalRfid || 'Animal #' + item.animalId}`;
                                                case 'DELETE_TREATMENT': return `Delete Treatment — ${item.animalRfid || 'Animal #' + item.animalId}`;
                                                case 'DELETE_FEED_LOG': return `Delete Feed Log — Pen ${item.payload?.pen || 'ALL'} (${item.payload?.date || '—'})`;
                                                case 'DELETE_RATION_PLAN': return `Delete Ration Plan — ${item.previousSnapshot?.name || item.payload?.id}`;
                                                case 'DELETE_PEN': return `Delete Pen — ${item.payload?.id}`;
                                                case 'SAVE_SETTINGS': return `Master Setting Change — ${item.payload?.key || 'Setting'}`;
                                                case 'DELETE_ORDER': return `Delete Order — #${item.payload?.orderId}`;
                                                case 'DELETE_ENQUIRY': return `Delete Export Enquiry — #${item.payload?.enquiryId}`;
                                                case 'DELETE_QUOTATION': return `Delete Quotation — #${item.payload?.quoteId}`;
                                                case 'DELETE_SPEC_SHEET': return `Delete Spec Sheet — ${item.payload?.refId}`;
                                                case 'ADD_MEAT_CUT': return `Add Meat Cut — ${item.payload?.title || item.payload?.id}`;
                                                case 'UPDATE_MEAT_CUT': return `Edit Meat Cut — ${item.payload?.title || item.payload?.id}`;
                                                case 'DELETE_MEAT_CUT': return `Delete Meat Cut — ${item.previousSnapshot?.title || item.payload?.cutId}`;
                                                default: return `${item.action}`;
                                            }
                                        })()}
                                    </strong>
                                    <span class="hud-label">Requested by {item.requestedBy} · {formatDate(item.requestedAt)}</span>

                                    {(() => {
                                        const snap = item.previousSnapshot || {};
                                        const payload = item.payload || {};
                                        switch (item.action) {
                                            case 'UPDATE_ANIMAL':
                                                if (!item.payload) return null;
                                                return (
                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                        {item.payload.entryWeight !== undefined && (
                                                            <div>Entry Weight: <strong style={{ color: 'var(--text-pure)' }}>{snap.entryWeight}</strong> → <strong style={{ color: 'var(--accent-gold)' }}>{item.payload.entryWeight}</strong> kg</div>
                                                        )}
                                                        {item.payload.purchasePrice !== undefined && (
                                                            <div>Purchase Price: <strong style={{ color: 'var(--text-pure)' }}>{snap.purchasePrice?.toLocaleString()}</strong> → <strong style={{ color: 'var(--accent-gold)' }}>{item.payload.purchasePrice?.toLocaleString()}</strong> PKR</div>
                                                        )}
                                                    </div>
                                                );
                                            case 'RECORD_DEATH':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Deceased Date: {payload.deceasedDate || '—'} · Cause: {payload.deceasedCause || 'N/A'}</div>;
                                            case 'RECORD_SALE':
                                                return <div style={{ fontSize: '0.78rem', color: 'var(--accent-gold)' }}>Buyer: {payload.buyerName || 'N/A'} · Sale Price: PKR {payload.salePrice?.toLocaleString()} · Sale Date: {payload.saleDate || '—'}</div>;
                                            case 'ADD_FEED_PURCHASE':
                                                return <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Item: {payload.itemId} · Qty: {payload.quantity} kg · Rate: PKR {payload.rate}/kg · Supplier: {payload.supplier || 'N/A'}</div>;
                                            case 'SAVE_SETTINGS':
                                                return renderSettingsDiff(payload.key, payload.value, snap);
                                            case 'ADD_MEAT_CUT':
                                                return <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Title: {payload.title} · Price: PKR {payload.price}</div>;
                                            case 'UPDATE_MEAT_CUT':
                                                return <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Title: {payload.title} · New Price: PKR {payload.price}</div>;
                                            case 'DELETE_ANIMAL':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>This will permanently remove the animal and its history.</div>;
                                            case 'DELETE_FEED_PURCHASE':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Date: {snap.date || '—'} · Quantity: {snap.quantity || 0} kg · Supplier: {snap.supplier || 'N/A'} · Rate: PKR {snap.rate || 0}</div>;
                                            case 'DELETE_FEED_STOCK_ISSUE':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Date: {snap.date || '—'} · Quantity: {snap.quantity || 0} kg · Pen: {snap.pen || 'ALL'}</div>;
                                            case 'DELETE_WEIGHT_LOG':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Weight log on {snap.date}: {snap.weight} kg (ADG: {snap.adg || 0} kg/day)</div>;
                                            case 'DELETE_TREATMENT':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Treatment on {snap.date}: {snap.medicine || snap.type} (Dosage: {snap.dosage || '—'})</div>;
                                            case 'DELETE_FEED_LOG':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Feed log for {snap.date || item.payload?.date} (Pen {snap.pen || item.payload?.pen})</div>;
                                            case 'DELETE_RATION_PLAN':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Plan name: {snap.name || item.payload?.id}</div>;
                                            case 'DELETE_PEN':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Pen ID: {snap.id || item.payload?.id}</div>;
                                            case 'DELETE_ORDER':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Customer: {snap.customer_name || 'N/A'} · Total: PKR {snap.net_total || 0} · Date: {snap.date || '—'}</div>;
                                            case 'DELETE_ENQUIRY':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Customer: {snap.customer_name || snap.email || 'N/A'}</div>;
                                            case 'DELETE_QUOTATION':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Client: {snap.client_name || 'N/A'}</div>;
                                            case 'DELETE_SPEC_SHEET':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Doc Ref: {snap.doc_ref || item.payload?.refId}</div>;
                                            case 'DELETE_MEAT_CUT':
                                                return <div style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Cut: {snap.title || item.payload?.cutId}</div>;
                                            default: return null;
                                        }
                                    })()}

                                    {rejectingId === item.id ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%', marginTop: '0.3rem' }}>
                                            <input
                                                type="text"
                                                class="form-control"
                                                placeholder="Reason for rejecting (optional)"
                                                value={rejectNote}
                                                onChange={(e) => setRejectNote(e.target.value)}
                                                autoFocus
                                            />
                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }} onClick={() => { setRejectingId(null); setRejectNote(''); }}>Cancel</button>
                                                <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.35rem 0.8rem', fontSize: '0.75rem', borderColor: 'rgba(220, 53, 69, 0.4)', color: 'hsl(0, 75%, 65%)' }} onClick={() => handleReject(item.id)}>Confirm Reject</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                                            <button class="btn btn-primary" style={{ minHeight: '32px', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }} onClick={() => handleApprove(item)}>
                                                <i className="fa-solid fa-check"></i> Approve
                                            </button>
                                            <button class="btn btn-secondary" style={{ minHeight: '32px', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }} onClick={() => setRejectingId(item.id)}>
                                                <i className="fa-solid fa-xmark"></i> Reject
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

export default function App() {
    return (
        <ErrorBoundary>
            <FarmProvider>
                <AppContent />
            </FarmProvider>
        </ErrorBoundary>
    );
}
