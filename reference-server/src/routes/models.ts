import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, isLLMBackendConfigured } from '../util';

const FALLBACK_MODELS = [
  { id: 'gpt-4o', object: 'model' as const, created: 1677610602, owned_by: 'ozwellai' },
  { id: 'gpt-4o-mini', object: 'model' as const, created: 1677610602, owned_by: 'ozwellai' },
];

// When set, only these models appear in the dropdown (comma-separated)
const ALLOWED_MODELS = process.env.LLM_ALLOWED_MODELS
  ? process.env.LLM_ALLOWED_MODELS.split(',').map(m => m.trim()).filter(Boolean)
  : null;

const modelsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/models', {
    schema: {
      headers: { type: 'object', properties: { authorization: { type: 'string' } } },
    },
  }, async (request, reply) => {
    if (!validateAuth(request.headers.authorization)) {
      reply.code(401);
      return createError('Invalid API key provided', 'invalid_request_error');
    }

    // If LLM_ALLOWED_MODELS is set, return only those (skip gateway/Ollama call)
    if (ALLOWED_MODELS) {
      return {
        object: 'list' as const,
        data: ALLOWED_MODELS.map(id => ({
          id,
          object: 'model' as const,
          created: 0,
          owned_by: 'curated',
        })),
      };
    }

    // Proxy to LLM gateway when configured
    if (isLLMBackendConfigured()) {
      try {
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${process.env.LLM_API_KEY || ''}`,
        };
        if (process.env.LLM_PROVIDER) headers['x-portkey-provider'] = process.env.LLM_PROVIDER;

        const resp = await fetch(`${process.env.LLM_BASE_URL}/v1/models`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { object: string; data: unknown[] };
          return data;
        }
      } catch {}
    }

    if (process.env.OLLAMA_BASE_URL) {
      try {
        const resp = await fetch(`${process.env.OLLAMA_BASE_URL}/api/tags`);
        if (resp.ok) {
          const data = await resp.json() as { models: { name: string }[] };
          return {
            object: 'list' as const,
            data: (data.models || []).map((m) => ({
              id: m.name,
              object: 'model' as const,
              created: 0,
              owned_by: 'ollama',
            })),
          };
        }
      } catch {}
    }

    return { object: 'list' as const, data: FALLBACK_MODELS };
  });
};

export default modelsRoute;