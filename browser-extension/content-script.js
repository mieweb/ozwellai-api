/* The extension owns only this shell. ozwell serves the widget and sign-in UI. */
(() => {
  if (globalThis.__ozwellExtension) {
    globalThis.__ozwellExtension.refresh();
    return;
  }

  let host, launcher, panel, frame, status, fallback, widget, loadTimer;
  let ready = false;
  let revision = 0;

  function pinnedWidget(value) {
    try {
      const origin = new URL(value.origin);
      const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
      if (origin.origin !== value.origin || (origin.protocol !== 'https:' && !local)) return null;
      const frameUrl = new URL(value.frameUrl);
      const endpoint = new URL(value.endpoint);
      if (frameUrl.origin !== origin.origin || endpoint.origin !== origin.origin) return null;
      return { origin: origin.origin, frameUrl: frameUrl.href, endpoint: endpoint.href };
    } catch {
      return null;
    }
  }

  function teardown() {
    clearTimeout(loadTimer);
    host?.remove();
    host = launcher = panel = frame = status = fallback = null;
    ready = false;
  }

  function post(message) {
    frame?.contentWindow?.postMessage(message, widget.origin);
  }

  function sendConfig() {
    post({
      source: 'ozwell-chat-parent',
      type: 'config',
      payload: {
        config: {
          endpoint: widget.endpoint,
          title: 'ozwell',
          thinkingEnabled: false,
          tools: [],
        },
      },
    });
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', 'Open ozwell assistant');
    launcher.focus();
  }

  function showLoadError() {
    if (!status || ready) return;
    status.firstElementChild.textContent = 'ozwell could not load here. Try opening it directly.';
    fallback.hidden = false;
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    launcher.setAttribute('aria-label', 'Close ozwell assistant');
    panel.querySelector('button').focus();
    if (frame) return;

    frame = document.createElement('iframe');
    frame.title = 'ozwell assistant';
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.addEventListener('error', showLoadError);
    frame.src = widget.frameUrl;
    panel.appendChild(frame);
    // A blocked frame or a server 404 may still fire `load`. Require widget ready.
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

  function update(enabled, value) {
    const nextWidget = pinnedWidget(value);
    if (!enabled || !nextWidget) {
      teardown();
      widget = null;
      return;
    }
    if (widget && (widget.origin !== nextWidget.origin || widget.frameUrl !== nextWidget.frameUrl || widget.endpoint !== nextWidget.endpoint)) teardown();
    widget = nextWidget;
    if (!host) render();
  }

  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== widget.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source === 'ozwell-chat-widget') {
      if (data.type === 'ready' || data.type === 'request-config') {
        ready = true;
        clearTimeout(loadTimer);
        status.hidden = true;
        frame.hidden = false;
        sendConfig();
      } else if (data.type === 'closed') close();
      return;
    }
    if (data.jsonrpc !== '2.0' || typeof data.method !== 'string' || data.id == null) return;
    const reply = { jsonrpc: '2.0', id: data.id };
    switch (data.method) {
      case 'initialize':
        reply.result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'ozwell-browser-extension', version: '0.1.0' },
        };
        break;
      case 'tools/list': reply.result = { tools: [] }; break;
      case 'ping': reply.result = {}; break;
      default: reply.error = { code: -32601, message: 'No page tools are exposed by this extension.' };
    }
    post(reply);
  });

  async function refresh() {
    const requestedRevision = ++revision;
    try {
      const state = await chrome.runtime.sendMessage({ type: 'ozwell:get-state' });
      if (requestedRevision === revision) update(state?.tab?.enabled, state?.widget);
    } catch {
      if (requestedRevision === revision) teardown();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender && sender.id !== chrome.runtime.id) return;
    if (message?.type !== 'ozwell:sync') return;
    revision++;
    update(message.enabled, message.widget);
  });
  globalThis.__ozwellExtension = { refresh };
  void refresh();
})();
