---
sidebar_position: 1
title: Frontend Overview
description: Integrate Ozwell's privacy-first AI chat into your website or web application
---

# Frontend Integration Overview

Ozwell is an embeddable AI assistant that runs inside an iframe on your website. Users chat with it. The AI can call **tools you define** — JavaScript functions that read from or write to your page. Conversations are private by default; your page only sees tool calls and lifecycle events, never message content.

> **Try it live:** See Ozwell in action at the [demo site](https://ozwellai-embedtest.opensource.mieweb.org/).

## What You're Building

There are two parts: **define tools** on your page so the AI knows what it can do, then **handle tool calls** when the AI invokes them.

### 1. Define Tools and Load the Widget

Your page declares the tools the AI can call — their names, descriptions, and parameter schemas. By default, **an agent can call any tool the page presents**. No server-side configuration needed.

Here's a page that exposes two tools: one that reads the current email (get) and one that updates it (set):

```html
<script>
  window.OzwellChatConfig = {
    apiKey: 'agnt_key-your-agent-key',
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_user_email',
          description: 'Reads the current email address from the page',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'set_user_email',
          description: 'Updates the email address on the page',
          parameters: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'The new email address' }
            },
            required: ['email']
          }
        }
      }
    ]
  };
</script>
<script src="https://ozwell-dev-refserver.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

### 2. Handle Tool Calls

When the AI calls a tool, the loader dispatches an `ozwell-tool-call` event. Listen for it and call `respond()` with the result:

```html
<script>
  document.addEventListener('ozwell-tool-call', (e) => {
    const { name, arguments: args, respond } = e.detail;

    if (name === 'get_user_email') {
      // READ from your page
      respond({ email: document.getElementById('email').value });

    } else if (name === 'set_user_email') {
      // WRITE to your page
      document.getElementById('email').value = args.email;
      respond({ success: true });
    }
  });
</script>
```

**You must call `respond()`.** The AI waits for the result — if you don't respond, the conversation hangs.

### Where Tools Can Be Defined

| Approach | Tools defined in | Best for |
|----------|-----------------|----------|
| **Page-defined** (above) | `OzwellChatConfig.tools` | Pages that declare their own capabilities |
| **Agent-defined** | [Agent definition](../backend/agents.md) server-side | Centrally managed tools with full schemas and descriptions |
| **Both** | Agent definition + `OzwellChatConfig.tools` | Agent owns core tools; page adds context-specific tools |

**How it works:**
- If the agent has **no tools** in its server-side definition, it can call **any tool the page provides**. This is the default.
- If the agent has a **tools list** defined server-side, those tools are always available. The page can provide **additional** tools alongside them.
- Agent-defined tool schemas take priority — if the same tool name appears in both, the agent's definition wins.

### Tool Namespacing

Page-provided tools are automatically prefixed with `postMessage:` on the wire so they can't collide with tools the agent server implements natively. This is transparent to your page — the prefix is added by the loader when the widget discovers tools, and stripped before your `ozwell-tool-call` handler fires. You never see the prefix in your code.

### Controlling Page Tools

By default, agents accept all page-provided tools. The agent definition can restrict this with the `pageTools` field:

```yaml
# Allow all page tools (default — can be omitted)
pageTools: all

# Only allow specific page tools
pageTools:
  restricted:
    - get_user_email
    - set_user_email

# Allow all page tools except these
pageTools:
  blocked:
    - dangerous_tool
```

See [Agent Registration API → pageTools](../backend/agents.md#yaml-fields) for details.

The widget runs in a sandboxed iframe — it cannot touch your DOM, read your cookies, or access your JavaScript directly. Only tool calls and their responses cross the iframe boundary.

➡️ **[Full tutorial with tool calling](./cdn-embed.md#tool-calling)** — the CDN embed guide walks through this step by step.

## Integration Approaches

```mermaid
graph LR
    subgraph Options[" "]
        A[Your Website] --> B{Integration Method}
        B --> C[🚀 CDN Embed]
        B --> D[📦 Framework]
        B --> E[🖼️ Direct Iframe]
        
        C --> C1[Single script tag<br/>Zero build step]
        D --> D1[React / Vue / Svelte<br/>Full control]
        E --> E1[Manual iframe<br/>Custom implementation]
    end
```

## Quick Comparison

| Method | Setup Time | Build Required | Best For |
|--------|------------|----------------|----------|
| [CDN Embed](./cdn-embed.md) | ~5 min | No | Static sites, quick prototypes |
| [Framework](#framework-integration) | ~15 min | Yes | Production SPAs |
| [Iframe](./iframe-integration.md) | ~10 min | Optional | Custom implementations |

---

## CDN Embed (Fastest)

Add Ozwell to any website with a single script tag. No build step required. Supports tool calling out of the box — define what your AI can do, then handle tool calls in a simple event listener.

```html
<script>
  window.OzwellChatConfig = { apiKey: 'agnt_key-your-agent-key' };
</script>
<script src="https://ozwell-dev-refserver.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

➡️ [Full CDN documentation with tool calling tutorial](./cdn-embed.md)

---

## Framework Integration

For production applications using modern JavaScript frameworks, we provide dedicated integration guides:

| Framework | Guide | Status |
|-----------|-------|--------|
| React | [React Integration](./react.md) | ✅ |
| Next.js | [Next.js Integration](./nextjs.md) | ✅ |
| Vue 3 | [Vue 3 Integration](./vue3.md) | ✅ |
| Vue 2 | [Vue 2 Integration](./vue2.md) | ✅ |
| Svelte | [Svelte Integration](./svelte.md) | ✅ |
| Vanilla JS | [Vanilla JS Integration](./vanilla.md) | ✅ |

All framework integrations render Ozwell within an **isolated iframe**, ensuring:

- 🔒 **Security isolation** from your host page
- 🎨 **Consistent styling** that won't conflict with your CSS
- 📱 **Responsive behavior** out of the box

> **Standards-inspired:** Ozwell's iframe architecture implements an *inverted* MCP postMessage transport, drawing from proposals by [Josh Mandel](https://github.com/jmandel) and the [W3C WebMCP](https://github.com/webmachinelearning/webmcp) community. Learn more in [MCP postMessage Standard](./mcp-postmessage-standard.md).

---

## Security Model

### Privacy First

Ozwell is built on a foundation of **user privacy and control**. When a user opens Ozwell, their conversation is private—the host site cannot see, intercept, or log what is said. This creates a safe space where users can:

- Ask any question without embarrassment
- Explore topics freely without surveillance  
- Trust that their dialogue stays between them and Ozwell

**Sharing is always opt-in.** Only when a user explicitly chooses to share information does it become visible to the host site.

### Scoped API Keys

Frontend integrations use **scoped API keys** which are:

- ✅ **Agent-specific:** Tied to a single agent configuration
- ✅ **Permission-limited:** Only allows operations the agent is authorized for
- ✅ **Rate-limited:** Protected against abuse
- ✅ **Revocable:** Can be rotated or disabled without affecting other keys

```mermaid
graph TB
    subgraph "Security Architecture"
        Key[Scoped API Key] --> Agent[Agent Configuration]
        Agent --> Perms[Allowed Actions]
        Agent --> Models[Allowed Models]
        Agent --> Files[Accessible Files]
        
        Perms --> P1[Chat Only]
        Perms --> P2[File Read]
        Perms --> P3[Custom Actions]
    end
```

### Iframe Isolation

All frontend integrations run inside an iframe with:

- **Sandboxed execution** — No access to parent page DOM
- **Origin isolation** — Separate security context
- **CSP compliance** — Strict content security policies
- **No message relay** — Conversation content stays in the iframe
- **User-controlled sharing** — Only explicit user actions can share data

➡️ [Learn more about iframe security](./iframe-integration.md)

---

## Customization Options

### Appearance

| Option | Description | Default |
|--------|-------------|---------|
| `theme` | Light or dark mode | `auto` |
| `primaryColor` | Accent color for buttons/links | `#4f46e5` |
| `position` | Widget position (bottom-right, bottom-left, etc.) | `bottom-right` |
| `width` | Chat window width | `400px` |
| `height` | Chat window height | `600px` |

### Behavior

| Option | Description | Default |
|--------|-------------|---------|
| `autoOpen` | Open chat on page load | `false` |
| `greeting` | Initial message to display | Agent's default |
| `placeholder` | Input field placeholder text | `"Type a message..."` |

---

## Privacy by Design

**The conversation between Ozwell and the user is private by default.**

```mermaid
graph TB
    subgraph "Privacy Model"
        User[👤 User] <-->|Private Conversation| Ozwell[🤖 Ozwell]
        Site[🌐 Host Site] -.->|Cannot Inspect| Ozwell
        
        User -->|Explicit Consent| Share[📤 Share with Site]
        Share --> Site
    end
```

### Why Privacy Matters

- **No message relay:** Conversation content is never sent to the host site
- **Safe space:** Users can ask any question without fear of judgment or surveillance
- **User control:** Only the user decides if and when to share conversation details
- **Trust:** The Ozwell brand stands for privacy and user empowerment

### What the Host Site Can See

The host site receives **only lifecycle events**, never message content:

```javascript
// ✅ Allowed: Lifecycle events (no content)
window.addEventListener('ozwell:ready', () => {
  console.log('Ozwell widget loaded');
});

window.addEventListener('ozwell:open', () => {
  console.log('Chat opened');
});

window.addEventListener('ozwell:close', () => {
  console.log('Chat closed');
});

// ❌ Not available: Message content is private
// window.addEventListener('ozwell:message', ...) — Does not exist
```

### User-Initiated Sharing

If the user explicitly chooses to share information with the host site, they can do so through in-chat actions:

```javascript
// Only triggered when user clicks "Share with site" in chat
window.addEventListener('ozwell:user-share', (event) => {
  // User explicitly consented to share this specific data
  console.log('User shared:', event.detail);
});
```

This ensures users always feel comfortable asking questions—even ones they might consider "dumb"—knowing the conversation stays between them and Ozwell.

---

## Next Steps

1. **Quick start:** Try the [CDN embed](./cdn-embed.md) first
2. **Production app:** Follow your framework guide above
3. **Custom needs:** Review [iframe integration](./iframe-integration.md)
4. **Standards context:** Read about the [MCP postMessage Standard](./mcp-postmessage-standard.md) that inspired Ozwell's architecture
5. **Security deep-dive:** Understand the [iframe security model](./iframe-integration.md#security--privacy-checklist)
