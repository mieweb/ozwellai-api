import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, isLLMBackendConfigured, extractToken, isAgentKey } from '../util';
import { agentStore, normalizeProviderModelSelections, ProviderModelRecord, ProviderModelSelection } from '../storage/agents';
import * as yaml from 'yaml';

const FALLBACK_MODELS = [
  { provider: 'openai', model: 'gpt-4o', id: 'gpt-4o', label: 'gpt-4o', source: 'fallback' },
  { provider: 'openai', model: 'gpt-4o-mini', id: 'gpt-4o-mini', label: 'gpt-4o-mini', source: 'fallback' },
];

const GATEWAY_DISCOVERY_PROVIDERS = ['openai', 'anthropic', 'ollama'];

// Legacy bootstrap seed. Live gateway discovery is preferred whenever configured.
const ALLOWED_MODELS = process.env.LLM_ALLOWED_MODELS
  ? process.env.LLM_ALLOWED_MODELS.split(',').map(m => m.trim()).filter(Boolean)
  : null;

function uniqueProviders(providers: Array<string | undefined>) {
  return Array.from(new Set(providers.map(provider => provider?.trim()).filter(Boolean))) as string[];
}

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

function isLikelyChatModel(provider: string, id: string) {
  const model = modelFromModelId(id).toLowerCase();
  if (provider === 'openai') {
    if (/(embedding|whisper|tts|moderation|image|sora|realtime|audio|transcribe)/.test(model)) return false;
    return /^(gpt-[0-9]|gpt-4|gpt-5|o[0-9]|chat-latest|computer-use)/.test(model);
  }
  if (provider === 'anthropic') return model.startsWith('claude-');
  return true;
}

async function discoverGatewayModels(): Promise<ProviderModelRecord[]> {
  if (!isLLMBackendConfigured()) return [];

  const records: ProviderModelRecord[] = [];
  const providers = uniqueProviders([process.env.LLM_PROVIDER, ...GATEWAY_DISCOVERY_PROVIDERS]);

  for (const provider of providers) {
    try {
      const resp = await fetch(`${process.env.LLM_BASE_URL}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${process.env.LLM_API_KEY || ''}`,
          'x-portkey-provider': provider,
        },
      });
      if (!resp.ok) continue;

      const payload = await resp.json() as { data?: Array<{ id?: string }> };
      const models = Array.isArray(payload.data) ? payload.data : [];
      for (const model of models) {
        if (typeof model.id !== 'string' || !model.id) continue;
        if (!isLikelyChatModel(provider, model.id)) continue;
        records.push(toModelRecord(model.id, 'gateway', provider));
      }
    } catch {
      // A single provider discovery failure should not block other providers.
    }
  }

  return records;
}

async function discoverDirectOllamaModels(): Promise<ProviderModelRecord[]> {
  if (!process.env.OLLAMA_BASE_URL) return [];
  try {
    const resp = await fetch(`${process.env.OLLAMA_BASE_URL}/api/tags`);
    if (!resp.ok) return [];
    const data = await resp.json() as { models?: { name?: string }[] };
    return (data.models || [])
      .filter((model): model is { name: string } => typeof model.name === 'string' && Boolean(model.name))
      .map((model) => toModelRecord(model.name, 'ollama', 'ollama'));
  } catch {
    return [];
  }
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
  const gatewayRecords = await discoverGatewayModels();
  const ollamaRecords = await discoverDirectOllamaModels();
  const discoveredRecords = [...gatewayRecords, ...ollamaRecords];
  if (discoveredRecords.length) {
    return listResponse(agentStore.replaceProviderModels(discoveredRecords));
  }

  if (ALLOWED_MODELS) {
    return listResponse(agentStore.replaceProviderModels(ALLOWED_MODELS.map(id => toModelRecord(id, 'env-seed'))));
  }

  return listResponse(agentStore.replaceProviderModels(FALLBACK_MODELS));
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
