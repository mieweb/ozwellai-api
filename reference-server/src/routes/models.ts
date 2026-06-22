import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, isLLMBackendConfigured, extractToken, isAgentKey } from '../util';
import { agentStore, normalizeProviderModelSelections, ProviderModelRecord, ProviderModelSelection } from '../storage/agents';
import * as yaml from 'yaml';

const FALLBACK_MODELS = [
  { provider: 'openai', model: 'gpt-4o', id: 'gpt-4o', label: 'gpt-4o', source: 'fallback' },
  { provider: 'openai', model: 'gpt-4o-mini', id: 'gpt-4o-mini', label: 'gpt-4o-mini', source: 'fallback' },
];

// When set, only these models appear in the dropdown (comma-separated)
const ALLOWED_MODELS = process.env.LLM_ALLOWED_MODELS
  ? process.env.LLM_ALLOWED_MODELS.split(',').map(m => m.trim()).filter(Boolean)
  : null;

function providerFromModelId(id: string, fallbackProvider = 'openai') {
  if (id.includes('/')) return id.split('/')[0];
  return fallbackProvider;
}

function modelFromModelId(id: string) {
  if (id.includes('/')) return id.split('/').slice(1).join('/');
  return id;
}

function toModelRecord(id: string, source: string, provider = providerFromModelId(id)): ProviderModelRecord {
  const model = modelFromModelId(id);
  return {
    id,
    provider,
    model,
    label: model,
    source,
    enabled: true,
    last_discovered_at: new Date().toISOString(),
  };
}

function listResponse(records: ProviderModelRecord[]) {
  return {
    object: 'list' as const,
    data: records.map(record => ({
      ...record,
      object: 'model' as const,
      created: 0,
      owned_by: record.provider,
    })),
  };
}

function parseAgentAllowedModels(agentYaml: string): ProviderModelSelection[] | null {
  let parsed: Record<string, unknown> = {};
  try {
    const value = yaml.parse(agentYaml);
    if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const explicit = Array.isArray(parsed.allowedModels)
    ? normalizeProviderModelSelections(parsed.allowedModels.map(item => {
      if (!item || typeof item !== 'object') return { provider: '' };
      const record = item as Record<string, unknown>;
      return {
        provider: typeof record.provider === 'string' ? record.provider : '',
        model: typeof record.model === 'string' ? record.model : null,
      };
    }))
    : [];
  if (explicit.length) return explicit;
  if (typeof parsed.provider === 'string' && typeof parsed.model === 'string') {
    return [{ provider: parsed.provider, model: parsed.model }];
  }
  return null;
}

export async function getModelsList() {
  // If LLM_ALLOWED_MODELS is set, return only those (skip gateway/Ollama call)
  if (ALLOWED_MODELS) {
    return listResponse(agentStore.upsertProviderModels(ALLOWED_MODELS.map(id => toModelRecord(id, 'env'))));
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
        const payload = await resp.json() as { object: string; data?: Array<{ id?: string; owned_by?: string }> };
        const records = (payload.data || [])
          .filter(model => typeof model.id === 'string' && model.id)
          .map(model => toModelRecord(model.id!, 'gateway', providerFromModelId(model.id!, model.owned_by || 'openai')));
        return listResponse(agentStore.upsertProviderModels(records));
      }
    } catch {
      // Gateway unavailable, fall through to next provider
    }
  }

  if (process.env.OLLAMA_BASE_URL) {
    try {
      const resp = await fetch(`${process.env.OLLAMA_BASE_URL}/api/tags`);
      if (resp.ok) {
        const data = await resp.json() as { models: { name: string }[] };
        return listResponse(agentStore.upsertProviderModels((data.models || []).map((m) => toModelRecord(m.name, 'ollama', 'ollama'))));
      }
    } catch {
      // Ollama unavailable, fall through to fallback list
    }
  }

  return listResponse(agentStore.upsertProviderModels(FALLBACK_MODELS));
}

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

    return getModelsList();
  });

  fastify.get('/v1/models/effective', {
    schema: {
      headers: { type: 'object', properties: { authorization: { type: 'string' } } },
    },
  }, async (request, reply) => {
    if (!validateAuth(request.headers.authorization)) {
      reply.code(401);
      return createError('Invalid API key provided', 'invalid_request_error');
    }

    const token = extractToken(request.headers.authorization);
    if (!agentStore.validateKey(token)) {
      reply.code(401);
      return createError('API key not found. Verify the key exists in the database.', 'invalid_request_error');
    }

    await getModelsList();
    if (isAgentKey(request.headers.authorization)) {
      const resolved = agentStore.getByKeyWithActiveParent(token);
      if (!resolved) {
        reply.code(401);
        return createError('Agent key not found', 'invalid_request_error');
      }
      return listResponse(agentStore.listEffectiveProviderModels(
        resolved.parentKey.id,
        parseAgentAllowedModels(resolved.agent.yaml),
      ));
    }

    const parentKey = agentStore.lookupApiKey(token);
    return listResponse(agentStore.listEffectiveProviderModels(parentKey?.id ?? null));
  });
};

export default modelsRoute;
