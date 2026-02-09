import 'dotenv/config';
import Fastify from 'fastify';
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

const fastify = Fastify({
  logger: process.env.NODE_ENV !== 'production',
});

async function buildServer() {
  const rootDir = path.resolve(process.cwd());

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
        title: 'OzwellAI Reference API',
        description: 'OpenAI-compatible API reference implementation',
        version: '1.0.0',
        contact: {
          name: 'OzwellAI',
          email: 'support@ozwellai.com',
        },
        license: {
          name: 'Apache 2.0',
          url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
        },
      },
      servers: [
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

  // Register Swagger UI
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

  // Register API routes
  await fastify.register(modelsRoute);
  await fastify.register(chatRoute);
  await fastify.register(responsesRoute);
  await fastify.register(embeddingsRoute);
  await fastify.register(filesRoute);
  await fastify.register(mockChatRoute);  // Mock AI for demos

  // Serve embed assets (widget files)
  await fastify.register(fastifyStatic, {
    root: path.join(rootDir, 'embed'),
    prefix: '/embed/',
  });

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
