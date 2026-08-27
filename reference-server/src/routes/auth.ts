import { FastifyInstance } from 'fastify';
import { createOtpChallenge, verifyOtp, validateSession, destroySession, createSessionForIdentity, allowOtpRequest } from '../storage/sessions';
import { isGoogleConfigured } from './oidc-google';
import { createError, extractToken } from '../util';
import { isMailConfigured, sendOtpEmail } from '../util/mailer';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Widget sign-in routes.
 *
 * Keyless widget embeds use these to obtain a short-lived session token
 * (sess_...), which server.ts exchanges for the configured backing key.
 */
export default async function authRoute(fastify: FastifyInstance) {
  fastify.post('/auth/otp/request', {
    schema: {
      tags: ['Auth'],
      summary: 'Request an email one-time code for widget sign-in',
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { email } = (request.body ?? {}) as { email?: string };
    if (!email || !EMAIL_RE.test(email)) {
      reply.code(400);
      return createError('Valid email required', 'invalid_request_error', 'email');
    }

    const normalized = email.toLowerCase();
    if (!allowOtpRequest(normalized)) {
      reply.code(429);
      return createError(
        'Too many sign-in codes requested. Wait a few minutes and try again.',
        'rate_limit_error',
        'email',
      );
    }

    const { challengeId, code } = createOtpChallenge(normalized);

    if (isMailConfigured()) {
      try {
        await sendOtpEmail(normalized, code);
      } catch (err) {
        request.log.error({ err, email }, 'sign-in code delivery failed');
        reply.code(502);
        return createError('Could not send the sign-in code. Try again shortly.', 'server_error');
      }
      // Deliberately not logged: once mail works, a logged code would let
      // anyone with log access sign in as the user who requested it.
      request.log.info({ email }, 'widget OTP sent');
    } else {
      // No sender configured — the log is the delivery mechanism, which is how
      // local development works.
      request.log.info({ email, code }, 'widget OTP issued (no mail sender configured)');
    }

    const body: Record<string, string> = { challenge_id: challengeId };
    // Echoing the code bypasses delivery entirely, so it is refused whenever
    // this server can actually send mail, whatever the env says.
    if (process.env.AUTH_DEV_ECHO_OTP === '1' && !isMailConfigured()) body.dev_code = code;
    return body;
  });

  fastify.post('/auth/otp/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Exchange an email one-time code for a widget session token',
      body: {
        type: 'object',
        required: ['challenge_id', 'code'],
        properties: {
          challenge_id: { type: 'string' },
          code: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { challenge_id, code } = (request.body ?? {}) as { challenge_id?: string; code?: string };
    const email = challenge_id && code ? verifyOtp(challenge_id, code) : null;
    if (!email) {
      reply.code(401);
      return createError('Invalid or expired code', 'invalid_request_error');
    }

    // A verified email provisions the same user record a manager sign-in would,
    // so the session is backed by that user's own key.
    const token = createSessionForIdentity({ email, externalUserId: `email:${email}`, username: email });
    return { session_token: token, email };
  });

  fastify.get('/auth/session', {
    schema: { tags: ['Auth'], summary: 'Describe the current widget session' },
  }, async (request, reply) => {
    const session = validateSession(extractToken(request.headers.authorization));
    if (!session) {
      reply.code(401);
      return createError('Invalid or expired session', 'invalid_request_error');
    }
    return { email: session.email, user_id: session.userId };
  });

  fastify.get('/auth/methods', {
    schema: { tags: ['Auth'], summary: 'List sign-in methods this server offers' },
  }, async () => {
    return { google: isGoogleConfigured(), email_otp: true, user_key: true };
  });

  fastify.post('/auth/logout', {
    schema: { tags: ['Auth'], summary: 'Destroy the current widget session' },
  }, async (request) => {
    destroySession(extractToken(request.headers.authorization));
    return { ok: true };
  });
}
