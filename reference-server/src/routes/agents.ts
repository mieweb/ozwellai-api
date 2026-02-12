import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, generateId } from '../util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import type { AgentRegistrationRequest, AgentMetadata, AgentDefinition } from '../../../spec/index';

// Data directory for agents
const dataDir = path.join(process.cwd(), 'data', 'agents');
const indexFile = path.join(dataDir, 'index.json');

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

// Load agent index from disk
export async function loadAgentIndex(): Promise<AgentMetadata[]> {
  try {
    const data = await fs.readFile(indexFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Save agent index to disk
async function saveAgentIndex(agents: AgentMetadata[]): Promise<void> {
  await fs.writeFile(indexFile, JSON.stringify(agents, null, 2));
}

// Get agent by agent_key (for auth resolution)
export async function getAgentByKey(agentKey: string): Promise<AgentMetadata | null> {
  const agents = await loadAgentIndex();
  return agents.find(a => a.agent_key === agentKey) || null;
}

// Get agent markdown by agent_id
export async function getAgentMarkdown(agentId: string): Promise<string | null> {
  const agents = await loadAgentIndex();
  const agent = agents.find(a => a.agent_id === agentId);
  if (!agent) return null;
  
  try {
    const filePath = path.join(dataDir, agent.filename);
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// Generate agent key
function generateAgentKey(): string {
  return `agnt_${generateId('key')}`;
}

const agentsRoute: FastifyPluginAsync = async (fastify) => {
  // Ensure data directory exists
  await fs.mkdir(dataDir, { recursive: true });

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
      const { markdown, definition, spending_limits, footnote_db_config } = request.body;

      // Validate: either markdown or definition must be provided
      if (!markdown && !definition) {
        reply.code(400);
        return createError("Either 'markdown' or 'definition' must be provided", 'invalid_request_error');
      }

      // Convert definition to markdown if provided, otherwise use raw markdown
      let finalMarkdown: string;
      if (definition) {
        finalMarkdown = definitionToMarkdown(definition);
      } else if (markdown && markdown.trim()) {
        finalMarkdown = markdown;
      } else {
        reply.code(400);
        return createError('Agent content cannot be empty', 'invalid_request_error');
      }

      // Generate agent ID and key
      const agentId = generateId('agent');
      const agentKey = generateAgentKey();
      const timestamp = Math.floor(Date.now() / 1000);
      const filename = `${agentId}.md`;

      // Save markdown file
      const filePath = path.join(dataDir, filename);
      await fs.writeFile(filePath, finalMarkdown, 'utf-8');

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

      // Parse front matter for structured response
      const { frontMatter, content } = parseMarkdownFrontMatter(markdown);

      // Don't expose agent_key in response
      const { agent_key, ...agentData } = agent;

      return {
        ...agentData,
        markdown,
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
