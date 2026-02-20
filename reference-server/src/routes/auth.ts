/**
 * Authentication Routes (Simplified for Agent PoC)
 * Handles: register, login, session verify, and parent API key management.
 */

import { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/init-auth';
import { generateId, hashPassword, verifyPassword, generateSessionToken, generateApiKey, hashApiKey, getKeyHint } from '../auth/crypto';
import { sessionAuth } from '../auth/middleware';

interface UserRow {
    id: string;
    email: string;
    password_hash: string;
}

interface ApiKeyListRow {
    id: string;
    name: string;
    key_hint: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
}

interface RegisterBody {
    email: string;
    password: string;
}

interface LoginBody {
    email: string;
    password: string;
}

interface CreateKeyBody {
    name: string;
}

export default async function authRoutes(fastify: FastifyInstance) {
    const db = getDatabase();

    /**
     * POST /auth/register
     */
    fastify.post<{ Body: RegisterBody }>('/auth/register', async (request, reply) => {
        const { email, password } = request.body;

        if (!email || !password) {
            return reply.code(400).send({ error: { message: 'Email and password required', code: 'validation_error' } });
        }

        // Check if user exists
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
        if (existing) {
            return reply.code(409).send({ error: { message: 'Email already registered', code: 'email_taken' } });
        }

        // Create user
        const userId = generateId();
        const passwordHash = hashPassword(password);
        const now = new Date().toISOString();

        db.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, email.toLowerCase(), passwordHash, now, now);

        // Generate session token
        const token = generateSessionToken(userId);

        return reply.code(201).send({
            token,
            user: {
                id: userId,
                email: email.toLowerCase()
            }
        });
    });

    /**
     * POST /auth/login
     */
    fastify.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
        const { email, password } = request.body;

        if (!email || !password) {
            return reply.code(400).send({ error: { message: 'Email and password required', code: 'validation_error' } });
        }

        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;

        if (!user || !verifyPassword(password, user.password_hash)) {
            return reply.code(401).send({ error: { message: 'Invalid credentials', code: 'invalid_credentials' } });
        }

        const token = generateSessionToken(user.id);

        return reply.send({
            token,
            user: {
                id: user.id,
                email: user.email
            }
        });
    });

    /**
     * POST /v1/api-keys (create API key)
     */
    fastify.post<{ Body: CreateKeyBody }>('/v1/api-keys', {
        preHandler: sessionAuth
    }, async (request, reply) => {
        const { name } = request.body;

        if (!name) {
            return reply.code(400).send({ error: { message: 'Key name required', code: 'validation_error' } });
        }

        const keyId = generateId();
        const fullKey = generateApiKey();
        const keyHash = hashApiKey(fullKey);
        const keyHint = getKeyHint(fullKey);
        const now = new Date().toISOString();

        // Insert parent API key
        db.prepare(`
      INSERT INTO api_keys (id, user_id, name, key_hash, key_hint, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(keyId, request.userId!, name, keyHash, keyHint, now);

        return reply.code(201).send({
            id: keyId,
            name,
            key: fullKey, // Only shown once!
            key_hint: keyHint,
            created_at: now
        });
    });

    /**
     * GET /v1/api-keys (list user's keys)
     */
    fastify.get('/v1/api-keys', {
        preHandler: sessionAuth
    }, async (request) => {
        const keys = db.prepare(`
      SELECT id, name, key_hint, created_at, last_used_at, revoked_at
      FROM api_keys
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(request.userId!) as ApiKeyListRow[];

        return {
            object: 'list',
            data: keys
        };
    });

    /**
     * POST /v1/api-keys/:id/revoke
     */
    fastify.post<{ Params: { id: string } }>('/v1/api-keys/:id/revoke', {
        preHandler: sessionAuth
    }, async (request, reply) => {
        const { id } = request.params;
        const now = new Date().toISOString();

        const result = db.prepare(`
      UPDATE api_keys SET revoked_at = ?
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL
    `).run(now, id, request.userId!);

        if (result.changes === 0) {
            return reply.code(404).send({ error: { message: 'API key not found', code: 'key_not_found' } });
        }

        return { success: true, message: 'API key revoked' };
    });

    /**
     * GET /v1/auth/verify (verify session token)
     */
    fastify.get('/v1/auth/verify', {
        preHandler: sessionAuth
    }, async (request) => {
        // Look up user info
        const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(request.userId!) as UserRow | undefined;
        return {
            valid: true,
            user: user ? { id: user.id, email: user.email } : null
        };
    });
}
