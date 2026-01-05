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

/* Queued message (waiting to send) */
.message-queued-wrapper {
  align-self: flex-end;
  max-width: 75%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.message.queued {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  background: transparent;
  color: #0066ff;
  border: 2px dashed #0066ff;
  opacity: 0.8;
}

.message.queued.editing {
  background: #f0f7ff;
  border: 2px solid #0066ff;
  opacity: 1;
}

.queued-input {
  width: 100%;
  padding: 12px 16px;
  border-radius: 12px;
  border: 2px solid #0066ff;
  background: #f0f7ff;
  color: #0066ff;
  font-size: inherit;
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  outline: none;
}

.queued-actions {
  display: flex;
  gap: 8px;
  padding-right: 4px;
}

.queued-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.queued-action-btn:hover {
  background: #e5e7eb;
}

.queued-action-btn svg {
  width: 16px;
  height: 16px;
  stroke: #6b7280;
  stroke-width: 2;
  fill: none;
}

.queued-action-btn:hover svg {
  stroke: #374151;
}

.queued-action-btn.confirm svg {
  stroke: #059669;
}

.queued-action-btn.confirm:hover {
  background: #d1fae5;
}

.queued-action-btn.cancel svg {
  stroke: #dc2626;
}

.queued-action-btn.cancel:hover {
  background: #fee2e2;
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
  font-size: 16px;
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

/* Tool Pills (Debug Mode) */
.tool-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
  align-self: flex-start;
  max-width: 75%;
}

.tool-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  background: #e0e7ff;
  color: #3730a3;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid #c7d2fe;
  user-select: none;
}

.tool-pill:hover {
  background: #c7d2fe;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.tool-pill.expanded {
  background: #c7d2fe;
}

/* Expanded Tool Details (Debug Mode) */
.tool-details {
  align-self: flex-start;
  max-width: 85%;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin: 4px 0 8px 0;
  overflow: visible;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
}

.tool-details-header {
  padding: 10px 14px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  font-weight: 600;
  font-size: 13px;
  color: #374151;
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
}

.tool-details-section {
  padding: 12px 14px;
  border-bottom: 1px solid #f3f4f6;
}

.tool-details-section:last-child {
  border-bottom: none;
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
}

.tool-details-label {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.tool-details-content {
  background: #f9fafb;
  padding: 8px 10px;
  border-radius: 4px;
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 11px;
  color: #1a1a1a;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
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
    // model is optional - server chooses default if not specified
    endpoint: '/v1/chat/completions',
    debug: false, // Debug mode for developers
  },
  messages: [],
  sending: false,
  formData: null, // Form context from parent page
  activeToolCalls: {}, // Track tool_call_id by tool name for OpenAI protocol
  toolExecutions: [], // Track tool executions for debug mode: { id, messageIndex, toolName, arguments, result, timestamp }
  expandedTools: new Set(), // Track which tool pills are expanded
  queuedMessage: null, // Message queued while LLM is responding
  queuedMessageEl: null, // DOM element for queued message bubble
  isEditingQueued: false, // Whether user is editing the queued message
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

// SVG icons for queued message actions
const ICONS = {
  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

/**
 * Build queued message bubble + actions UI inside a wrapper element
 */
function buildQueuedMessageUI(wrapper, text) {
  wrapper.innerHTML = '';

  const bubble = document.createElement('div');
  bubble.className = 'message queued';
  bubble.textContent = text;

  const actions = document.createElement('div');
  actions.className = 'queued-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'queued-action-btn edit';
  editBtn.innerHTML = ICONS.pencil;
  editBtn.title = 'Edit message';
  editBtn.onclick = () => startEditingQueuedMessage();

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'queued-action-btn cancel';
  cancelBtn.innerHTML = ICONS.x;
  cancelBtn.title = 'Cancel message';
  cancelBtn.onclick = () => removeQueuedMessage();

  actions.appendChild(editBtn);
  actions.appendChild(cancelBtn);
  wrapper.appendChild(bubble);
  wrapper.appendChild(actions);
}

/**
 * Add a queued message bubble (shown while LLM is responding)
 */
function addQueuedMessage(text) {
  if (!messagesEl) return;

  removeQueuedMessage();
  state.queuedMessage = text;

  const wrapper = document.createElement('div');
  wrapper.className = 'message-queued-wrapper';
  buildQueuedMessageUI(wrapper, text);

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  state.queuedMessageEl = wrapper;
}

/**
 * Remove the queued message bubble
 */
function removeQueuedMessage() {
  if (state.queuedMessageEl && state.queuedMessageEl.parentNode) {
    state.queuedMessageEl.parentNode.removeChild(state.queuedMessageEl);
  }
  state.queuedMessage = null;
  state.queuedMessageEl = null;
  state.isEditingQueued = false;
}

/**
 * Start inline editing of queued message
 */
function startEditingQueuedMessage() {
  if (!state.queuedMessageEl || state.isEditingQueued) return;

  state.isEditingQueued = true;

  const wrapper = state.queuedMessageEl;
  const bubble = wrapper.querySelector('.message.queued');
  const actions = wrapper.querySelector('.queued-actions');

  // Replace bubble with textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'queued-input';
  textarea.value = state.queuedMessage;
  textarea.rows = Math.max(1, Math.ceil(state.queuedMessage.length / 40));

  bubble.style.display = 'none';
  wrapper.insertBefore(textarea, actions);

  // Update action buttons to confirm/cancel
  actions.innerHTML = '';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'queued-action-btn confirm';
  confirmBtn.innerHTML = ICONS.check;
  confirmBtn.title = 'Confirm edit';
  confirmBtn.onclick = () => confirmEditQueuedMessage(textarea.value);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'queued-action-btn cancel';
  cancelBtn.innerHTML = ICONS.x;
  cancelBtn.title = 'Cancel edit';
  cancelBtn.onclick = () => cancelEditQueuedMessage();

  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);

  textarea.focus();
  textarea.select();

  // Handle Enter key to confirm
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      confirmEditQueuedMessage(textarea.value);
    }
    if (e.key === 'Escape') {
      cancelEditQueuedMessage();
    }
  });
}

/**
 * Confirm the edit and update queued message
 */
function confirmEditQueuedMessage(newText) {
  if (!newText.trim()) {
    removeQueuedMessage();
    return;
  }

  state.queuedMessage = newText.trim();
  state.isEditingQueued = false;
  buildQueuedMessageUI(state.queuedMessageEl, state.queuedMessage);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Cancel editing and restore original bubble
 */
function cancelEditQueuedMessage() {
  state.isEditingQueued = false;
  buildQueuedMessageUI(state.queuedMessageEl, state.queuedMessage);
}

/**
 * Send the queued message (called when LLM finishes responding)
 */
function sendQueuedMessage() {
  if (!state.queuedMessage) return;

  const text = state.queuedMessage;
  removeQueuedMessage();

  // Now send the message normally
  sendMessage(text);
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
  // Just return message history - system prompt is handled by buildSystemPrompt()
  return [...state.messages];
}

function buildSystemPrompt() {
  // Start with custom system prompt from parent config
  let systemPrompt = state.config.system || 'You are a helpful assistant.';

  // APPEND form context if available (don't replace!)
  if (state.formData) {
    console.log('[widget.js] Including form context in system prompt:', state.formData);
    systemPrompt += `\n\nCurrent page context:\n${JSON.stringify(state.formData, null, 2)}`;
  }

  // Add generic tool usage guidance if tools are available
  if (state.config.tools && state.config.tools.length > 0) {
    systemPrompt += `\n\n=== TOOL USAGE GUIDELINES ===

You have access to tools. Use them wisely:

**Default behavior:** Respond naturally with conversation. Only use tools when truly necessary.

**Do NOT use tools for:**
- Simple greetings, pleasantries, or casual conversation
- Questions you can answer from information already provided in the context above
- General knowledge questions within your training
- Clarifications or follow-up conversation

**DO use tools when:**
- User explicitly requests current/live data that isn't in the context above
- User asks you to perform an action (update, change, modify, set, etc.)
- You genuinely need information not available in the current context

**After calling a tool:** Use the result to answer the user's question. Do not call the same tool repeatedly.`;
  }

  return systemPrompt;
}

/**
 * Create and render tool pills (debug mode only)
 * @param {Array} toolCalls - Array of tool call objects
 * @param {string} groupId - Unique ID for this group of tool calls
 */
function renderToolPills(toolCalls, groupId) {
  if (!state.config.debug || !toolCalls || toolCalls.length === 0) {
    return; // Debug mode is off or no tools to display
  }

  // Create container for pills
  const pillsContainer = document.createElement('div');
  pillsContainer.className = 'tool-pills';
  pillsContainer.dataset.groupId = groupId;

  // Create a pill for each tool call
  toolCalls.forEach((toolCall, index) => {
    const toolId = `${groupId}-${index}`;
    const toolName = toolCall.function?.name || 'unknown';

    // Create pill element
    const pill = document.createElement('div');
    pill.className = 'tool-pill';
    pill.dataset.toolId = toolId;

    // No icon needed - just the tool name

    // Add tool name
    const name = document.createElement('span');
    name.textContent = toolName;
    pill.appendChild(name);

    // Add click handler for expansion
    pill.addEventListener('click', () => toggleToolDetails(toolId, toolCall));

    pillsContainer.appendChild(pill);
  });

  // Add to messages container
  if (messagesEl) {
    messagesEl.appendChild(pillsContainer);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

/**
 * Toggle tool details expansion/collapse
 * @param {string} toolId - Unique tool ID
 * @param {Object} toolCall - Tool call object with arguments
 */
function toggleToolDetails(toolId, toolCall) {
  const pill = document.querySelector(`[data-tool-id="${toolId}"]`);
  if (!pill) return;

  const isExpanded = state.expandedTools.has(toolId);

  if (isExpanded) {
    // Collapse - remove details and update state
    const details = document.querySelector(`[data-tool-details="${toolId}"]`);
    if (details) {
      details.remove();
    }
    pill.classList.remove('expanded');
    state.expandedTools.delete(toolId);
  } else {
    // Expand - show details
    const details = createToolDetails(toolId, toolCall);

    // Insert details after the pills container
    const pillsContainer = pill.closest('.tool-pills');
    if (pillsContainer && pillsContainer.nextSibling) {
      pillsContainer.parentNode.insertBefore(details, pillsContainer.nextSibling);
    } else if (pillsContainer) {
      pillsContainer.parentNode.appendChild(details);
    }

    pill.classList.add('expanded');
    state.expandedTools.add(toolId);

    // Scroll to show details
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }
}

/**
 * Create tool details element
 * @param {string} toolId - Unique tool ID
 * @param {Object} toolCall - Tool call object
 * @returns {HTMLElement} Details element
 */
function createToolDetails(toolId, toolCall) {
  const toolName = toolCall.function?.name || 'unknown';

  // Parse arguments
  let args = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch (e) {
    args = { error: 'Failed to parse arguments' };
  }

  // Get result from tracked executions
  const execution = state.toolExecutions.find(exec => exec.toolCallId === toolCall.id);
  const result = execution?.result || { status: 'pending' };

  // Create details container
  const details = document.createElement('div');
  details.className = 'tool-details';
  details.dataset.toolDetails = toolId;

  // Header
  const header = document.createElement('div');
  header.className = 'tool-details-header';
  header.textContent = toolName;
  details.appendChild(header);

  // Arguments section
  const argsSection = document.createElement('div');
  argsSection.className = 'tool-details-section';

  const argsLabel = document.createElement('div');
  argsLabel.className = 'tool-details-label';
  argsLabel.textContent = 'Arguments';
  argsSection.appendChild(argsLabel);

  const argsContent = document.createElement('div');
  argsContent.className = 'tool-details-content';
  argsContent.textContent = JSON.stringify(args, null, 2);
  argsSection.appendChild(argsContent);

  details.appendChild(argsSection);

  // Result section
  const resultSection = document.createElement('div');
  resultSection.className = 'tool-details-section';

  const resultLabel = document.createElement('div');
  resultLabel.className = 'tool-details-label';
  resultLabel.textContent = 'Result';
  resultSection.appendChild(resultLabel);

  const resultContent = document.createElement('div');
  resultContent.className = 'tool-details-content';
  resultContent.textContent = JSON.stringify(result, null, 2);
  resultSection.appendChild(resultContent);

  details.appendChild(resultSection);

  return details;
}

/**
 * Update tool execution result in debug tracking
 * @param {string} toolCallId - Tool call ID
 * @param {Object} result - Tool execution result
 */
function updateToolExecutionResult(toolCallId, result) {
  if (!state.config.debug) return;

  const execution = state.toolExecutions.find(exec => exec.toolCallId === toolCallId);
  if (execution) {
    execution.result = result;
    execution.completedAt = Date.now();

    // If this tool is currently expanded, update the display
    const expandedToolId = Array.from(state.expandedTools).find(id => id.includes(toolCallId));

    if (expandedToolId) {
      // Re-render the details
      const details = document.querySelector(`[data-tool-details="${expandedToolId}"]`);
      if (details) {
        const resultContent = details.querySelector('.tool-details-section:last-child .tool-details-content');
        if (resultContent) {
          resultContent.textContent = JSON.stringify(result, null, 2);
        }
      }
    }
  }
}

async function sendMessage(text) {
  // If LLM is busy, queue the message instead of dropping it
  if (state.sending) {
    console.log('[widget.js] LLM busy, queuing message:', text);
    addQueuedMessage(text);
    return;
  }

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
  saveButton?.setAttribute('disabled', 'true');
  lastAssistantMessage = '';

  // Build system prompt (handles custom prompts and form context)
  const systemPrompt = buildSystemPrompt();

  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add Authorization header - use configured key or default to 'ollama' for server routing
    if (state.config.openaiApiKey) {
      headers['Authorization'] = `Bearer ${state.config.openaiApiKey}`;
      console.log('[widget.js] Using OpenAI API with authorization');
    } else {
      // Default to 'ollama' - server will route to Ollama if available, or mock if not
      headers['Authorization'] = 'Bearer ollama';
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
    // Only include model if explicitly configured - server chooses default otherwise
    const requestBody = {
      messages: requestMessages,
      tools: tools,
      stream: false,
    };
    if (state.config.model) {
      requestBody.model = state.config.model;
    }

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
    // If we have tool_calls from the response (structured), hide raw JSON content
    const parsedFromContent = parseToolCallsFromContent(assistantContent);
    const shouldHideContent = parsedFromContent?.shouldHideContent || (!!toolCalls && toolCalls.length > 0);

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
              payload: args,
              tool_call_id: toolCall.id
            }, '*');

            // No system messages - tools are invisible to end users
          } catch (error) {
            console.error('[widget.js] Error parsing tool arguments:', error);
            // Errors are logged to console, not shown to user
          }
        }
      }

      // Display text content in UI if present and not hidden (parsed/structured tool calls should hide the raw JSON)
      if (!shouldHideContent && assistantContent && assistantContent.trim()) {
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
}

async function sendMessageStreaming(text, tools) {
  setStatus('Processing...', true);
  state.sending = true;
  formEl?.classList.add('is-sending');
  saveButton?.setAttribute('disabled', 'true');
  lastAssistantMessage = '';

  // Build system prompt
  const systemPrompt = buildSystemPrompt();

  // Create placeholder message element for incremental updates
  const assistantMsgEl = document.createElement('div');
  assistantMsgEl.className = 'message assistant';
  messagesEl?.appendChild(assistantMsgEl);

  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add Authorization header - use configured key or default to 'ollama' for server routing
    if (state.config.openaiApiKey) {
      headers['Authorization'] = `Bearer ${state.config.openaiApiKey}`;
    } else {
      // Default to 'ollama' - server will route to Ollama if available, or mock if not
      headers['Authorization'] = 'Bearer ollama';
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
    // Only include model if explicitly configured - server chooses default otherwise
    const requestBody = {
      messages: requestMessages,
      stream: true,
    };
    if (state.config.model) {
      requestBody.model = state.config.model;
    }

    // Include tools if available
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch(state.config.endpoint || '/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120000) // 2 minute timeout for Ollama requests
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
      const shouldHideContent = parsedResult?.shouldHideContent || hasToolCalls || false;
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

      // Render tool pills in debug mode (BEFORE executing tools)
      const groupId = `tool-group-${Date.now()}`;
      if (state.config.debug) {
        renderToolPills(toolCalls, groupId);
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

            // Track tool execution in debug mode
            if (state.config.debug) {
              state.toolExecutions.push({
                toolCallId: toolCall.id,
                toolName: toolName,
                arguments: args,
                result: null,
                timestamp: Date.now(),
                completedAt: null
              });
            }

            // No system messages - tools are invisible to end users when debug is off
            // In debug mode, pills show the execution instead

            // Store tool_call_id for later use in tool message
            state.activeToolCalls[toolName] = toolCall.id;

            // Send tool call to parent via postMessage
            window.parent.postMessage({
              source: 'ozwell-chat-widget',
              type: 'tool_call',
              tool: toolName,
              tool_call_id: toolCall.id,  // Include ID for parent logging/tracking
              payload: args
            }, '*');
          } catch (error) {
            console.error('[widget.js] Error parsing tool arguments:', error);
            // Errors are logged to console, not shown to user unless debug mode
          }
        }
      }

      // Display text content only if it shouldn't be hidden (i.e., not JSON)
      if (!shouldHideContent && fullContent && fullContent.trim()) {
        lastAssistantMessage = fullContent;
        addMessage('assistant', fullContent);
      }
      // Skip notification - tool execution flow will notify when complete
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

      // Notify parent of assistant response (for notification system)
      window.parent.postMessage({
        source: 'ozwell-chat-widget',
        type: 'assistant_response',
        message: fullContent || '(no response)',
        hadToolCalls: false
      }, '*');

      // Send any queued message now that LLM is done (no tool calls pending)
      if (state.queuedMessage) {
        // Use setTimeout to let the UI update first
        setTimeout(() => sendQueuedMessage(), 100);
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
  const systemPrompt = buildSystemPrompt();

  try {
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add Authorization header - use configured key or default to 'ollama' for server routing
    if (state.config.openaiApiKey) {
      headers['Authorization'] = `Bearer ${state.config.openaiApiKey}`;
      console.log('[widget.js] Using OpenAI API with authorization');
    } else {
      // Default to 'ollama' - server will route to Ollama if available, or mock if not
      headers['Authorization'] = 'Bearer ollama';
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
    // Only include model if explicitly configured - server chooses default otherwise
    const requestBody = {
      messages: requestMessages,
      tools: tools,
    };
    if (state.config.model) {
      requestBody.model = state.config.model;
    }

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

    const result = data.result;
    const toolCallId = data.tool_call_id;

    // Update tool execution result in debug mode
    if (toolCallId) {
      updateToolExecutionResult(toolCallId, result);
    }

    // Check if this is an update tool (has success/message) or a get tool (raw data)
    if (result.success && result.message) {
      // Update tool - just display the message (no LLM continuation needed)
      addMessage('assistant', result.message);
      lastAssistantMessage = result.message;
      saveButton?.removeAttribute('disabled');

      // Notify parent of assistant response (for notification system)
      window.parent.postMessage({
        source: 'ozwell-chat-widget',
        type: 'assistant_response',
        message: result.message,
        hadToolCalls: false  // This is the final response after tool execution
      }, '*');

      // After displaying the tool result message, send any queued user message (if present)
      if (state.queuedMessage) {
        sendQueuedMessage();
      }
    } else if (result.error) {
      // Error case
      addMessage('system', `Error: ${result.error}`);
    } else {
      // Get tool - raw data returned, need to send back to LLM for final answer
      console.log('[widget.js] Raw data tool result detected, continuing conversation with LLM');

      // Get tool_call_id from parent response (required for OpenAI protocol)
      if (!toolCallId) {
        console.error('[widget.js] tool_call_id missing from parent response - cannot continue conversation');
        addMessage('system', 'Error: Tool result missing ID');
        return;
      }

      // Add tool result to conversation history with tool_call_id
      state.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify(result)
      });

      // Continue conversation by calling LLM with tool result
      const tools = state.config.tools?.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }
      })) || [];

      // Send empty user message - we're just continuing the conversation with tool result
      sendMessageStreaming('', tools);
    }

    return;
  }

  // Handle send-message from parent (per iframe-integration.md spec)
  if (data.source === 'ozwell-chat-parent' && data.type === 'ozwell:send-message' && data.payload?.content) {
    console.log('[widget.js] Received ozwell:send-message from parent:', data.payload.content);
    sendMessage(data.payload.content);
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
