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
        apiKey="ozw_scoped_xxxxxxxx"
        agentId="agent_xxxxxxxx"
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
  apiKey="ozw_scoped_xxxxxxxx"
  agentId="agent_xxxxxxxx"
  theme="auto"
  position="bottom-right"
  primaryColor="#4f46e5"
  width="400px"
  height="600px"
  autoOpen={false}
  greeting="Hello! How can I help?"
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
| `apiKey` | `string` | — | Scoped API key (coming soon, will be required) |
| `agentId` | `string` | — | Agent ID (coming soon, will be required) |
| `endpoint` | `string` | — | API endpoint URL |
| `model` | `string` | — | Model name (optional, auto-selected if not specified) |
| `system` | `string` | — | System prompt for the assistant |
| `welcomeMessage` | `string` | — | Welcome message shown when chat opens |
| `title` | `string` | — | Chat widget title |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color theme (coming soon) |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Widget position (coming soon) |
| `primaryColor` | `string` | `'#4f46e5'` | Accent color (coming soon) |
| `width` | `string \| number` | `360` | Chat window width |
| `height` | `string \| number` | `420` | Chat window height |
| `autoOpen` | `boolean` | `false` | Open on mount (coming soon) |
| `greeting` | `string` | Agent default | Initial message |
| `placeholder` | `string` | `'Type a message...'` | Input placeholder |
| `context` | `Record<string, unknown>` | `{}` | Context data for agent |
| `tools` | `OzwellTool[]` | `[]` | MCP tools available to the AI |
| `debug` | `boolean` | `false` | Enable debug mode |
| `openaiApiKey` | `string` | — | OpenAI API key (for direct OpenAI endpoint) |
| `headers` | `Record<string, string>` | — | Custom HTTP headers |
| `widgetUrl` | `string` | — | Widget URL (auto-detected by default) |
| `defaultUI` | `boolean` | `true` | Enable default floating button UI |
| `onReady` | `() => void` | — | Widget ready callback |
| `onOpen` | `() => void` | — | Chat opened callback |
| `onClose` | `() => void` | — | Chat closed callback |
| `onInsert` | `(data: { text: string; close: boolean }) => void` | — | User inserts text to parent page |
| `onToolCall` | `(tool, args, sendResult) => void` | — | Tool call handler (see below) |
| `onUserShare` | `(data: unknown) => void` | — | User shared data callback (coming soon) |
| `onError` | `(error: OzwellError) => void` | — | Error callback (coming soon) |

> **Privacy Note:** There is no `onMessage` callback. Conversation content is private between the user and Ozwell. The `onUserShare` callback only fires when the user explicitly chooses to share data with your site.

---

## Hooks

### `useOzwell()`

Access the Ozwell instance programmatically.

```tsx
import { OzwellChat, useOzwell } from '@ozwell/react';

function ChatControls() {
  const ozwell = useOzwell();
  
  return (
    <div>
      <button onClick={() => ozwell.open()}>Open Chat</button>
      <button onClick={() => ozwell.close()}>Close Chat</button>
      <button onClick={() => ozwell.sendMessage('Hello!')}>
        Send Hello
      </button>
    </div>
  );
}

function App() {
  return (
    <OzwellChat apiKey="..." agentId="...">
      <ChatControls />
    </OzwellChat>
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
  setContext: (context: Record<string, unknown>) => void;
  iframe: HTMLIFrameElement | null;
}
```

---

## Examples

### With Context Data

Pass user information and page context to the agent:

```tsx
import { OzwellChat } from '@ozwell/react';
import { useUser } from './auth';
import { useLocation } from 'react-router-dom';

function App() {
  const user = useUser();
  const location = useLocation();
  
  return (
    <OzwellChat
      apiKey="ozw_scoped_xxxxxxxx"
      agentId="agent_xxxxxxxx"
      context={{
        userId: user?.id,
        email: user?.email,
        page: location.pathname,
        timestamp: Date.now()
      }}
    />
  );
}
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
      💬 Need help?
    </button>
  );
}

function App() {
  return (
    <OzwellChat 
      apiKey="..." 
      agentId="..."
      // Hide default trigger
      renderTrigger={() => null}
    >
      <CustomTrigger />
    </OzwellChat>
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
      apiKey="ozw_scoped_xxxxxxxx"
      agentId="agent_xxxxxxxx"
      onOpen={() => {
        analytics.track('Chat Opened');
      }}
      onClose={() => {
        analytics.track('Chat Closed');
      }}
      onUserShare={(data) => {
        // Only fires when user explicitly shares
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
  apiKey: 'ozw_scoped_xxxxxxxx',
  agentId: 'agent_xxxxxxxx',
  theme: 'dark',
  onUserShare: (data: unknown) => {
    // Only fires when user explicitly shares
    console.log('User shared:', data);
  },
  onError: (error: OzwellError) => {
    console.error(error.code, error.message);
  }
};
```

> **Privacy Note:** There is no `Message` type exported. Conversation content is private.

---

## Troubleshooting

### Widget Not Appearing

1. Ensure the component is mounted in the DOM
2. Check that `apiKey` and `agentId` are valid
3. Look for console errors

### Context Not Updating

The `context` prop is not deeply compared. To trigger updates:

```tsx
// ❌ Won't trigger update (same object reference)
const context = { page: location.pathname };

// ✅ Will trigger update (new object)
const context = useMemo(
  () => ({ page: location.pathname }),
  [location.pathname]
);
```

### Multiple Instances

Only render one `<OzwellChat />` component per page. If you need different agents on different routes, conditionally render with different props.

---

## Next Steps

- [Next.js Integration](./nextjs.md) — SSR considerations
- [Iframe Details](./iframe-integration.md) — Security deep-dive
- [Backend API](../backend/overview.md) — Server-side integration
