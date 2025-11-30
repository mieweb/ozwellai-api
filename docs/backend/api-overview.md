# Backend API Documentation

This section provides complete documentation for Ozwell's backend API, enabling server-side integration and custom workflows.

## Overview

Ozwell's API follows the OpenAI API specification, providing a familiar interface for developers. The API supports:

- **Chat Completions** — Conversational AI interactions
- **File Management** — Upload and manage files
- **Embeddings** — Generate vector embeddings
- **Models** — List and inspect available models
- **Responses** — Extended response format with additional metadata

## Quick Links

| Resource | Description |
|----------|-------------|
| [Endpoints](./api-endpoints.md) | Complete API endpoint documentation |
| [Authentication](./api-authentication.md) | API keys and authentication |
| [Examples](./api-examples.md) | Code samples and recipes |

---

## Getting Started

### 1. Get Your API Key

1. Log in to your Ozwell dashboard
2. Navigate to **Settings → API Keys**
3. Click **Create API Key**
4. Copy the generated key (starts with `ozw_`)

### 2. Install the SDK

```bash
npm install @ozwell/api
```

### 3. Make Your First Request

```typescript
import { OzwellClient } from '@ozwell/api';

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'Hello, Ozwell!' }
  ],
});

console.log(response.choices[0].message.content);
```

---

## Base URL

All API requests should be made to:

```
https://api.ozwell.ai/v1
```

For self-hosted deployments, use your custom base URL.

---

## Request Format

All requests must include:

- **Authorization header** with your API key
- **Content-Type: application/json** for request bodies

```bash
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Authorization: Bearer ozw_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'
```

---

## Response Format

Successful responses return JSON:

```json
{
  "id": "chatcmpl-xxxxxxxx",
  "object": "chat.completion",
  "created": 1699000000,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 12,
    "total_tokens": 22
  }
}
```

---

## Error Handling

Errors return a JSON object with error details:

```json
{
  "error": {
    "message": "Invalid API key provided",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `400` | Bad Request — Invalid parameters |
| `401` | Unauthorized — Invalid or missing API key |
| `403` | Forbidden — Insufficient permissions |
| `404` | Not Found — Resource doesn't exist |
| `429` | Rate Limited — Too many requests |
| `500` | Server Error — Internal error |

---

## Rate Limits

API requests are rate-limited based on your plan:

| Plan | Requests/min | Tokens/min |
|------|--------------|------------|
| Free | 20 | 10,000 |
| Pro | 100 | 100,000 |
| Enterprise | Custom | Custom |

When rate limited, you'll receive a `429` response with retry information in headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699000060
Retry-After: 30
```

---

## Streaming

For long responses, use streaming to receive chunks as they're generated:

```typescript
const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    process.stdout.write(content);
  }
}
```

---

## SDKs & Libraries

### Official SDKs

| Language | Package | Status |
|----------|---------|--------|
| TypeScript/JS | `@ozwell/api` | ✅ Available |
| Python | `ozwell` | 🚧 Coming Soon |

### OpenAI SDK Compatibility

You can use the official OpenAI SDK with Ozwell:

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OZWELL_API_KEY,
  baseURL: 'https://api.ozwell.ai/v1',
});
```

---

## Next Steps

- [Endpoints Reference](./api-endpoints.md)
- [Authentication Guide](./api-authentication.md)
- [Code Examples](./api-examples.md)
