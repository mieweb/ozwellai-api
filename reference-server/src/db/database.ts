/**
 * SQLite Database Connection
 *
 * Initializes the database and provides the connection instance.
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'ozwell.db');
// Schema file stays in src/, use path relative to cwd (reference-server/)
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'db', 'schema.sql');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Create database connection
const db: DatabaseType = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
export function initializeDatabase(): void {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  console.log('[db] Database initialized at', DB_PATH);
}

// Demo API key for internal testing (landing page, tic-tac-toe, E2E tests)
// Locked to localhost only via scoped permissions
export const DEMO_API_KEY = 'ozw_demo_local_testing';

/**
 * Seed demo data for development/testing
 * Creates a demo user and scoped API key locked to localhost
 */
export function seedDemoData(): void {

  const demoUserId = 'demo-user';
  const demoKeyId = 'demo-key';

  // Check if demo key exists
  const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(demoKeyId);
  if (existing) {
    return;
  }

  const now = new Date().toISOString();

  // Create demo user
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(demoUserId, 'demo@localhost', 'not-a-real-password', now, now);

  // Create scoped demo API key locked to localhost
  const keyHash = crypto.createHash('sha256').update(DEMO_API_KEY).digest('hex');

  db.prepare(`
    INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, key_hint, type, created_at, rate_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(demoKeyId, demoUserId, 'Demo (localhost only)', 'ozw_', keyHash, 'ting', 'scoped', now, 1000);

  // Lock to localhost domains only
  db.prepare(`
    INSERT INTO scoped_permissions (id, api_key_id, allowed_agents, allowed_tools, allowed_models, allowed_domains)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('demo-perm', demoKeyId, '["*"]', '["*"]', '["*"]', '["localhost", "127.0.0.1"]');

  console.log('[db] Demo API key seeded (localhost only)');
}

// Export the database instance
export default db;
