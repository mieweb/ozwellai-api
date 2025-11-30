# TypeScript SDK

The official Ozwell TypeScript SDK for Node.js applications.

## Installation

```bash
npm install @ozwell/api
# or
yarn add @ozwell/api
# or
pnpm add @ozwell/api
```

## Quick Start

```typescript
import { OzwellClient } from '@ozwell/api';

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ],
});

console.log(response.choices[0].message.content);
```

---

## Configuration

### Client Options

```typescript
import { OzwellClient } from '@ozwell/api';

const client = new OzwellClient({
  // Required
  apiKey: process.env.OZWELL_API_KEY,
  
  // Optional
  baseUrl: 'https://api.ozwell.ai/v1',  // Custom API endpoint
  timeout: 30000,                         // Request timeout in ms
  maxRetries: 3,                          // Automatic retry count
  defaultHeaders: {                       // Custom headers
    'X-Custom-Header': 'value',
  },
});
```

### Environment Variables

```bash
# .env
OZWELL_API_KEY=ozw_xxxxxxxxxxxxxxxx
OZWELL_BASE_URL=https://api.ozwell.ai/v1  # Optional
```

```typescript
// The SDK automatically reads OZWELL_API_KEY from environment
const client = new OzwellClient();
```

---

## Chat Completions

### Basic Chat

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'What is TypeScript?' },
  ],
});

console.log(response.choices[0].message.content);
```

### With System Prompt

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a TypeScript expert. Be concise.' },
    { role: 'user', content: 'Explain generics in one sentence.' },
  ],
});
```

### Multi-Turn Conversation

```typescript
const messages: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
];

// First turn
messages.push({ role: 'user', content: 'What is Node.js?' });
const response1 = await client.chat.completions.create({
  model: 'gpt-4',
  messages,
});
messages.push(response1.choices[0].message);

// Second turn
messages.push({ role: 'user', content: 'What are its main use cases?' });
const response2 = await client.chat.completions.create({
  model: 'gpt-4',
  messages,
});
```

### Streaming

```typescript
const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Write a poem about coding' }],
  stream: true,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    process.stdout.write(content);
  }
}
```

### With Parameters

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Generate a creative story' }],
  temperature: 1.2,        // More creative (0-2)
  max_tokens: 500,         // Limit response length
  top_p: 0.9,              // Nucleus sampling
  frequency_penalty: 0.5,  // Reduce repetition
  presence_penalty: 0.5,   // Encourage new topics
  stop: ['\n\n'],          // Stop sequences
});
```

---

## Function Calling

### Define Functions

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name, e.g., Tokyo, Japan',
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: 'Temperature unit',
            },
          },
          required: ['location'],
        },
      },
    },
  ],
  tool_choice: 'auto',
});

// Check if model wants to call a function
const toolCalls = response.choices[0].message.tool_calls;
if (toolCalls) {
  for (const call of toolCalls) {
    console.log('Function:', call.function.name);
    console.log('Args:', JSON.parse(call.function.arguments));
  }
}
```

### Complete Function Flow

```typescript
import { ChatMessage } from '@ozwell/api';

async function chatWithFunctions(userMessage: string) {
  const messages: ChatMessage[] = [
    { role: 'user', content: userMessage },
  ];

  const tools = [
    {
      type: 'function' as const,
      function: {
        name: 'get_weather',
        description: 'Get weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
          required: ['location'],
        },
      },
    },
  ];

  // First request
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages,
    tools,
  });

  const assistantMessage = response.choices[0].message;
  messages.push(assistantMessage);

  // Handle tool calls
  if (assistantMessage.tool_calls) {
    for (const toolCall of assistantMessage.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      
      // Execute your function
      const result = await getWeather(args.location);
      
      // Add tool result to messages
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    // Get final response
    const finalResponse = await client.chat.completions.create({
      model: 'gpt-4',
      messages,
    });

    return finalResponse.choices[0].message.content;
  }

  return assistantMessage.content;
}
```

---

## Embeddings

### Single Text

```typescript
const response = await client.embeddings.create({
  model: 'text-embedding-ada-002',
  input: 'Hello, world!',
});

const vector = response.data[0].embedding;
console.log('Dimensions:', vector.length);
```

### Batch Embeddings

```typescript
const texts = [
  'First document',
  'Second document',
  'Third document',
];

const response = await client.embeddings.create({
  model: 'text-embedding-ada-002',
  input: texts,
});

response.data.forEach((item, i) => {
  console.log(`Text ${i}: ${item.embedding.length} dimensions`);
});
```

---

## Files

### Upload

```typescript
import fs from 'fs';

const file = await client.files.create({
  file: fs.createReadStream('document.pdf'),
  purpose: 'assistants',
});

console.log('File ID:', file.id);
```

### List

```typescript
const files = await client.files.list();

for (const file of files.data) {
  console.log(`${file.id}: ${file.filename}`);
}
```

### Retrieve & Delete

```typescript
// Get file info
const file = await client.files.retrieve('file-abc123');

// Download content
const content = await client.files.content('file-abc123');

// Delete
await client.files.delete('file-abc123');
```

---

## Error Handling

### Error Types

```typescript
import { OzwellClient, OzwellError, APIError, RateLimitError } from '@ozwell/api';

try {
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  });
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error('Rate limited. Retry after:', error.retryAfter);
  } else if (error instanceof APIError) {
    console.error('API error:', error.status, error.message);
  } else if (error instanceof OzwellError) {
    console.error('Ozwell error:', error.message);
  } else {
    throw error;
  }
}
```

### Retry Logic

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof RateLimitError && i < maxRetries - 1) {
        const delay = error.retryAfter ?? Math.pow(2, i) * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

const response = await withRetry(() =>
  client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  })
);
```

---

## TypeScript Types

### Importing Types

```typescript
import type {
  OzwellClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  FileObject,
  Model,
  OzwellError,
} from '@ozwell/api';
```

### Typed Requests

```typescript
const request: ChatCompletionRequest = {
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' },
  ],
  temperature: 0.7,
  max_tokens: 100,
};

const response: ChatCompletionResponse = await client.chat.completions.create(request);
```

---

## Express.js Integration

```typescript
import express from 'express';
import { OzwellClient } from '@ozwell/api';

const app = express();
app.use(express.json());

const client = new OzwellClient();

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages,
    });
    
    res.json({ message: response.choices[0].message.content });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Chat failed' });
  }
});

app.listen(3000, () => console.log('Server running on :3000'));
```

---

## See Also

- [Deno SDK](./sdk-deno.md) — For Deno runtime
- [API Endpoints](./api-endpoints.md) — Complete endpoint reference
- [Examples](./api-examples.md) — More code samples
