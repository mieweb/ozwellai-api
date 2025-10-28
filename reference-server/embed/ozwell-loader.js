(function () {
  const DEFAULT_DIMENSIONS = { width: 360, height: 420 };
  const DEFAULT_CONFIG = {
    title: 'Ozwell Assistant',
    placeholder: 'Ask a question...',
    model: 'llama3',
    endpoint: '/embed/chat',
    widgetUrl: '/embed/widget.html',
  };

  const state = {
    iframe: null,
    ready: false,
    pendingMessages: [],
    runtimeConfig: {},
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
    const widgetSrc = options.src || config.widgetUrl || config.src || '/embed/widget.html';
    iframe.src = widgetSrc;
    iframe.width = String(options.width || DEFAULT_DIMENSIONS.width);
    iframe.height = String(options.height || DEFAULT_DIMENSIONS.height);
    iframe.style.border = '0';
    iframe.style.borderRadius = '12px';
    iframe.style.boxShadow = '0 20px 50px rgba(15, 23, 42, 0.12)';
    iframe.setAttribute('title', config.title || 'Ozwell Chat');
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms');

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

  function mount(options = {}) {
    const iframe = ensureIframe(options);
    iframe.addEventListener('load', () => {
      // Widget notifies us when it is ready.
    });
    return iframe;
  }

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
  window.OzwellChat = api;
})();
