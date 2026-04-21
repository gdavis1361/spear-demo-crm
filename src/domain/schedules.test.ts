import { describe, it, expect, beforeEach } from 'vitest';
import { ScheduleRegistry, DEFAULT_RETRY } from './schedules';
import { InMemoryEventLog, scheduleStream } from './events';

describe('ScheduleRegistry', () => {
  let log: InMemoryEventLog;
  let reg: ScheduleRegistry;

  beforeEach(() => {
    log = new InMemoryEventLog();
    reg = new ScheduleRegistry(log);
  });

  it('registers a schedule and returns it from get()', () => {
    const handle = reg.register({
      name: 'milmove.cycle',
      intervalMs: 60_000,
      jitterMs: 0,
      retry: DEFAULT_RETRY,
      run: async () => 'ok',
    });
    expect(reg.get('milmove.cycle')).toBe(handle);
    expect(handle.name).toBe('milmove.cycle');
    expect(handle.isPaused()).toBe(false);
  });

  it('rejects duplicate names', () => {
    reg.register({ name: 'dup', intervalMs: 1000, jitterMs: 0, retry: DEFAULT_RETRY, run: async () => 'ok' });
    expect(() =>
      reg.register({ name: 'dup', intervalMs: 1000, jitterMs: 0, retry: DEFAULT_RETRY, run: async () => 'ok' })
    ).toThrow(/duplicate name/);
  });

  it('runNow executes the function and records ok in history', async () => {
    let calls = 0;
    const handle = reg.register({
      name: 'manual',
      intervalMs: 60_000_000, // long enough we don't auto-fire during the test
      jitterMs: 0,
      retry: DEFAULT_RETRY,
      run: async () => { calls++; return { items: 3 }; },
    });
    handle.pause();             // stop the timer; runNow still works
    const rec = await handle.runNow();
    expect(calls).toBe(1);
    expect(rec.status).toBe('ok');
    expect(rec.attempts).toBe(1);
    expect(handle.recentRuns(5)).toHaveLength(1);
  });

  it('retries a transient failure up to maxAttempts then succeeds', async () => {
    let attempts = 0;
    const handle = reg.register({
      name: 'transient',
      intervalMs: 60_000_000,
      jitterMs: 0,
      retry: { ...DEFAULT_RETRY, initialBackoffMs: 1, backoffMultiplier: 1, maxAttempts: 3 },
      run: async () => {
        attempts++;
        if (attempts < 3) throw Object.assign(new Error('flaky'), { code: 'internal_error' });
        return 'ok';
      },
    });
    handle.pause();
    const rec = await handle.runNow();
    expect(rec.status).toBe('ok');
    expect(rec.attempts).toBe(3);
  });

  it('marks dead-lettered after exhausting retries', async () => {
    const handle = reg.register({
      name: 'always-fails',
      intervalMs: 60_000_000,
      jitterMs: 0,
      retry: { ...DEFAULT_RETRY, initialBackoffMs: 1, backoffMultiplier: 1, maxAttempts: 2 },
      run: async () => { throw Object.assign(new Error('nope'), { code: 'internal_error' }); },
    });
    handle.pause();
    const rec = await handle.runNow();
    expect(rec.status).toBe('dead-lettered');
    expect(rec.attempts).toBe(2);
    const events = await log.read(scheduleStream('always-fails'));
    expect(events.map((e) => e.payload.kind)).toContain('schedule.dead_lettered');
  });

  it('does not retry non-retryable error codes', async () => {
    let attempts = 0;
    const handle = reg.register({
      name: 'forbidden',
      intervalMs: 60_000_000,
      jitterMs: 0,
      retry: { maxAttempts: 5, initialBackoffMs: 1, backoffMultiplier: 1, nonRetryable: ['permission_denied'] },
      run: async () => { attempts++; throw Object.assign(new Error('nope'), { code: 'permission_denied' }); },
    });
    handle.pause();
    await handle.runNow();
    expect(attempts).toBe(1);
  });

  it('pause/resume gates the timer', () => {
    const handle = reg.register({
      name: 'p',
      intervalMs: 60_000_000,
      jitterMs: 0,
      retry: DEFAULT_RETRY,
      run: async () => 'ok',
    });
    handle.pause();
    expect(handle.isPaused()).toBe(true);
    handle.resume();
    expect(handle.isPaused()).toBe(false);
    handle.pause(); // cleanup
  });
});
