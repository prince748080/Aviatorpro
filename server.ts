import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
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

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Setup WebSocket Server for Live Multiplier Streaming
const wss = new WebSocketServer({ server, path: '/ws' });
gameEngine.attachWebSocketServer(wss);

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
// AUTHENTICATION
// ----------------------------------------------------

app.post('/api/auth/register', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const cleanUsername = username.trim();
  const existing = db.getUserByUsername(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: 'Username is already taken.' });
  }

  const { hash, salt } = hashPassword(password);
  const user = db.createUser(cleanUsername, hash, salt, 'player');
  const token = generateToken(user);

  res.status(201).json({
    user,
    token,
    message: 'User registered successfully with 1,000 demo credits.',
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = db.getUserByUsername(username.trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({
      error: `Account suspended: ${user.suspensionReason || 'Contact support'}`,
    });
  }

  const valid = verifyPassword(password, user.passwordHash, user.salt);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password.' });
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
  // Always fetch latest authoritative balance from DB
  const user = db.getUserById(req.user!.id);
  res.json({ user });
});

// ----------------------------------------------------
// GAME ENGINE & BETTING (BACKEND AUTHORITATIVE)
// ----------------------------------------------------

// GET /api/game/status (Existing endpoint preserved & upgraded)
app.get('/api/game/status', (req: Request, res: Response) => {
  res.json(gameEngine.getSnapshot());
});

// GET /api/game/round (Existing endpoint preserved & upgraded)
app.get('/api/game/round', (req: Request, res: Response) => {
  const round = gameEngine.getActiveRound();
  res.json({
    round,
    state: gameEngine.getRoundState(),
    currentMultiplier: gameEngine.getCurrentMultiplier(),
    config: db.getConfig(),
  });
});

// POST /api/game/round (Existing endpoint - triggers or inspects round status)
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

// Place Bet (Only permitted during WAITING state, validated by server)
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

  // Fetch updated user balance
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
// USER WALLET & BETS
// ----------------------------------------------------

app.get('/api/user/wallet', requireAuth, (req: AuthRequest, res: Response) => {
  const user = db.getUserById(req.user!.id);
  const ledger = db.getLedger(50, req.user!.id);
  res.json({
    balance: user?.balance ?? 0,
    currency: 'DEMO',
    ledger,
  });
});

app.post('/api/user/reload-demo', requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await db.reloadDemoCredits(req.user!.id, 1000.0);
  res.json({
    message: 'Reloaded 1,000 demo credits.',
    newBalance: result.newBalance,
  });
});

app.get('/api/user/bets', requireAuth, (req: AuthRequest, res: Response) => {
  const bets = db.getUserBets(req.user!.id, 30);
  res.json({ bets });
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

  // Validate limits
  if (updates.maxMultiplier && updates.maxMultiplier < 1.05) {
    return res.status(400).json({ error: 'Maximum multiplier cannot be less than 1.05x.' });
  }

  const updated = db.updateConfig(updates, req.user!.id, req.user!.username, reason);
  gameEngine.broadcast('CONFIG_UPDATED', updated);

  res.json({
    message: 'Configuration updated successfully and audit logged.',
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
  } catch (err) {
    console.error('Error handling telegram webhook:', err);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/telegram/status', (req: Request, res: Response) => {
  res.json({
    status: telegramBot.getStatus(),
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    webhookEndpoint: `${process.env.APP_URL || ''}/api/telegram/webhook`,
  });
});

// ----------------------------------------------------
// FRONTEND SERVING (VITE DEV / PRODUCTION)
// ----------------------------------------------------

async function setupFrontend() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

// ----------------------------------------------------
// SERVER STARTUP & SAFE SHUTDOWN
// ----------------------------------------------------

async function startServer() {
  await setupFrontend();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✈️ Aviator Pro Full-Stack Server running on port ${PORT}`);
    console.log(`WebSocket server active on ws://0.0.0.0:${PORT}/ws`);

    // Start backend authoritative game loop
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
