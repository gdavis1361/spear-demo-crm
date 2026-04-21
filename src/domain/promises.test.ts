import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromiseStore } from './promises';
import { IndexedDbEventLog, openSpearDb, STORE_PROMISES, STORE_PROMISES_DLQ, promiseStream, _resetDbConnectionForTests } from './events';
import { _setNowForTests, _resetNowForTests, instant } from '../lib/time';
import { repId } from '../lib/ids';

const me = repId('rep_mhall');
const NOW = '2026-04-21T13:47:00Z';

const LEGACY_KEY = 'spear:v1:promises';

async function clearAllStores(): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['events', 'events_dlq', STORE_PROMISES, STORE_PROMISES_DLQ], 'readwrite');
    tx.objectStore('events').clear();
    tx.objectStore('events_dlq').clear();
    tx.objectStore(STORE_PROMISES).clear();
    tx.objectStore(STORE_PROMISES_DLQ).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function rawPutPromiseRow(row: unknown): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROMISES, 'readwrite');
    tx.objectStore(STORE_PROMISES).put(row as never);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('PromiseStore (row-level IDB)', () => {
  let log: IndexedDbEventLog;
  let store: PromiseStore;

  beforeEach(async () => {
    _setNowForTests(() => instant(NOW));
    if (typeof window !== 'undefined') window.localStorage.clear();
    _resetDbConnectionForTests();
    await clearAllStores();
    log = new IndexedDbEventLog();
    store = new PromiseStore(log);
    await store.ready;
  });
  afterEach(() => {
    store.dispose();
    _resetNowForTests();
  });

  it('exposes a `ready` Promise that resolves once IDB hydration finishes', async () => {
    expect(store.isHydrated()).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('create() persists a single row and returns ok', async () => {
    const r = await store.create({
      id: 'pr_1',
      noun: { kind: 'person', id: 'p1' },
      text: 'Call back at 09:30',
      dueAt: instant('2026-04-21T16:30:00Z'),
      createdBy: me,
    });
    expect(r.ok).toBe(true);
    expect(store.list()).toHaveLength(1);

    // Survives a fresh store (proves persistence is row-level, not in-memory)
    const fresh = new PromiseStore(log);
    await fresh.ready;
    expect(fresh.list().find((p) => p.id === 'pr_1')?.text).toBe('Call back at 09:30');
    fresh.dispose();
  });

  it('create() emits a promise.created event on the log', async () => {
    await store.create({
      id: 'pr_evt',
      noun: { kind: 'person', id: 'p' },
      text: 'do a thing',
      dueAt: instant('2026-04-21T16:00:00Z'),
      createdBy: me,
    });
    const events = await log.read(promiseStream('pr_evt'));
    expect(events).toHaveLength(1);
    expect(events[0].payload.kind).toBe('promise.created');
  });

  it('keep() returns invalid_state when promise is already kept', async () => {
    await store.create({ id: 'pr_k', noun: { kind: 'person', id: 'p' }, text: 't', dueAt: instant('2026-04-21T16:00:00Z'), createdBy: me });
    expect((await store.keep('pr_k', me)).ok).toBe(true);
    const r = await store.keep('pr_k', me);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_state');
  });

  it('keep() returns not_found for unknown id', async () => {
    const r = await store.keep('does_not_exist', me);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('tick marks pending → missed when dueAt has passed (row-level update)', async () => {
    await store.create({
      id: 'pr_due',
      noun: { kind: 'person', id: 'p' },
      text: 't',
      dueAt: instant('2026-04-21T13:00:00Z'),  // already past NOW
      createdBy: me,
    });
    await store.tick(instant(NOW));

    expect(store.list().find((p) => p.id === 'pr_due')?.status).toBe('missed');

    // The row in IDB reflects the new state (no full-blob rewrite needed).
    const fresh = new PromiseStore(log);
    await fresh.ready;
    expect(fresh.list().find((p) => p.id === 'pr_due')?.status).toBe('missed');
    fresh.dispose();
  });

  it('tick escalates a missed promise once escalateAt has passed', async () => {
    await store.create({
      id: 'pr_esc',
      noun: { kind: 'person', id: 'p' },
      text: 't',
      dueAt: instant('2026-04-21T12:00:00Z'),
      escalateAt: instant('2026-04-21T13:00:00Z'),
      createdBy: me,
    });
    await store.tick(instant(NOW));
    expect(store.list().find((p) => p.id === 'pr_esc')?.status).toBe('escalated');
  });

  it('tick is a no-op for not-yet-due promises', async () => {
    await store.create({
      id: 'pr_future',
      noun: { kind: 'person', id: 'p' },
      text: 't',
      dueAt: instant('2026-04-21T18:00:00Z'),
      createdBy: me,
    });
    await store.tick(instant(NOW));
    expect(store.list().find((p) => p.id === 'pr_future')?.status).toBe('pending');
  });

  it('subscribe fires once on subscribe and on every state change', async () => {
    const updates: number[] = [];
    const off = store.subscribe((ps) => updates.push(ps.length));
    await store.create({ id: 'pr_sub', noun: { kind: 'person', id: 'p' }, text: 't', dueAt: instant('2026-04-21T16:00:00Z'), createdBy: me });
    off();
    expect(updates[0]).toBe(0);
    expect(updates[updates.length - 1]).toBe(1);
  });

  it('remove() deletes a single row and notifies subscribers', async () => {
    await store.create({ id: 'pr_rm', noun: { kind: 'person', id: 'p' }, text: 't', dueAt: instant('2026-04-21T16:00:00Z'), createdBy: me });
    expect(store.list()).toHaveLength(1);
    await store.remove('pr_rm');
    expect(store.list()).toHaveLength(0);

    // Survives reload
    const fresh = new PromiseStore(log);
    await fresh.ready;
    expect(fresh.list()).toHaveLength(0);
    fresh.dispose();
  });

  it('list() is sorted by dueAt ascending', async () => {
    await store.create({ id: 'pr_late', noun: { kind: 'person', id: 'p' }, text: 'late', dueAt: instant('2026-04-21T20:00:00Z'), createdBy: me });
    await store.create({ id: 'pr_soon', noun: { kind: 'person', id: 'p' }, text: 'soon', dueAt: instant('2026-04-21T14:00:00Z'), createdBy: me });
    await store.create({ id: 'pr_mid',  noun: { kind: 'person', id: 'p' }, text: 'mid',  dueAt: instant('2026-04-21T16:00:00Z'), createdBy: me });
    expect(store.list().map((p) => p.id)).toEqual(['pr_soon', 'pr_mid', 'pr_late']);
  });

  it('quarantines rows that fail Zod validation on read', async () => {
    // Inject a malformed row directly to IDB, bypassing the validating put.
    await rawPutPromiseRow({ id: 'pr_bad', text: 'no noun field', status: 'pending' });
    const fresh = new PromiseStore(log);
    await fresh.ready;
    expect(fresh.list().find((p) => p.id === 'pr_bad')).toBeUndefined();
    expect(fresh.deadLetter().some((d) => d.id === 'pr_bad')).toBe(true);
    fresh.dispose();
  });

  it('migrates a legacy localStorage blob into per-row IDB on first hydrate', async () => {
    if (typeof window === 'undefined') return;
    const legacy = [
      {
        id: 'pr_legacy',
        noun: { kind: 'person', id: 'p' },
        text: 'from blob',
        dueAt: instant('2026-04-21T16:00:00Z'),
        createdBy: me,
        createdAt: instant(NOW),
        status: 'pending',
      },
    ];
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const fresh = new PromiseStore(log);
    await fresh.ready;
    expect(fresh.list().find((p) => p.id === 'pr_legacy')?.text).toBe('from blob');
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull(); // blob deleted
    fresh.dispose();
  });

  it('legacy migration discards a corrupt blob without throwing', async () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LEGACY_KEY, 'not valid json');
    const fresh = new PromiseStore(log);
    await fresh.ready;
    expect(fresh.list()).toEqual([]);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    fresh.dispose();
  });

  it('clear() empties storage and notifies subscribers', async () => {
    await store.create({ id: 'pr_x', noun: { kind: 'person', id: 'p' }, text: 't', dueAt: instant('2026-04-21T16:00:00Z'), createdBy: me });
    const updates: number[] = [];
    const off = store.subscribe((ps) => updates.push(ps.length));
    await store.clear();
    off();
    expect(store.list()).toEqual([]);
    expect(updates[updates.length - 1]).toBe(0);
  });

  it('cross-tab broadcast: applyBroadcast adds remote upserts to the local cache', async () => {
    const updates: number[] = [];
    store.subscribe((ps) => updates.push(ps.length));

    // Open a second store, simulate another tab.
    const tabB = new PromiseStore(log);
    await tabB.ready;
    await tabB.create({ id: 'pr_x_tab', noun: { kind: 'person', id: 'p' }, text: 'remote', dueAt: instant('2026-04-21T16:00:00Z'), createdBy: me });

    // Yield once so the BroadcastChannel message queue drains.
    await new Promise((r) => setTimeout(r, 0));

    expect(store.list().find((p) => p.id === 'pr_x_tab')?.text).toBe('remote');
    expect(updates[updates.length - 1]).toBe(1);
    tabB.dispose();
  });
});
