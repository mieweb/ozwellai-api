import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError } from '../util';

const audioRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/audio/transcriptions
  fastify.post('/v1/audio/transcriptions', {
    schema: {
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

    const data = await request.file();
    if (!data) {
      reply.code(400);
      return createError('Missing required parameter: file', 'invalid_request_error', 'file');
    }

    // Consume the file stream
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }

    // Extract fields from multipart
    const fields = data.fields as Record<string, any>;
    const model = fields.model?.value as string | undefined;
    const responseFormat = (fields.response_format?.value as string) || 'json';
    const language = fields.language?.value as string | undefined;

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
    if (data.mimetype && !allowedMimeTypes.includes(data.mimetype)) {
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

    // Mock transcription response
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
      const timestampGranularities = fields.timestamp_granularities?.value;
      const granularities = timestampGranularities
        ? (Array.isArray(timestampGranularities) ? timestampGranularities : [timestampGranularities])
        : ['segment'];

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
