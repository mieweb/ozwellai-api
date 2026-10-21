import './mcp-bridge.js';

// Chat and credentials remain in the remote frame; page tools use a local, pinned connection.
export function normalizeWidget(value) {
  const origin = new URL(value?.origin);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.origin !== value.origin || (origin.protocol !== 'https:' && !local)) {
    throw new Error('Use an HTTPS ozwell server or an HTTP loopback development server.');
  }
  const frameUrl = new URL(value.frameUrl);
  const endpoint = new URL(value.endpoint);
  if (frameUrl.origin !== origin.origin || endpoint.origin !== origin.origin) {
    throw new Error('The ozwell widget and API must use the configured server origin.');
  }
  return { origin: origin.origin, frameUrl: frameUrl.href, endpoint: endpoint.href };
}

export function createWidgetHost(container, { onReady = () => {}, onError = () => {}, getTools = async () => [], callTool, isAuthorized = () => true } = {}) {
  let widget, frame, loading, fallback, loadTimer, mcp, toolsController;
  let ready = false;

  function post(message) {
    frame?.contentWindow?.postMessage(message, widget.origin);
  }

  function focus() {
    // The widget decides which composer or sign-in input is currently usable.
    if (!ready) return;
    frame?.focus();
    post({ source: 'ozwell-chat-parent', type: 'focus' });
  }

  async function refreshTools() {
    if (!ready || !frame || !mcp) return;
    const target = frame;
    toolsController?.abort();
    toolsController = new AbortController();
    const signal = toolsController.signal;
    try {
      const tools = await mcp.getTools({ signal });
      if (signal.aborted || frame !== target || !ready) return;
      post({ source: 'ozwell-chat-parent', type: 'config', payload: { config: { tools: tools.map(tool => ({
        type: 'function', function: { name: tool.name, description: tool.description || '', parameters: tool.inputSchema || { type: 'object', properties: {} } },
      })) } } });
    } catch { /* Chat remains available if page tool discovery fails. */ }
  }

  function showError() {
    if (!loading || ready) return;
    const message = 'ozwell could not load here. Try opening it directly.';
    loading.firstElementChild.textContent = message;
    fallback.hidden = false;
    onError(message);
  }

  function handleMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== widget.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source === 'ozwell-chat-widget') {
      if (data.type === 'ready' || data.type === 'request-config') {
        const firstReady = !ready;
        ready = true;
        clearTimeout(loadTimer);
        loading.hidden = true;
        frame.hidden = false;
        post({
          source: 'ozwell-chat-parent', type: 'config',
          payload: { config: {
            endpoint: widget.endpoint, title: 'ozwell', autoFocus: true,
            welcomeMessage: 'Hi, I’m ozwell. What would you like to work on?',
            thinkingEnabled: false, tools: [],
          } },
        });
        void refreshTools();
        if (firstReady) {
          focus();
          onReady();
        }
      }
      return;
    }
    mcp?.handle(data);
  }

  function destroy() {
    clearTimeout(loadTimer);
    toolsController?.abort();
    toolsController = null;
    mcp?.dispose();
    mcp = null;
    window.removeEventListener('message', handleMessage);
    frame?.remove();
    loading?.remove();
    widget = frame = loading = fallback = null;
    ready = false;
  }

  function mount(value) {
    const next = normalizeWidget(value);
    if (frame && widget.origin === next.origin && widget.frameUrl === next.frameUrl && widget.endpoint === next.endpoint) return frame;
    destroy();
    widget = next;
    loading = document.createElement('div');
    loading.className = 'chat-empty';
    loading.setAttribute('role', 'status');
    const message = document.createElement('p');
    message.textContent = 'Opening ozwell…';
    fallback = document.createElement('a');
    fallback.textContent = 'Open ozwell';
    fallback.href = widget.frameUrl;
    fallback.target = '_blank';
    fallback.rel = 'noopener noreferrer';
    fallback.hidden = true;
    loading.append(message, fallback);

    frame = document.createElement('iframe');
    frame.id = 'chat-frame';
    frame.title = 'Chat with ozwell';
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.addEventListener('error', showError);
    mcp = globalThis.__ozwellCreateMcpBridge({ getTools, callTool, post, isAuthorized });
    window.addEventListener('message', handleMessage);
    frame.src = widget.frameUrl;
    container.append(loading, frame);
    // HTTP errors and embedding-policy blocks may still fire the frame's load event.
    loadTimer = setTimeout(showError, 12000);
    return frame;
  }

  return { mount, destroy, focus, refreshTools };
}
