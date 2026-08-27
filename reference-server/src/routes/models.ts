import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, isLLMBackendConfigured, getOllamaBaseUrl, extractToken, isAgentKey, envFallbackModel } from '../util';
import { agentStore, ProviderModelRecord } from '../storage/agents';

const GATEWAY_DISCOVERY_PROVIDERS = ['openai', 'anthropic', 'ollama'];

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
        records.push(toModelRecord(model.id, 'gateway', provider));
      }
    } catch {
      // A single provider discovery failure should not block other providers.
    }
  }

  return records;
}

async function discoverDirectOllamaModels(): Promise<ProviderModelRecord[]> {
  // Same resolution as chat/embeddings: if those will route to Ollama, discovery
  // has to register its models, or a bare request resolves a model the registry
  // has never heard of and 400s with provider_required.
  const baseUrl = getOllamaBaseUrl();
  if (!baseUrl) return [];
  try {
    const resp = await fetch(`${baseUrl}/api/tags`);
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

export async function refreshProviderModels() {
  const gatewayRecords = await discoverGatewayModels();
  const ollamaRecords = await discoverDirectOllamaModels();
  const discoveredRecords = [...gatewayRecords, ...ollamaRecords];
  return agentStore.replaceProviderModels(discoveredRecords);
}

// Seeding decisions below read the raw registry, but responses are narrowed by the server-wide
// policy. Deciding on the filtered list instead would re-seed the fallback model whenever a policy
// happens to exclude every discovered model.
function serverAllowedResponse() {
  return listResponse(agentStore.listEffectiveProviderModels(null));
}

function seedFallbackModel() {
  // Admin-set fallback first, then the same env chain the chat route resolves, so the seeded model
  // is the one a request would actually get. Ollama is passed as unavailable because this is a sync
  // path and the probe is async; seeding only runs when discovery returned nothing, and a reachable
  // Ollama would have been discovered.
  const serverDefault = agentStore.getServerDefaultModel();
  const fallback = serverDefault ?? envFallbackModel(isLLMBackendConfigured(), false);
  // An admin picked their provider explicitly, so it wins. Only an env-derived pair, where the
  // provider is a default rather than a choice, defers to a prefix on the model id.
  const provider = serverDefault ? serverDefault.provider : providerFromModelId(fallback.model, fallback.provider);
  agentStore.replaceProviderModels([
    toModelRecord(fallback.model, 'fallback', provider),
  ]);
  return serverAllowedResponse();
}

export async function getModelsList() {
  const discoveredRecords = await refreshProviderModels();
  if (discoveredRecords.length) {
    return serverAllowedResponse();
  }
  if (agentStore.hasProviderModelRegistry()) return listResponse([]);

  return seedFallbackModel();
}

export function getCachedModelsList() {
  const cached = agentStore.listProviderModels();
  if (cached.length) return serverAllowedResponse();
  if (agentStore.hasProviderModelRegistry()) return listResponse([]);

  return seedFallbackModel();
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

    getCachedModelsList();
    if (isAgentKey(request.headers.authorization)) {
      const resolved = agentStore.getByKeyWithActiveParent(token);
      if (!resolved) {
        reply.code(401);
        return createError('Agent key not found', 'invalid_request_error');
      }
      return listResponse(agentStore.listEffectiveProviderModelsForAgent(
        resolved.parentKey.id,
        resolved.agent.id,
        resolved.agent.yaml,
      ));
    }

    const parentKey = agentStore.lookupApiKey(token);
    return listResponse(agentStore.listEffectiveProviderModels(parentKey?.id ?? null));
  });
};

export default modelsRoute;
