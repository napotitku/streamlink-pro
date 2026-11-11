import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, LogIn } from 'lucide-react';
import { StreamStats } from '../types';

export const QUOTA_LIMIT = 10000;
/** useTwitchAuth renews the token this long before it expires. */
const RENEW_BEFORE_MS = 10 * 60 * 1000;

const formatDuration = (ms: number): string => {
    const minutes = Math.max(0, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} h ${minutes % 60} min`;
    return `${Math.round(hours / 24)} d`;
};

type Level = 'ok' | 'warn' | 'error' | 'idle';

const dotClass: Record<Level, string> = {
    ok: 'bg-emerald-400',
    warn: 'bg-amber-400',
    error: 'bg-red-500',
    idle: 'bg-slate-600',
};

const Dot: React.FC<{ level: Level }> = ({ level }) => <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotClass[level]}`} />;

const Row: React.FC<{ level: Level; label: string; children: React.ReactNode }> = ({ level, label, children }) => (
    <div className="flex items-start justify-between gap-4 py-1.5">
        <span className="flex items-center gap-2 text-[13px] text-slate-200"><Dot level={level} />{label}</span>
        <span className={`text-right text-[12px] font-mono ${level === 'error' ? 'text-red-400' : level === 'warn' ? 'text-amber-300' : 'text-slate-400'}`}>{children}</span>
    </div>
);

interface StatusMenuProps {
    twitch: StreamStats;
    youtube: StreamStats;
    twitchChannel: string;
    youtubeConfigured: boolean;
    quotaUsage: number;
    onTwitchLogin: () => void;
    onOpenSettings: () => void;
}

const chatLevel = (s: StreamStats, configured: boolean): Level =>
    !configured ? 'idle' : s.status === 'online' ? 'ok' : s.status === 'connecting' ? 'warn' : s.status === 'error' ? 'error' : 'idle';

const StatusMenu: React.FC<StatusMenuProps> = ({ twitch, youtube, twitchChannel, youtubeConfigured, quotaUsage, onTwitchLogin, onOpenSettings }) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
    }, [open]);

    // Tokens last ~4 h and renew automatically (useTwitchAuth), so a short lifetime is normal.
    // Only a rejected login needs attention.
    const renewsIn = twitch.tokenExpiresAt ? twitch.tokenExpiresAt - RENEW_BEFORE_MS - Date.now() : null;
    const twitchConfigured = !!twitchChannel;
    const twitchChat = chatLevel(twitch, twitchConfigured);
    const loginLevel: Level = twitch.authIssue ? 'error' : !twitchConfigured ? 'idle' : 'ok';
    const ytChat = chatLevel(youtube, youtubeConfigured);
    const quotaPct = Math.min(100, (quotaUsage / QUOTA_LIMIT) * 100);
    const quotaLevel: Level = quotaPct >= 100 ? 'error' : quotaPct > 80 ? 'warn' : 'ok';

    const levels = [twitchChat, loginLevel, ytChat, youtubeConfigured ? quotaLevel : 'idle'];
    const overall: Level = levels.includes('error') ? 'error' : levels.includes('warn') ? 'warn' : levels.includes('ok') ? 'ok' : 'idle';
    const problems = levels.filter(l => l === 'error' || l === 'warn').length;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-label={problems ? `Connection status, ${problems} need attention` : 'Connection status'}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:border-slate-500 text-xs font-bold text-slate-200"
            >
                <Dot level={overall} /> Status
            </button>

            {open && (
                <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[300px] max-w-[85vw] rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl shadow-black/60">
                    <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1">Twitch</div>
                    <Row level={twitchChat} label="Chat">
                        {!twitchConfigured ? 'Not set up' : twitch.status === 'online' ? `#${twitchChannel}` : twitch.status === 'connecting' ? 'Connecting…' : (twitch.errorMessage || 'Offline')}
                    </Row>
                    <Row level={loginLevel} label="Login">
                        {twitch.authIssue === 'expired' ? 'Expired' : twitch.authIssue === 'scopes' ? 'Needs new permissions' : !twitchConfigured ? '—' : renewsIn !== null && renewsIn > 0 ? `Auto-renews in ${formatDuration(renewsIn)}` : 'Connected'}
                    </Row>
                    {(twitch.authIssue || twitch.status === 'error') && (
                        <button
                            type="button"
                            onClick={onTwitchLogin}
                            className="mt-1 mb-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#9146FF] hover:bg-[#7a2ce8] text-white text-[11px] font-bold uppercase tracking-wider"
                        >
                            <LogIn size={12} /> Reconnect Twitch
                        </button>
                    )}

                    <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mt-3 mb-1">YouTube</div>
                    <Row level={ytChat} label="Chat">
                        {!youtubeConfigured ? 'No stream set' : youtube.status === 'online' ? 'Polling' : youtube.status === 'connecting' ? (youtube.errorMessage || 'Connecting…') : (youtube.errorMessage || 'Offline')}
                    </Row>
                    <Row level={quotaLevel} label="API quota">
                        {quotaUsage.toLocaleString()} / {QUOTA_LIMIT.toLocaleString()}
                    </Row>
                    <div className="h-1.5 w-full rounded-full bg-slate-950 overflow-hidden">
                        <div className={`h-full ${quotaLevel === 'error' ? 'bg-red-500' : quotaLevel === 'warn' ? 'bg-amber-400' : 'bg-indigo-500'}`} style={{ width: `${quotaPct}%` }} />
                    </div>
                    <div className="flex justify-between mt-2 text-[11px]">
                        <button type="button" onClick={() => { setOpen(false); onOpenSettings(); }} className="text-indigo-300 hover:underline">Settings</button>
                        <a href="https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas" target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline flex items-center gap-1">
                            Quota console <ExternalLink size={10} />
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StatusMenu;
