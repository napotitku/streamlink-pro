import { useState, useEffect, useCallback } from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged, User } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { auth, db } from '@/src/firebase';

export interface UseFirebaseAuthResult {
    user: User | null;
    authReady: boolean;       // true once Firebase has resolved the initial auth state
    isAuthorized: boolean;    // true if user is signed in AND in the allowedUsers allowlist
    isSigningIn: boolean;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
}

const googleProvider = new GoogleAuthProvider();

/**
 * Manages Google Sign-In and checks whether the authenticated user is in the
 * `allowedUsers/{uid}` allowlist in the Realtime Database.
 *
 * To add a new user:
 *  1. They sign in — their UID appears in Firebase Console > Authentication > Users
 *  2. In Firebase Console > Realtime Database, add: allowedUsers/<their-uid> = true
 *  No code change or redeploy needed.
 */
export const useFirebaseAuth = (): UseFirebaseAuthResult => {
    const [user, setUser] = useState<User | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isSigningIn, setIsSigningIn] = useState(false);

    const checkAuthorization = useCallback(async (firebaseUser: User) => {
        try {
            const snap = await get(ref(db, `allowedUsers/${firebaseUser.uid}`));
            setIsAuthorized(snap.val() === true);
        } catch {
            setIsAuthorized(false);
        }
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);
            if (firebaseUser) {
                await checkAuthorization(firebaseUser);
            } else {
                setIsAuthorized(false);
            }
            setAuthReady(true);
        });
        return () => unsubscribe();
    }, [checkAuthorization]);

    const signIn = useCallback(async () => {
        setIsSigningIn(true);
        try {
            await signInWithPopup(auth, googleProvider);
            // onAuthStateChanged fires automatically after sign-in
        } catch (err) {
            console.error('[FirebaseAuth] Google sign-in failed:', err);
        } finally {
            setIsSigningIn(false);
        }
    }, []);

    const signOut = useCallback(async () => {
        await firebaseSignOut(auth);
    }, []);

    return { user, authReady, isAuthorized, isSigningIn, signIn, signOut };
};
