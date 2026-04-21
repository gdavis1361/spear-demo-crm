// Coverage for the pure `computeHealth` reducer behind `useOutboxHealth`
// (VX8). The hook itself is React-bound and exercised via a Playwright
// check that the topbar text matches queue state; this file covers the
// state-machine choices.

import { describe, it, expect } from 'vitest';
import { _computeHealthForTests as computeHealth } from './use-outbox-health';

const NOW = 2_000_000;

function row(status: string, ageMs: number): { status: string; createdAt: string } {
  return {
    status,
    createdAt: new Date(NOW - ageMs).toISOString(),
  };
}

describe('computeHealth', () => {
  it('empty → idle', () => {
    const h = computeHealth([], NOW);
    expect(h).toEqual({ pending: 0, permanent: 0, oldestPendingAgeMs: 0, status: 'idle' });
  });

  it('one fresh pending → syncing', () => {
    const h = computeHealth([row('pending', 5_000)], NOW);
    expect(h.status).toBe('syncing');
    expect(h.pending).toBe(1);
  });

  it('pending older than 60s → degraded', () => {
    const h = computeHealth([row('pending', 120_000)], NOW);
    expect(h.status).toBe('degraded');
  });

  it('any permanent_failure → degraded even if no pending', () => {
    const h = computeHealth([row('permanent_failure', 10_000)], NOW);
    expect(h.status).toBe('degraded');
    expect(h.permanent).toBe(1);
    expect(h.pending).toBe(0);
  });

  it('in_flight counts toward pending', () => {
    const h = computeHealth([row('in_flight', 500)], NOW);
    expect(h.pending).toBe(1);
    expect(h.status).toBe('syncing');
  });

  it('oldestPendingAgeMs reflects the max age of any pending row', () => {
    const h = computeHealth(
      [row('pending', 3_000), row('pending', 30_000), row('pending', 15_000)],
      NOW
    );
    expect(h.oldestPendingAgeMs).toBe(30_000);
    expect(h.pending).toBe(3);
  });
});
