import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createError, generateId, isValidApiKey } from '../util';
import * as yaml from 'yaml';
import { agentStore } from '../storage/agents';
import { getDatabase } from '../db/init-auth';

// Extend FastifyRequest to include auth data
declare module 'fastify' {
    interface FastifyRequest {
        apiKey?: {
            id: string;
            name: string;
        };
    }
}

interface ApiKeyRow {
    id: string;
    name: string;
}

/**
 * API Key authentication preHandler
 * Validates parent keys (ozw_ prefix) via plaintext lookup.
 */
async function apiKeyAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        reply.code(401).send({ error: { message: 'Missing API key', code: 'missing_api_key' } });
        return;
    }

    const token = authHeader.slice(7);

    if (!isValidApiKey(token)) {
        reply.code(401).send({ error: { message: 'Invalid API key format', code: 'invalid_api_key' } });
        return;
    }

    const db = getDatabase();
    const apiKey = db.prepare('SELECT id, name FROM api_keys WHERE key = ?').get(token) as ApiKeyRow | undefined;

    if (!apiKey) {
        reply.code(401).send({ error: { message: 'Invalid API key', code: 'invalid_api_key' } });
        return;
    }

    request.apiKey = apiKey;
}

// Parse markdown to extract YAML front matter
export function parseMarkdownFrontMatter(markdown: string): { frontMatter: Record<string, unknown> | null; content: string } {
    const yamlMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (yamlMatch) {
        try {
            return { frontMatter: yaml.parse(yamlMatch[1]), content: yamlMatch[2].trim() };
        } catch {
            return { frontMatter: null, content: markdown };
        }
    }
    return { frontMatter: null, content: markdown };
}

// Generate agent key
function generateAgentKey(): string {
    return `agnt_${generateId('key')}`;
}

// Parse YAML input into structured fields and markdown with front matter
function parseYamlInput(yamlInput: string, fallbackName?: string) {
    const parsed = yaml.parse(yamlInput);
    const name = parsed.name || fallbackName || 'Unnamed Agent';
    const instructions = parsed.instructions || '';
    const model = parsed.model as string | undefined;
    const temperature = parsed.temperature as number | undefined;
    const tools = parsed.tools as string[] | undefined;
    const behavior = parsed.behavior as Record<string, unknown> | undefined;

    // Construct markdown with YAML front matter
    const frontMatter: Record<string, unknown> = { name };
    if (parsed.description) frontMatter.description = parsed.description;
    if (model) frontMatter.model = model;
    if (temperature !== undefined) frontMatter.temperature = temperature;
    if (tools) frontMatter.tools = tools;
    if (behavior) frontMatter.behavior = behavior;

    const yamlStr = yaml.stringify(frontMatter);
    const markdown = `---\n${yamlStr}---\n\n${instructions}`;

    return { name, instructions, model, temperature, tools, behavior, markdown };
}

const agentsRoute: FastifyPluginAsync = async (fastify) => {
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

    const yamlBody = {
        type: 'object',
        properties: { yaml: { type: 'string' } },
        required: ['yaml']
    };

    // POST /v1/agents (register agent)
    fastify.post<{ Body: { yaml: string } }>('/v1/agents', {
        schema: { headers: authHeaders, body: yamlBody },
        preHandler: apiKeyAuth
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;

        try {
            const { yaml: yamlInput } = request.body;

            if (!yamlInput?.trim()) {
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
                parent_key: agent.parent_key,
                created_at: agent.created_at,
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Agent registration failed', 'server_error');
        }
    });

    // GET /v1/agents (list agents)
    fastify.get('/v1/agents', {
        schema: { headers: authHeaders },
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
                    markdown: a.markdown,
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
        schema: { headers: authHeaders, params: agentIdParam },
        preHandler: apiKeyAuth,
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        try {
            const agent = agentStore.getById(agent_id);

            if (!agent || agent.parent_key !== parentKey) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }

            const { frontMatter, content } = parseMarkdownFrontMatter(agent.markdown);

            return {
                agent_id: agent.id,
                parent_key: agent.parent_key,
                created_at: agent.created_at,
                markdown: agent.markdown,
                definition: frontMatter,
                instructions: content,
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Failed to retrieve agent', 'server_error');
        }
    });

    // PUT /v1/agents/:agent_id (update agent)
    fastify.put<{ Params: { agent_id: string }; Body: { yaml: string } }>('/v1/agents/:agent_id', {
        schema: { headers: authHeaders, params: agentIdParam, body: yamlBody },
        preHandler: apiKeyAuth
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        try {
            const existing = agentStore.getById(agent_id);
            if (!existing || existing.parent_key !== parentKey) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }

            const { yaml: yamlInput } = request.body;

            if (!yamlInput?.trim()) {
                reply.code(400);
                return createError("'yaml' field is required", 'invalid_request_error');
            }

            let updated;
            try {
                const fields = parseYamlInput(yamlInput, existing.name);
                updated = agentStore.updateAgent(agent_id, fields);
            } catch {
                reply.code(400);
                return createError('Invalid YAML format', 'invalid_request_error');
            }

            if (!updated) {
                reply.code(500);
                return createError('Failed to update agent', 'server_error');
            }

            return {
                agent_id: updated.id,
                agent_key: updated.agent_key,
                parent_key: updated.parent_key,
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
        schema: { headers: authHeaders, params: agentIdParam },
        preHandler: apiKeyAuth
    }, async (request, reply) => {
        const parentKey = request.apiKey!.id;
        const { agent_id } = request.params;

        try {
            const existing = agentStore.getById(agent_id);
            if (!existing || existing.parent_key !== parentKey) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }

            const deleted = agentStore.deleteAgent(agent_id);
            if (!deleted) {
                reply.code(500);
                return createError('Failed to delete agent', 'server_error');
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
