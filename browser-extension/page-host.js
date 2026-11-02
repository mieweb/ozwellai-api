import { WIDGET } from './config.js';
import { createWidgetHost } from './widget-host.js';
import { createPageHostConnection } from './page-connection.js';

// The website is deliberately never a messaging peer. Its postMessage events
// cannot configure the widget, supply tools, submit a prompt, or receive results.
const container = document.querySelector('#chat');
const token = new URLSearchParams(location.hash.slice(1)).get('token');
if (!/^[a-f0-9]{32}$/.test(token || '')) {
  container.textContent = 'Open ozwell from the extension page launcher.';
} else {
  let connection;
  const chat = createWidgetHost(container, {
    onDocumentChange: ({ active }) => {
      if (!active) { connection?.dispose(); connection = null; }
      else if (!connection || connection.disposed) connect();
    },
    getTools: options => connection?.getTools(options) ?? [],
    callTool: (name, args, options) => connection.callTool(name, args, options),
    isAuthorized: () => Boolean(connection && !connection.disposed),
  });
  function connect() {
    connection = createPageHostConnection(token, { onStateChange: () => { void chat.refreshTools(); } });
  }
  connect();
  container.textContent = 'Connecting to this page…';
  void connection.getTools().then(() => {
    if (connection.disposed) {
      container.textContent = 'Open ozwell from the extension page launcher.';
      return;
    }
    container.textContent = '';
    // Do not load credential-bearing chat for an unissued page-host token.
    // Both destinations come only from the packaged extension configuration.
    chat.mount(WIDGET);
  });
  window.addEventListener('pagehide', () => { connection?.dispose(); chat.destroy(); });
}
