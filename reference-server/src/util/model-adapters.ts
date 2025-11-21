/**
 * Model-specific adapters for handling different LLM providers
 * Currently supports Qwen models with special tool calling format
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface ModelAdapter {
    preprocessRequest: (messages: any[], tools?: any[]) => { messages: any[]; tools?: any[] };
    parseResponse: (response: any) => any;
    parseStreamChunk?: (chunk: any) => any;
}

// ============================================================================
// Model Detection
// ============================================================================

/**
 * Check if the model is a Qwen model
 */
export function isQwenModel(model: string): boolean {
  const isQwen = model.toLowerCase().includes('qwen');
  console.log(`[Model Adapter] Checking model: ${model}, isQwen: ${isQwen}`);
  return isQwen;
}// ============================================================================
// Qwen-Specific Handling
// ============================================================================

/**
 * Preprocess request for Qwen models
 * Qwen models work better with explicit instructions for tool calling
 */
function preprocessQwenRequest(messages: any[], tools?: any[]): { messages: any[]; tools?: any[] } {
    if (!tools || tools.length === 0) {
        return { messages, tools };
    }

    // Add system message with tool calling instructions for Qwen
    const toolInstructions = {
        role: 'system',
        content: `You have access to the following tools. When you need to use a tool, respond with a JSON object in this exact format:
{
  "tool_calls": [
    {
      "id": "call_<unique_id>",
      "type": "function",
      "function": {
        "name": "<function_name>",
        "arguments": "<json_string_of_arguments>"
      }
    }
  ]
}

Available tools:
${tools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n')}

Only use this format when you need to call a tool. For regular responses, reply normally without any JSON structure.`
    };

    // Check if there's already a system message
    const hasSystemMessage = messages.some(m => m.role === 'system');

    if (hasSystemMessage) {
        // Prepend to existing system message or add as second message
        const systemIndex = messages.findIndex(m => m.role === 'system');
        const updatedMessages = [...messages];
        updatedMessages[systemIndex] = {
            ...updatedMessages[systemIndex],
            content: toolInstructions.content + '\n\n' + updatedMessages[systemIndex].content
        };
        return { messages: updatedMessages, tools };
    } else {
        // Add as first message
        return { messages: [toolInstructions, ...messages], tools };
    }
}

/**
 * Parse Qwen response to ensure it matches OpenAI format
 * Qwen may output tool calls differently, this normalizes them
 */
function parseQwenResponse(response: any): any {
  console.log('[Qwen Parser] Input response:', JSON.stringify(response, null, 2));
  
  // If no choices, return as-is
  if (!response.choices || response.choices.length === 0) {
    return response;
  }

  const choice = response.choices[0];
  const message = choice.message;

  // If message doesn't have content, return as-is
  if (!message || !message.content) {
    return response;
  }

  console.log('[Qwen Parser] Message content:', message.content);

  // Try to parse tool calls from content if they're embedded as JSON
  try {
    const content = message.content.trim();
    
    // Check if the response looks like a tool call JSON
    // Handle both formats: { "tool_calls": [...] } or just the array
    if (content.startsWith('{') && content.includes('tool_calls')) {
      const parsed = JSON.parse(content);
      console.log('[Qwen Parser] Parsed JSON:', parsed);
      
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        const transformed = {
          ...response,
          choices: [{
            ...choice,
            message: {
              ...message,
              content: null,
              tool_calls: parsed.tool_calls.map((tc: any, index: number) => ({
                id: tc.id || `call_${Date.now()}_${index}`,
                type: tc.type || 'function',
                function: {
                  name: tc.function.name,
                  arguments: typeof tc.function.arguments === 'string' 
                    ? tc.function.arguments 
                    : JSON.stringify(tc.function.arguments)
                }
              }))
            },
            finish_reason: 'tool_calls'
          }]
        };
        console.log('[Qwen Parser] Transformed response:', JSON.stringify(transformed, null, 2));
        return transformed;
      }
    }
  } catch (e) {
    // If parsing fails, log for debugging but return original
    console.error('Qwen parsing error:', e);
  }

  console.log('[Qwen Parser] Returning original response');
  return response;
}/**
 * Parse Qwen streaming chunk to ensure it matches OpenAI format
 */
function parseQwenStreamChunk(chunk: any): any {
    // For streaming, we'll accumulate content and parse at the end
    // This is a simple pass-through for now, but could be enhanced
    // to detect when tool calls are being streamed
    return chunk;
}

// ============================================================================
// Adapter Factory
// ============================================================================

/**
 * Get the appropriate model adapter based on the model name
 */
export function getModelAdapter(model: string): ModelAdapter {
    if (isQwenModel(model)) {
        return {
            preprocessRequest: preprocessQwenRequest,
            parseResponse: parseQwenResponse,
            parseStreamChunk: parseQwenStreamChunk,
        };
    }

    // Default adapter - pass-through for models that don't need special handling
    return {
        preprocessRequest: (messages: any[], tools?: any[]) => ({ messages, tools }),
        parseResponse: (response: any) => response,
        parseStreamChunk: (chunk: any) => chunk,
    };
}
