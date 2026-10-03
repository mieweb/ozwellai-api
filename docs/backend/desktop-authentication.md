# Desktop browser sign-in

Ozwell Desktop opens this server's hosted sign-in page in the system browser. The
page offers the configured Google, Apple, and email methods through the same
`AuthGate` used by the widget. Each method creates an Ozwell session. The desktop
app receives that session after exchanging a short-lived authorization code with
an S256 PKCE verifier that stayed in the app.

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

   Success returns `{ "session_token": "sess_...", "email": "..." }` with
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
node --test test/desktop-auth.test.js test/api-key-identity.test.js test/widget-auth.test.js
```

These tests use local databases, synthetic identities, and controlled auth
fixtures. They cover redirects, S256, browser binding, replay, expiry, revocation,
scope preservation, and identity ownership. They send no real mail and do not
authenticate to Google or Apple.

For operator acceptance, use the deployed Desktop sign-in with an approved test
account. Check the provider page, return to Desktop, account email, model list,
chat, cancellation, and sign-out. Also check a key with established ownership and
confirm an agent key keeps its existing scope. Record versions and results without
recording credentials. Local fixture results do not certify live provider or SMTP
configuration.
