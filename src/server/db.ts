import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  User,
  GameRound,
  Bet,
  GameConfig,
  WalletLedgerEntry,
  AuditLogEntry,
  TelegramLink,
} from '../types/index.js';

interface DatabaseData {
  users: Record<string, User & { passwordHash: string; salt: string }>;
  rounds: Record<string, GameRound>;
  bets: Record<string, Bet>;
  ledger: WalletLedgerEntry[];
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
  maxBetAmount: 50000,
  maxCashoutAmount: 100000,
  resultGenerationMethod: 'PROVABLY_FAIR_SHA256',
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
        return JSON.parse(raw);
      } catch (err) {
        console.error('Failed reading database file, creating fresh store', err);
      }
    }
    return {
      users: {},
      rounds: {},
      bets: {},
      ledger: [],
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
        balance: 50000.0,
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

    // Seed default demo player if none exists
    const hasPlayer = usersList.some((u) => u.username === 'pilot');
    if (!hasPlayer) {
      const pilotSalt = crypto.randomBytes(16).toString('hex');
      const pilotHash = crypto.pbkdf2Sync('DemoPilot123!', pilotSalt, 100000, 64, 'sha512').toString('hex');
      const pilotId = 'usr_pilot_001';
      this.data.users[pilotId] = {
        id: pilotId,
        username: 'pilot',
        passwordHash: pilotHash,
        salt: pilotSalt,
        role: 'player',
        status: 'active',
        balance: 5000.0,
        createdAt: new Date().toISOString(),
      };
      // Record initial demo grant in ledger
      this.data.ledger.push({
        id: `ldg_${Date.now()}_seed`,
        userId: pilotId,
        amount: 5000.0,
        balanceAfter: 5000.0,
        type: 'DEMO_RELOAD',
        referenceId: 'INITIAL_SEED',
        idempotencyKey: `seed_${pilotId}`,
        createdAt: new Date().toISOString(),
      });
    }

    // Guarantee default config has required maxMultiplier
    if (!this.data.config.maxMultiplier || this.data.config.maxMultiplier <= 0) {
      this.data.config.maxMultiplier = 2.00;
    }

    this.persist();
  }

  // Mutex per user to prevent concurrent race conditions on balance updates
  private async acquireUserLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
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
    return safeUser;
  }

  public getUserByUsername(username: string): (User & { passwordHash: string; salt: string }) | null {
    const found = Object.values(this.data.users).find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
    return found || null;
  }

  public createUser(username: string, passwordHash: string, salt: string, role: User['role'] = 'player'): User {
    const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const initialBalance = 1000.0; // 1,000 demo credits
    const newUser = {
      id,
      username,
      passwordHash,
      salt,
      role,
      status: 'active' as const,
      balance: initialBalance,
      createdAt: now,
    };
    this.data.users[id] = newUser;

    // Record demo credit grant in ledger
    this.data.ledger.unshift({
      id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
      userId: id,
      amount: initialBalance,
      balanceAfter: initialBalance,
      type: 'DEMO_RELOAD',
      referenceId: 'WELCOME_BONUS',
      idempotencyKey: `welcome_${id}`,
      createdAt: now,
    });

    this.persist();
    const { passwordHash: _, salt: __, ...safeUser } = newUser;
    return safeUser;
  }

  public getAllUsers(): User[] {
    return Object.values(this.data.users).map(({ passwordHash, salt, ...u }) => u);
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
    return safeUser;
  }

  // Balance & Ledger Management (ATOMIC & IDEMPOTENT)
  public async debitBalanceForBet(
    userId: string,
    amount: number,
    betId: string,
    idempotencyKey: string
  ): Promise<{ success: boolean; newBalance: number; error?: string }> {
    return this.acquireUserLock(userId, async () => {
      // 1. Idempotency Check
      const existing = this.data.ledger.find((l) => l.idempotencyKey === idempotencyKey);
      if (existing) {
        return { success: false, newBalance: this.data.users[userId]?.balance ?? 0, error: 'Duplicate bet transaction detected' };
      }

      const user = this.data.users[userId];
      if (!user) return { success: false, newBalance: 0, error: 'User not found' };
      if (user.status === 'suspended') return { success: false, newBalance: user.balance, error: 'Account suspended' };
      if (amount <= 0) return { success: false, newBalance: user.balance, error: 'Bet amount must be greater than zero' };
      if (user.balance < amount) {
        return { success: false, newBalance: user.balance, error: 'Insufficient demo balance' };
      }

      user.balance = Number((user.balance - amount).toFixed(2));
      const ledgerEntry: WalletLedgerEntry = {
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId,
        amount: -amount,
        balanceAfter: user.balance,
        type: 'BET',
        referenceId: betId,
        idempotencyKey,
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
      // Idempotency check: prevent duplicate payouts
      const existing = this.data.ledger.find((l) => l.idempotencyKey === idempotencyKey);
      if (existing) {
        return { success: false, newBalance: this.data.users[userId]?.balance ?? 0, error: 'Cashout payout already processed' };
      }

      const user = this.data.users[userId];
      if (!user) return { success: false, newBalance: 0, error: 'User not found' };
      if (amount <= 0) return { success: false, newBalance: user.balance, error: 'Cashout payout amount invalid' };

      user.balance = Number((user.balance + amount).toFixed(2));
      const ledgerEntry: WalletLedgerEntry = {
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId,
        amount: +amount,
        balanceAfter: user.balance,
        type: 'CASHOUT',
        referenceId: betId,
        idempotencyKey,
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
      user.balance = Number((user.balance + amount).toFixed(2));

      this.data.ledger.unshift({
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId,
        amount: +amount,
        balanceAfter: user.balance,
        type: 'CANCELLED_BET',
        referenceId: betId,
        idempotencyKey,
        createdAt: new Date().toISOString(),
      });

      this.persist();
      return { success: true, newBalance: user.balance };
    });
  }

  public async reloadDemoCredits(userId: string, amount: number = 1000): Promise<{ success: boolean; newBalance: number }> {
    return this.acquireUserLock(userId, async () => {
      const user = this.data.users[userId];
      if (!user) return { success: false, newBalance: 0 };
      user.balance = Number((user.balance + amount).toFixed(2));

      this.data.ledger.unshift({
        id: `ldg_${crypto.randomUUID().slice(0, 12)}`,
        userId,
        amount,
        balanceAfter: user.balance,
        type: 'DEMO_RELOAD',
        referenceId: 'MANUAL_RELOAD',
        idempotencyKey: `reload_${userId}_${Date.now()}`,
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

  // Rounds Management
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

  // Bets Management
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

  // Config Management
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

    // Record audit log
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

  // Audit Logs
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

  // Telegram Links
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

  // Overview Stats
  public getOverviewStats() {
    const users = Object.values(this.data.users);
    const rounds = Object.values(this.data.rounds);
    const completedRounds = rounds.filter((r) => r.status === 'CRASHED');
    const bets = Object.values(this.data.bets);

    const totalBetsAmount = bets.reduce((acc, b) => acc + b.amount, 0);
    const totalPayoutsAmount = bets.reduce((acc, b) => acc + (b.cashedAmount || 0), 0);

    return {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === 'active').length,
      totalRounds: completedRounds.length,
      totalBetsPlaced: bets.length,
      totalWageredDemo: Number(totalBetsAmount.toFixed(2)),
      totalPaidOutDemo: Number(totalPayoutsAmount.toFixed(2)),
      ledgerEntriesCount: this.data.ledger.length,
    };
  }
}

export const db = new DatabaseManager();
