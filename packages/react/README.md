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

> **Note:** This package wraps the framework-neutral Ozwell embed widget. Prefer `apiKey="agnt_key-..."` for configured agents. You can also use `apiKey="ozw_..."` directly when you provide `system`, `tools`, and other config yourself.

## Feature Support

### Currently Available
- Custom endpoints (`endpoint` prop)
- Configured agents via `apiKey="agnt_key-..."`
- Direct Ozwell API keys via `apiKey="ozw_..."` with explicit config
- Model selection (`model` prop)
- MCP tool/function calling (`tools` prop, `onToolCall` callback)
- System prompts (`system` prop)
- Welcome messages (`welcomeMessage` prop)
- Reasoning UI controls (`thinkingEnabled`, `thinkingDefaultMode`)
- Debug mode (`debug` prop)
- OpenAI API compatibility (`openaiApiKey` prop)
- Custom headers (`headers` prop)
- Auto-open on AI reply (`autoOpenOnReply` prop)
- Lifecycle callbacks (`onReady`, `onOpen`, `onClose`)
- Error callback for mount errors (`onError` - partial)

### Coming Soon
- Separate agent-id configuration (`agentId` prop)
- Theme customization (`theme`, `primaryColor` props)
- Position control (`position` prop)
- Auto-open behavior (`autoOpen` prop)
- User share callbacks (`onUserShare` - requires widget support)
- Full error callback support (`onError` - additional error types)

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
import React, { useState } from 'react';
import { OzwellChat } from '@ozwell/react';

function App() {
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    zipCode: ''
  });

  // Define your tool handlers
  const toolHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    get_form_data: () => formData,

    update_form_data: (args) => {
      setFormData(prev => ({
        name: (args.name as string) ?? prev.name,
        address: (args.address as string) ?? prev.address,
        zipCode: (args.zipCode as string) ?? prev.zipCode
      }));
      return { success: true, updated: args };
    }
  };

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

The React wrapper listens to the loader's `ozwell-tool-call` DOM event and handles the MCP response callback for you, so you just focus on your tool logic.

## Documentation

For full documentation, see [React Integration Guide](../../docs/frontend/react.md).

> **Note:** The current embed widget uses `apiKey` for configured agents. `agentId` is kept as a deprecated type for older examples but is not used by the widget.

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
