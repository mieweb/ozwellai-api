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

Sign in to [Ozwell Manager](https://ozwellconsole.os.mieweb.org) with your MIE account,
create an agent, and copy its `agnt_key-` key. See [credential setup](cdn-embed.md#getting-your-credentials).
OIDC is used for Manager sign-in; do not pass an OIDC client secret, login token, or parent
`ozw_` key to the widget. The agent key selects the agent, so a separate `agentId` is not needed.

```tsx
import { OzwellChat } from '@ozwell/react';

function App() {
  return (
    <div>
      <h1>My App</h1>
      <OzwellChat
        apiKey="agnt_key-your-agent-key"
      />
    </div>
  );
}
```

The component loads the current hosted widget from `https://ozwellapi.os.mieweb.org`.
Your Vite app does not need to serve `/widget` or `/v1/chat/completions` itself.
For a different deployment, set `widgetUrl="https://your-ozwell-host/widget/frame/"`;
the loader and default API endpoint use that host. For local development, use
`widgetUrl="http://localhost:3000/widget/frame/"` with the reference server running.
An `endpoint` override changes chat requests only, not where the widget is loaded.

### Vite + MIE UI: Click Hello World

In a Vite React TypeScript app, install `@mieweb/ui` and `@ozwell/react`. Follow the
[MIE UI setup instructions](https://ui.mieweb.com) for its styles and theme.
Use the iframe-based `OzwellChat` below for an Ozwell integration; a visual chat
component or a canned Storybook reply alone does not connect to an Ozwell agent.

Set `VITE_OZWELL_AGENT_KEY` to your agent key in your local environment. Vite exposes
`VITE_*` values to the browser: this is not secret storage. Use only an agent key
approved for that site, never a parent/admin or model-provider key. Confirm its
permissions and deployment policy before publishing; use a server-side integration
when credentials must remain private.

```tsx
import { useRef, useState } from 'react';
import { Button } from '@mieweb/ui';
import { OzwellChat, type OzwellTool } from '@ozwell/react';

const tools: OzwellTool[] = [{
  type: 'function',
  function: {
    name: 'click_hello_world',
    description: 'Click the Hello World button when the user asks.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}];

export default function App() {
  const button = useRef<HTMLButtonElement>(null);
  const [clicks, setClicks] = useState(0);

  return (
    <>
      <Button ref={button} onClick={() => setClicks(value => value + 1)}>
        Hello World
      </Button>
      <output aria-live="polite">Clicks: {clicks}</output>
      <OzwellChat
        apiKey={import.meta.env.VITE_OZWELL_AGENT_KEY}
        tools={tools}
        onToolCall={(name, _args, respond) => {
          if (name !== 'click_hello_world' || !button.current) {
            respond({ isError: true, content: [{ type: 'text', text: 'Tool unavailable' }] });
            return;
          }
          button.current.click();
          respond({ content: [{ type: 'text', text: 'Clicked Hello World' }] });
        }}
      />
    </>
  );
}
```

Open chat and ask "Click the Hello World button." The click count should increase,
and the tool result should return to the assistant. Always return a result for every
tool call, including unsupported names. Expose specific actions, not arbitrary
JavaScript execution or unrestricted DOM selectors.

Conversation privacy builds user trust: the host receives tool calls and lifecycle
events, never the private conversation. Sharing conversation content is always opt-in.

### Troubleshooting Existing Apps (Including eCase)

- Loader 404: confirm the script comes from the Ozwell host's `/widget` route, not the Vite app's origin.
- Sign-in fails: verify the Manager OIDC deployment and registered redirect URL with the operator. Embedding does not register an OIDC client for your app.
- Agent authentication fails: confirm the key starts with `agnt_key-`, belongs to the same Ozwell deployment, and has not been revoked. Do not work around authentication by disabling it.
- Chat cannot click: pass both `tools` and `onToolCall`, return a result, and ensure the agent uses a tool-capable model.
- Network or CSP errors: allow the chosen widget host in `script-src` and `frame-src`, and its agent-discovery API in `connect-src`. Cross-origin API requests also require deployment-side CORS approval.

For AI-assisted app creation, reference this guide at
[docs.ozwell.ai/frontend/react](https://docs.ozwell.ai/frontend/react) alongside MIE UI's
instructions. Ask for the iframe embed, agent-key setup, and an explicit page-tool
handler, not a mock chat interface. The UI site's generated instructions must link
to this guide in the `mieweb/ui` repository; updating this API repository does not
publish changes to `ui.mieweb.com` or deploy eCase.

---

## Component API

### `<OzwellChat />`

The main chat widget component.

```tsx
import { OzwellChat } from '@ozwell/react';

<OzwellChat
  apiKey="agnt_key-your-agent-key"
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
| `apiKey` | `string` | — | Agent key (`agnt_key-...`) for authentication and agent configuration |
| `agentId` | `string` | — | Reserved; not implemented. Use an agent key instead. |
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
| `placeholder` | `string` | `'Type a message...'` | Input placeholder |
| `tools` | `OzwellTool[]` | `[]` | MCP tools available to the AI |
| `debug` | `boolean` | `false` | Enable debug mode |
| `openaiApiKey` | `string` | — | OpenAI API key (for direct OpenAI endpoint) |
| `headers` | `Record<string, string>` | — | Custom HTTP headers |
| `widgetUrl` | `string` | `https://ozwellapi.os.mieweb.org/widget/frame/` | Widget frame URL; also selects the loader host |
| `defaultUI` | `boolean` | `true` | Enable default floating button UI |
| `onReady` | `() => void` | — | Widget ready callback |
| `onOpen` | `() => void` | — | Chat opened callback |
| `onClose` | `() => void` | — | Chat closed callback |
| `onToolCall` | `(tool, args, sendResult) => void` | — | Tool call handler (see below) |
| `onUserShare` | `(data: unknown) => void` | — | User shared data callback (requires widget support - coming soon) |
| `onError` | `(error: OzwellError) => void` | — | Reports loader and mount errors |

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
  sendMessage: (content: string) => void;  // Not yet implemented
  iframe: HTMLIFrameElement | null;
}
```

> **Note:** `sendMessage` is not yet implemented in the vanilla widget. It will log a warning if called.

---

## Examples

### With Page Context

The React wrapper does not implement a `context` prop. Expose a specific read-only
page tool through `tools` and `onToolCall` when the assistant needs page data.
Return only the information needed for that action.

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
        apiKey="agnt_key-your-agent-key"
        defaultUI={false}
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
      apiKey="agnt_key-your-agent-key"
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
  apiKey: 'agnt_key-your-agent-key',
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
2. Check the widget host and agent key using the setup checklist above
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
