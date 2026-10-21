// A popup captures its original tab. The remote widget can never choose a tab or URL.
export function createPageConnection(tabId, url, { api = chrome, onStateChange = () => {} } = {}) {
  let port, session, tools = [], disposed = false, failure;
  let sequence = 0;
  const pending = new Map();
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const readyTimer = setTimeout(() => dispose(new Error('Page tools did not become ready.')), 10000);
  const capturedUrl = (() => { try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.href : null; } catch { return null; } })();

  function dispose(reason = new Error('Page connection closed.')) {
    if (disposed) return;
    disposed = true;
    failure = reason;
    clearTimeout(readyTimer);
    readyResolve([]);
    onStateChange({ connected: false, error: reason.message });
    for (const request of pending.values()) request.finish(reason);
    pending.clear();
    try { port?.disconnect(); } catch { /* The tab may already be gone. */ }
    port = null;
  }

  function receive(message) {
    if (disposed || !message || typeof message !== 'object') return;
    if (message.type === 'ready' && !session) {
      if (message.url !== capturedUrl || typeof message.session !== 'string' || !message.session) return dispose(new Error('The page changed before connecting.'));
      session = message.session;
      tools = Array.isArray(message.tools) ? message.tools : [];
      clearTimeout(readyTimer);
      readyResolve(tools);
      onStateChange({ connected: tools.length > 0 });
      return;
    }
    if (!session || message.session !== session || !Number.isInteger(message.id)) return;
    const request = pending.get(message.id);
    if (!request) return;
    if (message.type === 'result') request.finish(null, message.result);
    else if (message.type === 'error') request.finish(new Error(message.error?.message || 'Page tool failed.'));
  }

  async function initialize() {
    if (!Number.isInteger(tabId) || !capturedUrl) return dispose(new Error('This page does not support page tools.'));
    try {
      const current = await api.tabs.get(tabId);
      if (disposed) return;
      if (current.url !== capturedUrl) return dispose(new Error('The captured page has changed.'));
      await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['vendor/page-controller.js', 'page-tools.js', 'mcp-bridge.js', 'content-script.js'] });
      if (disposed) return;
      port = api.tabs.connect(tabId, { name: 'ozwell:page-tools', frameId: 0 });
      port.onMessage.addListener(receive);
      port.onDisconnect.addListener(() => dispose(new Error('Page access ended or the page navigated.')));
      port.postMessage({ type: 'hello', url: capturedUrl });
    } catch (error) { dispose(error); }
  }

  async function getTools({ signal } = {}) {
    if (signal?.aborted || disposed) return [];
    if (!signal) {
      const value = await ready;
      return disposed ? [] : value;
    }
    return new Promise(resolve => {
      const abort = () => resolve([]);
      signal.addEventListener('abort', abort, { once: true });
      ready.then(value => { signal.removeEventListener('abort', abort); resolve(signal.aborted || disposed ? [] : value); });
    });
  }

  async function callTool(name, args, { signal } = {}) {
    await getTools({ signal });
    if (signal?.aborted) throw new DOMException('Tool execution aborted.', 'AbortError');
    if (disposed || !session) throw failure || new Error('Page access is unavailable.');
    if (!tools.some(tool => tool.name === name)) throw new Error('Unknown page tool.');
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const abort = () => {
        try { port?.postMessage({ type: 'cancel', session, id }); } catch { /* Disconnected. */ }
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
      try { port.postMessage({ type: 'call', session, id, name, args }); }
      catch (error) { finish(error); }
    });
  }

  void initialize();
  return { getTools, callTool, dispose, get disposed() { return disposed; } };
}
