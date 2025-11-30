# Deno SDK

The official Ozwell SDK for Deno runtime, with first-class TypeScript support and no build step required.

## Installation

Import directly from JSR (JavaScript Registry):

```typescript
import { OzwellClient } from "jsr:@ozwell/api";
```

Or add to your `deno.json`:

```json
{
  "imports": {
    "@ozwell/api": "jsr:@ozwell/api@^1.0.0"
  }
}
```

Then import:

```typescript
import { OzwellClient } from "@ozwell/api";
```

---

## Quick Start

```typescript
import { OzwellClient } from "jsr:@ozwell/api";

const client = new OzwellClient({
  apiKey: Deno.env.get("OZWELL_API_KEY"),
});

const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "user", content: "Hello from Deno!" },
  ],
});

console.log(response.choices[0].message.content);
```

Run with:

```bash
deno run --allow-env --allow-net main.ts
```

---

## Configuration

### Client Options

```typescript
import { OzwellClient } from "jsr:@ozwell/api";

const client = new OzwellClient({
  apiKey: Deno.env.get("OZWELL_API_KEY"),
  baseUrl: "https://api.ozwell.ai/v1",  // Optional
  timeout: 30000,                         // Optional
  maxRetries: 3,                          // Optional
});
```

### Environment Variables

Create a `.env` file:

```bash
OZWELL_API_KEY=ozw_xxxxxxxxxxxxxxxx
```

Load with `--allow-env` flag or use [dotenv](https://deno.land/std/dotenv):

```typescript
import "jsr:@std/dotenv/load";
import { OzwellClient } from "jsr:@ozwell/api";

const client = new OzwellClient({
  apiKey: Deno.env.get("OZWELL_API_KEY"),
});
```

---

## Permissions

Deno requires explicit permissions. The SDK needs:

| Permission | Flag | Purpose |
|------------|------|---------|
| Network | `--allow-net` | API requests |
| Environment | `--allow-env` | Read API key |
| Read | `--allow-read` | File uploads (optional) |

```bash
# Minimal permissions
deno run --allow-env=OZWELL_API_KEY --allow-net=api.ozwell.ai main.ts

# Or allow all needed
deno run --allow-env --allow-net --allow-read main.ts
```

---

## Chat Completions

### Basic Chat

```typescript
const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a Deno expert." },
    { role: "user", content: "What makes Deno different from Node.js?" },
  ],
});

console.log(response.choices[0].message.content);
```

### Streaming

```typescript
const stream = await client.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a haiku about Deno" }],
  stream: true,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    await Deno.stdout.write(new TextEncoder().encode(content));
  }
}
console.log(); // Newline at end
```

### With Parameters

```typescript
const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Be creative" }],
  temperature: 1.2,
  max_tokens: 500,
  top_p: 0.9,
});
```

---

## Function Calling

```typescript
const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "What's the weather in Paris?" }],
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name" },
          },
          required: ["location"],
        },
      },
    },
  ],
});

const toolCalls = response.choices[0].message.tool_calls;
if (toolCalls) {
  for (const call of toolCalls) {
    console.log("Function:", call.function.name);
    console.log("Args:", call.function.arguments);
  }
}
```

---

## Embeddings

```typescript
const response = await client.embeddings.create({
  model: "text-embedding-ada-002",
  input: "Deno is a secure runtime for JavaScript and TypeScript.",
});

console.log("Vector length:", response.data[0].embedding.length);
```

### Batch Embeddings

```typescript
const response = await client.embeddings.create({
  model: "text-embedding-ada-002",
  input: [
    "First document",
    "Second document",
    "Third document",
  ],
});

for (const item of response.data) {
  console.log(`Index ${item.index}: ${item.embedding.length} dimensions`);
}
```

---

## Files

### Upload File

```typescript
const fileContent = await Deno.readFile("./document.pdf");
const blob = new Blob([fileContent], { type: "application/pdf" });

const file = await client.files.create({
  file: blob,
  purpose: "assistants",
});

console.log("Uploaded:", file.id);
```

### Using File Path

```typescript
const file = await client.files.upload("./document.pdf", "assistants");
console.log("Uploaded:", file.id);
```

### List and Delete

```typescript
// List files
const files = await client.files.list();
for (const file of files.data) {
  console.log(`${file.id}: ${file.filename}`);
}

// Delete file
await client.files.delete("file-abc123");
```

---

## Error Handling

```typescript
import { OzwellClient, OzwellError, RateLimitError } from "jsr:@ozwell/api";

try {
  const response = await client.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: "Hello" }],
  });
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error("Rate limited. Retry after:", error.retryAfter);
  } else if (error instanceof OzwellError) {
    console.error("API error:", error.message);
    console.error("Status:", error.status);
  } else {
    throw error;
  }
}
```

---

## Oak Framework Integration

Using [Oak](https://deno.land/x/oak) web framework:

```typescript
import { Application, Router } from "jsr:@oak/oak";
import { OzwellClient } from "jsr:@ozwell/api";

const client = new OzwellClient({
  apiKey: Deno.env.get("OZWELL_API_KEY"),
});

const router = new Router();

router.post("/api/chat", async (ctx) => {
  const { messages } = await ctx.request.body.json();
  
  const response = await client.chat.completions.create({
    model: "gpt-4",
    messages,
  });
  
  ctx.response.body = {
    message: response.choices[0].message.content,
  };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

console.log("Server running on http://localhost:8000");
await app.listen({ port: 8000 });
```

Run with:

```bash
deno run --allow-env --allow-net server.ts
```

---

## Fresh Framework Integration

For [Fresh](https://fresh.deno.dev/) apps, create an API route:

```typescript
// routes/api/chat.ts
import { Handlers } from "$fresh/server.ts";
import { OzwellClient } from "jsr:@ozwell/api";

const client = new OzwellClient({
  apiKey: Deno.env.get("OZWELL_API_KEY"),
});

export const handler: Handlers = {
  async POST(req) {
    const { messages } = await req.json();
    
    const response = await client.chat.completions.create({
      model: "gpt-4",
      messages,
    });
    
    return new Response(
      JSON.stringify({ message: response.choices[0].message.content }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};
```

---

## Hono Framework Integration

Using [Hono](https://hono.dev/):

```typescript
import { Hono } from "jsr:@hono/hono";
import { OzwellClient } from "jsr:@ozwell/api";

const app = new Hono();
const client = new OzwellClient({
  apiKey: Deno.env.get("OZWELL_API_KEY"),
});

app.post("/api/chat", async (c) => {
  const { messages } = await c.req.json();
  
  const response = await client.chat.completions.create({
    model: "gpt-4",
    messages,
  });
  
  return c.json({ message: response.choices[0].message.content });
});

Deno.serve(app.fetch);
```

---

## Testing

```typescript
// chat_test.ts
import { assertEquals } from "jsr:@std/assert";
import { OzwellClient } from "jsr:@ozwell/api";

Deno.test("chat completion works", async () => {
  const client = new OzwellClient({
    apiKey: Deno.env.get("OZWELL_API_KEY"),
  });
  
  const response = await client.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: "Say 'test'" }],
    max_tokens: 10,
  });
  
  assertEquals(response.choices.length, 1);
  assertEquals(typeof response.choices[0].message.content, "string");
});
```

Run tests:

```bash
deno test --allow-env --allow-net
```

---

## Type Definitions

All types are exported and available:

```typescript
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  FileObject,
} from "jsr:@ozwell/api";
```

---

## Comparison with Node.js SDK

| Feature | Deno | Node.js |
|---------|------|---------|
| Import | `jsr:@ozwell/api` | `npm:@ozwell/api` |
| Env vars | `Deno.env.get()` | `process.env` |
| File read | `Deno.readFile()` | `fs.readFileSync()` |
| Permissions | Explicit flags | None required |
| TypeScript | Native | Requires build |

---

## See Also

- [TypeScript SDK](./sdk-typescript.md) — For Node.js
- [REST API](./rest-api.md) — Direct HTTP usage
- [API Endpoints](./api-endpoints.md) — Complete reference
