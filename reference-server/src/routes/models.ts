import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, isLLMBackendConfigured, getOllamaBaseUrl, extractToken, isAgentKey, envFallbackModel } from '../util';
import { agentStore, ProviderModelRecord } from '../storage/agents';
import { getAnthropicClient, getOpenAIClient } from '../llm/providers';

const GATEWAY_DISCOVERY_PROVIDERS = ['openai', 'anthropic', 'ollama'];

type DiscoveryWarn = (details: Record<string, unknown>, msg: string) => void;
const noWarn: DiscoveryWarn = () => {};

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

async function discoverGatewayModels(warn: DiscoveryWarn): Promise<ProviderModelRecord[]> {
  // Direct provider keys supersede the gateway for chat, so its catalog would only advertise
  // models no request can reach.
  if (!isLLMBackendConfigured() || (directProviderKeysPresent() && process.env.LLM_TRANSPORT !== 'gateway')) return [];

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
      if (!resp.ok) {
        warn({ source: 'gateway', provider, status: resp.status }, 'Model discovery request rejected');
        continue;
      }

      const payload = await resp.json() as { data?: Array<{ id?: string }> };
      const models = Array.isArray(payload.data) ? payload.data : [];
      for (const model of models) {
        if (typeof model.id !== 'string' || !model.id) continue;
        records.push(toModelRecord(model.id, 'gateway', provider));
      }
    } catch (err) {
      // A single provider discovery failure should not block other providers.
      warn({ source: 'gateway', provider, error: errorMessage(err) }, 'Model discovery failed');
    }
  }

  return records;
}

function directProviderKeysPresent() {
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}

// Native catalogs from providers configured with keys. Ollama has its own discovery below.
async function discoverDirectProviderModels(warn: DiscoveryWarn): Promise<ProviderModelRecord[]> {
  // Under a forced gateway these models would be advertised but dispatched to a gateway
  // that may not serve them.
  if (process.env.LLM_TRANSPORT === 'gateway' && isLLMBackendConfigured()) return [];
  const records: ProviderModelRecord[] = [];

  const openai = getOpenAIClient();
  if (openai) {
    try {
      for await (const model of openai.models.list()) {
        if (model?.id) records.push(toModelRecord(model.id, 'openai', 'openai'));
      }
    } catch (err) {
      // One provider's discovery failure should not block the others.
      warn({ source: 'direct', provider: 'openai', error: errorMessage(err) }, 'Model discovery failed');
    }
  }

  const anthropic = getAnthropicClient();
  if (anthropic) {
    try {
      for await (const model of anthropic.models.list({ limit: 1000 })) {
        if (model?.id) records.push(toModelRecord(model.id, 'anthropic', 'anthropic'));
      }
    } catch (err) {
      warn({ source: 'direct', provider: 'anthropic', error: errorMessage(err) }, 'Model discovery failed');
    }
  }

  return records;
}

async function discoverDirectOllamaModels(warn: DiscoveryWarn): Promise<ProviderModelRecord[]> {
  // Same resolution as chat/embeddings: if those will route to Ollama, discovery
  // has to register its models, or a bare request resolves a model the registry
  // has never heard of and 400s with provider_required.
  const baseUrl = getOllamaBaseUrl();
  if (!baseUrl) return [];
  try {
    const resp = await fetch(`${baseUrl}/api/tags`);
    if (!resp.ok) {
      warn({ source: 'ollama', provider: 'ollama', status: resp.status }, 'Model discovery request rejected');
      return [];
    }
    const data = await resp.json() as { models?: { name?: string }[] };
    return (data.models || [])
      .filter((model): model is { name: string } => typeof model.name === 'string' && Boolean(model.name))
      .map((model) => toModelRecord(model.name, 'ollama', 'ollama'));
  } catch (err) {
    warn({ source: 'ollama', provider: 'ollama', error: errorMessage(err) }, 'Model discovery failed');
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

export async function refreshProviderModels(log?: { warn: DiscoveryWarn }) {
  const warn: DiscoveryWarn = log ? (details, msg) => log.warn(details, msg) : noWarn;
  const gatewayRecords = await discoverGatewayModels(warn);
  const directRecords = await discoverDirectProviderModels(warn);
  const ollamaRecords = await discoverDirectOllamaModels(warn);
  const discoveredRecords = [...gatewayRecords, ...directRecords, ...ollamaRecords];
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
