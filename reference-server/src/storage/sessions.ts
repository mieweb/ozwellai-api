import { randomBytes, randomInt, createHash } from 'node:crypto';
import { agentStore } from './agents';

export const SESSION_TOKEN_PREFIX = 'sess_';

const OTP_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const OIDC_FLOW_TTL_MS = 10 * 60 * 1000;    // 10 minutes to finish a sign-in
const MAX_OTP_ATTEMPTS = 5;

// Requesting a code makes the server send mail to an address the caller chose,
// so the endpoint is a spam relay unless the rate is capped here.
//
// The cap is per recipient, deliberately not per client IP: the server runs
// behind a reverse proxy without `trustProxy`, so every request reports the
// proxy's address. A per-IP bucket would throttle all users as if they were
// one, while giving an attacker no trouble at all.
const OTP_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_OTP_REQUESTS_PER_EMAIL = 3;

export type SessionIdentity = {
  email: string;
  externalUserId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export type WidgetSession = {
  email: string;
  userId: string;
  /** Parent key this user owns; requests are authorized as this key. */
  parentKey: string;
};

/** A Google sign-in in flight: state -> PKCE verifier + nonce. */
type PendingOidcFlow = { codeVerifier: string; nonce: string; expiresAt: number };

// ponytail: in-memory maps; move to sqlite if multi-process or restart-survival matters
const challenges = new Map<string, { email: string; code: string; expiresAt: number; attempts: number }>();
const sessions = new Map<string, WidgetSession & { expiresAt: number }>();
const oidcFlows = new Map<string, PendingOidcFlow>();
const otpRequests = new Map<string, number[]>();

/**
 * Record one OTP request for an address and say whether it is allowed.
 * Called before any mail is sent.
 */
export function allowOtpRequest(email: string): boolean {
  const now = Date.now();
  const recent = (otpRequests.get(email) ?? []).filter((at) => now - at < OTP_RATE_WINDOW_MS);
  if (recent.length >= MAX_OTP_REQUESTS_PER_EMAIL) {
    otpRequests.set(email, recent);
    return false;
  }

  recent.push(now);
  otpRequests.set(email, recent);
  return true;
}

/**
 * Drop everything that has aged out of the maps above.
 *
 * Entries are otherwise only removed when a caller comes back for that exact
 * key, so anything abandoned — an unverified code, a sign-in never completed —
 * would stay for the life of the process. `otpRequests` matters most: its keys
 * are email addresses chosen by unauthenticated callers, so without this a
 * script posting distinct addresses grows the map without bound.
 *
 * Returns the number of entries removed, so callers can log it.
 */
export function sweepExpiredSessionState(now = Date.now()): number {
  let removed = 0;

  for (const [key, entry] of challenges) {
    if (now > entry.expiresAt) { challenges.delete(key); removed++; }
  }
  for (const [token, session] of sessions) {
    if (now > session.expiresAt) { sessions.delete(token); removed++; }
  }
  for (const [state, flow] of oidcFlows) {
    if (now > flow.expiresAt) { oidcFlows.delete(state); removed++; }
  }
  for (const [email, hits] of otpRequests) {
    const recent = hits.filter((at) => now - at < OTP_RATE_WINDOW_MS);
    if (recent.length === 0) { otpRequests.delete(email); removed++; }
    else if (recent.length !== hits.length) otpRequests.set(email, recent);
  }

  return removed;
}

/**
 * Turn a verified identity into a session backed by that user's own key.
 *
 * Reuses the manager's provisioning path, so a widget user and a manager user
 * are the same record: matched on email, given their own parent key on first
 * sign-in, and re-linked to an existing row when the email already exists.
 */
export function createSessionForIdentity(identity: SessionIdentity): string {
  const { user, parentKey } = agentStore.ensureManagerUserProvisioned({
    external_user_id: identity.externalUserId,
    username: identity.username ?? undefined,
    first_name: identity.firstName ?? undefined,
    last_name: identity.lastName ?? undefined,
    email: identity.email,
  });

  const token = `${SESSION_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  sessions.set(token, {
    email: user.email ?? identity.email,
    userId: user.id,
    parentKey: parentKey.key,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

export function validateSession(token: string): WidgetSession | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  const { email, userId, parentKey } = session;
  return { email, userId, parentKey };
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

// --- email one-time codes ---

export function createOtpChallenge(email: string): { challengeId: string; code: string } {
  const challengeId = `otp_${randomBytes(12).toString('hex')}`;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  challenges.set(challengeId, { email, code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  return { challengeId, code };
}

/** Verify a code and, on success, return the email it belongs to. */
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
  return challenge.email;
}

// --- OIDC flow state (PKCE verifier + nonce, keyed by state) ---

export function startOidcFlow(): { state: string; codeVerifier: string; codeChallenge: string; nonce: string } {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const nonce = randomBytes(16).toString('hex');
  oidcFlows.set(state, { codeVerifier, nonce, expiresAt: Date.now() + OIDC_FLOW_TTL_MS });
  return { state, codeVerifier, codeChallenge, nonce };
}

/** Single-use: consuming a state prevents replay of a completed callback. */
export function consumeOidcFlow(state: string): { codeVerifier: string; nonce: string } | null {
  const flow = oidcFlows.get(state);
  if (!flow) return null;
  oidcFlows.delete(state);
  if (Date.now() > flow.expiresAt) return null;
  return { codeVerifier: flow.codeVerifier, nonce: flow.nonce };
}
