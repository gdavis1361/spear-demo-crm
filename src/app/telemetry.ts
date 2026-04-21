// Telemetry — typed events, buffered, flushed on idle + pagehide.
//
// Every business-relevant interaction goes through `track()`. The event
// schema is versioned here and should match the server-side contract.
// PII-scrubbing happens in `redactProps()` before anything leaves the
// process.

import type { Screen } from '../lib/types';
import type { ErrorCode } from '../api/errors';
import {
  persistBatch,
  readPersistedBatches,
  deleteBatch,
  bumpAttempt,
  type PersistedBatch,
} from './telemetry-persistence';

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
    }
  // Outbox (durable mutation queue). Ties mutation-delivery health to the
  // SLO dashboard so a silent backlog is visible before a user notices.
  | { name: 'outbox.mutation_succeeded'; props: { kind: string; attempts: number } }
  | {
      name: 'outbox.mutation_retry_scheduled';
      props: { kind: string; attempts: number; nextAttemptInMs: number; code: string };
    }
  | {
      name: 'outbox.mutation_permanent_failure';
      props: { kind: string; attempts: number; code: string; requestId: string };
    }
  | { name: 'outbox.orphan_recovered'; props: { kind: string; ageMs: number } };

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
    // sendBeacon returns true only if the UA queued the request. If it
    // refuses (payload too large, closed connection), fall through to
    // persist so the events survive pagehide → next boot.
    const blob = new Blob([payload], { type: 'application/json' });
    const queued = navigator.sendBeacon('/telemetry', blob);
    if (!queued) {
      void persistBatch(payload);
    }
    return;
  }

  // Dev default: log to console so the schema is visible in the network tab.
  // Real app would POST to '/telemetry' via the API client.
  if (import.meta.env.DEV) {
    console.debug('[telemetry]', JSON.parse(payload));
    return;
  }

  // Production: POST, and on failure persist to the IDB ring so the
  // events survive reload (VX10). `keepalive: true` lets the request
  // outlive a page transition; `.catch` now writes durably instead of
  // silently dropping — the most valuable telemetry is the telemetry
  // you can't get after the fact.
  void fetch('/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  })
    .then((res) => {
      if (!res.ok) void persistBatch(payload);
    })
    .catch(() => {
      void persistBatch(payload);
    });
}

/**
 * Drain any telemetry batches that a previous session persisted after a
 * POST failure. Called at boot from `bootRuntime`. Each batch retries
 * independently; successful batches are removed, failures bump
 * `attemptCount` for observability and stay persisted until a future
 * drain succeeds.
 */
export async function drainPersistedTelemetry(): Promise<void> {
  const rows = await readPersistedBatches();
  if (rows.length === 0) return;
  for (const row of rows) {
    try {
      const res = await fetch('/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: row.payload,
        keepalive: true,
      });
      if (res.ok) {
        await deleteBatch(row.id);
      } else {
        await bumpAttempt(row);
      }
    } catch {
      await bumpAttempt(row);
    }
  }
}

/** Test helper: expose the persisted batches for assertions. */
export async function _readPersistedForTests(): Promise<readonly PersistedBatch[]> {
  return readPersistedBatches();
}

// Flush on page hide / unload.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true));
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}
