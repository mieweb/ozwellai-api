import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, SimpleTextGenerator, generateId, countTokens, isOllamaAvailable, getOllamaDefaultModel, isAgentKey, extractToken, isLLMBackendConfigured } from '../util';
import { agentStore } from '../storage/agents';
import OzwellAI from 'ozwellai';
import type { ChatCompletionRequest as ClientChatCompletionRequest } from 'ozwellai';
import type { ChatCompletionRequest, Message } from '../../../spec/index';

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
    let agentConfig: { systemPrompt: string; allowedTools: string[] | null; model: string | null; temperature: number | null } | null = null;

    if (isAgentKey(request.headers.authorization)) {
      const agentKey = extractToken(request.headers.authorization);
      const agent = agentStore.getByKey(agentKey);
      if (!agent) {
        reply.code(401);
        return createError(`Agent key not found: ...${agentKey.slice(-4)}. Verify the key exists and the server has the agent database.`, 'invalid_request_error');
      }

      // Use agent instructions as the system prompt
      let systemPrompt = agent.instructions || '';

      // Append behavior metadata (tone, language, rules) as a structured
      // supplement AFTER the instructions so they don't dilute or compete
      // with the primary prompt.
      if (agent.behavior && typeof agent.behavior === 'object') {
        const b = agent.behavior as Record<string, unknown>;
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

      agentConfig = {
        systemPrompt,
        allowedTools: agent.tools && Array.isArray(agent.tools)
          ? agent.tools.map(t => typeof t === 'string' ? t : t.name)
          : [],
        model: agent.model || null,
        temperature: agent.temperature ?? null,
      };
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

    const { model: requestedModel, messages, tools, stream = false, max_tokens = 150, temperature: requestedTemperature = 0.7, response_format } = body as ChatCompletionRequestWithTools & { response_format?: { type: string } };
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

    // --- Agent: filter tools by allowed list ---
    let filteredTools = tools;
    if (agentConfig !== null && tools) {
      const allowed = agentConfig.allowedTools ?? [];
      filteredTools = tools.filter(
        (t) =>
          t &&
          t.type === 'function' &&
          t.function &&
          typeof t.function.name === 'string' &&
          allowed.includes(t.function.name)
      );
    }

    // If no real backend is available, redirect to mock endpoint
    if (backend === 'fallback') {
      // Forward to mock chat endpoint (use normalizedMessages which includes agent system prompt)
      const mockUrl = `http://localhost:${process.env.PORT || 3000}/mock/chat`;
      const mockBody = { ...body, messages: normalizedMessages, ...(filteredTools ? { tools: filteredTools } : {}) };
      try {
        const mockResponse = await fetch(mockUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': request.headers.authorization || 'Bearer mock'
          },
          body: JSON.stringify(mockBody)
        });
        
        if (stream) {
          // Forward SSE stream from mock
          reply.raw.writeHead(mockResponse.status, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
            'access-control-allow-origin': request.headers.origin || '*',
            'access-control-allow-credentials': 'true',
          });
          
          if (mockResponse.body) {
            const reader = mockResponse.body.getReader();
            try {
              let done = false;
              while (!done) {
                const result = await reader.read();
                done = result.done;
                if (!done) {
                  reply.raw.write(result.value);
                }
              }
            } finally {
              reply.raw.end();
            }
          }
          return;
        } else {
          const mockData = await mockResponse.json();
          return mockData;
        }
      } catch (mockError) {
        request.log.error({ err: mockError }, 'Mock endpoint failed, using simple generator');
        // Fall through to simple generator below
      }
    }

    // Use a real LLM backend
    if (backend !== 'fallback') {
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

    // Create prompt from messages
    const prompt = (messages as Message[]).map((msg) => `${msg.role}: ${msg.content}`).join('\n');
    const requestId = generateId('chatcmpl');
    const created = Math.floor(Date.now() / 1000);

    // Add OpenAI-compatible headers
    reply.headers({
      'x-request-id': `req_${Date.now()}`,
      'openai-processing-ms': '150',
      'openai-version': '2020-10-01',
    });

    if (stream) {
      // Streaming response with CORS headers
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': request.headers.origin || '*',
        'access-control-allow-credentials': 'true',
        'x-request-id': `req_${Date.now()}`,
        'openai-processing-ms': '150',
        'openai-version': '2020-10-01',
      });

      const generator = SimpleTextGenerator.generateStream(prompt, max_tokens);

      // Send initial chunk with role
      const initialChunk = {
        id: requestId,
        object: 'chat.completion.chunk' as const,
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null,
        }],
      };
      reply.raw.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

      // Send content chunks
      for (const token of generator) {
        const chunk = {
          id: requestId,
          object: 'chat.completion.chunk' as const,
          created,
          model,
          choices: [{
            index: 0,
            delta: { content: token },
            finish_reason: null,
          }],
        };
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        // Add small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Send final chunk
      const finalChunk = {
        id: requestId,
        object: 'chat.completion.chunk' as const,
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop' as const,
        }],
      };
      reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    // Non-streaming response
    const content = SimpleTextGenerator.generate(prompt, max_tokens, temperature);
    const promptTokens = countTokens(prompt);
    const completionTokens = countTokens(content);

    return {
      id: requestId,
      object: 'chat.completion' as const,
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant' as const,
          content,
          name: undefined,
          function_call: undefined,
          tool_calls: undefined,
          tool_call_id: undefined,
        },
        finish_reason: 'stop' as const,
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  });
};

export default chatRoute;
