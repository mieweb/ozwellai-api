/**
 * Initialize Auth Tables in Existing Database
 * 
 * Adds users and api_keys tables to the existing ozwell.db.
 * Agent keys (agnt_key-...) are managed in the agents table.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { hashApiKey, getKeyHint } from '../auth/crypto';

const DB_PATH = path.join(process.cwd(), 'data', 'ozwell.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'db', 'schema.sql');

// Demo parent API key (generated fresh on first seed)
export const DEMO_API_KEY = 'ozw_demo_localhost_key_for_testing';

/**
 * Add auth tables to existing database
 */
export function initializeAuthTables(db: Database.Database): void {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
    console.log('[auth] Auth tables initialized');
}

/**
 * Seed demo user and parent API key for testing
 */
export function seedDemoData(db: Database.Database): void {
    const demoUserId = 'demo-user';
    const demoKeyId = 'demo-key';

    // Check if demo key exists
    const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(demoKeyId);
    if (existing) {
        console.log('[auth] Demo data already exists');
        return;
    }

    const now = new Date().toISOString();

    // Create demo user
    db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(demoUserId, 'demo@localhost', 'not-a-real-password', now, now);

    // Create demo parent API key
    const keyHash = hashApiKey(DEMO_API_KEY);
    const keyHint = getKeyHint(DEMO_API_KEY);

    db.prepare(`
    INSERT INTO api_keys (id, user_id, name, key_hash, key_hint, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(demoKeyId, demoUserId, 'Demo Key', keyHash, keyHint, now);

    console.log('[auth] Demo parent API key seeded');
}

export function getDatabase(): Database.Database {
    return new Database(DB_PATH);
}
