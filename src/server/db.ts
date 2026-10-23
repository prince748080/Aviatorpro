import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  User,
  GameRound,
  Bet,
  GameConfig,
  WalletLedgerEntry,
  DepositRequest,
  WithdrawalRequest,
  AuditLogEntry,
  TelegramLink,
} from '../types/index.js';

interface DatabaseData {
  users: Record<string, User & { passwordHash: string; salt: string }>;
  rounds: Record<string, GameRound>;
  bets: Record<string, Bet>;
  ledger: WalletLedgerEntry[];
  deposits: Record<string, DepositRequest>;
  withdrawals: Record<string, WithdrawalRequest>;
  config: GameConfig;
  auditLogs: AuditLogEntry[];
  telegramLinks: Record<string, TelegramLink>;
  roundCounter: number;
}

const DEFAULT_CONFIG: GameConfig = {
  minMultiplier: 1.01,
  maxMultiplier: 2.00, // Explicit documented maximum multiplier rule
  roundIntervalMs: 5000,
  tickIntervalMs: 50,
  speedFactor: 1.0,
  gamePaused: false,
  maintenanceMode: false,
  minBetAmount: 10,
  maxBetAmount: 10000,
  maxCashoutAmount: 50000,
  resultGenerationMethod: 'PROVABLY_FAIR_SHA256',
  upiReceiverId: process.env.UPI_PAYMENT_ID || 'princesuhani@fam',
  minDepositAmount: 100,
  maxDepositAmount: 100000,
  minWithdrawalAmount: 200,
  maxWithdrawalAmount: 50000,
  zappayLinkId: process.env.ZAPPAY_LINK_ID || '3ad9a798',
  zappayPayUrl: process.env.ZAPPAY_PAY_URL || 'https://panel.zappay.shop/pay.html?id=3ad9a798',
  zappayApiBase: process.env.ZAPPAY_API_BASE || 'https://zappay-beta.vercel.app',
};

class DatabaseManager {
  private dataFilePath: string;
  private data: DatabaseData;
  private userLocks = new Map<string, Promise<void>>();

  constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dataFilePath = path.join(dataDir, 'aviator_db.json');
    this.data = this.loadData();
    this.initializeDefaults();
  }

  private loadData(): DatabaseData {
    if (fs.existsSync(this.dataFilePath)) {
      try {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          users: parsed.users || {},
          rounds: parsed.rounds || {},
          bets: parsed.bets || {},
          ledger: parsed.ledger || [],
          deposits: parsed.deposits || {},
          withdrawals: parsed.withdrawals || {},
          config: { ...DEFAULT_CONFIG, ...(parsed.config || {}) },
          auditLogs: parsed.auditLogs || [],
          telegramLinks: parsed.telegramLinks || {},
          roundCounter: parsed.roundCounter || 1000,
        };
      } catch (err) {
        console.error('Failed reading database file, creating fresh store', err);
      }
    }
    return {
      users: {},
      rounds: {},
      bets: {},
      ledger: [],
      deposits: {},
      withdrawals: {},
      config: { ...DEFAULT_CONFIG },
      auditLogs: [],
      telegramLinks: {},
      roundCounter: 1000,
    };
  }

  private persist() {
    try {
      const tmpPath = `${this.dataFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.dataFilePath);
    } catch (err) {
      console.error('Critical: Failed to persist database', err);
    }
  }

  private initializeDefaults() {
    // Migration: ensure all users have integer balanceSubunits
    // Purge legacy dummy pilot and test accounts
    Object.keys(this.data.users).forEach((id) => {
      const u = this.data.users[id];
      if (u.username === 'pilot' || u.username.startsWith('test_pilot') || u.username.startsWith('idemp_user_') || u.username.startsWith('cashout_user_')) {
        delete this.data.users[id];
      }
    });

    // Ensure all existing accounts have exact subunit balances and admin starts at 0
    Object.values(this.data.users).forEach((u) => {
      if (u.role === 'admin' && u.username === 'admin') {
        u.balanceSubunits = 0;
        u.balance = 0.0;
      }
      if (typeof u.balanceSubunits !== 'number') {
        const legacyBalance = typeof u.balance === 'number' ? u.balance : 0;
        u.balanceSubunits = Math.round(legacyBalance * 100);
      }
      u.balance = Number((u.balanceSubunits / 100).toFixed(2));
    });

    // Seed default admin if none exists
    const usersList = Object.values(this.data.users);
    const hasAdmin = usersList.some((u) => u.role === 'admin');
    if (!hasAdmin) {
      const adminSalt = crypto.randomBytes(16).toString('hex');
      const adminPass = process.env.ADMIN_INITIAL_PASSWORD || 'AviatorAdmin2026!';
      const adminHash = crypto.pbkdf2Sync(adminPass, adminSalt, 100000, 64, 'sha512').toString('hex');
      const adminId = 'usr_admin_001';
      this.data.users[adminId] = {
        id: adminId,
        username: 'admin',
        passwordHash: adminHash,
        salt: adminSalt,
        role: 'admin',
        status: 'active',
        balanceSubunits: 0,
        balance: 0.0,
        createdAt: new Date().toISOString(),
      };
      this.data.auditLogs.unshift({
        id: `aud_${Date.now()}_init`,
        adminId: 'system',
        adminUsername: 'system',
        action: 'INITIALIZE_ADMIN',
        previousValue: null,
        newValue: 'admin user initialized with default role',
        reason: 'Initial system bootstrap',
        createdAt: new Date().toISOString(),
      });
    }

    // Guarantee default config values
    if (!this.data.config.maxMultiplier || this.data.config.maxMultiplier <= 0) {
      this.data.config.maxMultiplier = 2.00;
    }
    if (!this.data.config.upiReceiverId) {
      this.data.config.upiReceiverId = process.env.UPI_PAYMENT_ID || 'princesuhani@fam';
    }

    this.persist();
  }

  // Mutex per user to prevent concurrent race conditions on balance updates
  public async acquireUserLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
    while (this.userLocks.has(userId)) {
      await this.userLocks.get(userId);
    }
    let resolveLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.userLocks.set(userId, lockPromise);

    try {
      return await task();
    } finally {
      this.userLocks.delete(userId);
      resolveLock();
    }
  }

  // Users & Auth
  public getUserById(id: string): User | null {
    const user = this.data.users[id];
    if (!user) return null;
    const { passwordHash, salt, ...safeUser } = user;
    safeUser.balance = Number((safeUser.balanceSubunits / 100).toFixed(2));
    return safeUser;
  }

  public getUserByUsername(username: string): (User & { passwordHash: string; salt: string }) | null {
    if (!username) return null;
    const cleanUsername = username.trim().toLowerCase();
    const found = Object.values(this.data.users).find(
      (u) => u.username.toLowerCase() === cleanUsername
    );
    if (!found) return null;
    found.balance = Number((found.balanceSubunits / 100).toFixed(2));
    return found;
  }

  public getUserByPhoneNumber(phoneNumber: string): (User & { passwordHash: string; salt: string }) | null {
    if (!phoneNumber) return null;
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    const found = Object.values(this.data.users).find((u) => {
      if (!u.phoneNumber) return false;
      const uDigits = u.phoneNumber.replace(/\D/g, '');
      return u.phoneNumber === phoneNumber.trim() || (digitsOnly.length >= 10 && uDigits.endsWith(digitsOnly.slice(-10)));
    });
    if (!found) return null;
    found.balance = Number((found.balanceSubunits / 100).toFixed(2));
    return found;
  }

  public getUserByIdentifier(identifier: string): (User & { passwordHash: string; salt: string }) | null {
    if (!identifier) return null;
    const clean = identifier.trim();
    // 1. Try direct username match
    const byUser = this.getUserByUsername(clean);
    if (byUser) return byUser;

    // 2. Try phone number match
    const byPhone = this.getUserByPhoneNumber(clean);
    if (byPhone) return byPhone;

    // 3. Fallback case-insensitive search across all users
    const found = Object.values(this.data.users).find((u) => {
      if (u.username.toLowerCase() === clean.toLowerCase()) return true;
      if (u.phoneNumber && u.phoneNumber.toLowerCase() === clean.toLowerCase()) return true;
      return false;
    });
    if (found) {
      found.balance = Number((found.balanceSubunits / 100).toFixed(2));
      return found;
    }
    return null;
  }

  public createUser(
    username: string,
    passwordHash: string,
    salt: string,
    role: User['role'] = 'player',
    phoneNumber?: string
  ): User {
    const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    // Authentic accounts start at 0 subunits until real approved deposit
    const initialSubunits = 0;
    const cleanPhone = phoneNumber ? phoneNumber.trim() : null;
    const newUser = {
      id,
      username: username.trim(),
      phoneNumber: cleanPhone,
      passwordHash,
      salt,
      role,
      status: 'active' as const,
      balanceSubunits: initialSubunits,
      balance: 0.0,
      createdAt: now,
    };
    this.data.users[id] = newUser;
    this.persist();
    const { passwordHash: _, salt: __, ...safeUser } = newUser;
    return safeUser;
  }

  public getAllUsers(): User[] {
    return Object.values(this.data.users).map(({ passwordHash, salt, ...u }) => ({
      ...u,
      balance: Number((u.balanceSubunits / 100).toFixed(2)),
    }));
  }

  public updateUserStatus(
    userId: string,
    status: User['status'],
    reason: string,
    adminId: string,
    adminUsername: string
  ): User | null {
    const user = this.data.users[userId];
    if (!user) return null;
    const prevStatus = user.status;
    user.status = status;
    user.suspensionReason = status === 'suspended' ? reason : null;

    this.recordAuditLog({
      adminId,
      adminUsername,
      action: `USER_STATUS_${status.toUpperCase()}`,
      previousValue: prevStatus,
      newValue: status,
      reason,
    });

    this.persist();
    const { passwordHash, salt, ...safeUser } = user;
    safeUser.balance = Number((safeUser.balanceSubunits / 100).toFixed(2));
    return safeUser;
  }

  // ----------------------------------------------------------------------
  // DEPOSIT WORKFLOW (VERIFIED UPI WORKFLOW)
  // ----------------------------------------------------------------------

  public createDepositRequest(
    userId: string,
    amount: number,
    upiReceiverId: string,
    idempotencyKey: string,
    gateway: 'UPI_MANUAL' | 'ZAPPAY' = 'UPI_MANUAL',
    zappayDetails?: { linkId?: string; orderId?: string; paymentUrl?: string }
  ): { success: boolean; deposit?: DepositRequest; error?: string } {
    const user = this.data.users[userId];
    if (!user) return { success: false, error: 'User not found' };
    if (user.status === 'suspended') return { success: false, error: 'Account suspended' };

    const amountSubunits = Math.round(amount * 100);
    const minSubunits = Math.round(this.data.config.minDepositAmount * 100);
    const maxSubunits = Math.round(this.data.config.maxDepositAmount * 100);

    // If ZapPay fixed amount is used (e.g. 99), allow it even if below 100
    if (gateway !== 'ZAPPAY' && amountSubunits < minSubunits) {
      return { success: false, error: `Minimum deposit is ₹${this.data.config.minDepositAmount}` };
    }
    if (amountSubunits > maxSubunits) {
      return { success: false, error: `Maximum deposit is ₹${this.data.config.maxDepositAmount}` };
    }

    // Check duplicate idempotency
    const existing = Object.values(this.data.deposits).find((d) => d.idempotencyKey === idempotencyKey);
    if (existing) {
      return { success: true, deposit: existing };
    }

    const id = `dep_${crypto.randomUUID().slice(0, 12)}`;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const reference = `DEP-${dateStr}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const deposit: DepositRequest = {
      id,
      reference,
      userId,
      username: user.username,
      amountSubunits,
      amount: Number((amountSubunits / 100).toFixed(2)),
      upiReceiverId: upiReceiverId || this.data.config.upiReceiverId,
      status: 'PENDING_VERIFICATION',
      createdAt: new Date().toISOString(),
      idempotencyKey,
      gateway,
      zappayLinkId: zappayDetails?.linkId,
      zappayOrderId: zappayDetails?.orderId,
      zappayPaymentUrl: zappayDetails?.paymentUrl,
    };

    this.data.deposits[id] = deposit;
    this.persist();
    return { success: true, deposit };
  }

  public getDepositByZapPayOrder(orderId: string): DepositRequest | null {
    if (!orderId) return null;
    return Object.values(this.data.deposits).find((d) => d.zappayOrderId === orderId) || null;
  }

  public submitDepositEvidence(
    depositId: string,
    userId: string,
    userUtrReference: string,
    paymentEvidenceNote?: string
  ): { success: boolean; deposit?: DepositRequest; error?: string } {
    const deposit = this.data.deposits[depositId];
    if (!deposit) return { success: false, error: 'Deposit request not found' };
    if (deposit.userId !== userId) return { success: false, error: 'Unauthorized request' };
    if (deposit.status !== 'PENDING_VERIFICATION') {
      return { success: false, error: `Deposit request is already ${deposit.status.toLowerCase()}` };
    }

    const cleanUtr = (userUtrReference || '').trim();
    if (!cleanUtr || cleanUtr.length < 6) {
      return { success: false, error: 'Valid UPI UTR or Transaction Reference number is required' };
    }

    deposit.userUtrReference = cleanUtr;
    deposit.paymentEvidenceNote = paymentEvidenceNote?.trim() || undefined;
    this.persist();
    return { success: true, deposit };
  }

  public async approveDeposit(
    depositId: string,
    adminId: string,
    adminUsername: string,
    auditReason: string
  ): Promise<{ success: boolean; deposit?: DepositRequest; newBalance?: number; error?: string }> {
    const deposit = this.data.deposits[depositId];
    if (!deposit) return { success: false, error: 'Deposit request not found' };
    if (deposit.status === 'APPROVED') {
      const user = this.data.users[deposit.userId];
      return {
        success: true,
        deposit,
        newBalance: user ? Number((user.balanceSubunits / 100).toFixed(2)) : 0,
      };
    }
    if (deposit.status !== 'PENDING_VERIFICATION') {
      return { success: false, error: `Cannot approve deposit in ${deposit.status} state` };
    }

    return this.acquireUserLock(deposit.userId, async () => {
      const user = this.data.users[deposit.userId];
      if (!user) return { success: false, error: 'Target user not found' };

      const approveIdempotencyKey = `dep_credit_${deposit.id}`;
      const duplicateLedger = this.data.ledger.find((l) => l.idempotencyKey === approveIdempotencyKey);
      if (duplicateLedger) {
        return { success: false, error: 'Duplicate ledger credit detected' };
      }

      // 1. Credit balance atomically
      user.balanceSubunits += deposit.amountSubunits;
      user.balance = Number((user.balanceSubunits / 100).toFixed(2));

      // 2. Append immutable ledger entry
      this.data.ledger.unshift({
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId: user.id,
        amountSubunits: deposit.amountSubunits,
        amount: Number((deposit.amountSubunits / 100).toFixed(2)),
        balanceAfterSubunits: user.balanceSubunits,
        balanceAfter: user.balance,
        type: 'DEPOSIT',
        referenceId: deposit.reference,
        idempotencyKey: approveIdempotencyKey,
        description: `Verified Deposit UPI UTR: ${deposit.userUtrReference || 'Manual Admin'}`,
        createdAt: new Date().toISOString(),
      });

      // 3. Mark deposit approved
      deposit.status = 'APPROVED';
      deposit.verifiedAt = new Date().toISOString();
      deposit.verifiedByAdminId = adminId;
      deposit.verifiedByAdminUsername = adminUsername;

      // 4. Audit log
      this.recordAuditLog({
        adminId,
        adminUsername,
        action: 'APPROVE_DEPOSIT',
        previousValue: `PENDING ₹${deposit.amount}`,
        newValue: `APPROVED ₹${deposit.amount}`,
        reason: auditReason || `Verified payment for ${deposit.reference}`,
      });

      this.persist();
      return { success: true, deposit, newBalance: user.balance };
    });
  }

  public rejectDeposit(
    depositId: string,
    adminId: string,
    adminUsername: string,
    rejectionReason: string
  ): { success: boolean; deposit?: DepositRequest; error?: string } {
    const deposit = this.data.deposits[depositId];
    if (!deposit) return { success: false, error: 'Deposit request not found' };
    if (deposit.status !== 'PENDING_VERIFICATION') {
      return { success: false, error: `Cannot reject deposit in ${deposit.status} state` };
    }

    deposit.status = 'REJECTED';
    deposit.rejectionReason = rejectionReason || 'Payment verification failed';
    deposit.verifiedAt = new Date().toISOString();
    deposit.verifiedByAdminId = adminId;
    deposit.verifiedByAdminUsername = adminUsername;

    this.recordAuditLog({
      adminId,
      adminUsername,
      action: 'REJECT_DEPOSIT',
      previousValue: 'PENDING_VERIFICATION',
      newValue: 'REJECTED',
      reason: rejectionReason,
    });

    this.persist();
    return { success: true, deposit };
  }

  public getDeposits(limit: number = 100, userId?: string): DepositRequest[] {
    let items = Object.values(this.data.deposits);
    if (userId) {
      items = items.filter((d) => d.userId === userId);
    }
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
  }

  public getDepositByReference(reference: string): DepositRequest | null {
    return (
      Object.values(this.data.deposits).find(
        (d) => d.reference.toUpperCase() === reference.toUpperCase() || d.id === reference
      ) || null
    );
  }

  // ----------------------------------------------------------------------
  // WITHDRAWAL WORKFLOW (ATOMIC RESERVATION & PAYOUT VERIFICATION)
  // ----------------------------------------------------------------------

  public async createWithdrawalRequest(
    userId: string,
    amount: number,
    payoutMethod: 'UPI' | 'BANK',
    payoutTarget: string,
    idempotencyKey: string
  ): Promise<{ success: boolean; withdrawal?: WithdrawalRequest; newBalance?: number; error?: string }> {
    return this.acquireUserLock(userId, async () => {
      const user = this.data.users[userId];
      if (!user) return { success: false, error: 'User not found' };
      if (user.status === 'suspended') return { success: false, error: 'Account suspended' };

      const amountSubunits = Math.round(amount * 100);
      const minSubunits = Math.round(this.data.config.minWithdrawalAmount * 100);
      const maxSubunits = Math.round(this.data.config.maxWithdrawalAmount * 100);

      if (amountSubunits < minSubunits) {
        return { success: false, error: `Minimum withdrawal is ₹${this.data.config.minWithdrawalAmount}` };
      }
      if (amountSubunits > maxSubunits) {
        return { success: false, error: `Maximum withdrawal is ₹${this.data.config.maxWithdrawalAmount}` };
      }

      if (user.balanceSubunits < amountSubunits) {
        return {
          success: false,
          error: `Insufficient available balance (Available: ₹${(user.balanceSubunits / 100).toFixed(2)})`,
        };
      }

      const cleanTarget = (payoutTarget || '').trim();
      if (!cleanTarget || cleanTarget.length < 5) {
        return { success: false, error: 'Valid payout details (UPI ID or Bank Details) required' };
      }

      // Check duplicate idempotency
      const existing = Object.values(this.data.withdrawals).find((w) => w.idempotencyKey === idempotencyKey);
      if (existing) {
        return { success: true, withdrawal: existing, newBalance: user.balance };
      }

      const id = `wth_${crypto.randomUUID().slice(0, 12)}`;
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const reference = `WTH-${dateStr}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      // 1. ATOMICALLY RESERVE FUNDS: debit from user balance immediately so it cannot be spent twice!
      user.balanceSubunits -= amountSubunits;
      user.balance = Number((user.balanceSubunits / 100).toFixed(2));

      // 2. Append immutable ledger entry for reservation
      this.data.ledger.unshift({
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId: user.id,
        amountSubunits: -amountSubunits,
        amount: -Number((amountSubunits / 100).toFixed(2)),
        balanceAfterSubunits: user.balanceSubunits,
        balanceAfter: user.balance,
        type: 'WITHDRAWAL_RESERVE',
        referenceId: reference,
        idempotencyKey: `wth_res_${id}`,
        description: `Reserved for Withdrawal to ${payoutMethod}: ${cleanTarget}`,
        createdAt: new Date().toISOString(),
      });

      // 3. Create withdrawal record
      const withdrawal: WithdrawalRequest = {
        id,
        reference,
        userId,
        username: user.username,
        amountSubunits,
        amount: Number((amountSubunits / 100).toFixed(2)),
        payoutMethod,
        payoutTarget: cleanTarget,
        status: 'PENDING_REVIEW',
        createdAt: new Date().toISOString(),
        idempotencyKey,
      };

      this.data.withdrawals[id] = withdrawal;
      this.persist();
      return { success: true, withdrawal, newBalance: user.balance };
    });
  }

  public async completeWithdrawal(
    withdrawalId: string,
    adminId: string,
    adminUsername: string,
    payoutReference: string
  ): Promise<{ success: boolean; withdrawal?: WithdrawalRequest; error?: string }> {
    const withdrawal = this.data.withdrawals[withdrawalId];
    if (!withdrawal) return { success: false, error: 'Withdrawal request not found' };
    if (withdrawal.status === 'COMPLETED') {
      return { success: true, withdrawal };
    }
    if (withdrawal.status !== 'PENDING_REVIEW') {
      return { success: false, error: `Cannot mark withdrawal completed in ${withdrawal.status} status` };
    }

    const cleanPayoutRef = (payoutReference || '').trim();
    if (!cleanPayoutRef) {
      return { success: false, error: 'Payment provider payout UTR / reference is required' };
    }

    withdrawal.status = 'COMPLETED';
    withdrawal.payoutReference = cleanPayoutRef;
    withdrawal.processedAt = new Date().toISOString();
    withdrawal.processedByAdminId = adminId;
    withdrawal.processedByAdminUsername = adminUsername;

    // Append ledger completion notation
    const user = this.data.users[withdrawal.userId];
    this.data.ledger.unshift({
      id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
      userId: withdrawal.userId,
      amountSubunits: 0,
      amount: 0,
      balanceAfterSubunits: user ? user.balanceSubunits : 0,
      balanceAfter: user ? user.balance : 0,
      type: 'WITHDRAWAL_COMPLETED',
      referenceId: withdrawal.reference,
      idempotencyKey: `wth_comp_${withdrawal.id}`,
      description: `Withdrawal Paid Out UTR: ${cleanPayoutRef}`,
      createdAt: new Date().toISOString(),
    });

    this.recordAuditLog({
      adminId,
      adminUsername,
      action: 'COMPLETE_WITHDRAWAL',
      previousValue: 'PENDING_REVIEW',
      newValue: `COMPLETED UTR: ${cleanPayoutRef}`,
      reason: `Payout executed to ${withdrawal.payoutTarget}`,
    });

    this.persist();
    return { success: true, withdrawal };
  }

  public async rejectWithdrawal(
    withdrawalId: string,
    adminId: string,
    adminUsername: string,
    rejectionReason: string
  ): Promise<{ success: boolean; withdrawal?: WithdrawalRequest; newBalance?: number; error?: string }> {
    const withdrawal = this.data.withdrawals[withdrawalId];
    if (!withdrawal) return { success: false, error: 'Withdrawal request not found' };
    if (withdrawal.status !== 'PENDING_REVIEW') {
      return { success: false, error: `Cannot reject withdrawal in ${withdrawal.status} status` };
    }

    return this.acquireUserLock(withdrawal.userId, async () => {
      const user = this.data.users[withdrawal.userId];
      if (!user) return { success: false, error: 'User not found' };

      const refundIdempotencyKey = `wth_ref_${withdrawal.id}`;
      const duplicateRefund = this.data.ledger.find((l) => l.idempotencyKey === refundIdempotencyKey);
      if (duplicateRefund) {
        return { success: false, error: 'Refund already credited' };
      }

      // 1. ATOMICALLY REFUND RESERVED FUNDS: credit balance back
      user.balanceSubunits += withdrawal.amountSubunits;
      user.balance = Number((user.balanceSubunits / 100).toFixed(2));

      // 2. Append immutable ledger refund entry
      this.data.ledger.unshift({
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId: user.id,
        amountSubunits: withdrawal.amountSubunits,
        amount: Number((withdrawal.amountSubunits / 100).toFixed(2)),
        balanceAfterSubunits: user.balanceSubunits,
        balanceAfter: user.balance,
        type: 'WITHDRAWAL_REFUND',
        referenceId: withdrawal.reference,
        idempotencyKey: refundIdempotencyKey,
        description: `Refund for Rejected Withdrawal: ${rejectionReason || 'Declined by Administrator'}`,
        createdAt: new Date().toISOString(),
      });

      // 3. Mark rejected
      withdrawal.status = 'REJECTED';
      withdrawal.rejectionReason = rejectionReason || 'Declined by Administrator';
      withdrawal.processedAt = new Date().toISOString();
      withdrawal.processedByAdminId = adminId;
      withdrawal.processedByAdminUsername = adminUsername;

      this.recordAuditLog({
        adminId,
        adminUsername,
        action: 'REJECT_WITHDRAWAL',
        previousValue: 'PENDING_REVIEW',
        newValue: 'REJECTED_AND_REFUNDED',
        reason: rejectionReason,
      });

      this.persist();
      return { success: true, withdrawal, newBalance: user.balance };
    });
  }

  public getWithdrawals(limit: number = 100, userId?: string): WithdrawalRequest[] {
    let items = Object.values(this.data.withdrawals);
    if (userId) {
      items = items.filter((w) => w.userId === userId);
    }
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
  }

  public getWithdrawalByReference(reference: string): WithdrawalRequest | null {
    return (
      Object.values(this.data.withdrawals).find(
        (w) => w.reference.toUpperCase() === reference.toUpperCase() || w.id === reference
      ) || null
    );
  }

  // ----------------------------------------------------------------------
  // BALANCE & LEDGER MANAGEMENT (ATOMIC & IDEMPOTENT)
  // ----------------------------------------------------------------------

  public async debitBalanceForBet(
    userId: string,
    amount: number,
    betId: string,
    idempotencyKey: string
  ): Promise<{ success: boolean; newBalance: number; error?: string }> {
    return this.acquireUserLock(userId, async () => {
      const amountSubunits = Math.round(amount * 100);

      // 1. Idempotency Check
      const existing = this.data.ledger.find((l) => l.idempotencyKey === idempotencyKey);
      if (existing) {
        return {
          success: false,
          newBalance: (this.data.users[userId]?.balanceSubunits ?? 0) / 100,
          error: 'Duplicate bet transaction detected',
        };
      }

      const user = this.data.users[userId];
      if (!user) return { success: false, newBalance: 0, error: 'User not found' };
      if (user.status === 'suspended') {
        return { success: false, newBalance: user.balance, error: 'Account suspended' };
      }
      if (amountSubunits <= 0) {
        return { success: false, newBalance: user.balance, error: 'Bet amount must be greater than zero' };
      }
      if (user.balanceSubunits < amountSubunits) {
        return {
          success: false,
          newBalance: user.balance,
          error: `Insufficient balance (Available: ₹${user.balance.toFixed(2)})`,
        };
      }

      user.balanceSubunits -= amountSubunits;
      user.balance = Number((user.balanceSubunits / 100).toFixed(2));

      const ledgerEntry: WalletLedgerEntry = {
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId,
        amountSubunits: -amountSubunits,
        amount: -Number((amountSubunits / 100).toFixed(2)),
        balanceAfterSubunits: user.balanceSubunits,
        balanceAfter: user.balance,
        type: 'BET',
        referenceId: betId,
        idempotencyKey,
        description: `Wager placed on Bet #${betId}`,
        createdAt: new Date().toISOString(),
      };

      this.data.ledger.unshift(ledgerEntry);
      this.persist();
      return { success: true, newBalance: user.balance };
    });
  }

  public async creditBalanceForCashout(
    userId: string,
    amount: number,
    betId: string,
    idempotencyKey: string
  ): Promise<{ success: boolean; newBalance: number; error?: string }> {
    return this.acquireUserLock(userId, async () => {
      const amountSubunits = Math.round(amount * 100);

      // Idempotency check: prevent duplicate payouts
      const existing = this.data.ledger.find((l) => l.idempotencyKey === idempotencyKey);
      if (existing) {
        return {
          success: false,
          newBalance: (this.data.users[userId]?.balanceSubunits ?? 0) / 100,
          error: 'Cashout payout already processed',
        };
      }

      const user = this.data.users[userId];
      if (!user) return { success: false, newBalance: 0, error: 'User not found' };
      if (amountSubunits <= 0) {
        return { success: false, newBalance: user.balance, error: 'Cashout payout amount invalid' };
      }

      user.balanceSubunits += amountSubunits;
      user.balance = Number((user.balanceSubunits / 100).toFixed(2));

      const ledgerEntry: WalletLedgerEntry = {
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId,
        amountSubunits,
        amount: Number((amountSubunits / 100).toFixed(2)),
        balanceAfterSubunits: user.balanceSubunits,
        balanceAfter: user.balance,
        type: 'CASHOUT',
        referenceId: betId,
        idempotencyKey,
        description: `Winning Cashout payout on Bet #${betId}`,
        createdAt: new Date().toISOString(),
      };

      this.data.ledger.unshift(ledgerEntry);
      this.persist();
      return { success: true, newBalance: user.balance };
    });
  }

  public async refundCancelledBet(
    userId: string,
    amount: number,
    betId: string,
    idempotencyKey: string
  ): Promise<{ success: boolean; newBalance: number }> {
    return this.acquireUserLock(userId, async () => {
      const user = this.data.users[userId];
      if (!user) return { success: false, newBalance: 0 };
      const amountSubunits = Math.round(amount * 100);

      user.balanceSubunits += amountSubunits;
      user.balance = Number((user.balanceSubunits / 100).toFixed(2));

      this.data.ledger.unshift({
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId,
        amountSubunits,
        amount: Number((amountSubunits / 100).toFixed(2)),
        balanceAfterSubunits: user.balanceSubunits,
        balanceAfter: user.balance,
        type: 'CANCELLED_BET',
        referenceId: betId,
        idempotencyKey,
        description: `Cancelled Bet refund for #${betId}`,
        createdAt: new Date().toISOString(),
      });

      this.persist();
      return { success: true, newBalance: user.balance };
    });
  }

  public getLedger(limit: number = 200, userId?: string): WalletLedgerEntry[] {
    let items = this.data.ledger;
    if (userId) {
      items = items.filter((l) => l.userId === userId);
    }
    return items.slice(0, limit);
  }

  // ----------------------------------------------------------------------
  // ROUNDS & BETS
  // ----------------------------------------------------------------------

  public createRound(crashMultiplier: number, serverSeed: string, publicHash: string): GameRound {
    this.data.roundCounter += 1;
    const id = `RND-${Date.now()}-${this.data.roundCounter}`;
    const round: GameRound = {
      id,
      roundNumber: this.data.roundCounter,
      startTime: Date.now(),
      endTime: null,
      crashMultiplier,
      serverSeed,
      publicHash,
      status: 'WAITING',
      totalBets: 0,
      totalPayoutsSubunits: 0,
      totalPayouts: 0,
      createdAt: new Date().toISOString(),
    };
    this.data.rounds[id] = round;
    this.persist();
    return round;
  }

  public updateRound(id: string, updates: Partial<GameRound>): GameRound | null {
    const round = this.data.rounds[id];
    if (!round) return null;
    Object.assign(round, updates);
    this.persist();
    return round;
  }

  public getRound(id: string): GameRound | null {
    return this.data.rounds[id] || null;
  }

  public getRecentRounds(limit: number = 50): GameRound[] {
    return Object.values(this.data.rounds)
      .filter((r) => r.status === 'CRASHED')
      .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
      .slice(0, limit);
  }

  public recordBet(bet: Bet) {
    this.data.bets[bet.id] = bet;
    const round = this.data.rounds[bet.roundId];
    if (round) {
      round.totalBets += 1;
    }
    this.persist();
  }

  public updateBet(betId: string, updates: Partial<Bet>): Bet | null {
    const bet = this.data.bets[betId];
    if (!bet) return null;
    Object.assign(bet, updates);
    if (updates.cashedAmount && updates.cashedAmount > 0) {
      const round = this.data.rounds[bet.roundId];
      if (round) {
        round.totalPayouts = Number((round.totalPayouts + updates.cashedAmount).toFixed(2));
        round.totalPayoutsSubunits = Math.round(round.totalPayouts * 100);
      }
    }
    this.persist();
    return bet;
  }

  public getBet(betId: string): Bet | null {
    return this.data.bets[betId] || null;
  }

  public getBetsForRound(roundId: string): Bet[] {
    return Object.values(this.data.bets).filter((b) => b.roundId === roundId);
  }

  public getUserBets(userId: string, limit: number = 50): Bet[] {
    return Object.values(this.data.bets)
      .filter((b) => b.userId === userId)
      .sort((a, b) => b.placedAt - a.placedAt)
      .slice(0, limit);
  }

  // ----------------------------------------------------------------------
  // CONFIG & AUDIT
  // ----------------------------------------------------------------------

  public getConfig(): GameConfig {
    return { ...this.data.config };
  }

  public updateConfig(
    updates: Partial<GameConfig>,
    adminId: string,
    adminUsername: string,
    reason: string
  ): GameConfig {
    const prev = { ...this.data.config };
    Object.assign(this.data.config, updates);

    this.recordAuditLog({
      adminId,
      adminUsername,
      action: 'UPDATE_GAME_CONFIG',
      previousValue: JSON.stringify(prev),
      newValue: JSON.stringify(this.data.config),
      reason,
    });

    this.persist();
    return { ...this.data.config };
  }

  public recordAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): AuditLogEntry {
    const log: AuditLogEntry = {
      id: `aud_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      ...entry,
      createdAt: new Date().toISOString(),
    };
    this.data.auditLogs.unshift(log);
    if (this.data.auditLogs.length > 1000) {
      this.data.auditLogs = this.data.auditLogs.slice(0, 1000);
    }
    this.persist();
    return log;
  }

  public getAuditLogs(limit: number = 100): AuditLogEntry[] {
    return this.data.auditLogs.slice(0, limit);
  }

  // ----------------------------------------------------------------------
  // TELEGRAM LINKS
  // ----------------------------------------------------------------------

  public setTelegramLink(link: TelegramLink) {
    this.data.telegramLinks[link.telegramId] = link;
    this.persist();
  }

  public getTelegramLink(telegramId: string): TelegramLink | null {
    return this.data.telegramLinks[telegramId] || null;
  }

  public getTelegramLinkByUserId(userId: string): TelegramLink | null {
    return Object.values(this.data.telegramLinks).find((l) => l.userId === userId) || null;
  }

  // ----------------------------------------------------------------------
  // OVERVIEW & METRICS
  // ----------------------------------------------------------------------

  public getOverviewStats() {
    const users = Object.values(this.data.users);
    const rounds = Object.values(this.data.rounds);
    const completedRounds = rounds.filter((r) => r.status === 'CRASHED');
    const bets = Object.values(this.data.bets);
    const deposits = Object.values(this.data.deposits);
    const withdrawals = Object.values(this.data.withdrawals);

    const pendingDeposits = deposits.filter((d) => d.status === 'PENDING_VERIFICATION');
    const approvedDeposits = deposits.filter((d) => d.status === 'APPROVED');
    const pendingWithdrawals = withdrawals.filter((w) => w.status === 'PENDING_REVIEW');
    const completedWithdrawals = withdrawals.filter((w) => w.status === 'COMPLETED');

    const totalDepositedAmount = approvedDeposits.reduce((acc, d) => acc + d.amount, 0);
    const totalWithdrawnAmount = completedWithdrawals.reduce((acc, w) => acc + w.amount, 0);

    const totalBetsAmount = bets.reduce((acc, b) => acc + b.amount, 0);
    const totalPayoutsAmount = bets.reduce((acc, b) => acc + (b.cashedAmount || 0), 0);

    return {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === 'active').length,
      totalRounds: completedRounds.length,
      totalBetsPlaced: bets.length,
      totalWagered: Number(totalBetsAmount.toFixed(2)),
      totalPaidOut: Number(totalPayoutsAmount.toFixed(2)),
      totalDeposited: Number(totalDepositedAmount.toFixed(2)),
      totalWithdrawn: Number(totalWithdrawnAmount.toFixed(2)),
      pendingDepositsCount: pendingDeposits.length,
      pendingWithdrawalsCount: pendingWithdrawals.length,
      ledgerEntriesCount: this.data.ledger.length,
    };
  }
}

export const db = new DatabaseManager();
