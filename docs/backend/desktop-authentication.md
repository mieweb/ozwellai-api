# Desktop browser sign-in

For the user-facing account menu and browser steps, see
[Sign in to Ozwell Desktop](../frontend/desktop-login.md), with screenshots of
the complete local login flow.

Ozwell Desktop opens this server's hosted sign-in page in the system browser. The
page offers the configured Google, Apple, and email methods through the same
`AuthGate` used by the widget. Each method creates an Ozwell session. The desktop
app exchanges a short-lived authorization code with an S256 PKCE verifier that
stayed in the app. Clients configured for Apple App Attest must then prove their
signed application identity before receiving a bound desktop session.

Google and Apple still redirect to this server's existing OIDC callbacks. They do
not redirect directly to the desktop app. Provider configuration and account
admission remain in [widget authentication deployment](widget-authentication.md).
Personal keys use the separate identity endpoint described below.

## Register a public client

Set `PUBLIC_BASE_URL` to the public HTTPS API origin. Register the desktop client
in `OZWELL_DESKTOP_CLIENTS` as JSON, for example:

```dotenv
OZWELL_DESKTOP_CLIENTS={"ozwell-desktop":{"name":"Ozwell Desktop","redirect_uris":["http://127.0.0.1/oauth/callback"]}}
```

Each client ID maps to a display `name` and `redirect_uris`. This configuration is
not a secret. An unset or malformed value disables desktop authorization; invalid
client records are ignored. `/auth/methods` reports `desktop_login: true` when at
least one valid client is registered. Authorization still checks the requested
client and callback. The desktop's configured client ID must match its registration.

The literal registration `http://127.0.0.1/oauth/callback` permits an ephemeral
port from 1 through 65535 and only the exact `/oauth/callback` path. It does not
permit `localhost`, another address, another path, a query, or a fragment. Optional
HTTPS callback URLs must match a registered URL exactly; those registrations may
not include user information, a query, or a fragment.

There is no shared desktop client secret. Registration constrains the client ID
and callback; it does not attest the installed binary. The app must open the
system browser, keep the verifier private, and bind its listener to `127.0.0.1`.
The user should start sign-in from their own app and check the displayed client.

## Protocol

1. Desktop binds its loopback listener, creates a random 32-byte state and a
   random PKCE verifier, and stores both in memory. The verifier is 43–128
   characters from the RFC 7636 unreserved alphabet. The challenge is the
   unpadded base64url encoding of SHA-256 over the verifier.
2. Desktop opens `GET /auth/desktop/authorize` with these query parameters:

   | Parameter | Value |
   | --- | --- |
   | `response_type` | `code` |
   | `client_id` | Registered ID, normally `ozwell-desktop` |
   | `redirect_uri` | For example, `http://127.0.0.1:49152/oauth/callback` |
   | `state` | Random state, 32–256 unreserved characters |
   | `code_challenge` | S256 challenge, 43 base64url characters |
   | `code_challenge_method` | `S256` |

3. The server validates the registration before showing the page. It creates a
   ten-minute flow with a private HttpOnly, SameSite=Lax cookie. The page's
   provider popup receiver checks the server origin and exact popup source.
4. After sign-in, the hosted page calls `POST /auth/desktop/complete` with its
   Ozwell session as the bearer credential and JSON `{ "flow_id": "..." }`.
   This internal browser endpoint requires the matching flow cookie and the
   server's exact `Origin`. The page then navigates to its registered callback
   with only `code` and `state` in the query. The session is never put in the URL.
5. Desktop validates state, then calls `POST /auth/desktop/token` with JSON:

   ```json
   {
     "grant_type": "authorization_code",
     "client_id": "ozwell-desktop",
     "redirect_uri": "http://127.0.0.1:49152/oauth/callback",
     "code": "<code received by the listener>",
     "code_verifier": "<original verifier>"
   }
   ```

   For a plain registered client, success returns
   `{ "session_token": "sess_...", "email": "..." }` with
   `Cache-Control: no-store`. The code expires after 60 seconds, is single use,
   and is bound to the client, callback, and challenge. It cannot be redeemed
   after its session, backing key, user, or registration becomes invalid.
6. Desktop uses the session for `/auth/session`, `/v1/models/effective`, and
   `/v1/chat/completions`, and calls `POST /auth/logout` with the same bearer
   session on sign-out. Existing session scope and expiry rules still apply.

Invalid authorization requests stay on the API server and are not redirected to
an unverified callback. Token errors return `invalid_grant`; expired or cancelled
attempts should restart from Desktop. A new authorization in the same browser
replaces the flow cookie, so finish one desktop sign-in attempt at a time.

Sessions, provider state, desktop flows, and codes are process-local. Use one
instance for the whole authentication exchange or implement shared storage
before distributing it across replicas. A restart clears pending exchanges and
sessions. Do not log bearer credentials, verifier bodies, or callback query strings.

## Require Apple App Attest for a desktop client

An operator can require production Apple App Attest for a registered macOS
Developer ID client. Add an `apple_app_attest` policy to that client:

```json
{
  "ozwell-desktop": {
    "name": "Ozwell Desktop",
    "redirect_uris": ["http://127.0.0.1/oauth/callback"],
    "apple_app_attest": {
      "team_id": "AB12345678",
      "signing_identifier": "com.example.ozwell",
      "bundle_versions": ["12345"]
    }
  }
}
```

Replace these examples with the actual signing team, the App Attest caller's code
signing identifier, and exact approved `CFBundleVersion` strings. This policy
accepts production macOS Developer ID proofs with signed category and version
extensions. An unsupported device, missing extension, invalid proof, or unknown
version fails closed. There is no plain-session fallback for this client. A
malformed attestation policy disables its whole client registration.

Apple's certificate chain, nonce, key ID, application identifier, production
environment, and signed bundle version are verified. Enrollment receipts are
verified locally, including their CMS signature, Apple receipt trust chain,
application/key binding, and freshness. Subsequent assertions verify signatures,
current version, request challenges, and strictly increasing counters. The server
uses fixed public Apple trust anchors; clients cannot supply a replacement root.

### Attested sign-in

The browser and PKCE steps above stay the same. After consuming a valid code,
`POST /auth/desktop/token` with an attestation-required client returns:

```json
{
  "attestation_required": true,
  "login_id": "<opaque 43-character base64url value>",
  "account": { "email": "person@example.test", "user_id": "..." }
}
```

It returns no bearer credential. The grant expires in five minutes and remains
bound to the verified browser session and the exact registration configuration.

1. Native code loads or generates its Apple App Attest key. Send
   `POST /auth/desktop/attestation/challenge` with `{ "login_id": "...", "key_id": "..." }`.
   Apple key IDs use canonical standard base64 encoding of 32 bytes, including
   the final `=`. The response contains `{ "challenge": "...", "proof_kind": "attestation" }`
   for a new key, or `proof_kind: "assertion"` for a previously enrolled key owned
   by this user and client.
2. Decode the challenge as base64url, hash those raw 32 bytes with SHA-256, and
   supply that digest as Apple's `clientDataHash`. Send the returned CBOR proof
   in canonical standard base64 to `POST /auth/desktop/attestation/verify` as
   `{ "login_id": "...", "key_id": "...", "proof": "..." }`.
3. A valid proof returns `{ "session_token": "sess_...", "email": "..." }`.
   This is a **new session bound to the enrolled application key and client**.
   The temporary browser session is consumed, and the new session keeps its
   original expiry. A personal or agent key cannot enter this conversion.

Challenges expire after 60 seconds and are consumed even when proof verification
fails. A login grant permits at most five challenges. The server persists verified
public keys, receipts, owner/client binding, bundle versions, and counters in
SQLite's `desktop_attested_keys` table. A key cannot be reassigned to another user
or client. Revoked keys remain recorded so they cannot be enrolled again.

### Bound API requests

Every use of the bound session requires a fresh assertion for these routes:

- `GET /auth/session`
- `POST /auth/logout`
- `GET /v1/models/effective`
- `GET /v1/agents`
- `POST /v1/chat/completions`

First send `POST /auth/desktop/challenge` with the session bearer and JSON
`{ "method": "POST", "path": "/v1/chat/completions", "body_hash": "..." }`.
`method` is uppercase and `path` includes the exact query string when present.
`body_hash` is lowercase SHA-256 hex over `JSON.stringify(parsedRequestBody)`;
for a request without a body, hash the empty string. Use the same normalized JSON
body for hashing and transmission. The response is
`{ "challenge_id": "...", "challenge": "..." }`.

Generate an Apple assertion using SHA-256 over the decoded challenge bytes. Send
that same bearer, exact method/path/body, and these headers on the protected call:

| Header | Value |
| --- | --- |
| `x-ozwell-attestation-challenge` | Returned `challenge_id` |
| `x-ozwell-attestation-key` | Enrolled Apple key ID |
| `x-ozwell-attestation-proof` | Standard base64 CBOR assertion |

The challenge is bound to the session, key, method, exact path, and body digest.
It expires after 60 seconds and is single use. Each session may have at most eight
outstanding request challenges. Counter advancement is a conditional SQLite write,
so concurrent replay cannot reuse a counter. Proof validation happens before the
existing parent-key authorization and routing checks. Unrelated routes do not
become available to a bound session. Challenge issuance is the only exempt bound
session endpoint; it validates the session and enrolled key without requiring a
recursive assertion.

Changing registration invalidates pending flows, codes, login grants, and existing
bound sessions. After an approved app update, a fresh login can reuse its enrolled
key with an assertion for the newly approved version. Revoking the enrolled key,
backing parent key, user, or session invalidates its authority. Operators can revoke
an installation by setting its `desktop_attested_keys.revoked_at` timestamp.

This policy establishes the signed application identity for that desktop client
and protects its bound sessions against bearer-only replay. Ordinary widget
sessions and personal API keys keep their existing API access and scope. Requiring
attestation for *all* account/API access needs a separate deployment policy; this
client setting does not disable those alternatives. Protect the Apple signing
identity and approve exact releases through the existing release process.

Pending login and request challenges remain process-local alongside sessions.
Use one process or add shared challenge/session storage before distributing traffic
across replicas; SQLite alone does not make the whole login flow multi-instance.

## Existing API keys

`POST /auth/api-key/identity` accepts the original parent or agent key as
`Authorization: Bearer <key>` and JSON `{ "email": "owner@example.test" }`.
The supplied email must match the existing active owner's recorded email. Success
returns `{ "email": "owner@example.test", "user_id": "..." }` with no-store
caching. The caller keeps using the original key; the endpoint does not issue a
session, provision an account, claim an unowned key, or change the key's scope.

An agent key remains an agent key. Its owner is resolved through its active parent
key. Missing ownership, mismatched email, inactive users, and revoked or disabled
keys all receive the same `401 invalid_key_identity` response. Administrators must
associate old unowned keys with the correct account through their existing
administration process before this sign-in method can verify them.

## Build and rollout checks

Build the server and both browser bundles with the normal reference-server build:

```bash
npm run build -w ozwellai-reference
```

The release must include `reference-server/embed/desktop-login.js`, generated by
`scripts/build-widget.js` alongside the existing widget bundle. It is served at
`/auth/desktop/login.js`. Do not register a client on an older deployment that lacks
these routes or this asset. Deploy the server first, then enable its client
registration and the matching desktop release. No live configuration is enabled
by this repository change.

From `reference-server`, run the isolated regression suites:

```bash
node --test test/desktop-auth.test.js test/desktop-attestation.test.js test/apple-app-attest.test.js test/api-key-identity.test.js test/widget-auth.test.js
```

These tests use local databases, synthetic identities, and controlled auth
fixtures. Apple trust-chain fixtures and injected signed service fixtures are tested
separately. They cover redirects, S256, browser binding, replay, expiry, revocation,
scope preservation, and identity ownership. They send no real mail and do not
authenticate to Google or Apple.

For operator acceptance, use the deployed Desktop sign-in with an approved test
account. Check the provider page, return to Desktop, account email, model list,
chat, cancellation, and sign-out. Also check a key with established ownership and
confirm an agent key keeps its existing scope. Record versions and results without
recording credentials. Local fixture results do not certify live provider or SMTP
configuration.
