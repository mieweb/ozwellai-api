# API Examples

Practical code examples for common Ozwell API use cases.

## Chat Completions

### Basic Conversation

```typescript
import { OzwellClient } from '@ozwell/api';

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is machine learning?' },
  ],
});

console.log(response.choices[0].message.content);
```

### Multi-Turn Conversation

```typescript
const messages = [
  { role: 'system', content: 'You are a helpful coding assistant.' },
];

// First turn
messages.push({ role: 'user', content: 'How do I read a file in Node.js?' });

const response1 = await client.chat.completions.create({
  model: 'gpt-4',
  messages,
});

messages.push(response1.choices[0].message);

// Second turn
messages.push({ role: 'user', content: 'What about async/await?' });

const response2 = await client.chat.completions.create({
  model: 'gpt-4',
  messages,
});

console.log(response2.choices[0].message.content);
```

### Streaming Response

```typescript
const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'Write a haiku about programming' },
  ],
  stream: true,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    process.stdout.write(content);
  }
}
console.log(); // New line at end
```

### With Temperature Control

```typescript
// Creative output (higher temperature)
const creative = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Write a creative story opening' }],
  temperature: 1.2,
});

// Deterministic output (lower temperature)
const deterministic = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
  temperature: 0,
});
```

---

## Function Calling

### Basic Function

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'What is the weather in San Francisco?' },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather in a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g., San Francisco, CA',
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
});

// Check if the model wants to call a function
const toolCalls = response.choices[0].message.tool_calls;
if (toolCalls) {
  for (const toolCall of toolCalls) {
    console.log('Function:', toolCall.function.name);
    console.log('Arguments:', toolCall.function.arguments);
  }
}
```

### Complete Function Calling Flow

```typescript
// Step 1: Send user message with tools
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'What is the weather in Paris and London?' },
  ],
  tools: [
    {
      type: 'function',
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
  ],
});

// Step 2: Process tool calls
const toolCalls = response.choices[0].message.tool_calls;
const messages = [
  { role: 'user', content: 'What is the weather in Paris and London?' },
  response.choices[0].message, // Include assistant message with tool calls
];

// Step 3: Execute functions and add results
for (const toolCall of toolCalls) {
  const args = JSON.parse(toolCall.function.arguments);
  
  // Simulate function execution
  const result = {
    location: args.location,
    temperature: Math.floor(Math.random() * 20) + 10,
    condition: 'Partly cloudy',
  };
  
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  });
}

// Step 4: Get final response
const finalResponse = await client.chat.completions.create({
  model: 'gpt-4',
  messages,
});

console.log(finalResponse.choices[0].message.content);
```

---

## Embeddings

### Single Text Embedding

```typescript
const embedding = await client.embeddings.create({
  model: 'text-embedding-ada-002',
  input: 'Machine learning is a subset of artificial intelligence.',
});

console.log('Dimensions:', embedding.data[0].embedding.length);
```

### Batch Embeddings

```typescript
const texts = [
  'The cat sat on the mat.',
  'Dogs are loyal companions.',
  'Machine learning is powerful.',
];

const embeddings = await client.embeddings.create({
  model: 'text-embedding-ada-002',
  input: texts,
});

embeddings.data.forEach((item, index) => {
  console.log(`Text ${index}: ${item.embedding.length} dimensions`);
});
```

### Similarity Search

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Get embeddings
const queryEmbedding = await client.embeddings.create({
  model: 'text-embedding-ada-002',
  input: 'How do I train a model?',
});

const documentEmbeddings = await client.embeddings.create({
  model: 'text-embedding-ada-002',
  input: [
    'Training neural networks requires data and compute.',
    'Cats are fluffy animals.',
    'Model training involves optimization algorithms.',
  ],
});

// Find most similar
const queryVector = queryEmbedding.data[0].embedding;
const similarities = documentEmbeddings.data.map((doc, index) => ({
  index,
  similarity: cosineSimilarity(queryVector, doc.embedding),
}));

similarities.sort((a, b) => b.similarity - a.similarity);
console.log('Most similar:', similarities[0]);
```

---

## File Management

### Upload a File

```typescript
import fs from 'fs';

const file = await client.files.create({
  file: fs.createReadStream('document.pdf'),
  purpose: 'assistants',
});

console.log('File ID:', file.id);
console.log('Size:', file.bytes, 'bytes');
```

### List Files

```typescript
const files = await client.files.list();

for (const file of files.data) {
  console.log(`${file.id}: ${file.filename} (${file.purpose})`);
}
```

### Download File Content

```typescript
const content = await client.files.content('file-abc123');
fs.writeFileSync('downloaded.pdf', content);
```

### Delete a File

```typescript
await client.files.delete('file-abc123');
console.log('File deleted');
```

---

## Error Handling

### Basic Error Handling

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

### Retry with Exponential Backoff

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof OzwellError) {
        // Don't retry client errors (4xx except 429)
        if (error.status >= 400 && error.status < 500 && error.status !== 429) {
          throw error;
        }
        
        // Retry rate limits and server errors
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const response = await withRetry(() =>
  client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello!' }],
  })
);
```

---

## Express.js Integration

### Chat Endpoint

```typescript
import express from 'express';
import { OzwellClient } from '@ozwell/api';

const app = express();
app.use(express.json());

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages,
    });
    
    res.json({
      message: response.choices[0].message.content,
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Chat failed' });
  }
});

app.listen(3000);
```

### Streaming Endpoint

```typescript
app.post('/api/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  try {
    const { messages } = req.body;
    
    const stream = await client.chat.completions.create({
      model: 'gpt-4',
      messages,
      stream: true,
    });
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
    res.end();
  }
});
```

---

## Python Examples (Coming Soon)

```python
from ozwell import OzwellClient
import os

client = OzwellClient(api_key=os.environ["OZWELL_API_KEY"])

# Basic chat
response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

---

## See Also

- [Endpoints Reference](./api-endpoints.md)
- [Authentication](./api-authentication.md)
- [Backend Overview](./overview.md)
