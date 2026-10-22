import React, { useState } from 'react';
import { X, LogIn, UserPlus, KeyRound, ShieldAlert, Sparkles } from 'lucide-react';
import { api } from '../utils/api.js';
import { User } from '../types/index.js';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        const res = await api.register(username, password);
        onSuccess(res.user);
        onClose();
      } else {
        const res = await api.login(username, password);
        onSuccess(res.user);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#12141d] border border-[#262a3b] rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#202434] pb-3">
          <div className="flex items-center gap-2">
            {isRegister ? <UserPlus className="w-5 h-5 text-red-500" /> : <LogIn className="w-5 h-5 text-red-500" />}
            <h3 className="text-base font-bold text-white font-['Chakra_Petch']">
              {isRegister ? 'Create Pilot Account' : 'Sign In to Aviator Pro'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-[#1a1d28] hover:bg-[#25293a] text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-950/80 border border-red-700/60 rounded-xl p-3 text-red-200 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="text-zinc-400 text-xs font-semibold block mb-1">Pilot Username</label>
            <input
              type="text"
              required
              minLength={3}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Maverick"
              className="w-full bg-[#171a25] border border-[#272b3c] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-red-500 transition"
            />
          </div>

          <div>
            <label className="text-zinc-400 text-xs font-semibold block mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#171a25] border border-[#272b3c] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-red-500 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-sm shadow-lg shadow-red-950/60 transition cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : isRegister ? 'Register (+1,000 Free Demo Credits)' : 'Sign In'}
          </button>
        </form>

        {/* Demo Fast Fill Credentials */}
        <div className="bg-[#171a25] border border-[#272b3c] rounded-xl p-3 text-xs space-y-2">
          <span className="text-zinc-400 font-semibold flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Fast-Test Credentials:
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleQuickFill('pilot', 'DemoPilot123!')}
              className="p-2 rounded-lg bg-[#202434] hover:bg-[#2b3046] text-zinc-300 text-left border border-[#2e3348] transition cursor-pointer"
            >
              <div className="font-bold text-white text-[11px]">Demo Player</div>
              <div className="text-[10px] text-zinc-400 font-mono">pilot / DemoPilot123!</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('admin', 'AviatorAdmin2026!')}
              className="p-2 rounded-lg bg-[#202434] hover:bg-[#2b3046] text-zinc-300 text-left border border-amber-600/40 transition cursor-pointer"
            >
              <div className="font-bold text-amber-300 text-[11px]">Administrator</div>
              <div className="text-[10px] text-zinc-400 font-mono">admin / AviatorAdmin2026!</div>
            </button>
          </div>
        </div>

        {/* Switch mode */}
        <div className="text-center pt-1 border-t border-[#202434]">
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-xs text-red-400 hover:text-red-300 font-semibold cursor-pointer"
          >
            {isRegister ? 'Already have an account? Sign In here' : "Need an account? Register with 1,000 demo credits"}
          </button>
        </div>
      </div>
    </div>
  );
};
