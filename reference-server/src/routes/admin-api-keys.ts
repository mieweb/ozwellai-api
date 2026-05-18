import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { agentStore, ApiKeyRole } from '../storage/agents';
import { createError, extractToken, generateId, isValidApiKey, KEY_PREFIX } from '../util';

async function adminKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization || !/^bearer\s+/i.test(authorization)) {
        reply.code(401).send(createError('Authorization header must use Bearer scheme', 'authentication_error', null, 'missing_api_key'));
        return;
    }

    const token = extractToken(authorization);
    if (!token) {
        reply.code(401).send(createError('Missing API key', 'authentication_error', null, 'missing_api_key'));
        return;
    }

    if (!isValidApiKey(token)) {
        reply.code(401).send(createError('Invalid API key format', 'authentication_error', null, 'invalid_api_key'));
        return;
    }

    const apiKey = agentStore.lookupApiKey(token);
    if (!apiKey) {
        reply.code(401).send(createError('Invalid API key', 'authentication_error', null, 'invalid_api_key'));
        return;
    }

    if (apiKey.role !== 'admin') {
        reply.code(403).send(createError('Admin API key required', 'authentication_error', null, 'insufficient_permissions'));
        return;
    }

    request.apiKey = apiKey;
}

function generateParentKey(): string {
    return `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

function parseRole(value: unknown): ApiKeyRole | null {
    if (value == null) return 'user';
    return value === 'admin' || value === 'user' ? value : null;
}

function publicKeyView(key: ReturnType<typeof agentStore.getApiKeyById>) {
    if (!key) return null;
    const { key: _fullKey, ...rest } = key;
    return rest;
}

const adminApiKeysRoute: FastifyPluginAsync = async (fastify) => {
    const authHeaders = {
        type: 'object',
        properties: { authorization: { type: 'string' } },
        required: ['authorization']
    };

    const keyIdParam = {
        type: 'object',
        properties: { key_id: { type: 'string' } },
        required: ['key_id']
    };

    fastify.get('/v1/admin/api-keys', {
        schema: { headers: authHeaders, tags: ['Admin'], summary: 'List parent API keys' },
        preHandler: adminKeyAuth
    }, async () => {
        return {
            object: 'list',
            data: agentStore.listApiKeys().map(publicKeyView),
        };
    });

    fastify.post<{ Body: { name?: string; owner?: string; role?: string } }>('/v1/admin/api-keys', {
        schema: {
            headers: authHeaders,
            tags: ['Admin'],
            summary: 'Create a parent API key',
            body: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    owner: { type: 'string' },
                    role: { type: 'string', enum: ['admin', 'user'] }
                },
                required: ['name']
            }
        },
        preHandler: adminKeyAuth
    }, async (request, reply) => {
        const name = request.body?.name?.trim();
        if (!name) {
            reply.code(400);
            return createError("'name' is required", 'invalid_request_error');
        }

        const role = parseRole(request.body?.role);
        if (!role) {
            reply.code(400);
            return createError("'role' must be 'admin' or 'user'", 'invalid_request_error');
        }

        const created = agentStore.createApiKey({
            id: generateId('api-key'),
            name,
            owner: request.body?.owner?.trim() || null,
            key: generateParentKey(),
            role,
            created_by: request.apiKey?.id || null,
        });

        reply.code(201);
        reply.header('Cache-Control', 'no-store');
        return created;
    });

    fastify.patch<{ Params: { key_id: string }; Body: { name?: string; owner?: string | null; role?: string } }>('/v1/admin/api-keys/:key_id', {
        schema: {
            headers: authHeaders,
            params: keyIdParam,
            tags: ['Admin'],
            summary: 'Update parent API key metadata',
        },
        preHandler: adminKeyAuth
    }, async (request, reply) => {
        const existing = agentStore.getApiKeyById(request.params.key_id);
        if (!existing) {
            reply.code(404);
            return createError('API key not found', 'invalid_request_error');
        }
        if (existing.revoked_at) {
            reply.code(400);
            return createError('Cannot update a revoked API key', 'invalid_request_error');
        }

        const name = request.body?.name?.trim() || existing.name;
        const role = parseRole(request.body?.role ?? existing.role);
        if (!role) {
            reply.code(400);
            return createError("'role' must be 'admin' or 'user'", 'invalid_request_error');
        }

        const updated = agentStore.updateApiKey(request.params.key_id, {
            name,
            owner: request.body?.owner == null ? existing.owner : request.body.owner.trim() || null,
            role,
        });
        return publicKeyView(updated);
    });

    fastify.post<{ Params: { key_id: string } }>('/v1/admin/api-keys/:key_id/revoke', {
        schema: {
            headers: authHeaders,
            params: keyIdParam,
            tags: ['Admin'],
            summary: 'Revoke a parent API key',
        },
        preHandler: adminKeyAuth
    }, async (request, reply) => {
        const existing = agentStore.getApiKeyById(request.params.key_id);
        if (!existing) {
            reply.code(404);
            return createError('API key not found', 'invalid_request_error');
        }

        const revoked = agentStore.revokeApiKey(request.params.key_id);
        if (!revoked) {
            reply.code(400);
            return createError('API key is already revoked', 'invalid_request_error');
        }

        reply.header('Cache-Control', 'no-store');
        return publicKeyView(revoked);
    });
};

export default adminApiKeysRoute;
