import React from 'react';
import { ArrowRight, EyeOff, BellOff, Check } from 'lucide-react';
import { Noun } from '../components/nouns';
import type { SignalId } from '../lib/types';
import { fromDisplayId, newIdempotencyKey } from '../lib/ids';
import { dismissSignal, actionSignal } from '../api/mutations';
import { track } from '../app/telemetry';
import { scheduleRegistry } from '../app/runtime';
import { ageShort } from '../lib/time';
import { SIGNALS, type SignalKind, type SignalPriority } from './signals.data';

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

export function Signals() {
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [selected, setSelected] = React.useState<string>(SIGNALS[0].id);
  // Index of the row that currently holds the row-level tab stop. The grid
  // uses a single tab stop (roving tabindex) so Tab/Shift+Tab move users
  // out of the grid instead of tabbing through every row; once focus lands
  // on the tabstop row, ArrowUp/Down, Home, End navigate.
  const [focusIdx, setFocusIdx] = React.useState(0);
  const gridRef = React.useRef<HTMLDivElement>(null);

  const list =
    filter === 'all'
      ? SIGNALS
      : filter === 'p0'
        ? SIGNALS.filter((s) => s.priority === 'p0')
        : SIGNALS.filter((s) => s.kind === filter);

  const cur = SIGNALS.find((s) => s.id === selected) || SIGNALS[0];

  // Clamp focusIdx if the filter shrinks the list past the focused row.
  React.useEffect(() => {
    if (focusIdx >= list.length && list.length > 0) setFocusIdx(list.length - 1);
  }, [list.length, focusIdx]);

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
    all: SIGNALS.length,
    p0: SIGNALS.filter((s) => s.priority === 'p0').length,
    CYCLE: SIGNALS.filter((s) => s.kind === 'CYCLE').length,
    COMPETITOR: SIGNALS.filter((s) => s.kind === 'COMPETITOR').length,
    SIGNAL: SIGNALS.filter((s) => s.kind === 'SIGNAL' || s.kind === 'SPOUSE').length,
    GSA: SIGNALS.filter((s) => s.kind === 'GSA').length,
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
            return (
              <div
                key={s.id}
                role="row"
                aria-selected={isSelected}
                aria-rowindex={idx + 1}
                aria-label={`Signal ${s.id}: ${s.headline}`}
                tabIndex={isTabStop ? 0 : -1}
                data-row-idx={idx}
                className={`sig-row${isSelected ? ' on' : ''}${s.priority === 'p0' ? ' p0' : ''}`}
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
              onClick={async () => {
                const sid = fromDisplayId<SignalId>(cur.id);
                const res = await dismissSignal(sid, undefined, newIdempotencyKey());
                if (res.ok)
                  track({
                    name: 'signal.dismissed',
                    props: { id: cur.id, requestId: res.requestId },
                  });
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
              onClick={async () => {
                const sid = fromDisplayId<SignalId>(cur.id);
                const res = await actionSignal(sid, newIdempotencyKey());
                if (res.ok)
                  track({
                    name: 'signal.actioned',
                    props: { id: cur.id, requestId: res.requestId },
                  });
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
