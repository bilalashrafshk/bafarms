import React, { useState, useEffect, useRef } from 'react';

export default function Login({ onLoginSuccess, reauth = false, pendingCount = 0 }) {
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

    // Hand the Google ID token to the server for verification. The server checks the
    // token's signature against Google's public keys and checks the email against the
    // staff allowlist — the client is never trusted to make that call itself.
    const handleGoogleCallback = async (response) => {
        setIsLoading(true);
        setAuthError('');

        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential })
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.success) {
                setAuthError(data.error || 'Google authentication failed. Please try again.');
                playBeep('error');
                setIsLoading(false);
                return;
            }

            playBeep('success');
            onLoginSuccess({ ...data.user, token: data.token });
        } catch (err) {
            console.error('Login request failed:', err);
            setAuthError('Could not reach the authentication server. Check your connection and try again.');
            playBeep('error');
            setIsLoading(false);
        }
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
                    <img src="/smartherd-portal/logo_white.png?v=2" alt="BA Farms Logo" style={{ height: '220px', width: 'auto', display: 'block', margin: '0 auto 1rem auto' }} />
                    <span className="portal-tag">{reauth ? 'SESSION EXPIRED' : 'STAFF OPERATIONS'}</span>
                </div>

                {isLoading ? (
                    <div className="login-loading-state" style={{ padding: '2rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: '2.2rem', color: 'var(--accent-gold)' }}></i>
                        <span style={{ fontSize: '0.92rem', color: 'var(--text-muted)', fontWeight: '600' }}>Verifying Credentials...</span>
                    </div>
                ) : (
                    <>
                        <p className="login-instructions" style={{ marginBottom: '2.2rem' }}>
                            {reauth
                                ? `You've been signed out for security after a period away. ${pendingCount > 0 ? `Don't worry — ${pendingCount} unsaved change${pendingCount === 1 ? '' : 's'} ${pendingCount === 1 ? 'is' : 'are'} saved safely on this device and will sync automatically the moment you sign back in. ` : ''}Please sign in again to continue.`
                                : 'Access to the internal herd registry, RFID trace ledgers, and feed formulations is restricted to authorized staff only. Sign in with your registered Google account to continue.'}
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
