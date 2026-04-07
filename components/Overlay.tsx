
import React, { useEffect, useState, useRef } from 'react';
import { ChatMessage, HypeTrainData } from '../types';
import { Clock, DollarSign, Gift, Zap } from 'lucide-react';
import { syncService } from '@/services/syncService';
import { TwitchIcon, YouTubeIcon } from '@/components/icons/PlatformIcons';

interface OverlayProps {
  featuredMessage: ChatMessage | null;
  hypeTrain?: HypeTrainData | null;
}

const HypeTrainWidget: React.FC<{ data: HypeTrainData }> = ({ data }) => {
  if (!data?.isActive) return null;

  const percent = Math.min(100, Math.floor((data.progress / data.goal) * 100));

  return (
    <div className="absolute top-8 right-8 flex flex-col items-end animate-in slide-in-from-right duration-700 pointer-events-auto">
      <div className="bg-[#9146FF] text-white p-6 rounded-[2rem] shadow-[0_20px_60px_-10px_rgba(145,70,255,0.6)] border border-white/20 min-w-[300px] overflow-hidden relative group">
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-200 contrast-200 mix-blend-overlay"></div>

        <div className="flex justify-between items-center mb-4 relative z-10">
          <div className="flex items-center gap-2">
            <Zap className="fill-yellow-300 text-yellow-300 animate-pulse" size={20} />
            <span className="font-black uppercase tracking-widest text-sm text-white/90">Hype Train</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="font-black text-3xl leading-none italic">LVL {data.level}</span>
          </div>
        </div>

        <div className="w-full bg-black/40 h-6 rounded-full overflow-hidden relative border border-white/10 shadow-inner">
          <div
            className="h-full bg-gradient-to-r from-yellow-300 to-yellow-500 shadow-[0_0_20px_rgba(253,224,71,0.6)] transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] relative"
            style={{ width: `${percent}%` }}
          >
            <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/80" />
          </div>
        </div>

        <div className="flex justify-between mt-2 text-xs font-bold font-mono opacity-80 uppercase tracking-wider relative z-10">
          <span>{Math.floor(percent)}%</span>
          {data.expiryDate && (
            <span className="flex items-center gap-1.5">
              <Clock size={12} />
              {Math.floor((new Date(data.expiryDate).getTime() - Date.now()) / 1000)}s
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const NumericCountdown: React.FC<{ duration: number; featuredAt: number | null }> = ({ duration, featuredAt }) => {
  const [timeLeft, setTimeLeft] = useState(duration);

  useEffect(() => {
    if (!featuredAt || duration <= 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - featuredAt) / 1000);
      const remaining = Math.max(0, duration - elapsed);
      setTimeLeft(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [duration, featuredAt]);

  if (duration <= 0 || !featuredAt) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-black/40 border border-white/10 rounded-full ml-auto backdrop-blur-md">
      <Clock size={16} className="text-white/60" />
      <span className="text-xl font-black text-white/90 font-mono tracking-widest">
        {timeLeft}s
      </span>
    </div>
  );
};

const Overlay: React.FC<OverlayProps> = ({ featuredMessage: initialMessage, hypeTrain }) => {
  const [activeMsg, setActiveMsg] = useState<ChatMessage | null>(initialMessage);
  const [isVisible, setIsVisible] = useState(false);
  const [isCloudSynced, setIsCloudSynced] = useState(false);
  const [timing, setTiming] = useState<{ duration: number; featuredAt: number | null }>({
    duration: 0,
    featuredAt: null
  });

  const fadeTimeoutRef = useRef<number | null>(null);

  const performInwardTransition = (msg: ChatMessage, duration: number, featuredAt: number | null) => {
    setActiveMsg(msg);
    setTiming({ duration, featuredAt });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    });
  };

  const handleIncomingMessage = (newMsg: ChatMessage | null, duration: number, featuredAt: number | null) => {
    if (newMsg?.id === activeMsg?.id && isVisible) return;

    if (newMsg) {
      if (isVisible) {
        setIsVisible(false);
        if (fadeTimeoutRef.current) window.clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = window.setTimeout(() => {
          performInwardTransition(newMsg, duration, featuredAt);
        }, 800);
      } else {
        performInwardTransition(newMsg, duration, featuredAt);
      }
    }
    else {
      setIsVisible(false);
      if (fadeTimeoutRef.current) window.clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = window.setTimeout(() => {
        setActiveMsg(null);
      }, 800);
    }
  };

  useEffect(() => {
    const unsubscribe = syncService.listenToFeaturedMessage((data) => {
      setIsCloudSynced(true);

      const incoming = (data && data.type === 'SET_FEATURED' && data.payload)
        ? { ...data.payload, timestamp: new Date((data.payload as any).timestamp) }
        : null;

      const duration = data?.autoDismissEnabled ? data.autoDismissSeconds : 0;
      const featuredAt = data?.featuredAt || null;

      handleIncomingMessage(incoming, duration, featuredAt);
    });

    return () => {
      unsubscribe();
      if (fadeTimeoutRef.current) window.clearTimeout(fadeTimeoutRef.current);
    };
  }, [activeMsg?.id, isVisible]);

  // if (!activeMsg && !isVisible) return null; // REMOVED: This blocked Hype Train if no message
  // Instead, we only return null if NEITHER message NOR hype train is active
  if (!activeMsg && !isVisible && (!hypeTrain || !hypeTrain.isActive)) return null;

  const isTwitch = activeMsg?.platform === 'twitch';
  let platformColor = isTwitch ? '#9046ff' : '#FF0000';

  // Donation Logic for Styling
  const donationAmount = activeMsg?.donationAmount;
  const isDonation = !!donationAmount;
  const isSubscription = activeMsg?.eventType === 'subscription';

  if (isSubscription) {
    platformColor = '#a855f77a'; // Purple-500 for subs
  }

  if (isDonation) {
    const amountVal = parseFloat(donationAmount?.replace(/[^0-9.]/g, '') || '0');
    if (amountVal >= 2000) platformColor = '#dc26267a'; // Red
    else if (amountVal >= 1000) platformColor = '#9333ea7a'; // Purple
    else if (amountVal >= 500) platformColor = '#d977067a'; // Amber
    else if (amountVal >= 200) platformColor = '#0891b27a'; // Cyan
    else platformColor = '#0596697a'; // Emerald
  }

  return (
    <div className="w-full h-full flex items-end justify-start p-16 pointer-events-none overflow-hidden relative">
      {hypeTrain && <HypeTrainWidget data={hypeTrain} />}



      {/* Container for Message */}
      <div
        className={`w-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] transform origin-left ${isVisible && activeMsg
          ? 'translate-x-0 opacity-100 scale-100 blur-0'
          : '-translate-x-20 opacity-0 scale-95 blur-md'
          }`}
      >
        <div
          className={`relative group flex items-stretch border border-white/10 rounded-[2rem] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] overflow-hidden w-full ${(!isDonation && !isSubscription) ? 'bg-slate-950/90' : ''}`}
          style={(isDonation || isSubscription) ? { backgroundColor: platformColor } : undefined}
        >

          <div
            className="w-3 shrink-0 transition-colors duration-500"
            style={{ backgroundColor: platformColor }}
          />

          <div className="flex flex-col p-8 space-y-4 flex-1 min-w-0">
            <div className="flex items-center gap-4">
              <div
                className="flex items-center justify-center p-2 rounded-xl border border-white/10 shadow-inner"
                style={(!isDonation && !isSubscription) ? { backgroundColor: platformColor } : !isTwitch ? { backgroundColor: '#FF0000' } : { backgroundColor: '#9146FF' }}
              >
                {isTwitch ? (
                  <TwitchIcon className="w-4 h-4 text-white fill-current" />
                ) : (
                  <YouTubeIcon className="w-4 h-4" />
                )}
              </div>

              <span
                className="text-2xl font-bold tracking-tight uppercase obs-text-shadow leading-none truncate text-white overflow-visible"
              >
                {activeMsg?.author}
              </span>

              {isDonation && (
                <span className="ml-auto flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/20 border border-white/10 text-white font-black text-xl tracking-widest shadow-lg">
                  <span
                    className="w-2 h-2 rounded-full animate-pulse bg-white"
                  />
                  {donationAmount}
                </span>
              )}

              {isSubscription && activeMsg?.subscription && (
                <span className="ml-auto flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/20 border border-white/10 text-white font-black text-xl tracking-widest shadow-lg">
                  <Gift className="w-6 h-6 text-yellow-400" />
                  {activeMsg.subscription.months && activeMsg.subscription.months > 1 ? `${activeMsg.subscription.months} MONTHS` : 'SUBSCRIBER'}
                </span>
              )}
            </div>

            <div className="relative pl-1">
              <p className="text-4xl font-semibold leading-snug text-white obs-text-shadow tracking-tight break-words">
                {activeMsg?.text}
              </p>
            </div>


            {!isCloudSynced && (
              <div className="absolute top-4 right-8 text-[10px] text-white/20 font-mono italic animate-pulse uppercase tracking-[0.2em]">
                Reconnecting...
              </div>
            )}
          </div>

          <div className="shrink-0 p-8 flex items-center bg-white/[0.03] border-l border-white/5">
            <img
              src={activeMsg?.avatarUrl}
              alt={activeMsg?.author}
              className="w-32 h-32 rounded-[2rem] border-2 border-white/10 shadow-2xl object-cover ring-8 ring-black/40"
            />
          </div>
        </div>
      </div>

    </div >
  );
};

export default Overlay;
