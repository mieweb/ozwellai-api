import { FastifyInstance } from 'fastify';
import { agentStore } from '../storage/agents';
import { createError, extractToken } from '../util';
import type { ApiKeyIdentityRequest } from '../../../spec';
import { registerAuthenticationSchemas } from '../util/authentication-schemas';

/** Describe a key's existing account; callers keep the original key and its scope. */
export default async function apiKeyIdentityRoute(fastify: FastifyInstance) {
  const $ref = registerAuthenticationSchemas(fastify);
  fastify.post<{ Body: ApiKeyIdentityRequest }>('/auth/api-key/identity', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify an API key belongs to the supplied account email',
      security: [{ bearerAuth: [] }],
      body: $ref('ApiKeyIdentityRequest'),
      response: {
        200: $ref('ApiKeyIdentityResponse'),
        400: $ref('AuthenticationBadRequest'),
        401: $ref('ApiKeyIdentityUnauthorizedResponse'),
      },
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authorization = request.headers.authorization;
    const token = extractToken(authorization);
    const isKey = /^(?:ozw_|agnt_key-)/.test(token) && token.length <= 4096 && !/\s/.test(token);
    const identity = authorization && /^bearer\s+/i.test(authorization) && isKey
      ? agentStore.lookupKeyIdentity(token)
      : undefined;
    const email = request.body.email.trim().toLowerCase();
    if (!identity || !email || identity.email.trim().toLowerCase() !== email) {
      reply.code(401);
      return createError(
        'The key and email do not match an active Ozwell account. The key must already be associated with that account on this server.',
        'authentication_error', null, 'invalid_key_identity',
      );
    }
    return identity;
  });
}
