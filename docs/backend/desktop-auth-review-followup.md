# Desktop authentication review follow-up

This records the seven unresolved Copilot findings on [PR #312](https://github.com/mieweb/ozwellai-api/pull/312).
The original review target was merged development commit
`2fb2a83dcbd89367779e71861bd375ad3e2ca02f`. The follow-up starts from freshly
fetched development commit `b105e071c95c53ae3f397b007540d07b9ab9716a`, the branch
containing that login implementation. The default `main` branch at
`fca761ea87a79eaeecdfe198bd113c40a5ebbd5c` does not yet contain it.

GitHub review threads remain open. A proposed fix in this follow-up is not a
claim that it has landed or that a thread has been resolved.

| Finding | Disposition | Evidence |
| --- | --- | --- |
| [Plain-session agent discovery documentation](https://github.com/mieweb/ozwellai-api/pull/312#discussion_r4184015226) | Valid; corrected in this follow-up | The plain-session route list omitted `GET /v1/agents`; only the separate attested-session list included it. The plain-session list now matches the authorization hook. |
| [Reference-server lockfile](https://github.com/mieweb/ozwellai-api/pull/312#discussion_r4199742172) | Addressed on current development branch | The original local lock lacked `asn1js`, `cbor` and `pkijs`. Commit `131f346` already synchronized it; this follow-up does not regenerate it. An offline `npm ci --dry-run --ignore-scripts` from the original workspace's reference-server directory succeeded using the root workspace lock, so the claimed CI installation failure was not reproduced there. |
| [No available browser sign-in methods](https://github.com/mieweb/ozwellai-api/pull/312#discussion_r4199742233) | Valid; corrected in this follow-up | A successful methods response with Google, Apple and email OTP disabled left the desktop page with neither controls nor an explanation. It now shows the existing unavailable-methods message. Browser regressions cover that state and each available provider independently. |
| [Assertion double-hash allegation](https://github.com/mieweb/ozwellai-api/pull/312#discussion_r4199887865) | Not reproduced; verifier behavior retained | Historical real signed Apple assertions were accepted by byte-identical verifier source, including the disputed nonce construction. The reports also record rejection of missing, replayed and changed-body proofs. See the evidence boundary below. |
| [API-key identity canonical contract](https://github.com/mieweb/ozwellai-api/pull/312#discussion_r4199887966) | Valid; corrected in this follow-up | Shared Zod request, response and error definitions replace a route-only contract and are exported from `/spec`; the route consumes those definitions. Existing identity ownership behavior remains the contract. |
| [Desktop authentication canonical contract](https://github.com/mieweb/ozwellai-api/pull/312#discussion_r4199888018) | Valid; corrected in this follow-up | Desktop authentication request, response and error schemas are exported from `/spec` and consumed by the routes. Contract tests and generated specification outputs cover the public endpoints. |
| [Assertion fixture signing allegation](https://github.com/mieweb/ozwellai-api/pull/312#discussion_r4199888060) | Not reproduced; fixture behavior retained | The fixture follows the same nonce input as the verifier exercised by the real signed acceptance. Swapping its positive and negative cases would contradict that evidence. Synthetic verification tests still reject the alternate signing input. |

## Apple assertion evidence boundary

[Apple's validation guide](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server)
constructs a nonce by hashing the concatenated authenticator data and client data
hash, then verifies the assertion signature against that nonce. The current
verifier and its fixture retain their existing nonce/signature behavior.
This server's accepted policy is production macOS Developer ID attestation with
approved signed category/version metadata, rather than a general-purpose mobile
App Attest verifier.

Two private, sanitized acceptance reports were inspected at:

- `8b03/ozwell-desktop/.ozwell-codeoss/local-api/apple-attestation-result.json`
  (2026-10-05 12:29 UTC).
- `8b03/ozwell-desktop/.ozwell-codeoss/local-api/combined-apple-attestation-result.json`
  (2026-10-05 18:53 UTC).

Both record real Apple enrollment and production native assertions for session
and catalog requests, increasing persisted counters, rejection of replay and
changed request bodies, and successful signed logout. The first report records
one earlier unconfirmed HTTP 400 followed by a diagnostic retry that passed
without source changes. The verifier in both historical server checkouts is
byte-identical to the disputed verifier at the original merged review target.
The SHA-256 of all four compared verifier files is
`ce45a34ca6c1f3ed82d56743374d81b8cbea85e3a8068b8e09bd810c3158a42e`.

These are historical reports, not a new Apple signing run or retained raw proof
material. The accounts were synthetic, no inference request ran, and the reports
do not establish real OAuth-provider completion or acceptance of a final release
artifact. Device receipts, keys and credentials are not committed here.

## Validation

The focused schema/route suite reproduced two missing-contract failures before
the change and passed 28 tests afterward. Independent review repeated those
28 tests plus five unchanged Apple verifier fixture tests. The route checks
exercise actual Fastify validation errors, an inherited custom error handler,
all seven endpoints' installed bound-session authorization hook, and unchanged
HTML/CSP, PKCE, revocation and identity ownership behavior. All 23 published
authentication schema references resolve, and the four generated specification
outputs match a fresh build.

Four Chromium provider-availability regressions pass using synthetic methods and
the production desktop component: no provider, Google, Apple and email OTP.
Full current-development build/server checks and the generated-bundle browser
rerun are still pending at this source commit.
