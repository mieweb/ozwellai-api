import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, webcrypto } from 'node:crypto';
import * as asn1 from 'asn1js';
import * as pki from 'pkijs';
import cbor from 'cbor';

const cryptoEngine = new pki.CryptoEngine({ name: 'node', crypto: webcrypto, subtle: webcrypto.subtle });
const sha = bytes => createHash('sha256').update(bytes).digest();
const encode = value => Buffer.from(value.toBER(false));
const ext = (oid, value, critical = false) => new pki.Extension({ extnID: oid, critical, extnValue: encode(value) });
const appleOctets = (tagNumber, bytes) => new asn1.Sequence({ value: [new asn1.Constructed({ idBlock: { tagClass: 3, tagNumber }, value: [new asn1.OctetString({ valueHex: bytes })] })] });
const acl = Buffer.from('MEAMAjExMDowCQwCb2uhAwEB/zAJDAJvYaEDAQH/MAsMBG9kZWyhAwEB/zAVDARvc2duoAYMBHJzZWMwBaYDAgEB', 'base64');
let serial = 1;
async function issue(keys, name, issuer, issuerKeys, extra = [], options = {}) {
  const cert = new pki.Certificate();
  cert.version = 2; cert.serialNumber = new asn1.Integer({ value: serial++ });
  cert.subject.typesAndValues.push(new pki.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1.Utf8String({ value: name }) }));
  cert.issuer = issuer?.subject ?? cert.subject;
  cert.notBefore.value = options.notBefore ?? new Date(Date.now() - 86_400_000);
  cert.notAfter.value = options.notAfter ?? new Date(Date.now() + 86_400_000);
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey, cryptoEngine);
  cert.extensions = [
    ext('2.5.29.19', new pki.BasicConstraints({ cA: !!options.ca, ...(options.ca ? { pathLenConstraint: options.pathLength ?? 1 } : {}) }).toSchema(), true),
    ext('2.5.29.15', new asn1.BitString({ valueHex: Buffer.from([options.usage ?? (options.ca ? 6 : 128)]), unusedBits: options.ca ? 1 : 7 }), true),
    ...extra,
  ];
  await cert.sign((issuerKeys ?? keys).privateKey, 'SHA-256', cryptoEngine);
  return cert;
}
const keys = (curve = 'P-256') => webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, ['sign', 'verify']);

/** Entirely synthetic keys/certificates/receipts. The production verifier never accepts this root. */
export async function fixture(options = {}) {
  const now = new Date(), rootKeys = await keys(), intermediateKeys = await keys(), leafKeys = await keys(options.curve), receiptKeys = await keys();
  const root = await issue(rootKeys, 'Synthetic Test Root', null, null, [], { ca: true });
  const intermediate = await issue(intermediateKeys, 'Synthetic Test Issuer', root, rootKeys, [], { ca: true, pathLength: 0, ...options.issuer });
  const teamId = 'TEST123456', signingIdentifier = 'example.attestation';
  const appId = `${teamId}.${signingIdentifier}`;
  const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', leafKeys.publicKey));
  const key = createPublicKey({ key: spki, type: 'spki', format: 'der' }).export({ format: 'jwk' });
  const x = Buffer.from(key.x, 'base64url'), y = Buffer.from(key.y, 'base64url');
  const keyIdBytes = sha(Buffer.concat([Buffer.from([4]), x, y]));
  const clientDataHash = sha(randomBytes(32));
  const category = Buffer.alloc(4); category.writeUInt32LE(options.category ?? 6);
  const extensions = new Map([['apple_bundle_version_01', options.bundleVersion ?? '1'], ['apple_validation_category_01', category]]);
  const makeAuthData = (counter, initial = false, overrides = {}) => {
    const header = Buffer.alloc(37); sha(overrides.appId ?? appId).copy(header); header[32] = overrides.flags ?? (initial ? 192 : 128); header.writeUInt32BE(counter, 33);
    const aaguid = options.development ? Buffer.from('appattestdevelop') : Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
    const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, options.wrongCose ? randomBytes(32) : x], [-3, y]]);
    const credential = initial ? Buffer.concat([aaguid, Buffer.from([0, 32]), keyIdBytes, cbor.encode(cose)]) : Buffer.alloc(0);
    return Buffer.concat([header, credential, overrides.omitExtensions ? Buffer.alloc(0) : cbor.encode(extensions)]);
  };
  const authData = makeAuthData(options.counter ?? 0, true, options.authData);
  const nonce = options.badNonce ? randomBytes(32) : sha(Buffer.concat([authData, clientDataHash]));
  const leaf = await issue(leafKeys, 'Synthetic Credential', intermediate, intermediateKeys, [
    ext('2.5.29.37', new pki.ExtKeyUsage({ keyPurposes: ['1.2.840.113635.100.4.24'] }).toSchema()),
    ext('1.2.840.113635.100.8.2', appleOctets(1, nonce)),
    ...(options.duplicateNonce ? [ext('1.2.840.113635.100.8.2', appleOctets(1, nonce))] : []),
    ...(options.omitAcl ? [] : [ext('1.2.840.113635.100.8.6', appleOctets(3, options.badAcl ? Buffer.alloc(acl.length) : acl))]),
    ...(options.unknownCritical ? [ext('1.2.3.4.5.6.7', new asn1.OctetString({ valueHex: Buffer.from('unknown') }), true)] : []),
  ], options.leaf);
  const leafDer = encode(leaf.toSchema());
  const receiptCert = await issue(receiptKeys, 'Synthetic Receipt', intermediate, intermediateKeys);
  const attribute = (id, data) => new asn1.Sequence({ value: [new asn1.Integer({ value: id }), new asn1.Integer({ value: 1 }), new asn1.OctetString({ valueHex: typeof data === 'string' ? Buffer.from(data) : data })] });
  const receiptPayload = encode(new asn1.Set({ value: [
    attribute(2, options.receiptAppId ?? appId), attribute(3, options.receiptKeyMismatch ? encode(receiptCert.toSchema()) : leafDer),
    attribute(6, 'ATTEST'), attribute(12, new Date(now.getTime() - (options.receiptAge ?? 1000)).toISOString()),
  ] }));
  const signed = new pki.SignedData({ version: 1, encapContentInfo: new pki.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1', eContent: new asn1.OctetString({ valueHex: receiptPayload }) }), certificates: [receiptCert, intermediate, root], signerInfos: [new pki.SignerInfo({ version: 1, sid: new pki.IssuerAndSerialNumber({ issuer: receiptCert.issuer, serialNumber: receiptCert.serialNumber }) })] });
  await signed.sign(receiptKeys.privateKey, 0, 'SHA-256', undefined, cryptoEngine);
  const receipt = encode(new pki.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: signed.toSchema(true) }).toSchema());
  const attestation = cbor.encode({ fmt: 'apple-appattest', attStmt: { x5c: [leafDer, encode(intermediate.toSchema())], receipt }, authData });
  const keyObject = createPrivateKey({ key: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', leafKeys.privateKey)), type: 'pkcs8', format: 'der' });
  const input = { attestation, keyId: keyIdBytes.toString('base64'), clientDataHash, teamId, signingIdentifier, allowedBundleVersions: ['1'], now };
  return {
    input, roots: { attestationRoot: encode(root.toSchema()), receiptRoot: encode(root.toSchema()) },
    assertion(counter = 1, overrides = {}) {
      const authenticatorData = makeAuthData(counter, false, overrides);
      const nonce = sha(Buffer.concat([authenticatorData, clientDataHash]));
      const signature = sign('sha256', overrides.wrongHash ? Buffer.concat([authenticatorData, clientDataHash]) : nonce, keyObject);
      return { ...input, assertion: cbor.encode({ signature, authenticatorData }), publicKeySpki: spki, previousCounter: 0 };
    },
  };
}
