# OzwellAI Reference Server

An OpenAI-compatible Fastify server that provides a reference implementation of the OzwellAI API. This server mimics the OpenAI REST API, allowing existing OpenAI SDKs and clients to work by only changing the `base_url` and `api_key`.

## Features

- **Full OpenAI API Compatibility**: Wire-compatible with OpenAI's API specification
- **Real Text Inference**: Uses deterministic text generation for predictable testing
- **MCP Host**: Built-in WebSocket endpoint (`/mcp/ws`) and embeddable chat widget
- **Streaming Support**: Server-Sent Events (SSE) for both `/v1/responses` and `/v1/chat/completions`
- **File Management**: Complete file upload, download, and management system
- **Docker Support**: Multi-architecture Docker images with security best practices
- **CI/CD Ready**: Automated testing and publishing workflows
- **Swagger Documentation**: Interactive API docs at `/docs`
- **TypeScript**: Fully typed with Zod schema validation
- **Agent Mode** *(PoC)*: Register agents with custom personas, tool allowlists, and scoped API keys
- **No Database**: All data stored in JSON files under `/data` (agent/auth data uses SQLite)

## Architecture

### How the Server Picks an LLM Backend

The server doesn't require any particular LLM provider. On each request it checks what's available and picks the best option:

1. **Ollama (explicit)** — Client sends `Authorization: Bearer ollama`. Always routes to Ollama, even if a gateway is configured.
2. **Portkey Gateway** — `PORTKEY_GATEWAY_URL` and `PORTKEY_GATEWAY_API_KEY` are set in `.env`. The gateway manages provider API keys (OpenAI, Anthropic, etc.) so clients don't need them.
3. **Ollama (fallback)** — No gateway configured, but Ollama is reachable on the network.
4. **Mock** — Nothing else is available. Returns canned responses for demos.

You don't need to change any code to switch backends. Just set (or unset) the environment variables and restart the server. See `.env.example` for all options.

### Streaming Architecture

The diagram below shows the Ollama path, but the gateway path works identically — the server just forwards to a different upstream.

```mermaid
sequenceDiagram
    participant Browser
    participant Ozwell as Reference Server
    participant LLM as LLM Backend<br/>(Gateway or Ollama)
    participant Widget as Widget (iframe)
    participant Handler as Tool Handler

    Browser->>Ozwell: 1. Load ozwell-loader.js
    Note over Browser,Ozwell: Script tag embed

    Browser->>Browser: 2. User clicks chat button
    Browser->>Widget: 3. Create iframe (lazy loading)
    Note over Widget: Chat widget loads

    rect rgb(255, 243, 205)
    Note over Widget: SECURE BOUNDARY<br/>All chat messages stay in iframe
    Widget->>Widget: User types message
    Widget->>Ozwell: POST /v1/chat/completions<br/>(stream=true)
    Note over Widget,Ozwell: Authorization: Bearer agnt_key-...

    Ozwell->>LLM: Forward request
    Note over Ozwell,LLM: Gateway or Ollama<br/>(based on config)

    rect rgb(230, 255, 230)
    Note over Ozwell,Widget: SSE STREAMING
    LLM-->>Ozwell: Stream: chunk 1
    Ozwell-->>Widget: data: {"delta":{"content":"Hello"}}
    LLM-->>Ozwell: Stream: chunk 2
    Ozwell-->>Widget: data: {"delta":{"content":"!"}}
    Note over Ozwell: Heartbeat every 25s<br/>: heartbeat
    LLM-->>Ozwell: Stream: finish_reason=stop
    Ozwell-->>Widget: data: [DONE]
    end

    Widget->>Widget: Parse tool calls from response
    end

    Widget->>Handler: 4. MCP JSON-RPC: tools/call
    Note over Widget,Handler: Only tool calls cross boundary
    Handler->>Handler: 5. Execute tool (update form)

    Handler-->>Widget: 6. MCP JSON-RPC response
```

**Key Components:**

- **Reference Server**: Proxy layer handling API compatibility and SSE heartbeat
- **LLM Backend**: Either a Portkey Gateway (routing to OpenAI, Anthropic, etc.) or a direct Ollama instance
- **Widget**: Embeddable chat UI with iframe isolation
- **SSE Heartbeat**: Keepalive comments every 25s to prevent 60s nginx timeout
- **Tool Calls**: Extracted from streamed responses and sent to parent page via MCP JSON-RPC 2.0 over postMessage

### Agent Mode (PoC)

Agent Mode lets you register "agents" — preconfigured AI personas with custom system prompts, tool allowlists, and behavioral settings — and issue scoped agent keys that automatically apply those settings at chat time.

> **🎬 Demo Video:** [Watch the Agent Mode demo on YouTube](https://youtube.com/shorts/u4DhC69JUfw?si=3TECDApOORKnrTmn)

#### How It Works

```mermaid
sequenceDiagram
    participant Admin as Site Admin
    participant Server as Reference Server
    participant DB as SQLite
    participant Widget as Chat Widget
    participant LLM as Ollama / LLM

    rect rgb(240, 248, 255)
    Note over Admin,DB: 🔧 Setup Phase
    Note over Admin,DB: Get a parent key (ozw_...) via the API key endpoint
    end

    rect rgb(255, 248, 240)
    Note over Admin,DB: 🤖 Agent Registration
    Admin->>Server: POST /v1/agents<br/>Authorization: Bearer ozw_...<br/>{definition: {name, model, tools, behavior}}
    Server->>DB: Store agent + generate agent key
    Server-->>Admin: Agent key (agnt_key-...)
    end

    rect rgb(240, 255, 240)
    Note over Widget,LLM: 💬 Chat with Agent
    Widget->>Server: POST /v1/chat/completions<br/>Authorization: Bearer agnt_key-...
    Server->>DB: Resolve agent key → agent definition
    Note over Server: Inject system prompt<br/>Filter tools to allowlist
    Server->>LLM: Forward with agent config
    LLM-->>Server: Stream response
    Server-->>Widget: SSE chunks
    end
```

#### Key Concepts

| Concept | Description |
|---------|-------------|
| **Parent Key** (`ozw_...`) | Issued to a user via `/v1/api-keys`. Used to manage agents. |
| **Agent Key** (`agnt_key-...`) | Scoped key issued when an agent is registered. Used for chat. |
| **Agent Definition** | Name, model, temperature, tools allowlist, behavior (tone, language, rules), and instructions. |
| **Tool Filtering** | When chatting with an agent key, only tools in the agent's allowlist are forwarded to the LLM. |
| **System Prompt Injection** | The agent's instructions + behavior settings are prepended as a system message automatically. |

#### Agent API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/v1/agents` | Parent key | Register a new agent |
| `GET` | `/v1/agents` | Parent key | List agents under this key |
| `GET` | `/v1/agents/:id` | Parent key | Get a specific agent |
| `PUT` | `/v1/agents/:id` | Parent key | Update an agent definition |
| `DELETE` | `/v1/agents/:id` | Parent key | Delete an agent |
| `GET` | `/v1/keys/validate` | Any key | Validate an API key (returns 200 or 401) |

#### Agent Definition Schema

Agents can be defined via structured JSON or YAML/Markdown:

```json
{
  "definition": {
    "name": "Landing Page Assistant",
    "description": "Helps users manage their profile",
    "model": "llama3.2:latest",
    "temperature": 0.7,
    "tools": ["get_form_data", "update_form_data"],
    "behavior": {
      "tone": "friendly pirate",
      "language": "en"
    },
    "instructions": "You are a helpful assistant on the demo landing page."
  }
}
```

Or as Markdown with YAML front matter:

```markdown
---
name: Landing Page Assistant
model: llama3.2:latest
temperature: 0.7
tools:
  - get_form_data
  - update_form_data
behavior:
  tone: friendly pirate
---

You are a helpful assistant on the demo landing page.
```

#### Example: Register and Chat with an Agent

**Prerequisite:** You need a parent API key (`ozw_...`). In dev mode, a demo key is seeded automatically: `ozw_demo_localhost_key_for_testing`.

```bash
# 1. Register an agent (YAML config)
curl -X POST http://localhost:3000/v1/agents \
  -H "Authorization: Bearer ozw_demo_localhost_key_for_testing" \
  -H "Content-Type: application/json" \
  -d '{"yaml": "name: Helper\nmodel: llama3.2:latest\ntemperature: 0.7\ntools:\n  - get_form_data\nbehavior:\n  tone: friendly\ninstructions: You help visitors navigate the site."}'
# Returns: { "agent_key": "agnt_key-xyz..." }

# 2. Chat using the agent key
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer agnt_key-xyz..." \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'
# Response uses the agent's system prompt, model, temperature, and tool allowlist
```

#### Privacy & Agent Mode

Agent mode follows Ozwell's core privacy principles:

- **Conversations are private by default** — the host site receives only lifecycle events, never message content
- **Agent keys are scoped** — they can only be used for chat, not to manage other agents or keys
- **Tool calls are filtered** — only tools explicitly listed in the agent definition are forwarded

## Quick Start

### Prerequisites

- Node.js 20+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The server will start at `http://localhost:3000`

### Embeddable Chat Widget

**Simple (one line):**

```html
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

**Advanced (with config):**

```html
<script>
  window.OzwellChatConfig = {
    endpoint: 'https://ozwellai-reference-server.opensource.mieweb.org/v1/chat/completions',
    welcomeMessage: 'Hi! How can I help?',
    debug: false  // Set to true to see tool execution details (developer mode)
  };
</script>
<script src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

**Live Demo:** <https://ozwellai-embedtest.opensource.mieweb.org>

**Watch Demo:** [YouTube Short](https://youtube.com/shorts/mqcoEoQzQMM?si=FLa_dq_4y2TeO_48)

The demo runs in mock AI mode by default (keyword-based pattern matching via `/mock/chat`). To use real LLM responses, configure a backend in your `.env` file:

- **Option A — Portkey Gateway:** Set `PORTKEY_GATEWAY_URL` and `PORTKEY_GATEWAY_API_KEY` to route through a gateway that manages provider keys (OpenAI, Anthropic, etc.) server-side. See `.env.example`.
- **Option B — Ollama:** Set `OLLAMA_BASE_URL` to a local or remote Ollama instance. Or send `Authorization: Bearer ollama` from the client to auto-connect to `localhost:11434`.

No code changes needed — just set the environment variables and restart.

See [embed/README.md](embed/README.md) for full documentation.

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run spec` - Generate OpenAPI specification

## API Endpoints

### Models

- `GET /v1/models` - List available models

### Chat Completions  

- `POST /v1/chat/completions` - Create chat completion (supports streaming)

### Responses (New Primitive)

- `POST /v1/responses` - Generate response with semantic events streaming

### Embeddings

- `POST /v1/embeddings` - Generate text embeddings

### Embed Widget

- `GET /embed/ozwell-loader.js` - Widget loader script (creates iframe with inline HTML)
- `GET /embed/ozwell.js` - Self-contained widget code (includes CSS)

### Files

- `POST /v1/files` - Upload file
- `GET /v1/files` - List files
- `GET /v1/files/{id}` - Get file metadata
- `GET /v1/files/{id}/content` - Download file content
- `DELETE /v1/files/{id}` - Delete file

### Documentation

- `GET /docs` - Swagger UI documentation
- `GET /openapi.json` - OpenAPI 3.1 specification
- `GET /health` - Health check

## Authentication

The server requires a valid API key. Two key types are accepted:

- **Agent keys** (`agnt_key-...`) — scoped to a specific agent, used for chat
- **Parent API keys** (`ozw_...`) — full access, used for managing agents and keys

```bash
# Using an agent key
Authorization: Bearer agnt_key-your-agent-key

# Using a parent key
Authorization: Bearer ozw_your-parent-key
```

A demo parent key (`ozw_demo_localhost_key_for_testing`) is seeded on startup for local development.

## Example Usage

### Using curl

#### List Models

```bash
curl -H "Authorization: Bearer ozw_demo_localhost_key_for_testing" http://localhost:3000/v1/models
```

#### Chat Completion (Non-streaming)

```bash
curl -H "Authorization: Bearer ozw_demo_localhost_key_for_testing" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}' \
     http://localhost:3000/v1/chat/completions
```

#### Chat Completion (Streaming)

```bash
curl -N -H "Authorization: Bearer ozw_demo_localhost_key_for_testing" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"stream":true}' \
     http://localhost:3000/v1/chat/completions
```

#### Responses (Non-streaming)

```bash
curl -H "Authorization: Bearer ozw_demo_localhost_key_for_testing" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o","input":"hello"}' \
     http://localhost:3000/v1/responses
```

#### Responses (Streaming with Semantic Events)

```bash
curl -N -H "Authorization: Bearer ozw_demo_localhost_key_for_testing" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o","input":"stream please","stream":true}' \
     http://localhost:3000/v1/responses
```

#### Embeddings

```bash
curl -H "Authorization: Bearer ozw_demo_localhost_key_for_testing" \
     -H "Content-Type: application/json" \
     -d '{"model":"text-embedding-3-small","input":"abc"}' \
     http://localhost:3000/v1/embeddings
```

#### File Upload

```bash
curl -H "Authorization: Bearer ozw_demo_localhost_key_for_testing" \
     -F "file=@README.md" \
     -F "purpose=assistants" \
     http://localhost:3000/v1/files
```

### Using OpenAI SDK

#### Node.js

```typescript
import OpenAI from 'openai';

const ozwellai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'test-key',
});

const response = await ozwellai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }]
});
```

#### Python

```python
from openai import OpenAI

ozwellai = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="test-key"
)

response = ozwellai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Data Storage

All data is stored in the `/data` directory:

```
/data
  /files
    index.json      # File metadata
    file-xxxxx      # Uploaded file content
```

### Reset State

To reset all data, simply delete the `/data` directory:

```bash
rm -rf data/
```

## Text Generation

The server uses a deterministic text generation system that:

- Provides consistent, predictable outputs for testing
- Generates contextually relevant responses based on input
- Supports streaming with realistic token-by-token delivery
- Maintains proper token counting for usage statistics

## Streaming

### Chat Completions Streaming

- Uses OpenAI's standard chunked SSE format
- Sends `data:` prefixed JSON objects
- Ends with `data: [DONE]`

### Responses Streaming  

- Uses semantic event types: `start`, `content`, `completion`, `done`
- Each event has appropriate data payload
- Provides structured streaming experience

## OpenAPI Specification

The server generates OpenAPI 3.1 compliant documentation based on the current [OpenAI API specification](https://platform.openai.com/docs/api-reference). The spec is available at:

- Interactive docs: `http://localhost:3000/docs`
- JSON spec: `http://localhost:3000/openapi.json`

## Configuration

Environment variables:

- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `NODE_ENV` - Environment (development/production)
- `OLLAMA_BASE_URL` - Ollama API endpoint for embed chat (default: <http://127.0.0.1:11434>)
- `OLLAMA_MODEL` - Override Ollama model for chat (optional - server auto-selects from available models)
- `DEFAULT_MODEL` - Default model for non-Ollama backends (default: gpt-4o-mini)
- `STREAMING_HEARTBEAT_ENABLED` - Enable SSE heartbeat during streaming (default: true)
- `STREAMING_HEARTBEAT_MS` - Heartbeat interval in milliseconds (default: 25000)

See `reference-server/.env.example` for a complete example configuration.

### Model Selection

If the client sends a `model` field in the request, it is used as-is. Otherwise the server picks a default based on the active backend:

| Backend | Env var         | Default        | Example values                                       |
|---------|-----------------|----------------|------------------------------------------------------|
| Gateway | `PORTKEY_MODEL` | `gpt-4o-mini`  | `gpt-4o`, `gpt-4-turbo`, `claude-sonnet-4-20250514` |
| Ollama  | `OLLAMA_MODEL`  | auto-detect    | `llama3.1:latest`, `mistral:latest`                  |
| Mock    | `DEFAULT_MODEL` | `gpt-4o-mini`  | cosmetic — mock ignores it                           |

**Note:** When a Portkey Gateway is configured (`PORTKEY_GATEWAY_URL` is set), it takes priority over Ollama. Direct Ollama is only used when no gateway is configured, or when the client explicitly sends `Authorization: Bearer ollama`.

**Ollama auto-detection:** When `OLLAMA_MODEL` is not set, the server queries Ollama for installed models and picks the best available one, preferring in order:

- `llama3.2:latest`
- `llama3.1:latest`
- `llama3:latest`
- `gpt-oss:latest`
- `mistral:latest`
- First available model as fallback

If `OLLAMA_MODEL` is set, it is used directly and auto-detection is skipped.

## Error Handling

All errors follow OpenAI's error format:

```json
{
  "error": {
    "message": "Error description",
    "type": "error_type",
    "param": "parameter_name",
    "code": "error_code"
  }
}
```

Common HTTP status codes:

- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (missing/invalid API key)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error

## Testing

The server is designed for deterministic testing:

- Text generation produces consistent outputs for same inputs
- Embeddings are deterministic based on input text
- All responses include proper usage statistics
- File operations maintain consistent metadata

## Development

### Project Structure

```
src/
├── server.ts           # Main server entry point that initializes a Fastify server with OpenAPI/Swagger documentation, registers all API routes, sets up middleware (CORS, multipart uploads), and handles global error responses and authentication. Serves as the central orchestration file for the entire reference server, providing a complete OpenAI-compatible API implementation with proper documentation, routing, and error handling infrastructure.
├── routes/             # API endpoint handlers
│   ├── chat.ts         # Implements the `/v1/chat/completions` endpoint supporting both streaming and non-streaming chat completions, with OpenAI-compatible request/response formats including message handling, model validation, and token usage tracking. Provides the core conversational AI functionality that mimics OpenAI's chat completions API, enabling clients to interact with language models for generating human-like responses in chat applications.
│   ├── embeddings.ts   # Handles the `/v1/embeddings` endpoint for generating vector embeddings from text inputs, supporting multiple embedding models with configurable dimensions and batch processing. Enables text-to-vector conversion for semantic search, similarity matching, clustering, and other NLP tasks that require numerical representations of text for machine learning applications.
│   ├── files.ts        # Manages file operations through multiple endpoints (`/v1/files`) including upload, listing, retrieval, content download, and deletion, with persistent storage in a local data directory. Supports file management capabilities for AI applications, allowing clients to upload training data, documents, images, or other assets that language models or processing pipelines might need to access.
│   ├── models.ts       # Provides the `/v1/models` endpoint that returns a hardcoded list of available AI models (GPT-4 variants and embedding models) with their metadata. Allows API clients to discover and enumerate what AI models are available for use, following OpenAI's API conventions for model discovery and selection.
│   ├── responses.ts    # Implements a custom `/v1/responses` endpoint for generating responses with semantic event-based streaming (start/content/completion events), offering an alternative to standard chat completions. Provides a specialized response generation method with more granular streaming control, potentially for applications requiring real-time feedback or different interaction patterns than traditional chat completions.
│   └── mock-chat.ts    # Provides mock AI responses for testing and demos without requiring Ollama. Generates deterministic responses based on input patterns for predictable testing scenarios.
└── util/               # Utility functions
    └── index.ts        # Contains shared utility functions including a deterministic text generator for testing, embedding vector generation, unique ID creation, token counting, error response formatting, and basic authentication validation. Centralizes common functionality used across multiple routes to ensure consistency, reduce code duplication, and provide reusable components for text generation, vector math, and API utilities.
embed/                  # Embeddable chat widget files
├── ozwell-loader.js    # Widget loader script to be embedded in parent pages
├── ozwell.html         # Widget iframe entry point (minimal HTML loader)
└── ozwell.js           # Self-contained widget with bundled CSS, HTML, and MCP JSON-RPC messaging
```

### Adding New Endpoints

1. Define Zod schemas in `src/schemas/`
2. Create route handler in `src/routes/`
3. Register route in `src/server.ts`
4. Update OpenAPI documentation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

Apache 2.0 - see LICENSE file for details

## Contact

For questions or support, please open an issue in the repository.
