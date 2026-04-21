// Telemetry — typed events, buffered, flushed on idle + pagehide.
//
// Every business-relevant interaction goes through `track()`. The event
// schema is versioned here and should match the server-side contract.
// PII-scrubbing happens in `redactProps()` before anything leaves the
// process.

import type { Screen } from '../lib/types';
import type { ErrorCode } from '../api/errors';

// ─── Event catalogue ───────────────────────────────────────────────────────

export type TrackEvent =
  | { name: 'app.mounted'; props: { ground: string; density: string } }
  | {
      name: 'app.boot_failed';
      props: {
        stage: 'runtime' | 'migrate_legacy' | 'install_mock' | 'workflow_runner';
        message: string;
      };
    }
  | { name: 'rail.navigate'; props: { from: Screen; to: Screen; method: 'click' | 'keyboard' } }
  | { name: 'palette.opened'; props: { trigger: 'keyboard' | 'click' } }
  | { name: 'palette.selected'; props: { kind: 'verb' | 'noun'; queryLen: number } }
  | { name: 'peek.opened'; props: { kind: string; depth: number } }
  | { name: 'peek.dismissed'; props: { reason: 'escape' | 'backdrop' | 'close' | 'stack_pop' } }
  | {
      name: 'pipeline.card_moved';
      props: { dealId: string; from: string; to: string; optimistic: boolean };
    }
  | {
      name: 'pipeline.card_moved_confirmed';
      props: { dealId: string; from: string; to: string; ms: number; requestId: string };
    }
  | {
      name: 'pipeline.card_moved_failed';
      props: {
        dealId: string;
        from: string;
        to: string;
        ms: number;
        code: ErrorCode;
        requestId: string;
      };
    }
  | {
      name: 'honest_draft.inserted';
      props: { template: string; wordCount: number; checksPassed: number };
    }
  | { name: 'signal.dismissed'; props: { id: string; requestId: string } }
  | { name: 'signal.actioned'; props: { id: string; requestId: string } }
  | {
      name: 'promise.created';
      props: { id: string; nounKind: string; minutesToDue: number; hasEscalation: boolean };
    }
  | { name: 'promise.kept'; props: { id: string; minutesEarly: number } }
  | { name: 'promise.missed'; props: { id: string; minutesLate: number } }
  | { name: 'promise.escalated'; props: { id: string } }
  | {
      name: 'promise.store_hydrated';
      props: { rows: number; quarantined: number; migratedFromLegacy: number; ms: number };
    }
  | { name: 'promise.row_quarantined'; props: { id: string; reason: string } }
  | { name: 'error.boundary'; props: { message: string; requestId: string } }
  | {
      name: 'web_vital';
      props: {
        metric: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
        value: number;
        rating: 'good' | 'needs-improvement' | 'poor';
        delta: number;
        id: string;
        navigationType: string;
      };
    }
  | { name: 'storage.quota_near'; props: { usage: number; quota: number; percent: number } }
  | {
      name: 'storage.quota_exhausted';
      props: { stream: string; usage: number | null; quota: number | null };
    }
  | {
      name: 'seed.started';
      props: {
        scenario: string;
        rngSeed: number;
        clockMode: 'relative' | 'frozen';
        layers: string;
      };
    }
  | {
      name: 'seed.completed';
      props: { scenario: string; rngSeed: number; layers: string; elapsedMs: number };
    }
  | {
      name: 'seed.scenario_stale';
      props: { scenario: string; declaredVersion: number; currentVersion: number };
    };

export type TrackEventName = TrackEvent['name'];

// ─── Buffer + sender ───────────────────────────────────────────────────────

interface EnvelopeEntry {
  readonly name: TrackEventName;
  readonly props: Record<string, unknown>;
  readonly ts: string;
  readonly sessionId: string;
  readonly release: string;
}

const RELEASE = '0.1.0';
const sessionId =
  (typeof crypto !== 'undefined' && crypto.randomUUID?.()) || `sess_${Date.now().toString(36)}`;

const buffer: EnvelopeEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// PII fields we redact before sending. Keep this conservative — it's better
// to over-redact than leak.
const PII_KEYS = new Set(['email', 'phone', 'name', 'address']);

function redactProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = PII_KEYS.has(k) ? '[redacted]' : v;
  }
  return out;
}

export function track<E extends TrackEvent>(event: E): void {
  buffer.push({
    name: event.name,
    props: redactProps(event.props as Record<string, unknown>),
    ts: new Date().toISOString(),
    sessionId,
    release: RELEASE,
  });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 2_000);
}

export function flush(sync = false): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  const payload = JSON.stringify({ events: buffer.splice(0, buffer.length) });

  if (sync && 'sendBeacon' in navigator) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/telemetry', blob);
    return;
  }

  // Dev default: log to console so the schema is visible in the network tab.
  // Real app would POST to '/telemetry' via the API client.
  if (import.meta.env.DEV) {
    console.debug('[telemetry]', JSON.parse(payload));
    return;
  }

  // Production: fire-and-forget
  void fetch('/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    /* swallow — telemetry should never break the app */
  });
}

// Flush on page hide / unload.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true));
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}
