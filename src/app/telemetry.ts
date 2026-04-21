// Telemetry — typed events, buffered, flushed on idle + pagehide.
//
// Every business-relevant interaction goes through `track()`. The event
// schema is versioned here and should match the server-side contract.
// PII-scrubbing happens in `redactProps()` before anything leaves the
// process.

import type { Screen } from '../lib/types';
import type { ErrorCode } from '../api/errors';
import { getAmbient, setLastOutboxDepth } from './ambient';
import {
  persistBatch,
  readPersistedBatches,
  deleteBatch,
  bumpAttempt,
  sweepStaleBatches,
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
  | {
      name: 'app.boot_stage_completed';
      props: {
        stage:
          | 'migrate_legacy'
          | 'install_mock'
          | 'seed_activation'
          | 'runtime'
          | 'workflow_runner'
          | 'promise_store_ready'
          | 'seed_scenario'
          | 'deal_bootstrap'
          | 'projection_rehydrate';
        ms: number;
      };
    }
  | {
      name: 'app.ready';
      props: { totalMs: number; firstPaintMs: number; scenario: string | null };
    }
  | { name: 'rail.navigate'; props: { from: Screen; to: Screen; method: 'click' | 'keyboard' } }
  | { name: 'palette.opened'; props: { trigger: 'keyboard' | 'click' } }
  | { name: 'palette.selected'; props: { kind: 'verb' | 'noun'; queryLen: number } }
  | { name: 'peek.opened'; props: { kind: string; depth: number } }
  | { name: 'peek.dismissed'; props: { reason: 'escape' | 'backdrop' | 'close' | 'stack_pop' } }
  | {
      name: 'pipeline.card_moved';
      props: { dealId: string; from: string; to: string; optimistic: boolean; opKey: string };
    }
  | {
      name: 'pipeline.card_moved_confirmed';
      props: {
        dealId: string;
        from: string;
        to: string;
        ms: number;
        requestId: string;
        opKey: string;
      };
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
        opKey: string;
      };
    }
  | {
      name: 'honest_draft.inserted';
      props: { template: string; wordCount: number; checksPassed: number };
    }
  | { name: 'signal.dismissed'; props: { id: string; requestId: string; opKey: string } }
  | { name: 'signal.actioned'; props: { id: string; requestId: string; opKey: string } }
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
  | {
      name: 'outbox.mutation_succeeded';
      props: { kind: string; attempts: number; ms: number; opKey: string };
    }
  | {
      name: 'outbox.mutation_retry_scheduled';
      props: {
        kind: string;
        attempts: number;
        nextAttemptInMs: number;
        code: string;
        opKey: string;
      };
    }
  | {
      name: 'outbox.mutation_permanent_failure';
      props: {
        kind: string;
        attempts: number;
        code: string;
        requestId: string;
        opKey: string;
      };
    }
  | { name: 'outbox.orphan_recovered'; props: { kind: string; ageMs: number; opKey: string } }
  | {
      name: 'outbox.queue_status';
      props: {
        pending: number;
        permanent: number;
        oldestPendingAgeMs: number;
        status: 'idle' | 'syncing' | 'degraded';
        reason: 'transition' | 'periodic';
      };
    }
  // Schedules (inbound polls + outbox.drain). Mirrors the event-log writes
  // in schedules.ts so operators can correlate poll health with outbound
  // API health in the same telemetry stream.
  | { name: 'schedule.started'; props: { name: string; runId: string } }
  | {
      name: 'schedule.succeeded';
      props: { name: string; runId: string; attempts: number; ms: number; items: number };
    }
  | {
      name: 'schedule.failed';
      props: {
        name: string;
        runId: string;
        attempts: number;
        code: string;
        message: string;
      };
    }
  | {
      name: 'schedule.dead_lettered';
      props: { name: string; runId: string; attempts: number };
    }
  // Workflow runner (PCS-cycle + friends). Surfaces run-level health so
  // dashboards can query by workflowId without replaying event streams.
  | {
      name: 'workflow.started';
      props: { workflowId: string; runId: string };
    }
  | {
      name: 'workflow.completed';
      props: {
        workflowId: string;
        runId: string;
        ms: number;
        steps: number;
        status: 'ok' | 'failed';
      };
    };

export type TrackEventName = TrackEvent['name'];

// ─── Buffer + sender ───────────────────────────────────────────────────────

interface BaseContext {
  readonly role: string;
  readonly screen: string;
  readonly viewport: string;
  readonly online: boolean;
  readonly seed: string | null;
  readonly outboxDepth: number;
}

interface EnvelopeEntry extends BaseContext {
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
// to over-redact than leak. H9 extends the original {email, phone, name,
// address} with the human-readable title fields our event types carry
// (`title`, `customer`, `dealTitle`, `headline`) — those often carry an
// account name or person's full name and leaking them would defeat the
// `sendDefaultPii: false` guarantee upstream in Sentry.
const PII_KEYS = new Set([
  'email',
  'phone',
  'name',
  'address',
  'title',
  'customer',
  'dealTitle',
  'headline',
]);

function redactProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = PII_KEYS.has(k) ? '[redacted]' : v;
  }
  return out;
}

/**
 * Wide-event base context (Honeycomb style). Every envelope carries this
 * so a single event has enough dimensions to partition by without joining
 * against another dataset — role and screen for segmentation, viewport
 * for device class, online for the offline-vs-online story, seed for
 * scenario isolation, outboxDepth for correlating UI action telemetry
 * with queue state at the moment of emission.
 *
 * Reads `ambient.ts` (module-level mirrors of React state) rather than
 * hooks, because `track()` is called from non-React callers too
 * (schedules, workflow-runner, observability, seeds, outbox, main.tsx).
 */
function baseContext(): BaseContext {
  const amb = getAmbient();
  const viewport =
    typeof window !== 'undefined' && window.innerWidth && window.innerHeight
      ? `${window.innerWidth}x${window.innerHeight}`
      : 'unknown';
  const online =
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;
  return {
    role: amb.role,
    screen: amb.screen,
    viewport,
    online,
    seed: amb.seed,
    outboxDepth: amb.lastOutboxDepth,
  };
}

export function track<E extends TrackEvent>(event: E): void {
  buffer.push({
    name: event.name,
    props: redactProps(event.props as Record<string, unknown>),
    ts: new Date().toISOString(),
    sessionId,
    release: RELEASE,
    ...baseContext(),
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
  // H10: sweep stale rows first so the drain loop doesn't waste retries
  // on events older than we'd accept on the server side anyway. This
  // also keeps the ring from accumulating indefinitely on a low-traffic
  // tab where `persistBatch()` never runs and never triggers trimRing.
  await sweepStaleBatches();
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

/**
 * Inverted-dependency setter: outbox publishes its depth here so
 * `baseContext()` can read it without importing runtime/outbox (which
 * would drag the durable layer into the entry chunk). Named `_` to
 * signal this is an internal telemetry-to-module wire, not a public API.
 */
export function _setLastOutboxDepth(n: number): void {
  setLastOutboxDepth(n);
}

// Flush on page hide / unload.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true));
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}
