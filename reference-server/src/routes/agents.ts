import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, generateId } from '../util';
import * as yaml from 'yaml';
import type { AgentRegistrationRequest, AgentDefinition } from '../../../spec/index';
import { agentStore } from '../storage/agents';

// Convert structured definition to markdown with YAML front matter
function definitionToMarkdown(definition: AgentDefinition): string {
    const frontMatter: Record<string, unknown> = {
        name: definition.name,
    };

    if (definition.description) frontMatter.description = definition.description;
    if (definition.model) frontMatter.model = definition.model;
    if (definition.temperature !== undefined) frontMatter.temperature = definition.temperature;
    if (definition.tools?.length) frontMatter.tools = definition.tools;
    if (definition.behavior) frontMatter.behavior = definition.behavior;

    const yamlStr = yaml.stringify(frontMatter);
    const instructions = definition.instructions || `You are ${definition.name}.${definition.description ? ' ' + definition.description : ''}`;

    return `---\n${yamlStr}---\n\n${instructions}`;
}

// Parse markdown to extract front matter (YAML or JSON)
export function parseMarkdownFrontMatter(markdown: string): { frontMatter: Record<string, unknown> | null; content: string } {
    const yamlMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (yamlMatch) {
        try {
            return { frontMatter: yaml.parse(yamlMatch[1]), content: yamlMatch[2].trim() };
        } catch {
            return { frontMatter: null, content: markdown };
        }
    }

    const jsonMatch = markdown.match(/^```json\n([\s\S]*?)\n```\n?([\s\S]*)$/);
    if (jsonMatch) {
        try {
            return { frontMatter: JSON.parse(jsonMatch[1]), content: jsonMatch[2].trim() };
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

const agentsRoute: FastifyPluginAsync = async (fastify) => {
    // POST /v1/agents (register agent)
    fastify.post<{ Body: AgentRegistrationRequest }>('/v1/agents', {
        schema: {
            headers: {
                type: 'object',
                properties: {
                    authorization: { type: 'string' }
                },
                required: ['authorization']
            },
            body: {
                type: 'object',
                properties: {
                    yaml: { type: 'string' },
                    markdown: { type: 'string' },
                    definition: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                            model: { type: 'string' },
                            temperature: { type: 'number' },
                            tools: { type: 'array', items: { type: 'string' } },
                            behavior: {
                                type: 'object',
                                properties: {
                                    tone: { type: 'string' },
                                    language: { type: 'string' },
                                    rules: { type: 'array', items: { type: 'string' } }
                                }
                            },
                            instructions: { type: 'string' }
                        },
                        required: ['name']
                    },
                    spending_limits: {
                        type: 'object',
                        properties: {
                            daily_usd: { type: 'number' },
                            monthly_usd: { type: 'number' }
                        }
                    },
                    footnote_db_config: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean' },
                            db_name: { type: 'string' }
                        }
                    }
                }
            }
        },
    }, async (request, reply) => {
        // Validate authorization (parent API key)
        const authHeader = request.headers.authorization;
        if (!validateAuth(authHeader)) {
            reply.code(401);
            return createError('Invalid API key provided', 'invalid_request_error');
        }

        // Extract parent key from authorization header
        const parentKey = authHeader?.replace('Bearer ', '') || '';

        try {
            const { yaml: yamlInput, markdown, definition, spending_limits, footnote_db_config } = request.body;

            // Validate: one of yaml, markdown, or definition must be provided
            if (!yamlInput && !markdown && !definition) {
                reply.code(400);
                return createError("One of 'yaml', 'markdown', or 'definition' must be provided", 'invalid_request_error');
            }

            // Convert definition to markdown if provided, otherwise use raw markdown or yaml
            let finalMarkdown: string;
            let name: string;
            let instructions: string;
            let model: string | undefined;
            let temperature: number | undefined;
            let tools: string[] | undefined;
            let behavior: Record<string, unknown> | undefined;

            if (yamlInput && yamlInput.trim()) {
                // Parse YAML input
                try {
                    const parsed = yaml.parse(yamlInput);
                    name = parsed.name || 'Unnamed Agent';
                    instructions = parsed.instructions || '';
                    model = parsed.model;
                    temperature = parsed.temperature;
                    tools = parsed.tools;
                    behavior = parsed.behavior;

                    // Construct markdown with YAML front matter
                    const frontMatter: Record<string, unknown> = { name };
                    if (parsed.description) frontMatter.description = parsed.description;
                    if (model) frontMatter.model = model;
                    if (temperature !== undefined) frontMatter.temperature = temperature;
                    if (tools) frontMatter.tools = tools;
                    if (behavior) frontMatter.behavior = behavior;

                    const yamlStr = yaml.stringify(frontMatter);
                    finalMarkdown = `---\n${yamlStr}---\n\n${instructions}`;
                } catch (e) {
                    reply.code(400);
                    return createError('Invalid YAML format', 'invalid_request_error');
                }
            } else if (definition) {
                finalMarkdown = definitionToMarkdown(definition);
                name = definition.name;
                instructions = definition.instructions || `You are ${definition.name}.${definition.description ? ' ' + definition.description : ''}`;
                model = definition.model;
                temperature = definition.temperature;
                tools = definition.tools;
                behavior = definition.behavior;
            } else if (markdown && markdown.trim()) {
                finalMarkdown = markdown;
                // Parse markdown to extract structured fields
                const { frontMatter, content } = parseMarkdownFrontMatter(markdown);
                name = frontMatter?.name as string || 'Unnamed Agent';
                instructions = content;
                model = frontMatter?.model as string | undefined;
                temperature = frontMatter?.temperature as number | undefined;
                tools = frontMatter?.tools as string[] | undefined;
                behavior = frontMatter?.behavior as Record<string, unknown> | undefined;
            } else {
                reply.code(400);
                return createError('Agent content cannot be empty', 'invalid_request_error');
            }

            // Generate agent ID and key
            const agentId = generateId('agent');
            const agentKey = generateAgentKey();

            // Create agent in database
            const agent = agentStore.createAgent({
                id: agentId,
                agent_key: agentKey,
                parent_key: parentKey,
                name,
                instructions,
                model,
                temperature,
                tools,
                behavior,
                markdown: finalMarkdown
            });

            // Return response
            reply.code(201);
            return {
                agent_id: agent.id,
                agent_key: agent.agent_key,
                parent_key: agent.parent_key,
                created_at: agent.created_at,
                spending_limits,
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Agent registration failed', 'server_error');
        }
    });

    // GET /v1/agents (list agents for authenticated user)
    fastify.get('/v1/agents', {
        schema: {
            headers: {
                type: 'object',
                properties: {
                    authorization: { type: 'string' }
                },
                required: ['authorization']
            }
        },
    }, async (request, reply) => {
        // Validate authorization
        const authHeader = request.headers.authorization;
        if (!validateAuth(authHeader)) {
            reply.code(401);
            return createError('Invalid API key provided', 'invalid_request_error');
        }

        const parentKey = authHeader?.replace('Bearer ', '') || '';

        try {
            const agents = agentStore.listByParent(parentKey);

            return {
                object: 'list',
                data: agents,
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Failed to list agents', 'server_error');
        }
    });

    // GET /v1/agents/:agent_id (get specific agent)
    fastify.get<{ Params: { agent_id: string } }>('/v1/agents/:agent_id', {
        schema: {
            headers: {
                type: 'object',
                properties: {
                    authorization: { type: 'string' }
                },
                required: ['authorization']
            },
            params: {
                type: 'object',
                properties: {
                    agent_id: { type: 'string' }
                },
                required: ['agent_id']
            }
        },
    }, async (request, reply) => {
        // Validate authorization
        const authHeader = request.headers.authorization;
        if (!validateAuth(authHeader)) {
            reply.code(401);
            return createError('Invalid API key provided', 'invalid_request_error');
        }

        const parentKey = authHeader?.replace('Bearer ', '') || '';
        const { agent_id } = request.params;

        try {
            const agent = agentStore.getById(agent_id);

            if (!agent || agent.parent_key !== parentKey) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }

            // Parse front matter for structured response
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
};

export default agentsRoute;
