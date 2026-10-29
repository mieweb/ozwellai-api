"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyIdentityUnauthorizedResponseSchema = exports.DesktopUnauthorizedResponseSchema = exports.AuthenticationBadRequestSchema = exports.HttpValidationErrorSchema = exports.DesktopProofErrorSchema = exports.DesktopOAuthErrorSchema = exports.DesktopRequestChallengeResponseSchema = exports.DesktopRequestChallengeRequestSchema = exports.DesktopAttestationVerifyRequestSchema = exports.DesktopAttestationChallengeResponseSchema = exports.DesktopAttestationChallengeRequestSchema = exports.DesktopTokenResponseSchema = exports.DesktopAttestationRequiredResponseSchema = exports.DesktopSessionResponseSchema = exports.DesktopTokenRequestSchema = exports.DesktopCompleteResponseSchema = exports.DesktopCompleteRequestSchema = exports.DesktopAuthorizePageSchema = exports.DesktopAuthorizeQuerySchema = exports.ApiKeyIdentityErrorSchema = exports.ApiKeyIdentityResponseSchema = exports.ApiKeyIdentityRequestSchema = exports.AccountIdentitySchema = exports.AudioTranscriptionResponseSchema = exports.TranscriptionSegmentSchema = exports.TranscriptionWordSchema = exports.AudioTranscriptionRequestSchema = exports.ChatCompletionChunkSchema = exports.ModelsListResponseSchema = exports.FileListResponseSchema = exports.FileObjectSchema = exports.EmbeddingResponseSchema = exports.EmbeddingSchema = exports.EmbeddingRequestSchema = exports.ResponseSchema = exports.ResponseRequestSchema = exports.ChatCompletionResponseSchema = exports.ChatCompletionChoiceSchema = exports.ChatCompletionRequestSchema = exports.ResponseFormatSchema = exports.ErrorSchema = exports.ModelSchema = exports.MessageSchema = exports.MessageContentSchema = exports.ContentPartSchema = exports.FileContentPartSchema = exports.ImageContentPartSchema = exports.TextContentPartSchema = void 0;
const zod_1 = require("zod");
// Multimodal content parts (OpenAI-compatible).
// A message's `content` may be a plain string, or an array of typed parts
// to support vision (image) inputs alongside text.
exports.TextContentPartSchema = zod_1.z.object({
    type: zod_1.z.literal('text'),
    text: zod_1.z.string(),
});
exports.ImageContentPartSchema = zod_1.z.object({
    type: zod_1.z.literal('image_url'),
    image_url: zod_1.z.object({
        url: zod_1.z.string(),
        detail: zod_1.z.enum(['auto', 'low', 'high']).optional(),
    }),
});
exports.FileContentPartSchema = zod_1.z.object({
    type: zod_1.z.literal('file'),
    file: zod_1.z.object({
        file_data: zod_1.z.string(),
        filename: zod_1.z.string().optional(),
    }),
});
exports.ContentPartSchema = zod_1.z.union([exports.TextContentPartSchema, exports.ImageContentPartSchema, exports.FileContentPartSchema]);
// Message content: a string, or an array of content parts (text + images + files).
exports.MessageContentSchema = zod_1.z.union([zod_1.z.string(), zod_1.z.array(exports.ContentPartSchema)]);
// Common schemas
exports.MessageSchema = zod_1.z.object({
    role: zod_1.z.enum(['system', 'user', 'assistant', 'function', 'tool']),
    content: exports.MessageContentSchema.nullable(),
    name: zod_1.z.string().optional(),
    function_call: zod_1.z.object({
        name: zod_1.z.string(),
        arguments: zod_1.z.string(),
    }).optional(),
    tool_calls: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        type: zod_1.z.literal('function'),
        function: zod_1.z.object({
            name: zod_1.z.string(),
            arguments: zod_1.z.string(),
        }),
    })).optional(),
    tool_call_id: zod_1.z.string().optional(),
});
exports.ModelSchema = zod_1.z.object({
    id: zod_1.z.string(),
    object: zod_1.z.literal('model'),
    created: zod_1.z.number(),
    owned_by: zod_1.z.string(),
});
exports.ErrorSchema = zod_1.z.object({
    error: zod_1.z.object({
        message: zod_1.z.string(),
        type: zod_1.z.string(),
        param: zod_1.z.string().nullable(),
        code: zod_1.z.string().nullable(),
    }),
});
// Response format for chat completions (OpenAI-compatible).
// `json_schema` lets callers request structured output validated against a
// JSON Schema — used by ozwell-workspace to replace OpenAI's zodTextFormat().
exports.ResponseFormatSchema = zod_1.z.union([
    zod_1.z.object({ type: zod_1.z.literal('text') }),
    zod_1.z.object({ type: zod_1.z.literal('json_object') }),
    zod_1.z.object({
        type: zod_1.z.literal('json_schema'),
        json_schema: zod_1.z.object({
            name: zod_1.z.string(),
            strict: zod_1.z.boolean().optional(),
            schema: zod_1.z.record(zod_1.z.unknown()),
        }),
    }),
]);
// Chat completions schemas
exports.ChatCompletionRequestSchema = zod_1.z.object({
    model: zod_1.z.string(),
    messages: zod_1.z.array(exports.MessageSchema),
    temperature: zod_1.z.number().min(0).max(2).optional(),
    top_p: zod_1.z.number().min(0).max(1).optional(),
    n: zod_1.z.number().min(1).max(128).optional(),
    stream: zod_1.z.boolean().optional(),
    stop: zod_1.z.union([zod_1.z.string(), zod_1.z.array(zod_1.z.string())]).optional(),
    max_tokens: zod_1.z.number().min(1).optional(),
    presence_penalty: zod_1.z.number().min(-2).max(2).optional(),
    frequency_penalty: zod_1.z.number().min(-2).max(2).optional(),
    logit_bias: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional(),
    response_format: exports.ResponseFormatSchema.optional(),
    user: zod_1.z.string().optional(),
});
exports.ChatCompletionChoiceSchema = zod_1.z.object({
    index: zod_1.z.number(),
    message: exports.MessageSchema,
    finish_reason: zod_1.z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable(),
});
exports.ChatCompletionResponseSchema = zod_1.z.object({
    id: zod_1.z.string(),
    object: zod_1.z.literal('chat.completion'),
    created: zod_1.z.number(),
    model: zod_1.z.string(),
    choices: zod_1.z.array(exports.ChatCompletionChoiceSchema),
    usage: zod_1.z.object({
        prompt_tokens: zod_1.z.number(),
        completion_tokens: zod_1.z.number(),
        total_tokens: zod_1.z.number(),
    }),
});
// Responses endpoint schemas (new primitive)
exports.ResponseRequestSchema = zod_1.z.object({
    model: zod_1.z.string(),
    input: zod_1.z.string(),
    stream: zod_1.z.boolean().optional(),
    max_tokens: zod_1.z.number().min(1).optional(),
    temperature: zod_1.z.number().min(0).max(2).optional(),
});
exports.ResponseSchema = zod_1.z.object({
    id: zod_1.z.string(),
    object: zod_1.z.literal('response'),
    created: zod_1.z.number(),
    model: zod_1.z.string(),
    output: zod_1.z.string(),
    usage: zod_1.z.object({
        input_tokens: zod_1.z.number(),
        output_tokens: zod_1.z.number(),
        total_tokens: zod_1.z.number(),
    }),
});
// Embeddings schemas
exports.EmbeddingRequestSchema = zod_1.z.object({
    model: zod_1.z.string(),
    input: zod_1.z.union([zod_1.z.string(), zod_1.z.array(zod_1.z.string())]),
    encoding_format: zod_1.z.enum(['float', 'base64']).optional(),
    dimensions: zod_1.z.number().optional(),
    user: zod_1.z.string().optional(),
});
exports.EmbeddingSchema = zod_1.z.object({
    object: zod_1.z.literal('embedding'),
    embedding: zod_1.z.array(zod_1.z.number()),
    index: zod_1.z.number(),
});
exports.EmbeddingResponseSchema = zod_1.z.object({
    object: zod_1.z.literal('list'),
    data: zod_1.z.array(exports.EmbeddingSchema),
    model: zod_1.z.string(),
    usage: zod_1.z.object({
        prompt_tokens: zod_1.z.number(),
        total_tokens: zod_1.z.number(),
    }),
});
// Files schemas
exports.FileObjectSchema = zod_1.z.object({
    id: zod_1.z.string(),
    object: zod_1.z.literal('file'),
    bytes: zod_1.z.number(),
    created_at: zod_1.z.number(),
    filename: zod_1.z.string(),
    purpose: zod_1.z.string(),
});
exports.FileListResponseSchema = zod_1.z.object({
    object: zod_1.z.literal('list'),
    data: zod_1.z.array(exports.FileObjectSchema),
});
// Models list schema
exports.ModelsListResponseSchema = zod_1.z.object({
    object: zod_1.z.literal('list'),
    data: zod_1.z.array(exports.ModelSchema),
});
// Streaming schemas
exports.ChatCompletionChunkSchema = zod_1.z.object({
    id: zod_1.z.string(),
    object: zod_1.z.literal('chat.completion.chunk'),
    created: zod_1.z.number(),
    model: zod_1.z.string(),
    choices: zod_1.z.array(zod_1.z.object({
        index: zod_1.z.number(),
        delta: zod_1.z.object({
            role: zod_1.z.string().optional(),
            content: zod_1.z.string().optional(),
            function_call: zod_1.z.object({
                name: zod_1.z.string().optional(),
                arguments: zod_1.z.string().optional(),
            }).optional(),
            tool_calls: zod_1.z.array(zod_1.z.object({
                index: zod_1.z.number(),
                id: zod_1.z.string().optional(),
                type: zod_1.z.literal('function').optional(),
                function: zod_1.z.object({
                    name: zod_1.z.string().optional(),
                    arguments: zod_1.z.string().optional(),
                }).optional(),
            })).optional(),
        }),
        finish_reason: zod_1.z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable(),
    })),
});
// Audio transcription schemas
exports.AudioTranscriptionRequestSchema = zod_1.z.object({
    file: zod_1.z.any().describe('Audio file (mp3, mp4, mpeg, mpga, m4a, wav, webm)'),
    model: zod_1.z.string(),
    response_format: zod_1.z.enum(['json', 'text', 'srt', 'verbose_json', 'vtt']).optional(),
    language: zod_1.z.string().optional(),
    temperature: zod_1.z.number().min(0).max(1).optional(),
    timestamp_granularities: zod_1.z.array(zod_1.z.enum(['word', 'segment'])).optional(),
});
exports.TranscriptionWordSchema = zod_1.z.object({
    word: zod_1.z.string(),
    start: zod_1.z.number(),
    end: zod_1.z.number(),
});
exports.TranscriptionSegmentSchema = zod_1.z.object({
    id: zod_1.z.number(),
    seek: zod_1.z.number().optional(),
    start: zod_1.z.number(),
    end: zod_1.z.number(),
    text: zod_1.z.string(),
    tokens: zod_1.z.array(zod_1.z.number()).optional(),
    temperature: zod_1.z.number().optional(),
    avg_logprob: zod_1.z.number().optional(),
    compression_ratio: zod_1.z.number().optional(),
    no_speech_prob: zod_1.z.number().optional(),
});
exports.AudioTranscriptionResponseSchema = zod_1.z.object({
    task: zod_1.z.literal('transcribe'),
    language: zod_1.z.string(),
    duration: zod_1.z.number(),
    text: zod_1.z.string(),
    words: zod_1.z.array(exports.TranscriptionWordSchema).optional(),
    segments: zod_1.z.array(exports.TranscriptionSegmentSchema).optional(),
});
// Ozwell authentication extensions. These describe the wire contract; account,
// registration, callback and cryptographic checks remain server-side decisions.
exports.AccountIdentitySchema = zod_1.z.object({ email: zod_1.z.string(), user_id: zod_1.z.string() });
exports.ApiKeyIdentityRequestSchema = zod_1.z.object({ email: zod_1.z.string().max(254) })
    .describe('POST /auth/api-key/identity: verify the supplied email using the original bearer API or agent key.');
exports.ApiKeyIdentityResponseSchema = exports.AccountIdentitySchema
    .describe('The existing key owner; no new credential or additional authority is issued.');
exports.ApiKeyIdentityErrorSchema = zod_1.z.object({ error: zod_1.z.object({
        message: zod_1.z.string(), type: zod_1.z.literal('authentication_error'),
        param: zod_1.z.null(), code: zod_1.z.literal('invalid_key_identity'),
    }) });
exports.DesktopAuthorizeQuerySchema = zod_1.z.object({
    response_type: zod_1.z.literal('code'), client_id: zod_1.z.string().max(100),
    redirect_uri: zod_1.z.string().max(2048), state: zod_1.z.string().min(32).max(256),
    code_challenge: zod_1.z.string().length(43), code_challenge_method: zod_1.z.literal('S256'),
}).describe('GET /auth/desktop/authorize: registered public client with S256 PKCE and browser-bound state.');
exports.DesktopAuthorizePageSchema = zod_1.z.string().describe('Hosted sign-in HTML; the flow cookie is HttpOnly and the page has a restrictive CSP.');
exports.DesktopCompleteRequestSchema = zod_1.z.object({ flow_id: zod_1.z.string().max(100) })
    .describe('POST /auth/desktop/complete: same-origin browser session and authorize-flow cookie required.');
exports.DesktopCompleteResponseSchema = zod_1.z.object({ redirect_uri: zod_1.z.string() });
exports.DesktopTokenRequestSchema = zod_1.z.object({
    // Unsupported grants intentionally reach the handler's invalid_grant response.
    grant_type: zod_1.z.string(), client_id: zod_1.z.string().max(100), redirect_uri: zod_1.z.string().max(2048),
    code: zod_1.z.string().max(100), code_verifier: zod_1.z.string().max(128),
}).describe('POST /auth/desktop/token: exchange a one-use authorization code and its PKCE verifier.');
exports.DesktopSessionResponseSchema = zod_1.z.object({ session_token: zod_1.z.string(), email: zod_1.z.string() });
exports.DesktopAttestationRequiredResponseSchema = zod_1.z.object({
    attestation_required: zod_1.z.literal(true), login_id: zod_1.z.string(), account: exports.AccountIdentitySchema,
});
exports.DesktopTokenResponseSchema = zod_1.z.union([exports.DesktopSessionResponseSchema, exports.DesktopAttestationRequiredResponseSchema]);
exports.DesktopAttestationChallengeRequestSchema = zod_1.z.object({ login_id: zod_1.z.string().max(100), key_id: zod_1.z.string().max(100) })
    .describe('POST /auth/desktop/attestation/challenge: request enrollment or a sign-in assertion challenge.');
exports.DesktopAttestationChallengeResponseSchema = zod_1.z.object({ challenge: zod_1.z.string(), proof_kind: zod_1.z.enum(['attestation', 'assertion']) });
exports.DesktopAttestationVerifyRequestSchema = zod_1.z.object({
    login_id: zod_1.z.string().max(100), key_id: zod_1.z.string().max(100), proof: zod_1.z.string().max(180000),
}).describe('POST /auth/desktop/attestation/verify: verify Apple application proof and issue a bound session.');
exports.DesktopRequestChallengeRequestSchema = zod_1.z.object({
    method: zod_1.z.enum(['GET', 'POST']), path: zod_1.z.string().max(2048), body_hash: zod_1.z.string().regex(/^[a-f0-9]{64}$/),
}).describe('POST /auth/desktop/challenge: one-use challenge bound to the exact method, request path and SHA-256 body hash.');
exports.DesktopRequestChallengeResponseSchema = zod_1.z.object({ challenge_id: zod_1.z.string(), challenge: zod_1.z.string() });
exports.DesktopOAuthErrorSchema = zod_1.z.object({
    error: zod_1.z.enum(['invalid_request', 'invalid_grant', 'invalid_token', 'temporarily_unavailable']),
    error_description: zod_1.z.string(),
});
exports.DesktopProofErrorSchema = zod_1.z.object({ error: zod_1.z.object({
        message: zod_1.z.string(), type: zod_1.z.literal('authentication_error'), code: zod_1.z.literal('invalid_desktop_proof'),
    }) }).describe('The shared authorization hook rejects a missing, invalid or replayed bound-session proof.');
// Retain Fastify's existing validation envelope, and support hosts that install
// a shared OpenAI-style error handler before registering these routes.
exports.HttpValidationErrorSchema = zod_1.z.object({
    statusCode: zod_1.z.number(), code: zod_1.z.string().optional(), error: zod_1.z.string(), message: zod_1.z.string(),
});
exports.AuthenticationBadRequestSchema = zod_1.z.union([exports.DesktopOAuthErrorSchema, exports.ErrorSchema, exports.HttpValidationErrorSchema]);
exports.DesktopUnauthorizedResponseSchema = zod_1.z.union([exports.DesktopOAuthErrorSchema, exports.DesktopProofErrorSchema]);
exports.ApiKeyIdentityUnauthorizedResponseSchema = zod_1.z.union([exports.ApiKeyIdentityErrorSchema, exports.DesktopProofErrorSchema]);
//# sourceMappingURL=index.js.map