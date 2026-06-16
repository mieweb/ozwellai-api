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
    `);
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
 * pageTools policy gates the postMessage_-prefixed tools an agent may call.
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
    }

    private initTable() {
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
              SELECT 1 FROM api_keys WHERE key = ?
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
            this._stmtLookupApiKey = this.db.prepare('SELECT id, name FROM api_keys WHERE key = ?');
        }
        return this._stmtLookupApiKey.get(key) as { id: string; name: string } | undefined;
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
