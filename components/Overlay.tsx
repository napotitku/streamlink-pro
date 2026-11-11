import React, { useEffect, useRef, useState } from 'react';
import { ChatMessage, HypeTrainData } from '../types';
import { syncService } from '@/services/syncService';
import { OverlayScene, ScaledStage } from '@/components/OverlayScene';

interface OverlayProps {
  hypeTrain?: HypeTrainData | null;
}

const FADE_MS = 800;

/**
 * OBS browser source. Reads `currentComment` and `hypeTrain` from Firebase only:
 * no login, no chat connections. The stage scales to the browser source size.
 */
const Overlay: React.FC<OverlayProps> = ({ hypeTrain }) => {
  const [activeMsg, setActiveMsg] = useState<ChatMessage | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isCloudSynced, setIsCloudSynced] = useState(false);
  const [timing, setTiming] = useState<{ duration: number; featuredAt: number | null }>({ duration: 0, featuredAt: null });

  const fadeTimeoutRef = useRef<number | null>(null);
  // Latest values for the Firebase callback, which is registered once.
  const current = useRef({ activeId: null as string | null, isVisible: false });
  current.current = { activeId: activeMsg?.id ?? null, isVisible };

  useEffect(() => {
    const showMessage = (msg: ChatMessage, duration: number, featuredAt: number | null) => {
      setActiveMsg(msg);
      setTiming({ duration, featuredAt });
      // Two frames so the element mounts hidden before it transitions in.
      requestAnimationFrame(() => requestAnimationFrame(() => setIsVisible(true)));
    };

    const unsubscribe = syncService.listenToFeaturedMessage((data) => {
      setIsCloudSynced(true);

      const incoming: ChatMessage | null = (data && data.type === 'SET_FEATURED' && data.payload)
        ? { ...data.payload, timestamp: new Date((data.payload as any).timestamp) }
        : null;
      const duration = data?.autoDismissEnabled ? data.autoDismissSeconds : 0;
      const featuredAt = data?.featuredAt || null;
      const { activeId, isVisible: visibleNow } = current.current;

      if (fadeTimeoutRef.current) window.clearTimeout(fadeTimeoutRef.current);

      if (incoming) {
        if (incoming.id === activeId && visibleNow) {
          setTiming({ duration, featuredAt });
          return;
        }
        if (visibleNow) {
          setIsVisible(false);
          fadeTimeoutRef.current = window.setTimeout(() => showMessage(incoming, duration, featuredAt), FADE_MS);
        } else {
          showMessage(incoming, duration, featuredAt);
        }
      } else {
        setIsVisible(false);
        fadeTimeoutRef.current = window.setTimeout(() => setActiveMsg(null), FADE_MS);
      }
    });

    return () => {
      unsubscribe();
      if (fadeTimeoutRef.current) window.clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  return (
    <div className="w-full h-full bg-transparent">
      <ScaledStage fit="contain">
        <OverlayScene
          message={activeMsg}
          visible={isVisible}
          hypeTrain={hypeTrain}
          durationSeconds={timing.duration}
          featuredAt={timing.featuredAt}
        />
      </ScaledStage>
      {!isCloudSynced && (
        <div className="fixed top-3 right-4 text-[10px] text-white/30 font-mono uppercase tracking-[0.2em] animate-pulse">
          Connecting…
        </div>
      )}
    </div>
  );
};

export default Overlay;
