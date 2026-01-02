# Ozwell Public API Specification

[![TypeScript Client CI](https://github.com/mieweb/ozwellai-api/actions/workflows/typescript-client-ci.yml/badge.svg)](https://github.com/mieweb/ozwellai-api/actions/workflows/typescript-client-ci.yml)
[![Reference Server CI](https://github.com/mieweb/ozwellai-api/actions/workflows/reference-server-ci.yml/badge.svg)](https://github.com/mieweb/ozwellai-api/actions/workflows/reference-server-ci.yml)
[![npm version](https://badge.fury.io/js/ozwellai.svg)](https://badge.fury.io/js/ozwellai)
[![JSR](https://jsr.io/badges/@mieweb/ozwellai)](https://jsr.io/@mieweb/ozwellai)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Deno](https://img.shields.io/badge/Deno-Compatible-00599C.svg)](https://deno.land/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0-brightgreen.svg)](https://swagger.io/specification/)
[![Zod](https://img.shields.io/badge/Schema-Zod-blue.svg)](https://github.com/colinhacks/zod)

## Live Demo

**Try it now:** [https://ozwellai-embedtest.opensource.mieweb.org](https://ozwellai-embedtest.opensource.mieweb.org)

**Watch demo:** [YouTube Short](https://youtube.com/shorts/mqcoEoQzQMM?si=FLa_dq_4y2TeO_48)

Experience the Ozwell AI chat widget with:
- Real-time SSE streaming with Ollama
- MCP tool calling via postMessage
- Interactive demo with live event logging
- Secure iframe isolation

---

## Quick Start

Get a local development environment running in under 5 minutes:

### Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **npm** - Comes with Node.js
- **Optional: Ollama** - [Install Ollama](https://ollama.ai/) for real AI responses (otherwise mock responses are used)

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/mieweb/ozwellai-api.git
cd ozwellai-api

# Install dependencies for all workspaces (one command!)
npm install
```

This project uses **npm workspaces** to manage all components as a monorepo.

### 2. Start the Development Environment

The easiest way to explore the system is to run from the root:

```bash
npm run dev
```

This will:
- ✅ Start the reference server on `http://localhost:3000`
- ✅ Start the demo landing page on `http://localhost:8080`
- ✅ Detect and connect to Ollama if available (or use mock responses)
- ✅ Display available models and connection status

**Alternative: Use the script directly**

```bash
./scripts/start.sh
```

**Alternative: Start components individually**

```bash
# Terminal 1: Reference Server
cd reference-server
npm run dev

# Terminal 2: Demo Landing Page
cd landing-page
npm run dev
```

### 3. Explore the Capabilities

Once running, you can explore these endpoints:

| What | URL | Description |
|------|-----|-------------|
| **Interactive Demo** | http://localhost:8080 | Full chat widget with live event logging |
| **API Documentation** | http://localhost:3000/docs | Swagger UI with all endpoints |
| **Health Check** | http://localhost:3000/health | Server status and configuration |
| **Chat Completions** | http://localhost:3000/v1/chat/completions | OpenAI-compatible chat endpoint |
| **MCP WebSocket** | ws://localhost:3000/mcp/ws | Model Context Protocol endpoint |

### 4. Test the TypeScript Client

```bash
cd clients/typescript

# Run a simple test
node test-ollama.js

# Or run the full test suite
npm test
```

### 5. Optional: Install Ollama for Real AI

For real AI responses instead of mock data:

```bash
# Install Ollama (macOS/Linux)
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model (3B parameters, fast and efficient)
ollama pull qwen2.5-coder:3b

# Verify it's running
curl http://localhost:11434/api/tags

# Restart the servers to detect Ollama
./scripts/start.sh
```

The reference server automatically detects Ollama and switches from mock responses to real streaming AI completions.

### Quick Test Commands

```bash
# Test chat completions with curl
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "qwen2.5-coder:3b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'

# List available models
curl http://localhost:3000/v1/models

# Upload a file
curl -X POST http://localhost:3000/v1/files \
  -H "Authorization: Bearer test-key" \
  -F purpose=assistants \
  -F file=@yourfile.txt
```

### Monorepo Workspace Commands

This project uses npm workspaces for unified dependency management:

```bash
# Run all tests across all workspaces
npm test

# Build all components
npm run build

# Lint all code
npm run lint

# Audit all dependencies in one command
npm run audit

# Fix audit issues
npm run audit:fix

# Clean all build artifacts
npm run clean

# Run a command in a specific workspace
npm run dev -w reference-server
npm run test -w clients/typescript
```

### Architecture at a Glance

```
┌─────────────────┐
│  Landing Page   │ ← Interactive demo with widget
│  localhost:8080 │
└────────┬────────┘
         │
         │ iframe embed
         ▼
┌─────────────────┐
│ Reference Server│ ← OpenAI-compatible API
│  localhost:3000 │
└────────┬────────┘
         │
         │ proxies to (optional)
         ▼
┌─────────────────┐
│     Ollama      │ ← Local AI inference
│  localhost:11434│
└─────────────────┘
```

### What's Next?

- 📖 Read the [full documentation](docs/)
- 🔧 Explore the [API Reference](http://localhost:3000/docs)
- 🎯 Check out [example integrations](docs/frontend/)
- 🐍 Try the Python client (coming soon)
- 🤝 Read [CONTRIBUTING.md](CONTRIBUTING.md) to contribute

---

## Philosophy

This public repository for Ozwell API is the canonical reference for the API, enabling both internal and external teams to build against a stable, well-documented contract.
The Ozwell API specification project is an open and reliable source of truth for all Ozwell API interactions. All types and endpoints are defined using [Zod](https://github.com/colinhacks/zod), ensuring type safety, clarity, and consistency. 

**Key principles:**
- **Single Source of Truth:** The Zod-based spec is the definitive reference for all Ozwell API interactions.
- **OpenAPI Generation:** Zod definitions generate OpenAPI/Swagger documentation for up-to-date, interactive docs.
- **Implementation Agnostic:** This spec is independent of any implementation. Private/internal implementations include this repository as a submodule.
- **OpenAI Compatibility:** The API is call-for-call compatible with OpenAI’s API, with additional endpoints for [IndexedCP](https://github.com/mieweb/IndexedCP) uploads and conversation management. It also supports multi-user contribitions to a shared conversation.
- **Canonical Testing Implementation:** A Fastify server stub provides a reference implementation for testing, returning hard-coded responses for all endpoints.
- **Extensible:** Enhanced features and new endpoints are added in a transparent, community-driven manner.

---

## Repository Structure

This repository is organized to provide a clear separation between the API specification, reference implementation, client libraries, and documentation. Below is an overview of each directory and its purpose:

```
/spec                # Zod type definitions and endpoint specs (the core API contract)
/reference-server    # Fastify server stub for reference/testing
/clients
  /typescript        # TypeScript client implementation
  /python            # Python client implementation
/docs                # Generated OpenAPI/Swagger docs and usage guides
/scripts             # Utility scripts (e.g., for codegen, validation)
```

### Directory Details

- **/spec**  
  Contains all Zod type definitions and endpoint specifications. This directory serves as the single source of truth for the Ozwell API contract, ensuring consistency across all implementations.

- **/reference-server**  
  Provides a Fastify server stub that implements the API spec with hard-coded responses. This reference server allows developers to test their integrations against a predictable, canonical implementation.

- **/clients**  
  Houses official client libraries for interacting with the Ozwell API. Each supported language (e.g., TypeScript, Python) has its own subdirectory.

- **/docs**  
  Contains generated OpenAPI/Swagger documentation and additional usage guides to help developers understand and work with the API.

- **/scripts**  
  Includes utility scripts for tasks such as generating OpenAPI documentation from Zod definitions, running the reference server, or validating the API spec.

---

## To-Do List

### Core Specification
- [X] Define all base types using Zod
- [X] Implement endpoint definitions (call-for-call with OpenAI)
- [ ] Add indexedCP upload endpoints for reliable file delivery
- [ ] Add conversation management/sharing endpoints

### Documentation
- [X] Set up OpenAPI generation from Zod
- [X] Integrate Swagger UI for interactive docs
- [ ] Write usage examples for each endpoint

### Client Implementations
- [X] TypeScript client: auto-generate types and API calls from spec
- [ ] Python client: mirror TypeScript client functionality

### Reference Testing Implementation
- [X] Add Fastify server stub that returns hard-coded responses for all endpoints
- [X] Document how to use the server stub for local testing and integration

### Enhanced Features
- [ ] Document and implement enhanced features (to be discussed)
- [ ] Add support for additional authentication methods
- [ ] Expand API for advanced conversation analytics

---

## Release Process

We use an automated, script-first release process that ensures consistency and reliability:

```bash
# Interactive release with version selection and GitHub release creation
./scripts/release.sh
```

The release script handles:
- ✅ Version validation and tagging
- 📝 Release notes generation  
- 🏷️ Git tag creation and pushing
- 🎉 GitHub release creation
- ⚡ Automated publishing to npm and JSR with provenance

For detailed documentation, see [RELEASE.md](RELEASE.md).

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md?utm_source=bluehive&utm_medium=chat&utm_campaign=bluehive-ai) for guidelines.
