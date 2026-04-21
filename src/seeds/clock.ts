// Virtual clock for seed scenarios.
//
// Two modes:
//   - `relative`  — times are computed against real Date.now(); useful for
//     E2E tests where "overdue by 30 min" should actually render as overdue.
//   - `frozen`    — times are computed against a fixed anchor; useful for
//     visual regression where a snapshot must stay byte-stable across runs.

export type ClockMode = 'relative' | 'frozen';

export type VirtualClockOpts = { mode: 'relative' } | { mode: 'frozen'; at: Date };

export class VirtualClock {
  readonly mode: ClockMode;
  private readonly anchor: Date | null;

  constructor(opts: VirtualClockOpts) {
    this.mode = opts.mode;
    this.anchor = opts.mode === 'frozen' ? opts.at : null;
  }

  /** Current time per the clock's mode. */
  now(): Date {
    return this.anchor ? new Date(this.anchor.getTime()) : new Date();
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  minutesFromNow(n: number): Date {
    return new Date(this.now().getTime() + n * 60_000);
  }

  hoursFromNow(n: number): Date {
    return new Date(this.now().getTime() + n * 3_600_000);
  }

  daysFromNow(n: number): Date {
    return new Date(this.now().getTime() + n * 86_400_000);
  }

  daysAgo(n: number): Date {
    return this.daysFromNow(-n);
  }
}
