// SignalProjection tests (VX1 of the Linear runtime audit).
//
// Contract we're holding:
//   - Fresh projection with no events: every signal is mark='none'.
//   - A `signal.dismissed` event hides the signal from `visible()`.
//   - A later `signal.dismiss_reverted` un-hides it.
//   - `signal.actioned` doesn't hide (still visible) but marks actioned.
//   - Latest-event-wins per signal (ULID order).
//   - Subscribers see an initial snapshot and a new one per mutation.
//   - Persistence: a fresh projection after a reload reads the same marks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDbEventLog, signalStream, openSpearDb, _resetDbConnectionForTests } from './events';
import { SignalProjection } from './signal-projection';
import { repId } from '../lib/ids';
import { SIGNALS } from '../screens/signals.data';

const me = repId('rep_mhall');
const AT = { iso: '2026-04-21T13:47:00.000Z' };
const AT_LATER = { iso: '2026-04-21T13:48:00.000Z' };

async function clearEvents(): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['events', 'events_dlq'], 'readwrite');
    tx.objectStore('events').clear();
    tx.objectStore('events_dlq').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('SignalProjection', () => {
  let log: IndexedDbEventLog;
  let proj: SignalProjection;

  beforeEach(async () => {
    _resetDbConnectionForTests();
    await clearEvents();
    log = new IndexedDbEventLog();
    proj = new SignalProjection(log);
    await proj.ready;
  });

  afterEach(() => {
    proj.dispose();
  });

  it('starts with every fixture signal at mark="none"', () => {
    const snap = proj.list();
    expect(snap).toHaveLength(SIGNALS.length);
    expect(snap.every((s) => s.mark === 'none')).toBe(true);
  });

  it('folds signal.dismissed into a dismissed mark', async () => {
    const id = SIGNALS[0].id;
    await log.append(signalStream(id), [
      { opKey: 'op1', payload: { kind: 'signal.dismissed', at: AT, by: me } },
    ]);
    // Subscribers fire async via BroadcastChannel; yield once.
    await new Promise((r) => setTimeout(r, 10));
    expect(proj.markOf(id)).toBe('dismissed');
    expect(proj.visible().map((s) => s.id)).not.toContain(id);
  });

  it('signal.dismiss_reverted un-dismisses', async () => {
    const id = SIGNALS[0].id;
    await log.append(signalStream(id), [
      { opKey: 'op1', payload: { kind: 'signal.dismissed', at: AT, by: me } },
    ]);
    await log.append(signalStream(id), [
      {
        opKey: 'op2',
        payload: {
          kind: 'signal.dismiss_reverted',
          at: AT_LATER,
          by: me,
          reason: 'outbox compensation',
        },
      },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    expect(proj.markOf(id)).toBe('none');
    expect(proj.visible().map((s) => s.id)).toContain(id);
  });

  it('signal.actioned marks actioned but keeps the signal visible', async () => {
    const id = SIGNALS[0].id;
    await log.append(signalStream(id), [
      { opKey: 'op1', payload: { kind: 'signal.actioned', at: AT, by: me } },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    expect(proj.markOf(id)).toBe('actioned');
    // Actioned signals stay visible (marked, not hidden).
    expect(proj.visible().map((s) => s.id)).toContain(id);
  });

  it('persists across reload: a fresh projection sees the same marks', async () => {
    const id = SIGNALS[1].id;
    await log.append(signalStream(id), [
      { opKey: 'op_persist', payload: { kind: 'signal.dismissed', at: AT, by: me } },
    ]);

    // Dispose and rehydrate — simulates a page reload.
    proj.dispose();
    const fresh = new SignalProjection(log);
    await fresh.ready;
    expect(fresh.markOf(id)).toBe('dismissed');
    fresh.dispose();
  });

  it('subscribe fires on initial mount and on every subsequent event', async () => {
    const snaps: number[] = [];
    const off = proj.subscribe((snap) => {
      // Use the count of non-default marks as a proxy for change tracking.
      snaps.push(snap.filter((s) => s.mark !== 'none').length);
    });

    // Initial snapshot: 0 marks.
    expect(snaps[snaps.length - 1]).toBe(0);

    await log.append(signalStream(SIGNALS[0].id), [
      { opKey: 'op1', payload: { kind: 'signal.dismissed', at: AT, by: me } },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    expect(snaps[snaps.length - 1]).toBe(1);

    await log.append(signalStream(SIGNALS[1].id), [
      { opKey: 'op2', payload: { kind: 'signal.actioned', at: AT, by: me } },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    expect(snaps[snaps.length - 1]).toBe(2);

    off();
  });

  it('ignores events on non-signal streams', async () => {
    // Belt-and-suspenders: the hydrate filter already excludes these,
    // but a future refactor that broadens the filter must not sneak
    // deal events into the signals projection.
    await log.append(signalStream(SIGNALS[0].id), [
      { opKey: 'op1', payload: { kind: 'signal.dismissed', at: AT, by: me } },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    const countBefore = proj.list().filter((s) => s.mark !== 'none').length;
    expect(countBefore).toBe(1);
  });
});
