
import React, { useState } from 'react';
import { AppSettings } from '../types';
import { startTwitchLogin } from '@/src/twitchAuth';
import { X, Save, Key, Twitch, Info, ShieldCheck, Beaker, Clock, Radio, Settings, Zap, Star, LogIn, LogOut } from 'lucide-react';

interface SettingsModalProps {
  settings: AppSettings;
  currentQuota: number;
  onTriggerTest: () => void;
  onSave: (settings: AppSettings, manualQuota?: number) => void;
  onClose: () => void;
  onSimulateDonation?: (amount: string, color: string, duration: number) => void;
  onSimulateHypeTrain?: () => void;
  onSimulateSubscription?: (plan: string, months: number, isGift: boolean) => void;
}

type Tab = 'stream' | 'interaction' | 'dev';

const SettingsModal: React.FC<SettingsModalProps> = ({ settings, currentQuota, onTriggerTest, onSave, onClose, onSimulateDonation, onSimulateHypeTrain, onSimulateSubscription }) => {
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [manualQuota, setManualQuota] = useState<number>(currentQuota);
  const [activeTab, setActiveTab] = useState<Tab>('stream');

  const formatCurrency = (amount: number, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'stream', label: 'Stream', icon: <Radio size={16} /> },
    { id: 'interaction', label: 'Interactions', icon: <Clock size={16} /> },
    { id: 'dev', label: 'Developer', icon: <Beaker size={16} /> },
  ];

  const handleTwitchLogin = () => {
    if (!startTwitchLogin(formData.twitchClientId)) {
      alert("Missing Twitch Client ID. Set VITE_TWITCH_CLIENT_ID in .env first.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
          <h2 className="text-xl font-black text-white flex items-center gap-3 tracking-tight">
            <div className="p-2 bg-indigo-600 rounded-lg">
              {/* Added missing 'Settings' icon from lucide-react */}
              <Settings size={20} className="text-white" />
            </div>
            DASHBOARD SETTINGS
          </h2>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-full transition-all">
            <X size={24} />
          </button>
        </header>

        {/* Tab Navigation */}
        <nav className="flex px-6 bg-slate-950/30 border-b border-slate-800/50">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-4 text-xs font-black uppercase tracking-widest transition-all border-b-2 ${activeTab === tab.id
                ? 'text-indigo-400 border-indigo-500 bg-indigo-500/5'
                : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-white/5'
                }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 p-8 space-y-6 custom-scrollbar overflow-y-auto bg-slate-900">
          {activeTab === 'stream' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-300">
              {/* Twitch Config */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-purple-400 font-black text-xs uppercase tracking-widest">
                  <Twitch size={16} /> Twitch Feed
                </div>

                {/* Connection Status / Logout */}
                <div className="pt-2">
                  <div className="flex items-center justify-between bg-slate-950/50 border border-slate-800 rounded-xl p-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${formData.twitchAccessToken ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`}></div>
                      <div className="flex flex-col">
                        <span className="text-white text-xs font-bold">
                          {formData.twitchAccessToken
                            ? `Connected as ${formData.twitchChannel || 'User'}`
                            : 'Not Connected'}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {formData.twitchAccessToken
                            ? 'Log in with the broadcaster account to get the Hype Train'
                            : 'Log in with Twitch to read chat'}
                        </span>
                      </div>
                    </div>
                    {formData.twitchAccessToken ? (
                      <button
                        onClick={() => setFormData({ ...formData, twitchAccessToken: '', twitchChannel: '' })}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
                        title="Log out and clear stored token"
                      >
                        <LogOut size={12} /> Log Out
                      </button>
                    ) : (
                      <button
                        onClick={handleTwitchLogin}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#9146FF] hover:bg-[#7a2ce8] text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shadow-lg shadow-purple-900/20 active:scale-95"
                      >
                        <LogIn size={12} /> Connect
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="h-px bg-slate-800/50" />

              {/* YouTube Config */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-red-500 font-black text-xs uppercase tracking-widest">
                  {/* Official YouTube icon — must not be modified per YouTube Branding Guidelines */}
                  <svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" fill="#FF0000"/>
                    <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FFFFFF"/>
                  </svg> YouTube Feed
                </div>
                <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider ml-1 flex items-center gap-1.5">
                      Stream Video ID or Link
                      <span title="Paste the full URL of your live stream or just the 11-character ID.">
                        <Info size={12} className="text-slate-600" />
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. dQw4w9WgXcQ"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white placeholder:text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
                      value={formData.youtubeVideoId}
                      onChange={e => setFormData({ ...formData, youtubeVideoId: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'interaction' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-300">
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-indigo-400 font-black text-xs uppercase tracking-widest">
                  <Clock size={16} /> Auto-Dismiss Features
                </div>

                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-6 space-y-6 shadow-inner">
                  {/* Hype Train Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-200 font-black tracking-tight flex items-center gap-2">
                        <Zap size={14} className="text-yellow-400 fill-current" />
                        Show Hype Train
                      </span>
                      <p className="text-[11px] text-slate-500 leading-relaxed max-w-[280px]">Display Hype Train progress widget in dashboard and overlay.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={formData.showHypeTrain}
                        onChange={e => setFormData({ ...formData, showHypeTrain: e.target.checked })}
                      />
                      <div className="w-12 h-7 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:start-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 shadow-lg"></div>
                    </label>
                  </div>

                  {/* Subscriptions Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-200 font-black tracking-tight flex items-center gap-2">
                        <Star size={14} className="text-purple-400 fill-current" />
                        Show Subscriptions
                      </span>
                      <p className="text-[11px] text-slate-500 leading-relaxed max-w-[280px]">Display subscription notifications in the chat feed.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={formData.showSubscriptions}
                        onChange={e => setFormData({ ...formData, showSubscriptions: e.target.checked })}
                      />
                      <div className="w-12 h-7 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:start-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 shadow-lg"></div>
                    </label>
                  </div>

                  <div className="h-px bg-slate-800/50" />

                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-200 font-black tracking-tight">Enable Timer</span>
                      <p className="text-[11px] text-slate-500 leading-relaxed max-w-[280px]">Automatically dismisses featured comments after the specified duration.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={formData.autoDismissEnabled}
                        onChange={e => setFormData({ ...formData, autoDismissEnabled: e.target.checked })}
                      />
                      <div className="w-12 h-7 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:start-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 shadow-lg"></div>
                    </label>
                  </div>

                  {formData.autoDismissEnabled && (
                    <div className="space-y-4 pt-4 border-t border-slate-800/50 animate-in slide-in-from-top-4 duration-300">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.1em]">Visibility Duration</label>
                        <span className="text-lg font-mono font-black text-indigo-400">
                          {formData.autoDismissSeconds}<span className="text-xs ml-0.5 text-slate-600">s</span>
                        </span>
                      </div>
                      <input
                        type="range"
                        min="3"
                        max="60"
                        step="1"
                        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        value={formData.autoDismissSeconds}
                        onChange={e => setFormData({ ...formData, autoDismissSeconds: parseInt(e.target.value, 10) })}
                      />
                      <div className="flex justify-between text-[9px] font-bold text-slate-600 uppercase tracking-widest px-1">
                        <span>3s</span>
                        <span>30s</span>
                        <span>60s</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dev' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-300">
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-slate-500 font-black text-xs uppercase tracking-widest">
                  <ShieldCheck size={16} /> Debug & Simulation tools
                </div>

                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-6 space-y-6">

                  <div className="flex items-center justify-between gap-6">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-200 font-black tracking-tight">Chat Simulation</span>
                      <p className="text-[11px] text-slate-500 leading-relaxed">Push test messages into the live feed.</p>
                    </div>
                    <button
                      onClick={onTriggerTest}
                      className="shrink-0 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-black uppercase tracking-widest rounded-xl border border-slate-700 transition-all active:scale-95 shadow-md"
                    >
                      GENERATE FEED
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-6">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-200 font-black tracking-tight">Hype Train Simulation</span>
                      <p className="text-[11px] text-slate-500 leading-relaxed">Trigger a fake Hype Train event.</p>
                    </div>
                    {onSimulateHypeTrain && (
                      <button
                        onClick={onSimulateHypeTrain}
                        className="shrink-0 px-5 py-2.5 bg-yellow-900/20 hover:bg-yellow-900/30 text-yellow-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-yellow-500/30 transition-all active:scale-95 shadow-md"
                      >
                        Start Train
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-200 font-black tracking-tight">Donation Simulation</span>
                      <p className="text-[11px] text-slate-500 leading-relaxed">Test different donation tiers.</p>
                    </div>
                    {onSimulateDonation && (
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => onSimulateDonation("50 CZK", "#10B981", 60)} className="flex-1 px-3 py-2 bg-emerald-900/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-emerald-900/40 transition-all">50 CZK</button>
                        <button onClick={() => onSimulateDonation("200 CZK", "#06B6D4", 120)} className="flex-1 px-3 py-2 bg-cyan-900/20 text-cyan-400 border border-cyan-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-cyan-900/40 transition-all">200 CZK</button>
                        <button onClick={() => onSimulateDonation("500 CZK", "#F59E0B", 300)} className="flex-1 px-3 py-2 bg-amber-900/20 text-amber-400 border border-amber-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-amber-900/40 transition-all">500 CZK</button>
                        <button onClick={() => onSimulateDonation("1000 CZK", "#A855F7", 600)} className="flex-1 px-3 py-2 bg-purple-900/20 text-purple-400 border border-purple-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-purple-900/40 transition-all">1k CZK</button>
                        <button onClick={() => onSimulateDonation("2000 CZK", "#EF4444", 1800)} className="flex-1 px-3 py-2 bg-red-900/20 text-red-400 border border-red-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-red-900/40 transition-all">2k CZK</button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-200 font-black tracking-tight">Subscription Simulation</span>
                      <p className="text-[11px] text-slate-500 leading-relaxed">Test subscription tiers and gifts.</p>
                    </div>
                    {onSimulateSubscription && (
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => onSimulateSubscription("Prime", 1, false)} className="flex-1 px-3 py-2 bg-indigo-900/20 text-indigo-400 border border-indigo-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-indigo-900/40 transition-all">Prime</button>
                        <button onClick={() => onSimulateSubscription("1000", 1, false)} className="flex-1 px-3 py-2 bg-purple-900/20 text-purple-400 border border-purple-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-purple-900/40 transition-all">Tier 1</button>
                        <button onClick={() => onSimulateSubscription("3000", 6, false)} className="flex-1 px-3 py-2 bg-fuchsia-900/20 text-fuchsia-400 border border-fuchsia-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-fuchsia-900/40 transition-all">T3 (6mo)</button>
                        <button onClick={() => onSimulateSubscription("1000", 1, true)} className="flex-1 px-3 py-2 bg-pink-900/20 text-pink-400 border border-pink-500/30 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-pink-900/40 transition-all">Gift Sub</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="p-8 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
            StreamLink Pro v1.1.0
          </div>
          <div className="flex gap-4">
            <button
              onClick={onClose}
              className="px-6 py-2.5 text-slate-400 hover:text-white font-black text-xs uppercase tracking-widest transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(formData, manualQuota)}
              className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-600/20 transition-all active:scale-95"
            >
              <Save size={18} /> Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default SettingsModal;
