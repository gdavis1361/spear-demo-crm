// Live outbox-health hook (VX8). Surfaces the durable mutation queue's
// state to the UI so the rep sees "N changes waiting to sync" when the
// network is degraded — rather than learning about it on next refresh.
//
// Shape returned:
//   - pending: rows still trying to deliver
//   - permanent: rows that have given up (never retried without operator intervention)
//   - oldestPendingAgeMs: 0 when clean; grows when a specific mutation sticks
//   - status: derived traffic-light
//     - 'idle'         → nothing in flight
//     - 'syncing'      → pending rows, but nothing stale
//     - 'degraded'     → oldest pending > 60s OR there are permanent failures
//
// The hook subscribes to the Outbox's `subscribe()` (which already fires
// cross-tab via BroadcastChannel, so the badge reflects the union state
// across every tab on the same DB).
//
// Bundle discipline: this hook runs in the Topbar, which is in the
// initial entry chunk. It MUST NOT statically import `./runtime` —
// doing so pulls the entire durable layer (Outbox, dispatchers,
// PromiseStore, DealProjection, SignalProjection, ScheduleRegistry,
// Zod schemas) into the first paint. We dynamic-import the outbox
// singleton on mount so the badge renders instantly with a stub
// `idle` state and switches to live data once the lazy chunk lands.

import React from 'react';

export type OutboxStatus = 'idle' | 'syncing' | 'degraded';

export interface OutboxHealth {
  readonly pending: number;
  readonly permanent: number;
  readonly oldestPendingAgeMs: number;
  readonly status: OutboxStatus;
}

const DEGRADED_THRESHOLD_MS = 60_000;

function computeHealth(
  rows: ReadonlyArray<{ status: string; createdAt: string }>,
  now: number
): OutboxHealth {
  let pending = 0;
  let permanent = 0;
  let oldestPendingMs = 0;
  for (const r of rows) {
    if (r.status === 'pending' || r.status === 'in_flight') {
      pending++;
      const ageMs = now - new Date(r.createdAt).getTime();
      if (ageMs > oldestPendingMs) oldestPendingMs = ageMs;
    } else if (r.status === 'permanent_failure') {
      permanent++;
    }
  }
  const status: OutboxStatus =
    permanent > 0 || (pending > 0 && oldestPendingMs > DEGRADED_THRESHOLD_MS)
      ? 'degraded'
      : pending > 0
        ? 'syncing'
        : 'idle';
  return { pending, permanent, oldestPendingAgeMs: oldestPendingMs, status };
}

export function useOutboxHealth(): OutboxHealth {
  const [health, setHealth] = React.useState<OutboxHealth>(() => ({
    pending: 0,
    permanent: 0,
    oldestPendingAgeMs: 0,
    status: 'idle',
  }));

  React.useEffect(() => {
    let off: (() => void) | null = null;
    let id: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    void import('./runtime').then(({ outbox }) => {
      if (cancelled) return;
      const update = (rows: ReadonlyArray<{ status: string; createdAt: string }>): void => {
        setHealth(computeHealth(rows, Date.now()));
      };
      off = outbox.subscribe(update);
      // Also tick once a second so `oldestPendingAgeMs` and the derived
      // `status` grow in real time even when no new rows have landed.
      id = setInterval(() => {
        void outbox.all().then((rows) => update(rows));
      }, 1000);
    });

    return () => {
      cancelled = true;
      off?.();
      if (id) clearInterval(id);
    };
  }, []);

  return health;
}

// Pure helper exported for tests so they can assert `computeHealth`
// without driving an actual Outbox instance.
export const _computeHealthForTests = computeHealth;
