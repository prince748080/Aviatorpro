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
  balanceSubunits: number; // Stored as precise integer subunits (paise: 100 subunits = 1 INR)
  balance: number; // Calculated balance in standard units (balanceSubunits / 100)
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
  totalPayoutsSubunits: number;
  totalPayouts: number;
  createdAt: string;
}

export type BetStatus = 'PLACED' | 'CASHED_OUT' | 'CRASHED' | 'CANCELLED';

export interface Bet {
  id: string;
  roundId: string;
  userId: string;
  username: string;
  amountSubunits: number;
  amount: number;
  autoCashoutMultiplier: number | null;
  status: BetStatus;
  cashedMultiplier: number | null;
  cashedAmountSubunits: number | null;
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
  upiReceiverId: string; // Configured UPI receiver (e.g. princesuhani@fam)
  minDepositAmount: number; // e.g. 100
  maxDepositAmount: number; // e.g. 100000
  minWithdrawalAmount: number; // e.g. 200
  maxWithdrawalAmount: number; // e.g. 50000
  zappayLinkId: string; // '3ad9a798'
  zappayPayUrl: string; // 'https://panel.zappay.shop/pay.html?id=3ad9a798'
  zappayApiBase: string; // 'https://zappay-beta.vercel.app'
}

export type LedgerEntryType =
  | 'DEPOSIT'
  | 'WITHDRAWAL_RESERVE'
  | 'WITHDRAWAL_COMPLETED'
  | 'WITHDRAWAL_REFUND'
  | 'BET'
  | 'CASHOUT'
  | 'ADMIN_ADJUST'
  | 'CANCELLED_BET';

export interface WalletLedgerEntry {
  id: string;
  userId: string;
  amountSubunits: number; // Signed integer (+ credit, - debit)
  amount: number; // Signed float for display
  balanceAfterSubunits: number;
  balanceAfter: number;
  type: LedgerEntryType;
  referenceId: string; // depositReference, withdrawalReference, betId, etc.
  idempotencyKey: string;
  description: string;
  createdAt: string;
}

export type DepositStatus = 'PENDING_VERIFICATION' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface DepositRequest {
  id: string;
  reference: string; // e.g. DEP-20261023-XXXX
  userId: string;
  username: string;
  amountSubunits: number;
  amount: number;
  upiReceiverId: string;
  userUtrReference?: string; // 12-digit UPI UTR submitted by player
  paymentEvidenceNote?: string;
  status: DepositStatus;
  createdAt: string;
  verifiedAt?: string;
  verifiedByAdminId?: string;
  verifiedByAdminUsername?: string;
  rejectionReason?: string;
  idempotencyKey: string;
  gateway?: 'UPI_MANUAL' | 'ZAPPAY';
  zappayLinkId?: string;
  zappayOrderId?: string;
  zappayPaymentUrl?: string;
}

export type WithdrawalStatus = 'PENDING_REVIEW' | 'APPROVED' | 'COMPLETED' | 'REJECTED';

export interface WithdrawalRequest {
  id: string;
  reference: string; // e.g. WTH-20261023-XXXX
  userId: string;
  username: string;
  amountSubunits: number;
  amount: number;
  payoutMethod: 'UPI' | 'BANK';
  payoutTarget: string; // User UPI ID or Account Number + IFSC
  status: WithdrawalStatus;
  createdAt: string;
  processedAt?: string;
  processedByAdminId?: string;
  processedByAdminUsername?: string;
  payoutReference?: string; // Bank UTR or payment confirmation ref
  rejectionReason?: string;
  idempotencyKey: string;
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
  pendingDepositsCount: number;
  pendingWithdrawalsCount: number;
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
