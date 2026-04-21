// Durable outbox — the missing half of "local-first".
//
// The guarantee we want: a user who takes an action (advance a deal,
// dismiss a signal, send a quote) never loses that action. Not on a bad
// Wi-Fi moment, not on a crash, not on a sudden close of the tab. The
// local event log made *observable* state durable. The outbox does the
// same for *intents* — the fact that a mutation is supposed to reach
// the server, even when the server isn't reachable right now.
//
// Shape (Linear-style, opinionated):
//   - One IDB row per enqueued mutation, keyed on `opKey`. Double-enqueue
//     under the same key is a no-op by construction of the primary key.
//   - Typed discriminated union of mutations — adding a new API surface
//     means adding a member, a dispatcher entry, and (optionally) a
//     compensator. The compiler refuses anything less.
//   - Drainer holds a single-tab `navigator.locks` exclusive so two tabs
//     on the same DB don't hammer the server in parallel. Without the
//     lock, every open tab would double-submit after an online event.
//   - Retries exponentially back off with jitter. A row is promoted to
//     `permanent_failure` after MAX_ATTEMPTS or once it's older than
//     STALE_THRESHOLD_MS, whichever comes first — so a stuck mutation
//     can never fill IDB indefinitely.
//   - On permanent failure the dispatcher's `compensate()` hook runs
//     (writes a revert event, notifies the user, etc). Components can
//     also subscribe to `onFailure()` to react from the UI layer.
//
// What the outbox deliberately does NOT own:
//   - The *local* write. Callers still do the local event append (or
//     whatever optimistic UI update) BEFORE enqueueing. The outbox only
//     owns "get this to the server, reliably, eventually."
//   - Compensation logic. That's in the dispatcher registry, keeping
//     events.ts pure and the outbox reusable for non-event-sourced
//     mutations if we ever add them.

import type { ApiError, ErrorCode } from '../api/errors';
import { openSpearDb, STORE_OUTBOX, getDbName } from './events';
import { track } from '../app/telemetry';
import { startSpan } from '../app/observability';

// ─── Mutation catalogue ────────────────────────────────────────────────────

export type OutboxMutation =
  | {
      readonly kind: 'advance_deal';
      readonly dealId: string;
      readonly toStage: string;
      readonly fromStage: string;
    }
  | { readonly kind: 'dismiss_signal'; readonly signalId: string }
  | { readonly kind: 'action_signal'; readonly signalId: string };
// Add new kinds here AND to the DispatcherRegistry in outbox-dispatchers.ts.
// The compiler enforces parity via DispatcherRegistry's mapped type.

export type OutboxMutationKind = OutboxMutation['kind'];

// ─── Storage shape ─────────────────────────────────────────────────────────

export type OutboxStatus = 'pending' | 'in_flight' | 'permanent_failure';

export interface OutboxRow {
  readonly opKey: string;
  readonly mutation: OutboxMutation;
  /** ISO, for the 24h stale-threshold sweep. */
  readonly createdAt: string;
  readonly attemptCount: number;
  /** Epoch ms. Drainer only touches rows where nextAttemptAt <= now. */
  readonly nextAttemptAt: number;
  readonly lastError?: { readonly code: ErrorCode; readonly message: string };
  readonly status: OutboxStatus;
  /**
   * Epoch ms when a drain flipped this row to `in_flight`. Lets a later
   * drain detect orphans left behind by a crashed tab: if the lock
   * holder died mid-dispatch, this timestamp grows stale and we can
   * safely reset the row to `pending` instead of leaking it forever.
   * Only present while `status === 'in_flight'`.
   */
  readonly inFlightSince?: number;
}

// ─── Dispatcher registry ───────────────────────────────────────────────────

export type DispatchOk = {
  readonly ok: true;
  /**
   * Server request id when available. Threaded through to
   * `Outbox.onSuccess` subscribers so UI-level telemetry (e.g.
   * `pipeline.card_moved_confirmed`) can correlate with server logs
   * the same way the pre-outbox code did.
   */
  readonly requestId?: string;
};
export type DispatchErr = {
  readonly ok: false;
  readonly error: ApiError;
  /** False → promote to permanent_failure immediately (no retries). */
  readonly retryable: boolean;
  /**
   * Server-provided minimum delay before retrying, in ms (VX3). Usually
   * set when the dispatcher saw a `Retry-After` header on a 429 / 503.
   * The outbox schedules the next attempt at `max(backoff, retryAfterMs)`
   * so we don't hammer a rate-limited endpoint.
   */
  readonly retryAfterMs?: number;
};
export type DispatchResult = DispatchOk | DispatchErr;

/**
 * Compensator outcome. `refused` means the compensator ran but could not
 * undo the local optimistic state (e.g. the destination is terminal, or
 * a sibling tab already moved the entity further). Callers that surface
 * the failure to users should treat `refused` differently from
 * `compensated` — the first lies if we say "returned to original".
 */
export type CompensationResult =
  | { readonly status: 'compensated' }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'not_applicable' };

export interface DispatcherEntry<M extends OutboxMutation = OutboxMutation> {
  dispatch(mutation: M, opKey: string): Promise<DispatchResult>;
  /**
   * Runs after the row transitions to `permanent_failure`. Durable side
   * effects (writing a revert event, flipping a projection) live here.
   * UI-level compensation (un-dismissing a locally-hidden row) should
   * subscribe via `Outbox.onFailure()` instead — this callback has no
   * access to React state.
   *
   * Returns a `CompensationResult` so subscribers can distinguish
   * `"we reverted locally"` from `"we couldn't revert, state is stale"`.
   * Throwing is also allowed (same as `refused`, logged).
   */
  compensate?(mutation: M, error: ApiError): Promise<CompensationResult | void>;
}

export type DispatcherRegistry = {
  readonly [K in OutboxMutationKind]: DispatcherEntry<Extract<OutboxMutation, { kind: K }>>;
};

// ─── Tunables ──────────────────────────────────────────────────────────────

export const OUTBOX_DEFAULTS = {
  /** Hard cap on per-row attempts. Beyond this, `permanent_failure`. */
  maxAttempts: 10,
  /** Rows older than this are also promoted, regardless of attempt count. */
  staleThresholdMs: 24 * 60 * 60 * 1000, // 24h
  /** Base backoff for the first retry. */
  baseBackoffMs: 500,
  /** Ceiling so long-lived network outages don't balloon to hours between attempts. */
  maxBackoffMs: 60_000,
  /** Additional ms of random jitter added to every scheduled retry. */
  jitterMs: 250,
  /**
   * `in_flight` rows older than this are assumed to belong to a crashed
   * tab and get reset to `pending`. 5 minutes is ~10× the longest
   * realistic dispatch (API latency + its own retries) but short enough
   * that a crash on the night shift doesn't block the morning. The
   * reset is safe because opKey dedupes at the server — if the crashed
   * tab actually reached the server before dying, the retry is a no-op
   * there.
   */
  orphanThresholdMs: 5 * 60 * 1000,
} as const;

export interface OutboxOptions {
  readonly maxAttempts?: number;
  readonly staleThresholdMs?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly jitterMs?: number;
  readonly orphanThresholdMs?: number;
  /** Injected clock for deterministic tests. */
  readonly now?: () => number;
  /** Injected RNG for deterministic backoff jitter in tests. */
  readonly rng?: () => number;
}

// ─── Report shape ──────────────────────────────────────────────────────────

export interface DrainReport {
  readonly attempted: number;
  readonly succeeded: number;
  readonly retriedLater: number;
  readonly permanentFailures: number;
  /** True when the drain couldn't acquire the cross-tab lock. */
  readonly skippedBusy: boolean;
}

// ─── IDB primitives ────────────────────────────────────────────────────────

async function putRow(row: OutboxRow): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite', { durability: 'strict' });
    tx.objectStore(STORE_OUTBOX).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getRow(opKey: string): Promise<OutboxRow | null> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly');
    const req = tx.objectStore(STORE_OUTBOX).get(opKey);
    req.onsuccess = () => resolve((req.result ?? null) as OutboxRow | null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteRow(opKey: string): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite', { durability: 'strict' });
    tx.objectStore(STORE_OUTBOX).delete(opKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readAllRows(): Promise<readonly OutboxRow[]> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly');
    const req = tx.objectStore(STORE_OUTBOX).getAll();
    req.onsuccess = () => resolve(req.result as OutboxRow[]);
    req.onerror = () => reject(req.error);
  });
}

// ─── Cross-tab coordination ────────────────────────────────────────────────

function channelName(): string {
  return `spear:outbox:${getDbName()}`;
}
function lockName(): string {
  return `spear:outbox:drain:${getDbName()}`;
}

// ─── Outbox class ──────────────────────────────────────────────────────────

type Subscriber = (snapshot: readonly OutboxRow[]) => void;
type FailureSubscriber = (
  mutation: OutboxMutation,
  error: ApiError,
  compensation: CompensationResult,
  opKey: string
) => void;
type SuccessSubscriber = (
  mutation: OutboxMutation,
  attempts: number,
  requestId: string | undefined,
  ms: number,
  opKey: string
) => void;

export class Outbox {
  private readonly opts: Required<
    Pick<
      OutboxOptions,
      | 'maxAttempts'
      | 'staleThresholdMs'
      | 'baseBackoffMs'
      | 'maxBackoffMs'
      | 'jitterMs'
      | 'orphanThresholdMs'
    >
  > & { now: () => number; rng: () => number };
  private readonly dispatchers: DispatcherRegistry;
  private subs = new Set<Subscriber>();
  private failureSubs = new Set<FailureSubscriber>();
  private successSubs = new Set<SuccessSubscriber>();
  private channel: BroadcastChannel | null = null;
  private channelHandler: ((e: MessageEvent<unknown>) => void) | null = null;
  /**
   * Same-tab re-entrancy guard — without it, a kickstart-drain fired from
   * inside a permanent-failure subscription can overlap an in-progress
   * drain running later in the microtask queue. `navigator.locks` handles
   * cross-tab; this handles cross-call.
   */
  private draining = false;

  constructor(dispatchers: DispatcherRegistry, opts: OutboxOptions = {}) {
    this.dispatchers = dispatchers;
    this.opts = {
      maxAttempts: opts.maxAttempts ?? OUTBOX_DEFAULTS.maxAttempts,
      staleThresholdMs: opts.staleThresholdMs ?? OUTBOX_DEFAULTS.staleThresholdMs,
      baseBackoffMs: opts.baseBackoffMs ?? OUTBOX_DEFAULTS.baseBackoffMs,
      maxBackoffMs: opts.maxBackoffMs ?? OUTBOX_DEFAULTS.maxBackoffMs,
      jitterMs: opts.jitterMs ?? OUTBOX_DEFAULTS.jitterMs,
      orphanThresholdMs: opts.orphanThresholdMs ?? OUTBOX_DEFAULTS.orphanThresholdMs,
      now: opts.now ?? (() => Date.now()),
      rng: opts.rng ?? Math.random,
    };
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName());
      this.channelHandler = () => {
        // Another tab changed outbox state — refresh subscribers.
        // Cheap: readAllRows is small (bounded by maxAttempts × pending
        // mutation count; demo traffic never reaches four figures).
        void this.emitSnapshot();
      };
      this.channel.addEventListener('message', this.channelHandler);
    }
  }

  dispose(): void {
    if (this.channel && this.channelHandler) {
      this.channel.removeEventListener('message', this.channelHandler);
      this.channel.close();
    }
    this.channel = null;
    this.channelHandler = null;
    this.subs.clear();
    this.failureSubs.clear();
    this.successSubs.clear();
  }

  // ─── Enqueue ─────────────────────────────────────────────────────────────

  /**
   * Durable enqueue. Returns once the row is committed to IDB.
   *
   * Callers provide the `opKey` used for both the (already-written) local
   * event AND the server Idempotency-Key. This way a retry cannot race the
   * server into double-applying the mutation: same opKey → same server-
   * side row.
   *
   * If a row with this opKey already exists (duplicate enqueue / crash
   * replay), we treat it as a no-op — the caller already persisted it
   * once; hammering the row would reset attempt counts and mask stuck
   * mutations.
   */
  async enqueue(mutation: OutboxMutation, opKey: string): Promise<void> {
    const existing = await getRow(opKey);
    if (existing) return; // idempotent

    const now = this.opts.now();
    const row: OutboxRow = {
      opKey,
      mutation,
      createdAt: new Date(now).toISOString(),
      attemptCount: 0,
      nextAttemptAt: now, // drainable immediately
      status: 'pending',
    };
    await putRow(row);
    this.broadcast();
    await this.emitSnapshot();
  }

  // ─── Drain ───────────────────────────────────────────────────────────────

  /**
   * Attempt to send every due row to its dispatcher. Cross-tab exclusive
   * via `navigator.locks`. If another tab holds the lock, we return a
   * report with `skippedBusy: true` instead of queueing — the lock holder
   * will emit its own broadcast, and subscribers will see the updates
   * without double work.
   *
   * Non-retryable results and attempts past `maxAttempts` or the stale
   * threshold promote rows to `permanent_failure` and trigger the
   * dispatcher's `compensate()` hook.
   */
  async drain(): Promise<DrainReport> {
    if (this.draining) {
      return {
        attempted: 0,
        succeeded: 0,
        retriedLater: 0,
        permanentFailures: 0,
        skippedBusy: true,
      };
    }

    // Offline short-circuit: if we already know the network is down, don't
    // burn attempt counts. `online` event will re-kick the drainer.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        attempted: 0,
        succeeded: 0,
        retriedLater: 0,
        permanentFailures: 0,
        skippedBusy: false,
      };
    }

    this.draining = true;
    try {
      // H5: wrap the whole drain in a Sentry span so slow drains show up
      // in performance traces with their attempt/success/failure mix.
      // Returns the DrainReport synchronously via the promise boundary.
      return await (startSpan({ name: 'outbox.drain', op: 'outbox' }, async () => {
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
          return await new Promise<DrainReport>((resolve) => {
            void navigator.locks.request(lockName(), { ifAvailable: true }, async (lock) => {
              if (!lock) {
                resolve({
                  attempted: 0,
                  succeeded: 0,
                  retriedLater: 0,
                  permanentFailures: 0,
                  skippedBusy: true,
                });
                return;
              }
              const report = await this.drainInner();
              resolve(report);
            });
          });
        }
        // Fallback for environments without Web Locks (should never hit in
        // prod — every browser we target has it; this keeps tests runnable
        // on reduced polyfills).
        return await this.drainInner();
      }) as Promise<DrainReport>);
    } finally {
      this.draining = false;
    }
  }

  private async drainInner(): Promise<DrainReport> {
    const now = this.opts.now();

    // Orphan sweep (VX2): any row whose previous owner never came back
    // and reconciled the `in_flight` mark gets reset to `pending` so a
    // later drain can pick it up. Safe because the server Idempotency-
    // Key dedupes duplicate sends; the worst case is one extra wire call.
    await this.sweepOrphans(now);

    const rows = await readAllRows();

    let attempted = 0;
    let succeeded = 0;
    let retriedLater = 0;
    let permanentFailures = 0;

    for (const row of rows) {
      if (row.status !== 'pending') continue;
      if (row.nextAttemptAt > now) continue;

      attempted++;
      const outcome = await this.attemptOne(row);
      if (outcome === 'success') succeeded++;
      else if (outcome === 'retry') retriedLater++;
      else permanentFailures++;
    }

    await this.emitSnapshot();
    return { attempted, succeeded, retriedLater, permanentFailures, skippedBusy: false };
  }

  private async sweepOrphans(now: number): Promise<void> {
    const rows = await readAllRows();
    for (const row of rows) {
      if (row.status !== 'in_flight') continue;
      const startedAt = row.inFlightSince ?? 0;
      if (now - startedAt < this.opts.orphanThresholdMs) continue;
      // Orphan. Reset to pending, schedule immediate retry. Don't bump
      // attemptCount — whether the crashed tab's dispatch landed server-
      // side is unknowable, but the opKey makes a retry safe either way.
      const { inFlightSince, ...rest } = row;
      void inFlightSince; // unused intentionally
      await putRow({
        ...rest,
        status: 'pending',
        nextAttemptAt: now,
      });
      track({
        name: 'outbox.orphan_recovered',
        props: { kind: row.mutation.kind, ageMs: now - startedAt, opKey: row.opKey },
      });
    }
  }

  private async attemptOne(row: OutboxRow): Promise<'success' | 'retry' | 'permanent'> {
    const dispatcher = this.dispatchers[row.mutation.kind] as DispatcherEntry;
    if (!dispatcher) {
      // Registry missing an entry for a stored kind — treat as permanent
      // so a stale mutation queued under an old build can't block drains.
      await this.markPermanent(row, {
        code: 'invalid_request',
        message: `No dispatcher registered for ${row.mutation.kind}`,
        requestId: 'local',
      });
      return 'permanent';
    }

    // Mark in-flight so a concurrent drain (same tab) doesn't double-send.
    // Cross-tab drains are already gated by navigator.locks. Record when
    // we flipped the row so `sweepOrphans` can later detect a crashed
    // owner (VX2).
    await putRow({ ...row, status: 'in_flight', inFlightSince: this.opts.now() });

    let result: DispatchResult;
    try {
      // H5: per-dispatch span lets us see tail latency per mutation kind
      // without flooding: one span per wire call, attributed by kind +
      // attempt + opKey. Nests under the outer `outbox.drain` span.
      result = (await startSpan(
        {
          name: `dispatcher.${row.mutation.kind}`,
          op: 'outbox.dispatch',
          attributes: {
            'outbox.kind': row.mutation.kind,
            'outbox.attempt': row.attemptCount + 1,
            'outbox.op_key': row.opKey,
          },
        },
        () => dispatcher.dispatch(row.mutation, row.opKey)
      )) as DispatchResult;
    } catch (cause) {
      // Dispatcher threw (shouldn't — they should return DispatchErr). Treat
      // as a retryable network-ish failure.
      result = {
        ok: false,
        retryable: true,
        error: {
          code: 'internal_error',
          message: cause instanceof Error ? cause.message : 'dispatch threw',
          requestId: 'local',
          cause,
        },
      };
    }

    if (result.ok) {
      await deleteRow(row.opKey);
      this.broadcast();
      const attempts = row.attemptCount + 1;
      // H3: enqueue→confirm latency. `createdAt` is the wall-clock stamp
      // we wrote in `enqueue()`; subtracting now gives us the durable
      // end-to-end for this mutation, restoring the pre-outbox
      // `pipeline.card_moved_confirmed.ms` signal (but across the full
      // outbox lifecycle, not just the inline fetch).
      const ms = this.opts.now() - new Date(row.createdAt).getTime();
      track({
        name: 'outbox.mutation_succeeded',
        props: { kind: row.mutation.kind, attempts, ms, opKey: row.opKey },
      });
      // VX5: surface success to UI-layer subscribers so components can
      // emit their own confirmation telemetry (restoring the pre-outbox
      // `pipeline.card_moved_confirmed` shape) or drive any
      // success-only UX ("saved").
      for (const fn of this.successSubs) {
        try {
          fn(row.mutation, attempts, result.requestId, ms, row.opKey);
        } catch (cause) {
          console.error('[outbox] success subscriber threw', cause);
        }
      }
      return 'success';
    }

    const now = this.opts.now();
    const ageMs = now - new Date(row.createdAt).getTime();
    const nextAttemptCount = row.attemptCount + 1;
    const exceededAttempts = nextAttemptCount >= this.opts.maxAttempts;
    const exceededStale = ageMs >= this.opts.staleThresholdMs;

    if (!result.retryable || exceededAttempts || exceededStale) {
      await this.markPermanent(row, result.error, nextAttemptCount);
      return 'permanent';
    }

    // Schedule the next retry: max(exp-backoff + jitter, Retry-After).
    // Respecting the server's advisory (VX3) is table-stakes for 429s;
    // for any other retryable status the server didn't send a header
    // and retryAfterMs is undefined, so we fall through to plain backoff.
    const backoff = Math.min(
      this.opts.baseBackoffMs * 2 ** row.attemptCount,
      this.opts.maxBackoffMs
    );
    const jitter = Math.floor(this.opts.rng() * this.opts.jitterMs);
    const localDelay = backoff + jitter;
    const serverDelay = result.retryAfterMs ?? 0;
    const delay = Math.max(localDelay, serverDelay);
    await putRow({
      ...row,
      status: 'pending',
      attemptCount: nextAttemptCount,
      nextAttemptAt: now + delay,
      lastError: { code: result.error.code, message: result.error.message },
    });
    this.broadcast();
    track({
      name: 'outbox.mutation_retry_scheduled',
      props: {
        kind: row.mutation.kind,
        attempts: nextAttemptCount,
        nextAttemptInMs: delay,
        code: result.error.code,
        opKey: row.opKey,
      },
    });
    return 'retry';
  }

  private async markPermanent(
    row: OutboxRow,
    error: ApiError,
    attemptCount = row.attemptCount
  ): Promise<void> {
    const permRow: OutboxRow = {
      ...row,
      status: 'permanent_failure',
      attemptCount,
      lastError: { code: error.code, message: error.message },
    };
    await putRow(permRow);
    this.broadcast();

    track({
      name: 'outbox.mutation_permanent_failure',
      props: {
        kind: row.mutation.kind,
        attempts: attemptCount,
        code: error.code,
        requestId: error.requestId,
        opKey: row.opKey,
      },
    });

    // Run dispatcher compensation (durable side effect — append revert,
    // flip a flag, etc). Errors here are logged but not re-thrown — a
    // flapping compensator must not block other rows from draining. A
    // thrown compensator becomes a `refused` result so UI subscribers
    // can tell the truth ("state is stale") instead of the lie
    // ("returned to original").
    const dispatcher = this.dispatchers[row.mutation.kind] as DispatcherEntry;
    let compensation: CompensationResult = { status: 'not_applicable' };
    if (dispatcher?.compensate) {
      try {
        const result = await dispatcher.compensate(row.mutation, error);
        compensation = result ?? { status: 'compensated' };
      } catch (cause) {
        console.error('[outbox] compensate() threw', cause);
        compensation = {
          status: 'refused',
          reason: cause instanceof Error ? cause.message : 'compensate threw',
        };
      }
    }

    // Notify UI-level subscribers (React components that hold optimistic
    // local state and want to un-set it).
    for (const fn of this.failureSubs) {
      try {
        fn(row.mutation, error, compensation, row.opKey);
      } catch (cause) {
        console.error('[outbox] failure subscriber threw', cause);
      }
    }
  }

  // ─── Introspection / subscription ────────────────────────────────────────

  async all(): Promise<readonly OutboxRow[]> {
    return readAllRows();
  }

  async pendingCount(): Promise<number> {
    const rows = await readAllRows();
    return rows.filter((r) => r.status === 'pending').length;
  }

  async oldestPendingAgeMs(): Promise<number | null> {
    const rows = await readAllRows();
    const pending = rows.filter((r) => r.status === 'pending');
    if (pending.length === 0) return null;
    const oldest = pending.reduce((a, b) =>
      new Date(a.createdAt).getTime() < new Date(b.createdAt).getTime() ? a : b
    );
    return this.opts.now() - new Date(oldest.createdAt).getTime();
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    void this.emitSnapshot();
    return () => {
      this.subs.delete(fn);
    };
  }

  /**
   * Subscribe to permanent-failure notifications. Fires once per row that
   * transitions to `permanent_failure`, after the dispatcher's
   * `compensate()` has run.
   */
  onFailure(fn: FailureSubscriber): () => void {
    this.failureSubs.add(fn);
    return () => {
      this.failureSubs.delete(fn);
    };
  }

  /**
   * Subscribe to successful-dispatch notifications (VX5). Fires once
   * per row whose dispatcher returned `ok: true`. Handy for per-screen
   * confirmation telemetry that used to live inline at the API call
   * site — `pipeline.card_moved_confirmed` is the archetypal example.
   */
  onSuccess(fn: SuccessSubscriber): () => void {
    this.successSubs.add(fn);
    return () => {
      this.successSubs.delete(fn);
    };
  }

  /** Clear all rows. Test/admin. */
  async clear(): Promise<void> {
    const db = await openSpearDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite', { durability: 'strict' });
      tx.objectStore(STORE_OUTBOX).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    this.broadcast();
    await this.emitSnapshot();
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private async emitSnapshot(): Promise<void> {
    if (this.subs.size === 0) return;
    const snap = await readAllRows();
    for (const fn of this.subs) {
      try {
        fn(snap);
      } catch (cause) {
        console.error('[outbox] subscriber threw', cause);
      }
    }
  }

  private broadcast(): void {
    if (!this.channel) return;
    try {
      this.channel.postMessage({ kind: 'changed' });
    } catch {
      // Channel may have been closed between the check and post. Ignore.
    }
  }
}
