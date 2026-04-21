import { describe, it, expect } from 'vitest';
import {
  leadId,
  accountId,
  dealId,
  moveId,
  signalId,
  personId,
  baseId,
  docId,
  repId,
  newRequestId,
  newIdempotencyKey,
  fromDisplayId,
} from './ids';
import type { LeadId, AccountId } from './ids';

describe('typed ID constructors', () => {
  const good: Array<[string, (s: string) => string, string]> = [
    ['leadId',    leadId,    'ld_40218'],
    ['accountId', accountId, 'acc_1188'],
    ['dealId',    dealId,    'dl_xyz'],
    ['moveId',    moveId,    'mv_30418'],
    ['signalId',  signalId,  'sig_00241'],
    ['personId',  personId,  'per_smith'],
    ['baseId',    baseId,    'base_campbell'],
    ['docId',     docId,     'doc_abc'],
    ['repId',     repId,     'rep_mhall'],
  ];

  it.each(good)('%s accepts a correctly-prefixed value', (_name, fn, raw) => {
    expect(fn(raw)).toBe(raw);
  });

  const bad: Array<[string, (s: string) => string, string]> = [
    ['leadId rejects acc_',   leadId,    'acc_1188'],
    ['leadId rejects bare',    leadId,    '40218'],
    ['leadId rejects hyphen',  leadId,    'LD-40218'],
    ['accountId rejects ld_',  accountId, 'ld_1188'],
    ['dealId rejects empty',   dealId,    ''],
  ];

  it.each(bad)('%s throws a clear error', (_name, fn, raw) => {
    expect(() => fn(raw)).toThrow(/expected .* with prefix/);
  });
});

describe('newRequestId()', () => {
  it('is prefixed req_ and at most 28 chars', () => {
    const id = newRequestId();
    expect(id).toMatch(/^req_[a-z0-9]+$/);
    expect(id.length).toBeLessThanOrEqual(28);
  });

  it('is unique across 1,000 calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newRequestId());
    expect(seen.size).toBe(1000);
  });
});

describe('newIdempotencyKey()', () => {
  it('produces a non-empty key', () => {
    const k = newIdempotencyKey();
    expect(k.length).toBeGreaterThan(0);
  });

  it('is unique across 1,000 calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newIdempotencyKey());
    expect(seen.size).toBe(1000);
  });
});

describe('fromDisplayId<T>()', () => {
  it('passes through legacy display IDs without prefix validation', () => {
    const raw: string = 'LD-40218';
    const id: LeadId = fromDisplayId<LeadId>(raw);
    expect(id).toBe(raw);
  });

  it('preserves branding at the type level', () => {
    const id: AccountId = fromDisplayId<AccountId>('ACC-1188');
    // Compile-only contract: the following would fail typecheck if the
    // brand leaked. We assert the runtime shape is identity.
    expect((id as unknown as string)).toBe('ACC-1188');
  });
});
