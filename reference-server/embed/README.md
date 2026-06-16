# Ozwell Chat Widget

Add an AI chatbot to any website with one script tag.

## Basic Usage

Add this to your HTML:

```html
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

The chat button appears automatically in the bottom-right corner.

**How it works:** The widget auto-detects where the script was loaded from and uses that as the base URL for the chat endpoint and widget files. Works with any hosting setup!

## With Configuration

Customize the widget with `window.OzwellChatConfig`:

```html
<script>
  window.OzwellChatConfig = {
    welcomeMessage: 'Hi! How can I help you today?',
    system: 'You are a helpful assistant.'
  };
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

## With Custom UI

Use your own button and layout by disabling the default floating button:

```html
<!-- Your custom container -->
<div id="my-chat-container" style="width: 100%; height: 500px;"></div>

<script>
  window.OzwellChatConfig = {
    defaultUI: false,              // Disable default floating button
    containerId: 'my-chat-container'
  };
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

**How it works:** Setting `defaultUI: false` disables the automatic floating button and wrapper. The widget iframe mounts directly in your custom container instead.

**Use cases:** Sidebar layouts, embedded chat in dashboards, multi-panel UIs, or any design where you want full control over the chat placement and styling.

## Getting Text Back into the Page

Use the AI to improve text, then have it write the result back into a textarea. Expose a tool the AI can call with the improved text — the page writes it where it belongs:

```html
<textarea id="my-note">Write something...</textarea>

<script>
  window.OzwellChatConfig = {
    tools: [
      {
        type: 'function',
        function: {
          name: 'update_note',
          description: 'Write improved text back into the note field',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The improved text to insert' }
            },
            required: ['text']
          }
        }
      }
    ]
  };

  document.addEventListener('ozwell-tool-call', (event) => {
    const { name, arguments: args, respond } = event.detail;
    if (name !== 'update_note') return;

    document.getElementById('my-note').value = args.text;
    respond({ success: true });
  });
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

**How it works:** User asks the AI to improve their text. The AI calls `update_note` with the improved text, and the page writes it into the textarea. The page controls exactly where text lands — nothing is inserted without an explicit tool call.

**Use cases:** Draft emails, improve notes, generate summaries, rewrite content — anytime you want AI help writing into a specific field.

## Two Ways to Configure Tools and Behavior

The widget can be configured in two complementary ways. You can use either or both.

**Page-side config** — declare everything in `OzwellChatConfig` on the host page:

```html
<script>
  window.OzwellChatConfig = {
    apiKey: 'agnt_key-...',     // or 'ozw_...' parent key
    tools: [ /* page tools, handled via ozwell-tool-call */ ]
  };
</script>
```

Page tools act on the host page (read inputs, update fields). The page owns the schema and the handler. This is what every tool example below uses.

**Server-side agent config** — an agent key (`agnt_key-...`) points at an agent stored on the reference server. The agent's YAML supplies the system prompt, model, temperature, and its own server-side tools. The widget discovers all of it automatically through an MCP handshake (`GET /v1/agents/me`) — the page only passes the key:

```html
<script>
  window.OzwellChatConfig = {
    apiKey: 'agnt_key-your-agent-key'
    // no tools / model / prompt needed — the agent provides them
  };
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

**They combine.** When you use an agent key *and* declare page-side `tools`, both sets are offered to the model: the agent's server-side tools plus the page tools (the loader prefixes page tools so the server can tell them apart). Use the agent for prompt/model/shared tools, and page-side `tools` for anything that must run in the browser.

## Reading Page Context With Tools

Expose current page data as a tool so the AI can request it when needed:

```html
<input id="user-name" value="Alice">
<input id="user-email" value="alice@example.com">

<script>
  window.OzwellChatConfig = {
    ...window.OzwellChatConfig,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_form_data',
          description: 'Read the current form values',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      }
    ]
  };

  document.addEventListener('ozwell-tool-call', (event) => {
    const { name, respond } = event.detail;
    if (name !== 'get_form_data') return;

    respond({
      name: document.getElementById('user-name').value,
      email: document.getElementById('user-email').value
    });
  });
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

Now users can ask: "What's my name?" and the AI responds: "Your name is Alice."

**How it works:** The tool schema tells the AI what page data it can request. When the AI calls the tool, the page responds with the current values through the `ozwell-tool-call` event.

## With MCP Tools

Enable page interactions using MCP tools (OpenAI function calling format). The loader handles the MCP JSON-RPC protocol — your page listens for `ozwell-tool-call` DOM events:

```html
<input id="user-email" type="email" placeholder="Enter email">

<script>
  window.OzwellChatConfig = {
    ...window.OzwellChatConfig,
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

  // Handle tool calls via DOM event (loader handles JSON-RPC automatically)
  document.addEventListener('ozwell-tool-call', (e) => {
    const { name, arguments: args, respond } = e.detail;

    if (name === 'update_email') {
      document.getElementById('user-email').value = args.email;
      respond({ success: true, updated: { email: args.email } });
    }
  });
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

The `tools[].function` object above is a schema only. Actual JavaScript execution stays in your `ozwell-tool-call` event listener.

Now users can type: "update my email to john@example.com" and the field updates automatically.

## Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `autoMount` | boolean | `true` | Auto-mount widget on page load |
| `defaultUI` | boolean | `true` | Enable default floating button and wrapper. Set to `false` to use custom UI |
| `endpoint` | string | (auto-detected) | Chat API endpoint (auto-detected from script URL) |
| `widgetUrl` | string | (auto-detected) | Widget iframe URL (auto-detected from script URL) |
| `model` | string | (server default) | Model name to use for chat completions. **Optional** - if not specified, the server chooses the appropriate model |
| `system` | string | `'You are a helpful assistant.'` | System prompt for the AI |
| `tools` | array | `[]` | MCP tools in OpenAI function calling format |
| `welcomeMessage` | string | (none) | Initial greeting message displayed in chat |
| `placeholder` | string | `'Ask a question...'` | Input field placeholder text |
| `title` | string | `'Ozwell Assistant'` | Widget header title |
| `headers` | object | `{}` | Custom HTTP headers for API requests |
| `openaiApiKey` | string | `'default'` | Bearer token for Authorization header |
| `containerId` | string | (none) | DOM element ID to mount widget in (default: body) |
| `debug` | boolean | `false` | Show tool execution details (developer mode). Display clickable pills showing tool arguments and results |
| `autoOpenOnReply` | boolean | `false` | Auto-open chat window when AI responds while chat is closed. When `false`, shows wiggle animation and badge instead |

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

### OzwellChat.configure(config)

Update configuration at runtime. Applies immediately to mounted widget.

```javascript
OzwellChat.configure({
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

### OzwellChat.open()

Programmatically open the chat window. Clears any unread notifications.

```javascript
OzwellChat.open();
```

### OzwellChat.close()

Programmatically close/hide the chat window.

```javascript
OzwellChat.close();
```

### OzwellChat.isOpen

Check if the chat window is currently open.

```javascript
if (OzwellChat.isOpen) {
  console.log('Chat is visible');
}
```

### OzwellChat.hasUnread

Check if there are unread messages (badge is showing).

```javascript
if (OzwellChat.hasUnread) {
  console.log('User has unread messages');
}
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
    autoMount: false
  };
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>

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

The reference server automatically detects and routes to the best available backend. Use an agent key or parent API key for authentication:

```html
<script>
  window.OzwellChatConfig = {
    apiKey: 'agnt_key-your-agent-key'  // or 'ozw_your-parent-key'
  };
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

To use Ollama as the backend, configure the server's `.env` file — set `OLLAMA_BASE_URL` (and optionally `OLLAMA_MODEL`). No client-side changes needed; the widget talks to the reference server and the server handles backend routing. See `../.env.example` for details.

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
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
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
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

## MCP Tool Flow

The widget uses MCP JSON-RPC 2.0 over postMessage. The loader handles the protocol; your page only sees DOM events.

1. On load, loader sends `initialize` (JSON-RPC 2.0) to parent, then `tools/list` to discover available tools
2. User sends message: "update my email to test@example.com"
3. LLM responds with `tool_calls`
4. Loader sends `tools/call` JSON-RPC request to parent AND dispatches `ozwell-tool-call` DOM event on `document`
5. Your event listener calls `e.detail.respond(result)` — loader sends the JSON-RPC response automatically
6. Widget forwards result to LLM
7. LLM responds: "Done! I've updated your email to test@example.com"

**Note:** If you're not using `ozwell-loader.js` and are communicating with the widget iframe directly, use raw JSON-RPC 2.0 postMessages matching the `tools/call` request ID.

## PostMessage Events Reference

The widget communicates with the parent page via `postMessage`. This enables programmatic control and MCP tool integration.

### Parent → Widget Messages

Messages sent from the parent page to the widget iframe. All messages require `source: 'ozwell-chat-parent'`.

| Type | Payload | Description |
|------|---------|-------------|
| `ozwell:send-message` | `{ content: string }` | Send a chat message programmatically (appears as user message, triggers AI response) |
| `config` | `{ config: OzwellChatConfig }` | Update widget configuration at runtime |
| `close` | — | Close/hide the chat widget |

#### Sending a Message Programmatically

Use `ozwell:send-message` to inject messages as if the user typed them. This is useful for:

- Triggering AI responses based on page events
- Automating conversations
- Building game AI that responds to user actions

```javascript
// Send a message as if the user typed it
OzwellChat.iframe.contentWindow.postMessage({
  source: 'ozwell-chat-parent',
  type: 'ozwell:send-message',
  payload: { content: 'Hello, AI!' }
}, '*');
```

#### Message Queuing

The widget supports message queuing - users can send messages while the AI is still responding. Queued messages appear as dotted-outline bubbles and can be edited or cancelled before being sent.

**How it works:**

1. While AI is streaming a response, user types and clicks Send
2. Message appears as a queued bubble (dotted blue outline) with edit/cancel icons
3. User can click the pencil icon to edit the message inline
4. When AI finishes responding, the queued message is automatically sent
5. User can cancel the queued message by clicking the X icon

This enables smooth back-and-forth conversations without waiting, and is especially useful for:

- Interactive games (like tic-tac-toe) where the user can make moves immediately
- Fast-paced conversations where users know their next response
- Programmatic message sending via `ozwell:send-message` during tool execution

#### Returning Tool Results

After receiving an `ozwell-tool-call` DOM event, call `respond()` from the event detail:

```javascript
document.addEventListener('ozwell-tool-call', (e) => {
  const { name, arguments: args, respond } = e.detail;
  // execute the tool, then:
  respond({ success: true, result: { action: name, completed: true } });
});
```

The loader automatically sends the correct JSON-RPC 2.0 response back to the widget. The widget then appends that result as a `tool` message and sends it back to the model, matching OpenAI-style tool continuation.

If the page never calls `respond()` or `error()`, the loader returns a normal tool error after a timeout so one missing handler does not leave the widget waiting forever.

### Widget → Parent Messages

Messages sent from the widget iframe to the parent page. All messages include `source: 'ozwell-chat-widget'`.

| Type | Payload | Description |
|------|---------|-------------|
| `ready` | — | Widget fully initialized and ready to receive messages |
| `tool_call` | MCP JSON-RPC 2.0 request | Request parent to execute an MCP tool (use `ozwell-tool-call` DOM event instead) |
| `assistant_response` | `{ hadToolCalls }` | AI assistant finished responding (signal only, no message content) |
| `insert` | `{ text }` | User clicked "Save & Close" button |
| `closed` | — | Widget was closed |

#### Listening for Tool Calls

Use the `ozwell-tool-call` DOM event (recommended) instead of raw postMessage:

```javascript
document.addEventListener('ozwell-tool-call', (e) => {
  const { name, arguments: args, respond } = e.detail;
  console.log(`Tool requested: ${name}`, args);
  // Execute the tool, then call respond() with the result
  respond({ success: true });
});
```

> **Note:** The loader handles MCP JSON-RPC 2.0 and origin validation automatically. Only use raw `postMessage` listeners if you're not using `ozwell-loader.js`.

#### Listening for Widget Ready

```javascript
window.addEventListener('message', (event) => {
  if (event.data?.source === 'ozwell-chat-widget' && event.data.type === 'ready') {
    console.log('Widget is ready!');
    // Now safe to send messages to widget
  }
});
```

### DOM Events

The loader also dispatches CustomEvents on `document` for convenience:

| Event | Detail | Description |
|-------|--------|-------------|
| `ozwell-tool-call` | `{ name, arguments, respond, error }` | AI invoked a page tool — call `respond(result)` or `error(message)` |
| `ozwell-chat-ready` | — | Widget fully initialized and ready |
| `ozwell-chat-closed` | — | Chat window was closed |
| `ozwell-chat-unread` | — | AI responded while chat was closed (notification triggered) |

```javascript
document.addEventListener('ozwell-tool-call', (event) => {
  const { name, arguments: args, respond } = event.detail;
  console.log('AI called tool:', name, args);
  respond({ success: true });
});
```

## Unread Notifications

When the chat window is closed and the AI responds, the widget shows a notification:

- **Wiggle animation** - The chat button wiggles to attract attention
- **Red badge** - A dot appears on the button indicating unread messages
- **Auto-clear** - Badge and animation clear when the user opens the chat

### Default Behavior (wiggle + badge)

```html
<script>
  window.OzwellChatConfig = {
    // autoOpenOnReply defaults to false
    // Widget will wiggle and show badge when AI responds
  };
</script>
```

### Auto-Open Behavior

Set `autoOpenOnReply: true` to automatically open the chat when AI responds:

```html
<script>
  window.OzwellChatConfig = {
    autoOpenOnReply: true  // Chat opens automatically when AI replies
  };
</script>
```

### Listening for Unread Notifications

```javascript
document.addEventListener('ozwell-chat-unread', (event) => {
  console.log('New message:', event.detail.message);
  // Play a sound, show browser notification, etc.
});
```

**Note:** Tool calls do not trigger notifications. Only actual text responses from the AI trigger the wiggle/badge.

## Debug Mode

Enable debug mode during development to visualize tool executions:

```html
<script>
  window.OzwellChatConfig = {
    debug: true  // Shows tool execution details
  };
</script>
<script src="https://ozwellapi-prod.os.mieweb.org/embed/ozwell-loader.js"></script>
```

**How it works:** Clickable tool pills appear before AI responses. Click a pill to expand and see:

- Tool name and arguments sent
- Result data returned from parent page
- Complete execution timeline

**Use cases:** Debugging tool integrations, verifying correct arguments, demonstrating MCP to stakeholders.

In production (`debug: false`, default), tools execute silently and users only see the final response.

## Mobile Support

The widget automatically provides a native app experience on mobile devices:

- Fullscreen mode (no borders or margins)
- Proper viewport scaling (injects meta tag if missing)
- Safe area support for iPhone notches and Android nav bars
- 16px input font (prevents iOS auto-zoom)

The widget handles all mobile optimizations automatically.

## Live Demo

- **Demo:** <https://tryozwell.os.mieweb.org>
- **Reference Server:** <https://ozwellapi-prod.os.mieweb.org>

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
