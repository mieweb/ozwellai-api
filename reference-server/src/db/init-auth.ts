/**
 * Initialize Auth Tables (PoC — plaintext keys, no users)
 *
 * Adds api_keys table to the existing ozwell.db.
 * Agent keys (agnt_key-...) are managed in the agents table.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getKeyHint } from '../util';

const DB_PATH = path.join(process.cwd(), 'data', 'ozwell.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'db', 'schema.sql');

// Demo parent API key
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
 * Seed demo API key for testing
 */
export function seedDemoData(db: Database.Database): void {
    const demoKeyId = 'demo-key';

    const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(demoKeyId);
    if (existing) {
        console.log('[auth] Demo data already exists');
        return;
    }

    const now = new Date().toISOString();
    const keyHint = getKeyHint(DEMO_API_KEY);

    db.prepare(`
    INSERT INTO api_keys (id, name, key, key_hint, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(demoKeyId, 'Demo Key', DEMO_API_KEY, keyHint, now);

    console.log('[auth] Demo API key seeded');
}

let _db: Database.Database | null = null;

export function getDatabase(): Database.Database {
    if (!_db) _db = new Database(DB_PATH);
    return _db;
}
