const state = {
  config: {
    title: 'Ozwell',
    placeholder: 'Ask a question...',
    model: 'llama3',
    endpoint: '/embed/chat',
  },
  messages: [],
  sending: false,
  formData: null, // Form context from parent page
};

console.log('[widget.js] Widget initializing...');

const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const submitButton = document.querySelector('.chat-submit');
const saveButton = document.getElementById('save-button');

let lastAssistantMessage = '';

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
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
    inputEl.placeholder = state.config.placeholder || 'Ask a question...';
  }

  setStatus('Ready');
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
    systemPrompt += `\n\nYou have access to tools that can modify data. Each tool's description explains what it does.

TOOL USAGE RULES:
- Use tools ONLY when the user explicitly asks you to take an ACTION (update, change, modify, set, create, delete, submit, etc.)
- For ALL other interactions (questions, greetings, general conversation), respond with plain text - DO NOT call any tools
- When in doubt, respond with text instead of calling a tool
- NEVER return raw JSON or explain tool calls in your response - just have a natural conversation

The distinction:
• "Tell me X" / "What is X" / "Show me X" = Respond with text (you already have the context)
• "Change X to Y" / "Update X" / "Set X to Y" = Call the appropriate tool`;
  }

  return systemPrompt;
}

async function sendMessage(text) {
  if (state.sending) return;

  const userMessage = { role: 'user', content: text };
  state.messages.push(userMessage);
  addMessage('user', text);

  // Notify parent of user message
  window.parent.postMessage({
    source: 'ozwell-chat-widget',
    type: 'user_message',
    message: text
  }, '*');

  setStatus('Thinking...');
  state.sending = true;
  formEl?.classList.add('is-sending');
  submitButton?.setAttribute('disabled', 'true');
  saveButton?.setAttribute('disabled', 'true');
  lastAssistantMessage = '';

  // Build MCP tools from parent config (dynamic, not hardcoded)
  let tools = [];
  if (state.config.tools && Array.isArray(state.config.tools)) {
    // Parent's tool definitions must be in OpenAI function calling format
    // Format: { type: 'function', function: { name, description, parameters } }
    tools = state.config.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }
    }));

    console.log('[widget.js] Tools loaded from config:', tools);
  }

  // Build system prompt (handles custom prompts, form context, and tool rules)
  const systemPrompt = buildSystemPrompt(tools);

  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add Authorization header if OpenAI API key is provided
    if (state.config.openaiApiKey) {
      headers['Authorization'] = `Bearer ${state.config.openaiApiKey}`;
      console.log('[widget.js] Using OpenAI API with authorization');
    }

    // Build messages for request (OpenAI format includes system in messages array)
    const requestMessages = buildMessages();
    if (state.config.openaiApiKey && systemPrompt) {
      // OpenAI format: system message in messages array
      requestMessages.unshift({ role: 'system', content: systemPrompt });
    }

    // Build request body
    const requestBody = state.config.openaiApiKey
      ? {
          model: state.config.model,
          messages: requestMessages,
          tools: tools,
        }
      : {
          model: state.config.model,
          system: systemPrompt,
          messages: buildMessages(),
          tools: tools,
        };

    const response = await fetch(state.config.endpoint || '/embed/chat', {
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

    if (payload.warning) {
      addMessage('system', payload.warning);
    }

    // Parse response based on format (OpenAI vs Ollama)
    let assistantContent;
    let toolCalls = null;

    if (payload.choices && payload.choices[0]) {
      // OpenAI format
      const choice = payload.choices[0];
      assistantContent = choice.message?.content || '';
      toolCalls = choice.message?.tool_calls;
    } else if (payload.message) {
      // Ollama format
      assistantContent = payload.message.content || '';
      toolCalls = payload.message.tool_calls;
    } else {
      assistantContent = '(no response)';
    }

    // Handle tool calls (dynamic - works with any tool from parent config)
    if (toolCalls && toolCalls.length > 0) {
      console.log('[widget.js] Model returned tool calls:', toolCalls);

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

      // If there's also text content, show it
      if (assistantContent && assistantContent.trim()) {
        const assistantMessage = {
          role: 'assistant',
          content: assistantContent,
        };
        state.messages.push(assistantMessage);
        lastAssistantMessage = assistantContent;
        addMessage('assistant', assistantContent);

        // Notify parent of assistant response (with tool calls)
        window.parent.postMessage({
          source: 'ozwell-chat-widget',
          type: 'assistant_response',
          message: assistantContent,
          hadToolCalls: true
        }, '*');
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

      // Notify parent of assistant response (text only)
      window.parent.postMessage({
        source: 'ozwell-chat-widget',
        type: 'assistant_response',
        message: assistantContent || '(no response)',
        hadToolCalls: false
      }, '*');
    }

    setStatus('Ready');
    if (lastAssistantMessage.trim()) {
      saveButton?.removeAttribute('disabled');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    addMessage('system', `Error: ${message}`);
    setStatus('Error');
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

  setStatus('Processing tool result...');
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

    // Add Authorization header if OpenAI API key is provided
    if (state.config.openaiApiKey) {
      headers['Authorization'] = `Bearer ${state.config.openaiApiKey}`;
      console.log('[widget.js] Using OpenAI API with authorization');
    }

    // Build messages for request
    const requestMessages = buildMessages();

    // Build request body
    const requestBody = state.config.openaiApiKey
      ? {
          model: state.config.model,
          messages: requestMessages,
          tools: tools,
        }
      : {
          model: state.config.model,
          system: systemPrompt,
          messages: requestMessages,
          tools: tools,
        };

    console.log('[widget.js] Sending tool result to API:', requestBody);

    const response = await fetch(state.config.endpoint || '/embed/chat', {
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

    if (payload.warning) {
      addMessage('system', payload.warning);
    }

    // Parse response based on format (OpenAI vs Ollama)
    let assistantContent;

    if (payload.choices && payload.choices[0]) {
      // OpenAI format
      const choice = payload.choices[0];
      assistantContent = choice.message?.content || '';
    } else if (payload.message) {
      // Ollama format
      assistantContent = payload.message.content || '';
    } else {
      assistantContent = '(no response)';
    }

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

    setStatus('Ready');
    if (lastAssistantMessage.trim()) {
      saveButton?.removeAttribute('disabled');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    addMessage('system', `Error: ${message}`);
    setStatus('Error');
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
    continueConversationWithToolResult(data.result);
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

  setStatus('Sent to host');
}

window.addEventListener('message', handleParentMessage);
formEl?.addEventListener('submit', handleSubmit);
saveButton?.addEventListener('click', handleSave);

addMessage('system', 'Widget loaded. Waiting for configuration...');
setStatus('Waiting for host...');

// Initialize IframeSyncClient
if (typeof IframeSyncClient !== 'undefined') {
  console.log('[widget.js] Initializing IframeSyncClient...');

  const iframeClient = new IframeSyncClient('ozwell-widget', function(payload, isOwnMessage, isReadyReceived) {
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
