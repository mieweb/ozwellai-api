import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { desktopAuthorizations, desktopClientRegistration, DesktopAuthError, DESKTOP_FLOW_COOKIE } from '../storage/desktop-auth';
import { validateSession, allowOidcStart } from '../storage/sessions';
import { desktopAttestation, type DesktopAttestationService } from '../storage/desktop-attestation';
import { extractToken } from '../util';
import { publicOrigin } from '../util/oidc';
import type {
  DesktopAuthorizeQuery, DesktopCompleteRequest, DesktopTokenRequest,
  DesktopAttestationChallengeRequest, DesktopAttestationVerifyRequest, DesktopRequestChallengeRequest,
} from '../../../spec';
import { registerAuthenticationSchemas } from '../util/authentication-schemas';

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('Referrer-Policy', 'no-referrer');
}
function cookieHeader(value: string, maxAge = 600): string {
  return `${DESKTOP_FLOW_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/auth/desktop; Max-Age=${maxAge}${publicOrigin().startsWith('https:') ? '; Secure' : ''}`;
}
function flowCookie(header?: string): string {
  const value = header?.split(';').map(part => part.trim()).find(part => part.startsWith(`${DESKTOP_FLOW_COOKIE}=`))?.slice(DESKTOP_FLOW_COOKIE.length + 1) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
function errorReply(reply: FastifyReply, error: unknown) {
  const known = error instanceof DesktopAuthError;
  return reply.code(known && error.code === 'temporarily_unavailable' ? 429 : 400).send({ error: known ? error.code : 'invalid_request', error_description: known ? error.message : 'Invalid desktop authorization request.' });
}
function text(value: unknown): string { return typeof value === 'string' && value.length <= 2048 ? value : ''; }

export default async function desktopAuthRoute(fastify: FastifyInstance, options: { attestationService?: DesktopAttestationService } = {}) {
  const attestation = options.attestationService ?? desktopAttestation;
  const $ref = registerAuthenticationSchemas(fastify);
  const errors = {
    400: $ref('AuthenticationBadRequest'),
    401: $ref('DesktopUnauthorizedResponse'),
    429: $ref('DesktopOAuthError'),
  };
  fastify.addHook('onRequest', async (_request, reply) => { noStore(reply); });
  fastify.get<{ Querystring: DesktopAuthorizeQuery }>('/auth/desktop/authorize', {
    schema: {
      tags: ['Auth'], summary: 'Authorize a registered desktop public client using hosted sign-in',
      security: [],
      querystring: $ref('DesktopAuthorizeQuery'),
      response: { ...errors, 200: { content: { 'text/html': { schema: $ref('DesktopAuthorizePage') } } } },
    },
  }, async (request, reply) => {
    reply.header('X-Frame-Options', 'DENY');
    try {
      if (!allowOidcStart(request.ip)) throw new DesktopAuthError('temporarily_unavailable');
      const query = request.query;
      const flow = desktopAuthorizations.begin({
        clientId: text(query.client_id), redirectUri: text(query.redirect_uri), state: text(query.state), challenge: text(query.code_challenge),
      }, query.code_challenge_method, query.response_type);
      const nonce = randomBytes(18).toString('base64');
      reply.header('Set-Cookie', cookieHeader(flow.cookie));
      reply.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      const config = JSON.stringify({ flowId: flow.flowId, clientName: flow.clientName }).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to Ozwell Desktop</title></head><body><div id="ozwell-desktop-login"></div><script id="ozwell-desktop-config" type="application/json" nonce="${nonce}">${config}</script><script src="/auth/desktop/login.js" nonce="${nonce}" defer></script></body></html>`);
    } catch (error) { return errorReply(reply, error); }
  });

  fastify.post<{ Body: DesktopCompleteRequest }>('/auth/desktop/complete', {
    bodyLimit: 8192,
    schema: {
      tags: ['Auth'], summary: 'Finish a browser-bound desktop authorization',
      body: $ref('DesktopCompleteRequest'),
      response: { ...errors, 200: $ref('DesktopCompleteResponse'), 403: $ref('DesktopOAuthError') },
    },
  }, async (request, reply) => {
    // Cookie proves this browser opened authorize; Origin and bearer prevent cross-site completion.
    if (request.headers.origin !== publicOrigin() || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) return reply.code(403).send({ error: 'invalid_request', error_description: 'This sign-in must finish on the Ozwell sign-in page.' });
    const token = extractToken(request.headers.authorization);
    if (!attestation.activeSession(token) || validateSession(token)?.desktopAttestation) return reply.code(401).send({ error: 'invalid_token', error_description: 'Sign in to Ozwell again.' });
    try {
      const body = request.body;
      const redirectUri = desktopAuthorizations.complete(body.flow_id, flowCookie(request.headers.cookie), token);
      reply.header('Set-Cookie', cookieHeader('', 0));
      return { redirect_uri: redirectUri };
    } catch (error) { return errorReply(reply, error); }
  });

  fastify.post<{ Body: DesktopTokenRequest }>('/auth/desktop/token', {
    bodyLimit: 8192,
    schema: {
      tags: ['Auth'], summary: 'Exchange a desktop authorization code with its S256 PKCE verifier',
      security: [],
      body: $ref('DesktopTokenRequest'),
      response: { ...errors, 200: $ref('DesktopTokenResponse') },
    },
  }, async (request, reply) => {
    // No browser cookies or shared client secret are used to authorize this exchange.
    try {
      const body = request.body;
      const token = desktopAuthorizations.redeem({ clientId: text(body.client_id), redirectUri: text(body.redirect_uri), code: text(body.code), verifier: text(body.code_verifier), grantType: body.grant_type });
      const session = attestation.activeSession(token);
      if (!session || session.desktopAttestation) throw new DesktopAuthError('invalid_grant');
      if (desktopClientRegistration(text(body.client_id))?.apple_app_attest) return attestation.beginLogin(token, text(body.client_id));
      return { session_token: token, email: session.email };
    } catch (error) { return errorReply(reply, error); }
  });

  fastify.post<{ Body: DesktopAttestationChallengeRequest }>('/auth/desktop/attestation/challenge', {
    bodyLimit: 8192,
    schema: { tags: ['Auth'], summary: 'Request an Apple App Attest enrollment or sign-in assertion challenge',
      security: [], body: $ref('DesktopAttestationChallengeRequest'),
      response: { ...errors, 200: $ref('DesktopAttestationChallengeResponse') } },
  }, async (request, reply) => {
    try {
      const body = request.body;
      return attestation.loginChallenge(body.login_id, body.key_id);
    } catch (error) { return errorReply(reply, error); }
  });

  fastify.post<{ Body: DesktopAttestationVerifyRequest }>('/auth/desktop/attestation/verify', {
    bodyLimit: 192_000,
    schema: { tags: ['Auth'], summary: 'Verify Apple application proof and issue a bound desktop session',
      security: [], body: $ref('DesktopAttestationVerifyRequest'),
      response: { ...errors, 200: $ref('DesktopSessionResponse') } },
  }, async (request, reply) => {
    try {
      const body = request.body;
      return await attestation.verifyLogin(body.login_id, body.key_id, body.proof);
    } catch (error) { return errorReply(reply, error); }
  });

  fastify.post<{ Body: DesktopRequestChallengeRequest }>('/auth/desktop/challenge', {
    bodyLimit: 8192,
    schema: { tags: ['Auth'], summary: 'Request a one-use challenge for an exact desktop API request',
      security: [{ bearerAuth: [] }], body: $ref('DesktopRequestChallengeRequest'),
      response: { ...errors, 200: $ref('DesktopRequestChallengeResponse') } },
  }, async (request, reply) => {
    try {
      const body = request.body;
      return attestation.requestChallenge(extractToken(request.headers.authorization), body.method, body.path, body.body_hash);
    } catch (error) { return errorReply(reply, error); }
  });
}
