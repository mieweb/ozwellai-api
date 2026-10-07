import { APPLE_APP_ATTEST_ROOT_DER, APPLE_RECEIPT_ROOT_DER } from './apple-app-attest-roots';
import { verifyAttestationWithRoots } from './apple-app-attest-internal';
import type { AppleAppAttestationInput, VerifiedAppleAppAttestation } from './apple-app-attest-internal';

export { AppAttestVerificationError, verifyAppleAppAssertion } from './apple-app-attest-internal';
export type { AppleAppAttestationInput, AppleAppAssertionInput, VerifiedAppleAppAttestation, VerifiedAppleAppAssertion } from './apple-app-attest-internal';

/** Native macOS production policy. Trust roots cannot be supplied by the caller. */
export function verifyAppleAppAttestation(input: AppleAppAttestationInput): Promise<VerifiedAppleAppAttestation> {
  return verifyAttestationWithRoots(input, { attestationRoot: APPLE_APP_ATTEST_ROOT_DER, receiptRoot: APPLE_RECEIPT_ROOT_DER });
}
