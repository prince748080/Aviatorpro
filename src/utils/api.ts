import { User, GameConfig, Bet, GameRound, WalletLedgerEntry, AuditLogEntry } from '../types/index.js';

class ApiService {
  private token: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('aviator_token');
    }
  }

  public setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('aviator_token', token);
      } else {
        localStorage.removeItem('aviator_token');
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(endpoint, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    return data;
  }

  // Auth
  public async login(username: string, password: string): Promise<{ user: User; token: string }> {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.token);
    return data;
  }

  public async register(username: string, password: string): Promise<{ user: User; token: string }> {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.token);
    return data;
  }

  public async getMe(): Promise<{ user: User }> {
    return this.request('/api/auth/me');
  }

  public logout() {
    this.setToken(null);
  }

  // Game & Bets
  public async getStatus() {
    return this.request('/api/game/status');
  }

  public async getRound() {
    return this.request('/api/game/round');
  }

  public async getHistory(limit: number = 25): Promise<{ rounds: GameRound[] }> {
    return this.request(`/api/game/history?limit=${limit}`);
  }

  public async getConfig(): Promise<{ config: GameConfig }> {
    return this.request('/api/game/config');
  }

  public async placeBet(
    amount: number,
    autoCashoutMultiplier: number | null,
    idempotencyKey?: string
  ): Promise<{ message: string; bet: Bet; newBalance: number }> {
    return this.request('/api/game/bet', {
      method: 'POST',
      body: JSON.stringify({ amount, autoCashoutMultiplier, idempotencyKey }),
    });
  }

  public async cancelBet(betId: string): Promise<{ message: string; newBalance: number }> {
    return this.request('/api/game/cancel-bet', {
      method: 'POST',
      body: JSON.stringify({ betId }),
    });
  }

  public async cashout(
    betId: string,
    targetMultiplier?: number
  ): Promise<{ message: string; cashedMultiplier: number; cashedAmount: number; newBalance: number }> {
    return this.request('/api/game/cashout', {
      method: 'POST',
      body: JSON.stringify({ betId, targetMultiplier }),
    });
  }

  // User
  public async getWallet(): Promise<{ balance: number; currency: string; ledger: WalletLedgerEntry[] }> {
    return this.request('/api/user/wallet');
  }

  public async reloadDemoCredits(): Promise<{ message: string; newBalance: number }> {
    return this.request('/api/user/reload-demo', { method: 'POST' });
  }

  public async getUserBets(): Promise<{ bets: Bet[] }> {
    return this.request('/api/user/bets');
  }

  // Admin
  public async getAdminOverview(): Promise<any> {
    return this.request('/api/admin/overview');
  }

  public async updateConfig(updates: Partial<GameConfig>, reason: string): Promise<{ message: string; config: GameConfig }> {
    return this.request('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify({ updates, reason }),
    });
  }

  public async pauseGame(reason: string) {
    return this.request('/api/admin/game/pause', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public async resumeGame(reason: string) {
    return this.request('/api/admin/game/resume', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public async toggleMaintenance(enabled: boolean, reason: string) {
    return this.request('/api/admin/game/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled, reason }),
    });
  }

  public async getAdminUsers(): Promise<{ users: User[] }> {
    return this.request('/api/admin/users');
  }

  public async updateUserStatus(userId: string, status: 'active' | 'suspended', reason: string) {
    return this.request(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    });
  }

  public async getAdminLedger(limit: number = 100): Promise<{ ledger: WalletLedgerEntry[] }> {
    return this.request(`/api/admin/ledger?limit=${limit}`);
  }

  public async getAdminLogs(limit: number = 100): Promise<{ logs: AuditLogEntry[] }> {
    return this.request(`/api/admin/logs?limit=${limit}`);
  }

  public async getTelegramStatus() {
    return this.request('/api/telegram/status');
  }
}

export const api = new ApiService();
