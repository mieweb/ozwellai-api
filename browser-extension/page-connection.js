// A connection is pinned by the popup's captured tab or the page host's authenticated relay.
function regularURL(value) {
  if (typeof value !== 'string') return null;
  try { const parsed = new URL(value); return /^https?:$/.test(parsed.protocol) ? parsed.href : null; }
  catch { return null; }
}

function createConnection({ initialize, validateReady, onStateChange, heartbeat = false }) {
  let port, session, tools = [], disposed = false, failure;
  let heartbeatTimer;
  let sequence = 0;
  const pending = new Map();
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const readyTimer = setTimeout(() => dispose(new Error('Page tools did not become ready.')), 10000);

  function dispose(reason = new Error('Page connection closed.')) {
    if (disposed) return;
    disposed = true;
    failure = reason;
    clearTimeout(readyTimer);
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    readyResolve();
    onStateChange({ connected: false, error: reason.message });
    for (const request of pending.values()) request.finish(reason);
    pending.clear();
    try { port?.disconnect(); } catch { /* The tab may already be gone. */ }
    port = null;
  }

  function receive(message) {
    if (disposed || !message || typeof message !== 'object') return;
    if (message.type === 'pong') return;
    if (message.type === 'ready') {
      if (!validateReady(message) || typeof message.session !== 'string' || !message.session) return dispose(new Error('The page changed before connecting.'));
      if (session && session !== message.session) {
        for (const request of pending.values()) request.finish(new Error('The page tool session changed. Try again with a new snapshot.'));
      }
      session = message.session;
      tools = Array.isArray(message.tools) ? message.tools : [];
      clearTimeout(readyTimer);
      if (heartbeat && heartbeatTimer === undefined) {
        // Chrome may idle the worker while a port is open. Retained page chat
        // needs actual port traffic until its host is closed or disconnected.
        heartbeatTimer = setInterval(() => {
          try { port.postMessage({ type: 'ping' }); } catch (error) { dispose(error); }
        }, 20000);
      }
      readyResolve();
      onStateChange({ connected: tools.length > 0 });
      return;
    }
    if (!session || message.session !== session || !Number.isInteger(message.id)) return;
    const request = pending.get(message.id);
    if (!request) return;
    if (message.type === 'result') request.finish(null, message.result);
    else if (message.type === 'error') request.finish(new Error(message.error?.message || 'Page tool failed.'));
  }

  function bind(nextPort, hello) {
    if (disposed) { nextPort.disconnect(); return; }
    port = nextPort;
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(() => dispose(new Error('Page access ended or the page navigated.')));
    port.postMessage(hello);
  }

  async function getTools({ signal } = {}) {
    if (signal?.aborted || disposed) return [];
    if (!signal) {
      await ready;
      return disposed ? [] : tools;
    }
    return new Promise(resolve => {
      const abort = () => resolve([]);
      signal.addEventListener('abort', abort, { once: true });
      ready.then(() => { signal.removeEventListener('abort', abort); resolve(signal.aborted || disposed ? [] : tools); });
    });
  }

  async function callTool(name, args = {}, { signal } = {}) {
    await getTools({ signal });
    if (signal?.aborted) throw new DOMException('Tool execution aborted.', 'AbortError');
    if (disposed || !session) throw failure || new Error('Page access is unavailable.');
    if (!tools.some(tool => tool.name === name)) throw new Error('Unknown page tool.');
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const requestSession = session;
      const abort = () => {
        try { port?.postMessage({ type: 'cancel', session: requestSession, id }); } catch { /* Disconnected. */ }
        finish(new DOMException('Tool execution aborted.', 'AbortError'));
      };
      const timer = setTimeout(() => { abort(); }, 28000);
      function finish(error, result) {
        if (!pending.has(id)) return;
        pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(result);
      }
      pending.set(id, { finish });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      try { port.postMessage({ type: 'call', session: requestSession, id, name, args }); }
      catch (error) { finish(error); }
    });
  }

  void Promise.resolve().then(() => {
    if (!disposed) return initialize({ bind, isDisposed: () => disposed });
  }).catch(dispose);
  return { getTools, callTool, dispose, get disposed() { return disposed; } };
}

// The remote widget can never choose a popup's tab or URL.
export function createPageConnection(tabId, url, { api = chrome, onStateChange = () => {} } = {}) {
  const capturedUrl = regularURL(url);
  return createConnection({
    onStateChange,
    validateReady: message => message.url === capturedUrl,
    async initialize({ bind, isDisposed }) {
      if (!Number.isInteger(tabId) || !capturedUrl) throw new Error('This page does not support page tools.');
      const current = await api.tabs.get(tabId);
      if (isDisposed()) return;
      if (current.url !== capturedUrl) throw new Error('The captured page has changed.');
      await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['vendor/page-controller.js', 'page-tools.js', 'mcp-bridge.js', 'content-script.js'] });
      if (isDisposed()) return;
      bind(api.tabs.connect(tabId, { name: 'ozwell:page-tools', frameId: 0 }), { type: 'hello', url: capturedUrl });
    },
  });
}

// The worker derives this host's page and frame from its native extension sender.
export function createPageHostConnection(token, { api = chrome, onStateChange = () => {} } = {}) {
  let capturedUrl;
  return createConnection({
    onStateChange,
    heartbeat: true,
    validateReady(message) {
      if (!regularURL(message.url)) return false;
      if (capturedUrl === undefined) capturedUrl = message.url;
      return message.url === capturedUrl;
    },
    initialize({ bind }) {
      if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) throw new Error('The page host token is invalid.');
      bind(api.runtime.connect({ name: 'ozwell:page-host' }), { type: 'hello', token });
    },
  });
}
