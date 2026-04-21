import { describe, it, expect } from 'vitest';
import { parsePhone, formatPhone, parseEmail, maybeEmail } from './contact';

describe('parsePhone()', () => {
  it('normalizes a dashed US number to E.164', () => {
    expect(parsePhone('334-555-0199').e164).toBe('+13345550199');
  });

  it('normalizes a parenthesized US number', () => {
    expect(parsePhone('(706) 555-0181').e164).toBe('+17065550181');
  });

  it('keeps an already-E.164 number intact', () => {
    expect(parsePhone('+13345550199').e164).toBe('+13345550199');
  });

  it('defaults country to US when not specified', () => {
    expect(parsePhone('3345550199').country).toBe('US');
  });

  it('respects explicit default country', () => {
    expect(parsePhone('3345550199', 'GB').country).toBe('GB');
  });
});

describe('formatPhone()', () => {
  it('pretty-prints US E.164', () => {
    const p = parsePhone('3345550199');
    expect(formatPhone(p)).toBe('(334) 555-0199');
  });

  it('returns E.164 for non-US', () => {
    expect(formatPhone({ e164: '+442071234567', country: 'GB' })).toBe('+442071234567');
  });

  it('round-trips parse → format → parse', () => {
    const input = '(334) 555-0199';
    const once = formatPhone(parsePhone(input));
    const twice = formatPhone(parsePhone(once));
    expect(twice).toBe(once);
  });
});

describe('parseEmail()', () => {
  it('parses a well-formed address', () => {
    const e = parseEmail('kruiz@example.com');
    expect(e.value).toBe('kruiz@example.com');
    expect(e.domain).toBe('example.com');
  });

  it('lowercases the domain but preserves the local part case', () => {
    const e = parseEmail('Katherine.Ruiz@Example.COM');
    expect(e.domain).toBe('example.com');
    expect(e.value).toContain('Katherine.Ruiz');
  });

  it('trims whitespace', () => {
    expect(parseEmail('  a@b.co  ').value).toBe('a@b.co');
  });

  const malformed = ['not-an-email', 'a@b', '@b.co', 'a b@c.co', ''];
  it.each(malformed)('rejects %s', (raw) => {
    expect(() => parseEmail(raw)).toThrow(/malformed/);
  });
});

describe('maybeEmail()', () => {
  it('returns an EmailAddress on success', () => {
    expect(maybeEmail('a@b.co')).toEqual({ value: 'a@b.co', domain: 'b.co' });
  });

  it('returns null instead of throwing', () => {
    expect(maybeEmail('nope')).toBeNull();
  });
});
