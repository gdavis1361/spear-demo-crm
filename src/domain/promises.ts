// Durable promises — the CRM's soul: "the queue ranks by what you promised."
//
// A promise is a first-class timer:
//   - persisted as one row per promise in IndexedDB (`promises` object store)
//   - row carries `createdAt` AND `updatedAt` (Postgres-style discipline)
//   - mutations serialized via `withStreamLock` to close the read-modify-write
//     TOCTOU window
//   - cross-store atomic write via `EventLog.appendAndUpsert` so a `promise.created`
//     event can never exist without its row, and vice versa
//   - the ticker fires `due` and `escalate` transitions
//   - cross-tab subscribers get per-row invalidations via BroadcastChannel
//   - validated on every IDB read; bad rows quarantined to a persistent
//     `promises_dlq` IDB store (survives reload)
//   - inbound broadcast envelopes validated via Zod
//
// Stripe-grade lifecycle: `ready: Promise<void>` resolves once the in-memory
// cache is consistent with IDB. Mutations return typed `PromiseResult<…>`.

import type { Instant } from '../lib/time';
import { now as nowInstant } from '../lib/time';
import type { NounRef, RepId } from '../lib/types';
import { repId } from '../lib/ids';
import type { EventLog } from './events';
import {
  promiseStream,
  openSpearDb,
  withStreamLock,
  STORE_PROMISES,
  STORE_PROMISES_DLQ,
  STORE_LEGACY_ARCHIVE,
  getDbName,
} from './events';
import {
  validateDurablePromise,
  PromiseBroadcastSchema,
  type DurablePromiseT,
  type PromiseBroadcastT,
} from './event-schema';
import { track } from '../app/telemetry';

export type PromiseStatus = 'pending' | 'kept' | 'missed' | 'escalated';

export interface DurablePromise {
  readonly id: string;
  readonly noun: NounRef;
  readonly text: string;
  readonly dueAt: Instant;
  readonly escalateAt?: Instant;
  readonly createdBy: RepId;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  status: PromiseStatus;
}

export interface DeadLetterPromise {
  readonly id: string;
  readonly raw: unknown;
  readonly reason: string;
  readonly quarantinedAt: string;
}

// ─── Result types ──────────────────────────────────────────────────────────

export interface PromiseOk<T = void> {
  readonly ok: true;
  readonly data: T;
}
export interface PromiseErr {
  readonly ok: false;
  readonly code: 'not_found' | 'invalid_state' | 'storage_error';
  readonly message: string;
}
export type PromiseResult<T = void> = PromiseOk<T> | PromiseErr;

// ─── IDB primitives (CRUD over rows) ───────────────────────────────────────

async function readAllRows(): Promise<unknown[]> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROMISES, 'readonly');
    const req = tx.objectStore(STORE_PROMISES).getAll();
    req.onsuccess = () => resolve(req.result as unknown[]);
    req.onerror = () => reject(req.error);
  });
}

async function putRow(p: DurablePromise): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROMISES, 'readwrite', { durability: 'strict' });
    tx.objectStore(STORE_PROMISES).put(p);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteRow(id: string): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROMISES, 'readwrite', { durability: 'strict' });
    tx.objectStore(STORE_PROMISES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearStore(): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROMISES, 'readwrite', { durability: 'strict' });
    tx.objectStore(STORE_PROMISES).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Persistent DLQ ────────────────────────────────────────────────────────

async function dlqAppend(rows: readonly DeadLetterPromise[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROMISES_DLQ, 'readwrite', { durability: 'strict' });
    const store = tx.objectStore(STORE_PROMISES_DLQ);
    for (const r of rows) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dlqRead(): Promise<DeadLetterPromise[]> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROMISES_DLQ, 'readonly');
    const req = tx.objectStore(STORE_PROMISES_DLQ).getAll();
    req.onsuccess = () => resolve(req.result as DeadLetterPromise[]);
    req.onerror = () => reject(req.error);
  });
}

// ─── Safe legacy migration ─────────────────────────────────────────────────
// Pre-v3 store wrote a single JSON blob to `spear:v1:promises`.
//
// Sequence: archive → copy → verify count → delete. If any step throws,
// the localStorage blob stays put for retry on the next hydrate.

const LEGACY_KEY = 'spear:v1:promises';

interface LegacyArchiveRow {
  key: string;
  raw: string;
  archivedAt: string;
}

async function archiveLegacyBlob(raw: string): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LEGACY_ARCHIVE, 'readwrite', { durability: 'strict' });
    const row: LegacyArchiveRow = { key: LEGACY_KEY, raw, archivedAt: new Date().toISOString() };
    tx.objectStore(STORE_LEGACY_ARCHIVE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function migrateLegacyBlob(): Promise<{ migrated: number; archived: boolean }> {
  if (typeof window === 'undefined') return { migrated: 0, archived: false };
  const raw = window.localStorage.getItem(LEGACY_KEY);
  if (!raw) return { migrated: 0, archived: false };

  // 1. Archive first — never destroy data without a backup.
  try {
    await archiveLegacyBlob(raw);
  } catch {
    // Archive failed → leave the blob in place; we'll retry next hydrate.
    return { migrated: 0, archived: false };
  }

  // 2. Parse + validate + copy each row.
  let parsed: unknown[];
  try {
    parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    // Corrupt blob — archive captured the original; safe to delete.
    window.localStorage.removeItem(LEGACY_KEY);
    return { migrated: 0, archived: true };
  }

  let migrated = 0;
  for (const item of parsed) {
    const v = validateDurablePromise(item);
    if (v.ok) {
      try {
        await putRow(v.data as DurablePromise);
        migrated++;
      } catch {
        // Row write failed mid-migration → DO NOT delete the blob.
        // Next hydrate will re-attempt; idempotent because put = upsert.
        return { migrated, archived: true };
      }
    }
  }

  // 3. Verify count matches. If we expected N and wrote < N, leave the blob
  //    so an operator can investigate. Archived copy is the safety net.
  if (migrated < parsed.length) {
    return { migrated, archived: true };
  }

  // 4. Only after every row is verified persisted do we delete the blob.
  window.localStorage.removeItem(LEGACY_KEY);
  return { migrated, archived: true };
}

// ─── Cross-tab broadcast ───────────────────────────────────────────────────
//
// Channel name is derived from the current DB name so a tab on
// `/?seed=busy-rep` (DB: spear-events-seed-busy-rep) never hears broadcasts
// from a tab on `/` (DB: spear-events). Mirrors the pattern in events.ts —
// without this, two scenario tabs would invalidate each other's unrelated
// caches.
function channelName(): string {
  return `spear:promises:${getDbName()}`;
}

// ─── Store ─────────────────────────────────────────────────────────────────

type Subscriber = (ps: readonly DurablePromise[]) => void;

export class PromiseStore {
  private cache = new Map<string, DurablePromise>();
  private dlq: DeadLetterPromise[] = []; // hot cache; persistent copy in IDB
  private subs = new Set<Subscriber>();
  private channel: BroadcastChannel | null = null;
  private channelHandler: ((e: MessageEvent<unknown>) => void) | null = null;
  private hydrated = false;

  /** Resolves once the in-memory cache is consistent with IDB. */
  readonly ready: Promise<void>;

  constructor(private readonly log: EventLog) {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName());
      this.channelHandler = (e) => this.applyBroadcast(e.data);
      this.channel.addEventListener('message', this.channelHandler);
    }
    this.ready = this.hydrate();
  }

  /** Tear down — primarily for tests. */
  dispose(): void {
    if (this.channel && this.channelHandler) {
      this.channel.removeEventListener('message', this.channelHandler);
      this.channel.close();
    }
    this.channel = null;
    this.channelHandler = null;
    this.subs.clear();
  }

  private async hydrate(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    const t0 = performance.now?.() ?? Date.now();
    try {
      const { migrated: migratedFromLegacy } = await migrateLegacyBlob();
      // Hot DLQ from persistent store.
      try {
        this.dlq = await dlqRead();
      } catch {
        /* hydrate is best-effort */
      }
      const rows = await readAllRows();
      const newDlq: DeadLetterPromise[] = [];
      let quarantined = 0;
      for (const r of rows) {
        const v = validateDurablePromise(r);
        if (v.ok) {
          this.cache.set(v.data.id, v.data as DurablePromise);
        } else {
          quarantined++;
          const id = (r as { id?: string })?.id ?? `unknown_${quarantined}`;
          const reason = v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          const dlqRow: DeadLetterPromise = {
            id,
            raw: r,
            reason,
            quarantinedAt: new Date().toISOString(),
          };
          newDlq.push(dlqRow);
          this.dlq.push(dlqRow);
          track({ name: 'promise.row_quarantined', props: { id, reason } });
        }
      }
      // Persist newly-quarantined rows.
      if (newDlq.length > 0) {
        try {
          await dlqAppend(newDlq);
        } catch {
          /* DLQ write failure is non-fatal */
        }
      }
      const ms = Math.round((performance.now?.() ?? Date.now()) - t0);
      track({
        name: 'promise.store_hydrated',
        props: { rows: this.cache.size, quarantined, migratedFromLegacy, ms },
      });
    } finally {
      this.hydrated = true;
      this.emit();
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  list(): readonly DurablePromise[] {
    return this.snapshot();
  }

  /** Hot copy of dead-letter rows. Use `loadDeadLetter()` for the canonical async read. */
  deadLetter(): readonly DeadLetterPromise[] {
    return [...this.dlq];
  }

  /** Authoritative read from the persistent DLQ store. */
  async loadDeadLetter(): Promise<readonly DeadLetterPromise[]> {
    return dlqRead();
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    fn(this.snapshot());
    return () => {
      this.subs.delete(fn);
    };
  }

  async create(
    input: Omit<DurablePromise, 'createdAt' | 'updatedAt' | 'status'>
  ): Promise<PromiseResult<DurablePromise>> {
    return withStreamLock(promiseStream(input.id), async () => {
      const createdAt = nowInstant();
      const p: DurablePromise = { ...input, createdAt, updatedAt: createdAt, status: 'pending' };

      const v = validateDurablePromise(p);
      if (!v.ok) {
        return {
          ok: false,
          code: 'invalid_state',
          message: v.error.issues[0]?.message ?? 'invalid promise',
        };
      }

      // Cross-store atomic write — the row and its `promise.created` event
      // commit together. If the IDB tx fails, neither is visible.
      const result = await this.log.appendAndUpsert(
        promiseStream(p.id),
        [
          {
            opKey: `pr.create:${p.id}`,
            payload: {
              kind: 'promise.created',
              at: createdAt,
              by: p.createdBy,
              text: p.text,
              dueAt: p.dueAt,
              escalateAt: p.escalateAt,
            },
          },
        ],
        STORE_PROMISES,
        p
      );
      if (!result.ok) {
        return { ok: false, code: 'storage_error', message: result.message };
      }

      this.cache.set(p.id, p);
      const minutesToDue = Math.round(
        (new Date(p.dueAt.iso).getTime() - new Date(createdAt.iso).getTime()) / 60_000
      );
      track({
        name: 'promise.created',
        props: {
          id: p.id,
          nounKind: p.noun.kind,
          minutesToDue,
          hasEscalation: Boolean(p.escalateAt),
        },
      });
      this.broadcast({ kind: 'upsert', id: p.id, row: p });
      this.emit();
      return { ok: true, data: p };
    });
  }

  async keep(id: string, by: RepId, at: Instant = nowInstant()): Promise<PromiseResult> {
    return withStreamLock(promiseStream(id), async () => {
      const p = this.cache.get(id);
      if (!p) return { ok: false, code: 'not_found', message: `promise ${id} not found` };
      if (p.status !== 'pending') {
        return {
          ok: false,
          code: 'invalid_state',
          message: `promise ${id} is ${p.status}, not pending`,
        };
      }
      const updated: DurablePromise = { ...p, status: 'kept', updatedAt: at };
      const result = await this.log.appendAndUpsert(
        promiseStream(id),
        [{ opKey: `pr.keep:${id}`, payload: { kind: 'promise.kept', at, by } }],
        STORE_PROMISES,
        updated
      );
      if (!result.ok) return { ok: false, code: 'storage_error', message: result.message };

      this.cache.set(id, updated);
      const minutesEarly = Math.round(
        (new Date(p.dueAt.iso).getTime() - new Date(at.iso).getTime()) / 60_000
      );
      track({ name: 'promise.kept', props: { id, minutesEarly } });
      this.broadcast({ kind: 'upsert', id, row: updated });
      this.emit();
      return { ok: true, data: undefined };
    });
  }

  /**
   * Tick — the durable-timer heartbeat. Per-row writes; only changed rows
   * touch IDB. Each transition runs under its own per-stream lock so one
   * tab's tick doesn't race another's `keep`.
   */
  async tick(now: Instant = nowInstant()): Promise<void> {
    const nowMs = new Date(now.iso).getTime();
    let dirty = false;
    for (const [id, p] of this.cache) {
      if (p.status === 'pending' && nowMs >= new Date(p.dueAt.iso).getTime()) {
        const ok = await this.transition(id, 'missed', now, () => ({
          opKey: `pr.miss:${id}`,
          payload: { kind: 'promise.missed', at: now },
        }));
        if (ok) {
          const minutesLate = Math.round((nowMs - new Date(p.dueAt.iso).getTime()) / 60_000);
          track({ name: 'promise.missed', props: { id, minutesLate } });
          dirty = true;
        }
      }
      const cur = this.cache.get(id)!;
      if (
        cur.status === 'missed' &&
        cur.escalateAt &&
        nowMs >= new Date(cur.escalateAt.iso).getTime()
      ) {
        const toMgr = repId('rep_mhall'); // demo: pod lead
        const ok = await this.transition(id, 'escalated', now, () => ({
          opKey: `pr.escalate:${id}`,
          payload: { kind: 'promise.escalated', at: now, toMgr },
        }));
        if (ok) {
          track({ name: 'promise.escalated', props: { id } });
          dirty = true;
        }
      }
    }
    if (dirty) this.emit();
  }

  /** Internal transition helper: locked, atomic event+row write. */
  private async transition(
    id: string,
    next: PromiseStatus,
    at: Instant,
    eventBuilder: () => { opKey: string; payload: import('./event-schema').ValidatedPayload }
  ): Promise<boolean> {
    return withStreamLock(promiseStream(id), async () => {
      const cur = this.cache.get(id);
      if (!cur) return false;
      const updated: DurablePromise = { ...cur, status: next, updatedAt: at };
      const result = await this.log.appendAndUpsert(
        promiseStream(id),
        [eventBuilder()],
        STORE_PROMISES,
        updated
      );
      if (!result.ok) return false;
      this.cache.set(id, updated);
      this.broadcast({ kind: 'upsert', id, row: updated });
      return true;
    });
  }

  /** Test/admin: hard reset both storage and cache. Cross-tab broadcast. */
  async clear(): Promise<void> {
    await clearStore();
    this.cache.clear();
    // DLQ persists across clear() — operators may want to inspect quarantined rows.
    this.broadcast({ kind: 'cleared' });
    this.emit();
  }

  /** Test/admin: delete a single row. Cross-tab broadcast. */
  async remove(id: string): Promise<void> {
    return withStreamLock(promiseStream(id), async () => {
      await deleteRow(id);
      this.cache.delete(id);
      this.broadcast({ kind: 'delete', id });
      this.emit();
    });
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private snapshot(): readonly DurablePromise[] {
    return [...this.cache.values()].sort(
      (a, b) => new Date(a.dueAt.iso).getTime() - new Date(b.dueAt.iso).getTime()
    );
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const s of this.subs) s(snap);
  }

  private broadcast(msg: PromiseBroadcastT): void {
    this.channel?.postMessage(msg);
  }

  /**
   * Apply an inbound broadcast from another tab. Validates the envelope
   * AND the row payload — older builds, malicious extensions, or stale
   * peers should never be able to corrupt local state.
   */
  private applyBroadcast(raw: unknown): void {
    const env = PromiseBroadcastSchema.safeParse(raw);
    if (!env.success) return; // unparseable envelope — drop silently

    const msg = env.data;
    if (msg.kind === 'cleared') {
      this.cache.clear();
      this.emit();
      return;
    }
    if (msg.kind === 'delete') {
      if (this.cache.delete(msg.id)) this.emit();
      return;
    }
    // upsert: validate the row before trusting it.
    const v = validateDurablePromise(msg.row);
    if (!v.ok) {
      const reason = v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      const dlqRow: DeadLetterPromise = {
        id: msg.id,
        raw: msg.row,
        reason,
        quarantinedAt: new Date().toISOString(),
      };
      this.dlq.push(dlqRow);
      void dlqAppend([dlqRow]).catch(() => undefined);
      track({ name: 'promise.row_quarantined', props: { id: msg.id, reason } });
      return;
    }
    this.cache.set(msg.id, v.data as DurablePromise);
    this.emit();
  }
}

// ─── Browser ticker ────────────────────────────────────────────────────────
// Exported so `main.tsx` can install one. Safe to call multiple times.

let installed = false;

export function installPromiseTicker(store: PromiseStore, intervalMs = 15_000): () => void {
  if (installed || typeof window === 'undefined') return () => undefined;
  installed = true;

  let handle: number | null = null;
  const tick = () => {
    void store.tick();
  };

  const start = () => {
    if (handle !== null) return;
    tick();
    handle = window.setInterval(tick, intervalMs);
  };
  const stop = () => {
    if (handle !== null) {
      clearInterval(handle);
      handle = null;
    }
  };

  start();
  const onVisibility = () => (document.visibilityState === 'visible' ? (tick(), start()) : stop());
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', tick);

  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', tick);
    installed = false;
  };
}

export type { DurablePromiseT };
