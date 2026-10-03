import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const FLOW_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;
const MAX_PENDING = 1000;
const COOKIE_NAME = 'ozwell_desktop_flow';
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CLIENT_STATE = /^[A-Za-z0-9._~-]{32,256}$/;

type Registration = { name: string; redirect_uris: string[] };
export type DesktopAuthorization = {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
};
type PendingFlow = DesktopAuthorization & { cookieHash: Buffer; expiresAt: number };
type PendingCode = DesktopAuthorization & { sessionToken: string; expiresAt: number; attempts: number };

export class DesktopAuthError extends Error {
  readonly code: 'invalid_request' | 'invalid_grant' | 'temporarily_unavailable';
  constructor(code: DesktopAuthError['code']) {
    super(code === 'invalid_grant' ? 'Invalid or expired authorization code.' : code === 'temporarily_unavailable' ? 'Too many sign-in attempts. Try again later.' : 'Invalid desktop authorization request.');
    this.code = code;
  }
}

/** Operator registrations identify public clients; there is deliberately no client secret. */
function registrations(): Record<string, Registration> {
  try {
    const parsed: unknown = JSON.parse(process.env.OZWELL_DESKTOP_CLIENTS || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, Registration> = Object.create(null);
    for (const [id, value] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if (typeof record.name !== 'string' || record.name.length < 1 || record.name.length > 100 || !Array.isArray(record.redirect_uris)) continue;
      const redirects = record.redirect_uris.filter((uri): uri is string => typeof uri === 'string' && validRegistrationUri(uri));
      if (redirects.length) result[id] = { name: record.name, redirect_uris: redirects };
    }
    return result;
  } catch { return {}; }
}
function validRegistrationUri(uri: string): boolean {
  if (uri === 'http://127.0.0.1/oauth/callback') return true; // Registered loopback port template.
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.toString() === uri;
  } catch { return false; }
}
export function desktopLoginAvailable(): boolean { return Object.keys(registrations()).length > 0; }
export function registeredDesktopClient(clientId: string, redirectUri: string): Registration | null {
  const client = registrations()[clientId];
  if (!client) return null;
  const loopback = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/oauth\/callback$/.exec(redirectUri);
  if (loopback) {
    const port = Number(loopback[1]);
    return port > 0 && port <= 65535 && client.redirect_uris.includes('http://127.0.0.1/oauth/callback') ? client : null;
  }
  return redirectUri.startsWith('https://') && client.redirect_uris.includes(redirectUri) ? client : null;
}
function hash(value: string): Buffer { return createHash('sha256').update(value).digest(); }
function secretMatches(value: string, digest: Buffer): boolean { return timingSafeEqual(hash(value), digest); }
function opaque(): string { return randomBytes(32).toString('base64url'); }

/** Process-local, like Ozwell sessions. Deploy replicas with sticky routing or shared stores. */
export class DesktopAuthorizationStore {
  private readonly flows = new Map<string, PendingFlow>();
  private readonly codes = new Map<string, PendingCode>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  sweep(): void {
    for (const [id, flow] of this.flows) if (flow.expiresAt <= this.now()) this.flows.delete(id);
    for (const [id, code] of this.codes) if (code.expiresAt <= this.now()) this.codes.delete(id);
  }
  begin(input: DesktopAuthorization, method: unknown, responseType: unknown): { flowId: string; cookie: string; clientName: string } {
    const client = registeredDesktopClient(input.clientId, input.redirectUri);
    if (!client || responseType !== 'code' || method !== 'S256' || !CLIENT_STATE.test(input.state) || !PKCE_CHALLENGE.test(input.challenge) || Buffer.from(input.challenge, 'base64url').toString('base64url') !== input.challenge) throw new DesktopAuthError('invalid_request');
    this.sweep();
    if (this.flows.size + this.codes.size >= MAX_PENDING) throw new DesktopAuthError('temporarily_unavailable');
    const flowId = opaque();
    const cookie = opaque();
    this.flows.set(flowId, { ...input, cookieHash: hash(cookie), expiresAt: this.now() + FLOW_TTL_MS });
    return { flowId, cookie, clientName: client.name };
  }
  complete(flowId: string, cookie: string, sessionToken: string): string {
    this.sweep();
    const flow = this.flows.get(flowId);
    if (!flow || !secretMatches(cookie, flow.cookieHash) || !registeredDesktopClient(flow.clientId, flow.redirectUri)) throw new DesktopAuthError('invalid_request');
    this.flows.delete(flowId);
    const code = opaque();
    this.codes.set(hash(code).toString('hex'), {
      clientId: flow.clientId, redirectUri: flow.redirectUri, state: flow.state, challenge: flow.challenge,
      sessionToken, expiresAt: this.now() + CODE_TTL_MS, attempts: 0,
    });
    const redirect = new URL(flow.redirectUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', flow.state);
    return redirect.toString();
  }
  redeem(input: { clientId: string; redirectUri: string; code: string; verifier: string; grantType: unknown }): string {
    this.sweep();
    const key = hash(input.code).toString('hex');
    const grant = this.codes.get(key);
    if (!grant || input.grantType !== 'authorization_code' || !PKCE_VERIFIER.test(input.verifier) || input.clientId !== grant.clientId || input.redirectUri !== grant.redirectUri || !registeredDesktopClient(input.clientId, input.redirectUri)) throw new DesktopAuthError('invalid_grant');
    grant.attempts++;
    const challenge = createHash('sha256').update(input.verifier).digest('base64url');
    if (!secretMatches(challenge, hash(grant.challenge))) {
      if (grant.attempts >= 5) this.codes.delete(key);
      throw new DesktopAuthError('invalid_grant');
    }
    this.codes.delete(key); // Consume before returning the credential, including concurrent exchanges.
    return grant.sessionToken;
  }
}
export const desktopAuthorizations = new DesktopAuthorizationStore();
export { COOKIE_NAME as DESKTOP_FLOW_COOKIE };
