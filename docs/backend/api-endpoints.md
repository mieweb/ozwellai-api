# API Endpoints Reference

Complete reference for all Ozwell API endpoints.

## Chat

### Create Chat Completion

Generate a response for a conversation.

```
POST /v1/chat/completions
```

#### Request Body

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Model ID to use (e.g., `gpt-4`, `gpt-3.5-turbo`) |
| `messages` | array | Yes | Array of message objects |
| `temperature` | number | No | Sampling temperature (0-2). Default: 1 |
| `top_p` | number | No | Nucleus sampling. Default: 1 |
| `n` | integer | No | Number of completions to generate. Default: 1 |
| `stream` | boolean | No | Stream responses. Default: false |
| `stop` | string/array | No | Stop sequences |
| `max_tokens` | integer | No | Maximum tokens to generate |
| `presence_penalty` | number | No | Presence penalty (-2 to 2). Default: 0 |
| `frequency_penalty` | number | No | Frequency penalty (-2 to 2). Default: 0 |
| `tools` | array | No | List of tools (functions) available |
| `tool_choice` | string/object | No | Tool selection behavior |

#### Message Object

```json
{
  "role": "user | assistant | system | tool",
  "content": "Message content",
  "name": "optional_name",
  "tool_calls": [],
  "tool_call_id": "for_tool_role"
}
```

#### Example Request

```bash
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "temperature": 0.7
  }'
```

#### Response

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
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35
  }
}
```

---

## Embeddings

### Create Embedding

Generate vector embeddings for text.

```
POST /v1/embeddings
```

#### Request Body

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Model ID (e.g., `text-embedding-ada-002`) |
| `input` | string/array | Yes | Text to embed |
| `encoding_format` | string | No | `float` or `base64`. Default: `float` |

#### Example Request

```bash
curl https://api.ozwell.ai/v1/embeddings \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-ada-002",
    "input": "The quick brown fox"
  }'
```

#### Response

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
    "prompt_tokens": 4,
    "total_tokens": 4
  }
}
```

---

## Files

### Upload File

Upload a file for use with the API.

```
POST /v1/files
```

#### Request (multipart/form-data)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | file | Yes | The file to upload |
| `purpose` | string | Yes | Purpose: `assistants`, `fine-tune`, etc. |

#### Example Request

```bash
curl https://api.ozwell.ai/v1/files \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -F "file=@document.pdf" \
  -F "purpose=assistants"
```

#### Response

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

List all uploaded files.

```
GET /v1/files
```

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `purpose` | string | Filter by purpose |

#### Response

```json
{
  "object": "list",
  "data": [
    {
      "id": "file-abc123",
      "object": "file",
      "bytes": 1024000,
      "created_at": 1699000000,
      "filename": "document.pdf",
      "purpose": "assistants"
    }
  ]
}
```

### Retrieve File

Get information about a specific file.

```
GET /v1/files/{file_id}
```

### Delete File

Delete a file.

```
DELETE /v1/files/{file_id}
```

### Retrieve File Content

Download file contents.

```
GET /v1/files/{file_id}/content
```

---

## Models

### List Models

List all available models.

```
GET /v1/models
```

#### Response

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

Get details about a specific model.

```
GET /v1/models/{model_id}
```

---

## Responses (Ozwell Extension)

Extended response format with additional capabilities.

### Create Response

Create a response with extended features.

```
POST /v1/responses
```

#### Request Body

Includes all `chat/completions` parameters plus:

| Parameter | Type | Description |
|-----------|------|-------------|
| `conversation_id` | string | ID for conversation persistence |
| `include_sources` | boolean | Include source citations |
| `response_format` | object | Structured output format |

#### Example Request

```bash
curl https://api.ozwell.ai/v1/responses \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Summarize this document"}],
    "conversation_id": "conv_abc123",
    "include_sources": true
  }'
```

#### Response

```json
{
  "id": "resp-abc123",
  "object": "response",
  "created": 1699000000,
  "model": "gpt-4",
  "conversation_id": "conv_abc123",
  "output": {
    "role": "assistant",
    "content": "Here is the summary..."
  },
  "sources": [
    {
      "file_id": "file-xyz789",
      "filename": "document.pdf",
      "page": 3,
      "excerpt": "Relevant excerpt..."
    }
  ],
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 80,
    "total_tokens": 230
  }
}
```

---

## Pagination

List endpoints support pagination:

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Max items to return (1-100). Default: 20 |
| `after` | string | Cursor for next page |
| `before` | string | Cursor for previous page |

#### Example

```bash
# First page
curl "https://api.ozwell.ai/v1/files?limit=10" \
  -H "Authorization: Bearer $OZWELL_API_KEY"

# Next page
curl "https://api.ozwell.ai/v1/files?limit=10&after=file-abc123" \
  -H "Authorization: Bearer $OZWELL_API_KEY"
```

---

## Versioning

The API is versioned in the URL path (`/v1/`). Breaking changes will result in a new version.

Current version: **v1**

---

## See Also

- [Authentication](./api-authentication.md)
- [Examples](./api-examples.md)
- [Backend Overview](./overview.md)
