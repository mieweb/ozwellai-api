/**
 * API Key Management Routes
 *
 * CRUD operations for API keys (as documented in api-authentication.md)
 */

import { FastifyInstance } from 'fastify';
import { apiKeyRepository } from '../db/repositories';
import { sessionAuth } from '../auth/middleware';
import { ApiKeyType } from '../db/types';
import { createError } from '../util';

interface CreateKeyBody {
  name: string;
  type: ApiKeyType;
  permissions?: {
    allowed_agents?: string[];
    allowed_tools?: string[];
    allowed_models?: string[];
    allowed_domains?: string[];
  };
  rate_limit?: number;
}

interface UpdateKeyBody {
  name?: string;
  permissions?: {
    allowed_agents?: string[];
    allowed_tools?: string[];
    allowed_models?: string[];
    allowed_domains?: string[];
  };
}

export default async function apiKeysRoutes(fastify: FastifyInstance) {
  // All routes require session authentication
  fastify.addHook('preHandler', sessionAuth);

  /**
   * GET /v1/api-keys
   * List all API keys for the current user
   */
  fastify.get(
    '/v1/api-keys',
    {
      schema: {
        description: 'List all API keys for the authenticated user',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              object: { type: 'string', const: 'list' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['general', 'scoped'] },
                    key_prefix: { type: 'string' },
                    key_hint: { type: 'string' },
                    created_at: { type: 'string' },
                    last_used_at: { type: ['string', 'null'] },
                    revoked_at: { type: ['string', 'null'] },
                    rate_limit: { type: 'number' },
                    permissions: {
                      type: 'object',
                      properties: {
                        allowed_agents: { type: 'array', items: { type: 'string' } },
                        allowed_tools: { type: 'array', items: { type: 'string' } },
                        allowed_models: { type: 'array', items: { type: 'string' } },
                        allowed_domains: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const keys = apiKeyRepository.listByUserId(request.userId!);

      return {
        object: 'list',
        data: keys,
      };
    }
  );

  /**
   * POST /v1/api-keys
   * Create a new API key
   */
  fastify.post<{ Body: CreateKeyBody }>(
    '/v1/api-keys',
    {
      schema: {
        description: 'Create a new API key',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name', 'type'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            type: { type: 'string', enum: ['general', 'scoped'] },
            permissions: {
              type: 'object',
              properties: {
                allowed_agents: { type: 'array', items: { type: 'string' } },
                allowed_tools: { type: 'array', items: { type: 'string' } },
                allowed_models: { type: 'array', items: { type: 'string' } },
                allowed_domains: { type: 'array', items: { type: 'string' } },
              },
            },
            rate_limit: { type: 'number', minimum: 1, maximum: 10000, default: 100 },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string' },
              key: { type: 'string', description: 'Full API key - only shown once!' },
              key_hint: { type: 'string' },
              created_at: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, type, permissions, rate_limit } = request.body;

      // Validate: scoped keys should have permissions
      if (type === 'scoped' && !permissions) {
        return reply.code(400).send(createError(
          'Scoped keys require permissions to be specified',
          'validation_error',
          null,
          'missing_permissions'
        ));
      }

      const { apiKey, fullKey } = apiKeyRepository.create(
        request.userId!,
        name,
        type,
        permissions,
        rate_limit || 100
      );

      return reply.code(201).send({
        id: apiKey.id,
        name: apiKey.name,
        type: apiKey.type,
        key: fullKey, // Only time the full key is returned!
        key_hint: apiKey.key_hint,
        created_at: apiKey.created_at,
      });
    }
  );

  /**
   * GET /v1/api-keys/:id
   * Get details of a specific API key
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/api-keys/:id',
    {
      schema: {
        description: 'Get details of a specific API key',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const key = apiKeyRepository.findByIdAndUser(id, request.userId!);

      if (!key) {
        return reply.code(404).send(createError(
          'API key not found',
          'not_found_error',
          null,
          'key_not_found'
        ));
      }

      return key;
    }
  );

  /**
   * PATCH /v1/api-keys/:id
   * Update an API key (name, permissions)
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateKeyBody }>(
    '/v1/api-keys/:id',
    {
      schema: {
        description: 'Update an API key',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            permissions: {
              type: 'object',
              properties: {
                allowed_agents: { type: 'array', items: { type: 'string' } },
                allowed_tools: { type: 'array', items: { type: 'string' } },
                allowed_models: { type: 'array', items: { type: 'string' } },
                allowed_domains: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { permissions } = request.body;

      // Check key exists and belongs to user
      const key = apiKeyRepository.findByIdAndUser(id, request.userId!);

      if (!key) {
        return reply.code(404).send(createError(
          'API key not found',
          'not_found_error',
          null,
          'key_not_found'
        ));
      }

      // Update permissions if provided (only for scoped keys)
      if (permissions) {
        if (key.type !== 'scoped') {
          return reply.code(400).send(createError(
            'Cannot set permissions on a general-purpose key',
            'validation_error',
            null,
            'invalid_operation'
          ));
        }

        const updated = apiKeyRepository.updatePermissions(id, request.userId!, permissions);
        if (!updated) {
          return reply.code(500).send(createError(
            'Failed to update permissions',
            'server_error',
            null,
            'update_failed'
          ));
        }
      }

      // Return updated key (single efficient lookup)
      return apiKeyRepository.findByIdAndUser(id, request.userId!);
    }
  );

  /**
   * POST /v1/api-keys/:id/revoke
   * Revoke an API key (keeps it in history but makes it unusable)
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/api-keys/:id/revoke',
    {
      schema: {
        description: 'Revoke an API key',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const revoked = apiKeyRepository.revoke(id, request.userId!);

      if (!revoked) {
        return reply.code(404).send(createError(
          'API key not found or already revoked',
          'not_found_error',
          null,
          'key_not_found'
        ));
      }

      return { success: true, message: 'API key revoked' };
    }
  );

  /**
   * DELETE /v1/api-keys/:id
   * Delete an API key permanently
   */
  fastify.delete<{ Params: { id: string } }>(
    '/v1/api-keys/:id',
    {
      schema: {
        description: 'Delete an API key permanently',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = apiKeyRepository.delete(id, request.userId!);

      if (!deleted) {
        return reply.code(404).send(createError(
          'API key not found',
          'not_found_error',
          null,
          'key_not_found'
        ));
      }

      return { success: true, message: 'API key deleted' };
    }
  );
}
