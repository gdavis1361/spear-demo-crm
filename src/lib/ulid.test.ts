import { describe, it, expect } from 'vitest';
import { ulid, ulidTimestamp, isUlid } from './ulid';

describe('ulid()', () => {
  it('produces a 26-char Crockford-base32 string', () => {
    const id = ulid();
    expect(id.length).toBe(26);
    expect(/^[0-9A-HJKMNP-TV-Z]+$/.test(id)).toBe(true);
  });

  it('encodes the input timestamp', () => {
    const at = 1745243220000; // 2025-04-21T13:47:00Z, arbitrary fixed
    expect(ulidTimestamp(ulid(at))).toBe(at);
  });

  it('is unique across 10,000 calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(ulid());
    expect(seen.size).toBe(10_000);
  });

  it('is monotonic within the same millisecond', () => {
    const at = 1745243220000;
    const a = ulid(at);
    const b = ulid(at);
    const c = ulid(at);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it('sorts by generation order across milliseconds', () => {
    const ids = [ulid(1_000), ulid(2_000), ulid(3_000)];
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('rejects out-of-range timestamps', () => {
    expect(() => ulid(-1)).toThrow(/out of range/);
  });
});

describe('ulidTimestamp()', () => {
  it('throws on wrong length', () => {
    expect(() => ulidTimestamp('TOO_SHORT')).toThrow(/expected length 26/);
  });

  it('throws on invalid characters', () => {
    expect(() => ulidTimestamp('IIIIIIIIIIIIIIIIIIIIIIIIII')).toThrow(/invalid char/);
  });
});

describe('isUlid()', () => {
  it('accepts a valid ULID', () => {
    expect(isUlid(ulid())).toBe(true);
  });
  it('rejects a too-short string', () => {
    expect(isUlid('NOPE')).toBe(false);
  });
  it('rejects a string with disallowed chars (I, L, O, U)', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBe(false); // contains U
  });
});
