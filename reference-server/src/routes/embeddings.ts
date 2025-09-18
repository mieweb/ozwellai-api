import { FastifyPluginAsync } from "fastify";
import {
  validateAuth,
  createError,
  generateEmbedding,
  countTokens,
} from "../util";

const embeddingsRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/embeddings
  fastify.post(
    "/v1/embeddings",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            model: {
              type: "string",
              enum: [
                "text-embedding-3-small",
                "text-embedding-3-large",
                "text-embedding-ada-002",
              ],
              description: "ID of the model to use for generating embeddings",
            },
            input: {
              type: "string",
              description: "The input text to generate embeddings for",
            },
            dimensions: {
              type: "number",
              minimum: 1,
              description:
                "The number of dimensions the resulting output embeddings should have",
            },
          },
          required: ["model", "input"],
          examples: [
            {
              model: "text-embedding-3-small",
              input: "The food was delicious and the waiter was very friendly.",
              dimensions: 1536,
            },
          ],
        },
        response: {
          200: {
            type: "object",
            properties: {
              object: { type: "string" },
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    object: { type: "string" },
                    embedding: {
                      type: "array",
                      items: { type: "number" },
                    },
                    index: { type: "number" },
                  },
                },
              },
              model: { type: "string" },
              usage: {
                type: "object",
                properties: {
                  prompt_tokens: { type: "number" },
                  total_tokens: { type: "number" },
                },
              },
            },
          },
          400: {
            type: "object",
            properties: {
              error: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  type: { type: "string" },
                  param: { type: ["string", "null"] },
                  code: { type: ["string", "null"] },
                },
              },
            },
          },
          401: {
            type: "object",
            properties: {
              error: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  type: { type: "string" },
                  param: { type: ["string", "null"] },
                  code: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      // Validate authorization
      if (!validateAuth(request.headers.authorization)) {
        reply.code(401);
        return createError("Invalid API key provided", "invalid_request_error");
      }

      interface EmbeddingRequest {
        model: string;
        input: string;
        dimensions?: number;
      }

      const body = request.body as EmbeddingRequest;
      const { model, input, dimensions } = body;

      // Validate model and get dimensions
      const modelDimensions: Record<string, number> = {
        "text-embedding-3-small": 1536,
        "text-embedding-3-large": 3072,
        "text-embedding-ada-002": 1536,
      };

      if (!modelDimensions[model]) {
        reply.code(400);
        return createError(
          `Model '${model}' not found`,
          "invalid_request_error",
          "model"
        );
      }

      const actualDimensions = dimensions || modelDimensions[model];

      // Add OpenAI-compatible headers
      reply.headers({
        "x-request-id": `req_${Date.now()}`,
        "openai-processing-ms": "80",
        "openai-version": "2020-10-01",
      });

      // Handle both string and array inputs
      const inputs = Array.isArray(input) ? input : [input];

      const embeddings = inputs.map((text: string, index: number) => ({
        object: "embedding" as const,
        embedding: generateEmbedding(text, actualDimensions),
        index,
      }));

      // Calculate token usage
      const totalTokens = inputs.reduce(
        (sum: number, text: string) => sum + countTokens(text),
        0
      );

      return {
        object: "list" as const,
        data: embeddings,
        model,
        usage: {
          prompt_tokens: totalTokens,
          total_tokens: totalTokens,
        },
      };
    }
  );
};

export default embeddingsRoute;
