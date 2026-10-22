/**
 * Shared Type Definitions for Aviator Pro
 */

export type RoundState = 'WAITING' | 'RUNNING' | 'CRASHED';

export type UserRole = 'player' | 'admin' | 'support';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  balance: number;
  createdAt: string;
  telegramId?: string | null;
  suspensionReason?: string | null;
}

export interface GameRound {
  id: string;
  roundNumber: number;
  startTime: number;
  endTime: number | null;
  crashMultiplier: number;
  serverSeed: string;
  publicHash: string; // SHA-256 of serverSeed for provable fairness
  status: RoundState;
  totalBets: number;
  totalPayouts: number;
  createdAt: string;
}

export type BetStatus = 'PLACED' | 'CASHED_OUT' | 'CRASHED' | 'CANCELLED';

export interface Bet {
  id: string;
  roundId: string;
  userId: string;
  username: string;
  amount: number;
  autoCashoutMultiplier: number | null;
  status: BetStatus;
  cashedMultiplier: number | null;
  cashedAmount: number | null;
  placedAt: number;
  cashedAt: number | null;
}

export interface GameConfig {
  minMultiplier: number;
  maxMultiplier: number; // Configured to 2.00x initially, documented explicit rule
  roundIntervalMs: number;
  tickIntervalMs: number;
  speedFactor: number;
  gamePaused: boolean;
  maintenanceMode: boolean;
  minBetAmount: number;
  maxBetAmount: number;
  maxCashoutAmount: number;
  resultGenerationMethod: 'PROVABLY_FAIR_SHA256' | 'CRYPTO_RANDOM';
}

export type LedgerEntryType = 'BET' | 'CASHOUT' | 'DEMO_RELOAD' | 'ADMIN_ADJUST' | 'CANCELLED_BET';

export interface WalletLedgerEntry {
  id: string;
  userId: string;
  amount: number; // negative for bet, positive for cashout/reload
  balanceAfter: number;
  type: LedgerEntryType;
  referenceId: string; // betId or roundId
  idempotencyKey: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  adminUsername: string;
  action: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string;
  ipAddress?: string;
  createdAt: string;
}

export interface TelegramLink {
  telegramId: string;
  userId: string;
  chatId: string;
  username: string;
  isAdmin: boolean;
  linkedAt: string;
}

export interface SystemStatus {
  backendHealth: 'OK' | 'DEGRADED' | 'DOWN';
  databaseStatus: 'CONNECTED' | 'ERROR';
  telegramBotStatus: 'ONLINE' | 'POLLING' | 'WEBHOOK_READY' | 'CONFIG_REQUIRED' | 'ERROR';
  activeWsConnections: number;
  uptimeSeconds: number;
  currentRoundId: string | null;
  currentRoundState: RoundState;
  activeBetsCount: number;
  memoryUsageMb: number;
}

// Real-time WebSocket Protocol Messages
export type WsMessageType =
  | 'INITIAL_STATE'
  | 'ROUND_WAITING'
  | 'ROUND_COUNTDOWN'
  | 'ROUND_START'
  | 'ROUND_TICK'
  | 'ROUND_CRASH'
  | 'BET_PLACED'
  | 'BET_CASHOUT'
  | 'BET_CANCELLED'
  | 'CONFIG_UPDATED'
  | 'MAINTENANCE_TOGGLED'
  | 'PING'
  | 'PONG'
  | 'ERROR';

export interface WsMessage<T = any> {
  type: WsMessageType;
  payload: T;
  timestamp: number;
}
