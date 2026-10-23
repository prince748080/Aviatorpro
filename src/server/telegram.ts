import { db } from './db.js';
import { gameEngine } from './engine.js';
import { DepositRequest, WithdrawalRequest } from '../types/index.js';

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
  callback_query?: {
    id: string;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
        type: string;
      };
      text?: string;
    };
    data?: string;
  };
}

export class TelegramBotService {
  private token: string | null = null;
  private isPolling: boolean = false;
  private pollingOffset: number = 0;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private adminIds: Set<number> = new Set();
  private adminChatId: number | null = null;
  private botUsername: string = '';
  private appUrl: string = '';

  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || '8953818844:AAFh6NpjRWJS5Rsbjrj6xeH-6zGK9wvTaSE';
    this.appUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://aviatorpro-rsbr.onrender.com';
    this.botUsername = process.env.BOT_USERNAME || '@aviatorprince0001_bot';

    const defaultAdminChatId = 8630197412;
    if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
      const parsed = parseInt(process.env.TELEGRAM_ADMIN_CHAT_ID.trim(), 10);
      if (!isNaN(parsed)) {
        this.adminChatId = parsed;
        this.adminIds.add(parsed);
      } else {
        this.adminChatId = defaultAdminChatId;
        this.adminIds.add(defaultAdminChatId);
      }
    } else {
      this.adminChatId = defaultAdminChatId;
      this.adminIds.add(defaultAdminChatId);
    }

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
      console.log('[Telegram Bot] TELEGRAM_BOT_TOKEN not configured. Bot running in passive/dormant mode.');
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
      console.error(`[Telegram Bot] Error invoking API ${method}:`, err);
      return null;
    }
  }

  public async sendMessage(chatId: number | string, text: string, replyMarkup?: any) {
    if (!this.token) {
      console.log(`[Telegram Bot Simulation -> ${chatId}]:\n${text}`);
      return;
    }
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }

  public async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert: boolean = false) {
    if (!this.token) return;
    return this.callApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  }

  public async editMessageText(chatId: number | string, messageId: number, text: string, replyMarkup?: any) {
    if (!this.token) return;
    return this.callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
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
    console.log('[Telegram Bot] Starting long-polling service...');

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

  // ----------------------------------------------------------------------
  // PROACTIVE ADMIN ALERTS
  // ----------------------------------------------------------------------

  public async notifyAdminNewDeposit(dep: DepositRequest) {
    if (!this.adminChatId) return;
    const isZap = dep.gateway === 'ZAPPAY';
    const text =
      `📥 <b>NEW ${isZap ? '⚡ ZAPPAY' : 'UPI'} DEPOSIT SUBMITTED</b>\n\n` +
      `• Reference: <code>${dep.reference}</code>\n` +
      `• Method: <b>${isZap ? 'ZapPay Gateway (API)' : 'Direct UPI Transfer'}</b>\n` +
      `• User: <b>${dep.username}</b>\n` +
      `• Amount: <b>₹${dep.amount.toFixed(2)}</b>\n` +
      (isZap && dep.zappayOrderId ? `• ZapPay Order: <code>${dep.zappayOrderId}</code>\n` : '') +
      `• UPI UTR: <code>${dep.userUtrReference || (isZap ? 'Automated ZapPay Session' : 'Awaiting UTR submission')}</code>\n` +
      `• Receiver UPI: <code>${dep.upiReceiverId}</code>\n\n` +
      `<i>Tap below to approve or reject manually:</i>`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: `✅ Approve ₹${dep.amount.toFixed(0)}`, callback_data: `app_dep:${dep.reference}` },
          { text: `❌ Reject`, callback_data: `rej_dep:${dep.reference}` },
        ],
        [
          { text: `🔍 Check /tx ${dep.reference}`, callback_data: `tx:${dep.reference}` },
        ],
      ],
    };

    await this.sendMessage(this.adminChatId, text, keyboard);
  }

  public async notifyAdminDepositApproved(dep: DepositRequest) {
    if (!this.adminChatId) return;
    const text =
      `✅ <b>DEPOSIT APPROVED</b>\n\n` +
      `• Reference: <code>${dep.reference}</code>\n` +
      `• User: <b>${dep.username}</b>\n` +
      `• Amount: <b>₹${dep.amount.toFixed(2)}</b>\n` +
      `• UTR: <code>${dep.userUtrReference || 'N/A'}</code>\n` +
      `• Approved By: <i>${dep.verifiedByAdminUsername || 'Admin'}</i>\n` +
      `• Status: <b>CREDITED TO AUTHORITATIVE LEDGER</b>`;

    await this.sendMessage(this.adminChatId, text);
  }

  public async notifyAdminDepositRejected(dep: DepositRequest, reason: string) {
    if (!this.adminChatId) return;
    const text =
      `❌ <b>DEPOSIT REJECTED</b>\n\n` +
      `• Reference: <code>${dep.reference}</code>\n` +
      `• User: <b>${dep.username}</b>\n` +
      `• Amount: ₹${dep.amount.toFixed(2)}\n` +
      `• Reason: <i>${reason}</i>`;

    await this.sendMessage(this.adminChatId, text);
  }

  public async notifyAdminNewWithdrawal(wth: WithdrawalRequest) {
    if (!this.adminChatId) return;
    const text =
      `📤 <b>NEW WITHDRAWAL REQUEST</b>\n\n` +
      `• Reference: <code>${wth.reference}</code>\n` +
      `• User: <b>${wth.username}</b>\n` +
      `• Amount: <b>₹${wth.amount.toFixed(2)}</b> (Reserved)\n` +
      `• Method: <b>${wth.payoutMethod}</b>\n` +
      `• Payout Target: <code>${wth.payoutTarget}</code>\n\n` +
      `<i>Tap below to mark paid or reject & refund manually:</i>`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: `✅ Mark Paid ₹${wth.amount.toFixed(0)}`, callback_data: `app_wth:${wth.reference}` },
          { text: `❌ Reject & Refund`, callback_data: `rej_wth:${wth.reference}` },
        ],
        [
          { text: `🔍 Check /tx ${wth.reference}`, callback_data: `tx:${wth.reference}` },
        ],
      ],
    };

    await this.sendMessage(this.adminChatId, text, keyboard);
  }

  public async notifyAdminWithdrawalCompleted(wth: WithdrawalRequest) {
    if (!this.adminChatId) return;
    const text =
      `✅ <b>WITHDRAWAL MARKED PAID</b>\n\n` +
      `• Reference: <code>${wth.reference}</code>\n` +
      `• User: <b>${wth.username}</b>\n` +
      `• Amount: <b>₹${wth.amount.toFixed(2)}</b>\n` +
      `• Payout UTR: <code>${wth.payoutReference || 'N/A'}</code>\n` +
      `• Processed By: <i>${wth.processedByAdminUsername || 'Admin'}</i>`;

    await this.sendMessage(this.adminChatId, text);
  }

  public async notifyAdminWithdrawalRejected(wth: WithdrawalRequest, reason: string) {
    if (!this.adminChatId) return;
    const text =
      `🔄 <b>WITHDRAWAL REJECTED & REFUNDED</b>\n\n` +
      `• Reference: <code>${wth.reference}</code>\n` +
      `• User: <b>${wth.username}</b>\n` +
      `• Amount: <b>₹${wth.amount.toFixed(2)}</b> (Refunded to balance)\n` +
      `• Reason: <i>${reason}</i>`;

    await this.sendMessage(this.adminChatId, text);
  }

  public async notifyAdminSystemError(errorDetails: string) {
    if (!this.adminChatId) return;
    const text = `⚠️ <b>SYSTEM OPERATIONAL ERROR</b>\n\n<code>${errorDetails.slice(0, 500)}</code>`;
    await this.sendMessage(this.adminChatId, text);
  }

  // ----------------------------------------------------------------------
  // TELEGRAM UPDATE HANDLER
  // ----------------------------------------------------------------------

  public async handleUpdate(update: TelegramUpdate) {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const msg = update.message;
    if (!msg || !msg.text) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const telegramUserId = msg.from?.id;
    const telegramUsername = msg.from?.username || msg.from?.first_name || 'Pilot';

    const [cmd, ...args] = text.split(/\s+/);
    const command = cmd.toLowerCase().split('@')[0];

    // Authorization strictly based on Telegram User ID or Admin Chat ID
    const isAuthorizedAdmin =
      (telegramUserId && this.adminIds.has(telegramUserId)) ||
      (chatId && this.adminChatId === chatId) ||
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

      case '/deposit': {
        const upi = db.getConfig().upiReceiverId || 'princesuhani@fam';
        const depInfo =
          `💳 <b>OFFICIAL UPI DEPOSIT INSTRUCTIONS</b>\n\n` +
          `1. Send payment via any UPI app (GPay, PhonePe, Paytm, BHIM) to:\n` +
          `👉 UPI ID: <code>${upi}</code>\n\n` +
          `2. Note down your <b>12-digit UPI UTR / Transaction Reference number</b>.\n\n` +
          `3. Go to the Aviator Pro website, open the <b>Wallet</b> modal, enter the amount and submit your 12-digit UTR.\n\n` +
          `4. Your balance will be verified and credited to your account!`;
        await this.sendMessage(chatId, depInfo);
        break;
      }

      case '/withdraw': {
        const minWth = db.getConfig().minWithdrawalAmount || 200;
        const wthInfo =
          `💸 <b>WITHDRAWAL PROCEDURE</b>\n\n` +
          `• Minimum withdrawal: <b>₹${minWth.toFixed(2)}</b>\n` +
          `• Method: UPI or Direct Bank IMPS/NEFT\n\n` +
          `To request a withdrawal, log into the Aviator Pro website, open the <b>Wallet</b> modal, select <b>Withdraw</b>, and enter your destination UPI ID or bank account number.\n\n` +
          `Funds are reserved immediately and paid directly to your account.`;
        await this.sendMessage(chatId, wthInfo);
        break;
      }

      case '/admin':
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ <b>Access Denied:</b> This command is restricted to authorized administrators.');
          return;
        }
        await this.handleAdminMenu(chatId);
        break;

      // ----------------------------------------------------------------
      // ADMINISTRATIVE COMMANDS
      // ----------------------------------------------------------------

      case '/deposits': {
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const pending = db.getDeposits(20).filter((d) => d.status === 'PENDING_VERIFICATION');
        if (pending.length === 0) {
          await this.sendMessage(chatId, '🟢 <b>No pending deposit requests.</b> All payments are verified.');
          return;
        }
        await this.sendMessage(chatId, `📋 <b>PENDING DEPOSIT REQUESTS (${pending.length})</b>\nReviewing awaiting submissions:`);
        for (const d of pending) {
          const itemText =
            `📥 <b>Deposit:</b> <code>${d.reference}</code>\n` +
            `• User: <b>${d.username}</b>\n` +
            `• Amount: <b>₹${d.amount.toFixed(2)}</b>\n` +
            `• User UTR: <code>${d.userUtrReference || 'Awaiting UTR submission'}</code>\n` +
            `• Created: <code>${new Date(d.createdAt).toLocaleTimeString()}</code>`;
          const keyboard = {
            inline_keyboard: [
              [
                { text: `✅ Approve ₹${d.amount.toFixed(0)}`, callback_data: `app_dep:${d.reference}` },
                { text: `❌ Reject`, callback_data: `rej_dep:${d.reference}` },
              ],
            ],
          };
          await this.sendMessage(chatId, itemText, keyboard);
        }
        break;
      }

      case '/approvedep': {
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const ref = args[0]?.trim();
        if (!ref) {
          await this.sendMessage(chatId, 'Usage: <code>/approvedep &lt;REFERENCE&gt;</code>');
          return;
        }
        const dep = db.getDepositByReference(ref);
        if (!dep) {
          await this.sendMessage(chatId, `❌ Deposit reference <code>${ref}</code> not found.`);
          return;
        }
        const result = await db.approveDeposit(
          dep.id,
          `tg_${telegramUserId}`,
          telegramUsername,
          'Approved via Telegram command'
        );
        if (result.success && result.deposit) {
          await this.sendMessage(
            chatId,
            `✅ <b>Deposit Approved!</b>\nRef: <code>${result.deposit.reference}</code>\nUser: <b>${result.deposit.username}</b>\nCredited: <b>₹${result.deposit.amount.toFixed(2)}</b>\nNew Balance: <b>₹${result.newBalance?.toFixed(2)}</b>`
          );
        } else {
          await this.sendMessage(chatId, `❌ Approval failed: ${result.error}`);
        }
        break;
      }

      case '/rejectdep': {
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const ref = args[0]?.trim();
        const reason = args.slice(1).join(' ').trim() || 'Payment verification failed';
        if (!ref) {
          await this.sendMessage(chatId, 'Usage: <code>/rejectdep &lt;REFERENCE&gt; &lt;reason&gt;</code>');
          return;
        }
        const dep = db.getDepositByReference(ref);
        if (!dep) {
          await this.sendMessage(chatId, `❌ Deposit reference <code>${ref}</code> not found.`);
          return;
        }
        const result = db.rejectDeposit(dep.id, `tg_${telegramUserId}`, telegramUsername, reason);
        if (result.success && result.deposit) {
          await this.sendMessage(
            chatId,
            `❌ <b>Deposit Rejected</b>\nRef: <code>${result.deposit.reference}</code>\nUser: <b>${result.deposit.username}</b>\nReason: <i>${reason}</i>`
          );
        } else {
          await this.sendMessage(chatId, `❌ Rejection failed: ${result.error}`);
        }
        break;
      }

      case '/withdrawals': {
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const pending = db.getWithdrawals(20).filter((w) => w.status === 'PENDING_REVIEW');
        if (pending.length === 0) {
          await this.sendMessage(chatId, '🟢 <b>No pending withdrawal requests.</b>');
          return;
        }
        await this.sendMessage(chatId, `📋 <b>PENDING WITHDRAWAL REQUESTS (${pending.length})</b>\nReviewing awaiting payouts:`);
        for (const w of pending) {
          const itemText =
            `📤 <b>Withdrawal:</b> <code>${w.reference}</code>\n` +
            `• User: <b>${w.username}</b>\n` +
            `• Amount: <b>₹${w.amount.toFixed(2)}</b> (Reserved)\n` +
            `• Target (${w.payoutMethod}): <code>${w.payoutTarget}</code>\n` +
            `• Created: <code>${new Date(w.createdAt).toLocaleTimeString()}</code>`;
          const keyboard = {
            inline_keyboard: [
              [
                { text: `✅ Mark Paid ₹${w.amount.toFixed(0)}`, callback_data: `app_wth:${w.reference}` },
                { text: `❌ Reject & Refund`, callback_data: `rej_wth:${w.reference}` },
              ],
            ],
          };
          await this.sendMessage(chatId, itemText, keyboard);
        }
        break;
      }

      case '/approvewth': {
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const ref = args[0]?.trim();
        const payoutUtr = args.slice(1).join(' ').trim();
        if (!ref || !payoutUtr) {
          await this.sendMessage(chatId, 'Usage: <code>/approvewth &lt;REFERENCE&gt; &lt;payout_UTR&gt;</code>');
          return;
        }
        const wth = db.getWithdrawalByReference(ref);
        if (!wth) {
          await this.sendMessage(chatId, `❌ Withdrawal reference <code>${ref}</code> not found.`);
          return;
        }
        const result = await db.completeWithdrawal(wth.id, `tg_${telegramUserId}`, telegramUsername, payoutUtr);
        if (result.success && result.withdrawal) {
          await this.sendMessage(
            chatId,
            `✅ <b>Withdrawal Completed!</b>\nRef: <code>${result.withdrawal.reference}</code>\nUser: <b>${result.withdrawal.username}</b>\nAmount: <b>₹${result.withdrawal.amount.toFixed(2)}</b>\nPayout UTR: <code>${payoutUtr}</code>`
          );
        } else {
          await this.sendMessage(chatId, `❌ Could not complete withdrawal: ${result.error}`);
        }
        break;
      }

      case '/rejectwth': {
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const ref = args[0]?.trim();
        const reason = args.slice(1).join(' ').trim() || 'Declined by Administrator';
        if (!ref) {
          await this.sendMessage(chatId, 'Usage: <code>/rejectwth &lt;REFERENCE&gt; &lt;reason&gt;</code>');
          return;
        }
        const wth = db.getWithdrawalByReference(ref);
        if (!wth) {
          await this.sendMessage(chatId, `❌ Withdrawal reference <code>${ref}</code> not found.`);
          return;
        }
        const result = await db.rejectWithdrawal(wth.id, `tg_${telegramUserId}`, telegramUsername, reason);
        if (result.success && result.withdrawal) {
          await this.sendMessage(
            chatId,
            `🔄 <b>Withdrawal Rejected & Refunded</b>\nRef: <code>${result.withdrawal.reference}</code>\nUser: <b>${result.withdrawal.username}</b>\nRefunded Amount: <b>₹${result.withdrawal.amount.toFixed(2)}</b>\nNew User Balance: <b>₹${result.newBalance?.toFixed(2)}</b>\nReason: <i>${reason}</i>`
          );
        } else {
          await this.sendMessage(chatId, `❌ Rejection failed: ${result.error}`);
        }
        break;
      }

      case '/tx': {
        if (!isAuthorizedAdmin) {
          await this.sendMessage(chatId, '⛔ Unauthorized.');
          return;
        }
        const query = args[0]?.trim();
        if (!query) {
          await this.sendMessage(chatId, 'Usage: <code>/tx &lt;REFERENCE_OR_ID&gt;</code>');
          return;
        }
        const dep = db.getDepositByReference(query);
        if (dep) {
          await this.sendMessage(
            chatId,
            `🔍 <b>DEPOSIT RECORD FOUND</b>\n\n` +
            `• Reference: <code>${dep.reference}</code>\n` +
            `• User: <b>${dep.username}</b>\n` +
            `• Amount: <b>₹${dep.amount.toFixed(2)}</b>\n` +
            `• Status: <b>${dep.status}</b>\n` +
            `• Submitted UTR: <code>${dep.userUtrReference || 'None'}</code>\n` +
            `• Created At: <code>${dep.createdAt}</code>`
          );
          return;
        }

        const wth = db.getWithdrawalByReference(query);
        if (wth) {
          await this.sendMessage(
            chatId,
            `🔍 <b>WITHDRAWAL RECORD FOUND</b>\n\n` +
            `• Reference: <code>${wth.reference}</code>\n` +
            `• User: <b>${wth.username}</b>\n` +
            `• Amount: <b>₹${wth.amount.toFixed(2)}</b>\n` +
            `• Status: <b>${wth.status}</b>\n` +
            `• Payout Target: <code>${wth.payoutTarget}</code>\n` +
            `• Payout Ref: <code>${wth.payoutReference || 'None'}</code>\n` +
            `• Created At: <code>${wth.createdAt}</code>`
          );
          return;
        }

        await this.sendMessage(chatId, `❌ No deposit or withdrawal found with reference <code>${query}</code>.`);
        break;
      }

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
          `• Total Registered Users: <code>${stats.totalUsers}</code>\n` +
          `• Active Accounts: <code>${stats.activeUsers}</code>\n` +
          `• Pending Deposits: <b>${stats.pendingDepositsCount}</b>\n` +
          `• Pending Withdrawals: <b>${stats.pendingWithdrawalsCount}</b>\n` +
          `• Total Approved Deposits: <b>₹${stats.totalDeposited.toLocaleString()}</b>\n` +
          `• Total Completed Withdrawals: <b>₹${stats.totalWithdrawn.toLocaleString()}</b>\n` +
          `• Completed Rounds: <code>${stats.totalRounds}</code>\n` +
          `• Memory Heap: <code>${mem} MB</code>\n` +
          `• Active WS Clients: <code>${gameEngine.getConnectedClientsCount()}</code>`
        );
        break;

      default:
        await this.sendMessage(
          chatId,
          `Unrecognized command <code>${command}</code>. Send /help for available commands.`
        );
        break;
    }
  }

  private async handleStart(chatId: number, name: string) {
    const welcome =
      `✈️ <b>Welcome to Aviator Pro, ${name}!</b>\n\n` +
      `Aviator Pro is a backend-authoritative crash game with real-time multiplier curves, provably fair SHA-256 verification, and transparent 2.00x limit rules.\n\n` +
      `<b>Available Commands:</b>\n` +
      `• /deposit - Official UPI payment instructions\n` +
      `• /withdraw - Payout & withdrawal procedure\n` +
      `• /status - Check live engine & round state\n` +
      `• /round - Current active round & multiplier\n` +
      `• /history - Last 10 crash multipliers\n` +
      `• /rules - Documented game rules & 2.00x cap\n` +
      `• /support - Customer support contact\n\n` +
      `Click the button below to launch the website!`;

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
      `• <code>/deposit</code> - Official UPI payment instructions\n` +
      `• <code>/withdraw</code> - Payout & withdrawal procedure\n` +
      `• <code>/status</code> - Engine health & round status\n` +
      `• <code>/round</code> - Current round details & multiplier\n` +
      `• <code>/history</code> - Last 10 round crash multipliers\n` +
      `• <code>/rules</code> - Documented rules and max multiplier\n` +
      `• <code>/support</code> - Customer support channels\n`;

    if (isAdmin) {
      help +=
        `\n👑 <b>Administrator Financial & Control Commands:</b>\n` +
        `• <code>/deposits</code> - View pending UPI deposit requests\n` +
        `• <code>/approvedep &lt;ref&gt;</code> - Approve deposit & credit ledger\n` +
        `• <code>/rejectdep &lt;ref&gt; &lt;reason&gt;</code> - Reject deposit\n` +
        `• <code>/withdrawals</code> - View pending withdrawal requests\n` +
        `• <code>/approvewth &lt;ref&gt; &lt;UTR&gt;</code> - Mark withdrawal paid\n` +
        `• <code>/rejectwth &lt;ref&gt; &lt;reason&gt;</code> - Reject withdrawal & refund\n` +
        `• <code>/tx &lt;ref&gt;</code> - Inspect transaction details\n` +
        `• <code>/systemstatus</code> - Live ledger & memory metrics\n` +
        `• <code>/pausegame</code> - Pause new rounds\n` +
        `• <code>/resumegame</code> - Resume game loop\n` +
        `• <code>/maintenance</code> - Toggle maintenance mode\n`;
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
      `2. <b>Transparent Multiplier Cap:</b> The maximum permitted multiplier is configured to <b>${config.maxMultiplier.toFixed(2)}x</b>.\n` +
      `3. <b>Provably Fair:</b> Each round generates a cryptographically random SHA-256 seed hash before takeoff.\n` +
      `4. <b>Cash Out Rule:</b> Secure your multiplier before the plane flies away.\n` +
      `5. <b>Payment Integrity:</b> Real account ledger with strict deposit verification and withdrawal reservations.`;

    await this.sendMessage(chatId, text);
  }

  private async handleSupport(chatId: number) {
    const contact = process.env.SUPPORT_CONTACT || 'support@aviatorpro.local';
    const text =
      `💬 <b>Aviator Pro Customer Support</b>\n\n` +
      `For help, inquiries, or payment assistance:\n` +
      `• Email: <code>${contact}</code>\n` +
      `• Official Telegram Bot: ${this.botUsername}\n` +
      `• Web: Open the in-game Support/Rules panel.`;

    await this.sendMessage(chatId, text);
  }

  private async handleAdminMenu(chatId: number) {
    const stats = db.getOverviewStats();
    const text =
      `👑 <b>Administrator Control Panel</b>\n\n` +
      `• Pending Deposits: <b>${stats.pendingDepositsCount}</b> (/deposits)\n` +
      `• Pending Withdrawals: <b>${stats.pendingWithdrawalsCount}</b> (/withdrawals)\n` +
      `• System Status: /systemstatus\n\n` +
      `<b>Quick Commands:</b>\n` +
      `• <code>/deposits</code> - Review pending deposit requests\n` +
      `• <code>/withdrawals</code> - Review pending withdrawal requests\n` +
      `• <code>/approvedep &lt;ref&gt;</code> - Credit verified deposit\n` +
      `• <code>/approvewth &lt;ref&gt; &lt;UTR&gt;</code> - Mark withdrawal paid\n` +
      `• <code>/pausegame</code> | <code>/resumegame</code>`;

    await this.sendMessage(chatId, text);
  }

  private async handleCallbackQuery(cq: NonNullable<TelegramUpdate['callback_query']>) {
    const data = cq.data || '';
    const userId = cq.from.id;
    const username = cq.from.username || cq.from.first_name || 'Admin';
    const message = cq.message;
    const chatId = message?.chat.id;
    const messageId = message?.message_id;

    // Public interactive buttons
    if (data === 'rules') {
      await this.answerCallbackQuery(cq.id);
      if (chatId) await this.handleRules(chatId);
      return;
    }
    if (data === 'status') {
      await this.answerCallbackQuery(cq.id);
      if (chatId) await this.handleStatus(chatId);
      return;
    }
    if (data === 'support') {
      await this.answerCallbackQuery(cq.id);
      if (chatId) await this.handleSupport(chatId);
      return;
    }

    // Verify admin identity
    const isAuthorizedAdmin =
      (userId && this.adminIds.has(userId)) ||
      (chatId && this.adminChatId === chatId) ||
      (userId && db.getTelegramLink(userId.toString())?.isAdmin);

    if (!isAuthorizedAdmin) {
      await this.answerCallbackQuery(cq.id, '⛔ Unauthorized: Restricted to Bot Administrator.', true);
      return;
    }

    // 1. Manual Deposit Approval via Bot
    if (data.startsWith('app_dep:')) {
      const ref = data.replace('app_dep:', '').trim();
      const dep = db.getDepositByReference(ref);
      if (!dep) {
        await this.answerCallbackQuery(cq.id, `❌ Deposit ${ref} not found.`, true);
        return;
      }
      if (dep.status === 'APPROVED') {
        await this.answerCallbackQuery(cq.id, '⚠️ Already approved and credited.', true);
        return;
      }

      const res = await db.approveDeposit(
        dep.id,
        `tg_${userId}`,
        username,
        'Manually Approved via Telegram Bot Button'
      );

      if (res.success && res.deposit) {
        await this.answerCallbackQuery(cq.id, `✅ Approved ₹${res.deposit.amount}!`, false);
        if (chatId && messageId) {
          const updatedText =
            `✅ <b>DEPOSIT MANUALLY APPROVED & CREDITED</b>\n\n` +
            `• Reference: <code>${res.deposit.reference}</code>\n` +
            `• User: <b>${res.deposit.username}</b>\n` +
            `• Amount: <b>₹${res.deposit.amount.toFixed(2)}</b>\n` +
            `• User UTR: <code>${res.deposit.userUtrReference || 'N/A'}</code>\n` +
            `• User Balance: <b>₹${res.newBalance?.toFixed(2)}</b>\n` +
            `• Approved By: <b>@${username}</b> (Telegram Bot)\n` +
            `• Status: <b>CREDITED TO AUTHORITATIVE LEDGER</b>`;
          await this.editMessageText(chatId, messageId, updatedText);
        }
      } else {
        await this.answerCallbackQuery(cq.id, `❌ Failed: ${res.error}`, true);
      }
      return;
    }

    // 2. Manual Deposit Rejection via Bot
    if (data.startsWith('rej_dep:')) {
      const ref = data.replace('rej_dep:', '').trim();
      const dep = db.getDepositByReference(ref);
      if (!dep) {
        await this.answerCallbackQuery(cq.id, `❌ Deposit ${ref} not found.`, true);
        return;
      }
      if (dep.status !== 'PENDING_VERIFICATION') {
        await this.answerCallbackQuery(cq.id, `⚠️ Deposit is already ${dep.status}.`, true);
        return;
      }

      const res = db.rejectDeposit(
        dep.id,
        `tg_${userId}`,
        username,
        'Payment not received / UTR mismatch in UPI account'
      );

      if (res.success && res.deposit) {
        await this.answerCallbackQuery(cq.id, '❌ Deposit rejected.', false);
        if (chatId && messageId) {
          const updatedText =
            `❌ <b>DEPOSIT MANUALLY REJECTED</b>\n\n` +
            `• Reference: <code>${res.deposit.reference}</code>\n` +
            `• User: <b>${res.deposit.username}</b>\n` +
            `• Amount: ₹${res.deposit.amount.toFixed(2)}\n` +
            `• Actioned By: <b>@${username}</b> (Telegram Bot)\n` +
            `• Reason: <i>Payment not received in UPI account</i>\n` +
            `• Status: <b>REJECTED</b>`;
          await this.editMessageText(chatId, messageId, updatedText);
        }
      } else {
        await this.answerCallbackQuery(cq.id, `❌ Failed: ${res.error}`, true);
      }
      return;
    }

    // 3. Manual Withdrawal Completion (Mark Paid) via Bot
    if (data.startsWith('app_wth:')) {
      const ref = data.replace('app_wth:', '').trim();
      const wth = db.getWithdrawalByReference(ref);
      if (!wth) {
        await this.answerCallbackQuery(cq.id, `❌ Withdrawal ${ref} not found.`, true);
        return;
      }
      if (wth.status === 'COMPLETED') {
        await this.answerCallbackQuery(cq.id, '⚠️ Already completed.', true);
        return;
      }

      const payoutRef = `UPI_MANUAL_${Date.now().toString().slice(-6)}`;
      const res = await db.completeWithdrawal(wth.id, `tg_${userId}`, username, payoutRef);

      if (res.success && res.withdrawal) {
        await this.answerCallbackQuery(cq.id, `✅ Withdrawal marked paid!`, false);
        if (chatId && messageId) {
          const updatedText =
            `✅ <b>WITHDRAWAL MANUALLY PAID OUT</b>\n\n` +
            `• Reference: <code>${res.withdrawal.reference}</code>\n` +
            `• User: <b>${res.withdrawal.username}</b>\n` +
            `• Amount: <b>₹${res.withdrawal.amount.toFixed(2)}</b>\n` +
            `• Method / Target: <b>${res.withdrawal.payoutMethod}</b> ➔ <code>${res.withdrawal.payoutTarget}</code>\n` +
            `• Processed By: <b>@${username}</b> (Telegram Bot)\n` +
            `• Payout Reference: <code>${payoutRef}</code>\n` +
            `• Status: <b>PAYOUT COMPLETED</b>`;
          await this.editMessageText(chatId, messageId, updatedText);
        }
      } else {
        await this.answerCallbackQuery(cq.id, `❌ Failed: ${res.error}`, true);
      }
      return;
    }

    // 4. Manual Withdrawal Rejection & Atomic Refund via Bot
    if (data.startsWith('rej_wth:')) {
      const ref = data.replace('rej_wth:', '').trim();
      const wth = db.getWithdrawalByReference(ref);
      if (!wth) {
        await this.answerCallbackQuery(cq.id, `❌ Withdrawal ${ref} not found.`, true);
        return;
      }
      if (wth.status !== 'PENDING_REVIEW') {
        await this.answerCallbackQuery(cq.id, `⚠️ Withdrawal is already ${wth.status}.`, true);
        return;
      }

      const res = await db.rejectWithdrawal(
        wth.id,
        `tg_${userId}`,
        username,
        'Declined by Administrator via Telegram'
      );

      if (res.success && res.withdrawal) {
        await this.answerCallbackQuery(cq.id, `🔄 Withdrawal rejected & refunded!`, false);
        if (chatId && messageId) {
          const updatedText =
            `🔄 <b>WITHDRAWAL REJECTED & REFUNDED</b>\n\n` +
            `• Reference: <code>${res.withdrawal.reference}</code>\n` +
            `• User: <b>${res.withdrawal.username}</b>\n` +
            `• Refunded Amount: <b>₹${res.withdrawal.amount.toFixed(2)}</b>\n` +
            `• User Balance Restored: <b>₹${res.newBalance?.toFixed(2)}</b>\n` +
            `• Actioned By: <b>@${username}</b> (Telegram Bot)\n` +
            `• Reason: <i>Declined by Administrator</i>\n` +
            `• Status: <b>REFUNDED TO USER LEDGER</b>`;
          await this.editMessageText(chatId, messageId, updatedText);
        }
      } else {
        await this.answerCallbackQuery(cq.id, `❌ Failed: ${res.error}`, true);
      }
      return;
    }

    // 5. Transaction details popup
    if (data.startsWith('tx:')) {
      const ref = data.replace('tx:', '').trim();
      const dep = db.getDepositByReference(ref);
      if (dep) {
        await this.answerCallbackQuery(
          cq.id,
          `Deposit: ${dep.reference}\nUser: ${dep.username}\nAmount: ₹${dep.amount}\nStatus: ${dep.status}`,
          true
        );
        return;
      }
      const wth = db.getWithdrawalByReference(ref);
      if (wth) {
        await this.answerCallbackQuery(
          cq.id,
          `Withdrawal: ${wth.reference}\nUser: ${wth.username}\nAmount: ₹${wth.amount}\nStatus: ${wth.status}`,
          true
        );
        return;
      }
      await this.answerCallbackQuery(cq.id, `Transaction ${ref} not found.`, true);
      return;
    }

    await this.answerCallbackQuery(cq.id);
  }
}

export const telegramBot = new TelegramBotService();
