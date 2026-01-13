/**
 * Dashboard Authentication Routes
 *
 * Handles user registration and login for the dashboard.
 */

import { FastifyInstance } from 'fastify';
import { userRepository } from '../db/repositories';
import { generateSessionToken } from '../auth/crypto';
import { apiKeyAuth, parseCookies } from '../auth/middleware';

interface RegisterBody {
  email: string;
  password: string;
}

interface LoginBody {
  email: string;
  password: string;
}

export default async function authRoutes(fastify: FastifyInstance) {
  /**
   * POST /auth/register
   * Create a new user account
   */
  fastify.post<{ Body: RegisterBody }>(
    '/auth/register',
    {
      schema: {
        description: 'Create a new user account',
        tags: ['Authentication'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      // Check if user already exists
      const existingUser = userRepository.findByEmail(email);
      if (existingUser) {
        return reply.code(400).send({
          error: {
            message: 'An account with this email already exists',
            type: 'validation_error',
            code: 'email_taken',
          },
        });
      }

      // Create user
      const user = userRepository.create(email, password);

      // Generate session token
      const token = generateSessionToken(user.id);

      // Set cookie for browser access
      reply.header('Set-Cookie', `ozwell_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);

      return reply.code(201).send({
        token,
        user: {
          id: user.id,
          email: user.email,
        },
      });
    }
  );

  /**
   * POST /auth/login
   * Authenticate and get a session token
   */
  fastify.post<{ Body: LoginBody }>(
    '/auth/login',
    {
      schema: {
        description: 'Login to get a session token',
        tags: ['Authentication'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      // Verify credentials
      const user = userRepository.verifyCredentials(email, password);
      if (!user) {
        return reply.code(401).send({
          error: {
            message: 'Invalid email or password',
            type: 'authentication_error',
            code: 'invalid_credentials',
          },
        });
      }

      // Generate session token
      const token = generateSessionToken(user.id);

      // Set cookie for browser access
      reply.header('Set-Cookie', `ozwell_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
        },
      };
    }
  );

  /**
   * POST /auth/logout
   * Clear session
   */
  fastify.post('/auth/logout', async (_request, reply) => {
    // Clear the session cookie
    reply.header('Set-Cookie', 'ozwell_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { success: true };
  });

  /**
   * GET /auth/me
   * Get current user info (requires session)
   */
  fastify.get(
    '/auth/me',
    {
      schema: {
        description: 'Get current user info',
        tags: ['Authentication'],
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      // Parse session from cookie or header
      let token: string | undefined;

      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }

      const cookies = parseCookies(request.headers.cookie || '');

      if (!token && cookies['ozwell_session']) {
        token = cookies['ozwell_session'];
      }

      if (!token) {
        return reply.code(401).send({
          error: {
            message: 'Not authenticated',
            type: 'authentication_error',
            code: 'missing_session',
          },
        });
      }

      // Import here to avoid circular dependency
      const { verifySessionToken } = await import('../auth/crypto');
      const payload = verifySessionToken(token);

      if (!payload) {
        return reply.code(401).send({
          error: {
            message: 'Invalid or expired session',
            type: 'authentication_error',
            code: 'invalid_session',
          },
        });
      }

      const user = userRepository.findById(payload.user_id);
      if (!user) {
        return reply.code(401).send({
          error: {
            message: 'User not found',
            type: 'authentication_error',
            code: 'user_not_found',
          },
        });
      }

      return {
        id: user.id,
        email: user.email,
      };
    }
  );

  /**
   * GET /v1/auth/verify
   * Verify an API key and return key info (useful for debugging)
   */
  fastify.get(
    '/v1/auth/verify',
    {
      preHandler: apiKeyAuth,
      schema: {
        description: 'Verify API key and return key info',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              key: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string' },
                  prefix: { type: 'string' },
                  hint: { type: 'string' },
                  rate_limit: { type: 'number' },
                  created_at: { type: 'string' },
                  last_used_at: { type: 'string', nullable: true },
                },
              },
              permissions: {
                type: 'object',
                nullable: true,
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
    async (request) => {
      const apiKey = request.apiKey!;

      return {
        valid: true,
        key: {
          id: apiKey.id,
          name: apiKey.name,
          type: apiKey.type,
          prefix: apiKey.key_prefix,
          hint: apiKey.key_hint,
          rate_limit: apiKey.rate_limit,
          created_at: apiKey.created_at,
          last_used_at: apiKey.last_used_at,
        },
        permissions: apiKey.permissions ? {
          allowed_agents: apiKey.permissions.allowed_agents,
          allowed_tools: apiKey.permissions.allowed_tools,
          allowed_models: apiKey.permissions.allowed_models,
          allowed_domains: apiKey.permissions.allowed_domains,
        } : null,
      };
    }
  );
}
