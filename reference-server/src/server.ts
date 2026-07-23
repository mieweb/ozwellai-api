import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';

// Import routes
import modelsRoute, { refreshProviderModels } from './routes/models';
import chatRoute from './routes/chat';
import responsesRoute from './routes/responses';
import embeddingsRoute from './routes/embeddings';
import filesRoute from './routes/files';
import agentsRoute from './routes/agents';
import audioRoute from './routes/audio';
import { getDatabase, initializeAuthTables, seedDemoData, seedMockAgent } from './storage/agents';
// Import schemas for OpenAPI generation
import * as schemas from '../../spec';

const DEFAULT_BODY_LIMIT_MB = 50;
const DEFAULT_MODEL_DISCOVERY_REFRESH_MS = 10 * 60 * 1000;

function getBodyLimitBytes(): number {
  const raw = parseInt(process.env.BODY_LIMIT_MB || `${DEFAULT_BODY_LIMIT_MB}`, 10);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BODY_LIMIT_MB;
  return mb * 1024 * 1024;
}

const fastify = Fastify({
  logger: process.env.NODE_ENV !== 'production',
  bodyLimit: getBodyLimitBytes(),
});

function getModelDiscoveryRefreshMs(): number {
  const raw = parseInt(process.env.MODEL_DISCOVERY_REFRESH_MS || `${DEFAULT_MODEL_DISCOVERY_REFRESH_MS}`, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function scheduleModelDiscoveryRefresh(server: FastifyInstance) {
  const refreshMs = getModelDiscoveryRefreshMs();
  if (!refreshMs) return;

  const refresh = async () => {
    try {
      const models = await refreshProviderModels();
      server.log.info({ model_count: models.length }, 'Provider model registry refreshed');
    } catch (err) {
      server.log.warn({ err }, 'Provider model registry refresh failed');
    }
  };

  const firstRun = setTimeout(() => { void refresh(); }, 1000);
  const interval = setInterval(() => { void refresh(); }, refreshMs);
  firstRun.unref?.();
  interval.unref?.();

  server.addHook('onClose', (_instance, done) => {
    clearTimeout(firstRun);
    clearInterval(interval);
    done();
  });
}

async function buildServer() {
  const rootDir = path.resolve(process.cwd());

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Register multipart for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
    },
  });

  // Register Swagger for OpenAPI documentation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          description: 'Local development',
        },
        {
          url: 'https://ozwellapi-prod.os.mieweb.org',
          description: 'Current official public server',
        },
        {
          url: 'https://ozwellapi.os.mieweb.org',
          description: 'Development server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API Key (ozw_... for management, agnt_key-... for chat)',
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
          AudioTranscriptionRequest: schemas.AudioTranscriptionRequestSchema,
          AudioTranscriptionResponse: schemas.AudioTranscriptionResponseSchema,
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
      onRequest: function (_request, _reply, next) { next(); },
      preHandler: function (_request, _reply, next) { next(); },
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    transformSpecification: (swaggerObject, _request, _reply) => {
      return swaggerObject;
    },
    transformSpecificationClone: true,
  });

  // Health check endpoint
  fastify.get('/health', async (_request, _reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // OpenAPI spec endpoint
  fastify.get('/openapi.json', async (_request, _reply) => {
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
  await fastify.register(agentsRoute);  // Agent registration CRUD
  await fastify.register(audioRoute);   // Audio transcription

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

      // Initialize auth database and seed demo data
      const db = getDatabase();
      initializeAuthTables(db);
      if (process.env.NODE_ENV !== 'production') {
        try {
          seedDemoData(db);
          seedMockAgent();
        } catch (_e) {
          // Seeding may fail on repeated starts — that's fine
        }
      }

      scheduleModelDiscoveryRefresh(server);
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
