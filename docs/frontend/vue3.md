# Vue 3 Integration

Integrate Ozwell into your Vue 3 application with a composable-based approach.

## Installation

```bash
npm install @ozwell/vue
# or
yarn add @ozwell/vue
# or
pnpm add @ozwell/vue
```

## Quick Start

### Option 1: Plugin (Recommended)

Register the plugin in your app:

```typescript
// main.ts
import { createApp } from 'vue';
import { OzwellPlugin } from '@ozwell/vue';
import App from './App.vue';

const app = createApp(App);

app.use(OzwellPlugin, {
  apiKey: import.meta.env.VITE_OZWELL_API_KEY,
  agentId: import.meta.env.VITE_OZWELL_AGENT_ID,
});

app.mount('#app');
```

Use the component anywhere:

```vue
<template>
  <div>
    <h1>My App</h1>
    <OzwellChat />
  </div>
</template>
```

### Option 2: Direct Component Import

```vue
<template>
  <div>
    <h1>My App</h1>
    <OzwellChat 
      :api-key="apiKey"
      :agent-id="agentId"
      theme="auto"
    />
  </div>
</template>

<script setup lang="ts">
import { OzwellChat } from '@ozwell/vue';

const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;
</script>
```

---

## Component API

### `<OzwellChat />`

```vue
<template>
  <OzwellChat
    :api-key="apiKey"
    :agent-id="agentId"
    theme="auto"
    position="bottom-right"
    primary-color="#4f46e5"
    width="400px"
    height="600px"
    :auto-open="false"
    greeting="Hello! How can I help?"
    placeholder="Type a message..."
    :context="context"
    @ready="onReady"
    @open="onOpen"
    @close="onClose"
    @user-share="onUserShare"
    @error="onError"
  />
</template>
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

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `@ready` | — | Widget initialized |
| `@open` | — | Chat window opened |
| `@close` | — | Chat window closed |
| `@user-share` | `unknown` | User explicitly shared data |
| `@error` | `OzwellError` | Error occurred |

> **Privacy Note:** There is no `@message` event. Conversation content is private between the user and Ozwell. The `@user-share` event only fires when the user explicitly chooses to share data.

---

## Composables

### `useOzwell()`

Access the Ozwell instance programmatically:

```vue
<template>
  <div>
    <button @click="ozwell.open()">Open Chat</button>
    <button @click="ozwell.close()">Close Chat</button>
    <button @click="sendHello">Send Hello</button>
    
    <OzwellChat :api-key="apiKey" :agent-id="agentId" />
  </div>
</template>

<script setup lang="ts">
import { OzwellChat, useOzwell } from '@ozwell/vue';

const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;

const ozwell = useOzwell();

function sendHello() {
  ozwell.sendMessage('Hello!');
}
</script>
```

### Composable API

```typescript
interface UseOzwellReturn {
  isReady: Ref<boolean>;
  isOpen: Ref<boolean>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  sendMessage: (content: string) => void;
  setContext: (context: Record<string, unknown>) => void;
}
```

---

## Examples

### With Reactive Context

```vue
<template>
  <OzwellChat 
    :api-key="apiKey"
    :agent-id="agentId"
    :context="context"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { OzwellChat } from '@ozwell/vue';

const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;

const route = useRoute();
const userStore = useUserStore();

const context = computed(() => ({
  userId: userStore.user?.id,
  email: userStore.user?.email,
  page: route.path,
  timestamp: Date.now(),
}));
</script>
```

### Custom Trigger Button

```vue
<template>
  <div>
    <button 
      v-if="!ozwell.isOpen.value"
      @click="ozwell.open()"
      class="chat-trigger"
    >
      💬 Need help?
    </button>
    
    <OzwellChat 
      :api-key="apiKey"
      :agent-id="agentId"
      :show-trigger="false"
    />
  </div>
</template>

<script setup lang="ts">
import { OzwellChat, useOzwell } from '@ozwell/vue';

const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;

const ozwell = useOzwell();
</script>

<style scoped>
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

### With Pinia Store

```typescript
// stores/chat.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useChatStore = defineStore('chat', () => {
  const messageCount = ref(0);
  const isOpen = ref(false);
  
  function incrementMessages() {
    messageCount.value++;
  }
  
  function setOpen(value: boolean) {
    isOpen.value = value;
  }
  
  return { messageCount, isOpen, incrementMessages, setOpen };
});
```

```vue
<template>
  <OzwellChat 
    :api-key="apiKey"
    :agent-id="agentId"
    @open="chatStore.setOpen(true)"
    @close="chatStore.setOpen(false)"
    @user-share="handleUserShare"
  />
</template>

<script setup lang="ts">
import { OzwellChat } from '@ozwell/vue';
import { useChatStore } from '@/stores/chat';

const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;

const chatStore = useChatStore();

function handleUserShare(data: unknown) {
  // Only fires when user explicitly shares
  console.log('User shared:', data);
}
</script>
```

### Route-Based Visibility

```vue
<template>
  <OzwellChat 
    v-if="showChat"
    :api-key="apiKey"
    :agent-id="agentId"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { OzwellChat } from '@ozwell/vue';

const apiKey = import.meta.env.VITE_OZWELL_API_KEY;
const agentId = import.meta.env.VITE_OZWELL_AGENT_ID;

const route = useRoute();

const hiddenRoutes = ['/checkout', '/auth', '/admin'];
const showChat = computed(() => 
  !hiddenRoutes.some(r => route.path.startsWith(r))
);
</script>
```

---

## Nuxt 3

For Nuxt 3, create a plugin:

```typescript
// plugins/ozwell.client.ts
import { OzwellPlugin } from '@ozwell/vue';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(OzwellPlugin, {
    apiKey: useRuntimeConfig().public.ozwellApiKey,
    agentId: useRuntimeConfig().public.ozwellAgentId,
  });
});
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      ozwellApiKey: process.env.OZWELL_API_KEY,
      ozwellAgentId: process.env.OZWELL_AGENT_ID,
    },
  },
});
```

---

## TypeScript

Full TypeScript support included:

```typescript
import type { 
  OzwellChatProps, 
  Message, 
  OzwellError,
  UseOzwellReturn 
} from '@ozwell/vue';
```

---

## Troubleshooting

### Widget Not Appearing

1. Check that the component is mounted in the DOM
2. Verify API key and agent ID are correct
3. Check browser console for errors

### Context Not Updating

Ensure context is reactive:

```vue
<!-- ✅ Reactive computed -->
<OzwellChat :context="computedContext" />

<!-- ❌ Static object won't update -->
<OzwellChat :context="{ page: route.path }" />
```

### Multiple Instances

Only use one `<OzwellChat />` component per page.

---

## Next Steps

- [Vue 2 Integration](./vue2.md) — For Vue 2 projects
- [Iframe Details](./iframe-integration.md) — Security deep-dive
- [Backend API](../backend/overview.md) — Server-side integration
