import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

import { db } from './src/server/db.js';
import { gameEngine } from './src/server/engine.js';
import { telegramBot } from './src/server/telegram.js';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  requireAuth,
  requireAdmin,
  AuthRequest,
} from './src/server/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);

// Startup environment validation & diagnostic summary (no secrets logged!)
console.log('----------------------------------------------------');
console.log('🚀 Aviator Pro Authoritative Backend Starting');
console.log(`• Environment: ${process.env.NODE_ENV || 'production'}`);
console.log(`• Port: ${PORT}`);
console.log(`• Telegram Bot: Active (@aviatorprince0001_bot)`);
console.log(`• Admin Chat ID: ${process.env.TELEGRAM_ADMIN_CHAT_ID || '8630197412'}`);
console.log(`• Configured UPI Receiver: ${process.env.UPI_PAYMENT_ID || 'princesuhani@fam'}`);
console.log('----------------------------------------------------');

// CORS and Body Parsers
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

// Security Headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Setup WebSocket Server for Live Multiplier Streaming
const wss = new WebSocketServer({ server, path: '/ws' });
gameEngine.attachWebSocketServer(wss);

// Hook proactive Telegram notification for significant game wins (>= ₹500 or multiplier >= 1.50)
gameEngine.setOnCashoutCallback((bet, username, multiplier, amount) => {
  if (amount >= 500 || multiplier >= 1.50) {
    telegramBot.notifyAdminSignificantWin(bet, username, multiplier, amount).catch((err) => {
      console.warn('[Telegram Win Alert] Failed to send win notification:', err);
    });
  }
});

// ----------------------------------------------------
// PUBLIC & HEALTH ENDPOINTS
// ----------------------------------------------------

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected',
    engineState: gameEngine.getRoundState(),
    activeClients: gameEngine.getConnectedClientsCount(),
  });
});

// ----------------------------------------------------
// AUTHENTICATION (PHONE NUMBER & PASSWORD REGISTRATION)
// ----------------------------------------------------

app.post('/api/auth/register', (req: Request, res: Response) => {
  const { username, phoneNumber, password } = req.body;

  // Validate phone number or username
  const rawPhone = typeof phoneNumber === 'string' ? phoneNumber.trim() : '';
  const digitsOnly = rawPhone.replace(/\D/g, '');
  const rawUsername = typeof username === 'string' ? username.trim() : '';

  // Registration requires either a valid phone number (>= 10 digits) or a valid username
  if (!rawPhone && !rawUsername) {
    return res.status(400).json({ error: 'Mobile phone number is required for registration.' });
  }

  if (rawPhone && digitsOnly.length < 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile phone number.' });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  // Derive pilot username if not explicitly provided
  let effectiveUsername = rawUsername;
  if (!effectiveUsername || effectiveUsername.length < 3) {
    if (digitsOnly.length >= 10) {
      effectiveUsername = `Pilot_${digitsOnly.slice(-6)}`;
    } else {
      effectiveUsername = `Pilot_${Math.floor(1000 + Math.random() * 9000)}`;
    }
  }

  // Check if account already exists with phone or username
  if (rawPhone && db.getUserByPhoneNumber(rawPhone)) {
    return res.status(409).json({ error: 'An account with this phone number is already registered. Please sign in.' });
  }
  if (db.getUserByUsername(effectiveUsername)) {
    // If auto-generated was taken, append random suffix
    effectiveUsername = `${effectiveUsername}_${Math.floor(100 + Math.random() * 900)}`;
  }

  const { hash, salt } = hashPassword(password);
  const user = db.createUser(effectiveUsername, hash, salt, 'player', rawPhone || undefined);
  const token = generateToken(user);

  // Proactive Telegram Alert to Admin for new registration / joining
  telegramBot.notifyAdminNewUser(user).catch((err) => {
    console.warn('[Telegram User Alert] Failed to notify admin of new user:', err);
  });

  res.status(201).json({
    user,
    token,
    message: 'Pilot account registered successfully.',
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { identifier, username, phoneNumber, password } = req.body;
  const input = (identifier || phoneNumber || username || '').toString().trim();

  if (!input || !password) {
    return res.status(400).json({ error: 'Phone number or username and password are required.' });
  }

  const user = db.getUserByIdentifier(input);
  if (!user) {
    return res.status(401).json({ error: 'Invalid phone number/username or password.' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({
      error: `Account suspended: ${user.suspensionReason || 'Please contact administrator via Telegram'}`,
    });
  }

  const valid = verifyPassword(password, user.passwordHash, user.salt);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid phone number/username or password.' });
  }

  const { passwordHash: _, salt: __, ...safeUser } = user;
  const token = generateToken(safeUser);

  res.json({
    user: safeUser,
    token,
    message: 'Login successful.',
  });
});

app.get('/api/auth/me', requireAuth, (req: AuthRequest, res: Response) => {
  const user = db.getUserById(req.user!.id);
  res.json({ user });
});

// ----------------------------------------------------
// GAME ENGINE & BETTING (BACKEND AUTHORITATIVE)
// ----------------------------------------------------

app.get('/api/game/status', (req: Request, res: Response) => {
  res.json(gameEngine.getSnapshot());
});

app.get('/api/game/round', (req: Request, res: Response) => {
  const round = gameEngine.getActiveRound();
  res.json({
    round,
    state: gameEngine.getRoundState(),
    currentMultiplier: gameEngine.getCurrentMultiplier(),
    config: db.getConfig(),
  });
});

app.post('/api/game/round', (req: Request, res: Response) => {
  res.json({
    round: gameEngine.getActiveRound(),
    state: gameEngine.getRoundState(),
    currentMultiplier: gameEngine.getCurrentMultiplier(),
  });
});

app.get('/api/game/history', (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  res.json({ rounds: db.getRecentRounds(limit) });
});

app.get('/api/game/config', (req: Request, res: Response) => {
  res.json({ config: db.getConfig() });
});

// Place Bet (Only during WAITING state, validated by server)
app.post('/api/game/bet', requireAuth, async (req: AuthRequest, res: Response) => {
  const { amount, autoCashoutMultiplier, idempotencyKey } = req.body;
  const user = req.user!;

  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid bet amount.' });
  }

  const autoCashout =
    typeof autoCashoutMultiplier === 'number' && autoCashoutMultiplier >= 1.01
      ? Number(autoCashoutMultiplier.toFixed(2))
      : null;

  const key = idempotencyKey || `bet_${user.id}_${Date.now()}`;

  const result = await gameEngine.placeBet(user.id, user.username, amount, autoCashout, key);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const updatedUser = db.getUserById(user.id);

  res.status(201).json({
    message: 'Bet placed successfully.',
    bet: result.bet,
    newBalance: updatedUser?.balance,
  });
});

// Cancel Bet (Only during WAITING state)
app.post('/api/game/cancel-bet', requireAuth, async (req: AuthRequest, res: Response) => {
  const { betId } = req.body;
  if (!betId) {
    return res.status(400).json({ error: 'betId is required.' });
  }

  const result = await gameEngine.cancelBet(betId, req.user!.id);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({
    message: 'Bet cancelled and refunded.',
    newBalance: result.newBalance,
  });
});

// Authoritative Cash Out (Only during RUNNING state, validated by server)
app.post('/api/game/cashout', requireAuth, async (req: AuthRequest, res: Response) => {
  const { betId, targetMultiplier } = req.body;
  if (!betId) {
    return res.status(400).json({ error: 'betId is required.' });
  }

  const result = await gameEngine.executeCashout(betId, req.user!.id, targetMultiplier);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({
    message: 'Cash-out successful!',
    cashedMultiplier: result.cashedMultiplier,
    cashedAmount: result.cashedAmount,
    newBalance: result.newBalance,
  });
});

// ----------------------------------------------------
// USER WALLET, DEPOSITS, WITHDRAWALS & LEDGER
// ----------------------------------------------------

app.get('/api/user/wallet', requireAuth, (req: AuthRequest, res: Response) => {
  const user = db.getUserById(req.user!.id);
  const ledger = db.getLedger(50, req.user!.id);
  const deposits = db.getDeposits(20, req.user!.id);
  const withdrawals = db.getWithdrawals(20, req.user!.id);
  res.json({
    balance: user?.balance ?? 0,
    balanceSubunits: user?.balanceSubunits ?? 0,
    currency: 'INR',
    ledger,
    deposits,
    withdrawals,
  });
});

app.get('/api/user/bets', requireAuth, (req: AuthRequest, res: Response) => {
  const bets = db.getUserBets(req.user!.id, 30);
  res.json({ bets });
});

// Create Deposit Request
app.post('/api/user/deposits', requireAuth, (req: AuthRequest, res: Response) => {
  const { amount, idempotencyKey } = req.body;
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Valid deposit amount is required.' });
  }

  const config = db.getConfig();
  const key = idempotencyKey || `dep_${req.user!.id}_${Date.now()}`;
  const result = db.createDepositRequest(req.user!.id, amount, config.upiReceiverId, key);

  if (!result.success || !result.deposit) {
    return res.status(400).json({ error: result.error });
  }

  // Notify admin via Telegram Bot
  telegramBot.notifyAdminNewDeposit(result.deposit).catch(() => {});

  res.status(201).json({
    message: 'Deposit request created. Please complete the UPI transfer and submit the UTR.',
    deposit: result.deposit,
  });
});

// Submit Deposit UTR / Evidence
app.post('/api/user/deposits/:id/evidence', requireAuth, (req: AuthRequest, res: Response) => {
  const { userUtrReference, paymentEvidenceNote } = req.body;
  if (!userUtrReference || typeof userUtrReference !== 'string') {
    return res.status(400).json({ error: 'UPI UTR / Reference number is required.' });
  }

  const result = db.submitDepositEvidence(req.params.id, req.user!.id, userUtrReference, paymentEvidenceNote);
  if (!result.success || !result.deposit) {
    return res.status(400).json({ error: result.error });
  }

  // Notify admin via Telegram Bot that UTR has been submitted
  telegramBot.notifyAdminNewDeposit(result.deposit).catch(() => {});

  res.json({
    message: 'Payment reference submitted for verification.',
    deposit: result.deposit,
  });
});

app.get('/api/user/deposits', requireAuth, (req: AuthRequest, res: Response) => {
  const deposits = db.getDeposits(50, req.user!.id);
  res.json({ deposits });
});

// ----------------------------------------------------
// ZAPPAY PAYMENT GATEWAY INTEGRATION
// (https://panel.zappay.shop/pay.html?id=3ad9a798)
// ----------------------------------------------------

app.get('/api/user/deposits/zappay/config', (req: Request, res: Response) => {
  const config = db.getConfig();
  res.json({
    linkId: config.zappayLinkId || '3ad9a798',
    payUrl: config.zappayPayUrl || 'https://panel.zappay.shop/pay.html?id=3ad9a798',
    amount: 99,
    merchantName: 'Pritam Kumar',
    upiId: config.upiReceiverId || 'princesuhani@fam',
  });
});

app.post('/api/user/deposits/zappay/initiate', requireAuth, async (req: AuthRequest, res: Response) => {
  const { amount, idempotencyKey } = req.body;
  const user = req.user!;
  const config = db.getConfig();
  const linkId = config.zappayLinkId || '3ad9a798';
  const apiBase = config.zappayApiBase || 'https://zappay-beta.vercel.app';

  try {
    const zapRes = await fetch(`${apiBase}/api/payment-link/${linkId}/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useEmbedded: false }),
    });

    const zapData = await zapRes.json();
    if (!zapData.success || !zapData.data?.paymentUrl) {
      return res.status(400).json({
        error: zapData.message || 'Failed to initiate payment session with ZapPay gateway.',
      });
    }

    const { paymentUrl, orderId, amount: zapAmount } = zapData.data;
    const finalAmount = typeof amount === 'number' && amount > 0 ? amount : (zapAmount || 99);
    const key = idempotencyKey || `zap_${user.id}_${orderId || Date.now()}`;

    const result = db.createDepositRequest(
      user.id,
      finalAmount,
      config.upiReceiverId,
      key,
      'ZAPPAY',
      { linkId, orderId, paymentUrl }
    );

    if (!result.success || !result.deposit) {
      return res.status(400).json({ error: result.error });
    }

    // Notify Telegram Admin
    telegramBot.notifyAdminNewDeposit(result.deposit).catch(() => {});

    res.status(201).json({
      message: 'ZapPay payment session initiated.',
      deposit: result.deposit,
      paymentUrl,
      orderId,
      amount: finalAmount,
      directPayUrl: `https://panel.zappay.shop/pay.html?id=${linkId}`,
    });
  } catch (err: any) {
    console.error('Error initiating ZapPay payment session:', err);
    res.status(500).json({ error: 'Failed to contact ZapPay gateway service.' });
  }
});

app.get('/api/user/deposits/zappay/check-status/:orderId', requireAuth, async (req: AuthRequest, res: Response) => {
  const { orderId } = req.params;
  const config = db.getConfig();
  const apiBase = config.zappayApiBase || 'https://zappay-beta.vercel.app';

  try {
    const zapRes = await fetch(`${apiBase}/api/payment-link/order/${encodeURIComponent(orderId)}/status`);
    const zapData = await zapRes.json();

    if (!zapData.success || !zapData.data) {
      return res.json({ success: false, status: 'pending' });
    }

    const orderStatus = (zapData.data.status || 'pending').toLowerCase();
    const deposit = db.getDepositByZapPayOrder(orderId);

    if (orderStatus === 'success') {
      if (deposit && deposit.status === 'PENDING_VERIFICATION') {
        const approveResult = await db.approveDeposit(
          deposit.id,
          'sys_zappay',
          'ZapPay Gateway API',
          `Automated ZapPay order verification (${orderId})`
        );
        telegramBot.notifyAdminDepositApproved(deposit).catch(() => {});
        return res.json({
          success: true,
          status: 'success',
          credited: true,
          newBalance: approveResult.newBalance,
          deposit: approveResult.deposit,
        });
      }
      return res.json({ success: true, status: 'success', credited: deposit?.status === 'APPROVED' });
    }

    if (orderStatus === 'failed' || orderStatus === 'timeout') {
      if (deposit && deposit.status === 'PENDING_VERIFICATION') {
        db.rejectDeposit(deposit.id, 'sys_zappay', 'ZapPay Gateway API', `ZapPay reported payment ${orderStatus}`);
      }
      return res.json({ success: true, status: orderStatus });
    }

    return res.json({ success: true, status: 'pending' });
  } catch (err: any) {
    console.error('Error polling ZapPay status:', err);
    res.status(500).json({ error: 'Failed to check status with ZapPay gateway' });
  }
});

app.post('/api/zappay/webhook', async (req: Request, res: Response) => {
  try {
    const { order_id, orderId, status, utr } = req.body || {};
    const effectiveOrderId = order_id || orderId;
    const effectiveStatus = (status || '').toLowerCase();

    if (!effectiveOrderId) {
      return res.status(400).json({ error: 'Missing order_id' });
    }

    const deposit = db.getDepositByZapPayOrder(effectiveOrderId);
    if (deposit && deposit.status === 'PENDING_VERIFICATION') {
      if (effectiveStatus === 'success') {
        if (utr) deposit.userUtrReference = utr;
        await db.approveDeposit(
          deposit.id,
          'webhook_zappay',
          'ZapPay Webhook',
          `Verified via ZapPay Webhook (${effectiveOrderId})`
        );
        telegramBot.notifyAdminDepositApproved(deposit).catch(() => {});
      } else if (effectiveStatus === 'failed') {
        db.rejectDeposit(deposit.id, 'webhook_zappay', 'ZapPay Webhook', 'ZapPay webhook payment failed');
      }
    }

    res.json({ ok: true, status: 'processed' });
  } catch (err: any) {
    console.error('Error processing ZapPay webhook:', err);
    res.status(500).json({ ok: false });
  }
});

// Create Withdrawal Request
app.post('/api/user/withdrawals', requireAuth, async (req: AuthRequest, res: Response) => {
  const { amount, payoutMethod, payoutTarget, idempotencyKey } = req.body;
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Valid withdrawal amount is required.' });
  }
  if (!payoutMethod || !['UPI', 'BANK'].includes(payoutMethod)) {
    return res.status(400).json({ error: "Payout method must be 'UPI' or 'BANK'." });
  }
  if (!payoutTarget || typeof payoutTarget !== 'string' || payoutTarget.trim().length < 5) {
    return res.status(400).json({ error: 'Valid payout details (UPI ID or Account/IFSC) required.' });
  }

  const key = idempotencyKey || `wth_${req.user!.id}_${Date.now()}`;
  const result = await db.createWithdrawalRequest(req.user!.id, amount, payoutMethod, payoutTarget, key);

  if (!result.success || !result.withdrawal) {
    return res.status(400).json({ error: result.error });
  }

  // Notify admin via Telegram Bot
  telegramBot.notifyAdminNewWithdrawal(result.withdrawal).catch(() => {});

  res.status(201).json({
    message: 'Withdrawal request created. Funds have been reserved pending review.',
    withdrawal: result.withdrawal,
    newBalance: result.newBalance,
  });
});

app.get('/api/user/withdrawals', requireAuth, (req: AuthRequest, res: Response) => {
  const withdrawals = db.getWithdrawals(50, req.user!.id);
  res.json({ withdrawals });
});

// ----------------------------------------------------
// PROTECTED ADMIN DASHBOARD ROUTES
// ----------------------------------------------------

app.get('/api/admin/overview', requireAdmin, (req: AuthRequest, res: Response) => {
  const stats = db.getOverviewStats();
  const memory = process.memoryUsage();
  res.json({
    stats,
    system: {
      uptimeSeconds: Math.floor(process.uptime()),
      memoryHeapMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
      wsConnections: gameEngine.getConnectedClientsCount(),
      roundState: gameEngine.getRoundState(),
      currentMultiplier: gameEngine.getCurrentMultiplier(),
      activeBetsCount: gameEngine.getActiveBetsCount(),
      telegramStatus: telegramBot.getStatus(),
    },
    config: db.getConfig(),
  });
});

app.get('/api/admin/deposits', requireAdmin, (req: AuthRequest, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const userId = req.query.userId ? String(req.query.userId) : undefined;
  const deposits = db.getDeposits(limit, userId);
  res.json({ deposits });
});

app.post('/api/admin/deposits/:id/approve', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { reason } = req.body;
  const result = await db.approveDeposit(
    req.params.id,
    req.user!.id,
    req.user!.username,
    reason || 'Approved by Administrator'
  );

  if (!result.success || !result.deposit) {
    return res.status(400).json({ error: result.error });
  }

  telegramBot.notifyAdminDepositApproved(result.deposit).catch(() => {});

  res.json({
    message: 'Deposit approved and credited to ledger.',
    deposit: result.deposit,
    newBalance: result.newBalance,
  });
});

app.post('/api/admin/deposits/:id/reject', requireAdmin, (req: AuthRequest, res: Response) => {
  const { reason } = req.body;
  const result = db.rejectDeposit(
    req.params.id,
    req.user!.id,
    req.user!.username,
    reason || 'Declined by Administrator'
  );

  if (!result.success || !result.deposit) {
    return res.status(400).json({ error: result.error });
  }

  telegramBot.notifyAdminDepositRejected(result.deposit, reason || 'Declined').catch(() => {});

  res.json({
    message: 'Deposit rejected.',
    deposit: result.deposit,
  });
});

app.get('/api/admin/withdrawals', requireAdmin, (req: AuthRequest, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const userId = req.query.userId ? String(req.query.userId) : undefined;
  const withdrawals = db.getWithdrawals(limit, userId);
  res.json({ withdrawals });
});

app.post('/api/admin/withdrawals/:id/complete', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { payoutReference } = req.body;
  if (!payoutReference) {
    return res.status(400).json({ error: 'Payment provider payout reference / UTR is required.' });
  }

  const result = await db.completeWithdrawal(
    req.params.id,
    req.user!.id,
    req.user!.username,
    payoutReference
  );

  if (!result.success || !result.withdrawal) {
    return res.status(400).json({ error: result.error });
  }

  telegramBot.notifyAdminWithdrawalCompleted(result.withdrawal).catch(() => {});

  res.json({
    message: 'Withdrawal marked as completed and paid.',
    withdrawal: result.withdrawal,
  });
});

app.post('/api/admin/withdrawals/:id/reject', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { reason } = req.body;
  const result = await db.rejectWithdrawal(
    req.params.id,
    req.user!.id,
    req.user!.username,
    reason || 'Declined by Administrator'
  );

  if (!result.success || !result.withdrawal) {
    return res.status(400).json({ error: result.error });
  }

  telegramBot.notifyAdminWithdrawalRejected(result.withdrawal, reason || 'Declined').catch(() => {});

  res.json({
    message: 'Withdrawal rejected and reserved funds refunded.',
    withdrawal: result.withdrawal,
    newBalance: result.newBalance,
  });
});

app.get('/api/admin/config', requireAdmin, (req: AuthRequest, res: Response) => {
  res.json({ config: db.getConfig() });
});

app.post('/api/admin/config', requireAdmin, (req: AuthRequest, res: Response) => {
  const { updates, reason } = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Config updates object is required.' });
  }
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ error: 'Audit reason is required for configuration changes.' });
  }

  if (updates.maxMultiplier && updates.maxMultiplier < 1.05) {
    return res.status(400).json({ error: 'Maximum multiplier cannot be less than 1.05x.' });
  }

  const updated = db.updateConfig(updates, req.user!.id, req.user!.username, reason);
  gameEngine.broadcast('CONFIG_UPDATED', updated);

  res.json({
    message: 'Configuration updated and audit logged.',
    config: updated,
  });
});

app.post('/api/admin/game/pause', requireAdmin, (req: AuthRequest, res: Response) => {
  const { reason } = req.body;
  gameEngine.pauseGame(req.user!.id, req.user!.username, reason || 'Paused via Admin Panel');
  res.json({ message: 'Game paused.' });
});

app.post('/api/admin/game/resume', requireAdmin, (req: AuthRequest, res: Response) => {
  const { reason } = req.body;
  gameEngine.resumeGame(req.user!.id, req.user!.username, reason || 'Resumed via Admin Panel');
  res.json({ message: 'Game resumed.' });
});

app.post('/api/admin/game/maintenance', requireAdmin, (req: AuthRequest, res: Response) => {
  const { enabled, reason } = req.body;
  gameEngine.setMaintenanceMode(!!enabled, req.user!.id, req.user!.username, reason || 'Maintenance mode toggled');
  res.json({ message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}.` });
});

app.get('/api/admin/users', requireAdmin, (req: AuthRequest, res: Response) => {
  const users = db.getAllUsers();
  res.json({ users });
});

app.post('/api/admin/users/:id/status', requireAdmin, (req: AuthRequest, res: Response) => {
  const { status, reason } = req.body;
  const targetId = req.params.id;

  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: "Status must be 'active' or 'suspended'." });
  }
  if (!reason) {
    return res.status(400).json({ error: 'Reason is required for account status change.' });
  }

  const updatedUser = db.updateUserStatus(targetId, status, reason, req.user!.id, req.user!.username);
  if (!updatedUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json({
    message: `User status changed to ${status}.`,
    user: updatedUser,
  });
});

app.get('/api/admin/ledger', requireAdmin, (req: AuthRequest, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const userId = req.query.userId ? String(req.query.userId) : undefined;
  const ledger = db.getLedger(limit, userId);
  res.json({ ledger });
});

app.get('/api/admin/logs', requireAdmin, (req: AuthRequest, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = db.getAuditLogs(limit);
  res.json({ logs });
});

// ----------------------------------------------------
// TELEGRAM BOT WEBHOOK
// ----------------------------------------------------

app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
  try {
    await telegramBot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('Error handling Telegram webhook:', err?.message || err);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/telegram/status', (req: Request, res: Response) => {
  res.json({
    status: telegramBot.getStatus(),
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    webhookEndpoint: `${process.env.FRONTEND_URL || process.env.APP_URL || ''}/api/telegram/webhook`,
  });
});

// ----------------------------------------------------
// FRONTEND SERVING (STATIC DIST FIRST / VITE DEV FALLBACK)
// ----------------------------------------------------

async function setupFrontend() {
  const distPath = path.resolve(__dirname, 'dist');
  const distExists = fs.existsSync(path.join(distPath, 'index.html'));
  const isExplicitDev = process.env.NODE_ENV === 'development' && !distExists;

  if (isExplicitDev) {
    console.log('[Frontend] Launching Vite development middleware...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    if (distExists) {
      console.log(`[Frontend] Serving pre-built production assets from: ${distPath}`);
      app.use(express.static(distPath));
      app.get('*', (req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
          return next();
        }
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      console.log('[Frontend] dist not found, falling back to Vite middleware...');
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, allowedHosts: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }
}

// ----------------------------------------------------
// SERVER STARTUP & SAFE SHUTDOWN
// ----------------------------------------------------

async function startServer() {
  await setupFrontend();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✈️ Aviator Pro Server listening on port ${PORT}`);
    console.log(`WebSocket server mounted on /ws`);

    // Start authoritative game engine loop
    gameEngine.start();

    // Start Telegram Bot
    telegramBot.start();
  });
}

function handleShutdown() {
  console.log('Initiating safe server shutdown...');
  gameEngine.stop();
  telegramBot.stop();
  wss.clients.forEach((client) => client.close(1001, 'Server shutting down'));
  server.close(() => {
    console.log('Server terminated cleanly.');
    process.exit(0);
  });
}

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

startServer().catch((err) => {
  console.error('Fatal server startup failure:', err);
  process.exit(1);
});
