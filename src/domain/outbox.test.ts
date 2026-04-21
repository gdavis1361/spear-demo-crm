// Outbox test floor (R1 of the Linear runtime audit).
//
// Covers the four correctness pillars the audit names explicitly:
//   1. Persist-across-reload: an enqueued row survives a process "restart"
//      (fresh Outbox instance reading the same IDB).
//   2. Drain is idempotent on opKey collision: a re-enqueue under an
//      opKey that's already durable is a no-op (no reset of attempt
//      counts, no double-send).
//   3. Permanent failure triggers the dispatcher's compensate hook AND
//      the onFailure subscriber.
//   4. Two concurrent drains don't double-fire a dispatcher — the
//      in-flight transition blocks the re-entry.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openSpearDb, STORE_OUTBOX, _resetDbConnectionForTests } from './events';
import {
  Outbox,
  type DispatcherRegistry,
  type DispatchResult,
  type OutboxMutation,
} from './outbox';

async function clearOutbox(): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Minimal dispatcher whose behavior each test drives via a script.
function scriptedDispatchers(
  script: Partial<Record<OutboxMutation['kind'], Array<DispatchResult>>>,
  onCompensate?: (m: OutboxMutation) => void
): DispatcherRegistry {
  const calls: Record<string, number> = {};
  const pull = <K extends OutboxMutation['kind']>(kind: K): DispatchResult => {
    const queue = script[kind] ?? [];
    const idx = (calls[kind] = (calls[kind] ?? 0) + 1) - 1;
    return queue[idx] ?? { ok: true };
  };
  const reg = {
    advance_deal: {
      dispatch: async (_m: Extract<OutboxMutation, { kind: 'advance_deal' }>) =>
        pull('advance_deal'),
      compensate: async (m: Extract<OutboxMutation, { kind: 'advance_deal' }>) => {
        onCompensate?.(m);
      },
    },
    dismiss_signal: {
      dispatch: async (_m: Extract<OutboxMutation, { kind: 'dismiss_signal' }>) =>
        pull('dismiss_signal'),
    },
    action_signal: {
      dispatch: async (_m: Extract<OutboxMutation, { kind: 'action_signal' }>) =>
        pull('action_signal'),
    },
  } as unknown as DispatcherRegistry;
  // Expose the call counter for assertions.
  (reg as unknown as { _calls: Record<string, number> })._calls = calls;
  return reg;
}

function errResult(code: string, retryable: boolean): DispatchResult {
  return {
    ok: false,
    retryable,
    error: {
      code: code as never,
      message: `synth ${code}`,
      requestId: 'req_test',
    },
  };
}

describe('Outbox', () => {
  let outbox: Outbox;

  beforeEach(async () => {
    _resetDbConnectionForTests();
    await clearOutbox();
  });

  afterEach(() => {
    outbox?.dispose();
  });

  it('enqueue persists the row and drain succeeds on first attempt', async () => {
    outbox = new Outbox(scriptedDispatchers({}));
    await outbox.enqueue({ kind: 'dismiss_signal', signalId: 'SIG-1' }, 'op_1');
    expect(await outbox.pendingCount()).toBe(1);

    const report = await outbox.drain();
    expect(report).toMatchObject({ attempted: 1, succeeded: 1, permanentFailures: 0 });
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('persist-across-reload: a fresh Outbox instance sees the same row', async () => {
    outbox = new Outbox(scriptedDispatchers({}));
    await outbox.enqueue({ kind: 'action_signal', signalId: 'SIG-42' }, 'op_persist');
    outbox.dispose();

    // Simulate a process restart — new Outbox, same IDB.
    const fresh = new Outbox(scriptedDispatchers({}));
    try {
      const rows = await fresh.all();
      expect(rows).toHaveLength(1);
      expect(rows[0].opKey).toBe('op_persist');
      expect(rows[0].mutation.kind).toBe('action_signal');
    } finally {
      fresh.dispose();
    }
  });

  it('idempotent enqueue: re-enqueueing the same opKey does not reset the row', async () => {
    // First enqueue; simulate one failed attempt so attemptCount > 0.
    const dispatchers = scriptedDispatchers({
      dismiss_signal: [errResult('internal_error', true)],
    });
    outbox = new Outbox(dispatchers, { baseBackoffMs: 10, jitterMs: 0 });

    await outbox.enqueue({ kind: 'dismiss_signal', signalId: 'SIG-retry' }, 'op_dup');
    await outbox.drain(); // fails, schedules retry
    const rowsAfterFail = await outbox.all();
    expect(rowsAfterFail[0].attemptCount).toBe(1);

    // Second enqueue with the same opKey — must NOT reset attemptCount or
    // flip the row back to brand-new. This is how a crash-and-replay flow
    // stays safe.
    await outbox.enqueue({ kind: 'dismiss_signal', signalId: 'SIG-retry' }, 'op_dup');
    const rowsAfterDup = await outbox.all();
    expect(rowsAfterDup).toHaveLength(1);
    expect(rowsAfterDup[0].attemptCount).toBe(1);
  });

  it('non-retryable error promotes to permanent_failure on first attempt', async () => {
    let compensated: OutboxMutation | null = null;
    const dispatchers = scriptedDispatchers(
      { advance_deal: [errResult('invalid_request', false)] },
      (m) => {
        compensated = m;
      }
    );
    outbox = new Outbox(dispatchers);

    const failures: OutboxMutation[] = [];
    outbox.onFailure((m) => failures.push(m));

    await outbox.enqueue(
      { kind: 'advance_deal', dealId: 'deal_1', toStage: 'quote', fromStage: 'scoping' },
      'op_perm'
    );
    const report = await outbox.drain();

    expect(report.permanentFailures).toBe(1);
    const rows = await outbox.all();
    expect(rows[0].status).toBe('permanent_failure');
    expect(compensated).not.toBeNull();
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe('advance_deal');
  });

  it('retryable errors back off and eventually hit maxAttempts → permanent_failure', async () => {
    const alwaysFail = Array.from({ length: 5 }, () => errResult('internal_error', true));
    const dispatchers = scriptedDispatchers({ dismiss_signal: alwaysFail });
    // Deterministic clock so we can tick past the backoff.
    let fakeNow = 0;
    outbox = new Outbox(dispatchers, {
      maxAttempts: 3,
      baseBackoffMs: 100,
      jitterMs: 0,
      now: () => fakeNow,
    });

    await outbox.enqueue({ kind: 'dismiss_signal', signalId: 'SIG-flap' }, 'op_flap');

    // Each drain makes one attempt, schedules nextAttemptAt = now + backoff.
    // Advance the clock past the backoff before the next drain so the row
    // is due again.
    let report = await outbox.drain();
    expect(report.retriedLater).toBe(1);
    fakeNow += 10_000;

    report = await outbox.drain();
    expect(report.retriedLater).toBe(1);
    fakeNow += 10_000;

    report = await outbox.drain();
    expect(report.permanentFailures).toBe(1);

    const rows = await outbox.all();
    expect(rows[0].status).toBe('permanent_failure');
    expect(rows[0].attemptCount).toBe(3);
  });

  it('stale threshold promotes an old pending row to permanent even before maxAttempts', async () => {
    const dispatchers = scriptedDispatchers({
      dismiss_signal: [errResult('internal_error', true)],
    });
    let fakeNow = 0;
    outbox = new Outbox(dispatchers, {
      maxAttempts: 100, // so only stale-threshold can promote
      baseBackoffMs: 10,
      jitterMs: 0,
      staleThresholdMs: 5_000,
      now: () => fakeNow,
    });

    await outbox.enqueue({ kind: 'dismiss_signal', signalId: 'SIG-stale' }, 'op_stale');
    // Jump past the stale window before the first drain so the error path
    // recognizes the row as stale.
    fakeNow += 10_000;
    const report = await outbox.drain();
    expect(report.permanentFailures).toBe(1);
  });

  it('idempotency_conflict is treated as success (server already has our mutation)', async () => {
    // If the server returns idempotency_conflict we should still delete the
    // row — our Idempotency-Key already landed a prior response. The
    // dispatcher is responsible for mapping that code; here we bake the
    // mapping directly into the scripted result.
    const dispatchers = scriptedDispatchers({ action_signal: [{ ok: true }] });
    outbox = new Outbox(dispatchers);

    await outbox.enqueue({ kind: 'action_signal', signalId: 'SIG-dup' }, 'op_conflict');
    const report = await outbox.drain();
    expect(report.succeeded).toBe(1);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('same-tab re-entrancy: a drain call while another drain is in flight returns skippedBusy', async () => {
    // Build a dispatcher whose first call doesn't resolve until we let it.
    let release: (r: DispatchResult) => void = () => undefined;
    const blocked = new Promise<DispatchResult>((r) => {
      release = r;
    });
    const dispatchers: DispatcherRegistry = {
      advance_deal: { dispatch: async () => blocked },
      dismiss_signal: { dispatch: async () => ({ ok: true }) },
      action_signal: { dispatch: async () => ({ ok: true }) },
    } as unknown as DispatcherRegistry;

    outbox = new Outbox(dispatchers);
    await outbox.enqueue(
      { kind: 'advance_deal', dealId: 'deal_re', toStage: 'quote', fromStage: 'scoping' },
      'op_re'
    );

    const first = outbox.drain();
    // Second call while first is still in flight.
    const second = await outbox.drain();
    expect(second.skippedBusy).toBe(true);

    release({ ok: true });
    const firstReport = await first;
    expect(firstReport.attempted).toBe(1);
  });

  it('Retry-After (VX3): rate-limit response delays the next attempt at least that long', async () => {
    // When a dispatcher returns `retryAfterMs` on a retryable error, the
    // outbox must schedule `nextAttemptAt` no earlier than now + that
    // value — even when the exponential backoff would have scheduled
    // sooner. Prevents us hammering a 429'd endpoint.
    const dispatchers: DispatcherRegistry = {
      advance_deal: {
        dispatch: async () => ({
          ok: false as const,
          retryable: true,
          retryAfterMs: 5_000,
          error: {
            code: 'rate_limited' as const,
            message: 'slow down',
            requestId: 'req_rl',
          },
        }),
      },
      dismiss_signal: { dispatch: async () => ({ ok: true }) },
      action_signal: { dispatch: async () => ({ ok: true }) },
    } as unknown as DispatcherRegistry;

    const fakeNow = 1_000_000;
    outbox = new Outbox(dispatchers, {
      baseBackoffMs: 100, // backoff alone would schedule ~100ms
      jitterMs: 0,
      now: () => fakeNow,
    });

    await outbox.enqueue(
      { kind: 'advance_deal', dealId: 'deal_rl', toStage: 'quote', fromStage: 'scoping' },
      'op_rl'
    );
    await outbox.drain();

    const rows = await outbox.all();
    expect(rows[0].status).toBe('pending');
    // Must be at least Retry-After (5000ms) past now, NOT just the 100ms
    // backoff. Fix reads as: "server said 5s, we respect 5s."
    expect(rows[0].nextAttemptAt).toBeGreaterThanOrEqual(fakeNow + 5_000);
  });

  it('onSuccess fires with mutation + attempts + requestId (VX5)', async () => {
    // DispatchOk carries requestId — the success subscriber thread is
    // the hook screens use to rebuild confirmation telemetry. Mirror
    // the advisor's spec: (mutation, attemptCount, requestId).
    const dispatchers: DispatcherRegistry = {
      advance_deal: {
        dispatch: async () => ({ ok: true, requestId: 'req_abc123' }),
      },
      dismiss_signal: { dispatch: async () => ({ ok: true }) },
      action_signal: { dispatch: async () => ({ ok: true }) },
    } as unknown as DispatcherRegistry;
    outbox = new Outbox(dispatchers);

    type SuccessCapture = {
      kind: string;
      attempts: number;
      requestId: string | undefined;
    };
    const successes: SuccessCapture[] = [];
    outbox.onSuccess((m, attempts, requestId) =>
      successes.push({ kind: m.kind, attempts, requestId })
    );

    await outbox.enqueue(
      { kind: 'advance_deal', dealId: 'deal_ok', toStage: 'quote', fromStage: 'scoping' },
      'op_ok'
    );
    await outbox.drain();

    expect(successes).toHaveLength(1);
    expect(successes[0]).toEqual({
      kind: 'advance_deal',
      attempts: 1,
      requestId: 'req_abc123',
    });
  });

  it('onSuccess reports attempts > 1 when earlier attempts retried (VX5)', async () => {
    // A mutation that flaps then succeeds reports the total attempt
    // count — valuable for SLO: a 2-attempt success is still a
    // success, but the dashboard should see the latency tail.
    const dispatchers: DispatcherRegistry = {
      advance_deal: {
        dispatch: (() => {
          let call = 0;
          return async () => {
            call++;
            if (call === 1) return errResult('internal_error', true);
            return { ok: true as const, requestId: 'req_final' };
          };
        })(),
      },
      dismiss_signal: { dispatch: async () => ({ ok: true }) },
      action_signal: { dispatch: async () => ({ ok: true }) },
    } as unknown as DispatcherRegistry;

    let fakeNow = 0;
    outbox = new Outbox(dispatchers, {
      baseBackoffMs: 10,
      jitterMs: 0,
      now: () => fakeNow,
    });
    const successes: Array<{ attempts: number }> = [];
    outbox.onSuccess((_m, attempts) => successes.push({ attempts }));

    await outbox.enqueue(
      { kind: 'advance_deal', dealId: 'deal_flap', toStage: 'quote', fromStage: 'scoping' },
      'op_flap_ok'
    );
    await outbox.drain(); // attempt 1 → retry
    fakeNow += 10_000;
    await outbox.drain(); // attempt 2 → success

    expect(successes).toHaveLength(1);
    expect(successes[0].attempts).toBe(2);
  });

  it('subscribe fires an initial snapshot and on every mutation', async () => {
    outbox = new Outbox(scriptedDispatchers({}));
    const snapshots: number[] = [];
    const off = outbox.subscribe((rows) => snapshots.push(rows.length));

    // Initial snapshot is async (reads IDB), so wait a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(snapshots[snapshots.length - 1]).toBe(0);

    await outbox.enqueue({ kind: 'dismiss_signal', signalId: 'SIG-sub' }, 'op_sub');
    expect(snapshots[snapshots.length - 1]).toBe(1);

    await outbox.drain();
    expect(snapshots[snapshots.length - 1]).toBe(0);

    off();
  });

  it('compensator that throws is treated as refused; subscribers fire with status=refused; row stays permanent', async () => {
    // A flapping compensator (IDB write refused, network flake, etc.)
    // must not (a) re-retry the server mutation, (b) silently look like
    // a successful compensation. The row should stay in
    // permanent_failure, subscribers must see status='refused', and the
    // exception must not bubble out of drain().
    const dispatchers: DispatcherRegistry = {
      advance_deal: {
        dispatch: async () => errResult('invalid_request', false),
        compensate: async () => {
          throw new Error('idb write refused');
        },
      },
      dismiss_signal: { dispatch: async () => ({ ok: true }) },
      action_signal: { dispatch: async () => ({ ok: true }) },
    } as unknown as DispatcherRegistry;

    outbox = new Outbox(dispatchers);
    type FailureCapture = {
      mutation: OutboxMutation;
      compensation: { status: string; reason?: string };
    };
    const failures: FailureCapture[] = [];
    outbox.onFailure((m, _err, comp) => failures.push({ mutation: m, compensation: comp }));

    await outbox.enqueue(
      { kind: 'advance_deal', dealId: 'deal_throws', toStage: 'won', fromStage: 'verbal' },
      'op_throws'
    );

    // Must not throw.
    await expect(outbox.drain()).resolves.toMatchObject({ permanentFailures: 1 });

    const rows = await outbox.all();
    expect(rows[0].status).toBe('permanent_failure');
    expect(failures).toHaveLength(1);
    expect(failures[0].compensation.status).toBe('refused');
    expect(failures[0].compensation.reason).toContain('idb write refused');
  });

  it('compensator returning {status: refused} propagates to onFailure subscribers unchanged', async () => {
    // Non-throwing refusal: the compensator knows this revert is illegal
    // (terminal destination, optimistic lock, etc.) and reports it
    // honestly. Subscribers must get the reason string verbatim so UX
    // can act on it.
    const dispatchers: DispatcherRegistry = {
      advance_deal: {
        dispatch: async () => errResult('invalid_request', false),
        compensate: async () => ({ status: 'refused' as const, reason: 'terminal stage' }),
      },
      dismiss_signal: { dispatch: async () => ({ ok: true }) },
      action_signal: { dispatch: async () => ({ ok: true }) },
    } as unknown as DispatcherRegistry;

    outbox = new Outbox(dispatchers);
    type FailureCapture = {
      compensation: { status: string; reason?: string };
    };
    const failures: FailureCapture[] = [];
    outbox.onFailure((_m, _err, comp) => failures.push({ compensation: comp }));

    await outbox.enqueue(
      { kind: 'advance_deal', dealId: 'deal_terminal', toStage: 'won', fromStage: 'verbal' },
      'op_terminal'
    );
    await outbox.drain();

    expect(failures).toHaveLength(1);
    expect(failures[0].compensation).toEqual({ status: 'refused', reason: 'terminal stage' });
  });

  it('orphan recovery (VX2): an in_flight row from a crashed tab is reset to pending on the next drain', async () => {
    // Simulate a tab that held the drain lock, flipped a row to
    // `in_flight`, then crashed before the dispatch resolved. The row
    // sits in IDB with `inFlightSince` older than the orphan threshold.
    // A later drain must detect this, reset to pending, and process
    // normally — without bumping attemptCount, since we don't know if
    // the server saw the mutation.
    const db = await openSpearDb();
    const now = 1_000_000;
    const inFlightSince = now - 10 * 60 * 1000; // 10min ago, past threshold
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      tx.objectStore(STORE_OUTBOX).put({
        opKey: 'op_orphan',
        mutation: { kind: 'dismiss_signal', signalId: 'SIG-orphan' },
        createdAt: new Date(inFlightSince).toISOString(),
        attemptCount: 0,
        nextAttemptAt: inFlightSince,
        status: 'in_flight',
        inFlightSince,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    outbox = new Outbox(scriptedDispatchers({}), {
      now: () => now,
      orphanThresholdMs: 5 * 60 * 1000,
    });

    const report = await outbox.drain();
    // The sweep reset the row, then the drain processed it in the same
    // pass, succeeding via the default (ok=true) scripted dispatcher.
    expect(report.attempted).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('orphan recovery does NOT touch an in_flight row still within the threshold', async () => {
    // A legitimately in-progress dispatch from this very tab must not
    // be clobbered. Gate on `inFlightSince` age strictly.
    const db = await openSpearDb();
    const now = 1_000_000;
    const inFlightSince = now - 30 * 1000; // 30s ago, within threshold
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      tx.objectStore(STORE_OUTBOX).put({
        opKey: 'op_fresh',
        mutation: { kind: 'dismiss_signal', signalId: 'SIG-fresh' },
        createdAt: new Date(inFlightSince).toISOString(),
        attemptCount: 0,
        nextAttemptAt: inFlightSince,
        status: 'in_flight',
        inFlightSince,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    outbox = new Outbox(scriptedDispatchers({}), {
      now: () => now,
      orphanThresholdMs: 5 * 60 * 1000,
    });

    const report = await outbox.drain();
    // The row stays in_flight, untouched. The drainer skipped it because
    // sweep didn't reset it and drain only touches `pending`.
    expect(report.attempted).toBe(0);
    const rows = await outbox.all();
    expect(rows[0].status).toBe('in_flight');
  });

  it('unknown mutation kind in storage (schema drift) promotes the row to permanent', async () => {
    // Simulate a row left over from a prior build that had a kind we no
    // longer register — without this guard, such a row would block every
    // subsequent drain. Direct IDB write to bypass enqueue's type union.
    const db = await openSpearDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      tx.objectStore(STORE_OUTBOX).put({
        opKey: 'op_drift',
        mutation: { kind: 'send_carrier_pigeon' as never, text: '…' },
        createdAt: new Date(0).toISOString(),
        attemptCount: 0,
        nextAttemptAt: 0,
        status: 'pending',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    outbox = new Outbox(scriptedDispatchers({}));
    const report = await outbox.drain();
    expect(report.permanentFailures).toBe(1);

    const rows = await outbox.all();
    expect(rows[0].status).toBe('permanent_failure');
  });
});
