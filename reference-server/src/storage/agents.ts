import Database from 'better-sqlite3';
import path from 'path';
import { generateId, getKeyHint, KEY_PREFIX } from '../util';

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
    ensureColumn(db, 'api_keys', 'source', 'TEXT');
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

export interface ParentApiKey {
    id: string;
    name: string;
    key: string;
    key_hint: string;
    user_id: string | null;
    status: string;
    source: string | null;
    revoked_at: string | null;
}

export interface ClaimParentKeyResult {
    parentKey: ParentApiKey;
    migratedAgents: number;
    revokedParentKeyId: string | null;
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
    private stmtCreateParentApiKey: Database.Statement;
    private stmtGetApiKeyByKey: Database.Statement;
    private stmtMoveAgentsToParent: Database.Statement;
    private stmtAttachApiKeyToUser: Database.Statement;
    private stmtRevokeApiKey: Database.Statement;
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
          SELECT id, name, key, key_hint, user_id, COALESCE(status, 'active') AS status, source, revoked_at
          FROM api_keys
          WHERE user_id = ?
            AND COALESCE(status, 'active') = 'active'
            AND revoked_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1
        `);
        this.stmtCreateParentApiKey = this.db.prepare(`
          INSERT INTO api_keys (id, name, key, key_hint, user_id, status, source, created_at)
          VALUES (@id, @name, @key, @key_hint, @user_id, @status, @source, @created_at)
        `);
        this.stmtGetApiKeyByKey = this.db.prepare(`
          SELECT id, name, key, key_hint, user_id, COALESCE(status, 'active') AS status, source, revoked_at
          FROM api_keys
          WHERE key = ?
        `);
        this.stmtMoveAgentsToParent = this.db.prepare(`
          UPDATE agents SET parent_key = @to_parent_key
          WHERE parent_key = @from_parent_key
        `);
        this.stmtAttachApiKeyToUser = this.db.prepare(`
          UPDATE api_keys
          SET user_id = @user_id, status = 'active', source = @source, revoked_at = NULL
          WHERE id = @id
        `);
        this.stmtRevokeApiKey = this.db.prepare(`
          UPDATE api_keys
          SET user_id = NULL, status = 'revoked', revoked_at = @revoked_at
          WHERE id = @id
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

    getActiveApiKeyForUser(userId: string): ParentApiKey | undefined {
        return this.stmtGetActiveApiKeyForUser.get(userId) as ParentApiKey | undefined;
    }

    createParentApiKeyForUser(user: ManagerUser): ParentApiKey {
        const key = `${KEY_PREFIX}${generateId('manager')}`;
        const parentKey: ParentApiKey = {
            id: generateId('api-key'),
            name: `${user.username || user.email || user.external_user_id} Manager Key`,
            key,
            key_hint: getKeyHint(key),
            user_id: user.id,
            status: 'active',
            source: 'auto',
            revoked_at: null,
        };
        this.stmtCreateParentApiKey.run({
            ...parentKey,
            created_at: new Date().toISOString(),
        });
        return parentKey;
    }

    ensureManagerUserProvisioned(identity: ManagerIdentity): { user: ManagerUser; parentKey: ParentApiKey } {
        const provision = this.db.transaction((managerIdentity: ManagerIdentity) => {
            let user = this.upsertManagerUser(managerIdentity);
            if (user.status !== 'active') {
                this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run('active', user.id);
                user = this.getManagerUserByExternalId(user.external_user_id)!;
            }

            let parentKey = this.getActiveApiKeyForUser(user.id);
            if (!parentKey) {
                parentKey = this.createParentApiKeyForUser(user);
            }
            return { user, parentKey };
        });
        return provision(identity);
    }

    getApiKeyByKey(key: string): ParentApiKey | undefined {
        return this.stmtGetApiKeyByKey.get(key) as ParentApiKey | undefined;
    }

    claimParentApiKey(userId: string, parentKey: string): ClaimParentKeyResult {
        const claim = this.db.transaction(() => {
            const target = this.getApiKeyByKey(parentKey);
            if (!target || target.status === 'revoked' || target.revoked_at) {
                throw new Error('parent_key_not_found');
            }
            if (target.user_id && target.user_id !== userId) {
                throw new Error('parent_key_already_claimed');
            }

            const current = this.getActiveApiKeyForUser(userId);
            let migratedAgents = 0;
            let revokedParentKeyId: string | null = null;

            if (current && current.id !== target.id) {
                const result = this.stmtMoveAgentsToParent.run({
                    from_parent_key: current.id,
                    to_parent_key: target.id,
                });
                migratedAgents = result.changes;

                if (current.source === 'auto') {
                    this.stmtRevokeApiKey.run({
                        id: current.id,
                        revoked_at: new Date().toISOString(),
                    });
                    revokedParentKeyId = current.id;
                }
            }

            this.stmtAttachApiKeyToUser.run({
                id: target.id,
                user_id: userId,
                source: target.source || 'claimed',
            });

            const claimed = this.db.prepare(`
              SELECT id, name, key, key_hint, user_id, COALESCE(status, 'active') AS status, source, revoked_at
              FROM api_keys WHERE id = ?
            `).get(target.id) as ParentApiKey;

            return { parentKey: claimed, migratedAgents, revokedParentKeyId };
        });

        return claim();
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
