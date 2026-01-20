# CDN Embed Integration

The fastest way to add Ozwell to any website. No build step, no framework required — just a single script tag.

## Quick Start

Add this snippet to your HTML, just before the closing `</body>` tag:

```html
<script
  src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"
  data-api-key="ozw_scoped_xxxxxxxxxxxxxxxx"
  data-agent-id="agent_xxxxxxxx"
></script>
```

That's it! A chat widget will appear in the bottom-right corner of your page.

> **Note:** The `ozwellai-reference-server.opensource.mieweb.org` URL is the test/development server. For production deployments, use the official Ozwell domains (`cdn.ozwell.ai`, etc.) once configured.

---

## Getting Your Credentials

### 1. Create a Scoped API Key

1. Log in to your Ozwell dashboard
2. Navigate to **Settings → API Keys**
3. Click **Create Scoped Key**
4. Select the agent this key should access
5. Configure permissions (typically "Chat Only" for frontend use)
6. Copy the generated key (starts with `ozw_scoped_`)

### 2. Find Your Agent ID

1. Go to **Agents** in your dashboard
2. Click on the agent you want to embed
3. Copy the **Agent ID** from the settings panel

---

## Configuration Options

Customize the widget using `data-*` attributes on the script tag.

Alternatively, you can use `window.OzwellChatConfig` with the same options in camelCase (e.g., `data-api-key` becomes `apiKey`, `data-greeting` becomes `greeting`):

```html
<script>
  window.OzwellChatConfig = {
    apiKey: 'ozw_scoped_xxxxxxxxxxxxxxxx',
    agentId: 'agent_xxxxxxxx',
    greeting: 'Hi! How can I help you today?'
  };
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

### Data Attributes

Customize the widget using `data-*` attributes:

```html
<script
  src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"
  data-api-key="ozw_scoped_xxxxxxxxxxxxxxxx"
  data-agent-id="agent_xxxxxxxx"
  data-theme="dark"
  data-position="bottom-left"
  data-primary-color="#10b981"
  data-auto-open="false"
  data-greeting="Hi! How can I help you today?"
></script>
```

### Available Options

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `data-api-key` | string | *required* | Your scoped API key |
| `data-agent-id` | string | *required* | The agent ID to use |
| `data-theme` | `"light"` \| `"dark"` \| `"auto"` | `"auto"` | Color theme |
| `data-position` | `"bottom-right"` \| `"bottom-left"` | `"bottom-right"` | Widget position |
| `data-primary-color` | string (hex) | `"#4f46e5"` | Accent color |
| `data-width` | string | `"400px"` | Chat window width |
| `data-height` | string | `"600px"` | Chat window height |
| `data-auto-open` | `"true"` \| `"false"` | `"false"` | Open on page load |
| `data-greeting` | string | Agent default | Initial greeting message |
| `data-placeholder` | string | `"Type a message..."` | Input placeholder |
| `data-button-icon` | string (URL) | Ozwell logo | Custom launcher icon |

---

## JavaScript API

The embed script exposes a global `OzwellChat` object for programmatic control:

### Open/Close the Widget

```javascript
// Open the chat window
OzwellChat.open();

// Close the chat window
OzwellChat.close();

// Toggle open/closed
OzwellChat.toggle();
```

### Send Messages

```javascript
// Send a message as the user
OzwellChat.sendMessage('Hello, I need help with...');

// Set context data (passed to the agent)
OzwellChat.setContext({
  userId: 'user_123',
  page: window.location.pathname,
  customData: { ... }
});

// Alternative: updateContext() does the same thing
OzwellChat.updateContext({
  formData: { name: 'Alice', email: 'alice@example.com' }
});
```

### Widget State

```javascript
// Wait for widget to be ready
await OzwellChat.ready();

// Check if chat window is open
console.log(OzwellChat.isOpen); // true or false

// Check if there are unread messages
console.log(OzwellChat.hasUnread); // true or false

// Access the iframe element directly
console.log(OzwellChat.iframe);
```

### Runtime Configuration

```javascript
// Update configuration after widget is mounted
OzwellChat.configure({
  model: 'llama3.1',
  system: 'You are a helpful coding assistant.'
});
```

### Manual Mounting

```javascript
// Disable auto-mount
window.OzwellChatConfig = { autoMount: false };

// Mount manually later
OzwellChat.mount({
  containerId: 'my-chat-container',
  width: 400,
  height: 500
});
```

### Events

**Privacy Note:** Ozwell respects user privacy. The host site receives only lifecycle events—never conversation content. Users can ask anything without fear of surveillance.

```javascript
// Widget is ready
window.addEventListener('ozwell:ready', () => {
  console.log('Widget loaded');
});

// Chat window opened
window.addEventListener('ozwell:open', () => {
  analytics.track('Chat Opened');
});

// Chat window closed
window.addEventListener('ozwell:close', () => {
  analytics.track('Chat Closed');
});

// User explicitly shared data (opt-in only)
window.addEventListener('ozwell:user-share', (event) => {
  // Only fires when user chooses to share
  console.log('User shared:', event.detail);
});
```

⚠️ **No message content events:** `ozwell:message` and `ozwell:user-message` do not exist. Conversation content is private between the user and OzwellChat.

---

## MCP Tools

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
    const data = event.data;
    if (!data || data.source !== 'ozwell-chat-widget') return;

    if (data.type === 'tool_call') {
      const { tool, tool_call_id, payload } = data;

      if (tool === 'update_email') {
        document.getElementById('user-email').value = payload.email;

        // Send result back to widget (MUST include tool_call_id)
        OzwellChat.iframe.contentWindow.postMessage({
          source: 'ozwell-chat-parent',
          type: 'tool_result',
          tool_call_id: tool_call_id,
          result: { success: true, message: 'Email updated successfully' }
        }, '*');
      }
    }
  });
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

### Debug Mode

Enable debug mode to visualize tool executions with clickable pills showing arguments and results:

```html
<script>
  window.OzwellChatConfig = {
    debug: true,
    tools: [...]
  };
</script>
```

---

## Message Queuing

Users can send messages while the AI is still responding:

1. Message appears as a queued bubble (dotted outline)
2. User can edit or cancel the queued message
3. When AI finishes, the queued message is automatically sent

This enables smooth back-and-forth conversations without waiting.

---

## Examples

### Basic Embed

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Website</title>
</head>
<body>
  <h1>Welcome to My Site</h1>
  <p>Content goes here...</p>
  
  <!-- Ozwell Chat Widget -->
  <script 
    src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js" 
    data-api-key="ozw_scoped_xxxxxxxxxxxxxxxx"
    data-agent-id="agent_xxxxxxxx"
  ></script>
</body>
</html>
```

### Dark Theme with Custom Position

```html
<script 
  src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js" 
  data-api-key="ozw_scoped_xxxxxxxxxxxxxxxx"
  data-agent-id="agent_xxxxxxxx"
  data-theme="dark"
  data-position="bottom-left"
  data-primary-color="#f59e0b"
></script>
```

### Auto-Open with Custom Greeting

```html
<script 
  src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js" 
  data-api-key="ozw_scoped_xxxxxxxxxxxxxxxx"
  data-agent-id="agent_xxxxxxxx"
  data-auto-open="true"
  data-greeting="👋 Welcome! I'm here to help you find what you're looking for."
></script>
```

### Triggered by Button Click

```html
<button onclick="OzwellChat.open()">Chat with Us</button>

<script 
  src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js" 
  data-api-key="ozw_scoped_xxxxxxxxxxxxxxxx"
  data-agent-id="agent_xxxxxxxx"
></script>
```

---

## Security & Privacy

### Conversation Privacy

🔐 **Conversations are private by default.** The dialogue between users and Ozwell is never shared with the host site. Users can ask any question—even ones they might feel are "dumb"—knowing their conversation stays between them and OzwellChat.

Sharing is always opt-in: only when a user explicitly chooses to share information does it become visible to the host site.

### Scoped Keys Only

⚠️ **Never use general-purpose API keys in frontend code.** Always use scoped keys that are restricted to specific agents and permissions.

### Domain Restrictions

For additional security, configure domain restrictions for your scoped key:

1. Go to **Settings → API Keys** in your dashboard
2. Edit your scoped key
3. Add allowed domains under **Domain Restrictions**
4. Only requests from listed domains will be accepted

### Content Security Policy (CSP)

If your site uses CSP headers, add Ozwell's domains:

```
Content-Security-Policy: 
  script-src 'self' https://cdn.ozwell.ai;
  frame-src 'self' https://embed.ozwell.ai;
  connect-src 'self' https://api.ozwell.ai;
```

---

## Troubleshooting

### Widget Not Appearing

1. **Check the console** for JavaScript errors
2. **Verify your API key** is valid and has correct permissions
3. **Check domain restrictions** if configured
4. **Ensure the script loads** after the page content

### Widget Appears But Chat Fails

1. **Verify agent ID** is correct
2. **Check API key permissions** include chat access
3. **Review network tab** for failed API requests

### Styling Conflicts

The widget renders in an iframe, so styling conflicts are rare. If you need to adjust the container:

```css
/* Adjust the widget container position */
#ozwell-widget-container {
  z-index: 9999 !important;
}
```

---

## Next Steps

- [Framework Integration](./overview.md) — For React, Vue, Svelte apps
- [Iframe Details](./iframe-integration.md) — Deep dive on iframe security
- [Backend API](../backend/overview.md) — Server-side integration
