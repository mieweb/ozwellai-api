import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

type ClientErrorReport = {
  kind: 'render' | 'error' | 'unhandledrejection';
  message?: string;
  stack?: string;
  componentStack?: string;
  source?: string;
};

// The frame is served by the API server, so its own origin is the API origin.
export function reportClientError(report: ClientErrorReport) {
  try {
    const body = JSON.stringify(report);
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
  resetKey: number;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

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

  private retry = () => {
    this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }));
  };

  render() {
    if (!this.state.error) {
      return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
    }
    return (
      <div role="alert" className="ozwell-error-fallback">
        <p className="ozwell-error-title">Something went wrong displaying this conversation.</p>
        <p className="ozwell-error-detail">The error was reported. You can reload the chat to continue.</p>
        <button type="button" className="ozwell-error-retry" onClick={this.retry}>Reload chat</button>
      </div>
    );
  }
}
