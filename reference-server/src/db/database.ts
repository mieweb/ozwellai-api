/**
 * SQLite Database Connection
 *
 * Initializes the database and provides the connection instance.
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
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

// Export the database instance
export default db;
