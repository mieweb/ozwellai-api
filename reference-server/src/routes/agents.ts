import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createError, generateId, isValidApiKey, extractToken, isAgentKey, AGENT_KEY_PREFIX, formatAgentKeyHint } from '../util';
import * as yaml from 'yaml';
import { agentStore, Agent, ManagerIdentity, ManagerUser } from '../storage/agents';

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

function readForwardedIdentity(request: FastifyRequest): ManagerIdentity | null {
    const externalUserId = readHeader(request, 'x-user-id');
    if (!externalUserId) return null;
    return {
        external_user_id: externalUserId,
        username: readHeader(request, 'x-username'),
        first_name: readHeader(request, 'x-user-first-name'),
        last_name: readHeader(request, 'x-user-last-name'),
        email: readHeader(request, 'x-email'),
        groups: readHeader(request, 'x-groups'),
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

    const user = agentStore.upsertManagerUser(identity);
    request.managerUser = user;

    if (user.status !== 'active') {
        reply.code(403).send(createError('User is not provisioned for Ozwell agent management', 'permission_error', null, 'user_not_provisioned'));
        return;
    }

    const apiKey = agentStore.getActiveApiKeyForUser(user.id);
    if (!apiKey) {
        reply.code(403).send(createError('User does not have an active parent key', 'permission_error', null, 'parent_key_required'));
        return;
    }

    request.apiKey = apiKey;
}

// Generate agent key
function generateAgentKey(): string {
    return `${AGENT_KEY_PREFIX}${generateId('key')}`;
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
    return {
        agent_id: agent.id,
        key_hint: formatAgentKeyHint(agent.agent_key),
        created_at: agent.created_at,
        yaml: agent.yaml,
        name: parsed.name,
        instructions: parsed.instructions,
        model: parsed.model,
        temperature: parsed.temperature,
        tools: parsed.tools,
        behavior: parsed.behavior,
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

    // GET /v1/me — trusted manager-console identity bridge.
    fastify.get('/v1/me', {
        schema: { tags: ['Manager Auth'], summary: 'Get manager-console authenticated user status' },
    }, async (request, reply) => {
        if (!trustedForwardAuthHeadersEnabled()) {
            reply.code(401);
            return createError('Trusted forwarded auth headers are disabled', 'authentication_error', null, 'trusted_headers_disabled');
        }

        const identity = readForwardedIdentity(request);
        if (!identity) {
            reply.code(401);
            return createError('Missing trusted forwarded identity', 'authentication_error', null, 'missing_trusted_identity');
        }

        const user = agentStore.upsertManagerUser(identity);
        const apiKey = agentStore.getActiveApiKeyForUser(user.id);
        const hasParentKey = Boolean(apiKey);

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
            has_parent_key: hasParentKey,
            provisioned: user.status === 'active' && hasParentKey,
        };
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
    }, async (request, reply) => {
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
    });

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
    }, async (request, reply) => {
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
                        model: view.model,
                        tools: view.tools,
                        behavior: view.behavior,
                        created_at: view.created_at,
                    };
                }),
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Failed to list agents', 'server_error');
        }
    });

    // GET /v1/manager/agents (list agents using trusted manager-console auth)
    fastify.get('/v1/manager/agents', {
        schema: { tags: ['Manager Agents'], summary: 'List manager-authenticated user agents' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
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
                        model: view.model,
                        tools: view.tools,
                        behavior: view.behavior,
                        created_at: view.created_at,
                    };
                }),
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Failed to list agents', 'server_error');
        }
    });

    // POST /v1/manager/agents (create agent using trusted manager-console auth)
    fastify.post<{ Body: string | { yaml: string } }>('/v1/manager/agents', {
        schema: {
            tags: ['Manager Agents'],
            summary: 'Create manager-authenticated user agent',
            consumes: ['application/yaml', 'application/json'],
        },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
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
    });

    // GET /v1/manager/agents/:agent_id (get specific manager-authenticated user agent)
    fastify.get<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Get manager-authenticated user agent details' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
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
    });

    // PUT /v1/manager/agents/:agent_id (update manager-authenticated user agent)
    fastify.put<{ Params: { agent_id: string }; Body: string | { yaml: string } }>('/v1/manager/agents/:agent_id', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Update manager-authenticated user agent' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
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
    });

    // POST /v1/manager/agents/:agent_id/reveal-key (return full agent_key)
    fastify.post<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id/reveal-key', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Reveal manager-authenticated user agent key' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        const agent = agentStore.getOwned(agent_id, parentKey);
        if (!agent) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error');
        }

        reply.header('Cache-Control', 'no-store');
        fastify.log.info({ agentId: agent_id, parentKeyId: request.apiKey!.id }, 'manager agent_key revealed');
        return {
            agent_id: agent.id,
            agent_key: agent.agent_key,
            key_hint: formatAgentKeyHint(agent.agent_key),
        };
    });

    // POST /v1/manager/agents/:agent_id/rotate-key (generate new key)
    fastify.post<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id/rotate-key', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Rotate manager-authenticated user agent key' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        const newKey = generateAgentKey();
        const updated = agentStore.rotateKey(agent_id, parentKey, newKey);
        if (!updated) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error');
        }

        reply.header('Cache-Control', 'no-store');
        fastify.log.info({ agentId: agent_id, parentKeyId: request.apiKey!.id }, 'manager agent_key rotated');
        return {
            agent_id: updated.id,
            agent_key: newKey,
            key_hint: formatAgentKeyHint(newKey),
            rotated_at: Math.floor(Date.now() / 1000),
        };
    });

    // DELETE /v1/manager/agents/:agent_id (delete manager-authenticated user agent)
    fastify.delete<{ Params: { agent_id: string } }>('/v1/manager/agents/:agent_id', {
        schema: { params: agentIdParam, tags: ['Manager Agents'], summary: 'Delete manager-authenticated user agent' },
        preHandler: managerHeaderAuth,
    }, async (request, reply) => {
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
    });

    // GET /v1/agents/:agent_id (get specific agent)
    fastify.get<{ Params: { agent_id: string } }>('/v1/agents/:agent_id', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Get agent details' },
        preHandler: apiKeyAuth,
    }, async (request, reply) => {
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
    });

    // PUT /v1/agents/:agent_id (update agent)
    fastify.put<{ Params: { agent_id: string }; Body: string | { yaml: string } }>('/v1/agents/:agent_id', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Update an agent' },
        preHandler: apiKeyAuth
    }, async (request, reply) => {
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
    });

    // POST /v1/agents/:agent_id/reveal-key (return full agent_key — explicit user action)
    fastify.post<{ Params: { agent_id: string } }>('/v1/agents/:agent_id/reveal-key', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Reveal full agent key (parent key auth required)' },
        preHandler: apiKeyAuth
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        const agent = agentStore.getOwned(agent_id, parentKey);
        if (!agent) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error');
        }

        reply.header('Cache-Control', 'no-store');
        fastify.log.info({ agentId: agent_id, parentKeyId: request.apiKey!.id }, 'agent_key revealed');
        return {
            agent_id: agent.id,
            agent_key: agent.agent_key,
            key_hint: formatAgentKeyHint(agent.agent_key),
        };
    });

    // POST /v1/agents/:agent_id/rotate-key (generate new key, invalidate old)
    fastify.post<{ Params: { agent_id: string } }>('/v1/agents/:agent_id/rotate-key', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Rotate agent key (invalidates old key)' },
        preHandler: apiKeyAuth
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        const newKey = generateAgentKey();
        const updated = agentStore.rotateKey(agent_id, parentKey, newKey);
        if (!updated) {
            reply.code(404);
            return createError('Agent not found', 'invalid_request_error');
        }

        reply.header('Cache-Control', 'no-store');
        fastify.log.info({ agentId: agent_id, parentKeyId: request.apiKey!.id }, 'agent_key rotated');
        return {
            agent_id: updated.id,
            agent_key: newKey,
            key_hint: formatAgentKeyHint(newKey),
            rotated_at: Math.floor(Date.now() / 1000),
        };
    });

    // DELETE /v1/agents/:agent_id (delete agent)
    fastify.delete<{ Params: { agent_id: string } }>('/v1/agents/:agent_id', {
        schema: { headers: authHeaders, params: agentIdParam, tags: ['Agents'], summary: 'Delete an agent' },
        preHandler: apiKeyAuth
    }, async (request, reply) => {
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
    });
};

export default agentsRoute;
