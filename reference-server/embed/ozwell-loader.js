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
  const DEFAULT_DIMENSIONS = { width: 360, height: 420 };
  const DEFAULT_CONFIG = {
    title: 'Ozwell Assistant',
    placeholder: 'Ask a question...',
    model: 'llama3',
    endpoint: '/v1/chat/completions',
    widgetUrl: '/embed/ozwell.html',
  };

  const state = {
    iframe: null,
    ready: false,
    pendingMessages: [],
    runtimeConfig: {},
    broker: null, // Internal iframe-sync broker for state updates
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
      default:
        break;
    }
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
    get iframe() {
      return state.iframe;
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
