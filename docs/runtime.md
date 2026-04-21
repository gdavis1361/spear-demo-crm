# Runtime

The runtime layer ([`src/app/runtime.ts`](../src/app/runtime.ts)) wires the durable singletons to the React tree. `main.tsx` calls `bootRuntime()` exactly once before render.

## Boot sequence

```mermaid
sequenceDiagram
  participant main as main.tsx
  participant rt as runtime.ts
  participant ps as PromiseStore
  participant idb as IndexedDB
  participant sched as ScheduleRegistry
  participant vac as Vacuum runner
  main->>rt: import('./app/runtime').bootRuntime()
  rt->>ps: await promiseStore.ready
  ps->>idb: openSpearDb() → migrate v3→v4
  ps->>idb: read promises store + DLQ
  ps->>ps: legacy localStorage migration (archive → copy → verify → delete)
  rt->>ps: seedFixturesIfEmpty()
  rt->>ps: installPromiseTicker (15s)
  rt->>sched: registerSchedules (3 polls)
  rt->>vac: installVacuumRunner (hourly)
  rt-->>main: ready
```

## Singletons

| Singleton           | Location                                    | Purpose                                          |
| ------------------- | ------------------------------------------- | ------------------------------------------------ |
| `eventLog`          | [`src/domain/events.ts`](../src/domain/events.ts) | append-only event log over IDB                   |
| `promiseStore`      | [`src/domain/promises.ts`](../src/domain/promises.ts) | row-level IDB promise store with cross-tab sync |
| `scheduleRegistry`  | [`src/domain/schedules.ts`](../src/domain/schedules.ts) | per-source cadence + retry + dead-letter         |
| `runHistory`        | [`src/app/runtime.ts`](../src/app/runtime.ts) | recent workflow runs (in-memory; persisted via event log) |
| `vacuumRunner`      | [`src/domain/vacuum-runner.ts`](../src/domain/vacuum-runner.ts) | hourly idle-time TTL deletion                |

## Storage shape

IndexedDB v4 — five object stores:

| Store              | Key path | Indexes                                              |
| ------------------ | -------- | ---------------------------------------------------- |
| `events`           | `id`     | `stream_id`, `opkey_unique` (unique), `kind`         |
| `events_dlq`       | `id`     |                                                       |
| `promises`         | `id`     | `status_due`, `due`, `updated_at`                    |
| `promises_dlq`     | `id`     |                                                       |
| `_legacy_archive`  | `key`    | (originals of pre-v3 localStorage blobs)             |

All `readwrite` transactions use `{ durability: 'strict' }`.

## Cross-tab story

- `BroadcastChannel('spear:events')` posts after every successful event-log append.
- `BroadcastChannel('spear:promises')` posts after every promise upsert/delete/clear.
- `navigator.locks.request('spear:<stream>')` serializes deal transitions across tabs (no-op fallback in browsers without Web Locks).
