import React from 'react';
import { ChatMessage, SubscriptionData } from '../types';
import { Sparkles, Star, Check, Coins, Gift, Users, ListPlus, ListX, Radio } from 'lucide-react';
import { TwitchIcon, YouTubeIcon } from '@/components/icons/PlatformIcons';

export const subscriptionLabel = (sub: SubscriptionData): string => {
  if (sub.isGift) return (sub.giftCount ?? 1) > 1 ? `Gift ×${sub.giftCount}` : 'Gift sub';
  if (sub.months && sub.months > 1) return `Resub · ${sub.months} mo`;
  return 'New sub';
};

interface MessageItemProps {
  message: ChatMessage;
  isSelected?: boolean;
  /** 1-based position in the "Up next" queue, if queued. */
  queuePosition?: number;
  onFeature: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkTrash: (id: string) => void;
  onToggleInteresting: (id: string) => void;
  onToggleQueue: (id: string) => void;
}

const Tag: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider whitespace-nowrap ${className}`}>
    {children}
  </span>
);

const ActionButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; active?: boolean }> = ({ label, onClick, children, active }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`p-1.5 rounded-md border transition-colors ${active ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'}`}
  >
    {children}
  </button>
);

const MessageItem: React.FC<MessageItemProps> = ({
  message, isSelected, queuePosition, onFeature, onMarkRead, onMarkTrash, onToggleInteresting, onToggleQueue,
}) => {
  const isTwitch = message.platform === 'twitch';
  const isSub = message.eventType === 'subscription';
  const isRaid = message.eventType === 'raid';
  const isMoney = !!message.donationAmount;
  const isEvent = isSub || isRaid || isMoney;

  const surface = message.isFeatured
    ? 'bg-red-500/10 border-red-500/60'
    : isSub || isRaid
      ? 'bg-gradient-to-r from-purple-500/15 to-transparent border-purple-500/30'
      : isMoney
        ? 'bg-gradient-to-r from-amber-400/15 to-transparent border-amber-400/30'
        : message.isInteresting
          ? 'bg-amber-500/5 border-amber-500/20'
          : 'bg-transparent border-transparent hover:bg-slate-800/60';

  return (
    <div
      id={`message-${message.id}`}
      role="button"
      tabIndex={-1}
      onClick={() => (message.isFeatured ? onMarkRead(message.id) : onFeature(message.id))}
      onContextMenu={(e) => { e.preventDefault(); onToggleInteresting(message.id); }}
      className={`group relative grid grid-cols-[36px_minmax(0,1fr)_auto] gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${surface} ${message.isRead && !message.isFeatured ? 'opacity-40 hover:opacity-80' : ''} ${isSelected ? 'ring-2 ring-indigo-500/80' : ''}`}
    >
      <div className="relative w-9 h-9">
        <img src={message.avatarUrl} alt="" className="w-9 h-9 rounded-lg object-cover bg-slate-800" />
        <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-slate-950 flex items-center justify-center ${isTwitch ? 'bg-[#9146FF]' : 'bg-white'}`}>
          {isTwitch ? <TwitchIcon className="w-2 h-2 text-white fill-current" /> : <YouTubeIcon className="w-2.5 h-2.5" />}
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1">
          <span className="font-bold text-[13px] truncate" style={{ color: message.authorColor || (isTwitch ? '#bf94ff' : '#ff6b6b') }}>
            {message.author}
          </span>
          <time className="text-[10px] font-mono text-slate-500 tabular-nums">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
          {message.isFeatured && <Tag className="bg-red-500 text-white"><Radio size={9} /> On air</Tag>}
          {queuePosition && !message.isFeatured && <Tag className="bg-indigo-500/20 text-indigo-300">Up next #{queuePosition}</Tag>}
          {message.isFirstMessage && <Tag className="bg-emerald-500/10 text-emerald-400"><Sparkles size={9} /> First chat</Tag>}
          {isSub && message.subscription && <Tag className="bg-purple-500/20 text-purple-300"><Gift size={9} /> {subscriptionLabel(message.subscription)}</Tag>}
          {isRaid && <Tag className="bg-purple-500/20 text-purple-300"><Users size={9} /> Raid · {message.raidViewers ?? 0}</Tag>}
          {isMoney && <Tag className="bg-amber-400/15 text-amber-300"><Coins size={9} /> {message.donationAmount}</Tag>}
          {message.isInteresting && <Star size={11} className="text-amber-400 fill-amber-400 self-center" aria-label="Starred" />}
          {message.isTrashed && <Tag className="bg-slate-800 text-slate-400">Done</Tag>}
        </div>
        <p className={`mt-0.5 text-[14px] leading-snug break-words ${isEvent ? 'font-semibold text-white' : 'text-slate-200'}`}>
          {message.text}
        </p>
      </div>

      <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {!message.isFeatured && (
          <ActionButton label={queuePosition ? 'Remove from queue (Q)' : 'Add to queue (Q)'} onClick={() => onToggleQueue(message.id)}>
            {queuePosition ? <ListX size={13} /> : <ListPlus size={13} />}
          </ActionButton>
        )}
        <ActionButton label="Star (S)" onClick={() => onToggleInteresting(message.id)} active={message.isInteresting}>
          <Star size={13} />
        </ActionButton>
        {!message.isTrashed && (
          <ActionButton label="Done (D)" onClick={() => onMarkTrash(message.id)}>
            <Check size={13} />
          </ActionButton>
        )}
      </div>
    </div>
  );
};

export default React.memo(MessageItem);
