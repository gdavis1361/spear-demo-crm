// Observability — Sentry for exceptions + web-vitals for Core Web Vitals.
//
// Designed to be a no-op when env vars are absent (local dev without a DSN
// stays console-only). Production builds with `VITE_SENTRY_DSN` set will
// send exceptions + breadcrumbs; web-vitals always emit through `track()`.

import * as Sentry from '@sentry/react';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

import { track } from './telemetry';

interface InitOptions {
  release?: string;
  environment?: string;
}

let sentryEnabled = false;

export function initObservability(opts: InitOptions = {}): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  const environment = opts.environment ?? (import.meta.env.MODE || 'development');
  const release =
    opts.release ?? (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.1.0';

  if (dsn) {
    Sentry.init({
      dsn,
      environment,
      release,
      // 10% of sessions get performance traces; exceptions always flow.
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      // Keep PII out by default. The app already redacts at `track()`; Sentry
      // should follow the same posture.
      sendDefaultPii: false,
      beforeSend(event) {
        // Drop breadcrumbs that would carry email/phone/name/address.
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((b) => ({
            ...b,
            data: b.data ? redact(b.data) : b.data,
          }));
        }
        return event;
      },
    });
    sentryEnabled = true;
  }

  // Web Vitals: always on. Routes through the existing telemetry buffer so
  // the sink is a single integration point and the SLO gate reads one source.
  const report = (m: Metric) => {
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
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (sentryEnabled) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  }
}

export function setTag(key: string, value: string): void {
  if (sentryEnabled) Sentry.setTag(key, value);
}

const PII_KEYS = new Set(['email', 'phone', 'name', 'address']);
function redact(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = PII_KEYS.has(k) ? '[redacted]' : v;
  }
  return out;
}
