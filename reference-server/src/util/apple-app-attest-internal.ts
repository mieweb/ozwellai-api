import { createHash, createPublicKey, timingSafeEqual, verify, webcrypto, X509Certificate } from 'node:crypto';
import cbor from 'cbor';
import * as asn1 from 'asn1js';
import * as pki from 'pkijs';

// Protocol: https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
// Receipt: https://developer.apple.com/documentation/devicecheck/assessing-fraud-risk
// Cryptographic primitives and ASN.1/CBOR parsing come from Node, PKIjs, asn1js and cbor.
// PKIjs uses DOM WebCrypto types, while the supported Node runtime has separate compatible types.
const cryptoEngine = new pki.CryptoEngine({ name: 'node', crypto: webcrypto, subtle: webcrypto.subtle } as unknown as ConstructorParameters<typeof pki.CryptoEngine>[0]);
const MAX_EVIDENCE = 128 * 1024;
const PRODUCTION_AAGUID = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
const REQUIRED_MAC_ACL = Buffer.from('MEAMAjExMDowCQwCb2uhAwEB/zAJDAJvYaEDAQH/MAsMBG9kZWyhAwEB/zAVDARvc2duoAYMBHJzZWMwBaYDAgEB', 'base64');
const NONCE_OID = '1.2.840.113635.100.8.2';
const ACL_OID = '1.2.840.113635.100.8.6';
const CREDENTIAL_EKU = '1.2.840.113635.100.4.24';
const SIGNATURE_OIDS = new Set(['1.2.840.10045.4.3.2', '1.2.840.10045.4.3.3']);

interface AppPolicy {
  teamId: string;
  signingIdentifier: string;
  allowedBundleVersions: readonly string[];
  /** SHA-256 of server-created, challenge-bound client data; never trust a client-supplied hash. */
  clientDataHash: Uint8Array;
  keyId: string;
}
export interface AppleAppAttestationInput extends AppPolicy { attestation: Uint8Array; now?: Date }
export interface AppleAppAssertionInput extends AppPolicy {
  assertion: Uint8Array;
  publicKeySpki: Uint8Array;
  previousCounter: number;
}
export interface VerifiedAppleAppAssertion { counter: number; bundleVersion: string; validationCategory: 6 }
export interface VerifiedAppleAppAttestation extends VerifiedAppleAppAssertion {
  keyId: string;
  publicKeySpki: Buffer;
  counter: 0;
  environment: 'production';
  /** Signature, trust, age, App ID and key binding verified. No fraud metric has been requested. */
  receipt: Buffer;
  receiptCreatedAt: Date;
}
export class AppAttestVerificationError extends Error {
  constructor() { super('App attestation verification failed.'); this.name = 'AppAttestVerificationError'; }
}
function requireValue(condition: unknown): asserts condition { if (!condition) throw new AppAttestVerificationError(); }
function sha256(value: Uint8Array | string): Buffer { return createHash('sha256').update(value).digest(); }
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.byteLength === b.byteLength && timingSafeEqual(a, b); }
function bytes(value: unknown, max: number, exact?: number): Buffer {
  requireValue(value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= max && (exact === undefined || value.byteLength === exact));
  return Buffer.from(value);
}
function keyIdBytes(value: string): Buffer {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value));
  const result = Buffer.from(value, 'base64');
  requireValue(result.length === 32 && result.toString('base64') === value);
  return result;
}
function policy(input: AppPolicy): { keyId: Buffer; hash: Buffer; appId: string } {
  requireValue(/^[A-Z0-9]{10}$/.test(input.teamId) && /^[A-Za-z0-9.-]{1,255}$/.test(input.signingIdentifier));
  requireValue(Array.isArray(input.allowedBundleVersions) && input.allowedBundleVersions.length > 0 && input.allowedBundleVersions.length <= 256);
  requireValue(input.allowedBundleVersions.every(v => typeof v === 'string' && v.length > 0 && v.length <= 128));
  return { keyId: keyIdBytes(input.keyId), hash: bytes(input.clientDataHash, 32, 32), appId: `${input.teamId}.${input.signingIdentifier}` };
}
function map(value: unknown, keys?: readonly (string | number)[]): Map<unknown, unknown> {
  requireValue(value instanceof Map);
  if (keys) requireValue(value.size === keys.length && keys.every(key => value.has(key)));
  return value;
}
function decode(input: Buffer, trailing = false): { value: unknown; length: number } {
  const rejectTags = new Proxy({}, { get: () => () => { throw new AppAttestVerificationError(); } });
  const result = cbor.decodeFirstSync(input, { preferMap: true, preventDuplicateKeys: true, max_depth: 12, extendedResults: true, tags: rejectTags }) as { value: unknown; length: number; unused: Buffer | null };
  requireValue(result.length > 0 && (trailing || !result.unused?.length));
  let nodes = 0;
  function shape(value: unknown): void {
    requireValue(++nodes <= 4096);
    if (value instanceof Map) {
      for (const [key, entry] of value) {
        // Primitive keys make the decoder's duplicate-key check unambiguous.
        requireValue(typeof key === 'string' || Number.isSafeInteger(key));
        shape(entry);
      }
    } else if (Array.isArray(value)) value.forEach(shape);
    else requireValue(value instanceof Uint8Array || typeof value === 'string' || Number.isSafeInteger(value));
  }
  shape(result.value);
  return result;
}

/** Bound ASN.1 nesting and lengths before handing data to asn1js. Certificates/extensions use DER; CMS uses BER. */
function boundedAsn(input: Buffer, der = true) {
  let nodes = 0;
  function scan(start: number, limit: number, depth: number): number {
    requireValue(depth <= 20 && ++nodes <= 4096 && start + 2 <= limit);
    let offset = start;
    const tag = input[offset++];
    let tagNumber = tag & 31;
    if ((tag & 31) === 31) {
      requireValue(input[offset] !== 0x80);
      let count = 0, continuation: number; tagNumber = 0;
      do {
        requireValue(offset < limit && ++count <= 5);
        tagNumber = tagNumber * 128 + (input[offset] & 127);
        continuation = input[offset++] & 0x80;
      } while (continuation);
      requireValue(!der || tagNumber >= 31);
    }
    if (der && (tag & 192) === 0) requireValue(!!(tag & 32) === (tagNumber === 16 || tagNumber === 17));
    requireValue(offset < limit);
    const firstLength = input[offset++];
    let length = firstLength;
    if (firstLength === 0x80) {
      requireValue(!der && !!(tag & 32));
      while (offset + 2 <= limit && (input[offset] !== 0 || input[offset + 1] !== 0)) offset = scan(offset, limit, depth + 1);
      requireValue(offset + 2 <= limit && input[offset] === 0 && input[offset + 1] === 0);
      return offset + 2;
    }
    if (firstLength > 0x80) {
      const count = firstLength & 127;
      requireValue(count <= 4 && offset + count <= limit && (!der || input[offset] !== 0));
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + input[offset++];
      requireValue(!der || length >= 128);
    }
    const end = offset + length;
    requireValue(end <= limit && tag !== 0);
    if (tag & 32) {
      let prior: Buffer | undefined;
      while (offset < end) {
        const childEnd = scan(offset, end, depth + 1);
        const child = input.subarray(offset, childEnd);
        if (der && tag === 0x31 && prior) requireValue(Buffer.compare(prior, child) <= 0);
        prior = child; offset = childEnd;
      }
      requireValue(offset === end);
    } else if (der) {
      if (tag === 2) requireValue(length > 0 && !(length > 1 && ((input[offset] === 0 && !(input[offset + 1] & 128)) || (input[offset] === 255 && !!(input[offset + 1] & 128)))));
      if (tag === 1) requireValue(length === 1 && (input[offset] === 0 || input[offset] === 255));
      if (tag === 3) requireValue(length > 0 && input[offset] <= 7 && (length > 1 || input[offset] === 0) && (input[end - 1] & ((1 << input[offset]) - 1)) === 0);
      if (tag === 5) requireValue(length === 0);
    }
    return end;
  }
  requireValue(scan(0, input.length, 0) === input.length);
  const result = asn1.fromBER(input);
  requireValue(result.offset === input.length && !result.result.error);
  return result.result;
}
function certificate(input: Buffer): pki.Certificate {
  requireValue(input.length <= 16 * 1024);
  const cert = new pki.Certificate({ schema: boundedAsn(input) });
  const ids = cert.extensions?.map(ext => ext.extnID) ?? [];
  requireValue(new Set(ids).size === ids.length);
  // PKIjs's generic chain builder does not reject every unknown critical extension.
  // Accept only critical extensions whose semantics this verifier checks.
  requireValue(cert.extensions?.every(ext => !ext.critical || ['2.5.29.19', '2.5.29.15'].includes(ext.extnID)));
  requireValue(SIGNATURE_OIDS.has(cert.signatureAlgorithm.algorithmId) && cert.signature.algorithmId === cert.signatureAlgorithm.algorithmId);
  return cert;
}
function extensionOctets(cert: pki.Certificate, oid: string, contextTag: number): Buffer {
  const ext = cert.extensions?.find(item => item.extnID === oid);
  requireValue(ext);
  const parsed = boundedAsn(Buffer.from(ext.extnValue.getValue()));
  requireValue(parsed instanceof asn1.Sequence && parsed.valueBlock.value.length === 1);
  const context = parsed.valueBlock.value[0];
  requireValue(context instanceof asn1.Constructed && context.idBlock.tagClass === 3 && context.idBlock.tagNumber === contextTag && context.valueBlock.value.length === 1);
  const value = context.valueBlock.value[0];
  requireValue(value instanceof asn1.OctetString && !value.idBlock.isConstructed);
  return Buffer.from(value.getValue());
}
function publicPoint(spki: Uint8Array): { point: Buffer; spki: Buffer } {
  const key = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
  const jwk = key.export({ format: 'jwk' });
  requireValue(jwk.kty === 'EC' && jwk.crv === 'P-256' && jwk.x && jwk.y);
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url');
  requireValue(x.length === 32 && y.length === 32);
  return { point: Buffer.concat([Buffer.from([4]), x, y]), spki: key.export({ type: 'spki', format: 'der' }) };
}
async function chain(chainBytes: Buffer[], trustedRoot: Buffer, now: Date): Promise<pki.Certificate[]> {
  requireValue(chainBytes.length >= 2 && chainBytes.length <= 4 && Number.isFinite(now.getTime()));
  const certs = chainBytes.map(certificate), root = certificate(trustedRoot);
  const all = [...certs, root];
  for (let i = 0; i < all.length; i++) {
    const cert = all[i];
    requireValue(cert.notBefore.value <= now && cert.notAfter.value >= now);
    const constraints = cert.extensions?.find(ext => ext.extnID === '2.5.29.19')?.parsedValue as pki.BasicConstraints | undefined;
    const usage = cert.extensions?.find(ext => ext.extnID === '2.5.29.15')?.parsedValue as asn1.BitString | undefined;
    requireValue(constraints && usage instanceof asn1.BitString);
    const bits = new Uint8Array(usage.valueBlock.valueHexView)[0];
    requireValue(i === 0 ? !constraints.cA && !!(bits & 128) && !(bits & 4) : constraints.cA && !!(bits & 4));
    if (i < all.length - 1) {
      const child = new X509Certificate(chainBytes[i]);
      const issuer = new X509Certificate(i + 1 === certs.length ? trustedRoot : chainBytes[i + 1]);
      requireValue(child.checkIssued(issuer) && child.verify(issuer.publicKey));
    }
  }
  const result = await new pki.CertificateChainValidationEngine({ certs, trustedCerts: [root], checkDate: now }).verify({}, cryptoEngine);
  requireValue(result.result);
  return certs;
}
function authData(input: Buffer, attestation: boolean) {
  requireValue(input.length >= (attestation ? 87 : 37) && input.length <= 16 * 1024);
  const counter = input.readUInt32BE(33);
  let offset = 37;
  let credentialId: Buffer | undefined, cose: Map<unknown, unknown> | undefined;
  if (attestation) {
    requireValue(!!(input[32] & 64) && equal(input.subarray(37, 53), PRODUCTION_AAGUID) && input.readUInt16BE(53) === 32 && counter === 0);
    credentialId = input.subarray(55, 87); offset = 87;
    const decoded = decode(input.subarray(offset), true); offset += decoded.length;
    cose = map(decoded.value, [1, 3, -1, -2, -3]);
    requireValue(cose.get(1) === 2 && cose.get(3) === -7 && cose.get(-1) === 1);
  }
  // Apple has published authentic data with trailing extensions despite ED being unset.
  // Require and parse the signed extension map in either case; never discard trailing bytes.
  const extensions = map(decode(input.subarray(offset)).value);
  const categoryBytes = bytes(extensions.get('apple_validation_category_01'), 4, 4);
  const bundleVersion = extensions.get('apple_bundle_version_01');
  requireValue(categoryBytes.readUInt32LE() === 6 && typeof bundleVersion === 'string' && bundleVersion.length > 0 && bundleVersion.length <= 128);
  return { counter, credentialId, cose, bundleVersion, rpId: input.subarray(0, 32) };
}

async function verifyReceipt(receipt: Buffer, receiptRoot: Buffer, leaf: pki.Certificate, appId: string, now: Date): Promise<Date> {
  const container = new pki.ContentInfo({ schema: boundedAsn(receipt, false) });
  requireValue(container.contentType === '1.2.840.113549.1.7.2');
  const signed = new pki.SignedData({ schema: container.content });
  requireValue(signed.signerInfos.length === 1 && signed.certificates && signed.certificates.length <= 6 && signed.encapContentInfo.eContentType === '1.2.840.113549.1.7.1');
  const signer = signed.signerInfos[0];
  requireValue((signer.digestAlgorithm.algorithmId === '2.16.840.1.101.3.4.2.1' && signer.signatureAlgorithm.algorithmId === '1.2.840.10045.4.3.2') ||
    (signer.digestAlgorithm.algorithmId === '2.16.840.1.101.3.4.2.2' && signer.signatureAlgorithm.algorithmId === '1.2.840.10045.4.3.3'));
  for (const cert of signed.certificates) {
    requireValue(cert instanceof pki.Certificate);
    certificate(Buffer.from(cert.toSchema().toBER(false)));
  }
  const result = await signed.verify({ signer: 0, checkChain: true, trustedCerts: [certificate(receiptRoot)], checkDate: now, extendedMode: true }, cryptoEngine);
  requireValue(result.signatureVerified && result.signerCertificateVerified && result.certificatePath.length > 0);
  // PKIjs selects a chain; ensure its final trust anchor is the separately pinned receipt root.
  const last = result.certificatePath[result.certificatePath.length - 1];
  requireValue(equal(Buffer.from(last.toSchema().toBER(false)), receiptRoot));
  const content = signed.encapContentInfo.eContent;
  requireValue(content instanceof asn1.OctetString);
  const attributes = boundedAsn(Buffer.from(content.getValue()), false);
  requireValue(attributes instanceof asn1.Set && attributes.valueBlock.value.length <= 32);
  const values = new Map<number, Buffer>();
  for (const item of attributes.valueBlock.value) {
    requireValue(item instanceof asn1.Sequence && item.valueBlock.value.length === 3);
    const [kind, version, value] = item.valueBlock.value;
    requireValue(kind instanceof asn1.Integer && version instanceof asn1.Integer && value instanceof asn1.OctetString);
    const id = kind.valueBlock.valueDec;
    requireValue(Number.isSafeInteger(id) && id > 0 && !values.has(id));
    values.set(id, Buffer.from(value.getValue()));
  }
  requireValue(values.get(2)?.toString('utf8') === appId && values.get(6)?.toString('utf8') === 'ATTEST');
  const createdText = values.get(12)?.toString('utf8') ?? '';
  requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdText));
  const created = new Date(createdText);
  requireValue(created.toISOString() === createdText && created.getTime() <= now.getTime() && now.getTime() - created.getTime() <= 300_000);
  const receiptCert = certificate(bytes(values.get(3), 16 * 1024));
  requireValue(equal(Buffer.from(receiptCert.subjectPublicKeyInfo.toSchema().toBER(false)), Buffer.from(leaf.subjectPublicKeyInfo.toSchema().toBER(false))));
  return created;
}

/** Internal seam used by signed synthetic fixture tests. Production exports fix both trust anchors. */
export async function verifyAttestationWithRoots(input: AppleAppAttestationInput, roots: { attestationRoot: Buffer; receiptRoot: Buffer }): Promise<VerifiedAppleAppAttestation> {
  try {
    const expected = policy(input), now = input.now ?? new Date();
    const envelope = map(decode(bytes(input.attestation, MAX_EVIDENCE)).value, ['fmt', 'attStmt', 'authData']);
    requireValue(envelope.get('fmt') === 'apple-appattest');
    const statement = map(envelope.get('attStmt'), ['x5c', 'receipt']);
    const presented = statement.get('x5c');
    requireValue(Array.isArray(presented));
    const certs = await chain(presented.map(value => bytes(value, 16 * 1024)), roots.attestationRoot, now);
    const leaf = certs[0], raw = bytes(envelope.get('authData'), 16 * 1024), data = authData(raw, true);
    const usage = leaf.extensions?.find(ext => ext.extnID === '2.5.29.37')?.parsedValue as pki.ExtKeyUsage | undefined;
    requireValue(usage?.keyPurposes.length === 1 && usage.keyPurposes[0] === CREDENTIAL_EKU);
    requireValue(equal(extensionOctets(leaf, NONCE_OID, 1), sha256(Buffer.concat([raw, expected.hash]))) && equal(extensionOctets(leaf, ACL_OID, 3), REQUIRED_MAC_ACL));
    const publicKey = publicPoint(Buffer.from(leaf.subjectPublicKeyInfo.toSchema().toBER(false)));
    requireValue(equal(sha256(publicKey.point), expected.keyId) && equal(data.credentialId!, expected.keyId) && equal(data.rpId, sha256(expected.appId)));
    requireValue(equal(Buffer.concat([Buffer.from([4]), bytes(data.cose!.get(-2), 32, 32), bytes(data.cose!.get(-3), 32, 32)]), publicKey.point));
    requireValue(input.allowedBundleVersions.includes(data.bundleVersion));
    const receipt = bytes(statement.get('receipt'), 96 * 1024);
    const receiptCreatedAt = await verifyReceipt(receipt, roots.receiptRoot, leaf, expected.appId, now);
    return { keyId: input.keyId, publicKeySpki: publicKey.spki, counter: 0, bundleVersion: data.bundleVersion, validationCategory: 6, environment: 'production', receipt, receiptCreatedAt };
  } catch (error) { if (error instanceof AppAttestVerificationError) throw error; throw new AppAttestVerificationError(); }
}
export function verifyAppleAppAssertion(input: AppleAppAssertionInput): VerifiedAppleAppAssertion {
  try {
    const expected = policy(input);
    requireValue(Number.isInteger(input.previousCounter) && input.previousCounter >= 0 && input.previousCounter <= 0xffffffff);
    const envelope = map(decode(bytes(input.assertion, MAX_EVIDENCE)).value, ['signature', 'authenticatorData']);
    const signature = bytes(envelope.get('signature'), 80), raw = bytes(envelope.get('authenticatorData'), 16 * 1024), data = authData(raw, false);
    boundedAsn(signature);
    const publicKey = publicPoint(bytes(input.publicKeySpki, 1024));
    requireValue(equal(sha256(publicKey.point), expected.keyId) && equal(data.rpId, sha256(expected.appId)) && data.counter > input.previousCounter && input.allowedBundleVersions.includes(data.bundleVersion));
    const nonce = sha256(Buffer.concat([raw, expected.hash]));
    requireValue(verify('sha256', nonce, { key: publicKey.spki, type: 'spki', format: 'der', dsaEncoding: 'der' }, signature));
    return { counter: data.counter, bundleVersion: data.bundleVersion, validationCategory: 6 };
  } catch (error) { if (error instanceof AppAttestVerificationError) throw error; throw new AppAttestVerificationError(); }
}
