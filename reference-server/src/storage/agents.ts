import Database from 'better-sqlite3';
import path from 'path';
import { getKeyHint } from '../util';

interface DbAgentRow {
    id: string;
    agent_key: string;
    parent_key: string;
    name: string;
    instructions: string;
    model: string | null;
    temperature: number | null;
    tools: string | null;
    behavior: string | null;
    page_tools: string | null;
    created_at: number;
}

const DB_PATH = process.env.DB_PATH
    ?? path.join(process.cwd(), 'data', 'ozwell.db');

// Demo parent API key
export const DEMO_API_KEY = 'ozw_demo_localhost_key_for_testing';

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

// ── Agent model ─────────────────────────────────────────────────────

export type PageToolsPolicy =
    | 'all'                           // allow all page tools (default)
    | { restricted: string[] }        // only these page tools
    | { blocked: string[] };          // all page tools except these

export interface ToolDefinition {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export interface Agent {
    id: string;
    agent_key: string;
    parent_key: string;
    name: string;
    instructions: string;
    model?: string;
    temperature?: number;
    tools?: (string | ToolDefinition)[];
    behavior?: Record<string, unknown>;
    pageTools?: PageToolsPolicy;
    created_at: number;
}

export class AgentStore {
    private db: Database.Database;
    // Cached prepared statements
    private stmtInsert: Database.Statement;
    private stmtGetByKey: Database.Statement;
    private stmtGetById: Database.Statement;
    private stmtListByParent: Database.Statement;
    private stmtUpdate: Database.Statement;
    private stmtDeleteOwned: Database.Statement;
    private stmtGetOwned: Database.Statement;
    // Lazy-prepared: api_keys table is created after import by initializeAuthTables()
    private _stmtLookupApiKey: Database.Statement | null = null;
    private _stmtValidateKey: Database.Statement | null = null;

    constructor() {
        this.db = getDatabase();
        this.initTable();

        this.stmtInsert = this.db.prepare(`
          INSERT INTO agents (id, agent_key, parent_key, name, instructions, model, temperature, tools, behavior, page_tools, created_at)
          VALUES (@id, @agent_key, @parent_key, @name, @instructions, @model, @temperature, @tools, @behavior, @page_tools, @created_at)
        `);
        this.stmtGetByKey = this.db.prepare('SELECT * FROM agents WHERE agent_key = ?');
        this.stmtGetById = this.db.prepare('SELECT * FROM agents WHERE id = ?');
        this.stmtListByParent = this.db.prepare('SELECT * FROM agents WHERE parent_key = ?');
        this.stmtUpdate = this.db.prepare(`
          UPDATE agents SET name = @name, instructions = @instructions, model = @model,
            temperature = @temperature, tools = @tools, behavior = @behavior, page_tools = @page_tools
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
        name TEXT NOT NULL,
        instructions TEXT NOT NULL,
        model TEXT,
        temperature REAL,
        tools TEXT,
        behavior TEXT,
        page_tools TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_agent_key ON agents(agent_key);
      CREATE INDEX IF NOT EXISTS idx_agents_parent_key ON agents(parent_key);
    `);
        // Migration: add page_tools column if missing (existing DBs)
        try {
            this.db.exec('ALTER TABLE agents ADD COLUMN page_tools TEXT');
        } catch {
            // Column already exists — ignore
        }
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

    createAgent(agent: Omit<Agent, 'created_at'>): Agent {
        const created_at = Math.floor(Date.now() / 1000);

        this.stmtInsert.run({
            id: agent.id,
            agent_key: agent.agent_key,
            parent_key: agent.parent_key,
            name: agent.name,
            instructions: agent.instructions,
            model: agent.model || null,
            temperature: agent.temperature ?? null,
            tools: agent.tools ? JSON.stringify(agent.tools) : null,
            behavior: agent.behavior ? JSON.stringify(agent.behavior) : null,
            page_tools: agent.pageTools ? JSON.stringify(agent.pageTools) : null,
            created_at
        });

        return { ...agent, created_at };
    }

    getByKey(agentKey: string): Agent | null {
        const row = this.stmtGetByKey.get(agentKey) as DbAgentRow | undefined;
        return row ? this.deserialize(row) : null;
    }

    getById(agentId: string): Agent | null {
        const row = this.stmtGetById.get(agentId) as DbAgentRow | undefined;
        return row ? this.deserialize(row) : null;
    }

    /** Get agent only if owned by parentKey */
    getOwned(agentId: string, parentKey: string): Agent | null {
        const row = this.stmtGetOwned.get(agentId, parentKey) as DbAgentRow | undefined;
        return row ? this.deserialize(row) : null;
    }

    listByParent(parentKey: string): Agent[] {
        const rows = this.stmtListByParent.all(parentKey) as DbAgentRow[];
        return rows.map(row => this.deserialize(row));
    }

    updateAgent(agentId: string, parentKey: string, updates: Partial<Pick<Agent, 'name' | 'instructions' | 'model' | 'temperature' | 'tools' | 'behavior' | 'pageTools'>>): Agent | null {
        const existing = this.getOwned(agentId, parentKey);
        if (!existing) return null;

        const merged = {
            name: updates.name ?? existing.name,
            instructions: updates.instructions ?? existing.instructions,
            model: updates.model ?? existing.model,
            temperature: updates.temperature ?? existing.temperature,
            tools: updates.tools ?? existing.tools,
            behavior: updates.behavior ?? existing.behavior,
            pageTools: updates.pageTools ?? existing.pageTools,
        };

        this.stmtUpdate.run({
            id: agentId,
            parent_key: parentKey,
            name: merged.name,
            instructions: merged.instructions,
            model: merged.model || null,
            temperature: merged.temperature ?? null,
            tools: merged.tools ? JSON.stringify(merged.tools) : null,
            behavior: merged.behavior ? JSON.stringify(merged.behavior) : null,
            page_tools: merged.pageTools ? JSON.stringify(merged.pageTools) : null,
        });

        return {
            ...existing,
            ...merged,
        };
    }

    /** Delete agent only if owned by parentKey. Returns true if deleted. */
    deleteAgent(agentId: string, parentKey: string): boolean {
        const result = this.stmtDeleteOwned.run(agentId, parentKey);
        return result.changes > 0;
    }

    private deserialize(row: DbAgentRow): Agent {
        return {
            id: row.id,
            agent_key: row.agent_key,
            parent_key: row.parent_key,
            name: row.name,
            instructions: row.instructions,
            model: row.model ?? undefined,
            temperature: row.temperature ?? undefined,
            tools: row.tools ? JSON.parse(row.tools) : undefined,
            behavior: row.behavior ? JSON.parse(row.behavior) : undefined,
            pageTools: row.page_tools ? JSON.parse(row.page_tools) : undefined,
            created_at: row.created_at
        };
    }

}

// Singleton instance
export const agentStore = new AgentStore();
