import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { validateAuth, createError, generateId, countTokens, isOllamaAvailable, getOllamaDefaultModel, isAgentKey, extractToken, isLLMBackendConfigured, parsePositiveEnvNumber } from '../util';
import { agentStore, type AgentModelPolicy, type PageToolsPolicy } from '../storage/agents';
import * as yaml from 'yaml';
import OzwellAI from 'ozwellai';
import type { ChatCompletionRequest as ClientChatCompletionRequest } from 'ozwellai';
import type { ChatCompletionRequest, Message } from '../../../spec/index';
import { generateMockResponse, extractUserMessage, hasToolResult, extractToolResult, contentToText, type ChatMessage as MockChatMessage } from './mock-chat';
import { getCachedModelsList } from './models';

// SSE Heartbeat Configuration
// Send keepalive every 25s to prevent 60s Nginx timeout
const STREAMING_HEARTBEAT_ENABLED = process.env.STREAMING_HEARTBEAT_ENABLED !== 'false'; // enabled by default
const STREAMING_HEARTBEAT_MS = parseInt(process.env.STREAMING_HEARTBEAT_MS || '25000', 10);

// Local helper types to support tool definitions in the server
type ToolFunction = {
  name: string;
  description?: string;
  parameters?: JSONSchemaParameters;
};

type ToolDef = { type: 'function'; function: ToolFunction };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};
type ChatCompletionRequestWithTools = ChatCompletionRequest & {
  provider?: string;
  tools?: ToolDef[];
  stream_options?: { include_usage?: boolean };
};
type NonNullableMessage = { role: Message['role']; content: NonNullable<Message['content']>; name?: Message['name']; tool_calls?: ToolCall[]; tool_call_id?: string };

// JSON Schema type for tool function parameters
type JSONSchemaParameters = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

// Raw tool call structure from parsed JSON (before normalization)
type RawToolCallJSON = {
  id?: string;
  type?: string;
  name?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
  arguments?: string | Record<string, unknown>;
};

// Streaming chunk structure with finish_reason
type StreamingChoice = {
  index?: number;
  delta?: {
    content?: string;
    thinking?: string;
    reasoning_content?: string;
    finish_reason?: string;
  };
  finish_reason?: string;
};

// Chat message with optional tool_calls (for mutation)
type ChatMessage = {
  role: string;
  content?: string;
  tool_calls?: ToolCall[];
};

type UsageContext = {
  authType: 'parent' | 'agent';
  parentKeyId: string | null;
  agentId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidMessageContent(content: unknown): boolean {
  if (content == null || typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;

  return content.every((part) => {
    if (!isRecord(part)) return false;
    if (part.type === 'text') return typeof part.text === 'string';
    if (part.type === 'image_url') {
      return isRecord(part.image_url) && typeof part.image_url.url === 'string';
    }
    if (part.type === 'file') {
      return isRecord(part.file) && typeof part.file.file_data === 'string';
    }
    return false;
  });
}

// Helper: try to detect tool calls from JSON content and convert to ToolCall[]
function tryExtractToolCallsFromContent(content: string | undefined, tools?: ToolDef[] | undefined): ToolCall[] | null {
  if (!content) return null;
  let text = content.trim();
  // strip markdown code block if present
  const mdMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (mdMatch) text = mdMatch[1].trim();

  try {
    const parsed = JSON.parse(text);
    // already an array of tool_calls
    if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      return parsed.tool_calls.map((tc: RawToolCallJSON, idx: number) => ({
        id: tc.id || `call_${Date.now()}_${idx}`,
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || tc.name,
          arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || tc.arguments || {})
        }
      }));
    }

    // Qwen-style: { name: 'fn', arguments: {...} }
    if (parsed.name && parsed.arguments !== undefined) {
      return [{
        id: `call_${Date.now()}_0`,
        type: 'function',
        function: {
          name: parsed.name,
          arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments)
        }
      }];
    }

    // function wrapper: { function: { name: 'fn', arguments: {...} } }
    if (parsed.function?.name) {
      return [{
        id: `call_${Date.now()}_0`,
        type: 'function',
        function: {
          name: parsed.function.name,
          arguments: typeof parsed.function.arguments === 'string' ? parsed.function.arguments : JSON.stringify(parsed.function.arguments || {})
        }
      }];
    }

    // If parsed is an argument object (e.g., { name: 'Bob' }) and tools provided,
    // attempt to find a single tool whose required parameters are all present
    if (typeof parsed === 'object' && tools && Array.isArray(tools) && Object.keys(parsed).length > 0) {
      const parsedKeys = Object.keys(parsed);
      const matches = tools.filter((t) => {
        const req = t.function.parameters?.required;
        if (!req || req.length === 0) return false;
        return req.every(k => parsedKeys.includes(k));
      });
      if (matches.length === 1) {
        const tool = matches[0];
        return [{
          id: `call_${Date.now()}_0`,
          type: 'function',
          function: {
            name: tool.function.name,
            arguments: JSON.stringify(parsed)
          }
        }];
      }
    }
  } catch (e) {
    // not JSON or not recognized
  }
  return null;
}

// Cached regex for <think>...</think> extraction (used in hot streaming path)
const THINK_TAG_REGEX = /<think>([\s\S]*?)<\/think>/g;

// Helper: extract thinking tokens from content that uses <think>...</think> tags (Ollama/Qwen)
// Returns { thinking, content } — thinking is the extracted text, content is the remainder.
function extractThinkTagsFromContent(text: string): { thinking: string; content: string } {
  THINK_TAG_REGEX.lastIndex = 0;
  const thinkParts: string[] = [];
  // Single pass: collect thinking parts and strip tags via replace callback
  const content = text.replace(THINK_TAG_REGEX, (_, inner) => {
    thinkParts.push(inner);
    return '';
  });
  return { thinking: thinkParts.join(''), content };
}

// Rename vendor-specific reasoning fields to the canonical `thinking` field.
// Handles Ollama/Qwen3 `reasoning` and DeepSeek `reasoning_content`.
// Returns true if a field was renamed (caller can skip further processing).
function renameReasoningField(obj: Record<string, unknown>): boolean {
  if (obj.reasoning && typeof obj.reasoning === 'string') {
    obj.thinking = obj.reasoning;
    delete obj.reasoning;
    return true;
  }
  if (obj.reasoning_content && typeof obj.reasoning_content === 'string') {
    obj.thinking = obj.reasoning_content;
    delete obj.reasoning_content;
    return true;
  }
  return false;
}

// Max partial buffer size to prevent unbounded growth on truncated streams
const MAX_THINK_BUFFER = 64 * 1024;

// Normalize a streaming chunk: extract thinking tokens into delta.thinking
// Handles Ollama/Qwen, DeepSeek, and <think> tags in content.
// Mutates and returns the chunk for forwarding.
function normalizeChunkThinking(chunk: Record<string, unknown>, thinkBuffer: { partial: string }): Record<string, unknown> {
  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length === 0) return chunk;

  const choice = choices[0];
  const delta = choice.delta as Record<string, unknown> | undefined;
  if (!delta) return chunk;

  // --- Ollama/Qwen3 & DeepSeek: named reasoning fields ---
  if (renameReasoningField(delta)) {
    if (delta.content === '') delete delta.content;
    return chunk;
  }

  // --- Ollama/Qwen (older): <think> tags in content ---
  if (delta.content && typeof delta.content === 'string') {
    const raw = thinkBuffer.partial + delta.content;

    // Fast path: no <think> tags and no buffered partial — pass through unchanged
    if (!thinkBuffer.partial && !raw.includes('<think')) {
      return chunk;
    }

    // Safety: cap buffer to prevent unbounded growth on truncated streams
    if (raw.length > MAX_THINK_BUFFER) {
      thinkBuffer.partial = '';
      return chunk;
    }

    // Check for partial/open <think> tag at the end (tag not yet closed)
    const lastOpenIdx = raw.lastIndexOf('<think>');
    const lastCloseIdx = raw.lastIndexOf('</think>');

    if (lastOpenIdx !== -1 && (lastCloseIdx === -1 || lastCloseIdx < lastOpenIdx)) {
      const before = raw.substring(0, lastOpenIdx);
      thinkBuffer.partial = raw.substring(lastOpenIdx);

      const { thinking, content } = extractThinkTagsFromContent(before);
      delta.content = content || undefined;
      if (thinking) delta.thinking = thinking;
      if (!delta.content) delete delta.content;
      return chunk;
    }

    // No unclosed tag — flush buffer and extract
    thinkBuffer.partial = '';
    const { thinking, content } = extractThinkTagsFromContent(raw);
    delta.content = content || undefined;
    if (thinking) delta.thinking = thinking;
    if (!delta.content) delete delta.content;
    return chunk;
  }

  return chunk;
}

// Normalize a non-streaming response message: extract thinking from content
function normalizeMessageThinking(message: Record<string, unknown>): void {
  renameReasoningField(message);

  // Ollama/Qwen (older): <think> tags in content
  if (!message.thinking && message.content && typeof message.content === 'string') {
    const { thinking, content } = extractThinkTagsFromContent(message.content);
    if (thinking) {
      message.thinking = thinking;
      message.content = content;
    }
  }
}

// Detect model-not-found errors from gateway (404, model_not_found, etc.)
function isModelNotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('404') || msg.includes('model_not_found') || msg.includes('does not exist');
  }
  return false;
}

function buildFallbackWarning(originalModel: string, fallbackModel: string) {
  return {
    type: 'model_fallback' as const,
    message: `Model ${originalModel} not available on this provider — using ${fallbackModel}`,
    original_model: originalModel,
    fallback_model: fallbackModel,
  };
}

// Identifier used as the `model` field on every mock response so callers can immediately
// distinguish a deterministic mock from a real LLM answer. Mock warnings keep the selected
// model that triggered the mock response.
const MOCK_MODEL_ID = 'ozwell-mock';

// Marks every mock response so callers (and the chat widget) can always tell a deterministic
// mock from a real LLM answer. Three reasons cover all paths that emit a mock body.
function buildMockWarning(reason: 'no_backend' | 'llm_error' | 'mock_agent', model: string) {
  const messages = {
    no_backend: `No LLM backend configured or reachable — deterministic mock returned for model ${model}.`,
    llm_error: `LLM backend errored — deterministic mock returned as fallback for model ${model}.`,
    mock_agent: `Agent is configured as type: mock — response is deterministic, no LLM called.`,
  };
  return { type: 'mock_response' as const, reason, model, message: messages[reason] };
}

// Hoist static env reads (these never change at runtime)
const LLM_PROVIDER = process.env.LLM_PROVIDER || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const FALLBACK_MODEL = process.env.DEFAULT_MODEL || 'gpt-4o-mini';
// Mock responses are OFF by default — keep real LLM errors visible in production.
// Set ALLOW_MOCK=true to return deterministic mock replies (no LLM configured,
// LLM errored, or an agent declares type: mock).
const MOCK_ENABLED = process.env.ALLOW_MOCK === 'true';
// No output cap by default. LLM_MAX_TOKENS sets a server-wide ceiling; a client
// that sends its own max_tokens always overrides this.
const LLM_MAX_TOKENS = parsePositiveEnvNumber('LLM_MAX_TOKENS');

function createLlmClient(provider: string | null) {
  return new OzwellAI({
    apiKey: process.env.LLM_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL!,
    timeout: 120000,
    defaultHeaders: {
      ...((provider || LLM_PROVIDER) && { 'x-portkey-provider': provider || LLM_PROVIDER }),
    },
  });
}

const ollamaClient = new OzwellAI({
  apiKey: 'ollama',
  baseURL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  timeout: 120000,
});

// Mock dispatch — split into stream / non-stream variants so the call-site
// contract is enforced by the type system (no more silent `if (stream) return` footgun).
// Both variants attach a structured warning so callers always know the response is mock.

type MockWarning = ReturnType<typeof buildMockWarning>;

function buildMockAssistant(messages: NonNullableMessage[]) {
  const userMsg = extractUserMessage(messages as MockChatMessage[]);
  const hasResult = hasToolResult(messages as MockChatMessage[]);
  const toolResult = hasResult ? extractToolResult(messages as MockChatMessage[]) : null;
  const assistantMsg = generateMockResponse(userMsg, hasResult, toolResult);
  const finishReason = assistantMsg.tool_calls?.length ? 'tool_calls' : 'stop';
  return { assistantMsg, finishReason };
}

function dispatchMockNonStream(
  messages: NonNullableMessage[],
  warning: MockWarning,
) {
  const { assistantMsg, finishReason } = buildMockAssistant(messages);
  const promptText = messages.map((m) => contentToText(m.content)).join(' ');
  const completionText = assistantMsg.content || JSON.stringify(assistantMsg.tool_calls || []);
  const promptTokens = countTokens(promptText);
  const completionTokens = countTokens(completionText);
  return {
    id: generateId('chatcmpl'),
    object: 'chat.completion' as const,
    created: Math.floor(Date.now() / 1000),
    model: MOCK_MODEL_ID,
    choices: [{ index: 0, message: assistantMsg, finish_reason: finishReason }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    warning,
  };
}

function dispatchMockStream(
  messages: NonNullableMessage[],
  reply: FastifyReply,
  origin: string | undefined,
  warning: MockWarning,
): void {
  const { assistantMsg, finishReason } = buildMockAssistant(messages);
  const id = generateId('chatcmpl');
  const created = Math.floor(Date.now() / 1000);

  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'access-control-allow-origin': origin || '*',
    'access-control-allow-credentials': 'true',
  });

  // Emit warning event before chunks so widget can react before content streams in
  reply.raw.write(`event: warning\ndata: ${JSON.stringify(warning)}\n\n`);

  const writeChunk = (delta: Record<string, unknown>, finish: string | null = null) => {
    reply.raw.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created, model: MOCK_MODEL_ID,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`);
  };

  writeChunk({ role: 'assistant' });

  if (assistantMsg.content) {
    const CHUNK = 3;
    for (let i = 0; i < assistantMsg.content.length; i += CHUNK) {
      writeChunk({ content: assistantMsg.content.slice(i, i + CHUNK) });
    }
  }

  if (assistantMsg.tool_calls) {
    const withIndex = assistantMsg.tool_calls.map((tc, idx) => ({ index: idx, ...tc }));
    writeChunk({ tool_calls: withIndex });
  }

  writeChunk({}, finishReason);
  reply.raw.write('data: [DONE]\n\n');
  reply.raw.end();
}

// Single decision point for every mock path (mock_agent, no_backend, llm_error).
// When ALLOW_MOCK is off, return a real 503 instead of a deterministic mock so
// failures stay visible. All three call sites are reached before any response
// headers are sent, so a JSON error is always safe here.
// Returns a value to `return` for the non-stream case; streams end internally.
function respondMockOrError(
  reason: Parameters<typeof buildMockWarning>[0],
  model: string,
  messages: NonNullableMessage[],
  stream: boolean,
  reply: FastifyReply,
  origin: string | undefined,
) {
  const warning = buildMockWarning(reason, model);
  if (reason === 'mock_agent') {
    if (stream) {
      dispatchMockStream(messages, reply, origin, warning);
      return undefined;
    }
    return dispatchMockNonStream(messages, warning);
  }

  if (!MOCK_ENABLED) {
    reply.code(503);
    return createError(
      `No LLM response available (${reason}) and mock responses are disabled. Set ALLOW_MOCK=true to return deterministic mock responses.`,
      'server_error',
    );
  }
  if (stream) {
    dispatchMockStream(messages, reply, origin, warning);
    return undefined;
  }
  return dispatchMockNonStream(messages, warning);
}

const chatRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/chat/completions
  fastify.post('/v1/chat/completions', {
    schema: {
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              // Allow additional properties so Fastify's removeAdditional:true
              // does not strip tool_calls and tool_call_id from messages.
              // These fields are required for OpenAI-compatible tool continuation.
              additionalProperties: true,
              properties: {
                role: { type: 'string' },
                // Content may be a plain string (text) or an array of
                // multimodal content parts (text + image_url) for vision.
                //
                // NOTE: We intentionally leave this schema unconstrained (no
                // `type`/`anyOf`). Fastify's default ajv runs with
                // `coerceTypes: true`, which unwraps a single-element array
                // (`[x]` -> `x`) while attempting the scalar `string` branch of
                // an `anyOf`. That mutation corrupted the payload and made
                // single-part content arrays (e.g. one image_url) fail
                // validation with FST_ERR_VALIDATION. An empty schema accepts
                // string | array | object | null without any coercion; the
                // route normalizes content at runtime (see normalizedMessages
                // and contentToText).
                content: {},
                tool_calls: { type: 'array' },
                tool_call_id: { type: 'string' }
              },
              required: ['role']
            }
          },
          tools: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                function: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    parameters: { type: 'object' },
                  },
                },
              },
            },
          },
          stream: { type: 'boolean' },
          max_tokens: { type: 'number' },
          temperature: { type: 'number' },
          response_format: { type: 'object', properties: { type: { type: 'string' } } }
        },
        required: ['messages']
      }
    },
  }, async (request, reply) => {
    // Validate authorization — only agent keys (agnt_key-) and parent keys (ozw_) accepted
    if (!validateAuth(request.headers.authorization)) {
      reply.code(401);
      return createError('Invalid or missing API key. Use an agent key (agnt_key-...) or parent API key (ozw_...).', 'invalid_request_error');
    }

    // Validate token exists in database
    const token = extractToken(request.headers.authorization);
    if (!agentStore.validateKey(token)) {
      reply.code(401);
      return createError('API key not found. Verify the key exists in the database.', 'invalid_request_error');
    }

    const body = request.body as ChatCompletionRequestWithTools;
    const tokenIsAgentKey = isAgentKey(request.headers.authorization);
    let usageContext: UsageContext | null = null;

    const invalidMessageIndex = (body.messages as Message[]).findIndex((m) => !isValidMessageContent(m.content));
    if (invalidMessageIndex !== -1) {
      reply.code(400);
      return createError(
        `Invalid messages[${invalidMessageIndex}].content`,
        'invalid_request_error',
        `messages[${invalidMessageIndex}].content`
      );
    }

    // --- Agent key resolution ---
    let agentConfig: { systemPrompt: string; allowedTools: string[] | null; pageTools: PageToolsPolicy; modelPolicy: AgentModelPolicy; temperature: number | null; type: 'mock' | null } | null = null;

    if (tokenIsAgentKey) {
      const agentKey = extractToken(request.headers.authorization);
      const resolved = agentStore.getByKeyWithActiveParent(agentKey);
      if (!resolved) {
        reply.code(401);
        return createError(`Agent key not found: ...${agentKey.slice(-4)}. Verify the key exists and the server has the agent database.`, 'invalid_request_error');
      }
      const { agent, parentKey } = resolved;
      usageContext = { authType: 'agent', parentKeyId: parentKey.id, agentId: agent.id };

      // Parse the YAML blob once — the source of truth for agent config
      let parsed: Record<string, unknown> = {};
      try {
        const p = yaml.parse(agent.yaml);
        if (p && typeof p === 'object') parsed = p as Record<string, unknown>;
      } catch (err) {
        request.log.warn({ err, agentId: agent.id }, 'Failed to parse agent YAML');
      }

      // Use agent instructions as the system prompt
      let systemPrompt = (parsed.instructions as string | undefined) || '';

      // Append behavior metadata (tone, language, rules) as a structured
      // supplement AFTER the instructions so they don't dilute or compete
      // with the primary prompt.
      const behavior = parsed.behavior;
      if (behavior && typeof behavior === 'object') {
        const b = behavior as Record<string, unknown>;
        const extras: string[] = [];
        if (b.tone) extras.push(`- Respond with a ${b.tone} tone.`);
        if (b.language && b.language !== 'en') extras.push(`- Respond in ${b.language}.`);
        if (Array.isArray(b.rules) && b.rules.length > 0) {
          for (const rule of b.rules) {
            if (typeof rule === 'string') extras.push(`- ${rule}`);
          }
        }
        if (extras.length > 0) {
          systemPrompt = systemPrompt.trimEnd() + '\n\n=== ADDITIONAL RULES ===\n' + extras.join('\n');
        }
      }

      const tools = parsed.tools;
      agentConfig = {
        systemPrompt,
        allowedTools: Array.isArray(tools) && tools.length > 0
          ? (tools as unknown[]).map((t) => typeof t === 'string' ? t : (t as { name: string }).name)
          : null,
        pageTools: (parsed.pageTools as PageToolsPolicy) ?? 'all',
        modelPolicy: agentStore.getAgentModelPolicy(agent.id, agent.yaml),
        temperature: (parsed.temperature as number | undefined) ?? null,
        type: parsed.type === 'mock' ? 'mock' : null,
      };
    } else {
      const parentKey = agentStore.lookupApiKey(token);
      usageContext = { authType: 'parent', parentKeyId: parentKey?.id ?? null, agentId: null };
    }

    const recordUsage = async (model: string | null, statusCode: number, response?: unknown, provider?: string | null) => {
      if (!usageContext) return;
      const usage = response && typeof response === 'object' && 'usage' in response
        ? (response as { usage?: TokenUsage }).usage
        : undefined;
      try {
        await agentStore.recordUsageEvent({
          parent_key_id: usageContext.parentKeyId,
          agent_id: usageContext.agentId,
          auth_type: usageContext.authType,
          route: '/v1/chat/completions',
          provider: provider ?? null,
          model,
          status_code: statusCode,
          prompt_tokens: usage?.prompt_tokens ?? null,
          completion_tokens: usage?.completion_tokens ?? null,
          total_tokens: usage?.total_tokens ?? null,
        });
      } catch (err) {
        request.log.warn({ err }, 'Failed to record usage event');
      }
    };

    // Early exit for mock-type agents — skip backend probing entirely (no LLM ever called).
    if (agentConfig?.type === 'mock') {
      const { messages: rawMessages, stream = false } = body as ChatCompletionRequestWithTools;
      const mockMessages: NonNullableMessage[] = (rawMessages as Message[]).map((m) => ({
        role: m.role,
        content: m.content ?? '',
        name: m.name,
      }));
      if (agentConfig.systemPrompt) {
        mockMessages.unshift({ role: 'system', content: agentConfig.systemPrompt });
      }
      const mockModel = agentConfig.modelPolicy.default_model || 'mock';
      const response = respondMockOrError('mock_agent', mockModel, mockMessages, stream, reply, request.headers.origin);
      await recordUsage(mockModel, reply.statusCode, response);
      return response;
    }

    // Backend selection priority:
    // 1. LLM_BASE_URL configured → use it (OpenAI, Portkey Gateway, etc.)
    // 2. Ollama reachable → use Ollama
    // 3. Mock/simple generator
    const llmConfigured = isLLMBackendConfigured();
    const ollamaAvailable = llmConfigured ? false : await isOllamaAvailable();
    const backend = llmConfigured ? 'llm' : ollamaAvailable ? 'ollama' : 'fallback';

    // Determine default model based on backend
    const DEFAULT_MODEL = llmConfigured ? LLM_MODEL : ollamaAvailable ? getOllamaDefaultModel() : FALLBACK_MODEL;

    const { provider: requestedProvider, model: requestedModel, messages, tools, stream = false, max_tokens, temperature: requestedTemperature = 0.7, response_format } = body as ChatCompletionRequestWithTools & { response_format?: { type: string } };
    getCachedModelsList();
    const effectiveModels = agentConfig && usageContext?.parentKeyId && usageContext.agentId
      ? agentStore.listEffectiveProviderModelsForAgent(usageContext.parentKeyId, usageContext.agentId)
      : agentStore.listEffectiveProviderModels(usageContext?.parentKeyId ?? null);
    const selectedModel = requestedModel || agentConfig?.modelPolicy.default_model || DEFAULT_MODEL;
    const selectedProvider = requestedProvider
      || agentConfig?.modelPolicy.default_provider
      || (() => {
        const matches = effectiveModels.filter(item => item.model === selectedModel || item.id === selectedModel);
        return matches.length === 1 ? matches[0].provider : null;
      })();
    if (!selectedProvider) {
      reply.code(400);
      return createError('Provider is required for ambiguous model selection', 'invalid_request_error', 'provider', 'provider_required');
    }
    const allowedModel = effectiveModels.find(item => item.provider === selectedProvider && (item.model === selectedModel || item.id === selectedModel));
    if (!allowedModel) {
      reply.code(403);
      return createError('Requested provider/model is not allowed for this key or agent', 'invalid_request_error', 'model', 'model_not_allowed');
    }
    const provider = allowedModel.provider;
    const model = allowedModel.model;
    const fallbackModel = effectiveModels.find(item => item.provider === provider && (item.model === DEFAULT_MODEL || item.id === DEFAULT_MODEL));
    const fallbackRetryAllowed = Boolean(fallbackModel);
    const fallbackRetryModel = fallbackModel?.model || DEFAULT_MODEL;
    // Agent-configured temperature takes precedence over client request
    const temperature = agentConfig?.temperature ?? requestedTemperature;
    // Client-sent max_tokens wins; otherwise apply the server ceiling (if any); else no cap.
    const effectiveMaxTokens = max_tokens ?? LLM_MAX_TOKENS;
    // gpt-5.x + o-series require `max_completion_tokens`; everything else (gpt-4.x, Ollama) uses `max_tokens`.
    // Classified per call from the model actually being sent — the fallback retry switches models, so a
    // single precomputed object would send the wrong key on retry. `(^|/)` also matches provider-prefixed
    // ids (e.g. `openai/gpt-5`). Regex self-classifies future gpt-5.x/o models.
    const tokenParamFor = (m: string): Record<string, number> =>
      !effectiveMaxTokens ? {}
        : /(^|\/)(o\d|gpt-5)/.test(m)
          ? { max_completion_tokens: effectiveMaxTokens }
          : { max_tokens: effectiveMaxTokens };

    request.log.info({ backend, llmConfigured, ollamaAvailable, provider, model, requestedProvider, requestedModel, agentProvider: agentConfig?.modelPolicy.default_provider, agentModel: agentConfig?.modelPolicy.default_model, agentTemperature: agentConfig?.temperature }, 'Chat request backend selection');

    // Normalize message content so it matches the ChatCompletionRequest type (non-nullable content)
    // Preserve tool_calls (on assistant messages) and tool_call_id (on tool messages)
    // so Ollama can correctly associate tool results with the calls that produced them
    const normalizedMessages: NonNullableMessage[] = (messages as (Message & { tool_calls?: ToolCall[]; tool_call_id?: string })[]).map((m) => ({
      role: m.role,
      content: m.content ?? '',
      name: m.name,
      ...(m.tool_calls && { tool_calls: m.tool_calls }),
      ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
    }));

    // --- Agent: inject system prompt ---
    if (agentConfig?.systemPrompt) {
      normalizedMessages.unshift({
        role: 'system',
        content: agentConfig.systemPrompt,
      });
    }

    // --- Agent: filter tools ---
    // Tools arriving from the widget use two namespaces:
    //   • bare names       — server-side tools (defined in the agent's tools array)
    //   • postMessage_name — page-provided tools (prefixed by the loader)
    //   • postMessage:name — legacy page tools from cached loaders during deploys
    //
    // allowedTools (from agent.tools) gates bare-name tools.
    // pageTools policy gates prefixed page tools.
    const PM_PREFIXES = ['postMessage_', 'postMessage:'];
    let filteredTools = tools;
    if (agentConfig !== null && tools) {
      const allowed = agentConfig.allowedTools;          // null = no server tools defined
      const pagePolicy = agentConfig.pageTools;          // 'all' | { restricted: [...] } | { blocked: [...] }

      filteredTools = tools.filter((t) => {
        if (!t || t.type !== 'function' || !t.function || typeof t.function.name !== 'string') return false;
        const name = t.function.name;

        const pagePrefix = PM_PREFIXES.find((prefix) => name.startsWith(prefix));
        if (pagePrefix) {
          // Page tool — apply pageTools policy
          const bare = name.slice(pagePrefix.length);
          if (pagePolicy === 'all') return true;
          if (typeof pagePolicy === 'object' && 'restricted' in pagePolicy) {
            return pagePolicy.restricted.includes(bare);
          }
          if (typeof pagePolicy === 'object' && 'blocked' in pagePolicy) {
            return !pagePolicy.blocked.includes(bare);
          }
          return true;  // unrecognized policy → allow
        } else {
          // Server-side tool — apply allowedTools allowlist
          if (allowed === null) return true;    // no allowlist → pass all
          return allowed.includes(name);
        }
      });
    }

    // No backend reachable — deterministic mock (if enabled) so client gets a valid response.
    if (backend === 'fallback') {
      const response = respondMockOrError('no_backend', model, normalizedMessages, stream, reply, request.headers.origin);
      await recordUsage(model, reply.statusCode, response, provider);
      return response;
    }

    // Use a real LLM backend
    {
      try {
        // Select pre-constructed client based on backend
        const client = llmConfigured ? createLlmClient(provider) : ollamaClient;

        // Build request options once — gateway handles provider-specific quirks
        const requestOptions: ChatCompletionRequestWithTools = {
          model,
          messages: normalizedMessages as unknown as ChatCompletionRequest['messages'],
          ...(temperature !== undefined && { temperature }),
          ...(response_format && { response_format }),
        };

        // Include tools if provided (use filtered tools for agent policy)
        if (filteredTools && filteredTools.length > 0) {
          requestOptions.tools = filteredTools as ToolDef[];
        }

        // (Parsing helper is defined at module scope)

        // Handle streaming vs non-streaming
        if (stream) {
          // Set up SSE streaming with CORS headers
          reply.raw.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
            'access-control-allow-origin': request.headers.origin || '*',
            'access-control-allow-credentials': 'true',
          });

          // Start SSE heartbeat to prevent proxy timeout during slow model loading
          let heartbeatInterval: NodeJS.Timeout | null = null;
          if (STREAMING_HEARTBEAT_ENABLED) {
            // Send initial warming event
            reply.raw.write(': heartbeat\n\n');

            heartbeatInterval = setInterval(() => {
              try {
                reply.raw.write(': heartbeat\n\n');
              } catch (e) {
                // Connection closed, clear interval
                if (heartbeatInterval) {
                  clearInterval(heartbeatInterval);
                  heartbeatInterval = null;
                }
              }
            }, STREAMING_HEARTBEAT_MS);
          }

          try {
            const requestForClient = {
              ...requestOptions,
              ...tokenParamFor(model),
              ...(filteredTools && filteredTools.length > 0 && { tools: requestOptions.tools }),
              stream: true as const,
              stream_options: { include_usage: true },
            };
            const streamResponse = client.createChatCompletionStream(requestForClient as unknown as ClientChatCompletionRequest);

            // Buffer map for accumulating assistant content per chat id
            const buffers: Record<string, string> = {};
            // Buffer for partial <think> tags that span multiple chunks
            const thinkBuffer = { partial: '' };
            let latestUsage: TokenUsage | undefined;

            for await (const chunk of streamResponse) {
              latestUsage = (chunk as unknown as { usage?: TokenUsage }).usage || latestUsage;
              try {
                const id = chunk.id as string;

                // Normalize thinking tokens before forwarding
                const normalized = normalizeChunkThinking(chunk as unknown as Record<string, unknown>, thinkBuffer);
                const choice = (normalized.choices as Array<Record<string, unknown>>)?.[0];
                const delta = choice?.delta as Record<string, unknown> | undefined;

                // Initialize buffer
                if (!buffers[id]) buffers[id] = '';

                // Accumulate content deltas for parsing when the stream finishes
                if (delta?.content) {
                  buffers[id] += delta.content as string;
                }

                // Forward normalized chunk (thinking extracted into delta.thinking)
                reply.raw.write(`data: ${JSON.stringify(normalized)}\n\n`);

                // If model finished this message, attempt to parse as tool call and emit tool_calls
                const finishReason = (choice as StreamingChoice)?.finish_reason || (delta as StreamingChoice)?.finish_reason;
                if (finishReason === 'stop') {
                  const content = buffers[id] || '';
                  const extracted = tryExtractToolCallsFromContent(content, requestOptions.tools as ToolDef[] | undefined);
                  if (extracted && extracted.length > 0) {
                    const toolCallsWithIndex = extracted.map((tc: ToolCall, idx: number) => ({
                      index: idx,
                      id: tc.id || `call_${Date.now()}_${idx}`,
                      type: tc.type,
                      function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments,
                      }
                    }));

                    const toolChunk = {
                      id,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [{ index: 0, delta: { tool_calls: toolCallsWithIndex }, finish_reason: null }]
                    };
                    reply.raw.write(`data: ${JSON.stringify(toolChunk)}\n\n`);
                  }
                  // cleanup buffer
                  delete buffers[id];
                }
              } catch (err) {
                // If anything goes wrong, still forward the chunk to the client
                reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            }

            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
            await recordUsage(model, 200, latestUsage ? { usage: latestUsage } : undefined, provider);

            // Clear heartbeat interval
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              heartbeatInterval = null;
            }

            return;
          } catch (streamError: unknown) {
            const errToLog = streamError instanceof Error ? streamError : new Error(String(streamError));
            request.log.error({ err: errToLog, backend }, 'LLM streaming failed after headers sent');

            // Clear heartbeat interval
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              heartbeatInterval = null;
            }

            // Model not found → retry with fallback model
            if (isModelNotFoundError(streamError) && model !== fallbackRetryModel && llmConfigured && fallbackRetryAllowed) {
              request.log.info({ originalModel: model, fallbackModel: fallbackRetryModel }, 'Model not found, retrying with fallback');
              const warning = buildFallbackWarning(model, fallbackRetryModel);
              reply.raw.write(`event: warning\ndata: ${JSON.stringify(warning)}\n\n`);

              try {
                const retryRequest = {
                  ...requestOptions,
                  model: fallbackRetryModel,
                  ...tokenParamFor(fallbackRetryModel),
                  ...(filteredTools && filteredTools.length > 0 && { tools: filteredTools }),
                  stream: true as const,
                  stream_options: { include_usage: true },
                };
                const retryStream = client.createChatCompletionStream(retryRequest as unknown as ClientChatCompletionRequest);
                const retryThinkBuffer = { partial: '' };
                let retryLatestUsage: TokenUsage | undefined;
                for await (const chunk of retryStream) {
                  retryLatestUsage = (chunk as unknown as { usage?: TokenUsage }).usage || retryLatestUsage;
                  const normalized = normalizeChunkThinking(chunk as unknown as Record<string, unknown>, retryThinkBuffer);
                  reply.raw.write(`data: ${JSON.stringify(normalized)}\n\n`);
                }
                await recordUsage(fallbackRetryModel, 200, retryLatestUsage ? { usage: retryLatestUsage } : undefined, provider);
              } catch (retryError) {
                request.log.error({ err: retryError }, 'Fallback model also failed');
              }
            }

            // Headers already sent, just end the stream
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
            return;
          }
        } else {
          const requestForClientNonStream = {
            ...requestOptions,
            ...tokenParamFor(model),
            ...(filteredTools && filteredTools.length > 0 && { tools: requestOptions.tools }),
            stream: false as const,
          };
          const response = await client.createChatCompletion(requestForClientNonStream as unknown as ClientChatCompletionRequest);
          // Normalize thinking tokens and extract tool calls from non-streaming response
          try {
            if (response && Array.isArray(response.choices)) {
              for (const choice of response.choices) {
                const msg = choice.message as ChatMessage;
                if (msg) {
                  // Extract thinking tokens (e.g. <think> tags, reasoning_content)
                  normalizeMessageThinking(msg as Record<string, unknown>);

                  // Try to convert plain JSON content to tool_calls
                  if (!msg.tool_calls && typeof msg.content === 'string') {
                    const extracted = tryExtractToolCallsFromContent(msg.content, requestOptions.tools as ToolDef[] | undefined);
                    if (extracted && extracted.length > 0) {
                      msg.tool_calls = extracted;
                    }
                  }
                }
              }
            }
          } catch (e) {
            // No-op: parsing fallback should not break the response
          }
          await recordUsage(model, 200, response, provider);
          return response;
        }
      } catch (error: unknown) {
        const errToLog = error instanceof Error ? error : new Error(String(error));
        request.log.error({ err: errToLog, backend }, 'LLM request failed, falling back to local generator');
        // Only fall through if headers haven't been sent yet
        if (reply.raw.headersSent) {
          return;
        }

        // Model not found → retry with fallback model
        if (isModelNotFoundError(error) && model !== fallbackRetryModel && llmConfigured && fallbackRetryAllowed) {
          request.log.info({ originalModel: model, fallbackModel: fallbackRetryModel }, 'Model not found, retrying with fallback');
          try {
            const retryRequest = {
              model: fallbackRetryModel,
              messages: normalizedMessages as unknown as ChatCompletionRequest['messages'],
              ...tokenParamFor(fallbackRetryModel),
              ...(temperature !== undefined && { temperature }),
              ...(response_format && { response_format }),
              ...(filteredTools && filteredTools.length > 0 && { tools: filteredTools as ToolDef[] }),
              stream: false as const,
            };
            const retryResponse = await createLlmClient(provider).createChatCompletion(retryRequest as unknown as ClientChatCompletionRequest);
            if (retryResponse && Array.isArray(retryResponse.choices)) {
              for (const choice of retryResponse.choices) {
                const msg = choice.message as ChatMessage;
                if (msg) {
                  normalizeMessageThinking(msg as Record<string, unknown>);
                  if (!msg.tool_calls && typeof msg.content === 'string') {
                    const extracted = tryExtractToolCallsFromContent(msg.content, filteredTools as ToolDef[] | undefined);
                    if (extracted && extracted.length > 0) {
                      msg.tool_calls = extracted;
                    }
                  }
                }
              }
            }
            await recordUsage(fallbackRetryModel, 200, retryResponse, provider);
            return {
              ...retryResponse,
              warning: buildFallbackWarning(model, fallbackRetryModel),
            };
          } catch (retryError) {
            request.log.error({ err: retryError }, 'Fallback model also failed');
          }
        }
      }
    }

    // LLM error final fallback: deterministic mock (if enabled), else a real 503.
    // Reached only from the non-stream path — streaming failures end the stream above.
    const response = respondMockOrError('llm_error', model, normalizedMessages, stream, reply, request.headers.origin);
    await recordUsage(model, reply.statusCode, response, provider);
    return response;
  });
};

export default chatRoute;
