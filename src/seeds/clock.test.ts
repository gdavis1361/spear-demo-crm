import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VirtualClock } from './clock';

describe('VirtualClock', () => {
  describe('relative mode', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-21T10:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns real Date.now at the moment of the call', () => {
      const c = new VirtualClock({ mode: 'relative' });
      expect(c.nowIso()).toBe('2026-04-21T10:00:00.000Z');
      vi.advanceTimersByTime(60_000);
      expect(c.nowIso()).toBe('2026-04-21T10:01:00.000Z');
    });

    it('minutesFromNow / daysFromNow / daysAgo are relative to system time', () => {
      const c = new VirtualClock({ mode: 'relative' });
      expect(c.minutesFromNow(30).toISOString()).toBe('2026-04-21T10:30:00.000Z');
      expect(c.daysFromNow(1).toISOString()).toBe('2026-04-22T10:00:00.000Z');
      expect(c.daysAgo(2).toISOString()).toBe('2026-04-19T10:00:00.000Z');
    });
  });

  describe('frozen mode', () => {
    it('always returns the anchor regardless of wall time', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-21T10:00:00Z'));
      const anchor = new Date('2020-01-01T00:00:00Z');
      const c = new VirtualClock({ mode: 'frozen', at: anchor });
      expect(c.nowIso()).toBe('2020-01-01T00:00:00.000Z');
      vi.advanceTimersByTime(86_400_000);
      expect(c.nowIso()).toBe('2020-01-01T00:00:00.000Z');
      vi.useRealTimers();
    });

    it('derived times are computed from the anchor', () => {
      const c = new VirtualClock({ mode: 'frozen', at: new Date('2026-04-21T10:00:00Z') });
      expect(c.minutesFromNow(-15).toISOString()).toBe('2026-04-21T09:45:00.000Z');
      expect(c.hoursFromNow(5).toISOString()).toBe('2026-04-21T15:00:00.000Z');
    });
  });

  it('mode is exposed for telemetry', () => {
    expect(new VirtualClock({ mode: 'relative' }).mode).toBe('relative');
    expect(new VirtualClock({ mode: 'frozen', at: new Date() }).mode).toBe('frozen');
  });
});
