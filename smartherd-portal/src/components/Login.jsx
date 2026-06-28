import React, { useState, useEffect, useRef } from 'react';

// Pure client-side base64url JWT decoder to parse Google ID Tokens
const parseJwt = (token) => {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("Failed to parse Google JWT token:", e);
        return null;
    }
};

export default function Login({ onLoginSuccess }) {
    // Multi-state indicators
    const [authError, setAuthError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Dynamic Google button mount reference
    const googleBtnRef = useRef(null);

    // Synthesize scan/success beep sounds for physical feedback
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
            } else if (type === 'error') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(220, audioCtx.currentTime); // A3 low buzz
                osc.frequency.setValueAtTime(140, audioCtx.currentTime + 0.12);
                gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.35);
            }
        } catch (err) {
            console.warn("Sound synth blocked or unsupported:", err);
        }
    };

    // Parse environment list of allowed admin emails
    const getAdminEmails = () => {
        const envVal = import.meta.env.VITE_ADMIN_EMAILS;
        if (!envVal) return ['bilalashrafshk@gmail.com'];
        return envVal.split(',').map(email => email.trim().toLowerCase());
    };

    // Parse environment list of allowed evaluator/guest emails
    const getAllowedEmails = () => {
        const envVal = import.meta.env.VITE_ALLOWED_EMAILS;
        if (!envVal) return ['guest@gmail.com'];
        return envVal.split(',').map(email => email.trim().toLowerCase());
    };

    // Verify logged-in staff email against biosecurity protocols
    const verifyAndAuthorizeEmail = (email) => {
        const cleaned = email.toLowerCase().trim();
        
        // 1. Grant immediate access to all corporate BA Farms/BA Foods domain emails
        if (cleaned.endsWith('@bafarms.com.pk') || cleaned.endsWith('@bafoods.pk')) {
            return { authorized: true, role: 'Internal Corporate Staff' };
        }

        // 2. Grant access to explicitly whitelisted admin emails
        const adminEmails = getAdminEmails();
        if (adminEmails.includes(cleaned)) {
            return { authorized: true, role: 'Internal Corporate Staff' };
        }

        // 3. Grant access to explicitly whitelisted evaluator/guest emails from Vercel/Vite env
        const whitelisted = getAllowedEmails();
        if (whitelisted.includes(cleaned)) {
            return { authorized: true, role: 'External Guest/Evaluator' };
        }

        return { authorized: false };
    };

    // Handle Google OAuth successful ticket verification
    const handleGoogleCallback = async (response) => {
        setIsLoading(true);
        setAuthError('');

        // Decode Google JWT payload directly in front-end
        const payload = parseJwt(response.credential);
        
        if (!payload || !payload.email) {
            setAuthError("Google authentication failed. ID token was malformed.");
            playBeep('error');
            setIsLoading(false);
            return;
        }

        // Simulate database lookup delay for premium UX
        setTimeout(() => {
            const authResult = verifyAndAuthorizeEmail(payload.email);

            if (authResult.authorized) {
                const userSession = {
                    name: payload.name,
                    email: payload.email,
                    picture: payload.picture,
                    role: authResult.role,
                    provider: 'Google'
                };
                playBeep('success');
                onLoginSuccess(userSession);
            } else {
                setAuthError(`Access Denied: Email "${payload.email}" is not registered in the staff database directory. Configure VITE_ALLOWED_EMAILS in Vercel to allow access.`);
                playBeep('error');
                setIsLoading(false);
            }
        }, 1200);
    };

    // Initialize Google OneTap & Button mounting
    useEffect(() => {
        if (!window.google) {
            // Retry loading GSI script after a brief wait if async loading is delayed
            const timer = setTimeout(() => {
                if (window.google) mountGoogleButton();
            }, 1000);
            return () => clearTimeout(timer);
        }
        mountGoogleButton();
    }, []);

    const mountGoogleButton = () => {
        try {
            const client_id = import.meta.env.VITE_GOOGLE_CLIENT_ID || '375836248906-mockgoogleclientid.apps.googleusercontent.com';
            
            window.google.accounts.id.initialize({
                client_id: client_id,
                callback: handleGoogleCallback,
                auto_select: false,
                cancel_on_tap_outside: true,
            });

            if (googleBtnRef.current) {
                window.google.accounts.id.renderButton(googleBtnRef.current, {
                    theme: 'filled_black',
                    size: 'large',
                    shape: 'pill',
                    text: 'signin_with',
                    width: googleBtnRef.current.clientWidth || 320,
                });
            }
        } catch (err) {
            console.error("Error initializing Google login client:", err);
        }
    };

    return (
        <div className="login-wrapper">
            {/* Background glowing particles */}
            <div className="glow-circle glow-circle-green"></div>
            <div className="glow-circle glow-circle-gold"></div>

            <div className="login-card glass-panel animate-scale-up" style={{ textAlign: 'center' }}>
                
                {/* Brand Branding Header */}
                <div className="login-logo-header" style={{ marginBottom: '2.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <img src="logo_white.png?v=2" alt="BA Farms Logo" style={{ height: '220px', width: 'auto', display: 'block', margin: '0 auto 1rem auto' }} />
                    <span className="portal-tag">STAFF OPERATIONS</span>
                </div>

                {isLoading ? (
                    <div className="login-loading-state" style={{ padding: '2rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: '2.2rem', color: 'var(--accent-gold)' }}></i>
                        <span style={{ fontSize: '0.92rem', color: 'var(--text-muted)', fontWeight: '600' }}>Verifying Credentials...</span>
                    </div>
                ) : (
                    <>
                        <p className="login-instructions" style={{ marginBottom: '2.2rem' }}>
                            Access to the internal herd registry, RFID trace ledgers, and feed formulations is restricted to authorized staff only. Sign in with your registered Google account to continue.
                        </p>

                        {/* Authentication errors panel */}
                        {authError && (
                            <div className="login-error-alert animate-shake" style={{ textAlign: 'left', marginBottom: '2rem' }}>
                                <i className="fa-solid fa-triangle-exclamation"></i>
                                <span>{authError}</span>
                            </div>
                        )}

                        {/* Google OAuth GSI Button mount */}
                        <div className="google-btn-wrapper" style={{ margin: '1rem 0 0.5rem' }}>
                            <div ref={googleBtnRef} className="google-btn-mount"></div>
                        </div>
                    </>
                )}

            </div>
        </div>
    );
}
