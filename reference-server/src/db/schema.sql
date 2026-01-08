-- Ozwell API Keys Database Schema
-- SQLite version for local PoC

-- Users table (for dashboard access)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL CHECK (key_prefix IN ('ozw_', 'ozw_scoped_')),
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('general', 'scoped')),
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT,
  rate_limit INTEGER DEFAULT 100
);

-- Scoped permissions (only for scoped keys)
CREATE TABLE IF NOT EXISTS scoped_permissions (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL UNIQUE REFERENCES api_keys(id) ON DELETE CASCADE,
  allowed_agents TEXT DEFAULT '[]',   -- JSON array
  allowed_tools TEXT DEFAULT '[]',    -- JSON array
  allowed_models TEXT DEFAULT '[]',   -- JSON array
  allowed_domains TEXT DEFAULT '[]'   -- JSON array
);

-- Rate limiting tracking (simple in-memory alternative would be fine for PoC)
CREATE TABLE IF NOT EXISTS rate_limit_entries (
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start TEXT NOT NULL,
  request_count INTEGER DEFAULT 1,
  PRIMARY KEY (api_key_id, window_start)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked ON api_keys(revoked_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
