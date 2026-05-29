import Database from 'better-sqlite3';
import path from 'path';
import { getKeyHint } from '../util';

interface DbAgentRow {
    id: string;
    agent_key: string;
    parent_key: string;
    yaml: string;
    created_at: number;
}

interface DbManagerUserRow {
    id: string;
    external_user_id: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    groups: string | null;
    status: string;
    is_admin: number;
    created_at: string;
    last_seen_at: string;
}

const DB_PATH = process.env.DB_PATH
    ?? path.join(process.cwd(), 'data', 'ozwell.db');

// Demo parent API key
export const DEMO_API_KEY = 'ozw_demo_localhost_key_for_testing';

// Fixed mock agent — deterministic responses for testing the API pipeline without an LLM.
export const MOCK_AGENT_ID = 'mock-agent';
export const MOCK_AGENT_KEY = 'agnt_key-mock-test';
export const MOCK_AGENT_YAML = `name: Mock Test Agent
type: mock
instructions: Deterministic mock agent for API testing. No LLM is called.
`;

// ── Database singleton ──────────────────────────────────────────────

let _db: Database.Database | null = null;

export function getDatabase(): Database.Database {
    if (!_db) _db = new Database(DB_PATH);
    return _db;
}

// ── Auth tables (api_keys) ──────────────────────────────────────────

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some(c => c.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function initializeAuthTables(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        key_hint TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        external_user_id TEXT NOT NULL UNIQUE,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        groups TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        last_seen_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_users_external_user_id ON users(external_user_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);
    ensureColumn(db, 'api_keys', 'user_id', 'TEXT');
    ensureColumn(db, 'api_keys', 'status', "TEXT DEFAULT 'active'");
    ensureColumn(db, 'api_keys', 'revoked_at', 'TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)');
    console.log('[auth] Auth tables initialized');
}

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

/**
 * Seed the fixed mock agent. Idempotent — skips if already present.
 * Anyone can use MOCK_AGENT_KEY to exercise the chat pipeline without an LLM.
 */
export function seedMockAgent(): void {
    if (agentStore.getById(MOCK_AGENT_ID)) return;
    if (agentStore.getByKey(MOCK_AGENT_KEY)) return;
    agentStore.createAgent({
        id: MOCK_AGENT_ID,
        agent_key: MOCK_AGENT_KEY,
        parent_key: DEMO_API_KEY,
        yaml: MOCK_AGENT_YAML,
    });
    console.log('[mock] Mock agent seeded');
}

// ── Agent model ─────────────────────────────────────────────────────

/**
 * pageTools policy gates the postMessage:-prefixed tools an agent may call.
 * Stored inside the agent YAML blob; chat.ts reads it after parsing.
 */
export type PageToolsPolicy =
    | 'all'                           // allow all page tools (default)
    | { restricted: string[] }        // only these page tools
    | { blocked: string[] };          // all page tools except these

export interface Agent {
    id: string;
    agent_key: string;
    parent_key: string;
    yaml: string;
    created_at: number;
}

export interface ManagerIdentity {
    external_user_id: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    groups?: string;
}

export interface ManagerUser {
    id: string;
    external_user_id: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    groups: string | null;
    status: string;
    is_admin: boolean;
    created_at: string;
    last_seen_at: string;
}

function toManagerUser(row: DbManagerUserRow): ManagerUser {
    return {
        ...row,
        is_admin: Boolean(row.is_admin),
    };
}

function managerUserId(externalUserId: string): string {
    return `mgr_${externalUserId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export class AgentStore {
    private db: Database.Database;
    private stmtInsert: Database.Statement;
    private stmtGetByKey: Database.Statement;
    private stmtGetById: Database.Statement;
    private stmtListByParent: Database.Statement;
    private stmtUpdate: Database.Statement;
    private stmtRotateKey: Database.Statement;
    private stmtDeleteOwned: Database.Statement;
    private stmtGetOwned: Database.Statement;
    private stmtUpsertManagerUser: Database.Statement;
    private stmtGetManagerUserByExternalId: Database.Statement;
    private stmtGetActiveApiKeyForUser: Database.Statement;
    // Lazy-prepared: api_keys table is created after import by initializeAuthTables()
    private _stmtLookupApiKey: Database.Statement | null = null;
    private _stmtValidateKey: Database.Statement | null = null;

    constructor() {
        this.db = getDatabase();
        this.initTable();

        this.stmtInsert = this.db.prepare(`
          INSERT INTO agents (id, agent_key, parent_key, yaml, created_at)
          VALUES (@id, @agent_key, @parent_key, @yaml, @created_at)
        `);
        this.stmtGetByKey = this.db.prepare('SELECT * FROM agents WHERE agent_key = ?');
        this.stmtGetById = this.db.prepare('SELECT * FROM agents WHERE id = ?');
        this.stmtListByParent = this.db.prepare('SELECT * FROM agents WHERE parent_key = ?');
        this.stmtUpdate = this.db.prepare(`
          UPDATE agents SET yaml = @yaml
          WHERE id = @id AND parent_key = @parent_key
        `);
        this.stmtRotateKey = this.db.prepare(`
          UPDATE agents SET agent_key = @new_key
          WHERE id = @id AND parent_key = @parent_key
        `);
        this.stmtDeleteOwned = this.db.prepare('DELETE FROM agents WHERE id = ? AND parent_key = ?');
        this.stmtGetOwned = this.db.prepare('SELECT * FROM agents WHERE id = ? AND parent_key = ?');
        this.stmtUpsertManagerUser = this.db.prepare(`
          INSERT INTO users (id, external_user_id, username, first_name, last_name, email, groups, last_seen_at)
          VALUES (@id, @external_user_id, @username, @first_name, @last_name, @email, @groups, datetime('now'))
          ON CONFLICT(external_user_id) DO UPDATE SET
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            email = excluded.email,
            groups = excluded.groups,
            last_seen_at = datetime('now')
        `);
        this.stmtGetManagerUserByExternalId = this.db.prepare('SELECT * FROM users WHERE external_user_id = ?');
        this.stmtGetActiveApiKeyForUser = this.db.prepare(`
          SELECT id, name
          FROM api_keys
          WHERE user_id = ?
            AND COALESCE(status, 'active') = 'active'
            AND revoked_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1
        `);
    }

    private initTable() {
        initializeAuthTables(this.db);
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        agent_key TEXT UNIQUE NOT NULL,
        parent_key TEXT NOT NULL,
        yaml TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_agent_key ON agents(agent_key);
      CREATE INDEX IF NOT EXISTS idx_agents_parent_key ON agents(parent_key);
    `);
    }

    /** Check if a token is a valid parent or agent key (single query) */
    validateKey(token: string): boolean {
        if (!this._stmtValidateKey) {
            this._stmtValidateKey = this.db.prepare(`
              SELECT 1 FROM api_keys
              WHERE key = ?
                AND COALESCE(status, 'active') = 'active'
                AND revoked_at IS NULL
              UNION ALL
              SELECT 1 FROM agents WHERE agent_key = ?
              LIMIT 1
            `);
        }
        return !!this._stmtValidateKey.get(token, token);
    }

    /** Look up a parent API key — returns { id, name } or undefined */
    lookupApiKey(key: string): { id: string; name: string } | undefined {
        if (!this._stmtLookupApiKey) {
            this._stmtLookupApiKey = this.db.prepare(`
              SELECT id, name
              FROM api_keys
              WHERE key = ?
                AND COALESCE(status, 'active') = 'active'
                AND revoked_at IS NULL
            `);
        }
        return this._stmtLookupApiKey.get(key) as { id: string; name: string } | undefined;
    }

    upsertManagerUser(identity: ManagerIdentity): ManagerUser {
        this.stmtUpsertManagerUser.run({
            id: managerUserId(identity.external_user_id),
            external_user_id: identity.external_user_id,
            username: identity.username ?? null,
            first_name: identity.first_name ?? null,
            last_name: identity.last_name ?? null,
            email: identity.email ?? null,
            groups: identity.groups ?? null,
        });
        return this.getManagerUserByExternalId(identity.external_user_id)!;
    }

    getManagerUserByExternalId(externalUserId: string): ManagerUser | null {
        const row = this.stmtGetManagerUserByExternalId.get(externalUserId) as DbManagerUserRow | undefined;
        return row ? toManagerUser(row) : null;
    }

    getActiveApiKeyForUser(userId: string): { id: string; name: string } | undefined {
        return this.stmtGetActiveApiKeyForUser.get(userId) as { id: string; name: string } | undefined;
    }

    createAgent(params: { id: string; agent_key: string; parent_key: string; yaml: string }): Agent {
        const created_at = Math.floor(Date.now() / 1000);
        this.stmtInsert.run({ ...params, created_at });
        return { ...params, created_at };
    }

    getByKey(agentKey: string): Agent | null {
        const row = this.stmtGetByKey.get(agentKey) as DbAgentRow | undefined;
        return row ?? null;
    }

    getById(agentId: string): Agent | null {
        const row = this.stmtGetById.get(agentId) as DbAgentRow | undefined;
        return row ?? null;
    }

    /** Get agent only if owned by parentKey */
    getOwned(agentId: string, parentKey: string): Agent | null {
        const row = this.stmtGetOwned.get(agentId, parentKey) as DbAgentRow | undefined;
        return row ?? null;
    }

    listByParent(parentKey: string): Agent[] {
        return this.stmtListByParent.all(parentKey) as DbAgentRow[];
    }

    /** Replace the YAML blob of an owned agent. Returns updated row or null. */
    updateAgent(agentId: string, parentKey: string, yaml: string): Agent | null {
        const existing = this.getOwned(agentId, parentKey);
        if (!existing) return null;
        this.stmtUpdate.run({ id: agentId, parent_key: parentKey, yaml });
        return { ...existing, yaml };
    }

    /** Replace the agent_key of an owned agent. Returns updated row or null. */
    rotateKey(agentId: string, parentKey: string, newKey: string): Agent | null {
        const existing = this.getOwned(agentId, parentKey);
        if (!existing) return null;
        this.stmtRotateKey.run({ id: agentId, parent_key: parentKey, new_key: newKey });
        return { ...existing, agent_key: newKey };
    }

    /** Delete agent only if owned by parentKey. Returns true if deleted. */
    deleteAgent(agentId: string, parentKey: string): boolean {
        const result = this.stmtDeleteOwned.run(agentId, parentKey);
        return result.changes > 0;
    }
}

// Singleton instance
export const agentStore = new AgentStore();
