import { randomBytes, randomInt, createHash } from 'node:crypto';
import { agentStore } from './agents';

export const SESSION_TOKEN_PREFIX = 'sess_';

const OTP_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const OIDC_FLOW_TTL_MS = 10 * 60 * 1000;    // 10 minutes to finish a sign-in
const MAX_OTP_ATTEMPTS = 5;
const MAX_PENDING_OIDC_FLOWS = 1000;
const oidcClients = new Map<string, { count: number; expiresAt: number }>();

export function allowOidcStart(clientIp: string): boolean {
  const now = Date.now();
  for (const [client, bucket] of oidcClients) {
    if (now >= bucket.expiresAt) oidcClients.delete(client);
  }
  const bucket = oidcClients.get(clientIp);
  if (bucket) {
    if (bucket.count >= 10) return false;
    bucket.count++;
    return true;
  }
  if (oidcClients.size >= 1000) return false;
  oidcClients.set(clientIp, { count: 1, expiresAt: now + 15 * 60 * 1000 });
  return true;
}

// Recipient and process-wide caps bound unauthenticated email delivery.
const OTP_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_OTP_REQUESTS_PER_EMAIL = 3;
const MAX_OTP_REQUESTS_TOTAL = 100;
let otpRequestTimes: number[] = [];

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

type PendingOidcFlow = { codeVerifier: string; nonce: string; expiresAt: number; provider: string };

// Process-local state: replicas and restart survival require shared storage.
const challenges = new Map<string, { email: string; code: string; expiresAt: number; attempts: number }>();
const sessions = new Map<string, WidgetSession & { expiresAt: number }>();
const oidcFlows = new Map<string, PendingOidcFlow>();
const otpRequests = new Map<string, number[]>();

/** Reserve a delivery attempt before sending mail, including failed deliveries. */
export function allowOtpRequest(email: string): boolean {
  const now = Date.now();
  otpRequestTimes = otpRequestTimes.filter(at => now - at < OTP_RATE_WINDOW_MS);
  if (otpRequestTimes.length >= MAX_OTP_REQUESTS_TOTAL) return false;
  const recent = (otpRequests.get(email) ?? []).filter((at) => now - at < OTP_RATE_WINDOW_MS);
  if (recent.length >= MAX_OTP_REQUESTS_PER_EMAIL) {
    otpRequests.set(email, recent);
    return false;
  }

  recent.push(now);
  otpRequestTimes.push(now);
  otpRequests.set(email, recent);
  return true;
}

/** Reclaim abandoned authentication state; return the number of removed map entries. */
export function sweepExpiredSessionState(now = Date.now()): number {
  let removed = 0;
  otpRequestTimes = otpRequestTimes.filter(at => now - at < OTP_RATE_WINDOW_MS);

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

/** Reuse manager provisioning to link a verified email to its own account and key. */
export function createSessionForIdentity(identity: SessionIdentity): string {
  const email = identity.email.trim().toLowerCase();
  const existing = agentStore.getManagerUserByEmail(email);
  const policy = process.env.WIDGET_SIGNUP_POLICY || 'existing';
  const domains = (process.env.WIDGET_SIGNUP_DOMAINS || '').split(',').map(domain => domain.trim().toLowerCase()).filter(Boolean);
  const permitted = policy === 'open' ||
    (policy === 'existing' && !!existing) ||
    (policy === 'allowlist' && domains.includes(email.split('@')[1]));
  if (!permitted || (existing && existing.status !== 'active')) {
    throw Object.assign(new Error('This account is not permitted to use widget sign-in.'), { statusCode: 403 });
  }
  const { user, parentKey } = agentStore.ensureManagerUserProvisioned({
    external_user_id: identity.externalUserId,
    username: identity.username ?? undefined,
    first_name: identity.firstName ?? undefined,
    last_name: identity.lastName ?? undefined,
    email,
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

export function startOidcFlow(provider = 'google'): { state: string; codeVerifier: string; codeChallenge: string; nonce: string } {
  if (oidcFlows.size >= MAX_PENDING_OIDC_FLOWS) {
    sweepExpiredSessionState();
    if (oidcFlows.size >= MAX_PENDING_OIDC_FLOWS) {
      throw Object.assign(new Error('Too many sign-in attempts. Please try again shortly.'), { statusCode: 429 });
    }
  }
  const state = randomBytes(16).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const nonce = randomBytes(16).toString('hex');
  oidcFlows.set(state, { codeVerifier, nonce, expiresAt: Date.now() + OIDC_FLOW_TTL_MS, provider });
  return { state, codeVerifier, codeChallenge, nonce };
}

/** Single-use: consuming a state prevents replay of a completed callback. */
export function consumeOidcFlow(state: string, provider = 'google'): { codeVerifier: string; nonce: string } | null {
  const flow = oidcFlows.get(state);
  if (!flow) return null;
  oidcFlows.delete(state);
  if (Date.now() > flow.expiresAt || flow.provider !== provider) return null;
  return { codeVerifier: flow.codeVerifier, nonce: flow.nonce };
}
