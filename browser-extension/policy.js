export const ALL_SITE_PATTERNS = ['http://*/*', 'https://*/*'];
export const DEFAULT_SETTINGS = Object.freeze({ mode: 'manual', domains: [], resumeMode: 'manual' });
const MODES = new Set(['manual', 'allowlist', 'always', 'off']);
const RESUME_MODES = new Set(['manual', 'allowlist', 'always']);

export function pageInfo(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { url: url.href, hostname: url.hostname, supported: true };
    }
  } catch { /* Browser pages and missing URLs are unsupported. */ }
  return { url: value || '', hostname: '', supported: false };
}

export function normalizeDomain(value) {
  const input = String(value).trim();
  if (!input || /[\s*]/.test(input)) throw new Error(`Invalid domain: ${input}`);
  const page = pageInfo(input.includes('://') ? input : `https://${input}`);
  const url = page.supported && new URL(page.url);
  if (!url || url.username || url.password || !url.hostname || url.hostname.endsWith('.')) {
    throw new Error(`Use an exact domain or an http(s) URL: ${input}`);
  }
  return url.hostname;
}

export function normalizeSettings(value) {
  if (!value || !MODES.has(value.mode) || !Array.isArray(value.domains)) {
    throw new Error('Choose a mode and provide a domain list.');
  }
  if (value.resumeMode !== undefined && !RESUME_MODES.has(value.resumeMode)) {
    throw new Error('Choose a valid mode to resume.');
  }
  return {
    mode: value.mode,
    domains: [...new Set(value.domains.map(normalizeDomain))].sort(),
    resumeMode: value.mode === 'off' ? (value.resumeMode ?? 'manual') : value.mode,
  };
}

export function patternsForSettings(settings) {
  if (settings.mode === 'always') return [...ALL_SITE_PATTERNS];
  if (settings.mode === 'allowlist') return settings.domains.map(domain => `*://${domain}/*`);
  return [];
}

export function isEnabled(settings, url, override) {
  const page = pageInfo(url);
  if (!page.supported || settings.mode === 'off') return false;
  if (typeof override === 'boolean') return override;
  return settings.mode === 'always' ||
    (settings.mode === 'allowlist' && settings.domains.includes(page.hostname));
}
