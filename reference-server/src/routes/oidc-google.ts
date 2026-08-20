import { FastifyInstance } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { startOidcFlow, consumeOidcFlow, createSessionForIdentity } from '../storage/sessions';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';

// Cached across requests: the JWKS client refreshes Google's signing keys itself.
const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Exact-match redirect URI. Never derived from user input — an attacker-supplied
 * redirect is the classic way to leak an authorization code.
 */
function redirectUri(): string {
  const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  return `${base}/auth/oidc/google/callback`;
}

/** Popup handshake: hand the token to the opener, then close. */
function popupResultPage(payload: Record<string, unknown>): string {
  const json = JSON.stringify({ source: 'ozwell-auth', ...payload });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing in…</title></head>
<body style="font:14px system-ui;padding:24px">
<p>${payload.error ? 'Sign-in failed. You can close this window.' : 'Signed in. You can close this window.'}</p>
<script>
  try { window.opener && window.opener.postMessage(${json}, '*'); } catch (e) {}
  window.close();
</script>
</body></html>`;
}

export default async function googleOidcRoute(fastify: FastifyInstance) {
  /** Step 1 — send the browser to Google with PKCE, state and nonce. */
  fastify.get('/auth/oidc/google/start', async (_request, reply) => {
    if (!isGoogleConfigured()) {
      reply.code(404);
      return { error: { message: 'Google sign-in is not configured', type: 'invalid_request_error' } };
    }

    const { state, codeChallenge, nonce } = startOidcFlow();
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return reply.redirect(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`);
  });

  /** Step 2 — Google redirects back here with a one-time code. */
  fastify.get('/auth/oidc/google/callback', async (request, reply) => {
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
    reply.type('text/html; charset=utf-8');

    if (error) return popupResultPage({ error });
    if (!code || !state) return popupResultPage({ error: 'missing_code_or_state' });

    // Single-use state: proves this callback belongs to a sign-in we started.
    const flow = consumeOidcFlow(state);
    if (!flow) return popupResultPage({ error: 'invalid_or_expired_state' });

    let idToken: string;
    try {
      const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
          code_verifier: flow.codeVerifier,
        }),
      });
      const payload = await tokenResponse.json() as { id_token?: string; error?: string };
      if (!tokenResponse.ok || !payload.id_token) {
        request.log.warn({ status: tokenResponse.status, err: payload.error }, 'Google token exchange failed');
        return popupResultPage({ error: 'token_exchange_failed' });
      }
      idToken = payload.id_token;
    } catch (err) {
      request.log.warn({ err }, 'Google token exchange threw');
      return popupResultPage({ error: 'token_exchange_failed' });
    }

    // Verify the ID token's signature against Google's published keys, plus
    // issuer and audience. jwtVerify also enforces exp/nbf.
    let claims: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, googleJwks, {
        issuer: GOOGLE_ISSUERS,
        audience: process.env.GOOGLE_CLIENT_ID!,
      });
      claims = verified.payload as Record<string, unknown>;
    } catch (err) {
      request.log.warn({ err }, 'Google ID token failed verification');
      return popupResultPage({ error: 'invalid_id_token' });
    }

    // Replay protection: the nonce we generated must come back inside the token.
    if (claims.nonce !== flow.nonce) return popupResultPage({ error: 'nonce_mismatch' });

    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    if (!email || !sub) return popupResultPage({ error: 'missing_identity_claims' });
    if (claims.email_verified !== true) return popupResultPage({ error: 'email_not_verified' });

    const sessionToken = createSessionForIdentity({
      email,
      externalUserId: `google:${sub}`,
      username: typeof claims.name === 'string' ? claims.name : email,
      firstName: typeof claims.given_name === 'string' ? claims.given_name : null,
      lastName: typeof claims.family_name === 'string' ? claims.family_name : null,
    });

    request.log.info({ email }, 'widget Google sign-in');
    return popupResultPage({ session_token: sessionToken, email });
  });
}
