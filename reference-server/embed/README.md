# Ozwell Chat Widget

Add an AI chatbot to any website with one script tag.

## Basic Usage

Add this to your HTML:

```html
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

The chat button appears automatically in the bottom-right corner.

## With Configuration

Customize the widget with `window.OzwellChatConfig`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Website</title>
</head>
<body>
  <h1>Welcome to my site</h1>

  <script>
    window.OzwellChatConfig = {
      endpoint: 'https://ozwellai-reference-server.opensource.mieweb.org/v1/chat/completions',
      model: 'llama3',
      welcomeMessage: 'Hi! How can I help you today?',
      system: 'You are a helpful assistant.'
    };
  </script>
  <script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
</body>
</html>
```

## With MCP Tools

Enable page interactions using MCP tools:

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
</head>
<body>
  <input id="user-email" type="email" placeholder="Enter email">

  <script>
    window.OzwellChatConfig = {
      endpoint: 'https://ozwellai-reference-server.opensource.mieweb.org/v1/chat/completions',
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
</body>
</html>
```

Now users can type: "update my email to john@example.com" and the field updates automatically.

## Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `autoMount` | boolean | `true` | Auto-mount widget on page load |
| `endpoint` | string | `/v1/chat/completions` | Chat API endpoint |
| `model` | string | `'llama3'` | Model name |
| `system` | string | `'You are a helpful assistant.'` | System prompt |
| `tools` | array | `[]` | MCP tools (OpenAI format) |
| `welcomeMessage` | string | (none) | Greeting message |
| `placeholder` | string | `'Ask a question...'` | Input placeholder |
| `title` | string | `'Ozwell Assistant'` | Widget title |

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

# Use local endpoint
<script>
  window.OzwellChatConfig = {
    endpoint: 'http://localhost:3000/v1/chat/completions'
  };
</script>
<script src="http://localhost:3000/embed/ozwell-loader.js"></script>
```
