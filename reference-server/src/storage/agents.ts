import Database from 'better-sqlite3';
import path from 'path';
import * as yaml from 'yaml';
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

interface DbAgentWithParentRow extends DbAgentRow {
    api_key_id: string;
    api_key_name: string;
}

type UsageMetricRow = {
    request_count: number;
    error_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    last_used_at: string | null;
};

type CloudD1Result<T = Record<string, unknown>> = { results: T[] };

type CloudD1Statement = {
    bind(...args: unknown[]): CloudD1Statement;
    all<T = Record<string, unknown>>(): Promise<CloudD1Result<T>>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    run(): Promise<unknown>;
};

type CloudD1Database = {
    prepare(sql: string): CloudD1Statement;
};

type CloudLocalModule = {
    createSqliteD1(filePath: string): Promise<CloudD1Database>;
};

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

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<CloudLocalModule>;

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

      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        parent_key_id TEXT,
        agent_id TEXT,
        auth_type TEXT NOT NULL,
        route TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        status_code INTEGER NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_usage_events_parent_key_id ON usage_events(parent_key_id);
      CREATE INDEX IF NOT EXISTS idx_usage_events_agent_id ON usage_events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at);
    `);
    ensureColumn(db, 'api_keys', 'user_id', 'TEXT');
    ensureColumn(db, 'api_keys', 'status', "TEXT DEFAULT 'active'");
    ensureColumn(db, 'api_keys', 'revoked_at', 'TEXT');
    ensureColumn(db, 'api_keys', 'source', 'TEXT');
    ensureColumn(db, 'api_keys', 'revoked_reason', 'TEXT');
    ensureColumn(db, 'api_keys', 'replaced_by_key_id', 'TEXT');
    ensureColumn(db, 'usage_events', 'provider', 'TEXT');
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
    const existing = agentStore.getById(MOCK_AGENT_ID);
    if (existing) {
        if (existing.parent_key === DEMO_API_KEY) {
            getDatabase().prepare('UPDATE agents SET parent_key = ? WHERE id = ?').run('demo-key', MOCK_AGENT_ID);
        }
        return;
    }
    if (agentStore.getByKey(MOCK_AGENT_KEY)) return;
    agentStore.createAgent({
        id: MOCK_AGENT_ID,
        agent_key: MOCK_AGENT_KEY,
        parent_key: 'demo-key',
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
    revoked_reason?: string | null;
    replaced_by_key_id?: string | null;
}

export interface ClaimParentKeyResult {
    parentKey: ParentApiKey;
    migratedAgents: number;
    revokedParentKeyId: string | null;
}

export interface UsageEventInput {
    parent_key_id: string | null;
    agent_id: string | null;
    auth_type: 'parent' | 'agent';
    route: string;
    provider?: string | null;
    model: string | null;
    status_code: number;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
}

export interface ProviderModelRecord {
    id: string;
    provider: string;
    model: string;
    label: string;
    source: string;
    enabled: boolean;
    last_discovered_at: string | null;
}

export interface ProviderModelSelection {
    provider: string;
    model?: string | null;
}

export interface AgentModelPolicy {
    default_provider: string | null;
    default_model: string | null;
    updated_at: string | null;
    allowed_models: ProviderModelSelection[];
    source: 'db' | 'legacy_yaml' | 'none';
}

export interface ManagerNotification {
    id: string;
    user_id: string;
    type: string;
    message: string;
    metadata: Record<string, unknown> | null;
    read_at: string | null;
    created_at: string;
}

export interface AdminSummary {
    users_total: number;
    users_active: number;
    admins_total: number;
    parent_keys_total: number;
    parent_keys_active: number;
    parent_keys_revoked: number;
    agents_total: number;
    usage: {
        requests_total: number;
        errors_total: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

class UsageEventStore {
    private cloudDb: Promise<CloudD1Database>;

    constructor() {
        this.cloudDb = importEsm('@mieweb/cloud-local')
            .then(({ createSqliteD1 }) => createSqliteD1(DB_PATH));
    }

    async record(input: UsageEventInput): Promise<void> {
        const db = await this.cloudDb;
        await db.prepare(`
          INSERT INTO usage_events (
            id, parent_key_id, agent_id, auth_type, route, provider, model, status_code,
            prompt_tokens, completion_tokens, total_tokens, created_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?
          )
        `).bind(
            generateId('usage'),
            input.parent_key_id,
            input.agent_id,
            input.auth_type,
            input.route,
            input.provider ?? null,
            input.model,
            input.status_code,
            input.prompt_tokens ?? null,
            input.completion_tokens ?? null,
            input.total_tokens ?? null,
            new Date().toISOString(),
        ).run();
    }

    async summaryTotals() {
        const db = await this.cloudDb;
        return await db.prepare(`
          SELECT
            COUNT(*) AS requests_total,
            COUNT(CASE WHEN status_code >= 400 THEN 1 END) AS errors_total,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens
          FROM usage_events
        `).first<{
            requests_total: number;
            errors_total: number;
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        }>() ?? {
            requests_total: 0,
            errors_total: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };
    }

    async agentMetrics(agentId: string): Promise<UsageMetricRow> {
        const db = await this.cloudDb;
        return await db.prepare(`
          SELECT
            COUNT(*) AS request_count,
            COUNT(CASE WHEN status_code >= 400 THEN 1 END) AS error_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            MAX(created_at) AS last_used_at
          FROM usage_events
          WHERE agent_id = ?
        `).bind(agentId).first<UsageMetricRow>() ?? emptyUsageMetrics();
    }

    async userMetricsByUserId(): Promise<Map<string, Pick<UsageMetricRow, 'request_count' | 'total_tokens' | 'last_used_at'>>> {
        const db = await this.cloudDb;
        const { results: rows } = await db.prepare(`
          SELECT
            k.user_id,
            COUNT(e.id) AS request_count,
            COALESCE(SUM(e.total_tokens), 0) AS total_tokens,
            MAX(e.created_at) AS last_used_at
          FROM usage_events e
          JOIN api_keys k ON k.id = e.parent_key_id
          WHERE k.user_id IS NOT NULL
          GROUP BY k.user_id
        `).all<{
            user_id: string;
            request_count: number;
            total_tokens: number;
            last_used_at: string | null;
        }>();
        return new Map(rows.map(row => [row.user_id, {
            request_count: row.request_count,
            total_tokens: row.total_tokens,
            last_used_at: row.last_used_at,
        }]));
    }

    async parentKeyMetricsById(): Promise<Map<string, UsageMetricRow>> {
        const db = await this.cloudDb;
        const { results: rows } = await db.prepare(`
          SELECT
            parent_key_id,
            COUNT(*) AS request_count,
            COUNT(CASE WHEN status_code >= 400 THEN 1 END) AS error_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            MAX(created_at) AS last_used_at
          FROM usage_events
          WHERE parent_key_id IS NOT NULL
          GROUP BY parent_key_id
        `).all<UsageMetricRow & { parent_key_id: string }>();
        return new Map(rows.map(row => [row.parent_key_id, {
            request_count: row.request_count,
            error_count: row.error_count,
            prompt_tokens: row.prompt_tokens,
            completion_tokens: row.completion_tokens,
            total_tokens: row.total_tokens,
            last_used_at: row.last_used_at,
        }]));
    }

    async agentMetricsById(): Promise<Map<string, UsageMetricRow>> {
        const db = await this.cloudDb;
        const { results: rows } = await db.prepare(`
          SELECT
            agent_id,
            COUNT(*) AS request_count,
            COUNT(CASE WHEN status_code >= 400 THEN 1 END) AS error_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            MAX(created_at) AS last_used_at
          FROM usage_events
          WHERE agent_id IS NOT NULL
          GROUP BY agent_id
        `).all<UsageMetricRow & { agent_id: string }>();
        return new Map(rows.map(row => [row.agent_id, {
            request_count: row.request_count,
            error_count: row.error_count,
            prompt_tokens: row.prompt_tokens,
            completion_tokens: row.completion_tokens,
            total_tokens: row.total_tokens,
            last_used_at: row.last_used_at,
        }]));
    }
}

function emptyUsageMetrics(): UsageMetricRow {
    return {
        request_count: 0,
        error_count: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        last_used_at: null,
    };
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

function adminExternalUserIds(): Set<string> {
    return new Set(
        (process.env.ADMIN_EXTERNAL_USER_IDS || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean),
    );
}

export class AgentStore {
    private db: Database.Database;
    private usageStore: UsageEventStore;
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
    private stmtUpsertProviderModel: Database.Statement;
    // Lazy-prepared: api_keys table is created after import by initializeAuthTables()
    private _stmtLookupApiKey: Database.Statement | null = null;
    private _stmtValidateKey: Database.Statement | null = null;

    constructor() {
        this.db = getDatabase();
        this.initTable();
        this.usageStore = new UsageEventStore();

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
          SET user_id = NULL,
              status = 'revoked',
              revoked_at = @revoked_at,
              revoked_reason = @revoked_reason,
              replaced_by_key_id = @replaced_by_key_id
          WHERE id = @id
        `);
        this.stmtUpsertProviderModel = this.db.prepare(`
          INSERT INTO provider_models (provider, model, id, label, source, enabled, last_discovered_at, created_at)
          VALUES (@provider, @model, @id, @label, @source, @enabled, @last_discovered_at, @created_at)
          ON CONFLICT(provider, model) DO UPDATE SET
            id = excluded.id,
            label = excluded.label,
            source = excluded.source,
            enabled = excluded.enabled,
            last_discovered_at = excluded.last_discovered_at
        `);
        this.migrateAgentModelPoliciesFromYaml();
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

      CREATE TABLE IF NOT EXISTS provider_models (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        id TEXT NOT NULL,
        label TEXT NOT NULL,
        source TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_discovered_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (provider, model)
      );
      CREATE INDEX IF NOT EXISTS idx_provider_models_enabled ON provider_models(enabled);

      CREATE TABLE IF NOT EXISTS parent_key_model_restrictions (
        id TEXT PRIMARY KEY,
        parent_key_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_parent_key_model_restrictions_parent_key ON parent_key_model_restrictions(parent_key_id);

      CREATE TABLE IF NOT EXISTS agent_model_settings (
        agent_id TEXT PRIMARY KEY,
        default_provider TEXT,
        default_model TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agent_model_restrictions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_model_restrictions_agent_id ON agent_model_restrictions(agent_id);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        read_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

      CREATE TABLE IF NOT EXISTS notification_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        parent_key_id TEXT,
        type TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notification_events_parent_key_id ON notification_events(parent_key_id);
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
              SELECT 1
              FROM agents a
              JOIN api_keys k ON k.id = a.parent_key
              WHERE a.agent_key = ?
                AND COALESCE(k.status, 'active') = 'active'
                AND k.revoked_at IS NULL
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
        const key = `${KEY_PREFIX}${generateId()}`;
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
            const bootstrapAdmin = adminExternalUserIds().has(user.external_user_id);
            if (user.status !== 'active' || (bootstrapAdmin && !user.is_admin)) {
                this.db.prepare('UPDATE users SET status = ?, is_admin = CASE WHEN ? THEN 1 ELSE is_admin END WHERE id = ?')
                    .run('active', bootstrapAdmin ? 1 : 0, user.id);
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
                        revoked_reason: 'replaced_by_claimed_key',
                        replaced_by_key_id: target.id,
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

    getByKeyWithActiveParent(agentKey: string): { agent: Agent; parentKey: { id: string; name: string } } | null {
        const row = this.db.prepare(`
          SELECT
            a.id, a.agent_key, a.parent_key, a.yaml, a.created_at,
            k.id AS api_key_id, k.name AS api_key_name
          FROM agents a
          JOIN api_keys k ON k.id = a.parent_key
          WHERE a.agent_key = ?
            AND COALESCE(k.status, 'active') = 'active'
            AND k.revoked_at IS NULL
        `).get(agentKey) as DbAgentWithParentRow | undefined;
        if (!row) return null;
        return {
            agent: {
                id: row.id,
                agent_key: row.agent_key,
                parent_key: row.parent_key,
                yaml: row.yaml,
                created_at: row.created_at,
            },
            parentKey: {
                id: row.api_key_id,
                name: row.api_key_name,
            },
        };
    }

    async recordUsageEvent(input: UsageEventInput): Promise<void> {
        await this.usageStore.record(input);
    }

    upsertProviderModels(records: Array<Omit<ProviderModelRecord, 'enabled' | 'last_discovered_at'> & Partial<Pick<ProviderModelRecord, 'enabled' | 'last_discovered_at'>>>): ProviderModelRecord[] {
        const now = new Date().toISOString();
        const upsert = this.db.transaction((items: typeof records) => {
            for (const item of items) {
                this.stmtUpsertProviderModel.run({
                    provider: item.provider,
                    model: item.model,
                    id: item.id,
                    label: item.label,
                    source: item.source,
                    enabled: item.enabled === false ? 0 : 1,
                    last_discovered_at: item.last_discovered_at ?? now,
                    created_at: now,
                });
            }
        });
        upsert(records);
        return this.listProviderModels();
    }

    replaceProviderModels(records: Array<Omit<ProviderModelRecord, 'enabled' | 'last_discovered_at'> & Partial<Pick<ProviderModelRecord, 'enabled' | 'last_discovered_at'>>>): ProviderModelRecord[] {
        const replace = this.db.transaction((items: typeof records) => {
            this.db.prepare('UPDATE provider_models SET enabled = 0').run();
            this.upsertProviderModels(items);
        });
        replace(records);
        return this.listProviderModels();
    }

    listProviderModels(): ProviderModelRecord[] {
        const rows = this.db.prepare(`
          SELECT id, provider, model, label, source, enabled, last_discovered_at
          FROM provider_models
          WHERE enabled = 1
          ORDER BY rowid ASC
        `).all() as Array<Omit<ProviderModelRecord, 'enabled'> & { enabled: number }>;
        return rows.map(row => ({ ...row, enabled: Boolean(row.enabled) }));
    }

    getParentKeyModelRestrictions(parentKeyId: string): ProviderModelSelection[] {
        return this.db.prepare(`
          SELECT provider, model
          FROM parent_key_model_restrictions
          WHERE parent_key_id = ?
          ORDER BY rowid ASC
        `).all(parentKeyId) as ProviderModelSelection[];
    }

    setParentKeyModelRestrictions(parentKeyId: string, selections: ProviderModelSelection[]): ProviderModelSelection[] {
        const before = this.listEffectiveProviderModels(parentKeyId);
        const normalized = normalizeProviderModelSelections(selections);
        const save = this.db.transaction(() => {
            this.db.prepare('DELETE FROM parent_key_model_restrictions WHERE parent_key_id = ?').run(parentKeyId);
            const insert = this.db.prepare(`
              INSERT INTO parent_key_model_restrictions (id, parent_key_id, provider, model, created_at)
              VALUES (@id, @parent_key_id, @provider, @model, @created_at)
            `);
            const created_at = new Date().toISOString();
            for (const item of normalized) {
                insert.run({
                    id: `${parentKeyId}:${item.provider}:${item.model || '*'}`,
                    parent_key_id: parentKeyId,
                    provider: item.provider,
                    model: item.model ?? null,
                    created_at,
                });
            }
        });
        save();
        this.recordParentPolicyChange(parentKeyId, before, this.listEffectiveProviderModels(parentKeyId));
        return this.getParentKeyModelRestrictions(parentKeyId);
    }

    getAgentModelPolicy(agentId: string, fallbackYaml?: string | null): AgentModelPolicy {
        const setting = this.db.prepare(`
          SELECT default_provider, default_model, updated_at
          FROM agent_model_settings
          WHERE agent_id = ?
        `).get(agentId) as { default_provider: string | null; default_model: string | null; updated_at: string | null } | undefined;
        const restrictions = this.getAgentModelRestrictions(agentId);
        if (setting || restrictions.length) {
            return {
                default_provider: setting?.default_provider ?? null,
                default_model: setting?.default_model ?? null,
                updated_at: setting?.updated_at ?? null,
                allowed_models: restrictions,
                source: 'db',
            };
        }
        if (fallbackYaml) {
            const fallback = modelPolicyFromYaml(fallbackYaml);
            if (fallback.default_provider || fallback.default_model || fallback.allowed_models.length) {
                return { ...fallback, source: 'legacy_yaml' };
            }
        }
        return {
            default_provider: null,
            default_model: null,
            updated_at: null,
            allowed_models: [],
            source: 'none',
        };
    }

    getAgentModelRestrictions(agentId: string): ProviderModelSelection[] {
        return this.db.prepare(`
          SELECT provider, model
          FROM agent_model_restrictions
          WHERE agent_id = ?
          ORDER BY rowid ASC
        `).all(agentId) as ProviderModelSelection[];
    }

    setAgentModelPolicy(
        agentId: string,
        parentKey: string,
        defaultSelection: ProviderModelSelection | null,
        restrictions: ProviderModelSelection[],
    ): AgentModelPolicy | null {
        if (!this.getOwned(agentId, parentKey)) return null;
        const normalizedDefault = defaultSelection?.provider && defaultSelection.model
            ? { provider: defaultSelection.provider.trim(), model: defaultSelection.model.trim() }
            : null;
        const normalizedRestrictions = normalizeProviderModelSelections(restrictions);
        const save = this.db.transaction(() => {
            const now = new Date().toISOString();
            this.db.prepare(`
              INSERT INTO agent_model_settings (agent_id, default_provider, default_model, created_at, updated_at)
              VALUES (@agent_id, @default_provider, @default_model, @created_at, @updated_at)
              ON CONFLICT(agent_id) DO UPDATE SET
                default_provider = excluded.default_provider,
                default_model = excluded.default_model,
                updated_at = excluded.updated_at
            `).run({
                agent_id: agentId,
                default_provider: normalizedDefault?.provider ?? null,
                default_model: normalizedDefault?.model ?? null,
                created_at: now,
                updated_at: now,
            });
            this.db.prepare('DELETE FROM agent_model_restrictions WHERE agent_id = ?').run(agentId);
            const insert = this.db.prepare(`
              INSERT INTO agent_model_restrictions (id, agent_id, provider, model, created_at)
              VALUES (@id, @agent_id, @provider, @model, @created_at)
            `);
            for (const item of normalizedRestrictions) {
                insert.run({
                    id: `${agentId}:${item.provider}:${item.model || '*'}`,
                    agent_id: agentId,
                    provider: item.provider,
                    model: item.model ?? null,
                    created_at: now,
                });
            }
        });
        save();
        return this.getAgentModelPolicy(agentId);
    }

    listEffectiveProviderModelsForAgent(parentKeyId: string, agentId: string, fallbackYaml?: string | null): ProviderModelRecord[] {
        const policy = this.getAgentModelPolicy(agentId, fallbackYaml);
        return this.listEffectiveProviderModels(parentKeyId, policy.allowed_models);
    }

    listEffectiveProviderModels(parentKeyId: string | null, agentAllowedModels?: ProviderModelSelection[] | null): ProviderModelRecord[] {
        const models = this.listProviderModels();
        const parentRestrictions = parentKeyId ? this.getParentKeyModelRestrictions(parentKeyId) : [];
        const parentFiltered = parentRestrictions.length
            ? models.filter(model => selectionAllows(parentRestrictions, model.provider, model.model))
            : models;
        const agentSelections = normalizeProviderModelSelections(agentAllowedModels || []);
        return agentSelections.length
            ? parentFiltered.filter(model => selectionAllows(agentSelections, model.provider, model.model))
            : parentFiltered;
    }

    listNotificationsForUser(userId: string): ManagerNotification[] {
        const rows = this.db.prepare(`
          SELECT id, user_id, type, message, metadata, read_at, created_at
          FROM notifications
          WHERE user_id = ?
          ORDER BY created_at DESC, rowid DESC
        `).all(userId) as Array<Omit<ManagerNotification, 'metadata'> & { metadata: string | null }>;
        return rows.map(row => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
        }));
    }

    markNotificationRead(userId: string, notificationId: string): ManagerNotification | null {
        const now = new Date().toISOString();
        const result = this.db.prepare(`
          UPDATE notifications
          SET read_at = COALESCE(read_at, ?)
          WHERE id = ? AND user_id = ?
        `).run(now, notificationId, userId);
        if (result.changes === 0) return null;
        return this.listNotificationsForUser(userId).find(item => item.id === notificationId) ?? null;
    }

    markAllNotificationsRead(userId: string): number {
        const result = this.db.prepare(`
          UPDATE notifications
          SET read_at = COALESCE(read_at, ?)
          WHERE user_id = ? AND read_at IS NULL
        `).run(new Date().toISOString(), userId);
        return result.changes;
    }

    async getAdminSummary(): Promise<AdminSummary> {
        const usage = await this.usageStore.summaryTotals();
        const row = this.db.prepare(`
          SELECT
            (SELECT COUNT(*) FROM users) AS users_total,
            (SELECT COUNT(*) FROM users WHERE status = 'active') AS users_active,
            (SELECT COUNT(*) FROM users WHERE is_admin = 1) AS admins_total,
            (SELECT COUNT(*) FROM api_keys) AS parent_keys_total,
            (SELECT COUNT(*) FROM api_keys WHERE COALESCE(status, 'active') = 'active' AND revoked_at IS NULL) AS parent_keys_active,
            (SELECT COUNT(*) FROM api_keys WHERE COALESCE(status, 'active') = 'revoked' OR revoked_at IS NOT NULL) AS parent_keys_revoked,
            (SELECT COUNT(*) FROM agents) AS agents_total
        `).get() as Record<string, number>;
        return {
            users_total: row.users_total,
            users_active: row.users_active,
            admins_total: row.admins_total,
            parent_keys_total: row.parent_keys_total,
            parent_keys_active: row.parent_keys_active,
            parent_keys_revoked: row.parent_keys_revoked,
            agents_total: row.agents_total,
            usage: {
                requests_total: usage.requests_total,
                errors_total: usage.errors_total,
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            },
        };
    }

    async getAgentMetrics(agentId: string) {
        return await this.usageStore.agentMetrics(agentId);
    }

    async listAdminUsers() {
        const usageByUserId = await this.usageStore.userMetricsByUserId();
        const rows = this.db.prepare(`
          SELECT
            u.id, u.external_user_id, u.username, u.first_name, u.last_name, u.email,
            u.status, u.is_admin, u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id) AS parent_key_count,
            (
              SELECT COUNT(*) FROM api_keys k
              WHERE k.user_id = u.id
                AND COALESCE(k.status, 'active') = 'active'
                AND k.revoked_at IS NULL
            ) AS active_parent_key_count,
            (
              SELECT COUNT(*)
              FROM agents a
              JOIN api_keys k ON k.id = a.parent_key
              WHERE k.user_id = u.id
            ) AS agent_count
          FROM users u
          ORDER BY u.last_seen_at DESC
        `).all() as Array<Record<string, unknown> & { id: string }>;
        return rows.map(row => {
            const usage = usageByUserId.get(row.id);
            return {
                ...row,
                request_count: usage?.request_count ?? 0,
                total_tokens: usage?.total_tokens ?? 0,
                last_used_at: usage?.last_used_at ?? null,
            };
        });
    }

    async getAdminUserDetail(userId: string) {
        const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) return null;
        const parentKeys = ((await this.listAdminParentKeys()) as unknown as Array<{ user_id: string | null }>).filter(key => key.user_id === userId);
        const agents = ((await this.listAdminAgents()) as unknown as Array<{ user_id: string | null }>).filter(agent => agent.user_id === userId);
        return { user, parent_keys: parentKeys, agents };
    }

    async listAdminParentKeys() {
        const metricsByParentKeyId = await this.usageStore.parentKeyMetricsById();
        const rows = this.db.prepare(`
          SELECT
            k.id, k.name, k.key_hint, k.user_id, k.status, k.source, k.revoked_at,
            k.revoked_reason, k.replaced_by_key_id, k.created_at,
            u.external_user_id, u.username, u.email,
            (SELECT COUNT(*) FROM agents a WHERE a.parent_key = k.id) AS agent_count
          FROM api_keys k
          LEFT JOIN users u ON u.id = k.user_id
          ORDER BY k.created_at DESC
        `).all() as Array<Record<string, unknown> & { id: string }>;
        return rows.map(row => ({
            ...row,
            ...(metricsByParentKeyId.get(row.id) ?? emptyUsageMetrics()),
        }));
    }

    async listAdminAgents() {
        const metricsByAgentId = await this.usageStore.agentMetricsById();
        const rows = this.db.prepare(`
          SELECT
            a.id, a.agent_key, a.parent_key, a.yaml, a.created_at,
            k.user_id, k.name AS parent_key_name, k.key_hint AS parent_key_hint,
            u.external_user_id, u.username, u.email
          FROM agents a
          LEFT JOIN api_keys k ON k.id = a.parent_key
          LEFT JOIN users u ON u.id = k.user_id
          ORDER BY a.created_at DESC
        `).all() as Array<Record<string, unknown> & { id: string }>;
        return rows.map(row => ({
            ...row,
            ...(metricsByAgentId.get(row.id) ?? emptyUsageMetrics()),
        }));
    }

    promoteManagerUser(userId: string): ManagerUser | null {
        const result = this.db.prepare('UPDATE users SET is_admin = 1, status = ? WHERE id = ?').run('active', userId);
        if (result.changes === 0) return null;
        const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as DbManagerUserRow;
        return toManagerUser(row);
    }

    demoteManagerUser(actorUserId: string, targetUserId: string): ManagerUser | null {
        if (actorUserId === targetUserId) {
            throw new Error('cannot_demote_self');
        }
        const demote = this.db.transaction(() => {
            const target = this.db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId) as DbManagerUserRow | undefined;
            if (!target) return null;
            const adminCount = (this.db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get() as { count: number }).count;
            if (target.is_admin && adminCount <= 1) {
                throw new Error('cannot_remove_last_admin');
            }
            this.db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(targetUserId);
            const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId) as DbManagerUserRow;
            return toManagerUser(row);
        });
        return demote();
    }

    revokeParentApiKey(keyId: string, reason = 'admin_revoked'): ParentApiKey | null {
        const revoke = this.db.transaction(() => {
            const existing = this.db.prepare(`
              SELECT id, name, key, key_hint, user_id, COALESCE(status, 'active') AS status, source, revoked_at, revoked_reason, replaced_by_key_id
              FROM api_keys
              WHERE id = ?
            `).get(keyId) as ParentApiKey | undefined;
            if (!existing) return null;
            this.db.prepare(`
              UPDATE api_keys
              SET status = 'revoked',
                  revoked_at = @revoked_at,
                  revoked_reason = @revoked_reason,
                  replaced_by_key_id = NULL
              WHERE id = @id
            `).run({
                id: keyId,
                revoked_at: new Date().toISOString(),
                revoked_reason: reason,
            });
            return this.db.prepare(`
              SELECT id, name, key, key_hint, user_id, COALESCE(status, 'active') AS status, source, revoked_at, revoked_reason, replaced_by_key_id
              FROM api_keys
              WHERE id = ?
            `).get(keyId) as ParentApiKey;
        });
        return revoke();
    }

    private migrateAgentModelPoliciesFromYaml(): void {
        const agents = this.db.prepare('SELECT id, yaml FROM agents').all() as Array<{ id: string; yaml: string }>;
        const migrate = this.db.transaction((rows: typeof agents) => {
            for (const agent of rows) {
                this.migrateAgentModelPolicyFromYaml(agent.id, agent.yaml);
            }
        });
        migrate(agents);
    }

    private migrateAgentModelPolicyFromYaml(agentId: string, agentYaml: string): void {
        const hasSetting = this.db.prepare('SELECT 1 FROM agent_model_settings WHERE agent_id = ?').get(agentId);
        const hasRestriction = this.db.prepare('SELECT 1 FROM agent_model_restrictions WHERE agent_id = ? LIMIT 1').get(agentId);
        if (hasSetting || hasRestriction) return;
        const policy = modelPolicyFromYaml(agentYaml);
        if (!policy.default_provider && !policy.default_model && policy.allowed_models.length === 0) return;

        const resolvedProvider = policy.default_provider
            ?? this.resolveUniqueProviderForModel(policy.default_model);
        const now = new Date().toISOString();

        if (resolvedProvider && policy.default_model) {
            this.db.prepare(`
              INSERT INTO agent_model_settings (agent_id, default_provider, default_model, created_at, updated_at)
              VALUES (@agent_id, @default_provider, @default_model, @created_at, @updated_at)
            `).run({
                agent_id: agentId,
                default_provider: resolvedProvider,
                default_model: policy.default_model,
                created_at: now,
                updated_at: now,
            });
        }
        if (policy.allowed_models.length) {
            const insert = this.db.prepare(`
              INSERT INTO agent_model_restrictions (id, agent_id, provider, model, created_at)
              VALUES (@id, @agent_id, @provider, @model, @created_at)
            `);
            for (const item of policy.allowed_models) {
                insert.run({
                    id: `${agentId}:${item.provider}:${item.model || '*'}`,
                    agent_id: agentId,
                    provider: item.provider,
                    model: item.model ?? null,
                    created_at: now,
                });
            }
        }
    }

    private resolveUniqueProviderForModel(model: string | null): string | null {
        if (!model) return null;
        const rows = this.db.prepare(`
          SELECT DISTINCT provider
          FROM provider_models
          WHERE enabled = 1 AND model = ?
        `).all(model) as Array<{ provider: string }>;
        return rows.length === 1 ? rows[0].provider : null;
    }

    private recordParentPolicyChange(parentKeyId: string, before: ProviderModelRecord[], after: ProviderModelRecord[]): void {
        const afterKeys = new Set(after.map(model => `${model.provider}:${model.model}`));
        const removed = before.filter(model => !afterKeys.has(`${model.provider}:${model.model}`));
        if (removed.length === 0) return;

        const parentKey = this.db.prepare('SELECT user_id FROM api_keys WHERE id = ?').get(parentKeyId) as { user_id: string | null } | undefined;
        const metadata = JSON.stringify({
            parent_key_id: parentKeyId,
            removed_models: removed.map(model => ({ provider: model.provider, model: model.model })),
        });
        const now = new Date().toISOString();
        this.db.prepare(`
          INSERT INTO notification_events (id, user_id, parent_key_id, type, metadata, created_at)
          VALUES (@id, @user_id, @parent_key_id, @type, @metadata, @created_at)
        `).run({
            id: generateId('notification-event'),
            user_id: parentKey?.user_id ?? null,
            parent_key_id: parentKeyId,
            type: 'model_policy_changed',
            metadata,
            created_at: now,
        });

        if (!parentKey?.user_id) return;
        const existingUnread = this.db.prepare(`
          SELECT id
          FROM notifications
          WHERE user_id = ?
            AND type = ?
            AND metadata = ?
            AND read_at IS NULL
          LIMIT 1
        `).get(parentKey.user_id, 'model_policy_changed', metadata);
        if (existingUnread) return;
        this.db.prepare(`
          INSERT INTO notifications (id, user_id, type, message, metadata, created_at)
          VALUES (@id, @user_id, @type, @message, @metadata, @created_at)
        `).run({
            id: generateId('notification'),
            user_id: parentKey.user_id,
            type: 'model_policy_changed',
            message: `${removed.length} model option${removed.length === 1 ? '' : 's'} removed by admin policy.`,
            metadata,
            created_at: now,
        });
    }

    createAgent(params: { id: string; agent_key: string; parent_key: string; yaml: string }): Agent {
        const created_at = Math.floor(Date.now() / 1000);
        this.stmtInsert.run({ ...params, created_at });
        this.migrateAgentModelPolicyFromYaml(params.id, params.yaml);
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

export function normalizeProviderModelSelections(selections: ProviderModelSelection[]): ProviderModelSelection[] {
    const seen = new Set<string>();
    const normalized: ProviderModelSelection[] = [];
    for (const selection of selections) {
        if (!selection || typeof selection.provider !== 'string') continue;
        const provider = selection.provider.trim();
        const rawModel = typeof selection.model === 'string' ? selection.model.trim() : null;
        if (!provider) continue;
        const key = `${provider}:${rawModel || '*'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push({ provider, model: rawModel || null });
    }
    return normalized;
}

function selectionAllows(selections: ProviderModelSelection[], provider: string, model: string): boolean {
    return selections.some(selection => (
        selection.provider === provider && (!selection.model || selection.model === model)
    ));
}

function modelPolicyFromYaml(agentYaml: string): AgentModelPolicy {
    let parsed: Record<string, unknown> = {};
    try {
        const value = yaml.parse(agentYaml);
        if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
    } catch {
        return { default_provider: null, default_model: null, updated_at: null, allowed_models: [], source: 'none' };
    }

    let defaultProvider = typeof parsed.provider === 'string' && parsed.provider.trim()
        ? parsed.provider.trim()
        : null;
    let defaultModel = typeof parsed.model === 'string' && parsed.model.trim()
        ? parsed.model.trim()
        : null;
    if (defaultModel?.includes('/') && !defaultProvider) {
        const [provider, ...modelParts] = defaultModel.split('/');
        defaultProvider = provider || null;
        defaultModel = modelParts.join('/') || defaultModel;
    }
    const allowedModels = Array.isArray(parsed.allowedModels)
        ? normalizeProviderModelSelections(parsed.allowedModels.map(item => {
            if (!item || typeof item !== 'object') return { provider: '' };
            const record = item as Record<string, unknown>;
            return {
                provider: typeof record.provider === 'string' ? record.provider : '',
                model: typeof record.model === 'string' ? record.model : null,
            };
        }))
        : [];

    return {
        default_provider: defaultProvider,
        default_model: defaultModel,
        updated_at: null,
        allowed_models: allowedModels,
        source: 'legacy_yaml',
    };
}
