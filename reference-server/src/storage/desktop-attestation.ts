import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { agentStore, getDatabase } from './agents';
import { createAttestedDesktopSession, validateSession, type WidgetSession } from './sessions';
import { desktopClientRegistration, desktopRegistrationHash, DesktopAuthError, type AppleAppAttestPolicy } from './desktop-auth';
import { verifyAppleAppAttestation, verifyAppleAppAssertion } from '../util/apple-app-attest';

const LOGIN_TTL = 5 * 60_000;
const CHALLENGE_TTL = 60_000;
const MAX_LOGINS = 1000;
const MAX_REQUESTS = 2000;
const MAX_LOGIN_ATTEMPTS = 5;
const opaque = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () => new DesktopAuthError('invalid_grant');
export function canonicalKeyId(value: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32 && Buffer.from(value, 'base64').toString('base64') === value;
}
function decodeProof(value: string): Buffer {
  if (!value || value.length > 180_000 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw invalid();
  const proof = Buffer.from(value, 'base64');
  if (proof.toString('base64') !== value) throw invalid();
  return proof;
}
export function desktopBodyHash(body: unknown): string { return digest(body === undefined ? '' : JSON.stringify(body)); }
export function protectedDesktopRequest(method: string, requestPath: string): boolean {
  const path = requestPath.split('?')[0];
  return (method === 'GET' && ['/auth/session', '/v1/models/effective', '/v1/agents'].includes(path)) ||
    (method === 'POST' && ['/auth/logout', '/v1/chat/completions'].includes(path));
}

type VerifiedAttestation = { publicKey: string; receipt: string; counter: number; teamId: string; signingIdentifier: string; bundleVersion: string };
export interface DesktopAttestationVerifier {
  attestation(input: { attestation: Buffer; challenge: Buffer; keyId: string; teamId: string; signingIdentifier: string; bundleVersions: string[] }): Promise<VerifiedAttestation>;
  assertion(input: { assertion: Buffer; challenge: Buffer; keyId: string; publicKey: string; teamId: string; signingIdentifier: string; previousCounter: number; bundleVersions: string[] }): Promise<{ counter: number; bundleVersion: string }>;
}

const appleVerifier: DesktopAttestationVerifier = {
  async attestation(input) {
    const result = await verifyAppleAppAttestation({ attestation: input.attestation, keyId: input.keyId,
      clientDataHash: createHash('sha256').update(input.challenge).digest(), teamId: input.teamId,
      signingIdentifier: input.signingIdentifier, allowedBundleVersions: input.bundleVersions });
    return { publicKey: result.publicKeySpki.toString('base64'), receipt: result.receipt.toString('base64'), counter: result.counter,
      teamId: input.teamId, signingIdentifier: input.signingIdentifier, bundleVersion: result.bundleVersion };
  },
  async assertion(input) {
    return verifyAppleAppAssertion({ assertion: input.assertion, keyId: input.keyId,
      clientDataHash: createHash('sha256').update(input.challenge).digest(), publicKeySpki: Buffer.from(input.publicKey, 'base64'),
      teamId: input.teamId, signingIdentifier: input.signingIdentifier, previousCounter: input.previousCounter,
      allowedBundleVersions: input.bundleVersions });
  },
};

export type AttestedKey = {
  key_id: string; user_id: string; client_id: string; public_key: string; receipt: string;
  sign_count: number; team_id: string; signing_identifier: string; bundle_version: string; revoked_at: string | null;
};

/** Public attestation material and monotonic assertion counters survive server restarts. */
export class DesktopAttestedKeyStore {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS desktop_attested_keys (
      key_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL,
      public_key TEXT NOT NULL, receipt TEXT NOT NULL, sign_count INTEGER NOT NULL,
      team_id TEXT NOT NULL, signing_identifier TEXT NOT NULL, bundle_version TEXT NOT NULL,
      revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    ); CREATE INDEX IF NOT EXISTS idx_desktop_attested_keys_owner ON desktop_attested_keys(user_id, client_id);`);
  }
  get(keyId: string): AttestedKey | undefined { return this.db.prepare('SELECT * FROM desktop_attested_keys WHERE key_id = ?').get(keyId) as AttestedKey | undefined; }
  enroll(key: Omit<AttestedKey, 'revoked_at'>): void {
    const result = this.db.prepare(`INSERT OR IGNORE INTO desktop_attested_keys
      (key_id, user_id, client_id, public_key, receipt, sign_count, team_id, signing_identifier, bundle_version)
      VALUES (@key_id, @user_id, @client_id, @public_key, @receipt, @sign_count, @team_id, @signing_identifier, @bundle_version)`).run(key);
    if (result.changes !== 1) throw invalid();
  }
  advance(key: AttestedKey, counter: number, bundleVersion: string): void {
    if (!Number.isSafeInteger(counter) || counter < 1 || counter > 0xffffffff) throw invalid();
    // A single conditional write rejects concurrent/replayed assertions, including across workers.
    const updated = this.db.prepare(`UPDATE desktop_attested_keys SET sign_count = ?, bundle_version = ?, updated_at = datetime('now')
      WHERE key_id = ? AND user_id = ? AND client_id = ? AND public_key = ? AND revoked_at IS NULL AND sign_count < ?`)
      .run(counter, bundleVersion, key.key_id, key.user_id, key.client_id, key.public_key, counter);
    if (updated.changes !== 1) throw invalid();
  }
  revoke(keyId: string): void { this.db.prepare("UPDATE desktop_attested_keys SET revoked_at = datetime('now') WHERE key_id = ?").run(keyId); }
}

type Login = { sourceToken: string; clientId: string; registrationHash: string; expiresAt: number; attempts: number; busy: boolean; challenge?: { value: string; keyId: string; kind: 'attestation' | 'assertion'; expiresAt: number } };
type RequestChallenge = { tokenHash: string; keyId: string; method: string; path: string; bodyHash: string; challenge: string; expiresAt: number };

export class DesktopAttestationService {
  private readonly logins = new Map<string, Login>();
  private readonly requests = new Map<string, RequestChallenge>();
  constructor(
    readonly keys: DesktopAttestedKeyStore,
    private readonly verifier: DesktopAttestationVerifier = appleVerifier,
    private readonly now: () => number = Date.now,
  ) {}
  sweep(): void {
    for (const [id, login] of this.logins) if (login.expiresAt <= this.now()) this.logins.delete(id);
    for (const [id, challenge] of this.requests) if (challenge.expiresAt <= this.now()) this.requests.delete(id);
  }
  activeSession(token: string): WidgetSession | null {
    const session = validateSession(token);
    if (!session) return null;
    const owner = agentStore.lookupKeyIdentity(session.parentKey);
    return owner && owner.user_id === session.userId ? { ...session, email: owner.email } : null;
  }
  private login(id: string): { login: Login; session: WidgetSession; policy: AppleAppAttestPolicy } {
    this.sweep();
    const login = this.logins.get(digest(id));
    const session = login && this.activeSession(login.sourceToken);
    const policy = login && desktopClientRegistration(login.clientId)?.apple_app_attest;
    if (!login || !session || session.desktopAttestation || !policy || desktopRegistrationHash(login.clientId) !== login.registrationHash) {
      this.logins.delete(digest(id)); throw invalid();
    }
    return { login, session, policy };
  }
  beginLogin(sourceToken: string, clientId: string): { attestation_required: true; login_id: string; account: { email: string; user_id: string } } {
    this.sweep();
    const session = this.activeSession(sourceToken);
    const registration = desktopClientRegistration(clientId);
    const registrationHash = desktopRegistrationHash(clientId);
    if (!session || session.desktopAttestation || !registration?.apple_app_attest || !registrationHash) throw invalid();
    if (this.logins.size >= MAX_LOGINS) throw new DesktopAuthError('temporarily_unavailable');
    const id = opaque();
    this.logins.set(digest(id), { sourceToken, clientId, registrationHash, expiresAt: this.now() + LOGIN_TTL, attempts: 0, busy: false });
    return { attestation_required: true, login_id: id, account: { email: session.email, user_id: session.userId } };
  }
  private ownedKey(keyId: string, session: WidgetSession, clientId: string, policy: AppleAppAttestPolicy): AttestedKey | undefined {
    const key = this.keys.get(keyId);
    if (key && (key.revoked_at || key.user_id !== session.userId || key.client_id !== clientId || key.team_id !== policy.team_id ||
      key.signing_identifier !== policy.signing_identifier)) throw invalid();
    return key;
  }
  loginChallenge(id: string, keyId: string): { challenge: string; proof_kind: 'attestation' | 'assertion' } {
    if (!canonicalKeyId(keyId)) throw invalid();
    const { login, session, policy } = this.login(id);
    if (login.busy || login.attempts >= MAX_LOGIN_ATTEMPTS) throw invalid();
    const key = this.ownedKey(keyId, session, login.clientId, policy);
    const kind = key ? 'assertion' : 'attestation';
    const value = opaque();
    login.attempts++;
    login.challenge = { value, keyId, kind, expiresAt: this.now() + CHALLENGE_TTL };
    return { challenge: value, proof_kind: kind };
  }
  async verifyLogin(id: string, keyId: string, encodedProof: string): Promise<{ session_token: string; email: string }> {
    const { login, session, policy } = this.login(id);
    const challenge = login.challenge;
    if (login.busy || !canonicalKeyId(keyId) || !challenge || challenge.keyId !== keyId || challenge.expiresAt <= this.now()) throw invalid();
    delete login.challenge; // Consume even if cryptographic verification fails.
    login.busy = true;
    try {
      const proof = decodeProof(encodedProof);
      const key = this.ownedKey(keyId, session, login.clientId, policy);
      const bytes = Buffer.from(challenge.value, 'base64url');
      if (challenge.kind === 'assertion' && key) {
        const result = await this.verifier.assertion({ assertion: proof, challenge: bytes, keyId: key.key_id, publicKey: key.public_key, teamId: key.team_id, signingIdentifier: key.signing_identifier, previousCounter: key.sign_count, bundleVersions: policy.bundle_versions });
        this.login(id); // Revalidate source authority and current registration after async verification.
        if (challenge.expiresAt <= this.now()) throw invalid();
        if (!policy.bundle_versions.includes(result.bundleVersion)) throw invalid();
        this.keys.advance(key, result.counter, result.bundleVersion);
      } else if (challenge.kind === 'attestation' && !key) {
        const result = await this.verifier.attestation({ attestation: proof, challenge: bytes, keyId, teamId: policy.team_id, signingIdentifier: policy.signing_identifier, bundleVersions: policy.bundle_versions });
        this.login(id);
        if (challenge.expiresAt <= this.now()) throw invalid();
        if (result.counter !== 0 || result.teamId !== policy.team_id || result.signingIdentifier !== policy.signing_identifier || !policy.bundle_versions.includes(result.bundleVersion)) throw invalid();
        this.keys.enroll({ key_id: keyId, user_id: session.userId, client_id: login.clientId, public_key: result.publicKey, receipt: result.receipt,
          sign_count: 0, team_id: result.teamId, signing_identifier: result.signingIdentifier, bundle_version: result.bundleVersion });
      } else throw invalid();
      const token = createAttestedDesktopSession(login.sourceToken, { clientId: login.clientId, keyId, registrationHash: login.registrationHash });
      if (!token) throw invalid();
      this.logins.delete(digest(id));
      return { session_token: token, email: session.email };
    } catch {
      throw invalid();
    } finally { login.busy = false; }
  }
  boundSession(token: string): { session: WidgetSession; key: AttestedKey } {
    const session = this.activeSession(token);
    const binding = session?.desktopAttestation;
    const policy = binding && desktopClientRegistration(binding.clientId)?.apple_app_attest;
    if (!session || !binding || !policy || desktopRegistrationHash(binding.clientId) !== binding.registrationHash) throw invalid();
    const key = this.ownedKey(binding.keyId, session, binding.clientId, policy);
    if (!key) throw invalid();
    return { session, key };
  }
  requestChallenge(token: string, method: string, requestPath: string, bodyHash: string): { challenge_id: string; challenge: string } {
    this.sweep();
    const { key } = this.boundSession(token);
    if (!protectedDesktopRequest(method, requestPath) || requestPath.length > 2048 || !requestPath.startsWith('/') || /[\r\n#]/.test(requestPath) || !/^[a-f0-9]{64}$/.test(bodyHash)) throw invalid();
    const tokenHash = digest(token);
    if (this.requests.size >= MAX_REQUESTS || [...this.requests.values()].filter(item => item.tokenHash === tokenHash).length >= 8) throw new DesktopAuthError('temporarily_unavailable');
    const id = opaque(); const challenge = opaque();
    this.requests.set(digest(id), { tokenHash, keyId: key.key_id, method, path: requestPath, bodyHash, challenge, expiresAt: this.now() + CHALLENGE_TTL });
    return { challenge_id: id, challenge };
  }
  async verifyRequest(token: string, method: string, requestPath: string, body: unknown, challengeId: string, keyId: string, encodedProof: string): Promise<void> {
    this.sweep();
    const { session, key } = this.boundSession(token);
    const policy = desktopClientRegistration(session.desktopAttestation!.clientId)!.apple_app_attest!;
    const challenge = this.requests.get(digest(challengeId));
    if (!challenge || challenge.tokenHash !== digest(token) || challenge.keyId !== keyId || keyId !== key.key_id) throw invalid();
    this.requests.delete(digest(challengeId));
    if (challenge.method !== method || challenge.path !== requestPath || challenge.bodyHash !== desktopBodyHash(body) || !protectedDesktopRequest(method, requestPath)) throw invalid();
    try {
      const result = await this.verifier.assertion({ assertion: decodeProof(encodedProof), challenge: Buffer.from(challenge.challenge, 'base64url'), keyId: key.key_id, publicKey: key.public_key, teamId: key.team_id, signingIdentifier: key.signing_identifier, previousCounter: key.sign_count, bundleVersions: policy.bundle_versions });
      this.boundSession(token);
      if (challenge.expiresAt <= this.now()) throw invalid();
      if (!policy.bundle_versions.includes(result.bundleVersion)) throw invalid();
      this.keys.advance(key, result.counter, result.bundleVersion);
    } catch { throw invalid(); }
  }
}
export const desktopAttestation = new DesktopAttestationService(new DesktopAttestedKeyStore(getDatabase()));
