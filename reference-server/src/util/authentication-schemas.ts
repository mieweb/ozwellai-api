import type { FastifyInstance } from 'fastify';
import { buildJsonSchemas } from 'fastify-zod';
import {
  ApiKeyIdentityRequestSchema, ApiKeyIdentityResponseSchema, ApiKeyIdentityUnauthorizedResponseSchema,
  DesktopAuthorizeQuerySchema, DesktopAuthorizePageSchema,
  DesktopCompleteRequestSchema, DesktopCompleteResponseSchema,
  DesktopTokenRequestSchema, DesktopTokenResponseSchema, DesktopSessionResponseSchema,
  DesktopAttestationChallengeRequestSchema, DesktopAttestationChallengeResponseSchema,
  DesktopAttestationVerifyRequestSchema, DesktopRequestChallengeRequestSchema, DesktopRequestChallengeResponseSchema,
  AuthenticationBadRequestSchema, DesktopOAuthErrorSchema, DesktopUnauthorizedResponseSchema, HttpValidationErrorSchema,
} from '../../../spec';

const { schemas, $ref } = buildJsonSchemas({
  ApiKeyIdentityRequest: ApiKeyIdentityRequestSchema,
  ApiKeyIdentityResponse: ApiKeyIdentityResponseSchema,
  ApiKeyIdentityUnauthorizedResponse: ApiKeyIdentityUnauthorizedResponseSchema,
  DesktopAuthorizeQuery: DesktopAuthorizeQuerySchema,
  DesktopAuthorizePage: DesktopAuthorizePageSchema,
  DesktopCompleteRequest: DesktopCompleteRequestSchema,
  DesktopCompleteResponse: DesktopCompleteResponseSchema,
  DesktopTokenRequest: DesktopTokenRequestSchema,
  DesktopTokenResponse: DesktopTokenResponseSchema,
  DesktopSessionResponse: DesktopSessionResponseSchema,
  DesktopAttestationChallengeRequest: DesktopAttestationChallengeRequestSchema,
  DesktopAttestationChallengeResponse: DesktopAttestationChallengeResponseSchema,
  DesktopAttestationVerifyRequest: DesktopAttestationVerifyRequestSchema,
  DesktopRequestChallengeRequest: DesktopRequestChallengeRequestSchema,
  DesktopRequestChallengeResponse: DesktopRequestChallengeResponseSchema,
  HttpValidationError: HttpValidationErrorSchema,
  AuthenticationBadRequest: AuthenticationBadRequestSchema,
  DesktopOAuthError: DesktopOAuthErrorSchema,
  DesktopUnauthorizedResponse: DesktopUnauthorizedResponseSchema,
}, { $id: 'OzwellAuthentication', target: 'jsonSchema7' });

// Zod's default object mode accepts unknown fields and strips them on parse.
// The converter expresses that as additionalProperties:false, which rejects
// Fastify's Error instances (they also carry validation/validationContext) in
// anyOf selection. Leave this envelope open to validation; fast-json-stringify
// still emits only its declared properties when additionalProperties is absent.
const validationEnvelope = (schemas[0] as unknown as {
  properties: { HttpValidationError: { additionalProperties?: boolean } };
}).properties.HttpValidationError;
delete validationEnvelope.additionalProperties;

/** Register in the route's Fastify scope so validation, serialization and Swagger share /spec. */
export function registerAuthenticationSchemas(fastify: FastifyInstance): typeof $ref {
  for (const schema of schemas) {
    if (!fastify.getSchema(schema.$id)) fastify.addSchema(schema);
  }
  return $ref;
}
