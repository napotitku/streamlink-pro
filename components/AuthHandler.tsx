import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { readTwitchRedirect } from '@/src/twitchAuth';
import { validateTwitchToken } from '@/services/twitchService';
import { Loader2 } from 'lucide-react';

/**
 * Catch-all route. Twitch's implicit-grant redirect lands on `/#access_token=…`,
 * which HashRouter reads as the path `/access_token=…`, so it ends up here.
 */
const AuthHandler: React.FC = () => {
    const navigate = useNavigate();
    const { setSettings } = useAppSettings();
    const processedRef = useRef(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Prevent double processing in StrictMode
        if (processedRef.current) return;
        processedRef.current = true;

        const result = readTwitchRedirect();
        if (result.kind === 'none') {
            navigate('/', { replace: true });
            return;
        }
        if (result.kind === 'error') {
            setError(result.message);
            return;
        }

        validateTwitchToken(result.token)
            .then(info => {
                if (!info) throw new Error('Twitch did not accept the new login.');
                setSettings(prev => ({
                    ...prev,
                    twitchAccessToken: result.token,
                    twitchChannel: info.login,
                }));
                navigate('/', { replace: true });
            })
            .catch((err: Error) => setError(err.message || 'Could not verify the Twitch login.'));
    }, [setSettings, navigate]);

    return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-950 text-white space-y-4 p-6 text-center">
            {error ? (
                <>
                    <h2 className="text-xl font-bold">Twitch login failed</h2>
                    <p className="text-slate-400 max-w-md">{error}</p>
                    <button
                        onClick={() => navigate('/', { replace: true })}
                        className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold text-sm"
                    >
                        Back to dashboard
                    </button>
                </>
            ) : (
                <>
                    <Loader2 size={48} className="animate-spin text-[#9146FF]" />
                    <h2 className="text-xl font-bold">Verifying Twitch login…</h2>
                </>
            )}
        </div>
    );
};

export default AuthHandler;
