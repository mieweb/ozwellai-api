// Only an embedded extension page may use this relay. Page scripts and the hosted
// widget cannot supply the native tab/frame identity that authorizes its endpoint.
export function installPageHostRelay(api) {
  const active = new Set();
  const hostURL = api.runtime.getURL('page-host.html');
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
  const session = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const id = value => Number.isSafeInteger(value) && value > 0;

  function connect(host) {
    if (host.name !== 'ozwell:page-host') return;
    const sender = host.sender;
    const suffix = typeof sender?.url === 'string' && sender.url.startsWith(hostURL) ? sender.url.slice(hostURL.length) : '';
    const token = /^#token=([a-f0-9]{32})$/.exec(suffix)?.[1];
    if (sender?.id !== api.runtime.id || !token || !Number.isSafeInteger(sender.tab?.id) || sender.tab.id < 0 || !Number.isSafeInteger(sender.frameId) || sender.frameId <= 0) {
      host.disconnect();
      return;
    }
    const tabId = sender.tab.id, frameId = sender.frameId;
    let page, closed = false, initialized = false;

    function close() {
      if (closed) return;
      closed = true;
      active.delete(close);
      host.onMessage.removeListener?.(fromHost);
      host.onDisconnect.removeListener?.(close);
      page?.onMessage.removeListener?.(fromPage);
      page?.onDisconnect.removeListener?.(close);
      try { host.disconnect(); } catch { /* Already disconnected. */ }
      try { page?.disconnect(); } catch { /* Already disconnected. */ }
    }
    function fromPage(message) {
      if (closed) return;
      if (!object(message) || !['ready', 'result', 'error'].includes(message.type)) return close();
      try { host.postMessage(message); } catch { close(); }
    }
    function fromHost(message) {
      if (closed) return;
      if (!object(message)) return close();
      if (!initialized) {
        if (message.type !== 'hello' || !keys(message, ['type', 'token']) || message.token !== token) return close();
        initialized = true;
        try {
          page = api.tabs.connect(tabId, { name: 'ozwell:hosted-page-tools', frameId: 0 });
          page.onMessage.addListener(fromPage);
          page.onDisconnect.addListener(close);
          // Queue the authenticated hello until the target port and listeners exist.
          page.postMessage({ type: 'hello', token, frameId });
        } catch { close(); }
        return;
      }
      if (message.type === 'ping' && keys(message, ['type'])) {
        try { host.postMessage({ type: 'pong' }); } catch { close(); }
        return;
      }
      const validCall = message.type === 'call' && keys(message, ['type', 'session', 'id', 'name', 'args']) && session(message.session) && id(message.id) && typeof message.name === 'string' && message.name.length > 0 && message.name.length <= 100 && object(message.args);
      const validCancel = message.type === 'cancel' && keys(message, ['type', 'session', 'id']) && session(message.session) && id(message.id);
      if (!validCall && !validCancel) return close();
      try { page.postMessage(message); } catch { close(); }
    }
    active.add(close);
    host.onMessage.addListener(fromHost);
    host.onDisconnect.addListener(close);
  }

  api.runtime.onConnect.addListener(connect);
  return () => {
    api.runtime.onConnect.removeListener?.(connect);
    for (const close of active) close();
  };
}
