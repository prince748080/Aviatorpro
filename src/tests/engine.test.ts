import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../server/db.js';
import { GameEngine } from '../server/engine.js';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../server/auth.js';

describe('Aviator Pro - Authoritative Engine & Security Tests', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = new GameEngine();
  });

  describe('Crash Multiplier Generation & Transparent Max Limit', () => {
    it('should generate crash multipliers strictly capped at config.maxMultiplier (2.00x)', () => {
      const config = db.getConfig();
      expect(config.maxMultiplier).toBe(2.00);

      // Run 100 generations to verify no result ever exceeds 2.00x
      for (let i = 0; i < 100; i++) {
        const { crashMultiplier, serverSeed, publicHash } = engine.generateCrashMultiplier();
        expect(crashMultiplier).toBeGreaterThanOrEqual(1.00);
        expect(crashMultiplier).toBeLessThanOrEqual(2.00);
        expect(serverSeed).toHaveLength(64);
        expect(publicHash).toHaveLength(64);
      }
    });

    it('should verify that SHA-256 hash matches the server seed for provable fairness', async () => {
      const crypto = await import('crypto');
      const { serverSeed, publicHash } = engine.generateCrashMultiplier();
      const calculatedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
      expect(calculatedHash).toBe(publicHash);
    });
  });

  describe('Demo Wallet & Ledger Atomic Accounting', () => {
    let testUserId: string;

    beforeEach(() => {
      // Ensure clean test user in db
      const { hash, salt } = hashPassword('Secret123!');
      const user = db.createUser(`test_pilot_${Date.now()}_${Math.random()}`, hash, salt, 'player');
      testUserId = user.id;
    });

    it('should reject bet when balance is insufficient', async () => {
      const uniqueKey = `idemp_${Date.now()}_fail`;
      // Debit more than available balance (e.g. 99999999)
      const res = await db.debitBalanceForBet(testUserId, 99999999, 'bet_test_fail', uniqueKey);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Insufficient demo balance');
    });

    it('should prevent duplicate debit on identical idempotency key', async () => {
      const user = db.createUser(`idemp_user_${Date.now()}`, 'hash', 'salt', 'player');
      const key = `key_${Date.now()}`;

      const first = await db.debitBalanceForBet(user.id, 50, 'bet_1', key);
      expect(first.success).toBe(true);

      const duplicate = await db.debitBalanceForBet(user.id, 50, 'bet_1', key);
      expect(duplicate.success).toBe(false);
      expect(duplicate.error).toContain('Duplicate bet transaction detected');
    });

    it('should record every cashout in the immutable ledger', async () => {
      const user = db.createUser(`cashout_user_${Date.now()}`, 'hash', 'salt', 'player');
      const cashoutKey = `cashout_${Date.now()}`;

      const initialBal = user.balance;
      const payoutAmount = 150.0;
      const res = await db.creditBalanceForCashout(user.id, payoutAmount, 'bet_cashout_1', cashoutKey);

      expect(res.success).toBe(true);
      expect(res.newBalance).toBe(Number((initialBal + payoutAmount).toFixed(2)));

      const ledger = db.getLedger(10, user.id);
      expect(ledger[0].type).toBe('CASHOUT');
      expect(ledger[0].amount).toBe(payoutAmount);
    });
  });

  describe('Authentication & Password Security', () => {
    it('should hash and securely verify passwords with PBKDF2', () => {
      const pass = 'SuperSecurePass!2026';
      const { hash, salt } = hashPassword(pass);
      expect(hash).not.toBe(pass);
      expect(verifyPassword(pass, hash, salt)).toBe(true);
      expect(verifyPassword('WrongPass', hash, salt)).toBe(false);
    });

    it('should generate and verify HMAC signed JWT tokens', () => {
      const mockUser = {
        id: 'usr_test_token',
        username: 'testpilot',
        role: 'player' as const,
        status: 'active' as const,
        balance: 1000,
        createdAt: new Date().toISOString(),
      };
      const token = generateToken(mockUser);
      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(mockUser.id);
      expect(decoded?.role).toBe('player');
    });

    it('should reject tampered JWT tokens', () => {
      const mockUser = {
        id: 'usr_tamper',
        username: 'pilot',
        role: 'player' as const,
        status: 'active' as const,
        balance: 1000,
        createdAt: new Date().toISOString(),
      };
      const token = generateToken(mockUser);
      const tampered = token.slice(0, -4) + 'abcd';
      expect(verifyToken(tampered)).toBeNull();
    });
  });

  describe('Admin Configuration & Audit Trail', () => {
    it('should record audit log whenever game configuration is modified', () => {
      const reason = 'Updated round interval for test';
      db.updateConfig({ roundIntervalMs: 6000 }, 'admin_001', 'admin', reason);

      const logs = db.getAuditLogs(10);
      const latest = logs.find((l) => l.action === 'UPDATE_GAME_CONFIG');
      expect(latest).toBeDefined();
      expect(latest?.reason).toBe(reason);
      expect(latest?.adminUsername).toBe('admin');
    });
  });
});
