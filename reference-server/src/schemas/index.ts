import { z } from 'zod';

// Common schemas
export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function', 'tool']),
  content: z.string().nullable(),
  name: z.string().optional(),
  function_call: z.object({
    name: z.string(),
    arguments: z.string(),
  }).optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string(),
    }),
  })).optional(),
  tool_call_id: z.string().optional(),
});

export const ModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  owned_by: z.string(),
});

export const ErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    param: z.string().nullable(),
    code: z.string().nullable(),
  }),
});

// Chat completions schemas
export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().min(1).max(128).optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  max_tokens: z.number().min(1).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  logit_bias: z.record(z.string(), z.number()).optional(),
  user: z.string().optional(),
});

export const ChatCompletionChoiceSchema = z.object({
  index: z.number(),
  message: MessageSchema,
  finish_reason: z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable(),
});

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number(),
  model: z.string(),
  choices: z.array(ChatCompletionChoiceSchema),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

// Responses endpoint schemas (new primitive)
export const ResponseRequestSchema = z.object({
  model: z.string(),
  input: z.string(),
  stream: z.boolean().optional(),
  max_tokens: z.number().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const ResponseSchema = z.object({
  id: z.string(),
  object: z.literal('response'),
  created: z.number(),
  model: z.string(),
  output: z.string(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

// Embeddings schemas
export const EmbeddingRequestSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.string())]),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().optional(),
  user: z.string().optional(),
});

export const EmbeddingSchema = z.object({
  object: z.literal('embedding'),
  embedding: z.array(z.number()),
  index: z.number(),
});

export const EmbeddingResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(EmbeddingSchema),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

// Files schemas
export const FileObjectSchema = z.object({
  id: z.string(),
  object: z.literal('file'),
  bytes: z.number(),
  created_at: z.number(),
  filename: z.string(),
  purpose: z.string(),
});

export const FileListResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(FileObjectSchema),
});

// Models list schema
export const ModelsListResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(ModelSchema),
});

// Streaming schemas
export const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion.chunk'),
  created: z.number(),
  model: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    delta: z.object({
      role: z.string().optional(),
      content: z.string().optional(),
      function_call: z.object({
        name: z.string().optional(),
        arguments: z.string().optional(),
      }).optional(),
      tool_calls: z.array(z.object({
        index: z.number(),
        id: z.string().optional(),
        type: z.literal('function').optional(),
        function: z.object({
          name: z.string().optional(),
          arguments: z.string().optional(),
        }).optional(),
      })).optional(),
    }),
    finish_reason: z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable(),
  })),
});

export type Message = z.infer<typeof MessageSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;
export type ResponseRequest = z.infer<typeof ResponseRequestSchema>;
export type Response = z.infer<typeof ResponseSchema>;
export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;
export type FileObject = z.infer<typeof FileObjectSchema>;
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;