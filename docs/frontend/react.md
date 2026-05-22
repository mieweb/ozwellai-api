# React Integration

Integrate Ozwell into your React application with a simple component wrapper around the iframe-based widget.

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
    <div>
      <h1>My App</h1>
      <OzwellChat
        apiKey="agnt_key-xxxxxxxx"
      />
    </div>
  );
}
```

---

## Component API

### `<OzwellChat />`

The main chat widget component.

```tsx
import { OzwellChat } from '@ozwell/react';

<OzwellChat
  apiKey="agnt_key-xxxxxxxx"
  theme="auto"
  position="bottom-right"
  primaryColor="#4f46e5"
  width="400px"
  height="600px"
  autoOpen={false}
  welcomeMessage="Hello! How can I help?"
  placeholder="Type a message..."
  onReady={() => console.log('Ready')}
  onOpen={() => console.log('Opened')}
  onClose={() => console.log('Closed')}
  onUserShare={(data) => console.log('User shared:', data)}
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | — | Ozwell auth key. Prefer `agnt_key-*` for configured agents; use `ozw_*` with explicit `system`, `tools`, and other config |
| `agentId` | `string` | — | Deprecated; current widget uses `apiKey` for configured agents |
| `endpoint` | `string` | — | API endpoint URL |
| `model` | `string` | — | Model name (optional, auto-selected if not specified) |
| `system` | `string` | — | System prompt for the assistant |
| `welcomeMessage` | `string` | — | Welcome message shown when chat opens |
| `title` | `string` | — | Chat widget title |
| `thinkingEnabled` | `boolean` | `false` | Show reasoning/thinking UI when supported by the model |
| `thinkingDefaultMode` | `0 \| 1 \| 2 \| 3` | `2` | Reasoning display mode: None, Peek, Smart, Expanded |
| `exposeUnreadEvent` | `boolean` | `false` | Opt in to `ozwell-chat-unread` events from the loader |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color theme (coming soon) |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Widget position (coming soon) |
| `primaryColor` | `string` | `'#4f46e5'` | Accent color (coming soon) |
| `width` | `string \| number` | `360` | Chat window width |
| `height` | `string \| number` | `420` | Chat window height |
| `autoOpen` | `boolean` | `false` | Open on mount (coming soon) |
| `placeholder` | `string` | `'Type a message...'` | Input placeholder |
| `tools` | `OzwellTool[]` | `[]` | MCP tools available to the AI |
| `debug` | `boolean` | `false` | Enable debug mode |
| `openaiApiKey` | `string` | — | OpenAI API key (for direct OpenAI endpoint) |
| `headers` | `Record<string, string>` | — | Custom HTTP headers |
| `widgetUrl` | `string` | — | Widget URL (auto-detected by default) |
| `defaultUI` | `boolean` | `true` | Enable default floating button UI |
| `onReady` | `() => void` | — | Widget ready callback |
| `onOpen` | `() => void` | — | Chat opened callback |
| `onClose` | `() => void` | — | Chat closed callback |
| `onToolCall` | `(tool, args, sendResult, sendError?) => void` | — | Tool call handler (see below) |
| `onUserShare` | `(data: unknown) => void` | — | User shared data callback (requires widget support - coming soon) |
| `onError` | `(error: OzwellError) => void` | — | Error callback (works for mount errors, more error types coming soon) |

> **Privacy Note:** There is no `onMessage` callback. Conversation content is private between the user and Ozwell. The `onUserShare` callback only fires when the user explicitly chooses to share data with your site.

---

## Hooks

### `useOzwell()`

Access the Ozwell instance programmatically. This hook works anywhere in your app after `OzwellChat` has mounted - it doesn't need to be a child of the component.

```tsx
import { OzwellChat, useOzwell } from '@ozwell/react';

function ChatControls() {
  const ozwell = useOzwell();
  
  return (
    <div>
      <button onClick={() => ozwell.open()}>Open Chat</button>
      <button onClick={() => ozwell.close()}>Close Chat</button>
    </div>
  );
}

function App() {
  return (
    <>
      {/* OzwellChat can be anywhere - useOzwell works after it mounts */}
      <OzwellChat endpoint="/v1/chat/completions" />
      <ChatControls />
    </>
  );
}
```

### Hook API

```typescript
interface UseOzwellReturn {
  isReady: boolean;
  isOpen: boolean;
  hasUnread: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  sendMessage: (content: string) => void;
  iframe: HTMLIFrameElement | null;
}
```

> **Note:** `sendMessage` posts the current widget `send-message` JSON-RPC command into the iframe. The widget must already be mounted and ready.

---

## Examples

### With Agent Key

```tsx
import { OzwellChat } from '@ozwell/react';

function App() {
  return (
    <OzwellChat
      apiKey="agnt_key-xxxxxxxx"
      thinkingEnabled={true}
      thinkingDefaultMode={2}
    />
  );
}
```

### With Ozwell API Key

```tsx
<OzwellChat
  apiKey="ozw_..."
  system="You are a helpful assistant."
  tools={tools}
/>
```

### Custom Trigger Button

Hide the default launcher and use your own button:

```tsx
import { OzwellChat, useOzwell } from '@ozwell/react';

function CustomTrigger() {
  const { open, isOpen } = useOzwell();
  
  if (isOpen) return null;
  
  return (
    <button
      onClick={open}
      className="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-full"
    >
      Need help?
    </button>
  );
}

function App() {
  return (
    <>
      <OzwellChat
        endpoint="/v1/chat/completions"
        defaultUI={false}  {/* Hide default floating button */}
      />
      <CustomTrigger />
    </>
  );
}
```

### Analytics Integration

Track chat lifecycle events (not content—that's private):

```tsx
import { OzwellChat } from '@ozwell/react';
import { analytics } from './analytics';

function App() {
  return (
    <OzwellChat
      endpoint="/v1/chat/completions"
      apiKey="agnt_key-xxxxxxxx"
      onOpen={() => {
        analytics.track('Chat Opened');
      }}
      onClose={() => {
        analytics.track('Chat Closed');
      }}
      onUserShare={(data) => {
        // Only fires when user explicitly shares (coming soon)
        analytics.track('User Shared Data', data);
      }}
    />
  );
}
```

### Conditional Rendering

Only show chat on certain pages:

```tsx
import { OzwellChat } from '@ozwell/react';
import { useLocation } from 'react-router-dom';

function App() {
  const location = useLocation();
  const showChat = !location.pathname.startsWith('/checkout');
  
  return (
    <div>
      {/* App content */}
      {showChat && (
        <OzwellChat endpoint="/v1/chat/completions" />
      )}
    </div>
  );
}
```

### Tool Handling with onToolCall

Handle MCP tool calls from the AI assistant with a simple callback:

```tsx
import { OzwellChat } from '@ozwell/react';
import type { OzwellTool } from '@ozwell/react';

// Define available tools
const tools: OzwellTool[] = [
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
  },
  {
    type: 'function',
    function: {
      name: 'update_settings',
      description: 'Update user settings',
      parameters: {
        type: 'object',
        properties: {
          theme: { type: 'string', enum: ['light', 'dark'] },
          notifications: { type: 'boolean' }
        },
        required: []
      }
    }
  }
];

// Define tool handlers
const toolHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_user_info: () => ({
    name: 'John Doe',
    email: 'john@example.com',
    plan: 'pro'
  }),
  update_settings: (args) => {
    // Update settings in your app
    console.log('Updating settings:', args);
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

- `tool` — The name of the tool being called
- `args` — The arguments passed to the tool
- `sendResult` — A function to send the result back to the AI

This handles all postMessage complexity internally, so you focus on your tool logic.

---

## TypeScript

The package includes full TypeScript definitions:

```tsx
import type { OzwellChatProps, OzwellError } from '@ozwell/react';

const config: OzwellChatProps = {
  apiKey: 'agnt_key-xxxxxxxx',
  // theme: 'dark',                  // Coming soon
  onUserShare: (data: unknown) => {
    // Only fires when user explicitly shares (coming soon)
    console.log('User shared:', data);
  },
  onError: (error: OzwellError) => {
    // Currently works for mount errors, more error types coming soon
    console.error(error.code, error.message);
  }
};
```

> **Privacy Note:** There is no `Message` type exported. Conversation content is private.

---

## Troubleshooting

### Widget Not Appearing

1. Ensure the component is mounted in the DOM
2. Check that the `endpoint` or `apiKey` prop is correct
3. Look for console errors

### Multiple Instances

Only render one `<OzwellChat />` component per page. If you need different agents on different routes, conditionally render with different props.

### Callbacks Causing Re-renders

If you pass inline functions as callbacks, they create new references on each render, which can cause unnecessary widget reconfiguration:

```tsx
// Creates new function on every render
<OzwellChat
  endpoint="/v1/chat/completions"
  onReady={() => console.log('ready')}
/>

// Stable function reference
const handleReady = useCallback(() => {
  console.log('ready');
}, []);

<OzwellChat
  endpoint="/v1/chat/completions"
  onReady={handleReady}
/>
```

---

## Next Steps

- [Next.js Integration](./nextjs.md) — SSR considerations
- [Iframe Details](./iframe-integration.md) — Security deep-dive
- [Backend API](../backend/overview.md) — Server-side integration
