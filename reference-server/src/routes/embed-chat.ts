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
  model: string;
  messages: ChatMessage[];
  tools?: Tool[];
  temperature?: number;
  max_tokens?: number;
}

const DEFAULT_MODEL = (process.env.EMBED_CHAT_MODEL || 'llama3').trim();
const API_KEY = (process.env.EMBED_CHAT_API_KEY || process.env.OZWELL_API_KEY || 'ollama').trim();
const STATIC_BASE_URL = process.env.EMBED_CHAT_BASE_URL || process.env.OZWELL_BASE_URL || undefined;

console.log('[DEBUG] OZWELL_BASE_URL from env:', process.env.OZWELL_BASE_URL);
console.log('[DEBUG] STATIC_BASE_URL:', STATIC_BASE_URL);
console.log('[DEBUG] API_KEY:', API_KEY);

function createOzwellClient(request: any) {
  const overrideHeader = request.headers['x-ozwell-base-url'] as string | undefined;

  if (overrideHeader) {
    console.log('[DEBUG] Using override header:', overrideHeader);
    return new OzwellAI({ apiKey: API_KEY, baseURL: overrideHeader });
  }

  if (STATIC_BASE_URL) {
    console.log('[DEBUG] Using STATIC_BASE_URL:', STATIC_BASE_URL);
    return new OzwellAI({ apiKey: API_KEY, baseURL: STATIC_BASE_URL });
  }

  if (API_KEY.toLowerCase() === 'ollama') {
    console.log('[DEBUG] Using default Ollama URL: http://127.0.0.1:11434');
    return new OzwellAI({ apiKey: API_KEY, baseURL: 'http://127.0.0.1:11434' });
  }

  console.log('[DEBUG] Using default OzwellAI client');
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
          model: { type: 'string' },
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
          temperature: { type: 'number' },
          max_tokens: { type: 'number' },
        },
        required: ['model', 'messages'],
      },
    },
  }, async (request, reply) => {
    const body = request.body as EmbedChatRequest;
    const model = body.model.trim();

    // Use messages as-is (OpenAI format)
    const messages: ChatMessage[] = body.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    console.log('[DEBUG] ===== REQUEST TO OLLAMA =====');
    console.log('[DEBUG] Tools being sent:', JSON.stringify(body.tools, null, 2));
    console.log('[DEBUG] Messages:', JSON.stringify(messages, null, 2));

    try {
      const response = await forwardToOzwell(request, model, messages, body.tools);

      console.log('[DEBUG] ===== OLLAMA RESPONSE =====');
      console.log('[DEBUG] Full response:', JSON.stringify(response, null, 2));

      // Return OpenAI-compliant format
      return {
        id: response.id,
        object: 'chat.completion',
        created: response.created,
        model: response.model,
        choices: response.choices || [
          {
            index: 0,
            message: { role: 'assistant', content: '' },
            finish_reason: 'stop'
          }
        ],
        usage: response.usage,
      };
    } catch (error) {
      request.log.error({ err: error }, 'Widget chat request failed, falling back to local generator');

      const prompt = messages.map((msg) => `${msg.role}: ${msg.content}`).join('\n');
      const fallback = SimpleTextGenerator.generate(prompt, 150);

      return {
        id: generateId('embedcmpl'),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: fallback,
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: countTokens(prompt),
          completion_tokens: countTokens(fallback),
          total_tokens: countTokens(prompt) + countTokens(fallback),
        },
      };
    }
  });
};

export default embedChatRoute;
