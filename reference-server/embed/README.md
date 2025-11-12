# Ozwell Chat Widget

Embeddable chat widget with MCP tool calling support.

## Quick Start

Add this to any HTML page:

```html
<script>
  window.OzwellChatConfig = {
    endpoint: 'https://ozwellai-reference-server.opensource.mieweb.org/v1/chat/completions'
  };
</script>
<script async src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

Call `window.OzwellChat.mount()` to initialize the widget iframe when ready.

## Configuration

`window.OzwellChatConfig` accepts:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `widgetUrl` | string | `/embed/ozwell.html` | Base URL for widget files |
| `endpoint` | string | `/v1/chat/completions` | Chat API endpoint |
| `model` | string | `'llama3'` | Model name for requests |
| `system` | string | `'You are a helpful assistant.'` | Custom system prompt |
| `tools` | array | `[]` | MCP tools (OpenAI format) |
| `welcomeMessage` | string | (none) | Optional greeting message |

## API Endpoints

**Widget Assets (GET):**
- `/embed/ozwell-loader.js` - Loader script (creates iframe with inline HTML)
- `/embed/ozwell.js` - Widget logic (includes CSS)

**Chat Endpoints (POST):**
- `/v1/chat/completions` - OpenAI-spec endpoint (Ollama/OpenAI)
- `/mock/chat` - Keyword-based responses (no LLM required)

## MCP Tool Calling

The widget supports OpenAI function calling for parent page integration.

### Define Tools

Tools use OpenAI function calling format:

```javascript
window.OzwellChatConfig = {
  tools: [
    {
      type: 'function',
      function: {
        name: 'update_name',
        description: 'Updates user name field',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'New name value' }
          },
          required: ['name']
        }
      }
    }
  ]
};
```

### Handle Tool Calls

Listen for tool calls from widget:

```javascript
window.addEventListener('message', (event) => {
  if (event.data.source === 'ozwell-chat-widget' && event.data.type === 'tool_call') {
    const { tool, payload } = event.data;

    // Execute tool (e.g., update form field)
    if (tool === 'update_name') {
      document.getElementById('name').value = payload.name;

      // Send result back to widget
      const iframe = window.OzwellChat.iframe;
      iframe.contentWindow.postMessage({
        source: 'ozwell-chat-parent',
        type: 'tool_result',
        result: { success: true, message: 'Name updated' }
      }, '*');
    }
  }
});
```

### Protocol Flow

1. User message → LLM returns `tool_calls`
2. Widget sends `tool_call` to parent via postMessage
3. Parent executes tool, sends `tool_result` back
4. Widget sends result to LLM → receives completion message
5. Widget displays completion to user

This ensures natural responses like "Done! I've updated your name to Bob."

## Live Demo

**Production URLs:**
- **Reference Server:** https://ozwellai-reference-server.opensource.mieweb.org
- **Demo Application:** https://ozwellai-embedtest.opensource.mieweb.org

The demo shows:
- Form field updates via natural language
- Tic-tac-toe game with MCP tool execution
- Mode switching (mock AI vs Ollama)

See the [reference server README](../README.md) for deployment instructions.
