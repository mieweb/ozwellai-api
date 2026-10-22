/* The website gets only an extension-owned frame; chat trusts that frame. */
(() => {
  if (globalThis.__ozwellExtension) { globalThis.__ozwellExtension.refresh(); return; }
  let host, launcher, panel, frame, status, fallback, widget, loadTimer, hostToken;
  let revision = 0, powered = false, launcherEnabled = false, navigationTimer;
  const ports = new Set();
  const currentUrl = () => globalThis.location?.href || window.location?.href || '';
  const token = () => [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16).padStart(8, '0')).join('');
  let observedUrl = currentUrl();

  function stopWatching() {
    if (ports.size) return;
    globalThis.clearInterval?.(navigationTimer);
    navigationTimer = null;
  }
  function checkNavigation() {
    if (currentUrl() === observedUrl) return;
    observedUrl = currentUrl();
    resetConnections();
    teardown();
    void refresh();
  }
  function watchNavigation() {
    observedUrl = currentUrl();
    if (!navigationTimer && globalThis.setInterval) navigationTimer = setInterval(checkNavigation, 250);
  }
  async function authorized(url, requireLauncher) {
    if (currentUrl() !== url) return false;
    const stamp = revision;
    const state = await chrome.runtime.sendMessage({ type: 'ozwell:get-state' });
    if (stamp === revision) powered = state?.settings?.mode !== 'off' && Boolean(state?.settings);
    return powered && state?.settings?.mode !== 'off' && state?.tab?.url === url
      && currentUrl() === url && (!requireLauncher || (launcherEnabled && state?.tab?.enabled));
  }
  function resetConnections() { for (const connection of [...ports]) connection.dispose(); }
  function hostedOpen() { return Boolean(powered && launcherEnabled && frame && panel && !panel.hidden && hostToken); }

  chrome.runtime.onConnect?.addListener(port => {
    const popup = port.name === 'ozwell:page-tools' && port.sender?.id === chrome.runtime.id
      && port.sender?.url === chrome.runtime.getURL('popup.html');
    const hosted = port.name === 'ozwell:hosted-page-tools' && port.sender?.id === chrome.runtime.id
      && !port.sender?.tab && (!port.sender?.url || port.sender.url === chrome.runtime.getURL('background.js'));
    if (!popup && !hosted) { port.disconnect(); return; }
    const connection = { active: true, authenticated: false, hosted, pending: new Map(), factory: null, session: null, url: currentUrl(), epoch: 0, dispose, suspend, resume };
    ports.add(connection);
    watchNavigation();
    const allowed = () => connection.active && powered && currentUrl() === connection.url && (!hosted || hostedOpen());
    const send = message => { if (connection.active) try { port.postMessage(message); } catch { dispose(); } };
    function stopWork() {
      connection.epoch++;
      for (const request of connection.pending.values()) { clearTimeout(request.timer); request.controller.abort(); }
      connection.pending.clear();
      connection.factory?.dispose();
      connection.factory = null;
    }
    function dispose() {
      if (!connection.active) return;
      connection.active = false;
      stopWork();
      ports.delete(connection);
      try { port.disconnect(); } catch { /* Already disconnected. */ }
      stopWatching();
    }
    function sendReady() {
      send({ type: 'ready', session: connection.session, url: connection.url, tools: connection.factory?.tools || [] });
    }
    function suspend() {
      if (!connection.active || !connection.authenticated) return;
      stopWork();
      connection.session = token();
      sendReady();
    }
    async function resume() {
      if (!connection.active || !connection.authenticated) return;
      stopWork();
      const epoch = connection.epoch;
      connection.session = token();
      if (!allowed()) { sendReady(); return; }
      try {
        if (!await authorized(connection.url, hosted) || !allowed() || epoch !== connection.epoch) return;
        connection.factory = globalThis.__ozwellCreatePageTools?.({ root: document.body, isAuthorized: allowed });
      } catch { /* Ordinary chat remains available if page tools cannot start. */ }
      if (connection.active && epoch === connection.epoch) sendReady();
    }
    port.onDisconnect.addListener(dispose);
    port.onMessage.addListener(async message => {
      if (!connection.active || !message || typeof message !== 'object') return;
      if (message.type === 'hello' && !connection.session) {
        if (popup ? message.url !== connection.url : !hostToken || message.token !== hostToken || !Number.isInteger(message.frameId) || message.frameId < 1) return dispose();
        connection.authenticated = true;
        connection.session = 'initializing';
        if (hosted) return resume();
        try {
          if (!await authorized(connection.url, false) || !allowed() || !globalThis.__ozwellCreatePageTools) return dispose();
          connection.factory = globalThis.__ozwellCreatePageTools({ root: document.body, isAuthorized: allowed });
          connection.session = token();
          sendReady();
        } catch { dispose(); }
        return;
      }
      if (!connection.factory || message.session !== connection.session || !Number.isInteger(message.id)) return;
      if (message.type === 'cancel') {
        const request = connection.pending.get(message.id);
        if (request) { clearTimeout(request.timer); request.controller.abort(); connection.pending.delete(message.id); }
        return;
      }
      if (message.type !== 'call' || connection.pending.has(message.id)) return;
      const request = { controller: new AbortController() };
      connection.pending.set(message.id, request);
      const finish = (result, error) => {
        if (!connection.active || connection.pending.get(message.id) !== request || request.controller.signal.aborted) return;
        clearTimeout(request.timer);
        connection.pending.delete(message.id);
        send({ type: error ? 'error' : 'result', session: connection.session, id: message.id,
          ...(error ? { error: { message: error.message || 'Page tool failed.' } } : { result }) });
      };
      request.timer = setTimeout(() => { finish(null, new Error('Page tool timed out.')); request.controller.abort(); }, 29000);
      try {
        if (!await authorized(connection.url, hosted) || !allowed()) throw new Error('Page access ended.');
        if (request.controller.signal.aborted) return;
        const result = await connection.factory.callTool(message.name, message.args, { signal: request.controller.signal });
        if (allowed()) finish(result);
      } catch (error) { finish(null, error); }
    });
  });
  window.addEventListener('popstate', checkNavigation);
  window.addEventListener('hashchange', checkNavigation);

  function pinnedWidget(value) {
    try {
      const origin = new URL(value.origin);
      const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
      if (origin.origin !== value.origin || (origin.protocol !== 'https:' && !local)) return null;
      const frameUrl = new URL(value.frameUrl), endpoint = new URL(value.endpoint);
      if (frameUrl.origin !== origin.origin || endpoint.origin !== origin.origin) return null;
      return { origin: origin.origin, frameUrl: frameUrl.href, endpoint: endpoint.href };
    } catch { return null; }
  }
  function teardown() {
    for (const connection of [...ports]) if (connection.hosted) connection.dispose();
    clearTimeout(loadTimer);
    host?.remove();
    host = launcher = panel = frame = status = fallback = hostToken = null;
  }
  function close() {
    if (!panel) return;
    panel.hidden = true;
    for (const connection of ports) if (connection.hosted) connection.suspend();
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', 'Open ozwell assistant');
    launcher.focus();
  }
  function showLoadError() {
    if (!status || frame && !frame.hidden) return;
    status.firstElementChild.textContent = 'ozwell could not load here. Try opening it directly.';
    fallback.hidden = false;
  }
  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    launcher.setAttribute('aria-label', 'Close ozwell assistant');
    panel.querySelector('button').focus();
    if (frame) { for (const connection of ports) if (connection.hosted) void connection.resume(); return; }
    hostToken = token();
    frame = document.createElement('iframe');
    frame.title = 'ozwell assistant';
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.addEventListener('error', showLoadError);
    const target = frame;
    frame.addEventListener('load', () => {
      if (frame !== target) return;
      clearTimeout(loadTimer);
      status.hidden = true;
      frame.hidden = false;
    });
    frame.src = `${chrome.runtime.getURL('page-host.html')}#token=${hostToken}`;
    panel.appendChild(frame);
    loadTimer = setTimeout(showLoadError, 12000);
  }
  function render() {
    host = document.createElement('div');
    host.id = 'ozwell-extension-root';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial !important; position: fixed !important; right: 20px !important;
        bottom: 20px !important; z-index: 2147483647 !important; color-scheme: light; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button, a { font: 14px/1.4 system-ui, sans-serif; }
      button { cursor: pointer; }
      button:focus-visible, a:focus-visible { outline: 3px solid #00aede; outline-offset: 3px; }
      .launcher { display: flex; align-items: center; gap: 7px; margin-left: auto;
        border: 1px solid #182958; border-radius: 26px; padding: 7px 16px 7px 8px;
        background: #101b46; color: white; box-shadow: 0 5px 20px #101b4633;
        font-size: 17px; font-weight: 700; letter-spacing: -.45px; }
      .launcher:hover { background: #1e2b58; }
      .launcher img { display: block; width: 32px; height: 32px; object-fit: contain; }
      .panel { position: absolute; right: 0; bottom: 60px; display: flex; flex-direction: column;
        width: min(380px, calc(100vw - 40px)); height: min(540px, calc(100dvh - 100px));
        min-height: 240px; overflow: hidden; border: 1px solid #e2e6f0; border-radius: 14px;
        background: white; box-shadow: 0 8px 32px #101b462b; font: 14px/1.5 system-ui, sans-serif; color: #101b46; }
      .header { display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; border-bottom: 1px solid #e8ebf4; background: #fafbff; }
      .header strong { display: flex; align-items: center; gap: 7px; font-size: 17px; letter-spacing: -.45px; }
      .header img { display: block; width: 28px; height: 28px; object-fit: contain; }
      .header button { border: 0; border-radius: 6px; background: transparent; color: #8793af;
        min-width: 36px; min-height: 36px; font-size: 22px; }
      .header button:hover { background: #eef1fa; color: #101b46; }
      .status { padding: 20px; color: #8290ab; }
      .status p { margin: 0 0 12px; }
      .status a { color: #009bc9; }
      iframe { width: 100%; flex: 1; min-height: 0; border: 0; background: white; }
    `;

    launcher = document.createElement('button');
    launcher.className = 'launcher';
    launcher.type = 'button';
    const launcherMascot = document.createElement('img');
    launcherMascot.src = chrome.runtime.getURL('assets/ozwell-48.png');
    launcherMascot.alt = '';
    const launcherWordmark = document.createElement('span');
    launcherWordmark.textContent = 'ozwell';
    launcher.append(launcherMascot, launcherWordmark);
    launcher.setAttribute('aria-label', 'Open ozwell assistant');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-controls', 'ozwell-extension-panel');
    launcher.addEventListener('click', () => panel.hidden ? open() : close());

    panel = document.createElement('section');
    panel.id = 'ozwell-extension-panel';
    panel.className = 'panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ozwell assistant');
    const header = document.createElement('div');
    header.className = 'header';
    const title = document.createElement('strong');
    const headerMascot = document.createElement('img');
    headerMascot.src = chrome.runtime.getURL('assets/ozwell-48.png');
    headerMascot.alt = '';
    const titleWordmark = document.createElement('span');
    titleWordmark.textContent = 'ozwell';
    title.append(headerMascot, titleWordmark);
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close ozwell assistant');
    closeButton.addEventListener('click', close);
    header.append(title, closeButton);

    status = document.createElement('div');
    status.className = 'status';
    status.setAttribute('role', 'status');
    const loading = document.createElement('p');
    loading.textContent = 'Loading ozwell…';
    fallback = document.createElement('a');
    fallback.textContent = 'Open ozwell';
    fallback.href = widget.frameUrl;
    fallback.target = '_blank';
    fallback.rel = 'noopener noreferrer';
    fallback.hidden = true;
    status.append(loading, fallback);
    panel.append(header, status);
    shadow.append(style, panel, launcher);
    shadow.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        event.preventDefault();
        close();
      }
    });
    document.documentElement.appendChild(host);
  }

  function update(enabled, value, isPowered = true, resetTools = false) {
    powered = Boolean(isPowered);
    launcherEnabled = Boolean(enabled && powered);
    if (!powered || resetTools) { resetConnections(); teardown(); }
    const nextWidget = pinnedWidget(value);
    if (!launcherEnabled || !nextWidget) { teardown(); widget = null; return; }
    if (widget && (widget.origin !== nextWidget.origin || widget.frameUrl !== nextWidget.frameUrl || widget.endpoint !== nextWidget.endpoint)) teardown();
    widget = nextWidget;
    if (!host) render();
  }
  // No website-window message channel: only authenticated extension ports can
  // reach the local host, and only that host is the remote widget's parent.
  async function refresh() {
    const requestedRevision = ++revision;
    try {
      const state = await chrome.runtime.sendMessage({ type: 'ozwell:get-state' });
      if (requestedRevision === revision) update(state?.tab?.enabled, state?.widget, state?.settings ? state.settings.mode !== 'off' : true);
    } catch {
      if (requestedRevision === revision) { powered = false; resetConnections(); teardown(); }
    }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender?.id !== chrome.runtime.id || message?.type !== 'ozwell:sync') return;
    revision++;
    update(message.enabled, message.widget, message.powered ?? powered, message.resetTools);
  });
  globalThis.__ozwellExtension = { refresh };
  void refresh();
})();
