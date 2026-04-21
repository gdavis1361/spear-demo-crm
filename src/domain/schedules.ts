// Schedule registry — per-source cadence, jitter, dead-letter, run history.
//
// Temporal's `ScheduleHandle`, down-sized for the browser. Each entry has:
//   - a cadence (interval between runs)
//   - a bounded jitter (prevents thundering herd)
//   - a retry policy (max attempts, backoff)
//   - a history (last N runs kept in memory; all emitted to the event log)
//
// The poll "line" the UI shows ("Next poll in 00:48") reads directly from
// `nextRunAt()` — no more fossil strings.

import type { Instant } from '../lib/time';
import { now as nowInstant } from '../lib/time';
import type { EventLog } from './events';
import { scheduleStream } from './events';

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoffMs: number;
  readonly backoffMultiplier: number;
  /** Error codes that are NOT retried (e.g., `permission_denied`, `invalid_request`). */
  readonly nonRetryable: readonly string[];
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 1000,
  backoffMultiplier: 2,
  nonRetryable: ['permission_denied', 'invalid_request', 'unauthenticated'],
};

export interface ScheduleConfig<T> {
  readonly name: string;
  /** Cadence in ms between runs (ignored if `cron` is provided — not shipped). */
  readonly intervalMs: number;
  /** Max additional delay added per run, ms. Keeps two peers from colliding. */
  readonly jitterMs: number;
  readonly retry: RetryPolicy;
  /** The thing to do. Throws on failure; retries apply. */
  readonly run: (runId: string, at: Instant) => Promise<T>;
}

export interface RunRecord {
  readonly runId: string;
  readonly startedAt: Instant;
  readonly finishedAt?: Instant;
  readonly attempts: number;
  readonly status: 'ok' | 'failed' | 'dead-lettered';
  readonly summary?: string;
}

export interface ScheduleHandle {
  readonly name: string;
  nextRunAt(): Instant;
  recentRuns(n?: number): readonly RunRecord[];
  /** Fire immediately (ignores cadence). For testing + UI "run now" affordance. */
  runNow(): Promise<RunRecord>;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
}

export class ScheduleRegistry {
  private handles = new Map<string, ActiveSchedule>();

  constructor(private readonly log: EventLog) {}

  register<T>(cfg: ScheduleConfig<T>): ScheduleHandle {
    if (this.handles.has(cfg.name)) {
      throw new Error(`[schedule] duplicate name: ${cfg.name}`);
    }
    const active = new ActiveSchedule(cfg, this.log);
    this.handles.set(cfg.name, active);
    return active;
  }

  get(name: string): ScheduleHandle | undefined {
    return this.handles.get(name);
  }

  all(): readonly ScheduleHandle[] {
    return [...this.handles.values()];
  }

  stopAll(): void {
    for (const h of this.handles.values()) h.pause();
  }
}

// ─── Implementation ────────────────────────────────────────────────────────

class ActiveSchedule<T = unknown> implements ScheduleHandle {
  readonly name: string;
  private readonly cfg: ScheduleConfig<T>;
  private readonly log: EventLog;
  private history: RunRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private nextAt: Instant;

  constructor(cfg: ScheduleConfig<T>, log: EventLog) {
    this.cfg = cfg;
    this.name = cfg.name;
    this.log = log;
    this.nextAt = this.computeNext(nowInstant());
    this.arm();
  }

  private computeNext(from: Instant): Instant {
    const jitter = Math.floor(Math.random() * (this.cfg.jitterMs + 1));
    const when = new Date(from.iso).getTime() + this.cfg.intervalMs + jitter;
    return { iso: new Date(when).toISOString() };
  }

  private arm(): void {
    if (typeof setTimeout === 'undefined' || this.paused) return;
    const ms = Math.max(0, new Date(this.nextAt.iso).getTime() - Date.now());
    this.timer = setTimeout(() => { void this.runNow(); }, ms);
  }

  nextRunAt(): Instant {
    return this.nextAt;
  }

  recentRuns(n = 5): readonly RunRecord[] {
    return this.history.slice(-n).reverse();
  }

  pause(): void {
    this.paused = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.nextAt = this.computeNext(nowInstant());
    this.arm();
  }

  isPaused(): boolean {
    return this.paused;
  }

  async runNow(): Promise<RunRecord> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = nowInstant();
    await this.log.append(scheduleStream(this.name), [{
      opKey: `sched.start:${runId}`,
      payload: { kind: 'schedule.run_started', at: startedAt, scheduledFor: this.nextAt },
    }]);

    let attempts = 0;
    let lastError: unknown;
    while (attempts < this.cfg.retry.maxAttempts) {
      attempts++;
      try {
        const out = await this.cfg.run(runId, startedAt);
        const finishedAt = nowInstant();
        const summary = typeof out === 'object' && out && 'items' in out ? `${(out as { items: number }).items} items` : undefined;
        const record: RunRecord = { runId, startedAt, finishedAt, attempts, status: 'ok', summary };
        this.history.push(record);
        await this.log.append(scheduleStream(this.name), [{
          opKey: `sched.complete:${runId}`,
          payload: { kind: 'schedule.run_completed', at: finishedAt, runId, items: summary ? parseInt(summary) : 0 },
        }]);
        if (!this.paused) {
          this.nextAt = this.computeNext(finishedAt);
          this.arm();
        }
        return record;
      } catch (e) {
        lastError = e;
        const code = (e as { code?: string }).code ?? 'unknown';
        if (this.cfg.retry.nonRetryable.includes(code)) break;
        if (attempts < this.cfg.retry.maxAttempts) {
          const backoff = this.cfg.retry.initialBackoffMs * this.cfg.retry.backoffMultiplier ** (attempts - 1);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }

    const finishedAt = nowInstant();
    const message = (lastError as { message?: string } | undefined)?.message ?? 'unknown';
    const code = (lastError as { code?: string } | undefined)?.code ?? 'unknown';
    const dead = attempts >= this.cfg.retry.maxAttempts;
    const record: RunRecord = { runId, startedAt, finishedAt, attempts, status: dead ? 'dead-lettered' : 'failed', summary: message };
    this.history.push(record);
    await this.log.append(scheduleStream(this.name), [{
      opKey: `sched.fail:${runId}`,
      payload: dead
        ? { kind: 'schedule.dead_lettered', at: finishedAt, runId, attempts }
        : { kind: 'schedule.run_failed',    at: finishedAt, runId, code, message },
    }]);
    if (!this.paused) {
      this.nextAt = this.computeNext(finishedAt);
      this.arm();
    }
    return record;
  }
}
