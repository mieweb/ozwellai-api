import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';

// Import routes
import modelsRoute from './routes/models';
import chatRoute from './routes/chat';
import responsesRoute from './routes/responses';
import embeddingsRoute from './routes/embeddings';
import filesRoute from './routes/files';
import mockChatRoute from './routes/mock-chat';
// Import schemas for OpenAPI generation
import * as schemas from '../../spec';
// Import types for extensibility
import type { ServerOptions, AuthHandler, AuthResult } from './types';
import { validateAuth } from './util';

// Re-export types and route plugins for extensibility
export type { ServerOptions, AuthHandler, AuthResult };
export { modelsRoute, chatRoute, responsesRoute, embeddingsRoute, filesRoute, mockChatRoute };

/**
 * Default authentication handler - accepts any non-empty Bearer token
 * Override this via ServerOptions.authHandler for production use
 */
const defaultAuthHandler: AuthHandler = async (request) => {
  const valid = validateAuth(request.headers.authorization);
  return { valid };
};

/**
 * Default public routes that skip authentication
 */
const DEFAULT_PUBLIC_ROUTES = ['/health', '/docs', '/openapi.json', '/embed/', '/public/'];

/**
 * Build the Fastify server with optional configuration
 * @param options - Server configuration options for customization
 */
async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const {
    authHandler = defaultAuthHandler,
    publicRoutes = DEFAULT_PUBLIC_ROUTES,
    routePrefix = '',
    onBeforeRoutes,
    onAfterRoutes,
    swagger: swaggerOpts = {},
    registerDefaultRoutes = true,
    serveStatic = true,
    enableDocs = true,
    fastifyOptions = {},
    rootDir: customRootDir,
  } = options;

  const rootDir = customRootDir || path.resolve(process.cwd());

  // Create Fastify instance with merged options
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== 'production',
    ...fastifyOptions,
  });

  // Store auth handler on server for routes to access
  fastify.decorate('authHandler', authHandler);
  fastify.decorate('publicRoutes', publicRoutes);

  // Register global auth preHandler hook
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip auth for public routes
    const isPublic = publicRoutes.some(route => request.url.startsWith(route));
    if (isPublic) {
      return;
    }

    // Run auth handler
    const authResult = await authHandler(request, reply);
    request.authContext = authResult;

    if (!authResult.valid) {
      return reply.code(401).send({
        error: {
          message: authResult.error || 'Invalid authentication credentials',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_api_key',
        },
      });
    }
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Register multipart for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
    },
  });

  // Register Swagger for OpenAPI documentation
  await fastify.register(swagger as any, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: swaggerOpts.title || 'OzwellAI Reference API',
        description: swaggerOpts.description || 'OpenAI-compatible API reference implementation',
        version: swaggerOpts.version || '1.0.0',
        contact: swaggerOpts.contact || {
          name: 'OzwellAI',
          email: 'support@ozwellai.com',
        },
        license: {
          name: 'Apache 2.0',
          url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
        },
      },
      servers: swaggerOpts.servers || [
        {
          url: 'http://localhost:3000',
          description: 'Development server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
        schemas: {
          // Add schemas for OpenAPI documentation
          Error: schemas.ErrorSchema,
          Model: schemas.ModelSchema,
          ModelsListResponse: schemas.ModelsListResponseSchema,
          ChatCompletionRequest: schemas.ChatCompletionRequestSchema,
          ChatCompletionResponse: schemas.ChatCompletionResponseSchema,
          ResponseRequest: schemas.ResponseRequestSchema,
          Response: schemas.ResponseSchema,
          EmbeddingRequest: schemas.EmbeddingRequestSchema,
          EmbeddingResponse: schemas.EmbeddingResponseSchema,
          FileObject: schemas.FileObjectSchema,
          FileListResponse: schemas.FileListResponseSchema,
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
  });

  // Register Swagger UI (conditionally)
  if (enableDocs) {
    await fastify.register(swaggerUI, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
      uiHooks: {
        onRequest: function (request, reply, next) { next(); },
        preHandler: function (request, reply, next) { next(); },
      },
      staticCSP: true,
      transformStaticCSP: (header) => header,
      transformSpecification: (swaggerObject, request, reply) => {
        return swaggerObject;
      },
      transformSpecificationClone: true,
    });
  }

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // OpenAPI spec endpoint
  fastify.get('/openapi.json', async (request, reply) => {
    return fastify.swagger();
  });

  // Allow widget to be embedded on any website (CSP frame-ancestors)
  fastify.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/embed/')) {
      reply.header('Content-Security-Policy', 'frame-ancestors *');
    }
  });

  // Lifecycle hook: before routes
  if (onBeforeRoutes) {
    await onBeforeRoutes(fastify);
  }

  // Register API routes (conditionally)
  if (registerDefaultRoutes) {
    const prefix = routePrefix || '';
    await fastify.register(modelsRoute, { prefix });
    await fastify.register(chatRoute, { prefix });
    await fastify.register(responsesRoute, { prefix });
    await fastify.register(embeddingsRoute, { prefix });
    await fastify.register(filesRoute, { prefix });
    await fastify.register(mockChatRoute, { prefix });  // Mock AI for demos
  }

  // Serve static assets (conditionally)
  if (serveStatic) {
    // Serve public assets (documentation, misc)
    await fastify.register(fastifyStatic, {
      root: path.join(rootDir, 'public'),
      prefix: '/',
    });

    // Serve embed assets from dedicated directory
    await fastify.register(fastifyStatic, {
      root: path.join(rootDir, 'embed'),
      prefix: '/embed/',
      decorateReply: false,
    });
  }

  // Lifecycle hook: after routes
  if (onAfterRoutes) {
    await onAfterRoutes(fastify);
  }

  // 404 handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        message: `Route ${request.method} ${request.url} not found`,
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    });
  });

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    
    // Handle validation errors
    if (error.validation) {
      return reply.code(400).send({
        error: {
          message: 'Invalid request body',
          type: 'invalid_request_error',
          param: error.validation[0]?.schemaPath || null,
          code: null,
        },
      });
    }

    // Default error response
    reply.code(500).send({
      error: {
        message: 'Internal server error',
        type: 'server_error',
        param: null,
        code: null,
      },
    });
  });

  return fastify;
}

// Start server if this file is executed directly
if (require.main === module) {
  const start = async () => {
    try {
      const server = await buildServer();
      const port = parseInt(process.env.PORT || '3000', 10);
      const host = process.env.HOST || '0.0.0.0';
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      
      await server.listen({ port, host });
      console.log(`🚀 OzwellAI Reference Server running at http://${displayHost}:${port}`);
      console.log(`📖 API Documentation available at http://${displayHost}:${port}/docs`);
      console.log(`🔧 OpenAPI spec available at http://${displayHost}:${port}/openapi.json`);
    } catch (err) {
      console.error('Error starting server:', err);
      process.exit(1);
    }
  };

  start();
}

export default buildServer;
