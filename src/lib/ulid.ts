// ULID — 128-bit, k-sortable, URL-safe identifiers.
// Spec: https://github.com/ulid/spec
//
// 48-bit timestamp (ms since epoch) + 80-bit randomness, base32-encoded
// using Crockford's alphabet (no I/L/O/U). The result is sortable by
// generation order — exactly what an event log wants for its primary key
// when there's no central allocator.
//
// We use this instead of IDB's `autoIncrement: true` so two browser tabs
// (or, eventually, the server) can both append without seq collisions.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;

let lastTime = 0;
let lastRand = new Uint8Array(10);

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function encodeTime(ms: number): string {
  if (ms < 0 || ms > 0xFFFFFFFFFFFF) throw new RangeError(`[ulid] time ${ms} out of range`);
  let n = ms;
  let s = '';
  for (let i = 0; i < TIME_LEN; i++) {
    s = CROCKFORD[n & 31] + s;
    n = Math.floor(n / 32);
  }
  return s;
}

function encodeRandom(bytes: Uint8Array): string {
  // 10 random bytes → 16 base32 chars. Treat the 10 bytes as an 80-bit integer.
  let s = '';
  let bitBuffer = 0;
  let bitCount = 0;
  for (let i = bytes.length - 1; i >= 0; i--) {
    bitBuffer |= bytes[i] << bitCount;
    bitCount += 8;
    while (bitCount >= 5) {
      s = CROCKFORD[bitBuffer & 31] + s;
      bitBuffer >>>= 5;
      bitCount -= 5;
    }
  }
  if (bitCount > 0) s = CROCKFORD[bitBuffer & 31] + s;
  return s.padStart(RAND_LEN, '0').slice(0, RAND_LEN);
}

/** Increment the random part as an 80-bit integer (used for monotonicity). */
function incrementBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === 0xff) { out[i] = 0; continue; }
    out[i] = out[i] + 1;
    return out;
  }
  // Overflow: extremely unlikely (2^80 IDs in 1ms). Caller treats as fatal.
  throw new Error('[ulid] random overflow within same millisecond');
}

/**
 * Generate a new ULID. Monotonic within the same millisecond — successive
 * calls in the same ms increment the random component to preserve ordering.
 */
export function ulid(at: number = Date.now()): string {
  let rand: Uint8Array;
  if (at === lastTime) {
    rand = incrementBytes(lastRand);
  } else {
    rand = randomBytes(10);
    lastTime = at;
  }
  lastRand = new Uint8Array(rand); // copy to ArrayBuffer-backed view
  return encodeTime(at) + encodeRandom(rand);
}

/** Extract the 48-bit timestamp from a ULID. */
export function ulidTimestamp(id: string): number {
  if (id.length !== 26) throw new Error(`[ulid] expected length 26, got ${id.length}`);
  const t = id.slice(0, 10);
  let ms = 0;
  for (let i = 0; i < t.length; i++) {
    const idx = CROCKFORD.indexOf(t[i]);
    if (idx < 0) throw new Error(`[ulid] invalid char "${t[i]}"`);
    ms = ms * 32 + idx;
  }
  return ms;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export function isUlid(s: string): boolean {
  return ULID_RE.test(s);
}
