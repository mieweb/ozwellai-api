# REST API

Direct HTTP access to the Ozwell API without any SDK. Use this when working with languages without an official SDK, or when you need full control over HTTP requests.

## Base URL

```
https://api.ozwell.ai/v1
```

---

## Authentication

Include your API key in the `Authorization` header:

```
Authorization: Bearer ozw_xxxxxxxxxxxxxxxx
```

---

## Request Format

All requests should include:

```
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

---

## Chat Completions

### Create Chat Completion

```bash
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

**Response:**

```json
{
  "id": "chatcmpl-abc123",
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
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

### With Parameters

```bash
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Write a creative story"}
    ],
    "temperature": 1.2,
    "max_tokens": 500,
    "top_p": 0.9,
    "frequency_penalty": 0.5,
    "presence_penalty": 0.5
  }'
```

### Streaming

```bash
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

**Streaming Response (Server-Sent Events):**

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699000000,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699000000,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Once"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699000000,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" upon"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1699000000,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Function Calling

```bash
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "What is the weather in Paris?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get weather for a location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "City name"
              }
            },
            "required": ["location"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
```

**Response with Tool Call:**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\": \"Paris\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

### Submit Tool Result

```bash
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "What is the weather in Paris?"},
      {
        "role": "assistant",
        "content": null,
        "tool_calls": [{
          "id": "call_abc123",
          "type": "function",
          "function": {"name": "get_weather", "arguments": "{\"location\": \"Paris\"}"}
        }]
      },
      {
        "role": "tool",
        "tool_call_id": "call_abc123",
        "content": "{\"temperature\": 18, \"condition\": \"Cloudy\"}"
      }
    ]
  }'
```

---

## Embeddings

### Create Embedding

```bash
curl https://api.ozwell.ai/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -d '{
    "model": "text-embedding-ada-002",
    "input": "Hello, world!"
  }'
```

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023, -0.0092, 0.0156, ...]
    }
  ],
  "model": "text-embedding-ada-002",
  "usage": {
    "prompt_tokens": 3,
    "total_tokens": 3
  }
}
```

### Batch Embeddings

```bash
curl https://api.ozwell.ai/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -d '{
    "model": "text-embedding-ada-002",
    "input": [
      "First document",
      "Second document",
      "Third document"
    ]
  }'
```

---

## Files

### Upload File

```bash
curl https://api.ozwell.ai/v1/files \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -F "file=@document.pdf" \
  -F "purpose=assistants"
```

**Response:**

```json
{
  "id": "file-abc123",
  "object": "file",
  "bytes": 1024000,
  "created_at": 1699000000,
  "filename": "document.pdf",
  "purpose": "assistants"
}
```

### List Files

```bash
curl https://api.ozwell.ai/v1/files \
  -H "Authorization: Bearer $OZWELL_API_KEY"
```

### Retrieve File

```bash
curl https://api.ozwell.ai/v1/files/file-abc123 \
  -H "Authorization: Bearer $OZWELL_API_KEY"
```

### Download File Content

```bash
curl https://api.ozwell.ai/v1/files/file-abc123/content \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -o downloaded.pdf
```

### Delete File

```bash
curl -X DELETE https://api.ozwell.ai/v1/files/file-abc123 \
  -H "Authorization: Bearer $OZWELL_API_KEY"
```

---

## Models

### List Models

```bash
curl https://api.ozwell.ai/v1/models \
  -H "Authorization: Bearer $OZWELL_API_KEY"
```

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4",
      "object": "model",
      "created": 1699000000,
      "owned_by": "openai"
    },
    {
      "id": "gpt-3.5-turbo",
      "object": "model",
      "created": 1699000000,
      "owned_by": "openai"
    }
  ]
}
```

### Retrieve Model

```bash
curl https://api.ozwell.ai/v1/models/gpt-4 \
  -H "Authorization: Bearer $OZWELL_API_KEY"
```

---

## Error Responses

### Error Format

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

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1699000060
Retry-After: 30
```

---

## Language Examples

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
)

type Message struct {
    Role    string `json:"role"`
    Content string `json:"content"`
}

type ChatRequest struct {
    Model    string    `json:"model"`
    Messages []Message `json:"messages"`
}

type ChatResponse struct {
    Choices []struct {
        Message struct {
            Content string `json:"content"`
        } `json:"message"`
    } `json:"choices"`
}

func main() {
    reqBody := ChatRequest{
        Model: "gpt-4",
        Messages: []Message{
            {Role: "user", Content: "Hello!"},
        },
    }
    
    jsonBody, _ := json.Marshal(reqBody)
    
    req, _ := http.NewRequest("POST", "https://api.ozwell.ai/v1/chat/completions", bytes.NewBuffer(jsonBody))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+os.Getenv("OZWELL_API_KEY"))
    
    resp, _ := http.DefaultClient.Do(req)
    defer resp.Body.Close()
    
    body, _ := io.ReadAll(resp.Body)
    
    var chatResp ChatResponse
    json.Unmarshal(body, &chatResp)
    
    fmt.Println(chatResp.Choices[0].Message.Content)
}
```

### Ruby

```ruby
require 'net/http'
require 'json'
require 'uri'

uri = URI('https://api.ozwell.ai/v1/chat/completions')

http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request['Content-Type'] = 'application/json'
request['Authorization'] = "Bearer #{ENV['OZWELL_API_KEY']}"
request.body = {
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
}.to_json

response = http.request(request)
data = JSON.parse(response.body)

puts data['choices'][0]['message']['content']
```

### PHP

```php
<?php

$apiKey = getenv('OZWELL_API_KEY');

$data = [
    'model' => 'gpt-4',
    'messages' => [
        ['role' => 'user', 'content' => 'Hello!']
    ]
];

$ch = curl_init('https://api.ozwell.ai/v1/chat/completions');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer ' . $apiKey
]);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
echo $result['choices'][0]['message']['content'];
```

### Java

```java
import java.net.http.*;
import java.net.URI;

public class OzwellExample {
    public static void main(String[] args) throws Exception {
        String apiKey = System.getenv("OZWELL_API_KEY");
        
        String body = """
            {
                "model": "gpt-4",
                "messages": [
                    {"role": "user", "content": "Hello!"}
                ]
            }
            """;
        
        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.ozwell.ai/v1/chat/completions"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + apiKey)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        
        HttpResponse<String> response = client.send(request, 
            HttpResponse.BodyHandlers.ofString());
        
        System.out.println(response.body());
    }
}
```

### Rust

```rust
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let api_key = std::env::var("OZWELL_API_KEY")?;
    
    let client = reqwest::Client::new();
    
    let response = client
        .post("https://api.ozwell.ai/v1/chat/completions")
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&json!({
            "model": "gpt-4",
            "messages": [
                {"role": "user", "content": "Hello!"}
            ]
        }))
        .send()
        .await?;
    
    let data: serde_json::Value = response.json().await?;
    println!("{}", data["choices"][0]["message"]["content"]);
    
    Ok(())
}
```

### C#

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

var apiKey = Environment.GetEnvironmentVariable("OZWELL_API_KEY");

using var client = new HttpClient();
client.DefaultRequestHeaders.Authorization = 
    new AuthenticationHeaderValue("Bearer", apiKey);

var requestBody = new {
    model = "gpt-4",
    messages = new[] {
        new { role = "user", content = "Hello!" }
    }
};

var response = await client.PostAsync(
    "https://api.ozwell.ai/v1/chat/completions",
    new StringContent(
        JsonSerializer.Serialize(requestBody),
        Encoding.UTF8,
        "application/json"
    )
);

var responseBody = await response.Content.ReadAsStringAsync();
var data = JsonDocument.Parse(responseBody);

Console.WriteLine(
    data.RootElement
        .GetProperty("choices")[0]
        .GetProperty("message")
        .GetProperty("content")
        .GetString()
);
```

---

## See Also

- [TypeScript SDK](./sdk-typescript.md) — Official Node.js SDK
- [Deno SDK](./sdk-deno.md) — Official Deno SDK
- [Python SDK](./sdk-python.md) — Official Python SDK
- [API Endpoints](./api-endpoints.md) — Complete reference
- [Authentication](./api-authentication.md) — API key details
