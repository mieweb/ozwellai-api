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
    markdown: string;
    created_at: number;
}

const DB_PATH = path.join(process.cwd(), 'data', 'ozwell.db');

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
    markdown: string;
    created_at: number;
}

export class AgentStore {
    private db: Database.Database;

    constructor(dbPath: string = DB_PATH) {
        this.db = new Database(dbPath);
        this.initTable();
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
        markdown TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_agent_key ON agents(agent_key);
      CREATE INDEX IF NOT EXISTS idx_agents_parent_key ON agents(parent_key);
    `);
    }

    createAgent(agent: Omit<Agent, 'created_at'>): Agent {
        const created_at = Math.floor(Date.now() / 1000);
        const stmt = this.db.prepare(`
      INSERT INTO agents (id, agent_key, parent_key, name, instructions, model, temperature, tools, behavior, markdown, created_at)
      VALUES (@id, @agent_key, @parent_key, @name, @instructions, @model, @temperature, @tools, @behavior, @markdown, @created_at)
    `);

        stmt.run({
            id: agent.id,
            agent_key: agent.agent_key,
            parent_key: agent.parent_key,
            name: agent.name,
            instructions: agent.instructions,
            model: agent.model || null,
            temperature: agent.temperature ?? null,
            tools: agent.tools ? JSON.stringify(agent.tools) : null,
            behavior: agent.behavior ? JSON.stringify(agent.behavior) : null,
            markdown: agent.markdown,
            created_at
        });

        return { ...agent, created_at };
    }

    getByKey(agentKey: string): Agent | null {
        const stmt = this.db.prepare('SELECT * FROM agents WHERE agent_key = ?');
        const row = stmt.get(agentKey) as DbAgentRow | undefined;
        return row ? this.deserialize(row) : null;
    }

    getById(agentId: string): Agent | null {
        const stmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
        const row = stmt.get(agentId) as DbAgentRow | undefined;
        return row ? this.deserialize(row) : null;
    }

    listByParent(parentKey: string): Agent[] {
        const stmt = this.db.prepare('SELECT * FROM agents WHERE parent_key = ?');
        const rows = stmt.all(parentKey) as DbAgentRow[];
        return rows.map(row => this.deserialize(row));
    }

    updateAgent(agentId: string, updates: Partial<Pick<Agent, 'name' | 'instructions' | 'model' | 'temperature' | 'tools' | 'behavior' | 'markdown'>>): Agent | null {
        const existing = this.getById(agentId);
        if (!existing) return null;

        const merged = {
            name: updates.name ?? existing.name,
            instructions: updates.instructions ?? existing.instructions,
            model: updates.model ?? existing.model,
            temperature: updates.temperature ?? existing.temperature,
            tools: updates.tools ?? existing.tools,
            behavior: updates.behavior ?? existing.behavior,
            markdown: updates.markdown ?? existing.markdown,
        };

        const stmt = this.db.prepare(`
      UPDATE agents SET name = @name, instructions = @instructions, model = @model,
        temperature = @temperature, tools = @tools, behavior = @behavior, markdown = @markdown
      WHERE id = @id
    `);

        stmt.run({
            id: agentId,
            name: merged.name,
            instructions: merged.instructions,
            model: merged.model || null,
            temperature: merged.temperature ?? null,
            tools: merged.tools ? JSON.stringify(merged.tools) : null,
            behavior: merged.behavior ? JSON.stringify(merged.behavior) : null,
            markdown: merged.markdown,
        });

        return this.getById(agentId);
    }

    deleteAgent(agentId: string): boolean {
        const result = this.db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
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
            markdown: row.markdown,
            created_at: row.created_at
        };
    }

}

// Singleton instance
export const agentStore = new AgentStore();
