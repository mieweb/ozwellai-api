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

export function createWidgetHost(container, { onReady = () => {}, onError = () => {}, onDocumentChange = () => {}, getTools = async () => [], callTool, isAuthorized = () => true } = {}) {
  let widget, frame, loading, fallback, loadTimer, mcp, toolsController;
  let ready = false;
  let documentId, loadedDocumentId, hasLoaded = false, documentStarted = false;
  const retiredDocuments = new Set();

  function post(message) {
    const envelope = documentId ? { ...message, ozwellDocumentId: documentId } : message;
    frame?.contentWindow?.postMessage(envelope, widget.origin);
  }

  function endDocument() {
    toolsController?.abort();
    toolsController = null;
    mcp?.reset();
    if (documentId) retiredDocuments.add(documentId);
    if (!ready) return;
    ready = false;
    // Disposing the native page connection also disposes its snapshot factory.
    // Cancelling only MCP calls would leave old snapshot tokens usable after reload.
    onDocumentChange({ active: false });
  }

  function startDocument(nextId) {
    if (!nextId && (documentId || retiredDocuments.size)) return false;
    if (nextId && retiredDocuments.has(nextId)) return false;
    if (ready && documentStarted && documentId === nextId) return true;
    if (documentStarted) endDocument();
    documentStarted = true;
    documentId = nextId;
    ready = true;
    // Older deployed widgets remain usable for chat. Without a document nonce
    // their requests cannot be separated safely across a same-origin reload.
    onDocumentChange({ active: Boolean(nextId) });
    return true;
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
    if (!frame || event.origin !== widget.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source === 'ozwell-chat-widget' && data.type === 'pagehide') {
      // Chromium can null a departing document's WindowProxy before delivering
      // its queued unload notice. Only this teardown notice may use that path,
      // authenticated by the pinned origin and its current unpredictable nonce.
      if ((event.source === frame.contentWindow || event.source === null) && documentId && data.ozwellDocumentId === documentId
        && Object.keys(data).every(key => ['source', 'type', 'ozwellDocumentId'].includes(key))) endDocument();
      return;
    }
    if (event.source !== frame.contentWindow) return;
    if (data.source === 'ozwell-chat-widget') {
      const nextId = typeof data.ozwellDocumentId === 'string' && /^[a-f0-9-]{32,64}$/.test(data.ozwellDocumentId) ? data.ozwellDocumentId : undefined;
      if (data.type === 'ready' || data.type === 'request-config') {
        const firstReady = !ready || nextId !== documentId;
        // Configuration refreshes do not identify a new document. The widget's
        // per-document nonce survives React renders, but changes on navigation.
        if (data.type === 'ready') {
          if (!startDocument(nextId)) return;
        } else {
          if (documentId ? nextId !== documentId : nextId) return;
          if (!ready && !documentStarted && !startDocument(nextId)) return;
          if (!ready) return;
        }
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
    // Once the widget supports document identity, queued messages from a retired
    // document must not operate on the replacement document's native connection.
    if (documentId && data.ozwellDocumentId !== documentId) return;
    if (!ready && documentStarted) return;
    mcp?.handle(data);
  }

  function destroy() {
    clearTimeout(loadTimer);
    endDocument();
    mcp?.dispose();
    mcp = null;
    window.removeEventListener('message', handleMessage);
    frame?.remove();
    loading?.remove();
    widget = frame = loading = fallback = null;
    ready = false;
    documentId = loadedDocumentId = undefined;
    hasLoaded = documentStarted = false;
    retiredDocuments.clear();
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
    const mountedFrame = frame;
    frame.addEventListener('error', () => { if (frame === mountedFrame) showError(); });
    frame.addEventListener('load', () => {
      if (frame !== mountedFrame) return;
      // A WindowProxy survives iframe reloads. For older deployed widgets that
      // do not send a document nonce/pagehide, load is the fallback boundary.
      if (hasLoaded && (!documentId || documentId === loadedDocumentId)) {
        const legacyReady = ready && !documentId;
        endDocument();
        if (legacyReady) {
          startDocument(undefined);
          void refreshTools();
        }
      }
      hasLoaded = true;
      loadedDocumentId = documentId;
    });
    mcp = globalThis.__ozwellCreateMcpBridge({ getTools, callTool, post,
      isAuthorized: () => ready && Boolean(documentId) && isAuthorized(),
    });
    window.addEventListener('message', handleMessage);
    frame.src = widget.frameUrl;
    container.append(loading, frame);
    // HTTP errors and embedding-policy blocks may still fire the frame's load event.
    loadTimer = setTimeout(showError, 12000);
    return frame;
  }

  return { mount, destroy, focus, refreshTools };
}
