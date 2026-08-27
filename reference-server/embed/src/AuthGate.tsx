import { useEffect, useState } from 'react';

export type WidgetCredential = { key: string; source: 'session' | 'user-key' };

export const REMEMBERED_KEY_STORAGE = 'ozwell.widget.userKey';

/**
 * Shown only when the embedding page supplies no key. Offers email sign-in
 * (one-time code) or entry of the user's own agent/parent key.
 */
export function AuthGate({ apiOrigin, onAuthenticated }: {
  apiOrigin: string;
  onAuthenticated: (credential: WidgetCredential) => void;
}) {
  const [mode, setMode] = useState<'email' | 'key'>('email');
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [ownKey, setOwnKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // Only offer Google when the server has credentials configured.
  useEffect(() => {
    let cancelled = false;
    fetch(`${apiOrigin}/auth/methods`)
      .then((response) => response.json())
      .then((methods) => { if (!cancelled) setGoogleEnabled(!!methods?.google); })
      .catch(() => { /* leave it hidden */ });
    return () => { cancelled = true; };
  }, [apiOrigin]);

  /**
   * Google refuses to render its consent screen in an iframe, so sign-in runs
   * in a popup that posts the session token back to this window.
   */
  function signInWithGoogle() {
    setError(null);
    const popup = window.open(
      `${apiOrigin}/auth/oidc/google/start`,
      'ozwell-google-signin',
      'width=480,height=640,menubar=no,toolbar=no'
    );
    if (!popup) {
      setError('Popup blocked. Allow popups for this site, or use email sign-in.');
      return;
    }

    setBusy(true);
    function onMessage(event: MessageEvent) {
      if (event.origin !== apiOrigin) return;
      const data = event.data as { source?: string; session_token?: string; error?: string };
      if (data?.source !== 'ozwell-auth') return;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      setBusy(false);
      if (data.session_token) {
        onAuthenticated({ key: data.session_token, source: 'session' });
      } else {
        setError(`Google sign-in failed (${data.error || 'unknown'})`);
      }
    }
    window.addEventListener('message', onMessage);

    // If the user closes the popup without finishing, stop waiting.
    const closedTimer = setInterval(() => {
      if (!popup.closed) return;
      clearInterval(closedTimer);
      window.removeEventListener('message', onMessage);
      setBusy(false);
    }, 500);
  }

  async function post(path: string, body: unknown) {
    const response = await fetch(`${apiOrigin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Request failed (${response.status})`);
    }
    return payload;
  }

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const { challenge_id } = await post('/auth/otp/request', { email });
      setChallengeId(challenge_id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setBusy(true);
    setError(null);
    try {
      const { session_token } = await post('/auth/otp/verify', { challenge_id: challengeId, code });
      onAuthenticated({ key: session_token, source: 'session' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function useOwnKey() {
    const trimmed = ownKey.trim();
    if (!trimmed.startsWith('agnt_key-') && !trimmed.startsWith('ozw_')) {
      setError('Enter an agent key (agnt_key-...) or parent key (ozw_...)');
      return;
    }
    if (remember) {
      try { localStorage.setItem(REMEMBERED_KEY_STORAGE, trimmed); } catch { /* storage blocked */ }
    }
    onAuthenticated({ key: trimmed, source: 'user-key' });
  }

  return (
    <div className="ozwell-auth-gate">
      <div className="ozwell-auth-card">
        <h2 className="ozwell-auth-title">Sign in to Ozwell</h2>
        <p className="ozwell-auth-subtitle">Use your email, or bring your own Ozwell key.</p>

        {googleEnabled && (
          <div className="ozwell-auth-google">
            <button
              type="button"
              className="ozwell-auth-google-button"
              onClick={signInWithGoogle}
              disabled={busy}
            >
              Continue with Google
            </button>
            <div className="ozwell-auth-divider"><span>or</span></div>
          </div>
        )}

        <div className="ozwell-auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'email'}
            className={`ozwell-auth-tab${mode === 'email' ? ' is-active' : ''}`}
            onClick={() => { setMode('email'); setError(null); }}
          >
            Email sign-in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'key'}
            className={`ozwell-auth-tab${mode === 'key' ? ' is-active' : ''}`}
            onClick={() => { setMode('key'); setError(null); }}
          >
            Use my key
          </button>
        </div>

        {mode === 'email' && (challengeId === null ? (
          <div className="ozwell-auth-fields">
            <input
              className="ozwell-auth-input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && email) void requestCode(); }}
            />
            <button
              type="button"
              className="ozwell-auth-primary"
              onClick={() => void requestCode()}
              disabled={busy || !email}
            >
              {busy ? 'Sending...' : 'Send code'}
            </button>
          </div>
        ) : (
          <div className="ozwell-auth-fields">
            <p className="ozwell-auth-hint">We sent a 6-digit code to {email}.</p>
            <input
              className="ozwell-auth-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(event) => { if (event.key === 'Enter' && code.length === 6) void verifyCode(); }}
            />
            <button
              type="button"
              className="ozwell-auth-primary"
              onClick={() => void verifyCode()}
              disabled={busy || code.length !== 6}
            >
              {busy ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              className="ozwell-auth-link"
              onClick={() => { setChallengeId(null); setCode(''); setError(null); }}
            >
              Use a different email
            </button>
          </div>
        ))}

        {mode === 'key' && (
          <div className="ozwell-auth-fields">
            <input
              className="ozwell-auth-input"
              type="password"
              placeholder="agnt_key-... or ozw_..."
              value={ownKey}
              onChange={(event) => setOwnKey(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && ownKey.trim()) useOwnKey(); }}
            />
            <label className="ozwell-auth-checkbox">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Remember on this device
            </label>
            <p className="ozwell-auth-warning">
              Only remember your key on a trusted personal device — it is stored in this browser.
            </p>
            <button
              type="button"
              className="ozwell-auth-primary"
              onClick={useOwnKey}
              disabled={!ownKey.trim()}
            >
              Use key
            </button>
          </div>
        )}

        {error && <p className="ozwell-auth-error">{error}</p>}
      </div>
    </div>
  );
}
