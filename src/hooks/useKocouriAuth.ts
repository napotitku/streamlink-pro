import { useCallback, useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, User } from 'firebase/auth';
import { kocouriAuth } from '@/services/kocouriService';

export interface KocouriAuth {
    /** Signed in to Kocouří díra (a second Firebase app, project `kocouri-web`). */
    user: User | null;
    busy: boolean;
    error: string | null;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
}

const describe = (err: unknown): string | null => {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
    if (code === 'auth/unauthorized-domain') return `${window.location.hostname} isn't an authorized domain in the kocouri-web Firebase project.`;
    if (code === 'auth/popup-blocked') return 'The browser blocked the sign-in window.';
    return (err as Error)?.message || 'Sign-in failed.';
};

/**
 * Sign-in to Kocouří díra with Google, for reading a live stream's thread. Separate from the
 * dashboard's own sign-in; Firebase keeps it across reloads. Off in the overlay (`enabled`).
 */
export const useKocouriAuth = (enabled: boolean): KocouriAuth => {
    const [user, setUser] = useState<User | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) return;
        return onAuthStateChanged(kocouriAuth(), setUser);
    }, [enabled]);

    const signIn = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            await signInWithPopup(kocouriAuth(), new GoogleAuthProvider());
        } catch (err) {
            console.error('[Kocouří díra] sign-in failed:', err);
            setError(describe(err));
        } finally {
            setBusy(false);
        }
    }, []);

    const signOut = useCallback(async () => {
        setError(null);
        await firebaseSignOut(kocouriAuth());
    }, []);

    return { user, busy, error, signIn, signOut };
};
