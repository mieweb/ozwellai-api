-- Ozwell Auth Database Schema (PoC — plaintext keys, no users)
-- Only two key types: parent keys (ozw_) and agent keys (agnt_key-)
-- Agent keys ARE the scoped keys — scoping happens in the agents table.

-- Parent API Keys (ozw_ prefix)
-- Stored in plaintext for PoC. Production should hash these.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
