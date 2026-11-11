import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Check, Copy, Layers, Settings, X, Zap } from 'lucide-react';
import { AppState, ChatMessage, HypeTrainData, StreamStats } from '../types';
import MessageItem from './MessageItem';
import { PinnedMessagesWidget } from './PinnedMessagesWidget';
import StatusMenu from './StatusMenu';
import { OverlayScene, ScaledStage } from './OverlayScene';
import { TwitchIcon, YouTubeIcon } from './icons/PlatformIcons';
import { useNow } from '@/src/hooks/useNow';

interface DashboardProps {
  state: AppState;
  hypeTrain?: HypeTrainData | null;
  /** False while a modal is open, so typing doesn't trigger shortcuts. */
  shortcutsEnabled: boolean;
  onFeature: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkTrash: (id: string) => void;
  onToggleInteresting: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onClearFeatured: () => void;
  onOpenSettings: () => void;
  onTwitchLogin: () => void;
}

type Filter = 'all' | 'unread' | 'money' | 'subs' | 'starred';

const FILTERS: { id: Filter; label: string; test: (m: ChatMessage) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'unread', label: 'Unread', test: m => !m.isRead },
  { id: 'money', label: 'Money', test: m => !!m.donationAmount },
  { id: 'subs', label: 'Subs & raids', test: m => m.eventType === 'subscription' || m.eventType === 'raid' },
  { id: 'starred', label: 'Starred', test: m => !!m.isInteresting },
];

const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// ── Top bar ──────────────────────────────────────────────────────────────────

const ViewerPill: React.FC<{ platform: 'twitch' | 'youtube'; stats: StreamStats; configured: boolean }> = ({ platform, stats, configured }) => {
  const isTwitch = platform === 'twitch';
  const live = isTwitch ? !!stats.isLive : stats.status === 'online';
  const unknown = !configured || !!stats.authIssue || (isTwitch ? stats.status === 'error' && !stats.isLive : stats.status !== 'online');
  return (
    <div className="flex items-center gap-2.5 pl-2.5 pr-3 py-1.5 rounded-xl border border-slate-800 bg-slate-950" title={stats.title || undefined}>
      {isTwitch ? <TwitchIcon className="w-3.5 h-3.5 text-[#a970ff] fill-current" /> : <YouTubeIcon className="w-4 h-4" />}
      <span className={`w-2 h-2 rounded-full ${live ? 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.25)]' : 'bg-slate-600'}`} aria-label={live ? 'Live' : 'Offline'} />
      <span className={`font-mono font-bold text-[15px] tabular-nums ${live ? 'text-white' : 'text-slate-500'}`}>
        {unknown ? '—' : stats.viewers.toLocaleString()}
      </span>
      <span className="text-[11px] text-slate-500">viewers</span>
    </div>
  );
};

// ── Side panel pieces ───────────────────────────────────────────────────────

const SectionHeading: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
    <span className="flex items-center gap-2">{children}</span>
    {right}
  </div>
);

const OnAirPanel: React.FC<{
  featured: ChatMessage | null;
  hypeTrain?: HypeTrainData | null;
  autoDismissEnabled: boolean;
  autoDismissSeconds: number;
  onClear: () => void;
}> = ({ featured, hypeTrain, autoDismissEnabled, autoDismissSeconds, onClear }) => {
  // Keep the last message around so the preview can animate it out.
  const [shown, setShown] = useState<ChatMessage | null>(featured);
  useEffect(() => { if (featured) setShown(featured); }, [featured]);

  const counting = !!featured && autoDismissEnabled && !!featured.featuredAt;
  const now = useNow(250, counting);
  const secondsLeft = counting ? Math.max(0, Math.ceil((featured!.featuredAt! + autoDismissSeconds * 1000 - now) / 1000)) : null;

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading right={
        <span className="font-mono normal-case tracking-normal text-[11px] text-slate-400">
          {featured ? (secondsLeft !== null ? `${secondsLeft} s left` : 'until dismissed') : 'idle'}
        </span>
      }>
        <span className={`flex items-center gap-1.5 ${featured ? 'text-red-400' : ''}`}>
          <span className={`w-2 h-2 rounded-full ${featured ? 'bg-red-500 animate-pulse motion-reduce:animate-none' : 'bg-slate-600'}`} />
          On air
        </span>
      </SectionHeading>

      <ScaledStage className="rounded-xl border border-slate-800 bg-[radial-gradient(120%_90%_at_75%_20%,#2b3a55_0%,#161b2a_45%,#0b0d14_100%)]">
        <OverlayScene
          message={shown}
          visible={!!featured}
          hypeTrain={hypeTrain}
          durationSeconds={autoDismissEnabled ? autoDismissSeconds : 0}
          featuredAt={featured?.featuredAt ?? null}
        />
        {!featured && !hypeTrain?.isActive && (
          <div className="absolute inset-0 flex items-center justify-center text-[56px] font-semibold text-white/25 text-center px-40">
            Nothing on air. Click a message or press Enter.
          </div>
        )}
      </ScaledStage>

      <button
        type="button"
        onClick={onClear}
        disabled={!featured}
        className="self-start px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-bold text-slate-200 hover:border-red-500/60 hover:text-red-300 disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-slate-200"
      >
        Take off air · Esc
      </button>
    </div>
  );
};

const QueuePanel: React.FC<{ queue: ChatMessage[]; onRemove: (id: string) => void }> = ({ queue, onRemove }) => (
  <div className="flex flex-col gap-2">
    <SectionHeading right={<span className="normal-case tracking-normal font-mono text-[11px] text-slate-400">{queue.length ? `${queue.length} queued` : ''}</span>}>
      Up next
    </SectionHeading>
    {queue.length === 0 ? (
      <p className="text-xs text-slate-500 leading-relaxed">Press <kbd className="kbd">Q</kbd> on a message to line it up. It goes on air when the current one ends.</p>
    ) : (
      <ol className="flex flex-col gap-1.5">
        {queue.map((m, i) => (
          <li key={m.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed border-slate-700 text-[13px] min-w-0">
            <span className="font-mono text-[11px] text-slate-500">{i + 1}</span>
            <b className="shrink-0 text-slate-100">{m.author}</b>
            <span className="truncate text-slate-400 min-w-0">{m.text}</span>
            <button type="button" onClick={() => onRemove(m.id)} aria-label={`Remove ${m.author} from queue`} className="ml-auto shrink-0 p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800">
              <X size={12} />
            </button>
          </li>
        ))}
      </ol>
    )}
  </div>
);

const HypeTrainCard: React.FC<{ data: HypeTrainData }> = ({ data }) => {
  const now = useNow(1000);
  const percent = Math.min(100, Math.floor((data.progress / Math.max(1, data.goal)) * 100));
  const secondsLeft = data.expiryDate ? Math.max(0, Math.round((new Date(data.expiryDate).getTime() - now) / 1000)) : null;
  return (
    <div className="rounded-xl border border-purple-500/35 bg-purple-500/[0.06] p-3.5 flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <Zap size={14} className="text-yellow-300 fill-yellow-300 self-center" />
          <span className="font-black text-lg italic text-white">Hype Train</span>
          <span className="text-xs font-bold text-slate-400">LVL {data.level}</span>
          {data.isTest && <span className="text-[9px] font-black uppercase tracking-wider text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">Test</span>}
        </span>
        {secondsLeft !== null && <span className="font-mono font-bold text-purple-300 tabular-nums">{formatClock(secondsLeft)}</span>}
      </div>
      <div className="h-2 rounded-full bg-slate-950 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-[#7b5cff] to-[#a970ff] transition-all duration-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex justify-between text-[11px] font-mono text-slate-400">
        <span>{data.progress.toLocaleString()} / {data.goal.toLocaleString()} to LVL {data.level + 1}</span>
        <span>{percent}%</span>
      </div>
    </div>
  );
};

// ── Dashboard ────────────────────────────────────────────────────────────────

const isTypingTarget = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  return !!node && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
};

const Dashboard: React.FC<DashboardProps> = ({
  state, hypeTrain, shortcutsEnabled,
  onFeature, onMarkRead, onMarkTrash, onToggleInteresting, onToggleQueue, onClearFeatured, onOpenSettings, onTwitchLogin,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { settings } = state;

  const visible = useMemo(() => state.messages.filter(FILTERS.find(f => f.id === filter)!.test), [state.messages, filter]);
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.id, state.messages.filter(f.test).length])) as Record<Filter, number>,
    [state.messages]
  );
  const queuePositions = useMemo(() => new Map(state.queue.map((id, i) => [id, i + 1])), [state.queue]);
  const queuedMessages = useMemo(
    () => state.queue.map(id => state.messages.find(m => m.id === id)).filter((m): m is ChatMessage => !!m),
    [state.queue, state.messages]
  );

  const copyOverlayUrl = () => {
    const url = `${window.location.origin}${window.location.pathname}#/overlay`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => window.prompt('Copy the overlay link:', url));
  };

  const scrollToMessage = useCallback((id: string, highlight = false) => {
    let index = visible.findIndex(m => m.id === id);
    if (index === -1 && highlight) {
      setFilter('all');
      index = state.messages.findIndex(m => m.id === id);
    }
    if (index === -1) return;
    virtuosoRef.current?.scrollIntoView({ index, behavior: 'smooth' });
    if (highlight) setSelectedId(id);
  }, [visible, state.messages]);

  // Keyboard: J/K move, Enter on air, Q queue, S star, D done, Esc take off air.
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const index = selectedId ? visible.findIndex(m => m.id === selectedId) : -1;
      const selected = index >= 0 ? visible[index] : null;

      const move = (delta: number) => {
        if (!visible.length) return;
        const next = Math.min(visible.length - 1, Math.max(0, index === -1 ? 0 : index + delta));
        setSelectedId(visible[next].id);
        virtuosoRef.current?.scrollIntoView({ index: next });
      };

      switch (key) {
        case 'j': case 'arrowdown': e.preventDefault(); move(1); return;
        case 'k': case 'arrowup': e.preventDefault(); move(-1); return;
        case 'escape': if (state.featuredMessage) { e.preventDefault(); onClearFeatured(); } return;
      }
      if (!selected) return;
      switch (key) {
        case 'enter': e.preventDefault(); selected.isFeatured ? onMarkRead(selected.id) : onFeature(selected.id); return;
        case 'q': e.preventDefault(); onToggleQueue(selected.id); return;
        case 's': e.preventDefault(); onToggleInteresting(selected.id); return;
        case 'd': e.preventDefault(); onMarkTrash(selected.id); move(1); return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsEnabled, visible, selectedId, state.featuredMessage, onFeature, onMarkRead, onToggleQueue, onToggleInteresting, onMarkTrash, onClearFeatured]);

  const twitchConfigured = !!settings.twitchChannel;
  const youtubeConfigured = !!(settings.youtubeApiKey && settings.youtubeVideoId);
  const needsTwitchLogin = twitchConfigured && (!!state.stats.twitch.authIssue || !settings.twitchAccessToken);

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-slate-800 bg-slate-900/80">
        <div className="flex items-center gap-2 mr-2 font-black text-[17px] tracking-tight">
          <span className="relative w-6 h-6 rounded-md bg-indigo-500"><span className="absolute inset-[7px] rounded-full bg-slate-950" /></span>
          StreamLink
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewerPill platform="twitch" stats={state.stats.twitch} configured={twitchConfigured} />
          <ViewerPill platform="youtube" stats={state.stats.youtube} configured={youtubeConfigured} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {needsTwitchLogin && (
            <button type="button" onClick={onTwitchLogin} className="px-3 py-1.5 rounded-lg bg-[#9146FF] hover:bg-[#7a2ce8] text-white text-xs font-bold">
              {settings.twitchAccessToken ? 'Reconnect Twitch' : 'Log in to Twitch'}
            </button>
          )}
          <StatusMenu
            twitch={state.stats.twitch}
            youtube={state.stats.youtube}
            twitchChannel={settings.twitchChannel}
            youtubeConfigured={youtubeConfigured}
            quotaUsage={state.quotaUsage}
            onTwitchLogin={onTwitchLogin}
            onOpenSettings={onOpenSettings}
          />
          <button
            type="button"
            onClick={copyOverlayUrl}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${copied ? 'border-emerald-500 text-emerald-300 bg-emerald-500/10' : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500'}`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Overlay link'}
          </button>
          <button type="button" onClick={onOpenSettings} aria-label="Settings" className="p-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-500">
            <Settings size={15} />
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Feed */}
        <section className="flex-1 flex flex-col min-h-0 min-w-0 lg:border-r border-slate-800">
          <nav className="flex gap-1 px-3 py-2 border-b border-slate-800 overflow-x-auto" aria-label="Feed filters">
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${filter === f.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {f.label}<span className="ml-1.5 font-mono text-[11px] text-slate-500">{counts[f.id]}</span>
              </button>
            ))}
          </nav>

          {state.messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 text-slate-500">
              <Layers size={36} className="opacity-30" />
              <p className="text-base font-bold text-slate-300">No messages yet</p>
              <p className="text-sm max-w-xs">
                {twitchConfigured || youtubeConfigured
                  ? 'Chat shows up here as soon as someone writes.'
                  : 'Log in to Twitch or add a YouTube stream in Settings to start.'}
              </p>
              {!twitchConfigured && !youtubeConfigured && (
                <button type="button" onClick={onOpenSettings} className="mt-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold">Open settings</button>
              )}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500">Nothing in this filter yet.</div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              className="flex-1 custom-scrollbar"
              style={{ flex: '1 1 auto', minHeight: 0 }}
              data={visible}
              computeItemKey={(_i, m) => m.id}
              itemContent={(_i, msg) => (
                <div className="px-2 py-0.5">
                  <MessageItem
                    message={msg}
                    isSelected={msg.id === selectedId}
                    queuePosition={queuePositions.get(msg.id)}
                    onFeature={(id) => { setSelectedId(id); onFeature(id); }}
                    onMarkRead={onMarkRead}
                    onMarkTrash={onMarkTrash}
                    onToggleInteresting={onToggleInteresting}
                    onToggleQueue={onToggleQueue}
                  />
                </div>
              )}
            />
          )}

          <footer className="hidden md:flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-t border-slate-800 text-[11px] text-slate-500">
            <span><kbd className="kbd">J</kbd><kbd className="kbd">K</kbd> move</span>
            <span><kbd className="kbd">Enter</kbd> put on air</span>
            <span><kbd className="kbd">Q</kbd> queue</span>
            <span><kbd className="kbd">S</kbd> star</span>
            <span><kbd className="kbd">D</kbd> done</span>
            <span><kbd className="kbd">Esc</kbd> take off air</span>
            <span className="ml-auto">Right-click to star</span>
          </footer>
        </section>

        {/* Side panel */}
        <aside className="flex flex-col gap-6 p-4 bg-slate-900/50 overflow-y-auto custom-scrollbar min-w-0 max-h-[45vh] lg:max-h-none border-t lg:border-t-0 border-slate-800">
          <OnAirPanel
            featured={state.featuredMessage}
            hypeTrain={hypeTrain}
            autoDismissEnabled={settings.autoDismissEnabled}
            autoDismissSeconds={settings.autoDismissSeconds}
            onClear={onClearFeatured}
          />
          <QueuePanel queue={queuedMessages} onRemove={onToggleQueue} />
          {hypeTrain?.isActive && <HypeTrainCard data={hypeTrain} />}
          <PinnedMessagesWidget messages={state.messages} onMessageClick={(id) => scrollToMessage(id, true)} />
        </aside>
      </main>
    </div>
  );
};

export default Dashboard;
