
import React from 'react';
import { ChatMessage } from '../types';
import { CheckCircle, Send, MessageSquareDashed, Sparkles, Bookmark, Trash2, XCircle, Coins } from 'lucide-react';
import { TwitchIcon, YouTubeIcon } from '@/components/icons/PlatformIcons';

interface MessageItemProps {
  message: ChatMessage;
  onFeature: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkTrash: (id: string) => void;
  onToggleInteresting: (id: string) => void;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, onFeature, onMarkRead, onMarkTrash, onToggleInteresting }) => {
  const isTwitch = message.platform === 'twitch';

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (message.isFeatured) {
      onMarkRead(message.id);
    } else {
      onFeature(message.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onToggleInteresting(message.id);
  };

  const handleTrash = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMarkTrash(message.id);
  };

  return (
    <div id={`message-${message.id}`} className="relative group/container rounded-xl">
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`w-full text-left group relative p-4 rounded-xl transition-all border outline-none ring-offset-2 ring-offset-slate-900 ring-indigo-500 focus-visible:ring-2 ${message.isFeatured
          ? 'bg-indigo-600/30 border-indigo-500 shadow-lg shadow-indigo-500/10 z-10'
          : message.isRead
            ? 'bg-slate-900/40 border-slate-800/40 opacity-50'
            : message.isInteresting
              ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
              : 'bg-slate-800/80 border-slate-700/50 hover:bg-slate-800 hover:border-slate-500'
          }`}
      >
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            {/* User Avatar */}
            <div className="relative">
              <img
                src={message.avatarUrl}
                alt={message.author}
                className={`w-11 h-11 rounded-xl object-cover ring-2 transition-all ${message.isFeatured ? 'ring-indigo-500 shadow-md' : 'ring-transparent'}`}
              />

              {/* LARGE TRASH ICON - Overlaying the avatar on hover */}
              {!message.isRead && !message.isFeatured && (
                <div
                  onClick={handleTrash}
                  className="absolute inset-0 z-20 flex items-center justify-center bg-red-600/90 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-xl border border-red-400/50 scale-105"
                  title="Trash (Mark as Done)"
                >
                  <Trash2 size={24} className="text-white drop-shadow-md" />
                </div>
              )}
            </div>

            <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-slate-900 flex items-center justify-center shadow-lg transition-transform ${isTwitch ? 'bg-[#9146FF]' : 'bg-[#FF0000]'}`}>
              {isTwitch ? (
                <TwitchIcon className="w-2.5 h-2.5 text-white fill-current" />
              ) : (
                <YouTubeIcon className="w-3 h-3" />
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="font-black text-sm tracking-tight truncate" style={{ color: message.authorColor || (isTwitch ? '#bf94ff' : '#ff4d4d') }}>
                {message.author}
              </span>

              {message.isFirstMessage && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase tracking-widest">
                  <Sparkles size={8} /> First Chat
                </span>
              )}

              {message.isInteresting && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded uppercase tracking-widest shadow-sm">
                  <Bookmark size={8} fill="currentColor" /> Interesting
                </span>
              )}

              {message.donationAmount && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded uppercase tracking-widest shadow-sm border border-emerald-500/30">
                  <Coins size={8} strokeWidth={3} /> {message.donationAmount}
                </span>
              )}

              <span className="text-[9px] text-slate-500 font-mono font-bold tracking-tighter opacity-70">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>

              {message.isRead && !message.isFeatured && (
                <div className="ml-auto flex items-center gap-1">
                  {message.isTrashed ? (
                    <span className="flex items-center gap-1 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      <XCircle size={10} /> TRASHED
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-500/80 uppercase tracking-widest">
                      <CheckCircle size={10} /> FEATURED
                    </span>
                  )}
                </div>
              )}
            </div>

            <p className={`text-[14px] break-words leading-snug font-semibold tracking-tight ${message.isFeatured ? 'text-white' : 'text-slate-200'}`}>
              {message.text}
            </p>
          </div>
        </div>

        {/* Right-Side Feature Button */}
        <div className="absolute top-2 right-2 flex gap-1 items-center">
          {!message.isFeatured && !message.isRead && (
            <div className="opacity-0 group-hover:opacity-100 transition-all">
              <span className="flex items-center gap-1.5 text-[10px] text-white font-black uppercase tracking-widest bg-indigo-600 px-2.5 py-1 rounded-lg border border-indigo-400/30 shadow-xl shadow-indigo-600/40">
                <Send size={10} /> Feature
              </span>
            </div>
          )}
          {message.isFeatured && (
            <div className="animate-in slide-in-from-top-1">
              <span className="flex items-center gap-1.5 text-[10px] text-white font-black uppercase tracking-widest bg-red-600 px-2.5 py-1 rounded-lg border border-red-400/30 shadow-xl shadow-red-600/40">
                <MessageSquareDashed size={10} /> Dismiss
              </span>
            </div>
          )}
        </div>
      </button>

      {message.isFeatured && (
        <div className="absolute left-[-1rem] top-1/2 -translate-y-1/2 w-4 h-px bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
      )}
    </div>
  );
};

export default MessageItem;
