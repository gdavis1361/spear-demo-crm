import React from 'react';
import { MoreHorizontal, Filter, Download, Plus, MoveRight } from 'lucide-react';
import { STAGES } from '../lib/data';
import type { Deal, PipeLayout, StageKey } from '../lib/types';
import { formatMoneyShort } from '../lib/money';
import { newIdempotencyKey, repId } from '../lib/ids';
import { track } from '../app/telemetry';
import { isEnabled } from '../app/flags';
import { canTransition, runTransition } from '../domain/deal-machine';
import { eventLog } from '../domain/events';
import { outbox } from '../app/runtime';
import { useDeals } from '../app/use-deals';
import { useAnnounce } from '../lib/live-region';

// Pipeline — 3 layouts: kanban / timeline / table

interface PipeCardProps {
  d: Deal;
  onMove?: (to: StageKey) => void;
}

function PipeCard({ d, onMove }: PipeCardProps) {
  const menuEnabled = isEnabled('pipeline.keyboard_move_menu') && !!onMove;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={`pipe-card${d.hot ? ' hot' : ''}${d.warm ? ' warm' : ''}`}>
      <div className="title-row">
        <div className="title">{d.title}</div>
        <span className="id">{d.displayId}</span>
        {menuEnabled && (
          <button
            type="button"
            className="pipe-card-menu-btn"
            aria-label="Move to stage"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <MoveRight className="ic-sm" aria-hidden="true" />
          </button>
        )}
      </div>
      {menuEnabled && menuOpen && (
        <div
          role="menu"
          tabIndex={-1}
          className="pipe-card-menu"
          // Pair onClick + onKeyDown so pointer AND keyboard events
          // that originated on a menuitem don't bubble out of the menu
          // (e.g. into the card's own click handler). Without the
          // keyboard half, Enter on a menuitem was toggling the card
          // selection underneath the menu.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {STAGES.filter((s) => canTransition(d.stage, s.k)).map((s) => (
            <button
              type="button"
              role="menuitem"
              key={s.k}
              className="pipe-card-menu-item"
              onClick={() => {
                onMove?.(s.k);
                closeMenu();
              }}
            >
              <span>{s.label}</span>
              <span className="pipe-card-menu-count">{s.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="meta">{d.meta}</div>
      <div className="tags">
        {d.tags.map((t) => (
          <span
            key={t}
            className={`chip ${t === 'BAFO' || t === 'EXPIRED' ? 'accent' : t === 'PCS' ? 'olive' : t === 'CORP' || t === 'F500' ? 'info' : ''}`}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="foot">
        <span>{d.branch}</span>
        <span className="val">{formatMoneyShort(d.value)}</span>
      </div>
    </div>
  );
}

export function PipelineKanban() {
  // Live snapshot from DealProjection. The projection subscribes to the
  // EventLog's BroadcastChannel, so an append in this tab (or any sibling
  // tab) flows through here automatically — no local "overlay" needed;
  // `runTransition` appends before the UI rerenders.
  const deals = useDeals();
  const announce = useAnnounce();
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overStage, setOverStage] = React.useState<StageKey | null>(null);

  const moveDeal = React.useCallback(
    async (id: string, to: StageKey) => {
      const prev = deals.find((d) => d.dealId === id);
      if (!prev || prev.stage === to) return;
      const from = prev.stage;
      const fromLabel = STAGES.find((s) => s.k === from)?.label ?? from;
      const toLabel = STAGES.find((s) => s.k === to)?.label ?? to;

      // Single idempotency key shared by the local event log + the API call.
      // Same key on retry → both sides accept at most one event. H1: also
      // threaded into every telemetry event fired downstream so Honeycomb
      // can correlate user-intent → local-append → outbox-dispatch →
      // server-ack through a single filter.
      const opKey = newIdempotencyKey();

      // Domain check: state machine rejects illegal edges before we hit the wire.
      if (!canTransition(from, to)) {
        track({
          name: 'pipeline.card_moved_failed',
          props: {
            dealId: id,
            from,
            to,
            ms: 0,
            code: 'stage_transition_invalid',
            requestId: 'local',
            opKey,
          },
        });
        console.warn(`[pipeline] illegal transition ${from} → ${to}; dropped client-side`);
        announce(`Cannot move ${prev.title} from ${fromLabel} to ${toLabel}: invalid transition.`);
        return;
      }

      const t0 = performance.now();

      // Append to the durable event log under an optimistic lock. If another
      // tab beat us to the move, runTransition returns optimistic_lock_failure
      // and we don't even attempt the optimistic UI update.
      const local = await runTransition(eventLog, {
        id: prev.dealId,
        from,
        to,
        by: repId('rep_mhall'),
        role: 'rep',
        opKey,
      });
      if (!local.ok) {
        track({
          name: 'pipeline.card_moved_failed',
          props: {
            dealId: id,
            from,
            to,
            ms: Math.round(performance.now() - t0),
            code: local.code,
            requestId: 'local',
            opKey,
          },
        });
        console.warn(`[pipeline] local commit refused: ${local.code} — ${local.message}`);
        return;
      }

      // Projection already has the new stage from the `deal.advanced` event;
      // the subscription in useDeals() re-renders this component.
      track({
        name: 'pipeline.card_moved',
        props: { dealId: id, from, to, optimistic: true, opKey },
      });
      // Announce the optimistic success now, not after the server confirms.
      // Screen reader users expect feedback at the same latency sighted
      // users get the visual update; permanent server failure is announced
      // separately via the outbox.onFailure subscription below.
      announce(`Moved ${prev.title} from ${fromLabel} to ${toLabel}.`);

      // Hand ownership of the server call to the durable outbox. It owns
      // retries, backoff, cross-tab coordination, and — on permanent
      // failure — writing the compensating `deal.reverted` event (see
      // outbox-dispatchers.ts). The drainer fires immediately; this await
      // resolves before network activity even starts.
      await outbox.enqueue(
        { kind: 'advance_deal', dealId: prev.dealId, toStage: to, fromStage: from },
        opKey
      );
      void outbox.drain();
    },
    [deals, announce]
  );

  // VX5 + H3: restore `pipeline.card_moved_confirmed` telemetry. The
  // outbox owns server-sync now, so the confirmation event can't fire
  // inline at the click handler anymore — it fires here, once the
  // dispatcher returns ok. H3 reintroduced enqueue→confirm timing at
  // the outbox layer (passed as the 4th arg), so `ms` is no longer the
  // honest-zero placeholder it was between VX5 and H3. The `opKey` ties
  // this confirmation back to the `pipeline.card_moved` and the
  // `outbox.mutation_succeeded` events for a single Honeycomb trace.
  React.useEffect(() => {
    return outbox.onSuccess((mutation, _attempts, requestId, ms, opKey) => {
      if (mutation.kind !== 'advance_deal') return;
      track({
        name: 'pipeline.card_moved_confirmed',
        props: {
          dealId: mutation.dealId,
          from: mutation.fromStage,
          to: mutation.toStage,
          ms,
          requestId: requestId ?? 'unknown',
          opKey,
        },
      });
    });
  }, []);

  // Announce permanent outbox failures that belong to this screen. When
  // the compensator succeeded (status='compensated') we tell the user the
  // card returned to its original stage, matching the visual snap-back
  // the projection has already done. When the compensator refused (e.g.
  // the destination was terminal, or a sibling tab moved the deal
  // further), we announce that the local stage is stale instead — a
  // false "returned to X" would itself be the bug.
  React.useEffect(() => {
    return outbox.onFailure((mutation, error, compensation, opKey) => {
      if (mutation.kind !== 'advance_deal') return;
      const fromLabel = STAGES.find((s) => s.k === mutation.fromStage)?.label ?? mutation.fromStage;
      const toLabel = STAGES.find((s) => s.k === mutation.toStage)?.label ?? mutation.toStage;
      const deal = deals.find((d) => d.dealId === mutation.dealId);
      const title = deal?.title ?? mutation.dealId;
      console.warn(
        `[pipeline] outbox permanent failure for ${mutation.dealId}: ${error.code} — ${error.message} (req_id=${error.requestId}) compensation=${compensation.status}`
      );
      if (compensation.status === 'compensated') {
        announce(`Move failed. ${title} returned to ${fromLabel}.`);
      } else {
        announce(
          `Move failed for ${title} at ${toLabel}. Server rejected and local stage could not be reverted — refresh to resync.`
        );
      }
      track({
        name: 'pipeline.card_moved_failed',
        props: {
          dealId: mutation.dealId,
          from: mutation.fromStage,
          to: mutation.toStage,
          ms: 0,
          code: error.code,
          requestId: error.requestId,
          opKey,
        },
      });
    });
  }, [announce, deals]);

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent, k: StageKey) => {
    e.preventDefault();
    setOverStage(k);
  };
  const onDrop = (e: React.DragEvent, k: StageKey) => {
    e.preventDefault();
    if (dragId) void moveDeal(dragId, k);
    setDragId(null);
    setOverStage(null);
  };

  return (
    <div className="kanban-board">
      {STAGES.map((s) => {
        const stageDeals = deals.filter((d) => d.stage === s.k);
        const count = stageDeals.length;
        return (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- HTML5 drag-and-drop is inherently pointer-only; there is no portable keyboard equivalent without a library like `dnd-kit`. Keyboard users move deals through the `.pipe-card-menu-btn` "Move to stage" menu on each card (see PipeCard ~line 34), which is a button with full keyboard semantics. The drag target div is a mouse-only enhancement.
          <div
            key={s.k}
            className={`kan-col${overStage === s.k ? ' drop' : ''}`}
            onDragOver={(e) => onDragOver(e, s.k)}
            onDragLeave={() => setOverStage(null)}
            onDrop={(e) => onDrop(e, s.k)}
          >
            <div className="kan-col-head">
              <div>
                <div className="name">{s.label}</div>
                <div className="val">
                  {count} · {formatMoneyShort(s.value)}
                </div>
              </div>
              <MoreHorizontal className="ic-sm c-subtle" aria-hidden="true" />
            </div>
            <div className="kan-col-cards">
              {stageDeals.map((d) => (
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Drag SOURCE: same HTML5 DnD constraint as the drop target above. Keyboard path is the menu button inside `<PipeCard>` (`.pipe-card-menu-btn`) which opens a role="menu" with all valid stage transitions. The draggable wrapper is a mouse-only enhancement.
                <div
                  key={d.dealId}
                  draggable
                  onDragStart={(e) => onDragStart(e, d.dealId)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverStage(null);
                  }}
                  className={dragId === d.dealId ? 'dragging' : ''}
                >
                  <PipeCard d={d} onMove={(to) => void moveDeal(d.dealId, to)} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TimelineBar = { s: number; d: number; cls: 'hot' | 'info' | ''; label: string; amt: string };
type TimelineRow = { n: string; i: string; bars: TimelineBar[] };

export function PipelineTimeline() {
  // 12 weeks laid out horizontally; each deal has a bar positioned by start-week + duration
  const rows: TimelineRow[] = [
    {
      n: 'SSgt. M. Alvarez',
      i: 'LD-40218',
      bars: [{ s: 2, d: 3, cls: 'hot', label: 'PCS · Campbell → JBLM', amt: '$2,140' }],
    },
    {
      n: 'MELS Corporate Mobility',
      i: 'ACC-1188',
      bars: [{ s: 0, d: 4, cls: 'hot', label: 'BAFO window', amt: '$740K MSA' }],
    },
    {
      n: 'CW3 Diane Park',
      i: 'LD-40201',
      bars: [{ s: 3, d: 5, cls: '', label: 'PCS · Rucker → Wainwright', amt: '$8,300' }],
    },
    {
      n: 'Lt. Col. E. Oduya',
      i: 'LD-40176',
      bars: [{ s: 4, d: 6, cls: 'info', label: 'OCONUS · Ramstein → WPAFB', amt: '$6,410' }],
    },
    {
      n: 'Brightwell Energy Inc.',
      i: 'LD-40268',
      bars: [{ s: 1, d: 4, cls: 'info', label: 'Annual contract scoping', amt: '$220K' }],
    },
    {
      n: 'Capt. Julian Soto',
      i: 'LD-40276',
      bars: [{ s: 5, d: 2, cls: '', label: 'PCS · Coronado → Norfolk', amt: '$3,150' }],
    },
    {
      n: 'Atlas Federal (GSA)',
      i: 'LD-40149',
      bars: [{ s: 6, d: 4, cls: 'info', label: 'GSA · DOE task order', amt: '$1.2M' }],
    },
    {
      n: 'Nordlight Capital',
      i: 'LD-40108',
      bars: [{ s: 0, d: 2, cls: 'hot', label: 'White-glove · exec', amt: '$38K' }],
    },
    {
      n: 'MSgt. K. Vargas',
      i: 'LD-40271',
      bars: [{ s: 8, d: 4, cls: '', label: 'OCONUS · Eglin → Yokota', amt: '$6,920' }],
    },
  ];
  return (
    <div className="timeline-wrap">
      <div className="timeline-header">
        <div></div>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="wk">
            {i === 0 && <span className="month-label">APR</span>}
            {i === 2 && <span className="month-label">MAY</span>}
            {i === 6 && <span className="month-label">JUN</span>}
            {i === 10 && <span className="month-label">JUL</span>}
            {![0, 2, 6, 10].includes(i) && <span>w{i + 16}</span>}
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.i} className="timeline-row">
          <div className="acct">
            <div className="n">{r.n}</div>
            <div className="i">{r.i}</div>
          </div>
          <div className="timeline-track">
            <div className="tl-now" style={{ left: `${(1.5 / 12) * 100}%` }}></div>
            {r.bars.map((b, bi) => (
              <div
                key={bi}
                className={`tl-bar ${b.cls}`}
                style={{ left: `${(b.s / 12) * 100}%`, width: `${(b.d / 12) * 100}%` }}
              >
                <span className="pcs-label">{b.label}</span>
                <span className="amt ml-auto">{b.amt}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const STAGE_LABEL: Record<StageKey, string> = {
  inbound: 'Inbound',
  qualify: 'Qualifying',
  scoping: 'Scoping',
  quote: 'Quoted',
  verbal: 'Verbal',
  won: 'Won',
};

export function PipelineTable() {
  const rows = useDeals();
  return (
    <div className="table-wrap">
      <table className="pipe-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Type</th>
            <th>Route / scope</th>
            <th>Stage</th>
            <th className="ta-right">Value</th>
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.dealId}>
              <td>
                <div className="t-name">{d.title}</div>
                <div className="t-id">{d.displayId}</div>
              </td>
              <td>
                <span
                  className={`tag-rank ${d.tags.includes('PCS') ? 'pcs' : d.tags.includes('CORP') || d.tags.includes('F500') ? 'corp' : 'indiv'}`}
                >
                  {d.tags.includes('PCS')
                    ? 'PCS'
                    : d.tags.includes('CORP') || d.tags.includes('F500')
                      ? 'CORP'
                      : d.tags.includes('GSA')
                        ? 'GSA'
                        : 'INDIV'}
                </span>
              </td>
              <td className="c-fg">{d.meta}</td>
              <td className="mono">{STAGE_LABEL[d.stage]}</td>
              <td className="num">{formatMoneyShort(d.value)}</td>
              <td>
                {d.hot ? (
                  <span className="c-accent">Due this week</span>
                ) : d.warm ? (
                  <span className="c-muted">Re-quote needed</span>
                ) : (
                  <span className="c-subtle">On track</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PipelineProps {
  layout: PipeLayout;
}

export function Pipeline({ layout }: PipelineProps) {
  return (
    <div className="pipeline">
      <div className="pane-head">
        <div className="pane-title">
          <div className="eyebrow">Pipeline · All pods · 94 open · $2.44M weighted</div>
          <div className="title">Sales pipeline</div>
          <div className="sub">
            One view of every deal in flight. Hot markers on cards mean the promise clock is running
            — not that the deal is big.
          </div>
        </div>
        <div className="row-gap-6">
          <button type="button" className="btn">
            <Filter className="ic-sm" aria-hidden="true" />
            Filter
          </button>
          <button type="button" className="btn">
            <Download className="ic-sm" aria-hidden="true" />
            Export
          </button>
          <button type="button" className="btn primary">
            <Plus className="ic-sm" aria-hidden="true" />
            New deal <kbd>N</kbd>
          </button>
        </div>
      </div>
      <div className="controls">
        <div className="filters">
          <span className="chip solid">All pods</span>
          <span className="chip">DOD-SE</span>
          <span className="chip">DOD-NW</span>
          <span className="chip">Corp-EN</span>
          <span className="chip">Indiv</span>
          <span className="chip accent">Needs action · 7</span>
        </div>
        <div className="spacer" />
        <div className="stats">
          <span>
            <strong>94</strong> open
          </span>
          <span>
            <strong>$1.67M</strong> weighted
          </span>
          <span>
            <strong>34%</strong> win rate · 90d
          </span>
        </div>
      </div>

      {layout === 'kanban' && <PipelineKanban />}
      {layout === 'timeline' && <PipelineTimeline />}
      {layout === 'table' && <PipelineTable />}
    </div>
  );
}
