import { FastifyPluginAsync } from 'fastify';
import { EmbeddingRequestSchema, EmbeddingResponseSchema } from '../schemas';
import { validateAuth, createError, generateEmbedding, countTokens } from '../util';

const embeddingsRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/embeddings
  fastify.post('/v1/embeddings', {
    schema: {
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          input: { 
            type: 'string'
          },
          dimensions: { type: 'number' }
        },
        required: ['model', 'input']
      }
    },
  }, async (request, reply) => {
    // Validate authorization
    if (!validateAuth(request.headers.authorization)) {
      reply.code(401);
      return createError('Invalid API key provided', 'invalid_request_error');
    }

    const body = request.body as any;
    const { model, input, dimensions } = body;

    // Validate model and get dimensions
    const modelDimensions: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    };

    if (!modelDimensions[model]) {
      reply.code(400);
      return createError(`Model '${model}' not found`, 'invalid_request_error', 'model');
    }

    const actualDimensions = dimensions || modelDimensions[model];

    // Add OpenAI-compatible headers
    reply.headers({
      'x-request-id': `req_${Date.now()}`,
      'openai-processing-ms': '80',
      'openai-version': '2020-10-01',
    });

    // Handle both string and array inputs
    const inputs = Array.isArray(input) ? input : [input];
    
    const embeddings = inputs.map((text: string, index: number) => ({
      object: 'embedding' as const,
      embedding: generateEmbedding(text, actualDimensions),
      index,
    }));

    // Calculate token usage
    const totalTokens = inputs.reduce((sum: number, text: string) => sum + countTokens(text), 0);

    return {
      object: 'list' as const,
      data: embeddings,
      model,
      usage: {
        prompt_tokens: totalTokens,
        total_tokens: totalTokens,
      },
    };
  });
};

export default embeddingsRoute;