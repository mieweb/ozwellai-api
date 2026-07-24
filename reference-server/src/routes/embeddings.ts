import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, generateEmbedding, countTokens, isLLMBackendConfigured, isOllamaAvailable, extractToken, isAgentKey } from '../util';
import { agentStore } from '../storage/agents';

// Hoist static env reads (these never change at runtime)
const LLM_BASE_URL = process.env.LLM_BASE_URL || '';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_PROVIDER = process.env.LLM_PROVIDER || '';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
// Embedding model to use when routing to Ollama. Requested OpenAI model names
// (e.g. text-embedding-3-small) don't exist in Ollama, so map to a real one.
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
// Mock embeddings are OFF by default so a real backend failure surfaces as a 503
// instead of returning semantically meaningless vectors. Set ALLOW_MOCK=true to
// return deterministic mock embeddings when no backend is configured or reachable.
const MOCK_ENABLED = process.env.ALLOW_MOCK === 'true';

// Known OpenAI embedding models and their native dimensions.
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

// Marks a mock embeddings response so callers can always tell a deterministic
// mock from real vectors. Mirrors the mock-warning semantics in chat.ts.
function buildMockWarning(model: string) {
  return {
    type: 'mock_response' as const,
    reason: 'no_backend' as const,
    model,
    message: `No embeddings backend configured or reachable — deterministic mock returned for model ${model}. These vectors are semantically meaningless.`,
  };
}

type EmbeddingItem = { object: 'embedding'; embedding: number[]; index: number };

/**
 * Forward the request to an OpenAI-compatible embeddings backend
 * (OpenAI, Portkey Gateway, etc.).
 */
async function fetchLLMEmbeddings(body: {
  model: string;
  input: string[];
  dimensions?: number;
  encoding_format?: string;
}): Promise<Response> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${LLM_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (LLM_PROVIDER) headers['x-portkey-provider'] = LLM_PROVIDER;

  return fetch(`${LLM_BASE_URL}/v1/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Fetch embeddings from a local/remote Ollama instance via its native /api/embed
 * endpoint (supports batch string arrays). Returns one vector per input.
 */
async function fetchOllamaEmbeddings(inputs: string[]): Promise<number[][]> {
  const resp = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: inputs }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Ollama embeddings failed (${resp.status}): ${errText}`);
  }
  const data = (await resp.json()) as { embeddings?: number[][] };
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== inputs.length) {
    throw new Error('Ollama returned an unexpected embeddings payload');
  }
  return data.embeddings;
}

const embeddingsRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/embeddings
  fastify.post('/v1/embeddings', {
    schema: {
      summary: 'Create embeddings',
      description: 'Creates an embedding vector representing the input text. Routes to a configured OpenAI-compatible backend (LLM_BASE_URL) or a local Ollama instance, falling back to deterministic mock vectors when ALLOW_MOCK is enabled. Accepts a single string or an array of strings.',
      tags: ['Embeddings'],
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          input: {
            // Accept either a single string or an array of strings (batch).
            anyOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          dimensions: { type: 'number' },
          encoding_format: { type: 'string', enum: ['float', 'base64'] },
          user: { type: 'string' },
        },
        required: ['model', 'input']
      }
    },
  }, async (request, reply) => {
    // Validate authorization
    if (!validateAuth(request.headers.authorization)) {
      reply.code(401);
      return createError('Invalid API key provided', 'invalid_request_error');
    }
    const token = extractToken(request.headers.authorization);
    if (!agentStore.validateKey(token)) {
      reply.code(401);
      return createError('API key not found. Verify the key exists in the database.', 'invalid_request_error');
    }

    const body = request.body as {
      model: string;
      input: string | string[];
      dimensions?: number;
      encoding_format?: string;
    };
    const { model, input, dimensions, encoding_format } = body;
    const tokenIsAgentKey = isAgentKey(request.headers.authorization);
    const resolvedAgent = tokenIsAgentKey ? agentStore.getByKeyWithActiveParent(token) : null;
    const parentKey = tokenIsAgentKey ? resolvedAgent?.parentKey : agentStore.lookupApiKey(token);
    const agentId = resolvedAgent?.agent.id ?? null;

    // Normalize input to an array (batch) and reject empty batches.
    const inputs = Array.isArray(input) ? input : [input];
    if (inputs.length === 0) {
      reply.code(400);
      return createError('Input must not be empty', 'invalid_request_error', 'input');
    }
    const estimatedTokens = inputs.reduce((sum, text) => sum + countTokens(text), 0);
    const quotaBlocks = agentStore.getQuotaBlocks(parentKey?.id ?? null, agentId, estimatedTokens);
    if (quotaBlocks.length > 0) {
      reply.code(429);
      const block = quotaBlocks[0];
      return createError(`Monthly token quota exceeded for ${block.scope_type} ${block.scope_id}`, 'rate_limit_error', null, 'quota_exceeded');
    }

    const recordUsage = (statusCode: number, response?: { usage?: { prompt_tokens?: number; total_tokens?: number } }, provider?: string | null) => {
      if (!parentKey) return;
      agentStore.recordUsageEvent({
        parent_key_id: parentKey.id,
        agent_id: agentId,
        auth_type: agentId ? 'agent' : 'parent',
        route: '/v1/embeddings',
        provider: provider ?? null,
        model,
        status_code: statusCode,
        prompt_tokens: response?.usage?.prompt_tokens ?? null,
        completion_tokens: null,
        total_tokens: response?.usage?.total_tokens ?? null,
      });
    };

    // Add OpenAI-compatible headers
    reply.headers({
      'x-request-id': `req_${Date.now()}`,
      'openai-processing-ms': '80',
      'openai-version': '2020-10-01',
    });

    // Backend selection priority (mirrors chat.ts):
    //   1. LLM_BASE_URL configured → OpenAI-compatible backend (OpenAI, Portkey Gateway)
    //   2. Ollama reachable        → local embeddings via /api/embed
    //   3. Deterministic mock      → flagged fallback (only when ALLOW_MOCK=true)
    const llmConfigured = isLLMBackendConfigured();
    const ollamaAvailable = llmConfigured ? false : await isOllamaAvailable();

    // ── 1. OpenAI-compatible backend (proxy request through) ──
    if (llmConfigured) {
      try {
        const upstream = await fetchLLMEmbeddings({
          model,
          input: inputs,
          ...(dimensions !== undefined && { dimensions }),
          ...(encoding_format !== undefined && { encoding_format }),
        });

        if (!upstream.ok) {
          const errBody = await upstream.text();
          reply.code(upstream.status);
          try {
            return JSON.parse(errBody);
          } catch {
            return createError(errBody, 'upstream_error');
          }
        }

        // Upstream is OpenAI-compatible; return its body verbatim.
        const response = await upstream.json();
        recordUsage(200, response, LLM_PROVIDER || null);
        return response;
      } catch (err) {
        request.log.error({ err }, 'LLM embeddings backend request failed');
        reply.code(502);
        return createError(
          `Embeddings backend request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          'upstream_error',
        );
      }
    }

    // ── 2. Ollama backend ──
    if (ollamaAvailable) {
      try {
        const vectors = await fetchOllamaEmbeddings(inputs);
        const data: EmbeddingItem[] = vectors.map((embedding, index) => ({
          object: 'embedding',
          embedding,
          index,
        }));
        const totalTokens = inputs.reduce((sum, text) => sum + countTokens(text), 0);
        const response = {
          object: 'list' as const,
          data,
          model,
          usage: {
            prompt_tokens: totalTokens,
            total_tokens: totalTokens,
          },
        };
        recordUsage(200, response, 'ollama');
        return response;
      } catch (err) {
        request.log.error({ err }, 'Ollama embeddings backend request failed');
        reply.code(502);
        return createError(
          `Embeddings backend request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          'upstream_error',
        );
      }
    }

    // ── 3. Deterministic mock fallback (only when ALLOW_MOCK=true) ──
    // Determine dimensions: explicit request wins, else the known model default,
    // else fall back to 1536 (text-embedding-3-small).
    const actualDimensions = dimensions || MODEL_DIMENSIONS[model] || 1536;

    if (!MOCK_ENABLED) {
      reply.code(503);
      return createError(
        'No embeddings backend configured or reachable and mock responses are disabled. Set LLM_BASE_URL (or run Ollama), or set ALLOW_MOCK=true to return deterministic mock embeddings.',
        'server_error',
      );
    }

    const data: EmbeddingItem[] = inputs.map((text, index) => ({
      object: 'embedding',
      embedding: generateEmbedding(text, actualDimensions),
      index,
    }));
    const totalTokens = inputs.reduce((sum, text) => sum + countTokens(text), 0);

    const response = {
      object: 'list' as const,
      data,
      model,
      usage: {
        prompt_tokens: totalTokens,
        total_tokens: totalTokens,
      },
      warning: buildMockWarning(model),
    };
    recordUsage(200, response, 'mock');
    return response;
  });
};

export default embeddingsRoute;
