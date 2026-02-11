import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, generateId } from '../util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentRegistrationRequest, AgentMetadata } from '../../../spec/index';

const agentsRoute: FastifyPluginAsync = async (fastify) => {
    const dataDir = path.join(process.cwd(), 'data', 'agents');
    const indexFile = path.join(dataDir, 'index.json');

    // Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });

    // Load or initialize agent index
    async function loadAgentIndex(): Promise<AgentMetadata[]> {
        try {
            const data = await fs.readFile(indexFile, 'utf-8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    // Save agent index
    async function saveAgentIndex(agents: AgentMetadata[]): Promise<void> {
        await fs.writeFile(indexFile, JSON.stringify(agents, null, 2));
    }

    // Generate agent key
    function generateAgentKey(): string {
        return `agnt_${generateId('key')}`;
    }

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
                    markdown: { type: 'string' },
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
                },
                required: ['markdown']
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
            const { markdown, spending_limits, footnote_db_config } = request.body;

            // Basic validation: markdown should have some content
            if (!markdown.trim()) {
                reply.code(400);
                return createError('Markdown content cannot be empty', 'invalid_request_error');
            }

            // Generate agent ID and key
            const agentId = generateId('agent');
            const agentKey = generateAgentKey();
            const timestamp = Math.floor(Date.now() / 1000);
            const filename = `${agentId}.md`;

            // Save markdown file
            const filePath = path.join(dataDir, filename);
            await fs.writeFile(filePath, markdown, 'utf-8');

            // Create agent metadata
            const agentMetadata: AgentMetadata = {
                agent_id: agentId,
                agent_key: agentKey,
                parent_key: parentKey,
                created_at: timestamp,
                spending_limits,
                footnote_db_config,
                filename,
            };

            // Update index
            const agents = await loadAgentIndex();
            agents.push(agentMetadata);
            await saveAgentIndex(agents);

            // Return response
            reply.code(201);
            return {
                agent_id: agentId,
                agent_key: agentKey,
                parent_key: parentKey,
                created_at: timestamp,
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
            const agents = await loadAgentIndex();

            // Filter agents by parent key
            const userAgents = agents
                .filter(agent => agent.parent_key === parentKey)
                .map(({ agent_key, ...rest }) => rest); // Don't expose agent_key in list

            return {
                object: 'list',
                data: userAgents,
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
            const agents = await loadAgentIndex();
            const agent = agents.find(a => a.agent_id === agent_id && a.parent_key === parentKey);

            if (!agent) {
                reply.code(404);
                return createError('Agent not found', 'invalid_request_error');
            }

            // Read markdown file
            const filePath = path.join(dataDir, agent.filename);
            const markdown = await fs.readFile(filePath, 'utf-8');

            // Don't expose agent_key in response
            const { agent_key, ...agentData } = agent;

            return {
                ...agentData,
                markdown,
            };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500);
            return createError('Failed to retrieve agent', 'server_error');
        }
    });
};

export default agentsRoute;
