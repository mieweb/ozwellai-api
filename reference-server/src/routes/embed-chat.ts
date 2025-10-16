import { FastifyPluginAsync } from 'fastify';
import OzwellAI from 'ozwellai';
import { SimpleTextGenerator, generateId, countTokens } from '../util';

interface ChatMessage {
  role: string;
  content: string;
}

interface Tool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

interface EmbedChatRequest {
  messages?: ChatMessage[];
  message?: string;
  model?: string;
  system?: string;
  tools?: Tool[];
  context?: any;
}

const DEFAULT_MODEL = (process.env.EMBED_CHAT_MODEL || 'llama3').trim();
const API_KEY = (process.env.EMBED_CHAT_API_KEY || process.env.OZWELL_API_KEY || 'ollama').trim();
const STATIC_BASE_URL = process.env.EMBED_CHAT_BASE_URL || process.env.OZWELL_BASE_URL || undefined;

function createOzwellClient(request: any) {
  const overrideHeader = request.headers['x-ozwell-base-url'] as string | undefined;

  if (overrideHeader) {
    return new OzwellAI({ apiKey: API_KEY, baseURL: overrideHeader });
  }

  if (STATIC_BASE_URL) {
    return new OzwellAI({ apiKey: API_KEY, baseURL: STATIC_BASE_URL });
  }

  if (API_KEY.toLowerCase() === 'ollama') {
    return new OzwellAI({ apiKey: API_KEY, baseURL: 'http://127.0.0.1:11434' });
  }

  return new OzwellAI({ apiKey: API_KEY });
}

async function forwardToOzwell(request: any, model: string, messages: ChatMessage[], tools?: Tool[]) {
  const client = createOzwellClient(request);

  const requestOptions: any = {
    model,
    messages,
    stream: false,
  };

  // Include tools if provided
  if (tools && tools.length > 0) {
    requestOptions.tools = tools;
  }

  return client.createChatCompletion(requestOptions);
}

const embedChatRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/embed/chat', {
    schema: {
      body: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          message: { type: 'string' },
          model: { type: 'string' },
          system: { type: 'string' },
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
          context: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as EmbedChatRequest;
    const model = (body.model || DEFAULT_MODEL).trim();
    let systemPrompt = body.system || 'You are a helpful assistant.';

    // Inject context into system prompt if provided
    if (body.context) {
      systemPrompt += `\n\nCurrent page context:\n${JSON.stringify(body.context, null, 2)}`;
    }

    let messages: ChatMessage[] = [];

    if (Array.isArray(body.messages) && body.messages.length > 0) {
      messages = body.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const hasSystemMessage = messages.some((msg) => msg.role === 'system');
      if (!hasSystemMessage && systemPrompt) {
        messages.unshift({ role: 'system', content: systemPrompt });
      }
    } else if (body.message) {
      messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: body.message },
      ];
    } else {
      reply.code(400);
      return {
        error: {
          message: 'messages or message field is required',
          type: 'invalid_request_error',
        },
      };
    }

    console.log('[DEBUG] ===== REQUEST TO OLLAMA =====');
    console.log('[DEBUG] Tools being sent:', JSON.stringify(body.tools, null, 2));
    console.log('[DEBUG] System prompt:', systemPrompt);
    console.log('[DEBUG] Messages:', JSON.stringify(messages, null, 2));

    try {
      const response = await forwardToOzwell(request, model, messages, body.tools);

      console.log('[DEBUG] ===== OLLAMA RESPONSE =====');
      console.log('[DEBUG] Full response:', JSON.stringify(response, null, 2));

      const choice = response.choices?.[0];
      const assistantMessage = choice?.message || { role: 'assistant', content: '' };

      return {
        id: response.id,
        model: response.model,
        created: response.created,
        message: assistantMessage,
        usage: response.usage,
      };
    } catch (error) {
      request.log.error({ err: error }, 'Widget chat request failed, falling back to local generator');

      const prompt = messages.map((msg) => `${msg.role}: ${msg.content}`).join('\n');
      const fallback = SimpleTextGenerator.generate(prompt, 150);

      const fallbackMessage = {
        role: 'assistant' as const,
        content: fallback,
      };

      return {
        id: generateId('embedcmpl'),
        model,
        created: Math.floor(Date.now() / 1000),
        message: fallbackMessage,
        usage: {
          prompt_tokens: countTokens(prompt),
          completion_tokens: countTokens(fallback),
          total_tokens: countTokens(prompt) + countTokens(fallback),
        },
        warning: 'Response generated by fallback model because Ozwell SDK request failed.',
      };
    }
  });
};

export default embedChatRoute;
