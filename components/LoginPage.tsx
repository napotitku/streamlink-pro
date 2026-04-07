import React from 'react';
import { User } from 'firebase/auth';

interface LoginPageProps {
    onSignIn: () => void;
    user: User | null;      // signed in but not authorized
    isLoading: boolean;
}

const LoginPage: React.FC<LoginPageProps> = ({ onSignIn, user, isLoading }) => {
    return (
        <div className="h-screen w-full flex items-center justify-center bg-slate-950">
            {/* Background glow */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-3xl" />
            </div>

            <div className="relative z-10 w-full max-w-sm mx-auto px-6 flex flex-col items-center gap-8 text-center">
                {/* Logo */}
                <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 2H3v16h5v4l4-4h5l4-4V2z" />
                            <line x1="9" y1="9" x2="9" y2="9.01" />
                            <line x1="12" y1="9" x2="12" y2="9.01" />
                            <line x1="15" y1="9" x2="15" y2="9.01" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-white tracking-tight">Streamlink Pro</h1>
                        <p className="text-slate-500 text-sm mt-0.5">Broadcaster Dashboard</p>
                    </div>
                </div>

                {/* Card */}
                <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4 shadow-xl">
                    {user ? (
                        /* Signed in but not in allowlist */
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-white font-semibold">Access Restricted</p>
                                <p className="text-slate-400 text-sm mt-1 leading-relaxed">
                                    <span className="text-slate-300 font-medium">{user.email}</span> is not on the allowlist.
                                    Ask the admin to add your account.
                                </p>
                            </div>
                            <button
                                onClick={onSignIn}
                                className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                Try a different account
                            </button>
                        </div>
                    ) : (
                        /* Not signed in */
                        <>
                            <p className="text-slate-400 text-sm leading-relaxed">
                                Sign in with your Google account to access the broadcaster dashboard.
                            </p>
                            <button
                                onClick={onSignIn}
                                disabled={isLoading}
                                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold rounded-xl px-4 py-3 transition-all duration-150 shadow-sm"
                            >
                                {isLoading ? (
                                    <svg className="animate-spin w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                    </svg>
                                ) : (
                                    /* Google logo */
                                    <svg viewBox="0 0 24 24" width="20" height="20">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                    </svg>
                                )}
                                Sign in with Google
                            </button>
                        </>
                    )}
                </div>

                <p className="text-slate-600 text-xs">
                    Access is restricted to authorized broadcasters only.
                </p>
            </div>
        </div>
    );
};

export default LoginPage;
