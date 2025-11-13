# Ozwell Chat Widget

Add an AI chatbot to any website with one script tag.

## Basic Usage

Add this to your HTML:

```html
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

The chat button appears automatically in the bottom-right corner.

**How it works:** The widget auto-detects where the script was loaded from and uses that as the base URL for the chat endpoint and widget files. Works with any hosting setup!

## With Configuration

Customize the widget with `window.OzwellChatConfig`:

```html
<script>
  window.OzwellChatConfig = {
    model: 'llama3',
    welcomeMessage: 'Hi! How can I help you today?',
    system: 'You are a helpful assistant.'
  };
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

## Providing Page Context

Send page data to the widget so the AI can answer questions about current state:

```html
<input id="user-name" value="Alice">
<input id="user-email" value="alice@example.com">

<script>
  window.OzwellChatConfig = { model: 'llama3' };

  // Send context when inputs change
  function updateContext() {
    OzwellChat.updateContext({
      formData: {
        name: document.getElementById('user-name').value,
        email: document.getElementById('user-email').value
      }
    });
  }

  // Wait for widget to load, then send initial context and listen for changes
  document.addEventListener('DOMContentLoaded', () => {
    OzwellChat.ready().then(() => {
      updateContext();
      document.getElementById('user-name').addEventListener('input', updateContext);
      document.getElementById('user-email').addEventListener('input', updateContext);
    });
  });
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

Now users can ask: "What's my name?" and the AI responds: "Your name is Alice."

**How it works:** Context is included in the system prompt for every message, so the AI always sees current page state.

## With MCP Tools

Enable page interactions using MCP tools (OpenAI function calling format):

```html
<input id="user-email" type="email" placeholder="Enter email">

<script>
  window.OzwellChatConfig = {
    tools: [
      {
        type: 'function',
        function: {
          name: 'update_email',
          description: 'Updates the email field',
          parameters: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Email address' }
            },
            required: ['email']
          }
        }
      }
    ]
  };

  // Handle tool calls from widget
  window.addEventListener('message', (event) => {
    if (event.data.source === 'ozwell-chat-widget' && event.data.type === 'tool_call') {
      const { tool, payload } = event.data;

      if (tool === 'update_email') {
        document.getElementById('user-email').value = payload.email;

        // Send result back to widget
        window.OzwellChat.iframe.contentWindow.postMessage({
          source: 'ozwell-chat-parent',
          type: 'tool_result',
          result: { success: true, message: 'Email updated successfully' }
        }, '*');
      }
    }
  });
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

Now users can type: "update my email to john@example.com" and the field updates automatically.

## Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `autoMount` | boolean | `true` | Auto-mount widget on page load |
| `endpoint` | string | (auto-detected) | Chat API endpoint (auto-detected from script URL) |
| `widgetUrl` | string | (auto-detected) | Widget iframe URL (auto-detected from script URL) |
| `model` | string | `'llama3'` | Model name to use for chat completions |
| `system` | string | `'You are a helpful assistant.'` | System prompt for the AI |
| `tools` | array | `[]` | MCP tools in OpenAI function calling format |
| `welcomeMessage` | string | (none) | Initial greeting message displayed in chat |
| `placeholder` | string | `'Ask a question...'` | Input field placeholder text |
| `title` | string | `'Ozwell Assistant'` | Widget header title |
| `headers` | object | `{}` | Custom HTTP headers for API requests |
| `openaiApiKey` | string | (none) | API key for Authorization header |
| `containerId` | string | (none) | DOM element ID to mount widget in (default: body) |

## API Reference

### OzwellChat.mount(options)

Manually mount the widget. Called automatically unless `autoMount: false`.

```javascript
OzwellChat.mount({
  containerId: 'chat-container',  // Mount in specific element
  width: 400,                      // Widget width in pixels
  height: 500                      // Widget height in pixels
});
```

### OzwellChat.updateContext(data)

Send page state to the widget. Context is included in system prompt for every message.

```javascript
OzwellChat.updateContext({
  formData: {
    name: 'Alice',
    email: 'alice@example.com'
  }
});
```

### OzwellChat.configure(config)

Update configuration at runtime. Applies immediately to mounted widget.

```javascript
OzwellChat.configure({
  model: 'llama3.1',
  system: 'You are a helpful coding assistant.'
});
```

### OzwellChat.ready()

Returns a Promise that resolves when the widget is fully loaded and ready.

```javascript
await OzwellChat.ready();
console.log('Widget is ready!');
```

### OzwellChat.iframe

Access the widget's iframe element directly.

```javascript
console.log('Widget iframe:', OzwellChat.iframe);
```

## Advanced Usage

### Manual Mount

Disable auto-mount and control when/where the widget appears. Useful for:
- **SPAs (React/Vue/Angular):** Mount after your component renders
- **Lazy loading:** Improve initial page load performance
- **Conditional display:** Show chat only to logged-in users
- **Custom container:** Embed in sidebar instead of floating button

```html
<div id="chat-sidebar"></div>

<script>
  window.OzwellChatConfig = {
    autoMount: false,
    model: 'llama3'
  };
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>

<script>
  // Mount when user clicks button
  document.getElementById('show-chat-btn').addEventListener('click', () => {
    OzwellChat.mount({
      containerId: 'chat-sidebar',
      width: 350,
      height: 600
    });
  });
</script>
```

### Using with Ollama

Route requests to your Ollama instance using custom headers:

```html
<script>
  window.OzwellChatConfig = {
    model: 'llama3.1',
    endpoint: 'https://your-server.com/v1/chat/completions',
    headers: {
      'Authorization': 'Bearer ollama'
    }
  };
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

The reference server detects `Authorization: Bearer ollama` and proxies to Ollama automatically.

### Custom Authentication

Use `openaiApiKey` or custom headers for API authentication:

```html
<script>
  window.OzwellChatConfig = {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    openaiApiKey: 'sk-...',  // Sets Authorization: Bearer sk-...
    model: 'gpt-4o'
  };
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

Or use custom headers for any authentication scheme:

```html
<script>
  window.OzwellChatConfig = {
    endpoint: 'https://your-api.com/chat',
    headers: {
      'X-API-Key': 'your-key',
      'X-User-ID': '12345'
    }
  };
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

## MCP Tool Flow

1. User sends message: "update my email to test@example.com"
2. LLM responds with `tool_calls` in response
3. Widget sends `tool_call` event to parent via postMessage
4. Parent executes tool (updates input field)
5. Parent sends `tool_result` back to widget
6. Widget sends result to LLM for natural confirmation
7. LLM responds: "Done! I've updated your email to test@example.com"

## Live Demo

- **Demo:** https://ozwellai-embedtest.opensource.mieweb.org
- **Reference Server:** https://ozwellai-reference-server.opensource.mieweb.org

## Local Development

```bash
# Clone and run reference server
cd reference-server
npm install
npm run dev

# Use local endpoint in your HTML
<script>
  window.OzwellChatConfig = {
    endpoint: 'http://localhost:3000/v1/chat/completions'
  };
</script>
<script src="http://localhost:3000/embed/ozwell-loader.js"></script>
```
