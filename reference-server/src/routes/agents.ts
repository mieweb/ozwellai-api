import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createError, generateId, getKeyHint, isValidApiKey, extractToken, isAgentKey, AGENT_KEY_PREFIX, formatAgentKeyHint } from '../util';
import * as yaml from 'yaml';
import { agentStore, Agent, ManagerIdentity, ManagerUser, ProviderModelSelection } from '../storage/agents';
import { getCachedModelsList, getModelsList } from './models';

// Extend FastifyRequest to include auth data
declare module 'fastify' {
    interface FastifyRequest {
        apiKey?: {
            id: string;
            name: string;
        };
        managerUser?: ManagerUser;
    }
}

/**
 * API Key authentication preHandler
 * Validates parent keys (ozw_ prefix) via plaintext lookup.
 */
async function apiKeyAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization || !/^bearer\s+/i.test(authorization)) {
        reply.code(401).send(createError('Authorization header must use Bearer scheme', 'authentication_error', null, 'missing_api_key'));
        return;
    }

    const token = extractToken(authorization);

    if (!token) {
        reply.code(401).send(createError('Missing API key', 'authentication_error', null, 'missing_api_key'));
        return;
    }

    if (!isValidApiKey(token)) {
        reply.code(401).send(createError('Invalid API key format', 'authentication_error', null, 'invalid_api_key'));
        return;
    }

    const apiKey = agentStore.lookupApiKey(token);

    if (!apiKey) {
        reply.code(401).send(createError('Invalid API key', 'authentication_error', null, 'invalid_api_key'));
        return;
    }

    request.apiKey = apiKey;
}

function trustedForwardAuthHeadersEnabled(): boolean {
    return process.env.TRUST_FORWARD_AUTH_HEADERS === 'true';
}

function readHeader(request: FastifyRequest, name: string): string | undefined {
    const value = request.headers[name];
    if (Array.isArray(value)) return value[0];
    return value;
}

// Header names are env-configurable so a future SSO/proxy change is a config
// change, not a code change (per MIE infra guidance). Defaults match the
// current authentik / oauth2-proxy scheme.
function readForwardedIdentity(request: FastifyRequest): ManagerIdentity | null {
    const externalUserId = readHeader(request, process.env.MANAGER_USER_HEADER || 'x-user');
    const email = readHeader(request, process.env.MANAGER_EMAIL_HEADER || 'x-email');
    // Email is the primary identity key (stable across IdP/header changes), so
    // it is required. Both the old and new proxy schemes forward it.
    if (!email) return null;
    return {
        external_user_id: externalUserId || email,
        username: readHeader(request, process.env.MANAGER_USERNAME_HEADER || 'x-preferred-username'),
        first_name: readHeader(request, process.env.MANAGER_FIRSTNAME_HEADER || 'x-user-first-name'),
        last_name: readHeader(request, process.env.MANAGER_LASTNAME_HEADER || 'x-user-last-name'),
        email,
        groups: readHeader(request, process.env.MANAGER_GROUPS_HEADER || 'x-groups'),
    };
}

async function managerHeaderAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    if (!trustedForwardAuthHeadersEnabled()) {
        reply.code(401).send(createError('Trusted forwarded auth headers are disabled', 'authentication_error', null, 'trusted_headers_disabled'));
        return;
    }

    const identity = readForwardedIdentity(request);
    if (!identity) {
        reply.code(401).send(createError('Missing trusted forwarded identity', 'authentication_error', null, 'missing_trusted_identity'));
        return;
    }

    const { user, parentKey } = agentStore.ensureManagerUserProvisioned(identity);
    request.managerUser = user;
    request.apiKey = parentKey;
}

async function requireManagerAdmin(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    await managerHeaderAuth(request, reply);
    if ((reply as FastifyReply & { sent?: boolean }).sent) return;
    if (!request.managerUser?.is_admin) {
        reply.code(403).send(createError('Admin access required', 'authentication_error', null, 'admin_required'));
    }
}

// Generate agent key
function generateAgentKey(): string {
    return `${AGENT_KEY_PREFIX}${generateId('key')}`;
}

function formatParentKeyHint(key: string): string {
    return `ozw_...${getKeyHint(key)}`;
}

/** Normalize tools: plain strings become { name } objects */
function normalizeTools(tools: unknown): { name: string; [k: string]: unknown }[] {
    if (!Array.isArray(tools)) return [];
    return tools.map(t => typeof t === 'string' ? { name: t } : t as { name: string });
}

/** Extract YAML string from request body (string or {yaml} wrapper). Returns null if empty. */
function extractYamlInput(body: string | { yaml: string }): string | null {
    const raw = typeof body === 'string' ? body : body?.yaml;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    return raw;
}

interface ParsedAgentFields {
    name?: string;
    instructions?: string;
    model?: string;
    temperature?: number;
    tools?: unknown;
    behavior?: Record<string, unknown>;
    [k: string]: unknown;
}

type AdminMetricRow = {
    request_count?: number;
    error_count?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    last_used_at?: string | null;
};

type AdminParentKeyRow = AdminMetricRow & {
    id: string;
    name: string;
    key_hint: string | null;
    user_id: string | null;
    external_user_id?: string | null;
    username?: string | null;
    email?: string | null;
    status?: string | null;
    source?: string | null;
    revoked_at?: string | null;
    revoked_reason?: string | null;
    replaced_by_key_id?: string | null;
    created_at?: string | null;
    agent_count?: number;
};

type AdminAgentRow = AdminMetricRow & {
    id: string;
    agent_key: string;
    parent_key: string;
    yaml: string;
    created_at: number;
    parent_key_name?: string | null;
    parent_key_hint?: string | null;
    user_id?: string | null;
    external_user_id?: string | null;
    username?: string | null;
    email?: string | null;
};

type AdminUserRow = AdminMetricRow & {
    id: string;
    is_admin: number | boolean;
};

type ProviderModelSelectionBody = {
    provider?: unknown;
    model?: unknown;
};

function normalizeRestrictionBody(body: { allowed_models?: ProviderModelSelectionBody[] } | undefined) {
    return (body?.allowed_models || [])
        .filter(item => item && typeof item.provider === 'string')
        .map(item => ({
            provider: item.provider as string,
            model: typeof item.model === 'string' ? item.model : null,
        }));
}

function normalizeDefaultModel(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.provider !== 'string' || typeof record.model !== 'string') return null;
    return { provider: record.provider, model: record.model };
}

function defaultAllowedByRestrictions(defaultModel: { provider: string; model: string } | null, restrictions: ProviderModelSelection[]) {
    if (!defaultModel || restrictions.length === 0) return true;
    return restrictions.some(item => (
        item.provider === defaultModel.provider
        && (item.model === null || item.model === defaultModel.model)
    ));
}

/** Parse YAML into a loose object. Throws on invalid YAML. */
function parseAgentYaml(yamlInput: string): ParsedAgentFields {
    const parsed = yaml.parse(yamlInput);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('YAML must parse to an object');
    }
    return parsed as ParsedAgentFields;
}

/**
 * Parse YAML and enforce required fields. On failure, set reply.code and
 * return an error payload. On success, return the parsed fields.
 */
function parseAndValidate(
    yamlInput: string,
    reply: FastifyReply
): { parsed: ParsedAgentFields; error: null } | { parsed: null; error: ReturnType<typeof createError> } {
    let parsed: ParsedAgentFields;
    try {
        parsed = parseAgentYaml(yamlInput);
    } catch {
        reply.code(400);
        return { parsed: null, error: createError('Invalid YAML format', 'invalid_request_error') };
    }
    if (!parsed.name || typeof parsed.name !== 'string' || !parsed.name.trim()) {
        reply.code(400);
        return { parsed: null, error: createError("'name' is required", 'invalid_request_error') };
    }
    if (!parsed.instructions || typeof parsed.instructions !== 'string' || !parsed.instructions.trim()) {
        reply.code(400);
        return { parsed: null, error: createError("'instructions' is required", 'invalid_request_error') };
    }
    return { parsed, error: null };
}

/**
 * Build a JSON-friendly view of an agent row (parses YAML for convenience fields).
 * Throws on malformed stored YAML — callers wrap in try/catch returning 500.
 * Should not happen in practice: writes validate via parseAndValidate before insert.
 */
function toAgentView(agent: Agent) {
    const parsed = parseAgentYaml(agent.yaml);
    const policy = agentStore.getAgentModelPolicy(agent.id, agent.yaml);
    const defaultModel = policy.default_provider && policy.default_model
        ? { provider: policy.default_provider, model: policy.default_model }
        : null;
    return {
        agent_id: agent.id,
        key_hint: formatAgentKeyHint(agent.agent_key),
        created_at: agent.created_at,
        yaml: agent.yaml,
        name: parsed.name,
        instructions: parsed.instructions,
        provider: policy.default_provider,
        model: policy.default_model ?? parsed.model,
        default_model: defaultModel,
        model_policy_updated_at: policy.updated_at,
        model_policy_source: policy.source,
        temperature: parsed.temperature,
        tools: parsed.tools,
        behavior: parsed.behavior,
        metrics: agentStore.getAgentMetrics(agent.id),
    };
}

function toMetrics(row: AdminMetricRow) {
    return {
        request_count: row.request_count ?? 0,
        error_count: row.error_count ?? 0,
        prompt_tokens: row.prompt_tokens ?? 0,
        completion_tokens: row.completion_tokens ?? 0,
        total_tokens: row.total_tokens ?? 0,
        last_used_at: row.last_used_at ?? null,
    };
}

function metricDifference(totalRows: Array<{ metrics: ReturnType<typeof toMetrics> }>, attributedRows: Array<{ metrics: ReturnType<typeof toMetrics> }>) {
    const sum = (rows: Array<{ metrics: ReturnType<typeof toMetrics> }>) => rows.reduce((total, row) => ({
        request_count: total.request_count + row.metrics.request_count,
        error_count: total.error_count + row.metrics.error_count,
        prompt_tokens: total.prompt_tokens + row.metrics.prompt_tokens,
        completion_tokens: total.completion_tokens + row.metrics.completion_tokens,
        total_tokens: total.total_tokens + row.metrics.total_tokens,
    }), { request_count: 0, error_count: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    const total = sum(totalRows);
    const attributed = sum(attributedRows);
    return {
        request_count: Math.max(total.request_count - attributed.request_count, 0),
        error_count: Math.max(total.error_count - attributed.error_count, 0),
        prompt_tokens: Math.max(total.prompt_tokens - attributed.prompt_tokens, 0),
        completion_tokens: Math.max(total.completion_tokens - attributed.completion_tokens, 0),
        total_tokens: Math.max(total.total_tokens - attributed.total_tokens, 0),
        last_used_at: null,
    };
}

function toAdminAgentView(agent: AdminAgentRow) {
    let parsed: ParsedAgentFields = {};
    try {
        parsed = parseAgentYaml(agent.yaml);
    } catch {
        parsed = {};
    }
    const policy = agentStore.getAgentModelPolicy(agent.id, agent.yaml);
    const defaultModel = policy.default_provider && policy.default_model
        ? { provider: policy.default_provider, model: policy.default_model }
        : null;
    return {
        id: agent.id,
        key_hint: formatAgentKeyHint(agent.agent_key),
        parent_key_id: agent.parent_key,
        parent_key_name: agent.parent_key_name ?? null,
        parent_key_hint: agent.parent_key_hint ? `ozw_...${agent.parent_key_hint}` : null,
        user_id: agent.user_id ?? null,
        external_user_id: agent.external_user_id ?? null,
        username: agent.username ?? null,
        email: agent.email ?? null,
        name: parsed.name ?? null,
        provider: policy.default_provider,
        model: policy.default_model ?? parsed.model ?? null,
        default_model: defaultModel,
        model_policy_updated_at: policy.updated_at,
        model_policy_source: policy.source,
        created_at: agent.created_at,
        metrics: toMetrics(agent),
    };
}

function toAdminParentKeyView(key: AdminParentKeyRow) {
    return {
        id: key.id,
        name: key.name,
        key_hint: key.key_hint ? `ozw_...${key.key_hint}` : null,
        user_id: key.user_id ?? null,
        external_user_id: key.external_user_id ?? null,
        username: key.username ?? null,
        email: key.email ?? null,
        status: key.status ?? 'active',
        source: key.source ?? null,
        revoked_at: key.revoked_at ?? null,
        revoked_reason: key.revoked_reason ?? null,
        replaced_by_key_id: key.replaced_by_key_id ?? null,
        created_at: key.created_at,
        agent_count: key.agent_count ?? 0,
        metrics: toMetrics(key),
    };
}

function toAdminUserView(user: AdminUserRow, parentKeys: AdminParentKeyRow[]) {
    const formattedParentKeys = parentKeys
        .filter(key => key.user_id === user.id)
        .map(toAdminParentKeyView);
    const currentParentKey = formattedParentKeys.find(key => key.status === 'active' && !key.revoked_at) ?? null;
    return {
        ...user,
        is_admin: Boolean(user.is_admin),
        current_parent_key: currentParentKey,
        metrics: {
            request_count: user.request_count ?? 0,
            total_tokens: user.total_tokens ?? 0,
            last_used_at: user.last_used_at ?? null,
        },
    };
}

async function getManagerMe(request: FastifyRequest, reply: FastifyReply) {
    if (!trustedForwardAuthHeadersEnabled()) {
        reply.code(401);
        return createError('Trusted forwarded auth headers are disabled', 'authentication_error', null, 'trusted_headers_disabled');
    }

    const identity = readForwardedIdentity(request);
    if (!identity) {
        reply.code(401);
        return createError('Missing trusted forwarded identity', 'authentication_error', null, 'missing_trusted_identity');
    }

    const { user, parentKey } = agentStore.ensureManagerUserProvisioned(identity);

    reply.header('Cache-Control', 'no-store');
    return {
        identity: {
            id: user.id,
            external_user_id: user.external_user_id,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
        },
        status: user.status,
        is_admin: user.is_admin,
        has_parent_key: true,
        parent_key_id: parentKey.id,
        parent_key_hint: formatParentKeyHint(parentKey.key),
        provisioned: true,
    };
}

const agentsRoute: FastifyPluginAsync = async (fastify) => {
    // Accept raw YAML bodies (application/yaml, text/yaml)
    fastify.addContentTypeParser(['application/yaml', 'text/yaml'], { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
    });

    const authHeaders = {
        type: 'object',
        properties: { authorization: { type: 'string' } },
        required: ['authorization']
    };

    const agentIdParam = {
        type: 'object',
        properties: { agent_id: { type: 'string' } },
        required: ['agent_id']
    };

    type AgentParams = { agent_id: string };
    type AgentBody = string | { yaml: string };

    async function listAgentsForCurrentKey(request: FastifyRequest, reply: FastifyReply) {
        const parentKey = request.apiKey!.id;

        try {
            const agents = agentStore.listByParent(parentKey);
            return {
                object: 'list',
                data: agents.map(a => {
                    const view = toAgentView(a);
                    return {
                        id: view.agent_id,
                        key_hint: view.key_hint,
                        name: view.name,
                        provider: view.provider,
                        model: view.model,
                        default_model: view.default_model,
                        model_policy_updated_at: view.model_policy_updated_at,
                        model_policy_source: view.model_policy_source,
                        tools: view.tools,
                        behavior: view.behavior,
                        created_at: view.created_at,
                        metrics: view.metrics,
                    };
                }),
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Failed to list agents', 'server_error');
        }
    }

    async function createAgentForCurrentKey(request: FastifyRequest<{ Body: AgentBody }>, reply: FastifyReply) {
        const parentKey = request.apiKey!.id;

        try {
            const yamlInput = extractYamlInput(request.body);
            if (!yamlInput) {
                reply.code(400);
                return createError("'yaml' field is required", 'invalid_request_error');
            }

            const validation = parseAndValidate(yamlInput, reply);
            if (validation.error) return validation.error;

            const agent = agentStore.createAgent({
                id: generateId('agent'),
                agent_key: generateAgentKey(),
                parent_key: parentKey,
                yaml: yamlInput,
            });

            reply.code(201);
            reply.header('Cache-Control', 'no-store');
            return {
                agent_id: agent.id,
                agent_key: agent.agent_key,
                key_hint: formatAgentKeyHint(agent.agent_key),
                created_at: agent.created_at,
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Agent registration failed', 'server_error');
        }
    }

    async function getAgentForCurrentKey(request: FastifyRequest<{ Params: AgentParams }>, reply: FastifyReply) {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        try {
            const agent = agentStore.getOwned(agent_id, parentKey);
            if (!agent) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }
            return toAgentView(agent);
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Failed to retrieve agent', 'server_error');
        }
    }

    async function updateAgentForCurrentKey(request: FastifyRequest<{ Params: AgentParams; Body: AgentBody }>, reply: FastifyReply) {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        try {
            const yamlInput = extractYamlInput(request.body);
            if (!yamlInput) {
                reply.code(400);
                return createError("'yaml' field is required", 'invalid_request_error');
            }

            const validation = parseAndValidate(yamlInput, reply);
            if (validation.error) return validation.error;

            const updated = agentStore.updateAgent(agent_id, parentKey, yamlInput);
            if (!updated) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }

            return { ...toAgentView(updated), updated: true };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Agent update failed', 'server_error');
        }
    }

    async function revealAgentKeyForCurrentKey(request: FastifyRequest<{ Params: AgentParams }>, reply: FastifyReply) {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        const agent = agentStore.getOwned(agent_id, parentKey);
        if (!agent) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error');
        }

        reply.header('Cache-Control', 'no-store');
        fastify.log.info({ agentId: agent_id, parentKeyId: parentKey }, 'agent_key revealed');
        return {
            agent_id: agent.id,
            agent_key: agent.agent_key,
            key_hint: formatAgentKeyHint(agent.agent_key),
        };
    }

    async function rotateAgentKeyForCurrentKey(request: FastifyRequest<{ Params: AgentParams }>, reply: FastifyReply) {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        const newKey = generateAgentKey();
        const updated = agentStore.rotateKey(agent_id, parentKey, newKey);
        if (!updated) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error');
        }

        reply.header('Cache-Control', 'no-store');
        fastify.log.info({ agentId: agent_id, parentKeyId: parentKey }, 'agent_key rotated');
        return {
            agent_id: updated.id,
            agent_key: newKey,
            key_hint: formatAgentKeyHint(newKey),
            rotated_at: Math.floor(Date.now() / 1000),
        };
    }

    async function deleteAgentForCurrentKey(request: FastifyRequest<{ Params: AgentParams }>, reply: FastifyReply) {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        try {
            const deleted = agentStore.deleteAgent(agent_id, parentKey);
            if (!deleted) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }

            reply.code(200);
            return { id: agent_id, deleted: true };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Agent deletion failed', 'server_error');
        }
    }

    // GET /v1/manager/me — trusted manager-console identity bridge.
    fastify.get('/v1/manager/me', {
        schema: { tags: ['Manager Auth'], summary: 'Get manager-console authenticated user status' },
    }, getManagerMe);

    // GET /v1/manager/models — model list through manager-console auth.
    fastify.get('/v1/manager/models', {
        schema: { tags: ['Manager Auth'], summary: 'List models for manager-console authenticated UI' },
        preHandler: managerHeaderAuth,
    }, async () => {
        return getModelsList();
    });

    // Basic admin console endpoints. Admin status comes from Ozwell DB, not x-groups.
    fastify.get('/v1/manager/admin/summary', {
        schema: { tags: ['Manager Admin'], summary: 'Get admin console summary metrics' },
        preHandler: requireManagerAdmin,
    }, async () => {
        return agentStore.getAdminSummary();
    });

    fastify.get('/v1/manager/admin/users', {
        schema: { tags: ['Manager Admin'], summary: 'List manager users' },
        preHandler: requireManagerAdmin,
    }, async () => {
        const users = agentStore.listAdminUsers() as AdminUserRow[];
        const parentKeys = agentStore.listAdminParentKeys() as AdminParentKeyRow[];
        return {
            object: 'list',
            data: users.map(user => toAdminUserView(user, parentKeys)),
        };
    });

    fastify.get<{ Params: { user_id: string } }>('/v1/manager/admin/users/:user_id', {
        schema: {
            tags: ['Manager Admin'],
            summary: 'Get manager user detail',
            params: {
                type: 'object',
                properties: { user_id: { type: 'string' } },
                required: ['user_id'],
            },
        },
        preHandler: requireManagerAdmin,
    }, async (request, reply) => {
        const detail = agentStore.getAdminUserDetail(request.params.user_id);
        if (!detail) {
            reply.code(404);
            return createError('User not found', 'invalid_request_error', 'user_id', 'not_found');
        }
        const parentKeys = (detail.parent_keys as AdminParentKeyRow[]).map(toAdminParentKeyView);
        const agents = (detail.agents as unknown as AdminAgentRow[]).map(toAdminAgentView);
        return {
            user: {
                ...(detail.user as Record<string, unknown>),
                is_admin: Boolean((detail.user as { is_admin?: number }).is_admin),
            },
            parent_keys: parentKeys,
            agents,
            unattributed_usage: metricDifference(parentKeys, agents),
        };
    });

    fastify.post<{ Params: { user_id: string } }>('/v1/manager/admin/users/:user_id/promote', {
        schema: {
            tags: ['Manager Admin'],
            summary: 'Promote user to manager admin',
            params: {
                type: 'object',
                properties: { user_id: { type: 'string' } },
                required: ['user_id'],
            },
        },
        preHandler: requireManagerAdmin,
    }, async (request, reply) => {
        const user = agentStore.promoteManagerUser(request.params.user_id);
        if (!user) {
            reply.code(404);
            return createError('User not found', 'invalid_request_error', 'user_id', 'not_found');
        }
        return user;
    });

    fastify.post<{ Params: { user_id: string } }>('/v1/manager/admin/users/:user_id/demote', {
        schema: {
            tags: ['Manager Admin'],
            summary: 'Demote manager admin user',
            params: {
                type: 'object',
                properties: { user_id: { type: 'string' } },
                required: ['user_id'],
            },
        },
        preHandler: requireManagerAdmin,
    }, async (request, reply) => {
        try {
            const user = agentStore.demoteManagerUser(request.managerUser!.id, request.params.user_id);
            if (!user) {
                reply.code(404);
                return createError('User not found', 'invalid_request_error', 'user_id', 'not_found');
            }
            return user;
        } catch (error) {
            const code = error instanceof Error ? error.message : 'demote_failed';
            reply.code(code === 'cannot_remove_last_admin' ? 409 : 400);
            return createError('User cannot be demoted', 'invalid_request_error', 'user_id', code);
        }
    });

    fastify.post<{ Params: { key_id: string }; Body: { reason?: string } }>('/v1/manager/admin/parent-keys/:key_id/revoke', {
        schema: {
            tags: ['Manager Admin'],
            summary: 'Revoke a parent key',
            params: {
                type: 'object',
                properties: { key_id: { type: 'string' } },
                required: ['key_id'],
            },
            body: {
                type: 'object',
                properties: { reason: { type: 'string' } },
            },
        },
        preHandler: requireManagerAdmin,
    }, async (request, reply) => {
        const key = agentStore.revokeParentApiKey(request.params.key_id, request.body?.reason || 'admin_revoked');
        if (!key) {
            reply.code(404);
            return createError('Parent key not found', 'invalid_request_error', 'key_id', 'not_found');
        }
        return {
            id: key.id,
            status: key.status,
            revoked_at: key.revoked_at,
            revoked_reason: key.revoked_reason,
        };
    });

    fastify.get<{ Params: { key_id: string } }>('/v1/manager/admin/parent-keys/:key_id/model-restrictions', {
        schema: {
            tags: ['Manager Admin'],
            summary: 'Get parent-key provider/model restrictions',
            params: {
                type: 'object',
                properties: { key_id: { type: 'string' } },
                required: ['key_id'],
            },
        },
        preHandler: requireManagerAdmin,
    }, async (request) => {
        getCachedModelsList();
        return {
            parent_key_id: request.params.key_id,
            allowed_models: agentStore.getParentKeyModelRestrictions(request.params.key_id),
            effective_models: agentStore.listEffectiveProviderModels(request.params.key_id),
        };
    });

    fastify.put<{ Params: { key_id: string }; Body: { allowed_models?: ProviderModelSelectionBody[] } }>('/v1/manager/admin/parent-keys/:key_id/model-restrictions', {
        schema: {
            tags: ['Manager Admin'],
            summary: 'Update parent-key provider/model restrictions',
            params: {
                type: 'object',
                properties: { key_id: { type: 'string' } },
                required: ['key_id'],
            },
            body: {
                type: 'object',
                properties: {
                    allowed_models: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                provider: { type: 'string' },
                                model: { type: 'string' },
                            },
                            required: ['provider'],
                        },
                    },
                },
            },
        },
        preHandler: requireManagerAdmin,
    }, async (request) => {
        getCachedModelsList();
        const allowedModels = agentStore.setParentKeyModelRestrictions(
            request.params.key_id,
            normalizeRestrictionBody(request.body),
        );
        return {
            parent_key_id: request.params.key_id,
            allowed_models: allowedModels,
            effective_models: agentStore.listEffectiveProviderModels(request.params.key_id),
        };
    });

    // POST /v1/manager/parent-key/reveal — explicit reveal for the user's parent key.
    fastify.post('/v1/manager/parent-key/reveal', {
        schema: { tags: ['Manager Auth'], summary: 'Reveal active manager parent key' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
        const parentKey = agentStore.getActiveApiKeyForUser(request.managerUser!.id)!;
        reply.header('Cache-Control', 'no-store');
        return {
            parent_key_id: parentKey.id,
            parent_key: parentKey.key,
            parent_key_hint: formatParentKeyHint(parentKey.key),
        };
    });

    // POST /v1/manager/claim-key — claim an existing parent key and migrate temporary agents.
    fastify.post<{ Body: { parent_key?: string } }>('/v1/manager/claim-key', {
        schema: {
            tags: ['Manager Auth'],
            summary: 'Claim an existing parent key for the manager-console user',
            body: {
                type: 'object',
                properties: { parent_key: { type: 'string' } },
                required: ['parent_key'],
            },
        },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
        const parentKey = request.body?.parent_key;
        if (!parentKey || !isValidApiKey(parentKey)) {
            reply.code(400);
            return createError('A valid parent key is required', 'invalid_request_error', 'parent_key', 'invalid_parent_key');
        }

        try {
            const result = agentStore.claimParentApiKey(request.managerUser!.id, parentKey);
            reply.header('Cache-Control', 'no-store');
            return {
                parent_key_id: result.parentKey.id,
                parent_key_hint: formatParentKeyHint(result.parentKey.key),
                migrated_agents: result.migratedAgents,
                revoked_parent_key_id: result.revokedParentKeyId,
            };
        } catch (error) {
            const code = error instanceof Error ? error.message : 'claim_failed';
            if (code === 'parent_key_already_claimed') {
                reply.code(409);
                return createError('Parent key is already claimed by another user', 'invalid_request_error', 'parent_key', code);
            }
            if (code === 'parent_key_not_found') {
                reply.code(404);
                return createError('Parent key not found', 'invalid_request_error', 'parent_key', code);
            }
            fastify.log.error(error);
            reply.code(500);
            return createError('Parent key claim failed', 'server_error');
        }
    });

    fastify.get('/v1/manager/notifications', {
        schema: { tags: ['Manager Auth'], summary: 'List manager-console notifications' },
        preHandler: managerHeaderAuth,
    }, async (request) => {
        const notifications = agentStore.listNotificationsForUser(request.managerUser!.id);
        return {
            object: 'list',
            unread_count: notifications.filter(item => !item.read_at).length,
            data: notifications,
        };
    });

    fastify.post('/v1/manager/notifications/read-all', {
        schema: { tags: ['Manager Auth'], summary: 'Mark manager-console notifications read' },
        preHandler: managerHeaderAuth,
    }, async (request) => {
        return { updated: agentStore.markAllNotificationsRead(request.managerUser!.id) };
    });

    fastify.post<{ Params: { notification_id: string } }>('/v1/manager/notifications/:notification_id/read', {
        schema: {
            tags: ['Manager Auth'],
            summary: 'Mark one manager-console notification read',
            params: {
                type: 'object',
                properties: { notification_id: { type: 'string' } },
                required: ['notification_id'],
            },
        },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
        const notification = agentStore.markNotificationRead(request.managerUser!.id, request.params.notification_id);
        if (!notification) {
            reply.code(404);
            return createError('Notification not found', 'invalid_request_error', 'notification_id', 'not_found');
        }
        return notification;
    });

    // GET /v1/keys/validate — lightweight auth check, accepts both ozw_ and agnt_key-
    fastify.get('/v1/keys/validate', {
        schema: {
            headers: authHeaders,
            tags: ['Keys'],
            summary: 'Validate an API key (parent or agent)',
            response: {
                200: {
                    type: 'object',
                    properties: { valid: { type: 'boolean' } },
                    required: ['valid']
                }
            }
        },
    }, async (request, reply) => {
        const authorization = request.headers.authorization;
        if (!authorization || !/^bearer\s+/i.test(authorization)) {
            reply.code(401);
            return createError('Authorization header must use Bearer scheme', 'authentication_error', null, 'missing_api_key');
        }

        const token = extractToken(authorization);
        if (!token || !agentStore.validateKey(token)) {
            reply.code(401);
            return createError('Invalid API key', 'authentication_error', null, 'invalid_api_key');
        }

        return { valid: true };
    });

    // POST /v1/agents (register agent)
    fastify.post<{ Body: string | { yaml: string } }>('/v1/agents', {
        schema: {
            headers: authHeaders,
            tags: ['Agents'],
            summary: 'Create a new agent',
            consumes: ['application/yaml', 'application/json'],
            body: {
                oneOf: [
                    { type: 'string', description: 'Raw YAML agent definition (application/yaml)' },
                    {
                        type: 'object',
                        description: 'JSON wrapper with yaml field (application/json)',
                        properties: {
                            yaml: { type: 'string', description: 'YAML agent definition string' }
                        },
                        required: ['yaml']
                    }
                ]
            }
        },
        preHandler: apiKeyAuth
    }, createAgentForCurrentKey);

    // GET /v1/agents/me — agent key self-lookup (used by embed loader to discover tools)
    fastify.get('/v1/agents/me', {
        schema: { tags: ['Agents'], summary: 'Get own agent config (agent key auth)' },
    }, async (request, reply) => {
        if (!isAgentKey(request.headers.authorization)) {
            reply.code(401);
            return createError('Requires an agent key (agnt_key-...)', 'authentication_error', null, 'invalid_api_key');
        }

        const agentKey = extractToken(request.headers.authorization);
        const agent = agentStore.getByKey(agentKey);
        if (!agent) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error', null, 'not_found');
        }

        try {
            const parsed = parseAgentYaml(agent.yaml);
            return {
                id: agent.id,
                name: parsed.name,
                model: parsed.model,
                tools: normalizeTools(parsed.tools),
            };
        } catch (error) {
            fastify.log.error({ err: error, agentId: agent.id }, 'agent yaml parse failed');
            reply.code(500);
            return createError('Failed to parse agent', 'server_error');
        }
    });

    // GET /v1/agents (list agents)
    fastify.get('/v1/agents', {
        schema: { headers: authHeaders, tags: ['Agents'], summary: 'List all agents' },
        preHandler: apiKeyAuth
    }, listAgentsForCurrentKey);

    // GET /v1/manager/agents (list agents using trusted manager-console auth)
    fastify.get('/v1/manager/agents', {
        schema: { tags: ['Manager Agents'], summary: 'List manager-authenticated user agents' },
        preHandler: managerHeaderAuth,
    }, listAgentsForCurrentKey);

    // POST /v1/manager/agents (create agent using trusted manager-console auth)
    fastify.post<{ Body: string | { yaml: string } }>('/v1/manager/agents', {
        schema: {
            tags: ['Manager Agents'],
            summary: 'Create manager-authenticated user agent',
            consumes: ['application/yaml', 'application/json'],
        },
        preHandler: managerHeaderAuth,
    }, createAgentForCurrentKey);

    fastify.get<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id/model-policy', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Get agent provider/model policy' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        const agent = agentStore.getOwned(request.params.agent_id, parentKey);
        if (!agent) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error');
        }
        getCachedModelsList();
        const policy = agentStore.getAgentModelPolicy(agent.id, agent.yaml);
        return {
            agent_id: agent.id,
            default_model: policy.default_provider && policy.default_model
                ? { provider: policy.default_provider, model: policy.default_model }
                : null,
            allowed_models: policy.allowed_models,
            model_policy_updated_at: policy.updated_at,
            source: policy.source,
            effective_models: agentStore.listEffectiveProviderModelsForAgent(parentKey, agent.id, agent.yaml),
        };
    });

    fastify.put<{
        Params: { agent_id: string };
        Body: { default_model?: unknown; allowed_models?: ProviderModelSelectionBody[] };
    }>('/v1/manager/agents/:agent_id/model-policy', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Update agent provider/model policy' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        getCachedModelsList();
        const defaultModel = normalizeDefaultModel(request.body?.default_model);
        const allowedModels = normalizeRestrictionBody(request.body);
        if (!defaultAllowedByRestrictions(defaultModel, allowedModels)) {
            reply.code(400);
            return createError(
                'Default model must be included in allowed_models when allowed_models is not empty',
                'invalid_request_error',
                'default_model',
                'default_model_not_allowed'
            );
        }
        const policy = agentStore.setAgentModelPolicy(
            request.params.agent_id,
            parentKey,
            defaultModel,
            allowedModels,
        );
        if (!policy) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error');
        }
        return {
            agent_id: request.params.agent_id,
            default_model: policy.default_provider && policy.default_model
                ? { provider: policy.default_provider, model: policy.default_model }
                : null,
            allowed_models: policy.allowed_models,
            model_policy_updated_at: policy.updated_at,
            source: policy.source,
            effective_models: agentStore.listEffectiveProviderModelsForAgent(parentKey, request.params.agent_id),
        };
    });

    // GET /v1/manager/agents/:agent_id (get specific manager-authenticated user agent)
    fastify.get<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Get manager-authenticated user agent details' },
        preHandler: managerHeaderAuth,
    }, getAgentForCurrentKey);

    // PUT /v1/manager/agents/:agent_id (update manager-authenticated user agent)
    fastify.put<{ Params: { agent_id: string }; Body: string | { yaml: string } }>('/v1/manager/agents/:agent_id', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Update manager-authenticated user agent' },
        preHandler: managerHeaderAuth,
    }, updateAgentForCurrentKey);

    // POST /v1/manager/agents/:agent_id/reveal-key (return full agent_key)
    fastify.post<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id/reveal-key', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Reveal manager-authenticated user agent key' },
        preHandler: managerHeaderAuth,
    }, revealAgentKeyForCurrentKey);

    // POST /v1/manager/agents/:agent_id/rotate-key (generate new key)
    fastify.post<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id/rotate-key', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Rotate manager-authenticated user agent key' },
        preHandler: managerHeaderAuth,
    }, rotateAgentKeyForCurrentKey);

    // DELETE /v1/manager/agents/:agent_id (delete manager-authenticated user agent)
    fastify.delete<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Delete manager-authenticated user agent' },
        preHandler: managerHeaderAuth,
    }, deleteAgentForCurrentKey);

    // GET /v1/agents/:agent_id (get specific agent)
    fastify.get<{ Params: { agent_id: string } }>('/v1/agents/:agent_id', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Get agent details' },
        preHandler: apiKeyAuth,
    }, getAgentForCurrentKey);

    // PUT /v1/agents/:agent_id (update agent)
    fastify.put<{ Params: { agent_id: string }; Body: string | { yaml: string } }>('/v1/agents/:agent_id', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Update an agent' },
        preHandler: apiKeyAuth
    }, updateAgentForCurrentKey);

    // POST /v1/agents/:agent_id/reveal-key (return full agent_key — explicit user action)
    fastify.post<{ Params: { agent_id: string } }>('/v1/agents/:agent_id/reveal-key', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Reveal full agent key (parent key auth required)' },
        preHandler: apiKeyAuth
    }, revealAgentKeyForCurrentKey);

    // POST /v1/agents/:agent_id/rotate-key (generate new key, invalidate old)
    fastify.post<{ Params: { agent_id: string } }>('/v1/agents/:agent_id/rotate-key', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Rotate agent key (invalidates old key)' },
        preHandler: apiKeyAuth
    }, rotateAgentKeyForCurrentKey);

    // DELETE /v1/agents/:agent_id (delete agent)
    fastify.delete<{ Params: { agent_id: string } }>('/v1/agents/:agent_id', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Delete an agent' },
        preHandler: apiKeyAuth
    }, deleteAgentForCurrentKey);
};

export default agentsRoute;
