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
    widgetUrl: autoDetectedBase ? `${autoDetectedBase}/widget/frame/` : '/widget/frame/',
    thinkingEnabled: false, // Display reasoning/thinking tokens from models
    thinkingDefaultMode: 2, // 0=None, 1=Peek, 2=Smart (expand-then-collapse), 3=Expanded
  };

  const state = {
    iframe: null,
    frameOrigin: null, // Expected origin of the widget iframe, for message validation
    ready: false,
    pendingMessages: [],
    runtimeConfig: {},
    hasUnread: false, // Track unread messages when chat is closed
    chatOpen: false, // Track if chat window is currently open
    agentTools: null, // Tools fetched from server via agent key (MCP discovery)
  };
  let agentDiscoveryPromise;

  const EMPTY_SCHEMA = { type: 'object', properties: {} };
  const PAGE_TOOL_PREFIX = 'postMessage_';
  const TOOL_RESPONSE_TIMEOUT_MS = 29000;

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

  const warnedToolConfigNames = new Set();

  function warnCallableToolFunction(toolName) {
    const key = toolName || '<unnamed>';
    if (warnedToolConfigNames.has(key)) return;
    warnedToolConfigNames.add(key);
    console.warn(
      `[OzwellChat] Ignoring callable JavaScript function in tools[].function for "${key}". ` +
      'OpenAI-style tools[].function must be a schema object. Execute browser tools with the ozwell-tool-call event instead.'
    );
  }

  function normalizeTool(tool) {
    if (typeof tool === 'string') {
      return { name: tool, description: '', inputSchema: EMPTY_SCHEMA };
    }
    if (!tool || typeof tool !== 'object') return null;
    if (typeof tool.function === 'function') {
      warnCallableToolFunction(tool.name || tool.function.name);
      return tool.name ? {
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || tool.parameters || EMPTY_SCHEMA,
      } : null;
    }
    if (tool.function && typeof tool.function === 'object') {
      return {
        name: tool.function.name,
        description: tool.function.description || '',
        inputSchema: tool.function.parameters || EMPTY_SCHEMA,
      };
    }
    return tool.name ? {
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || tool.parameters || EMPTY_SCHEMA,
    } : null;
  }

  function toolSchemaForWidget(tool) {
    const normalized = normalizeTool(tool);
    if (!normalized) return null;
    return {
      type: 'function',
      function: {
        name: normalized.name,
        description: normalized.description,
        parameters: normalized.inputSchema,
      },
    };
  }

  function sanitizeConfigForWidget(config) {
    const sanitized = { ...config };
    if (Array.isArray(config.tools)) {
      sanitized.tools = config.tools
        .map(toolSchemaForWidget)
        .filter(Boolean);
    }
    return sanitized;
  }

  function ensureIframe(options = {}) {
    if (state.iframe) return state.iframe;

    const config = currentConfig();
    const containerId = options.containerId || config.containerId;
    const container =
      (containerId && document.getElementById(containerId)) ||
      document.body;

    const iframe = document.createElement('iframe');
    const widgetSrc = options.src || config.widgetUrl || config.src || '/widget/frame/';
    const frameUrl = new URL(widgetSrc, document.baseURI);
    frameUrl.searchParams.set('ozwellLoader', '1');
    iframe.src = frameUrl.href;
    state.frameOrigin = frameUrl.origin;

    iframe.width = String(options.width || DEFAULT_DIMENSIONS.width);
    iframe.height = String(options.height || DEFAULT_DIMENSIONS.height);
    iframe.style.border = '0';
    iframe.style.borderRadius = '12px';
    iframe.style.boxShadow = '0 20px 50px rgba(15, 23, 42, 0.12)';
    iframe.style.maxWidth = 'calc(100vw - 40px)';
    iframe.style.maxHeight = 'calc(100vh - 80px)';
    iframe.setAttribute('title', config.title || 'Ozwell Chat');
    // allow-popups is required for OIDC sign-in: providers refuse to render
    // their consent screen in an iframe, so it opens in its own window.
    // allow-popups-to-escape-sandbox keeps that window out of this sandbox.
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');

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
        config: sanitizeConfigForWidget(currentConfig()),
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

  /** Add postMessage_ prefix to a page tool so it can't collide with server-side tools. */
  function prefixPageTool(tool) {
    return { ...tool, name: PAGE_TOOL_PREFIX + tool.name };
  }

  function getMcpTools() {
    const agentTools = (state.agentTools && state.agentTools.length > 0)
      ? state.agentTools.map(normalizeTool).filter(Boolean)
      : [];
    // Page tools are prefixed so they occupy a separate namespace from
    // server-implemented tools. The prefix is transparent to page authors —
    // it is stripped before dispatching ozwell-tool-call events.
    const pageTools = (currentConfig().tools || [])
      .map(normalizeTool)
      .filter(Boolean)
      .map(prefixPageTool);

    // Merge: agent-defined tools first, then page tools that don't collide.
    // If the agent defines no tools, all page tools are available.
    if (agentTools.length === 0) return pageTools;

    const agentNames = new Set(agentTools.map(t => t.name));
    const extra = pageTools.filter(t => !agentNames.has(t.name));
    return agentTools.concat(extra);
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
        discoverAgentContext().finally(() => postJsonRpc({
          jsonrpc: '2.0',
          id: data.id,
          result: { tools: getMcpTools() },
        }));
        break;

      case 'tools/call': {
        const rawToolName = data.params?.name;
        const toolArgs = data.params?.arguments || {};
        const requestId = data.id;
        let settled = false;

        function finishToolCall(message) {
          if (settled) return;
          settled = true;
          postJsonRpc(message);
        }

        // Strip postMessage_ prefix so page handlers see the original name
        const toolName = rawToolName && rawToolName.startsWith(PAGE_TOOL_PREFIX)
          ? rawToolName.slice(PAGE_TOOL_PREFIX.length)
          : rawToolName;

        // Dispatch as DOM event — integrator listens for this
        const toolEvent = new CustomEvent('ozwell-tool-call', {
          detail: {
            name: toolName,
            arguments: toolArgs,
            respond: (result) => {
              finishToolCall({
                jsonrpc: '2.0',
                id: requestId,
                result: result,
              });
            },
            error: (message) => {
              finishToolCall({
                jsonrpc: '2.0',
                id: requestId,
                error: { code: -32000, message: message },
              });
            },
          },
        });
        document.dispatchEvent(toolEvent);
        setTimeout(() => {
          if (!settled) {
            finishToolCall({
              jsonrpc: '2.0',
              id: requestId,
              error: {
                code: -32000,
                message: `Tool "${toolName}" did not respond. Add an ozwell-tool-call handler and call respond() or error().`,
              },
            });
          }
        }, TOOL_RESPONSE_TIMEOUT_MS);
        break;
      }

      default:
        break;
    }
  }

  // ── Legacy widget message handler ────────────────────────────────

  function handleWidgetMessage(event) {
    if (!state.iframe || event.source !== state.iframe.contentWindow) return;
    // A document that navigated the iframe to another origin keeps the same
    // WindowProxy; reject it so it cannot forge tool calls or widget events.
    if (state.frameOrigin && event.origin !== state.frameOrigin) return;
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
        discoverAgentContext().finally(() => {
          sendConfig();
          document.dispatchEvent(new CustomEvent('ozwell-chat-ready'));
        });
        break;
      case 'request-config':
        discoverAgentContext().finally(sendConfig);
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

    // A moved launcher opens the window from its nearest corner instead of the default spot.
    if (button.style.left && !isMobileViewport() && !button.classList.contains('hidden')) {
      const b = getRect(button);
      const onRight = (b.left + b.right) / 2 > window.innerWidth / 2;
      const onBottom = (b.top + b.bottom) / 2 > window.innerHeight / 2;
      const right = onRight ? window.innerWidth - b.right : window.innerWidth - b.left - wrapper.offsetWidth;
      const bottom = onBottom ? window.innerHeight - b.bottom : window.innerHeight - b.top - wrapper.offsetHeight;
      setWindowOffsets(wrapper, right, bottom);
    }

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
    // Viewport may have changed while the launcher was hidden.
    if (button.style.left) applySavedButtonPosition(button);
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
        background: var(--mieweb-primary-800, #0f749c);
        color: #fff;
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(15, 116, 156, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        z-index: 9998;
        transition: transform 0.2s, box-shadow 0.2s;
        /* Needed for badge positioning */
        overflow: visible;
        touch-action: none;
        user-select: none;
      }

      .ozwell-chat-button.dragging {
        cursor: grabbing;
        transition: none;
        transform: none;
      }

      .ozwell-chat-button:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 20px rgba(15, 116, 156, 0.4);
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

      /* Custom image icons fill the circle on a white plate */
      .ozwell-chat-button.ozwell-chat-button--image {
        padding: 0;
        background: #fff;
      }

      .ozwell-chat-button--image .ozwell-chat-icon {
        width: 100%;
        height: 100%;
        border-radius: 50%;
      }

      /* Chat wrapper window */
      .ozwell-chat-wrapper {
        position: fixed;
        bottom: 24px;
        right: 24px;
        box-sizing: border-box;
        width: 380px;
        height: 520px;
        max-width: calc(100vw - 40px);
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

      /* Top-left corner resize handle; invisible like the other edges, but keyboard-focusable */
      .ozwell-resize-handle {
        position: absolute;
        top: 0;
        left: 0;
        width: var(--ozwell-corner);
        height: var(--ozwell-corner);
        cursor: nwse-resize;
        z-index: 3;
        touch-action: none;
        border-top-left-radius: 16px;
      }

      .ozwell-resize-handle:focus-visible {
        outline: 2px solid #ffffff;
        outline-offset: -2px;
      }

      /* Invisible edge/corner resize strips */
      .ozwell-chat-wrapper {
        --ozwell-edge: 6px;
        --ozwell-corner: 12px;
      }
      .ozwell-edge-handle {
        position: absolute;
        z-index: 3;
        touch-action: none;
      }
      .ozwell-edge-handle[data-dir="n"] { top: 0; left: var(--ozwell-corner); right: var(--ozwell-corner); height: var(--ozwell-edge); cursor: ns-resize; }
      .ozwell-edge-handle[data-dir="s"] { bottom: 0; left: var(--ozwell-corner); right: var(--ozwell-corner); height: var(--ozwell-edge); cursor: ns-resize; }
      .ozwell-edge-handle[data-dir="e"] { right: 0; top: var(--ozwell-corner); bottom: var(--ozwell-corner); width: var(--ozwell-edge); cursor: ew-resize; }
      .ozwell-edge-handle[data-dir="w"] { left: 0; top: var(--ozwell-corner); bottom: var(--ozwell-corner); width: var(--ozwell-edge); cursor: ew-resize; }
      .ozwell-edge-handle[data-dir="ne"] { top: 0; right: 0; width: var(--ozwell-corner); height: var(--ozwell-corner); cursor: nesw-resize; }
      .ozwell-edge-handle[data-dir="sw"] { bottom: 0; left: 0; width: var(--ozwell-corner); height: var(--ozwell-corner); cursor: nesw-resize; }
      .ozwell-edge-handle[data-dir="se"] { bottom: 0; right: 0; width: var(--ozwell-corner); height: var(--ozwell-corner); cursor: nwse-resize; }

      .ozwell-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }

      /* Chat header */
      .ozwell-chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        background: var(--mieweb-primary-800, #0f749c);
        color: white;
        user-select: none;
        cursor: move;
        touch-action: none;
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
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100% !important;
          height: 100% !important;
          max-width: none !important;
          max-height: none !important;
          border-radius: 0;
          border: none;
          box-shadow: none;
        }

        .ozwell-resize-handle,
        .ozwell-edge-handle {
          display: none;
        }

        .ozwell-chat-header {
          cursor: default;
          touch-action: auto;
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

  const SIZE_STORAGE_KEY = 'ozwell.widget.size';
  const WINDOW_POS_STORAGE_KEY = 'ozwell.widget.position';
  const BUTTON_POS_STORAGE_KEY = 'ozwell.launcher.position';
  const MIN_WIDTH = 320;
  const MIN_HEIGHT = 360;
  const MOBILE_MAX_WIDTH = 767; // keep in sync with the @media query in injectDefaultCSS
  const EDGE_MARGIN = 8;
  const DRAG_THRESHOLD = 5;
  const RESIZE_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const isMobileViewport = () => window.innerWidth <= MOBILE_MAX_WIDTH;
  const clampRange = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
  const keyStep = (event) => (event.shiftKey ? 48 : 16);

  // offsetLeft/Top ignore CSS transforms (hover scale, open/close animation), unlike getBoundingClientRect.
  function getRect(el) {
    const left = el.offsetLeft, top = el.offsetTop;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
  }

  // Largest window that fits beside the default 24px right/bottom offset plus margin.
  function maxWindowSize() {
    return {
      width: Math.max(MIN_WIDTH, window.innerWidth - 40),
      height: Math.max(MIN_HEIGHT, window.innerHeight - 48),
    };
  }

  function clampSize(width, height) {
    const max = maxWindowSize();
    return {
      width: clampRange(width, MIN_WIDTH, max.width),
      height: clampRange(height, MIN_HEIGHT, max.height),
    };
  }

  function applySavedSize(wrapper) {
    // Mobile uses a fullscreen window; keep its size out of localStorage's reach.
    if (isMobileViewport()) return;
    try {
      const saved = JSON.parse(localStorage.getItem(SIZE_STORAGE_KEY) || 'null');
      if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return;
      const { width, height } = clampSize(saved.width, saved.height);
      wrapper.style.width = width + 'px';
      wrapper.style.height = height + 'px';
    } catch { /* storage blocked or malformed */ }
  }

  // Announce the current window size to assistive tech via a live region.
  function announceSize(wrapper) {
    const status = document.getElementById('ozwell-resize-status');
    if (status) status.textContent = 'Chat window ' + wrapper.offsetWidth + ' by ' + wrapper.offsetHeight + ' pixels';
  }

  function setWindowSize(wrapper, width, height, persist) {
    const clamped = clampSize(width, height);
    wrapper.style.width = clamped.width + 'px';
    wrapper.style.height = clamped.height + 'px';
    if (persist) {
      try { localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(clamped)); } catch { /* storage blocked */ }
    }
  }

  function resetWindowSize(wrapper) {
    wrapper.style.width = '';
    wrapper.style.height = '';
    try { localStorage.removeItem(SIZE_STORAGE_KEY); } catch { /* storage blocked */ }
    announceSize(wrapper);
  }

  // The window stays anchored bottom-right; a custom position is stored as right/bottom offsets.
  function setWindowOffsets(wrapper, right, bottom) {
    const maxRight = Math.max(EDGE_MARGIN, window.innerWidth - wrapper.offsetWidth - EDGE_MARGIN);
    const maxBottom = Math.max(EDGE_MARGIN, window.innerHeight - wrapper.offsetHeight - EDGE_MARGIN);
    wrapper.style.right = clampRange(right, EDGE_MARGIN, maxRight) + 'px';
    wrapper.style.bottom = clampRange(bottom, EDGE_MARGIN, maxBottom) + 'px';
  }

  function reclampWindowPosition(wrapper) {
    if (!wrapper.style.right) return;
    setWindowOffsets(wrapper, parseFloat(wrapper.style.right), parseFloat(wrapper.style.bottom));
  }

  function persistWindow(wrapper) {
    try {
      localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify({ width: wrapper.offsetWidth, height: wrapper.offsetHeight }));
      if (wrapper.style.right) {
        localStorage.setItem(WINDOW_POS_STORAGE_KEY, JSON.stringify({
          right: parseFloat(wrapper.style.right),
          bottom: parseFloat(wrapper.style.bottom),
        }));
      }
    } catch { /* storage blocked */ }
  }

  function applySavedPosition(wrapper) {
    if (isMobileViewport()) return;
    try {
      const saved = JSON.parse(localStorage.getItem(WINDOW_POS_STORAGE_KEY) || 'null');
      if (!saved || typeof saved.right !== 'number' || typeof saved.bottom !== 'number') return;
      setWindowOffsets(wrapper, saved.right, saved.bottom);
    } catch { /* storage blocked or malformed */ }
  }

  function resetWindowPosition(wrapper) {
    wrapper.style.right = '';
    wrapper.style.bottom = '';
    try { localStorage.removeItem(WINDOW_POS_STORAGE_KEY); } catch { /* storage blocked */ }
  }

  // Shared pointer-drag plumbing. Capturing the pointer guarantees a release
  // outside the viewport still ends the drag, so the iframe never stays stuck
  // at pointer-events: none.
  function trackPointerDrag(target, event, onMove, onEnd, iframe) {
    const startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    let active = true;
    const move = (e) => { if (active) onMove(e.clientX - startX, e.clientY - startY); };
    const end = () => {
      if (!active) return;
      active = false;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      target.removeEventListener('lostpointercapture', end);
      try { target.releasePointerCapture(pointerId); } catch { /* already released */ }
      if (iframe) iframe.style.pointerEvents = '';
      onEnd();
    };
    try { target.setPointerCapture(pointerId); } catch { /* capture unsupported */ }
    if (iframe) iframe.style.pointerEvents = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
  }

  // Resize from any edge/corner: only the dragged edges move, clamped to min size and viewport.
  function resizeFromRect(wrapper, start, dir, dx, dy) {
    const max = maxWindowSize();
    const r = { ...start };
    if (dir.includes('w')) r.left = clampRange(start.left + dx, Math.max(EDGE_MARGIN, r.right - max.width), r.right - MIN_WIDTH);
    if (dir.includes('e')) r.right = clampRange(start.right + dx, r.left + MIN_WIDTH, Math.min(window.innerWidth - EDGE_MARGIN, r.left + max.width));
    if (dir.includes('n')) r.top = clampRange(start.top + dy, Math.max(EDGE_MARGIN, r.bottom - max.height), r.bottom - MIN_HEIGHT);
    if (dir.includes('s')) r.bottom = clampRange(start.bottom + dy, r.top + MIN_HEIGHT, Math.min(window.innerHeight - EDGE_MARGIN, r.top + max.height));
    wrapper.style.width = (r.right - r.left) + 'px';
    wrapper.style.height = (r.bottom - r.top) + 'px';
    if (wrapper.style.right || dir.includes('e') || dir.includes('s')) {
      wrapper.style.right = (window.innerWidth - r.right) + 'px';
      wrapper.style.bottom = (window.innerHeight - r.bottom) + 'px';
    }
  }

  // Park the launcher at the window corner nearest the viewport edge, so hide/reload keeps them together.
  function anchorButtonToWindow(wrapper) {
    const button = document.getElementById('ozwell-chat-button');
    if (!button || !wrapper.style.right) return;
    const w = getRect(wrapper);
    const size = buttonSize(button);
    const onRight = (w.left + w.right) / 2 > window.innerWidth / 2;
    const onBottom = (w.top + w.bottom) / 2 > window.innerHeight / 2;
    setButtonPosition(button, onRight ? w.right - size.width : w.left, onBottom ? w.bottom - size.height : w.top, true);
  }

  function startWindowResize(wrapper, handle, event, dir) {
    const start = getRect(wrapper);
    trackPointerDrag(handle, event,
      (dx, dy) => resizeFromRect(wrapper, start, dir, dx, dy),
      () => { persistWindow(wrapper); anchorButtonToWindow(wrapper); announceSize(wrapper); },
      wrapper.querySelector('iframe'));
  }

  function enableEdgeResize(wrapper, handle) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      startWindowResize(wrapper, handle, event, handle.dataset.dir);
    });
  }

  // Drag the header to move the window; double-click the header to restore the default spot.
  function enableWindowMove(wrapper, header) {
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || isMobileViewport() || event.target.closest('button')) return;
      event.preventDefault();
      const start = getRect(wrapper);
      const startRight = window.innerWidth - start.right;
      const startBottom = window.innerHeight - start.bottom;
      trackPointerDrag(header, event,
        (dx, dy) => setWindowOffsets(wrapper, startRight - dx, startBottom - dy),
        () => { persistWindow(wrapper); anchorButtonToWindow(wrapper); },
        wrapper.querySelector('iframe'));
    });
    header.addEventListener('dblclick', (event) => {
      if (event.target.closest('button')) return;
      resetWindowPosition(wrapper);
      const button = document.getElementById('ozwell-chat-button');
      if (button) resetButtonPosition(button);
    });
  }

  // Drag the top-left handle to resize; also supports keyboard resizing (arrow keys, Home to reset).
  function enableResize(wrapper, handle) {
    let lastDownAt = 0;

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      // Manual double-tap: preventDefault above suppresses the native dblclick,
      // so detect two quick presses and reset to the default size instead.
      const now = Date.now();
      if (now - lastDownAt < 300) {
        lastDownAt = 0;
        resetWindowSize(wrapper);
        reclampWindowPosition(wrapper);
        return;
      }
      lastDownAt = now;
      startWindowResize(wrapper, handle, event, 'nw');
    });

    handle.addEventListener('keydown', (event) => {
      if (event.key === 'Home') {
        event.preventDefault();
        resetWindowSize(wrapper);
        return;
      }
      const step = keyStep(event);
      let dw = 0, dh = 0;
      switch (event.key) {
        case 'ArrowLeft': dw = step; break;   // wider
        case 'ArrowRight': dw = -step; break;  // narrower
        case 'ArrowUp': dh = step; break;      // taller
        case 'ArrowDown': dh = -step; break;   // shorter
        default: return;
      }
      event.preventDefault();
      setWindowSize(wrapper, wrapper.offsetWidth + dw, wrapper.offsetHeight + dh, true);
      reclampWindowPosition(wrapper);
      announceSize(wrapper);
    });

    // Re-clamp an explicit size/position when the viewport shrinks so the window
    // and its handles can't end up off-screen.
    window.addEventListener('resize', () => {
      if (isMobileViewport()) return;
      if (wrapper.style.width || wrapper.style.height) {
        setWindowSize(wrapper, wrapper.offsetWidth, wrapper.offsetHeight, false);
      }
      reclampWindowPosition(wrapper);
    });
  }

  // offsetWidth is 0 while the launcher is hidden; the computed CSS size is still available.
  function buttonSize(button) {
    const style = getComputedStyle(button);
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  }

  function setButtonPosition(button, left, top, persist) {
    const size = buttonSize(button);
    const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - size.width - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - size.height - EDGE_MARGIN);
    const pos = { left: clampRange(left, EDGE_MARGIN, maxLeft), top: clampRange(top, EDGE_MARGIN, maxTop) };
    button.style.left = pos.left + 'px';
    button.style.top = pos.top + 'px';
    button.style.right = 'auto';
    button.style.bottom = 'auto';
    if (persist) {
      // Store as viewport fractions so the position adapts across screen sizes.
      const frac = {
        x: pos.left / Math.max(1, window.innerWidth - size.width),
        y: pos.top / Math.max(1, window.innerHeight - size.height),
      };
      try { localStorage.setItem(BUTTON_POS_STORAGE_KEY, JSON.stringify(frac)); } catch { /* storage blocked */ }
    }
  }

  function resetButtonPosition(button) {
    button.style.left = '';
    button.style.top = '';
    button.style.right = '';
    button.style.bottom = '';
    try { localStorage.removeItem(BUTTON_POS_STORAGE_KEY); } catch { /* storage blocked */ }
  }

  function applySavedButtonPosition(button) {
    try {
      const saved = JSON.parse(localStorage.getItem(BUTTON_POS_STORAGE_KEY) || 'null');
      if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') return;
      const size = buttonSize(button);
      setButtonPosition(
        button,
        saved.x * (window.innerWidth - size.width),
        saved.y * (window.innerHeight - size.height),
        false
      );
    } catch { /* storage blocked or malformed */ }
  }

  // Drag the launcher to reposition it; Alt+Arrow moves it by keyboard, Alt+Home resets.
  // Returns a function reporting whether the last pointer interaction was a drag.
  function enableButtonDrag(button) {
    let dragged = false;

    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const origin = getRect(button);
      let dragging = false;
      dragged = false;
      trackPointerDrag(button, event,
        (dx, dy) => {
          if (!dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            dragging = true;
            button.classList.add('dragging');
          }
          setButtonPosition(button, origin.left + dx, origin.top + dy, false);
        },
        () => {
          if (!dragging) return;
          dragged = true;
          button.classList.remove('dragging');
          setButtonPosition(button, button.offsetLeft, button.offsetTop, true);
        });
    });

    button.addEventListener('keydown', (event) => {
      if (!event.altKey) return;
      if (event.key === 'Home') {
        event.preventDefault();
        resetButtonPosition(button);
        return;
      }
      const step = keyStep(event);
      let dx = 0, dy = 0;
      switch (event.key) {
        case 'ArrowLeft': dx = -step; break;
        case 'ArrowRight': dx = step; break;
        case 'ArrowUp': dy = -step; break;
        case 'ArrowDown': dy = step; break;
        default: return;
      }
      event.preventDefault();
      setButtonPosition(button, button.offsetLeft + dx, button.offsetTop + dy, true);
    });

    // Keep the launcher on-screen when the viewport changes.
    window.addEventListener('resize', () => {
      if (!button.style.left || button.classList.contains('hidden')) return;
      applySavedButtonPosition(button);
    });

    applySavedButtonPosition(button);

    return () => {
      const wasDrag = dragged;
      dragged = false;
      return wasDrag;
    };
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
    const customIcon = typeof config.buttonIcon === 'string' && config.buttonIcon.trim();
    // Absolute URL on the Ozwell origin; a root-relative path would hit the host site
    const iconSrc = customIcon || (autoDetectedBase ? `${autoDetectedBase}/widget/ozwell-icon.png` : '');
    if (iconSrc) {
      const img = document.createElement('img');
      img.src = iconSrc;
      img.alt = '';
      img.className = 'ozwell-chat-icon';
      img.draggable = false;
      button.classList.add('ozwell-chat-button--image');
      button.appendChild(img);
    } else {
      // Built via DOM APIs (no innerHTML) so hosts enforcing Trusted Types still work
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      const attrs = { class: 'ozwell-chat-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
      for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
      svg.appendChild(path);
      button.appendChild(svg);
    }
    button.setAttribute('aria-label', 'Open chat. Drag or press Alt plus arrow keys to move.');
    button.setAttribute('type', 'button');
    button.title = 'Open chat · drag to move';

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

    // Top-left drag handle (the window is anchored bottom-right, so dragging
    // up/left grows it). A button, not a 1-D separator, since it changes both
    // width and height; size changes are announced via the live region below.
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ozwell-resize-handle';
    resizeHandle.setAttribute('role', 'button');
    resizeHandle.setAttribute('tabindex', '0');
    resizeHandle.setAttribute('aria-label', 'Resize chat window. Use arrow keys to change width and height, Home to reset.');
    resizeHandle.title = 'Drag to resize · double-click to reset';

    // Visually-hidden live region announcing the current size to assistive tech.
    const resizeStatus = document.createElement('div');
    resizeStatus.id = 'ozwell-resize-status';
    resizeStatus.className = 'ozwell-sr-only';
    resizeStatus.setAttribute('role', 'status');
    resizeStatus.setAttribute('aria-live', 'polite');

    // Assemble wrapper
    wrapper.appendChild(resizeHandle);
    for (const dir of RESIZE_DIRS) {
      const edge = document.createElement('div');
      edge.className = 'ozwell-edge-handle';
      edge.dataset.dir = dir;
      edge.setAttribute('aria-hidden', 'true');
      wrapper.appendChild(edge);
    }
    wrapper.appendChild(resizeStatus);
    wrapper.appendChild(header);
    wrapper.appendChild(container);

    applySavedSize(wrapper);

    // Add to page
    document.body.appendChild(button);
    document.body.appendChild(wrapper);

    // Position clamping needs the rendered size, so apply after insertion.
    applySavedPosition(wrapper);

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

    const resizeHandle = wrapper.querySelector('.ozwell-resize-handle');
    if (resizeHandle) enableResize(wrapper, resizeHandle);
    wrapper.querySelectorAll('.ozwell-edge-handle').forEach((edge) => enableEdgeResize(wrapper, edge));
    const header = wrapper.querySelector('.ozwell-chat-header');
    if (header) enableWindowMove(wrapper, header);

    const wasDragged = enableButtonDrag(button);

    // Open chat when button clicked - use openChat() to track state and clear notifications
    button.addEventListener('click', () => {
      if (wasDragged()) return;
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
    discoverAgentContext();

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
      if (!config.provider && !config.model && data.default_model?.provider && data.default_model?.model) {
        state.runtimeConfig = {
          ...state.runtimeConfig,
          provider: data.default_model.provider,
          model: data.default_model.model,
        };
      }
    } catch (e) {
      // Silent fail — tools will fall back to config.tools if any
    }
  }

  function discoverAgentContext() {
    if (!agentDiscoveryPromise) {
      agentDiscoveryPromise = fetchAgentTools();
    }
    return agentDiscoveryPromise;
  }

  // Auto-mount widget unless explicitly disabled
  const config = readGlobalConfig();
  if (config.autoMount !== false) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', async () => {
        await discoverAgentContext();
        api.mount();
      });
    } else {
      // DOM already loaded, fetch tools then mount
      discoverAgentContext().then(() => api.mount());
    }
  }
})();
