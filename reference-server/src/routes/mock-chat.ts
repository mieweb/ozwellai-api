// Pure helpers for deterministic mock chat responses.
// Used by the chat route to bypass the LLM for `type: mock` agents
// and as a final fallback when no LLM backend is reachable.

// A single multimodal content part (OpenAI-compatible). Only the text portion
// is meaningful for the deterministic mock; image parts are ignored.
export interface ContentPart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

// Message content may be a plain string or an array of multimodal parts
// (text + image_url) for vision requests.
export type MessageContent = string | ContentPart[];

export interface ChatMessage {
  role: string;
  content: MessageContent;
}

// Flatten a message's content into a plain string. Strings pass through; arrays
// of content parts are reduced to their concatenated `text` fields. This keeps
// downstream string operations (e.g. toLowerCase, JSON.parse) safe when callers
// send multimodal content arrays.
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as ContentPart).text === 'string') {
          return (part as ContentPart).text as string;
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export function extractUserMessage(messages: ChatMessage[]): string {
  // Get the last user message
  const lastUserMsg = messages.filter(msg => msg.role === 'user').pop();
  // Content may be a multimodal array (text + image_url); flatten to text so
  // callers can safely run string operations on the result.
  return contentToText(lastUserMsg?.content);
}

export function hasToolResult(messages: ChatMessage[]): boolean {
  // Check if the LAST non-system message is a tool result (second round of OpenAI protocol)
  // We need to check recency, not just existence, to avoid treating all messages after
  // the first tool call as tool results
  const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1];
  return lastMessage?.role === 'tool';
}

export function extractToolResult(messages: ChatMessage[]): Record<string, unknown> | null {
  // Get the LAST tool result from messages (most recent)
  const toolMessages = messages.filter(msg => msg.role === 'tool');
  const toolMsg = toolMessages[toolMessages.length - 1];
  if (!toolMsg) return null;

  const raw = contentToText(toolMsg.content);
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

export function generateMockResponse(userMessage: string, hasToolResult: boolean, toolResult: Record<string, unknown> | null): { role: string; content: string; tool_calls?: ToolCall[] } {
  const msg = userMessage.toLowerCase();

  // If this is the second round (after tool execution), generate final response
  if (hasToolResult && toolResult) {
    if (toolResult.success) {
      // Handle get_form_data tool result
      if (toolResult.data && typeof toolResult.data === 'object') {
        const data = toolResult.data as { name?: string; address?: string; zipCode?: string };

        // Determine what the user was asking about based on the original message
        if (msg.match(/what.*my name|what.*name|my name/)) {
          return {
            role: 'assistant',
            content: `Your name is ${data.name || 'not set'}.`
          };
        } else if (msg.match(/what.*my address|what.*address|my address/)) {
          return {
            role: 'assistant',
            content: `Your address is ${data.address || 'not set'}.`
          };
        } else if (msg.match(/what.*my zip|what.*zip|my zip/)) {
          return {
            role: 'assistant',
            content: `Your zip code is ${data.zipCode || 'not set'}.`
          };
        } else {
          // General information request
          return {
            role: 'assistant',
            content: `Here's your information:\n• Name: ${data.name || 'not set'}\n• Address: ${data.address || 'not set'}\n• Zip Code: ${data.zipCode || 'not set'}`
          };
        }
      }

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
  // Consolidated pattern: Update form data (name, address, and/or zip code)
  const formDataArgs: { name?: string; address?: string; zipCode?: string } = {};

  // Pattern 1: Update/Change/Set name to X
  const nameUpdateMatch = userMessage.match(/(?:update|change|set|make).*name.*(?:to|is)\s+([A-Za-z\s]+)/i);
  if (nameUpdateMatch) {
    formDataArgs.name = nameUpdateMatch[1].trim();
  }

  // Pattern 2: Update/Change address to X
  const addressUpdateMatch = userMessage.match(/(?:update|change|set|make).*address.*(?:to|is)\s+([^\n]+)/i);
  if (addressUpdateMatch) {
    formDataArgs.address = addressUpdateMatch[1].trim();
  }

  // Pattern 3: Update/Change zip code to X
  const zipUpdateMatch = userMessage.match(/(?:update|change|set|make).*(?:zip|zipcode|zip code).*(?:to|is)\s+([0-9-]+)/i);
  if (zipUpdateMatch) {
    formDataArgs.zipCode = zipUpdateMatch[1].trim();
  }

  // If any form fields were matched, call update_form_data
  if (Object.keys(formDataArgs).length > 0) {
    return {
      role: 'assistant',
      content: '', // No text content when making tool call
      tool_calls: [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'update_form_data',
          arguments: JSON.stringify(formDataArgs)
        }
      }]
    };
  }

  // Pattern 4: Tic-tac-toe move detection
  // Detect board positions for make_move tool
  let position: string | null = null;

  // Check most specific patterns first (with row qualifiers)
  // Top row
  if (msg.match(/\b(top|upper)[\s-]*(left|1)\b/)) {
    position = 'top-left';
  } else if (msg.match(/\b(top|upper)[\s-]*(center|centre|middle|2)\b/)) {
    position = 'top-center';
  } else if (msg.match(/\b(top|upper)[\s-]*(right|3)\b/)) {
    position = 'top-right';
  }
  // Middle row
  else if (msg.match(/\b(middle|mid|center|centre)[\s-]*(left|4)\b/)) {
    position = 'middle-left';
  } else if (msg.match(/\b(middle|mid|center|centre)[\s-]*(center|centre|middle|5)\b/)) {
    position = 'middle-center';
  } else if (msg.match(/\b(middle|mid|center|centre)[\s-]*(right|6)\b/)) {
    position = 'middle-right';
  }
  // Bottom row
  else if (msg.match(/\b(bottom|lower)[\s-]*(left|7)\b/)) {
    position = 'bottom-left';
  } else if (msg.match(/\b(bottom|lower)[\s-]*(center|centre|middle|8)\b/)) {
    position = 'bottom-center';
  } else if (msg.match(/\b(bottom|lower)[\s-]*(right|9)\b/)) {
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

  // Question patterns - call get_form_data tool to retrieve information

  // Question: What's my name/address/zip?
  if (msg.match(/what.*my (name|address|zip)|what.*(name|address|zip)|my (name|address|zip)/)) {
    return {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'get_form_data',
          arguments: JSON.stringify({})
        }
      }]
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

