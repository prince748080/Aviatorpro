import React from 'react';
import { Plane, Volume2, VolumeX, Shield, BookOpen, LogIn, LogOut, Wallet, Plus, ArrowUpRight, Send } from 'lucide-react';
import { User, GameConfig } from '../types/index.js';
import { sounds } from '../utils/sound.js';

interface NavbarProps {
  user: User | null;
  config: GameConfig | null;
  connected: boolean;
  onOpenRules: () => void;
  onOpenAuth: () => void;
  onOpenAdmin?: () => void;
  onOpenProvablyFair: () => void;
  onOpenWallet: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  config,
  connected,
  onOpenRules,
  onOpenAuth,
  onOpenAdmin,
  onOpenProvablyFair,
  onOpenWallet,
  onLogout,
}) => {
  const [isMuted, setIsMuted] = React.useState(sounds.getMuted());

  const handleToggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
  };

  return (
    <header className="bg-[#121318] border-b border-[#242731] px-4 py-2.5 select-none sticky top-0 z-40">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-rose-700 flex items-center justify-center shadow-lg shadow-red-900/40 border border-red-500/30">
              <Plane className="w-5 h-5 text-white transform -rotate-12" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-lg tracking-wider text-white font-['Chakra_Petch']">
                  AVIATOR<span className="text-red-500">PRO</span>
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-800/60 uppercase">
                  v2.0
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                <span className="flex items-center gap-1">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                    }`}
                  />
                  <span className="hidden sm:inline">{connected ? 'Server Live' : 'Connecting'}</span>
                </span>
                <span className="text-zinc-600">•</span>
                <span className="text-amber-400 font-semibold tracking-wide">
                  MAX {config ? config.maxMultiplier.toFixed(2) : '2.00'}x CAP
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Telegram Bot Link */}
          <a
            href="https://t.me/aviatorprince0001_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#229ED9]/15 hover:bg-[#229ED9]/25 text-[#229ED9] hover:text-[#52bbf0] text-xs font-semibold border border-[#229ED9]/35 transition cursor-pointer shadow-sm"
            title="Open Telegram Bot (@aviatorprince0001_bot)"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Bot</span>
          </a>

          {/* Rules & Transparency Button */}
          <button
            onClick={onOpenRules}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1c1e26] hover:bg-[#282c38] text-zinc-300 hover:text-white text-xs font-semibold border border-[#2c303e] transition cursor-pointer"
            title="Transparent Game Rules & 2.00x Cap Policy"
          >
            <BookOpen className="w-3.5 h-3.5 text-red-400" />
            <span className="hidden md:inline">Rules &amp; Odds</span>
          </button>

          {/* Provably Fair Button */}
          <button
            onClick={onOpenProvablyFair}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1c1e26] hover:bg-[#282c38] text-zinc-300 hover:text-white text-xs font-semibold border border-[#2c303e] transition cursor-pointer"
            title="Verify Round Provable Fairness (SHA-256)"
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden lg:inline">Fairness</span>
          </button>

          {/* Sound Toggle */}
          <button
            onClick={handleToggleSound}
            className="p-2 rounded-lg bg-[#1c1e26] hover:bg-[#282c38] text-zinc-400 hover:text-white text-xs border border-[#2c303e] transition cursor-pointer"
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-zinc-500" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          {/* User Account & Real Balance */}
          {user ? (
            <div className="flex items-center gap-2 bg-[#171922] border border-[#2b2f3d] rounded-xl p-1 pl-3 shadow-inner">
              <div className="flex flex-col text-right cursor-pointer" onClick={onOpenWallet}>
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold flex items-center justify-end gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Balance
                </span>
                <span className="font-extrabold text-sm sm:text-base text-emerald-400 font-mono">
                  ₹{user.balance.toFixed(2)}
                </span>
              </div>

              {/* Deposit Quick Action */}
              <button
                onClick={onOpenWallet}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-bold text-xs border border-emerald-500/40 transition cursor-pointer"
                title="Deposit Funds via UPI"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Deposit</span>
              </button>

              {/* Withdraw Quick Action */}
              <button
                onClick={onOpenWallet}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#222636] hover:bg-[#2d3246] text-zinc-300 font-bold text-xs border border-[#30364d] transition cursor-pointer"
                title="Withdraw Payout"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Withdraw</span>
              </button>
              {/* Logout */}
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition cursor-pointer"
                title={`Signed in as ${user.username} (${user.role}) - Click to Log Out`}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs shadow-lg shadow-red-900/40 border border-red-400/30 transition cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In / Register</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
