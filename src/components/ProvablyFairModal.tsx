import React, { useState } from 'react';
import { X, ShieldCheck, CheckCircle2, Copy, AlertCircle } from 'lucide-react';
import { GameRound } from '../types/index.js';

interface ProvablyFairModalProps {
  isOpen: boolean;
  onClose: () => void;
  round: GameRound | null;
}

export const ProvablyFairModal: React.FC<ProvablyFairModalProps> = ({ isOpen, onClose, round }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<boolean | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleVerify = async () => {
    if (!round || !round.serverSeed) return;
    try {
      const msgBuffer = new TextEncoder().encode(round.serverSeed);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      setVerificationResult(hashHex.toLowerCase() === round.publicHash.toLowerCase());
    } catch {
      setVerificationResult(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#12141d] border border-[#262a3b] rounded-2xl max-w-xl w-full p-5 shadow-2xl flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#202434] pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white font-['Chakra_Petch']">
              Provably Fair Cryptographic Verification
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-[#1a1d28] hover:bg-[#25293a] text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {round ? (
          <div className="space-y-4 text-xs">
            {/* Round Summary Card */}
            <div className="bg-[#171a25] border border-[#272b3c] rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-zinc-400 text-[11px] block">Round Identifier</span>
                <span className="font-mono font-bold text-white text-sm">#{round.roundNumber} ({round.id})</span>
              </div>
              <div className="text-right">
                <span className="text-zinc-400 text-[11px] block">Crash Multiplier</span>
                <span className="font-mono font-black text-lg text-red-400">{round.crashMultiplier.toFixed(2)}x</span>
              </div>
            </div>

            {/* Public Pre-Commit Hash */}
            <div className="space-y-1">
              <label className="text-zinc-400 text-[11px] font-semibold flex items-center justify-between">
                <span>Public SHA-256 Hash (Published Before Takeoff):</span>
                {copied === 'hash' && <span className="text-emerald-400 font-bold">Copied!</span>}
              </label>
              <div className="flex items-center bg-[#171a25] border border-[#272b3c] rounded-lg p-2 font-mono text-[11px] text-zinc-300 break-all select-all">
                <span className="flex-1">{round.publicHash}</span>
                <button
                  onClick={() => handleCopy(round.publicHash, 'hash')}
                  className="ml-2 p-1 text-zinc-400 hover:text-white cursor-pointer"
                  title="Copy SHA-256 Hash"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Secret Server Seed */}
            <div className="space-y-1">
              <label className="text-zinc-400 text-[11px] font-semibold flex items-center justify-between">
                <span>Secret Server Seed (Revealed After Crash):</span>
                {copied === 'seed' && <span className="text-emerald-400 font-bold">Copied!</span>}
              </label>
              <div className="flex items-center bg-[#171a25] border border-[#272b3c] rounded-lg p-2 font-mono text-[11px] text-zinc-300 break-all select-all">
                <span className="flex-1">{round.serverSeed || 'Revealed upon round conclusion'}</span>
                {round.serverSeed && (
                  <button
                    onClick={() => handleCopy(round.serverSeed, 'seed')}
                    className="ml-2 p-1 text-zinc-400 hover:text-white cursor-pointer"
                    title="Copy Server Seed"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Verify Action Button & Result */}
            <div className="pt-2 flex flex-col items-center gap-2">
              <button
                onClick={handleVerify}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/60 transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Verify Mathematical Match (SHA-256)</span>
              </button>

              {verificationResult === true && (
                <div className="w-full bg-emerald-950/60 border border-emerald-500/50 rounded-xl p-2.5 flex items-center gap-2 text-emerald-300 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Valid! SHA256(Revealed Seed) exactly equals the Public Hash. The outcome was pre-determined and unaltered.
                  </span>
                </div>
              )}

              {verificationResult === false && (
                <div className="w-full bg-red-950/60 border border-red-500/50 rounded-xl p-2.5 flex items-center gap-2 text-red-300 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>Verification Failed. Hash does not match revealed seed.</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-zinc-500 text-xs italic">
            Select a completed round from the top history bar to verify its cryptographic seed.
          </div>
        )}
      </div>
    </div>
  );
};
