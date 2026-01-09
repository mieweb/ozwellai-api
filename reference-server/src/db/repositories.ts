/**
 * Database Repositories
 *
 * Data access layer for users, API keys, and scoped permissions.
 */

import db from './database';
import {
  User,
  ApiKey,
  ApiKeyWithPermissions,
  ApiKeyType,
  ApiKeyPrefix,
  ApiKeyListItem,
} from './types';
import {
  generateId,
  generateApiKey,
  hashApiKey,
  getKeyHint,
  hashPassword,
  verifyPassword,
} from '../auth/crypto';

// ============================================
// USER REPOSITORY
// ============================================

export const userRepository = {
  /**
   * Create a new user
   */
  create(email: string, password: string): User {
    const id = generateId();
    const password_hash = hashPassword(password);
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, email.toLowerCase(), password_hash, now, now);

    return {
      id,
      email: email.toLowerCase(),
      password_hash,
      created_at: now,
      updated_at: now,
    };
  },

  /**
   * Find user by email
   */
  findByEmail(email: string): User | null {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    const row = stmt.get(email.toLowerCase()) as User | undefined;
    return row || null;
  },

  /**
   * Find user by ID
   */
  findById(id: string): User | null {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const row = stmt.get(id) as User | undefined;
    return row || null;
  },

  /**
   * Verify user credentials
   */
  verifyCredentials(email: string, password: string): User | null {
    const user = this.findByEmail(email);
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash)) return null;
    return user;
  },
};

// ============================================
// API KEY REPOSITORY
// ============================================

export const apiKeyRepository = {
  /**
   * Create a new API key
   * Returns the full key (only time it's available!)
   */
  create(
    userId: string,
    name: string,
    type: ApiKeyType,
    permissions?: {
      allowed_agents?: string[];
      allowed_tools?: string[];
      allowed_models?: string[];
      allowed_domains?: string[];
    },
    rateLimit: number = 100
  ): { apiKey: ApiKey; fullKey: string } {
    const id = generateId();
    const fullKey = generateApiKey(type);
    const keyHash = hashApiKey(fullKey);
    const keyHint = getKeyHint(fullKey);
    const keyPrefix: ApiKeyPrefix = type === 'general' ? 'ozw_' : 'ozw_scoped_';
    const now = new Date().toISOString();

    // Insert API key
    const keyStmt = db.prepare(`
      INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, key_hint, type, created_at, rate_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    keyStmt.run(id, userId, name, keyPrefix, keyHash, keyHint, type, now, rateLimit);

    // If scoped, insert permissions
    if (type === 'scoped') {
      const permId = generateId();
      const permStmt = db.prepare(`
        INSERT INTO scoped_permissions (id, api_key_id, allowed_agents, allowed_tools, allowed_models, allowed_domains)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      permStmt.run(
        permId,
        id,
        JSON.stringify(permissions?.allowed_agents || []),
        JSON.stringify(permissions?.allowed_tools || []),
        JSON.stringify(permissions?.allowed_models || []),
        JSON.stringify(permissions?.allowed_domains || [])
      );
    }

    const apiKey: ApiKey = {
      id,
      user_id: userId,
      name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      key_hint: keyHint,
      type,
      created_at: now,
      last_used_at: null,
      revoked_at: null,
      rate_limit: rateLimit,
    };

    return { apiKey, fullKey };
  },

  /**
   * Find API key by hash (for validation)
   */
  findByHash(keyHash: string): ApiKeyWithPermissions | null {
    const stmt = db.prepare(`
      SELECT ak.*, sp.id as perm_id, sp.allowed_agents, sp.allowed_tools, sp.allowed_models, sp.allowed_domains
      FROM api_keys ak
      LEFT JOIN scoped_permissions sp ON ak.id = sp.api_key_id
      WHERE ak.key_hash = ?
    `);
    const row = stmt.get(keyHash) as any;
    if (!row) return null;

    const apiKey: ApiKeyWithPermissions = {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      key_prefix: row.key_prefix,
      key_hash: row.key_hash,
      key_hint: row.key_hint,
      type: row.type,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at,
      rate_limit: row.rate_limit,
    };

    if (row.perm_id) {
      apiKey.permissions = {
        id: row.perm_id,
        api_key_id: row.id,
        allowed_agents: JSON.parse(row.allowed_agents || '[]'),
        allowed_tools: JSON.parse(row.allowed_tools || '[]'),
        allowed_models: JSON.parse(row.allowed_models || '[]'),
        allowed_domains: JSON.parse(row.allowed_domains || '[]'),
      };
    }

    return apiKey;
  },

  /**
   * Find API key by full key string
   */
  findByKey(fullKey: string): ApiKeyWithPermissions | null {
    const keyHash = hashApiKey(fullKey);
    return this.findByHash(keyHash);
  },

  /**
   * List all API keys for a user
   */
  listByUserId(userId: string): ApiKeyListItem[] {
    const stmt = db.prepare(`
      SELECT ak.*, sp.allowed_agents, sp.allowed_tools, sp.allowed_models, sp.allowed_domains
      FROM api_keys ak
      LEFT JOIN scoped_permissions sp ON ak.id = sp.api_key_id
      WHERE ak.user_id = ?
      ORDER BY ak.created_at DESC
    `);
    const rows = stmt.all(userId) as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      key_prefix: row.key_prefix,
      key_hint: row.key_hint,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at,
      rate_limit: row.rate_limit,
      permissions: row.allowed_agents
        ? {
            allowed_agents: JSON.parse(row.allowed_agents || '[]'),
            allowed_tools: JSON.parse(row.allowed_tools || '[]'),
            allowed_models: JSON.parse(row.allowed_models || '[]'),
            allowed_domains: JSON.parse(row.allowed_domains || '[]'),
          }
        : undefined,
    }));
  },

  /**
   * Revoke an API key
   */
  revoke(id: string, userId: string): boolean {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE api_keys SET revoked_at = ?
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL
    `);
    const result = stmt.run(now, id, userId);
    return result.changes > 0;
  },

  /**
   * Update last_used_at timestamp
   */
  updateLastUsed(id: string): void {
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?');
    stmt.run(now, id);
  },

  /**
   * Update scoped permissions
   */
  updatePermissions(
    id: string,
    userId: string,
    permissions: {
      allowed_agents?: string[];
      allowed_tools?: string[];
      allowed_models?: string[];
      allowed_domains?: string[];
    }
  ): boolean {
    // Verify ownership and type
    const keyStmt = db.prepare('SELECT type FROM api_keys WHERE id = ? AND user_id = ?');
    const key = keyStmt.get(id, userId) as { type: string } | undefined;
    if (!key || key.type !== 'scoped') return false;

    const stmt = db.prepare(`
      UPDATE scoped_permissions
      SET allowed_agents = ?, allowed_tools = ?, allowed_models = ?, allowed_domains = ?
      WHERE api_key_id = ?
    `);
    const result = stmt.run(
      JSON.stringify(permissions.allowed_agents || []),
      JSON.stringify(permissions.allowed_tools || []),
      JSON.stringify(permissions.allowed_models || []),
      JSON.stringify(permissions.allowed_domains || []),
      id
    );
    return result.changes > 0;
  },

  /**
   * Delete an API key permanently
   */
  delete(id: string, userId: string): boolean {
    const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
    const result = stmt.run(id, userId);
    return result.changes > 0;
  },
};

// ============================================
// RATE LIMIT REPOSITORY
// ============================================

export const rateLimitRepository = {
  /**
   * Check and increment rate limit
   * Returns true if within limit, false if exceeded
   */
  checkAndIncrement(apiKeyId: string, limit: number): boolean {
    const windowStart = new Date();
    windowStart.setSeconds(0, 0); // Round to current minute
    const windowKey = windowStart.toISOString();

    // Clean old entries (older than 2 minutes)
    const cleanupStmt = db.prepare(`
      DELETE FROM rate_limit_entries
      WHERE window_start < datetime('now', '-2 minutes')
    `);
    cleanupStmt.run();

    // Get current count
    const getStmt = db.prepare(`
      SELECT request_count FROM rate_limit_entries
      WHERE api_key_id = ? AND window_start = ?
    `);
    const current = getStmt.get(apiKeyId, windowKey) as { request_count: number } | undefined;

    if (current) {
      if (current.request_count >= limit) {
        return false; // Rate limit exceeded
      }
      // Increment
      const updateStmt = db.prepare(`
        UPDATE rate_limit_entries SET request_count = request_count + 1
        WHERE api_key_id = ? AND window_start = ?
      `);
      updateStmt.run(apiKeyId, windowKey);
    } else {
      // Insert new entry
      const insertStmt = db.prepare(`
        INSERT INTO rate_limit_entries (api_key_id, window_start, request_count)
        VALUES (?, ?, 1)
      `);
      insertStmt.run(apiKeyId, windowKey);
    }

    return true;
  },

  /**
   * Get remaining requests in current window
   */
  getRemaining(apiKeyId: string, limit: number): number {
    const windowStart = new Date();
    windowStart.setSeconds(0, 0);
    const windowKey = windowStart.toISOString();

    const stmt = db.prepare(`
      SELECT request_count FROM rate_limit_entries
      WHERE api_key_id = ? AND window_start = ?
    `);
    const current = stmt.get(apiKeyId, windowKey) as { request_count: number } | undefined;

    return limit - (current?.request_count || 0);
  },
};
