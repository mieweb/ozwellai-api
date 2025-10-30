# Ozwell Chat Widget - Embed Bundle

## Quick Start

Add this to any HTML page to embed the chat widget:

```html
<script>
  window.OzwellChatConfig = {
    widgetUrl: 'https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell.html',
    endpoint: 'https://ozwellai-reference-server.opensource.mieweb.org/embed/chat'
  };
</script>
<script async src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

Call `window.OzwellChat.mount()` to initialize the widget iframe when ready.

## Configuration

`window.OzwellChatConfig` accepts:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `widgetUrl` or `src` | string | `/embed/ozwell.html` | URL to the widget iframe |
| `endpoint` | string | `/embed/chat` | Chat API endpoint |
| `containerId` | string | (none) | Optional DOM element ID to mount in (defaults to `<body>`) |
| `title` | string | `'Ozwell Assistant'` | Widget title |
| `placeholder` | string | `'Ask a question...'` | Input placeholder text |
| `model` | string | `'llama3'` | Model name for chat requests |
| `system` | string | `'You are a helpful assistant.'` | Custom system prompt |
| `tools` | array | `[]` | MCP tools for function calling (OpenAI format) |

## Endpoints

**Widget Assets (GET):**
- `/embed/ozwell-loader.js` - Loader script that creates the iframe
- `/embed/ozwell.html` - Widget iframe content
- `/embed/ozwell.js` - Widget logic
- `/embed/ozwell.css` - Widget styles

**Chat API (POST):**
- `/embed/chat` - Receives `{ message: string, model: string }`, streams back responses
  - Proxies to Ollama at `localhost:11434` when available, falls back to text generator
- `/mock/chat` - Keyword-based responses for demos (no LLM dependencies)

## Architecture

1. **ozwell-loader.js** loads on the parent page, reads `window.OzwellChatConfig`
2. Call `window.OzwellChat.mount()` to create the iframe
3. **ozwell.html** renders inside the iframe with the chat UI
4. Parent ↔ widget communicate via `postMessage`
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

## MCP Tool Calling Integration

The widget supports OpenAI-compatible function calling (MCP tools) via postMessage API.

### Tool Definition Format

Tools must follow the **OpenAI function calling format**:

```javascript
window.OzwellChatConfig = {
  // ... other config ...
  tools: [
    {
      type: 'function',
      function: {
        name: 'update_name',
        description: 'Updates the user name field',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The new name value'
            }
          },
          required: ['name']
        }
      }
    }
  ]
};
```

### postMessage Protocol

The widget communicates with the parent page using `postMessage` for tool execution.

#### 1. Widget → Parent: Tool Call Request

When the LLM returns a tool call, the widget sends:

```javascript
{
  source: 'ozwell-chat-widget',
  type: 'tool_call',
  tool: 'update_name',
  payload: { name: 'Bob' }
}
```

#### 2. Parent → Widget: Tool Result

After executing the tool, the parent must send back the result:

```javascript
widgetIframe.contentWindow.postMessage({
  source: 'ozwell-chat-parent',
  type: 'tool_result',
  result: {
    success: true,
    message: 'Name updated to "Bob"'
  }
}, '*');
```

Or on error:

```javascript
{
  source: 'ozwell-chat-parent',
  type: 'tool_result',
  result: {
    success: false,
    error: 'Field not found'
  }
}
```

### Complete Integration Example

```javascript
// 1. Define tools in config
window.OzwellChatConfig = {
  widgetUrl: '/embed/ozwell.html',
  endpoint: '/embed/chat',
  model: 'llama3.1:8b',
  tools: [
    {
      type: 'function',
      function: {
        name: 'update_name',
        description: 'Updates the user name field',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The new name value' }
          },
          required: ['name']
        }
      }
    }
  ]
};

// 2. Listen for tool calls from widget
window.addEventListener('message', (event) => {
  const { source, type, tool, payload } = event.data;

  if (source === 'ozwell-chat-widget' && type === 'tool_call') {
    console.log('Tool call received:', tool, payload);

    // Execute the tool
    if (tool === 'update_name') {
      const nameInput = document.querySelector('#name');
      nameInput.value = payload.name;

      // Send result back to widget
      const widgetIframe = document.querySelector('iframe[src*="ozwell.html"]');
      widgetIframe.contentWindow.postMessage({
        source: 'ozwell-chat-parent',
        type: 'tool_result',
        result: {
          success: true,
          message: `Name updated to "${payload.name}"`
        }
      }, '*');
    }
  }
});
```

### OpenAI Function Calling Protocol

The widget follows the complete OpenAI function calling protocol:

1. **First API call**: User message + tools → LLM returns `tool_calls`
2. **Widget executes**: Sends `tool_call` to parent via postMessage
3. **Parent responds**: Sends `tool_result` back to widget
4. **Second API call**: Widget sends conversation + tool result → LLM generates final response
5. **Widget displays**: Shows final response to user

This ensures the LLM receives tool execution results and can provide natural responses like:
- ✅ "Done! I've updated your name to Bob."
- ✅ "Your address is now 123 Oak Street."

Instead of just showing "Executing tool..." with no follow-up.

### Context Synchronization with iframe-sync

For dynamic form context, use iframe-sync to keep the widget updated:

```javascript
// Parent page: Sync form state to widget
const broker = new IframeSyncBroker();

function updateFormState() {
  broker.stateChange({
    formData: {
      name: document.getElementById('name').value,
      address: document.getElementById('address').value
    }
  });
}

// Call after tool execution to refresh widget context
toolHandlers.update_name = (args) => {
  document.getElementById('name').value = args.name;
  updateFormState(); // ← Sync updated values to widget
  sendToolResult({ success: true, message: 'Updated' });
};
```

The widget will receive updated context and include it in future API requests.

## Live Demo

https://ozwellai-embedtest.opensource.mieweb.org

The demo includes:
- Mock AI mode (default): Keyword-based pattern matching via `/mock/chat` endpoint
- Ollama mode: Real LLM via `/embed/chat` endpoint (proxies to Ollama)
- Switch modes by editing one line in the HTML source

See [landing-page README](../../landing-page/README.md) for full documentation.
