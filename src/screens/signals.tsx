import React from 'react';
import { ArrowRight, EyeOff, BellOff, Check } from 'lucide-react';
import { Noun } from '../components/nouns';
import { newIdempotencyKey, repId } from '../lib/ids';
import { track } from '../app/telemetry';
import { scheduleRegistry, outbox, signalProjection } from '../app/runtime';
import { eventLog } from '../domain/events';
import { signalStream } from '../domain/events';
import { useAnnounce } from '../lib/live-region';
import { ageShort, now as nowInstant } from '../lib/time';
import { SIGNALS, type SignalKind, type SignalPriority } from './signals.data';
import type { ProjectedSignal } from '../domain/signal-projection';

type FilterKey = 'all' | SignalPriority | SignalKind;

// Signals feed — real-time intel surface. Vercel-dense: tight rows, mono-forward, zero chrome.

const KINDS: Record<SignalKind, { c: string; lbl: string }> = {
  CYCLE: { c: 'olive', lbl: 'PCS-CYCLE' },
  COMPETITOR: { c: 'accent', lbl: 'COMPETITOR' },
  SIGNAL: { c: 'info', lbl: 'BUYING-SIGNAL' },
  SPOUSE: { c: 'info', lbl: 'SPOUSE-GROUP' },
  GSA: { c: 'olive', lbl: 'GSA-RFP' },
  PARTNER: { c: 'accent', lbl: 'PARTNER-OPS' },
};

// Dismiss/action click path. Writes a durable local event FIRST so the
// projection updates before the server call is even dispatched — the
// rep sees immediate visual feedback. The outbox then owns server sync,
// retries, and (on permanent failure) appends the compensating revert.
//
// Hoisted out of the component to keep the dependency list on
// `useEffect`s honest — the handlers close over `setSelected` + stable
// refs (list, visible, announce) passed as args.
async function markSignal(
  verb: 'dismiss' | 'action',
  target: ProjectedSignal,
  list: readonly ProjectedSignal[],
  visible: readonly ProjectedSignal[],
  setSelected: (id: string) => void,
  announce: (msg: string) => void
): Promise<void> {
  const at = nowInstant();
  const by = repId('rep_mhall');
  const payload =
    verb === 'dismiss'
      ? { kind: 'signal.dismissed' as const, at, by }
      : { kind: 'signal.actioned' as const, at, by };
  const opKey = newIdempotencyKey();

  // Single idempotency key shared by the local event AND the server call.
  // Same key on retry → the log refuses the second write (UNIQUE on
  // stream + opKey), and the server's Idempotency-Key dedupe covers the
  // wire.
  const local = await eventLog.append(signalStream(target.id), [{ opKey, payload }]);
  if (!local.ok) {
    announce(`Could not ${verb} signal ${target.id}: ${local.code}.`);
    console.warn(
      `[signals] local ${verb} refused for ${target.id}: ${local.code} — ${local.message}`
    );
    return;
  }

  // Dismiss moves the detail-pane selection forward so the rep doesn't
  // stare at the row they just hid. Action leaves selection in place —
  // the row stays visible with a "done" mark.
  if (verb === 'dismiss') {
    const nextSelected =
      list.find((s) => s.id !== target.id)?.id ??
      visible.find((s) => s.id !== target.id)?.id ??
      target.id;
    setSelected(nextSelected);
  }

  announce(verb === 'dismiss' ? `Dismissed signal ${target.id}.` : `Actioned signal ${target.id}.`);
  track({
    name: verb === 'dismiss' ? 'signal.dismissed' : 'signal.actioned',
    props: { id: target.id, requestId: 'local', opKey },
  });

  await outbox.enqueue(
    verb === 'dismiss'
      ? { kind: 'dismiss_signal', signalId: target.id }
      : { kind: 'action_signal', signalId: target.id },
    opKey
  );
  void outbox.drain();
}

// `useSignalProjection` subscribes to the durable projection. The
// returned snapshot is stable within a render pass — React bails out of
// re-renders when `Object.is` deems the array identical, and the
// projection emits a fresh array only when a mark event lands.
function useSignalProjection(): readonly ProjectedSignal[] {
  const [snap, setSnap] = React.useState<readonly ProjectedSignal[]>(() => signalProjection.list());
  React.useEffect(() => {
    return signalProjection.subscribe((next) => setSnap(next));
  }, []);
  return snap;
}

export function Signals() {
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [selected, setSelected] = React.useState<string>(SIGNALS[0].id);
  const announce = useAnnounce();
  // Index of the row that currently holds the row-level tab stop. The grid
  // uses a single tab stop (roving tabindex) so Tab/Shift+Tab move users
  // out of the grid instead of tabbing through every row; once focus lands
  // on the tabstop row, ArrowUp/Down, Home, End navigate.
  const [focusIdx, setFocusIdx] = React.useState(0);
  const gridRef = React.useRef<HTMLDivElement>(null);

  // Live projection snapshot — the single source of truth for mark state.
  // Dismiss/action events (ours + the outbox compensator's reverts) flow
  // through this hook into the render.
  const projected = useSignalProjection();
  const visible = React.useMemo(() => projected.filter((s) => s.mark !== 'dismissed'), [projected]);

  const list =
    filter === 'all'
      ? visible
      : filter === 'p0'
        ? visible.filter((s) => s.priority === 'p0')
        : visible.filter((s) => s.kind === filter);

  const cur = visible.find((s) => s.id === selected) ?? list[0] ?? visible[0] ?? projected[0];

  // Clamp focusIdx if the filter shrinks the list past the focused row.
  React.useEffect(() => {
    if (focusIdx >= list.length && list.length > 0) setFocusIdx(list.length - 1);
  }, [list.length, focusIdx]);

  // Permanent outbox failures announce the revert. The projection has
  // already flipped the row back via the compensator's append — we only
  // owe the user a screen-reader cue so the visual un-revert doesn't land
  // silently.
  React.useEffect(() => {
    return outbox.onFailure((mutation, error, compensation, _opKey) => {
      if (mutation.kind !== 'dismiss_signal' && mutation.kind !== 'action_signal') return;
      const verb = mutation.kind === 'dismiss_signal' ? 'Dismiss' : 'Action';
      if (compensation.status === 'compensated') {
        announce(`${verb} failed for signal ${mutation.signalId}: reverted.`);
      } else {
        announce(
          `${verb} failed for signal ${mutation.signalId}: ${error.code}. Could not revert locally — refresh to resync.`
        );
      }
      console.warn(
        `[signals] ${mutation.kind} permanent failure for ${mutation.signalId}: ${error.code} — ${error.message} compensation=${compensation.status}`
      );
    });
  }, [announce]);

  // After focusIdx changes (via keyboard nav), move DOM focus to match.
  // Mouse interactions that change focusIdx via onFocus don't need this
  // because the browser already moved focus. Gate on
  // `gridRef.current.contains(activeElement)` so we don't steal focus from
  // elsewhere on the page when the filter changes.
  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (!grid.contains(document.activeElement)) return;
    const row = grid.querySelector<HTMLElement>(`[data-row-idx="${focusIdx}"]`);
    row?.focus();
  }, [focusIdx, list.length]);

  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Let interactive descendants (Nouns) keep their own keys. We only act
    // when the row itself owns focus.
    const target = e.target as HTMLElement;
    if (!target.matches('[role="row"]')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusIdx(list.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const s = list[focusIdx];
      if (s) setSelected(s.id);
    }
  };

  const counts = {
    all: visible.length,
    p0: visible.filter((s) => s.priority === 'p0').length,
    CYCLE: visible.filter((s) => s.kind === 'CYCLE').length,
    COMPETITOR: visible.filter((s) => s.kind === 'COMPETITOR').length,
    SIGNAL: visible.filter((s) => s.kind === 'SIGNAL' || s.kind === 'SPOUSE').length,
    GSA: visible.filter((s) => s.kind === 'GSA').length,
  };

  return (
    <div className="signals">
      <div className="sig-head">
        <div>
          <div className="eyebrow">Signals · live · 8 events today · 32 this week</div>
          <h1>Signals feed</h1>
          <div className="sub">
            Machine reads the world so the rep doesn't have to. Every signal links to a person, a
            deal, or a base — nothing floats alone.
          </div>
        </div>
        <div className="sig-meta">
          <PollIndicator />
        </div>
      </div>

      <div className="sig-filters">
        <button
          type="button"
          className={filter === 'all' ? 'on' : ''}
          onClick={() => setFilter('all')}
        >
          All <span className="n">{counts.all}</span>
        </button>
        <button
          type="button"
          className={filter === 'p0' ? 'on p0' : 'p0'}
          onClick={() => setFilter('p0')}
        >
          P0 <span className="n">{counts.p0}</span>
        </button>
        <div className="div"></div>
        <button
          type="button"
          className={filter === 'CYCLE' ? 'on' : ''}
          onClick={() => setFilter('CYCLE')}
        >
          PCS cycle <span className="n">{counts.CYCLE}</span>
        </button>
        <button
          type="button"
          className={filter === 'COMPETITOR' ? 'on' : ''}
          onClick={() => setFilter('COMPETITOR')}
        >
          Competitor <span className="n">{counts.COMPETITOR}</span>
        </button>
        <button
          type="button"
          className={filter === 'SIGNAL' ? 'on' : ''}
          onClick={() => setFilter('SIGNAL')}
        >
          Buying signal <span className="n">{counts.SIGNAL}</span>
        </button>
        <button
          type="button"
          className={filter === 'GSA' ? 'on' : ''}
          onClick={() => setFilter('GSA')}
        >
          GSA <span className="n">{counts.GSA}</span>
        </button>
      </div>

      <div className="sig-body">
        {/*
          ARIA grid pattern (WAI-ARIA APG · "Data Grids"). We picked grid over
          listbox because rows carry interactive children (Nouns) — listbox
          forbids descendants with widget roles, grid explicitly allows them
          via `role="gridcell"`. Rows are selectable (aria-selected) and use
          a single roving tab stop; cells don't need individual tab stops
          because the only in-cell interactive is the Noun, and Nouns are
          reachable via Tab from the row (they carry tabIndex=0 themselves).
        */}
        {/*
          Per APG grid pattern, the role="grid" container is not itself
          a tab stop; focusability lives on the selected row (roving
          tabindex). Same for role="gridcell" below: cells without
          interactive children aren't individually focusable. jsx-a11y's
          "interactive role ⇒ focusable" check is correct for most widgets
          but wrong for composite grid roles.
        */}
        {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
        <div
          ref={gridRef}
          className="sig-list"
          role="grid"
          aria-label="Signals"
          aria-rowcount={list.length}
          onKeyDown={onGridKey}
        >
          {list.map((s, idx) => {
            const k = KINDS[s.kind];
            const isSelected = s.id === selected;
            const isTabStop = idx === focusIdx;
            const isActioned = s.mark === 'actioned';
            return (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- WAI-ARIA APG "Data Grids": keyboard lives on the grid container via `onKeyDown={onGridKey}` (line 287 → ArrowUp/Down/Home/End/Enter/Space). Rows are the roving-tabindex surface but delegate key handling upward per the APG pattern. Duplicating onKeyDown here would fork from the grid's navigation semantics.
              <div
                key={s.id}
                role="row"
                aria-selected={isSelected}
                aria-rowindex={idx + 1}
                aria-label={
                  isActioned
                    ? `Signal ${s.id}, actioned: ${s.headline}`
                    : `Signal ${s.id}: ${s.headline}`
                }
                tabIndex={isTabStop ? 0 : -1}
                data-row-idx={idx}
                className={`sig-row${isSelected ? ' on' : ''}${s.priority === 'p0' ? ' p0' : ''}${isActioned ? ' done' : ''}`}
                onClick={() => setSelected(s.id)}
                onFocus={() => setFocusIdx(idx)}
              >
                <div role="gridcell" className="age">
                  {s.age}
                </div>
                <div role="gridcell" className={`kind ${k.c}`}>
                  {k.lbl}
                </div>
                <div role="gridcell" className="lane">
                  {s.laneNoun ? (
                    <Noun kind={s.laneNoun.kind} id={s.laneNoun.id}>
                      {s.lane}
                    </Noun>
                  ) : (
                    s.lane
                  )}
                </div>
                <div role="gridcell" className="line">
                  {s.headline}
                </div>
                {/*
                  role="gridcell" is a composite role; the cell itself
                  isn't a focus stop. The onClick just intercepts the
                  bubble so clicking the Noun inside doesn't also select
                  the row; keyboard interaction with the Noun is handled
                  by the Noun's own onKeyDown.
                */}
                {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus, jsx-a11y/click-events-have-key-events */}
                <div role="gridcell" className="id" onClick={(e) => e.stopPropagation()}>
                  <Noun kind="signal" id={s.id}>
                    {s.id}
                  </Noun>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="sig-detail">
          <div className="sd-head">
            <div className="id">
              <Noun kind="signal" id={cur.id}>
                {cur.id}
              </Noun>
            </div>
            <div className={`badge ${KINDS[cur.kind].c}`}>{KINDS[cur.kind].lbl}</div>
            {cur.priority === 'p0' && <div className="badge p0">P0</div>}
          </div>
          <h2>{cur.headline}</h2>
          <div className="sd-body">{cur.body}</div>

          <div className="sd-kv">
            <div>
              <div className="k">Source</div>
              <div className="v">{cur.actor}</div>
            </div>
            <div>
              <div className="k">Age</div>
              <div className="v mono">{cur.age} ago</div>
            </div>
            <div>
              <div className="k">Lane</div>
              <div className="v">{cur.lane}</div>
            </div>
            <div>
              <div className="k">Confidence</div>
              <div className="v">
                {cur.priority === 'p0'
                  ? 'High · verified'
                  : cur.priority === 'p1'
                    ? 'Medium · pattern'
                    : 'Low · context'}
              </div>
            </div>
          </div>

          {cur.linked && cur.linked.length > 0 && (
            <div className="sd-linked">
              <div className="k">Linked</div>
              {cur.linked.map((l) =>
                l.noun ? (
                  <Noun key={l.label} kind={l.noun.kind} id={l.noun.id} className="chip solid-link">
                    {l.label}
                  </Noun>
                ) : (
                  <div key={l.label} className="chip solid-link">
                    {l.label}
                  </div>
                )
              )}
            </div>
          )}

          {cur.action && (
            <div className="sd-action">
              <div className="k">Suggested action</div>
              <div className="sd-act-btn">
                <ArrowRight className="ic-sm" aria-hidden="true" />
                <span>{cur.action}</span>
              </div>
            </div>
          )}

          <div className="sd-foot">
            <button
              type="button"
              className="btn"
              disabled={cur.mark !== 'none'}
              onClick={() => {
                void markSignal('dismiss', cur, list, visible, setSelected, announce);
              }}
            >
              <EyeOff className="ic-sm" aria-hidden="true" />
              Dismiss
            </button>
            <button type="button" className="btn">
              <BellOff className="ic-sm" aria-hidden="true" />
              Mute kind
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={cur.mark !== 'none'}
              onClick={() => {
                void markSignal('action', cur, list, visible, setSelected, announce);
              }}
            >
              <Check className="ic-sm" aria-hidden="true" />
              Actioned
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PollIndicator() {
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const all = scheduleRegistry.all();
  if (all.length === 0) {
    return (
      <>
        <div className="live-row">
          <span className="pulse"></span>No schedules registered
        </div>
        <div className="poll-row">—</div>
      </>
    );
  }
  const next = all
    .map((s) => ({ name: s.name, at: s.nextRunAt() }))
    .sort((a, b) => new Date(a.at.iso).getTime() - new Date(b.at.iso).getTime())[0];
  const ms = Math.max(0, new Date(next.at.iso).getTime() - nowMs);
  const mm = Math.floor(ms / 60_000);
  const ss = Math.floor((ms % 60_000) / 1000);
  const countdown = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return (
    <>
      <div className="live-row">
        <span className="pulse"></span>
        Polling {all.map((s) => s.name).join(' · ')}
      </div>
      <div className="poll-row">
        Next poll · <strong>{next.name}</strong> in {countdown}
      </div>
      <RecentRunsLine />
    </>
  );
}

function RecentRunsLine() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  const handle = scheduleRegistry.all()[0];
  if (!handle) return null;
  const last = handle.recentRuns(1)[0];
  if (!last) return <div className="poll-row">No runs yet · waiting for first tick</div>;
  return (
    <div className="poll-row">
      Last {handle.name}: {last.status} · {ageShort(last.startedAt)} ago
      {last.summary ? ` · ${last.summary}` : ''}
    </div>
  );
}
