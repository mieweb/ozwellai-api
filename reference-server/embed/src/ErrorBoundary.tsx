import { Component, type ErrorInfo, type ReactNode } from 'react';

type ClientErrorReport = {
  kind: 'render' | 'error' | 'unhandledrejection';
  message?: string;
  stack?: string;
  componentStack?: string;
  source?: string;
};

// Kept under the server's per-field limits and 16 KiB body limit, with room for JSON escaping.
const FIELD_LIMITS = { message: 1000, stack: 4000, componentStack: 2000, source: 300 } as const;
const MAX_BODY_BYTES = 12 * 1024;

function boundedBody(report: ClientErrorReport) {
  const bounded: ClientErrorReport = { kind: report.kind };
  for (const field of Object.keys(FIELD_LIMITS) as Array<keyof typeof FIELD_LIMITS>) {
    const value = report[field];
    if (typeof value === 'string') bounded[field] = value.slice(0, FIELD_LIMITS[field]);
  }
  let body = JSON.stringify(bounded);
  // Multi-byte text can still exceed the limit; shed the least useful detail first.
  for (const field of ['componentStack', 'stack', 'source'] as const) {
    if (new TextEncoder().encode(body).length <= MAX_BODY_BYTES) break;
    delete bounded[field];
    body = JSON.stringify(bounded);
  }
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    body = JSON.stringify({ kind: report.kind, message: bounded.message?.slice(0, 200) });
  }
  return body;
}

// The frame is served by the API server, so its own origin is the API origin.
export function reportClientError(report: ClientErrorReport) {
  try {
    const body = boundedBody(report);
    void fetch(`${window.location.origin}/v1/widget/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* reporting is best effort */ });
  } catch {
    // Never let error reporting raise its own error.
  }
}

export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    reportClientError({
      kind: 'error',
      message: event.message,
      stack: event.error instanceof Error ? event.error.stack : undefined,
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientError({
      kind: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason).slice(0, 500),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Ozwell] Widget render failed:', error, info.componentStack);
    reportClientError({
      kind: 'render',
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack || undefined,
    });
  }

  // A full document reload gives the host a fresh widget identity, so pending tool calls from the crashed session can't leak into the new one.
  private retry = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="ozwell-error-fallback">
        <p className="ozwell-error-title">Something went wrong displaying this conversation.</p>
        <p className="ozwell-error-detail">The error was reported. You can reload the chat to continue.</p>
        <button type="button" className="ozwell-error-retry" onClick={this.retry}>Reload chat</button>
      </div>
    );
  }
}
