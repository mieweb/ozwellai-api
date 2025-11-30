# Vue 2 Integration

Integrate Ozwell into your Vue 2 application with the Options API pattern.

## Installation

```bash
npm install @ozwell/vue2
# or
yarn add @ozwell/vue2
```

## Quick Start

### Option 1: Plugin (Recommended)

Register the plugin globally:

```javascript
// main.js
import Vue from 'vue';
import OzwellPlugin from '@ozwell/vue2';
import App from './App.vue';

Vue.use(OzwellPlugin, {
  apiKey: process.env.VUE_APP_OZWELL_API_KEY,
  agentId: process.env.VUE_APP_OZWELL_AGENT_ID,
});

new Vue({
  render: h => h(App),
}).$mount('#app');
```

Use the component anywhere:

```vue
<template>
  <div>
    <h1>My App</h1>
    <ozwell-chat />
  </div>
</template>
```

### Option 2: Local Component Registration

```vue
<template>
  <div>
    <h1>My App</h1>
    <ozwell-chat 
      :api-key="apiKey"
      :agent-id="agentId"
      theme="auto"
    />
  </div>
</template>

<script>
import { OzwellChat } from '@ozwell/vue2';

export default {
  name: 'App',
  components: {
    OzwellChat,
  },
  data() {
    return {
      apiKey: process.env.VUE_APP_OZWELL_API_KEY,
      agentId: process.env.VUE_APP_OZWELL_AGENT_ID,
    };
  },
};
</script>
```

---

## Component API

### `<ozwell-chat />`

```vue
<template>
  <ozwell-chat
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
| `apiKey` | `String` | *required* | Scoped API key |
| `agentId` | `String` | *required* | Agent ID |
| `theme` | `String` | `'auto'` | `'light'`, `'dark'`, or `'auto'` |
| `position` | `String` | `'bottom-right'` | `'bottom-right'` or `'bottom-left'` |
| `primaryColor` | `String` | `'#4f46e5'` | Accent color |
| `width` | `String` | `'400px'` | Chat window width |
| `height` | `String` | `'600px'` | Chat window height |
| `autoOpen` | `Boolean` | `false` | Open on mount |
| `greeting` | `String` | Agent default | Initial message |
| `placeholder` | `String` | `'Type a message...'` | Input placeholder |
| `context` | `Object` | `{}` | Context data for agent |

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

## Instance Methods

Access the Ozwell instance via `$ozwell`:

```vue
<template>
  <div>
    <button @click="openChat">Open Chat</button>
    <button @click="closeChat">Close Chat</button>
    <button @click="sendHello">Send Hello</button>
    
    <ozwell-chat :api-key="apiKey" :agent-id="agentId" />
  </div>
</template>

<script>
export default {
  data() {
    return {
      apiKey: process.env.VUE_APP_OZWELL_API_KEY,
      agentId: process.env.VUE_APP_OZWELL_AGENT_ID,
    };
  },
  methods: {
    openChat() {
      this.$ozwell.open();
    },
    closeChat() {
      this.$ozwell.close();
    },
    sendHello() {
      this.$ozwell.sendMessage('Hello!');
    },
  },
};
</script>
```

### Available Methods

| Method | Arguments | Description |
|--------|-----------|-------------|
| `open()` | — | Open the chat window |
| `close()` | — | Close the chat window |
| `toggle()` | — | Toggle open/closed |
| `sendMessage(content)` | `string` | Send a message |
| `setContext(context)` | `object` | Update context data |

### Reactive Properties

| Property | Type | Description |
|----------|------|-------------|
| `$ozwell.isReady` | `boolean` | Widget initialized |
| `$ozwell.isOpen` | `boolean` | Chat window open |

---

## Examples

### With Vue Router Context

```vue
<template>
  <ozwell-chat 
    :api-key="apiKey"
    :agent-id="agentId"
    :context="context"
  />
</template>

<script>
export default {
  data() {
    return {
      apiKey: process.env.VUE_APP_OZWELL_API_KEY,
      agentId: process.env.VUE_APP_OZWELL_AGENT_ID,
    };
  },
  computed: {
    context() {
      return {
        page: this.$route.path,
        query: this.$route.query,
        timestamp: Date.now(),
      };
    },
  },
};
</script>
```

### With Vuex Store

```vue
<template>
  <ozwell-chat 
    :api-key="apiKey"
    :agent-id="agentId"
    :context="context"
    @open="onOpen"
    @close="onClose"
    @user-share="onUserShare"
  />
</template>

<script>
import { mapState, mapMutations } from 'vuex';

export default {
  data() {
    return {
      apiKey: process.env.VUE_APP_OZWELL_API_KEY,
      agentId: process.env.VUE_APP_OZWELL_AGENT_ID,
    };
  },
  computed: {
    ...mapState('user', ['user']),
    context() {
      return {
        userId: this.user?.id,
        email: this.user?.email,
      };
    },
  },
  methods: {
    ...mapMutations('chat', ['SET_OPEN']),
    onOpen() {
      this.SET_OPEN(true);
    },
    onClose() {
      this.SET_OPEN(false);
    },
    onUserShare(data) {
      // Only fires when user explicitly shares
      console.log('User shared:', data);
    },
  },
};
</script>
```

### Custom Trigger Button

```vue
<template>
  <div>
    <button 
      v-if="!$ozwell.isOpen"
      @click="$ozwell.open()"
      class="chat-trigger"
    >
      💬 Need help?
    </button>
    
    <ozwell-chat 
      :api-key="apiKey"
      :agent-id="agentId"
      :show-trigger="false"
    />
  </div>
</template>

<script>
export default {
  data() {
    return {
      apiKey: process.env.VUE_APP_OZWELL_API_KEY,
      agentId: process.env.VUE_APP_OZWELL_AGENT_ID,
    };
  },
};
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

### Conditional Rendering by Route

```vue
<template>
  <ozwell-chat 
    v-if="showChat"
    :api-key="apiKey"
    :agent-id="agentId"
  />
</template>

<script>
export default {
  data() {
    return {
      apiKey: process.env.VUE_APP_OZWELL_API_KEY,
      agentId: process.env.VUE_APP_OZWELL_AGENT_ID,
      hiddenRoutes: ['/checkout', '/auth', '/admin'],
    };
  },
  computed: {
    showChat() {
      return !this.hiddenRoutes.some(route => 
        this.$route.path.startsWith(route)
      );
    },
  },
};
</script>
```

---

## Nuxt 2

For Nuxt 2, create a plugin:

```javascript
// plugins/ozwell.client.js
import Vue from 'vue';
import OzwellPlugin from '@ozwell/vue2';

export default function ({ $config }) {
  Vue.use(OzwellPlugin, {
    apiKey: $config.ozwellApiKey,
    agentId: $config.ozwellAgentId,
  });
}
```

```javascript
// nuxt.config.js
export default {
  plugins: [
    { src: '~/plugins/ozwell.client.js', mode: 'client' },
  ],
  publicRuntimeConfig: {
    ozwellApiKey: process.env.OZWELL_API_KEY,
    ozwellAgentId: process.env.OZWELL_AGENT_ID,
  },
};
```

---

## TypeScript

For TypeScript projects, add type declarations:

```typescript
// shims-ozwell.d.ts
import Vue from 'vue';

declare module 'vue/types/vue' {
  interface Vue {
    $ozwell: {
      isReady: boolean;
      isOpen: boolean;
      open(): void;
      close(): void;
      toggle(): void;
      sendMessage(content: string): void;
      setContext(context: Record<string, unknown>): void;
    };
  }
}
```

---

## Migration to Vue 3

When upgrading to Vue 3:

1. Replace `@ozwell/vue2` with `@ozwell/vue`
2. Use Composition API patterns (`useOzwell()` composable)
3. Update plugin registration syntax
4. Replace `this.$ozwell` with composable calls

See [Vue 3 Integration](./vue3.md) for details.

---

## Troubleshooting

### Widget Not Appearing

1. Check that Vue plugin is registered before app mount
2. Verify API key and agent ID are correct
3. Check browser console for errors

### `$ozwell` is undefined

Ensure the plugin is registered:

```javascript
// ✅ Correct order
Vue.use(OzwellPlugin, { ... });
new Vue({ ... }).$mount('#app');

// ❌ Wrong order
new Vue({ ... }).$mount('#app');
Vue.use(OzwellPlugin, { ... });
```

### Context Not Updating

Use computed properties for reactive context:

```javascript
// ✅ Reactive
computed: {
  context() {
    return { page: this.$route.path };
  }
}

// ❌ Static
data() {
  return {
    context: { page: this.$route.path }
  };
}
```

---

## Next Steps

- [Vue 3 Integration](./vue3.md) — For Vue 3 projects
- [Iframe Details](./iframe-integration.md) — Security deep-dive
- [Backend API](../backend/overview.md) — Server-side integration
