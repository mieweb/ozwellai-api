import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGate, type WidgetCredential } from './AuthGate';
import './widget.css';
import './desktop-login.css';

function DesktopLogin() {
  const [status, setStatus] = useState<'ready' | 'connecting' | 'failed'>('ready');
  const data = JSON.parse(document.getElementById('ozwell-desktop-config')?.textContent || '{}') as { flowId: string; clientName: string };
  async function authenticated(credential: WidgetCredential) {
    setStatus('connecting');
    try {
      if (credential.source !== 'session') throw new Error('Session required');
      const response = await fetch('/auth/desktop/complete', {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential.key}` },
        body: JSON.stringify({ flow_id: data.flowId }),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json() as { redirect_uri?: unknown };
      if (!response.ok || typeof payload.redirect_uri !== 'string') throw new Error('Handoff failed');
      const redirect = new URL(payload.redirect_uri);
      if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1' && redirect.pathname === '/oauth/callback')) throw new Error('Invalid callback');
      window.location.replace(redirect.toString());
    } catch {
      setStatus('failed');
    }
  }
  return <main className="ozwell-desktop-login-shell">
    <p className="ozwell-desktop-destination">Connect your Ozwell account to <strong>{data.clientName}</strong>.</p>
    {status === 'ready' ? <AuthGate apiOrigin={window.location.origin} allowUserKey={false} onAuthenticated={credential => { void authenticated(credential); }} /> :
      <section className="ozwell-auth-card" aria-live="polite">
        <h1>{status === 'connecting' ? 'Returning to Desktop…' : 'Could not finish sign-in'}</h1>
        <p>{status === 'connecting' ? 'Keep this window open while Ozwell Desktop receives your sign-in.' : 'Return to Ozwell Desktop and start sign-in again. This request may have expired or been replaced.'}</p>
      </section>}
    <p className="ozwell-desktop-help">Start sign-in from your own Ozwell Desktop app. Close this page if you did not request it.</p>
  </main>;
}

const root = document.getElementById('ozwell-desktop-login');
if (root) createRoot(root).render(<DesktopLogin />);
