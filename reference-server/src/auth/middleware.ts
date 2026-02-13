/**
 * Auth Middleware (Simplified for Agent PoC)
 * Only two auth paths:
 *   1. Session tokens - for dashboard (managing keys & agents)
 *   2. API keys (ozw_) - for agent operations
 * Agent keys (agnt_key_) bypass this middleware entirely via validateAuth in chat route.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/init-auth';
import { hashApiKey, isValidApiKey, verifySessionToken } from './crypto';

// Extend FastifyRequest to include auth data
declare module 'fastify' {
    interface FastifyRequest {
        apiKey?: {
            id: string;
            user_id: string;
            name: string;
            revoked_at: string | null;
        };
        userId?: string;
    }
}

/**
 * API Key authentication middleware
 * Validates parent keys (ozw_ prefix) only.
 */
export async function apiKeyAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        reply.code(401).send({ error: { message: 'Missing API key', code: 'missing_api_key' } });
        return;
    }

    const token = authHeader.slice(7);

    // Check for valid parent key prefix (ozw_)
    if (!isValidApiKey(token)) {
        reply.code(401).send({ error: { message: 'Invalid API key format', code: 'invalid_api_key' } });
        return;
    }

    // Hash and look up key
    const keyHash = hashApiKey(token);
    const db = getDatabase();

    const apiKey = db.prepare(`
    SELECT id, user_id, name, revoked_at 
    FROM api_keys 
    WHERE key_hash = ?
  `).get(keyHash) as any;

    if (!apiKey) {
        reply.code(401).send({ error: { message: 'Invalid API key', code: 'invalid_api_key' } });
        return;
    }

    if (apiKey.revoked_at) {
        reply.code(401).send({ error: { message: 'API key has been revoked', code: 'invalid_api_key' } });
        return;
    }

    // Attach to request
    request.apiKey = apiKey;

    // Update last_used_at
    setImmediate(() => {
        db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
            .run(new Date().toISOString(), apiKey.id);
    });
}

/**
 * Session token authentication (for dashboard/API key management)
 */
export async function sessionAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        reply.code(401).send({ error: { message: 'Authentication required', code: 'missing_session' } });
        return;
    }

    const token = authHeader.slice(7);
    const payload = verifySessionToken(token);

    if (!payload) {
        reply.code(401).send({ error: { message: 'Invalid or expired session', code: 'invalid_session' } });
        return;
    }

    request.userId = payload.user_id;
}
