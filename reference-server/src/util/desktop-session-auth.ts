import type { FastifyInstance } from 'fastify';
import { extractToken } from '../util';
import { validateSession, SESSION_TOKEN_PREFIX } from '../storage/sessions';
import { agentStore } from '../storage/agents';
import { desktopAttestation, type DesktopAttestationService } from '../storage/desktop-attestation';

/** Verify the parsed request before converting a session to its ordinary parent-key authority. */
export function installDesktopSessionAuthorization(fastify: FastifyInstance, service: DesktopAttestationService = desktopAttestation): void {
  fastify.addHook('preValidation', async (request, reply) => {
    const token = extractToken(request.headers.authorization);
    if (!token.startsWith(SESSION_TOKEN_PREFIX)) return;
    const session = validateSession(token);
    if (!session) return;
    const pathname = request.url.split('?')[0];
    if (session.desktopAttestation) {
      try {
        if (request.method === 'POST' && pathname === '/auth/desktop/challenge') {
          service.boundSession(token);
          return;
        }
        const header = (name: string) => typeof request.headers[name] === 'string' ? request.headers[name] as string : '';
        await service.verifyRequest(token, request.method, request.url, request.body,
          header('x-ozwell-attestation-challenge'), header('x-ozwell-attestation-key'), header('x-ozwell-attestation-proof'));
      } catch {
        reply.header('Cache-Control', 'no-store');
        return reply.code(401).send({ error: { message: 'A valid Ozwell desktop application proof is required.', type: 'authentication_error', code: 'invalid_desktop_proof' } });
      }
    }
    if (pathname.startsWith('/auth/')) return;
    const allowed = (request.method === 'POST' && pathname === '/v1/chat/completions') ||
      (request.method === 'GET' && pathname === '/v1/models/effective') ||
      (request.method === 'GET' && pathname === '/v1/agents');
    if (!allowed) return;
    request.headers.authorization = `Bearer ${session.parentKey}`;

    // Act as one of the user's own agents for chat/models; the agent key never reaches the client.
    const agentId = request.headers['x-ozwell-agent-id'];
    if (typeof agentId !== 'string' || !agentId || pathname === '/v1/agents') return;
    const parentKey = agentStore.lookupApiKey(session.parentKey);
    if (!parentKey) return; // revoked parent: let the route reply 401 so the widget signs out
    const agent = agentStore.getOwned(agentId, parentKey.id);
    if (!agent) {
      return reply.code(403).send({ error: { message: 'Agent not available for this account', type: 'invalid_request_error' } });
    }
    request.headers.authorization = `Bearer ${agent.agent_key}`;
  });
}
