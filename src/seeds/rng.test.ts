import { describe, it, expect } from 'vitest';
import { Rng } from './rng';

describe('Rng', () => {
  it('produces identical sequences from the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences from different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('intBetween is inclusive on both ends and stays in range', () => {
    const r = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.intBetween(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('intBetween throws when max < min', () => {
    const r = new Rng(1);
    expect(() => r.intBetween(5, 4)).toThrow();
  });

  it('pick returns a member of the array', () => {
    const arr = ['a', 'b', 'c'] as const;
    const r = new Rng(3);
    for (let i = 0; i < 100; i++) expect(arr).toContain(r.pick(arr));
  });

  it('pick throws on empty array', () => {
    const r = new Rng(1);
    expect(() => r.pick([])).toThrow();
  });

  it('fork is deterministic on namespace', () => {
    const a = new Rng(42).fork('scenario-x').next();
    const b = new Rng(42).fork('scenario-x').next();
    expect(a).toBe(b);
  });

  it('fork isolates sibling layers', () => {
    // Adding a new sibling scenario should not perturb an existing one's
    // output. Proxy for that property: fork(A) and fork(B) pull from
    // distinct streams.
    const parent = new Rng(42);
    const a = parent.fork('layer-A').next();
    const b = parent.fork('layer-B').next();
    expect(a).not.toBe(b);
  });

  it('chance respects probability p', () => {
    const r = new Rng(7);
    let hits = 0;
    for (let i = 0; i < 5000; i++) if (r.chance(0.3)) hits++;
    // Within a wide band — this is a statistical smoke, not a tight bound.
    expect(hits).toBeGreaterThan(1200);
    expect(hits).toBeLessThan(1800);
  });
});
