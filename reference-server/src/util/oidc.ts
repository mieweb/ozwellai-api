export function publicOrigin(): string {
  const url = new URL(process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      !['http:', 'https:'].includes(url.protocol) ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new Error('PUBLIC_BASE_URL must be an origin, using HTTPS in production');
  }
  return url.origin;
}

export function popupResultPage(payload: Record<string, unknown>): string {
  const json = JSON.stringify({ source: 'ozwell-auth', ...payload }).replace(/</g, '\\u003c');
  const target = JSON.stringify(publicOrigin());
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ozwell sign-in</title></head>
<body><p>${payload.error ? 'Sign-in failed. You can close this window.' : 'Signed in. You can close this window.'}</p>
<script>try { window.opener && window.opener.postMessage(${json}, ${target}); } catch (error) {} window.close();</script>
</body></html>`;
}