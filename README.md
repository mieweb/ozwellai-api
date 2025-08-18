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
