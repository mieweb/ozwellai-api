import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, extractToken, isLLMBackendConfigured } from '../util';
import { agentStore } from '../storage/agents';

const LLM_BASE_URL = process.env.LLM_BASE_URL || '';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_PROVIDER = process.env.LLM_PROVIDER || '';

const audioRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/audio/transcriptions
  fastify.post('/v1/audio/transcriptions', {
    schema: {
      summary: 'Transcribe audio to text',
      description: 'Transcribes audio into text using the specified model. Accepts multipart/form-data with fields: file (required, audio binary), model (required, e.g. "whisper-1"), response_format (json|text|srt|verbose_json|vtt), language (ISO-639-1), temperature (0-1), timestamp_granularities (word|segment).',
      tags: ['Audio'],
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string' },
        },
      },
      consumes: ['multipart/form-data'],
    },
  }, async (request, reply) => {
    // Validate authorization
    if (!validateAuth(request.headers.authorization)) {
      reply.code(401);
      return createError('Invalid API key provided', 'invalid_request_error');
    }

    // Validate token exists in database
    const token = extractToken(request.headers.authorization);
    if (!agentStore.validateKey(token)) {
      reply.code(401);
      return createError('API key not found. Verify the key exists in the database.', 'invalid_request_error');
    }

    // Parse all multipart parts in order-independent fashion
    const fields: Record<string, any> = {};
    const chunks: Buffer[] = [];
    let fileMimetype = '';
    let filename = '';
    let hasFile = false;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (!hasFile) {
          hasFile = true;
          fileMimetype = part.mimetype;
          filename = part.filename;
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
        } else {
          // Drain extra file streams
          part.file.resume();
        }
      } else {
        fields[part.fieldname] = { value: part.value };
      }
    }

    if (!hasFile) {
      reply.code(400);
      return createError('Missing required parameter: file', 'invalid_request_error', 'file');
    }
    const model = fields.model?.value as string | undefined;
    const responseFormat = (fields.response_format?.value as string) || 'json';
    const language = fields.language?.value as string | undefined;
    const temperature = fields.temperature?.value as string | undefined;
    const rawGranularities = fields.timestamp_granularities?.value;
    const granularities: string[] = rawGranularities
      ? (Array.isArray(rawGranularities) ? rawGranularities : [rawGranularities])
      : ['segment'];

    if (!model) {
      reply.code(400);
      return createError('Missing required parameter: model', 'invalid_request_error', 'model');
    }

    // Validate model
    const supportedModels = ['whisper-1'];
    if (!supportedModels.includes(model)) {
      reply.code(400);
      return createError(`Model '${model}' not found`, 'invalid_request_error', 'model');
    }

    // Validate file type
    const allowedMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/mpga',
      'audio/m4a', 'audio/wav', 'audio/webm', 'audio/x-m4a',
      'audio/x-wav', 'video/mp4', 'video/webm',
    ];
    if (fileMimetype && !allowedMimeTypes.includes(fileMimetype)) {
      reply.code(400);
      return createError(
        `Invalid file format. Supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm`,
        'invalid_request_error',
        'file',
      );
    }

    // Add OpenAI-compatible headers
    reply.headers({
      'x-request-id': `req_${Date.now()}`,
      'openai-processing-ms': '500',
      'openai-version': '2020-10-01',
    });

    // Forward to real backend if configured, otherwise return mock
    if (isLLMBackendConfigured()) {
      const upstreamForm = new FormData();
      upstreamForm.append('file', new Blob([Buffer.concat(chunks)], { type: fileMimetype }), filename);
      upstreamForm.append('model', model);
      if (responseFormat) upstreamForm.append('response_format', responseFormat);
      if (language) upstreamForm.append('language', language);
      if (temperature) upstreamForm.append('temperature', temperature);

      if (rawGranularities) {
        for (const g of granularities) {
          upstreamForm.append('timestamp_granularities[]', g);
        }
      }

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${LLM_API_KEY}`,
      };
      if (LLM_PROVIDER) headers['x-portkey-provider'] = LLM_PROVIDER;

      const upstreamResp = await fetch(`${LLM_BASE_URL}/v1/audio/transcriptions`, {
        method: 'POST',
        headers,
        body: upstreamForm,
      });

      if (!upstreamResp.ok) {
        const errBody = await upstreamResp.text();
        reply.code(upstreamResp.status);
        try {
          return JSON.parse(errBody);
        } catch {
          return createError(errBody, 'upstream_error');
        }
      }

      // For text-based formats, return as plain text
      if (['text', 'srt', 'vtt'].includes(responseFormat)) {
        reply.type('text/plain');
        return upstreamResp.text();
      }

      return upstreamResp.json();
    }

    // ── Mock fallback (no LLM backend configured) ──
    const mockText = 'This is a mock transcription from the reference server.';

    if (responseFormat === 'text') {
      reply.type('text/plain');
      return mockText;
    }

    if (responseFormat === 'srt') {
      reply.type('text/plain');
      return '1\n00:00:00,000 --> 00:00:03,000\nThis is a mock transcription from the reference server.\n';
    }

    if (responseFormat === 'vtt') {
      reply.type('text/plain');
      return 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nThis is a mock transcription from the reference server.\n';
    }

    const response: any = {
      task: 'transcribe',
      language: language || 'english',
      duration: 3.0,
      text: mockText,
    };

    if (responseFormat === 'verbose_json') {
      if (granularities.includes('word')) {
        response.words = [
          { word: 'This', start: 0.0, end: 0.2 },
          { word: 'is', start: 0.2, end: 0.3 },
          { word: 'a', start: 0.3, end: 0.4 },
          { word: 'mock', start: 0.4, end: 0.6 },
          { word: 'transcription', start: 0.6, end: 1.2 },
        ];
      }

      if (granularities.includes('segment')) {
        response.segments = [
          {
            id: 0,
            seek: 0,
            start: 0.0,
            end: 3.0,
            text: mockText,
            tokens: [50364, 639, 307, 257, 13473, 38752, 13],
            temperature: 0.0,
            avg_logprob: -0.25,
            compression_ratio: 1.0,
            no_speech_prob: 0.01,
          },
        ];
      }
    }

    // For plain 'json' format, return just the text
    if (responseFormat === 'json') {
      return { text: mockText };
    }

    return response;
  });
};

export default audioRoute;
