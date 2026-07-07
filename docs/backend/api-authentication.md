# Authentication

Ozwell uses API keys to authenticate requests. This guide covers key types, security best practices, and implementation patterns.

:::info Getting an API Key
For the managed Ozwell deployment, log in to [Ozwell Manager](https://ozwellconsole.os.mieweb.org) with your `manager.os.mieweb.org` credentials. The manager console handles login, then Ozwell provisions or links your `ozw_` parent key automatically.

Existing users can claim an existing `ozw_` key in Ozwell Manager. Any agents created on the temporary auto-generated key move to the claimed key.
:::

## API Key Types

Ozwell provides two types of API keys for different use cases:

| Key Type | Prefix | Use Case | Security Level |
|----------|--------|----------|----------------|
| **General-Purpose** | `ozw_` | Server-side, full API access | Server-only |
| **Agent Key** | `agnt_key-` | Per-agent embed key, auto-generated | Client-safe |
| **Scoped** | `ozw_scoped_` | Client-side, limited access *(coming soon)* | Client-safe |

### General-Purpose Keys

Full-access keys for server-side integrations:

- ✅ Access all API endpoints
- ✅ All models and capabilities
- ✅ No agent restrictions
- ⚠️ **Never expose client-side**

```bash
# Server-side usage only
export OZWELL_API_KEY="ozw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Scoped Keys

Restricted keys for client-side (frontend) integrations:

- ✅ Tied to specific agent(s)
- ✅ Permission-limited
- ✅ Safe for browser use
- ✅ Domain restrictions available

```javascript
// Safe for frontend use
const apiKey = 'ozw_scoped_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
```

---

### Agent Keys

Agent keys are generated automatically when you create an agent via the [Agent Registration API](./agents.md). They are scoped to that agent's configuration (model, tools, instructions) and safe for use in browser embeds.

```javascript
// Safe for frontend use — scoped to one agent
const apiKey = 'agnt_key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
```

## Creating API Keys

### Via Ozwell Manager

1. Log in to [Ozwell Manager](https://ozwellconsole.os.mieweb.org) with your `manager.os.mieweb.org` credentials.
2. Open the agent management page.
3. Ozwell creates an `ozw_` parent key for first-time users.
4. If you already have an `ozw_` key, use **Claim key** to link it to your manager identity.
5. Use **Show key** when you need to copy your parent key for server-side API use.

The app trusts forwarded identity headers only when deployed behind the trusted manager console/proxy. Do not trust `x-user-*` headers from direct public traffic.

### Manual Provisioning

Self-hosted deployments can still seed or create parent keys directly in their own database, but the managed deployment should use Ozwell Manager for normal user provisioning.

### Via API *(Coming Soon)*

```bash
curl https://api.ozwell.ai/v1/api-keys \
  -H "Authorization: Bearer $OZWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Server",
    "type": "general",
    "permissions": ["*"]
  }'
```

### Creating Agent Keys

Agent keys are created automatically when you register an agent. See the [Agent Registration API](./agents.md) for the full guide.

---

## Using API Keys

### Authorization Header

Include the API key in the `Authorization` header:

```bash
curl https://api.ozwell.ai/v1/chat/completions \
  -H "Authorization: Bearer ozw_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

### SDK Configuration

```typescript
import { OzwellClient } from '@ozwell/api';

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});
```

### OpenAI SDK Compatibility

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OZWELL_API_KEY,
  baseURL: 'https://api.ozwell.ai/v1',
});
```

---

## Security Best Practices

### Never Expose Keys in Code

```typescript
// ❌ BAD - Key in source code
const client = new OzwellClient({
  apiKey: 'ozw_abc123...',
});

// ✅ GOOD - Key from environment
const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});
```

### Use Environment Variables

```bash
# .env (never commit this file)
OZWELL_API_KEY=ozw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# .env.example (commit this as a template)
OZWELL_API_KEY=your_api_key_here
```

```typescript
// Load from environment
import 'dotenv/config';

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});
```

### Separate Keys by Environment

Use different keys for each environment:

```bash
# Development
OZWELL_API_KEY=ozw_dev_xxxxxxxx

# Staging  
OZWELL_API_KEY=ozw_staging_xxxxxxxx

# Production
OZWELL_API_KEY=ozw_prod_xxxxxxxx
```

### Regular Key Rotation

Rotate API keys periodically:

1. Create a new key in the dashboard
2. Update your application configuration
3. Deploy the change
4. Verify the new key works
5. Revoke the old key

### Scoped Key Domain Restrictions

For frontend integrations, restrict scoped keys to specific domains:

1. Go to **Settings → API Keys**
2. Edit your scoped key
3. Add allowed domains (e.g., `example.com`, `*.example.com`)
4. Requests from other domains will be rejected

---

## Error Handling

### Invalid API Key

```json
{
  "error": {
    "message": "Invalid API key provided",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}
```

**HTTP Status:** `401 Unauthorized`

### Missing API Key

```json
{
  "error": {
    "message": "API key is required",
    "type": "authentication_error", 
    "code": "missing_api_key"
  }
}
```

**HTTP Status:** `401 Unauthorized`

### Insufficient Permissions

```json
{
  "error": {
    "message": "API key does not have access to this resource",
    "type": "permission_error",
    "code": "insufficient_permissions"
  }
}
```

**HTTP Status:** `403 Forbidden`

### Handling in Code

```typescript
import { OzwellClient, OzwellError } from '@ozwell/api';

const client = new OzwellClient({
  apiKey: process.env.OZWELL_API_KEY,
});

try {
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  });
} catch (error) {
  if (error instanceof OzwellError) {
    switch (error.code) {
      case 'invalid_api_key':
        console.error('Check your API key configuration');
        break;
      case 'insufficient_permissions':
        console.error('This key lacks required permissions');
        break;
      default:
        console.error('API error:', error.message);
    }
  }
  throw error;
}
```

---

## Rate Limiting

API keys are rate-limited. When exceeded:

**HTTP Status:** `429 Too Many Requests`

**Headers:**

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699000060
Retry-After: 30
```

**Response:**

```json
{
  "error": {
    "message": "Rate limit exceeded. Please retry after 30 seconds.",
    "type": "rate_limit_error",
    "code": "rate_limit_exceeded"
  }
}
```

### Handling Rate Limits

```typescript
async function makeRequestWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof OzwellError && error.code === 'rate_limit_exceeded') {
        const retryAfter = error.headers?.['retry-after'] || 30;
        console.log(`Rate limited. Retrying in ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## Key Management API

### List Keys (Coming Soon)

```bash
GET /v1/api-keys
```

### Revoke Key (Coming Soon)

```bash
DELETE /v1/api-keys/{key_id}
```

---

## See Also

- [Endpoints Reference](./api-endpoints.md)
- [Examples](./api-examples.md)
- [Backend Overview](./overview.md)
