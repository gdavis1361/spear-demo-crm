import { describe, it, expect, beforeEach } from 'vitest';
import { recordObjectViewed, recordSetQueried, recentAudit, subscribeAudit, _resetAuditForTests } from './audit';
import { instant } from '../lib/time';

const at = instant('2026-04-21T13:47:00Z');

describe('read audit log', () => {
  beforeEach(() => _resetAuditForTests());

  it('records object views', () => {
    recordObjectViewed({ actorId: 'rep_mhall', objectKind: 'deal', objectId: 'LD-40218', surface: 'peek', at });
    const recent = recentAudit();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ kind: 'object.viewed', objectKind: 'deal', objectId: 'LD-40218' });
  });

  it('records set queries', () => {
    recordSetQueried({ actorId: 'rep_mhall', objectKind: 'deal', filterCount: 2, resultCount: 5, at });
    expect(recentAudit()[0]).toMatchObject({ kind: 'set.queried', resultCount: 5 });
  });

  it('subscribers fire on each new event', () => {
    const updates: number[] = [];
    const off = subscribeAudit((events) => updates.push(events.length));
    recordObjectViewed({ actorId: 'a', objectKind: 'deal', objectId: 'd1', surface: 'peek' });
    recordObjectViewed({ actorId: 'a', objectKind: 'deal', objectId: 'd2', surface: 'peek' });
    off();
    expect(updates[0]).toBe(0);
    expect(updates[updates.length - 1]).toBe(2);
  });
});
