/**
 * Authentication Middleware
 *
 * Validates API keys and enforces scoped permissions.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { apiKeyRepository, rateLimitRepository } from '../db/repositories';
import { verifySessionToken, getKeyPrefix } from './crypto';
import { ApiKeyWithPermissions } from '../db/types';

// Extend FastifyRequest to include our auth data
declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyWithPermissions;
    userId?: string;
  }
}

/**
 * Create OpenAI-compatible error response
 */
function createError(message: string, type: string, code: string) {
  return {
    error: {
      message,
      type,
      code,
    },
  };
}

/**
 * API Key authentication middleware
 * Validates Bearer token as an Ozwell API key
 */
export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  // Check for Authorization header
  if (!authHeader) {
    reply.code(401).send(createError(
      'API key is required',
      'authentication_error',
      'missing_api_key'
    ));
    return;
  }

  // Check Bearer format
  if (!authHeader.startsWith('Bearer ')) {
    reply.code(401).send(createError(
      'Invalid Authorization header format. Expected: Bearer <api_key>',
      'authentication_error',
      'invalid_api_key'
    ));
    return;
  }

  const token = authHeader.slice(7);

  // Check for valid Ozwell key prefix
  const prefix = getKeyPrefix(token);
  if (!prefix) {
    reply.code(401).send(createError(
      'Invalid API key provided. Keys must start with ozw_ or ozw_scoped_',
      'authentication_error',
      'invalid_api_key'
    ));
    return;
  }

  // Look up key in database
  const apiKey = apiKeyRepository.findByKey(token);
  if (!apiKey) {
    reply.code(401).send(createError(
      'Invalid API key provided',
      'authentication_error',
      'invalid_api_key'
    ));
    return;
  }

  // Check if revoked
  if (apiKey.revoked_at) {
    reply.code(401).send(createError(
      'API key has been revoked',
      'authentication_error',
      'invalid_api_key'
    ));
    return;
  }

  // Check rate limit
  const withinLimit = rateLimitRepository.checkAndIncrement(apiKey.id, apiKey.rate_limit);
  if (!withinLimit) {
    const remaining = rateLimitRepository.getRemaining(apiKey.id, apiKey.rate_limit);
    const resetTime = Math.ceil(Date.now() / 60000) * 60; // Next minute

    reply
      .code(429)
      .header('X-RateLimit-Limit', apiKey.rate_limit.toString())
      .header('X-RateLimit-Remaining', remaining.toString())
      .header('X-RateLimit-Reset', resetTime.toString())
      .header('Retry-After', '60')
      .send(createError(
        'Rate limit exceeded. Please retry after 60 seconds.',
        'rate_limit_error',
        'rate_limit_exceeded'
      ));
    return;
  }

  // For scoped keys, check domain restriction
  if (apiKey.type === 'scoped' && apiKey.permissions?.allowed_domains.length) {
    const origin = request.headers.origin || request.headers.referer;
    if (origin && !matchesDomain(origin, apiKey.permissions.allowed_domains)) {
      reply.code(403).send(createError(
        'API key is not authorized for this domain',
        'permission_error',
        'domain_not_allowed'
      ));
      return;
    }
  }

  // Attach API key to request for downstream use
  request.apiKey = apiKey;

  // Add rate limit headers to all responses
  const remaining = rateLimitRepository.getRemaining(apiKey.id, apiKey.rate_limit);
  const resetTime = Math.ceil(Date.now() / 60000) * 60; // Next minute boundary
  reply.header('X-RateLimit-Limit', apiKey.rate_limit.toString());
  reply.header('X-RateLimit-Remaining', remaining.toString());
  reply.header('X-RateLimit-Reset', resetTime.toString());

  // Update last_used_at (fire and forget)
  setImmediate(() => {
    apiKeyRepository.updateLastUsed(apiKey.id);
  });
}

/**
 * Check if an origin matches any of the allowed domains
 */
function matchesDomain(origin: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;

  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    for (const pattern of allowedDomains) {
      if (pattern.startsWith('*.')) {
        // Wildcard match: *.example.com matches sub.example.com
        const baseDomain = pattern.slice(2);
        if (hostname === baseDomain || hostname.endsWith('.' + baseDomain)) {
          return true;
        }
      } else {
        // Exact match
        if (hostname === pattern) {
          return true;
        }
      }
    }
  } catch {
    // Invalid URL, don't match
  }

  return false;
}

/**
 * Middleware to check if scoped key has access to a specific tool
 */
export function requireTool(toolName: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { apiKey } = request;

    // General keys have full access
    if (!apiKey || apiKey.type === 'general') return;

    // Check scoped permissions
    const allowed = apiKey.permissions?.allowed_tools || [];
    if (allowed.length > 0 && !allowed.includes(toolName) && !allowed.includes('*')) {
      reply.code(403).send(createError(
        `API key does not have access to tool: ${toolName}`,
        'permission_error',
        'insufficient_permissions'
      ));
    }
  };
}

/**
 * Middleware to check if scoped key has access to a specific model
 */
export function requireModel(modelName: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { apiKey } = request;

    // General keys have full access
    if (!apiKey || apiKey.type === 'general') return;

    // Check scoped permissions
    const allowed = apiKey.permissions?.allowed_models || [];
    if (allowed.length > 0 && !allowed.includes(modelName) && !allowed.includes('*')) {
      reply.code(403).send(createError(
        `API key does not have access to model: ${modelName}`,
        'permission_error',
        'insufficient_permissions'
      ));
    }
  };
}

/**
 * Middleware to check if scoped key has access to a specific agent
 */
export function requireAgent(agentId: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { apiKey } = request;

    // General keys have full access
    if (!apiKey || apiKey.type === 'general') return;

    // Check scoped permissions
    const allowed = apiKey.permissions?.allowed_agents || [];
    if (allowed.length > 0 && !allowed.includes(agentId) && !allowed.includes('*')) {
      reply.code(403).send(createError(
        `API key does not have access to agent: ${agentId}`,
        'permission_error',
        'insufficient_permissions'
      ));
    }
  };
}

/**
 * Dashboard session authentication middleware
 * Validates session token from cookie or Authorization header
 */
export async function sessionAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Check Authorization header first, then cookie
  let token: string | undefined;

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // Also check for session cookie (for browser-based dashboard)
  const cookies = parseCookies(request.headers.cookie || '');
  if (!token && cookies['ozwell_session']) {
    token = cookies['ozwell_session'];
  }

  if (!token) {
    reply.code(401).send(createError(
      'Authentication required',
      'authentication_error',
      'missing_session'
    ));
    return;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    reply.code(401).send(createError(
      'Invalid or expired session',
      'authentication_error',
      'invalid_session'
    ));
    return;
  }

  request.userId = payload.user_id;
}

/**
 * Simple cookie parser
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (name && rest.length) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  });
  return cookies;
}
