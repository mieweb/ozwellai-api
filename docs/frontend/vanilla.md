# Vanilla JavaScript Integration

Integrate Ozwell into any website using plain JavaScript, without any framework dependencies.

## Quick Start

### Script Tag (CDN)

The simplest approach — add a single script tag:

```html
<script 
  src="https://cdn.ozwell.ai/embed.js" 
  data-api-key="ozw_scoped_xxxxxxxx"
  data-agent-id="agent_xxxxxxxx"
></script>
```

See the [CDN documentation](./cdn-embed.md) for full details.

### ES Module Import

For bundled applications:

```javascript
import { Ozwell } from '@ozwell/vanilla';

const ozwell = new Ozwell({
  apiKey: 'ozw_scoped_xxxxxxxx',
  agentId: 'agent_xxxxxxxx',
});

ozwell.mount('#ozwell-container');
```

---

## Installation

### NPM / Yarn / PNPM

```bash
npm install @ozwell/vanilla
# or
yarn add @ozwell/vanilla
# or
pnpm add @ozwell/vanilla
```

### CDN (IIFE)

```html
<script src="https://cdn.ozwell.ai/ozwell.min.js"></script>
<script>
  const ozwell = new Ozwell.default({
    apiKey: 'ozw_scoped_xxxxxxxx',
    agentId: 'agent_xxxxxxxx',
  });
  ozwell.mount(document.body);
</script>
```

---

## API Reference

### Constructor

```javascript
import { Ozwell } from '@ozwell/vanilla';

const ozwell = new Ozwell({
  // Required
  apiKey: 'ozw_scoped_xxxxxxxx',
  agentId: 'agent_xxxxxxxx',
  
  // Optional
  theme: 'auto',           // 'light' | 'dark' | 'auto'
  position: 'bottom-right', // 'bottom-right' | 'bottom-left'
  primaryColor: '#4f46e5',
  width: '400px',
  height: '600px',
  autoOpen: false,
  greeting: 'Hello! How can I help?',
  placeholder: 'Type a message...',
  showTrigger: true,
  context: {},
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | *required* | Scoped API key |
| `agentId` | `string` | *required* | Agent ID |
| `theme` | `string` | `'auto'` | Color theme |
| `position` | `string` | `'bottom-right'` | Widget position |
| `primaryColor` | `string` | `'#4f46e5'` | Accent color |
| `width` | `string` | `'400px'` | Chat window width |
| `height` | `string` | `'600px'` | Chat window height |
| `autoOpen` | `boolean` | `false` | Open on mount |
| `greeting` | `string` | Agent default | Initial message |
| `placeholder` | `string` | `'Type a message...'` | Input placeholder |
| `showTrigger` | `boolean` | `true` | Show launcher button |
| `context` | `object` | `{}` | Context data for agent |

---

### Methods

#### `mount(target)`

Mount the widget to a DOM element.

```javascript
// Using a selector
ozwell.mount('#container');

// Using an element reference
ozwell.mount(document.body);
```

#### `unmount()`

Remove the widget from the DOM.

```javascript
ozwell.unmount();
```

#### `open()`

Open the chat window.

```javascript
ozwell.open();
```

#### `close()`

Close the chat window.

```javascript
ozwell.close();
```

#### `toggle()`

Toggle the chat window open/closed.

```javascript
ozwell.toggle();
```

#### `sendMessage(content)`

Send a message programmatically.

```javascript
ozwell.sendMessage('Hello, I need help with...');
```

#### `setContext(context)`

Update the context data sent to the agent.

```javascript
ozwell.setContext({
  userId: 'user_123',
  page: window.location.pathname,
  customData: { ... },
});
```

#### `updateConfig(options)`

Update widget configuration.

```javascript
ozwell.updateConfig({
  theme: 'dark',
  primaryColor: '#10b981',
});
```

---

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `isReady` | `boolean` | Widget is initialized |
| `isOpen` | `boolean` | Chat window is open |
| `isMounted` | `boolean` | Widget is mounted to DOM |

```javascript
if (ozwell.isReady && !ozwell.isOpen) {
  ozwell.open();
}
```

---

### Events

Listen to widget events:

```javascript
ozwell.on('ready', () => {
  console.log('Widget ready');
});

ozwell.on('open', () => {
  console.log('Chat opened');
});

ozwell.on('close', () => {
  console.log('Chat closed');
});

ozwell.on('user-share', (data) => {
  // Only fires when user explicitly shares
  console.log('User shared:', data);
});

ozwell.on('error', (error) => {
  console.error('Error:', error);
});

// Note: No 'message' event - conversations are private between user and Ozwell
```

#### `off(event, handler)`

Remove an event listener:

```javascript
function handleOpen() {
  console.log('Opened');
}

ozwell.on('open', handleOpen);
ozwell.off('open', handleOpen);
```

---

## Examples

### Basic Setup

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Website</title>
</head>
<body>
  <h1>Welcome</h1>
  
  <div id="ozwell-container"></div>
  
  <script type="module">
    import { Ozwell } from 'https://cdn.ozwell.ai/ozwell.esm.js';
    
    const ozwell = new Ozwell({
      apiKey: 'ozw_scoped_xxxxxxxx',
      agentId: 'agent_xxxxxxxx',
    });
    
    ozwell.mount('#ozwell-container');
  </script>
</body>
</html>
```

### Custom Trigger Button

```html
<button id="chat-button">💬 Chat with us</button>

<div id="ozwell-container"></div>

<script type="module">
  import { Ozwell } from '@ozwell/vanilla';
  
  const ozwell = new Ozwell({
    apiKey: 'ozw_scoped_xxxxxxxx',
    agentId: 'agent_xxxxxxxx',
    showTrigger: false,
  });
  
  ozwell.mount('#ozwell-container');
  
  document.getElementById('chat-button').addEventListener('click', () => {
    ozwell.toggle();
  });
</script>
```

### With User Context

```javascript
import { Ozwell } from '@ozwell/vanilla';

// Get user data from your application
const user = getCurrentUser();

const ozwell = new Ozwell({
  apiKey: 'ozw_scoped_xxxxxxxx',
  agentId: 'agent_xxxxxxxx',
  context: {
    userId: user?.id,
    email: user?.email,
    plan: user?.subscription?.plan,
    page: window.location.pathname,
  },
});

ozwell.mount(document.body);

// Update context when user navigates
window.addEventListener('popstate', () => {
  ozwell.setContext({
    ...ozwell.context,
    page: window.location.pathname,
  });
});
```

### Analytics Integration

Track chat lifecycle events (not content—that's private):

```javascript
import { Ozwell } from '@ozwell/vanilla';
import { track } from './analytics';

const ozwell = new Ozwell({
  apiKey: 'ozw_scoped_xxxxxxxx',
  agentId: 'agent_xxxxxxxx',
});

ozwell.on('open', () => {
  track('chat_opened');
});

ozwell.on('close', () => {
  track('chat_closed');
});

ozwell.on('user-share', (data) => {
  // Only fires when user explicitly shares
  track('user_shared_data', data);
});

ozwell.mount(document.body);
```

### Conditional Display

```javascript
import { Ozwell } from '@ozwell/vanilla';

const ozwell = new Ozwell({
  apiKey: 'ozw_scoped_xxxxxxxx',
  agentId: 'agent_xxxxxxxx',
});

// Only show on certain pages
const hiddenPaths = ['/checkout', '/auth', '/admin'];

function shouldShowChat() {
  return !hiddenPaths.some(path => 
    window.location.pathname.startsWith(path)
  );
}

if (shouldShowChat()) {
  ozwell.mount(document.body);
}

// Handle SPA navigation
window.addEventListener('popstate', () => {
  if (shouldShowChat() && !ozwell.isMounted) {
    ozwell.mount(document.body);
  } else if (!shouldShowChat() && ozwell.isMounted) {
    ozwell.unmount();
  }
});
```

### Multiple Agents (Route-Based)

```javascript
import { Ozwell } from '@ozwell/vanilla';

const agents = {
  '/docs': 'agent_docs_xxxxxxxx',
  '/support': 'agent_support_xxxxxxxx',
  default: 'agent_general_xxxxxxxx',
};

function getAgentForPath(path) {
  for (const [prefix, agentId] of Object.entries(agents)) {
    if (prefix !== 'default' && path.startsWith(prefix)) {
      return agentId;
    }
  }
  return agents.default;
}

let ozwell = new Ozwell({
  apiKey: 'ozw_scoped_xxxxxxxx',
  agentId: getAgentForPath(window.location.pathname),
});

ozwell.mount(document.body);

// Reinitialize on navigation
window.addEventListener('popstate', () => {
  const newAgentId = getAgentForPath(window.location.pathname);
  
  if (ozwell.config.agentId !== newAgentId) {
    ozwell.unmount();
    ozwell = new Ozwell({
      apiKey: 'ozw_scoped_xxxxxxxx',
      agentId: newAgentId,
    });
    ozwell.mount(document.body);
  }
});
```

---

## TypeScript

Full TypeScript definitions are included:

```typescript
import { Ozwell, type OzwellConfig, type Message, type OzwellError } from '@ozwell/vanilla';

const config: OzwellConfig = {
  apiKey: 'ozw_scoped_xxxxxxxx',
  agentId: 'agent_xxxxxxxx',
  theme: 'dark',
};

const ozwell = new Ozwell(config);

ozwell.on('message', (message: Message) => {
  console.log(message.role, message.content);
});

ozwell.on('error', (error: OzwellError) => {
  console.error(error.code, error.message);
});

ozwell.mount(document.body);
```

---

## Troubleshooting

### Widget Not Appearing

1. Check that the container element exists in the DOM
2. Verify `mount()` is called after DOM is ready
3. Check browser console for errors

### Events Not Firing

1. Register event listeners before calling `mount()`
2. Verify the event names are correct

### Multiple Instances

Only create one Ozwell instance per page. If you need different agents, use `unmount()` and create a new instance.

---

## Next Steps

- [CDN Integration](./cdn-embed.md) — Simplest script-tag approach
- [Iframe Details](./iframe-integration.md) — Security deep-dive
- [Backend API](../backend/overview.md) — Server-side integration
