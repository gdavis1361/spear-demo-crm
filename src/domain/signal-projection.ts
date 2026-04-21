// SignalProjection — live view of the Signals feed.
//
// Before VX1 (Linear runtime audit) the Signals screen held dismiss/action
// state in `React.useState`, which evaporated the moment the user
// navigated to any other tab. The server saw the mutation; the UI
// forgot. On return, every signal looked un-dismissed.
//
// After VX1:
//   - Signals themselves stay as a static fixture (`signals.data.ts`) —
//     they are an inbound feed the rep doesn't create. That fixture is
//     the base truth this projection folds events onto.
//   - `signal.dismissed` / `signal.actioned` events are emitted by the
//     Signals screen on click, and by the outbox on server permanent-
//     failure compensation (which appends `signal.dismiss_reverted` /
//     `signal.action_reverted`).
//   - The projection folds latest-event-wins per signal, same shape as
//     DealProjection, and emits snapshots that the UI subscribes to.
//
// This file is the "durable projection" half; `src/screens/signals.tsx`
// is the UI half that consumes it.

import type { EventLog, StoredEvent } from './events';
import { SIGNALS, type Signal as FixtureSignal } from '../screens/signals.data';

export type SignalMark = 'none' | 'dismissed' | 'actioned';

export interface ProjectedSignal extends FixtureSignal {
  /** Latest user-mark for this signal. Derived from the event stream. */
  mark: SignalMark;
}

type Subscriber = (snap: readonly ProjectedSignal[]) => void;

export class SignalProjection {
  private readonly log: EventLog;
  private readonly marks = new Map<string, SignalMark>();
  private readonly subs = new Set<Subscriber>();
  private hydrated = false;
  private unsubscribeLog: (() => void) | null = null;

  readonly ready: Promise<void>;

  constructor(log: EventLog) {
    this.log = log;
    this.ready = this.hydrate();
  }

  /** All signals, fixture-ordered, with the latest mark folded in. */
  list(): readonly ProjectedSignal[] {
    return SIGNALS.map((s) => ({ ...s, mark: this.marks.get(s.id) ?? 'none' }));
  }

  /** Visible signals — excludes dismissed. Still includes actioned (marked). */
  visible(): readonly ProjectedSignal[] {
    return this.list().filter((s) => s.mark !== 'dismissed');
  }

  markOf(id: string): SignalMark {
    return this.marks.get(id) ?? 'none';
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    fn(this.list());
    return () => {
      this.subs.delete(fn);
    };
  }

  /** Drop cache + re-read from the log. Used by tests. */
  async rehydrate(): Promise<void> {
    this.marks.clear();
    this.hydrated = false;
    await this.hydrate();
  }

  dispose(): void {
    this.unsubscribeLog?.();
    this.unsubscribeLog = null;
    this.subs.clear();
  }

  private async hydrate(): Promise<void> {
    // One prefix read covers every signal stream. Cheaper than iterating
    // fixture IDs because the storage-side composite index is already
    // ordered by (stream, id) so reads group naturally.
    const events = await this.log.readPrefix('signal:');
    for (const e of events) this.apply(e);
    this.hydrated = true;
    this.emit();

    this.unsubscribeLog = this.log.subscribe(async ({ stream }) => {
      if (!stream.startsWith('signal:')) return;
      // Per-stream refold. Events in a single stream arrive ULID-ordered,
      // and we only ever need the latest mark — so re-reading the stream
      // and taking its tail is bounded and correct.
      const tail = await this.log.read(stream);
      for (const e of tail) this.apply(e);
      this.emit();
    });
  }

  private apply(e: StoredEvent): void {
    const signalId = e.stream.slice('signal:'.length);
    const p = e.payload;
    switch (p.kind) {
      case 'signal.dismissed':
        this.marks.set(signalId, 'dismissed');
        return;
      case 'signal.actioned':
        this.marks.set(signalId, 'actioned');
        return;
      case 'signal.dismiss_reverted':
      case 'signal.action_reverted':
        // The revert undoes the most recent mark of its matching kind.
        // Since marks is a single-valued map (dismissed or actioned,
        // never both at once in normal use) we drop the mark entirely.
        this.marks.delete(signalId);
        return;
      default:
        // Non-signal events on this prefix would indicate schema drift.
        // The hydrate prefix filter already excludes them; this branch
        // exists only because TypeScript's exhaustiveness check is kinder
        // when we acknowledge the default.
        return;
    }
  }

  private emit(): void {
    const snap = this.list();
    for (const fn of this.subs) fn(snap);
  }
}
