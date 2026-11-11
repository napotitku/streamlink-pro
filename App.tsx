import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { ChatMessage, Platform } from './types';
import Dashboard from './components/Dashboard';
import Overlay from './components/Overlay';
import SettingsModal from './components/SettingsModal';
import LoginPage from './components/LoginPage';
import { Play, Info } from 'lucide-react';
import { useAppSettings } from '@/src/hooks/useAppSettings';
import { useMessageStore } from '@/src/hooks/useMessageStore';
import { useChatConnection } from '@/src/hooks/useChatConnection';
import { useFirebaseAuth } from '@/src/hooks/useFirebaseAuth';
import AuthHandler from './components/AuthHandler';
import { startTwitchLogin } from '@/src/twitchAuth';
import { validateTwitchToken } from '@/services/twitchService';

const App: React.FC = () => {
  const location = useLocation();
  const { settings, setSettings, quotaUsage, setQuotaUsage, incrementQuota } = useAppSettings();
  const { user, authReady, isAuthorized, isSigningIn, signIn, signOut } = useFirebaseAuth();

  const isOverlay = location.pathname.includes('/overlay');

  // All hooks must be called unconditionally — auth gating happens in the return below.
  const {
    state: messageState,
    addMessage,
    markAsRead,
    clearFeatured,
    featureMessage,
    markAsTrashed,
    toggleInteresting,
    toggleQueued,
    updateStats,
    applyModeration,
    updateAvatars
  } = useMessageStore(settings, { restoreFeatured: !isOverlay });

  const { twitchClient, youtubeClient, hypeTrain, simulateHypeTrain } = useChatConnection({
    settings,
    addMessage,
    updateStats,
    incrementQuota,
    // Only mark auth ready for writes when the user is actually authorized (or it's the overlay)
    authReady: authReady && (isOverlay || isAuthorized),
    readOnly: isOverlay,
    onModeration: applyModeration,
    onAvatars: updateAvatars
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showLaunchPrompt, setShowLaunchPrompt] = useState(false);
  const autoDismissTimerRef = useRef<number | null>(null);




  // Keep a ref to settings to access fresh values inside timeouts
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Auto-dismiss logic
  useEffect(() => {
    if (autoDismissTimerRef.current) {
      window.clearTimeout(autoDismissTimerRef.current);
    }

    if (messageState.featuredMessage) {
      // The master toggle controls all auto-dismissal (pinnedDuration is only for the Pinned widget).
      // Count from when the message went on air, so a message restored after a reload keeps its timing.
      const startedAt = messageState.featuredMessage.featuredAt ?? Date.now();
      const delay = Math.max(0, startedAt + settings.autoDismissSeconds * 1000 - Date.now());
      if (settings.autoDismissEnabled) {
        autoDismissTimerRef.current = window.setTimeout(() => {
          // Double check: ensure master toggle is still on and message is still featured
          if (settingsRef.current.autoDismissEnabled && messageState.featuredMessage) {
            markAsRead(messageState.featuredMessage.id);
          }
        }, delay);
      }
    }

    return () => {
      if (autoDismissTimerRef.current) window.clearTimeout(autoDismissTimerRef.current);
    };
  }, [messageState.featuredMessage, settings.autoDismissEnabled, settings.autoDismissSeconds, markAsRead]);

  // When nothing is on air, the next queued message goes on air.
  useEffect(() => {
    if (isOverlay || messageState.featuredMessage || messageState.queue.length === 0) return;
    featureMessage(messageState.queue[0]);
  }, [isOverlay, messageState.featuredMessage, messageState.queue, featureMessage]);

  // Launch prompt logic
  useEffect(() => {
    if (settings.youtubeApiKey && !settings.youtubeVideoId && location.pathname === '/') {
      setShowLaunchPrompt(true);
    }
  }, [settings.youtubeApiKey, settings.youtubeVideoId, location.pathname]);

  // Logged in but no channel set (e.g. it was cleared in Settings): use the login's own channel.
  useEffect(() => {
    if (!settings.twitchAccessToken || settings.twitchChannel) return;
    validateTwitchToken(settings.twitchAccessToken)
      .then(info => { if (info) setSettings(prev => ({ ...prev, twitchChannel: info.login })); })
      .catch(() => { /* offline — the Twitch client reports it */ });
  }, [settings.twitchAccessToken, settings.twitchChannel, setSettings]);

  const triggerTestMessages = useCallback(() => {
    const dummyNames = ["CyberPunk_2077", "StreamGod", "PixelViper", "GlitchMaster", "NebulaKnight", "EchoAlpha"];
    const dummyTexts = [
      "Can you show that camera setting again? Looks sick!",
      "Hype in the chat! Let's goooo 🚀🚀🚀",
      "Which GPU are you using for this stream?",
      "Just joined, what did I miss?",
      "Is that a custom keyboard? Sounds really thocky.",
      "LUL that was a close one, almost died there!"
    ];

    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const platform = Math.random() > 0.5 ? 'twitch' : 'youtube';
        const author = dummyNames[Math.floor(Math.random() * dummyNames.length)];
        const text = dummyTexts[Math.floor(Math.random() * dummyTexts.length)];

        const msg: ChatMessage = {
          id: Math.random().toString(36).substring(7),
          author,
          text,
          platform: platform as Platform,
          timestamp: new Date(),
          isRead: false,
          isFeatured: false,
          avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${author}`,
          authorColor: platform === 'twitch' ? '#bf94ff' : '#ff4d4d',
          isFirstMessage: Math.random() > 0.8
        };
        addMessage(msg);
      }, i * 400);
    }
  }, [addMessage]);

  const simulateDonation = useCallback((amount: string, color: string, duration: number) => {
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      author: "SuperFan_99",
      text: "Keep up the great work! Here is some support for the stream! 💖",
      platform: 'youtube',
      timestamp: new Date(),
      isRead: false,
      isFeatured: false,
      avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=SuperFan_99`,
      authorColor: color,
      donationAmount: amount, // e.g. "500 CZK"
      pinnedDuration: duration,
      pinnedAt: Date.now()
    };
    addMessage(msg);
  }, [addMessage]);

  const simulateSubscription = useCallback((plan: string, months: number, isGift: boolean) => {
    // Check if subscriptions are enabled in settings
    if (!settings.showSubscriptions) return;

    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      author: isGift ? "KindGiffter_88" : "NewSubscriber_01",
      text: isGift ? "KindGiffter_88 gifted 5 Tier 1 subs to the community!" : "Just subscribed! Love the content!",
      platform: 'twitch',
      timestamp: new Date(),
      isRead: false,
      isFeatured: false,
      avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${isGift ? "KindGiffter_88" : "NewSubscriber_01"}`,
      authorColor: '#9146FF',
      eventType: 'subscription',
      subscription: {
        plan,
        months,
        isGift,
        gifter: isGift ? "KindGiffter_88" : null,
        giftCount: isGift ? 5 : undefined
      }
    };
    addMessage(msg);
    setIsSettingsOpen(false); // Close settings to show the alert
  }, [addMessage, settings.showSubscriptions]);

  const handleSimulateHypeTrain = useCallback(() => {
    // Check if Hype Train is enabled in settings
    if (!settings.showHypeTrain) return;

    simulateHypeTrain({
      id: "simulated-hype-train",
      level: Math.floor(Math.random() * 5) + 1,
      progress: 750,
      goal: 1000,
      total: 1750,
      isActive: true,
      expiryDate: new Date(Date.now() + 60000)
    });
    // Removed auto-end timeout to keep the train visible indefinitely for testing
    setIsSettingsOpen(false); // Close settings to show the widget
  }, [simulateHypeTrain, settings.showHypeTrain]);

  // Merge state for Dashboard
  const dashboardState = {
    ...messageState,
    settings,
    quotaUsage
  };

  const handleTwitchLogin = useCallback(() => {
    if (!startTwitchLogin(settings.twitchClientId)) {
      alert("Missing Twitch Client ID. Set VITE_TWITCH_CLIENT_ID in .env first.");
    }
  }, [settings.twitchClientId]);

  return (
    <>
      {/* Auth gate: loading splash or login page for non-overlay routes */}
      {!isOverlay && !authReady && (
        <div className="h-screen w-full bg-slate-950" />
      )}
      {!isOverlay && authReady && (!user || !isAuthorized) && (
        <LoginPage onSignIn={signIn} user={user} isLoading={isSigningIn} />
      )}
      {/* Main app — rendered when authorized or on the overlay route */}
      {(isOverlay || (authReady && isAuthorized)) && (
    <div className={`h-screen w-full flex flex-col overflow-hidden ${location.pathname.includes('overlay') ? 'bg-transparent' : 'bg-slate-950'}`}>
      <Routes>
        <Route
          path="/"
          element={
            <Dashboard
              state={dashboardState}
              hypeTrain={settings.showHypeTrain ? hypeTrain : null}
              onFeature={featureMessage}
              onMarkRead={markAsRead}
              onMarkTrash={markAsTrashed}
              onToggleInteresting={toggleInteresting}
              onToggleQueue={toggleQueued}
              onClearFeatured={clearFeatured}
              shortcutsEnabled={!isSettingsOpen && !showLaunchPrompt}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onTwitchLogin={handleTwitchLogin}
            />
          }
        />
        <Route
          path="/overlay"
          element={
            <Overlay hypeTrain={settings.showHypeTrain ? hypeTrain : null} />
          }
        />
        {/* Catch-all for Twitch OAuth redirect which HashRouter sees as a path starting with access_token */}
        <Route path="*" element={<AuthHandler />} />
      </Routes>

      {showLaunchPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-300">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center">
                {/* Official YouTube icon — must not be modified per YouTube Branding Guidelines */}
                <svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" fill="#FF0000"/>
                  <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FFFFFF"/>
                </svg>
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight">Launch Stream</h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                Enter your YouTube stream link or ID to connect.
              </p>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <input
                  autoFocus
                  type="text"
                  placeholder="YouTube Studio URL or ID..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-all font-medium pr-12"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setSettings({ ...settings, youtubeVideoId: (e.target as HTMLInputElement).value });
                      setShowLaunchPrompt(false);
                    }
                  }}
                />
                <button
                  onClick={(e) => {
                    const input = (e.currentTarget.previousSibling as HTMLInputElement);
                    setSettings({ ...settings, youtubeVideoId: input.value });
                    setShowLaunchPrompt(false);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all"
                >
                  <Play size={20} fill="currentColor" />
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setShowLaunchPrompt(false)}
                className="text-slate-500 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors"
              >
                Skip YouTube
              </button>
              <button
                onClick={() => { setShowLaunchPrompt(false); setIsSettingsOpen(true); }}
                className="text-indigo-400 hover:text-indigo-300 text-xs font-bold uppercase tracking-widest transition-colors"
              >
                Edit Config
              </button>
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          currentQuota={quotaUsage}
          onTriggerTest={triggerTestMessages}
          onSave={(newSettings, manualQuota) => {
            setSettings(newSettings);
            if (manualQuota !== undefined) setQuotaUsage(manualQuota);
            setIsSettingsOpen(false);
          }}
          onClose={() => setIsSettingsOpen(false)}
          onSimulateDonation={simulateDonation}
          onSimulateHypeTrain={handleSimulateHypeTrain}
          onSimulateSubscription={simulateSubscription}
        />
      )}
    </div>
      )}
    </>
  );
};

export default App;
