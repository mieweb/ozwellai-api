/**
 * ============================================
 * OZWELL CHAT WIDGET LOADER
 * ============================================
 *
 * Main API for embedding the Ozwell chat widget.
 *
 * Communication with widget iframe uses postMessage only:
 * - Lifecycle: ready, closed (signals only, no private data)
 * - MCP tools: tool_call, tool_result (by design)
 * - Config: config, request-config
 * - Notifications: assistant_response (signal only, no message text)
 *
 * Usage:
 *   1. Configure: window.OzwellChatConfig = { endpoint: '/v1/chat/completions', tools: [...] }
 *   2. Mount: OzwellChat.mount()
 */
(function () {
  // Inject viewport meta tag if not present (required for mobile-native behavior)
  function ensureViewportMeta() {
    if (!document.querySelector('meta[name="viewport"]')) {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
      document.head.appendChild(meta);
      console.log('[OzwellChat] Viewport meta tag injected for mobile support');
    }
  }

  // Auto-detect base URL from script location
  let autoDetectedBase = '';
  try {
    if (document.currentScript && document.currentScript.src) {
      const scriptUrl = new URL(document.currentScript.src);
      autoDetectedBase = `${scriptUrl.protocol}//${scriptUrl.host}`;
      console.log('[OzwellChat] Auto-detected base URL:', autoDetectedBase);
    }
  } catch (e) {
    console.warn('[OzwellChat] Auto-detection failed, using relative paths:', e);
  }

  // Ensure viewport is set for mobile-native behavior
  ensureViewportMeta();

  const DEFAULT_DIMENSIONS = { width: 360, height: 420 };
  const DEFAULT_CONFIG = {
    title: 'Ozwell Assistant',
    placeholder: 'Ask a question...',
    defaultUI: true, // Enable floating button/wrapper by default
    // model is optional - server chooses default if not specified by client
    endpoint: autoDetectedBase ? `${autoDetectedBase}/v1/chat/completions` : '/v1/chat/completions',
    widgetUrl: autoDetectedBase ? `${autoDetectedBase}/embed/ozwell.html` : '/embed/ozwell.html',
    thinkingEnabled: false, // Display reasoning/thinking tokens from models
    thinkingDefaultMode: 2, // 0=None, 1=Peek, 2=Smart (expand-then-collapse), 3=Expanded
  };

  const state = {
    iframe: null,
    ready: false,
    pendingMessages: [],
    runtimeConfig: {},
    hasUnread: false, // Track unread messages when chat is closed
    chatOpen: false, // Track if chat window is currently open
    agentTools: null, // Tools fetched from server via agent key (MCP discovery)
  };

  function readGlobalConfig() {
    const { OzwellChatConfig } = window;
    if (OzwellChatConfig && typeof OzwellChatConfig === 'object') {
      return OzwellChatConfig;
    }
    return {};
  }

  function currentConfig() {
    return {
      ...DEFAULT_CONFIG,
      ...readGlobalConfig(),
      ...state.runtimeConfig,
    };
  }

  function ensureIframe(options = {}) {
    if (state.iframe) return state.iframe;

    const config = currentConfig();
    const containerId = options.containerId || config.containerId;
    const container =
      (containerId && document.getElementById(containerId)) ||
      document.body;

    const iframe = document.createElement('iframe');
    const widgetSrc = options.src || config.widgetUrl || config.src || '/embed/ozwell.html';

    // Extract base URL for loading ozwell.js (remove /ozwell.html from path)
    const widgetBaseUrl = widgetSrc.replace(/\/[^/]*$/, '');

    // Use srcdoc instead of src to inline HTML (eliminates ozwell.html file)
    iframe.srcdoc = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ozwell Chat Widget</title>
  </head>
  <body>
    <script type="module" src="${widgetBaseUrl}/ozwell.js"></script>
  </body>
</html>`;

    iframe.width = String(options.width || DEFAULT_DIMENSIONS.width);
    iframe.height = String(options.height || DEFAULT_DIMENSIONS.height);
    iframe.style.border = '0';
    iframe.style.borderRadius = '12px';
    iframe.style.boxShadow = '0 20px 50px rgba(15, 23, 42, 0.12)';
    iframe.style.maxWidth = 'calc(100vw - 40px)';
    iframe.style.maxHeight = 'calc(100vh - 80px)';
    iframe.setAttribute('title', config.title || 'Ozwell Chat');
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');

    container.appendChild(iframe);
    state.iframe = iframe;
    return iframe;
  }

  function postToWidget(message) {
    const iframeWindow = state.iframe && state.iframe.contentWindow;
    if (!iframeWindow) {
      state.pendingMessages.push(message);
      return;
    }

    iframeWindow.postMessage({
      source: 'ozwell-chat-parent',
      ...message,
    }, '*');
  }

  function flushPending() {
    if (!state.ready || !state.iframe || !state.iframe.contentWindow) return;
    const queue = state.pendingMessages.splice(0);
    queue.forEach((message) => {
      state.iframe.contentWindow.postMessage({
        source: 'ozwell-chat-parent',
        ...message,
      }, '*');
    });
  }

  function sendConfig() {
    postToWidget({
      type: 'config',
      payload: {
        config: currentConfig(),
      },
    });
  }

  // ── MCP JSON-RPC handler (postMessage transport) ──────────────────
  // Implements the MCP protocol over postMessage for iframe ↔ parent
  // communication. Handles initialize, tools/list, and tools/call.

  function postJsonRpc(message) {
    const iframeWindow = state.iframe && state.iframe.contentWindow;
    if (!iframeWindow) return;
    iframeWindow.postMessage(message, '*');
  }

  const EMPTY_SCHEMA = { type: 'object', properties: {} };

  function normalizeTool(tool) {
    if (typeof tool === 'string') {
      return { name: tool, description: '', inputSchema: EMPTY_SCHEMA };
    }
    if (tool.function) {
      return {
        name: tool.function.name,
        description: tool.function.description || '',
        inputSchema: tool.function.parameters || EMPTY_SCHEMA,
      };
    }
    return {
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || tool.parameters || EMPTY_SCHEMA,
    };
  }

  function getMcpTools() {
    const tools = (state.agentTools && state.agentTools.length > 0)
      ? state.agentTools
      : (currentConfig().tools || []);
    return tools.map(normalizeTool);
  }

  function handleMcpMessage(event) {
    if (!state.iframe || event.source !== state.iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.jsonrpc !== '2.0' || !data.method) return;

    switch (data.method) {
      case 'initialize':
        postJsonRpc({
          jsonrpc: '2.0',
          id: data.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'ozwell-parent', version: '1.0.0' },
          },
        });
        break;

      case 'notifications/initialized':
        // Client acknowledged — no response needed for notifications
        break;

      case 'tools/list':
        postJsonRpc({
          jsonrpc: '2.0',
          id: data.id,
          result: { tools: getMcpTools() },
        });
        break;

      case 'tools/call': {
        const toolName = data.params?.name;
        const toolArgs = data.params?.arguments || {};
        const requestId = data.id;

        // Dispatch as DOM event — integrator listens for this
        const toolEvent = new CustomEvent('ozwell-tool-call', {
          detail: {
            name: toolName,
            arguments: toolArgs,
            respond: (result) => {
              postJsonRpc({
                jsonrpc: '2.0',
                id: requestId,
                result: result,
              });
            },
            error: (message) => {
              postJsonRpc({
                jsonrpc: '2.0',
                id: requestId,
                error: { code: -32000, message: message },
              });
            },
          },
        });
        document.dispatchEvent(toolEvent);
        break;
      }

      default:
        break;
    }
  }

  // ── Legacy widget message handler ────────────────────────────────

  function handleWidgetMessage(event) {
    if (!state.iframe || event.source !== state.iframe.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Route JSON-RPC messages to MCP handler
    if (data.jsonrpc === '2.0') {
      handleMcpMessage(event);
      return;
    }

    // Legacy messages require source check
    if (data.source !== 'ozwell-chat-widget') return;

    switch (data.type) {
      case 'ready':
        state.ready = true;
        flushPending();
        sendConfig();
        document.dispatchEvent(new CustomEvent('ozwell-chat-ready'));
        break;
      case 'request-config':
        sendConfig();
        break;
      case 'closed':
        document.dispatchEvent(new CustomEvent('ozwell-chat-closed'));
        break;
      case 'assistant_response':
        // AI responded with text (not a tool call) - handle notification
        handleAssistantResponse(data);
        break;
      default:
        break;
    }
  }

  /**
   * Handle assistant response notification.
   * Shows wiggle animation and badge when chat is closed, or auto-opens if configured.
   *
   * @param {Object} data - Message data with { hadToolCalls }
   */
  function handleAssistantResponse(data) {
    // Skip notifications for tool calls - only notify on actual text responses
    if (data.hadToolCalls) {
      console.log('[OzwellChat] Skipping notification for tool call response');
      return;
    }

    // If chat is already open, no notification needed
    if (state.chatOpen) {
      console.log('[OzwellChat] Chat is open, no notification needed');
      return;
    }

    const config = currentConfig();
    const button = document.getElementById('ozwell-chat-button');
    const wrapper = document.getElementById('ozwell-chat-wrapper');

    if (!button || !wrapper) {
      console.log('[OzwellChat] Default UI not found, cannot show notification');
      return;
    }

    // Check autoOpenOnReply config
    if (config.autoOpenOnReply === true) {
      // Auto-open the chat window
      console.log('[OzwellChat] Auto-opening chat on AI reply');
      openChat();
    } else {
      // Wiggle and show badge
      console.log('[OzwellChat] Showing unread notification');
      showUnreadNotification();
    }

    // Dispatch custom event for external listeners (signal only, no message content).
    // Disabled by default to honor privacy guidance; integrators
    // must explicitly opt in via config.exposeUnreadEvent === true.
    if (config.exposeUnreadEvent === true) {
      document.dispatchEvent(new CustomEvent('ozwell-chat-unread'));
    }
  }

  /**
   * Show unread notification (wiggle + badge).
   */
  function showUnreadNotification() {
    const button = document.getElementById('ozwell-chat-button');
    if (!button) return;

    state.hasUnread = true;

    // Add/ensure badge exists
    let badge = button.querySelector('.ozwell-unread-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ozwell-unread-badge';
      button.appendChild(badge);
    }

    // Trigger wiggle animation
    button.classList.remove('wiggling');
    // Force reflow to restart animation
    void button.offsetWidth;
    button.classList.add('wiggling');
    button.classList.add('has-unread');

    // Remove wiggling class after animation completes (but keep has-unread for badge)
    setTimeout(() => {
      button.classList.remove('wiggling');
    }, 800);

    console.log('[OzwellChat] Unread notification shown');
  }

  /**
   * Clear unread notification state.
   */
  function clearUnreadNotification() {
    const button = document.getElementById('ozwell-chat-button');
    if (!button) return;

    state.hasUnread = false;
    button.classList.remove('has-unread');
    button.classList.remove('wiggling');

    // Remove badge
    const badge = button.querySelector('.ozwell-unread-badge');
    if (badge) {
      badge.remove();
    }

    console.log('[OzwellChat] Unread notification cleared');
  }

  /**
   * Open the chat window programmatically.
   */
  function openChat() {
    const button = document.getElementById('ozwell-chat-button');
    const wrapper = document.getElementById('ozwell-chat-wrapper');

    if (!button || !wrapper) return;

    wrapper.classList.remove('hidden');
    wrapper.classList.add('visible');
    button.classList.add('hidden');
    state.chatOpen = true;

    // Clear any unread notifications when chat opens
    clearUnreadNotification();

    console.log('[OzwellChat] Chat opened');
  }

  /**
   * Close/hide the chat window programmatically.
   */
  function closeChat() {
    const button = document.getElementById('ozwell-chat-button');
    const wrapper = document.getElementById('ozwell-chat-wrapper');

    if (!button || !wrapper) return;

    wrapper.classList.remove('visible');
    wrapper.classList.add('hidden');
    button.classList.remove('hidden');
    state.chatOpen = false;

    console.log('[OzwellChat] Chat closed');
  }

  /**
   * Inject CSS styles for the default floating button and wrapper.
   * Only injects if defaultUI is enabled.
   */
  function injectDefaultCSS() {
    const config = currentConfig();
    if (config.defaultUI === false) return;

    // Check if styles already injected
    if (document.getElementById('ozwell-default-ui-styles')) return;

    const style = document.createElement('style');
    style.id = 'ozwell-default-ui-styles';
    style.textContent = `
      /* Floating chat button */
      .ozwell-chat-button {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: #0066ff;
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0, 102, 255, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        z-index: 9998;
        transition: transform 0.2s, box-shadow 0.2s;
        /* Needed for badge positioning */
        overflow: visible;
      }

      .ozwell-chat-button:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 20px rgba(0, 102, 255, 0.4);
      }

      .ozwell-chat-button.hidden {
        display: none;
      }

      /* Wiggle animation for unread notifications */
      @keyframes ozwell-wiggle {
        0%, 100% { transform: rotate(0deg); }
        10% { transform: rotate(-12deg); }
        20% { transform: rotate(12deg); }
        30% { transform: rotate(-10deg); }
        40% { transform: rotate(10deg); }
        50% { transform: rotate(-6deg); }
        60% { transform: rotate(6deg); }
        70% { transform: rotate(-3deg); }
        80% { transform: rotate(3deg); }
        90% { transform: rotate(0deg); }
      }

      .ozwell-chat-button.wiggling {
        animation: ozwell-wiggle 0.8s ease-in-out;
      }

      /* Unread badge indicator */
      .ozwell-unread-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 16px;
        height: 16px;
        background: #ef4444;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .ozwell-chat-icon {
        width: 32px;
        height: 32px;
        object-fit: contain;
      }

      /* Chat wrapper window */
      .ozwell-chat-wrapper {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 380px;
        height: 520px;
        max-height: calc(100vh - 48px);
        background: #ffffff;
        border-radius: 16px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        z-index: 9999;
        transition: opacity 0.3s, transform 0.3s;
        overflow: hidden;
      }

      .ozwell-chat-wrapper.hidden {
        opacity: 0;
        transform: scale(0.9) translateY(20px);
        pointer-events: none;
      }

      .ozwell-chat-wrapper.visible {
        opacity: 1;
        transform: scale(1) translateY(0);
      }

      /* Chat header */
      .ozwell-chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        background: #0066ff;
        color: white;
        user-select: none;
      }

      .ozwell-chat-title {
        font-weight: 600;
        font-size: 16px;
        font-size: 16px;
      }

      .ozwell-chat-controls {
        display: flex;
        gap: 8px;
      }

      .ozwell-hide-btn {
        background: none;
        border: none;
        color: white;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        padding: 6px 12px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background 0.2s;
      }

      .ozwell-hide-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      /* Content area for iframe */
      .ozwell-chat-content {
        flex: 1;
        overflow: hidden;
      }

      .ozwell-chat-content iframe {
        width: 100%;
        height: 100%;
        border: none;
      }

      /* Mobile-native styles */
      @media (max-width: 767px) {
        .ozwell-chat-content iframe {
          border-radius: 0 !important;
          box-shadow: none !important;
          max-width: 100% !important;
          max-height: 100% !important;
        }
        .ozwell-chat-button {
          bottom: calc(20px + env(safe-area-inset-bottom));
          right: 20px;
          width: 56px;
          height: 56px;
          font-size: 24px;
        }

        .ozwell-chat-wrapper {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          height: 100%;
          border-radius: 0;
          border: none;
          box-shadow: none;
        }

        .ozwell-chat-wrapper.hidden {
          opacity: 0;
          transform: translateY(100%);
        }

        .ozwell-chat-wrapper.visible {
          opacity: 1;
          transform: translateY(0);
        }

        .ozwell-chat-header {
          padding-top: calc(16px + env(safe-area-inset-top));
          padding-bottom: 16px;
          padding-left: 16px;
          padding-right: 16px;
        }

        .ozwell-chat-content {
          padding-bottom: env(safe-area-inset-bottom);
        }
      }
    `;
    document.head.appendChild(style);
    console.log('[OzwellChat] Default UI styles injected');
  }

  /**
   * Create the default floating button and wrapper UI.
   * Returns null if defaultUI is disabled or if containerId is explicitly set (backward compatibility).
   *
   * @returns {Object|null} UI elements {button, wrapper, container} or null if disabled
   */
  function createDefaultUI() {
    const config = currentConfig();

    // Backward compatibility: If user specified containerId, assume they want custom UI
    if (config.containerId) {
      console.log('[OzwellChat] containerId specified, skipping default UI');
      return null;
    }

    // Check if user explicitly disabled default UI
    if (config.defaultUI === false) {
      console.log('[OzwellChat] defaultUI disabled, skipping default UI creation');
      return null;
    }

    // Check if UI already exists
    if (document.getElementById('ozwell-chat-button')) {
      console.log('[OzwellChat] Default UI already exists');
      return {
        button: document.getElementById('ozwell-chat-button'),
        wrapper: document.getElementById('ozwell-chat-wrapper'),
        container: document.getElementById('ozwell-chat-container')
      };
    }

    console.log('[OzwellChat] Creating default floating UI');

    // Create floating button
    const button = document.createElement('button');
    button.id = 'ozwell-chat-button';
    button.className = 'ozwell-chat-button';
    button.innerHTML = '<img src="/favicon.ico" alt="Chat" class="ozwell-chat-icon" />';
    button.setAttribute('aria-label', 'Open chat');
    button.setAttribute('type', 'button');

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.id = 'ozwell-chat-wrapper';
    wrapper.className = 'ozwell-chat-wrapper hidden';

    // Create header
    const header = document.createElement('div');
    header.className = 'ozwell-chat-header';
    const titleEl = document.createElement('div');
    titleEl.className = 'ozwell-chat-title';
    titleEl.textContent = config.title || 'Ozwell Assistant';
    const controlsEl = document.createElement('div');
    controlsEl.className = 'ozwell-chat-controls';
    const hideBtn = document.createElement('button');
    hideBtn.className = 'ozwell-hide-btn';
    hideBtn.setAttribute('aria-label', 'Hide chat');
    hideBtn.setAttribute('type', 'button');
    hideBtn.textContent = 'Hide';
    controlsEl.appendChild(hideBtn);
    header.appendChild(titleEl);
    header.appendChild(controlsEl);

    // Create content container for iframe
    const container = document.createElement('div');
    container.id = 'ozwell-chat-container';
    container.className = 'ozwell-chat-content';

    // Assemble wrapper
    wrapper.appendChild(header);
    wrapper.appendChild(container);

    // Add to page
    document.body.appendChild(button);
    document.body.appendChild(wrapper);

    console.log('[OzwellChat] Default UI elements created');

    return { button, wrapper, container };
  }

  /**
   * Attach event handlers to default UI elements.
   * Handles button clicks, close, and minimize actions.
   *
   * @param {Object} ui - UI elements {button, wrapper, container}
   */
  function attachDefaultUIHandlers(ui) {
    if (!ui) return;

    const { button, wrapper } = ui;

    // Open chat when button clicked - use openChat() to track state and clear notifications
    button.addEventListener('click', () => {
      openChat();
    });

    // Hide chat - use closeChat() to track state
    const hideBtn = wrapper.querySelector('.ozwell-hide-btn');
    if (hideBtn) {
      hideBtn.addEventListener('click', () => {
        closeChat();
      });
    }

    console.log('[OzwellChat] Default UI event handlers attached');
  }

  /**
   * Mount the Ozwell chat widget iframe.
   * Creates the iframe element.
   *
   * @param {Object} options - Mounting options
   * @param {string} [options.containerId] - DOM element ID to mount in (defaults to body)
   * @param {string} [options.src] - Custom widget URL (defaults to config.widgetUrl)
   * @param {number} [options.width] - Widget width in pixels
   * @param {number} [options.height] - Widget height in pixels
   * @returns {HTMLIFrameElement} The created iframe element
   */
  function mount(options = {}) {
    // Inject CSS for default UI (if enabled)
    injectDefaultCSS();

    // Create default floating button and wrapper (if enabled)
    const defaultUI = createDefaultUI();

    // If default UI was created, mount iframe inside it
    if (defaultUI) {
      options.containerId = 'ozwell-chat-container';
      attachDefaultUIHandlers(defaultUI);
    }

    // Create and mount iframe
    const iframe = ensureIframe(options);
    iframe.addEventListener('load', () => {
      // Widget notifies us when it is ready.
    });

    return iframe;
  }

  /**
   * Update runtime configuration.
   * If widget is already mounted and ready, sends updated config immediately.
   *
   * @param {Object} nextConfig - Configuration updates to apply
   */
  function configure(nextConfig = {}) {
    if (!nextConfig || typeof nextConfig !== 'object') return;
    state.runtimeConfig = {
      ...state.runtimeConfig,
      ...nextConfig,
    };

    if (state.ready) {
      sendConfig();
    }
  }

  window.addEventListener('message', handleWidgetMessage);

  const api = {
    mount,
    configure,
    open: openChat,
    close: closeChat,
    get iframe() {
      return state.iframe;
    },
    get isOpen() {
      return state.chatOpen;
    },
    get hasUnread() {
      return state.hasUnread;
    },
    ready() {
      if (state.ready) return Promise.resolve();
      return new Promise((resolve) => {
        const listener = () => {
          document.removeEventListener('ozwell-chat-ready', listener);
          resolve();
        };
        document.addEventListener('ozwell-chat-ready', listener);
      });
    },
  };

  // Export API
  window.OzwellChat = api;

  // Fetch agent tools from server when an agent key is configured.
  // This populates state.agentTools so getMcpTools() can respond to
  // the widget's tools/list MCP request with the correct tool names.
  async function fetchAgentTools() {
    const config = currentConfig();
    const apiKey = config.apiKey;
    if (!apiKey || !apiKey.startsWith('agnt_key-')) return;

    try {
      const base = autoDetectedBase || '';
      const resp = await fetch(`${base}/v1/agents/me`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (Array.isArray(data.tools)) {
        state.agentTools = data.tools;
        console.log('[OzwellChat] Agent tools discovered from server:', state.agentTools);
      }
    } catch (e) {
      // Silent fail — tools will fall back to config.tools if any
    }
  }

  // Auto-mount widget unless explicitly disabled
  const config = readGlobalConfig();
  if (config.autoMount !== false) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', async () => {
        await fetchAgentTools();
        api.mount();
      });
    } else {
      // DOM already loaded, fetch tools then mount
      fetchAgentTools().then(() => api.mount());
    }
  }
})();
