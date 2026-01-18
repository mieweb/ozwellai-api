---
sidebar_position: 1
title: Backend Overview
description: Server-side integration with Ozwell's API for custom workflows and automation
---

# Backend Integration Overview

This guide covers server-side integration with Ozwell's API, enabling programmatic access to AI capabilities for custom workflows, automation, and advanced use cases.

> 💡 **Not sure if backend integration is right for you?** Check out our [Integration Paths Guide](../integration-paths.md) to compare all three integration options:
> - **Option 1**: Ozwell Widget (frontend, pre-built UI)
> - **Option 2**: Custom UI + Your Backend (build your own interface)
> - **Option 3**: Backend API Only (automation, no UI)

## Key Concepts

```mermaid
graph TB
    subgraph "Backend Integration"
        Server[Your Server] -->|General-Purpose API Key| API[Ozwell API]
        API --> Chat[Chat Completions]
        API --> Files[File Management]
        API --> Embed[Embeddings]
        API --> Models[Model Management]
        API --> Responses[Responses API]
    end
```

## Authentication

Backend integrations use **general-purpose API keys** that provide full access to Ozwell's capabilities.

```bash
# Example API request with authentication
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Authorization: Bearer ozw_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

⚠️ **Security:** General-purpose API keys should only be used server-side. Never expose them in client-side code, public repositories, or browser environments.

➡️ [Authentication Details](./api-authentication.md)

---

## Available Capabilities

### Chat Completions

Generate AI responses for conversational interactions.

```javascript
import { OzwellClient } from '@ozwell/api';

const client = new OzwellClient({ apiKey: process.env.OZWELL_API_KEY });

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
});

console.log(response.choices[0].message.content);
```

**Features:**
- Multiple model support
- Streaming responses
- Function calling
- Vision capabilities
- Conversation management

### File Management

Upload, retrieve, and manage files for use with the API.

```javascript
const file = await client.files.create({
  file: fs.createReadStream('document.pdf'),
  purpose: 'assistants',
});

console.log('File ID:', file.id);
```

**Use Cases:**
- Document processing
- Training data upload
- Retrieval-augmented generation (RAG)
- File-based conversations

### Embeddings

Generate vector embeddings for semantic search and similarity.

```javascript
const embedding = await client.embeddings.create({
  model: 'text-embedding-ada-002',
  input: 'The quick brown fox jumps over the lazy dog',
});

console.log('Vector dimensions:', embedding.data[0].embedding.length);
```

**Use Cases:**
- Semantic search
- Document clustering
- Recommendation systems
- Content similarity

### Model Management

List and inspect available models.

```javascript
const models = await client.models.list();

for (const model of models.data) {
  console.log(model.id, model.owned_by);
}
```

---

## SDK Installation

### TypeScript / JavaScript

```bash
npm install @ozwell/api
# or
yarn add @ozwell/api
# or
pnpm add @ozwell/api
```

```typescript
import { OzwellClient } from '@ozwell/api';

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
  baseUrl: 'https://api.ozwell.ai/v1', // optional
});
```

### Python (Coming Soon)

```bash
pip install ozwell
```

```python
from ozwell import OzwellClient

client = OzwellClient(api_key=os.environ["OZWELL_API_KEY"])
```

---

## API Compatibility

Ozwell's API is designed for compatibility with the OpenAI API specification. This means:

- **Drop-in replacement** for many OpenAI SDK use cases
- **Familiar patterns** if you've used OpenAI before
- **Easy migration** from existing OpenAI integrations

```typescript
// Most OpenAI SDK code works with minimal changes
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OZWELL_API_KEY,
  baseURL: 'https://api.ozwell.ai/v1',
});

// Use the client as you would with OpenAI
const completion = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

---

## Quick Examples

### Streaming Response

```typescript
const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### Function Calling

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
          },
          required: ['location'],
        },
      },
    },
  ],
});
```

### Error Handling

```typescript
import { OzwellClient, OzwellError } from '@ozwell/api';

try {
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello!' }],
  });
} catch (error) {
  if (error instanceof OzwellError) {
    console.error('API Error:', error.message);
    console.error('Status:', error.status);
    console.error('Code:', error.code);
  } else {
    throw error;
  }
}
```

---

## Security Best Practices

### Environment Variables

Never hardcode API keys:

```bash
# .env
OZWELL_API_KEY=ozw_xxxxxxxxxxxxxxxx
```

```typescript
const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});
```

### Key Rotation

Regularly rotate API keys and use separate keys for different environments:

- `ozw_prod_xxx` — Production
- `ozw_staging_xxx` — Staging
- `ozw_dev_xxx` — Development

### Rate Limiting

Implement proper rate limiting and retry logic:

```typescript
import { OzwellClient } from '@ozwell/api';

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
  maxRetries: 3,
  timeout: 30000,
});
```

---

## Next Steps

1. **Get your API key:** Create a general-purpose key in your dashboard
2. **Install the SDK:** Follow the installation instructions above
3. **Explore endpoints:** See the [API Reference](./api-endpoints.md)
4. **View examples:** Check [code samples](./api-examples.md)

---

## Resources

- [TypeScript SDK](./sdk-typescript.md) — Full TypeScript/Node.js guide
- [Deno SDK](./sdk-deno.md) — Deno and JSR guide
- [Python SDK](./sdk-python.md) — Python guide (Coming Soon)
- [REST API](./rest-api.md) — Direct HTTP access (Go, Ruby, PHP, Java, Rust, C#)
- [API Reference](./api-overview.md) — Complete API documentation
- [Endpoints](./api-endpoints.md) — All available endpoints
- [Authentication](./api-authentication.md) — Auth details and best practices
- [Examples](./api-examples.md) — Code samples and recipes
- [Frontend Integration](../frontend/overview.md) — Client-side embedding
