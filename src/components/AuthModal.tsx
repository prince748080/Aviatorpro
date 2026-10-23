import React, { useState } from 'react';
import { X, LogIn, UserPlus, ShieldAlert, Phone, Lock, User as UserIcon } from 'lucide-react';
import { api } from '../utils/api.js';
import { User } from '../types/index.js';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
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
        const cleanPhone = phoneNumber.trim();
        const digits = cleanPhone.replace(/\D/g, '');
        if (!cleanPhone || digits.length < 10) {
          throw new Error('Please enter a valid 10-digit mobile phone number.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }

        const res = await api.register({
          phoneNumber: cleanPhone,
          password,
          username: username.trim() || undefined,
        });
        onSuccess(res.user);
        onClose();
      } else {
        const identifier = (phoneNumber || username).trim();
        if (!identifier) {
          throw new Error('Please enter your phone number or username.');
        }
        if (!password) {
          throw new Error('Please enter your password.');
        }

        const res = await api.login(identifier, password);
        onSuccess(res.user);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (targetRegister: boolean) => {
    setIsRegister(targetRegister);
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
              {isRegister ? 'Register New Pilot Account' : 'Pilot Sign In'}
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
          {isRegister ? (
            <>
              {/* Phone Number (Primary Identifier for Registration) */}
              <div>
                <label className="text-zinc-300 text-xs font-semibold block mb-1 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-red-400" />
                  <span>Mobile Phone Number</span>
                  <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-zinc-400 text-sm font-semibold select-none">+91</span>
                  <input
                    type="tel"
                    required
                    pattern="[0-9]{10}"
                    maxLength={10}
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="9876543210"
                    className="w-full bg-[#171a25] border border-[#272b3c] rounded-xl pl-12 pr-3 py-2 text-white text-sm outline-none focus:border-red-500 font-mono transition"
                  />
                </div>
                <span className="text-[11px] text-zinc-500 mt-0.5 block">Your 10-digit mobile number for account security</span>
              </div>

              {/* Optional Call Sign / Username */}
              <div>
                <label className="text-zinc-300 text-xs font-semibold block mb-1 flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Pilot Call Sign / Name</span>
                  <span className="text-zinc-500 text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. CaptainPro"
                  className="w-full bg-[#171a25] border border-[#272b3c] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-red-500 transition"
                />
              </div>
            </>
          ) : (
            <>
              {/* Sign In Identifier: Phone Number or Username */}
              <div>
                <label className="text-zinc-300 text-xs font-semibold block mb-1 flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5 text-red-400" />
                  <span>Phone Number or Username</span>
                  <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. 9876543210 or pilot name"
                  className="w-full bg-[#171a25] border border-[#272b3c] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-red-500 transition"
                />
              </div>
            </>
          )}

          {/* Password */}
          <div>
            <label className="text-zinc-300 text-xs font-semibold block mb-1 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-red-400" />
              <span>Password</span>
              <span className="text-red-400">*</span>
            </label>
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
            {loading ? 'Authenticating...' : isRegister ? 'Register Pilot Account' : 'Sign In'}
          </button>
        </form>

        {/* Switch mode */}
        <div className="text-center pt-2 border-t border-[#202434]">
          <button
            type="button"
            onClick={() => switchMode(!isRegister)}
            className="text-xs text-red-400 hover:text-red-300 font-semibold cursor-pointer transition"
          >
            {isRegister ? 'Already registered? Sign In here' : "Don't have an account? Register with Phone Number"}
          </button>
        </div>
      </div>
    </div>
  );
};
