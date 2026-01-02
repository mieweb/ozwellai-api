# @ozwell/react

React components for Ozwell chat widget.

## Installation

```bash
npm install @ozwell/react
# or
yarn add @ozwell/react
# or
pnpm add @ozwell/react
```

## Quick Start

```tsx
import { OzwellChat } from '@ozwell/react';

function App() {
  return (
    <OzwellChat
      endpoint="/v1/chat/completions"
      tools={[
        {
          type: 'function',
          function: {
            name: 'get_user_info',
            description: 'Get current user information',
            parameters: {
              type: 'object',
              properties: {},
              required: []
            }
          }
        }
      ]}
    />
  );
}
```

> **Note:** This package wraps the existing Ozwell widget. API key authentication and agent configuration are coming soon. Currently uses local endpoint configuration.

## Feature Support

### ✅ Currently Available
- Custom endpoints (`endpoint` prop)
- Model selection (`model` prop)
- MCP tool/function calling (`tools` prop)
- Context updates (`context` prop)
- System prompts (`system` prop)
- Welcome messages (`welcomeMessage` prop)
- Debug mode (`debug` prop)
- OpenAI API compatibility (`openaiApiKey` prop)
- Custom headers (`headers` prop)

### 🚧 Coming Soon
- Scoped API keys (`apiKey` prop)
- Agent management (`agentId` prop)
- Theme customization (`theme`, `primaryColor` props)
- Position control (`position` prop)
- Auto-open behavior (`autoOpen` prop)
- User share callbacks (`onUserShare`)
- Error callbacks (`onError`)

## Using Tools (MCP Function Calling)

The React package supports MCP (Model Context Protocol) tools for function calling. Here's how to define and handle tools:

### Defining Tools

Tools are defined using the OpenAI-compatible format and passed via the `tools` prop:

```tsx
import { OzwellChat } from '@ozwell/react';
import type { OzwellTool } from '@ozwell/react';

const tools: OzwellTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_form_data',
      description: 'Retrieves current user information including name, address, and zip code',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_form_data',
      description: 'Updates user profile information',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The new name value' },
          address: { type: 'string', description: 'The new address value' },
          zipCode: { type: 'string', description: 'The new zip code value' }
        },
        required: []
      }
    }
  }
];

function App() {
  return (
    <OzwellChat
      endpoint="http://localhost:3000/v1/chat/completions"
      tools={tools}
      debug={true}
      system="You are a helpful assistant for managing user profile information."
    />
  );
}
```

### Handling Tool Calls

Tool calls from the widget are sent via `postMessage`. Listen for them in your component:

```tsx
import { useEffect } from 'react';
import { OzwellChat } from '@ozwell/react';

function App() {
  useEffect(() => {
    const handleToolCall = (event: MessageEvent) => {
      const data = event.data;

      // Verify message is from Ozwell widget
      if (data?.source !== 'ozwell-chat-widget' || data?.type !== 'tool_call') {
        return;
      }

      const { tool_name, tool_call_id, arguments: args } = data.payload;

      // Handle specific tools
      if (tool_name === 'get_form_data') {
        const result = {
          name: 'John Doe',
          address: '123 Main St',
          zipCode: '12345'
        };

        // Send result back to widget
        const iframe = document.querySelector('iframe[src*="ozwell"]');
        iframe?.contentWindow?.postMessage({
          source: 'ozwell-chat-parent',
          type: 'tool_result',
          payload: {
            tool_call_id,
            result
          }
        }, '*');
      }
    };

    window.addEventListener('message', handleToolCall);
    return () => window.removeEventListener('message', handleToolCall);
  }, []);

  return <OzwellChat endpoint="/v1/chat/completions" tools={tools} />;
}
```

### Tool Handler Pattern

For cleaner code, create a tool handler object:

```tsx
const toolHandlers = {
  get_form_data: () => ({
    name: document.getElementById('name').value,
    address: document.getElementById('address').value,
    zipCode: document.getElementById('zip').value
  }),

  update_form_data: (args: { name?: string; address?: string; zipCode?: string }) => {
    if (args.name) document.getElementById('name').value = args.name;
    if (args.address) document.getElementById('address').value = args.address;
    if (args.zipCode) document.getElementById('zip').value = args.zipCode;
    return { success: true, updated: args };
  }
};
```

## Documentation

For full documentation, see [React Integration Guide](../../docs/frontend/react.md).

> **Note:** The documentation describes the planned API including `apiKey` and `agentId` props. The current implementation supports `endpoint` and `tools` configuration matching the vanilla JS widget.

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Development mode (watch)
npm run dev

# Type checking
npm run lint
```

## License

Apache-2.0
