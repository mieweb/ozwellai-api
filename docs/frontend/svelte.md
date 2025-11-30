# Svelte Integration

Integrate Ozwell into your Svelte or SvelteKit application with a reactive component.

## Installation

```bash
npm install @ozwell/svelte
# or
yarn add @ozwell/svelte
# or
pnpm add @ozwell/svelte
```

## Quick Start

### Svelte

```svelte
<script>
  import { OzwellChat } from '@ozwell/svelte';
  
  const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
  const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;
</script>

<h1>My App</h1>

<OzwellChat {apiKey} {agentId} />
```

### SvelteKit

```svelte
<!-- +layout.svelte -->
<script>
  import { OzwellChat } from '@ozwell/svelte';
  import { browser } from '$app/environment';
  import { PUBLIC_OZWELL_API_KEY, PUBLIC_OZWELL_AGENT_ID } from '$env/static/public';
</script>

<slot />

{#if browser}
  <OzwellChat 
    apiKey={PUBLIC_OZWELL_API_KEY}
    agentId={PUBLIC_OZWELL_AGENT_ID}
  />
{/if}
```

---

## Component API

### `<OzwellChat />`

```svelte
<script>
  import { OzwellChat } from '@ozwell/svelte';
  
  let context = { page: window.location.pathname };
  
  function handleReady() {
    console.log('Widget ready');
  }
  
  function handleUserShare(event) {
    // Only fires when user explicitly shares
    console.log('User shared:', event.detail);
  }
</script>

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
  {context}
  on:ready={handleReady}
  on:open={() => console.log('Opened')}
  on:close={() => console.log('Closed')}
  on:user-share={(e) => console.log('User shared:', e.detail)}
  on:error={(e) => console.error(e.detail)}
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | *required* | Scoped API key |
| `agentId` | `string` | *required* | Agent ID |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color theme |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Widget position |
| `primaryColor` | `string` | `'#4f46e5'` | Accent color |
| `width` | `string` | `'400px'` | Chat window width |
| `height` | `string` | `'600px'` | Chat window height |
| `autoOpen` | `boolean` | `false` | Open on mount |
| `greeting` | `string` | Agent default | Initial message |
| `placeholder` | `string` | `'Type a message...'` | Input placeholder |
| `context` | `Record<string, unknown>` | `{}` | Context data for agent |
| `showTrigger` | `boolean` | `true` | Show default trigger button |

### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `on:ready` | — | Widget initialized |
| `on:open` | — | Chat window opened |
| `on:close` | — | Chat window closed |
| `on:user-share` | `unknown` | User explicitly shared data |
| `on:error` | `OzwellError` | Error occurred |

> **Privacy Note:** There is no `on:message` event. Conversation content is private between the user and Ozwell.

---

## Store & Actions

### `ozwellStore`

Access the Ozwell state reactively:

```svelte
<script>
  import { OzwellChat, ozwellStore } from '@ozwell/svelte';
  
  const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
  const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;
</script>

<p>Ready: {$ozwellStore.isReady}</p>
<p>Open: {$ozwellStore.isOpen}</p>

<OzwellChat {apiKey} {agentId} />
```

### Actions

```svelte
<script>
  import { 
    OzwellChat, 
    ozwellStore,
    openChat, 
    closeChat, 
    toggleChat,
    sendMessage,
    setContext 
  } from '@ozwell/svelte';
  
  const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
  const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;
  
  function handleSendHello() {
    sendMessage('Hello!');
  }
</script>

<button on:click={openChat}>Open</button>
<button on:click={closeChat}>Close</button>
<button on:click={toggleChat}>Toggle</button>
<button on:click={handleSendHello}>Say Hello</button>

<OzwellChat {apiKey} {agentId} />
```

---

## Examples

### With SvelteKit Page Context

```svelte
<!-- +layout.svelte -->
<script>
  import { OzwellChat } from '@ozwell/svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { PUBLIC_OZWELL_API_KEY, PUBLIC_OZWELL_AGENT_ID } from '$env/static/public';
  
  $: context = {
    page: $page.url.pathname,
    query: Object.fromEntries($page.url.searchParams),
  };
</script>

<slot />

{#if browser}
  <OzwellChat 
    apiKey={PUBLIC_OZWELL_API_KEY}
    agentId={PUBLIC_OZWELL_AGENT_ID}
    {context}
  />
{/if}
```

### Custom Trigger Button

```svelte
<script>
  import { OzwellChat, ozwellStore, openChat } from '@ozwell/svelte';
  
  const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
  const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;
</script>

{#if !$ozwellStore.isOpen}
  <button class="chat-trigger" on:click={openChat}>
    💬 Need help?
  </button>
{/if}

<OzwellChat {apiKey} {agentId} showTrigger={false} />

<style>
  .chat-trigger {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 24px;
    background: #4f46e5;
    color: white;
    border: none;
    border-radius: 24px;
    cursor: pointer;
  }
</style>
```

### With Authentication

```svelte
<script>
  import { OzwellChat } from '@ozwell/svelte';
  import { browser } from '$app/environment';
  import { user } from '$lib/stores/auth';
  import { PUBLIC_OZWELL_API_KEY, PUBLIC_OZWELL_AGENT_ID } from '$env/static/public';
  
  $: context = {
    userId: $user?.id,
    email: $user?.email,
    plan: $user?.subscription?.plan,
  };
</script>

{#if browser}
  <OzwellChat 
    apiKey={PUBLIC_OZWELL_API_KEY}
    agentId={PUBLIC_OZWELL_AGENT_ID}
    {context}
  />
{/if}
```

### Route-Based Visibility

```svelte
<!-- +layout.svelte -->
<script>
  import { OzwellChat } from '@ozwell/svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { PUBLIC_OZWELL_API_KEY, PUBLIC_OZWELL_AGENT_ID } from '$env/static/public';
  
  const hiddenRoutes = ['/checkout', '/auth', '/admin'];
  
  $: showChat = !hiddenRoutes.some(route => 
    $page.url.pathname.startsWith(route)
  );
</script>

<slot />

{#if browser && showChat}
  <OzwellChat 
    apiKey={PUBLIC_OZWELL_API_KEY}
    agentId={PUBLIC_OZWELL_AGENT_ID}
  />
{/if}
```

### Analytics Integration

Track chat lifecycle events (not content—that's private):

```svelte
<script>
  import { OzwellChat } from '@ozwell/svelte';
  import { track } from '$lib/analytics';
  
  const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
  const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;
  
  function handleOpen() {
    track('chat_opened');
  }
  
  function handleClose() {
    track('chat_closed');
  }
  
  function handleUserShare(event) {
    // Only fires when user explicitly shares
    track('user_shared_data', event.detail);
  }
</script>

<OzwellChat 
  {apiKey} 
  {agentId}
  on:open={handleOpen}
  on:close={handleClose}
  on:user-share={handleUserShare}
/>
```

---

## TypeScript

Full TypeScript support included:

```svelte
<script lang="ts">
  import { OzwellChat } from '@ozwell/svelte';
  import type { OzwellError } from '@ozwell/svelte';
  
  const apiKey: string = import.meta.env.VITE_OZWELL_API_KEY;
  const agentId: string = import.meta.env.VITE_OZWELL_AGENT_ID;
  
  function handleUserShare(event: CustomEvent<unknown>) {
    // Only fires when user explicitly shares
    console.log('User shared:', event.detail);
  }
  
  function handleError(event: CustomEvent<OzwellError>) {
    console.error(event.detail.code, event.detail.message);
  }
</script>

<OzwellChat 
  {apiKey} 
  {agentId}
  on:user-share={handleUserShare}
  on:error={handleError}
/>
```

> **Privacy Note:** There is no `on:message` event or `Message` type for content. Conversations are private.

---

## SvelteKit SSR Considerations

The widget must render client-side only. Use the `browser` check:

```svelte
<script>
  import { browser } from '$app/environment';
</script>

{#if browser}
  <!-- Client-only content -->
{/if}
```

Or use a dynamic import in `+page.svelte`:

```svelte
<script>
  import { onMount } from 'svelte';
  
  let OzwellChat;
  
  onMount(async () => {
    const module = await import('@ozwell/svelte');
    OzwellChat = module.OzwellChat;
  });
</script>

{#if OzwellChat}
  <svelte:component 
    this={OzwellChat}
    apiKey="..."
    agentId="..."
  />
{/if}
```

---

## Troubleshooting

### Widget Not Appearing

1. Ensure `browser` check is in place for SvelteKit
2. Verify API key and agent ID are correct
3. Check browser console for errors

### Context Not Updating

Use reactive declarations:

```svelte
<script>
  import { page } from '$app/stores';
  
  // ✅ Reactive
  $: context = { page: $page.url.pathname };
  
  // ❌ Not reactive
  const context = { page: $page.url.pathname };
</script>
```

### Multiple Instances

Only render one `<OzwellChat />` component per page.

---

## Next Steps

- [Vanilla JS Integration](./vanilla.md) — Framework-agnostic approach
- [Iframe Details](./iframe-integration.md) — Security deep-dive
- [Backend API](../backend/overview.md) — Server-side integration
