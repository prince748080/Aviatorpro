import React from 'react';
import { Users, CheckCircle2, Flame } from 'lucide-react';
import { Bet } from '../types/index.js';

interface LiveBetsListProps {
  bets: Bet[];
}

export const LiveBetsList: React.FC<LiveBetsListProps> = ({ bets }) => {
  const totalWagered = bets.reduce((acc, b) => acc + b.amount, 0);
  const totalCashed = bets.reduce((acc, b) => acc + (b.cashedAmount || 0), 0);

  return (
    <div className="bg-[#12141c] border border-[#232736] rounded-2xl p-3 flex flex-col h-full min-h-[300px] select-none">
      {/* Header & Quick Stats */}
      <div className="flex items-center justify-between pb-2 border-b border-[#1f2230] text-xs">
        <div className="flex items-center gap-1.5 font-bold text-zinc-300">
          <Users className="w-4 h-4 text-red-500" />
          <span className="uppercase tracking-wider text-[11px]">All Bets</span>
          <span className="px-1.5 py-0.2 rounded-full bg-red-950 text-red-400 font-mono text-[10px] border border-red-800/50">
            {bets.length}
          </span>
        </div>
        <div className="text-right text-[11px] font-mono text-zinc-400">
          <span>{totalWagered.toFixed(0)}</span> <span className="text-zinc-600">DEMO</span>
        </div>
      </div>

      {/* Bets Table Header */}
      <div className="grid grid-cols-3 text-[10px] uppercase font-bold text-zinc-500 py-1.5 px-2 border-b border-[#1a1c26]">
        <div>User</div>
        <div className="text-right">Bet</div>
        <div className="text-right">Cashed</div>
      </div>

      {/* Bets Scrollable List */}
      <div className="flex-1 overflow-y-auto space-y-1 py-1 pr-0.5 max-h-[340px] sm:max-h-[460px]">
        {bets.length === 0 ? (
          <div className="text-center py-12 text-zinc-600 text-xs italic">
            Waiting for pilots to place bets...
          </div>
        ) : (
          bets.map((bet) => {
            const hasCashed = bet.status === 'CASHED_OUT';
            return (
              <div
                key={bet.id}
                className={`grid grid-cols-3 items-center text-xs px-2 py-1.5 rounded-lg border transition ${
                  hasCashed
                    ? 'bg-emerald-950/40 border-emerald-600/40 text-emerald-200'
                    : 'bg-[#161822] border-[#222533] text-zinc-300'
                }`}
              >
                {/* Username */}
                <div className="flex items-center gap-1.5 truncate">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
                    {bet.username.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate font-medium text-[11px]">{bet.username}</span>
                </div>

                {/* Bet Amount */}
                <div className="text-right font-mono text-[11px] text-zinc-300 font-semibold">
                  {bet.amount.toFixed(2)}
                </div>

                {/* Cashed Out Multiplier / Status */}
                <div className="text-right font-mono text-[11px]">
                  {hasCashed ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                      <span>{bet.cashedMultiplier?.toFixed(2)}x</span>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    </span>
                  ) : bet.status === 'CRASHED' ? (
                    <span className="text-red-500 font-medium">0.00x</span>
                  ) : (
                    <span className="text-zinc-500 italic">In Flight</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Payout Summary */}
      <div className="pt-2 border-t border-[#1f2230] flex items-center justify-between text-[11px] text-zinc-400 font-mono">
        <span>Total Paid Out:</span>
        <span className="text-emerald-400 font-bold">+{totalCashed.toFixed(2)} DEMO</span>
      </div>
    </div>
  );
};
