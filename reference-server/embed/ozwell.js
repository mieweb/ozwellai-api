/**
 * ============================================
 * OZWELL CHAT WIDGET (Self-Contained)
 * ============================================
 *
 * This file bundles everything needed for the widget:
 * - IframeSyncClient (for state synchronization)
 * - CSS styles (inlined)
 * - HTML structure (dynamically injected)
 * - Widget logic
 *
 * No separate HTML or CSS files needed!
 */

/**
 * ============================================
 * IFRAME-SYNC CLIENT (Bundled)
 * ============================================
 *
 * IframeSyncClient allows this widget iframe to receive state updates from the parent page.
 * This is bundled here to eliminate the need for a separate iframe-sync.js script tag.
 *
 * The parent page uses IframeSyncBroker (bundled in ozwell-loader.js) to send updates.
 */
class IframeSyncClient {
  #channel;
  #recv;
  #clientName;

  constructor(clientName, recv) {
    this.#recv = recv;
    this.#channel = 'IframeSync';
    this.#clientName = clientName || [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

    if (!window) {
      return;
    }
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.channel !== this.#channel) {
        return;
      }

      const isOwnMessage = event.data.sourceClientName === this.#clientName;
      const isReadyReceived = event.data.type === 'readyReceived';

      if (['syncState', 'readyReceived'].includes(event.data.type) && typeof this.#recv === 'function') {
        this.#recv(event.data.payload, isOwnMessage, isReadyReceived);
      }
    });
  }

  ready() {
    if (!window || !window.parent) {
      return;
    }
    window.parent.postMessage({
      channel: this.#channel,
      type: 'ready',
      sourceClientName: this.#clientName
    }, '*');
  }

  stateChange(update) {
    if (!window || !window.parent) {
      return;
    }
    window.parent.postMessage({
      channel: this.#channel,
      type: 'stateChange',
      sourceClientName: this.#clientName,
      payload: update
    }, '*');
  }
}

/**
 * ============================================
 * INJECT STYLES AND HTML STRUCTURE
 * ============================================
 */
(function injectWidgetUI() {
  // Inject CSS styles
  const style = document.createElement('style');
  style.textContent = `
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background: #ffffff;
  color: #1a1a1a;
}

.chat-container {
  width: 100%;
  height: 100vh;
  background: #ffffff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.status {
  padding: 8px 16px;
  font-size: 12px;
  background: #f9fafb;
  color: transparent;
  border-bottom: 1px solid #e5e7eb;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status.status--processing {
  color: #6b7280;
}

.status.status--processing::after {
  content: '●';
  animation: processingDots 1.4s infinite;
  letter-spacing: 2px;
}

@keyframes processingDots {
  0%, 20% { content: '●'; }
  40% { content: '●●'; }
  60%, 100% { content: '●●●'; }
}

.messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #ffffff;
}

.message {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  max-width: 75%;
  box-shadow: none;
}

.message.user {
  align-self: flex-end;
  background: #0066ff;
  color: white;
}

.message.assistant {
  align-self: flex-start;
  background: #f3f4f6;
  color: #1a1a1a;
  border: none;
}

.message.system {
  align-self: center;
  background: #fef3c7;
  color: #92400e;
  font-size: 13px;
  max-width: 85%;
  text-align: center;
  border: none;
}

.message.welcome {
  align-self: flex-start;
  background: #f9fafb;
  color: #6b7280;
  font-size: 13px;
  font-style: italic;
  border: 1px dashed #e5e7eb;
  max-width: 85%;
}

.chat-form {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid #e5e7eb;
  background: #fafafa;
}

.chat-input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 14px;
  background: #ffffff;
  color: #1a1a1a;
}

.chat-input:focus {
  outline: none;
  border-color: #0066ff;
  box-shadow: 0 0 0 3px rgba(0, 102, 255, 0.1);
}

.chat-submit {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  background: #0066ff;
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.chat-submit:hover {
  background: #0052cc;
}

.chat-submit:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.chat-save {
  display: none;
}

.chat-footer {
  text-align: center;
  padding: 8px;
  font-size: 10px;
  color: #9ca3af;
  border-top: 1px solid #e5e7eb;
  background: #fafafa;
}
  `;
  document.head.appendChild(style);

  // Inject HTML structure
  document.body.innerHTML = `
    <div class="chat-container">
      <div id="status" class="status">Connecting...</div>
      <div id="messages" class="messages"></div>
      <form id="chat-form" class="chat-form">
        <input
          id="chat-input"
          class="chat-input"
          type="text"
          placeholder="Type a message..."
          autocomplete="off"
        />
        <button type="submit" class="chat-submit">Send</button>
      </form>
      <button type="button" id="save-button" class="chat-save" disabled>Save & Close</button>
      <div class="chat-footer">Powered by Ozwell</div>
    </div>
  `;
})();

/**
 * ============================================
 * WIDGET STATE AND LOGIC
 * ============================================
 */

// Global runtime configuration (accessible via console for testing)
window.OzwellDebug = {
  disableTools: false, // Set to true in console to disable tools
  verbose: false, // Set to true for detailed logging
  log: function (message, ...args) {
    if (this.verbose) {
      console.log(`[OzwellDebug] ${message}`, ...args);
    }
  }
};

// Expose helper functions for console testing
window.OzwellDebug.help = function () {
  console.log(`
🔧 Ozwell Debug Console Commands:

Toggle Features:
  OzwellDebug.disableTools = true/false    // Enable/disable tool calling
  OzwellDebug.verbose = true/false         // Enable/disable verbose logging

View State:
  OzwellDebug.getState()                   // View current widget state
  OzwellDebug.getMessages()                // View conversation history
  OzwellDebug.getTools()                   // View configured tools

Reset:
  OzwellDebug.clearMessages()              // Clear conversation history
  OzwellDebug.reset()                      // Full reset

Examples:
  OzwellDebug.disableTools = true          // Test without tools
  OzwellDebug.verbose = true               // See detailed logs
  `);
};

window.OzwellDebug.getState = function () {
  return state;
};

window.OzwellDebug.getMessages = function () {
  return state.messages;
};

window.OzwellDebug.getTools = function () {
  return state.config.tools || [];
};

window.OzwellDebug.clearMessages = function () {
  state.messages = [];
  if (messagesEl) {
    messagesEl.innerHTML = '';
  }
  if (state.config.welcomeMessage) {
    addMessage('welcome', state.config.welcomeMessage);
  }
  console.log('[OzwellDebug] Messages cleared');
};

window.OzwellDebug.reset = function () {
  this.clearMessages();
  this.disableTools = false;
  this.verbose = false;
  console.log('[OzwellDebug] Reset complete. Type OzwellDebug.help() for available commands.');
};

const state = {
  config: {
    title: 'Ozwell',
    placeholder: 'Ask a question...',
    model: 'llama3',
    endpoint: '/v1/chat/completions',
  },
  messages: [],
  sending: false,
  formData: null, // Form context from parent page
};

console.log('[widget.js] Widget initializing...');
console.log('[widget.js] Type OzwellDebug.help() in console for debug commands');

const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const submitButton = document.querySelector('.chat-submit');
const saveButton = document.getElementById('save-button');

let lastAssistantMessage = '';

function setStatus(text, processing = false) {
  if (statusEl) {
    statusEl.textContent = text;
    if (processing) {
      statusEl.classList.add('status--processing');
    } else {
      statusEl.classList.remove('status--processing');
    }
  }
}

function addMessage(role, text) {
  if (!messagesEl) return;
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function applyConfig(config) {
  state.config = {
    ...state.config,
    ...config,
  };

  if (inputEl) {
    inputEl.placeholder = state.config.placeholder || 'Type a message...';
  }

  // Show welcome message if provided and chat is empty
  if (config.welcomeMessage && state.messages.length === 0) {
    addMessage('welcome', config.welcomeMessage);
  }

  setStatus('', false);
}

function buildMessages() {
  const history = [...state.messages];
  if (state.config.system) {
    const hasSystem = history.some((msg) => msg.role === 'system');
    if (!hasSystem) {
      history.unshift({ role: 'system', content: state.config.system });
    }
  }
  return history;
}

function buildSystemPrompt(tools) {
  // Start with custom system prompt from parent config
  let systemPrompt = state.config.system || 'You are a helpful assistant.';

  // APPEND form context if available (don't replace!)
  if (state.formData) {
    console.log('[widget.js] Including form context in system prompt:', state.formData);

    // Check if formData has the expected landing page fields
    if (state.formData.name !== undefined) {
      systemPrompt += `\n\nYou have access to the following user information:

Name: ${state.formData.name}
Address: ${state.formData.address}
Zip Code: ${state.formData.zipCode}

When the user asks questions about their name, address, or zip code, answer directly using the information above. Be concise and friendly.`;
    } else {
      // Generic formData context (for other integrations like TimeHarbor)
      systemPrompt += `\n\nCurrent page context:\n${JSON.stringify(state.formData, null, 2)}`;
    }
  }

  // APPEND tool usage rules if tools exist
  if (tools && tools.length > 0) {
    systemPrompt += `\n\n=== CRITICAL TOOL USAGE RULES ===

You have access to tools, but you must use them ONLY when explicitly instructed.

WHEN TO USE TOOLS (Action verbs):
- "update my name to X" → use update_name tool
- "change my address to X" → use update_address tool
- "set my zip code to X" → use update_zip tool

WHEN NOT TO USE TOOLS (Questions or statements):
- "what is my name?" → Answer: "Your name is [name from context]" (NO TOOL)
- "tell me my address" → Answer: "Your address is [address from context]" (NO TOOL)
- "what is my zip code?" → Answer: "Your zip code is [zip from context]" (NO TOOL)
- Any question, greeting, or conversation → NEVER use tools

RULE: If the user is ASKING a question, ANSWER it using the context provided above. DO NOT call any tools.
RULE: If the user is REQUESTING an action (update, change, set, modify), THEN use the appropriate tool.

If you are unsure, DO NOT use tools - just answer with text.`;
  }

  return systemPrompt;
}

async function sendMessage(text) {
  if (state.sending) return;

  const userMessage = { role: 'user', content: text };
  state.messages.push(userMessage);
  addMessage('user', text);

  // Build MCP tools from parent config (dynamic, not hardcoded)
  let tools = [];

  // Check if tools are disabled via console debug flag
  if (window.OzwellDebug.disableTools) {
    console.log('[widget.js] Tools disabled via OzwellDebug.disableTools');
    window.OzwellDebug.log('Tools bypassed for this request');
  } else if (state.config.tools && Array.isArray(state.config.tools)) {
    tools = state.config.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }
    }));
    console.log('[widget.js] Tools loaded from config:', tools);
    window.OzwellDebug.log('Tools enabled', tools);
  }

  // Always use streaming (handles both text and tool calls)
  await sendMessageStreaming(text, tools);
}

async function sendMessageNonStreaming(text, tools) {
  setStatus('Processing...', true);
  state.sending = true;
  formEl?.classList.add('is-sending');
  submitButton?.setAttribute('disabled', 'true');
  saveButton?.setAttribute('disabled', 'true');
  lastAssistantMessage = '';

  // Build system prompt (handles custom prompts, form context, and tool rules)
  const systemPrompt = buildSystemPrompt(tools);

  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add Authorization header if needed
    if (state.config.openaiApiKey) {
      headers['Authorization'] = `Bearer ${state.config.openaiApiKey}`;
      console.log('[widget.js] Using OpenAI API with authorization');
    }

    // Merge in any custom headers from config
    if (state.config.headers) {
      Object.assign(headers, state.config.headers);
      console.log('[widget.js] Added custom headers from config:', state.config.headers);
    }

    // Build messages for request (OpenAI format: system message in messages array)
    const requestMessages = buildMessages();
    if (systemPrompt) {
      requestMessages.unshift({ role: 'system', content: systemPrompt });
    }

    // Build request body (non-streaming)
    const requestBody = {
      model: state.config.model || 'gpt-4o',
      messages: requestMessages,
      tools: tools,
      stream: false,
    };

    const response = await fetch(state.config.endpoint || '/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[widget.js] API error:', errorText);
      throw new Error(`Request failed with status ${response.status}: ${errorText}`);
    }

    const payload = await response.json();
    console.log('[widget.js] API response:', payload);

    // Handle errors
    if (payload.error) {
      throw new Error(payload.error.message || 'Model request failed');
    }

    // Parse OpenAI response format
    const choice = payload.choices?.[0];
    if (!choice) {
      throw new Error('Invalid response format: missing choices array');
    }

    const assistantContent = choice.message?.content || '';
    const toolCalls = choice.message?.tool_calls || null;

    // Handle tool calls (dynamic - works with any tool from parent config)
    if (toolCalls && toolCalls.length > 0) {
      console.log('[widget.js] Model returned tool calls:', toolCalls);

      // CRITICAL: Always store assistant message with tool_calls in conversation history
      const assistantMessage = {
        role: 'assistant',
        content: assistantContent || '',
        tool_calls: toolCalls
      };
      state.messages.push(assistantMessage);
      console.log('[widget.js] Stored assistant message with tool_calls in history');

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function?.name;

        if (toolName) {
          try {
            const args = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;

            console.log(`[widget.js] Executing tool '${toolName}' with args:`, args);

            // Send tool call to parent via postMessage
            window.parent.postMessage({
              source: 'ozwell-chat-widget',
              type: 'tool_call',
              tool: toolName,
              payload: args
            }, '*');

            // Add system message to chat
            addMessage('system', `Executing ${toolName}...`);
          } catch (error) {
            console.error('[widget.js] Error parsing tool arguments:', error);
            addMessage('system', `Error: Could not execute ${toolName}`);
          }
        }
      }

      // Display text content in UI if present
      if (assistantContent && assistantContent.trim()) {
        lastAssistantMessage = assistantContent;
        addMessage('assistant', assistantContent);
      }
    } else {
      // No tool calls, just regular response
      const assistantMessage = {
        role: 'assistant',
        content: assistantContent || '(no response)',
      };
      state.messages.push(assistantMessage);
      lastAssistantMessage = assistantContent;
      addMessage('assistant', assistantContent || '(no response)');
    }

    setStatus('', false);
    if (lastAssistantMessage.trim()) {
      saveButton?.removeAttribute('disabled');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    addMessage('system', `Error: ${message}`);
    setStatus('Error', false);
  } finally {
    state.sending = false;
    formEl?.classList.remove('is-sending');
    submitButton?.removeAttribute('disabled');
    if (!lastAssistantMessage.trim()) {
      saveButton?.setAttribute('disabled', 'true');
    }
  }
}

/**
 * Parse tool calls from message content (for models that output JSON in text).
 * Handles Qwen's format: outputs {"name": "function_name", "arguments": {...}} wrapped in markdown.
 * 
 * @param {string} content - The accumulated message content
 * @returns {Object|null} Object with {toolCalls, shouldHideContent} or null if no tool calls found
 */
function parseToolCallsFromContent(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  try {
    // Strip markdown code blocks (```json...``` or ```...```)
    let jsonText = content.trim();
    const markdownMatch = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (markdownMatch) {
      jsonText = markdownMatch[1].trim();
    }

    // Try to parse as JSON
    const parsed = JSON.parse(jsonText);

    // Handle format: {"tool_calls": [...]}
    if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      return {
        toolCalls: parsed.tool_calls.map((tc, idx) => ({
          id: tc.id || `call_${Date.now()}_${idx}`,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || tc.name,
            arguments: typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments || tc.arguments || {})
          }
        })),
        shouldHideContent: true // Hide JSON from display
      };
    }

    // Handle format: {"name": "function_name", "arguments": {...}} (Qwen's format)
    if (parsed.name && parsed.arguments !== undefined) {
      return {
        toolCalls: [{
          id: `call_${Date.now()}_0`,
          type: 'function',
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'string'
              ? parsed.arguments
              : JSON.stringify(parsed.arguments)
          }
        }],
        shouldHideContent: true // Hide JSON from display
      };
    }

    // Handle format: {"function": {"name": "...", "arguments": ...}}
    if (parsed.function?.name) {
      return {
        toolCalls: [{
          id: `call_${Date.now()}_0`,
          type: 'function',
          function: {
            name: parsed.function.name,
            arguments: typeof parsed.function.arguments === 'string'
              ? parsed.function.arguments
              : JSON.stringify(parsed.function.arguments || {})
          }
        }],
        shouldHideContent: true // Hide JSON from display
      };
    }

    // No recognized tool call format
    return null;
  } catch (e) {
    // Not valid JSON or doesn't match expected format
    return null;
  }
} async function sendMessageStreaming(text, tools) {
  setStatus('Processing...', true);
  state.sending = true;
  formEl?.classList.add('is-sending');
  submitButton?.setAttribute('disabled', 'true');
  saveButton?.setAttribute('disabled', 'true');
  lastAssistantMessage = '';

  // Build system prompt
  const systemPrompt = buildSystemPrompt(tools);

  // Create placeholder message element for incremental updates
  const assistantMsgEl = document.createElement('div');
  assistantMsgEl.className = 'message assistant';
  messagesEl?.appendChild(assistantMsgEl);

  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
    };

    if (state.config.openaiApiKey) {
      headers['Authorization'] = `Bearer ${state.config.openaiApiKey}`;
    }

    if (state.config.headers) {
      Object.assign(headers, state.config.headers);
    }

    // Build messages for request
    const requestMessages = buildMessages();
    if (systemPrompt) {
      requestMessages.unshift({ role: 'system', content: systemPrompt });
    }

    // Build request body (streaming)
    const requestBody = {
      model: state.config.model || 'gpt-4o',
      messages: requestMessages,
      stream: true,
    };

    // Include tools if available
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch(state.config.endpoint || '/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(300000) // 5 minute timeout for slow Ollama with large tool contexts
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[widget.js] API error:', errorText);
      throw new Error(`Request failed with status ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let accumulatedToolCalls = []; // Accumulate tool calls from deltas

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;

            if (!delta) continue;

            // Handle text content (streaming)
            if (delta.content) {
              fullContent += delta.content;
              assistantMsgEl.textContent = fullContent;
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }

            // Handle tool calls (accumulate from deltas)
            if (delta.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index;

                // Initialize tool call object if new
                if (!accumulatedToolCalls[index]) {
                  accumulatedToolCalls[index] = {
                    id: toolCallDelta.id || '',
                    type: toolCallDelta.type || 'function',
                    function: {
                      name: '',
                      arguments: ''
                    }
                  };
                }

                // Set function name (not accumulated, sent once)
                if (toolCallDelta.function?.name) {
                  accumulatedToolCalls[index].function.name = toolCallDelta.function.name;
                }

                // Accumulate function arguments (sent in chunks)
                if (toolCallDelta.function?.arguments) {
                  accumulatedToolCalls[index].function.arguments += toolCallDelta.function.arguments;
                }

                // Update ID if provided
                if (toolCallDelta.id) {
                  accumulatedToolCalls[index].id = toolCallDelta.id;
                }
              }
            }
          } catch (err) {
            console.error('[widget.js] Failed to parse chunk:', err);
          }
        }
      }
    }

    // Check if we have tool calls from deltas
    const hasToolCalls = accumulatedToolCalls.length > 0 && accumulatedToolCalls.some(tc => tc.function.name);

    // If no tool calls from deltas, check if content contains JSON tool calls
    let parsedResult = null;
    if (!hasToolCalls && fullContent.trim()) {
      parsedResult = parseToolCallsFromContent(fullContent);
    }

    if (hasToolCalls || parsedResult) {
      const toolCalls = hasToolCalls ? accumulatedToolCalls : parsedResult.toolCalls;
      const shouldHideContent = parsedResult?.shouldHideContent || false;
      console.log('[widget.js] Tool calls detected:', toolCalls);

      // Store assistant message with tool_calls in history
      const assistantMessage = {
        role: 'assistant',
        content: fullContent || '',
        tool_calls: toolCalls
      };
      state.messages.push(assistantMessage);
      console.log('[widget.js] Stored assistant message with tool_calls in history');

      // Remove the text placeholder (tool execution messages will be shown instead)
      if (assistantMsgEl.parentNode) {
        assistantMsgEl.parentNode.removeChild(assistantMsgEl);
      }

      // Execute each tool call
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function?.name;

        if (toolName) {
          try {
            const args = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;

            console.log(`[widget.js] Executing tool '${toolName}' with args:`, args);

            // Add execution message to chat
            addMessage('system', `Executing ${toolName}...`);

            // Send tool call to parent via postMessage
            window.parent.postMessage({
              source: 'ozwell-chat-widget',
              type: 'tool_call',
              tool: toolName,
              payload: args
            }, '*');
          } catch (error) {
            console.error('[widget.js] Error parsing tool arguments:', error);
            addMessage('system', `Error: Could not execute ${toolName}`);
          }
        }
      }

      // Display text content only if it shouldn't be hidden (i.e., not JSON)
      if (!shouldHideContent && fullContent && fullContent.trim()) {
        lastAssistantMessage = fullContent;
        addMessage('assistant', fullContent);
      }
    } else {
      // No tool calls, just text response
      const assistantMessage = {
        role: 'assistant',
        content: fullContent || '(no response)',
      };
      state.messages.push(assistantMessage);
      lastAssistantMessage = fullContent;

      // Update placeholder if empty
      if (!fullContent.trim()) {
        assistantMsgEl.textContent = '(no response)';
      }
    }

    setStatus('', false);
    if (lastAssistantMessage.trim()) {
      saveButton?.removeAttribute('disabled');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    // Remove placeholder on error
    if (assistantMsgEl.parentNode) {
      assistantMsgEl.parentNode.removeChild(assistantMsgEl);
    }
    addMessage('system', `Error: ${message}`);
    setStatus('Error', false);
  } finally {
    state.sending = false;
    formEl?.classList.remove('is-sending');
    submitButton?.removeAttribute('disabled');
    if (!lastAssistantMessage.trim()) {
      saveButton?.setAttribute('disabled', 'true');
    }
  }
}

async function continueConversationWithToolResult(result) {
  if (state.sending) return;

  console.log('[widget.js] Continuing conversation with tool result:', result);

  // Add tool result to conversation history
  const toolResultMessage = {
    role: 'tool',
    content: typeof result === 'string' ? result : JSON.stringify(result)
  };
  state.messages.push(toolResultMessage);

  setStatus('Processing...', true);
  state.sending = true;
  formEl?.classList.add('is-sending');
  submitButton?.setAttribute('disabled', 'true');
  saveButton?.setAttribute('disabled', 'true');

  // Build MCP tools from parent config (same as sendMessage)
  let tools = [];
  if (state.config.tools && Array.isArray(state.config.tools)) {
    tools = state.config.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }
    }));
  }

  // Build system prompt (same as sendMessage - respects custom prompts)
  const systemPrompt = buildSystemPrompt(tools);

  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add Authorization header if needed
    if (state.config.openaiApiKey) {
      headers['Authorization'] = `Bearer ${state.config.openaiApiKey}`;
      console.log('[widget.js] Using OpenAI API with authorization');
    }

    // Merge in any custom headers from config
    if (state.config.headers) {
      Object.assign(headers, state.config.headers);
      console.log('[widget.js] Added custom headers from config:', state.config.headers);
    }

    // Build messages for request (OpenAI format: system message in messages array)
    const requestMessages = buildMessages();
    if (systemPrompt) {
      // Add system message at the beginning
      requestMessages.unshift({ role: 'system', content: systemPrompt });
    }

    // Build request body (always use OpenAI format)
    const requestBody = {
      model: state.config.model || 'gpt-4o',
      messages: requestMessages,
      tools: tools,
    };

    console.log('[widget.js] Sending tool result to API:', requestBody);

    const response = await fetch(state.config.endpoint || '/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[widget.js] API error:', errorText);
      throw new Error(`Request failed with status ${response.status}: ${errorText}`);
    }

    const payload = await response.json();
    console.log('[widget.js] API response with tool result:', payload);

    // Handle errors
    if (payload.error) {
      throw new Error(payload.error.message || 'Model request failed');
    }

    // Parse OpenAI response format
    const choice = payload.choices?.[0];
    if (!choice) {
      throw new Error('Invalid response format: missing choices array');
    }

    const assistantContent = choice.message?.content || '';

    // Add assistant's final response to conversation
    const assistantMessage = {
      role: 'assistant',
      content: assistantContent || '(no response)',
    };
    state.messages.push(assistantMessage);
    lastAssistantMessage = assistantContent;
    addMessage('assistant', assistantContent || '(no response)');

    // Notify parent of assistant response
    window.parent.postMessage({
      source: 'ozwell-chat-widget',
      type: 'assistant_response',
      message: assistantContent || '(no response)',
      hadToolCalls: false
    }, '*');

    setStatus('', false);
    if (lastAssistantMessage.trim()) {
      saveButton?.removeAttribute('disabled');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    addMessage('system', `Error: ${message}`);
    setStatus('Error', false);
  } finally {
    state.sending = false;
    formEl?.classList.remove('is-sending');
    submitButton?.removeAttribute('disabled');
    if (!lastAssistantMessage.trim()) {
      saveButton?.setAttribute('disabled', 'true');
    }
  }
}

function handleSubmit(event) {
  event.preventDefault();
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  sendMessage(text);
}

function handleParentMessage(event) {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // Handle state updates from parent page (app.js)
  if (data.type === 'STATE_UPDATE' && data.state) {
    console.log('[widget.js] Received state update from parent:', data.state);

    if (data.state.formData) {
      state.formData = data.state.formData;
      console.log('[widget.js] Form data stored:', state.formData);
    }
    return;
  }

  // Handle tool results from parent (OpenAI function calling protocol)
  if (data.source === 'ozwell-chat-parent' && data.type === 'tool_result') {
    console.log('[widget.js] Received tool result from parent:', data.result);

    // Display success/error message in chat
    const result = data.result;
    if (result.success && result.message) {
      addMessage('assistant', result.message);
      lastAssistantMessage = result.message;
      saveButton?.removeAttribute('disabled');
    } else if (result.error) {
      addMessage('system', `Error: ${result.error}`);
    }

    // Note: continueConversationWithToolResult() removed - not needed since we're already
    // showing the success message. The extra LLM call was adding latency and Qwen was
    // just echoing JSON instead of providing natural language response.
    return;
  }

  // Handle legacy messages from embed system
  if (data.source !== 'ozwell-chat-parent') return;

  if (data.type === 'config' && data.payload?.config) {
    applyConfig(data.payload.config);
  }

  if (data.type === 'close') {
    window.parent.postMessage({
      source: 'ozwell-chat-widget',
      type: 'closed',
    }, '*');
  }
}

function notifyReady() {
  // Send IFRAME_READY to register with app.js StateBroker
  window.parent.postMessage({
    type: 'IFRAME_READY',
  }, '*');

  console.log('[widget.js] Sent IFRAME_READY to parent');

  // Also send legacy ready message for embed system
  window.parent.postMessage({
    source: 'ozwell-chat-widget',
    type: 'ready',
  }, '*');
}

function handleSave() {
  if (!lastAssistantMessage.trim()) return;

  window.parent.postMessage({
    source: 'ozwell-chat-widget',
    type: 'insert',
    payload: {
      text: lastAssistantMessage,
      close: true,
    },
  }, '*');

  setStatus('', false);
}

window.addEventListener('message', handleParentMessage);
formEl?.addEventListener('submit', handleSubmit);
saveButton?.addEventListener('click', handleSave);

// Don't show initial system message - keep it clean
setStatus('', false);

// Initialize IframeSyncClient
if (typeof IframeSyncClient !== 'undefined') {
  console.log('[widget.js] Initializing IframeSyncClient...');

  const iframeClient = new IframeSyncClient('ozwell-widget', function (payload, isOwnMessage, isReadyReceived) {
    console.log('[widget.js] Received state from broker:', { payload, isOwnMessage, isReadyReceived });

    if (payload && payload.formData) {
      state.formData = payload.formData;
      console.log('[widget.js] Form data updated:', state.formData);
    }
  });

  // Register with broker
  iframeClient.ready();
  console.log('[widget.js] IframeSyncClient registered with broker');
} else {
  console.warn('[widget.js] IframeSyncClient not available');
}

// Legacy ready notification for embed system
notifyReady();
