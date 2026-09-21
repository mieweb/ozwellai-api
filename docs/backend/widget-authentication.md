# Widget Authentication Deployment

The [embed guide](../frontend/cdn-embed.md#alternative-let-visitors-sign-in) covers
both host-key and keyless embeds. This guide covers deployment of the existing
widget sign-in implementation from PR #275. Do not publish OAuth secrets, Apple
private keys, or SMTP configuration in browser bundles or committed files.

## Account Admission

Choose `WIDGET_SIGNUP_POLICY` before enabling public sign-in:

| Value | Behavior |
| --- | --- |
| `existing` (default) | Only an existing active account matched by verified email can sign in. |
| `allowlist` | New accounts may be provisioned only for exact domains in comma-separated `WIDGET_SIGNUP_DOMAINS`. Subdomains are not implicitly allowed. |
| `open` | Any verified email can provision an account and its own parent key. Requires explicit operator approval. |

Unknown values fail closed. Existing inactive accounts are rejected under all
policies. These rules apply to Google, Apple, and email OTP, not to existing
host-configured keys. Apple private-relay addresses will not match a corporate
domain allowlist; decide whether users must share their actual email or be
pre-provisioned under the `existing` policy.

Sessions last up to 24 hours, are held in process memory, and are invalidated by
sign-out or a server restart. Multi-instance deployments need shared session and
OIDC state before they can reliably distribute authentication requests. This work
does not introduce chat-history or memory persistence.

## Organization-Owned Google Credentials

1. Create a Web application OAuth client in an organization-owned Google Cloud project.
2. Configure the consent screen, audience, and any required publishing verification.
3. Set `PUBLIC_BASE_URL` to the exact public API origin, using HTTPS in production.
4. Register `PUBLIC_BASE_URL/auth/oidc/google/callback` under **Authorized redirect URIs**, not JavaScript origins.
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` through the deployment secret manager. Remove the former personal-project credentials from the deployment.
6. Verify `/auth/methods` reports `google: true`, then complete sign-in from an allowed account in the embedded widget.

Replacing credentials in Google Cloud and the deployed secret store is an operator
action; the repository cannot create organization ownership or verify it from a
client ID. Keep the previous client until the new deployment has been verified,
then revoke it according to your credential-rotation policy.

## Apple Sign-In

Configure an organization-owned Apple Developer App ID with Sign in with Apple,
and a linked Services ID for the web client. Register the API domain and the exact
HTTPS return URL `PUBLIC_BASE_URL/auth/oidc/apple/callback`.

Set `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and
`APPLE_PRIVATE_KEY` (PKCS8 `.p8` content, with real or escaped newlines) in the
secret manager. The server signs a fresh five-minute ES256 client-secret JWT for
each code exchange, so a manually generated client-secret JWT cannot expire unnoticed.
Rotate the signing key through Apple and update the secret store when needed.

Apple posts authorization results to the callback using `form_post`. Ensure the
proxy allows that POST with its form body. The server verifies the ID token's
signature, issuer, audience, expiry, nonce, subject, and verified email. Only signed
identity claims are used; Apple's first-login-only `user` profile is not trusted or
required, so subsequent logins work without it. Display names default to the
verified email rather than collecting the optional first-login name.

## Email Delivery

Inside the Phoenix DC, configure:

```dotenv
SMTP_URL=smtp://relay.cluster.mieweb.org:25
SMTP_FROM=no-reply@os.mieweb.org
NODE_ENV=production
```

This relay requires an `@os.mieweb.org` sender, no credentials, and no TLS/STARTTLS.
The current transport is specifically configured for that trusted internal relay;
do not use it for an external authenticated/TLS mail service without adapting the
transport. Connection and socket waits are bounded to ten seconds.

Production without SMTP disables email sign-in. In local development only, missing
SMTP logs the code; `AUTH_DEV_ECHO_OTP=1` may also return it in the response. Neither
mechanism bypasses delivery in production or when SMTP is configured.

### Real Relay Acceptance Check

Perform this inside the deployed environment with an approved test mailbox:

1. Open the keyless widget and request an email code.
2. Confirm delivery to the real inbox, including sender and expiry text. A successful SMTP connection alone is not proof of delivery.
3. Confirm the request returns a challenge ID, not the code, and no code appears in application logs.
4. Enter the code and verify an authenticated chat request succeeds.
5. Retry the same code and confirm rejection; sign out and confirm the old session no longer authorizes requests.
6. Record deployment/version, timestamp, and pass/fail evidence without recording codes, keys, or session tokens.

Local automated tests use a controlled SMTP server and cannot certify delivery
through the real Phoenix relay. For manual local delivery testing, run
`node scripts/dev/smtp-sink.js 2525` and set `SMTP_URL=smtp://127.0.0.1:2525`.
That sink prints local test mail; never use it with production credentials or data.

## Verification Before Rollout

From `reference-server`, run:

```bash
npm run build
node --test test/widget-auth.test.js
```

Verify configured agent and parent keys bypass the modal. For keyless embeds,
exercise Google, Apple (first and repeat login), email OTP, and user-entered keys.
Test rejected accounts, popup cancellation, sign-out, and explicit remember/forget
behavior. Check desktop and mobile layouts. Keep provider keys and OAuth secrets
server-side. Confirm the chat backend is available; successful sign-in alone does
not demonstrate that a model can answer or execute a page tool.

Release gates requiring operator evidence: organization-owned Google and Apple
credentials, approved signup policy, real relay delivery, and live-provider browser
sign-in. Do not mark these complete based solely on local mocked-provider tests.