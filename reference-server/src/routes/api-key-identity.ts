import { FastifyInstance } from 'fastify';
import { agentStore } from '../storage/agents';
import { createError, extractToken } from '../util';

/** Describe a key's existing account; callers keep the original key and its scope. */
export default async function apiKeyIdentityRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: { email: string } }>('/auth/api-key/identity', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify an API key belongs to the supplied account email',
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', maxLength: 254 } },
      },
      response: {
        200: {
          type: 'object',
          properties: { email: { type: 'string' }, user_id: { type: 'string' } },
          required: ['email', 'user_id'],
        },
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
