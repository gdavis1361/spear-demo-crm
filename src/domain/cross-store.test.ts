import { describe, it, expect, beforeEach } from 'vitest';
import {
  IndexedDbEventLog,
  dealStream,
  openSpearDb,
  _resetDbConnectionForTests,
  STORE_PROMISES,
} from './events';
import { instant } from '../lib/time';
import { repId, leadId } from '../lib/ids';
import { moneyFromMajor } from '../lib/money';
import { ulid } from '../lib/ulid';

async function clearAll(): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['events', STORE_PROMISES], 'readwrite');
    tx.objectStore('events').clear();
    tx.objectStore(STORE_PROMISES).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const me = repId('rep_mhall');
const ld = leadId('ld_x');
const at = instant('2026-04-21T13:47:00Z');

describe('appendAndUpsert cross-store atomicity (IDB)', () => {
  let log: IndexedDbEventLog;

  beforeEach(async () => {
    _resetDbConnectionForTests();
    await clearAll();
    log = new IndexedDbEventLog();
  });

  it('commits both the event AND the side-store row in one transaction', async () => {
    const row = {
      id: 'pr_atomic',
      noun: { kind: 'person', id: 'p1' },
      text: 'verify both stores',
      dueAt: at,
      createdBy: me,
      createdAt: at,
      updatedAt: at,
      status: 'pending' as const,
    };

    let onCommitFired = false;
    const result = await log.appendAndUpsert(
      dealStream(ld),
      [
        {
          opKey: ulid(),
          payload: {
            kind: 'deal.created',
            at,
            by: me,
            stage: 'inbound',
            value: moneyFromMajor(1),
            displayId: 'LD-T',
            title: 'T',
            meta: '',
            branch: 'T',
            tags: [],
          },
        },
      ],
      STORE_PROMISES,
      row,
      () => {
        onCommitFired = true;
      }
    );
    expect(result.ok).toBe(true);
    expect(onCommitFired).toBe(true);

    // Both stores show the write.
    const events = await log.read(dealStream(ld));
    expect(events).toHaveLength(1);
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      void openSpearDb().then((db) => {
        const tx = db.transaction(STORE_PROMISES, 'readonly');
        const req = tx.objectStore(STORE_PROMISES).getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      });
    });
    expect(rows.find((r) => (r as { id: string }).id === 'pr_atomic')).toBeDefined();
  });

  it('rejects the entire batch when payload validation fails', async () => {
    const row = { id: 'pr_invalid', text: 'whatever' };
    const result = await log.appendAndUpsert(
      dealStream(ld),
      [{ opKey: ulid(), payload: { kind: 'deal.created', at, by: me } as never }], // missing fields
      STORE_PROMISES,
      row as { id: string }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_payload');

    // Neither store mutated.
    expect(await log.size()).toBe(0);
  });
});
