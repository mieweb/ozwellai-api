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

Use the `onToolCall` prop to handle tool calls with a simple callback:

```tsx
import { OzwellChat } from '@ozwell/react';

// Define your tool handlers
const toolHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_form_data: () => ({
    name: document.getElementById('name')?.value || '',
    address: document.getElementById('address')?.value || '',
    zipCode: document.getElementById('zip')?.value || ''
  }),

  update_form_data: (args) => {
    if (args.name) (document.getElementById('name') as HTMLInputElement).value = args.name as string;
    if (args.address) (document.getElementById('address') as HTMLInputElement).value = args.address as string;
    if (args.zipCode) (document.getElementById('zip') as HTMLInputElement).value = args.zipCode as string;
    return { success: true, updated: args };
  }
};

function App() {
  return (
    <OzwellChat
      endpoint="/v1/chat/completions"
      tools={tools}
      onToolCall={(tool, args, sendResult) => {
        const handler = toolHandlers[tool];
        if (handler) {
          const result = handler(args);
          sendResult(result);
        } else {
          sendResult({ error: `Unknown tool: ${tool}` });
        }
      }}
    />
  );
}
```

The `onToolCall` callback receives:

- `tool` - The name of the tool being called
- `args` - The arguments passed to the tool
- `sendResult` - A function to send the result back to the AI

This handles all the postMessage complexity internally, so you just focus on your tool logic.

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
