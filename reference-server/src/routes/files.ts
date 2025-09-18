import { FastifyPluginAsync } from "fastify";
import { validateAuth, createError, generateId } from "../util";
import * as fs from "fs/promises";
import * as path from "path";

const filesRoute: FastifyPluginAsync = async (fastify) => {
  const dataDir = path.join(process.cwd(), "data", "files");
  const indexFile = path.join(dataDir, "index.json");

  // Ensure data directory exists
  await fs.mkdir(dataDir, { recursive: true });

  // Load or initialize file index
  async function loadFileIndex(): Promise<any[]> {
    try {
      const data = await fs.readFile(indexFile, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  // Save file index
  async function saveFileIndex(files: any[]): Promise<void> {
    await fs.writeFile(indexFile, JSON.stringify(files, null, 2));
  }

  // POST /v1/files (upload)
  fastify.post(
    "/v1/files",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              object: { type: "string" },
              bytes: { type: "number" },
              created_at: { type: "number" },
              filename: { type: "string" },
              purpose: { type: "string" },
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

      try {
        const data = await request.file();
        if (!data) {
          reply.code(400);
          return createError("No file provided", "invalid_request_error");
        }

        const fileId = generateId("file");
        const filename = data.filename || "unnamed";
        const purpose = (data.fields as any)?.purpose?.value || "assistants";

        // Save file content
        const filePath = path.join(dataDir, fileId);
        const buffer = await data.toBuffer();
        await fs.writeFile(filePath, buffer);

        // Create file object
        const fileObject = {
          id: fileId,
          object: "file" as const,
          bytes: buffer.length,
          created_at: Math.floor(Date.now() / 1000),
          filename,
          purpose,
        };

        // Update index
        const files = await loadFileIndex();
        files.push(fileObject);
        await saveFileIndex(files);

        // Add OpenAI-compatible headers
        reply.headers({
          "x-request-id": `req_${Date.now()}`,
          "openai-processing-ms": "100",
          "openai-version": "2020-10-01",
        });

        return fileObject;
      } catch (error) {
        reply.code(500);
        return createError("File upload failed", "server_error");
      }
    }
  );

  // GET /v1/files (list)
  fastify.get(
    "/v1/files",
    {
      schema: {
        headers: {
          type: "object",
          properties: {
            authorization: { type: "string" },
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

      const files = await loadFileIndex();

      // Add OpenAI-compatible headers
      reply.headers({
        "x-request-id": `req_${Date.now()}`,
        "openai-processing-ms": "30",
        "openai-version": "2020-10-01",
      });

      return {
        object: "list" as const,
        data: files,
      };
    }
  );

  // GET /v1/files/:file_id (retrieve metadata)
  fastify.get(
    "/v1/files/:file_id",
    {
      schema: {
        headers: {
          type: "object",
          properties: {
            authorization: { type: "string" },
          },
        },
        params: {
          type: "object",
          properties: {
            file_id: { type: "string" },
          },
          required: ["file_id"],
        },
      },
    },
    async (request, reply) => {
      // Validate authorization
      if (!validateAuth(request.headers.authorization)) {
        reply.code(401);
        return createError("Invalid API key provided", "invalid_request_error");
      }

      const { file_id } = request.params as { file_id: string };
      const files = await loadFileIndex();
      const file = files.find((f) => f.id === file_id);

      if (!file) {
        reply.code(404);
        return createError("File not found", "invalid_request_error");
      }

      // Add OpenAI-compatible headers
      reply.headers({
        "x-request-id": `req_${Date.now()}`,
        "openai-processing-ms": "20",
        "openai-version": "2020-10-01",
      });

      return file;
    }
  );

  // GET /v1/files/:file_id/content (download)
  fastify.get(
    "/v1/files/:file_id/content",
    {
      schema: {
        headers: {
          type: "object",
          properties: {
            authorization: { type: "string" },
          },
        },
        params: {
          type: "object",
          properties: {
            file_id: { type: "string" },
          },
          required: ["file_id"],
        },
      },
    },
    async (request, reply) => {
      // Validate authorization
      if (!validateAuth(request.headers.authorization)) {
        reply.code(401);
        return createError("Invalid API key provided", "invalid_request_error");
      }

      const { file_id } = request.params as { file_id: string };
      const files = await loadFileIndex();
      const file = files.find((f) => f.id === file_id);

      if (!file) {
        reply.code(404);
        return createError("File not found", "invalid_request_error");
      }

      try {
        const filePath = path.join(dataDir, file_id);
        const fileContent = await fs.readFile(filePath);

        reply.headers({
          "content-disposition": `attachment; filename="${file.filename}"`,
          "content-type": "application/octet-stream",
          "x-request-id": `req_${Date.now()}`,
        });

        return fileContent;
      } catch (error) {
        reply.code(404);
        return createError("File content not found", "invalid_request_error");
      }
    }
  );

  // DELETE /v1/files/:file_id
  fastify.delete(
    "/v1/files/:file_id",
    {
      schema: {
        headers: {
          type: "object",
          properties: {
            authorization: { type: "string" },
          },
        },
        params: {
          type: "object",
          properties: {
            file_id: { type: "string" },
          },
          required: ["file_id"],
        },
      },
    },
    async (request, reply) => {
      // Validate authorization
      if (!validateAuth(request.headers.authorization)) {
        reply.code(401);
        return createError("Invalid API key provided", "invalid_request_error");
      }

      const { file_id } = request.params as { file_id: string };
      const files = await loadFileIndex();
      const fileIndex = files.findIndex((f) => f.id === file_id);

      if (fileIndex === -1) {
        reply.code(404);
        return createError("File not found", "invalid_request_error");
      }

      try {
        // Remove file content
        const filePath = path.join(dataDir, file_id);
        await fs.unlink(filePath);

        // Remove from index
        files.splice(fileIndex, 1);
        await saveFileIndex(files);

        // Add OpenAI-compatible headers
        reply.headers({
          "x-request-id": `req_${Date.now()}`,
          "openai-processing-ms": "50",
          "openai-version": "2020-10-01",
        });

        return {
          id: file_id,
          object: "file",
          deleted: true,
        };
      } catch (error) {
        reply.code(500);
        return createError("File deletion failed", "server_error");
      }
    }
  );
};

export default filesRoute;
