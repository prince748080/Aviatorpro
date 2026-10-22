import { db } from './db.js';
import { gameEngine } from './engine.js';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
}

export class TelegramBotService {
  private token: string | null = null;
  private isPolling: boolean = false;
  private pollingOffset: number = 0;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private adminIds: Set<number> = new Set();
  private appUrl: string = '';

  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || null;
    this.appUrl = process.env.APP_URL || 'http://localhost:3000';

    if (process.env.TELEGRAM_ADMIN_IDS) {
      process.env.TELEGRAM_ADMIN_IDS.split(',').forEach((idStr) => {
        const id = parseInt(idStr.trim(), 10);
        if (!isNaN(id)) this.adminIds.add(id);
      });
    }
  }

  public getStatus(): 'ONLINE' | 'POLLING' | 'WEBHOOK_READY' | 'CONFIG_REQUIRED' | 'ERROR' {
    if (!this.token) return 'CONFIG_REQUIRED';
    if (this.isPolling) return 'POLLING';
    return 'WEBHOOK_READY';
  }

  public async start() {
    if (!this.token) {
      console.log('[Telegram Bot] Notice: TELEGRAM_BOT_TOKEN not provided. Bot features will run in webhook-ready mock/dormant mode.');
      return;
    }

    const mode = process.env.TELEGRAM_MODE || (process.env.NODE_ENV === 'production' ? 'webhook' : 'polling');
    if (mode === 'polling') {
      this.startPolling();
    } else {
      await this.setupWebhook();
    }
  }

  public stop() {
    this.isPolling = false;
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
  }

  private async callApi(method: string, body?: any): Promise<any> {
    if (!this.token) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      return data;
    } catch (err) {
      console.error(`[Telegram Bot] Error calling API ${method}:`, err);
      return null;
    }
  }

  public async sendMessage(chatId: number | string, text: string, replyMarkup?: any) {
    if (!this.token) {
      console.log(`[Telegram Bot Simulation to ${chatId}]:\n${text}`);
      return;
    }
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }

  private async setupWebhook() {
    if (!this.token || !this.appUrl) return;
    const webhookUrl = `${this.appUrl.replace(/\/$/, '')}/api/telegram/webhook`;
    const res = await this.callApi('setWebhook', { url: webhookUrl });
    if (res?.ok) {
      console.log(`[Telegram Bot] Webhook successfully registered: ${webhookUrl}`);
    } else {
      console.warn('[Telegram Bot] Webhook registration response:', res);
    }
  }

  private startPolling() {
    if (!this.token || this.isPolling) return;
    this.isPolling = true;
    console.log('[Telegram Bot] Starting in long-polling mode...');

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        const res = await this.callApi('getUpdates', {
          offset: this.pollingOffset,
          timeout: 20,
        });
        if (res && res.ok && Array.isArray(res.result)) {
          for (const update of res.result as TelegramUpdate[]) {
            this.pollingOffset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        }
      } catch (err) {
        console.error('[Telegram Bot] Polling error:', err);
      }
      if (this.isPolling) {
        this.pollingTimeout = setTimeout(poll, 1500);
      }
    };

    poll();
  }

  public async handleUpdate(update: TelegramUpdate) {
    const msg = update.message;
    if (!msg || !msg.text) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const telegramUserId = msg.from?.id;
    const telegramUsername = msg.from?.username || msg.from?.first_name || 'Pilot';

    const [cmd, ...args] = text.split(/\s+/);
    const command = cmd.toLowerCase().split('@')[0];

    const isAuthorizedAdmin =
      (telegramUserId && this.adminIds.has(telegramUserId)) ||
      (telegramUserId && db.getTelegramLink(telegramUserId.toString())?.isAdmin);

    switch (command) {
      case '/start':
        await this.handleStart(chatId, telegramUsername);
        break;

      case '/help':
        await this.handleHelp(chatId, !!isAuthorizedAdmin);
        break;

      case '/status':
        await this.handleStatus(chatId);
        break;

      case '/round':
        await this.handleRound(chatId);
        break;

      case '/history':
        await this.handleHistory(chatId);
        break;

      case '/rules':
        await this.handleRules(chatId);
        break;

      case '/support':
        await this.handleSupport(chatId);
        break;

      case '/admin':
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ <b>Access Denied:</b> This command is restricted to system administrators.');
          return;
        }
        await this.handleAdminMenu(chatId);
        break;

      // Administrative Commands
      case '/pausegame':
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        gameEngine.pauseGame(`tg_${telegramUserId}`, telegramUsername, 'Paused via Telegram Bot command');
        await this.sendMessage(chatId, '⏸ <b>Game Paused</b>\nNo new rounds will start until resumed.');
        break;

      case '/resumegame':
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        gameEngine.resumeGame(`tg_${telegramUserId}`, telegramUsername, 'Resumed via Telegram Bot command');
        await this.sendMessage(chatId, '▶️ <b>Game Resumed</b>\nRound loop scheduled.');
        break;

      case '/maintenance':
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const currentMode = db.getConfig().maintenanceMode;
        const newMode = !currentMode;
        gameEngine.setMaintenanceMode(newMode, `tg_${telegramUserId}`, telegramUsername, 'Toggled maintenance mode via Telegram');
        await this.sendMessage(chatId, `🛠 <b>Maintenance Mode:</b> ${newMode ? 'ENABLED 🔴' : 'DISABLED 🟢'}`);
        break;

      case '/systemstatus':
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const stats = db.getOverviewStats();
        const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
        await this.sendMessage(
          chatId,
          `🖥 <b>SYSTEM ARCHITECTURE STATUS</b>\n\n` +
          `• Total Users: <code>${stats.totalUsers}</code>\n` +
          `• Total Completed Rounds: <code>${stats.totalRounds}</code>\n` +
          `• Total Demo Wagered: <code>${stats.totalWageredDemo.toLocaleString()}</code>\n` +
          `• Total Demo Paid Out: <code>${stats.totalPaidOutDemo.toLocaleString()}</code>\n` +
          `• Memory Heap: <code>${mem} MB</code>\n` +
          `• Active WS Clients: <code>${gameEngine.getConnectedClientsCount()}</code>`
        );
        break;

      default:
        await this.sendMessage(
          chatId,
          `Unrecognized command <code>${command}</code>. Send /help for the list of available commands.`
        );
        break;
    }
  }

  private async handleStart(chatId: number, name: string) {
    const welcome =
      `✈️ <b>Welcome to Aviator Pro, ${name}!</b>\n\n` +
      `Aviator Pro is a backend-authoritative crash game with real-time multiplier curves, provably fair SHA-256 verification, and transparent 2.00x limits.\n\n` +
      `<b>Available Commands:</b>\n` +
      `• /status - Check live engine & round state\n` +
      `• /round - Current active round & multiplier\n` +
      `• /history - Last 10 crash multipliers\n` +
      `• /rules - Documented game rules & 2.00x cap\n` +
      `• /support - Customer support contact\n\n` +
      `Use the buttons below to open the game in your browser!`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🚀 Play Aviator Pro', url: this.appUrl },
          { text: '📜 Documented Rules', callback_data: 'rules' },
        ],
        [
          { text: '📊 Live Status', callback_data: 'status' },
          { text: '💬 Support Desk', callback_data: 'support' },
        ],
      ],
    };

    await this.sendMessage(chatId, welcome, keyboard);
  }

  private async handleHelp(chatId: number, isAdmin: boolean) {
    let help =
      `📖 <b>Aviator Pro Bot Commands:</b>\n\n` +
      `• <code>/start</code> - Welcome & Quick Menu\n` +
      `• <code>/status</code> - Engine health & round status\n` +
      `• <code>/round</code> - Current round details & multiplier\n` +
      `• <code>/history</code> - Last 10 round crash multipliers\n` +
      `• <code>/rules</code> - Documented rules and max multiplier\n` +
      `• <code>/support</code> - Customer support channels\n`;

    if (isAdmin) {
      help +=
        `\n👑 <b>Administrator Commands:</b>\n` +
        `• <code>/admin</code> - Admin summary\n` +
        `• <code>/pausegame</code> - Pause new rounds\n` +
        `• <code>/resumegame</code> - Resume game loop\n` +
        `• <code>/maintenance</code> - Toggle maintenance mode\n` +
        `• <code>/systemstatus</code> - Detailed system & ledger metrics\n`;
    }

    await this.sendMessage(chatId, help);
  }

  private async handleStatus(chatId: number) {
    const state = gameEngine.getRoundState();
    const mult = gameEngine.getCurrentMultiplier();
    const round = gameEngine.getActiveRound();
    const config = db.getConfig();

    const text =
      `📊 <b>Aviator Pro Engine Status</b>\n\n` +
      `• State: <b>${state}</b>\n` +
      `• Current Multiplier: <b>${mult.toFixed(2)}x</b>\n` +
      `• Round ID: <code>${round ? round.id : 'N/A'}</code>\n` +
      `• Connected Pilots: <code>${gameEngine.getConnectedClientsCount()}</code>\n` +
      `• Max Allowed Multiplier: <code>${config.maxMultiplier.toFixed(2)}x</code>\n` +
      `• Game Loop: <b>${config.gamePaused ? 'PAUSED ⏸' : 'RUNNING 🟢'}</b>`;

    await this.sendMessage(chatId, text);
  }

  private async handleRound(chatId: number) {
    const round = gameEngine.getActiveRound();
    const state = gameEngine.getRoundState();
    const mult = gameEngine.getCurrentMultiplier();
    const recent = db.getRecentRounds(1);
    const last = recent[0];

    const text =
      `🎯 <b>Active Round Info</b>\n\n` +
      `• Round ID: <code>${round ? round.id : 'None'}</code>\n` +
      `• Status: <b>${state}</b>\n` +
      `• Multiplier: <b>${mult.toFixed(2)}x</b>\n` +
      `• Provable Hash: <code>${round ? round.publicHash.slice(0, 16) + '...' : 'N/A'}</code>\n\n` +
      `🏁 <b>Previous Round:</b> ${last ? `Round #${last.roundNumber} crashed at <b>${last.crashMultiplier.toFixed(2)}x</b>` : 'None'}`;

    await this.sendMessage(chatId, text);
  }

  private async handleHistory(chatId: number) {
    const recent = db.getRecentRounds(10);
    if (recent.length === 0) {
      await this.sendMessage(chatId, 'No completed rounds recorded yet.');
      return;
    }

    const items = recent
      .map((r, i) => {
        const icon = r.crashMultiplier >= 2.0 ? '🔴' : r.crashMultiplier >= 1.5 ? '🟣' : '🔵';
        return `${i + 1}. #${r.roundNumber} ➔ <b>${r.crashMultiplier.toFixed(2)}x</b> ${icon}`;
      })
      .join('\n');

    const text =
      `📜 <b>Recent 10 Crash Multipliers:</b>\n\n` +
      items +
      `\n\n<i>Note: System enforces a documented max multiplier limit of 2.00x.</i>`;

    await this.sendMessage(chatId, text);
  }

  private async handleRules(chatId: number) {
    const config = db.getConfig();
    const text =
      `📜 <b>Aviator Pro - Official Game Rules</b>\n\n` +
      `1. <b>Backend-Authoritative:</b> The flight multiplier and crash point are calculated and verified exclusively on the server.\n` +
      `2. <b>Transparent Multiplier Cap:</b> The maximum permitted multiplier is configured to <b>${config.maxMultiplier.toFixed(2)}x</b>. Flights will always crash at or before this ceiling.\n` +
      `3. <b>Provably Fair:</b> Each round generates a cryptographically random SHA-256 seed hash before the flight begins. The secret seed is revealed immediately after crash.\n` +
      `4. <b>Cash Out Rule:</b> To secure a win, cash out before the plane flies away. Late cash-outs after crash are strictly rejected by the server.\n` +
      `5. <b>Demo Credits:</b> This deployment operates exclusively with demo credits. Real-money wagering is disabled.`;

    await this.sendMessage(chatId, text);
  }

  private async handleSupport(chatId: number) {
    const contact = process.env.SUPPORT_CONTACT || 'support@aviatorpro.local';
    const text =
      `💬 <b>Aviator Pro Customer Support</b>\n\n` +
      `For help, feedback, or inquiries:\n` +
      `• Email: <code>${contact}</code>\n` +
      `• Telegram Support: @AviatorProSupport\n` +
      `• Documentation: Open the web application Rules tab.`;

    await this.sendMessage(chatId, text);
  }

  private async handleAdminMenu(chatId: number) {
    const text =
      `👑 <b>Administrator Control Panel</b>\n\n` +
      `Select an administrative operation:\n` +
      `• <code>/pausegame</code> - Immediately pause new rounds\n` +
      `• <code>/resumegame</code> - Resume standard round scheduling\n` +
      `• <code>/maintenance</code> - Toggle system maintenance mode\n` +
      `• <code>/systemstatus</code> - View database, memory & user stats`;

    await this.sendMessage(chatId, text);
  }
}

export const telegramBot = new TelegramBotService();
