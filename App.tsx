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

const App: React.FC = () => {
  const location = useLocation();
  const { settings, setSettings, quotaUsage, setQuotaUsage, incrementQuota } = useAppSettings();
  const { user, authReady, isAuthorized, signIn, signOut } = useFirebaseAuth();

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
    updateStats,
    broadcastFeatured
  } = useMessageStore(settings);

  const { twitchClient, youtubeClient, hypeTrain, simulateHypeTrain } = useChatConnection({
    settings,
    addMessage,
    updateStats,
    incrementQuota,
    // Only mark auth ready for writes when the user is actually authorized (or it's the overlay)
    authReady: authReady && (isOverlay || isAuthorized),
    readOnly: isOverlay
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showLaunchPrompt, setShowLaunchPrompt] = useState(false);
  const autoDismissTimerRef = useRef<number | null>(null);



  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (messageState.featuredMessage) {
          markAsRead(messageState.featuredMessage.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [messageState.featuredMessage, markAsRead]);

  // Keep a ref to settings to access fresh values inside timeouts
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Auto-dismiss logic
  useEffect(() => {
    if (autoDismissTimerRef.current) {
      window.clearTimeout(autoDismissTimerRef.current);
    }

    if (messageState.featuredMessage) {
      // Determine duration: Use global setting for overlay dismissal (pinnedDuration is for Pinned Widget only)
      const durationSeconds = settings.autoDismissSeconds;

      // Only set timer if enabled OR if it's a donation (donations usually have fixed expiry, but let's respect the master toggle)
      // User asked: "turn off auto-dismissal options... message still gets dismissed".
      // So if master toggle is off, nothing should auto-dismiss.
      if (settings.autoDismissEnabled) {
        autoDismissTimerRef.current = window.setTimeout(() => {
          // Double check: ensure master toggle is still on and message is still featured
          if (settingsRef.current.autoDismissEnabled && messageState.featuredMessage) {
            markAsRead(messageState.featuredMessage.id);
          }
        }, durationSeconds * 1000);
      }
    }

    return () => {
      if (autoDismissTimerRef.current) window.clearTimeout(autoDismissTimerRef.current);
    };
  }, [messageState.featuredMessage, settings.autoDismissEnabled, settings.autoDismissSeconds, markAsRead]);

  // Clear featured on home page load
  useEffect(() => {
    if (location.pathname === '/') {
      broadcastFeatured(null);
    }
  }, [location.pathname, broadcastFeatured]);

  // Launch prompt logic
  useEffect(() => {
    if (settings.youtubeApiKey && !settings.youtubeVideoId && location.pathname === '/') {
      setShowLaunchPrompt(true);
    }
  }, [settings.youtubeApiKey, settings.youtubeVideoId, location.pathname]);

  // Handle Twitch OAuth Redirect - Handled by AuthHandler route now
  // We keep this clear just in case, but real logic is in AuthHandler
  useEffect(() => {
    // If we happen to be on root but hash has token (rare race condition), AuthHandler might pick it up via wildcard dispatch
    // but just to be safe, we let router handle it.
  }, []);

  // Auto-fetch Twitch Username if we have a token but no channel name (e.g. from .env)
  useEffect(() => {
    if (settings.twitchAccessToken && !settings.twitchChannel) {
      const clientId = settings.twitchClientId || import.meta.env.VITE_TWITCH_CLIENT_ID;

      // We need a client ID to make requests
      if (!clientId) return;

      console.log("App: Token present but no channel name. Attempting to fetch user details...");

      // Clean token (remove oauth: prefix if present)
      const cleanToken = settings.twitchAccessToken.replace(/^oauth:/i, '');

      fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${cleanToken}`
        }
      })
        .then(res => {
          if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`);
          return res.json();
        })
        .then(data => {
          if (data.data && data.data.length > 0) {
            const user = data.data[0];
            console.log("App: Auto-fetched user:", user.login);

            setSettings(prev => ({
              ...prev,
              twitchChannel: user.login
            }));
          }
        })
        .catch(err => {
          console.warn("App: Could not auto-fetch Twitch username:", err);
        });
    }
  }, [settings.twitchAccessToken, settings.twitchChannel, settings.twitchClientId, setSettings]);

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
      text: isGift ? "Just gifted a sub to RandomUser!" : "Just subscribed! Love the content!",
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
        gifter: isGift ? "KindGiffter_88" : null
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
    const clientId = settings.twitchClientId || import.meta.env.VITE_TWITCH_CLIENT_ID;
    if (!clientId) {
      alert("Missing Twitch Client ID. Please configure it in .env first.");
      return;
    }
    const redirectUri = window.location.origin;
    const scopes = "chat:read chat:edit channel:read:hype_train channel:read:subscriptions";
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scopes)}`;
    window.location.href = authUrl;
  }, [settings.twitchClientId]);

  return (
    <>
      {/* Auth gate: loading splash or login page for non-overlay routes */}
      {!isOverlay && !authReady && (
        <div className="h-screen w-full bg-slate-950" />
      )}
      {!isOverlay && authReady && (!user || !isAuthorized) && (
        <LoginPage onSignIn={signIn} user={user} isLoading={false} />
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
              onClearFeatured={clearFeatured}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onTwitchLogin={handleTwitchLogin}
            />
          }
        />
        <Route
          path="/overlay"
          element={
            <Overlay featuredMessage={messageState.featuredMessage} hypeTrain={settings.showHypeTrain ? hypeTrain : null} />
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
