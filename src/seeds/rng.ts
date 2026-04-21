// Deterministic PRNG + sampling helpers for seed scenarios.
//
// mulberry32: 32-bit state, fast, uniform, portable. Good enough for
// fixtures; bad for cryptography. Don't use this for anything that
// touches real data.
//
// `fork(namespace)` derives a child RNG seeded from a hash of `namespace`
// XOR'd with the parent state. This is how layered scenarios avoid
// "adding a new layer shifts every other layer's output" — each layer
// pulls from its own stable stream.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  intBetween(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.intBetween: max (${max}) < min (${min})`);
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Float in [min, max). */
  floatBetween(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Pick one element. Empty array throws — scenarios should never call this on empty. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: empty array');
    return arr[this.intBetween(0, arr.length - 1)]!;
  }

  /** Bernoulli with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Derive a child RNG keyed by `namespace`. See file header for why. */
  fork(namespace: string): Rng {
    // FNV-1a 32-bit hash of the namespace, XOR'd with current state.
    let hash = 0x811c9dc5;
    for (let i = 0; i < namespace.length; i++) {
      hash ^= namespace.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return new Rng(this.s ^ (hash >>> 0));
  }
}
