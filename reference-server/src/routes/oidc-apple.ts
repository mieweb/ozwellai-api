import { FastifyInstance } from 'fastify';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import { startOidcFlow, consumeOidcFlow, createSessionForIdentity } from '../storage/sessions';
import { popupResultPage, publicOrigin } from '../util/oidc';

const APPLE_ISSUER = 'https://appleid.apple.com';
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

export function isAppleConfigured(): boolean {
  return !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);
}

export async function appleClientSecret(): Promise<string> {
  const key = await importPKCS8(process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.APPLE_KEY_ID! })
    .setIssuer(process.env.APPLE_TEAM_ID!)
    .setSubject(process.env.APPLE_CLIENT_ID!)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

export default async function appleOidcRoute(fastify: FastifyInstance, options: { jwks?: JWTVerifyGetKey }) {
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16384 },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));

  fastify.get('/auth/oidc/apple/start', async (_request, reply) => {
    if (!isAppleConfigured()) return reply.code(404).send({ error: { message: 'Apple sign-in is not configured' } });
    const { state, nonce } = startOidcFlow('apple');
    const params = new URLSearchParams({
      client_id: process.env.APPLE_CLIENT_ID!,
      redirect_uri: `${publicOrigin()}/auth/oidc/apple/callback`,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state,
      nonce,
    });
    return reply.redirect(`${APPLE_ISSUER}/auth/authorize?${params}`);
  });

  fastify.post('/auth/oidc/apple/callback', async (request, reply) => {
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    const { code, state, error } = (request.body || {}) as Record<string, unknown>;
    const flow = typeof state === 'string' ? consumeOidcFlow(state, 'apple') : null;
    if (!flow) return popupResultPage({ error: 'invalid_or_expired_state' });
    if (error) return popupResultPage({ error: 'authorization_denied' });
    if (typeof code !== 'string' || !isAppleConfigured()) return popupResultPage({ error: 'missing_code_or_configuration' });

    try {
      const response = await fetch(`${APPLE_ISSUER}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.APPLE_CLIENT_ID!,
          client_secret: await appleClientSecret(),
          code,
          grant_type: 'authorization_code',
          redirect_uri: `${publicOrigin()}/auth/oidc/apple/callback`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const tokens = await response.json() as { id_token?: string };
      if (!response.ok || !tokens.id_token) return popupResultPage({ error: 'token_exchange_failed' });
      const { payload } = await jwtVerify(tokens.id_token, options.jwks || appleJwks, {
        issuer: APPLE_ISSUER,
        audience: process.env.APPLE_CLIENT_ID!,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'nonce', 'email'],
      });
      if (payload.nonce !== flow.nonce) return popupResultPage({ error: 'nonce_mismatch' });
      if (payload.email_verified !== true && payload.email_verified !== 'true') return popupResultPage({ error: 'email_not_verified' });
      if (typeof payload.email !== 'string' || !payload.sub) return popupResultPage({ error: 'missing_identity_claims' });
      const email = payload.email.toLowerCase();
      let sessionToken: string;
      try {
        sessionToken = createSessionForIdentity({ email, externalUserId: `apple:${payload.sub}`, username: email });
      } catch {
        return popupResultPage({ error: 'account_not_permitted' });
      }
      return popupResultPage({ session_token: sessionToken, email });
    } catch {
      return popupResultPage({ error: 'apple_sign_in_failed' });
    }
  });
}