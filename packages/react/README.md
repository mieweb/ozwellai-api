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
