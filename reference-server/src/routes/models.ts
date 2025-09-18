import { FastifyPluginAsync } from "fastify";
import { validateAuth, createError } from "../util";

const modelsRoute: FastifyPluginAsync = async (fastify) => {
  // GET /v1/models
  fastify.get(
    "/v1/models",
    {
      schema: {
        security: [{ bearerAuth: [] }],
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
                    id: { type: "string" },
                    object: { type: "string" },
                    created: { type: "number" },
                    owned_by: { type: "string" },
                  },
                  required: ["id", "object", "created", "owned_by"],
                },
              },
            },
            required: ["object", "data"],
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
                required: ["message", "type"],
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

      // Return hardcoded list of models
      const models = [
        {
          id: "gpt-4o",
          object: "model" as const,
          created: 1677610602,
          owned_by: "ozwellai",
        },
        {
          id: "gpt-4o-mini",
          object: "model" as const,
          created: 1677610602,
          owned_by: "ozwellai",
        },
        {
          id: "text-embedding-3-small",
          object: "model" as const,
          created: 1677610602,
          owned_by: "ozwellai",
        },
        {
          id: "text-embedding-3-large",
          object: "model" as const,
          created: 1677610602,
          owned_by: "ozwellai",
        },
      ];

      // Add OpenAI-compatible headers
      reply.headers({
        "x-request-id": `req_${Date.now()}`,
        "openai-processing-ms": "50",
        "openai-version": "2020-10-01",
      });

      return {
        object: "list" as const,
        data: models,
      };
    }
  );
};

export default modelsRoute;
