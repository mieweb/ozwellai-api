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
- **No Database**: All data stored in JSON files under `/data`

## Quick Start

### Prerequisites

- Node.js 18+ 
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

Add the widget to any page:

```html
<script>
  window.OzwellChatConfig = {
    widgetUrl: 'https://ozwellai-reference-server.opensource.mieweb.org/embed/widget.html',
    endpoint: 'https://ozwellai-reference-server.opensource.mieweb.org/embed/chat'
  };
</script>
<script async src="https://ozwellai-reference-server.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

**Live Demo:** https://ozwellai-embedtest.opensource.mieweb.org

The demo runs in mock AI mode by default (keyword-based pattern matching via `/mock/chat`). To use real LLM responses:
- Change one line in the HTML to switch to Ollama mode
- Ollama mode uses `/embed/chat` endpoint which proxies to local Ollama instance
- Requires Ollama running with `llama3.1:8b` model

**For deployment:** Run Ollama in your container or set `EMBED_CHAT_BASE_URL` to your LLM endpoint for real responses.

See [embed/README.md](embed/README.md) for full documentation.

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run spec` - Generate OpenAPI specification

### Deployment with PM2 (Limited Resources)

If deploying in a container with limited memory, use PM2 to manage the process:

```bash
npm run build
PORT=8080 EMBED_CHAT_API_KEY=ollama \
  pm2 start dist/reference-server/src/server.js --name refserver \
    --max-memory-restart 400M
pm2 save
pm2 startup  # Follow printed command
```

PM2 auto-restarts if memory exceeds limit and survives container reboots.

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
- `GET /embed/ozwell-loader.js` - Widget loader script
- `GET /embed/widget.html` - Widget iframe HTML
- `GET /embed/ozwell.js` - Widget client-side logic
- `GET /embed/widget.css` - Widget styles
- `POST /embed/chat` - Widget chat endpoint

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

The server accepts any Bearer token for testing purposes:

```bash
Authorization: Bearer your-test-key-here
```

## Example Usage

### Using curl

#### List Models
```bash
curl -H "Authorization: Bearer test" http://localhost:3000/v1/models
```

#### Chat Completion (Non-streaming)
```bash
curl -H "Authorization: Bearer test" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}' \
     http://localhost:3000/v1/chat/completions
```

#### Chat Completion (Streaming)
```bash
curl -N -H "Authorization: Bearer test" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"stream":true}' \
     http://localhost:3000/v1/chat/completions
```

#### Responses (Non-streaming)
```bash
curl -H "Authorization: Bearer test" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o","input":"hello"}' \
     http://localhost:3000/v1/responses
```

#### Responses (Streaming with Semantic Events)
```bash
curl -N -H "Authorization: Bearer test" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o","input":"stream please","stream":true}' \
     http://localhost:3000/v1/responses
```

#### Embeddings
```bash
curl -H "Authorization: Bearer test" \
     -H "Content-Type: application/json" \
     -d '{"model":"text-embedding-3-small","input":"abc"}' \
     http://localhost:3000/v1/embeddings
```

#### File Upload
```bash
curl -H "Authorization: Bearer test" \
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

### Core Server Environment Variables
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `NODE_ENV` - Environment (development/production)

### Embed Chat Environment Variables
- `EMBED_CHAT_API_KEY` - API key for Ozwell SDK (default: `ollama`)
- `EMBED_CHAT_BASE_URL` - Base URL for external LLM API (optional)
- `EMBED_CHAT_MODEL` - Default model name (default: `llama3`)

When `EMBED_CHAT_API_KEY=ollama`, the chat endpoint expects Ollama running at `http://127.0.0.1:11434`. If not available, falls back to deterministic text generator.

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
├── server.ts           # Main server entry point
├── routes/             # API endpoint handlers
│   ├── chat.ts         # /v1/chat/completions endpoint
│   ├── embeddings.ts   # /v1/embeddings endpoint
│   ├── files.ts        # /v1/files/* endpoints
│   ├── models.ts       # /v1/models endpoint
│   ├── responses.ts    # /v1/responses endpoint
│   └── embed-chat.ts   # /embed/chat endpoint
└── util/               # Utility functions
    └── index.ts        # Text generation, embeddings, token counting, etc.

embed/
├── ozwell-loader.js    # Widget loader script
├── widget.html         # Widget iframe content
├── ozwell.js           # Widget client-side logic
├── widget.css          # Widget styles
└── README.md           # Widget documentation
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
