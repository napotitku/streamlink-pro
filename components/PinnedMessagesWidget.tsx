import React, { useState, useEffect } from 'react';
import { ChatMessage } from '../types';
import { Clock, Coins, ChevronRight } from 'lucide-react';

interface PinnedMessagesWidgetProps {
    messages: ChatMessage[];
    onMessageClick: (id: string) => void;
}

const PinnedMessageItem: React.FC<{ message: ChatMessage; onClick: () => void }> = ({ message, onClick }) => {
    const [timeLeft, setTimeLeft] = useState(0);
    const [progress, setProgress] = useState(100);

    useEffect(() => {
        if (!message.pinnedAt || !message.pinnedDuration) return;

        const interval = setInterval(() => {
            const now = Date.now();
            const endTime = (message.pinnedAt || 0) + (message.pinnedDuration || 0) * 1000;
            const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));
            const percentage = Math.max(0, (remaining / (message.pinnedDuration || 1)) * 100);

            setTimeLeft(remaining);
            setProgress(percentage);
        }, 100);

        return () => clearInterval(interval);
    }, [message.pinnedAt, message.pinnedDuration]);

    if (timeLeft <= 0) return null;

    // Tier colors based on amount (CZK logic)
    let bgColor = "bg-emerald-600";
    let borderColor = "border-emerald-500";

    const amountVal = parseFloat(message.donationAmount?.replace(/[^0-9.]/g, '') || '0');

    // Approximate tiers for CZK
    if (amountVal >= 2000) {
        bgColor = "bg-red-600";
        borderColor = "border-red-500";
    } else if (amountVal >= 1000) {
        bgColor = "bg-purple-600";
        borderColor = "border-purple-500";
    } else if (amountVal >= 500) {
        bgColor = "bg-amber-500";
        borderColor = "border-amber-400";
    } else if (amountVal >= 200) {
        bgColor = "bg-cyan-600";
        borderColor = "border-cyan-500";
    }

    return (
        <div
            onClick={onClick}
            className={`relative overflow-hidden rounded-xl border ${borderColor} cursor-pointer hover:brightness-110 transition-all shadow-lg group shrink-0 h-[60px]`}
        >
            {/* Progress Bar Background */}
            <div
                className={`absolute inset-0 ${bgColor} opacity-40 transition-all duration-300`}
                style={{ width: `${progress}%` }}
            />

            <div className={`relative h-full px-3 flex items-center gap-3 bg-slate-900/40 backdrop-blur-xs`}>
                <div className="relative">
                    <img
                        src={message.avatarUrl}
                        alt={message.author}
                        className="w-8 h-8 rounded-full border-2 border-white/10 object-cover"
                    />
                    <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black ${bgColor} text-white border border-slate-900`}>
                        <Coins size={8} strokeWidth={3} />
                    </div>
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-white truncate">{message.author}</span>
                        <span className={`text-[10px] font-black ${bgColor.replace('bg-', 'text-')} brightness-125`}>
                            {message.donationAmount}
                        </span>
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-slate-500 font-medium">
                        <span className="group-hover:text-indigo-400 transition-colors flex items-center gap-1">
                            View message <ChevronRight size={10} />
                        </span>
                        <span className="font-mono opacity-50">{timeLeft}s</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const PinnedMessagesWidget: React.FC<PinnedMessagesWidgetProps> = ({ messages, onMessageClick }) => {
    // Filter for active pinned donations
    const activeDonations = messages.filter(m => {
        if (!m.donationAmount || !m.pinnedAt || !m.pinnedDuration) return false;
        const endTime = m.pinnedAt + (m.pinnedDuration * 1000);
        return endTime > Date.now();
    });

    if (activeDonations.length === 0) return null;

    return (
        <div className="space-y-3 animate-in slide-in-from-right duration-500">
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                <Coins size={12} className="text-amber-400" /> Pinned support
            </h2>
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                {activeDonations.map(msg => (
                    <PinnedMessageItem
                        key={msg.id}
                        message={msg}
                        onClick={() => onMessageClick(msg.id)}
                    />
                ))}
            </div>
        </div>
    );
};
