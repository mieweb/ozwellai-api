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

function hasToolResult(messages: ChatMessage[]): boolean {
  // Check if the LAST non-system message is a tool result (second round of OpenAI protocol)
  // We need to check recency, not just existence, to avoid treating all messages after
  // the first tool call as tool results
  const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1];
  return lastMessage?.role === 'tool';
}

function extractToolResult(messages: ChatMessage[]): any {
  // Get the LAST tool result from messages (most recent)
  const toolMessages = messages.filter(msg => msg.role === 'tool');
  const toolMsg = toolMessages[toolMessages.length - 1];
  if (!toolMsg) return null;

  try {
    return JSON.parse(toolMsg.content);
  } catch {
    return { message: toolMsg.content };
  }
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

function generateMockResponse(userMessage: string, context: any, tools: Tool[], hasToolResult: boolean, toolResult: any): any {
  const msg = userMessage.toLowerCase();

  // If this is the second round (after tool execution), generate final response
  if (hasToolResult && toolResult) {
    if (toolResult.success) {
      return {
        role: 'assistant',
        content: `Done! ${toolResult.message || 'Successfully updated.'}`
      };
    } else {
      return {
        role: 'assistant',
        content: `Sorry, there was an error: ${toolResult.error || 'Unknown error'}`
      };
    }
  }

  // Tool call patterns - detect action keywords (first round)

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

  // Pattern 4: Tic-tac-toe move detection
  // Detect board positions for make_move tool
  let position: string | null = null;

  // Check most specific patterns first (with row qualifiers)
  // Top row
  if (msg.match(/\b(top|upper)[\s\-]*(left|1)\b/)) {
    position = 'top-left';
  } else if (msg.match(/\b(top|upper)[\s\-]*(center|centre|middle|2)\b/)) {
    position = 'top-center';
  } else if (msg.match(/\b(top|upper)[\s\-]*(right|3)\b/)) {
    position = 'top-right';
  }
  // Middle row
  else if (msg.match(/\b(middle|mid|center|centre)[\s\-]*(left|4)\b/)) {
    position = 'middle-left';
  } else if (msg.match(/\b(middle|mid|center|centre)[\s\-]*(center|centre|middle|5)\b/)) {
    position = 'middle-center';
  } else if (msg.match(/\b(middle|mid|center|centre)[\s\-]*(right|6)\b/)) {
    position = 'middle-right';
  }
  // Bottom row
  else if (msg.match(/\b(bottom|lower)[\s\-]*(left|7)\b/)) {
    position = 'bottom-left';
  } else if (msg.match(/\b(bottom|lower)[\s\-]*(center|centre|middle|8)\b/)) {
    position = 'bottom-center';
  } else if (msg.match(/\b(bottom|lower)[\s\-]*(right|9)\b/)) {
    position = 'bottom-right';
  }
  // Fallback: just direction without row qualifier (default to middle)
  else if (msg.match(/\bleft\b/) && !msg.match(/\b(top|bottom)\b/)) {
    position = 'middle-left';
  } else if (msg.match(/\bright\b/) && !msg.match(/\b(top|bottom)\b/)) {
    position = 'middle-right';
  } else if (msg.match(/\b(center|centre|middle)\b/) && !msg.match(/\b(top|bottom)\b/)) {
    position = 'middle-center';
  }
  // Numeric positions (0-8)
  else if (msg.match(/\b(position|cell|square|spot)?\s*(0|zero)\b/)) {
    position = 'top-left';
  }

  if (position) {
    return {
      role: 'assistant',
      content: `Great move! Placing your X at ${position.replace('-', ' ')}...`,
      tool_calls: [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'make_move',
          arguments: JSON.stringify({ position })
        }
      }]
    };
  }

  // Pattern 5: Reset tic-tac-toe game
  if (msg.match(/\b(reset|restart|new game|start over)\b/)) {
    return {
      role: 'assistant',
      content: 'Starting a new game! Good luck!',
      tool_calls: [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'reset_game',
          arguments: JSON.stringify({})
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
    const hasResult = hasToolResult(messages);
    const toolResult = hasResult ? extractToolResult(messages) : null;

    // Generate mock response
    const assistantMessage = generateMockResponse(userMessage, context, body.tools || [], hasResult, toolResult);

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
