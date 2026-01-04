/**
 * Server configuration and extensibility types
 * These types enable the reference-server to be extended by private implementations
 */

import type { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';

/**
 * Result of authentication validation
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  valid: boolean;
  /** Optional user/account identifier for logging or context */
  userId?: string;
  /** Optional organization identifier */
  orgId?: string;
  /** Optional error message if validation failed */
  error?: string;
  /** Additional context to attach to the request */
  context?: Record<string, unknown>;
}

/**
 * Authentication handler function signature
 * Override this to implement custom authentication (JWT, API keys, billing checks, etc.)
 */
export type AuthHandler = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<AuthResult> | AuthResult;

/**
 * Lifecycle hook for extending server behavior
 */
export type ServerLifecycleHook = (server: FastifyInstance) => Promise<void> | void;

/**
 * Route registration options
 */
export interface RouteOptions {
  /** Route prefix (e.g., '/v1' or '/api/v1') */
  prefix?: string;
  /** Whether to skip auth for this route group */
  skipAuth?: boolean;
}

/**
 * OpenAPI/Swagger configuration
 */
export interface SwaggerOptions {
  /** API title */
  title?: string;
  /** API description */
  description?: string;
  /** API version */
  version?: string;
  /** Server URLs for documentation */
  servers?: Array<{ url: string; description: string }>;
  /** Contact information */
  contact?: { name?: string; email?: string; url?: string };
}

/**
 * Configuration options for building the server
 * Pass these to buildServer() to customize behavior
 */
export interface ServerOptions {
  /**
   * Custom authentication handler
   * Default: accepts any non-empty Bearer token (for testing)
   */
  authHandler?: AuthHandler;

  /**
   * Routes that should skip authentication entirely
   * Default: ['/health', '/docs', '/openapi.json']
   */
  publicRoutes?: string[];

  /**
   * API route prefix
   * Default: '' (routes at /v1/...)
   * Example: '/api' would make routes available at /api/v1/...
   */
  routePrefix?: string;

  /**
   * Called after core plugins are registered but before routes
   * Use this to register additional middleware or plugins
   */
  onBeforeRoutes?: ServerLifecycleHook;

  /**
   * Called after all routes are registered
   * Use this to register additional routes or finalize configuration
   */
  onAfterRoutes?: ServerLifecycleHook;

  /**
   * Swagger/OpenAPI documentation options
   */
  swagger?: SwaggerOptions;

  /**
   * Whether to register the default API routes (models, chat, etc.)
   * Default: true
   * Set to false if you want to register routes manually
   */
  registerDefaultRoutes?: boolean;

  /**
   * Whether to register static file serving (public/, embed/)
   * Default: true
   */
  serveStatic?: boolean;

  /**
   * Whether to register Swagger UI at /docs
   * Default: true
   */
  enableDocs?: boolean;

  /**
   * Custom Fastify instance options
   * Merged with defaults (logger based on NODE_ENV)
   */
  fastifyOptions?: {
    logger?: boolean | object;
    [key: string]: unknown;
  };

  /**
   * Root directory for static files
   * Default: process.cwd()
   */
  rootDir?: string;
}

/**
 * Extended Fastify request with auth context
 */
declare module 'fastify' {
  interface FastifyRequest {
    /** Authentication context set by auth handler */
    authContext?: AuthResult;
  }
}
