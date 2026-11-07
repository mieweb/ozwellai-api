import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import cbor from 'cbor';
import { fixture } from './helpers/apple-app-attest-fixture.js';
import publicModule from '../dist/reference-server/src/util/apple-app-attest.js';
import internalModule from '../dist/reference-server/src/util/apple-app-attest-internal.js';

const { verifyAppleAppAttestation, verifyAppleAppAssertion, AppAttestVerificationError } = publicModule;
const { verifyAttestationWithRoots } = internalModule;
const rejected = error => error instanceof AppAttestVerificationError && error.message === 'App attestation verification failed.';
const f = await fixture();

test('signed attestation verifies all bindings and independently verifies its CMS receipt', async () => {
  const result = await verifyAttestationWithRoots(f.input, f.roots);
  assert.equal(result.keyId, f.input.keyId); assert.equal(result.counter, 0);
  assert.equal(result.environment, 'production'); assert.equal(result.validationCategory, 6); assert.equal(result.bundleVersion, '1');
  assert.ok(result.publicKeySpki.length > 64); assert.ok(result.receiptCreatedAt instanceof Date);
  await assert.rejects(verifyAppleAppAttestation(f.input), rejected, 'production never trusts the synthetic root');
});

test('attestation rejects wrong challenge, identity, key, version, and untrusted receipt root', async () => {
  for (const override of [
    { clientDataHash: randomBytes(32) }, { teamId: 'OTHER12345' }, { signingIdentifier: 'example.other' },
    { keyId: randomBytes(32).toString('base64') }, { keyId: f.input.keyId.replace(/=$/, '') }, { allowedBundleVersions: ['2'] },
  ]) await assert.rejects(verifyAttestationWithRoots({ ...f.input, ...override }, f.roots), rejected);
  const other = await fixture();
  await assert.rejects(verifyAttestationWithRoots(f.input, { ...f.roots, receiptRoot: other.roots.receiptRoot }), rejected);
});

test('valid signatures do not bypass macOS policy, environment, COSE, certificate constraints, or receipt binding', async () => {
  for (const options of [
    { badNonce: true }, { badAcl: true }, { omitAcl: true }, { category: 3 }, { development: true },
    { counter: 1 }, { wrongCose: true }, { unknownCritical: true }, { duplicateNonce: true }, { curve: 'P-384' },
    { leaf: { ca: true } }, { leaf: { notAfter: new Date(Date.now() - 1000) } },
    { issuer: { ca: false } },
    { receiptAge: 301_000 }, { receiptAge: -1000 }, { receiptAppId: 'OTHER12345.example.other' }, { receiptKeyMismatch: true },
  ]) {
    const candidate = await fixture(options);
    await assert.rejects(verifyAttestationWithRoots(candidate.input, candidate.roots), rejected, JSON.stringify(options));
  }
});

test('assertions require the exact signed request, matching key, increasing unsigned counter, and current distribution metadata', async () => {
  assert.deepEqual(verifyAppleAppAssertion(f.assertion()), { counter: 1, bundleVersion: '1', validationCategory: 6 });
  assert.equal(verifyAppleAppAssertion(f.assertion(0xffffffff)).counter, 0xffffffff);
  for (const input of [
    { ...f.assertion(), previousCounter: 1 }, { ...f.assertion(), previousCounter: -1 },
    { ...f.assertion(), clientDataHash: randomBytes(32) }, { ...f.assertion(), allowedBundleVersions: ['2'] },
    { ...f.assertion(), keyId: randomBytes(32).toString('base64') },
    f.assertion(1, { appId: 'OTHER12345.example.other' }), f.assertion(1, { wrongHash: true }), f.assertion(1, { omitExtensions: true }),
  ]) assert.throws(() => verifyAppleAppAssertion(input), rejected);
});

test('Apple unflagged extensions are parsed and enforced; malformed CBOR and DER fail closed', async () => {
  const unflagged = await fixture({ authData: { flags: 64 } });
  assert.equal((await verifyAttestationWithRoots(unflagged.input, unflagged.roots)).validationCategory, 6);
  const proof = f.assertion();
  const decoded = cbor.decodeFirstSync(proof.assertion);
  const duplicate = Buffer.concat([Buffer.from([0xa3]), cbor.encode('signature'), cbor.encode(decoded.signature), cbor.encode('signature'), cbor.encode(decoded.signature), cbor.encode('authenticatorData'), cbor.encode(decoded.authenticatorData)]);
  const indefiniteDer = cbor.encode({ ...decoded, signature: Buffer.from([0x30, 0x80, 0, 0]) });
  for (const assertion of [duplicate, indefiniteDer, Buffer.concat([Buffer.from([0xd9, 0x01, 0x03]), proof.assertion]), Buffer.concat([proof.assertion, Buffer.from([0])]), Buffer.alloc(128 * 1024 + 1), Buffer.from('81818181818181818181818181818181818100', 'hex')]) assert.throws(() => verifyAppleAppAssertion({ ...proof, assertion }), rejected);
  const modified = cbor.decodeFirstSync(f.input.attestation); modified.attStmt.x5c[0][modified.attStmt.x5c[0].length - 1] ^= 1;
  await assert.rejects(verifyAttestationWithRoots({ ...f.input, attestation: cbor.encode(modified) }, f.roots), rejected);
});
