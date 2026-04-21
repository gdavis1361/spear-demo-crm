// Event log v2 — Postgres-shaped storage for the durable layer.
//
// What changed from v1:
//   - ULID-keyed events instead of autoIncrement seq → distribution-safe
//   - `opKey` per mutation with UNIQUE (stream, opKey) → idempotency at storage
//   - Composite index `(stream, ulid)` → latest-N per stream is one cursor read
//   - Partial-by-prefix index `(prefix, ulid)` for cross-stream `kind` queries
//   - Zod validation on every append AND every read
//   - Dead-letter store for rows that fail Zod (preserves the broken payload)
//   - Versioned migrations branching on `oldVersion`
//   - BroadcastChannel cross-tab invalidation (`spear:events`)
//   - Optimistic-lock helper: read + validate + append in one IDB transaction
//   - `navigator.locks` wrapper for cross-tab serialization (graceful fallback)
//
// Per-stream `seq` survives as a *display* convenience, computed on read.

import type { DealId, AccountId, LeadId, SignalId } from '../lib/ids';
import { ulid, ulidTimestamp } from '../lib/ulid';
import { track } from '../app/telemetry';
import type { EventEnvelopeT, ValidatedPayload } from './event-schema';
import { validatePayload, validateEnvelope } from './event-schema';
import type {
  DealEvent as _DealEvent,
  AccountEvent as _AccountEvent,
  PromiseEvent as _PromiseEvent,
  ScheduleEvent as _ScheduleEvent,
  WorkflowRunEvent as _WorkflowRunEvent,
} from './event-types';

export type {
  DealEvent,
  AccountEvent,
  PromiseEvent,
  ScheduleEvent,
  WorkflowRunEvent,
  DomainEvent,
  EventName,
} from './event-types';

// ─── Stream keys ───────────────────────────────────────────────────────────

export type StreamKey = string & { readonly __brand: 'StreamKey' };

export const dealStream = (id: DealId | LeadId | AccountId) => `deal:${id}` as StreamKey;
export const accountStream = (id: AccountId) => `account:${id}` as StreamKey;
export const workflowRunStream = (wf: string, run: string) =>
  `workflow:${wf}:run:${run}` as StreamKey;
export const promiseStream = (id: string) => `promise:${id}` as StreamKey;
export const scheduleStream = (name: string) => `schedule:${name}` as StreamKey;

// ─── Envelope ──────────────────────────────────────────────────────────────

export interface StoredEvent<P extends ValidatedPayload = ValidatedPayload> {
  /** ULID — primary key. */
  readonly id: string;
  /** Per-stream monotonic counter (display only; derived on read). */
  readonly seq: number;
  /** Caller-provided idempotency key. UNIQUE (stream, opKey). */
  readonly opKey: string;
  readonly stream: StreamKey;
  /** Validated payload. The discriminator on `kind` matches DomainEvent. */
  readonly payload: P;
}

// Public-facing append input — caller provides the payload + opKey, the log
// assigns id (ULID), seq (per-stream), and stream tag.
export interface AppendInput {
  readonly opKey: string;
  readonly payload: ValidatedPayload;
}

export interface AppendOk {
  readonly ok: true;
  readonly events: readonly StoredEvent[];
}
export interface AppendIdempotent {
  readonly ok: true;
  readonly idempotent: true;
  readonly events: readonly StoredEvent[];
}
export interface AppendErr {
  readonly ok: false;
  readonly code: 'invalid_payload' | 'optimistic_lock_failure' | 'storage_error' | 'quota_exceeded';
  readonly message: string;
  readonly issues?: readonly string[];
}
export type AppendResult = AppendOk | AppendIdempotent | AppendErr;

// ─── Log interface ─────────────────────────────────────────────────────────

export interface EventLog {
  /**
   * Append events to a stream. Validates each payload via Zod first; if any
   * fails the entire batch is rejected (`invalid_payload`). UNIQUE (stream,
   * opKey) — appending with an existing opKey returns the prior result
   * (`idempotent: true`) instead of inserting a duplicate.
   */
  append(stream: StreamKey, events: readonly AppendInput[]): Promise<AppendResult>;

  /**
   * Conditional append: read the stream, project state via `expectStillValid`,
   * and only append if it returns true. Read + check + write happen inside
   * one IndexedDB transaction → no TOCTOU. On stale state returns
   * `optimistic_lock_failure`.
   */
  appendIf(
    stream: StreamKey,
    events: readonly AppendInput[],
    expectStillValid: (existing: readonly StoredEvent[]) => boolean
  ): Promise<AppendResult>;

  /**
   * Cross-store atomic primitive: append events AND upsert one row in a
   * sibling store, in a single IDB transaction. Either both commit or
   * neither does. Used by PromiseStore so a `promise.created` event can
   * never exist without its row (and vice versa).
   *
   * `onCommit` runs only after the IDB transaction's `oncomplete` fires,
   * so subscribers / telemetry / broadcast see consistent state.
   */
  appendAndUpsert<R extends { id: string }>(
    stream: StreamKey,
    events: readonly AppendInput[],
    sideStore: string,
    row: R,
    onCommit?: () => void
  ): Promise<AppendResult>;

  /** Read all events on a stream in ULID (= chronological) order. */
  read(stream: StreamKey): Promise<StoredEvent[]>;

  /** Read across streams whose key starts with `prefix`. */
  readPrefix(prefix: string): Promise<StoredEvent[]>;

  /** Total events. */
  size(): Promise<number>;

  /** Quarantined rows. */
  deadLetter(): Promise<readonly DeadLetterRow[]>;

  /** Reset (tests + "clear my data"). */
  clear(): Promise<void>;

  /** Cross-tab subscription. Fires `{ stream }` after every successful append. */
  subscribe(fn: (msg: { stream: StreamKey; ids: readonly string[] }) => void): () => void;
}

export interface DeadLetterRow {
  readonly id: string;
  readonly stream: string;
  readonly raw: unknown;
  readonly reason: string;
  readonly quarantinedAt: string;
}

// ─── In-memory backend (tests + SSR) ───────────────────────────────────────

export class InMemoryEventLog implements EventLog {
  private events: StoredEvent[] = [];
  private opKeys = new Set<string>();
  private dlq: DeadLetterRow[] = [];
  private subs = new Set<(m: { stream: StreamKey; ids: readonly string[] }) => void>();

  async append(stream: StreamKey, events: readonly AppendInput[]): Promise<AppendResult> {
    return this.doAppend(stream, events, () => true);
  }

  async appendIf(
    stream: StreamKey,
    events: readonly AppendInput[],
    expectStillValid: (existing: readonly StoredEvent[]) => boolean
  ): Promise<AppendResult> {
    return this.doAppend(stream, events, expectStillValid);
  }

  // Cross-store helper for the in-memory backend. The "side store" lives
  // in a Map keyed by store name; tests can inspect via `_peekSideRow`.
  private sideRows: Map<string, Map<string, unknown>> = new Map();

  async appendAndUpsert<R extends { id: string }>(
    stream: StreamKey,
    events: readonly AppendInput[],
    sideStore: string,
    row: R,
    onCommit?: () => void
  ): Promise<AppendResult> {
    const result = await this.doAppend(stream, events, () => true);
    if (!result.ok) return result;
    if (!this.sideRows.has(sideStore)) this.sideRows.set(sideStore, new Map());
    this.sideRows.get(sideStore)!.set(row.id, row);
    onCommit?.();
    return result;
  }

  /** Test helper for asserting cross-store atomicity in the in-memory backend. */
  _peekSideRow(sideStore: string, id: string): unknown {
    return this.sideRows.get(sideStore)?.get(id);
  }

  private async doAppend(
    stream: StreamKey,
    events: readonly AppendInput[],
    expectStillValid: (existing: readonly StoredEvent[]) => boolean
  ): Promise<AppendResult> {
    // Validate payloads first — atomic batch.
    const validated: { opKey: string; payload: ValidatedPayload }[] = [];
    for (const e of events) {
      const v = validatePayload(e.payload);
      if (!v.ok) {
        return {
          ok: false,
          code: 'invalid_payload',
          message: v.error.issues[0]?.message ?? 'invalid payload',
          issues: v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        };
      }
      validated.push({ opKey: e.opKey, payload: v.data });
    }

    // Idempotency: if any opKey already exists for this stream, treat the
    // whole batch as already-applied and return the matching prior rows.
    const existingByOpKey = new Map(
      this.events.filter((e) => e.stream === stream).map((e) => [e.opKey, e])
    );
    if (validated.every((v) => existingByOpKey.has(v.opKey))) {
      return {
        ok: true,
        idempotent: true,
        events: validated.map((v) => existingByOpKey.get(v.opKey)!),
      };
    }
    if (validated.some((v) => existingByOpKey.has(v.opKey))) {
      return {
        ok: false,
        code: 'invalid_payload',
        message: 'partial idempotency conflict in batch',
      };
    }

    // Optimistic check.
    const existing = this.events.filter((e) => e.stream === stream).sort(byUlid);
    if (!expectStillValid(existing)) {
      return { ok: false, code: 'optimistic_lock_failure', message: 'state changed since read' };
    }

    // Assign IDs + per-stream seqs.
    const baseSeq = existing.length;
    const stored: StoredEvent[] = validated.map((v, i) => ({
      id: ulid(),
      seq: baseSeq + i + 1,
      opKey: v.opKey,
      stream,
      payload: v.payload,
    }));
    for (const s of stored) {
      this.events.push(s);
      this.opKeys.add(`${stream}:${s.opKey}`);
    }
    this.notify(
      stream,
      stored.map((s) => s.id)
    );
    return { ok: true, events: stored };
  }

  async read(stream: StreamKey): Promise<StoredEvent[]> {
    return this.events.filter((e) => e.stream === stream).sort(byUlid);
  }

  async readPrefix(prefix: string): Promise<StoredEvent[]> {
    return this.events.filter((e) => (e.stream as string).startsWith(prefix)).sort(byUlid);
  }

  async size(): Promise<number> {
    return this.events.length;
  }
  async deadLetter(): Promise<readonly DeadLetterRow[]> {
    return this.dlq;
  }
  async clear(): Promise<void> {
    this.events = [];
    this.opKeys.clear();
    this.dlq = [];
  }

  subscribe(fn: (m: { stream: StreamKey; ids: readonly string[] }) => void): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
  private notify(stream: StreamKey, ids: readonly string[]): void {
    for (const s of this.subs) s({ stream, ids });
  }
}

function byUlid(a: StoredEvent, b: StoredEvent): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ─── IndexedDB backend ─────────────────────────────────────────────────────

const DB_NAME = 'spear-events';
const DB_VERSION = 4;
const STORE = 'events';
const STORE_DLQ = 'events_dlq';
export const STORE_PROMISES = 'promises';
export const STORE_PROMISES_DLQ = 'promises_dlq';
export const STORE_LEGACY_ARCHIVE = '_legacy_archive';

/**
 * Versioned migrations. Each branch is idempotent so re-runs are safe.
 * Adding a migration: bump `DB_VERSION`, add an `if (oldVersion < N)`
 * block. NEVER edit a past block — that's how Postgres treats migrations
 * and it's the only sane way to ship schema changes.
 */
function applyMigrations(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id' });
    }
  }
  if (oldVersion < 2) {
    // v2: add composite + partial indexes, dead-letter store, opKey UNIQUE.
    const store = tx.objectStore(STORE);
    if (!store.indexNames.contains('stream_id')) store.createIndex('stream_id', ['stream', 'id']);
    if (!store.indexNames.contains('opkey_unique'))
      store.createIndex('opkey_unique', ['stream', 'opKey'], { unique: true });
    if (!store.indexNames.contains('kind')) store.createIndex('kind', 'payload.kind');
    if (!db.objectStoreNames.contains(STORE_DLQ)) {
      db.createObjectStore(STORE_DLQ, { keyPath: 'id' });
    }
  }
  if (oldVersion < 3) {
    // v3: row-level promises store. Replaces the localStorage blob; the
    // legacy key (`spear:v1:promises`) is migrated on first read by
    // PromiseStore.hydrate(), then deleted.
    if (!db.objectStoreNames.contains(STORE_PROMISES)) {
      const ps = db.createObjectStore(STORE_PROMISES, { keyPath: 'id' });
      ps.createIndex('status_due', ['status', 'dueAt.iso']);
      ps.createIndex('due', 'dueAt.iso');
    }
  }
  if (oldVersion < 4) {
    // v4: persistent promise DLQ + legacy archive store + updated_at index
    // on promises. Row-level updated_at is bumped on every put.
    if (!db.objectStoreNames.contains(STORE_PROMISES_DLQ)) {
      db.createObjectStore(STORE_PROMISES_DLQ, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(STORE_LEGACY_ARCHIVE)) {
      db.createObjectStore(STORE_LEGACY_ARCHIVE, { keyPath: 'key' });
    }
    if (db.objectStoreNames.contains(STORE_PROMISES)) {
      const ps = tx.objectStore(STORE_PROMISES);
      if (!ps.indexNames.contains('updated_at')) ps.createIndex('updated_at', 'updatedAt.iso');
    }
  }
}

// ─── Connection cache ──────────────────────────────────────────────────────
// Singleton IDBDatabase. Postgres has a connection pool; we have one tab,
// one connection. Holding it across reads + writes saves the per-call
// `indexedDB.open()` cost. `onversionchange` lets a sibling tab perform an
// upgrade without our connection blocking it.

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      // If a sibling tab opens with a higher DB_VERSION, close so the
      // upgrade isn't blocked. The next caller re-opens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      // If the connection drops for any other reason, drop the cache too.
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onblocked = () => reject(new Error('[idb] open blocked by sibling connection'));
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = req.transaction!;
      applyMigrations(db, tx, (e as IDBVersionChangeEvent).oldVersion);
    };
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

/** Test-only: drop the cached connection so tests can simulate fresh tabs. */
export function _resetDbConnectionForTests(): void {
  dbPromise = null;
}

/**
 * Shared opener for callers that need to read/write other stores in the
 * same `spear-events` database (e.g. PromiseStore). One connection,
 * one migration story — same as a single Postgres connection pool.
 */
export const openSpearDb = openDb;

const CHANNEL_NAME = 'spear:events';

export class IndexedDbEventLog implements EventLog {
  private channel: BroadcastChannel | null =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

  async append(stream: StreamKey, events: readonly AppendInput[]): Promise<AppendResult> {
    return this.doAppend(stream, events, () => true);
  }

  async appendIf(
    stream: StreamKey,
    events: readonly AppendInput[],
    expectStillValid: (existing: readonly StoredEvent[]) => boolean
  ): Promise<AppendResult> {
    return this.doAppend(stream, events, expectStillValid);
  }

  async appendAndUpsert<R extends { id: string }>(
    stream: StreamKey,
    events: readonly AppendInput[],
    sideStore: string,
    row: R,
    onCommit?: () => void
  ): Promise<AppendResult> {
    return this.doAppend(stream, events, () => true, { sideStore, row, onCommit });
  }

  private async doAppend(
    stream: StreamKey,
    events: readonly AppendInput[],
    expectStillValid: (existing: readonly StoredEvent[]) => boolean,
    sideWrite?: { sideStore: string; row: { id: string }; onCommit?: () => void }
  ): Promise<AppendResult> {
    const validated: { opKey: string; payload: ValidatedPayload }[] = [];
    for (const e of events) {
      const v = validatePayload(e.payload);
      if (!v.ok) {
        return {
          ok: false,
          code: 'invalid_payload',
          message: v.error.issues[0]?.message ?? 'invalid payload',
          issues: v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        };
      }
      validated.push({ opKey: e.opKey, payload: v.data });
    }

    const db = await openDb();
    return new Promise<AppendResult>((resolve, reject) => {
      // Multi-store tx when sideWrite is set — both stores commit together.
      const stores = sideWrite ? [STORE, sideWrite.sideStore] : STORE;
      const tx = db.transaction(stores, 'readwrite', { durability: 'strict' });
      const store = tx.objectStore(STORE);
      const idx = store.index('stream_id');

      const range = IDBKeyRange.bound([stream, ''], [stream, '\uffff']);
      const existing: StoredEvent[] = [];
      const cursorReq = idx.openCursor(range);
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (cur) {
          existing.push(cur.value as StoredEvent);
          cur.continue();
          return;
        }

        // Idempotency check first (matches in-memory semantics).
        const existingByOpKey = new Map(existing.map((e) => [e.opKey, e]));
        if (validated.every((v) => existingByOpKey.has(v.opKey))) {
          resolve({
            ok: true,
            idempotent: true,
            events: validated.map((v) => existingByOpKey.get(v.opKey)!),
          });
          tx.abort();
          return;
        }
        if (validated.some((v) => existingByOpKey.has(v.opKey))) {
          resolve({
            ok: false,
            code: 'invalid_payload',
            message: 'partial idempotency conflict in batch',
          });
          tx.abort();
          return;
        }

        if (!expectStillValid(existing)) {
          resolve({
            ok: false,
            code: 'optimistic_lock_failure',
            message: 'state changed since read',
          });
          tx.abort();
          return;
        }

        const baseSeq = existing.length;
        const stored: StoredEvent[] = validated.map((v, i) => ({
          id: ulid(),
          seq: baseSeq + i + 1,
          opKey: v.opKey,
          stream,
          payload: v.payload,
        }));
        for (const s of stored) store.add(s);

        // Cross-store leg of the transaction. The IDB tx commits both
        // stores together; if either operation throws, neither commits.
        if (sideWrite) {
          tx.objectStore(sideWrite.sideStore).put(sideWrite.row);
        }

        tx.oncomplete = () => {
          const ids = stored.map((s) => s.id);
          this.channel?.postMessage({ stream, ids });
          this.notifyLocal(stream, ids);
          sideWrite?.onCommit?.();
          resolve({ ok: true, events: stored });
        };
        tx.onerror = () => {
          const name = tx.error?.name;
          let code: AppendErr['code'];
          if (name === 'ConstraintError') {
            // UNIQUE violation on opKey — surface as a duplicate.
            code = 'invalid_payload';
          } else if (name === 'QuotaExceededError') {
            // Device-level storage exhausted. Worst silent-failure mode in
            // a local-first app — emit a telemetry event so operators see
            // it without waiting for a user to report "my promises stopped
            // saving."
            code = 'quota_exceeded';
            void emitQuotaExhausted(stream);
          } else {
            code = 'storage_error';
          }
          resolve({ ok: false, code, message: tx.error?.message ?? 'storage error' });
        };
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }

  async read(stream: StreamKey): Promise<StoredEvent[]> {
    const db = await openDb();
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('stream_id');
      const range = IDBKeyRange.bound([stream, ''], [stream, '\uffff']);
      const req = idx.getAll(range);
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    return this.parseAndQuarantine(all);
  }

  async readPrefix(prefix: string): Promise<StoredEvent[]> {
    const db = await openDb();
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    const validated = await this.parseAndQuarantine(all);
    return validated.filter((e) => (e.stream as string).startsWith(prefix));
  }

  /**
   * Validate every row on read. Bad rows go to the dead-letter store with
   * the original payload preserved — the projection sees only validated
   * data, but operators can still recover what got corrupted.
   */
  private async parseAndQuarantine(rows: readonly unknown[]): Promise<StoredEvent[]> {
    const ok: StoredEvent[] = [];
    const bad: DeadLetterRow[] = [];
    for (const r of rows) {
      const v = validateEnvelope(r);
      if (v.ok) {
        ok.push(v.data as StoredEvent);
      } else {
        const id = (r as { id?: string })?.id ?? ulid();
        const stream = String((r as { stream?: string })?.stream ?? '?');
        bad.push({
          id,
          stream,
          raw: r,
          reason: v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          quarantinedAt: new Date().toISOString(),
        });
      }
    }
    if (bad.length > 0) await this.appendDeadLetter(bad);
    ok.sort(byUlid);
    return ok;
  }

  private async appendDeadLetter(rows: readonly DeadLetterRow[]): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DLQ, 'readwrite', { durability: 'strict' });
      const store = tx.objectStore(STORE_DLQ);
      for (const r of rows) store.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async size(): Promise<number> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deadLetter(): Promise<readonly DeadLetterRow[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DLQ, 'readonly');
      const req = tx.objectStore(STORE_DLQ).getAll();
      req.onsuccess = () => resolve(req.result as DeadLetterRow[]);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, STORE_DLQ], 'readwrite', { durability: 'strict' });
      tx.objectStore(STORE).clear();
      tx.objectStore(STORE_DLQ).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ─── Subscription (cross-tab) ─────────────────────────────────────────────

  private localSubs = new Set<(m: { stream: StreamKey; ids: readonly string[] }) => void>();

  subscribe(fn: (m: { stream: StreamKey; ids: readonly string[] }) => void): () => void {
    this.localSubs.add(fn);
    const onMsg = (e: MessageEvent) => fn(e.data);
    this.channel?.addEventListener('message', onMsg);
    return () => {
      this.localSubs.delete(fn);
      this.channel?.removeEventListener('message', onMsg);
    };
  }

  private notifyLocal(stream: StreamKey, ids: readonly string[]): void {
    for (const s of this.localSubs) s({ stream, ids });
  }
}

// ─── navigator.locks wrapper ───────────────────────────────────────────────
// Cross-tab serialization for read-validate-write sequences. Falls back to
// a no-op on browsers without Web Locks (older Safari, JSDOM).

export async function withStreamLock<T>(stream: StreamKey, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return navigator.locks.request(`spear:${stream}`, { mode: 'exclusive' }, fn);
  }
  return fn();
}

// ─── Default instance ──────────────────────────────────────────────────────

export const eventLog: EventLog =
  typeof indexedDB !== 'undefined' ? new IndexedDbEventLog() : new InMemoryEventLog();

// ─── Quota telemetry ───────────────────────────────────────────────────────
//
// `reportStorageEstimate()` is called on runtime boot. If we're ≥80% of
// quota, emit `storage.quota_near` so the operator sees pressure before any
// write hits `QuotaExceededError`. `emitQuotaExhausted()` is called from the
// IDB tx error handler when a write actually fails on quota — at that point
// the user has already lost a write.

const QUOTA_NEAR_THRESHOLD = 0.8;

export async function reportStorageEstimate(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage == null || quota == null || quota === 0) return;
    const percent = usage / quota;
    if (percent >= QUOTA_NEAR_THRESHOLD) {
      track({
        name: 'storage.quota_near',
        props: { usage, quota, percent: Math.round(percent * 1000) / 1000 },
      });
    }
  } catch {
    // Estimate is best-effort; never break boot on it.
  }
}

async function emitQuotaExhausted(stream: string): Promise<void> {
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage ?? null;
      quota = est.quota ?? null;
    }
  } catch {
    // ignore — estimate is advisory
  }
  track({ name: 'storage.quota_exhausted', props: { stream, usage, quota } });
}

// ─── Determinism helpers (used by replay tests + debug tooling) ────────────

export { ulidTimestamp };
