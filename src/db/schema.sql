-- ====================================================================
-- Aviator Pro - Production PostgreSQL Database Schema & Constraints
-- ====================================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin', 'support')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    balance NUMERIC(14, 2) NOT NULL DEFAULT 1000.00 CHECK (balance >= 0),
    telegram_id VARCHAR(64) UNIQUE,
    suspension_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);

-- 2. Wallets & Balance Integrity
CREATE TABLE IF NOT EXISTS wallets (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance NUMERIC(14, 2) NOT NULL DEFAULT 1000.00 CHECK (balance >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'DEMO',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Immutable Transaction Ledger
CREATE TABLE IF NOT EXISTS wallet_ledger (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount NUMERIC(14, 2) NOT NULL,
    balance_after NUMERIC(14, 2) NOT NULL CHECK (balance_after >= 0),
    type VARCHAR(30) NOT NULL CHECK (type IN ('BET', 'CASHOUT', 'DEMO_RELOAD', 'ADMIN_ADJUST', 'CANCELLED_BET')),
    reference_id VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_user_id ON wallet_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON wallet_ledger(type);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON wallet_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_idempotency ON wallet_ledger(idempotency_key);

-- 4. Authoritative Game Rounds
CREATE TABLE IF NOT EXISTS game_rounds (
    id VARCHAR(64) PRIMARY KEY,
    round_number BIGINT NOT NULL UNIQUE,
    start_time BIGINT NOT NULL,
    end_time BIGINT,
    crash_multiplier NUMERIC(6, 2) NOT NULL CHECK (crash_multiplier >= 1.00),
    server_seed VARCHAR(128) NOT NULL,
    public_hash VARCHAR(128) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('WAITING', 'RUNNING', 'CRASHED')),
    total_bets INT NOT NULL DEFAULT 0,
    total_payouts NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rounds_status ON game_rounds(status);
CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON game_rounds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_number ON game_rounds(round_number DESC);

-- 5. Game Round Events
CREATE TABLE IF NOT EXISTS round_events (
    id VARCHAR(64) PRIMARY KEY,
    round_id VARCHAR(64) NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
    event_type VARCHAR(30) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_round_id ON round_events(round_id);

-- 6. Bets Placed
CREATE TABLE IF NOT EXISTS bets (
    id VARCHAR(64) PRIMARY KEY,
    round_id VARCHAR(64) NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    username VARCHAR(50) NOT NULL,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    auto_cashout_multiplier NUMERIC(6, 2) CHECK (auto_cashout_multiplier IS NULL OR auto_cashout_multiplier >= 1.01),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PLACED', 'CASHED_OUT', 'CRASHED', 'CANCELLED')),
    cashed_multiplier NUMERIC(6, 2) CHECK (cashed_multiplier IS NULL OR cashed_multiplier >= 1.00),
    cashed_amount NUMERIC(14, 2) CHECK (cashed_amount IS NULL OR cashed_amount >= 0),
    placed_at BIGINT NOT NULL,
    cashed_at BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bets_round_id ON bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);

-- 7. Game Configuration Table
CREATE TABLE IF NOT EXISTS game_config (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by VARCHAR(64) NOT NULL,
    reason TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Immutable Admin Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    admin_id VARCHAR(64) NOT NULL,
    admin_username VARCHAR(50) NOT NULL,
    action VARCHAR(64) NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    reason TEXT NOT NULL,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_admin_id ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);

-- 9. Telegram Links
CREATE TABLE IF NOT EXISTS telegram_links (
    telegram_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id VARCHAR(64) NOT NULL,
    username VARCHAR(64) NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telegram_user_id ON telegram_links(user_id);
