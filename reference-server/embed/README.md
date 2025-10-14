# Ozwell Chat Widget - Embed Bundle

## Quick Start

Add this to any HTML page to embed the chat widget:

```html
<script>
  window.OzwellChatConfig = {
    widgetUrl: 'https://ozwellai-reference-server.opensource.mieweb.org/embed/widget.html',
    endpoint: 'https://ozwellai-reference-server.opensource.mieweb.org/embed/chat'
  };
</script>
<script async src="https://ozwellai-reference-server.opensource.mieweb.org/embed/embed.js"></script>
```

The widget auto-mounts an iframe and is ready to chat.

## Configuration

`window.OzwellChatConfig` accepts:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `widgetUrl` or `src` | string | `/embed/widget.html` | URL to the widget iframe |
| `endpoint` | string | `/embed/chat` | Chat API endpoint |
| `containerId` | string | (none) | Optional DOM element ID to mount in (defaults to `<body>`) |
| `title` | string | `'Ozwell Assistant'` | Widget title |
| `placeholder` | string | `'Ask a question...'` | Input placeholder text |
| `model` | string | `'llama3'` | Model name for chat requests |

## Endpoints

**Widget Assets (GET):**
- `/embed/embed.js` - Loader script that creates the iframe
- `/embed/widget.html` - Widget iframe content
- `/embed/widget.js` - Widget logic
- `/embed/widget.css` - Widget styles

**Chat API (POST):**
- `/embed/chat` - Receives `{ message: string, model: string }`, streams back responses
  - Proxies to Ollama at `localhost:11434` when available, falls back to text generator
- `/mock/chat` - Keyword-based responses for demos (no LLM dependencies)

## Architecture

1. **embed.js** loads on the parent page, reads `window.OzwellChatConfig`, and mounts an iframe
2. **widget.html** renders inside the iframe with the chat UI
3. Parent ↔ widget communicate via `postMessage`
4. Widget sends user input to the `/embed/chat` endpoint via fetch

## Events

Listen for these custom events on `document`:

```javascript
document.addEventListener('ozwell-chat-ready', () => {
  console.log('Widget is ready');
});

document.addEventListener('ozwell-chat-insert', (event) => {
  console.log('Save & Close:', event.detail.text);
});

document.addEventListener('ozwell-chat-closed', () => {
  console.log('Widget closed');
});
```

## API Usage

Access the widget API via `window.OzwellChat`:

```javascript
// Wait for widget to be ready
await window.OzwellChat.ready();

// Update config at runtime
window.OzwellChat.configure({ model: 'gpt-4' });

// Access the iframe
console.log(window.OzwellChat.iframe);
```

## Live Demo

https://ozwellai-embedtest.opensource.mieweb.org

The demo includes:
- Mock AI mode (default): Keyword-based pattern matching via `/mock/chat` endpoint
- Ollama mode: Real LLM via `/embed/chat` endpoint (proxies to Ollama)
- Switch modes by editing one line in the HTML source

See [embed-test README](../../embed-test/README.md) for full documentation.
