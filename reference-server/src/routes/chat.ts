import { FastifyPluginAsync } from "fastify";
import {
  validateAuth,
  createError,
  SimpleTextGenerator,
  generateId,
  countTokens,
} from "../util";
import { getChatModels, isValidModel } from "../config/models";

const chatRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/chat/completions
  fastify.post(
    "/v1/chat/completions",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            model: {
              type: "string",
              enum: getChatModels(),
              description: "ID of the model to use",
            },
            messages: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  role: {
                    type: "string",
                    enum: ["system", "user", "assistant"],
                    description: "The role of the messages author",
                  },
                  content: {
                    type: "string",
                    description: "The contents of the message",
                  },
                },
                required: ["role", "content"],
              },
              description:
                "A list of messages comprising the conversation so far",
            },
            stream: {
              type: "boolean",
              default: false,
              description: "If set, partial message deltas will be sent",
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
          required: ["model", "messages"],
          examples: [
            {
              model: "gpt-4o",
              messages: [
                {
                  role: "user",
                  content: "Hello! Can you help me write a creative story?",
                },
              ],
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
              choices: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "number" },
                    message: {
                      type: "object",
                      properties: {
                        role: { type: "string" },
                        content: { type: "string" },
                      },
                    },
                    finish_reason: { type: "string" },
                  },
                },
              },
              usage: {
                type: "object",
                properties: {
                  prompt_tokens: { type: "number" },
                  completion_tokens: { type: "number" },
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

      interface ChatMessage {
        role: "system" | "user" | "assistant";
        content: string;
      }

      interface ChatRequest {
        model: string;
        messages: ChatMessage[];
        stream?: boolean;
        max_tokens?: number;
        temperature?: number;
      }

      const body = request.body as ChatRequest;
      const {
        model,
        messages,
        stream = false,
        max_tokens = 150,
        temperature = 0.7,
      } = body;

      // Validate model using shared configuration
      if (!isValidModel(model, "chat")) {
        reply.code(400);
        return createError(
          `Model '${model}' not found`,
          "invalid_request_error",
          "model"
        );
      }

      // Create prompt from messages
      const prompt = messages
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join("\n");

      const requestId = generateId("chatcmpl");
      const created = Math.floor(Date.now() / 1000);

      // Add OpenAI-compatible headers
      reply.headers({
        "x-request-id": `req_${Date.now()}`,
        "openai-processing-ms": "150",
        "openai-version": "2020-10-01",
      });

      if (stream) {
        // Streaming response
        reply.type("text/event-stream");
        reply.headers({
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        const generator = SimpleTextGenerator.generateStream(
          prompt,
          max_tokens
        );

        // Send initial chunk with role
        const initialChunk = {
          id: requestId,
          object: "chat.completion.chunk" as const,
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null,
            },
          ],
        };
        reply.raw.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

        // Send content chunks
        for (const token of generator) {
          const chunk = {
            id: requestId,
            object: "chat.completion.chunk" as const,
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { content: token },
                finish_reason: null,
              },
            ],
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);

          // Add small delay to simulate streaming
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Send final chunk
        const finalChunk = {
          id: requestId,
          object: "chat.completion.chunk" as const,
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop" as const,
            },
          ],
        };
        reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        return;
      }

      // Non-streaming response
      const content = SimpleTextGenerator.generate(
        prompt,
        max_tokens,
        temperature
      );
      const promptTokens = countTokens(prompt);
      const completionTokens = countTokens(content);

      return {
        id: requestId,
        object: "chat.completion" as const,
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant" as const,
              content,
              name: undefined,
              function_call: undefined,
              tool_calls: undefined,
              tool_call_id: undefined,
            },
            finish_reason: "stop" as const,
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    }
  );
};

export default chatRoute;
