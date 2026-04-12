# Agent Registration API

:::info Getting an API Key
The Ozwell Dashboard for key provisioning is **coming soon**. In the meantime, to get an API key (`ozw_` prefix), contact:

- **`adamerla128@gmail.com`** (Aditya Damerla)
- **`horner@mieweb.com`** (Doug Horner)
:::

Agents let you define a persona, model, temperature, and allowed tools server-side. Clients authenticate with a lightweight **agent key** (`agnt_key-`) instead of a full API key — keeping your configuration secure and your embed code simple.

## Base URLs

| Environment | URL |
|-------------|-----|
| **Development** | `https://ozwell-dev-refserver.opensource.mieweb.org` |
| **Production** | `https://api.ozwell.ai` *(coming soon)* |

## Authentication

All agent management endpoints require a parent API key (`ozw_` prefix) in the `Authorization` header:

```
Authorization: Bearer ozw_your_api_key_here
```

## Quick Start

### Step 1 — Set your server and key

```bash
BASE="https://ozwell-dev-refserver.opensource.mieweb.org"
AUTH="Authorization: Bearer ozw_your_api_key_here"
```

### Step 2 — Create an agent

Send raw YAML directly with `Content-Type: application/yaml`:

```bash
curl -s -X POST "$BASE/v1/agents" \
  -H "$AUTH" \
  -H "Content-Type: application/yaml" \
  -d '
name: My Agent
instructions: You are a helpful assistant.
model: llama3.1:latest
temperature: 0.7
' | jq .
```

Or from a file:

```bash
curl -s -X POST "$BASE/v1/agents" \
  -H "$AUTH" \
  -H "Content-Type: application/yaml" \
  -d @my-agent.yaml | jq .
```

<details>
<summary>Alternative: JSON-wrapped YAML</summary>

```bash
curl -s -X POST "$BASE/v1/agents" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"yaml": "name: My Agent\ninstructions: You are a helpful assistant.\nmodel: llama3.1:latest\ntemperature: 0.7\n"}' | jq .
```

</details>

### Step 3 — Grab the `agent_key` from the response

```json
{
  "agent_id": "agent-mmefp8bk...",
  "agent_key": "agnt_key-mmefp8bk...",
  "parent_key": "demo-key",
  "created_at": 1772773719
}
```

### Step 4 — Use the agent key in your embed

```html
<script>
  window.OzwellChatConfig = { apiKey: 'agnt_key-abc123...' };
</script>
<script src="https://ozwell-dev-refserver.opensource.mieweb.org/embed/ozwell-loader.js"></script>
```

That's it — 4 steps: set credentials, create agent, copy the key, embed it.

---

## Key Types

| Key Type | Prefix | Purpose | Who uses it |
|----------|--------|---------|-------------|
| **API Key** | `ozw_` | Manage agents (create, update, delete) | Developers / admins |
| **Agent Key** | `agnt_key-` | Authenticate chat requests for a specific agent | End-user widgets / embeds |

Agent keys are generated automatically when you create an agent. They are scoped to that agent's configuration (model, tools, instructions).

---

## Endpoints

### Create Agent

```
POST /v1/agents
```

Create a new agent with a YAML configuration wrapped in JSON.

#### Request Body

```json
{
  "yaml": "name: My Agent\ninstructions: You are a helpful assistant.\nmodel: llama3.1:latest\ntemperature: 0.7\ntools:\n  - name: get_form_data\n    description: Retrieves form values\n  - name: search_docs\n    description: Searches documentation\n    inputSchema:\n      type: object\n      properties:\n        query:\n          type: string\n"
}
```

#### YAML Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for the agent |
| `instructions` | string | Yes | System prompt / persona. **Must describe when and how to use each tool** — the LLM relies on instructions (not tool descriptions) to decide which tool to call. |
| `model` | string | No | Model ID (default: `llama3.1:latest`) |
| `temperature` | number | No | Sampling temperature 0-2 (default: `0.7`) |
| `tools` | array | No | Server-side tool definitions. Each entry can be a name string or an object with `name`, `description`, and `inputSchema` fields. These are always available to the agent. Page-provided tools are separate and controlled by `pageTools`. |
| `pageTools` | string or object | No | Controls which page-provided tools (via `postMessage:`) the agent can call. `all` (default) — accept everything. `{ restricted: [...] }` — only these page tools. `{ blocked: [...] }` — all page tools except these. |
| `behavior` | object | No | Optional tone and rules (e.g., `tone`, `rules` array) |

#### Example

```bash
curl -s -X POST "$BASE/v1/agents" \
  -H "$AUTH" \
  -H "Content-Type: application/yaml" \
  -d '
name: Support Bot
model: llama3.1:latest
temperature: 0.5
tools:
  - name: search_docs
    description: Search the knowledge base for relevant articles
    inputSchema:
      type: object
      properties:
        query:
          type: string
          description: Search query
      required:
        - query
  - name: create_ticket
    description: Create a support ticket to escalate an unresolved issue
    inputSchema:
      type: object
      properties:
        subject:
          type: string
          description: Ticket subject
        description:
          type: string
          description: Detailed issue description
      required:
        - subject
instructions: >
  You help users with technical support. Be concise and friendly.
  When a user asks a question, call search_docs to find relevant articles.
  If the issue cannot be resolved, call create_ticket to escalate it.
' | jq .
```

> **Note:** Tool schemas (description + inputSchema) are stored server-side with the agent. The LLM receives these schemas automatically — no client-side tool configuration needed.

#### Response

```json
{
  "agent_id": "agent-mmefp8bk...",
  "agent_key": "agnt_key-mmefp8bk...",
  "parent_key": "demo-key",
  "created_at": 1772773719
}
```

---

### List Agents

```
GET /v1/agents
```

Returns all agents associated with your API key.

#### Example

```bash
curl -s "$BASE/v1/agents" -H "$AUTH" | jq .
```

#### Response

```json
{
  "object": "list",
  "data": [
    {
      "id": "agent-abc123...",
      "agent_key": "agnt_key-abc123...",
      "name": "Support Bot",
      "model": "llama3.1:latest",
      "tools": [{"name": "search_docs", "description": "Searches documentation"}],
      "behavior": {
        "tone": "friendly and helpful",
        "rules": ["Always be helpful"]
      },
      "markdown": "---\nname: Support Bot\nmodel: llama3.1:latest\n...",
      "created_at": 1772685931
    }
  ]
}
```

> **Note:** The `behavior` field only appears if defined in the agent's YAML. `tools` defaults to `[]` if not specified.

---

### Get Agent

```
GET /v1/agents/{agent_id}
```

Retrieve full details for a single agent, including parsed definition and instructions.

#### Example

```bash
curl -s "$BASE/v1/agents/agent-mmefp8bk" -H "$AUTH" | jq .
```

#### Response

```json
{
  "agent_id": "agent-mmefp8bk...",
  "parent_key": "demo-key",
  "created_at": 1772773719,
  "markdown": "---\nname: Support Bot\nmodel: llama3.1:latest\ntemperature: 0.5\ntools:\n  - search_docs\n---\n\nYou help users with technical support.",
  "definition": {
    "name": "Support Bot",
    "model": "llama3.1:latest",
    "temperature": 0.5,
    "tools": [{"name": "search_docs", "description": "Searches documentation"}]
  },
  "instructions": "You help users with technical support."
}
```

---

### Update Agent

```
PUT /v1/agents/{agent_id}
```

Update an existing agent's configuration. Same YAML-in-JSON format as create.

#### Example

```bash
curl -s -X PUT "$BASE/v1/agents/agent-mmefp8bk" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"yaml": "name: Support Bot v2\ninstructions: You are an updated support bot.\nmodel: llama3.1:latest\ntemperature: 0.3\n"}' | jq .
```

#### Response

```json
{
  "agent_id": "agent-mmefp8bk...",
  "agent_key": "agnt_key-mmefp8bk...",
  "parent_key": "demo-key",
  "name": "Support Bot v2",
  "model": "llama3.1:latest",
  "tools": [{"name": "search_docs", "description": "Searches documentation"}],
  "updated": true
}
```

---

### Delete Agent

```
DELETE /v1/agents/{agent_id}
```

Permanently delete an agent and invalidate its agent key.

#### Example

```bash
curl -s -X DELETE "$BASE/v1/agents/agent-mmefp8bk" -H "$AUTH" | jq .
```

#### Response

```json
{
  "id": "agent-mmefp8bk...",
  "deleted": true
}
```

---

## Error Responses

| Status | Meaning |
|--------|---------|
| `400` | Bad request — invalid YAML, missing fields, or invalid API key |
| `401` | Unauthorized — missing or invalid `Authorization` header |
| `404` | Agent not found |

```json
{
  "error": "Agent not found"
}
```

---

## See Also

- [Authentication](./api-authentication.md) — API key types and security
- [CDN Embed](../frontend/cdn-embed.md) — Using agent keys in the embed widget
- [API Endpoints](./api-endpoints.md) — Full endpoint reference
