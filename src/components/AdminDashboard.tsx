import React, { useState, useEffect } from 'react';
import {
  X,
  LayoutDashboard,
  ArrowDownCircle,
  ArrowUpCircle,
  Gamepad2,
  Users,
  WalletCards,
  Activity,
  FileText,
  Pause,
  Play,
  Wrench,
  Search,
  CheckCircle,
  AlertTriangle,
  Download,
  Shield,
  RefreshCw,
  Send,
  Check,
  Ban,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { api } from '../utils/api.js';
import {
  User,
  GameConfig,
  WalletLedgerEntry,
  AuditLogEntry,
  DepositRequest,
  WithdrawalRequest,
} from '../types/index.js';

interface AdminDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
}

type TabType =
  | 'overview'
  | 'deposits'
  | 'withdrawals'
  | 'game'
  | 'users'
  | 'ledger'
  | 'system'
  | 'audit';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ isOpen, onClose, currentUser }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Data states
  const [overviewData, setOverviewData] = useState<any>(null);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [depositsList, setDepositsList] = useState<DepositRequest[]>([]);
  const [withdrawalsList, setWithdrawalsList] = useState<WithdrawalRequest[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<WalletLedgerEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [telegramStatus, setTelegramStatus] = useState<any>(null);

  // Form states for config editing
  const [configForm, setConfigForm] = useState<Partial<GameConfig>>({});
  const [configAuditReason, setConfigAuditReason] = useState<string>('');

  // Search filters
  const [userSearch, setUserSearch] = useState('');
  const [depositSearch, setDepositSearch] = useState('');
  const [withdrawalSearch, setWithdrawalSearch] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');

  // User suspend modal
  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadAllData();
    }
  }, [isOpen, activeTab]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'overview' || activeTab === 'system') {
        const ov = await api.getAdminOverview();
        setOverviewData(ov);
        setConfig(ov.config);
        setConfigForm(ov.config);
        const tg = await api.getTelegramStatus();
        setTelegramStatus(tg);
      } else if (activeTab === 'deposits') {
        const d = await api.getAdminDeposits();
        setDepositsList(d.deposits);
      } else if (activeTab === 'withdrawals') {
        const w = await api.getAdminWithdrawals();
        setWithdrawalsList(w.withdrawals);
      } else if (activeTab === 'game') {
        const cfg = await api.getConfig();
        setConfig(cfg.config);
        setConfigForm(cfg.config);
      } else if (activeTab === 'users') {
        const u = await api.getAdminUsers();
        setUsersList(u.users);
      } else if (activeTab === 'ledger') {
        const l = await api.getAdminLedger(200);
        setLedgerEntries(l.ledger);
      } else if (activeTab === 'audit') {
        const logs = await api.getAdminLogs(200);
        setAuditLogs(logs.logs);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed loading admin data');
    } finally {
      setLoading(false);
    }
  };

  const showSuccess = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 4000);
  };

  // Deposit Actions
  const handleApproveDeposit = async (dep: DepositRequest) => {
    const confirmApprove = window.confirm(
      `Confirm Approval: Have you verified receipt of ₹${dep.amount.toFixed(2)} with UTR "${dep.userUtrReference || 'N/A'}" on payment receiver ${dep.upiReceiverId}?`
    );
    if (!confirmApprove) return;

    try {
      setLoading(true);
      const res = await api.approveDeposit(dep.id, `Verified payment with UTR ${dep.userUtrReference}`);
      showSuccess(`Deposit ${dep.reference} approved! Credited ₹${dep.amount.toFixed(2)} to ${dep.username}.`);
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to approve deposit');
    } finally {
      setLoading(false);
    }
  };

  const handleRejectDeposit = async (dep: DepositRequest) => {
    const reason = window.prompt(`Enter reason for rejecting deposit ${dep.reference}:`, 'Invalid or unverified UTR');
    if (!reason) return;

    try {
      setLoading(true);
      await api.rejectDeposit(dep.id, reason);
      showSuccess(`Deposit ${dep.reference} rejected.`);
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to reject deposit');
    } finally {
      setLoading(false);
    }
  };

  // Withdrawal Actions
  const handleCompleteWithdrawal = async (wth: WithdrawalRequest) => {
    const payoutUtr = window.prompt(
      `Enter payment provider Payout UTR / Transaction Reference after transferring ₹${wth.amount.toFixed(2)} to ${wth.payoutTarget}:`
    );
    if (!payoutUtr || !payoutUtr.trim()) return;

    try {
      setLoading(true);
      await api.completeWithdrawal(wth.id, payoutUtr.trim());
      showSuccess(`Withdrawal ${wth.reference} marked as completed and paid.`);
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to complete withdrawal');
    } finally {
      setLoading(false);
    }
  };

  const handleRejectWithdrawal = async (wth: WithdrawalRequest) => {
    const reason = window.prompt(
      `Enter reason for declining withdrawal ${wth.reference} (Reserved ₹${wth.amount.toFixed(2)} will be refunded to user):`,
      'Incorrect account details or compliance review'
    );
    if (!reason) return;

    try {
      setLoading(true);
      await api.rejectWithdrawal(wth.id, reason);
      showSuccess(`Withdrawal ${wth.reference} rejected and ₹${wth.amount.toFixed(2)} refunded to user balance.`);
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to reject withdrawal');
    } finally {
      setLoading(false);
    }
  };

  const handlePauseGame = async () => {
    const reason = window.prompt('Enter audit reason for pausing the game:');
    if (!reason) return;
    try {
      await api.pauseGame(reason);
      showSuccess('Game paused successfully.');
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleResumeGame = async () => {
    const reason = window.prompt('Enter audit reason for resuming the game:');
    if (!reason) return;
    try {
      await api.resumeGame(reason);
      showSuccess('Game resumed successfully.');
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleToggleMaintenance = async () => {
    if (!config) return;
    const nextState = !config.maintenanceMode;
    const reason = window.prompt(`Enter audit reason to ${nextState ? 'ENABLE' : 'DISABLE'} maintenance mode:`);
    if (!reason) return;
    try {
      await api.toggleMaintenance(nextState, reason);
      showSuccess(`Maintenance mode set to ${nextState ? 'Active' : 'Off'}.`);
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configAuditReason.trim()) {
      alert('An explicit audit reason is required for any configuration change.');
      return;
    }
    try {
      setLoading(true);
      await api.updateConfig(configForm, configAuditReason);
      showSuccess('Game configuration updated and audit log recorded.');
      setConfigAuditReason('');
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUserStatus = async () => {
    if (!targetUser || !suspendReason.trim()) return;
    const newStatus = targetUser.status === 'active' ? 'suspended' : 'active';
    try {
      await api.updateUserStatus(targetUser.id, newStatus, suspendReason);
      showSuccess(`User ${targetUser.username} status updated to ${newStatus}.`);
      setTargetUser(null);
      setSuspendReason('');
      loadAllData();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleExportLedger = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(ledgerEntries, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `aviator_ledger_export_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in select-none">
      <div className="bg-[#0f1118] border border-[#262a3b] rounded-2xl w-full max-w-6xl h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#202434] bg-[#12141e]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-['Chakra_Petch'] flex items-center gap-2">
                Aviator Pro Administrator Console
                <span className="text-[10px] bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 rounded-full font-mono">
                  AUTHORITATIVE
                </span>
              </h2>
              <p className="text-[11px] text-zinc-400">
                Live engine controls, UPI deposit verification, payout approvals &amp; Telegram bot
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadAllData}
              className="p-2 rounded-lg bg-[#1a1d28] hover:bg-[#25293a] text-zinc-400 hover:text-white transition cursor-pointer"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-[#1a1d28] hover:bg-[#25293a] text-zinc-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-4 border-b border-[#202434] bg-[#11131c] overflow-x-auto no-scrollbar">
          {[
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'deposits', label: 'Deposits', icon: ArrowDownCircle },
            { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpCircle },
            { id: 'game', label: 'Game Config', icon: Gamepad2 },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'ledger', label: 'Ledger', icon: WalletCards },
            { id: 'system', label: 'System & Bot', icon: Activity },
            { id: 'audit', label: 'Audit Trail', icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 transition cursor-pointer whitespace-nowrap ${
                  active
                    ? 'border-red-500 text-white bg-red-950/20'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-red-400' : 'text-zinc-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Toast alerts */}
        {actionMessage && (
          <div className="bg-emerald-950/90 border-b border-emerald-600 text-emerald-200 px-4 py-2 text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionMessage}</span>
          </div>
        )}
        {errorMessage && (
          <div className="bg-red-950/90 border-b border-red-600 text-red-200 px-4 py-2 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && overviewData && (
            <div className="space-y-6">
              {/* Top Financial & User KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#141722] border border-[#232737] rounded-xl p-4">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Total Approved Deposits</span>
                  <div className="text-2xl font-black text-emerald-400 font-mono mt-1">
                    ₹{overviewData.stats.totalDeposited.toLocaleString()}
                  </div>
                  <span className="text-[11px] text-amber-400 font-medium">
                    {overviewData.stats.pendingDepositsCount} pending verification
                  </span>
                </div>

                <div className="bg-[#141722] border border-[#232737] rounded-xl p-4">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Total Paid Withdrawals</span>
                  <div className="text-2xl font-black text-rose-400 font-mono mt-1">
                    ₹{overviewData.stats.totalWithdrawn.toLocaleString()}
                  </div>
                  <span className="text-[11px] text-amber-400 font-medium">
                    {overviewData.stats.pendingWithdrawalsCount} pending review
                  </span>
                </div>

                <div className="bg-[#141722] border border-[#232737] rounded-xl p-4">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Total Registered Users</span>
                  <div className="text-2xl font-black text-white font-mono mt-1">
                    {overviewData.stats.totalUsers}
                  </div>
                  <span className="text-[11px] text-zinc-400">{overviewData.stats.activeUsers} active accounts</span>
                </div>

                <div className="bg-[#141722] border border-[#232737] rounded-xl p-4">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Completed Flights</span>
                  <div className="text-2xl font-black text-amber-400 font-mono mt-1">
                    {overviewData.stats.totalRounds}
                  </div>
                  <span className="text-[11px] text-zinc-400">Max Cap: {overviewData.config.maxMultiplier.toFixed(2)}x</span>
                </div>
              </div>

              {/* Game Engine Status & Quick Controls */}
              <div className="bg-[#141722] border border-[#232737] rounded-xl p-5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#212535]">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Gamepad2 className="w-4 h-4 text-red-500" /> Live Engine State
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      State: <strong>{overviewData.system.roundState}</strong> • Multiplier:{' '}
                      <strong>{overviewData.system.currentMultiplier.toFixed(2)}x</strong> • Active Pilots:{' '}
                      <strong>{overviewData.system.wsConnections}</strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {overviewData.config.gamePaused ? (
                      <button
                        onClick={handleResumeGame}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                      >
                        <Play className="w-3.5 h-3.5" /> Resume Engine
                      </button>
                    ) : (
                      <button
                        onClick={handlePauseGame}
                        className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                      >
                        <Pause className="w-3.5 h-3.5" /> Pause Engine
                      </button>
                    )}

                    <button
                      onClick={handleToggleMaintenance}
                      className={`px-3.5 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer border ${
                        overviewData.config.maintenanceMode
                          ? 'bg-red-950 text-red-300 border-red-700'
                          : 'bg-[#1b1e2b] text-zinc-300 border-[#2a2f42]'
                      }`}
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>{overviewData.config.maintenanceMode ? 'Exit Maint.' : 'Enter Maint.'}</span>
                    </button>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-red-950/30 border border-red-800/40 rounded-lg text-xs text-red-200">
                  <strong>Configured UPI Receiver:</strong> <code>{overviewData.config.upiReceiverId || 'princesuhani@fam'}</code>
                  <span className="mx-2">•</span>
                  <strong>Max Multiplier:</strong> {overviewData.config.maxMultiplier.toFixed(2)}x
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DEPOSITS MANAGEMENT */}
          {activeTab === 'deposits' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by ref, user, or UTR..."
                    value={depositSearch}
                    onChange={(e) => setDepositSearch(e.target.value)}
                    className="w-full bg-[#141722] border border-[#232737] rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-red-500"
                  />
                </div>
                <span className="text-xs text-zinc-400 font-mono">
                  {depositsList.length} total deposit requests
                </span>
              </div>

              <div className="bg-[#141722] border border-[#232737] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#10121a] text-zinc-400 font-bold uppercase text-[10px] border-b border-[#212535]">
                      <tr>
                        <th className="p-3">Reference</th>
                        <th className="p-3">User</th>
                        <th className="p-3">Amount</th>
                        <th className="p-3">Submitted UTR</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Created</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2233]">
                      {depositsList
                        .filter(
                          (d) =>
                            d.reference.toLowerCase().includes(depositSearch.toLowerCase()) ||
                            d.username.toLowerCase().includes(depositSearch.toLowerCase()) ||
                            (d.userUtrReference || '').toLowerCase().includes(depositSearch.toLowerCase())
                        )
                        .map((dep) => (
                          <tr key={dep.id} className="hover:bg-[#181b28]">
                            <td className="p-3 font-mono font-bold text-white">{dep.reference}</td>
                            <td className="p-3 font-semibold text-zinc-200">{dep.username}</td>
                            <td className="p-3 font-mono font-bold text-emerald-400">₹{dep.amount.toFixed(2)}</td>
                            <td className="p-3 font-mono text-amber-300 select-all font-semibold">
                              {dep.userUtrReference || <span className="text-zinc-600 italic">Not submitted</span>}
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  dep.status === 'APPROVED'
                                    ? 'bg-emerald-950 text-emerald-400'
                                    : dep.status === 'REJECTED'
                                    ? 'bg-red-950 text-red-400'
                                    : 'bg-amber-950 text-amber-400 animate-pulse'
                                }`}
                              >
                                {dep.status}
                              </span>
                            </td>
                            <td className="p-3 text-zinc-500 text-[10px]">
                              {new Date(dep.createdAt).toLocaleString()}
                            </td>
                            <td className="p-3 text-right">
                              {dep.status === 'PENDING_VERIFICATION' && (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleApproveDeposit(dep)}
                                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer flex items-center gap-1 shadow-sm"
                                  >
                                    <Check className="w-3 h-3" /> Approve
                                  </button>
                                  <button
                                    onClick={() => handleRejectDeposit(dep)}
                                    className="px-2 py-1 rounded bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 font-bold text-[11px] cursor-pointer"
                                  >
                                    <Ban className="w-3 h-3" /> Reject
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: WITHDRAWALS MANAGEMENT */}
          {activeTab === 'withdrawals' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by ref, user, or target..."
                    value={withdrawalSearch}
                    onChange={(e) => setWithdrawalSearch(e.target.value)}
                    className="w-full bg-[#141722] border border-[#232737] rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-red-500"
                  />
                </div>
                <span className="text-xs text-zinc-400 font-mono">
                  {withdrawalsList.length} total withdrawal requests
                </span>
              </div>

              <div className="bg-[#141722] border border-[#232737] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#10121a] text-zinc-400 font-bold uppercase text-[10px] border-b border-[#212535]">
                      <tr>
                        <th className="p-3">Reference</th>
                        <th className="p-3">User</th>
                        <th className="p-3">Amount</th>
                        <th className="p-3">Payout Target</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Payout UTR</th>
                        <th className="p-3">Created</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2233]">
                      {withdrawalsList
                        .filter(
                          (w) =>
                            w.reference.toLowerCase().includes(withdrawalSearch.toLowerCase()) ||
                            w.username.toLowerCase().includes(withdrawalSearch.toLowerCase()) ||
                            w.payoutTarget.toLowerCase().includes(withdrawalSearch.toLowerCase())
                        )
                        .map((wth) => (
                          <tr key={wth.id} className="hover:bg-[#181b28]">
                            <td className="p-3 font-mono font-bold text-white">{wth.reference}</td>
                            <td className="p-3 font-semibold text-zinc-200">{wth.username}</td>
                            <td className="p-3 font-mono font-bold text-rose-400">₹{wth.amount.toFixed(2)}</td>
                            <td className="p-3 font-mono text-zinc-300 select-all">
                              <span className="text-[10px] font-bold text-zinc-500 mr-1">[{wth.payoutMethod}]</span>
                              {wth.payoutTarget}
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  wth.status === 'COMPLETED'
                                    ? 'bg-emerald-950 text-emerald-400'
                                    : wth.status === 'REJECTED'
                                    ? 'bg-red-950 text-red-400'
                                    : 'bg-amber-950 text-amber-400 animate-pulse'
                                }`}
                              >
                                {wth.status}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-[11px] text-zinc-400">
                              {wth.payoutReference || '—'}
                            </td>
                            <td className="p-3 text-zinc-500 text-[10px]">
                              {new Date(wth.createdAt).toLocaleString()}
                            </td>
                            <td className="p-3 text-right">
                              {wth.status === 'PENDING_REVIEW' && (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleCompleteWithdrawal(wth)}
                                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer flex items-center gap-1 shadow-sm"
                                  >
                                    <Check className="w-3 h-3" /> Mark Paid
                                  </button>
                                  <button
                                    onClick={() => handleRejectWithdrawal(wth)}
                                    className="px-2 py-1 rounded bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 font-bold text-[11px] cursor-pointer"
                                  >
                                    <Ban className="w-3 h-3" /> Reject &amp; Refund
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: GAME MANAGEMENT & CONFIGURATION */}
          {activeTab === 'game' && config && (
            <div className="space-y-6">
              <form onSubmit={handleSaveConfig} className="bg-[#141722] border border-[#232737] rounded-xl p-5 space-y-4">
                <div className="border-b border-[#212535] pb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Gamepad2 className="w-4 h-4 text-red-500" /> Backend Configuration Editor
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Changes take effect on the next round and are permanently recorded in the audit log.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* UPI Receiver ID */}
                  <div>
                    <label className="text-zinc-300 text-xs font-semibold block mb-1">
                      UPI Receiver Identifier (Payment Account)
                    </label>
                    <input
                      type="text"
                      required
                      value={configForm.upiReceiverId || 'princesuhani@fam'}
                      onChange={(e) => setConfigForm({ ...configForm, upiReceiverId: e.target.value })}
                      className="w-full bg-[#1b1e2a] border border-[#2b3044] rounded-lg px-3 py-2 text-amber-300 font-mono text-sm outline-none focus:border-red-500 font-bold"
                    />
                    <span className="text-[10px] text-zinc-500">Configured receiver UPI ID displayed to players.</span>
                  </div>

                  {/* Maximum Multiplier Cap */}
                  <div>
                    <label className="text-zinc-300 text-xs font-semibold block mb-1">
                      Maximum Permitted Multiplier (Documented Cap)
                    </label>
                    <input
                      type="number"
                      step={0.05}
                      min={1.05}
                      max={100}
                      value={configForm.maxMultiplier || 2.0}
                      onChange={(e) => setConfigForm({ ...configForm, maxMultiplier: Number(e.target.value) })}
                      className="w-full bg-[#1b1e2a] border border-[#2b3044] rounded-lg px-3 py-2 text-white font-mono text-sm outline-none focus:border-red-500 font-bold"
                    />
                    <span className="text-[10px] text-zinc-500">Enforced by authoritative game loop.</span>
                  </div>

                  {/* Min / Max Deposit */}
                  <div>
                    <label className="text-zinc-300 text-xs font-semibold block mb-1">Min / Max Deposit (₹)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={10}
                        value={configForm.minDepositAmount || 100}
                        onChange={(e) => setConfigForm({ ...configForm, minDepositAmount: Number(e.target.value) })}
                        className="bg-[#1b1e2a] border border-[#2b3044] rounded-lg px-3 py-2 text-white font-mono text-sm outline-none"
                      />
                      <input
                        type="number"
                        min={100}
                        value={configForm.maxDepositAmount || 100000}
                        onChange={(e) => setConfigForm({ ...configForm, maxDepositAmount: Number(e.target.value) })}
                        className="bg-[#1b1e2a] border border-[#2b3044] rounded-lg px-3 py-2 text-white font-mono text-sm outline-none"
                      />
                    </div>
                  </div>

                  {/* Min / Max Withdrawal */}
                  <div>
                    <label className="text-zinc-300 text-xs font-semibold block mb-1">Min / Max Withdrawal (₹)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={50}
                        value={configForm.minWithdrawalAmount || 200}
                        onChange={(e) => setConfigForm({ ...configForm, minWithdrawalAmount: Number(e.target.value) })}
                        className="bg-[#1b1e2a] border border-[#2b3044] rounded-lg px-3 py-2 text-white font-mono text-sm outline-none"
                      />
                      <input
                        type="number"
                        min={500}
                        value={configForm.maxWithdrawalAmount || 50000}
                        onChange={(e) => setConfigForm({ ...configForm, maxWithdrawalAmount: Number(e.target.value) })}
                        className="bg-[#1b1e2a] border border-[#2b3044] rounded-lg px-3 py-2 text-white font-mono text-sm outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Audit Reason Required */}
                <div className="pt-2 border-t border-[#212535]">
                  <label className="text-amber-400 text-xs font-bold block mb-1">
                    * Mandatory Administrator Audit Reason:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Updated UPI receiver or deposit limits per financial operations review"
                    value={configAuditReason}
                    onChange={(e) => setConfigAuditReason(e.target.value)}
                    className="w-full bg-[#1b1e2a] border border-amber-600/40 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={loading || !configAuditReason.trim()}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 text-white font-bold text-xs shadow-md shadow-red-950/60 transition cursor-pointer disabled:opacity-50"
                  >
                    Save &amp; Log Configuration Change
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 5: USER DIRECTORY */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search users by username..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-full bg-[#141722] border border-[#232737] rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-red-500"
                  />
                </div>
                <span className="text-xs text-zinc-400">{usersList.length} registered users</span>
              </div>

              <div className="bg-[#141722] border border-[#232737] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#10121a] text-zinc-400 font-bold uppercase text-[10px] border-b border-[#212535]">
                      <tr>
                        <th className="p-3">Username</th>
                        <th className="p-3">Role</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Balance</th>
                        <th className="p-3">Created</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2233]">
                      {usersList
                        .filter((u) => u.username.toLowerCase().includes(userSearch.toLowerCase()))
                        .map((u) => (
                          <tr key={u.id} className="hover:bg-[#181b28]">
                            <td className="p-3 font-semibold text-white flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-400">
                                {u.username.charAt(0).toUpperCase()}
                              </span>
                              <span>{u.username}</span>
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  u.role === 'admin'
                                    ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                    : 'bg-zinc-800 text-zinc-300'
                                }`}
                              >
                                {u.role}
                              </span>
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  u.status === 'active'
                                    ? 'bg-emerald-950 text-emerald-400'
                                    : 'bg-red-950 text-red-400'
                                }`}
                              >
                                {u.status}
                              </span>
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-emerald-400">
                              ₹{u.balance.toFixed(2)}
                            </td>
                            <td className="p-3 text-zinc-400 text-[11px]">
                              {new Date(u.createdAt).toLocaleDateString()}
                            </td>
                            <td className="p-3 text-right">
                              {u.role !== 'admin' && (
                                <button
                                  onClick={() => setTargetUser(u)}
                                  className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer transition ${
                                    u.status === 'active'
                                      ? 'bg-red-950 hover:bg-red-900 text-red-300 border border-red-800/60'
                                      : 'bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/60'
                                  }`}
                                >
                                  {u.status === 'active' ? 'Suspend' : 'Restore'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: IMMUTABLE LEDGER */}
          {activeTab === 'ledger' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by user or idempotency key..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    className="w-full bg-[#141722] border border-[#232737] rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-red-500"
                  />
                </div>

                <button
                  onClick={handleExportLedger}
                  className="px-3 py-2 rounded-xl bg-[#1b1e2a] hover:bg-[#252a3b] text-zinc-200 text-xs font-bold border border-[#2b3044] flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-red-400" /> Export JSON Report
                </button>
              </div>

              <div className="bg-[#141722] border border-[#232737] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#10121a] text-zinc-400 font-bold uppercase text-[10px] border-b border-[#212535]">
                      <tr>
                        <th className="p-3">Type</th>
                        <th className="p-3">Amount</th>
                        <th className="p-3">Balance After</th>
                        <th className="p-3">User ID</th>
                        <th className="p-3">Reference / Description</th>
                        <th className="p-3">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2233]">
                      {ledgerEntries
                        .filter(
                          (l) =>
                            l.userId.includes(ledgerSearch) ||
                            l.idempotencyKey.includes(ledgerSearch) ||
                            l.type.includes(ledgerSearch.toUpperCase())
                        )
                        .map((entry) => (
                          <tr key={entry.id} className="hover:bg-[#181b28]">
                            <td className="p-3">
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
                              className={`p-3 font-bold ${
                                entry.amount >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {entry.amount >= 0 ? `+₹${entry.amount.toFixed(2)}` : `-₹${Math.abs(entry.amount).toFixed(2)}`}
                            </td>
                            <td className="p-3 text-zinc-300">₹{entry.balanceAfter.toFixed(2)}</td>
                            <td className="p-3 text-zinc-400 text-[11px]">{entry.userId}</td>
                            <td className="p-3 text-zinc-400 text-[10px] truncate max-w-[200px]" title={entry.description}>
                              {entry.referenceId} ({entry.description})
                            </td>
                            <td className="p-3 text-zinc-500 text-[10px]">
                              {new Date(entry.createdAt).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: SYSTEM & TELEGRAM MONITORING */}
          {activeTab === 'system' && overviewData && (
            <div className="space-y-6">
              {/* Telegram Bot Card */}
              <div className="bg-[#141722] border border-[#232737] rounded-xl p-5">
                <div className="flex items-center justify-between pb-3 border-b border-[#212535]">
                  <div className="flex items-center gap-2">
                    <Send className="w-5 h-5 text-sky-400" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      Official Telegram Bot Integration
                    </h3>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                      telegramStatus?.hasToken ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-400'
                    }`}
                  >
                    {telegramStatus?.status || 'CONFIG_REQUIRED'}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2">
                    <div className="text-zinc-400">
                      <strong>Webhook Endpoint:</strong>
                      <div className="mt-1 font-mono text-[11px] bg-[#1a1d29] p-2 rounded border border-[#282d3e] text-zinc-200 break-all select-all">
                        {telegramStatus?.webhookEndpoint || '/api/telegram/webhook'}
                      </div>
                    </div>
                    <p className="text-zinc-400 text-[11px]">
                      Commands supported: <code>/start</code>, <code>/deposits</code>, <code>/approvedep &lt;ref&gt;</code>,{' '}
                      <code>/withdrawals</code>, <code>/approvewth &lt;ref&gt; &lt;utr&gt;</code>, <code>/status</code>, <code>/systemstatus</code>.
                    </p>
                  </div>

                  <div className="bg-[#191c28] p-3 rounded-lg border border-[#262b3c] space-y-1.5 text-[11px] text-zinc-300">
                    <span className="font-bold text-white block">Bot Configuration Variables:</span>
                    <p>• <code>TELEGRAM_BOT_TOKEN</code>: BotFather API token</p>
                    <p>• <code>TELEGRAM_ADMIN_CHAT_ID</code>: Admin Telegram Chat ID</p>
                    <p>• <code>BOT_USERNAME</code>: Bot handle</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: AUDIT TRAIL */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              <div className="bg-[#141722] border border-[#232737] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#10121a] text-zinc-400 font-bold uppercase text-[10px] border-b border-[#212535]">
                      <tr>
                        <th className="p-3">Admin</th>
                        <th className="p-3">Action</th>
                        <th className="p-3">Reason</th>
                        <th className="p-3">Diff / Details</th>
                        <th className="p-3">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2233]">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-[#181b28]">
                          <td className="p-3 font-bold text-amber-400">{log.adminUsername}</td>
                          <td className="p-3 text-white font-semibold">{log.action}</td>
                          <td className="p-3 text-zinc-300 italic">{log.reason}</td>
                          <td className="p-3 text-[10px] text-zinc-400 max-w-[240px] truncate" title={log.newValue || ''}>
                            {log.newValue}
                          </td>
                          <td className="p-3 text-zinc-500 text-[10px]">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
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
