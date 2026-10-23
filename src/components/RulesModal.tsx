import React from 'react';
import { X, BookOpen, ShieldCheck, AlertTriangle, Scale, Lock } from 'lucide-react';
import { GameConfig } from '../types/index.js';

interface RulesModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: GameConfig | null;
}

export const RulesModal: React.FC<RulesModalProps> = ({ isOpen, onClose, config }) => {
  if (!isOpen) return null;

  const maxCap = config ? config.maxMultiplier.toFixed(2) : '2.00';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#12141d] border border-[#262a3b] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#202434] sticky top-0 bg-[#12141d] z-10">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-bold text-white font-['Chakra_Petch']">
              Aviator Pro — Documented Rules &amp; Odds Transparency
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#1a1d28] hover:bg-[#25293a] text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 text-sm text-zinc-300 leading-relaxed">
          {/* Explicit Highlight Box: 2.00x Maximum Multiplier Cap Rule */}
          <div className="bg-gradient-to-r from-red-950/70 to-rose-950/60 border border-red-700/60 rounded-xl p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <Scale className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-extrabold text-white uppercase tracking-wide">
                  Explicit Rule: Maximum Multiplier Cap ({maxCap}x)
                </h3>
                <p className="mt-1 text-zinc-300 text-xs sm:text-sm">
                  This platform enforces an authoritative backend ceiling of <strong>{maxCap}x</strong> on all flights. 
                  Unlike conventional crash games that advertise unattainable 1,000,000x multipliers, Aviator Pro 
                  operates with a documented maximum cap. 
                </p>
                <ul className="mt-2 text-xs list-disc list-inside text-zinc-400 space-y-1">
                  <li>Flights crash between <strong>1.01x</strong> and <strong>{maxCap}x</strong>.</li>
                  <li>Auto-cashout inputs are strictly validated on the server and cannot exceed {maxCap}x.</li>
                  <li>If configured limits change, the change is permanently recorded in the administrator audit log.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Core Game Mechanism */}
          <div>
            <h4 className="text-white font-bold text-base flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span> How to Play
            </h4>
            <ol className="list-decimal list-inside space-y-2 text-xs sm:text-sm text-zinc-300 pl-2">
              <li>
                <strong>Place Bets:</strong> Choose your wager in INR and click "Bet" during the 5-second WAITING countdown before takeoff. You can place up to two simultaneous bets on the same round.
              </li>
              <li>
                <strong>Ascent &amp; Multiplier:</strong> As the red monoplane takes flight, the multiplier increases continuously according to the backend curve formula.
              </li>
              <li>
                <strong>Cash Out:</strong> Press "Cash Out" before the plane flies away. Your payout equals your bet multiplied by the exact server multiplier at the moment of cash-out.
              </li>
              <li>
                <strong>Crash Event:</strong> If the plane flies away before you cash out, the bet is lost.
              </li>
            </ol>
          </div>

          {/* Provably Fair Cryptographic Seed */}
          <div className="bg-[#171a25] border border-[#272b3c] rounded-xl p-4">
            <h4 className="text-white font-bold text-sm flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Provably Fair Verification
            </h4>
            <p className="text-xs text-zinc-400">
              Each round's crash point is deterministically computed from a secret 256-bit server seed generated 
              before takeoff. The SHA-256 hash of this seed is published in advance in the round history. When the round 
              crashes, the secret seed is revealed, allowing anyone to verify independently that the outcome was never 
              manipulated during flight.
            </p>
          </div>

          {/* Authoritative UPI & Ledger Architecture */}
          <div className="bg-[#171a25] border border-[#272b3c] rounded-xl p-4">
            <h4 className="text-white font-bold text-sm flex items-center gap-2 mb-1 text-emerald-400">
              <Lock className="w-4 h-4 text-emerald-400" /> Authoritative Account &amp; Ledger Architecture
            </h4>
            <p className="text-xs text-zinc-400">
              Accounts start with <strong>₹0.00</strong> balance. Balance increases only through verified UPI deposits (Receiver: <code>princesuhani@fam</code>) confirmed by a 12-digit UTR reference. Payouts and withdrawals are governed by strict atomic balance reservations to prevent double-spending, and monitored 24/7 via the official Telegram Bot (@aviatorprince0001_bot).
            </p>
          </div>

          {/* Anti-Manipulation Guarantee */}
          <div className="bg-[#171a25] border border-[#272b3c] rounded-xl p-4">
            <h4 className="text-white font-bold text-sm flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-sky-400" /> Player Equity Standards
            </h4>
            <p className="text-xs text-zinc-400">
              The game engine never targets individual users, balances, or historical win/loss ratios. 
              Every connected player in the round observes the exact same flight, multiplier curve, and crash outcome.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#202434] bg-[#101219] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs cursor-pointer shadow-md shadow-red-950/50"
          >
            I Understand &amp; Agree
          </button>
        </div>
      </div>
    </div>
  );
};
