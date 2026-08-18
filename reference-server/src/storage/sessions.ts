import { randomBytes, randomInt } from 'node:crypto';

export const SESSION_TOKEN_PREFIX = 'sess_';

const OTP_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_OTP_ATTEMPTS = 5;

// ponytail: in-memory maps; move to sqlite when multi-process or restart-survival matters
const challenges = new Map<string, { email: string; code: string; expiresAt: number; attempts: number }>();
const sessions = new Map<string, { email: string; expiresAt: number }>();

export function createOtpChallenge(email: string): { challengeId: string; code: string } {
  const challengeId = `otp_${randomBytes(12).toString('hex')}`;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  challenges.set(challengeId, { email, code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  return { challengeId, code };
}

export function verifyOtp(challengeId: string, code: string): string | null {
  const challenge = challenges.get(challengeId);
  if (!challenge) return null;
  if (Date.now() > challenge.expiresAt) {
    challenges.delete(challengeId);
    return null;
  }
  challenge.attempts += 1;
  if (challenge.attempts > MAX_OTP_ATTEMPTS) {
    challenges.delete(challengeId);
    return null;
  }
  if (challenge.code !== code) return null;

  challenges.delete(challengeId); // single-use
  const token = `${SESSION_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  sessions.set(token, { email: challenge.email, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function validateSession(token: string): { email: string } | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return { email: session.email };
}

export function destroySession(token: string): void {
  sessions.delete(token);
}
