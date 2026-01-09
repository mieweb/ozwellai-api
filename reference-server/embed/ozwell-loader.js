/**
 * ============================================
 * IFRAME-SYNC LIBRARY (Bundled - Internal Use)
 * ============================================
 *
 * This library provides state synchronization between parent pages and iframes
 * using the postMessage API. It's bundled here for convenience and kept private.
 *
 * DO NOT use IframeSyncBroker/IframeSyncClient directly - use OzwellChat.updateContext() instead.
 *
 * Architecture:
 * - IframeSyncBroker: Lives in parent page, manages state and broadcasts to clients
 * - IframeSyncClient: Lives in iframes, receives state updates from broker
 *
 * Communication Flow:
 * 1. Parent calls broker.stateChange({ data }) or OzwellChat.updateContext({ data })
 * 2. Broker broadcasts state to all registered iframe clients via postMessage
 * 3. Each client receives state update and calls their callback function
 *
 * Why bundled: Simplifies integration - one script tag instead of two.
 * Why private: Clean API - developers use OzwellChat.updateContext() instead.
 */

/**
 * Class representing an IframeSyncClient.
 * Browser iframes that want to participate in state synchronization should instantiate this class.
 *
 * This is used internally by the Ozwell widget to receive context updates from the parent page.
 */
class IframeSyncClient {
    #channel;
    #recv;
    #clientName;

    /**
     * Create an IframeSyncClient.
     * @param {string} [clientName] - A unique client name. If not provided, one will be generated randomly.
     * @param {function} recv - A callback function to receive state updates.
     */
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

    /**
     * Notify the parent window that this client is ready to receive state updates.
     */
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

    /**
     * Send a state update to the broker, which will broadcast it to all other clients.
     * Partial updates are OK, as the broker will merge the update into the current state.
     * @param {Object} update - The state update to send.
     */
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
 * Class representing an IframeSyncBroker.
 *
 * This manages state in the parent page and broadcasts updates to all iframe clients.
 * The Ozwell widget uses this internally - parent pages should use OzwellChat.updateContext() instead.
 */
class IframeSyncBroker {
    #channel;
    #state;
    #clientIframes;
    #debugMode;

    /**
     * Create an IframeSyncBroker.
     */
    constructor() {
        this.#channel = 'IframeSync';
        this.#state = {};
        this.#clientIframes = new Set();
        this.#debugMode = false;

        if (!window) {
          return;
        }
        window.addEventListener('message', (event) => this.#handleMessage(event));
    }

    /**
     * Handle incoming messages from iframe clients.
     * @param {MessageEvent} event - The message event.
     * @private
     */
    #handleMessage(event) {
        const { data, source: clientIframe } = event;
        if (!data || data.channel !== this.#channel) {
            return;
        }

        if (data.type === 'ready') {
            this.#clientIframes.add(clientIframe);
            this.#sendReadyReceived(clientIframe);
        } else if (data.type === 'stateChange' && data.payload) {
            this.#updateState(data.payload, data.sourceClientName);
        }
    }

    /**
     * Update the state with the provided update and broadcast to all clients.
     * @param {Object} update - The state update.
     * @param {string} sourceClientName - The name of the client that sent the update.
     * @private
     */
    #updateState(update, sourceClientName) {
        const prevState = JSON.stringify(this.#state);
        Object.assign(this.#state, update);
        const newState = JSON.stringify(this.#state);

        if (prevState !== newState) {
            this.#debug();
            this.#broadcastState(sourceClientName);
        }
    }

    /**
     * Send the current state to a specific client iframe.
     * @param {Window} clientIframe - The client iframe to send the state to.
     * @param {string} sourceClientName - The name of the client that requested the state.
     * @private
     */
    #sendSyncState(clientIframe, sourceClientName) {
        if (clientIframe && typeof clientIframe.postMessage === 'function') {
            clientIframe.postMessage({
                channel: this.#channel,
                type: 'syncState',
                sourceClientName: sourceClientName, // Pass through the source
                payload: this.#state,
            }, '*');
        }
    }

    /**
     * Notify a client that it has been registered and send initial state.
     * @param {Window} clientIframe - The client iframe to notify.
     * @private
     */
    #sendReadyReceived(clientIframe) {
        if (clientIframe && typeof clientIframe.postMessage === 'function') {
            clientIframe.postMessage({
                channel: this.#channel,
                type: 'readyReceived',
                payload: this.#state,
            }, '*');
        }
    }

    /**
     * Broadcast the current state to all client iframes.
     * @param {string} sourceClientName - The name of the client that sent the update.
     * @private
     */
    #broadcastState(sourceClientName) {
        this.#clientIframes.forEach((clientIframe) =>
            this.#sendSyncState(clientIframe, sourceClientName)
        );
    }

    /**
     * Log a debug message (internal debugging tool).
     * @private
     */
    #debug() {
        if (this.#debugMode === false) {
            return; // noop by default
        }

        const stateJson = JSON.stringify(this.#state, null, 2);
        if (this.#debugMode === true) {
            console.log('IframeSyncBroker state change', stateJson);
        } else if (typeof this.#debugMode === 'function') {
            this.#debugMode(stateJson);
        } else if (this.#debugMode instanceof HTMLElement) {
            this.#debugMode.innerText = stateJson;
        }
    }

    /**
     * Control debug behavior.
     * @param {boolean|Function|HTMLElement} mode - The debug mode.
     *   * false (default): no debug
     *   * true: console.log
     *   * function: call a provided function
     *   * HTML element: set the text of an element
     */
    setDebugMode(mode) {
        this.#debugMode = mode;
    }

    /**
     * Manually trigger a state update.
     * This is the main API for parent pages to send context to the widget.
     * @param {Object} update - State update to broadcast to all iframe clients.
     */
    stateChange(update) {
        this.#updateState(update, 'parent');
    }
}

/**
 * ============================================
 * OZWELL CHAT WIDGET LOADER
 * ============================================
 *
 * Main API for embedding the Ozwell chat widget.
 *
 * Usage:
 *   1. Configure: window.OzwellChatConfig = { endpoint: '/v1/chat/completions', tools: [...] }
 *   2. Mount: OzwellChat.mount()
 *   3. Update context (optional): OzwellChat.updateContext({ formData: {...} })
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

  // Auto-detect base URL from script location and read data attributes
  let autoDetectedBase = '';
  let scriptDataConfig = {};
  try {
    if (document.currentScript) {
      // Read data attributes from script tag (e.g., data-api-key, data-agent-id)
      const script = document.currentScript;
      if (script.dataset) {
        // Convert dataset to config object (e.g., data-api-key -> apiKey)
        scriptDataConfig = { ...script.dataset };
        if (scriptDataConfig.apiKey) {
          console.log('[OzwellChat] API key configured via data attribute');
        }
      }
      if (script.src) {
        const scriptUrl = new URL(script.src);
        autoDetectedBase = `${scriptUrl.protocol}//${scriptUrl.host}`;
        console.log('[OzwellChat] Auto-detected base URL:', autoDetectedBase);
      }
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
  };

  const state = {
    iframe: null,
    ready: false,
    pendingMessages: [],
    runtimeConfig: {},
    broker: null, // Internal iframe-sync broker for state updates
    hasUnread: false, // Track unread messages when chat is closed
    chatOpen: false, // Track if chat window is currently open
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
      ...scriptDataConfig,    // Config from data attributes (data-api-key, etc.)
      ...readGlobalConfig(),  // Config from window.OzwellChatConfig
      ...state.runtimeConfig, // Runtime overrides
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

  function handleWidgetMessage(event) {
    if (!state.iframe || event.source !== state.iframe.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.source !== 'ozwell-chat-widget') return;

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
      case 'insert': {
        const detail = {
          text: data.payload?.text || '',
          close: Boolean(data.payload?.close),
        };
        document.dispatchEvent(new CustomEvent('ozwell-chat-insert', { detail }));
        break;
      }
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
   * @param {Object} data - Message data with { message, hadToolCalls }
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

    // Dispatch custom event for external listeners
    document.dispatchEvent(new CustomEvent('ozwell-chat-unread', {
      detail: { message: data.message }
    }));
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
   * Creates the iframe element and initializes the internal state sync broker.
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

    // Initialize iframe-sync broker for real-time state updates
    // This allows parent page to send context to widget via updateContext()
    if (!state.broker) {
      state.broker = new IframeSyncBroker();
      console.log('[OzwellChat] State sync broker initialized');
    }

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

  /**
   * Update the widget's context/state in real-time.
   * Sends data to the widget iframe via iframe-sync, which the widget can use
   * to provide context-aware responses.
   *
   * Example: Send form data to widget so it knows current values
   *
   * @param {Object} data - Context data to send to widget
   * @example
   * // Update form context
   * OzwellChat.updateContext({
   *   formData: {
   *     name: 'John Doe',
   *     address: '123 Main St',
   *     zipCode: '12345'
   *   }
   * });
   *
   * @example
   * // Update ticket context (TimeHarbor)
   * OzwellChat.updateContext({
   *   ticketForm: {
   *     title: 'Fix bug',
   *     description: 'Auth issue',
   *     timeSpent: '2h 30m'
   *   }
   * });
   */
  function updateContext(data) {
    if (!state.broker) {
      console.warn('[OzwellChat] Broker not initialized. Call mount() before updateContext()');
      return;
    }

    // Send context update to widget via iframe-sync
    state.broker.stateChange(data);
  }

  window.addEventListener('message', handleWidgetMessage);

  const api = {
    mount,
    configure,
    updateContext, // New API for real-time context updates
    open: openChat, // Programmatically open the chat window
    close: closeChat, // Programmatically close the chat window
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

  // Export API for manual initialization
  // Note: IframeSyncBroker/Client are NOT exposed - use updateContext() instead
  window.OzwellChat = api;

  // Auto-mount widget unless explicitly disabled
  const config = readGlobalConfig();
  if (config.autoMount !== false) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        api.mount();
      });
    } else {
      // DOM already loaded, mount immediately
      api.mount();
    }
  }
})();
