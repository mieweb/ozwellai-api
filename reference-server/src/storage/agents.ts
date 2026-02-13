import Database from 'better-sqlite3';
import path from 'path';
import { AgentMetadata } from '../../../spec/index';

const DB_PATH = path.join(process.cwd(), 'data', 'ozwell.db');

export interface Agent {
    id: string;
    agent_key: string;
    parent_key: string;
    name: string;
    instructions: string;
    model?: string;
    temperature?: number;
    tools?: string[];
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
            temperature: agent.temperature || null,
            tools: agent.tools ? JSON.stringify(agent.tools) : null,
            behavior: agent.behavior ? JSON.stringify(agent.behavior) : null,
            markdown: agent.markdown,
            created_at
        });

        return { ...agent, created_at };
    }

    getByKey(agentKey: string): Agent | null {
        const stmt = this.db.prepare('SELECT * FROM agents WHERE agent_key = ?');
        const row = stmt.get(agentKey) as any;
        return row ? this.deserialize(row) : null;
    }

    getById(agentId: string): Agent | null {
        const stmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
        const row = stmt.get(agentId) as any;
        return row ? this.deserialize(row) : null;
    }

    listByParent(parentKey: string): AgentMetadata[] {
        const stmt = this.db.prepare('SELECT id, agent_key, parent_key, name, created_at FROM agents WHERE parent_key = ?');
        const rows = stmt.all(parentKey) as any[];
        return rows.map(row => ({
            agent_id: row.id,
            agent_key: row.agent_key,
            parent_key: row.parent_key,
            name: row.name,
            created_at: row.created_at
        }));
    }

    getMarkdown(agentId: string): string | null {
        const stmt = this.db.prepare('SELECT markdown FROM agents WHERE id = ?');
        const row = stmt.get(agentId) as any;
        return row ? row.markdown : null;
    }

    private deserialize(row: any): Agent {
        return {
            id: row.id,
            agent_key: row.agent_key,
            parent_key: row.parent_key,
            name: row.name,
            instructions: row.instructions,
            model: row.model || undefined,
            temperature: row.temperature || undefined,
            tools: row.tools ? JSON.parse(row.tools) : undefined,
            behavior: row.behavior ? JSON.parse(row.behavior) : undefined,
            markdown: row.markdown,
            created_at: row.created_at
        };
    }

    close() {
        this.db.close();
    }
}

// Singleton instance
export const agentStore = new AgentStore();
