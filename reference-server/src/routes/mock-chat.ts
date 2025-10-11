import { FastifyPluginAsync } from 'fastify';
import { generateId, countTokens } from '../util';

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

interface MockChatRequest {
  messages?: ChatMessage[];
  message?: string;
  model?: string;
  system?: string;
  tools?: Tool[];
}

/**
 * Mock AI Chat Endpoint
 *
 * This endpoint simulates AI responses using keyword matching and switch-case logic.
 * It's designed for reliable demos - always returns predictable, correct responses.
 *
 * Purpose: Prove MCP tool calling works via iframe-sync + postMessage without
 * relying on unpredictable LLM behavior.
 */

function extractUserMessage(messages: ChatMessage[]): string {
  // Get the last user message
  const lastUserMsg = messages.filter(msg => msg.role === 'user').pop();
  return lastUserMsg?.content || '';
}

function extractContextFromSystem(messages: ChatMessage[]): any {
  // Extract context from system message if present
  const systemMsg = messages.find(msg => msg.role === 'system');
  if (!systemMsg) return null;

  // Parse name, address, zip from system prompt
  const nameMatch = systemMsg.content.match(/Name:\s*([^\n]+)/);
  const addressMatch = systemMsg.content.match(/Address:\s*([^\n]+)/);
  const zipMatch = systemMsg.content.match(/Zip Code:\s*([^\n]+)/);

  return {
    name: nameMatch ? nameMatch[1].trim() : 'Unknown',
    address: addressMatch ? addressMatch[1].trim() : 'Unknown',
    zipCode: zipMatch ? zipMatch[1].trim() : 'Unknown'
  };
}

function generateMockResponse(userMessage: string, context: any, tools: Tool[]): any {
  const msg = userMessage.toLowerCase();

  // Tool call patterns - detect action keywords

  // Pattern 1: Update/Change/Set name to X
  const nameUpdateMatch = userMessage.match(/(?:update|change|set|make).*name.*(?:to|is)\s+([A-Za-z\s]+)/i);
  if (nameUpdateMatch) {
    const newName = nameUpdateMatch[1].trim();
    return {
      role: 'assistant',
      content: '', // No text content when making tool call
      tool_calls: [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'update_name',
          arguments: JSON.stringify({ name: newName })
        }
      }]
    };
  }

  // Pattern 2: Update/Change address to X
  const addressUpdateMatch = userMessage.match(/(?:update|change|set|make).*address.*(?:to|is)\s+([^\n]+)/i);
  if (addressUpdateMatch) {
    const newAddress = addressUpdateMatch[1].trim();
    return {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'update_address',
          arguments: JSON.stringify({ address: newAddress })
        }
      }]
    };
  }

  // Pattern 3: Update/Change zip code to X
  const zipUpdateMatch = userMessage.match(/(?:update|change|set|make).*(?:zip|zipcode|zip code).*(?:to|is)\s+([0-9\-]+)/i);
  if (zipUpdateMatch) {
    const newZip = zipUpdateMatch[1].trim();
    return {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'update_zip',
          arguments: JSON.stringify({ zipCode: newZip })
        }
      }]
    };
  }

  // Question patterns - respond with text using context

  // Question: What's my name?
  if (msg.match(/what.*my name|what.*name|my name/)) {
    return {
      role: 'assistant',
      content: `Your name is ${context?.name || 'not set'}.`
    };
  }

  // Question: What's my address?
  if (msg.match(/what.*my address|what.*address|my address/)) {
    return {
      role: 'assistant',
      content: `Your address is ${context?.address || 'not set'}.`
    };
  }

  // Question: What's my zip code?
  if (msg.match(/what.*my zip|what.*zip|my zip/)) {
    return {
      role: 'assistant',
      content: `Your zip code is ${context?.zipCode || 'not set'}.`
    };
  }

  // General greetings
  if (msg.match(/^(hi|hello|hey|greetings)/)) {
    return {
      role: 'assistant',
      content: 'Hello! I can help you view or update your information. Try asking me about your details or tell me to update something.'
    };
  }

  // Who are you?
  if (msg.match(/who are you|what are you/)) {
    return {
      role: 'assistant',
      content: 'I\'m Ozwell Assistant, powered by MCP tools. I can answer questions about your information and help you update it.'
    };
  }

  // What can you do?
  if (msg.match(/what can you do|help|capabilities/)) {
    return {
      role: 'assistant',
      content: 'I can:\n• Answer questions about your name, address, and zip code\n• Update your information when you ask me to change it\n• Help you manage your profile data'
    };
  }

  // Default fallback
  return {
    role: 'assistant',
    content: 'I can help you with your profile information. Ask me about your details or tell me to update something!'
  };
}

const mockChatRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/mock/chat', {
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
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as MockChatRequest;
    const model = body.model || 'mock-ai';

    let messages: ChatMessage[] = [];

    if (Array.isArray(body.messages) && body.messages.length > 0) {
      messages = body.messages;
    } else if (body.message) {
      const systemPrompt = body.system || 'You are a helpful assistant.';
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

    // Extract user message and context
    const userMessage = extractUserMessage(messages);
    const context = extractContextFromSystem(messages);

    // Generate mock response
    const assistantMessage = generateMockResponse(userMessage, context, body.tools || []);

    const requestId = generateId('mockcmpl');
    const created = Math.floor(Date.now() / 1000);

    // Calculate mock token usage
    const prompt = messages.map(msg => msg.content).join(' ');
    const completion = assistantMessage.content || JSON.stringify(assistantMessage.tool_calls || []);

    return {
      id: requestId,
      model,
      created,
      message: assistantMessage,
      usage: {
        prompt_tokens: countTokens(prompt),
        completion_tokens: countTokens(completion),
        total_tokens: countTokens(prompt) + countTokens(completion),
      },
    };
  });
};

export default mockChatRoute;
