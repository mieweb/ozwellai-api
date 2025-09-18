import { FastifyPluginAsync } from "fastify";
import {
  validateAuth,
  createError,
  SimpleTextGenerator,
  generateId,
  countTokens,
} from "../util";

const responsesRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/responses
  fastify.post(
    "/v1/responses",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            model: {
              type: "string",
              enum: ["gpt-4o", "gpt-4o-mini"],
              description: "ID of the model to use for generating responses",
            },
            input: {
              type: "string",
              description: "The input text to generate a response for",
            },
            stream: {
              type: "boolean",
              default: false,
              description:
                "If set, partial response deltas will be sent as server-sent events",
            },
            max_tokens: {
              type: "number",
              minimum: 1,
              default: 150,
              description: "The maximum number of tokens to generate",
            },
            temperature: {
              type: "number",
              minimum: 0,
              maximum: 2,
              default: 0.7,
              description: "What sampling temperature to use, between 0 and 2",
            },
          },
          required: ["model", "input"],
          examples: [
            {
              model: "gpt-4o",
              input: "Write a short story about a robot learning to paint.",
              stream: false,
              max_tokens: 150,
              temperature: 0.7,
            },
          ],
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              object: { type: "string" },
              created: { type: "number" },
              model: { type: "string" },
              output: { type: "string" },
              usage: {
                type: "object",
                properties: {
                  input_tokens: { type: "number" },
                  output_tokens: { type: "number" },
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

      interface ResponseRequest {
        model: string;
        input: string;
        stream?: boolean;
        max_tokens?: number;
        temperature?: number;
      }

      const body = request.body as ResponseRequest;
      const {
        model,
        input,
        stream = false,
        max_tokens = 150,
        temperature = 0.7,
      } = body;

      // Validate model
      const supportedModels = ["gpt-4o", "gpt-4o-mini"];
      if (!supportedModels.includes(model)) {
        reply.code(400);
        return createError(
          `Model '${model}' not found`,
          "invalid_request_error",
          "model"
        );
      }

      const requestId = generateId("resp");
      const created = Math.floor(Date.now() / 1000);

      // Add OpenAI-compatible headers
      reply.headers({
        "x-request-id": `req_${Date.now()}`,
        "openai-processing-ms": "120",
        "openai-version": "2020-10-01",
      });

      if (stream) {
        // Streaming response with semantic events
        reply.type("text/event-stream");
        reply.headers({
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        // Send start event
        reply.raw.write(
          `event: start\ndata: ${JSON.stringify({
            id: requestId,
            model,
            created,
          })}\n\n`
        );

        // Send content events
        const generator = SimpleTextGenerator.generateStream(input, max_tokens);
        let fullOutput = "";

        for (const token of generator) {
          fullOutput += token;
          const contentEvent = {
            id: requestId,
            type: "content",
            content: token,
          };
          reply.raw.write(
            `event: content\ndata: ${JSON.stringify(contentEvent)}\n\n`
          );

          // Add small delay to simulate streaming
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Send completion event
        const inputTokens = countTokens(input);
        const outputTokens = countTokens(fullOutput);
        const completionEvent = {
          id: requestId,
          object: "response",
          created,
          model,
          output: fullOutput,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          },
        };
        reply.raw.write(
          `event: completion\ndata: ${JSON.stringify(completionEvent)}\n\n`
        );
        reply.raw.write(`event: done\ndata: [DONE]\n\n`);
        reply.raw.end();
        return;
      }

      // Non-streaming response
      const output = SimpleTextGenerator.generate(
        input,
        max_tokens,
        temperature
      );
      const inputTokens = countTokens(input);
      const outputTokens = countTokens(output);

      return {
        id: requestId,
        object: "response" as const,
        created,
        model,
        output,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      };
    }
  );
};

export default responsesRoute;
