import { describe, it, expect } from 'vitest';
import { makeDerived, isDerivedValue, topContributors } from './lineage';
import { instant } from '../lib/time';

const at = instant('2026-04-21T08:30:00Z');

describe('makeDerived', () => {
  it('accepts a value with valid contributors', () => {
    const d = makeDerived(96, {
      model: 'spear-priority', version: 3, refreshedAt: at,
      contributors: [
        { source: 'a', label: 'A', weight: 0.5 },
        { source: 'b', label: 'B', weight: 0.3 },
      ],
    });
    expect(d.value).toBe(96);
    expect(d.lineage.contributors).toHaveLength(2);
  });

  it('rejects contributor weights summing > 1', () => {
    expect(() => makeDerived(1, {
      model: 'm', version: 1, refreshedAt: at,
      contributors: [{ source: 'a', label: 'A', weight: 0.7 }, { source: 'b', label: 'B', weight: 0.5 }],
    })).toThrow(/sum to/);
  });

  it('rejects out-of-range weights', () => {
    expect(() => makeDerived(1, {
      model: 'm', version: 1, refreshedAt: at,
      contributors: [{ source: 'a', label: 'A', weight: -0.1 }],
    })).toThrow(/out of/);
    expect(() => makeDerived(1, {
      model: 'm', version: 1, refreshedAt: at,
      contributors: [{ source: 'a', label: 'A', weight: 1.5 }],
    })).toThrow(/out of/);
  });
});

describe('isDerivedValue', () => {
  it('detects DerivedValue shape', () => {
    const d = makeDerived(1, { model: 'm', version: 1, refreshedAt: at, contributors: [] });
    expect(isDerivedValue(d)).toBe(true);
    expect(isDerivedValue(42)).toBe(false);
    expect(isDerivedValue({ value: 1 })).toBe(false);
  });
});

describe('topContributors', () => {
  it('returns the highest-weighted N entries', () => {
    const d = makeDerived(96, {
      model: 'm', version: 1, refreshedAt: at,
      contributors: [
        { source: 'a', label: 'A', weight: 0.10 },
        { source: 'b', label: 'B', weight: 0.40 },
        { source: 'c', label: 'C', weight: 0.20 },
        { source: 'd', label: 'D', weight: 0.30 },
      ],
    });
    expect(topContributors(d, 2).map((c) => c.source)).toEqual(['b', 'd']);
  });
});
