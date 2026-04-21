import { describe, it, expect } from 'vitest';
import { redactProps, KNOWN_FREE_TEXT_KEYS } from './telemetry';

// TB2 — allowlist PII scrubbing. The function must:
// 1. Pass safe enum/ID/stream string values through unchanged.
// 2. Replace ANY string whose key isn't allowlisted with '[redacted]'.
// 3. Leave non-string values (numbers, booleans, null, objects) alone.
// 4. Refuse to leak known free-text keys even if they carry a short
//    value that "looks safe."

describe('redactProps (TB2)', () => {
  it('preserves allowlisted enum/ID string values', () => {
    const safe = {
      kind: 'verb',
      dealId: 'dl_40218',
      runId: 'run_abc123',
      opKey: 'sched.start:123',
      requestId: 'req_xyz',
      status: 'failed',
      verb: 'email',
      code: 'permission_denied',
      stream: 'deal:ld_1',
      stage: 'promise_store_ready',
    };
    expect(redactProps(safe)).toEqual(safe);
  });

  it('redacts unknown string keys regardless of value', () => {
    // These are the keys that used to leak under the denylist model:
    // a future event with `{ note: 'customer is angry' }` would have
    // flowed through untouched. Now it's redacted by default.
    for (const k of KNOWN_FREE_TEXT_KEYS) {
      const props = { [k]: 'whatever the user typed here' };
      const out = redactProps(props);
      expect(out[k]).toBe('[redacted]');
    }
  });

  it('redacts an arbitrary new key the allowlist has never heard of', () => {
    // The whole point of allowlist: unknown keys fail closed.
    const out = redactProps({ a_new_field_noone_thought_of: 'pii-looking value' });
    expect(out.a_new_field_noone_thought_of).toBe('[redacted]');
  });

  it('passes numbers, booleans, and null through untouched', () => {
    const out = redactProps({
      ms: 123,
      firstPaintMs: 45.6,
      online: false,
      scenario: null,
      attempts: 3,
    });
    expect(out).toEqual({
      ms: 123,
      firstPaintMs: 45.6,
      online: false,
      scenario: null,
      attempts: 3,
    });
  });

  it('redacts message and reason specifically (the two actual free-text leak vectors today)', () => {
    // `promise.row_quarantined.reason` and `schedule.run_failed.message`
    // are the two TrackEvent variants that carry free-text today. If
    // this test flips, the redactor is leaking them.
    const out = redactProps({
      message: 'ZodError: expected string at payload.body',
      reason: 'schema drift: unexpected field `accent`',
    });
    expect(out.message).toBe('[redacted]');
    expect(out.reason).toBe('[redacted]');
  });
});
