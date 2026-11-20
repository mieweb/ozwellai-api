import { FastifyInstance } from 'fastify';

const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 20;
const MAX_TRACKED_CLIENTS = 10_000;

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);

/** Records widget crashes so browser-only failures are visible in server logs. Never accepts conversation content. */
export default async function clientErrorsRoute(fastify: FastifyInstance) {
  const recent = new Map<string, { windowStart: number; count: number }>();

  fastify.post<{ Body: Record<string, unknown> }>('/v1/widget/errors', {
    bodyLimit: 16 * 1024,
    logLevel: 'warn',
    schema: {
      hide: true,
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', maxLength: 40 },
          message: { type: 'string', maxLength: 2000 },
          stack: { type: 'string', maxLength: 8000 },
          componentStack: { type: 'string', maxLength: 4000 },
          source: { type: 'string', maxLength: 500 },
          version: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const now = Date.now();
    const entry = recent.get(request.ip);
    if (!entry || now - entry.windowStart > WINDOW_MS) {
      if (recent.size >= MAX_TRACKED_CLIENTS) recent.clear();
      recent.set(request.ip, { windowStart: now, count: 1 });
    } else if (++entry.count > MAX_REPORTS_PER_WINDOW) {
      return reply.code(204).send();
    }

    const body = request.body || {};
    request.log.error({
      clientError: {
        kind: clip(body.kind, 40),
        message: clip(body.message, 2000),
        stack: clip(body.stack, 8000),
        componentStack: clip(body.componentStack, 4000),
        source: clip(body.source, 500),
        version: clip(body.version, 100),
        origin: clip(request.headers.origin, 500),
        userAgent: clip(request.headers['user-agent'], 300),
      },
    }, 'Widget client error');
    return reply.code(204).send();
  });
}
