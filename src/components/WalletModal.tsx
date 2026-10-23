import React, { useState, useEffect } from 'react';
import {
  X,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  History,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Clock,
  Send,
  Building2,
  Smartphone,
  Zap,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../utils/api.js';
import { User, GameConfig, DepositRequest, WithdrawalRequest, WalletLedgerEntry } from '../types/index.js';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  config: GameConfig | null;
  onBalanceUpdated: (newBalance: number) => void;
}

type WalletTab = 'deposit' | 'withdraw' | 'history';
type DepositMethod = 'zappay' | 'manual';

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  user,
  config,
  onBalanceUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<WalletTab>('deposit');
  const [depositMethod, setDepositMethod] = useState<DepositMethod>('zappay');
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ZapPay Gateway State
  const [zappayAmount, setZappayAmount] = useState<number>(99);
  const [zappayLoading, setZapPayLoading] = useState(false);
  const [zappayPolling, setZapPayPolling] = useState(false);
  const [activeZapPayOrder, setActiveZapPayOrder] = useState<{
    orderId: string;
    paymentUrl: string;
    directPayUrl: string;
    amount: number;
    status: string;
  } | null>(null);

  // Manual Deposit Form State
  const [depositAmount, setDepositAmount] = useState<number>(500);
  const [activeDeposit, setActiveDeposit] = useState<DepositRequest | null>(null);
  const [utrInput, setUtrInput] = useState<string>('');
  const [evidenceNote, setEvidenceNote] = useState<string>('');

  // Withdrawal Form State
  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(500);
  const [payoutMethod, setPayoutMethod] = useState<'UPI' | 'BANK'>('UPI');
  const [payoutTarget, setPayoutTarget] = useState<string>('');

  // History State
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [userDeposits, setUserDeposits] = useState<DepositRequest[]>([]);
  const [userWithdrawals, setUserWithdrawals] = useState<WithdrawalRequest[]>([]);

  const upiReceiver = config?.upiReceiverId || 'princesuhani@fam';
  const minDeposit = config?.minDepositAmount || 100;
  const maxDeposit = config?.maxDepositAmount || 100000;
  const minWithdrawal = config?.minWithdrawalAmount || 200;
  const maxWithdrawal = config?.maxWithdrawalAmount || 50000;

  useEffect(() => {
    if (isOpen && user) {
      loadWalletData();
    }
  }, [isOpen, user, activeTab]);

  const loadWalletData = async () => {
    try {
      const data = await api.getWallet();
      setLedger(data.ledger || []);
      setUserDeposits(data.deposits || []);
      setUserWithdrawals(data.withdrawals || []);
      onBalanceUpdated(data.balance);
    } catch (err: any) {
      console.warn('Failed to load wallet data:', err);
    }
  };

  const handleCopyUpi = () => {
    navigator.clipboard.writeText(upiReceiver);
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  // ----------------------------------------------------
  // ZAPPAY API GATEWAY HANDLERS
  // ----------------------------------------------------

  const handleInitiateZapPay = async (customAmt?: number) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!user) return;
    const amountToPay = customAmt || zappayAmount || 99;

    try {
      setZapPayLoading(true);
      const res = await api.initiateZapPayDeposit(amountToPay);
      setActiveZapPayOrder({
        orderId: res.orderId,
        paymentUrl: res.paymentUrl,
        directPayUrl: res.directPayUrl || 'https://panel.zappay.shop/pay.html?id=3ad9a798',
        amount: res.amount,
        status: 'pending',
      });
      setSuccessMsg(`ZapPay session created for Order #${res.orderId}. Opening checkout...`);

      // Open ZapPay checkout page in a new window or tab
      const targetUrl = res.directPayUrl || res.paymentUrl;
      const opened = window.open(targetUrl, '_blank');
      if (!opened) {
        console.warn('Popup blocked, link presented in UI');
      }

      // Start auto-checking payment status
      startZapPayPolling(res.orderId);
      loadWalletData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initiate ZapPay payment');
    } finally {
      setZapPayLoading(false);
    }
  };

  const handleCheckZapPayStatus = async (orderId: string, showNotify: boolean = false) => {
    try {
      const res = await api.checkZapPayStatus(orderId);
      if (res.status === 'success') {
        setActiveZapPayOrder((prev) => (prev ? { ...prev, status: 'success' } : null));
        setSuccessMsg(`Payment of ₹${activeZapPayOrder?.amount || 99} verified via ZapPay API! Ledger credited.`);
        if (typeof res.newBalance === 'number') {
          onBalanceUpdated(res.newBalance);
        }
        loadWalletData();
        return true;
      } else if (res.status === 'failed' || res.status === 'timeout') {
        setActiveZapPayOrder((prev) => (prev ? { ...prev, status: res.status } : null));
        setErrorMsg(`ZapPay reported transaction ${res.status}.`);
        return true;
      } else if (showNotify) {
        setSuccessMsg('Payment status is still pending in ZapPay. Checking with bank...');
      }
      return false;
    } catch (err: any) {
      if (showNotify) setErrorMsg(err.message || 'Could not verify status');
      return false;
    }
  };

  const startZapPayPolling = (orderId: string) => {
    setZapPayPolling(true);
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const done = await handleCheckZapPayStatus(orderId, false);
      if (done || attempts >= 40) {
        clearInterval(interval);
        setZapPayPolling(false);
      }
    }, 3000);
  };

  // 1. Create Manual Deposit Request
  const handleInitiateDeposit = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!user) return;
    if (depositAmount < minDeposit || depositAmount > maxDeposit) {
      setErrorMsg(`Deposit amount must be between ₹${minDeposit} and ₹${maxDeposit}`);
      return;
    }

    try {
      setLoading(true);
      const res = await api.createDeposit(depositAmount);
      setActiveDeposit(res.deposit);
      setSuccessMsg(`Deposit request ${res.deposit.reference} created. Please pay via UPI and submit your 12-digit UTR.`);
      loadWalletData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create deposit request');
    } finally {
      setLoading(false);
    }
  };

  // 2. Submit UTR / Payment Evidence
  const handleSubmitUtr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDeposit) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanUtr = utrInput.trim();
    if (cleanUtr.length < 6) {
      setErrorMsg('Please enter a valid UPI UTR / Transaction Reference number');
      return;
    }

    try {
      setLoading(true);
      const res = await api.submitDepositEvidence(activeDeposit.id, cleanUtr, evidenceNote);
      setActiveDeposit(res.deposit);
      setSuccessMsg(`Payment reference submitted! An administrator has been notified to verify and credit ₹${res.deposit.amount.toFixed(2)}.`);
      setUtrInput('');
      setEvidenceNote('');
      loadWalletData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit payment reference');
    } finally {
      setLoading(false);
    }
  };

  // 3. Create Withdrawal Request
  const handleInitiateWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!user) return;

    if (withdrawalAmount < minWithdrawal || withdrawalAmount > maxWithdrawal) {
      setErrorMsg(`Withdrawal amount must be between ₹${minWithdrawal} and ₹${maxWithdrawal}`);
      return;
    }

    if (user.balance < withdrawalAmount) {
      setErrorMsg(`Insufficient available balance. Your balance is ₹${user.balance.toFixed(2)}`);
      return;
    }

    if (!payoutTarget.trim() || payoutTarget.trim().length < 5) {
      setErrorMsg('Please enter valid payout details (UPI ID or Bank Account with IFSC)');
      return;
    }

    try {
      setLoading(true);
      const res = await api.createWithdrawal(withdrawalAmount, payoutMethod, payoutTarget.trim());
      setSuccessMsg(`Withdrawal request ${res.withdrawal.reference} created. ₹${res.withdrawal.amount.toFixed(2)} has been reserved and an administrator has been notified.`);
      onBalanceUpdated(res.newBalance);
      setPayoutTarget('');
      loadWalletData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initiate withdrawal');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in select-none">
      <div className="bg-[#10121a] border border-[#262a3b] rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#202434] bg-[#131622]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-600 to-green-700 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-['Chakra_Petch'] flex items-center gap-2">
                Account Wallet &amp; Payout Center
              </h2>
              <p className="text-[11px] text-zinc-400">
                Authoritative balance: <strong className="text-emerald-400 font-mono">₹{user?.balance.toFixed(2) || '0.00'}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#1a1d28] hover:bg-[#25293a] text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 border-b border-[#202434] bg-[#11131c]">
          {[
            { id: 'deposit', label: 'Deposit UPI', icon: ArrowDownCircle },
            { id: 'withdraw', label: 'Withdraw Payout', icon: ArrowUpCircle },
            { id: 'history', label: 'Ledger History', icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as WalletTab);
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`py-3 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition cursor-pointer ${
                  active
                    ? 'border-emerald-500 text-white bg-emerald-950/20'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-emerald-400' : 'text-zinc-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Notifications */}
        {errorMsg && (
          <div className="bg-red-950/90 border-b border-red-700 px-4 py-2.5 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="bg-emerald-950/90 border-b border-emerald-600 px-4 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Telegram Bot Live Notification Bar */}
        <div className="bg-[#131e2c] border-b border-[#1f374e] px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-blue-200">
            <Send className="w-3.5 h-3.5 text-[#229ED9] shrink-0" />
            <span>Instant deposit confirmation &amp; payout alerts via Telegram Bot:</span>
          </div>
          <a
            href="https://t.me/aviatorprince0001_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-[#229ED9] hover:text-[#6ec8f7] underline shrink-0 flex items-center gap-1"
          >
            @aviatorprince0001_bot
          </a>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* TAB 1: DEPOSIT WORKFLOW */}
          {activeTab === 'deposit' && (
            <div className="space-y-4">
              {/* Method Switcher */}
              <div className="grid grid-cols-2 gap-2 bg-[#10121b] p-1.5 rounded-xl border border-[#232738]">
                <button
                  type="button"
                  onClick={() => {
                    setDepositMethod('zappay');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                    depositMethod === 'zappay'
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-950/50'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Zap className={`w-3.5 h-3.5 ${depositMethod === 'zappay' ? 'text-amber-300 fill-amber-300' : 'text-zinc-400'}`} />
                  <span>ZapPay Instant UPI</span>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 bg-amber-400/20 text-amber-300 rounded font-black border border-amber-400/30">
                    Auto API
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDepositMethod('manual');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                    depositMethod === 'manual'
                      ? 'bg-[#1b2030] text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Direct UPI Transfer</span>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-black border border-emerald-500/20">
                    UTR
                  </span>
                </button>
              </div>

              {/* METHOD 1: ZAPPAY ONLINE GATEWAY */}
              {depositMethod === 'zappay' && (
                <div className="bg-gradient-to-b from-[#141b2d] to-[#121624] border border-[#233352] rounded-2xl p-4 shadow-lg space-y-4 animate-fade-in">
                  <div className="flex items-center justify-between border-b border-[#222e48] pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-900/40">
                        <Zap className="w-5 h-5 text-amber-300 fill-amber-300" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                          ZapPay Fast Checkout
                          <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-mono font-bold border border-blue-500/30">
                            API Live
                          </span>
                        </h3>
                        <p className="text-[11px] text-zinc-400">
                          Merchant: <strong className="text-zinc-200">Pritam Kumar (Quizcrafts)</strong> • Receiver: <code className="text-amber-400">princesuhani@fam</code>
                        </p>
                      </div>
                    </div>
                    <a
                      href="https://panel.zappay.shop/pay.html?id=3ad9a798"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 underline font-semibold"
                    >
                      <span>Direct Link</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-300">Select Deposit Amount:</span>
                      <span className="text-[11px] text-zinc-400">Official Link: <strong>₹99</strong></span>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      {[99, 200, 500, 1000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setZappayAmount(amt)}
                          className={`py-2 rounded-xl font-mono font-bold text-xs border transition cursor-pointer ${
                            zappayAmount === amt
                              ? 'bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-950/60'
                              : 'bg-[#181f33] border-[#252f4a] text-zinc-400 hover:text-white'
                          }`}
                        >
                          ₹{amt}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center bg-[#101422] border border-[#273554] rounded-xl px-3 py-2.5">
                      <span className="text-blue-400 font-bold font-mono text-base mr-2">₹</span>
                      <input
                        type="number"
                        min={10}
                        max={maxDeposit}
                        value={zappayAmount}
                        onChange={(e) => setZappayAmount(Number(e.target.value))}
                        className="w-full bg-transparent font-mono font-bold text-white text-base outline-none"
                        placeholder="Custom amount"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleInitiateZapPay(zappayAmount)}
                      disabled={zappayLoading || zappayAmount <= 0}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm shadow-xl shadow-blue-950/60 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {zappayLoading ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
                      )}
                      <span>Pay ₹{zappayAmount.toFixed(0)} with ZapPay Gateway</span>
                    </button>

                    <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1">
                      <span className="flex items-center gap-1 text-emerald-400">
                        <ShieldCheck className="w-3.5 h-3.5" /> 100% Encrypted &amp; Instant API Callback
                      </span>
                      <span>Supports GPay, PhonePe, Paytm, QR</span>
                    </div>
                  </div>

                  {/* Active ZapPay Session Card */}
                  {activeZapPayOrder && (
                    <div className="bg-[#0e121d] border border-blue-500/40 rounded-xl p-4 space-y-3 animate-fade-in mt-3">
                      <div className="flex items-center justify-between border-b border-[#1f2940] pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-blue-300">Active ZapPay Session</span>
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800">
                            {activeZapPayOrder.orderId}
                          </span>
                        </div>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                            activeZapPayOrder.status === 'success'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-600'
                              : activeZapPayOrder.status === 'failed'
                              ? 'bg-red-950 text-red-300 border border-red-600'
                              : 'bg-amber-950 text-amber-300 border border-amber-600 animate-pulse'
                          }`}
                        >
                          {activeZapPayOrder.status === 'success'
                            ? 'CONFIRMED ✅'
                            : activeZapPayOrder.status === 'failed'
                            ? 'FAILED ❌'
                            : 'AWAITING PAYMENT ⏳'}
                        </span>
                      </div>

                      <div className="text-xs text-zinc-300 space-y-1">
                        <p>
                          Amount: <strong className="text-white font-mono">₹{activeZapPayOrder.amount.toFixed(2)}</strong>
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {activeZapPayOrder.status === 'success'
                            ? 'Payment verified via ZapPay API and added to your ledger.'
                            : 'A checkout window opened. After completing payment in ZapPay / UPI, click verify below:'}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleCheckZapPayStatus(activeZapPayOrder.orderId, true)}
                          disabled={zappayPolling}
                          className="py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${zappayPolling ? 'animate-spin' : ''}`} />
                          <span>Check Status Now</span>
                        </button>

                        <a
                          href={activeZapPayOrder.directPayUrl || activeZapPayOrder.paymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2 px-3 rounded-lg bg-[#192238] hover:bg-[#222e4d] text-blue-200 border border-blue-500/30 font-bold text-xs flex items-center justify-center gap-1.5 transition text-center"
                        >
                          <span>Re-open Checkout</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* METHOD 2: DIRECT UPI TRANSFER WITH 12-DIGIT UTR */}
              {depositMethod === 'manual' && (
                <div className="space-y-4 animate-fade-in">
                  {/* UPI Receiver Info Card */}
                  <div className="bg-[#151824] border border-[#272c3d] rounded-xl p-4 shadow-sm">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block mb-2">
                      Official Configured UPI Receiver ID:
                    </span>
                    <div className="flex items-center justify-between bg-[#1a1e2d] border border-[#2e3448] rounded-xl px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-amber-400" />
                        <span className="font-mono font-black text-white text-base select-all">
                          {upiReceiver}
                        </span>
                      </div>
                      <button
                        onClick={handleCopyUpi}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer shadow-md shadow-emerald-950/50"
                      >
                        {copiedUpi ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedUpi ? 'Copied!' : 'Copy UPI ID'}</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-2">
                      Supported apps: Google Pay, PhonePe, Paytm, BHIM, Cred, or any UPI client.
                    </p>
                  </div>

                  {/* Step 1: Amount Selection */}
                  <div className="bg-[#151824] border border-[#272c3d] rounded-xl p-4 space-y-3">
                    <span className="text-xs font-bold text-white block">
                      1. Select Deposit Amount (₹{minDeposit} — ₹{maxDeposit.toLocaleString()})
                    </span>

                    <div className="grid grid-cols-4 gap-2">
                      {[100, 500, 1000, 2000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setDepositAmount(amt)}
                          className={`py-2 rounded-lg font-mono font-bold text-xs border transition cursor-pointer ${
                            depositAmount === amt
                              ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 shadow-sm'
                              : 'bg-[#1b1f2e] border-[#2b3145] text-zinc-400 hover:text-white'
                          }`}
                        >
                          ₹{amt}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center bg-[#1a1e2d] border border-[#2e3448] rounded-xl px-3 py-2">
                      <span className="text-zinc-400 font-bold font-mono mr-2">₹</span>
                      <input
                        type="number"
                        min={minDeposit}
                        max={maxDeposit}
                        step={50}
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(Number(e.target.value))}
                        className="w-full bg-transparent font-mono font-bold text-white text-base outline-none"
                        placeholder="Enter custom amount"
                      />
                    </div>

                    <button
                      onClick={handleInitiateDeposit}
                      disabled={loading || depositAmount < minDeposit}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition cursor-pointer disabled:opacity-50"
                    >
                      Generate Deposit Reference &amp; Instructions
                    </button>
                  </div>

                  {/* Step 2: Evidence Submission */}
                  {activeDeposit && (
                    <form onSubmit={handleSubmitUtr} className="bg-[#151824] border border-amber-600/40 rounded-xl p-4 space-y-3 animate-fade-in">
                      <div className="flex items-center justify-between border-b border-[#252a3b] pb-2">
                        <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-amber-400" /> Step 2: Submit 12-Digit UPI UTR
                        </span>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-bold">
                          {activeDeposit.reference}
                        </span>
                      </div>

                      <p className="text-xs text-zinc-300 leading-relaxed">
                        Transfer <strong>₹{activeDeposit.amount.toFixed(2)}</strong> to <code>{activeDeposit.upiReceiverId}</code>.
                        Once complete, copy the <strong>12-digit UTR / UPI Reference No.</strong> from your banking app and submit below.
                      </p>

                      <div>
                        <label className="text-[11px] text-zinc-400 font-semibold block mb-1">
                          * 12-Digit UPI UTR / Transaction Reference Number:
                        </label>
                        <input
                          type="text"
                          required
                          minLength={6}
                          maxLength={32}
                          placeholder="e.g. 423819283921"
                          value={utrInput}
                          onChange={(e) => setUtrInput(e.target.value)}
                          className="w-full bg-[#1a1e2d] border border-[#2e3448] rounded-xl px-3 py-2 font-mono text-white text-sm outline-none focus:border-amber-400"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-zinc-400 font-semibold block mb-1">
                          Optional Note / Sender Name:
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Sent from Amit GPay"
                          value={evidenceNote}
                          onChange={(e) => setEvidenceNote(e.target.value)}
                          className="w-full bg-[#1a1e2d] border border-[#2e3448] rounded-xl px-3 py-2 text-zinc-200 text-xs outline-none focus:border-amber-400"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading || !utrInput.trim()}
                        className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs shadow-lg shadow-amber-950/60 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Submit Payment for Verification</span>
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: WITHDRAWAL WORKFLOW */}
          {activeTab === 'withdraw' && (
            <form onSubmit={handleInitiateWithdrawal} className="space-y-4">
              <div className="bg-[#151824] border border-[#272c3d] rounded-xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-bold block">
                    Available Withdrawable Balance
                  </span>
                  <div className="text-2xl font-black text-emerald-400 font-mono mt-0.5">
                    ₹{user?.balance.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div className="text-right text-[11px] text-zinc-400 font-mono">
                  Min: ₹{minWithdrawal} • Max: ₹{maxWithdrawal.toLocaleString()}
                </div>
              </div>

              {/* Amount Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 block">
                  Withdrawal Amount (₹)
                </label>
                <div className="flex items-center bg-[#1a1e2d] border border-[#2e3448] rounded-xl px-3 py-2">
                  <span className="text-zinc-400 font-bold font-mono mr-2">₹</span>
                  <input
                    type="number"
                    min={minWithdrawal}
                    max={maxWithdrawal}
                    step={50}
                    value={withdrawalAmount}
                    onChange={(e) => setWithdrawalAmount(Number(e.target.value))}
                    className="w-full bg-transparent font-mono font-bold text-white text-base outline-none"
                    placeholder="Enter amount to withdraw"
                  />
                </div>
              </div>

              {/* Payout Method */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 block">
                  Payout Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayoutMethod('UPI')}
                    className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition cursor-pointer ${
                      payoutMethod === 'UPI'
                        ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300'
                        : 'bg-[#1a1e2d] border-[#2e3448] text-zinc-400'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>UPI Payout</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPayoutMethod('BANK')}
                    className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition cursor-pointer ${
                      payoutMethod === 'BANK'
                        ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300'
                        : 'bg-[#1a1e2d] border-[#2e3448] text-zinc-400'
                    }`}
                  >
                    <Building2 className="w-4 h-4" />
                    <span>Bank Transfer</span>
                  </button>
                </div>
              </div>

              {/* Payout Target */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 block">
                  {payoutMethod === 'UPI' ? 'Your UPI ID (VPA)' : 'Bank Account Number & IFSC'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={payoutMethod === 'UPI' ? 'e.g. mobile@paytm or name@okhdfcbank' : 'e.g. 501002391290, HDFC0001234'}
                  value={payoutTarget}
                  onChange={(e) => setPayoutTarget(e.target.value)}
                  className="w-full bg-[#1a1e2d] border border-[#2e3448] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              {/* Safety notice */}
              <p className="text-[11px] text-zinc-400 bg-[#151824] p-3 rounded-xl border border-[#24293a] leading-relaxed">
                <strong>Atomic Reservation:</strong> The requested amount is immediately reserved from your available balance. An administrator verifies the request and executes the payout to your specified target. If rejected, funds are automatically refunded to your account.
              </p>

              <button
                type="submit"
                disabled={loading || (user?.balance || 0) < withdrawalAmount}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Processing...' : `Submit Withdrawal Request (₹${withdrawalAmount.toFixed(2)})`}
              </button>
            </form>
          )}

          {/* TAB 3: IMMUTABLE LEDGER & REQUEST HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[11px]">Authoritative Ledger</span>
                <span>{ledger.length} events</span>
              </div>

              <div className="bg-[#151824] border border-[#272c3d] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#0f111a] text-zinc-400 font-bold uppercase text-[10px] border-b border-[#212638]">
                      <tr>
                        <th className="p-2.5">Type</th>
                        <th className="p-2.5">Amount</th>
                        <th className="p-2.5">Balance After</th>
                        <th className="p-2.5">Reference / Description</th>
                        <th className="p-2.5 text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2336]">
                      {ledger.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-zinc-500 text-xs italic">
                            No ledger transactions recorded yet.
                          </td>
                        </tr>
                      ) : (
                        ledger.map((entry) => (
                          <tr key={entry.id} className="hover:bg-[#1a1e2d]">
                            <td className="p-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  entry.type === 'DEPOSIT' || entry.type === 'CASHOUT' || entry.type === 'WITHDRAWAL_REFUND'
                                    ? 'bg-emerald-950 text-emerald-400'
                                    : 'bg-red-950 text-red-400'
                                }`}
                              >
                                {entry.type}
                              </span>
                            </td>
                            <td
                              className={`p-2.5 font-bold ${
                                entry.amount >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {entry.amount >= 0 ? `+₹${entry.amount.toFixed(2)}` : `-₹${Math.abs(entry.amount).toFixed(2)}`}
                            </td>
                            <td className="p-2.5 text-zinc-300">₹{entry.balanceAfter.toFixed(2)}</td>
                            <td className="p-2.5 text-zinc-400 text-[11px] max-w-[200px] truncate" title={entry.description}>
                              {entry.referenceId} ({entry.description})
                            </td>
                            <td className="p-2.5 text-right text-zinc-500 text-[10px]">
                              {new Date(entry.createdAt).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
