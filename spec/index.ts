import { z } from 'zod';

// Multimodal content parts (OpenAI-compatible).
// A message's `content` may be a plain string, or an array of typed parts
// to support vision (image) inputs alongside text.
export const TextContentPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const ImageContentPartSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
});

export const FileContentPartSchema = z.object({
  type: z.literal('file'),
  file: z.object({
    file_data: z.string(),
    filename: z.string().optional(),
  }),
});

export const ContentPartSchema = z.union([TextContentPartSchema, ImageContentPartSchema, FileContentPartSchema]);

// Message content: a string, or an array of content parts (text + images + files).
export const MessageContentSchema = z.union([z.string(), z.array(ContentPartSchema)]);

// Common schemas
export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function', 'tool']),
  content: MessageContentSchema.nullable(),
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

// Response format for chat completions (OpenAI-compatible).
// `json_schema` lets callers request structured output validated against a
// JSON Schema — used by ozwell-workspace to replace OpenAI's zodTextFormat().
export const ResponseFormatSchema = z.union([
  z.object({ type: z.literal('text') }),
  z.object({ type: z.literal('json_object') }),
  z.object({
    type: z.literal('json_schema'),
    json_schema: z.object({
      name: z.string(),
      strict: z.boolean().optional(),
      schema: z.record(z.unknown()),
    }),
  }),
]);

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
  response_format: ResponseFormatSchema.optional(),
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

export type TextContentPart = z.infer<typeof TextContentPartSchema>;
export type ImageContentPart = z.infer<typeof ImageContentPartSchema>;
export type FileContentPart = z.infer<typeof FileContentPartSchema>;
export type ContentPart = z.infer<typeof ContentPartSchema>;
export type MessageContent = z.infer<typeof MessageContentSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

export type ResponseRequest = z.infer<typeof ResponseRequestSchema>;
export type Response = z.infer<typeof ResponseSchema>;
export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;
export type FileObject = z.infer<typeof FileObjectSchema>;
export type FileListResponse = z.infer<typeof FileListResponseSchema>;
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;

// Audio transcription schemas
export const AudioTranscriptionRequestSchema = z.object({
  file: z.any().describe('Audio file (mp3, mp4, mpeg, mpga, m4a, wav, webm)'),
  model: z.string(),
  response_format: z.enum(['json', 'text', 'srt', 'verbose_json', 'vtt']).optional(),
  language: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  timestamp_granularities: z.array(z.enum(['word', 'segment'])).optional(),
});

export const TranscriptionWordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

export const TranscriptionSegmentSchema = z.object({
  id: z.number(),
  seek: z.number().optional(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  tokens: z.array(z.number()).optional(),
  temperature: z.number().optional(),
  avg_logprob: z.number().optional(),
  compression_ratio: z.number().optional(),
  no_speech_prob: z.number().optional(),
});

export const AudioTranscriptionResponseSchema = z.object({
  task: z.literal('transcribe'),
  language: z.string(),
  duration: z.number(),
  text: z.string(),
  words: z.array(TranscriptionWordSchema).optional(),
  segments: z.array(TranscriptionSegmentSchema).optional(),
});

export type AudioTranscriptionRequest = z.infer<typeof AudioTranscriptionRequestSchema>;
export type AudioTranscriptionResponse = z.infer<typeof AudioTranscriptionResponseSchema>;

// Ozwell authentication extensions. These describe the wire contract; account,
// registration, callback and cryptographic checks remain server-side decisions.
export const AccountIdentitySchema = z.object({ email: z.string(), user_id: z.string() });
export const ApiKeyIdentityRequestSchema = z.object({ email: z.string().max(254) })
  .describe('POST /auth/api-key/identity: verify the supplied email using the original bearer API or agent key.');
export const ApiKeyIdentityResponseSchema = AccountIdentitySchema
  .describe('The existing key owner; no new credential or additional authority is issued.');
export const ApiKeyIdentityErrorSchema = z.object({ error: z.object({
  message: z.string(), type: z.literal('authentication_error'),
  param: z.null(), code: z.literal('invalid_key_identity'),
}) });

export const DesktopAuthorizeQuerySchema = z.object({
  response_type: z.literal('code'), client_id: z.string().max(100),
  redirect_uri: z.string().max(2048), state: z.string().min(32).max(256),
  code_challenge: z.string().length(43), code_challenge_method: z.literal('S256'),
}).describe('GET /auth/desktop/authorize: registered public client with S256 PKCE and browser-bound state.');
export const DesktopAuthorizePageSchema = z.string().describe('Hosted sign-in HTML; the flow cookie is HttpOnly and the page has a restrictive CSP.');
export const DesktopCompleteRequestSchema = z.object({ flow_id: z.string().max(100) })
  .describe('POST /auth/desktop/complete: same-origin browser session and authorize-flow cookie required.');
export const DesktopCompleteResponseSchema = z.object({ redirect_uri: z.string() });
export const DesktopTokenRequestSchema = z.object({
  // Unsupported grants intentionally reach the handler's invalid_grant response.
  grant_type: z.string(), client_id: z.string().max(100), redirect_uri: z.string().max(2048),
  code: z.string().max(100), code_verifier: z.string().max(128),
}).describe('POST /auth/desktop/token: exchange a one-use authorization code and its PKCE verifier.');
export const DesktopSessionResponseSchema = z.object({ session_token: z.string(), email: z.string() });
export const DesktopAttestationRequiredResponseSchema = z.object({
  attestation_required: z.literal(true), login_id: z.string(), account: AccountIdentitySchema,
});
export const DesktopTokenResponseSchema = z.union([DesktopSessionResponseSchema, DesktopAttestationRequiredResponseSchema]);
export const DesktopAttestationChallengeRequestSchema = z.object({ login_id: z.string().max(100), key_id: z.string().max(100) })
  .describe('POST /auth/desktop/attestation/challenge: request enrollment or a sign-in assertion challenge.');
export const DesktopAttestationChallengeResponseSchema = z.object({ challenge: z.string(), proof_kind: z.enum(['attestation', 'assertion']) });
export const DesktopAttestationVerifyRequestSchema = z.object({
  login_id: z.string().max(100), key_id: z.string().max(100), proof: z.string().max(180_000),
}).describe('POST /auth/desktop/attestation/verify: verify Apple application proof and issue a bound session.');
export const DesktopRequestChallengeRequestSchema = z.object({
  method: z.enum(['GET', 'POST']), path: z.string().max(2048), body_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).describe('POST /auth/desktop/challenge: one-use challenge bound to the exact method, request path and SHA-256 body hash.');
export const DesktopRequestChallengeResponseSchema = z.object({ challenge_id: z.string(), challenge: z.string() });
export const DesktopOAuthErrorSchema = z.object({
  error: z.enum(['invalid_request', 'invalid_grant', 'invalid_token', 'temporarily_unavailable']),
  error_description: z.string(),
});
export const DesktopProofErrorSchema = z.object({ error: z.object({
  message: z.string(), type: z.literal('authentication_error'), code: z.literal('invalid_desktop_proof'),
}) }).describe('The shared authorization hook rejects a missing, invalid or replayed bound-session proof.');
// Retain Fastify's existing validation envelope, and support hosts that install
// a shared OpenAI-style error handler before registering these routes.
export const HttpValidationErrorSchema = z.object({
  statusCode: z.number(), code: z.string().optional(), error: z.string(), message: z.string(),
});
export const AuthenticationBadRequestSchema = z.union([DesktopOAuthErrorSchema, ErrorSchema, HttpValidationErrorSchema]);
export const DesktopUnauthorizedResponseSchema = z.union([DesktopOAuthErrorSchema, DesktopProofErrorSchema]);
export const ApiKeyIdentityUnauthorizedResponseSchema = z.union([ApiKeyIdentityErrorSchema, DesktopProofErrorSchema]);

export type AccountIdentity = z.infer<typeof AccountIdentitySchema>;
export type ApiKeyIdentityRequest = z.infer<typeof ApiKeyIdentityRequestSchema>;
export type ApiKeyIdentityResponse = z.infer<typeof ApiKeyIdentityResponseSchema>;
export type DesktopAuthorizeQuery = z.infer<typeof DesktopAuthorizeQuerySchema>;
export type DesktopCompleteRequest = z.infer<typeof DesktopCompleteRequestSchema>;
export type DesktopCompleteResponse = z.infer<typeof DesktopCompleteResponseSchema>;
export type DesktopTokenRequest = z.infer<typeof DesktopTokenRequestSchema>;
export type DesktopTokenResponse = z.infer<typeof DesktopTokenResponseSchema>;
export type DesktopSessionResponse = z.infer<typeof DesktopSessionResponseSchema>;
export type DesktopAttestationChallengeRequest = z.infer<typeof DesktopAttestationChallengeRequestSchema>;
export type DesktopAttestationChallengeResponse = z.infer<typeof DesktopAttestationChallengeResponseSchema>;
export type DesktopAttestationVerifyRequest = z.infer<typeof DesktopAttestationVerifyRequestSchema>;
export type DesktopRequestChallengeRequest = z.infer<typeof DesktopRequestChallengeRequestSchema>;
export type DesktopRequestChallengeResponse = z.infer<typeof DesktopRequestChallengeResponseSchema>;
export type DesktopOAuthError = z.infer<typeof DesktopOAuthErrorSchema>;
