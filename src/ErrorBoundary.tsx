import React from 'react';
import { newRequestId, type RequestId } from './lib/ids';
import { track } from './app/telemetry';

type Props = {
  children: React.ReactNode;
  fallback?: (args: { error: Error; requestId: RequestId; reset: () => void }) => React.ReactNode;
};

type State = { error: Error | null; requestId: RequestId | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, requestId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, requestId: newRequestId() };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const requestId = this.state.requestId ?? newRequestId();
    // Sentry/Bugsnag hook would go here:
    //   Sentry.captureException(error, { tags: { requestId } });
    console.error('[ErrorBoundary]', { error, info, requestId });
    track({ name: 'error.boundary', props: { message: error.message, requestId } });
  }

  reset = () => this.setState({ error: null, requestId: null });

  render() {
    const { error, requestId } = this.state;
    if (error && requestId) {
      if (this.props.fallback) return this.props.fallback({ error, requestId, reset: this.reset });
      return <DefaultFallback error={error} requestId={requestId} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({
  error,
  requestId,
  reset,
}: {
  error: Error;
  requestId: RequestId;
  reset: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — user can still select the code manually.
    }
  };

  return (
    <div role="alert" className="error-boundary">
      <h1 className="error-title">Something broke.</h1>
      <p className="error-body">
        We logged the error. If you need support, share this ID so we can trace the request end-to-end.
      </p>
      <div className="error-idrow">
        <code className="error-reqid">{requestId}</code>
        <button type="button" className="btn" onClick={copyId}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <details className="error-details">
        <summary>Technical details</summary>
        <pre className="error-stack">{error.message}{error.stack ? `\n\n${error.stack}` : ''}</pre>
      </details>
      <div className="error-actions">
        <button type="button" className="btn primary" onClick={reset}>Try again</button>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  );
}
