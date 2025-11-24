import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, SimpleTextGenerator, generateId, countTokens } from '../util';
import OzwellAI from 'ozwellai';
import type { ChatCompletionRequest as ClientChatCompletionRequest } from 'ozwellai';
import type { ChatCompletionRequest, Message } from '../../../spec/index';

// Local helper types to support tool definitions in the server
type ToolFunction = {
  name: string;
  description?: string;
  parameters?: unknown;
};

type ToolDef = { type: 'function'; function: ToolFunction };
type ChatCompletionRequestWithTools = ChatCompletionRequest & { tools?: ToolDef[] };
type NonNullableMessage = { role: Message['role']; content: string; name?: Message['name'] };

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
              properties: {
                role: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['role', 'content']
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
          temperature: { type: 'number' }
        },
        required: ['model', 'messages']
      }
    },
  }, async (request, reply) => {
    // Validate authorization
    if (!validateAuth(request.headers.authorization)) {
      reply.code(401);
      return createError('Invalid API key provided', 'invalid_request_error');
    }

    const body = request.body as ChatCompletionRequestWithTools;
    const { model, messages, tools, stream = false, max_tokens = 150, temperature = 0.7 } = body;

    // Normalize message content so it matches the ChatCompletionRequest type (non-nullable content)
    const normalizedMessages: NonNullableMessage[] = (messages as Message[]).map((m) => ({
      role: m.role,
      content: m.content ?? '',
      name: m.name
    }));

    // Extract API key from authorization header
    const authHeader = request.headers.authorization || '';
    const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();

    // Check if we should proxy to Ollama
    const useOllama = apiKey.toLowerCase() === 'ollama';

    // Validate model
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
          timeout: 300000 // 5 minutes - Ollama can be slow with large tool contexts
        });

        // Pass through without preprocessing (client-side handles parsing)
        const requestOptions: ChatCompletionRequestWithTools = {
          model,
          messages: normalizedMessages as unknown as ChatCompletionRequest['messages'],
          ...(max_tokens && { max_tokens }),
          ...(temperature !== undefined && { temperature }),
        };

        // Include tools if provided
        if (tools && tools.length > 0) {
          requestOptions.tools = tools as ToolDef[];
        }

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

          try {
            // Client type may not include "tools" in the ChatCompletionRequest by design,
            // so cast via unknown to pass through our tooling information to the client.
            const requestForClient: ChatCompletionRequest = {
              model: requestOptions.model,
              messages: requestOptions.messages as ChatCompletionRequest['messages'],
              ...(max_tokens && { max_tokens }),
              ...(temperature !== undefined && { temperature }),
              ...(tools && tools.length > 0 && { tools: requestOptions.tools }),
              stream: true,
            };
            const streamResponse = ollamaClient.createChatCompletionStream(requestForClient as unknown as ClientChatCompletionRequest);

            for await (const chunk of streamResponse) {
              // Pass through chunk unchanged (client-side handles parsing)
              reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }

            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
            return;
          } catch (streamError: unknown) {
            const errToLog = streamError instanceof Error ? streamError : new Error(String(streamError));
            request.log.error({ err: errToLog }, 'Ollama streaming failed after headers sent');
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
            ...(tools && tools.length > 0 && { tools: requestOptions.tools }),
            stream: false,
          };
          const response = await ollamaClient.createChatCompletion(requestForClientNonStream as unknown as ClientChatCompletionRequest);
          // Pass through response unchanged (client-side handles parsing)
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
