import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createError, generateId, isValidApiKey, extractToken, isAgentKey, AGENT_KEY_PREFIX } from '../util';
import * as yaml from 'yaml';
import { agentStore } from '../storage/agents';

// Extend FastifyRequest to include auth data
declare module 'fastify' {
    interface FastifyRequest {
        apiKey?: {
            id: string;
            name: string;
        };
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

// Generate agent key
function generateAgentKey(): string {
    return `${AGENT_KEY_PREFIX}${generateId('key')}`;
}

/** Normalize tools: plain strings become { name } objects */
function normalizeTools(tools: unknown[] | undefined): { name: string; [k: string]: unknown }[] {
    if (!tools) return [];
    return tools.map(t => typeof t === 'string' ? { name: t } : t as { name: string });
}

/** Extract and validate YAML input from request body */
function extractYamlInput(body: string | { yaml: string }): string | null {
    const raw = typeof body === 'string' ? body : body?.yaml;
    return raw?.trim() || null;
}

// Parse YAML input into structured fields
function parseYamlInput(yamlInput: string, fallbackName?: string) {
    const parsed = yaml.parse(yamlInput);
    const name = parsed.name || fallbackName || 'Unnamed Agent';
    const instructions = parsed.instructions || '';
    const model = parsed.model as string | undefined;
    const temperature = parsed.temperature as number | undefined;
    const tools = parsed.tools as (string | { name: string; description?: string; inputSchema?: Record<string, unknown>; parameters?: Record<string, unknown> })[] | undefined;
    const behavior = parsed.behavior as Record<string, unknown> | undefined;

    return { name, instructions, model, temperature, tools, behavior };
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

            let agent;
            try {
                const fields = parseYamlInput(yamlInput);
                const agentId = generateId('agent');
                const agentKey = generateAgentKey();

                agent = agentStore.createAgent({
                    id: agentId,
                    agent_key: agentKey,
                    parent_key: parentKey,
                    ...fields,
                });
            } catch {
                reply.code(400);
                return createError('Invalid YAML format', 'invalid_request_error');
            }

            reply.code(201);
            return {
                agent_id: agent.id,
                agent_key: agent.agent_key,
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

        return {
            id: agent.id,
            name: agent.name,
            model: agent.model,
            tools: normalizeTools(agent.tools),
        };
    });

    // GET /v1/agents (list agents)
    fastify.get('/v1/agents', {
        schema: { headers: authHeaders, tags: ['Agents'], summary: 'List all agents' },
        preHandler: apiKeyAuth
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;

        try {
            const agentRows = agentStore.listByParent(parentKey);

            return {
                object: 'list',
                data: agentRows.map(a => ({
                    id: a.id,
                    agent_key: a.agent_key,
                    name: a.name,
                    model: a.model,
                    tools: a.tools,
                    behavior: a.behavior,
                    created_at: a.created_at,
                })),
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Failed to list agents', 'server_error');
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

            return {
                agent_id: agent.id,
                created_at: agent.created_at,
                name: agent.name,
                instructions: agent.instructions,
                model: agent.model,
                temperature: agent.temperature,
                tools: agent.tools,
                behavior: agent.behavior,
            };
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

            let updated;
            try {
                const fields = parseYamlInput(yamlInput);
                updated = agentStore.updateAgent(agent_id, parentKey, fields);
            } catch {
                reply.code(400);
                return createError('Invalid YAML format', 'invalid_request_error');
            }

            if (!updated) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }

            return {
                agent_id: updated.id,
                agent_key: updated.agent_key,
                name: updated.name,
                model: updated.model,
                tools: updated.tools,
                behavior: updated.behavior,
                updated: true,
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Agent update failed', 'server_error');
        }
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
