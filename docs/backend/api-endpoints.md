# API Endpoints Reference

Complete reference for all Ozwell API endpoints.

## Base URLs

| Environment | URL |
|-------------|-----|
| **Current Ozwell Manager API** | `https://ozwellapi.os.mieweb.org` |

:::tip
Use `https://ozwellapi.os.mieweb.org` for current Ozwell Manager features. Production is temporarily unavailable while it migrates to the future `api.ozwell.ai` endpoint, so it is not advertised as the active API here.
:::

## Chat

### Create Chat Completion

Generate a response for a conversation.

```
POST /v1/chat/completions
```

#### Request Body

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | No | Provider ID (e.g., `openai`, `anthropic`, `ollama`). Required when `model` is ambiguous across allowed providers. |
| `model` | string | No | Model ID (e.g., `gpt-4.1-mini`). If omitted, uses the agent model-policy default, then `LLM_MODEL` if allowed. |
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
curl https://ozwellapi.os.mieweb.org/v1/chat/completions \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
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
curl https://ozwellapi.os.mieweb.org/v1/embeddings \
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
curl https://ozwellapi.os.mieweb.org/v1/files \
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

## Audio

### Create Transcription

Transcribes audio into the input language.

```
POST /v1/audio/transcriptions
```

This is a multipart/form-data endpoint.

#### Request Body (multipart/form-data)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | file | Yes | The audio file to transcribe. Supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm |
| `model` | string | Yes | Model ID (currently `whisper-1`) |
| `language` | string | No | Language code in ISO-639-1 format |
| `response_format` | string | No | Output format: `json`, `text`, `srt`, `verbose_json`, `vtt`. Default: `json` |
| `temperature` | number | No | Sampling temperature (0-1). Default: 0 |
| `timestamp_granularities` | array | No | Timestamp granularities: `word`, `segment`. Requires `verbose_json` format |

#### Example Request

```bash
curl https://ozwellapi.os.mieweb.org/v1/audio/transcriptions \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -F "file=@audio.mp3" \
  -F model=whisper-1
```

#### Response (json format)

```json
{
  "text": "Hello, this is a transcription of the audio file."
}
```

#### Response (verbose_json format)

```json
{
  "task": "transcribe",
  "language": "english",
  "duration": 3.0,
  "text": "Hello, this is a transcription of the audio file.",
  "words": [
    { "word": "Hello", "start": 0.0, "end": 0.5 }
  ],
  "segments": [
    {
      "id": 0,
      "seek": 0,
      "start": 0.0,
      "end": 3.0,
      "text": "Hello, this is a transcription of the audio file.",
      "tokens": [50364, 639, 307],
      "temperature": 0.0,
      "avg_logprob": -0.25,
      "compression_ratio": 1.0,
      "no_speech_prob": 0.01
    }
  ]
}
```

---

## Models

### List Models

List discovered provider/model records. The registry is stored in the backend database and refreshed from the configured gateway/Ollama discovery paths.

```
GET /v1/models
```

#### Response (example — actual models depend on your backend configuration)

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4.1-mini",
      "provider": "openai",
      "model": "gpt-4.1-mini",
      "object": "model",
      "created": 0,
      "owned_by": "openai"
    },
    {
      "id": "gpt-4o-mini",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "object": "model",
      "created": 0,
      "owned_by": "openai"
    }
  ]
}
```

### List Effective Models

List the provider/model records allowed for the current parent key or agent key.

```
GET /v1/models/effective
```

The effective list is:

```text
enabled discovered models ∩ server-wide restrictions ∩ parent-key restrictions ∩ agent model policy
```

Each level only narrows the level above it, and an empty level is a no-op. Policy is resolved before
any provider dispatch, so a request for a disallowed pair is rejected with `403 model_not_allowed`
before it reaches an upstream provider.

### Retrieve Model

Get details about a specific model.

```
GET /v1/models/{model_id}
```

### Manager Model Policy Endpoints

Manager-console routes expose the same provider-aware policy controls:

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/manager/models` | List/refresh discovered provider models for the manager console, narrowed by the server-wide policy |
| `GET /v1/manager/admin/model-restrictions` | Read server-wide restrictions (admin only) |
| `PUT /v1/manager/admin/model-restrictions` | Save server-wide restrictions with `allowed_models` (admin only) |
| `GET /v1/manager/admin/parent-keys/{key_id}/model-restrictions` | Read parent-key restrictions |
| `PUT /v1/manager/admin/parent-keys/{key_id}/model-restrictions` | Save parent-key restrictions with `allowed_models` |
| `GET /v1/manager/agents/{agent_id}/model-policy` | Read an agent fallback model and allowed-model policy |
| `PUT /v1/manager/agents/{agent_id}/model-policy` | Save an agent fallback model and allowed-model policy |
| `GET /v1/manager/notifications` | List model-policy notifications |

Restriction bodies use provider-aware entries:

```json
{
  "allowed_models": [
    { "provider": "openai", "model": "gpt-4o-mini" },
    { "provider": "anthropic" }
  ]
}
```

An empty `allowed_models` array means unrestricted within the higher-level effective policy.

An entry with a `provider` and no `model` allows that whole provider.

#### Server-Wide Restrictions

`GET`/`PUT /v1/manager/admin/model-restrictions` set one allow-list for the entire server. They
require an admin manager user and return 403 `admin_required` otherwise. The policy applies to every
key and agent, including requests made with no parent key, and takes effect on the next request with
no restart.

```json
{
  "allowed_models": [{ "provider": "ollama", "model": "gemma3:1b" }],
  "discovered_models": [],
  "effective_models": []
}
```

`discovered_models` is the unfiltered registry, so an admin UI can still offer every discovered model
to choose from; `effective_models` is the same list after the server-wide policy is applied.

Server-wide policy is stored in its own table and never touches `provider_models.enabled`, which
discovery refresh owns. Saving it does not modify or delete any parent-key or agent policy — those
stay stored exactly as written and simply narrow further.

If a save takes a model away, every key that loses one gets a `model_policy_changed` notification —
the same one a per-key change sends. Keys that lose nothing are not notified.

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
curl https://ozwellapi.os.mieweb.org/v1/responses \
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
curl "https://ozwellapi.os.mieweb.org/v1/files?limit=10" \
  -H "Authorization: Bearer $OZWELL_API_KEY"

# Next page
curl "https://ozwellapi.os.mieweb.org/v1/files?limit=10&after=file-abc123" \
  -H "Authorization: Bearer $OZWELL_API_KEY"
```

---

## Widget Sign-In

Sign-in routes for the embeddable widget. They mint a `sess_` token that stands in for the
signed-in user's own API key — see [Authentication](./api-authentication.md#session-tokens).

These routes take no API key. Everything else on this page does.

### List Sign-In Methods

Report which methods this server offers, so the widget only shows what will work.

```
GET /auth/methods
```

```json
{ "google": true, "email_otp": true, "user_key": true }
```

`google` is `false` unless the server has `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set.

### Request an Email Code

```
POST /auth/otp/request
```

```json
{ "email": "user@example.com" }
```

Returns a `challenge_id`. The code is six digits, lasts 10 minutes, and allows 5 attempts.

One address may request 3 codes per 15 minutes; beyond that the route returns `429`. A
malformed address returns `400`, and `502` means the code could not be delivered.

Where the code goes depends on `SMTP_URL`. With it set, the code is mailed and kept out of the
logs. Without it — the normal local-development case — the code is logged instead, and
`AUTH_DEV_ECHO_OTP=1` additionally returns it as `dev_code`. That echo is ignored whenever a
mail sender is configured, so it cannot bypass delivery.

### Verify an Email Code

```
POST /auth/otp/verify
```

```json
{ "challenge_id": "...", "code": "123456" }
```

Returns `{ "session_token": "sess_...", "email": "..." }`. A wrong or expired code returns
`401`. Each challenge verifies once.

### Start Google Sign-In

```
GET /auth/oidc/google/start
```

Redirects to Google's consent screen. OAuth 2.0 authorization code with PKCE (S256), plus
`state` and `nonce`. Returns `404` when Google is not configured, since the routes are only
registered when it is.

Open this in a popup, not in an iframe — Google refuses to render consent in a frame.

### Google Callback

```
GET /auth/oidc/google/callback
```

Google's redirect target. Exchanges the code, verifies the ID token against Google's JWKS
(issuer, audience, nonce and `email_verified`), then mints a session. Responds with a small page
that posts `{ source: 'ozwell-auth', session_token, email }` to `window.opener` and closes
itself.

Register this URL under **Authorized redirect URIs** in Google Cloud Console — not under
Authorized JavaScript origins, which rejects any URL carrying a path. The server builds it from
`PUBLIC_BASE_URL`, never from request input.

### Describe the Current Session

```
GET /auth/session
```

With `Authorization: Bearer sess_...`, returns `{ "email": "...", "user_id": ... }`. An expired
or unknown token returns `401`.

### Sign Out

```
POST /auth/logout
```

Revokes the token in the `Authorization` header. Sessions otherwise expire 24 hours after
sign-in, and are lost on server restart.

---

## Versioning

The API is versioned in the URL path (`/v1/`). Breaking changes will result in a new version.

Current version: **v1**

---

## Agents

Agent registration and management API. See the full reference:

➡️ [Agent Registration API](./agents.md)

---

## See Also

- [Authentication](./api-authentication.md)
- [Agent Registration](./agents.md)
- [Examples](./api-examples.md)
- [Backend Overview](./overview.md)
