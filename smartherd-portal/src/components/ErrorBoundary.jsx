import React from 'react';
import { clearDispensableCaches } from '../utils/safeStorage';

// Last line of defense: without this, any uncaught render error anywhere in the
// tree unmounts the whole app and leaves a blank/black screen with zero
// indication of what happened ("black page of death"). This catches that,
// shows what broke, and gives staff a way to recover (reload) without losing
// locally-queued changes, which stay intact in localStorage regardless.
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('Uncaught render error:', error, info?.componentStack);
        if (error && (String(error?.message || '').toLowerCase().includes('quota') || String(error?.name || '').toLowerCase().includes('quota'))) {
            try {
                clearDispensableCaches();
                if (typeof window !== 'undefined' && window.localStorage) {
                    window.localStorage.removeItem('ba_failed_mutations');
                }
            } catch (_) {}
        }
    }

    handleClearCacheAndReload = () => {
        try {
            clearDispensableCaches();
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.removeItem('ba_failed_mutations');
            }
        } catch (_) {}
        window.location.reload();
    };

    render() {
        if (this.state.error) {
            const isStorageError = String(this.state.error?.message || '').toLowerCase().includes('quota') ||
                String(this.state.error?.message || '').toLowerCase().includes('storage') ||
                String(this.state.error?.name || '').toLowerCase().includes('quota');

            return (
                <div style={{
                    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#0b0d0f', color: '#f0f0f0', padding: '2rem', textAlign: 'center'
                }}>
                    <div style={{ maxWidth: '480px' }}>
                        <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '2.2rem', color: 'hsl(0, 75%, 60%)', marginBottom: '1rem' }}></i>
                        <h2 style={{ margin: '0 0 0.6rem' }}>{isStorageError ? 'Storage Quota Exceeded' : 'Something went wrong'}</h2>
                        <p style={{ color: '#a0a0a0', fontSize: '0.9rem', marginBottom: '1.2rem' }}>
                            {isStorageError
                                ? "The portal's local cache exceeded browser storage limits. We have automatically freed up storage space so you can reload safely."
                                : "The portal hit an unexpected error and couldn't continue rendering. Your locally-saved data is safe. Reloading usually fixes this."
                            }
                        </p>
                        <pre style={{
                            textAlign: 'left', fontSize: '0.72rem', color: 'hsl(0, 75%, 70%)', background: 'rgba(255,255,255,0.04)',
                            padding: '0.8rem', borderRadius: '8px', overflowX: 'auto', marginBottom: '1.2rem'
                        }}>{this.state.error?.message || String(this.state.error)}</pre>
                        <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                            {isStorageError ? (
                                <button
                                    onClick={this.handleClearCacheAndReload}
                                    style={{
                                        background: 'hsl(45, 90%, 55%)', color: '#111', border: 'none', borderRadius: '8px',
                                        padding: '0.7rem 1.4rem', fontWeight: '700', cursor: 'pointer', fontSize: '0.9rem'
                                    }}
                                >
                                    Clear Cache & Reload
                                </button>
                            ) : (
                                <button
                                    onClick={() => window.location.reload()}
                                    style={{
                                        background: 'hsl(45, 90%, 55%)', color: '#111', border: 'none', borderRadius: '8px',
                                        padding: '0.7rem 1.4rem', fontWeight: '700', cursor: 'pointer', fontSize: '0.9rem'
                                    }}
                                >
                                    Reload Portal
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
