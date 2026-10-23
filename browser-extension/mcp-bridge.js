/* Shared by the isolated page script and the local toolbar popup. */
(() => {
  if (globalThis.__ozwellCreateMcpBridge) return;
  const NAMES = new Set(['browser_snapshot', 'browser_click', 'browser_fill', 'browser_select', 'browser_scroll']);
  const PREFIX = 'postMessage_';
  const validId = id => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
  const keyFor = id => JSON.stringify([typeof id, id]);

  globalThis.__ozwellCreateMcpBridge = ({ getTools = async () => [], callTool, post, isAuthorized = () => true }) => {
    const pending = new Map();
    let disposed = false;
    let generation = 0;

    async function discover(signal) {
      if (disposed || !isAuthorized()) return [];
      const tools = await getTools({ signal });
      if (disposed || signal.aborted || !isAuthorized()) return [];
      return (Array.isArray(tools) ? tools : [])
        .filter(tool => tool && NAMES.has(tool.name))
        .map(tool => ({ ...tool, name: PREFIX + tool.name }));
    }

    function stop(request) {
      clearTimeout(request.timer);
      request.controller.abort();
      pending.delete(request.key);
    }

    function reset() {
      generation++;
      for (const request of [...pending.values()]) stop(request);
    }

    function handle(data) {
      if (disposed || !data || data.jsonrpc !== '2.0' || typeof data.method !== 'string') return;
      // Cancellation is a notification, so it must be handled before requiring an id.
      if (data.method === 'notifications/cancelled') {
        const id = data.params?.requestId;
        if (validId(id)) {
          const request = pending.get(keyFor(id));
          if (request) stop(request);
        }
        return;
      }
      if (!validId(data.id)) return;
      const reply = result => post({ jsonrpc: '2.0', id: data.id, result });
      if (data.method === 'initialize') {
        reply({ protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'ozwell-browser-extension', version: '0.1.0' } });
        return;
      }
      if (data.method === 'ping') { reply({}); return; }
      if (data.method !== 'tools/list' && data.method !== 'tools/call') {
        post({ jsonrpc: '2.0', id: data.id, error: { code: -32601, message: 'Unknown method.' } });
        return;
      }
      const key = keyFor(data.id);
      // Duplicate in-flight ids cannot replace another request's cancellation token.
      if (pending.has(key)) return;
      const request = { key, controller: new AbortController(), generation };
      pending.set(key, request);
      request.timer = setTimeout(() => {
        if (pending.get(key) !== request) return;
        stop(request);
        if (!disposed) post({ jsonrpc: '2.0', id: data.id, error: { code: -32000, message: 'Page tool request timed out.' } });
      }, 29000);
      Promise.resolve().then(async () => {
        const tools = await discover(request.controller.signal);
        if (data.method === 'tools/list') return { tools };
        const name = data.params?.name;
        const definition = tools.find(tool => tool.name === name);
        if (!definition || !callTool) throw Object.assign(new Error('Unknown or unavailable page tool.'), { code: -32602 });
        if (!isAuthorized() || request.controller.signal.aborted) throw new Error('Page access is no longer available.');
        return callTool(name.slice(PREFIX.length), data.params?.arguments ?? {}, { signal: request.controller.signal });
      }).then(result => {
        if (disposed || pending.get(key) !== request || request.generation !== generation || request.controller.signal.aborted) return;
        clearTimeout(request.timer);
        pending.delete(key);
        // Discovery can become unavailable without blocking ordinary chat.
        if (data.method === 'tools/call' && !isAuthorized()) return;
        reply(result);
      }).catch(error => {
        if (disposed || pending.get(key) !== request || request.generation !== generation || request.controller.signal.aborted) return;
        clearTimeout(request.timer);
        pending.delete(key);
        post({ jsonrpc: '2.0', id: data.id, error: { code: error.code || -32000, message: error.message || 'Page tool failed.' } });
      });
    }

    return { handle, reset, getTools: ({ signal = new AbortController().signal } = {}) => discover(signal), dispose() { disposed = true; reset(); } };
  };
})();
