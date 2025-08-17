# OzwellAI Reference Server

An OpenAI-compatible Fastify server that provides a reference implementation of the OzwellAI API. This server mimics the OpenAI REST API, allowing existing OpenAI SDKs and clients to work by only changing the `base_url` and `api_key`.

## Features

- **Full OpenAI API Compatibility**: Wire-compatible with OpenAI's API specification
- **Real Text Inference**: Uses deterministic text generation for predictable testing
- **Streaming Support**: Server-Sent Events (SSE) for both `/v1/responses` and `/v1/chat/completions`
- **File Management**: Complete file upload, download, and management system
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

Environment variables:
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `NODE_ENV` - Environment (development/production)

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
├── server.ts           # Main server setup
├── routes/             # API endpoint handlers
│   ├── models.ts
│   ├── chat.ts
│   ├── responses.ts
│   ├── embeddings.ts
│   └── files.ts
├── schemas/            # Zod schemas for validation
│   └── index.ts
└── util/               # Utility functions
    └── index.ts
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