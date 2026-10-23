import crypto from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from './db.js';
import {
  GameRound,
  RoundState,
  Bet,
  WsMessage,
  WsMessageType,
} from '../types/index.js';

export interface ActiveRoundState {
  round: GameRound;
  currentMultiplier: number;
  elapsedMs: number;
  waitingCountdownSec: number;
  state: RoundState;
}

export class GameEngine {
  private wss: WebSocketServer | null = null;
  private currentRound: GameRound | null = null;
  private currentMultiplier: number = 1.00;
  private roundState: RoundState = 'WAITING';
  private waitingCountdown: number = 5; // seconds
  private roundStartTime: number = 0;
  private tickTimer: NodeJS.Timeout | null = null;
  private stateTimer: NodeJS.Timeout | null = null;
  private isRunningLoop: boolean = false;
  private activeBets: Map<string, Bet> = new Map(); // betId -> Bet
  private onCashoutCallback: ((bet: Bet, username: string, multiplier: number, amount: number) => void) | null = null;

  constructor() {
    // Engine starts when start() is invoked
  }

  public setOnCashoutCallback(cb: (bet: Bet, username: string, multiplier: number, amount: number) => void) {
    this.onCashoutCallback = cb;
  }

  public attachWebSocketServer(wss: WebSocketServer) {
    this.wss = wss;
    this.wss.on('connection', (ws: WebSocket) => {
      this.sendToClient(ws, 'INITIAL_STATE', this.getSnapshot());

      ws.on('message', (messageRaw: string) => {
        try {
          const msg = JSON.parse(messageRaw.toString());
          if (msg.type === 'PING') {
            this.sendToClient(ws, 'PONG', { time: Date.now() });
          }
        } catch {
          // Ignore invalid packets
        }
      });
    });
  }

  public start() {
    if (this.isRunningLoop) return;
    this.isRunningLoop = true;
    this.scheduleNextRound();
  }

  public stop() {
    this.isRunningLoop = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.stateTimer) clearTimeout(this.stateTimer);
  }

  public getSnapshot() {
    return {
      round: this.currentRound,
      state: this.roundState,
      currentMultiplier: Number(this.currentMultiplier.toFixed(2)),
      waitingCountdown: this.waitingCountdown,
      activeBets: Array.from(this.activeBets.values()),
      recentRounds: db.getRecentRounds(25),
      config: db.getConfig(),
    };
  }

  public broadcast<T = any>(type: WsMessageType, payload: T) {
    if (!this.wss) return;
    const message: WsMessage<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };
    const json = JSON.stringify(message);

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  }

  private sendToClient<T = any>(ws: WebSocket, type: WsMessageType, payload: T) {
    if (ws.readyState === WebSocket.OPEN) {
      const message: WsMessage<T> = {
        type,
        payload,
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(message));
    }
  }

  // Provably Fair Crash Generator with Authoritative Max Multiplier Cap
  public generateCrashMultiplier(): { crashMultiplier: number; serverSeed: string; publicHash: string } {
    const config = db.getConfig();
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const publicHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

    // 52-bit integer derivation from seed hash
    const h = parseInt(publicHash.slice(0, 13), 16);
    const e = Math.pow(2, 52);

    // 3% instant house edge crash at 1.00x
    let rawMultiplier: number;
    if (h % 33 === 0) {
      rawMultiplier = 1.00;
    } else {
      rawMultiplier = Math.floor((100 * e - h) / (e - h)) / 100;
    }

    // Strict boundary enforcement:
    // 1. Min multiplier (configured default 1.01)
    // 2. Max multiplier (configured default 2.00x, explicit transparent rule!)
    const capped = Math.min(Math.max(rawMultiplier, config.minMultiplier), config.maxMultiplier);
    const finalCrashMultiplier = Number(capped.toFixed(2));

    return {
      crashMultiplier: finalCrashMultiplier,
      serverSeed,
      publicHash,
    };
  }

  private scheduleNextRound() {
    if (!this.isRunningLoop) return;
    const config = db.getConfig();

    // Check pause or maintenance mode
    if (config.gamePaused || config.maintenanceMode) {
      this.roundState = 'WAITING';
      this.broadcast('MAINTENANCE_TOGGLED', {
        paused: config.gamePaused,
        maintenance: config.maintenanceMode,
      });
      this.stateTimer = setTimeout(() => this.scheduleNextRound(), 3000);
      return;
    }

    // 1. Create new authoritative round
    const { crashMultiplier, serverSeed, publicHash } = this.generateCrashMultiplier();
    this.currentRound = db.createRound(crashMultiplier, serverSeed, publicHash);
    this.roundState = 'WAITING';
    this.currentMultiplier = 1.00;
    this.activeBets.clear();

    const waitDurationMs = config.roundIntervalMs || 5000;
    const countdownIntervalMs = 1000;
    this.waitingCountdown = Math.ceil(waitDurationMs / 1000);

    this.broadcast('ROUND_WAITING', {
      round: this.currentRound,
      countdownSec: this.waitingCountdown,
      waitDurationMs,
    });

    let remainingMs = waitDurationMs;
    const countdownInterval = setInterval(() => {
      remainingMs -= countdownIntervalMs;
      this.waitingCountdown = Math.max(0, Math.ceil(remainingMs / 1000));
      this.broadcast('ROUND_COUNTDOWN', {
        roundId: this.currentRound?.id,
        countdownSec: this.waitingCountdown,
      });
      if (remainingMs <= 0) {
        clearInterval(countdownInterval);
      }
    }, countdownIntervalMs);

    this.stateTimer = setTimeout(() => {
      clearInterval(countdownInterval);
      this.startFlight();
    }, waitDurationMs);
  }

  private startFlight() {
    if (!this.currentRound || !this.isRunningLoop) return;
    const config = db.getConfig();

    this.roundState = 'RUNNING';
    this.roundStartTime = Date.now();
    this.currentMultiplier = 1.00;

    db.updateRound(this.currentRound.id, {
      status: 'RUNNING',
      startTime: this.roundStartTime,
    });

    this.broadcast('ROUND_START', {
      roundId: this.currentRound.id,
      roundNumber: this.currentRound.roundNumber,
      startTime: this.roundStartTime,
      initialMultiplier: 1.00,
      activeBetsCount: this.activeBets.size,
    });

    const targetCrash = this.currentRound.crashMultiplier;
    const tickInterval = config.tickIntervalMs || 50;

    if (this.tickTimer) clearInterval(this.tickTimer);

    // Multiplier progression loop:
    // Multiplier accelerates smoothly over time:
    // progression formula: 1 + 0.05 * t^1.4 * speedFactor
    this.tickTimer = setInterval(() => {
      if (this.roundState !== 'RUNNING' || !this.currentRound) {
        if (this.tickTimer) clearInterval(this.tickTimer);
        return;
      }

      const elapsedSec = (Date.now() - this.roundStartTime) / 1000;
      const speed = config.speedFactor || 1.0;
      // Smooth exponential growth curve
      const newMultiplier = Number((1.00 + Math.pow(elapsedSec * 0.45 * speed, 1.45)).toFixed(2));

      // Check auto-cashouts for all active bets
      this.checkAutoCashouts(newMultiplier);

      // Check crash condition
      if (newMultiplier >= targetCrash) {
        this.currentMultiplier = targetCrash;
        this.triggerCrash();
      } else {
        this.currentMultiplier = newMultiplier;
        this.broadcast('ROUND_TICK', {
          multiplier: this.currentMultiplier,
          elapsedSec: Number(elapsedSec.toFixed(2)),
        });
      }
    }, tickInterval);
  }

  private async checkAutoCashouts(multiplier: number) {
    const promises: Promise<any>[] = [];
    for (const bet of this.activeBets.values()) {
      if (
        bet.status === 'PLACED' &&
        bet.autoCashoutMultiplier &&
        multiplier >= bet.autoCashoutMultiplier &&
        bet.autoCashoutMultiplier <= (this.currentRound?.crashMultiplier || 2.00)
      ) {
        promises.push(this.executeCashout(bet.id, bet.userId, bet.autoCashoutMultiplier));
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  private triggerCrash() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    if (!this.currentRound) return;
    this.roundState = 'CRASHED';
    const crashMultiplier = this.currentRound.crashMultiplier;
    const endTime = Date.now();

    // Mark remaining active bets as CRASHED (loss)
    for (const bet of this.activeBets.values()) {
      if (bet.status === 'PLACED') {
        bet.status = 'CRASHED';
        db.updateBet(bet.id, { status: 'CRASHED' });
      }
    }

    // Persist completed round in database
    db.updateRound(this.currentRound.id, {
      status: 'CRASHED',
      endTime,
      crashMultiplier,
    });

    // Reveal server seed for provable fairness
    this.broadcast('ROUND_CRASH', {
      roundId: this.currentRound.id,
      crashMultiplier,
      serverSeed: this.currentRound.serverSeed,
      publicHash: this.currentRound.publicHash,
      recentRounds: db.getRecentRounds(25),
    });

    // Wait 3.5 seconds before next round so players can see crash result and verification
    this.stateTimer = setTimeout(() => {
      this.scheduleNextRound();
    }, 3500);
  }

  // Player Bet Placement
  public async placeBet(
    userId: string,
    username: string,
    amount: number,
    autoCashoutMultiplier: number | null,
    idempotencyKey: string
  ): Promise<{ success: boolean; bet?: Bet; error?: string }> {
    const config = db.getConfig();

    if (config.gamePaused || config.maintenanceMode) {
      return { success: false, error: 'Game is currently paused or undergoing maintenance.' };
    }

    if (!this.currentRound || this.roundState !== 'WAITING') {
      return { success: false, error: 'Bets can only be placed during the WAITING phase before the round starts.' };
    }

    if (amount < config.minBetAmount) {
      return { success: false, error: `Minimum bet is ${config.minBetAmount} demo credits.` };
    }

    if (amount > config.maxBetAmount) {
      return { success: false, error: `Maximum bet is ${config.maxBetAmount} demo credits.` };
    }

    if (autoCashoutMultiplier !== null) {
      if (autoCashoutMultiplier < config.minMultiplier) {
        return { success: false, error: `Auto-cashout must be at least ${config.minMultiplier}x.` };
      }
      if (autoCashoutMultiplier > config.maxMultiplier) {
        return {
          success: false,
          error: `Auto-cashout exceeds maximum permitted multiplier of ${config.maxMultiplier.toFixed(2)}x.`,
        };
      }
    }

    const betId = `bet_${crypto.randomUUID().slice(0, 12)}`;

    // Debit user balance atomically with transaction lock
    const debitResult = await db.debitBalanceForBet(userId, amount, betId, idempotencyKey);
    if (!debitResult.success) {
      return { success: false, error: debitResult.error || 'Failed to debit balance' };
    }

    const bet: Bet = {
      id: betId,
      roundId: this.currentRound.id,
      userId,
      username,
      amountSubunits: Math.round(amount * 100),
      amount: Number(amount.toFixed(2)),
      autoCashoutMultiplier,
      status: 'PLACED',
      cashedMultiplier: null,
      cashedAmountSubunits: null,
      cashedAmount: null,
      placedAt: Date.now(),
      cashedAt: null,
    };

    this.activeBets.set(betId, bet);
    db.recordBet(bet);

    this.broadcast('BET_PLACED', {
      bet: {
        id: bet.id,
        roundId: bet.roundId,
        username: bet.username,
        amount: bet.amount,
        status: bet.status,
      },
    });

    return { success: true, bet };
  }

  // Cancel Bet (only allowed during WAITING phase)
  public async cancelBet(
    betId: string,
    userId: string
  ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    if (this.roundState !== 'WAITING') {
      return { success: false, error: 'Bets cannot be cancelled once the round starts.' };
    }

    const bet = this.activeBets.get(betId);
    if (!bet || bet.userId !== userId || bet.status !== 'PLACED') {
      return { success: false, error: 'Bet not found or cannot be cancelled.' };
    }

    bet.status = 'CANCELLED';
    this.activeBets.delete(betId);
    db.updateBet(betId, { status: 'CANCELLED' });

    const refund = await db.refundCancelledBet(userId, bet.amount, betId, `refund_${betId}`);

    this.broadcast('BET_CANCELLED', { betId });
    return { success: true, newBalance: refund.newBalance };
  }

  // Authoritative Cash-out Validation
  public async executeCashout(
    betId: string,
    userId: string,
    targetMultiplier?: number
  ): Promise<{ success: boolean; cashedMultiplier?: number; cashedAmount?: number; newBalance?: number; error?: string }> {
    // 1. Validate round is RUNNING
    if (this.roundState !== 'RUNNING' || !this.currentRound) {
      return { success: false, error: 'Cash-out rejected: Round is not running.' };
    }

    const bet = this.activeBets.get(betId);
    if (!bet) {
      return { success: false, error: 'Cash-out rejected: Active bet not found.' };
    }

    if (bet.userId !== userId) {
      return { success: false, error: 'Cash-out rejected: Unauthorized bet owner.' };
    }

    if (bet.status !== 'PLACED') {
      return { success: false, error: `Cash-out rejected: Bet is already ${bet.status.toLowerCase()}.` };
    }

    // Multiplier determined authoritatively by server
    const currentMultiplier = this.currentMultiplier;

    // Check if flight already exceeded crash point
    if (currentMultiplier >= this.currentRound.crashMultiplier) {
      return { success: false, error: 'Cash-out rejected: Plane has already crashed.' };
    }

    const cashoutMultiplier = targetMultiplier ? Math.min(targetMultiplier, currentMultiplier) : currentMultiplier;
    const config = db.getConfig();
    const effectiveMultiplier = Math.min(cashoutMultiplier, config.maxMultiplier);

    const cashedAmount = Number((bet.amount * effectiveMultiplier).toFixed(2));

    // Check max cashout limit
    if (config.maxCashoutAmount && cashedAmount > config.maxCashoutAmount) {
      return { success: false, error: `Cash-out amount exceeds maximum limit of ${config.maxCashoutAmount}.` };
    }

    // Idempotency key for cashout
    const cashoutIdempotencyKey = `cashout_${betId}_${this.currentRound.id}`;

    // Credit user demo balance atomically
    const creditResult = await db.creditBalanceForCashout(userId, cashedAmount, betId, cashoutIdempotencyKey);
    if (!creditResult.success) {
      return { success: false, error: creditResult.error || 'Failed to credit payout.' };
    }

    bet.status = 'CASHED_OUT';
    bet.cashedMultiplier = effectiveMultiplier;
    bet.cashedAmount = cashedAmount;
    bet.cashedAmountSubunits = Math.round(cashedAmount * 100);
    bet.cashedAt = Date.now();

    db.updateBet(betId, {
      status: 'CASHED_OUT',
      cashedMultiplier: effectiveMultiplier,
      cashedAmount,
      cashedAmountSubunits: bet.cashedAmountSubunits,
      cashedAt: bet.cashedAt,
    });

    this.broadcast('BET_CASHOUT', {
      betId: bet.id,
      username: bet.username,
      cashedMultiplier: effectiveMultiplier,
      cashedAmount,
    });

    if (this.onCashoutCallback) {
      try {
        this.onCashoutCallback(bet, bet.username, effectiveMultiplier, cashedAmount);
      } catch (cbErr) {
        console.error('Error invoking onCashoutCallback:', cbErr);
      }
    }

    return {
      success: true,
      cashedMultiplier: effectiveMultiplier,
      cashedAmount,
      newBalance: creditResult.newBalance,
    };
  }

  // Admin Controls
  public pauseGame(adminId: string, adminUsername: string, reason: string) {
    db.updateConfig({ gamePaused: true }, adminId, adminUsername, reason);
    this.broadcast('CONFIG_UPDATED', db.getConfig());
  }

  public resumeGame(adminId: string, adminUsername: string, reason: string) {
    db.updateConfig({ gamePaused: false }, adminId, adminUsername, reason);
    this.broadcast('CONFIG_UPDATED', db.getConfig());
    if (this.roundState === 'WAITING') {
      this.scheduleNextRound();
    }
  }

  public setMaintenanceMode(enabled: boolean, adminId: string, adminUsername: string, reason: string) {
    db.updateConfig({ maintenanceMode: enabled }, adminId, adminUsername, reason);
    this.broadcast('CONFIG_UPDATED', db.getConfig());
  }

  public getActiveRound(): GameRound | null {
    return this.currentRound;
  }

  public getRoundState(): RoundState {
    return this.roundState;
  }

  public getCurrentMultiplier(): number {
    return this.currentMultiplier;
  }

  public getConnectedClientsCount(): number {
    return this.wss ? this.wss.clients.size : 0;
  }

  public getActiveBetsCount(): number {
    return this.activeBets.size;
  }
}

export const gameEngine = new GameEngine();
