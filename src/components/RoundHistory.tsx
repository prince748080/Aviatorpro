import React from 'react';
import { History, ShieldCheck } from 'lucide-react';
import { GameRound } from '../types/index.js';

interface RoundHistoryProps {
  rounds: GameRound[];
  onSelectRound: (round: GameRound) => void;
}

export const RoundHistory: React.FC<RoundHistoryProps> = ({ rounds, onSelectRound }) => {
  const getBadgeStyle = (multiplier: number) => {
    if (multiplier >= 2.0) {
      return 'bg-gradient-to-r from-red-600 to-rose-600 text-white border-red-400/50 shadow-red-900/40 shadow-sm font-extrabold';
    }
    if (multiplier >= 1.5) {
      return 'bg-purple-900/60 text-purple-300 border-purple-700/60 font-bold';
    }
    return 'bg-[#1e2230] text-sky-300 border-sky-800/40 font-semibold';
  };

  return (
    <div className="bg-[#101218] border-b border-[#212430] px-3 py-1.5 flex items-center gap-2 overflow-hidden select-none">
      <div className="flex items-center gap-1.5 text-zinc-400 text-xs font-bold shrink-0 pr-1 border-r border-[#242836]">
        <History className="w-3.5 h-3.5 text-red-400" />
        <span className="hidden sm:inline uppercase tracking-wider text-[11px]">History:</span>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 scroll-smooth">
        {rounds.length === 0 ? (
          <span className="text-zinc-600 text-xs italic px-2">Awaiting completed round results...</span>
        ) : (
          rounds.map((round) => (
            <button
              key={round.id}
              onClick={() => onSelectRound(round)}
              className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-mono border transition-transform hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1 ${getBadgeStyle(
                round.crashMultiplier
              )}`}
              title={`Round #${round.roundNumber}: ${round.crashMultiplier.toFixed(2)}x - Click to verify SHA-256`}
            >
              <span>{round.crashMultiplier.toFixed(2)}x</span>
              <ShieldCheck className="w-2.5 h-2.5 opacity-60" />
            </button>
          ))
        )}
      </div>
    </div>
  );
};
