import React, { useEffect, useRef, useState } from 'react';
import { Gift, Users, Zap } from 'lucide-react';
import { ChatMessage, HypeTrainData } from '../types';
import { TwitchIcon, YouTubeIcon } from '@/components/icons/PlatformIcons';
import { subscriptionLabel } from '@/components/MessageItem';
import { useNow } from '@/src/hooks/useNow';

/**
 * The on-stream graphics, drawn on a fixed 1920×1080 stage.
 * Used by the OBS overlay (full size) and by the dashboard's "On air" preview
 * (scaled down), so the preview always matches what viewers see.
 */

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** Accent colour for the lower-third: platform, or donation tier / sub. */
export const accentFor = (msg: ChatMessage | null): string => {
    if (!msg) return '#6366f1';
    if (msg.eventType === 'subscription' || msg.eventType === 'raid') return '#a855f7';
    if (msg.donationAmount) {
        const amount = parseFloat(msg.donationAmount.replace(/[^0-9.]/g, '') || '0');
        if (amount >= 2000) return '#dc2626';
        if (amount >= 1000) return '#9333ea';
        if (amount >= 500) return '#d97706';
        if (amount >= 200) return '#0891b2';
        return '#059669';
    }
    return msg.platform === 'twitch' ? '#9146ff' : '#ff0000';
};

const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const HypeChip: React.FC<{ data: HypeTrainData }> = ({ data }) => {
    const now = useNow(1000);
    const percent = Math.min(100, Math.floor((data.progress / Math.max(1, data.goal)) * 100));
    const secondsLeft = data.expiryDate ? Math.max(0, Math.round((new Date(data.expiryDate).getTime() - now) / 1000)) : null;

    return (
        <div className="absolute top-16 left-16 flex items-center gap-6 rounded-3xl bg-slate-950/85 border border-white/10 px-8 py-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] text-white">
            <Zap size={36} className="text-yellow-300 fill-yellow-300" />
            <div className="flex flex-col">
                <span className="text-[18px] font-black uppercase tracking-[0.2em] text-white/60">Hype Train</span>
                <span className="text-[40px] font-black leading-none italic">LVL {data.level}</span>
            </div>
            <div className="w-[320px] h-4 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#9146ff] to-yellow-300 transition-all duration-700" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-[30px] font-black font-mono tabular-nums">{percent}%</span>
            {secondsLeft !== null && (
                <span className="text-[30px] font-bold font-mono tabular-nums text-white/70">{formatClock(secondsLeft)}</span>
            )}
        </div>
    );
};

const Badge: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
    let content: React.ReactNode = null;
    if (msg.eventType === 'subscription' && msg.subscription) {
        content = <><Gift size={28} className="text-yellow-300" /> {subscriptionLabel(msg.subscription)}</>;
    } else if (msg.eventType === 'raid') {
        content = <><Users size={28} /> Raid · {msg.raidViewers ?? 0}</>;
    } else if (msg.donationAmount) {
        content = <>{msg.donationAmount}</>;
    }
    if (!content) return null;
    return (
        <span className="ml-auto shrink-0 flex items-center gap-3 rounded-full bg-black/35 border border-white/15 px-6 py-2 text-[28px] font-black uppercase tracking-wider text-white">
            {content}
        </span>
    );
};

export interface OverlaySceneProps {
    message: ChatMessage | null;
    visible: boolean;
    hypeTrain?: HypeTrainData | null;
    /** Auto-dismiss duration in seconds (0 = no countdown) and when the message went on air. */
    durationSeconds?: number;
    featuredAt?: number | null;
}

export const OverlayScene: React.FC<OverlaySceneProps> = ({ message, visible, hypeTrain, durationSeconds = 0, featuredAt }) => {
    const showCountdown = visible && !!message && durationSeconds > 0 && !!featuredAt;
    const now = useNow(200, showCountdown);
    const remaining = showCountdown ? Math.max(0, 1 - (now - featuredAt!) / (durationSeconds * 1000)) : 0;
    const accent = accentFor(message);
    const isTwitch = message?.platform === 'twitch';

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ width: STAGE_W, height: STAGE_H }}>
            {hypeTrain?.isActive && <HypeChip data={hypeTrain} />}

            <div
                className={`absolute left-16 bottom-16 w-[1500px] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${visible && message ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-16'}`}
            >
                {message && (
                    <div className="relative flex items-stretch overflow-hidden rounded-[2rem] bg-slate-950/90 border border-white/10 shadow-[0_48px_96px_-32px_rgba(0,0,0,0.85)]">
                        <div className="w-3 shrink-0" style={{ backgroundColor: accent }} />
                        <div className="shrink-0 p-7 pr-0">
                            <img
                                src={message.avatarUrl}
                                alt=""
                                className="w-28 h-28 rounded-[1.5rem] object-cover border-2 border-white/10"
                            />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-3 p-7">
                            <div className="flex items-center gap-4 min-w-0">
                                <span className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl" style={{ backgroundColor: isTwitch ? '#9146ff' : '#1f1f1f' }}>
                                    {isTwitch ? <TwitchIcon className="w-6 h-6 text-white fill-current" /> : <YouTubeIcon className="w-7 h-7" />}
                                </span>
                                <span className="text-[34px] font-black uppercase tracking-wide text-white truncate obs-text-shadow">{message.author}</span>
                                <Badge msg={message} />
                            </div>
                            <p className="text-[44px] leading-[1.25] font-semibold text-white obs-text-shadow break-words line-clamp-3">
                                {message.text}
                            </p>
                        </div>
                        {showCountdown && (
                            <div className="absolute left-0 bottom-0 h-1.5 w-full origin-left bg-white/60" style={{ transform: `scaleX(${remaining})` }} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Scales the 1920×1080 stage to fit its container.
 * `fit="width"` keeps a 16:9 box (dashboard preview); `fit="contain"` fills a fixed-size container (OBS).
 */
export const ScaledStage: React.FC<{ children: React.ReactNode; className?: string; fit?: 'width' | 'contain' }> = ({ children, className = '', fit = 'width' }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () => {
            const { width, height } = el.getBoundingClientRect();
            setScale(fit === 'width' ? width / STAGE_W : Math.min(width / STAGE_W, height / STAGE_H));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [fit]);

    return (
        <div ref={ref} className={`relative overflow-hidden ${fit === 'width' ? 'w-full aspect-video' : 'w-full h-full'} ${className}`}>
            <div className="absolute top-0 left-0 origin-top-left" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
                {children}
            </div>
        </div>
    );
};
