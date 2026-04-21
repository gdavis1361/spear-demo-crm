import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  instant,
  zoned,
  now,
  _setNowForTests,
  _resetNowForTests,
  formatZoned,
  formatInstantDate,
  relativeTime,
  ageShort,
} from './time';

const FIXED = '2026-04-21T13:47:00Z';

describe('instant()', () => {
  it('normalizes any valid ISO to UTC zulu form', () => {
    expect(instant('2026-04-21T09:47:00-04:00').iso).toBe('2026-04-21T13:47:00.000Z');
  });

  it('round-trips a UTC input', () => {
    expect(instant(FIXED).iso).toBe('2026-04-21T13:47:00.000Z');
  });
});

describe('zoned()', () => {
  it('bundles an instant with an IANA zone', () => {
    const z = zoned(FIXED, 'America/New_York');
    expect(z.instant.iso).toBe('2026-04-21T13:47:00.000Z');
    expect(z.zone).toBe('America/New_York');
  });
});

describe('now() mocking', () => {
  beforeEach(() => _setNowForTests(() => ({ iso: FIXED })));
  afterEach(() => _resetNowForTests());

  it('returns the frozen value', () => {
    expect(now().iso).toBe(FIXED);
  });

  it('resets to wall clock after reset', () => {
    _resetNowForTests();
    const a = now().iso;
    expect(a).not.toBe(FIXED);
    expect(new Date(a).getTime()).toBeGreaterThan(0);
  });
});

describe('formatZoned()', () => {
  it('renders ET during daylight time', () => {
    // Apr 21 is EDT (UTC−4). 13:47Z → 09:47 local.
    const z = zoned(FIXED, 'America/New_York');
    expect(formatZoned(z)).toMatch(/Tue, Apr 21, 09:47 ET/);
  });

  it('renders PT concurrently from the same instant', () => {
    const z = zoned(FIXED, 'America/Los_Angeles');
    expect(formatZoned(z)).toMatch(/Tue, Apr 21, 06:47 PT/);
  });

  it('renders Tokyo across the date line', () => {
    const z = zoned(FIXED, 'Asia/Tokyo');
    expect(formatZoned(z)).toMatch(/Tue, Apr 21, 22:47 JST/);
  });

  it('hides the zone when requested', () => {
    const z = zoned(FIXED, 'UTC');
    expect(formatZoned(z, { showZone: false })).not.toContain('UTC');
  });
});

describe('formatInstantDate()', () => {
  it('renders a date in the requested zone', () => {
    expect(formatInstantDate(instant(FIXED), 'America/Chicago')).toBe('Apr 21, 2026');
  });
});

describe('relativeTime()', () => {
  const base = { iso: '2026-04-21T13:47:00Z' };
  const cases: Array<[string, string, RegExp]> = [
    ['30 seconds ago',  '2026-04-21T13:46:30Z', /30 sec\. ago|in 30 seconds|30 seconds ago/],
    ['5 minutes ago',   '2026-04-21T13:42:00Z', /5 min\. ago|5 minutes ago/],
    ['2 hours ago',     '2026-04-21T11:47:00Z', /2 hr\. ago|2 hours ago/],
    ['3 days ago',      '2026-04-18T13:47:00Z', /3 days ago|3 days\./],
  ];
  it.each(cases)('formats %s', (_name, at, re) => {
    expect(relativeTime(instant(at), base)).toMatch(re);
  });
});

describe('ageShort()', () => {
  const base = { iso: '2026-04-21T13:47:00Z' };

  it('formats sub-hour as m:ss', () => {
    expect(ageShort(instant('2026-04-21T13:46:56Z'), base)).toBe('0:04');
    expect(ageShort(instant('2026-04-21T13:23:00Z'), base)).toBe('24:00');
  });

  it('formats under 24h as h', () => {
    expect(ageShort(instant('2026-04-21T10:47:00Z'), base)).toBe('3h');
  });

  it('formats beyond 24h as d', () => {
    expect(ageShort(instant('2026-04-19T13:47:00Z'), base)).toBe('2d');
  });

  it('clamps future instants to 0:00 (no negatives)', () => {
    expect(ageShort(instant('2026-04-21T14:47:00Z'), base)).toBe('0:00');
  });
});
