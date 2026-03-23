/**
 * ============================================
 * OZWELL CHAT WIDGET (Self-Contained)
 * ============================================
 *
 * This file bundles everything needed for the widget:
 * - CSS styles (inlined)
 * - HTML structure (dynamically injected)
 * - Widget logic
 *
 * Communication with parent page uses postMessage only:
 * - Lifecycle: ready, closed (signals only, no data)
 * - MCP tools: tool_call, tool_result (by design)
 * - Config: config, request-config
 * - Notifications: assistant_response (signal only)
 *
 * No private chat data crosses the iframe boundary.
 */

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

.status-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 14px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  min-height: 32px;
}

.status {
  font-size: 12px;
  color: transparent;
  display: flex;
  align-items: center;
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

/* Reasoning mode capsule & segmented control */
.reasoning-capsule {
  font-size: 11px;
  color: #6b7280;
  cursor: pointer;
  padding: 3px 10px;
  border-radius: 12px;
  background: #e5e7eb;
  user-select: none;
  transition: all 0.2s;
  white-space: nowrap;
}

.reasoning-capsule:hover {
  background: #d1d5db;
}

.reasoning-seg {
  display: none;
  background: #e5e7eb;
  border-radius: 12px;
  padding: 2px;
  gap: 2px;
  font-size: 11px;
}

.reasoning-seg.open {
  display: inline-flex;
}

.reasoning-seg-btn {
  padding: 3px 10px;
  border-radius: 10px;
  cursor: pointer;
  color: #6b7280;
  background: transparent;
  border: none;
  font-size: 11px;
  font-family: inherit;
  transition: all 0.15s;
  white-space: nowrap;
}

.reasoning-seg-btn:hover {
  color: #374151;
  background: #d1d5db;
}

.reasoning-seg-btn.active {
  background: #fff;
  color: #1f2937;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
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

/* Thinking / Reasoning Bubble */
.thinking-bubble {
  align-self: flex-start;
  max-width: 85%;
  margin-bottom: 4px;
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  background: #f3f0ff;
  border: 1px solid #e0d8ff;
  border-radius: 10px;
  font-size: 11px;
  color: #8b5cf6;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.thinking-toggle:hover {
  background: #ede9fe;
}

.thinking-toggle .thinking-arrow {
  display: inline-block;
  transition: transform 0.2s;
  font-size: 10px;
}

.thinking-toggle .thinking-arrow.expanded {
  transform: rotate(180deg);
}

.thinking-toggle .thinking-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #8b5cf6;
  border-radius: 50%;
  animation: thinkingPulse 1.2s ease-in-out infinite;
}

@keyframes thinkingPulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.thinking-content {
  margin-top: 6px;
  padding: 10px 14px;
  background: #fafafa;
  border-left: 2px solid #c4b5fd;
  border-radius: 0 10px 10px 0;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
  max-height: 300px;
  opacity: 1;
}

.thinking-content.collapsed {
  max-height: 0;
  opacity: 0;
  padding: 0 14px;
  margin-top: 0;
}
  `;
  document.head.appendChild(style);

  // Inject HTML structure
  document.body.innerHTML = `
    <div class="chat-container">
      <div class="status-strip">
        <div id="status" class="status">Connecting...</div>
        <div id="reasoning-controls"></div>
      </div>
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
    thinkingEnabled: false, // Show reasoning/thinking tokens from models
    thinkingDefaultMode: 2, // 0=None, 1=Peek, 2=Smart (expand-then-collapse), 3=Expanded
  },
  messages: [],
  sending: false,
  activeToolCalls: {}, // Track tool_call_id by tool name for OpenAI protocol
  toolExecutions: [], // Track tool executions for debug mode: { id, messageIndex, toolName, arguments, result, timestamp }
  expandedTools: new Set(), // Track which tool pills are expanded
  queuedMessage: null, // Message queued while LLM is responding
  queuedMessageEl: null, // DOM element for queued message bubble
  isEditingQueued: false, // Whether user is editing the queued message
  parentOrigin: null, // Pinned parent origin from first validated config message
};

// MCP pending tool call tracker (keyed by JSON-RPC request id)
let mcpRequestId = 0;
const mcpPendingToolCalls = {};
const MCP_TOOL_TIMEOUT_MS = 30000;

function trackPendingToolCall(id) {
  mcpPendingToolCalls[id] = true;
  setTimeout(() => { delete mcpPendingToolCalls[id]; }, MCP_TOOL_TIMEOUT_MS);
}

// Read OZWELL_CONFIG from window (set by embedding page before widget loads)
if (typeof window !== 'undefined' && window.OZWELL_CONFIG) {
  const extConf = window.OZWELL_CONFIG;
  const keys = ['endpoint', 'apiKey', 'openaiApiKey', 'title', 'placeholder', 'model', 'system', 'tools', 'debug', 'welcomeMessage', 'thinkingEnabled', 'thinkingDefaultMode'];
  for (const k of keys) {
    if (extConf[k] !== undefined) state.config[k] = extConf[k];
  }
  console.log('[widget.js] Applied OZWELL_CONFIG:', Object.keys(extConf));
}

console.log('[widget.js] Widget initializing...');
console.log('[widget.js] Type OzwellDebug.help() in console for debug commands');

const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const submitButton = document.querySelector('.chat-submit');
const reasoningControlsEl = document.getElementById('reasoning-controls');
let lastAssistantMessage = '';

/**
 * Post a message to the parent frame using the pinned origin when available.
 * Falls back to '*' only before the first config handshake completes.
 */
function postToParent(message) {
  const targetOrigin = state.parentOrigin || '*';
  window.parent.postMessage(message, targetOrigin);
}

// Thinking mode constants — used for thinkingDefaultMode config value
const THINKING = { NONE: 0, PEEK: 1, SMART: 2, EXPANDED: 3 };
// Reasoning mode labels: index maps to thinkingDefaultMode values
const REASONING_MODES = ['None', 'Peek', 'Smart', 'Expanded'];

/**
 * Build the reasoning capsule + segmented control in the status strip.
 * Only shown when thinkingEnabled is true.
 */
function initReasoningControls() {
  if (!reasoningControlsEl || !state.config.thinkingEnabled) return;
  reasoningControlsEl.innerHTML = '';

  const capsule = document.createElement('button');
  capsule.className = 'reasoning-capsule';
  capsule.title = 'Controls how AI reasoning is displayed';
  capsule.textContent = `Reasoning: ${REASONING_MODES[state.config.thinkingDefaultMode] || 'Smart'}`;

  const seg = document.createElement('div');
  seg.className = 'reasoning-seg';

  REASONING_MODES.forEach((label, idx) => {
    const btn = document.createElement('button');
    btn.className = 'reasoning-seg-btn' + (idx === state.config.thinkingDefaultMode ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      seg.querySelectorAll('.reasoning-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.config.thinkingDefaultMode = idx;
      capsule.textContent = `Reasoning: ${label}`;
      seg.classList.remove('open');
      capsule.style.display = '';
      applyThinkingModeToExisting(idx);
      console.log(`[widget.js] Reasoning mode changed to: ${label} (${idx})`);
    });
    seg.appendChild(btn);
  });

  capsule.addEventListener('click', () => {
    capsule.style.display = 'none';
    seg.classList.add('open');
  });

  reasoningControlsEl.appendChild(capsule);
  reasoningControlsEl.appendChild(seg);
}

/** Apply a mode change to all existing thinking bubbles in the chat */
function applyThinkingModeToExisting(mode) {
  if (!messagesEl) return;
  const bubbles = messagesEl.querySelectorAll('.thinking-bubble');
  bubbles.forEach(bubble => {
    if (mode === THINKING.NONE) {
      bubble.style.display = 'none';
    } else {
      bubble.style.display = '';
      const content = bubble.querySelector('.thinking-content');
      const arrow = bubble.querySelector('.thinking-arrow');
      if (!content) return;
      if (mode === THINKING.EXPANDED) {
        content.classList.remove('collapsed');
        if (arrow) arrow.textContent = '▾';
      } else {
        // Peek or Smart: collapse
        content.classList.add('collapsed');
        if (arrow) arrow.textContent = '▸';
      }
    }
  });
}

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

  // Initialize reasoning controls if thinking is enabled
  initReasoningControls();
}

function buildMessages() {
  // Strip thinking field — it's for UI display only, not re-sent to the model
  return state.messages.map(({ thinking, ...rest }) => rest);
}

function buildSystemPrompt() {
  // Start with custom system prompt from parent config
  let systemPrompt = state.config.system || 'You are a helpful assistant.';

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

/** Get configured auth key */
function getAuthKey() {
  return state.config.apiKey || state.config.openaiApiKey || '';
}

/** Build request headers with auth + any custom headers */
function getRequestHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const authKey = getAuthKey();
  if (authKey) {
    headers['Authorization'] = `Bearer ${authKey}`;
  }
  if (state.config.headers) {
    Object.assign(headers, state.config.headers);
  }
  return headers;
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

/**
 * Create a thinking bubble element for displaying reasoning tokens.
 * @param {number} mode - Display mode (0=hide, 1=collapsed, 2=expand-then-collapse, 3=always-expanded)
 * @returns {{ container: HTMLElement, contentEl: HTMLElement, update: Function, finish: Function }}
 */
function createThinkingBubble(mode) {
  const container = document.createElement('div');
  container.className = 'thinking-bubble';
  const startTime = Date.now();

  const toggle = document.createElement('div');
  toggle.className = 'thinking-toggle';

  const dot = document.createElement('span');
  dot.className = 'thinking-dot';

  const label = document.createElement('span');
  label.textContent = 'Thinking';

  const arrow = document.createElement('span');
  arrow.className = 'thinking-arrow';
  arrow.textContent = mode === THINKING.PEEK ? '▸' : '▾';

  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');
  toggle.setAttribute('aria-expanded', mode !== THINKING.PEEK ? 'true' : 'false');
  toggle.appendChild(dot);
  toggle.appendChild(label);
  toggle.appendChild(arrow);

  const contentEl = document.createElement('div');
  contentEl.className = 'thinking-content';
  // Start collapsed or expanded based on mode
  if (mode === THINKING.PEEK) {
    contentEl.classList.add('collapsed');
  }

  const handleToggle = () => {
    const isCollapsed = contentEl.classList.contains('collapsed');
    if (isCollapsed) {
      contentEl.classList.remove('collapsed');
      arrow.textContent = '▾';
      toggle.setAttribute('aria-expanded', 'true');
    } else {
      contentEl.classList.add('collapsed');
      arrow.textContent = '▸';
      toggle.setAttribute('aria-expanded', 'false');
    }
  };
  toggle.addEventListener('click', handleToggle);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); }
  });

  container.appendChild(toggle);
  container.appendChild(contentEl);

  return {
    container,
    contentEl,
    update(newText) {
      // Use direct textContent — thinking content replaces fully since it accumulates
      contentEl.textContent = newText;
    },
    finish() {
      // Calculate duration
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const durationText = elapsed > 0 ? ` for ${elapsed}s` : '';

      // Stop the pulsing dot
      dot.remove();
      label.textContent = `Thought${durationText}`;

      // Smart: collapse on answer arrival
      if (mode === THINKING.SMART) {
        contentEl.classList.add('collapsed');
        arrow.textContent = '▸';
      }
    }
  };
}

// Debounced scroll-to-bottom using rAF to avoid per-chunk reflows
let _scrollRafPending = false;
function scrollToBottom() {
  if (_scrollRafPending) return;
  _scrollRafPending = true;
  requestAnimationFrame(() => {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    _scrollRafPending = false;
  });
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

  // Require an API key or agent key to be configured
  if (!getAuthKey()) {
    addMessage('system', 'Error: No API key configured. Please provide an agent key (agnt_key-...) or parent API key (ozw_...) in your OzwellChatConfig.');
    return;
  }

  // Build tools list (discovered via MCP tools/list handshake on init)
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

  // Build system prompt
  const systemPrompt = buildSystemPrompt();

  try {
    const headers = getRequestHeaders();

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

            // Send tool call to parent via MCP tools/call
            trackPendingToolCall(toolCall.id);
            mcpSend('tools/call', { name: toolName, arguments: args }, toolCall.id);
          } catch (error) {
            console.error('[widget.js] Error parsing tool arguments:', error);
          }
        }
      }

      // Display text content in UI if present and not hidden (parsed/structured tool calls should hide the raw JSON)
      if (!shouldHideContent && assistantContent && assistantContent.trim()) {
        addMessage('assistant', assistantContent);
      }
    } else {
      // No tool calls, just regular response
      const assistantMessage = {
        role: 'assistant',
        content: assistantContent || '(no response)',
      };
      state.messages.push(assistantMessage);
      addMessage('assistant', assistantContent || '(no response)');
    }

    setStatus('', false);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    addMessage('system', `Error: ${message}`);
    setStatus('Error', false);
  } finally {
    state.sending = false;
    formEl?.classList.remove('is-sending');
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

async function sendMessageStreaming(text, tools, _thinkingRetryCount = 0) {
  setStatus('Processing...', true);
  state.sending = true;
  formEl?.classList.add('is-sending');
  lastAssistantMessage = '';
  let _needsThinkingRetry = false;

  // Build system prompt
  const systemPrompt = buildSystemPrompt();

  // Create placeholder message element for incremental updates
  const assistantMsgEl = document.createElement('div');
  assistantMsgEl.className = 'message assistant';
  messagesEl?.appendChild(assistantMsgEl);

  try {
    const headers = getRequestHeaders();

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
    let fullThinking = '';
    let accumulatedToolCalls = []; // Accumulate tool calls from deltas
    let thinkingBubble = null; // Thinking bubble UI (created on first thinking token)
    // Capture mode at stream start so mid-stream toggle doesn't cause inconsistency
    const thinkingMode = state.config.thinkingDefaultMode ?? THINKING.SMART;

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

            // Handle thinking/reasoning tokens
            if (delta.thinking && state.config.thinkingEnabled && thinkingMode !== THINKING.NONE) {
              fullThinking += delta.thinking;

              // Create thinking bubble on first token
              if (!thinkingBubble) {
                thinkingBubble = createThinkingBubble(thinkingMode);
                // Insert thinking bubble before the assistant message element
                messagesEl?.insertBefore(thinkingBubble.container, assistantMsgEl);
              }
              thinkingBubble.update(fullThinking);
              scrollToBottom();
            }

            // Handle text content (streaming)
            if (delta.content) {
              fullContent += delta.content;
              assistantMsgEl.textContent = fullContent;
              scrollToBottom();

              // Finish thinking bubble when content starts arriving
              if (thinkingBubble) {
                thinkingBubble.finish();
                thinkingBubble = null;
              }
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

    // Finish thinking bubble if stream ended without content arriving
    if (thinkingBubble) {
      thinkingBubble.finish();
      thinkingBubble = null;
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

            // Send tool call to parent via MCP tools/call
            trackPendingToolCall(toolCall.id);
            mcpSend('tools/call', { name: toolName, arguments: args }, toolCall.id);
          } catch (error) {
            console.error('[widget.js] Error parsing tool arguments:', error);
          }
        }
      }

      // Display text content only if it shouldn't be hidden (i.e., not JSON)
      if (!shouldHideContent && fullContent && fullContent.trim()) {
        addMessage('assistant', fullContent);
      }
      // Skip notification - tool execution flow will notify when complete
    } else {
      // No tool calls, just text response
      let displayContent = fullContent;
      const trimmedContent = displayContent.trim();
      const trimmedThinking = fullThinking.trim();

      // Thinking-only response (no content, no tool calls) — retry with a cap
      if (!trimmedContent && trimmedThinking) {
        const MAX_THINKING_RETRIES = 3;
        assistantMsgEl?.remove();
        // Also remove the orphaned thinking bubble
        const lastThinking = messagesEl?.querySelector('.thinking-bubble:last-of-type');
        if (lastThinking) lastThinking.remove();

        if (_thinkingRetryCount < MAX_THINKING_RETRIES) {
          console.log(`[widget.js] Thinking-only response, retrying (${_thinkingRetryCount + 1}/${MAX_THINKING_RETRIES})`);
          // Flag retry — handled after finally to avoid state.sending race
          _needsThinkingRetry = true;
        } else {
          // Exhausted retries — show user-friendly message
          console.warn('[widget.js] Thinking-only responses exhausted retries');
          addMessage('assistant', 'The model is not responding right now. Please try again or refresh the page.');
          lastAssistantMessage = '';
        }
      } else if (!trimmedContent) {
        assistantMsgEl.textContent = '(no response)';
        lastAssistantMessage = '';
      } else {
        lastAssistantMessage = displayContent;
      }

      if (!_needsThinkingRetry) {
        // Only push to history if we have actual content
        if (trimmedContent) {
          const assistantMessage = {
            role: 'assistant',
            content: displayContent,
            ...(trimmedThinking ? { thinking: fullThinking } : {}),
          };
          state.messages.push(assistantMessage);
        }

        // Notify parent of assistant response (signal only — no message content)
        postToParent({
          source: 'ozwell-chat-widget',
          type: 'assistant_response',
          hadToolCalls: false
        });

        // Send any queued message now that LLM is done (no tool calls pending)
        if (state.queuedMessage) {
          // Use setTimeout to let the UI update first
          setTimeout(() => sendQueuedMessage(), 100);
        }
      }
    }

    setStatus('', false);
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
  }

  // Retry after finally so state.sending is properly cleaned up first
  if (_needsThinkingRetry) {
    return sendMessageStreaming('', tools, _thinkingRetryCount + 1);
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
    const headers = getRequestHeaders();

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
    addMessage('assistant', assistantContent || '(no response)');

    // Notify parent of assistant response (signal only — no message content)
    postToParent({
      source: 'ozwell-chat-widget',
      type: 'assistant_response',
      hadToolCalls: false
    });

    setStatus('', false);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    addMessage('system', `Error: ${message}`);
    setStatus('Error', false);
  } finally {
    state.sending = false;
    formEl?.classList.remove('is-sending');
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
  // Only accept messages from the parent frame
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // Handle MCP JSON-RPC tool results from parent
  if (data.jsonrpc === '2.0' && data.id != null && mcpPendingToolCalls[data.id]) {
    delete mcpPendingToolCalls[data.id];
    console.log('[widget.js] Received MCP tool result from parent:', data.result);

    const result = data.error ? { error: data.error.message } : data.result;
    const toolCallId = data.id;

    // Update tool execution result in debug mode
    if (toolCallId) {
      updateToolExecutionResult(toolCallId, result);
    }

    // Check if this is an update tool (has success/message) or a get tool (raw data)
    if (result.success && result.message) {
      // Update tool - just display the message (no LLM continuation needed)
      addMessage('assistant', result.message);

      // Notify parent of assistant response (signal only — no message content)
      postToParent({
        source: 'ozwell-chat-widget',
        type: 'assistant_response',
        hadToolCalls: false
      });

      // After displaying the tool result message, send any queued user message (if present)
      if (state.queuedMessage) {
        sendQueuedMessage();
      }
    } else {
      // No display message — send tool result back to LLM for continuation
      console.log('[widget.js] Sending tool result to LLM');

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

  // Handle send-message from parent (JSON-RPC or legacy)
  if (data.jsonrpc === '2.0' && data.method === 'send-message' && data.params?.content) {
    console.log('[widget.js] Received send-message from parent:', data.params.content);
    sendMessage(data.params.content);
    return;
  }
  if (data.source === 'ozwell-chat-parent' && data.type === 'ozwell:send-message' && data.payload?.content) {
    console.log('[widget.js] Received ozwell:send-message from parent:', data.payload.content);
    sendMessage(data.payload.content);
    return;
  }

  // Handle legacy messages from embed system
  if (data.source !== 'ozwell-chat-parent') return;

  if (data.type === 'config' && data.payload?.config) {
    // Pin the parent origin from the first validated config message
    if (!state.parentOrigin && event.origin) {
      state.parentOrigin = event.origin;
      console.log('[widget.js] Pinned parent origin:', state.parentOrigin);
    }
    applyConfig(data.payload.config);
  }

  if (data.type === 'close') {
    postToParent({
      source: 'ozwell-chat-widget',
      type: 'closed',
    });
  }
}

function notifyReady() {
  postToParent({
    source: 'ozwell-chat-widget',
    type: 'ready',
  });
}

window.addEventListener('message', handleParentMessage);
formEl?.addEventListener('submit', handleSubmit);

// Don't show initial system message - keep it clean
setStatus('', false);

// Notify parent that widget is ready
notifyReady();

// ── MCP handshake (postMessage transport) ──────────────────────────
// Send initialize → tools/list to parent. Tools are discovered at
// runtime via the MCP protocol instead of being passed in config.

function mcpSend(method, params, explicitId) {
  const id = explicitId !== undefined ? explicitId : ++mcpRequestId;
  window.parent.postMessage({
    jsonrpc: '2.0',
    id: id,
    method: method,
    params: params || {},
  }, state.parentOrigin || '*');
  return id;
}

/** Send an MCP notification (no id field per JSON-RPC 2.0 spec) */
function mcpNotify(method, params) {
  window.parent.postMessage({
    jsonrpc: '2.0',
    method: method,
    params: params || {},
  }, state.parentOrigin || '*');
}

// Perform MCP initialize handshake and discover tools
(function mcpInit() {
  const initReqId = mcpSend('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'ozwell-chat-widget', version: '1.0.0' },
  });

  // Listen for initialize response, then send tools/list
  function onInitResponse(event) {
    const data = event.data;
    if (!data || data.jsonrpc !== '2.0' || data.id !== initReqId) return;

    console.log('[widget.js] MCP initialized:', data.result);
    mcpNotify('notifications/initialized');

    // Request tool list from parent
    const toolsReqId = mcpSend('tools/list');

    function onToolsResponse(event2) {
      const d = event2.data;
      if (!d || d.jsonrpc !== '2.0' || d.id !== toolsReqId) return;

      window.removeEventListener('message', onToolsResponse);
      const mcpTools = (d.result && d.result.tools) || [];
      console.log('[widget.js] MCP tools discovered:', mcpTools);

      // Convert MCP tools to OpenAI format for the chat API
      state.config.tools = mcpTools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.inputSchema || { type: 'object', properties: {} },
        },
      }));
    }
    window.addEventListener('message', onToolsResponse);
    window.removeEventListener('message', onInitResponse);
  }
  window.addEventListener('message', onInitResponse);
})();
