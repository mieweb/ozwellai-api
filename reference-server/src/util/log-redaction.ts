// Query parameters that carry credentials (OIDC callbacks, tokens) must never reach logs.
const SENSITIVE_QUERY_PARAMS = /^(code|state|token|access_token|id_token|refresh_token|key|api_key|apikey|session|session_token|password|secret|nonce|client_secret)$/i;

export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  let redacted = false;
  for (const name of new Set(params.keys())) {
    if (SENSITIVE_QUERY_PARAMS.test(name)) {
      params.set(name, '[REDACTED]');
      redacted = true;
    }
  }
  return redacted ? `${url.slice(0, queryStart)}?${params.toString()}` : url;
}
