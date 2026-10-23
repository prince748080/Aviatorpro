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

  describe('Authoritative Account Ledger & Subunit Accounting', () => {
    let testUserId: string;

    beforeEach(() => {
      const { hash, salt } = hashPassword('Secret123!');
      const user = db.createUser(`test_pilot_${Date.now()}_${Math.random().toString(36).substring(7)}`, hash, salt, 'player');
      testUserId = user.id;
    });

    it('should initialize new accounts with exactly 0 subunits (no dummy balance)', () => {
      const user = db.getUserById(testUserId);
      expect(user).toBeDefined();
      expect(user?.balanceSubunits).toBe(0);
      expect(user?.balance).toBe(0.00);
    });

    it('should reject bet when balance is insufficient', async () => {
      const uniqueKey = `idemp_${Date.now()}_fail`;
      const res = await db.debitBalanceForBet(testUserId, 100, 'bet_test_fail', uniqueKey);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Insufficient balance');
    });

    it('should handle deposit workflow from creation to evidence to approval and balance credit', async () => {
      const amountINR = 500.00;
      const utr = `UTR${Date.now()}`.padEnd(12, '0').slice(0, 12);

      // 1. Create deposit request
      const depRes = db.createDepositRequest(testUserId, amountINR, 'princesuhani@fam', `idemp_dep_${Date.now()}`);
      expect(depRes.success).toBe(true);
      const depReq = depRes.deposit!;
      expect(depReq.status).toBe('PENDING_VERIFICATION');
      expect(depReq.amountSubunits).toBe(50000);
      expect(depReq.amount).toBe(500.00);

      // 2. Submit payment evidence
      const submitRes = db.submitDepositEvidence(depReq.id, testUserId, utr, 'Payer Name');
      expect(submitRes.success).toBe(true);
      expect(submitRes.deposit?.userUtrReference).toBe(utr);

      // 3. Admin approves deposit
      const approveRes = await db.approveDeposit(depReq.id, 'adm_1', 'admin', 'Verified in bank account');
      expect(approveRes.success).toBe(true);
      expect(approveRes.deposit?.status).toBe('APPROVED');

      // 4. Verify balance was atomically credited
      const userAfter = db.getUserById(testUserId);
      expect(userAfter?.balanceSubunits).toBe(50000);
      expect(userAfter?.balance).toBe(500.00);

      // 5. Verify immutable ledger record
      const ledger = db.getLedger(10, testUserId);
      expect(ledger.length).toBeGreaterThanOrEqual(1);
      expect(ledger[0].type).toBe('DEPOSIT');
      expect(ledger[0].amountSubunits).toBe(50000);
      expect(ledger[0].amount).toBe(500.00);
    });

    it('should handle withdrawal workflow with atomic reservation and completion', async () => {
      // First fund user via approved deposit
      const depRes = db.createDepositRequest(testUserId, 1000, 'princesuhani@fam', `idemp_fund_${Date.now()}`);
      const depId = depRes.deposit!.id;
      db.submitDepositEvidence(depId, testUserId, '123456789012', 'Payer');
      await db.approveDeposit(depId, 'adm_1', 'admin', 'Funded for test');

      const userFunded = db.getUserById(testUserId);
      expect(userFunded?.balanceSubunits).toBe(100000);

      // Create withdrawal request: ₹400.00
      const wthRes = await db.createWithdrawalRequest(
        testUserId,
        400,
        'UPI',
        'test@upi',
        `idemp_wth_${Date.now()}`
      );
      expect(wthRes.success).toBe(true);
      const wthReq = wthRes.withdrawal!;
      expect(wthReq.status).toBe('PENDING_REVIEW');

      // Balance must immediately be reserved/debited to prevent double-spending
      const userReserved = db.getUserById(testUserId);
      expect(userReserved?.balanceSubunits).toBe(60000);
      expect(userReserved?.balance).toBe(600.00);

      // Admin completes withdrawal
      const compRes = await db.completeWithdrawal(wthReq.id, 'adm_1', 'admin', 'BNK987654321');
      expect(compRes.success).toBe(true);
      expect(compRes.withdrawal?.status).toBe('COMPLETED');
      expect(compRes.withdrawal?.payoutReference).toBe('BNK987654321');

      // Balance stays debited
      const userFinal = db.getUserById(testUserId);
      expect(userFinal?.balanceSubunits).toBe(60000);
    });

    it('should atomically refund reserved balance if withdrawal is rejected', async () => {
      // Fund user
      const depRes = db.createDepositRequest(testUserId, 500, 'princesuhani@fam', `idemp_fund2_${Date.now()}`);
      const depId = depRes.deposit!.id;
      db.submitDepositEvidence(depId, testUserId, '999999999999', 'Payer');
      await db.approveDeposit(depId, 'adm_1', 'admin', 'Funded for test');

      // Create withdrawal: ₹200.00
      const wthRes = await db.createWithdrawalRequest(
        testUserId,
        200,
        'UPI',
        'invalid@upi',
        `idemp_wth2_${Date.now()}`
      );
      expect(wthRes.success).toBe(true);
      const wthReq = wthRes.withdrawal!;

      const userReserved = db.getUserById(testUserId);
      expect(userReserved?.balanceSubunits).toBe(30000); // 50000 - 20000

      // Admin rejects withdrawal
      const rejRes = await db.rejectWithdrawal(wthReq.id, 'adm_1', 'admin', 'Invalid UPI ID');
      expect(rejRes.success).toBe(true);
      expect(rejRes.withdrawal?.status).toBe('REJECTED');

      // Balance must be refunded back to ₹500.00
      const userRefunded = db.getUserById(testUserId);
      expect(userRefunded?.balanceSubunits).toBe(50000);
      expect(userRefunded?.balance).toBe(500.00);

      // Ledger has refund record
      const ledger = db.getLedger(10, testUserId);
      expect(ledger[0].type).toBe('WITHDRAWAL_REFUND');
    });

    it('should prevent duplicate debit on identical idempotency key', async () => {
      // Fund user
      const depRes = db.createDepositRequest(testUserId, 200, 'princesuhani@fam', `idemp_fund3_${Date.now()}`);
      const depId = depRes.deposit!.id;
      db.submitDepositEvidence(depId, testUserId, '111222333444', 'Payer');
      await db.approveDeposit(depId, 'adm_1', 'admin', 'Funded for test');

      const key = `key_${Date.now()}`;
      const first = await db.debitBalanceForBet(testUserId, 50, 'bet_1', key);
      expect(first.success).toBe(true);

      const duplicate = await db.debitBalanceForBet(testUserId, 50, 'bet_1', key);
      expect(duplicate.success).toBe(false);
      expect(duplicate.error).toContain('Duplicate bet transaction detected');
    });

    it('should record every cashout in the immutable ledger', async () => {
      const cashoutKey = `cashout_${Date.now()}`;
      const payoutAmount = 150.0;
      const res = await db.creditBalanceForCashout(testUserId, payoutAmount, 'bet_cashout_1', cashoutKey);

      expect(res.success).toBe(true);
      expect(res.newBalance).toBe(150.00);

      const ledger = db.getLedger(10, testUserId);
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
        balanceSubunits: 100000,
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
        balanceSubunits: 100000,
        balance: 1000,
        createdAt: new Date().toISOString(),
      };
      const token = generateToken(mockUser);
      const tampered = token.slice(0, -4) + 'abcd';
      expect(verifyToken(tampered)).toBeNull();
    });
  });

  describe('Phone Number Registration & Identifier Lookup', () => {
    it('should allow registering a user with phone number and looking up by phone or username', () => {
      const phone = '98' + Math.floor(10000000 + Math.random() * 90000000);
      const username = `pilot_phone_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const { hash, salt } = hashPassword('PilotPass123!');
      const user = db.createUser(username, hash, salt, 'player', phone);

      expect(user.phoneNumber).toBe(phone);
      expect(user.username).toBe(username);

      // Lookup by exact phone
      const byPhone = db.getUserByPhoneNumber(phone);
      expect(byPhone).toBeDefined();
      expect(byPhone?.id).toBe(user.id);

      // Lookup by formatted identifier (e.g. +91 formatted)
      const byFormatted = db.getUserByIdentifier(`+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);
      expect(byFormatted).toBeDefined();
      expect(byFormatted?.id).toBe(user.id);

      // Lookup by username
      const byUser = db.getUserByIdentifier(username);
      expect(byUser).toBeDefined();
      expect(byUser?.id).toBe(user.id);
    });

    it('should fire onCashoutCallback when cashout is executed in game engine', async () => {
      let callbackFired = false;
      let callbackMultiplier = 0;
      let callbackAmount = 0;

      engine.setOnCashoutCallback((bet, username, mult, amt) => {
        callbackFired = true;
        callbackMultiplier = mult;
        callbackAmount = amt;
      });

      // Prepare user and balance
      const { hash, salt } = hashPassword('Pass123!');
      const testUser = db.createUser(`win_pilot_${Date.now()}`, hash, salt, 'player');
      const dep = db.createDepositRequest(testUser.id, 1000, 'princesuhani@fam', `dep_${Date.now()}`);
      await db.approveDeposit(dep.deposit!.id, 'admin', 'admin', 'Test funding');

      // Setup mock round with 2.00 crash cap
      const serverSeed = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const publicHash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const mockRound = db.createRound(2.00, serverSeed, publicHash);
      (engine as any).currentRound = mockRound;
      (engine as any).roundState = 'WAITING';

      const betRes = await engine.placeBet(testUser.id, testUser.username, 200, null, `idemp_win_${Date.now()}`);
      expect(betRes.success).toBe(true);

      (engine as any).roundState = 'RUNNING';
      (engine as any).currentMultiplier = 1.75;

      const cashoutRes = await engine.executeCashout(betRes.bet!.id, testUser.id);
      expect(cashoutRes.success).toBe(true);
      expect(callbackFired).toBe(true);
      expect(callbackMultiplier).toBe(1.75);
      expect(callbackAmount).toBe(350);
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
