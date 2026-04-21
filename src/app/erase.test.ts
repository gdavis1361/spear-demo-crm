import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eraseAllLocalState } from './erase';
import { promiseStore } from './runtime';
import { _resetDbConnectionForTests } from '../domain/events';

// TB3 — eraseAllLocalState is the single "forget me" primitive. These
// tests assert the durable behavior (IDB dropped, spear:* storage
// cleared) without relying on a UI surface, so the compliance
// affordance has direct coverage even if the DevPalette wiring changes.
//
// Note: the test runtime's fake-indexeddb + happy-dom provide enough of
// `indexedDB.databases()` + `localStorage` + `sessionStorage` for the
// checks below. If a future test runner strips those, the tests will
// start skipping via the `typeof` guards.

describe('eraseAllLocalState (TB3)', () => {
  beforeEach(() => {
    _resetDbConnectionForTests();
    // Seed the two storages with a mix of spear + non-spear keys.
    // The assertion is that only the spear:* entries are touched.
    sessionStorage.setItem('spear:reset-seed', 'canonical');
    sessionStorage.setItem('unrelated-key', 'keep-me');
    localStorage.setItem('spear:feature-flag', 'on');
    localStorage.setItem('unrelated-pref', 'keep-me');
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('returns a report naming the current DB + cleared storage keys', async () => {
    // The runtime module has already instantiated promiseStore etc.,
    // which opens the DB on first durable call. Nudging it via a read
    // ensures there's a connection for erase to close.
    await promiseStore.ready;
    const report = await eraseAllLocalState({ clearAllSeedDbs: false });
    expect(report.dbDeleted).toBe('spear-events');
    expect([...report.storageKeysCleared].sort()).toEqual(
      ['spear:feature-flag', 'spear:reset-seed'].sort()
    );
  });

  it('clears every spear:* storage key but leaves everything else', async () => {
    await eraseAllLocalState({ clearAllSeedDbs: false });
    expect(sessionStorage.getItem('spear:reset-seed')).toBeNull();
    expect(sessionStorage.getItem('unrelated-key')).toBe('keep-me');
    expect(localStorage.getItem('spear:feature-flag')).toBeNull();
    expect(localStorage.getItem('unrelated-pref')).toBe('keep-me');
  });

  it('is safe to call twice (idempotent over empty state)', async () => {
    const first = await eraseAllLocalState({ clearAllSeedDbs: false });
    const second = await eraseAllLocalState({ clearAllSeedDbs: false });
    // Second call finds nothing to clear. The function should still
    // succeed and return an empty-ish report — important because a
    // user who taps Erase twice (or a script that retries) shouldn't
    // see a throw.
    expect(second.storageKeysCleared).toEqual([]);
    // `dbDeleted` is 'spear-events' either way — deleteDatabase is a
    // no-op on a non-existent DB, and we report the name we attempted.
    expect(first.dbDeleted).toBe('spear-events');
    expect(second.dbDeleted).toBe('spear-events');
  });
});
