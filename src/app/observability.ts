// Observability — Sentry for exceptions + web-vitals for Core Web Vitals.
//
// `@sentry/react` is ~60 KB gzip; we dynamic-import it only when a
// `VITE_SENTRY_DSN` is configured at build time. Before this refactor we
// relied on Rollup's DCE to eliminate Sentry when the dsn branch was
// statically `undefined` — it worked, but it was fragile: one day
// someone lands a default DSN or a truthy test stub, and Sentry pops
// into the entry chunk without any PR signal.
//
// Now the lazy boundary is structural:
//   - `dsn === undefined` at build time → `import('@sentry/react')` stays
//     behind a never-entered `if`, and Rollup emits zero Sentry references
//     in the entry chunk. This is the dev/preview case.
//   - `dsn` is set at build time → Sentry lands in its own lazy chunk,
//     loaded once during `initObservability()`. The entry chunk stays
//     Sentry-free even in production.
//
// The `captureException` / `setTag` surface stays synchronous to callers.
// We route through a module-level slot that either has the real Sentry
// function (after async init) or a no-op.

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

import { track } from './telemetry';

interface InitOptions {
  release?: string;
  environment?: string;
}

type SentryCapture = (error: unknown, context?: { extra?: Record<string, unknown> }) => void;
type SentrySetTag = (key: string, value: string) => void;
type SpanAttributeValue = string | number | boolean | undefined;
type SentryStartSpan = <T>(
  ctx: { name: string; op?: string; attributes?: Record<string, SpanAttributeValue> },
  cb: () => T | Promise<T>
) => T | Promise<T>;

const noopCapture: SentryCapture = () => undefined;
const noopSetTag: SentrySetTag = () => undefined;
// No-op span just invokes the callback synchronously. This keeps
// non-Sentry builds byte-identical to pre-H5 behavior — the tracing
// boundary is structural (zero cost when DSN isn't configured).
const noopStartSpan: SentryStartSpan = (_ctx, cb) => cb();

// Mutable so the async init path can swap in the real implementations.
// Callers of `captureException` / `setTag` / `startSpan` are synchronous;
// they don't await initObservability and shouldn't have to.
let _capture: SentryCapture = noopCapture;
let _setTag: SentrySetTag = noopSetTag;
let _startSpan: SentryStartSpan = noopStartSpan;

export async function initObservability(opts: InitOptions = {}): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  const environment = opts.environment ?? (import.meta.env.MODE || 'development');
  const release =
    opts.release ?? (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.1.0';

  // Web Vitals: always on, always static. web-vitals is ~2 KB gzip and
  // runs in every build — no conditional loading payoff.
  const report = (m: Metric): void => {
    track({
      name: 'web_vital',
      props: {
        metric: m.name,
        value: Math.round(m.value * 100) / 100,
        rating: m.rating,
        delta: Math.round(m.delta * 100) / 100,
        id: m.id,
        navigationType: m.navigationType,
      },
    });
  };
  onLCP(report);
  onCLS(report);
  onINP(report);
  onFCP(report);
  onTTFB(report);

  // Sentry: only load when a DSN is configured. The dynamic import keeps
  // `@sentry/react` out of the entry chunk entirely — Rollup emits a
  // separate `sentry-*.js` chunk that the browser never fetches in
  // builds without a DSN.
  if (!dsn) return;
  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: b.data ? redact(b.data) : b.data,
        }));
      }
      return event;
    },
  });
  _capture = (error, context) => Sentry.captureException(error, context);
  _setTag = (key, value) => Sentry.setTag(key, value);
  _startSpan = ((ctx, cb) => Sentry.startSpan(ctx, cb)) as SentryStartSpan;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  _capture(error, context ? { extra: context } : undefined);
}

export function setTag(key: string, value: string): void {
  _setTag(key, value);
}

/**
 * Wrap a unit of work in a Sentry span when Sentry is live; invoke the
 * callback directly when it isn't. Used to trace long-running durable
 * operations — outbox drain, scenario seed, workflow run, boot stages —
 * without making Sentry a hard dependency.
 *
 * The return is passthrough: sync-returning callbacks yield a value,
 * async-returning callbacks yield a Promise. Caller decides.
 */
export function startSpan<T>(
  ctx: { name: string; op?: string; attributes?: Record<string, SpanAttributeValue> },
  cb: () => T | Promise<T>
): T | Promise<T> {
  return _startSpan(ctx, cb);
}

const PII_KEYS = new Set(['email', 'phone', 'name', 'address']);
function redact(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = PII_KEYS.has(k) ? '[redacted]' : v;
  }
  return out;
}
