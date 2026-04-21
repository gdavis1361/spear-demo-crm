// DealProjection — live cache of the current Deal entities derived from
// the event stream.
//
// Why: before this file, `DEALS` lived as a static array in
// `src/lib/data.tsx` and Pipeline read from it directly. The deal-machine
// wrote `deal.advanced` / `deal.reverted` events but *nothing read them* —
// the static array stayed frozen, and every projection-test-shaped bit of
// logic in this codebase had to reach past the UI to inspect state.
//
// After this file:
//   - `deal.created` events carry the full Deal shape (display fields +
//     stage + value); see schema change in `event-schema.ts`.
//   - On boot, the projection reads every `deal:*` stream, folds events
//     into an in-memory `Map<dealId, Deal>`, and exposes snapshot + subscribe.
//   - Mutations go through `runTransition()` → `log.appendIf()`; the
//     projection's subscription picks the change up via the EventLog's
//     BroadcastChannel and emits a new snapshot.
//
// This is the Promise/Deal asymmetry fix. Same lifecycle shape as
// PromiseStore (ready: Promise<void>, subscribe, list, clear), minus the
// cross-store persistence because Deals live purely in the event log.

import type { EventLog, StoredEvent } from './events';
import type { Deal, StageKey } from '../lib/types';
import type { LeadId, AccountId } from '../lib/ids';

type DealId = LeadId | AccountId;
type Subscriber = (snap: readonly Deal[]) => void;

export class DealProjection {
  private readonly log: EventLog;
  private readonly byId = new Map<string, Deal>();
  private readonly subs = new Set<Subscriber>();
  private hydrated = false;
  private unsubscribeLog: (() => void) | null = null;

  readonly ready: Promise<void>;

  constructor(log: EventLog) {
    this.log = log;
    this.ready = this.hydrate();
  }

  /**
   * Current snapshot. Ordered by Map insertion order, which — because
   * events arrive in ULID order and `Map.set` on an existing key
   * preserves position — matches the order deals were first created.
   * Bootstrap seeds DEALS in array order, so on first boot this matches
   * the pre-projection visual output byte-for-byte.
   */
  list(): readonly Deal[] {
    return Array.from(this.byId.values());
  }

  listByStage(stage: StageKey): readonly Deal[] {
    return this.list().filter((d) => d.stage === stage);
  }

  getById(id: DealId): Deal | null {
    return this.byId.get(String(id)) ?? null;
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  /**
   * Subscribe to snapshot changes. Calls `fn` immediately with the current
   * snapshot, then every time an event affecting Deals lands.
   */
  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    // Fire once on subscription so consumers don't need to handle "not
    // yet ready" specially.
    fn(this.list());
    return () => {
      this.subs.delete(fn);
    };
  }

  /** Test helper: reset the in-memory cache and re-hydrate from the log. */
  async rehydrate(): Promise<void> {
    this.byId.clear();
    this.hydrated = false;
    await this.hydrate();
  }

  /** Test helper: drop everything. Does not touch the event log. */
  clearCache(): void {
    this.byId.clear();
    this.hydrated = false;
    this.emit();
  }

  dispose(): void {
    this.unsubscribeLog?.();
    this.unsubscribeLog = null;
    this.subs.clear();
  }

  private async hydrate(): Promise<void> {
    const events = await this.log.readPrefix('deal:');
    for (const e of events) this.applyOne(e);
    this.hydrated = true;
    this.emit();

    // Subscribe after hydration so we don't race on initial read.
    this.unsubscribeLog = this.log.subscribe(async ({ stream }) => {
      if (!stream.startsWith('deal:')) return;
      const affected = await this.log.read(stream);
      // Re-fold just this stream. Cheaper than a full rehydrate; safe
      // because events within a stream are monotonically ordered.
      for (const e of affected) this.applyOne(e);
      this.emit();
    });
  }

  private applyOne(e: StoredEvent): void {
    const p = e.payload;
    if (!p.kind || !p.kind.startsWith('deal.')) return;
    // The event log's typed payload union carries all DealEvent variants.
    if (p.kind === 'deal.created') {
      // Match the Deal shape in `src/lib/types.ts`. The stream key is
      // `deal:<id>`; we extract the id for `dealId`.
      const dealIdRaw = e.stream.slice('deal:'.length);
      this.byId.set(dealIdRaw, {
        stage: p.stage,
        dealId: dealIdRaw as unknown as DealId,
        displayId: p.displayId,
        title: p.title,
        meta: p.meta,
        branch: p.branch,
        value: p.value,
        tags: [...p.tags],
        hot: p.hot,
        warm: p.warm,
      });
      return;
    }
    const dealIdRaw = e.stream.slice('deal:'.length);
    const existing = this.byId.get(dealIdRaw);
    if (!existing) return; // advance/revert/signed on an unknown deal — skip
    if (p.kind === 'deal.advanced' || p.kind === 'deal.reverted') {
      this.byId.set(dealIdRaw, { ...existing, stage: p.to });
      return;
    }
    if (p.kind === 'deal.signed') {
      this.byId.set(dealIdRaw, { ...existing, stage: 'won' });
      return;
    }
    // deal.lost / deal.quote_sent / deal.quote_expired don't change the
    // Deal's projected stage. Ignored by design — add handling here if
    // the UI needs to surface those states.
  }

  private emit(): void {
    const snap = this.list();
    for (const fn of this.subs) fn(snap);
  }
}
