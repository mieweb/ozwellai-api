import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, SimpleTextGenerator, generateId, countTokens, isOllamaAvailable, getOllamaDefaultModel, isAgentKey, extractToken } from '../util';
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

    const body = request.body as ChatCompletionRequestWithTools;
    
    // --- Agent key resolution ---
    let agentSystemPrompt: string | null = null;
    let agentAllowedTools: string[] | null = null;
    let agentModel: string | null = null;
    let agentTemperature: number | null = null;

    if (isAgentKey(request.headers.authorization)) {
      const agentKey = extractToken(request.headers.authorization);
      const agent = agentStore.getByKey(agentKey);
      if (!agent) {
        reply.code(401);
        return createError(`Agent key not found: ...${agentKey.slice(-4)}. Verify the key exists and the server has the agent database.`, 'invalid_request_error');
      } else {
        // Use agent instructions as the system prompt
        let systemPrompt = agent.instructions || '';

        // Append behavior metadata (tone, language, rules) as a structured
        // supplement AFTER the instructions so they don't dilute or compete
        // with the primary prompt.  Rules are formatted as bullet points for
        // clarity, and only non-instruction metadata (tone/language) plus
        // explicit rules are included.
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

        agentSystemPrompt = systemPrompt;

        // Extract allowed tools from agent (tools can be strings or objects with .name)
        if (agent.tools && Array.isArray(agent.tools)) {
          agentAllowedTools = agent.tools.map(t => typeof t === 'string' ? t : t.name);
        }

        // Extract model and temperature overrides from agent definition
        if (agent.model) {
          agentModel = agent.model;
        }
        if (agent.temperature !== undefined && agent.temperature !== null) {
          agentTemperature = agent.temperature;
        }
      }
    }

    // Check if Ollama is available as a backend (check early to determine default model)
    const ollamaAvailable = await isOllamaAvailable();
    
    // Server-side default model - use Ollama-compatible model when Ollama is available
    const OPENAI_DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-4o-mini';
    const DEFAULT_MODEL = ollamaAvailable ? getOllamaDefaultModel() : OPENAI_DEFAULT_MODEL;
    
    const { model: requestedModel, messages, tools, stream = false, max_tokens = 150, temperature: requestedTemperature = 0.7, response_format } = body as ChatCompletionRequestWithTools & { response_format?: { type: string } };
    // Use requested model if provided, then agent model, then server default
    const model = requestedModel || agentModel || DEFAULT_MODEL;
    // Use agent temperature if set (client-specified temperature takes precedence via requestedTemperature)
    const temperature = agentTemperature ?? requestedTemperature;
    
    request.log.info({ ollamaAvailable, model, requestedModel, agentModel, agentTemperature }, 'Chat request model selection');

    // Normalize message content so it matches the ChatCompletionRequest type (non-nullable content)
    // Preserve tool_calls (on assistant messages) and tool_call_id (on tool messages)
    // so Ollama can correctly associate tool results with the calls that produced them
    const normalizedMessages: NonNullableMessage[] = (messages as Message[]).map((m) => {
      const msg: NonNullableMessage = {
        role: m.role,
        content: m.content ?? '',
        name: m.name
      };
      // Preserve tool_calls on assistant messages
      const raw = m as Record<string, unknown>;
      if (raw.tool_calls && Array.isArray(raw.tool_calls)) {
        msg.tool_calls = raw.tool_calls as ToolCall[];
      }
      // Preserve tool_call_id on tool result messages
      if (typeof raw.tool_call_id === 'string') {
        msg.tool_call_id = raw.tool_call_id;
      }
      return msg;
    });

    // --- Agent: inject system prompt ---
    if (agentSystemPrompt) {
      // Prepend agent instructions as the first system message
      normalizedMessages.unshift({
        role: 'system',
        content: agentSystemPrompt,
      });
    }

    // --- Agent: filter tools by allowed list ---
    let filteredTools = tools;
    if (agentAllowedTools && tools) {
      filteredTools = tools.filter(
        (t) =>
          t &&
          t.type === 'function' &&
          t.function &&
          typeof t.function.name === 'string' &&
          agentAllowedTools!.includes(t.function.name)
      );
    }

    // Use Ollama if available (checked independently of auth token)
    const useOllama = ollamaAvailable;
    
    // If no backend is available, redirect to mock endpoint
    if (!ollamaAvailable) {
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

    // Validate model (only if not using Ollama - Ollama accepts any model)
    const supportedModels = ['gpt-4o', 'gpt-4o-mini'];
    if (!useOllama && !supportedModels.includes(model)) {
      reply.code(400);
      return createError(`Model '${model}' not found`, 'invalid_request_error', 'model');
    }

    // If using Ollama, proxy the request
    if (useOllama) {
      try {
        const ollamaClient = new OzwellAI({
          apiKey: 'ollama',
          baseURL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
          timeout: 120000 // 2 minutes - reasonable timeout for Ollama requests
        });

        // Pass through without preprocessing (client-side handles parsing)
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
            // Client type may not include "tools" in the ChatCompletionRequest by design,
            // so cast via unknown to pass through our tooling information to the client.
            const requestForClient: ChatCompletionRequest = {
              model: requestOptions.model,
              messages: requestOptions.messages as ChatCompletionRequest['messages'],
              ...(max_tokens && { max_tokens }),
              ...(temperature !== undefined && { temperature }),
              ...(response_format && { response_format }),
              ...(filteredTools && filteredTools.length > 0 && { tools: requestOptions.tools }),
              stream: true,
            };
            const streamResponse = ollamaClient.createChatCompletionStream(requestForClient as unknown as ClientChatCompletionRequest);

            // Buffer map for accumulating assistant content per chat id
            const buffers: Record<string, string> = {};

            for await (const chunk of streamResponse) {
              try {
                const id = chunk.id as string;
                const choice = chunk.choices?.[0];
                const delta = choice?.delta;

                // Initialize buffer
                if (!buffers[id]) buffers[id] = '';

                // Accumulate content deltas for parsing when the stream finishes
                if (delta?.content) {
                  buffers[id] += delta.content;
                }

                // Forward original chunk unchanged
                reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);

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
            request.log.error({ err: errToLog }, 'Ollama streaming failed after headers sent');

            // Clear heartbeat interval
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              heartbeatInterval = null;
            }

            // Headers already sent, just end the stream
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
            return;
          }
        } else {
          const requestForClientNonStream: ChatCompletionRequest = {
            model: requestOptions.model,
            messages: requestOptions.messages as ChatCompletionRequest['messages'],
            ...(max_tokens && { max_tokens }),
            ...(temperature !== undefined && { temperature }),
            ...(response_format && { response_format }),
            ...(filteredTools && filteredTools.length > 0 && { tools: requestOptions.tools }),
            stream: false,
          };
          const response = await ollamaClient.createChatCompletion(requestForClientNonStream as unknown as ClientChatCompletionRequest);
          // If the model returned plain JSON as assistant content, try to convert it to tool_calls
          try {
            if (response && Array.isArray(response.choices)) {
              for (const choice of response.choices) {
                const msg = choice.message as ChatMessage;
                if (msg && !msg.tool_calls && typeof msg.content === 'string') {
                  const extracted = tryExtractToolCallsFromContent(msg.content, requestOptions.tools as ToolDef[] | undefined);
                  if (extracted && extracted.length > 0) {
                    msg.tool_calls = extracted;
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
        request.log.error({ err: errToLog }, 'Ollama request failed, falling back to local generator');
        // Only fall through if headers haven't been sent yet
        if (reply.raw.headersSent) {
          return;
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
