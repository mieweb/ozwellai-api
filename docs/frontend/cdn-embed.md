# CDN Embed Integration

The fastest way to add Ozwell to any website. No build step, no framework required — just a single script tag.

## Quick Start

Add this snippet to your HTML, just before the closing `</body>` tag:

```html
<script 
  src="https://cdn.ozwell.ai/embed.js" 
  data-api-key="agnt_key-your-agent-key"
></script>
```

That's it! A chat widget will appear in the bottom-right corner of your page.

---

## Getting Your Credentials

Ozwell supports two authentication modes:

### Option A: Agent Key (Recommended)

Agent keys connect to a server-side agent definition that manages the system prompt, model, temperature, and allowed tools.

1. Log in to your Ozwell dashboard
2. Navigate to **Agents** and create or select an agent
3. Configure the agent's persona, model, tools, and behavior
4. Copy the **Agent Key** (starts with `agnt_key-`)

### Option B: Parent API Key

Parent keys give you raw completions access — you provide the system prompt, model, and tools inline in your client config.

1. Log in to your Ozwell dashboard
2. Navigate to **Settings → API Keys**
3. Click **Create API Key**
4. Copy the generated key (starts with `ozw_`)

---

## Configuration Options

Customize the widget using `data-*` attributes:

```html
<script 
  src="https://cdn.ozwell.ai/embed.js" 
  data-api-key="agnt_key-your-agent-key"
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
| `data-api-key` | string | *required* | Agent key (`agnt_key-...`) or parent key (`ozw_...`) |
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

The embed script exposes a global `Ozwell` object for programmatic control:

### Open/Close the Widget

```javascript
// Open the chat window
Ozwell.open();

// Close the chat window
Ozwell.close();

// Toggle open/closed
Ozwell.toggle();
```

### Send Messages

```javascript
// Send a message as the user
Ozwell.sendMessage('Hello, I need help with...');

// Set context data (passed to the agent)
Ozwell.setContext({
  userId: 'user_123',
  page: window.location.pathname,
  customData: { ... }
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

⚠️ **No message content events:** `ozwell:message` and `ozwell:user-message` do not exist. Conversation content is private between the user and Ozwell.

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
    src="https://cdn.ozwell.ai/embed.js" 
    data-api-key="agnt_key-your-agent-key"
  ></script>
</body>
</html>
```

### Dark Theme with Custom Position

```html
<script 
  src="https://cdn.ozwell.ai/embed.js" 
  data-api-key="agnt_key-your-agent-key"
  data-theme="dark"
  data-position="bottom-left"
  data-primary-color="#f59e0b"
></script>
```

### Auto-Open with Custom Greeting

```html
<script 
  src="https://cdn.ozwell.ai/embed.js" 
  data-api-key="agnt_key-your-agent-key"
  data-auto-open="true"
  data-greeting="👋 Welcome! I'm here to help you find what you're looking for."
></script>
```

### Triggered by Button Click

```html
<button onclick="Ozwell.open()">Chat with Us</button>

<script 
  src="https://cdn.ozwell.ai/embed.js" 
  data-api-key="agnt_key-your-agent-key"
></script>
```

---

## Security & Privacy

### Conversation Privacy

🔐 **Conversations are private by default.** The dialogue between users and Ozwell is never shared with the host site. Users can ask any question—even ones they might feel are "dumb"—knowing their conversation stays between them and Ozwell.

Sharing is always opt-in: only when a user explicitly chooses to share information does it become visible to the host site.

### API Key Requirements

⚠️ **Every widget instance requires a valid API key.** Use either:

- **Agent key** (`agnt_key-...`) — recommended; persona and tools managed server-side
- **Parent key** (`ozw_...`) — for advanced use; you provide all config inline

The widget will display a clear error if no key is configured.

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

1. **Check the error message** in the chat widget — it will show the specific auth error
2. **Verify your API key** starts with `agnt_key-` or `ozw_`
3. **Verify the agent key** exists via `curl GET /v1/agents` if using an agent key
4. **Review network tab** for 401 responses

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
