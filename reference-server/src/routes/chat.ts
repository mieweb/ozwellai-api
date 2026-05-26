import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { validateAuth, createError, generateId, countTokens, isOllamaAvailable, getOllamaDefaultModel, isAgentKey, extractToken, isLLMBackendConfigured } from '../util';
import { agentStore, type PageToolsPolicy } from '../storage/agents';
import * as yaml from 'yaml';
import OzwellAI from 'ozwellai';
import type { ChatCompletionRequest as ClientChatCompletionRequest } from 'ozwellai';
import type { ChatCompletionRequest, Message } from '../../../spec/index';
import { generateMockResponse, extractUserMessage, hasToolResult, extractToolResult, type ChatMessage as MockChatMessage } from './mock-chat';

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
type ChatCompletionRequestWithTools = ChatCompletionRequest & { tools?: ToolDef[] };
type NonNullableMessage = { role: Message['role']; content: string; name?: Message['name']; tool_calls?: ToolCall[]; tool_call_id?: string };

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
// distinguish a deterministic mock from a real LLM answer (mirrors how the fallback path
// sets the response `model` to the actual fallback model rather than the originally
// requested one). The original requested model is preserved on the warning payload.
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

// Pre-construct LLM clients once (reused across all requests)
const llmClient = isLLMBackendConfigured()
  ? new OzwellAI({
      apiKey: process.env.LLM_API_KEY || '',
      baseURL: process.env.LLM_BASE_URL!,
      timeout: 120000,
      defaultHeaders: {
        ...(LLM_PROVIDER && { 'x-portkey-provider': LLM_PROVIDER }),
      },
    })
  : null;

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
  model: string,
  warning: MockWarning,
) {
  const { assistantMsg, finishReason } = buildMockAssistant(messages);
  const promptText = messages.map((m) => m.content).join(' ');
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
  model: string,
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
                content: { type: 'string' },
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

    // --- Agent key resolution ---
    let agentConfig: { systemPrompt: string; allowedTools: string[] | null; pageTools: PageToolsPolicy; model: string | null; temperature: number | null; type: 'mock' | null } | null = null;

    if (isAgentKey(request.headers.authorization)) {
      const agentKey = extractToken(request.headers.authorization);
      const agent = agentStore.getByKey(agentKey);
      if (!agent) {
        reply.code(401);
        return createError(`Agent key not found: ...${agentKey.slice(-4)}. Verify the key exists and the server has the agent database.`, 'invalid_request_error');
      }

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
        model: (parsed.model as string | undefined) || null,
        temperature: (parsed.temperature as number | undefined) ?? null,
        type: parsed.type === 'mock' ? 'mock' : null,
      };
    }

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
      const mockModel = agentConfig.model || 'mock';
      const warning = buildMockWarning('mock_agent', mockModel);
      if (stream) {
        dispatchMockStream(mockMessages, mockModel, reply, request.headers.origin, warning);
        return;
      }
      return dispatchMockNonStream(mockMessages, mockModel, warning);
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

    const { model: requestedModel, messages, tools, stream = false, max_tokens, temperature: requestedTemperature = 0.7, response_format } = body as ChatCompletionRequestWithTools & { response_format?: { type: string } };
    // Agent-configured model takes precedence, then client request, then server default
    const model = agentConfig?.model || requestedModel || DEFAULT_MODEL;
    // Agent-configured temperature takes precedence over client request
    const temperature = agentConfig?.temperature ?? requestedTemperature;

    request.log.info({ backend, llmConfigured, ollamaAvailable, model, requestedModel, agentModel: agentConfig?.model, agentTemperature: agentConfig?.temperature }, 'Chat request backend selection');

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
    //
    // allowedTools (from agent.tools) gates bare-name tools.
    // pageTools policy gates postMessage_-prefixed tools.
    const PM_PREFIX = 'postMessage_';
    let filteredTools = tools;
    if (agentConfig !== null && tools) {
      const allowed = agentConfig.allowedTools;          // null = no server tools defined
      const pagePolicy = agentConfig.pageTools;          // 'all' | { restricted: [...] } | { blocked: [...] }

      filteredTools = tools.filter((t) => {
        if (!t || t.type !== 'function' || !t.function || typeof t.function.name !== 'string') return false;
        const name = t.function.name;

        if (name.startsWith(PM_PREFIX)) {
          // Page tool — apply pageTools policy
          const bare = name.slice(PM_PREFIX.length);
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

    // No backend reachable — fall through to deterministic mock so client always gets a valid response.
    if (backend === 'fallback') {
      const warning = buildMockWarning('no_backend', model);
      if (stream) {
        dispatchMockStream(normalizedMessages, model, reply, request.headers.origin, warning);
        return;
      }
      return dispatchMockNonStream(normalizedMessages, model, warning);
    }

    // Use a real LLM backend
    {
      try {
        // Select pre-constructed client based on backend
        const client = llmConfigured ? llmClient! : ollamaClient;

        // Build request options once — gateway handles provider-specific quirks
        const requestOptions: ChatCompletionRequestWithTools = {
          model,
          messages: normalizedMessages as unknown as ChatCompletionRequest['messages'],
          ...(max_tokens && { max_tokens }),
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
              ...(filteredTools && filteredTools.length > 0 && { tools: requestOptions.tools }),
              stream: true as const,
            };
            const streamResponse = client.createChatCompletionStream(requestForClient as unknown as ClientChatCompletionRequest);

            // Buffer map for accumulating assistant content per chat id
            const buffers: Record<string, string> = {};
            // Buffer for partial <think> tags that span multiple chunks
            const thinkBuffer = { partial: '' };

            for await (const chunk of streamResponse) {
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
            if (isModelNotFoundError(streamError) && model !== DEFAULT_MODEL && llmConfigured) {
              request.log.info({ originalModel: model, fallbackModel: DEFAULT_MODEL }, 'Model not found, retrying with fallback');
              const warning = buildFallbackWarning(model, DEFAULT_MODEL);
              reply.raw.write(`event: warning\ndata: ${JSON.stringify(warning)}\n\n`);

              try {
                const retryRequest = {
                  ...requestOptions,
                  model: DEFAULT_MODEL,
                  ...(filteredTools && filteredTools.length > 0 && { tools: filteredTools }),
                  stream: true as const,
                };
                const retryStream = client.createChatCompletionStream(retryRequest as unknown as ClientChatCompletionRequest);
                const retryThinkBuffer = { partial: '' };
                for await (const chunk of retryStream) {
                  const normalized = normalizeChunkThinking(chunk as unknown as Record<string, unknown>, retryThinkBuffer);
                  reply.raw.write(`data: ${JSON.stringify(normalized)}\n\n`);
                }
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
        if (isModelNotFoundError(error) && model !== DEFAULT_MODEL && llmConfigured) {
          request.log.info({ originalModel: model, fallbackModel: DEFAULT_MODEL }, 'Model not found, retrying with fallback');
          try {
            const retryRequest = {
              model: DEFAULT_MODEL,
              messages: normalizedMessages as unknown as ChatCompletionRequest['messages'],
              ...(max_tokens && { max_tokens }),
              ...(temperature !== undefined && { temperature }),
              ...(response_format && { response_format }),
              ...(filteredTools && filteredTools.length > 0 && { tools: filteredTools as ToolDef[] }),
              stream: false as const,
            };
            const retryResponse = await llmClient!.createChatCompletion(retryRequest as unknown as ClientChatCompletionRequest);
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
            return {
              ...retryResponse,
              warning: buildFallbackWarning(model, DEFAULT_MODEL),
            };
          } catch (retryError) {
            request.log.error({ err: retryError }, 'Fallback model also failed');
          }
        }
      }
    }

    // LLM error final fallback: dispatch deterministic mock so the client always gets a valid response.
    // Warning marker tells caller the configured LLM failed — never silent.
    const warning = buildMockWarning('llm_error', model);
    if (stream) {
      dispatchMockStream(normalizedMessages, model, reply, request.headers.origin, warning);
      return;
    }
    return dispatchMockNonStream(normalizedMessages, model, warning);
  });
};

export default chatRoute;
