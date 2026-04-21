import React from 'react';
import { MoreHorizontal, Filter, Download, Plus, MoveRight } from 'lucide-react';
import { STAGES } from '../lib/data';
import type { Deal, PipeLayout, StageKey } from '../lib/types';
import { formatMoneyShort } from '../lib/money';
import { advanceDeal } from '../api/mutations';
import { newIdempotencyKey, repId } from '../lib/ids';
import { track } from '../app/telemetry';
import { isEnabled } from '../app/flags';
import { canTransition, runTransition } from '../domain/deal-machine';
import { eventLog } from '../domain/events';
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
          onClick={(e) => e.stopPropagation()}
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
          },
        });
        console.warn(`[pipeline] illegal transition ${from} → ${to}; dropped client-side`);
        announce(`Cannot move ${prev.title} from ${fromLabel} to ${toLabel}: invalid transition.`);
        return;
      }

      const t0 = performance.now();
      // Single idempotency key shared by the local event log + the API call.
      // Same key on retry → both sides accept at most one event.
      const opKey = newIdempotencyKey();

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
          },
        });
        console.warn(`[pipeline] local commit refused: ${local.code} — ${local.message}`);
        return;
      }

      // Projection already has the new stage from the `deal.advanced` event;
      // the subscription in useDeals() re-renders this component.
      track({ name: 'pipeline.card_moved', props: { dealId: id, from, to, optimistic: true } });
      // Announce the optimistic success now, not after the server confirms.
      // Screen reader users expect feedback at the same latency sighted
      // users get the visual update; if the server reverts, the rollback
      // path below announces that separately.
      announce(`Moved ${prev.title} from ${fromLabel} to ${toLabel}.`);

      const res = await advanceDeal(prev.dealId, to, opKey);
      const ms = Math.round(performance.now() - t0);

      if (!res.ok) {
        // Compensating revert: appends a `deal.reverted` event; projection
        // snaps the card back to its original stage on the next subscription
        // tick.
        void runTransition(eventLog, {
          id: prev.dealId,
          from: to,
          to: from,
          by: repId('rep_mhall'),
          role: 'rep',
          reason: `rolled back: ${res.error.code}`,
        });
        track({
          name: 'pipeline.card_moved_failed',
          props: { dealId: id, from, to, ms, code: res.error.code, requestId: res.requestId },
        });
        console.warn(
          `[pipeline] move rolled back: ${res.error.code} — ${res.error.message} (req_id=${res.requestId})`
        );
        announce(`Move failed. ${prev.title} returned to ${fromLabel}.`);
        return;
      }
      track({
        name: 'pipeline.card_moved_confirmed',
        props: { dealId: id, from, to, ms, requestId: res.requestId },
      });
    },
    [deals, announce]
  );

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
