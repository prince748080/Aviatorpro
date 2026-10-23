import React, { useState, useEffect } from 'react';
import { Minus, Plus, Zap, Check, AlertCircle, Clock } from 'lucide-react';
import { RoundState, Bet, GameConfig } from '../types/index.js';
import { sounds } from '../utils/sound.js';

interface BetPanelProps {
  panelIndex: number;
  roundState: RoundState;
  currentMultiplier: number;
  config: GameConfig | null;
  activeBet: Bet | null;
  userBalance: number;
  disabled: boolean;
  onPlaceBet: (amount: number, autoCashout: number | null) => Promise<void>;
  onCancelBet: (betId: string) => Promise<void>;
  onCashout: (betId: string) => Promise<void>;
}

export const BetPanel: React.FC<BetPanelProps> = ({
  panelIndex,
  roundState,
  currentMultiplier,
  config,
  activeBet,
  userBalance,
  disabled,
  onPlaceBet,
  onCancelBet,
  onCashout,
}) => {
  const [amount, setAmount] = useState<number>(panelIndex === 0 ? 50 : 100);
  const [autoCashoutEnabled, setAutoCashoutEnabled] = useState<boolean>(false);
  const [autoCashoutMultiplier, setAutoCashoutMultiplier] = useState<number>(1.5);
  const [autoBetEnabled, setAutoBetEnabled] = useState<boolean>(false);
  const [queuedNextRound, setQueuedNextRound] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const maxCap = config ? config.maxMultiplier : 2.00;
  const minBet = config ? config.minBetAmount : 10;
  const maxBet = config ? config.maxBetAmount : 50000;

  // Clear errors automatically
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Auto-bet and queued next round placement when WAITING starts
  useEffect(() => {
    if (roundState === 'WAITING' && !activeBet && !disabled && (autoBetEnabled || queuedNextRound)) {
      if (userBalance >= amount) {
        setQueuedNextRound(false);
        handlePlaceBetDirect();
      } else {
        setQueuedNextRound(false);
        setErrorMessage('Insufficient balance for queued bet');
      }
    }
  }, [roundState, autoBetEnabled, queuedNextRound, activeBet]);

  const handleQuickAdd = (delta: number) => {
    sounds.playClick();
    setAmount((prev) => Math.min(Math.max(prev + delta, minBet), maxBet));
  };

  const handleQuickPreset = (value: number) => {
    sounds.playClick();
    setAmount(value);
  };

  const handlePlaceBetDirect = async () => {
    if (amount > userBalance) {
      setErrorMessage('Insufficient balance. Please deposit funds.');
      return;
    }
    try {
      setIsLoading(true);
      const autoMult = autoCashoutEnabled ? autoCashoutMultiplier : null;
      await onPlaceBet(amount, autoMult);
    } catch (err: any) {
      setErrorMessage(err.message || 'Bet failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async () => {
    sounds.playClick();
    setErrorMessage(null);

    // 1. If currently RUNNING and user has an active bet: CASHOUT!
    if (roundState === 'RUNNING' && activeBet && activeBet.status === 'PLACED') {
      try {
        setIsLoading(true);
        await onCashout(activeBet.id);
        sounds.playCashout();
      } catch (err: any) {
        setErrorMessage(err.message || 'Cashout failed');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 2. If currently WAITING and user has active bet: CANCEL BET!
    if (roundState === 'WAITING' && activeBet && activeBet.status === 'PLACED') {
      try {
        setIsLoading(true);
        await onCancelBet(activeBet.id);
      } catch (err: any) {
        setErrorMessage(err.message || 'Cancel bet failed');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 3. If currently WAITING and no active bet: PLACE BET!
    if (roundState === 'WAITING' && !activeBet) {
      await handlePlaceBetDirect();
      return;
    }

    // 4. If round is currently RUNNING or CRASHED and no active bet: Queue for next round
    if ((roundState === 'RUNNING' || roundState === 'CRASHED') && !activeBet) {
      if (queuedNextRound) {
        setQueuedNextRound(false);
      } else {
        if (amount > userBalance) {
          setErrorMessage('Insufficient demo credits');
          return;
        }
        setQueuedNextRound(true);
      }
      return;
    }
  };

  const calculateLivePayout = () => {
    if (!activeBet) return 0;
    return Number((activeBet.amount * currentMultiplier).toFixed(2));
  };

  // Button state logic
  const renderActionButton = () => {
    if (disabled) {
      return (
        <button
          disabled
          className="w-full h-full min-h-[96px] rounded-xl bg-zinc-800 text-zinc-500 font-bold text-base cursor-not-allowed uppercase"
        >
          Connecting...
        </button>
      );
    }

    // ACTIVE CASHOUT DURING RUNNING FLIGHT
    if (roundState === 'RUNNING' && activeBet && activeBet.status === 'PLACED') {
      const payout = calculateLivePayout();
      return (
        <button
          onClick={handleAction}
          disabled={isLoading}
          className="w-full h-full min-h-[96px] rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-black text-lg sm:text-xl shadow-xl shadow-orange-950/70 transition active:scale-95 flex flex-col items-center justify-center cursor-pointer border-2 border-amber-300 animate-pulse"
        >
          <span className="text-xs uppercase tracking-widest font-black text-amber-950">
            CASH OUT
          </span>
          <span className="text-2xl sm:text-3xl font-mono leading-tight font-black">
            {payout.toFixed(2)} DEMO
          </span>
          <span className="text-[11px] font-bold text-amber-900 bg-amber-400/40 px-2 py-0.5 rounded-full mt-0.5">
            @ {currentMultiplier.toFixed(2)}x
          </span>
        </button>
      );
    }

    // ALREADY CASHED OUT SUCCESSFULLY
    if (activeBet && activeBet.status === 'CASHED_OUT') {
      return (
        <div className="w-full h-full min-h-[96px] rounded-xl bg-emerald-950/80 border border-emerald-600/50 text-emerald-400 font-bold p-3 flex flex-col items-center justify-center text-center">
          <div className="flex items-center gap-1 text-xs uppercase font-extrabold text-emerald-300">
            <Check className="w-4 h-4" /> CASHED OUT
          </div>
          <span className="text-xl sm:text-2xl font-mono text-white font-extrabold">
            +{activeBet.cashedAmount?.toFixed(2)} DEMO
          </span>
          <span className="text-[11px] text-emerald-300">@ {activeBet.cashedMultiplier?.toFixed(2)}x</span>
        </div>
      );
    }

    // CRASHED BET
    if (activeBet && activeBet.status === 'CRASHED') {
      return (
        <div className="w-full h-full min-h-[96px] rounded-xl bg-red-950/60 border border-red-800/40 text-red-400 font-bold p-3 flex flex-col items-center justify-center text-center">
          <span className="text-xs uppercase font-extrabold text-red-300">CRASHED</span>
          <span className="text-base font-mono text-zinc-400">-{activeBet.amount.toFixed(2)} DEMO</span>
          <span className="text-[10px] text-zinc-500">Wait for next round</span>
        </div>
      );
    }

    // BET PLACED DURING WAITING (SHOW CANCEL BUTTON)
    if (roundState === 'WAITING' && activeBet && activeBet.status === 'PLACED') {
      return (
        <button
          onClick={handleAction}
          disabled={isLoading}
          className="w-full h-full min-h-[96px] rounded-xl bg-red-950/70 hover:bg-red-900/80 border border-red-700/70 text-red-200 font-bold text-base transition active:scale-98 flex flex-col items-center justify-center cursor-pointer shadow-inner"
        >
          <span className="text-xs uppercase tracking-wider text-red-400 font-extrabold">CANCEL BET</span>
          <span className="text-xl font-mono text-white">{activeBet.amount.toFixed(2)} DEMO</span>
          <span className="text-[10px] text-red-300">Takeoff in progress...</span>
        </button>
      );
    }

    // QUEUED FOR NEXT ROUND
    if (queuedNextRound) {
      return (
        <button
          onClick={handleAction}
          className="w-full h-full min-h-[96px] rounded-xl bg-amber-950/60 hover:bg-amber-900/70 border border-amber-600/60 text-amber-200 font-bold text-base transition active:scale-98 flex flex-col items-center justify-center cursor-pointer"
        >
          <span className="text-xs uppercase tracking-wider text-amber-400 font-extrabold flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> QUEUED FOR TAKEOFF
          </span>
          <span className="text-xl font-mono text-white">{amount.toFixed(2)} DEMO</span>
          <span className="text-[10px] text-zinc-400">Click to Cancel Queue</span>
        </button>
      );
    }

    // READY TO BET DURING WAITING
    if (roundState === 'WAITING') {
      return (
        <button
          onClick={handleAction}
          disabled={isLoading}
          className="w-full h-full min-h-[96px] rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-black text-lg shadow-lg shadow-emerald-950/60 border border-emerald-400/40 transition active:scale-95 flex flex-col items-center justify-center cursor-pointer"
        >
          <span className="text-xs uppercase tracking-widest font-black">BET</span>
          <span className="text-2xl sm:text-3xl font-mono leading-tight">{amount.toFixed(2)}</span>
          <span className="text-[10px] font-semibold opacity-90">DEMO CREDITS</span>
        </button>
      );
    }

    // FLIGHT IN PROGRESS / AFTER CRASH: ALLOW QUEUING FOR NEXT ROUND
    return (
      <button
        onClick={handleAction}
        disabled={isLoading}
        className="w-full h-full min-h-[96px] rounded-xl bg-[#1b1e2a] hover:bg-[#252a3b] border border-[#2c3246] hover:border-emerald-500/50 text-white font-bold transition active:scale-95 flex flex-col items-center justify-center cursor-pointer shadow-md"
      >
        <span className="text-xs uppercase tracking-wider text-emerald-400 font-extrabold">
          BET (NEXT ROUND)
        </span>
        <span className="text-2xl font-mono leading-tight">{amount.toFixed(2)}</span>
        <span className="text-[10px] text-zinc-400">Queue for takeoff</span>
      </button>
    );
  };

  return (
    <div className="bg-[#12141c] border border-[#232736] rounded-2xl p-3 sm:p-4 shadow-xl flex flex-col gap-3 relative select-none">
      {/* Panel Header */}
      <div className="flex items-center justify-between text-xs font-bold text-zinc-400 border-b border-[#1f2230] pb-2">
        <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] text-zinc-300">
          <Zap className="w-3.5 h-3.5 text-amber-400" /> Bet Panel {panelIndex + 1}
        </span>
        <div className="flex items-center gap-3">
          {/* Auto Bet Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition">
            <input
              type="checkbox"
              checked={autoBetEnabled}
              onChange={(e) => setAutoBetEnabled(e.target.checked)}
              className="rounded bg-zinc-800 border-zinc-700 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span className="text-[11px]">Auto Bet</span>
          </label>
        </div>
      </div>

      {/* Main Controls Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
        {/* Left Column: Bet Amount & Chips */}
        <div className="flex flex-col gap-2 justify-between">
          {/* Amount input with - / + */}
          <div className="flex items-center bg-[#181b24] border border-[#272c3d] rounded-xl p-1 shadow-inner">
            <button
              onClick={() => handleQuickAdd(-10)}
              disabled={amount <= minBet || activeBet !== null}
              className="w-10 h-10 rounded-lg bg-[#212534] hover:bg-[#2d3246] disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 hover:text-white flex items-center justify-center transition cursor-pointer"
            >
              <Minus className="w-4 h-4" />
            </button>

            <div className="flex-1 text-center px-2">
              <input
                type="number"
                min={minBet}
                max={maxBet}
                step={10}
                value={amount}
                disabled={activeBet !== null}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full bg-transparent text-center font-mono font-bold text-lg sm:text-xl text-white outline-none"
              />
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest block font-semibold">
                Demo Bet
              </span>
            </div>

            <button
              onClick={() => handleQuickAdd(+10)}
              disabled={amount >= maxBet || activeBet !== null}
              className="w-10 h-10 rounded-lg bg-[#212534] hover:bg-[#2d3246] disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 hover:text-white flex items-center justify-center transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Preset Chips */}
          <div className="grid grid-cols-4 gap-1.5">
            {[10, 50, 100, 500].map((preset) => (
              <button
                key={preset}
                disabled={activeBet !== null}
                onClick={() => handleQuickPreset(preset)}
                className={`py-1 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                  amount === preset
                    ? 'bg-red-950/70 text-red-400 border-red-700/60'
                    : 'bg-[#181b24] hover:bg-[#222634] text-zinc-400 hover:text-zinc-200 border-[#272b3b]'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Auto Cashout Controls */}
          <div className="flex items-center justify-between bg-[#181b24] border border-[#272c3d] rounded-xl px-3 py-1.5">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-zinc-300">
              <input
                type="checkbox"
                checked={autoCashoutEnabled}
                onChange={(e) => setAutoCashoutEnabled(e.target.checked)}
                className="rounded bg-zinc-800 border-zinc-700 text-amber-500 focus:ring-0 w-3.5 h-3.5"
              />
              <span className="text-[11px]">Auto Cash Out</span>
            </label>

            <div className="flex items-center gap-1 font-mono text-xs">
              <input
                type="number"
                min={1.01}
                max={maxCap}
                step={0.05}
                disabled={!autoCashoutEnabled}
                value={autoCashoutMultiplier}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setAutoCashoutMultiplier(Math.min(Math.max(val, 1.01), maxCap));
                }}
                className={`w-16 bg-[#11131a] border border-[#2a2e40] rounded px-1.5 py-0.5 text-center font-bold outline-none ${
                  autoCashoutEnabled ? 'text-amber-400 border-amber-600/40' : 'text-zinc-600 cursor-not-allowed'
                }`}
              />
              <span className="text-zinc-500 font-bold">x</span>
            </div>
          </div>
        </div>

        {/* Right Column: Giant Action Button */}
        <div className="flex flex-col justify-stretch">{renderActionButton()}</div>
      </div>

      {/* Error alert toast */}
      {errorMessage && (
        <div className="absolute -bottom-10 left-3 right-3 bg-red-950/95 border border-red-700 text-red-200 text-xs py-1.5 px-3 rounded-lg shadow-xl flex items-center gap-2 z-30 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
