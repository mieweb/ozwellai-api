import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { validateAuth, createError, generateId, countTokens, envFallbackModel, isAgentKey, extractToken, parsePositiveEnvNumber } from '../util';
import { agentStore, findProviderModel, modelRecordMatches, type AgentModelPolicy, type PageToolsPolicy } from '../storage/agents';
import * as yaml from 'yaml';
import OzwellAI from 'ozwellai';
import type { ChatCompletionRequest as ClientChatCompletionRequest } from 'ozwellai';
import type { ChatCompletionRequest, Message } from '../../../spec/index';
import { createAICompletion, collectCompletionStream, type CompletionParams } from '@mieweb/harness-core';
import { generateMockResponse, extractUserMessage, hasToolResult, extractToolResult, contentToText, type ChatMessage as MockChatMessage } from './mock-chat';
import { getCachedModelsList } from './models';
import { quotaExceededError, resolveRouteUsageContext } from './quota';
import { ensureProvidersConfigured, isDirectProviderConfigured, resolveChatTransport } from '../llm/providers';
import { convertTiffParts, TiffConversionError } from '../llm/tiff';
import { capabilitiesFor, createChunkTranslator, toChatCompletion, toChatUsage, toResponsesInput, toResponsesTools, usesReasoningTokenParam, type ChatInputMessage, type ChatToolDef } from '../llm/harness-adapter';

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

// Detect model-not-found errors: provider SDKs carry `status: 404`; the gateway path surfaces it in the message.
function isModelNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && (error as { status?: unknown }).status === 404) return true;
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
// Mock responses are OFF by default — keep real LLM errors visible in production.
// Set ALLOW_MOCK=true to return deterministic mock replies (no LLM configured,
// LLM errored, or an agent declares type: mock).
const MOCK_ENABLED = process.env.ALLOW_MOCK === 'true';
// No output cap by default. LLM_MAX_TOKENS sets a server-wide ceiling; a client
// that sends its own max_tokens always overrides this.
const LLM_MAX_TOKENS = parsePositiveEnvNumber('LLM_MAX_TOKENS');
const DEFAULT_ANTHROPIC_MAX_TOKENS = 1024;
// harness-core always sends an output cap; this is the direct-provider default when neither the
// request nor LLM_MAX_TOKENS names one.
const DEFAULT_DIRECT_MAX_TOKENS = 4096;

function providerTokenParams(provider: string, model: string, requestedMaxTokens?: number): Record<string, number> {
  const effectiveMaxTokens = requestedMaxTokens
    ?? LLM_MAX_TOKENS
    ?? (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MAX_TOKENS : undefined);

  if (!effectiveMaxTokens) return {};

  return usesReasoningTokenParam(model)
    ? { max_completion_tokens: effectiveMaxTokens }
    : { max_tokens: effectiveMaxTokens };
}

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

// Opens the SSE response and keeps it alive with heartbeats until `end()`.
function startSse(reply: FastifyReply, origin: string | undefined) {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'access-control-allow-origin': origin || '*',
    'access-control-allow-credentials': 'true',
  });

  let heartbeat: NodeJS.Timeout | null = null;
  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  if (STREAMING_HEARTBEAT_ENABLED) {
    // Initial warming comment so proxies see bytes before the model loads
    reply.raw.write(': heartbeat\n\n');
    heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        stopHeartbeat();
      }
    }, STREAMING_HEARTBEAT_MS);
  }

  return {
    writeData: (payload: unknown) => { reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`); },
    writeEvent: (event: string, payload: unknown) => { reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); },
    end: () => {
      stopHeartbeat();
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    },
  };
}

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
          // Allow nested fields (e.g. json_schema) to survive AJV's
          // removeAdditional:true — otherwise only `type` would pass through
          // and the json_schema payload would be silently stripped.
          response_format: { type: 'object', additionalProperties: true }
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
    const resolvedUsageContext = resolveRouteUsageContext(request.headers.authorization);
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
      if (!resolvedUsageContext.agent || !resolvedUsageContext.parentKey) {
        reply.code(401);
        return createError(`Agent key not found: ...${token.slice(-4)}. Verify the key exists and the server has the agent database.`, 'invalid_request_error');
      }
      const agent = resolvedUsageContext.agent;
      usageContext = {
        authType: resolvedUsageContext.authType,
        parentKeyId: resolvedUsageContext.parentKeyId,
        agentId: resolvedUsageContext.agentId,
      };

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
      usageContext = {
        authType: resolvedUsageContext.authType,
        parentKeyId: resolvedUsageContext.parentKeyId,
        agentId: null,
      };
    }

    const recordUsage = (model: string | null, statusCode: number, response?: unknown, provider?: string | null) => {
      if (!usageContext) return;
      const usage = response && typeof response === 'object' && 'usage' in response
        ? (response as { usage?: TokenUsage }).usage
        : undefined;
      try {
        agentStore.recordUsageEvent({
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

    const quotaError = (requestedTokens: number) => {
      if (!usageContext) return null;
      return quotaExceededError(reply, usageContext.parentKeyId, usageContext.agentId, requestedTokens);
    };

    const estimateChatTokens = (items: Message[], maxTokens?: number) => {
      const outputBudget = maxTokens ?? LLM_MAX_TOKENS;
      const inputTokens = items.reduce((sum, message) => sum + countTokens(contentToText(message.content)), 0);
      const outputTokens = typeof outputBudget === 'number' && outputBudget > 0 ? Math.floor(outputBudget) : 0;
      return inputTokens + outputTokens;
    };

    // Runs only after auth, model and quota checks so rejected requests never pay for decoding.
    const tiffError = async (items: { content?: unknown }[]) => {
      try {
        await convertTiffParts(items);
        return null;
      } catch (err) {
        if (!(err instanceof TiffConversionError)) throw err;
        reply.code(400);
        return createError(err.message, 'invalid_request_error', 'messages', 'invalid_image');
      }
    };

    // Early exit for mock-type agents — skip backend probing entirely (no LLM ever called).
    if (agentConfig?.type === 'mock') {
      const { messages: rawMessages, stream = false, max_tokens } = body as ChatCompletionRequestWithTools;
      const quota = quotaError(estimateChatTokens(rawMessages as Message[], max_tokens));
      if (quota) return quota;
      const mockTiffError = await tiffError(rawMessages as Message[]);
      if (mockTiffError) return mockTiffError;
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
      recordUsage(mockModel, reply.statusCode, response);
      return response;
    }

    // Transport selection (see llm/providers.ts):
    // direct   → OpenAI / Anthropic / Ollama through harness-core
    // gateway  → LLM_BASE_URL (OpenAI-compatible gateway; rollback path)
    // fallback → mock/simple generator
    const { transport, ollamaAvailable } = await resolveChatTransport();
    const llmConfigured = transport === 'gateway';
    const backend = transport === 'gateway' ? 'llm' : transport;

    // Provider and model together, so an ambiguous fallback model resolves instead of returning
    // provider_required. Read per request: the env constants above are hoisted at module load, and
    // an admin save has to take effect without a restart.
    const serverDefault = agentStore.getServerDefaultModel();
    const fallbackDefault = serverDefault ?? envFallbackModel(llmConfigured, ollamaAvailable);
    const DEFAULT_MODEL = fallbackDefault.model;

    const { provider: requestedProvider, model: requestedModel, messages, tools, stream = false, max_tokens, temperature: requestedTemperature = 0.7, response_format } = body as ChatCompletionRequestWithTools;
    getCachedModelsList();
    const effectiveModels = agentConfig && usageContext?.parentKeyId && usageContext.agentId
      ? agentStore.listEffectiveProviderModelsForAgent(usageContext.parentKeyId, usageContext.agentId)
      : agentStore.listEffectiveProviderModels(usageContext?.parentKeyId ?? null);
    const selectedModel = requestedModel || agentConfig?.modelPolicy.default_model || DEFAULT_MODEL;
    const matchingModels = effectiveModels.filter(item => modelRecordMatches(item, selectedModel));
    const usingAgentDefaultModel = !requestedModel && Boolean(agentConfig?.modelPolicy.default_model);
    // Only the fallback may lend its provider. A model the caller named must still resolve on its
    // own, or an ambiguous request would silently be answered by the fallback's provider.
    const usingFallbackModel = !requestedModel && !usingAgentDefaultModel;
    const selectedProvider = requestedProvider
      // Only when the caller named no model. The agent's default provider goes with the agent's
      // default model; pinning it onto a model the caller asked for builds a pair that never
      // existed (anthropic + gpt-4.1) and fails before the registry lookup below can resolve it.
      || (!requestedModel ? agentConfig?.modelPolicy.default_provider : null)
      || (usingFallbackModel ? fallbackDefault.provider : null)
      || (matchingModels.length === 1 ? matchingModels[0].provider : null);
    if (!selectedProvider) {
      if (usingAgentDefaultModel && matchingModels.length === 0) {
        reply.code(400);
        return createError("This assistant's configured model is currently unavailable.", 'invalid_request_error', 'model', 'configured_model_unavailable');
      }
      // No match at all is not an ambiguous request: the model is not available to this caller, so
      // no provider they could send would help. Only a caller-named model reaches here — a fallback
      // always carries its own provider, so it never fails to resolve one and exits further down.
      if (matchingModels.length === 0) {
        reply.code(403);
        return createError('Requested provider/model is not allowed for this key or agent', 'invalid_request_error', 'model', 'model_not_allowed');
      }
      // Two or more matches: the model really is ambiguous and a provider really would settle it.
      reply.code(400);
      return createError('Provider is required for ambiguous model selection', 'invalid_request_error', 'provider', 'provider_required');
    }
    const allowedModel = findProviderModel(effectiveModels, selectedProvider, selectedModel);
    if (!allowedModel) {
      if (usingAgentDefaultModel) {
        reply.code(400);
        return createError("This assistant's configured model is currently unavailable.", 'invalid_request_error', 'model', 'configured_model_unavailable');
      }
      reply.code(403);
      // A model the caller named is theirs to change. One that came from the fallback chain is not,
      // and telling them to send a provider would not help — the fallback already has one.
      return createError(
        usingFallbackModel
          ? 'No default model is available for this key. Name a model in the request, or ask an admin to approve one.'
          : 'Requested provider/model is not allowed for this key or agent',
        'invalid_request_error',
        'model',
        'model_not_allowed',
      );
    }
    const provider = allowedModel.provider;
    const model = allowedModel.model;
    // Retry on the fallback only when this provider actually serves it. Undefined means no retry.
    const fallbackRetryModel = findProviderModel(effectiveModels, provider, DEFAULT_MODEL)?.model;
    // Agent-configured temperature takes precedence over client request
    const temperature = agentConfig?.temperature ?? requestedTemperature;
    // gpt-5.x + o-series require `max_completion_tokens`; everything else (gpt-4.x, Ollama) uses `max_tokens`.
    // Classified per call from the model actually being sent — the fallback retry switches models, so a
    // single precomputed object would send the wrong key on retry. `(^|/)` also matches provider-prefixed
    // ids (e.g. `openai/gpt-5`). Regex self-classifies future gpt-5.x/o models.
    const tokenParamFor = (m: string) => providerTokenParams(provider, m, max_tokens);
    const temperatureParamFor = (m: string): Record<string, number> =>
      temperature === undefined || provider === 'anthropic' || usesReasoningTokenParam(m) ? {} : { temperature };

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

    // Direct providers always send an output cap, so the quota estimate must reserve the same number
    // the request will actually carry. Gateway requests keep the request/env value (possibly none).
    const directMaxOutputTokens = max_tokens
      ?? LLM_MAX_TOKENS
      ?? (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MAX_TOKENS : DEFAULT_DIRECT_MAX_TOKENS);
    const quota = quotaError(estimateChatTokens(messages as Message[], backend === 'direct' ? directMaxOutputTokens : max_tokens));
    if (quota) return quota;
    const imageError = await tiffError(normalizedMessages);
    if (imageError) return imageError;

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
      recordUsage(model, reply.statusCode, response, provider);
      return response;
    }

    // --- Direct providers via harness-core ---
    if (backend === 'direct') {
      if (!isDirectProviderConfigured(provider)) {
        reply.code(503);
        return createError(`Provider '${provider}' is not configured on this server.`, 'server_error', 'provider', 'provider_not_configured');
      }
      ensureProvidersConfigured();

      // Legacy function-role messages carry no call id, so they cannot become a
      // function_call_output; refuse rather than silently re-role them as a user turn.
      const legacyFunctionIndex = normalizedMessages.findIndex((m) => m.role === 'function');
      if (legacyFunctionIndex !== -1) {
        reply.code(400);
        return createError(
          `messages[${legacyFunctionIndex}].role 'function' is not supported for direct providers; send a 'tool' message with tool_call_id.`,
          'invalid_request_error',
          `messages[${legacyFunctionIndex}].role`,
        );
      }
      const orphanToolIndex = normalizedMessages.findIndex((m) => m.role === 'tool' && !m.tool_call_id);
      if (orphanToolIndex !== -1) {
        reply.code(400);
        return createError(
          `messages[${orphanToolIndex}].tool_call_id is required for tool messages`,
          'invalid_request_error',
          `messages[${orphanToolIndex}].tool_call_id`,
        );
      }

      const { instructions, input } = toResponsesInput(normalizedMessages as ChatInputMessage[]);
      const harnessTools = toResponsesTools(filteredTools as ChatToolDef[] | undefined);
      const maxOutputTokens = directMaxOutputTokens;
      const buildParams = (m: string): CompletionParams => ({
        model: m,
        provider,
        instructions,
        input,
        temperature,
        maxOutputTokens,
        ...(harnessTools && { tools: harnessTools }),
        capabilities: capabilitiesFor(provider, m, maxOutputTokens),
        ...(response_format && { responseFormat: response_format as CompletionParams['responseFormat'] }),
      });
      const canRetryWithFallback = (error: unknown, m: string) =>
        isModelNotFoundError(error) && Boolean(fallbackRetryModel) && m !== fallbackRetryModel;

      if (stream) {
        const sse = startSse(reply, request.headers.origin);

        // Throws before any body write when the provider rejects the request (e.g. 404),
        // so a fallback retry can still start a clean stream.
        const streamOnce = async (m: string) => {
          const source = await createAICompletion(buildParams(m));
          const id = generateId('chatcmpl');
          const created = Math.floor(Date.now() / 1000);
          const translator = createChunkTranslator({ id, model: m, created });
          const thinkBuffer = { partial: '' };
          for await (const chunk of source) {
            for (const ccChunk of translator.translate(chunk)) {
              sse.writeData(normalizeChunkThinking(ccChunk as unknown as Record<string, unknown>, thinkBuffer));
            }
          }
          const terminal = translator.terminal;
          const usage = toChatUsage(terminal?.usage);
          // A provider failure or a stream that closed without any terminal chunk is not a
          // truncated success: report an error event so clients do not treat partial output as final.
          if (!terminal || terminal.status === 'failed' || terminal.status === 'error') {
            const reason = terminal?.reason || (terminal ? `Provider returned ${terminal.status}` : 'Provider stream ended without completing');
            request.log.error({ reason, provider, model: m }, 'Provider stream ended in failure');
            sse.writeEvent('error', { error: { message: reason, type: 'server_error' } });
            return { usage, statusCode: 502 };
          }
          let hasToolCalls = translator.toolCallCount > 0;
          if (!hasToolCalls) {
            const extracted = tryExtractToolCallsFromContent(translator.text, filteredTools as ToolDef[] | undefined);
            if (extracted && extracted.length > 0) {
              hasToolCalls = true;
              sse.writeData({
                id,
                object: 'chat.completion.chunk',
                created,
                model: m,
                choices: [{ index: 0, delta: { tool_calls: extracted.map((tc, idx) => ({ index: idx, ...tc })) }, finish_reason: null }],
              });
            }
          }
          for (const ccChunk of translator.finish(hasToolCalls)) sse.writeData(ccChunk);
          return { usage, statusCode: 200 };
        };

        const failStream = (m: string, err: unknown) => {
          const status = err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number'
            ? (err as { status: number }).status
            : 502;
          sse.writeEvent('error', { error: { message: 'Upstream provider request failed', type: 'server_error' } });
          recordUsage(m, status >= 400 ? status : 502, undefined, provider);
        };

        try {
          const result = await streamOnce(model);
          recordUsage(model, result.statusCode, result, provider);
        } catch (streamError: unknown) {
          request.log.error({ err: streamError, backend, provider }, 'Direct LLM streaming failed');
          if (canRetryWithFallback(streamError, model)) {
            request.log.info({ originalModel: model, fallbackModel: fallbackRetryModel }, 'Model not found, retrying with fallback');
            sse.writeEvent('warning', buildFallbackWarning(model, fallbackRetryModel!));
            try {
              const result = await streamOnce(fallbackRetryModel!);
              recordUsage(fallbackRetryModel!, result.statusCode, result, provider);
            } catch (retryError) {
              request.log.error({ err: retryError }, 'Fallback model also failed');
              failStream(fallbackRetryModel!, retryError);
            }
          } else {
            failStream(model, streamError);
          }
        }
        sse.end();
        return;
      }

      const completeOnce = async (m: string) => {
        const source = await createAICompletion(buildParams(m));
        const collected = await collectCompletionStream(source);
        if (collected.status === 'failed' || collected.status === 'error') {
          throw new Error(collected.reason || `Provider returned ${collected.status}`);
        }
        const response = toChatCompletion(collected, { id: generateId('chatcmpl'), model: m, created: Math.floor(Date.now() / 1000) });
        const msg = response.choices[0].message as ChatMessage;
        normalizeMessageThinking(msg as Record<string, unknown>);
        if (!msg.tool_calls && typeof msg.content === 'string') {
          const extracted = tryExtractToolCallsFromContent(msg.content, filteredTools as ToolDef[] | undefined);
          if (extracted && extracted.length > 0) {
            msg.tool_calls = extracted;
            response.choices[0].finish_reason = 'tool_calls';
          }
        }
        return response;
      };

      try {
        const response = await completeOnce(model);
        recordUsage(model, 200, response, provider);
        return response;
      } catch (error: unknown) {
        request.log.error({ err: error, backend, provider }, 'Direct LLM request failed');
        if (canRetryWithFallback(error, model)) {
          request.log.info({ originalModel: model, fallbackModel: fallbackRetryModel }, 'Model not found, retrying with fallback');
          try {
            const retryResponse = await completeOnce(fallbackRetryModel!);
            recordUsage(fallbackRetryModel!, 200, retryResponse, provider);
            return { ...retryResponse, warning: buildFallbackWarning(model, fallbackRetryModel!) };
          } catch (retryError) {
            request.log.error({ err: retryError }, 'Fallback model also failed');
          }
        }
      }
      // Fall through to the llm_error mock/503 below.
    } else {
    // --- Gateway (LLM_BASE_URL) ---
      try {
        const client = createLlmClient(provider);

        // Build request options once — gateway handles provider-specific quirks
        const requestOptions: ChatCompletionRequestWithTools = {
          model,
          messages: normalizedMessages as unknown as ChatCompletionRequest['messages'],
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
              ...temperatureParamFor(model),
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

            recordUsage(model, 200, latestUsage ? { usage: latestUsage } : undefined, provider);
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();

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
            if (isModelNotFoundError(streamError) && fallbackRetryModel && model !== fallbackRetryModel && llmConfigured) {
              request.log.info({ originalModel: model, fallbackModel: fallbackRetryModel }, 'Model not found, retrying with fallback');
              const warning = buildFallbackWarning(model, fallbackRetryModel);
              reply.raw.write(`event: warning\ndata: ${JSON.stringify(warning)}\n\n`);

              try {
                const retryRequest = {
                  ...requestOptions,
                  model: fallbackRetryModel,
                  ...tokenParamFor(fallbackRetryModel),
                  ...temperatureParamFor(fallbackRetryModel),
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
                recordUsage(fallbackRetryModel, 200, retryLatestUsage ? { usage: retryLatestUsage } : undefined, provider);
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
            ...temperatureParamFor(model),
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
          recordUsage(model, 200, response, provider);
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
        if (isModelNotFoundError(error) && fallbackRetryModel && model !== fallbackRetryModel && llmConfigured) {
          request.log.info({ originalModel: model, fallbackModel: fallbackRetryModel }, 'Model not found, retrying with fallback');
          try {
            const retryRequest = {
              model: fallbackRetryModel,
              messages: normalizedMessages as unknown as ChatCompletionRequest['messages'],
              ...tokenParamFor(fallbackRetryModel),
              ...temperatureParamFor(fallbackRetryModel),
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
            recordUsage(fallbackRetryModel, 200, retryResponse, provider);
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
    recordUsage(model, reply.statusCode, response, provider);
    return response;
  });
};

export default chatRoute;
